// ===== Additional Quote/Invoice/Purchase-Order Tracking =====
// currentAdditionalQuotes/Invoices/PurchaseOrders are declared in app.js (used there
// too, e.g. by document-generation.js) and shared via the browser's classic-script
// global scope - not redeclared here.

function getSecondaryQuoteControls(prefix = '') {
    const normalizedPrefix = prefix === 'inline' ? 'inline' : '';
    return {
        section: normalizedPrefix === 'inline' ? 'inlineSecondaryQuoteSection' : 'secondaryQuoteSection',
        addButton: normalizedPrefix === 'inline' ? 'inlineAddSecondaryQuoteBtn' : 'addSecondaryQuoteBtn',
        removeButton: normalizedPrefix === 'inline' ? 'inlineRemoveSecondaryQuoteBtn' : 'removeSecondaryQuoteBtn',
        quoteNumber: normalizedPrefix === 'inline' ? 'inline_quote_number_2' : 'quote_number_2',
        quoteDate: normalizedPrefix === 'inline' ? 'inline_quote_date_2' : 'quote_date_2'
    };
}

function setSecondaryQuoteVisibility(prefix = '', visible) {
    const controls = getSecondaryQuoteControls(prefix);
    const section = document.getElementById(controls.section);
    const addButton = document.getElementById(controls.addButton);
    const removeButton = document.getElementById(controls.removeButton);
    const stageAddButton = prefix === 'inline' ? document.getElementById('stageAddSecondaryQuoteBtn') : null;
    const stageRemoveButton = prefix === 'inline' ? document.getElementById('stageRemoveSecondaryQuoteBtn') : null;

    if (section) {
        section.style.display = visible ? 'block' : 'none';
    }
    if (addButton) {
        addButton.style.display = visible ? 'none' : 'inline-flex';
    }
    if (removeButton) {
        removeButton.style.display = visible ? 'inline-flex' : 'none';
    }
    if (stageAddButton) {
        stageAddButton.style.display = 'inline-flex';
    }
    if (stageRemoveButton) {
        stageRemoveButton.style.display = currentAdditionalQuotes.length > 0 ? 'inline-flex' : 'none';
    }
}

function refreshQuoteCreatedStageDetails() {
    if (!processTimeline) return;

    const stageDetails = processTimeline.querySelector('[data-stage-details="QUOTE_CREATED"]');
    const selectedOrder = getSelectedOrder();
    if (!stageDetails || !selectedOrder) return;

    stageDetails.innerHTML = renderStageDetailsMarkup('QUOTE_CREATED', selectedOrder);
    bindStageDetailInputs();
}

function clearSecondaryQuoteFields(prefix = '') {
    const controls = getSecondaryQuoteControls(prefix);
    const numberInput = document.getElementById(controls.quoteNumber);
    const dateInput = document.getElementById(controls.quoteDate);

    if (numberInput) numberInput.value = '';
    if (dateInput) dateInput.value = '';
    const totalInput = document.getElementById(prefix === 'inline' ? 'inline_quote_total_2' : 'quote_total_2');
    if (totalInput) totalInput.value = '';
}

function normalizeAdditionalQuoteEntry(rawQuote = {}) {
    const groupName = normalizeAs400AutomationGroupName(rawQuote.as400_group || rawQuote.group_name || '');
    const vendorName = String(rawQuote.vendor || '').trim();
    const colorName = String(rawQuote.group_color || '').trim();
    return {
        quote_number: String(rawQuote.quote_number || '').trim(),
        quote_date: toInputDate(rawQuote.quote_date),
        quote_total: rawQuote.quote_total === null || rawQuote.quote_total === undefined
            ? ''
            : String(rawQuote.quote_total).trim(),
        as400_group: groupName,
        vendor: vendorName,
        group_color: colorName,
    };
}

function getAs400ColorForAutomationGroup(groupName) {
    if (typeof getAs400GroupColor === 'function') {
        return getAs400GroupColor(groupName);
    }
    return '';
}

function getAutomationGroupNamesForOrder(order = null) {
    return Array.from(new Set(
        getLineItemsForAutomation(order || getSelectedOrder() || currentOrder || {})
            .map(item => getAutomationGroupNameForItem(item))
            .filter(Boolean)
    ));
}

