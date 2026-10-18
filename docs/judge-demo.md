# OpsBridge acceptance walkthrough

This replaces the retired hackathon single-operator demo. Use a private local
deployment and test-only observations, never a live factory fault or real private
evidence for assessment. Start with the root README setup instructions.

## Prepare

1. Complete organization/site/admin setup using credentials you choose yourself.
2. Create an asset, for example a press with a real site-local code and area.
3. Create separate worker and engineer accounts. Names are labels, not authorization.
4. Use separate browser profiles or sign out/sign in between roles. Cookies in tabs
   of the same browser profile identify the same account; tabs are not identities.

## Worker → clarification

1. Sign in as the worker and choose **New field report**.
2. Select the registered asset. Enter a brief incomplete observation and leave
   injury/equipment state unknown. Record uncertainty rather than inventing values.
3. Submit. The source/evidence view displays blocking safety information gaps.
4. Show that a worker has no approval or engineering-analysis controls.
5. Sign in as the engineer, open the incident from the operations register, analyze,
   and return with a question such as “Confirm safe state and injury statement.”
6. Sign back in as the author, open **Revise report**, answer with actual observations
   and impact, then save. A new source version invalidates earlier review.

## Evidence → release

1. As the author, upload a small safe image/PDF. Confirm successful server receipt.
   Evidence changes create a new source version and reset stale analysis.
2. As engineer, read the source, attachments and rule findings. Run current analysis.
   Explain that hypotheses are explicitly unverified, not an AI truth score.
3. Assign a worker if needed. Add an accountable decision note, confirm independent
   review, then **Approve & release work**. The engineer cannot approve their own
   report or execute the work they approved.

## Execute → independently verify

1. As reporter/assigned worker, open **Released work** and begin.
2. Add observations/evidence notes for each required step and save completion.
   Required steps without notes cannot be completed.
3. Submit the completion handoff. Status becomes **Awaiting verification**, not closed.
4. As an independent reviewer, inspect saved work and add a verification note.
   Verify and close. Reopen with a reason if recurrence is observed.
5. Export Audit JSON. Show the original source, report revisions, actors, decisions,
   evidence hashes and retained snapshots. Restart the API and show persistence.

## Offline and conflict boundaries

- Keep the signed-in tab open, disconnect the backend, and attempt a new report.
  Only a real transport failure offers explicit device-draft storage.
- Reconnect, open **Device drafts**, and sync manually. Reusing the client ID is
  idempotent if the original response was lost; HTTP conflicts never become success.
- Open a record in two clients, advance one, then attempt the stale action in the
  other. The server rejects it with 409 and requests a refresh.
- Fresh reload/offline identity, encrypted device records, attachments and approval
  sync are not implemented. The shell alone is not a fully disconnected authenticated app.

## Defensible project explanation

“OpsBridge is an accountable work coordination system, not a chatbot diagnosis.
It binds registered equipment, source observations, evidence, clarification,
independent approval, execution notes and independent verification into one
versioned, persistent record. Rules expose gaps; qualified people own decisions.”

Do not claim a rule can establish truth, that a selected safe state proves isolation,
that an attachment proves authenticity, or that the application is certified or
connected to sensors/CMMS/AI providers when no such integration is configured.
