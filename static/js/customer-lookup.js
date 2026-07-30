// ===== Customer Lookup & Profile Modals =====
// customerLookupModal/customerProfileModal are declared in app.js (used there too, by the
// shared keydown/window.onclick handlers), and shared via the browser's classic-script
// global scope - not redeclared here.

function openCustomerLookupModal() {
    if (!customerLookupModal) return;

    customerLookupModal.style.display = 'block';
    const queryInput = document.getElementById('customerLookupQuery');
    const hasAccountOnly = document.getElementById('customerLookupHasAccountOnly');
    const results = document.getElementById('customerLookupResults');

    if (results) {
        results.innerHTML = '<div class="empty-state">Loading recent customers...</div>';
    }

    if (queryInput) {
        if (!queryInput.dataset.lookupBound) {
            queryInput.addEventListener('input', () => {
                if (customerLookupDebounce) clearTimeout(customerLookupDebounce);
                customerLookupDebounce = setTimeout(() => {
                    searchCustomerDirectory(queryInput.value || '');
                }, 250);
            });

            queryInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    searchCustomerDirectory(queryInput.value || '');
                }
            });

            queryInput.dataset.lookupBound = 'true';
        }

        if (hasAccountOnly && !hasAccountOnly.dataset.lookupBound) {
            hasAccountOnly.addEventListener('change', () => {
                searchCustomerDirectory(queryInput.value || '');
            });
            hasAccountOnly.dataset.lookupBound = 'true';
        }

        searchCustomerDirectory(queryInput.value || '');
        setTimeout(() => queryInput.focus(), 0);
    }
}

function closeCustomerLookupModal() {
    if (!customerLookupModal) return;
    customerLookupModal.style.display = 'none';
}

async function searchCustomerDirectory(rawQuery) {
    const query = String(rawQuery || '').trim();
    const results = document.getElementById('customerLookupResults');
    const hasAccountOnly = document.getElementById('customerLookupHasAccountOnly');
    if (!results) return;

    const includeRecent = query.length < 2;
    const hasAccountOnlyValue = hasAccountOnly ? hasAccountOnly.checked : false;

    results.innerHTML = '<div class="empty-state">Searching customers...</div>';

    try {
        const params = new URLSearchParams();
        params.set('limit', '50');
        params.set('include_recent', includeRecent ? 'true' : 'false');
        params.set('has_account_only', hasAccountOnlyValue ? 'true' : 'false');
        if (query.length >= 2) {
            params.set('q', query);
        }

        const response = await fetch(`${API_BASE}/customers/search?${params.toString()}`);
        const data = await response.json();

        if (!data.success) {
            results.innerHTML = `<div class="empty-state">${escapeHtml(data.error || 'Search failed')}</div>`;
            return;
        }

        currentLookupCustomers = Array.isArray(data.customers) ? data.customers : [];
        if (currentLookupCustomers.length === 0) {
            results.innerHTML = '<div class="empty-state">No customers found.</div>';
            return;
        }

        const resultsMarkup = currentLookupCustomers.map((customer, index) => {
            const account = String(customer.customer_number || '').trim();
            return `
                <div class="customer-lookup-item">
                    <div class="customer-lookup-name">${escapeHtml(customer.customer_name || 'Unknown Customer')}</div>
                    <div class="customer-lookup-meta">
                        <span>Phone: ${escapeHtml(customer.customer_phone || 'N/A')}</span>
                        <span>Email: ${escapeHtml(customer.customer_email || 'N/A')}</span>
                        <span>Acct #: ${escapeHtml(account || 'N/A')}</span>
                        <span>Last Order: #${escapeHtml(String(customer.last_order_id || 'N/A'))}</span>
                        <span>Updated: ${escapeHtml(formatDate(customer.last_updated) || 'Unknown')}</span>
                    </div>
                    <div class="customer-lookup-actions">
                        <button type="button" class="btn btn-primary btn-sm" onclick="openCustomerProfileFromLookup(${index})">View Profile</button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="useLookupCustomerForNewOrder(${index})">Use for New Order</button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="copyCustomerLookupValueFromEncoded('${encodeURIComponent(account)}', 'account number')" ${account ? '' : 'disabled'}>Copy Acct #</button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="copyCustomerLookupValueFromEncoded('${encodeURIComponent(String(customer.customer_phone || ''))}', 'phone')" ${customer.customer_phone ? '' : 'disabled'}>Copy Phone</button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="copyCustomerLookupValueFromEncoded('${encodeURIComponent(String(customer.customer_email || ''))}', 'email')" ${customer.customer_email ? '' : 'disabled'}>Copy Email</button>
                    </div>
                </div>
            `;
        }).join('');

        const headingMarkup = includeRecent
            ? '<div class="customer-lookup-section-title">Recent Customers</div>'
            : '';

        results.innerHTML = `${headingMarkup}${resultsMarkup}`;
    } catch (error) {
        console.error('Customer search failed:', error);
        results.innerHTML = '<div class="empty-state">Failed to search customers.</div>';
    }
}

