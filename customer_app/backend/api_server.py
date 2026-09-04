"""
Customer Order API Server
Thin adapter between the customer-facing Flutter app and the real Order
Tracker (the Flask app at Desktop\\HTML_Order_Tracker). Order create/update
and customer/recent-order lookups are forwarded to the tracker's
customer-intake API (API-key authenticated) so submissions actually land
in the live tracker. Drafts and photo-upload staging stay local to this
service since they're pre-submission scratch state, not tracker data.
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import asyncio
import sqlite3
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
import base64
import requests

import email_service

# Add parent directory to path to import from main project
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# The Or-Pac quote automation scripts (Selenium-based, run as a subprocess
# rather than imported -- they do process-wide things like redirecting
# sys.stdout that would be unsafe to run inside this long-lived server).
SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "scripts"
OREPAC_USERNAME = os.environ.get("OREPAC_USERNAME", "").strip()
OREPAC_PASSWORD = os.environ.get("OREPAC_PASSWORD", "").strip()

try:
    from vendor_credentials import get_vendor_credentials, is_vendor_enabled
    AUTOMATION_AVAILABLE = True
except ImportError:
    AUTOMATION_AVAILABLE = False
    print("Warning: Vendor automation modules not available")

app = FastAPI(title="Customer Order API")

# Enable CORS for mobile app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your app's domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The real order tracker this app feeds into, and the shared secret for its
# customer-intake API. Both must be set to match the tracker's own config
# (ORDER_TRACKER_CUSTOMER_INTAKE_API_KEY env var on the tracker side).
TRACKER_BASE_URL = os.environ.get('ORDER_TRACKER_URL', 'http://localhost:5000').rstrip('/')
TRACKER_API_KEY = os.environ.get('ORDER_TRACKER_INTAKE_API_KEY', '').strip()
TRACKER_TIMEOUT = 15

# Local-only storage for drafts (pre-submission scratch state - not part of
# the tracker's data model, so it doesn't need to live there).
DRAFTS_DB_PATH = os.path.join(os.path.dirname(__file__), "customer_app_drafts.db")


def _tracker_headers():
    return {'X-Intake-Api-Key': TRACKER_API_KEY, 'Content-Type': 'application/json'}


def _require_tracker_key():
    if not TRACKER_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Server misconfigured: ORDER_TRACKER_INTAKE_API_KEY is not set",
        )


def _drafts_conn():
    conn = sqlite3.connect(DRAFTS_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS order_drafts (
            phone TEXT PRIMARY KEY,
            draft_data TEXT NOT NULL,
            saved_at TEXT NOT NULL
        )
        """
    )
    return conn


class LineItem(BaseModel):
    product: str
    quantity: int = 1
    size: Optional[str] = None
    rough_opening: Optional[str] = None
    # Door-only. Field names match the app's LineItem/tracker field names
    # 1:1 as of 2026-08-11 -- keep this in sync with
    # customer_app/flutter_files/lib/models/line_item.dart's toJson() keys.
    # A mismatch here means Pydantic silently drops the field instead of
    # erroring, which is exactly what happened 2026-08-12: this model
    # still had the pre-rename names (door_type, door_configuration, jamb,
    # hinges, trim, hardware) after the app was renamed, so every door
    # answer was getting thrown away here before it ever reached the
    # tracker or the Or-Pac automation.
    door_location: Optional[str] = None
    style: Optional[str] = None
    door_material: Optional[str] = None
    door_slab_material: Optional[str] = None
    door_texture: Optional[str] = None
    panel_style: Optional[str] = None
    jamb_size: Optional[str] = None
    swing: Optional[str] = None
    hinge_size: Optional[str] = None
    hinge_finish: Optional[str] = None
    exterior_trim: Optional[str] = None
    boring: Optional[str] = None
    sill: Optional[str] = None
    finish_type: Optional[str] = None
    finish_detail: Optional[str] = None
    finish_wood_species: Optional[str] = None
    finish_stain_color: Optional[str] = None
    glass_tint: Optional[str] = None
    door_glass_shape: Optional[str] = None
    door_glass_lite_style: Optional[str] = None
    door_frame_profile: Optional[str] = None
    hardware_option: Optional[str] = None
    qlon: Optional[bool] = False
    special_conditions: Optional[str] = None
    # Window fields
    window_type: Optional[str] = None
    opening_type: Optional[str] = None
    width: Optional[str] = None
    height: Optional[str] = None
    frame_material: Optional[str] = None
    # Window-only exterior/frame color -- doors use finish_type instead.
    color: Optional[str] = None
    # Window-only lite count -- doors use glass_tint instead.
    glass: Optional[str] = None
    grid_pattern: Optional[str] = None
    screen: Optional[bool] = False
    # Milgard fields
    is_milgard: Optional[bool] = False
    milgard_series: Optional[str] = None
    milgard_operation_style: Optional[str] = None
    milgard_exterior_finish: Optional[str] = None
    milgard_interior_finish: Optional[str] = None

