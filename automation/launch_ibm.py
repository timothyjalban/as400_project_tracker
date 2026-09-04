import os, time, subprocess, logging, traceback, json, tempfile, re
from pathlib import Path
from datetime import datetime
from typing import Any, Optional

try:
    from data.vendors import COMMON_VENDORS
except Exception:
    COMMON_VENDORS = []

try:
    import pyautogui as _pyautogui  # type: ignore[reportMissingImports,reportMissingModuleSource]
    pyautogui: Any = _pyautogui
except ImportError:
    class _PyAutoGuiFallback:
        class FailSafeException(Exception):
            pass

        FAILSAFE = True

        @staticmethod
        def press(*args, **kwargs):
            raise RuntimeError("pyautogui is not installed")

        @staticmethod
        def typewrite(*args, **kwargs):
            raise RuntimeError("pyautogui is not installed")

        @staticmethod
        def hotkey(*args, **kwargs):
            raise RuntimeError("pyautogui is not installed")

        @staticmethod
        def position():
            return (0, 0)

    pyautogui: Any = _PyAutoGuiFallback()

# Module logger
logger = logging.getLogger(__name__)

gw: Any = None
try:
    import pygetwindow as gw  # type: ignore[reportMissingImports,reportMissingModuleSource]
    HAS_PYGETWINDOW = True
except ImportError:
    HAS_PYGETWINDOW = False
    logger.warning("pygetwindow not available - window focusing may not work")

pyperclip: Any = None
try:
    import pyperclip  # type: ignore[reportMissingImports,reportMissingModuleSource]
    HAS_PYPERCLIP = True
except ImportError:
    HAS_PYPERCLIP = False
    print(">>> WARNING: pyperclip not available - quote number capture disabled")

# Pinned ACS launcher path (reliable across Windows installs)
ACS_LAUNCHER_PATH = r"C:\Users\Public\IBM\ClientSolutions\Start_Programs\Windows_x86-64\acslaunch_win-64.exe"

HOD_FILES = {
    ("Felton", "Session 1"): r"FEL1061s1.hod",
    ("Felton", "Session 2"): r"FEL1061s2.hod",
    ("River",  "Session 1"): r"RIV2063s1.hod",
    ("River",  "Session 2"): r"RIV3163s1.hod",
    ("41st",   "Session 1"): r"SOQ2655S1.hod",
    ("41st",   "Session 2"): r"SOQ2655S2.hod",
}

LOCATION_CODES = {
    "Felton": "61",
    "River": "63",
    "41st": "55"
}

SALESMAN_NUMBERS = {
    "Felton": "236",
    "41st": "236",
    "River": "236",
}

PREFIT_LABOR_SKU_1_3_8 = "663761"
PREFIT_LABOR_SKU_1_3_4 = "663762"
PREFIT_LABOR_RATE = 50.00

# Delivery line: Ctrl+Alt+D is a self-contained AS400 macro - it types the
# delivery SKU (040619) / qty (1) / price ($125) on its own, no dialog to fill.
# These are kept for display/reference (web app manual-mode message).
DELIVERY_LINE_SKU = "040619"
DELIVERY_LINE_DESCRIPTION = "DELIVERY"
DELIVERY_LINE_UM = "EA"
DELIVERY_LINE_PRICE = "125"
DELIVERY_LINE_QTY = "1"


def _delivery_line_item(overrides: dict | None = None) -> dict:
    """A marker line item so run_vendor_sku_macro_dialog fires Ctrl+Alt+D."""
    return {"is_delivery": True, "no_cost": False, "as400_comment_authoritative": True, "notes": ""}


AS400_DESCRIPTION_MAX_CHARS = 36
INVALID_VENDOR_SKUS = {"1001", "1002", "1003", "2001", "2002", "2003"}

_KEYSTROKE_TRACE_ENABLED = (os.environ.get("OT_KEYSTROKE_TRACE", "0") or "0").strip().lower() in ("1", "true", "yes", "on")
_KEYSTROKE_TRACE_FILE = os.environ.get("OT_KEYSTROKE_TRACE_FILE", "").strip() or str(Path(tempfile.gettempdir()) / "order_tracker_as400_keystrokes.log")
_STARTUP_ABORT_ENABLED = (os.environ.get("OT_STARTUP_ABORT_ENABLED", "0") or "0").strip().lower() in ("1", "true", "yes", "on")
_STARTUP_MOUSE_TRACE_ENABLED = (os.environ.get("OT_STARTUP_MOUSE_TRACE", "0") or "0").strip().lower() in ("1", "true", "yes", "on")


