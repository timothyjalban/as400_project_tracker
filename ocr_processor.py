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
import types
import importlib.util
import logging
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
import pytesseract
import fitz  # PyMuPDF

logger = logging.getLogger(__name__)

# Configure Tesseract path
if os.path.exists(r'C:\Program Files\Tesseract-OCR\tesseract.exe'):
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

# Form parsers + the headless OCR extractor, vendored into automation/ from the
# old desktop project.
DESKTOP_APP_PATH = Path(__file__).resolve().parent / "automation"
sys.path.insert(0, str(DESKTOP_APP_PATH))

try:
    from bulk_form_parser import BulkFormParser
    from intake_form_parser import IntakeFormParser
except ImportError as e:
    logger.warning("Could not import form parsers from automation/: %s", e)
    BulkFormParser = None
    IntakeFormParser = None


def _merge_text_passes(primary: str, alternate: str) -> str:
    """Merge OCR passes while removing duplicate lines."""
    merged = []
    seen = set()
    for block in (primary or "", alternate or ""):
        for line in block.splitlines():
            key = re.sub(r"\s+", " ", line.strip().lower())
            if not key:
                merged.append("")
                continue
            if key not in seen:
                seen.add(key)
                merged.append(line)
    return "\n".join(merged)


def _extract_schedule_bands(image: Image.Image, language: str) -> str:
    """OCR horizontal bands for table-heavy pages."""
    width, height = image.size
    if height < 240:
        return ""

    band_height = max(220, int(height * 0.16))
    overlap = int(band_height * 0.22)
    y = 0
    band_text = []
    band_cfg = "--oem 3 --psm 4 -c preserve_interword_spaces=1"

    while y < height:
        y2 = min(height, y + band_height)
        band = image.crop((0, y, width, y2))
        text = pytesseract.image_to_string(band, lang=language, config=band_cfg)
        if text and text.strip():
            band_text.append(text)
        if y2 >= height:
            break
        y = max(y + 1, y2 - overlap)

    return "\n".join(band_text)


def _extract_schedule_columns(image: Image.Image, language: str) -> str:
    """OCR left/right columns for side-by-side schedules."""
    width, height = image.size
    if width < 600 or height < 300:
        return ""

    crops = [
        (0, int(width * 0.55), "LEFT"),
        (int(width * 0.45), width, "RIGHT"),
    ]
    cfgs = [
        "--oem 3 --psm 6 -c preserve_interword_spaces=1",
        "--oem 3 --psm 4 -c preserve_interword_spaces=1",
    ]

    column_text = []
    for x1, x2, label in crops:
        crop = image.crop((x1, 0, x2, height))
        for cfg in cfgs:
            text = pytesseract.image_to_string(crop, lang=language, config=cfg)
            if text and text.strip():
                column_text.append(f"--- {label} TABLE ---\n{text}")

    return "\n".join(column_text)


def _ocr_image_robust(image: Image.Image, language='eng') -> str:
    """Run robust multi-pass OCR similar to desktop tool behavior."""
    primary_cfg = "--oem 3 --psm 6 -c preserve_interword_spaces=1"
    alternate_cfg = "--oem 3 --psm 11 -c preserve_interword_spaces=1"
    table_cfg = "--oem 3 --psm 4 -c preserve_interword_spaces=1"

    primary = pytesseract.image_to_string(image, lang=language, config=primary_cfg)
    alternate = pytesseract.image_to_string(image, lang=language, config=alternate_cfg)
    merged = _merge_text_passes(primary, alternate)

    schedule_hint = re.search(r'\b(window|door)\s+schedule\b', merged, re.IGNORECASE)
    if schedule_hint:
        table_text = pytesseract.image_to_string(image, lang=language, config=table_cfg)
        band_text = _extract_schedule_bands(image, language)
        column_text = _extract_schedule_columns(image, language)
        merged = _merge_text_passes(merged, table_text)
        merged = _merge_text_passes(merged, band_text)
        merged = _merge_text_passes(merged, column_text)

    return merged or primary or alternate


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
        text = _ocr_image_robust(prepared, language=language)
        return text
    except Exception as e:
        logger.exception("OCR error")
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
        with fitz.open(pdf_path) as doc:
            pages_to_process = [page_num] if page_num is not None else range(len(doc))

            for page_idx in pages_to_process:
                if page_idx >= len(doc):
                    continue

                page = doc[page_idx]

                # Keep native text and OCR text, then merge both.
                native_text = page.get_text() or ""

                pix = page.get_pixmap(dpi=300)
                img_data = pix.tobytes("png")
                with Image.open(io.BytesIO(img_data)) as image:
                    ocr_text = ocr_image(image, language)
                merged_page_text = _merge_text_passes(native_text, ocr_text)
                page_texts.append(merged_page_text)
                all_text.append(merged_page_text)

    except Exception as e:
        logger.exception("PDF OCR error for %s", pdf_path)
        return "", []
    
    return "\n\n".join(all_text), page_texts




_DESKTOP_OCR_TOOL = None
_DESKTOP_OCR_LOAD_ATTEMPTED = False


