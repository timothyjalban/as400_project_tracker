// ===== Sales Process / Stage Details Rendering =====

function renderSalesProcess(order) {
    if (!processEmpty || !processContent) return;

    if (!order) {
        processEmpty.style.display = 'grid';
        processContent.style.display = 'none';
        updateProcessStageNavButtons(null);
        renderFloatingStageJumpBar(null);
        return;
    }

    processEmpty.style.display = 'none';
    processContent.style.display = 'block';

    const stageIndex = STAGES.indexOf(order.stage || '');
    const completedCount = stageIndex >= 0 ? stageIndex : 0;
    const currentPosition = stageIndex >= 0 ? stageIndex + 1 : 1;
    const totalStages = STAGES.length;

    processOrderTitle.textContent = `${order.customer_name || 'Customer'} - Order #${order.id}`;
    const accountNumber = String(order.customer_number || '').trim();
    const streetOnlyAddress = getStreetOnlyAddress(order);
    processOrderMeta.innerHTML = `
        <span class="process-order-meta-item">Project: ${escapeHtml(order.project_name || 'No project')}</span>
        <span class="process-order-meta-item">PO(s): ${escapeHtml(order.po_numbers_display || order.po_numbers || order.po_number || 'Not assigned')}</span>
        <span class="process-order-meta-item account-edit-chip">
            <button type="button" class="account-copy-inline" title="Copy account number" onclick="copyCustomerLookupValueFromEncoded('${encodeURIComponent(accountNumber)}', 'account number')" ${accountNumber ? '' : 'disabled'}>Acct #: ${escapeHtml(accountNumber || 'None')}</button>
            <button type="button" class="account-edit-inline" onclick="editSelectedOrderCustomerNumber(event)">Edit</button>
        </span>
        ${streetOnlyAddress ? `<span class="process-order-meta-item">Address: ${escapeHtml(streetOnlyAddress)}</span>` : ''}
    `;
    processCurrentStage.textContent = formatStageLabel(order.stage || 'Not set');
    processProgressValue.textContent = `${currentPosition}/${totalStages}`;
    processUpdatedValue.textContent = formatDate(order.updated_at) || 'Unknown';
    updateProcessStageNavButtons(order);
    syncProcessJumpStage(order);

    if (processArchiveOrderBtn) {
        const isArchived = order.archived === 1;
        processArchiveOrderBtn.textContent = isArchived ? 'Unarchive Order' : 'Archive Order';
        processArchiveOrderBtn.classList.toggle('btn-warning', !isArchived);
        processArchiveOrderBtn.classList.toggle('btn-success', isArchived);
    }

    loadAttachments(order.id);
    populateInlineOrderForm(order);

    // If no open stages, open the current stage by default
    if (openProcessStages.size === 0 && order.stage && STAGES.includes(order.stage)) {
        openProcessStages.add(order.stage);
    }

    processTimeline.innerHTML = STAGES.map((stage, index) => {
        const statusClass = getStageStatusClass(stage, order);

        const isOpen = openProcessStages.has(stage);
        const stageButton = `
            <button type="button" class="timeline-item ${statusClass} ${isOpen ? 'selected' : ''}" data-stage="${stage}" onclick="jumpToStage('${stage}')">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                    <div class="timeline-title">${formatStageLabel(stage)}</div>
                    <div class="timeline-sub">${getProcessStageSubLabel(stage, order)}</div>
                </div>
            </button>
        `;

        if (!isOpen) {
            return stageButton;
        }

        return `
            ${stageButton}
            <div class="timeline-stage-details" data-stage-details="${stage}">
                ${renderStageDetailsMarkup(stage, order)}
            </div>
        `;
    }).join('');

    bindStageDetailInputs();
    renderFloatingStageJumpBar(order);
    
    // Load reminders for this order
    loadOrderReminders();
}

function getStageStatusClass(stage, order) {
    if (!order) return 'upcoming';

    const currentIndex = STAGES.indexOf(order.stage || '');
    const stageIndex = STAGES.indexOf(stage);

    if (stage === order.stage) {
        return 'current';
    }

    // Keep completed stages highlighted even after moving backward.
    if (isStageComplete(stage, order)) {
        return 'completed';
    }

    if (currentIndex >= 0 && stageIndex < currentIndex) {
        return 'previous';
    }

    return 'upcoming';
}

function isStageComplete(stage, order) {
    if (!order) return false;

    const stageFields = STAGE_SMART_FIELD_MAP[stage] || [];
    if (stageFields.length === 0) return false;

    return stageFields.every(fieldName => {
        if (OPTIONAL_STAGE_FIELDS.has(fieldName)) {
            return true;
        }

        // Checkbox-backed fields must have saved timestamp values.
        if (Object.prototype.hasOwnProperty.call(STAGE_DONE_FIELDS, fieldName)) {
            const timestampField = STAGE_DONE_FIELDS[fieldName];
            return Boolean(order[timestampField]);
        }

        const value = order[fieldName];
        if (value === null || value === undefined) {
            return false;
        }

        // Numbers (including 0) count as filled.
        if (typeof value === 'number') {
            return true;
        }

        if (typeof value === 'string') {
            return value.trim().length > 0;
        }

        return Boolean(value);
    });
}

