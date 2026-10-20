# OpsBridge

Equipment incident tracking with a clear handover between workers and engineers.

[Open OpsBridge](https://opsbridge-demo.onrender.com) · [How to use it](docs/using-opsbridge.md) · [Architecture](docs/architecture-diagrams.md)

## Why I built it

I was interested in what happens between someone noticing an equipment problem
and a team deciding that the work is complete. A message or spreadsheet row can
record a fault, but it does not necessarily preserve the questions, changes,
approval, or the person who checked the result.

OpsBridge brings that handover into one record:

```text
Observation → Questions → Source revision → Work release → Execution notes → Verification
```

A worker describes a problem against a registered asset. An engineer asks for
missing information and reviews the current source. Work is released with a
checklist, then handed back for independent verification. The original statement
and later actions remain in the history.

## Use the shared workspace

Choose **Open workspace** on the sign-in page. Assets, accounts, work methods,
notifications, and incidents at different stages are already present.

Use **View as** in the top bar to move between Administrator, Worker, Engineer,
and Supervisor in the same browser. This changes the authenticated server
session, not just the appearance of the page. You can return to Administrator
without logging in again.

The records are examples, but the operations are real: edit a source, create a
report, change the equipment state, save notes, and check the resulting findings
and history. There is no fixed sequence or precomputed success screen.

This is a shared, public environment. Changes are visible to other visitors; do
not enter private information. The free host may sleep and its database can reset
on redeployment. Example records are re-created on a fresh database.

Ordinary accounts still use normal sign-in and permissions. The prepared
workspace is enabled only with explicit `APP_ENV=demo`; development, test, and
production do not get public entry or account switching. Administrators can
create additional accounts through **Site & team**.

## What it does

- Registers equipment and links reports to an asset and site.
- Preserves observations, attachments, questions, and source revisions.
- Flags missing or contradictory information using explicit rules.
- Requires an independent approval before execution, then verification before closure.
- Records checklist notes and who performed each action.
- Rejects stale writes rather than overwriting someone else's changes.
- Exports incident history as JSON or CSV.
- Includes in-app notifications, work methods, due dates, and aggregate views.
- Supports password accounts, MFA/recovery, session management, and site-scoped access.
- Offers an encrypted device vault for explicit drafts and manual synchronization.

## Engineering choices

**Rules rather than an LLM.** The checks are inspectable and repeatable. They
identify information gaps, not diagnoses or physical safety clearance.

**Version checks plus database transactions.** Each mutation carries a record
revision. The backend combines version validation with serialized SQLite writes
or PostgreSQL row locks; a stale write returns HTTP 409. Changes to the source
invalidate previous analysis and approval.

**Permissions on the server.** A report author cannot approve it. The reporter,
assignee, and execution actors cannot independently close their own work. The
approver may verify if they did not execute it; a third reviewer is not required.

**Append-only audit snapshots.** ORM checks and database triggers reject updates
and deletes of audit rows. This is not a signed ledger and does not protect
against an owner who can change database triggers.

**Explicit offline boundaries.** The PWA caches the public shell. An unlocked
AES-GCM vault can store drafts; synchronization reuses a stable client ID.
Approval, evidence upload, and verification remain server-confirmed and online.

## Run locally

Python 3.12+ and Node 22+ are used by the project. From the repository root:

```sh
python -m venv .venv
# Windows; use .venv/bin/python on macOS/Linux
.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
.venv/Scripts/python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173`. A normal development database starts empty; complete
organization setup, register an asset, and create team accounts. To use the
prepared workspace locally instead, set `APP_ENV=demo` and point `DATABASE_URL`
to a **separate empty database** before starting the backend. Existing records
are not replaced.

## Checks

```sh
# Repository root, with the virtual environment active
python -m pytest backend/tests -q
python -m compileall -q backend
# From frontend
npm test
npm run build
npm run test:e2e
```

The shared-workspace browser checks are enabled with
`E2E_SHARED_WORKSPACE=true npm run test:e2e -- perspective.spec.ts` in a POSIX
shell. `TEST_POSTGRES_URL` enables tests against an isolated PostgreSQL test
schema; do not point it at application data. See [verification](docs/verification.md)
for the checks actually run and their limitations.

## Stack and deployment

React, TypeScript and Vite; FastAPI, SQLAlchemy and Python; SQLite for local/shared
use, with PostgreSQL support and CI acceptance tests. The root Dockerfile serves
the frontend and API together; Compose offers a separate web/API/PostgreSQL setup.

[Render setup](docs/student-demo.md) · [Operations](docs/operations.md) · [Security](SECURITY.md)

## Limits

OpsBridge coordinates records and decisions. It does not control machinery,
validate physical isolation, or replace site procedures. Attachments are checked
for supported formats and size, not certified malware-free. Offline support is
for drafts, not offline authorization. No real sensors, maintenance connectors,
or safety/compliance certification are claimed.

This project is developed by Priyanshu Chauhan. The prepared records are
fictional examples, not evidence of use in a real factory.
