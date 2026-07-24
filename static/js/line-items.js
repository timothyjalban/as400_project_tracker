// Order Tracker - Line Items
// Depends on globals from app.js for shared order state, DOM references,
// catalog option state, stage/order persistence, and common UI helpers.
const HARDWARE_LEVER_KNOB_STORAGE_KEY = 'order_tracker_hardware_lever_knob_styles';
const HARDWARE_PRODUCT_CODE_STORAGE_KEY = 'order_tracker_hardware_product_codes_by_vendor';
let hardwareLeverKnobStyleOptions = [];
let hardwareProductCodeOptionsByVendor = {};

const HARDWARE_FINISH_US_CODE_OPTIONS = [
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
];

function loadWindowHandingOptions() {
    try {
        const stored = window.localStorage.getItem(WINDOW_HANDING_STORAGE_KEY);
        if (!stored) {
            windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
            return;
        }

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
            return;
        }

        const merged = [...DEFAULT_WINDOW_HANDING_OPTIONS, ...parsed]
            .map(option => String(option || '').trim().toUpperCase())
            .filter(Boolean);
        windowHandingOptions = Array.from(new Set(merged));
    } catch (error) {
        console.warn('Unable to load window handing options, using defaults.', error);
        windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
    }
}

function saveWindowHandingOptions() {
    try {
        window.localStorage.setItem(WINDOW_HANDING_STORAGE_KEY, JSON.stringify(windowHandingOptions));
    } catch (error) {
        console.warn('Unable to persist window handing options.', error);
    }
}

function getWindowHandingOptions() {
    return Array.isArray(windowHandingOptions) && windowHandingOptions.length > 0
        ? windowHandingOptions
        : [...DEFAULT_WINDOW_HANDING_OPTIONS];
}

function uniqueSortedOptions(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
        .map(value => String(value || '').trim())
        .filter(Boolean)))
        .sort((a, b) => a.localeCompare(b));
}

function getSingleValueAddOptions(currentValue, addLabel) {
    const clean = String(currentValue || '').trim();
    return clean ? [clean, addLabel] : [addLabel];
}

function loadHardwareLeverKnobStyleOptions() {
    try {
        const raw = window.localStorage.getItem(HARDWARE_LEVER_KNOB_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        hardwareLeverKnobStyleOptions = uniqueSortedOptions(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
        console.warn('Unable to load hardware lever/knob styles.', error);
        hardwareLeverKnobStyleOptions = [];
    }
}

function saveHardwareLeverKnobStyleOptions() {
    try {
        window.localStorage.setItem(HARDWARE_LEVER_KNOB_STORAGE_KEY, JSON.stringify(hardwareLeverKnobStyleOptions));
    } catch (error) {
        console.warn('Unable to persist hardware lever/knob styles.', error);
    }
}

function rememberHardwareLeverKnobStyle(value) {
    const clean = String(value || '').trim();
    if (!clean) return;
    hardwareLeverKnobStyleOptions = uniqueSortedOptions([...hardwareLeverKnobStyleOptions, clean]);
    saveHardwareLeverKnobStyleOptions();
}
function normalizeHardwareVendorKey(vendorName) {
    return String(vendorName || '').trim().toLowerCase();
}

function loadHardwareProductCodeOptions() {
    try {
        const raw = window.localStorage.getItem(HARDWARE_PRODUCT_CODE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        hardwareProductCodeOptionsByVendor = {};
        if (parsed && typeof parsed === 'object') {
            Object.entries(parsed).forEach(([vendorKey, codes]) => {
                hardwareProductCodeOptionsByVendor[normalizeHardwareVendorKey(vendorKey)] = uniqueSortedOptions((Array.isArray(codes) ? codes : [])
                    .filter(isHardwareProductCodeValue));
            });
        }
    } catch (error) {
        console.warn('Unable to load hardware product codes.', error);
        hardwareProductCodeOptionsByVendor = {};
    }
}

function saveHardwareProductCodeOptions() {
    try {
        window.localStorage.setItem(HARDWARE_PRODUCT_CODE_STORAGE_KEY, JSON.stringify(hardwareProductCodeOptionsByVendor));
    } catch (error) {
        console.warn('Unable to persist hardware product codes.', error);
    }
}

function rememberHardwareProductCode(vendorName, value) {
    const vendorKey = normalizeHardwareVendorKey(vendorName);
    const clean = String(value || '').trim();
    if (!vendorKey || !isHardwareProductCodeValue(clean)) return;
    hardwareProductCodeOptionsByVendor[vendorKey] = uniqueSortedOptions([...(hardwareProductCodeOptionsByVendor[vendorKey] || []), clean]);
    saveHardwareProductCodeOptions();
}

function getHardwareLeverKnobStyleOptions(currentValue = '') {
    const currentOrderStyles = (Array.isArray(currentLineItems) ? currentLineItems : [])
        .filter(candidate => String(candidate?.type || '').toLowerCase() === 'hardware')
        .map(candidate => candidate?.hardware_lever_knob_style);
    const options = uniqueSortedOptions([...hardwareLeverKnobStyleOptions, ...currentOrderStyles, currentValue]);
    return [...options, '+ Add New Lever/Knob Style'];
}

function isHardwareProductCodeValue(value) {
    return /^\d+$/.test(String(value || '').trim());
}

function getHardwareProductCodeOptions(item = {}) {
    const vendor = String(item.vendor || '').trim();
    const vendorKey = normalizeHardwareVendorKey(vendor);
    const savedForVendor = vendorKey ? (hardwareProductCodeOptionsByVendor[vendorKey] || []) : [];
    const currentOrderCodes = (Array.isArray(currentLineItems) ? currentLineItems : [])
        .filter(candidate => String(candidate?.type || '').toLowerCase() === 'hardware')
        .filter(candidate => !vendor || String(candidate?.vendor || '').trim().toLowerCase() === vendor.toLowerCase())
        .map(candidate => candidate?.hardware_product_code);
    const options = uniqueSortedOptions([...savedForVendor, ...currentOrderCodes, item.hardware_product_code]
        .filter(isHardwareProductCodeValue));
    return [...options, '+ Add New Product Code'];
}

async function promptAndSetHardwareCustomField(index, field, promptLabel) {
    if (!currentLineItems[index]) return null;
    const value = prompt(`Add a new ${promptLabel}:`);
    if (value === null) return null;

    const trimmed = value.trim();
    if (!trimmed) {
        showError(`${promptLabel} cannot be empty`);
        return null;
    }

    if (field === 'hardware_product_code') {
        if (!isHardwareProductCodeValue(trimmed)) {
            showError('Product code must be numbers only');
            return null;
        }

        const vendorName = String(currentLineItems[index].vendor || '').trim();
        if (!vendorName) {
            showError('Select a hardware vendor before adding a product code');
            return null;
        }

        rememberHardwareProductCode(vendorName, trimmed);
    }

    if (field === 'hardware_lever_knob_style') {
        rememberHardwareLeverKnobStyle(trimmed);
    }

    currentLineItems[index][field] = trimmed;
    syncLineItemsToHiddenField();
    persistLineItemsStateSilently();
    renderLineItemsEditor();
    showToast(`${trimmed} added`);
    return trimmed;
}
function addWindowHandingOption(index = null) {
    const handingName = prompt('Add a new window handing (e.g., XO):');
    if (handingName === null) return null;

    const trimmed = handingName.trim().toUpperCase();
    if (!trimmed) {
        showError('Handing cannot be empty');
        return null;
    }

    const alreadyExists = getWindowHandingOptions().includes(trimmed);
    if (!alreadyExists) {
        windowHandingOptions = [...getWindowHandingOptions(), trimmed];
        saveWindowHandingOptions();
    } else {
        showToast(`${trimmed} already exists`);
    }

    if (index !== null && currentLineItems[index]) {
        currentLineItems[index].operation = trimmed;
        syncLineItemsToHiddenField();
        persistLineItemsStateSilently();
    }

    renderLineItemsEditor();
    if (!alreadyExists) showToast(`${trimmed} added to handings`);
    return trimmed;
}

function loadJambSizeOptions() {
    try {
        const stored = window.localStorage.getItem(JAMB_SIZE_STORAGE_KEY);
        if (!stored) {
            jambSizeOptions = [...DEFAULT_JAMB_SIZE_OPTIONS];
            return;
        }

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            jambSizeOptions = [...DEFAULT_JAMB_SIZE_OPTIONS];
            return;
        }

        const merged = [...DEFAULT_JAMB_SIZE_OPTIONS, ...parsed]
            .map(option => String(option || '').trim())
            .filter(Boolean);
        jambSizeOptions = Array.from(new Set(merged));
    } catch (error) {
        console.warn('Unable to load jamb size options, using defaults.', error);
        jambSizeOptions = [...DEFAULT_JAMB_SIZE_OPTIONS];
    }
}

function saveJambSizeOptions() {
    try {
        window.localStorage.setItem(JAMB_SIZE_STORAGE_KEY, JSON.stringify(jambSizeOptions));
    } catch (error) {
        console.warn('Unable to persist jamb size options.', error);
    }
}

function getJambSizeOptions() {
    return Array.isArray(jambSizeOptions) && jambSizeOptions.length > 0
        ? jambSizeOptions
        : [...DEFAULT_JAMB_SIZE_OPTIONS];
}

function rememberJambSizeOption(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return false;

    if (getJambSizeOptions().some(existing => existing.toLowerCase() === value.toLowerCase())) {
        return false;
    }

    jambSizeOptions = [...getJambSizeOptions(), value];
    saveJambSizeOptions();
    return true;
}

function addJambSizeOption(index = null) {
    const jambSize = prompt('Add a jamb size (e.g., 5 1/4):');
    if (jambSize === null) return null;

    const trimmed = jambSize.trim();
    if (!trimmed) {
        showError('Jamb size cannot be empty');
        return null;
    }

    const added = rememberJambSizeOption(trimmed);
    if (!added) {
        showToast(`${trimmed} already exists`);
    }

    if (index !== null && currentLineItems[index]) {
        currentLineItems[index].jamb_size = trimmed;
        syncLineItemsToHiddenField();
        persistLineItemsStateSilently();
    }

    renderLineItemsEditor();
    if (added) showToast(`${trimmed} added to jamb sizes`);
    return trimmed;
}

function loadDoorLocationOptions() {
    try {
        const stored = window.localStorage.getItem(DOOR_LOCATION_STORAGE_KEY);
        if (!stored) {
            doorLocationOptions = [...DEFAULT_DOOR_LOCATION_OPTIONS];
            return;
        }

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            doorLocationOptions = [...DEFAULT_DOOR_LOCATION_OPTIONS];
            return;
        }

        const merged = [...DEFAULT_DOOR_LOCATION_OPTIONS, ...parsed]
            .map(option => String(option || '').trim())
            .filter(Boolean);

        doorLocationOptions = Array.from(new Set(merged));
    } catch (error) {
        console.warn('Unable to load door location options.', error);
        doorLocationOptions = [...DEFAULT_DOOR_LOCATION_OPTIONS];
    }
}

function saveDoorLocationOptions() {
    try {
        window.localStorage.setItem(DOOR_LOCATION_STORAGE_KEY, JSON.stringify(doorLocationOptions));
    } catch (error) {
        console.warn('Unable to persist door location options.', error);
    }
}


const PREFIT_BORE_DIAMETER_STORAGE_KEY = 'order_tracker_prefit_bore_diameter_options';
const DEFAULT_PREFIT_BORE_DIAMETER_OPTIONS = ['2 1/8"', '1 1/2"', '1 5/8"'];
let prefitBoreDiameterOptions = [];

function loadPrefitBoreDiameterOptions() {
    try {
        const stored = window.localStorage.getItem(PREFIT_BORE_DIAMETER_STORAGE_KEY);
        const parsed = stored ? JSON.parse(stored) : [];
        const merged = [...DEFAULT_PREFIT_BORE_DIAMETER_OPTIONS, ...(Array.isArray(parsed) ? parsed : [])]
            .map(option => normalizePrefitSelectValue('prefit_bore_diameter', option))
            .filter(Boolean);
        prefitBoreDiameterOptions = Array.from(new Set(merged));
    } catch (error) {
        console.warn('Unable to load prefit bore diameter options.', error);
        prefitBoreDiameterOptions = [...DEFAULT_PREFIT_BORE_DIAMETER_OPTIONS];
    }
}

function savePrefitBoreDiameterOptions() {
    try {
        window.localStorage.setItem(PREFIT_BORE_DIAMETER_STORAGE_KEY, JSON.stringify(prefitBoreDiameterOptions));
    } catch (error) {
        console.warn('Unable to persist prefit bore diameter options.', error);
    }
}

function getPrefitBoreDiameterOptions() {
    if (!Array.isArray(prefitBoreDiameterOptions) || prefitBoreDiameterOptions.length === 0) {
        loadPrefitBoreDiameterOptions();
    }
    return prefitBoreDiameterOptions;
}

function addPrefitBoreDiameterOption(index = null) {
    const rawValue = prompt('Add a bore diameter (e.g., 2 1/4"):', '');
    if (rawValue === null) return null;

    const value = normalizePrefitSelectValue('prefit_bore_diameter', rawValue);
    if (!value) {
        showError('Bore diameter cannot be empty');
        return null;
    }

    if (!getPrefitBoreDiameterOptions().some(option => option.toLowerCase() === value.toLowerCase())) {
        prefitBoreDiameterOptions = [...getPrefitBoreDiameterOptions(), value];
        savePrefitBoreDiameterOptions();
    }

    if (index !== null && currentLineItems[index]) {
        currentLineItems[index].prefit_bore_diameter = value;
        syncLineItemsToHiddenField();
        persistLineItemsStateSilently();
    }

    renderLineItemsEditor();
    showToast(`${value} selected for bore diameter`);
    return value;
}

const AS400_GROUP_COLORS = ['blue', 'green', 'amber', 'violet', 'cyan', 'rose', 'slate'];
const AS400_NEW_GROUP_OPTION = '+ New Group';

function normalizeAs400GroupName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isBypassLineItem(item) {
    const text = [item?.style, item?.door_style, item?.door_type, item?.model, item?.series, item?.description]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
    return text.includes('bypass');
}

function getDefaultAs400GroupName(item) {
    const vendor = normalizeAs400GroupName(item?.vendor) || 'Ungrouped';
    return isBypassLineItem(item) ? `${vendor} Bypass` : vendor;
}

function syncLineItemAs400Group(item, options = {}) {
    if (!item || typeof item !== 'object') return item;
    const defaultGroup = getDefaultAs400GroupName(item);

    if (options.force || !normalizeAs400GroupName(item.as400_group) || !item.as400_group_custom) {
        item.as400_group = defaultGroup;
        item.as400_group_auto = true;
    } else {
        item.as400_group = normalizeAs400GroupName(item.as400_group);
    }

    return item;
}

function getAs400GroupColor(groupName) {
    const normalized = normalizeAs400GroupName(groupName) || 'Ungrouped';
    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
        hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
        hash |= 0;
    }
    const index = Math.abs(hash) % AS400_GROUP_COLORS.length;
    return AS400_GROUP_COLORS[index];
}

