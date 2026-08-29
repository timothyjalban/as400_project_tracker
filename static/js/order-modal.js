// ===== Order Modal: Inline Form, Save, Delete =====
// orderModal is declared in app.js (used there too, by the shared keydown/
// window.onclick handlers) and shared via the browser's classic-script global scope.

function extractPhoneFromText(value) {
    const match = String(value || '').match(/(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/);
    return match ? match[0].trim() : '';
}

function removePhoneFromText(value) {
    return String(value || '')
        .replace(/(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*[-,;:]\s*$/, '')
        .trim();
}

// Derives customer_phone from the customer_name text when the phone field is
// left blank (e.g. "John Smith 555-123-4567" typed straight into the name
// field). This only ever computes a new value from what's currently on the
// form - it never falls back to a stale value from the previously saved
// order, so an intentionally-cleared field always saves as cleared.
function applyRequiredCustomerFallbacks(data, selectedOrder) {
    if (!data || !selectedOrder) return data;

    if (!data.customer_phone) {
        data.customer_phone = extractPhoneFromText(data.customer_name || selectedOrder.customer_name || '') || null;
    }

    return data;
}

function normalizeCustomerForAutomation(order) {
    const payload = { ...(order || {}) };
    const inferredPhone = String(payload.customer_phone || '').trim() || extractPhoneFromText(payload.customer_name || payload.project_name || '');
    if (inferredPhone) {
        payload.customer_phone = inferredPhone;
    }

    if (payload.customer_name && inferredPhone) {
        const cleanedName = removePhoneFromText(payload.customer_name);
        if (cleanedName) payload.customer_name = cleanedName;
    }

    return payload;
}
function collectInlineOrderFormData() {
    const data = {};
    const selectedOrder = getSelectedOrder();

    // Save every field exactly as it appears on the form - an intentionally
    // cleared field must save as cleared, never silently fall back to
    // whatever was previously saved on the order.
    Object.entries(INLINE_ORDER_FIELDS).forEach(([field, elementId]) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        const value = element.value.trim();
        data[field] = value === '' ? null : value;
    });

    const quoteStageDetails = processTimeline
        ? processTimeline.querySelector('[data-stage-details="QUOTE_CREATED"]')
        : null;
    if (quoteStageDetails) {
        ['quote_number', 'quote_date', 'quote_total'].forEach(field => {
            const stageInput = quoteStageDetails.querySelector(`[data-stage-source-field="${field}"]`);
            if (!stageInput) return;

            const value = String(stageInput.value || '').trim();
            data[field] = value === '' ? null : value;

            const inlineInput = document.getElementById(INLINE_ORDER_FIELDS[field]);
            if (inlineInput) inlineInput.value = value;
        });
    }

    Object.assign(data, collectStageDetailDraftPayload());
    applyRequiredCustomerFallbacks(data, selectedOrder);

    if (data.quote_total != null && data.quote_total !== '') data.quote_total = parseFloat(data.quote_total);
    if (data.quote_total_2 != null && data.quote_total_2 !== '') data.quote_total_2 = parseFloat(data.quote_total_2);
    if (data.invoice_total != null && data.invoice_total !== '') data.invoice_total = parseFloat(data.invoice_total);
    if (data.vendor_ack_total != null && data.vendor_ack_total !== '') data.vendor_ack_total = parseFloat(data.vendor_ack_total);
    if (data.priority_manual != null && data.priority_manual !== '') data.priority_manual = parseInt(data.priority_manual, 10);

    // inline_stage is disabled - it isn't a real editing control, stage only
    // changes via the Previous/Next/Jump Stage buttons - so never let it submit
    // a stage value; always defer to the order's actual current stage.
    if (selectedOrder && selectedOrder.stage) {
        data.stage = selectedOrder.stage;
    }

    const transferInput = processTimeline
        ? processTimeline.querySelector('[data-stage-source-field="transfer_location"]')
        : null;
    if (transferInput) {
        data.transfer_location = normalizeTransferLocation(transferInput.value) || null;
    }

    const changedLineItemsJson = getChangedLineItemsJson();
    if (changedLineItemsJson !== undefined) {
        data.line_items = changedLineItemsJson;
    } else {
        delete data.line_items;
    }

    attachAdditionalTrackingPayload(data);

    const derivedPrefit = getDerivedPrefitPayload(selectedOrder);
    Object.entries(derivedPrefit).forEach(([key, value]) => {
        const hasExplicitValue = Object.prototype.hasOwnProperty.call(data, key)
            && data[key] !== null
            && data[key] !== undefined
            && String(data[key]).trim() !== '';
        if (!hasExplicitValue) {
            data[key] = value;
        }
    });

    // This is a complete, freshly-populated snapshot of every visible field
    // (see populateInlineOrderForm), so a blank here is an intentional clear -
    // tells the backend to skip its blank-preserve safety net (same contract
    // saveOrder() uses for the old popup form; see blueprints/orders.py).
    data._full_form_save = true;

    return data;
}

async function saveInlineOrder() {
    flushActiveEditsBeforeSave();

    if (!selectedOrderId) {
        showError('Select an order first, or click New Order to create one.');
        return;
    }

    const data = collectInlineOrderFormData();

    if (!data.customer_name) {
        showError('Customer name is required');
        return;
    }

    if (!data.stage) {
        showError('Stage is required');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/orders/${selectedOrderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (!result.success) {
            showError(result.error || 'Failed to save order');
            return;
        }

        if (Object.prototype.hasOwnProperty.call(data, 'line_items')) {
            resetLineItemsDirty(data.line_items);
        }
        if (result.order) {
            applyUpdatedOrderLocally(result.order);
            refreshOrderListAndProcess();
        }
        showSaveConfirmation('Order updated');
        hideError();
    } catch (error) {
        console.error('Error saving inline order:', error);
        showError('Failed to save order');
    }
}

function formatStageLabel(stage) {
    return String(stage || '')
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Create new order
function createNewOrder(customer = null) {
    currentOrder = null;
    showOrderModal(null);

    if (customer) {
        applyCustomerToOrderForms(customer, { force: true, includeProject: true, includeNotes: true });
    }
}

// View order details (for editing)
async function viewOrderDetails(orderId) {
    console.log('View order:', orderId);
    selectedOrderId = Number(orderId);
    
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`);
        const data = await response.json();
        
        if (data.success) {
            currentOrder = data.order;
            showOrderModal(data.order);
        } else {
            showError(data.error || 'Failed to load order');
        }
    } catch (error) {
        console.error('Error loading order:', error);
        showError('Failed to load order details');
    }
}

// Show order modal with data
function showOrderModal(order) {
    // Set order ID in header (or "New Order" for create)
    const modalTitle = document.getElementById('modalOrderId');
    modalTitle.textContent = order ? order.id : 'New Order';
    
    // Populate stage dropdown
    const stageSelect = document.getElementById('stage');
    const modalStages = [...new Set([...(Array.isArray(stages) ? stages : []), ...STAGES])];
    const selectedStage = (order && order.stage) ? order.stage : 'ORDER_DETAILS';
    stageSelect.innerHTML = modalStages.map(stage =>
        `<option value="${stage}" ${selectedStage === stage ? 'selected' : ''}>${stage}</option>`
    ).join('');
    
    // Populate all form fields
    const fields = [
        'customer_name', 'customer_phone', 'customer_email', 'project_name',
        'customer_number',
        'quote_number', 'quote_date', 'quote_number_2', 'quote_date_2', 'quote_total_2', 'quote_total',
        'address_street', 'address_city', 'address_state', 'address_zip',
        'vendor', 'product_type',
        'po_numbers', 'po_date_signed', 'vendor_ack_number', 'vendor_ack_total', 'eta_date',
        'invoice_number', 'invoice_date', 'invoice_total',
        'priority_manual',
        'prefit_width', 'prefit_height', 'prefit_thickness', 'prefit_lites',
        'prefit_hinge_top', 'prefit_hinge_middle', 'prefit_hinge_bottom',
        'prefit_hinge_width', 'prefit_hinge_backset', 'prefit_hinge_radius', 'prefit_hinge_prep',
        'prefit_bore_type', 'prefit_bore_single', 'prefit_bore_top', 'prefit_bore_bottom',
        'prefit_bore_backset', 'prefit_bore_diameter', 'prefit_swing', 'prefit_notes'
    ];
    
    fields.forEach(field => {
        const element = document.getElementById(field);
        if (!element) return;

        let value = order ? (order[field] || '') : '';
        if (field === 'po_numbers') {
            value = order ? (order.po_numbers || order.po_number || '') : '';
        }

        if (field === 'prefit_thickness' || field === 'prefit_hinge_width' || field === 'prefit_hinge_radius' || field === 'prefit_bore_backset' || field === 'prefit_bore_diameter') {
            value = normalizePrefitSelectValue(field, value);
        }

        if (field.endsWith('_date')) {
            element.value = toInputDate(value);
            return;
        }

        element.value = value;
    });

    const profileIdField = document.getElementById('customer_profile_id');
    if (profileIdField) {
        profileIdField.value = order && order.customer_profile_id ? order.customer_profile_id : '';
    }

    const modalPriorityInput = document.getElementById('priority_manual');
    syncPriorityInputWithStage(stageSelect, modalPriorityInput, order?.stage || stageSelect.value);

    loadLineItemsFromOrder(order || {});

    loadAdditionalQuotesFromOrder(order || {});
    syncSecondaryQuoteSection('', order);

    // Backward-compatibility for orders created before po_numbers existed.
    const poNumbersField = document.getElementById('po_numbers');
    if (poNumbersField && order) {
        poNumbersField.value = order.po_numbers || order.po_number || '';
    }
    
    // Handle prefit checkboxes
    const needsPrefitCheckbox = document.getElementById('needs_prefit');
    const customerBroughtDoorCheckbox = document.getElementById('prefit_customer_brought_door');
    const prefitVentTopCheckbox = document.getElementById('prefit_vent_top');
    const prefitVentBottomCheckbox = document.getElementById('prefit_vent_bottom');
    
    if (needsPrefitCheckbox) needsPrefitCheckbox.checked = order ? (order.needs_prefit === 1) : false;
    if (customerBroughtDoorCheckbox) customerBroughtDoorCheckbox.checked = order ? (order.prefit_customer_brought_door === 1) : false;
    if (prefitVentTopCheckbox) prefitVentTopCheckbox.checked = order ? (order.prefit_vent_top === 1) : false;
    if (prefitVentBottomCheckbox) prefitVentBottomCheckbox.checked = order ? (order.prefit_vent_bottom === 1) : false;
    
    // Keep the prefit section visible so existing orders can be switched to prefit.
    const prefitSection = document.getElementById('prefitSection');
    if (prefitSection) {
        prefitSection.style.display = 'block';
    }
    
    // Update prefit details visibility
    if (needsPrefitCheckbox) {
        togglePrefitDetails();
    }
    if (customerBroughtDoorCheckbox) {
        togglePrefitMeasurements();
    }
    
    // Setup autocomplete on customer name field
    const customerNameField = document.getElementById('customer_name');
    if (customerNameField) {
        setupAutocomplete(customerNameField);
    }

    const customerPhoneField = document.getElementById('customer_phone');
    if (customerPhoneField && !customerPhoneField.dataset.autofillBound) {
        customerPhoneField.addEventListener('blur', () => {
            const typedPhone = customerPhoneField.value.trim();
            if (typedPhone.length >= 3) {
                autofillCustomerInfo('', typedPhone);
            }
        });
        customerPhoneField.dataset.autofillBound = 'true';
    }
    
    // Load attachments and notes (only for existing orders)
    if (order && order.id) {
        loadAttachments(order.id);
        loadNotes(order.id);
        
        // Load stage done checkboxes
        loadStageDoneCheckboxes(order);
        
        // Show sections for existing orders
        document.getElementById('attachmentsSection').style.display = 'block';
        document.getElementById('notesSection').style.display = 'block';
        document.getElementById('stageProgressSection').style.display = 'block';
        document.getElementById('customerHistoryBtn').style.display = 'inline-block';
        document.getElementById('quickActions').style.display = 'flex';
        
        // Show/hide open buttons based on existing numbers
        const openQuoteBtn = document.getElementById('openQuoteBtn');
        const openInvoiceBtn = document.getElementById('openInvoiceBtn');
        const openSpecialOrderBtn = document.getElementById('openSpecialOrderBtn');

        const openQuoteTarget = resolveOpenActionTarget(order, 'open-quote');
        const openInvoiceTarget = resolveOpenActionTarget(order, 'open-invoice');
        const openSpecialTarget = resolveOpenActionTarget(order, 'open-special-order');
        const invoiceType = String(order.invoice_type || '').toLowerCase();

        if (openQuoteBtn) openQuoteBtn.style.display = openQuoteTarget ? 'inline-block' : 'none';
        if (openInvoiceBtn) openInvoiceBtn.style.display = openInvoiceTarget ? 'inline-block' : 'none';
        if (openSpecialOrderBtn) {
            const isSpecialFlow = invoiceType.includes('special');
            openSpecialOrderBtn.style.display = (isSpecialFlow && openSpecialTarget) ? 'inline-block' : 'none';
        }
        
        // Show buttons for existing orders
        document.getElementById('backupOrderBtn').style.display = 'block';
        document.getElementById('modalDeleteOrderBtn').style.display = 'block';
        document.getElementById('archiveOrderBtn').style.display = 'block';
        
        // Update archive button text based on archived status
        const archiveBtn = document.getElementById('archiveOrderBtn');
        if (order.archived === 1) {
            archiveBtn.textContent = 'Unarchive Order';
            archiveBtn.classList.remove('btn-warning');
            archiveBtn.classList.add('btn-success');
        } else {
            archiveBtn.textContent = 'Archive Order';
            archiveBtn.classList.remove('btn-success');
            archiveBtn.classList.add('btn-warning');
        }
    } else {
        document.getElementById('attachmentsSection').style.display = 'none';
        document.getElementById('notesSection').style.display = 'none';
        document.getElementById('stageProgressSection').style.display = 'none';
        document.getElementById('customerHistoryBtn').style.display = 'none';
        // Hide buttons for new orders
        document.getElementById('backupOrderBtn').style.display = 'none';
        document.getElementById('modalDeleteOrderBtn').style.display = 'none';
        document.getElementById('archiveOrderBtn').style.display = 'none';
    }
    
    // Update stage navigation buttons state
    updateStageNavButtons();
    
    // Show modal
    orderModal.style.display = 'block';
}

// Toggle prefit details section
function togglePrefitDetails() {
    const needsPrefitCheckbox = document.getElementById('needs_prefit');
    const prefitDetails = document.getElementById('prefitDetails');
    
    if (needsPrefitCheckbox && prefitDetails) {
        prefitDetails.style.display = needsPrefitCheckbox.checked ? 'block' : 'none';
    }
    
    // Trigger autosave if we're editing an existing order
    if (currentOrder && currentOrder.id) {
        scheduleAutosave();
    }
}

// Toggle prefit measurements section
function togglePrefitMeasurements() {
    const customerBroughtDoorCheckbox = document.getElementById('prefit_customer_brought_door');
    const prefitMeasurements = document.getElementById('prefitMeasurements');
    
    if (customerBroughtDoorCheckbox && prefitMeasurements) {
        prefitMeasurements.style.display = customerBroughtDoorCheckbox.checked ? 'none' : 'block';
    }
    
    // Trigger autosave if we're editing an existing order
    if (currentOrder && currentOrder.id) {
        scheduleAutosave();
    }
}

// Close order modal
function closeOrderModal() {
    orderModal.style.display = 'none';
    currentOrder = null;
}

// Save order changes
async function saveOrder() {
    flushActiveEditsBeforeSave();

    try {
        // Collect form data
        const formData = new FormData(orderForm);
        const data = {};
        
        formData.forEach((value, key) => {
            // Convert empty strings to null for cleaner database
            data[key] = value.trim() === '' ? null : value;
        });

        // Signals to the backend that this payload is a complete, freshly-populated
        // snapshot of the order edit form (see showOrderModal), so blank fields here
        // reflect an intentional clear by the user and must be saved as-is, not
        // silently reverted to the previous value.
        data._full_form_save = true;
        
        // Add stage done timestamps (only for existing orders)
        if (currentOrder && currentOrder.id) {
            for (const [checkboxId, timestampField] of Object.entries(STAGE_DONE_FIELDS)) {
                const checkbox = document.getElementById(checkboxId);
                if (checkbox) {
                    if (checkbox.checked) {
                        const timestampSpan = document.getElementById(checkboxId + '_timestamp');
                        const timestampText = timestampSpan ? timestampSpan.textContent : '';
                        if (timestampText) {
                            data[timestampField] = convertTimestampToISO(timestampText);
                        }
                    } else {
                        data[timestampField] = null;
                    }
                }
            }
        }
        
        // Validate required fields
        if (!data.customer_name) {
            showError('Customer name is required');
            return;
        }
        if (!data.stage) {
            showError('Stage is required');
            return;
        }
        
        // Convert numeric fields
        if (data.quote_total != null && data.quote_total !== '') data.quote_total = parseFloat(data.quote_total);
        if (data.quote_total_2 != null && data.quote_total_2 !== '') data.quote_total_2 = parseFloat(data.quote_total_2);
        if (data.invoice_total != null && data.invoice_total !== '') data.invoice_total = parseFloat(data.invoice_total);
        if (data.vendor_ack_total != null && data.vendor_ack_total !== '') data.vendor_ack_total = parseFloat(data.vendor_ack_total);
        if (data.customer_profile_id) {
            const parsedProfileId = parseInt(data.customer_profile_id, 10);
            data.customer_profile_id = Number.isNaN(parsedProfileId) ? null : parsedProfileId;
        }

        ['prefit_thickness', 'prefit_hinge_width', 'prefit_hinge_radius', 'prefit_bore_backset', 'prefit_bore_diameter'].forEach(field => {
            if (!Object.prototype.hasOwnProperty.call(data, field)) return;
            data[field] = normalizePrefitSelectValue(field, data[field]);
        });

        // Normalize prefit checkboxes to numeric flags so they round-trip reliably.
        const needsPrefitCheckbox = document.getElementById('needs_prefit');
        const broughtDoorCheckbox = document.getElementById('prefit_customer_brought_door');
        const ventTopCheckbox = document.getElementById('prefit_vent_top');
        const ventBottomCheckbox = document.getElementById('prefit_vent_bottom');
        if (needsPrefitCheckbox) data.needs_prefit = needsPrefitCheckbox.checked ? 1 : 0;
        if (broughtDoorCheckbox) data.prefit_customer_brought_door = broughtDoorCheckbox.checked ? 1 : 0;
        if (ventTopCheckbox) data.prefit_vent_top = ventTopCheckbox.checked ? 1 : 0;
        if (ventBottomCheckbox) data.prefit_vent_bottom = ventBottomCheckbox.checked ? 1 : 0;

        data.additional_invoices = currentAdditionalInvoices.length > 0 ? JSON.stringify(currentAdditionalInvoices) : null;
        data.additional_pos = currentAdditionalPurchaseOrders.length > 0 ? JSON.stringify(currentAdditionalPurchaseOrders) : null;

        if (currentAdditionalQuotes.length > 0) {
            const firstAdditional = currentAdditionalQuotes[0];
            data.additional_quotes = JSON.stringify(currentAdditionalQuotes);
            data.quote_number_2 = firstAdditional.quote_number || null;
            data.quote_date_2 = firstAdditional.quote_date || null;
            data.quote_total_2 = firstAdditional.quote_total !== '' ? parseFloat(firstAdditional.quote_total) : null;
        } else {
            data.additional_quotes = null;
            data.quote_number_2 = null;
            data.quote_date_2 = null;
            data.quote_total_2 = null;
        }

        const derivedPrefit = getDerivedPrefitPayload(currentOrder || getSelectedOrder());

        // Modal form is source-of-truth for prefit dropdown selections.
        Object.entries(derivedPrefit).forEach(([key, value]) => {
            const hasFormValue = Object.prototype.hasOwnProperty.call(data, key)
                && data[key] !== null
                && data[key] !== undefined
                && String(data[key]).trim() !== '';
            if (!hasFormValue) {
                data[key] = value;
            }
        });
        
        // Determine if creating or updating
        const isCreate = !currentOrder;
        const url = isCreate 
            ? `${API_BASE}/orders` 
            : `${API_BASE}/orders/${currentOrder.id}`;
        const method = isCreate ? 'POST' : 'PUT';
        const lineItemsJson = isCreate ? getLineItemsJsonForSave() : getChangedLineItemsJson();
        if (isCreate || lineItemsJson !== undefined) {
            data.line_items = lineItemsJson;
        } else {
            delete data.line_items;
        }
        
        // Send request
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            if (Object.prototype.hasOwnProperty.call(data, 'line_items')) {
                resetLineItemsDirty(data.line_items);
            }
            if (result.order) {
                applyUpdatedOrderLocally(result.order);
            }
            showSaveConfirmation(isCreate ? 'Order created successfully!' : 'Order updated successfully!');
            closeOrderModal();
            if (isCreate) {
                await loadOrders();
            } else {
                refreshOrderListAndProcess();
            }
        } else {
            showError(result.error || 'Failed to save order');
        }
    } catch (error) {
        console.error('Error saving order:', error);
        showError('Failed to save changes');
    }
}

// Delete current order
async function deleteCurrentOrder() {
    if (!currentOrder || !currentOrder.id) return;
    
    const customerName = currentOrder.customer_name || 'this order';
    const confirmation = confirm(
        `Are you sure you want to delete ${customerName}?\n\n` +
        `This will permanently delete:\n` +
        `- The order record\n` +
        `- All attachments\n` +
        `- The order folder\n\n` +
        `This action cannot be undone!`
    );
    
    if (!confirmation) return;
    
    try {
        const response = await fetch(`${API_BASE}/orders/${currentOrder.id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Order deleted successfully');
            closeOrderModal();
            loadOrders(); // Refresh the table
        } else {
            showError(result.error || 'Failed to delete order');
        }
    } catch (error) {
        console.error('Error deleting order:', error);
        showError('Failed to delete order');
    }
}

async function deleteSelectedOrder() {
    const selectedOrder = getSelectedOrder();
    if (!selectedOrder || !selectedOrder.id) {
        alert('Please select an order first');
        return;
    }

    const customerName = selectedOrder.customer_name || 'this order';
    const confirmation = confirm(
        `Are you sure you want to delete ${customerName}?\n\n` +
        `This will permanently delete:\n` +
        `- The order record\n` +
        `- All attachments\n` +
        `- The order folder\n\n` +
        `This action cannot be undone!`
    );

    if (!confirmation) return;

    try {
        const response = await fetch(`${API_BASE}/orders/${selectedOrder.id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast('Order deleted successfully');
            if (currentOrder && currentOrder.id === selectedOrder.id) {
                closeOrderModal();
            }
            selectedOrderId = null;
            renderSalesProcess(null);
            loadOrders();
        } else {
            showError(result.error || 'Failed to delete order');
        }
    } catch (error) {
        console.error('Error deleting order:', error);
        showError('Failed to delete order');
    }
}
