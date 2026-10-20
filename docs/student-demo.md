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

The live environment starts with first-run setup. It has no shared accounts,
default passwords or role switcher. Create synthetic evaluation data using the
additive helper below.

To avoid entering every record during an interview, run the repository helper
from a private terminal after first-run setup:

```powershell
python scripts/demo_setup.py --base-url https://your-service-name.onrender.com --admin-email your-admin@example.com --admin-password "your-private-password"
```

It creates one synthetic asset, worker, engineer and incident. It prints the
generated worker/engineer credentials once and never stores them in the repo.
The helper is additive; it does not delete existing records.

## Recruiter walkthrough

Show this sequence in three to five minutes:

1. Sign in as the worker account created by the administrator.
2. Create a field report for `PRESS-07`. Note incomplete safe state to show deterministic gap detection.
3. Sign in as the independent engineer in a separate browser profile.
4. Open the report and request clarification.
5. Return to the worker account and revise the source record. Notice that editing invalidates the previous review.
6. Return to the engineer account, analyze findings, and **Approve & release work**. Notice that the engineer cannot execute the work they approved (separation of duties).
7. Return to the worker account, open **Released work**, and complete the checklist with required step notes.
8. Submit the completion handoff. Status becomes **Awaiting verification**, not closed.
9. Sign in as an independent reviewer, inspect saved work, add a verification note, and **Verify & Close**.
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