function getAs400GroupNameForItem(item) {
    const group = normalizeAs400GroupName(item?.as400_group) || getDefaultAs400GroupName(item);
    return group || 'Ungrouped';
}

function getAs400GroupOptions() {
    const groups = Array.from(new Set(
        (Array.isArray(currentLineItems) ? currentLineItems : [])
            .map(item => getAs400GroupNameForItem(item))
            .filter(Boolean)
    ));
    return groups.length > 0 ? groups.sort((a, b) => a.localeCompare(b)) : ['Ungrouped'];
}

function getAs400GroupSummary(groupName) {
    const items = (Array.isArray(currentLineItems) ? currentLineItems : [])
        .filter(item => getAs400GroupNameForItem(item) === groupName);
    const count = items.reduce((sum, item) => sum + (Number.parseInt(item.quantity || '1', 10) || 1), 0);
    const total = items.reduce((sum, item) => {
        const quantity = Number.parseInt(item.quantity || '1', 10) || 1;
        const price = Number.parseFloat(String(item.price || '').replace(/,/g, ''));
        return Number.isFinite(price) ? sum + (price * quantity) : sum;
    }, 0);

    return { items, count, total };
}

function sortLineItemsByAs400Group() {
    if (!Array.isArray(currentLineItems) || currentLineItems.length < 2) return;

    const groupOrder = new Map();
    currentLineItems.forEach((item, index) => {
        const group = getAs400GroupNameForItem(item);
        if (!groupOrder.has(group)) groupOrder.set(group, index);
    });

    currentLineItems = currentLineItems
        .map((item, index) => ({ item, index, group: getAs400GroupNameForItem(item) }))
        .sort((a, b) => {
            const byGroupPosition = (groupOrder.get(a.group) ?? a.index) - (groupOrder.get(b.group) ?? b.index);
            return byGroupPosition !== 0 ? byGroupPosition : a.index - b.index;
        })
        .map(entry => entry.item);
}

function ensureLineItemAs400Groups() {
    if (!Array.isArray(currentLineItems)) return;
    currentLineItems.forEach(item => syncLineItemAs400Group(item));
}

function renderAs400GroupHeader(groupName) {
    const summary = getAs400GroupSummary(groupName);
    const color = getAs400GroupColor(groupName);
    const encodedGroup = escapeHtml(groupName);
    const totalText = summary.total > 0 ? ` | $${summary.total.toFixed(2)}` : '';
    return `
        <div class="as400-group-header as400-group-${color}" data-as400-group-header="${encodedGroup}">
            <div class="as400-group-title-wrap">
                <span class="as400-group-swatch"></span>
                <div>
                    <div class="as400-group-title">${escapeHtml(groupName)}</div>
                    <div class="as400-group-meta">${summary.count} item${summary.count === 1 ? '' : 's'}${totalText}</div>
                </div>
            </div>
            <div class="as400-group-actions">
                <button type="button" class="btn btn-primary btn-sm" data-as400-group-action="quote" data-as400-group-name="${encodedGroup}">Create Quote</button>
                <button type="button" class="btn btn-primary btn-sm" data-as400-group-action="invoice" data-as400-group-name="${encodedGroup}">Charge Sale</button>
                <button type="button" class="btn btn-primary btn-sm" data-as400-group-action="special-order" data-as400-group-name="${encodedGroup}">Special Order</button>
            </div>
        </div>
    `;
}

function addAs400GroupForItem(index) {
    const groupName = prompt('New AS400 group name:');
    if (groupName === null) return null;

    const trimmed = normalizeAs400GroupName(groupName);
    if (!trimmed) {
        showError('Group name cannot be empty');
        return null;
    }

    if (currentLineItems[index]) {
        currentLineItems[index].as400_group = trimmed;
        currentLineItems[index].as400_group_custom = true;
        currentLineItems[index].as400_group_auto = false;
        sortLineItemsByAs400Group();
        renderLineItemsEditor();
        syncLineItemsToHiddenField();
        persistLineItemsStateSilently();
        showToast(`Moved item to ${trimmed}`);
    }

    return trimmed;
}
function createLineItemTemplate(type) {
    // Apply any bulk-set defaults that are compatible with this item type.
    const defaults = {};
    for (const [field, value] of Object.entries(getBulkDefaultsForType(type))) {
        const def = _getBulkFieldDef(field);
        if (!isBulkFieldCompatibleWithType(def, type)) continue;
        if (value !== '' && value !== null && value !== undefined) defaults[field] = value;
    }

    return {
        type,
        product: type === 'hardware' ? 'Hardware' : (type === 'window' ? 'Window' : 'Door'),
        door_count: '',
        entry_door: false,
        sidelites: '',
        transom: false,
        prefit_enabled: false,
        prefit_customer_brought_door: false,
        prefit_width: '',
        prefit_height: '',
        prefit_thickness: '',
        prefit_lites: '',
        prefit_vent_top: false,
        prefit_vent_bottom: false,
        prefit_hinge_top: '',
        prefit_hinge_middle: '',
        prefit_hinge_bottom: '',
        prefit_hinge_width: '',
        prefit_hinge_backset: '',
        prefit_hinge_radius: '',
        prefit_hinge_prep: '',
        prefit_bore_type: '',
        prefit_bore_single: '',
        prefit_bore_top: '',
        prefit_bore_bottom: '',
        prefit_bore_backset: '',
        prefit_bore_diameter: '2 1/8"',
        prefit_swing: '',
        bom_enabled: false,
        bom_modifiers: '',
        bom_door_slabs: '',
        bom_jamb_frame: '',
        bom_jamb_frame_spec: '',
        bom_bore_type: '',
        bom_bore_measurements: '',
        bom_bore_top: '',
        bom_bore_bottom: '',
        bom_hinge_top: '',
        bom_hinge_middle: '',
        bom_hinge_bottom: '',
        bom_hinge_width: '',
        bom_hinge_finish: '',
        bom_q_lon: '',
        bom_q_lon_color: '',
        bom_sill_threshold: '',
        bom_sill_finish: '',
        bom_door_bottom: '',
        bom_door_bottom_finish: '',
        bom_t_astragal: false,
        bom_ball_catch: false,
        bom_flush_pulls_finish: '',
        bom_casing_ext_trim: '',
        bom_space: '',
        quantity: 1,
        no_cost: false,
        price: '',
        operation: '',
        vendor: '',
        vendor_sku: '',
        thickness: '',
        jamb_size: '',
        room: '',
        series: '',
        model: '',
        fin_type: '',
        argon: '',
        style: '',
        material: '',
        core: '',
        sticking: '',
        swing: '',
        frame: '',
        color: '',
        exterior_color: '',
        interior_color: '',
        glass: '',
        tempered_glass: false,
        hardware_function: '',
        hardware_product_code: '',
        hardware_lever_knob_style: '',
        hardware_finish_code: '',
        hardware_finish: '',
        hardware_handing: '',
        hardware_backset: '',
        hardware_bore: '',
        hardware_keying: '',
        size_mode: 'rough_opening',
        callout_size: '',
        width: '',
        height: '',
        gable_tall_side: '',
        gable_short_side: '',
        notes: '',
        ui_collapsed: false,
        as400_group: '',
        as400_group_auto: true,
        as400_group_custom: false,
        // Bulk-set defaults override the blank values above (must be last).
        ...defaults,
    };
}

function normalizeFinTypeValue(value) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    return FIN_TYPE_ALIASES[clean.toLowerCase()] || clean;
}

function normalizePrefitSelectValue(field, value) {
    const clean = String(value || '').trim();
    if (!clean) return '';

    const aliasesByField = {
        prefit_thickness: {
            '1-3/8': '1-3/8"',
            '1-3/8"': '1-3/8"',
            '1 3/8': '1-3/8"',
            '1 3/8"': '1-3/8"',
            '1-3/4': '1-3/4"',
            '1-3/4"': '1-3/4"',
            '1 3/4': '1-3/4"',
            '1 3/4"': '1-3/4"'
        },
        prefit_hinge_width: {
            '3': '3"',
            '3"': '3"',
            '3-1/2': '3-1/2"',
            '3-1/2"': '3-1/2"',
            '4': '4"',
            '4"': '4"',
            '4-1/2': '4-1/2"',
            '4-1/2"': '4-1/2"'
        },
        bom_hinge_width: {
            '3': '3"',
            '3"': '3"',
            '3-1/2': '3-1/2"',
            '3-1/2"': '3-1/2"',
            '4': '4"',
            '4"': '4"',
            '4-1/2': '4-1/2"',
            '4-1/2"': '4-1/2"'
        },
        prefit_hinge_radius: {
            '1/4': '1/4"',
            '1/4"': '1/4"',
            '5/8': '5/8"',
            '5/8"': '5/8"',
            'square': 'Square',
            'Square': 'Square'
        },
        prefit_bore_backset: {
            '2-3/8': '2-3/8"',
            '2-3/8"': '2-3/8"',
            '2 3/8': '2-3/8"',
            '2 3/8"': '2-3/8"',
            '2-3/4': '2-3/4"',
            '2-3/4"': '2-3/4"',
            '2 3/4': '2-3/4"',
            '2 3/4"': '2-3/4"'
        },
        prefit_bore_diameter: {
            '2-1/8': '2 1/8"',
            '2-1/8"': '2 1/8"',
            '2 1/8': '2 1/8"',
            '2 1/8"': '2 1/8"',
            '1-1/2': '1 1/2"',
            '1-1/2"': '1 1/2"',
            '1 1/2': '1 1/2"',
            '1 1/2"': '1 1/2"',
            '1-5/8': '1 5/8"',
            '1-5/8"': '1 5/8"',
            '1 5/8': '1 5/8"',
            '1 5/8"': '1 5/8"'
        }
    };

    const aliases = aliasesByField[field];
    if (!aliases) return clean;

    return aliases[clean] || aliases[clean.toLowerCase()] || clean;
}

function parseInchesValue(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (!text) return null;

    // Accept values like 36, 36", 36 in, etc. and extract first numeric token.
    const match = text.match(/\d+(?:\.\d+)?/);
    if (!match) return null;

    const numeric = Number.parseFloat(match[0]);
    if (!Number.isFinite(numeric)) return null;
    return Math.round(numeric);
}

