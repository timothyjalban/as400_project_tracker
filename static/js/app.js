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
    const groupName = normalizeAs400AutomationGroupName(rawQuote.as400_group || rawQuote.group_name || '');
    const vendorName = String(rawQuote.vendor || '').trim();
    const colorName = String(rawQuote.group_color || '').trim();
    return {
        quote_number: String(rawQuote.quote_number || '').trim(),
        quote_date: toInputDate(rawQuote.quote_date),
        quote_total: rawQuote.quote_total === null || rawQuote.quote_total === undefined
            ? ''
            : String(rawQuote.quote_total).trim(),
        as400_group: groupName,
        vendor: vendorName,
        group_color: colorName,
    };
}

function getAs400ColorForAutomationGroup(groupName) {
    if (typeof getAs400GroupColor === 'function') {
        return getAs400GroupColor(groupName);
    }
    return '';
}

function getAutomationGroupNamesForOrder(order = null) {
    return Array.from(new Set(
        getLineItemsForAutomation(order || getSelectedOrder() || currentOrder || {})
            .map(item => getAutomationGroupNameForItem(item))
            .filter(Boolean)
    ));
}

function getAdditionalQuoteLabel(quote, index) {
    const groupName = normalizeAs400AutomationGroupName(quote?.as400_group || '');
    return groupName ? `${groupName} Quote` : `Additional Quote ${index + 1}`;
}

async function ensureAdditionalQuoteForAs400Group(orderId, groupName, lineItems = []) {
    const normalizedGroup = normalizeAs400AutomationGroupName(groupName);
    if (!orderId || !normalizedGroup) return null;

    const existingIndex = currentAdditionalQuotes.findIndex(quote => normalizeAs400AutomationGroupName(quote.as400_group) === normalizedGroup);
    if (existingIndex >= 0) return existingIndex;

    const vendor = String((lineItems || []).find(item => item.vendor)?.vendor || '').trim();
    currentAdditionalQuotes.push(normalizeAdditionalQuoteEntry({
        as400_group: normalizedGroup,
        vendor,
        group_color: getAs400ColorForAutomationGroup(normalizedGroup),
    }));
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', true);
    await persistAdditionalQuotesState(orderId);
    refreshQuoteCreatedStageDetails();
    return currentAdditionalQuotes.length - 1;
}
async function ensureAdditionalQuoteRowsForOrderGroups(order = null, options = {}) {
    if (!order || !order.id) return false;
    const groupNames = getAutomationGroupNamesForOrder(order);
    if (groupNames.length <= 1) return false;

    const primaryGroup = normalizeAs400AutomationGroupName(groupNames[0]);
    const additionalGroupNames = groupNames
        .map(normalizeAs400AutomationGroupName)
        .filter(groupName => groupName && groupName !== primaryGroup);
    const items = getLineItemsForAutomation(order);
    let changed = false;

    const beforeCount = currentAdditionalQuotes.length;
    currentAdditionalQuotes = currentAdditionalQuotes.filter(quote => {
        const quoteGroup = normalizeAs400AutomationGroupName(quote.as400_group);
        const hasQuoteData = Boolean(quote.quote_number || quote.quote_date || quote.quote_total);
        return quoteGroup !== primaryGroup || hasQuoteData;
    });
    if (currentAdditionalQuotes.length !== beforeCount) changed = true;

    additionalGroupNames.forEach(groupName => {
        const exists = currentAdditionalQuotes.some(quote => normalizeAs400AutomationGroupName(quote.as400_group) === groupName);
        if (exists) return;
        const groupItems = items.filter(item => getAutomationGroupNameForItem(item) === groupName);
        currentAdditionalQuotes.push(normalizeAdditionalQuoteEntry({
            as400_group: groupName,
            vendor: String(groupItems.find(item => item.vendor)?.vendor || '').trim(),
            group_color: getAs400ColorForAutomationGroup(groupName),
        }));
        changed = true;
    });

    if (!changed) return false;
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    setSecondaryQuoteVisibility('inline', currentAdditionalQuotes.length > 0);
    refreshQuoteCreatedStageDetails();
    if (options.persist !== false) {
        await persistAdditionalQuotesState(order.id);
    }
    return true;
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
function normalizeAdditionalInvoiceEntry(rawInvoice = {}) {
    const groupName = normalizeAs400AutomationGroupName(rawInvoice.as400_group || rawInvoice.group_name || '');
    return {
        invoice_number: String(rawInvoice.invoice_number || '').trim(),
        invoice_date: toInputDate(rawInvoice.invoice_date),
        invoice_total: rawInvoice.invoice_total === null || rawInvoice.invoice_total === undefined
            ? ''
            : String(rawInvoice.invoice_total).trim(),
        as400_group: groupName,
        vendor: String(rawInvoice.vendor || '').trim(),
        group_color: String(rawInvoice.group_color || '').trim(),
    };
}

function parseAdditionalInvoicesFromOrder(order) {
    let parsed = [];
    try {
        if (Array.isArray(order?.additional_invoices)) {
            parsed = order.additional_invoices;
        } else if (order?.additional_invoices) {
            parsed = JSON.parse(order.additional_invoices);
        }
    } catch (error) {
        console.warn('Unable to parse additional_invoices for order', order?.id, error);
        parsed = [];
    }
    return Array.isArray(parsed) ? parsed.map(normalizeAdditionalInvoiceEntry) : [];
}

function syncAdditionalInvoicesToHiddenField() {
    const hiddenField = document.getElementById(INLINE_ORDER_FIELDS.additional_invoices);
    if (!hiddenField) return;
    hiddenField.value = currentAdditionalInvoices.length > 0
        ? JSON.stringify(currentAdditionalInvoices)
        : '';
}

function getAdditionalInvoiceLabel(invoice, index) {
    const groupName = normalizeAs400AutomationGroupName(invoice?.as400_group || '');
    return groupName ? `${groupName} Invoice` : `Additional Invoice ${index + 1}`;
}

function loadAdditionalInvoicesFromOrder(order) {
    currentAdditionalInvoices = parseAdditionalInvoicesFromOrder(order);
    syncAdditionalInvoicesToHiddenField();
}

async function persistAdditionalInvoicesState(orderId = selectedOrderId) {
    if (!orderId) return null;
    const payload = {
        additional_invoices: currentAdditionalInvoices.length > 0 ? JSON.stringify(currentAdditionalInvoices) : null,
    };

    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to save additional invoice');
            return null;
        }
        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) currentOrder = result.order;
        const selected = getSelectedOrder();
        if (selected && selected.id === result.order.id) Object.assign(selected, result.order);
        hideError();
        return result.order;
    } catch (error) {
        console.error('Error saving additional invoice:', error);
        showError('Failed to save additional invoice');
        return null;
    }
}

