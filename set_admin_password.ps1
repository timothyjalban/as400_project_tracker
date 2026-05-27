param(
    [string]$Username = "admin",
    [string]$PythonExe = "c:/Users/tim.alban/Desktop/HTML Order Tracker/.venv/Scripts/python.exe"
)

if (-not (Test-Path $PythonExe)) {
    Write-Error "Python executable not found at: $PythonExe"
    exit 1
}

$pw1 = Read-Host "Enter new admin password" -AsSecureString
$pw2 = Read-Host "Confirm new admin password" -AsSecureString

$ptr1 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw1)
$ptr2 = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw2)

try {
    $plain1 = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr1)
    $plain2 = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr2)

    if ([string]::IsNullOrWhiteSpace($plain1)) {
        Write-Error "Password cannot be empty"
        exit 1
    }

    if ($plain1 -ne $plain2) {
        Write-Error "Passwords do not match"
        exit 1
    }

    $escaped = $plain1.Replace("\\", "\\\\").Replace("\"", "\\\"")
    $hash = & $PythonExe -c "from werkzeug.security import generate_password_hash; print(generate_password_hash(\"$escaped\"))"

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
    if ($ptr1 -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr1)
    }
    if ($ptr2 -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr2)
    }
}
