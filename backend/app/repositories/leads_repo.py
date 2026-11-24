"""
Leads & Opportunities Repository.
Direct parameterised SQL access via psycopg3.
STRICTLY NO ORM.
"""

from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from psycopg.types.json import Jsonb

from backend.app.core.db import get_conn


SORT_COLUMNS = {
    "discovered_at": "o.discovered_at",
    "score": "COALESCE(dqs.score, 0)",
    "experience_min": "o.experience_min",
    "experience_max": "o.experience_max",
    "organization_name": "org.name",
    "title": "o.title",
}

SORT_ORDERS = {
    "asc": "ASC",
    "desc": "DESC",
}


def list_leads(
    filters: Optional[Dict[str, Any]] = None,
    page: int = 1,
    page_size: int = 25,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Return filtered, paginated leads and the total number of matches.

    Supported filters:
        source / source_id
        status
        score_band / band
        experience_min
        experience_max
        assigned_to
        search
    """

    filters = filters or {}

    page = max(1, page)
    page_size = max(1, min(page_size, 100))
    offset = (page - 1) * page_size
    sort_by = filters.get("sort_by", "discovered_at")
    sort_order = filters.get("sort_order", "desc")
    sort_column = SORT_COLUMNS.get(sort_by, "o.discovered_at")
    sort_direction = SORT_ORDERS.get(sort_order, "DESC")
    source = filters.get("source", filters.get("source_id"))
    status = filters.get("status")
    band = filters.get("score_band", filters.get("band"))
    experience_min = filters.get("experience_min")
    experience_max = filters.get("experience_max")
    assigned_to = filters.get("assigned_to")

    search_term = filters.get("search")
    search_pattern = (
        f"%{search_term.strip()}%"
        if isinstance(search_term, str) and search_term.strip()
        else None
    )

    where_params = (
        source, source,
        status, status,
        band, band,
        experience_min, experience_min,
        experience_max, experience_max,
        assigned_to, assigned_to,
        search_pattern, search_pattern, search_pattern,
    )

    query = f"""
        SELECT
            o.id,
            org.name AS organization_name,
            o.title,
            o.type AS opportunity_type,
            s.name AS source_name,
            o.source_url,
            o.experience_min,
            o.experience_max,
            o.salary_text,
            o.location,
            o.status,
            COALESCE(dqs.score, 0) AS score,
            COALESCE(dqs.band, 'low') AS score_band,
            u.full_name AS assigned_user_name,
            o.assigned_to,
            o.discovered_at,
            o.published_at
        FROM opportunities AS o
        JOIN organizations AS org
            ON org.id = o.organization_id
        JOIN sources AS s
            ON s.id = o.source_id
        LEFT JOIN users AS u
            ON u.id = o.assigned_to
        LEFT JOIN LATERAL (
            SELECT score, band
            FROM data_quality_scores
            WHERE opportunity_id = o.id
            ORDER BY scored_at DESC, id DESC
            LIMIT 1
        ) AS dqs ON TRUE
        WHERE
            (%s::varchar IS NULL OR o.source_id = %s)
            AND (%s::varchar IS NULL OR o.status = %s)
            AND (%s::varchar IS NULL OR dqs.band = %s)
            AND (%s::integer IS NULL OR o.experience_max >= %s)
            AND (%s::integer IS NULL OR o.experience_min <= %s)
            AND (%s::uuid IS NULL OR o.assigned_to = %s)
            AND (
                %s::text IS NULL
                OR o.title ILIKE %s
                OR org.name ILIKE %s
            )
        ORDER BY {sort_column} {sort_direction}, o.id ASC
        LIMIT %s OFFSET %s
    """

    count_query = """
        SELECT COUNT(*)
        FROM opportunities AS o
        JOIN organizations AS org
            ON org.id = o.organization_id
        LEFT JOIN LATERAL (
            SELECT band
            FROM data_quality_scores
            WHERE opportunity_id = o.id
            ORDER BY scored_at DESC, id DESC
            LIMIT 1
        ) AS dqs ON TRUE
        WHERE
            (%s::varchar IS NULL OR o.source_id = %s)
            AND (%s::varchar IS NULL OR o.status = %s)
            AND (%s::varchar IS NULL OR dqs.band = %s)
            AND (%s::integer IS NULL OR o.experience_max >= %s)
            AND (%s::integer IS NULL OR o.experience_min <= %s)
            AND (%s::uuid IS NULL OR o.assigned_to = %s)
            AND (
                %s::text IS NULL
                OR o.title ILIKE %s
                OR org.name ILIKE %s
            )
    """

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(count_query, where_params)
            total = cur.fetchone()[0]

            cur.execute(
                query,
                where_params + (page_size, offset),
            )

            columns = [column.name for column in cur.description]
            rows = [
                dict(zip(columns, row))
                for row in cur.fetchall()
            ]

    return rows, total


def list_leads_raw_sql(
    source_id: Optional[str] = None,
    status: Optional[str] = None,
    band: Optional[str] = None,
    max_experience: Optional[int] = None,
    search_term: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Backward-compatible wrapper for the original listing function.
    """

    return list_leads(
        filters={
            "source_id": source_id,
            "status": status,
            "band": band,
            "experience_max": max_experience,
            "search": search_term,
        },
        page=page,
        page_size=page_size,
    )


def get_lead_by_id(lead_id: str) -> Optional[Dict[str, Any]]:
    """
    Return a lead with organization, source, latest quality score,
    associated contacts, and contact methods.

    Return None if the ID is invalid or the lead does not exist.
    """

    try:
        parsed_id = UUID(str(lead_id))
    except (ValueError, TypeError, AttributeError):
        return None

    query = """
        SELECT
            o.id,
            org.name AS organization_name,
            o.title,
            o.type AS opportunity_type,
            s.name AS source_name,
            o.source_url,
            o.experience_min,
            o.experience_max,
            o.salary_text,
            o.location,
            o.status,
            o.assigned_to,
            COALESCE(dqs.score, 0) AS score,
            COALESCE(dqs.band, 'low') AS score_band,
            COALESCE(dqs.reasons, '[]'::jsonb) AS score_reasons,
            COALESCE(
                dqs.factor_breakdown,
                '{}'::jsonb
            ) AS factor_breakdown,
            o.description,
            o.published_at,
            o.discovered_at,
            COALESCE(
                contact_data.contacts,
                '[]'::jsonb
            ) AS contacts
        FROM opportunities AS o
        JOIN organizations AS org
            ON org.id = o.organization_id
        JOIN sources AS s
            ON s.id = o.source_id
        LEFT JOIN LATERAL (
            SELECT
                score,
                band,
                reasons,
                factor_breakdown
            FROM data_quality_scores
            WHERE opportunity_id = o.id
            ORDER BY scored_at DESC, id DESC
            LIMIT 1
        ) AS dqs ON TRUE
        LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', c.id,
                    'name', c.name,
                    'role_title', c.role_title,
                    'methods',
                    COALESCE(method_data.methods, '[]'::jsonb)
                )
                ORDER BY c.name, c.id
            ) AS contacts
            FROM opportunity_contacts AS oc
            JOIN contacts AS c
                ON c.id = oc.contact_id
            LEFT JOIN LATERAL (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', cm.id,
                        'kind', cm.kind,
                        'value', cm.value,
                        'verified_status', cm.verified_status,
                        'verified_at', cm.verified_at
                    )
                    ORDER BY cm.kind, cm.id
                ) AS methods
                FROM contact_methods AS cm
                WHERE cm.contact_id = c.id
            ) AS method_data ON TRUE
            WHERE oc.opportunity_id = o.id
        ) AS contact_data ON TRUE
        WHERE o.id = %s
    """

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (parsed_id,))
            row = cur.fetchone()

            if row is None:
                return None

            columns = [column.name for column in cur.description]
            return dict(zip(columns, row))