async function addAdditionalInvoice() {
    currentAdditionalInvoices.push(normalizeAdditionalInvoiceEntry());
    syncAdditionalInvoicesToHiddenField();
    await persistAdditionalInvoicesState();
    renderSalesProcess(getSelectedOrder());
}

async function removeAdditionalInvoice(index) {
    if (index < 0 || index >= currentAdditionalInvoices.length) return;
    currentAdditionalInvoices.splice(index, 1);
    syncAdditionalInvoicesToHiddenField();
    await persistAdditionalInvoicesState();
    renderSalesProcess(getSelectedOrder());
}

function updateAdditionalInvoiceField(index, field, value) {
    if (!currentAdditionalInvoices[index]) return;
    currentAdditionalInvoices[index][field] = field === 'invoice_date'
        ? toInputDate(value)
        : String(value || '').trim();
    syncAdditionalInvoicesToHiddenField();
    persistAdditionalInvoicesState();
}

async function ensureAdditionalInvoiceRowsForOrderGroups(order = null, options = {}) {
    if (!order || !order.id) return false;
    const groupNames = getAutomationGroupNamesForOrder(order).map(normalizeAs400AutomationGroupName).filter(Boolean);
    if (groupNames.length <= 1) return false;

    const primaryGroup = groupNames[0];
    const additionalGroupNames = groupNames.filter(groupName => groupName && groupName !== primaryGroup);
    const items = getLineItemsForAutomation(order);
    let changed = false;

    const beforeCount = currentAdditionalInvoices.length;
    currentAdditionalInvoices = currentAdditionalInvoices.filter(invoice => {
        const invoiceGroup = normalizeAs400AutomationGroupName(invoice.as400_group);
        const hasInvoiceData = Boolean(invoice.invoice_number || invoice.invoice_date || invoice.invoice_total);
        return invoiceGroup !== primaryGroup || hasInvoiceData;
    });
    if (currentAdditionalInvoices.length !== beforeCount) changed = true;

    additionalGroupNames.forEach(groupName => {
        const exists = currentAdditionalInvoices.some(invoice => normalizeAs400AutomationGroupName(invoice.as400_group) === groupName);
        if (exists) return;
        const groupItems = items.filter(item => getAutomationGroupNameForItem(item) === groupName);
        currentAdditionalInvoices.push(normalizeAdditionalInvoiceEntry({
            as400_group: groupName,
            vendor: String(groupItems.find(item => item.vendor)?.vendor || '').trim(),
            group_color: getAs400ColorForAutomationGroup(groupName),
        }));
        changed = true;
    });

    if (!changed) return false;
    syncAdditionalInvoicesToHiddenField();
    if (options.persist !== false) await persistAdditionalInvoicesState(order.id);
    return true;
}