function getAdditionalQuoteLabel(quote, index) {
    const groupName = normalizeAs400AutomationGroupName(quote?.as400_group || '');
    return groupName ? `${groupName} Quote` : `Additional Quote ${index + 1}`;
}

async function ensureAdditionalQuoteForAs400Group(orderId, groupName, lineItems = []) {
    const normalizedGroup = normalizeAs400AutomationGroupName(groupName);
    if (!orderId || !normalizedGroup) return null;

    const existingIndex = currentAdditionalQuotes.findIndex(quote => normalizeAs400AutomationGroupName(quote.as400_group) === normalizedGroup);
    if (existingIndex >= 0) return existingIndex;

    const vendor = String((lineItems || []).find(item => item.vendor)?.vendor || '').trim();
    currentAdditionalQuotes.push(normalizeAdditionalQuoteEntry({
        as400_group: normalizedGroup,
        vendor,
        group_color: getAs400ColorForAutomationGroup(normalizedGroup),
    }));
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', true);
    await persistAdditionalQuotesState(orderId);
    refreshQuoteCreatedStageDetails();
    return currentAdditionalQuotes.length - 1;
}
async function ensureAdditionalQuoteRowsForOrderGroups(order = null, options = {}) {
    if (!order || !order.id) return false;
    const groupNames = getAutomationGroupNamesForOrder(order);
    if (groupNames.length <= 1) return false;

    const primaryGroup = normalizeAs400AutomationGroupName(groupNames[0]);
    const additionalGroupNames = groupNames
        .map(normalizeAs400AutomationGroupName)
        .filter(groupName => groupName && groupName !== primaryGroup);
    const items = getLineItemsForAutomation(order);
    let changed = false;

    const beforeCount = currentAdditionalQuotes.length;
    currentAdditionalQuotes = currentAdditionalQuotes.filter(quote => {
        const quoteGroup = normalizeAs400AutomationGroupName(quote.as400_group);
        const hasQuoteData = Boolean(quote.quote_number || quote.quote_date || quote.quote_total);
        return quoteGroup !== primaryGroup || hasQuoteData;
    });
    if (currentAdditionalQuotes.length !== beforeCount) changed = true;

    additionalGroupNames.forEach(groupName => {
        const exists = currentAdditionalQuotes.some(quote => normalizeAs400AutomationGroupName(quote.as400_group) === groupName);
        if (exists) return;
        const groupItems = items.filter(item => getAutomationGroupNameForItem(item) === groupName);
        currentAdditionalQuotes.push(normalizeAdditionalQuoteEntry({
            as400_group: groupName,
            vendor: String(groupItems.find(item => item.vendor)?.vendor || '').trim(),
            group_color: getAs400ColorForAutomationGroup(groupName),
        }));
        changed = true;
    });

    if (!changed) return false;
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', currentAdditionalQuotes.length > 0);
    refreshQuoteCreatedStageDetails();
    if (options.persist !== false) {
        await persistAdditionalQuotesState(order.id);
    }
    return true;
}

function parseAdditionalQuotesFromOrder(order) {
    let parsed = [];

    try {
        if (Array.isArray(order?.additional_quotes)) {
            parsed = order.additional_quotes;
        } else if (order?.additional_quotes) {
            parsed = JSON.parse(order.additional_quotes);
        }
    } catch (error) {
        console.warn('Unable to parse additional_quotes for order', order?.id, error);
        parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        const legacyHasSecondary = Boolean(order && (order.quote_number_2 || order.quote_date_2 || order.quote_total_2));
        if (!legacyHasSecondary) return [];

        return [normalizeAdditionalQuoteEntry({
            quote_number: order.quote_number_2,
            quote_date: order.quote_date_2,
            quote_total: order.quote_total_2,
        })];
    }

    return parsed.map(normalizeAdditionalQuoteEntry);
}

function syncAdditionalQuotesToHiddenField() {
    const hiddenField = document.getElementById(INLINE_ORDER_FIELDS.additional_quotes);
    if (!hiddenField) return;

    hiddenField.value = currentAdditionalQuotes.length > 0
        ? JSON.stringify(currentAdditionalQuotes)
        : '';
}

