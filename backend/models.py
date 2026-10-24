"""Strict public input schemas. Identity and workflow state are never client supplied."""
from typing import Literal
from uuid import UUID
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["worker", "engineer", "supervisor", "admin"]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Credentials(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)

    @field_validator("email")
    @classmethod
    def email_address(cls, value: str) -> str:
        import re
        value = value.strip()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("A valid email address is required")
        return value.casefold()

    @field_validator("password", mode="before")
    @classmethod
    def preserve_password(cls, value):
        # Passwords are opaque, including leading/trailing whitespace.
        return value


class Login(Credentials):
    otp: str | None = Field(None, max_length=16)
    recovery_code: str | None = Field(None, max_length=100)


class NewUser(Credentials):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    name: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=12, max_length=1024)
    role: Role

    @field_validator("name")
    @classmethod
    def name_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be blank")
        return value.strip()


class Setup(NewUser):
    organization_name: str = Field(min_length=1, max_length=160)
    site_name: str = Field(min_length=1, max_length=160)
    role: Literal["admin"] = "admin"

    @field_validator("organization_name", "site_name")
    @classmethod
    def required_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be blank")
        return value.strip()


class WorkspaceRegistration(Credentials):
    """Public self-service creation of a new personal workspace."""
    organization_name: str = Field(min_length=1, max_length=160)
    site_name: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=12, max_length=1024)

    @field_validator("name", "organization_name", "site_name")
    @classmethod
    def required_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be blank")
        return value.strip()


class AssetInput(Input):
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    area: str = Field(min_length=1, max_length=160)
    criticality: Literal["low", "medium", "high", "critical"]
    manufacturer: str | None = Field(None, max_length=160)
    model: str | None = Field(None, max_length=160)


class CustomerInput(Input):
    name: str = Field(min_length=1, max_length=160)
    phone: str = Field(default="", max_length=80)
    email: str = Field(default="", max_length=254)
    address: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=10000)


class ServiceJobInput(Input):
    customer_id: str = Field(min_length=1, max_length=36)
    asset_id: str | None = Field(None, max_length=36)
    request: str = Field(min_length=1, max_length=20000)
    assigned_to_id: str | None = Field(None, max_length=36)
    scheduled_at: datetime | None = None


class Report(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    asset_id: str = Field(min_length=1, max_length=36)
    description: str = Field(min_length=1, max_length=20000)
    impact: str = Field(max_length=10000)
    injury_status: Literal["none", "reported", "unknown"]
    safe_state: Literal["isolated", "stopped", "running", "unknown"]
    measurements: str = Field(default="", max_length=10000)

    @field_validator("description")
    @classmethod
    def nonblank_observation(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Description cannot be blank")
        return value


class CreateReport(Report):
    client_id: UUID | None = None


class EditReport(Report):
    version: int = Field(ge=1)


class Action(Input):
    action: Literal["analyze", "request_changes", "approve", "start", "submit_verification", "resolve", "reopen", "cancel", "assign", "schedule"]
    version: int = Field(ge=1)
    note: str | None = Field(None, max_length=10000)
    review_confirmed: bool = False
    assigned_to: str | None = Field(None, max_length=36)
    work_method_id: str | None = Field(None, max_length=36)
    due_at: datetime | None = None

    @field_validator("due_at", mode="before")
    @classmethod
    def iso_due(cls, value):
        if value is not None and (not isinstance(value, str) or "T" not in value.upper()):
            raise ValueError("Use an ISO timestamp with a timezone")
        return value

    @field_validator("due_at")
    @classmethod
    def aware_due(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("Timezone required")
        return value.astimezone(timezone.utc) if value else value


class ChecklistUpdate(Input):
    completed: bool
    notes: str = Field(default="", max_length=10000)
    version: int = Field(ge=1)


class PasswordProof(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    password: str = Field(min_length=1, max_length=1024)


class OTP(Input):
    otp: str = Field(min_length=6, max_length=16)


class DisableMFA(PasswordProof):
    otp: str = Field(min_length=6, max_length=16)


class ChangePassword(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=12, max_length=1024)
    otp: str | None = Field(None, max_length=16)


class ResetPassword(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    token: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=1024)


class UserUpdate(Input):
    active: bool | None = None
    role: Role | None = None


class NamedInput(Input):
    name: str = Field(min_length=1, max_length=160)


class SwitchSite(Input):
    site_id: str = Field(min_length=1, max_length=36)


class SwitchPerspective(Input):
    perspective: Literal["worker", "engineer", "supervisor", "admin"]


class OpenWorkspace(Input):
    pass


class MethodStep(Input):
    label: str = Field(min_length=1, max_length=1000)
    required: bool = True


class MethodInput(NamedInput):
    description: str = Field(default="", max_length=10000)
    steps: list[MethodStep] = Field(min_length=1, max_length=100)


class ObservationInput(Input):
    asset_code: str = Field(min_length=1, max_length=80)
    external_id: str = Field(min_length=1, max_length=160)
    observed_at: datetime
    measurements: dict

    @field_validator("observed_at", mode="before")
    @classmethod
    def iso_observation(cls, value):
        if not isinstance(value, str) or "T" not in value.upper():
            raise ValueError("Use an ISO timestamp with a timezone")
        return value

    @field_validator("measurements")
    @classmethod
    def finite_json(cls, value):
        import json
        try:
            json.dumps(value, allow_nan=False)
        except (ValueError, TypeError) as exc:
            raise ValueError("Measurements must contain finite JSON values") from exc
        return value

    @field_validator("observed_at")
    @classmethod
    def aware_observation(cls, value):
        if value.tzinfo is None:
            raise ValueError("Timezone required")
        return value.astimezone(timezone.utc)
