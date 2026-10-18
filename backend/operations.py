"""Scoped queue, immutable work methods, durable notifications and inbound observations."""
import hashlib
import hmac
import json
from datetime import datetime, timezone
from statistics import median

from fastapi import Depends, Request, Response
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .accounts import admin_audit
from .database import (AdminAudit, Asset, AuditEvent, Incident, Integration, Notification,
                       Observation, Site, User, WorkMethod, now, uid)
from .models import MethodInput, NamedInput, ObservationInput
from .security import token_hash
import secrets


REVIEWERS = {"admin", "supervisor", "engineer"}


def incident_scope(user):
    query = select(Incident).where(Incident.organization_id == user.organization_id, Incident.site_id == user.site_id)
    if user.role == "worker":
        query = query.where((Incident.reporter_id == user.id) | (Incident.assigned_to_id == user.id))
    return query


def method_data(item):
    return {key: getattr(item, key) for key in ("id", "name", "description", "steps", "version")}


def notify(db, item, event):
    if event in {"submitted", "submit_verification"}:
        recipients = set(db.scalars(select(User.id).where(User.organization_id == item.organization_id,
            User.site_id == item.site_id, User.active.is_(True), User.role.in_(REVIEWERS))))
    else:
        recipients = {item.reporter_id, item.assigned_to_id} - {None}
    titles = {"submitted": "Report submitted", "submit_verification": "Work awaits verification",
              "approve": "Work approved", "request_changes": "Clarification requested",
              "needs_clarification": "Clarification required", "assign": "Work assignment updated"}
    for user_id in sorted(recipients):
        db.add(Notification(user_id=user_id, site_id=item.site_id, title=titles[event],
                            message=f"{item.number}: {titles[event]}", incident_id=item.id))


