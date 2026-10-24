from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import func, select

import backend.main as main_module
from backend.config import Settings
from backend.database import (AdminAudit, Asset, AuditEvent, AuthSession, Incident,
                              Notification, Organization, SetupLock, Site, User, WorkMethod, make_database)
from backend.demo_seed import (CONTROLLER_COOKIE, CONTROLLER_PATH, CONTROLLER_SCOPE,
                               CONTROLLER_SECONDS, DEMO_PERSONAS, DEMO_ORGANIZATION, DEMO_USER_IDS, seed_demo)
from backend.main import create_app
from backend.security import COOKIE, token_hash, verify_password

PREFIX = "/api/v1"
LIST = PREFIX + "/auth/perspectives"
SWITCH = LIST + "/switch"
ENTER = PREFIX + "/auth/demo/enter"


def login(client, role="admin"):
    values = DEMO_PERSONAS[role]
    response = client.post(PREFIX + "/auth/login", json={"email": values["email"], "password": values["password"]})
    assert response.status_code == 200, response.text
    return response.json()["user"]


def enter(client):
    response = client.post(ENTER, json={})
    assert response.status_code == 200, response.text
    assert response.json()["user"]["id"] == DEMO_USER_IDS["admin"]
    return response


@pytest.fixture
def demo(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'demo.db'}", environment="demo", login_limit=100,
                        cookie_secure=True, public_origin="https://demo.example.test")
    app = create_app(settings)
    with TestClient(app, base_url=settings.public_origin) as client:
        yield app, client, settings


def test_demo_environment_accepts_ephemeral_sqlite():
    Settings(database_url="sqlite:///:memory:", environment="demo", cookie_secure=True).validate()


def test_production_still_rejects_sqlite_without_required_origin_and_key():
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        Settings(database_url="sqlite:///:memory:", environment="production", cookie_secure=True).validate()


def test_demo_requires_explicit_app_env(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "demo")
    assert Settings.from_env().environment == "development"
    monkeypatch.setenv("APP_ENV", "demo")
    assert Settings.from_env().environment == "demo"
    monkeypatch.setenv("APP_ENV", "test")
    assert Settings.from_env().environment == "test"


