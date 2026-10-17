"""OpsBridge: a small offline-first FastAPI coordination API.

Run locally with: ``uvicorn backend.main:app --reload`` from the ``opsbridge`` directory.
State is deliberately in memory so the prototype remains usable without a database or network.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

try:  # Support both ``backend.main`` and ``main`` when run from this folder.
    from .models import (
        AnalysisResponse,
        AnalyzeRequest,
        ApprovalRequest,
        ApprovalResponse,
        ChecklistRequest,
        ChecklistResponse,
        HealthResponse,
        ParseRequest,
        ParsedEvent,
        Scenario,
        StatusResponse,
        StatusUpdateRequest,
    )
    from .seed import SCENARIOS
    from .services import BridgeStore
except ImportError:  # pragma: no cover - only used by the direct uvicorn entrypoint.
    from models import (  # type: ignore[no-redef]
        AnalysisResponse,
        AnalyzeRequest,
        ApprovalRequest,
        ApprovalResponse,
        ChecklistRequest,
        ChecklistResponse,
        HealthResponse,
        ParseRequest,
        ParsedEvent,
        Scenario,
        StatusResponse,
        StatusUpdateRequest,
    )
    from seed import SCENARIOS  # type: ignore[no-redef]
    from services import BridgeStore  # type: ignore[no-redef]


app = FastAPI(title="OpsBridge API", version="0.1.0", description="Offline-first incident bridge prototype")
store = BridgeStore()


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="opsbridge-backend",
        version=app.version,
        stored_bridges=len(store.parsed),
        stored_analyses=len(store.analyses),
    )


@app.get("/api/scenarios", response_model=list[Scenario])
def scenarios() -> list[Scenario]:
    return SCENARIOS


@app.post("/api/bridge/parse", response_model=ParsedEvent)
def parse_bridge(request: ParseRequest) -> ParsedEvent:
    if request.scenario_id and request.scenario_id not in {scenario.id for scenario in SCENARIOS}:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {request.scenario_id}")
    return store.parse(request.text, request.scenario_id)


@app.post("/api/bridge/analyze", response_model=AnalysisResponse)
def analyze_bridge(request: AnalyzeRequest) -> AnalysisResponse:
    parsed = request.parsed
    if parsed is None and request.bridge_id:
        parsed = store.parsed.get(request.bridge_id)
        if parsed is None:
            raise HTTPException(status_code=404, detail=f"Unknown bridge: {request.bridge_id}")
    if parsed is None and request.text:
        parsed = store.parse(request.text, request.scenario_id)
    if parsed is None:
        raise HTTPException(status_code=422, detail="Provide text, parsed event, or bridge_id")
    if parsed.scenario_id not in {scenario.id for scenario in SCENARIOS}:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {parsed.scenario_id}")
    return store.analyze(parsed)


@app.post("/api/bridge/approve", response_model=ApprovalResponse)
def approve_bridge(request: ApprovalRequest) -> ApprovalResponse:
    if request.analysis_id not in store.analyses:
        raise HTTPException(status_code=404, detail=f"Unknown analysis: {request.analysis_id}")
    return store.approve(request.analysis_id, request.decision, request.approver, request.note)


@app.post("/api/bridge/checklist", response_model=ChecklistResponse)
def bridge_checklist(request: ChecklistRequest) -> ChecklistResponse:
    bridge_id = request.bridge_id
    scenario_id = request.scenario_id
    if request.analysis_id:
        analysis = store.analyses.get(request.analysis_id)
        if analysis is None:
            raise HTTPException(status_code=404, detail=f"Unknown analysis: {request.analysis_id}")
        bridge_id = bridge_id or analysis.bridge_id
        scenario_id = scenario_id or analysis.scenario_id
    if bridge_id and bridge_id in store.parsed:
        scenario_id = scenario_id or store.parsed[bridge_id].scenario_id
    if not bridge_id or not scenario_id:
        raise HTTPException(status_code=422, detail="Provide analysis_id, or both bridge_id and scenario_id")
    if scenario_id not in {scenario.id for scenario in SCENARIOS}:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}")
    try:
        return store.checklist(bridge_id, scenario_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.patch("/api/bridge/status", response_model=StatusResponse)
def update_bridge_status(request: StatusUpdateRequest) -> StatusResponse:
    bridge_id = request.bridge_id
    analysis_id = request.analysis_id
    if analysis_id:
        analysis = store.analyses.get(analysis_id)
        if analysis is None:
            raise HTTPException(status_code=404, detail=f"Unknown analysis: {analysis_id}")
        bridge_id = bridge_id or analysis.bridge_id
    if not bridge_id:
        raise HTTPException(status_code=422, detail="Provide bridge_id or analysis_id")
    status = StatusResponse(
        bridge_id=bridge_id,
        analysis_id=analysis_id,
        status=request.status,
        note=request.note,
        updated_by=request.updated_by,
    )
    store.statuses[bridge_id] = status
    return status
