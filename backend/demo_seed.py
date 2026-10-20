"""Prepared example workspace and purpose-limited demo controller sessions."""
import hashlib
import json
import secrets
import time
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .database import AdminAudit, Asset, AuthSession, Incident, Organization, Site, SetupLock, User, WorkMethod, now, uid
from .security import hash_password, token_hash
from .services import analyze, assess


# These values are intentionally kept in backend code. They are not part of the
# frontend bundle or public documentation.
DEMO_PERSONAS = {
    "worker": {"name": "Jordan Ellis", "email": "worker@demo.opsbridge.internal", "password": "OpsBridge-Demo-Worker-2026!"},
    "engineer": {"name": "Morgan Chen", "email": "engineer@demo.opsbridge.internal", "password": "OpsBridge-Demo-Engineer-2026!"},
    "supervisor": {"name": "Taylor Brooks", "email": "supervisor@demo.opsbridge.internal", "password": "OpsBridge-Demo-Supervisor-2026!"},
    "admin": {"name": "Casey Rivera", "email": "admin@demo.opsbridge.internal", "password": "OpsBridge-Demo-Admin-2026!"},
}
DEMO_ORGANIZATION = "Northstar Works"
DEMO_SITE = "North Plant"
DEMO_ORGANIZATION_ID = str(uuid5(NAMESPACE_URL, "opsbridge:synthetic:organization:v1"))
DEMO_SITE_ID = str(uuid5(NAMESPACE_URL, "opsbridge:synthetic:site:v1"))
DEMO_SEED_EVENT_ID = str(uuid5(NAMESPACE_URL, "opsbridge:synthetic:seed:v1"))
DEMO_USER_IDS = {role: str(uuid5(NAMESPACE_URL, f"opsbridge:synthetic:user:{role}:v1")) for role in DEMO_PERSONAS}
CONTROLLER_COOKIE = "opsbridge_perspective"
CONTROLLER_PATH = "/api/v1/auth"
CONTROLLER_SCOPE = str(uuid5(NAMESPACE_URL, "opsbridge:synthetic:controller:v1"))
CONTROLLER_SECONDS = 30 * 60


def is_demo_workspace(db: Session, user: User) -> bool:
    marker = db.get(AdminAudit, DEMO_SEED_EVENT_ID)
    return bool(marker and marker.action == "demo.seeded" and marker.organization_id == user.organization_id == DEMO_ORGANIZATION_ID)


def is_seeded_persona(db: Session, user: User, role: str) -> bool:
    return (role in DEMO_USER_IDS and is_demo_workspace(db, user) and user.id == DEMO_USER_IDS[role] and user.site_id == DEMO_SITE_ID
            and user.email == DEMO_PERSONAS[role]["email"] and user.role == role and user.active)


def is_demo_admin(db: Session, user: User) -> bool:
    return is_seeded_persona(db, user, "admin")


def demo_available(db: Session, settings) -> bool:
    if settings.environment != "demo":
        return False
    users = {user.id: user for user in db.scalars(select(User).where(User.id.in_(DEMO_USER_IDS.values())))}
    return all(item_id in users and is_seeded_persona(db, users[item_id], role) for role, item_id in DEMO_USER_IDS.items())


def controller_admin(db: Session, request, settings):
    """Read only from perspective endpoints. This is never an ordinary identity.

    A reserved non-site scope makes a controller AuthSession unusable by identity,
    even if somebody copies this token into the ordinary session cookie.
    """
    if settings.environment != "demo":
        return None
    token = request.cookies.get(CONTROLLER_COOKIE, "")
    if not token or len(token) > 200:
        return None
    session = db.get(AuthSession, token_hash(token), populate_existing=True)
    if (not session or session.site_id != CONTROLLER_SCOPE or session.user_id != DEMO_USER_IDS["admin"]
            or session.expires_at <= int(time.time())):
        return None
    admin = db.get(User, session.user_id, populate_existing=True)
    return admin if admin and is_demo_admin(db, admin) and not admin.must_change_password else None


def revoke_controller(db: Session, request, response, settings):
    token = request.cookies.get(CONTROLLER_COOKIE, "")
    if token and len(token) <= 200:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(token), AuthSession.site_id == CONTROLLER_SCOPE))
    response.delete_cookie(CONTROLLER_COOKIE, path=CONTROLLER_PATH, secure=settings.cookie_secure, httponly=True, samesite="strict")


def issue_controller(db: Session, request, response, settings):
    if settings.environment != "demo":
        raise RuntimeError("Shared workspace is unavailable")
    revoke_controller(db, request, response, settings)
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=token_hash(token), user_id=DEMO_USER_IDS["admin"], site_id=CONTROLLER_SCOPE,
                       expires_at=int(time.time()) + CONTROLLER_SECONDS))
    response.set_cookie(CONTROLLER_COOKIE, token, path=CONTROLLER_PATH, max_age=CONTROLLER_SECONDS,
                        httponly=True, secure=settings.cookie_secure, samesite="strict")


