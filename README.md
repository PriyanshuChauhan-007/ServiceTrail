# OpsBridge

**Observe carefully. Decide independently. Leave a clear record.**

OpsBridge is a BTech final-year full-stack project for manufacturing incident
coordination. A worker records equipment observations and evidence; an independent
engineer clarifies, reviews and releases work; execution is handed back for
independent verification.

This is a student project demonstrating application architecture, authentication,
role-based workflow design, persistence, testing and deployment. It is **not a
certified safety system or a claim of commercial readiness**. Rule-based hypotheses
are not diagnoses.
Follow qualified personnel and site procedures; never treat an application state
as equipment isolation or a permission to bypass an emergency procedure.

## What is implemented

- Account setup, password sign-in, revocable HTTP-only cookie sessions and server-side roles.
- Durable SQLAlchemy storage: SQLite for local work, PostgreSQL configuration for deployment.
- Organization/site-scoped assets and incidents; workers see their own/assigned records.
- Separate field notebook and operations desk, search/filter queues, light/dark themes and mobile layouts.
- Registered asset code lookup and local-camera QR/barcode lookup on supporting browsers.
- Source report revisions, structured safety statements, impact and worker-entered measurements.
- Missing-field/contradiction findings; rule-assisted **unverified** hypotheses, not invented confidence scores.
- Protected PNG/JPEG/WebP/PDF attachments with validation, bounded size and authenticated downloads.
- Independent, version-checked engineering approval and request-changes with mandatory decision notes.
- Released checklists with required completion notes, verification handoff, independent closure and reopening.
- Append-only audit snapshots and JSON export including original statements and provenance.
- Explicit encrypted IndexedDB device vault, account/site-bound drafts and asset cache,
  atomic legacy migration and idempotent manual sync.
- Production-built offline application shell. API/private records/evidence are never service-worker cached.
- Docker/Compose configuration, CI checks and optional real PostgreSQL acceptance test.

## Local development

Requires Python **3.12+** and Node **22+**. From the repository root:

```sh
python -m venv .venv
# Windows
.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
# macOS/Linux: use .venv/bin/python instead
```

In another terminal, from `frontend`:

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to port 8000. Readiness is
**http://127.0.0.1:8000/api/v1/health**. The old `/api/bridge/*` prototype routes
return 410; they cannot bypass authentication or approval controls.

The existing Windows workspace also has `.venv312`; it is usable instead of `.venv`.
Do not install packages into a global Python environment.

## First organization and team

1. Keep a fresh deployment private until initial setup is complete.
2. Enter your organization, site, name, email and a password of at least 12 characters.
   The name defaults to **Priyanshu Chauhan**, but authorization comes from the account,
   never a name or browser-selected role. There are **no seeded passwords/accounts**.
3. In **Asset register**, create real equipment with its code, name and area.
4. In **Site setup**, create separate worker and engineer accounts. Deliver initial
   access details directly to those people, never in committed files or shared logs.
5. Sign out and sign in as the worker to submit a report. Sign in as the independent
   engineer to review it. An administrator cannot approve their own report either.

The first administrator is not a fake engineer login. Real roles determine which
workspace and actions each account can use. See [acceptance walkthrough](docs/judge-demo.md).

## Storage and deployment

Local data defaults to `backend/data/opsbridge.db` and survives API restarts.
Evidence bytes are in the same database, so consistent backups include attachments.
Local data and environment files are excluded from Git. Prototype process-memory
records are not silently imported into the new database.

For local Compose, copy `.env.example` to a private `.env`, set a strong PostgreSQL
password and matching URL, then run:

```sh
docker compose config
docker compose up --build -d
```

Local Compose serves http://localhost:8080. Only the web port is published. Public
deployments require HTTPS, `APP_ENV=production`, exact `PUBLIC_ORIGIN` and
`COOKIE_SECURE=true`; production refuses SQLite and unsafe cookie settings.

Read [operations and deployment](docs/operations.md), [security](SECURITY.md) and
[backend notes](backend/IMPLEMENTATION.md) before exposing the service.

## Free public student demo

The repository includes a small single-container deployment for a public academic
demo. It is designed for a free Render web service and uses ephemeral SQLite data,
so it is suitable for recruiters, interviews and presentations—not production use.
The service may sleep when idle and its data can reset after a redeploy.

1. Create a free Render account and connect this GitHub repository.
2. Choose **New > Blueprint** and select `render.yaml`.
3. Let Render create the `opsbridge-demo` web service from the root `Dockerfile`.
4. After Render gives the service its URL, set `PUBLIC_ORIGIN` to that exact
   `https://...onrender.com` URL.
5. Generate a Fernet key and set `FIELD_ENCRYPTION_KEY` in Render's environment
   variables. Keep both values private.
6. Redeploy, open the public URL, and complete the first-run setup with synthetic
   demo data.

No paid domain is required. Use the resulting Render URL as the live demo link on
a resume, and clearly label it as a student-project demo. See
[`render.yaml`](render.yaml) and [student demo guide](docs/student-demo.md).

## Offline behavior, precisely

While signed in, a genuinely failed report submission offers **Save attempted
report as device draft**. This is never offered as success after a 401/403/409/422
or other HTTP rejection. Manual sync reuses a stable client ID and deletes the
device draft only after a server receipt. Device records can be cleared at sign-out.

The built PWA caches only its public shell. After a reload, identity still requires
the server; **offline sign-in is not implemented**. Keep the signed-in tab open for
disconnected draft capture. Attachments, approvals, checklist writes and verification
are online-only. IndexedDB is account-scoped in the UI but **not encrypted** and is
not a security boundary on a shared/untrusted device. No automatic background
submission or encrypted device credential vault is claimed.

## Verification

From the root:

```sh
.venv312/Scripts/python.exe -m pytest backend/tests -q
.venv312/Scripts/python.exe -m compileall -q backend
.venv312/Scripts/python.exe -m pip check
git diff --check
```

From `frontend`:

```sh
npm test
npm run build
```

`TEST_POSTGRES_URL` enables the isolated-schema PostgreSQL test; otherwise that test
is explicitly skipped. CI provisions a disposable PostgreSQL service. UI server
rendering/logic tests and fake IndexedDB tests are not a substitute for browser,
mobile-camera, installed-PWA or production deployment acceptance.

## Future enhancements beyond the BTech scope

The following are optional future product work, not requirements for this student
project:

See [scope and future work](docs/release-gates.md) for details on:
SSO/enterprise identity, managed encrypted offline access, object storage/AV/quotas,
configurable work methods, external CMMS/SCADA/notification
integrations, optional evaluated AI/transcription, load testing and independent
security/compliance assessment. These features are **not simulated or claimed** here.
