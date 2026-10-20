"""Account lifecycle, encrypted RFC6238 MFA and durable security audit."""
import base64
import hmac
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import Depends, Request, Response
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from .database import AdminAudit, AuthSession, LoginThrottle, PasswordRecovery, Site, User, now
from .demo_seed import (DEMO_USER_IDS, controller_admin, demo_available, is_demo_admin,
                        is_seeded_persona, issue_controller)
from .models import (ChangePassword, DisableMFA, NamedInput, OTP, PasswordProof,
                     OpenWorkspace, ResetPassword, SwitchPerspective, SwitchSite, UserUpdate)
from .security import COOKIE, hash_password, token_hash, totp, verify_password


def admin_audit(db, user, action, note=None):
    db.add(AdminAudit(organization_id=user.organization_id, actor_id=user.id,
                      actor_name=user.name, action=action, note=note))


def security_attempt(db, user, settings, fail, purpose="mfa"):
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(724158192)"))
    key, current = token_hash("security:" + purpose + ":" + user.id), int(time.time())
    throttle = db.get(LoginThrottle, key)
    if not throttle:
        throttle = LoginThrottle(key=key, attempts=0, window_start=current)
        db.add(throttle)
    if current - throttle.window_start >= settings.login_window_seconds:
        throttle.window_start, throttle.attempts = current, 0
    if throttle.attempts >= settings.login_limit:
        fail(429, "Too many security attempts; try again later")
    throttle.attempts += 1
    return throttle


def verify_mfa(db, user, otp, recovery_code, cipher, settings, fail, pending=False):
    throttle = security_attempt(db, user, settings, fail)
    if recovery_code and not pending:
        digest = token_hash(recovery_code.strip().upper())
        match = next((value for value in user.recovery_hashes if hmac.compare_digest(value, digest)), None)
        if match:
            user.recovery_hashes = [value for value in user.recovery_hashes if value != match]
            throttle.attempts = 0
            admin_audit(db, user, "mfa.recovery_code_used")
            return
    encrypted = user.mfa_pending if pending else user.mfa_secret
    if encrypted and otp and otp.isdigit() and len(otp) == 6:
        secret = cipher.decrypt(encrypted.encode()).decode()
        counter = int(time.time()) // 30
        for value in (counter - 1, counter, counter + 1):
            if value > user.mfa_last_counter and hmac.compare_digest(totp(secret, value), otp):
                user.mfa_last_counter = value
                throttle.attempts = 0
                return
    admin_audit(db, user, "mfa.verification_failed")
    db.commit()
    fail(401, "MFA code required" if not otp and not recovery_code else "Invalid or already used MFA code")


def password_proof(db, user, password, settings, fail):
    throttle = security_attempt(db, user, settings, fail, "password")
    if not verify_password(password, user.password_hash):
        admin_audit(db, user, "password.verification_failed")
        db.commit()
        fail(401, "Invalid password")
    throttle.attempts = 0


