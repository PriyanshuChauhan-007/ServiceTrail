"""Authenticated manufacturing workflow API. Run: uvicorn backend.main:app."""
from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import logging
import re
import secrets
import struct
import time
import warnings
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath
from urllib.parse import quote

logger = logging.getLogger("opsbridge.notify")

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from .config import Settings
from .database import (Asset, AuditEvent, AuthSession, Evidence, Incident, LoginThrottle,
                       Organization, SetupLock, Site, User, WorkMethod, initialize, make_database, now, uid)
from .models import Action, AssetInput, ChecklistUpdate, CreateReport, EditReport, Login, NewUser, Setup
from .security import COOKIE, SecurityMiddleware, field_cipher, hash_password, token_hash, verify_password
from .accounts import admin_audit, install_accounts, verify_mfa
from .operations import incident_scope, install_operations, method_data, notify
from .services import analyze, assess, new_checklist

REVIEWERS = {"engineer", "supervisor", "admin"}
EDITABLE = {"submitted", "needs_clarification", "changes_requested"}
REVIEWABLE = EDITABLE | {"ready_for_review", "under_review", "reopened"}
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))
FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"


def fail(code, detail):
    raise HTTPException(code, detail)


def require_role(user, roles):
    if user.role not in roles:
        fail(403, "Your authenticated role cannot perform this action")


def public_user(db, user):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role,
            "organization_id": user.organization_id, "site_id": user.site_id,
            "organization_name": db.get(Organization, user.organization_id).name,
            "site_name": db.get(Site, user.site_id).name, "active": user.active,
            "must_change_password": user.must_change_password, "mfa_enabled": bool(user.mfa_secret)}


def public_asset(asset):
    return {key: getattr(asset, key) for key in ("id", "code", "name", "area", "criticality", "manufacturer", "model", "status")}


def public_evidence(evidence):
    return {"id": evidence.id, "filename": evidence.filename, "content_type": evidence.content_type,
            "size": evidence.size, "uploaded_by": evidence.uploaded_by, "created_at": evidence.created_at,
            "url": f"/api/v1/incidents/{evidence.incident_id}/evidence/{evidence.id}"}


def incident_data(db, incident, timeline=True):
    reporter = db.get(User, incident.reporter_id)
    assignee = db.get(User, incident.assigned_to_id) if incident.assigned_to_id else None
    evidence = list(db.scalars(select(Evidence).where(Evidence.incident_id == incident.id).order_by(Evidence.created_at, Evidence.id)))
    findings, _ = assess(incident.report, bool(evidence))
    data = {"id": incident.id, "number": incident.number, **incident.report,
            "asset": public_asset(db.get(Asset, incident.asset_id)), "priority": incident.priority,
            "status": incident.status, "version": incident.version,
            "reporter": {"id": reporter.id, "name": reporter.name},
            "assigned_to": {"id": assignee.id, "name": assignee.name} if assignee else None,
            "created_at": incident.created_at, "updated_at": incident.updated_at, "due_at": incident.due_at,
            "findings": findings, "analysis": incident.analysis,
            "approval": {k: v for k, v in incident.approval.items() if k != "actor_id"} if incident.approval else None,
            "checklist": incident.checklist, "evidence": [public_evidence(item) for item in evidence]}
    if timeline:
        events = db.scalars(select(AuditEvent).where(AuditEvent.incident_id == incident.id).order_by(AuditEvent.at, AuditEvent.id))
        data["timeline"] = [{key: getattr(event, key) for key in ("id", "action", "actor_name", "actor_role", "note", "at", "report_version")} for event in events]
    return data


def audit(db, incident, user, action, note=None):
    db.flush()
    db.add(AuditEvent(incident_id=incident.id, action=action, actor_id=user.id, actor_name=user.name,
                      actor_role=user.role, note=note, report_version=incident.report_version,
                      snapshot=copy.deepcopy(incident_data(db, incident, timeline=False))))
    db.flush()


def bump(incident):
    incident.version += 1
    incident.updated_at = now()


def invalidate(incident):
    incident.report_version = incident.version
    incident.analysis = None
    incident.approval = None
    incident.checklist = []
    incident.executor_ids = []


