"""Behavioral contract tests against real durable SQLAlchemy transactions."""
import io
import json
import warnings
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from backend.config import Settings
from backend.database import (AuditEvent, AuthSession, Organization, Site, User,
                              initialize, make_database)
from backend.main import create_app
from backend.security import COOKIE, hash_password, token_hash

PASSWORD = "a long test-only password"
PREFIX = "/api/v1"


def ok(response, expected=200):
    assert response.status_code == expected, response.text
    return response.json()


def bootstrap(client):
    return client.post(PREFIX + "/setup", json={"organization_name": "Test Manufacturing", "site_name": "Plant One",
                                               "name": "Test Administrator", "email": "admin@example.test", "password": PASSWORD})


def sign_in(app, email, password=PASSWORD):
    client = TestClient(app)
    result = ok(client.post(PREFIX + "/auth/login", json={"email": email, "password": password}))
    if result["user"]["must_change_password"]:
        ok(client.post(PREFIX + "/auth/change-password", json={"current_password": password, "new_password": password + " rotated"}))
    return client


@pytest.fixture
def env(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'workflow.db'}", environment="test", login_limit=100)
    app = create_app(settings)
    with TestClient(app) as admin:
        admin_user = ok(bootstrap(admin), 201)["user"]
        identities = {"admin": admin_user}
        for role, name in (("worker", "Field Reporter"), ("worker2", "Assigned Worker"), ("engineer", "Priyanshu Chauhan"), ("supervisor", "Shift Supervisor")):
            identities[role] = ok(admin.post(PREFIX + "/users", json={"name": name, "email": role + "@example.test",
                                                                     "password": PASSWORD, "role": "worker" if role == "worker2" else role}), 201)
        asset = ok(admin.post(PREFIX + "/assets", json={"code": "PRESS-01", "name": "Registered Press", "area": "Bay 1", "criticality": "high"}), 201)
        clients = {role: sign_in(app, user["email"]) for role, user in identities.items() if role != "admin"}
        yield {"app": app, "settings": settings, "admin": admin, "users": identities, "asset": asset, **clients}
        for client in clients.values():
            client.close()


def report(env, client=None, **changes):
    data = {"asset_id": env["asset"]["id"], "description": "The press stopped after an interlock alarm during the shift.",
            "impact": "Production interrupted; actual downtime not yet measured.", "injury_status": "none", "safe_state": "isolated",
            "measurements": "Worker observation: panel indicated alarm X7; not sensor verified."}
    data.update(changes)
    return ok((client or env["worker"]).post(PREFIX + "/incidents", json=data), 201)


