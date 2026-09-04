// ===== Create Quote/Invoice/SO Functions =====

const DESKTOP_HELPER_URL = `${API_BASE}/desktop-helper`;
let desktopHelperAvailable = false;

// Quick action functions that load order and immediately trigger automation
async function quickCreateQuote(orderId) {
    console.log('Quick create quote for order:', orderId);
    try {
        // Load the order data first
        const response = await fetch(`${API_BASE}/orders/${orderId}`);
        const data = await response.json();
        
        if (data.success) {
            currentOrder = data.order;
            // Immediately trigger quote creation
            await createQuote();
        } else {
            showError(data.error || 'Failed to load order');
        }
    } catch (error) {
        console.error('Error loading order for quote:', error);
        showError('Failed to load order details');
    }
}

async function quickCreateInvoice(orderId) {
    console.log('Quick create invoice for order:', orderId);
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`);
        const data = await response.json();
        
        if (data.success) {
            currentOrder = data.order;
            await createInvoice();
        } else {
            showError(data.error || 'Failed to load order');
        }
    } catch (error) {
        console.error('Error loading order for invoice:', error);
        showError('Failed to load order details');
    }
}

async function quickCreateSpecialOrder(orderId) {
    console.log('Quick create special order for order:', orderId);
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`);
        const data = await response.json();
        
        if (data.success) {
            currentOrder = data.order;
            await createSpecialOrder();
        } else {
            showError(data.error || 'Failed to load order');
        }
    } catch (error) {
        console.error('Error loading order for special order:', error);
        showError('Failed to load order details');
    }
}

