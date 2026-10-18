# Backend implementation notes

The shared endpoint specification is `docs/product-contract.md`. Start with
`uvicorn backend.main:app` from the project root. There are no accounts, passwords,
assets, measurements or incident records inserted by startup. The first person
completing `/api/v1/setup` creates the organization, site and administrator.
Expose the initial deployment only to the intended administrator until setup is
complete. Additional users are explicitly provisioned by the administrator; names
have no authorization meaning.

## Configuration and persistence

- `APP_ENV=development|test|production` (`ENVIRONMENT` is a fallback).
- `DATABASE_URL` defaults to `sqlite:///./backend/data/opsbridge.db` locally.
  `postgresql://`, `postgres://` and `postgresql+psycopg://` are supported using
  psycopg 3. PostgreSQL is mandatory in production.
- Production requires an exact HTTPS `PUBLIC_ORIGIN`, for example
  `https://ops.example.com`, and `COOKIE_SECURE=true`. Missing/unsafe values stop
  application construction. The configured host must match the API request host;
  the reverse proxy must preserve it. The secret-free readiness route is exempt
  from host matching to support internal health probes. Set `PUBLIC_ORIGIN` for non-local shared
  deployments too. API errors and downloads carry restrictive security headers.
- Cookies are HTTP-only, SameSite=Strict, scoped to `/api/v1`, and expire after
  twelve hours. Session tokens are random; only SHA-256 digests are stored.
  Passwords use PBKDF2-HMAC-SHA256, 600,000 iterations and independent random salts.
  Password whitespace is significant. Login rotates the current device session;
  logout revokes it server-side and also clears stale/expired cookies idempotently.
- Login throttling persists account and peer buckets (10 attempts / 15 minutes).
  Peer buckets include successful attempts; account buckets reset on success.
  The API does not read `X-Forwarded-For` itself. Configure Uvicorn's trusted proxy
  addresses narrowly so peer identity cannot be spoofed. The initial implementation
  serializes login throttle updates with one PostgreSQL advisory lock.
- Database and session secrets are not returned by health or export. SQLite WAL
  files, local databases and the backend data directory are ignored by Git.

### Schema lifecycle

Startup runs the versioned initializer in `backend/database.py`. Migration **1**
creates the baseline only on an empty database, records `schema_versions=1`, and
installs append-only audit triggers. SQLite initialization/write transactions use
`BEGIN IMMEDIATE`; PostgreSQL initialization uses an advisory transaction lock,
and incident/setup writes use row locks. Concurrent versioned writes cannot both
succeed against the same incident version. PostgreSQL offline-create replay also
uses a per-user/client-key advisory lock and a durable uniqueness constraint.

Unknown versions and unversioned nonempty databases fail closed. Future schema
changes must add explicit numbered transactional migrations and their upgrade
tests, rather than editing the baseline or treating `create_all` as ALTER support.
Back up the database before upgrades. The old prototype was process-local; its
former records and JSON data are not silently imported. No Alembic dependency is
needed for this one-migration baseline.

## Workflow details

- API `version` is the concurrency revision and increments on every mutation.
  `analysis.report_version`, `approval.report_version` and audit `report_version`
  refer to the last source-report/evidence revision, not the current action count.
  Report/evidence edits clear analysis, approval and checklist; reanalysis and a
  new independent decision are required. Request-changes also invalidates review.
- Workers see their own or assigned incidents; reviewers see their site's queue.
  All assets, incidents, evidence, assignment candidates and exports are checked
  against **both** organization and site. User directory reads are organization
  scoped as specified; provisioning creates users in the administrator's site.
  User provisioning requires mandatory initial password rotation (`must_change_password`).
  Site administrators can activate/deactivate accounts and issue one-use recovery tokens.
  Users can enroll in TOTP Multi-Factor Authentication (RFC 6238) and generate backup
  recovery codes. There is no public cross-site administration or self-service account deletion.
- Only workers and administrators submit reports. Only the author edits the
  source report. An independent engineer/supervisor/admin reviews and approves;
  the author, assignee and any recorded executor cannot approve their own work.
  Execution is restricted to the author or assigned worker, per the shared
  contract. Even an administrator cannot execute somebody else's incident merely
  by holding a reviewer role. Assignment accepts site-local workers only.
