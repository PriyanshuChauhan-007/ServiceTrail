# Operations and deployment

## Services

The application is a modular React/Vite frontend with a FastAPI/SQLAlchemy backend.
Use a modular monolith for this stage, not independent microservices. The web
container serves compiled static assets and reverse-proxies `/api` to the API.
The API owns authenticated workflow transitions and a PostgreSQL transaction is
the authority for versions, approvals, evidence and audit snapshots.

```text
Field notebook / operations desk
        | same-origin HTTP-only session
        v
Web reverse proxy -> FastAPI workflow API -> PostgreSQL
        |                   |
Public PWA shell      protected attachments + audit snapshots

Device IndexedDB: explicit drafts + registered asset cache, not a replica of approvals
```

## Local Compose

1. Install Docker Engine/Desktop with Compose support.
2. Copy `.env.example` to `.env` locally; it is gitignored.
3. Generate a unique strong database password. Fill `POSTGRES_PASSWORD` and the
   matching `postgresql+psycopg://user:URL-encoded-password@db:5432/database` URL.
4. Validate `docker compose config` locally; its expanded output contains secrets,
   so do not publish it, capture it in a report or commit it.
5. Run `docker compose up --build -d` and check `docker compose ps`.
6. Open http://localhost:8080 and privately complete first-run setup.

Do not share an uninitialized public deployment: the first successful setup
request creates its administrator. Compose intentionally ships no default user,
no usable password and no public PostgreSQL/API port.

## Production environment

- Set `APP_ENV=production`, exact HTTPS `PUBLIC_ORIGIN` and `COOKIE_SECURE=true`.
- Put TLS in front of the web container; preserve browser Host and Origin.
- Keep `.env` and database credentials private and readable only by the operator.
- Limit database access to the API and backup operators.
- Configure Uvicorn trusted proxy addresses deliberately; do not globally trust
  client-supplied forwarding headers. Identity is never accepted in an HTTP header.
- Review the reverse-proxy CSP, browser/PDF preview compatibility and upload limit
  against the actual release build. There are no external font/CDN dependencies.
- Pin deployment image digests and dependency versions under your update policy.
- Run all release gates in `release-gates.md` before a real customer deployment.

## Schema lifecycle

Migration 1 creates the baseline on an empty database and records its schema
version. Unversioned nonempty and unknown-version databases fail closed. This is
not permission to modify an already-deployed baseline: new schema changes need
numbered migrations and upgrade/rollback tests. Back up before any migration.

## Backups and recovery

Evidence bytes are transactional database records; there is no public uploads
folder to back up separately. For production use scheduled, encrypted PostgreSQL
backups with explicit retention, access policy and tested restore procedures.
Do not store SQL dumps, private payloads or credentials in this repository.

Illustrative operator commands (run in a private terminal and use protected paths):

```sh
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /protected/backup.dump
# Restore to a separate, isolated recovery database first; validate before cutover.
```

Persistent volumes do not by themselves provide backups, encryption, replication
or disaster recovery. Deleting `postgres_data` destroys the application's data.
Do not use `docker compose down -v` as an ordinary restart command.

## Operational checks

- API readiness: `GET /api/v1/health`; web liveness: `GET /healthz` in nginx.
- Monitor failed sign-ins, 403s, stale writes, 5xx responses, storage size, database
  connections and backup age. Do not log raw cookies, passwords or attachment bytes.
- Login throttling is durable. Shared proxy peer addresses can throttle multiple
  users together; validate the proxy setup and policy for your deployment.
- Evidence validation limits format/size/active PDF content but is not malware scanning.
- No outbound notification worker, SLA scheduler or external CMMS/sensor connector
  is configured. Do not present those as active integrations.

## Acceptance environments

SQLite tests prove local behavior, not PostgreSQL. CI has an ephemeral PostgreSQL
acceptance job. Configure `TEST_POSTGRES_URL` only against a dedicated test service;
the test creates and drops its own uniquely named schema. Never point test runners
at a customer production database. Verify built Docker images and installed PWA
on actual target devices separately.
