// Order Tracker - Line Item AS400 Preview and Macro Helpers
// Depends on globals from app.js and line-items.js for catalog lookup,
// active line item state, and shared formatting constants.
function normalizeCommentLineText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

// A door's lite count now lives in Panel Style (e.g. "3 Lite") -- the old
// standalone Lites/Glass field was dropped from the door editor as a
// redundant, independently-editable duplicate of the same value. Falls
// back to the legacy item.glass value (e.g. "3 LT") for older orders saved
// before Panel Style existed.
function doorLitesText(item) {
    const panelStyleMatch = /^(\d+)\s*Lite$/i.exec(String(item.panel_style || '').trim());
    if (panelStyleMatch) return `${panelStyleMatch[1]} LT`;
    return item.glass || '';
}

function wrapLineWithoutBreakingWords(text, maxChars) {
    const normalized = normalizeCommentLineText(text);
    if (!normalized) return [];

    const words = normalized.split(' ').filter(Boolean);
    const lines = [];
    let current = '';

    words.forEach(word => {
        if (!current) {
            if (word.length <= maxChars) {
                current = word;
            } else {
                // Extremely long tokens get hard-chunked as a fallback.
                for (let i = 0; i < word.length; i += maxChars) {
                    lines.push(word.slice(i, i + maxChars));
                }
                current = '';
            }
            return;
        }

        const candidate = `${current} ${word}`;
        if (candidate.length <= maxChars) {
            current = candidate;
            return;
        }

        lines.push(current);
        if (word.length <= maxChars) {
            current = word;
        } else {
            for (let i = 0; i < word.length; i += maxChars) {
                lines.push(word.slice(i, i + maxChars));
            }
            current = '';
        }
    });

    if (current) lines.push(current);
    return lines;
}

function formatAs400CommentLinesForLimit(rawLines, maxLines = PREFIT_COMMENT_MAX_LINES, maxChars = PREFIT_COMMENT_MAX_CHARS_PER_LINE) {
    const lines = [];
    rawLines.forEach(line => {
        const wrapped = wrapLineWithoutBreakingWords(line, maxChars);
        wrapped.forEach(part => {
            if (lines.length < maxLines) {
                lines.push(part);
            }
        });
    });
    return lines.slice(0, maxLines);
}

function formatPrefitCommentLinesForLimit(rawLines, maxLines = PREFIT_COMMENT_MAX_LINES, maxChars = PREFIT_COMMENT_MAX_CHARS_PER_LINE) {
    return formatAs400CommentLinesForLimit(rawLines, maxLines, maxChars);
}

function buildFormattedPrefitComment(doorItem) {
    if (!doorItem) return '';

    const hingePositions = [
        String(doorItem.prefit_hinge_top || '').trim(),
        String(doorItem.prefit_hinge_middle || '').trim(),
        String(doorItem.prefit_hinge_bottom || '').trim(),
    ].filter(Boolean).join(', ');

    const hingeSpecs = [
        doorItem.prefit_hinge_width ? `${doorItem.prefit_hinge_width} WIDE` : '',
        doorItem.prefit_hinge_backset ? `${doorItem.prefit_hinge_backset} BACK SET` : '',
        String(doorItem.prefit_hinge_prep || '').trim(),
    ].filter(Boolean).join(', ');

    const boreType = String(doorItem.prefit_bore_type || '').trim().toUpperCase();
    const boreLabel = boreType === 'SINGLE' ? 'SINGLE BORE:' : 'DOUBLE BORE:';
    const boreValues = boreType === 'SINGLE'
        ? [String(doorItem.prefit_bore_single || '').trim()].filter(Boolean)
        : [String(doorItem.prefit_bore_top || '').trim(), String(doorItem.prefit_bore_bottom || '').trim()].filter(Boolean);
    const swing = String(doorItem.prefit_swing || '').trim().toUpperCase();
    const boreDiameter = String(doorItem.prefit_bore_diameter || '2 1/8"').trim();
    const boreDiameterText = boreDiameter ? `${boreDiameter} DIA` : '';
    const boreLine = [boreLabel, boreValues.join(', '), boreDiameterText, swing].filter(Boolean).join(' ');

    const rawLines = [
        'PREFIT DOOR SLAB ONLY',
        'HINGE LOCATIONS:',
        hingePositions,
        hingeSpecs,
        boreLine,
    ].filter(line => normalizeCommentLineText(line));

    const safeLines = formatPrefitCommentLinesForLimit(rawLines);
    return safeLines.join('\n');
}

function normalizeMacroText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

const AS400_COMMENT_FIELD_PREFS_STORAGE_KEY = 'as400CommentFieldPrefs';
const DEFAULT_AS400_COMMENT_FIELD_PREFS = {
    room: true,
    vendor: true,
    series: true,
    style: true,
    material: true,
    finType: true,
    color: true,
    glass: true,
    argon: true,
    temperedGlass: true,
    handing: true,
    jamb: true,
    swing: true,
    notes: true
};

