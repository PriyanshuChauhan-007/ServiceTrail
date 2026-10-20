# OpsBridge

**Accountable Industrial Incident Coordination and Dual-Control Release Platform**

[![Live Demo](https://img.shields.io/badge/Demo-Live%20on%20Render-46E3B7?style=flat-square&logo=render&logoColor=black)](https://opsbridge-demo.onrender.com)
[![CI](https://github.com/PriyanshuChauhan-007/opsbridge/actions/workflows/ci.yml/badge.svg)](https://github.com/PriyanshuChauhan-007/opsbridge/actions/workflows/ci.yml)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Security: AES-256-GCM](https://img.shields.io/badge/Vault-AES--256--GCM-228B22?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

> *"Observe carefully. Decide independently. Leave a clear record."*

---

### Evaluation Environment
- **Hosted Application**: [https://opsbridge-demo.onrender.com](https://opsbridge-demo.onrender.com)
- **Role Switching**: On the login screen, select any demo persona (`Technician`, `Engineer`, `Supervisor`, `Admin`) to tour the platform with pre-authenticated sessions.

---

## Motivation and Problem Statement

In production manufacturing (stamping lines, CNC milling cells, chemical processing units, and automated material handling), machine stoppages cost thousands of dollars per minute. Under pressure to restore equipment throughput, plant maintenance operations often default to informal channels:

- **Messaging apps** where vibration readings, multimeter values, and photos of fractured components get buried without timestamp integrity or cryptographic verification.
- **Verbal shift handoffs** that leave zero record of who authorized an altered machine state.
- **Paper clipboards and spreadsheets** vulnerable to post-incident alteration, missing signatures, and lost records.

### Failure Modes in Informal Plant Coordination
1. **Self-Approval Hazard**: A technician performing an emergency fix often certifies their own work. Without independent peer review, dangerous shortcuts go unnoticed.
2. **Missing Evidence and Broken Provenance**: Photos of damaged assets remain on personal mobile devices with no permanent binding to the work order.
3. **Silent State Drift**: If equipment symptoms worsen or new damage is uncovered after an initial sign-off, work continues under obsolete assumptions.
4. **Regulatory Non-Compliance**: OSHA 1910 (Lockout/Tagout) and ISO 9001/45001 standards require documented dual control ("four-eyes principle"). An engineer cannot approve their own report or execute work they approved; an independent party must confirm safe isolation.

OpsBridge enforces a server-verified human decision loop backed by deterministic safety validation and an append-only audit trail.

---

## System Architecture

OpsBridge connects shopfloor personnel and reliability engineers through a layered, role-enforced architecture designed for human accountability and audit provenance.

```mermaid
graph TB
    subgraph ClientLayer["Frontend Client Layer (React 19 / TypeScript / Vite PWA)"]
        UI["React 19 Single-Page Interface"]
        Router["Workspace Router (Role-Specific Desks)"]
        Scanner["Camera Barcode / QR Scanner (Native BarcodeDetector)"]
        Vault["Encrypted Device Vault (IndexedDB + Web Crypto AES-256-GCM)"]
        SW["Service Worker (Static Shell Cache)"]
    end

    subgraph SecurityBoundary["HTTP & Security Boundary"]
        Cookie["HTTP-Only, SameSite=Strict Session Cookies"]
        Headers["Strict CSP, HSTS, X-Content-Type-Options: nosniff"]
        OriginCheck["Exact Origin & Referer Verification"]
        BodyLimit["Request Body Size Guards (128 KB JSON / 10 MB Evidence)"]
    end

    subgraph ApplicationLayer["Backend Application Layer (FastAPI / Python 3.12)"]
        AuthService["Authentication & Session Manager (PBKDF2-HMAC-SHA256)"]
        MFAEngine["TOTP Engine (RFC 6238) & One-Use Recovery Tokens"]
        RBAC["Server-Side Role & Organization Scope Guard"]
        RulesEngine["Deterministic Safety Gap Assessment Engine"]
        WorkflowEngine["Incident State Machine & Concurrency Controller"]
        EvidenceValidator["Evidence Gate (PNG/JPEG/WebP/PDF Passive Parser)"]
    end

    subgraph PersistenceLayer["Durable Persistence Layer"]
        ORM["SQLAlchemy 2.0 ORM (Unit of Work, Optimistic Concurrency)"]
        DB[(Relational Database: SQLite / PostgreSQL 16)]
        AuditTriggers["Append-Only DB Triggers (Reject UPDATE/DELETE)"]
    end

    UI --> Router
    Router --> Vault
    Router --> Scanner
    UI -.-> SW
    UI -->|HTTPS REST API| Cookie
    Cookie --> SecurityBoundary
    SecurityBoundary --> OriginCheck
    OriginCheck --> BodyLimit
    BodyLimit --> AuthService
    AuthService --> MFAEngine
    AuthService --> RBAC
    RBAC --> WorkflowEngine
    WorkflowEngine --> RulesEngine
    WorkflowEngine --> EvidenceValidator
    WorkflowEngine --> ORM
    EvidenceValidator --> ORM
    ORM --> DB
    DB --- AuditTriggers
```

---

## Incident State Machine and Concurrency Model

Every incident follows an 11-state finite state machine enforcing separation of duties, optimistic version locking, and automatic invalidation of stale engineering reviews.

```mermaid
stateDiagram-v2
    [*] --> submitted: Worker submits field report

    submitted --> needs_clarification: Rule assessment detects blocking gap (safe state / missing fields)
    submitted --> ready_for_review: Complete observation (no blocking findings)
    
    needs_clarification --> changes_requested: Engineer requests clarification
    ready_for_review --> changes_requested: Engineer requests changes / method update

    changes_requested --> submitted: Author edits source report (Increments report_version, clears prior review)

    ready_for_review --> approved: Independent Engineer approves (Attaches work method/generic checklist)
    
    approved --> in_progress: Assigned worker / author starts execution
    approved --> changes_requested: Engineer revokes/re-evaluates before start

    in_progress --> awaiting_verification: Worker marks all required checklist steps with evidence notes
    
    awaiting_verification --> resolved: Independent Engineer verifies execution & closes incident
    awaiting_verification --> changes_requested: Verification rejected (Work incomplete or needs remediation)

    resolved --> reopened: Reviewer reopens incident with accountable reason
    reopened --> submitted: Author revises source report for new maintenance cycle

    submitted --> cancelled: Author/Reviewer cancels preapproval report
    needs_clarification --> cancelled: Author/Reviewer cancels preapproval report
    ready_for_review --> cancelled: Author/Reviewer cancels preapproval report

    resolved --> [*]
    cancelled --> [*]
```

### Concurrency Guarantees
1. **Separation of Duties**: The author cannot approve their own report. The approver and executor cannot verify completion.
2. **Version Invalidation**: Any revision to the worker statement increments `report_version`, immediately invalidating previous rule analysis, engineering approval, and active checklists.
3. **Optimistic Locking**: Every mutation requires matching the server's current `version`. Stale concurrent writes are rejected with `HTTP 409 Conflict`.

---

## Separation of Duties and Verification Flow

This sequence illustrates the handoff boundaries between human roles, ensuring that automated rules assist rather than replace accountable engineering judgment:

```mermaid
sequenceDiagram
    autonumber
    actor W as Field Technician
    participant API as OpsBridge API
    participant Rule as Deterministic Rule Engine
    actor E as Independent Engineer
    participant DB as Durable Audit Log

    Note over W,DB: Phase 1: Observation & Gap Analysis
    W->>API: Submit Field Report (Asset, Description, Safe State, Impact)
    API->>Rule: Evaluate Completeness & State Contradictions
    Rule-->>API: Unverified Hypotheses + Safety Flags (Deterministic rules)
    API->>DB: Record Incident + Append Audit Snapshot (v1)

    Note over W,DB: Phase 2: Clarification & Independent Approval
    E->>API: Inspect Queue & Trigger Analysis Review
    API-->>E: Display Worker Statement + Rule Warnings + Evidence
    alt Blocking Safety Gap Found
        E->>API: Request Clarification with Decision Note
        API-->>W: Notify Worker of Required Clarification
        W->>API: Revise Field Report (safe_state='isolated', measurements added)
        API->>DB: Increment report_version (v2), Invalidate Stale Review
    end
    E->>API: Approve & Release Work (Confirm independent review, attach Work Method)
    API->>DB: Lock Approval (Attributed to Engineer, v2)

    Note over W,DB: Phase 3: Controlled Execution & Checklist Notes
    W->>API: Start Work (Transition to in_progress)
    loop Each Required Checklist Step
        W->>API: Complete Step + Mandatory Evidence Note
    end
    W->>API: Submit Work for Verification (Transition to awaiting_verification)
    API->>DB: Record Execution Handoff (Executors: Worker ID)

    Note over W,DB: Phase 4: Independent Verification & Closure
    E->>API: Inspect Completed Checklist & Execution Notes
    E->>API: Verify & Resolve with Closure Note
    API->>DB: Record Resolution Audit Snapshot (Status: resolved)
    API-->>W: Durable Notification: Incident Closed
```

---

## Relational Data Model (ER Schema)

OpsBridge models physical shopfloor assets, organizations, sites, role-scoped accounts, versioned incidents, checklists, immutable work methods, and append-only audit events.

```mermaid
erDiagram
    ORGANIZATION ||--o{ SITE : contains
    ORGANIZATION ||--o{ USER : employs
    ORGANIZATION ||--o{ ASSET : owns
    SITE ||--o{ USER : assigns
    SITE ||--o{ ASSET : houses
    SITE ||--o{ INCIDENT : tracks
    SITE ||--o{ WORK_METHOD : defines
    SITE ||--o{ NOTIFICATION : delivers

    USER ||--o{ INCIDENT : reports
    USER ||--o{ INCIDENT : "assigned to"
    USER ||--o{ AUTH_SESSION : owns
    USER ||--o{ AUDIT_EVENT : authors
    USER ||--o{ EVIDENCE : uploads

    ASSET ||--o{ INCIDENT : "subject of"
    INCIDENT ||--o{ EVIDENCE : attaches
    INCIDENT ||--o{ AUDIT_EVENT : logs
    INCIDENT ||--o{ NOTIFICATION : triggers

    ORGANIZATION {
        string id PK "UUID"
        string name "Organization display name"
    }

    SITE {
        string id PK "UUID"
        string organization_id FK
        string name "Site/Plant location name"
    }

    USER {
        string id PK "UUID"
        string organization_id FK
        string site_id FK
        string name "User full name"
        string email UK "Case-folded email"
        string password_hash "PBKDF2-HMAC-SHA256"
        string role "worker | engineer | supervisor | admin"
        boolean active "Account active status"
        boolean must_change_password "Forced rotation flag"
        string mfa_secret "Base32 TOTP secret (encrypted)"
        json recovery_hashes "List of hashed backup codes"
    }

    ASSET {
        string id PK "UUID"
        string organization_id FK
        string site_id FK
        string code "Asset code (e.g. CNC-01) UK per site"
        string name "Equipment name"
        string area "Physical shopfloor bay/area"
        string criticality "low | medium | high | critical"
        string status "registered | maintenance | decommissioned"
    }

    INCIDENT {
        string id PK "UUID"
        string number UK "Human incident code (INC-XXXXX)"
        string organization_id FK
        string site_id FK
        string reporter_id FK
        string assigned_to_id FK
        string asset_id FK
        string client_id "Idempotent UUID for offline sync"
        string create_fingerprint "SHA-256 of initial create"
        int version "Optimistic concurrency counter"
        int report_version "Source observation revision"
        string status "submitted | needs_clarification | ready_for_review | approved | in_progress | awaiting_verification | resolved | reopened | cancelled"
        string priority "low | medium | high | critical"
        json report "Structured observation data"
        json analysis "Rule engine assessment"
        json approval "Independent approval record"
        json checklist "Step-by-step required execution list"
        json executor_ids "List of worker IDs executing steps"
    }

    EVIDENCE {
        string id PK "UUID"
        string incident_id FK
        string uploaded_by FK
        string filename "Sanitized original name"
        string content_type "image/png | image/jpeg | application/pdf"
        int size "File size in bytes (max 10 MiB)"
        string sha256 "Content integrity digest"
        blob data "Binary payload (transactional)"
    }

    AUDIT_EVENT {
        string id PK "UUID"
        string incident_id FK
        string actor_id FK
        string action "submitted | analyzed | approved | started | executed | resolved | reopened"
        int report_version "Associated report version"
        json snapshot "Immutable capture of record state"
        string at "ISO-8601 UTC timestamp"
    }

    WORK_METHOD {
        string id PK "UUID"
        string organization_id FK
        string site_id FK
        string name "Method name"
        int version "Version sequence"
        string description "Method overview and safety prerequisites"
        json steps "Required/optional checklist steps"
    }
```

---

## Role Responsibilities and Guardrails

Trust is anchored in authenticated server sessions. Every approval, evidence upload, checklist step, and closure signature is cryptographically bound to an authenticated identity.

| Role | Demo Account | Password | Primary Responsibilities | Architectural Guardrails |
| :--- | :--- | :--- | :--- | :--- |
| **Field Technician** | `worker@apex.local` | `WorkerPass1234!` | Scans asset QR codes, logs physical symptoms, uploads evidence, executes released checklists. | **Cannot** approve work methods; **cannot** bypass engineering review; **cannot** self-close incidents. |
| **Reliability Engineer** | `engineer@apex.local` | `EngineerPass1234!` | Evaluates deterministic gap findings, requests clarification, selects work methods, approves released work. | **Cannot** approve own submitted reports; **cannot** execute work they approved (separation of duties). |
| **Operations Supervisor** | `supervisor@apex.local` | `SupervisorPass1234!` | Monitors plant queues, prioritizes production downtime, conducts final verification on restored assets. | **Cannot** falsify technician execution notes; verification requires signed completion handoff. |
| **Site Administrator** | `admin@apex.local` | `AdminPass1234!` | Manages asset register, provisions personnel, configures inbound integrations and security settings. | **Cannot** alter append-only audit trail; cannot overwrite versioned history snapshots. |

---

## Technical Design Highlights

### 1. Deterministic Safety Gap Analysis
Industrial life-safety decisions cannot rely on probabilistic text outputs. OpsBridge uses a deterministic rule engine that parses statements and validates physical plant invariants:
- Flags missing electrical, pneumatic, or hydraulic Lockout/Tagout (LOTO) declarations.
- Catches contradictory equipment states (e.g., machine logged as "running" alongside "broken spindle").
- Requires unambiguous injury and hazardous chemical disclosures before status progression.

### 2. Client-Side Encrypted Device Vault (AES-256-GCM)
Technicians operating in radio-shielded basements or metal-clad machine bays can draft observations offline:
- Uses the browser's native **Web Crypto API** with **AES-256-GCM** encryption and keys derived via **PBKDF2** (600,000 iterations).
- Encrypted drafts reside safely in IndexedDB and are never readable by unauthorized local scripts.
- Automatically synchronizes with server-side idempotency keys (`client_id`) upon network reconnection.

### 3. Append-Only Audit Trails and Direct Exports
- **Database Engine Triggers**: Both SQLite triggers (`audit_no_update`, `audit_no_delete`) and PostgreSQL triggers (`reject_audit_mutation()`) prevent mutation of audit history even if ORM controls are bypassed.
- **RFC 4180 CSV Export**: Direct spreadsheet-ready download at `/api/v1/incidents/export?fmt=csv`.
- **Cryptographic JSON Export**: Download complete incident provenance packages with SHA-256 evidence digests.

### 4. Operations Analytics
Derived directly from persisted relational transactions:
- **Mean Time to Resolution (MTTR)**: Median and average resolution durations.
- **7-Day Trend Volumes**: Incoming incident rate vs. completed verifications.
- **Critical Asset Bottlenecks**: Identifies recurring chronic failure equipment across plant cells.

---

## Local Development Setup

### Prerequisites
- **Python 3.12+**
- **Node.js 22+** and `npm`

### 1. Backend Setup
From the repository root:

```sh
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r backend/requirements-dev.txt

# Start FastAPI server
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Backend will be running at `http://127.0.0.1:8000`. Health check endpoint: `http://127.0.0.1:8000/api/v1/health`.

### 2. Frontend Setup
In a second terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173` in your browser.

### 3. Demo Data Seeding
In a third terminal, run the automated seeder script:

```sh
python scripts/demo_setup.py --reset
```

This registers:
- Organization: **Apex Precision Dynamics** (`Plant Alpha - Machining Cell`)
- 4 Authenticated Personnel (`worker`, `engineer`, `supervisor`, `admin`)
- CNC Mill, Hydraulic Press, and Conveyor assets
- Pre-configured incidents across workflow stages (`Needs Clarification`, `Approved`, `Resolved`)

---

## Testing and Quality Assurance

OpsBridge includes automated test suites across backend and frontend layers:

```sh
# Backend test suite (FastAPI + SQLAlchemy + Contract tests)
python -m pytest backend/tests -v

# PostgreSQL isolation and transaction test suite
pytest backend/tests/test_postgres.py -v

# Frontend unit tests
cd frontend
npm test

# Production build check
npm run build

# End-to-end integration tests (Playwright)
npm run test:e2e
```

---

## Deployment

OpsBridge is packaged for containerized deployment or direct deployment on Render via [`render.yaml`](render.yaml):

```sh
# Build and run multi-stage Docker container
docker build -t opsbridge .
docker run -p 8000:8000 -e APP_ENV=production -e SECRET_KEY="your-secret" opsbridge
```

### Production Security Checklist
- Set `APP_ENV=production`
- Configure PostgreSQL database URL (`postgresql+psycopg://...`)
- Set `COOKIE_SECURE=true` and bind to HTTPS origin
- Set `FIELD_ENCRYPTION_KEY` using a 32-byte Fernet key

---

## Project Information

- **Author**: Priyanshu Chauhan
- **Repository**: [github.com/PriyanshuChauhan-007/opsbridge](https://github.com/PriyanshuChauhan-007/opsbridge)
- **Specialization**: Full-Stack Architecture, Industrial Safety Systems, Deterministic Workflow Engineering

### Safety Disclaimer
*OpsBridge is an academic software engineering project demonstrating application architecture, role-based workflow coordination, and tamper-evident audit trails. It is not a certified Safety Integrity Level (SIL) system or a certified hardware interlock. Never treat software state as physical equipment isolation. Always adhere to site Lockout/Tagout (LOTO) protocols, PPE guidelines, and qualified human directives.*
