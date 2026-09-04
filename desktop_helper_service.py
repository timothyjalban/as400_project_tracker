"""
Desktop Helper Service for Order Tracker Web App

This service runs locally and handles desktop operations that the web browser cannot:
- Opening IBM i Access Client Solutions (HOD files)
- Launching AS400 automation with order data
- Running quote/invoice/special order automation

Run this service alongside the web app to enable full automation.
Port: 5001 (separate from web app on 5000)
"""

import sys
import os
import json
import logging
import sqlite3
from pathlib import Path
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# AS400 automation lives in automation/ in this repo (vendored from the old
# desktop project). Put it on the path so its intra-package imports resolve.
_REPO_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_REPO_DIR))                 # so `from data.vendors` resolves
sys.path.insert(0, str(_REPO_DIR / "automation"))  # so `import launch_ibm` resolves

try:
    from launch_ibm import launch_ibm_with_details, append_delivery_line
    logger.info("Imported launch_ibm_with_details + append_delivery_line from automation/")
except ImportError as e:
    logger.error("Failed to import automation/launch_ibm.py: %s", e)
    sys.exit(1)

try:
    from data.vendors import COMMON_VENDORS
except Exception:
    COMMON_VENDORS = []

TRACE_ENV_VAR = 'OT_AUTOMATION_TRACE'
WEB_DB_PATH = Path(os.environ.get('ORDER_TRACKER_DB_PATH', str(_REPO_DIR / 'orders.db')))

INVALID_VENDOR_SKUS = {"1001", "1002", "1003", "2001", "2002", "2003"}

PLACEHOLDER_ACCOUNT_NUMBERS = {"na", "n/a", "none", "null", "n-a"}


def _is_real_account_number(value) -> bool:
    """Return True only when value is a non-placeholder account number."""
    text = str(value or '').strip()
    if not text:
        return False
    return text.lower() not in PLACEHOLDER_ACCOUNT_NUMBERS


def _normalize_vendor_name(value) -> str:
    text = str(value or '').strip().lower()
    return ''.join(ch for ch in text if ch.isalnum())


def _sanitize_vendor_sku(value) -> str:
    text = str(value or '').strip()
    if not text or text in INVALID_VENDOR_SKUS:
        return ''
    return text


VENDOR_SKU_BY_NAME = {
    _normalize_vendor_name(vendor.get('name')): _sanitize_vendor_sku(vendor.get('sku'))
    for vendor in COMMON_VENDORS
    if _normalize_vendor_name(vendor.get('name')) and _sanitize_vendor_sku(vendor.get('sku'))
}


def _resolve_vendor_sku_from_item(item) -> str:
    if not isinstance(item, dict):
        return ''

    for field in ('vendor_sku', 'vendorSku', 'sku'):
        sku = _sanitize_vendor_sku(item.get(field))
        if sku:
            return sku

    vendor_key = _normalize_vendor_name(item.get('vendor'))
    return VENDOR_SKU_BY_NAME.get(vendor_key, '') if vendor_key else ''


def _enrich_line_items_with_vendor_sku(line_items, vendor_sku=''):
    if not isinstance(line_items, list):
        return [], _sanitize_vendor_sku(vendor_sku)

    fallback_sku = _sanitize_vendor_sku(vendor_sku)
    enriched = []

    for raw_item in line_items:
        if not isinstance(raw_item, dict):
            enriched.append(raw_item)
            continue

        item = dict(raw_item)
        item_sku = _resolve_vendor_sku_from_item(item) or fallback_sku
        if item_sku:
            item['vendor_sku'] = item_sku
            item['vendorSku'] = item_sku
            item['sku'] = item_sku
            fallback_sku = fallback_sku or item_sku
        enriched.append(item)

    return enriched, fallback_sku


def _trace_enabled() -> bool:
    value = (os.environ.get(TRACE_ENV_VAR, '0') or '0').strip().lower()
    return value in ('1', 'true', 'yes', 'on')


