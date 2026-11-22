
import copy
import json
import logging
import math
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from ai.config import get_ai_config
from ai.gemini_client import GeminiClient
from ai.diagnosis.error_diagnoser import redact_sensitive_data


logger = logging.getLogger(__name__)

BLOCKED_RETRY_CATEGORIES = {
    "send_timeout",
    "provider_rejection",
    "permanent_provider_rejection",
}

MAX_RETRY_COUNT = 5
MAX_DELAY_SECONDS = 3600
MAX_BATCH_SIZE = 200

SENSITIVE_FIELD_NAMES = {
    "email",
    "api_key",
    "apikey",
    "secret",
    "password",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "credential",
    "credentials",
    "private_key",
    "client_secret",
}


class PayloadChange(BaseModel):
    """Describe one proposed change to a JSON payload."""

    model_config = ConfigDict(extra="forbid")

    path: str
    issue: str
    new_value: Any = None


class PayloadFixOutput(BaseModel):
    """Validated payload correction proposal."""

    model_config = ConfigDict(extra="forbid")

    summary: str
    corrected_payload: Optional[Dict[str, Any]] = None
    changes: List[PayloadChange] = Field(default_factory=list)
    needs_human_input: List[str] = Field(default_factory=list)
    retry_parameters: Optional[Dict[str, Any]] = None


def _fallback_payload_fix() -> Dict[str, Any]:
    """Return a safe response when analysis fails."""
    return PayloadFixOutput(
        summary="Payload analysis unavailable. Manual review required.",
        corrected_payload=None,
        changes=[],
        needs_human_input=[
            "Review the original payload and error message."
        ],
        retry_parameters=None,
    ).model_dump()


def _mock_payload_fix(
    payload: Dict[str, Any],
    error_message: str,
) -> Dict[str, Any]:
    """Offline response without Gemini API calls."""
    return PayloadFixOutput(
        summary="Mock mode: manual payload review required.",
        corrected_payload=None,
        changes=[],
        needs_human_input=[
            "Review the failing payload and error message."
        ],
        retry_parameters=None,
    ).model_dump()


def _parse_path(path: str) -> List[str]:
    """Parse dotted and indexed JSON field paths."""
    if not isinstance(path, str) or not path:
        raise KeyError(path)

    parts = re.findall(r"[^.\[\]]+", path)

    if not parts:
        raise KeyError(path)

    return parts


def _get_value(payload: Dict[str, Any], path: str):
    """Read a value using paths such as items[0].age."""
    parts = _parse_path(path)
    current = payload

    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]

        elif isinstance(current, list) and part.isdigit():
            index = int(part)

            if index >= len(current):
                raise KeyError(path)

            current = current[index]

        else:
            raise KeyError(path)

    return current


def _set_value(
    payload: Dict[str, Any],
    path: str,
    value: Any,
):
    """Update an existing field without creating missing fields."""
    parts = _parse_path(path)
    current = payload

    for part in parts[:-1]:
        if isinstance(current, dict):
            current = current[part]

        elif isinstance(current, list) and part.isdigit():
            index = int(part)

            if index >= len(current):
                raise KeyError(path)

            current = current[index]

        else:
            raise KeyError(path)

    last = parts[-1]

    if isinstance(current, dict) and last in current:
        current[last] = value

    elif isinstance(current, list) and last.isdigit():
        index = int(last)

        if index >= len(current):
            raise KeyError(path)

        current[index] = value

    else:
        raise KeyError(path)


def _is_sensitive_path(path: str) -> bool:
    """Reject AI changes targeting known sensitive fields."""
    parts = _parse_path(path)

    for part in parts:
        normalized = part.lower().replace("-", "_")

        if normalized in SENSITIVE_FIELD_NAMES:
            return True

        if (
            normalized.endswith("_api_key")
            or normalized.endswith("_password")
            or normalized.endswith("_secret")
            or normalized.endswith("_token")
        ):
            return True

    return False


def _safe_conversion(
    old_value: Any,
    new_value: Any,
    issue: str,
) -> bool:
    """Allow only simple, value-preserving type conversions."""
    description = issue.lower()

    if not isinstance(old_value, str):
        return False

    text = old_value.strip()

    if (
        "integer" in description
        and type(new_value) is int
        and re.fullmatch(r"[+-]?\d+", text)
    ):
        return int(text) == new_value

    if (
        ("number" in description or "float" in description)
        and type(new_value) in (int, float)
    ):
        try:
            old_number = float(text)
            proposed_number = float(new_value)

            return (
                math.isfinite(old_number)
                and math.isfinite(proposed_number)
                and old_number == proposed_number
            )

        except (ValueError, OverflowError):
            return False

    if "boolean" in description and type(new_value) is bool:
        normalized = text.lower()

        return (
            (normalized == "true" and new_value is True)
            or (normalized == "false" and new_value is False)
        )

    return False


