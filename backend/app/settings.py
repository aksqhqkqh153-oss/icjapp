from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _split_csv(value: str | None, fallback: list[str]) -> list[str]:
    if not value:
        return fallback
    return [item.strip() for item in value.split(',') if item.strip()]


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
            "http://127.0.0.1:8000",
            "https://www.icj2424app.com",
            "https://icj2424app.com",
            "https://api.icj2424app.com",
        ],
    ))
    r2_account_id: str = field(default_factory=lambda: os.getenv("R2_ACCOUNT_ID", "").strip())
    r2_access_key_id: str = field(default_factory=lambda: os.getenv("R2_ACCESS_KEY_ID", "").strip())
    r2_secret_access_key: str = field(default_factory=lambda: os.getenv("R2_SECRET_ACCESS_KEY", "").strip())
    r2_bucket: str = field(default_factory=lambda: os.getenv("R2_BUCKET", "").strip())
    r2_public_base_url: str = field(default_factory=lambda: os.getenv("R2_PUBLIC_BASE_URL", "").rstrip('/'))
    r2_endpoint: str = field(default_factory=lambda: os.getenv("R2_ENDPOINT", "").strip())
    upload_root: Path = field(default_factory=lambda: Path(os.getenv("LOCAL_UPLOAD_ROOT", str(Path(__file__).resolve().parents[1] / "static" / "uploads"))))
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "20")))
    log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO").upper())

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
