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

// Contacts for autocomplete

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
const addHardwareItemBtn = document.getElementById('addHardwareItemBtn');
const addDoorItemBottomBtn = document.getElementById('addDoorItemBottomBtn');
const addWindowItemBottomBtn = document.getElementById('addWindowItemBottomBtn');
const addHardwareItemBottomBtn = document.getElementById('addHardwareItemBottomBtn');
const lineItemsList = document.getElementById('lineItemsList');
const orderItemsContainerCard = document.getElementById('orderItemsContainerCard');
const toggleItemsContainerBtn = document.getElementById('toggleItemsContainerBtn');
const workspaceLayout = document.getElementById('workspaceLayout');
const ordersColumn = document.getElementById('ordersColumn');
const toggleOrdersColumnBtn = document.getElementById('toggleOrdersColumnBtn');
const confirmDialogModal = document.getElementById('confirmDialogModal');
const confirmDialogTitle = document.getElementById('confirmDialogTitle');
const confirmDialogMessage = document.getElementById('confirmDialogMessage');
const confirmDialogConfirmBtn = document.getElementById('confirmDialogConfirmBtn');
let openProcessStages = new Set();
let pendingConfirmResolve = null;
let currentLineItems = [];
let currentAdditionalQuotes = [];
let currentAdditionalInvoices = [];
let currentAdditionalPurchaseOrders = [];
let lastSavedLineItemsJson = null;
let lineItemsDirty = false;
let customerLookupDebounce = null;
let currentLookupCustomers = [];
let currentCustomerProfile = null;
const WINDOW_HANDING_STORAGE_KEY = 'order_tracker_window_handing_options';
const DEFAULT_WINDOW_HANDING_OPTIONS = ['XO', 'OX', 'XOX'];
const JAMB_SIZE_STORAGE_KEY = 'order_tracker_jamb_size_options';
const DEFAULT_JAMB_SIZE_OPTIONS = ['4 9/16', '6 9/16'];
const DOOR_LOCATION_STORAGE_KEY = 'doorlocationoptions';
const DEFAULT_DOOR_LOCATION_OPTIONS = ['Interior', 'Exterior'];
const DEFAULT_ITEM_STYLE_OPTIONS = {
    door: [
        'Slab', 
        'Prehung', 
        'French', 
        'Pio',
    ],
    window: ['Single Hung', 'Double Hung', 'Casement', 'Sliding', 'Picture', 'Gable'],
    hardware: ['Handleset', 'Entry Set', 'Deadbolt', 'Passage', 'Privacy', 'Dummy']
};
const DEFAULT_ITEM_VENDOR_OPTIONS = {
    door: ['Jeld-Wen', 'Masonite', 'Therma-Tru'],
    window: ['Milgard', 'Andersen', 'Pella'],
    hardware: ['Emtek']
};
const DEFAULT_FIN_TYPE_OPTIONS = ['1" Setback'];
const DEFAULT_WINDOW_COLOR_OPTIONS = [];

const FIN_TYPE_ALIASES = {
    '1': '1" Setback',
    '1 setback': '1" Setback',
    '1 3/8': '1 3/8" Setback',
    '1 3/8 setback': '1 3/8" Setback'
};


const FIN_TYPE_DISPLAY = {
    '1" Setback': '1" SB',
    '1 3/8" Setback': '1 3/8" SB'
};


let itemStyleOptions = {
    door: [...DEFAULT_ITEM_STYLE_OPTIONS.door],
    window: [...DEFAULT_ITEM_STYLE_OPTIONS.window],
    hardware: [...DEFAULT_ITEM_STYLE_OPTIONS.hardware]
};
let itemVendorOptions = {
    door: [...DEFAULT_ITEM_VENDOR_OPTIONS.door],
    window: [...DEFAULT_ITEM_VENDOR_OPTIONS.window],
    hardware: [...DEFAULT_ITEM_VENDOR_OPTIONS.hardware]
};
let vendorSeriesOptions = {
    door: {},
    window: {},
    hardware: {}
};
let finTypeOptions = [...DEFAULT_FIN_TYPE_OPTIONS];
let windowColorOptions = [...DEFAULT_WINDOW_COLOR_OPTIONS];
let vendorSkuByName = {};
let windowHandingOptions = [...DEFAULT_WINDOW_HANDING_OPTIONS];
let jambSizeOptions = [...DEFAULT_JAMB_SIZE_OPTIONS];
let doorLocationOptions = ['Interior', 'Exterior'];

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

