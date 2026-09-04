#!/usr/bin/env python3
"""Checks for the line-item field config store (core.py + blueprints/field_config.py).

    python tests/test_field_config_api.py

Exit 0 = all pass, 1 = a check failed. Uses a throwaway DB - never touches
orders.db.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

_db_fd, _db_path = tempfile.mkstemp(suffix='.db')
os.close(_db_fd)
os.environ['ORDER_TRACKER_DB_PATH'] = _db_path

import core  # noqa: E402

failures: list[str] = []


def check(name: str, cond: bool, detail: str = '') -> None:
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}  {detail}')
        failures.append(name)


def main() -> None:
    conn = core.get_db_connection()

    # --- seed ---
    cfg = core.fetch_line_item_field_config(conn)
    check('seed populated every managed field',
          set(cfg['options']) == set(core.LINE_ITEM_FIELD_DEFAULTS['options']),
          f"{sorted(set(core.LINE_ITEM_FIELD_DEFAULTS['options']) - set(cfg['options']))}")
    mats = [r['value'] for r in cfg['options']['material']]
    check('material seeded in order', mats == ['Wood', 'Primed', 'Fiberglass', 'Steel', 'Vinyl'], str(mats))
    fb = next(r for r in cfg['options']['material'] if r['value'] == 'Fiberglass')
    check('seeded as400_text preserved', fb['as400_text'] == 'FB', str(fb))
    check('labels start empty', cfg['labels'] == {}, str(cfg['labels']))

    # --- add / edit / soft-delete ---
    core.upsert_line_item_field_option(conn, 'material', 'Mahogany', as400_text='MAH')
    cfg = core.fetch_line_item_field_config(conn)
    mah = next((r for r in cfg['options']['material'] if r['value'] == 'Mahogany'), None)
    check('add option', mah is not None and mah['as400_text'] == 'MAH', str(mah))

    core.update_line_item_field_option(conn, mah['id'], display_label='Mahogany (FSC)')
    cfg = core.fetch_line_item_field_config(conn)
    check('edit display label',
          next(r for r in cfg['options']['material'] if r['id'] == mah['id'])['label'] == 'Mahogany (FSC)')

    vinyl = next(r for r in cfg['options']['material'] if r['value'] == 'Vinyl')
    core.set_line_item_field_option_active(conn, vinyl['id'], active=False)
    cfg = core.fetch_line_item_field_config(conn)
    vinyl2 = next(r for r in cfg['options']['material'] if r['id'] == vinyl['id'])
    check('soft delete keeps the row, flips active', vinyl2['active'] is False)

    # --- reorder ---
    ids = [r['id'] for r in cfg['options']['material']]
    core.reorder_line_item_field_options(conn, 'material', '*', list(reversed(ids)))
    cfg = core.fetch_line_item_field_config(conn)
    check('reorder', [r['id'] for r in cfg['options']['material']] == list(reversed(ids)))

    # --- label ---
    core.set_line_item_field_label(conn, 'boring', 'Bore Prep')
    check('set label', core.fetch_line_item_field_config(conn)['labels'].get('boring') == 'Bore Prep')
    core.set_line_item_field_label(conn, 'boring', '')
    check('blank label reverts (row deleted)', 'boring' not in core.fetch_line_item_field_config(conn)['labels'])

    # --- vendor-scoped option ---
    core.upsert_line_item_field_option(conn, 'material', 'Sapele', vendor='Orepac', as400_text='SAP')
    cfg = core.fetch_line_item_field_config(conn)
    sap = next((r for r in cfg['options']['material'] if r['value'] == 'Sapele'), None)
    check('vendor-scoped add', sap is not None and sap['vendor'] == 'Orepac', str(sap))
    # a generic "Wood" and an Orepac "Wood" can now coexist
    core.upsert_line_item_field_option(conn, 'material', 'Wood', vendor='Orepac', as400_text='ORE-WD')
    woods = [r for r in core.fetch_line_item_field_config(conn)['options']['material'] if r['value'] == 'Wood']
    check('same value can be generic + vendor-scoped', len(woods) == 2, str(woods))

    # --- export / import round-trip ---
    exported = core.export_line_item_field_config(conn)
    check('export material has Mahogany',
          any(i.get('value') == 'Mahogany' for i in exported['options']['material']['items']))
    core.reset_line_item_field_config(conn, 'material')
    cfg = core.fetch_line_item_field_config(conn)
    check('reset one field back to factory',
          [r['value'] for r in cfg['options']['material']] == ['Wood', 'Primed', 'Fiberglass', 'Steel', 'Vinyl'])
    summary = core.import_line_item_field_config(conn, exported)
    cfg = core.fetch_line_item_field_config(conn)
    check('import restores Mahogany',
          any(r['value'] == 'Mahogany' for r in cfg['options']['material']),
          str(summary))
    # import of an already-current export makes no further changes
    summary2 = core.import_line_item_field_config(conn, core.export_line_item_field_config(conn))
    check('re-import is idempotent (no inserts)', summary2['inserted'] == 0, str(summary2))

    conn.close()


if __name__ == '__main__':
    try:
        main()
    finally:
        try:
            os.remove(_db_path)
        except OSError:
            pass
    print()
    if failures:
        print(f'{len(failures)} check(s) failed')
        sys.exit(1)
    print('all checks passed')
