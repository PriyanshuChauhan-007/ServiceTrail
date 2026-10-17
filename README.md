# OpsBridge

**From frontline words to operational action.**

OpsBridge is an offline-first hackathon prototype that turns a frontline report into a structured operational incident, routes it through a human-approved decision, and returns a clear action checklist.

## Run locally

### Backend

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend falls back to a local demo adapter when the FastAPI service is not running, so the primary flow can be demonstrated offline.

### Verification

```bash
.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q backend\tests
cd frontend
npm run build
```

See [`docs/judge-demo.md`](docs/judge-demo.md) for the three-minute demo flow and judge-defense notes.

## Product walkthrough

OpsBridge closes a controlled loop: frontline report → structured bridge request → explainable risk analysis → accountable approval → field checklist → resolved status. The catalog includes industrial CNC breakdowns, municipal water incidents, and cold-chain logistics interruptions so the adapter pattern is visible beyond one happy path. See [`docs/judge-demo.md`](docs/judge-demo.md) for the 3-minute walkthrough, architecture, defense points, limitations, and checks.

## Verification

```bash
python -m compileall backend
pytest -q backend/tests
cd frontend && npm run build
```
