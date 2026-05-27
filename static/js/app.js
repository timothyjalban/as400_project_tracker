// Order Tracker Web App - JavaScript
// Handles data fetching and table population

const API_BASE = '/api';
let allOrders = [];
let stages = [];
let currentOrder = null;
let selectedOrderId = null;

// Stage sequence (same as desktop app)
const STAGES = [
    "ORDER_DETAILS",
    "QUOTE_CREATED",
    "QUOTE_SIGNOFF_RECEIVED",
    "INVOICE_CREATED",
    "COST_SHEET_PREPARED",
    "PACKET_TO_BUYER",
    "PO_CREATED",
    "ORDER_PLACED_WITH_VENDOR",
    "VENDOR_ACK_RECEIVED",
    "ETA_CONFIRMED",
    "SHIP_TICKET_RECEIVED",
    "TRANSFERRED_TO_STORE",
    "CUSTOMER_NOTIFIED_READY",
    "INVOICE_TO_WILL_CALL",
    "PICKED_UP",
    "RETURNED",
    "CLOSED",
];

const PROCESS_STAGES = STAGES;

// Contacts for autocomplete
let knownContacts = [];
let autocompleteDropdown = null;
let autocompleteActiveIndex = -1;

// DOM Elements
const searchInput = document.getElementById('searchInput');
const stageFilter = document.getElementById('stageFilter');
const showCompletedCheckbox = document.getElementById('showCompleted');
const refreshBtn = document.getElementById('refreshBtn');
const ordersSearchInput = document.getElementById('ordersSearchInput');
const ordersList = document.getElementById('ordersList');
const ordersCount = document.getElementById('ordersCount');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const orderModal = document.getElementById('orderModal');
const customerHistoryModal = document.getElementById('customerHistoryModal');
const customerLookupModal = document.getElementById('customerLookupModal');
const customerProfileModal = document.getElementById('customerProfileModal');
const orderForm = document.getElementById('orderForm');
const newOrderBtn = document.getElementById('newOrderBtn');
const customerLookupBtn = document.getElementById('customerLookupBtn');
const exportBtn = document.getElementById('exportBtn');
const exportBlankProcessBtn = document.getElementById('exportBlankProcessBtn');
const backupAllBtn = document.getElementById('backupAllBtn');
const downloadBackupBtn = document.getElementById('downloadBackupBtn');
const restoreBackupBtn = document.getElementById('restoreBackupBtn');
const restoreBackupInput = document.getElementById('restoreBackupInput');
const highContrastToggleBtn = document.getElementById('highContrastToggleBtn');
const processEmpty = document.getElementById('processEmpty');
const processContent = document.getElementById('processContent');
const processOrderTitle = document.getElementById('processOrderTitle');
const processOrderMeta = document.getElementById('processOrderMeta');
const processCurrentStage = document.getElementById('processCurrentStage');
const processProgressValue = document.getElementById('processProgressValue');
const processUpdatedValue = document.getElementById('processUpdatedValue');
const processTimeline = document.getElementById('processTimeline');
const completedOrdersPanel = document.getElementById('completedOrdersPanel');
const completedOrdersList = document.getElementById('completedOrdersList');
const completedOrdersCount = document.getElementById('completedOrdersCount');
const inlineOrderForm = document.getElementById('inlineOrderForm');
const saveInlineOrderBtn = document.getElementById('saveInlineOrderBtn');
const processPrevStageBtn = document.getElementById('processPrevStageBtn');
const processNextStageBtn = document.getElementById('processNextStageBtn');
const processJumpStageSelect = document.getElementById('processJumpStageSelect');
const processArchiveOrderBtn = document.getElementById('processArchiveOrderBtn');
const backToTopBtn = document.getElementById('backToTopBtn');
const floatingStageJumpBar = document.getElementById('floatingStageJumpBar');
const floatingStageJumpTrack = document.getElementById('floatingStageJumpTrack');
const addDoorItemBtn = document.getElementById('addDoorItemBtn');
const addWindowItemBtn = document.getElementById('addWindowItemBtn');
const lineItemsList = document.getElementById('lineItemsList');
const orderItemsContainerCard = document.getElementById('orderItemsContainerCard');
const toggleItemsContainerBtn = document.getElementById('toggleItemsContainerBtn');
const confirmDialogModal = document.getElementById('confirmDialogModal');
const confirmDialogTitle = document.getElementById('confirmDialogTitle');
const confirmDialogMessage = document.getElementById('confirmDialogMessage');
const confirmDialogConfirmBtn = document.getElementById('confirmDialogConfirmBtn');
let openProcessStages = new Set();
let pendingConfirmResolve = null;
let currentLineItems = [];
let currentAdditionalQuotes = [];
let customerLookupDebounce = null;
let currentLookupCustomers = [];
let currentCustomerProfile = null;
const WINDOW_HANDING_STORAGE_KEY = 'order_tracker_window_handing_options';
const DEFAULT_WINDOW_HANDING_OPTIONS = ['XO', 'OX', 'XOX'];
const DEFAULT_ITEM_STYLE_OPTIONS = {
    door: ['Slab', 'Prehung', 'French', 'Patio'],
    window: ['Single Hung', 'Double Hung', 'Casement', 'Sliding', 'Picture']
};
const DEFAULT_ITEM_VENDOR_OPTIONS = {
    door: ['Jeld-Wen', 'Masonite', 'Therma-Tru'],
    window: ['Milgard', 'Andersen', 'Pella']
};
let itemStyleOptions = {
    door: [...DEFAULT_ITEM_STYLE_OPTIONS.door],
    window: [...DEFAULT_ITEM_STYLE_OPTIONS.window]
};
let itemVendorOptions = {
    door: [...DEFAULT_ITEM_VENDOR_OPTIONS.door],
    window: [...DEFAULT_ITEM_VENDOR_OPTIONS.window]
};
let vendorSkuByName = {};
let windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
const HIGH_CONTRAST_STORAGE_KEY = 'order_tracker_high_contrast_enabled';
const ORDER_ITEMS_COLLAPSED_STORAGE_KEY = 'order_tracker_items_container_collapsed';

function setOrderItemsContainerCollapsed(collapsed) {
    if (!orderItemsContainerCard || !toggleItemsContainerBtn) return;

    const isCollapsed = Boolean(collapsed);
    orderItemsContainerCard.classList.toggle('collapsed', isCollapsed);
    toggleItemsContainerBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
    toggleItemsContainerBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
}

function initializeOrderItemsContainerCollapse() {
    const saved = window.localStorage.getItem(ORDER_ITEMS_COLLAPSED_STORAGE_KEY);
    setOrderItemsContainerCollapsed(saved === 'true');

    if (toggleItemsContainerBtn) {
        toggleItemsContainerBtn.addEventListener('click', () => {
            const nextState = !orderItemsContainerCard.classList.contains('collapsed');
            setOrderItemsContainerCollapsed(nextState);
            window.localStorage.setItem(ORDER_ITEMS_COLLAPSED_STORAGE_KEY, nextState ? 'true' : 'false');
        });
    }
}

function setHighContrastMode(enabled) {
    const isEnabled = Boolean(enabled);
    document.body.classList.toggle('high-contrast', isEnabled);
    if (highContrastToggleBtn) {
        highContrastToggleBtn.textContent = isEnabled ? 'High Contrast: On' : 'High Contrast: Off';
        highContrastToggleBtn.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
        highContrastToggleBtn.classList.toggle('active', isEnabled);
    }
}

function initializeHighContrastToggle() {
    const saved = window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY);
    const enabled = saved === 'true';
    setHighContrastMode(enabled);

    if (highContrastToggleBtn) {
        highContrastToggleBtn.addEventListener('click', () => {
            const nextEnabled = !document.body.classList.contains('high-contrast');
            setHighContrastMode(nextEnabled);
            window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, nextEnabled ? 'true' : 'false');
            showToast(nextEnabled ? 'High contrast enabled' : 'High contrast disabled');
        });
    }
}

function loadWindowHandingOptions() {
    try {
        const stored = window.localStorage.getItem(WINDOW_HANDING_STORAGE_KEY);
        if (!stored) {
            windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
            return;
        }

        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) {
            windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
            return;
        }

        const merged = [...DEFAULT_WINDOW_HANDING_OPTIONS, ...parsed]
            .map(option => String(option || '').trim().toUpperCase())
            .filter(Boolean);
        windowHandingOptions = Array.from(new Set(merged));
    } catch (error) {
        console.warn('Unable to load window handing options, using defaults.', error);
        windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
    }
}

function saveWindowHandingOptions() {
    try {
        window.localStorage.setItem(WINDOW_HANDING_STORAGE_KEY, JSON.stringify(windowHandingOptions));
    } catch (error) {
        console.warn('Unable to persist window handing options.', error);
    }
}

function getWindowHandingOptions() {
    return Array.isArray(windowHandingOptions) && windowHandingOptions.length > 0
        ? windowHandingOptions
        : [...DEFAULT_WINDOW_HANDING_OPTIONS];
}

function addWindowHandingOption() {
    const handingName = prompt('Add a new window handing (e.g., XO):');
    if (handingName === null) return;

    const trimmed = handingName.trim().toUpperCase();
    if (!trimmed) {
        showError('Handing cannot be empty');
        return;
    }

    if (getWindowHandingOptions().includes(trimmed)) {
        showToast(`${trimmed} already exists`);
        return;
    }

    windowHandingOptions = [...getWindowHandingOptions(), trimmed];
    saveWindowHandingOptions();
    renderLineItemsEditor();
    showToast(`${trimmed} added to handings`);
}

const INLINE_ORDER_FIELDS = {
    customer_name: 'inline_customer_name',
    customer_phone: 'inline_customer_phone',
    customer_email: 'inline_customer_email',
    customer_number: 'inline_customer_number',
    customer_profile_id: 'inline_customer_profile_id',
    default_project_notes: 'inline_default_project_notes',
    project_name: 'inline_project_name',
    stage: 'inline_stage',
    priority_manual: 'inline_priority_manual',
    quote_number: 'inline_quote_number',
    quote_date: 'inline_quote_date',
    quote_number_2: 'inline_quote_number_2',
    quote_date_2: 'inline_quote_date_2',
    quote_total_2: 'inline_quote_total_2',
    quote_total: 'inline_quote_total',
    invoice_number: 'inline_invoice_number',
    invoice_date: 'inline_invoice_date',
    invoice_total: 'inline_invoice_total',
    address_street: 'inline_address_street',
    address_city: 'inline_address_city',
    address_state: 'inline_address_state',
    address_zip: 'inline_address_zip',
    vendor: 'inline_vendor',
    product_type: 'inline_product_type',
    line_items: 'inline_line_items',
    additional_quotes: 'inline_additional_quotes',
    po_numbers: 'inline_po_numbers',
    po_date_signed: 'inline_po_date_signed',
    vendor_ack_number: 'inline_vendor_ack_number',
    vendor_ack_total: 'inline_vendor_ack_total',
    eta_date: 'inline_eta_date'
};

const STAGE_SMART_FIELD_MAP = {
    ORDER_DETAILS: ['customer_name', 'customer_phone', 'customer_email', 'project_name', 'stage', 'priority_manual'],
    QUOTE_CREATED: ['quote_number', 'quote_date', 'quote_total', 'quote_done'],
    QUOTE_SIGNOFF_RECEIVED: ['signoff_done'],
    INVOICE_CREATED: ['invoice_number', 'invoice_date', 'invoice_total', 'invoice_done'],
    COST_SHEET_PREPARED: ['costsheet_done'],
    PACKET_TO_BUYER: ['packet_done'],
    PO_CREATED: ['po_numbers', 'po_date_signed', 'vendor', 'po_done'],
    ORDER_PLACED_WITH_VENDOR: ['po_numbers', 'vendor', 'order_placed_done'],
    VENDOR_ACK_RECEIVED: ['vendor_ack_number', 'vendor_ack_total', 'vendor', 'ack_received_done'],
    ETA_CONFIRMED: ['eta_date', 'vendor', 'eta_confirmed_done'],
    SHIP_TICKET_RECEIVED: ['ship_ticket_done'],
    TRANSFERRED_TO_STORE: ['transfer_location', 'transfer_done'],
    CUSTOMER_NOTIFIED_READY: ['customer_phone', 'customer_email', 'customer_arrival_notified_done'],
    INVOICE_TO_WILL_CALL: ['invoice_number', 'invoice_date', 'will_call_done'],
    PICKED_UP: ['invoice_number', 'po_numbers', 'picked_up_done'],
    CLOSED: ['invoice_number', 'po_numbers', 'closed_done']
};

// Autosave state
let autosaveTimeout = null;
const AUTOSAVE_DELAY = 1500; // 1.5 seconds

// Stage done checkbox mapping (checkbox_id -> timestamp_field)
const STAGE_DONE_FIELDS = {
    'quote_done': 'quote_done_at',
    'signoff_done': 'signoff_done_at',
    'invoice_done': 'invoice_done_at',
    'costsheet_done': 'costsheet_done_at',
    'packet_done': 'packet_done_at',
    'po_done': 'po_done_at',
    'order_placed_done': 'order_placed_done_at',
    'ack_received_done': 'ack_received_done_at',
    'eta_confirmed_done': 'eta_confirmed_done_at',
    'ship_ticket_done': 'ship_ticket_done_at',
    'transfer_done': 'transfer_done_at',
    'customer_arrival_notified_done': 'customer_arrival_notified_done_at',
    'will_call_done': 'will_call_done_at',
    'door_shop_will_call_done': 'door_shop_will_call_done_at',
    'picked_up_done': 'picked_up_done_at',
    'closed_done': 'closed_done_at',
    'install_quote_done': 'install_quote_done_at',
    'install_approved_done': 'install_approved_done_at'
};