def _trace_keystroke(action: str, **fields) -> None:
    """Print and append a readable keystroke trace entry when tracing is enabled."""
    if not _KEYSTROKE_TRACE_ENABLED:
        return

    try:
        Path(_KEYSTROKE_TRACE_FILE).parent.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().isoformat(timespec="milliseconds")

        if action == "press":
            key = fields.get("key", "")
            presses = int(fields.get("presses") or 1)
            detail = f"press {key}" + (f" x{presses}" if presses != 1 else "")
        elif action == "typewrite":
            text = _shorten_for_trace(fields.get("text", ""), 60)
            detail = f'type "{text}"'
        elif action == "hotkey":
            keys = fields.get("keys") or []
            detail = "hotkey " + "+".join(str(key) for key in keys)
        elif action == "charge_sale_start":
            detail = f'Charge Sale start | quote={fields.get("quote_number", "")} | stage={fields.get("stage", "")}'
        elif action == "charge_sale_end":
            detail = "Charge Sale end"
        else:
            extra = " ".join(f"{key}={value}" for key, value in fields.items())
            detail = f"{action} {extra}".strip()

        line = f"{ts} | {detail}"
        print(f">>> [KEY] {detail}")
        with open(_KEYSTROKE_TRACE_FILE, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except Exception:
        logger.exception("Failed to write keystroke trace entry")


def _shorten_for_trace(value, max_len: int = 80) -> str:
    text = str(value)
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def _install_keystroke_trace_hooks() -> None:
    """Wrap pyautogui key entry methods for tracing and transient failsafe retry."""
    if pyautogui is None:
        return

    if getattr(pyautogui, "_ot_keystroke_wrapped", False):
        return

    original_press = pyautogui.press
    original_typewrite = pyautogui.typewrite
    original_hotkey = pyautogui.hotkey

    def _mouse_in_corner_confirmed(samples: int = 4, interval: float = 0.05, threshold: int = 5) -> bool:
        """Require repeated corner samples to treat failsafe as intentional."""
        for _ in range(samples):
            try:
                x, y = pyautogui.position()
                if not (x <= threshold and y <= threshold):
                    return False
            except Exception:
                # If position cannot be read, keep default failsafe behavior.
                return True
            time.sleep(interval)
        return True

    def _run_with_failsafe_retry(op_name: str, fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except pyautogui.FailSafeException:
            # Keep true failsafe aborts intact, only retry when corner state
            # cannot be consistently confirmed.
            if _mouse_in_corner_confirmed():
                raise

            logger.warning("Transient PyAutoGUI failsafe during %s; retrying once", op_name)
            time.sleep(0.05)
            return fn(*args, **kwargs)

    def traced_press(*args, **kwargs):
        key = args[0] if args else kwargs.get("keys")
        presses = kwargs.get("presses", 1)
        interval = kwargs.get("interval", None)
        if _KEYSTROKE_TRACE_ENABLED:
            _trace_keystroke("press", key=key, presses=presses, interval=interval)
        return _run_with_failsafe_retry("press", original_press, *args, **kwargs)

    def traced_typewrite(*args, **kwargs):
        message = args[0] if args else kwargs.get("message", "")
        interval = kwargs.get("interval", None)
        if _KEYSTROKE_TRACE_ENABLED:
            _trace_keystroke("typewrite", text=_shorten_for_trace(message), length=len(str(message)), interval=interval)
        return _run_with_failsafe_retry("typewrite", original_typewrite, *args, **kwargs)

    def traced_hotkey(*args, **kwargs):
        keys = [str(k) for k in args]
        if _KEYSTROKE_TRACE_ENABLED:
            _trace_keystroke("hotkey", keys=keys)
        return _run_with_failsafe_retry("hotkey", original_hotkey, *args, **kwargs)

    pyautogui.press = traced_press
    pyautogui.typewrite = traced_typewrite
    pyautogui.hotkey = traced_hotkey
    setattr(pyautogui, "_ot_keystroke_wrapped", True)

    if _KEYSTROKE_TRACE_ENABLED:
        _trace_keystroke("trace_enabled", file=_KEYSTROKE_TRACE_FILE)


_install_keystroke_trace_hooks()

def _as400_mode() -> str:
    """Determine automation mode: 'macro', 'hybrid', or 'python'."""
    mode = os.environ.get("AS400_MODE", "hybrid").strip().lower()
    if mode not in ("macro", "hybrid", "python"):
        return "hybrid"
    return mode

def _open_hod_session(hod_file: str) -> bool:
    """Open HOD session file via pinned ACS launcher."""
    try:
        if not os.path.exists(hod_file):
            logger.error(f"HOD file not found: {hod_file}")
            return False
        subprocess.Popen([ACS_LAUNCHER_PATH, hod_file])
        return True
    except Exception as e:
        logger.error(f"Failed to open HOD session: {e}")
        return False

def _focus_emulator_window(max_attempts: int = 10, delay: float = 0.5) -> bool:
    """Find and focus the IBM emulator window."""
    if not HAS_PYGETWINDOW:
        logger.warning("pygetwindow not available, skipping window focus")
        return False
    
    print(f">>> Attempting to focus emulator window...")
    # Ordered by specificity - 'AS400' (no slash) matches the actual observed
    # session title (e.g. "A - AS400.DXLBR.COM"); the rest are kept as
    # fallbacks for any differently-configured session title.
    search_terms = ('AS400', 'IBM', 'iSeries', 'AS/400', '5250')
    for attempt in range(max_attempts):
        try:
            windows = []
            for term in search_terms:
                windows = gw.getWindowsWithTitle(term)
                if windows:
                    break

            if windows:
                emulator_window = windows[0]
                print(f">>> Found emulator window: {emulator_window.title}")
                emulator_window.activate()
                time.sleep(0.3)
                return True
            
            time.sleep(delay)
        except Exception as e:
            logger.debug(f"Attempt {attempt + 1}: Could not focus window - {e}")
    
    print(">>> Warning: Could not find/focus emulator window")
    return False

def _capture_fixed_length_from_current_cursor(length: int = 6) -> str | None:
    """Copy a fixed-length token from the current AS400 cursor position."""
    if pyautogui is None or not HAS_PYPERCLIP or pyperclip is None:
        return None

    try:
        pyperclip.copy("")
    except Exception:
        pass

    try:
        pyautogui.keyDown('shift')
        pyautogui.press('right', presses=max(1, int(length)))
        pyautogui.keyUp('shift')
        time.sleep(0.1)
        pyautogui.hotkey('ctrl', 'c')
        time.sleep(0.2)

        raw_text = str(pyperclip.paste() or "")
        parsed = re.sub(r"[^A-Za-z0-9]", "", raw_text).strip()
        print(f">>> [CAPTURE] Current-cursor read: raw='{raw_text}' parsed='{parsed}'")
        if len(parsed) >= 6:
            return parsed[:6]
        return None
    except Exception:
        return None


def _capture_quote_number_via_ctrl_alt_q(min_length: int = 6) -> str | None:
    """Use AS400 built-in Ctrl+Alt+Q extraction to copy the current field/line."""
    if pyautogui is None or not HAS_PYPERCLIP or pyperclip is None:
        return None

    try:
        try:
            pyperclip.copy("")
        except Exception:
            pass

        print(">>> [CAPTURE] Triggering AS400 built-in extract with Ctrl+Alt+Q")
        pyautogui.hotkey('ctrl', 'alt', 'q')
        time.sleep(0.3)

        raw_text = str(pyperclip.paste() or "")
        parsed_tokens = re.findall(r"[A-Za-z0-9]+", raw_text)
        parsed = max(parsed_tokens, key=len) if parsed_tokens else ""
        print(f">>> [CAPTURE] Ctrl+Alt+Q read: raw='{raw_text}' parsed='{parsed}'")

        if len(parsed) >= max(1, int(min_length)):
            return parsed
        return None
    except Exception as exc:
        print(f">>> [CAPTURE] Ctrl+Alt+Q capture error: {exc}")
        return None


def _quote_total_capture_hotkey() -> tuple[str, ...]:
    """Return a single hotkey sequence for quote-total capture."""
    raw_value = str(os.environ.get("OT_QUOTE_TOTAL_CAPTURE_HOTKEY") or "").strip()
    if not raw_value:
        return ("ctrl", "alt", "shift", "4")

    keys = tuple(k.strip().lower() for k in raw_value.split("+") if k.strip())
    return keys or ("ctrl", "alt", "shift", "4")


def _parse_quote_total_from_text(raw_text: str) -> float | None:
    """Parse a numeric quote total from noisy clipboard text."""
    text = str(raw_text or "").strip().replace("\u00a0", " ")
    if not text:
        return None

    candidates = re.findall(r"\(?\s*\$?\s*-?\d[\d\s,\.]*\)?", text)
    parsed_values: list[tuple[float, bool]] = []

    for token in candidates:
        normalized = token.strip()
        is_negative = normalized.startswith("(") and normalized.endswith(")")
        normalized = normalized.strip("() ").replace("$", "")
        normalized = re.sub(r"\s+", "", normalized)
        normalized = re.sub(r"[^0-9,\.\-]", "", normalized)
        if not normalized:
            continue

        if "," in normalized and "." in normalized:
            if normalized.rfind(",") > normalized.rfind("."):
                normalized = normalized.replace(".", "").replace(",", ".")
            else:
                normalized = normalized.replace(",", "")
        elif "," in normalized and "." not in normalized:
            whole, frac = normalized.rsplit(",", 1)
            if frac.isdigit() and 1 <= len(frac) <= 2:
                normalized = whole.replace(",", "") + "." + frac
            else:
                normalized = normalized.replace(",", "")

        try:
            value = float(normalized)
            if is_negative:
                value = -abs(value)
            has_decimals = "." in normalized
            parsed_values.append((value, has_decimals))
        except Exception:
            continue

    if not parsed_values:
        return None

    # Prefer decimal values (currency-like), otherwise keep the last parsed token.
    decimal_values = [item for item in parsed_values if item[1]]
    return (decimal_values[-1][0] if decimal_values else parsed_values[-1][0])


def _capture_quote_total() -> float | None:
    """Use one AS400 macro hotkey to extract quote total from the current screen."""
    if pyautogui is None or not HAS_PYPERCLIP or pyperclip is None:
        return None

    hotkey = _quote_total_capture_hotkey()
    capture_delay = float(os.environ.get("OT_QUOTE_TOTAL_CAPTURE_DELAY", "0.45") or "0.45")

    try:
        try:
            pyperclip.copy("")
        except Exception:
            pass

        combo_text = "+".join(hotkey)
        print(f">>> [CAPTURE] Quote-total capture using {combo_text}")
        pyautogui.hotkey(*hotkey)
        time.sleep(capture_delay)

        raw_text = str(pyperclip.paste() or "").strip()
        value = _parse_quote_total_from_text(raw_text)
        if value is not None:
            print(f">>> [CAPTURE] Quote-total read: raw='{raw_text}' parsed={value:.2f}")
            return value

        print(f">>> [CAPTURE] Quote-total read failed: raw='{raw_text}'")
        return None
    except Exception as exc:
        print(f">>> [CAPTURE] Quote-total capture error: {exc}")
        return None


def capture_quote_number_at_coordinates(row=2, col=14, length=6, retries=3, allow_current_cursor_fallback=False):
    """
    Capture text from AS400 screen at specific coordinates using clipboard.
    Navigates to the specified position and copies the value.
    
    Args:
        row: Row number (1-based)
        col: Column number (1-based)
    
    Returns:
        str: The captured text, or None if capture failed
    """
    if pyautogui is None:
        print(">>> Cannot capture quote number - pyautogui not installed")
        return None

    if not HAS_PYPERCLIP or pyperclip is None:
        print(">>> Cannot capture quote number - pyperclip not installed")
        return None
    
    try:
        print(f">>> Capturing quote number from position {row:02d}/{col:03d}-{row:02d}/{col + length - 1:03d}")

        # Wait a moment for the screen to stabilize.
        time.sleep(0.75)

        # Primary method: let AS400 extract the field under the current cursor.
        # Accept variable-length document numbers. If AS400 returns more text,
        # keep only the left segment up to requested length.
        ctrl_alt_q_value = _capture_quote_number_via_ctrl_alt_q(min_length=1)
        if ctrl_alt_q_value:
            accepted = ctrl_alt_q_value[:max(1, int(length))]
            print(f">>> [CAPTURE] Accepted Ctrl+Alt+Q quote number: '{accepted}'")
            return accepted

        # Optional fallback: read from wherever AS400 left the cursor after completion.
        if allow_current_cursor_fallback:
            current_cursor_value = _capture_fixed_length_from_current_cursor(length=length)
            if current_cursor_value:
                print(f">>> [CAPTURE] Accepted current-cursor quote number: '{current_cursor_value}'")
                return current_cursor_value
        else:
            print(">>> [CAPTURE] Current-cursor fallback disabled for this flow")

        print(">>> [CAPTURE] Quote number capture did not return a valid 6-char value")
        return None

    except Exception as e:
        print(f">>> [CAPTURE] Error capturing quote number: {e}")
        traceback.print_exc()
        return None

def _salesman_for_location(location: str) -> str:
    """Map location (code or name) to salesman number."""
    # Normalize: convert code to name if needed
    location_normalized = location
    if location == "61":
        location_normalized = "Felton"
    elif location == "55":
        location_normalized = "41st"
    elif location == "63":
        location_normalized = "River"

    # Updated salesman numbers
    return SALESMAN_NUMBERS.get(location_normalized, "236")

def _run_macro_script(script_name: str, args: Optional[list[str]] = None) -> bool:
    """Execute AHK macro if available. Returns True if successful, False otherwise."""
    try:
        macro_dir = Path(__file__).resolve().parent / "as400_macros"
        macro_file = macro_dir / f"{script_name}.ahk"
        if not macro_file.exists():
            return False
        
        cmd = ["autohotkey", str(macro_file)]
        if args:
            cmd.extend(args)
        
        result = subprocess.run(cmd, capture_output=True, timeout=300)
        # Exit code 99 = user safety abort (don't treat as failure)
        if result.returncode in (0, 99):
            if result.returncode == 99:
                print(f">>> {script_name}.ahk aborted by user (mouse in corner)")
            return result.returncode == 0
        return False
    except Exception as e:
        logger.debug(f"Macro {script_name}.ahk not available or failed: {e}")
        return False

def _format_as400_description(raw: dict, needs_prefit: bool, prefit_meta: dict | None = None) -> str:
    """Format line item description for AS400 (max 31 chars)."""
    if not needs_prefit:
        base = str(raw.get("description") or raw.get("location") or "").strip()
        return base[:AS400_DESCRIPTION_MAX_CHARS]
    
    prefit_meta = prefit_meta or {}
    size_value = str(raw.get("size") or prefit_meta.get("rough_opening") or "").strip()
    size_value = re.sub(r"^(?:RO|Callout)\s+", "", size_value, flags=re.IGNORECASE).strip()
    thickness = str(raw.get("door_thickness") or raw.get("thickness") or prefit_meta.get("thickness") or "").strip()
    model = str(raw.get("model") or raw.get("series") or raw.get("style") or raw.get("sku") or "").strip()
    panel_text = _prefit_panel_text(raw)

    parts = [size_value, thickness, model, panel_text]
    desc = ", ".join(p for p in parts if p)
    return desc[:AS400_DESCRIPTION_MAX_CHARS]


def _normalize_prefit_thickness(value: Any) -> str:
    """Normalize thickness to one of: 1-3/8, 1-3/4, or empty."""
    text = str(value or "").strip().lower().replace('"', "")
    text = re.sub(r"\s+", "", text)
    text = text.replace("/", "/")
    if text in {"1-3/8", "13/8", "1_3/8", "1–3/8", "1—3/8"}:
        return "1-3/8"
    if text in {"1-3/4", "13/4", "1_3/4", "1–3/4", "1—3/4"}:
        return "1-3/4"
    return ""


def _prefit_labor_sku_for_item(raw: dict, prefit_meta: dict | None = None) -> str:
    """Resolve prefit labor SKU from door thickness."""
    prefit_meta = prefit_meta or {}
    thickness = _normalize_prefit_thickness(raw.get("door_thickness") or raw.get("thickness") or prefit_meta.get("thickness"))
    if thickness == "1-3/8":
        return PREFIT_LABOR_SKU_1_3_8
    # Default to the 1-3/4 labor SKU when thickness is 1-3/4 or unspecified.
    return PREFIT_LABOR_SKU_1_3_4


def _prefit_panel_text(raw: dict) -> str:
    """Return 'Flush' or '<N>pnl' when panel data is available."""
    panel_raw = str(raw.get("panel") or raw.get("panels") or raw.get("panel_config") or "").strip()
    if panel_raw:
        lowered = panel_raw.lower()
        if "flush" in lowered:
            return "Flush"
        digits = re.search(r"\d+", lowered)
        if digits:
            return f"{digits.group(0)}pnl"
        if "pnl" in lowered:
            return panel_raw

    door_cfg = str(raw.get("door_configuration") or "").strip().lower()
    if "slab" in door_cfg or "flush" in door_cfg:
        return "Flush"
    return ""


def _sanitize_vendor_sku(value: Any) -> str:
    """Normalize vendor SKU input and drop known invalid placeholders."""
    cleaned = str(value or "").strip()
    if not cleaned:
        return ""
    # Prevent internal 4-digit vendor IDs from being used as AS400 SKU values.
    if re.fullmatch(r"\d{4}", cleaned):
        return ""
    if cleaned in INVALID_VENDOR_SKUS:
        return ""
    return cleaned


VENDOR_SKU_BY_NAME = {
    str(vendor.get("name") or "").strip().lower(): _sanitize_vendor_sku(vendor.get("sku"))
    for vendor in COMMON_VENDORS
    if str(vendor.get("name") or "").strip() and _sanitize_vendor_sku(vendor.get("sku"))
}

def _looks_like_door_item(raw: dict) -> bool:
    """Check if line item looks like a door (has size/model indicators)."""
    size = str(raw.get("size") or "").strip().lower()
    model = str(raw.get("model") or "").strip().lower()
    return bool(size or model)


def _item_has_prefit_style(raw: dict) -> bool:
    """True when the item should be handled as prefit by AS400 automation."""
    if not isinstance(raw, dict):
        return False

    explicit_prefit = raw.get("prefit_enabled")
    if isinstance(explicit_prefit, str):
        if explicit_prefit.strip().lower() in {"1", "true", "yes", "y", "on"}:
            return True
    elif bool(explicit_prefit):
        return True

    style_value = str(raw.get("style") or raw.get("door_style") or raw.get("model") or "").strip().lower()
    return "prefit" in style_value

def _normalize_quote_line_items(line_items: list[dict] | None, vendor_sku: str | int | None = None, needs_prefit: bool = False, prefit_meta: dict | None = None) -> list[dict]:
    """Normalize and structure line items for AS400 entry."""
    normalized: list[dict] = []
    if not line_items:
        return normalized

    for idx, raw in enumerate(line_items, start=1):
        if not isinstance(raw, dict):
            continue

        qty_raw = raw.get("quantity", 1)
        try:
            qty = int(float(qty_raw))
        except Exception:
            qty = 1
        qty = max(1, qty)

        item_sku = (
            raw.get("vendor_sku")
            or raw.get("sku")
            or vendor_sku
            or ""
        )
        item_sku = _sanitize_vendor_sku(item_sku)

        size_text = str(raw.get("size") or "").strip()
        operation = str(raw.get("operation") or "").strip()
        location = str(raw.get("location") or "").strip()
        description = " | ".join(x for x in [location, operation, size_text] if x)
        as400_description = _format_as400_description(raw, needs_prefit, prefit_meta)

        normalized.append(
            {
                "index": idx,
                "quantity": qty,
                "sku": item_sku,
                "size": size_text,
                "description": description,
                "as400_description": as400_description,
                "um": str(raw.get("um") or "EA").strip() or "EA",
                "price": str(raw.get("price") or "").strip(),
            }
        )

        # Add prefit labor line only for explicit Prefit-style door items.
        if needs_prefit and _looks_like_door_item(raw) and _item_has_prefit_style(raw):
            labor_sku = _prefit_labor_sku_for_item(raw, prefit_meta)
            normalized.append(
                {
                    "index": f"{idx}L",
                    "quantity": qty,
                    "sku": labor_sku,
                    "size": "",
                    "description": f"PREFIT LABOR @ ${PREFIT_LABOR_RATE:.2f}",
                    "as400_description": _format_as400_description(raw, True, prefit_meta),
                    "um": "EA",
                    "price": f"{PREFIT_LABOR_RATE:.2f}",
                }
            )

    has_prefit_style_item = any(isinstance(raw, dict) and _item_has_prefit_style(raw) for raw in (line_items or []))
    if needs_prefit and has_prefit_style_item and not any(str(it.get("sku")) in {PREFIT_LABOR_SKU_1_3_8, PREFIT_LABOR_SKU_1_3_4} for it in normalized):
        labor_sku = _prefit_labor_sku_for_item({}, prefit_meta)
        normalized.append(
            {
                "index": "L1",
                "quantity": 1,
                "sku": labor_sku,
                "size": "",
                "description": f"PREFIT LABOR @ ${PREFIT_LABOR_RATE:.2f}",
                "as400_description": _format_as400_description({}, True, prefit_meta),
                "um": "EA",
                "price": f"{PREFIT_LABOR_RATE:.2f}",
            }
        )
    return normalized


def _resolve_vendor_sku_for_macro(vendor_sku: str | int | None, line_items: list[dict] | None = None) -> str:
    """Resolve vendor SKU value used by the AS400 Ctrl+Alt+S macro dialog."""
    def _vendor_name_for_item(item: dict) -> str:
        return str(item.get('vendor') or '').strip().lower()

    def _sku_for_vendor_name(vendor_name: str) -> str:
        return _sanitize_vendor_sku(VENDOR_SKU_BY_NAME.get(vendor_name, ''))

    if vendor_sku is not None and str(vendor_sku).strip():
        resolved = _sanitize_vendor_sku(vendor_sku)
        if resolved:
            return resolved

    if isinstance(line_items, list):
        for item in line_items:
            if not isinstance(item, dict):
                continue
            vendor_name = _vendor_name_for_item(item)
            if vendor_name:
                resolved_vendor_sku = _sku_for_vendor_name(vendor_name)
                if resolved_vendor_sku:
                    return resolved_vendor_sku
            for field in ("vendor_sku", "sku"):
                value = item.get(field)
                if value is not None and str(value).strip():
                    resolved = _sanitize_vendor_sku(value)
                    if resolved:
                        return resolved

    return ""


def _first_item_for_macro(line_items: list[dict] | None) -> dict:
    """Pick the first usable line item for macro dialog field defaults."""
    if isinstance(line_items, list):
        for item in line_items:
            if isinstance(item, dict):
                return item
    return {}


def _macro_item_type(item: dict) -> str:
    """Infer line item type for description formatting."""
    raw_type = str(item.get("type") or item.get("item_type") or item.get("product") or "").strip().lower()
    if "install" in raw_type:
        return "install"
    if "hardware" in raw_type:
        return "hardware"
    if "window" in raw_type:
        return "window"
    return "door"


def _macro_item_value(item: dict, *keys: str) -> str:
    """Resolve a value from top-level item keys, then common nested config maps."""
    if not isinstance(item, dict):
        return ""

    for key in keys:
        value = str(item.get(key) or "").strip()
        if value:
            return value

    nested_maps = (
        item.get("config_values"),
        item.get("configured_values"),
        item.get("configuration"),
        item.get("config"),
    )
    for nested in nested_maps:
        if not isinstance(nested, dict):
            continue
        for key in keys:
            value = str(nested.get(key) or "").strip()
            if value:
                return value

    return ""


def _macro_size_text(item: dict) -> str:
    """Build RO or callout size segment used at the start of description."""
    ro_w = _macro_item_value(item, "rough_opening_width", "ro_width", "width")
    ro_h = _macro_item_value(item, "rough_opening_height", "ro_height", "height")
    if ro_w and ro_h:
        return f"RO {ro_w} x {ro_h}"

    callout = _macro_item_value(item, "callout_size", "size")
    if callout:
        return f"Callout {callout}"
    return ""


def _ensure_inches(value: str) -> str:
    """Normalize a dimension token; append inches mark for plain numerics."""
    token = _normalize_comment_whitespace(value)
    if not token:
        return ""

    lowered = token.lower()
    if any(unit in lowered for unit in ('"', "'", "in", "mm", "cm")):
        return token

    if re.fullmatch(r"\d+(?:\.\d+)?", token):
        return f'{token}"'

    return token


def _window_size_text(item: dict) -> str:
    """Build window size as either callout token or inches format."""
    callout = _normalize_comment_whitespace(_macro_item_value(item, "callout_size", "size"))
    if callout:
        compact = callout.replace(" ", "")
        # Prefer classic callout forms like 2040 / 3050 as-is.
        if re.fullmatch(r"\d{3,5}", compact):
            return compact
        # If user already entered explicit dimensions in size, keep them.
        if "x" in callout.lower() or "\"" in callout:
            return callout

    width = _macro_item_value(item, "width", "ro_width", "rough_opening_width")
    height = _macro_item_value(item, "height", "ro_height", "rough_opening_height")
    if width and height:
        return f"{_ensure_inches(width)} x {_ensure_inches(height)}"

    fallback = _macro_size_text(item)
    return re.sub(r"^(?:RO|Callout)\s+", "", fallback, flags=re.IGNORECASE).strip()


def _window_handing_text(item: dict) -> str:
    """Normalize window handing/operation to concise AS400 token when possible."""
    raw = _normalize_comment_whitespace(
        _macro_item_value(item, "operation", "operation_style", "handing", "swing")
    )
    if not raw:
        return ""

    lowered = raw.lower()
    aliases = {
        "single hung": "SH",
        "double hung": "DH",
        "slider": "XO",
    }
    if lowered in aliases:
        return aliases[lowered]

    # If value already looks like a compact handing code, keep upper-cased.
    compact = re.sub(r"\s+", "", raw).upper()
    if re.fullmatch(r"[A-Z]{2,4}", compact):
        return compact

    return raw


def _door_size_text(item: dict) -> str:
    """Build door size token (e.g. '2/8 6/8' or from 2068 callout)."""
    raw = _normalize_comment_whitespace(_macro_item_value(item, "callout_size", "size"))
    compact = raw.replace(" ", "")
    if compact and re.fullmatch(r"\d{4}", compact):
        return compact

    if raw and "/" in raw:
        return raw

    width = _macro_item_value(item, "width")
    height = _macro_item_value(item, "height")
    if width and height:
        return f"{_normalize_comment_whitespace(width)} x {_normalize_comment_whitespace(height)}"

    fallback = _macro_size_text(item)
    return re.sub(r"^(?:RO|Callout)\s+", "", fallback, flags=re.IGNORECASE).strip()



def _is_bypass_door_item(item: dict) -> bool:
    if _macro_item_type(item) != "door":
        return False
    text = " ".join(
        _normalize_comment_whitespace(_macro_item_value(item, key))
        for key in ("style", "door_style", "door_type", "model", "series", "description")
    ).lower()
    return "bypass" in text


def _bypass_door_size_text(item: dict) -> str:
    return re.sub(r"\s+x\s+", " ", _door_size_text(item), flags=re.IGNORECASE).strip()


def _bypass_jamb_size_text(item: dict) -> str:
    raw = _normalize_comment_whitespace(_macro_item_value(item, "jamb_size"))
    return re.sub(r"\s+", "-", raw).strip("-") if raw else ""


def _build_bypass_comment_text(item: dict) -> str:
    jamb_size = _bypass_jamb_size_text(item)
    lines = []
    if jamb_size:
        lines.append(f"{jamb_size} PRM FJ INT Bypass Jambs")
    lines.extend([
        "Bore only for finger pulls",
        "w/cox tracks & BB rollers",
        "STD floor guides",
    ])
    notes = _normalize_comment_whitespace(item.get("notes"))
    if notes:
        lines.append(notes)
    return "\n".join(line for line in lines if line)

def _door_thickness_text(item: dict) -> str:
    """Normalize door thickness (prefer 1-3/8 or 1-3/4 style token)."""
    raw = _normalize_comment_whitespace(_macro_item_value(item, "door_thickness", "thickness", "prefit_thickness"))
    if not raw:
        return ""

    lowered = raw.lower().replace('"', '').replace(" ", "")
    aliases = {
        "1-3/8": "1-3/8",
        "13/8": "1-3/8",
        "1-3/4": "1-3/4",
        "13/4": "1-3/4",
    }
    return aliases.get(lowered, raw)


def _door_series_text(item: dict) -> str:
    """Return compact Milgard-style series token for AS400 descriptions (e.g. V400)."""
    raw = _normalize_comment_whitespace(_macro_item_value(item, "series"))
    if not raw:
        return ""
    match = re.search(r"\bV\d{3}\b", raw, re.IGNORECASE)
    return match.group(0).upper() if match else ""

def _door_core_text(item: dict) -> str:
    """Return HC/SC core token when provided."""
    raw = _normalize_comment_whitespace(_macro_item_value(item, "core", "core_type", "slab_core"))
    if not raw:
        return ""

    lowered = raw.lower()
    if lowered in {"hc", "hollow", "hollow core", "hollowcore"}:
        return "HC"
    if lowered in {"sc", "solid", "solid core", "solidcore"}:
        return "SC"
    return raw.upper()


def _door_finish_species_text(item: dict) -> str:
    """Return finish/species token (PRM for primed/painted, DF for Douglas Fir, etc.)."""
    raw = _normalize_comment_whitespace(
        _macro_item_value(item, "prm_df", "species", "finish", "material")
    )
    if not raw:
        return ""

    lowered = raw.lower()
    if lowered in {"primed", "painted", "prm", "prime", "paint"}:
        return "PRM"
    if "douglas" in lowered and "fir" in lowered:
        return "DF"
    if lowered == "df":
        return "DF"
    if "fiberglass" in lowered:
        return "FB"
    return raw.upper() if len(raw) <= 4 else raw


def _door_style_text(item: dict) -> str:
    """Return panel/lite style token (e.g. 3PNL, 1 LT)."""
    raw = _normalize_comment_whitespace(_macro_item_value(item, "style", "panel", "panel_style"))
    if not raw:
        return ""
    if raw.lower() == "slab":
        return "SLB"
    return raw.upper()


def _door_sticking_text(item: dict) -> str:
    """Return sticking/profile token (e.g. SHK, Ovolo)."""
    raw = _normalize_comment_whitespace(_macro_item_value(item, "sticking", "profile", "sticking_profile"))
    if not raw:
        return ""
    lowered = raw.lower()
    if lowered == "shaker":
        return "SHK"
    return raw.upper() if len(raw) <= 5 else raw


def _door_is_prehung(item: dict) -> bool:
    """True when this door should carry trailing PH token."""
    cfg = _normalize_comment_whitespace(_macro_item_value(item, "door_configuration", "configuration", "config"))
    style = _normalize_comment_whitespace(_macro_item_value(item, "style"))
    model = _normalize_comment_whitespace(_macro_item_value(item, "model"))
    text = " ".join(part for part in (cfg, style, model) if part).lower()
    return "prehung" in text or "prehang" in text or re.search(r"\bph\b", text) is not None


def _door_type_shorthand(style_text: str) -> str:
    """Map common door type names to AS400 shorthand codes."""
    text = str(style_text or "").strip().lower()
    if not text:
        return ""

    if "bypass" in text:
        return "BYPASS"
    if "bifold" in text:
        return "BF"
    if "french" in text:
        return "FR"
    if "prehung" in text or "prehang" in text:
        return "PH"
    return ""


def _strip_lowe_from_glass(glass_text: str) -> str:
    """Remove Low-E tokens from glass text so Low-E stays in comments only."""
    cleaned = _normalize_comment_whitespace(glass_text)
    if not cleaned:
        return ""

    # Remove common Low-E spellings while keeping any other glass details.
    cleaned = re.sub(r"\b(?:low\s*-?\s*e|lowe)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*,\s*", ", ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.strip(" ,;|-")
    return cleaned


def _abbreviate_description_terms(text: str) -> str:
    """Apply required AS400 description abbreviations."""
    cleaned = str(text or "").strip()
    if not cleaned:
        return ""
    # Keep this as an explicit word-level replacement.
    cleaned = re.sub(r"\bfiberglass\b", "FB", cleaned, flags=re.IGNORECASE)
    return cleaned


def _strip_prehung_terms(text: str) -> str:
    """Remove literal prehung/prehang words so PH appears only once."""
    cleaned = _normalize_comment_whitespace(text)
    if not cleaned:
        return ""
    cleaned = re.sub(r"\bpre\s*-?\s*hung\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bpre\s*-?\s*hang\b", "", cleaned, flags=re.IGNORECASE)
    return _normalize_comment_whitespace(cleaned)


def _build_macro_description(item: dict) -> str:
    """Build macro dialog description using door/window/hardware-specific preferred formats."""
    if not isinstance(item, dict) or not item:
        return ""

    item_type = _macro_item_type(item)

    if item_type == "install":
        return "DeCamp Install"[:AS400_DESCRIPTION_MAX_CHARS]

    if item_type == "hardware":
        parts = [
            _normalize_comment_whitespace(item.get("hardware_product_code")),
            _normalize_comment_whitespace(item.get("hardware_lever_knob_style")),
            _normalize_comment_whitespace(item.get("hardware_finish_code") or item.get("hardware_finish")),
            _normalize_comment_whitespace(item.get("hardware_handing")),
        ]
        desc = " ".join(part for part in parts if part)
        return desc[:AS400_DESCRIPTION_MAX_CHARS]

    if item_type == "window":
        # Window description format for AS400 field 2: size + handing + compact series.
        window_size = _window_size_text(item)
        series = _door_series_text(item)
        operation = _window_handing_text(item)
        parts = [window_size, operation, series]
        desc = " ".join(part for part in parts if part)
        return desc[:AS400_DESCRIPTION_MAX_CHARS]

    # Door format:
    # Width Height Thickness [HC/SC] Model Finish/Species Style Sticking [PH]
    size_token = _bypass_door_size_text(item) if _is_bypass_door_item(item) else _door_size_text(item)
    thickness = _door_thickness_text(item)
    core = _door_core_text(item)
    series = _door_series_text(item)
    model = series or _strip_prehung_terms(_normalize_comment_whitespace(_macro_item_value(item, "model", "series")))
    finish_species = _door_finish_species_text(item)
    style = "" if series else _strip_prehung_terms(_door_style_text(item))
    sticking = _door_sticking_text(item)
    prehung = "PH" if _door_is_prehung(item) else ""
    type_token = _door_type_shorthand(_macro_item_value(item, "style", "door_style", "door_type"))

    if type_token == "BYPASS":
        parts = [size_token, thickness, model, finish_species, sticking, type_token]
    else:
        parts = [size_token, thickness, core, model, finish_species, style, sticking, prehung]
    desc = " ".join(part for part in parts if part)
    return _abbreviate_description_terms(desc)[:AS400_DESCRIPTION_MAX_CHARS]


def _build_prefit_comment_preview(item: dict) -> str:
    """Build the exact multi-line comment preview text for prefit door items."""
    if not isinstance(item, dict) or not item:
        return ""

    if not _looks_like_door_item(item) or not _item_has_prefit_style(item):
        return ""

    hinge_positions = [
        str(item.get("prefit_hinge_top") or "").strip(),
        str(item.get("prefit_hinge_middle") or "").strip(),
        str(item.get("prefit_hinge_bottom") or "").strip(),
    ]
    hinge_positions = ", ".join(part for part in hinge_positions if part)

    hinge_specs = [
        f'{str(item.get("prefit_hinge_width") or "").strip()} WIDE' if str(item.get("prefit_hinge_width") or "").strip() else "",
        f'{str(item.get("prefit_hinge_backset") or "").strip()} BACK SET' if str(item.get("prefit_hinge_backset") or "").strip() else "",
        str(item.get("prefit_hinge_prep") or "").strip(),
    ]
    hinge_specs = ", ".join(part for part in hinge_specs if part)

    bore_type = str(item.get("prefit_bore_type") or "").strip().upper()
    if bore_type == "SINGLE":
        bore_label = "SINGLE BORE:"
        bore_values = [str(item.get("prefit_bore_single") or "").strip()]
    else:
        bore_label = "DOUBLE BORE:"
        bore_values = [str(item.get("prefit_bore_top") or "").strip(), str(item.get("prefit_bore_bottom") or "").strip()]
    bore_values = ", ".join(part for part in bore_values if part)

    swing = str(item.get("prefit_swing") or item.get("swing") or "").strip().upper()
    bore_diameter = str(item.get("prefit_bore_diameter") or "2 1/8\"").strip()
    bore_diameter_text = f"{bore_diameter} DIA" if bore_diameter else ""
    if bore_diameter_text:
        bore_values = " ".join(part for part in [bore_values, bore_diameter_text] if part)

    lines = [        "PREFIT DOOR SLAB ONLY",
        "HINGE LOCATIONS:",
        hinge_positions,
        hinge_specs,
        f"{bore_label} {bore_values} {swing}".strip(),
    ]

    return "\n".join(line for line in lines if line)


def _macro_price_text(item: dict) -> str:
    """Resolve price string for macro dialog field."""
    if not isinstance(item, dict):
        return ""

    for key in ("price", "unit_price", "quote_total", "sale_price", "line_total", "cost", "amount"):
        value = item.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text

    return ""


def _macro_um_text(item: dict) -> str:
    """Resolve U/M text for macro dialog field (EA by default, NC for no-cost)."""
    if not isinstance(item, dict):
        return "EA"

    if bool(item.get("no_cost")):
        return "NC"

    explicit_um = str(item.get("um") or "").strip().upper()
    return explicit_um or "EA"


def _macro_quantity_text(item: dict) -> str:
    """Resolve quantity string for macro dialog field."""
    if not isinstance(item, dict):
        return "1"

    raw_qty = item.get("quantity", 1)
    try:
        qty = int(float(raw_qty))
    except Exception:
        qty = 1
    qty = max(1, qty)
    return str(qty)


def _normalize_comment_whitespace(value: Any) -> str:
    """Collapse internal whitespace for AS400 comment lines."""
    return re.sub(r"\s+", " ", str(value or "").strip())


def _macro_argon_text(item: dict) -> str:
    """Normalize argon field text so comments say Argon explicitly."""
    raw = _normalize_comment_whitespace(item.get("argon_included") or item.get("argon"))
    if not raw:
        return ""

    lowered = raw.lower()
    if lowered in {"included", "include", "yes", "y", "true", "1", "argon"}:
        return "Argon"
    if lowered in {"not included", "not", "no", "n", "false", "0", "none", "without"}:
        return "No Argon"
    if "argon" in lowered:
        return raw
    return f"Argon {raw}"


def _macro_lowe_text(item: dict) -> str:
    """Extract a Low-E note from dedicated fields or glass text."""
    direct = _normalize_comment_whitespace(item.get("low_e") or item.get("lowe"))
    if direct:
        lowered = direct.lower()
        if lowered in {"yes", "y", "true", "1", "included", "include", "low-e", "low e", "lowe"}:
            return "Low-E"
        if lowered in {"no", "n", "false", "0", "not included", "none"}:
            return "No Low-E"
        return direct if "low" in lowered else f"Low-E {direct}"

    glass = _normalize_comment_whitespace(item.get("glass"))
    if glass and ("low-e" in glass.lower() or "low e" in glass.lower() or "lowe" in glass.lower()):
        return "Low-E"

    notes = _normalize_comment_whitespace(item.get("notes"))
    if notes and ("low-e" in notes.lower() or "low e" in notes.lower() or "lowe" in notes.lower()):
        return "Low-E"

    return ""


def _macro_series_text(item: dict) -> str:
    """Normalize series/model field for comment usage."""
    raw = _normalize_comment_whitespace(item.get("series") or item.get("model") or item.get("style"))
    if not raw:
        return ""
    lowered = raw.lower()
    if lowered.startswith("series"):
        return raw
    return f"Series {raw}"


def _macro_frame_text(item: dict) -> str:
    """Move frame detail into comments for window lines."""
    raw = _abbreviate_description_terms(_normalize_comment_whitespace(item.get("frame")))
    return f"Frame {raw}" if raw else ""


def _macro_glass_text(item: dict) -> str:
    """Move non-Low-E glass details into comments for window lines."""
    raw = _strip_lowe_from_glass(_normalize_comment_whitespace(item.get("glass")))
    return f"Glass {raw}" if raw else ""


def _macro_window_color_text(item: dict) -> str:
    """Format interior/exterior window colors for AS400 comments."""
    exterior = _normalize_comment_whitespace(
        item.get("exterior_color") or item.get("ext_color") or item.get("exterior_finish")
    )
    interior = _normalize_comment_whitespace(
        item.get("interior_color") or item.get("int_color") or item.get("interior_finish")
    )
    legacy = _normalize_comment_whitespace(item.get("color"))
    ext = exterior or legacy
    int_color = interior or legacy

    if not ext and not int_color:
        return ""
    if ext and int_color and ext.lower() == int_color.lower():
        return f"EXT/INT: {ext}"
    return " ".join(part for part in (f"EXT: {ext}" if ext else "", f"INT: {int_color}" if int_color else "") if part)

def _macro_comment_components(item: dict) -> dict[str, str]:
    """Resolve structured comment components in canonical order."""
    empty = {
        "vendor": "",
        "frame": "",
        "glass": "",
        "fin_type": "",
        "color": "",
        "series": "",
        "argon": "",
        "lowe": "",
        "notes": "",
    }
    if not isinstance(item, dict) or not item:
        return empty

    authoritative_comment = str(item.get("as400_comment") or "").strip()
    if authoritative_comment and item.get("as400_comment_authoritative"):
        return {**empty, "notes": authoritative_comment}

    item_type = _macro_item_type(item)

    if item_type == "door" and _is_bypass_door_item(item):
        return {**empty, "notes": _build_bypass_comment_text(item)}

    return {
        "vendor": _normalize_comment_whitespace(item.get("vendor")) if item_type == "window" else "",
        "frame": _macro_frame_text(item) if item_type == "window" else "",
        "glass": _macro_glass_text(item) if item_type == "window" else "",
        "fin_type": _normalize_comment_whitespace(item.get("fin_type")),
        "color": _macro_window_color_text(item) if item_type == "window" else "",
        # Series/model is in description for both door and window formats.
        "series": "",
        # Door comments should not inherit window-only gas/coating tokens.
        "argon": _macro_argon_text(item) if item_type == "window" else "",
        "lowe": _macro_lowe_text(item) if item_type == "window" else "",
        "notes": _normalize_comment_whitespace(item.get("notes")),
    }


def _join_comment_components(components: dict[str, str]) -> str:
    """Join non-empty comment components preserving canonical order and uniqueness."""
    ordered_keys = ("vendor", "frame", "fin_type", "color", "glass", "series", "argon", "lowe", "notes")
    deduped: list[str] = []
    seen: set[str] = set()
    for key in ordered_keys:
        part = str(components.get(key) or "").strip()
        if not part:
            continue
        normalized_key = _comment_match_key(part)
        if normalized_key in seen:
            continue
        seen.add(normalized_key)
        deduped.append(part)
    return " | ".join(deduped)


def _split_note_fragments(note_text: str) -> list[str]:
    """Split notes into comparable fragments while preserving slash terms like Ext/Int."""
    cleaned = _normalize_comment_whitespace(note_text)
    if not cleaned:
        return []

    # Do not split on commas so hinge location lists like
    # "TOP 7, MID 35-1/2, BOT 65-7/8" stay intact.
    parts = re.split(r"[|;]", cleaned)
    fragments: list[str] = []
    seen: set[str] = set()
    for part in parts:
        frag = _normalize_comment_whitespace(part).strip(" .:-")
        if not frag:
            continue
        key = _comment_match_key(frag)
        if key in seen:
            continue
        seen.add(key)
        fragments.append(frag)
    return fragments


def _common_note_fragment_keys(notes_by_item: list[str]) -> list[str]:
    """Find note fragment keys that appear in every item's notes."""
    if not notes_by_item:
        return []

    key_sets: list[set[str]] = []
    for note in notes_by_item:
        keys = { _comment_match_key(frag) for frag in _split_note_fragments(note) }
        key_sets.append(keys)

    if not key_sets:
        return []

    common = set(key_sets[0])
    for key_set in key_sets[1:]:
        common &= key_set

    if not common:
        return []

    # Preserve first-item fragment order for stable output.
    first_fragments = _split_note_fragments(notes_by_item[0])
    ordered_common = [
        _comment_match_key(frag)
        for frag in first_fragments
        if _comment_match_key(frag) in common
    ]
    return ordered_common


def _remove_note_fragment_keys(note_text: str, keys_to_remove: set[str]) -> str:
    """Remove globally-shared note fragments from one note string."""
    if not note_text:
        return ""
    if not keys_to_remove:
        return _normalize_comment_whitespace(note_text)

    kept: list[str] = []
    for frag in _split_note_fragments(note_text):
        if _comment_match_key(frag) in keys_to_remove:
            continue
        kept.append(frag)
    return " | ".join(kept)


def _build_macro_comment_text(item: dict) -> str:
    """Build the freeform AS400 comment text from line-item metadata."""
    return _join_comment_components(_macro_comment_components(item))


def _comment_context_key(comment_text: str) -> str:
    """Build the comparison key used to detect a change in item comment context."""
    return _comment_match_key(comment_text)


def _build_sequential_comment_plan(items: list[dict]) -> list[str]:
    """Return comment text only for the first item in each run of matching attributes.

    Consecutive items with the same AS400 comment attributes inherit the previous
    comment context, so only their Ctrl+Alt+S rows are entered. When a later item
    changes size/spec/comment attributes, a fresh comment block is entered before
    that item and becomes the active context for following items.
    """
    plan: list[str] = []
    previous_key = ""

    for item in items:
        comment_text = _build_macro_comment_text(item)
        key = _comment_context_key(comment_text)
        if _is_bypass_door_item(item):
            # Bypass doors need their own comment lines on every AS400 row,
            # even when consecutive bypass items share identical comments.
            plan.append(comment_text)
        elif key and key != previous_key:
            plan.append(comment_text)
        else:
            plan.append("")
        previous_key = key

    return plan


def _comment_tab_order() -> list[int]:
    """Return AS400 comment field tab order as 1-based field numbers.

    Default order matches observed host behavior in this environment.
    Override with AS400_COMMENT_TAB_ORDER="1,2,3,4,5,6" if needed.
    """
    raw = str(os.environ.get("AS400_COMMENT_TAB_ORDER", "1,2,3,5,4,6") or "1,2,3,5,4,6").strip()
    parsed: list[int] = []
    for piece in raw.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            value = int(piece)
        except Exception:
            continue
        if 1 <= value <= 6 and value not in parsed:
            parsed.append(value)

    # Ensure we always return six unique fields.
    for fallback in (1, 2, 3, 4, 5, 6):
        if fallback not in parsed:
            parsed.append(fallback)

    return parsed[:6]


def _remap_comment_lines_for_tab_order(comment_lines: list[str], max_fields: int) -> list[str]:
    """Map visual comment lines to actual tab-visit order fields."""
    visual_lines = (comment_lines[:max_fields] + [""] * max_fields)[:max_fields]
    order = _comment_tab_order()
    # tab_lines[index] = text to type on that tab position.
    tab_lines = [""] * max_fields
    for tab_pos in range(max_fields):
        visual_field_number = order[tab_pos] if tab_pos < len(order) else (tab_pos + 1)
        visual_idx = max(1, min(max_fields, visual_field_number)) - 1
        tab_lines[tab_pos] = visual_lines[visual_idx]
    return tab_lines


def _comment_match_key(comment_text: str) -> str:
    """Build case/whitespace-insensitive comparison key for comment grouping."""
    return _normalize_comment_whitespace(comment_text).lower()


def _compute_comment_entry_plan(comment_texts: list[str]) -> list[bool]:
    """Plan which comment texts should be entered (first non-empty occurrence only)."""
    if not comment_texts:
        return []

    seen_non_empty: set[str] = set()
    plan: list[bool] = []
    for text in comment_texts:
        key = _comment_match_key(text)
        if not key:
            plan.append(False)
            continue

        if key in seen_non_empty:
            plan.append(False)
            continue

        seen_non_empty.add(key)
        plan.append(True)

    return plan


def _split_comment_into_fields(comment_text: str, max_fields: int = 6, field_max_chars: int = 30) -> list[str]:
    """Split comment text into AS400 fields without breaking words when possible."""
    if not str(comment_text or "").strip():
        return []

    comment_text = str(comment_text)
    # Preserve explicit multiline preview text exactly when present. For
    # single-line payloads, wrap by field length instead of forcing pipe breaks.
    preserve_multiline = "\n" in comment_text
    if not preserve_multiline:
        comment_text = re.sub(r"\b(HINGE:)\s*(TOP\b)", r"\1\n\2", comment_text, flags=re.IGNORECASE)

    def _wrap_single_line(raw_line: str) -> list[str]:
        cleaned_line = _normalize_comment_whitespace(raw_line)
        if not cleaned_line:
            return []

        words = cleaned_line.split(" ")
        wrapped: list[str] = []
        current = ""

        for word in words:
            if not word:
                continue

            if len(word) > field_max_chars:
                if current:
                    wrapped.append(current)
                    current = ""

                start = 0
                while start < len(word):
                    piece = word[start:start + field_max_chars]
                    start += field_max_chars
                    if start >= len(word):
                        current = piece
                    else:
                        wrapped.append(piece)
                continue

            candidate = word if not current else f"{current} {word}"
            if len(candidate) <= field_max_chars:
                current = candidate
                continue

            wrapped.append(current)
            current = word

        if current:
            wrapped.append(current)

        return wrapped

    # Preserve explicit preview line boundaries when present, but keep paired
    # door attributes together when they fit the AS400 field.
    source_lines = comment_text.splitlines() if "\n" in comment_text else [comment_text]
    compacted_lines: list[str] = []
    index = 0
    while index < len(source_lines):
        current_line = _normalize_comment_whitespace(source_lines[index])
        next_line = _normalize_comment_whitespace(source_lines[index + 1]) if index + 1 < len(source_lines) else ""
        current_key = current_line.upper()
        next_key = next_line.upper()
        if (
            current_key.startswith("SWING:")
            and next_key.startswith("JAMB:")
            and len(f"{current_line} | {next_line}") <= field_max_chars
        ):
            compacted_lines.append(f"{current_line} | {next_line}")
            index += 2
            continue
        compacted_lines.append(source_lines[index])
        index += 1

    source_lines = compacted_lines
    out_lines: list[str] = []
    for source_line in source_lines:
        for wrapped_line in _wrap_single_line(source_line):
            out_lines.append(wrapped_line)
    return out_lines


def _clear_current_field_without_selection(max_chars: int = 64) -> None:
    """Clear current input field using Home + numpad plus (AS400 clear-field behavior)."""
    pyautogui.press("home")
    try:
        # Numpad '+' key name in PyAutoGUI is usually "add".
        pyautogui.press("add")
    except Exception:
        # Fallback for environments/keyboards where numpad key names differ.
        pyautogui.press("delete", presses=max_chars)


def _populate_macro_comment_fields(
    comment_text: str,
    field_max_chars: int = 30,
    max_fields: int = 6,
    allow_post_f9_cleanup: bool = False,
    cleanup_tab_offset: int = 0,
) -> None:
    """Open AS400 comment fields (F8 twice) and fill wrapped lines in 6-line batches."""
    comment_lines = _split_comment_into_fields(comment_text, max_fields=max_fields, field_max_chars=field_max_chars)
    if not comment_lines:
        print(">>> [KEYSTROKE] No comment text resolved from fin type/argon/low-e/notes; skipping F8 comment fields")
        return

    f8_delay = float(os.environ.get("AS400_COMMENT_F8_DELAY", "0.15") or "0.15")
    tab_delay = float(os.environ.get("AS400_COMMENT_TAB_DELAY", "0.1") or "0.1")
    type_interval = float(os.environ.get("AS400_COMMENT_TYPE_INTERVAL", "0.03") or "0.03")

    total_lines = len(comment_lines)
    single_f8_mode = (
        total_lines < max_fields
        and str(os.environ.get("AS400_COMMENT_SINGLE_F8_MODE", "1") or "1").strip().lower()
        in {"1", "true", "yes", "on"}
    )
    if single_f8_mode:
        print(
            f">>> [KEYSTROKE] Writing {total_lines} AS400 comment line(s) with single-F8 mode "
            "(no delete cleanup)"
        )
        for line_index, line_text in enumerate(comment_lines, start=1):
            pyautogui.press("f8")
            time.sleep(f8_delay)
            if line_text:
                pyautogui.typewrite(line_text, interval=type_interval)
            pyautogui.press("enter")
            time.sleep(tab_delay)
            pyautogui.press("f9")
            time.sleep(tab_delay)
        return

    total_batches = max(1, (total_lines + max_fields - 1) // max_fields)
    print(
        f">>> [KEYSTROKE] Writing {total_lines} AS400 comment line(s) across {total_batches} batch(es) "
        f"(max {max_fields} lines per batch, {field_max_chars} chars per line)"
    )

    for batch_index, start in enumerate(range(0, total_lines, max_fields), start=1):
        tab_lines = comment_lines[start:start + max_fields]
        used_fields = max(1, len(tab_lines))

        print(f">>> [KEYSTROKE] Opening comment entry fields with F8 x2 (batch {batch_index}/{total_batches})...")
        pyautogui.press("f8")
        time.sleep(f8_delay)
        pyautogui.press("f8")
        time.sleep(f8_delay)

        for index in range(used_fields):
            line_text = tab_lines[index] if index < len(tab_lines) else ""
            if line_text:
                pyautogui.typewrite(line_text, interval=type_interval)
            # AS400 auto-advances on exact-width lines, so avoid a double advance.
            if len(line_text) >= field_max_chars:
                print(
                    f">>> [KEYSTROKE] Batch {batch_index} line {index + 1} reached {field_max_chars} chars; "
                    "relying on AS400 auto-advance"
                )
            else:
                # TAB advances to the next AS400 comment line.
                pyautogui.press("tab")
                time.sleep(tab_delay)

        # Commit entered comment text first.
        pyautogui.press("enter")
        time.sleep(tab_delay)

        # Close comment view before any optional post-processing or next batch.
        pyautogui.press("f9")
        time.sleep(tab_delay)

        # Optional post-F9 row cleanup (global comments only by default).
        # Disabled for item-specific comments due to paging/layout instability risk.
        separator_fields = 1 if used_fields < max_fields else 0
        extra_fields = max(0, max_fields - used_fields - separator_fields)
        is_last_batch = batch_index == total_batches
        if separator_fields and is_last_batch:
            print(
                f">>> [KEYSTROKE] Leaving {separator_fields} blank separator comment line "
                "between comments and next SKU row"
            )
        post_f9_cleanup_enabled = (
            allow_post_f9_cleanup
            and str(os.environ.get("AS400_ENABLE_POST_F9_CLEANUP", "1") or "1").strip().lower()
            in {"1", "true", "yes", "on"}
        )
        if post_f9_cleanup_enabled and is_last_batch and extra_fields:
            tabs_to_target_delete_area = used_fields + 1 + max(0, int(cleanup_tab_offset))
            d_presses = extra_fields
            enter_presses = extra_fields + 1

            print(
                f">>> [KEYSTROKE] Removing {extra_fields} unused comment line(s) after F9 "
                f"(tab x{tabs_to_target_delete_area}, d x{d_presses}, enter x{enter_presses})"
            )

            pyautogui.press("tab", presses=tabs_to_target_delete_area)
            time.sleep(tab_delay)

            pyautogui.press("d", presses=d_presses)
            time.sleep(tab_delay)

            pyautogui.press("enter", presses=enter_presses)
            time.sleep(tab_delay)
        elif extra_fields and is_last_batch:
            reason = "disabled until AS400 line-delete navigation is remapped" if allow_post_f9_cleanup else "not allowed for this comment block"
            print(
                f">>> [KEYSTROKE] Skipping post-F9 cleanup for {extra_fields} unused comment line(s): {reason}"
            )

    # All comment batches have been entered in order.
    return


def _insert_macro_blank_separator_line() -> None:
    """Create one empty AS400 comment row after the submitted SKU row."""
    f8_delay = float(os.environ.get("AS400_COMMENT_F8_DELAY", "0.15") or "0.15")
    tab_delay = float(os.environ.get("AS400_COMMENT_TAB_DELAY", "0.1") or "0.1")
    print(">>> [KEYSTROKE] Adding one blank separator line after submitted SKU row")
    pyautogui.press("f8")
    time.sleep(f8_delay)
    pyautogui.press("enter")
    time.sleep(tab_delay)
    pyautogui.press("f9")
    time.sleep(tab_delay)


def _as400_row_plan_enabled() -> bool:
    """When set, the Ctrl+Alt+S dialog fields are typed from the web app's row
    plan (single source of truth) instead of being rebuilt here. See the
    'Making the Order Tracker editable' plan, Step 1."""
    value = (os.environ.get("AS400_USE_ROW_PLAN", "0") or "0").strip().lower()
    return value in ("1", "true", "yes", "on")


# Set once per automation run by launch_ibm_with_details; read by
# run_vendor_sku_macro_dialog, which sits several call layers down. The desktop
# helper runs one automation at a time so a module-level stash is safe here.
_CURRENT_AS400_ROW_PLAN: list[dict] | None = None


def _row_plan_entry(as400_row_plan, item_index: int) -> dict | None:
    """1-based item_index -> plan row, or None if unusable."""
    if not isinstance(as400_row_plan, list):
        return None
    idx = item_index - 1
    if 0 <= idx < len(as400_row_plan) and isinstance(as400_row_plan[idx], dict):
        return as400_row_plan[idx]
    return None


def run_vendor_sku_macro_dialog(
    vendor_sku: str | int | None,
    line_items: list[dict] | None = None,
    needs_prefit: bool = False,
    prefit_meta: dict | None = None,
    as400_row_plan: list[dict] | None = None,
) -> bool:
    """Open custom AS400 macro dialog (Ctrl+Alt+S) and fill first field with vendor SKU."""
    resolved_sku = _resolve_vendor_sku_for_macro(vendor_sku, line_items)
    if as400_row_plan is None:
        as400_row_plan = _CURRENT_AS400_ROW_PLAN
    use_row_plan = _as400_row_plan_enabled() and isinstance(as400_row_plan, list) and as400_row_plan
    if use_row_plan:
        print(f">>> [ROW PLAN] AS400_USE_ROW_PLAN on - typing dialog fields from web app row plan ({len(as400_row_plan)} rows)")
    open_delay = float(os.environ.get("AS400_VENDOR_DIALOG_OPEN_DELAY", "1.25") or "1.25")
    field_delay = float(os.environ.get("AS400_VENDOR_DIALOG_FIELD_DELAY", "0.25") or "0.25")
    post_prefit_delay = float(os.environ.get("AS400_PREFIT_POST_SKU_DELAY", "0.45") or "0.45")

    if isinstance(line_items, list) and any(isinstance(item, dict) for item in line_items):
        items_to_process = [item for item in line_items if isinstance(item, dict)]
    else:
        items_to_process = [_first_item_for_macro(line_items)]

    sequential_comment_plan = _build_sequential_comment_plan(items_to_process)
    has_prefit_preview_item = any(
        needs_prefit and _looks_like_door_item(item) and _item_has_prefit_style(item)
        for item in items_to_process
    )
    if has_prefit_preview_item:
        print(">>> [KEYSTROKE] Prefit preview item detected; prefit comments will be handled per item.")

    for item_index, item in enumerate(items_to_process, start=1):
        is_bom_item = bool(item.get("bom_enabled"))
        next_comment_to_write = ""
        if item_index < len(items_to_process):
            next_item = items_to_process[item_index]
            next_is_prefit_preview = needs_prefit and _looks_like_door_item(next_item) and _item_has_prefit_style(next_item)
            if not next_is_prefit_preview:
                next_comment_to_write = sequential_comment_plan[item_index] if item_index < len(sequential_comment_plan) else ""
        item_sku = str(item.get("vendor_sku") or item.get("sku") or "").strip() or resolved_sku
        description_text = _build_macro_description(item)
        um_text = _macro_um_text(item)
        price_text = _macro_price_text(item)
        quantity_text = _macro_quantity_text(item)

        # Delivery line: Ctrl+Alt+D is self-contained (the macro types the
        # SKU / qty / price itself), so there are no dialog fields to resolve.
        is_delivery_item = bool(item.get("is_delivery"))

        # Step 1: when enabled, the web app's row plan is authoritative for the
        # five Ctrl+Alt+S dialog fields. Comments still flow via the existing
        # as400_comment_authoritative path below.
        plan_row = _row_plan_entry(as400_row_plan, item_index) if use_row_plan else None
        if plan_row is not None:
            item_sku = str(plan_row.get("sku") or "").strip() or item_sku
            description_text = str(plan_row.get("description") or "")
            um_text = str(plan_row.get("um") or "").strip() or "EA"
            price_text = str(plan_row.get("price") or "")
            plan_qty = plan_row.get("qty")
            quantity_text = str(plan_qty) if plan_qty not in (None, "") else quantity_text
            print(
                f">>> [ROW PLAN] item {item_index}: sku={item_sku!r} desc={description_text!r} "
                f"um={um_text!r} price={price_text!r} qty={quantity_text!r}"
            )

        # Resolve per-item comments once so we can place them before or after
        # the macro dialog based on BOM behavior.
        comment_to_write = ""
        if needs_prefit and _looks_like_door_item(item) and _item_has_prefit_style(item):
            comment_to_write = ""
        else:
            comment_to_write = sequential_comment_plan[item_index - 1] if (item_index - 1) < len(sequential_comment_plan) else ""

        prefit_item_comment = ""
        if needs_prefit and _looks_like_door_item(item) and _item_has_prefit_style(item):
            prefit_item_comment = _build_prefit_comment_preview(item)
            if prefit_item_comment:
                print(">>> [KEYSTROKE] Writing AS400 comment preview for prefit door item before Ctrl+Alt+S...")
                _populate_macro_comment_fields(
                    prefit_item_comment,
                    field_max_chars=30,
                    max_fields=6,
                    allow_post_f9_cleanup=False,
                )

        # Default behavior: comments first, then macro dialog.
        # BOM exception: comments are entered after the macro dialog submit.
        if comment_to_write and not is_bom_item:
            _populate_macro_comment_fields(
                comment_to_write,
                field_max_chars=30,
                max_fields=6,
                allow_post_f9_cleanup=True,
            )

        # Delivery: Ctrl+Alt+D is the WHOLE action - the AS400 macro enters the
        # delivery SKU / qty / price itself; there is no dialog to fill.
        if is_delivery_item:
            print(f">>> [KEYSTROKE] Delivery line {item_index}/{len(items_to_process)}: pressing Ctrl+Alt+D (macro fills SKU/qty/price)...")
            pyautogui.hotkey("ctrl", "alt", "d")
            time.sleep(float(os.environ.get("AS400_DELIVERY_SETTLE", "2") or "2"))
            continue

        macro_hotkey = "n" if bool(item.get("no_cost")) else "s"
        print(
            f">>> [KEYSTROKE] Opening AS400 macro dialog with Ctrl+Alt+{macro_hotkey.upper()} "
            f"for item {item_index}/{len(items_to_process)}..."
        )
        pyautogui.hotkey("ctrl", "alt", macro_hotkey)
        time.sleep(open_delay)

        if item_sku:
            print(f">>> [KEYSTROKE] Typing vendor SKU '{item_sku}' into first dialog field...")
            pyautogui.typewrite(item_sku, interval=.08)
        else:
            print(">>> [KEYSTROKE] No vendor SKU resolved; macro dialog opened without auto-filled SKU")

        # Field 2: description
        pyautogui.press("tab")
        time.sleep(field_delay)
        if description_text:
            print(f">>> [KEYSTROKE] Typing description '{description_text}'")
            pyautogui.typewrite(description_text, interval=.04)
        else:
            print(">>> [KEYSTROKE] No description resolved for macro field 2")

        # Field 3: U/M
        pyautogui.press("tab")
        time.sleep(field_delay)
        print(f">>> [KEYSTROKE] Typing U/M '{um_text}'")
        pyautogui.typewrite(um_text, interval=.04)

        # Field 4: price
        pyautogui.press("tab")
        time.sleep(field_delay)
        if price_text:
            print(f">>> [KEYSTROKE] Typing price '{price_text}'")
            pyautogui.typewrite(price_text, interval=.04)
        else:
            print(">>> [KEYSTROKE] No price resolved for macro field 4")

        # Field 5: quantity
        pyautogui.press("tab")
        time.sleep(field_delay)
        print(f">>> [KEYSTROKE] Typing quantity '{quantity_text}'")
        pyautogui.typewrite(quantity_text, interval=.04)

        # Submit the SKU dialog row before entering F8 comments.
        submit_tabs = 0 if macro_hotkey == "n" else 1
        if submit_tabs:
            pyautogui.press("tab", presses=submit_tabs)
            time.sleep(field_delay)
        pyautogui.press("enter")

        submit_wait_seconds = float(os.environ.get("AS400_VENDOR_DIALOG_SUBMIT_WAIT", "3") or "3")
        print(f">>> [KEYSTROKE] Waiting {submit_wait_seconds:.1f}s for item submit before follow-up actions...")
        time.sleep(submit_wait_seconds)

        # Prefit labor must be entered after the Ctrl+Alt+S row is submitted.
        if needs_prefit:
            if _looks_like_door_item(item) and _item_has_prefit_style(item):
                current_item_sku = str(item.get("sku") or item.get("vendor_sku") or "").strip()
                if current_item_sku not in {PREFIT_LABOR_SKU_1_3_8, PREFIT_LABOR_SKU_1_3_4}:
                    labor_sku = _prefit_labor_sku_for_item(item, prefit_meta)
                    print(f">>> [KEYSTROKE] Typing prefit labor SKU '{labor_sku}' after item submit")
                    pyautogui.typewrite(labor_sku, interval=.08)
                    time.sleep(post_prefit_delay)
                    pyautogui.press("enter")
                    time.sleep(post_prefit_delay)
                    labor_qty_text = _macro_quantity_text(item)
                    print(f">>> [KEYSTROKE] Typing prefit labor quantity '{labor_qty_text}'")
                    pyautogui.typewrite(labor_qty_text, interval=.04)
                    time.sleep(post_prefit_delay)
                    pyautogui.press("tab")
                    time.sleep(post_prefit_delay)
                    pyautogui.press("enter")
                    time.sleep(post_prefit_delay)
                else:
                    print(
                        f">>> [KEYSTROKE] Prefit labor SKU inject skipped for item {item_index}/{len(items_to_process)}: "
                        f"item already uses labor SKU '{current_item_sku}'"
                    )
            else:
                print(
                    f">>> [KEYSTROKE] Prefit labor SKU inject skipped for item {item_index}/{len(items_to_process)}: "
                    "item is not an explicit Prefit-style door"
                )
        else:
            print(
                f">>> [KEYSTROKE] Prefit labor SKU inject skipped for item {item_index}/{len(items_to_process)}: "
                "needs_prefit is false"
            )

        if comment_to_write and is_bom_item:
            _populate_macro_comment_fields(
                comment_to_write,
                field_max_chars=30,
                max_fields=6,
                allow_post_f9_cleanup=True,
                cleanup_tab_offset=1,
            )
        elif comment_to_write and not is_bom_item:
            print(
                f">>> [KEYSTROKE] Skipping post-submit comments for item {item_index}/{len(items_to_process)} "
                "(already entered before macro)"
            )
        else:
            print(f">>> [KEYSTROKE] Skipping F8 comments for item {item_index}/{len(items_to_process)} (already covered by global/shared comments)")

        if next_comment_to_write:
            _insert_macro_blank_separator_line()

    return True

def _write_line_item_payload(items: list[dict]) -> str:
    """Write normalized line items to TSV temp file for AHK macro."""
    payload_dir = Path(tempfile.gettempdir()) / "order_tracker_as400"
    payload_dir.mkdir(parents=True, exist_ok=True)
    payload_path = payload_dir / f"quote_items_{int(time.time())}.tsv"
    with payload_path.open("w", encoding="utf-8", newline="") as f:
        f.write("index\tquantity\tsku\tsize\tdescription\tas400_description\tum\tprice\n")
        for it in items:
            row = [
                str(it.get("index", "")),
                str(it.get("quantity", "")),
                str(it.get("sku", "")),
                str(it.get("size", "")),
                str(it.get("description", "")),
                str(it.get("as400_description", "")),
                str(it.get("um", "EA")),
                str(it.get("price", "")),
            ]
            f.write("\t".join(s.replace("\t", " ").replace("\n", " ") for s in row) + "\n")
    return str(payload_path)

def run_quote_line_items(line_items: list[dict] | None, vendor_sku: str | int | None = None, needs_prefit: bool = False, prefit_meta: dict | None = None) -> bool:
    """Enter line items via macro or Python fallback."""
    normalized = _normalize_quote_line_items(line_items, vendor_sku, needs_prefit, prefit_meta)
    if not normalized:
        print(">>> No line items found for AS400 quote entry; skipping item-entry stage")
        return True

    payload_path = _write_line_item_payload(normalized)
    print(f">>> Prepared {len(normalized)} line items for quote entry")
    print(f">>> Line-item payload: {payload_path}")

    if _run_macro_script("quote_items", [payload_path]):
        print(">>> Line items entered via macro: quote_items.ahk")
        return True

    py_items_enabled = (os.environ.get("AS400_ENABLE_PY_LINEITEMS", "0") or "0").strip().lower() in ("1", "true", "yes")
    if not py_items_enabled:
        print(">>> quote_items.ahk not found/failed, and AS400_ENABLE_PY_LINEITEMS is OFF; skipping Python item entry")
        return False

    type_interval = float(os.environ.get("AS400_TYPE_INTERVAL", "0.15") or "0.15")
    step_delay = float(os.environ.get("AS400_ITEM_STEP_DELAY", "0.45") or "0.45")
    print(">>> Entering line items via Python fallback")

    for it in normalized:
        sku = str(it.get("sku") or "").strip()
        qty = str(it.get("quantity") or "1")
        as400_desc = str(it.get("as400_description") or "")[:31]
        price = str(it.get("price") or "").strip()
        print(f">>> Item {it.get('index')}: sku={sku!r}, qty={qty!r}")
        if not sku:
            print(">>>   Skipped: missing sku/model")
            continue
        pyautogui.typewrite(sku, interval=type_interval)
        time.sleep(step_delay)
        pyautogui.press("enter")
        time.sleep(step_delay)
        _clear_current_field_without_selection(max_chars=AS400_DESCRIPTION_MAX_CHARS + 8)
        time.sleep(step_delay)
        if as400_desc:
            pyautogui.typewrite(as400_desc, interval=type_interval)
        time.sleep(step_delay)
        pyautogui.press("tab")
        time.sleep(step_delay)
        if price in {"0", "0.0", "0.00"}:
            pyautogui.typewrite("NC", interval=type_interval)
        time.sleep(step_delay)
        pyautogui.press("tab")
        time.sleep(step_delay)
        if price:
            pyautogui.typewrite(price, interval=type_interval)
        time.sleep(step_delay)
        pyautogui.press("enter")
        time.sleep(step_delay)
        pyautogui.typewrite(qty, interval=type_interval)
        time.sleep(step_delay)
        pyautogui.press("tab")
        time.sleep(step_delay)
        pyautogui.press("enter")
        time.sleep(step_delay)
    return True

def append_delivery_line(*_args, **_kwargs) -> bool:
    """Focus the open AS400 emulator and add ONE delivery line via Ctrl+Alt+D.

    For "add delivery at the very end" - the quote/order is already on screen at
    the line-item entry field; nothing is logged in or navigated. Ctrl+Alt+D is
    self-contained (types SKU 040619 / qty 1 / price $125 itself).
    """
    _focus_emulator_window()
    time.sleep(0.5)
    run_vendor_sku_macro_dialog(DELIVERY_LINE_SKU, line_items=[_delivery_line_item()])
    return True


def launch_ibm_with_details(customer: str, phone: str, job_name: str, quote_number: str,
                            size: str, jamb: str, color: str, script: str = "quote",
                            cancelled: bool = False, location: str = "Felton", session: str = "Session 1",
                            customer_number: str = "", has_account: bool = False,
                            order_stage: str = "",
                            line_items: list[dict] | None = None,
                            vendor_sku: str | int | None = None,
                            needs_prefit: bool = False,
                            prefit_meta: dict | None = None,
                            as400_row_plan: list[dict] | None = None):
    """Main entry point for AS400 automation, supporting full quote flow with line items."""
    global _CURRENT_AS400_ROW_PLAN
    _CURRENT_AS400_ROW_PLAN = as400_row_plan if isinstance(as400_row_plan, list) and as400_row_plan else None
    base_path = r"C:\Users\tim.alban\OneDrive - BLDR\Documents\IBM\iAccessClient\Emulator"
    key = (location, session)
    filename = HOD_FILES.get(key)

    if not filename:
        print(f">>> Invalid location/session: {location} / {session}")
        return

    hod_file = os.path.join(base_path, filename)
    if not os.path.exists(hod_file):
        print(f">>> HOD file not found: {hod_file}")
        return

    if not _open_hod_session(hod_file):
        print(f">>> Failed to open emulator session: {hod_file}")
        logger.error("Unable to open emulator session for HOD file: %s", hod_file)
        return
    
    print(">>> Running launch_ibm_with_details from", __file__)
    print(">>> cancelled flag is:", cancelled)
    print(">>> has_account flag is:", has_account)
    print(">>> customer_number is:", customer_number)

    time.sleep(5)  # wait for emulator to open

    if cancelled:
        print(">>> IBM launch aborted after delay — window was closed")
        return

    # Focus the emulator window to ensure keystrokes are received
    _focus_emulator_window()

    mode = _as400_mode()
    print(f">>> AS400 automation mode: {mode}")
    common_args = [
        customer or "",
        phone or "",
        job_name or "",
        quote_number or "",
        size or "",
        jamb or "",
        color or "",
        customer_number or "",
        "1" if has_account else "0",
        location or "",
        session or "",
        script or "",
        order_stage or "",
    ]

    # Macro-only mode
    if mode == "macro":
        print(f">>> Trying macro-only script: {script}.ahk")
        if _run_macro_script(script, common_args):
            print(f">>> Automation path used: macro ({script}.ahk)")
            return
        print(">>> Macro script unavailable/failed; falling back to Python keystrokes")
        logger.warning("Macro-only mode enabled, but macro failed/missing; falling back to Python")

    prep_macro_succeeded = False

    # Hybrid mode
    if mode == "hybrid":
        prep_name = f"{script}_prep"
        print(f">>> Trying hybrid prep macro: {prep_name}.ahk")
        if _run_macro_script(prep_name, common_args):
            prep_macro_succeeded = True
            print(f">>> Automation path used: hybrid (macro prep + Python)")
        else:
            print(">>> Prep macro not found/failed; continuing with Python-only sequence")

    if mode == "python":
        print(">>> Automation path used: Python-only keystrokes")

    if script == "quote":
        print(f">>> Running Python sequence for script: {script}")
        result = run_quote_login_keystrokes(
            customer,
            phone,
            job_name,
            quote_number,
            size,
            jamb,
            color,
            customer_number,
            has_account,
            skip_login=prep_macro_succeeded,
            line_items=line_items,
            vendor_sku=vendor_sku,
            needs_prefit=needs_prefit,
            prefit_meta=prefit_meta,
            location=location,
        )
        # Return the captured quote number (or True/False if capture failed)
        return result
    elif script == "charge_sale":
        print(f">>> Running Python sequence for script: {script}")
        return run_charge_sale_keystrokes(
            customer,
            phone,
            job_name,
            quote_number,
            size,
            jamb,
            color,
            customer_number=customer_number,
            has_account=has_account,
            order_stage=order_stage,
            line_items=line_items,
            vendor_sku=vendor_sku,
        )
    elif script == "special_order":
        print(f">>> Running Python sequence for script: {script}")
        return run_special_order_keystrokes(customer, phone, job_name, quote_number, size, jamb, color)
    elif script == "open_quote":
        run_open_quote_keystrokes(quote_number)
    elif script == "open_charge_sale":
        run_open_charge_sale_keystrokes(quote_number)
    elif script == "open_special_order":
        run_open_special_order_keystrokes(quote_number)
    elif script == "delivery_line":
        # Append a single delivery line (Ctrl+Alt+D) to whatever quote/order is
        # already open on screen - no login, no customer header.
        print(">>> Running delivery-line append (Ctrl+Alt+D)")
        first = line_items[0] if isinstance(line_items, list) and line_items and isinstance(line_items[0], dict) else {}
        run_vendor_sku_macro_dialog(
            DELIVERY_LINE_SKU,
            line_items=[_delivery_line_item(first)],
        )
        return True


# Allow toggling PyAutoGUI failsafe via environment variable
try:
    env_val = os.environ.get("PYAUTOGUI_FAILSAFE", "1")
    pyautogui.FAILSAFE = False if env_val in ("0", "false", "False") else True
except Exception:
    pyautogui.FAILSAFE = True


def _is_mouse_in_corner(threshold: int = 5) -> bool:
    """Return True if mouse is in upper-left corner (PyAutoGUI failsafe)."""
    try:
        x, y = pyautogui.position()
        return x <= threshold and y <= threshold
    except Exception:
        return False


def _get_mouse_position() -> tuple[int, int] | None:
    """Return the current mouse position when available."""
    try:
        x, y = pyautogui.position()
        return int(x), int(y)
    except Exception:
        return None


def _mouse_stays_in_corner(samples: int = 3, interval: float = 0.15, threshold: int = 5) -> bool:
    """Require repeated corner readings before treating the countdown as intentionally aborted."""
    for _ in range(samples):
        if not _is_mouse_in_corner(threshold=threshold):
            return False
        time.sleep(interval)
    return True


def _countdown_and_check(seconds: int = 3):
    """Countdown with abort option (move mouse to corner to abort)."""
    try:
        if seconds <= 0:
            return
        print(f">>> Automation starting in {seconds} seconds. Move mouse to upper-left corner to abort.")
        for i in range(seconds, 0, -1):
            print(f">>> Starting in {i}...")
            if _STARTUP_MOUSE_TRACE_ENABLED:
                mouse_position = _get_mouse_position()
                print(f">>> [KEYSTROKE] Startup mouse position: {mouse_position}")
                logger.info("Startup mouse position during countdown %s: %s", i, mouse_position)
            time.sleep(1)
            if _STARTUP_ABORT_ENABLED:
                mouse_position = _get_mouse_position()
                if _mouse_stays_in_corner():
                    raise pyautogui.FailSafeException(f"Mouse in corner during startup countdown: {mouse_position}")
    except pyautogui.FailSafeException:
        raise
    except Exception:
        logger.exception("Unexpected error during countdown check")


def quote_login(salesman_number: str = "236"):
    """Login to DRMS and navigate to quote entry screen."""
    def should_tab_after_salesman(value: str) -> bool:
        setting = (os.environ.get("AS400_SALESMAN_TAB_AFTER_ENTRY", "auto") or "auto").strip().lower()
        if setting in ("1", "true", "yes", "on"):
            return True
        if setting in ("0", "false", "no", "off"):
            return False
        # Auto mode: many DRMS screens auto-advance after 3-digit salesman IDs.
        return len(str(value or "").strip()) <= 2

    print(f">>> [KEYSTROKE] Typing 'DRMS'...")
    pyautogui.typewrite("DRMS", interval=.1)
    print(f">>> [KEYSTROKE] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE] Typing 'DRMS' again...")
    pyautogui.typewrite("DRMS", interval=.1)
    print(f">>> [KEYSTROKE] Pressing ENTER 3 times...")
    pyautogui.press("enter", presses=3)
    print(f">>> [KEYSTROKE] Typing '01'...")
    pyautogui.typewrite("01", interval=.1)
    print(f">>> [KEYSTROKE] Pressing ENTER...")
    pyautogui.press("enter")
    print(f">>> [KEYSTROKE] Typing '05'...")
    pyautogui.typewrite("05", interval=.1)
    print(f">>> [KEYSTROKE] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE] Typing salesman number '{salesman_number}'...")
    pyautogui.typewrite(salesman_number, interval=.1)
    if should_tab_after_salesman(salesman_number):
        print(f">>> [KEYSTROKE] Pressing TAB after salesman entry...")
        pyautogui.press("tab")
    else:
        print(">>> [KEYSTROKE] Skipping TAB after salesman entry (auto mode)")
    print(f">>> [KEYSTROKE] Pressing ENTER...")
    pyautogui.press("enter")
    print(f">>> quote_login() completed!")


def enter_customer_info(customer, phone, job_name, customer_number=""):
    """Enter customer info for new customer (no account)."""
    print(f">>> [KEYSTROKE][no-account] customer='{customer}' phone='{phone}' job_name='{job_name}'")
    print(f">>> [KEYSTROKE][no-account] Waiting 1 second...")
    time.sleep(1)
    print(f">>> [KEYSTROKE][no-account] Pressing ENTER...")
    pyautogui.press("enter")
    print(f">>> [KEYSTROKE][no-account] Typing customer name '{customer}'...")
    pyautogui.typewrite(customer, interval=.1)
    print(f">>> [KEYSTROKE][no-account] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE][no-account] Typing 'Y'...")
    pyautogui.typewrite("Y", interval=.1)
    print(f">>> [KEYSTROKE][no-account] Typing customer name again...")
    pyautogui.typewrite(customer, interval=.1)
    print(f">>> [KEYSTROKE][no-account] Pressing TAB 10 times before address/phone block...")
    pyautogui.press("tab", presses=10)
    print(f">>> [KEYSTROKE][no-account] Typing customer name for address...")
    pyautogui.typewrite(customer, interval=.1)
    print(f">>> [KEYSTROKE][no-account] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE][no-account] Typing phone '{phone}'...")
    pyautogui.typewrite(phone, interval=.1)
    print(f">>> [KEYSTROKE][no-account] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE][no-account] Typing phone again...")
    pyautogui.typewrite(phone, interval=.1)
    print(f">>> [KEYSTROKE][no-account] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE][no-account] Pressing ENTER...")
    pyautogui.press("enter")
    print(f">>> enter_customer_info() completed!")


def enter_customer_info_with_account(customer, phone, job_name, customer_number):
    """Enter customer info when they have an existing account."""
    print(f">>> [KEYSTROKE][account] customer='{customer}' phone='{phone}' job_name='{job_name}' customer_number='{customer_number}'")
    print(f">>> [KEYSTROKE][account] Waiting 1 second...")
    time.sleep(1)
    print(f">>> [KEYSTROKE][account] Pressing TAB x2...")
    pyautogui.press("tab", presses=2)
    print(f">>> [KEYSTROKE][account] Typing customer_number '{customer_number}'...")
    pyautogui.typewrite(customer_number, interval=.1)
    print(f">>> [KEYSTROKE][account] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE][account] Pressing ENTER...")
    pyautogui.press("enter")
    print(f">>> [KEYSTROKE][account] Waiting 10 seconds for account lookup...")
    time.sleep(10)
    print(f">>> [KEYSTROKE][account] Typing customer '{customer}'...")
    pyautogui.typewrite(customer, interval=.1)
    print(f">>> [KEYSTROKE][account] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE][account] Typing 'Y'...")
    pyautogui.typewrite("Y", interval=.1)
    print(f">>> [KEYSTROKE][account] Pressing TAB...")
    pyautogui.press("tab")
    print(f">>> [KEYSTROKE][account] Typing '001'...")
    pyautogui.typewrite("001", interval=.1)
    post_001_sequence = str(
        os.environ.get("AS400_ACCOUNT_POST_001_SEQUENCE", "tab,enter,enter") or "tab,enter,enter"
    )
    post_001_delay = float(os.environ.get("AS400_ACCOUNT_POST_001_DELAY", "0.25") or "0.25")
    steps = [part.strip().lower() for part in post_001_sequence.split(",") if part.strip()]
    print(f">>> [KEYSTROKE][account] Post-001 sequence: {steps} (delay={post_001_delay}s between steps)")
    for step in steps:
        print(f">>> [KEYSTROKE][account] Pressing '{step}'...")
        pyautogui.press(step)
        time.sleep(post_001_delay)
    print(f">>> enter_customer_info_with_account() completed!")


def open_quote(quote_number):
    """Open an existing quote by number."""
    pyautogui.typewrite("DRMS", interval=.10)
    pyautogui.press("tab")
    pyautogui.typewrite("DRMS", interval=.10)
    pyautogui.press("enter", presses=3)
    pyautogui.typewrite("01", interval=.10)
    pyautogui.press("enter")
    pyautogui.typewrite("05", interval=.10)
    pyautogui.press("tab")
    pyautogui.typewrite("236", interval=.10)
    pyautogui.press("tab")
    
    pyautogui.press("enter")
    pyautogui.press("tab", interval=1)
    pyautogui.typewrite(str(quote_number), interval=0.2)
    pyautogui.press("tab")
    pyautogui.press("enter")


def create_chargesale(customer, phone, quote_number, customer_number="", has_account=False, order_stage="", line_items=None, vendor_sku=None):
    """Create a charge sale (invoice)."""
    customer_name = str(customer or "").strip()
    customer_phone = str(phone or "").strip()
    quote_ref = str(quote_number or "").strip()
    account_number = str(customer_number or "").strip()
    stage_normalized = str(order_stage or "").strip().upper()

    def maybe_run_charge_sale_item_prompt() -> None:
        """Open and populate Ctrl+Alt+S item prompt when item data exists."""
        has_items = isinstance(line_items, list) and any(isinstance(item, dict) for item in line_items)
        has_sku = bool(str(vendor_sku or "").strip())
        if not has_items and not has_sku:
            print(">>> [KEYSTROKE] No line-items/vendor SKU provided for charge sale prompt; skipping Ctrl+Alt+S item dialog")
            return
        print(">>> [KEYSTROKE] Opening charge sale item prompt (Ctrl+Alt+S)...")
        run_vendor_sku_macro_dialog(vendor_sku, line_items)

    def enter_quote_handoff_sequence() -> None:
        """Create charge sale from quote number using AS400 screen navigation."""
        pyautogui.press("tab", presses=4)
        pyautogui.typewrite(quote_ref, interval=0.2)
        pyautogui.press("tab", presses=2)
        pyautogui.press("x")
        pyautogui.press("enter")
        _trace_keystroke("pause", seconds=10, reason="choose job; press Enter manually")
        time.sleep(10)
        for tab_index in range(5):
            _trace_keystroke("step", name=f"post-job tab {tab_index + 1}/5")
            pyautogui.press("tab")
            time.sleep(0.25)
        if customer_name:
            pyautogui.typewrite(customer_name, interval=0.1)
        pyautogui.press("tab")
        pyautogui.press("enter")

    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("tab")
    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("enter", presses=3)
    pyautogui.typewrite("01", interval=.1)
    pyautogui.press("enter")
    pyautogui.typewrite("01", interval=.1)
    pyautogui.press("tab")
    pyautogui.typewrite("236", interval=.1)
    pyautogui.press("tab")
    pyautogui.press("enter")

    # Quote-created flow: source from quote number and continue (tab, quote, tab, enter).
    if stage_normalized == "QUOTE_CREATED" and quote_ref:
        enter_quote_handoff_sequence()
        maybe_run_charge_sale_item_prompt()
        return

    # Account flow: tab twice, enter customer number, tab, enter.
    if has_account and account_number:
        pyautogui.press("tab", presses=2)
        pyautogui.typewrite(account_number, interval=0.2)
        pyautogui.press("tab")
        pyautogui.press("enter")

        # Continue account flow with customer confirmation/details.
        if customer_name:
            pyautogui.typewrite(customer_name, interval=0.1)
        pyautogui.press("tab")
        pyautogui.press("y")
        pyautogui.press("tab", presses=3)
        if customer_name:
            pyautogui.typewrite(customer_name, interval=0.1)
        pyautogui.press("tab")
        if customer_phone:
            pyautogui.typewrite(customer_phone, interval=0.1)
        pyautogui.press("tab")
        pyautogui.press("enter")
        maybe_run_charge_sale_item_prompt()
        return

    # Non-account flow: continue with quote/reference handoff.
    if quote_ref:
        enter_quote_handoff_sequence()
        maybe_run_charge_sale_item_prompt()
        return
    else:
        logger.warning(">>> create_chargesale called without quote/invoice reference; opened charge sale screen without auto-filled document number")

    pyautogui.press("tab")
    pyautogui.press("enter")


def open_chargesale(invoice_number):
    """Open an existing charge sale / invoice."""
    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("tab")
    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("enter", presses=3)
    pyautogui.typewrite("04", interval=.1)
    pyautogui.press("enter")
    pyautogui.hotkey("shift", "tab")
    pyautogui.hotkey("shift", "tab")
    pyautogui.typewrite("61", interval=.1)
    pyautogui.press("tab", presses=2)

    order_number = str(invoice_number or "").strip()
    if order_number:
        pyautogui.typewrite(order_number, interval=0.2)
    pyautogui.press("tab")
    pyautogui.press("enter")


def create_specialorder(quote_number):
    """Create a special order."""
    print(f">>> [KEYSTROKE] create_specialorder started for quote {quote_number}")
    logger.info(">>> [KEYSTROKE] create_specialorder started for quote %s", quote_number)
    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("tab")
    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("enter", presses=3)
    pyautogui.typewrite("01", interval=.1)
    pyautogui.press("enter")
    pyautogui.typewrite("07", interval=.1)
    pyautogui.press("tab")
    pyautogui.typewrite("236", interval=.1)
    pyautogui.press("tab")
    pyautogui.press("enter")
    for i in range(4):
        print(f">>> [KEYSTROKE] Pressing TAB ({i + 1}/4) before quote number field")
        logger.info(">>> [KEYSTROKE] Pressing TAB (%s/4) before quote number field", i + 1)
        pyautogui.press("tab")
        time.sleep(0.1)
    pyautogui.typewrite(str(quote_number), interval=0.2)
    for i in range(2):
        print(f">>> [KEYSTROKE] Pressing TAB ({i + 1}/2) before final action")
        logger.info(">>> [KEYSTROKE] Pressing TAB (%s/2) before final action", i + 1)
        pyautogui.press("tab")
        time.sleep(0.1)
    pyautogui.press("X")
    print(">>> [KEYSTROKE] Pressed 'X' to complete special order action")
    logger.info(">>> [KEYSTROKE] Pressed 'X' to complete special order action")
    print(">>> [KEYSTROKE] Pressing ENTER (1/2) after X action")
    logger.info(">>> [KEYSTROKE] Pressing ENTER (1/2) after X action")
    pyautogui.press("enter")
    time.sleep(0.1)
    print(">>> [KEYSTROKE] Pressing ENTER (2/2) after X action")
    logger.info(">>> [KEYSTROKE] Pressing ENTER (2/2) after X action")
    pyautogui.press("enter")


def open_specialorder(invoice_number):
    """Open an existing special order."""
    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("tab")
    pyautogui.typewrite("DRMS", interval=.1)
    pyautogui.press("enter", presses=3)
    pyautogui.typewrite("01", interval=.1)
    pyautogui.press("enter")
    pyautogui.typewrite("07", interval=.1)
    pyautogui.press("tab")
    pyautogui.typewrite("236", interval=.1)
    pyautogui.press("tab")
    pyautogui.press("enter")
    pyautogui.press("tab")
    pyautogui.typewrite(str(invoice_number), interval=1)


def run_quote_login_keystrokes(customer, phone, job_name, quote_number, size, jamb, color, 
                               customer_number="", has_account=False, skip_login=False,
                               line_items=None, vendor_sku=None, needs_prefit=False, 
                               prefit_meta=None, location="Felton"):
    """Run the full quote entry sequence including line items."""
    salesman_number = _salesman_for_location(location)
    print(">>> ========================================")
    print(">>> STARTING QUOTE KEYSTROKE AUTOMATION")
    print(">>> ========================================")
    print(">>> Inside run_quote_login_keystrokes")
    print(">>> has_account:", has_account)
    print(">>> customer_number:", customer_number)
    print(">>> location:", location, "-> salesman:", salesman_number)
    print(">>> customer:", customer)
    print(">>> phone:", phone)
    print(">>> job_name:", job_name)
    print(">>> PyAutoGUI FAILSAFE enabled:", pyautogui.FAILSAFE)
    try:
        print(">>> Starting countdown...")
        _countdown_and_check(3)
        print(">>> Countdown complete! Beginning keystrokes...")
        if skip_login:
            print(">>> Skipping Python quote_login() because prep macro already handled login/navigation")
        else:
            print(">>> Calling quote_login() to type DRMS login sequence...")
            quote_login(salesman_number)
        print(">>> Login complete! Entering customer info...")
        if has_account and customer_number:
            print(">>> Calling enter_customer_info_with_account")
            enter_customer_info_with_account(customer, phone, job_name, customer_number)
            settle_seconds = float(os.environ.get("AS400_ACCOUNT_POST_CUSTOMER_SETTLE", "1.5") or "1.5")
            print(f">>> [KEYSTROKE] Account flow settle wait: {settle_seconds:.1f}s before Ctrl+Alt+S")
            time.sleep(settle_seconds)
        else:
            print(">>> Calling enter_customer_info")
            enter_customer_info(customer, phone, job_name, customer_number)

        print(">>> Running vendor SKU macro dialog step (Ctrl+Alt+S)...")
        run_vendor_sku_macro_dialog(vendor_sku, line_items, needs_prefit=needs_prefit, prefit_meta=prefit_meta)

        has_items = isinstance(line_items, list) and any(isinstance(item, dict) for item in line_items)
        if has_items:
            print(">>> Customer info entered! Line items handled via Ctrl+Alt+S dialog loop.")
        else:
            print(">>> Customer info entered! Processing line items...")
            run_quote_line_items(line_items, vendor_sku, needs_prefit, prefit_meta)
        print(">>> ========================================")
        print(">>> QUOTE AUTOMATION COMPLETED SUCCESSFULLY")
        print(">>> ========================================")

        print(">>> Attempting to capture quote number from AS400...")
        captured_quote = capture_quote_number_at_coordinates(row=2, col=14, length=6, retries=3)
        captured_total = _capture_quote_total()
        if captured_quote:
            print(f">>> ✅ Quote number captured: {captured_quote}")
            if captured_total is not None:
                print(f">>> ✅ Quote total captured: {captured_total:.2f}")
            else:
                print(">>> ⚠️ Quote total capture unavailable")
            return {
                "quote_number": captured_quote,
                "quote_total": captured_total,
            }

        print(">>> ⚠️ Could not capture quote number automatically")
        return True
            
    except pyautogui.FailSafeException:
        logger.warning("Quote keystrokes aborted due to PyAutoGUI failsafe (mouse in corner)")
        print(">>> ⚠️ AUTOMATION ABORTED - Mouse moved to corner!")
        return False
    except Exception:
        logger.exception("Unexpected error while running quote keystrokes")
        print(">>> ❌ AUTOMATION FAILED - See error above")
        return False


def run_quote_keystrokes(customer, phone, job_name, quote_number, size, jamb, color):
    """Compat wrapper for legacy calls."""
    return run_quote_login_keystrokes(customer, phone, job_name, quote_number, size, jamb, color)


def run_open_quote_keystrokes(quote_number):
    """Open an existing quote in the emulator."""
    logger.info(">>> run_open_quote_keystrokes called for quote %s", quote_number)
    try:
        _countdown_and_check(3)
        open_quote(quote_number)
    except pyautogui.FailSafeException:
        logger.warning("Open-quote keystrokes aborted due to PyAutoGUI failsafe")
        return False
    except Exception:
        logger.exception("Error opening quote in emulator")
        return False
    return True


def run_charge_sale_keystrokes(
    customer,
    phone,
    job_name,
    quote_number,
    size,
    jamb,
    color,
    customer_number="",
    has_account=False,
    order_stage="",
    line_items=None,
    vendor_sku=None,
):
    """Run charge sale entry sequence."""
    global _KEYSTROKE_TRACE_ENABLED
    previous_trace_enabled = _KEYSTROKE_TRACE_ENABLED
    _KEYSTROKE_TRACE_ENABLED = True
    print(f">>> [KEYTRACE] Charge Sale keystroke logging enabled. Log file: {_KEYSTROKE_TRACE_FILE}")
    logger.info(">>> [KEYTRACE] Charge Sale keystroke logging enabled. Log file: %s", _KEYSTROKE_TRACE_FILE)
    try:
        _trace_keystroke("charge_sale_start", customer=customer, quote_number=quote_number, stage=order_stage)
        _countdown_and_check(3)
        logger.info(
            ">>> Entered run_charge_sale_keystrokes with customer=%s phone=%s quote=%s has_account=%s customer_number=%s stage=%s",
            customer,
            phone,
            quote_number,
            has_account,
            customer_number,
            order_stage,
        )
        create_chargesale(
            customer,
            phone,
            quote_number,
            customer_number=customer_number,
            has_account=has_account,
            order_stage=order_stage,
            line_items=line_items,
            vendor_sku=vendor_sku,
        )

        print(">>> Attempting to capture invoice number from AS400...")
        captured_invoice = capture_quote_number_at_coordinates(row=2, col=14, length=6, retries=3)
        captured_total = _capture_quote_total()
        if captured_invoice:
            print(f">>> ✅ Invoice number captured: {captured_invoice}")
            if captured_total is not None:
                print(f">>> ✅ Invoice total captured: {captured_total:.2f}")
            else:
                print(">>> ⚠️ Invoice total capture unavailable")
            return {
                "invoice_number": captured_invoice,
                "invoice_total": captured_total,
            }

        print(">>> ⚠️ Could not capture invoice number automatically")
    except pyautogui.FailSafeException:
        logger.warning("Charge-sale keystrokes aborted due to PyAutoGUI failsafe")
        return False
    except Exception:
        logger.exception("Unexpected error while running charge-sale keystrokes")
        return False
    finally:
        _trace_keystroke("charge_sale_end")
        _KEYSTROKE_TRACE_ENABLED = previous_trace_enabled
        print(">>> [KEYTRACE] Charge Sale keystroke logging finished")
        logger.info(">>> [KEYTRACE] Charge Sale keystroke logging finished")
    return True


def run_open_charge_sale_keystrokes(invoice_number):
    """Open an existing charge sale / invoice in the emulator."""
    logger.info(">>> run_open_charge_sale_keystrokes called for invoice %s", invoice_number)
    try:
        _countdown_and_check(3)
        open_chargesale(invoice_number)
    except pyautogui.FailSafeException:
        logger.warning("Open charge-sale keystrokes aborted due to PyAutoGUI failsafe")
        return False
    except Exception:
        logger.exception("Error opening charge sale in emulator")
        return False
    return True


def run_special_order_keystrokes(customer, phone, job_name, quote_number, size, jamb, color):
    """Run special order entry sequence."""
    try:
        _countdown_and_check(3)
        logger.info(">>> Entered run_special_order_keystrokes with %s %s %s", customer, phone, quote_number)
        create_specialorder(quote_number)

        settle_seconds = float(os.environ.get("AS400_SPECIAL_ORDER_CAPTURE_SETTLE", "1.25") or "1.25")
        print(f">>> [CAPTURE] Waiting {settle_seconds:.2f}s before special-order capture...")
        time.sleep(settle_seconds)

        special_order_number_length = max(1, int(os.environ.get("AS400_SPECIAL_ORDER_NUMBER_LENGTH", "4") or "4"))

        print(">>> Attempting to capture special order number from AS400...")
        captured_special_order = capture_quote_number_at_coordinates(
            row=2,
            col=14,
            length=special_order_number_length,
            retries=3,
            allow_current_cursor_fallback=False,
        )
        captured_total = _capture_quote_total()
        if captured_special_order:
            print(f">>> ✅ Special order number captured: {captured_special_order}")
            if captured_total is not None:
                print(f">>> ✅ Special order total captured: {captured_total:.2f}")
            else:
                print(">>> ⚠️ Special order total capture unavailable")
            return {
                "special_order_number": captured_special_order,
                "special_order_total": captured_total,
            }

        print(">>> ⚠️ Could not capture special order number automatically")
    except pyautogui.FailSafeException:
        logger.warning("Special-order keystrokes aborted due to PyAutoGUI failsafe")
        return False
    except Exception:
        logger.exception("Unexpected error while running special-order keystrokes")
        return False
    return True


def run_open_special_order_keystrokes(invoice_number):
    """Open an existing special order in the emulator."""
    logger.info(">>> run_open_special_order_keystrokes called for invoice %s", invoice_number)
    try:
        _countdown_and_check(3)
        open_specialorder(invoice_number)
    except pyautogui.FailSafeException:
        logger.warning("Open special-order keystrokes aborted due to PyAutoGUI failsafe")
        return False
    except Exception:
        logger.exception("Error opening special order in emulator")
        return False
    return True
