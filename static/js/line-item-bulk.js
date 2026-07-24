// Order Tracker - Line Item Bulk Set and Global Attribute Stars
// Owns the Bulk Set panel, remembered defaults, and star helpers.
// Depends on line-items.js and line-item-catalog.js for active item state and option lists.
// ── Bulk Set ────────────────────────────────────────────────────────────────
// Persists across the current order session; applied to every new item added.
const bulkSetDefaults = { door: {}, window: {}, hardware: {} };
const BULK_SET_DEFAULTS_STORAGE_PREFIX = 'order_tracker_bulk_defaults_';
const BULK_SNAPSHOT_STORAGE_PREFIX = 'order_tracker_bulk_snapshot_';
const BULK_DEFAULT_GROUPS_KEY = '__groups__';

const BULK_SET_FIELDS = [
    // shared fields
    { value: 'style',          label: 'Style',           type: 'select',   scope: 'all' },
    { value: 'vendor',         label: 'Vendor',          type: 'select',   scope: 'all' },
    { value: 'series',         label: 'Model / Series',  type: 'select',   scope: 'all' },
    { value: 'size_mode',      label: 'Size Type',       type: 'select',   scope: 'both', options: [
        { value: 'callout', label: 'Call Out' },
        { value: 'rough_opening', label: 'Rough Opening' },
        { value: 'net_size', label: 'Net Size' },
    ] },
    { value: 'fin_type',       label: 'Fin Type',        type: 'select',   scope: 'window' },
    { value: 'argon',          label: 'Argon',           type: 'select',   scope: 'both',   options: ['Argon'] },
    // door-only
    { value: 'material',       label: 'Material',        type: 'select',   scope: 'door',   options: ['Wood', 'Primed', 'Fiberglass', 'Steel', 'Vinyl'] },
    { value: 'core',           label: 'Core',            type: 'select',   scope: 'door',   options: ['Hollow Core', 'Solid Core'] },
    { value: 'sticking',       label: 'Sticking',        type: 'select',   scope: 'door',   options: ['Ovolo', 'Shaker'] },
    { value: 'swing',          label: 'Swing',           type: 'select',   scope: 'door',   options: ['LH', 'RH', 'LH Outswing', 'RH Outswing'] },
    { value: 'thickness',      label: 'Thickness',       type: 'select',   scope: 'door',   options: ['1-3/8"', '1-3/4"'] },
    { value: 'jamb_size',      label: 'Jamb Size',       type: 'select',   scope: 'door' },
    // window-only
    { value: 'operation',      label: 'Handing',         type: 'select',   scope: 'window' },
    { value: 'frame',          label: 'Frame',           type: 'select',   scope: 'window', options: ['Vinyl', 'Wood', 'Aluminum', 'Fiberglass'] },
    { value: 'glass',          label: 'Glass / Lites',   type: 'select',   scope: 'both', options: ['None', '1 LT', '2 LT', '3 LT', '4 LT', '6 LT', '9 LT', 'Clear', 'Low-E', 'Tempered', 'Obscure'] },
    { value: 'tempered_glass', label: 'Tempered Glass',  type: 'checkbox', scope: 'window' },
    // text / numeric
    { value: 'width',          label: 'Width',           type: 'text',     scope: 'both' },
    { value: 'height',         label: 'Height',          type: 'text',     scope: 'both' },
    { value: 'quantity',       label: 'Quantity',        type: 'number',   scope: 'all' },
    { value: 'price',          label: 'Unit Price',      type: 'number',   scope: 'all' },
    { value: 'no_cost',        label: 'No Cost (NC)',    type: 'checkbox', scope: 'all' },
    { value: 'room',           label: 'Room / Location', type: 'text',     scope: 'all' },
    { value: 'notes',          label: 'Notes',           type: 'textarea', scope: 'all' },
    { value: 'hardware_product_code', label: 'Product Code', type: 'select', scope: 'hardware' },
    { value: 'hardware_lever_knob_style', label: 'Lever/Knob Style', type: 'select', scope: 'hardware' },
    { value: 'hardware_finish_code', label: 'Finish (US Code)', type: 'select', scope: 'hardware', options: [
        { value: 'USP', label: 'USP - Primed for painting' },
        { value: 'US1B', label: 'US1B - Bright black japanned' },
        { value: 'US2G', label: 'US2G - Zinc plated' },
        { value: 'US3', label: 'US3 - Bright Brass' },
        { value: 'US4', label: 'US4 - Satin Brass' },
        { value: 'US5', label: 'US5 - Antique Brass' },
        { value: 'US7', label: 'US7 - Antique Brass' },
        { value: 'US9', label: 'US9 - Bright Bronze' },
        { value: 'US10', label: 'US10 - Satin Bronze' },
        { value: 'US10B', label: 'US10B - Oil Rubbed Bronze' },
        { value: 'US10A', label: 'US10A - Antique Bronze' },
        { value: 'US11', label: 'US11 - Aged Bronze' },
        { value: 'US14', label: 'US14 - Bright Nickel' },
        { value: 'US15', label: 'US15 - Satin Nickel' },
        { value: 'US15A', label: 'US15A - Antique Nickel' },
        { value: 'US17A', label: 'US17A - Black Nickel' },
        { value: 'US19', label: 'US19 - Flat Black Coated' },
        { value: 'US20A', label: 'US20A - Dark Oxidized Bronze' },
        { value: 'US26', label: 'US26 - Bright Chrome' },
        { value: 'US26D', label: 'US26D - Satin Chrome' },
        { value: 'US27', label: 'US27 - Clear Anodized Aluminum' },
        { value: 'US28', label: 'US28 - Satin Aluminum' },
        { value: 'US32', label: 'US32 - Bright Stainless Steel' },
        { value: 'US32D', label: 'US32D - Satin Stainless Steel' },
    ] },
    { value: 'hardware_handing', label: 'Hardware Handing', type: 'select', scope: 'hardware', options: ['LH', 'RH', 'Reversible', 'N/A'] },
    // prefit
    { value: 'prefit_customer_brought_door', label: 'Customer Brought Door', type: 'checkbox', scope: 'door' },
    { value: 'prefit_width',   label: 'Pre-Fit Width',   type: 'text',     scope: 'door' },
    { value: 'prefit_height',  label: 'Pre-Fit Height',  type: 'text',     scope: 'door' },
    { value: 'prefit_thickness', label: 'Pre-Fit Thickness', type: 'select', scope: 'door', options: ['1-3/8"', '1-3/4"'] },
    { value: 'prefit_lites',   label: 'Pre-Fit Lites',   type: 'select',   scope: 'door', options: ['None', '1 LT', '2 LT', '3 LT', '4 LT', '6 LT', '9 LT'] },
    { value: 'prefit_vent_top', label: 'Pre-Fit Vent Top', type: 'checkbox', scope: 'door' },
    { value: 'prefit_vent_bottom', label: 'Pre-Fit Vent Bottom', type: 'checkbox', scope: 'door' },
    { value: 'prefit_hinge_top', label: 'Pre-Fit Hinge Top', type: 'text', scope: 'door' },
    { value: 'prefit_hinge_middle', label: 'Pre-Fit Hinge Middle', type: 'text', scope: 'door' },
    { value: 'prefit_hinge_bottom', label: 'Pre-Fit Hinge Bottom', type: 'text', scope: 'door' },
    { value: 'prefit_hinge_width', label: 'Pre-Fit Hinge Width', type: 'select', scope: 'door', options: ['3"', '3-1/2"', '4"', '4-1/2"'] },
    { value: 'prefit_hinge_backset', label: 'Pre-Fit Hinge Backset', type: 'text', scope: 'door' },
    { value: 'prefit_hinge_radius', label: 'Pre-Fit Hinge Radius', type: 'select', scope: 'door', options: ['1/4"', '5/8"', 'Square'] },
    { value: 'prefit_hinge_prep', label: 'Pre-Fit Hinge Prep', type: 'select', scope: 'door', options: ['1741', '1279'] },
    { value: 'prefit_bore_type', label: 'Pre-Fit Bore Type', type: 'select', scope: 'door', options: ['Single', 'Double'] },
    { value: 'prefit_bore_single', label: 'Pre-Fit Bore Single', type: 'text', scope: 'door' },
    { value: 'prefit_bore_top', label: 'Pre-Fit Bore Top', type: 'text', scope: 'door' },
    { value: 'prefit_bore_bottom', label: 'Pre-Fit Bore Bottom', type: 'text', scope: 'door' },
    { value: 'prefit_bore_backset', label: 'Pre-Fit Bore Backset', type: 'select', scope: 'door', options: ['2-3/8"', '2-3/4"'] },
    { value: 'prefit_bore_diameter', label: 'Pre-Fit Bore Diameter', type: 'select', scope: 'door', options: ['2 1/8"', '1 1/2"', '1 5/8"'] },
    { value: 'prefit_swing',   label: 'Pre-Fit Swing',   type: 'select',   scope: 'door', options: ['RHIS', 'RHOS', 'LHIS', 'LHOS'] },
    // bom
    { value: 'bom_modifiers', label: 'BOM Modifiers', type: 'textarea', scope: 'door' },
    { value: 'bom_door_slabs', label: 'BOM Door Slabs', type: 'text', scope: 'door' },
    { value: 'bom_jamb_frame', label: 'BOM Jamb/Frame', type: 'select', scope: 'door', options: ['Jamb', 'Frame'] },
    { value: 'bom_jamb_frame_spec', label: 'BOM Jamb/Frame Spec', type: 'text', scope: 'door' },
    { value: 'bom_bore_type', label: 'BOM Bore Type', type: 'select', scope: 'door', options: ['Single', 'Double'] },
    { value: 'bom_bore_measurements', label: 'BOM Bore Measurements', type: 'text', scope: 'door' },
    { value: 'bom_bore_top', label: 'BOM Bore Top', type: 'text', scope: 'door' },
    { value: 'bom_bore_bottom', label: 'BOM Bore Bottom', type: 'text', scope: 'door' },
    { value: 'bom_hinge_top', label: 'BOM Hinge Top', type: 'text', scope: 'door' },
    { value: 'bom_hinge_middle', label: 'BOM Hinge Middle', type: 'text', scope: 'door' },
    { value: 'bom_hinge_bottom', label: 'BOM Hinge Bottom', type: 'text', scope: 'door' },
    { value: 'bom_hinge_width', label: 'BOM Hinge Width', type: 'select', scope: 'door', options: ['3"', '3-1/2"', '4"', '4-1/2"'] },
    { value: 'bom_hinge_finish', label: 'BOM Hinge Finish', type: 'text', scope: 'door' },
    { value: 'bom_q_lon',     label: 'BOM Q-lon',      type: 'select',   scope: 'door', options: ['Q-lon', 'None'] },
    { value: 'bom_q_lon_color', label: 'BOM Q-lon Color', type: 'select', scope: 'door', options: ['White', 'Black', 'Bronze'] },
    { value: 'bom_sill_threshold', label: 'BOM Sill/Threshold', type: 'select', scope: 'door', options: ['Sill', 'Threshold', 'None'] },
    { value: 'bom_sill_finish', label: 'BOM Sill/Threshold Finish', type: 'select', scope: 'door', options: ['Aluminum', 'Bronze', 'None'] },
    { value: 'bom_door_bottom', label: 'BOM Door Bottom', type: 'text', scope: 'door' },
    { value: 'bom_door_bottom_finish', label: 'BOM Door Bottom Finish', type: 'select', scope: 'door', options: ['Aluminum', 'Bronze', 'None'] },
    { value: 'bom_t_astragal', label: 'BOM T Astragal', type: 'checkbox', scope: 'door' },
    { value: 'bom_ball_catch', label: 'BOM Ball Catch', type: 'checkbox', scope: 'door' },
    { value: 'bom_flush_pulls_finish', label: 'BOM Flush Pulls Finish', type: 'select', scope: 'door', options: ['None', 'US10B', 'US15', 'US26D', 'Black', 'Bronze', 'White', 'Selected'] },
    { value: 'bom_casing_ext_trim', label: 'BOM Casing/Ext Trim', type: 'text', scope: 'door' },
    { value: 'bom_space',     label: 'BOM Space Between Units', type: 'text', scope: 'door' },
];

