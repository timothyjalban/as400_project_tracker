"""OCR endpoints: extract order data from uploaded PDF/image files."""
from __future__ import annotations

import os
import tempfile

from flask import Blueprint, jsonify, request

try:
    from ocr_processor import process_bulk_form_pdf, process_image_file, process_ocr_text, ocr_pdf
    HAS_OCR = True
    print("OCR processor loaded successfully")
except ImportError as e:
    HAS_OCR = False
    process_bulk_form_pdf = None
    process_image_file = None
    process_ocr_text = None
    ocr_pdf = None
    print(f"OCR processor not available: {e}")

ocr_bp = Blueprint('ocr', __name__)


@ocr_bp.route('/api/ocr/process-pdf', methods=['POST'])
def ocr_process_pdf():
    """Process a PDF file with OCR and extract text/data"""
    if not HAS_OCR:
        return jsonify({
            'success': False,
            'error': 'OCR functionality not available. Install pytesseract and Tesseract-OCR.'
        }), 500

    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file provided'
            }), 400

        file = request.files['file']

        if not file.filename:
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400

        if not file.filename.lower().endswith('.pdf'):
            return jsonify({
                'success': False,
                'error': 'Only PDF files are supported'
            }), 400

        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name

        try:
            # Extract text from PDF
            if ocr_pdf is None or process_bulk_form_pdf is None:
                return jsonify({
                    'success': False,
                    'error': 'OCR functionality not available. Install pytesseract and Tesseract-OCR.'
                }), 500

            all_text, page_texts = ocr_pdf(tmp_path)

            if not all_text or len(all_text.strip()) < 50:
                return jsonify({
                    'success': False,
                    'error': 'Could not extract sufficient text from PDF'
                }), 400

            # Try to parse as bulk form
            result = process_bulk_form_pdf(tmp_path)

            if 'error' in result:
                # Return raw text if parsing fails
                return jsonify({
                    'success': True,
                    'raw_text': all_text,
                    'page_count': len(page_texts),
                    'parsed': False,
                    'message': 'Text extracted but could not parse as order form'
                })

            return jsonify({
                'success': True,
                'parsed': True,
                'data': result,
                'raw_text': all_text,
                'page_count': len(page_texts)
            })

        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass

    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'OCR processing error: {str(e)}'
        }), 500

@ocr_bp.route('/api/ocr/process-file', methods=['POST'])
def ocr_process_file():
    """Process a PDF or image file with OCR and extract order data."""
    if not HAS_OCR:
        return jsonify({
            'success': False,
            'error': 'OCR functionality not available. Install pytesseract and Tesseract-OCR.'
        }), 500

    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file provided'
            }), 400

        file = request.files['file']
        filename = file.filename or ''
        if not filename:
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400

        ext = os.path.splitext(filename.lower())[1]
        supported_images = {'.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp'}
        if ext != '.pdf' and ext not in supported_images:
            return jsonify({
                'success': False,
                'error': 'Only PDF and image files are supported'
            }), 400

        with tempfile.NamedTemporaryFile(delete=False, suffix=ext or '.ocr') as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name

        try:
            if ext == '.pdf':
                if ocr_pdf is None or process_ocr_text is None:
                    return jsonify({
                        'success': False,
                        'error': 'OCR functionality not available. Install pytesseract and Tesseract-OCR.'
                    }), 500

                all_text, page_texts = ocr_pdf(tmp_path)
                result = process_ocr_text(all_text, source_label='PDF file')
                page_count = len(page_texts)
            else:
                if process_image_file is None:
                    return jsonify({
                        'success': False,
                        'error': 'Image OCR functionality not available. Install pytesseract, Pillow, and Tesseract-OCR.'
                    }), 500

                result = process_image_file(tmp_path)
                all_text = result.get('raw_text', '')
                page_count = result.get('page_count', 1)

            if not all_text or len(str(all_text).strip()) < 50:
                return jsonify({
                    'success': False,
                    'error': 'Could not extract sufficient text from file'
                }), 400

            if 'error' in result:
                return jsonify({
                    'success': True,
                    'raw_text': all_text,
                    'page_count': page_count,
                    'parsed': False,
                    'message': result.get('error') or 'Text extracted but could not parse as order form'
                })

            return jsonify({
                'success': True,
                'parsed': True,
                'data': result,
                'raw_text': all_text,
                'page_count': page_count
            })
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'OCR processing error: {str(e)}'
        }), 500