def install_operations(app, database, identity, fail, require_role, incident_data, scoped_asset):
    @app.get("/api/v1/incidents/page")
    def page(limit: int = 25, offset: int = 0, search: str = "", status: str = "", mine: bool = False,
             user: User = Depends(identity), db: Session = Depends(database)):
        if not 1 <= limit <= 200 or offset < 0 or len(search) > 200:
            fail(422, "Invalid pagination or search")
        query = incident_scope(user)
        scope = query.subquery()
        counts = dict(db.execute(select(scope.c.status, func.count()).group_by(scope.c.status)).all())
        if status:
            query = query.where(Incident.status == status)
        if mine:
            query = query.where((Incident.reporter_id == user.id) | (Incident.assigned_to_id == user.id))
        if search.strip():
            # Escape wildcard characters; searching a percent sign is a literal search.
            needle = "%" + search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            query = query.join(Asset, Asset.id == Incident.asset_id).where(
                Incident.number.ilike(needle, escape="\\") | Incident.report["description"].as_string().ilike(needle, escape="\\") |
                Asset.code.ilike(needle, escape="\\") | Asset.name.ilike(needle, escape="\\"))
        total = db.scalar(select(func.count()).select_from(query.subquery()))
        items = db.scalars(query.order_by(Incident.created_at.desc(), Incident.id).limit(limit).offset(offset))
        return {"items": [incident_data(db, item) for item in items], "total": total, "counts": counts}

    @app.get("/api/v1/work-methods")
    def methods(user: User = Depends(identity), db: Session = Depends(database)):
        return [method_data(item) for item in db.scalars(select(WorkMethod).where(
            WorkMethod.organization_id == user.organization_id, WorkMethod.site_id == user.site_id)
            .order_by(WorkMethod.name, WorkMethod.version.desc(), WorkMethod.id))]

    @app.post("/api/v1/work-methods", status_code=201)
    def create_method(data: MethodInput, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, REVIEWERS)
        db.scalar(select(Site).where(Site.id == user.site_id).with_for_update())
        version = (db.scalar(select(func.max(WorkMethod.version)).where(WorkMethod.organization_id == user.organization_id,
                    WorkMethod.site_id == user.site_id, WorkMethod.name == data.name)) or 0) + 1
        item = WorkMethod(**data.model_dump(), organization_id=user.organization_id, site_id=user.site_id, version=version)
        db.add(item)
        db.flush()
        admin_audit(db, user, "work_method.created", f"Method {item.id}; version {version}")
        return method_data(item)

    @app.get("/api/v1/notifications")
    def notifications(user: User = Depends(identity), db: Session = Depends(database)):
        query = select(Notification).where(Notification.user_id == user.id, Notification.site_id == user.site_id)
        return [{key: getattr(item, key) for key in ("id", "title", "message", "incident_id", "created_at", "read_at")}
                for item in db.scalars(query.order_by(Notification.created_at.desc(), Notification.id))]

    @app.post("/api/v1/notifications/{notification_id}/read")
    def read_notification(notification_id: str, user: User = Depends(identity), db: Session = Depends(database)):
        item = db.scalar(select(Notification).where(Notification.id == notification_id,
            Notification.user_id == user.id, Notification.site_id == user.site_id).with_for_update())
        if not item:
            fail(404, "Notification not found")
        item.read_at = item.read_at or now()
        return {key: getattr(item, key) for key in ("id", "title", "message", "incident_id", "created_at", "read_at")}

    @app.get("/api/v1/metrics/summary")
    def summary(user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, REVIEWERS)
        scope = incident_scope(user).subquery()
        counts = dict(db.execute(select(scope.c.status, func.count()).group_by(scope.c.status)).all())
        current = now()
        overdue = db.scalar(select(func.count()).select_from(scope).where(scope.c.due_at < current,
                           scope.c.status.not_in(["resolved", "cancelled"])))
        resolved = db.execute(select(scope.c.created_at, func.max(AuditEvent.at)).join(AuditEvent,
            AuditEvent.incident_id == scope.c.id).where(scope.c.status == "resolved", AuditEvent.action == "resolve")
            .group_by(scope.c.id, scope.c.created_at)).all()
        minutes = [(datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() / 60 for start, end in resolved]
        return {"total": sum(counts.values()), "counts": counts, "overdue": overdue,
                "median_resolution_minutes": median(minutes) if minutes else None}

    def integration_metadata(item):
        return {key: getattr(item, key) for key in ("id", "name", "active", "created_at", "site_id")}

    @app.post("/api/v1/integrations", status_code=201)
    def create_integration(data: NamedInput, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        token = secrets.token_urlsafe(32)
        item = Integration(name=data.name, organization_id=user.organization_id, site_id=user.site_id, token_hash=token_hash(token))
        db.add(item)
        db.flush()
        admin_audit(db, user, "integration.created", f"Integration {item.id}")
        return {"id": item.id, "name": item.name, "token": token}

    @app.get("/api/v1/integrations")
    def integrations(user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        return [integration_metadata(item) for item in db.scalars(select(Integration).where(
            Integration.organization_id == user.organization_id, Integration.site_id == user.site_id).order_by(Integration.created_at, Integration.id))]

    @app.delete("/api/v1/integrations/{integration_id}")
    def revoke(integration_id: str, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        item = db.scalar(select(Integration).where(Integration.id == integration_id,
            Integration.organization_id == user.organization_id, Integration.site_id == user.site_id).with_for_update())
        if not item:
            fail(404, "Integration not found")
        item.active = False
        admin_audit(db, user, "integration.revoked", f"Integration {item.id}")
        return {"ok": True}

    def observation_data(item):
        return {**{key: getattr(item, key) for key in ("id", "integration_id", "asset_id", "external_id", "observed_at", "measurements", "created_at")},
                "source": "externally supplied observation; not verified truth"}

    @app.post("/api/v1/integrations/{integration_id}/observations", status_code=201)
    def inbound(integration_id: str, data: ObservationInput, request: Request, response: Response, db: Session = Depends(database)):
        item = db.scalar(select(Integration).where(Integration.id == integration_id).with_for_update())
        header = request.headers.get("authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        if not token or len(token) > 200 or not item or not item.active or not hmac.compare_digest(item.token_hash, token_hash(token)):
            fail(401, "Invalid integration credentials")
        # Integration row lock serializes both idempotency and revocation.
        fingerprint = hashlib.sha256(json.dumps(data.model_dump(mode="json"), sort_keys=True, allow_nan=False).encode()).hexdigest()
        previous = db.scalar(select(Observation).where(Observation.integration_id == item.id, Observation.external_id == data.external_id))
        if previous:
            if previous.fingerprint != fingerprint:
                fail(409, "external_id already used with different observation content")
            response.status_code = 200
            return observation_data(previous)
        asset = db.scalar(select(Asset).where(Asset.code == data.asset_code, Asset.organization_id == item.organization_id, Asset.site_id == item.site_id))
        if not asset:
            fail(404, "Asset not found in integration site")
        observation = Observation(integration_id=item.id, asset_id=asset.id, external_id=data.external_id,
            observed_at=data.observed_at.isoformat(), measurements=data.measurements, fingerprint=fingerprint)
        db.add(observation)
        db.flush()
        db.add(AdminAudit(organization_id=item.organization_id, actor_name=f"Integration: {item.name}",
            action="integration.observation_received", note=f"Integration {item.id}; observation {observation.id}; externally supplied, unverified"))
        return observation_data(observation)

    @app.get("/api/v1/assets/{asset_id}/observations")
    def observations(asset_id: str, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, REVIEWERS)
        scoped_asset(db, user, asset_id)
        return [observation_data(item) for item in db.scalars(select(Observation).where(Observation.asset_id == asset_id)
            .order_by(Observation.observed_at.desc(), Observation.id))]
