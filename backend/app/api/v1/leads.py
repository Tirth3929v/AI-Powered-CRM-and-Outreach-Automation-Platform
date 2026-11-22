"""
Leads and Opportunities Endpoints.
Supports listing with filters, pagination, lead detail drawer view, and atomic claiming.
"""

import json
from typing import Optional, List, Literal
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel
from backend.app.core.db import transaction
from backend.app.core.security import get_current_user
from backend.app.repositories import leads_repo
from backend.app.core.errors import ResourceNotFoundError

router = APIRouter(prefix="/leads", tags=["Leads & Pipeline"])

ADMIN_ASSIGN_ROLES = ["admin", "campaign_manager"]


class ClaimLeadRequest(BaseModel):
    user_id: Optional[str] = None


class LeadSummaryDTO(BaseModel):
    id: str
    organization_name: str
    title: str
    opportunity_type: str
    source_name: str
    source_url: str
    experience_min: Optional[int] = None
    experience_max: Optional[int] = None
    salary_text: Optional[str] = None
    location: Optional[str] = None
    status: str
    score: int
    score_band: str
    assigned_to: Optional[str] = None
    discovered_at: str


class PaginatedLeadsResponse(BaseModel):
    items: List[LeadSummaryDTO]
    total: int
    page: int
    page_size: int
    total_pages: int


# In-memory baseline records for offline/initial state testing
SAMPLE_LEADS = [
    {
        "id": "b0000001-0000-0000-0000-000000000001",
        "organization_name": "Acme AI Systems",
        "title": "Junior Python Developer (0-1 yrs)",
        "opportunity_type": "job",
        "source_name": "Internshala",
        "source_url": "https://internshala.com/job/detail/junior-python-001",
        "experience_min": 0,
        "experience_max": 1,
        "salary_text": "₹6,00,000 - ₹8,00,000 PA",
        "location": "Bengaluru, India",
        "status": "verified",
        "score": 92,
        "score_band": "high",
        "assigned_to": None,
        "discovered_at": "2026-10-16T08:00:00Z"
    },
    {
        "id": "b0000002-0000-0000-0000-000000000002",
        "organization_name": "Beta Cloud Labs",
        "title": "Cloud Backend Intern",
        "opportunity_type": "internship",
        "source_name": "Internshala",
        "source_url": "https://internshala.com/internship/detail/cloud-intern-002",
        "experience_min": 0,
        "experience_max": 0,
        "salary_text": "₹30,000 /month",
        "location": "Remote",
        "status": "draft_ready",
        "score": 88,
        "score_band": "high",
        "assigned_to": None,
        "discovered_at": "2026-10-16T09:15:00Z"
    },
    {
        "id": "b0000003-0000-0000-0000-000000000003",
        "organization_name": "Gamma Data Fintech",
        "title": "Associate Data Analyst (0-2 yrs)",
        "opportunity_type": "job",
        "source_name": "Naukri Freshers",
        "source_url": "https://naukri.com/job/detail/data-analyst-003",
        "experience_min": 0,
        "experience_max": 2,
        "salary_text": "Competitive",
        "location": "Mumbai, India",
        "status": "needs_enrichment",
        "score": 68,
        "score_band": "medium",
        "assigned_to": None,
        "discovered_at": "2026-10-15T14:20:00Z"
    }
]


@router.get("", response_model=PaginatedLeadsResponse)
def list_leads(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    source: Optional[str] = None,
    experience_min: Optional[int] = Query(default=None, ge=0),
    experience_max: Optional[int] = Query(default=None, ge=0),
    score_band: Optional[Literal["high", "medium", "low", "suppressed"]] = None,
    status: Optional[Literal[
        "new", "needs_enrichment", "verified", "draft_ready",
        "approved", "sent", "closed"
    ]] = None,
    assigned_to: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: Literal[
        "discovered_at",
        "score",
        "experience_min",
        "experience_max",
        "organization_name",
        "title",
    ] = "discovered_at",
    sort_order: Literal["asc", "desc"] = "desc",
    current_user: dict = Depends(get_current_user),
):
    """List leads with filters, sorting, and pagination."""

    if (
        experience_min is not None
        and experience_max is not None
        and experience_min > experience_max
    ):
        raise HTTPException(
            status_code=422,
            detail="experience_min cannot be greater than experience_max",
        )

    filters = {
        "source": source,
        "experience_min": experience_min,
        "experience_max": experience_max,
        "score_band": score_band,
        "status": status,
        "assigned_to": assigned_to,
        "search": search,
        "sort_by": sort_by,
        "sort_order": sort_order,
    }

    items, total = leads_repo.list_leads(
        filters=filters,
        page=page,
        page_size=page_size,
    )

    return PaginatedLeadsResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.get("/{id}")
def get_lead_by_id(
    id: str,
    current_user: dict = Depends(get_current_user),
):
    """Retrieve complete details for a specific lead."""

    lead = leads_repo.get_lead_by_id(lead_id=id)

    if lead is None:
        raise ResourceNotFoundError(
            resource="Lead",
            identifier=id,
        )

    return lead


@router.post("/{id}/claim")
def claim_lead(
    id: str,
    payload: ClaimLeadRequest = ClaimLeadRequest(),
    current_user: dict = Depends(get_current_user)
):
    
    target_user_id = payload.user_id or current_user["id"]

    if payload.user_id and payload.user_id != current_user["id"]:
        if current_user.get("role") not in ADMIN_ASSIGN_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins and campaign managers may assign leads to another user"
            )

    with transaction() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE opportunities
                SET assigned_to = %s, claimed_at = NOW()
                WHERE id = %s AND assigned_to IS NULL
                RETURNING id, assigned_to, claimed_at, status;
                """,
                (target_user_id, id)
            )
            updated = cur.fetchone()

            if updated is None:
                cur.execute("SELECT assigned_to FROM opportunities WHERE id = %s;", (id,))
                existing = cur.fetchone()
                if existing is None:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Lead with id '{id}' not found"
                    )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Lead has already been claimed by another team member"
                )

            columns = [desc[0] for desc in cur.description]
            lead_row = dict(zip(columns, updated))

            cur.execute(
                """
                INSERT INTO audit_logs (actor, action, entity_type, entity_id, details)
                VALUES (%s, %s, %s, %s, %s);
                """,
                (
                    current_user["id"],
                    "lead_claimed",
                    "opportunity",
                    id,
                    json.dumps({
                        "claimed_by": target_user_id,
                        "assigned_by": current_user["id"],
                        "assigned_by_role": current_user.get("role")
                    })
                )
            )

    return {
        "id": str(lead_row["id"]),
        "assigned_to": str(lead_row["assigned_to"]),
        "claimed_at": lead_row["claimed_at"].isoformat(),
        "status": lead_row["status"]
    }
