from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from .db import utcnow

WAREHOUSE_SETTING_KEY = 'warehouse_state_json'
SEED_PATH = Path(__file__).resolve().with_name('warehouse_seed.json')

CFG = {
    'GALMAE': {
        'prefix': 'GALMAE',
        'inputSheet': '갈매창고입력시트',
        'targetSheet': '갈매창고',
        'statusRange': ('A4', 'C15'),
        'targetRange': ('A1', 'J33'),
    },
    'GIMPO': {
        'prefix': 'GIMPO',
        'inputSheet': '김포창고입력시트',
        'targetSheet': '김포창고',
        'statusRange': ('A4', 'C10'),
        'targetRange': ('A1', 'H25'),
    },
}

WRAP_SLOTS = {'1-1', '1-2', '6-1', '6-2', '7-1', '7-2'}
SLOT_RE = re.compile(r'^\d+(?:-\d+)?$')


def _load_seed() -> dict[str, Any]:
    with SEED_PATH.open('r', encoding='utf-8') as fp:
        data = json.load(fp)
    data['undoStacks'] = {'GALMAE': [], 'GIMPO': []}
    data['rowBackups'] = {}
    return _recompute_all(data)


def _deepcopy(data: Any):
    return copy.deepcopy(data)


def get_state(conn) -> dict[str, Any]:
    row = conn.execute('SELECT value FROM admin_settings WHERE key = ?', (WAREHOUSE_SETTING_KEY,)).fetchone()
    if row and row['value']:
        try:
            state = json.loads(row['value'])
            if isinstance(state, dict) and state.get('sheets'):
                state.setdefault('undoStacks', {'GALMAE': [], 'GIMPO': []})
                state.setdefault('rowBackups', {})
                return _recompute_all(state)
        except Exception:
            pass
    state = _load_seed()
    save_state(conn, state)
    return state


def save_state(conn, state: dict[str, Any]) -> dict[str, Any]:
    now = utcnow()
    conn.execute(
        "INSERT INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (WAREHOUSE_SETTING_KEY, json.dumps(state, ensure_ascii=False), now),
    )
    return state


def update_cell(conn, sheet_name: str, row: int, col: int, value: Any) -> dict[str, Any]:
    state = get_state(conn)
    sheet = state['sheets'].get(sheet_name)
    if not sheet:
        raise ValueError('시트를 찾을 수 없습니다.')
    _ensure_size(sheet, row, col)
    current = sheet['rows'][row - 1][col - 1]
    normalized = _normalize_input(value, current)
    sheet['rows'][row - 1][col - 1] = normalized

    cfg = None
    for item in CFG.values():
        if item['inputSheet'] == sheet_name:
            cfg = item
            break
    if cfg:
        _apply_actions(state, cfg, row, col, normalized)
        _recompute_input_sheet(state, cfg)
    return save_state(conn, state)


def _ensure_size(sheet: dict[str, Any], row: int, col: int):
    while len(sheet['rows']) < row:
        sheet['rows'].append(['' for _ in range(sheet['lastCol'])])
        sheet['styles'].append([{} for _ in range(sheet['lastCol'])])
    while sheet['lastCol'] < col:
        for r in sheet['rows']:
            r.append('')
        for s in sheet['styles']:
            s.append({})
        sheet['lastCol'] += 1
    if sheet.get('lastRow', 0) < row:
        sheet['lastRow'] = row


