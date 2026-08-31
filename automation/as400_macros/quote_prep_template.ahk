#Requires AutoHotkey v2.0

; ─────────────────────────────────────────────────────────────────────────────
; PATTERN B — Pre-filled macro template (no prompts needed)
;
; Python calls build_filled_macro("quote_prep_template.ahk", {...}) which
; substitutes {{CUSTOMER}}, {{PHONE}}, etc. and writes a ready-to-run copy.
; That copy is launched directly — no prompt dialog ever appears.
;
; To use:
;   from scripts.launch_ibm import build_filled_macro, _ahk_executable
;   import subprocess
;   macro = build_filled_macro("quote_prep_template.ahk", {
;       "CUSTOMER":  customer,
;       "PHONE":     phone,
;       "JOB":       job_name,
;       "SALESMAN":  salesman_number,
;   })
;   subprocess.run([_ahk_executable(), str(macro)])
; ─────────────────────────────────────────────────────────────────────────────

; These values are substituted by Python before the script runs.
; Do NOT add [prompt:...] variables here — Python fills them directly.
customer    := "{{CUSTOMER}}"
phone       := "{{PHONE}}"
jobName     := "{{JOB}}"
salesmanNum := "{{SALESMAN}}"

; ── Wait for emulator window ─────────────────────────────────────────────────
emulatorTitle := EnvGet("AS400_WINDOW_TITLE")
if (emulatorTitle = "")
    emulatorTitle := "IBM i Access"   ; adjust to your emulator's window title

if !WinWait(emulatorTitle, , 30) {
    MsgBox "Emulator window not found within 30 s."
    ExitApp 1
}
WinActivate(emulatorTitle)

SetKeyDelay 120, 120

; ── Login / navigation ────────────────────────────────────────────────────────
SendText "DRMS"
Send "{Tab}"
Sleep 200
SendText "DRMS"
Send "{Enter 3}"
Sleep 400
SendText "01"
Send "{Enter}"
Sleep 300
SendText "05"
Send "{Tab}"
Sleep 250
SendText salesmanNum
Send "{Tab}{Enter}"
Sleep 400

; ── Customer entry (values already substituted — no prompt dialog) ────────────
Send "{Enter}"
Sleep 300
SendText customer
Send "{Tab}"
Sleep 200
SendText "Y"
SendText customer
Send "{Tab 10}"
Sleep 200
SendText customer
Send "{Tab}"
Sleep 150
SendText phone
Send "{Tab}"
Sleep 150
SendText phone
Send "{Tab 2}"
Sleep 150
SendText jobName
Send "{Enter}"
Sleep 400

; Done — line items will be handled by quote_items.ahk.
ExitApp 0
