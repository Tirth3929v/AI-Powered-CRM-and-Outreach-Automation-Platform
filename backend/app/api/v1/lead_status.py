"""BE-27: Authenticated lead status lookup and atomic lifecycle updates."""

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, field_validator

from backend.app.core.db import transaction
from backend.app.core.security import get_current_user
from backend.app.services.lead_lifecycle import (
    ALLOWED_TRANSITIONS,
    SUPPORTED_STATUSES,
    is_valid_transition,
)

router = APIRouter(prefix="/leads", tags=["Leads & Pipeline"])


class StatusUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        if value not in SUPPORTED_STATUSES:
            raise ValueError(
                "Unsupported status. Allowed: " + ", ".join(sorted(SUPPORTED_STATUSES))
            )
        return value


def parse_lead_id(lead_id: str) -> UUID:
    try:
        return UUID(lead_id)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=404, detail="Lead not found") from exc


@router.get("/{id}/status")
def get_lead_status(id: str, current_user: dict = Depends(get_current_user)):
    lead_id = parse_lead_id(id)
    with transaction() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT status FROM opportunities WHERE id = %s", (lead_id,))
            row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"id": str(lead_id), "status": row[0]}


@router.patch("/{id}/status")
def update_lead_status(
    id: str,
    payload: StatusUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    lead_id = parse_lead_id(id)
    with transaction() as conn:
        with conn.cursor() as cur:
            # Lock the record so concurrent requests cannot bypass lifecycle checks.
            cur.execute(
                "SELECT status FROM opportunities WHERE id = %s FOR UPDATE",
                (lead_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="Lead not found")
            previous = row[0]
            if not is_valid_transition(previous, payload.status):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": f"Transition from '{previous}' to '{payload.status}' is not allowed",
                        "current_status": previous,
                        "allowed_next": sorted(ALLOWED_TRANSITIONS.get(previous, ())),
                    },
                )
            if previous == payload.status:
                return {
                    "id": str(lead_id), "previous_status": previous,
                    "status": previous, "changed": False,
                }

            # Do not overwrite title, contact information, assignment or any other fields.
            cur.execute(
                """UPDATE opportunities
                   SET status = %s, updated_at = NOW()
                   WHERE id = %s""",
                (payload.status, lead_id),
            )
            # Audit and status update commit together; a failure rolls back both.
            cur.execute(
                """INSERT INTO audit_logs
                   (actor, action, entity_type, entity_id, details)
                   VALUES (%s, %s, %s, %s, %s::jsonb)""",
                (
                    str(current_user["id"]), "lead_status_changed", "opportunity",
                    str(lead_id),
                    json.dumps({"from": previous, "to": payload.status}),
                ),
            )
    return {
        "id": str(lead_id), "previous_status": previous,
        "status": payload.status, "changed": True,
    }
