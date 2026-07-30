// ===== Customer History =====

function showCustomerHistory() {
    if (!currentOrder || !currentOrder.id) return;

    const customerName = document.getElementById('customer_name').value.trim();
    const customerPhone = document.getElementById('customer_phone').value.trim();

    if (!customerName && !customerPhone) {
        alert('No customer information available');
        return;
    }

    const historyTitle = document.getElementById('customerHistoryTitle');
    const historyList = document.getElementById('customerHistoryList');
    if (!historyTitle || !historyList || !customerHistoryModal) return;

    historyTitle.textContent = `Customer History: ${customerName || customerPhone}`;
    historyList.innerHTML = '<div class="empty-state">Loading history...</div>';
    customerHistoryModal.style.display = 'block';

    const params = new URLSearchParams();
    if (customerName) params.set('name', customerName);
    if (customerPhone) params.set('phone', customerPhone);
    params.set('exclude_id', String(currentOrder.id));
    params.set('limit', '25');

    fetch(`${API_BASE}/customers/history?${params.toString()}`)
        .then(response => response.json())
        .then(result => {
            if (!result.success) {
                historyList.innerHTML = `<div class="empty-state">${escapeHtml(result.error || 'Failed to load customer history')}</div>`;
                return;
            }

            const orders = Array.isArray(result.orders) ? result.orders : [];
            if (orders.length === 0) {
                historyList.innerHTML = '<div class="empty-state">No previous orders found for this customer.</div>';
                return;
            }

            historyList.innerHTML = orders.map(order => {
                const quoteNumber = order.quote_number || '';
                const invoiceNumber = order.invoice_number || '';
                const poRaw = order.po_numbers_display || order.po_numbers || order.po_number || '';
                const poNumber = String(poRaw).split(/[\s,\/]+/).map(v => v.trim()).filter(Boolean)[0] || '';

                return `
                <div class="customer-history-item" role="button" tabindex="0" onclick="openOrderFromHistory(${order.id})" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openOrderFromHistory(${order.id}); }">
                    <div class="customer-history-item-top">
                        <span class="customer-history-order-id">Order #${order.id}</span>
                        <span class="customer-history-date">${escapeHtml(formatDate(order.updated_at) || formatDate(order.created_at) || '')}</span>
                    </div>
                    <div class="customer-history-project">${escapeHtml(order.project_name || 'No project name')}</div>
                    <div class="customer-history-meta">
                        <span>${escapeHtml(formatStageLabel(order.stage || ''))}</span>
                        <span>PO: ${escapeHtml(order.po_numbers_display || order.po_numbers || order.po_number || 'N/A')}</span>
                        <span>Quote: ${escapeHtml(order.quote_number || 'N/A')}</span>
                        <span>Invoice: ${escapeHtml(order.invoice_number || 'N/A')}</span>
                    </div>
                    <div class="customer-history-actions">
                        ${quoteNumber ? `<button type="button" class="btn btn-secondary customer-history-action-btn" onclick="openHistoryDocument('quote', '${escapeHtml(String(quoteNumber))}', event)">Open Quote</button>` : ''}
                        ${invoiceNumber ? `<button type="button" class="btn btn-secondary customer-history-action-btn" onclick="openHistoryDocument('invoice', '${escapeHtml(String(invoiceNumber))}', event)">Open Invoice</button>` : ''}
                        ${poNumber ? `<button type="button" class="btn btn-secondary customer-history-action-btn" onclick="openHistoryDocument('po', '${escapeHtml(String(poNumber))}', event)">Open PO</button>` : ''}
                    </div>
                </div>
            `;
            }).join('');
        })
        .catch(error => {
            console.error('Error loading customer history:', error);
            historyList.innerHTML = '<div class="empty-state">Failed to load customer history.</div>';
        });
}

async function openHistoryDocument(type, documentNumber, event) {
    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }

    const value = String(documentNumber || '').trim();
    if (!value) {
        showError('Document number is missing');
        return;
    }

    const helperAvailable = await checkDesktopHelper();
    if (!helperAvailable) {
        showError('Desktop helper service not available. Cannot open documents automatically.');
        return;
    }

    let endpoint = '';
    let payload = {};
    let label = '';

    if (type === 'quote') {
        endpoint = 'open-quote';
        payload = { quote_number: value };
        label = 'quote';
    } else if (type === 'invoice') {
        endpoint = 'open-invoice';
        payload = { invoice_number: value };
        label = 'invoice';
    } else if (type === 'po') {
        endpoint = 'open-special-order';
        payload = { order_number: value };
        label = 'PO';
    } else {
        showError('Unknown document type');
        return;
    }

    try {
        const result = await callDesktopHelper(endpoint, {
            method: 'POST',
            payload,
        });

        if (result.unauthorized) {
            return;
        }

        if (result.success) {
            showToast(`✅ Opening ${label} ${value} in AS400`);
        } else {
            showError(result.error || `Failed to open ${label}`);
        }
    } catch (error) {
        console.error(`Error opening ${label}:`, error);
        showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
    }
}

async function openOrderFromHistory(orderId) {
    closeCustomerHistoryModal();
    closeOrderModal();
    await selectOrder(orderId);
    showToast(`Opened Order #${orderId}`);
}

function closeCustomerHistoryModal() {
    if (customerHistoryModal) {
        customerHistoryModal.style.display = 'none';
    }
}