function _getBulkFieldDef(fieldValue) {
    return BULK_SET_FIELDS.find(f => f.value === fieldValue) || null;
}

function getBulkItemType(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'window') return 'window';
    if (normalized === 'hardware') return 'hardware';
    return 'door';
}

function getBulkDefaultsForType(type) {
    const itemType = getBulkItemType(type);
    if (!bulkSetDefaults[itemType] || typeof bulkSetDefaults[itemType] !== 'object') {
        bulkSetDefaults[itemType] = {};
    }
    return bulkSetDefaults[itemType];
}

function isBulkFieldCompatibleWithType(fieldDef, itemType) {
    if (!fieldDef) return false;
    const normalizedType = getBulkItemType(itemType);
    return fieldDef.scope === 'all' || fieldDef.scope === 'both' || fieldDef.scope === normalizedType;
}

function hasBulkDefault(itemType, field) {
    return Object.prototype.hasOwnProperty.call(getBulkDefaultsForType(itemType), field);
}

function getBulkDefault(itemType, field) {
    return getBulkDefaultsForType(itemType)[field];
}

function setBulkDefault(itemType, field, value) {
    getBulkDefaultsForType(itemType)[field] = value;
}

function deleteBulkDefault(itemType, field) {
    delete getBulkDefaultsForType(itemType)[field];
}