function getAs400CommentFieldPrefs() {
    try {
        const raw = window.localStorage.getItem(AS400_COMMENT_FIELD_PREFS_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_AS400_COMMENT_FIELD_PREFS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_AS400_COMMENT_FIELD_PREFS, ...parsed };
    } catch (err) {
        return { ...DEFAULT_AS400_COMMENT_FIELD_PREFS };
    }
}

function setAs400CommentFieldPrefs(prefs) {
    const merged = { ...DEFAULT_AS400_COMMENT_FIELD_PREFS, ...(prefs || {}) };
    window.localStorage.setItem(AS400_COMMENT_FIELD_PREFS_STORAGE_KEY, JSON.stringify(merged));
    return merged;
}

function refreshAllAs400CommentPreviews() {
    if (!Array.isArray(currentLineItems)) return;
    currentLineItems.forEach((_, index) => refreshAs400CommentPreview(index));
}

function windowColorCommentText(item) {
    const exterior = normalizeMacroText(macroItemValue(item, 'exterior_color', 'ext_color', 'exterior_finish'));
    const interior = normalizeMacroText(macroItemValue(item, 'interior_color', 'int_color', 'interior_finish'));
    const legacy = normalizeMacroText(macroItemValue(item, 'color'));
    const ext = exterior || legacy;
    const intColor = interior || legacy;

    if (!ext && !intColor) return '';
    if (ext && intColor && ext.toLowerCase() === intColor.toLowerCase()) {
        return `EXT/INT: ${ext}`;
    }
    return [ext ? `EXT: ${ext}` : '', intColor ? `INT: ${intColor}` : ''].filter(Boolean).join(' ');
}
function macroItemValue(item, ...keys) {
    if (!item || typeof item !== 'object') return '';

    for (const key of keys) {
        const value = normalizeMacroText(item[key]);
        if (value) return value;
    }

    const nestedMaps = [item.config_values, item.configured_values, item.configuration, item.config];
    for (const nested of nestedMaps) {
        if (!nested || typeof nested !== 'object') continue;
        for (const key of keys) {
            const value = normalizeMacroText(nested[key]);
            if (value) return value;
        }
    }

    return '';
}

function sanitizeVendorSku(value) {
    const cleaned = String(value || '').trim();
    if (!cleaned) return '';
    return cleaned;
}

function getBypassDoorSkuForCtrlAltS(item) {
    if (macroItemType(item) !== 'door') return '';

    const bypassText = [
        item?.style,
        item?.door_style,
        item?.door_type,
        item?.series,
        item?.model,
        item?.product,
    ].map(value => normalizeMacroText(value).toLowerCase()).join(' ');
    if (!bypassText.includes('bypass')) return '';

    const countText = normalizeMacroText(item?.door_count).toLowerCase();
    if (countText.includes('triple') || bypassText.includes('triple')) return '663615';
    return '663614';
}
function resolveVendorSkuForCtrlAltS(item) {
    const bypassSku = getBypassDoorSkuForCtrlAltS(item);
    if (bypassSku) return bypassSku;

    const vendorName = normalizeMacroText(item?.vendor).toLowerCase();

    const explicitSku = sanitizeVendorSku(item?.vendor_sku) || sanitizeVendorSku(item?.sku);
    if (explicitSku) return explicitSku;

    if (vendorName) {
        const skuFromVendor = sanitizeVendorSku(getVendorSkuForName(vendorName));
        if (skuFromVendor) return skuFromVendor;

        // If this item is missing SKU, reuse any SKU already present on another
        // line item for the same vendor in the active editor state.
        const siblingSku = (Array.isArray(currentLineItems) ? currentLineItems : [])
            .find(candidate => normalizeMacroText(candidate?.vendor).toLowerCase() === vendorName && sanitizeVendorSku(candidate?.vendor_sku || candidate?.sku))
            ?.vendor_sku;
        if (sanitizeVendorSku(siblingSku)) return sanitizeVendorSku(siblingSku);
    }

    // Fall back to order-level vendor SKU used by automation launch payload.
    const selected = getSelectedOrder ? (getSelectedOrder() || null) : null;
    const orderSku = sanitizeVendorSku(currentOrder?.vendor_sku) || sanitizeVendorSku(selected?.vendor_sku);
    if (orderSku) return orderSku;

    return '';
}

function macroItemType(item) {
    const rawType = String(item?.type || item?.item_type || item?.product || '').trim().toLowerCase();
    if (rawType.includes('install')) return 'install';
    if (rawType.includes('hardware')) return 'hardware';
    return rawType.includes('window') ? 'window' : 'door';
}