def action(client, item, name, expected=200, **kwargs):
    return ok(client.post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": name, "version": item["version"], **kwargs}), expected)


def approve(env, item):
    item = action(env["engineer"], item, "analyze")
    return action(env["engineer"], item, "approve", note="Reviewed worker report, evidence and safe work scope.", review_confirmed=True)


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def test_setup_cookie_session_password_and_revocation(tmp_path):
    app = create_app(Settings(database_url=f"sqlite:///{tmp_path / 'identity.db'}", environment="test"))
    with TestClient(app) as client:
        assert ok(client.get(PREFIX + "/setup/status")) == {"needs_setup": True}
        assert client.get(PREFIX + "/assets").status_code == 401
        short = {"organization_name": "Org", "site_name": "Site", "name": "Admin", "email": "a@example.test", "password": "short"}
        assert client.post(PREFIX + "/setup", json=short).status_code == 422
        user = ok(bootstrap(client), 201)["user"]
        assert user["role"] == "admin" and user["organization_name"] == "Test Manufacturing"
        token = client.cookies.get(COOKIE)
        assert token and not ok(client.get(PREFIX + "/setup/status"))["needs_setup"]
        assert bootstrap(client).status_code == 409
        with app.state.sessions() as db:
            account = db.get(User, user["id"])
            assert account.password_hash.startswith("pbkdf2_sha256$600000$")
            assert PASSWORD not in account.password_hash
            assert db.get(AuthSession, token_hash(token)) is not None
            assert db.get(AuthSession, token) is None
        response = client.post(PREFIX + "/auth/login", json={"email": "ADMIN@EXAMPLE.TEST", "password": PASSWORD})
        ok(response)
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api/v1" in cookie
        assert token != client.cookies.get(COOKIE)
        with app.state.sessions() as db:
            assert db.get(AuthSession, token_hash(token)) is None
        active = client.cookies.get(COOKIE)
        ok(client.post(PREFIX + "/auth/logout"))
        assert client.get(PREFIX + "/auth/me").status_code == 401
        client.cookies.set(COOKIE, active)
        assert client.get(PREFIX + "/auth/me").status_code == 401
        ok(client.post(PREFIX + "/auth/logout"))  # stale/expired cookies can still be cleared
        assert client.post(PREFIX + "/auth/login", json={"email": "admin@example.test", "password": "incorrect password"}).status_code == 401


def test_password_whitespace_is_significant_and_users_are_admin_provisioned(env):
    client = env["admin"]
    password = "  whitespace password  "
    ok(client.post(PREFIX + "/users", json={"name": "Whitespace Test", "email": "space@example.test", "password": password, "role": "worker"}), 201)
    anonymous = TestClient(env["app"])
    assert anonymous.post(PREFIX + "/auth/login", json={"email": "space@example.test", "password": password.strip()}).status_code == 401
    ok(anonymous.post(PREFIX + "/auth/login", json={"email": "space@example.test", "password": password}))
    assert env["worker"].post(PREFIX + "/users", json={"name": "No Privilege", "email": "no@example.test", "password": PASSWORD, "role": "admin"}).status_code == 403
    assert env["worker"].post(PREFIX + "/assets", json={"code": "X", "name": "X", "area": "X", "criticality": "low"}).status_code == 403
    users = ok(env["worker"].get(PREFIX + "/users"))
    assert any(item["name"] == "Priyanshu Chauhan" for item in users)
    assert not any("password_hash" in item for item in users)


def test_worker_forbidden_approval_spoofed_roles_and_self_approval(env):
    item = report(env)
    assert env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "approve", "version": 1, "note": "Trying", "review_confirmed": True}).status_code == 403
    assert env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "approve", "version": 1, "role": "engineer", "actor_name": "Priyanshu Chauhan"}).status_code == 422
    own = report(env, client=env["admin"])
    own = action(env["admin"], own, "analyze")
    assert env["admin"].post(f'{PREFIX}/incidents/{own["id"]}/actions', json={"action": "approve", "version": own["version"], "note": "Own report", "review_confirmed": True}).status_code == 403
    item = approve(env, item)
    assert item["approval"]["actor_name"] == "Priyanshu Chauhan"
    assert env["engineer"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "start", "version": item["version"]}).status_code == 403


def test_clarification_request_changes_and_stale_analysis_invalidation(env):
    item = report(env, description="Something wrong", impact="", injury_status="unknown", safe_state="unknown", measurements="")
    item = action(env["engineer"], item, "analyze")
    assert item["status"] == "needs_clarification"
    assert {"impact", "injury_status", "safe_state", "description"} <= {f["field"] for f in item["findings"] if f["severity"] == "blocking"}
    assert env["engineer"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "approve", "version": item["version"], "note": "Not ready", "review_confirmed": True}).status_code == 409
    assert env["engineer"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "request_changes", "version": item["version"]}).status_code == 422
    item = action(env["engineer"], item, "request_changes", note="Confirm injury status, safe state and production impact.")
    assert item["status"] == "changes_requested"
    edit = {key: item[key] for key in ("asset_id", "description", "impact", "injury_status", "safe_state", "measurements")}
    edit.update(description="A protective interlock stopped the press during production.", impact="Line stopped, no duration measured.", injury_status="none", safe_state="isolated", version=item["version"])
    path = f'{PREFIX}/incidents/{item["id"]}'
    assert env["engineer"].patch(path, json=edit).status_code == 403
    item = ok(env["worker"].patch(path, json=edit))
    assert item["status"] == "submitted" and item["analysis"] is None and item["approval"] is None
    assert env["worker"].patch(path, json=edit).status_code == 409
    approved = approve(env, item)
    assert approved["approval"]["report_version"] == item["version"]
    assert env["worker"].patch(path, json={**edit, "version": approved["version"]}).status_code == 409
    export = ok(env["admin"].get(path + "/export"))
    assert export["audit_events"][0]["snapshot"]["description"] == "Something wrong"


