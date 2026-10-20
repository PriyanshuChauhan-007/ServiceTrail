# Using OpsBridge

## Start without setup

Open the site and choose **Open workspace**. The shared Northstar Works workspace
has equipment, accounts and records already in place. You do not need to run a
script or enter account details.

The **View as** control changes the active account in the same browser. Choose a
role and select **Apply**. The name and available actions change because the
backend issues a session for that account. Switching does not edit the user's
role or bypass incident checks.

The prepared session can move back to Administrator at any time while its
30-minute switching access remains valid. If it expires, sign out and choose
Open workspace again. Unsaved form input should be saved before switching.

This environment is public and shared. All prepared records are fictional, and
changes made by other visitors may be visible. Never enter private information.

## What each account sees

| View | Starting point | Useful actions |
| --- | --- | --- |
| Administrator | Work register | Register equipment, create accounts/sites, inspect all site records |
| Worker | My notebook | Report a problem, revise their source, complete their released checklist |
| Engineer | Work register | Analyze sources, request clarification, approve, verify others' work |
| Supervisor | Work register | Review the queue, register assets, and make review decisions |

## Explore the prepared records

- **PRESS-07, unanswered stopping sequence:** incomplete source information. Use
  Worker to revise it and Engineer to analyze how the findings change.
- **PUMP-12, increased vibration:** a source ready for review. As Engineer,
  select the pump observation method, add a note, confirm review, and release it.
- **LINE-03, guard switch alarm:** released work. As Worker, open Released work,
  begin, save notes for each required step, and submit for verification.
- **PUMP-12, repeat alarm:** completed checklist awaiting verification. As
  Engineer or Supervisor, inspect the notes and verify with a reason.
- **PRESS-07, second alarm:** an administrator-authored source returned with a
  question. It shows that an administrator cannot approve their own report.

These are starting records, not separate mock screens. You can change them or
create new records. If another visitor has advanced a record, its current status
and next responsibility show what can happen next.

## Follow one record from beginning to end

1. Choose **Worker** in View as. Open the incomplete PRESS-07 report in My notebook.
2. Read Source & evidence. Note the unknown injury/equipment state and missing impact.
3. Choose **Engineer**, open the same report, then Analysis & decision. Analyze it.
   Read the blocking findings; add a question and select Return for clarification / changes.
4. Choose **Worker**, open the report and Revise report. Enter fictional answers,
   such as no injury reported, equipment isolated, and an impact description.
   Save the new source version. These are example statements, not real safety verification.
5. Choose **Engineer**, reopen the report and analyze the current source. Check the
   remaining findings. Select a relevant observation work method, add a decision
   note, confirm independent review, and select Approve & release work.
6. Choose **Worker**, open Released work, and begin. For each step, enter a
   completion note, tick completion, and save the step. Add a handoff note and
   submit for engineer verification.
7. Choose **Engineer** or **Supervisor**. Review the saved execution and write a
   verification note. Select Verify & close incident.
8. Open Activity trail. Export JSON for source snapshots and provenance or CSV
   for a table of the recorded actions.

The reviewer is independent of the reporter and executor. The approving engineer
can also verify if they did not execute; a third reviewer is optional.

## Prove that it responds to your input

- Leave injury status unknown and analyze: approval is blocked by a missing fact.
- Revise that field and reanalyze: the finding responds to the saved input.
- Try marking a required step complete without notes: the app refuses it.
- Revise a source: previous analysis/approval cannot be reused as current.
- Open a record in two tabs, advance one, then submit the old version in the
  other: the server rejects the stale write and asks for a refresh.
- Choose Administrator and register an asset with a different code. Create a
  report for it as Worker; it follows the same workflow as the prepared records.

## Use ordinary accounts

Administrators can create accounts in **Site & team**. Ordinary sign-in uses
those credentials, requires the initial password change, and does not grant the
prepared session's switching control. A separate normal deployment starts with
first-run organization setup and no example records.

## Other features

Asset register stores equipment identifiers and locations. Supported browsers can
scan an exact registered QR/barcode; manual search always remains available.
Attach a small PNG, JPEG, WebP or PDF to a preapproval report as its author.
Uploading evidence changes the source version and requires review again.

Work methods are authored checklist records, not certified SOPs. Notifications
are in-app handoffs; mark-as-read does not complete an incident. Dashboard counts
and timings come from saved records; they are not measurements of physical repair time.

Account security manages password changes, MFA, recovery codes and sessions. An
explicitly unlocked device vault can hold drafts and cached assets. After a real
connection failure, save the attempted report as a draft and sync manually when
the connection returns. Uploads, approvals and verification remain online-only.

## If a control is disabled

Read the error, findings and next responsibility first. Common causes are a
missing required field, stale source analysis, missing method/review note, the
wrong account, or an old record version. Refresh the source rather than retrying
blindly. Do not treat a rule finding as diagnosis or permission to work on equipment.
