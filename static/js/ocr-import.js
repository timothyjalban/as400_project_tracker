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

    const { ok, result: saveResult } = await putOrder(targetOrderId, payload, {
        source: 'ocr-import',
        baseOrderId: targetOrderId,
    });

    if (!ok || !saveResult.order) {
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
