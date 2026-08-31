// Order Tracker - Line Item editor rendering
//
// Extracted from line-items.js. Turns currentLineItems into the editor HTML and
// binds its events. Most fields render from the registry via renderLineItemField
// (see static/js/line-item-fields.js and docs/adding-a-line-item-field.md);
// a few bespoke ones (type toggle, room, vendor, checkbox subgroups) are inline.
//
// Depends on line-items.js (state + updateLineItem + option getters),
// line-item-catalog.js (vendor/style/series/color lookups), line-item-as400.js
// (buildAs400CommentPreview), and line-item-fields.js (the registry).

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

// Dynamic option lists for registry fields whose choices aren't a static array.
// Keyed by `render.optionsSource` in line-item-fields.js. Each gets (item).
function lineItemOptionSource(name, item) {
    switch (name) {
        case 'hardwareProductCode': return getHardwareProductCodeOptions(item);
        case 'hardwareLeverKnob': return getHardwareLeverKnobStyleOptions(item.hardware_lever_knob_style);
        case 'hardwareFinishCode': return HARDWARE_FINISH_US_CODE_OPTIONS;
        case 'doorStyle': return [...getStyleOptionsForType('door'), '➕ Add New Style'];
        case 'windowStyle': return [...getStyleOptionsForType('window'), '➕ Add New Style'];
        case 'hardwareStyle': return [...getStyleOptionsForType('hardware'), '+ Add New Style'];
        case 'jambSize': return [
            ...(item.jamb_size && !getJambSizeOptions().some(o => o.toLowerCase() === String(item.jamb_size).toLowerCase())
                ? [item.jamb_size] : []),
            ...getJambSizeOptions(),
            '➕ Add New Jamb Size',
        ];
        case 'prefitBoreDiameter': return [...getPrefitBoreDiameterOptions(), '➕ Add New Bore Diameter'];
        case 'itemSeries': {
            const raw = getSeriesOptionsForItemVendor(item.type, item.vendor);
            const isHw = item.type === 'hardware';
            const opts = isHw ? raw.filter(o => !isHardwareProductCodeValue(o)) : raw;
            const withSel = item.series && !opts.includes(item.series) && !(isHw && isHardwareProductCodeValue(item.series))
                ? [item.series, ...opts] : opts;
            return [...withSel, '➕ Add New Model'];
        }
        case 'winHanding': return [...getWindowHandingOptions(), '➕ Add New Handing'];
        case 'winFinType': {
            const opts = getFinTypeOptions();
            const withSel = item.fin_type && !opts.includes(item.fin_type) ? [item.fin_type, ...opts] : opts;
            return [...withSel, '➕ Add New Fin Type'];
        }
        case 'winExteriorColor': return [...getWindowColorOptions(item.exterior_color || item.color), '+ Add New Color'];
        case 'winInteriorColor': return [...getWindowColorOptions(item.interior_color || item.color), '+ Add New Color'];
        default: return [];
    }
}