async function ensureAdditionalInvoiceForAs400Group(orderId, groupName, lineItems = []) {
    const normalizedGroup = normalizeAs400AutomationGroupName(groupName);
    if (!orderId || !normalizedGroup) return null;
    const existingIndex = currentAdditionalInvoices.findIndex(invoice => normalizeAs400AutomationGroupName(invoice.as400_group) === normalizedGroup);
    if (existingIndex >= 0) return existingIndex;
    currentAdditionalInvoices.push(normalizeAdditionalInvoiceEntry({
        as400_group: normalizedGroup,
        vendor: String((lineItems || []).find(item => item.vendor)?.vendor || '').trim(),
        group_color: getAs400ColorForAutomationGroup(normalizedGroup),
    }));
    syncAdditionalInvoicesToHiddenField();
    await persistAdditionalInvoicesState(orderId);
    renderSalesProcess(getSelectedOrder());
    return currentAdditionalInvoices.length - 1;
}
const ADDITIONAL_PO_DONE_FIELD_MAP = {
    po_done: 'po_done_at',
    order_placed_done: 'order_placed_done_at',
    ack_received_done: 'ack_received_done_at',
    eta_confirmed_done: 'eta_confirmed_done_at',
    ship_ticket_done: 'ship_ticket_done_at',
    will_call_done: 'will_call_done_at',
    picked_up_done: 'picked_up_done_at',
    closed_done: 'closed_done_at',
};

function normalizeAdditionalPurchaseOrderEntry(rawEntry = {}) {
    const groupName = normalizeAs400AutomationGroupName(rawEntry.as400_group || rawEntry.group_name || '');
    return {
        po_numbers: String(rawEntry.po_numbers || rawEntry.po_number || '').trim(),
        po_date_signed: toInputDate(rawEntry.po_date_signed),
        vendor: String(rawEntry.vendor || '').trim(),
        vendor_ack_number: String(rawEntry.vendor_ack_number || '').trim(),
        vendor_ack_total: rawEntry.vendor_ack_total === null || rawEntry.vendor_ack_total === undefined ? '' : String(rawEntry.vendor_ack_total).trim(),
        eta_date: toInputDate(rawEntry.eta_date),
        as400_group: groupName,
        group_color: String(rawEntry.group_color || '').trim(),
        po_done_at: rawEntry.po_done_at || null,
        order_placed_done_at: rawEntry.order_placed_done_at || null,
        ack_received_done_at: rawEntry.ack_received_done_at || null,
        eta_confirmed_done_at: rawEntry.eta_confirmed_done_at || null,
        ship_ticket_done_at: rawEntry.ship_ticket_done_at || null,
        will_call_done_at: rawEntry.will_call_done_at || null,
        picked_up_done_at: rawEntry.picked_up_done_at || null,
        closed_done_at: rawEntry.closed_done_at || null,
    };
}

function parseAdditionalPurchaseOrdersFromOrder(order) {
    let parsed = [];
    try {
        if (Array.isArray(order?.additional_pos)) parsed = order.additional_pos;
        else if (order?.additional_pos) parsed = JSON.parse(order.additional_pos);
    } catch (error) {
        console.warn('Unable to parse additional_pos for order', order?.id, error);
        parsed = [];
    }
    return Array.isArray(parsed) ? parsed.map(normalizeAdditionalPurchaseOrderEntry) : [];
}

function syncAdditionalPurchaseOrdersToHiddenField() {
    const hiddenField = document.getElementById(INLINE_ORDER_FIELDS.additional_pos);
    if (!hiddenField) return;
    hiddenField.value = currentAdditionalPurchaseOrders.length > 0 ? JSON.stringify(currentAdditionalPurchaseOrders) : '';
}

function loadAdditionalPurchaseOrdersFromOrder(order) {
    currentAdditionalPurchaseOrders = parseAdditionalPurchaseOrdersFromOrder(order);
    syncAdditionalPurchaseOrdersToHiddenField();
}

async function persistAdditionalPurchaseOrdersState(orderId = selectedOrderId) {
    if (!orderId) return null;
    const payload = { additional_pos: currentAdditionalPurchaseOrders.length > 0 ? JSON.stringify(currentAdditionalPurchaseOrders) : null };
    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to save additional PO tracking');
            return null;
        }
        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) currentOrder = result.order;
        const selected = getSelectedOrder();
        if (selected && selected.id === result.order.id) Object.assign(selected, result.order);
        return result.order;
    } catch (error) {
        console.error('Error saving additional PO tracking:', error);
        showError('Failed to save additional PO tracking');
        return null;
    }
}

function updateAdditionalPurchaseOrderField(index, field, value) {
    if (!currentAdditionalPurchaseOrders[index]) return;
    if (field === 'po_date_signed' || field === 'eta_date') {
        currentAdditionalPurchaseOrders[index][field] = toInputDate(value);
    } else if (field === 'vendor_ack_total') {
        currentAdditionalPurchaseOrders[index][field] = String(value || '').trim();
    } else {
        currentAdditionalPurchaseOrders[index][field] = String(value || '').trim();
    }
    syncAdditionalPurchaseOrdersToHiddenField();
    persistAdditionalPurchaseOrdersState();
}

