"""BE-27: Lead lifecycle policy. Keep the existing database status vocabulary."""

SUPPORTED_STATUSES = frozenset({
    "new", "needs_enrichment", "verified", "draft_ready",
    "approved", "sent", "closed",
})

# Proposed workflow policy; confirm with backend lead before merging.
ALLOWED_TRANSITIONS = {
    "new": frozenset({"needs_enrichment", "verified", "closed"}),
    "needs_enrichment": frozenset({"verified", "closed"}),
    "verified": frozenset({"draft_ready", "closed"}),
    "draft_ready": frozenset({"approved", "closed"}),
    "approved": frozenset({"sent", "closed"}),
    "sent": frozenset({"closed"}),
    "closed": frozenset(),
}


def is_valid_transition(previous: str, next_status: str) -> bool:
    """Identical status is idempotent; otherwise enforce explicit transitions."""
    return previous in SUPPORTED_STATUSES and (
        next_status == previous or next_status in ALLOWED_TRANSITIONS[previous]
    )
