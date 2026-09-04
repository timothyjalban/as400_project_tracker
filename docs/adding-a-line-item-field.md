# Adding, removing, or editing a door / window / hardware field

Line items are a JSON blob in `orders.line_items`, so **there is no database
migration** for a new field. What makes this fiddly is that a field currently
lives in several files. `static/js/line-item-fields.js` is the map of all of
them; this is the checklist.

## The registry

`static/js/line-item-fields.js` holds `LINE_ITEM_FIELDS` — one entry per field:

```js
{
  key: 'core',                 // item.core  (also data-item-field="core")
  label: 'Core',
  appliesTo: ['door'],         // which item types show it
  control: 'select',           // text | number | select | checkbox | buttons | textarea | derived
  group: 'door-build',         // layout section
  default: '',
  options: 'core',             // option source (see line-item-catalog.js), optional
  as400: {                     // how it reaches AS400, optional
    target: 'description',      // 'description' | 'comment' | 'row'
    order: 50,                  // position within that target
    format: 'doorCoreDescriptionText',
  },
}
```

`tests/line_item_fields.mjs` (run by `npm run snapshots`) fails if a field
exists in the template or the editor but not here — so the registry can't
silently fall behind.

## To ADD a field

1. **Registry** — add an entry to `LINE_ITEM_FIELDS`.

2. **Default** — add `<key>: <default>,` to `createLineItemTemplate()` in
   `static/js/line-items.js`. (Skip this and mark the registry entry
   `editorOnly: true` if the field should only exist once a user fills it in.)

3. **The input** — most fields render straight from the registry. Add a
   `render: { ... }` block to your entry and it shows up in the editor;
   `renderLineItemField()` in `line-items.js` loops the field groups. Supported
   `render` keys:
   | key | meaning |
   |---|---|
   | `label` | editor label |
   | `options` | static array (strings, or `{value,label}`) |
   | `optionsSource` | name in `lineItemOptionSource()` for a dynamic list |
   | `placeholder` | select/input placeholder (`@series` = vendor-aware) |
   | `defaultValue` | selected when the field is empty |
   | `valueFrom` | fallback keys if the field is empty (e.g. `['prefit_thickness']`) |
   | `boolSelect` | Yes/No `<select>` bound to a boolean field |
   | `afterControl` | raw HTML after the control (`{index}`/`{type}`/`{label}` substituted) |
   | `wrapperClass` | extra class on the `.line-item-field` wrapper |
   | `onlyForType` | render only for this item type |
   | `number: {min, step}` | for `control: 'number'` |
   | `rows` | for `control: 'textarea'` |
   | `variants: { door, window, hardware }` | per-type `render` config for polymorphic fields |

   **Still hand-written** (bespoke markup): the type-toggle buttons, `room`,
   `vendor` (SKU in the label), `as400_group`, and the prefit / BOM checkbox
   subgroups + prefit measurement fields. For those, add markup to the matching
   section of `renderLineItemsEditor()` carrying
   `data-item-index="${index}" data-item-field="<key>"`.

4. **Change handling** — only if the field has side effects (recomputes another
   field, toggles visibility). Add a branch in `updateLineItem()` in
   `static/js/line-items.js`. Plain fields need nothing here.

5. **Dropdown options** — three kinds:
   - **User-editable, DB-backed (preferred for plain lists):** set
     `render.optionsSource: 'fieldConfig'` (no `render.options` array) and add
     the field + its factory choices to `data/line_item_field_defaults.json`.
     It then appears in the **Line-Item Fields** settings screen and gets an
     inline ✎ editor; choices/label/per-option AS400 text are all editable from
     the app with no code change. See `static/js/field-config.js`,
     `blueprints/field_config.py`, `core.py` (`ensure_line_item_field_config_schema`).
   - **Catalog lists** (style / vendor / series / colors / fin type): the
     `➕ Add New` prompt flow — `static/js/line-item-catalog.js` +
     `blueprints/line_item_options.py`.
   - **Static, not user-editable:** a plain `render.options: [...]` array.

6. **AS400 output** — if it should show in the preview *and* the typed order:
   - Set `as400: { target, order, format }` on the registry entry.
   - Implement `format` in `static/js/line-item-as400.js` (a small function that
     takes the item and returns a string). For a managed dropdown, call
     `optAs400('<key>', value, scope)` at the top of that function and return it
     when truthy — that lets the per-option "AS400 text" from the settings
     screen override the abbreviation.
   - Add a call to it in the right builder: `buildCtrlAltSDescription()` for
     `target: 'description'`, `buildStandardAs400CommentPreview()` for
     `target: 'comment'`.
   - `buildAs400RowPlan()` in `as400-format.js` composes those, so the preview
     and the payload both pick it up automatically.

7. **Flutter app** — if the customer app should send this field, add it to the
   `LineItem` model in `customer_app/backend/api_server.py` (it's a hand-kept
   copy — fields not listed there are dropped).

8. **Run `npm run snapshots`.** Drift in `*.preview.txt` / `*.macro.txt` means
   your change altered AS400 output — review it, and `npm run snapshots:update`
   if it's intended.

## To REMOVE a field

Reverse of the above. Leave old data alone — items saved with the field keep it
in their JSON; it just stops being shown or used. Delete the registry entry
last, after the template default and the editor input are gone (the guard test
will remind you if you miss one).

## To EDIT a field (rename, change control, move sections)

- **Rename the key**: change it in the registry, the template, every
  `data-item-field` in the editor, `updateLineItem()`, any `item.<oldkey>`
  reference in `line-item-as400.js`, and `api_server.py`. Add a fallback
  (`item.newkey ?? item.oldkey`) anywhere old orders are read.
- **Change the control or options**: registry entry + the editor markup.
- **Move it to another section**: change `group` in the registry and move the
  markup block in `renderLineItemsEditor()`.

## Where the AS400 format functions live

| Piece | File |
|---|---|
| Structured row plan (preview = payload = typed) | `static/js/as400-format.js` — `buildAs400RowPlan()` |
| Description string builder | `static/js/line-item-as400.js` — `buildCtrlAltSDescription()` |
| Comment block builder | `static/js/line-item-as400.js` — `buildStandardAs400CommentPreview()` |
| What actually types it | `automation/launch_ibm.py` |