def test_review_confirmation_and_note_gates(env):
    item = action(env["engineer"], report(env), "analyze")
    path = f'{PREFIX}/incidents/{item["id"]}/actions'
    for extra in ({"note": "Reviewed"}, {"review_confirmed": True}, {"note": "  ", "review_confirmed": True}):
        assert env["engineer"].post(path, json={"action": "approve", "version": item["version"], **extra}).status_code == 422
    assert ok(env["worker"].get(f'{PREFIX}/incidents/{item["id"]}'))["version"] == item["version"]


def test_full_resolution_execution_notes_independent_verification_reopen(env):
    item = report(env)
    assert env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "start", "version": item["version"]}).status_code == 409
    item = approve(env, item)
    item = action(env["worker"], item, "start")
    assert env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "submit_verification", "version": item["version"]}).status_code == 409
    step = item["checklist"][0]
    path = f'{PREFIX}/incidents/{item["id"]}/checklist/{step["id"]}'
    assert env["worker"].patch(path, json={"completed": True, "notes": "", "version": item["version"]}).status_code == 422
    assert env["engineer"].patch(path, json={"completed": True, "notes": "Reviewed", "version": item["version"]}).status_code == 403
    for index, step in enumerate(item["checklist"]):
        item = ok(env["worker"].patch(f'{PREFIX}/incidents/{item["id"]}/checklist/{step["id"]}', json={"completed": True, "notes": f"Actual observed completion evidence for step {index + 1}.", "version": item["version"]}))
    item = action(env["worker"], item, "submit_verification")
    assert item["status"] == "awaiting_verification"
    assert env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "resolve", "note": "Self verifying", "version": item["version"]}).status_code == 403
    assert env["engineer"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "resolve", "version": item["version"]}).status_code == 422
    item = action(env["engineer"], item, "resolve", note="Independently inspected actual results and accepted controlled handover.")
    assert item["status"] == "resolved"
    assert env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "reopen", "version": item["version"]}).status_code == 422
    item = action(env["worker"], item, "reopen", note="Symptom recurred on the following shift.")
    assert item["status"] == "reopened" and item["approval"] is None and item["checklist"] == []
    item = action(env["engineer"], item, "request_changes", note="Add recurrence observations before reapproval.")
    assert item["status"] == "changes_requested"
    events = item["timeline"]
    assert [e["action"] for e in events][-5:] == ["checklist_updated", "submit_verification", "resolve", "reopen", "request_changes"]


def test_author_reviewer_cannot_verify_own_execution_and_assignee_is_scoped(env):
    item = report(env, client=env["admin"])
    item = approve(env, item)
    item = action(env["admin"], item, "start")
    for step in item["checklist"]:
        item = ok(env["admin"].patch(f'{PREFIX}/incidents/{item["id"]}/checklist/{step["id"]}', json={"completed": True, "notes": "Recorded results.", "version": item["version"]}))
    item = action(env["admin"], item, "submit_verification")
    assert env["admin"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "resolve", "note": "I did this work", "version": item["version"]}).status_code == 403
    action(env["engineer"], item, "resolve", note="Independent review accepted.")
    other = report(env)
    assert env["worker2"].get(f'{PREFIX}/incidents/{other["id"]}').status_code == 404
    other = action(env["engineer"], other, "assign", assigned_to=env["users"]["worker2"]["id"])
    assert env["worker2"].get(f'{PREFIX}/incidents/{other["id"]}').status_code == 200
    other = approve(env, other)
    other = action(env["worker2"], other, "start")
    assert other["status"] == "in_progress"