function calloutToDimensions(calloutRaw) {
    const digits = String(calloutRaw || '').replace(/\D/g, '');
    if (!digits || digits.length < 4) return null;

    // Use first two chars for width and next two for height, matching legacy WWHH usage (e.g. 3068).
    const widthCode = digits.slice(0, 2);
    const heightCode = digits.slice(2, 4);

    const widthFeet = Number.parseInt(widthCode[0], 10);
    const widthInches = Number.parseInt(widthCode.slice(1), 10);
    const heightFeet = Number.parseInt(heightCode[0], 10);
    const heightInches = Number.parseInt(heightCode.slice(1), 10);

    if (![widthFeet, widthInches, heightFeet, heightInches].every(Number.isFinite)) return null;

    return {
        width: String((widthFeet * 12) + widthInches),
        height: String((heightFeet * 12) + heightInches),
    };
}

function dimensionsToCallout(widthRaw, heightRaw) {
    const widthInchesTotal = parseInchesValue(widthRaw);
    const heightInchesTotal = parseInchesValue(heightRaw);
    if (!Number.isFinite(widthInchesTotal) || !Number.isFinite(heightInchesTotal)) return '';

    const widthFeet = Math.floor(widthInchesTotal / 12);
    const widthInches = widthInchesTotal % 12;
    const heightFeet = Math.floor(heightInchesTotal / 12);
    const heightInches = heightInchesTotal % 12;

    // The legacy WWHH callout format cannot safely represent 10" or 11" remainders.
    if (widthInches > 9 || heightInches > 9) return '';

    return `${widthFeet}${widthInches}${heightFeet}${heightInches}`;
}

function normalizeDoorSwingFromImport(item) {
    const existing = String(item?.swing || '').trim();
    if (existing) return existing;

    const handingText = String(item?.handing || item?.operation || '').trim().toLowerCase();
    const styleText = [item?.style, item?.milgard_model, item?.model, item?.series]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');

    const isInswing = styleText.includes('inswing');
    const isOutswing = styleText.includes('outswing');

    if (handingText.includes('right')) {
        if (isInswing) return 'RHIS';
        if (isOutswing) return 'RHOS';
    }
    if (handingText.includes('left')) {
        if (isInswing) return 'LHIS';
        if (isOutswing) return 'LHOS';
    }

    return existing;
}
function parseWindowColorPair(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return { exterior: '', interior: '' };

    const extIntMatch = raw.match(/(?:^|\b)Ext(?:erior)?\s+([^/|,]+?)\s*[/|,]\s*Int(?:erior)?\s+(.+)$/i);
    if (extIntMatch) {
        return {
            exterior: extIntMatch[1].trim(),
            interior: extIntMatch[2].replace(/[,|].*$/, '').trim()
        };
    }

    return { exterior: raw, interior: raw };
}

function syncWindowLegacyColor(item) {
    if (!item || item.type !== 'window') return;
    const exterior = String(item.exterior_color || '').trim();
    const interior = String(item.interior_color || '').trim();
    if (exterior && interior) {
        item.color = exterior.toLowerCase() === interior.toLowerCase()
            ? exterior
            : `Ext ${exterior} / Int ${interior}`;
    } else {
        item.color = exterior || interior || String(item.color || '').trim();
    }
}
function normalizeLineItem(rawItem) {
    const item = { ...createLineItemTemplate('door'), ...(rawItem || {}) };
    const rawTypeText = String(item.type || item.product || '').toLowerCase();
    const detectedType = rawTypeText.includes('hardware') ? 'hardware' : (rawTypeText.includes('window') ? 'window' : 'door');
    item.type = detectedType;
    item.product = detectedType === 'hardware' ? 'Hardware' : (detectedType === 'window' ? 'Window' : 'Door');
    if (detectedType === 'door') {
        if (!item.series && rawItem?.model) item.series = String(rawItem.model);
        item.swing = normalizeDoorSwingFromImport(item);
        item.prefit_swing = item.prefit_swing || item.swing || '';
        item.model = item.series || item.model || '';
        item.thickness = normalizePrefitSelectValue('prefit_thickness', item.thickness || item.prefit_thickness || '');
        item.prefit_thickness = item.prefit_thickness || item.thickness || '';
    }
    item.quantity = item.quantity || 1;
    if (!item.operation && rawItem?.operation_style) {
        item.operation = rawItem.operation_style;
    }
    if (!item.vendor_sku && item.vendor) {
        item.vendor_sku = getVendorSkuForName(item.vendor) || '';
    }
    if ((item.price == null || item.price === '') && (rawItem?.unit_price != null || rawItem?.quote_total != null)) {
        item.price = rawItem.unit_price ?? rawItem.quote_total ?? '';
    }
    if (!item.argon && rawItem?.argon !== undefined && rawItem?.argon !== null) {
        item.argon = String(rawItem.argon).trim();
    }
    item.fin_type = normalizeFinTypeValue(item.fin_type);
    if (item.type === 'window') {
        const colorPair = parseWindowColorPair(rawItem?.color || item.color || '');
        item.exterior_color = String(rawItem?.exterior_color || rawItem?.ext_color || rawItem?.exterior_finish || item.exterior_color || colorPair.exterior || '').trim();
        item.interior_color = String(rawItem?.interior_color || rawItem?.int_color || rawItem?.interior_finish || item.interior_color || colorPair.interior || '').trim();
        syncWindowLegacyColor(item);
    }
    const normalizedSizeMode = String(item.size_mode || '').trim().toLowerCase();
    if (normalizedSizeMode === 'callout' || normalizedSizeMode === 'rough_opening' || normalizedSizeMode === 'net_size') {
        item.size_mode = normalizedSizeMode;
    } else {
        const calloutCandidate = String(item.callout_size || item.size || '').replace(/\s+/g, '');
        item.size_mode = /^\d{3,5}$/.test(calloutCandidate) ? 'callout' : 'rough_opening';
    }
    item.callout_size = String(item.callout_size || item.size || '').trim();
    item.prefit_thickness = normalizePrefitSelectValue('prefit_thickness', item.prefit_thickness);
    item.prefit_hinge_width = normalizePrefitSelectValue('prefit_hinge_width', item.prefit_hinge_width);
    item.bom_hinge_width = normalizePrefitSelectValue('bom_hinge_width', item.bom_hinge_width);
    item.prefit_hinge_radius = normalizePrefitSelectValue('prefit_hinge_radius', item.prefit_hinge_radius);
    item.prefit_bore_backset = normalizePrefitSelectValue('prefit_bore_backset', item.prefit_bore_backset);
    item.prefit_bore_diameter = normalizePrefitSelectValue('prefit_bore_diameter', item.prefit_bore_diameter || '2 1/8"');
    item.gable_tall_side = String(rawItem?.gable_tall_side || item.gable_tall_side || '').trim();
    item.gable_short_side = String(rawItem?.gable_short_side || item.gable_short_side || '').trim();
    item.prefit_enabled = Boolean(rawItem?.prefit_enabled ?? false);
    item.bom_enabled = Boolean(rawItem?.bom_enabled ?? false);
    if (!item.bom_hinge_top && rawItem?.bom_hinge_specs) {
        item.bom_hinge_top = String(rawItem.bom_hinge_specs || '').trim();
    }
    if (!item.bom_flush_pulls_finish && rawItem?.bom_flush_pulls) {
        item.bom_flush_pulls_finish = 'Selected';
    }
    item.prefit_customer_brought_door = Boolean(rawItem?.prefit_customer_brought_door ?? false);
    item.prefit_vent_top = Boolean(rawItem?.prefit_vent_top ?? false);
    item.prefit_vent_bottom = Boolean(rawItem?.prefit_vent_bottom ?? false);
    item.tempered_glass = Boolean(rawItem?.tempered_glass ?? false);
    item.no_cost = Boolean(rawItem?.no_cost ?? false);
    item.ui_collapsed = Boolean(rawItem?.ui_collapsed ?? rawItem?.collapsed ?? false);
    item.as400_group_custom = Boolean(rawItem?.as400_group_custom ?? false);
    item.as400_group_auto = rawItem?.as400_group_auto === undefined ? !item.as400_group_custom : Boolean(rawItem.as400_group_auto);
    item.as400_group = normalizeAs400GroupName(rawItem?.as400_group || item.as400_group || '');
    syncLineItemAs400Group(item);
    return item;
}

function enforceSinglePrefitDoor(preferredIndex = null) {
    const preferred = Number.isInteger(preferredIndex) ? preferredIndex : null;
    let activeIndex = preferred;

    if (activeIndex === null) {
        activeIndex = currentLineItems.findIndex(item => item?.type === 'door' && item?.prefit_enabled);
    }

    currentLineItems = currentLineItems.map((item, index) => {
        if (!item || item.type !== 'door') {
            return { ...item, prefit_enabled: false };
        }

        const shouldEnable = activeIndex !== -1 && activeIndex !== null && index === activeIndex;
        return {
            ...item,
            prefit_enabled: shouldEnable
        };
    });
}

function loadLineItemsFromOrder(order) {
    let parsed = [];
    try {
        if (Array.isArray(order?.line_items)) {
            parsed = order.line_items;
        } else if (order?.line_items) {
            parsed = JSON.parse(order.line_items);
        }
    } catch (error) {
        console.warn('Unable to parse line_items for order', order?.id, error);
        parsed = [];
    }

    currentLineItems = Array.isArray(parsed) ? parsed.map(normalizeLineItem) : [];
    ensureLineItemAs400Groups();
    sortLineItemsByAs400Group();

    // Restore per-order starred/global defaults for continued editing sessions.
    _loadBulkDefaultsForOrder(order?.id);

    enforceSinglePrefitDoor();

    // Backfill prefit item details from order-level fields for existing records.
    if (order?.needs_prefit === 1 && currentLineItems.length > 0) {
        let prefitDoorIndex = currentLineItems.findIndex(item => item?.type === 'door' && item?.prefit_enabled);
        if (prefitDoorIndex < 0) {
            prefitDoorIndex = currentLineItems.findIndex(item => item?.type === 'door');
            if (prefitDoorIndex >= 0) {
                currentLineItems[prefitDoorIndex].prefit_enabled = true;
                enforceSinglePrefitDoor(prefitDoorIndex);
            }
        }

        if (prefitDoorIndex >= 0) {
            const item = currentLineItems[prefitDoorIndex];
            item.prefit_width = item.prefit_width || order.prefit_width || item.width || '';
            item.prefit_height = item.prefit_height || order.prefit_height || item.height || '';
            item.prefit_thickness = item.prefit_thickness || order.prefit_thickness || '';
            item.prefit_lites = item.prefit_lites || order.prefit_lites || '';
            item.prefit_vent_top = Boolean(item.prefit_vent_top || order.prefit_vent_top === 1);
            item.prefit_vent_bottom = Boolean(item.prefit_vent_bottom || order.prefit_vent_bottom === 1);
            item.prefit_hinge_top = item.prefit_hinge_top || order.prefit_hinge_top || '';
            item.prefit_hinge_middle = item.prefit_hinge_middle || order.prefit_hinge_middle || '';
            item.prefit_hinge_bottom = item.prefit_hinge_bottom || order.prefit_hinge_bottom || '';
            item.prefit_hinge_width = item.prefit_hinge_width || order.prefit_hinge_width || '';
            item.prefit_hinge_backset = item.prefit_hinge_backset || order.prefit_hinge_backset || '';
            item.prefit_hinge_radius = item.prefit_hinge_radius || order.prefit_hinge_radius || '';
            item.prefit_hinge_prep = item.prefit_hinge_prep || order.prefit_hinge_prep || '';
            item.prefit_bore_type = item.prefit_bore_type || order.prefit_bore_type || '';
            item.prefit_bore_single = item.prefit_bore_single || order.prefit_bore_single || '';
            item.prefit_bore_top = item.prefit_bore_top || order.prefit_bore_top || '';
            item.prefit_bore_bottom = item.prefit_bore_bottom || order.prefit_bore_bottom || '';
            item.prefit_bore_backset = item.prefit_bore_backset || order.prefit_bore_backset || '';
            item.prefit_bore_diameter = item.prefit_bore_diameter || order.prefit_bore_diameter || '2 1/8"';
            item.prefit_swing = item.prefit_swing || order.prefit_swing || item.swing || '';
        }
    }

    renderLineItemsEditor();
    syncLineItemsToHiddenField({ markDirty: false, autosave: false });
    resetLineItemsDirty(getLineItemsJsonForSave());

    if (order && order.id && currentOrder && currentOrder.id === order.id) {
        currentOrder.line_items = getLineItemsJsonForSave();
    }
}

function syncLineItemsToHiddenField(options = {}) {
    const lineItemsField = document.getElementById(INLINE_ORDER_FIELDS.line_items);
    const lineItemsJson = getLineItemsJsonForSave();
    if (lineItemsField) {
        lineItemsField.value = lineItemsJson || '';
    }
    if (options.markDirty !== false) {
        markLineItemsDirty();
    }
    syncDerivedPrefitFromLineItems();
    if (options.autosave !== false) {
        scheduleLineItemsAutosave();
    }
}

