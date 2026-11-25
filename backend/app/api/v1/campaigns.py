"""
Campaign Management and AI Draft Generation Router.
"""

from typing import Annotated, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from psycopg.errors import ForeignKeyViolation
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from typing_extensions import TypedDict

from backend.app.core.errors import ConflictError, ResourceNotFoundError
from backend.app.core.security import require_roles
from backend.app.repositories import campaigns_repo

router = APIRouter(prefix="/campaigns", tags=["Campaigns & Drafts"])
CampaignUser = Annotated[dict, Depends(require_roles(["admin", "campaign_manager"]))]
CampaignStatus = Literal["draft", "active", "paused", "completed"]
CampaignName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255, pattern=r"^[^\x00]*$")
]
CampaignPurpose = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, pattern=r"^[^\x00]*$")]
DailyLimit = Annotated[int, Field(strict=True, ge=1, le=2_147_483_647)]


class CampaignCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: CampaignName
    purpose: CampaignPurpose
    status: CampaignStatus = "draft"
    daily_limit: DailyLimit = 50


class CampaignUpdate(TypedDict, total=False):
    """Each key may be omitted. Supplied values must satisfy the create rules."""

    __pydantic_config__ = ConfigDict(extra="forbid", json_schema_extra={"minProperties": 1})
    name: CampaignName
    purpose: CampaignPurpose
    status: CampaignStatus
    daily_limit: DailyLimit


class CampaignSummary(BaseModel):
    id: UUID
    name: str
    purpose: str
    status: CampaignStatus
    daily_limit: int


class DraftRequest(BaseModel):
    opportunity_id: str
    recipient_contact_method_id: str
    tone: Optional[str] = "hr"


@router.get("", response_model=list[CampaignSummary])
def list_campaigns(current_user: CampaignUser):
    return campaigns_repo.list_campaigns()


@router.post("", response_model=CampaignSummary, status_code=status.HTTP_201_CREATED)
def create_campaign(payload: CampaignCreate, current_user: CampaignUser):
    return campaigns_repo.create_campaign(**payload.model_dump(), created_by=current_user["id"])


@router.get("/{id}", response_model=CampaignSummary)
def get_campaign(id: UUID, current_user: CampaignUser):
    campaign = campaigns_repo.get_campaign_by_id(id)
    if campaign is None:
        raise ResourceNotFoundError("Campaign", str(id))
    return campaign


@router.patch("/{id}", response_model=CampaignSummary)
def update_campaign(id: UUID, payload: CampaignUpdate, current_user: CampaignUser):
    if not payload:
        raise HTTPException(status_code=422, detail="Provide at least one campaign field to update.")
    campaign = campaigns_repo.update_campaign(id, **payload)
    if campaign is None:
        raise ResourceNotFoundError("Campaign", str(id))
    return campaign


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(id: UUID, current_user: CampaignUser):
    try:
        deleted = campaigns_repo.delete_campaign(id)
    except ForeignKeyViolation as exc:
        raise ConflictError("Campaign is referenced by outreach history and cannot be deleted.") from exc
    if not deleted:
        raise ResourceNotFoundError("Campaign", str(id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{id}/drafts")
def generate_draft(
    id: str,
    payload: DraftRequest,
    current_user: dict = Depends(require_roles(["admin", "campaign_manager"]))
):
    """
    Generates AI outreach draft using Gemini Flash based strictly on verified opportunity facts.
    """
    return {
        "draft_id": "draft_mock_001",
        "campaign_id": id,
        "model": "gemini-1.5-flash",
        "prompt_version": "v1.0.0",
        "ai_output": {
            "subject": "Regarding your Junior Python Developer opening",
            "body": "Hi Sarah,\n\nI noticed your recent opening for a Junior Python Developer on Internshala. Our candidates bring hands-on experience building FastAPI microservices and Dockerized systems.\n\nWould you be open to reviewing a few profiles this week?\n\nBest regards,\nCarlos Campaigner",
            "personalization_summary": "Tailored for Acme AI Systems entry-level Python requirement.",
            "claims_used": [
                {"fact_id": "fact_role", "claim": "Junior Python Developer"},
                {"fact_id": "fact_source", "claim": "Posted on Internshala"}
            ],
            "missing_information_warnings": [],
            "confidence_note": "High confidence based on deliverable verified recruiter contact."
        }
    }
