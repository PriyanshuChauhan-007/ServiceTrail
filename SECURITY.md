# Security posture

## Implemented boundaries

- PBKDF2-HMAC-SHA256 passwords with 600,000 iterations and independent random salts;
  random sessions stored only as SHA-256 token digests, revocable at logout and expiring after 12 hours.
- HTTP-only SameSite=Strict API cookies. Secure cookies and exact HTTPS origin are
  mandatory in production; production requires PostgreSQL.
- Authenticated role enforcement, organization/site scoping and independent
  approval/verification. Client-supplied actor names or roles are rejected.
- Optimistic versions with serialized writes/row locks. No client success fallback
  after workflow rejection. Stable client IDs deduplicate uncertain offline creates.
- Multi-factor authentication (TOTP RFC 6238) supported with authenticator apps,
  one-use recovery codes, and administrator-issued one-time password recovery tokens.
- Mandatory first-login password rotation for newly provisioned user accounts.
- User activation and deactivation controls enforced server-side.
- Encrypted device vault using Web Crypto API (PBKDF2-SHA256 with 600,000 iterations,
  AES-256-GCM authenticated encryption) for account- and site-bound offline drafts.
- Evidence is access-controlled and size/type/content validated, with sandboxed
  download headers. JSON exports include provenance but never session/password data.
- Browser cross-origin writes are refused. Request bodies are bounded and login
  throttles persist across process restarts.
- Audit rows include source snapshots and reject UPDATE/DELETE through ORM and
  database triggers. This does not protect against a privileged database owner.

## Threats and important limitations

- A fresh deployment must be private until the intended administrator completes setup.
- Organization/site isolation exists, but there is not yet a complete self-service
  multi-organization/site administration or enterprise account lifecycle product.
- Enterprise SSO (SAML/OIDC), bulk directory sync (SCIM), and hardware security keys (FIDO2/WebAuthn)
  are not yet supported.
- Device IndexedDB stores encrypted draft ciphertext; keys exist in memory only during
  the unlocked session. Clear sensitive drafts on shared devices and protect disks/users at the OS level.
- The PWA caches only public application files. Offline login is not supported;
  approvals, execution mutations, and evidence uploads must be server-confirmed.
- Format validation is not antivirus scanning. Upload and aggregate evidence
  quotas exist; a complete retention and malware-scanning policy does not.
- Explicit `APP_ENV=demo` enables a public shared workspace with synthetic records.
  Visitors may open the prepared administrator without credentials and use a
  short-lived controller to switch prepared accounts. This is intentional public
  access to example data, not secure storage for real reports. Ordinary sign-in
  does not inherit switching authority; production has no public entry or switch endpoints.
- The controller has a separate HttpOnly cookie and reserved server-session scope.
  Ordinary API authentication refuses that scope. Switching rotates the active
  account cookie, records the initiating administrator, and retains the active
  account's normal workflow checks. Logout revokes both sessions.
- The shared Render service uses ephemeral SQLite storage and is not intended
  for retaining real information. Do not enter private data into the shared workspace.
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