function updateAdditionalPurchaseOrderDone(index, doneField, checked) {
    const timestampField = ADDITIONAL_PO_DONE_FIELD_MAP[doneField];
    if (!timestampField || !currentAdditionalPurchaseOrders[index]) return;
    currentAdditionalPurchaseOrders[index][timestampField] = checked ? (currentAdditionalPurchaseOrders[index][timestampField] || new Date().toISOString()) : null;
    syncAdditionalPurchaseOrdersToHiddenField();
    persistAdditionalPurchaseOrdersState();
    renderSalesProcess(getSelectedOrder());
}

async function ensureAdditionalPurchaseOrderRowsForOrderGroups(order = null, options = {}) {
    if (!order || !order.id) return false;
    const groupNames = getAutomationGroupNamesForOrder(order).map(normalizeAs400AutomationGroupName).filter(Boolean);
    if (groupNames.length <= 1) return false;
    const primaryGroup = groupNames[0];
    const additionalGroupNames = groupNames.filter(groupName => groupName && groupName !== primaryGroup);
    const items = getLineItemsForAutomation(order);
    let changed = false;

    const beforeCount = currentAdditionalPurchaseOrders.length;
    currentAdditionalPurchaseOrders = currentAdditionalPurchaseOrders.filter(entry => {
        const entryGroup = normalizeAs400AutomationGroupName(entry.as400_group);
        const hasData = Boolean(entry.po_numbers || entry.po_date_signed || entry.vendor_ack_number || entry.vendor_ack_total || entry.eta_date || Object.values(ADDITIONAL_PO_DONE_FIELD_MAP).some(doneField => entry[doneField]));
        return entryGroup !== primaryGroup || hasData;
    });
    if (currentAdditionalPurchaseOrders.length !== beforeCount) changed = true;

    additionalGroupNames.forEach(groupName => {
        const exists = currentAdditionalPurchaseOrders.some(entry => normalizeAs400AutomationGroupName(entry.as400_group) === groupName);
        if (exists) return;
        const groupItems = items.filter(item => getAutomationGroupNameForItem(item) === groupName);
        currentAdditionalPurchaseOrders.push(normalizeAdditionalPurchaseOrderEntry({
            as400_group: groupName,
            vendor: String(groupItems.find(item => item.vendor)?.vendor || '').trim(),
            group_color: getAs400ColorForAutomationGroup(groupName),
        }));
        changed = true;
    });

    if (!changed) return false;
    syncAdditionalPurchaseOrdersToHiddenField();
    if (options.persist !== false) await persistAdditionalPurchaseOrdersState(order.id);
    return true;
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
    setAdditionalQuoteFieldValue(index, field, value);
    syncAdditionalQuotesToHiddenField();
    syncLegacySecondaryQuoteFieldsFromAdditional('inline');
    persistAdditionalQuotesState();
}

