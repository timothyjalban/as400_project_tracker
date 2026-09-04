// Order Tracker - user-editable line-item dropdown choices + field labels.
//
// The DB (line_item_field_options / line_item_field_labels, via
// blueprints/field_config.py) is the source of truth for every "managed"
// line-item dropdown. This module loads that config on startup, caches it, and
// exposes the read helpers the editor renderer + AS400 builders consult:
//
//   fieldConfigOptions(key, scope, currentValue) -> [{value,label}]
//   fieldLabel(key, scope)                       -> string
//   optionAs400Text(key, value, scope)           -> string | null
//
// plus the inline "edit choices" mini-editor and the "Line-Item Fields"
// settings screen. Factory defaults (the one-time DB seed) live in
// data/line_item_field_defaults.json.

let LINE_ITEM_FIELD_CONFIG = { options: {}, labels: {} };

// Legacy localStorage lists folded into the generic table (see
// line-item-options.js). key = field_key, value = the old storage key.
const FIELD_CONFIG_LEGACY_LOCALSTORAGE = {
    operation: 'order_tracker_window_handing_options',
    jamb_size: 'order_tracker_jamb_size_options',
    door_location: 'doorlocationoptions',
    prefit_bore_diameter: 'order_tracker_prefit_bore_diameter_options',
    hardware_lever_knob_style: 'order_tracker_hardware_lever_knob_styles',
};

// Re-render the line-item editor if an order with items is open. `currentLineItems`
// is a bare top-level global in line-items.js (not on window).
function fieldConfigRerenderEditor() {
    let items;
    try { items = currentLineItems; } catch (e) { items = null; }
    if (typeof renderLineItemsEditor === 'function' && Array.isArray(items) && items.length) {
        renderLineItemsEditor();
    }
}

function fieldConfigManagedKeys() {
    return new Set(Object.keys(LINE_ITEM_FIELD_CONFIG.options || {}));
}

function isFieldConfigManaged(key) {
    return Object.prototype.hasOwnProperty.call(LINE_ITEM_FIELD_CONFIG.options || {}, key);
}

async function loadFieldConfig() {
    try {
        const res = await fetch(`${API_BASE}/line-item-field-config`);
        const data = await res.json();
        if (!data || !data.success) return;
        LINE_ITEM_FIELD_CONFIG = { options: data.options || {}, labels: data.labels || {} };
        await migrateLegacyLocalStorageOptionLists();
        fieldConfigRerenderEditor();
    } catch (err) {
        console.warn('Unable to load line-item field config; using registry fallback.', err);
    }
}

// One-time: push any values a browser saved to the old localStorage lists into
// the DB, then clear the key so it doesn't run again.
async function migrateLegacyLocalStorageOptionLists() {
    for (const [fieldKey, storageKey] of Object.entries(FIELD_CONFIG_LEGACY_LOCALSTORAGE)) {
        let stored;
        try { stored = window.localStorage.getItem(storageKey); } catch (e) { stored = null; }
        if (!stored) continue;
        let values;
        try { values = JSON.parse(stored); } catch (e) { values = null; }
        if (!Array.isArray(values) || values.length === 0) {
            try { window.localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
            continue;
        }
        const known = new Set(fieldConfigRows(fieldKey, '*').map(r => String(r.value).toLowerCase()));
        for (const raw of values) {
            const value = String(raw || '').trim();
            if (!value || known.has(value.toLowerCase())) continue;
            try {
                await fetch(`${API_BASE}/line-item-field-config/options`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ field_key: fieldKey, value }),
                });
            } catch (e) { /* best effort */ }
        }
        try { window.localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
    }
    // Re-pull once so the cache reflects any migrated values.
    try {
        const res = await fetch(`${API_BASE}/line-item-field-config`);
        const data = await res.json();
        if (data && data.success) {
            LINE_ITEM_FIELD_CONFIG = { options: data.options || {}, labels: data.labels || {} };
        }
    } catch (e) { /* ignore */ }
}

// ---- read helpers -------------------------------------------------------

function fieldConfigScopeMatch(rowScope, scope) {
    return !rowScope || rowScope === '*' || rowScope === scope;
}

// A row applies to an item if its vendor is blank (all vendors) or matches.
function fieldConfigVendorMatch(rowVendor, vendor) {
    if (!rowVendor) return true;
    return String(rowVendor).toLowerCase() === String(vendor || '').toLowerCase();
}

