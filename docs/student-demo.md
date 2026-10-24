# Shared workspace deployment

The root Dockerfile serves the frontend and FastAPI together. `render.yaml`
selects a free web service with an ephemeral SQLite database and explicit
`APP_ENV=demo`. No paid domain is required.

## Configuration

Connect the repository to a Render Blueprint using `render.yaml`. Set a valid
Fernet key as `FIELD_ENCRYPTION_KEY` in the service's environment, never in Git.
After the service URL is assigned, set:

```text
PUBLIC_ORIGIN=https://your-service-name.onrender.com
COOKIE_SECURE=true
APP_ENV=demo
```

Use the exact browser-facing origin with no path. `/api/v1/health` is the
readiness endpoint. Keep the key private and do not record it in screenshots.

## What initializes automatically

On a fresh database, only `APP_ENV=demo` provisions Northstar Works with four
accounts, three assets, observation methods, notifications and five incidents
across the handover stages. Each example has recorded history.

Existing organizations are never overwritten. If the service already contains
an ordinary workspace, shared entry remains unavailable there. To use the
prepared workspace, point this service at a separate empty database; do not
delete a database containing records you need to keep.

## Open and switch

The sign-in page offers **Open workspace** only if the backend confirms prepared
access is available. It opens an authenticated administrator session without
asking visitors to enter shared credentials.

**View as** then switches to prepared Worker, Engineer, Supervisor or Administrator
accounts in one browser. A separate short-lived HttpOnly controller allows the
return trip; it cannot authenticate ordinary API requests. Switching rotates the
active session and records an administrative audit entry. Logout revokes both
the active session and the controller.

Ordinary credential sign-in never inherits switching authority. Development,
test and production do not expose the public entry or perspective endpoints.
Changing a normal user's role is still an administrative action, not a View as operation.

## Shared data limits

The shared workspace allows real writes, not just a read-only preview. Visitors
can edit reports, create data and advance incidents. All changes are public to
other visitors in the appropriate account scope. Never enter real credentials,
employee details or equipment reports. These accounts do not represent independent
real people; switching is an exploration tool, not evidence of physical sign-off.

The free filesystem is ephemeral. Data may reset after a restart or redeploy,
and a cold service may take time to respond. Startup re-creates examples only on
an empty database. Persistent private use needs a separately configured database
and normal account setup, not this public workspace.

For the workflow and changing your own inputs, see [Using ServiceTrail](using-servicetrail.md).