function scheduleLineItemsAutosave() {
    const activeOrderId = selectedOrderId || (currentOrder && currentOrder.id ? currentOrder.id : null);
    if (!activeOrderId) return;

    if (lineItemsAutosaveTimeout) {
        clearTimeout(lineItemsAutosaveTimeout);
    }

    lineItemsAutosaveTimeout = setTimeout(async () => {
        await persistLineItemsStateSilently(activeOrderId);
    }, LINE_ITEMS_AUTOSAVE_DELAY);
}

function getDerivedPrefitPayload(baseOrder = null) {
    const baseline = baseOrder || currentOrder || getSelectedOrder() || {};
    const selectedPrefitDoor = currentLineItems.find(item => item?.type === 'door' && item?.prefit_enabled);
    const hasPrefitDoor = Boolean(selectedPrefitDoor);

    const payload = {
        needs_prefit: hasPrefitDoor ? 1 : 0,
    };

    if (!selectedPrefitDoor) {
        return payload;
    }

    const width = String(selectedPrefitDoor.prefit_width || selectedPrefitDoor.width || '').trim();
    const height = String(selectedPrefitDoor.prefit_height || selectedPrefitDoor.height || '').trim();
    const swing = String(selectedPrefitDoor.prefit_swing || selectedPrefitDoor.swing || '').trim();
    const thickness = String(selectedPrefitDoor.prefit_thickness || '').trim();
    const lites = String(selectedPrefitDoor.prefit_lites || selectedPrefitDoor.glass || '').trim();
    const hingeTop = String(selectedPrefitDoor.prefit_hinge_top || '').trim();
    const hingeMiddle = String(selectedPrefitDoor.prefit_hinge_middle || '').trim();
    const hingeBottom = String(selectedPrefitDoor.prefit_hinge_bottom || '').trim();
    const hingeWidth = String(selectedPrefitDoor.prefit_hinge_width || '').trim();
    const hingeBackset = String(selectedPrefitDoor.prefit_hinge_backset || '').trim();
    const hingeRadius = String(selectedPrefitDoor.prefit_hinge_radius || '').trim();
    const hingePrep = String(selectedPrefitDoor.prefit_hinge_prep || '').trim();
    const boreType = String(selectedPrefitDoor.prefit_bore_type || '').trim();
    const boreSingle = String(selectedPrefitDoor.prefit_bore_single || '').trim();
    const boreTop = String(selectedPrefitDoor.prefit_bore_top || '').trim();
    const boreBottom = String(selectedPrefitDoor.prefit_bore_bottom || '').trim();
    const boreBackset = String(selectedPrefitDoor.prefit_bore_backset || '').trim();
    const boreDiameter = normalizePrefitSelectValue('prefit_bore_diameter', selectedPrefitDoor.prefit_bore_diameter || baseline.prefit_bore_diameter || '2 1/8"');
    const customerBroughtDoor = Boolean(selectedPrefitDoor.prefit_customer_brought_door);
    const ventTop = Boolean(selectedPrefitDoor.prefit_vent_top);
    const ventBottom = Boolean(selectedPrefitDoor.prefit_vent_bottom);
    const detailParts = [
        String(selectedPrefitDoor.room || '').trim(),
        String(selectedPrefitDoor.series || '').trim(),
        String(selectedPrefitDoor.notes || '').trim(),
    ].filter(Boolean);

    payload.prefit_width = width || baseline.prefit_width || null;
    payload.prefit_height = height || baseline.prefit_height || null;
    payload.prefit_swing = swing || baseline.prefit_swing || null;
    payload.prefit_thickness = thickness || baseline.prefit_thickness || '1 3/4"';
    payload.prefit_lites = lites || baseline.prefit_lites || null;
    payload.prefit_hinge_top = hingeTop || baseline.prefit_hinge_top || null;
    payload.prefit_hinge_middle = hingeMiddle || baseline.prefit_hinge_middle || null;
    payload.prefit_hinge_bottom = hingeBottom || baseline.prefit_hinge_bottom || null;
    payload.prefit_hinge_width = hingeWidth || baseline.prefit_hinge_width || null;
    payload.prefit_hinge_backset = hingeBackset || baseline.prefit_hinge_backset || null;
    payload.prefit_hinge_radius = hingeRadius || baseline.prefit_hinge_radius || null;
    payload.prefit_hinge_prep = hingePrep || baseline.prefit_hinge_prep || null;
    payload.prefit_bore_type = boreType || baseline.prefit_bore_type || null;
    payload.prefit_bore_single = boreSingle || baseline.prefit_bore_single || null;
    payload.prefit_bore_top = boreTop || baseline.prefit_bore_top || null;
    payload.prefit_bore_bottom = boreBottom || baseline.prefit_bore_bottom || null;
    payload.prefit_bore_backset = boreBackset || baseline.prefit_bore_backset || null;
    payload.prefit_bore_diameter = boreDiameter || '2 1/8"';
    payload.prefit_vent_top = ventTop ? 1 : 0;
    payload.prefit_vent_bottom = ventBottom ? 1 : 0;
    payload.prefit_customer_brought_door = customerBroughtDoor ? 1 : 0;
    const generatedPrefitComment = buildFormattedPrefitComment(selectedPrefitDoor);
    if (generatedPrefitComment) {
        payload.prefit_notes = generatedPrefitComment;
    } else if (!baseline.prefit_notes && detailParts.length > 0) {
        payload.prefit_notes = detailParts.join(' | ');
    }

    return payload;
}

function applyDerivedPrefitToModalFields(payload) {
    if (!payload) return;

    const needsPrefitCheckbox = document.getElementById('needs_prefit');
    if (needsPrefitCheckbox && payload.needs_prefit !== undefined) {
        needsPrefitCheckbox.checked = Boolean(payload.needs_prefit);
        togglePrefitDetails();
    }

    const map = {
        prefit_width: 'prefit_width',
        prefit_height: 'prefit_height',
        prefit_thickness: 'prefit_thickness',
        prefit_lites: 'prefit_lites',
        prefit_hinge_top: 'prefit_hinge_top',
        prefit_hinge_middle: 'prefit_hinge_middle',
        prefit_hinge_bottom: 'prefit_hinge_bottom',
        prefit_hinge_width: 'prefit_hinge_width',
        prefit_hinge_backset: 'prefit_hinge_backset',
        prefit_hinge_radius: 'prefit_hinge_radius',
        prefit_hinge_prep: 'prefit_hinge_prep',
        prefit_bore_type: 'prefit_bore_type',
        prefit_bore_single: 'prefit_bore_single',
        prefit_bore_top: 'prefit_bore_top',
        prefit_bore_bottom: 'prefit_bore_bottom',
        prefit_bore_backset: 'prefit_bore_backset',
        prefit_bore_diameter: 'prefit_bore_diameter',
        prefit_swing: 'prefit_swing',
        prefit_notes: 'prefit_notes',
    };

    Object.entries(map).forEach(([key, elementId]) => {
        if (payload[key] === undefined) return;
        const element = document.getElementById(elementId);
        if (!element) return;
        element.value = payload[key] ?? '';
    });

    const broughtDoorCheckbox = document.getElementById('prefit_customer_brought_door');
    if (broughtDoorCheckbox && payload.prefit_customer_brought_door !== undefined) {
        broughtDoorCheckbox.checked = Boolean(payload.prefit_customer_brought_door);
        togglePrefitMeasurements();
    }

    const ventTopCheckbox = document.getElementById('prefit_vent_top');
    if (ventTopCheckbox && payload.prefit_vent_top !== undefined) {
        ventTopCheckbox.checked = Boolean(payload.prefit_vent_top);
    }
    const ventBottomCheckbox = document.getElementById('prefit_vent_bottom');
    if (ventBottomCheckbox && payload.prefit_vent_bottom !== undefined) {
        ventBottomCheckbox.checked = Boolean(payload.prefit_vent_bottom);
    }
}

function syncDerivedPrefitFromLineItems() {
    const payload = getDerivedPrefitPayload();
    applyDerivedPrefitToModalFields(payload);

    const selectedOrder = getSelectedOrder();
    if (selectedOrder) {
        Object.assign(selectedOrder, payload);
    }
    if (currentOrder && currentOrder.id) {
        Object.assign(currentOrder, payload);
    }
}

function addLineItem(type) {
    const newItem = createLineItemTemplate(type);
    syncLineItemAs400Group(newItem);
    currentLineItems.push(newItem);
    const newIndex = currentLineItems.length - 1;
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
    scrollToLineItem(newIndex, { highlight: true });
}

function scrollToLineItem(index, options = {}) {
    if (!lineItemsList) return;

    requestAnimationFrame(() => {
        const card = lineItemsList.querySelector(`[data-line-item-card="${index}"]`);
        if (!card) return;

        card.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });

        const firstInput = card.querySelector('input[data-item-field], select[data-item-field], textarea[data-item-field]');
        if (firstInput && typeof firstInput.focus === 'function') {
            firstInput.focus({ preventScroll: true });
        }

        if (options.highlight) {
            card.classList.remove('line-item-card-highlight');
            void card.offsetWidth;
            card.classList.add('line-item-card-highlight');
            setTimeout(() => {
                card.classList.remove('line-item-card-highlight');
            }, 1800);
        }
    });
}

function isAddNewLineItemOption(field, value) {
    const text = String(value || '').trim();
    const clean = text.replace(/^[^A-Za-z0-9]+\s*/, '').trim().toLowerCase();
    if (field === 'vendor') return clean === 'add new vendor';
    if (field === 'series') return clean === 'add new model';
    if (field === 'hardware_product_code') return clean === 'add new product code';
    if (field === 'hardware_lever_knob_style') return clean === 'add new lever/knob style';
    if (field === 'jamb_size') return clean === 'add new jamb size';
    if (field === 'style') return clean === 'add new style' || clean === 'add new style...';
    if (field === 'operation') return clean === 'add new handing';
    if (field === 'fin_type') return clean === 'add new fin type';
    if (field === 'color' || field === 'exterior_color' || field === 'interior_color') return clean === 'add new color';
    return false;
}

function isSelectNavigationKey(key) {
    return ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key);
}

function restoreLineItemSelectValue(select, index, field) {
    const itemValue = currentLineItems[index]?.[field] ?? '';
    select.value = itemValue === null || itemValue === undefined ? '' : String(itemValue);
}

