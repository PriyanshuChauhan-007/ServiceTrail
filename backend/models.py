"""Pydantic request and response models used by the OpsBridge API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Scenario(BaseModel):
    id: str
    name: str
    category: Literal["industrial", "civic", "logistics"]
    description: str
    criticality: Literal["low", "medium", "high", "critical"]
    tags: list[str] = Field(default_factory=list)
    sample_reports: list[str] = Field(default_factory=list)


class ParseRequest(BaseModel):
    text: str = Field(min_length=1)
    scenario_id: str | None = None


class ParsedEvent(BaseModel):
    bridge_id: str
    scenario_id: str
    source_text: str
    event_type: str
    asset_id: str | None = None
    machine: str | None = None
    location: str | None = None
    symptoms: list[str] = Field(default_factory=list)
    severity: Literal["low", "medium", "high", "critical"]
    safety_flags: list[str] = Field(default_factory=list)
    downtime_minutes: int | None = None
    quantities: dict[str, int] = Field(default_factory=dict)
    extracted_keywords: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)


class AnalyzeRequest(BaseModel):
    text: str | None = None
    parsed: ParsedEvent | None = None
    scenario_id: str | None = None
    bridge_id: str | None = None


class AnalysisResponse(BaseModel):
    analysis_id: str
    bridge_id: str
    scenario_id: str
    priority: Literal["low", "medium", "high", "critical"]
    summary: str
    root_cause_hypotheses: list[str] = Field(default_factory=list)
    recommended_actions: list[str] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)
    approval_required: bool
    approval_reasons: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0, le=1)
    status: str = "pending_approval"


class ApprovalRequest(BaseModel):
    analysis_id: str
    decision: Literal["approved", "rejected", "needs_changes"]
    approver: str = Field(min_length=1)
    note: str | None = None


class ApprovalResponse(BaseModel):
    analysis_id: str
    bridge_id: str
    decision: Literal["approved", "rejected", "needs_changes"]
    approved_by: str
    note: str | None = None
    status: str


class ChecklistRequest(BaseModel):
    analysis_id: str | None = None
    bridge_id: str | None = None
    scenario_id: str | None = None


class ChecklistItem(BaseModel):
    id: str
    label: str
    owner: str
    required: bool = True
    completed: bool = False
    notes: str | None = None


class ChecklistResponse(BaseModel):
    bridge_id: str
    scenario_id: str
    items: list[ChecklistItem]


class StatusUpdateRequest(BaseModel):
    status: Literal[
        "received",
        "parsed",
        "analyzed",
        "pending_approval",
        "approved",
        "in_progress",
        "resolved",
        "blocked",
    ]
    bridge_id: str | None = None
    analysis_id: str | None = None
    note: str | None = None
    updated_by: str = "operator"


class StatusResponse(BaseModel):
    bridge_id: str
    analysis_id: str | None = None
    status: str
    note: str | None = None
    updated_by: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    stored_bridges: int
    stored_analyses: int


class ErrorResponse(BaseModel):
    detail: str
    context: dict[str, Any] | None = None
