@echo off
echo ============================================================
echo Starting Order Tracker Web App + Desktop Helper Service
echo ============================================================
echo.
echo This will open TWO terminal windows:
echo   1. Web App (localhost:5000)
echo   2. Desktop Helper Service (localhost:5001)
echo.
echo Both are required for full automation.
echo ============================================================
echo.

cd /d "%~dp0"

if exist "C:\Projects\Order-Tracker\orders.db" (
	set "ORDER_TRACKER_DB_PATH=C:\Projects\Order-Tracker\orders.db"
) else (
	set "ORDER_TRACKER_DB_PATH=C:\tmp\orders.db"
)

if exist "%~dp0.venv\Scripts\python.exe" (
	set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
) else (
	set "PYTHON_EXE=python"
)

echo Using database: %ORDER_TRACKER_DB_PATH%
echo Using Python: %PYTHON_EXE%
echo.

echo Starting Web App...
start "Order Tracker Web App" "%PYTHON_EXE%" app.py
timeout /t 2 /nobreak >nul

echo Starting Desktop Helper...
start "Order Tracker Desktop Helper" "%PYTHON_EXE%" desktop_helper_service.py
timeout /t 2 /nobreak >nul

echo.
echo ============================================================
echo Both services are starting...
echo.
echo Web App: http://localhost:5000
echo Desktop Helper: http://localhost:5001
echo.
echo Open http://localhost:5000 in your browser
echo Keep both windows open for full functionality
echo ============================================================
echo.

timeout /t 3 /nobreak >nul
start http://localhost:5000

echo.
echo Press any key to close this window (services will keep running)
pause >nul
