from sqlalchemy import func, select
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.database import AdminAudit, Organization, User
from backend.demo_seed import DEMO_PERSONAS, DEMO_USER_IDS
from backend.main import create_app
from backend.security import COOKIE


PREFIX = "/api/v1"


def registration_payload(email="owner@example.test"):
    return {
        "organization_name": "Acme Operations",
        "site_name": "Main Plant",
        "name": "Casey Owner",
        "email": email,
        "password": "a secure owner password",
    }


def demo_app(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'registration.db'}", environment="demo",
                        cookie_secure=True, public_origin="https://demo.example.test")
    return create_app(settings), settings


def test_public_registration_creates_personal_workspace_and_normal_admin_session(tmp_path):
    app, settings = demo_app(tmp_path)
    with TestClient(app, base_url=settings.public_origin) as client:
        response = client.post(PREFIX + "/auth/register", json=registration_payload("Owner@Example.TEST"))
        assert response.status_code == 201, response.text
        user = response.json()["user"]
        assert user["email"] == "owner@example.test"
        assert user["role"] == "admin"
        assert user["organization_name"] == "Acme Operations"
        assert user["site_name"] == "Main Plant"
        assert client.cookies.get(COOKIE)
        assert client.get(PREFIX + "/auth/me").json()["user"] == user
        assert client.get(PREFIX + "/auth/perspectives").status_code == 403
        assert client.post(PREFIX + "/auth/perspectives/switch", json={"perspective": "worker"}).status_code == 403

    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Organization)) == 2
        assert db.get(User, DEMO_USER_IDS["admin"]).organization_id != user["organization_id"]
        event = db.scalar(select(AdminAudit).where(AdminAudit.action == "organization.registered"))
        assert event and event.organization_id == user["organization_id"] and event.actor_id == user["id"]


def test_public_registration_conflicts_on_existing_email_without_partial_workspace(tmp_path):
    app, settings = demo_app(tmp_path)
    with TestClient(app, base_url=settings.public_origin) as client:
        response = client.post(PREFIX + "/auth/register", json=registration_payload(DEMO_PERSONAS["admin"]["email"]))
        assert response.status_code == 409, response.text
        assert client.get(PREFIX + "/auth/me").status_code == 401

    with app.state.sessions() as db:
        assert db.scalar(select(func.count()).select_from(Organization)) == 1
        assert db.scalar(select(func.count()).select_from(User)) == len(DEMO_PERSONAS)


def test_public_registration_forbids_role_selection(tmp_path):
    app, settings = demo_app(tmp_path)
    with TestClient(app, base_url=settings.public_origin) as client:
        assert client.post(PREFIX + "/auth/register", json={**registration_payload(), "role": "worker"}).status_code == 422
        assert client.post(PREFIX + "/auth/register", json={**registration_payload(), "password": "short"}).status_code == 422
