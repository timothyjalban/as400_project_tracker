// Order Tracker - Line-item field registry (Step 2 of the readability plan)
//
// ONE list describing every field a door / window / hardware line item can have:
// its label, which item types show it, what control renders it, its default
// value, and - the point of the whole exercise - whether and how it feeds the
// AS400 output.
//
// Today this file is the CATALOG (a single place to see what exists) and the
// source of template defaults. The editor renderer and the AS400 formatter are
// being migrated onto it field-by-field; until a field's `render` / `as400`
// wiring is marked `wired: true`, its input still lives by hand in
// renderLineItemsEditor() and its AS400 handling in line-item-as400.js.
//
// -------------------------------------------------------------------------
// To ADD a field:
//   1. Add an entry here (key, label, appliesTo, control, group, default).
//   2. Add its <input>/<select> to the matching section of
//      renderLineItemsEditor() in line-items.js  (search the `group` name).
//   3. If it should appear in the AS400 preview + typed order, give it an
//      `as400: { target, order, format }` and implement `format` in
//      line-item-as400.js / as400-format.js.
//   4. Run `npm run snapshots` - drift there means the AS400 output changed.
// The guard test tests/line_item_fields.mjs fails if a template key or an
// editor field is missing from this list, so step 1 can't be forgotten.
// -------------------------------------------------------------------------
//
// Entry shape:
//   key        string   - the item.<key> property (also data-item-field)
//   label      string   - human label in the editor
//   appliesTo  string[] - subset of ['door','window','hardware','install']
//   control    string   - 'text'|'number'|'select'|'checkbox'|'buttons'|'textarea'|'derived'
//   group      string   - layout section (see GROUPS below)
//   default    any      - value in a fresh line item
//   options?   string   - name of an option source resolved by line-item-catalog.js
//   as400?     { target:'description'|'comment', order:number, format:string }
//   note?      string   - anything a maintainer needs to know

const LINE_ITEM_FIELD_GROUPS = [
  'identity',      // type, room, quantity, price, flags
  'size',          // size_mode, callout, width/height, gable
  'catalog',       // vendor, series/model, style, as400_group
  'door-build',    // core, material, sticking, thickness, jamb, swing...
  'door-detail',   // entry-door / legacy detail selects (no template default)
  'window-build',  // operation, fin_type, frame, glass, argon, colors...
  'hardware',      // hardware_* fields
  'entry-door',    // sidelites, transom, door_count, entry_door details
  'prefit',        // prefit_* sub-editor (bespoke block in the renderer)
  'bom',           // bom_* sub-editor (bespoke block in the renderer)
  'notes',         // notes, as400 comment preview
  'internal',      // ui_collapsed, as400_group_auto, ... never shown
];

