// Order Tracker - Line-item local option lists
//
// Extracted from line-items.js. Manages the editable dropdown option lists that
// live in the browser's localStorage (not the server): hardware lever/knob
// styles + product codes, window handing, jamb sizes, door locations, prefit
// bore diameters. Each has load / save / get / add helpers.
//
// (Server-backed option lists - vendors, styles, series, colors, fin types -
//  are in line-item-catalog.js.)

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

// Window handing / jamb size / bore diameter / lever-knob lists moved to the
// DB (line_item_field_options) - these accessors now read the field-config
// cache so bulk-set and any stragglers keep working. Manage them in the
// Line-Item Fields settings screen.
function getWindowHandingOptions() {
    if (typeof fieldConfigActiveRows === 'function') {
        const rows = fieldConfigActiveRows('operation', 'window').map(r => r.value);
        if (rows.length) return rows;
    }
    return [...DEFAULT_WINDOW_HANDING_OPTIONS];
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
    const configured = typeof fieldConfigActiveRows === 'function'
        ? fieldConfigActiveRows('hardware_lever_knob_style', 'hardware').map(r => r.value)
        : [];
    const currentOrderStyles = (Array.isArray(currentLineItems) ? currentLineItems : [])
        .filter(candidate => String(candidate?.type || '').toLowerCase() === 'hardware')
        .map(candidate => candidate?.hardware_lever_knob_style);
    return uniqueSortedOptions([...configured, ...currentOrderStyles, currentValue]);
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
    if (typeof fieldConfigActiveRows === 'function') {
        const rows = fieldConfigActiveRows('jamb_size', 'door').map(r => r.value);
        if (rows.length) return rows;
    }
    return [...DEFAULT_JAMB_SIZE_OPTIONS];
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
    if (typeof fieldConfigActiveRows === 'function') {
        const rows = fieldConfigActiveRows('prefit_bore_diameter', 'door').map(r => r.value);
        if (rows.length) return rows;
    }
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
