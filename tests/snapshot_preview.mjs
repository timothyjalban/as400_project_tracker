// Generates / checks the "what the browser preview shows" snapshot for every
// fixture order. Pair with snapshot_macro.py ("what actually gets typed").
//
//   node tests/snapshot_preview.mjs            # check against committed snapshots
//   node tests/snapshot_preview.mjs --update   # rewrite snapshots
//
// Exit 0 = match, 1 = drift (prints a unified-ish diff), 2 = harness error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserContext } from './lib/browser-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'orders');
const SNAPSHOTS = path.join(ROOT, 'tests', 'snapshots');
const UPDATE = process.argv.includes('--update');

function itemType(item) {
  return String(item?.type || item?.item_type || item?.product || 'unknown').toLowerCase();
}

// Normalize to one tag per line so the snapshot compares DOM structure, not the
// source template's indentation. Splits every tag boundary (with or without
// whitespace between) so hand-written and helper-built markup compare equal.
function prettyHtml(html) {
  return String(html)
    .replace(/>\s*</g, '>\n<')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

// Stable key order so the committed payload JSON doesn't churn on re-serialization.
function stableStringify(value) {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
    }
    return v;
  }, 2);
}

// The exact automation payload JS hands to the desktop helper: line items after
// mapLineItemForAs400Automation (adds as400_comment, authoritative flag, resolved
// sku, truncated description, ...). snapshot_macro.py types *this*, not the raw
// fixture - so the snapshot reflects the real JS->Python handoff.
function buildPayload(ctx, fixture) {
  ctx.setOrder(fixture);
  return (fixture.line_items || []).map((item) => {
    try {
      return ctx.mappedItem(item);
    } catch (err) {
      return { __map_error: err.message, ...item };
    }
  });
}

function renderPreviewSnapshot(ctx, fixture, name) {
  const order = fixture;
  ctx.setOrder(order);

  const lines = [];
  lines.push(`# ${name}`);
  lines.push(`# order ${order.id ?? '(none)'}  needs_prefit=${Boolean(order.needs_prefit)}  items=${order.line_items.length}`);
  lines.push('');

  order.line_items.forEach((item, i) => {
    lines.push(`=== item ${i + 1}  (${itemType(item)}) ===`);
    let text;
    try {
      text = ctx.previewForItem(item);
    } catch (err) {
      text = `<<preview threw: ${err.message}>>`;
    }
    lines.push(text.length ? text : '<<empty>>');
    lines.push('');
  });

  return lines.join('\n').replace(/\s+$/, '') + '\n';
}

// The structured AS400 row plan - the single source of truth Step 1 introduces.
// This is what the desktop helper will type once the typist branch lands.
function renderRowPlanSnapshot(ctx, fixture, name) {
  let plan;
  try {
    plan = ctx.rowPlanForOrder(fixture);
  } catch (err) {
    return `# ${name}\n<<row plan threw: ${err.message}>>\n`;
  }

  const lines = [`# ${name}`, `# ${plan.length} rows`, ''];
  plan.forEach((row, i) => {
    lines.push(`--- row ${i + 1} ---`);
    lines.push(`sku:          ${row.sku || '(blank)'}`);
    lines.push(`description:  ${row.description || '(blank)'}  [${row.description.length} ch]`);
    lines.push(`um:           ${row.um}`);
    lines.push(`price:        ${row.price || '(blank)'}`);
    lines.push(`qty:          ${row.qty}`);
    lines.push(`fresh comment: ${row.entersFreshComment}`);
    if (row.entersFreshComment) {
      row.commentLines.forEach((cl) => lines.push(`  | ${cl}`));
      if (row.commentLines.length === 0) lines.push('  | (none)');
    }
    lines.push('');
  });
  return lines.join('\n').replace(/\s+$/, '') + '\n';
}

function main() {
  if (!fs.existsSync(FIXTURES)) {
    console.error(`No fixtures at ${path.relative(ROOT, FIXTURES)} - run: python tests/export_fixtures.py`);
    return 2;
  }
  const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();
  if (fixtureFiles.length === 0) {
    console.error('No fixture .json files found.');
    return 2;
  }

  let ctx;
  try {
    ctx = createBrowserContext();
  } catch (err) {
    console.error(`Harness failed to load browser JS:\n  ${err.message}`);
    return 2;
  }

  fs.mkdirSync(SNAPSHOTS, { recursive: true });
  let drift = 0;
  let updated = 0;

  for (const file of fixtureFiles) {
    const name = file.replace(/\.json$/, '');
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8'));

    let rowPlan = [];
    try { rowPlan = ctx.rowPlanForOrder(fixture); } catch { /* rendered in .rowplan.txt */ }

    const artifacts = [
      [`${name}.preview.txt`, renderPreviewSnapshot(ctx, fixture, name)],
      [`${name}.payload.json`, stableStringify(buildPayload(ctx, fixture)) + '\n'],
      [`${name}.rowplan.txt`, renderRowPlanSnapshot(ctx, fixture, name)],
      [`${name}.rowplan.json`, stableStringify(rowPlan) + '\n'],
    ];

    // Editor HTML guards renderLineItemsEditor() refactors. Synthetic fixtures
    // only (committed; the real ones' HTML isn't worth the churn).
    if (name.startsWith('syn-')) {
      let editorHtml;
      try { editorHtml = ctx.editorHtmlForOrder(fixture); }
      catch (err) { editorHtml = `<<editor render threw: ${err.message}>>`; }
      artifacts.push([`${name}.editor.html`, prettyHtml(editorHtml) + '\n']);
    }

    for (const [fileName, actual] of artifacts) {
      const snapPath = path.join(SNAPSHOTS, fileName);
      if (UPDATE) {
        const prev = fs.existsSync(snapPath) ? fs.readFileSync(snapPath, 'utf8') : null;
        if (prev !== actual) updated++;
        fs.writeFileSync(snapPath, actual);
        continue;
      }
      if (!fs.existsSync(snapPath)) {
        console.error(`MISSING  ${fileName}  (run with --update)`);
        drift++;
        continue;
      }
      const expected = fs.readFileSync(snapPath, 'utf8');
      if (expected !== actual) {
        drift++;
        console.error(`\nDRIFT    ${fileName}`);
        printDiff(expected, actual);
      }
    }
  }

  if (UPDATE) {
    console.log(`preview snapshots: ${updated} changed, ${fixtureFiles.length} total`);
    return 0;
  }
  if (drift) {
    console.error(`\npreview snapshots: ${drift} drifted / ${fixtureFiles.length} checked`);
    return 1;
  }
  console.log(`preview snapshots: ${fixtureFiles.length} OK`);
  return 0;
}

function printDiff(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i++) {
    if (e[i] !== a[i]) {
      if (e[i] !== undefined) console.error(`  - ${e[i]}`);
      if (a[i] !== undefined) console.error(`  + ${a[i]}`);
    }
  }
}

process.exit(main());