def create_app(settings: Settings | None = None):
    settings = settings or Settings.from_env()
    settings.validate()
    engine, sessions = make_database(settings.database_url)
    cipher = field_cipher(settings)

    @asynccontextmanager
    async def lifespan(app):
        initialize(engine)
        if settings.environment in {"demo", "development"}:
            from .demo import seed_demo_data
            try:
                seed_demo_data(sessions)
            except Exception:
                pass
        yield
        engine.dispose()

    app = FastAPI(title="OpsBridge API", version="1.0.0", lifespan=lifespan,
                  docs_url=None,
                  redoc_url=None, openapi_url="/api/v1/openapi.json" if settings.environment != "production" else None)
    app.state.engine, app.state.sessions, app.state.settings = engine, sessions, settings
    app.add_middleware(SecurityMiddleware, settings=settings)

    @app.exception_handler(IntegrityError)
    async def integrity_error(request, exc):
        return JSONResponse({"detail": "A conflicting record already exists; refresh and retry"}, status_code=409)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Never echo credentials/OTP/tokens from rejected input. Also avoid sending
        # non-finite JSON values back through the validation-error serializer.
        return JSONResponse({"detail": [{key: error[key] for key in ("type", "loc", "msg")}
                                        for error in exc.errors()]}, status_code=422)

    def database(request: Request):
        with sessions() as db:
            try:
                if request.method not in {"GET", "HEAD", "OPTIONS"} and engine.dialect.name == "sqlite":
                    # Serialize local writes before any reads; PostgreSQL uses row locks below.
                    db.connection().exec_driver_sql("BEGIN IMMEDIATE")
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    def identity(request: Request, db: Session = Depends(database)):
        token = request.cookies.get(COOKIE)
        if not token or len(token) > 200:
            fail(401, "Sign in required")
        session = db.get(AuthSession, token_hash(token))
        if not session or session.expires_at <= int(time.time()):
            fail(401, "Session expired or invalid")
        query = select(User).where(User.id == session.user_id)
        security_path = request.url.path.startswith(("/api/v1/auth/change-password", "/api/v1/auth/sessions", "/api/v1/auth/mfa/"))
        security_write = security_path and request.method not in {"GET", "HEAD", "OPTIONS"}
        if security_write:
            query = query.with_for_update()
        user = db.scalar(query)
        # A revocation may have committed while this write waited for the user lock.
        if security_write:
            session = db.get(AuthSession, token_hash(token), populate_existing=True)
            if not session or session.expires_at <= int(time.time()):
                fail(401, "Session expired or invalid")
        if not user or not user.active or session.site_id != user.site_id:
            fail(401, "Session expired or invalid")
        if user.must_change_password and request.method not in {"GET", "HEAD", "OPTIONS"} and not security_path:
            fail(403, "Initial password change required")
        return user

    def scoped_asset(db, user, asset_id):
        asset = db.scalar(select(Asset).where(Asset.id == asset_id, Asset.organization_id == user.organization_id, Asset.site_id == user.site_id))
        if not asset:
            fail(404, "Asset not found in this site")
        return asset

    def scoped_incident(db, user, incident_id, write=False):
        query = select(Incident).where(Incident.id == incident_id, Incident.organization_id == user.organization_id, Incident.site_id == user.site_id)
        if write:
            query = query.with_for_update()
        incident = db.scalar(query)
        if not incident or (user.role == "worker" and user.id not in {incident.reporter_id, incident.assigned_to_id}):
            fail(404, "Incident not found")
        return incident

    def version_check(incident, version):
        if incident.version != version:
            fail(409, {"message": "Stale version; reload before retrying", "current_version": incident.version})

    def execution_check(incident, user):
        if user.id not in {incident.reporter_id, incident.assigned_to_id}:
            fail(403, "Only the report author or assigned worker may execute the approved work")
        if incident.approval and incident.approval["actor_id"] == user.id:
            fail(403, "The independent approver cannot execute this work")

    def issue_session(db, response, user, request):
        old_token = request.cookies.get(COOKIE)
        if old_token:
            db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(old_token)))
        db.execute(delete(AuthSession).where(AuthSession.expires_at <= int(time.time())))
        token = secrets.token_urlsafe(32)
        seconds = settings.session_hours * 3600
        db.add(AuthSession(token_hash=token_hash(token), user_id=user.id, site_id=user.site_id, expires_at=int(time.time()) + seconds))
        response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="strict", max_age=seconds, path="/api/v1")

    @app.get("/api/v1/health")
    def health(db: Session = Depends(database)):
        t0 = time.monotonic()
        try:
            db.execute(text("SELECT 1"))
            latency_ms = round((time.monotonic() - t0) * 1000, 1)
            return {"status": "ok", "service": "opsbridge-backend", "version": "1.0.0",
                    "db": "ok", "db_latency_ms": latency_ms, "environment": settings.environment}
        except SQLAlchemyError:
            fail(503, "Database unavailable")

    @app.get("/api/v1/setup/status")
    def setup_status(db: Session = Depends(database)):
        return {"needs_setup": not db.get(SetupLock, 1).completed}

    @app.post("/api/v1/setup", status_code=201)
    def setup(data: Setup, request: Request, response: Response, db: Session = Depends(database)):
        lock = db.scalar(select(SetupLock).where(SetupLock.id == 1).with_for_update())
        if lock.completed or db.scalar(select(User.id).limit(1)):
            fail(409, "Setup is already complete")
        org = Organization(name=data.organization_name)
        db.add(org)
        db.flush()
        site = Site(name=data.site_name, organization_id=org.id)
        db.add(site)
        db.flush()
        user = User(name=data.name, email=data.email, password_hash=hash_password(data.password), role="admin", organization_id=org.id, site_id=site.id)
        db.add(user)
        lock.completed = True
        db.flush()
        issue_session(db, response, user, request)
        admin_audit(db, user, "organization.setup", f"Organization {org.id}; site {site.id}")
        return {"user": public_user(db, user)}

    @app.post("/api/v1/demo/seed")
    def demo_seed(db: Session = Depends(database)):
        lock = db.get(SetupLock, 1)
        if settings.environment == "production" and lock and lock.completed:
            fail(403, "Demo seeding is disabled on configured production sites")
        from .demo import seed_demo_data
        seeded = seed_demo_data(sessions, reset=False)
        return {"status": "ok", "seeded": seeded, "message": "Demo data ready"}

    @app.post("/api/v1/auth/login")
    def login(data: Login, request: Request, response: Response, db: Session = Depends(database)):
        # Both account and peer limits are persistent and shared by process workers.
        # Never trust a user-supplied X-Forwarded-For header here.
        current = int(time.time())
        keys = [token_hash("email:" + data.email), token_hash("peer:" + (request.client.host if request.client else "unknown"))]
        throttles = []
        # Stable lock order plus an advisory lock avoids first-insert races on PostgreSQL.
        if engine.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(724158191)"))
        for key in sorted(keys):
            throttle = db.get(LoginThrottle, key)
            if not throttle:
                throttle = LoginThrottle(key=key, attempts=0, window_start=current)
                db.add(throttle)
            if current - throttle.window_start >= settings.login_window_seconds:
                throttle.window_start, throttle.attempts = current, 0
            if throttle.attempts >= settings.login_limit:
                fail(429, "Too many sign-in attempts; try again later")
            throttle.attempts += 1
            throttles.append(throttle)
        user = db.scalar(select(User).where(User.email == data.email).with_for_update())
        valid = verify_password(data.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
        if not user or not valid or not user.active:
            if user:
                admin_audit(db, user, "session.login_failed")
            db.commit()  # Failed attempts must survive the HTTP error/rollback.
            fail(401, "Invalid email or password")
        if user.mfa_secret:
            verify_mfa(db, user, data.otp, data.recovery_code, cipher, settings, fail)
        for throttle in throttles:
            if throttle.key == token_hash("email:" + data.email):
                throttle.attempts = 0
        issue_session(db, response, user, request)
        admin_audit(db, user, "session.login")
        return {"user": public_user(db, user)}

    @app.get("/api/v1/auth/me")
    def me(user: User = Depends(identity), db: Session = Depends(database)):
        return {"user": public_user(db, user)}

    @app.post("/api/v1/auth/logout")
    def logout(request: Request, response: Response, db: Session = Depends(database)):
        token = request.cookies.get(COOKIE)
        if token and len(token) <= 200:
            session = db.get(AuthSession, token_hash(token))
            if session:
                admin_audit(db, db.get(User, session.user_id), "session.logout")
            db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(token)))
        response.delete_cookie(COOKIE, path="/api/v1", secure=settings.cookie_secure, httponly=True, samesite="strict")
        return {"ok": True}

    @app.get("/api/v1/users")
    def users(user: User = Depends(identity), db: Session = Depends(database)):
        return [public_user(db, item) for item in db.scalars(select(User).where(User.organization_id == user.organization_id, User.site_id == user.site_id).order_by(User.name, User.id))]

    @app.post("/api/v1/users", status_code=201)
    def create_user(data: NewUser, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        item = User(name=data.name, email=data.email, role=data.role, password_hash=hash_password(data.password), organization_id=user.organization_id, site_id=user.site_id, must_change_password=True)
        db.add(item)
        db.flush()
        admin_audit(db, user, "user.created", f"User {item.id}; role={item.role}; initial password rotation required")
        return public_user(db, item)

    @app.get("/api/v1/assets")
    def assets(user: User = Depends(identity), db: Session = Depends(database)):
        return [public_asset(item) for item in db.scalars(select(Asset).where(Asset.organization_id == user.organization_id, Asset.site_id == user.site_id).order_by(Asset.code))]

    @app.post("/api/v1/assets", status_code=201)
    def create_asset(data: AssetInput, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin", "supervisor"})
        item = Asset(**data.model_dump(), organization_id=user.organization_id, site_id=user.site_id)
        db.add(item)
        db.flush()
        admin_audit(db, user, "asset.created", f"Asset {item.id}: {item.code}")
        return public_asset(item)

    install_accounts(app, database, identity, issue_session, settings, cipher, fail, require_role, public_user)
    install_operations(app, database, identity, fail, require_role, incident_data, scoped_asset)

    @app.get("/api/v1/incidents")
    def incidents(limit: int = 100, user: User = Depends(identity), db: Session = Depends(database)):
        if not 1 <= limit <= 200:
            fail(422, "Limit must be between 1 and 200")
        query = incident_scope(user)
        return [incident_data(db, item) for item in db.scalars(query.order_by(Incident.created_at.desc(), Incident.id).limit(limit))]

    @app.post("/api/v1/incidents", status_code=201)
    def create_incident(data: CreateReport, response: Response, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"worker", "admin"})
        report = data.model_dump(exclude={"client_id"})
        fingerprint = hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest()
        client_id = str(data.client_id) if data.client_id else None
        if client_id:
            if engine.dialect.name == "postgresql":
                lock_key = int.from_bytes(hashlib.sha256((user.id + client_id).encode()).digest()[:8], "big", signed=True)
                db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
            existing = db.scalar(select(Incident).where(Incident.reporter_id == user.id, Incident.client_id == client_id))
            if existing:
                if existing.create_fingerprint != fingerprint:
                    fail(409, "client_id was already used with different report content")
                response.status_code = 200
                return incident_data(db, existing)
        scoped_asset(db, user, data.asset_id)
        findings, priority = assess(report, False)
        item = Incident(id=uid(), number="INC-" + uid().replace("-", "").upper(), organization_id=user.organization_id,
                        site_id=user.site_id, reporter_id=user.id, asset_id=data.asset_id, client_id=client_id,
                        create_fingerprint=fingerprint, report=report, priority=priority, status="submitted")
        db.add(item)
        db.flush()
        audit(db, item, user, "submitted")
        notify(db, item, "submitted")
        return incident_data(db, item)

    @app.get("/api/v1/incidents/{incident_id}")
    def get_incident(incident_id: str, user: User = Depends(identity), db: Session = Depends(database)):
        return incident_data(db, scoped_incident(db, user, incident_id))

    @app.patch("/api/v1/incidents/{incident_id}")
    def edit_incident(incident_id: str, data: EditReport, user: User = Depends(identity), db: Session = Depends(database)):
        item = scoped_incident(db, user, incident_id, True)
        if item.reporter_id != user.id:
            fail(403, "Only the reporter may edit source observations")
        version_check(item, data.version)
        if item.status not in EDITABLE:
            fail(409, "Report editing is unavailable in this state; request changes first")
        scoped_asset(db, user, data.asset_id)
        item.report = data.model_dump(exclude={"version"})
        item.asset_id = data.asset_id
        bump(item)
        invalidate(item)
        item.status = "submitted"
        _, item.priority = assess(item.report, bool(db.scalar(select(Evidence.id).where(Evidence.incident_id == item.id).limit(1))))
        audit(db, item, user, "report_updated")
        notify(db, item, "submitted")
        return incident_data(db, item)

    @app.post("/api/v1/incidents/{incident_id}/actions")
    def incident_action(incident_id: str, data: Action, user: User = Depends(identity), db: Session = Depends(database)):
        item = scoped_incident(db, user, incident_id, True)
        action, note = data.action, (data.note or "").strip()
        if action in {"analyze", "approve", "request_changes", "resolve", "assign", "schedule"}:
            require_role(user, REVIEWERS)
        if action in {"start", "submit_verification"}:
            execution_check(item, user)
        version_check(item, data.version)
        if action in {"approve", "request_changes", "resolve", "reopen", "schedule"} and not note:
            fail(422, "A decision note is required")
        if action == "analyze":
            if item.status not in REVIEWABLE:
                fail(409, "Analysis is unavailable in this state")
            findings, item.priority = assess(item.report, bool(db.scalar(select(Evidence.id).where(Evidence.incident_id == item.id).limit(1))))
            item.analysis = analyze(item.report, item.report_version)
            item.approval, item.checklist = None, []
            item.status = "needs_clarification" if any(f["severity"] == "blocking" for f in findings) else "ready_for_review"
        elif action == "request_changes":
            if item.status not in REVIEWABLE | {"approved", "awaiting_verification"}:
                fail(409, "Cannot request changes in this state")
            item.status = "changes_requested"
            item.analysis, item.approval, item.checklist = None, None, []
        elif action == "approve":
            if user.id in {item.reporter_id, item.assigned_to_id} or user.id in item.executor_ids:
                fail(403, "Approval must be independent of the author and executors")
            if item.status not in {"ready_for_review", "under_review"} or not item.analysis or item.analysis["report_version"] != item.report_version:
                fail(409, "A current analyzed report is required")
            findings, _ = assess(item.report, bool(db.scalar(select(Evidence.id).where(Evidence.incident_id == item.id).limit(1))))
            if any(f["severity"] == "blocking" for f in findings):
                fail(409, "Blocking findings require clarification")
            if not data.review_confirmed:
                fail(422, "Confirm that you reviewed the current report and evidence")
            item.approval = {"actor_id": user.id, "actor_name": user.name, "note": note, "at": now(), "report_version": item.report_version}
            method = None
            if data.work_method_id:
                method = db.scalar(select(WorkMethod).where(WorkMethod.id == data.work_method_id,
                    WorkMethod.organization_id == user.organization_id, WorkMethod.site_id == user.site_id))
                if not method:
                    fail(404, "Work method not found in this site")
            elif db.scalar(select(WorkMethod.id).where(WorkMethod.organization_id == user.organization_id,
                WorkMethod.site_id == user.site_id).limit(1)):
                fail(422, "Select a work method")
            item.approval = {**item.approval, "work_method": copy.deepcopy(method_data(method)) if method else None,
                             "work_method_label": method.name if method else "Generic completion record — not an SOP"}
            item.checklist = [{"id": uid(), **step, "completed": False, "notes": ""} for step in method.steps] if method else new_checklist()
            item.status = "approved"
        elif action == "start":
            if item.status != "approved" or not item.approval:
                fail(409, "Work must be approved before execution")
            item.status = "in_progress"
            item.executor_ids = list(set(item.executor_ids + [user.id]))
        elif action == "submit_verification":
            if item.status != "in_progress":
                fail(409, "Only work in progress may be submitted for verification")
            if not item.checklist or any(step["required"] and (not step["completed"] or not step["notes"].strip()) for step in item.checklist):
                fail(409, "Complete every required checklist item with evidence notes")
            item.executor_ids = list(set(item.executor_ids + [user.id]))
            item.status = "awaiting_verification"
        elif action == "resolve":
            if user.id in {item.reporter_id, item.assigned_to_id} or user.id in item.executor_ids:
                fail(403, "Verification must be independent of the author and executors")
            if item.status != "awaiting_verification" or not item.approval or item.approval["report_version"] != item.report_version or not item.checklist or any(s["required"] and (not s["completed"] or not s["notes"].strip()) for s in item.checklist):
                fail(409, "Completed approved work must await independent verification")
            item.status = "resolved"
        elif action == "reopen":
            if user.id != item.reporter_id:
                require_role(user, REVIEWERS)
            if item.status != "resolved":
                fail(409, "Only resolved incidents can be reopened")
            item.status = "reopened"
            item.analysis, item.approval, item.checklist = None, None, []
            item.executor_ids = []
        elif action == "cancel":
            if user.id != item.reporter_id:
                require_role(user, REVIEWERS)
            if item.status not in REVIEWABLE:
                fail(409, "Only preapproval reports can be cancelled")
            if not note:
                fail(422, "A cancellation note is required")
            item.status = "cancelled"
            item.approval, item.analysis, item.checklist = None, None, []
        elif action == "assign":
            if item.status not in REVIEWABLE | {"approved", "in_progress"}:
                fail(409, "Assignment is unavailable in this state")
            candidate = db.get(User, data.assigned_to) if data.assigned_to else None
            if not candidate or not candidate.active or candidate.organization_id != user.organization_id or candidate.site_id != user.site_id:
                fail(404, "Assignee not found in this site")
            if candidate.role != "worker":
                fail(422, "Assign execution work to a worker")
            if item.approval and candidate.id == item.approval["actor_id"]:
                fail(403, "The approver cannot execute approved work")
            item.assigned_to_id = candidate.id
            if item.status == "ready_for_review":
                item.status = "under_review"
        elif action == "schedule":
            if not data.due_at:
                fail(422, "A timezone-aware due_at is required")
            if item.status in {"resolved", "cancelled"}:
                fail(409, "Cannot schedule closed work")
            item.due_at = data.due_at.isoformat()
        bump(item)
        audit(db, item, user, action, note or None)
        if action in {"request_changes", "approve", "assign", "submit_verification"}:
            notify(db, item, action)
        elif action == "analyze" and item.status == "needs_clarification":
            notify(db, item, "needs_clarification")
        return incident_data(db, item)

    @app.patch("/api/v1/incidents/{incident_id}/checklist/{item_id}")
    def update_checklist(incident_id: str, item_id: str, data: ChecklistUpdate, user: User = Depends(identity), db: Session = Depends(database)):
        item = scoped_incident(db, user, incident_id, True)
        execution_check(item, user)
        version_check(item, data.version)
        if item.status not in {"approved", "in_progress"} or not item.approval:
            fail(409, "Checklist updates require approved work")
        steps = copy.deepcopy(item.checklist)
        step = next((step for step in steps if step["id"] == item_id), None)
        if not step:
            fail(404, "Checklist item not found")
        if step["required"] and data.completed and not data.notes.strip():
            fail(422, "Required completion needs evidence notes")
        step.update(completed=data.completed, notes=data.notes)
        item.checklist, item.status = steps, "in_progress"
        item.executor_ids = list(set(item.executor_ids + [user.id]))
        bump(item)
        audit(db, item, user, "checklist_updated", f'{step["label"]}: {data.notes}')
        return incident_data(db, item)

    @app.post("/api/v1/incidents/{incident_id}/evidence", status_code=201)
    def upload_evidence(incident_id: str, file: UploadFile = File(...), version: int | None = Form(None), user: User = Depends(identity), db: Session = Depends(database)):
        item = scoped_incident(db, user, incident_id, True)
        if item.reporter_id != user.id:
            fail(403, "Only the report author may upload evidence")
        if version is not None:
            version_check(item, version)
        if item.status not in REVIEWABLE - {"reopened"}:
            fail(409, "Evidence uploads are available only before approval")
        content = file.file.read(settings.max_upload_bytes + 1)
        if not content or len(content) > settings.max_upload_bytes:
            fail(413 if content else 422, "Evidence must be nonempty and at most 10 MiB")
        kind = validate_evidence(content, file.content_type or "")
        # Organization row lock protects the aggregate quota across distinct incidents.
        db.scalar(select(Organization).where(Organization.id == user.organization_id).with_for_update())
        count = db.scalar(select(func.count()).select_from(Evidence).where(Evidence.incident_id == item.id))
        used = db.scalar(select(func.coalesce(func.sum(Evidence.size), 0)).join(Incident, Incident.id == Evidence.incident_id)
                         .where(Incident.organization_id == user.organization_id))
        if count >= settings.max_evidence_per_incident or used + len(content) > settings.max_org_evidence_bytes:
            fail(413, "Evidence quota exceeded")
        filename = PurePosixPath((file.filename or "evidence").replace("\\", "/")).name
        filename = re.sub(r"[^\w.() -]", "_", filename).strip(". ")[:180] or "evidence"
        evidence = Evidence(incident_id=item.id, filename=filename, content_type=kind, size=len(content),
                            uploaded_by=user.id, sha256=hashlib.sha256(content).hexdigest(), data=content)
        db.add(evidence)
        bump(item)
        invalidate(item)
        item.status = "submitted"
        audit(db, item, user, "evidence_uploaded", filename)
        notify(db, item, "submitted")
        return incident_data(db, item)

    @app.get("/api/v1/incidents/{incident_id}/evidence/{evidence_id}")
    def download_evidence(incident_id: str, evidence_id: str, user: User = Depends(identity), db: Session = Depends(database)):
        scoped_incident(db, user, incident_id)
        evidence = db.scalar(select(Evidence).where(Evidence.id == evidence_id, Evidence.incident_id == incident_id))
        if not evidence:
            fail(404, "Evidence not found")
        return Response(evidence.data, media_type=evidence.content_type,
                        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(evidence.filename)}"})

    @app.get("/api/v1/incidents/{incident_id}/export")
    def export(incident_id: str, fmt: str = "json", user: User = Depends(identity), db: Session = Depends(database)):
        item = scoped_incident(db, user, incident_id)
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.incident_id == item.id).order_by(AuditEvent.at, AuditEvent.id)))
        evidence = db.scalars(select(Evidence).where(Evidence.incident_id == item.id))
        if fmt == "csv":
            buf = io.StringIO()
            writer = csv.writer(buf, quoting=csv.QUOTE_ALL)
            writer.writerow(["seq", "action", "actor_name", "actor_role", "at", "report_version", "note"])
            for seq, ev in enumerate(events, start=1):
                writer.writerow([seq, ev.action, ev.actor_name, ev.actor_role,
                                  ev.at, ev.report_version, (ev.note or "").replace("\n", " ")])
            return Response(buf.getvalue().encode(), media_type="text/csv",
                            headers={"Content-Disposition": f'attachment; filename="{item.number}-audit.csv"'})
        payload = {"schema_version": 1, "exported_at": now(), "incident": incident_data(db, item),
                   "provenance": {"organization_id": item.organization_id, "site_id": item.site_id,
                                   "reporter_id": item.reporter_id, "exported_by": user.id,
                                   "analysis_method": "deterministic rules; unverified hypotheses, not diagnosis",
                                   "measurements_source": "worker-entered observation; not sensor verified",
                                   "evidence_sha256": {e.id: e.sha256 for e in evidence}},
                   "audit_events": [{key: getattr(ev, key) for key in ("id", "action", "actor_id", "actor_name", "actor_role", "note", "at", "report_version", "snapshot")} for ev in events]}
        return JSONResponse(payload, headers={"Content-Disposition": f'attachment; filename="{item.number}.json"'})

    @app.get("/api/v1/analytics/dashboard")
    def analytics_dashboard(user: User = Depends(identity), db: Session = Depends(database)):
        """Rich dashboard aggregates scoped to the authenticated user's site."""
        from .operations import REVIEWERS as REV
        require_role(user, REV)
        from datetime import datetime
        scope = incident_scope(user).subquery()
        counts = dict(db.execute(select(scope.c.status, func.count()).group_by(scope.c.status)).all())
        total = sum(counts.values())
        current = now()
        overdue = db.scalar(select(func.count()).select_from(scope).where(
            scope.c.due_at < current,
            scope.c.status.not_in(["resolved", "cancelled"]))) or 0
        resolved_rows = db.execute(
            select(scope.c.created_at, func.max(AuditEvent.at))
            .join(AuditEvent, AuditEvent.incident_id == scope.c.id)
            .where(scope.c.status == "resolved", AuditEvent.action == "resolve")
            .group_by(scope.c.id, scope.c.created_at)
        ).all()
        minutes = [
            (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() / 60
            for start, end in resolved_rows
        ]
        sorted_mins = sorted(minutes)
        median_mins = sorted_mins[len(sorted_mins) // 2] if sorted_mins else None
        avg_mins = (sum(minutes) / len(minutes)) if minutes else None
        asset_rows = db.execute(
            select(Asset.code, Asset.name, Asset.area, func.count(scope.c.id).label("cnt"))
            .join(scope, scope.c.asset_id == Asset.id)
            .group_by(Asset.id, Asset.code, Asset.name, Asset.area)
            .order_by(func.count(scope.c.id).desc())
            .limit(10)
        ).all()
        priority_counts = dict(db.execute(
            select(scope.c.priority, func.count()).group_by(scope.c.priority)).all())
        recent_q = db.execute(
            select(scope.c.number, scope.c.created_at, func.max(AuditEvent.at).label("resolved_at"))
            .join(AuditEvent, AuditEvent.incident_id == scope.c.id)
            .where(scope.c.status == "resolved", AuditEvent.action == "resolve")
            .group_by(scope.c.id, scope.c.number, scope.c.created_at)
            .order_by(func.max(AuditEvent.at).desc())
            .limit(10)
        ).all()
        recent_resolved = [
            {"number": num, "created_at": ca, "resolved_at": ra,
             "duration_minutes": round(
                 (datetime.fromisoformat(ra) - datetime.fromisoformat(ca)).total_seconds() / 60, 1)}
            for num, ca, ra in recent_q
        ]
        return {
            "total": total, "counts": counts, "overdue": overdue,
            "priority_counts": priority_counts,
            "resolution": {
                "count": len(minutes),
                "median_minutes": round(median_mins, 1) if median_mins is not None else None,
                "avg_minutes": round(avg_mins, 1) if avg_mins is not None else None,
            },
            "asset_frequency": [
                {"code": code, "name": name, "area": area, "total_count": cnt}
                for code, name, area, cnt in asset_rows
            ],
            "recent_resolved": recent_resolved,
        }

    @app.api_route("/api/bridge/{legacy_path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
    @app.api_route("/api/scenarios", methods=["GET"])
    @app.api_route("/api/dashboard/summary", methods=["GET"])
    @app.api_route("/api/sync/mutations", methods=["GET"])
    def retired(legacy_path: str = ""):
        fail(410, "Prototype API retired. Use the authenticated /api/v1 API")

    # Do not let the SPA fallback turn an unknown API URL into index.html.
    @app.api_route("/api/v1", methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"])
    @app.api_route("/api/v1/{unmatched:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"])
    def unknown_api_route(unmatched: str = ""):
        fail(404, "API route not found")

    # The production/demo container includes the Vite build. Keep this mount
    # optional so API-only test runs and local backend development still work
    # when frontend/dist has not been built yet. API routes are registered
    # above, so they retain precedence over the root frontend mount.
    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

    return app


def validate_evidence(content: bytes, declared: str) -> str:
    supported = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
    if declared not in supported:
        fail(415, "Only PNG, JPEG, WebP and PDF evidence are supported")
    if declared == "application/pdf":
        if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:]:
            fail(422, "Invalid PDF signature or incomplete PDF")
        # Parse the structure as well as the signature. Names may be escaped or
        # objects compressed, so a raw regex cannot enforce the active-content gate.
        try:
            reader = PdfReader(io.BytesIO(content), strict=True)
            if reader.is_encrypted or not 1 <= len(reader.pages) <= 1000:
                fail(422, "Encrypted, empty or oversized-page-count PDFs are unsupported")
            stack, visited, inspected = [(reader.trailer, 0)], set(), 0
            forbidden = {"/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/EmbeddedFile", "/EmbeddedFiles", "/RichMedia", "/XFA", "/AcroForm"}
            while stack:
                obj, depth = stack.pop()
                inspected += 1
                if inspected > 20000 or depth > 100:
                    fail(422, "PDF structure is too complex")
                if isinstance(obj, IndirectObject):
                    identity = (obj.idnum, obj.generation)
                    if identity in visited:
                        continue
                    visited.add(identity)
                    obj = obj.get_object()
                if isinstance(obj, DictionaryObject):
                    if forbidden.intersection(obj.keys()) or str(obj.get("/S", "")) in {"/JavaScript", "/Launch", "/SubmitForm", "/ImportData", "/GoToR", "/Rendition"}:
                        fail(422, "Active or embedded PDF content is unsupported")
                    stack.extend((value, depth + 1) for value in obj.values())
                elif isinstance(obj, ArrayObject):
                    stack.extend((value, depth + 1) for value in obj)
        except (PdfReadError, ValueError, TypeError, KeyError, IndexError, AttributeError, OverflowError, AssertionError, NotImplementedError, RecursionError, OSError):
            fail(422, "Invalid or unsupported PDF structure")
        return declared
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                actual = Image.MIME.get(image.format)
                if actual != declared or image.width * image.height > 25_000_000:
                    fail(422, "Image type mismatch or excessive pixel dimensions")
                image.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError, struct.error, Image.DecompressionBombWarning, Image.DecompressionBombError):
        fail(422, "Invalid or unsafe image data")
    return declared


app = create_app()