def _install_pyqt_stubs_for_desktop_ocr() -> None:
    """Allow importing the desktop OCR module for parser methods without PyQt5 installed."""
    if 'PyQt5' in sys.modules:
        return

    class _QtStub:
        def __init__(self, *args, **kwargs):
            pass
        def __call__(self, *args, **kwargs):
            return _QtStub()
        def __getattr__(self, _name):
            return _QtStub()
        def __iter__(self):
            return iter(())
        def connect(self, *args, **kwargs):
            return None
        def emit(self, *args, **kwargs):
            return None
        def setVisible(self, *args, **kwargs):
            return None
        def setText(self, *args, **kwargs):
            return None
        def addWidget(self, *args, **kwargs):
            return None
        def addLayout(self, *args, **kwargs):
            return None
        def addItems(self, *args, **kwargs):
            return None
        def setToolTip(self, *args, **kwargs):
            return None
        def clicked(self, *args, **kwargs):
            return _QtStub()

    def _signal(*args, **kwargs):
        return _QtStub()

    pyqt5_mod = types.ModuleType('PyQt5')
    widgets_mod = types.ModuleType('PyQt5.QtWidgets')
    core_mod = types.ModuleType('PyQt5.QtCore')
    gui_mod = types.ModuleType('PyQt5.QtGui')

    for name in [
        'QApplication', 'QMainWindow', 'QWidget', 'QVBoxLayout', 'QHBoxLayout',
        'QPushButton', 'QLabel', 'QTextEdit', 'QFileDialog', 'QProgressBar',
        'QComboBox', 'QCheckBox', 'QSplitter', 'QGroupBox', 'QSpinBox',
        'QLineEdit', 'QTabWidget', 'QTableWidget', 'QTableWidgetItem',
        'QHeaderView', 'QDialog', 'QDialogButtonBox', 'QListWidget',
        'QListWidgetItem', 'QMessageBox', 'QAbstractItemView', 'QMenu',
    ]:
        setattr(widgets_mod, name, type(name, (_QtStub,), {}))

    core_mod.Qt = _QtStub()
    core_mod.QThread = type('QThread', (_QtStub,), {})
    core_mod.pyqtSignal = _signal
    core_mod.QSize = type('QSize', (_QtStub,), {})

    for name in ['QPixmap', 'QImage', 'QDragEnterEvent', 'QDropEvent', 'QFont', 'QTextCursor', 'QIcon', 'QColor']:
        setattr(gui_mod, name, type(name, (_QtStub,), {}))

    sys.modules['PyQt5'] = pyqt5_mod
    sys.modules['PyQt5.QtWidgets'] = widgets_mod
    sys.modules['PyQt5.QtCore'] = core_mod
    sys.modules['PyQt5.QtGui'] = gui_mod


def _load_desktop_ocr_tool():
    global _DESKTOP_OCR_TOOL, _DESKTOP_OCR_LOAD_ATTEMPTED
    if _DESKTOP_OCR_LOAD_ATTEMPTED:
        return _DESKTOP_OCR_TOOL
    _DESKTOP_OCR_LOAD_ATTEMPTED = True

    try:
        _install_pyqt_stubs_for_desktop_ocr()
        desktop_ocr_path = DESKTOP_APP_PATH / 'ocr_tool.py'
        if not desktop_ocr_path.exists():
            return None
        spec = importlib.util.spec_from_file_location('desktop_ocr_tool_headless', desktop_ocr_path)
        if not spec or not spec.loader:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _DESKTOP_OCR_TOOL = module.OCRTool.__new__(module.OCRTool)
        return _DESKTOP_OCR_TOOL
    except Exception as exc:
        logger.warning("Could not load desktop OCR extractor: %s", exc)
        _DESKTOP_OCR_TOOL = None
        return None


def _money_to_float(value):
    cleaned = re.sub(r'[^0-9.]', '', str(value or ''))
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _first_nonempty(*values):
    for value in values:
        if value is None:
            continue
        text_value = str(value).strip()
        if text_value:
            return text_value
    return ''


def _dedupe_desktop_line_items(items: list[dict]) -> list[dict]:
    # Vendor quote PDFs (Orepac especially) repeat every item 2-3x across a
    # clean text layer and one or more noisy re-OCR'd layers. Money strings
    # (commas, decimals) are the most OCR-corruption-prone field, so keying
    # dedup on price - as this used to - lets a single misread digit in a
    # noisy duplicate slip past matching and survive as its own entry with
    # missing fields. "Item N" is a short, OCR-robust token, so prefer it;
    # fall back to size+quantity (no price) only when no item_number is present.
    def _score(entry):
        return (
            len(str(entry.get('description') or ''))
            + (10 if entry.get('item_number') else 0)
            + sum(1 for k in ('jamb', 'rough_opening', 'item_price', 'model') if entry.get(k))
        )

    groups: list[dict] = []
    group_keys: list[tuple] = []

    for item in items:
        if not isinstance(item, dict):
            continue
        item_number = item.get('item_number')
        size_norm = re.sub(r'\s+', ' ', str(item.get('size') or '')).strip().lower()
        quantity = str(item.get('quantity') or '').strip()

        target_idx = None
        for idx, (g_item_number, g_size, g_qty) in enumerate(group_keys):
            if item_number and g_item_number:
                # Both sides have an explicit "Item N" number - that's the
                # authoritative signal. Two genuinely different items can
                # easily share the same size+quantity (e.g. two 1-off doors
                # both "2/8 x 8/0"), so never fall back to size+quantity
                # here or distinct items get wrongly merged into one.
                if item_number == g_item_number:
                    target_idx = idx
                    break
                continue
            if size_norm and quantity and size_norm == g_size and quantity == g_qty:
                target_idx = idx
                break

        if target_idx is None:
            groups.append(item)
            group_keys.append((item_number, size_norm, quantity))
            continue

        existing = groups[target_idx]
        if _score(item) > _score(existing):
            merged = dict(existing)
            merged.update({k: v for k, v in item.items() if v})
            groups[target_idx] = merged
        else:
            # Not the "winning" duplicate, but still backfill anything the
            # kept entry is missing so a field only present in this
            # duplicate isn't lost.
            for k, v in item.items():
                if v and not groups[target_idx].get(k):
                    groups[target_idx][k] = v
        if item_number and not group_keys[target_idx][0]:
            group_keys[target_idx] = (item_number, group_keys[target_idx][1], group_keys[target_idx][2])

    return groups


