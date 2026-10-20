"""Create synthetic OpsBridge data through the public API.

This script is intentionally explicit: credentials are supplied at runtime and
no demo passwords or private data are committed to the repository.
"""
from __future__ import annotations

import argparse
import json
import secrets
import urllib.error
import urllib.request
import uuid
from typing import Any, cast


def request(base: str, method: str, path: str, payload: dict | None = None, cookie: str | None = None) -> tuple[dict[str, Any], str | None]:
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if body else {}
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(base.rstrip("/") + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            raw_cookie = response.headers.get("Set-Cookie", "")
            value = json.loads(response.read().decode()) if response.length != 0 else None
            return cast(dict[str, Any], value), raw_cookie.split(";", 1)[0] if raw_cookie else cookie
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Populate a synthetic OpsBridge workspace")
    parser.add_argument("--base-url", required=True, help="For example https://opsbridge-demo.onrender.com")
    parser.add_argument("--admin-email", required=True)
    parser.add_argument("--admin-password", required=True)
    parser.add_argument("--admin-name", default="Demo Administrator")
    parser.add_argument("--reset-not-supported", action="store_true", help="Make the non-destructive behavior explicit")
    args = parser.parse_args()
    if not args.reset_not_supported:
        print("This script is additive and does not delete existing records.")

    base = args.base_url.rstrip("/")
    try:
        setup, cookie = request(base, "POST", "/api/v1/setup", {
            "organization_name": "Northstar Manufacturing Demo",
            "site_name": "Acceptance Plant",
            "name": args.admin_name,
            "email": args.admin_email,
            "password": args.admin_password,
        })
    except SystemExit:
        setup, cookie = request(base, "POST", "/api/v1/auth/login", {"email": args.admin_email, "password": args.admin_password})
    user = setup["user"]

    asset, _ = request(base, "POST", "/api/v1/assets", {
        "code": "PRESS-07", "name": "Hydraulic Press", "area": "Production Bay 1",
        "criticality": "high", "manufacturer": "Demo Machines", "model": "HM-200",
    }, cookie)
    password = secrets.token_urlsafe(16) + "A1!"
    worker, _ = request(base, "POST", "/api/v1/users", {
        "name": "Demo Worker", "email": "worker.demo@example.test", "password": password, "role": "worker",
    }, cookie)
    engineer_password = secrets.token_urlsafe(16) + "A1!"
    engineer, _ = request(base, "POST", "/api/v1/users", {
        "name": "Demo Engineer", "email": "engineer.demo@example.test", "password": engineer_password, "role": "engineer",
    }, cookie)

    incident, _ = request(base, "POST", "/api/v1/incidents", {
        "asset_id": asset["id"],
        "description": "Protective alarm stopped the press during a synthetic acceptance test.",
        "impact": "Demo line stopped; duration is not yet established.",
        "injury_status": "none",
        "safe_state": "isolated",
        "measurements": "Panel alarm X7 was displayed; this is a worker-entered observation.",
        "client_id": str(uuid.uuid4()),
    }, cookie)

    print(json.dumps({
        "organization": user.get("organization_name"),
        "site": user.get("site_name"),
        "asset": asset["code"],
        "incident": incident["number"],
        "worker_email": worker["email"],
        "worker_password": password,
        "engineer_email": engineer["email"],
        "engineer_password": engineer_password,
        "warning": "Synthetic credentials are printed once. Store or delete them securely after the demo.",
    }, indent=2))


if __name__ == "__main__":
    main()
