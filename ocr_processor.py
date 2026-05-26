"""
OCR Processor for Web App
Handles PDF/image OCR processing and form parsing
"""

import os
import sys
import io
import json
import re
import tempfile
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
import pytesseract
import fitz  # PyMuPDF

# Configure Tesseract path
if os.path.exists(r'C:\Program Files\Tesseract-OCR\tesseract.exe'):
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

# Import the desktop app's parser
DESKTOP_APP_PATH = Path(r"C:\Projects\Order-Tracker")
sys.path.insert(0, str(DESKTOP_APP_PATH))

try:
    from intake_form_parser import IntakeFormParser
    from bulk_form_parser import BulkFormParser
except ImportError as e:
    print(f"Warning: Could not import parsers from desktop app: {e}")
    IntakeFormParser = None
    BulkFormParser = None


def prepare_image_for_ocr(image: Image.Image, photo_cleanup=True) -> Image.Image:
    """Prepare image for OCR (orientation, cleanup, upscale)"""
    # Fix orientation from EXIF
    try:
        image = ImageOps.exif_transpose(image)
    except Exception:
        pass
    
    # Convert to RGB if needed
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    
    # Photo cleanup for better OCR
    if photo_cleanup:
        image = cleanup_photo_for_ocr(image)
    
    # Upscale if too small
    image = upscale_for_ocr(image)
    
    return image


def cleanup_photo_for_ocr(image: Image.Image) -> Image.Image:
    """Improve noisy phone photos for better OCR"""
    try:
        grayscale = image.convert("L")
        denoised = grayscale.filter(ImageFilter.MedianFilter(size=3))
        contrasted = ImageEnhance.Contrast(denoised).enhance(1.8)
        sharpened = contrasted.filter(ImageFilter.UnsharpMask(radius=1.6, percent=180, threshold=3))
        normalized = ImageOps.autocontrast(sharpened)
        binary = normalized.point(lambda pixel: 255 if pixel > 150 else 0)
        return binary
    except Exception:
        return image


def upscale_for_ocr(image: Image.Image, min_width=1800) -> Image.Image:
    """Upscale small images to improve OCR"""
    try:
        if image.width < min_width:
            scale = min_width / float(image.width)
            new_size = (int(image.width * scale), int(image.height * scale))
            resampling = getattr(Image, "Resampling", Image)
            image = image.resize(new_size, resampling.BICUBIC)
    except Exception:
        pass
    return image


def ocr_image(image: Image.Image, language='eng') -> str:
    """Extract text from image using Tesseract"""
    try:
        prepared = prepare_image_for_ocr(image)
        text = pytesseract.image_to_string(prepared, lang=language)
        return text
    except Exception as e:
        print(f"OCR error: {e}")
        return ""


def ocr_pdf(pdf_path: str, page_num=None, language='eng') -> tuple[str, list]:
    """
    Extract text from PDF using OCR
    
    Returns:
        tuple: (all_text, list of page texts)
    """
    all_text = []
    page_texts = []
    
    try:
        doc = fitz.open(pdf_path)
        pages_to_process = [page_num] if page_num is not None else range(len(doc))
        
        for page_idx in pages_to_process:
            if page_idx >= len(doc):
                continue
                
            page = doc[page_idx]
            
            # Try native text extraction first
            native_text = page.get_text()
            if native_text and len(native_text.strip()) > 100:
                page_texts.append(native_text)
                all_text.append(native_text)
                continue
            
            # Fall back to OCR for scanned PDFs
            pix = page.get_pixmap(dpi=300)
            img_data = pix.tobytes("png")
            image = Image.open(io.BytesIO(img_data))
            
            ocr_text = ocr_image(image, language)
            page_texts.append(ocr_text)
            all_text.append(ocr_text)
        
        doc.close()
        
    except Exception as e:
        print(f"PDF OCR error: {e}")
        return "", []
    
    return "\n\n".join(all_text), page_texts


def process_intake_form_pdf(pdf_path: str) -> dict:
    """
    Process an order intake form PDF and extract structured data
    
    Returns:
        dict: Extracted order data
    """
    if not IntakeFormParser:
        return {'error': 'Form parser not available'}
    
    # Extract text from PDF
    all_text, _ = ocr_pdf(pdf_path)
    
    if not all_text or len(all_text.strip()) < 50:
        return {'error': 'Could not extract text from PDF'}
    
    # Parse the extracted text
    parser = IntakeFormParser(all_text)
    data = parser.parse()
    
    return data