def _normalize_jamb_size_for_web(value: str) -> str:
    # The web editor's Jamb Size field is a <select> seeded with values like
    # "4 9/16" (no inch mark, space not hyphen) and only shows a value as
    # selected on an exact string match. Vendor OCR extraction formats it as
    # e.g. "4-9/16\"" - normalize to the app's own convention so imported
    # doors line up with the built-in dropdown options instead of appearing
    # unselected.
    text = str(value or '').strip()
    if not text:
        return ''
    text = text.rstrip('"').strip()
    text = text.replace('-', ' ')
    return re.sub(r'\s+', ' ', text).strip()


def _split_fractional_door_size(size: str) -> tuple[str, str]:
    match = re.search(r'\b(\d+/\d+)\s*x\s*(\d+/\d+)\b', str(size or ''), re.IGNORECASE)
    if match:
        return match.group(1), match.group(2)
    return '', ''


def _normalize_door_swing_for_tracker(value: str) -> str:
    text = str(value or '').strip()
    if not text:
        return ''
    compact = re.sub(r'[^a-z0-9]+', '', text.lower())
    if compact in {'lhis', 'rhis', 'lhos', 'rhos'}:
        return compact.upper()
    if 'lefthand' in compact and 'inswing' in compact:
        return 'LHIS'
    if 'righthand' in compact and 'inswing' in compact:
        return 'RHIS'
    if 'lefthand' in compact and 'outswing' in compact:
        return 'LHOS'
    if 'righthand' in compact and 'outswing' in compact:
        return 'RHOS'
    return text


def _map_desktop_line_item_to_web(item: dict, vendor: str, product_type: str) -> dict:
    item = item if isinstance(item, dict) else {}
    vendor_name = 'Orepac' if vendor.lower().startswith('ore') else vendor
    product_text = 'Window' if 'window' in product_type.lower() else 'Door'
    if str(item.get('product_type') or '').lower().startswith('add-on'):
        product_text = 'Door'

    # The web editor's "price" field is a per-unit price, so the vendor's
    # per-unit "Item Price" must win over the extended "Item Total"/line total.
    # It also renders in an <input type="number">, which silently blanks out
    # any value that isn't a bare parseable number - so strip the thousands
    # comma vendors format money with (e.g. "1,277.09" -> "1277.09").
    unit_price = _first_nonempty(item.get('item_price'), item.get('price'), item.get('unit_price'), item.get('line_total'), item.get('item_total'))
    unit_price = re.sub(r'[^\d.]', '', unit_price) if unit_price else unit_price
    operation = _first_nonempty(item.get('operation'), item.get('handing'), item.get('swing'))
    swing = _normalize_door_swing_for_tracker(_first_nonempty(item.get('swing'), item.get('handing'), operation))
    item_notes = _first_nonempty(item.get('description'), item.get('special_conditions'), item.get('notes'))

    # item.get('size') for Orepac-style quotes is the nominal callout (e.g.
    # "3/0 x 8/0"), not the true rough opening. Preserve it as a callout code
    # before letting the real Rough Opening measurement take priority for size/width/height.
    callout_match = re.search(r'(\d+)/(\d+)\s*[xX]\s*(\d+)/(\d+)', str(item.get('size') or ''))

    mapped = {
        'product': product_text,
        'type': product_text.lower(),
        'quantity': item.get('quantity') or 1,
        'vendor': vendor_name,
        'price': unit_price,
        'size': _first_nonempty(item.get('rough_opening'), item.get('finished_opening'), item.get('size')),
        'room': _first_nonempty(item.get('location'), item.get('special_conditions')),
        'series': _first_nonempty(item.get('model'), item.get('series'), item.get('product_line')),
        'model': _first_nonempty(item.get('model'), item.get('line_no'), item.get('item_number')),
        'style': _first_nonempty(item.get('door_style'), item.get('operation'), item.get('door_configuration')),
        'operation': operation,
        'swing': swing,
        'jamb_size': _normalize_jamb_size_for_web(_first_nonempty(item.get('jamb'), item.get('jamb_size'))),
        'thickness': item.get('thickness') or '',
        'material': _first_nonempty(item.get('material'), item.get('color')),
        'color': _first_nonempty(item.get('color'), item.get('ext_finish'), item.get('exterior_finish')),
        'glass': item.get('glass') or '',
        'hardware': item.get('hardware') or '',
        'boring': item.get('boring') or '',
        'special_notes': item_notes,
    }

    if callout_match:
        mapped['callout_size'] = ''.join(callout_match.groups())
        mapped['size_mode'] = 'callout' if not item.get('rough_opening') and not item.get('finished_opening') else 'rough_opening'

    frac_width, frac_height = _split_fractional_door_size(mapped['size'])
    if frac_width and frac_height:
        mapped['width'] = frac_width
        mapped['height'] = frac_height
    else:
        inch_size_match = re.search(r'(\d+(?:\s+\d+/\d+)?)\s*"?\s*[xX]\s*(\d+(?:\s+\d+/\d+)?)\s*"?', mapped['size'])
        if inch_size_match:
            mapped.setdefault('width', inch_size_match.group(1).strip())
            mapped.setdefault('height', inch_size_match.group(2).strip())
        else:
            size_match = re.search(r'\b(\d{1,3})\s*"?(?:\s*x\s*|\s+X\s+)(\d{1,3})\s*"?\b', mapped['size'], re.IGNORECASE)
            if size_match:
                mapped.setdefault('width', size_match.group(1))
                mapped.setdefault('height', size_match.group(2))

    if vendor_name.lower() == 'milgard':
        mapped['product'] = 'Window'
        mapped['type'] = 'window'
        mapped['fin_type'] = item.get('fin_type') or ''
        mapped['frame'] = item.get('frame') or ''
        if item.get('line_total'):
            mapped['price'] = item.get('line_total')
    elif vendor_name.lower() == 'orepac':
        mapped['product'] = 'Door'
        mapped['type'] = 'door'
        mapped['door_count'] = mapped.get('door_count') or 'Single'
        mapped['door_location'] = mapped.get('door_location') or 'Interior'
        if item.get('door_configuration'):
            mapped['style'] = item.get('door_configuration')
            mapped['config'] = item.get('door_configuration')

    return {key: value for key, value in mapped.items() if value not in (None, '')}