function syncLegacySecondaryQuoteFieldsFromAdditional(prefix = 'inline') {
    const numberId = prefix === 'inline' ? 'inline_quote_number_2' : 'quote_number_2';
    const dateId = prefix === 'inline' ? 'inline_quote_date_2' : 'quote_date_2';
    const totalId = prefix === 'inline' ? 'inline_quote_total_2' : 'quote_total_2';

    const numberInput = document.getElementById(numberId);
    const dateInput = document.getElementById(dateId);
    const totalInput = document.getElementById(totalId);

    const first = currentAdditionalQuotes[0] || null;
    if (numberInput) numberInput.value = first ? (first.quote_number || '') : '';
    if (dateInput) dateInput.value = first ? (toInputDate(first.quote_date) || '') : '';
    if (totalInput) totalInput.value = first ? (first.quote_total || '') : '';
}

function loadAdditionalQuotesFromOrder(order) {
    currentAdditionalQuotes = parseAdditionalQuotesFromOrder(order);
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
}
function normalizeAdditionalInvoiceEntry(rawInvoice = {}) {
    const groupName = normalizeAs400AutomationGroupName(rawInvoice.as400_group || rawInvoice.group_name || '');
    return {
        invoice_number: String(rawInvoice.invoice_number || '').trim(),
        invoice_date: toInputDate(rawInvoice.invoice_date),
        invoice_total: rawInvoice.invoice_total === null || rawInvoice.invoice_total === undefined
            ? ''
            : String(rawInvoice.invoice_total).trim(),
        as400_group: groupName,
        vendor: String(rawInvoice.vendor || '').trim(),
        group_color: String(rawInvoice.group_color || '').trim(),
    };
}

function parseAdditionalInvoicesFromOrder(order) {
    let parsed = [];
    try {
        if (Array.isArray(order?.additional_invoices)) {
            parsed = order.additional_invoices;
        } else if (order?.additional_invoices) {
            parsed = JSON.parse(order.additional_invoices);
        }
    } catch (error) {
        console.warn('Unable to parse additional_invoices for order', order?.id, error);
        parsed = [];
    }
    return Array.isArray(parsed) ? parsed.map(normalizeAdditionalInvoiceEntry) : [];
}

function syncAdditionalInvoicesToHiddenField() {
    const hiddenField = document.getElementById(INLINE_ORDER_FIELDS.additional_invoices);
    if (!hiddenField) return;
    hiddenField.value = currentAdditionalInvoices.length > 0
        ? JSON.stringify(currentAdditionalInvoices)
        : '';
}

function getAdditionalInvoiceLabel(invoice, index) {
    const groupName = normalizeAs400AutomationGroupName(invoice?.as400_group || '');
    return groupName ? `${groupName} Invoice` : `Additional Invoice ${index + 1}`;
}

function loadAdditionalInvoicesFromOrder(order) {
    currentAdditionalInvoices = parseAdditionalInvoicesFromOrder(order);
    syncAdditionalInvoicesToHiddenField();
}

async function persistAdditionalInvoicesState(orderId = selectedOrderId) {
    if (!orderId) return null;
    const payload = {
        additional_invoices: currentAdditionalInvoices.length > 0 ? JSON.stringify(currentAdditionalInvoices) : null,
    };

    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to save additional invoice');
            return null;
        }
        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) currentOrder = result.order;
        const selected = getSelectedOrder();
        if (selected && selected.id === result.order.id) Object.assign(selected, result.order);
        hideError();
        return result.order;
    } catch (error) {
        console.error('Error saving additional invoice:', error);
        showError('Failed to save additional invoice');
        return null;
    }
}

async function addAdditionalInvoice() {
    currentAdditionalInvoices.push(normalizeAdditionalInvoiceEntry());
    syncAdditionalInvoicesToHiddenField();
    await persistAdditionalInvoicesState();
    renderSalesProcess(getSelectedOrder());
}

async function removeAdditionalInvoice(index) {
    if (index < 0 || index >= currentAdditionalInvoices.length) return;
    currentAdditionalInvoices.splice(index, 1);
    syncAdditionalInvoicesToHiddenField();
    await persistAdditionalInvoicesState();
    renderSalesProcess(getSelectedOrder());
}

function updateAdditionalInvoiceField(index, field, value) {
    if (!currentAdditionalInvoices[index]) return;
    currentAdditionalInvoices[index][field] = field === 'invoice_date'
        ? toInputDate(value)
        : String(value || '').trim();
    syncAdditionalInvoicesToHiddenField();
    persistAdditionalInvoicesState();
}