const OPTIONAL_STAGE_FIELDS = new Set([
    'vendor_ack_total'
]);

const STAGE_COMPLETION_FIELD_BY_STAGE = {
    QUOTE_CREATED: 'quote_done_at',
    QUOTE_SIGNOFF_RECEIVED: 'signoff_done_at',
    INVOICE_CREATED: 'invoice_done_at',
    COST_SHEET_PREPARED: 'costsheet_done_at',
    PACKET_TO_BUYER: 'packet_done_at',
    PO_CREATED: 'po_done_at',
    ORDER_PLACED_WITH_VENDOR: 'order_placed_done_at',
    VENDOR_ACK_RECEIVED: 'ack_received_done_at',
    ETA_CONFIRMED: 'eta_confirmed_done_at',
    SHIP_TICKET_RECEIVED: 'ship_ticket_done_at',
    TRANSFERRED_TO_STORE: 'transfer_done_at',
    CUSTOMER_NOTIFIED_READY: 'customer_arrival_notified_done_at',
    INVOICE_TO_WILL_CALL: 'will_call_done_at',
    PICKED_UP: 'picked_up_done_at',
    CLOSED: 'closed_done_at',
};

const TRANSFER_STORE_LOCATIONS = ['Felton', 'Santa Cruz', '41st', 'Door Shop', 'Watsonville'];

function normalizeTransferLocation(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const normalized = raw.toLowerCase();
    const canonicalMap = {
        felton: 'Felton',
        'santa cruz': 'Santa Cruz',
        capitola: '41st',
        '41st': '41st',
        aptos: '',
        salinas: 'Door Shop',
        'door shop': 'Door Shop',
        doorshop: 'Door Shop',
        watsonville: 'Watsonville',
    };

    if (Object.prototype.hasOwnProperty.call(canonicalMap, normalized)) {
        return canonicalMap[normalized];
    }

    // Best effort for loose variants like "door  shop".
    const squashed = normalized.replace(/\s+/g, ' ');
    if (squashed === 'door shop') return 'Door Shop';

    return raw;
}

function getAutoPriorityForStage(stage) {
    const stageIndex = STAGES.indexOf(stage || '');
    if (stageIndex < 0) {
        return 0;
    }

    if (STAGES.length <= 1) {
        return 100;
    }

    return Math.round((stageIndex / (STAGES.length - 1)) * 100);
}

function toOptionalPriorityNumber(value) {
    if (value === null || value === undefined) return null;

    const asString = String(value).trim();
    if (asString.length === 0) return null;

    const parsed = parseInt(asString, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function getAutoPriorityUpdateForStageChange(previousStage, currentPriority, nextStage) {
    const nextAuto = getAutoPriorityForStage(nextStage);
    const previousAuto = getAutoPriorityForStage(previousStage);
    const currentPriorityNumber = toOptionalPriorityNumber(currentPriority);
    const isAutoManaged = currentPriorityNumber === null || currentPriorityNumber === previousAuto;

    return isAutoManaged ? nextAuto : null;
}

function syncPriorityInputWithStage(stageElement, priorityElement, previousStageHint = null) {
    if (!stageElement || !priorityElement) return;

    const nextStage = stageElement.value;
    const previousStage = previousStageHint || priorityElement.dataset.autoPriorityStage || nextStage;
    const nextPriority = getAutoPriorityUpdateForStageChange(previousStage, priorityElement.value, nextStage);

    if (nextPriority !== null) {
        priorityElement.value = String(nextPriority);
    }

    priorityElement.dataset.autoPriorityStage = nextStage || '';
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeHighContrastToggle();
    initializeOrderItemsContainerCollapse();

    // Load stages for filter dropdown
    loadStages();

    // Load persistent Door/Window style options
    loadItemStyleOptions();

    // Load persistent Door/Window vendor options
    loadItemVendorOptions();

    // Load vendor SKU catalog from desktop project data
    loadVendorCatalog();

    // Load local window handing options.
    loadWindowHandingOptions();
    
    // Load contacts for autocomplete
    loadContacts();
    
    // Initialize browser notifications
    initializeNotifications();
    
    // Start checking for due reminders
    startReminderChecking();
    
    // Load initial orders
    loadOrders();
    
    // Set up event listeners
    searchInput.addEventListener('input', debounce(() => {
        if (ordersSearchInput && ordersSearchInput.value !== searchInput.value) {
            ordersSearchInput.value = searchInput.value;
        }
        loadOrders();
    }, 300));

    if (ordersSearchInput) {
        ordersSearchInput.addEventListener('input', debounce(() => {
            if (searchInput.value !== ordersSearchInput.value) {
                searchInput.value = ordersSearchInput.value;
            }
            loadOrders();
        }, 300));
    }

    if (addDoorItemBtn) {
        addDoorItemBtn.addEventListener('click', () => addLineItem('door'));
    }

    if (addWindowItemBtn) {
        addWindowItemBtn.addEventListener('click', () => addLineItem('window'));
    }

    stageFilter.addEventListener('change', loadOrders);
    showCompletedCheckbox.addEventListener('change', loadOrders);
    refreshBtn.addEventListener('click', () => {
        loadOrders();
        showToast('Refreshing orders...');
    });
    
    newOrderBtn.addEventListener('click', () => {
        createNewOrder();
    });

    if (customerLookupBtn) {
        customerLookupBtn.addEventListener('click', () => {
            openCustomerLookupModal();
        });
    }
    
    exportBtn.addEventListener('click', () => {
        exportToCSV();
    });

    if (exportBlankProcessBtn) {
        exportBlankProcessBtn.addEventListener('click', () => {
            exportBlankSalesProcessHardCopy();
        });
    }
    
    backupAllBtn.addEventListener('click', () => {
        backupAllOrders();
    });

    if (downloadBackupBtn) {
        downloadBackupBtn.addEventListener('click', () => {
            downloadBackupJson();
        });
    }

    if (restoreBackupBtn) {
        restoreBackupBtn.addEventListener('click', () => {
            openRestoreBackupPicker();
        });
    }

    if (restoreBackupInput) {
        restoreBackupInput.addEventListener('change', (event) => {
            restoreFromBackupFile(event);
        });
    }

    if (saveInlineOrderBtn) {
        saveInlineOrderBtn.addEventListener('click', saveInlineOrder);
    }

    const inlineStage = document.getElementById(INLINE_ORDER_FIELDS.stage);
    if (inlineStage) {
        inlineStage.addEventListener('change', () => {
            const inlinePriority = document.getElementById(INLINE_ORDER_FIELDS.priority_manual);
            syncPriorityInputWithStage(inlineStage, inlinePriority);

            const stageValue = inlineStage.value;
            if (stageValue && PROCESS_STAGES.includes(stageValue)) {
                openProcessStages = new Set([stageValue]);
            } else {
                openProcessStages = new Set();
            }
            renderSalesProcess(getSelectedOrder());
        });
    }
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.repeat) return;

        // Escape key closes modal
        if (e.key === 'Escape' && customerHistoryModal && customerHistoryModal.style.display === 'block') {
            closeCustomerHistoryModal();
            return;
        }

        if (e.key === 'Escape' && customerLookupModal && customerLookupModal.style.display === 'block') {
            closeCustomerLookupModal();
            return;
        }

        if (e.key === 'Escape' && customerProfileModal && customerProfileModal.style.display === 'block') {
            closeCustomerProfileModal();
            return;
        }

        if (e.key === 'Escape' && orderModal.style.display === 'block') {
            closeOrderModal();
            return;
        }

        const isSaveShortcut = (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's';
        if (isSaveShortcut) {
            e.preventDefault();

            if (orderModal && orderModal.style.display === 'block') {
                saveOrder();
                return;
            }

            if (selectedOrderId) {
                saveInlineOrder();
            }
            return;
        }

        const canStageJump = Boolean(selectedOrderId);
        const isNextStageShortcut =
            (e.altKey && e.key === '.') ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'ArrowRight');
        const isPrevStageShortcut =
            (e.altKey && e.key === ',') ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'ArrowLeft');

        if (!canStageJump) {
            return;
        }

        if (isNextStageShortcut) {
            e.preventDefault();
            moveSelectedOrderStage(1);
            return;
        }

        if (isPrevStageShortcut) {
            e.preventDefault();
            moveSelectedOrderStage(-1);
            return;
        }

    });

    window.addEventListener('scroll', updateBackToTopVisibility);
    updateBackToTopVisibility();

    if (backToTopBtn) {
        backToTopBtn.addEventListener('click', scrollToBeginningStage);
    }

    const modalStageSelect = document.getElementById('stage');
    const modalPriorityInput = document.getElementById('priority_manual');
    if (modalStageSelect && modalPriorityInput) {
        modalStageSelect.addEventListener('change', () => {
            syncPriorityInputWithStage(modalStageSelect, modalPriorityInput);
            updateStageNavButtons();
        });
    }
});

function isTypingIntoForm(target) {
    if (!target) return false;
    const tagName = String(target.tagName || '').toUpperCase();
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
}

function createLineItemTemplate(type) {
    return {
        type,
        product: type === 'window' ? 'Window' : 'Door',
        quantity: 1,
        price: '',
        operation: '',
        vendor: '',
        vendor_sku: '',
        room: '',
        style: '',
        material: '',
        swing: '',
        frame: '',
        glass: '',
        width: '',
        height: '',
        notes: '',
        ui_collapsed: false
    };
}

function normalizeLineItem(rawItem) {
    const item = { ...createLineItemTemplate('door'), ...(rawItem || {}) };
    const detectedType = String(item.type || item.product || '').toLowerCase().includes('window') ? 'window' : 'door';
    item.type = detectedType;
    item.product = detectedType === 'window' ? 'Window' : 'Door';
    item.quantity = item.quantity || 1;
    if (!item.operation && rawItem?.operation_style) {
        item.operation = rawItem.operation_style;
    }
    if (!item.vendor_sku && item.vendor) {
        item.vendor_sku = getVendorSkuForName(item.vendor) || '';
    }
    if (!item.price && (rawItem?.unit_price || rawItem?.quote_total)) {
        item.price = rawItem.unit_price || rawItem.quote_total || '';
    }
    item.ui_collapsed = Boolean(rawItem?.ui_collapsed ?? rawItem?.collapsed ?? false);
    return item;
}

function loadLineItemsFromOrder(order) {
    let parsed = [];
    try {
        if (Array.isArray(order?.line_items)) {
            parsed = order.line_items;
        } else if (order?.line_items) {
            parsed = JSON.parse(order.line_items);
        }
    } catch (error) {
        console.warn('Unable to parse line_items for order', order?.id, error);
        parsed = [];
    }

    currentLineItems = Array.isArray(parsed) ? parsed.map(normalizeLineItem) : [];
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
}

function syncLineItemsToHiddenField() {
    const lineItemsField = document.getElementById(INLINE_ORDER_FIELDS.line_items);
    if (!lineItemsField) return;
    lineItemsField.value = currentLineItems.length > 0 ? JSON.stringify(currentLineItems) : '';
}

function addLineItem(type) {
    currentLineItems.push(createLineItemTemplate(type));
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
}

function updateLineItem(index, field, value) {
    if (!currentLineItems[index]) return;
    currentLineItems[index][field] = value;
    if (field === 'type') {
        currentLineItems[index].product = value === 'window' ? 'Window' : 'Door';
    } else if (field === 'vendor') {
        currentLineItems[index].vendor_sku = getVendorSkuForName(value) || '';
    }
    syncLineItemsToHiddenField();
}

function removeLineItem(index) {
    currentLineItems.splice(index, 1);
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
}

function moveLineItem(index, direction) {
    const fromIndex = Number.isInteger(index) ? index : parseInt(index, 10);
    const moveDirection = Number.isInteger(direction) ? direction : parseInt(direction, 10);

    if (!Number.isInteger(fromIndex) || !Number.isInteger(moveDirection)) return;
    if (!currentLineItems[fromIndex]) return;

    const toIndex = fromIndex + moveDirection;
    if (toIndex < 0 || toIndex >= currentLineItems.length) return;

    const [movedItem] = currentLineItems.splice(fromIndex, 1);
    currentLineItems.splice(toIndex, 0, movedItem);
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
}