def process_bulk_form_pdf(pdf_path: str) -> dict:
    """
    Process a bulk order form PDF and extract multiple orders
    
    Returns:
        dict: {'orders': list of order dicts}
    """
    if not BulkFormParser:
        return {'error': 'Bulk form parser not available'}
    
    # Extract text from PDF
    all_text, _ = ocr_pdf(pdf_path)
    
    if not all_text or len(all_text.strip()) < 50:
        return {'error': 'Could not extract text from PDF'}
    
    # Parse the extracted text
    parser = BulkFormParser(all_text)
    bulk_data = parser.parse()
    
    # Convert bulk form data to a single order
    # Bulk forms have ONE customer with multiple line items
    customer_info = bulk_data.get('customer_info', {})
    items = bulk_data.get('items', [])

    # If parser could not find usable data, use quote-style fallback extraction.
    if not customer_info.get('customer_name') and not items:
        fallback = _extract_quote_style_order(all_text)
        if fallback:
            return {'orders': [fallback]}
    
    # Create a single order dict
    order = {
        'customer_name': customer_info.get('customer_name', 'Bulk Order Customer'),
        'project_name': customer_info.get('project_name', 'Bulk Door/Window Order'),
        'stage': 'QUOTE_CREATED',
        'phone': customer_info.get('phone', ''),
        'email': customer_info.get('email', ''),
        'address': customer_info.get('address', ''),
        'product_type': bulk_data.get('product_type', 'door'),
        'notes': f"Bulk order with {len(items)} items\n\nImported from PDF via OCR"
    }
    
    # Add items as JSON in a field if available
    if items:
        order['bulk_items'] = json.dumps(items)
    
    return {'orders': [order]}


def _extract_first(pattern: str, text: str) -> str:
    match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
    if not match:
        return ""
    return (match.group(1) or "").strip()


def _extract_quote_style_order(text: str) -> dict:
    """Extract order fields from quote-style documents like Orepac quotes."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    lower_text = text.lower()

    customer_name = ""
    for pattern in [
        r"^(?:customer|sold\s*to|bill\s*to|ship\s*to|prepared\s*for|name)\s*[:\-]\s*(.+)$",
        r"^customer\s+name\s*[:\-]\s*(.+)$",
    ]:
        customer_name = _extract_first(pattern, text)
        if customer_name:
            break

    quote_number = ""
    for pattern in [
        r"\bquote\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9\-]{4,})",
        r"\bproposal\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9\-]{4,})",
        r"\border\s*(?:number|no\.?|#)?\s*[:#]?\s*([A-Z0-9\-]{4,})",
    ]:
        quote_number = _extract_first(pattern, text)
        if quote_number:
            break

    project_name = ""
    for pattern in [
        r"^(?:project|job\s*name|job\s*site)\s*[:\-]\s*(.+)$",
        r"^site\s*[:\-]\s*(.+)$",
    ]:
        project_name = _extract_first(pattern, text)
        if project_name:
            break

    phone = _extract_first(r"\b(?:phone|tel|telephone)\s*[:\-]?\s*([\(\)\d\-\.\s]{7,})", text)
    email = _extract_first(r"\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b", text)

    # If no labeled customer was found, try a simple heuristic on the first lines.
    if not customer_name and lines:
        for candidate in lines[:12]:
            lc = candidate.lower()
            if len(candidate) < 3 or len(candidate) > 80:
                continue
            if any(skip in lc for skip in [
                'quote', 'invoice', 'order', 'proposal', 'date', 'phone', 'email',
                'address', 'total', 'subtotal', 'orepac', 'page ', 'item'
            ]):
                continue
            if re.search(r"[A-Za-z]", candidate):
                customer_name = candidate
                break

    looks_like_quote = any(token in lower_text for token in ['quote', 'proposal', 'orepac', 'line item'])
    if not looks_like_quote:
        return {}

    if not customer_name:
        customer_name = 'Unknown Customer'
    if not project_name:
        project_name = 'Imported Quote'

    notes = [
        'Imported from quote PDF via OCR',
    ]
    if quote_number:
        notes.append(f'Extracted quote number: {quote_number}')

    return {
        'customer_name': customer_name,
        'project_name': project_name,
        'stage': 'QUOTE_CREATED',
        'phone': phone,
        'email': email,
        'product_type': 'door',
        'quote_number': quote_number,
        'notes': '\n'.join(notes),
    }

