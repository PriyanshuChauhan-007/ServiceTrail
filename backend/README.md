# OpsBridge backend

Offline-first FastAPI prototype for translating a field report into a reviewable
incident bridge. It uses deterministic keyword/rule parsing, seeded industrial,
civic, and logistics scenarios, and process-local memory; no database or network
service is required.

## Run

```bash
python -m pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

The API exposes `/health`, `/api/scenarios`, and the parse/analyze/approve/checklist
workflow under `/api/bridge`.
