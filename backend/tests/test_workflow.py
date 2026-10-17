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


def test_history_and_summary_reflect_full_lifecycle_and_mutation_metadata():
    parsed = client.post(
        "/api/bridge/parse",
        json={"text": "Press-07 stopped with a hydraulic alarm at Bay 3", "scenario_id": "cnc_press_breakdown"},
    ).json()
    bridge_id = parsed["bridge_id"]
    before_analysis = client.get("/api/dashboard/summary").json()
    assert before_analysis["total_bridges"] == 1
    assert before_analysis["status_counts"] == {"parsed": 1}

    analysis = client.post("/api/bridge/analyze", json={"bridge_id": bridge_id}).json()
    assert client.get("/api/dashboard/summary").json()["pending_approvals"] == 1
    approved = client.post(
        "/api/bridge/approve",
        json={"analysis_id": analysis["analysis_id"], "decision": "approved", "approver": "shift lead"},
    )
    assert approved.status_code == 200
    checklist = client.post("/api/bridge/checklist", json={"analysis_id": analysis["analysis_id"]}).json()

    updated = client.patch(
        f"/api/bridge/checklist/{bridge_id}",
        json={"item_id": checklist["items"][0]["id"], "completed": True, "notes": "Isolation verified"},
    )
    assert updated.status_code == 200
    assert updated.json()["items"][0]["completed"] is True
    assert updated.json()["items"][0]["notes"] == "Isolation verified"

    assert client.patch("/api/bridge/status", json={"bridge_id": bridge_id, "status": "in_progress"}).status_code == 200
    assert client.patch("/api/bridge/status", json={"bridge_id": bridge_id, "status": "resolved"}).status_code == 200

    history_response = client.get("/api/bridge/history", params={"bridge_id": bridge_id})
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 1
    session = history[0]
    assert session["parsed"]["bridge_id"] == bridge_id
    assert session["analysis"]["analysis_id"] == analysis["analysis_id"]
    assert session["approval"]["decision"] == "approved"
    assert session["checklist"]["items"][0]["completed"] is True
    assert session["status"]["status"] == "resolved"
    assert {mutation["entity_type"] for mutation in session["mutations"]} >= {
        "bridge",
        "analysis",
        "approval",
        "checklist",
        "status",
    }

    summary = client.get("/api/dashboard/summary").json()
    assert summary["total_bridges"] == 1
    assert summary["active_bridges"] == 0
    assert summary["resolved_bridges"] == 1
    assert summary["status_counts"]["resolved"] == 1
    assert summary["total_checklist_items"] == 3
    assert summary["completed_checklist_items"] == 1
    assert summary["checklist_completion_rate"] == pytest.approx(1 / 3)


def test_checklist_update_rejects_unknown_items_and_preserves_progress_on_read():
    parsed = client.post("/api/bridge/parse", json={"text": "Water leak near school", "scenario_id": "water_main_break"}).json()
    analysis = client.post("/api/bridge/analyze", json={"bridge_id": parsed["bridge_id"]}).json()
    client.post("/api/bridge/approve", json={"analysis_id": analysis["analysis_id"], "decision": "approved", "approver": "field lead"})
    checklist = client.post("/api/bridge/checklist", json={"analysis_id": analysis["analysis_id"]}).json()
    unknown = client.patch(
        f"/api/bridge/checklist/{parsed['bridge_id']}",
        json={"item_id": "missing", "completed": True},
    )
    assert unknown.status_code == 404
    repeat = client.post("/api/bridge/checklist", json={"analysis_id": analysis["analysis_id"]}).json()
    assert repeat["items"] == checklist["items"]