function ensureInchesToken(value) {
    const token = normalizeMacroText(value);
    if (!token) return '';
    const lowered = token.toLowerCase();
    if (lowered.includes('"') || lowered.includes("'") || lowered.includes('in') || lowered.includes('mm') || lowered.includes('cm')) {
        return token;
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) return `${token}"`;
    return token;
}

function windowSizeText(item) {
    const callout = normalizeMacroText(macroItemValue(item, 'callout_size', 'size'));
    if (callout) {
        const compact = callout.replace(/\s+/g, '');
        if (/^\d{3,5}$/.test(compact)) return compact;
        if (callout.toLowerCase().includes('x') || callout.includes('"')) return callout;
    }

    const width = macroItemValue(item, 'width', 'ro_width', 'rough_opening_width');
    const height = macroItemValue(item, 'height', 'ro_height', 'rough_opening_height');
    if (width && height) return `${ensureInchesToken(width)} x ${ensureInchesToken(height)}`;
    return '';
}

function windowHandingText(item) {
    const raw = normalizeMacroText(macroItemValue(item, 'operation', 'operation_style', 'handing', 'swing'));
    if (!raw) return '';
    const lowered = raw.toLowerCase();
    if (lowered === 'single hung') return 'SH';
    if (lowered === 'double hung') return 'DH';
    if (lowered === 'slider') return 'XO';

    const compact = raw.replace(/\s+/g, '').toUpperCase();
    if (/^[A-Z]{2,4}$/.test(compact)) return compact;
    return raw;
}

function sizeModePrefixText(item) {
    const sizeMode = String(item?.size_mode || '').trim().toLowerCase();
    if (sizeMode === 'rough_opening') return 'RO';
    if (sizeMode === 'net_size') return 'NF';
    return '';
}

function doorSizeText(item) {
    const raw = normalizeMacroText(macroItemValue(item, 'callout_size', 'size'));
    const compact = raw.replace(/\s+/g, '');
    if (compact && /^\d{4}$/.test(compact)) return `${compact[0]}/${compact[1]} ${compact[2]}/${compact[3]}`;
    if (raw && raw.includes('/')) return raw;

    const width = macroItemValue(item, 'width');
    const height = macroItemValue(item, 'height');
    if (width && height) return `${normalizeMacroText(width)} x ${normalizeMacroText(height)}`;
    return '';
}