function getBulkGroupNameForItem(item) {
    if (typeof getAs400GroupNameForItem === 'function') {
        return getAs400GroupNameForItem(item);
    }

    const rawGroup = item?.as400_group || item?.vendor || '';
    const normalized = typeof normalizeAs400GroupName === 'function'
        ? normalizeAs400GroupName(rawGroup)
        : String(rawGroup || '').trim();
    return normalized || 'Ungrouped';
}

function getBulkGroupDefaults(itemType, groupName) {
    const typeDefaults = getBulkDefaultsForType(itemType);
    if (!typeDefaults[BULK_DEFAULT_GROUPS_KEY] || typeof typeDefaults[BULK_DEFAULT_GROUPS_KEY] !== 'object') {
        typeDefaults[BULK_DEFAULT_GROUPS_KEY] = {};
    }

    const normalizedGroup = String(groupName || 'Ungrouped').trim() || 'Ungrouped';
    if (!typeDefaults[BULK_DEFAULT_GROUPS_KEY][normalizedGroup] || typeof typeDefaults[BULK_DEFAULT_GROUPS_KEY][normalizedGroup] !== 'object') {
        typeDefaults[BULK_DEFAULT_GROUPS_KEY][normalizedGroup] = {};
    }

    return typeDefaults[BULK_DEFAULT_GROUPS_KEY][normalizedGroup];
}

