# OpsBridge recruiter demo

## The one-sentence explanation

OpsBridge is a manufacturing incident workflow that prevents unsafe handoffs by
separating the person who reports a problem, the engineer who releases work, the
worker who executes it and the reviewer who verifies completion.

## Before the interview

1. Open https://opsbridge-demo.onrender.com once so the free service wakes up.
2. Complete first-run setup with fictional organization/site details.
3. Register one asset, such as `PRESS-07`.
4. Create a worker and an engineer account from **Site & team**.
5. Run the workflow once before the interview so the service contains a small
   synthetic record.
6. Keep the worker and engineer credentials in a private password manager or note;
   never commit them to GitHub or show them in screenshots.

For repeated setup, the repository includes `scripts/demo_setup.py`. It creates
synthetic records through the API using credentials supplied at runtime; it does
not contain default passwords and does not delete existing records.

Example from PowerShell:

```powershell
python scripts/demo_setup.py `
  --base-url https://opsbridge-demo.onrender.com `
  --admin-email your-private-admin-email@example.com `
  --admin-password "your-private-admin-password"
```

The script prints newly generated worker and engineer credentials once. Store
them privately and rotate/delete them after the presentation.

## Three-minute live walkthrough

### 1. Start with the problem

Say:

> A technician can report an equipment problem, but the same person should not
> be able to approve and verify their own repair. OpsBridge makes those handoffs
> explicit and records why each decision was made.

### 2. Worker report

Sign in as the worker and select **New field report**.

Choose `PRESS-07` and enter:

```text
Observation: Protective alarm stopped the press during an acceptance test.
Impact: Demo line stopped; duration is not yet established.
Measurements: Panel alarm X7 was displayed; worker-entered observation.
```

Submit the report. Point out that the report is attached to a registered asset and
the source is explicitly a worker observation, not a sensor-certified fact.

### 3. Engineer clarification

Sign in as the engineer in another browser profile. Open **Work register**, open
the incident and select **Analysis & decision**.

Click **Analyze current report**. Explain that the deterministic rules identify
missing or contradictory information; they do not diagnose the machine.

Enter a clarification note and choose **Return for clarification / changes**.

### 4. Revision invalidates old review

Return to the worker account, refresh the incident, choose **Revise report**, add
the missing safety information and save the new version.

Explain:

> A source revision invalidates the old analysis and approval. The engineer must
> review the current version instead of approving stale information.

### 5. Independent release

Return to the engineer account, analyze the current version, add a decision note,
confirm independent review and choose **Approve & release work**.

Point out that the server, not merely the UI, prevents the author from approving
their own report.

### 6. Controlled execution and verification

As the worker, open **Released work**, begin the work, complete each checklist
step with notes and submit for verification.

As the engineer, review the execution notes and choose **Verify & close incident**.

The incident is not closed when the worker finishes; it is closed only after a
separate verification decision.

### 7. Finish with the audit trail

Open **Activity trail** and download **Audit JSON**. Show that the record contains
the actors, report versions, decision notes, checklist work and verification.

## Questions recruiters may ask

**Why not use an LLM for the safety decision?**

Because the rule findings need to be deterministic and explainable. Human
engineers remain responsible for decisions.

**How do you prevent stale updates?**

Every mutation includes the current record version. A stale write receives HTTP
409 and the client must refresh.

**How is authorization enforced?**

The backend reads the authenticated HTTP-only session and checks role, site,
ownership and workflow state. Frontend controls are not the security boundary.

**What happens if the network fails?**

An explicitly failed report submission can be saved as a device draft with a
stable client ID. Approvals, evidence uploads and verification remain online-only.

**What would you build next?**

Real PostgreSQL-backed deployment, object storage for evidence, stronger monitoring,
enterprise identity, evaluated integrations and a usability study. Those are
future product work, not hidden claims in this academic project.

## What not to claim

Do not say the project is a certified safety system, automatic diagnosis engine,
real sensor integration, or compliance product. Say it is a full-stack academic
prototype focused on accountable incident coordination and workflow integrity.
