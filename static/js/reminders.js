// ===== Reminders Functions =====

const remindersModal = document.getElementById('remindersModal');
const remindersBtn = document.getElementById('remindersBtn');
let notificationPermission = 'default';
let reminderCheckInterval = null;
let lastShownReminderIds = new Set();
let editingReminderId = null;

// Initialize reminders button listener
if (remindersBtn) {
    remindersBtn.addEventListener('click', () => {
        openRemindersModal();
    });
}

// Request notification permission on app load
function initializeNotifications() {
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            notificationPermission = 'granted';
            console.log('✅ Notifications already permitted');
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                notificationPermission = permission;
                if (permission === 'granted') {
                    console.log('✅ Notifications permission granted');
                } else {
                    console.log('⚠️ Notifications permission denied');
                }
            });
        }
    } else {
        console.log('⚠️ Browser does not support notifications');
    }
}

// Show browser notification
function showBrowserNotification(title, options = {}) {
    if ('Notification' in window && notificationPermission === 'granted') {
        try {
            new Notification(title, {
                icon: '⏰',
                badge: '⏰',
                ...options
            });
        } catch (e) {
            console.error('Failed to show notification:', e);
        }
    }
}

// Check for due reminders and show notifications
async function checkDueReminders() {
    try {
        const response = await fetch(`${API_BASE}/reminders/due`);
        const data = await response.json();
        
        if (data.success && data.reminders) {
            for (const reminder of data.reminders) {
                // Only show each reminder once
                if (!lastShownReminderIds.has(reminder.id)) {
                    lastShownReminderIds.add(reminder.id);
                    
                    let notificationTitle = `📋 Reminder: ${reminder.title}`;
                    let notificationBody = '';
                    
                    if (reminder.customer_name) {
                        notificationBody += `Customer: ${reminder.customer_name}\n`;
                    }
                    if (reminder.project_name) {
                        notificationBody += `Project: ${reminder.project_name}\n`;
                    }
                    
                    // Show browser notification
                    showBrowserNotification(notificationTitle, {
                        body: notificationBody.trim() || 'This reminder is due',
                        tag: `reminder-${reminder.id}`,
                        requireInteraction: true
                    });
                    
                    // Also show visual alert in app
                    showToast(`Reminder Due: ${reminder.title}`);
                }
            }
        }
    } catch (error) {
        console.error('Error checking due reminders:', error);
    }
}

// Start periodic reminder checking (every 60 seconds)
function startReminderChecking() {
    if (reminderCheckInterval) {
        clearInterval(reminderCheckInterval);
    }
    reminderCheckInterval = setInterval(checkDueReminders, 60000);
    console.log('✅ Reminder checking started (every 60 seconds)');
}

// Stop reminder checking
function stopReminderChecking() {
    if (reminderCheckInterval) {
        clearInterval(reminderCheckInterval);
        reminderCheckInterval = null;
    }
}

function openRemindersModal() {
    remindersModal.style.display = 'block';
    loadReminders();
}

function closeRemindersModal() {
    remindersModal.style.display = 'none';
    cancelAddReminder();
}

function showAddReminderForm() {
    document.getElementById('addReminderForm').style.display = 'block';
    updateReminderFormMode();
    // Set default date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDateInput = document.getElementById('reminder_due_date');
    if (dueDateInput && !dueDateInput.value) {
        dueDateInput.value = tomorrow.toISOString().split('T')[0];
    }
}

function prefillReminderFormForOrder(order, force = false) {
    if (!order || !order.id) return;

    const titleInput = document.getElementById('reminder_title');
    const guestInput = document.getElementById('reminder_guest');
    const orderIdInput = document.getElementById('reminder_order_id');

    const customerName = String(order.customer_name || '').trim();
    const projectName = String(order.project_name || '').trim();
    const poRaw = String(order.po_numbers_display || order.po_numbers || order.po_number || '').trim();
    const firstPo = poRaw ? poRaw.split(/[,\n]/)[0].trim() : '';

    if (orderIdInput) {
        orderIdInput.value = order.id;
    }

    if (guestInput && (force || !guestInput.value)) {
        guestInput.value = customerName || String(order.customer_phone || '').trim();
    }

    if (titleInput && (force || !titleInput.value)) {
        const titleParts = [];
        if (customerName) titleParts.push(customerName);
        if (projectName) titleParts.push(projectName);
        if (firstPo) titleParts.push(`PO ${firstPo}`);
        titleInput.value = titleParts.length > 0
            ? `Follow up - ${titleParts.join(' - ')}`
            : `Follow up - Order #${order.id}`;
    }
}

