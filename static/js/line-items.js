// Order Tracker - Line Items: item state, normalization, geometry, updates
// Depends on app.js (order state, DOM refs, UI helpers), line-item-options.js +
// line-item-catalog.js (dropdowns), line-item-groups.js (AS400 groups),
// line-item-render.js (renderLineItemsEditor), line-item-fields.js (registry).
function createLineItemTemplate(type) {
    // Install is a minimal, system-managed line (see handleNeedsInstallToggle) -
    // it doesn't participate in door/window/hardware bulk-set defaults.
    const defaults = {};
    if (type !== 'install') {
        for (const [field, value] of Object.entries(getBulkDefaultsForType(type))) {
            const def = _getBulkFieldDef(field);
            if (!isBulkFieldCompatibleWithType(def, type)) continue;
            if (value !== '' && value !== null && value !== undefined) defaults[field] = value;
        }
    }

    // Blank defaults come from the field registry (static/js/line-item-fields.js).
    // To add a field, add its entry there - see docs/adding-a-line-item-field.md.
    const base = lineItemTemplateDefaults();
    base.type = type;
    base.product = type === 'install' ? 'Install'
        : type === 'hardware' ? 'Hardware'
        : type === 'window' ? 'Window' : 'Door';

    // Bulk-set defaults override the blanks (must be last).
    return { ...base, ...defaults };
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
    // Install is a minimal, system-managed line (see handleNeedsInstallToggle)
    // with none of the door/window/hardware fields below - keep it isolated
    // from that normalization entirely rather than let it fall through to
    // the door default.
    const rawTypeTextForInstallCheck = String(rawItem?.type || rawItem?.product || '').toLowerCase();
    if (rawTypeTextForInstallCheck.includes('install')) {
        return {
            ...createLineItemTemplate('install'),
            ...(rawItem || {}),
            type: 'install',
            product: 'Install',
            quantity: rawItem?.quantity || 1,
        };
    }

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

const INSTALL_LINE_ITEM_SKU = '661808';

function handleNeedsInstallToggle(checked) {
    // Explicit '0' (not '') - collectInlineOrderFormData() treats a blank
    // hidden field as "unchanged, keep the existing saved value", which
    // would silently re-check the box on save if we used ''.
    const hidden = document.getElementById('inline_needs_install');
    if (hidden) hidden.value = checked ? '1' : '0';

    const hasInstallItem = currentLineItems.some(item => item.type === 'install');

    if (checked && !hasInstallItem) {
        const installItem = createLineItemTemplate('install');
        installItem.vendor_sku = INSTALL_LINE_ITEM_SKU;
        installItem.quantity = 1;
        syncLineItemAs400Group(installItem);
        currentLineItems.push(installItem);
        renderLineItemsEditor();
        syncLineItemsToHiddenField();
    } else if (!checked && hasInstallItem) {
        currentLineItems = currentLineItems.filter(item => item.type !== 'install');
        renderLineItemsEditor();
        syncLineItemsToHiddenField();
    }
}

function addLineItem(type) {
    const newItem = createLineItemTemplate(type);
    syncLineItemAs400Group(newItem);
    if (typeof applyBulkGroupDefaultsToItem === 'function') {
        applyBulkGroupDefaultsToItem(newItem);
    }
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
        if (typeof applyBulkGroupDefaultsToItem === 'function') {
            applyBulkGroupDefaultsToItem(currentLineItems[index]);
        }
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
            if (typeof applyBulkGroupDefaultsToItem === 'function') {
                applyBulkGroupDefaultsToItem(currentLineItems[index]);
            }
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
            if (typeof applyBulkGroupDefaultsToItem === 'function') {
                applyBulkGroupDefaultsToItem(currentLineItems[index]);
            }
        }
    }

    if ((field === 'style' || field === 'door_style' || field === 'door_type') && !currentLineItems[index].as400_group_custom) {
        syncLineItemAs400Group(currentLineItems[index], { force: true });
        if (typeof applyBulkGroupDefaultsToItem === 'function') {
            applyBulkGroupDefaultsToItem(currentLineItems[index]);
        }
    }

    if (field === 'size_mode') {
        const isDoorItem = currentLineItems[index].type === 'door';
        if (normalizedValue === 'callout') {
            if (!String(currentLineItems[index].callout_size || '').trim()) {
                let widthForCallout = currentLineItems[index].width;
                let heightForCallout = currentLineItems[index].height;
                if (isDoorItem) {
                    const nominal = reverseDoorRoughOpeningDimensions(widthForCallout, heightForCallout);
                    if (nominal) {
                        widthForCallout = nominal.width;
                        heightForCallout = nominal.height;
                    }
                }
                const inferredCallout = dimensionsToCallout(widthForCallout, heightForCallout);
                if (inferredCallout) {
                    currentLineItems[index].callout_size = inferredCallout;
                    currentLineItems[index].size = inferredCallout;
                }
            }
        } else if (normalizedValue === 'rough_opening') {
            const calloutCode = String(currentLineItems[index].callout_size || '').trim();
            if (calloutCode) {
                const nominal = calloutToDimensions(calloutCode);
                if (nominal) {
                    if (isDoorItem) {
                        const ro = calculateDoorRoughOpeningDimensions(nominal.width, nominal.height);
                        if (ro) {
                            currentLineItems[index].width = ro.width;
                            currentLineItems[index].height = ro.height;
                        }
                    } else {
                        currentLineItems[index].width = nominal.width;
                        currentLineItems[index].height = nominal.height;
                    }
                }
            } else {
                const hasWidthOrHeight = String(currentLineItems[index].width || '').trim() || String(currentLineItems[index].height || '').trim();
                if (!hasWidthOrHeight) {
                    const derived = calloutToDimensions(currentLineItems[index].callout_size);
                    if (derived) {
                        currentLineItems[index].width = derived.width;
                        currentLineItems[index].height = derived.height;
                    }
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
