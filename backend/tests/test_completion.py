"""Completion contract regressions against real transactions, tokens and encrypted fields."""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.engine import make_url
from uuid import uuid4

from backend.config import Settings
from backend.database import (AdminAudit, AuthSession, Base, Evidence, Incident, Integration,
                              Notification, Observation, Organization, PasswordRecovery,
                              SchemaVersion, Site, User, WorkMethod, initialize, make_database)
from backend.main import create_app
from backend.security import COOKIE, field_cipher, token_hash, totp
from backend.tests.test_workflow import (PASSWORD, PREFIX, action, approve, bootstrap,
                                         env, ok, png, report, sign_in)


@pytest.fixture
def mfa_clock(monkeypatch):
    fixed = int(time.time())
    monkeypatch.setattr("backend.security.time.time", lambda: fixed)
    return fixed


@pytest.fixture(params=["sqlite", "postgresql"])
def migration_database(request, tmp_path):
    if request.param == "sqlite":
        engine, _ = make_database(f"sqlite:///{tmp_path / 'baseline1.db'}")
        yield engine
        engine.dispose()
        return
    if not os.getenv("TEST_POSTGRES_URL"):
        pytest.skip("TEST_POSTGRES_URL not configured; PostgreSQL migration upgrade not tested")
    root_url = os.environ["TEST_POSTGRES_URL"]
    root, _ = make_database(root_url)
    schema = "migration_" + uuid4().hex
    with root.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = make_url(root_url).update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)
    engine, _ = make_database(url)
    try:
        yield engine
    finally:
        engine.dispose()
        with root.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        root.dispose()


def test_initial_rotation_password_change_and_public_session_revocation(env):
    admin = env["admin"]
    user = ok(admin.post(PREFIX + "/users", json={"name": "New", "email": "new@example.test",
                  "password": PASSWORD, "role": "worker"}), 201)
    assert user["active"] and user["must_change_password"] and not user["mfa_enabled"]
    client, other = TestClient(env["app"]), TestClient(env["app"])
    for browser in (client, other):
        ok(browser.post(PREFIX + "/auth/login", json={"email": user["email"], "password": PASSWORD}))
    assert client.post(PREFIX + "/incidents", json={}).status_code == 403
    assert client.post(PREFIX + "/auth/switch-site", json={"site_id": user["site_id"]}).status_code == 403
    assert client.post(PREFIX + "/auth/change-password", json={"current_password": "wrong", "new_password": PASSWORD + " new"}).status_code == 401
    assert client.post(PREFIX + "/auth/change-password", json={"current_password": PASSWORD, "new_password": PASSWORD}).status_code == 422
    token = client.cookies.get(COOKIE)
    sessions = ok(client.get(PREFIX + "/auth/sessions"))
    assert len(sessions) == 2 and sum(item["current"] for item in sessions) == 1
    assert all(item["id"] not in {token, token_hash(token)} for item in sessions)
    assert admin.delete(PREFIX + "/auth/sessions/" + sessions[0]["id"]).status_code == 404
    changed = ok(client.post(PREFIX + "/auth/change-password", json={"current_password": PASSWORD, "new_password": PASSWORD + " new"}))
    assert not changed["user"]["must_change_password"]
    assert client.cookies.get(COOKIE) == token and other.get(PREFIX + "/auth/me").status_code == 401
    assert other.post(PREFIX + "/auth/login", json={"email": user["email"], "password": PASSWORD}).status_code == 401
    ok(other.post(PREFIX + "/auth/login", json={"email": user["email"], "password": PASSWORD + " new"}))
    sessions = ok(client.get(PREFIX + "/auth/sessions"))
    other_id = next(item["id"] for item in sessions if not item["current"])
    ok(client.delete(PREFIX + "/auth/sessions/" + other_id))
    assert other.get(PREFIX + "/auth/me").status_code == 401
    ok(other.post(PREFIX + "/auth/login", json={"email": user["email"], "password": PASSWORD + " new"}))
    ok(client.post(PREFIX + "/auth/sessions/revoke-others"))
    assert other.get(PREFIX + "/auth/me").status_code == 401
    assert client.get(PREFIX + "/auth/me").status_code == 200