def _desktop_vendor_data_to_order(data: dict, source_label: str, raw_text: str = "") -> dict:
    if not isinstance(data, dict):
        return {}
    vendor = _first_nonempty(data.get('vendor'))
    vendor_lc = vendor.lower().replace(' ', '')
    if vendor_lc not in {'milgard', 'orepac'}:
        return {}

    quote_total = _money_to_float(data.get('quote_total'))
    quote_date = _normalize_us_date(data.get('quote_date') or '')
    customer_name = _first_nonempty(data.get('customer_name'), data.get('quote_name'))
    phone = _first_nonempty(data.get('phone'), data.get('customer_phone'))
    if vendor_lc == 'orepac':
        header_name, header_phone = _extract_orepac_header_customer([ln.strip() for ln in raw_text.splitlines() if ln.strip()])
        if header_name:
            customer_name = header_name
        if header_phone:
            phone = header_phone
    if customer_name:
        customer_name = re.sub(r'\s+\d{3}[-\s]?\d{3}[-\s]*$', '', customer_name).strip()
    product_type = _first_nonempty(data.get('product_type'), 'window' if vendor_lc == 'milgard' else 'door')

    raw_items = []
    if data.get('line_items'):
        try:
            parsed_items = json.loads(data.get('line_items'))
            if isinstance(parsed_items, list):
                raw_items = parsed_items
        except Exception:
            raw_items = []

    raw_items = _dedupe_desktop_line_items(raw_items)
    line_items = [_map_desktop_line_item_to_web(item, 'Orepac' if vendor_lc == 'orepac' else vendor, product_type) for item in raw_items]
    line_items = [item for item in line_items if item]

    notes = [f"Imported from {source_label} using desktop OCR extraction"]
    if data.get('document_type'):
        notes.append(f"Document type: {data.get('document_type')}")
    if data.get('customer_number'):
        notes.append(f"Customer #: {data.get('customer_number')}")

    order = {
        'customer_name': customer_name or 'Imported OCR Customer',
        'project_name': customer_name or _first_nonempty(data.get('project_name'), 'Imported Vendor Quote'),
        'stage': 'QUOTE_CREATED',
        'customer_phone': phone,
        'customer_email': data.get('email') or '',
        'product_type': product_type.lower(),
        'vendor': 'Orepac' if vendor_lc == 'orepac' else vendor,
        'quote_number': data.get('quote_number') or '',
        'quote_date': quote_date,
        'quote_total': quote_total,
        'po_numbers': data.get('po_number') or '',
        'notes': '\n'.join(notes),
    }

    if line_items:
        order['line_items'] = json.dumps(line_items)
    return order


def _extract_desktop_vendor_order(text: str, source_label: str = 'OCR document') -> dict:
    tool = _load_desktop_ocr_tool()
    if not tool:
        return {}
    try:
        data = tool.extract_vendor_quote_data(text, {})
        return _desktop_vendor_data_to_order(data, source_label, text)
    except Exception as exc:
        logger.warning("Desktop vendor OCR extraction warning: %s", exc)
        return {}


