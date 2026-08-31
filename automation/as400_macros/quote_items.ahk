#Requires AutoHotkey v2.0

; Quote line-item entry macro.
; Arg1: TSV payload path with header:
; index<TAB>quantity<TAB>sku<TAB>size<TAB>description<TAB>as400_description<TAB>um<TAB>price

if (A_Args.Length < 1) {
    ExitApp 1
}

payloadPath := A_Args[1]
if !FileExist(payloadPath) {
    ExitApp 2
}

; Slow default pacing for AS400.
SetKeyDelay 180, 180

_popupRaw := EnvGet("AS400_ITEM_POPUP_DELAY_MS")
_fieldRaw := EnvGet("AS400_ITEM_FIELD_DELAY_MS")
_rowRaw := EnvGet("AS400_ITEM_ROW_DELAY_MS")

popupDelay := (_popupRaw != "") ? Integer(_popupRaw) : 1000
fieldDelay := (_fieldRaw != "") ? Integer(_fieldRaw) : 350
rowDelay := (_rowRaw != "") ? Integer(_rowRaw) : 900
abortThresholdRaw := EnvGet("AS400_ABORT_CORNER_THRESHOLD")
abortThreshold := (abortThresholdRaw != "") ? Integer(abortThresholdRaw) : 5

isAbortCorner() {
    global abortThreshold
    MouseGetPos &x, &y
    return (x <= abortThreshold && y <= abortThreshold)
}

checkAbort() {
    if isAbortCorner() {
        ; Exit code 99 indicates user-triggered safety abort.
        ExitApp 99
    }
}

content := FileRead(payloadPath, "UTF-8")
lines := StrSplit(content, "`n", "`r")

if (lines.Length <= 1) {
    ExitApp 0
}

; Skip header row.
for idx, line in lines {
    checkAbort()

    if (idx = 1 || Trim(line) = "") {
        continue
    }

    cols := StrSplit(line, "`t")
    sku := cols.Length >= 3 ? Trim(cols[3]) : ""
    qty := cols.Length >= 2 ? Trim(cols[2]) : "1"
    as400Description := cols.Length >= 6 ? Trim(cols[6]) : ""
    um := cols.Length >= 7 ? Trim(cols[7]) : ""
    price := cols.Length >= 8 ? Trim(cols[8]) : ""

    if (sku = "") {
        continue
    }

    ; Assumes cursor is at the line-item SKU/input field after customer entry.
    ; Flow: SKU -> Enter -> Qty -> Tab -> Enter
    SendText sku
    checkAbort()
    Send "{Enter}"
    Sleep popupDelay
    checkAbort()

    ; Popup fields: Description, (optional) UM override, Price
    ; Default: leave UM unchanged and tab to price.
    ; Rule: for no-cost rows, set UM to NC.
    ; Clear any default description like "S/O - MILGARD WINDOWS" first.
    Send "^a{Delete}"
    Sleep fieldDelay
    checkAbort()
    if (as400Description != "") {
        SendText SubStr(as400Description, 1, 31)
    }
    Send "{Tab}"
    Sleep fieldDelay
    checkAbort()

    setUmNc := (price = "0" || price = "0.0" || price = "0.00")
    if (setUmNc) {
        SendText "NC"
    } else if (um != "") {
        SendText um
    }
    Send "{Tab}"
    Sleep fieldDelay
    checkAbort()

    if (price != "") {
        SendText price
    }
    Send "{Enter}"
    Sleep fieldDelay
    checkAbort()

    SendText qty
    Send "{Tab}"
    Sleep fieldDelay
    checkAbort()
    Send "{Enter}"
    Sleep rowDelay
    checkAbort()
}

ExitApp 0
