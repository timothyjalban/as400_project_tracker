"""Reminder endpoints: CRUD, complete, snooze, due."""
from __future__ import annotations

from datetime import datetime

from flask import Blueprint, jsonify, request

from core import dict_from_row, get_db_connection
from data.database import complete_reminder, insert_reminder, list_due_reminders, snooze_reminder

reminders_bp = Blueprint('reminders', __name__)


@reminders_bp.route('/api/reminders', methods=['GET'])
def get_reminders():
    """Get all reminders (optionally filter by done status)"""
    try:
        show_done = request.args.get('show_done', 'false').lower() == 'true'
        order_id = request.args.get('order_id', type=int)

        conn = get_db_connection()

        query = """
            SELECT r.*,
                   o.customer_name, o.project_name, o.po_number
            FROM reminders r
            LEFT JOIN orders o ON o.id = r.order_id
            WHERE 1=1
        """
        params = []

        if not show_done:
            query += " AND r.done = 0"

        if order_id:
            query += " AND r.order_id = ?"
            params.append(order_id)

        query += " ORDER BY r.due_at ASC"

        cursor = conn.execute(query, params)
        reminders = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()

        return jsonify({
            'success': True,
            'reminders': reminders,
            'count': len(reminders)
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reminders_bp.route('/api/reminders/<int:reminder_id>', methods=['GET'])
def get_reminder(reminder_id):
    """Get a single reminder"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("""
            SELECT r.*,
                   o.customer_name, o.project_name, o.po_number
            FROM reminders r
            LEFT JOIN orders o ON o.id = r.order_id
            WHERE r.id = ?
        """, (reminder_id,))
        row = cursor.fetchone()
        conn.close()

        if row:
            return jsonify({
                'success': True,
                'reminder': dict_from_row(row)
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Reminder not found'
            }), 404

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reminders_bp.route('/api/reminders', methods=['POST'])
def create_reminder():
    """Create a new reminder"""
    try:
        data = request.get_json()

        # Validate required fields
        if not data.get('title'):
            return jsonify({'success': False, 'error': 'Title is required'}), 400
        if not data.get('due_at'):
            return jsonify({'success': False, 'error': 'Due date is required'}), 400

        # Insert reminder using database function
        reminder_id = insert_reminder(
            order_id=data.get('order_id'),
            title=data['title'],
            due_iso=data['due_at'],
            repeat=data.get('repeat'),
            guest=data.get('guest')
        )

        return jsonify({
            'success': True,
            'reminder_id': reminder_id,
            'message': 'Reminder created successfully'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reminders_bp.route('/api/reminders/<int:reminder_id>', methods=['PUT'])
def update_reminder(reminder_id):
    """Update an existing reminder"""
    try:
        data = request.get_json()

        conn = get_db_connection()

        # Build UPDATE query dynamically based on provided fields
        fields = []
        params = []

        if 'title' in data:
            fields.append('title = ?')
            params.append(data['title'])

        if 'due_at' in data:
            fields.append('due_at = ?')
            params.append(data['due_at'])

        if 'repeat' in data:
            fields.append('repeat = ?')
            params.append(data['repeat'])

        if 'guest' in data:
            fields.append('guest = ?')
            params.append(data['guest'])

        if 'order_id' in data:
            fields.append('order_id = ?')
            params.append(data['order_id'])

        if not fields:
            conn.close()
            return jsonify({'success': False, 'error': 'No fields to update'}), 400

        # Add updated_at timestamp
        fields.append('updated_at = ?')
        params.append(datetime.now().isoformat())

        # Add reminder_id to params
        params.append(reminder_id)

        query = f"UPDATE reminders SET {', '.join(fields)} WHERE id = ?"
        conn.execute(query, params)
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Reminder updated successfully'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reminders_bp.route('/api/reminders/<int:reminder_id>', methods=['DELETE'])
def delete_reminder(reminder_id):
    """Delete a reminder"""
    try:
        conn = get_db_connection()
        conn.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
        conn.commit()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Reminder deleted successfully'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reminders_bp.route('/api/reminders/<int:reminder_id>/complete', methods=['PUT'])
def complete_reminder_endpoint(reminder_id):
    """Mark a reminder as complete"""
    try:
        complete_reminder(reminder_id)

        return jsonify({
            'success': True,
            'message': 'Reminder marked as complete'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reminders_bp.route('/api/reminders/<int:reminder_id>/snooze', methods=['PUT'])
def snooze_reminder_endpoint(reminder_id):
    """Snooze a reminder"""
    try:
        data = request.get_json()
        minutes = data.get('minutes', 30)  # Default 30 minutes

        snooze_reminder(reminder_id, minutes)

        return jsonify({
            'success': True,
            'message': f'Reminder snoozed for {minutes} minutes'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@reminders_bp.route('/api/reminders/due', methods=['GET'])
def get_due_reminders():
    """Get reminders that are currently due"""
    try:
        reminders = list_due_reminders()

        return jsonify({
            'success': True,
            'reminders': reminders,
            'count': len(reminders)
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
