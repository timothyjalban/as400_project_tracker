# Customer Order App - Backend API Server

## Quick Start

### 1. Install Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Run Locally
```bash
python api_server.py
```

The server will start at `http://localhost:8000`
- API Documentation: http://localhost:8000/docs
- Health Check: http://localhost:8000/health

### 3. Configure Mobile App
In the Flutter app, update the API URL:
- For local testing: `http://YOUR_COMPUTER_IP:8000`
- Find your IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)

## Deploy to Free Hosting

### Option 1: PythonAnywhere (Recommended for beginners)
1. Sign up at https://www.pythonanywhere.com (free tier)
2. Upload your files
3. Set up a web app with Flask/FastAPI
4. Point to `api_server.py`

### Option 2: Render.com
1. Sign up at https://render.com (free tier)
2. Connect your GitHub repository
3. Create a new Web Service
4. Build command: `pip install -r requirements.txt`
5. Start command: `python api_server.py`

### Option 3: Railway.app
1. Sign up at https://railway.app
2. Deploy from GitHub or drag-and-drop
3. Automatically detects Python app

## Features
- ✅ Receives orders from mobile app
- ✅ Writes directly to orders.db
- ✅ Handles photo attachments
- ✅ CORS enabled for mobile apps
- ✅ RESTful API
- ✅ Health check endpoint

## API Endpoints

### POST /api/orders
Create a new order
```json
{
  "customer_name": "John Doe",
  "phone": "555-1234",
  "email": "john@example.com",
  "project": "Home Renovation",
  "items": [{
    "product": "Door",
    "quantity": 2,
    "size": "3068",
    "jamb": "4-9/16",
    "swing": "RH"
  }],
  "notes": "Deliver by Friday",
  "photos": ["base64_encoded_image"]
}
```

### GET /api/products
Get available product options (sizes, colors, etc.)

### POST /api/orders/upload-photo
Upload a photo (returns base64 data)

## Security Notes
- In production, update CORS settings to only allow your app's domain
- Consider adding API key authentication
- Use HTTPS in production