function focusLineItemField(index, field, options = {}) {
    if (!lineItemsList || index === null || index === undefined || !field) return;

    requestAnimationFrame(() => {
        const selector = `input[data-item-index="${index}"][data-item-field="${field}"], select[data-item-index="${index}"][data-item-field="${field}"], textarea[data-item-index="${index}"][data-item-field="${field}"]`;
        const control = lineItemsList.querySelector(selector);
        if (!control || typeof control.focus !== 'function') return;

        control.focus({ preventScroll: options.preventScroll !== false });
        if (options.select && typeof control.select === 'function') {
            control.select();
        }
    });
}
function updateLineItem(index, field, value, options = {}) {
    if (!currentLineItems[index]) return;

    const shouldRender = options.suppressRender !== true;

    //"Add Vendor"
    if (field === 'as400_group' && String(value || '').trim() === AS400_NEW_GROUP_OPTION) {
        addAs400GroupForItem(index);
        return;
    }

    if (field === 'vendor' && isAddNewLineItemOption(field, value)) {

        guardOnce(currentLineItems[index], '__addingVendor', () => {
            return addItemVendor(currentLineItems[index].type, index);
        });

        if (shouldRender) renderLineItemsEditor();
        return;

    }
    //"Add New Model"
    if (field === 'series' && isAddNewLineItemOption(field, value)) {

        guardOnce(currentLineItems[index], '__addingModel', () => {
            return addVendorSeriesOption(currentLineItems[index].type, index);
        });

        if (shouldRender) renderLineItemsEditor();
        return;
    }

    //"Add New Jamb Size"
    if (field === 'hardware_product_code' && isAddNewLineItemOption(field, value)) {
        guardOnce(currentLineItems[index], '__addingHardwareProductCode', () => {
            return promptAndSetHardwareCustomField(index, 'hardware_product_code', 'product code');
        });
        if (shouldRender) renderLineItemsEditor();
        return;
    }

    if (field === 'hardware_lever_knob_style' && isAddNewLineItemOption(field, value)) {
        guardOnce(currentLineItems[index], '__addingHardwareLeverKnobStyle', () => {
            return promptAndSetHardwareCustomField(index, 'hardware_lever_knob_style', 'lever/knob style');
        });
        if (shouldRender) renderLineItemsEditor();
        return;
    }
    if (field === 'jamb_size' && isAddNewLineItemOption(field, value)) {
        guardOnce(currentLineItems[index], '__addingJambSize', () => {
            return addJambSizeOption(index);
        });
        if (shouldRender) renderLineItemsEditor();
        return;
    }
    //"Add New Style"
    if (field === 'style' && isAddNewLineItemOption(field, value)) {

        guardOnce(currentLineItems[index], '__addingStyle', () => {
            return addItemStyle(currentLineItems[index].type, index);
        });

        if (shouldRender) renderLineItemsEditor();
        return;
    }

    if (field === 'operation' && isAddNewLineItemOption(field, value)) {
        guardOnce(currentLineItems[index], '__addingHanding', () => {
            return addWindowHandingOption(index);
        });
        if (shouldRender) renderLineItemsEditor();
        return;
    }

    if (field === 'prefit_bore_diameter' && isAddNewLineItemOption(field, value)) {
        guardOnce(currentLineItems[index], '__addingBoreDiameter', () => {
            return addPrefitBoreDiameterOption(index);
        });
        if (shouldRender) renderLineItemsEditor();
        return;
    }
    if (field === 'fin_type' && isAddNewLineItemOption(field, value)) {
        guardOnce(currentLineItems[index], '__addingFinType', () => {
            return addFinTypeOption(index);
        });
        renderLineItemsEditor();
        return;
    }
    if ((field === 'color' || field === 'exterior_color' || field === 'interior_color') && currentLineItems[index].type === 'window' && isAddNewLineItemOption(field, value)) {
        guardOnce(currentLineItems[index], '__addingWindowColor', () => {
            return addWindowColorOption(index, field === 'color' ? 'exterior_color' : field);
        });
        renderLineItemsEditor();
        return;
    }

    const normalizedValue = field === 'fin_type'
        ? normalizeFinTypeValue(value)
        : (field === 'prefit_thickness' || field === 'prefit_hinge_width' || field === 'bom_hinge_width' || field === 'prefit_hinge_radius' || field === 'prefit_bore_backset' || field === 'prefit_bore_diameter')
            ? normalizePrefitSelectValue(field, value)
        : (field === 'as400_group')
            ? normalizeAs400GroupName(value)
        : (field === 'entry_door' || field === 'transom')
            ? String(value) === 'Yes'
        : (field === 'prefit_enabled' ? Boolean(value) : value);
    currentLineItems[index][field] = normalizedValue;
    if ((field === 'exterior_color' || field === 'interior_color') && currentLineItems[index].type === 'window') {
        syncWindowLegacyColor(currentLineItems[index]);
    }
    if (field === 'as400_group') {
        currentLineItems[index].as400_group_custom = true;
        currentLineItems[index].as400_group_auto = false;
    }
    if (field === 'series' && currentLineItems[index].type === 'door') {
        currentLineItems[index].model = normalizedValue;
    }
    if (field === 'swing' && currentLineItems[index].type === 'door') {
        currentLineItems[index].prefit_swing = normalizedValue;
    }
    if (field === 'thickness' && currentLineItems[index].type === 'door') {
        const normalizedThickness = normalizePrefitSelectValue('prefit_thickness', normalizedValue);
        currentLineItems[index].thickness = normalizedThickness;
        currentLineItems[index].prefit_thickness = normalizedThickness;
    }
    if (field === 'prefit_thickness' && currentLineItems[index].type === 'door') {
        currentLineItems[index].thickness = normalizedValue;
    }
    if (field === 'entry_door' && !normalizedValue) {
        currentLineItems[index].sidelites = '';
        currentLineItems[index].transom = false;
    }
    if (field === 'callout_size') {
        currentLineItems[index].size = normalizedValue;
        const derived = calloutToDimensions(normalizedValue);
        if (derived) {
            currentLineItems[index].width = derived.width;
            currentLineItems[index].height = derived.height;
            currentLineItems[index].prefit_width = currentLineItems[index].prefit_width || derived.width;
            currentLineItems[index].prefit_height = currentLineItems[index].prefit_height || derived.height;
        }
    }
    if (field === 'gable_tall_side' && currentLineItems[index].type === 'window') {
        currentLineItems[index].height = normalizedValue;
    }
    if ((field === 'width' || field === 'height' || field === 'gable_tall_side' || field === 'gable_short_side') && String(currentLineItems[index].size_mode || '') === 'rough_opening') {
        currentLineItems[index].callout_size = '';
        currentLineItems[index].size = [currentLineItems[index].width, currentLineItems[index].height]
            .map(part => String(part || '').trim())
            .filter(Boolean)
            .join(' x ');
    }
    if (field === 'type') {
        currentLineItems[index].product = normalizedValue === 'hardware' ? 'Hardware' : (normalizedValue === 'window' ? 'Window' : 'Door');
        if (normalizedValue === 'door') {
            currentLineItems[index].model = currentLineItems[index].series || '';
        }
        if (normalizedValue !== 'door') {
            currentLineItems[index].prefit_enabled = false;
        }
    } else if (field === 'prefit_enabled' && normalizedValue) {
        enforceSinglePrefitDoor(index);
    } else if (field === 'vendor') {
        currentLineItems[index].vendor_sku = getVendorSkuForName(normalizedValue) || '';
        if (!currentLineItems[index].as400_group_custom) {
            syncLineItemAs400Group(currentLineItems[index], { force: true });
        }
        if (shouldRender) renderLineItemsEditor();
        if (shouldRender && options.focusAfterRender) {
            focusLineItemField(index, options.focusAfterRenderField || 'series', { select: true });
        }
    }

    if (field === 'prefit_enabled' && !normalizedValue) {
        enforceSinglePrefitDoor();
    }

    if (field === 'type') {
        enforceSinglePrefitDoor();
        if (!currentLineItems[index].as400_group_custom) {
            syncLineItemAs400Group(currentLineItems[index], { force: true });
        }
    }

    if ((field === 'style' || field === 'door_style' || field === 'door_type') && !currentLineItems[index].as400_group_custom) {
        syncLineItemAs400Group(currentLineItems[index], { force: true });
    }

    if (field === 'size_mode') {
        if (normalizedValue === 'callout') {
            const inferredCallout = dimensionsToCallout(currentLineItems[index].width, currentLineItems[index].height);
            if (inferredCallout && !String(currentLineItems[index].callout_size || '').trim()) {
                currentLineItems[index].callout_size = inferredCallout;
                currentLineItems[index].size = inferredCallout;
            }
        } else if (normalizedValue === 'rough_opening') {
            const hasWidthOrHeight = String(currentLineItems[index].width || '').trim() || String(currentLineItems[index].height || '').trim();
            if (!hasWidthOrHeight) {
                const derived = calloutToDimensions(currentLineItems[index].callout_size);
                if (derived) {
                    currentLineItems[index].width = derived.width;
                    currentLineItems[index].height = derived.height;
                }
            }
            currentLineItems[index].size = [currentLineItems[index].width, currentLineItems[index].height]
                .map(part => String(part || '').trim())
                .filter(Boolean)
                .join(' x ');
        }
        if (shouldRender) renderLineItemsEditor();
        if (shouldRender && options.focusAfterRender) {
            focusLineItemField(index, options.focusAfterRenderField || 'price', { select: true });
        }
    }

    if (field === 'as400_group' || field === 'vendor' || field === 'style' || field === 'type') {
        sortLineItemsByAs400Group();
        if (shouldRender) renderLineItemsEditor();
    }

    syncLineItemsToHiddenField({ autosave: options.autosave });
}

function removeLineItem(index) {
    currentLineItems.splice(index, 1);
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
}

function moveLineItem(index, direction) {
    const fromIndex = Number.isInteger(index) ? index : parseInt(index, 10);
    const moveDirection = Number.isInteger(direction) ? direction : parseInt(direction, 10);

    if (!Number.isInteger(fromIndex) || !Number.isInteger(moveDirection)) return;
    if (!currentLineItems[fromIndex]) return;

    const toIndex = fromIndex + moveDirection;
    if (toIndex < 0 || toIndex >= currentLineItems.length) return;

    const [movedItem] = currentLineItems.splice(fromIndex, 1);
    currentLineItems.splice(toIndex, 0, movedItem);
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
}

