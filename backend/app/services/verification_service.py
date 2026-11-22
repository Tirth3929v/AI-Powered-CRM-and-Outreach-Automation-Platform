"""
Lead contact email verification service.
"""

from datetime import datetime, timezone
from typing import Any, Dict

from psycopg.types.json import Jsonb

from backend.app.core.db import transaction
from backend.app.repositories.leads_repo import get_lead_by_id
from backend.app.integrations.email_verifier import EmailVerifierClient


class LeadNotFoundError(Exception):
    pass


class EmailNotFoundError(Exception):
    pass


def verify_lead_contact_email(lead_id: str) -> Dict[str, Any]:
    """Verify the first available email method associated with a lead."""

    lead = get_lead_by_id(lead_id)

    if not lead:
        raise LeadNotFoundError("Lead not found.")

    email_method = None

    for contact in lead.get("contacts") or []:
        for method in contact.get("methods") or []:
            if method.get("kind") == "email" and method.get("value"):
                email_method = method
                break
        if email_method:
            break

    if not email_method:
        raise EmailNotFoundError("No email address found for this lead.")

    verifier = EmailVerifierClient()
    verification = verifier.verify(email_method["value"])

    allowed_results = {
        "deliverable",
        "undeliverable",
        "catch_all",
        "risky",
        "unknown",
        "failed",
    }

    result = verification.get("result", "unknown")

    if result not in allowed_results:
        result = "unknown"

    raw_response = verification.get("raw_response", {})
    if not isinstance(raw_response, dict):
        raw_response = {"response": str(raw_response)}

    with transaction() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE contact_methods
                SET verified_status = %s,
                    verified_at = NOW()
                WHERE id = %s
                RETURNING verified_at
                """,
                (result, email_method["id"]),
            )

            updated = cur.fetchone()
            if updated is None:
                raise EmailNotFoundError(
                    "Email contact method no longer exists."
                )

            checked_at = updated[0]

            cur.execute(
                """
                INSERT INTO verification_results (
                    contact_method_id,
                    result,
                    raw_response,
                    checked_at
                )
                VALUES (%s, %s, %s, %s)
                """,
                (
                    email_method["id"],
                    result,
                    Jsonb(raw_response),
                    checked_at,
                ),
            )

    return {
        "status": "completed",
        "result": result,
        "checked_at": checked_at.isoformat(),
    }