def enroll(client, password):
    pending = ok(client.post(PREFIX + "/auth/mfa/enroll", json={"password": password}))
    codes = ok(client.post(PREFIX + "/auth/mfa/confirm", json={"otp": totp(pending["secret"])}))["recovery_codes"]
    return pending["secret"], codes


def test_mfa_encrypted_pending_replay_recovery_reset_and_disable(env, mfa_clock):
    admin, app = env["admin"], env["app"]
    other = sign_in(app, "admin@example.test")
    assert admin.post(PREFIX + "/auth/mfa/enroll", json={"password": "wrong"}).status_code == 401
    pending = ok(admin.post(PREFIX + "/auth/mfa/enroll", json={"password": PASSWORD}))
    secret = pending["secret"]
    assert secret in pending["otpauth_uri"] and pending["otpauth_uri"].startswith("otpauth://totp/")
    with app.state.sessions() as db:
        user = db.get(User, env["users"]["admin"]["id"])
        assert user.mfa_pending != secret and secret not in user.mfa_pending
        assert field_cipher(env["settings"]).decrypt(user.mfa_pending.encode()).decode() == secret
        assert user.mfa_pending_expires <= int(time.time()) + 600
    codes = ok(admin.post(PREFIX + "/auth/mfa/confirm", json={"otp": totp(secret)}))["recovery_codes"]
    assert len(set(codes)) == 10
    assert other.get(PREFIX + "/auth/me").status_code == 401
    assert admin.post(PREFIX + "/auth/mfa/confirm", json={"otp": totp(secret)}).status_code == 409
    assert ok(admin.get(PREFIX + "/auth/me"))["user"]["mfa_enabled"]
    credentials = {"email": "admin@example.test", "password": PASSWORD}
    response = other.post(PREFIX + "/auth/login", json=credentials)
    assert response.status_code == 401 and response.json()["detail"] == "MFA code required"
    assert other.post(PREFIX + "/auth/login", json={**credentials, "otp": totp(secret)}).status_code == 401
    ok(other.post(PREFIX + "/auth/login", json={**credentials, "recovery_code": codes[0]}))
    third = TestClient(app)
    assert third.post(PREFIX + "/auth/login", json={**credentials, "recovery_code": codes[0]}).status_code == 401
    with app.state.sessions() as db:
        user = db.get(User, env["users"]["admin"]["id"])
        assert token_hash(codes[0]) not in user.recovery_hashes
        assert all(code not in json.dumps(user.recovery_hashes) for code in codes)
        assert user.mfa_pending is None and user.mfa_pending_expires is None
    assert admin.post(PREFIX + "/auth/change-password", json={"current_password": PASSWORD, "new_password": PASSWORD + " changed"}).status_code == 401
    recovery = ok(admin.post(f'{PREFIX}/users/{env["users"]["admin"]["id"]}/recovery'))
    assert recovery["token"] not in json.dumps(ok(admin.get(PREFIX + "/admin/audit")))
    with app.state.sessions() as db:
        assert db.get(PasswordRecovery, recovery["token"]) is None
        assert db.get(PasswordRecovery, token_hash(recovery["token"])) is not None
    ok(third.post(PREFIX + "/auth/reset-password", json={"token": recovery["token"], "new_password": PASSWORD + " reset"}))
    assert admin.get(PREFIX + "/auth/me").status_code == 401
    assert other.get(PREFIX + "/auth/me").status_code == 401
    assert third.post(PREFIX + "/auth/reset-password", json={"token": recovery["token"], "new_password": PASSWORD}).status_code == 401
    credentials["password"] = PASSWORD + " reset"
    assert third.post(PREFIX + "/auth/login", json=credentials).json()["detail"] == "MFA code required"
    ok(third.post(PREFIX + "/auth/login", json={**credentials, "recovery_code": codes[1]}))
    assert third.post(PREFIX + "/auth/mfa/disable", json={"password": credentials["password"], "otp": totp(secret)}).status_code == 401
    # A different RFC6238 counter is accepted once, then cannot be reused.
    fresh_otp = totp(secret, int(time.time()) // 30 + 1)
    ok(third.post(PREFIX + "/auth/mfa/disable", json={"password": credentials["password"], "otp": fresh_otp}))
    assert not ok(third.get(PREFIX + "/auth/me"))["user"]["mfa_enabled"]
    ok(other.post(PREFIX + "/auth/login", json=credentials))
    serialized = json.dumps(ok(third.get(PREFIX + "/admin/audit")))
    assert secret not in serialized and not any(code in serialized for code in codes)
    assert PASSWORD not in serialized and "mfa.disabled" in serialized


def test_rfc6238_sha1_known_vector():
    # RFC6238 appendix B's SHA1 secret at Unix second 59; six-digit variant.
    assert totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59 // 30) == "287082"


def test_totp_login_and_recovery_are_atomic_and_password_change_requires_new_otp(env, mfa_clock):
    worker, app = env["worker"], env["app"]
    password = PASSWORD + " rotated"
    secret, codes = enroll(worker, password)
    one, two = TestClient(app), TestClient(app)
    credentials = {"email": "worker@example.test", "password": password}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda client: client.post(PREFIX + "/auth/login", json={**credentials, "recovery_code": codes[0]}), (one, two)))
    assert sorted(result.status_code for result in results) == [200, 401]
    # Accept the next time-step once at login, rejecting its replay at a second login.
    current = int(time.time()) // 30
    next_otp = totp(secret, current + 1)
    ok(one.post(PREFIX + "/auth/login", json={**credentials, "otp": next_otp}))
    assert two.post(PREFIX + "/auth/login", json={**credentials, "otp": next_otp}).status_code == 401
    assert one.post(PREFIX + "/auth/change-password", json={"current_password": password, "new_password": password + " again", "otp": next_otp}).status_code == 401
    # Move the persisted counter to an earlier, valid state to test an independently
    # authenticated password change without waiting for a real 30-second boundary.
    with app.state.sessions() as db:
        db.get(User, env["users"]["worker"]["id"]).mfa_last_counter = current - 1
        db.commit()
    token = one.cookies.get(COOKIE)
    ok(one.post(PREFIX + "/auth/change-password", json={"current_password": password, "new_password": password + " again", "otp": totp(secret, current)}))
    assert one.cookies.get(COOKIE) == token
    assert worker.get(PREFIX + "/auth/me").status_code == 401
    assert ok(one.get(PREFIX + "/auth/me"))["user"]["mfa_enabled"]