def _extract_milgard_quote_order(text: str, source_label: str = 'OCR document') -> dict:
    """Extract Milgard quote pages where each item appears as a repeated Line block."""
    lower_text = text.lower()
    if 'milgard' not in lower_text or 'quote number' not in lower_text:
        return {}

    line_pattern = re.compile(
        r'(?ms)^Line:[^\S\r\n]*(?P<line_no>\d+)[^\S\r\n]+Location:[^\S\r\n]*(?P<location>[^\n]*)\n'
        r'.*?(?=^Line:[^\S\r\n]*\d+[^\S\r\n]+Location:|^Quote Number:|\Z)'
    )

    items_by_line: dict[int, dict] = {}
    for match in line_pattern.finditer(text):
        block = match.group(0)
        line_no = int(match.group('line_no'))
        location = re.sub(r'\s+', ' ', match.group('location')).strip()

        def clean_inline(value: str) -> str:
            return re.split(r'\s+(?:Item Total|Line Total|Ratings|Screen|Energy Star)\s*:', str(value or ''), 1)[0].strip(' ,')

        quantity_text = _extract_first(r'^Quantity:\s*(\d+)', block)
        quantity = int(quantity_text) if str(quantity_text).isdigit() else 1
        model = clean_inline(_extract_first(r'\bModel\s*=\s*([^\n,]+)', block))
        rough_opening = clean_inline(_extract_first(r'\b(?:Size\s*=\s*)?RO:\s*((?:\d+(?:\s+\d+/\d+)?)\"?\s*x\s*(?:\d+(?:\s+\d+/\d+)?)\"?)', block))
        callout = clean_inline(_extract_first(r'\b(?:Size\s*=\s*)?(?:Call Out|Callout):\s*([^,\n]+)', block))
        net_frame = clean_inline(_extract_first(r'\b(?:Size\s*=\s*)?Net Frame:\s*((?:\d+(?:\s+\d+/\d+)?)\"?\s*x\s*(?:\d+(?:\s+\d+/\d+)?)\"?)', block))
        handing_raw = clean_inline(_extract_first(r'\bHanding\s*=\s*([^,\n]+)', block))
        if not handing_raw:
            all_handings = {clean_inline(value) for value in re.findall(r'\bHanding\s*=\s*([^,\n]+)', text) if clean_inline(value)}
            if len(all_handings) == 1:
                handing_raw = next(iter(all_handings))
        handing = handing_raw.upper() if handing_raw else ''
        if not handing and re.search(r'\b(?:half vent|single vent|sliding door)\b', model, re.IGNORECASE):
            handing = 'XO'
        line_total = _extract_money_after_label(block, 'Line Total')
        item_total = _extract_money_after_label(block, 'Item Total')
        price = line_total or item_total

        series = ''
        series_match = re.search(r'\b(V\d+\s+[A-Za-z ]+),\s*([^,\n]+),', block)
        if series_match:
            series = re.sub(r'\s+', ' ', series_match.group(1)).strip()

        color = ''
        ext_color = ''
        int_color = ''
        color_match = re.search(r'Ext\s+([^/\n,]+)\s*/\s*Int\s+([^,\n]+)', block, re.IGNORECASE)
        if color_match:
            ext_color = color_match.group(1).strip()
            int_color = color_match.group(2).strip()
            color = ext_color if ext_color.lower() == int_color.lower() else f"Ext {ext_color} / Int {int_color}"

        width = ''
        height = ''
        size_text = rough_opening or net_frame or callout
        size_match = re.search(r'(\d+(?:\s+\d+/\d+)?)"?\s*x\s*(\d+(?:\s+\d+/\d+)?)"?', size_text)
        if size_match:
            width = size_match.group(1).strip()
            height = size_match.group(2).strip()
        elif re.fullmatch(r'\d{4}', callout or ''):
            width = str((int(callout[0]) * 12) + int(callout[1]))
            height = str((int(callout[2]) * 12) + int(callout[3]))

        model_lc = model.lower()
        door_model_keywords = (
            'door',
            'inswing',
            'outswing',
            'swinging',
            'french',
            'patio',
        )
        product = 'Door' if any(keyword in model_lc for keyword in door_model_keywords) else 'Window'
        style = model
        panel = ''
        if product == 'Window' and model_lc in {'half vent', 'single vent'}:
            style = 'Sliding'
        if product == 'Door':
            panel_match = re.search(r'\b(one|two|three|four|five|six|\d+)\s+panel\b', model, re.IGNORECASE)
            if panel_match:
                panel_word = panel_match.group(1).lower()
                panel_number_map = {'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6'}
                panel_count = panel_number_map.get(panel_word, panel_word)
                panel = f"{panel_count} Panel"
        fin_type = _extract_first(r'\b(\d+\s+\d+/\d+\"?\s+Setback)\b', block)
        glass_text = block if re.search(r'\blow[-\s]?e\b|suncoat', block, re.IGNORECASE) else text
        argon_text = block if re.search(r'\bargon\b', block, re.IGNORECASE) else text
        tempered_text = block if re.search(r'\btempered\b', block, re.IGNORECASE) else text
        glass = 'Low-E' if re.search(r'\blow[-\s]?e\b|suncoat', glass_text, re.IGNORECASE) else ''
        argon = 'Argon' if re.search(r'\bargon\b', argon_text, re.IGNORECASE) else ''
        frame = 'Vinyl' if re.search(r'\bV250\b|\bV300\b|\bvinyl\b', block, re.IGNORECASE) else ''
        tempered_glass = bool(re.search(r'\btempered\b', tempered_text, re.IGNORECASE))
        size_mode = 'rough_opening' if rough_opening else ('net_size' if net_frame else ('callout' if callout else 'rough_opening'))
        door_swing = ''
        if product == 'Door':
            if re.search(r'\bright\b', handing_raw or '', re.IGNORECASE):
                door_swing = 'RHIS' if 'inswing' in model_lc else 'RHOS' if 'outswing' in model_lc else 'Right'
            elif re.search(r'\bleft\b', handing_raw or '', re.IGNORECASE):
                door_swing = 'LHIS' if 'inswing' in model_lc else 'LHOS' if 'outswing' in model_lc else 'Left'

        item = {
            'product': product,
            'type': product.lower(),
            'quantity': quantity,
            'vendor': 'Milgard',
            'price': price,
            'size_mode': size_mode,
            'size': rough_opening or net_frame or callout,
            'rough_opening': rough_opening,
            'net_frame': net_frame,
            'room': location,
            'series': series,
            'model': str(line_no),
            'style': style,
            'panel': panel,
            'panel_style': panel,
            'handing': handing_raw,
            'operation': handing if product == 'Window' else handing_raw,
            'swing': door_swing or handing,
            'color': color,
            'exterior_color': ext_color or color,
            'interior_color': int_color or color,
            'fin_type': fin_type,
            'frame': frame,
            'material': frame,
            'glass': glass,
            'argon': argon,
            'tempered_glass': tempered_glass,
            'callout_size': callout,
            'width': width,
            'height': height,
            'milgard_model': model,
        }
        items_by_line[line_no] = {key: value for key, value in item.items() if value not in (None, '')}

    if not items_by_line:
        return {}

    quote_number = _extract_first(r'\bQuote Number:\s*([A-Z0-9_\-]+)', text)
    quote_date = _normalize_us_date(_extract_first(r'\b(?:Created Date|Print Date):\s*([0-9/.-]+)', text))
    customer_name = _extract_first(r'\bQuote Name:\s*\n?\s*([^\n]+)', text)
    if not customer_name:
        customer_name = _extract_first(r'\bCustomer:\s*\n?\s*([^\n]+)', text)
    phone = _extract_first(r'(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})', customer_name)
    customer_name = customer_name.strip() or 'Imported Milgard Quote'
    quote_total = _money_to_float(_extract_first(r'\bMaterial Subtotal:\s*\$?([0-9,]+\.\d{2})', text))
    total_windows = _extract_first(r'\bTotal Windows:\s*(\d+)', text)
    total_doors = _extract_first(r'\bTotal Doors:\s*(\d+)', text)
    product_type = 'window + door' if int(total_doors or 0) > 0 else 'window'

    items = [items_by_line[key] for key in sorted(items_by_line)]
    notes = [
        f"Imported from {source_label} using Milgard quote extraction",
        f"Extracted {len(items)} quote line items",
    ]
    if total_windows:
        notes.append(f"Quote total windows: {total_windows}")
    if total_doors:
        notes.append(f"Quote total doors: {total_doors}")

    order = {
        'customer_name': customer_name,
        'project_name': customer_name,
        'stage': 'QUOTE_CREATED',
        'customer_phone': phone,
        'customer_email': '',
        'product_type': product_type,
        'vendor': 'Milgard',
        'quote_number': quote_number,
        'quote_date': quote_date,
        'quote_total': quote_total,
        'po_numbers': '',
        'notes': '\n'.join(notes),
        'line_items': json.dumps(items),
    }
    return {key: value for key, value in order.items() if value not in (None, '')}