def test_frontend_is_optional_and_does_not_capture_api_routes(monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><body>demo shell</body></html>", encoding="utf-8")
    monkeypatch.setattr(main_module, "FRONTEND_DIST", dist)
    app = create_app(Settings(database_url="sqlite:///:memory:", environment="demo", cookie_secure=True))
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "demo shell" in response.text
        assert "script-src 'self'" in response.headers["content-security-policy"]
        assert client.get(PREFIX + "/health").json()["status"] == "ok"
        assert client.get(PREFIX + "/not-a-route").status_code == 404


def test_missing_frontend_build_leaves_root_unhandled(monkeypatch, tmp_path):
    monkeypatch.setattr(main_module, "FRONTEND_DIST", tmp_path / "missing-dist")
    with TestClient(create_app(Settings(database_url="sqlite:///:memory:", environment="demo"))) as client:
        assert client.get("/").status_code == 404


def test_demo_startup_seeds_complete_durable_workspace_once(demo):
    app, client, settings = demo
    assert client.get(PREFIX + "/setup/status").json() == {"needs_setup": False, "demo_available": True}
    assert not client.cookies.get(COOKIE)  # Seeding is not an anonymous sign-in.
    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Organization)) == 1
        assert db.scalar(select(Organization.name)) == DEMO_ORGANIZATION
        assert db.scalar(select(func.count()).select_from(Site)) == 1
        assert db.scalar(select(func.count()).select_from(Asset)) == 3
        assert db.scalar(select(func.count()).select_from(Incident)) == 5
        assert db.scalar(select(func.count()).select_from(WorkMethod)) == 3
        assert db.scalar(select(func.count()).select_from(Notification)) > 0
        assert db.scalar(select(func.count()).select_from(AuthSession)) == 0
        users = list(db.scalars(select(User)))
        assert len(users) == 4 and {user.role for user in users} == set(DEMO_PERSONAS)
        for user in users:
            assert user.active and not user.must_change_password
            assert verify_password(DEMO_PERSONAS[user.role]["password"], user.password_hash)
        before_ids = {model.__name__: set(db.scalars(select(model.id))) for model in (User, Asset, Incident, AdminAudit, AuditEvent)}
    login(client)
    incidents = client.get(PREFIX + "/incidents").json()
    assert len(incidents) == 5
    assert {item["status"] for item in incidents} == {"submitted", "ready_for_review", "approved", "awaiting_verification", "changes_requested"}
    for item in incidents:
        assert item["asset_id"] == item["asset"]["id"]
        assert item["timeline"][0]["action"] == "submitted"
        assert item["timeline"][-1]["report_version"] == 1
        assert len(item["timeline"]) == item["version"]
    reviewed = next(item for item in incidents if item["status"] == "ready_for_review")
    assert reviewed["analysis"]["report_version"] == reviewed["timeline"][-1]["report_version"]
    assert not any(finding["severity"] == "blocking" for finding in reviewed["findings"])
    incomplete = next(item for item in incidents if item["status"] == "submitted")
    assert any(finding["severity"] == "blocking" for finding in incomplete["findings"])
    for item in incidents:
        if item["approval"]:
            assert item["asset"]["code"] in item["approval"]["work_method"]["description"]
            assert item["checklist"]
            assert {step["label"] for step in item["checklist"]} == {step["label"] for step in item["approval"]["work_method"]["steps"]}
    awaiting = next(item for item in incidents if item["status"] == "awaiting_verification")
    assert all(step["completed"] and step["notes"] for step in awaiting["checklist"])
    assert awaiting["timeline"][-1]["action"] == "submit_verification"
    # Restart a separate application against the same file; no reset or duplication.
    fresh = create_app(settings)
    with TestClient(fresh, base_url=settings.public_origin):
        with fresh.state.sessions() as db:
            for model in (User, Asset, Incident, AuditEvent):
                assert set(db.scalars(select(model.id))) == before_ids[model.__name__]
            assert db.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == "demo.seeded")) == 1


def test_concurrent_demo_startups_seed_once(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'startup.db'}", environment="demo")

    def start(_):
        app = create_app(settings)
        with TestClient(app) as client:
            assert client.get(PREFIX + "/setup/status").json() == {"needs_setup": False, "demo_available": True}

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(start, range(2)))
    engine, sessions = make_database(settings.database_url)
    try:
        with sessions() as db:
            assert db.scalar(select(func.count()).select_from(User)) == 4
            assert db.scalar(select(func.count()).select_from(Incident)) == 5
            assert db.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == "demo.seeded")) == 1
    finally:
        engine.dispose()


def test_failed_demo_seed_rolls_back_and_can_retry(tmp_path, monkeypatch):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'atomic.db'}", environment="demo")

    def failed_audit(*_):
        raise RuntimeError("synthetic seed failure")

    with monkeypatch.context() as patch:
        patch.setattr(main_module, "audit", failed_audit)
        app = create_app(settings)
        with pytest.raises(RuntimeError, match="synthetic seed failure"):
            with TestClient(app):
                pass
        with app.state.sessions() as db:
            assert not db.get(SetupLock, 1).completed
            for model in (User, Organization, Asset, Incident):
                assert db.scalar(select(func.count()).select_from(model)) == 0
        app.state.engine.dispose()
    with TestClient(create_app(settings)) as client:
        assert client.get(PREFIX + "/setup/status").json() == {"needs_setup": False, "demo_available": True}
        login(client)
        assert len(client.get(LIST).json()) == 4


def test_concurrent_switches_cannot_reuse_consumed_administrator_session(demo):
    app, client, settings = demo
    login(client)
    token = client.cookies.get(COOKIE)
    candidates = [TestClient(app, base_url=settings.public_origin) for _ in range(2)]
    try:
        for candidate in candidates:
            candidate.cookies.set(COOKIE, token)
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda candidate: candidate.post(SWITCH, json={"perspective": "worker"}), candidates))
        assert sorted(response.status_code for response in responses) == [200, 401]
        with app.state.sessions() as db:
            assert db.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == "session.perspective_switched")) == 1
    finally:
        for candidate in candidates:
            candidate.close()


