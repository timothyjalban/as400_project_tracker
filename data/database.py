from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import config


def _connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    # Reduce transient lock failures between API requests and reminder operations.
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    ensure_reminders_schema(conn)
    return conn


def ensure_reminders_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            title TEXT NOT NULL,
            due_at TEXT NOT NULL,
            repeat TEXT,
            guest TEXT,
            done INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        )
        """
    )
    conn.commit()


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(zip(row.keys(), row))


def backup_order(order_id: int) -> Path:
    conn = _connect()
    try:
        order_row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not order_row:
            raise ValueError("Order not found")

        backup_dir = Path(config.BACKUP_DIR)
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"order_{order_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"

        payload = {
            'backup_created_at': datetime.utcnow().isoformat(),
            'order': _row_to_dict(order_row),
        }
        backup_path.write_text(json.dumps(payload, indent=2, default=str), encoding='utf-8')
        return backup_path
    finally:
        conn.close()


def insert_reminder(order_id: Optional[int], title: str, due_iso: str, repeat: Optional[str] = None, guest: Optional[str] = None) -> int:
    conn = _connect()
    try:
        cursor = conn.execute(
            """
            INSERT INTO reminders (order_id, title, due_at, repeat, guest, done, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (order_id, title, due_iso, repeat, guest, datetime.now().isoformat(), datetime.now().isoformat()),
        )
        conn.commit()
        return int(cursor.lastrowid)
    finally:
        conn.close()


def list_due_reminders() -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT r.*, o.customer_name, o.project_name, o.po_number
            FROM reminders r
            LEFT JOIN orders o ON o.id = r.order_id
            WHERE r.done = 0 AND r.due_at <= ?
            ORDER BY r.due_at ASC
            """,
            (datetime.now().isoformat(),),
        ).fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        conn.close()


def snooze_reminder(reminder_id: int, minutes: int) -> None:
    conn = _connect()
    try:
        due_at = datetime.now() + timedelta(minutes=int(minutes))
        conn.execute(
            "UPDATE reminders SET due_at = ?, updated_at = ? WHERE id = ?",
            (due_at.isoformat(), datetime.now().isoformat(), reminder_id),
        )
        conn.commit()
    finally:
        conn.close()


def complete_reminder(reminder_id: int) -> None:
    conn = _connect()
    try:
        conn.execute(
            "UPDATE reminders SET done = 1, completed_at = ?, updated_at = ? WHERE id = ?",
            (datetime.now().isoformat(), datetime.now().isoformat(), reminder_id),
        )
        conn.commit()
    finally:
        conn.close()
