"""SQLAlchemy persistence and explicitly versioned schema initialization."""
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import (JSON, Boolean, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint,
                        create_engine, event, inspect, select, text)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool


import time

_last_now_ts = 0.0


def uid():
    return str(uuid4())


def now():
    global _last_now_ts
    t = time.time()
    if t <= _last_now_ts:
        t = _last_now_ts + 0.000001
    _last_now_ts = t
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class SchemaVersion(Base):
    __tablename__ = "schema_versions"
    version: Mapped[int] = mapped_column(primary_key=True)


class SetupLock(Base):
    __tablename__ = "setup_lock"
    id: Mapped[int] = mapped_column(primary_key=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160))


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    role: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_pending: Mapped[str | None] = mapped_column(Text, nullable=True)
    mfa_pending_expires: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mfa_last_counter: Mapped[int] = mapped_column(Integer, default=-1)
    recovery_hashes: Mapped[list] = mapped_column(JSON, default=list)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[int] = mapped_column(Integer)
    id: Mapped[str] = mapped_column(String(36), unique=True, default=uid)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    site_id: Mapped[str] = mapped_column(String(36))


class PasswordRecovery(Base):
    __tablename__ = "password_recoveries"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[int] = mapped_column(Integer)


class AdminAudit(Base):
    __tablename__ = "admin_audit"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    action: Mapped[str] = mapped_column(String(80))
    actor_name: Mapped[str] = mapped_column(String(160))
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    at: Mapped[str] = mapped_column(String(40), default=now)


class WorkMethod(Base):
    __tablename__ = "work_methods"
    __table_args__ = (UniqueConstraint("organization_id", "site_id", "name", "version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    steps: Mapped[list] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(Text)
    incident_id: Mapped[str | None] = mapped_column(ForeignKey("incidents.id"), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    read_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Integration(Base):
    __tablename__ = "integrations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    token_hash: Mapped[str] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (UniqueConstraint("integration_id", "external_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    integration_id: Mapped[str] = mapped_column(ForeignKey("integrations.id"), index=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(160))
    observed_at: Mapped[str] = mapped_column(String(40))
    measurements: Mapped[dict] = mapped_column(JSON)
    fingerprint: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class LoginThrottle(Base):
    __tablename__ = "login_throttles"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_start: Mapped[int] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (UniqueConstraint("organization_id", "site_id", "code"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    code: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(160))
    area: Mapped[str] = mapped_column(String(160))
    criticality: Mapped[str] = mapped_column(String(20))
    manufacturer: Mapped[str | None] = mapped_column(String(160))
    model: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20), default="registered")


class Incident(Base):
    __tablename__ = "incidents"
    __table_args__ = (UniqueConstraint("reporter_id", "client_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    number: Mapped[str] = mapped_column(String(40), unique=True)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id"), index=True)
    reporter_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    assigned_to_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    client_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    create_fingerprint: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer, default=1)
    report_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(40), default="submitted")
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    report: Mapped[dict] = mapped_column(JSON)
    analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    approval: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    checklist: Mapped[list] = mapped_column(JSON, default=list)
    executor_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    due_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    incident_id: Mapped[str] = mapped_column(ForeignKey("incidents.id"), index=True)
    filename: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    sha256: Mapped[str] = mapped_column(String(64))
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    incident_id: Mapped[str] = mapped_column(ForeignKey("incidents.id"), index=True)
    action: Mapped[str] = mapped_column(String(60))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    actor_name: Mapped[str] = mapped_column(String(160))
    actor_role: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    at: Mapped[str] = mapped_column(String(40), default=now)
    report_version: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)


@event.listens_for(AuditEvent, "before_update")
@event.listens_for(AuditEvent, "before_delete")
@event.listens_for(AdminAudit, "before_update")
@event.listens_for(AdminAudit, "before_delete")
@event.listens_for(WorkMethod, "before_update")
@event.listens_for(WorkMethod, "before_delete")
def reject_audit_change(*_):
    raise ValueError("Audit events are append-only")


def make_database(url: str):
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    options = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        from sqlalchemy.engine import make_url
        filename = make_url(url).database
        if filename and filename != ":memory:":
            Path(filename).parent.mkdir(parents=True, exist_ok=True)
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
        if not filename or filename == ":memory:":
            options["poolclass"] = StaticPool
    engine = create_engine(url, **options)
    if engine.dialect.name == "sqlite":
        @event.listens_for(engine, "connect")
        def configure_sqlite(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA busy_timeout=30000")
    return engine, sessionmaker(engine, expire_on_commit=False)


def initialize(engine):
    """Migration 1 is the baseline. Unknown/older unversioned schemas fail closed.

    Future schema changes must add numbered, transactional migrations here; create_all
    is only used on an empty database, never as a pretend ALTER migration.
    """
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(724158190)"))
        else:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        tables = set(inspect(connection).get_table_names())
        if tables and "schema_versions" not in tables:
            raise RuntimeError("Unversioned database; back up and migrate explicitly before starting")
        if "schema_versions" in tables:
            versions = list(connection.execute(select(SchemaVersion.version).order_by(SchemaVersion.version)).scalars())
            if versions not in ([1], [1, 2]):
                raise RuntimeError("Unsupported database schema version; explicit migration required")
            if versions == [1]:
                from .migrations import migration_002
                migration_002(connection)
                connection.execute(SchemaVersion.__table__.insert().values(version=2))
            return
        Base.metadata.create_all(connection)
        connection.execute(SchemaVersion.__table__.insert().values(version=1))
        connection.execute(SchemaVersion.__table__.insert().values(version=2))
        connection.execute(SetupLock.__table__.insert().values(id=1, completed=False))
        if engine.dialect.name == "sqlite":
            for operation in ("UPDATE", "DELETE"):
                connection.exec_driver_sql(f"CREATE TRIGGER audit_no_{operation.lower()} BEFORE {operation} ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END")
        else:
            connection.exec_driver_sql("CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit events are append-only'; END; $$")
            connection.exec_driver_sql("CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()")
        from .migrations import protect_completion_tables
        protect_completion_tables(connection)
