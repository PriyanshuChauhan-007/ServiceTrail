# Completion implementation contract

This extends product-contract.md. Do not simulate external services or certification.

## Ownership
- Backend agent owns backend/**; implements and tests all new server endpoints, schema migrations, and configuration. Main integrates deployment/docs after results.
- Frontend agent owns frontend/src/** EXCEPT offline.ts, VaultPanel.tsx, OfflineAccess.tsx and offline.test.mjs (main owns those). Keep other tests working.
- Main implements encrypted device vault, deployment/test integration and GitHub delivery.

## Account security
- Extend User public fields: `active:boolean`, `must_change_password:boolean`, `mfa_enabled:boolean` (frontend tolerate old fields until backend merged).
- `POST /auth/login` accepts `{email,password,otp?:string,recovery_code?:string}`. MFA must be checked before issuing a full session. Missing MFA returns 401 detail `MFA code required` after correct password; no role headers accepted.
- `POST /auth/change-password` `{current_password,new_password}` revokes other sessions and clears must_change_password; current session remains valid. Require current MFA OTP if enrolled (`otp?`). Restrict other mutations when must_change_password until change/logout/security routes.
- `GET /auth/sessions` => array `{id,created_at,expires_at,current}`. Public session IDs are not bearer tokens. `DELETE /auth/sessions/{id}` own sessions only; `POST /auth/sessions/revoke-others`.
- `POST /auth/mfa/enroll` `{password}` => `{secret,otpauth_uri}` one-time response after password verification; pending secret encrypted server-side, short-lived. Never log secret.
- `POST /auth/mfa/confirm` `{otp}` => `{recovery_codes:string[]}` displayed once; hash codes, reject reuse. `POST /auth/mfa/disable` `{password,otp}`.
- TOTP RFC6238; replay protection, rate-limited failures; encrypt secrets with cryptography/Fernet using server key, production must have FIELD_ENCRYPTION_KEY, local key only ignored backend/data.
- `PATCH /users/{id}` admin `{active?,role?}` (same site, prevent self/last-admin lockout), revokes affected sessions; provisioning default must_change_password true.
- `POST /users/{id}/recovery` admin => `{token,expires_at}` one-use short-lived token delivered by administrator directly (not fake email).
- `POST /auth/reset-password` `{token,new_password}` one-use reset, all sessions revoked; do NOT bypass MFA with reset. Admin recovery should require disabling/resetting MFA only if explicitly implemented with audited action; never silently drop it.
- Admin/site/user/asset/security actions recorded in organization-scoped administrative audit `GET /admin/audit?limit=50&offset=0` => `{items:[{id,action,actor_name,note,at}],total}`. Never include plaintext passwords/secrets/tokens in audit.

## Operations
- Keep GET /incidents legacy array for compatibility but cap it (default 100, max 200). New UI uses `GET /incidents/page?limit=25&offset=0&search=&status=&mine=false` => `{items:Incident[],total:number,counts:Record<string,number>}`. Org/site/worker scope before filtering; counts over scoped site. Bounded deterministic order.
- `GET /work-methods` => array `{id,name,description,steps:[{label,required}],version}`. `POST /work-methods` reviewer with `{name,description,steps}`; current methods immutable/new version via new method. No unsafe AI-generated execution instructions.
- Approval action supports `work_method_id?`; copies chosen steps plus method provenance into current release. UI requires a selection where methods exist; retain conservative default when none, explicitly labelled generic record not SOP.
- Action `schedule` reviewer `{version,due_at,note}` ISO timezone required; persist due date + audit. `GET /notifications` => in-app current user notifications `{id,title,message,incident_id?,created_at,read_at}`; `POST /notifications/{id}/read`. Notify author/assignee on clarification/approval/assignment and reviewers on submission/verification; durable DB, not simulated email.
- `POST /sites` admin `{name}` and `GET /sites`; `POST /auth/switch-site` `{site_id}` admin only, new session/current user site changed, server must invalidate stale session site scope. Worker must never switch into unauthorized site. Admin creates users in current site. Include site in directory/assignment filtering.
- Evidence quotas from config MAX_EVIDENCE_PER_INCIDENT default20, MAX_ORG_EVIDENCE_BYTES default100MiB; enforce transactionally. Baseline validated DB attachment storage remains; no fake antivirus/object store.
- `GET /metrics/summary` authenticated reviewer aggregate actual counts, overdue, median resolution minutes if available; never fabricate empty analytics.
- Optional inbound machine observation integration: `POST /integrations` admin `{name}` => one-time `{id,name,token}` hashed server-side; `GET /integrations` metadata; `DELETE /integrations/{id}` revoke; `POST /integrations/{id}/observations` bearer token `{asset_code,external_id,observed_at,measurements:object}` durable idempotency, scoped asset, audited; `GET /assets/{id}/observations` reviewer. Observation is externally supplied, not verified truth. No outbound network connections/SCADA claims.

## Frontend security/workflow views
Real account security page (change password, MFA enrollment/recovery codes, sessions), login OTP and reset form, admin activation/roles/recovery with one-time sensitive display, site switch, work-method create/select, schedule date/note, actual notifications, paged queue/search and real aggregate metrics. No secret in URLs/localStorage/logs.

## Device vault (main implementation)
Maintain existing offline.ts API with encrypted records. Add exports:
- `VaultInfo {user_id,label,created_at}`; `listVaults():Promise<VaultInfo[]>` (only safe metadata).
- `vaultStatus(userId):Promise<'missing'|'locked'|'unlocked'>`.
- `createVault(user:User,passphrase:string,label:string):Promise<void>`; explicitly migrates this user's old plaintext drafts/assets atomically, never discards pending work.
- `unlockVault(userId,passphrase):Promise<User>` decrypts cached profile; `lockVault(userId):void` clears memory key; `isVaultUnlocked(userId):boolean`.
- Per-record AES-GCM with unique random IV + authenticated owner/type/id; PBKDF2 SHA256 >=600k, random per-vault salt. Crypto key lives in memory only; no credentials/keys in persistent browser storage. Passphrase >=12; local vault is NOT server sign-in/permission.
- `VaultPanel.tsx` main default export props `{user:User,onChanged?:()=>void}` permits enroll/unlock/lock (main implements).
- `OfflineAccess.tsx` main default export props `{onUnlocked:(user:User)=>void,onBack:()=>void}`. Cached identity is device context only, never server authorization.
- Frontend boot on genuine NetworkError offers OfflineAccess. Offline unlocked workspace may capture drafts using cached assets; do not show approved incident cache or perform approvals. Reconnection requires server session identity match/sign-in. Security page includes VaultPanel. Always lock vault on signout and account change; clear account data only on explicit confirmation. Direct save device draft allowed when unlocked during confirmed offline mode, preserving same client_id.

## Verification
Backend tests must cover migration1 upgrade, MFA replay/recovery, reset/session revocation, deactivation, site isolation, pagination, methods, SLA/notifications, quotas and integration token idempotency. Frontend tests/build plus encrypted draft tests. Docker unavailable locally; GitHub CI PostgreSQL and container smoke must be configured and observed after push. Document remaining external identity/AI/AV/vendor integration and independent audit requirements honestly.
