param(
    [string]$Username = "admin",
    [string]$PythonExe = "$PSScriptRoot/.venv/Scripts/python.exe"
)

if (-not (Test-Path $PythonExe)) {
    Write-Error "Python executable not found at: $PythonExe"
    exit 1
}

$pw = Read-Host "Enter new admin password" -AsSecureString
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw)

try {
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)

    if ([string]::IsNullOrWhiteSpace($plain)) {
        Write-Error "Password cannot be empty"
        exit 1
    }

    $env:ORDER_TRACKER_RESET_PASSWORD = $plain
    try {
        $hash = & $PythonExe -c "import os; from werkzeug.security import generate_password_hash; print(generate_password_hash(os.environ['ORDER_TRACKER_RESET_PASSWORD']))"
    } finally {
        Remove-Item Env:ORDER_TRACKER_RESET_PASSWORD -ErrorAction SilentlyContinue
    }

    if ([string]::IsNullOrWhiteSpace($hash)) {
        Write-Error "Failed to generate password hash"
        exit 1
    }

    setx ORDER_TRACKER_ADMIN_USERNAME $Username | Out-Null
    setx ORDER_TRACKER_ADMIN_PASSWORD_HASH $hash | Out-Null
    setx ORDER_TRACKER_ALLOW_INSECURE_DEFAULT_LOGIN 0 | Out-Null

    Write-Host "Admin username set to: $Username"
    Write-Host "Password hash updated successfully."
    Write-Host "Insecure fallback disabled."
    Write-Host "Close and reopen terminal windows, then restart app.py."
}
finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}