function getNextRoomLocationValue(value) {
    const raw = String(value ?? '');
    const trimmed = raw.trim();

    if (!trimmed) {
        return raw;
    }

    const incrementNumber = (numberText) => {
        const width = numberText.length;
        const nextNumber = Number.parseInt(numberText, 10) + 1;
        return String(nextNumber).padStart(width, '0');
    };

    const incrementLetterSequence = (text) => {
        if (!/^[A-Za-z]+$/.test(text)) return text;

        const isUpper = text === text.toUpperCase();
        const chars = text.toUpperCase().split('');

        for (let i = chars.length - 1; i >= 0; i -= 1) {
            if (chars[i] !== 'Z') {
                chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
                for (let j = i + 1; j < chars.length; j += 1) {
                    chars[j] = 'A';
                }
                const out = chars.join('');
                return isUpper ? out : out.toLowerCase();
            }
        }

        const expanded = `A${'A'.repeat(chars.length)}`;
        return isUpper ? expanded : expanded.toLowerCase();
    };

    if (/^\d+$/.test(trimmed)) {
        return incrementNumber(trimmed);
    }

    if (/^[A-Za-z]$/.test(trimmed)) {
        return incrementLetterSequence(trimmed);
    }

    // Support suffixed identifiers like "Window-121" or "Bedroom A".
    const suffixNumberMatch = trimmed.match(/^(.*[\s\-_#])(\d+)$/);
    if (suffixNumberMatch) {
        const [, prefix, numberText] = suffixNumberMatch;
        return `${prefix}${incrementNumber(numberText)}`;
    }

    const suffixLetterMatch = trimmed.match(/^(.*[\s\-_#])([A-Za-z]+)$/);
    if (suffixLetterMatch) {
        const [, prefix, letterText] = suffixLetterMatch;
        return `${prefix}${incrementLetterSequence(letterText)}`;
    }

    return raw;
}

function copyLineItem(index) {
    const sourceItem = currentLineItems[index];
    if (!sourceItem) return;

    // Duplicate item details for quick repeated entries.
    const copiedItem = { ...sourceItem };
    copiedItem.room = getNextRoomLocationValue(sourceItem.room);
    currentLineItems.push(copiedItem);
    const newIndex = currentLineItems.length - 1;
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
    scrollToLineItem(newIndex, { highlight: true });
}

function toggleLineItemCollapse(index) {
    if (!currentLineItems[index]) return;
    currentLineItems[index].ui_collapsed = !Boolean(currentLineItems[index].ui_collapsed);
    syncLineItemsToHiddenField();
    persistLineItemsStateSilently();
    renderLineItemsEditor();
}

async function persistLineItemsStateSilently(orderId = null) {
    const activeOrderId = orderId || selectedOrderId || (currentOrder && currentOrder.id ? currentOrder.id : null);
    if (!activeOrderId) return;

    try {
        const selectedOrder = getSelectedOrder() || currentOrder || null;
        const prefitPayload = getDerivedPrefitPayload(selectedOrder);
        const changedLineItemsJson = getChangedLineItemsJson();
        if (changedLineItemsJson === undefined) return;

        const response = await fetch(`${API_BASE}/orders/${activeOrderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                line_items: changedLineItemsJson,
                ...prefitPayload
            })
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            return;
        }

        resetLineItemsDirty(changedLineItemsJson);
        applyUpdatedOrderLocally(result.order);
    } catch (error) {
        console.error('Silent line item state save failed:', error);
    }
}

function renderOptionButtons(index, field, options, selectedValue) {
    return options
        .map(option => {
            const activeClass = String(selectedValue || '') === option ? 'active' : '';
            return `<button type="button" class="item-option-button ${activeClass}" data-item-index="${index}" data-item-field="${field}" data-item-value="${option}">${option}</button>`;
        })
        .join('');
}

function renderSelectOptions(options, selectedValue, placeholder) {
    const placeholderOption = `<option value="">${escapeHtml(placeholder || 'Select')}</option>`;
    const optionHtml = (Array.isArray(options) ? options : [])
        .map(rawOption => {
            const option = (rawOption && typeof rawOption === 'object')
                ? {
                    value: String(rawOption.value ?? rawOption.label ?? ''),
                    label: String(rawOption.label ?? rawOption.value ?? ''),
                }
                : {
                    value: String(rawOption ?? ''),
                    label: String(rawOption ?? ''),
                };
            const isSelected = String(selectedValue || '') === option.value;
            return `<option value="${escapeHtmlAttribute(option.value)}" ${isSelected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
        })
        .join('');
    return placeholderOption + optionHtml;
}

function escapeHtmlAttribute(text) {
    return escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function guardOnce(item, key, fn) {
    if (item[key]) return;
    Object.defineProperty(item, key, {
        value: true,
        writable: true,
        configurable: true,
        enumerable: false
    });

    const release = () => {
        setTimeout(() => {
            item[key] = false;
        }, 0);
    };

    try {
        const result = fn();
        if (result && typeof result.finally === 'function') {
            result.finally(release);
        } else {
            release();
        }
    } catch (error) {
        release();
        throw error;
    }
}

function syncDoorSwingSelectElements() {
    if (!lineItemsList || !Array.isArray(currentLineItems)) return;

    currentLineItems.forEach((item, index) => {
        if (!item || item.type !== 'door') return;
        const swingValue = String(item.swing || item.prefit_swing || '').trim();
        if (!swingValue) return;

        const selector = `select[data-item-index="${index}"][data-item-field="swing"]`;
        const select = lineItemsList.querySelector(selector);
        if (select && select.value !== swingValue) {
            select.value = swingValue;
        }
    });
}
function renderLineItemsEditor() {
    if (!lineItemsList) return;

    if (currentLineItems.length === 0) {
        lineItemsList.innerHTML = `
            <div class="line-items-empty">
                <span>No items yet. Start with Door, Window, or Hardware.</span>
                <div class="line-items-empty-actions">
                    <button type="button" class="btn btn-primary" data-empty-add-item="door">+ Door</button>
                    <button type="button" class="btn btn-secondary" data-empty-add-item="window">+ Window</button>
                            <button type="button" class="btn btn-secondary" data-empty-add-item="hardware">+ Hardware</button>
                </div>
            </div>
        `;
        lineItemsList.querySelectorAll('[data-empty-add-item]').forEach(button => {
            button.addEventListener('click', () => addLineItem(button.getAttribute('data-empty-add-item')));
        });
        return;
    }
    ensureLineItemAs400Groups();
    sortLineItemsByAs400Group();

    lineItemsList.innerHTML = currentLineItems.map((item, index) => {
        const isDoor = item.type === 'door';
        const isWindow = item.type === 'window';
        const isHardware = item.type === 'hardware';
        const isCollapsed = Boolean(item.ui_collapsed);
        const showEntryDoorDetails = Boolean(item.entry_door);
        const showPrefitMeasurements = !item.prefit_customer_brought_door;
        const boreTypeNormalized = String(item.prefit_bore_type || '').trim().toLowerCase();
        const showSingleBore = boreTypeNormalized === 'single';
        const showDoubleBore = boreTypeNormalized === 'double';
        const bomBoreTypeNormalized = String(item.bom_bore_type || '').trim().toLowerCase();
        const showBomSingleBore = bomBoreTypeNormalized === 'single';
        const showBomDoubleBore = bomBoreTypeNormalized === 'double';
        const showQlonColor = String(item.bom_q_lon || '').trim().toLowerCase() === 'q-lon';
        const sizeMode = String(item.size_mode || 'rough_opening').trim().toLowerCase();
        const isCalloutSize = sizeMode === 'callout';
        const isGableWindow = isWindow && String(item.style || '').trim().toLowerCase() === 'gable';
        const as400CommentPreview = buildAs400CommentPreview(item);
        const vendorOptions = getVendorOptionsForType(item.type);
        const vendorOptionsWithSelected = item.vendor && !vendorOptions.includes(item.vendor)
            ? [item.vendor, ...vendorOptions]
            : vendorOptions;
        const rawSeriesOptions = getSeriesOptionsForItemVendor(item.type, item.vendor);
        const seriesOptions = isHardware
            ? rawSeriesOptions.filter(option => !isHardwareProductCodeValue(option))
            : rawSeriesOptions;
        const seriesOptionsWithSelected = item.series && !seriesOptions.includes(item.series) && !(isHardware && isHardwareProductCodeValue(item.series))
            ? [item.series, ...seriesOptions]
            : seriesOptions;
        const finOptions = getFinTypeOptions();
        const finOptionsWithSelected = item.fin_type && !finOptions.includes(item.fin_type)
            ? [item.fin_type, ...finOptions]
            : finOptions;
        const exteriorWindowColorOptions = getWindowColorOptions(item.exterior_color || item.color);
        const interiorWindowColorOptions = getWindowColorOptions(item.interior_color || item.color);
        const groupName = getAs400GroupNameForItem(item);
        const previousGroupName = index > 0 ? getAs400GroupNameForItem(currentLineItems[index - 1]) : '';
        const groupOptions = getAs400GroupOptions();
        const groupOptionsWithSelected = groupName && !groupOptions.includes(groupName)
            ? [groupName, ...groupOptions]
            : groupOptions;
        const groupHeader = index === 0 || groupName !== previousGroupName
            ? renderAs400GroupHeader(groupName)
            : '';
        const groupColor = getAs400GroupColor(groupName);

        return `
            ${groupHeader}
            <div class="line-item-card as400-group-card as400-group-${groupColor}" data-line-item-card="${index}" data-as400-group-card="${escapeHtml(groupName)}">
                <div class="line-item-header">
                    <div class="line-item-header-main">
                        <div class="line-item-type-toggle">
                            <button type="button" class="item-type-button ${isDoor ? 'active' : ''}" data-item-index="${index}" data-item-field="type" data-item-value="door">Door</button>
                            <button type="button" class="item-type-button ${isWindow ? 'active' : ''}" data-item-index="${index}" data-item-field="type" data-item-value="window">Window</button>
                            <button type="button" class="item-type-button ${isHardware ? 'active' : ''}" data-item-index="${index}" data-item-field="type" data-item-value="hardware">Hardware</button>
                        </div>
                        <div class="line-item-field line-item-room-inline">
                            <input type="text" value="${escapeHtml(item.room || '')}" data-item-index="${index}" data-item-field="room" placeholder="Room / Location" aria-label="Room / Location">
                        </div>
                        ${isDoor ? `
                        <div class="line-item-field line-item-field-checkbox line-item-field-prefit-inline line-item-prefit-header-inline">
                            <label class="checkbox-label">
                                <input type="checkbox" ${item.prefit_enabled ? 'checked' : ''} data-item-index="${index}" data-item-field="prefit_enabled">
                                <span>Pre-Fit Door</span>
                            </label>
                        </div>
                        <div class="line-item-field line-item-field-checkbox line-item-field-prefit-inline line-item-bom-header-inline">
                            <label class="checkbox-label">
                                <input type="checkbox" ${item.bom_enabled ? 'checked' : ''} data-item-index="${index}" data-item-field="bom_enabled">
                                <span>BOM</span>
                            </label>
                        </div>
                        <div class="line-item-field line-item-field-checkbox line-item-field-prefit-inline line-item-bom-header-inline">
                        <label class="checkbox-label">
                            <input type="checkbox" ${item.no_cost ? 'checked' : ''} data-item-index="${index}" data-item-field="no_cost">
                            <span>No Cost (NC)</span>
                        </label>
                    </div> 
                        ` : ''}
                    </div>
                    <div class="line-item-header-actions">
                        <button type="button" class="item-move-button" data-item-move-up="${index}" ${index === 0 ? 'disabled' : ''} title="Move item up">Up</button>
                        <button type="button" class="item-move-button" data-item-move-down="${index}" ${index === currentLineItems.length - 1 ? 'disabled' : ''} title="Move item down">Down</button>
                        <button type="button" class="item-collapse-button" data-item-toggle="${index}">${isCollapsed ? 'Expand' : 'Collapse'}</button>
                        <button type="button" class="item-copy-button" data-item-copy="${index}">Copy</button>
                        <button type="button" class="item-remove-button" data-item-remove="${index}">Remove</button>
                    </div>
                </div>

                <div class="line-item-grid line-item-grid-quick">
                    <div class="line-item-field">
                        <label>Quantity</label>
                        <input type="number" min="1" value="${item.quantity}" data-item-index="${index}" data-item-field="quantity">
                    </div>
                    <div class="line-item-field">
                        <label>Vendor
                            ${item.vendor_sku ? `
                            <div class="item-vendor-sku">
                                SKU: ${escapeHtml(item.vendor_sku)}
                            </div>
                        ` : ''}
                        
                        </label>
    
                        <select data-item-index="${index}" data-item-field="vendor">
                            ${renderSelectOptions(
                                [...vendorOptionsWithSelected, '➕ Add New Vendor'],
                                item.vendor
                            )}
                        </select>
                    </div>

                    <div class="line-item-field">
                        <label>AS400 Group</label>
                        <select data-item-index="${index}" data-item-field="as400_group">
                            ${renderSelectOptions(
                                [...groupOptionsWithSelected, AS400_NEW_GROUP_OPTION],
                                groupName,
                                'Select group'
                            )}
                        </select>
                    </div>
    
                    <div class="line-item-field">
                        <label>${isHardware ? 'Model' : (isDoor ? 'Model' : 'Series')}</label>
                        <select data-item-index="${index}" data-item-field="series">
                            ${renderSelectOptions(
                                [...seriesOptionsWithSelected, '➕ Add New Model'],
                                item.series,
                                item.vendor ? 'Select model' : 'Choose vendor first'
                            )}
                        </select>
                        <button hidden type="button" class="item-add-style-button" data-add-series-index="${index}" data-add-series-type="${item.type}">Add ${isHardware ? 'Model' : (isDoor ? 'Model' : 'Series')} for Vendor</button>
                    </div>
                    ${!isHardware ? `
                    <div class="line-item-field">
                        <label>Size Type</label>
                        <select data-item-index="${index}" data-item-field="size_mode">
                            ${renderSelectOptions([
                                { value: 'callout', label: 'Call Out' },
                                { value: 'rough_opening', label: 'Rough Opening' },
                                { value: 'net_size', label: 'Net Size' },
                            ], item.size_mode || 'rough_opening', 'Select size type')}
                        </select>
                    </div>
                    ` : ''}
                    <div class="line-item-field">
                        <label>Unit Price</label>
                        <input type="number" min="0" step="0.01" value="${escapeHtml(item.price != null && item.price !== '' ? item.price : '')}" data-item-index="${index}" data-item-field="price" placeholder="e.g. 499.99">
                    </div>
                    ${!isHardware ? (isCalloutSize && !isGableWindow ? `
                    <div class="line-item-field">
                        <label>Call Out (WWHH)</label>
                        <input type="text" value="${escapeHtml(item.callout_size || '')}" data-item-index="${index}" data-item-field="callout_size" placeholder="e.g. 3068">
                    </div>
                    ` : isGableWindow ? `
                    <div class="line-item-field">
                        <label>Width</label>
                        <input type="text" value="${escapeHtml(item.width || '')}" data-item-index="${index}" data-item-field="width" placeholder="e.g. 36&quot;">
                    </div>
                    <div class="line-item-field">
                        <label>Tall Side</label>
                        <input type="text" value="${escapeHtml(item.gable_tall_side || item.height || '')}" data-item-index="${index}" data-item-field="gable_tall_side" placeholder="e.g. 48&quot;">
                    </div>
                    <div class="line-item-field">
                        <label>Short Side</label>
                        <input type="text" value="${escapeHtml(item.gable_short_side || '')}" data-item-index="${index}" data-item-field="gable_short_side" placeholder="e.g. 24&quot;">
                    </div>
                    ` : `
                    <div class="line-item-field">
                        <label>Width</label>
                        <input type="text" value="${escapeHtml(item.width || '')}" data-item-index="${index}" data-item-field="width" placeholder="e.g. 36&quot;">
                    </div>
                    <div class="line-item-field">
                        <label>Height</label>
                        <input type="text" value="${escapeHtml(item.height || '')}" data-item-index="${index}" data-item-field="height" placeholder="e.g. 80&quot;">
                    </div>
                    `) : ''}                </div>

                ${isHardware ? `
                <div class="line-item-options line-item-hardware-fields ${isCollapsed ? 'collapsed' : ''}">
                    <div class="line-item-field">
                        <label>Hardware Type</label>
                        <select data-item-index="${index}" data-item-field="style">
                            ${renderSelectOptions([...getStyleOptionsForType('hardware'), '+ Add New Style'], item.style, 'Select hardware type')}
                        </select>
                        <button hidden type="button" class="item-add-style-button" data-add-style-type="hardware">+ Add Style</button>
                    </div>
                    <div class="line-item-field">
                        <label>Product Code</label>
                        <select data-item-index="${index}" data-item-field="hardware_product_code">
                            ${renderSelectOptions(getHardwareProductCodeOptions(item), item.hardware_product_code, 'Select product code')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Lever/Knob Style</label>
                        <select data-item-index="${index}" data-item-field="hardware_lever_knob_style">
                            ${renderSelectOptions(getHardwareLeverKnobStyleOptions(item.hardware_lever_knob_style), item.hardware_lever_knob_style, 'Select lever/knob style')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Finish</label>
                        <select data-item-index="${index}" data-item-field="hardware_finish_code">
                            ${renderSelectOptions(HARDWARE_FINISH_US_CODE_OPTIONS, item.hardware_finish_code, 'Select finish')}
                        </select>
                    </div>

                    <div class="line-item-field">
                        <label>Handing</label>
                        <select data-item-index="${index}" data-item-field="hardware_handing">
                            ${renderSelectOptions(['LH', 'RH', 'Reversible', 'N/A'], item.hardware_handing, 'Select handing')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Backset</label>
                        <select data-item-index="${index}" data-item-field="hardware_backset">
                            ${renderSelectOptions(['2-3/8"', '2-3/4"', 'Adjustable'], item.hardware_backset, 'Select backset')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Bore</label>
                        <select data-item-index="${index}" data-item-field="hardware_bore">
                            ${renderSelectOptions(['Single Bore', 'Double Bore', 'Tubular Prep', 'Mortise Prep', 'N/A'], item.hardware_bore, 'Select bore')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Keying</label>
                        <input type="text" value="${escapeHtml(item.hardware_keying || '')}" data-item-index="${index}" data-item-field="hardware_keying" placeholder="Keyed alike, keyed different, etc.">
                    </div>
                </div>
                ` : ''}
                ${isDoor ? `
                <div class="line-item-options line-item-door-fields ${isCollapsed ? 'collapsed' : ''}">
                    <div class="line-item-field">
                        <label>Entry Door</label>
                        <select data-item-index="${index}" data-item-field="entry_door">
                            ${renderSelectOptions(['Yes', 'No'], item.entry_door ? 'Yes' : 'No', 'Select')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Thickness</label>
                        <select data-item-index="${index}" data-item-field="thickness">
                            ${renderSelectOptions(['1-3/8"', '1-3/4"'], item.thickness || item.prefit_thickness, 'Select thickness')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Jamb Size</label>
                        <select data-item-index="${index}" data-item-field="jamb_size">
                            ${renderSelectOptions(
                                [...getJambSizeOptions(), '➕ Add New Jamb Size'],
                                item.jamb_size,
                                'Select jamb size'
                            )}
                        </select>
                        <button hidden type="button" class="item-add-style-button" data-add-jamb-size="true">➕ Add Jamb Size</button>
                    </div>
                    <div class="line-item-field">
                        <label>Door Style</label>
                        <select data-item-index="${index}" data-item-field="style">
                            ${renderSelectOptions([...getStyleOptionsForType('door'), '➕ Add New Style'], item.style)}
                        </select>
                        <button hidden type="button" class="item-add-style-button" data-add-style-type="door">➕ Add Style</button>
                    </div>
                    <div class="line-item-field">
                        <label>Door Count</label>
                        <select data-item-index="${index}" data-item-field="door_count">
                            ${renderSelectOptions(['Single', 'Double', 'Triple'], item.door_count, 'Select')}
                        </select>
                    </div>
                    ${showEntryDoorDetails ? `
                    <div class="line-item-field">
                        <label>Sidelites</label>
                        <select data-item-index="${index}" data-item-field="sidelites">
                            ${renderSelectOptions(['1L', '1R', '2'], item.sidelites, 'None')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Transom</label>
                        <select data-item-index="${index}" data-item-field="transom">
                            ${renderSelectOptions(['Yes', 'No'], item.transom ? 'Yes' : 'No', 'Select')}
                        </select>
                    </div>
                    ` : ''}
                    <div class="line-item-field">
                        <label>Swing</label>
                        <select data-item-index="${index}" data-item-field="swing">
                            ${renderSelectOptions(['RHIS', 'RHOS', 'LHIS', 'LHOS'], item.swing || item.prefit_swing, 'Select swing')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Door Location</label>
                        <select data-item-index="${index}" data-item-field="door_location">
                            ${renderSelectOptions(['Interior', 'Exterior'], item.door_location, 'Select location')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Material</label>
                        <select data-item-index="${index}" data-item-field="material">
                            ${renderSelectOptions(['Wood', 'Primed', 'Fiberglass', 'Steel', 'Vinyl'], item.material)}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Core</label>
                        <select data-item-index="${index}" data-item-field="core">
                            ${renderSelectOptions(['Hollow Core', 'Solid Core'], item.core, 'Select core')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Sticking</label>
                        <select data-item-index="${index}" data-item-field="sticking">
                            ${renderSelectOptions(['Ovolo', 'Shaker'], item.sticking, 'Select sticking')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Lites (Glass)</label>
                        <select data-item-index="${index}" data-item-field="glass">
                            ${renderSelectOptions(['None', '1 LT', '2 LT', '3 LT', '4 LT', '6 LT', '9 LT'], item.glass, 'Select lites')}
                        </select>
                    </div>
                    ${item.prefit_enabled ? `
                    <div class="line-item-field line-item-field-checkbox line-item-field-checkbox-align-input line-item-field-prefit-inline line-item-use-customer-door">
                        <label class="checkbox-label">
                            <input type="checkbox" ${item.prefit_customer_brought_door ? 'checked' : ''} data-item-index="${index}" data-item-field="prefit_customer_brought_door">
                            <span>Use Customer Door</span>
                        </label>
                    </div>
                    ` : ''}
                </div>
                ` : isWindow ? `
                <div class="line-item-options line-item-window-fields ${isCollapsed ? 'collapsed' : ''}">
                    <div class="line-item-field">
                        <label>Window Style</label>
                        <select data-item-index="${index}" data-item-field="style">
                            ${renderSelectOptions(
                                [...getStyleOptionsForType('window'), '➕ Add New Style'], item.style)}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Handing</label>
                        <select data-item-index="${index}" data-item-field="operation">
                            ${renderSelectOptions([...getWindowHandingOptions(), '➕ Add New Handing'], item.operation, 'Select handing')}
                        </select>
                        <button hidden type="button" class="item-add-style-button" data-add-handing="window">➕ Add Handing</button>
                    </div>
                    <div class="line-item-field">
                        <label>Fin Type</label>
                        <select data-item-index="${index}" data-item-field="fin_type">
                            ${renderSelectOptions([...finOptionsWithSelected, '➕ Add New Fin Type'], item.fin_type, 'Select fin type')}
                        </select>
                        <button hidden type="button" class="item-add-style-button" data-add-fin-type="true">➕ Add Fin Type</button>
                    </div>
                    <div class="line-item-field">
                        <label>Frame</label>
                        <select data-item-index="${index}" data-item-field="frame">
                            ${renderSelectOptions(['Wood', 'Fiberglass', 'Aluminum', 'Vinyl'], item.frame)}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Exterior Color</label>
                        <select data-item-index="${index}" data-item-field="exterior_color">
                            ${renderSelectOptions([...exteriorWindowColorOptions, '+ Add New Color'], item.exterior_color || item.color, 'Select exterior color')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Interior Color</label>
                        <select data-item-index="${index}" data-item-field="interior_color">
                            ${renderSelectOptions([...interiorWindowColorOptions, '+ Add New Color'], item.interior_color || item.color, 'Select interior color')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Glass</label>
                        <select data-item-index="${index}" data-item-field="glass">
                            ${renderSelectOptions(['Clear', 'Low-E', 'Obscure'], item.glass, 'Select glass')}
                        </select>
                    </div>
                    <div class="line-item-field line-item-field-checkbox line-item-field-checkbox-align-input">
                        <label class="checkbox-label">
                            <input type="checkbox" ${item.tempered_glass ? 'checked' : ''} data-item-index="${index}" data-item-field="tempered_glass">
                            <span>Tempered Glass</span>
                        </label>
                    </div>
                    <div class="line-item-field">
                        <label>Argon</label>
                        <select data-item-index="${index}" data-item-field="argon">
                            ${renderSelectOptions(['Argon'], item.argon)}
                        </select>
                    </div>
                </div>
                ` : ''}

                ${isDoor && item.prefit_enabled ? `
                <div class="line-item-options line-item-prefit-panel">
                    ${showPrefitMeasurements ? `
                    <div class="line-item-field line-item-prefit-full">
                        <label>Vents</label>
                        <div class="line-item-prefit-vent-options">
                            <label class="checkbox-label">
                                <input type="checkbox" ${item.prefit_vent_top ? 'checked' : ''} data-item-index="${index}" data-item-field="prefit_vent_top">
                                <span>Top</span>
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" ${item.prefit_vent_bottom ? 'checked' : ''} data-item-index="${index}" data-item-field="prefit_vent_bottom">
                                <span>Bottom</span>
                            </label>
                        </div>
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Top (inches)</label>
                        <input type="text" value="${escapeHtml(item.prefit_hinge_top || '')}" data-item-index="${index}" data-item-field="prefit_hinge_top" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Mid (inches)</label>
                        <input type="text" value="${escapeHtml(item.prefit_hinge_middle || '')}" data-item-index="${index}" data-item-field="prefit_hinge_middle" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Bot (inches)</label>
                        <input type="text" value="${escapeHtml(item.prefit_hinge_bottom || '')}" data-item-index="${index}" data-item-field="prefit_hinge_bottom" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Width</label>
                        <select data-item-index="${index}" data-item-field="prefit_hinge_width">
                            ${renderSelectOptions(['3"', '3-1/2"', '4"', '4-1/2"'], item.prefit_hinge_width, 'Select hinge width')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Backset</label>
                        <input type="text" value="${escapeHtml(item.prefit_hinge_backset || '')}" data-item-index="${index}" data-item-field="prefit_hinge_backset" placeholder="inches">
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Radius</label>
                        <select data-item-index="${index}" data-item-field="prefit_hinge_radius">
                            ${renderSelectOptions(['1/4"', '5/8"', 'Square'], item.prefit_hinge_radius, 'Select hinge radius')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Prep</label>
                        <select data-item-index="${index}" data-item-field="prefit_hinge_prep">
                            ${renderSelectOptions(['1741', '1279'], item.prefit_hinge_prep, 'Select hinge prep')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Bore Type</label>
                        <select data-item-index="${index}" data-item-field="prefit_bore_type">
                            ${renderSelectOptions(['Single', 'Double'], item.prefit_bore_type, 'Select bore type')}
                        </select>
                    </div>
                    ${showSingleBore ? `
                    <div class="line-item-field">
                        <label>Bore Single (inches)</label>
                        <input type="text" value="${escapeHtml(item.prefit_bore_single || '')}" data-item-index="${index}" data-item-field="prefit_bore_single" placeholder="from top">
                    </div>
                    ` : ''}
                    ${showDoubleBore ? `
                    <div class="line-item-field">
                        <label>Bore Top (inches)</label>
                        <input type="text" value="${escapeHtml(item.prefit_bore_top || '')}" data-item-index="${index}" data-item-field="prefit_bore_top" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Bore Bottom (inches)</label>
                        <input type="text" value="${escapeHtml(item.prefit_bore_bottom || '')}" data-item-index="${index}" data-item-field="prefit_bore_bottom" placeholder="from top">
                    </div>
                    ` : ''}
                    <div class="line-item-field">
                        <label>Bore Backset</label>
                        <select data-item-index="${index}" data-item-field="prefit_bore_backset">
                            ${renderSelectOptions(['2-3/8"', '2-3/4"'], item.prefit_bore_backset, 'Select bore backset')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Bore Diameter</label>
                        <select data-item-index="${index}" data-item-field="prefit_bore_diameter">
                            ${renderSelectOptions([...getPrefitBoreDiameterOptions(), '➕ Add New Bore Diameter'], item.prefit_bore_diameter || '2 1/8"', 'Select bore diameter')}
                        </select>
                    </div>
                    ` : ''}
                </div>
                ` : ''}

                ${isDoor && item.bom_enabled ? `
                <div class="line-item-options line-item-prefit-panel">
                    <div class="line-item-field line-item-prefit-full">
                        <label>Modifiers / Custom Specs</label>
                        <textarea rows="2" data-item-index="${index}" data-item-field="bom_modifiers" placeholder="Custom specs">${escapeHtml(item.bom_modifiers || '')}</textarea>
                    </div>
                    <div class="line-item-field">
                        <label>Door Slabs To Be Used</label>
                        <input type="text" value="${escapeHtml(item.bom_door_slabs || '')}" data-item-index="${index}" data-item-field="bom_door_slabs" placeholder="Slab details">
                    </div>
                    <div class="line-item-field">
                        <label>Jamb / Frame</label>
                        <select data-item-index="${index}" data-item-field="bom_jamb_frame">
                            ${renderSelectOptions(['Jamb', 'Frame'], item.bom_jamb_frame, 'Select type')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Jamb / Frame Spec</label>
                        <input type="text" value="${escapeHtml(item.bom_jamb_frame_spec || '')}" data-item-index="${index}" data-item-field="bom_jamb_frame_spec" placeholder="Size / species / profile">
                    </div>
                    <div class="line-item-field">
                        <label>Bore Specs</label>
                        <select data-item-index="${index}" data-item-field="bom_bore_type">
                            ${renderSelectOptions(['Single', 'Double'], item.bom_bore_type, 'Select bore type')}
                        </select>
                    </div>
                    ${showBomSingleBore ? `
                    <div class="line-item-field">
                        <label>Bore Measurements</label>
                        <input type="text" value="${escapeHtml(item.bom_bore_measurements || '')}" data-item-index="${index}" data-item-field="bom_bore_measurements" placeholder="Measurements">
                    </div>
                    ` : ''}
                    ${showBomDoubleBore ? `
                    <div class="line-item-field">
                        <label>Bore Top (inches)</label>
                        <input type="text" value="${escapeHtml(item.bom_bore_top || '')}" data-item-index="${index}" data-item-field="bom_bore_top" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Bore Bottom (inches)</label>
                        <input type="text" value="${escapeHtml(item.bom_bore_bottom || '')}" data-item-index="${index}" data-item-field="bom_bore_bottom" placeholder="from top">
                    </div>
                    ` : ''}
                    <div class="line-item-field">
                        <label>Hinge Top (inches)</label>
                        <input type="text" value="${escapeHtml(item.bom_hinge_top || '')}" data-item-index="${index}" data-item-field="bom_hinge_top" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Middle (inches)</label>
                        <input type="text" value="${escapeHtml(item.bom_hinge_middle || '')}" data-item-index="${index}" data-item-field="bom_hinge_middle" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Bottom (inches)</label>
                        <input type="text" value="${escapeHtml(item.bom_hinge_bottom || '')}" data-item-index="${index}" data-item-field="bom_hinge_bottom" placeholder="from top">
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Width</label>
                        <select data-item-index="${index}" data-item-field="bom_hinge_width">
                            ${renderSelectOptions(['3"', '3-1/2"', '4"', '4-1/2"'], item.bom_hinge_width, 'Select hinge width')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Hinge Finish</label>
                        <input type="text" value="${escapeHtml(item.bom_hinge_finish || '')}" data-item-index="${index}" data-item-field="bom_hinge_finish" placeholder="Finish color">
                    </div>
                    <div class="line-item-field">
                        <label>Q-lon</label>
                        <select data-item-index="${index}" data-item-field="bom_q_lon">
                            ${renderSelectOptions(['Q-lon', 'None'], item.bom_q_lon, 'Select')}
                        </select>
                    </div>
                    ${showQlonColor ? `
                    <div class="line-item-field">
                        <label>Q-lon Color</label>
                        <select data-item-index="${index}" data-item-field="bom_q_lon_color">
                            ${renderSelectOptions(['White', 'Black', 'Bronze'], item.bom_q_lon_color, 'Select color')}
                        </select>
                    </div>
                    ` : ''}
                    <div class="line-item-field">
                        <label>Sill / Threshold</label>
                        <select data-item-index="${index}" data-item-field="bom_sill_threshold">
                            ${renderSelectOptions(['Sill', 'Threshold', 'None'], item.bom_sill_threshold, 'Select')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Sill / Threshold Finish</label>
                        <select data-item-index="${index}" data-item-field="bom_sill_finish">
                            ${renderSelectOptions(['Aluminum', 'Bronze', 'None'], item.bom_sill_finish, 'Select finish')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Door Bottom</label>
                        <input type="text" value="${escapeHtml(item.bom_door_bottom || '')}" data-item-index="${index}" data-item-field="bom_door_bottom" placeholder="Sweep / none">
                    </div>
                    <div class="line-item-field">
                        <label>Door Bottom Finish</label>
                        <select data-item-index="${index}" data-item-field="bom_door_bottom_finish">
                            ${renderSelectOptions(['Aluminum', 'Bronze', 'None'], item.bom_door_bottom_finish, 'Select finish')}
                        </select>
                    </div>
                    <div class="line-item-field line-item-prefit-full">
                        <label>Hardware Options</label>
                        <div class="line-item-prefit-vent-options">
                            <label class="checkbox-label">
                                <input type="checkbox" ${item.bom_t_astragal ? 'checked' : ''} data-item-index="${index}" data-item-field="bom_t_astragal">
                                <span>T Astragal</span>
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" ${item.bom_ball_catch ? 'checked' : ''} data-item-index="${index}" data-item-field="bom_ball_catch">
                                <span>Ball Catch</span>
                            </label>
                        </div>
                    </div>
                    <div class="line-item-field">
                        <label>Flush Pulls Finish</label>
                        <select data-item-index="${index}" data-item-field="bom_flush_pulls_finish">
                            ${renderSelectOptions(['None', 'US10B', 'US15', 'US26D', 'Black', 'Bronze', 'White', 'Selected'], item.bom_flush_pulls_finish, 'Select finish')}
                        </select>
                    </div>
                    <div class="line-item-field">
                        <label>Casing / Ext Trim</label>
                        <input type="text" value="${escapeHtml(item.bom_casing_ext_trim || '')}" data-item-index="${index}" data-item-field="bom_casing_ext_trim" placeholder="Optional casing / trim">
                    </div>
                    <div class="line-item-field">
                        <label>Space Between Units</label>
                        <input type="text" value="${escapeHtml(item.bom_space || '')}" data-item-index="${index}" data-item-field="bom_space" placeholder="Spacing">
                    </div>
                </div>
                ` : ''}

                <div class="line-item-field">
                    <label>AS400 Comment Preview (includes Ctrl+Alt+S fields)</label>
                    <textarea rows="6" readonly data-as400-preview="${index}">${escapeHtml(as400CommentPreview)}</textarea>
                </div>

                <div class="line-item-field">
                    <label>Notes</label>
                    <textarea rows="2" data-item-index="${index}" data-item-field="notes">${escapeHtml(item.notes || '')}</textarea>
                </div>
                </div>
            </div>
        `;
    }).join('');

    bindLineItemsEditorEvents();
    syncDoorSwingSelectElements();
}

function bindLineItemsEditorEvents() {
    if (!lineItemsList) return;

    decorateLineItemBulkStarButtons();
    lineItemsList.querySelectorAll('[data-as400-group-action]').forEach(button => {
        button.addEventListener('click', async () => {
            const action = button.getAttribute('data-as400-group-action');
            const groupName = button.getAttribute('data-as400-group-name') || '';
            if (action === 'quote' && typeof createQuote === 'function') {
                await createQuote(groupName);
            } else if (action === 'invoice' && typeof createInvoice === 'function') {
                await createInvoice(groupName);
            } else if (action === 'special-order' && typeof createSpecialOrder === 'function') {
                await createSpecialOrder(groupName);
            }
        });
    });

    lineItemsList.querySelectorAll('[data-item-move-up]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-move-up'), 10);
            moveLineItem(index, -1);
        });
    });

    lineItemsList.querySelectorAll('[data-item-move-down]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-move-down'), 10);
            moveLineItem(index, 1);
        });
    });

    lineItemsList.querySelectorAll('[data-item-remove]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-remove'), 10);
            removeLineItem(index);
        });
    });

    lineItemsList.querySelectorAll('[data-item-copy]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-copy'), 10);
            copyLineItem(index);
        });
    });

    lineItemsList.querySelectorAll('[data-item-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-toggle'), 10);
            toggleLineItemCollapse(index);
        });
    });

    lineItemsList.querySelectorAll('.item-type-button, .item-option-button').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-index'), 10);
            const field = button.getAttribute('data-item-field');
            const value = button.getAttribute('data-item-value');
            updateLineItem(index, field, value);
            renderLineItemsEditor();
        });
    });

    lineItemsList.querySelectorAll('[data-add-style-type]').forEach(button => {
        button.addEventListener('click', async () => {
            const itemType = button.getAttribute('data-add-style-type');
            await addItemStyle(itemType);
        });
    });

    lineItemsList.querySelectorAll('[data-add-vendor-type]').forEach(button => {
        button.addEventListener('click', async () => {
            const itemType = button.getAttribute('data-add-vendor-type');
            await addItemVendor(itemType);
        });
    });

    lineItemsList.querySelectorAll('[data-add-series-index]').forEach(button => {
        button.addEventListener('click', async () => {
            const index = parseInt(button.getAttribute('data-add-series-index'), 10);
            const itemType = button.getAttribute('data-add-series-type');
            await addVendorSeriesOption(itemType, index);
        });
    });

    lineItemsList.querySelectorAll('[data-add-fin-type]').forEach(button => {
        button.addEventListener('click', async () => {
            await addFinTypeOption();
        });
    });

    lineItemsList.querySelectorAll('[data-add-handing]').forEach(button => {
        button.addEventListener('click', () => {
            addWindowHandingOption();
        });
    });

    lineItemsList.querySelectorAll('[data-add-jamb-size]').forEach(button => {
        button.addEventListener('click', () => {
            addJambSizeOption();
        });
    });

    lineItemsList.querySelectorAll('input[data-item-field], textarea[data-item-field], select[data-item-field]').forEach(input => {
        const tagName = input.tagName;
        const eventName = tagName === 'TEXTAREA' || tagName === 'INPUT' ? 'input' : 'change';
        if (tagName === 'SELECT') {
            input.addEventListener('keydown', (event) => {
                const index = parseInt(input.getAttribute('data-item-index'), 10);
                const field = input.getAttribute('data-item-field');
                const isRerenderingSelect = field === 'size_mode' || field === 'vendor';

                if (isSelectNavigationKey(event.key)) {
                    input.dataset.keyboardNavigatingAddNew = 'true';
                    if (isRerenderingSelect) {
                        input.dataset.keyboardBrowsingRerenderSelect = 'true';
                    }
                    delete input.dataset.pointerSelectingAddNew;
                    return;
                }

                if ((event.key === 'Enter' || event.key === 'Tab') && isRerenderingSelect && !isAddNewLineItemOption(field, input.value)) {
                    event.preventDefault();
                    delete input.dataset.keyboardBrowsingRerenderSelect;
                    const focusAfterRenderField = field === 'vendor'
                        ? (event.shiftKey ? 'quantity' : 'series')
                        : (event.shiftKey ? 'series' : 'price');
                    updateLineItem(index, field, input.value, { focusAfterRender: true, focusAfterRenderField });
                    return;
                }

                if (event.key === 'Enter' && isAddNewLineItemOption(field, input.value)) {
                    event.preventDefault();
                    delete input.dataset.keyboardNavigatingAddNew;
                    delete input.dataset.pointerSelectingAddNew;
                    input.dataset.addNewHandledByEnter = 'true';
                    updateLineItem(index, field, input.value);
                }
            });

            input.addEventListener('mousedown', () => {
                delete input.dataset.keyboardNavigatingAddNew;
                delete input.dataset.keyboardBrowsingRerenderSelect;
                input.dataset.pointerSelectingAddNew = 'true';
            });

            input.addEventListener('blur', () => {
                const index = parseInt(input.getAttribute('data-item-index'), 10);
                const field = input.getAttribute('data-item-field');
                const wasBrowsingRerenderSelect = input.dataset.keyboardBrowsingRerenderSelect === 'true';
                delete input.dataset.keyboardNavigatingAddNew;
                delete input.dataset.pointerSelectingAddNew;
                delete input.dataset.addNewHandledByEnter;
                delete input.dataset.keyboardBrowsingRerenderSelect;

                if (isAddNewLineItemOption(field, input.value)) {
                    restoreLineItemSelectValue(input, index, field);
                    return;
                }

                if ((field === 'size_mode' || field === 'vendor') && wasBrowsingRerenderSelect) {
                    updateLineItem(index, field, input.value);
                }
            });
        }

        input.addEventListener(eventName, () => {
            const index = parseInt(input.getAttribute('data-item-index'), 10);
            const field = input.getAttribute('data-item-field');
            const value = field === 'quantity'
                ? parseInt(input.value || '1', 10)
                : (input.type === 'checkbox' ? input.checked : input.value);
            if (tagName === 'SELECT' && isAddNewLineItemOption(field, value)) {
                const allowByEnter = input.dataset.addNewHandledByEnter === 'true';
                const allowByPointer = input.dataset.pointerSelectingAddNew === 'true' && input.dataset.keyboardNavigatingAddNew !== 'true';

                if (!allowByEnter && !allowByPointer) {
                    restoreLineItemSelectValue(input, index, field);
                    return;
                }

                delete input.dataset.keyboardNavigatingAddNew;
                delete input.dataset.pointerSelectingAddNew;
                delete input.dataset.addNewHandledByEnter;

                if (allowByEnter) {
                    return;
                }
            }
            if (tagName === 'SELECT' && (field === 'size_mode' || field === 'vendor') && input.dataset.keyboardBrowsingRerenderSelect === 'true') {
                return;
            }
            if (tagName === 'SELECT' && !isAddNewLineItemOption(field, value)) {
                delete input.dataset.keyboardNavigatingAddNew;
                delete input.dataset.pointerSelectingAddNew;
                delete input.dataset.addNewHandledByEnter;
            }
            const focusAfterRenderField = field === 'vendor' ? 'series' : 'price';
            updateLineItem(index, field, value, (field === 'size_mode' || field === 'vendor') ? { focusAfterRender: true, focusAfterRenderField } : {});
            if (field === 'entry_door' || field === 'prefit_enabled' || field === 'prefit_customer_brought_door' || field === 'bom_enabled') {
                renderLineItemsEditor();
                return;
            }

            if (field === 'prefit_bore_type' || field === 'bom_bore_type' || field === 'bom_q_lon') {
                renderLineItemsEditor();
                return;
            }

            refreshAs400CommentPreview(index);
        });
    });

    bindLineItemBulkStarEvents();
}
























