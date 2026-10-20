#!/usr/bin/env python3
"""Synthetic Demo Setup for OpsBridge.

Instantiates a clean, complete demonstration environment for recruiters,
evaluators, and technical presentations.

Creates:
- 1 Organization ("Apex Precision Dynamics") and Site ("Plant Alpha - Machining Cell")
- 4 Role-based Accounts:
    - Administrator: admin@apex.local       / AdminPass1234!
    - Lead Engineer: engineer@apex.local    / EngineerPass1234!
    - Technician:    worker@apex.local      / WorkerPass1234!
    - Supervisor:    supervisor@apex.local  / SupervisorPass1234!
- 3 Registered Industrial Assets (CNC-MILL-04, PUMP-HYD-02, CONV-LINE-01)
- 1 Pre-defined Approved Work Method (Hydraulic Seal Replacement & Isolation)
- 3 Realistic Incidents demonstrating different workflow lifecycle stages:
    1. INC-101: Needs Clarification (Hydraulic pump leak while running, safety findings)
    2. INC-102: Approved & Ready for Execution (CNC spindle vibration with checklist)
    3. INC-103: Resolved & Independently Verified (Sensor alignment with full audit trail)

Usage:
    python scripts/demo_setup.py [--reset] [--db PATH_OR_URL]
"""

import argparse
import copy
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

# Ensure project root is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.config import Settings
from backend.database import (AdminAudit, Asset, AuditEvent, Incident,
                              Organization, SetupLock, Site, User, WorkMethod,
                              initialize, make_database, now, uid)
from backend.security import hash_password
from backend.services import analyze, assess


DEMO_ORG_NAME = "Apex Precision Dynamics"
DEMO_SITE_NAME = "Plant Alpha - Machining Cell"

DEMO_USERS = [
    {
        "name": "Priyanshu Chauhan (Admin)",
        "email": "admin@apex.local",
        "role": "admin",
        "password": "AdminPass1234!",
    },
    {
        "name": "Sarah Lin (Lead Reliability Engineer)",
        "email": "engineer@apex.local",
        "role": "engineer",
        "password": "EngineerPass1234!",
    },
    {
        "name": "Marcus Vance (Field Technician)",
        "email": "worker@apex.local",
        "role": "worker",
        "password": "WorkerPass1234!",
    },
    {
        "name": "Elena Rostova (Operations Supervisor)",
        "email": "supervisor@apex.local",
        "role": "supervisor",
        "password": "SupervisorPass1234!",
    },
]

DEMO_ASSETS = [
    {
        "code": "CNC-MILL-04",
        "name": "5-Axis Vertical Machining Center",
        "area": "Machining Cell B - Bay 3",
        "criticality": "high",
        "manufacturer": "DMG MORI",
        "model": "DMU 50 3rd Gen",
    },
    {
        "code": "PUMP-HYD-02",
        "name": "Primary Hydraulic Power Unit",
        "area": "Hydraulics Skid Bay 1",
        "criticality": "critical",
        "manufacturer": "Rexroth Bosch",
        "model": "ABPAC 250L",
    },
    {
        "code": "CONV-LINE-01",
        "name": "High-Speed Infeed Roller Conveyor",
        "area": "Assembly & Packing Line 1",
        "criticality": "medium",
        "manufacturer": "Interroll",
        "model": "RM 8330 Modular",
    },
]

DEMO_WORK_METHOD = {
    "name": "Hydraulic Seal Replacement & Circuit Depressurization",
    "description": "Standard operating procedure for isolating hydraulic fluid pressure, replacing degraded manifold seals, and performing low-pressure verification before production release.",
    "steps": [
        {
            "label": "Confirm electrical lockout and de-energize primary pump motor",
            "required": True,
        },
        {
            "label": "Depressurize accumulator circuit and inspect mechanical gauge reads 0 bar",
            "required": True,
        },
        {
            "label": "Install fluid catchment tray, remove flange bolts, and replace degraded seal pack",
            "required": True,
        },
        {
            "label": "Torque flange bolts to 45 Nm in star sequence and perform 5-minute visual static check",
            "required": True,
        },
    ],
}