async function ensureAdditionalInvoiceRowsForOrderGroups(order = null, options = {}) {
    if (!order || !order.id) return false;
    const groupNames = getAutomationGroupNamesForOrder(order).map(normalizeAs400AutomationGroupName).filter(Boolean);
    if (groupNames.length <= 1) return false;

    const primaryGroup = groupNames[0];
    const additionalGroupNames = groupNames.filter(groupName => groupName && groupName !== primaryGroup);
    const items = getLineItemsForAutomation(order);
    let changed = false;

    const beforeCount = currentAdditionalInvoices.length;
    currentAdditionalInvoices = currentAdditionalInvoices.filter(invoice => {
        const invoiceGroup = normalizeAs400AutomationGroupName(invoice.as400_group);
        const hasInvoiceData = Boolean(invoice.invoice_number || invoice.invoice_date || invoice.invoice_total);
        return invoiceGroup !== primaryGroup || hasInvoiceData;
    });
    if (currentAdditionalInvoices.length !== beforeCount) changed = true;

    additionalGroupNames.forEach(groupName => {
        const exists = currentAdditionalInvoices.some(invoice => normalizeAs400AutomationGroupName(invoice.as400_group) === groupName);
        if (exists) return;
        const groupItems = items.filter(item => getAutomationGroupNameForItem(item) === groupName);
        currentAdditionalInvoices.push(normalizeAdditionalInvoiceEntry({
            as400_group: groupName,
            vendor: String(groupItems.find(item => item.vendor)?.vendor || '').trim(),
            group_color: getAs400ColorForAutomationGroup(groupName),
        }));
        changed = true;
    });

    if (!changed) return false;
    syncAdditionalInvoicesToHiddenField();
    if (options.persist !== false) await persistAdditionalInvoicesState(order.id);
    return true;
}

async function ensureAdditionalInvoiceForAs400Group(orderId, groupName, lineItems = []) {
    const normalizedGroup = normalizeAs400AutomationGroupName(groupName);
    if (!orderId || !normalizedGroup) return null;
    const existingIndex = currentAdditionalInvoices.findIndex(invoice => normalizeAs400AutomationGroupName(invoice.as400_group) === normalizedGroup);
    if (existingIndex >= 0) return existingIndex;
    currentAdditionalInvoices.push(normalizeAdditionalInvoiceEntry({
        as400_group: normalizedGroup,
        vendor: String((lineItems || []).find(item => item.vendor)?.vendor || '').trim(),
        group_color: getAs400ColorForAutomationGroup(normalizedGroup),
    }));
    syncAdditionalInvoicesToHiddenField();
    await persistAdditionalInvoicesState(orderId);
    renderSalesProcess(getSelectedOrder());
    return currentAdditionalInvoices.length - 1;
}
const ADDITIONAL_PO_DONE_FIELD_MAP = {
    po_done: 'po_done_at',
    order_placed_done: 'order_placed_done_at',
    ack_received_done: 'ack_received_done_at',
    eta_confirmed_done: 'eta_confirmed_done_at',
    ship_ticket_done: 'ship_ticket_done_at',
    will_call_done: 'will_call_done_at',
    picked_up_done: 'picked_up_done_at',
    closed_done: 'closed_done_at',
};

function normalizeAdditionalPurchaseOrderEntry(rawEntry = {}) {
    const groupName = normalizeAs400AutomationGroupName(rawEntry.as400_group || rawEntry.group_name || '');
    return {
        po_numbers: String(rawEntry.po_numbers || rawEntry.po_number || '').trim(),
        po_date_signed: toInputDate(rawEntry.po_date_signed),
        vendor: String(rawEntry.vendor || '').trim(),
        vendor_ack_number: String(rawEntry.vendor_ack_number || '').trim(),
        vendor_ack_total: rawEntry.vendor_ack_total === null || rawEntry.vendor_ack_total === undefined ? '' : String(rawEntry.vendor_ack_total).trim(),
        eta_date: toInputDate(rawEntry.eta_date),
        as400_group: groupName,
        group_color: String(rawEntry.group_color || '').trim(),
        po_done_at: rawEntry.po_done_at || null,
        order_placed_done_at: rawEntry.order_placed_done_at || null,
        ack_received_done_at: rawEntry.ack_received_done_at || null,
        eta_confirmed_done_at: rawEntry.eta_confirmed_done_at || null,
        ship_ticket_done_at: rawEntry.ship_ticket_done_at || null,
        will_call_done_at: rawEntry.will_call_done_at || null,
        picked_up_done_at: rawEntry.picked_up_done_at || null,
        closed_done_at: rawEntry.closed_done_at || null,
    };
}

