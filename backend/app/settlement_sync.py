from __future__ import annotations

import json
import logging
import random
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .db import get_conn, utcnow
from .settings import settings, get_settings

logger = logging.getLogger('icj24app.settlement_sync')


def _runtime_settings():
    return get_settings()


def _kst():
    cfg = _runtime_settings()
    return ZoneInfo(cfg.schedule_timezone or 'Asia/Seoul')


@dataclass
class SyncResult:
    ok: bool
    platform: str
    value: int
    detail: list[dict[str, Any]]
    message: str
    updated_at: str


def _safe_int_from_text(text: str) -> int:
    digits = re.findall(r"\d+", text.replace(',', ''))
    if not digits:
        raise ValueError(f'숫자를 찾지 못했습니다: {text!r}')
    return int(''.join(digits))


def _load_saved_credentials() -> tuple[str, str]:
    try:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT secret_key, secret_value FROM app_secrets WHERE secret_key IN ('soomgo_email', 'soomgo_password')"
            ).fetchall()
    except Exception:
        logger.exception('failed to load saved settlement credentials')
        return '', ''
    values = {row['secret_key']: (row['secret_value'] or '').strip() for row in rows}
    return values.get('soomgo_email', ''), values.get('soomgo_password', '')




def _load_saved_auth_state() -> str:
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT secret_value FROM app_secrets WHERE secret_key = 'soomgo_storage_state'"
            ).fetchone()
    except Exception:
        logger.exception('failed to load saved settlement auth state')
        return ''
    return (row['secret_value'] or '').strip() if row else ''


def save_auth_state_json(raw_text: str) -> dict[str, Any]:
    text = (raw_text or '').strip()
    if not text:
        raise RuntimeError('인증 세션 JSON이 비어 있습니다.')
    try:
        data = json.loads(text)
    except Exception as exc:
        raise RuntimeError('인증 세션 JSON 형식이 올바르지 않습니다.') from exc
    if not isinstance(data, dict):
        raise RuntimeError('인증 세션 JSON 루트는 객체여야 합니다.')
    cookies = data.get('cookies') or []
    origins = data.get('origins') or []
    if not isinstance(cookies, list) or not isinstance(origins, list):
        raise RuntimeError('인증 세션 JSON 형식이 올바르지 않습니다.')
    compact = json.dumps({'cookies': cookies, 'origins': origins}, ensure_ascii=False)
    now_iso = utcnow()
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO app_secrets(secret_key, secret_value, updated_at) VALUES (?, ?, ?)",
            ('soomgo_storage_state', compact, now_iso),
        )
    cfg = _runtime_settings()
    auth_state_path = Path(cfg.settlement_auth_state_path)
    auth_state_path.parent.mkdir(parents=True, exist_ok=True)
    auth_state_path.write_text(compact, encoding='utf-8')
    return {
        'saved': True,
        'updated_at': now_iso,
        'cookie_count': len(cookies),
        'origin_count': len(origins),
    }


def _restore_auth_state_file() -> bool:
    cfg = _runtime_settings()
    auth_state_path = Path(cfg.settlement_auth_state_path)
    raw = _load_saved_auth_state()
    if not raw:
        return auth_state_path.exists()
    auth_state_path.parent.mkdir(parents=True, exist_ok=True)
    auth_state_path.write_text(raw, encoding='utf-8')
    return True

def _credential_summary() -> dict[str, str | bool]:
    cfg = _runtime_settings()
    email = (cfg.soomgo_email or '').strip()
    password = (cfg.soomgo_password or '').strip()
    email_source = cfg.soomgo_email_env_name or ''
    password_source = cfg.soomgo_password_env_name or ''
    if not email or not password:
        saved_email, saved_password = _load_saved_credentials()
        if saved_email:
            email = saved_email
            email_source = 'db_saved'
        if saved_password:
            password = saved_password
            password_source = 'db_saved'
    auth_state_present = bool(_load_saved_auth_state())
    return {
        'configured': bool(email and password),
        'email_env': email_source,
        'password_env': password_source,
        'email_present': bool(email),
        'password_present': bool(password),
        'auth_state_present': auth_state_present,
    }


