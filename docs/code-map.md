# Code map — where things live

A "if I want to change X, open Y" reference. Line-item and AS400 code is the
focus, since that's where most edits happen.

## The three layers

```
BROWSER (static/js/*.js)  ─▶  FLASK (app.py + blueprints/)  ─▶  SQLite (orders.db)
                                        │  "Create Quote / Invoice" button
                                        ▼
                    desktop_helper_service.py  (port 5001)
                                        │  imports automation/launch_ibm.py
                                        ▼
        automation/launch_ibm.py   ← types into the AS400 green screen
```

Every `static/js/*.js` is a plain script sharing globals, loaded in order by the
`<script>` tags at the bottom of `templates/index.html`.

## Line items — the editor

| I want to… | File | Where |
|---|---|---|
| **Add / remove / rename a door·window·hardware field** | `static/js/line-item-fields.js` | one entry in `LINE_ITEM_FIELDS`. See `docs/adding-a-line-item-field.md`. |
| Change a field's **default value** | `static/js/line-item-fields.js` | the entry's `default:` — `createLineItemTemplate()` builds from it |
| Change a field's **editor input** (label, options, control) | `static/js/line-item-fields.js` | the entry's `render: { … }` block — `renderLineItemField()` renders it |
| Edit a **bespoke** field (type toggle, room, vendor, prefit/BOM checkboxes) | `static/js/line-item-render.js` | in `renderLineItemsEditor()` |
| Change the **editable dropdown lists** (hardware lever/knob, jamb size, bore diameter, door location) | `static/js/line-item-options.js` (frontend) + `blueprints/line_item_options.py` (save) | |
| Change **vendor / style / series / color / fin-type** option lists | `static/js/line-item-catalog.js` (frontend) + `blueprints/line_item_options.py` | server-backed |
| Change what happens **when a field changes** (side effects, recalcs) | `static/js/line-items.js` | `updateLineItem()` |
| Change **rough-opening / callout math**, size normalization | `static/js/line-items.js` | `calloutToDimensions`, `calculateDoorRoughOpeningDimensions`, `normalizeLineItem` |
| Change **bulk-set defaults / bulk paste** | `static/js/line-item-bulk.js` | |
| Change the **AS400 group** split logic (one order → multiple quotes) | `static/js/line-items.js` | the `…As400Group…` functions |

## Line items — the AS400 output

| I want to… | File | Where |
|---|---|---|
| Change **what the preview shows** | `static/js/line-item-as400.js` | `buildStandardAs400CommentPreview` (comment block), `buildCtrlAltSDescription` (the 36-char description) |
| Change the **structured plan** sent to the desktop helper | `static/js/as400-format.js` | `buildAs400RowPlan()` — the single source of truth; preview + payload both use it |
| Change **which fields feed the AS400 text** | `static/js/line-item-fields.js` | the entry's `as400: { target, order, format }` |
| Change **what actually gets typed** | `automation/launch_ibm.py` | `_build_macro_description` etc.; `run_vendor_sku_macro_dialog` types it. The `AS400_USE_ROW_PLAN` env flag makes it type the row plan verbatim instead. (Vendored from the old `C:\Projects\Order-Tracker` project — the `.ahk` macros are in `automation/as400_macros/`.) |
| Change the **bridge** between web app and the typist | `desktop_helper_service.py` | the `/api/launch-*` endpoints; imports `launch_ibm` from `automation/` |

## Orders (not line items)

| I want to… | File |
|---|---|
| Order fields (customer, stage, PO, dates), the order modal | `static/js/order-modal.js` + `blueprints/orders.py` |
| The order list (left column) | `static/js/order-list.js`, `order-selection.js` |
| The sales-process / stage detail panes | `static/js/stage-details-rendering.js`, `stage-actions.js` |
| Quote / invoice / PO tracking fields | `static/js/additional-tracking.js` |
| OCR / bulk import | `static/js/ocr-import.js` + `ocr_processor.py` + `blueprints/ocr.py`, `blueprints/import_export.py` |
| DB schema / migrations | `core.py` |
| Route registration | `app.py` → `blueprints/` |

## Tests

`npm run snapshots` before and after any line-item / AS400 change. It runs:

- **preview** — the browser preview text + automation payload + row plan
- **macro** — what `launch_ibm.py` would type
- **registry** — the field registry is complete and drives the template

Any diff = you changed AS400 output. Intended? `npm run snapshots:update`.
See `tests/README.md`.

## The line-item files (was one 2,864-line `line-items.js`)

| File | Lines | What |
|---|---|---|
| `line-items.js` | ~1,000 | item state, `normalizeLineItem`, `updateLineItem`, add/remove/move/copy, prefit derivation |
| `line-item-as400.js` | ~900 | AS400 preview string builders |
| `line-item-bulk.js` | ~760 | bulk set / paste |
| `line-item-render.js` | ~710 | the editor UI — loops the registry |
| `line-item-catalog.js` | ~490 | server-backed option lists (vendor / style / series / color) |
| `line-item-options.js` | ~410 | localStorage-backed option lists (hardware / jamb / bore diameter) |
| `line-item-fields.js` | ~390 | **the field registry** |
| `line-item-groups.js` | ~150 | AS400 grouping (one order → multiple quotes) |
| `line-item-geometry.js` | ~120 | inch/fraction math, callout ↔ width×height, rough-opening math |
| `as400-format.js` | ~130 | `buildAs400RowPlan` — the single source of truth |

Other big files: `app.js` (~1,300, page wiring), `stage-details-rendering.js` (~1,090, sales-process pane), `document-generation.js` (~940, Create Quote/Invoice/SO).
