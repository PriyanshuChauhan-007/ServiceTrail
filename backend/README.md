# OpsBridge backend

Offline-first FastAPI prototype for translating a field report into a reviewable
incident bridge. It uses deterministic keyword/rule parsing, seeded industrial,
civic, and logistics scenarios, and process-local memory; no database or network
service is required. Domain state is available to the interactive UI through
history and dashboard read models, while the deterministic parser remains the
offline fallback.

## Run

```bash
python -m pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

The API exposes `/health`, `/api/scenarios`, `/api/bridge/history`,
`/api/dashboard/summary`, and the parse/analyze/approve/checklist workflow under
`/api/bridge`. Checklist completion is persisted for the life of the process with
`PATCH /api/bridge/checklist/{bridge_id}` and `{item_id, completed, notes}`.
Workflow responses carry `version`, UTC `updated_at`, `is_deleted`, and
`sync_status` metadata. `GET /api/sync/mutations` returns the append-only
in-memory outbox (use `?pending_only=false` for the full log).

This is intentionally a lightweight prototype data layer: restarting the backend
resets session state. The frontend can continue using its deterministic local
adapter when the API is unavailable.