def create_demo_data(db_path_or_url: str | None = None, reset: bool = False):
    """Seed the database with synthetic demo data."""
    if not db_path_or_url:
        default_db = ROOT_DIR / "backend" / "data" / "opsbridge.db"
        db_path_or_url = os.environ.get("DATABASE_URL", f"sqlite:///{default_db}")

    print(f"\n=======================================================")
    print(f"  OpsBridge — Synthetic Demo Setup")
    print(f"=======================================================")
    print(f"Target Database: {db_path_or_url}")

    # If local SQLite and reset requested, remove existing file
    if reset and db_path_or_url.startswith("sqlite"):
        try:
            from sqlalchemy import make_url
            filename = make_url(db_path_or_url).database
        except ImportError:
            filename = db_path_or_url.split("sqlite:///", 1)[-1] if "sqlite:///" in db_path_or_url else None
        if filename and filename != ":memory:" and os.path.exists(filename):
            print(f"Reset requested: removing existing database at {filename}")
            os.remove(filename)

    engine, session_maker = make_database(db_path_or_url)
    initialize(engine)

    with session_maker() as db:
        # Check if already setup
        lock = db.get(SetupLock, 1)
        if lock and lock.completed and not reset:
            print("\nNotice: Organization is already initialized.")
            print("Run with '--reset' to cleanly re-create all demo accounts and records.")
            _print_demo_summary(db)
            return

        print("\n[1/5] Creating Organization and Site...")
        org = Organization(id=uid(), name=DEMO_ORG_NAME)
        site = Site(id=uid(), organization_id=org.id, name=DEMO_SITE_NAME)
        db.add(org)
        db.add(site)
        db.flush()

        print("[2/5] Creating Role-Based Accounts...")
        user_map = {}
        for user_data in DEMO_USERS:
            user = User(
                id=uid(),
                organization_id=org.id,
                site_id=site.id,
                name=user_data["name"],
                email=user_data["email"],
                password_hash=hash_password(user_data["password"]),
                role=user_data["role"],
                active=True,
                must_change_password=False,  # Unlocked for direct demo convenience
            )
            db.add(user)
            db.flush()
            user_map[user_data["role"]] = user
            db.add(AdminAudit(
                id=uid(),
                organization_id=org.id,
                action="user.created",
                actor_name="System Seed",
                note=f"Demo account: {user.name} ({user.role})"
            ))

        print("[3/5] Registering Industrial Assets...")
        asset_map = {}
        for asset_data in DEMO_ASSETS:
            asset = Asset(
                id=uid(),
                organization_id=org.id,
                site_id=site.id,
                code=asset_data["code"],
                name=asset_data["name"],
                area=asset_data["area"],
                criticality=asset_data["criticality"],
                manufacturer=asset_data.get("manufacturer"),
                model=asset_data.get("model"),
                status="registered",
            )
            db.add(asset)
            db.flush()
            asset_map[asset_data["code"]] = asset
            db.add(AdminAudit(
                id=uid(),
                organization_id=org.id,
                action="asset.created",
                actor_name="System Seed",
                note=f"Asset registered: {asset.code} ({asset.name})"
            ))

        print("[4/5] Authoring Standard Work Method...")
        work_method = WorkMethod(
            id=uid(),
            organization_id=org.id,
            site_id=site.id,
            name=DEMO_WORK_METHOD["name"],
            description=DEMO_WORK_METHOD["description"],
            steps=DEMO_WORK_METHOD["steps"],
            version=1,
        )
        db.add(work_method)
        db.flush()

        print("[5/5] Creating Lifecycle Demonstration Incidents...")
        admin_user = user_map["admin"]
        engineer_user = user_map["engineer"]
        worker_user = user_map["worker"]
        supervisor_user = user_map["supervisor"]

        # Incident 1: Needs Clarification (Demonstrating rule-based gap detection)
        inc1_report = {
            "asset_id": asset_map["PUMP-HYD-02"].id,
            "description": "Observed significant hydraulic fluid pooling beneath manifold block B. Continuous hissing sound near the pressure regulator valve. Pump was left running during report.",
            "impact": "Primary line speed reduced by 30% due to intermittent pressure fluctuations.",
            "injury_status": "none",
            "safe_state": "running",
            "measurements": "Temperature: 68 C; Line pressure fluctuating between 140-180 bar.",
        }
        inc1_fingerprint = hashlib.sha256(json.dumps(inc1_report, sort_keys=True).encode()).hexdigest()
        inc1_findings, inc1_priority = assess(inc1_report, False)
        inc1_analysis = analyze(inc1_report, 1)

        inc1 = Incident(
            id=uid(),
            number="INC-2026-00101",
            organization_id=org.id,
            site_id=site.id,
            reporter_id=worker_user.id,
            assigned_to_id=None,
            asset_id=asset_map["PUMP-HYD-02"].id,
            create_fingerprint=inc1_fingerprint,
            version=2,
            report_version=1,
            status="needs_clarification",
            priority="critical",
            report=inc1_report,
            analysis=inc1_analysis,
            approval=None,
            checklist=[],
            executor_ids=[],
        )
        db.add(inc1)
        db.flush()

        # Audit events for Incident 1
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc1.id,
            action="submitted",
            actor_id=worker_user.id,
            actor_name=worker_user.name,
            actor_role=worker_user.role,
            report_version=1,
            snapshot={"report": inc1_report},
            note="Initial field observation submitted from shopfloor notebook."
        ))
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc1.id,
            action="analyzed",
            actor_id=engineer_user.id,
            actor_name=engineer_user.name,
            actor_role=engineer_user.role,
            report_version=1,
            snapshot={"report": inc1_report, "analysis": inc1_analysis},
            note="Rule analysis flagged safe_state='running'. Clarification required before work release."
        ))

        # Incident 2: Approved / Released for Execution
        inc2_report = {
            "asset_id": asset_map["CNC-MILL-04"].id,
            "description": "High-frequency vibration and audible chatter during Z-axis roughing pass on titanium workpieces. Spindle bearing temperature elevated after 20 minutes of continuous runtime.",
            "impact": "Finish tolerances approaching upper limit (+0.015mm). Production paused on machining cell B.",
            "injury_status": "none",
            "safe_state": "stopped",
            "measurements": "Vibration RMS: 4.2 mm/s (acceptable threshold < 1.8 mm/s); Spindle bearing temperature: 54 C.",
        }
        inc2_fingerprint = hashlib.sha256(json.dumps(inc2_report, sort_keys=True).encode()).hexdigest()
        inc2_analysis = analyze(inc2_report, 1)
        inc2_approval = {
            "actor_id": engineer_user.id,
            "actor_name": engineer_user.name,
            "note": "Work authorized per standard SOP. Attached seal replacement & circuit verification method. Verify spindle isolation before opening cover.",
            "at": now(),
            "report_version": 1,
            "work_method": {
                "id": work_method.id,
                "name": work_method.name,
                "description": work_method.description,
                "steps": work_method.steps,
                "version": 1,
            },
            "work_method_label": work_method.name,
        }
        inc2_checklist = [
            {"id": uid(), "label": step["label"], "required": step["required"], "completed": False, "notes": ""}
            for step in work_method.steps
        ]

        inc2 = Incident(
            id=uid(),
            number="INC-2026-00102",
            organization_id=org.id,
            site_id=site.id,
            reporter_id=worker_user.id,
            assigned_to_id=worker_user.id,
            asset_id=asset_map["CNC-MILL-04"].id,
            create_fingerprint=inc2_fingerprint,
            version=3,
            report_version=1,
            status="approved",
            priority="high",
            report=inc2_report,
            analysis=inc2_analysis,
            approval=inc2_approval,
            checklist=inc2_checklist,
            executor_ids=[],
        )
        db.add(inc2)
        db.flush()

        db.add(AuditEvent(
            id=uid(),
            incident_id=inc2.id,
            action="submitted",
            actor_id=worker_user.id,
            actor_name=worker_user.name,
            actor_role=worker_user.role,
            report_version=1,
            snapshot={"report": inc2_report},
            note="Submitted field report with recorded vibration RMS."
        ))
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc2.id,
            action="approved",
            actor_id=engineer_user.id,
            actor_name=engineer_user.name,
            actor_role=engineer_user.role,
            report_version=1,
            snapshot={"report": inc2_report, "approval": inc2_approval, "checklist": inc2_checklist},
            note=inc2_approval["note"]
        ))

        # Incident 3: Resolved & Independently Verified (Complete lifecycle record)
        inc3_report = {
            "asset_id": asset_map["CONV-LINE-01"].id,
            "description": "Optical tracking sensor photoelectric lens accumulated fine particulate dust and sustained angular misalignment, causing false jam interrupts at the transfer junction.",
            "impact": "Assembly line conveyor stopped for 14 minutes.",
            "injury_status": "none",
            "safe_state": "stopped",
            "measurements": "Sensor alignment offset: 4.5 mm vertical deviation from reflector center.",
        }
        inc3_fingerprint = hashlib.sha256(json.dumps(inc3_report, sort_keys=True).encode()).hexdigest()
        inc3_analysis = analyze(inc3_report, 1)
        inc3_approval = {
            "actor_id": supervisor_user.id,
            "actor_name": supervisor_user.name,
            "note": "Authorized optical sensor realignment and isopropyl lens cleaning. Electrical isolation confirmed.",
            "at": now(),
            "report_version": 1,
            "work_method": None,
            "work_method_label": "Generic completion record — not an SOP",
        }
        inc3_checklist = [
            {
                "id": uid(),
                "label": "Record confirmed safe conditions and site-approved isolation before work",
                "required": True,
                "completed": True,
                "notes": "Emergency stop button locked out and tagged out at panel CB-04. Zero voltage verified.",
            },
            {
                "id": uid(),
                "label": "Document qualified inspection, approved work performed and observed results",
                "required": True,
                "completed": True,
                "notes": "Cleaned transceiver optic with lint-free wipes and alcohol. Re-torqued mounting bracket and centered beam on retro-reflector.",
            },
            {
                "id": uid(),
                "label": "Record the controlled test outcome and handover evidence for independent verification",
                "required": True,
                "completed": True,
                "notes": "Cycled 30 consecutive totes across junction. Transceiver response latency measured 12ms with zero missed triggers.",
            },
        ]

        inc3 = Incident(
            id=uid(),
            number="INC-2026-00103",
            organization_id=org.id,
            site_id=site.id,
            reporter_id=worker_user.id,
            assigned_to_id=worker_user.id,
            asset_id=asset_map["CONV-LINE-01"].id,
            create_fingerprint=inc3_fingerprint,
            version=6,
            report_version=1,
            status="resolved",
            priority="medium",
            report=inc3_report,
            analysis=inc3_analysis,
            approval=inc3_approval,
            checklist=inc3_checklist,
            executor_ids=[worker_user.id],
        )
        db.add(inc3)
        db.flush()

        # Audit events for Incident 3 showing full handoff provenance
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc3.id,
            action="submitted",
            actor_id=worker_user.id,
            actor_name=worker_user.name,
            actor_role=worker_user.role,
            report_version=1,
            snapshot={"report": inc3_report},
            note="Conveyor sensor issue reported."
        ))
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc3.id,
            action="approved",
            actor_id=supervisor_user.id,
            actor_name=supervisor_user.name,
            actor_role=supervisor_user.role,
            report_version=1,
            snapshot={"report": inc3_report, "approval": inc3_approval},
            note=inc3_approval["note"]
        ))
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc3.id,
            action="started",
            actor_id=worker_user.id,
            actor_name=worker_user.name,
            actor_role=worker_user.role,
            report_version=1,
            snapshot={"status": "in_progress"},
            note="Lockout applied; started sensor service."
        ))
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc3.id,
            action="submit_verification",
            actor_id=worker_user.id,
            actor_name=worker_user.name,
            actor_role=worker_user.role,
            report_version=1,
            snapshot={"checklist": inc3_checklist},
            note="All 3 steps completed with verification notes. Handed off for engineer review."
        ))
        db.add(AuditEvent(
            id=uid(),
            incident_id=inc3.id,
            action="resolved",
            actor_id=engineer_user.id,
            actor_name=engineer_user.name,
            actor_role=engineer_user.role,
            report_version=1,
            snapshot={"checklist": inc3_checklist, "status": "resolved"},
            note="Independently inspected beam alignment on conveyor transfer. 30 test cycles confirmed fault-free operation. Incident closed."
        ))

        # Mark setup as completed
        if not lock:
            db.add(SetupLock(id=1, completed=True))
        else:
            lock.completed = True