class SettlementSyncService:
    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._run_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._is_running = False
        self._last_started_at = ''
        self._last_finished_at = ''
        self._last_message = '대기중'
        self._last_ok = None
        self._next_run_at = ''
        self._last_final_sync_date = ''

    def start(self):
        cfg = _runtime_settings()
        if not cfg.settlement_sync_enabled:
            logger.info('settlement sync disabled by environment')
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._plan_next_run(reason='startup')
        self._thread = threading.Thread(target=self._loop, name='settlement-sync-loop', daemon=True)
        self._thread.start()
        logger.info('settlement sync background thread started')

    def stop(self):
        self._stop_event.set()

    def status(self) -> dict[str, Any]:
        with self._state_lock:
            base = {
                'enabled': _runtime_settings().settlement_sync_enabled,
                'is_running': self._is_running,
                'last_started_at': self._last_started_at,
                'last_finished_at': self._last_finished_at,
                'last_message': self._last_message,
                'last_ok': self._last_ok,
                'next_run_at': self._next_run_at,
                'window': {
                    'timezone': _runtime_settings().schedule_timezone,
                    'weekdays': ['월', '화', '수', '목', '금'],
                    'start_hour': _runtime_settings().settlement_sync_start_hour,
                    'end_hour': _runtime_settings().settlement_sync_end_hour,
                    'random_min_minutes': _runtime_settings().settlement_sync_random_min_minutes,
                    'random_max_minutes': _runtime_settings().settlement_sync_random_max_minutes,
                },
                'config': _credential_summary(),
            }
        base['platforms'] = self.fetch_latest_metrics()
        return base

    def fetch_latest_metrics(self) -> dict[str, Any]:
        items: dict[str, Any] = {}
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT platform, metric_key, metric_value, detail_json, sync_status, sync_message, updated_at
                FROM settlement_platform_metrics
                WHERE metric_key = 'platform_send_count'
                ORDER BY platform
                """
            ).fetchall()
        for row in rows:
            detail = []
            try:
                detail = json.loads(row['detail_json'] or '[]')
            except Exception:
                detail = []
            items[row['platform']] = {
                'platform': row['platform'],
                'metric_key': row['metric_key'],
                'value': int(row['metric_value'] or 0),
                'detail': detail,
                'sync_status': row['sync_status'] or 'idle',
                'sync_message': row['sync_message'] or '',
                'updated_at': row['updated_at'] or '',
            }
        for name in ('숨고', '오늘', '공홈'):
            items.setdefault(name, {
                'platform': name,
                'metric_key': 'platform_send_count',
                'value': 0,
                'detail': [],
                'sync_status': 'idle',
                'sync_message': '데이터 없음',
                'updated_at': '',
            })
        return items

    def run_once(self, trigger: str = 'manual') -> dict[str, Any]:
        cfg = _runtime_settings()
        if not cfg.settlement_sync_enabled:
            raise RuntimeError('결산 자동 연동 기능이 비활성화되어 있습니다.')
        acquired = self._run_lock.acquire(blocking=False)
        if not acquired:
            raise RuntimeError('이미 데이터 연동이 진행 중입니다. 잠시 후 다시 시도해 주세요.')
        try:
            self._set_running(True, f'{trigger} 연동 시작')
            self._last_started_at = utcnow()
            result = self._sync_soomgo_platform_count(trigger=trigger)
            self._store_result(result, trigger=trigger)
            self._last_finished_at = utcnow()
            self._last_ok = result.ok
            self._last_message = result.message
            if trigger != 'manual':
                self._plan_next_run(reason='post-sync')
            return self.status()
        except Exception as exc:
            logger.exception('settlement sync failed: %s', exc)
            now_iso = utcnow()
            self._last_finished_at = now_iso
            self._last_ok = False
            self._last_message = f'연동 실패: {exc}'
            self._store_failure('숨고', str(exc), now_iso, trigger=trigger)
            if trigger != 'manual':
                self._plan_next_run(reason='error')
            raise
        finally:
            self._set_running(False, self._last_message)
            self._run_lock.release()

    def _set_running(self, running: bool, message: str):
        with self._state_lock:
            self._is_running = running
            self._last_message = message

    def _store_failure(self, platform: str, message: str, now_iso: str, trigger: str):
        detail_json = json.dumps([{'trigger': trigger, 'message': message}], ensure_ascii=False)
        with get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO settlement_platform_metrics(platform, metric_key, metric_value, detail_json, sync_status, sync_message, updated_at)
                VALUES (?, 'platform_send_count', 0, ?, 'error', ?, ?)
                """,
                (platform, detail_json, message[:500], now_iso),
            )
            conn.execute(
                """
                INSERT INTO settlement_sync_history(platform, trigger_type, sync_status, metric_value, detail_json, message, created_at)
                VALUES (?, ?, 'error', 0, ?, ?, ?)
                """,
                (platform, trigger, detail_json, message[:500], now_iso),
            )

    def _store_result(self, result: SyncResult, trigger: str):
        detail_json = json.dumps(result.detail, ensure_ascii=False)
        status = 'success' if result.ok else 'error'
        with get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO settlement_platform_metrics(platform, metric_key, metric_value, detail_json, sync_status, sync_message, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (result.platform, 'platform_send_count', result.value, detail_json, status, result.message[:500], result.updated_at),
            )
            conn.execute(
                """
                INSERT INTO settlement_sync_history(platform, trigger_type, sync_status, metric_value, detail_json, message, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (result.platform, trigger, status, result.value, detail_json, result.message[:500], result.updated_at),
            )

    def _loop(self):
        while not self._stop_event.is_set():
            try:
                if self._should_run_now():
                    try:
                        self.run_once(trigger='schedule')
                    except Exception:
                        pass
            except Exception:
                logger.exception('settlement sync loop error')
            self._stop_event.wait(30)

    def _now(self) -> datetime:
        return datetime.now(_kst())

    def _is_business_day(self, current: datetime) -> bool:
        return current.weekday() < 5

    def _window_open_dt(self, current: datetime) -> datetime:
        cfg = _runtime_settings()
        return current.replace(hour=cfg.settlement_sync_start_hour, minute=0, second=0, microsecond=0)

    def _window_final_dt(self, current: datetime) -> datetime:
        cfg = _runtime_settings()
        return current.replace(hour=cfg.settlement_sync_end_hour, minute=0, second=0, microsecond=0)

    def _next_business_start(self, current: datetime) -> datetime:
        probe = current
        while True:
            cfg = _runtime_settings()
            probe = (probe + timedelta(days=1)).replace(hour=cfg.settlement_sync_start_hour, minute=0, second=0, microsecond=0)
            if self._is_business_day(probe):
                return probe

    def _plan_next_run(self, reason: str):
        now = self._now()
        with self._state_lock:
            if not self._is_business_day(now):
                next_dt = self._next_business_start(now)
            else:
                start_dt = self._window_open_dt(now)
                final_dt = self._window_final_dt(now)
                if now < start_dt:
                    next_dt = start_dt + timedelta(minutes=random.randint(0, 10))
                elif now >= final_dt:
                    next_dt = self._next_business_start(now)
                else:
                    cfg = _runtime_settings()
                    delta = timedelta(minutes=random.randint(cfg.settlement_sync_random_min_minutes, cfg.settlement_sync_random_max_minutes))
                    candidate = now + delta
                    if candidate >= final_dt:
                        next_dt = final_dt
                    else:
                        next_dt = candidate
            self._next_run_at = next_dt.isoformat()
            logger.info('settlement next run planned reason=%s at=%s', reason, self._next_run_at)

    def _should_run_now(self) -> bool:
        if not _runtime_settings().settlement_sync_enabled:
            return False
        now = self._now()
        if not self._is_business_day(now):
            return False
        start_dt = self._window_open_dt(now)
        final_dt = self._window_final_dt(now)
        if now < start_dt:
            return False
        today_key = now.date().isoformat()
        if now >= final_dt:
            if self._last_final_sync_date == today_key:
                return False
            self._last_final_sync_date = today_key
            return True
        with self._state_lock:
            if not self._next_run_at:
                self._plan_next_run(reason='empty')
                return False
            try:
                next_dt = datetime.fromisoformat(self._next_run_at)
            except Exception:
                self._plan_next_run(reason='parse-fail')
                return False
        return now >= next_dt

    def _ensure_login(self, page, context):
        cfg = _runtime_settings()
        summary = _credential_summary()
        email = (cfg.soomgo_email or '').strip()
        password = (cfg.soomgo_password or '').strip()
        if summary.get('email_env') == 'db_saved' or summary.get('password_env') == 'db_saved' or not email or not password:
            saved_email, saved_password = _load_saved_credentials()
            email = email or saved_email
            password = password or saved_password
        if not email or not password:
            raise RuntimeError(f'숨고 계정 정보가 설정되지 않았습니다. 현재 감지된 변수: email={summary.get("email_env") or "없음"}, password={summary.get("password_env") or "없음"}. Railway Variables가 컨테이너에 주입되지 않는 경우 결산자료 화면에서 숨고 계정을 직접 저장해 사용할 수 있습니다.')

        login_url = cfg.soomgo_login_url.strip() or 'https://soomgo.com/login'
        page.goto(login_url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
        page.wait_for_timeout(1500)

        email_selectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[autocomplete="username"]',
            'input[name="id"]',
            'input[placeholder*="이메일"]',
        ]
        password_selectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[autocomplete="current-password"]',
        ]
        submit_selectors = [
            'button[type="submit"]',
            'button:has-text("로그인")',
            'button:has-text("Login")',
            'input[type="submit"]',
        ]

        email_filled = False
        for selector in email_selectors:
            loc = page.locator(selector)
            if loc.count() > 0:
                try:
                    target = loc.first
                    target.click(timeout=2000)
                    try:
                        target.press('Control+A', timeout=1000)
                        target.press('Delete', timeout=1000)
                    except Exception:
                        pass
                    target.type(email, delay=random.randint(45, 110), timeout=4000)
                    email_filled = True
                    break
                except Exception:
                    continue
        if not email_filled:
            raise RuntimeError('숨고 로그인 이메일 입력창을 찾지 못했습니다.')

        password_filled = False
        for selector in password_selectors:
            loc = page.locator(selector)
            if loc.count() > 0:
                try:
                    target = loc.first
                    target.click(timeout=2000)
                    try:
                        target.press('Control+A', timeout=1000)
                        target.press('Delete', timeout=1000)
                    except Exception:
                        pass
                    target.type(password, delay=random.randint(45, 110), timeout=4000)
                    password_filled = True
                    break
                except Exception:
                    continue
        if not password_filled:
            raise RuntimeError('숨고 로그인 비밀번호 입력창을 찾지 못했습니다.')

        submitted = False
        for selector in submit_selectors:
            loc = page.locator(selector)
            if loc.count() > 0:
                try:
                    loc.first.click(timeout=3000)
                    submitted = True
                    break
                except Exception:
                    continue
        if not submitted:
            page.keyboard.press('Enter')

        page.wait_for_timeout(3000)
        if 'login' in page.url.lower() or page.locator('input[type="password"]').count() > 0:
            raise RuntimeError('숨고 로그인 이후에도 로그인 화면이 유지됩니다. 추가 인증/캡차 여부를 확인해 주세요.')
        auth_state_path = Path(cfg.settlement_auth_state_path)
        _restore_auth_state_file()
        auth_state_path.parent.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(auth_state_path))
        try:
            save_auth_state_json(auth_state_path.read_text(encoding='utf-8'))
        except Exception:
            logger.exception('failed to persist auth state into db after login')

    def _sync_soomgo_platform_count(self, trigger: str) -> SyncResult:
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            raise RuntimeError('playwright 가 설치되지 않았습니다. backend requirements 설치 후 playwright install chromium 을 실행해 주세요.') from exc

        cfg = _runtime_settings()
        urls = [u.strip() for u in cfg.soomgo_target_urls if str(u).strip()]
        if not urls:
            raise RuntimeError('숨고 대상 URL이 설정되지 않았습니다.')

        auth_state_path = Path(cfg.settlement_auth_state_path)
        _restore_auth_state_file()
        screenshot_dir = Path(cfg.settlement_runtime_dir) / 'settlement_sync'
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        total = 0
        detail: list[dict[str, Any]] = []
        now_iso = utcnow()
        xpath = cfg.soomgo_value_xpath.strip() or '//*[@id="__next"]/main/div/div[2]/div[2]/div[1]/p[1]'
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=cfg.settlement_playwright_headless)
            context_kwargs: dict[str, Any] = {}
            if auth_state_path.exists():
                context_kwargs['storage_state'] = str(auth_state_path)
            context = browser.new_context(**context_kwargs)
            page = context.new_page()
            page.set_default_timeout(cfg.settlement_playwright_timeout_ms)
            for index, url in enumerate(urls):
                page.goto(url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
                page.wait_for_timeout(1500)
                if 'login' in page.url.lower() or page.locator('input[type="password"]').count() > 0:
                    self._ensure_login(page, context)
                    page.goto(url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
                    page.wait_for_timeout(1500)
                locator = page.locator(f'xpath={xpath}')
                text = locator.first.inner_text().strip()
                value = _safe_int_from_text(text)
                total += value
                shot_path = screenshot_dir / f'soomgo_{index + 1}.png'
                try:
                    page.screenshot(path=str(shot_path), full_page=False)
                except Exception:
                    pass
                detail.append({'url': url, 'raw_text': text, 'value': value})
            context.storage_state(path=str(auth_state_path))
            try:
                save_auth_state_json(auth_state_path.read_text(encoding='utf-8'))
            except Exception:
                logger.exception('failed to persist auth state into db after sync')
        try:
            save_auth_state_json(auth_state_path.read_text(encoding='utf-8'))
        except Exception:
            logger.exception('failed to persist auth state into db after login')
            context.close()
            browser.close()
        message = f'숨고 발송 건수 합계 {total}건 동기화 완료'
        return SyncResult(ok=True, platform='숨고', value=total, detail=detail, message=message, updated_at=now_iso)


settlement_sync_service = SettlementSyncService()
