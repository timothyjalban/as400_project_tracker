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
const addHardwareItemBtn = document.getElementById('addHardwareItemBtn');
const addDoorItemBottomBtn = document.getElementById('addDoorItemBottomBtn');
const addWindowItemBottomBtn = document.getElementById('addWindowItemBottomBtn');
const addHardwareItemBottomBtn = document.getElementById('addHardwareItemBottomBtn');
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
    if (selectedOrder && selectedOrder.stage && STAGES.includes(selectedOrder.stage)) {
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