const AS400_COMMENT_PREF_FIELD_LABELS = {
    room: 'Room / Location',
    vendor: 'Vendor',
    series: 'Series / Model',
    style: 'Style',
    material: 'Material',
    finType: 'Frame / Fin Type (windows)',
    color: 'Color',
    glass: 'Glass',
    argon: 'Argon',
    temperedGlass: 'Tempered Glass',
    handing: 'Handing / Operation',
    jamb: 'Jamb Size (doors)',
    swing: 'Swing (doors)',
    notes: 'Notes'
};

function initializeAs400CommentPrefsButton() {
    const btn = document.getElementById('as400CommentPrefsBtn');
    if (btn) {
        btn.addEventListener('click', openAs400CommentPrefsModal);
    }
}

function openAs400CommentPrefsModal() {
    const modal = document.getElementById('as400CommentPrefsModal');
    const listEl = document.getElementById('as400CommentPrefsFieldList');
    if (!modal || !listEl) return;

    const prefs = getAs400CommentFieldPrefs();
    listEl.innerHTML = Object.keys(AS400_COMMENT_PREF_FIELD_LABELS).map(key => `
        <label style="display: flex; align-items: center; gap: 8px; font-size: var(--font-size-sm);">
            <input type="checkbox" data-as400-comment-pref="${key}" ${prefs[key] ? 'checked' : ''}>
            ${AS400_COMMENT_PREF_FIELD_LABELS[key]}
        </label>
    `).join('');
    modal.style.display = 'block';
}

function closeAs400CommentPrefsModal() {
    const modal = document.getElementById('as400CommentPrefsModal');
    if (modal) modal.style.display = 'none';
}

function saveAs400CommentPrefsModal() {
    const listEl = document.getElementById('as400CommentPrefsFieldList');
    if (!listEl) return;

    const prefs = {};
    listEl.querySelectorAll('[data-as400-comment-pref]').forEach(input => {
        prefs[input.getAttribute('data-as400-comment-pref')] = input.checked;
    });
    setAs400CommentFieldPrefs(prefs);
    refreshAllAs400CommentPreviews();
    closeAs400CommentPrefsModal();
}

function resetAs400CommentPrefsToDefault() {
    setAs400CommentFieldPrefs(DEFAULT_AS400_COMMENT_FIELD_PREFS);
    refreshAllAs400CommentPreviews();
    openAs400CommentPrefsModal();
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
    additional_invoices: 'inline_additional_invoices',
    additional_pos: 'inline_additional_pos',
    po_numbers: 'inline_po_numbers',
    po_date_signed: 'inline_po_date_signed',
    vendor_ack_number: 'inline_vendor_ack_number',
    vendor_ack_total: 'inline_vendor_ack_total',
    eta_date: 'inline_eta_date'
};

