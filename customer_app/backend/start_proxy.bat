@echo off
echo ========================================
echo  Customer App Proxy (order_intake API)
echo ========================================
echo.

cd /d "%~dp0"

set "ORDER_TRACKER_URL=http://localhost:5000"

rem --- Secrets: real values live in secrets.local.bat (gitignored).
rem     Copy secrets.local.bat.example to secrets.local.bat and fill it in.
rem     Covers ORDER_TRACKER_INTAKE_API_KEY, the Or-Pac Marketplace login
rem     (OREPAC_USERNAME / OREPAC_PASSWORD) used by the "Submit for Quote"
rem     feature, and the SMTP account that emails the quote PDF.
set "ORDER_TRACKER_INTAKE_API_KEY=CHANGE_ME"
set "OREPAC_USERNAME=CHANGE_ME"
set "OREPAC_PASSWORD=CHANGE_ME"
set "SMTP_HOST=smtp.office365.com"
set "SMTP_PORT=587"
set "SMTP_USERNAME=CHANGE_ME"
set "SMTP_PASSWORD=CHANGE_ME"
set "SMTP_FROM=CHANGE_ME"
if exist "%~dp0secrets.local.bat" call "%~dp0secrets.local.bat"

if exist "%~dp0..\..\.venv\Scripts\python.exe" (
	set "PYTHON_EXE=%~dp0..\..\.venv\Scripts\python.exe"
) else (
	set "PYTHON_EXE=python"
)

echo Order Tracker: %ORDER_TRACKER_URL%
echo Using Python: %PYTHON_EXE%
echo.
echo Requires the Order Tracker web app to already be running (start_server.bat / start_all.bat).
echo First run only: %PYTHON_EXE% -m pip install -r requirements.txt
echo.

"%PYTHON_EXE%" api_server.py
pause