def _trace(action: str, **fields) -> None:
    if not _trace_enabled():
        return

    serialized = {}
    for key, value in fields.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            serialized[key] = value
        elif isinstance(value, list):
            serialized[key] = f'list[{len(value)}]'
        elif isinstance(value, dict):
            serialized[key] = f'dict[{len(value)}]'
        else:
            serialized[key] = type(value).__name__

    logger.info('[TRACE] %s %s', action, json.dumps(serialized, ensure_ascii=True, sort_keys=True))


def _update_live_order_quote_fields(
    order_id: int,
    quote_number: str | None = None,
    quote_total: float | int | None = None,
    quote_date: str | None = None,
) -> None:
    """Persist captured quote fields into the live web-app database."""
    if not order_id:
        raise ValueError('order_id is required')

    cleaned_quote = str(quote_number or '').strip() if quote_number is not None else ''
    cleaned_date = str(quote_date or '').strip() if quote_date is not None else ''
    parsed_total = None
    if quote_total is not None:
        try:
            parsed_total = float(quote_total)
        except Exception as exc:
            raise ValueError(f'invalid quote_total: {quote_total!r}') from exc

    if not cleaned_quote and parsed_total is None:
        raise ValueError('at least one of quote_number or quote_total is required')

    updates = []
    params = []
    if cleaned_quote:
        updates.append('quote_number = ?')
        params.append(cleaned_quote)
    if parsed_total is not None:
        updates.append('quote_total = ?')
        params.append(parsed_total)
    if cleaned_date:
        updates.append('quote_date = ?')
        params.append(cleaned_date)
    updates.append('updated_at = ?')
    params.append(datetime.now().isoformat())
    params.append(int(order_id))

    with sqlite3.connect(WEB_DB_PATH, timeout=30) as conn:
        conn.execute("PRAGMA busy_timeout = 30000")
        cursor = conn.execute(
            f"UPDATE orders SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        if cursor.rowcount == 0:
            raise RuntimeError(f'Order {order_id} not found in {WEB_DB_PATH}')
        conn.commit()


def _update_live_order_invoice_fields(
    order_id: int,
    invoice_number: str | None = None,
    invoice_total: float | int | None = None,
    invoice_date: str | None = None,
) -> None:
    """Persist captured invoice fields into the live web-app database."""
    if not order_id:
        raise ValueError('order_id is required')

    cleaned_invoice = str(invoice_number or '').strip() if invoice_number is not None else ''
    cleaned_date = str(invoice_date or '').strip() if invoice_date is not None else ''
    parsed_total = None
    if invoice_total is not None:
        try:
            parsed_total = float(invoice_total)
        except Exception as exc:
            raise ValueError(f'invalid invoice_total: {invoice_total!r}') from exc

    if not cleaned_invoice and parsed_total is None:
        raise ValueError('at least one of invoice_number or invoice_total is required')

    updates = []
    params = []
    if cleaned_invoice:
        updates.append('invoice_number = ?')
        params.append(cleaned_invoice)
    if parsed_total is not None:
        updates.append('invoice_total = ?')
        params.append(parsed_total)
    if cleaned_date:
        updates.append('invoice_date = ?')
        params.append(cleaned_date)
    updates.append('updated_at = ?')
    params.append(datetime.now().isoformat())
    params.append(int(order_id))

    with sqlite3.connect(WEB_DB_PATH, timeout=30) as conn:
        conn.execute("PRAGMA busy_timeout = 30000")
        cursor = conn.execute(
            f"UPDATE orders SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        if cursor.rowcount == 0:
            raise RuntimeError(f'Order {order_id} not found in {WEB_DB_PATH}')
        conn.commit()


def _update_live_order_special_order_fields(
    order_id: int,
    special_order_number: str | None = None,
    special_order_total: float | int | None = None,
    special_order_date: str | None = None,
) -> None:
    """Persist captured special-order fields into Invoice Created fields in the live web-app database."""
    if not order_id:
        raise ValueError('order_id is required')

    cleaned_number = str(special_order_number or '').strip() if special_order_number is not None else ''
    cleaned_date = str(special_order_date or '').strip() if special_order_date is not None else ''
    parsed_total = None
    if special_order_total is not None:
        try:
            parsed_total = float(special_order_total)
        except Exception as exc:
            raise ValueError(f'invalid special_order_total: {special_order_total!r}') from exc

    if not cleaned_number and parsed_total is None:
        raise ValueError('at least one of special_order_number or special_order_total is required')

    updates = []
    params = []
    if cleaned_number:
        updates.append('invoice_number = ?')
        params.append(cleaned_number)
    if parsed_total is not None:
        updates.append('invoice_total = ?')
        params.append(parsed_total)
    if cleaned_date:
        updates.append('invoice_date = ?')
        params.append(cleaned_date)
    updates.append('stage = ?')
    params.append('INVOICE_CREATED')
    updates.append('updated_at = ?')
    params.append(datetime.now().isoformat())
    params.append(int(order_id))

    with sqlite3.connect(WEB_DB_PATH, timeout=30) as conn:
        conn.execute("PRAGMA busy_timeout = 30000")
        cursor = conn.execute(
            f"UPDATE orders SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        if cursor.rowcount == 0:
            raise RuntimeError(f'Order {order_id} not found in {WEB_DB_PATH}')
        conn.commit()

# Create Flask app
app = Flask(__name__)
CORS(app)  # Allow requests from web app on localhost:5000

# Health check endpoint
@app.route('/api/health', methods=['GET'])
def health_check():
    """Check if the service is running"""
    return jsonify({
        'status': 'running',
        'service': 'Order Tracker Desktop Helper',
        'version': '1.0.0'
    })

@app.route('/api/launch-quote', methods=['POST'])
def launch_quote():
    """Launch AS400 quote creation with order data"""
    try:
        data = request.get_json()
        
        # Extract required fields
        customer = (data.get('customer_name') or '').strip()
        phone = (data.get('customer_phone') or '').strip()
        
        if not customer or not phone:
            return jsonify({
                'success': False,
                'error': 'Customer name and phone are required'
            }), 400
        
        # Extract optional fields
        job_name = (data.get('project_name') or '').strip()
        quote_number = (data.get('quote_number') or '').strip()
        size = (data.get('size') or '').strip()
        jamb = (data.get('jamb') or '').strip()
        color = (data.get('color') or '').strip()
        location = 'Felton'
        customer_number = (data.get('customer_number') or '').strip()
        has_account = bool(data.get('has_customer_account', False)) and _is_real_account_number(customer_number)
        line_items = data.get('line_items', [])
        vendor_sku = data.get('vendor_sku', '')
        line_items, vendor_sku = _enrich_line_items_with_vendor_sku(line_items, vendor_sku)
        as400_row_plan = data.get('as400_row_plan') or None
        needs_prefit = data.get('needs_prefit', False)
        prefit_meta = data.get('prefit_meta', None)
        
        logger.info(f"Launching quote for customer: {customer}, phone: {phone}, location: {location}")
        _trace(
            'launch-quote',
            order_id=data.get('order_id'),
            quote_number=quote_number,
            has_account=bool(has_account),
            has_customer_number=bool(customer_number),
            line_items_count=len(line_items) if isinstance(line_items, list) else 0,
            has_vendor_sku=bool(str(vendor_sku or '').strip()),
            first_line_vendor=(
                line_items[0].get('vendor')
                if isinstance(line_items, list) and line_items and isinstance(line_items[0], dict)
                else ''
            ),
            first_line_has_sku=(
                bool(str(line_items[0].get('vendor_sku') or line_items[0].get('sku') or '').strip())
                if isinstance(line_items, list) and line_items and isinstance(line_items[0], dict)
                else False
            ),
            needs_prefit=bool(needs_prefit),
            location=location,
        )
        
        # Create a cancelled flag object (mimics desktop app's self.cancelled)
        class CancelledFlag:
            value = False
            def __bool__(self):
                return self.value
        cancelled = CancelledFlag()
        
        # Call the desktop app's launch function - it now returns the captured quote number
        result = launch_ibm_with_details(
            customer=customer,
            phone=phone,
            job_name=job_name,
            quote_number=quote_number,
            size=size,
            jamb=jamb,
            color=color,
            script="quote",
            cancelled=bool(cancelled),
            location=location,
            customer_number=customer_number,
            has_account=has_account,
            line_items=line_items,
            vendor_sku=vendor_sku,
            needs_prefit=needs_prefit,
            prefit_meta=prefit_meta,
            as400_row_plan=as400_row_plan,
        )
        
        # Check if quote fields were captured
        captured_quote = None
        captured_total = None
        captured_date = None

        if isinstance(result, dict):
            captured_quote = str(result.get('quote_number') or '').strip() or None
            total_value = result.get('quote_total')
            if total_value is not None:
                try:
                    captured_total = float(total_value)
                except Exception:
                    captured_total = None
        elif result not in (True, False, None):
            logger.warning("Unexpected launch-quote result type: %s", type(result).__name__)

        if captured_quote:
            logger.info(f"Quote number captured from AS400: {captured_quote}")

        if captured_total is not None:
            logger.info(f"Quote total captured from AS400: {captured_total:.2f}")

        if captured_quote or captured_total is not None:
            captured_date = datetime.now().date().isoformat()
            
            # Update the order in database if we have an order_id
        order_id = data.get('order_id')
        if order_id and (captured_quote or captured_total is not None):
            try:
                _update_live_order_quote_fields(
                    int(order_id),
                    captured_quote,
                    captured_total,
                    captured_date,
                )
                logger.info(
                    "Updated live order %s with captured quote fields: quote_number=%r quote_total=%r quote_date=%r",
                    order_id,
                    captured_quote,
                    captured_total,
                    captured_date,
                )
            except Exception as db_err:
                logger.error(f"Failed to update order with captured quote fields: {db_err}")
        
        return jsonify({
            'success': True,
            'message': f'AS400 quote automation launched for {customer}',
            'location': location,
            'captured_quote_number': captured_quote,
            'captured_quote_total': captured_total,
            'captured_quote_date': captured_date,
        })
        
    except Exception as e:
        logger.error(f"Error launching quote: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/launch-invoice', methods=['POST'])
def launch_invoice():
    """Launch AS400 invoice creation with order data"""
    try:
        data = request.get_json()
        
        customer = (data.get('customer_name') or '').strip()
        phone = (data.get('customer_phone') or '').strip()
        
        if not customer or not phone:
            return jsonify({
                'success': False,
                'error': 'Customer name and phone are required'
            }), 400
        
        job_name = (data.get('project_name') or '').strip()
        quote_or_invoice_number = (data.get('quote_number') or data.get('invoice_number') or '').strip()
        order_stage = (data.get('stage') or '').strip()
        customer_number = (data.get('customer_number') or '').strip()
        has_account = bool(data.get('has_customer_account', False)) and _is_real_account_number(customer_number)
        line_items = data.get('line_items', [])
        as400_row_plan = data.get('as400_row_plan') or None
        vendor_sku = (data.get('vendor_sku') or '').strip()
        line_items, vendor_sku = _enrich_line_items_with_vendor_sku(line_items, vendor_sku)
        size = (data.get('size') or '').strip()
        jamb = (data.get('jamb') or '').strip()
        color = (data.get('color') or '').strip()
        location = 'Felton'
        
        logger.info(f"Launching invoice for customer: {customer}, phone: {phone}")
        _trace(
            'launch-invoice',
            order_id=data.get('order_id'),
            document_number=quote_or_invoice_number,
            stage=order_stage,
            has_account=bool(has_account),
            has_customer_number=bool(customer_number),
            line_items_count=len(line_items) if isinstance(line_items, list) else 0,
            has_vendor_sku=bool(str(vendor_sku or '').strip()),
            first_line_vendor=(
                line_items[0].get('vendor')
                if isinstance(line_items, list) and line_items and isinstance(line_items[0], dict)
                else ''
            ),
            first_line_has_sku=(
                bool(str(line_items[0].get('vendor_sku') or line_items[0].get('sku') or '').strip())
                if isinstance(line_items, list) and line_items and isinstance(line_items[0], dict)
                else False
            ),
            location=location,
        )
        
        class CancelledFlag:
            value = False
            def __bool__(self):
                return self.value
        cancelled = CancelledFlag()
        
        result = launch_ibm_with_details(
            customer=customer,
            phone=phone,
            job_name=job_name,
            quote_number=quote_or_invoice_number,
            size=size,
            jamb=jamb,
            color=color,
            script="charge_sale",
            cancelled=bool(cancelled),
            location=location,
            customer_number=customer_number,
            has_account=has_account,
            order_stage=order_stage,
            line_items=line_items,
            vendor_sku=vendor_sku,
            as400_row_plan=as400_row_plan,
        )

        captured_invoice = None
        captured_total = None
        captured_date = None

        if isinstance(result, dict):
            captured_invoice = str(
                result.get('invoice_number')
                or result.get('quote_number')
                or ''
            ).strip() or None
            total_value = result.get('invoice_total')
            if total_value is not None:
                try:
                    captured_total = float(total_value)
                except Exception:
                    captured_total = None
        elif result not in (True, False, None):
            logger.warning("Unexpected launch-invoice result type: %s", type(result).__name__)

        if captured_invoice:
            logger.info("Invoice number captured from AS400: %s", captured_invoice)

        if captured_total is not None:
            logger.info("Invoice total captured from AS400: %.2f", captured_total)

        if captured_invoice or captured_total is not None:
            captured_date = datetime.now().date().isoformat()

        order_id = data.get('order_id')
        if order_id and (captured_invoice or captured_total is not None):
            try:
                _update_live_order_invoice_fields(
                    int(order_id),
                    captured_invoice,
                    captured_total,
                    captured_date,
                )
                logger.info(
                    "Updated live order %s with captured invoice fields: invoice_number=%r invoice_total=%r invoice_date=%r",
                    order_id,
                    captured_invoice,
                    captured_total,
                    captured_date,
                )
            except Exception as db_err:
                logger.error("Failed to update order with captured invoice fields: %s", db_err)
        
        return jsonify({
            'success': True,
            'message': f'AS400 invoice automation launched for {customer}',
            'location': location,
            'captured_invoice_number': captured_invoice,
            'captured_invoice_total': captured_total,
            'captured_invoice_date': captured_date,
        })
        
    except Exception as e:
        logger.error(f"Error launching invoice: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/launch-special-order', methods=['POST'])
def launch_special_order():
    """Launch AS400 special order creation with order data"""
    try:
        data = request.get_json()
        
        customer = (data.get('customer_name') or '').strip()
        phone = (data.get('customer_phone') or '').strip()
        
        if not customer or not phone:
            return jsonify({
                'success': False,
                'error': 'Customer name and phone are required'
            }), 400
        
        job_name = (data.get('project_name') or '').strip()
        quote_or_invoice_number = (data.get('quote_number') or data.get('invoice_number') or '').strip()
        location = 'Felton'

        if not quote_or_invoice_number:
            return jsonify({
                'success': False,
                'error': 'Quote or invoice number is required'
            }), 400
        
        logger.info(f"Launching special order for customer: {customer}, phone: {phone}")
        _trace(
            'launch-special-order',
            order_id=data.get('order_id'),
            document_number=quote_or_invoice_number,
            location=location,
        )
        
        class CancelledFlag:
            value = False
            def __bool__(self):
                return self.value
        cancelled = CancelledFlag()
        
        result = launch_ibm_with_details(
            customer=customer,
            phone=phone,
            job_name=job_name,
            quote_number=quote_or_invoice_number,
            size="",
            jamb="",
            color="",
            script="special_order",
            cancelled=bool(cancelled),
            location=location,
        )

        captured_special_order = None
        captured_total = None
        captured_date = None

        if isinstance(result, dict):
            captured_special_order = str(
                result.get('special_order_number')
                or result.get('invoice_number')
                or result.get('quote_number')
                or ''
            ).strip() or None
            total_value = result.get('special_order_total')
            if total_value is not None:
                try:
                    captured_total = float(total_value)
                except Exception:
                    captured_total = None
        elif result not in (True, False, None):
            logger.warning("Unexpected launch-special-order result type: %s", type(result).__name__)

        if captured_special_order:
            logger.info("Special order number captured from AS400: %s", captured_special_order)

        if captured_total is not None:
            logger.info("Special order total captured from AS400: %.2f", captured_total)

        if captured_special_order or captured_total is not None:
            captured_date = datetime.now().date().isoformat()

        order_id = data.get('order_id')
        if order_id and (captured_special_order or captured_total is not None):
            try:
                _update_live_order_special_order_fields(
                    int(order_id),
                    captured_special_order,
                    captured_total,
                    captured_date,
                )
                logger.info(
                    "Updated live order %s with captured special-order fields: number=%r total=%r date=%r",
                    order_id,
                    captured_special_order,
                    captured_total,
                    captured_date,
                )
            except Exception as db_err:
                logger.error("Failed to update order with captured special-order fields: %s", db_err)
        
        return jsonify({
            'success': True,
            'message': f'AS400 special order automation launched for {customer}',
            'location': location,
            'captured_special_order_number': captured_special_order,
            'captured_special_order_total': captured_total,
            'captured_special_order_date': captured_date,
        })
        
    except Exception as e:
        logger.error(f"Error launching special order: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/launch-delivery-quote', methods=['POST'])
def launch_delivery_quote():
    """Create a standalone AS400 quote that contains only the delivery line.

    Used when delivery was missed on the original quote - a separate ticket.
    """
    try:
        data = request.get_json() or {}
        customer = (data.get('customer_name') or '').strip()
        phone = (data.get('customer_phone') or '').strip()
        if not customer or not phone:
            return jsonify({'success': False, 'error': 'Customer name and phone are required'}), 400

        customer_number = (data.get('customer_number') or '').strip()
        has_account = bool(data.get('has_customer_account', False)) and _is_real_account_number(customer_number)
        # Ctrl+Alt+D is self-contained - the macro types SKU 040619 / qty 1 /
        # price $125 itself, so this line just needs the is_delivery marker.
        delivery_item = {'is_delivery': True, 'no_cost': False, 'as400_comment_authoritative': True, 'notes': ''}
        _trace('launch-delivery-quote', order_id=data.get('order_id'))

        class CancelledFlag:
            value = False
            def __bool__(self):
                return self.value

        result = launch_ibm_with_details(
            customer=customer,
            phone=phone,
            job_name=(data.get('project_name') or '').strip(),
            quote_number=(data.get('quote_number') or '').strip(),
            size='', jamb='', color='',
            script='quote',
            cancelled=bool(CancelledFlag()),
            location='Felton',
            customer_number=customer_number,
            has_account=has_account,
            line_items=[delivery_item],
            vendor_sku='040619',
        )
        captured_quote = None
        if isinstance(result, dict):
            captured_quote = str(result.get('quote_number') or '').strip() or None
        return jsonify({
            'success': True,
            'message': f'AS400 delivery quote launched for {customer}',
            'captured_quote_number': captured_quote,
        })
    except Exception as e:
        logger.error(f"Error launching delivery quote: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/add-delivery', methods=['POST'])
def add_delivery():
    """Add ONE delivery line (Ctrl+Alt+D) to the quote/order already open on
    screen - "add delivery at the very end after all the items"."""
    try:
        data = request.get_json() or {}
        _trace('add-delivery', order_id=data.get('order_id'))
        append_delivery_line()
        return jsonify({'success': True, 'message': 'Delivery line added via Ctrl+Alt+D'})
    except Exception as e:
        logger.error(f"Error adding delivery line: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 500


# Endpoint to open an existing quote
@app.route('/api/open-quote', methods=['POST'])
def open_quote():
    """Open an existing quote in AS400"""
    try:
        data = request.get_json()
        quote_number = (data.get('quote_number') or '').strip()

        if not quote_number:
            return jsonify({
                'success': False,
                'error': 'Quote number is required'
            }), 400

        logger.info(f"Opening quote with number: {quote_number}")
        _trace('open-quote', quote_number=quote_number, location='Felton')

        # Call the desktop app's launch function for opening a quote
        launch_ibm_with_details(
            customer='',
            phone='',
            job_name='',
            quote_number=quote_number,
            size='',
            jamb='',
            color='',
            script="open_quote",
            location='Felton'
        )

        return jsonify({
            'success': True,
            'message': f'Quote {quote_number} opened successfully'
        })

    except Exception as e:
        logger.error(f"Error opening quote: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Endpoint to open an existing invoice
@app.route('/api/open-invoice', methods=['POST'])
def open_invoice():
    """Open an existing invoice in AS400"""
    try:
        data = request.get_json()
        invoice_number = (data.get('invoice_number') or '').strip()

        if not invoice_number:
            return jsonify({
                'success': False,
                'error': 'Invoice number is required'
            }), 400

        logger.info(f"Opening invoice with number: {invoice_number}")
        _trace('open-invoice', invoice_number=invoice_number, location='Felton')

        # Call the desktop app's launch function for opening an invoice
        launch_ibm_with_details(
            customer='',
            phone='',
            job_name='',
            quote_number=invoice_number,
            size='',
            jamb='',
            color='',
            script="open_charge_sale",
            location='Felton'
        )

        return jsonify({
            'success': True,
            'message': f'Invoice {invoice_number} opened successfully'
        })

    except Exception as e:
        logger.error(f"Error opening invoice: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Endpoint to open an existing special order
@app.route('/api/open-special-order', methods=['POST'])
def open_special_order():
    """Open an existing special order in AS400"""
    try:
        data = request.get_json()
        order_number = (data.get('order_number') or data.get('invoice_number') or '').strip()

        if not order_number:
            return jsonify({
                'success': False,
                'error': 'Special order number is required (order_number or invoice_number)'
            }), 400

        logger.info(f"Opening special order with number: {order_number}")
        _trace('open-special-order', order_number=order_number, location='Felton')

        # Call the desktop app's launch function for opening a special order
        launch_ibm_with_details(
            customer='',
            phone='',
            job_name='',
            quote_number=order_number,
            size='',
            jamb='',
            color='',
            script="open_special_order",
            location='Felton'
        )

        return jsonify({
            'success': True,
            'message': f'Special order {order_number} opened successfully'
        })

    except Exception as e:
        logger.error(f"Error opening special order: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    print("=" * 70)
    print("Order Tracker Desktop Helper Service")
    print("=" * 70)
    print(f"Automation Path: {_REPO_DIR / 'automation'}")
    print(f"Starting service on http://localhost:5001")
    print(f"Web app should be running on http://localhost:5000")
    print()
    print("This service enables:")
    print("  - AS400/HOD file automation from web browser")
    print("  - Quote/Invoice/Special Order creation")
    print("  - Desktop operations that browsers cannot perform")
    print()
    print("Keep this window open while using the web app.")
    print("Press CTRL+C to stop the service.")
    print("=" * 70)
    print()
    
    app.run(
        host='127.0.0.1',
        port=5001,
        debug=True,
        use_reloader=False  # Avoid double startup in debug mode
    )
