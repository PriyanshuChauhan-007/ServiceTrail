"""Numbered, transactional upgrades. 002 preserves every baseline-1 record."""
from sqlalchemy import select, text


def protect_completion_tables(connection):
    for table in ("admin_audit", "work_methods"):
        if connection.dialect.name == "sqlite":
            for operation in ("UPDATE", "DELETE"):
                connection.exec_driver_sql(f"CREATE TRIGGER {table}_no_{operation.lower()} BEFORE {operation} ON {table} BEGIN SELECT RAISE(ABORT, 'records are append-only'); END")
        else:
            connection.exec_driver_sql(f"CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()")


def migration_002(connection):
    from .database import (AdminAudit, AuthSession, Integration, Notification, Observation,
                           PasswordRecovery, WorkMethod, now, uid)
    boolean = "BOOLEAN"
    columns = {
        "active": f"{boolean} NOT NULL DEFAULT TRUE",
        # Existing accounts retain access; newly provisioned accounts require rotation.
        "must_change_password": f"{boolean} NOT NULL DEFAULT FALSE",
        "mfa_secret": "TEXT", "mfa_pending": "TEXT", "mfa_pending_expires": "INTEGER",
        "mfa_last_counter": "INTEGER NOT NULL DEFAULT -1", "recovery_hashes": "JSON NOT NULL DEFAULT '[]'",
    }
    for name, definition in columns.items():
        connection.exec_driver_sql(f"ALTER TABLE users ADD COLUMN {name} {definition}")
    for name, definition in {"id": "VARCHAR(36)", "created_at": "VARCHAR(40)", "site_id": "VARCHAR(36)"}.items():
        connection.exec_driver_sql(f"ALTER TABLE auth_sessions ADD COLUMN {name} {definition}")
    rows = connection.execute(text("SELECT token_hash, user_id FROM auth_sessions")).all()
    for row in rows:
        connection.execute(text("UPDATE auth_sessions SET id=:id, created_at=:at, site_id=(SELECT site_id FROM users WHERE users.id=:user) WHERE token_hash=:token"),
                           {"id": uid(), "at": now(), "user": row.user_id, "token": row.token_hash})
    connection.exec_driver_sql("CREATE UNIQUE INDEX ix_auth_sessions_public_id ON auth_sessions(id)")
    for model in (PasswordRecovery, AdminAudit, WorkMethod, Notification, Integration, Observation):
        model.__table__.create(connection)
    protect_completion_tables(connection)