def process_ocr_text(all_text: str, source_label: str = 'OCR document') -> dict:
    """Parse extracted OCR text with the same parser chain used by the desktop tool."""
    if not all_text or len(all_text.strip()) < 50:
        return {'error': 'Could not extract sufficient text from file'}

    milgard_quote_order = _extract_milgard_quote_order(all_text, source_label)
    if milgard_quote_order:
        return {'orders': [milgard_quote_order]}

    desktop_vendor_order = _extract_desktop_vendor_order(all_text, source_label)
    if desktop_vendor_order:
        return {'orders': [desktop_vendor_order]}

    bulk_data = {
        'customer_info': {},
        'product_type': 'door',
        'items': []
    }

    if BulkFormParser:
        try:
            bulk_data = BulkFormParser(all_text).parse()
        except Exception as parse_exc:
            logger.warning("BulkFormParser parse error: %s", parse_exc)

    if _bulk_parse_is_weak(bulk_data):
        details_order = _extract_orepac_details_order(all_text, source_label)
        if details_order:
            return {'orders': [details_order]}

    if _bulk_parse_is_weak(bulk_data) and IntakeFormParser:
        try:
            intake_data = IntakeFormParser(all_text).parse()
            fallback_order = _map_intake_parse_to_order(intake_data)
            if fallback_order:
                return {'orders': [fallback_order]}
        except Exception as parse_exc:
            logger.warning("IntakeFormParser parse error: %s", parse_exc)

    customer_info = bulk_data.get('customer_info', {})
    items = bulk_data.get('items', [])

    if not customer_info.get('customer_name') and not items:
        fallback = _extract_quote_style_order(all_text)
        if fallback:
            fallback['notes'] = str(fallback.get('notes') or '').replace('Imported from quote PDF via OCR', f'Imported from {source_label} via OCR')
            return {'orders': [fallback]}

    mapped_line_items = []
    for item in items:
        mapped_line_items.append({
            'product': 'Door',
            'quantity': item.get('quantity', ''),
            'width': item.get('width', ''),
            'height': item.get('height', ''),
            'size': f"{item.get('width', '')}x{item.get('height', '')}" if item.get('width') and item.get('height') else '',
            'config': item.get('config', ''),
            'jamb_size': item.get('jamb_size', ''),
            'swing': item.get('swing', ''),
            'hinges': item.get('hinges', ''),
            'boring': item.get('boring', ''),
            'sill_bottom': item.get('sill_bottom', ''),
            'color': item.get('color_finish', ''),
            'glass': item.get('glass_type', ''),
            'hardware': item.get('hardware', ''),
            'special_notes': item.get('special_notes', ''),
        })

    order = {
        'customer_name': customer_info.get('customer_name', 'Bulk Order Customer'),
        'project_name': customer_info.get('project_name', 'Bulk Door/Window Order'),
        'stage': 'QUOTE_CREATED',
        'customer_phone': customer_info.get('phone', ''),
        'customer_email': customer_info.get('email', ''),
        'address_street': customer_info.get('address', ''),
        'product_type': bulk_data.get('product_type', 'door'),
        'notes': f"Bulk order with {len(items)} items\n\nImported from {source_label} via OCR"
    }

    if mapped_line_items:
        order['line_items'] = json.dumps(mapped_line_items)

    return {'orders': [order]}


