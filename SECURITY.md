# Security posture

## Implemented boundaries

- PBKDF2-HMAC-SHA256 passwords with independent salts; random sessions stored only
  as token digests, revocable at logout and expiring after 12 hours.
- HTTP-only SameSite=Strict API cookies. Secure cookies and exact HTTPS origin are
  mandatory in production; production requires PostgreSQL.
- Authenticated role enforcement, organization/site scoping and independent
  approval/verification. Client-supplied actor names or roles are rejected.
- Optimistic versions with serialized writes/row locks. No client success fallback
  after workflow rejection. Stable client IDs deduplicate uncertain offline creates.
- Evidence is access-controlled and size/type/content validated, with sandboxed
  download headers. JSON exports include provenance but never session/password data.
- Browser cross-origin writes are refused. Request bodies are bounded and login
  throttles persist across process restarts.
- Audit rows include source snapshots and reject UPDATE/DELETE through ORM and
  database triggers. This does not protect against a privileged database owner.

## Threats and important limitations

- A fresh deployment must be private until the intended administrator completes setup.
- Organization/site isolation exists, but there is not yet a complete self-service
  multi-organization/site administration or account lifecycle product.
- No SSO, MFA, password recovery, required first-login password rotation or user
  deactivation interface yet. Assess these before onboarding customer users.
- Device IndexedDB is not encrypted; account scoping is an application convention,
  not protection against someone with browser/device access. Clear sensitive drafts
  on shared devices and protect disks/users at the OS level.
- The PWA caches only public application files. Offline login is not supported;
  approvals and execution mutations must be server-confirmed.
- Format validation is not antivirus scanning. No storage quota or retention
  enforcement exists. Bound the deployment until those controls are added.
- No externally assessed compliance or safety certification is claimed. Rule
  findings cannot prove worker truthfulness, safe isolation or a correct diagnosis.
- Not yet penetration-tested, load-tested, disaster-recovery-tested or independently
  accessibility-audited. Docker/PostgreSQL/PWA checks must run in deployment CI and
  on real devices. See `docs/release-gates.md`.

## Reporting a concern

Privately contact the repository owner through your established organization
channel. Do not attach customer reports, secrets, credentials or exploit payloads
containing real private data to a public issue. Supply redacted reproduction steps,
affected version, expected access boundary and observed result.
