@echo off
echo ================================================
echo Starting Order Tracker Desktop Helper Service
echo ================================================
echo.
echo This service enables AS400/HOD automation from the web app.
echo Keep this window open while using the web browser.
echo.
echo Web App URL: http://localhost:5000
echo Helper Service URL: http://localhost:5001
echo.
echo Press CTRL+C to stop the service.
echo ================================================
echo.

cd /d "%~dp0"
python desktop_helper_service.py

pause
