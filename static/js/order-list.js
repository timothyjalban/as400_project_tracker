// ===== Order List: Load, Sort, Render =====

// Load stages from API
async function loadStages() {
    try {
        const response = await fetch(`${API_BASE}/stages`);
        const data = await response.json();
        
        if (data.success) {
            const loadedStages = Array.isArray(data.stages) ? data.stages : [];
            stages = loadedStages.length > 0 ? loadedStages : [...STAGES];
            populateStageFilter(stages);
        }
    } catch (error) {
        console.error('Error loading stages:', error);
        stages = [...STAGES];
        populateStageFilter(stages);
    }
}

// Populate stage filter dropdown
function populateStageFilter(stages) {
    // Keep the (All) option
    stageFilter.innerHTML = '<option value="">(All)</option>';
    
    stages.forEach(stage => {
        const option = document.createElement('option');
        option.value = stage;
        option.textContent = stage;
        stageFilter.appendChild(option);
    });
}

// Load orders from API
async function loadOrders() {
    showLoading(true);
    hideError();

    if (ordersSearchInput && ordersSearchInput.value !== searchInput.value) {
        ordersSearchInput.value = searchInput.value;
    }
    
    const search = searchInput.value.trim();
    const stage = stageFilter.value;
    const showCompleted = showCompletedCheckbox.checked;
    
    const params = new URLSearchParams({
        search,
        stage,
        show_completed: showCompleted
    });

    // Stamp this request; discard the response if a newer one has already resolved.
    loadOrdersSequence += 1;
    const thisSequence = loadOrdersSequence;
    
    try {
        const response = await fetch(`${API_BASE}/orders?${params}`);

        if (response.status === 401) {
            const nextUrl = `${window.location.pathname}${window.location.search}`;
            window.location.href = `/login?next=${encodeURIComponent(nextUrl)}`;
            return;
        }

        if (!response.ok) {
            throw new Error(`Orders request failed: ${response.status}`);
        }

        const data = await response.json();

        // A newer loadOrders() call already finished — ignore this stale response.
        if (thisSequence !== loadOrdersSequence) return;
        
        if (data.success) {
            const previousSelectedOrderId = selectedOrderId;
            const incoming = sortOrdersForList(data.orders || []);
            const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(incoming);

            // Only replace allOrders when we actually got results, OR there is no
            // active search/filter (user genuinely wants to see an empty list).
            const isFiltered = Boolean(search || (stage && stage !== '(All)'));
            if (incoming.length > 0 || !isFiltered) {
                allOrders = incoming;
            }

            if (allOrders.length === 0) {
                selectedOrderId = null;
            } else if (!selectedOrderId || !allOrders.some(order => order.id === selectedOrderId)) {
                const preferredOrder = activeOrders[0] || completedOrders[0];
                selectedOrderId = preferredOrder ? preferredOrder.id : null;
            }

            if (selectedOrderId !== previousSelectedOrderId) {
                const selectedOrder = getSelectedOrder();
                openProcessStages = new Set();
                if (selectedOrder && selectedOrder.stage && STAGES.includes(selectedOrder.stage)) {
                    openProcessStages.add(selectedOrder.stage);
                }
            }

            renderOrdersTable(activeOrders);
            renderCompletedOrders(completedOrders);
            renderSalesProcess(getSelectedOrder());
            updateOrdersCount(data.count, activeOrders.length, completedOrders.length);
        } else {
            showError(data.error || 'Failed to load orders');
        }
    } catch (error) {
        console.error('Error loading orders:', error);
        showError('Failed to connect to server. Is the Flask app running?');
    } finally {
        showLoading(false);
    }
}

function splitOrdersByArchiveStatus(orders) {
    const activeOrders = [];
    const completedOrders = [];

    orders.forEach(order => {
        if (Number(order?.archived || 0) === 1) {
            completedOrders.push(order);
        } else {
            activeOrders.push(order);
        }
    });

    return { activeOrders, completedOrders };
}

function sortOrdersForList(orders) {
    return [...orders].sort((a, b) => {
        const aPinned = Number(a?.is_pinned || 0);
        const bPinned = Number(b?.is_pinned || 0);
        if (aPinned !== bPinned) {
            return bPinned - aPinned;
        }

        const aId = Number(a?.id || 0);
        const bId = Number(b?.id || 0);
        return bId - aId;
    });
}

const ORDER_AVATAR_COLOR_CLASSES = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];

