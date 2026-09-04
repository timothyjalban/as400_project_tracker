// Guard: data/line_item_field_defaults.json - the DB seed for user-editable
// line-item dropdowns - stays valid and keeps the AS400 abbreviations that
// static/js/line-item-as400.js used to hard-code.
//
//   node tests/line_item_field_config.mjs
//
// Exit 0 = OK, 1 = problem.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaults = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/line_item_field_defaults.json'), 'utf8'),
);

const problems = [];

// --- structure -------------------------------------------------------------
if (!defaults || typeof defaults !== 'object') problems.push('not an object');
if (!defaults.options || typeof defaults.options !== 'object') problems.push('missing "options" object');
if (!defaults.labels || typeof defaults.labels !== 'object') problems.push('missing "labels" object');

for (const [key, spec] of Object.entries(defaults.options || {})) {
  if (!spec || typeof spec !== 'object') { problems.push(`${key}: spec is not an object`); continue; }
  if (!['*', 'door', 'window', 'hardware'].includes(spec.scope || '*')) {
    problems.push(`${key}: bad scope "${spec.scope}"`);
  }
  if (!Array.isArray(spec.items)) { problems.push(`${key}: items is not an array`); continue; }
  const seen = new Set();
  for (const item of spec.items) {
    const value = String(item?.value ?? '').trim();
    if (!value) { problems.push(`${key}: an item has an empty value`); continue; }
    const lc = value.toLowerCase();
    if (seen.has(lc)) problems.push(`${key}: duplicate value "${value}"`);
    seen.add(lc);
  }
}

// --- AS400 abbreviation regression lock ----------------------------------
// These reproduce the maps in static/js/line-item-as400.js
// (abbreviateDescriptionTerms, doorCoreDescriptionText, doorLitesText). If a
// seed value's as400_text drifts from these, AS400 output silently changes.
const REQUIRED_AS400 = {
  material: { Primed: 'PRM', Fiberglass: 'FB' },
  core: { 'Hollow Core': 'HC', 'Solid Core': 'SC' },
  sticking: { Shaker: 'SHK' },
  panel_style: {
    '1 Lite': '1 LT', '2 Lite': '2 LT', '3 Lite': '3 LT',
    '5 Lite': '5 LT', '10 Lite': '10 LT', '15 Lite': '15 LT',
  },
};

for (const [key, wants] of Object.entries(REQUIRED_AS400)) {
  const items = defaults.options[key]?.items || [];
  for (const [value, as400] of Object.entries(wants)) {
    const row = items.find((i) => i.value === value);
    if (!row) { problems.push(`${key}: seed is missing "${value}"`); continue; }
    if (row.as400_text !== as400) {
      problems.push(`${key} "${value}": as400_text is ${JSON.stringify(row.as400_text)}, must be "${as400}"`);
    }
  }
}

// --- labels ------------------------------------------------------------
for (const [key, label] of Object.entries(defaults.labels || {})) {
  if (typeof label !== 'string' || !label.trim()) problems.push(`label "${key}" is empty`);
  if (!defaults.options[key.split('@')[0]]) {
    problems.push(`label "${key}" has no matching options entry`);
  }
}

if (problems.length) {
  console.error(`line_item_field_defaults.json: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`line_item_field_defaults.json: OK (${Object.keys(defaults.options).length} fields)`);