@pytest.mark.parametrize("role", ["worker", "engineer", "supervisor", "admin"])
def test_demo_admin_switches_to_real_permissioned_audited_session(demo, role):
    app, client, _ = demo
    administrator = login(client)
    old_cookie = client.cookies.get(COOKIE)
    listing = client.get(LIST)
    assert listing.status_code == 200
    assert {item["role"] for item in listing.json()} == set(DEMO_PERSONAS)
    assert all(set(item) == {"key", "id", "name", "role"} for item in listing.json())
    all_incidents = client.get(PREFIX + "/incidents").json()
    response = client.post(SWITCH, json={"perspective": role})
    assert response.status_code == 200, response.text
    user = response.json()["user"]
    assert user["id"] == DEMO_USER_IDS[role] and user["role"] == role
    assert client.get(PREFIX + "/auth/me").json()["user"] == user
    new_cookie = client.cookies.get(COOKIE)
    assert new_cookie and new_cookie != old_cookie
    cookie_header = response.headers["set-cookie"].lower()
    assert all(value in cookie_header for value in ("httponly", "secure", "samesite=strict", "path=/api/v1", "max-age="))
    with app.state.sessions() as db:
        assert db.get(AuthSession, token_hash(old_cookie)) is None
        session = db.get(AuthSession, token_hash(new_cookie))
        assert session.user_id == user["id"] and session.site_id == user["site_id"]
        event = db.scalar(select(AdminAudit).where(AdminAudit.action == "session.perspective_switched"))
        assert event.actor_id == administrator["id"]
        assert role in event.note and user["id"] in event.note
        assert old_cookie not in event.note and new_cookie not in event.note
    expected = 200 if role == "admin" else 403
    assert client.get(LIST).status_code == 200
    assert client.get(PREFIX + "/admin/audit").status_code == expected
    assert client.get(PREFIX + "/metrics/summary").status_code == (403 if role == "worker" else 200)
    current_incidents = client.get(PREFIX + "/incidents").json()
    if role == "worker":
        assert len(current_incidents) == 4 < len(all_incidents)
        hidden = next(item for item in all_incidents if item["id"] not in {value["id"] for value in current_incidents})
        assert client.get(PREFIX + "/incidents/" + hidden["id"]).status_code == 404
        item = current_incidents[0]
        assert client.post(PREFIX + f'/incidents/{item["id"]}/actions', json={"action": "analyze", "version": item["version"]}).status_code == 403
    else:
        assert len(current_incidents) == len(all_incidents)
    with TestClient(app, base_url="https://demo.example.test") as stale:
        stale.cookies.set(COOKIE, old_cookie)
        assert stale.get(PREFIX + "/auth/me").status_code == 401
        assert stale.post(SWITCH, json={"perspective": "admin"}).status_code == 401


