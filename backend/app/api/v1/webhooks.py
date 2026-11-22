"""
Ingestion & Provider Webhook Endpoints.
"""

import hmac
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, status
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ValidationError, field_validator

from backend.app.core.config import get_settings
from backend.app.core.db import transaction
from backend.app.services.dedup_service import (
    check_for_duplicates,
    normalize_company_name,
)

router = APIRouter(tags=["Webhooks & Callbacks"])

MAX_BATCH_SIZE = 200
OPP_TYPES = {"job", "startup", "internship", "hackathon", "college"}
ORG_TYPE = {"job": "company", "internship": "company", "startup": "startup",
            "hackathon": "organiser", "college": "college"}


class RawScraperItem(BaseModel):
    source_identifier: str
    source_url: str
    company_name: str
    title: str
    description: Optional[str] = None
    opportunity_type: Optional[str] = "job"
    experience_text: Optional[str] = None
    salary_text: Optional[str] = None
    location: Optional[str] = None
    published_at: Optional[str] = None

    @field_validator("source_identifier", "company_name", "title")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        if len(v) > 255:
            raise ValueError("must be at most 255 characters")
        return v

    @field_validator("source_url")
    @classmethod
    def _http_url(cls, v: str) -> str:
        p = urlparse(v.strip())
        if p.scheme not in ("http", "https") or not p.netloc:
            raise ValueError("must be an absolute http(s) URL")
        return v.strip()

    @field_validator("opportunity_type")
    @classmethod
    def _known_type(cls, v: Optional[str]) -> str:
        v = (v or "job").strip().lower()
        if v not in OPP_TYPES:
            raise ValueError(f"must be one of {sorted(OPP_TYPES)}")
        return v


class ScraperIngestPayload(BaseModel):
    source_id: str
    # Raw dicts so one bad record is rejected alone instead of a 422 for all.
    items: List[Dict[str, Any]]


def require_scraper_secret(
    x_scraper_secret: Optional[str] = Header(None, alias="X-Scraper-Secret"),
) -> None:
    expected = get_settings().SCRAPER_INGEST_SECRET
    if not x_scraper_secret or not hmac.compare_digest(
        x_scraper_secret.encode(), expected.encode()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Scraper-Secret header",
        )


def _validate(raw: Any):
    """Return (item, []) or (None, [reasons])."""
    if not isinstance(raw, dict):
        return None, ["record: must be a JSON object"]
    try:
        item = RawScraperItem.model_validate(raw)
    except ValidationError as exc:
        return None, [
            f"{'.'.join(str(p) for p in e['loc'])}: "
            f"{e['msg'].removeprefix('Value error, ')}"
            for e in exc.errors()
        ]
    if not normalize_company_name(item.company_name):
        return None, ["company_name: empty after normalization"]
    return item, []


