# AS400 Macro Hooks

This folder lets you combine AutoHotkey macros with existing Python keystroke automation.

## Modes

Set environment variable `AS400_AUTOMATION_MODE`:

- `hybrid` (default): run `<script>_prep.ahk` first, then Python sequence.
- `python`: existing `pyautogui` flow only.
- `macro`: run `<script>.ahk` only (falls back to Python if macro missing/fails).

If you want Python-only for a session:

```powershell
$env:AS400_AUTOMATION_MODE = "python"
```

Optional environment variables:

- `AS400_MACRO_DIR` - path to macro folder (defaults to this folder).
- `AS400_AHK_PATH` - full path to AutoHotkey executable.

## Script Names

`script` comes from `launch_ibm_with_details(...)` and is one of:

- `quote`
- `charge_sale`
- `special_order`
- `open_quote`
- `open_charge_sale`
- `open_special_order`

Examples:

- `quote.ahk` for macro-only quote flow.
- `quote_prep.ahk` for hybrid mode prep before Python quote typing.
- `quote_items.ahk` for quote line-item entry after customer info is submitted.

## Arguments Passed to Macros

When a macro runs, Python passes these positional args:

1. customer
2. phone
3. job_name
4. quote_number_or_invoice_number
5. size
6. jamb
7. color
8. customer_number
9. has_account (`1` or `0`)
10. location
11. session
12. script

In AutoHotkey v2, read them via `A_Args[1]`, `A_Args[2]`, etc.

## Line Item Payload Macro

When quote item automation runs, Python writes a TSV payload and calls:

- `quote_items.ahk <payload_path>`

Payload columns:

1. `index`
2. `quantity`
3. `sku`
4. `size`
5. `description`
6. `as400_description` (truncated to 31 chars in macro)
7. `um`
8. `price`

Default behavior in `quote_items.ahk` is: type SKU, `Tab`, type quantity, `Enter` per row.

Current configured flow is: type SKU, `Enter`, type quantity, `Tab`, `Enter` per row.
In the popup after SKU, macro fills: `description -> tab -> UM (only when needed) -> tab -> price -> Enter`.
Default is to leave UM unchanged; UM is set to `NC` automatically when price is `0`.

Item-entry pacing can be tuned with env vars:

- `AS400_ITEM_POPUP_DELAY_MS` (default `1000`)
- `AS400_ITEM_FIELD_DELAY_MS` (default `350`)
- `AS400_ITEM_ROW_DELAY_MS` (default `900`)

When `needs_prefit` is enabled for the order, Python auto-adds internal labor SKU `663761`
after each detected door item (with matching quantity), and includes a fallback single labor line
if no door line is detectable.

## Quick Start for Order 281

1. Create `quote_prep.ahk` and only put the stable navigation/login keys in it.
2. Launch your existing `Create quote` action from the app.
3. Python continues to type variable fields (customer/phone/job) after prep.