def _check_proposed_changes(
    original_payload: Dict[str, Any],
    result: PayloadFixOutput,
) -> PayloadFixOutput:
    """
    Apply approved changes to a copy of the original payload.

    Gemini sees redacted input, but corrected_payload must
    preserve original sensitive values.
    """
    corrected = copy.deepcopy(original_payload)
    accepted_changes = []
    warnings = list(result.needs_human_input)

    for change in result.changes:
        try:
            if _is_sensitive_path(change.path):
                warnings.append(
                    f"Sensitive field '{change.path}' "
                    "cannot be modified automatically."
                )
                continue

            old_value = _get_value(
                original_payload,
                change.path,
            )

            if _safe_conversion(
                old_value,
                change.new_value,
                change.issue,
            ):
                _set_value(
                    corrected,
                    change.path,
                    change.new_value,
                )
                accepted_changes.append(change)

            else:
                warnings.append(
                    f"Manual review required for '{change.path}': "
                    f"{change.issue}"
                )

        except (KeyError, IndexError, TypeError, ValueError):
            warnings.append(
                f"Missing or unsupported field '{change.path}' "
                "requires manual review."
            )

    result.changes = accepted_changes
    result.needs_human_input = list(dict.fromkeys(warnings))

    # Ignore the model's proposed full payload.
    # Build corrected_payload only from accepted changes.
    result.corrected_payload = (
        corrected if accepted_changes else None
    )

    return result


def _validate_retry_parameters(
    params: Optional[Dict[str, Any]],
) -> bool:
    """Validate retry suggestions without executing retries."""
    if not isinstance(params, dict) or not params:
        return False

    allowed_keys = {
        "retry_count",
        "delay_seconds",
        "batch_size",
    }

    if not set(params).issubset(allowed_keys):
        return False

    for key, value in params.items():
        if type(value) is not int:
            return False

        if key == "retry_count":
            if not 0 <= value <= MAX_RETRY_COUNT:
                return False

        elif key == "delay_seconds":
            if not 0 <= value <= MAX_DELAY_SECONDS:
                return False

        elif key == "batch_size":
            if not 1 <= value <= MAX_BATCH_SIZE:
                return False

    return True


def suggest_payload_fix(
    payload: Dict[str, Any],
    error_message: str,
    category: str = "invalid_input",
    client=None,
) -> Dict[str, Any]:
    """Suggest safe corrections without modifying the input."""
    try:
        # Only redacted data is sent to Gemini.
        safe_payload = redact_sensitive_data(payload)
        safe_error = redact_sensitive_data(error_message)
        safe_category = redact_sensitive_data(category)

        config = get_ai_config()

        if client is None and config.mock_mode:
            return _mock_payload_fix(
                safe_payload,
                safe_error,
            )

        schema = PayloadFixOutput.model_json_schema()

        prompt = (
            "You are an n8n JSON payload repair assistant.\n"
            "Analyse the failing JSON payload and error message.\n"
            "Work with generic JSON payloads, not one fixed schema.\n"
            "Never invent missing values, emails, IDs, or URLs.\n"
            "List unknown values in needs_human_input.\n"
            "Propose corrected_payload and field-level changes.\n"
            "Use paths such as items[0].age.\n"
            "Suggest retry parameters only when appropriate.\n"
            "Batch size must not exceed 200.\n"
            "Retry count must not exceed 5.\n"
            "Retry delay must not exceed 3600 seconds.\n"
            "Never modify sensitive fields automatically.\n"
            "Never retry send_timeout, provider_rejection, "
            "or permanent_provider_rejection.\n"
            "Never execute or submit anything.\n"
            "Return JSON matching the supplied schema.\n\n"
            f"Category: {safe_category}\n"
            f"Error: {safe_error}\n"
            f"Payload: {json.dumps(safe_payload, ensure_ascii=False)}"
        )

        ai_client = (
            client if client is not None else GeminiClient()
        )

        response, _usage = ai_client.generate(
            prompt,
            schema=schema,
            temperature=0.1,
        )

        validated = PayloadFixOutput.model_validate(response)

        # Apply accepted changes to the ORIGINAL payload.
        # Do not use safe_payload here.
        validated = _check_proposed_changes(
            payload,
            validated,
        )

        normalized_category = (
            str(safe_category).strip().lower()
        )

        if normalized_category in BLOCKED_RETRY_CATEGORIES:
            validated.retry_parameters = None

        elif validated.retry_parameters is not None:
            if not _validate_retry_parameters(
                validated.retry_parameters
            ):
                validated.retry_parameters = None
                validated.needs_human_input.append(
                    "Review invalid retry parameters manually."
                )

        return validated.model_dump()

    except Exception:
        logger.warning(
            "Payload fix analysis failed; returning safe fallback."
        )
        return _fallback_payload_fix()