function hasBulkGroupDefault(itemType, groupName, field) {
    return Object.prototype.hasOwnProperty.call(getBulkGroupDefaults(itemType, groupName), field);
}

function getBulkGroupDefault(itemType, groupName, field) {
    return getBulkGroupDefaults(itemType, groupName)[field];
}

function setBulkGroupDefault(itemType, groupName, field, value) {
    getBulkGroupDefaults(itemType, groupName)[field] = value;
}

function deleteBulkGroupDefault(itemType, groupName, field) {
    delete getBulkGroupDefaults(itemType, groupName)[field];
}

function resetBulkDefaults() {
    Object.keys(bulkSetDefaults).forEach(key => delete bulkSetDefaults[key]);
    bulkSetDefaults.door = {};
    bulkSetDefaults.window = {};
    bulkSetDefaults.hardware = {};
}

function setBulkDefaultForFilter(fieldDef, field, value, filter) {
    const targetTypes = filter === 'door'
        ? ['door']
        : filter === 'window'
            ? ['window']
            : filter === 'hardware'
                ? ['hardware']
                : ['door', 'window', 'hardware'];

    targetTypes.forEach(itemType => {
        if (isBulkFieldCompatibleWithType(fieldDef, itemType)) {
            setBulkDefault(itemType, field, value);
        }
    });
}
function _bulkSnapshotStorageKey(orderId) {
    const idText = String(orderId || '').trim();
    if (!idText) return '';
    return `${BULK_SNAPSHOT_STORAGE_PREFIX}${idText}`;
}

function saveBulkLineItemsSnapshot(reason = {}) {
    const orderId = selectedOrderId || currentOrder?.id;
    const key = _bulkSnapshotStorageKey(orderId);
    if (!key || !Array.isArray(currentLineItems)) return;

    try {
        const existingRaw = window.localStorage.getItem(key);
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const snapshots = Array.isArray(existing) ? existing : [];
        snapshots.unshift({
            saved_at: new Date().toISOString(),
            reason,
            line_items: JSON.parse(JSON.stringify(currentLineItems)),
        });
        window.localStorage.setItem(key, JSON.stringify(snapshots.slice(0, 10)));
    } catch (error) {
        console.warn('Unable to save bulk line item snapshot', error);
    }
}
function _bulkDefaultsStorageKey(orderId) {
    const idText = String(orderId || '').trim();
    if (!idText) return '';
    return `${BULK_SET_DEFAULTS_STORAGE_PREFIX}${idText}`;
}

