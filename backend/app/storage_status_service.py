from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .db import utcnow

STORAGE_STATUS_SETTING_KEY = 'storage_status_state_json'
STORAGE_STATUS_SEED_VERSION_KEY = 'storage_status_seed_version'
SEED_PATH = Path(__file__).resolve().with_name('storage_status_seed.json')


def _load_seed() -> dict[str, Any]:
    with SEED_PATH.open('r', encoding='utf-8') as fp:
        data = json.load(fp)
    normalized = _normalize_state(data)
    normalized['seed_version'] = str((data or {}).get('seed_version') or '').strip()
    return normalized


def _parse_date(value: Any) -> date | None:
    text = str(value or '').strip()
    if not text:
        return None
    for fmt in ('%y.%m.%d', '%y-%m-%d', '%Y-%m-%d', '%Y.%m.%d', '%Y/%m/%d', '%y/%m/%d'):
        try:
            return datetime.strptime(text, fmt).date()
        except Exception:
            continue
    digits = ''.join(ch for ch in text if ch.isdigit())
    if len(digits) == 6:
        try:
            return datetime.strptime(digits, '%y%m%d').date()
        except Exception:
            return None
    if len(digits) == 8:
        try:
            return datetime.strptime(digits, '%Y%m%d').date()
        except Exception:
            return None
    return None


def _format_date(value: Any) -> str:
    parsed = _parse_date(value)
    if not parsed:
        return str(value or '').strip()
    return parsed.strftime('%y.%m.%d')


def _parse_scale(value: Any) -> float:
    text = str(value or '').strip().replace(',', '')
    if not text:
        return 0.0
    try:
        return float(text)
    except Exception:
        return 0.0


def _format_scale(value: Any) -> str:
    amount = _parse_scale(value)
    if amount == 0:
        return '' if str(value or '').strip() == '' else '0'
    if abs(amount - round(amount)) < 1e-9:
        return str(int(round(amount)))
    return f'{amount:g}'


def _status_for(start_date: date | None, end_date: date | None, today: date | None = None) -> str:
    if not start_date and not end_date:
        return ''
    today = today or date.today()
    compare_start = start_date or end_date
    compare_end = end_date or start_date
    if compare_start and today < compare_start:
        return '예정'
    if compare_end and today > compare_end:
        return '종료'
    return '진행'


def _normalize_row(row: dict[str, Any]) -> dict[str, Any]:
    customer_name = str(row.get('customer_name') or row.get('customerName') or '').strip()
    manager_name = str(row.get('manager_name') or row.get('managerName') or '').strip()
    start_date = _parse_date(row.get('start_date') or row.get('startDate'))
    end_date = _parse_date(row.get('end_date') or row.get('endDate'))
    scale_raw = row.get('scale') or row.get('storage_scale') or row.get('storageScale')
    row_id = str(row.get('id') or '').strip()
    if not row_id:
        row_id = f"row-{abs(hash((customer_name, manager_name, str(row.get('start_date') or row.get('startDate') or ''), str(row.get('end_date') or row.get('endDate') or ''), str(scale_raw or ''))))}"
    return {
        'id': row_id,
        'status': _status_for(start_date, end_date),
        'customer_name': customer_name,
        'manager_name': manager_name,
        'start_date': start_date.strftime('%y.%m.%d') if start_date else '',
        'end_date': end_date.strftime('%y.%m.%d') if end_date else '',
        'scale': _format_scale(scale_raw),
    }


def _normalize_state(state: dict[str, Any] | None) -> dict[str, Any]:
    source_rows = []
    if isinstance(state, dict):
        source_rows = state.get('rows') or []
    rows = []
    for item in source_rows:
        if not isinstance(item, dict):
            continue
        rows.append(_normalize_row(item))
    return {
        'rows': rows,
        'updated_at': utcnow(),
    }


def get_state(conn) -> dict[str, Any]:
    seed_state = _load_seed()
    seed_version = str(seed_state.get('seed_version') or '').strip()
    version_row = conn.execute('SELECT value FROM admin_settings WHERE key = ?', (STORAGE_STATUS_SEED_VERSION_KEY,)).fetchone()
    current_seed_version = str(version_row['value']).strip() if version_row and version_row['value'] else ''

    if seed_version and seed_version != current_seed_version:
        normalized_seed = save_state(conn, seed_state)
        conn.execute(
            "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (STORAGE_STATUS_SEED_VERSION_KEY, seed_version, utcnow()),
        )
        return normalized_seed

    row = conn.execute('SELECT value FROM admin_settings WHERE key = ?', (STORAGE_STATUS_SETTING_KEY,)).fetchone()
    if row and row['value']:
        try:
            state = json.loads(row['value'])
            if isinstance(state, dict):
                normalized = _normalize_state(state)
                save_state(conn, normalized)
                return normalized
        except Exception:
            pass

    normalized_seed = save_state(conn, seed_state)
    if seed_version:
        conn.execute(
            "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (STORAGE_STATUS_SEED_VERSION_KEY, seed_version, utcnow()),
        )
    return normalized_seed


def save_state(conn, state: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_state(state)
    conn.execute(
        "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (STORAGE_STATUS_SETTING_KEY, json.dumps(normalized, ensure_ascii=False), utcnow()),
    )
    return normalized


def replace_rows(conn, rows: list[dict[str, Any]]) -> dict[str, Any]:
    return save_state(conn, {'rows': rows})