function redirectToLogin() {
    const nextUrl = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/login?next=${encodeURIComponent(nextUrl)}`;
}

function setHelperStatusBadge(mode) {
    const statusElement = document.getElementById('helperStatus');
    const statusTextElement = document.getElementById('helperStatusText');
    if (!statusElement || !statusTextElement) return;

    if (mode === 'available') {
        statusElement.className = 'helper-status available';
        statusTextElement.textContent = '🤖 Automation Ready';
        return;
    }

    statusElement.className = 'helper-status unavailable';
    statusTextElement.textContent = mode === 'auth' ? '🔒 Sign In Required' : '⚠️ Manual Mode';
}

async function callDesktopHelper(endpoint, { method = 'GET', payload = null, timeoutMs = 0 } = {}) {
    const options = { method };

    if (payload !== null) {
        options.headers = {
            'Content-Type': 'application/json',
        };
        options.body = JSON.stringify(payload);
    }

    if (timeoutMs > 0) {
        options.signal = AbortSignal.timeout(timeoutMs);
    }

    const response = await fetch(`${DESKTOP_HELPER_URL}/${endpoint}`, options);

    if (response.status === 401) {
        desktopHelperAvailable = false;
        setHelperStatusBadge('auth');
        redirectToLogin();
        return { success: false, unauthorized: true, error: 'Authentication required' };
    }

    let result = {};
    try {
        result = await response.json();
    } catch (_error) {
        result = {};
    }

    if (!response.ok) {
        return {
            success: false,
            status: response.status,
            error: result.error || `Desktop helper request failed: ${response.status}`,
        };
    }

    return result;
}

// Check if desktop helper is running
async function checkDesktopHelper() {
    try {
        const result = await callDesktopHelper('health', {
            method: 'GET',
            timeoutMs: 1000,
        });

        if (result.unauthorized) {
            return false;
        }

        desktopHelperAvailable = result.status === 'running';

        if (desktopHelperAvailable) {
            setHelperStatusBadge('available');
        } else {
            setHelperStatusBadge('manual');
        }

        return desktopHelperAvailable;
    } catch (error) {
        desktopHelperAvailable = false;
        setHelperStatusBadge('manual');
        return false;
    }
}

// Check on page load
document.addEventListener('DOMContentLoaded', function() {
    checkDesktopHelper();
    // Check again every 30 seconds
    setInterval(checkDesktopHelper, 30000);
});

function getLineItemsForAutomation(actionOrder) {
    // Prefer in-memory editor values for the currently open order so prompt fields
    // reflect unsaved product edits.
    if (currentOrder && currentOrder.id === actionOrder.id && Array.isArray(currentLineItems) && currentLineItems.length > 0) {
        return currentLineItems.map(item => ({ ...item }));
    }

    if (Array.isArray(actionOrder.line_items)) {
        return actionOrder.line_items.map(item => ({ ...item }));
    }

    if (actionOrder.line_items) {
        try {
            const parsed = JSON.parse(actionOrder.line_items);
            return Array.isArray(parsed) ? parsed.map(item => ({ ...item })) : [];
        } catch (error) {
            console.warn('Could not parse line_items for automation payload', error);
        }
    }

    return [];
}

function normalizeAs400AutomationGroupName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getAutomationGroupNameForItem(item) {
    if (typeof getAs400GroupNameForItem === 'function') {
        return getAs400GroupNameForItem(item);
    }

    const vendor = normalizeAs400AutomationGroupName(item?.vendor) || 'Ungrouped';
    const text = [item?.style, item?.door_style, item?.door_type, item?.model, item?.series, item?.description]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');
    return text.includes('bypass') ? `${vendor} Bypass` : vendor;
}

function getLineItemsForAutomationGroup(actionOrder, groupName = null) {
    const lineItems = getLineItemsForAutomation(actionOrder);
    const normalizedGroup = normalizeAs400AutomationGroupName(groupName);
    if (!normalizedGroup) return lineItems;
    return lineItems.filter(item => getAutomationGroupNameForItem(item) === normalizedGroup);
}

function getAutomationGroupLabel(groupName = null) {
    const normalizedGroup = normalizeAs400AutomationGroupName(groupName);
    return normalizedGroup ? ` (${normalizedGroup})` : '';
}
function mapLineItemForAs400Automation(item) {
    const quantity = Number.parseInt(item.quantity || '1', 10) || 1;
    const noCost = Boolean(item.no_cost);
    const umText = resolveUmForCtrlAltS(item);
    const vendorSkuText = resolveVendorSkuForCtrlAltS(item);
    const width = String(item.width || '').trim();
    const height = String(item.height || '').trim();
    const sizeText = String(item.callout_size || item.size || '').trim() || (width && height ? `${width} x ${height}` : '');
    const operationText = String(item.operation || item.operation_style || item.handing || '').trim();
    const locationText = String(item.location || item.room || '').trim();
    const descriptionText = buildCtrlAltSDescription(item) || String(item.description || '').trim() || [operationText, sizeText].filter(Boolean).join(' ');
    const bomCommentText = buildBomCommentText(item);
    const itemTypeText = String(item.type || item.item_type || item.product || '').toLowerCase();
    const isDoor = itemTypeText.includes('door');
    const isHardware = itemTypeText.includes('hardware');
    const isPrefit = Boolean(item.prefit_enabled);
    const notesText = (!isPrefit)
        ? buildStandardAs400CommentPreview(item)
        : [String(item.notes || '').trim(), bomCommentText].filter(Boolean).join(' | ');

    const _priceVal = [item.price, item.unit_price, item.quote_total, item.sale_price, item.line_total]
        .find(v => v != null && v !== '');
    const priceText = String(_priceVal ?? '').trim();

    return {
        ...item,
        item_type: item.type || item.item_type || item.product || '',
        type: item.type || item.item_type || item.product || '',
        product: item.product || (isHardware ? 'Hardware' : (String(item.type || '').toLowerCase().includes('window') ? 'Window' : 'Door')),
        handing: operationText,
        operation: operationText,
        operation_style: operationText,
        location: locationText,
        room: item.room || locationText,
        description: isHardware ? [item.hardware_product_code, item.hardware_lever_knob_style, item.hardware_finish_code || item.hardware_finish, item.hardware_handing].filter(Boolean).join(' ') : descriptionText,
        notes: notesText,
        as400_comment: notesText,
        as400_comment_authoritative: true,
        callout_size: String(item.callout_size || '').trim(),
        size: sizeText,
        model: item.model || item.series || item.style || '',
        series: item.series || item.style || '',
        finish: item.finish || item.material || '',
        width,
        height,
        quantity,
        no_cost: noCost,
        um: umText,
        vendor_sku: vendorSkuText,
        vendorSku: vendorSkuText,
        sku: vendorSkuText,
        unit_price: [item.unit_price, item.price, item.quote_total, item.sale_price, item.line_total].find(v => v != null && v !== '') ?? '',
        price: priceText
    };
}

function getPrimaryAs400GroupName(order = null) {
    return getAutomationGroupNamesForOrder(order || getSelectedOrder() || currentOrder || {})
        .map(normalizeAs400AutomationGroupName)
        .filter(Boolean)[0] || '';
}

function getQuoteNumberForAs400Group(order, groupName = null) {
    const normalizedGroup = normalizeAs400AutomationGroupName(groupName);
    const primaryGroup = getPrimaryAs400GroupName(order);
    if (!normalizedGroup || normalizedGroup === primaryGroup) {
        return String(order?.quote_number || '').trim();
    }
    const quote = currentAdditionalQuotes.find(item => normalizeAs400AutomationGroupName(item.as400_group) === normalizedGroup);
    return String(quote?.quote_number || '').trim();
}

async function persistCapturedInvoiceFields(orderId, capturedFields, options = {}) {
    if (!orderId || !capturedFields || Object.keys(capturedFields).length === 0) return null;

    if (Number.isInteger(options.additionalInvoiceIndex) && options.additionalInvoiceIndex >= 0) {
        const index = options.additionalInvoiceIndex;
        currentAdditionalInvoices[index] = normalizeAdditionalInvoiceEntry({
            ...(currentAdditionalInvoices[index] || {}),
            ...capturedFields,
            as400_group: options.as400_group || currentAdditionalInvoices[index]?.as400_group || '',
            vendor: options.vendor || currentAdditionalInvoices[index]?.vendor || '',
            group_color: options.group_color || currentAdditionalInvoices[index]?.group_color || '',
        });
        syncAdditionalInvoicesToHiddenField();
        const savedOrder = await persistAdditionalInvoicesState(orderId);
        if (savedOrder) {
            ['invoice_number', 'invoice_date', 'invoice_total'].forEach(field => {
                const element = document.getElementById(`stage_additional_${field}_${index}`);
                if (element) element.value = field === 'invoice_date' ? (toInputDate(capturedFields[field]) || '') : (capturedFields[field] ?? '');
            });
            renderSalesProcess(getSelectedOrder());
            return savedOrder;
        }
        return null;
    }

    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(capturedFields),
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Invoice was created, but invoice details did not save');
            return null;
        }
        allOrders = sortOrdersForList(allOrders.map(order => order.id === orderId ? result.order : order));
        if (currentOrder && currentOrder.id === orderId) currentOrder = result.order;
        const selected = getSelectedOrder();
        if (selected && selected.id === orderId) Object.assign(selected, result.order);

        const fieldIds = {
            invoice_number: ['inline_invoice_number', 'stage_field_INVOICE_CREATED_invoice_number'],
            invoice_date: ['inline_invoice_date', 'stage_field_INVOICE_CREATED_invoice_date'],
            invoice_total: ['inline_invoice_total', 'stage_field_INVOICE_CREATED_invoice_total'],
        };
        Object.entries(capturedFields).forEach(([field, value]) => {
            (fieldIds[field] || []).forEach(id => {
                const element = document.getElementById(id);
                if (element) element.value = field === 'invoice_date' ? (toInputDate(value) || '') : (value ?? '');
            });
        });
        return result.order;
    } catch (error) {
        console.error('Error saving captured invoice fields:', error);
        showError('Invoice was created, but invoice details did not save');
        return null;
    }
}
async function persistCapturedQuoteFields(orderId, capturedFields, options = {}) {
    if (!orderId || !capturedFields || Object.keys(capturedFields).length === 0) return null;

    if (Number.isInteger(options.additionalQuoteIndex) && options.additionalQuoteIndex >= 0) {
        const index = options.additionalQuoteIndex;
        currentAdditionalQuotes[index] = normalizeAdditionalQuoteEntry({
            ...(currentAdditionalQuotes[index] || {}),
            ...capturedFields,
            as400_group: options.as400_group || currentAdditionalQuotes[index]?.as400_group || '',
            vendor: options.vendor || currentAdditionalQuotes[index]?.vendor || '',
            group_color: options.group_color || currentAdditionalQuotes[index]?.group_color || '',
        });
        syncAdditionalQuotesToHiddenField();
        syncLegacySecondaryQuoteFieldsFromAdditional('inline');
        const savedOrder = await persistAdditionalQuotesState(orderId);
        if (savedOrder) {
            ['quote_number', 'quote_date', 'quote_total'].forEach(field => {
                const element = document.getElementById(`stage_additional_${field}_${index}`);
                if (element) element.value = field === 'quote_date' ? (toInputDate(capturedFields[field]) || '') : (capturedFields[field] ?? '');
            });
            refreshQuoteCreatedStageDetails();
            return savedOrder;
        }
        return null;
    }

    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(capturedFields)
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Quote was created, but quote details did not save');
            return null;
        }

        allOrders = sortOrdersForList(allOrders.map(order => order.id === orderId ? result.order : order));
        if (currentOrder && currentOrder.id === orderId) {
            currentOrder = result.order;
        }

        const selected = getSelectedOrder();
        if (selected && selected.id === orderId) {
            Object.assign(selected, result.order);
        }

        const fieldIds = {
            quote_number: ['inline_quote_number', 'stage_field_QUOTE_CREATED_quote_number'],
            quote_date: ['inline_quote_date', 'stage_field_QUOTE_CREATED_quote_date'],
            quote_total: ['inline_quote_total', 'stage_field_QUOTE_CREATED_quote_total']
        };

        Object.entries(capturedFields).forEach(([field, value]) => {
            (fieldIds[field] || []).forEach(id => {
                const element = document.getElementById(id);
                if (element) element.value = field === 'quote_date' ? (toInputDate(value) || '') : (value ?? '');
            });
        });

        return result.order;
    } catch (error) {
        console.error('Error saving captured quote fields:', error);
        showError('Quote was created, but quote details did not save');
        return null;
    }
}
async function createQuote(groupName = null) {
    flushActiveEditsBeforeSave();

    const actionOrder = getSelectedOrder() || (currentOrder && currentOrder.id ? currentOrder : null);
    if (!actionOrder || !actionOrder.id) {
        alert('No order selected');
        return;
    }

    const currentFormData = selectedOrderId === actionOrder.id ? collectInlineOrderFormData() : {};
    Object.assign(actionOrder, currentFormData);
    const automationOrder = normalizeCustomerForAutomation(actionOrder);

    // Keep currentOrder in sync so existing helper paths continue to work.
    currentOrder = actionOrder;

    const groupLabel = getAutomationGroupLabel(groupName);
    const sourceLineItems = getLineItemsForAutomationGroup(automationOrder, groupName);
    if (groupName && sourceLineItems.length === 0) {
        showError('No line items found for ' + groupName);
        return;
    }
    const normalizedGroupName = normalizeAs400AutomationGroupName(groupName);
    const orderGroupNames = getAutomationGroupNamesForOrder(automationOrder).map(normalizeAs400AutomationGroupName).filter(Boolean);
    const primaryGroupName = orderGroupNames[0] || '';
    const groupedQuoteIndex = normalizedGroupName && orderGroupNames.length > 1 && normalizedGroupName !== primaryGroupName
        ? await ensureAdditionalQuoteForAs400Group(actionOrder.id, normalizedGroupName, sourceLineItems)
        : null;
    const lineItemsForAutomation = sourceLineItems.map(mapLineItemForAs400Automation);
    // Single source of truth for what the macro types (Step 1). Sent alongside
    // line_items; the desktop helper prefers it when AS400_USE_ROW_PLAN is set.
    const as400RowPlan = typeof buildAs400RowPlan === 'function'
        ? buildAs400RowPlan(automationOrder, sourceLineItems)
        : null;
    const fallbackVendorSku = sanitizeVendorSku(lineItemsForAutomation.find(item => item.vendor_sku)?.vendor_sku || automationOrder.vendor_sku || '');
    const groupVendor = lineItemsForAutomation.find(item => item.vendor)?.vendor || automationOrder.vendor || '';
    
    // Check if desktop helper is available
    const helperAvailable = await checkDesktopHelper();
    
    if (helperAvailable) {
        // Use desktop helper for full automation
        try {
            const result = await callDesktopHelper('launch-quote', {
                method: 'POST',
                payload: {
                    order_id: actionOrder.id,  // Include order ID for auto-update
                    customer_name: automationOrder.customer_name,
                    customer_phone: automationOrder.customer_phone,
                    customer_email: automationOrder.customer_email,
                    project_name: automationOrder.project_name,
                    vendor: groupVendor,
                    quote_number: automationOrder.quote_number,
                    size: actionOrder.size || '',
                    jamb: actionOrder.jamb || '',
                    color: actionOrder.color || '',
                    customer_number: automationOrder.customer_number,
                    has_customer_account: automationOrder.has_customer_account,
                    line_items: lineItemsForAutomation,
                    as400_row_plan: as400RowPlan,
                    as400_group: normalizedGroupName,
                    vendor_sku: fallbackVendorSku,
                    needs_prefit: automationOrder.needs_prefit,
                    prefit_meta: automationOrder.prefit_width ? {
                        rough_opening: `${automationOrder.prefit_width} x ${automationOrder.prefit_height}`,
                        thickness: automationOrder.prefit_thickness,
                        hc_sc: automationOrder.prefit_hinge_radius === 'Square' ? 'SC' : 'HC',
                        door_cfg: automationOrder.door_configuration?.toLowerCase().includes('slab') ? 'Slab' : 'PH'
                    } : null
                }
            });

            if (result.unauthorized) {
                return;
            }
            
            if (result.success) {
                let message = `AS400 Quote launched for ${actionOrder.customer_name}${groupLabel}`;
                const capturedQuoteFields = {};

                if (result.captured_quote_number) {
                    capturedQuoteFields.quote_number = String(result.captured_quote_number).trim();
                    message += `\nQuote Number: ${capturedQuoteFields.quote_number}`;
                }

                if (result.captured_quote_total !== null && result.captured_quote_total !== undefined && result.captured_quote_total !== '') {
                    const quoteTotalValue = Number(result.captured_quote_total);
                    if (Number.isFinite(quoteTotalValue)) {
                        capturedQuoteFields.quote_total = quoteTotalValue;
                        message += `\nQuote Total: ${quoteTotalValue.toFixed(2)}`;
                    }
                }

                if (result.captured_quote_date) {
                    capturedQuoteFields.quote_date = toInputDate(result.captured_quote_date) || String(result.captured_quote_date).trim();
                    message += `\nQuote Date: ${capturedQuoteFields.quote_date}`;
                }

                if (Object.keys(capturedQuoteFields).length > 0) {
                    const savedOrder = await persistCapturedQuoteFields(actionOrder.id, capturedQuoteFields, Number.isInteger(groupedQuoteIndex) ? {
                        additionalQuoteIndex: groupedQuoteIndex,
                        as400_group: normalizedGroupName,
                        vendor: groupVendor,
                        group_color: getAs400ColorForAutomationGroup(normalizedGroupName),
                    } : {});
                    if (savedOrder) {
                        Object.assign(actionOrder, savedOrder);
                        const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
                        renderOrdersTable(getOrdersForMainList(activeOrders, completedOrders));
                        renderCompletedOrders();
                        renderSalesProcess(getSelectedOrder());
                    }
                }

                showToast(message);
            } else {
                showError(result.error || 'Failed to launch quote automation');
            }
        } catch (error) {
            console.error('Error calling desktop helper:', error);
            showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
        }
    } else {
        // Fall back to showing manual instructions and backend data
        fetch(`${API_BASE}/orders/${actionOrder.id}/generate-quote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                const quote = result.quote_data;
                let message = `📝 Quote Generation (Manual Mode)\n\n`;
                message += `⚠️ Desktop Helper not running - automation unavailable\n\n`;
                message += `Customer: ${quote.customer_name || 'N/A'}\n`;
                message += `Quote #: ${quote.quote_number || 'Not yet assigned'}\n`;
                message += `Quote Total: $${quote.quote_total || '0.00'}\n\n`;
                message += `Items: ${quote.items.length} item(s)\n\n`;
                message += `Manual Steps:\n`;
                message += `1. Start desktop_helper_service.py for automation\n`;
                message += `2. Or manually open AS400 Quote Creation\n`;
                message += `3. Enter customer information\n`;
                message += `4. Create quote and get quote number\n`;
                message += `5. Return and enter quote number in form`;
                
                alert(message);
            } else {
                showError(result.error || 'Failed to generate quote data');
            }
        })
        .catch(error => {
            console.error('Error generating quote:', error);
            showError('Failed to generate quote data');
        });
    }
}

