"""
Email Deliverability Verification Router.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from backend.app.core.security import require_roles
from backend.app.services.verification_service import (
    EmailNotFoundError,
    LeadNotFoundError,
    verify_lead_contact_email,
)

router = APIRouter(prefix="/leads", tags=["Verification"])


@router.post("/{id}/verify")
def verify_contact_email(
    id: str,
    current_user: dict = Depends(
        require_roles(["admin", "researcher"])
    ),
):
    """Triggers deliverability verification on lead contact email."""

    try:
        return verify_lead_contact_email(id)

    except LeadNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    except EmailNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    except NotImplementedError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Real email verification provider is not configured.",
        ) from exc