def process_image_file(image_path: str) -> dict:
    """OCR an image file and parse it into web order payloads."""
    try:
        with Image.open(image_path) as image:
            all_text = ocr_image(image)
    except Exception as exc:
        return {'error': f'Could not read image file: {exc}'}

    parsed = process_ocr_text(all_text, source_label='image file')
    parsed['raw_text'] = all_text
    parsed['page_count'] = 1
    return parsed

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
    
    # Parse with best available parser chain (desktop-style fallback order).
    bulk_data = {
        'customer_info': {},
        'product_type': 'door',
        'items': []
    }

    if BulkFormParser:
        try:
            bulk_data = BulkFormParser(all_text).parse()
        except Exception as parse_exc:
            logger.warning("BulkFormParser parse error: %s", parse_exc)

    if _bulk_parse_is_weak(bulk_data) and IntakeFormParser:
        try:
            intake_data = IntakeFormParser(all_text).parse()
            fallback_order = _map_intake_parse_to_order(intake_data)
            if fallback_order:
                return {'orders': [fallback_order]}
        except Exception as parse_exc:
            logger.warning("IntakeFormParser parse error: %s", parse_exc)
    
    # Convert bulk form data to a single order
    # Bulk forms have ONE customer with multiple line items
    customer_info = bulk_data.get('customer_info', {})
    items = bulk_data.get('items', [])

    # If parser could not find usable data, use quote-style fallback extraction.
    if not customer_info.get('customer_name') and not items:
        milgard_fallback = _extract_milgard_quote_order(all_text, 'PDF file')
        if milgard_fallback:
            return {'orders': [milgard_fallback]}
        fallback = _extract_quote_style_order(all_text)
        if fallback:
            return {'orders': [fallback]}
    
    # Map parser items into the order schema expected by /api/orders.
    mapped_line_items = []
    for item in items:
        mapped_line_items.append({
            'product': 'Door',
            'quantity': item.get('quantity', ''),
            'width': item.get('width', ''),
            'height': item.get('height', ''),
            'size': f"{item.get('width', '')}x{item.get('height', '')}" if item.get('width') and item.get('height') else '',
            'config': item.get('config', ''),
            'jamb_size': item.get('jamb_size', ''),
            'swing': item.get('swing', ''),
            'hinges': item.get('hinges', ''),
            'boring': item.get('boring', ''),
            'sill_bottom': item.get('sill_bottom', ''),
            'color': item.get('color_finish', ''),
            'glass': item.get('glass_type', ''),
            'hardware': item.get('hardware', ''),
            'special_notes': item.get('special_notes', ''),
        })

    # Create a single order dict
    order = {
        'customer_name': customer_info.get('customer_name', 'Bulk Order Customer'),
        'project_name': customer_info.get('project_name', 'Bulk Door/Window Order'),
        'stage': 'QUOTE_CREATED',
        'customer_phone': customer_info.get('phone', ''),
        'customer_email': customer_info.get('email', ''),
        'address_street': customer_info.get('address', ''),
        'product_type': bulk_data.get('product_type', 'door'),
        'notes': f"Bulk order with {len(items)} items\n\nImported from PDF via OCR"
    }

    if mapped_line_items:
        order['line_items'] = json.dumps(mapped_line_items)
    
    return {'orders': [order]}


def _bulk_parse_is_weak(bulk_data: dict) -> bool:
    """Return True when bulk parse likely failed to extract meaningful fields."""
    if not isinstance(bulk_data, dict):
        return True
    customer_info = bulk_data.get('customer_info') or {}
    items = bulk_data.get('items') or []
    has_customer = bool(str(customer_info.get('customer_name') or '').strip())
    has_items = isinstance(items, list) and len(items) > 0
    return not (has_customer or has_items)


def _map_intake_parse_to_order(intake_data: dict) -> dict:
    """Convert intake parser output into the order payload schema."""
    if not isinstance(intake_data, dict):
        return {}

    customer_info = intake_data.get('customer_info') or {}
    specs = intake_data.get('specifications') or {}
    if not customer_info and not specs:
        return {}

    line_item = {
        'product': 'Window' if str(intake_data.get('product_type') or '').lower() == 'window' else 'Door',
        'quantity': specs.get('quantity', ''),
        'size': specs.get('size', ''),
        'width': specs.get('window_width', ''),
        'height': specs.get('window_height', ''),
        'config': specs.get('door_configuration', ''),
        'jamb_size': specs.get('jamb', ''),
        'swing': specs.get('swing', ''),
        'hinges': specs.get('hinges', ''),
        'boring': specs.get('boring', ''),
        'sill_bottom': specs.get('sill', ''),
        'color': specs.get('color', ''),
        'glass': specs.get('glass', ''),
        'hardware': specs.get('hardware', ''),
        'special_notes': specs.get('special_conditions', ''),
    }

    return {
        'customer_name': customer_info.get('customer_name', 'Imported OCR Customer'),
        'project_name': customer_info.get('project_name', 'Imported Intake Form'),
        'stage': 'QUOTE_CREATED',
        'customer_phone': customer_info.get('phone', ''),
        'customer_email': customer_info.get('email', ''),
        'product_type': intake_data.get('product_type', 'door'),
        'notes': 'Imported from intake form via robust OCR',
        'line_items': json.dumps([line_item])
    }


def _extract_first(pattern: str, text: str) -> str:
    match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
    if not match:
        return ""
    return (match.group(1) or "").strip()


def _line_after_label(lines: list[str], label: str) -> str:
    label_lc = label.lower()
    for index, line in enumerate(lines):
        if line.strip().lower().rstrip(':') == label_lc.rstrip(':'):
            for candidate in lines[index + 1:index + 5]:
                cleaned = candidate.strip()
                if cleaned:
                    return cleaned
    return ""


def _extract_money_after_label(text: str, label: str) -> str:
    pattern = rf"{re.escape(label)}\s*:?\s*\$?\s*([0-9,]+\.\d{{2}})"
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        return match.group(1).replace(',', '')

    lines = [ln.strip() for ln in text.splitlines()]
    for index, line in enumerate(lines):
        if label.lower() in line.lower():
            window = " ".join(lines[index:index + 4])
            money = re.search(r"\$\s*([0-9,]+\.\d{2})", window)
            if money:
                return money.group(1).replace(',', '')
    return ""


def _extract_orepac_header_customer(lines: list[str]) -> tuple[str, str]:
    for index, line in enumerate(lines[:20]):
        if re.search(r"[A-Za-z]", line) and re.search(r"\d{3}[-\s]?\d{3}", line):
            name_part = re.sub(r"\s*\d.*$", "", line).strip()
            phone_parts = [line]
            if index + 1 < len(lines):
                phone_parts.append(lines[index + 1])
            digits = re.sub(r"\D", "", " ".join(phone_parts))
            phone = ""
            if len(digits) >= 10:
                digits = digits[-10:]
                phone = f"{digits[0:3]}-{digits[3:6]}-{digits[6:10]}"
            return name_part, phone
    return "", ""