// Render one registry-driven line-item field. The registry entry's `render`
// block carries: label, options (static array) OR optionsSource (dynamic),
// placeholder, valueFrom (value fallback chain), afterControl (raw HTML like a
// hidden "add" button), onlyForType.
// See static/js/line-item-fields.js and docs/adding-a-line-item-field.md.
function renderLineItemField(item, index, key) {
    const field = typeof lineItemField === 'function' ? lineItemField(key) : null;
    if (!field || !field.render) return '';
    // render.variants: per-item-type render config (for polymorphic fields).
    const r = field.render.variants ? field.render.variants[item.type] : field.render;
    if (!r) return '';
    if (r.onlyForType && item.type !== r.onlyForType) return '';

    let value = item[key];
    if ((value === undefined || value === null || value === '') && Array.isArray(r.valueFrom)) {
        for (const alt of r.valueFrom) {
            if (item[alt] !== undefined && item[alt] !== null && item[alt] !== '') { value = item[alt]; break; }
        }
    }

    if (field.control === 'checkbox') {
        return `<div class="line-item-field line-item-field-checkbox line-item-field-checkbox-align-input">
                        <label class="checkbox-label">
                            <input type="checkbox" ${value ? 'checked' : ''} data-item-index="${index}" data-item-field="${key}">
                            <span>${r.label}</span>
                        </label>
                    </div>`;
    }

    const wrapperClass = r.wrapperClass ? `line-item-field ${r.wrapperClass}` : 'line-item-field';

    // Dynamic placeholder: "@series" -> vendor-aware hint.
    let placeholder = r.placeholder;
    if (placeholder === '@series') placeholder = item.vendor ? 'Select model' : 'Choose vendor first';

    let control;
    if (field.control === 'select') {
        const options = r.optionsSource ? lineItemOptionSource(r.optionsSource, item) : (r.options || []);
        // boolSelect: a Yes/No dropdown bound to a boolean field.
        let selected = r.boolSelect ? (value ? 'Yes' : 'No') : value;
        if ((selected === undefined || selected === null || selected === '') && r.defaultValue) selected = r.defaultValue;
        control = `<select data-item-index="${index}" data-item-field="${key}">
                            ${renderSelectOptions(options, selected, placeholder)}
                        </select>`;
    } else if (field.control === 'number') {
        const n = r.number || {};
        const attrs = [n.min != null ? `min="${n.min}"` : '', n.step != null ? `step="${n.step}"` : ''].filter(Boolean).join(' ');
        const shown = (value != null && value !== '') ? value : '';
        control = `<input type="number" ${attrs} value="${escapeHtml(shown)}" data-item-index="${index}" data-item-field="${key}"${placeholder ? ` placeholder="${placeholder}"` : ''}>`;
    } else if (field.control === 'textarea') {
        control = `<textarea rows="${r.rows || 2}" data-item-index="${index}" data-item-field="${key}"${placeholder ? ` placeholder="${placeholder}"` : ''}>${escapeHtml(value || '')}</textarea>`;
    } else {
        control = `<input type="text" value="${escapeHtml(value || '')}" data-item-index="${index}" data-item-field="${key}"${placeholder ? ` placeholder="${placeholder}"` : ''}>`;
    }
    if (r.afterControl) {
        const btn = r.afterControl
            .replace(/\{index\}/g, index)
            .replace(/\{type\}/g, item.type)
            .replace(/\{label\}/g, r.label || '');
        control += `\n                        ${btn}`;
    }

    return `<div class="${wrapperClass}">
                        <label>${r.label}</label>
                        ${control}
                    </div>`;
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
function renderInstallLineItemCard(item, index) {
    const groupName = getAs400GroupNameForItem(item);
    const previousGroupName = index > 0 ? getAs400GroupNameForItem(currentLineItems[index - 1]) : '';
    const groupHeader = index === 0 || groupName !== previousGroupName
        ? renderAs400GroupHeader(groupName)
        : '';
    const groupColor = getAs400GroupColor(groupName);

    return `
        ${groupHeader}
        <div class="line-item-card as400-group-card as400-group-${groupColor} line-item-card-install" data-line-item-card="${index}" data-as400-group-card="${escapeHtml(groupName)}">
            <div class="line-item-header">
                <div class="line-item-header-main">
                    <span class="line-item-number">#${index + 1}</span>
                    <span class="line-item-install-badge">Install</span>
                    <div class="line-item-field line-item-room-inline">
                        <input type="text" value="${escapeHtml(item.room || '')}" data-item-index="${index}" data-item-field="room" placeholder="Room / Location" aria-label="Room / Location">
                    </div>
                </div>
                <div class="line-item-header-actions">
                    <button type="button" class="item-move-button" data-item-move-up="${index}" ${index === 0 ? 'disabled' : ''} title="Move item up">Up</button>
                    <button type="button" class="item-move-button" data-item-move-down="${index}" ${index === currentLineItems.length - 1 ? 'disabled' : ''} title="Move item down">Down</button>
                    <button type="button" class="item-remove-button" data-item-remove="${index}">Remove</button>
                </div>
            </div>
            <div class="line-item-grid line-item-grid-quick">
                <div class="line-item-field">
                    <label>Quantity</label>
                    <input type="number" min="1" value="${item.quantity}" data-item-index="${index}" data-item-field="quantity">
                </div>
                <div class="line-item-field">
                    <label>Unit Price</label>
                    <input type="number" min="0" step="0.01" value="${escapeHtml(item.price != null && item.price !== '' ? item.price : '')}" data-item-index="${index}" data-item-field="price" placeholder="e.g. 499.99">
                </div>
                <div class="line-item-field">
                    <label>AS400 Description</label>
                    <div class="item-vendor-sku">SKU ${escapeHtml(item.vendor_sku || '')} &mdash; DeCamp Install</div>
                </div>
            </div>
        </div>
    `;
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
        if (item.type === 'install') {
            return renderInstallLineItemCard(item, index);
        }

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
                        <span class="line-item-number">#${index + 1}</span>
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
                    ${renderLineItemField(item, index, "quantity")}
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
    
                    ${renderLineItemField(item, index, "series")}
                    ${!isHardware ? renderLineItemField(item, index, "size_mode") : ''}
                    ${renderLineItemField(item, index, "price")}
                    ${!isHardware ? (isCalloutSize && !isGableWindow
                        ? renderLineItemField(item, index, "callout_size")
                        : isGableWindow
                        ? ["width", "gable_tall_side", "gable_short_side"].map(k => renderLineItemField(item, index, k)).join('')
                        : ["width", "height"].map(k => renderLineItemField(item, index, k)).join('')
                    ) : ''}                </div>

                ${isHardware ? `
                <div class="line-item-options line-item-hardware-fields ${isCollapsed ? 'collapsed' : ''}">
                    ${renderLineItemField(item, index, "style")}
                    ${["hardware_product_code", "hardware_lever_knob_style", "hardware_finish_code", "hardware_handing", "hardware_backset", "hardware_bore", "hardware_keying"].map(k => renderLineItemField(item, index, k)).join('')}
                </div>
                ` : ''}
                ${isDoor ? `
                <div class="line-item-options line-item-door-fields ${isCollapsed ? 'collapsed' : ''}">
                    ${["entry_door", "thickness"].map(k => renderLineItemField(item, index, k)).join('')}
                    ${renderLineItemField(item, index, "jamb_size")}
                    ${renderLineItemField(item, index, "style")}
                    ${renderLineItemField(item, index, "door_count")}
                    ${showEntryDoorDetails ? `
                    ${["sidelites", "transom"].map(k => renderLineItemField(item, index, k)).join('')}
                    ` : ''}
                    ${renderLineItemField(item, index, "swing")}
                    ${["door_location", "material", "door_texture", "core", "sticking", "glass_tint", "door_glass_shape", "door_glass_lite_style", "door_frame_profile", "finish_type", "finish_detail", "panel_style", "boring", "hinge_size", "hinge_finish", "exterior_trim", "sill", "hardware_option"].map(k => renderLineItemField(item, index, k)).join('')}
                    <div class="line-item-field line-item-field-checkbox line-item-field-checkbox-align-input">
                        <label class="checkbox-label">
                            <input type="checkbox" ${item.qlon ? 'checked' : ''} data-item-index="${index}" data-item-field="qlon">
                            <span>Q-lon Weatherstripping</span>
                        </label>
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
                    ${renderLineItemField(item, index, "style")}
                    ${["operation", "fin_type", "frame", "exterior_color", "interior_color", "glass", "tempered_glass", "argon"].map(k => renderLineItemField(item, index, k)).join('')}
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
                    ${["prefit_hinge_top", "prefit_hinge_middle", "prefit_hinge_bottom", "prefit_hinge_width", "prefit_hinge_backset", "prefit_hinge_radius", "prefit_hinge_prep", "prefit_bore_type"].map(k => renderLineItemField(item, index, k)).join('')}
                    ${showSingleBore ? renderLineItemField(item, index, "prefit_bore_single") : ''}
                    ${showDoubleBore ? ["prefit_bore_top", "prefit_bore_bottom"].map(k => renderLineItemField(item, index, k)).join('') : ''}
                    ${["prefit_bore_backset", "prefit_bore_diameter"].map(k => renderLineItemField(item, index, k)).join('')}
                    ` : ''}
                </div>
                ` : ''}

                ${isDoor && item.bom_enabled ? `
                <div class="line-item-options line-item-prefit-panel">
                    ${["bom_modifiers", "bom_door_slabs", "bom_jamb_frame", "bom_jamb_frame_spec", "bom_bore_type"].map(k => renderLineItemField(item, index, k)).join('')}
                    ${showBomSingleBore ? renderLineItemField(item, index, "bom_bore_measurements") : ''}
                    ${showBomDoubleBore ? ["bom_bore_top", "bom_bore_bottom"].map(k => renderLineItemField(item, index, k)).join('') : ''}
                    ${["bom_hinge_top", "bom_hinge_middle", "bom_hinge_bottom", "bom_hinge_width", "bom_hinge_finish", "bom_q_lon"].map(k => renderLineItemField(item, index, k)).join('')}
                    ${showQlonColor ? renderLineItemField(item, index, "bom_q_lon_color") : ''}
                    ${["bom_sill_threshold", "bom_sill_finish", "bom_door_bottom", "bom_door_bottom_finish"].map(k => renderLineItemField(item, index, k)).join('')}
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
                    ${["bom_flush_pulls_finish", "bom_casing_ext_trim", "bom_space"].map(k => renderLineItemField(item, index, k)).join('')}
                </div>
                ` : ''}

                <div class="line-item-field">
                    <label>AS400 Comment Preview (includes Ctrl+Alt+S fields)</label>
                    <textarea rows="6" readonly data-as400-preview="${index}">${escapeHtml(as400CommentPreview)}</textarea>
                </div>

                ${renderLineItemField(item, index, "notes")}
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
