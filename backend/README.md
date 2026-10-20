# OpsBridge backend

FastAPI and SQLAlchemy backend for the authenticated OpsBridge manufacturing
incident workflow. The API owns identity, role permissions, organization/site
scope, incident versions, evidence, approvals, checklists, notifications and
audit snapshots. The browser is not trusted to grant a role or bypass a workflow
gate.

## Run locally

From the repository root:

```bash
python -m pip install -r backend/requirements-dev.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The authenticated API lives under `/api/v1`. Readiness is available at
`/api/v1/health`. The old `/api/bridge/*` prototype routes are retired with
HTTP 410; they do not provide an unauthenticated bypass.

## Design points worth discussing

- **Server-side RBAC:** the authenticated session, not a browser-selected role,
  determines what the user may do.
- **Version checks:** report edits and workflow actions require the current
  revision, so stale clients receive a conflict instead of silently overwriting
  newer work.
- **Separation of duties:** authors cannot approve their own reports, and
  execution is handed to an independent reviewer for verification.
- **Deterministic assistance:** rule findings expose missing or contradictory
  information; they are not a diagnosis or a safety certification.
- **Durable provenance:** audit snapshots preserve source versions, actors,
  decisions, checklist notes and evidence metadata.

## Persistence

SQLite is convenient for local development and the student demo. PostgreSQL is
supported for the Compose/CI deployment path. Database initialization is versioned
and unknown non-empty schemas fail closed rather than being silently rewritten.

See `docs/product-contract.md` for the endpoint/workflow contract and
`backend/IMPLEMENTATION.md` for implementation details.