def _normalize_us_date(raw_date: str) -> str:
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw_date or "")
    if not match:
        return raw_date or ""
    month, day, year = match.groups()
    return f"{year}-{int(month):02d}-{int(day):02d}"


def _extract_orepac_items(text: str) -> list[dict]:
    items = []
    seen = set()
    blocks = re.split(r"(?=\bItem\s+\d+\b)", text, flags=re.IGNORECASE)

    for block in blocks:
        item_match = re.search(r"\bItem\s+(\d+)\b", block, re.IGNORECASE)
        if not item_match:
            continue
        item_no = int(item_match.group(1))
        if item_no in seen:
            continue
        seen.add(item_no)

        width = _extract_first(r"Door\s+Width\s*\n\s*([^\n]+)", block)
        height = _extract_first(r"Door\s+Height\s*\n\s*([^\n]+)", block)
        handing = _extract_first(r"Door\s+Handing\s*\n\s*([^\n]+)", block)
        config = _extract_first(r"Door\s+Configuration\s*\n\s*([^\n]+)", block)
        series = _extract_first(r"Product\s+Series\s*\n\s*([^\n]+)", block)
        model = _extract_first(r"Model\s+Number\s*\n\s*([^\n]+)", block)
        material = _extract_first(r"Material\s*\n\s*([^\n]+)", block)
        species = _extract_first(r"Wood\s+Species\s*\n\s*([^\n]+)", block)
        thickness = _extract_first(r"Door\s+Thickness\s*\n\s*([^\n]+)", block)
        style = _extract_first(r"Door\s+Style\s*\n\s*([^\n]+)", block)
        bore = _extract_first(r"Door\s+Bore\s*\n\s*([^\n]+)", block)
        quantity = _extract_first(r"Quantity:\s*\n?\s*(\d+)", block) or "1"
        item_price = _extract_money_after_label(block, 'Item Price')
        item_total = _extract_money_after_label(block, 'Item Total')
        description = _extract_first(r"Vendor\s+Item\s+Description\s*\n\s*(.+?)(?:\n\s*Page|\n\s*Quote:|$)", block)

        size = ""
        if description:
            size_match = re.search(r"\b(\d+/\d+)\s*x\s*(\d+/\d+)\b", description)
            if size_match:
                width = size_match.group(1)
                height = size_match.group(2)
                size = f"{width} x {height}"
        if not size and width and height:
            size = f"{width} x {height}"

        if description:
            if not config and 'door slab only' in description.lower():
                config = 'Door Slab Only'
            if not handing:
                hand_match = re.search(r"-\s*([^\-]*Hand\s+Inswing[^\-]*)\s*-", description, re.IGNORECASE)
                if hand_match:
                    handing = hand_match.group(1).strip()
            if not species and re.search(r"\bPrimed\b", description, re.IGNORECASE):
                species = 'Primed'
            if not bore and re.search(r"\bNo\s+Bore\b", description, re.IGNORECASE):
                bore = 'No Bore'

        notes = []
        for value in [series, model, material, species, thickness, style, bore, item_price and f"Item Price: ${item_price}", item_total and f"Item Total: ${item_total}"]:
            if value:
                notes.append(str(value))
        if description:
            notes.append(description)

        items.append({
            'product': 'Door',
            'quantity': int(quantity) if str(quantity).isdigit() else quantity,
            'width': width,
            'height': height,
            'size': size,
            'config': config,
            'swing': handing,
            'color': species,
            'boring': bore,
            'special_notes': ' | '.join(notes),
        })

    return items


def _extract_orepac_details_order(text: str, source_label: str = 'OCR document') -> dict:
    lower_text = text.lower()
    if 'orepac' not in lower_text and 'marketplace' not in lower_text:
        return {}
    if 'details report' not in lower_text and 'quote total' not in lower_text and 'vendor item description' not in lower_text:
        return {}

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    customer_name, phone = _extract_orepac_header_customer(lines)

    quote_number = _extract_first(r"\bQuote:\s*([0-9]{5,})", text) or _extract_first(r"^\s*([0-9]{5,})\s*$", text)
    quote_date = _normalize_us_date(_extract_first(r"Date\s+quoted:\s*([0-9]{1,2}/[0-9]{1,2}/[0-9]{4})", text))
    quote_total = _extract_money_after_label(text, 'Quote Total')
    customer_account = _line_after_label(lines, 'Customer')
    ship_to = _line_after_label(lines, 'Ship-To Location')
    salesperson = _line_after_label(lines, 'Salesperson')
    items = _extract_orepac_items(text)

    if not customer_name:
        customer_name = customer_account or 'Unknown Customer'

    notes = [f"Imported from {source_label} via OCR"]
    if customer_account:
        notes.append(f"Orepac customer: {customer_account}")
    if ship_to:
        notes.append(f"Ship-to: {ship_to}")
    if salesperson:
        notes.append(f"Salesperson: {salesperson}")

    order = {
        'customer_name': customer_name,
        'project_name': customer_name,
        'stage': 'QUOTE_CREATED',
        'customer_phone': phone,
        'customer_email': '',
        'product_type': 'door',
        'vendor': 'Orepac',
        'quote_number': quote_number,
        'quote_date': quote_date,
        'quote_total': float(quote_total) if quote_total else None,
        'notes': '\n'.join(notes),
    }

    if items:
        order['line_items'] = json.dumps(items)

    return order

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
        'customer_phone': phone,
        'customer_email': email,
        'product_type': 'door',
        'quote_number': quote_number,
        'notes': '\n'.join(notes),
    }

