import pytest
from fastapi.testclient import TestClient

from backend.main import app, store


@pytest.fixture(autouse=True)
def clean_store():
    store.__init__()


client = TestClient(app)


def test_blank_input_and_unknown_scenario_are_rejected():
    assert client.post("/api/bridge/parse", json={"text": "   "}).status_code == 422
    response = client.post("/api/bridge/parse", json={"text": "machine stopped", "scenario_id": "unknown"})
    assert response.status_code == 404


def test_hinglish_and_english_reports_parse_with_adapter_data():
    hinglish = client.post("/api/bridge/parse", json={"text": "Machine band ho gayi, motor garam hai at Bay 3", "scenario_id": "cnc_press_breakdown"}).json()
    english = client.post("/api/bridge/parse", json={"text": "Water leak near school road; 18 homes affected", "scenario_id": "water_main_break"}).json()
    assert "asset stopped" in hinglish["symptoms"]
    assert hinglish["severity"] == "high"
    assert english["scenario_id"] == "water_main_break"
    assert english["quantities"]["homes"] == 18


def test_approval_and_checklist_gating_then_end_to_end_resolution():
    parsed = client.post("/api/bridge/parse", json={"text": "Reefer truck 12 is late and temperature is 9C; 24 pallets", "scenario_id": "cold_chain_dispatch"}).json()
    analysis = client.post("/api/bridge/analyze", json={"parsed": parsed}).json()
    assert client.post("/api/bridge/checklist", json={"analysis_id": analysis["analysis_id"]}).status_code == 409
    approved = client.post("/api/bridge/approve", json={"analysis_id": analysis["analysis_id"], "decision": "approved", "approver": "Lead"})
    assert approved.status_code == 200
    checklist = client.post("/api/bridge/checklist", json={"analysis_id": analysis["analysis_id"]}).json()
    assert len(checklist["items"]) == 3
    assert client.patch("/api/bridge/status", json={"bridge_id": parsed["bridge_id"], "status": "resolved"}).status_code == 409
    for status in ("in_progress", "resolved"):
        response = client.patch("/api/bridge/status", json={"bridge_id": parsed["bridge_id"], "status": status})
        assert response.status_code == 200


def test_request_changes_requires_note_and_invalid_decision_transition():
    parsed = client.post("/api/bridge/parse", json={"text": "Press stopped with alarm", "scenario_id": "cnc_press_breakdown"}).json()
    analysis = client.post("/api/bridge/analyze", json={"parsed": parsed}).json()
    missing_note = client.post("/api/bridge/approve", json={"analysis_id": analysis["analysis_id"], "decision": "needs_changes", "approver": "Lead"})
    assert missing_note.status_code == 409
    noted = client.post("/api/bridge/approve", json={"analysis_id": analysis["analysis_id"], "decision": "needs_changes", "approver": "Lead", "note": "Capture alarm code"})
    assert noted.status_code == 200
    duplicate = client.post("/api/bridge/approve", json={"analysis_id": analysis["analysis_id"], "decision": "approved", "approver": "Lead"})
    assert duplicate.status_code == 409