@router.post(
    "/webhooks/scraper-ingest",
    dependencies=[Depends(require_scraper_secret)],
)
def scraper_ingest(payload: ScraperIngestPayload):
    """
    Ingests a batch (max 200) of scraped records: validates each record,
    deduplicates, and bulk-upserts organizations + opportunities in one
    transaction. Invalid records are rejected with reasons; the rest proceed.
    """
    if len(payload.items) > MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch exceeds maximum limit of {MAX_BATCH_SIZE} items per request",
        )

    counts = {"inserted": 0, "updated": 0, "skipped": 0, "rejected": 0}
    errors: List[Dict[str, Any]] = []
    source_id = payload.source_id

    # 1. Validate each record on its own; drop repeats inside the batch.
    items, seen_ids, seen_urls = [], set(), set()
    for index, raw in enumerate(payload.items):
        item, reasons = _validate(raw)
        if item is None:
            counts["rejected"] += 1
            ident = raw.get("source_identifier") if isinstance(raw, dict) else None
            errors.append({"index": index, "source_identifier": ident, "reasons": reasons})
        elif item.source_identifier in seen_ids or item.source_url in seen_urls:
            counts["skipped"] += 1
        else:
            seen_ids.add(item.source_identifier)
            seen_urls.add(item.source_url)
            items.append(item)

    # 2. Everything that touches the DB runs in ONE transaction.
    with transaction() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT is_enabled, status FROM sources WHERE id = %s", (source_id,))
        src = cur.fetchone()
        if src is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown source '{source_id}'")
        if not src["is_enabled"] or src["status"] in ("disabled", "quarantined"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Source '{source_id}' is not active")

        # 2a. Dedup: find existing rows by (source_id, identifier) or URL.
        cur.execute(
            """SELECT id, source_id, source_identifier, source_url, title
               FROM opportunities
               WHERE (source_id = %s AND source_identifier = ANY(%s))
                  OR source_url = ANY(%s)""",
            (source_id, [i.source_identifier for i in items],
             [i.source_url for i in items]),
        )
        existing = cur.fetchall()
        by_ident = {r["source_identifier"]: r for r in existing if r["source_id"] == source_id}
        by_url = {r["source_url"]: r for r in existing}

        new_items, updates = [], []
        for item in items:
            candidates = [r for r in (by_ident.get(item.source_identifier),
                                      by_url.get(item.source_url)) if r]
            match = check_for_duplicates(
                source_id, item.source_identifier, item.source_url,
                item.company_name, item.title, item.location,
                existing_records=candidates,
            )
            if not match["is_exact_source_match"]:
                new_items.append(item)
            elif candidates[0]["title"] != item.title:
                updates.append((item, candidates[0]["id"]))
            else:
                counts["skipped"] += 1

        # 2b. Organizations: reuse by normalized name, insert the missing ones.
        norm = {i.source_identifier: normalize_company_name(i.company_name) for i in new_items}
        cur.execute(
            """SELECT DISTINCT ON (normalized_name) id, normalized_name
               FROM organizations WHERE normalized_name = ANY(%s)
               ORDER BY normalized_name, created_at""",
            (list(set(norm.values())),),
        )
        org_ids = {r["normalized_name"]: r["id"] for r in cur.fetchall()}
        for item in new_items:
            n = norm[item.source_identifier]
            if n not in org_ids:
                cur.execute(
                    """INSERT INTO organizations (name, normalized_name, type)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (normalized_name, COALESCE(domain, ''))
                       DO UPDATE SET updated_at = organizations.updated_at
                       RETURNING id""",
                    (item.company_name, n, ORG_TYPE[item.opportunity_type]),
                )
                org_ids[n] = cur.fetchone()["id"]

        # 2c. Opportunities: bulk insert new, bulk update changed.
        if new_items:
            cur.executemany(
                """INSERT INTO opportunities
                   (organization_id, type, title, description, salary_text, location,
                    source_id, source_url, source_identifier, published_at,
                    extraction_details)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING""",
                [(org_ids[norm[i.source_identifier]], i.opportunity_type, i.title,
                  i.description, i.salary_text, i.location, source_id, i.source_url,
                  i.source_identifier, i.published_at or None,
                  Jsonb({"experience_text": i.experience_text}))
                 for i in new_items],
            )
            counts["inserted"] = cur.rowcount
            counts["skipped"] += len(new_items) - cur.rowcount
        if updates:
            cur.executemany(
                """UPDATE opportunities SET title = %s, description = COALESCE(%s, description),
                   salary_text = COALESCE(%s, salary_text), location = COALESCE(%s, location),
                   updated_at = (NOW() AT TIME ZONE 'UTC') WHERE id = %s""",
                [(i.title, i.description, i.salary_text, i.location, oid)
                 for i, oid in updates],
            )
            counts["updated"] = len(updates)

    return {**counts, "errors": sorted(errors, key=lambda e: e["index"])}


@router.post("/callbacks")
def provider_callbacks(
    payload: dict,
    x_provider_signature: Optional[str] = Header(None, alias="X-Provider-Signature")
):
    """
    Handles provider callbacks (delivered, reply, bounce, unsubscribe).
    """
    return {"status": "received", "event_id": payload.get("provider_event_id")}
