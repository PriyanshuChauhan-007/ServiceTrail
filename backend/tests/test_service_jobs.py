from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from backend.security import COOKIE


PREFIX = "/api/v1"


def app_for(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'service-jobs.db'}", environment="development",
                        cookie_secure=False, public_origin="http://testserver")
    return create_app(settings), settings


def registration(email):
    return {"organization_name": "BrightFix", "site_name": "Delhi Service Desk", "name": "Casey Owner",
            "email": email, "password": "a secure owner password"}


def test_service_job_can_be_created_and_assigned_to_a_technician(tmp_path):
    app, settings = app_for(tmp_path)
    with TestClient(app, base_url=settings.public_origin) as client:
        assert client.post(PREFIX + "/auth/register", json=registration("owner@example.test")).status_code == 201
        customer = client.post(PREFIX + "/customers", json={"name": "Asha Customer", "phone": "+91 90000 00000", "address": "Delhi"})
        assert customer.status_code == 201, customer.text
        technician = client.post(PREFIX + "/users", json={"name": "Ravi Technician", "email": "ravi@example.test", "password": "a secure technician password", "role": "worker"})
        assert technician.status_code == 200, technician.text
        job = client.post(PREFIX + "/service-jobs", json={"customer_id": customer.json()["id"], "request": "Ceiling fan is making a loud noise", "assigned_to_id": technician.json()["id"]})
        assert job.status_code == 201, job.text
        body = job.json()
        assert body["number"].startswith("JOB-")
        assert body["status"] == "assigned"
        assert body["assigned_to"]["name"] == "Ravi Technician"
        assert client.get(PREFIX + "/service-jobs").json()[0]["id"] == body["id"]


def test_service_jobs_are_scoped_to_the_authenticated_company(tmp_path):
    app, settings = app_for(tmp_path)
    with TestClient(app, base_url=settings.public_origin) as first:
        assert first.post(PREFIX + "/auth/register", json=registration("first@example.test")).status_code == 201
        customer = first.post(PREFIX + "/customers", json={"name": "First Customer"}).json()
        job = first.post(PREFIX + "/service-jobs", json={"customer_id": customer["id"], "request": "Water purifier service"}).json()
        assert job["id"] in {item["id"] for item in first.get(PREFIX + "/service-jobs").json()}

    with TestClient(app, base_url=settings.public_origin) as second:
        assert second.post(PREFIX + "/auth/register", json=registration("second@example.test")).status_code == 201
        assert second.get(PREFIX + "/service-jobs").json() == []
        assert second.get(PREFIX + f"/service-jobs/{job['id']}").status_code == 404
