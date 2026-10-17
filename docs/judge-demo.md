# OpsBridge judge demo

## Story
Frontline reports are fast, messy, and safety-critical. OpsBridge converts one natural-language report into structured meaning, an explainable recommendation, a human approval decision, and a field checklist. It runs with process-local state and a deterministic parser, so the demo works without a network or secrets.

## Three-minute demo
1. Start the API and frontend using the commands in the root README.
2. Open **Bridge workspace**, select the industrial CNC scenario, and submit the Hinglish sample. Show the extracted asset, symptoms, severity, and JSON disclosure.
3. Run analysis. Explain that the control room—not the parser—approves safety-impacting work.
4. Approve the response, open the execution playbook, and complete each required item. The final status becomes resolved.
5. Repeat quickly with **Municipal water main** and **Cold-chain dispatch** to show the same loop with civic and logistics-specific actions.

## Architecture and judge defense
FastAPI exposes validation, parsing, analysis, approval, checklist, status, and sync-mutation endpoints. `backend/services.py` owns deterministic domain behavior and an in-memory `BridgeStore`; `seed.py` is the adapter catalog. React is a thin operator console and falls back to local deterministic data when the API is unavailable. This keeps the primary path offline-first while preserving a clear seam for a future durable sync layer.

The strongest defense is traceability: every mutation has a version, timestamp, entity, and pending sync record; approval is explicit; invalid lifecycle transitions are rejected; and civic/logistics adapters reuse the same safety gates.

## Limitations
State is process-local and disappears on restart. Parsing is rules-based rather than a production language model, location extraction is intentionally conservative, and there is no authentication, multi-user conflict resolution, external notification, or real equipment integration.

## Checks
From `opsbridge`:

```bash
python -m compileall backend
pytest -q backend/tests
```

From `opsbridge/frontend`:

```bash
npm run build
```
