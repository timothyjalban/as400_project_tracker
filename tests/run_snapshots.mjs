// Runs both snapshot checks (preview + macro) and reports a combined result.
// This is the gate: any drift here means a refactor changed AS400 output.
//
//   node tests/run_snapshots.mjs            # check
//   node tests/run_snapshots.mjs --update   # regenerate both sets
//
// Also wired as `npm run snapshots` / `npm run snapshots:update`.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const update = process.argv.includes('--update');
const pyArgs = update ? ['--update'] : [];
const jsArgs = update ? ['--update'] : [];

function run(label, cmd, args) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 40 - label.length))}`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error) {
    console.error(`  ${label}: failed to start (${res.error.message})`);
    return 2;
  }
  return res.status ?? 0;
}

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const previewStatus = run('preview (browser)', process.execPath, [path.join('tests', 'snapshot_preview.mjs'), ...jsArgs]);
const macroStatus = run('macro (AS400 typist)', python, [path.join('tests', 'snapshot_macro.py'), ...pyArgs]);
const registryStatus = run('field registry', process.execPath, [path.join('tests', 'line_item_fields.mjs')]);

const worst = Math.max(previewStatus, macroStatus, registryStatus);
console.log('\n' + '═'.repeat(44));
if (worst === 0) {
  console.log(update ? 'snapshots regenerated.' : 'all snapshots OK - AS400 output unchanged.');
} else if (worst === 1) {
  console.log('SNAPSHOT DRIFT - AS400 output changed. Review the diff above.');
  console.log('If the change is intended, re-run with --update and commit.');
} else {
  console.log('snapshot harness error - see messages above.');
}
process.exit(worst);
