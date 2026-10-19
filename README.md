# OpsBridge

**Accountable Industrial Incident Coordination & Dual-Control Release Platform**

[![Live Demo](https://img.shields.io/badge/Demo-Live%20on%20Render-008080?style=for-the-badge&logo=render&logoColor=white)](https://opsbridge-demo.onrender.com)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Security: AES-256-GCM](https://img.shields.io/badge/Encrypted%20Vault-AES--256--GCM-228B22?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)

> *"Observe carefully. Decide independently. Leave a clear record."*

---

## 🌐 Live Application & Demo Links

| Resource | Link | Description |
| :--- | :--- | :--- |
| **Live Web App** | **[opsbridge-demo.onrender.com](https://opsbridge-demo.onrender.com)** | Hosted public evaluation environment on Render. |
| **Source Repository** | **[github.com/PriyanshuChauhan-007/opsbridge](https://github.com/PriyanshuChauhan-007/opsbridge)** | Complete full-stack monorepo (FastAPI + React PWA). |
| **System Architecture** | **[docs/architecture-diagrams.md](docs/architecture-diagrams.md)** | Mermaid state machines, ER schemas, and sequence flows. |
| **Local Workspace** | `http://127.0.0.1:5173` | Local development environment served via Vite. |

> **Quick Tour**: When opening the live app, click any **Demo Persona** pill on the login screen or in the sidebar to tour as a **Field Technician**, **Reliability Engineer**, **Operations Supervisor**, or **Site Administrator** with zero typing.

---

## 📌 GitHub Repository Details (About Section)

To ensure visitors understand this project at a glance, configure the following on the GitHub repository sidebar (`⚙️ About`):

- **Description**: `Industrial dual-control manufacturing incident coordination system. Enforces strict separation of duties, deterministic safety gap analysis, versioned engineering release, offline encrypted vault, and tamper-evident audit trails.`
- **Website**: `https://opsbridge-demo.onrender.com`
- **Topics**: `fastapi`, `react`, `typescript`, `manufacturing`, `incident-coordination`, `dual-control`, `separation-of-duties`, `audit-trail`, `pwa`, `offline-first`, `webcrypto`, `sqlite`, `postgresql`, `btech-capstone`

---

## 🏭 Why OpsBridge? (The Problem It Solves)

In modern manufacturing facilities (machining cells, stamping presses, packaging lines, and chemical processing units), equipment failures and unscheduled stoppages cost thousands of dollars per minute and introduce severe life-safety hazards.

Yet on many plant floors today, breakdown reports and maintenance handoffs are still handled through **informal, uncoordinated channels**:
- **WhatsApp & Telegram chats** where evidence and measurements disappear into message history.
- **Verbal shift handoffs** that leave no permanent provenance or record of who was told what.
- **Paper clipboards and spreadsheets** with no cryptographic protection or independent review.

### Critical Failure Points in Informal Plant Coordination
1. **The Self-Approval Hazard**: A technician who performs an emergency field fix frequently self-certifies their own work. Without independent verification, fatal shortcuts go unnoticed.
2. **Missing Evidence & Broken Provenance**: Photos of fractured drive pins, vibration logs, and multimeters are scattered across personal mobile phones with zero timestamp integrity.
3. **Silent State Drift**: If equipment symptoms worsen or new damage is uncovered after an initial sign-off, work continues under obsolete assumptions.
4. **Zero Regulatory Compliance**: OSHA 1910 (Lockout/Tagout) and ISO 9001/45001 standards require documented **dual-control ("four-eyes principle")**. An engineer cannot approve their own report or execute work they approved; an independent party must confirm safe isolation.

---

## 🔄 The 6-Stage Accountable Decision Loop

OpsBridge enforces a hardened, server-verified human decision loop across all incidents:

```text
[ 01. FLOOR OBSERVATION ]
  Field Technician scans asset QR, logs physical symptoms, safe state, and photo/PDF evidence.
          │
          ▼
[ 02. DETERMINISTIC GAP ANALYSIS ]
  Rule engine flags missing LOTO isolation, unknown injury states, and contradictory inputs.
          │
          ▼
[ 03. VERSIONED ENGINEERING REVIEW ]
  Reliability Engineer inspects evidence. Any source modification automatically invalidates review.
          │
          ▼
[ 04. DUAL-CONTROL RELEASE ]
  Engineer approves safety checklist with mandatory decision rationale. Cannot execute own release.
          │
          ▼
[ 05. CHECKLIST EXECUTION ]
  Assigned technician records physical observations for each required step. Notes are mandatory.
          │
          ▼
[ 06. INDEPENDENT VERIFICATION & CLOSURE ]
  Supervisor or independent engineer inspects the restored machine, adds closure notes, and seals record.
```

---

## 👥 Separation of Duties Matrix (Why Separate Logins Are Mandatory)

OpsBridge **does not use a single shared demo account or client-side role toggling**. 

In industrial safety engineering, trust is rooted in authenticated identity. Every approval, evidence upload, checklist completion, and closure note is permanently attributed to a specific person's server session.

| Role | Demo Account | Password | Primary Responsibilities | Architectural Safety Guardrails |
| :--- | :--- | :--- | :--- | :--- |
| **Field Technician** | `worker@apex.local` | `WorkerPass1234!` | Scans asset QR codes, captures floor observations, uploads evidence, executes released checklists. | **Cannot** approve work methods; **cannot** bypass engineering review; **cannot** close incidents. |
| **Reliability Engineer** | `engineer@apex.local` | `EngineerPass1234!` | Evaluates deterministic gap findings, requests clarification, selects work methods, approves released work. | **Cannot** approve their own submitted report; **cannot** execute work they approved (separation of duties). |
| **Operations Supervisor** | `supervisor@apex.local` | `SupervisorPass1234!` | Monitors plant queues, prioritizes production downtime, conducts final verification on restored assets. | **Cannot** falsify technician execution notes; verification requires signed completion handoff. |
| **Site Administrator** | `admin@apex.local` | `AdminPass1234!` | Manages asset register, provisions personnel, configures inbound integrations and security settings. | **Cannot** alter append-only audit trail; cannot overwrite versioned history snapshots. |

> **Try It Live**: Sign in as `worker@apex.local` and submit a report. Switch to `engineer@apex.local` via the sidebar persona switcher to see how the operations desk immediately locks you out of executing that report while unlocking the engineering review suite!

---

## ⚡ Key System Features

### 1. Dual Workspaces: Field Notebook vs. Operations Desk
- **Field Notebook**: High-contrast, mobile-first interface designed for technicians on the plant floor. Includes instant asset search, local camera QR/barcode scanner, and quick observation capture.
- **Operations Desk**: Desktop command center for reliability engineers and supervisors featuring multi-queue triage, SLA countdowns, impact categorization, and technical work methods.

### 2. Deterministic Safety Gap Analysis (No AI Hallucinations)
Industrial life-safety decisions cannot depend on probabilistic AI models. OpsBridge employs a deterministic, transparent rule engine that flags:
- Missing electrical/hydraulic Lockout-Tagout (LOTO) isolation statements.
- Contradictory machine states (e.g., "running" marked alongside "broken drive shaft").
- Missing injury or hazardous chemical declarations.

### 3. Immutable Version Invalidation
If a technician revises observations or uploads new evidence after an engineer requests clarification, the previous engineering review is **immediately invalidated** by the database. Work cannot proceed on stale assumptions.

### 4. Operations Analytics Dashboard (`/analytics/dashboard`)
Real-time operational intelligence derived directly from persisted server transactions:
- **Mean Time to Resolution (MTTR)**: Median and average resolution durations.
- **7-Day Trend Volumes**: Incoming report volume vs. completed verifications.
- **Priority Breakdown**: High/Critical safety alerts surfaced automatically.
- **Asset Breakdown**: Identifies recurring chronic failure equipment across plant cells.

### 5. Tamper-Evident Audit Trails & Single-Click Exports
- **Cryptographic Provenance**: Every state change, actor ID, timestamp, and rationale is stored in an append-only audit table.
- **Single-Click RFC 4180 CSV Export**: Direct spreadsheet-ready download at `/api/v1/incidents/export?fmt=csv`.
- **Cryptographic JSON Export**: Download complete incident provenance packages including SHA-256 evidence digests.

### 6. Client-Side Encrypted Device Vault (AES-256-GCM)
Technicians operating in radio-shielded basements or metal Faraday cages can store field observations locally:
- Uses the **Web Crypto API** with **AES-256-GCM** encryption and keys derived via **PBKDF2**.
- Sensitive observations are never stored in plaintext `localStorage`.
- Automatic synchronization with server-side idempotency keys upon reconnecting.

### 7. Sub-Millisecond Health & Diagnostics (`/api/v1/health`)
Active health monitoring endpoint providing:
- Real-time database query round-trip latency in milliseconds (`db_latency_ms`).
- Application runtime environment (`demo`, `development`, or `production`).
- Server uptime and readiness assertions.

---

## 🛠️ Tech Stack & Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                           │
│  React 19 + TypeScript + Vite PWA                           │
│  - Field Notebook (Technician Mobile View)                  │
│  - Operations Desk (Engineer / Supervisor Workstation)      │
│  - Encrypted Device Vault (Web Crypto API AES-256-GCM)       │
└──────────────────────────────┬──────────────────────────────┘
                               │ Same-Origin HttpOnly Cookies
                               │ (Strict Role-Based CSRF/CORS)
┌──────────────────────────────▼──────────────────────────────┐
│                    APPLICATION BACKEND                      │
│  FastAPI (Python 3.12+)                                     │
│  - 6-Stage Workflow State Machine                           │
│  - Deterministic Safety Gap Analysis Engine                 │
│  - Analytics Aggregator & RFC 4180 CSV Exporter             │
│  - Sub-Millisecond DB Latency Health Monitor                │
└──────────────────────────────┬──────────────────────────────┘
                               │ SQLAlchemy 2.0 ORM
┌──────────────────────────────▼──────────────────────────────┐
│                      DATABASE LAYER                         │
│  SQLite (Local Dev & Render Demo) / PostgreSQL (Production) │
│  - Foreign Key Constraints & Transactional Isolation        │
│  - Append-Only Audit Trail & Versioned Snapshots            │
└─────────────────────────────────────────────────────────────┘
```

For complete architectural diagrams (Mermaid state machines, ER schemas, and sequence flows), see **[docs/architecture-diagrams.md](docs/architecture-diagrams.md)**.

---

## 🚀 Local Development Setup

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

Backend will be live at `http://127.0.0.1:8000`. Health check: `http://127.0.0.1:8000/api/v1/health`.

### 2. Frontend Setup
In a second terminal:

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

Open **`http://127.0.0.1:5173`** in your browser.

### 3. Populate Demo Evaluation Data (1-Command Setup)
In a third terminal, run the automated seeder:

```sh
python scripts/demo_setup.py
```

This immediately registers:
- Organization: **Apex Precision Dynamics** (`Plant Alpha - Machining Cell`)
- 4 Authenticated Personnel (`worker`, `engineer`, `supervisor`, `admin`)
- CNC Mill, Hydraulic Press, and Conveyor assets
- Pre-configured incidents across various workflow stages (`Needs Clarification`, `Approved`, `Resolved`)

---

## 🧪 Testing & Verification

OpsBridge includes full automated test suites across both backend and frontend:

```sh
# Backend test suite (FastAPI + SQLAlchemy + Contract tests)
py -3.12 -m pytest backend/tests -v

# Frontend unit tests (Node test runner)
cd frontend
npm test

# Frontend production build
npm run build
```

---

## ☁️ Free Render Demo Deployment

OpsBridge is ready for one-click deployment to **Render** via [`render.yaml`](render.yaml):

1. Fork or push this repository to your GitHub account.
2. Sign in to [Render](https://render.com) and click **New > Blueprint**.
3. Select your repository. Render will automatically parse `render.yaml` and build the root `Dockerfile`.
4. Set the following environment variables in Render:
   - `APP_ENV`: `demo`
   - `PUBLIC_ORIGIN`: `https://<your-service-name>.onrender.com`
   - `COOKIE_SECURE`: `true`
   - `FIELD_ENCRYPTION_KEY`: A 32-byte Fernet key generated via `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
5. Deploy and access your live instance!

---

## 👨‍💻 Project Information & Attribution

- **Author**: **Priyanshu Chauhan**
- **Project Type**: BTech Final-Year Capstone Project
- **Specialization**: Full-Stack Architecture, Industrial Systems, and Deterministic Workflow Engineering
- **GitHub**: [PriyanshuChauhan-007/opsbridge](https://github.com/PriyanshuChauhan-007/opsbridge)

### ⚠️ Industrial Safety Disclaimer
*OpsBridge is an academic software engineering project demonstrating application architecture, role-based workflow coordination, and tamper-evident audit trails. It is **not a certified Safety Integrity Level (SIL) system** or a certified hardware interlock. Never treat an application state as physical equipment isolation. Always adhere to site Lockout/Tagout (LOTO) protocols, PPE guidelines, and qualified human directives.*