def test_public_entry_roundtrip_preserves_edits_and_real_permissions(demo):
    app, client, _ = demo
    opened = enter(client)
    controller = client.cookies.get(CONTROLLER_COOKIE)
    assert controller and controller != client.cookies.get(COOKIE)
    assert set(opened.json()) == {"user"}
    header = next(value.lower() for value in opened.headers.get_list("set-cookie") if value.startswith(CONTROLLER_COOKIE + "=") and "max-age=0" not in value.lower())
    assert all(value in header for value in ("httponly", "secure", "samesite=strict", f"path={CONTROLLER_PATH}", f"max-age={CONTROLLER_SECONDS}"))
    with app.state.sessions() as db:
        control = db.get(AuthSession, token_hash(controller))
        assert control.site_id == CONTROLLER_SCOPE and control.user_id == DEMO_USER_IDS["admin"]
    tokens = []
    edited_id = None
    for role in ("worker", "engineer", "supervisor", "admin"):
        tokens.append(client.cookies.get(COOKIE))
        response = client.post(SWITCH, json={"perspective": role})
        assert response.status_code == 200, response.text
        assert response.json()["user"]["role"] == role
        assert client.cookies.get(CONTROLLER_COOKIE) == controller  # Switching does not extend the fixed controller lifetime.
        assert client.get(LIST).status_code == 200
        assert client.get(PREFIX + "/auth/me").json()["user"]["role"] == role
        if role == "worker":
            assert client.get(PREFIX + "/admin/audit").status_code == 403
            item = next(item for item in client.get(PREFIX + "/incidents").json() if item["status"] == "submitted")
            payload = {key: item[key] for key in ("asset_id", "description", "impact", "injury_status", "safe_state", "measurements", "version")}
            payload.update(description="Example: operator observed alarm P7 after the press stopped.", impact="Example shift paused for review.", injury_status="none", safe_state="isolated", measurements="Example panel alarm P7; worker observation.")
            edited = client.patch(PREFIX + "/incidents/" + item["id"], json=payload)
            assert edited.status_code == 200, edited.text
            edited_id = item["id"]
        if role == "engineer":
            item = client.get(PREFIX + "/incidents/" + edited_id).json()
            assert item["description"] == "Example: operator observed alarm P7 after the press stopped."
            response = client.post(PREFIX + f'/incidents/{edited_id}/actions', json={"action": "analyze", "version": item["version"]})
            assert response.status_code == 200, response.text
            assert response.json()["analysis"]["report_version"] == item["version"]
            assert client.get(PREFIX + "/admin/audit").status_code == 403
    with app.state.sessions() as db:
        assert all(db.get(AuthSession, token_hash(token)) is None for token in tokens)
        events = list(db.scalars(select(AdminAudit).where(AdminAudit.action == "session.perspective_switched")))
        assert len(events) == 4 and all(event.actor_id == DEMO_USER_IDS["admin"] for event in events)
        stored = db.get(Incident, edited_id)
        assert stored.report["description"] == "Example: operator observed alarm P7 after the press stopped."


def test_ordinary_worker_login_does_not_inherit_controller(demo):
    app, client, _ = demo
    enter(client)
    controller = client.cookies.get(CONTROLLER_COOKIE)
    login(client, "worker")
    assert not client.cookies.get(CONTROLLER_COOKIE)
    assert client.get(LIST).status_code == 403
    assert client.post(SWITCH, json={"perspective": "admin"}).status_code == 403
    with app.state.sessions() as db:
        assert db.get(AuthSession, token_hash(controller)) is None


def test_controller_is_not_an_ordinary_session_and_logout_revokes_both(demo):
    app, client, settings = demo
    enter(client)
    controller = client.cookies.get(CONTROLLER_COOKIE)
    assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 200
    ordinary = client.cookies.get(COOKIE)
    with TestClient(app, base_url=settings.public_origin) as attacker:
        attacker.cookies.set(COOKIE, controller)
        for path in ("/auth/me", "/assets", "/incidents", "/admin/audit"):
            assert attacker.get(PREFIX + path).status_code == 401
        attacker.cookies.clear()
        attacker.cookies.set(CONTROLLER_COOKIE, controller)
        assert attacker.get(LIST).status_code == 401
        assert attacker.post(SWITCH, json={"perspective": "admin"}).status_code == 401
    response = client.post(PREFIX + "/auth/logout", json={})
    assert response.status_code == 200
    assert not client.cookies.get(COOKIE) and not client.cookies.get(CONTROLLER_COOKIE)
    assert any(value.startswith(CONTROLLER_COOKIE + "=") and "Max-Age=0" in value and f"Path={CONTROLLER_PATH}" in value for value in response.headers.get_list("set-cookie"))
    with app.state.sessions() as db:
        assert db.get(AuthSession, token_hash(controller)) is None
        assert db.get(AuthSession, token_hash(ordinary)) is None
    client.cookies.set(COOKIE, ordinary)
    client.cookies.set(CONTROLLER_COOKIE, controller)
    assert client.post(SWITCH, json={"perspective": "admin"}).status_code == 401


