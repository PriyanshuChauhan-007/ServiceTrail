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

## Create synthetic demo data

Use fictional values such as:

- Organization: `Northstar Manufacturing Demo`
- Site: `Acceptance Plant`
- Asset: `PRESS-07`
- Worker: `Demo Worker`
- Engineer: `Demo Engineer`

Do not upload real incident reports, employee information, production data or
real equipment measurements.

## Recruiter walkthrough

Show this sequence in three to five minutes:

1. Sign in as the worker.
2. Create a field report for `PRESS-07`.
3. Sign in as the engineer in a second browser context.
4. Open the report and request clarification.
5. Return to the worker account and revise the source record.
6. Analyze the current report as the engineer.
7. Approve the work only after independent review.
8. Return to the worker account and complete the checklist.
9. Submit the work for verification.
10. Verify and close it as the engineer.
11. Open the activity trail and explain the versioned audit history.

The important story is not the number of screens. Explain that the server owns
the workflow, roles, report versions and approval rules; the browser is not
trusted to grant permissions.

## Resume link

Use the generated Render URL as the live demo link. Label it clearly:

```text
Live demo: https://your-service-name.onrender.com
```

Also include the GitHub repository and, ideally, a short screen recording. The
live service is a demonstration environment and may sleep or reset its data.

## Troubleshooting

Check the Render service logs if the health check fails. Common causes are:

- `PUBLIC_ORIGIN` does not exactly match the public HTTPS URL.
- `FIELD_ENCRYPTION_KEY` is missing or is not a valid Fernet key.
- The first build is still running.
- A browser is using an old cached service worker; reload once after deployment.

For local verification, run the same application with the commands in the root
README. The public demo path is provided so recruiters can view the project
without access to your laptop or a paid domain.
