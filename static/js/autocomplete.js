let knownContacts = [];
let autocompleteDropdown = null;
let autocompleteActiveIndex = -1;

// ===== Autocomplete Functions =====

async function loadContacts() {
    try {
        const response = await fetch(`${API_BASE}/contacts`);
        const data = await response.json();
        
        if (data.success) {
            knownContacts = data.contacts;
        }
    } catch (error) {
        console.error('Error loading contacts:', error);
    }
}

function applyCustomerToOrderForms(customer, options = {}) {
    const force = Boolean(options.force);
    const includeProject = options.includeProject !== false;
    const includeNotes = Boolean(options.includeNotes);
    const profileId = customer && customer.customer_profile_id ? String(customer.customer_profile_id) : '';

    const assign = (id, value) => {
        const element = document.getElementById(id);
        if (!element) return;
        const text = value === null || value === undefined ? '' : String(value);
        if (force || !element.value) {
            element.value = text;
        }
    };

    assign('customer_name', customer?.customer_name || '');
    assign('customer_phone', customer?.customer_phone || '');
    assign('customer_email', customer?.customer_email || '');
    assign('customer_number', customer?.customer_number || '');
    assign('inline_customer_name', customer?.customer_name || '');
    assign('inline_customer_phone', customer?.customer_phone || '');
    assign('inline_customer_email', customer?.customer_email || '');
    assign('inline_customer_number', customer?.customer_number || '');

    if (includeProject) {
        assign('project_name', customer?.last_project_name || customer?.project_name || '');
        assign('inline_project_name', customer?.last_project_name || customer?.project_name || '');
    }

    assign('default_project_notes', customer?.default_project_notes || '');
    assign('inline_default_project_notes', customer?.default_project_notes || '');

    if (includeNotes) {
        assign('prefit_notes', customer?.default_project_notes || '');
    }

    const profileField = document.getElementById('customer_profile_id');
    if (profileField && (force || !profileField.value)) {
        profileField.value = profileId;
    }

    const inlineProfileField = document.getElementById('inline_customer_profile_id');
    if (inlineProfileField && (force || !inlineProfileField.value)) {
        inlineProfileField.value = profileId;
    }
}

function setupAutocomplete(inputElement) {
    // Create autocomplete dropdown if it doesn't exist
    if (!inputElement.nextElementSibling || !inputElement.nextElementSibling.classList.contains('autocomplete-dropdown')) {
        const dropdown = document.createElement('div');
        dropdown.className = 'autocomplete-dropdown';
        inputElement.parentElement.classList.add('autocomplete-container');
        inputElement.parentElement.appendChild(dropdown);
        autocompleteDropdown = dropdown;
    } else {
        autocompleteDropdown = inputElement.nextElementSibling;
    }
    
    // Input event handler
    inputElement.addEventListener('input', function(e) {
        const value = this.value.trim().toLowerCase();
        
        if (value.length < 2) {
            hideAutocomplete();
            return;
        }
        
        // Filter contacts
        const matches = knownContacts.filter(contact => 
            contact.toLowerCase().includes(value)
        ).slice(0, 10); // Limit to 10 results
        
        if (matches.length > 0) {
            showAutocomplete(matches, inputElement);
        } else {
            hideAutocomplete();
        }
    });
    
    // Keyboard navigation
    inputElement.addEventListener('keydown', function(e) {
        if (!autocompleteDropdown || !autocompleteDropdown.classList.contains('show')) {
            return;
        }
        
        const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            autocompleteActiveIndex = Math.min(autocompleteActiveIndex + 1, items.length - 1);
            highlightAutocompleteItem(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            autocompleteActiveIndex = Math.max(autocompleteActiveIndex - 1, -1);
            highlightAutocompleteItem(items);
        } else if (e.key === 'Enter' && autocompleteActiveIndex >= 0) {
            e.preventDefault();
            items[autocompleteActiveIndex].click();
        } else if (e.key === 'Escape') {
            hideAutocomplete();
        }
    });
    
    // Close on click outside
    document.addEventListener('click', function(e) {
        if (e.target !== inputElement && !autocompleteDropdown.contains(e.target)) {
            hideAutocomplete();
        }
    });

    // If user types and tabs away, still try to auto-fill from history.
    if (!inputElement.dataset.autofillBound) {
        inputElement.addEventListener('blur', () => {
            const typedName = inputElement.value.trim();
            if (typedName.length >= 2) {
                autofillCustomerInfo(typedName, '');
            }
        });
        inputElement.dataset.autofillBound = 'true';
    }
}

function showAutocomplete(matches, inputElement) {
    if (!autocompleteDropdown) return;
    
    autocompleteDropdown.innerHTML = '';
    autocompleteActiveIndex = -1;
    
    matches.forEach((contact, index) => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.textContent = contact;
        
        item.addEventListener('click', async function() {
            inputElement.value = contact;
            hideAutocomplete();
            
            // Auto-fill customer info
            await autofillCustomerInfo(contact);
        });
        
        autocompleteDropdown.appendChild(item);
    });
    
    autocompleteDropdown.classList.add('show');
}

function hideAutocomplete() {
    if (autocompleteDropdown) {
        autocompleteDropdown.classList.remove('show');
        autocompleteActiveIndex = -1;
    }
}

function highlightAutocompleteItem(items) {
    items.forEach((item, index) => {
        if (index === autocompleteActiveIndex) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('active');
        }
    });
}

async function autofillCustomerInfo(name = '', phone = '') {
    try {
        const params = new URLSearchParams();
        if (name) params.set('name', name);
        if (phone) params.set('phone', phone);
        if (!params.toString()) return;

        const response = await fetch(`${API_BASE}/contacts/info?${params.toString()}`);
        const data = await response.json();
        
        if (data.success && data.info) {
            const info = data.info;
            applyCustomerToOrderForms(info, { force: false, includeProject: true, includeNotes: true });
            
            showToast(`Auto-filled contact info for ${info.customer_name || name || phone}`);
        }
    } catch (error) {
        console.error('Error fetching customer info:', error);
    }
}
