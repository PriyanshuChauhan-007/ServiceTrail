# OpsBridge

**From frontline words to operational action.**

OpsBridge is an offline-first hackathon prototype for the Bridge the Gap theme. It turns a frontline worker's natural English, Hindi, or Hinglish report into a structured incident, routes the recommendation through a human-approved control-room decision, and returns a localized execution checklist.

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

## Demo flow for judges

1. Open **New bridge request** and keep **Industrial operations** selected.
2. Load or enter: `Machine 04 ka motor overheat ho raha hai, production ruk gaya hai. Bay 3 mein 42 minutes se down.`
3. Show the extracted asset, location, bilingual symptoms, safety flags, downtime, impact score, and confidence.
4. Run risk analysis. Explain that the bridge engine suggests actions but does not authorize hazardous work.
5. Approve as the control-room lead, open the execution playbook, and complete the three maintenance-owned steps.
6. Finish on **Incident resolved**. Civic water-main and logistics cold-chain scenarios demonstrate that the same bridge contract works across adapters.

## Architecture

The React/Vite frontend calls a small FastAPI backend. `seed.py` provides deterministic industrial, civic, and logistics adapters; `services.py` performs rule-based parsing, analysis, approval, checklist generation, and in-memory status tracking. There is no database, external API, model key, or network dependency. If the API is unavailable, the frontend uses a scenario-aware local adapter.

## Why this is credible

Industrial Operations is the primary demonstration because it makes the safety boundary visible: a stopped machine and possible heat/oil exposure produce a high-priority recommendation and require accountable approval before execution. Civic and Logistics are intentionally lighter adapters, not claims of public-health or medical diagnosis.

## Tests

From the project root:

```bash
.venv\Scripts\python.exe -m compileall -q backend
.venv\Scripts\python.exe -m pytest -q backend/test_services.py
```

The tests cover bilingual extraction, safety-critical approval, rejected/needs-changes blocking, checklist generation, and shared civic/logistics workflow shape. State is process-local and resets when the backend restarts.
