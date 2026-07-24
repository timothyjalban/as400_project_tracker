// Order Tracker - Line Item Catalog Options
// Handles item style, vendor, model/series, fin type, and vendor SKU option data.
// Depends on globals from app.js and line-items.js for active item state and UI refresh.
function getStyleOptionsForType(itemType) {
    const normalizedType = itemType === 'hardware' ? 'hardware' : (itemType === 'window' ? 'window' : 'door');
    const configured = itemStyleOptions?.[normalizedType];
    if (Array.isArray(configured) && configured.length > 0) {
        return configured;
    }
    return DEFAULT_ITEM_STYLE_OPTIONS[normalizedType];
}

async function loadItemStyleOptions() {
    try {
        const response = await fetch(`${API_BASE}/item-style-options`);
        const data = await response.json();
        if (!data.success) return;

        itemStyleOptions = {
            door: Array.isArray(data.styles?.door) && data.styles.door.length > 0 ? data.styles.door : [...DEFAULT_ITEM_STYLE_OPTIONS.door],
            window: Array.isArray(data.styles?.window) && data.styles.window.length > 0 ? data.styles.window : [...DEFAULT_ITEM_STYLE_OPTIONS.window],
            hardware: Array.isArray(data.styles?.hardware) && data.styles.hardware.length > 0 ? data.styles.hardware : [...DEFAULT_ITEM_STYLE_OPTIONS.hardware]
        };

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
        }
    } catch (error) {
        console.warn('Unable to load item style options, using defaults.', error);
    }
}

function getVendorOptionsForType(itemType) {
    const normalizedType = itemType === 'hardware' ? 'hardware' : (itemType === 'window' ? 'window' : 'door');
    const configured = itemVendorOptions?.[normalizedType];
    if (Array.isArray(configured) && configured.length > 0) {
        return configured;
    }
    return DEFAULT_ITEM_VENDOR_OPTIONS[normalizedType];
}

function normalizeVendorSeriesMap(input) {
    const normalized = { door: {}, window: {}, hardware: {} };
    if (!input || typeof input !== 'object') {
        return normalized;
    }

    for (const itemType of ['door', 'window', 'hardware']) {
        const byVendor = input[itemType];
        if (!byVendor || typeof byVendor !== 'object') {
            continue;
        }

        for (const [vendorName, seriesList] of Object.entries(byVendor)) {
            const cleanVendor = String(vendorName || '').trim();
            if (!cleanVendor) continue;
            const cleanSeries = Array.isArray(seriesList)
                ? seriesList.map(name => String(name || '').trim()).filter(Boolean)
                : [];
            normalized[itemType][cleanVendor] = Array.from(new Set(cleanSeries)).sort((a, b) => a.localeCompare(b));
        }
    }

    return normalized;
}

function getSeriesOptionsForItemVendor(itemType, vendorName) {
    const normalizedType = itemType === 'hardware' ? 'hardware' : (itemType === 'window' ? 'window' : 'door');
    const cleanVendor = String(vendorName || '').trim();
    if (!cleanVendor) return [];

    const searchTypes = normalizedType === 'hardware' ? ['hardware'] : [normalizedType, normalizedType === 'window' ? 'door' : 'window'];

    for (const typeKey of searchTypes) {
        const byVendor = vendorSeriesOptions?.[typeKey] || {};
        const direct = byVendor[cleanVendor];
        if (Array.isArray(direct) && direct.length > 0) {
            return direct;
        }

        const fallbackKey = Object.keys(byVendor).find(name => name.toLowerCase() === cleanVendor.toLowerCase());
        if (fallbackKey && Array.isArray(byVendor[fallbackKey]) && byVendor[fallbackKey].length > 0) {
            return byVendor[fallbackKey];
        }
    }

    return [];
}