def upsert_lead(record: Dict[str, Any]) -> Dict[str, Any]:
    """
    Insert a new lead or update an existing lead identified by
    (source_id, source_identifier).

    Returns the inserted or updated opportunity.
    """

    query = """
        INSERT INTO opportunities (
            organization_id,
            type,
            title,
            description,
            experience_min,
            experience_max,
            salary_text,
            location,
            source_id,
            source_url,
            source_identifier,
            published_at,
            extraction_details,
            source_confidence,
            status,
            assigned_to
        )
        VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (source_id, source_identifier)
        DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            type = EXCLUDED.type,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            experience_min = EXCLUDED.experience_min,
            experience_max = EXCLUDED.experience_max,
            salary_text = EXCLUDED.salary_text,
            location = EXCLUDED.location,
            source_url = EXCLUDED.source_url,
            published_at = EXCLUDED.published_at,
            extraction_details = EXCLUDED.extraction_details,
            source_confidence = EXCLUDED.source_confidence,
            updated_at = NOW()
        RETURNING *
    """

    params = (
        record["organization_id"],
        record.get("type", record.get("opportunity_type", "job")),
        record["title"],
        record.get("description"),
        record.get("experience_min"),
        record.get("experience_max"),
        record.get("salary_text"),
        record.get("location"),
        record["source_id"],
        record["source_url"],
        record["source_identifier"],
        record.get("published_at"),
        Jsonb(record.get("extraction_details") or {}),
        record.get("source_confidence", 100),
        record.get("status", "new"),
        record.get("assigned_to"),
    )

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            columns = [column.name for column in cur.description]
            return dict(zip(columns, cur.fetchone()))