function _saveBulkDefaultsForOrder(orderId) {
    const key = _bulkDefaultsStorageKey(orderId);
    if (!key) return;
    try {
        window.localStorage.setItem(key, JSON.stringify(bulkSetDefaults));
    } catch (error) {
        console.warn('Unable to persist bulk defaults', error);
    }
}

function _loadBulkDefaultsForOrder(orderId) {
    const key = _bulkDefaultsStorageKey(orderId);

    // Reset in-memory defaults first to avoid bleed between orders.
    resetBulkDefaults();

    if (!key) return;

    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;

        if (parsed.door && typeof parsed.door === 'object') {
            Object.entries(parsed.door).forEach(([field, value]) => {
                if (field === BULK_DEFAULT_GROUPS_KEY && value && typeof value === 'object') {
                    bulkSetDefaults.door[BULK_DEFAULT_GROUPS_KEY] = value;
                    return;
                }
                const def = _getBulkFieldDef(field);
                if (isBulkFieldCompatibleWithType(def, 'door')) {
                    bulkSetDefaults.door[field] = value;
                }
            });
        }

        if (parsed.window && typeof parsed.window === 'object') {
            Object.entries(parsed.window).forEach(([field, value]) => {
                if (field === BULK_DEFAULT_GROUPS_KEY && value && typeof value === 'object') {
                    bulkSetDefaults.window[BULK_DEFAULT_GROUPS_KEY] = value;
                    return;
                }
                const def = _getBulkFieldDef(field);
                if (isBulkFieldCompatibleWithType(def, 'window')) {
                    bulkSetDefaults.window[field] = value;
                }
            });
        }


        if (parsed.hardware && typeof parsed.hardware === 'object') {
            Object.entries(parsed.hardware).forEach(([field, value]) => {
                if (field === BULK_DEFAULT_GROUPS_KEY && value && typeof value === 'object') {
                    bulkSetDefaults.hardware[BULK_DEFAULT_GROUPS_KEY] = value;
                    return;
                }
                const def = _getBulkFieldDef(field);
                if (isBulkFieldCompatibleWithType(def, 'hardware')) {
                    bulkSetDefaults.hardware[field] = value;
                }
            });
        }
        // Backward compatibility for older flat saved defaults.
        Object.entries(parsed).forEach(([field, value]) => {
            if (field === 'door' || field === 'window' || field === 'hardware') return;
            const def = _getBulkFieldDef(field);
            if (!def) return;
            setBulkDefaultForFilter(def, field, value, 'all');
        });
    } catch (error) {
        console.warn('Unable to restore bulk defaults', error);
    }
}

// ── end Bulk Set preamble ────────────────────────────────────────────────────

// ── Bulk Set remaining helpers ──────────────────────────────────────────────

function _getBulkValueOptions(fieldDef) {
    if (!fieldDef) return [];
    if (fieldDef.options) return fieldDef.options;

    switch (fieldDef.value) {
        case 'style':   return [...getStyleOptionsForType('door'), ...getStyleOptionsForType('window').filter(o => !getStyleOptionsForType('door').includes(o))];
        case 'vendor':  return [...getVendorOptionsForType('door'), ...getVendorOptionsForType('window').filter(o => !getVendorOptionsForType('door').includes(o))];
        case 'series':  return Object.values(vendorSeriesOptions).flatMap(byVendor => Object.values(byVendor).flat()).filter((v, i, a) => v && a.indexOf(v) === i);
        case 'hardware_product_code': return Object.values(vendorSeriesOptions.hardware || {}).flat().filter((v, i, a) => v && a.indexOf(v) === i);
        case 'hardware_lever_knob_style': return getStyleOptionsForType('hardware');
        case 'fin_type':  return getFinTypeOptions();
        case 'operation': return getWindowHandingOptions();
        case 'jamb_size': return getJambSizeOptions();
        default: return [];
    }
}

