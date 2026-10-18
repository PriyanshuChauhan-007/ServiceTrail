# OpsBridge: System Architecture & Design Diagrams

This document contains architectural diagrams and technical design specifications for **OpsBridge**. These diagrams illustrate the system components, incident state machine, database schema, security boundaries, and runtime deployment topologies.

---

## 1. High-Level System Architecture

OpsBridge connects shopfloor workers and reliability engineers through a layered, role-enforced architecture designed for strict human accountability and audit provenance.

```mermaid
graph TB
    subgraph ClientLayer["Frontend Client Layer (PWA / React / TypeScript)"]
        UI["React 18 Single-Page Interface"]
        Router["Workspace Router (Role-Specific Desks)"]
        Scanner["Camera Barcode / QR Scanner (Native BarcodeDetector)"]
        Vault["Encrypted Device Vault (IndexedDB + Web Crypto AES-GCM)"]
        SW["Service Worker (Static Shell Cache Only)"]
    end

    subgraph SecurityBoundary["HTTP / Security Boundary"]
        Cookie["HTTP-Only, SameSite=Strict Session Cookies"]
        Headers["Restrictive CSP, HSTS, X-Content-Type-Options: nosniff"]
        OriginCheck["Exact Origin & Referer Verification"]
        BodyLimit["Request Body Size Guards (128 KB API / 10 MB Evidence)"]
    end

    subgraph ApplicationLayer["Backend Application Layer (FastAPI / Python 3.12)"]
        AuthService["Authentication & Session Manager (PBKDF2-HMAC-SHA256)"]
        MFAEngine["TOTP Engine (RFC 6238) & Recovery Tokens"]
        RBAC["Server-Side Role & Organization Scope Guard"]
        RulesEngine["Deterministic Rule-Based Assessment Engine"]
        WorkflowEngine["Incident State Machine & Concurrency Controller"]
        EvidenceValidator["Evidence Gate (PNG/JPEG/WebP/PDF Passive Parser)"]
    end

    subgraph PersistenceLayer["Durable Persistence Layer"]
        ORM["SQLAlchemy ORM (Unit of Work, Optimistic Concurrency)"]
        DB[(Relational Database: SQLite / PostgreSQL)]
        AuditTriggers["Append-Only DB Triggers (Reject UPDATE/DELETE)"]
    end

    UI --> Router
    Router --> Vault
    Router --> Scanner
    UI -.-> SW
    UI -->|HTTPS JSON REST Requests| Cookie
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

## 2. Incident State-Transition & Concurrency Diagram

The incident lifecycle implements an **11-state finite state machine** enforcing separation of duties, version-checked concurrency, and automatic invalidation of stale engineering approvals.

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

### Key Lifecycle Principles:
1. **Separation of Duties**: The author or recorded executor cannot approve their own report. The approver and executor cannot verify completion.
2. **Version Invalidation**: Any revision to the worker statement increments `report_version`, invalidating previous rule analysis, engineering approval, and active checklists.
3. **Optimistic Locking**: Every mutation requires matching the server's current `version`. Stale concurrent writes are rejected with HTTP 409 Conflict.

---

## 3. Separation of Duties & Human Accountability Flow

This sequence illustrates the exact handoff boundaries between human roles, proving that rules assist rather than replace engineering decisions.

```mermaid
sequenceDiagram
    autonumber
    actor W as Field Worker / Technician
    participant API as OpsBridge API
    participant Rule as Rule Engine
    actor E as Independent Engineer
    participant DB as Durable Audit Log

    Note over W,DB: Phase 1: Observation & Gap Analysis
    W->>API: Submit Field Report (Asset, Description, Safe State, Impact)
    API->>Rule: Evaluate Completeness & Negative Expressions
    Rule-->>API: Unverified Hypotheses + Safety Flags (No AI Truth Score)
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

## 4. Authentication, Session & Credential Security Flow

Authentication uses cryptographic password hashing, strict cookie-based session management, mandatory password rotation, and multi-factor authentication (TOTP).

