from typing import Any, Dict, List, Optional
from uuid import UUID

from psycopg.types.json import Jsonb

from backend.app.core.db import transaction

SCORING_VERSION = "1.0.0"

_VALID_VERIFICATION_STATUSES = {
    "deliverable", "undeliverable", "catch_all", "risky", "unknown", "failed",
}


def calculate_data_quality_score(
    source_type: str,
    has_contact_role: bool,
    verification_status: str,
    published_days_ago: Optional[int],
    has_description: bool,
    has_salary: bool,
    has_location: bool,
    is_suppressed: bool = False,
) -> Dict[str, Any]:
    reasons: List[Dict[str, Any]] = []

    if source_type == "official_careers":
        source_score = 25
        reasons.append({"code": "OFFICIAL_COMPANY_SOURCE", "points": 25, "desc": "Official employer website or portal"})
    elif source_type == "verified_portal":
        source_score = 20
        reasons.append({"code": "VERIFIED_PORTAL_SOURCE", "points": 20, "desc": "Curated source (e.g. Internshala, Unstop)"})
    elif source_type == "aggregator":
        source_score = 12
        reasons.append({"code": "AGGREGATOR_SOURCE", "points": 12, "desc": "General jobs aggregator"})
    else:
        source_score = 12
        reasons.append({"code": "UNKNOWN_SOURCE", "points": 12, "desc": "Unrecognised source type, treated as aggregator"})

    if has_contact_role is True:
        assoc_score = 25
        reasons.append({"code": "CONTACT_ROLE_CONFIRMED", "points": 25, "desc": "Contact role confirmed relevant"})
    else:
        assoc_score = 10
        reasons.append({"code": "CONTACT_ROLE_UNCONFIRMED", "points": 10, "desc": "Direct recruiter role not verified"})

    if not isinstance(verification_status, str) or verification_status not in _VALID_VERIFICATION_STATUSES:
        normalized_status = "unknown"
    else:
        normalized_status = verification_status

    if normalized_status == "deliverable":
        verif_score = 20
        reasons.append({"code": "EMAIL_VERIFIED_DELIVERABLE", "points": 20, "desc": "Email verified deliverable"})
    elif normalized_status == "catch_all":
        verif_score = 10
        reasons.append({"code": "EMAIL_CATCH_ALL", "points": 10, "desc": "Domain accepts catch-all mail"})
    elif normalized_status == "risky":
        verif_score = 5
        reasons.append({"code": "EMAIL_RISKY", "points": 5, "desc": "Email flagged risky by verification provider"})
    else:
        verif_score = 0
        reasons.append({"code": "EMAIL_UNVERIFIED", "points": 0, "desc": "Email unverified or undeliverable"})

    days_invalid = (
        published_days_ago is None
        or isinstance(published_days_ago, bool)
        or not isinstance(published_days_ago, int)
        or published_days_ago < 0
    )

    if days_invalid:
        fresh_score = 0
        reasons.append({"code": "DATA_FRESHNESS_UNKNOWN", "points": 0, "desc": "Publication date unavailable or invalid"})
    elif published_days_ago <= 3:
        fresh_score = 15
        reasons.append({"code": "DATA_VERY_FRESH", "points": 15, "desc": "Published within the last 3 days"})
    elif published_days_ago <= 14:
        fresh_score = 10
        reasons.append({"code": "DATA_MODERATELY_FRESH", "points": 10, "desc": "Published within the last 2 weeks"})
    else:
        fresh_score = 5
        reasons.append({"code": "DATA_AGED", "points": 5, "desc": "Published over 14 days ago"})

    comp_score = 0
    if has_description is True:
        comp_score += 7
    if has_salary is True:
        comp_score += 4
    if has_location is True:
        comp_score += 4

    reasons.append({"code": "COMPLETENESS_SCORE", "points": comp_score, "desc": f"Completeness factors score: {comp_score}/15"})

    source_score = max(0, min(25, source_score))
    assoc_score = max(0, min(25, assoc_score))
    verif_score = max(0, min(20, verif_score))
    fresh_score = max(0, min(15, fresh_score))
    comp_score = max(0, min(15, comp_score))

    total_score = min(100, max(0, source_score + assoc_score + verif_score + fresh_score + comp_score))

    if is_suppressed is True:
        band = "suppressed"
    elif total_score >= 80:
        band = "high"
    elif total_score >= 60:
        band = "medium"
    else:
        band = "low"

    return {
        "score": total_score,
        "band": band,
        "is_eligible": band == "high",
        "reasons": reasons,
        "factor_breakdown": {
            "source_reliability": source_score,
            "organization_association": assoc_score,
            "contact_verification": verif_score,
            "data_freshness": fresh_score,
            "completeness": comp_score,
        },
        "scoring_version": SCORING_VERSION,
    }


