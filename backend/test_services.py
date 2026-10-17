import pytest

from backend.services import BridgeStore


def test_hinglish_industrial_report_extracts_operational_fields():
    store = BridgeStore()
    event = store.parse("Machine 04 ka motor overheat ho raha hai, production ruk gaya hai. Bay 3 mein 42 minutes se down.", "cnc_press_breakdown")
    assert event.asset_id == "MACHINE-04"
    assert event.location == "bay 3"
    assert "motor overheating" in event.symptoms
    assert event.downtime_minutes == 42
    assert event.severity == "high"
    assert event.impact_score > 25


def test_english_safety_report_requires_approval_and_generates_checklist():
    store = BridgeStore()
    event = store.parse("Press-07 stopped with oil mist near Bay 3 after 20 minutes of downtime.", "cnc_press_breakdown")
    analysis = store.analyze(event)
    assert analysis.approval_required is True
    approval = store.approve(analysis.analysis_id, "approved", "Riya Kapoor", "LOTO confirmed")
    assert approval.status == "approved"
    assert len(store.checklist(event.bridge_id, event.scenario_id).items) == 3


def test_rejected_approval_blocks_checklist():
    store = BridgeStore()
    event = store.parse("Reefer truck 12 is 90 minutes late and trailer reads 9C; 24 pallets need a check.", "cold_chain_dispatch")
    analysis = store.analyze(event)
    store.approve(analysis.analysis_id, "needs_changes", "Quality Lead", "Need an independent reading")
    with pytest.raises(ValueError, match="only after approval"):
        store.checklist(event.bridge_id, event.scenario_id)


def test_civic_and_logistics_adapters_keep_same_workflow_shape():
    store = BridgeStore()
    for text, scenario in [
        ("Large water leak at 5th and Pine; two lanes flooded and 18 homes affected.", "water_main_break"),
        ("Reefer truck 12 is 90 minutes late and trailer reads 9C; 24 pallets need a check.", "cold_chain_dispatch"),
    ]:
        event = store.parse(text, scenario)
        analysis = store.analyze(event)
        assert event.scenario_id == scenario
        assert analysis.bridge_id == event.bridge_id
