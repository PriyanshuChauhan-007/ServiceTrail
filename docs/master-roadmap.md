# ServiceTrail master roadmap

## Product decision

ServiceTrail is a **field-service handoff and proof-of-work platform for small service companies**. It helps a company assign jobs, record technician visits, capture evidence, confirm completed work, and track follow-ups.

The customer may still contact the company by phone or WhatsApp. ServiceTrail solves the internal visibility problem after that contact: the office needs to know what happened in the field, what changed, what evidence exists, who confirmed the visit, and what remains to be done.

## Initial target

The first demonstration uses a small home-appliance repair company handling fans, air conditioners, refrigerators, and washing machines. The workflow is general enough to extend to HVAC, solar, network installation, water-purifier service, elevator maintenance, and equipment repair contractors, but the MVP will not build separate products for every industry.

## Core workflow

```text
Job assigned
→ Technician records observation
→ Photos/readings added
→ Work performed and parts recorded
→ Customer or supervisor confirms
→ Follow-up is created or job is closed
```

## MVP value

ServiceTrail reduces lost evidence, incomplete handoffs, disputed work, forgotten follow-ups, and repeat visits caused by missing service history. It does not diagnose equipment, verify technical correctness automatically, or replace technicians and supervisors.

## Roadmap order

1. Product contract, terminology, and demo scenario.
2. Customer, service location, equipment, service request, and service-job model.
3. Assignment and technician job queue.
4. Mobile-first visit record: observation, work performed, parts, evidence, and outcome.
5. Supervisor review, correction requests, and customer/site confirmation.
6. Follow-up queue, customer history, equipment history, and repeat-service signals.
7. Actionable dashboard, search, notifications, permissions, audit, concurrency, and evidence security.
8. Clean-account end-to-end testing, mobile usability, documentation, deployment, and final demo.

## Explicitly out of scope for the MVP

Marketplace matching, payments, invoicing, inventory, routing, GPS tracking, live tracking, AI diagnosis, sensor/IoT monitoring, automatic repair recommendations, ERP/CRM replacement, payroll, and complex enterprise approval chains.

## Definition of done

A clean workspace can create a customer and service job, assign a technician, record a visit, attach before/after evidence, record work and parts, submit a report, review or return it, capture confirmation, create follow-up work, close the job, and show the complete customer/equipment history and audit trail.
