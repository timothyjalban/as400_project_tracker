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

