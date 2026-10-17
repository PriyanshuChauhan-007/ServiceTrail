"""Small, deterministic OpsBridge incident API.

The service deliberately keeps its state in memory: it is intended for the
operations console and local development, while retaining the same contracts a
persistent implementation can use later.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


CHECKLIST_LABELS = (
    "Acknowledge alert",
    "Verify thermal telemetry",
    "Isolate affected machine",
    "Inspect and repair equipment",
    "Return machine to service",
)


class Telemetry(BaseModel):
    """A machine telemetry sample used to report or recalculate an incident."""

    machine_id: str = Field(min_length=1)
    temperature: float = Field(ge=-100, le=2_000)
    vibration: float = Field(default=0.0, ge=0)
    pressure: float = Field(default=0.0, ge=0)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ChecklistStep(BaseModel):
    step: int = Field(ge=1, le=5)
    label: str
    completed: bool = False
    completed_at: datetime | None = None


class Incident(BaseModel):
    """Public incident representation returned by every incident endpoint."""

    id: str
    machine_id: str
    title: str
    severity: str
    status: str
    created_at: datetime
    telemetry: Telemetry
    thermal_trajectory: list[float]
    financial_loss: float
    hourly_loss: float
    approved: bool = False
    approval_note: str | None = None
    checklist: list[ChecklistStep]


class IncidentReport(BaseModel):
    telemetry: Telemetry
    title: str | None = None
    severity: str | None = None


class IncidentApproval(BaseModel):
    incident_id: str
    approved: bool = True
    note: str | None = None


class ToggleStep(BaseModel):
    incident_id: str
    step: int = Field(ge=1, le=5)
    completed: bool | None = None


def _trajectory(telemetry: Telemetry) -> list[float]:
    """Return a stable 12-point, six-hour thermal projection."""

    # Temperature decays toward a safe operating baseline; vibration and
    # pressure add a small deterministic risk component.  round() keeps JSON
    # output stable across platforms and avoids leaking NumPy scalar types.
    baseline = 72.0
    excess = max(0.0, telemetry.temperature - baseline)
    risk = telemetry.vibration * 1.5 + telemetry.pressure * 0.05
    points = baseline + (excess + risk) * np.exp(-np.linspace(0.0, 2.4, 12))
    return [round(float(value), 2) for value in points]


def _financial_loss(trajectory: list[float], severity: str) -> tuple[float, float]:
    """Estimate loss from thermal exposure and downtime, deterministically."""

    severity_multiplier = {"low": 1.0, "medium": 1.35, "high": 1.8, "critical": 2.5}.get(
        severity.lower(), 1.0
    )
    thermal_exposure = float(np.maximum(np.asarray(trajectory) - 100.0, 0).sum())
    hourly = round((1_500.0 + thermal_exposure * 42.0) * severity_multiplier, 2)
    return round(hourly * 2.0, 2), hourly


def _severity(telemetry: Telemetry) -> str:
    if telemetry.temperature >= 180 or telemetry.vibration >= 12:
        return "critical"
    if telemetry.temperature >= 140 or telemetry.vibration >= 8:
        return "high"
    if telemetry.temperature >= 105:
        return "medium"
    return "low"


def _new_incident(
    incident_id: str, telemetry: Telemetry, *, title: str | None = None, severity: str | None = None
) -> Incident:
    chosen_severity = (severity or _severity(telemetry)).lower()
    trajectory = _trajectory(telemetry)
    loss, hourly_loss = _financial_loss(trajectory, chosen_severity)
    return Incident(
        id=incident_id,
        machine_id=telemetry.machine_id,
        title=title or f"Thermal anomaly on {telemetry.machine_id}",
        severity=chosen_severity,
        status="open",
        created_at=telemetry.timestamp,
        telemetry=telemetry,
        thermal_trajectory=trajectory,
        financial_loss=loss,
        hourly_loss=hourly_loss,
        checklist=[ChecklistStep(step=index, label=label) for index, label in enumerate(CHECKLIST_LABELS, 1)],
    )


def _seed_incidents() -> dict[str, Incident]:
    # Fixed timestamps and values make local demos and tests reproducible.
    seed = (
        ("MCH-04", "MCH-04", 212.0, 14.0, 38.0, "critical"),
        ("MCH-02", "MCH-02", 154.0, 8.5, 31.0, "high"),
        ("MCH-07", "MCH-07", 126.0, 5.0, 28.0, "medium"),
        ("MCH-01", "MCH-01", 109.0, 3.0, 25.0, "medium"),
    )
    incidents: dict[str, Incident] = {}
    for index, (incident_id, machine_id, temperature, vibration, pressure, severity) in enumerate(seed):
        telemetry = Telemetry(
            machine_id=machine_id,
            temperature=temperature,
            vibration=vibration,
            pressure=pressure,
            timestamp=datetime(2026, 1, 1, 12, index, tzinfo=timezone.utc),
        )
        incidents[incident_id] = _new_incident(incident_id, telemetry, severity=severity)
    return incidents


app = FastAPI(title="OpsBridge API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
incidents = _seed_incidents()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/incidents", response_model=list[Incident])
def list_incidents() -> list[Incident]:
    return list(incidents.values())


@app.post("/api/incidents/report", response_model=Incident, status_code=201)
def report_incident(report: IncidentReport) -> Incident:
    incident_id = f"INC-{uuid4().hex[:8].upper()}"
    incident = _new_incident(incident_id, report.telemetry, title=report.title, severity=report.severity)
    incidents[incident_id] = incident
    return incident


@app.post("/api/incidents/approve", response_model=Incident)
def approve_incident(approval: IncidentApproval) -> Incident:
    incident = incidents.get(approval.incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.approved = approval.approved
    incident.approval_note = approval.note
    if approval.approved and incident.status == "open":
        incident.status = "in_progress"
    elif not approval.approved and incident.status != "resolved":
        incident.status = "open"
    return incident


@app.post("/api/incidents/toggle-step", response_model=Incident)
def toggle_step(toggle: ToggleStep) -> Incident:
    incident = incidents.get(toggle.incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    if not incident.approved:
        raise HTTPException(status_code=409, detail="Incident must be approved before resolving steps")
    checklist_step = next((step for step in incident.checklist if step.step == toggle.step), None)
    if checklist_step is None:  # guarded by Pydantic, retained for future model changes
        raise HTTPException(status_code=404, detail="Checklist step not found")
    checklist_step.completed = not checklist_step.completed if toggle.completed is None else toggle.completed
    checklist_step.completed_at = datetime.now(timezone.utc) if checklist_step.completed else None
    if all(step.completed for step in incident.checklist):
        incident.status = "resolved"
    elif incident.status == "resolved":
        incident.status = "in_progress"
    return incident