async function persistAdditionalQuotesState(orderId = selectedOrderId) {
    if (!orderId) return null;

    const first = currentAdditionalQuotes[0] || null;
    const payload = {
        additional_quotes: currentAdditionalQuotes.length > 0 ? JSON.stringify(currentAdditionalQuotes) : null,
        quote_number_2: first ? (first.quote_number || null) : null,
        quote_date_2: first ? (first.quote_date || null) : null,
        quote_total_2: first && first.quote_total !== '' ? parseFloat(first.quote_total) : null,
    };

    try {
        const response = await fetch(`${API_BASE}/orders/${orderId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!result.success || !result.order) {
            showError(result.error || 'Failed to save additional quote');
            return null;
        }

        allOrders = allOrders.map(item => item.id === result.order.id ? result.order : item);
        if (currentOrder && currentOrder.id === result.order.id) {
            currentOrder = result.order;
        }
        const selected = getSelectedOrder();
        if (selected && selected.id === result.order.id) {
            Object.assign(selected, result.order);
        }
        hideError();
        return result.order;
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

function applyRequiredCustomerFallbacks(data, selectedOrder) {
    if (!data || !selectedOrder) return data;

    ['customer_name', 'customer_phone', 'project_name', 'stage'].forEach(field => {
        const currentValue = data[field];
        const existingValue = selectedOrder[field];
        if ((currentValue === null || currentValue === undefined || String(currentValue).trim() === '') && existingValue != null && String(existingValue).trim() !== '') {
            data[field] = existingValue;
        }
    });

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

    Object.entries(INLINE_ORDER_FIELDS).forEach(([field, elementId]) => {
        const element = document.getElementById(elementId);
        if (!element) return;

        const value = element.value.trim();
        const existingValue = field === 'po_numbers'
            ? (selectedOrder?.po_numbers ?? selectedOrder?.po_number ?? null)
            : (selectedOrder ? selectedOrder[field] : null);

        data[field] = value === '' && existingValue != null && String(existingValue).trim() !== ''
            ? existingValue
            : (value === '' ? null : value);
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

    // Inline form is hidden; never let a stale hidden select reset stage.
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
        const result = await callDesktopHelper(endpoint, {
            method: 'POST',
            payload,
        });

        if (result.unauthorized) {
            return;
        }

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


// Close modal when clicking outside
window.addEventListener('click', function(event) {
    if (event.target === confirmDialogModal) {
        closeThemedConfirm(false);
    }
});

// ===== OCR / Bulk Import Functions =====

const ocrModal = document.getElementById('ocrModal');
const ocrImportBtn = document.getElementById('ocrImportBtn');
let pendingOCROrders = [];
let pendingOCRImportMode = 'bulk';
let pendingProcessImportOrderId = null;
let pendingProcessImportFile = null;

function parseOCRLineItems(lineItemsRaw) {
    if (Array.isArray(lineItemsRaw)) {
        return lineItemsRaw.filter(item => item && typeof item === 'object');
    }

    if (typeof lineItemsRaw === 'string' && lineItemsRaw.trim()) {
        try {
            const parsed = JSON.parse(lineItemsRaw);
            return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object') : [];
        } catch (err) {
            return [];
        }
    }

    return [];
}

function formatOCRItemValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value).replace(/\s+/g, ' ').trim();
}

function appendOCRLineItemSummary(lines, items) {
    lines.push(`line_items_count: ${items.length}`);

    if (items.length === 0) {
        return;
    }

    lines.push('line_items:');
    const fields = [
        ['product', 'product'],
        ['type', 'type'],
        ['quantity', 'quantity'],
        ['vendor', 'vendor'],
        ['price', 'price'],
        ['size', 'size'],
        ['width', 'width'],
        ['height', 'height'],
        ['series', 'series'],
        ['model', 'model'],
        ['style', 'style'],
        ['operation', 'operation'],
        ['swing', 'swing'],
        ['handing', 'handing'],
        ['jamb_size', 'jamb_size'],
        ['thickness', 'thickness'],
        ['material', 'material'],
        ['color', 'color'],
        ['glass', 'glass'],
        ['hardware', 'hardware'],
        ['boring', 'boring'],
        ['room', 'room'],
        ['location', 'location'],
        ['special_notes', 'special_notes'],
        ['notes', 'notes'],
    ];

    items.forEach((item, itemIndex) => {
        lines.push(`  Item ${itemIndex + 1}`);
        fields.forEach(([label, key]) => {
            const value = formatOCRItemValue(item[key]);
            if (value) {
                lines.push(`    ${label}: ${value}`);
            }
        });
    });
}

function buildOCRKeyFieldsText(orders) {
    if (!Array.isArray(orders) || orders.length === 0) {
        return 'No parsed orders available to summarize key fields.';
    }

    const lines = [];
    orders.forEach((order, index) => {
        const ord = order || {};
        const lineItems = parseOCRLineItems(ord.line_items);

        lines.push(`Order ${index + 1}`);
        lines.push(`customer_name: ${ord.customer_name || ''}`);
        lines.push(`customer_phone: ${ord.customer_phone || ''}`);
        lines.push(`customer_email: ${ord.customer_email || ''}`);
        lines.push(`project_name: ${ord.project_name || ''}`);
        lines.push(`stage: ${ord.stage || ''}`);
        lines.push(`quote_number: ${ord.quote_number || ''}`);
        lines.push(`quote_date: ${ord.quote_date || ''}`);
        lines.push(`quote_total: ${ord.quote_total ?? ''}`);
        lines.push(`invoice_number: ${ord.invoice_number || ''}`);
        lines.push(`invoice_date: ${ord.invoice_date || ''}`);
        lines.push(`invoice_total: ${ord.invoice_total ?? ''}`);
        lines.push(`po_numbers: ${ord.po_numbers || ord.po_number || ''}`);
        lines.push(`po_date_signed: ${ord.po_date_signed || ''}`);
        lines.push(`vendor: ${ord.vendor || ''}`);
        appendOCRLineItemSummary(lines, lineItems);
        lines.push(`notes: ${ord.notes || ''}`);
        lines.push('');
    });

    return lines.join('\n').trim();
}

function resetOCRPreview() {
    pendingOCROrders = [];
    const panel = document.getElementById('ocrPreviewPanel');
    const summary = document.getElementById('ocrPreviewSummary');
    const rawText = document.getElementById('ocrRawExtract');
    const parsedText = document.getElementById('ocrParsedExtract');
    const keyFieldsText = document.getElementById('ocrKeyFieldsExtract');
    const importBtn = document.getElementById('ocrImportParsedBtn');

    if (panel) panel.style.display = 'none';
    if (summary) summary.textContent = '';
    if (rawText) rawText.value = '';
    if (parsedText) parsedText.value = '';
    if (keyFieldsText) keyFieldsText.value = '';
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.textContent = pendingOCRImportMode === 'process-order' ? 'Apply To This Order' : 'Import Parsed Orders';
    }
}

function showOCRExtractionPreview(result) {
    const panel = document.getElementById('ocrPreviewPanel');
    const summary = document.getElementById('ocrPreviewSummary');
    const rawText = document.getElementById('ocrRawExtract');
    const parsedText = document.getElementById('ocrParsedExtract');
    const keyFieldsText = document.getElementById('ocrKeyFieldsExtract');
    const importBtn = document.getElementById('ocrImportParsedBtn');

    if (!panel || !summary || !rawText || !parsedText || !keyFieldsText || !importBtn) {
        return;
    }

    const orders = result?.data?.orders;
    pendingOCROrders = Array.isArray(orders) ? orders : [];

    rawText.value = String(result?.raw_text || '').trim();
    parsedText.value = pendingOCROrders.length > 0
        ? JSON.stringify(pendingOCROrders, null, 2)
        : '';
    keyFieldsText.value = buildOCRKeyFieldsText(pendingOCROrders);

    summary.textContent = pendingOCROrders.length > 0
        ? `Found ${pendingOCROrders.length} parsed order(s)`
        : 'No parsed orders found (raw OCR text available)';

    importBtn.disabled = pendingOCROrders.length === 0;
    importBtn.textContent = pendingOCRImportMode === 'process-order' ? 'Apply To This Order' : 'Import Parsed Orders';
    panel.style.display = 'block';
}

async function copyOCRPreviewText(kind) {
    const sourceId = kind === 'parsed'
        ? 'ocrParsedExtract'
        : (kind === 'key-fields' ? 'ocrKeyFieldsExtract' : 'ocrRawExtract');
    const input = document.getElementById(sourceId);
    if (!input) return;

    const text = String(input.value || '');
    if (!text.trim()) {
        showError('Nothing to copy for that section yet.');
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        if (kind === 'parsed') {
            showToast('Copied parsed JSON');
        } else if (kind === 'key-fields') {
            showToast('Copied key fields');
        } else {
            showToast('Copied raw OCR text');
        }
    } catch (err) {
        input.focus();
        input.select();
        showError('Clipboard copy failed. Selected text so you can copy manually.');
    }
}

async function applyPreviewedOCRToExistingOrder() {
    const orderData = pendingOCROrders.find(order => order && typeof order === 'object');
    const targetOrderId = pendingProcessImportOrderId || selectedOrderId;

    if (!orderData || !targetOrderId) {
        showError('No parsed order data is ready to apply.');
        return;
    }

    const activeOrder = allOrders.find(order => order.id === targetOrderId) || currentOrder || getSelectedOrder();
    if (activeOrder) {
        selectedOrderId = targetOrderId;
        currentOrder = activeOrder;
        populateInlineOrderForm(activeOrder);
    }

    const itemCount = applyImportedOrderToCurrentForm(orderData);
    const payload = collectInlineOrderFormData();
    if (orderData.stage) {
        payload.stage = orderData.stage;
    }

    const response = await fetch(`${API_BASE}/orders/${targetOrderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const saveResult = await response.json();

    if (!saveResult.success || !saveResult.order) {
        throw new Error(saveResult.error || 'Parsed the file, but failed to update the order');
    }

    allOrders = allOrders.map(order => order.id === saveResult.order.id ? saveResult.order : order);
    currentOrder = saveResult.order;
    selectedOrderId = saveResult.order.id;
    populateInlineOrderForm(saveResult.order);
    renderSalesProcess(saveResult.order);
    hideError();

    if (pendingProcessImportFile && typeof uploadFile === 'function') {
        await uploadFile(pendingProcessImportFile, saveResult.order.id);
    }

    await loadOrders();
    closeOCRModal();
    showToast(`Imported ${itemCount} line item${itemCount === 1 ? '' : 's'} into this order`);
}

async function importPreviewedOCROrders() {
    if (!Array.isArray(pendingOCROrders) || pendingOCROrders.length === 0) {
        showError('No parsed orders to import.');
        return;
    }

    const importBtn = document.getElementById('ocrImportParsedBtn');
    const originalText = pendingOCRImportMode === 'process-order' ? 'Apply To This Order' : 'Import Parsed Orders';
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.textContent = pendingOCRImportMode === 'process-order' ? 'Applying...' : 'Importing...';
    }

    if (pendingOCRImportMode === 'process-order') {
        try {
            await applyPreviewedOCRToExistingOrder();
        } catch (error) {
            console.error('Error applying previewed order import:', error);
            showError(`Order import failed: ${error.message}`);
            if (importBtn) {
                importBtn.textContent = originalText;
                importBtn.disabled = false;
            }
        }
        return;
    }

    let imported = 0;
    let failed = 0;

    for (const orderData of pendingOCROrders) {
        try {
            const importResponse = await fetch(`${API_BASE}/orders`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(orderData)
            });

            const importResult = await importResponse.json();
            if (importResult.success) {
                imported++;
            } else {
                failed++;
                console.error('Failed to import order:', importResult.error);
            }
        } catch (err) {
            failed++;
            console.error('Error importing order:', err);
        }
    }

    if (importBtn) {
        importBtn.textContent = 'Import Parsed Orders';
        importBtn.disabled = false;
    }

    closeOCRModal();
    loadOrders();

    let message = `Import complete!\n\nImported: ${imported}`;
    if (failed > 0) {
        message += `\nFailed: ${failed}`;
    }
    alert(message);
}
// Initialize OCR button listener
if (ocrImportBtn) {
    ocrImportBtn.addEventListener('click', () => {
        openOCRModal();
    });
}

function setOCRModalModeText(mode) {
    const title = document.getElementById('ocrModalTitle');
    const intro = document.getElementById('ocrModalIntro');
    if (mode === 'process-order') {
        if (title) title.textContent = 'Import Quote Into Order';
        if (intro) intro.textContent = 'Review the raw text, parsed JSON, and key fields before applying this quote to the selected order.';
        return;
    }

    if (title) title.textContent = 'Bulk Import';
    if (intro) intro.textContent = 'Upload a JSON bulk import file to import multiple orders at once. Duplicate detection automatically prevents re-importing existing orders.';
}
function openOCRModal() {
    pendingOCRImportMode = 'bulk';
    pendingProcessImportOrderId = null;
    pendingProcessImportFile = null;
    setOCRModalModeText('bulk');
    resetOCRPreview();
    ocrModal.style.display = 'block';
}

function closeOCRModal() {
    ocrModal.style.display = 'none';
    resetOCRPreview();
    pendingOCRImportMode = 'bulk';
    pendingProcessImportOrderId = null;
    pendingProcessImportFile = null;
    // Reset file input
    document.getElementById('ocrFileInput').value = '';
    document.getElementById('ocrFileName').textContent = '';
    document.getElementById('ocrProgress').style.display = 'none';
}

function openProcessQuoteImportPicker() {
    const activeOrder = getActiveOrderContext();
    if (!activeOrder || !activeOrder.id) {
        showError('Select an order first');
        return;
    }

    currentOrder = activeOrder;
    const input = document.getElementById('processQuoteImportInput');
    if (input) input.click();
}

function getFirstParsedImportOrder(result) {
    const orders = result?.data?.orders;
    if (Array.isArray(orders) && orders.length > 0) {
        return orders.find(order => order && typeof order === 'object') || null;
    }
    return null;
}

async function parseOrderImportFile(file) {
    const lowerName = String(file?.name || '').toLowerCase();
    const formData = new FormData();
    formData.append('file', file);

    const endpoint = (lowerName.endsWith('.json') || lowerName.endsWith('.csv'))
        ? `${API_BASE}/import/parse-file`
        : `${API_BASE}/ocr/process-file`;

    const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
    });
    const result = await response.json();

    if (!result.success) {
        throw new Error(result.error || 'File import failed');
    }

    return {
        result,
        parsedOrder: getFirstParsedImportOrder(result)
    };
}

