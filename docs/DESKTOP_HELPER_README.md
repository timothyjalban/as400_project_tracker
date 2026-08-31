# Desktop Helper Service

## Overview

The Desktop Helper Service bridges the web application and desktop automation capabilities. It enables the web browser to trigger AS400/HOD file operations that browsers cannot perform directly due to security restrictions.

## Architecture

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────────┐
│   Web Browser   │ HTTP    │  Desktop Helper      │ Python  │  AS400/IBM ACS  │
│  localhost:5000 │ ──────> │  Service (Port 5001) │ ──────> │  (.hod files)   │
└─────────────────┘         └──────────────────────┘         └─────────────────┘
                                     │
                                     │ Uses existing automation
                                     v
                            ┌──────────────────────┐
                            │  Desktop App Modules │
                            │  (launch_ibm.py)     │
                            └──────────────────────┘
```

## Features

The desktop helper enables these automated workflows:

- **Create Quote**: Opens AS400 HOD session and launches quote creation with order data pre-filled
- **Create Invoice**: Opens AS400 and launches invoice creation
- **Create Special Order**: Opens AS400 and launches special order creation
- **Pre-fit Door Handling**: Automatically includes pre-fit specifications and labor charges

## Setup

### 1. Install Dependencies

The desktop helper uses the same Python environment as the web app:

```bash
cd "C:\Users\tim.alban\Desktop\HTML Order Tracker"
pip install flask flask-cors
```

### 2. Automation code

The AS400 automation (`launch_ibm.py` + the `.ahk` macros) is vendored into
`automation/` in this repo. Nothing to configure.

### 3. Verify IBM ACS Installation

The service requires IBM i Access Client Solutions (ACS) to be installed at:
`C:\Users\Public\IBM\ClientSolutions\Start_Programs\Windows_x86-64\acslaunch_win-64.exe`

HOD session files must be available in the desktop app's `scripts/` folder.

## Usage

### Starting the Service

**Option 1: Using Batch File (Recommended)**
```bash
run_desktop_helper.bat
```

**Option 2: Using Python Directly**
```bash
python desktop_helper_service.py
```

### Using with Web App

1. **Start the Desktop Helper Service** (keep the window open)
2. **Start the Web App** (`python app.py` or `run_order_tracker.bat`)
3. **Open Browser** to http://localhost:5000
4. **Open an Order** in the web interface
5. **Click "Create Quote", "Create Invoice", or "Create Special Order"**
   - If helper is running → AS400 automation launches automatically ✅
   - If helper is not running → Shows manual instructions ⚠️

### Status Indicator

The web app checks the desktop helper status on page load. You can verify it's working:

- **Green toast notification**: "✅ AS400 Quote launched for [Customer]"
- **Error message**: "Desktop helper service error. Make sure desktop_helper_service.py is running."

## API Endpoints

The desktop helper exposes these REST endpoints:

### `GET /api/health`
Check if the service is running.

**Response:**
```json
{
  "status": "running",
  "service": "Order Tracker Desktop Helper",
  "version": "1.0.0"
}
```

### `POST /api/launch-quote`
Launch AS400 quote creation automation.

**Request Body:**
```json
{
  "customer_name": "John Doe",
  "customer_phone": "555-1234",
  "project_name": "Kitchen Remodel",
  "quote_number": "Q123",
  "location": "Felton",
  "customer_number": "12345",
  "has_customer_account": true,
  "line_items": [...],
  "needs_prefit": true,
  "prefit_meta": {...}
}
```

**Response:**
```json
{
  "success": true,
  "message": "AS400 quote automation launched for John Doe",
  "location": "Felton"
}
```

### `POST /api/launch-invoice`
Launch AS400 invoice creation automation.

### `POST /api/launch-special-order`
Launch AS400 special order creation automation.

## Troubleshooting

### "Desktop helper service error"
- Check that `desktop_helper_service.py` is running in a terminal window
- Verify it's listening on port 5001 (check terminal output)
- Make sure no firewall is blocking localhost:5001

### "Failed to import automation/launch_ibm.py"
- Check that `automation/launch_ibm.py` exists in the repo

### AS400 doesn't open
- Verify IBM ACS is installed at: `C:\Users\Public\IBM\ClientSolutions\...`
- Check that HOD files exist in desktop app's `scripts/` folder
- Look for error messages in the desktop helper terminal window

### Port 5001 already in use
- Another application might be using port 5001
- Edit `desktop_helper_service.py` line 247 to use a different port
- Update `static/js/app.js` line 3 with the new port

## Security Notes

- The service only accepts connections from localhost (127.0.0.1)
- CORS is enabled only for localhost:5000 (the web app)
- No authentication is implemented (assumes trusted local environment)
- The service should NOT be exposed to the internet

## Development

### Logging

The service logs all operations to the console. Check the terminal window for:
- Successful automation launches
- Error messages and stack traces
- Import/connection issues

### Adding New Automation

To add new desktop automation endpoints:

1. Add a new route in `desktop_helper_service.py`
2. Call the appropriate desktop app function
3. Add corresponding JavaScript function in `static/js/app.js`
4. Update UI with a new button in `templates/index.html`

Example:
```python
@app.route('/api/launch-custom-action', methods=['POST'])
def launch_custom_action():
    data = request.get_json()
    # Call desktop app function
    from scripts.my_module import my_automation_function
    my_automation_function(data)
    return jsonify({'success': True})
```

## Limitations

- **Windows Only**: The service relies on Windows-specific IBM ACS launcher
- **Local Only**: Requires desktop app and HOD files to be installed locally
- **Single User**: Designed for one user at a time (no concurrent session handling)

## Alternative: Desktop App

If you need more advanced automation features, consider using the full desktop app directly:
- Pre-fit door intake forms
- Batch OCR processing
- Advanced macro scripting
- Keyboard automation with AutoHotkey

The desktop helper is best for web users who want automation without switching applications.