function cancelAddReminder() {
    document.getElementById('addReminderForm').style.display = 'none';
    editingReminderId = null;
    updateReminderFormMode();
    // Clear form
    document.getElementById('reminder_title').value = '';
    document.getElementById('reminder_due_date').value = '';
    document.getElementById('reminder_due_time').value = '09:00';
    document.getElementById('reminder_repeat').value = '';
    document.getElementById('reminder_guest').value = '';
    document.getElementById('reminder_order_id').value = '';
}

function updateReminderFormMode() {
    const formTitle = document.getElementById('reminderFormTitle');
    const saveBtn = document.getElementById('saveReminderBtn');

    if (formTitle) {
        formTitle.textContent = editingReminderId ? 'Edit Reminder' : 'New Reminder';
    }
    if (saveBtn) {
        saveBtn.textContent = editingReminderId ? 'Update Reminder' : 'Save Reminder';
    }
}

function formatDateForInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function formatTimeForInput(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

async function editReminder(reminderId) {
    try {
        const response = await fetch(`${API_BASE}/reminders/${reminderId}`);
        const result = await response.json();

        if (!result.success || !result.reminder) {
            showError(result.error || 'Failed to load reminder');
            return;
        }

        const reminder = result.reminder;
        const dueDate = new Date(reminder.due_at);

        openRemindersModal();
        showAddReminderForm();

        editingReminderId = reminder.id;
        updateReminderFormMode();

        document.getElementById('reminder_title').value = reminder.title || '';
        document.getElementById('reminder_repeat').value = reminder.repeat || '';
        document.getElementById('reminder_guest').value = reminder.guest || '';
        document.getElementById('reminder_order_id').value = reminder.order_id || '';

        if (!Number.isNaN(dueDate.getTime())) {
            document.getElementById('reminder_due_date').value = formatDateForInput(dueDate);
            document.getElementById('reminder_due_time').value = formatTimeForInput(dueDate);
        }

        document.getElementById('reminder_title').focus();
    } catch (error) {
        console.error('Error loading reminder for edit:', error);
        showError('Failed to load reminder for edit');
    }
}

// Quick add reminder for current order (from order details panel)
function quickAddReminderForOrder() {
    const activeOrder = currentOrder || getSelectedOrder();
    if (!activeOrder || !activeOrder.id) {
        alert('Please select an order first');
        return;
    }
    
    openRemindersModal();
    showAddReminderForm();
    prefillReminderFormForOrder(activeOrder);

    const saveBtn = document.getElementById('saveReminderBtn');
    if (saveBtn) {
        saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    document.getElementById('reminder_title').focus();
}

// Load and display reminders for current order
async function loadOrderReminders() {
    const activeOrder = currentOrder || getSelectedOrder();
    if (!activeOrder || !activeOrder.id) {
        const container = document.getElementById('orderRemindersPanel');
        if (container) {
            container.innerHTML = `
                <h3>
                    ⏰ Reminders for this Order
                    <button type="button" class="btn btn-sm btn-secondary" onclick="quickAddReminderForOrder()" title="Add reminder for this order">➕ Add</button>
                </h3>
                <p style="color: #999; font-style: italic;">Select an order to view reminders</p>
            `;
        }
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/reminders?order_id=${activeOrder.id}`);
        const data = await response.json();
        
        if (data.success) {
            displayOrderReminders(data.reminders || []);
        }
    } catch (error) {
        console.error('Error loading order reminders:', error);
    }
}

function displayOrderReminders(reminders) {
    const container = document.getElementById('orderRemindersPanel');
    if (!container) return;
    
    if (!reminders || reminders.length === 0) {
        container.innerHTML = '<p style="color: #999; font-style: italic;">No reminders for this order</p>';
        return;
    }
    
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    let html = '<div class="order-reminders-list">';
    
    for (const reminder of reminders) {
        const dueDate = new Date(reminder.due_at);
        const timeUntil = dueDate - now;
        const isOverdue = timeUntil < 0;
        const isDueSoon = timeUntil > 0 && timeUntil < oneDayMs;
        const isCompleted = reminder.done === 1;
        
        let statusClass = '';
        if (isCompleted) statusClass = 'completed';
        else if (isOverdue) statusClass = 'overdue';
        else if (isDueSoon) statusClass = 'due-soon';
        
        const dueDateStr = formatReminderDate(dueDate);
        
        html += `
            <div class="reminder-item-compact ${statusClass}">
                <div class="reminder-compact-header">
                    <span class="reminder-status">${statusClass === 'completed' ? '✓' : '⚠️'}</span>
                    <span class="reminder-title">${escapeHtml(reminder.title)}</span>
                </div>
                <div class="reminder-compact-meta">
                    <span>📅 ${dueDateStr}</span>
                    ${reminder.guest ? `<span>👤 ${escapeHtml(reminder.guest)}</span>` : ''}
                </div>
                <div class="reminder-compact-actions">
                    ${!isCompleted ? `<button class="btn-icon" onclick="completeReminder(${reminder.id})" title="Complete">✓</button>` : ''}
                    <button class="btn-icon" onclick="editReminder(${reminder.id})" title="Edit">✏️</button>
                    <button class="btn-icon" onclick="deleteReminder(${reminder.id})" title="Delete">🗑️</button>
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    container.innerHTML = html;
}

async function saveNewReminder() {
    const title = document.getElementById('reminder_title').value.trim();
    const date = document.getElementById('reminder_due_date').value;
    const time = document.getElementById('reminder_due_time').value;
    const repeat = document.getElementById('reminder_repeat').value;
    const guest = document.getElementById('reminder_guest').value.trim();
    const orderId = document.getElementById('reminder_order_id').value;
    
    if (!title) {
        alert('Please enter a title');
        return;
    }
    
    if (!date) {
        alert('Please select a due date');
        return;
    }
    
    // Combine date and time into ISO format
    const dueAt = `${date}T${time}:00`;
    
    const data = {
        title: title,
        due_at: dueAt,
        repeat: repeat || null,
        guest: guest || null,
        order_id: orderId ? parseInt(orderId) : null
    };
    
    try {
        const isEdit = Boolean(editingReminderId);
        const url = isEdit ? `${API_BASE}/reminders/${editingReminderId}` : `${API_BASE}/reminders`;
        const method = isEdit ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(isEdit ? 'Reminder updated successfully!' : 'Reminder created successfully!');
            cancelAddReminder();
            loadReminders();
            loadOrderReminders();
        } else {
            showError(result.error || 'Failed to create reminder');
        }
    } catch (error) {
        console.error('Error creating reminder:', error);
        showError('Failed to create reminder');
    }
}

async function loadReminders() {
    const showCompleted = document.getElementById('showCompletedReminders').checked;
    
    try {
        const params = new URLSearchParams();
        params.append('show_done', showCompleted);
        
        const response = await fetch(`${API_BASE}/reminders?${params.toString()}`);
        const data = await response.json();
        
        if (data.success) {
            renderReminders(data.reminders);
        } else {
            showError(data.error || 'Failed to load reminders');
        }
    } catch (error) {
        console.error('Error loading reminders:', error);
        showError('Failed to load reminders');
    }
}

function renderReminders(reminders) {
    const container = document.getElementById('remindersList');
    
    if (!reminders || reminders.length === 0) {
        container.innerHTML = '<div class="reminders-empty">No reminders yet</div>';
        return;
    }
    
    const now = new Date();
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    container.innerHTML = reminders.map(reminder => {
        const dueDate = new Date(reminder.due_at);
        const timeUntil = dueDate - now;
        const isOverdue = timeUntil < 0;
        const isDueSoon = timeUntil > 0 && timeUntil < oneDayMs;
        const isCompleted = reminder.done === 1;
        
        let statusClass = '';
        if (isCompleted) statusClass = 'completed';
        else if (isOverdue) statusClass = 'overdue';
        else if (isDueSoon) statusClass = 'due-soon';
        
        const dueDateStr = formatReminderDate(dueDate);
        
        let infoHtml = `<div class="reminder-due-date">📅 Due: ${dueDateStr}</div>`;
        
        if (reminder.guest) {
            infoHtml += `<div>👤 ${escapeHtml(reminder.guest)}</div>`;
        }
        
        if (reminder.order_id) {
            const orderInfo = reminder.customer_name || `Order #${reminder.order_id}`;
            infoHtml += `<div>📋 ${escapeHtml(orderInfo)}</div>`;
        }
        
        if (reminder.repeat) {
            infoHtml += `<div>🔁 ${reminder.repeat}</div>`;
        }
        
        let actionsHtml = '';
        if (!isCompleted) {
            actionsHtml = `
                <button class="btn btn-sm btn-success" onclick="completeReminder(${reminder.id})">✓ Complete</button>
                <button class="btn btn-sm btn-secondary" onclick="editReminder(${reminder.id})">✏️ Edit</button>
                <button class="btn btn-sm btn-secondary" onclick="snoozeReminder(${reminder.id})">💤 Snooze</button>
                <button class="btn btn-sm btn-danger" onclick="deleteReminder(${reminder.id})">🗑️ Delete</button>
            `;
        } else {
            actionsHtml = `
                <button class="btn btn-sm btn-secondary" onclick="editReminder(${reminder.id})">✏️ Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteReminder(${reminder.id})">🗑️ Delete</button>
            `;
        }
        
        return `
            <div class="reminder-item ${statusClass}">
                <div class="reminder-header">
                    <div class="reminder-title">${escapeHtml(reminder.title)}</div>
                </div>
                <div class="reminder-info">
                    ${infoHtml}
                </div>
                <div class="reminder-actions-buttons" style="margin-top: 8px;">
                    ${actionsHtml}
                </div>
            </div>
        `;
    }).join('');
}

function formatReminderDate(date) {
    const now = new Date();
    const dayMs = 1000 * 60 * 60 * 24;
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDue = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayDiff = Math.round((startOfDue - startOfToday) / dayMs);
    const timeText = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Overdue is based on actual timestamp, but labels use calendar day buckets.
    if (date < now) {
        if (dayDiff === 0) {
            return `Today at ${timeText} (OVERDUE)`;
        }
        if (dayDiff === -1) {
            return `Yesterday at ${timeText} (OVERDUE)`;
        }
        return `${Math.abs(dayDiff)} days ago (OVERDUE)`;
    }

    if (dayDiff === 0) {
        return `Today at ${timeText}`;
    }
    if (dayDiff === 1) {
        return `Tomorrow at ${timeText}`;
    }
    if (dayDiff > 1 && dayDiff < 7) {
        return `${date.toLocaleDateString('en-US', { weekday: 'long' })} at ${timeText}`;
    }

    return `${date.toLocaleDateString()} at ${timeText}`;
}

async function completeReminder(reminderId) {
    try {
        const response = await fetch(`${API_BASE}/reminders/${reminderId}/complete`, {
            method: 'PUT'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Reminder completed!');
            loadReminders();
            loadOrderReminders();
        } else {
            showError(result.error || 'Failed to complete reminder');
        }
    } catch (error) {
        console.error('Error completing reminder:', error);
        showError('Failed to complete reminder');
    }
}

async function snoozeReminder(reminderId) {
    const minutes = prompt('Snooze for how many minutes?', '30');
    if (!minutes) return;
    
    try {
        const response = await fetch(`${API_BASE}/reminders/${reminderId}/snooze`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ minutes: parseInt(minutes) })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`Reminder snoozed for ${minutes} minutes`);
            loadReminders();
            loadOrderReminders();
        } else {
            showError(result.error || 'Failed to snooze reminder');
        }
    } catch (error) {
        console.error('Error snoozing reminder:', error);
        showError('Failed to snooze reminder');
    }
}

async function deleteReminder(reminderId) {
    if (!confirm('Delete this reminder?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/reminders/${reminderId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Reminder deleted');
            loadReminders();
            loadOrderReminders();
        } else {
            showError(result.error || 'Failed to delete reminder');
        }
    } catch (error) {
        console.error('Error deleting reminder:', error);
        showError('Failed to delete reminder');
    }
}

// Close modal when clicking outside
window.addEventListener('click', function(event) {
    if (event.target === remindersModal) {
        closeRemindersModal();
    }
});