async function createInvoice(groupName = null) {
    flushActiveEditsBeforeSave();
    // Always prefer the currently selected row to avoid launching automation
    // with stale in-memory order data.
    const actionOrder = getSelectedOrder() || (currentOrder && currentOrder.id ? currentOrder : null);
    if (!actionOrder || !actionOrder.id) {
        alert('No order selected');
        return;
    }

    currentOrder = actionOrder;

    commitAllLineItemControls();

    const groupLabel = getAutomationGroupLabel(groupName);
    const sourceLineItems = getLineItemsForAutomationGroup(actionOrder, groupName);
    if (groupName && sourceLineItems.length === 0) {
        showError('No line items found for ' + groupName);
        return;
    }
    const normalizedGroupName = normalizeAs400AutomationGroupName(groupName);
    const orderGroupNames = getAutomationGroupNamesForOrder(actionOrder).map(normalizeAs400AutomationGroupName).filter(Boolean);
    const primaryGroupName = orderGroupNames[0] || '';
    const groupedInvoiceIndex = normalizedGroupName && orderGroupNames.length > 1 && normalizedGroupName !== primaryGroupName
        ? await ensureAdditionalInvoiceForAs400Group(actionOrder.id, normalizedGroupName, sourceLineItems)
        : null;
    const lineItemsForAutomation = sourceLineItems.map(mapLineItemForAs400Automation);
    const as400RowPlan = typeof buildAs400RowPlan === 'function'
        ? buildAs400RowPlan(actionOrder, sourceLineItems)
        : null;
    const fallbackVendorSku = sanitizeVendorSku(lineItemsForAutomation.find(item => item?.vendor_sku)?.vendor_sku || actionOrder.vendor_sku || '');
    const groupVendor = lineItemsForAutomation.find(item => item.vendor)?.vendor || actionOrder.vendor || '';
    const groupQuoteNumber = getQuoteNumberForAs400Group(actionOrder, normalizedGroupName) || actionOrder.quote_number || '';
    const groupInvoiceNumber = Number.isInteger(groupedInvoiceIndex)
        ? (currentAdditionalInvoices[groupedInvoiceIndex]?.invoice_number || '')
        : (actionOrder.invoice_number || '');
    
    const helperAvailable = await checkDesktopHelper();
    
    if (helperAvailable) {
        // Use desktop helper for full automation
        try {
            const result = await callDesktopHelper('launch-invoice', {
                method: 'POST',
                payload: {
                    order_id: actionOrder.id,
                    stage: actionOrder.stage,
                    customer_name: actionOrder.customer_name,
                    customer_phone: actionOrder.customer_phone,
                    project_name: actionOrder.project_name,
                    vendor: groupVendor,
                    invoice_number: groupInvoiceNumber,
                    quote_number: groupQuoteNumber,
                    customer_number: actionOrder.customer_number,
                    has_customer_account: actionOrder.has_customer_account,
                    line_items: lineItemsForAutomation,
                    as400_row_plan: as400RowPlan,
                    as400_group: normalizedGroupName,
                    vendor_sku: fallbackVendorSku,
                    size: actionOrder.size || '',
                    jamb: actionOrder.jamb || '',
                    color: actionOrder.color || ''
                }
            });

            if (result.unauthorized) {
                return;
            }
            
            if (result.success) {
                let message = `AS400 Invoice launched for ${actionOrder.customer_name}${groupLabel}`;

                const capturedInvoiceFields = {};

                if (result.captured_invoice_number) {
                    capturedInvoiceFields.invoice_number = String(result.captured_invoice_number).trim();
                    message += `\nInvoice Number: ${capturedInvoiceFields.invoice_number}`;
                }

                if (result.captured_invoice_total !== null && result.captured_invoice_total !== undefined && result.captured_invoice_total !== '') {
                    const invoiceTotalValue = Number(result.captured_invoice_total);
                    if (Number.isFinite(invoiceTotalValue)) {
                        capturedInvoiceFields.invoice_total = invoiceTotalValue;
                        message += `\nInvoice Total: $${invoiceTotalValue.toFixed(2)}`;
                    }
                }

                if (result.captured_invoice_date) {
                    capturedInvoiceFields.invoice_date = toInputDate(result.captured_invoice_date) || String(result.captured_invoice_date).trim();
                    message += `\nInvoice Date: ${capturedInvoiceFields.invoice_date}`;
                }

                if (Object.keys(capturedInvoiceFields).length > 0) {
                    const savedOrder = await persistCapturedInvoiceFields(actionOrder.id, capturedInvoiceFields, Number.isInteger(groupedInvoiceIndex) ? {
                        additionalInvoiceIndex: groupedInvoiceIndex,
                        as400_group: normalizedGroupName,
                        vendor: groupVendor,
                        group_color: getAs400ColorForAutomationGroup(normalizedGroupName),
                    } : {});
                    if (savedOrder) {
                        Object.assign(actionOrder, savedOrder);
                        const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
                        renderOrdersTable(getOrdersForMainList(activeOrders, completedOrders));
                        renderCompletedOrders();
                        renderSalesProcess(getSelectedOrder());
                    }
                }

                showToast(message);
            } else {
                showError(result.error || 'Failed to launch invoice automation');
            }
        } catch (error) {
            console.error('Error calling desktop helper:', error);
            showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
        }
    } else {
        // Fall back to manual mode
        fetch(`${API_BASE}/orders/${actionOrder.id}/generate-invoice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                const invoice = result.invoice_data;
                let message = `🧾 Invoice Generation (Manual Mode)\n\n`;
                message += `⚠️ Desktop Helper not running - automation unavailable\n\n`;
                message += `Customer: ${invoice.customer_name || 'N/A'}\n`;
                message += `Invoice #: ${invoice.invoice_number || 'Not yet assigned'}\n`;
                message += `Invoice Total: $${invoice.invoice_total || '0.00'}\n\n`;
                message += `Items: ${invoice.items.length} item(s)\n\n`;
                message += `Manual Steps:\n`;
                message += `1. Start desktop_helper_service.py for automation\n`;
                message += `2. Or manually open AS400 Invoice Creation\n`;
                message += `3. Enter quote or customer info\n`;
                message += `4. Create invoice and get number\n`;
                message += `5. Return and enter invoice number`;
                
                alert(message);
            } else {
                showError(result.error || 'Failed to generate invoice data');
            }
        })
        .catch(error => {
            console.error('Error generating invoice:', error);
            showError('Failed to generate invoice data');
        });
    }
}