function applyImportedOrderToCurrentForm(importedOrder) {
    const imported = importedOrder || {};
    const selectedOrder = getSelectedOrder() || currentOrder || {};

    const fieldNames = [
        'customer_name',
        'customer_phone',
        'customer_email',
        'project_name',
        'quote_number',
        'quote_date',
        'quote_total',
        'invoice_number',
        'invoice_date',
        'invoice_total',
        'po_numbers',
        'po_date_signed',
        'vendor',
        'product_type',
        'vendor_ack_number',
        'vendor_ack_total',
        'eta_date'
    ];

    fieldNames.forEach(field => {
        const elementId = INLINE_ORDER_FIELDS[field];
        const element = elementId ? document.getElementById(elementId) : null;
        if (!element) return;

        let value = imported[field];
        if ((value === null || value === undefined || String(value).trim() === '') && field === 'po_numbers') {
            value = imported.po_number;
        }
        if (value === null || value === undefined || String(value).trim() === '') return;

        const displayValue = field.endsWith('_date') ? toInputDate(value) : String(value).trim();
        element.value = displayValue;

        const stageInput = processTimeline
            ? processTimeline.querySelector(`[data-stage-source-field="${field}"]`)
            : null;
        if (stageInput) stageInput.value = displayValue;
    });

    const importedItems = parseOCRLineItems(imported.line_items);
    if (importedItems.length > 0) {
        const normalizedItems = typeof normalizeLineItem === 'function'
            ? importedItems.map(item => normalizeLineItem(item))
            : importedItems;
        currentLineItems = currentLineItems.length > 0
            ? [...currentLineItems, ...normalizedItems]
            : normalizedItems;
        if (typeof enforceSinglePrefitDoor === 'function') enforceSinglePrefitDoor();
        if (typeof renderLineItemsEditor === 'function') renderLineItemsEditor();
        if (typeof syncDoorSwingSelectElements === 'function') syncDoorSwingSelectElements();
        if (typeof syncLineItemsToHiddenField === 'function') syncLineItemsToHiddenField();
    }

    if (imported.stage && selectedOrder && selectedOrder.stage !== imported.stage) {
        selectedOrder.stage = imported.stage;
    }

    return importedItems.length;
}