function renderFloatingStageJumpBar(order) {
    if (!floatingStageJumpBar || !floatingStageJumpTrack) return;

    if (!order || !order.id) {
        floatingStageJumpBar.classList.remove('visible');
        floatingStageJumpTrack.innerHTML = '';
        if (processContent) {
            processContent.classList.remove('has-floating-stage-jump');
        }
        return;
    }

    floatingStageJumpTrack.innerHTML = STAGES.map((stage, index) => {
        const statusClass = getStageStatusClass(stage, order);
        const fullLabel = formatStageLabel(stage);
        const expandedWidth = Math.min(320, Math.max(96, 56 + (fullLabel.length * 8)));
        return `
            <button
                type="button"
                class="floating-stage-btn ${statusClass}"
                style="--expanded-width: ${expandedWidth}px;"
                onclick="jumpToStage('${stage}')"
                title="Jump to ${fullLabel}"
                aria-label="Jump to ${fullLabel}"
            >
                <span class="floating-stage-btn-short">${index + 1}</span>
                <span class="floating-stage-btn-full">${fullLabel}</span>
            </button>
        `;
    }).join('');

    floatingStageJumpBar.classList.add('visible');
    if (processContent) {
        processContent.classList.add('has-floating-stage-jump');
    }
}

async function toggleSelectedOrderArchive() {
    const selectedOrder = getSelectedOrder();
    if (!selectedOrder || !selectedOrder.id) {
        showError('No order selected');
        return;
    }

    const isArchived = selectedOrder.archived === 1;
    const action = isArchived ? 'unarchive' : 'archive';
    const actionText = isArchived ? 'restore' : 'archive';
    const confirmed = await showThemedConfirm({
        title: isArchived ? 'Restore Order' : 'Archive Order',
        message: `Are you sure you want to ${actionText} this order?\n\nCustomer: ${selectedOrder.customer_name || 'N/A'}\nProject: ${selectedOrder.project_name || 'N/A'}`,
        confirmLabel: isArchived ? 'Restore' : 'Archive',
        confirmClass: isArchived ? 'btn btn-success' : 'btn',
    });

    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/orders/${selectedOrder.id}/${action}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        if (!result.success) {
            showError(result.error || `Failed to ${actionText} order`);
            return;
        }

        showToast(isArchived ? 'Order restored successfully!' : 'Order archived successfully!');
        await loadOrders();
    } catch (error) {
        console.error(`Error ${actionText}ing selected order:`, error);
        showError(`Failed to ${actionText} order`);
    }
}

function openStageDetails(stage) {
    jumpToStage(stage);
}