const LINE_ITEM_FIELDS = [
  // ---- identity -----------------------------------------------------------
  { key: 'type', label: 'Item type', appliesTo: ['door', 'window', 'hardware'], control: 'buttons', group: 'identity', default: 'door' },
  { key: 'product', label: 'Product', appliesTo: ['door', 'window', 'hardware', 'install'], control: 'derived', group: 'internal', default: 'Door', note: 'Display label derived from type; kept on the item for automation payloads.' },
  { key: 'room', label: 'Room / Location', appliesTo: ['door', 'window', 'hardware', 'install'], control: 'text', group: 'identity', default: '',
    as400: { target: 'comment', order: 10, format: 'roomLine' } },
  { key: 'quantity', label: 'Qty', appliesTo: ['door', 'window', 'hardware', 'install'], control: 'number', group: 'identity', default: 1,
    render: { label: 'Quantity', number: { min: 1 } },
    as400: { target: 'row', order: 0, format: 'qty' } },
  { key: 'price', label: 'Price', appliesTo: ['door', 'window', 'hardware', 'install'], control: 'number', group: 'identity', default: '',
    render: { label: 'Unit Price', number: { min: 0, step: '0.01' }, placeholder: 'e.g. 499.99' },
    as400: { target: 'row', order: 0, format: 'price' } },
  { key: 'no_cost', label: 'No cost', appliesTo: ['door', 'window', 'hardware'], control: 'checkbox', group: 'identity', default: false,
    as400: { target: 'row', order: 0, format: 'um', note: 'true => U/M "NC" and Ctrl+Alt+N instead of Ctrl+Alt+S' } },
  { key: 'vendor_sku', label: 'Vendor SKU', appliesTo: ['door', 'window', 'hardware'], control: 'text', group: 'catalog', default: '',
    as400: { target: 'row', order: 0, format: 'sku' } },

  // ---- size --------------------------------------------------------------
  { key: 'size_mode', label: 'Size mode', appliesTo: ['door', 'window'], control: 'select', group: 'size', default: 'rough_opening',
    note: 'rough_opening | net_size | callout - drives the RO/NF prefix and which size inputs show',
    render: { label: 'Opening Type', placeholder: 'Select size type', defaultValue: 'rough_opening', options: [
      { value: 'callout', label: 'Call Out' },
      { value: 'rough_opening', label: 'Rough Opening' },
      { value: 'net_size', label: 'Net Size' } ] },
    as400: { target: 'description', order: 5, format: 'sizeModePrefixText' } },
  { key: 'callout_size', label: 'Callout', appliesTo: ['door', 'window'], control: 'text', group: 'size', default: '',
    render: { label: 'Call Out (WWHH)', placeholder: 'e.g. 3068' },
    as400: { target: 'description', order: 10, format: 'doorSizeText / windowSizeText' } },
  { key: 'width', label: 'Width', appliesTo: ['door', 'window'], control: 'text', group: 'size', default: '',
    render: { label: 'Width', placeholder: 'e.g. 36&quot;' },
    as400: { target: 'description', order: 10, format: 'doorSizeText / windowSizeText' } },
  { key: 'height', label: 'Height', appliesTo: ['door', 'window'], control: 'text', group: 'size', default: '',
    render: { label: 'Height', placeholder: 'e.g. 80&quot;' },
    as400: { target: 'description', order: 10, format: 'doorSizeText / windowSizeText' } },
  { key: 'gable_tall_side', label: 'Tall side', appliesTo: ['window'], control: 'text', group: 'size', default: '', note: 'Gable windows only (style === "gable")',
    render: { label: 'Tall Side', placeholder: 'e.g. 48&quot;', valueFrom: ['height'] } },
  { key: 'gable_short_side', label: 'Short side', appliesTo: ['window'], control: 'text', group: 'size', default: '', note: 'Gable windows only',
    render: { label: 'Short Side', placeholder: 'e.g. 24&quot;' } },

  // ---- catalog ---------------------------------------------------------
  { key: 'vendor', label: 'Vendor', appliesTo: ['door', 'window', 'hardware'], control: 'select', group: 'catalog', default: '', options: 'vendor',
    as400: { target: 'comment', order: 20, format: 'vendor (window) / doorVendor' } },
  { key: 'series', label: 'Series / model', appliesTo: ['door', 'window', 'hardware'], control: 'select', group: 'catalog', default: '',
    render: { variants: {
      door: { label: 'Model', optionsSource: 'itemSeries', placeholder: '@series',
        afterControl: '<button hidden type="button" class="item-add-style-button" data-add-series-index="{index}" data-add-series-type="{type}">Add {label} for Vendor</button>' },
      window: { label: 'Series', optionsSource: 'itemSeries', placeholder: '@series',
        afterControl: '<button hidden type="button" class="item-add-style-button" data-add-series-index="{index}" data-add-series-type="{type}">Add {label} for Vendor</button>' },
      hardware: { label: 'Model', optionsSource: 'itemSeries', placeholder: '@series',
        afterControl: '<button hidden type="button" class="item-add-style-button" data-add-series-index="{index}" data-add-series-type="{type}">Add {label} for Vendor</button>' },
    } },
    as400: { target: 'description', order: 60, format: 'seriesDescriptionText' } },
  { key: 'model', label: 'Model', appliesTo: ['door', 'window'], control: 'text', group: 'catalog', default: '',
    as400: { target: 'description', order: 60, format: 'model fallback in buildCtrlAltSDescription' } },
  { key: 'as400_group', label: 'AS400 group', appliesTo: ['door', 'window', 'hardware'], control: 'select', group: 'catalog', default: '', options: 'as400Group',
    note: 'Splits one order into multiple AS400 quotes/invoices by vendor' },
  { key: 'style', label: 'Style', appliesTo: ['door', 'window', 'hardware'], control: 'select', group: 'catalog', default: '',
    render: { variants: {
      // Door Style is DB-managed (Line-Item Fields screen). Window / Hardware
      // still use the item_style_options catalog + "➕ Add New" flow.
      door: { label: 'Door Style', optionsSource: 'fieldConfig', placeholder: 'Select door style' },
      window: { label: 'Window Style', optionsSource: 'windowStyle' },
      hardware: { label: 'Hardware Type', optionsSource: 'hardwareStyle', placeholder: 'Select hardware type',
        afterControl: '<button hidden type="button" class="item-add-style-button" data-add-style-type="hardware">+ Add Style</button>' },
    } },
    as400: { target: 'description', order: 70, format: 'doorStyleDescriptionText' } },

  // ---- door build ------------------------------------------------------
  // (core / material / sticking render from the door-detail group below;
  //  jamb_size and the door `style` field stay hand-rendered - add-new dropdowns)
  { key: 'thickness', label: 'Thickness', appliesTo: ['door'], control: 'select', group: 'door-build', default: '',
    render: { label: 'Thickness', optionsSource: 'fieldConfig', placeholder: 'Select thickness', valueFrom: ['prefit_thickness'] },
    as400: { target: 'description', order: 30, format: 'doorThicknessText' } },
  { key: 'jamb_size', label: 'Jamb size', appliesTo: ['door'], control: 'select', group: 'door-build', default: '',
    render: { label: 'Jamb Size', optionsSource: 'fieldConfig', placeholder: 'Select jamb size' },
    as400: { target: 'comment', order: 50, format: 'JAMB: line in buildStandardAs400CommentPreview' } },
  { key: 'swing', label: 'Swing / Handing', appliesTo: ['door'], control: 'select', group: 'door-build', default: '',
    render: { label: 'Swing', optionsSource: 'fieldConfig', placeholder: 'Select swing', valueFrom: ['prefit_swing'] },
    as400: { target: 'comment', order: 45, format: 'SWING: line' } },
  { key: 'operation', label: 'Operation', appliesTo: ['window'], control: 'select', group: 'window-build', default: '',
    render: { label: 'Handing', optionsSource: 'fieldConfig', placeholder: 'Select handing' },
    as400: { target: 'description', order: 20, format: 'windowHandingText' } },

  // ---- window build --------------------------------------------------
  // The `style` field ("Window Style") is hand-rendered; the rest loop this group.
  { key: 'fin_type', label: 'Fin type', appliesTo: ['window'], control: 'select', group: 'window-build', default: '',
    render: { label: 'Fin Type', optionsSource: 'winFinType', placeholder: 'Select fin type',
      afterControl: '<button hidden type="button" class="item-add-style-button" data-add-fin-type="true">➕ Add Fin Type</button>' },
    as400: { target: 'comment', order: 25, format: 'FIN_TYPE_DISPLAY' } },
  { key: 'frame', label: 'Frame', appliesTo: ['door', 'window'], control: 'select', group: 'window-build', default: '',
    render: { label: 'Frame', optionsSource: 'fieldConfig', onlyForType: 'window' },
    as400: { target: 'comment', order: 22, format: 'macro_frame_text (window comment)' } },
  { key: 'exterior_color', label: 'Exterior color', appliesTo: ['door', 'window'], control: 'select', group: 'window-build', default: '',
    render: { label: 'Exterior Color', optionsSource: 'winExteriorColor', placeholder: 'Select exterior color', valueFrom: ['color'], onlyForType: 'window' },
    as400: { target: 'comment', order: 28, format: 'windowColorCommentText' } },
  { key: 'interior_color', label: 'Interior color', appliesTo: ['door', 'window'], control: 'select', group: 'window-build', default: '',
    render: { label: 'Interior Color', optionsSource: 'winInteriorColor', placeholder: 'Select interior color', valueFrom: ['color'], onlyForType: 'window' },
    as400: { target: 'comment', order: 28, format: 'windowColorCommentText' } },
  { key: 'glass', label: 'Glass', appliesTo: ['door', 'window'], control: 'select', group: 'window-build', default: '',
    render: { label: 'Glass', optionsSource: 'fieldConfig', placeholder: 'Select glass', onlyForType: 'window' },
    as400: { target: 'comment', order: 30, format: 'GLASS: line' } },
  { key: 'tempered_glass', label: 'Tempered Glass', appliesTo: ['door', 'window'], control: 'checkbox', group: 'window-build', default: false,
    render: { label: 'Tempered Glass', onlyForType: 'window' },
    as400: { target: 'comment', order: 34, format: 'TEMPERED token' } },
  { key: 'argon', label: 'Argon', appliesTo: ['window'], control: 'select', group: 'window-build', default: '',
    render: { label: 'Argon', options: ['Argon'] },
    as400: { target: 'comment', order: 32, format: 'argon token' } },
  { key: 'color', label: 'Color (legacy)', appliesTo: ['door', 'window'], control: 'derived', group: 'internal', default: '',
    note: 'Legacy single-color field; kept in sync from exterior/interior for old orders' },

  // ---- entry door extras --------------------------------------------
  { key: 'door_count', label: 'Door count', appliesTo: ['door'], control: 'select', group: 'entry-door', default: '',
    render: { label: 'Door Count', optionsSource: 'fieldConfig', placeholder: 'Select' },
    note: 'Single / Double / Triple - drives bypass SKU selection' },
  { key: 'entry_door', label: 'Entry door', appliesTo: ['door'], control: 'select', group: 'entry-door', default: false,
    render: { label: 'Entry Door', options: ['Yes', 'No'], placeholder: 'Select', boolSelect: true },
    note: 'Yes/No dropdown bound to a boolean; reveals entry-door detail fields' },
  { key: 'sidelites', label: 'Sidelites', appliesTo: ['door'], control: 'select', group: 'entry-door', default: '',
    render: { label: 'Sidelites', optionsSource: 'fieldConfig', placeholder: 'None' },
    as400: { target: 'comment', order: 60, format: 'SL: token' } },
  { key: 'transom', label: 'Transom', appliesTo: ['door'], control: 'select', group: 'entry-door', default: false,
    render: { label: 'Transom', options: ['Yes', 'No'], placeholder: 'Select', boolSelect: true },
    as400: { target: 'comment', order: 62, format: 'TRANSOM token' } },

  // ---- door detail fields --------------------------------------------
  // These render from the registry (renderLineItemField in line-items.js loops
  // this group). `render` carries the exact editor label / options / placeholder.
  // Most are editorOnly: no template default, added when a user picks a value.
  // NOTE: any field with `optionsSource: 'fieldConfig'` is "managed" - its
  // choices + label are user-editable in the Line-Item Fields settings screen
  // and stored in the DB (line_item_field_options / line_item_field_labels).
  // field-config.js resolves them at render time. Factory defaults (the DB
  // seed) live in data/line_item_field_defaults.json - edit there to change
  // what a fresh install ships with; runtime edits never touch this file.
  { key: 'door_location', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Door Location', optionsSource: 'fieldConfig', placeholder: 'Select location' } },
  { key: 'material', appliesTo: ['door', 'window'], control: 'select', group: 'door-detail', default: '',
    render: { label: 'Material', optionsSource: 'fieldConfig', onlyForType: 'door' },
    as400: { target: 'description', order: 55, format: 'doorMaterialDescriptionText' } },
  { key: 'door_texture', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Texture', placeholder: 'Select texture', optionsSource: 'fieldConfig' } },
  { key: 'core', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '',
    render: { label: 'Core', optionsSource: 'fieldConfig', placeholder: 'Select core' },
    as400: { target: 'description', order: 50, format: 'doorCoreDescriptionText' } },
  { key: 'sticking', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '',
    render: { label: 'Sticking', optionsSource: 'fieldConfig', placeholder: 'Select sticking' },
    as400: { target: 'description', order: 80, format: 'doorStickingDescriptionText' } },
  { key: 'glass_tint', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Glass Tint', optionsSource: 'fieldConfig', placeholder: 'Select tint' } },
  { key: 'door_glass_shape', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Lite Shape', optionsSource: 'fieldConfig', placeholder: 'Select lite shape' } },
  { key: 'door_glass_lite_style', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Lite Style', optionsSource: 'fieldConfig', placeholder: 'Select lite style' } },
  { key: 'door_frame_profile', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Lite Frame', optionsSource: 'fieldConfig', placeholder: 'Select lite frame' } },
  { key: 'finish_type', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Finish Type', optionsSource: 'fieldConfig', placeholder: 'Select finish type' } },
  // Split from the old single "Wood Species / Stain Color" text field.
  // finish_detail is kept as a read fallback for orders saved before the split.
  { key: 'finish_wood_species', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Wood Species', optionsSource: 'fieldConfig', placeholder: 'Select species', valueFrom: ['finish_detail'] } },
  { key: 'finish_stain_color', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Stain Color', optionsSource: 'fieldConfig', placeholder: 'Select stain color' } },
  { key: 'finish_detail', label: '(legacy wood species / stain color)', appliesTo: ['door'], control: 'text', group: 'internal', default: '', editorOnly: true,
    note: 'Split into finish_wood_species + finish_stain_color; kept as a read fallback for old orders' },
  { key: 'panel_style', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Panel Style', placeholder: 'Select panel style', optionsSource: 'fieldConfig' },
    note: 'Carries the lite count, e.g. "3 Lite" -> AS400 "3 LT"',
    as400: { target: 'comment', order: 40, format: 'doorLitesText' } },
  { key: 'boring', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Boring', optionsSource: 'fieldConfig', placeholder: 'Select boring' } },
  { key: 'hinge_size', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Hinge Size', optionsSource: 'fieldConfig', placeholder: 'Select hinge size' } },
  { key: 'hinge_finish', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Hinge Finish', placeholder: 'Select hinge finish', optionsSource: 'fieldConfig' } },
  { key: 'exterior_trim', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Exterior Trim', optionsSource: 'fieldConfig', placeholder: 'Select trim' } },
  { key: 'sill', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Sill', optionsSource: 'fieldConfig', placeholder: 'Select sill' } },
  { key: 'hardware_option', appliesTo: ['door'], control: 'select', group: 'door-detail', default: '', editorOnly: true,
    render: { label: 'Hardware', optionsSource: 'fieldConfig', placeholder: 'Select hardware' } },
  { key: 'qlon', label: 'Q-lon Weatherstripping', appliesTo: ['door'], control: 'checkbox', group: 'door-detail', default: false, editorOnly: true, note: 'Legacy; BOM block has its own bom_q_lon' },

  // ---- hardware ------------------------------------------------------
  // The `style` field (label "Hardware Type") is still hand-rendered - it's
  // polymorphic across door/window/hardware. The rest loop from this group.
  { key: 'hardware_function', label: 'Function', appliesTo: ['hardware'], control: 'text', group: 'hardware', default: '' },
  { key: 'hardware_product_code', label: 'Product code', appliesTo: ['hardware'], control: 'select', group: 'hardware', default: '',
    render: { label: 'Product Code', optionsSource: 'hardwareProductCode', placeholder: 'Select product code' },
    as400: { target: 'description', order: 10, format: 'hardware branch of buildCtrlAltSDescription' } },
  { key: 'hardware_lever_knob_style', label: 'Lever / knob', appliesTo: ['hardware'], control: 'select', group: 'hardware', default: '',
    render: { label: 'Lever/Knob Style', optionsSource: 'fieldConfig', placeholder: 'Select lever/knob style' },
    as400: { target: 'description', order: 20, format: 'hardware branch' } },
  { key: 'hardware_finish_code', label: 'Finish code', appliesTo: ['hardware'], control: 'select', group: 'hardware', default: '',
    render: { label: 'Finish', optionsSource: 'hardwareFinishCode', placeholder: 'Select finish' },
    as400: { target: 'description', order: 30, format: 'hardware branch' } },
  { key: 'hardware_finish', label: 'Finish', appliesTo: ['hardware'], control: 'text', group: 'hardware', default: '' },
  { key: 'hardware_handing', label: 'Handing', appliesTo: ['hardware'], control: 'select', group: 'hardware', default: '',
    render: { label: 'Handing', optionsSource: 'fieldConfig', placeholder: 'Select handing' },
    as400: { target: 'description', order: 40, format: 'hardware branch' } },
  { key: 'hardware_backset', label: 'Backset', appliesTo: ['hardware'], control: 'select', group: 'hardware', default: '',
    render: { label: 'Backset', optionsSource: 'fieldConfig', placeholder: 'Select backset' },
    as400: { target: 'comment', order: 20, format: 'hardware comment line' } },
  { key: 'hardware_bore', label: 'Bore', appliesTo: ['hardware'], control: 'select', group: 'hardware', default: '',
    render: { label: 'Bore', optionsSource: 'fieldConfig', placeholder: 'Select bore' } },
  { key: 'hardware_keying', label: 'Keying', appliesTo: ['hardware'], control: 'text', group: 'hardware', default: '',
    render: { label: 'Keying', placeholder: 'Keyed alike, keyed different, etc.' },
    as400: { target: 'comment', order: 22, format: 'hardware comment line' } },

  // ---- prefit sub-editor --------------------------------------------
  // Header + measurements fields stay hand-rendered (bespoke layout); the
  // hinge/bore panel fields loop from the registry (renderLineItemField).
  ...[
    ['prefit_enabled', 'Prefit', 'checkbox', false],
    ['prefit_customer_brought_door', 'Customer brought door', 'checkbox', false],
    ['prefit_width', 'RO width', 'text', ''],
    ['prefit_height', 'RO height', 'text', ''],
    ['prefit_thickness', 'Thickness', 'select', ''],
    ['prefit_lites', 'Lites', 'text', ''],
    ['prefit_vent_top', 'Vent top', 'checkbox', false],
    ['prefit_vent_bottom', 'Vent bottom', 'checkbox', false],
    ['prefit_swing', 'Swing', 'text', ''],
  ].map(([key, label, control, def]) => ({
    key, label, appliesTo: ['door'], control, group: 'prefit', default: def, subEditor: true,
    as400: { target: 'comment', order: 90, format: 'buildFormattedPrefitComment (whole block)' },
  })),
  ...[
    { key: 'prefit_hinge_top', control: 'text', render: { label: 'Hinge Top (inches)', placeholder: 'from top' } },
    { key: 'prefit_hinge_middle', control: 'text', render: { label: 'Hinge Mid (inches)', placeholder: 'from top' } },
    { key: 'prefit_hinge_bottom', control: 'text', render: { label: 'Hinge Bot (inches)', placeholder: 'from top' } },
    { key: 'prefit_hinge_width', control: 'select', render: { label: 'Hinge Width', options: ['3"', '3-1/2"', '4"', '4-1/2"'], placeholder: 'Select hinge width' } },
    { key: 'prefit_hinge_backset', control: 'text', render: { label: 'Hinge Backset', placeholder: 'inches' } },
    { key: 'prefit_hinge_radius', control: 'select', render: { label: 'Hinge Radius', options: ['1/4"', '5/8"', 'Square'], placeholder: 'Select hinge radius' } },
    { key: 'prefit_hinge_prep', control: 'select', render: { label: 'Hinge Prep', options: ['1741', '1279'], placeholder: 'Select hinge prep' } },
    { key: 'prefit_bore_type', control: 'select', default: '', render: { label: 'Bore Type', options: ['Single', 'Double'], placeholder: 'Select bore type' } },
    { key: 'prefit_bore_single', control: 'text', render: { label: 'Bore Single (inches)', placeholder: 'from top' } },
    { key: 'prefit_bore_top', control: 'text', render: { label: 'Bore Top (inches)', placeholder: 'from top' } },
    { key: 'prefit_bore_bottom', control: 'text', render: { label: 'Bore Bottom (inches)', placeholder: 'from top' } },
    { key: 'prefit_bore_backset', control: 'select', render: { label: 'Bore Backset', options: ['2-3/8"', '2-3/4"'], placeholder: 'Select bore backset' } },
    { key: 'prefit_bore_diameter', control: 'select', default: '2 1/8"',
      render: { label: 'Bore Diameter', optionsSource: 'fieldConfig', placeholder: 'Select bore diameter', defaultValue: '2 1/8"' } },
  ].map(f => ({
    appliesTo: ['door'], group: 'prefit', default: '', subEditor: true,
    as400: { target: 'comment', order: 90, format: 'buildFormattedPrefitComment (whole block)' },
    ...f,
    label: f.render.label,
  })),

  // ---- BOM sub-editor ----------------------------------------------
  // bom_enabled + the T-astragal/ball-catch checkbox subgroup stay hand-
  // rendered; the rest loop from the registry.
  { key: 'bom_enabled', label: 'BOM', appliesTo: ['door'], control: 'checkbox', group: 'bom', default: false, subEditor: true },
  { key: 'bom_t_astragal', label: 'T Astragal', appliesTo: ['door'], control: 'checkbox', group: 'bom', default: false, subEditor: true },
  { key: 'bom_ball_catch', label: 'Ball Catch', appliesTo: ['door'], control: 'checkbox', group: 'bom', default: false, subEditor: true },
  ...[
    { key: 'bom_modifiers', control: 'textarea', render: { label: 'Modifiers / Custom Specs', rows: 2, placeholder: 'Custom specs', wrapperClass: 'line-item-prefit-full' } },
    { key: 'bom_door_slabs', control: 'text', render: { label: 'Door Slabs To Be Used', placeholder: 'Slab details' } },
    { key: 'bom_jamb_frame', control: 'select', render: { label: 'Jamb / Frame', options: ['Jamb', 'Frame'], placeholder: 'Select type' } },
    { key: 'bom_jamb_frame_spec', control: 'text', render: { label: 'Jamb / Frame Spec', placeholder: 'Size / species / profile' } },
    { key: 'bom_bore_type', control: 'select', render: { label: 'Bore Specs', options: ['Single', 'Double'], placeholder: 'Select bore type' } },
    { key: 'bom_bore_measurements', control: 'text', render: { label: 'Bore Measurements', placeholder: 'Measurements' } },
    { key: 'bom_bore_top', control: 'text', render: { label: 'Bore Top (inches)', placeholder: 'from top' } },
    { key: 'bom_bore_bottom', control: 'text', render: { label: 'Bore Bottom (inches)', placeholder: 'from top' } },
    { key: 'bom_hinge_top', control: 'text', render: { label: 'Hinge Top (inches)', placeholder: 'from top' } },
    { key: 'bom_hinge_middle', control: 'text', render: { label: 'Hinge Middle (inches)', placeholder: 'from top' } },
    { key: 'bom_hinge_bottom', control: 'text', render: { label: 'Hinge Bottom (inches)', placeholder: 'from top' } },
    { key: 'bom_hinge_width', control: 'select', render: { label: 'Hinge Width', options: ['3"', '3-1/2"', '4"', '4-1/2"'], placeholder: 'Select hinge width' } },
    { key: 'bom_hinge_finish', control: 'text', render: { label: 'Hinge Finish', placeholder: 'Finish color' } },
    { key: 'bom_q_lon', control: 'select', render: { label: 'Q-lon', options: ['Q-lon', 'None'], placeholder: 'Select' } },
    { key: 'bom_q_lon_color', control: 'select', render: { label: 'Q-lon Color', options: ['White', 'Black', 'Bronze'], placeholder: 'Select color' } },
    { key: 'bom_sill_threshold', control: 'select', render: { label: 'Sill / Threshold', options: ['Sill', 'Threshold', 'None'], placeholder: 'Select' } },
    { key: 'bom_sill_finish', control: 'select', render: { label: 'Sill / Threshold Finish', options: ['Aluminum', 'Bronze', 'None'], placeholder: 'Select finish' } },
    { key: 'bom_door_bottom', control: 'text', render: { label: 'Door Bottom', placeholder: 'Sweep / none' } },
    { key: 'bom_door_bottom_finish', control: 'select', render: { label: 'Door Bottom Finish', options: ['Aluminum', 'Bronze', 'None'], placeholder: 'Select finish' } },
    { key: 'bom_flush_pulls_finish', control: 'select', render: { label: 'Flush Pulls Finish', options: ['None', 'US10B', 'US15', 'US26D', 'Black', 'Bronze', 'White', 'Selected'], placeholder: 'Select finish' } },
    { key: 'bom_casing_ext_trim', control: 'text', render: { label: 'Casing / Ext Trim', placeholder: 'Optional casing / trim' } },
    { key: 'bom_space', control: 'text', render: { label: 'Space Between Units', placeholder: 'Spacing' } },
  ].map(f => ({
    appliesTo: ['door'], group: 'bom', default: '', subEditor: true,
    as400: { target: 'comment', order: 80, format: 'buildBomCommentParts (whole block)' },
    ...f, label: f.render.label,
  })),

  // ---- notes ---------------------------------------------------------
  { key: 'notes', label: 'Notes', appliesTo: ['door', 'window', 'hardware', 'install'], control: 'textarea', group: 'notes', default: '',
    render: { label: 'Notes', rows: 2 },
    as400: { target: 'comment', order: 100, format: 'trailing notes line' } },

  // ---- internal (never rendered as an input) ------------------------
  { key: 'ui_collapsed', label: '(collapsed)', appliesTo: ['door', 'window', 'hardware', 'install'], control: 'derived', group: 'internal', default: false },
  { key: 'as400_group_auto', label: '(auto group)', appliesTo: ['door', 'window', 'hardware'], control: 'derived', group: 'internal', default: true },
  { key: 'as400_group_custom', label: '(custom group)', appliesTo: ['door', 'window', 'hardware'], control: 'derived', group: 'internal', default: false },
];

// ---- helpers --------------------------------------------------------------

const LINE_ITEM_FIELD_BY_KEY = Object.fromEntries(LINE_ITEM_FIELDS.map(f => [f.key, f]));

function lineItemField(key) {
  return LINE_ITEM_FIELD_BY_KEY[key] || null;
}

function lineItemFieldsInGroup(group) {
  return LINE_ITEM_FIELDS.filter(f => f.group === group);
}

function lineItemFieldsForType(type) {
  return LINE_ITEM_FIELDS.filter(f => f.appliesTo.includes(type));
}

function lineItemFieldDefaults(type) {
  const out = {};
  for (const f of LINE_ITEM_FIELDS) {
    if (f.appliesTo.includes(type)) out[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
  }
  return out;
}

// Every default a fresh line item carries today, regardless of type. This is
// what createLineItemTemplate() spreads - a flat, type-agnostic shape. Fields
// flagged `editorOnly` are added lazily by the editor and are NOT included.
function lineItemTemplateDefaults() {
  const out = {};
  for (const f of LINE_ITEM_FIELDS) {
    if (f.editorOnly) continue;
    out[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
  }
  return out;
}

// Fields that feed AS400 output, in the order they should be applied.
function lineItemAs400Fields(target = null) {
  return LINE_ITEM_FIELDS
    .filter(f => f.as400 && (target === null || f.as400.target === target))
    .sort((a, b) => (a.as400.order || 0) - (b.as400.order || 0));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LINE_ITEM_FIELDS, LINE_ITEM_FIELD_GROUPS,
    lineItemFieldsForType, lineItemFieldDefaults, lineItemTemplateDefaults, lineItemAs400Fields,
    lineItemField, lineItemFieldsInGroup,
  };
}
