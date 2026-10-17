"""Pydantic request and response models used by the OpsBridge API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("text")
    @classmethod
    def report_must_contain_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Report text cannot be blank")
        return value


class SyncMetadata(BaseModel):
    version: int = Field(default=1, ge=1)
    updated_at: datetime
    is_deleted: bool = False
    sync_status: Literal["pending", "synced", "conflict"] = "pending"


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
    version: int = 1
    updated_at: datetime
    is_deleted: bool = False
    sync_status: Literal["pending", "synced", "conflict"] = "pending"


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
    version: int = 1
    updated_at: datetime
    is_deleted: bool = False
    sync_status: Literal["pending", "synced", "conflict"] = "pending"


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
    version: int = 1
    updated_at: datetime
    is_deleted: bool = False
    sync_status: Literal["pending", "synced", "conflict"] = "pending"


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
    version: int = 1
    updated_at: datetime
    is_deleted: bool = False
    sync_status: Literal["pending", "synced", "conflict"] = "pending"


class ChecklistItemUpdateRequest(BaseModel):
    item_id: str = Field(min_length=1)
    completed: bool
    notes: str | None = None


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
    version: int = 1
    updated_at: datetime
    is_deleted: bool = False
    sync_status: Literal["pending", "synced", "conflict"] = "pending"


class MutationRecord(BaseModel):
    mutation_id: str
    entity_type: str
    entity_id: str
    operation: Literal["create", "update", "delete"]
    version: int
    occurred_at: datetime
    payload: dict[str, Any] = Field(default_factory=dict)
    sync_status: Literal["pending", "synced", "conflict"] = "pending"


class SyncSummary(BaseModel):
    pending: int
    total: int
    mutations: list[MutationRecord] = Field(default_factory=list)


class BridgeHistory(BaseModel):
    """Current materialized state and mutation trail for one bridge session."""

    bridge_id: str
    scenario_id: str | None = None
    source_text: str | None = None
    parsed: ParsedEvent | None = None
    analysis: AnalysisResponse | None = None
    approval: ApprovalResponse | None = None
    checklist: ChecklistResponse | None = None
    status: StatusResponse | None = None
    mutations: list[MutationRecord] = Field(default_factory=list)
    updated_at: datetime


class DashboardSummary(BaseModel):
    """Small read model for an operator dashboard backed by live store state."""

    generated_at: datetime
    total_bridges: int
    active_bridges: int
    status_counts: dict[str, int] = Field(default_factory=dict)
    pending_approvals: int
    approved_bridges: int
    in_progress_bridges: int
    resolved_bridges: int
    blocked_bridges: int
    total_checklist_items: int
    completed_checklist_items: int
    checklist_completion_rate: float = Field(ge=0, le=1)
    recent_activity: list[MutationRecord] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    stored_bridges: int
    stored_analyses: int


class ErrorResponse(BaseModel):
    detail: str
    context: dict[str, Any] | None = None