def test_evidence_validation_protected_download_and_review_invalidation(env):
    item = action(env["engineer"], report(env), "analyze")
    path = f'{PREFIX}/incidents/{item["id"]}/evidence'
    assert env["engineer"].post(path, files={"file": ("x.png", png(), "image/png")}).status_code == 403
    for filename, data, kind, expected in (("x.svg", b"<svg/>", "image/svg+xml", 415),
                                            ("x.png", b"not an image", "image/png", 422),
                                            ("x.jpg", png(), "image/jpeg", 422),
                                            ("x.pdf", b"not a pdf", "application/pdf", 422),
                                            ("x.png", b"", "image/png", 422),
                                            ("huge.png", b"x" * (10 * 1024 * 1024 + 1), "image/png", 413)):
        assert env["worker"].post(path, files={"file": (filename, data, kind)}).status_code == expected
    assert env["worker"].post(path, data={"version": 1}, files={"file": ("x.png", png(), "image/png")}).status_code == 409
    item = ok(env["worker"].post(path, data={"version": item["version"]}, files={"file": ("../../untrusted.png", png(), "image/png")}), 201)
    assert item["analysis"] is None and item["approval"] is None and item["status"] == "submitted"
    evidence = item["evidence"][0]
    assert evidence["filename"] == "untrusted.png" and evidence["size"] == len(png())
    assert TestClient(env["app"]).get(evidence["url"]).status_code == 401
    assert env["worker2"].get(evidence["url"]).status_code == 404
    response = env["engineer"].get(evidence["url"])
    assert response.status_code == 200 and response.content == png()
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["x-content-type-options"] == "nosniff"
    item = approve(env, item)
    assert env["worker"].post(path, files={"file": ("after.png", png(), "image/png")}).status_code == 409


def test_pdf_must_parse_and_cannot_contain_active_content(env):
    item = report(env)
    path = f'{PREFIX}/incidents/{item["id"]}/evidence'
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    plain = io.BytesIO()
    writer.write(plain)
    item = ok(env["worker"].post(path, files={"file": ("inspection.pdf", plain.getvalue(), "application/pdf")}), 201)
    assert item["evidence"][0]["content_type"] == "application/pdf"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        writer.add_js("app.alert('unsupported active content')")
    active = io.BytesIO()
    writer.write(active)
    assert env["worker"].post(path, files={"file": ("active.pdf", active.getvalue(), "application/pdf")}).status_code == 422
    assert env["worker"].post(path, files={"file": ("signature-only.pdf", b"%PDF-1.7\nnot really a document\n%%EOF", "application/pdf")}).status_code == 422