def _normalize_input(value: Any, current: Any) -> Any:
    if isinstance(current, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {'1', 'true', 'yes', 'on'}
    if isinstance(value, bool):
        return value
    text = '' if value is None else str(value)
    return text


def _sheet_cfg_by_input(sheet_name: str):
    for key, cfg in CFG.items():
        if cfg['inputSheet'] == sheet_name:
            return cfg
    return None


def _cell(sheet: dict[str, Any], row: int, col: int):
    if row < 1 or col < 1:
        return ''
    rows = sheet['rows']
    if row > len(rows) or col > len(rows[row - 1]):
        return ''
    return rows[row - 1][col - 1]


def _set_cell(sheet: dict[str, Any], row: int, col: int, value: Any):
    _ensure_size(sheet, row, col)
    sheet['rows'][row - 1][col - 1] = value


def _style(sheet: dict[str, Any], row: int, col: int) -> dict[str, Any]:
    if row < 1 or col < 1 or row > len(sheet['styles']) or col > len(sheet['styles'][row - 1]):
        return {}
    return sheet['styles'][row - 1][col - 1]


def _set_style(sheet: dict[str, Any], row: int, col: int, updates: dict[str, Any]):
    _ensure_size(sheet, row, col)
    style = dict(sheet['styles'][row - 1][col - 1] or {})
    style.update(updates)
    sheet['styles'][row - 1][col - 1] = style


def _to_bool_strict(value: Any):
    if value is True:
        return True
    if value is False:
        return False
    s = str(value or '').strip().upper()
    if s == 'TRUE':
        return True
    if s == 'FALSE':
        return False
    return None


def _to_int_slot(value: Any, min_value: int = 1, max_value: int = 13):
    try:
        parsed = int(str(value).strip())
    except Exception:
        return None
    if parsed < min_value or parsed > max_value:
        return None
    return parsed


def _slice_col(sheet: dict[str, Any], start_row: int, end_row: int, col: int):
    return [_cell(sheet, row, col) for row in range(start_row, end_row + 1)]


def _write_col(sheet: dict[str, Any], start_row: int, col: int, values: list[Any]):
    for idx, value in enumerate(values, start=start_row):
        _set_cell(sheet, idx, col, value)


def _apply_actions(state: dict[str, Any], cfg: dict[str, Any], row: int, col: int, value: Any):
    sheet = state['sheets'][cfg['inputSheet']]
    prefix = cfg['prefix']
    val_bool = _to_bool_strict(value)
    slot_num = _to_int_slot(value)

    is_delete_checkbox = row == 2 and 9 <= col <= 21
    is_undo_checkbox = row == 3 and col in (19, 22)
    is_row_undo_checkbox = row >= 22 and col == 22

    if is_delete_checkbox and val_bool is True:
        state['undoStacks'].setdefault(prefix, []).append({
            'col': col,
            'dataTop': _slice_col(sheet, 4, 7, col),
            'dataBottom': _slice_col(sheet, 10, 19, col),
        })
        if len(state['undoStacks'][prefix]) > 20:
            state['undoStacks'][prefix] = state['undoStacks'][prefix][-20:]
        for rr in list(range(4, 8)) + list(range(10, 20)):
            _set_cell(sheet, rr, col, '')
        _set_cell(sheet, row, col, False)
        return

    if is_undo_checkbox and val_bool is True:
        stack = state['undoStacks'].setdefault(prefix, [])
        if stack:
            last = stack.pop()
            _write_col(sheet, 4, last['col'], last['dataTop'])
            _write_col(sheet, 10, last['col'], last['dataBottom'])
        _set_cell(sheet, row, col, False)
        return

    if row >= 22 and row != 23 and col in (20, 21) and slot_num is not None:
        target_col = slot_num + 8
        backup_key = f'{prefix}_BACKUP_ROW_{row}'
        state['rowBackups'][backup_key] = {
            'targetCol': target_col,
            'dataTop': _slice_col(sheet, 4, 7, target_col),
            'dataBottom': _slice_col(sheet, 10, 19, target_col),
        }

        src_top = [_cell(sheet, row, c) for c in range(5, 9)]
        src_bottom = [_cell(sheet, row, c) for c in range(10, 20)]

        if col == 20:
            _write_col(sheet, 4, target_col, src_top)
            _write_col(sheet, 10, target_col, [0 if str(v).strip() == '' else v for v in src_bottom])
        else:
            cur_top = _slice_col(sheet, 4, 7, target_col)
            cur_bottom = _slice_col(sheet, 10, 19, target_col)
            appended_top = []
            for old, add in zip(cur_top, src_top):
                old_s = str(old).strip()
                add_s = str(add).strip()
                if not add_s:
                    appended_top.append(old)
                elif not old_s:
                    appended_top.append(add)
                else:
                    appended_top.append(f'{old_s} / {add_s}')
            appended_bottom = []
            for old, add in zip(cur_bottom, src_bottom):
                old_s = str(old).strip()
                add_s = str(add).strip() or '0'
                if not old_s:
                    appended_bottom.append(add_s)
                else:
                    appended_bottom.append(f'{old_s} / {add_s}')
            _write_col(sheet, 4, target_col, appended_top)
            _write_col(sheet, 10, target_col, appended_bottom)

        if row == 22:
            for c in range(5, 20):
                _set_cell(sheet, row, c, '')
        _set_cell(sheet, row, col, '')
        return

    if is_row_undo_checkbox and val_bool is True:
        backup = state['rowBackups'].get(f'{prefix}_BACKUP_ROW_{row}')
        if backup:
            _write_col(sheet, 4, backup['targetCol'], backup['dataTop'])
            _write_col(sheet, 10, backup['targetCol'], backup['dataBottom'])
        _set_cell(sheet, row, col, False)


def _parse_slash_tokens(text: Any) -> list[str]:
    return [token.strip() for token in str(text or '').replace('／', '/').split('/') if token.strip()]


def _recompute_inventory(sheet: dict[str, Any]):
    for row in range(10, 20):
        total = _as_number(_cell(sheet, row, 5))
        lost = _as_number(_cell(sheet, row, 7))
        assigned = 0
        for col in range(9, 22):
            assigned += sum(_as_number(token) for token in _parse_slash_tokens(_cell(sheet, row, col)))
        current = total - assigned - lost
        _set_cell(sheet, row, 6, current)


def _as_number(value: Any) -> float:
    s = str(value or '').strip()
    if not s:
        return 0
    try:
        return float(s)
    except Exception:
        return 0


def _update_range_values(target_sheet: dict[str, Any], row1: int, col1: int, row2: int, col2: int, all_inputs: list[str], input_info_map: dict[str, str], gimpo: bool = False):
    for row in range(row1, row2 + 1):
        for col in range(col1, col2 + 1):
            base_value = str(_cell(target_sheet, row, col)).split('\n')[0].strip()
            style = dict(_style(target_sheet, row, col) or {})
            style['fill'] = 'FFFFFF'
            if not base_value:
                _set_cell(target_sheet, row, col, '')
                _set_style(target_sheet, row, col, style)
                continue
            if not SLOT_RE.match(base_value):
                _set_cell(target_sheet, row, col, base_value)
                _set_style(target_sheet, row, col, style)
                continue
            matched_info = ''
            match_count = 0
            has_direct_main = False
            for input_value in all_inputs:
                if base_value == input_value:
                    matched_info += input_info_map.get(input_value, '')
                    match_count += 1
                    if '-' not in input_value:
                        has_direct_main = True
                elif '-' not in input_value and base_value.startswith(f'{input_value}-'):
                    matched_info += input_info_map.get(input_value, '')
                    match_count += 1
                    has_direct_main = True
                elif '-' in input_value and base_value == input_value.split('-')[0]:
                    matched_info += input_info_map.get(input_value, '')
                    match_count += 1
            if gimpo and base_value in WRAP_SLOTS and matched_info:
                names = [item.strip() for item in matched_info.split('\n') if item.strip()]
                matched_info = '\n' + ' /\n'.join(names) if names else ''
                style['wrap'] = True
            if match_count > 0:
                _set_cell(target_sheet, row, col, f'{base_value}{matched_info}')
                style['fill'] = 'F4CCCC' if ('-' in base_value or has_direct_main or match_count >= 2) else 'D9EAD3'
            else:
                _set_cell(target_sheet, row, col, base_value)
                style['fill'] = '00FF00'
            _set_style(target_sheet, row, col, style)


def _sync_status(state: dict[str, Any], cfg: dict[str, Any]):
    source_sheet = state['sheets'][cfg['inputSheet']]
    target_sheet = state['sheets'][cfg['targetSheet']]
    all_inputs = []
    input_info_map: dict[str, str] = {}
    top_names = [_cell(source_sheet, 4, c) for c in range(9, 22)]
    top_customers = [_cell(source_sheet, 5, c) for c in range(9, 22)]
    top_starts = [_cell(source_sheet, 6, c) for c in range(9, 22)]
    top_ends = [_cell(source_sheet, 7, c) for c in range(9, 22)]
    top_slots = [_cell(source_sheet, 8, c) for c in range(9, 22)]

    for idx, slot_text in enumerate(top_slots):
        tokens = _parse_slash_tokens(slot_text)
        if not tokens:
            continue
        info = '\n' + str(top_names[idx] or '') + '\n' + str(top_customers[idx] or '') + '\n' + str(top_starts[idx] or '') + '\n' + str(top_ends[idx] or '')
        for token in tokens:
            all_inputs.append(token)
            input_info_map[token] = (input_info_map.get(token, '') + info)
    unique_inputs = []
    seen = set()
    for token in all_inputs:
        if token not in seen:
            unique_inputs.append(token)
            seen.add(token)

    start_status, end_status = cfg['statusRange']
    sr1, sc1 = _a1_to_rc(start_status)
    sr2, sc2 = _a1_to_rc(end_status)
    tr1, tc1 = _a1_to_rc(cfg['targetRange'][0])
    tr2, tc2 = _a1_to_rc(cfg['targetRange'][1])

    _update_range_values(target_sheet, tr1, tc1, tr2, tc2, unique_inputs, input_info_map, gimpo=cfg['prefix'] == 'GIMPO')
    _update_range_values(source_sheet, sr1, sc1, sr2, sc2, unique_inputs, input_info_map, gimpo=False)


def _a1_to_rc(a1: str) -> tuple[int, int]:
    match = re.fullmatch(r'([A-Z]+)(\d+)', a1)
    if not match:
        raise ValueError(a1)
    col_letters, row = match.groups()
    col = 0
    for ch in col_letters:
        col = col * 26 + (ord(ch) - 64)
    return int(row), col


def _recompute_input_sheet(state: dict[str, Any], cfg: dict[str, Any]):
    sheet = state['sheets'][cfg['inputSheet']]
    _recompute_inventory(sheet)
    _sync_status(state, cfg)


def _recompute_all(state: dict[str, Any]) -> dict[str, Any]:
    for cfg in CFG.values():
        if cfg['inputSheet'] in state.get('sheets', {}):
            _recompute_input_sheet(state, cfg)
    return state
