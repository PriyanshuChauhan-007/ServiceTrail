# Public student demo

This guide deploys OpsBridge as a free public demo for a BTech project,
interview or recruiter review. It is intentionally smaller than a commercial
deployment: the Render filesystem and SQLite database are ephemeral, the service
may sleep when idle, and synthetic data should be used.

## Deploy with Render

1. Create a free account at Render and connect the GitHub repository.
2. Select **New > Blueprint** and choose the repository.
3. Render reads [`render.yaml`](../render.yaml) and builds the root [`Dockerfile`](../Dockerfile).
4. Apply the Blueprint as the `opsbridge-demo` web service.
5. Open the service's generated `https://*.onrender.com` URL and copy it.
6. In the service's environment variables, set:

   ```text
   PUBLIC_ORIGIN=https://your-service-name.onrender.com
   COOKIE_SECURE=true
   APP_ENV=demo
   ```

7. Generate a private Fernet key and set it as `FIELD_ENCRYPTION_KEY`:

   ```sh
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

8. Redeploy and wait for the health check at `/api/v1/health` to pass.
9. Open the public URL and complete first-run setup.

Do not put the Fernet key or any account password in GitHub, screenshots, the
README or your resume.

## Live Demo URL & Synthetic Data

- **Live URL**: `https://opsbridge-demo.onrender.com`
- **GitHub Repository**: `https://github.com/PriyanshuChauhan-007/opsbridge`

The live demonstration environment is pre-configured with synthetic evaluation data:
- **Organization**: `Apex Precision Dynamics`
- **Site**: `Plant Alpha - Machining Cell`
- **Equipment**: CNC Milling Center (`CNC-04`), Hydraulic Stamping Press (`PRESS-07`), Sorting Conveyor (`CONV-02`)

### 1-Click Demo Accounts

| Role | Email | Password | Responsibilities |
| :--- | :--- | :--- | :--- |
| **Field Technician** | `worker@apex.local` | `WorkerPass1234!` | Logs equipment observations, photos, executes checklists |
| **Reliability Engineer** | `engineer@apex.local` | `EngineerPass1234!` | Performs safety gap analysis, approves released work methods |
| **Operations Supervisor** | `supervisor@apex.local` | `SupervisorPass1234!` | Monitors queue, conducts independent verification of restored assets |
| **Site Administrator** | `admin@apex.local` | `AdminPass1234!` | Manages asset register, users, and audit logs |

Click any **Demo Persona** pill on the login screen or sidebar to switch roles instantly.

## Recruiter walkthrough

Show this sequence in three to five minutes:

1. Sign in as `worker@apex.local` (or click Technician).
2. Create a field report for `PRESS-07`. Note incomplete safe state to show deterministic gap detection.
3. Switch to `engineer@apex.local` (or click Reliability Engineer).
4. Open the report and request clarification.
5. Return to the worker account and revise the source record. Notice that editing invalidates the previous review.
6. Return to the engineer account, analyze findings, and **Approve & release work**. Notice that the engineer cannot execute the work they approved (separation of duties).
7. Return to the worker account, open **Released work**, and complete the checklist with required step notes.
8. Submit the completion handoff. Status becomes **Awaiting verification**, not closed.
9. Switch to `supervisor@apex.local` (or independent engineer), inspect saved work, add a verification note, and **Verify & Close**.
10. Open the activity trail or click **Export CSV/JSON** to inspect the versioned audit history.

The important story is not the number of screens. Explain that the server owns
the workflow, roles, report versions and approval rules; the browser is not
trusted to grant permissions.

## Resume & portfolio links

```text
Live demo: https://opsbridge-demo.onrender.com
GitHub: https://github.com/PriyanshuChauhan-007/opsbridge
```

## Troubleshooting

Check the Render service logs if the health check fails. Common causes are:

- `PUBLIC_ORIGIN` does not exactly match the public HTTPS URL.
- `FIELD_ENCRYPTION_KEY` is missing or is not a valid Fernet key.
- The first build is still running.
- A browser is using an old cached service worker; reload once after deployment.

For local verification, run the same application with the commands in the root
README. The public demo path is provided so recruiters can view the project
without access to your laptop or a paid domain.