// All rows for a field+scope (every vendor) - used by the editors.
function fieldConfigRows(key, scope) {
    return (LINE_ITEM_FIELD_CONFIG.options[key] || [])
        .filter(r => fieldConfigScopeMatch(r.scope, scope))
        .slice()
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

// Active rows that apply to a given item (scope + vendor).
function fieldConfigActiveRows(key, scope, vendor) {
    return fieldConfigRows(key, scope).filter(r =>
        r.active && fieldConfigVendorMatch(r.vendor, vendor));
}

function fieldConfigHasRows(key, scope) {
    return fieldConfigRows(key, scope).some(r => r.active) || isFieldConfigManaged(key);
}

// All active choice values for a key, ignoring item scope (bulk-set: the target
// item type isn't known).
function fieldConfigChoiceValues(key) {
    return (LINE_ITEM_FIELD_CONFIG.options[key] || [])
        .filter(r => r.active)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(r => (r.label && r.label !== r.value ? { value: r.value, label: r.label } : r.value));
}

// [{value,label}] for a <select>; scoped to the item's vendor, with the current
// value prepended if it's no longer in the active set (mirrors
// seriesOptionsWithSelected in line-item-render.js). Vendor-specific rows sort
// after the generic ones.
function fieldConfigOptions(key, scope, currentValue, vendor) {
    const rows = fieldConfigActiveRows(key, scope, vendor)
        .slice()
        .sort((a, b) => (a.vendor ? 1 : 0) - (b.vendor ? 1 : 0) || (a.sort_order || 0) - (b.sort_order || 0));
    const opts = rows.map(r => ({ value: r.value, label: r.label || r.value }));
    const cur = currentValue == null ? '' : String(currentValue);
    if (cur && !opts.some(o => o.value.toLowerCase() === cur.toLowerCase())) {
        opts.unshift({ value: cur, label: cur });
    }
    return opts;
}

// DB label override, else `fallback` (the render label the caller already
// resolved - variant-aware), else the registry label, else the key.
function fieldLabel(key, scope, fallback) {
    const labels = LINE_ITEM_FIELD_CONFIG.labels || {};
    if (scope && labels[`${key}@${scope}`]) return labels[`${key}@${scope}`];
    if (labels[key]) return labels[key];
    if (fallback) return fallback;
    const f = typeof lineItemField === 'function' ? lineItemField(key) : null;
    if (!f) return key;
    const r = (f.render && f.render.variants) ? (f.render.variants[scope] || {}) : (f.render || {});
    return r.label || f.label || key;
}

function optionAs400Text(key, value, scope, vendor) {
    if (value == null || value === '') return null;
    const rows = (LINE_ITEM_FIELD_CONFIG.options[key] || []).filter(r =>
        String(r.value).toLowerCase() === String(value).toLowerCase()
        && fieldConfigScopeMatch(r.scope, scope));
    // Prefer a vendor-specific row over the generic one.
    const hit = rows.find(r => r.vendor && fieldConfigVendorMatch(r.vendor, vendor))
        || rows.find(r => !r.vendor);
    return hit && hit.as400_text ? hit.as400_text : null;
}

// ---- mutations (used by both editors) ---------------------------------

async function fieldConfigApply(cache) {
    if (cache && cache.success) {
        LINE_ITEM_FIELD_CONFIG = { options: cache.options || {}, labels: cache.labels || {} };
        fieldConfigRerenderEditor();
        if (typeof refreshAllAs400CommentPreviews === 'function') refreshAllAs400CommentPreviews();
    }
    return cache;
}

async function fieldConfigRequest(path, method, body) {
    const res = await fetch(`${API_BASE}/line-item-field-config${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) {
        if (typeof showError === 'function') showError(data.error || 'Field config update failed');
        throw new Error(data.error || 'field config update failed');
    }
    return fieldConfigApply(data);
}

const fieldConfigAddOption = (fieldKey, scope, value, opts = {}) =>
    fieldConfigRequest('/options', 'POST', { field_key: fieldKey, item_scope: scope || '*', value, ...opts });
const fieldConfigEditOption = (id, patch) =>
    fieldConfigRequest(`/options/${id}`, 'PUT', patch);
const fieldConfigDeleteOption = (id, hard = false) =>
    fieldConfigRequest(`/options/${id}${hard ? '?hard=1' : ''}`, 'DELETE');
const fieldConfigReorder = (fieldKey, scope, orderedIds) =>
    fieldConfigRequest('/options/reorder', 'PUT', { field_key: fieldKey, item_scope: scope || '*', ordered_ids: orderedIds });
const fieldConfigSetLabel = (fieldKey, label, scope) =>
    fieldConfigRequest(`/labels/${encodeURIComponent(fieldKey)}`, 'PUT', { label, item_scope: scope || '*' });
const fieldConfigResetField = (fieldKey) =>
    fieldConfigRequest('/reset', 'POST', fieldKey ? { field_key: fieldKey } : {});

// ---- inline "edit choices" mini-editor -------------------------------

let fieldConfigMiniEditorTarget = null;

function openFieldOptionMiniEditor(fieldKey, scope) {
    fieldConfigMiniEditorTarget = { fieldKey, scope: scope || '*' };
    const modal = document.getElementById('fieldOptionMiniEditor');
    if (!modal) return;
    document.getElementById('fieldOptionMiniEditorTitle').textContent =
        `Edit “${fieldLabel(fieldKey, scope)}” choices`;
    renderFieldOptionMiniEditorRows();
    modal.style.display = 'block';
}

function closeFieldOptionMiniEditor() {
    const modal = document.getElementById('fieldOptionMiniEditor');
    if (modal) modal.style.display = 'none';
    fieldConfigMiniEditorTarget = null;
    fieldConfigRerenderEditor();
    if (typeof refreshAllAs400CommentPreviews === 'function') refreshAllAs400CommentPreviews();
}

function fieldConfigKnownVendors() {
    const set = new Set();
    ['door', 'window', 'hardware'].forEach(t => {
        try {
            (typeof getVendorOptionsForType === 'function' ? getVendorOptionsForType(t) : []).forEach(v => v && set.add(v));
        } catch (e) { /* ignore */ }
    });
    Object.values(LINE_ITEM_FIELD_CONFIG.options || {}).forEach(rows =>
        rows.forEach(r => r.vendor && set.add(r.vendor)));
    return [...set].sort();
}

function renderFieldOptionMiniEditorRows() {
    const body = document.getElementById('fieldOptionMiniEditorRows');
    if (!body || !fieldConfigMiniEditorTarget) return;
    const { fieldKey, scope } = fieldConfigMiniEditorTarget;
    const rows = fieldConfigRows(fieldKey, scope);
    const vendorList = `<datalist id="fieldOptVendorList">${fieldConfigKnownVendors().map(v => `<option value="${escapeHtml(v)}">`).join('')}</datalist>`;

    body.innerHTML = vendorList + rows.map((r, i) => `
        <tr data-opt-id="${r.id}" class="${r.active ? '' : 'field-opt-removed'}">
            <td class="field-opt-move">
                <button type="button" data-opt-move="up" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
                <button type="button" data-opt-move="down" ${i === rows.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
            </td>
            <td><input type="text" data-opt-field="value" value="${escapeHtml(r.value)}"></td>
            <td><input type="text" data-opt-field="display_label" value="${escapeHtml(r.label === r.value ? '' : r.label)}" placeholder="${escapeHtml(r.value)}"></td>
            <td><input type="text" data-opt-field="vendor" list="fieldOptVendorList" value="${escapeHtml(r.vendor || '')}" placeholder="(any vendor)"></td>
            <td><input type="text" data-opt-field="as400_text" value="${escapeHtml(r.as400_text || '')}" placeholder="(auto)"></td>
            <td>
                <button type="button" data-opt-action="${r.active ? 'delete' : 'restore'}">${r.active ? '✕' : '↩'}</button>
            </td>
        </tr>
    `).join('') + `
        <tr class="field-opt-add-row">
            <td></td>
            <td><input type="text" id="fieldOptNewValue" placeholder="New choice"></td>
            <td><input type="text" id="fieldOptNewLabel" placeholder="(display, optional)"></td>
            <td><input type="text" id="fieldOptNewVendor" list="fieldOptVendorList" placeholder="(any vendor)"></td>
            <td><input type="text" id="fieldOptNewAs400" placeholder="(AS400 text, optional)"></td>
            <td><button type="button" id="fieldOptAddBtn">Add</button></td>
        </tr>`;

    body.querySelectorAll('tr[data-opt-id]').forEach(tr => {
        const id = Number(tr.getAttribute('data-opt-id'));
        tr.querySelectorAll('input[data-opt-field]').forEach(input => {
            input.addEventListener('change', () => {
                fieldConfigEditOption(id, { [input.getAttribute('data-opt-field')]: input.value })
                    .then(renderFieldOptionMiniEditorRows).catch(() => {});
            });
        });
        tr.querySelectorAll('[data-opt-move]').forEach(btn => {
            btn.addEventListener('click', () => {
                const dir = btn.getAttribute('data-opt-move') === 'up' ? -1 : 1;
                const ids = rows.map(r => r.id);
                const idx = ids.indexOf(id);
                if (idx + dir < 0 || idx + dir >= ids.length) return;
                ids.splice(idx, 1);
                ids.splice(idx + dir, 0, id);
                fieldConfigReorder(fieldKey, scope, ids).then(renderFieldOptionMiniEditorRows).catch(() => {});
            });
        });
        const actionBtn = tr.querySelector('[data-opt-action]');
        if (actionBtn) {
            actionBtn.addEventListener('click', () => {
                const action = actionBtn.getAttribute('data-opt-action');
                const p = action === 'delete'
                    ? fieldConfigDeleteOption(id)
                    : fieldConfigEditOption(id, { active: true });
                p.then(renderFieldOptionMiniEditorRows).catch(() => {});
            });
        }
    });

    const addBtn = body.querySelector('#fieldOptAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const value = (body.querySelector('#fieldOptNewValue').value || '').trim();
            if (!value) return;
            fieldConfigAddOption(fieldKey, scope, value, {
                display_label: (body.querySelector('#fieldOptNewLabel').value || '').trim() || undefined,
                as400_text: (body.querySelector('#fieldOptNewAs400').value || '').trim() || undefined,
                vendor: (body.querySelector('#fieldOptNewVendor').value || '').trim() || undefined,
            }).then(renderFieldOptionMiniEditorRows).catch(() => {});
        });
    }
}

function resetFieldOptionMiniEditor() {
    if (!fieldConfigMiniEditorTarget) return;
    if (!confirm(`Reset “${fieldLabel(fieldConfigMiniEditorTarget.fieldKey, fieldConfigMiniEditorTarget.scope)}” to the built-in choices?`)) return;
    fieldConfigResetField(fieldConfigMiniEditorTarget.fieldKey)
        .then(renderFieldOptionMiniEditorRows).catch(() => {});
}

// ---- "Line-Item Fields" settings screen -------------------------------

function openFieldOptionsModal() {
    const modal = document.getElementById('fieldOptionsModal');
    if (!modal) return;
    renderFieldOptionsModalBody();
    modal.style.display = 'block';
}

function closeFieldOptionsModal() {
    const modal = document.getElementById('fieldOptionsModal');
    if (modal) modal.style.display = 'none';
    fieldConfigRerenderEditor();
}

function renderFieldOptionsModalBody() {
    const body = document.getElementById('fieldOptionsModalBody');
    if (!body) return;
    const groups = (typeof LINE_ITEM_FIELD_GROUPS !== 'undefined' ? LINE_ITEM_FIELD_GROUPS : [])
        .map(group => ({
            group,
            fields: (typeof lineItemFieldsInGroup === 'function' ? lineItemFieldsInGroup(group) : [])
                .filter(f => isFieldConfigManaged(f.key)),
        }))
        .filter(g => g.fields.length);

    body.innerHTML = groups.map(({ group, fields }) => `
        <div class="field-options-group">
            <h3>${escapeHtml(group)}</h3>
            ${fields.map(f => {
                const scope = LINE_ITEM_FIELD_CONFIG.options[f.key][0]?.scope || '*';
                const rows = fieldConfigActiveRows(f.key, scope);
                return `
                <div class="field-options-field" data-fo-key="${f.key}" data-fo-scope="${scope}">
                    <label class="field-options-field-label">
                        Label
                        <input type="text" data-fo-label value="${escapeHtml(fieldLabel(f.key, scope))}">
                    </label>
                    <div class="field-options-choices">
                        <span class="field-options-choices-summary">${rows.length} choice${rows.length === 1 ? '' : 's'}: ${escapeHtml(rows.slice(0, 6).map(r => r.label).join(', '))}${rows.length > 6 ? '…' : ''}</span>
                        <button type="button" data-fo-edit>Edit choices</button>
                    </div>
                </div>`;
            }).join('')}
        </div>
    `).join('');

    body.querySelectorAll('[data-fo-key]').forEach(wrap => {
        const key = wrap.getAttribute('data-fo-key');
        const scope = wrap.getAttribute('data-fo-scope');
        const labelInput = wrap.querySelector('[data-fo-label]');
        labelInput.addEventListener('change', () => {
            fieldConfigSetLabel(key, labelInput.value.trim(), scope)
                .then(renderFieldOptionsModalBody).catch(() => {});
        });
        wrap.querySelector('[data-fo-edit]').addEventListener('click', () => openFieldOptionMiniEditor(key, scope));
    });
}

function downloadFieldConfig() {
    window.open(`${API_BASE}/line-item-field-config/export`, '_blank');
}

async function restoreFieldConfigFromFile(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
        const res = await fetch(`${API_BASE}/line-item-field-config/import`, { method: 'POST', body: form });
        const data = await res.json();
        if (!data.success) {
            if (typeof showError === 'function') showError(data.error || 'Import failed');
            return;
        }
        await fieldConfigApply(data);
        renderFieldOptionsModalBody();
        if (typeof showToast === 'function') {
            showToast(`Field config imported (${data.summary.inserted} added, ${data.summary.updated} updated)`);
        }
    } catch (err) {
        if (typeof showError === 'function') showError('Import failed: ' + err.message);
    } finally {
        input.value = '';
    }
}
