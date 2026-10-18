"""Explainable conservative rules: observations are never verified measurements."""
import re
from uuid import uuid4


def assess(report: dict, has_evidence: bool) -> tuple[list[dict], str]:
    findings = []

    def add(field, label, message, severity="blocking"):
        findings.append(dict(field=field, label=label, message=message, severity=severity, source="rule"))

    if len(report["description"].strip()) < 20:
        add("description", "Clarify observation", "Describe the observed symptom and context in more detail.")
    if not report["impact"].strip():
        add("impact", "Missing impact", "Record the observed production or safety impact; unknown may be stated explicitly.")
    if report["injury_status"] == "unknown":
        add("injury_status", "Unconfirmed personnel safety", "Confirm whether an injury was reported before review.")
    if report["safe_state"] in {"unknown", "running"}:
        add("safe_state", "Safe state needs review", "Confirm the equipment is stopped or isolated before authorizing work.")
    text = report["description"].lower()
    running_conflict = report["safe_state"] in {"isolated", "stopped"} and re.search(r"\b(still running|currently running)\b", text)
    isolation_conflict = report["safe_state"] == "isolated" and re.search(r"\bnot isolated\b", text)
    if running_conflict or isolation_conflict:
        add("safe_state", "Contradictory source statements", "The narrative and selected safe state disagree; clarify rather than infer.")
    positive_injury = any(not re.search(r"\b(?:no|not|without|denies)\s+(?:an?\s+|any\s+)?$", text[max(0, match.start() - 40):match.start()])
                          for match in re.finditer(r"\b(injured|injury reported|person hurt)\b", text))
    if report["injury_status"] == "none" and positive_injury:
        add("injury_status", "Contradictory injury statements", "The narrative may report an injury despite the selected value; clarify.")
    if re.search(r"\b(no|not|never|without|nahi|nahin)\b", text):
        add("description", "Negation caution", "Negated language is retained verbatim; a reviewer must confirm its meaning.", "warning")
    if not report.get("measurements", "").strip():
        add("measurements", "No measurements recorded", "No worker measurements were provided; do not infer sensor readings.", "warning")
    if not has_evidence:
        add("evidence", "No supporting attachment", "No photo or PDF is attached; validate the source observation during review.", "warning")
    priority = "critical" if report["injury_status"] == "reported" else "high" if report["safe_state"] in {"running", "unknown"} else "medium"
    return findings, priority


def analyze(report: dict, report_version: int) -> dict:
    text = report["description"].lower()
    hypotheses = []
    # Keyword matches suggest an investigation only, including when negated.
    if re.search(r"\b(vibration|noise|bearing)\b", text):
        hypotheses.append("Unverified possibility: mechanical wear, looseness or loading variation; inspection is required.")
    if re.search(r"\b(leak|hydraulic|oil)\b", text):
        hypotheses.append("Unverified possibility: a fluid-system issue; the location and cause are not established.")
    if re.search(r"\b(alarm|trip|interlock)\b", text):
        hypotheses.append("Unverified possibility: a control or protective trip; confirm actual alarm records with qualified personnel.")
    if not hypotheses:
        hypotheses.append("Unverified: the cause is undetermined from the worker report; qualified investigation is required.")
    return {
        "summary": "Rule-assisted review of a worker observation. This is not a diagnosis or authorization to work.",
        "hypotheses": hypotheses,
        "recommended_actions": [
            "Confirm personnel safety and site-approved isolation before any inspection.",
            "Have qualified personnel verify observations and define an approved work method.",
            "Record actual work and results; obtain independent verification before closure.",
        ],
        "safety_flags": (["Reported injury: follow the site's emergency and reporting procedures."] if report["injury_status"] == "reported" else []) + (["Equipment isolation must be independently confirmed."] if report["safe_state"] != "isolated" else []),
        "basis": "Deterministic text and completeness rules only. Source statements and measurements are unverified; no sensor connection or probability estimate.",
        "report_version": report_version,
    }


def new_checklist() -> list[dict]:
    return [{"id": str(uuid4()), "label": label, "required": True, "completed": False, "notes": ""} for label in (
        "Record confirmed safe conditions and site-approved isolation before work",
        "Document qualified inspection, approved work performed and observed results",
        "Record the controlled test outcome and handover evidence for independent verification",
    )]