def seed_demo(db: Session, settings, audit) -> None:
    """Create the complete synthetic workspace once, on first demo startup."""
    if settings.environment != "demo":
        return
    from .accounts import admin_audit
    from .operations import method_data, notify
    # The caller owns a transaction. SQLite's BEGIN IMMEDIATE and this PostgreSQL
    # row lock serialize first startup across process workers and manual setup.
    lock = db.scalar(select(SetupLock).where(SetupLock.id == 1).with_for_update())
    if not lock or lock.completed or db.scalar(select(User.id).limit(1)) or db.scalar(select(Organization.id).limit(1)):
        return

    organization = Organization(id=DEMO_ORGANIZATION_ID, name=DEMO_ORGANIZATION)
    db.add(organization)
    db.flush()
    site = Site(id=DEMO_SITE_ID, name=DEMO_SITE, organization_id=organization.id)
    db.add(site)
    db.flush()

    users = {}
    for role, values in DEMO_PERSONAS.items():
        item = User(id=DEMO_USER_IDS[role], name=values["name"], email=values["email"], password_hash=hash_password(values["password"]),
                    role=role, organization_id=organization.id, site_id=site.id)
        db.add(item)
        db.flush()
        users[role] = item

    assets = [
        Asset(organization_id=organization.id, site_id=site.id, code="PRESS-07", name="Hydraulic press 07",
              area="Forming bay", criticality="high", manufacturer="Northstar", model="H-700"),
        Asset(organization_id=organization.id, site_id=site.id, code="PUMP-12", name="Cooling pump 12",
              area="Utilities", criticality="medium", manufacturer="Apex", model="CP-120"),
        Asset(organization_id=organization.id, site_id=site.id, code="LINE-03", name="Conveyor line 03",
              area="Assembly", criticality="critical", manufacturer="Horizon", model="C-300"),
    ]
    db.add_all(assets)
    db.flush()

    methods = {}
    for code, name in (("PRESS-07", "Press observation handoff"), ("PUMP-12", "Cooling pump observation handoff"), ("LINE-03", "Conveyor observation handoff")):
        method = WorkMethod(organization_id=organization.id, site_id=site.id, name=name, version=1,
                            description=f"Example record for {code}; documents observations and handover, not a repair procedure.",
                            steps=[{"label": f"Record the example asset code {code} and source observation", "required": True},
                                   {"label": "Record the example review and handover outcome", "required": True}])
        db.add(method)
        db.flush()
        methods[code] = method
        admin_audit(db, users["engineer"], "work_method.created", f"Example method {method.id}; asset {code}; version 1")

    reports = [
        ("PRESS-07", "The press stopped after an alarm. The stopping sequence has not been confirmed.", "", "submitted", users["worker"]),
        ("PUMP-12", "Cooling pump vibration increased during the afternoon inspection.", "Review requested before the next example handover.", "ready_for_review", users["worker"]),
        ("LINE-03", "The conveyor stopped after a guard switch alarm during the morning shift.", "Assembly interrupted; example observations ready for handover.", "approved", users["worker"]),
        ("PUMP-12", "The pump display showed a repeat alarm during an example observation round.", "Example handover recorded; independent review outstanding.", "awaiting_verification", users["worker"]),
        ("PRESS-07", "A second press alarm was recorded during the afternoon example shift.", "Example review needs the observed alarm code.", "changes_requested", users["admin"]),
    ]
    for code, description, impact, status, reporter in reports:
        asset = next(item for item in assets if item.code == code)
        report = {"asset_id": asset.id, "description": "Example record, not real operations. " + description, "impact": impact, "injury_status": "none",
                  "safe_state": "isolated", "measurements": "Example record, not real operations or sensor-verified data."}
        if status == "submitted":
            report.update(injury_status="unknown", safe_state="unknown", measurements="")
        _, priority = assess(report, False)
        incident = Incident(number="INC-" + uid().replace("-", "").upper(), organization_id=organization.id,
                            site_id=site.id, reporter_id=reporter.id,
                            asset_id=asset.id, create_fingerprint=hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest(), report=report,
                            status="submitted", priority=priority)
        db.add(incident)
        db.flush()
        audit(db, incident, reporter, "submitted", "Example record, not real operations")
        notify(db, incident, "submitted")

        def transition(next_status, actor, action, note):
            incident.version += 1
            incident.updated_at = now()
            incident.status = next_status
            audit(db, incident, actor, action, note)

        if status != "submitted":
            if status == "changes_requested":
                transition(status, users["supervisor"], "request_changes", "Example review: confirm the alarm code and observed stopping sequence.")
                notify(db, incident, "request_changes")
            else:
                incident.analysis = analyze(report, incident.report_version)
                transition("ready_for_review", users["engineer"], "analyze", "Example source review")
        if status in {"approved", "awaiting_verification"}:
            method = methods[code]
            incident.approval = {"actor_id": users["engineer"].id, "actor_name": users["engineer"].name,
                                 "note": "Reviewed this example source and matching observation method.", "at": now(), "report_version": 1,
                                 "work_method": method_data(method), "work_method_label": method.name}
            incident.checklist = [{"id": uid(), **step, "completed": False, "notes": ""} for step in method.steps]
            transition("approved", users["engineer"], "approve", "Example observation handover released; not a repair instruction.")
            notify(db, incident, "approve")
        if status == "awaiting_verification":
            incident.executor_ids = [users["worker"].id]
            transition("in_progress", users["worker"], "start", "Example handover started")
            for index, step in enumerate(incident.checklist):
                steps = [dict(value) for value in incident.checklist]
                steps[index].update(completed=True, notes=f"Example {code} observation and handover note recorded.")
                incident.checklist = steps
                transition("in_progress", users["worker"], "checklist_updated", step["label"])
            transition("awaiting_verification", users["worker"], "submit_verification", "Example handover awaits independent review.")
            notify(db, incident, "submit_verification")

    lock.completed = True
    db.add(AdminAudit(id=DEMO_SEED_EVENT_ID, organization_id=organization.id, actor_name="OpsBridge system",
                      action="demo.seeded", note="Synthetic organization, site, accounts, assets and incidents provisioned"))