function getNextRoomLocationValue(value) {
    const raw = String(value ?? '');
    const trimmed = raw.trim();

    if (!trimmed) {
        return raw;
    }

    const incrementNumber = (numberText) => {
        const width = numberText.length;
        const nextNumber = Number.parseInt(numberText, 10) + 1;
        return String(nextNumber).padStart(width, '0');
    };

    const incrementLetterSequence = (text) => {
        if (!/^[A-Za-z]+$/.test(text)) return text;

        const isUpper = text === text.toUpperCase();
        const chars = text.toUpperCase().split('');

        for (let i = chars.length - 1; i >= 0; i -= 1) {
            if (chars[i] !== 'Z') {
                chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
                for (let j = i + 1; j < chars.length; j += 1) {
                    chars[j] = 'A';
                }
                const out = chars.join('');
                return isUpper ? out : out.toLowerCase();
            }
        }

        const expanded = `A${'A'.repeat(chars.length)}`;
        return isUpper ? expanded : expanded.toLowerCase();
    };

    if (/^\d+$/.test(trimmed)) {
        return incrementNumber(trimmed);
    }

    if (/^[A-Za-z]$/.test(trimmed)) {
        return incrementLetterSequence(trimmed);
    }

    // Support suffixed identifiers like "Window-121" or "Bedroom A".
    const suffixNumberMatch = trimmed.match(/^(.*[\s\-_#])(\d+)$/);
    if (suffixNumberMatch) {
        const [, prefix, numberText] = suffixNumberMatch;
        return `${prefix}${incrementNumber(numberText)}`;
    }

    const suffixLetterMatch = trimmed.match(/^(.*[\s\-_#])([A-Za-z]+)$/);
    if (suffixLetterMatch) {
        const [, prefix, letterText] = suffixLetterMatch;
        return `${prefix}${incrementLetterSequence(letterText)}`;
    }

    return raw;
}

function copyLineItem(index) {
    const sourceItem = currentLineItems[index];
    if (!sourceItem) return;

    // Duplicate item details for quick repeated entries.
    const copiedItem = { ...sourceItem };
    copiedItem.room = getNextRoomLocationValue(sourceItem.room);
    currentLineItems.push(copiedItem);
    renderLineItemsEditor();
    syncLineItemsToHiddenField();
}

function toggleLineItemCollapse(index) {
    if (!currentLineItems[index]) return;
    currentLineItems[index].ui_collapsed = !Boolean(currentLineItems[index].ui_collapsed);
    syncLineItemsToHiddenField();
    persistLineItemsStateSilently();
    renderLineItemsEditor();
}

async function persistLineItemsStateSilently() {
    if (!selectedOrderId) return;

    try {
        const response = await fetch(`${API_BASE}/orders/${selectedOrderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                line_items: currentLineItems.length > 0 ? JSON.stringify(currentLineItems) : null
            })
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            return;
        }

        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) {
            currentOrder = result.order;
        }
    } catch (error) {
        console.error('Silent line item state save failed:', error);
    }
}

function getStyleOptionsForType(itemType) {
    const normalizedType = itemType === 'window' ? 'window' : 'door';
    const configured = itemStyleOptions?.[normalizedType];
    if (Array.isArray(configured) && configured.length > 0) {
        return configured;
    }
    return DEFAULT_ITEM_STYLE_OPTIONS[normalizedType];
}

async function loadItemStyleOptions() {
    try {
        const response = await fetch(`${API_BASE}/item-style-options`);
        const data = await response.json();
        if (!data.success) return;

        itemStyleOptions = {
            door: Array.isArray(data.styles?.door) ? data.styles.door : [...DEFAULT_ITEM_STYLE_OPTIONS.door],
            window: Array.isArray(data.styles?.window) ? data.styles.window : [...DEFAULT_ITEM_STYLE_OPTIONS.window]
        };

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
        }
    } catch (error) {
        console.warn('Unable to load item style options, using defaults.', error);
    }
}

function getVendorOptionsForType(itemType) {
    const normalizedType = itemType === 'window' ? 'window' : 'door';
    const configured = itemVendorOptions?.[normalizedType];
    if (Array.isArray(configured) && configured.length > 0) {
        return configured;
    }
    return DEFAULT_ITEM_VENDOR_OPTIONS[normalizedType];
}

function normalizeVendorKey(name) {
    return String(name || '').trim().toLowerCase();
}

function getVendorSkuForName(name) {
    const key = normalizeVendorKey(name);
    return key ? (vendorSkuByName[key] || '') : '';
}

function mergeVendorOptionsWithCatalog(baseOptions) {
    const names = new Set((Array.isArray(baseOptions) ? baseOptions : []).map(name => String(name || '').trim()).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

async function loadVendorCatalog() {
    try {
        const response = await fetch(`${API_BASE}/vendor-catalog`);
        const data = await response.json();
        if (!data.success || !Array.isArray(data.vendors)) return;

        vendorSkuByName = {};
        data.vendors.forEach(vendor => {
            const name = String(vendor?.name || '').trim();
            if (!name) return;
            const key = normalizeVendorKey(name);
            vendorSkuByName[key] = vendor?.sku != null ? String(vendor.sku) : '';
        });

        const vendorNames = data.vendors
            .map(vendor => String(vendor?.name || '').trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));

        if (vendorNames.length > 0) {
            itemVendorOptions = {
                door: mergeVendorOptionsWithCatalog([...itemVendorOptions.door, ...vendorNames]),
                window: mergeVendorOptionsWithCatalog([...itemVendorOptions.window, ...vendorNames])
            };
        }

        currentLineItems = currentLineItems.map(item => {
            if (item.vendor && !item.vendor_sku) {
                return { ...item, vendor_sku: getVendorSkuForName(item.vendor) || '' };
            }
            return item;
        });

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
            syncLineItemsToHiddenField();
        }
    } catch (error) {
        console.warn('Unable to load vendor SKU catalog.', error);
    }
}

async function loadItemVendorOptions() {
    try {
        const response = await fetch(`${API_BASE}/item-vendor-options`);
        const data = await response.json();
        if (!data.success) return;

        itemVendorOptions = {
            door: Array.isArray(data.vendors?.door) ? data.vendors.door : [...DEFAULT_ITEM_VENDOR_OPTIONS.door],
            window: Array.isArray(data.vendors?.window) ? data.vendors.window : [...DEFAULT_ITEM_VENDOR_OPTIONS.window]
        };

        itemVendorOptions = {
            door: mergeVendorOptionsWithCatalog(itemVendorOptions.door),
            window: mergeVendorOptionsWithCatalog(itemVendorOptions.window)
        };

        if (currentLineItems.length > 0) {
            renderLineItemsEditor();
        }
    } catch (error) {
        console.warn('Unable to load item vendor options, using defaults.', error);
    }
}

async function addItemStyle(itemType) {
    const normalizedType = itemType === 'window' ? 'window' : 'door';
    const label = normalizedType === 'window' ? 'window' : 'door';
    const styleName = prompt(`Add a new ${label} style:`);

    if (styleName === null) return;
    const trimmedStyleName = styleName.trim();
    if (!trimmedStyleName) {
        showError('Style name cannot be empty');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/item-style-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_type: normalizedType,
                style_name: trimmedStyleName
            })
        });
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to save style');
            return;
        }

        itemStyleOptions = {
            door: Array.isArray(data.styles?.door) ? data.styles.door : [...DEFAULT_ITEM_STYLE_OPTIONS.door],
            window: Array.isArray(data.styles?.window) ? data.styles.window : [...DEFAULT_ITEM_STYLE_OPTIONS.window]
        };

        renderLineItemsEditor();
        showToast(`${trimmedStyleName} saved for ${label} styles`);
    } catch (error) {
        console.error('Error saving style option:', error);
        showError('Failed to save style option');
    }
}

async function addItemVendor(itemType) {
    const normalizedType = itemType === 'window' ? 'window' : 'door';
    const label = normalizedType === 'window' ? 'window' : 'door';
    const vendorName = prompt(`Add a new ${label} vendor:`);

    if (vendorName === null) return;
    const trimmedVendorName = vendorName.trim();
    if (!trimmedVendorName) {
        showError('Vendor name cannot be empty');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/item-vendor-options`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_type: normalizedType,
                vendor_name: trimmedVendorName
            })
        });
        const data = await response.json();

        if (!data.success) {
            showError(data.error || 'Failed to save vendor');
            return;
        }

        itemVendorOptions = {
            door: Array.isArray(data.vendors?.door) ? data.vendors.door : [...DEFAULT_ITEM_VENDOR_OPTIONS.door],
            window: Array.isArray(data.vendors?.window) ? data.vendors.window : [...DEFAULT_ITEM_VENDOR_OPTIONS.window]
        };

        renderLineItemsEditor();
        showToast(`${trimmedVendorName} saved for ${label} vendors`);
    } catch (error) {
        console.error('Error saving vendor option:', error);
        showError('Failed to save vendor option');
    }
}

function renderOptionButtons(index, field, options, selectedValue) {
    return options
        .map(option => {
            const activeClass = String(selectedValue || '') === option ? 'active' : '';
            return `<button type="button" class="item-option-button ${activeClass}" data-item-index="${index}" data-item-field="${field}" data-item-value="${option}">${option}</button>`;
        })
        .join('');
}

function renderVendorOptionButtons(index, options, selectedValue) {
    return options
        .map(option => {
            const activeClass = String(selectedValue || '') === option ? 'active' : '';
            const sku = getVendorSkuForName(option);
            const title = sku ? `SKU: ${sku}` : 'SKU unavailable';
            return `<button type="button" class="item-option-button ${activeClass}" title="${escapeHtml(title)}" data-item-index="${index}" data-item-field="vendor" data-item-value="${option}">${option}</button>`;
        })
        .join('');
}

function renderSelectOptions(options, selectedValue, placeholder) {
    const placeholderOption = `<option value="">${escapeHtml(placeholder || 'Select')}</option>`;
    const optionHtml = (Array.isArray(options) ? options : [])
        .map(option => {
            const isSelected = String(selectedValue || '') === String(option);
            return `<option value="${escapeHtml(option)}" ${isSelected ? 'selected' : ''}>${escapeHtml(option)}</option>`;
        })
        .join('');
    return placeholderOption + optionHtml;
}

function renderLineItemsEditor() {
    if (!lineItemsList) return;

    if (currentLineItems.length === 0) {
        lineItemsList.innerHTML = '<div class="line-items-empty">No items yet. Start with Door or Window.</div>';
        return;
    }

    lineItemsList.innerHTML = currentLineItems.map((item, index) => {
        const isDoor = item.type === 'door';
        const isCollapsed = Boolean(item.ui_collapsed);
        return `
            <div class="line-item-card">
                <div class="line-item-header">
                    <div class="line-item-type-toggle">
                        <button type="button" class="item-type-button ${isDoor ? 'active' : ''}" data-item-index="${index}" data-item-field="type" data-item-value="door">Door</button>
                        <button type="button" class="item-type-button ${!isDoor ? 'active' : ''}" data-item-index="${index}" data-item-field="type" data-item-value="window">Window</button>
                    </div>
                    <div class="line-item-header-actions">
                        <button type="button" class="item-move-button" data-item-move-up="${index}" ${index === 0 ? 'disabled' : ''} title="Move item up">Up</button>
                        <button type="button" class="item-move-button" data-item-move-down="${index}" ${index === currentLineItems.length - 1 ? 'disabled' : ''} title="Move item down">Down</button>
                        <button type="button" class="item-collapse-button" data-item-toggle="${index}">${isCollapsed ? 'Expand' : 'Collapse'}</button>
                        <button type="button" class="item-copy-button" data-item-copy="${index}">Copy</button>
                        <button type="button" class="item-remove-button" data-item-remove="${index}">Remove</button>
                    </div>
                </div>

                <div class="line-item-grid line-item-grid-quick">
                    <div class="line-item-field">
                        <label>Quantity</label>
                        <input type="number" min="1" value="${item.quantity}" data-item-index="${index}" data-item-field="quantity">
                    </div>
                    <div class="line-item-field">
                        <label>Width</label>
                        <input type="text" value="${escapeHtml(item.width || '')}" data-item-index="${index}" data-item-field="width" placeholder="e.g. 36\"">
                    </div>
                    <div class="line-item-field">
                        <label>Height</label>
                        <input type="text" value="${escapeHtml(item.height || '')}" data-item-index="${index}" data-item-field="height" placeholder="e.g. 80\"">
                    </div>
                    <div class="line-item-field">
                        <label>Unit Price</label>
                        <input type="number" min="0" step="0.01" value="${escapeHtml(item.price || '')}" data-item-index="${index}" data-item-field="price" placeholder="e.g. 499.99">
                    </div>
                </div>

                <div class="line-item-details ${isCollapsed ? 'collapsed' : ''}">
                <div class="line-item-grid">
                    <div class="line-item-field">
                        <label>Room / Location</label>
                        <input type="text" value="${escapeHtml(item.room || '')}" data-item-index="${index}" data-item-field="room">
                    </div>
                </div>

                <div class="line-item-options">
                    ${!isDoor ? `
                    <div class="line-item-field">
                        <label>Handing</label>
                        <select data-item-index="${index}" data-item-field="operation">
                            ${renderSelectOptions(getWindowHandingOptions(), item.operation, 'Select handing')}
                        </select>
                        <button type="button" class="item-add-style-button" data-add-handing="window">+ Add Handing</button>
                    </div>
                    ` : ''}

                    <div class="line-item-field">
                        <label>${isDoor ? 'Door Style' : 'Window Style'}</label>
                        ${isDoor ? `
                        <select data-item-index="${index}" data-item-field="style">
                            ${renderSelectOptions(getStyleOptionsForType('door'), item.style, 'Select door style')}
                        </select>
                        <button type="button" class="item-add-style-button" data-add-style-type="door">+ Add Style</button>
                        ` : `
                        <select data-item-index="${index}" data-item-field="style">
                            ${renderSelectOptions(getStyleOptionsForType('window'), item.style, 'Select window style')}
                        </select>
                        <button type="button" class="item-add-style-button" data-add-style-type="window">+ Add Style</button>
                        `}
                    </div>

                    <div class="line-item-field">
                        <label>Vendor</label>
                        ${isDoor ? `
                        <select data-item-index="${index}" data-item-field="vendor">
                            ${renderSelectOptions(getVendorOptionsForType('door'), item.vendor, 'Select vendor')}
                        </select>
                        <button type="button" class="item-add-style-button" data-add-vendor-type="door">+ Add Vendor</button>
                        ` : `
                        <select data-item-index="${index}" data-item-field="vendor">
                            ${renderSelectOptions(getVendorOptionsForType('window'), item.vendor, 'Select vendor')}
                        </select>
                        `}
                        ${item.vendor_sku ? `<div class="item-vendor-sku">SKU: ${escapeHtml(item.vendor_sku)}</div>` : ''}
                    </div>

                    <div class="line-item-field">
                        <label>${isDoor ? 'Material' : 'Frame'}</label>
                        ${isDoor ? `
                        <select data-item-index="${index}" data-item-field="material">
                            ${renderSelectOptions(['Wood', 'Fiberglass', 'Steel'], item.material, 'Select material')}
                        </select>
                        ` : `
                        <select data-item-index="${index}" data-item-field="frame">
                            ${renderSelectOptions(['Vinyl', 'Wood', 'Aluminum', 'Fiberglass'], item.frame, 'Select frame')}
                        </select>
                        `}
                    </div>

                    <div class="line-item-field">
                        <label>${isDoor ? 'Swing' : 'Glass'}</label>
                        ${isDoor ? `
                        <select data-item-index="${index}" data-item-field="swing">
                            ${renderSelectOptions(['LH', 'RH', 'LH Outswing', 'RH Outswing'], item.swing, 'Select swing')}
                        </select>
                        ` : `
                        <select data-item-index="${index}" data-item-field="glass">
                            ${renderSelectOptions(['Clear', 'Low-E', 'Tempered', 'Obscure'], item.glass, 'Select glass')}
                        </select>
                        `}
                    </div>
                </div>

                <div class="line-item-field">
                    <label>Notes</label>
                    <textarea rows="2" data-item-index="${index}" data-item-field="notes">${escapeHtml(item.notes || '')}</textarea>
                </div>
                </div>
            </div>
        `;
    }).join('');

    bindLineItemsEditorEvents();
}

function bindLineItemsEditorEvents() {
    if (!lineItemsList) return;

    lineItemsList.querySelectorAll('[data-item-move-up]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-move-up'), 10);
            moveLineItem(index, -1);
        });
    });

    lineItemsList.querySelectorAll('[data-item-move-down]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-move-down'), 10);
            moveLineItem(index, 1);
        });
    });

    lineItemsList.querySelectorAll('[data-item-remove]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-remove'), 10);
            removeLineItem(index);
        });
    });

    lineItemsList.querySelectorAll('[data-item-copy]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-copy'), 10);
            copyLineItem(index);
        });
    });

    lineItemsList.querySelectorAll('[data-item-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-toggle'), 10);
            toggleLineItemCollapse(index);
        });
    });

    lineItemsList.querySelectorAll('.item-type-button, .item-option-button').forEach(button => {
        button.addEventListener('click', () => {
            const index = parseInt(button.getAttribute('data-item-index'), 10);
            const field = button.getAttribute('data-item-field');
            const value = button.getAttribute('data-item-value');
            updateLineItem(index, field, value);
            renderLineItemsEditor();
        });
    });

    lineItemsList.querySelectorAll('[data-add-style-type]').forEach(button => {
        button.addEventListener('click', async () => {
            const itemType = button.getAttribute('data-add-style-type');
            await addItemStyle(itemType);
        });
    });

    lineItemsList.querySelectorAll('[data-add-vendor-type]').forEach(button => {
        button.addEventListener('click', async () => {
            const itemType = button.getAttribute('data-add-vendor-type');
            await addItemVendor(itemType);
        });
    });

    lineItemsList.querySelectorAll('[data-add-handing]').forEach(button => {
        button.addEventListener('click', () => {
            addWindowHandingOption();
        });
    });

    lineItemsList.querySelectorAll('input[data-item-field], textarea[data-item-field], select[data-item-field]').forEach(input => {
        const tagName = input.tagName;
        const eventName = tagName === 'TEXTAREA' ? 'input' : 'change';
        input.addEventListener(eventName, () => {
            const index = parseInt(input.getAttribute('data-item-index'), 10);
            const field = input.getAttribute('data-item-field');
            const value = field === 'quantity' ? parseInt(input.value || '1', 10) : input.value;
            updateLineItem(index, field, value);
        });
    });
}