function getFinTypeOptions() {
    const options = Array.isArray(finTypeOptions) && finTypeOptions.length > 0
        ? finTypeOptions
        : DEFAULT_FIN_TYPE_OPTIONS;
    return Array.from(new Set(options.map(name => normalizeFinTypeValue(name)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function normalizeVendorKey(name) {
    return String(name || '').trim().toLowerCase();
}

function getVendorSkuForName(name) {
    const key = normalizeVendorKey(name);
    return key ? (vendorSkuByName[key] || '') : '';
}

function mergeVendorOptionsWithCatalog(baseOptions) {
    const names = new Set((Array.isArray(baseOptions) ? baseOptions : []).map(name => String(name || '').trim()).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

async function loadVendorCatalog() {
    try {
        const response = await fetch(`${API_BASE}/vendor-catalog`);
        const data = await response.json();
        if (!data.success || !Array.isArray(data.vendors)) return;

        vendorSkuByName = {};
        data.vendors.forEach(vendor => {
            const name = String(vendor?.name || '').trim();
            if (!name) return;
            const key = normalizeVendorKey(name);
            vendorSkuByName[key] = vendor?.sku != null ? String(vendor.sku) : '';
        });

        const vendorNames = data.vendors
            .map(vendor => String(vendor?.name || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));

        if (vendorNames.length > 0) {
            itemVendorOptions = {
                door: mergeVendorOptionsWithCatalog([...itemVendorOptions.door, ...vendorNames]),
                window: mergeVendorOptionsWithCatalog([...itemVendorOptions.window, ...vendorNames]),
                hardware: mergeVendorOptionsWithCatalog([...(itemVendorOptions.hardware || []), ...vendorNames])
            };
        }

        currentLineItems = currentLineItems.map(item => {
            if (item.vendor && !item.vendor_sku) {
                return { ...item, vendor_sku: getVendorSkuForName(item.vendor) || '' };
            }
            return item;
        });

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
            syncLineItemsToHiddenField();
        }
    } catch (error) {
        console.warn('Unable to load vendor SKU catalog.', error);
    }
}

async function loadItemVendorOptions() {
    try {
        const response = await fetch(`${API_BASE}/item-vendor-options`);
        const data = await response.json();
        if (!data.success) return;

        itemVendorOptions = {
            door: Array.isArray(data.vendors?.door) && data.vendors.door.length > 0 ? data.vendors.door : [...DEFAULT_ITEM_VENDOR_OPTIONS.door],
            window: Array.isArray(data.vendors?.window) && data.vendors.window.length > 0 ? data.vendors.window : [...DEFAULT_ITEM_VENDOR_OPTIONS.window],
            hardware: Array.isArray(data.vendors?.hardware) && data.vendors.hardware.length > 0 ? data.vendors.hardware : [...DEFAULT_ITEM_VENDOR_OPTIONS.hardware]
        };

        itemVendorOptions = {
            door: mergeVendorOptionsWithCatalog(itemVendorOptions.door),
            window: mergeVendorOptionsWithCatalog(itemVendorOptions.window),
            hardware: mergeVendorOptionsWithCatalog(itemVendorOptions.hardware || DEFAULT_ITEM_VENDOR_OPTIONS.hardware)
        };

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
        }
    } catch (error) {
        console.warn('Unable to load item vendor options, using defaults.', error);
    }
}

async function loadVendorSeriesOptions() {
    try {
        const response = await fetch(`${API_BASE}/vendor-series-options`);
        const data = await response.json();
        if (!data.success) return;

        vendorSeriesOptions = normalizeVendorSeriesMap(data.series);
        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
        }
    } catch (error) {
        console.warn('Unable to load vendor series options.', error);
    }
}

function getWindowColorOptions(currentValue = '') {
    const currentOrderColors = (Array.isArray(currentLineItems) ? currentLineItems : [])
        .filter(item => String(item?.type || '').toLowerCase() === 'window')
        .flatMap(item => [item?.exterior_color, item?.interior_color, item?.color]);
    return Array.from(new Set([
        ...(Array.isArray(windowColorOptions) ? windowColorOptions : []),
        ...currentOrderColors,
        currentValue
    ].map(value => String(value || '').trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b));
}

async function loadWindowColorOptions() {
    try {
        const response = await fetch(`${API_BASE}/window-color-options`);
        const data = await response.json();
        if (!data.success) return;

        windowColorOptions = Array.isArray(data.colors)
            ? data.colors.map(name => String(name || '').trim()).filter(Boolean)
            : [...DEFAULT_WINDOW_COLOR_OPTIONS];

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
        }
    } catch (error) {
        console.warn('Unable to load window color options.', error);
    }
}

async function addWindowColorOption(index = null, field = 'exterior_color') {
    const colorName = prompt('Add a new window color:');
    if (colorName === null) return null;

    const trimmedColorName = colorName.trim();
    if (!trimmedColorName) {
        showError('Color cannot be empty');
        return null;
    }

    try {
        const response = await fetch(`${API_BASE}/window-color-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color_name: trimmedColorName })
        });
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to save window color');
            return null;
        }

        windowColorOptions = Array.isArray(data.colors)
            ? data.colors.map(name => String(name || '').trim()).filter(Boolean)
            : [...DEFAULT_WINDOW_COLOR_OPTIONS];

        if (index !== null && currentLineItems[index]) {
            currentLineItems[index][field] = trimmedColorName;
            syncWindowLegacyColor(currentLineItems[index]);
            syncLineItemsToHiddenField();
            persistLineItemsStateSilently();
        }

        renderLineItemsEditor();
        showToast(`${trimmedColorName} added to window colors`);
        return trimmedColorName;
    } catch (error) {
        console.error('Error saving window color option:', error);
        showError('Failed to save window color option');
        return null;
    }
}
async function loadFinTypeOptions() {
    try {
        const response = await fetch(`${API_BASE}/fin-type-options`);
        const data = await response.json();
        if (!data.success) return;

        finTypeOptions = Array.isArray(data.fin_types) && data.fin_types.length > 0
            ? data.fin_types.map(name => normalizeFinTypeValue(name)).filter(Boolean)
            : [...DEFAULT_FIN_TYPE_OPTIONS];

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
        }
    } catch (error) {
        console.warn('Unable to load fin type options.', error);
    }
}

async function addItemStyle(itemType, index = null) {
    const normalizedType = itemType === 'hardware' ? 'hardware' : (itemType === 'window' ? 'window' : 'door');
    const label = normalizedType === 'hardware' ? 'hardware' : (normalizedType === 'window' ? 'window' : 'door');
    const styleName = prompt(`Add a new ${label} style:`);

    if (styleName === null) return;
    const trimmedStyleName = styleName.trim();
    if (!trimmedStyleName) {
        showError('Style name cannot be empty');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/item-style-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_type: normalizedType,
                style_name: trimmedStyleName
            })
        });
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to save style');
            return;
        }

        itemStyleOptions = {
            door: Array.isArray(data.styles?.door) && data.styles.door.length > 0 ? data.styles.door : [...DEFAULT_ITEM_STYLE_OPTIONS.door],
            window: Array.isArray(data.styles?.window) && data.styles.window.length > 0 ? data.styles.window : [...DEFAULT_ITEM_STYLE_OPTIONS.window],
            hardware: Array.isArray(data.styles?.hardware) && data.styles.hardware.length > 0 ? data.styles.hardware : [...DEFAULT_ITEM_STYLE_OPTIONS.hardware]
        };

        if (index !== null && currentLineItems[index]) {
            currentLineItems[index].style = trimmedStyleName;
            syncLineItemsToHiddenField();
            persistLineItemsStateSilently();
        }

        renderLineItemsEditor();
        showToast(`${trimmedStyleName} saved for ${label} styles`);
        return trimmedStyleName;
    } catch (error) {
        console.error('Error saving style option:', error);
        showError('Failed to save style option');
        return null;
    }
}

async function addItemVendor(itemType, index = null) {
    const normalizedType = itemType === 'hardware' ? 'hardware' : (itemType === 'window' ? 'window' : 'door');
    const label = normalizedType === 'hardware' ? 'hardware' : (normalizedType === 'window' ? 'window' : 'door');
    const vendorName = prompt(`Add a new ${label} vendor:`);

    if (vendorName === null) return;
    const trimmedVendorName = vendorName.trim();
    if (!trimmedVendorName) {
        showError('Vendor name cannot be empty');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/item-vendor-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_type: normalizedType,
                vendor_name: trimmedVendorName
            })
        });
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to save vendor');
            return;
        }

        itemVendorOptions = {
            door: Array.isArray(data.vendors?.door) && data.vendors.door.length > 0 ? data.vendors.door : [...DEFAULT_ITEM_VENDOR_OPTIONS.door],
            window: Array.isArray(data.vendors?.window) && data.vendors.window.length > 0 ? data.vendors.window : [...DEFAULT_ITEM_VENDOR_OPTIONS.window],
            hardware: Array.isArray(data.vendors?.hardware) && data.vendors.hardware.length > 0 ? data.vendors.hardware : [...DEFAULT_ITEM_VENDOR_OPTIONS.hardware]
        };

        if (index !== null && currentLineItems[index]) {
            currentLineItems[index].vendor = trimmedVendorName;
            currentLineItems[index].vendor_sku = getVendorSkuForName(trimmedVendorName) || '';
            currentLineItems[index].series = '';
            if (currentLineItems[index].type === 'door') {
                currentLineItems[index].model = '';
            }
            syncLineItemsToHiddenField();
            persistLineItemsStateSilently();
        }

        renderLineItemsEditor();
        showToast(`${trimmedVendorName} saved for ${label} vendors`);
        return trimmedVendorName;
    } catch (error) {
        console.error('Error saving vendor option:', error);
        showError('Failed to save vendor option');
        return null;
    }
}

async function addVendorSeriesOption(itemType, index) {
    const normalizedType = itemType === 'hardware' ? 'hardware' : (itemType === 'window' ? 'window' : 'door');
    const item = currentLineItems[index];
    if (!item) return;

    const vendorName = String(item.vendor || '').trim();
    if (!vendorName) {
        showError('Select a vendor before adding a series');
        return;
    }

    const seriesName = prompt(`Add a new ${vendorName} series:`);
    if (seriesName === null) return;
    const trimmedSeriesName = seriesName.trim();
    if (!trimmedSeriesName) {
        showError('Series name cannot be empty');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/vendor-series-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_type: normalizedType,
                vendor_name: vendorName,
                series_name: trimmedSeriesName
            })
        });
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to save series option');
            return;
        }

        vendorSeriesOptions = normalizeVendorSeriesMap(data.series);
        updateLineItem(index, 'series', trimmedSeriesName);
        persistLineItemsStateSilently();
        renderLineItemsEditor();
        showToast(`${trimmedSeriesName} added for ${vendorName}`);
        return trimmedSeriesName;
    } catch (error) {
        console.error('Error saving vendor series option:', error);
        showError('Failed to save series option');
        return null;
    }
}

async function addFinTypeOption(index = null) {
    const finTypeName = prompt('Add a new fin type:');
    if (finTypeName === null) return;
    const trimmedFinTypeName = finTypeName.trim();
    if (!trimmedFinTypeName) {
        showError('Fin type cannot be empty');
        return;
    }

    const normalizedFinTypeName = normalizeFinTypeValue(trimmedFinTypeName);

    try {
        const response = await fetch(`${API_BASE}/fin-type-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fin_type_name: normalizedFinTypeName })
        });
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to save fin type');
            return;
        }

        finTypeOptions = Array.isArray(data.fin_types) && data.fin_types.length > 0
            ? data.fin_types.map(name => normalizeFinTypeValue(name)).filter(Boolean)
            : [...DEFAULT_FIN_TYPE_OPTIONS];

        if (index !== null && currentLineItems[index]) {
            currentLineItems[index].fin_type = normalizedFinTypeName;
            syncLineItemsToHiddenField();
            persistLineItemsStateSilently();
        }

        renderLineItemsEditor();
        showToast(`${normalizedFinTypeName} added to fin types`);
        return normalizedFinTypeName;
    } catch (error) {
        console.error('Error saving fin type option:', error);
        showError('Failed to save fin type option');
        return null;
    }
}


