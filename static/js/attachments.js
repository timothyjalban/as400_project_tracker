// Order Tracker - Attachments
// Depends on globals from app.js: API_BASE, currentOrder, getSelectedOrder,
// showToast, showError, escapeHtml, and formatDate.
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
                <button class="btn-icon" onclick="openAttachment(${att.id})" title="Open">
                    ↗
                </button>
                <button class="btn-icon" onclick="downloadAttachment(${att.id})" title="Download">
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
    // The order highlighted in the list (selectedOrderId) is the source of
    // truth for "which order am I acting on". `currentOrder` is a cache that
    // several unrelated actions write to and nothing clears on plain
    // selection, so it can lag a list click by one order - trusting it first
    // made "Import Quote Into Order" / file uploads land on the previously
    // touched order instead of the one on screen.
    const selected = getSelectedOrder();
    if (selected && selected.id) {
        return selected;
    }

    if (currentOrder && currentOrder.id) {
        return currentOrder;
    }

    return null;
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

async function openAttachment(attachmentId) {
    const openUrl = `${API_BASE}/attachments/${attachmentId}/open`;
    const downloadUrl = `${API_BASE}/attachments/${attachmentId}/download`;

    try {
        const response = await fetch(openUrl, { method: 'HEAD' });
        window.open(response.ok ? openUrl : downloadUrl, '_blank', 'noopener');
    } catch (error) {
        console.error('Error opening file:', error);
        window.open(downloadUrl, '_blank', 'noopener');
    }
}

async function downloadAttachment(attachmentId) {
    try {
        window.open(`${API_BASE}/attachments/${attachmentId}/download`, '_blank', 'noopener');
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
