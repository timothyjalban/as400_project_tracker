// Guard: the field registry (static/js/line-item-fields.js) must stay in sync
// with the two places fields actually live today -
//   1. createLineItemTemplate()  in line-items.js  (the defaults)
//   2. data-item-field="..."     in renderLineItemsEditor()  (the inputs)
//
// If a field is added to either without a registry entry, this fails - which is
// the whole point: the registry stops being a place fields can be forgotten.
//
//   node tests/line_item_fields.mjs
//
// Exit 0 = in sync, 1 = drift.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createBrowserContext } from './lib/browser-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// line-item-fields.js is a plain browser <script> global - eval it in a context
// and read its globals, the same way the browser would.
const registryCtx = vm.createContext({ module: undefined, console });
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'static/js/line-item-fields.js'), 'utf8') +
    '\n;globalThis.__registry = { LINE_ITEM_FIELDS, LINE_ITEM_FIELD_GROUPS, lineItemFieldDefaults, lineItemFieldsForType, lineItemAs400Fields };',
  registryCtx,
  { filename: 'static/js/line-item-fields.js' },
);
const { LINE_ITEM_FIELDS, LINE_ITEM_FIELD_GROUPS, lineItemFieldDefaults } = registryCtx.__registry;

const renderSrc = fs.readFileSync(path.join(ROOT, 'static/js/line-item-render.js'), 'utf8');

// The template defaults now come FROM the registry (createLineItemTemplate spreads
// lineItemTemplateDefaults()). The freshItem check below confirms the wiring;
// here we just need the key set for coverage checks.
const templateKeys = new Set(LINE_ITEM_FIELDS.filter(f => !f.editorOnly).map(f => f.key));

// Every data-item-field="..." still hand-written in the editor renderer must
// have a registry entry.
const editorFields = new Set(
  [...renderSrc.matchAll(/data-item-field="([a-z_0-9]+)"/g)].map(m => m[1]),
);

const registryKeys = new Set();
const problems = [];

for (const f of LINE_ITEM_FIELDS) {
  if (registryKeys.has(f.key)) problems.push(`duplicate registry key "${f.key}"`);
  registryKeys.add(f.key);
}

// Every field that actually exists today must have an entry.
for (const k of templateKeys) {
  if (!registryKeys.has(k)) problems.push(`template key "${k}" has no registry entry`);
}
for (const k of editorFields) {
  if (!registryKeys.has(k)) problems.push(`editor field "${k}" has no registry entry`);
}

// Registry entries must point at something real (or be flagged).
for (const f of LINE_ITEM_FIELDS) {
  const real = templateKeys.has(f.key) || editorFields.has(f.key);
  if (!real && f.group !== 'internal' && !f.editorOnly) {
    problems.push(`registry key "${f.key}" isn't a template default or an editor field - typo, or add editorOnly:true / group:'internal'`);
  }
  if (f.editorOnly && templateKeys.has(f.key)) {
    problems.push(`"${f.key}" is marked editorOnly but IS a template default - drop the flag`);
  }
}

// A template default that the registry marks door-only (etc.) must actually be
// offered to that type - cheap catch for wrong appliesTo.
for (const f of LINE_ITEM_FIELDS) {
  if (templateKeys.has(f.key) && f.appliesTo.length === 0) {
    problems.push(`"${f.key}" is a template default but appliesTo is empty`);
  }
}

// createLineItemTemplate() must actually build its defaults from the registry -
// i.e. a fresh item equals lineItemTemplateDefaults() plus type/product.
try {
  const ctx = createBrowserContext();
  const regDefaults = vm.runInContext('lineItemTemplateDefaults()', ctx.raw);
  for (const type of ['door', 'window', 'hardware', 'install']) {
    const fresh = ctx.freshItem(type);
    const want = {
      ...regDefaults,
      type,
      product: type === 'install' ? 'Install'
        : type === 'hardware' ? 'Hardware'
        : type === 'window' ? 'Window' : 'Door',
    };
    const fk = Object.keys(fresh).sort();
    const wk = Object.keys(want).sort();
    for (const k of wk) if (!(k in fresh)) problems.push(`createLineItemTemplate("${type}") is missing "${k}" (in registry)`);
    for (const k of fk) {
      if (!(k in want)) { problems.push(`createLineItemTemplate("${type}") has extra key "${k}" (not in registry)`); continue; }
      if (JSON.stringify(fresh[k]) !== JSON.stringify(want[k])) {
        problems.push(`createLineItemTemplate("${type}").${k} = ${JSON.stringify(fresh[k])}, registry says ${JSON.stringify(want[k])}`);
      }
    }
  }
} catch (err) {
  problems.push(`could not verify createLineItemTemplate against the registry: ${err.message}`);
}

// Schema sanity.
const CONTROLS = new Set(['text', 'number', 'select', 'checkbox', 'buttons', 'textarea', 'derived']);
for (const f of LINE_ITEM_FIELDS) {
  if (!f.key || !(f.label || f.render?.label)) problems.push(`entry missing key/label: ${JSON.stringify(f)}`);
  if (!CONTROLS.has(f.control)) problems.push(`"${f.key}": unknown control "${f.control}"`);
  if (!Array.isArray(f.appliesTo) || f.appliesTo.length === 0) problems.push(`"${f.key}": empty appliesTo`);
  if (f.group && !LINE_ITEM_FIELD_GROUPS.includes(f.group)) problems.push(`"${f.key}": unknown group "${f.group}"`);
  if (f.as400 && !['description', 'comment', 'row'].includes(f.as400.target)) problems.push(`"${f.key}": bad as400.target`);
}

// Managed dropdowns (optionsSource: 'fieldConfig') must (a) not also carry a
// static render.options array - the DB is the only copy - and (b) have a
// factory-defaults entry in data/line_item_field_defaults.json.
const fieldDefaults = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/line_item_field_defaults.json'), 'utf8'),
);
const seededKeys = new Set(Object.keys(fieldDefaults.options || {}));
for (const f of LINE_ITEM_FIELDS) {
  const renders = f.render?.variants ? Object.values(f.render.variants) : (f.render ? [f.render] : []);
  const managed = renders.some((r) => r && r.optionsSource === 'fieldConfig');
  if (!managed) continue;
  if (renders.some((r) => Array.isArray(r?.options))) {
    problems.push(`"${f.key}": optionsSource 'fieldConfig' AND a static render.options - remove the array`);
  }
  if (!seededKeys.has(f.key)) {
    problems.push(`"${f.key}" is fieldConfig-managed but has no entry in data/line_item_field_defaults.json`);
  }
}
for (const key of seededKeys) {
  if (!registryKeys.has(key)) {
    problems.push(`data/line_item_field_defaults.json has "${key}" but it's not a registry key`);
  }
}

if (problems.length) {
  console.error(`line-item field registry: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `line-item field registry: OK ` +
  `(${registryKeys.size} entries, ${templateKeys.size} template keys, ${editorFields.size} editor fields)`,
);
