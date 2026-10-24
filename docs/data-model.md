# ServiceTrail data model

This is the target domain model for the field-service proof-of-work MVP. Existing incident tables and APIs remain compatibility-sensitive during the migration; new work should move toward these concepts in small, tested slices.

## Core entities

### Organization

The service company using ServiceTrail.

### Site or service location

The place where work happens. A customer may have one or more locations.

### Customer

The person or organization requesting service. The first version needs name, contact details, address, and notes—not a full CRM.

### Equipment

The appliance or equipment being serviced. Customer, type, manufacturer, model, and serial number are useful context; only customer and a human-readable description are required to start a job.

### Service request

The original customer need, preserved in the customer's own words. It must not be replaced by a technician's later interpretation.

### Service job

The assigned unit of work connecting the request, customer, location, equipment, supervisor, technician, schedule, status, and review state.

### Visit record

The technician's field record: arrival/departure, observation, work performed, parts/materials, outcome, notes, and follow-up recommendation.

### Evidence

Photos, documents, or readings attached to a request or visit. Before/after evidence is preferred where it makes sense, but the system must not fabricate evidence.

### Follow-up action

A separately owned task created when the visit is incomplete, parts are required, a second visit is needed, or the supervisor requests more work.

### Confirmation

A record that a customer or site contact acknowledged the visit/work record. Confirmation means acknowledgement, not automatic proof that the repair was technically perfect.

### Audit event

An append-only record of creation, assignment, visit activity, evidence, review, confirmation, follow-up, closure, and reopening.

## Target job lifecycle

```text
new → assigned → scheduled → in_progress → report_submitted
    → changes_requested → reviewed → confirmation_pending
    → follow_up_required → closed
```

`changes_requested`, `confirmation_pending`, and `follow_up_required` are conditional states. A simple job may move from `reviewed` directly to `closed` after confirmation. Cancelled jobs are terminal unless explicitly reopened with a reason.

## Migration rule

Do not rename the current incident tables, cookies, offline database, or API paths in one risky change. First introduce the new domain vocabulary at the UI/documentation boundary, add compatible service-job structures, migrate one workflow at a time, and keep existing security and audit tests passing.