// Debounce function for search input
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

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
    
    try {
        const response = await fetch(`${API_BASE}/orders?${params}`);
        const data = await response.json();
        
        if (data.success) {
            const previousSelectedOrderId = selectedOrderId;
            allOrders = sortOrdersForList(data.orders || []);
            const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);

            if (allOrders.length === 0) {
                selectedOrderId = null;
            } else if (!selectedOrderId || !allOrders.some(order => order.id === selectedOrderId)) {
                const preferredOrder = activeOrders[0] || completedOrders[0];
                selectedOrderId = preferredOrder ? preferredOrder.id : null;
            }

            if (selectedOrderId !== previousSelectedOrderId) {
                const selectedOrder = getSelectedOrder();
                openProcessStages = new Set();
                if (selectedOrder && selectedOrder.stage && PROCESS_STAGES.includes(selectedOrder.stage)) {
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

        return `
            <div class="${itemClasses}" role="button" tabindex="0" onclick="selectOrder(${order.id})" ondblclick="viewOrderDetails(${order.id})" onkeydown="handleOrderListItemKey(event, ${order.id})">
                <div class="order-list-top">
                    <div class="order-list-top-left">
                        <span class="order-list-customer">${escapeHtml(order.customer_name || 'Unnamed Customer')}</span>
                        ${isPinned ? '<span class="order-status-chip pinned" title="Pinned">Pinned</span>' : ''}
                        ${isFlagged ? '<span class="order-status-chip flagged" title="Flagged">Flagged</span>' : ''}
                        ${hasCustomerNumber ? `<span class="order-status-chip account" title="Copy account number" onclick="copyOrderAccountNumber(event, '${encodeURIComponent(String(order.customer_number || ''))}')">Acct ${escapeHtml(order.customer_number)}</span>` : ''}
                        ${streetOnlyAddress ? `<span class="order-status-chip address" title="${escapeHtml(streetOnlyAddress)}">${escapeHtml(streetOnlyAddress)}</span>` : ''}
                    </div>
                    <div class="order-list-actions">
                        <button class="order-icon-btn" title="Add reminder" onclick="openReminderForOrder(event, ${order.id})">⏰</button>
                        <button class="order-icon-btn ${isPinned ? 'active' : ''}" title="${isPinned ? 'Unpin order' : 'Pin order'}" onclick="toggleOrderPin(event, ${order.id})">📌</button>
                        <button class="order-icon-btn ${isFlagged ? 'active' : ''}" title="${isFlagged ? 'Unflag order' : 'Flag order'}" onclick="toggleOrderFlag(event, ${order.id})">🚩</button>
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

        return `
            <div class="${itemClasses}" role="button" tabindex="0" onclick="selectOrder(${order.id})" ondblclick="viewOrderDetails(${order.id})" onkeydown="handleOrderListItemKey(event, ${order.id})">
                <div class="order-list-top">
                    <div class="order-list-top-left">
                        <span class="order-list-customer">${escapeHtml(order.customer_name || 'Unnamed Customer')}</span>
                        <span class="order-status-chip completed" title="Completed">Completed</span>
                        ${hasCustomerNumber ? `<span class="order-status-chip account" title="Copy account number" onclick="copyOrderAccountNumber(event, '${encodeURIComponent(String(order.customer_number || ''))}')">Acct ${escapeHtml(order.customer_number)}</span>` : ''}
                        ${streetOnlyAddress ? `<span class="order-status-chip address" title="${escapeHtml(streetOnlyAddress)}">${escapeHtml(streetOnlyAddress)}</span>` : ''}
                    </div>
                    <div class="order-list-actions">
                        <button class="order-icon-btn" title="Add reminder" onclick="openReminderForOrder(event, ${order.id})">⏰</button>
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
    renderOrdersTable(activeOrders);
    renderCompletedOrders(completedOrders);

    const hydrated = await hydrateOrderFromServer(selectedOrderId);
    if (selectedOrderId !== Number(orderId)) return;

    const selectedOrder = hydrated || getSelectedOrder();
    openProcessStages = new Set();
    if (selectedOrder && selectedOrder.stage && PROCESS_STAGES.includes(selectedOrder.stage)) {
        openProcessStages.add(selectedOrder.stage);
    }

    const splitAfterHydrate = splitOrdersByArchiveStatus(allOrders);
    renderOrdersTable(splitAfterHydrate.activeOrders);
    renderCompletedOrders(splitAfterHydrate.completedOrders);
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

    processJumpStageSelect.innerHTML = PROCESS_STAGES
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

    const payload = { stage: nextStage };
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
        renderOrdersTable(activeOrders);
        renderCompletedOrders(completedOrders);
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
        renderOrdersTable(activeOrders);
        renderCompletedOrders(completedOrders);
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
        ${accountNumber ? `<span class="process-order-meta-item account-copy" title="Copy account number" onclick="copyCustomerLookupValueFromEncoded('${encodeURIComponent(accountNumber)}', 'account number')">Acct #: ${escapeHtml(accountNumber)}</span>` : ''}
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
    if (openProcessStages.size === 0 && order.stage && PROCESS_STAGES.includes(order.stage)) {
        openProcessStages.add(order.stage);
    }

    processTimeline.innerHTML = PROCESS_STAGES.map((stage, index) => {
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

    floatingStageJumpTrack.innerHTML = PROCESS_STAGES.map((stage, index) => {
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
    const order = getSelectedOrder();
    if (!order || !order.id) {
        showError('Select an order first');
        return;
    }

    if (!PROCESS_STAGES.includes(stage)) {
        return;
    }

    const payload = { stage };
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

function scrollToProcessStage(stage) {
    if (!processTimeline || !stage) return;

    const detailsElement = processTimeline.querySelector(`[data-stage-details="${stage}"]`);
    const stageButton = processTimeline.querySelector(`.timeline-item[data-stage="${stage}"]`);
    const target = detailsElement || stageButton;

    if (!target) return;

    target.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
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

function renderStageDetailsMarkup(stage, order) {
    const fieldNames = STAGE_SMART_FIELD_MAP[stage] || [];
    if (fieldNames.length === 0) {
            return '<div class="stage-smart-empty">No specific fields for this stage.</div>';
    }

    const quoteCreatedPrimaryFields = stage === 'QUOTE_CREATED'
        ? (() => {
            const quoteNumberSource = document.getElementById(INLINE_ORDER_FIELDS.quote_number);
            const quoteDateSource = document.getElementById(INLINE_ORDER_FIELDS.quote_date);
            const quoteTotalSource = document.getElementById(INLINE_ORDER_FIELDS.quote_total);

            const quoteNumberValue = quoteNumberSource ? (quoteNumberSource.value || '') : (order?.quote_number || '');
            const quoteDateValue = quoteDateSource ? (quoteDateSource.value || '') : toInputDate(order?.quote_date);
            const quoteTotalValue = quoteTotalSource ? (quoteTotalSource.value || '') : (order?.quote_total || '');

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
                            <label>Additional Quote ${index + 1}</label>
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
                            <button type="button" class="btn btn-secondary btn-sm" id="stageAddSecondaryQuoteBtn" onclick="addAdditionalQuote()">+ Add Quote</button>
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
        : fieldNames;

    return `${quoteCreatedControls}${quoteCreatedPrimaryFields}${fieldsToRender.map(fieldName => {
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
            const currentValue = normalizeTransferLocation(order?.transfer_location || '');
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
            const sourceInputId = INLINE_ORDER_FIELDS[fieldName];
            const sourceInput = sourceInputId ? document.getElementById(sourceInputId) : null;
            const currentValue = sourceInput ? (sourceInput.value || '') : (order?.[fieldName] || '');
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

// Format a timestamp for display under the toggle
function formatDoneTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `Completed: ${d.toLocaleString()}`;
}

        const sourceInputId = INLINE_ORDER_FIELDS[fieldName];
        const sourceInput = sourceInputId ? document.getElementById(sourceInputId) : null;
        const currentValue = sourceInput ? (sourceInput.value || '') : (order?.[fieldName] || '');
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
        input.addEventListener('change', async () => {
            const fieldName = input.getAttribute('data-stage-source-field');

            if (Object.prototype.hasOwnProperty.call(STAGE_DONE_FIELDS, fieldName)) {
                await persistStageDoneField(fieldName, Boolean(input.checked));
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

async function persistStageField(fieldName, fieldValue) {
    if (!selectedOrderId || !fieldName) return;

    const payload = { [fieldName]: fieldValue || null };

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

async function persistStageDoneField(fieldName, isChecked) {
    const timestampField = STAGE_DONE_FIELDS[fieldName];
    if (!timestampField || !selectedOrderId) return;

    const timestampValue = isChecked ? new Date().toISOString() : null;
    const payload = { [timestampField]: timestampValue };

    // Keep transfer location sticky when toggling a stage checkbox.
    const transferInput = processTimeline
        ? processTimeline.querySelector('[data-stage-source-field="transfer_location"]')
        : null;
    if (transferInput) {
        payload.transfer_location = normalizeTransferLocation(transferInput.value) || null;
    }

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

        renderSalesProcess(result.order);
        hideError();
    } catch (error) {
        console.error('Error updating stage status:', error);
        showError('Failed to update stage status');
    }
}

function populateInlineOrderForm(order) {
    if (!inlineOrderForm || !order) return;

    const stageSelect = document.getElementById(INLINE_ORDER_FIELDS.stage);
    if (stageSelect) {
        const options = [...new Set([...STAGES, ...stages])];
        stageSelect.innerHTML = options
            .map(stage => `<option value="${stage}" ${order && order.stage === stage ? 'selected' : ''}>${stage}</option>`)
            .join('');
    }

    Object.entries(INLINE_ORDER_FIELDS).forEach(([field, elementId]) => {
        if (field === 'stage') return;

        const element = document.getElementById(elementId);
        if (!element) return;

        let value = order[field] || '';
        if (field === 'po_numbers') {
            value = order.po_numbers || order.po_number || '';
        }

        if (field.endsWith('_date')) {
            element.value = toInputDate(value);
            return;
        }

        element.value = value;
    });

    const inlineStage = document.getElementById(INLINE_ORDER_FIELDS.stage);
    const inlinePriority = document.getElementById(INLINE_ORDER_FIELDS.priority_manual);
    syncPriorityInputWithStage(inlineStage, inlinePriority, order?.stage || stageSelect.value);

    loadAdditionalQuotesFromOrder(order);
    syncSecondaryQuoteSection('inline', order);

    loadLineItemsFromOrder(order);
}

function toInputDate(value) {
    if (!value) return '';
    const dateMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
        return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }
    return '';
}

function getSecondaryQuoteControls(prefix = '') {
    const normalizedPrefix = prefix === 'inline' ? 'inline' : '';
    return {
        section: normalizedPrefix === 'inline' ? 'inlineSecondaryQuoteSection' : 'secondaryQuoteSection',
        addButton: normalizedPrefix === 'inline' ? 'inlineAddSecondaryQuoteBtn' : 'addSecondaryQuoteBtn',
        removeButton: normalizedPrefix === 'inline' ? 'inlineRemoveSecondaryQuoteBtn' : 'removeSecondaryQuoteBtn',
        quoteNumber: normalizedPrefix === 'inline' ? 'inline_quote_number_2' : 'quote_number_2',
        quoteDate: normalizedPrefix === 'inline' ? 'inline_quote_date_2' : 'quote_date_2'
    };
}

function setSecondaryQuoteVisibility(prefix = '', visible) {
    const controls = getSecondaryQuoteControls(prefix);
    const section = document.getElementById(controls.section);
    const addButton = document.getElementById(controls.addButton);
    const removeButton = document.getElementById(controls.removeButton);
    const stageAddButton = prefix === 'inline' ? document.getElementById('stageAddSecondaryQuoteBtn') : null;
    const stageRemoveButton = prefix === 'inline' ? document.getElementById('stageRemoveSecondaryQuoteBtn') : null;

    if (section) {
        section.style.display = visible ? 'block' : 'none';
    }
    if (addButton) {
        addButton.style.display = visible ? 'none' : 'inline-flex';
    }
    if (removeButton) {
        removeButton.style.display = visible ? 'inline-flex' : 'none';
    }
    if (stageAddButton) {
        stageAddButton.style.display = 'inline-flex';
    }
    if (stageRemoveButton) {
        stageRemoveButton.style.display = currentAdditionalQuotes.length > 0 ? 'inline-flex' : 'none';
    }
}

function refreshQuoteCreatedStageDetails() {
    if (!processTimeline) return;

    const stageDetails = processTimeline.querySelector('[data-stage-details="QUOTE_CREATED"]');
    const selectedOrder = getSelectedOrder();
    if (!stageDetails || !selectedOrder) return;

    stageDetails.innerHTML = renderStageDetailsMarkup('QUOTE_CREATED', selectedOrder);
    bindStageDetailInputs();
}

function clearSecondaryQuoteFields(prefix = '') {
    const controls = getSecondaryQuoteControls(prefix);
    const numberInput = document.getElementById(controls.quoteNumber);
    const dateInput = document.getElementById(controls.quoteDate);

    if (numberInput) numberInput.value = '';
    if (dateInput) dateInput.value = '';
    const totalInput = document.getElementById(prefix === 'inline' ? 'inline_quote_total_2' : 'quote_total_2');
    if (totalInput) totalInput.value = '';
}

function normalizeAdditionalQuoteEntry(rawQuote = {}) {
    return {
        quote_number: String(rawQuote.quote_number || '').trim(),
        quote_date: toInputDate(rawQuote.quote_date),
        quote_total: rawQuote.quote_total === null || rawQuote.quote_total === undefined
            ? ''
            : String(rawQuote.quote_total).trim(),
    };
}

function parseAdditionalQuotesFromOrder(order) {
    let parsed = [];

    try {
        if (Array.isArray(order?.additional_quotes)) {
            parsed = order.additional_quotes;
        } else if (order?.additional_quotes) {
            parsed = JSON.parse(order.additional_quotes);
        }
    } catch (error) {
        console.warn('Unable to parse additional_quotes for order', order?.id, error);
        parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        const legacyHasSecondary = Boolean(order && (order.quote_number_2 || order.quote_date_2 || order.quote_total_2));
        if (!legacyHasSecondary) return [];

        return [normalizeAdditionalQuoteEntry({
            quote_number: order.quote_number_2,
            quote_date: order.quote_date_2,
            quote_total: order.quote_total_2,
        })];
    }

    return parsed.map(normalizeAdditionalQuoteEntry);
}

function syncAdditionalQuotesToHiddenField() {
    const hiddenField = document.getElementById(INLINE_ORDER_FIELDS.additional_quotes);
    if (!hiddenField) return;

    hiddenField.value = currentAdditionalQuotes.length > 0
        ? JSON.stringify(currentAdditionalQuotes)
        : '';
}

function syncLegacySecondaryQuoteFieldsFromAdditional(prefix = 'inline') {
    const numberId = prefix === 'inline' ? 'inline_quote_number_2' : 'quote_number_2';
    const dateId = prefix === 'inline' ? 'inline_quote_date_2' : 'quote_date_2';
    const totalId = prefix === 'inline' ? 'inline_quote_total_2' : 'quote_total_2';

    const numberInput = document.getElementById(numberId);
    const dateInput = document.getElementById(dateId);
    const totalInput = document.getElementById(totalId);

    const first = currentAdditionalQuotes[0] || null;
    if (numberInput) numberInput.value = first ? (first.quote_number || '') : '';
    if (dateInput) dateInput.value = first ? (toInputDate(first.quote_date) || '') : '';
    if (totalInput) totalInput.value = first ? (first.quote_total || '') : '';
}

function loadAdditionalQuotesFromOrder(order) {
    currentAdditionalQuotes = parseAdditionalQuotesFromOrder(order);
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
}

async function addAdditionalQuote() {
    currentAdditionalQuotes.push(normalizeAdditionalQuoteEntry());
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', true);
    await persistAdditionalQuotesState();
    refreshQuoteCreatedStageDetails();
}

async function removeAdditionalQuote(index) {
    if (index < 0 || index >= currentAdditionalQuotes.length) return;

    currentAdditionalQuotes.splice(index, 1);
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', currentAdditionalQuotes.length > 0);
    await persistAdditionalQuotesState();
    refreshQuoteCreatedStageDetails();
}

function updateAdditionalQuoteField(index, field, value) {
    if (!currentAdditionalQuotes[index]) return;

    if (field === 'quote_date') {
        currentAdditionalQuotes[index][field] = toInputDate(value);
    } else {
        currentAdditionalQuotes[index][field] = String(value || '').trim();
    }

    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    persistAdditionalQuotesState();
}

async function persistAdditionalQuotesState() {
    if (!selectedOrderId) return;

    const first = currentAdditionalQuotes[0] || null;
    const payload = {
        additional_quotes: currentAdditionalQuotes.length > 0 ? JSON.stringify(currentAdditionalQuotes) : null,
        quote_number_2: first ? (first.quote_number || null) : null,
        quote_date_2: first ? (first.quote_date || null) : null,
        quote_total_2: first && first.quote_total !== '' ? parseFloat(first.quote_total) : null,
    };

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
            showError(result.error || 'Failed to save additional quote');
            return;
        }

        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) {
            currentOrder = result.order;
        }
        hideError();
    } catch (error) {
        console.error('Error saving additional quote:', error);
        showError('Failed to save additional quote');
    }
}

function syncSecondaryQuoteSection(prefix = '', order = null) {
    const controls = getSecondaryQuoteControls(prefix);
    const section = document.getElementById(controls.section);
    const numberInput = document.getElementById(controls.quoteNumber);
    const dateInput = document.getElementById(controls.quoteDate);

    if (numberInput) numberInput.value = order ? (order.quote_number_2 || '') : '';
    if (dateInput) dateInput.value = order ? toInputDate(order.quote_date_2) : '';
    const totalInput = document.getElementById(prefix === 'inline' ? 'inline_quote_total_2' : 'quote_total_2');
    if (totalInput) totalInput.value = order ? (order.quote_total_2 || '') : '';

    const hasSecondaryQuote = Boolean(
        (order && (order.quote_number_2 || order.quote_date_2)) ||
        (numberInput && numberInput.value.trim()) ||
        (dateInput && dateInput.value.trim()) ||
        (section && section.style.display !== 'none')
    );

    setSecondaryQuoteVisibility(prefix, hasSecondaryQuote);
}

function showSecondaryQuoteFields(prefix = '') {
    setSecondaryQuoteVisibility(prefix, true);
    const controls = getSecondaryQuoteControls(prefix);
    const numberInput = document.getElementById(controls.quoteNumber);
    if (numberInput) numberInput.focus();

    if (prefix === 'inline') {
        renderSalesProcess(getSelectedOrder());
    }
}

function hideSecondaryQuoteFields(prefix = '') {
    clearSecondaryQuoteFields(prefix);
    setSecondaryQuoteVisibility(prefix, false);

    if (prefix === 'inline') {
        currentAdditionalQuotes = [];
        syncAdditionalQuotesToHiddenField();
        if (selectedOrderId) {
            persistStageField('quote_number_2', null);
            persistStageField('quote_date_2', null);
            persistStageField('quote_total_2', null);
            persistStageField('additional_quotes', null);
        }
        renderSalesProcess(getSelectedOrder());
    }
}

function collectInlineOrderFormData() {
    const data = {};

    Object.entries(INLINE_ORDER_FIELDS).forEach(([field, elementId]) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        const value = element.value.trim();
        data[field] = value === '' ? null : value;
    });

    if (data.quote_total) data.quote_total = parseFloat(data.quote_total);
    if (data.quote_total_2) data.quote_total_2 = parseFloat(data.quote_total_2);
    if (data.invoice_total) data.invoice_total = parseFloat(data.invoice_total);
    if (data.vendor_ack_total) data.vendor_ack_total = parseFloat(data.vendor_ack_total);
    if (data.priority_manual) data.priority_manual = parseInt(data.priority_manual, 10);

    // Inline form is hidden; never let a stale hidden select reset stage.
    const selectedOrder = getSelectedOrder();
    if (selectedOrder && selectedOrder.stage) {
        data.stage = selectedOrder.stage;
    }

    const transferInput = processTimeline
        ? processTimeline.querySelector('[data-stage-source-field="transfer_location"]')
        : null;
    if (transferInput) {
        data.transfer_location = normalizeTransferLocation(transferInput.value) || null;
    }

    data.line_items = currentLineItems.length > 0 ? JSON.stringify(currentLineItems) : null;

    data.additional_quotes = currentAdditionalQuotes.length > 0 ? JSON.stringify(currentAdditionalQuotes) : null;
    const firstAdditional = currentAdditionalQuotes[0] || null;
    data.quote_number_2 = firstAdditional ? (firstAdditional.quote_number || null) : null;
    data.quote_date_2 = firstAdditional ? (firstAdditional.quote_date || null) : null;
    data.quote_total_2 = firstAdditional && firstAdditional.quote_total !== ''
        ? parseFloat(firstAdditional.quote_total)
        : null;

    return data;
}

async function saveInlineOrder() {
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

        showToast('Order updated');
        hideError();
        await loadOrders();
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
        'prefit_bore_backset', 'prefit_swing', 'prefit_notes'
    ];
    
    fields.forEach(field => {
        const element = document.getElementById(field);
        if (!element) return;

        let value = order ? (order[field] || '') : '';
        if (field === 'po_numbers') {
            value = order ? (order.po_numbers || order.po_number || '') : '';
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
    
    // Show/hide prefit section based on data
    const hasPrefitData = order && (order.prefit_width || order.prefit_height || order.prefit_thickness || order.prefit_lites);
    const prefitSection = document.getElementById('prefitSection');
    if (prefitSection) {
        prefitSection.style.display = (hasPrefitData || needsPrefitCheckbox.checked) ? 'block' : 'none';
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
        
        if (openQuoteBtn) openQuoteBtn.style.display = order.quote_number ? 'inline-block' : 'none';
        if (openInvoiceBtn) openInvoiceBtn.style.display = order.invoice_number ? 'inline-block' : 'none';
        if (openSpecialOrderBtn) openSpecialOrderBtn.style.display = order.invoice_number ? 'inline-block' : 'none';
        
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
    const prefitSection = document.getElementById('prefitSection');
    
    if (needsPrefitCheckbox && prefitDetails) {
        prefitDetails.style.display = needsPrefitCheckbox.checked ? 'block' : 'none';
    }
    
    // Show entire prefit section if checkbox is checked
    if (prefitSection && needsPrefitCheckbox) {
        prefitSection.style.display = needsPrefitCheckbox.checked ? 'block' : 'none';
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
    try {
        // Collect form data
        const formData = new FormData(orderForm);
        const data = {};
        
        formData.forEach((value, key) => {
            // Convert empty strings to null for cleaner database
            data[key] = value.trim() === '' ? null : value;
        });
        
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
        if (data.quote_total) data.quote_total = parseFloat(data.quote_total);
        if (data.quote_total_2) data.quote_total_2 = parseFloat(data.quote_total_2);
        if (data.invoice_total) data.invoice_total = parseFloat(data.invoice_total);
        if (data.vendor_ack_total) data.vendor_ack_total = parseFloat(data.vendor_ack_total);
        if (data.customer_profile_id) {
            const parsedProfileId = parseInt(data.customer_profile_id, 10);
            data.customer_profile_id = Number.isNaN(parsedProfileId) ? null : parsedProfileId;
        }

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
        
        // Determine if creating or updating
        const isCreate = !currentOrder;
        const url = isCreate 
            ? `${API_BASE}/orders` 
            : `${API_BASE}/orders/${currentOrder.id}`;
        const method = isCreate ? 'POST' : 'PUT';
        
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
            showToast(isCreate ? 'Order created successfully!' : 'Order updated successfully!');
            closeOrderModal();
            loadOrders(); // Refresh the table
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

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target === orderModal) {
        closeOrderModal();
    }
    if (customerHistoryModal && event.target === customerHistoryModal) {
        closeCustomerHistoryModal();
    }
    if (customerLookupModal && event.target === customerLookupModal) {
        closeCustomerLookupModal();
    }
    if (customerProfileModal && event.target === customerProfileModal) {
        closeCustomerProfileModal();
    }
}

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

// Update orders count display
function updateOrdersCount(count) {
    if (arguments.length >= 3 && showCompletedCheckbox && showCompletedCheckbox.checked) {
        const activeCount = Number(arguments[1] || 0);
        const completedCountValue = Number(arguments[2] || 0);
        ordersCount.textContent = `${activeCount} active • ${completedCountValue} completed (${count} total)`;
        return;
    }

    ordersCount.textContent = `${count} order${count !== 1 ? 's' : ''}`;
}

// Show/hide loading indicator
function showLoading(show) {
    loadingIndicator.style.display = show ? 'block' : 'none';
}

// Show error message
function showError(message) {
    errorText.textContent = message;
    errorMessage.style.display = 'block';
}

// Hide error message
function hideError() {
    errorMessage.style.display = 'none';
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return '';
    
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else {
            return date.toLocaleDateString();
        }
    } catch (e) {
        return dateString;
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show toast notification (simple version)
function showToast(message) {
    // Remove any existing toasts
    const existing = document.querySelector('.toast');
    if (existing) {
        existing.remove();
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function showThemedConfirm({ title = 'Confirm Action', message = '', confirmLabel = 'Confirm', confirmClass = 'btn btn-warning' } = {}) {
    if (!confirmDialogModal || !confirmDialogTitle || !confirmDialogMessage || !confirmDialogConfirmBtn) {
        return Promise.resolve(confirm(`${title}\n\n${message}`));
    }

    confirmDialogTitle.textContent = title;
    confirmDialogMessage.textContent = message;
    confirmDialogConfirmBtn.textContent = confirmLabel;
    confirmDialogConfirmBtn.className = confirmClass;
    confirmDialogModal.style.display = 'block';

    return new Promise(resolve => {
        pendingConfirmResolve = resolve;
    });
}

function closeThemedConfirm(confirmed) {
    if (!confirmDialogModal) return;

    confirmDialogModal.style.display = 'none';
    if (pendingConfirmResolve) {
        pendingConfirmResolve(Boolean(confirmed));
        pendingConfirmResolve = null;
    }
}

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

function handleStageDoneChange(checkboxId) {
    const checkbox = document.getElementById(checkboxId);
    const timestampSpan = document.getElementById(checkboxId + '_timestamp');
    
    if (checkbox && timestampSpan) {
        if (checkbox.checked) {
            // Set timestamp to now
            const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
            timestampSpan.textContent = formatTimestamp(now);
        } else {
            // Clear timestamp
            timestampSpan.textContent = '';
        }

        updateStageDoneVisualState(checkbox);
        updateStageProgressSummary();
        
        // Trigger autosave
        scheduleAutosave();
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
        
        // Add stage done timestamps
        for (const [checkboxId, timestampField] of Object.entries(STAGE_DONE_FIELDS)) {
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                if (checkbox.checked) {
                    const timestampSpan = document.getElementById(checkboxId + '_timestamp');
                    const timestampText = timestampSpan ? timestampSpan.textContent : '';
                    if (timestampText) {
                        // Convert back to ISO format for database
                        data[timestampField] = convertTimestampToISO(timestampText);
                    }
                } else {
                    data[timestampField] = null;
                }
            }
        }
        
        // Send update request
        const response = await fetch(`${API_BASE}/orders/${currentOrder.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            // Silent autosave - no toast notification
            console.log('Autosaved order', currentOrder.id);
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
        const response = await fetch(`${DESKTOP_HELPER_URL}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
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

// ===== Attachments Functions =====

async function loadAttachments(orderId) {
    const modalSection = document.getElementById('attachmentsSection');
    const processSection = document.getElementById('processAttachmentsSection');

    if (!orderId) {
        if (modalSection) modalSection.style.display = 'none';
        if (processSection) processSection.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}/attachments`);
        const data = await response.json();
        
        if (data.success) {
            renderAttachments(data.attachments);
            if (modalSection) modalSection.style.display = 'block';
            if (processSection) processSection.style.display = 'block';
        } else {
            console.error('Failed to load attachments:', data.error);
        }
    } catch (error) {
        console.error('Error loading attachments:', error);
    }
}

function renderAttachments(attachments) {
    const containers = [
        document.getElementById('attachmentsList'),
        document.getElementById('processAttachmentsList')
    ].filter(Boolean);
    const downloadButtons = [
        document.getElementById('downloadAllBtn'),
        document.getElementById('processDownloadAllBtn')
    ].filter(Boolean);

    if (containers.length === 0) {
        return;
    }
    
    if (!attachments || attachments.length === 0) {
        containers.forEach(container => {
            container.innerHTML = '<div class="attachments-empty">No attachments yet</div>';
        });
        downloadButtons.forEach(button => {
            button.style.display = 'none';
        });
        return;
    }
    
    // Show download all button if there are attachments
    downloadButtons.forEach(button => {
        button.style.display = 'inline-block';
    });

    const attachmentsMarkup = attachments.map(att => `
        <div class="attachment-item">
            <div class="attachment-info">
                <span class="attachment-icon">${getFileIcon(att.filename)}</span>
                <span class="attachment-name">${escapeHtml(att.filename)}</span>
                <span class="attachment-date">${formatDate(att.added_at)}</span>
            </div>
            <div class="attachment-actions">
                <button class="btn-icon" onclick="downloadAttachment(${att.id}, '${escapeHtml(att.filename)}')" title="Download">
                    ⬇️
                </button>
                <button class="btn-icon btn-icon-danger" onclick="deleteAttachment(${att.id})" title="Delete">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');

    containers.forEach(container => {
        container.innerHTML = attachmentsMarkup;
    });
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'pdf': '📄',
        'doc': '📝', 'docx': '📝',
        'xls': '📊', 'xlsx': '📊',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️',
        'zip': '🗜️', 'rar': '🗜️',
        'txt': '📃'
    };
    return icons[ext] || '📎';
}

function getActiveOrderContext() {
    if (currentOrder && currentOrder.id) {
        return currentOrder;
    }

    return getSelectedOrder();
}

function openProcessFilePicker() {
    const activeOrder = getActiveOrderContext();
    if (!activeOrder || !activeOrder.id) {
        showError('Select an order first');
        return;
    }

    currentOrder = activeOrder;
    const processInput = document.getElementById('processFileInput');
    const fallbackInput = document.getElementById('fileInput');
    const input = processInput || fallbackInput;

    if (input) {
        input.click();
    }
}

function handleProcessFileSelect(event) {
    handleFileSelect(event);
}

async function handleFileSelect(event) {
    const files = event.target.files;
    const activeOrder = getActiveOrderContext();
    if (!files || files.length === 0 || !activeOrder || !activeOrder.id) return;

    currentOrder = activeOrder;
    
    for (const file of files) {
        await uploadFile(file, activeOrder.id);
    }
    
    // Clear the input
    event.target.value = '';
}

async function uploadFile(file, orderId) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('section', 'general');
    
    try {
        showToast(`Uploading ${file.name}...`);
        
        const response = await fetch(`${API_BASE}/orders/${orderId}/attachments`, {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`${file.name} uploaded successfully!`);
            loadAttachments(orderId);  // Reload attachments list
        } else {
            showError(result.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        showError('Failed to upload file');
    }
}

async function downloadAttachment(attachmentId, filename) {
    try {
        window.open(`${API_BASE}/attachments/${attachmentId}/download`, '_blank');
    } catch (error) {
        console.error('Error downloading file:', error);
        showError('Failed to download file');
    }
}

async function downloadAllAttachments() {
    const activeOrder = getActiveOrderContext();
    if (!activeOrder || !activeOrder.id) return;
    currentOrder = activeOrder;
    
    try {
        showToast('Preparing ZIP file...');
        window.open(`${API_BASE}/orders/${activeOrder.id}/attachments/download-all`, '_blank');
    } catch (error) {
        console.error('Error downloading attachments:', error);
        showError('Failed to download attachments');
    }
}

async function deleteAttachment(attachmentId) {
    if (!confirm('Delete this attachment?')) return;
    const activeOrder = getActiveOrderContext();
    if (!activeOrder || !activeOrder.id) return;
    currentOrder = activeOrder;
    
    try {
        const response = await fetch(`${API_BASE}/attachments/${attachmentId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Attachment deleted');
            loadAttachments(activeOrder.id);  // Reload attachments list
        } else {
            showError(result.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Error deleting attachment:', error);
        showError('Failed to delete attachment');
    }
}

// ===== Notes Functions =====

async function loadNotes(orderId) {
    if (!orderId) {
        document.getElementById('notesSection').style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}/notes`);
        const data = await response.json();
        
        if (data.success) {
            renderNotes(data.notes);
            document.getElementById('notesSection').style.display = 'block';
        } else {
            console.error('Failed to load notes:', data.error);
        }
    } catch (error) {
        console.error('Error loading notes:', error);
    }
}

function renderNotes(notes) {
    const container = document.getElementById('notesList');
    
    if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="notes-empty">No notes yet</div>';
        return;
    }
    
    container.innerHTML = notes.map(note => `
        <div class="note-item" data-note-id="${note.id}">
            <div class="note-content">
                <div class="note-text">${escapeHtml(note.note)}</div>
                <div class="note-date">${formatDate(note.created_at)}</div>
            </div>
            <div class="note-actions">
                <button class="btn-icon" onclick="editNote(${note.id}, \`${escapeHtml(note.note).replace(/`/g, '\\\\`')}\`)" title="Edit">
                    ✏️
                </button>
                <button class="btn-icon btn-icon-danger" onclick="deleteNote(${note.id})" title="Delete">
                    🗑️
                </button>
            </div>
        </div>
    `).join('');
}

async function addNote() {
    if (!currentOrder || !currentOrder.id) return;
    
    const textarea = document.getElementById('newNoteText');
    const noteText = textarea.value.trim();
    
    if (!noteText) {
        showError('Please enter a note');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/orders/${currentOrder.id}/notes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ note: noteText })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Note added');
            textarea.value = '';  // Clear textarea
            loadNotes(currentOrder.id);  // Reload notes list
        } else {
            showError(result.error || 'Failed to add note');
        }
    } catch (error) {
        console.error('Error adding note:', error);
        showError('Failed to add note');
    }
}

async function editNote(noteId, currentText) {
    const newText = prompt('Edit note:', currentText);
    
    if (newText === null) return;  // User cancelled
    
    const trimmedText = newText.trim();
    if (!trimmedText) {
        showError('Note cannot be empty');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/notes/${noteId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ note: trimmedText })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Note updated');
            loadNotes(currentOrder.id);  // Reload notes list
        } else {
            showError(result.error || 'Failed to update note');
        }
    } catch (error) {
        console.error('Error updating note:', error);
        showError('Failed to update note');
    }
}

async function deleteNote(noteId) {
    if (!confirm('Delete this note?')) return;
    
    try {
        const response = await fetch(`${API_BASE}/notes/${noteId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Note deleted');
            loadNotes(currentOrder.id);  // Reload notes list
        } else {
            showError(result.error || 'Delete failed');
        }
    } catch (error) {
        console.error('Error deleting note:', error);
        showError('Failed to delete note');
    }
}

// ===== Export Functions =====

function exportToCSV() {
    // Build query params from current filters
    const params = new URLSearchParams();
    params.append('search', searchInput.value);
    params.append('stage', stageFilter.value);
    params.append('show_completed', showCompletedCheckbox.checked);
    
    // Trigger download
    const url = `${API_BASE}/orders/export?${params.toString()}`;
    window.open(url, '_blank');
    
    showToast('Exporting orders to CSV...');
}

function downloadBackupJson() {
    const params = new URLSearchParams();
    // Always include archived orders in backup exports so full datasets can be migrated.
    params.append('include_archived', 'true');

    const url = `${API_BASE}/orders/backup-json?${params.toString()}`;
    window.open(url, '_blank');
    showToast('Preparing JSON backup download...');
}

function openRestoreBackupPicker() {
    if (!restoreBackupInput) {
        showError('Backup restore input is not available');
        return;
    }

    restoreBackupInput.value = '';
    restoreBackupInput.click();
}

async function restoreFromBackupFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) {
        return;
    }

    if (!file.name.toLowerCase().endsWith('.json')) {
        showError('Please select a JSON backup file');
        return;
    }

    const confirmed = confirm(
        `Restore backup file ${file.name}?\n\n` +
        'This will merge backup data into the current database and may update existing records.'
    );

    if (!confirmed) {
        return;
    }

    if (restoreBackupBtn) {
        restoreBackupBtn.disabled = true;
        restoreBackupBtn.textContent = 'Restoring...';
    }

    try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${API_BASE}/orders/restore-json`, {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            showError(result.error || 'Failed to restore backup');
            return;
        }

        const summary = result.summary || {};
        const orderSummary = summary.orders || {};
        const inserted = orderSummary.inserted || 0;
        const updated = orderSummary.updated || 0;

        showToast(`Backup restored. Orders inserted: ${inserted}, updated: ${updated}`);
        // Make restored rows visible immediately even if they were archived/completed.
        if (showCompletedCheckbox) {
            showCompletedCheckbox.checked = true;
        }
        if (stageFilter) {
            stageFilter.value = '';
        }
        if (searchInput) {
            searchInput.value = '';
        }
        if (ordersSearchInput) {
            ordersSearchInput.value = '';
        }
        await loadStages();
        await loadOrders();
    } catch (error) {
        console.error('Error restoring backup:', error);
        showError('Failed to restore backup');
    } finally {
        if (restoreBackupBtn) {
            restoreBackupBtn.disabled = false;
            restoreBackupBtn.textContent = 'Restore Backup JSON';
        }
        if (restoreBackupInput) {
            restoreBackupInput.value = '';
        }
    }
}

function buildBlankSalesProcessPrintHtml() {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Blank Product Intake Sheet</title>
    <style>
        @page { size: Letter portrait; margin: 0.5in; }
        body { font-family: Arial, sans-serif; color: #111; margin: 0; }
        h1 { font-size: 20px; margin: 0 0 8px; }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 10px 0 16px; }
        .field { border-bottom: 1px solid #333; min-height: 20px; }
        .label { font-size: 12px; font-weight: 700; margin-bottom: 3px; }
        .check-row { display: flex; gap: 12px; margin-bottom: 10px; font-size: 11px; flex-wrap: wrap; }
        .check-row.product-type { gap: 22px; margin-bottom: 14px; font-size: 16px; font-weight: 700; }
        .check-item { display: inline-flex; align-items: center; gap: 6px; }
        .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #333; }
        .check-row.product-type .box { width: 18px; height: 18px; border-width: 2px; }
        .small-field-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
        .check-columns { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
        .check-column { border: 1px solid #222; padding: 8px; }
        .check-column h3 { margin: 0 0 6px; font-size: 12px; }
        .check-column .check-item { display: flex; margin: 4px 0; }
        .line-fields { margin-top: 10px; border: 1px solid #222; padding: 8px; }
        .line-fields-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
        .footer { margin-top: 12px; font-size: 10px; color: #444; }
    </style>
</head>
<body>
    <h1>Order Tracker - Blank Product Intake Sheet</h1>
    <div class="meta">
        <div>
            <div class="label">Date</div>
            <div class="field"></div>
        </div>
        <div>
            <div class="label">Order # / Quote #</div>
            <div class="field"></div>
        </div>
        <div>
            <div class="label">Customer Name</div>
            <div class="field"></div>
        </div>
        <div>
            <div class="label">Project Name</div>
            <div class="field"></div>
        </div>
        <div>
            <div class="label">Phone</div>
            <div class="field"></div>
        </div>
        <div>
            <div class="label">Salesperson</div>
            <div class="field"></div>
        </div>
    </div>

    <div class="small-field-grid">
        <div><div class="label">Site Location</div><div class="field"></div></div>
        <div><div class="label">Contact Phone</div><div class="field"></div></div>
        <div><div class="label">Requested Date</div><div class="field"></div></div>
        <div><div class="label">Location</div><div class="field"></div></div>
    </div>

    <hr style="margin:12px 0; border:none; border-top:1px solid #999;">

    <div style="margin-top:12px;">
        <div class="label" style="font-weight:bold; margin-bottom:8px;">Product Entry #1</div>
        
        <div class="check-row product-type">
            <span class="check-item"><span class="box"></span> Door</span>
            <span class="check-item"><span class="box"></span> Window</span>
        </div>

        <div class="check-columns">
            <div class="check-column">
                <h3>Window Operation</h3>
                <span class="check-item"><span class="box"></span> XO</span>
                <span class="check-item"><span class="box"></span> OX</span>
                <span class="check-item"><span class="box"></span> XOX</span>
                <span class="check-item"><span class="box"></span> Half Vent</span>
                <span class="check-item"><span class="box"></span> Casement</span>
                <span class="check-item"><span class="box"></span> Awning</span>
                <span class="check-item"><span class="box"></span> Picture</span>
                <span class="check-item"><span class="box"></span> Double Hung</span>
            </div>
            <div class="check-column">
                <h3>Door Style</h3>
                <span class="check-item"><span class="box"></span> Slab</span>
                <span class="check-item"><span class="box"></span> Prehung</span>
                <span class="check-item"><span class="box"></span> French</span>
                <span class="check-item"><span class="box"></span> Patio</span>
                <span class="check-item"><span class="box"></span> Bypass</span>
                <span class="check-item"><span class="box"></span> Bifold</span>
                <span class="check-item"><span class="box"></span> Dutch Door</span>
                <span class="check-item"><span class="box"></span> Access Door</span>
                <h3 style="margin-top:8px;">Swing</h3>
                <span class="check-item"><span class="box"></span> LH</span>
                <span class="check-item"><span class="box"></span> RH</span>
                <span class="check-item"><span class="box"></span> LH Outswing</span>
                <span class="check-item"><span class="box"></span> RH Outswing</span>
            </div>
            <div class="check-column">
                <h3>Frame / Material</h3>
                <span class="check-item"><span class="box"></span> Vinyl</span>
                <span class="check-item"><span class="box"></span> Wood</span>
                <span class="check-item"><span class="box"></span> Aluminum</span>
                <span class="check-item"><span class="box"></span> Fiberglass</span>
                <span class="check-item"><span class="box"></span> Steel</span>
            </div>
            <div class="check-column">
                <h3>Glass</h3>
                <span class="check-item"><span class="box"></span> Clear</span>
                <span class="check-item"><span class="box"></span> Low-E</span>
                <span class="check-item"><span class="box"></span> Tempered</span>
                <span class="check-item"><span class="box"></span> Obscure</span>
            </div>
        </div>

        <div class="line-fields">
            <div class="line-fields-grid">
                <div><div class="label">Quantity</div><div class="field"></div></div>
                <div><div class="label">Width</div><div class="field"></div></div>
                <div><div class="label">Height</div><div class="field"></div></div>
                <div><div class="label">Style / Series</div><div class="field"></div></div>
                <div><div class="label">Vendor</div><div class="field"></div></div>
            </div>
        </div>
    </div>

    <div style="margin-top:10px;">
        <div class="label">Notes</div>
        <div style="border:1px solid #222; min-height:72px;"></div>
    </div>

    <div class="footer">Print this page for field product-detail gathering before entry.</div>
</body>
</html>`;
}

function exportBlankSalesProcessHardCopy() {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showError('Pop-up blocked. Please allow pop-ups to export hard copy.');
        return;
    }

    const html = buildBlankSalesProcessPrintHtml();
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    showToast('Opened blank product intake sheet for printing.');
}

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

// ===== Backup Functions =====

async function backupOrder() {
    if (!currentOrder || !currentOrder.id) {
        showError('No order selected');
        return;
    }
    
    const confirmed = confirm(`Create a backup of this order?\n\nCustomer: ${currentOrder.customer_name}\nProject: ${currentOrder.project_name || 'N/A'}\n\nThis will save:\n- Order data\n- All attachments\n\nBackup location: OneDrive OrderTrackerBackups`);
    
    if (!confirmed) return;
    
    try {
        const response = await fetch(`${API_BASE}/orders/${currentOrder.id}/backup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Backup created successfully!');
            // Optionally show the backup path
            if (result.backup_path) {
                console.log('Backup saved to:', result.backup_path);
            }
        } else {
            showError(result.error || 'Failed to create backup');
        }
    } catch (error) {
        console.error('Error creating backup:', error);
        showError('Failed to create backup');
    }
}

async function backupAllOrders() {
    const includeArchived = showCompletedCheckbox.checked;
    const orderType = includeArchived ? 'all orders (including archived)' : 'active orders';
    
    const confirmed = confirm(`Backup ${orderType}?\n\nThis will create backups for each order including:\n- Order data\n- All attachments\n\nBackup location: OneDrive OrderTrackerBackups\n\nThis may take a few moments...`);
    
    if (!confirmed) return;
    
    // Disable button during backup
    backupAllBtn.disabled = true;
    backupAllBtn.textContent = '⏳ Backing up...';
    
    try {
        const response = await fetch(`${API_BASE}/orders/backup-all`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                include_archived: includeArchived
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            let message = `Backup complete!\n\nBacked up: ${result.backed_up} orders`;
            if (result.failed > 0) {
                message += `\nFailed: ${result.failed} orders`;
                if (result.errors && result.errors.length > 0) {
                    message += `\n\nFirst errors:\n${result.errors.join('\n')}`;
                }
            }
            
            showToast(`Successfully backed up ${result.backed_up} orders!`);
            
            // Show detailed results in console
            console.log(message);
            
            // Optionally show alert with details
            if (result.failed > 0) {
                alert(message);
            }
        } else {
            showError(result.error || 'Failed to backup orders');
        }
    } catch (error) {
        console.error('Error backing up orders:', error);
        showError('Failed to backup orders');
    } finally {
        // Re-enable button
        backupAllBtn.disabled = false;
        backupAllBtn.textContent = '💾 Backup All';
    }
}

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
                    showAlert(`Reminder Due: ${reminder.title}`, 'warning');
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
                    <button type="button" class="btn btn-sm btn-secondary" onclick="quickAddReminderForOrder()" title="Add reminder for this order">+ Add</button>
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

// Close modals when clicking outside
window.addEventListener('click', function(event) {
    if (event.target === remindersModal) {
        closeRemindersModal();
    }
    if (event.target === confirmDialogModal) {
        closeThemedConfirm(false);
    }
});

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

// Check if desktop helper is running
async function checkDesktopHelper() {
    const statusElement = document.getElementById('helperStatus');
    const statusTextElement = document.getElementById('helperStatusText');
    
    try {
        const response = await fetch(`${DESKTOP_HELPER_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(1000) // 1 second timeout
        });
        const result = await response.json();
        desktopHelperAvailable = result.status === 'running';
        
        if (desktopHelperAvailable) {
            statusElement.className = 'helper-status available';
            statusTextElement.textContent = '🤖 Automation Ready';
        } else {
            statusElement.className = 'helper-status unavailable';
            statusTextElement.textContent = '⚠️ Manual Mode';
        }
        
        return desktopHelperAvailable;
    } catch (error) {
        desktopHelperAvailable = false;
        statusElement.className = 'helper-status unavailable';
        statusTextElement.textContent = '⚠️ Manual Mode';
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

function mapLineItemForAs400Automation(item) {
    const quantity = Number.parseInt(item.quantity || '1', 10) || 1;
    const width = String(item.width || '').trim();
    const height = String(item.height || '').trim();
    const sizeText = String(item.size || '').trim() || (width && height ? `${width} x ${height}` : '');
    const operationText = String(item.operation || item.operation_style || item.handing || '').trim();
    const locationText = String(item.location || item.room || '').trim();
    const descriptionText = String(item.description || '').trim() || [locationText, operationText, sizeText].filter(Boolean).join(' | ');

    return {
        ...item,
        item_type: item.type || item.item_type || item.product || '',
        type: item.type || item.item_type || item.product || '',
        product: item.product || (String(item.type || '').toLowerCase().includes('window') ? 'Window' : 'Door'),
        handing: operationText,
        operation: operationText,
        operation_style: operationText,
        location: locationText,
        room: item.room || locationText,
        description: descriptionText,
        size: sizeText,
        model: item.model || item.series || item.style || '',
        series: item.series || item.style || '',
        finish: item.finish || item.material || '',
        width,
        height,
        quantity,
        vendor_sku: item.vendor_sku || item.sku || '',
        sku: item.sku || item.vendor_sku || '',
        unit_price: item.unit_price || item.price || '',
        price: item.price || item.unit_price || ''
    };
}

async function createQuote() {
    const actionOrder = currentOrder && currentOrder.id ? currentOrder : getSelectedOrder();
    if (!actionOrder || !actionOrder.id) {
        alert('No order selected');
        return;
    }

    // Keep currentOrder in sync so existing helper paths continue to work.
    currentOrder = actionOrder;

    const lineItemsForAutomation = getLineItemsForAutomation(actionOrder).map(mapLineItemForAs400Automation);
    const fallbackVendorSku = lineItemsForAutomation.find(item => item.vendor_sku)?.vendor_sku || actionOrder.vendor_sku || '';
    
    // Check if desktop helper is available
    const helperAvailable = await checkDesktopHelper();
    
    if (helperAvailable) {
        // Use desktop helper for full automation
        try {
            const response = await fetch(`${DESKTOP_HELPER_URL}/launch-quote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    order_id: actionOrder.id,  // Include order ID for auto-update
                    customer_name: actionOrder.customer_name,
                    customer_phone: actionOrder.customer_phone,
                    customer_email: actionOrder.customer_email,
                    project_name: actionOrder.project_name,
                    quote_number: actionOrder.quote_number,
                    size: actionOrder.size || '',
                    jamb: actionOrder.jamb || '',
                    color: actionOrder.color || '',
                    customer_number: actionOrder.customer_number,
                    has_customer_account: actionOrder.has_customer_account,
                    line_items: lineItemsForAutomation,
                    vendor_sku: fallbackVendorSku,
                    needs_prefit: actionOrder.needs_prefit,
                    prefit_meta: actionOrder.prefit_width ? {
                        rough_opening: `${actionOrder.prefit_width} x ${actionOrder.prefit_height}`,
                        thickness: actionOrder.prefit_thickness,
                        hc_sc: actionOrder.prefit_hinge_radius === 'Square' ? 'SC' : 'HC',
                        door_cfg: actionOrder.door_configuration?.toLowerCase().includes('slab') ? 'Slab' : 'PH'
                    } : null
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                let message = `✅ AS400 Quote launched for ${actionOrder.customer_name}`;
                
                // Check if quote number was automatically captured
                if (result.captured_quote_number) {
                    message += `\n📋 Quote Number: ${result.captured_quote_number}`;
                    
                    // Update the current order with the captured quote number
                    actionOrder.quote_number = result.captured_quote_number;
                    
                    // Update the form field if it's visible
                    const quoteField = document.getElementById('quote-number');
                    if (quoteField) {
                        quoteField.value = result.captured_quote_number;
                    }
                    
                    // Refresh the orders table to show the updated quote number
                    await loadOrders();
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

async function createInvoice() {
    // Always prefer the currently selected row to avoid launching automation
    // with stale in-memory order data.
    const actionOrder = getSelectedOrder() || (currentOrder && currentOrder.id ? currentOrder : null);
    if (!actionOrder || !actionOrder.id) {
        alert('No order selected');
        return;
    }

    currentOrder = actionOrder;

    const lineItemsForAutomation = getLineItemsForAutomation(actionOrder).map(mapLineItemForAs400Automation);
    const fallbackVendorSku = lineItemsForAutomation.find(item => item?.vendor_sku)?.vendor_sku || actionOrder.vendor_sku || '';
    
    const helperAvailable = await checkDesktopHelper();
    
    if (helperAvailable) {
        // Use desktop helper for full automation
        try {
            const response = await fetch(`${DESKTOP_HELPER_URL}/launch-invoice`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    order_id: actionOrder.id,
                    stage: actionOrder.stage,
                    customer_name: actionOrder.customer_name,
                    customer_phone: actionOrder.customer_phone,
                    project_name: actionOrder.project_name,
                    invoice_number: actionOrder.invoice_number,
                    quote_number: actionOrder.quote_number,
                    customer_number: actionOrder.customer_number,
                    has_customer_account: actionOrder.has_customer_account,
                    line_items: lineItemsForAutomation,
                    vendor_sku: fallbackVendorSku,
                    size: actionOrder.size || '',
                    jamb: actionOrder.jamb || '',
                    color: actionOrder.color || ''
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast(`✅ AS400 Invoice launched for ${actionOrder.customer_name}`);
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

async function createSpecialOrder() {
    const actionOrder = currentOrder && currentOrder.id ? currentOrder : getSelectedOrder();
    if (!actionOrder || !actionOrder.id) {
        alert('No order selected');
        return;
    }

    currentOrder = actionOrder;
    
    const helperAvailable = await checkDesktopHelper();
    const specialOrderSourceNumber = (actionOrder.quote_number || actionOrder.invoice_number || '').trim();
    
    if (helperAvailable) {
        // Use desktop helper for full automation
        try {
            const response = await fetch(`${DESKTOP_HELPER_URL}/launch-special-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    customer_name: actionOrder.customer_name,
                    customer_phone: actionOrder.customer_phone,
                    project_name: actionOrder.project_name,
                    quote_number: specialOrderSourceNumber,
                    invoice_number: actionOrder.invoice_number
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast(`✅ AS400 Special Order launched for ${actionOrder.customer_name}`);
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

// ===== Open Existing Quote/Invoice/Special Order Functions =====

async function openQuote() {
    const actionOrder = getSelectedOrder();
    if (!actionOrder || !actionOrder.id) {
        alert('Please select an order first');
        return;
    }

    if (!actionOrder || !actionOrder.quote_number) {
        alert('No quote number found for this order');
        return;
    }

    const helperAvailable = await checkDesktopHelper();
    
    if (helperAvailable) {
        try {
            const response = await fetch(`${DESKTOP_HELPER_URL}/open-quote`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    quote_number: actionOrder.quote_number
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast(`✅ Opening quote ${actionOrder.quote_number} in AS400`);
            } else {
                showError(result.error || 'Failed to open quote');
            }
        } catch (error) {
            console.error('Error calling desktop helper:', error);
            showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
        }
    } else {
        showError('Desktop helper service not available. Cannot open quote automatically.');
    }
}

async function openInvoice() {
    const actionOrder = getSelectedOrder();
    if (!actionOrder || !actionOrder.id) {
        alert('Please select an order first');
        return;
    }

    if (!actionOrder || !actionOrder.invoice_number) {
        alert('No invoice number found for this order');
        return;
    }

    const helperAvailable = await checkDesktopHelper();
    
    if (helperAvailable) {
        try {
            const response = await fetch(`${DESKTOP_HELPER_URL}/open-invoice`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    invoice_number: actionOrder.invoice_number
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast(`✅ Opening invoice ${actionOrder.invoice_number} in AS400`);
            } else {
                showError(result.error || 'Failed to open invoice');
            }
        } catch (error) {
            console.error('Error calling desktop helper:', error);
            showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
        }
    } else {
        showError('Desktop helper service not available. Cannot open invoice automatically.');
    }
}

async function openSpecialOrder() {
    const actionOrder = getSelectedOrder();
    if (!actionOrder || !actionOrder.id) {
        alert('Please select an order first');
        return;
    }

    const specialOrderNumber = actionOrder?.order_number || actionOrder?.invoice_number;

    if (!actionOrder || !specialOrderNumber) {
        alert('No special order number found for this order');
        return;
    }

    const helperAvailable = await checkDesktopHelper();
    
    if (helperAvailable) {
        try {
            const response = await fetch(`${DESKTOP_HELPER_URL}/open-special-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    order_number: specialOrderNumber
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast(`✅ Opening special order ${specialOrderNumber} in AS400`);
            } else {
                showError(result.error || 'Failed to open special order');
            }
        } catch (error) {
            console.error('Error calling desktop helper:', error);
            showError('Desktop helper service error. Make sure desktop_helper_service.py is running.');
        }
    } else {
        showError('Desktop helper service not available. Cannot open special order automatically.');
    }
}

// ===== OCR / Bulk Import Functions =====

const ocrModal = document.getElementById('ocrModal');
const ocrImportBtn = document.getElementById('ocrImportBtn');

// Initialize OCR button listener
if (ocrImportBtn) {
    ocrImportBtn.addEventListener('click', () => {
        openOCRModal();
    });
}

function openOCRModal() {
    ocrModal.style.display = 'block';
}

function closeOCRModal() {
    ocrModal.style.display = 'none';
    // Reset file input
    document.getElementById('ocrFileInput').value = '';
    document.getElementById('ocrFileName').textContent = '';
    document.getElementById('ocrProgress').style.display = 'none';
}

async function handleOCRFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Show filename
    document.getElementById('ocrFileName').textContent = `Selected: ${file.name}`;
    document.getElementById('ocrProgress').style.display = 'block';
    
    const progressBar = document.getElementById('ocrProgressBar');
    progressBar.style.width = '0%';
    
    // Check file type - JSON files get bulk imported
    if (file.name.endsWith('.json')) {
        try {
            // Show progress
            progressBar.style.width = '30%';
            
            // Upload and import
            const formData = new FormData();
            formData.append('file', file);
            
            progressBar.style.width = '60%';
            
            const response = await fetch(`${API_BASE}/import/bulk`, {
                method: 'POST',
                body: formData
            });
            
            progressBar.style.width = '90%';
            
            const result = await response.json();
            
            progressBar.style.width = '100%';
            
            setTimeout(() => {
                if (result.success) {
                    showToast(result.message);
                    closeOCRModal();
                    loadOrders(); // Refresh table
                } else if (result.duplicate) {
                    alert(`⚠️ Duplicate Detected\n\n${result.message}\n\nThis order was not imported.`);
                    closeOCRModal();
                } else {
                    showError(result.error || 'Failed to import');
                    document.getElementById('ocrProgress').style.display = 'none';
                }
            }, 300);
            
        } catch (error) {
            console.error('Bulk import error:', error);
            showError('Failed to import JSON file');
            document.getElementById('ocrProgress').style.display = 'none';
        }
    } else if (file.name.toLowerCase().endsWith('.pdf')) {
        // Process PDF with OCR
        try {
            progressBar.style.width = '30%';
            
            const formData = new FormData();
            formData.append('file', file);
            
            progressBar.style.width = '50%';
            
            const response = await fetch(`${API_BASE}/ocr/process-pdf`, {
                method: 'POST',
                body: formData
            });
            
            progressBar.style.width = '80%';
            
            const result = await response.json();
            
            console.log('OCR Response:', result);  // DEBUG
            
            progressBar.style.width = '100%';
            
            if (result.success && result.parsed && result.data && result.data.orders) {
                // Successfully parsed orders from PDF
                setTimeout(async () => {
                    const orders = result.data.orders;
                    
                    // Check if orders is actually an array
                    if (!Array.isArray(orders)) {
                        console.error('Orders is not an array:', orders);
                        alert('❌ Error: Unexpected response format from server');
                        closeOCRModal();
                        return;
                    }
                    
                    showToast(`✅ PDF processed! Found ${orders.length} order(s)`);
                    
                    // Import each order
                    let imported = 0;
                    let failed = 0;
                    
                    for (const orderData of orders) {
                        try {
                            // Use the correct endpoint: POST /api/orders
                            const importResponse = await fetch(`${API_BASE}/orders`, {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify(orderData)
                            });
                            
                            const importResult = await importResponse.json();
                            
                            if (importResult.success) {
                                imported++;
                            } else {
                                console.error('Failed to import order:', importResult.error);
                                failed++;
                            }
                        } catch (err) {
                            console.error('Error importing order:', err);
                            failed++;
                        }
                    }
                    
                    closeOCRModal();
                    loadOrders(); // Refresh table
                    
                    let message = `✅ Import complete!\n\n`;
                    message += `Imported: ${imported}\n`;
                    if (failed > 0) {
                        message += `Failed: ${failed}\n`;
                    }
                    alert(message);
                }, 300);
                
            } else if (result.success && result.raw_text) {
                // Text extracted but not parsed
                setTimeout(() => {
                    document.getElementById('ocrProgress').style.display = 'none';
                    alert('⚠️ PDF Text Extracted\n\n' +
                        'Text was extracted from the PDF but could not be automatically parsed as an order form.\n\n' +
                        'This may be because:\n' +
                        '• The PDF format is not recognized\n' +
                        '• The text quality is poor\n' +
                        '• It\'s not a standard order form\n\n' +
                        'Please manually create the order or use the desktop version for custom form parsing.');
                    closeOCRModal();
                }, 300);
            } else {
                throw new Error(result.error || 'Failed to process PDF');
            }
            
        } catch (error) {
            console.error('PDF OCR error:', error);
            showError(`PDF processing failed: ${error.message}`);
            document.getElementById('ocrProgress').style.display = 'none';
        }
    } else {
        // For image files or other formats
        progressBar.style.width = '100%';
        setTimeout(() => {
            document.getElementById('ocrProgress').style.display = 'none';
            alert('OCR Import for Images\n\n' +
                'Image/PDF OCR import requires additional setup:\n\n' +
                '• Install Tesseract OCR library\n' +
                '• Configure server-side OCR processing\n' +
                '• Parse extracted text into order data\n\n' +
                'Currently supported: JSON bulk import files and PDF forms\n' +
                'The desktop version has full OCR capabilities.');
            closeOCRModal();
        }, 500);
    }
}

// Close OCR modal when clicking outside
window.addEventListener('click', function(event) {
    if (event.target === ocrModal) {
        closeOCRModal();
    }
});

// ===== Background Monitoring & Notifications =====

let monitoringInterval = null;
let lastOrderCount = 0;
const enableMonitoringCheckbox = document.getElementById('enableMonitoring');

// Initialize monitoring checkbox
if (enableMonitoringCheckbox) {
    // Check localStorage for saved preference
    const savedPreference = localStorage.getItem('enableMonitoring');
    if (savedPreference === 'true') {
        enableMonitoringCheckbox.checked = true;
        startMonitoring();
    }
    
    enableMonitoringCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            startMonitoring();
            localStorage.setItem('enableMonitoring', 'true');
        } else {
            stopMonitoring();
            localStorage.setItem('enableMonitoring', 'false');
        }
    });
}

function startMonitoring() {
    console.log('Starting background monitoring...');
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showToast('Notifications enabled! You\'ll be notified of new orders.');
            }
        });
    }
    
    // Get initial count
    fetchOrderCount();
    
    // Poll every 30 seconds
    monitoringInterval = setInterval(() => {
        fetchOrderCount();
    }, 30000); // 30 seconds
}

function stopMonitoring() {
    console.log('Stopping background monitoring...');
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}

async function fetchOrderCount() {
    try {
        // Don't show completed orders in monitoring
        const params = new URLSearchParams();
        params.append('search', '');
        params.append('stage', '');
        params.append('show_completed', 'false');
        
        const response = await fetch(`${API_BASE}/orders?${params.toString()}`);
        const data = await response.json();
        
        if (data.success) {
            const currentCount = data.count;
            
            // Check if count increased
            if (lastOrderCount > 0 && currentCount > lastOrderCount) {
                const newOrders = currentCount - lastOrderCount;
                showNewOrderNotification(newOrders);
            }
            
            lastOrderCount = currentCount;
        }
    } catch (error) {
        console.error('Error fetching order count for monitoring:', error);
    }
}

function showNewOrderNotification(count) {
    const title = `${count} New Order${count > 1 ? 's' : ''}!`;
    const body = `${count} new order${count > 1 ? 's have' : ' has'} been added to the system.`;
    
    // Show browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: '/static/favicon.ico',
            badge: '/static/favicon.ico',
            tag: 'new-orders',
            requireInteraction: false
        });
        
        notification.onclick = function() {
            window.focus();
            notification.close();
            loadOrders(); // Refresh the orders list
        };
        
        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);
    }
    
    // Also show toast
    showToast(body);
    
    // Play sound (if browser allows)
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjWM0fPTgjMGHm7A7+OZSA0PVanp6qVXFAlEnNjxwWwkBjGIzfPZgjYGG2W77O6fSwwOUaHk6qxaFQlBmdLxzHUoCSptwO/omUwQD1Se4+yuXBgJPZPP8dJ8LgYsdeL87qNWFgk+mtXw1H4yBShy1u/pmU0QD1Oa4+ytWxYJQJTM8dV/MgYqcNnv66RUFQ1BoM/v');
        audio.volume = 0.3;
        audio.play().catch(() => {
            // Silently fail if audio doesn't play
        });
    } catch (e) {
        // Audio not supported, ignore
    }
}

// Stop monitoring when page is unloaded
window.addEventListener('beforeunload', () => {
    stopMonitoring();
});