_VALID_BANDS = {"high", "medium", "low", "suppressed"}
_REQUIRED_BREAKDOWN_KEYS = {
    "source_reliability",
    "organization_association",
    "contact_verification",
    "data_freshness",
    "completeness",
}
_BREAKDOWN_MAXES = {
    "source_reliability": 25,
    "organization_association": 25,
    "contact_verification": 20,
    "data_freshness": 15,
    "completeness": 15,
}


def _validate_score_result(result: Any) -> None:
    if not isinstance(result, dict):
        raise TypeError("result must be a dict")
    for key in ("score", "band", "reasons", "factor_breakdown", "scoring_version"):
        if key not in result:
            raise ValueError(f"result is missing required key: {key!r}")
    score = result["score"]
    if isinstance(score, bool) or not isinstance(score, int):
        raise TypeError("result['score'] must be an int")
    if score < 0 or score > 100:
        raise ValueError(f"result['score'] must be between 0 and 100, got {score}")
    if result["band"] not in _VALID_BANDS:
        raise ValueError(f"result['band'] {result['band']!r} is not a valid band")
    reasons = result["reasons"]
    if not isinstance(reasons, list):
        raise ValueError("result['reasons'] must be a list")
    for i, item in enumerate(reasons):
        if not isinstance(item, dict):
            raise ValueError(f"result['reasons'][{i}] must be a dict")
        for rkey in ("code", "points", "desc"):
            if rkey not in item:
                raise ValueError(f"result['reasons'][{i}] is missing key {rkey!r}")
    breakdown = result["factor_breakdown"]
    if not isinstance(breakdown, dict):
        raise ValueError("result['factor_breakdown'] must be a dict")
    for bkey in _REQUIRED_BREAKDOWN_KEYS:
        if bkey not in breakdown:
            raise ValueError(f"result['factor_breakdown'] is missing key {bkey!r}")
    for bkey, bmax in _BREAKDOWN_MAXES.items():
        val = breakdown[bkey]
        if not isinstance(val, (int, float)) or isinstance(val, bool):
            raise TypeError(f"result['factor_breakdown'][{bkey!r}] must be numeric")
        if val < 0:
            raise ValueError(f"result['factor_breakdown'][{bkey!r}] must be >= 0")
        if val > bmax:
            raise ValueError(f"result['factor_breakdown'][{bkey!r}] must be <= {bmax}")
    if result["scoring_version"] != "1.0.0":
        raise ValueError(f"result['scoring_version'] must be '1.0.0', got {result['scoring_version']!r}")


def persist_data_quality_score(opportunity_id: str, result: Dict[str, Any]) -> None:
    _validate_score_result(result)
    if not isinstance(opportunity_id, str) or not opportunity_id:
        raise ValueError("opportunity_id must be a non-empty string")
    try:
        UUID(opportunity_id)
    except ValueError:
        raise ValueError(f"opportunity_id is not a valid UUID: {opportunity_id!r}")

    with transaction() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO data_quality_scores
                    (opportunity_id, score, band, reasons, factor_breakdown, scoring_version)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    opportunity_id,
                    result["score"],
                    result["band"],
                    Jsonb(result["reasons"]),
                    Jsonb(result["factor_breakdown"]),
                    result["scoring_version"],
                ),
            )