function renderBulkSetValueInput(fieldDef) {
    const wrapper = document.getElementById('bulkSetValueWrapper');
    if (!wrapper || !fieldDef) return;

    if (fieldDef.type === 'select') {
        const options = _getBulkValueOptions(fieldDef);
        const optHtml = options.map(rawOption => {
            const option = (rawOption && typeof rawOption === 'object')
                ? {
                    value: String(rawOption.value ?? rawOption.label ?? ''),
                    label: String(rawOption.label ?? rawOption.value ?? ''),
                }
                : {
                    value: String(rawOption ?? ''),
                    label: String(rawOption ?? ''),
                };
            return `<option value="${escapeHtmlAttribute(option.value)}">${escapeHtml(option.label)}</option>`;
        }).join('');
        wrapper.innerHTML = `<select id="bulkSetValue"><option value="">— select —</option>${optHtml}</select>`;
    } else if (fieldDef.type === 'checkbox') {
        wrapper.innerHTML = `
            <label class="checkbox-label" style="display:inline-flex;">
                <input id="bulkSetValue" type="checkbox">
                <span>${escapeHtml(fieldDef.label)}</span>
            </label>
        `;
    } else if (fieldDef.type === 'textarea') {
        wrapper.innerHTML = `<textarea id="bulkSetValue" rows="2" style="width:100%;resize:vertical;"></textarea>`;
    } else {
        const numAttr = fieldDef.type === 'number' ? ' type="number" min="0" step="any"' : ' type="text"';
        wrapper.innerHTML = `<input id="bulkSetValue"${numAttr} style="width:100%;">`;
    }
}

function populateBulkSetFieldDropdown() {
    const sel = document.getElementById('bulkSetField');
    if (!sel) return;
    sel.innerHTML = BULK_SET_FIELDS.map(f =>
        `<option value="${f.value}">${f.label}${f.scope !== 'both' ? ' (' + f.scope + ' only)' : ''}</option>`
    ).join('');
    const firstDef = _getBulkFieldDef(sel.value);
    renderBulkSetValueInput(firstDef);
}

function normalizeBulkSetValue(fieldDef, value) {
    if (!fieldDef) return value;

    if (fieldDef.type === 'checkbox') {
        return Boolean(value);
    }

    if (fieldDef.type === 'number') {
        const text = String(value ?? '').trim();
        return text === '' ? '' : Number(text);
    }

    if (fieldDef.value === 'fin_type') {
        return normalizeFinTypeValue(value);
    }

    if (fieldDef.value === 'prefit_thickness' || fieldDef.value === 'prefit_hinge_width' || fieldDef.value === 'bom_hinge_width' || fieldDef.value === 'prefit_hinge_radius' || fieldDef.value === 'prefit_bore_backset' || fieldDef.value === 'prefit_bore_diameter') {
        return normalizePrefitSelectValue(fieldDef.value, value);
    }

    return value;
}

function syncBulkSetPanelSelection(field, value) {
    const fieldSelect = document.getElementById('bulkSetField');
    if (!fieldSelect) return;

    if (fieldSelect.value !== field) {
        fieldSelect.value = field;
        renderBulkSetValueInput(_getBulkFieldDef(field));
    }

    const valueInput = document.getElementById('bulkSetValue');
    if (valueInput) {
        if (String(valueInput.type || '').toLowerCase() === 'checkbox') {
            valueInput.checked = Boolean(value);
        } else {
            valueInput.value = value === null || value === undefined ? '' : String(value);
        }
    }
}

function applyBulkSetValue(field, rawValue, filter = 'all', options = {}) {
    const fieldDef = _getBulkFieldDef(field);
    if (!fieldDef) return;

    const normalizedValue = normalizeBulkSetValue(fieldDef, rawValue);
    saveBulkLineItemsSnapshot({ action: 'bulk-set', field, filter, value: normalizedValue });

    // Remember as a default for newly added items.
    setBulkDefaultForFilter(fieldDef, field, normalizedValue, filter);
    _saveBulkDefaultsForOrder(selectedOrderId || currentOrder?.id);

    let changed = 0;
    currentLineItems.forEach(item => {
        if (filter === 'door' && item.type !== 'door') return;
        if (filter === 'window' && item.type !== 'window') return;

        if (fieldDef.scope === 'door' && item.type !== 'door') return;
        if (fieldDef.scope === 'window' && item.type !== 'window') return;

        item[field] = normalizedValue;
        changed += 1;
    });

    if (changed > 0) {
        renderLineItemsEditor();
        syncLineItemsToHiddenField();

        if (options.showToast !== false) {
            showToast(`Set "${fieldDef.label}" on ${changed} item${changed !== 1 ? 's' : ''} • remembered for new items`);
        }
    } else if (options.showToast !== false) {
        showToast('No matching items to update');
    }
}