def test_mfa_failure_rate_limit_survives_restart_and_pending_expires(tmp_path, mfa_clock):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'mfa.db'}", environment="test", login_limit=2)
    app = create_app(settings)
    with TestClient(app) as admin:
        user = ok(bootstrap(admin), 201)["user"]
        secret, _ = enroll(admin, PASSWORD)
        for _ in range(2):
            assert admin.post(PREFIX + "/auth/mfa/disable", json={"password": PASSWORD, "otp": totp(secret)}).status_code == 401
        assert admin.post(PREFIX + "/auth/mfa/disable", json={"password": PASSWORD, "otp": totp(secret, int(time.time()) // 30 + 1)}).status_code == 429
        cookie = admin.cookies.get(COOKIE)
    with TestClient(create_app(settings)) as fresh:
        fresh.cookies.set(COOKIE, cookie)
        assert fresh.post(PREFIX + "/auth/mfa/disable", json={"password": PASSWORD, "otp": totp(secret)}).status_code == 429
    with app.state.sessions() as db:
        account = db.get(User, user["id"])
        account.mfa_secret, account.mfa_last_counter = None, -1
        account.mfa_pending = field_cipher(settings).encrypt(secret.encode()).decode()
        account.mfa_pending_expires = 0
        db.commit()
    with TestClient(create_app(settings)) as fresh:
        fresh.cookies.set(COOKIE, cookie)
        assert fresh.post(PREFIX + "/auth/mfa/confirm", json={"otp": totp(secret)}).status_code == 409


def test_admin_deactivation_roles_one_use_expiring_recovery_and_audit(env):
    admin, worker = env["admin"], env["worker"]
    worker_id, admin_id = env["users"]["worker"]["id"], env["users"]["admin"]["id"]
    assert worker.patch(f"{PREFIX}/users/{admin_id}", json={"role": "worker"}).status_code == 403
    for update in ({"active": False}, {"role": "worker"}):
        assert admin.patch(f"{PREFIX}/users/{admin_id}", json=update).status_code == 409
    ok(admin.patch(f"{PREFIX}/users/{worker_id}", json={"active": False}))
    assert worker.get(PREFIX + "/auth/me").status_code == 401
    assert worker.post(PREFIX + "/auth/login", json={"email": "worker@example.test", "password": PASSWORD + " rotated"}).status_code == 401
    assert admin.post(f"{PREFIX}/users/{worker_id}/recovery").status_code == 404
    ok(admin.patch(f"{PREFIX}/users/{worker_id}", json={"active": True, "role": "engineer"}))
    recovery1 = ok(admin.post(f"{PREFIX}/users/{worker_id}/recovery"))
    recovery2 = ok(admin.post(f"{PREFIX}/users/{worker_id}/recovery"))
    assert worker.post(PREFIX + "/auth/reset-password", json={"token": recovery1["token"], "new_password": PASSWORD}).status_code == 401
    with env["app"].state.sessions() as db:
        db.get(PasswordRecovery, token_hash(recovery2["token"])).expires_at = 0
        db.commit()
    assert worker.post(PREFIX + "/auth/reset-password", json={"token": recovery2["token"], "new_password": PASSWORD}).status_code == 401
    # Role changes invalidate full sessions and become effective on next sign-in.
    ok(worker.post(PREFIX + "/auth/login", json={"email": "worker@example.test", "password": PASSWORD + " rotated"}))
    assert ok(worker.get(PREFIX + "/auth/me"))["user"]["role"] == "engineer"
    ok(admin.patch(f"{PREFIX}/users/{worker_id}", json={"role": "worker"}))
    assert worker.get(PREFIX + "/auth/me").status_code == 401
    audit = ok(admin.get(PREFIX + "/admin/audit?limit=2&offset=1"))
    assert audit["total"] > 2 and len(audit["items"]) == 2
    assert env["engineer"].get(PREFIX + "/admin/audit").status_code == 403
    assert admin.get(PREFIX + "/admin/audit?limit=201").status_code == 422
    with env["app"].state.engine.begin() as connection:
        with pytest.raises(DBAPIError, match="append-only"):
            connection.execute(text("DELETE FROM admin_audit"))


def test_site_switch_invalidates_all_stale_sessions_and_scopes_directory(env):
    admin, app = env["admin"], env["app"]
    old = sign_in(app, "admin@example.test")
    site = ok(admin.post(PREFIX + "/sites", json={"name": "Plant Two"}), 201)
    assert len(ok(admin.get(PREFIX + "/sites"))) == 2
    assert len(ok(env["worker"].get(PREFIX + "/sites"))) == 1
    assert env["worker"].post(PREFIX + "/auth/switch-site", json={"site_id": site["id"]}).status_code == 403
    assert env["engineer"].post(PREFIX + "/sites", json={"name": "No"}).status_code == 403
    switched = ok(admin.post(PREFIX + "/auth/switch-site", json={"site_id": site["id"]}))["user"]
    assert switched["site_id"] == site["id"]
    assert old.get(PREFIX + "/auth/me").status_code == 401
    assert len(ok(admin.get(PREFIX + "/auth/sessions"))) == 1
    assert ok(admin.get(PREFIX + "/assets")) == []
    assert ok(admin.get(PREFIX + "/incidents/page"))["total"] == 0
    assert len(ok(admin.get(PREFIX + "/users"))) == 1
    other_user = ok(admin.post(PREFIX + "/users", json={"name": "Other Plant", "email": "plant2@example.test", "password": PASSWORD, "role": "worker"}), 201)
    assert other_user["site_id"] == site["id"]
    assert admin.patch(f'{PREFIX}/users/{env["users"]["worker"]["id"]}', json={"active": False}).status_code == 404
    assert admin.post(f'{PREFIX}/users/{env["users"]["worker"]["id"]}/recovery').status_code == 404
    with app.state.sessions() as db:
        organization = Organization(name="Foreign")
        db.add(organization)
        db.flush()
        foreign_site = Site(name="Foreign", organization_id=organization.id)
        db.add(foreign_site)
        db.commit()
        foreign_id = foreign_site.id
    assert admin.post(PREFIX + "/auth/switch-site", json={"site_id": foreign_id}).status_code == 404
    ok(admin.post(PREFIX + "/auth/switch-site", json={"site_id": env["users"]["worker"]["site_id"]}))
    assert env["asset"]["id"] in [item["id"] for item in ok(admin.get(PREFIX + "/assets"))]


def test_paged_queue_filters_counts_worker_scope_and_bounds(env):
    one = report(env, description="Distinct hydraulic observation at the press.")
    two = report(env, client=env["worker2"], description="Distinct electrical observation at the press.")
    three = report(env, description="Third mechanical observation at the press.")
    two = action(env["engineer"], two, "request_changes", note="Confirm details")
    page = ok(env["engineer"].get(PREFIX + "/incidents/page?limit=1"))
    assert page["total"] == 3 and len(page["items"]) == 1
    assert page["counts"] == {"submitted": 2, "changes_requested": 1}
    next_page = ok(env["engineer"].get(PREFIX + "/incidents/page?limit=1&offset=1"))
    assert next_page["items"][0]["id"] != page["items"][0]["id"]
    filtered = ok(env["engineer"].get(PREFIX + "/incidents/page?search=hydraulic&status=submitted"))
    assert filtered["total"] == 1 and filtered["items"][0]["id"] == one["id"] and filtered["counts"] == page["counts"]
    assert ok(env["engineer"].get(PREFIX + "/incidents/page?search=PRESS-01"))["total"] == 3
    assert ok(env["engineer"].get(PREFIX + "/incidents/page?mine=true"))["total"] == 0
    assert ok(env["worker"].get(PREFIX + "/incidents/page?search=electrical"))["total"] == 0
    worker_page = ok(env["worker"].get(PREFIX + "/incidents/page"))
    assert worker_page["total"] == 2 and worker_page["counts"] == {"submitted": 2}
    assert len(ok(env["engineer"].get(PREFIX + "/incidents?limit=1"))) == 1
    for query in ("limit=201", "limit=0", "offset=-1"):
        assert env["engineer"].get(PREFIX + "/incidents/page?" + query).status_code == 422
    assert env["engineer"].get(PREFIX + "/incidents?limit=201").status_code == 422


def test_immutable_methods_approval_copy_scheduling_notifications_metrics(env):
    method_input = {"name": "Site-authored controlled record", "description": "Authorized by site personnel.",
                    "steps": [{"label": "Record site-approved work results", "required": True}]}
    assert env["worker"].post(PREFIX + "/work-methods", json=method_input).status_code == 403
    first = ok(env["engineer"].post(PREFIX + "/work-methods", json=method_input), 201)
    assert first["version"] == 1 and ok(env["worker"].get(PREFIX + "/work-methods")) == [first]
    item = report(env)
    notices = ok(env["engineer"].get(PREFIX + "/notifications"))
    assert any(entry["incident_id"] == item["id"] and entry["title"] == "Report submitted" for entry in notices)
    path = f'{PREFIX}/incidents/{item["id"]}/actions'
    assert env["worker"].post(path, json={"action": "schedule", "version": item["version"], "due_at": "2020-01-01T12:00:00Z", "note": "Required"}).status_code == 403
    assert env["engineer"].post(path, json={"action": "schedule", "version": item["version"], "due_at": "2020-01-01T12:00:00", "note": "Required"}).status_code == 422
    assert env["engineer"].post(path, json={"action": "schedule", "version": item["version"], "due_at": 0, "note": "Required"}).status_code == 422
    assert env["engineer"].post(path, json={"action": "schedule", "version": item["version"], "due_at": "2020-01-01T12:00:00Z"}).status_code == 422
    item = action(env["engineer"], item, "schedule", due_at="2020-01-01T12:00:00+02:00", note="Confirmed site due date")
    assert item["due_at"] == "2020-01-01T10:00:00+00:00" and item["timeline"][-1]["action"] == "schedule"
    item = action(env["engineer"], item, "analyze")
    assert env["engineer"].post(path, json={"action": "approve", "version": item["version"], "review_confirmed": True, "note": "Reviewed"}).status_code == 422
    item = action(env["engineer"], item, "approve", review_confirmed=True, note="Reviewed site method", work_method_id=first["id"])
    assert item["approval"]["work_method"] == first
    assert item["checklist"][0]["label"] == first["steps"][0]["label"]
    second = ok(env["engineer"].post(PREFIX + "/work-methods", json={**method_input, "steps": [{"label": "New version record", "required": True}]}), 201)
    assert second["version"] == 2 and second["id"] != first["id"]
    assert ok(env["worker"].get(f'{PREFIX}/incidents/{item["id"]}'))["approval"]["work_method"] == first
    with env["app"].state.engine.begin() as connection:
        with pytest.raises(DBAPIError, match="append-only"):
            connection.execute(text("UPDATE work_methods SET name='tamper'"))
    worker_notices = ok(env["worker"].get(PREFIX + "/notifications"))
    approved_notice = next(entry for entry in worker_notices if entry["title"] == "Work approved")
    assert env["worker2"].post(f'{PREFIX}/notifications/{approved_notice["id"]}/read').status_code == 404
    read = ok(env["worker"].post(f'{PREFIX}/notifications/{approved_notice["id"]}/read'))
    assert read["read_at"] and ok(env["worker"].post(f'{PREFIX}/notifications/{approved_notice["id"]}/read'))["read_at"] == read["read_at"]
    assert env["worker"].get(PREFIX + "/metrics/summary").status_code == 403
    metrics = ok(env["engineer"].get(PREFIX + "/metrics/summary"))
    assert metrics == {"total": 1, "counts": {"approved": 1}, "overdue": 1, "median_resolution_minutes": None}
    for step in item["checklist"]:
        item = ok(env["worker"].patch(f'{PREFIX}/incidents/{item["id"]}/checklist/{step["id"]}', json={"completed": True, "notes": "Observed site-approved work results", "version": item["version"]}))
    item = action(env["worker"], item, "submit_verification")
    assert any(entry["title"] == "Work awaits verification" for entry in ok(env["engineer"].get(PREFIX + "/notifications")))
    item = action(env["engineer"], item, "resolve", note="Independently verified actual results")
    metrics = ok(env["engineer"].get(PREFIX + "/metrics/summary"))
    assert metrics["counts"] == {"resolved": 1} and metrics["overdue"] == 0 and metrics["median_resolution_minutes"] >= 0
    # Notifications and method provenance survive application reinitialization.
    with TestClient(create_app(env["settings"])) as fresh:
        fresh.cookies.set(COOKIE, env["worker"].cookies.get(COOKIE))
        assert next(entry for entry in ok(fresh.get(PREFIX + "/notifications")) if entry["id"] == approved_notice["id"])["read_at"] == read["read_at"]
        assert ok(fresh.get(f'{PREFIX}/incidents/{item["id"]}'))["approval"]["work_method"] == first


def test_evidence_quotas_across_incidents_and_concurrent_uploads(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'quota.db'}", environment="test",
                        max_evidence_per_incident=1, max_org_evidence_bytes=len(png()) * 2)
    app = create_app(settings)
    with TestClient(app) as admin:
        ok(bootstrap(admin), 201)
        asset = ok(admin.post(PREFIX + "/assets", json={"code": "Q", "name": "Q", "area": "Q", "criticality": "low"}), 201)
        local = {"admin": admin, "worker": admin, "asset": asset}
        first, second, third = [report(local) for _ in range(3)]
        path = f'{PREFIX}/incidents/{first["id"]}/evidence'
        other = sign_in(app, "admin@example.test")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda client: client.post(path, files={"file": ("e.png", png(), "image/png")}), (admin, other)))
        assert sorted(result.status_code for result in results) == [201, 413]
        assert admin.post(f'{PREFIX}/incidents/{second["id"]}/evidence', files={"file": ("e.png", png(), "image/png")}).status_code == 201
        assert admin.post(f'{PREFIX}/incidents/{third["id"]}/evidence', files={"file": ("e.png", png(), "image/png")}).status_code == 413
        assert len(ok(admin.get(f'{PREFIX}/incidents/{third["id"]}'))["evidence"]) == 0