class CustomerOrder(BaseModel):
    customer_name: str
    phone: str
    email: Optional[str] = None
    project: Optional[str] = None
    items: List[LineItem]
    notes: Optional[str] = None
    photos: Optional[List[str]] = []  # Base64 encoded images

def now_iso():
    return datetime.now().isoformat(timespec='seconds')

@app.get("/")
def read_root():
    return {
        "message": "Customer Order API",
        "version": "1.0",
        "status": "running",
        "tracker_url": TRACKER_BASE_URL,
    }

@app.get("/health")
def health_check():
    """Health check - reports whether the real order tracker is reachable."""
    try:
        resp = requests.get(f"{TRACKER_BASE_URL}/", timeout=5)
        tracker_ok = resp.status_code == 200
    except requests.RequestException:
        tracker_ok = False

    return {
        "status": "healthy" if tracker_ok else "degraded",
        "tracker_reachable": tracker_ok,
        "tracker_key_configured": bool(TRACKER_API_KEY),
    }

@app.post("/api/orders")
async def create_order(order: CustomerOrder):
    """Create a new order - forwarded to the real order tracker."""
    _require_tracker_key()
    try:
        resp = requests.post(
            f"{TRACKER_BASE_URL}/api/customer-intake/orders",
            json=order.model_dump(),
            headers=_tracker_headers(),
            timeout=TRACKER_TIMEOUT,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach order tracker: {e}")

    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=resp.status_code, detail=f"Tracker error: {resp.text}")

    return resp.json()

@app.get("/api/customer/{phone}")
async def lookup_customer(phone: str):
    """Look up customer info by phone number - forwarded to the order tracker."""
    try:
        resp = requests.get(
            f"{TRACKER_BASE_URL}/api/customer-intake/customer/{phone}",
            headers=_tracker_headers(),
            timeout=TRACKER_TIMEOUT,
        )
        return resp.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach order tracker: {e}")

@app.get("/api/orders/recent/{phone}")
async def get_recent_order(phone: str):
    """Get the most recent order for a phone number - forwarded to the order tracker."""
    try:
        resp = requests.get(
            f"{TRACKER_BASE_URL}/api/customer-intake/orders/recent/{phone}",
            headers=_tracker_headers(),
            timeout=TRACKER_TIMEOUT,
        )
        return resp.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach order tracker: {e}")

@app.get("/api/orders/by-order-number/{order_id}")
async def get_order_by_number(order_id: int, phone: str):
    """Look up a specific order by its tracker order number - forwarded to
    the order tracker. Requires the matching phone number (same identity
    model as the phone-based lookup above), so this can't be used to
    enumerate other customers' orders."""
    try:
        resp = requests.get(
            f"{TRACKER_BASE_URL}/api/customer-intake/orders/by-order-number/{order_id}",
            params={"phone": phone},
            headers=_tracker_headers(),
            timeout=TRACKER_TIMEOUT,
        )
        return resp.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach order tracker: {e}")


@app.get("/api/orders/by-quote-number/{quote_number}")
async def get_order_by_quote_number(quote_number: str, phone: str):
    """Look up a specific order by its Or-Pac quote number - forwarded to
    the order tracker, same phone-number requirement as above."""
    try:
        resp = requests.get(
            f"{TRACKER_BASE_URL}/api/customer-intake/orders/by-quote-number/{quote_number}",
            params={"phone": phone},
            headers=_tracker_headers(),
            timeout=TRACKER_TIMEOUT,
        )
        return resp.json()
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach order tracker: {e}")


@app.put("/api/orders/{order_id}")
async def update_order(order_id: int, order: CustomerOrder):
    """Update an existing order - forwarded to the real order tracker."""
    _require_tracker_key()
    try:
        resp = requests.put(
            f"{TRACKER_BASE_URL}/api/customer-intake/orders/{order_id}",
            json=order.model_dump(),
            headers=_tracker_headers(),
            timeout=TRACKER_TIMEOUT,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach order tracker: {e}")

    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail=f"Tracker error: {resp.text}")

    return resp.json()

