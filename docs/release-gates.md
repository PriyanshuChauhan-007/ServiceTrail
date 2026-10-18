# Release gates: implemented foundation vs launch readiness

This is an engineering checklist, not a claim that every item is finished.

## Delivered in the product rebuild

- [x] Persistent relational workflow and schema version baseline.
- [x] Password accounts and revocable HTTP-only sessions; no demo role picker.
- [x] Organization/site scope, server RBAC and independent approval/verification.
- [x] Asset register and supported-browser QR/barcode lookup.
- [x] Original observations, source revisions, safety statements and provenance.
- [x] Rule findings and unverified investigation hypotheses without fake confidence.
- [x] Protected validated image/PDF attachments, preview and download.
- [x] Clarification, version-checked release, execution notes, verification and reopening.
- [x] Persistent append-only audit snapshots and JSON export.
- [x] Explicit per-user device drafts, registered-asset cache and idempotent manual sync.
- [x] Optional encrypted AES-GCM device vault with in-memory keys, account/site binding,
      explicit legacy-draft migration, lock/clear controls and offline draft-only context.
- [x] Account security baseline: password rotation, TOTP MFA/recovery codes, session
      revocation, admin deactivation/recovery and site switching.
- [x] Server-paged queue, immutable work methods, scheduled deadlines, durable in-app
      notifications, metrics and scoped inbound observation tokens.
- [x] Real Chromium end-to-end worker → clarification → independent release → execution
      → verification test using a fresh synthetic SQLite database.
- [x] Public-shell-only PWA, Docker configuration and CI/test commands.

## Required before an external production pilot

- [ ] Build/run Docker stack and PostgreSQL acceptance in the target environment.
- [ ] Real browser, mobile/tablet, camera and installed-PWA acceptance, including two
      users on shared devices and disconnect/reconnect/lost-response cases.
- [x] Authentication recovery/change-password, MFA choice, user deactivation, session
      management, initial password rotation and one-time administrator recovery tokens.
- [ ] SSO/enterprise identity provider selection and production onboarding policy.
- [ ] Private bootstrap process behind an operator-controlled access boundary.
- [ ] Independent security review, tenant-isolation assessment and dependency review.
- [ ] Test data retention, encrypted backup/restore and disaster recovery drills.
- [ ] Log/error/metrics integration with redaction and incident-response ownership.
- [ ] Performance/load baseline, bounded pagination and query optimization for large
      incident/evidence/audit volumes. Current queues load site records directly.
- [ ] Storage quotas, AV service, retention rules and object storage if needed.
- [ ] Configurable approved work methods and safety policies reviewed by qualified
      domain personnel. Current checklist is a conservative generic record, not a SOP.
- [x] Multi-site administration for admins, site switching, site-scoped assignment and
      administrative audit records.

## Remaining full-product capabilities

- [x] Encrypted per-user device persistence, trusted device-context unlock, explicit
      legacy migration and same-account/site revalidation. Offline authentication is
      still not server sign-in; attachments, approvals and background mutations remain
      disabled.
- [ ] Enterprise managed device keys, resumable offline attachments, conflict-resolution
      UX, background sync and remote device revocation.
- [ ] Real SLA configuration, escalation/notifications and reliable job delivery.
      No false due-date numbers or automatic notifications should be demonstrated.
- [ ] CMMS/EAM and SCADA/sensor connectors with authorization, replay and reconciliation.
      Worker measurements are unverified text, not external telemetry.
- [ ] Evaluated multilingual transcription/translation/extraction, provider consent,
      model tracing, failure handling and quality evaluation on representative reports.
      No model is called today; no speech/AI service is secretly simulated.
- [ ] Report templates and per-field verification states with structured measurement
      units, per-field evidence linkage and human reconciliation of disagreements.
- [ ] Reporting/analytics based on actual usage, customer onboarding and a pilot study.
- [ ] Applicable privacy, retention and safety/legal review. No SOC 2, ISO 27001 or
      DPDP compliance certification is claimed by implementing these features.

## BTech evidence package

Use `product-contract.md`, `operations.md`, `backend/IMPLEMENTATION.md`, `SECURITY.md`
and the acceptance walkthrough as the starting point. Still prepare institution-
specific SRS, ER/use-case/sequence diagrams, measured performance, a usability study,
threat model, reproducible test evidence and limitations. Never include real reports,
passwords, tokens or raw private logs in the submitted academic report.