@pytest.mark.parametrize("invalidate", ["expired", "wrong_scope", "inactive_admin", "changed_site"])
def test_controller_expiry_and_seed_binding_are_enforced(demo, invalidate):
    app, client, _ = demo
    enter(client)
    assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 200
    with app.state.sessions() as db:
        session = db.get(AuthSession, token_hash(client.cookies.get(CONTROLLER_COOKIE)))
        if invalidate == "expired":
            session.expires_at = 0
        elif invalidate == "wrong_scope":
            session.site_id = DEMO_USER_IDS["worker"]
        elif invalidate == "inactive_admin":
            db.get(User, DEMO_USER_IDS["admin"]).active = False
        else:
            site = Site(organization_id=db.get(User, DEMO_USER_IDS["admin"]).organization_id, name="Other site")
            db.add(site)
            db.flush()
            db.get(User, DEMO_USER_IDS["admin"]).site_id = site.id
        db.commit()
    assert client.get(LIST).status_code == 403
    assert client.post(SWITCH, json={"perspective": "admin"}).status_code == 403
    assert client.get(PREFIX + "/admin/audit").status_code == 403


def test_demo_listing_switch_require_current_seeded_admin_and_valid_target(demo):
    app, client, _ = demo
    assert client.get(LIST).status_code == 401
    assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 401
    administrator = login(client)
    token = client.cookies.get(COOKIE)
    for body in ({"perspective": "unknown"}, {"perspective": "worker", "role": "admin"}, {"user_id": administrator["id"]}):
        assert client.post(SWITCH, json=body).status_code == 422
    assert client.post(SWITCH, json={"perspective": "worker"}, headers={"origin": "https://other.example.test"}).status_code == 403
    worker = DEMO_USER_IDS["worker"]
    assert client.patch(PREFIX + "/users/" + worker, json={"active": False}).status_code == 200
    assert "worker" not in {item["key"] for item in client.get(LIST).json()}
    assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 404
    assert client.cookies.get(COOKIE) == token
    with app.state.sessions() as db:
        db.get(User, DEMO_USER_IDS["engineer"]).role = "admin"
        db.commit()
    assert "engineer" not in {item["key"] for item in client.get(LIST).json()}
    assert client.post(SWITCH, json={"perspective": "engineer"}).status_code == 404
    created = client.post(PREFIX + "/users", json={"name": "Other Admin", "email": "other@example.test", "password": "other administrator password", "role": "admin"})
    assert created.status_code == 201
    with TestClient(app, base_url="https://demo.example.test") as other:
        assert other.post(PREFIX + "/auth/login", json={"email": "other@example.test", "password": "other administrator password"}).status_code == 200
        assert other.post(PREFIX + "/auth/change-password", json={"current_password": "other administrator password", "new_password": "new other administrator password"}).status_code == 200
        assert other.get(LIST).status_code == 403
        assert other.post(SWITCH, json={"perspective": "worker"}).status_code == 403


@pytest.mark.parametrize("environment", ["development", "test", "production"])
def test_non_demo_environments_never_seed_or_register_perspectives(tmp_path, monkeypatch, environment):
    # Production validation is real; only its connection is substituted because
    # this test checks environment boundaries without requiring a PostgreSQL host.
    database_url = f"sqlite:///{tmp_path / (environment + '.db')}"
    monkeypatch.setattr(main_module, "make_database", lambda _: make_database(database_url))
    settings = Settings(database_url="postgresql://user:password@db/servicetrail" if environment == "production" else database_url,
                        environment=environment, cookie_secure=True, public_origin="https://ops.example.test",
                        field_encryption_key=Fernet.generate_key().decode())
    app = create_app(settings)
    with TestClient(app, base_url=settings.public_origin) as client:
        assert client.get(PREFIX + "/setup/status").json()["needs_setup"] is True
        assert client.get(PREFIX + "/setup/status").json().get("demo_available", False) is False
        assert client.post(ENTER, json={}).status_code == 404
        assert LIST not in {route.path for route in app.routes} and SWITCH not in {route.path for route in app.routes}
        assert client.get(LIST).status_code == 404
        assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 404
        with app.state.sessions() as db:
            # Even a direct call to the backend seed helper is gated.
            seed_demo(db, settings, main_module.audit)
            assert db.scalar(select(func.count()).select_from(User)) == 0
            assert db.scalar(select(func.count()).select_from(Organization)) == 0
            assert db.scalar(select(func.count()).select_from(Asset)) == 0
            assert db.scalar(select(func.count()).select_from(Incident)) == 0
        response = client.post(PREFIX + "/setup", json={"organization_name": "Normal Org", "site_name": "Normal Site",
            "name": "Normal Admin", "email": DEMO_PERSONAS["admin"]["email"], "password": "normal administrator password"})
        assert response.status_code == 201
        assert client.get(LIST).status_code == 404
        assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 404
        for persona in DEMO_PERSONAS.values():
            assert client.post(PREFIX + "/auth/login", json={"email": persona["email"], "password": persona["password"]}).status_code == 401


