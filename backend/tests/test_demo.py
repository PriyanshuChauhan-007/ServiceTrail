import pytest
from fastapi.testclient import TestClient

import backend.main as main_module
from backend.config import Settings
from backend.main import create_app


def test_demo_environment_accepts_ephemeral_sqlite():
    settings = Settings(database_url="sqlite:///:memory:", environment="demo", cookie_secure=True)
    settings.validate()


def test_production_still_rejects_sqlite_without_required_origin_and_key():
    settings = Settings(database_url="sqlite:///:memory:", environment="production", cookie_secure=True)
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        settings.validate()


def test_frontend_is_optional_and_does_not_capture_api_routes(monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html><body>demo shell</body></html>", encoding="utf-8")
    monkeypatch.setattr(main_module, "FRONTEND_DIST", dist)
    app = create_app(Settings(database_url="sqlite:///:memory:", environment="demo", cookie_secure=True))

    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        response = client.get("/")
        assert "demo shell" in response.text
        assert "script-src 'self'" in response.headers["content-security-policy"]
        assert client.get("/api/v1/health").json()["status"] == "ok"
        assert client.get("/api/v1/not-a-route").status_code == 404


def test_missing_frontend_build_leaves_root_unhandled(monkeypatch, tmp_path):
    monkeypatch.setattr(main_module, "FRONTEND_DIST", tmp_path / "missing-dist")
    app = create_app(Settings(database_url="sqlite:///:memory:", environment="demo"))

    with TestClient(app) as client:
        assert client.get("/").status_code == 404


def test_demo_environment_starts_uninitialized_without_seeded_accounts():
    app = create_app(Settings(database_url="sqlite:///:memory:", environment="demo"))
    with TestClient(app) as client:
        status = client.get("/api/v1/setup/status").json()
        assert status["needs_setup"] is True
