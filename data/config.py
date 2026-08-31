from __future__ import annotations

import os

from pathlib import Path


# Default DB is orders.db at the repo root. Override with ORDER_TRACKER_DB_PATH
# (core.py reads that env var and calls resolve_db_path()).
DB_PATH = Path(__file__).resolve().parent.parent / 'orders.db'

BACKUP_DIR = Path(os.environ.get('ORDER_TRACKER_BACKUP_DIR', str(DB_PATH.parent / 'backups')))
