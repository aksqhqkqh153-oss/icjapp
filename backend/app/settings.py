from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
import re


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _split_csv(value: str | None, fallback: list[str]) -> list[str]:
    if not value:
        return fallback
    return [item.strip() for item in value.split(',') if item.strip()]


def _pages_preview_origin_regex() -> str:
    return r"https://([a-z0-9-]+\.)*pages\.dev$"




def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith('#') or '=' not in raw:
            continue
        key, value = raw.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _bootstrap_local_env() -> None:
    base_dir = Path(__file__).resolve().parents[1]
    _load_env_file(base_dir / '.env')
    _load_env_file(base_dir / '.secrets' / 'settlement.local.env')


_bootstrap_local_env()
@dataclass(frozen=True)
class Settings:
    app_env: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    app_public_url: str = field(default_factory=lambda: os.getenv("APP_PUBLIC_URL", "http://127.0.0.1:8000"))
    api_public_url: str = field(default_factory=lambda: os.getenv("API_PUBLIC_URL", "http://127.0.0.1:8000"))
    site_domain: str = field(default_factory=lambda: os.getenv("SITE_DOMAIN", "www.icj2424app.com"))
    policy_url: str = field(default_factory=lambda: os.getenv("POLICY_URL", "https://www.icj2424app.com/privacy-policy"))
    account_deletion_url: str = field(default_factory=lambda: os.getenv("ACCOUNT_DELETION_URL", "https://www.icj2424app.com/account-deletion"))
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "").strip())
    sqlite_db_path: str = field(default_factory=lambda: os.getenv("SQLITE_DB_PATH", ""))
    email_demo_mode: bool = field(default_factory=lambda: _as_bool(os.getenv("EMAIL_DEMO_MODE", "1"), True))
    seed_demo_data: bool = field(default_factory=lambda: _as_bool(os.getenv("SEED_DEMO_DATA", "1"), True))
    allowed_origins: list[str] = field(default_factory=lambda: _split_csv(
        os.getenv("ALLOWED_ORIGINS"),
        [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "https://www.icj2424app.com",
            "https://icj2424app.com",
            "https://api.icj2424app.com",
        ],
    ))
    allowed_origin_regex: str = field(default_factory=lambda: os.getenv("ALLOWED_ORIGIN_REGEX", _pages_preview_origin_regex()).strip())
    r2_account_id: str = field(default_factory=lambda: os.getenv("R2_ACCOUNT_ID", "").strip())
    r2_access_key_id: str = field(default_factory=lambda: os.getenv("R2_ACCESS_KEY_ID", "").strip())
    r2_secret_access_key: str = field(default_factory=lambda: os.getenv("R2_SECRET_ACCESS_KEY", "").strip())
    r2_bucket: str = field(default_factory=lambda: os.getenv("R2_BUCKET", "").strip())
    r2_public_base_url: str = field(default_factory=lambda: os.getenv("R2_PUBLIC_BASE_URL", "").rstrip('/'))
    r2_endpoint: str = field(default_factory=lambda: os.getenv("R2_ENDPOINT", "").strip())
    upload_root: Path = field(default_factory=lambda: Path(os.getenv("LOCAL_UPLOAD_ROOT", str(Path(__file__).resolve().parents[1] / "static" / "uploads"))))
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "20")))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO").upper())
    schedule_timezone: str = field(default_factory=lambda: os.getenv("SCHEDULE_TIMEZONE", "Asia/Seoul").strip())
    settlement_sync_enabled: bool = field(default_factory=lambda: _as_bool(os.getenv("SETTLEMENT_SYNC_ENABLED", "1"), True))
    settlement_sync_start_hour: int = field(default_factory=lambda: int(os.getenv("SETTLEMENT_SYNC_START_HOUR", "9")))
    settlement_sync_end_hour: int = field(default_factory=lambda: int(os.getenv("SETTLEMENT_SYNC_END_HOUR", "18")))
    settlement_sync_random_min_minutes: int = field(default_factory=lambda: int(os.getenv("SETTLEMENT_SYNC_RANDOM_MIN_MINUTES", "30")))
    settlement_sync_random_max_minutes: int = field(default_factory=lambda: int(os.getenv("SETTLEMENT_SYNC_RANDOM_MAX_MINUTES", "60")))
    settlement_playwright_headless: bool = field(default_factory=lambda: _as_bool(os.getenv("SETTLEMENT_PLAYWRIGHT_HEADLESS", "1"), True))
    settlement_playwright_timeout_ms: int = field(default_factory=lambda: int(os.getenv("SETTLEMENT_PLAYWRIGHT_TIMEOUT_MS", "30000")))
    settlement_runtime_dir: Path = field(default_factory=lambda: Path(os.getenv("SETTLEMENT_RUNTIME_DIR", str(Path(__file__).resolve().parents[1] / "runtime"))))
    settlement_auth_state_path: str = field(default_factory=lambda: os.getenv("SETTLEMENT_AUTH_STATE_PATH", str(Path(__file__).resolve().parents[1] / "playwright" / ".auth" / "soomgo-state.json")).strip())
    soomgo_login_url: str = field(default_factory=lambda: os.getenv("SOOMGO_LOGIN_URL", "https://soomgo.com/login").strip())
    soomgo_email: str = field(default_factory=lambda: os.getenv("SOOMGO_EMAIL", "").strip())
    soomgo_password: str = field(default_factory=lambda: os.getenv("SOOMGO_PASSWORD", "").strip())
    soomgo_value_xpath: str = field(default_factory=lambda: os.getenv("SOOMGO_VALUE_XPATH", '//*[@id="__next"]/main/div/div[2]/div[2]/div[1]/p[1]').strip())
    soomgo_target_urls: list[str] = field(default_factory=lambda: _split_csv(os.getenv("SOOMGO_TARGET_URLS"), ["https://soomgo.com/instant-match/65839", "https://soomgo.com/instant-match/57259", "https://soomgo.com/instant-match/229276"]))


    @property
    def r2_enabled(self) -> bool:
        return bool(
            self.r2_account_id
            and self.r2_access_key_id
            and self.r2_secret_access_key
            and self.r2_bucket
            and self.r2_public_base_url
        )

    @property
    def resolved_r2_endpoint(self) -> str:
        if self.r2_endpoint:
            return self.r2_endpoint
        if not self.r2_account_id:
            return ""
        return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"


settings = Settings()