function doorThicknessText(item) {
    const raw = normalizeMacroText(macroItemValue(item, 'door_thickness', 'thickness', 'prefit_thickness'));
    if (!raw) return '';
    const lowered = raw.toLowerCase().replace(/"/g, '').replace(/\s+/g, '');
    if (lowered === '1-3/8' || lowered === '13/8') return '1-3/8';
    if (lowered === '1-3/4' || lowered === '13/4') return '1-3/4';
    return raw;
}

function abbreviateDescriptionTerms(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return '';
    return cleaned
        .replace(/\bfiberglass\b/gi, 'FB')
        .replace(/\bprimed\b/gi, 'PRM')
        .replace(/\bshaker\b/gi, 'SHK');
}

function stripPrehungWords(text) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return '';
    return cleaned
        .replace(/\bpre\s*-?\s*hung\b/gi, '')
        .replace(/\bpre\s*-?\s*hang\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function doorTypeShorthand(styleText) {
    const text = String(styleText || '').trim().toLowerCase();
    if (!text) return '';
    if (text.includes('bypass')) return 'BYPASS';
    if (text.includes('bifold')) return 'BF';
    if (text.includes('french')) return 'FR';
    if (text.includes('prehung') || text.includes('prehang')) return 'PH';
    return '';
}

function isBypassDoorDescription(item) {
    if (macroItemType(item) !== 'door') return false;
    return [
        item?.style,
        item?.door_style,
        item?.door_type,
        item?.series,
        item?.model,
        item?.product,
    ].some(value => normalizeMacroText(value).toLowerCase().includes('bypass'));
}


function isHardwareOnlyStyleForDoor(item, rawStyle) {
    if (macroItemType(item) !== 'door') return false;
    const normalized = normalizeMacroText(rawStyle).toLowerCase();
    if (!normalized) return false;

    const hardwareSpecific = [
        item?.hardware_lever_knob_style,
        item?.hardware_function,
        item?.hardware_product_code,
    ].some(value => normalizeMacroText(value).toLowerCase() === normalized);
    if (hardwareSpecific) return true;

    if (typeof getStyleOptionsForType !== 'function') return false;
    const hardwareStyles = getStyleOptionsForType('hardware')
        .map(value => normalizeMacroText(value).toLowerCase())
        .filter(Boolean);
    if (!hardwareStyles.includes(normalized)) return false;

    const doorStyles = getStyleOptionsForType('door')
        .map(value => normalizeMacroText(value).toLowerCase())
        .filter(Boolean);
    return !doorStyles.includes(normalized);
}
function bypassDoorSizeText(item) {
    const sizeText = doorSizeText(item);
    const sizeMode = String(item?.size_mode || '').trim().toLowerCase();
    // Net size / rough opening measurements are actual width x height dimensions and
    // need the "x" to stay readable. Callout codes (e.g. "2/4 6/8") never had an "x"
    // to begin with, so this only strips it for that compact format.
    if (sizeMode === 'net_size' || sizeMode === 'rough_opening') {
        return sizeText.replace(/\s+/g, ' ').trim();
    }
    return sizeText.replace(/\s+x\s+/gi, ' ').replace(/\s+/g, ' ').trim();
}

function bypassJambSizeText(item) {
    const raw = normalizeMacroText(macroItemValue(item, 'jamb_size'));
    if (!raw) return '';
    return raw.replace(/\s+/g, '-').replace(/-{2,}/g, '-');
}

function buildBypassDoorCommentLines(item) {
    const jambSize = bypassJambSizeText(item);
    const lines = [];
    if (jambSize) lines.push(`${jambSize} PRM FJ INT Bypass Jambs`);
    lines.push('Bore only for finger pulls');
    lines.push('w/cox tracks & BB rollers');
    lines.push('STD floor guides');
    return lines;
}
function seriesDescriptionText(item) {
    const raw = normalizeMacroText(macroItemValue(item, 'series'));
    if (!raw) return '';
    const match = raw.match(/\bV\d{3}\b/i);
    return match ? match[0].toUpperCase() : '';
}
function doorCoreDescriptionText(item) {
    const raw = normalizeMacroText(macroItemValue(item, 'core', 'core_type', 'slab_core'));
    if (!raw) return '';
    const lowered = raw.toLowerCase();
    if (['hc', 'hollow', 'hollow core', 'hollowcore'].includes(lowered)) return 'HC';
    if (['sc', 'solid', 'solid core', 'solidcore'].includes(lowered)) return 'SC';
    return raw.toUpperCase();
}

function doorMaterialDescriptionText(item) {
    const material = abbreviateDescriptionTerms(normalizeMacroText(macroItemValue(item, 'prm_df', 'species', 'finish', 'material')));
    if (!material) return '';
    const lowered = material.toLowerCase();
    if (['primed', 'painted', 'prime', 'paint', 'prm'].includes(lowered)) return 'PRM';
    if (lowered.includes('douglas') && lowered.includes('fir')) return 'DF';
    if (lowered === 'df') return 'DF';
    if (lowered.includes('fiberglass')) return 'FB';
    return material.length <= 4 ? material.toUpperCase() : material;
}

function doorStyleDescriptionText(item) {
    const raw = normalizeMacroText(macroItemValue(item, 'style', 'panel', 'panel_style'));
    if (!raw) return '';
    if (isBypassDoorDescription(item)) return '';
    if (isHardwareOnlyStyleForDoor(item, raw)) return '';
    const cleaned = stripPrehungWords(raw);
    if (cleaned.toLowerCase() === 'slab') return 'SLB';
    return cleaned.toUpperCase();
}

function doorStickingDescriptionText(item) {
    const sticking = abbreviateDescriptionTerms(normalizeMacroText(macroItemValue(item, 'sticking', 'profile', 'sticking_profile')));
    if (!sticking) return '';
    return sticking.toUpperCase();
}

function doorIsPrehungDescription(item) {
    const cfg = normalizeMacroText(macroItemValue(item, 'door_configuration', 'configuration', 'config'));
    const rawStyle = macroItemValue(item, 'style');
    const style = isHardwareOnlyStyleForDoor(item, rawStyle) ? '' : normalizeMacroText(rawStyle);
    const model = normalizeMacroText(macroItemValue(item, 'model'));
    const text = [cfg, style, model].filter(Boolean).join(' ').toLowerCase();
    return text.includes('prehung') || text.includes('prehang') || /\bph\b/.test(text);
}

function buildCtrlAltSDescription(item) {
    if (!item || typeof item !== 'object') return '';

    const itemType = macroItemType(item);
    if (itemType === 'install') {
        return 'DeCamp Install';
    }
    if (itemType === 'hardware') {
        return [
            normalizeMacroText(item.hardware_product_code),
            normalizeMacroText(item.hardware_lever_knob_style),
            normalizeMacroText(item.hardware_finish_code || item.hardware_finish),
            normalizeMacroText(item.hardware_handing)
        ].filter(Boolean).join(' ').slice(0, 36);
    }
    if (itemType === 'window') {
        const size = [sizeModePrefixText(item), windowSizeText(item)].filter(Boolean).join(' ');
        const series = seriesDescriptionText(item);
        const operation = windowHandingText(item);
        return [size, operation, series].filter(Boolean).join(' ').slice(0, 36);
    }

    const sizeToken = [
        sizeModePrefixText(item),
        isBypassDoorDescription(item) ? bypassDoorSizeText(item) : doorSizeText(item),
    ].filter(Boolean).join(' ');
    const thickness = doorThicknessText(item);
    const core = doorCoreDescriptionText(item);
    const series = seriesDescriptionText(item);
    const model = series || stripPrehungWords(normalizeMacroText(macroItemValue(item, 'model', 'series')));
    const material = doorMaterialDescriptionText(item);
    const style = series ? '' : doorStyleDescriptionText(item);
    const sticking = doorStickingDescriptionText(item);
    const styleToken = doorTypeShorthand(isHardwareOnlyStyleForDoor(item, item.style) ? macroItemValue(item, 'door_style', 'door_type') : macroItemValue(item, 'style', 'door_style', 'door_type'));
    const prehung = doorIsPrehungDescription(item) ? 'PH' : '';

    if (styleToken === 'BYPASS') {
        // model/series can literally be "Bypass" (carried over from the style field),
        // which would duplicate the trailing BYPASS shorthand. Only keep it if it's a
        // real series/model name.
        const modelToken = model && !model.toLowerCase().includes('bypass') ? model : '';
        return [sizeToken, thickness, modelToken, material, sticking, styleToken].filter(Boolean).join(' ').slice(0, 36);
    }

    return [sizeToken, thickness, core, model, material, style, sticking, prehung].filter(Boolean).join(' ').slice(0, 36);
}

function buildBomCommentParts(item) {
    if (!item || !item.bom_enabled) return [];

    const lines = [];
    const clean = (value) => {
        const normalized = normalizeMacroText(value);
        if (!normalized) return '';
        const lowered = normalized.toLowerCase();
        if (lowered === 'none' || lowered === 'n/a' || lowered === 'na' || lowered === 'null') return '';
        return normalized;
    };
    const joinClean = (values, separator = ' ') => values.map(clean).filter(Boolean).join(separator);
    const pushLine = (label, value) => {
        const text = clean(value);
        if (text) lines.push(`${label}: ${text}`);
    };

    // 2. Modifiers / Custom Specs
    pushLine('MODS', item.bom_modifiers);
    // 3. Door Slabs
    pushLine('SLABS', item.bom_door_slabs);
    // 4. Handing (shared with swing)
    pushLine('HANDING', item.swing || item.prefit_swing);
    // 5. Jamb/Frame + spec
    pushLine('JAMB/FRAME', joinClean([item.bom_jamb_frame, item.bom_jamb_frame_spec], ' '));

    // 6. Bore type + measurements
    const boreType = clean(item.bom_bore_type);
    const boreText = boreType && boreType.toLowerCase() === 'double'
        ? joinClean([
            boreType,
            clean(item.bom_bore_top) ? `TOP ${clean(item.bom_bore_top)}` : '',
            clean(item.bom_bore_bottom) ? `BOT ${clean(item.bom_bore_bottom)}` : '',
        ], ' ')
        : joinClean([boreType, item.bom_bore_measurements], ' ');
    pushLine('BORE', boreText);

    // 7. Hinge specs + finish
    const hingeLocations = [
        ['TOP', item.bom_hinge_top],
        ['MID', item.bom_hinge_middle],
        ['BOT', item.bom_hinge_bottom],
    ]
        .map(([label, value]) => {
            const text = clean(value);
            return text ? `${label} ${text}` : '';
        })
        .filter(Boolean)
        .join(', ');
    const hingeWidth = clean(item.bom_hinge_width);
    const hingeLine = joinClean([hingeLocations, hingeWidth ? `WIDTH ${hingeWidth}` : ''], ' ');
    if (hingeLine) {
        lines.push('HINGE:');
        lines.push(hingeLine);
    }
    pushLine('Hinges', item.bom_hinge_finish);

    // 8. Q-lon or None (+ color)
    const qLonSelected = String(item.bom_q_lon || '').trim().toLowerCase() === 'q-lon';
    if (qLonSelected) {
        const qLonColor = clean(item.bom_q_lon_color);
        lines.push(qLonColor ? `Q-lon (${qLonColor})` : 'Q-lon');
    }

    // 9. Sill/Threshold + finish
    const sillText = joinClean([item.bom_sill_threshold, item.bom_sill_finish], ' / ');
    if (sillText) lines.push(`SILL/THRESH: ${sillText}`);

    // 10. Door Bottom + finish
    const doorBottomText = joinClean([item.bom_door_bottom, item.bom_door_bottom_finish], ' / ');
    if (doorBottomText) lines.push(`DOOR BOTTOM: ${doorBottomText}`);

    // 11. T Astragal / Ball Catch / Flush Pulls
    const hardware = [];
    if (item.bom_t_astragal) hardware.push('T-Ast');
    if (item.bom_ball_catch) hardware.push('Ball Catch');
    const flushPullsFinish = clean(item.bom_flush_pulls_finish);
    if (flushPullsFinish) hardware.push(`Flush Pulls${flushPullsFinish.toLowerCase() === 'selected' ? '' : ` ${flushPullsFinish}`}`);
    if (hardware.length > 0) lines.push(hardware.join(', '));

    // 12. Casing/Ext Trim
    pushLine('CASING/EXT TRIM', item.bom_casing_ext_trim);

    return lines;
}

function buildBomCommentText(item) {
    return buildBomCommentParts(item).join(' | ');
}

function resolveUmForCtrlAltS(item) {
    if (!item) return 'EA';
    if (Boolean(item.no_cost)) return 'NC';

    const explicitUm = String(item.um || '').trim().toUpperCase();
    return explicitUm || 'EA';
}

function buildCtrlAltSSequencePreview(item) {
    if (!item) return '';

    const previewItem = (typeof mapLineItemForAs400Automation === 'function')
        ? mapLineItemForAs400Automation(item)
        : item;
    const quantity = Number.parseInt(previewItem.quantity || '1', 10) || 1;
    const descriptionText = buildCtrlAltSDescription(previewItem);
    const skuText = resolveVendorSkuForCtrlAltS(previewItem);
    const umText = resolveUmForCtrlAltS(previewItem);
    const priceText = String(previewItem.price != null && previewItem.price !== '' ? previewItem.price : (previewItem.unit_price != null && previewItem.unit_price !== '' ? previewItem.unit_price : '')).trim();

    return [
        'Ctrl+Alt+S Fields:',
        `SKU: ${skuText || '(blank)'}`,
        `Description: ${descriptionText || '(blank)'}`,
        `U/M: ${umText}`,
        `Price: ${priceText || '(blank)'}`,
        `Qty: ${quantity}`,
    ].join('\n');
}
function buildStandardAs400CommentPreview(item) {
    if (!item) return '';

    const prefs = getAs400CommentFieldPrefs();
    const parts = [];
    const notes = prefs.notes ? normalizeMacroText(item.notes) : '';
    const cleanOptionalText = (value) => {
        const clean = normalizeMacroText(value);
        if (!clean) return '';
        const lowered = clean.toLowerCase();
        if (lowered === 'none' || lowered === 'n/a' || lowered === 'na' || lowered === 'null') return '';
        return clean;
    };
    const roomText = prefs.room ? cleanOptionalText(item.room || item.location) : '';
    const roomLine = roomText ? `ROOM: ${roomText}` : '';

    if (item.type === 'install') {
        // "DeCamp Install" already appears in the Ctrl+Alt+S Description
        // field below (see buildCtrlAltSDescription) - no need to repeat it
        // here as a leading comment line too.
        return [roomLine, notes].filter(Boolean).join('\n');
    }

    if (item.type === 'hardware') {
        const hardwareLine = [
            cleanOptionalText(item.style || item.hardware_function),
            cleanOptionalText(item.hardware_backset),
            cleanOptionalText(item.hardware_keying)
        ].filter(Boolean).join(' | ');
        return [roomLine, hardwareLine, notes].filter(Boolean).join('\n');
    }

    if (item.type === 'door') {
        if (isBypassDoorDescription(item)) {
            const bypassLines = buildBypassDoorCommentLines(item);
            if (roomLine) bypassLines.unshift(roomLine);
            if (notes) bypassLines.push(notes);
            return bypassLines.join('\n');
        }

        if (roomLine) parts.push(roomLine);

        const doorVendor = prefs.vendor ? normalizeMacroText(item.vendor) : '';
        const doorSeries = prefs.series ? normalizeMacroText(item.series || item.model) : '';
        const doorStyle = prefs.style ? normalizeMacroText(item.style) : '';
        const doorMaterial = prefs.material ? normalizeMacroText(item.material) : '';
        const doorColorText = prefs.color ? windowColorCommentText(item) : '';
        const catalogParts = [doorVendor, doorSeries, doorStyle, doorMaterial, doorColorText].filter(Boolean);
        if (catalogParts.length > 0) parts.push(catalogParts.join(' | '));

        const jambSize = normalizeMacroText(item.jamb_size);
        const swing = normalizeMacroText(item.swing || item.prefit_swing);
        const lites = normalizeMacroText(doorLitesText(item));
        const slabs = cleanOptionalText(item.bom_door_slabs);
        const mods = cleanOptionalText(item.bom_modifiers);
        const jambFrame = cleanOptionalText([item.bom_jamb_frame, item.bom_jamb_frame_spec].filter(Boolean).join(' '));

        const boreType = cleanOptionalText(item.bom_bore_type);
        const boreText = boreType && boreType.toLowerCase() === 'double'
            ? cleanOptionalText([
                boreType,
                cleanOptionalText(item.bom_bore_top) ? `TOP ${cleanOptionalText(item.bom_bore_top)}` : '',
                cleanOptionalText(item.bom_bore_bottom) ? `BOT ${cleanOptionalText(item.bom_bore_bottom)}` : '',
            ].filter(Boolean).join(' '))
            : cleanOptionalText([
                boreType,
                cleanOptionalText(item.bom_bore_measurements),
            ].filter(Boolean).join(' '));

        const hingeLocations = [
            ['TOP', item.bom_hinge_top],
            ['MID', item.bom_hinge_middle],
            ['BOT', item.bom_hinge_bottom],
        ]
            .map(([label, value]) => {
                const clean = cleanOptionalText(value);
                return clean ? `${label} ${clean}` : '';
            })
            .filter(Boolean)
            .join(', ');
        const hingeWidth = cleanOptionalText(item.bom_hinge_width);
        const hingeFinish = cleanOptionalText(item.bom_hinge_finish);
        const qLonSelected = String(item.bom_q_lon || '').trim().toLowerCase() === 'q-lon';
        const qLonColor = cleanOptionalText(item.bom_q_lon_color);
        const qLonText = qLonSelected
            ? (`Q-lon${qLonColor ? ` ${qLonColor}` : ''}`)
            : '';

        const sillType = cleanOptionalText(item.bom_sill_threshold);
        const sillFinish = cleanOptionalText(item.bom_sill_finish);
        const sillPrefix = sillType || 'Sill';

        const hardwareParts = [];
        if (item.bom_t_astragal) hardwareParts.push('T-Ast');
        if (item.bom_ball_catch) hardwareParts.push('Ball Catch');
        const flushFinish = cleanOptionalText(item.bom_flush_pulls_finish);
        if (flushFinish) hardwareParts.push(`Flush Pulls${flushFinish.toLowerCase() === 'selected' ? '' : ` ${flushFinish}`}`);

        const litesToken = prefs.glass && lites && lites.toLowerCase() !== 'none' ? `LITES: ${lites}` : '';
        const slabsToken = slabs ? `SLABS: ${slabs}` : '';
        const swingToken = prefs.swing && swing ? `SWING: ${swing}` : '';
        const jambToken = prefs.jamb && jambSize ? `JAMB: ${jambSize}` : '';
        const sideliteToken = item.sidelites ? `SL: ${item.sidelites}` : '';
        const transomToken = item.transom === true || item.transom === 'Yes' ? 'TRANSOM' : '';

        const firstLine = [
            litesToken,
            slabsToken,
            sideliteToken,
            transomToken
        ].filter(Boolean).join(' | ');
        const secondLine = [swingToken, jambToken].filter(Boolean).join(' | ');

        if (firstLine) parts.push(firstLine);
        if (secondLine) parts.push(secondLine);
        if (mods) parts.push(`MODS: ${mods}`);
        if (jambFrame) parts.push(`JAMB/FRAME: ${jambFrame}`);
        if (boreText) parts.push(`BORE: ${boreText}`);
        if (hingeLocations || hingeWidth) {
            parts.push('HINGE:');
            if (hingeLocations) {
                // Keep hinge location lines AS400-friendly (30 chars max per line).
                const hingeLocationLines = wrapLineWithoutBreakingWords(hingeLocations, PREFIT_COMMENT_MAX_CHARS_PER_LINE);
                parts.push(...hingeLocationLines);
            }
            if (hingeWidth) {
                parts.push(`HINGE WIDTH ${hingeWidth}`);
            }
        }

        const hingesLineParts = [hingeFinish, qLonText].filter(Boolean);
        if (hingesLineParts.length > 0) {
            parts.push(`Hinges: ${hingesLineParts.join(', ')}`);
        }

        const sillAndHardwareParts = [];
        if (sillType || sillFinish) {
            sillAndHardwareParts.push(sillFinish ? `${sillPrefix}: ${sillFinish}` : `${sillPrefix}`);
        }
        sillAndHardwareParts.push(...hardwareParts);
        if (sillAndHardwareParts.length > 0) {
            parts.push(sillAndHardwareParts.join(', '));
        }

        const doorBottom = cleanOptionalText(item.bom_door_bottom);
        const doorBottomFinish = cleanOptionalText(item.bom_door_bottom_finish);
        if (doorBottom || doorBottomFinish) {
            parts.push(`DOOR BOTTOM: ${[doorBottom, doorBottomFinish].filter(Boolean).join(' / ')}`);
        }

        const casingTrim = cleanOptionalText(item.bom_casing_ext_trim);
        if (casingTrim) parts.push(`CASING/EXT TRIM: ${casingTrim}`);

        if (notes) parts.push(notes);
        const spaceText = cleanOptionalText(item.bom_space);
        if (spaceText) parts.push(`SPACE: ${spaceText}`);
    } else {
        const handing = prefs.handing ? normalizeMacroText(item.operation || item.handing) : '';
        const glass = prefs.glass ? normalizeMacroText(item.glass) : '';
        const temperedGlass = prefs.temperedGlass ? Boolean(item.tempered_glass) : false;
        const finType = prefs.finType ? normalizeMacroText(item.fin_type) : '';
        const vendor = prefs.vendor ? normalizeMacroText(item.vendor) : '';
        const colorText = prefs.color ? windowColorCommentText(item) : '';
        const argon = prefs.argon ? normalizeMacroText(item.argon) : '';
        const isGableWindow = String(item.style || '').trim().toLowerCase() === 'gable';
        const gableWidth = normalizeMacroText(item.width);
        const gableTallSide = normalizeMacroText(item.gable_tall_side || item.height);
        const gableShortSide = normalizeMacroText(item.gable_short_side);

        if (isGableWindow) {
            const gableLines = [];
            if (roomLine) gableLines.push(roomLine);
            if (vendor) gableLines.push(vendor);
            if (gableWidth) gableLines.push(`GABLE W ${gableWidth}`);
            if (gableTallSide) gableLines.push(`TALL ${gableTallSide}`);
            if (gableShortSide) gableLines.push(`SHORT ${gableShortSide}`);
            if (finType) gableLines.push(FIN_TYPE_DISPLAY[finType] || finType);
            if (colorText) gableLines.push(colorText);
            const glassLineParts = [];
            if (glass && glass.toLowerCase() !== 'none') glassLineParts.push(`GLASS: ${glass}`);
            if (argon) glassLineParts.push(argon);
            if (temperedGlass) glassLineParts.push('TEMPERED');
            if (glassLineParts.length > 0) gableLines.push(glassLineParts.join(' '));
            if (handing) gableLines.push(`HANDING: ${handing}`);
            if (notes) gableLines.push(notes);
            return gableLines.join('\n');
        }

        if (vendor) parts.push(`${vendor}`);
        if (finType) {
            const displayFin = FIN_TYPE_DISPLAY[finType] || finType;
            parts.push(displayFin);
        }
        if (colorText) parts.push(colorText);
        if (glass && glass.toLowerCase() !== 'none') parts.push(`GLASS: ${glass}`);
        if (argon) parts.push(argon);
        if (temperedGlass) parts.push('TEMPERED');
        if (handing) parts.push(`HANDING: ${handing}`);
        if (notes) parts.push(notes);
    }

    if (item.type === 'hardware') {
        const hardwareLine = [
            cleanOptionalText(item.style || item.hardware_function),
            cleanOptionalText(item.hardware_backset),
            cleanOptionalText(item.hardware_keying)
        ].filter(Boolean).join(' | ');
        return [roomLine, hardwareLine, notes].filter(Boolean).join('\n');
    }

    if (item.type === 'door') {
        return parts.join('\n');
    }

    return [roomLine, ...formatAs400CommentLinesForLimit([parts.join(' | ')])].filter(Boolean).join('\n');
}

function buildAs400CommentPreview(item) {
    if (!item) return '';

    const previewItem = (typeof mapLineItemForAs400Automation === 'function')
        ? mapLineItemForAs400Automation(item)
        : item;
    const rawCommentText = item.type === 'door' && item.prefit_enabled
        ? buildFormattedPrefitComment(item)
        : buildStandardAs400CommentPreview(item);
    const commentText = formatAs400CommentLinesForLimit(
        String(rawCommentText || '').split(/\r?\n/).filter(line => String(line || '').trim()),
        PREFIT_COMMENT_MAX_LINES,
        PREFIT_COMMENT_MAX_CHARS_PER_LINE
    ).join('\n');

    const ctrlAltSPreview = buildCtrlAltSSequencePreview(previewItem);

    if (commentText && ctrlAltSPreview) {
        return `${commentText}\n\n--- Ctrl+Alt+S Preview ---\n${ctrlAltSPreview}`;
    }

    return commentText || ctrlAltSPreview;
}
function refreshAs400CommentPreview(index) {
    const item = currentLineItems[index];
    if (!item) return;

    const previewElement = lineItemsList
        ? lineItemsList.querySelector(`[data-as400-preview="${index}"]`)
        : null;
    if (!previewElement) return;

    previewElement.value = buildAs400CommentPreview(item);
}




