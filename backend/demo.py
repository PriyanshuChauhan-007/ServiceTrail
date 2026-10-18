"""Demo environment seeder for OpsBridge.

Creates realistic industrial demonstration data for recruiters and evaluators:
- Organization: Apex Precision Dynamics
- Site: Plant Alpha - Machining Cell
- 4 Role-based Accounts:
  * Field Technician:    worker@apex.local      / WorkerPass1234!
  * Lead Engineer:       engineer@apex.local    / EngineerPass1234!
  * Operations Sup.:     supervisor@apex.local  / SupervisorPass1234!
  * Site Administrator:  admin@apex.local       / AdminPass1234!
- 3 Industrial Assets: CNC-MILL-04, PUMP-HYD-02, CONV-LINE-01
- 1 Approved Work Method (SOP)
- 3 Realistic Incidents spanning key workflow states:
  * INC-2026-00101: needs_clarification (Rule analysis flagged unsafe running state)
  * INC-2026-00102: approved (Spindle vibration, checklist released for execution)
  * INC-2026-00103: resolved (Sensor alignment, executed and independently verified)
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from .database import (AdminAudit, Asset, AuditEvent, AuthSession, Incident,
                       Organization, SetupLock, Site, User, WorkMethod, now, uid)
from .security import hash_password
from .services import analyze, assess

logger = logging.getLogger("opsbridge.demo")

DEMO_ORG_NAME = "Apex Precision Dynamics"
DEMO_SITE_NAME = "Plant Alpha - Machining Cell"

DEMO_USERS = [
    {
        "name": "Marcus Vance",
        "email": "worker@apex.local",
        "role": "worker",
        "password": "WorkerPass1234!",
    },
    {
        "name": "Sarah Lin",
        "email": "engineer@apex.local",
        "role": "engineer",
        "password": "EngineerPass1234!",
    },
    {
        "name": "Elena Rostova",
        "email": "supervisor@apex.local",
        "role": "supervisor",
        "password": "SupervisorPass1234!",
    },
    {
        "name": "Priyanshu Chauhan",
        "email": "admin@apex.local",
        "role": "admin",
        "password": "AdminPass1234!",
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


def seed_demo_data(sessions: sessionmaker, reset: bool = False) -> bool:
    """Seed the database with pre-configured demo data if uninitialized or reset requested.
    
    Returns True if data was seeded, False if already setup.
    """
    with sessions() as db:
        lock = db.get(SetupLock, 1)
        if lock and lock.completed and not reset:
            return False

        if reset:
            # Clear existing data in foreign-key safe order
            db.execute(delete(AuthSession))
            db.execute(delete(Incident))
            db.execute(delete(WorkMethod))
            db.execute(delete(Asset))
            db.execute(delete(User))
            db.execute(delete(AdminAudit))
            db.execute(delete(Site))
            db.execute(delete(Organization))
            db.flush()

        # 1. Organization & Site
        org = Organization(id=uid(), name=DEMO_ORG_NAME)
        site = Site(id=uid(), organization_id=org.id, name=DEMO_SITE_NAME)
        db.add(org)
        db.add(site)
        db.flush()

        # 2. Users
        user_map: dict[str, User] = {}
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
                must_change_password=False,
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

        # 3. Assets
        asset_map: dict[str, Asset] = {}
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

        # 4. Work Method
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

        # 5. Incidents
        worker_user = user_map["worker"]
        engineer_user = user_map["engineer"]
        supervisor_user = user_map["supervisor"]

        # Incident 1: Needs Clarification
        inc1_report = {
            "asset_id": asset_map["PUMP-HYD-02"].id,
            "description": "Observed significant hydraulic fluid pooling beneath manifold block B. Continuous hissing sound near the pressure regulator valve. Pump was left running during report.",
            "impact": "Primary line speed reduced by 30% due to intermittent pressure fluctuations.",
            "injury_status": "none",
            "safe_state": "running",
            "measurements": "Temperature: 68 C; Line pressure fluctuating between 140-180 bar.",
        }
        inc1_fingerprint = hashlib.sha256(json.dumps(inc1_report, sort_keys=True).encode()).hexdigest()
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

        # Incident 3: Resolved & Independently Verified
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

        # Complete setup lock
        if not lock:
            db.add(SetupLock(id=1, completed=True))
        else:
            lock.completed = True

        db.commit()
        return True