function parseAdditionalPurchaseOrdersFromOrder(order) {
    let parsed = [];
    try {
        if (Array.isArray(order?.additional_pos)) parsed = order.additional_pos;
        else if (order?.additional_pos) parsed = JSON.parse(order.additional_pos);
    } catch (error) {
        console.warn('Unable to parse additional_pos for order', order?.id, error);
        parsed = [];
    }
    return Array.isArray(parsed) ? parsed.map(normalizeAdditionalPurchaseOrderEntry) : [];
}

function syncAdditionalPurchaseOrdersToHiddenField() {
    const hiddenField = document.getElementById(INLINE_ORDER_FIELDS.additional_pos);
    if (!hiddenField) return;
    hiddenField.value = currentAdditionalPurchaseOrders.length > 0 ? JSON.stringify(currentAdditionalPurchaseOrders) : '';
}

function loadAdditionalPurchaseOrdersFromOrder(order) {
    currentAdditionalPurchaseOrders = parseAdditionalPurchaseOrdersFromOrder(order);
    syncAdditionalPurchaseOrdersToHiddenField();
}

async function persistAdditionalPurchaseOrdersState(orderId = selectedOrderId) {
    if (!orderId) return null;
    const payload = { additional_pos: currentAdditionalPurchaseOrders.length > 0 ? JSON.stringify(currentAdditionalPurchaseOrders) : null };
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to save additional PO tracking');
            return null;
        }
        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) currentOrder = result.order;
        const selected = getSelectedOrder();
        if (selected && selected.id === result.order.id) Object.assign(selected, result.order);
        return result.order;
    } catch (error) {
        console.error('Error saving additional PO tracking:', error);
        showError('Failed to save additional PO tracking');
        return null;
    }
}

function updateAdditionalPurchaseOrderField(index, field, value) {
    if (!currentAdditionalPurchaseOrders[index]) return;
    if (field === 'po_date_signed' || field === 'eta_date') {
        currentAdditionalPurchaseOrders[index][field] = toInputDate(value);
    } else if (field === 'vendor_ack_total') {
        currentAdditionalPurchaseOrders[index][field] = String(value || '').trim();
    } else {
        currentAdditionalPurchaseOrders[index][field] = String(value || '').trim();
    }
    syncAdditionalPurchaseOrdersToHiddenField();
    persistAdditionalPurchaseOrdersState();
}

function updateAdditionalPurchaseOrderDone(index, doneField, checked) {
    const timestampField = ADDITIONAL_PO_DONE_FIELD_MAP[doneField];
    if (!timestampField || !currentAdditionalPurchaseOrders[index]) return;
    currentAdditionalPurchaseOrders[index][timestampField] = checked ? (currentAdditionalPurchaseOrders[index][timestampField] || new Date().toISOString()) : null;
    syncAdditionalPurchaseOrdersToHiddenField();
    persistAdditionalPurchaseOrdersState();
    renderSalesProcess(getSelectedOrder());
}

async function ensureAdditionalPurchaseOrderRowsForOrderGroups(order = null, options = {}) {
    if (!order || !order.id) return false;
    const groupNames = getAutomationGroupNamesForOrder(order).map(normalizeAs400AutomationGroupName).filter(Boolean);
    if (groupNames.length <= 1) return false;
    const primaryGroup = groupNames[0];
    const additionalGroupNames = groupNames.filter(groupName => groupName && groupName !== primaryGroup);
    const items = getLineItemsForAutomation(order);
    let changed = false;

    const beforeCount = currentAdditionalPurchaseOrders.length;
    currentAdditionalPurchaseOrders = currentAdditionalPurchaseOrders.filter(entry => {
        const entryGroup = normalizeAs400AutomationGroupName(entry.as400_group);
        const hasData = Boolean(entry.po_numbers || entry.po_date_signed || entry.vendor_ack_number || entry.vendor_ack_total || entry.eta_date || Object.values(ADDITIONAL_PO_DONE_FIELD_MAP).some(doneField => entry[doneField]));
        return entryGroup !== primaryGroup || hasData;
    });
    if (currentAdditionalPurchaseOrders.length !== beforeCount) changed = true;

    additionalGroupNames.forEach(groupName => {
        const exists = currentAdditionalPurchaseOrders.some(entry => normalizeAs400AutomationGroupName(entry.as400_group) === groupName);
        if (exists) return;
        const groupItems = items.filter(item => getAutomationGroupNameForItem(item) === groupName);
        currentAdditionalPurchaseOrders.push(normalizeAdditionalPurchaseOrderEntry({
            as400_group: groupName,
            vendor: String(groupItems.find(item => item.vendor)?.vendor || '').trim(),
            group_color: getAs400ColorForAutomationGroup(groupName),
        }));
        changed = true;
    });

    if (!changed) return false;
    syncAdditionalPurchaseOrdersToHiddenField();
    if (options.persist !== false) await persistAdditionalPurchaseOrdersState(order.id);
    return true;
}