@app.post("/api/orders/upload-photo")
async def upload_photo(file: UploadFile = File(...)):
    """Upload a photo and return base64 encoded data (staged locally, sent with the order on submit)."""
    try:
        contents = await file.read()
        base64_data = base64.b64encode(contents).decode('utf-8')
        return {
            "success": True,
            "data": base64_data,
            "filename": file.filename
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading photo: {str(e)}")

@app.get("/api/products")
def get_products():
    """Get available product types and options"""
    return {
        "door_sizes": [f"{w:02}68" for w in range(10, 73, 2)] +
                     [f"{w:02}80" for w in range(10, 73, 2)],
        "jamb_sizes": ["4-9/16\"", "4-5/8\"", "4-11/16\"", "5-1/4\"", "5-3/8\"",
                       "6-9/16\"", "6-5/8\"", "6-11/16\"", "7-1/4\""],
        "swing_types": ["LH", "RH", "LHR", "RHR", "Outswing LH", "Outswing RH"],
        "colors": ["White", "Bronze", "Black", "Almond"],
        "glass_types": ["Clear", "Obscure", "Low-E", "Tempered"],
        "hardware": ["Standard", "Lever", "Knob", "Deadbolt"],
        "boring": ["Single", "Double", "None"],
        "window_types": ["Single Hung", "Double Hung", "Casement", "Sliding",
                        "Picture", "Awning", "Bay", "Bow"],
        "frame_materials": ["Vinyl", "Aluminum", "Wood", "Composite", "Fiberglass"],
        "grid_patterns": ["None", "Colonial", "Prairie", "Simulated Divided Light"]
    }

@app.post("/api/drafts")
async def save_draft(order: CustomerOrder):
    """Save a draft order locally, keyed by customer phone number."""
    if not order.phone:
        raise HTTPException(status_code=400, detail="Phone number required to save draft")

    draft_json = json.dumps(order.model_dump())
    with _drafts_conn() as cx:
        cx.execute(
            "INSERT OR REPLACE INTO order_drafts (phone, draft_data, saved_at) VALUES (?, ?, ?)",
            (order.phone, draft_json, now_iso()),
        )

    return {"message": "Draft saved successfully", "phone": order.phone}

@app.get("/api/drafts/{phone}")
async def load_draft(phone: str):
    """Load a locally-saved draft order by phone number."""
    with _drafts_conn() as cx:
        row = cx.execute(
            "SELECT draft_data, saved_at FROM order_drafts WHERE phone = ?", (phone,)
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="No draft found for this phone number")

    draft_data, saved_at = row
    return {"draft": json.loads(draft_data), "saved_at": saved_at}

@app.delete("/api/drafts/{phone}")
async def delete_draft(phone: str):
    """Delete a locally-saved draft order by phone number."""
    with _drafts_conn() as cx:
        cursor = cx.execute("DELETE FROM order_drafts WHERE phone = ?", (phone,))

    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="No draft found for this phone number")

    return {"message": "Draft deleted successfully"}


class AutoQuoteRequest(BaseModel):
    order_id: int
    vendor: str = "milgard"
    headless: bool = True


@app.get("/api/automation/status")
async def automation_status():
    """Check automation status - currently disabled"""
    return {
        "available": False,
        "message": "Automation has been removed. Manual quote creation required."
    }


class OrepacQuoteRequest(BaseModel):
    customer_name: str
    phone: str
    email: Optional[str] = None
    # The tracker order this quote belongs to (already created by the
    # caller before requesting the quote). When present, the real price and
    # a few fields parsed out of Or-Pac's as-built description get pushed
    # back into that order's line items -- best-effort, never affects the
    # response returned to the customer either way.
    order_id: Optional[int] = None
    # Every door item goes onto ONE shared Or-Pac quote (Item 1, Item 2,
    # ...). Non-door items aren't supported by this automation yet and
    # should be filtered out by the caller before sending.
    items: List[LineItem]


class OrepacQuoteItemResult(BaseModel):
    price: Optional[str] = None
    description: Optional[str] = None


class OrepacQuoteResponse(BaseModel):
    success: bool
    quote_number: Optional[str] = None
    items: List[OrepacQuoteItemResult] = []
    message: str