const STAGE_SMART_FIELD_MAP = {
    ORDER_DETAILS: ['customer_name', 'customer_phone', 'customer_email', 'customer_number', 'project_name', 'stage', 'priority_manual'],
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
let lineItemsAutosaveTimeout = null;
const LINE_ITEMS_AUTOSAVE_DELAY = 2500;

// Request sequence counter — discard stale loadOrders responses.
let loadOrdersSequence = 0;
const PREFIT_COMMENT_MAX_LINES = 6;
const PREFIT_COMMENT_MAX_CHARS_PER_LINE = 30;
function getLineItemsJsonForSave() {
    return currentLineItems.length > 0 ? JSON.stringify(currentLineItems) : null;
}

function markLineItemsDirty() {
    lineItemsDirty = true;
}

function resetLineItemsDirty(savedJson = undefined) {
    lastSavedLineItemsJson = savedJson === undefined ? getLineItemsJsonForSave() : savedJson;
    lineItemsDirty = false;
}

function getChangedLineItemsJson() {
    const nextJson = getLineItemsJsonForSave();
    if (!lineItemsDirty && nextJson === lastSavedLineItemsJson) {
        return undefined;
    }
    return nextJson;
}

function applyUpdatedOrderLocally(order) {
    if (!order || !order.id) return;

    const existingIndex = allOrders.findIndex(item => item.id === order.id);
    if (existingIndex >= 0) {
        allOrders = sortOrdersForList(allOrders.map(item => item.id === order.id ? order : item));
    } else {
        allOrders = sortOrdersForList([...allOrders, order]);
    }

    if (selectedOrderId === order.id || (currentOrder && currentOrder.id === order.id)) {
        selectedOrderId = order.id;
        currentOrder = order;
    }
}

function refreshOrderListAndProcess() {
    const { activeOrders, completedOrders } = splitOrdersByArchiveStatus(allOrders);
    renderOrdersTable(activeOrders);
    renderCompletedOrders(completedOrders);
    renderSalesProcess(getSelectedOrder());
}

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

const STAGE_NUMERIC_FIELDS = new Set([
    'quote_total',
    'quote_total_2',
    'invoice_total',
    'vendor_ack_total',
    'priority_manual',
]);

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

const ORDERS_COLUMN_COLLAPSED_STORAGE_KEY = 'order_tracker_orders_column_collapsed';

function setOrdersColumnCollapsed(collapsed) {
    if (!ordersColumn || !workspaceLayout || !toggleOrdersColumnBtn) return;

    const isCollapsed = Boolean(collapsed);
    ordersColumn.classList.toggle('collapsed', isCollapsed);
    workspaceLayout.classList.toggle('orders-collapsed', isCollapsed);
    toggleOrdersColumnBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
    toggleOrdersColumnBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    toggleOrdersColumnBtn.setAttribute('title', isCollapsed ? 'Expand order list' : 'Collapse order list');
}

function initializeOrdersColumnCollapse() {
    const saved = window.localStorage.getItem(ORDERS_COLUMN_COLLAPSED_STORAGE_KEY);
    setOrdersColumnCollapsed(saved === 'true');

    if (toggleOrdersColumnBtn) {
        toggleOrdersColumnBtn.addEventListener('click', () => {
            const nextState = !ordersColumn.classList.contains('collapsed');
            setOrdersColumnCollapsed(nextState);
            window.localStorage.setItem(ORDERS_COLUMN_COLLAPSED_STORAGE_KEY, nextState ? 'true' : 'false');
        });
    }
}

function runStartupStep(label, fn) {
    try {
        const result = fn();
        if (result && typeof result.catch === 'function') {
            result.catch(error => console.error(`Startup step failed: ${label}`, error));
        }
    } catch (error) {
        console.error(`Startup step failed: ${label}`, error);
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Load the order list first so optional panels cannot block the main workflow.
    runStartupStep('load orders', () => loadOrders());

    runStartupStep('high contrast toggle', initializeHighContrastToggle);
    runStartupStep('order items collapse', initializeOrderItemsContainerCollapse);
    runStartupStep('orders column collapse', initializeOrdersColumnCollapse);
    runStartupStep('as400 comment prefs button', initializeAs400CommentPrefsButton);
    runStartupStep('stage tab loop', bindStageTabLoop);
    runStartupStep('bulk set panel', initBulkSetPanel);
    runStartupStep('load stages', loadStages);
    runStartupStep('load item style options', loadItemStyleOptions);
    runStartupStep('load item vendor options', loadItemVendorOptions);
    runStartupStep('load vendor series options', loadVendorSeriesOptions);
    runStartupStep('load fin type options', loadFinTypeOptions);
    runStartupStep('load window color options', loadWindowColorOptions);
    runStartupStep('load vendor catalog', loadVendorCatalog);
    runStartupStep('load window handing options', loadWindowHandingOptions);
    runStartupStep('load hardware lever/knob styles', loadHardwareLeverKnobStyleOptions);
    runStartupStep('load hardware product codes', loadHardwareProductCodeOptions);
    runStartupStep('load jamb size options', loadJambSizeOptions);
    runStartupStep('load contacts', loadContacts);
    runStartupStep('initialize notifications', initializeNotifications);
    runStartupStep('start reminder checking', startReminderChecking);
    
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

    [addDoorItemBtn, addDoorItemBottomBtn].filter(Boolean).forEach(button => {
        button.addEventListener('click', () => addLineItem('door'));
    });

    [addWindowItemBtn, addWindowItemBottomBtn].filter(Boolean).forEach(button => {
        button.addEventListener('click', () => addLineItem('window'));
    });

    [addHardwareItemBtn, addHardwareItemBottomBtn].filter(Boolean).forEach(button => {
        button.addEventListener('click', () => addLineItem('hardware'));
    });

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
            if (stageValue && STAGES.includes(stageValue)) {
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

        if (e.key === 'Escape' && orderModal && orderModal.style.display === 'block') {
            closeOrderModal();
            return;
        }

        const isSaveShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 's';
        if (isSaveShortcut) {
            e.preventDefault();
            flushActiveEditsBeforeSave();

            if (orderModal && orderModal.style.display === 'block') {
                saveOrder();
                return;
            }

            if (selectedOrderId) {
                saveInlineOrder();
            }
            return;
        }

        const isNextStageShortcut =
            (e.altKey && (e.key === '.' || e.key === 'ArrowRight')) ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'ArrowRight');
        const isPrevStageShortcut =
            (e.altKey && (e.key === ',' || e.key === 'ArrowLeft')) ||
            ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'ArrowLeft');

        if (!isNextStageShortcut && !isPrevStageShortcut) return;

        e.preventDefault();
        e.stopPropagation();

        if (!selectedOrderId) {
            showError('Select an order first');
            return;
        }

        moveSelectedOrderStage(isNextStageShortcut ? 1 : -1);
    }, true);

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

