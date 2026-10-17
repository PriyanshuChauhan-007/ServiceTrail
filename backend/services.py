"""Deterministic parsing, analysis, and in-memory workflow state for OpsBridge."""

from __future__ import annotations

import re
from uuid import uuid4

try:  # Support both ``backend.main`` and ``main`` when run from this folder.
    from .models import (
        AnalysisResponse,
        ApprovalResponse,
        ChecklistItem,
        ChecklistResponse,
        ParsedEvent,
        StatusResponse,
    )
    from .seed import SCENARIO_BY_ID
except ImportError:  # pragma: no cover - only used by the direct uvicorn entrypoint.
    from models import (  # type: ignore[no-redef]
        AnalysisResponse,
        ApprovalResponse,
        ChecklistItem,
        ChecklistResponse,
        ParsedEvent,
        StatusResponse,
    )
    from seed import SCENARIO_BY_ID  # type: ignore[no-redef]


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


class BridgeStore:
    """Process-local state; restarting the service intentionally clears the demo data."""

    def __init__(self) -> None:
        self.parsed: dict[str, ParsedEvent] = {}
        self.analyses: dict[str, AnalysisResponse] = {}
        self.approvals: dict[str, ApprovalResponse] = {}
        self.statuses: dict[str, StatusResponse] = {}
        self.checklists: dict[str, ChecklistResponse] = {}

    @staticmethod
    def choose_scenario(text: str, scenario_id: str | None = None) -> str:
        if scenario_id in SCENARIO_BY_ID:
            return scenario_id
        lowered = text.lower()
        if any(word in lowered for word in ("press", "cnc", "spindle", "hydraulic", "lathe")):
            return "cnc_press_breakdown"
        if any(word in lowered for word in ("water main", "burst pipe", "water leak", "hydrant", "flooded")):
            return "water_main_break"
        if any(word in lowered for word in ("reefer", "cold chain", "freezer", "pallet", "temperature")):
            return "cold_chain_dispatch"
        return "cnc_press_breakdown"

    def parse(self, text: str, scenario_id: str | None = None) -> ParsedEvent:
        lowered = text.lower()
        selected_id = self.choose_scenario(text, scenario_id)

        asset_match = re.search(
            r"\b((?:machine|press|cnc|pump|truck|reefer|freezer|valve|dock)[-_ ]?[a-z0-9]+)\b",
            lowered,
        )
        asset_id = asset_match.group(1).upper().replace(" ", "-") if asset_match else None

        location = None
        location_match = re.search(
            r"\b(?:at|near|by|in)\s+([a-z0-9][a-z0-9 .&'-]{2,48})",
            lowered,
        )
        if location_match:
            location = location_match.group(1).strip(" .,-")[:48]

        severity = "low"
        if any(word in lowered for word in ("critical", "emergency", "injury", "fire", "evacuate")):
            severity = "critical"
        elif any(word in lowered for word in ("unsafe", "hazard", "flooded", "leak", "shutdown", "stopped", "band", "ruk gaya", "overheat", "overheating")):
            severity = "high"
        elif any(word in lowered for word in ("delay", "warning", "vibration", "noise", "late")):
            severity = "medium"

        symptom_rules = {
            "hydraulic alarm": "hydraulic alarm",
            "oil mist": "oil mist",
            "vibrat": "excessive vibration",
            "sharp noise": "abnormal noise",
            "stopped": "asset stopped",
            "band": "asset stopped",
            "ruk gaya": "production stopped",
            "overheat": "motor overheating",
            "overheating": "motor overheating",
            "production": "production interruption",
            "water leak": "water leak",
            "burst pipe": "burst pipe",
            "flood": "flooding",
            "temperature": "temperature excursion",
            "sensor": "sensor failure",
            "late": "route delay",
        }
        symptoms = [label for marker, label in symptom_rules.items() if marker in lowered]

        safety_rules = {
            "injury": "reported injury",
            "fire": "fire risk",
            "oil": "slip or chemical exposure",
            "leak": "leak containment",
            "flood": "standing water and traffic hazard",
            "unsafe": "unsafe operating condition",
            "overheat": "thermal overload risk",
            "overheating": "thermal overload risk",
            "temperature": "product safety hold",
        }
        safety_flags = [label for marker, label in safety_rules.items() if marker in lowered]

        downtime_minutes = None
        downtime_match = re.search(r"(\d+)\s*(minutes?|mins?|hours?|hrs?)", lowered)
        if downtime_match:
            amount = int(downtime_match.group(1))
            downtime_minutes = amount * 60 if downtime_match.group(2).startswith(("hour", "hr")) else amount

        quantities: dict[str, int] = {}
        for unit in ("pallets", "homes", "households", "lanes", "trucks", "operators"):
            quantity_match = re.search(rf"(\d+)\s+{unit}", lowered)
            if quantity_match:
                quantities[unit] = int(quantity_match.group(1))

        event_type = {
            "cnc_press_breakdown": "equipment_breakdown",
            "water_main_break": "public_utility_failure",
            "cold_chain_dispatch": "logistics_interruption",
        }[selected_id]
        keywords = sorted(
            {
                word
                for word in re.findall(r"[a-z][a-z0-9-]+", lowered)
                if word in {"alarm", "breakdown", "delay", "fire", "flooded", "leak", "repair", "shutdown", "stopped", "unsafe", "vibration"}
            }
        )
        confidence = min(0.96, 0.58 + (0.08 if asset_id else 0) + min(0.2, len(symptoms) * 0.05) + (0.1 if scenario_id else 0))
        parsed = ParsedEvent(
            bridge_id=_new_id("bridge"),
            scenario_id=selected_id,
            source_text=text,
            event_type=event_type,
            asset_id=asset_id,
            machine=asset_id,
            location=location,
            symptoms=symptoms,
            severity=severity,
            safety_flags=safety_flags,
            downtime_minutes=downtime_minutes,
            quantities=quantities,
            extracted_keywords=keywords,
            confidence=round(confidence, 2),
        )
        self.parsed[parsed.bridge_id] = parsed
        self.statuses[parsed.bridge_id] = StatusResponse(
            bridge_id=parsed.bridge_id,
            status="parsed",
            updated_by="bridge-parser",
        )
        return parsed

    def analyze(self, parsed: ParsedEvent) -> AnalysisResponse:
        scenario = SCENARIO_BY_ID[parsed.scenario_id]
        priority = parsed.severity
        if parsed.safety_flags and priority == "medium":
            priority = "high"
        if scenario.criticality == "critical" and priority in ("low", "medium"):
            priority = "high"

        if parsed.scenario_id == "cnc_press_breakdown":
            hypotheses = [
                "Hydraulic pressure loss or hose/seal failure",
                "Unexpected tooling load or mechanical obstruction",
                "Control/interlock trip requiring a qualified reset",
            ]
            actions = [
                "Stop the cell and apply lockout/tagout before inspection.",
                "Confirm operator safety, capture alarm codes, and inspect for leaks or damage.",
                "Have a qualified maintenance lead verify the repair before a guarded test cycle.",
            ]
        elif parsed.scenario_id == "water_main_break":
            hypotheses = ["Aged or shifted main joint", "Freeze/thaw or ground movement", "Unexpected pressure surge"]
            actions = [
                "Isolate the nearest valve and establish a safe work zone.",
                "Coordinate traffic control and issue a resident/service interruption notice.",
                "Inspect water quality and document the repair before reopening the road.",
            ]
        else:
            hypotheses = ["Refrigeration unit or sensor fault", "Route/vehicle scheduling disruption", "Loading delay at the dock"]
            actions = [
                "Place the shipment on quality hold and record an independent temperature reading.",
                "Notify dispatch and arrange an approved refrigerated vehicle or alternate facility.",
                "Release only after the quality lead reviews the temperature log.",
            ]

        approval_reasons = ["Safety-impacting work requires an accountable operator."] if parsed.safety_flags else []
        if parsed.scenario_id == "water_main_break":
            approval_reasons.append("Public access and service interruption need civic operations approval.")
        if parsed.scenario_id == "cold_chain_dispatch":
            approval_reasons.append("Product release requires a quality decision.")
        approval_required = bool(approval_reasons) or priority in ("high", "critical")
        if approval_required and not approval_reasons:
            approval_reasons.append("High-priority work requires an accountable operator.")

        analysis = AnalysisResponse(
            analysis_id=_new_id("analysis"),
            bridge_id=parsed.bridge_id,
            scenario_id=parsed.scenario_id,
            priority=priority,
            summary=f"{scenario.name}: {parsed.event_type.replace('_', ' ')} at {parsed.location or 'reported location'}.",
            root_cause_hypotheses=hypotheses,
            recommended_actions=actions,
            safety_flags=parsed.safety_flags,
            approval_required=approval_required,
            approval_reasons=approval_reasons,
            confidence=round(min(0.95, parsed.confidence + 0.03), 2),
            status="pending_approval" if approval_required else "analyzed",
        )
        self.analyses[analysis.analysis_id] = analysis
        self.statuses[parsed.bridge_id] = StatusResponse(
            bridge_id=parsed.bridge_id,
            analysis_id=analysis.analysis_id,
            status=analysis.status,
            updated_by="bridge-analyzer",
        )
        return analysis

    def approve(self, analysis_id: str, decision: str, approver: str, note: str | None) -> ApprovalResponse:
        analysis = self.analyses[analysis_id]
        status = "approved" if decision == "approved" else "blocked"
        approval = ApprovalResponse(
            analysis_id=analysis_id,
            bridge_id=analysis.bridge_id,
            decision=decision,  # type: ignore[arg-type]
            approved_by=approver,
            note=note,
            status=status,
        )
        self.approvals[analysis_id] = approval
        self.analyses[analysis_id] = analysis.model_copy(update={"status": status})
        self.statuses[analysis.bridge_id] = StatusResponse(
            bridge_id=analysis.bridge_id,
            analysis_id=analysis_id,
            status=status,
            note=note,
            updated_by=approver,
        )
        return approval

    def checklist(self, bridge_id: str, scenario_id: str) -> ChecklistResponse:
        templates = {
            "cnc_press_breakdown": [
                ("isolate", "Apply lockout/tagout and verify zero energy", "maintenance"),
                ("inspect", "Record alarm code, leak, and damaged components", "maintenance"),
                ("brief", "Brief operators before the guarded test cycle", "shift-lead"),
            ],
            "water_main_break": [
                ("isolate", "Close the nearest valve and confirm isolation", "public-works"),
                ("secure", "Set barriers and coordinate traffic control", "field-supervisor"),
                ("notify", "Notify affected residents and dispatch", "civic-operations"),
            ],
            "cold_chain_dispatch": [
                ("hold", "Place affected product on quality hold", "warehouse"),
                ("measure", "Capture independent product and trailer temperatures", "quality"),
                ("reroute", "Book an approved reefer and update consignee", "dispatch"),
            ],
        }
        items = [ChecklistItem(id=item_id, label=label, owner=owner) for item_id, label, owner in templates[scenario_id]]
        result = ChecklistResponse(bridge_id=bridge_id, scenario_id=scenario_id, items=items)
        self.checklists[bridge_id] = result
        return result
