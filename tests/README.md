# Snapshot harness — the safety net for AS400 refactors

This is **Step 0** of the readability/editability plan. It pins today's AS400
behaviour so later refactors can be proven not to change output.

What gets snapshotted, per fixture order:

| Snapshot | Built by | Answers |
|---|---|---|
| `*.preview.txt` | `static/js/line-item-as400.js` (headless, via `lib/browser-context.mjs`) | **what the browser preview shows** |
| `*.payload.json` | `mapLineItemForAs400Automation` (same JS context) | **the exact payload JS hands to the desktop helper** |
| `*.rowplan.txt` / `.json` | `buildAs400RowPlan` in `as400-format.js` | **the structured plan (Step 1's single source of truth)** |
| `*.macro.txt` | `scripts/launch_ibm.py` from the automation project, fed the payload | **what actually gets typed into AS400** (with `[row-plan]` line = what `AS400_USE_ROW_PLAN=1` would type) |
| `syn-*.editor.html` | `renderLineItemsEditor()` (headless) | **the editor markup** — guards Step 2 renderer refactors (synthetic fixtures only) |

Plus `tests/line_item_fields.mjs` (`npm run registry`): checks the field registry
(`static/js/line-item-fields.js`) covers every editor field, and that
`createLineItemTemplate()` builds its defaults from it.

Comparing `*.preview.txt` against `*.macro.txt` for the same fixture is the
whole point — every difference is drift between "what you were told" and "what
happened". Step 1 of the plan closes that gap; until then the snapshots at least
make it visible and stop it getting worse.

## Running

```bash
npm run snapshots            # check working tree against committed snapshots
npm run snapshots:update     # regenerate all snapshots (review the diff, commit)
npm run fixtures             # re-export real orders from the live DB (git-ignored)
```

Or directly:

```bash
node   tests/snapshot_preview.mjs [--update]
python tests/snapshot_macro.py   [--update]
node   tests/run_snapshots.mjs    [--update]     # both, combined exit code
```

Exit codes: `0` match · `1` drift (diff printed) · `2` harness error.

## Fixtures

- `tests/fixtures/orders/syn-*.json` — hand-written synthetic orders, **committed**.
  No real customer data. Cover: single door / window / hardware, bypass double &
  triple, prefit door, repeated-spec windows (comment inheritance), no-cost line.
- `tests/fixtures/orders/<id>-<name>.json` — exported from the live DB by
  `export_fixtures.py`, **git-ignored** (real names + pricing). Generate locally
  for deeper coverage; they still work with the harness, their snapshots are just
  not committed.

Add a case: drop a JSON file in `tests/fixtures/orders/` shaped like the synthetic
ones (`{id, customer_name, vendor_sku, needs_prefit, prefit_meta, line_items[]}`),
then `npm run snapshots:update`.

## Environment

- **Node** ≥ 18 (uses `node:vm`, no npm dependencies).
- **Python** ≥ 3.10 — imports `automation/launch_ibm.py` from this repo. Its GUI
  deps (pyautogui etc.) are import-guarded, so nothing touches a screen.

If `snapshot_macro.py` can't find `launch_ibm`, the preview half still runs
standalone (`npm run snapshots:preview`).

## How the browser half runs headless

`lib/browser-context.mjs` evals the real app JS files
(`app.js`, `line-item-catalog.js`, `line-item-as400.js`, `document-generation.js`)
into one shared `node:vm` context with stubbed `window` / `document` / `fetch`.
The preview builders only read `localStorage` and a few module-level state vars
(`currentOrder`, `currentLineItems`, …), which the harness sets per fixture. No
source changes, no build step — if the app JS changes, the snapshots change with it.
