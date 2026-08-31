#Requires AutoHotkey v2.0

; Hybrid prep macro for quote flow.
; Handles login/navigation only. Python injects customer data afterward.
;
; Synchronization model (Pattern C — signal-file handshake):
;   1. This script navigates to the customer-entry screen.
;   2. It writes ahk_ready.json so Python knows to start typing.
;   3. Python types customer/phone/job, then writes python_go.json.
;   4. (optional) A second macro stage can wait for python_go.json before continuing.
;
; Signal files live in %TEMP%\order_tracker_as400\

customer    := A_Args.Length >= 1  ? A_Args[1]  : ""
phone       := A_Args.Length >= 2  ? A_Args[2]  : ""
jobName     := A_Args.Length >= 3  ? A_Args[3]  : ""
quoteNumber := A_Args.Length >= 4  ? A_Args[4]  : ""
location    := A_Args.Length >= 10 ? A_Args[10] : "Felton"

if (location = "Felton" || location = "61")
	salesmanNum := "31"
else
	salesmanNum := "49"

signalDir   := EnvGet("TEMP") . "\order_tracker_as400"
readyFile   := signalDir . "\ahk_ready.json"
goFile      := signalDir . "\python_go.json"

; ── Helper: wait for the emulator window to exist and be active ──────────────
WaitForEmulator(timeoutMs := 30000) {
	; Adjust the WinTitle substring to match your emulator's actual window title.
	; Common values: "IBM i Access", "Host On-Demand", "5250", "DRMS"
	emulatorTitle := EnvGet("AS400_WINDOW_TITLE")
	if (emulatorTitle = "")
		emulatorTitle := "IBM i Access"   ; <-- change if needed
	if !WinWait(emulatorTitle, , timeoutMs // 1000)
		return false
	WinActivate(emulatorTitle)
	return true
}

; ── Helper: wait until screen stops updating (pixel-hash loop) ───────────────
WaitScreenStable(regionX := 0, regionY := 0, regionW := 200, regionH := 50, stableMs := 400, timeoutMs := 20000) {
	prevHash := ""
	stableSince := 0
	deadline := A_TickCount + timeoutMs
	loop {
		; Sample a small region rather than the full screen for speed.
		col := PixelGetColor(regionX + regionW // 2, regionY + regionH // 2)
		curHash := col   ; single-pixel proxy — swap for ImageSearch on critical screens
		now := A_TickCount
		if (curHash != prevHash) {
			prevHash := curHash
			stableSince := now
		} else if ((now - stableSince) >= stableMs) {
			return true
		}
		if (now >= deadline)
			return false
		Sleep 80
	}
}

; ── Helper: write signal file ─────────────────────────────────────────────────
WriteSignal(path, payload := "{}") {
	DirCreate(SubStr(path, 1, InStr(path, "\", , -1) - 1))
	FileDelete(path)
	FileAppend(payload, path, "UTF-8")
}

; ── Helper: wait for signal file ─────────────────────────────────────────────
WaitForSignal(path, timeoutMs := 60000, pollMs := 250) {
	deadline := A_TickCount + timeoutMs
	while (A_TickCount < deadline) {
		if FileExist(path)
			return true
		Sleep pollMs
	}
	return false
}

; ═════════════════════════════════════════════════════════════════════════════
; MAIN SEQUENCE — navigation only, no variable data typed here
; ═════════════════════════════════════════════════════════════════════════════

if !WaitForEmulator(30000) {
	MsgBox "Emulator window not found. Check AS400_WINDOW_TITLE env var."
	ExitApp 1
}

; Slow key cadence for AS400 screen transitions.
SetKeyDelay 120, 120

; DRMS login skeleton — replace with your actual screen sequence.
SendText "DRMS"
Send "{Tab}"
WaitScreenStable()
SendText "DRMS"
Send "{Enter 3}"
WaitScreenStable()
SendText "01"
Send "{Enter}"
WaitScreenStable()
SendText "05"
Send "{Tab}"
WaitScreenStable()
SendText salesmanNum
Send "{Tab}{Enter}"
WaitScreenStable()

; ── Signal Python: "I've reached the customer-entry screen, take over" ───────
WriteSignal(readyFile, '{"screen":"customer_entry","salesman":"' . salesmanNum . '"}')

; ── Wait for Python to finish typing customer/phone/job and signal back ───────
if !WaitForSignal(goFile, 60000) {
	; Timed out waiting for Python — exit so the operator can intervene.
	ExitApp 2
}
FileDelete(goFile)

; Python is done. The screen should now be ready for line-item entry.
; (quote_items.ahk picks up from here via a separate _run_macro_script call.)
ExitApp 0
