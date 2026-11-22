from backend.app.core.config import get_settings
from backend.app.core.db import get_conn


ALLOWED_PROVIDERS = {"contactout", "snov", "manual"}


def mock_contactout_lookup(lead):
    return {
        "provider": "contactout",
        "estimated_credits": 1,
        "contact": {
            "email": "jane@example.com",
            "phone": "9876543210"
        }
    }


def mock_snov_lookup(lead):
    return {
        "provider": "snov",
        "estimated_credits": 1,
        "contact": {
            "email": "john@example.com",
            "phone": "9876543211"
        }
    }


def validate_provider(provider):
    if provider not in ALLOWED_PROVIDERS:
        raise ValueError("Unsupported enrichment provider")


def get_provider_client(provider):
    clients = {
        "contactout": mock_contactout_lookup,
        "snov": mock_snov_lookup
    }

    validate_provider(provider)

    if provider == "manual":
        return None

    return clients[provider]


def get_provider_estimate(lead, provider):
    validate_provider(provider)

    if provider == "manual":
        return {
            "provider": "manual",
            "estimated_credits": 0,
            "contact": None
        }

    result = get_provider_client(provider)(lead)
    estimated_credits = result.get("estimated_credits")

    if (
        isinstance(estimated_credits, bool)
        or not isinstance(estimated_credits, int)
        or estimated_credits < 0
    ):
        raise ValueError("Invalid provider credit estimate")

    return result


def get_monthly_credits_used(cur=None):
    query = """
        SELECT COALESCE(SUM(credits_used), 0)
        FROM enrichment_requests
        WHERE created_at >= date_trunc('month', NOW())
          AND status = 'completed'
    """

    if cur is not None:
        cur.execute(query)
        return cur.fetchone()[0]

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            return cur.fetchone()[0]


def validate_credit_confirmation(
    estimated_credits,
    confirmed_credits,
    monthly_used=None
):
    if confirmed_credits is None:
        raise ValueError("Credit confirmation is required")

    if (
        isinstance(confirmed_credits, bool)
        or not isinstance(confirmed_credits, int)
        or confirmed_credits < 0
    ):
        raise ValueError("Invalid confirmed credits")

    if estimated_credits is not None and confirmed_credits != estimated_credits:
        raise ValueError("Credit confirmation mismatch")

    settings = get_settings()
    monthly_budget = settings.MONTHLY_CREDIT_BUDGET

    if monthly_used is None:
        monthly_used = get_monthly_credits_used()

    if monthly_used + confirmed_credits > monthly_budget:
        raise ValueError("Monthly credit budget exceeded")

    return {
        "estimated_credits": estimated_credits,
        "confirmed_credits": confirmed_credits,
        "monthly_used": monthly_used,
        "monthly_budget": monthly_budget
    }


def save_enrichment_request(
    cur,
    lead_id,
    provider,
    credits_used
):
    cur.execute("""
        INSERT INTO enrichment_requests
        (lead_id, provider, credits_used, status, created_at)
        VALUES (%s, %s, %s, %s, NOW())
        RETURNING id
    """, (lead_id, provider, credits_used, "completed"))

    return cur.fetchone()[0]


def save_enriched_contact(cur, lead_id, contact, provider):
    if not contact:
        return None

    cur.execute("""
        INSERT INTO contacts
        (lead_id, email, phone, source, created_at)
        VALUES (%s, %s, %s, %s, NOW())
        RETURNING id
    """, (
        lead_id,
        contact.get("email"),
        contact.get("phone"),
        provider
    ))

    return cur.fetchone()[0]


def enrich_lead(lead_id, lead, provider, confirmed_credits):
    validate_provider(provider)

    if confirmed_credits is None:
        raise ValueError("Credit confirmation is required")

    if (
        isinstance(confirmed_credits, bool)
        or not isinstance(confirmed_credits, int)
        or confirmed_credits < 0
    ):
        raise ValueError("Invalid confirmed credits")

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_xact_lock(390039)")

            monthly_used = get_monthly_credits_used(cur)
            validation = validate_credit_confirmation(
                None,
                confirmed_credits,
                monthly_used=monthly_used
            )

            estimate = get_provider_estimate(lead, provider)
            estimated_credits = estimate["estimated_credits"]

            if confirmed_credits != estimated_credits:
                raise ValueError("Credit confirmation mismatch")

            validation["estimated_credits"] = estimated_credits

            request_id = save_enrichment_request(
                cur,
                lead_id,
                provider,
                confirmed_credits
            )

            contact_id = save_enriched_contact(
                cur,
                lead_id,
                estimate.get("contact"),
                provider
            )

    return {
        "request_id": request_id,
        "lead_id": lead_id,
        "provider": provider,
        "estimated_credits": estimated_credits,
        "confirmed_credits": confirmed_credits,
        "monthly_used": validation["monthly_used"] + confirmed_credits,
        "monthly_budget": validation["monthly_budget"],
        "contact_id": contact_id
    }
