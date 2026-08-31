// Order Tracker - Line-item AS400 groups
//
// Extracted from line-items.js. One order can be split into multiple AS400
// quotes/invoices by grouping its line items (usually by vendor). This module
// assigns/sorts/labels those groups. renderAs400GroupHeader() draws the group
// divider shown in the editor.

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