function commitActiveLineItemControl() {
    const active = document.activeElement;
    if (!active || !active.getAttribute) return;

    const indexAttr = active.getAttribute('data-item-index');
    const field = active.getAttribute('data-item-field');
    if (indexAttr === null || !field) return;

    const index = parseInt(indexAttr, 10);
    if (!Number.isFinite(index)) return;

    const value = field === 'quantity'
        ? parseInt(active.value || '1', 10)
        : (active.type === 'checkbox' ? active.checked : active.value);

    if (active.tagName === 'SELECT' && isAddNewLineItemOption(field, value)) return;

    updateLineItem(index, field, value, { suppressRender: true, autosave: false });
}

function commitAllLineItemControls() {
    if (!lineItemsList) return;

    lineItemsList.querySelectorAll('input[data-item-field], textarea[data-item-field], select[data-item-field]').forEach(control => {
        const indexAttr = control.getAttribute('data-item-index');
        const field = control.getAttribute('data-item-field');
        if (indexAttr === null || !field) return;

        const index = parseInt(indexAttr, 10);
        if (!Number.isFinite(index)) return;

        const value = field === 'quantity'
            ? parseInt(control.value || '1', 10)
            : (control.type === 'checkbox' ? control.checked : control.value);

        if (control.tagName === 'SELECT' && isAddNewLineItemOption(field, value)) return;

        updateLineItem(index, field, value, { suppressRender: true, autosave: false });
    });

    currentLineItems.forEach(item => {
        if (item && item.vendor && !sanitizeVendorSku(item.vendor_sku)) {
            item.vendor_sku = resolveVendorSkuForCtrlAltS(item);
        }
    });
    syncLineItemsToHiddenField();
}
const STAGE_BLANK_PRESERVE_FIELDS = new Set([
    'customer_name',
    'customer_phone',
    'customer_email',
    'customer_number',
    'project_name'
]);

function shouldPreserveInlineValueFromBlankStage(fieldName, stageValue) {
    if (!STAGE_BLANK_PRESERVE_FIELDS.has(fieldName)) return false;
    if (stageValue !== null && stageValue !== undefined && String(stageValue).trim() !== '') return false;

    const sourceInputId = INLINE_ORDER_FIELDS[fieldName];
    const sourceInput = sourceInputId ? document.getElementById(sourceInputId) : null;
    return Boolean(sourceInput && String(sourceInput.value || '').trim());
}
function getStageControlValue(control, fieldName) {
    if (!control) return '';
    if (control.type === 'checkbox') return Boolean(control.checked);
    const rawValue = fieldName === 'transfer_location'
        ? normalizeTransferLocation(control.value)
        : control.value;
    if (rawValue !== control.value && fieldName === 'transfer_location') {
        control.value = rawValue;
    }
    return rawValue;
}

function syncStageDetailControlToSource(control) {
    if (!control || !control.getAttribute) return;
    const fieldName = control.getAttribute('data-stage-source-field');
    if (!fieldName || Object.prototype.hasOwnProperty.call(STAGE_DONE_FIELDS, fieldName)) return;

    const value = getStageControlValue(control, fieldName);
    if (shouldPreserveInlineValueFromBlankStage(fieldName, value)) return;

    const sourceInputId = INLINE_ORDER_FIELDS[fieldName];
    if (sourceInputId) {
        const sourceInput = document.getElementById(sourceInputId);
        if (sourceInput) sourceInput.value = value;
    }
}