def test_tenant_site_isolation_assets_incidents_evidence_exports_and_assignments(env):
    item = report(env)
    item = ok(env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/evidence', files={"file": ("e.png", png(), "image/png")}), 201)
    with env["app"].state.sessions() as db:
        org = Organization(name="Other Organization")
        db.add(org)
        db.flush()
        site = Site(name="Other Tenant Site", organization_id=org.id)
        same_org_site = Site(name="Different Site Same Org", organization_id=env["users"]["admin"]["organization_id"])
        db.add_all([site, same_org_site])
        db.flush()
        for label, organization_id, site_id in (("foreign", org.id, site.id), ("othersite", same_org_site.organization_id, same_org_site.id)):
            db.add(User(name=label, email=label + "@example.test", role="admin", password_hash=hash_password(PASSWORD), organization_id=organization_id, site_id=site_id))
        db.commit()
    for label in ("foreign", "othersite"):
        client = sign_in(env["app"], label + "@example.test")
        assert ok(client.get(PREFIX + "/assets")) == []
        assert ok(client.get(PREFIX + "/incidents")) == []
        for suffix in ("", "/export", "/evidence/" + item["evidence"][0]["id"]):
            assert client.get(f'{PREFIX}/incidents/{item["id"]}{suffix}').status_code == 404
        assert client.post(PREFIX + "/incidents", json={key: item[key] for key in ("asset_id", "description", "impact", "injury_status", "safe_state", "measurements")}).status_code == 404
        foreign_id = ok(client.get(PREFIX + "/auth/me"))["user"]["id"]
        assert env["engineer"].post(f'{PREFIX}/incidents/{item["id"]}/actions', json={"action": "assign", "assigned_to": foreign_id, "version": item["version"]}).status_code == 404
        if label == "foreign":
            assert len(ok(client.get(PREFIX + "/users"))) == 1
        else:
            assert len(ok(client.get(PREFIX + "/users"))) == 1  # completion contract scopes the directory to current site


def test_idempotent_offline_creates_no_duplicates_different_content_conflicts(env):
    client_id = str(uuid4())
    item = report(env, client_id=client_id)
    body = {key: item[key] for key in ("asset_id", "description", "impact", "injury_status", "safe_state", "measurements")}
    body["client_id"] = client_id
    replay = ok(env["worker"].post(PREFIX + "/incidents", json=body))
    assert replay["id"] == item["id"] and len(replay["timeline"]) == 1
    assert len(ok(env["worker"].get(PREFIX + "/incidents"))) == 1
    assert env["worker"].post(PREFIX + "/incidents", json={**body, "description": "Different worker observation with the same client key."}).status_code == 409
    other = ok(env["worker2"].post(PREFIX + "/incidents", json=body), 201)
    assert other["id"] != item["id"]
    assert env["worker"].post(PREFIX + "/incidents", json={**body, "client_id": "not-a-uuid"}).status_code == 422


def test_concurrent_version_compare_is_transactional(env):
    item = report(env)
    url = f'{PREFIX}/incidents/{item["id"]}/actions'
    body = {"action": "analyze", "version": item["version"]}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(client.post, url, json=body) for client in (env["engineer"], env["supervisor"])]
        responses = [future.result() for future in futures]
    assert sorted(response.status_code for response in responses) == [200, 409]
    current = ok(env["admin"].get(f'{PREFIX}/incidents/{item["id"]}'))
    assert current["version"] == 2 and len(current["timeline"]) == 2


def test_persistence_engine_restart_and_export_audit_is_append_only(env):
    item = report(env)
    item = ok(env["worker"].post(f'{PREFIX}/incidents/{item["id"]}/evidence', files={"file": ("e.png", png(), "image/png")}), 201)
    cookie = env["worker"].cookies.get(COOKIE)
    env["app"].state.engine.dispose()
    fresh = create_app(env["settings"])
    with TestClient(fresh) as client:
        client.cookies.set(COOKIE, cookie)
        persisted = ok(client.get(f'{PREFIX}/incidents/{item["id"]}'))
        assert persisted == item
        assert client.get(item["evidence"][0]["url"]).content == png()
        export = ok(client.get(f'{PREFIX}/incidents/{item["id"]}/export'))
        assert export["incident"] == item
        assert export["provenance"]["measurements_source"].startswith("worker-entered")
        assert export["audit_events"][0]["snapshot"]["measurements"] == item["measurements"]
        assert export["provenance"]["evidence_sha256"]
        serialized = json.dumps(export)
        assert "password_hash" not in serialized and "token_hash" not in serialized and cookie not in serialized
        with fresh.state.engine.begin() as connection:
            with pytest.raises(DBAPIError, match="append-only"):
                connection.execute(text("DELETE FROM audit_events"))
        with fresh.state.sessions() as db:
            event = db.scalar(select(AuditEvent))
            event.note = "tamper"
            with pytest.raises(ValueError, match="append-only"):
                db.commit()


def test_rule_cautions_preserve_negation_and_contradiction(env):
    item = report(env, description="The press is not isolated and is still running; no leak was observed.")
    item = action(env["engineer"], item, "analyze")
    assert item["status"] == "needs_clarification"
    assert any(f["label"] == "Negation caution" for f in item["findings"])
    assert any(f["label"] == "Contradictory source statements" for f in item["findings"])
    assert all("Unverified" in hypothesis for hypothesis in item["analysis"]["hypotheses"])
    assert "confidence" not in item["analysis"] and "diagnosis" in item["analysis"]["summary"]
    assert item["description"].endswith("no leak was observed.")
    injury = report(env, description="No leak was observed, but an operator was injured during the alarm.")
    assert any(f["field"] == "injury_status" and f["severity"] == "blocking" for f in injury["findings"])
    negated = report(env, description="The operator was not injured; the machine stopped after the alarm.")
    assert not any(f["field"] == "injury_status" and f["severity"] == "blocking" for f in negated["findings"])


