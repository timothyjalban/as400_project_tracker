# Order Tracker Web App - Phase 1

A modern web-based version of your Order Tracker application.

## 📋 Phase 1 Features

- ✅ View all orders in a table
- ✅ Search orders (customer, project, quote#, PO#)
- ✅ Filter by stage
- ✅ Show/hide completed (archived) orders
- ✅ Modern dark theme matching your PySide6 app
- ✅ Responsive design
- ✅ Real-time filtering

## 🚀 Quick Start

### 1. Install Dependencies

Open PowerShell in this folder and run:

```powershell
pip install -r requirements.txt
```

### 2. Database Path

Defaults to `orders.db` at the repo root. Override with the
`ORDER_TRACKER_DB_PATH` environment variable (the `start_*.bat` scripts set it).

### 3. Run the Server

```powershell
python app.py
```

### 4. Open in Browser

Navigate to: http://localhost:5000

## 📁 Project Structure

```
HTML Order Tracker/
├── app.py                 # Flask backend (REST API)
├── requirements.txt       # Python dependencies
├── templates/
│   └── index.html        # Main HTML page
├── static/
│   ├── css/
│   │   └── style.css     # Modern styling
│   └── js/
│       └── app.js        # Frontend JavaScript
└── README.md             # This file
```

## 🎨 Design

The web app uses the same modern dark theme as your PySide6 application:
- Material Design inspired
- Blue primary color (#2196F3)
- Dark background (#121212)
- Clean, modern interface

## 🔌 API Endpoints

- `GET /api/orders` - Get all orders (with optional filters)
  - Query params: `search`, `stage`, `show_completed`
- `GET /api/orders/<id>` - Get single order
- `GET /api/stages` - Get all unique stages

## ✅ Customer Workflow Smoke Checklist

Run this checklist after customer/profile workflow changes:

1. Open Customer Lookup with no order selected.
2. Confirm Recent Customers load immediately.
3. Toggle "Only show customers with account numbers" and verify all rows show account # values.
4. Click View Profile from a lookup row and verify profile fields and order history load.
5. Click Open from profile history and verify profile modal closes and order modal opens.
6. Click Use for New Order from profile and verify profile modal closes and a new prefilled order opens.
7. Edit Default Project Notes in profile, save, reopen profile, and verify note persists.
8. Verify account number copy works in lookup rows and in order/process chips.

## 🧪 Backend Endpoint Smoke Script

A lightweight backend validator script is included at `scripts/smoke_customer_profile_endpoints.py`.

Run without writes:

```powershell
python scripts/smoke_customer_profile_endpoints.py --base-url http://127.0.0.1:5000
```

Optional write/revert check (safe, reverts automatically):

```powershell
python scripts/smoke_customer_profile_endpoints.py --base-url http://127.0.0.1:5000 --allow-write --profile-id 3
```

## 📝 TODO - Future Phases

**Phase 2**: Order Detail View & Editing
- View full order details
- Edit order fields
- Add/edit notes

**Phase 3**: Create New Orders
- Add new order form
- Validation

**Phase 4**: File Attachments
- Upload files
- View attachments
- Download files

**Phase 5**: Advanced Features
- AS400 integration
- User authentication
- Email notifications
- Reports/analytics

## 🐛 Troubleshooting

**"Database not found" error:**
- Check the `DB_PATH` in `app.py` points to your `orders.db` file

**"Failed to connect to server" in browser:**
- Make sure Flask is running (`python app.py`)
- Check that port 5000 is not in use

**Orders not showing:**
- Check that your database has orders
- Try enabling "Show Completed" checkbox
- Check browser console for errors (F12)

## 🔒 Security Configuration (Production)

The app now requires authentication by default.

Set these environment variables before publishing:

- `ORDER_TRACKER_SECRET_KEY`: long random secret for Flask sessions.
- `ORDER_TRACKER_AUTH_USERS_JSON`: JSON array of users with password hashes.
- `ORDER_TRACKER_ENFORCE_HTTPS=1`: force HTTPS redirects + HSTS.
- `ORDER_TRACKER_COOKIE_SECURE=1`: only send cookies over HTTPS.
- `ORDER_TRACKER_SESSION_HOURS=12`: session lifetime (hours).
- `ORDER_TRACKER_DESKTOP_HELPER_LOCAL_ONLY=1`: keep desktop helper APIs local-only.

## 🆓 Zero-Cost Render Option

If you do not want to pay for a Render disk, you can deploy with the included `render.yaml` using ephemeral storage.

- SQLite will use `/tmp/orders.db`.
- The app will run for free on Render, but the database will reset if the service restarts or redeploys.
- If you need permanent online data, you will need either a paid persistent disk or a free external database service.

Optional single-admin fallback (dev/testing only):

- `ORDER_TRACKER_ADMIN_USERNAME`
- `ORDER_TRACKER_ADMIN_PASSWORD` or `ORDER_TRACKER_ADMIN_PASSWORD_HASH`
- `ORDER_TRACKER_ALLOW_INSECURE_DEFAULT_LOGIN=1` (default): allows `admin/changeme` if no auth vars are set.

Example `ORDER_TRACKER_AUTH_USERS_JSON`:

```json
[
  {
    "username": "admin",
    "password_hash": "pbkdf2:sha256:600000$...",
    "role": "admin"
  }
]
```

Notes:

- All API/page routes require login except `/login` and static files.
- Desktop helper routes also require admin role and (by default) local requests.

## 💡 Tips

- The app connects to your **existing** SQLite database
- All data is read-only in Phase 1 (safe to test)
- Multiple people can view simultaneously
- Refreshes are instant (no page reload needed)