function getOrderInitials(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '?';
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getOrderAvatarColorClass(order) {
    const key = String(order?.id ?? order?.customer_name ?? '');
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return ORDER_AVATAR_COLOR_CLASSES[hash % ORDER_AVATAR_COLOR_CLASSES.length];
}

// Render orders in table
function renderOrdersTable(orders) {
    if (!ordersList) return;

    if (orders.length === 0) {
        ordersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p>No orders found</p>
            </div>
        `;

        return;
    }    
    const sortedOrders = sortOrdersForList(orders);

    ordersList.innerHTML = sortedOrders.map(order => {
        const isActive = order.id === selectedOrderId;
        const isPinned = Number(order.is_pinned || 0) === 1;
        const isFlagged = Number(order.is_flagged || 0) === 1;
        const hasCustomerNumber = Boolean(String(order.customer_number || '').trim());
        const streetOnlyAddress = getStreetOnlyAddress(order);
        const itemClasses = [
            'order-list-item',
            isActive ? 'active' : '',
            isPinned ? 'is-pinned' : '',
            isFlagged ? 'is-flagged' : ''
        ].filter(Boolean).join(' ');

        const initials = getOrderInitials(order.customer_name);
        const avatarColorClass = getOrderAvatarColorClass(order);

        return `
            <div class="${itemClasses}" role="button" tabindex="0" onclick="selectOrder(${order.id})" ondblclick="viewOrderDetails(${order.id})" onkeydown="handleOrderListItemKey(event, ${order.id})">
                <div class="order-list-top">
                    <div class="order-list-top-left">
                        <div class="order-list-avatar ${avatarColorClass}">${escapeHtml(initials)}</div>
                        <span class="order-list-customer">${escapeHtml(order.customer_name || 'Unnamed Customer')}</span>
                        ${isPinned ? '<span class="order-status-chip pinned" title="Pinned">Pinned</span>' : ''}
                        ${isFlagged ? '<span class="order-status-chip flagged" title="Flagged">Flagged</span>' : ''}
                        ${hasCustomerNumber ? `<span class="order-status-chip account" title="Copy account number" onclick="copyOrderAccountNumber(event, '${encodeURIComponent(String(order.customer_number || ''))}')">Acct ${escapeHtml(order.customer_number)}</span>` : ''}
                        ${streetOnlyAddress ? `<span class="order-status-chip address" title="${escapeHtml(streetOnlyAddress)}">${escapeHtml(streetOnlyAddress)}</span>` : ''}
                    </div>
                    <div class="order-list-actions">
                        <div class="order-list-icon-actions">
                            <button class="order-icon-btn" title="Add reminder" onclick="openReminderForOrder(event, ${order.id})">⏰</button>
                            <button class="order-icon-btn ${isPinned ? 'active' : ''}" title="${isPinned ? 'Unpin order' : 'Pin order'}" onclick="toggleOrderPin(event, ${order.id})">📌</button>
                            <button class="order-icon-btn ${isFlagged ? 'active' : ''}" title="${isFlagged ? 'Unflag order' : 'Flag order'}" onclick="toggleOrderFlag(event, ${order.id})">🚩</button>
                        </div>
                        <span class="order-list-id">#${order.id || ''}</span>
                    </div>
                </div>
                <div class="order-list-project">${escapeHtml(order.project_name || 'No project name')}</div>
                <div class="order-list-meta">
                    <span class="stage-badge">${escapeHtml(formatStageLabel(order.stage || ''))}</span>
                    <span>${escapeHtml(order.po_numbers_display || order.po_numbers || order.po_number || 'No PO')}</span>
                </div>
            </div>
        `;
    }).join('');
}

function renderCompletedOrders(orders) {
    if (!completedOrdersPanel || !completedOrdersList || !showCompletedCheckbox) return;

    if (!showCompletedCheckbox.checked) {
        completedOrdersPanel.style.display = 'none';
        return;
    }

    completedOrdersPanel.style.display = 'block';
    if (completedOrdersCount) {
        completedOrdersCount.textContent = `${orders.length}`;
    }

    if (orders.length === 0) {
        completedOrdersList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">✅</div>
                <p>No completed orders found</p>
            </div>
        `;

        return;
    }
    completedOrdersList.innerHTML = orders.map(order => {
        const isActive = order.id === selectedOrderId;
        const hasCustomerNumber = Boolean(String(order.customer_number || '').trim());
        const streetOnlyAddress = getStreetOnlyAddress(order);
        const itemClasses = ['order-list-item', 'completed-order-item', isActive ? 'active' : '']
            .filter(Boolean)
            .join(' ');

        const initials = getOrderInitials(order.customer_name);
        const avatarColorClass = getOrderAvatarColorClass(order);

        return `
            <div class="${itemClasses}" role="button" tabindex="0" onclick="selectOrder(${order.id})" ondblclick="viewOrderDetails(${order.id})" onkeydown="handleOrderListItemKey(event, ${order.id})">
                <div class="order-list-top">
                    <div class="order-list-top-left">
                        <div class="order-list-avatar ${avatarColorClass}">${escapeHtml(initials)}</div>
                        <span class="order-list-customer">${escapeHtml(order.customer_name || 'Unnamed Customer')}</span>
                        <span class="order-status-chip completed" title="Completed">Completed</span>
                        ${hasCustomerNumber ? `<span class="order-status-chip account" title="Copy account number" onclick="copyOrderAccountNumber(event, '${encodeURIComponent(String(order.customer_number || ''))}')">Acct ${escapeHtml(order.customer_number)}</span>` : ''}
                        ${streetOnlyAddress ? `<span class="order-status-chip address" title="${escapeHtml(streetOnlyAddress)}">${escapeHtml(streetOnlyAddress)}</span>` : ''}
                    </div>
                    <div class="order-list-actions">
                        <div class="order-list-icon-actions">
                            <button class="order-icon-btn" title="Add reminder" onclick="openReminderForOrder(event, ${order.id})">⏰</button>
                        </div>
                        <span class="order-list-id">#${order.id || ''}</span>
                    </div>
                </div>
                <div class="order-list-project">${escapeHtml(order.project_name || 'No project name')}</div>
                <div class="order-list-meta">
                    <span class="stage-badge">${escapeHtml(formatStageLabel(order.stage || ''))}</span>
                    <span>${escapeHtml(order.po_numbers_display || order.po_numbers || order.po_number || 'No PO')}</span>
                </div>
            </div>
        `;
    }).join('');
}

function getSelectedOrder() {
    if (!selectedOrderId) return null;
    return allOrders.find(order => order.id === selectedOrderId) || null;
}

function getStreetOnlyAddress(order) {
    if (!order) return '';

    const rawAddress = String(
        order.address_street || order.delivery_street || order.install_street || ''
    ).trim();

    if (!rawAddress) return '';

    return rawAddress.split(',')[0].trim();
}