```mermaid
sequenceDiagram
    autonumber
    actor Client as Browser Client
    participant API as FastAPI Backend
    participant Hash as PBKDF2-HMAC-SHA256
    participant DB as Auth Database

    Note over Client,DB: First-Run Bootstrap
    Client->>API: POST /api/v1/setup (Org, Site, Admin Credentials)
    API->>DB: Check SetupLock (Atomic transaction)
    API->>Hash: Hash Password (600,000 iterations, unique salt)
    API->>DB: Store User + Set SetupLock.completed = True
    API-->>Client: Set-Cookie: opsbridge_session (HTTP-Only, SameSite=Strict)

    Note over Client,DB: Subsequent Login & MFA Flow
    Client->>API: POST /api/v1/auth/login (email, password, optional OTP)
    API->>DB: Fetch User by Email
    API->>Hash: Verify Password Hash
    alt MFA Enrolled
        API->>API: Verify RFC 6238 TOTP Token (or Recovery Code Hash)
    end
    API->>API: Generate Cryptographically Secure Random Session Token
    API->>DB: Store SHA-256 Digest of Token (12-Hour Expiration)
    API-->>Client: Set-Cookie: opsbridge_session (Rotated Session ID)

    Note over Client,DB: First Login Password Rotation
    alt user.must_change_password == True
        Client->>API: POST /api/v1/auth/change-password (current, new)
        API->>Hash: Hash New Password (600,000 iterations)
        API->>DB: Update password_hash, set must_change_password = False
        API-->>Client: 200 OK (Account Fully Activated)
    end
```

---

## 5. Entity-Relationship (ER) Schema Diagram

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

## 6. Runtime & Deployment Topology

OpsBridge is designed for flexible deployment: from lightweight single-container cloud demonstrations to production high-availability multi-tier deployments with PostgreSQL.

```mermaid
graph TB
    subgraph ClientEnvironments["Client Devices"]
        Mobile["Mobile PWA (Shopfloor Technician)"]
        Tablet["Tablet / Toughbook (Inspection Desk)"]
        Desktop["Workstation (Engineering / Ops Center)"]
    end

    subgraph ContainerRuntime["OpsBridge Docker Container"]
        ReverseProxy["Reverse Proxy / Nginx / Render Edge"]
        
        subgraph InternalHost["Uvicorn ASGI Server"]
            StaticMount["Static Dist Shell (/index.html, /assets)"]
            FastAPI["FastAPI Python Application (/api/v1/*)"]
        end
    end

    subgraph StorageOptions["Storage Deployment Configurations"]
        subgraph DemoMode["Demo Mode (APP_ENV=demo)"]
            SQLiteFile[("opsbridge.db (Ephemeral SQLite + WAL)")]
        end

        subgraph ProdMode["Production Mode (APP_ENV=production)"]
            PostgresMaster[("PostgreSQL Master (Row Locks + Advisory Locks)")]
            PostgresReplica[("PostgreSQL Read-Replica (Optional Reporting)")]
        end
    end

    Mobile -->|HTTPS / WSS| ReverseProxy
    Tablet -->|HTTPS / WSS| ReverseProxy
    Desktop -->|HTTPS / WSS| ReverseProxy

    ReverseProxy -->|Static Assets| StaticMount
    ReverseProxy -->|Strict Reverse-Proxy Pass| FastAPI

    FastAPI -.->|Development / Render Demo| SQLiteFile
    FastAPI ==>|Production Mandatory| PostgresMaster
    PostgresMaster -.->|Streaming Replication| PostgresReplica
```

---

## 7. Audit Immutability & Database Triggers

Audit events in OpsBridge are protected at multiple defensive tiers:
1. **Application / ORM Tier**: SQLAlchemy lifecycle listeners intercept and reject any `UPDATE` or `DELETE` attempt on `AuditEvent`, `AdminAudit`, or `WorkMethod` entities.
2. **Database Engine Tier**: Native database triggers (`audit_no_update` and `audit_no_delete` in SQLite; `reject_audit_mutation()` in PostgreSQL) abort mutations at the SQL engine level.
3. **Data Provenance Tier**: Every transition saves a snapshot of the exact report state, actor identity, decision note, and timestamp.