async function jumpToStage(stage) {
    flushActiveEditsBeforeSave();
    const order = getSelectedOrder();
    if (!order || !order.id) {
        showError('Select an order first');
        return;
    }

    if (!STAGES.includes(stage)) {
        return;
    }

    const payload = removeBlankStageTrackingFields({
        ...collectStageDetailDraftPayload(),
        stage,
    });
    const transferInput = processTimeline
        ? processTimeline.querySelector('[data-stage-source-field="transfer_location"]')
        : null;
    if (transferInput) {
        payload.transfer_location = normalizeTransferLocation(transferInput.value) || null;
    } else {
        payload.transfer_location = normalizeTransferLocation(order.transfer_location) || null;
    }

    if (currentLineItems.length > 0) {
        payload.line_items = JSON.stringify(currentLineItems);
    }

    attachAdditionalTrackingPayload(payload);

    try {
        const response = await fetch(`${API_BASE}/orders/${order.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to jump to stage');
            return;
        }

        allOrders = sortOrdersForList(allOrders.map(item => item.id === order.id ? result.order : item));
        openProcessStages = new Set([stage]);
        const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
        renderOrdersTable(activeOrders);
        renderCompletedOrders(completedOrders);
        renderSalesProcess(getSelectedOrder());
        requestAnimationFrame(() => scrollToProcessStage(stage));
        hideError();
        showToast(`Jumped to ${formatStageLabel(stage)}`);
    } catch (error) {
        console.error('Error jumping to stage:', error);
        showError('Failed to jump to stage');
    }
}

function getStageFocusableControls(stageDetails) {
    if (!stageDetails) return [];

    return Array.from(stageDetails.querySelectorAll('input, select, textarea, button, [tabindex]'))
        .filter(element => {
            if (element.disabled) return false;
            if (element.hidden) return false;
            if (element.getAttribute('aria-hidden') === 'true') return false;
            if (element.getAttribute('tabindex') === '-1') return false;
            if (element.matches('[data-item-bulk-star]')) return false;

            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
        });
}

function focusFirstStageControl(stage, options = {}) {
    if (!processTimeline || !stage) return;

    const detailsElement = processTimeline.querySelector(`[data-stage-details="${stage}"]`);
    const firstControl = getStageFocusableControls(detailsElement)[0];
    if (!firstControl) return;

    firstControl.focus({ preventScroll: options.preventScroll !== false });
    if (typeof firstControl.select === 'function' && firstControl.matches('input[type="text"], input[type="number"], input:not([type]), textarea')) {
        firstControl.select();
    }
}

function bindStageTabLoop() {
    if (!processTimeline || processTimeline.dataset.stageTabLoopBound === 'true') return;
    processTimeline.dataset.stageTabLoopBound = 'true';

    processTimeline.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab') return;

        const stageDetails = event.target.closest('[data-stage-details]');
        if (!stageDetails || !processTimeline.contains(stageDetails)) return;

        const focusable = getStageFocusableControls(stageDetails);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
            return;
        }

        if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    });
}

function scrollToProcessStage(stage, options = {}) {
    if (!processTimeline || !stage) return;

    const detailsElement = processTimeline.querySelector(`[data-stage-details="${stage}"]`);
    const stageButton = processTimeline.querySelector(`.timeline-item[data-stage="${stage}"]`);
    const target = detailsElement || stageButton;

    if (!target) return;

    target.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });

    if (options.focus !== false) {
        requestAnimationFrame(() => focusFirstStageControl(stage));
    }
}

function updateBackToTopVisibility() {
    if (!backToTopBtn) return;

    const shouldShow = (window.scrollY || document.documentElement.scrollTop || 0) > 280;
    backToTopBtn.classList.toggle('visible', shouldShow);
}

function scrollToBeginningStage() {
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const order = getSelectedOrder();
    if (!order || !order.id) return;

    jumpToStage(STAGES[0]);
}

// No longer needed: selection is handled in renderSalesProcess with the 'selected' class
// function updateTimelineSelection() {}

function getStageMissingFields(stage, order) {
    const stageFields = STAGE_SMART_FIELD_MAP[stage] || [];
    if (!order || stageFields.length === 0) {
        return [];
    }

    return stageFields.filter(fieldName => {
        if (OPTIONAL_STAGE_FIELDS.has(fieldName)) {
            return false;
        }

        if (Object.prototype.hasOwnProperty.call(STAGE_DONE_FIELDS, fieldName)) {
            const timestampField = STAGE_DONE_FIELDS[fieldName];
            return !order[timestampField];
        }

        const value = order[fieldName];
        if (value === null || value === undefined) {
            return true;
        }
        if (typeof value === 'number') {
            return false;
        }
        if (typeof value === 'string') {
            return value.trim().length === 0;
        }
        return !value;
    });
}

function getStageFieldDisplayName(fieldName) {
    const labels = {
        quote_number: 'Primary Quote #',
        quote_date: 'Primary Quote Date',
        quote_number_2: 'Secondary Quote #',
        quote_date_2: 'Secondary Quote Date',
        quote_total: 'Quote Total',
        quote_done: 'Quote Done',
        signoff_done: 'Signoff Done',
        invoice_number: 'Invoice #',
        invoice_date: 'Invoice Date',
        invoice_total: 'Invoice Total',
        invoice_done: 'Invoice Done',
        costsheet_done: 'Cost Sheet Done',
        packet_done: 'Packet Done',
        po_numbers: 'PO Number',
        po_date_signed: 'PO Date',
        po_done: 'PO Done',
        vendor: 'Vendor',
        vendor_ack_number: 'Vendor Ack #',
        vendor_ack_total: 'Vendor Ack Total',
        ack_received_done: 'Ack Received',
        eta_date: 'ETA Date',
        eta_confirmed_done: 'ETA Confirmed',
        ship_ticket_done: 'Ship Ticket Done',
        transfer_location: 'Transfer Location',
        transfer_done: 'Transfer Done',
        customer_arrival_notified_done: 'Customer Notified',
        will_call_done: 'Will Call Done',
        picked_up_done: 'Picked Up',
        closed_done: 'Closed',
    };

    return labels[fieldName] || formatStageLabel(fieldName);
}

function getProcessStageSubLabel(stage, order) {
    const index = STAGES.indexOf(stage);
    if (index < 0) {
        return '';
    }

    if (stage === order?.stage) {
        return `Current (${index + 1} of ${STAGES.length})`;
    }

    if (isStageComplete(stage, order)) {
        return 'Completed';
    }

    const currentIndex = STAGES.indexOf(order?.stage || '');
    if (currentIndex >= 0 && index < currentIndex) {
        const missing = getStageMissingFields(stage, order);
        if (missing.length > 0) {
            const preview = missing.slice(0, 2).map(getStageFieldDisplayName).join(', ');
            const more = missing.length > 2 ? ` +${missing.length - 2}` : '';
            return `Needs: ${preview}${more}`;
        }
    }

    return `${index + 1} of ${STAGES.length}`;
}


function getStageFieldOrderValue(order, fieldName) {
    if (!order || !fieldName) return '';
    if (fieldName === 'po_numbers') {
        return order.po_numbers != null ? order.po_numbers : (order.po_number != null ? order.po_number : '');
    }
    return order[fieldName] != null ? order[fieldName] : '';
}

function getStageFieldRenderValue(order, fieldName) {
    const sourceInputId = INLINE_ORDER_FIELDS[fieldName];
    const sourceInput = sourceInputId ? document.getElementById(sourceInputId) : null;
    const sourceValue = sourceInput ? String(sourceInput.value || '').trim() : '';
    if (sourceValue) return sourceValue;
    const orderValue = getStageFieldOrderValue(order, fieldName);
    return orderValue == null ? '' : orderValue;
}

function getStageSourceInput(fieldName) {
    const sourceInputId = INLINE_ORDER_FIELDS[fieldName];
    return sourceInputId ? document.getElementById(sourceInputId) : null;
}
// Format a timestamp for display under the toggle
function formatDoneTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `Completed: ${d.toLocaleString()}`;
}

function renderStageDetailsMarkup(stage, order) {
    const fieldNames = STAGE_SMART_FIELD_MAP[stage] || [];
    if (fieldNames.length === 0) {
            return '<div class="stage-smart-empty">No specific fields for this stage.</div>';
    }

    const groupedPurchaseOrderControls = (() => {
        const stageConfig = {
            PO_CREATED: {
                title: 'Additional PO Tracking',
                doneField: 'po_done',
                fields: [
                    { key: 'po_numbers', label: 'PO #', type: 'text' },
                    { key: 'po_date_signed', label: 'PO Date', type: 'date' },
                    { key: 'vendor', label: 'Vendor', type: 'text' },
                ],
            },
            ORDER_PLACED_WITH_VENDOR: {
                title: 'Additional Orders Placed',
                doneField: 'order_placed_done',
                fields: [
                    { key: 'po_numbers', label: 'PO #', type: 'text' },
                    { key: 'vendor', label: 'Vendor', type: 'text' },
                ],
            },
            VENDOR_ACK_RECEIVED: {
                title: 'Additional Vendor Acks',
                doneField: 'ack_received_done',
                fields: [
                    { key: 'vendor_ack_number', label: 'Ack #', type: 'text' },
                    { key: 'vendor_ack_total', label: 'Ack Total', type: 'number', step: '0.01' },
                    { key: 'vendor', label: 'Vendor', type: 'text' },
                ],
            },
            ETA_CONFIRMED: {
                title: 'Additional ETAs',
                doneField: 'eta_confirmed_done',
                fields: [
                    { key: 'eta_date', label: 'ETA Date', type: 'date' },
                    { key: 'vendor', label: 'Vendor', type: 'text' },
                ],
            },
            SHIP_TICKET_RECEIVED: { title: 'Additional Ship Tickets', doneField: 'ship_ticket_done', fields: [{ key: 'vendor', label: 'Vendor', type: 'text' }] },
            INVOICE_TO_WILL_CALL: { title: 'Additional Will Call', doneField: 'will_call_done', fields: [{ key: 'vendor', label: 'Vendor', type: 'text' }] },
            PICKED_UP: { title: 'Additional Pickups', doneField: 'picked_up_done', fields: [{ key: 'po_numbers', label: 'PO #', type: 'text' }, { key: 'vendor', label: 'Vendor', type: 'text' }] },
            CLOSED: { title: 'Additional Closed Orders', doneField: 'closed_done', fields: [{ key: 'po_numbers', label: 'PO #', type: 'text' }, { key: 'vendor', label: 'Vendor', type: 'text' }] },
        };
        const config = stageConfig[stage];
        if (!config) return '';
        ensureAdditionalPurchaseOrderRowsForOrderGroups(order, { persist: false });
        if (currentAdditionalPurchaseOrders.length === 0) return '';
        const columns = Math.min(3, Math.max(1, config.fields.length + 1));
        const rows = currentAdditionalPurchaseOrders.map((entry, index) => {
            const doneTimestampField = ADDITIONAL_PO_DONE_FIELD_MAP[config.doneField];
            const checked = Boolean(entry[doneTimestampField]);
            const fieldMarkup = config.fields.map(field => `
                <div class="form-group">
                    <label for="stage_additional_po_${field.key}_${index}">${escapeHtml(field.label)}</label>
                    <input id="stage_additional_po_${field.key}_${index}" type="${field.type}" ${field.step ? `step="${field.step}"` : ''} value="${escapeHtml(field.type === 'date' ? (toInputDate(entry[field.key]) || '') : (entry[field.key] || ''))}" onchange="updateAdditionalPurchaseOrderField(${index}, '${field.key}', this.value)">
                </div>
            `).join('');
            return `
                <div class="stage-smart-field stage-smart-field-full">
                    <div class="additional-quote-row-label">
                        <label><span class="additional-quote-swatch ${entry.group_color ? `as400-group-${escapeHtml(entry.group_color)}` : ''}"></span>${escapeHtml(entry.as400_group || `Additional Order ${index + 1}`)}</label>
                    </div>
                    <div class="stage-smart-field-control">
                        <div class="form-grid" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 10px; width: 100%;">
                            ${fieldMarkup}
                            <div class="form-group">
                                <label for="stage_additional_po_done_${config.doneField}_${index}">${escapeHtml(getStageFieldDisplayName(config.doneField))}</label>
                                <label class="checkbox-label">
                                    <input id="stage_additional_po_done_${config.doneField}_${index}" type="checkbox" ${checked ? 'checked' : ''} onchange="updateAdditionalPurchaseOrderDone(${index}, '${config.doneField}', this.checked)">
                                    <span>${checked && entry[doneTimestampField] ? escapeHtml(formatDoneTimestamp(entry[doneTimestampField])) : 'Done'}</span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="stage-smart-field stage-smart-field-full">
                <label>${escapeHtml(config.title)}</label>
            </div>
            ${rows}
        `;
    })();
    const quoteCreatedPrimaryFields = stage === 'QUOTE_CREATED'
        ? (() => {
            const quoteNumberValue = getStageFieldRenderValue(order, 'quote_number');
            const quoteDateValue = getStageFieldRenderValue(order, 'quote_date');
            const quoteTotalValue = getStageFieldRenderValue(order, 'quote_total');

            return `
                <div class="stage-smart-field stage-smart-field-full">
                    <label>Primary Quote</label>
                    <div class="stage-smart-field-control">
                        <div class="form-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%;">
                            <div class="form-group">
                                <label for="stage_field_QUOTE_CREATED_quote_number">Quote #</label>
                                <input id="stage_field_QUOTE_CREATED_quote_number" type="text" data-stage-source-field="quote_number" value="${escapeHtml(quoteNumberValue)}">
                            </div>
                            <div class="form-group">
                                <label for="stage_field_QUOTE_CREATED_quote_date">Quote Date</label>
                                <input id="stage_field_QUOTE_CREATED_quote_date" type="date" data-stage-source-field="quote_date" value="${escapeHtml(toInputDate(quoteDateValue) || '')}">
                            </div>
                            <div class="form-group">
                                <label for="stage_field_QUOTE_CREATED_quote_total">Quote Total</label>
                                <input id="stage_field_QUOTE_CREATED_quote_total" type="number" step="0.01" data-stage-source-field="quote_total" value="${escapeHtml(quoteTotalValue)}">
                            </div>
                        </div>
                    </div>
                </div>
            `;
        })()
        : '';

    const invoiceCreatedPrimaryFields = stage === 'INVOICE_CREATED'
        ? (() => {
            const invoiceNumberValue = getStageFieldRenderValue(order, 'invoice_number');
            const invoiceDateValue = getStageFieldRenderValue(order, 'invoice_date');
            const invoiceTotalValue = getStageFieldRenderValue(order, 'invoice_total');

            return `
                <div class="stage-smart-field stage-smart-field-full">
                    <label>Primary Invoice</label>
                    <div class="stage-smart-field-control">
                        <div class="form-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%;">
                            <div class="form-group">
                                <label for="stage_field_INVOICE_CREATED_invoice_number">Invoice #</label>
                                <input id="stage_field_INVOICE_CREATED_invoice_number" type="text" data-stage-source-field="invoice_number" value="${escapeHtml(invoiceNumberValue)}">
                            </div>
                            <div class="form-group">
                                <label for="stage_field_INVOICE_CREATED_invoice_date">Invoice Date</label>
                                <input id="stage_field_INVOICE_CREATED_invoice_date" type="date" data-stage-source-field="invoice_date" value="${escapeHtml(toInputDate(invoiceDateValue) || '')}">
                            </div>
                            <div class="form-group">
                                <label for="stage_field_INVOICE_CREATED_invoice_total">Invoice Total</label>
                                <input id="stage_field_INVOICE_CREATED_invoice_total" type="number" step="0.01" data-stage-source-field="invoice_total" value="${escapeHtml(invoiceTotalValue)}">
                            </div>
                        </div>
                    </div>
                </div>
            `;
        })()
        : '';

    const invoiceCreatedControls = stage === 'INVOICE_CREATED'
        ? (() => {
            const additionalInvoiceRows = currentAdditionalInvoices.length > 0
                ? currentAdditionalInvoices.map((invoice, index) => `
                    <div class="stage-smart-field stage-smart-field-full">
                        <div class="additional-quote-row-label">
                            <label><span class="additional-quote-swatch ${invoice.group_color ? `as400-group-${escapeHtml(invoice.group_color)}` : ''}"></span>${escapeHtml(getAdditionalInvoiceLabel(invoice, index))}</label>
                            <button
                                type="button"
                                class="additional-quote-remove-icon"
                                onclick="removeAdditionalInvoice(${index})"
                                title="Remove this additional invoice"
                                aria-label="Remove additional invoice ${index + 1}"
                            >ðŸ—‘ï¸</button>
                        </div>
                        <div class="stage-smart-field-control">
                            <div class="form-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%;">
                                <div class="form-group">
                                    <label for="stage_additional_invoice_number_${index}">Invoice #</label>
                                    <input id="stage_additional_invoice_number_${index}" type="text" value="${escapeHtml(invoice.invoice_number || '')}" onchange="updateAdditionalInvoiceField(${index}, 'invoice_number', this.value)">
                                </div>
                                <div class="form-group">
                                    <label for="stage_additional_invoice_date_${index}">Invoice Date</label>
                                    <input id="stage_additional_invoice_date_${index}" type="date" value="${escapeHtml(toInputDate(invoice.invoice_date) || '')}" onchange="updateAdditionalInvoiceField(${index}, 'invoice_date', this.value)">
                                </div>
                                <div class="form-group">
                                    <label for="stage_additional_invoice_total_${index}">Invoice Total</label>
                                    <input id="stage_additional_invoice_total_${index}" type="number" step="0.01" value="${escapeHtml(invoice.invoice_total || '')}" onchange="updateAdditionalInvoiceField(${index}, 'invoice_total', this.value)">
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')
                : '';

            return `
                <div class="stage-smart-field stage-smart-field-full">
                    <label>Additional Invoice Tracking</label>
                    <div class="stage-smart-field-control">
                        <div class="quote-extra-controls">
                            <button type="button" class="btn btn-secondary btn-sm" onclick="addAdditionalInvoice()">Add Invoice</button>
                        </div>
                    </div>
                </div>
                ${additionalInvoiceRows}
            `;
        })()
        : '';
    const quoteCreatedControls = stage === 'QUOTE_CREATED'
        ? (() => {
            const inlineSection = document.getElementById('inlineSecondaryQuoteSection');
            const hasSecondaryQuote = Boolean(
                (order && (order.quote_number_2 || order.quote_date_2)) ||
                (inlineSection && inlineSection.style.display !== 'none')
            );

            const additionalQuoteRows = currentAdditionalQuotes.length > 0
                ? currentAdditionalQuotes.map((quote, index) => `
                    <div class="stage-smart-field stage-smart-field-full">
                        <div class="additional-quote-row-label">
                            <label><span class="additional-quote-swatch ${quote.group_color ? `as400-group-${escapeHtml(quote.group_color)}` : ''}"></span>${escapeHtml(getAdditionalQuoteLabel(quote, index))}</label>
                            <button
                                type="button"
                                class="additional-quote-remove-icon"
                                onclick="removeAdditionalQuote(${index})"
                                title="Remove this additional quote"
                                aria-label="Remove additional quote ${index + 1}"
                            >🗑️</button>
                        </div>
                        <div class="stage-smart-field-control">
                            <div class="form-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%;">
                                <div class="form-group">
                                    <label for="stage_additional_quote_number_${index}">Quote #</label>
                                    <input id="stage_additional_quote_number_${index}" type="text" value="${escapeHtml(quote.quote_number || '')}" onchange="updateAdditionalQuoteField(${index}, 'quote_number', this.value)">
                                </div>
                                <div class="form-group">
                                    <label for="stage_additional_quote_date_${index}">Quote Date</label>
                                    <input id="stage_additional_quote_date_${index}" type="date" value="${escapeHtml(toInputDate(quote.quote_date) || '')}" onchange="updateAdditionalQuoteField(${index}, 'quote_date', this.value)">
                                </div>
                                <div class="form-group">
                                    <label for="stage_additional_quote_total_${index}">Quote Total</label>
                                    <input id="stage_additional_quote_total_${index}" type="number" step="0.01" value="${escapeHtml(quote.quote_total || '')}" onchange="updateAdditionalQuoteField(${index}, 'quote_total', this.value)">
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')
                : '';

            return `
                <div class="stage-smart-field stage-smart-field-full">
                    <label>Additional Quote Tracking</label>
                    <div class="stage-smart-field-control">
                        <div class="quote-extra-controls">
                            <button type="button" class="btn btn-secondary btn-sm" id="stageAddSecondaryQuoteBtn" onclick="addAdditionalQuote()">➕ Add Quote</button>
                            <button type="button" class="btn btn-warning btn-sm" id="stageRemoveSecondaryQuoteBtn" onclick="hideSecondaryQuoteFields('inline')" ${hasSecondaryQuote ? '' : 'style="display:none;"'}>Remove Secondary Quote</button>
                        </div>
                    </div>
                </div>
                ${additionalQuoteRows}
            `;
        })()
        : '';

    const fieldsToRender = stage === 'QUOTE_CREATED'
        ? fieldNames.filter(fieldName => !['quote_number', 'quote_date', 'quote_total'].includes(fieldName))
        : (stage === 'INVOICE_CREATED'
            ? fieldNames.filter(fieldName => !['invoice_number', 'invoice_date', 'invoice_total'].includes(fieldName))
            : fieldNames);

    return `${groupedPurchaseOrderControls}${quoteCreatedControls}${quoteCreatedPrimaryFields}${invoiceCreatedControls}${invoiceCreatedPrimaryFields}${fieldsToRender.map(fieldName => {
        // Render as checkbox if in STAGE_DONE_FIELDS
                if (STAGE_DONE_FIELDS.hasOwnProperty(fieldName)) {
                        const checked = order?.[STAGE_DONE_FIELDS[fieldName]] ? 'checked' : '';
                        const timestamp = order?.[STAGE_DONE_FIELDS[fieldName]];
                        return `
                                <div class="stage-smart-field stage-smart-field-toggle">
                                    <label for="stage_field_${stage}_${fieldName}">${getStageFieldDisplayName(fieldName)}</label>
                                    <div class="stage-smart-field-control">
                                        <div class="stage-smart-checkbox-slider">
                                            <label class="switch" for="stage_field_${stage}_${fieldName}">
                                                <input id="stage_field_${stage}_${fieldName}" type="checkbox" data-stage-source-field="${fieldName}" ${checked}>
                                                <div class="slider round"></div>
                                            </label>
                                        </div>
                                        ${checked && timestamp ? `<div class="stage-done-timestamp">${formatDoneTimestamp(timestamp)}</div>` : ''}
                                    </div>
                                </div>
                        `;
                }

        // Special handling for transfer_location dropdown
        if (fieldName === 'transfer_location') {
            const currentValue = normalizeTransferLocation(getStageFieldRenderValue(order, fieldName));
            return `
                <div class="stage-smart-field">
                    <label for="stage_field_${stage}_${fieldName}">Store Location</label>
                    <div class="stage-smart-field-control">
                        <select id="stage_field_${stage}_${fieldName}" data-stage-source-field="${fieldName}">
                            <option value="">-- Select Location --</option>
                            ${TRANSFER_STORE_LOCATIONS.map(loc => `<option value="${loc}" ${loc === currentValue ? 'selected' : ''}>${loc}</option>`).join('')}
                        </select>
                    </div>
                </div>
            `;
        }

        // Vendor chooser for PO-related stages.
        if (fieldName === 'vendor') {
            const sourceInput = getStageSourceInput(fieldName);
            const currentValue = getStageFieldRenderValue(order, fieldName);
            const baseOptions = mergeVendorOptionsWithCatalog([
                ...(itemVendorOptions?.door || []),
                ...(itemVendorOptions?.window || []),
            ]);
            const vendorOptions = currentValue && !baseOptions.includes(currentValue)
                ? [currentValue, ...baseOptions]
                : baseOptions;
            const datalistId = `stage_field_${stage}_${fieldName}_options`;

            return `
                <div class="stage-smart-field">
                    <label for="stage_field_${stage}_${fieldName}">Vendor</label>
                    <div class="stage-smart-field-control">
                        <input
                            id="stage_field_${stage}_${fieldName}"
                            type="text"
                            data-stage-source-field="${fieldName}"
                            value="${escapeHtml(currentValue)}"
                            list="${datalistId}"
                            placeholder="Type or choose vendor"
                            autocomplete="off"
                        >
                        <datalist id="${datalistId}">
                            ${vendorOptions.map(vendor => `<option value="${escapeHtml(vendor)}"></option>`).join('')}
                        </datalist>
                    </div>
                </div>
            `;
        }

        const sourceInput = getStageSourceInput(fieldName);
        const currentValue = getStageFieldRenderValue(order, fieldName);
        const inputType = sourceInput && sourceInput.tagName === 'INPUT' ? (sourceInput.type || 'text') : 'text';

        if (sourceInput && sourceInput.tagName === 'TEXTAREA') {
            return `
                <div class="stage-smart-field stage-smart-field-full">
                    <label for="stage_field_${stage}_${fieldName}">${getStageFieldDisplayName(fieldName)}</label>
                    <div class="stage-smart-field-control">
                        <textarea id="stage_field_${stage}_${fieldName}" data-stage-source-field="${fieldName}" rows="2">${escapeHtml(currentValue)}</textarea>
                    </div>
                </div>
            `;
        }

        if (sourceInput && sourceInput.tagName === 'SELECT') {
            return `
                <div class="stage-smart-field">
                    <label for="stage_field_${stage}_${fieldName}">${getStageFieldDisplayName(fieldName)}</label>
                    <div class="stage-smart-field-control">
                        <select id="stage_field_${stage}_${fieldName}" data-stage-source-field="${fieldName}">
                            ${[...sourceInput.options].map(option => `<option value="${escapeHtml(option.value)}" ${option.value === currentValue ? 'selected' : ''}>${escapeHtml(option.textContent)}</option>`).join('')}
                        </select>
                    </div>
                </div>
            `;
        }

        return `
            <div class="stage-smart-field">
                <label for="stage_field_${stage}_${fieldName}">${getStageFieldDisplayName(fieldName)}</label>
                <div class="stage-smart-field-control">
                    <input id="stage_field_${stage}_${fieldName}" type="${inputType}" data-stage-source-field="${fieldName}" value="${escapeHtml(currentValue)}">
                </div>
            </div>
        `;
    }).join('')}`;
}

function bindStageDetailInputs() {
    if (!processTimeline) return;

    const smartInputs = processTimeline.querySelectorAll('[data-stage-source-field]');
    smartInputs.forEach(input => {
        input.addEventListener('input', () => {
            syncStageDetailControlToSource(input);
        });

        input.addEventListener('change', async () => {
            const fieldName = input.getAttribute('data-stage-source-field');
            const stageContainer = input.closest('[data-stage-details]');
            const editedStage = stageContainer ? stageContainer.getAttribute('data-stage-details') : null;

            if (Object.prototype.hasOwnProperty.call(STAGE_DONE_FIELDS, fieldName)) {
                await persistStageDoneField(fieldName, Boolean(input.checked), editedStage);
                return;
            }

            const value = fieldName === 'transfer_location'
                ? normalizeTransferLocation(input.value)
                : input.value;

            if (value !== input.value) {
                input.value = value;
            }

            const sourceInputId = INLINE_ORDER_FIELDS[fieldName];
            if (sourceInputId) {
                const sourceInput = document.getElementById(sourceInputId);
                if (sourceInput) {
                    sourceInput.value = value;
                }
            }

            await persistStageField(fieldName, value);
        });
    });
}

function normalizeStagePayloadValue(fieldName, rawValue) {
    if (rawValue === null || rawValue === undefined) return null;

    if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        if (trimmed === '') return null;

        if (STAGE_NUMERIC_FIELDS.has(fieldName)) {
            if (fieldName === 'priority_manual') {
                const parsedInt = parseInt(trimmed, 10);
                return Number.isNaN(parsedInt) ? null : parsedInt;
            }
            const parsedFloat = parseFloat(trimmed);
            return Number.isNaN(parsedFloat) ? null : parsedFloat;
        }

        return trimmed;
    }

    if (STAGE_NUMERIC_FIELDS.has(fieldName)) {
        return Number.isFinite(rawValue) ? rawValue : null;
    }

    return rawValue;
}

function collectStageDoneDraftPayload() {
    if (!processTimeline) return {};

    const payload = {};
    const selectedOrder = getSelectedOrder() || currentOrder || {};
    const doneInputs = processTimeline.querySelectorAll('[data-stage-source-field]');
    doneInputs.forEach(input => {
        const fieldName = input.getAttribute('data-stage-source-field');
        const timestampField = STAGE_DONE_FIELDS[fieldName];
        if (!timestampField) return;

        payload[timestampField] = input.checked
            ? (selectedOrder[timestampField] || new Date().toISOString())
            : null;
    });

    return payload;
}

function collectStageDetailDraftPayload() {
    if (!processTimeline) return {};

    const payload = {};
    const smartInputs = processTimeline.querySelectorAll('[data-stage-source-field]');
    smartInputs.forEach(input => {
        const fieldName = input.getAttribute('data-stage-source-field');
        if (!fieldName) return;
        if (Object.prototype.hasOwnProperty.call(STAGE_DONE_FIELDS, fieldName)) return;

        const rawValue = fieldName === 'transfer_location'
            ? normalizeTransferLocation(input.value)
            : input.value;

        if (shouldPreserveInlineValueFromBlankStage(fieldName, rawValue)) return;

        payload[fieldName] = normalizeStagePayloadValue(fieldName, rawValue);
    });

    const selectedOrder = getSelectedOrder() || currentOrder || {};
    const preserveWhenBlank = [
        'quote_number', 'quote_date', 'quote_total',
        'quote_number_2', 'quote_date_2', 'quote_total_2',
        'invoice_number', 'invoice_date', 'invoice_total',
        'po_numbers', 'po_date_signed', 'vendor', 'vendor_ack_number', 'vendor_ack_total', 'eta_date', 'transfer_location'
    ];
    preserveWhenBlank.forEach(fieldName => {
        if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) return;
        if (payload[fieldName] !== null && payload[fieldName] !== undefined && String(payload[fieldName]).trim() !== '') return;
        const existingValue = selectedOrder[fieldName];
        if (existingValue !== null && existingValue !== undefined && String(existingValue).trim() !== '') {
            payload[fieldName] = existingValue;
        }
    });

    return {
        ...payload,
        ...collectStageDoneDraftPayload(),
    };
}
async function persistStageField(fieldName, fieldValue) {
    if (!selectedOrderId || !fieldName) return;

    const payload = { [fieldName]: normalizeStagePayloadValue(fieldName, fieldValue) };

    try {
        const response = await fetch(`${API_BASE}/orders/${selectedOrderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || `Failed to update ${fieldName}`);
            return;
        }

        const idx = allOrders.findIndex(order => order.id === result.order.id);
        if (idx !== -1) {
            allOrders[idx] = result.order;
        }

        if (currentOrder && currentOrder.id === result.order.id) {
            currentOrder = result.order;
        }

        hideError();
        if (fieldName === 'transfer_location') {
            showToast('Transfer location saved');
        }
    } catch (error) {
        console.error(`Error updating ${fieldName}:`, error);
        showError(`Failed to update ${fieldName}`);
    }
}

async function persistStageDoneField(fieldName, isChecked, editedStage = null) {
    const timestampField = STAGE_DONE_FIELDS[fieldName];
    if (!timestampField || !selectedOrderId) return;

    commitAllStageDetailControls();
    commitAllAdditionalTrackingControls();

    const timestampValue = isChecked ? new Date().toISOString() : null;
    const payload = removeBlankStageTrackingFields({
        ...collectStageDetailDraftPayload(),
        [timestampField]: timestampValue,
    });

    // Keep transfer location sticky when toggling a stage checkbox.
    const transferInput = processTimeline
        ? processTimeline.querySelector('[data-stage-source-field="transfer_location"]')
        : null;
    if (transferInput) {
        payload.transfer_location = normalizeTransferLocation(transferInput.value) || null;
    }

    attachAdditionalTrackingPayload(payload);

    try {
        const response = await fetch(`${API_BASE}/orders/${selectedOrderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to update stage status');
            return;
        }

        const idx = allOrders.findIndex(order => order.id === result.order.id);
        if (idx !== -1) {
            allOrders[idx] = result.order;
        }

        if (currentOrder && currentOrder.id === result.order.id) {
            currentOrder = result.order;
        }

        if (editedStage && STAGES.includes(editedStage)) {
            openProcessStages = new Set([editedStage]);
        }

        renderSalesProcess(result.order);
        hideError();
    } catch (error) {
        console.error('Error updating stage status:', error);
        showError('Failed to update stage status');
    }
}

