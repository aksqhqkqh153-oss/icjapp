from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from backend.app.db import get_conn, row_to_dict  # type: ignore
from backend.app.main import _clear_ip_login_lock, _clear_user_login_lock, _ensure_login_security_ready, _find_user_by_login_id_ci  # type: ignore


def main() -> int:
    parser = argparse.ArgumentParser(description='Reset login lock state for a user and/or IP.')
    parser.add_argument('--login-id', default='wlgns123', help='login_id to unlock')
    parser.add_argument('--ip', default='', help='ip address to unlock')
    args = parser.parse_args()

    with get_conn() as conn:
        _ensure_login_security_ready(conn)
        result: dict[str, object] = {'ok': True}
        if args.login_id:
            account = _find_user_by_login_id_ci(conn, args.login_id)
            if not account:
                print(f'[WARN] user not found: {args.login_id}')
            else:
                _clear_user_login_lock(conn, int(account['id']))
                fresh = conn.execute(
                    "SELECT id, login_id, email, nickname, failed_login_attempts, blocked_until, account_status, approved, grade FROM users WHERE id = ?",
                    (account['id'],),
                ).fetchone()
                result['user'] = row_to_dict(fresh)
        if args.ip:
            _clear_ip_login_lock(conn, args.ip.strip())
            ip_row = conn.execute(
                "SELECT ip_address, failure_count, blocked_until, updated_at FROM login_ip_blocks WHERE ip_address = ?",
                (args.ip.strip(),),
            ).fetchone()
            result['ip_block'] = row_to_dict(ip_row) if ip_row else {'ip_address': args.ip.strip(), 'cleared': True}
    print(result)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