def test_inbound_hashed_token_idempotency_conflicts_scope_and_revocation(env):
    admin, app = env["admin"], env["app"]
    assert env["engineer"].post(PREFIX + "/integrations", json={"name": "Inbound"}).status_code == 403
    integration = ok(admin.post(PREFIX + "/integrations", json={"name": "Inbound observer"}), 201)
    identifier, token = integration["id"], integration["token"]
    metadata = ok(admin.get(PREFIX + "/integrations"))
    assert token not in json.dumps(metadata) and "token_hash" not in json.dumps(metadata)
    with app.state.sessions() as db:
        assert db.get(Integration, identifier).token_hash == token_hash(token)
    path = f"{PREFIX}/integrations/{identifier}/observations"
    body = {"asset_code": "PRESS-01", "external_id": "source-record-1", "observed_at": "2026-01-01T10:00:00Z", "measurements": {"temperature": 42.5, "unit": "C", "source_status": "unverified"}}
    machine, second_machine = TestClient(app), TestClient(app)
    assert machine.post(path, json=body).status_code == 401
    assert admin.post(path, json=body).status_code == 401  # cookie is not integration authority
    headers = {"authorization": "Bearer " + token}
    assert machine.post(path, json=body, headers={"authorization": "Bearer invalid"}).status_code == 401
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda client: client.post(path, json=body, headers=headers), (machine, second_machine)))
    assert sorted(result.status_code for result in results) == [200, 201]
    assert results[0].json() == results[1].json()
    received = results[0].json()
    assert received["measurements"] == body["measurements"] and "not verified truth" in received["source"]
    assert machine.post(path, json={**body, "measurements": {"temperature": 99}}, headers=headers).status_code == 409
    assert machine.post(path, json={**body, "external_id": "missing", "asset_code": "UNREGISTERED"}, headers=headers).status_code == 404
    assert machine.post(path, json={**body, "observed_at": "2026-01-01T10:00:00"}, headers=headers).status_code == 422
    assert machine.post(path, json={**body, "observed_at": 0}, headers=headers).status_code == 422
    invalid_numbers = json.dumps({**body, "measurements": {"value": float("nan")}})
    assert machine.post(path, content=invalid_numbers, headers={**headers, "content-type": "application/json"}).status_code == 422
    observations_path = f'{PREFIX}/assets/{env["asset"]["id"]}/observations'
    assert env["worker"].get(observations_path).status_code == 403
    assert ok(env["engineer"].get(observations_path)) == [received]
    events = ok(admin.get(PREFIX + "/admin/audit"))["items"]
    assert sum(event["action"] == "integration.observation_received" for event in events) == 1
    assert token not in json.dumps(events)
    site = ok(admin.post(PREFIX + "/sites", json={"name": "Other plant"}), 201)
    ok(admin.post(PREFIX + "/auth/switch-site", json={"site_id": site["id"]}))
    assert admin.get(observations_path).status_code == 404
    assert admin.delete(f"{PREFIX}/integrations/{identifier}").status_code == 404
    assert ok(admin.get(PREFIX + "/integrations")) == []
    ok(admin.post(PREFIX + "/auth/switch-site", json={"site_id": env["users"]["worker"]["site_id"]}))
    ok(admin.delete(f"{PREFIX}/integrations/{identifier}"))
    assert machine.post(path, json=body, headers=headers).status_code == 401
    assert ok(admin.get(observations_path)) == [received]


