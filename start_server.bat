@echo off
echo ========================================
echo  Order Tracker Web App
echo ========================================
echo.
if exist "C:\Projects\Order-Tracker\orders.db" (
	set "ORDER_TRACKER_DB_PATH=C:\Projects\Order-Tracker\orders.db"
) else (
	set "ORDER_TRACKER_DB_PATH=C:\tmp\orders.db"
)
rem --- Secrets: real values live in secrets.local.bat (gitignored).
rem     Copy secrets.local.bat.example to secrets.local.bat and fill it in.
set "ORDER_TRACKER_CUSTOMER_INTAKE_API_KEY=CHANGE_ME"
if exist "%~dp0secrets.local.bat" call "%~dp0secrets.local.bat"

echo Using database: %ORDER_TRACKER_DB_PATH%
echo.

if exist "%~dp0.venv\Scripts\python.exe" (
	set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
) else (
	set "PYTHON_EXE=python"
)

echo Using Python: %PYTHON_EXE%
echo.

echo Starting Flask server...
echo Open http://localhost:5000 in your browser
echo.
echo Press Ctrl+C to stop the server
echo.
"%PYTHON_EXE%" app.py
pause