def _require_orepac_credentials():
    if not OREPAC_USERNAME or not OREPAC_PASSWORD:
        raise HTTPException(
            status_code=500,
            detail="Server misconfigured: OREPAC_USERNAME/OREPAC_PASSWORD are not set",
        )


@app.post("/api/orepac/request-quote", response_model=OrepacQuoteResponse)
async def request_orepac_quote(payload: OrepacQuoteRequest):
    """Build a real quote on marketplace.orepac.com covering every item in
    payload.items, all on one shared quote (no order is placed there). Runs
    the Selenium automation as a subprocess, which takes roughly 1-2
    minutes per item; this request blocks for that whole time by design,
    since the Flutter app shows a waiting state rather than
    firing-and-forgetting.

    Emailing the PDF is best-effort, not required: SMTP auth to the M365
    tenant is blocked at the tenant level as of 2026-08-10 (no admin access
    to fix it), so a missing/failed email never fails the whole request --
    the quote having been built successfully is the actual result."""
    _require_orepac_credentials()
    if not payload.items:
        raise HTTPException(status_code=400, detail="items must not be empty")

    order_data = {
        "customer_name": payload.customer_name,
        "phone": payload.phone,
        "items": [item.model_dump(exclude_none=True) for item in payload.items],
    }

    tmp = tempfile.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    )
    try:
        json.dump(order_data, tmp)
        tmp.close()

        script_path = SCRIPTS_DIR / "orepac_download_quote.py"
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(script_path),
            tmp.name,
            cwd=str(SCRIPTS_DIR),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_bytes, stderr_bytes = await proc.communicate()
        stdout_text = stdout_bytes.decode("utf-8", errors="replace")

        quote_number = None
        pdf_path = None
        item_results: list[dict] = []
        for line in stdout_text.splitlines():
            if line.startswith("RESULT_QUOTE_NUMBER:"):
                quote_number = line.split(":", 1)[1].strip()
            elif line.startswith("RESULT_PDF_PATH:"):
                pdf_path = line.split(":", 1)[1].strip()
            elif line.startswith("RESULT_ITEMS_JSON:"):
                try:
                    item_results = json.loads(line.split(":", 1)[1].strip())
                except (ValueError, IndexError):
                    item_results = []

        if proc.returncode != 0 or not pdf_path:
            print("Or-Pac quote automation failed. stdout:\n" + stdout_text)
            print("stderr:\n" + stderr_bytes.decode("utf-8", errors="replace"))
            raise HTTPException(
                status_code=502,
                detail=f"Quote automation failed (exit code {proc.returncode}). Check server logs.",
            )

        # Best-effort only -- deliberately not surfaced to the customer
        # either way (success or failure). Email delivery is unreliable
        # right now (M365 SMTP AUTH blocked, no admin access to fix it) and
        # isn't part of what the customer needs to see; the quote itself is
        # the result.
        if payload.email and email_service.is_configured():
            try:
                email_service.send_quote_email(
                    payload.email, payload.customer_name, quote_number or "", Path(pdf_path)
                )
            except Exception as e:
                print(f"Quote #{quote_number} built but emailing it failed: {e}")

        # Best-effort: push the real price/description for each item back
        # into the tracker order's matching line items. Doesn't affect the
        # response either way -- the quote was already built successfully
        # by this point.
        if payload.order_id and TRACKER_API_KEY:
            try:
                requests.put(
                    f"{TRACKER_BASE_URL}/api/customer-intake/orders/{payload.order_id}/quote-result",
                    json={
                        "quote_number": quote_number,
                        "items": item_results,
                    },
                    headers=_tracker_headers(),
                    timeout=TRACKER_TIMEOUT,
                )
            except requests.RequestException as e:
                print(f"Quote #{quote_number} built but updating tracker order {payload.order_id} failed: {e}")

        return OrepacQuoteResponse(
            success=True,
            quote_number=quote_number,
            items=[OrepacQuoteItemResult(**entry) for entry in item_results],
            message=f"Quote #{quote_number} built successfully.",
        )
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


if __name__ == "__main__":
    import uvicorn
    print(f"Starting Customer Order API Server...")
    print(f"Order tracker: {TRACKER_BASE_URL}")
    print(f"Tracker API key configured: {bool(TRACKER_API_KEY)}")
    print(f"Access at: http://localhost:8000")
    print(f"API docs at: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
