
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.app.core.security import require_roles
from backend.app.services.enrichment_service import enrich_lead


router = APIRouter(prefix="/leads", tags=["Enrichment"])


class EnrichRequest(BaseModel):
    provider: str
    confirmed_credits: int = Field(ge=0)


@router.post("/{id}/enrich")
def enrich_contact(
    id: str,
    payload: EnrichRequest,
    current_user: dict = Depends(
        require_roles(["admin", "researcher"])
    )
):
    try:
        lead_id = int(id)

        result = enrich_lead(
            lead_id=lead_id,
            lead={"id": lead_id},
            provider=payload.provider,
            confirmed_credits=payload.confirmed_credits
        )

        return {
            "status": "success",
            **result
        }

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e)
        )

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Enrichment failed"
        )
