"""
Field Normalizer for Scraper Payloads.
Standardizes messy text formats for experience, salary, and location.
Deterministic rule engine. Unparseable input safely returns None.
"""

import re
from typing import Optional, Tuple, Dict, Any

def normalize_experience(raw_text: Optional[str],) -> Optional[Tuple[int, int]]:
    """
    Standardizes experience strings into (min_years, max_years).
    Returns None if input is unparseable.
    Never raises an exception.
    """
    if not raw_text or not isinstance(raw_text, str):
        return None

    cleaned = raw_text.strip().lower()

    if not cleaned:
        return None

    if (
        "fresher" in cleaned
        or "no experience" in cleaned
        or re.fullmatch(r"0\s*(?:yrs?|years?)", cleaned)
    ):
        return 0, 0

    range_match = re.search(
        r"(\d+)\s*(?:-|to)\s*(\d+)",
        cleaned,
    )

    if range_match:
        try:
            min_exp = int(range_match.group(1))
            max_exp = int(range_match.group(2))

            if min_exp <= max_exp:
                return min_exp, max_exp

            return None
        except (ValueError, TypeError):
            return None

    single_match = re.search(r"(\d+)", cleaned)

    if single_match:
        try:
            value = int(single_match.group(1))
            return value, value
        except (ValueError, TypeError):
            return None

    return None


def normalize_salary(
    raw_text: Optional[str],
) -> Optional[Dict[str, str]]:
    """
    Cleans salary formatting while preserving the original string.

    Returns:
        {
            "original": original_salary,
            "normalized": cleaned_salary
        }

    Returns None if input is empty or unparseable.
    """
    if not raw_text or not isinstance(raw_text, str):
        return None

    original = raw_text
    cleaned = raw_text.strip()

    if not cleaned:
        return None

    # Normalize whitespace.
    cleaned = re.sub(r"\s+", " ", cleaned)

    # Remove unnecessary spaces around separators.
    cleaned = re.sub(r"\s*-\s*", " - ", cleaned)
    cleaned = re.sub(r"\s*,\s*", ",", cleaned)

    # Normalize currency symbol spacing.
    cleaned = re.sub(r"₹\s+", "₹", cleaned)
    cleaned = re.sub(r"\$\s+", "$", cleaned)

    # Remove spaces between numbers and percentage signs.
    cleaned = re.sub(r"\s+%", "%", cleaned)

    # Ensure the input contains a numeric salary value.
    if not re.search(r"\d", cleaned):
        return None

    return {
        "original": original,
        "normalized": cleaned,
    }


def normalize_location(raw_text: Optional[str]) -> Optional[str]:
    """Cleans location names and identifies remote/hybrid tags."""

    if not raw_text or not isinstance(raw_text, str):
        return None

    cleaned = re.sub(r"\s+", " ", raw_text.strip())

    if not cleaned:
        return None

    # Detect work arrangement.
    remote_pattern = r"\b(remote|work from home|wfh)\b"
    hybrid_pattern = r"\bhybrid\b"

    is_remote = bool(re.search(remote_pattern, cleaned, re.IGNORECASE))
    is_hybrid = bool(re.search(hybrid_pattern, cleaned, re.IGNORECASE))

    # Remove work arrangement tags before formatting the location.
    cleaned = re.sub(remote_pattern, "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(hybrid_pattern, "", cleaned, flags=re.IGNORECASE)

    # Clean separators and whitespace.
    cleaned = re.sub(r"\s*[,|-]\s*", ", ", cleaned)
    cleaned = re.sub(r",\s*,+", ",", cleaned)
    cleaned = cleaned.strip(" ,-|")

    if not cleaned and not (is_remote or is_hybrid):
        return None

    cleaned = cleaned.title() if cleaned else ""

    # Append work arrangement information.
    if is_remote:
        cleaned = f"{cleaned} (Remote)" if cleaned else "Remote"
    elif is_hybrid:
        cleaned = f"{cleaned} (Hybrid)" if cleaned else "Hybrid"

    return cleaned