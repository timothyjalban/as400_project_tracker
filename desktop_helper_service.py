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
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

# Add the desktop app's directory to Python path to import its modules
DESKTOP_APP_PATH = Path(r"C:\Projects\Order-Tracker")
sys.path.insert(0, str(DESKTOP_APP_PATH))

try:
    from scripts.launch_ibm import launch_ibm_with_details
    from data.database import update_order  # Import database function
    print("✅ Successfully imported launch_ibm_with_details from desktop app")
except ImportError as e:
    print(f"❌ Failed to import launch_ibm module: {e}")
    print(f"   Make sure desktop app is at: {DESKTOP_APP_PATH}")
    sys.exit(1)

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
TRACE_ENV_VAR = 'OT_AUTOMATION_TRACE'


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
        has_account = data.get('has_customer_account', False)
        line_items = data.get('line_items', [])
        vendor_sku = data.get('vendor_sku', '')
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
        )
        
        # Check if a quote number was captured
        captured_quote = None
        if isinstance(result, str) and result:
            captured_quote = result
            logger.info(f"Quote number captured from AS400: {captured_quote}")
            
            # Update the order in database if we have an order_id
            order_id = data.get('order_id')
            if order_id:
                try:
                    update_order(order_id, {'quote_number': captured_quote})
                    logger.info(f"Updated order {order_id} with quote number {captured_quote}")
                except Exception as db_err:
                    logger.error(f"Failed to update order with quote number: {db_err}")
        
        return jsonify({
            'success': True,
            'message': f'AS400 quote automation launched for {customer}',
            'location': location,
            'captured_quote_number': captured_quote
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
        has_account = bool(data.get('has_customer_account', False))
        line_items = data.get('line_items', [])
        vendor_sku = (data.get('vendor_sku') or '').strip()
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
            location=location,
        )
        
        class CancelledFlag:
            value = False
            def __bool__(self):
                return self.value
        cancelled = CancelledFlag()
        
        launch_ibm_with_details(
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
        )
        
        return jsonify({
            'success': True,
            'message': f'AS400 invoice automation launched for {customer}',
            'location': location
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
            document_number=quote_or_invoice_number,
            location=location,
        )
        
        class CancelledFlag:
            value = False
            def __bool__(self):
                return self.value
        cancelled = CancelledFlag()
        
        launch_ibm_with_details(
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
        
        return jsonify({
            'success': True,
            'message': f'AS400 special order automation launched for {customer}',
            'location': location
        })
        
    except Exception as e:
        logger.error(f"Error launching special order: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

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
    print("🖥️  Order Tracker Desktop Helper Service")
    print("=" * 70)
    print(f"Desktop App Path: {DESKTOP_APP_PATH}")
    print(f"Starting service on http://localhost:5001")
    print(f"Web app should be running on http://localhost:5000")
    print()
    print("This service enables:")
    print("  • AS400/HOD file automation from web browser")
    print("  • Quote/Invoice/Special Order creation")
    print("  • Desktop operations that browsers cannot perform")
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
