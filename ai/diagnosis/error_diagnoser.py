import json
import logging
import re
from pathlib import Path
from typing import Any, Dict

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ai.config import get_ai_config
from ai.gemini_client import GeminiClient

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]

PROMPT_PATH = (
    PROJECT_ROOT
    / "ai"
    / "prompts"
    / "error_diagnosis_v1.md"
)

SCHEMA_PATH = (
    PROJECT_ROOT
    / "contracts"
    / "ai-schemas"
    / "error_diagnosis.json"
)

EMAIL_PATTERN = re.compile(
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    re.IGNORECASE,
)
BEARER_PATTERN = re.compile(
    r"\bBearer\s+[A-Za-z0-9._~+/=-]+\b",
    re.IGNORECASE,
)
SECRET_KEY_PATTERN = re.compile(
    r"(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|"
    r"auth[_-]?token|password|passwd|secret|credential|authorization)"
)
SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"""(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|"""
    r"""auth[_-]?token|password|passwd|secret|credential)\b"""
    r"""(\s*[:=]\s*)(["']?)[^\s"',;}\]]+\3"""
)
KNOWN_SECRET_PATTERN = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b"
)


class ErrorDiagnosisOutput(BaseModel):
    """Validated output matching the error diagnosis schema."""

    model_config = ConfigDict(extra="forbid")

    likely_root_cause: str
    confidence: float = Field(ge=0.0, le=1.0)
    suggested_action: str
    is_transient: bool


def redact_sensitive_data(value: Any) -> Any:
    """Redact credentials and personal email addresses before AI processing."""
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            key_text = str(key)
            if SECRET_KEY_PATTERN.search(key_text):
                result[key_text] = "[REDACTED_SECRET]"
            else:
                result[key_text] = redact_sensitive_data(item)
        return result

    if isinstance(value, (list, tuple)):
        return [redact_sensitive_data(item) for item in value]

    if not isinstance(value, str):
        return value

    redacted = EMAIL_PATTERN.sub("[REDACTED_EMAIL]", value)
    redacted = BEARER_PATTERN.sub("Bearer [REDACTED]", redacted)
    redacted = SECRET_ASSIGNMENT_PATTERN.sub(
        lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]",
        redacted,
    )
    return KNOWN_SECRET_PATTERN.sub("[REDACTED_SECRET]", redacted)


def _fallback_diagnosis() -> Dict[str, Any]:
    """Return a safe fallback when diagnosis cannot be completed."""
    return {
        "likely_root_cause": (
            "Diagnosis unavailable because the analysis "
            "could not be completed."
        ),
        "confidence": 0.0,
        "suggested_action": "",
        "is_transient": False,
    }


def _mock_diagnosis(stack_trace: str) -> Dict[str, Any]:
    """Return deterministic diagnosis examples for local mock-mode testing."""
    trace = stack_trace.lower()

    if "timeout" in trace or "timed out" in trace:
        result = {
            "likely_root_cause": "The operation exceeded its time limit.",
            "confidence": 0.85,
            "suggested_action": (
                "Check service latency and dependency availability."
            ),
            "is_transient": True,
        }
    elif "connection refused" in trace:
        result = {
            "likely_root_cause": (
                "The target service refused the connection."
            ),
            "confidence": 0.85,
            "suggested_action": (
                "Verify the service is running and the host "
                "and port are correct."
            ),
            "is_transient": True,
        }
    else:
        result = {
            "likely_root_cause": (
                "The failure could not be classified from the available trace."
            ),
            "confidence": 0.3,
            "suggested_action": (
                "Inspect the error trace and relevant service logs."
            ),
            "is_transient": False,
        }

    return ErrorDiagnosisOutput.model_validate(result).model_dump()


def _load_prompt() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _load_schema() -> Dict[str, Any]:
    """Load the authoritative JSON schema for error diagnosis."""
    with SCHEMA_PATH.open("r", encoding="utf-8") as schema_file:
        return json.load(schema_file)


def diagnose_error(
    component_name: str,
    stack_trace: str,
    payload_snapshot: Any,
    client=None,
) -> Dict[str, Any]:
    """
    Return a schema-validated diagnosis suggestion.

    Sensitive information is redacted before AI processing.
    This function does not modify code or retry failed operations.
    """
    try:
        safe_component = redact_sensitive_data(component_name)
        safe_trace = redact_sensitive_data(stack_trace)
        safe_payload = redact_sensitive_data(payload_snapshot)

        config = get_ai_config()

        # Use deterministic examples only for local mock-mode testing.
        if client is None and config.mock_mode:
            return _mock_diagnosis(str(safe_trace))

        prompt_template = _load_prompt()
        prompt = (
            prompt_template
            .replace("{{ component_name }}", str(safe_component))
            .replace("{{ redacted_stack_trace }}", str(safe_trace))
            .replace(
                "{{ redacted_payload_snapshot }}",
                json.dumps(
                    safe_payload,
                    ensure_ascii=False,
                    default=str,
                ),
            )
        )

        schema = _load_schema()
        ai_client = client if client is not None else GeminiClient()
        response, _usage = ai_client.generate(
            prompt,
            schema=schema,
            temperature=0.1,
        )

        if not isinstance(response, dict):
            logger.warning("Error diagnosis returned a non-object response.")
            return _fallback_diagnosis()

        validated = ErrorDiagnosisOutput.model_validate(response)
        return validated.model_dump()

    except (
        TimeoutError,
        ValidationError,
        ValueError,
        OSError,
        KeyError,
        TypeError,
    ):
        logger.warning("Error diagnosis failed; returning fallback.")
        return _fallback_diagnosis()
    except Exception:
        # API/client errors must not escape to callers.
        logger.warning(
            "Error diagnosis service unavailable; returning fallback."
        )
        return _fallback_diagnosis()
