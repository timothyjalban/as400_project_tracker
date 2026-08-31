// Order Tracker - AS400 row plan (single source of truth for what gets typed)
//
// buildAs400RowPlan(order, lineItems) returns the exact per-row structure the
// AS400 macro should type - one entry per line item, in order:
//
//   {
//     sku, description, um, price, qty,   // Ctrl+Alt+S dialog fields
//     commentLines: string[],            // freeform comment block for this row
//     entersFreshComment: boolean         // false => row inherits the previous block
//   }
//
// The browser preview and the desktop-helper payload are both built from this,
// so "what the preview shows" and "what gets typed" cannot drift.
//
// Depends on the builders in line-item-as400.js and mapLineItemForAs400Automation
// from document-generation.js.

function _rowPlanCommentLines(item, mappedItem) {
    const rawCommentText = item && item.type === 'door' && item.prefit_enabled
        ? buildFormattedPrefitComment(item)
        : buildStandardAs400CommentPreview(item);

    return formatAs400CommentLinesForLimit(
        String(rawCommentText || '').split(/\r?\n/).filter(line => String(line || '').trim()),
        PREFIT_COMMENT_MAX_LINES,
        PREFIT_COMMENT_MAX_CHARS_PER_LINE
    );
}

// Port of launch_ibm.py::_build_sequential_comment_plan. Consecutive rows that
// resolve to the same comment text inherit the previous block (only the first
// row of a run actually types it). Bypass doors always type their own block.
function _computeCommentEntryPlan(items, commentTextByRow) {
    const plan = [];
    let previousKey = '';

    items.forEach((item, i) => {
        const key = normalizeMacroText(commentTextByRow[i] || '').toLowerCase();
        if (isBypassDoorDescription(item)) {
            plan.push(true);
        } else if (key && key !== previousKey) {
            plan.push(true);
        } else {
            plan.push(false);
        }
        previousKey = key;
    });

    return plan;
}

function _rowPlanPriceText(mappedItem) {
    const price = mappedItem.price;
    if (price != null && price !== '') return String(price).trim();
    const unit = mappedItem.unit_price;
    if (unit != null && unit !== '') return String(unit).trim();
    return '';
}

function buildAs400RowPlan(order, lineItems) {
    const items = (Array.isArray(lineItems) ? lineItems : []).filter(
        it => it && typeof it === 'object'
    );
    if (items.length === 0) return [];

    const mapped = items.map(it =>
        typeof mapLineItemForAs400Automation === 'function'
            ? mapLineItemForAs400Automation(it)
            : it
    );

    const commentLinesByRow = items.map((it, i) => _rowPlanCommentLines(it, mapped[i]));
    const commentTextByRow = commentLinesByRow.map(lines => lines.join('\n'));
    const entryPlan = _computeCommentEntryPlan(items, commentTextByRow);

    return items.map((it, i) => {
        const m = mapped[i];
        return {
            sku: resolveVendorSkuForCtrlAltS(m) || '',
            description: buildCtrlAltSDescription(m) || '',
            um: resolveUmForCtrlAltS(m),
            price: _rowPlanPriceText(m),
            qty: Number.parseInt(m.quantity || '1', 10) || 1,
            commentLines: commentLinesByRow[i],
            entersFreshComment: entryPlan[i],
        };
    });
}

// Human-readable render of one row plan entry, used by the line-item preview so
// the preview reflects comment inheritance instead of repeating every block.
function formatAs400RowPlanEntry(entry, rowNumber, inheritedFromRow) {
    const lines = [];

    if (entry.entersFreshComment) {
        lines.push(entry.commentLines.length ? entry.commentLines.join('\n') : '(no comment)');
    } else {
        lines.push(`(comment inherited from item ${inheritedFromRow})`);
    }

    lines.push('');
    lines.push('--- Ctrl+Alt+S Preview ---');
    lines.push('Ctrl+Alt+S Fields:');
    lines.push(`SKU: ${entry.sku || '(blank)'}`);
    lines.push(`Description: ${entry.description || '(blank)'}`);
    lines.push(`U/M: ${entry.um}`);
    lines.push(`Price: ${entry.price || '(blank)'}`);
    lines.push(`Qty: ${entry.qty}`);

    return lines.join('\n');
}