function applyBulkSetValueToGroup(field, rawValue, sourceItem, options = {}) {
    const fieldDef = _getBulkFieldDef(field);
    if (!fieldDef || !sourceItem) return false;

    const itemType = getBulkItemType(sourceItem.type);
    if (!isBulkFieldCompatibleWithType(fieldDef, itemType)) return false;

    const groupName = getBulkGroupNameForItem(sourceItem);
    const normalizedValue = normalizeBulkSetValue(fieldDef, rawValue);
    saveBulkLineItemsSnapshot({ action: 'bulk-star', field, itemType, groupName, value: normalizedValue });

    setBulkGroupDefault(itemType, groupName, field, normalizedValue);
    _saveBulkDefaultsForOrder(selectedOrderId || currentOrder?.id);

    let changed = 0;
    currentLineItems.forEach(item => {
        if (getBulkItemType(item?.type) !== itemType) return;
        if (getBulkGroupNameForItem(item) !== groupName) return;

        item[field] = normalizedValue;
        changed += 1;
    });

    if (changed > 0) {
        renderLineItemsEditor();
        syncLineItemsToHiddenField();

        if (options.showToast !== false) {
            showToast(`Set "${fieldDef.label}" on ${changed} ${groupName} item${changed !== 1 ? 's' : ''} • remembered for this group`);
        }
    } else if (options.showToast !== false) {
        showToast('No matching items to update in this group');
    }

    return changed > 0;
}

function applyBulkSet(filter) {
    const sel = document.getElementById('bulkSetField');
    const valEl = document.getElementById('bulkSetValue');
    if (!sel || !valEl) return;

    const field = sel.value;
    const rawValue = String(valEl.type || '').toLowerCase() === 'checkbox' ? valEl.checked : valEl.value;
    applyBulkSetValue(field, rawValue, filter, { showToast: true });
}

function decorateLineItemBulkStarButtons() {
    if (!lineItemsList) return;

    lineItemsList.querySelectorAll('.line-item-field').forEach(fieldEl => {
        const control = fieldEl.querySelector('input[data-item-field], textarea[data-item-field], select[data-item-field]');
        if (!control) return;

        const field = control.getAttribute('data-item-field');
        const index = control.getAttribute('data-item-index');
        const fieldDef = _getBulkFieldDef(field);
        if (!fieldDef || index === null) return;

        const label = fieldEl.querySelector('label');
        if (!label || label.classList.contains('checkbox-label')) return;
        if (label.querySelector('[data-item-bulk-star]')) return;

        label.classList.add('line-item-label-with-star');

        const item = currentLineItems[Number(index)];
        const itemType = getBulkItemType(item?.type);
        const groupName = getBulkGroupNameForItem(item);
        const isActive = hasBulkGroupDefault(itemType, groupName, field) && String(getBulkGroupDefault(itemType, groupName, field)) === String(item?.[field] ?? '');
        const starButton = document.createElement('button');
        starButton.type = 'button';
        starButton.className = `item-bulk-star-button ${isActive ? 'active' : ''}`;
        starButton.setAttribute('data-item-bulk-star', 'true');
        starButton.setAttribute('data-item-index', index);
        starButton.setAttribute('data-item-field', field);
        starButton.setAttribute('title', `Use this ${fieldDef.label} for ${groupName}`);
        starButton.tabIndex = -1;
        starButton.textContent = isActive ? '\u2605' : '\u2606';
        label.appendChild(starButton);
    });

    lineItemsList.querySelectorAll('label.checkbox-label').forEach(label => {
        const control = label.querySelector('input[data-item-field]');
        if (!control) return;

        const field = control.getAttribute('data-item-field');
        const index = control.getAttribute('data-item-index');
        const fieldDef = _getBulkFieldDef(field);
        if (!fieldDef || index === null) return;
        if (label.querySelector('[data-item-bulk-star]')) return;

        label.classList.add('line-item-label-with-star');

        const item = currentLineItems[Number(index)];
        const itemType = getBulkItemType(item?.type);
        const groupName = getBulkGroupNameForItem(item);
        const isActive = hasBulkGroupDefault(itemType, groupName, field) && String(getBulkGroupDefault(itemType, groupName, field)) === String(item?.[field] ?? '');
        const starButton = document.createElement('button');
        starButton.type = 'button';
        starButton.className = `item-bulk-star-button ${isActive ? 'active' : ''}`;
        starButton.setAttribute('data-item-bulk-star', 'true');
        starButton.setAttribute('data-item-index', index);
        starButton.setAttribute('data-item-field', field);
        starButton.setAttribute('title', `Use this ${fieldDef.label} for ${groupName}`);
        starButton.tabIndex = -1;
        starButton.textContent = isActive ? '\u2605' : '\u2606';
        label.appendChild(starButton);
    });
}