async function createSpecialOrder(groupName = null) {
    const actionOrder = getSelectedOrder() || (currentOrder && currentOrder.id ? currentOrder : null);
    if (!actionOrder || !actionOrder.id) {
        alert('No order selected');
        return;
    }

    currentOrder = actionOrder;
    commitAllLineItemControls();
    
    const groupLabel = getAutomationGroupLabel(groupName);
    const sourceLineItems = getLineItemsForAutomationGroup(actionOrder, groupName);
    if (groupName && sourceLineItems.length === 0) {
        showError('No line items found for ' + groupName);
        return;
    }
    const lineItemsForAutomation = sourceLineItems.map(mapLineItemForAs400Automation);
    const as400RowPlan = typeof buildAs400RowPlan === 'function'
        ? buildAs400RowPlan(actionOrder, sourceLineItems)
        : null;
    const groupVendor = lineItemsForAutomation.find(item => item.vendor)?.vendor || actionOrder.vendor || '';

    const helperAvailable = await checkDesktopHelper();
    const specialOrderSourceNumber = (actionOrder.quote_number || actionOrder.invoice_number || '').trim();
    
    if (helperAvailable) {
        // Use desktop helper for full automation
        try {
            const result = await callDesktopHelper('launch-special-order', {
                method: 'POST',
                payload: {
                    order_id: actionOrder.id,
                    customer_name: actionOrder.customer_name,
                    customer_phone: actionOrder.customer_phone,
                    project_name: actionOrder.project_name,
                    vendor: groupVendor,
                    quote_number: specialOrderSourceNumber,
                    invoice_number: actionOrder.invoice_number,
                    line_items: lineItemsForAutomation,
                    as400_row_plan: as400RowPlan,
                    as400_group: normalizeAs400AutomationGroupName(groupName)
                }
            });

            if (result.unauthorized) {
                return;
            }
            
            if (result.success) {
                let message = `AS400 Special Order launched for ${actionOrder.customer_name}${groupLabel}`;

                if (result.captured_special_order_number) {
                    message += `\nSpecial Order Number: ${result.captured_special_order_number}`;
                    actionOrder.invoice_number = result.captured_special_order_number;
                }

                if (result.captured_special_order_total !== null && result.captured_special_order_total !== undefined && result.captured_special_order_total !== '') {
                    const specialOrderTotalValue = Number(result.captured_special_order_total);
                    if (Number.isFinite(specialOrderTotalValue)) {
                        message += `\nSpecial Order Total: $${specialOrderTotalValue.toFixed(2)}`;
                        actionOrder.invoice_total = specialOrderTotalValue;
                    }
                }

                if (result.captured_special_order_date) {
                    message += `\nSpecial Order Date: ${result.captured_special_order_date}`;
                    actionOrder.invoice_date = result.captured_special_order_date;
                }

                if (result.captured_special_order_number || result.captured_special_order_total !== null && result.captured_special_order_total !== undefined) {
                    actionOrder.stage = 'INVOICE_CREATED';
                }

                if (result.captured_special_order_number || result.captured_special_order_total !== null && result.captured_special_order_total !== undefined) {
                    await loadOrders();
                }

                showToast(message);
            } else {
                showError(result.error || 'Failed to launch special order automation');
            }
        } catch (error) {
            console.error('Error calling desktop helper:', error);
            showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
        }
    } else {
        // Fall back to manual mode
        fetch(`${API_BASE}/orders/${actionOrder.id}/generate-special-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                const so = result.so_data;
                let message = `📋 Special Order Generation (Manual Mode)\n\n`;
                message += `⚠️ Desktop Helper not running - automation unavailable\n\n`;
                message += `Customer: ${so.customer_name || 'N/A'}\n`;
                message += `Vendor: ${so.vendor || 'N/A'}\n`;
                message += `PO(s): ${so.po_numbers || so.po_number || 'Not yet assigned'}\n\n`;
                message += `Items: ${so.items.length} item(s)\n\n`;
                message += `Manual Steps:\n`;
                message += `1. Start desktop_helper_service.py for automation\n`;
                message += `2. Or manually open AS400 Special Order\n`;
                message += `3. Enter customer and vendor info\n`;
                message += `4. Create special order\n`;
                message += `5. Update PO number if needed`;
                
                alert(message);
            } else {
                showError(result.error || 'Failed to generate special order data');
            }
        })
        .catch(error => {
            console.error('Error generating special order:', error);
            showError('Failed to generate special order data');
        });
    }
}

// ===== Delivery line (Ctrl+Alt+D - a self-contained AS400 macro that types
// SKU 040619 / qty 1 / price $125 by itself; no dialog to fill) =====

const DELIVERY_LINE = { sku: '040619', price: 125, quantity: 1 };

function _deliveryActionOrder() {
    const actionOrder = getSelectedOrder() || (currentOrder && currentOrder.id ? currentOrder : null);
    if (!actionOrder || !actionOrder.id) {
        alert('No order selected');
        return null;
    }
    const formData = selectedOrderId === actionOrder.id ? collectInlineOrderFormData() : {};
    Object.assign(actionOrder, formData);
    currentOrder = actionOrder;
    return actionOrder;
}

// Button A: standalone AS400 quote that contains only the delivery line, for
// when delivery was left off the original quote.
async function createDeliveryTag() {
    const actionOrder = _deliveryActionOrder();
    if (!actionOrder) return;
    const automationOrder = normalizeCustomerForAutomation(actionOrder);

    if (!(await checkDesktopHelper())) {
        alert(`Delivery Tag (Manual Mode)\n\nDesktop Helper not running.\n\n` +
            `Create a new AS400 quote for ${automationOrder.customer_name}, then press Ctrl+Alt+D ` +
            `to drop in the delivery line (SKU ${DELIVERY_LINE.sku}, $${DELIVERY_LINE.price}).`);
        return;
    }
    if (!confirm(`Create a SEPARATE AS400 quote for ${automationOrder.customer_name} with just the $${DELIVERY_LINE.price} delivery line?`)) return;

    try {
        const result = await callDesktopHelper('launch-delivery-quote', {
            method: 'POST',
            payload: {
                order_id: actionOrder.id,
                customer_name: automationOrder.customer_name,
                customer_phone: automationOrder.customer_phone,
                customer_email: automationOrder.customer_email,
                project_name: automationOrder.project_name,
                quote_number: automationOrder.quote_number,
                customer_number: automationOrder.customer_number,
                has_customer_account: automationOrder.has_customer_account,
            },
        });
        if (result.unauthorized) return;
        if (result.success) {
            let msg = `AS400 delivery quote launched for ${automationOrder.customer_name}`;
            if (result.captured_quote_number) msg += `\nQuote Number: ${result.captured_quote_number}`;
            showToast(msg);
        } else {
            showError(result.error || 'Failed to launch delivery quote');
        }
    } catch (error) {
        console.error('Error launching delivery quote:', error);
        showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
    }
}

// Button B: add the delivery line to the quote/order already open in AS400,
// after all the other items have been typed in.
async function addDeliveryToQuote() {
    const actionOrder = _deliveryActionOrder();
    if (!actionOrder) return;

    if (!(await checkDesktopHelper())) {
        alert(`Add Delivery (Manual Mode)\n\nDesktop Helper not running.\n\n` +
            `In the open AS400 quote, press Ctrl+Alt+D to drop in the delivery line ` +
            `(SKU ${DELIVERY_LINE.sku}, $${DELIVERY_LINE.price}).`);
        return;
    }
    if (!confirm(`Add the $${DELIVERY_LINE.price} delivery line to the AS400 quote that's open now?\n\nMake sure the quote is on screen at the item-entry field.`)) return;

    try {
        const result = await callDesktopHelper('add-delivery', {
            method: 'POST',
            payload: { order_id: actionOrder.id },
        });
        if (result.unauthorized) return;
        if (result.success) {
            showToast(`Delivery line added ($${DELIVERY_LINE.price})`);
        } else {
            showError(result.error || 'Failed to add delivery line');
        }
    } catch (error) {
        console.error('Error adding delivery line:', error);
        showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
    }
}

// ===== Open Existing Quote/Invoice/Special Order Functions =====

function resolveOpenActionTarget(order, preferredAction = null) {
    if (!order) return null;

    const quoteNumber = String(order.quote_number || '').trim();
    const invoiceNumber = String(order.invoice_number || '').trim();
    const poSource = String(order.po_numbers || order.po_number || '').trim();
    const firstPoNumber = poSource
        ? poSource.split(',').map(token => token.trim()).filter(Boolean)[0] || ''
        : '';
    const specialOrderNumber = String(order.order_number || firstPoNumber || invoiceNumber || '').trim();
    const invoiceType = String(order.invoice_type || '').trim().toLowerCase();

    const buildTarget = (action, value) => {
        const number = String(value || '').trim();
        if (!number) return null;
        if (action === 'open-quote') {
            return { action, payload: { quote_number: number }, label: `quote ${number}` };
        }
        if (action === 'open-invoice') {
            return { action, payload: { invoice_number: number }, label: `invoice ${number}` };
        }
        if (action === 'open-special-order') {
            return { action, payload: { order_number: number }, label: `special order ${number}` };
        }
        return null;
    };

    if (preferredAction === 'open-quote') {
        return buildTarget('open-quote', quoteNumber);
    }
    if (preferredAction === 'open-invoice') {
        return buildTarget('open-invoice', invoiceNumber);
    }
    if (preferredAction === 'open-special-order') {
        return buildTarget('open-special-order', specialOrderNumber);
    }

    if (invoiceType.includes('special')) {
        return buildTarget('open-special-order', specialOrderNumber) || buildTarget('open-quote', quoteNumber);
    }

    if (invoiceType.includes('charge') || invoiceType.includes('cash') || invoiceType.includes('sale')) {
        return buildTarget('open-invoice', invoiceNumber) || buildTarget('open-quote', quoteNumber);
    }

    return buildTarget('open-quote', quoteNumber) || buildTarget('open-invoice', invoiceNumber);
}

async function openOrderViaDesktopHelper(preferredAction = null) {
    const actionOrder = getSelectedOrder() || (currentOrder && currentOrder.id ? currentOrder : null);
    if (!actionOrder || !actionOrder.id) {
        alert('Please select an order first');
        return;
    }

    const target = resolveOpenActionTarget(actionOrder, preferredAction) || resolveOpenActionTarget(actionOrder, null);
    if (!target) {
        alert('No quote or invoice number found for this order');
        return;
    }

    const helperAvailable = await checkDesktopHelper();
    if (!helperAvailable) {
        showError('Desktop helper service not available. Cannot open order automatically.');
        return;
    }

    try {
        const result = await callDesktopHelper(target.action, {
            method: 'POST',
            payload: target.payload,
        });

        if (result.unauthorized) {
            return;
        }

        if (result.success) {
            showToast(`✅ Opening ${target.label} in AS400`);
        } else {
            showError(result.error || 'Failed to open order in AS400');
        }
    } catch (error) {
        console.error('Error calling desktop helper:', error);
        showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
    }
}

async function openQuote() {
    await openOrderViaDesktopHelper('open-quote');
}

async function openInvoice() {
    await openOrderViaDesktopHelper('open-invoice');
}

async function openSpecialOrder() {
    await openOrderViaDesktopHelper('open-special-order');
}