async function handleProcessQuoteImportFile(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const activeOrder = getActiveOrderContext();
    if (!activeOrder || !activeOrder.id) {
        showError('Select an order first');
        event.target.value = '';
        return;
    }

    flushActiveEditsBeforeSave();
    currentOrder = activeOrder;
    pendingOCRImportMode = 'process-order';
    pendingProcessImportOrderId = activeOrder.id;
    pendingProcessImportFile = file;
    resetOCRPreview();

    if (ocrModal) {
        ocrModal.style.display = 'block';
    }
    const fileName = document.getElementById('ocrFileName');
    const progress = document.getElementById('ocrProgress');
    const progressBar = document.getElementById('ocrProgressBar');
    if (fileName) fileName.textContent = `Selected: ${file.name}`;
    if (progress) progress.style.display = 'block';
    if (progressBar) progressBar.style.width = '35%';
    showToast(`Reading ${file.name}...`);

    try {
        const { result, parsedOrder } = await parseOrderImportFile(file);
        if (progressBar) progressBar.style.width = '100%';
        showOCRExtractionPreview(result);
        if (progress) progress.style.display = 'none';

        if (parsedOrder) {
            const itemCount = parseOCRLineItems(parsedOrder.line_items).length;
            showToast(`Preview ready: ${itemCount} line item${itemCount === 1 ? '' : 's'} found`);
        } else {
            showToast('Raw text extracted. Parsed fields were incomplete.');
        }
    } catch (error) {
        console.error('Order file import preview error:', error);
        showError(`Order import preview failed: ${error.message}`);
        if (progress) progress.style.display = 'none';
    } finally {
        event.target.value = '';
    }
}async function handleOCRFile(event) {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    const file = selectedFiles[0];
    resetOCRPreview();
    
    // Show filename
    document.getElementById('ocrFileName').textContent = selectedFiles.length > 1
        ? `Selected: ${selectedFiles.length} files`
        : `Selected: ${file.name}`;
    document.getElementById('ocrProgress').style.display = 'block';
    
    const progressBar = document.getElementById('ocrProgressBar');
    progressBar.style.width = '0%';
    
    // Check file type - JSON/CSV files get bulk imported
    const lowerName = file.name.toLowerCase();
    const hasMultiple = selectedFiles.length > 1;
    const allFormFiles = selectedFiles.every(entry => {
        const name = String(entry?.name || '').toLowerCase();
        return name.endsWith('.json') || name.endsWith('.csv');
    });

    if (hasMultiple && !allFormFiles) {
        showError('Batch import supports only .json and .csv files');
        document.getElementById('ocrProgress').style.display = 'none';
        return;
    }

    if ((lowerName.endsWith('.json') || lowerName.endsWith('.csv')) || allFormFiles) {
        try {
            // Show progress
            progressBar.style.width = '30%';
            
            // Upload and import
            const formData = new FormData();
            if (hasMultiple) {
                selectedFiles.forEach(entry => formData.append('files', entry));
            } else {
                formData.append('file', file);
            }
            
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
                    showToast(result.message || 'Import complete');
                    closeOCRModal();
                    loadOrders(); // Refresh table
                } else if (result.mode === 'batch') {
                    const summary = result.message || `Batch import finished: ${result.imported_count || 0} imported, ${result.duplicate_count || 0} duplicates, ${result.failed_count || 0} failed`;
                    alert(`📥 Batch Import\n\n${summary}`);
                    closeOCRModal();
                    loadOrders();
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
            showError('Failed to import form file');
            document.getElementById('ocrProgress').style.display = 'none';
        }
    } else if (lowerName.endsWith('.pdf') || (file.type && file.type.startsWith('image/'))) {
        // Process PDF/image with OCR
        try {
            progressBar.style.width = '30%';

            const formData = new FormData();
            formData.append('file', file);

            progressBar.style.width = '50%';

            const response = await fetch(`${API_BASE}/ocr/process-file`, {
                method: 'POST',
                body: formData
            });

            progressBar.style.width = '80%';

            const result = await response.json();

            console.log('OCR Response:', result);  // DEBUG

            progressBar.style.width = '100%';

            if (result.success && result.parsed && result.data && result.data.orders) {
                setTimeout(() => {
                    showOCRExtractionPreview(result);
                    showToast(`File processed! Found ${result.data.orders.length} parsed order(s). Review and import when ready.`);
                    document.getElementById('ocrProgress').style.display = 'none';
                }, 300);

            } else if (result.success && result.raw_text) {
                setTimeout(() => {
                    showOCRExtractionPreview(result);
                    document.getElementById('ocrProgress').style.display = 'none';
                    showToast('OCR text extracted. Parsed fields were incomplete, use the preview to copy notes.');
                }, 300);
            } else {
                throw new Error(result.error || 'Failed to process file');
            }

        } catch (error) {
            console.error('OCR file error:', error);
            showError(`OCR processing failed: ${error.message}`);
            document.getElementById('ocrProgress').style.display = 'none';
        }
    } else {
        document.getElementById('ocrProgress').style.display = 'none';
        showError('Unsupported file type. Choose a JSON, CSV, PDF, or image file.');
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














