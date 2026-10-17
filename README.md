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
