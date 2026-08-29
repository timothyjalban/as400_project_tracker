from __future__ import annotations

import os

from pathlib import Path


DB_PATH = Path(r"C:\Users\tim.alban\Desktop\HTML_Order_Tracker\orders.db")
print("FORCED DB PATH:", DB_PATH)



# DB_PATH = Path(os.environ.get('ORDER_TRACKER_DB_PATH', '/tmp/orders.db'))

BACKUP_DIR = Path(os.environ.get('ORDER_TRACKER_BACKUP_DIR', str(DB_PATH.parent / 'backups')))