def setup_via_http(base_url: str):
    """Seed synthetic demo data via HTTP API (e.g. Render live demo or local dev server)."""
    import urllib.request
    import urllib.error
    from http.cookiejar import CookieJar

    base_url = base_url.rstrip("/")
    print(f"\n=======================================================")
    print(f"  OpsBridge — HTTP Demo Setup")
    print(f"=======================================================")
    print(f"Target Service: {base_url}")

    class Client:
        def __init__(self):
            self.cj = CookieJar()
            self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))

        def req(self, method, path, data=None):
            url = f"{base_url}{path}"
            body = json.dumps(data).encode("utf-8") if data is not None else None
            headers = {"Origin": base_url}
            if data is not None:
                headers["Content-Type"] = "application/json"
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with self.opener.open(req) as resp:
                    raw = resp.read().decode("utf-8")
                    return resp.status, json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                raw = e.read().decode("utf-8")
                try:
                    parsed = json.loads(raw)
                except Exception:
                    parsed = raw
                return e.code, parsed

    client = Client()

    # 1. Setup Status
    status_code, status_data = client.req("GET", "/api/v1/setup/status")
    if status_code != 200:
        print(f"Error checking status: HTTP {status_code} {status_data}")
        return

    admin_cred = next(u for u in DEMO_USERS if u["role"] == "admin")
    if status_data.get("needs_setup"):
        print("[1/5] Running First-Run Setup...")
        code, resp = client.req("POST", "/api/v1/setup", {
            "organization_name": DEMO_ORG_NAME,
            "site_name": DEMO_SITE_NAME,
            "name": admin_cred["name"],
            "email": admin_cred["email"],
            "password": admin_cred["password"]
        })
        if code != 201:
            print(f"Failed to setup: HTTP {code} {resp}")
            return
        print(f"  [OK] Initialized Organization: '{DEMO_ORG_NAME}'")
    else:
        print("[1/5] Site already setup, logging in as Admin...")
        code, resp = client.req("POST", "/api/v1/auth/login", {
            "email": admin_cred["email"],
            "password": admin_cred["password"]
        })
        if code != 200:
            print(f"  Could not log in as admin ({admin_cred['email']}): HTTP {code} {resp}")
            print("  If you configured a different admin password, please run setup with those credentials.")
            return
        print(f"  [OK] Logged in as Admin: {admin_cred['email']}")

    # 2. Check / Create Assets
    print("[2/5] Registering Industrial Assets...")
    code, existing_assets = client.req("GET", "/api/v1/assets")
    asset_by_code = {a["code"]: a for a in (existing_assets or [])}

    for a_data in DEMO_ASSETS:
        if a_data["code"] not in asset_by_code:
            code, created = client.req("POST", "/api/v1/assets", a_data)
            if code == 201:
                asset_by_code[a_data["code"]] = created
                print(f"  [OK] Registered {a_data['code']} - {a_data['name']}")
            else:
                print(f"  Warning: failed to create asset {a_data['code']}: HTTP {code} {created}")
        else:
            print(f"  - Asset {a_data['code']} already registered")

    # 3. Create Users
    print("[3/5] Provisioning Role-Based Team Accounts...")
    code, existing_users = client.req("GET", "/api/v1/users")
    user_by_email = {u["email"]: u for u in (existing_users or [])}

    for u_data in DEMO_USERS:
        if u_data["role"] == "admin":
            continue
        initial_temp = "InitialTemp1234!"
        if u_data["email"] not in user_by_email:
            code, created_user = client.req("POST", "/api/v1/users", {
                "name": u_data["name"],
                "email": u_data["email"],
                "password": initial_temp,
                "role": u_data["role"]
            })
            if code == 201:
                print(f"  [OK] Created user: {u_data['email']} ({u_data['role']})")
                # Rotate first-login password to official demo password
                u_client = Client()
                u_code, _ = u_client.req("POST", "/api/v1/auth/login", {
                    "email": u_data["email"],
                    "password": initial_temp
                })
                if u_code == 200:
                    u_client.req("POST", "/api/v1/auth/change-password", {
                        "current_password": initial_temp,
                        "new_password": u_data["password"]
                    })
                    print(f"    - Completed initial password rotation for {u_data['email']}")
            else:
                print(f"  Warning: failed to create user {u_data['email']}: HTTP {code} {created_user}")
        else:
            print(f"  - User {u_data['email']} already exists, verifying password rotation...")
            # If user was created previously but still has must_change_password:
            u_client = Client()
            u_code, u_resp = u_client.req("POST", "/api/v1/auth/login", {
                "email": u_data["email"],
                "password": u_data["password"]
            })
            if u_code == 200 and u_resp and u_resp.get("user", {}).get("must_change_password"):
                # Rotate through a temp password and back
                u_client.req("POST", "/api/v1/auth/change-password", {
                    "current_password": u_data["password"],
                    "new_password": u_data["password"] + "Rotated"
                })
                u_client.req("POST", "/api/v1/auth/change-password", {
                    "current_password": u_data["password"] + "Rotated",
                    "new_password": u_data["password"]
                })
                print(f"    - Cleared must_change_password for existing {u_data['email']}")

    # 4. Work Methods
    print("[4/5] Checking Work Methods...")
    eng_cred = next(u for u in DEMO_USERS if u["role"] == "engineer")
    eng_client = Client()
    eng_client.req("POST", "/api/v1/auth/login", {"email": eng_cred["email"], "password": eng_cred["password"]})

    code, methods = eng_client.req("GET", "/api/v1/work-methods")
    method_id = None
    if methods:
        method_id = methods[0]["id"]
        print(f"  - Work method already exists: '{methods[0]['name']}'")
    else:
        code, created_method = eng_client.req("POST", "/api/v1/work-methods", DEMO_WORK_METHOD)
        if code == 201:
            method_id = created_method["id"]
            print(f"  [OK] Authored work method: '{created_method['name']}'")
        else:
            print(f"  Warning: failed to create work method: HTTP {code} {created_method}")

    # 5. Demonstration Incidents
    print("[5/5] Creating Workflow Demonstration Incidents...")
    worker_cred = next(u for u in DEMO_USERS if u["role"] == "worker")
    supervisor_cred = next(u for u in DEMO_USERS if u["role"] == "supervisor")

    worker_client = Client()
    worker_client.req("POST", "/api/v1/auth/login", {"email": worker_cred["email"], "password": worker_cred["password"]})
    sup_client = Client()
    sup_client.req("POST", "/api/v1/auth/login", {"email": supervisor_cred["email"], "password": supervisor_cred["password"]})

    code, existing_incidents = worker_client.req("GET", "/api/v1/incidents")
    if existing_incidents and len(existing_incidents) >= 3:
        print("  - Incidents already exist in the system.")
    else:
        # Incident 1: Needs Clarification (on PUMP-HYD-02)
        pump_asset = asset_by_code.get("PUMP-HYD-02")
        if pump_asset:
            code, inc1 = worker_client.req("POST", "/api/v1/incidents", {
                "asset_id": pump_asset["id"],
                "description": "Observed significant hydraulic fluid pooling beneath manifold block B. Continuous hissing sound near the pressure regulator valve. Pump was left running during report.",
                "impact": "Primary line speed reduced by 30% due to intermittent pressure fluctuations.",
                "injury_status": "none",
                "safe_state": "running",
                "measurements": "Temperature: 68 C; Line pressure fluctuating between 140-180 bar."
            })
            if code == 201:
                # Engineer analyzes -> status becomes needs_clarification
                eng_client.req("POST", f"/api/v1/incidents/{inc1['id']}/actions", {
                    "action": "analyze",
                    "version": inc1["version"]
                })
                print(f"  [OK] Incident 1 created: {inc1['number']} (Status: needs_clarification)")

        # Incident 2: Approved / Execution (on CNC-MILL-04)
        cnc_asset = asset_by_code.get("CNC-MILL-04")
        if cnc_asset:
            code, inc2 = worker_client.req("POST", "/api/v1/incidents", {
                "asset_id": cnc_asset["id"],
                "description": "High-frequency vibration and audible chatter during Z-axis roughing pass on titanium workpieces. Spindle bearing temperature elevated after 20 minutes of continuous runtime.",
                "impact": "Finish tolerances approaching upper limit (+0.015mm). Production paused on machining cell B.",
                "injury_status": "none",
                "safe_state": "stopped",
                "measurements": "Vibration RMS: 4.2 mm/s (threshold < 1.8 mm/s); Spindle bearing temp: 54 C."
            })
            if code == 201:
                eng_client.req("POST", f"/api/v1/incidents/{inc2['id']}/actions", {
                    "action": "analyze",
                    "version": inc2["version"]
                })
                code_get, inc2_current = eng_client.req("GET", f"/api/v1/incidents/{inc2['id']}")
                eng_client.req("POST", f"/api/v1/incidents/{inc2['id']}/actions", {
                    "action": "approve",
                    "version": inc2_current["version"],
                    "note": "Work authorized per maintenance protocol. Work method attached. Ensure spindle isolation is confirmed before opening cover.",
                    "review_confirmed": True,
                    "work_method_id": method_id
                })
                print(f"  [OK] Incident 2 created: {inc2['number']} (Status: approved)")

        # Incident 3: Resolved & Verified (on CONV-LINE-01)
        conv_asset = asset_by_code.get("CONV-LINE-01")
        if conv_asset:
            code, inc3 = worker_client.req("POST", "/api/v1/incidents", {
                "asset_id": conv_asset["id"],
                "description": "Optical tracking sensor photoelectric lens accumulated dust and sustained angular misalignment, causing false jam interrupts at the transfer junction.",
                "impact": "Assembly line conveyor stopped for 14 minutes.",
                "injury_status": "none",
                "safe_state": "stopped",
                "measurements": "Sensor alignment offset: 4.5 mm vertical deviation from reflector center."
            })
            if code == 201:
                # 1. Analyze
                eng_client.req("POST", f"/api/v1/incidents/{inc3['id']}/actions", {"action": "analyze", "version": inc3["version"]})
                _, cur = sup_client.req("GET", f"/api/v1/incidents/{inc3['id']}")
                # 2. Supervisor approves
                sup_client.req("POST", f"/api/v1/incidents/{inc3['id']}/actions", {
                    "action": "approve",
                    "version": cur["version"],
                    "note": "Authorized optical sensor realignment and isopropyl lens cleaning.",
                    "review_confirmed": True,
                    "work_method_id": None
                })
                # 3. Worker starts
                _, cur = worker_client.req("GET", f"/api/v1/incidents/{inc3['id']}")
                worker_client.req("POST", f"/api/v1/incidents/{inc3['id']}/actions", {"action": "start", "version": cur["version"]})
                # 4. Worker completes checklist items
                _, cur = worker_client.req("GET", f"/api/v1/incidents/{inc3['id']}")
                notes = [
                    "Emergency stop button locked out and tagged out at panel CB-04. Zero voltage verified.",
                    "Cleaned transceiver optic with lint-free wipes and alcohol. Re-torqued mounting bracket.",
                    "Cycled 30 consecutive totes across junction. Transceiver response latency measured 12ms."
                ]
                for idx, step in enumerate(cur.get("checklist", [])):
                    _, cur = worker_client.req("PATCH", f"/api/v1/incidents/{inc3['id']}/checklist/{step['id']}", {
                        "completed": True,
                        "notes": notes[idx] if idx < len(notes) else "Step completed.",
                        "version": cur["version"]
                    })
                # 5. Worker submits verification
                worker_client.req("POST", f"/api/v1/incidents/{inc3['id']}/actions", {
                    "action": "submit_verification",
                    "version": cur["version"]
                })
                # 6. Engineer resolves & closes
                _, cur = eng_client.req("GET", f"/api/v1/incidents/{inc3['id']}")
                eng_client.req("POST", f"/api/v1/incidents/{inc3['id']}/actions", {
                    "action": "resolve",
                    "version": cur["version"],
                    "note": "Independently inspected beam alignment on conveyor transfer. 30 test cycles confirmed fault-free operation. Incident closed."
                })
                print(f"  [OK] Incident 3 created: {inc3['number']} (Status: resolved & independently verified)")

    print("\nHTTP Demo Setup Completed Successfully!")
    _print_demo_summary(None)


