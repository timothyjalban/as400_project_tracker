// ===== Stage Done Checkboxes =====

function loadStageDoneCheckboxes(order) {
    if (!order) return;
    
    // Load all stage done checkboxes and their timestamps
    for (const [checkboxId, timestampField] of Object.entries(STAGE_DONE_FIELDS)) {
        const checkbox = document.getElementById(checkboxId);
        const timestampSpan = document.getElementById(checkboxId + '_timestamp');
        
        if (checkbox && timestampSpan) {
            const timestampValue = order[timestampField];
            checkbox.checked = !!timestampValue;
            timestampSpan.textContent = timestampValue ? formatTimestamp(timestampValue) : '';
            updateStageDoneVisualState(checkbox);
        }
    }

    updateStageProgressSummary();
}

async function handleStageDoneChange(checkboxId) {
    const checkbox = document.getElementById(checkboxId);
    const timestampSpan = document.getElementById(checkboxId + '_timestamp');
    const timestampField = STAGE_DONE_FIELDS[checkboxId];
    const activeOrderId = currentOrder?.id || selectedOrderId;

    if (!checkbox || !timestampSpan || !timestampField || !activeOrderId) return;

    const timestampValue = checkbox.checked ? new Date().toISOString() : null;
    timestampSpan.textContent = timestampValue ? formatTimestamp(timestampValue) : '';
    updateStageDoneVisualState(checkbox);
    updateStageProgressSummary();

    try {
        const response = await fetch(`${API_BASE}/orders/${activeOrderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [timestampField]: timestampValue })
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to update stage status');
            return;
        }
        applyUpdatedOrderLocally(result.order);
        if (currentOrder && currentOrder.id === result.order.id) currentOrder = result.order;
        hideError();
    } catch (error) {
        console.error('Error updating stage status:', error);
        showError('Failed to update stage status');
    }
}
function updateStageDoneVisualState(checkbox) {
    if (!checkbox) return;
    const card = checkbox.closest('.stage-done-item');
    if (!card) return;
    card.classList.toggle('done', Boolean(checkbox.checked));
}

function updateStageProgressSummary() {
    const summary = document.getElementById('stageProgressSummary');
    if (!summary) return;

    const checkboxes = Object.keys(STAGE_DONE_FIELDS)
        .map(id => document.getElementById(id))
        .filter(Boolean);

    const total = checkboxes.length;
    const completed = checkboxes.filter(checkbox => checkbox.checked).length;
    summary.textContent = `${completed}/${total} complete`;
}

function formatTimestamp(isoString) {
    if (!isoString) return '';
    try {
        // Parse ISO string or SQL datetime format
        const date = new Date(isoString.replace(' ', 'T'));
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = String(date.getFullYear()).substring(2);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${month}/${day}/${year} ${hours}:${minutes}`;
    } catch (e) {
        return isoString;
    }
}

// ===== Autosave =====

function scheduleAutosave() {
    // Only autosave for existing orders
    if (!currentOrder || !currentOrder.id) return;
    
    // Clear any existing timeout
    if (autosaveTimeout) {
        clearTimeout(autosaveTimeout);
    }
    
    // Schedule new autosave
    autosaveTimeout = setTimeout(async () => {
        await performAutosave();
    }, AUTOSAVE_DELAY);
}

async function performAutosave() {
    if (!currentOrder || !currentOrder.id) return;
    
    try {
        // Collect form data
        const formData = new FormData(orderForm);
        const data = {};
        
        formData.forEach((value, key) => {
            data[key] = value.trim() === '' ? null : value;
        });

        const needsPrefitCheckbox = document.getElementById('needs_prefit');
        const broughtDoorCheckbox = document.getElementById('prefit_customer_brought_door');
        const ventTopCheckbox = document.getElementById('prefit_vent_top');
        const ventBottomCheckbox = document.getElementById('prefit_vent_bottom');
        if (needsPrefitCheckbox) data.needs_prefit = needsPrefitCheckbox.checked ? 1 : 0;
        if (broughtDoorCheckbox) data.prefit_customer_brought_door = broughtDoorCheckbox.checked ? 1 : 0;
        if (ventTopCheckbox) data.prefit_vent_top = ventTopCheckbox.checked ? 1 : 0;
        if (ventBottomCheckbox) data.prefit_vent_bottom = ventBottomCheckbox.checked ? 1 : 0;

        // Autosave is the riskiest writer (fires silently on any input): route it
        // through the cross-order guard so a debounced save can never land on an
        // order the form has since navigated away from.
        const autosaveTargetId = currentOrder.id;
        const { ok, status, result } = await putOrder(autosaveTargetId, data, { source: 'autosave' });

        if (ok) {
            console.log('Autosaved order', autosaveTargetId);
        } else if (status === 409) {
            console.warn('Autosave blocked as cross-order for', autosaveTargetId);
        }
    } catch (error) {
        console.error('Autosave failed:', error);
    }
}

function convertTimestampToISO(timestampText) {
    // Convert "MM/DD/YY HH:MM" format back to ISO
    if (!timestampText) return null;
    try {
        const [datePart, timePart] = timestampText.split(' ');
        const [month, day, year] = datePart.split('/');
        const fullYear = '20' + year;
        const [hours, minutes] = timePart.split(':');
        return `${fullYear}-${month}-${day}T${hours}:${minutes}:00`;
    } catch (e) {
        return timestampText;
    }
}

// Setup autosave listeners on form inputs
document.addEventListener('DOMContentLoaded', () => {

    // Add autosave to all form inputs
    const formInputs = orderForm.querySelectorAll('input, select, textarea');
    formInputs.forEach(input => {
        input.addEventListener('change', () => {
            scheduleAutosave();
        });
        input.addEventListener('input', () => {
            scheduleAutosave();
        });
    });
});

// ===== Stage Navigation Functions =====

function updateStageNavButtons() {
    const stageSelect = document.getElementById('stage');
    const currentStage = stageSelect.value;
    const prevBtn = document.getElementById('prevStageBtn');
    const nextBtn = document.getElementById('nextStageBtn');
    
    if (!currentStage || !STAGES.includes(currentStage)) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }
    
    const currentIndex = STAGES.indexOf(currentStage);
    prevBtn.disabled = (currentIndex === 0);
    nextBtn.disabled = (currentIndex === STAGES.length - 1);
}

