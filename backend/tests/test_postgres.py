"""Real PostgreSQL acceptance check; isolated schema, never a shared application DB.

CI provisions an ephemeral PostgreSQL service and sets TEST_POSTGRES_URL. Local
runs skip this check unless that explicit test-only connection is supplied.
"""
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url

from backend.config import Settings
from backend.database import make_database
from backend.main import create_app
from backend.security import totp


@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_URL"), reason="TEST_POSTGRES_URL not configured; PostgreSQL runtime not tested")
def test_postgresql_authenticated_workflow_and_restart():
    root_url = os.environ["TEST_POSTGRES_URL"]
    root, _ = make_database(root_url)
    schema = "acceptance_" + uuid4().hex
    with root.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = make_url(root_url).update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)
    settings = Settings(database_url=url, environment="test")
    try:
        app = create_app(settings)
        with TestClient(app) as admin:
            password = "postgres-only test passphrase"
            response = admin.post("/api/v1/setup", json={"organization_name": "Postgres Acceptance", "site_name": "Plant", "name": "Test Administrator", "email": "admin@example.test", "password": password})
            assert response.status_code == 201, response.text
            for role in ("worker", "engineer"):
                response = admin.post("/api/v1/users", json={"name": f"Test {role}", "email": f"{role}@example.test", "password": password, "role": role})
                assert response.status_code == 201, response.text
            asset = admin.post("/api/v1/assets", json={"code": "PG-01", "name": "Postgres press", "area": "Bay 1", "criticality": "high"}).json()
            with TestClient(app) as worker, TestClient(app) as engineer:
                for client, role in ((worker, "worker"), (engineer, "engineer")):
                    assert client.post("/api/v1/auth/login", json={"email": f"{role}@example.test", "password": password}).status_code == 200
                    assert client.post("/api/v1/auth/change-password", json={"current_password": password, "new_password": password + " rotated"}).status_code == 200
                body = {"asset_id": asset["id"], "description": "Press stopped after a protective alarm during production.", "impact": "Production stopped, duration unconfirmed.", "injury_status": "none", "safe_state": "isolated", "measurements": "Panel alarm X7 reported.", "client_id": str(uuid4())}
                created = worker.post("/api/v1/incidents", json=body)
                assert created.status_code == 201, created.text
                item = created.json()
                replay = worker.post("/api/v1/incidents", json=body)
                assert replay.status_code == 200 and replay.json()["id"] == item["id"]
                route = f'/api/v1/incidents/{item["id"]}/actions'
                assert worker.post(route, json={"action": "approve", "version": item["version"], "note": "Cannot self approve"}).status_code == 403
                analyzed = engineer.post(route, json={"action": "analyze", "version": item["version"]})
                assert analyzed.status_code == 200, analyzed.text
                stale = engineer.post(route, json={"action": "analyze", "version": item["version"]})
                assert stale.status_code == 409
                analyzed_item = analyzed.json()
                approved = engineer.post(route, json={"action": "approve", "version": analyzed_item["version"], "note": "Independent review recorded", "review_confirmed": True})
                assert approved.status_code == 200, approved.text
                with TestClient(create_app(settings)) as fresh:
                    fresh.post("/api/v1/auth/login", json={"email": "worker@example.test", "password": password + " rotated"})
                    persisted = fresh.get(f'/api/v1/incidents/{item["id"]}')
                    assert persisted.status_code == 200 and persisted.json()["status"] == "approved"
                    exported = fresh.get(f'/api/v1/incidents/{item["id"]}/export').json()
                    assert [event["action"] for event in exported["audit_events"]] == ["submitted", "analyze", "approve"]
    finally:
        with root.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        root.dispose()