- Required checklist completion needs nonblank evidence notes. Execution actors
  are retained, including when assignment changes. A reviewer independent of the
  author, current assignee and execution actors resolves with a decision note;
  the approver may verify if they did not execute. Verification does not bypass
  completed-checklist or approval gates. Request changes from verification sends
  work back through report review. Reopening clears the previous authorization;
  reviewers can request source changes before reanalysis.
- Missing personnel/safe-state information and narrative contradictions block
  approval. Missing measurements/attachments produce warnings rather than
  fabricated facts. Negated language is preserved and flagged for human review.
  Analysis contains explicitly unverified hypotheses, never a confidence score,
  verified diagnosis, site-compliance claim or permission to perform maintenance.
- Audit events include immutable snapshots of the actual report, review,
  checklist and evidence metadata. ORM hooks and database UPDATE/DELETE triggers
  protect append-only behavior. This is not a cryptographically signed or
  privileged-database-administrator-proof audit ledger.

## Evidence and API details

- PNG/JPEG/WebP images and passive PDFs are accepted up to 10 MiB **per file**.
  Actual bodies are bounded, even without Content-Length; nonupload request bodies
  are capped at 128 KiB. Images must decode/verify and stay under 25 million pixels.
  PDFs must parse, have 1–1000 pages, and pass bounded object traversal rejecting
  active/embedded content and forms. Encrypted PDFs, SVG and other formats are
  rejected. Validation is a format/content gate, not an antivirus guarantee.
- Evidence bytes and SHA-256 hashes are stored transactionally in the database,
  so database backups include attachments. Filenames are sanitized display names,
  never filesystem paths. Downloads require the incident's authenticated scope,
  use attachment disposition, `nosniff`, no-store and sandbox CSP. There is no
  public uploads mount. Larger deployments may need object storage and explicit
  retention/quota policies; they are outside this API baseline.
- Evidence multipart accepts the contract's `file` plus an **optional** `version`
  field for stale-upload detection. Without it, row locking and preapproval-state
  checks still apply; successful upload returns the new full incident revision.
- Creates return 201; idempotent create replay returns 200 with the existing full
  record. A reused per-user UUID with changed create content returns 409. The
  original fingerprint remains stable even if the report is later edited.
- Cancellation additionally requires a note and is limited to preapproval work.
  Assignment cannot remove an assignee (no null-unassign action in this baseline).
  `PATCH` reports require the complete report fields plus `version`, as specified.
  Stale-version errors return 409 with `detail.message` and
  `detail.current_version`; ordinary errors use a detail string.
- All legacy `/api/bridge/*` routes return 410. Prototype scenario/dashboard/sync
  reads are retired too. Readiness is `/api/v1/health`, not the old `/health`.
  No mutation accepts a caller-supplied identity or role.
- Mutation requests with a different Origin/Referer or cross-site Fetch Metadata
  are refused. Requests without browser origin metadata remain usable by API
  clients; they must supply an authenticated cookie. No permissive CORS is added.
  Interactive documentation is disabled; production also disables OpenAPI.

## Checks and verification

Install runtime/test requirements:

```sh
pytest backend/tests -q
cd frontend && npm test
```

The test suite comprises:
- **35 backend tests** verifying FastAPI endpoints, session cookies, PBKDF2 hashing,
  concurrency row locks, schema migrations, and optimistic revision checks.
- **30 frontend tests** verifying device vault encryption, offline draft isolation,
  PWA caching boundaries, and workspace permissions.
- **1 Playwright browser workflow** validating the end-to-end multi-role lifecycle.

For synthetic demonstration and portfolio evaluation, use `python scripts/demo_setup.py`
to instantiate a demo organization, registered assets, team accounts, and pre-staged incidents.

Tests use temporary databases and synthetic test-only identities, not startup
seeds. They exercise actual HTTP sessions and durable SQLAlchemy transactions,
including engine recreation and concurrent stale writes. PostgreSQL support uses
SQLAlchemy/psycopg dialects and explicit PostgreSQL locking/trigger SQL; a live
PostgreSQL integration run is required in deployment CI; no live PostgreSQL service
was configured or exercised during this implementation. SQLite tests do not prove PostgreSQL runtime
behavior. No running application servers are restarted by the implementation.