async function addAdditionalQuote() {
    currentAdditionalQuotes.push(normalizeAdditionalQuoteEntry());
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', true);
    await persistAdditionalQuotesState();
    refreshQuoteCreatedStageDetails();
}

async function removeAdditionalQuote(index) {
    if (index < 0 || index >= currentAdditionalQuotes.length) return;

    currentAdditionalQuotes.splice(index, 1);
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', currentAdditionalQuotes.length > 0);
    await persistAdditionalQuotesState();
    refreshQuoteCreatedStageDetails();
}

function updateAdditionalQuoteField(index, field, value) {
    setAdditionalQuoteFieldValue(index, field, value);
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    persistAdditionalQuotesState();
}

async function persistAdditionalQuotesState(orderId = selectedOrderId) {
    if (!orderId) return null;

    const first = currentAdditionalQuotes[0] || null;
    const payload = {
        additional_quotes: currentAdditionalQuotes.length > 0 ? JSON.stringify(currentAdditionalQuotes) : null,
        quote_number_2: first ? (first.quote_number || null) : null,
        quote_date_2: first ? (first.quote_date || null) : null,
        quote_total_2: first && first.quote_total !== '' ? parseFloat(first.quote_total) : null,
    };

    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to save additional quote');
            return null;
        }

        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) {
            currentOrder = result.order;
        }
        const selected = getSelectedOrder();
        if (selected && selected.id === result.order.id) {
            Object.assign(selected, result.order);
        }
        hideError();
        return result.order;
    } catch (error) {
        console.error('Error saving additional quote:', error);
        showError('Failed to save additional quote');
    }
}

function syncSecondaryQuoteSection(prefix = '', order = null) {
    const controls = getSecondaryQuoteControls(prefix);
    const section = document.getElementById(controls.section);
    const numberInput = document.getElementById(controls.quoteNumber);
    const dateInput = document.getElementById(controls.quoteDate);

    if (numberInput) numberInput.value = order ? (order.quote_number_2 || '') : '';
    if (dateInput) dateInput.value = order ? toInputDate(order.quote_date_2) : '';
    const totalInput = document.getElementById(prefix === 'inline' ? 'inline_quote_total_2' : 'quote_total_2');
    if (totalInput) totalInput.value = order ? (order.quote_total_2 || '') : '';

    const hasSecondaryQuote = Boolean(
        (order && (order.quote_number_2 || order.quote_date_2)) ||
        (numberInput && numberInput.value.trim()) ||
        (dateInput && dateInput.value.trim()) ||
        (section && section.style.display !== 'none')
    );

    setSecondaryQuoteVisibility(prefix, hasSecondaryQuote);
}

function showSecondaryQuoteFields(prefix = '') {
    setSecondaryQuoteVisibility(prefix, true);
    const controls = getSecondaryQuoteControls(prefix);
    const numberInput = document.getElementById(controls.quoteNumber);
    if (numberInput) numberInput.focus();

    if (prefix === 'inline') {
        renderSalesProcess(getSelectedOrder());
    }
}

function hideSecondaryQuoteFields(prefix = '') {
    clearSecondaryQuoteFields(prefix);
    setSecondaryQuoteVisibility(prefix, false);

    if (prefix === 'inline') {
        currentAdditionalQuotes = [];
        syncAdditionalQuotesToHiddenField();
        if (selectedOrderId) {
            persistStageField('quote_number_2', null);
            persistStageField('quote_date_2', null);
            persistStageField('quote_total_2', null);
            persistStageField('additional_quotes', null);
        }
        renderSalesProcess(getSelectedOrder());
    }
}