def iso_epoch(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def install_accounts(app, database, identity, issue_session, settings, cipher, fail, require_role, public_user):
    def current_hash(request):
        return token_hash(request.cookies.get(COOKIE, ""))

    @app.post("/api/v1/auth/change-password")
    def change_password(data: ChangePassword, request: Request, user: User = Depends(identity), db: Session = Depends(database)):
        password_proof(db, user, data.current_password, settings, fail)
        if data.new_password == data.current_password:
            fail(422, "Choose a different password")
        if user.mfa_secret:
            verify_mfa(db, user, data.otp, None, cipher, settings, fail)
        user.password_hash = hash_password(data.new_password)
        user.must_change_password = False
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.token_hash != current_hash(request)))
        db.execute(delete(PasswordRecovery).where(PasswordRecovery.user_id == user.id))
        admin_audit(db, user, "password.changed")
        return {"user": public_user(db, user)}

    @app.get("/api/v1/auth/sessions")
    def sessions(request: Request, user: User = Depends(identity), db: Session = Depends(database)):
        return [{"id": item.id, "created_at": item.created_at, "expires_at": iso_epoch(item.expires_at),
                 "current": item.token_hash == current_hash(request)} for item in db.scalars(select(AuthSession).where(
                     AuthSession.user_id == user.id, AuthSession.expires_at > int(time.time())).order_by(AuthSession.created_at.desc(), AuthSession.id))]

    @app.delete("/api/v1/auth/sessions/{session_id}")
    def revoke_session(session_id: str, user: User = Depends(identity), db: Session = Depends(database)):
        item = db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user.id))
        if not item:
            fail(404, "Session not found")
        db.delete(item)
        admin_audit(db, user, "session.revoked", session_id)
        return {"ok": True}

    @app.post("/api/v1/auth/sessions/revoke-others")
    def revoke_others(request: Request, user: User = Depends(identity), db: Session = Depends(database)):
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.token_hash != current_hash(request)))
        admin_audit(db, user, "sessions.revoked_others")
        return {"ok": True}

    @app.post("/api/v1/auth/mfa/enroll")
    def enroll(data: PasswordProof, user: User = Depends(identity), db: Session = Depends(database)):
        password_proof(db, user, data.password, settings, fail)
        if user.mfa_secret:
            fail(409, "MFA is already enabled")
        secret = base64.b32encode(secrets.token_bytes(20)).decode()
        user.mfa_pending = cipher.encrypt(secret.encode()).decode()
        user.mfa_pending_expires = int(time.time()) + 600
        admin_audit(db, user, "mfa.enrollment_started")
        return {"secret": secret, "otpauth_uri": f"otpauth://totp/{quote('OpsBridge:' + user.email)}?secret={secret}&issuer=OpsBridge&algorithm=SHA1&digits=6&period=30"}

    @app.post("/api/v1/auth/mfa/confirm")
    def confirm(data: OTP, request: Request, user: User = Depends(identity), db: Session = Depends(database)):
        if user.mfa_secret or not user.mfa_pending or (user.mfa_pending_expires or 0) <= int(time.time()):
            fail(409, "Start a new MFA enrollment")
        verify_mfa(db, user, data.otp, None, cipher, settings, fail, pending=True)
        user.mfa_secret, user.mfa_pending, user.mfa_pending_expires = user.mfa_pending, None, None
        codes = [secrets.token_hex(8).upper() for _ in range(10)]
        user.recovery_hashes = [token_hash(code) for code in codes]
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.token_hash != current_hash(request)))
        admin_audit(db, user, "mfa.enabled")
        return {"recovery_codes": codes}

    @app.post("/api/v1/auth/mfa/disable")
    def disable(data: DisableMFA, request: Request, user: User = Depends(identity), db: Session = Depends(database)):
        password_proof(db, user, data.password, settings, fail)
        if not user.mfa_secret:
            fail(409, "MFA is not enabled")
        verify_mfa(db, user, data.otp, None, cipher, settings, fail)
        user.mfa_secret, user.mfa_pending, user.mfa_pending_expires = None, None, None
        user.recovery_hashes, user.mfa_last_counter = [], -1
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.token_hash != current_hash(request)))
        admin_audit(db, user, "mfa.disabled")
        return {"ok": True}

    @app.patch("/api/v1/users/{user_id}")
    def update_user(user_id: str, data: UserUpdate, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        # Serialize admin role changes so two concurrent removals cannot remove the last admin.
        db.scalar(select(Site).where(Site.id == user.site_id).with_for_update())
        item = db.scalar(select(User).where(User.id == user_id, User.organization_id == user.organization_id,
                                           User.site_id == user.site_id).with_for_update())
        if not item:
            fail(404, "User not found in this site")
        removes_admin = (data.active is False or (data.role is not None and data.role != "admin"))
        if item.id == user.id and removes_admin:
            fail(409, "Cannot deactivate or demote yourself")
        if item.active and item.role == "admin" and removes_admin:
            count = db.scalar(select(func.count()).select_from(User).where(User.organization_id == user.organization_id,
                        User.site_id == user.site_id, User.role == "admin", User.active.is_(True)))
            if count <= 1:
                fail(409, "Cannot remove the last active site administrator")
        for key, value in data.model_dump(exclude_none=True).items():
            setattr(item, key, value)
        db.execute(delete(AuthSession).where(AuthSession.user_id == item.id))
        admin_audit(db, user, "user.updated", f"User {item.id}; active={item.active}; role={item.role}")
        return public_user(db, item)

    @app.post("/api/v1/users/{user_id}/recovery")
    def recovery(user_id: str, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        item = db.scalar(select(User).where(User.id == user_id, User.organization_id == user.organization_id,
                                          User.site_id == user.site_id).with_for_update())
        if not item or not item.active:
            fail(404, "Active user not found in this site")
        db.execute(delete(PasswordRecovery).where(PasswordRecovery.user_id == item.id))
        token, expires = secrets.token_urlsafe(32), int(time.time()) + 900
        db.add(PasswordRecovery(token_hash=token_hash(token), user_id=item.id, expires_at=expires))
        admin_audit(db, user, "user.recovery_issued", f"User {item.id}; MFA retained")
        return {"token": token, "expires_at": iso_epoch(expires)}

    @app.post("/api/v1/auth/reset-password")
    def reset(data: ResetPassword, db: Session = Depends(database)):
        item = db.scalar(select(PasswordRecovery).where(PasswordRecovery.token_hash == token_hash(data.token)))
        if not item or item.expires_at <= int(time.time()):
            fail(401, "Recovery token expired or invalid")
        user = db.scalar(select(User).where(User.id == item.user_id).with_for_update())
        item = db.get(PasswordRecovery, token_hash(data.token), populate_existing=True)
        if not item or item.expires_at <= int(time.time()):
            fail(401, "Recovery token expired or invalid")
        if not user.active:
            fail(401, "Recovery token expired or invalid")
        user.password_hash, user.must_change_password = hash_password(data.new_password), False
        db.execute(delete(PasswordRecovery).where(PasswordRecovery.user_id == user.id))
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        admin_audit(db, user, "password.reset", "Administrator-issued one-use recovery; MFA retained")
        return {"ok": True}

    @app.get("/api/v1/sites")
    def sites(user: User = Depends(identity), db: Session = Depends(database)):
        query = select(Site).where(Site.organization_id == user.organization_id)
        if user.role != "admin":
            query = query.where(Site.id == user.site_id)
        return [{"id": item.id, "name": item.name} for item in db.scalars(query.order_by(Site.name, Site.id))]

    @app.post("/api/v1/sites", status_code=201)
    def create_site(data: NamedInput, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        item = Site(name=data.name, organization_id=user.organization_id)
        db.add(item)
        db.flush()
        admin_audit(db, user, "site.created", f"Site {item.id}: {item.name}")
        return {"id": item.id, "name": item.name}

    @app.post("/api/v1/auth/switch-site")
    def switch_site(data: SwitchSite, request: Request, response: Response, user: User = Depends(identity), db: Session = Depends(database)):
        user = db.scalar(select(User).where(User.id == user.id).with_for_update().execution_options(populate_existing=True))
        require_role(user, {"admin"})
        active_session = db.get(AuthSession, token_hash(request.cookies.get(COOKIE, "")), populate_existing=True)
        if not user.active or not active_session or active_session.site_id != user.site_id:
            fail(401, "Session expired or invalid")
        site = db.scalar(select(Site).where(Site.id == data.site_id, Site.organization_id == user.organization_id))
        if not site:
            fail(404, "Site not found")
        user.site_id = site.id
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
        issue_session(db, response, user, request)
        admin_audit(db, user, "session.site_switched", f"Site {site.id}")
        return {"user": public_user(db, user)}

    def perspective_authority(db, request, user):
        if settings.environment != "demo" or not is_seeded_persona(db, user, user.role):
            fail(403, "Perspective switching is unavailable")
        if user.must_change_password:
            fail(403, "Initial password change required")
        administrator = controller_admin(db, request, settings)
        if administrator:
            return administrator
        if is_demo_admin(db, user):
            return user
        fail(403, "Perspective switching is unavailable")

    def perspectives(request: Request, user: User = Depends(identity), db: Session = Depends(database)):
        perspective_authority(db, request, user)
        users = {item.id: item for item in db.scalars(select(User).where(User.id.in_(DEMO_USER_IDS.values())))}
        return [{"key": key, "id": users[item_id].id, "name": users[item_id].name, "role": key}
                for key, item_id in DEMO_USER_IDS.items() if item_id in users and is_seeded_persona(db, users[item_id], key)]

    def switch_perspective(data: SwitchPerspective, request: Request, response: Response,
                           user: User = Depends(identity), db: Session = Depends(database)):
        administrator = perspective_authority(db, request, user)
        target = db.scalar(select(User).where(User.id == DEMO_USER_IDS[data.perspective],
            User.organization_id == user.organization_id, User.site_id == user.site_id).with_for_update())
        if not target or not is_seeded_persona(db, target, data.perspective):
            fail(404, "Perspective is unavailable")
        admin_audit(db, administrator, "session.perspective_switched", f"From user {user.id}; perspective {data.perspective}; user {target.id}")
        if not controller_admin(db, request, settings):
            issue_controller(db, request, response, settings)
        issue_session(db, response, target, request)
        return {"user": public_user(db, target)}

    def enter_workspace(data: OpenWorkspace, request: Request, response: Response, db: Session = Depends(database)):
        administrator = db.scalar(select(User).where(User.id == DEMO_USER_IDS["admin"]).with_for_update())
        if not administrator or not demo_available(db, settings):
            fail(404, "Shared workspace is unavailable")
        issue_controller(db, request, response, settings)
        issue_session(db, response, administrator, request)
        admin_audit(db, administrator, "session.workspace_opened", "Public shared example workspace opened")
        return {"user": public_user(db, administrator)}

    if settings.environment == "demo":
        app.add_api_route("/api/v1/auth/demo/enter", enter_workspace, methods=["POST"])
        app.add_api_route("/api/v1/auth/perspectives", perspectives, methods=["GET"])
        app.add_api_route("/api/v1/auth/perspectives/switch", switch_perspective, methods=["POST"])

    @app.get("/api/v1/admin/audit")
    def audit_log(limit: int = 50, offset: int = 0, user: User = Depends(identity), db: Session = Depends(database)):
        require_role(user, {"admin"})
        if not 1 <= limit <= 200 or offset < 0:
            fail(422, "Invalid pagination")
        query = select(AdminAudit).where(AdminAudit.organization_id == user.organization_id)
        total = db.scalar(select(func.count()).select_from(query.subquery()))
        items = db.scalars(query.order_by(AdminAudit.at.desc(), AdminAudit.id).limit(limit).offset(offset))
        return {"items": [{key: getattr(item, key) for key in ("id", "action", "actor_name", "note", "at")} for item in items], "total": total}