function copyCustomerLookupValueFromEncoded(encodedValue, label) {
    const decoded = decodeURIComponent(String(encodedValue || ''));
    return copyCustomerLookupValue(decoded, label);
}

function copyOrderAccountNumber(event, encodedValue) {
    if (event) {
        event.stopPropagation();
    }
    copyCustomerLookupValueFromEncoded(encodedValue, 'account number');
}

async function editSelectedOrderCustomerNumber(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const order = getSelectedOrder();
    if (!order || !order.id) {
        showError('Select an order first');
        return;
    }

    const currentValue = String(order.customer_number || '').trim();
    const nextValue = prompt('Customer Account #:', currentValue);
    if (nextValue === null) return;

    const customerNumber = nextValue.trim();
    const PLACEHOLDER_ACCOUNT_NUMBERS = ['na', 'n/a', 'none', 'null', 'n-a'];
    const isRealAccountNumber = customerNumber && !PLACEHOLDER_ACCOUNT_NUMBERS.includes(customerNumber.toLowerCase());

    try {
        const response = await fetch(`${API_BASE}/orders/${order.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customer_number: customerNumber || null,
                has_customer_account: isRealAccountNumber ? 1 : 0,
            }),
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to update account number');
            return;
        }

        allOrders = sortOrdersForList(allOrders.map(item => item.id === order.id ? result.order : item));
        if (currentOrder && currentOrder.id === order.id) {
            currentOrder = result.order;
        }

        const inlineField = document.getElementById(INLINE_ORDER_FIELDS.customer_number);
        if (inlineField) inlineField.value = result.order.customer_number || '';

        const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
        renderOrdersTable(activeOrders);
        renderCompletedOrders(completedOrders);
        renderSalesProcess(getSelectedOrder());
        hideError();
        showToast(customerNumber ? 'Account number updated' : 'Account number cleared');
    } catch (error) {
        console.error('Error updating account number:', error);
        showError('Failed to update account number');
    }
}
async function openCustomerProfileFromLookup(index) {
    const customer = currentLookupCustomers[index];
    if (!customer) return;
    closeCustomerLookupModal();
    await openCustomerProfileModal(customer);
}

function useLookupCustomerForNewOrder(index) {
    const customer = currentLookupCustomers[index];
    if (!customer) return;
    closeCustomerLookupModal();
    createNewOrder(customer);
}

async function openCustomerProfileModal(customer) {
    if (!customerProfileModal) return;

    const params = new URLSearchParams();
    if (customer.customer_profile_id) {
        params.set('customer_profile_id', String(customer.customer_profile_id));
    } else {
        if (customer.customer_number) params.set('customer_number', String(customer.customer_number));
        if (customer.customer_name) params.set('name', String(customer.customer_name));
        if (customer.customer_phone) params.set('phone', String(customer.customer_phone));
    }

    try {
        const response = await fetch(`${API_BASE}/customers/profile?${params.toString()}`);
        const data = await response.json();
        if (!data.success) {
            showError(data.error || 'Failed to load customer profile');
            return;
        }

        currentCustomerProfile = data.profile || null;
        const profile = data.profile || {};
        const profileOrders = Array.isArray(data.orders) ? data.orders : [];

        const title = document.getElementById('customerProfileTitle');
        if (title) {
            title.textContent = `Customer Profile: ${profile.customer_name || customer.customer_name || 'Unknown'}`;
        }

        const setField = (id, value) => {
            const element = document.getElementById(id);
            if (element) {
                element.value = value === null || value === undefined ? '' : String(value);
            }
        };

        setField('customerProfileName', profile.customer_name || customer.customer_name || '');
        setField('customerProfilePhone', profile.customer_phone || customer.customer_phone || '');
        setField('customerProfileEmail', profile.customer_email || customer.customer_email || '');
        setField('customerProfileNumber', profile.customer_number || customer.customer_number || '');
        setField('customerProfileNotes', profile.default_project_notes || '');

        const ordersContainer = document.getElementById('customerProfileOrders');
        if (ordersContainer) {
            if (profileOrders.length === 0) {
                ordersContainer.innerHTML = '<div class="empty-state">No order history found.</div>';
            } else {
                ordersContainer.innerHTML = profileOrders.map(order => `
                    <div class="customer-profile-order-item">
                        <div>
                            <div><strong>Order #${escapeHtml(String(order.id || ''))}</strong> - ${escapeHtml(order.project_name || 'No project')}</div>
                            <div class="customer-profile-order-item-meta">${escapeHtml(formatStageLabel(order.stage || ''))} • ${escapeHtml(formatDate(order.updated_at || order.created_at) || 'Unknown')}</div>
                        </div>
                        <div>
                            <button type="button" class="btn btn-secondary btn-sm" onclick="openOrderFromCustomerProfile(${order.id})">Open</button>
                        </div>
                    </div>
                `).join('');
            }
        }

        customerProfileModal.style.display = 'block';
    } catch (error) {
        console.error('Error loading customer profile:', error);
        showError('Failed to load customer profile');
    }
}

function closeCustomerProfileModal() {
    if (!customerProfileModal) return;
    customerProfileModal.style.display = 'none';
    currentCustomerProfile = null;
}

function openOrderFromCustomerProfile(orderId) {
    closeCustomerProfileModal();
    closeCustomerLookupModal();
    viewOrderDetails(orderId);
}

function useCurrentCustomerProfileForNewOrder() {
    const customer = {
        customer_name: document.getElementById('customerProfileName')?.value || '',
        customer_phone: document.getElementById('customerProfilePhone')?.value || '',
        customer_email: document.getElementById('customerProfileEmail')?.value || '',
        customer_number: document.getElementById('customerProfileNumber')?.value || '',
        customer_profile_id: currentCustomerProfile?.id || null,
        default_project_notes: document.getElementById('customerProfileNotes')?.value || ''
    };

    closeCustomerProfileModal();
    closeCustomerLookupModal();
    createNewOrder(customer);
}

async function saveCustomerProfile() {
    if (!currentCustomerProfile || !currentCustomerProfile.id) {
        showError('Profile cannot be saved until it is linked to an order');
        return;
    }

    const data = {
        customer_profile_id: currentCustomerProfile.id,
        customer_name: document.getElementById('customerProfileName')?.value || '',
        customer_phone: document.getElementById('customerProfilePhone')?.value || '',
        customer_email: document.getElementById('customerProfileEmail')?.value || '',
        customer_number: document.getElementById('customerProfileNumber')?.value || '',
        default_project_notes: document.getElementById('customerProfileNotes')?.value || ''
    };

    try {
        const response = await fetch(`${API_BASE}/customers/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!result.success) {
            showError(result.error || 'Failed to save customer profile');
            return;
        }

        currentCustomerProfile = result.profile || currentCustomerProfile;
        showToast('Customer profile saved');

        currentLookupCustomers = currentLookupCustomers.map(customer => {
            if (customer.customer_profile_id && customer.customer_profile_id === currentCustomerProfile.id) {
                return {
                    ...customer,
                    customer_name: data.customer_name,
                    customer_phone: data.customer_phone,
                    customer_email: data.customer_email,
                    customer_number: data.customer_number,
                    default_project_notes: data.default_project_notes,
                    customer_profile_id: currentCustomerProfile.id
                };
            }
            return customer;
        });

        applyCustomerToOrderForms({
            customer_name: data.customer_name,
            customer_phone: data.customer_phone,
            customer_email: data.customer_email,
            customer_number: data.customer_number,
            customer_profile_id: currentCustomerProfile.id,
            default_project_notes: data.default_project_notes
        }, { force: false, includeProject: false, includeNotes: true });

        if (customerLookupModal && customerLookupModal.style.display === 'block') {
            const queryInput = document.getElementById('customerLookupQuery');
            await searchCustomerDirectory(queryInput ? queryInput.value || '' : '');
        }

        await loadOrders();
    } catch (error) {
        console.error('Error saving customer profile:', error);
        showError('Failed to save customer profile');
    }
}

async function copyCustomerLookupValue(value, label) {
    const text = String(value || '').trim();
    if (!text) return;

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            showToast(`Copied ${label}`);
            return;
        }
    } catch (error) {
        console.warn('Clipboard API unavailable, falling back', error);
    }

    const fallbackInput = document.createElement('textarea');
    fallbackInput.value = text;
    document.body.appendChild(fallbackInput);
    fallbackInput.select();
    document.execCommand('copy');
    document.body.removeChild(fallbackInput);
    showToast(`Copied ${label}`);
}
