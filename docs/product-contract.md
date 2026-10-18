# OpsBridge product contract

Manufacturing-first. New authenticated application lives under `/api/v1`. Legacy `/api/bridge` endpoints must not remain an unauthenticated mutation bypass; retire them (410) or remove them. Rule-based extraction is assistive, not a verified diagnosis. No seeded users, passwords, fabricated measurements, or claims of compliance.

## Identity and setup
- `GET /api/v1/setup/status` => `{needs_setup: boolean}`.
- `POST /api/v1/setup` => input `{organization_name, site_name, name, email, password}`, creates organization/site/admin and returns `{user}` with session cookie.
- `POST /api/v1/auth/login` => `{email,password}`, returns `{user}`; cookie-based HTTP-only session.
- `GET /api/v1/auth/me` => `{user}`; `POST /api/v1/auth/logout` clears/revokes session.
- `user`: `{id,name,email,role,organization_id,site_id,organization_name,site_name}`. Roles `worker | engineer | supervisor | admin`.
- `GET /api/v1/users` (org scoped); `POST /api/v1/users` (admin) `{name,email,password,role}`. No demo role switching; sign out/sign in to change identity. Password >=12 characters. Full engineer display name Priyanshu Chauhan.

## Assets
- `GET /api/v1/assets` => array.
- `POST /api/v1/assets` (admin/supervisor) `{code,name,area,criticality,manufacturer?,model?}`.
- `asset`: `{id,code,name,area,criticality,manufacturer?,model?,status}`; criticality `low|medium|high|critical`. QR scan maps to registered asset code, never invents a fact.

## Incidents
- `GET /api/v1/incidents` => array of full incident records scoped by organization/site; worker sees own reports/assigned work, reviewers see site queue.
- `POST /api/v1/incidents` worker/admin input `{asset_id,description,impact,injury_status,safe_state,measurements?,client_id?}`. Measurements free text retaining worker observation, not sensor verified. client_id stable UUID prevents duplicate offline creates per user. Returns full incident.
- `GET /api/v1/incidents/{id}` => full incident.
- `PATCH /api/v1/incidents/{id}` reporter only in submitted/needs_clarification/changes_requested (admin may own their reports): same report fields plus `version`. Increment report version; invalidate stale analysis/approval. Evidence edits also invalidate review.
- `POST /api/v1/incidents/{id}/actions` => `{action,note?,review_confirmed?,version,assigned_to?}` returns full incident. `analyze | request_changes | approve | start | submit_verification | resolve | reopen | cancel | assign`.
- Reviewer actions engineer/supervisor/admin; execution actions worker/report author or assignee. Approval actor from authenticated session, never a supplied name/role. Authors cannot approve their own reports even if admin.
- Statuses: `submitted, needs_clarification, ready_for_review, under_review, changes_requested, approved, in_progress, awaiting_verification, resolved, reopened, cancelled`.
- Approval requires current version, analyzed report, no blocking findings, review_confirmed, decision note. Request-changes requires note even if incomplete.
- Required checklist steps all completed before submit_verification. Engineer independently verifies and resolves with note. Reopen requires note.
- `PATCH /api/v1/incidents/{id}/checklist/{item_id}` `{completed,notes,version}` only assigned worker/report author during approved/in_progress; required completion needs notes. Returns incident. Server performs progress status transitions.
- No offline approvals. No success fallback on authorization/conflict/validation/API errors. Never fabricate offline approval/checklist.

## Incident representation
`{id,number,asset_id,asset,description,impact,injury_status,safe_state,measurements,priority,status,version,reporter:{id,name},assigned_to:{id,name}|null,created_at,updated_at,due_at,findings,analysis,approval,checklist,evidence,timeline}`.
- injury_status `none|reported|unknown`; safe_state `isolated|stopped|running|unknown`.
- `findings`: `[{field,label,message,severity:"blocking"|"warning",source:"rule"}]`; includes missing evidence/measurement warnings, contradictions and negation caution. No calibrated truth probability.
- `analysis`: null or `{summary,hypotheses:string[],recommended_actions:string[],safety_flags:string[],basis:string,report_version:number}`. Hypotheses explicitly unverified.
- `approval`: null or `{actor_name,note,at,report_version}`.
- `checklist`: `[{id,label,required,completed,notes}]`.
- `evidence`: `[{id,filename,content_type,size,uploaded_by,created_at,url}]` URL protected by cookie.
- `timeline`: `[{id,action,actor_name,actor_role,note,at,report_version}]` append-only API; unverified source statements always preserved in audit snapshot.

## Evidence and exports
- `POST /api/v1/incidents/{id}/evidence` multipart field `file`; authenticated author, preapproval report; supported safe image/PDF, max 10 MB; no filename path trust; validate signatures.
- Protected evidence download at returned URL; no public uploads mount.
- `GET /api/v1/incidents/{id}/export` returns JSON including provenance and audit events, no tokens/password hashes.
- `GET /api/v1/health` readiness endpoint (no secrets).

## Offline module API (platform agent)
`frontend/src/offline.ts` exports:
- `OfflineDraft {client_id:string,user_id:string,asset_id:string,description:string,impact:string,injury_status:string,safe_state:string,measurements:string,created_at:string,last_error?:string}`.
- `saveDraft(draft):Promise<void>`, `listDrafts(userId):Promise<OfflineDraft[]>`, `removeDraft(clientId,userId):Promise<void>`.
- `cacheAssets(userId,assets:unknown[]):Promise<void>`, `readCachedAssets(userId):Promise<unknown[]>`, `clearOfflineData(userId):Promise<void>`.
- `registerOfflineShell():void` registers service worker in production only.
- IndexedDB per-user scope. UI explicitly asks to save offline after genuine network failure; no fallback on HTTP errors. Manual sync sends same client_id and removes only on confirmed server receipt. Signout offers clearing device records, never silently discards pending work.

## UX
Distinct worker field notebook and engineer operations desk, usable mobile/tablet, warm neutral/petrol/amber industrial identity, evidence and typography over generic gradient dashboards. Real setup/login; first-run empty states guide asset/user setup. Native field controls with accessible labels, meaningful notifications, loading/error/stale states, searchable filterable queue, detailed incident timeline, actual exports. No fake sensor values, fake charts, placebo buttons, or invented AI confidence. Theme remains user-controlled and light default.

## Infrastructure
T1 owns SQLAlchemy persistence and migrations/init, requirements and tests; SQLite local convenience but DATABASE_URL PostgreSQL supported. T3 owns Dockerfiles, compose, CI, environment example, PWA public files and offline module. API command uvicorn backend.main:app. Frontend same-origin `/api` via Vite/nginx. Local data/uploads ignored in git. Setup instructions and final verification done by main session.
