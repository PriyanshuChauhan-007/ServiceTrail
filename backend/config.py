"""Environment configuration; production must explicitly opt into safe deployment values."""
import os
from dataclasses import dataclass
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str = "sqlite:///./backend/data/opsbridge.db"
    environment: str = "development"
    public_origin: str | None = None
    cookie_secure: bool = False
    session_hours: int = 12
    login_limit: int = 10
    login_window_seconds: int = 900
    max_upload_bytes: int = 10 * 1024 * 1024
    max_evidence_per_incident: int = 20
    max_org_evidence_bytes: int = 100 * 1024 * 1024
    field_encryption_key: str | None = None

    @classmethod
    def from_env(cls):
        environment = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).lower()
        origin = os.getenv("PUBLIC_ORIGIN", "").rstrip("/") or None
        secure = os.getenv("COOKIE_SECURE", "true" if environment == "production" else "false").lower() == "true"
        settings = cls(database_url=os.getenv("DATABASE_URL", cls.database_url), environment=environment,
                       public_origin=origin, cookie_secure=secure,
                       field_encryption_key=os.getenv("FIELD_ENCRYPTION_KEY"),
                       max_evidence_per_incident=int(os.getenv("MAX_EVIDENCE_PER_INCIDENT", "20")),
                       max_org_evidence_bytes=int(os.getenv("MAX_ORG_EVIDENCE_BYTES", str(100 * 1024 * 1024))))
        settings.validate()
        return settings

    def validate(self):
        if self.environment not in {"development", "test", "production"}:
            raise RuntimeError("APP_ENV must be development, test or production")
        if self.public_origin:
            parsed = urlsplit(self.public_origin)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
                raise RuntimeError("PUBLIC_ORIGIN must be an exact http(s) origin without a path")
        if self.environment == "production":
            if not self.database_url.startswith(("postgresql://", "postgresql+psycopg://", "postgres://")):
                raise RuntimeError("Production requires an explicit PostgreSQL DATABASE_URL")
            if not self.public_origin or not self.public_origin.startswith("https://") or not self.cookie_secure:
                raise RuntimeError("Production requires HTTPS PUBLIC_ORIGIN and COOKIE_SECURE=true")
            if not self.field_encryption_key:
                raise RuntimeError("Production requires FIELD_ENCRYPTION_KEY")
        if self.field_encryption_key:
            from cryptography.fernet import Fernet
            try:
                Fernet(self.field_encryption_key.encode())
            except (ValueError, TypeError) as exc:
                raise RuntimeError("FIELD_ENCRYPTION_KEY must be a valid Fernet key") from exc
        if self.max_evidence_per_incident < 1 or self.max_org_evidence_bytes < 1:
            raise RuntimeError("Evidence quotas must be positive")
        if self.max_upload_bytes > 10 * 1024 * 1024 or self.max_upload_bytes < 1:
            raise RuntimeError("Upload limit must be between 1 byte and 10 MiB")
