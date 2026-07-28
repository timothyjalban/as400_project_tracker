"""Customer and contact endpoints: history, autocomplete, search, profile."""
from __future__ import annotations

import re
from datetime import datetime

from flask import Blueprint, jsonify, request

from core import (
    attach_po_display,
    build_customer_profile_key,
    dict_from_row,
    get_db_connection,
    normalize_phone_digits,
    upsert_customer_profile,
)

customers_bp = Blueprint('customers', __name__)


@customers_bp.route('/api/customers/history', methods=['GET'])
def get_customer_history():
    """Get recent orders for a customer by name and/or phone."""
    try:
        name = request.args.get('name', '').strip()
        phone = request.args.get('phone', '').strip()
        exclude_id = request.args.get('exclude_id', type=int)
        limit = request.args.get('limit', default=20, type=int)

        if not name and not phone:
            return jsonify({
                'success': False,
                'error': 'Either name or phone is required'
            }), 400

        limit = max(1, min(limit or 20, 100))

        conn = get_db_connection()

        criteria_sql = []
        criteria_params = []

        if name:
            criteria_sql.append("LOWER(TRIM(customer_name)) = LOWER(?)")
            criteria_params.append(name)

        if phone:
            phone_digits = re.sub(r'\D+', '', phone)
            if phone_digits:
                criteria_sql.append("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?")
                criteria_params.append(phone_digits)
            else:
                criteria_sql.append("TRIM(COALESCE(customer_phone, '')) = ?")
                criteria_params.append(phone)

        where_sql = f"({' OR '.join(criteria_sql)})"
        where_params = list(criteria_params)

        if exclude_id:
            where_sql += " AND id != ?"
            where_params.append(exclude_id)

        query = f"""
            SELECT id, customer_name, customer_phone, project_name, stage,
                   quote_number, quote_total, invoice_number, invoice_total,
                   po_number, po_numbers, archived, updated_at, created_at
              FROM orders
             WHERE {where_sql}
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
             LIMIT ?
        """
        where_params.append(limit)

        rows = conn.execute(query, where_params).fetchall()
        conn.close()

        orders = [attach_po_display(dict_from_row(row)) for row in rows]

        return jsonify({
            'success': True,
            'orders': orders,
            'count': len(orders)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ===== Contacts & Auto-Complete Endpoints =====

@customers_bp.route('/api/contacts', methods=['GET'])
def get_contacts():
    """Get list of known customer names for autocomplete"""
    try:
        limit = request.args.get('limit', 200, type=int)

        conn = get_db_connection()
        cursor = conn.cursor()

        rows = cursor.execute("""
            SELECT name FROM (
                SELECT DISTINCT TRIM(customer_name) AS name
                  FROM orders
                 WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
                UNION
                SELECT DISTINCT TRIM(guest) AS name
                  FROM reminders
                 WHERE guest IS NOT NULL AND TRIM(guest) != ''
            )
            WHERE name IS NOT NULL AND name != ''
            ORDER BY name COLLATE NOCASE
            LIMIT ?
        """, (limit,)).fetchall()

        contacts = [r[0] for r in rows if r and r[0]]
        conn.close()

        return jsonify({
            'success': True,
            'contacts': contacts,
            'count': len(contacts)
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ===== CONTACTS ENDPOINTS =====

@customers_bp.route('/api/contacts/info', methods=['GET'])
def get_contact_info():
    """Get customer info by phone or name for auto-fill"""
    try:
        phone = request.args.get('phone', '').strip()
        name = request.args.get('name', '').strip()

        if not phone and not name:
            return jsonify({
                'success': False,
                'error': 'Either phone or name parameter required'
            }), 400

        conn = get_db_connection()
        cursor = conn.cursor()

        def _profile_payload(row):
            payload = dict_from_row(row)
            return {
                'customer_name': payload.get('customer_name'),
                'customer_phone': payload.get('customer_phone'),
                'customer_email': payload.get('customer_email'),
                'customer_number': payload.get('customer_number'),
                'has_customer_account': 1 if str(payload.get('customer_number') or '').strip() else 0,
                'customer_profile_id': payload.get('id'),
                'default_project_notes': payload.get('default_project_notes'),
                'project_name': payload.get('last_project_name'),
            }

        # Try customer profile table first.
        if phone:
            phone_digits = normalize_phone_digits(phone)
            row = cursor.execute(
                """
                SELECT id, customer_name, customer_phone, customer_email,
                       customer_number, default_project_notes,
                       NULL AS last_project_name
                  FROM customer_profiles
                 WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?
                 ORDER BY datetime(updated_at) DESC, id DESC
                 LIMIT 1
                """,
                (phone_digits,),
            ).fetchone()
            if row:
                conn.close()
                return jsonify({'success': True, 'info': _profile_payload(row)})

        if name:
            row = cursor.execute(
                """
                SELECT id, customer_name, customer_phone, customer_email,
                       customer_number, default_project_notes,
                       NULL AS last_project_name
                  FROM customer_profiles
                 WHERE LOWER(TRIM(customer_name)) = LOWER(?)
                 ORDER BY datetime(updated_at) DESC, id DESC
                 LIMIT 1
                """,
                (name,),
            ).fetchone()
            if row:
                conn.close()
                return jsonify({'success': True, 'info': _profile_payload(row)})

        # Try phone first (more reliable)
        if phone:
            row = cursor.execute("""
                  SELECT customer_name, customer_phone, customer_email, project_name,
                      customer_number, has_customer_account, customer_profile_id
                FROM orders
                WHERE customer_phone = ?
                ORDER BY updated_at DESC
                LIMIT 1
            """, (phone,)).fetchone()

            if row:
                info = dict(row)
                conn.close()
                return jsonify({
                    'success': True,
                    'info': info
                })

        # Fall back to name match
        if name:
            row = cursor.execute("""
                  SELECT customer_name, customer_phone, customer_email, project_name,
                      customer_number, has_customer_account, customer_profile_id
                FROM orders
                WHERE LOWER(TRIM(customer_name)) = LOWER(?)
                ORDER BY updated_at DESC
                LIMIT 1
            """, (name,)).fetchone()

            if row:
                info = dict(row)
                conn.close()
                return jsonify({
                    'success': True,
                    'info': info
                })

        conn.close()
        return jsonify({
            'success': False,
            'error': 'Customer not found'
        }), 404

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@customers_bp.route('/api/customers/search', methods=['GET'])
def search_customers():
    """Search customer directory regardless of active/completed order state."""
    try:
        query = request.args.get('q', '').strip()
        limit = request.args.get('limit', default=25, type=int)
        include_recent = request.args.get('include_recent', 'false').lower() == 'true'
        has_account_only = request.args.get('has_account_only', 'false').lower() == 'true'

        if len(query) < 2 and not include_recent:
            return jsonify({'success': True, 'customers': [], 'count': 0})

        limit = max(1, min(limit or 25, 100))
        query_like = f"%{query}%"

        query_digits = re.sub(r'\D+', '', query)

        conn = get_db_connection()
        params = []
        where_clauses = [
            "customer_name IS NOT NULL",
            "TRIM(customer_name) != ''",
        ]

        if has_account_only:
            where_clauses.append("customer_number IS NOT NULL AND TRIM(customer_number) != ''")

        if len(query) >= 2:
            search_clause = """
                (
                    customer_name LIKE ?
                    OR COALESCE(customer_phone, '') LIKE ?
                    OR COALESCE(customer_email, '') LIKE ?
                    OR COALESCE(customer_number, '') LIKE ?
                )
            """
            params.extend([query_like, query_like, query_like, query_like])

            if query_digits:
                search_clause = """
                    (
                        customer_name LIKE ?
                        OR COALESCE(customer_phone, '') LIKE ?
                        OR COALESCE(customer_email, '') LIKE ?
                        OR COALESCE(customer_number, '') LIKE ?
                        OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?
                    )
                """
                params.append(f"%{query_digits}%")

            where_clauses.append(search_clause)

        sql = f"""
            SELECT id, customer_name, customer_phone, customer_email, customer_number,
                   project_name, stage, updated_at, created_at, archived, customer_profile_id
              FROM orders
             WHERE {' AND '.join(where_clauses)}
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
             LIMIT 500
        """

        rows = conn.execute(sql, params).fetchall()

        customers = []
        seen_keys = set()

        for row in rows:
            item = dict_from_row(row)
            name_key = str(item.get('customer_name') or '').strip().lower()
            number_key = str(item.get('customer_number') or '').strip()
            phone_key = re.sub(r'\D+', '', str(item.get('customer_phone') or ''))
            dedupe_key = (name_key, number_key or phone_key)

            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)

            customers.append({
                'customer_name': item.get('customer_name'),
                'customer_phone': item.get('customer_phone'),
                'customer_email': item.get('customer_email'),
                'customer_number': item.get('customer_number'),
                'customer_profile_id': item.get('customer_profile_id'),
                'last_project_name': item.get('project_name'),
                'last_stage': item.get('stage'),
                'last_order_id': item.get('id'),
                'archived': item.get('archived'),
                'last_updated': item.get('updated_at') or item.get('created_at')
            })

            if len(customers) >= limit:
                break

        # Enrich with profile IDs/default notes where available.
        if customers:
            numbers = sorted({str(c.get('customer_number') or '').strip() for c in customers if str(c.get('customer_number') or '').strip()})
            profile_ids = sorted({int(c.get('customer_profile_id')) for c in customers if c.get('customer_profile_id')})
            by_number = {}
            by_id = {}

            if profile_ids:
                placeholders = ','.join('?' for _ in profile_ids)
                profile_rows = conn.execute(
                    f"""
                    SELECT id, customer_number, customer_name, customer_phone, default_project_notes, updated_at
                      FROM customer_profiles
                     WHERE id IN ({placeholders})
                     ORDER BY datetime(updated_at) DESC, id DESC
                    """,
                    profile_ids,
                ).fetchall()
                for profile_row in profile_rows:
                    profile_item = dict_from_row(profile_row)
                    by_id[profile_item['id']] = profile_item

            if numbers:
                placeholders = ','.join('?' for _ in numbers)
                profile_rows = conn.execute(
                    f"""
                    SELECT id, customer_number, customer_name, customer_phone, default_project_notes, updated_at
                      FROM customer_profiles
                     WHERE customer_number IN ({placeholders})
                     ORDER BY datetime(updated_at) DESC, id DESC
                    """,
                    numbers,
                ).fetchall()
                for profile_row in profile_rows:
                    profile_item = dict_from_row(profile_row)
                    key = str(profile_item.get('customer_number') or '').strip()
                    if key and key not in by_number:
                        by_number[key] = profile_item

            for customer in customers:
                profile = None
                customer_profile_id = customer.get('customer_profile_id')
                if customer_profile_id and int(customer_profile_id) in by_id:
                    profile = by_id[int(customer_profile_id)]

                number = str(customer.get('customer_number') or '').strip()
                if not profile and number and number in by_number:
                    profile = by_number[number]

                if profile:
                    customer['customer_profile_id'] = customer.get('customer_profile_id') or profile.get('id')
                    customer['default_project_notes'] = profile.get('default_project_notes')

        # Lightweight ranking when querying by text: exact name/number matches bubble to the top.
        if len(query) >= 2:
            lowered = query.lower()

            def rank(item):
                name = str(item.get('customer_name') or '').lower()
                number = str(item.get('customer_number') or '').lower()
                phone = normalize_phone_digits(item.get('customer_phone'))
                score = 0
                if number and lowered == number:
                    score += 300
                if name and lowered == name:
                    score += 200
                if name.startswith(lowered):
                    score += 120
                if number.startswith(lowered):
                    score += 90
                if query_digits and phone and phone.startswith(query_digits):
                    score += 80
                if lowered in name:
                    score += 40
                return score

            customers.sort(key=lambda c: (rank(c), c.get('last_updated') or ''), reverse=True)
            customers = customers[:limit]

        conn.close()

        return jsonify({
            'success': True,
            'customers': customers,
            'count': len(customers)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@customers_bp.route('/api/customers/profile', methods=['GET'])
def get_customer_profile():
    """Return customer profile details with full order history."""
    try:
        profile_id = request.args.get('customer_profile_id', type=int)
        customer_number = request.args.get('customer_number', '').strip()
        name = request.args.get('name', '').strip()
        phone = request.args.get('phone', '').strip()

        conn = get_db_connection()
        row = None

        if profile_id:
            row = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (profile_id,)).fetchone()
        elif customer_number:
            row = conn.execute(
                "SELECT * FROM customer_profiles WHERE customer_number = ? ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1",
                (customer_number,),
            ).fetchone()
        elif name:
            row = conn.execute(
                "SELECT * FROM customer_profiles WHERE LOWER(TRIM(customer_name)) = LOWER(?) ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1",
                (name,),
            ).fetchone()

        order_clauses = []
        order_params = []

        if row:
            profile = dict_from_row(row)
        else:
            # Fallback: infer from orders when profile row does not yet exist.
            if not (name or phone or customer_number):
                conn.close()
                return jsonify({'success': False, 'error': 'Profile identifier required'}), 400

            if customer_number:
                order_clauses.append("COALESCE(customer_number, '') = ?")
                order_params.append(customer_number)
            if name:
                order_clauses.append("LOWER(TRIM(customer_name)) = LOWER(?)")
                order_params.append(name)
            if phone:
                order_clauses.append("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?")
                order_params.append(normalize_phone_digits(phone))

            order_rows = conn.execute(
                f"""
                SELECT *
                  FROM orders
                 WHERE {' OR '.join(order_clauses)}
                 ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
                 LIMIT 200
                """,
                order_params,
            ).fetchall()

            if not order_rows:
                conn.close()
                return jsonify({'success': False, 'error': 'Customer profile not found'}), 404

            latest = dict_from_row(order_rows[0])
            inferred_payload = {
                'customer_name': latest.get('customer_name'),
                'customer_phone': latest.get('customer_phone'),
                'customer_email': latest.get('customer_email'),
                'customer_number': latest.get('customer_number'),
            }
            persisted_profile_id = upsert_customer_profile(conn, inferred_payload)
            row = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (persisted_profile_id,)).fetchone()
            profile = dict_from_row(row) if row else {
                'id': persisted_profile_id,
                'customer_name': latest.get('customer_name'),
                'customer_phone': latest.get('customer_phone'),
                'customer_email': latest.get('customer_email'),
                'customer_number': latest.get('customer_number'),
                'default_project_notes': None,
                'created_at': latest.get('created_at'),
                'updated_at': latest.get('updated_at'),
            }

        if profile.get('id'):
            order_clauses.append("customer_profile_id = ?")
            order_params.append(profile['id'])
        if profile.get('customer_number'):
            order_clauses.append("COALESCE(customer_number, '') = ?")
            order_params.append(profile['customer_number'])
        if profile.get('customer_name'):
            order_clauses.append("LOWER(TRIM(customer_name)) = LOWER(?)")
            order_params.append(profile['customer_name'])
        if profile.get('customer_phone'):
            order_clauses.append("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?")
            order_params.append(normalize_phone_digits(profile['customer_phone']))

        order_rows = conn.execute(
            f"""
            SELECT *
              FROM orders
             WHERE {' OR '.join(order_clauses)}
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
             LIMIT 200
            """,
            order_params,
        ).fetchall()

        orders = [attach_po_display(dict_from_row(o)) for o in order_rows]
        conn.close()

        return jsonify({
            'success': True,
            'profile': profile,
            'orders': orders,
            'count': len(orders)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@customers_bp.route('/api/customers/profile', methods=['PUT'])
def update_customer_profile():
    """Update persisted customer profile fields such as default project notes."""
    try:
        data = request.get_json() or {}
        profile_id = data.get('customer_profile_id')

        if not profile_id:
            return jsonify({'success': False, 'error': 'customer_profile_id is required'}), 400

        conn = get_db_connection()
        existing = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (profile_id,)).fetchone()
        if not existing:
            conn.close()
            return jsonify({'success': False, 'error': 'Profile not found'}), 404

        update_fields = {}
        for field in ('customer_name', 'customer_phone', 'customer_email', 'customer_number', 'default_project_notes'):
            if field in data:
                update_fields[field] = data.get(field)

        if not update_fields:
            conn.close()
            return jsonify({'success': False, 'error': 'No valid profile fields provided'}), 400

        next_name = update_fields.get('customer_name', existing['customer_name'])
        next_phone = update_fields.get('customer_phone', existing['customer_phone'])
        next_number = update_fields.get('customer_number', existing['customer_number'])
        update_fields['profile_key'] = build_customer_profile_key(next_name, next_phone, next_number)
        update_fields['updated_at'] = datetime.now().isoformat()

        set_clause = ', '.join(f"{field} = ?" for field in update_fields.keys())
        values = list(update_fields.values()) + [profile_id]
        conn.execute(f"UPDATE customer_profiles SET {set_clause} WHERE id = ?", values)
        conn.commit()

        row = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (profile_id,)).fetchone()
        conn.close()

        return jsonify({'success': True, 'profile': dict_from_row(row)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