def test_secure_cookie_and_configured_origin_host_check(tmp_path):
    app = create_app(Settings(database_url=f"sqlite:///{tmp_path / 'secure.db'}", environment="test", cookie_secure=True, public_origin="https://ops.example.test"))
    with TestClient(app, base_url="https://ops.example.test") as client:
        response = bootstrap(client)
        ok(response, 201)
        assert "secure" in response.headers["set-cookie"].lower()
        assert client.get(PREFIX + "/auth/me").status_code == 200
        assert client.get(PREFIX + "/auth/me", headers={"host": "wrong.example.test"}).status_code == 400
        assert client.get(PREFIX + "/health", headers={"host": "internal-readiness"}).status_code == 200


def test_cross_origin_request_limits_security_headers_and_legacy_retirement(env):
    path = PREFIX + "/assets"
    body = {"code": "P2", "name": "Press 2", "area": "Bay 2", "criticality": "low"}
    for headers in ({"origin": "https://evil.example"}, {"origin": "null"}, {"sec-fetch-site": "cross-site"}, {"referer": "https://evil.example/form"}):
        assert env["admin"].post(path, json=body, headers=headers).status_code == 403
    ok(env["admin"].post(path, json=body, headers={"origin": "http://testserver"}), 201)
    response = env["admin"].get(PREFIX + "/health")
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert env["admin"].post(PREFIX + "/incidents", content=b"x" * (128 * 1024 + 1)).status_code == 413
    # The streamed count is enforced even without Content-Length.
    assert env["admin"].post(PREFIX + "/incidents", content=iter([b"x" * 65536] * 3)).status_code == 413
    for method, route in (("post", "/api/bridge/approve"), ("post", "/api/bridge/parse"), ("patch", "/api/bridge/status"), ("get", "/api/bridge/history")):
        assert getattr(TestClient(env["app"]), method)(route).status_code == 410


def test_login_rate_limit_is_durable_and_expired_sessions_rejected(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'rate.db'}", environment="test", login_limit=2)
    app = create_app(settings)
    with TestClient(app) as client:
        ok(bootstrap(client), 201)
        with app.state.sessions() as db:
            session = db.get(AuthSession, token_hash(client.cookies.get(COOKIE)))
            session.expires_at = 0
            db.commit()
        assert client.get(PREFIX + "/auth/me").status_code == 401
        for _ in range(2):
            assert client.post(PREFIX + "/auth/login", json={"email": "nobody@example.test", "password": "wrong password"}).status_code == 401
    fresh = create_app(settings)
    with TestClient(fresh) as client:
        assert client.post(PREFIX + "/auth/login", json={"email": "nobody@example.test", "password": PASSWORD}).status_code == 429


def test_production_configuration_fails_closed_and_unknown_schema_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("PUBLIC_ORIGIN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        Settings.from_env()
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:password@db/manufacturing")
    with pytest.raises(RuntimeError, match="HTTPS"):
        Settings.from_env()
    monkeypatch.setenv("PUBLIC_ORIGIN", "https://ops.example.test")
    with pytest.raises(RuntimeError, match="FIELD_ENCRYPTION_KEY"):
        Settings.from_env()
    from cryptography.fernet import Fernet
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    assert Settings.from_env().cookie_secure
    monkeypatch.setenv("COOKIE_SECURE", "false")
    with pytest.raises(RuntimeError, match="HTTPS"):
        Settings.from_env()
    engine, _ = make_database(f"sqlite:///{tmp_path / 'unknown.db'}")
    initialize(engine)
    with engine.begin() as connection:
        connection.execute(text("UPDATE schema_versions SET version=999 WHERE version=2"))
    with pytest.raises(RuntimeError, match="Unsupported database schema"):
        initialize(engine)
    engine.dispose()