def test_demo_never_adds_seed_to_preexisting_normal_setup(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'existing.db'}", environment="test")
    with TestClient(create_app(settings)) as client:
        response = client.post(PREFIX + "/setup", json={"organization_name": "Existing Org", "site_name": "Existing Site",
            "name": "Existing Admin", "email": DEMO_PERSONAS["admin"]["email"], "password": "existing administrator password"})
        assert response.status_code == 201
    app = create_app(replace(settings, environment="demo"))
    with TestClient(app) as client:
        assert client.get(PREFIX + "/setup/status").json()["demo_available"] is False
        assert client.post(ENTER, json={}).status_code == 404
        assert client.post(PREFIX + "/auth/login", json={"email": DEMO_PERSONAS["admin"]["email"], "password": "existing administrator password"}).status_code == 200
        assert client.get(LIST).status_code == 403  # Matching email is not proof of seeded identity.
        assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 403
        with app.state.sessions() as db:
            assert db.scalar(select(func.count()).select_from(User)) == 1
            assert db.scalar(select(func.count()).select_from(Asset)) == 0


@pytest.mark.parametrize("environment", ["development", "test", "production"])
def test_existing_demo_accounts_and_sessions_are_unusable_outside_demo(demo, monkeypatch, environment):
    app, client, settings = demo
    login(client)
    token = client.cookies.get(COOKIE)
    assert client.post(SWITCH, json={"perspective": "worker"}).status_code == 200
    token = client.cookies.get(COOKIE)
    controller = client.cookies.get(CONTROLLER_COOKIE)
    next_settings = replace(settings, environment=environment, field_encryption_key=Fernet.generate_key().decode())
    if environment == "production":
        monkeypatch.setattr(main_module, "make_database", lambda _: make_database(settings.database_url))
        next_settings = replace(next_settings, database_url="postgresql://user:password@db/servicetrail")
    with TestClient(create_app(next_settings), base_url=settings.public_origin) as non_demo:
        non_demo.cookies.set(COOKIE, token)
        non_demo.cookies.set(CONTROLLER_COOKIE, controller)
        assert non_demo.post(ENTER, json={}).status_code == 404
        for path in ("/auth/me", "/assets", "/incidents", "/users"):
            assert non_demo.get(PREFIX + path).status_code == 401
        assert non_demo.get(LIST).status_code == 404
        assert non_demo.post(SWITCH, json={"perspective": "worker"}).status_code == 404
        for role in DEMO_PERSONAS:
            assert non_demo.post(PREFIX + "/auth/login", json={"email": DEMO_PERSONAS[role]["email"], "password": DEMO_PERSONAS[role]["password"]}).status_code == 401


def test_demo_credentials_never_ship_in_frontend_readmes_or_api_payloads(demo):
    _, client, _ = demo
    login(client)
    text = "".join(client.get(path).text for path in (LIST, PREFIX + "/users", PREFIX + "/incidents", PREFIX + "/admin/audit"))
    for persona in DEMO_PERSONAS.values():
        assert persona["password"] not in text
    assert "password_hash" not in text and "token_hash" not in text
    root = Path(__file__).resolve().parents[2]
    files = list((root / "frontend" / "src").rglob("*")) + [root / "README.md", root / "backend" / "README.md"]
    for path in files:
        if path.is_file() and not any(part in {"node_modules", ".venv312", ".git", ".pytest_cache"} for part in path.parts):
            content = path.read_text(encoding="utf-8")
            for persona in DEMO_PERSONAS.values():
                assert persona["password"] not in content, path
            if "frontend" in path.parts:
                assert "demo.servicetrail.internal" not in content, path