function commitActiveAdditionalQuoteControl() {
    const active = document.activeElement;
    if (!active || !active.id) return;

    const match = String(active.id).match(/^stage_additional_quote_(number|date|total)_(\d+)$/);
    if (!match) return;

    const fieldByKind = {
        number: 'quote_number',
        date: 'quote_date',
        total: 'quote_total'
    };
    const field = fieldByKind[match[1]];
    const index = parseInt(match[2], 10);
    if (!field || !Number.isFinite(index)) return;

    setAdditionalQuoteFieldValue(index, field, active.value);
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
}


function setAdditionalQuoteFieldValue(index, field, value) {
    if (!currentAdditionalQuotes[index]) return;
    currentAdditionalQuotes[index][field] = field === 'quote_date'
        ? toInputDate(value)
        : String(value || '').trim();
}

function setAdditionalInvoiceFieldValue(index, field, value) {
    if (!currentAdditionalInvoices[index]) return;
    currentAdditionalInvoices[index][field] = field === 'invoice_date'
        ? toInputDate(value)
        : String(value || '').trim();
}

function setAdditionalPurchaseOrderFieldValue(index, field, value) {
    if (!currentAdditionalPurchaseOrders[index]) return;
    if (field === 'po_date_signed' || field === 'eta_date') {
        currentAdditionalPurchaseOrders[index][field] = toInputDate(value);
    } else {
        currentAdditionalPurchaseOrders[index][field] = String(value || '').trim();
    }
}

function commitAllAdditionalTrackingControls() {
    if (!processTimeline) return;

    processTimeline.querySelectorAll('input[id^="stage_additional_quote_"]').forEach(input => {
        const match = String(input.id || '').match(/^stage_additional_quote_(number|date|total)_(\d+)$/);
        if (!match) return;
        const fieldByKind = { number: 'quote_number', date: 'quote_date', total: 'quote_total' };
        setAdditionalQuoteFieldValue(parseInt(match[2], 10), fieldByKind[match[1]], input.value);
    });
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');

    processTimeline.querySelectorAll('input[id^="stage_additional_invoice_"]').forEach(input => {
        const match = String(input.id || '').match(/^stage_additional_invoice_(number|date|total)_(\d+)$/);
        if (!match) return;
        const fieldByKind = { number: 'invoice_number', date: 'invoice_date', total: 'invoice_total' };
        setAdditionalInvoiceFieldValue(parseInt(match[2], 10), fieldByKind[match[1]], input.value);
    });
    syncAdditionalInvoicesToHiddenField();

    processTimeline.querySelectorAll('input[id^="stage_additional_po_"]').forEach(input => {
        const match = String(input.id || '').match(/^stage_additional_po_(po_numbers|po_date_signed|vendor_ack_number|vendor_ack_total|eta_date|vendor)_(\d+)$/);
        if (!match) return;
        setAdditionalPurchaseOrderFieldValue(parseInt(match[2], 10), match[1], input.value);
    });
    syncAdditionalPurchaseOrdersToHiddenField();
}


function removeBlankStageTrackingFields(payload) {
    if (!payload) return payload;
    [
        'quote_number', 'quote_date', 'quote_total',
        'quote_number_2', 'quote_date_2', 'quote_total_2',
        'invoice_number', 'invoice_date', 'invoice_total',
        'po_numbers', 'po_date_signed', 'vendor_ack_number', 'vendor_ack_total', 'eta_date'
    ].forEach(fieldName => {
        if (!Object.prototype.hasOwnProperty.call(payload, fieldName)) return;
        const value = payload[fieldName];
        if (value === null || value === undefined || String(value).trim() === '') {
            delete payload[fieldName];
        }
    });
    return payload;
}
function attachAdditionalTrackingPayload(payload) {
    if (!payload) return payload;

    const firstAdditional = currentAdditionalQuotes[0] || null;
    payload.additional_quotes = currentAdditionalQuotes.length > 0 ? JSON.stringify(currentAdditionalQuotes) : null;
    payload.additional_invoices = currentAdditionalInvoices.length > 0 ? JSON.stringify(currentAdditionalInvoices) : null;
    payload.additional_pos = currentAdditionalPurchaseOrders.length > 0 ? JSON.stringify(currentAdditionalPurchaseOrders) : null;
    payload.quote_number_2 = firstAdditional ? (firstAdditional.quote_number || null) : null;
    payload.quote_date_2 = firstAdditional ? (firstAdditional.quote_date || null) : null;
    payload.quote_total_2 = firstAdditional && firstAdditional.quote_total !== ''
        ? parseFloat(firstAdditional.quote_total)
        : null;
    return payload;
}
function commitActiveAdditionalInvoiceControl() {
    const active = document.activeElement;
    if (!active || !active.id) return;

    const match = String(active.id).match(/^stage_additional_invoice_(number|date|total)_(\d+)$/);
    if (!match) return;

    const fieldByKind = {
        number: 'invoice_number',
        date: 'invoice_date',
        total: 'invoice_total'
    };
    const field = fieldByKind[match[1]];
    const index = parseInt(match[2], 10);
    if (!field || !Number.isFinite(index)) return;

    setAdditionalInvoiceFieldValue(index, field, active.value);
    syncAdditionalInvoicesToHiddenField();
}