function applyBulkFromItemField(index, field) {
    const item = currentLineItems[index];
    const fieldDef = _getBulkFieldDef(field);
    if (!item || !fieldDef) return false;

    const itemType = getBulkItemType(item.type);
    if (!isBulkFieldCompatibleWithType(fieldDef, itemType)) return false;

    const value = item[field];
    if (value === '' || value === null || value === undefined) {
        showToast('Set a field value first, then click the star');
        return false;
    }

    syncBulkSetPanelSelection(field, value);
    applyBulkSetValueToGroup(field, value, item, { showToast: true });
    return true;
}

function bindLineItemBulkStarEvents() {
    if (!lineItemsList) return;

    lineItemsList.querySelectorAll('[data-item-bulk-star]').forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const index = parseInt(button.getAttribute('data-item-index'), 10);
            const field = button.getAttribute('data-item-field');
            const sourceItem = currentLineItems[index];
            const itemType = getBulkItemType(sourceItem?.type);
            const groupName = getBulkGroupNameForItem(sourceItem);
            const isActive = button.classList.contains('active');

            if (isActive) {
                deleteBulkGroupDefault(itemType, groupName, field);
                _saveBulkDefaultsForOrder(selectedOrderId || currentOrder?.id);

                lineItemsList.querySelectorAll(`[data-item-field="${field}"][data-item-bulk-star]`)
                    .forEach(btn => {
                        const buttonIndex = parseInt(btn.getAttribute('data-item-index'), 10);
                        const buttonItem = currentLineItems[buttonIndex];
                        if (getBulkItemType(buttonItem?.type) !== itemType) return;
                        if (getBulkGroupNameForItem(buttonItem) !== groupName) return;
                        btn.classList.remove('active');
                        btn.textContent = '\u2606';
                    });
            } else {
                const didApply = applyBulkFromItemField(index, field);
                if (!didApply) {
                    renderLineItemsEditor();
                    return;
                }

                lineItemsList.querySelectorAll(`[data-item-field="${field}"][data-item-bulk-star]`)
                    .forEach(btn => {
                        const buttonIndex = parseInt(btn.getAttribute('data-item-index'), 10);
                        const buttonItem = currentLineItems[buttonIndex];
                        if (getBulkItemType(buttonItem?.type) !== itemType) return;
                        if (getBulkGroupNameForItem(buttonItem) !== groupName) return;
                        btn.classList.add('active');
                        btn.textContent = '\u2605';
                    });
            }

            renderLineItemsEditor();
        });
    });
}
function initBulkSetPanel() {
    const toggleBtn  = document.getElementById('bulkSetToggleBtn');
    const panel      = document.getElementById('bulkSetPanel');
    const closeBtn   = document.getElementById('bulkSetCloseBtn');
    const fieldSel   = document.getElementById('bulkSetField');
    const applyAll   = document.getElementById('bulkSetApplyAll');
    const applyDoors = document.getElementById('bulkSetApplyDoors');
    const applyWins  = document.getElementById('bulkSetApplyWindows');

    if (!toggleBtn || !panel) return;

    // Hydrate defaults at startup if an order is already selected.
    _loadBulkDefaultsForOrder(selectedOrderId || currentOrder?.id);

    populateBulkSetFieldDropdown();

    toggleBtn.addEventListener('click', () => {
        const hidden = panel.style.display === 'none';
        panel.style.display = hidden ? '' : 'none';
        if (hidden) populateBulkSetFieldDropdown();
    });

    if (closeBtn) closeBtn.addEventListener('click', () => { panel.style.display = 'none'; });

    if (fieldSel) {
        fieldSel.addEventListener('change', () => {
            renderBulkSetValueInput(_getBulkFieldDef(fieldSel.value));
        });
    }

    if (applyAll)   applyAll.addEventListener('click',   () => applyBulkSet('all'));
    if (applyDoors) applyDoors.addEventListener('click', () => applyBulkSet('door'));
    if (applyWins)  applyWins.addEventListener('click',  () => applyBulkSet('window'));
}

// ── end Bulk Set ─────────────────────────────────────────────────────────────