def test_production_key_validation_and_development_key_persistence(tmp_path):
    settings = Settings(database_url="postgresql://u:p@localhost/test", environment="production", cookie_secure=True,
                        public_origin="https://example.test")
    with pytest.raises(RuntimeError, match="FIELD_ENCRYPTION_KEY"):
        settings.validate()
    with pytest.raises(RuntimeError, match="valid Fernet"):
        replace(settings, field_encryption_key="not-a-key").validate()
    replace(settings, field_encryption_key=Fernet.generate_key().decode()).validate()
    dev = Settings(environment="test")
    ciphertext = field_cipher(dev).encrypt(b"pending secret")
    assert field_cipher(dev).decrypt(ciphertext) == b"pending secret"


def test_migration_1_upgrade_preserves_users_sessions_incidents_evidence_and_audit(migration_database):
    # Freeze baseline-1 tables using their actual pre-completion columns. This is a
    # real old database, not a fresh create_all with a forged version marker.
    from sqlalchemy import MetaData, UniqueConstraint
    baseline_names = {"schema_versions", "setup_lock", "organizations", "sites", "users", "auth_sessions",
                      "login_throttles", "assets", "incidents", "evidence", "audit_events"}
    omitted = {"users": {"active", "must_change_password", "mfa_secret", "mfa_pending", "mfa_pending_expires", "mfa_last_counter", "recovery_hashes"},
               "auth_sessions": {"id", "created_at", "site_id"}}
    baseline = MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name in baseline_names:
            old = table.to_metadata(baseline)
            for name in omitted.get(table.name, set()):
                column = old.c[name]
                for constraint in list(old.constraints):
                    if isinstance(constraint, UniqueConstraint) and column in list(constraint.columns):
                        old.constraints.remove(constraint)
                old._columns.remove(column)
    engine = migration_database
    with engine.begin() as connection:
        baseline.create_all(connection)
        connection.execute(text("INSERT INTO schema_versions VALUES (1)"))
        connection.execute(text("INSERT INTO setup_lock VALUES (1, TRUE)"))
        connection.execute(text("INSERT INTO organizations VALUES ('org', 'Existing Org')"))
        connection.execute(text("INSERT INTO sites VALUES ('site', 'org', 'Existing Site')"))
        from backend.security import hash_password
        connection.execute(text("INSERT INTO users VALUES ('user', 'org', 'site', 'Existing Admin', 'existing@example.test', :password, 'admin')"), {"password": hash_password(PASSWORD)})
        connection.execute(text("INSERT INTO auth_sessions VALUES (:token, 'user', :expires)"), {"token": token_hash("existing-session"), "expires": int(time.time()) + 3600})
        connection.execute(baseline.tables["assets"].insert().values(id="asset", organization_id="org", site_id="site", code="OLD", name="Existing", area="Bay", criticality="low", status="registered"))
        source = {"asset_id": "asset", "description": "Existing observation retained verbatim", "impact": "Recorded impact", "safe_state": "isolated", "injury_status": "none", "measurements": "Original observation"}
        connection.execute(baseline.tables["incidents"].insert().values(id="incident", number="OLD-1", organization_id="org", site_id="site", reporter_id="user", asset_id="asset", create_fingerprint="f" * 64, report=source))
        connection.execute(baseline.tables["evidence"].insert().values(id="evidence", incident_id="incident", filename="old.png", content_type="image/png", size=len(png()), uploaded_by="user", sha256="a" * 64, data=png()))
        connection.execute(baseline.tables["audit_events"].insert().values(id="audit", incident_id="incident", action="submitted", actor_id="user", actor_name="Existing Admin", actor_role="admin", report_version=1, snapshot={"description": source["description"]}))
        if engine.dialect.name == "sqlite":
            for operation in ("UPDATE", "DELETE"):
                connection.exec_driver_sql(f"CREATE TRIGGER audit_no_{operation.lower()} BEFORE {operation} ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END")
        else:
            connection.exec_driver_sql("CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit events are append-only'; END; $$")
            connection.exec_driver_sql("CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()")
    initialize(engine)
    initialize(engine)  # upgrades are idempotent across restarts
    with engine.connect() as connection:
        assert list(connection.execute(select(SchemaVersion.version).order_by(SchemaVersion.version)).scalars()) == [1, 2]
        assert connection.execute(text("SELECT data FROM evidence WHERE id='evidence'")).scalar() == png()
        snapshot = connection.execute(text("SELECT snapshot FROM audit_events WHERE id='audit'")).scalar()
        assert (json.loads(snapshot) if isinstance(snapshot, str) else snapshot) == {"description": source["description"]}
    settings = Settings(database_url=engine.url.render_as_string(hide_password=False), environment="test")
    with TestClient(create_app(settings)) as client:
        client.cookies.set(COOKIE, "existing-session")
        user = ok(client.get(PREFIX + "/auth/me"))["user"]
        assert user["active"] and not user["must_change_password"] and not user["mfa_enabled"]
        assert ok(client.get(PREFIX + "/auth/sessions"))[0]["id"] != token_hash("existing-session")
        retained = ok(client.get(PREFIX + "/incidents/incident"))
        assert retained["description"] == source["description"] and retained["timeline"][0]["id"] == "audit"
        assert client.get(retained["evidence"][0]["url"]).content == png()
        assert ok(client.get(PREFIX + "/work-methods")) == []
        ok(client.post(PREFIX + "/auth/mfa/enroll", json={"password": PASSWORD}))
    engine.dispose()
