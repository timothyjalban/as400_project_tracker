// ===== Order Selection & Stage Navigation =====

async function hydrateOrderFromServer(orderId) {
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`);
        const result = await response.json();
        if (!result.success || !result.order) {
            return null;
        }

        const fetchedOrder = result.order;
        const existingIndex = allOrders.findIndex(order => order.id === fetchedOrder.id);
        if (existingIndex >= 0) {
            allOrders = sortOrdersForList(
                allOrders.map(order => (order.id === fetchedOrder.id ? fetchedOrder : order))
            );
        } else {
            allOrders = sortOrdersForList([...allOrders, fetchedOrder]);
        }
        return fetchedOrder;
    } catch (error) {
        console.error('Error hydrating order from server:', error);
        return null;
    }
}

async function selectOrder(orderId) {
    selectedOrderId = Number(orderId);

    const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
    renderOrdersTable(getOrdersForMainList(activeOrders, completedOrders));
    renderCompletedOrders();

    const hydrated = await hydrateOrderFromServer(selectedOrderId);
    if (selectedOrderId !== Number(orderId)) return;

    const selectedOrder = hydrated || getSelectedOrder();
    openProcessStages = new Set();
    if (selectedOrder && selectedOrder.stage && STAGES.includes(selectedOrder.stage)) {
        openProcessStages.add(selectedOrder.stage);
    }

    const splitAfterHydrate = splitOrdersByArchiveStatus(allOrders);
    renderOrdersTable(getOrdersForMainList(splitAfterHydrate.activeOrders, splitAfterHydrate.completedOrders));
    renderCompletedOrders();
    renderSalesProcess(selectedOrder);
}

function updateProcessStageNavButtons(order) {
    if (!processPrevStageBtn || !processNextStageBtn) return;

    if (!order || !order.id) {
        processPrevStageBtn.disabled = true;
        processNextStageBtn.disabled = true;
        if (processJumpStageSelect) {
            processJumpStageSelect.disabled = true;
        }
        return;
    }

    const currentIndex = STAGES.indexOf(order.stage || '');
    if (currentIndex < 0) {
        processPrevStageBtn.disabled = true;
        processNextStageBtn.disabled = false;
        if (processJumpStageSelect) {
            processJumpStageSelect.disabled = false;
        }
        return;
    }

    processPrevStageBtn.disabled = currentIndex <= 0;
    processNextStageBtn.disabled = currentIndex >= STAGES.length - 1;
    if (processJumpStageSelect) {
        processJumpStageSelect.disabled = false;
    }
}

function syncProcessJumpStage(order) {
    if (!processJumpStageSelect) return;

    const hasOrder = Boolean(order && order.id);
    processJumpStageSelect.disabled = !hasOrder;

    if (!hasOrder) {
        processJumpStageSelect.innerHTML = '<option value="">Select stage...</option>';
        return;
    }

    processJumpStageSelect.innerHTML = STAGES
        .map(stage => `<option value="${stage}" ${stage === order.stage ? 'selected' : ''}>${formatStageLabel(stage)}</option>`)
        .join('');
}

function jumpToSelectedStage() {
    if (!processJumpStageSelect) return;

    const stage = processJumpStageSelect.value;
    if (!stage) {
        showError('Choose a stage first');
        return;
    }

    jumpToStage(stage);
}

async function moveSelectedOrderStage(direction) {
    flushActiveEditsBeforeSave();
    const order = getSelectedOrder();
    if (!order || !order.id) {
        showError('Select an order first');
        return;
    }

    const currentIndex = STAGES.indexOf(order.stage || '');
    let nextIndex;

    if (currentIndex < 0) {
        nextIndex = direction > 0 ? 0 : -1;
    } else {
        nextIndex = currentIndex + direction;
    }

    if (nextIndex < 0 || nextIndex >= STAGES.length) {
        showToast(direction > 0 ? 'Already at final stage' : 'Already at first stage');
        return;
    }

    const nextStage = STAGES[nextIndex];
    if (!nextStage || nextStage === order.stage) {
        return;
    }

    const payload = removeBlankStageTrackingFields({
        ...collectStageDetailDraftPayload(),
        stage: nextStage,
    });
    const inlinePriorityInput = document.getElementById(INLINE_ORDER_FIELDS.priority_manual);
    const currentPriorityValue = inlinePriorityInput ? inlinePriorityInput.value : order.priority_manual;
    const nextAutoPriority = getAutoPriorityUpdateForStageChange(order.stage, currentPriorityValue, nextStage);
    if (nextAutoPriority !== null) {
        payload.priority_manual = nextAutoPriority;
    }

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
            showError(result.error || 'Failed to update stage');
            return;
        }

        allOrders = sortOrdersForList(allOrders.map(item => item.id === order.id ? result.order : item));
        openProcessStages = new Set([nextStage]);
        const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
        renderOrdersTable(getOrdersForMainList(activeOrders, completedOrders));
        renderCompletedOrders();
        renderSalesProcess(getSelectedOrder());
        hideError();
        showToast(`Stage updated to ${formatStageLabel(nextStage)}`);
    } catch (error) {
        console.error('Error updating stage:', error);
        showError('Failed to update stage');
    }
}

function handleOrderListItemKey(event, orderId) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectOrder(orderId);
    }
}

async function updateOrderListBoolean(orderId, fieldName, value, successMessage) {
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ [fieldName]: value })
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to update order');
            return;
        }

        allOrders = sortOrdersForList(
            allOrders.map(order => (order.id === orderId ? result.order : order))
        );

        const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
        renderOrdersTable(getOrdersForMainList(activeOrders, completedOrders));
        renderCompletedOrders();
        renderSalesProcess(getSelectedOrder());
        showToast(successMessage);
        hideError();
    } catch (error) {
        console.error('Error updating order list flag:', error);
        showError('Failed to update order');
    }
}

function toggleOrderPin(event, orderId) {
    event.stopPropagation();
    const order = allOrders.find(item => item.id === orderId);
    if (!order) return;

    const nextValue = Number(order.is_pinned || 0) === 1 ? 0 : 1;
    updateOrderListBoolean(orderId, 'is_pinned', nextValue, nextValue ? 'Order pinned' : 'Order unpinned');
}

function toggleOrderFlag(event, orderId) {
    event.stopPropagation();
    const order = allOrders.find(item => item.id === orderId);
    if (!order) return;

    const nextValue = Number(order.is_flagged || 0) === 1 ? 0 : 1;
    updateOrderListBoolean(orderId, 'is_flagged', nextValue, nextValue ? 'Order flagged' : 'Order unflagged');
}

function openReminderForOrder(event, orderId) {
    event.stopPropagation();

    const order = allOrders.find(item => item.id === orderId);
    if (!order) {
        showError('Order not found for reminder');
        return;
    }

    cancelAddReminder();
    openRemindersModal();
    showAddReminderForm();
    prefillReminderFormForOrder(order, true);

    const saveBtn = document.getElementById('saveReminderBtn');
    if (saveBtn) {
        saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const titleInput = document.getElementById('reminder_title');
    if (titleInput) {
        titleInput.focus();
    }
}