def _print_demo_summary(db=None):
    """Print readable summary of the generated demo credentials and records."""
    print("\n" + "=" * 65)
    print("           OPSBRIDGE — DEMO ENVIRONMENT CREDENTIALS")
    print("=" * 65)
    print(f" Organization : {DEMO_ORG_NAME}")
    print(f" Site         : {DEMO_SITE_NAME}")
    print("-" * 65)
    print(f" {'Role':<12} | {'Email':<25} | {'Password':<18}")
    print("-" * 65)
    for u in DEMO_USERS:
        print(f" {u['role']:<12} | {u['email']:<25} | {u['password']:<18}")
    print("-" * 65)
    print("\n Registered Assets:")
    for a in DEMO_ASSETS:
        print(f"   [{a['criticality'].upper():<8}] {a['code']:<12} — {a['name']} ({a['area']})")
    print("\n Demonstration Incidents:")
    print("   1. INC-2026-00101 [NEEDS_CLARIFICATION] — PUMP-HYD-02 leak (Rule gap detection)")
    print("   2. INC-2026-00102 [APPROVED / EXECUTION] — CNC-MILL-04 vibration (SOP checklist)")
    print("   3. INC-2026-00103 [RESOLVED & VERIFIED]   — CONV-LINE-01 sensor (Full audit trail)")
    print("=" * 65)
    print("\nNext steps:")
    print("  Open: https://opsbridge-demo.onrender.com or http://127.0.0.1:5173\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed synthetic demo data for OpsBridge")
    parser.add_argument("--reset", action="store_true", help="Cleanly reset and recreate all demo records (local SQLite only)")
    parser.add_argument("--db", type=str, default=None, help="Custom database URL or SQLite path")
    parser.add_argument("--url", type=str, default=None, help="Target running OpsBridge HTTP base URL (e.g. https://opsbridge-demo.onrender.com)")
    args = parser.parse_args()

    if args.url:
        setup_via_http(base_url=args.url)
    else:
        create_demo_data(db_path_or_url=args.db, reset=args.reset)