function previousStage() {
    const stageSelect = document.getElementById('stage');
    const currentStage = stageSelect.value;
    
    if (!currentStage || !STAGES.includes(currentStage)) {
        showError('Invalid stage selected');
        return;
    }
    
    const currentIndex = STAGES.indexOf(currentStage);
    if (currentIndex > 0) {
        const previousStageValue = stageSelect.value;
        stageSelect.value = STAGES[currentIndex - 1];
        syncPriorityInputWithStage(stageSelect, document.getElementById('priority_manual'), previousStageValue);
        updateStageNavButtons();
        showToast('Moved to previous stage');
    }
}

function nextStage() {
    const stageSelect = document.getElementById('stage');
    const currentStage = stageSelect.value;
    
    if (!currentStage || !STAGES.includes(currentStage)) {
        showError('Invalid stage selected');
        return;
    }
    
    const currentIndex = STAGES.indexOf(currentStage);
    if (currentIndex < STAGES.length - 1) {
        const previousStageValue = stageSelect.value;
        stageSelect.value = STAGES[currentIndex + 1];
        syncPriorityInputWithStage(stageSelect, document.getElementById('priority_manual'), previousStageValue);
        updateStageNavButtons();
        showToast('Moved to next stage');
    }
}

// ===== Archive Functions =====

async function toggleArchiveOrder() {
    if (!currentOrder || !currentOrder.id) {
        showError('No order selected');
        return;
    }
    
    const isArchived = currentOrder.archived === 1;
    const action = isArchived ? 'unarchive' : 'archive';
    const actionText = isArchived ? 'restore' : 'archive';
    const confirmed = await showThemedConfirm({
        title: isArchived ? 'Restore Order' : 'Archive Order',
        message: `Are you sure you want to ${actionText} this order?\n\nCustomer: ${currentOrder.customer_name || 'N/A'}\nProject: ${currentOrder.project_name || 'N/A'}`,
        confirmLabel: isArchived ? 'Restore' : 'Archive',
        confirmClass: isArchived ? 'btn btn-success' : 'btn',
    });
    
    if (!confirmed) return;
    
    try {
        const response = await fetch(`${API_BASE}/orders/${currentOrder.id}/${action}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(isArchived ? 'Order restored successfully!' : 'Order archived successfully!');
            closeOrderModal();
            loadOrders();
        } else {
            showError(result.error || 'Failed to update order');
        }
    } catch (error) {
        console.error(`Error ${actionText}ing order:`, error);
        showError(`Failed to ${actionText} order`);
    }
}