@pytest.mark.skipif(not os.getenv("TEST_POSTGRES_URL"), reason="TEST_POSTGRES_URL not configured; PostgreSQL completion runtime not tested")
def test_postgresql_completion_security_scope_operations_and_inbound():
    """Exercise new tables, JSON queries and transactional locks on real PostgreSQL."""
    from concurrent.futures import ThreadPoolExecutor
    from backend.tests.test_workflow import PASSWORD, PREFIX, action, bootstrap, ok, png
    from backend.database import Incident

    root_url = os.environ["TEST_POSTGRES_URL"]
    root, _ = make_database(root_url)
    schema = "completion_" + uuid4().hex
    with root.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = make_url(root_url).update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(hide_password=False)
    settings = Settings(database_url=url, environment="test", login_limit=100, max_evidence_per_incident=1)
    try:
        app = create_app(settings)
        with TestClient(app) as admin:
            admin_user = ok(bootstrap(admin), 201)["user"]
            engineer_user = ok(admin.post(PREFIX + "/users", json={"name": "Reviewer", "email": "engineer@example.test", "password": PASSWORD, "role": "engineer"}), 201)
            asset = ok(admin.post(PREFIX + "/assets", json={"code": "PG-C", "name": "Registered", "area": "Bay", "criticality": "high"}), 201)
            with TestClient(app) as engineer:
                ok(engineer.post(PREFIX + "/auth/login", json={"email": engineer_user["email"], "password": PASSWORD}))
                assert engineer.post(PREFIX + "/work-methods", json={"name": "Forbidden until rotation", "steps": [{"label": "Record", "required": True}]}).status_code == 403
                ok(engineer.post(PREFIX + "/auth/change-password", json={"current_password": PASSWORD, "new_password": PASSWORD + " rotated"}))
                method = ok(engineer.post(PREFIX + "/work-methods", json={"name": "Site record", "steps": [{"label": "Record approved site work", "required": True}]}), 201)
                incident = ok(admin.post(PREFIX + "/incidents", json={"asset_id": asset["id"], "description": "Protective alarm stopped equipment during production.", "impact": "Production interrupted", "injury_status": "none", "safe_state": "isolated"}), 201)
                queue = ok(engineer.get(PREFIX + "/incidents/page?search=Protective&limit=1"))
                assert queue["total"] == 1 and queue["items"][0]["id"] == incident["id"]
                incident = action(engineer, incident, "schedule", due_at="2020-01-01T00:00:00Z", note="Site review deadline")
                incident = ok(admin.post(f'{PREFIX}/incidents/{incident["id"]}/evidence', files={"file": ("e.png", png(), "image/png")}), 201)
                assert admin.post(f'{PREFIX}/incidents/{incident["id"]}/evidence', files={"file": ("e.png", png(), "image/png")}).status_code == 413
                incident = action(engineer, incident, "analyze")
                incident = action(engineer, incident, "approve", review_confirmed=True, work_method_id=method["id"], note="Independent site review")
                assert incident["approval"]["work_method"] == method
                assert ok(engineer.get(PREFIX + "/metrics/summary"))["overdue"] == 1
                assert any(item["title"] == "Work approved" for item in ok(admin.get(PREFIX + "/notifications")))
                pending = ok(engineer.post(PREFIX + "/auth/mfa/enroll", json={"password": PASSWORD + " rotated"}))
                codes = ok(engineer.post(PREFIX + "/auth/mfa/confirm", json={"otp": totp(pending["secret"])}))["recovery_codes"]
                one, two = TestClient(app), TestClient(app)
                with ThreadPoolExecutor(max_workers=2) as pool:
                    responses = list(pool.map(lambda client: client.post(PREFIX + "/auth/login", json={"email": engineer_user["email"], "password": PASSWORD + " rotated", "recovery_code": codes[0]}), (one, two)))
                assert sorted(response.status_code for response in responses) == [200, 401]
                recovery = ok(admin.post(f'{PREFIX}/users/{engineer_user["id"]}/recovery'))
                ok(one.post(PREFIX + "/auth/reset-password", json={"token": recovery["token"], "new_password": PASSWORD + " reset"}))
                assert engineer.get(PREFIX + "/auth/me").status_code == 401
                assert two.post(PREFIX + "/auth/login", json={"email": engineer_user["email"], "password": PASSWORD + " reset"}).json()["detail"] == "MFA code required"
                integration = ok(admin.post(PREFIX + "/integrations", json={"name": "Inbound"}), 201)
                inbound = f'{PREFIX}/integrations/{integration["id"]}/observations'
                body = {"external_id": "PG-1", "asset_code": "PG-C", "observed_at": "2026-01-01T00:00:00Z", "measurements": {"reported": 4}}
                headers = {"authorization": "Bearer " + integration["token"]}
                with ThreadPoolExecutor(max_workers=2) as pool:
                    responses = list(pool.map(lambda client: client.post(inbound, json=body, headers=headers), (one, two)))
                assert sorted(response.status_code for response in responses) == [200, 201]
                assert responses[0].json()["id"] == responses[1].json()["id"]
                ok(admin.patch(f'{PREFIX}/users/{engineer_user["id"]}', json={"active": False}))
                assert one.post(PREFIX + "/auth/login", json={"email": engineer_user["email"], "password": PASSWORD + " reset", "recovery_code": codes[1]}).status_code == 401
                old_token = admin.cookies.get("opsbridge_session")
                site = ok(admin.post(PREFIX + "/sites", json={"name": "PG Second Site"}), 201)
                ok(admin.post(PREFIX + "/auth/switch-site", json={"site_id": site["id"]}))
                assert ok(admin.get(PREFIX + "/incidents/page"))["total"] == 0
                one.cookies.set("opsbridge_session", old_token)
                assert one.get(PREFIX + "/auth/me").status_code == 401
                assert ok(admin.get(PREFIX + "/admin/audit"))["total"] > 0
    finally:
        with root.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        root.dispose()
