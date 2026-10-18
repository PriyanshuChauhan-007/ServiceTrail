# Product rebuild verification

## Checks actually run in the development workspace

| Command / check | Result |
| --- | --- |
| `.venv312/Scripts/python.exe -m pytest -q backend/tests` | 31 passed, 3 explicitly skipped |
| `.venv312/Scripts/python.exe -m compileall -q backend` | Passed |
| `.venv312/Scripts/python.exe -m pip check` | No broken requirements |
| `npm test` from `frontend` | 30 passed |
| `npm run build` from `frontend` | TypeScript and Vite build passed |
| `npm audit --omit=dev` from `frontend` | 0 reported vulnerabilities at check time; not a security certification |
| `npm run test:e2e` from `frontend` with Playwright Chromium | 1 real-browser workflow passed against a fresh synthetic SQLite database |
| `git diff --check` | Passed; Git reports LF/CRLF conversion notices on Windows |
| HTTP GET `http://127.0.0.1:5173/` | 200 |
| HTTP GET through web proxy `/api/v1/health` | `status: ok`, API version 1.0.0 |
| HTTP GET through web proxy `/api/v1/setup/status` | `needs_setup: true`; no accounts/passwords seeded |
| `docker --version` | Not available in this environment |
| GitHub Actions `Verify` run `39167158305` for commit `06516a3` | Passed: backend, PostgreSQL acceptance, frontend build/tests, and real-browser workflow |

## Behavior covered

Backend tests use isolated databases and real API/session/transaction behavior:
setup locking, password/session lifecycle, rate limiting, role and tenant/site
boundaries, independent approval, missing information, source revisions, stale
analysis and concurrent writes, evidence validation/access, checklist notes,
independent verification, reopening, idempotency, restart persistence, immutable
audit snapshots, export redaction, cross-origin controls and retired API bypasses.

Frontend tests exercise actual API wrappers/logic, server-rendered components,
account-scoped IndexedDB behavior using fake-indexeddb, QR-code matching, and the
service-worker shell in a VM. They prove HTTP errors are not converted into offline
success, evidence includes the write revision, local records are scoped and stable,
and API/evidence/mutations are not intercepted by the shell cache.

## Not passed / not yet exercised

- The PostgreSQL acceptance test is skipped locally because TEST_POSTGRES_URL is
  unset. The disposable PostgreSQL service/job passed in GitHub Actions run
  `39167158305`.
- Docker Compose validation, image build and nginx runtime checks were not possible
  because Docker is unavailable. TLS reverse-proxy operation remains a deployment check.
- Real Chromium authenticated workflow is now covered by `npm run test:e2e` using a
  fresh synthetic database; real camera, installed PWA and mobile/tablet acceptance
  still need target-device testing. No private account was created for testing.
- No load/penetration/accessibility audit, backup-restore drill or commercial
  compliance assessment was performed.
- External identity, AI, CMMS, sensor and notification integrations are not active.

The application was started with the new authenticated API. The old process-local
prototype is retired; no silent migration of its former in-memory records is claimed.
Use `judge-demo.md` for human acceptance and `release-gates.md` for remaining work.