function commitActiveAdditionalPurchaseOrderControl() {
    const active = document.activeElement;
    if (!active || !active.id) return;

    const match = String(active.id).match(/^stage_additional_po_(po_numbers|po_date_signed|vendor_ack_number|vendor_ack_total|eta_date|vendor)_(\d+)$/);
    if (!match) return;

    const field = match[1];
    const index = parseInt(match[2], 10);
    if (!field || !Number.isFinite(index)) return;

    setAdditionalPurchaseOrderFieldValue(index, field, active.value);
    syncAdditionalPurchaseOrdersToHiddenField();
}
function commitAllStageDetailControls() {
    if (!processTimeline) return;
    processTimeline
        .querySelectorAll('[data-stage-source-field]')
        .forEach(syncStageDetailControlToSource);
}

function flushActiveEditsBeforeSave() {
    commitActiveAdditionalQuoteControl();
    commitActiveAdditionalInvoiceControl();
    commitActiveAdditionalPurchaseOrderControl();
    commitAllStageDetailControls();
    commitAllAdditionalTrackingControls();
    commitAllLineItemControls();
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

        let value = order[field] != null ? order[field] : '';
        if (field === 'po_numbers') {
            value = order.po_numbers != null ? order.po_numbers : (order.po_number != null ? order.po_number : '');
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
    ensureAdditionalQuoteRowsForOrderGroups(order);
    loadAdditionalInvoicesFromOrder(order);
    ensureAdditionalInvoiceRowsForOrderGroups(order);
    loadAdditionalPurchaseOrdersFromOrder(order);
    ensureAdditionalPurchaseOrderRowsForOrderGroups(order);
    syncSecondaryQuoteSection('inline', order);

    loadLineItemsFromOrder(order);
}

function toInputDate(value) {
    if (!value) return '';
    const text = String(value).trim();

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (slashMatch) {
        const year = slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3];
        const month = slashMatch[1].padStart(2, '0');
        const day = slashMatch[2].padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    return '';
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
    if (!loadingIndicator) return;
    loadingIndicator.style.display = show ? 'block' : 'none';
}

// Show error message
function showError(message) {
    if (!errorMessage || !errorText) return;
    errorText.textContent = message;
    errorMessage.style.display = 'block';
}

// Hide error message
function hideError() {
    if (!errorMessage) return;
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

function getSaveTimestampText() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function showSaveConfirmation(message) {
    showToast(message);

    const timestampText = getSaveTimestampText();
    const saveButtons = [
        document.getElementById('saveInlineOrderBtn'),
        document.getElementById('saveOrderBtn'),
    ].filter(Boolean);

    saveButtons.forEach(button => {
        const baseText = button.dataset.baseText || button.textContent.trim() || 'Save';
        if (!button.dataset.baseText) {
            button.dataset.baseText = baseText;
        }

        button.textContent = `${baseText} • Saved ${timestampText}`;
        button.title = `Last saved at ${timestampText}`;

        if (button._saveFeedbackTimeout) {
            clearTimeout(button._saveFeedbackTimeout);
        }

        button._saveFeedbackTimeout = setTimeout(() => {
            button.textContent = baseText;
        }, 6000);
    });
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


// Close modal when clicking outside
window.addEventListener('click', function(event) {
    if (event.target === confirmDialogModal) {
        closeThemedConfirm(false);
    }
});


