"""Email verification client backed by Abstract API.

The API key is read only from ABSTRACT_API_KEY in the process environment.
Sandbox mode never makes a network request.
"""
from __future__ import annotations

import json
import logging
import os
from enum import Enum
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from backend.app.core.config import get_settings

logger = logging.getLogger(__name__)


class VerificationStatus(str, Enum):
    DELIVERABLE = "deliverable"
    UNDELIVERABLE = "undeliverable"
    CATCH_ALL = "catch_all"
    RISKY = "risky"
    UNKNOWN = "unknown"
    FAILED = "failed"


class EmailVerifier:
    """Verify email addresses and normalize provider responses.

    Args:
        sandbox: If True, return a configured mock status without calling Abstract.
        sandbox_status: Status returned in sandbox mode when no per-email mock exists.
        sandbox_responses: Optional mapping of email addresses to mock statuses.
        timeout: HTTP timeout in seconds for live requests.
    """

    API_URL = "https://emailvalidation.abstractapi.com/v1/"

    def __init__(
        self,
        *,
        sandbox: bool = False,
        sandbox_status: str = VerificationStatus.UNKNOWN.value,
        sandbox_responses: Mapping[str, str] | None = None,
        timeout: float = 8.0,
    ) -> None:
        self.sandbox = sandbox
        self.sandbox_status = self._validate_status(sandbox_status)
        self.sandbox_responses = {
            email.lower(): self._validate_status(status)
            for email, status in (sandbox_responses or {}).items()
        }
        self.timeout = timeout

    def verify(self, email: str) -> str:
        """Return one of the six standardized status strings."""
        if not isinstance(email, str) or not email.strip():
            logger.warning("Email verification skipped for %s: invalid input", self._mask_email(str(email)))
            return VerificationStatus.FAILED.value

        email = email.strip()
        if self.sandbox:
            status = self.sandbox_responses.get(email.lower(), self.sandbox_status)
            logger.info("Sandbox email verification for %s returned %s", self._mask_email(email), status)
            return status

        api_key = os.environ.get("ABSTRACT_API_KEY")
        if not api_key:
            logger.error("Email verification unavailable for %s: ABSTRACT_API_KEY is not configured",
                         self._mask_email(email))
            return VerificationStatus.FAILED.value

        try:
            payload = self._request_provider(email, api_key)
            status = self._map_provider_response(payload)
            logger.info("Email verification for %s returned %s", self._mask_email(email), status)
            return status
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
            # Do not log request URLs, API keys, provider bodies, or full email addresses.
            logger.warning("Email verification request failed for %s", self._mask_email(email))
            return VerificationStatus.FAILED.value

    def _request_provider(self, email: str, api_key: str) -> dict[str, Any]:
        query = urlencode({"api_key": api_key, "email": email})
        request = Request(
            f"{self.API_URL}?{query}",
            headers={"Accept": "application/json", "User-Agent": "BE-35-email-verifier/1.0"},
            method="GET",
        )
        with urlopen(request, timeout=self.timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Provider returned a non-object JSON response")
        return data

    @classmethod
    def _map_provider_response(cls, payload: Mapping[str, Any]) -> str:
        """Normalize both classic and current Abstract response shapes."""
        deliverability = payload.get("deliverability")
        if not deliverability:
            deliverability = (payload.get("email_deliverability") or {}).get("status")

        quality = payload.get("email_quality") or {}
        catch_all = cls._flag(payload.get("is_catchall_email"))
        if catch_all is None:
            catch_all = cls._flag(quality.get("is_catchall"))

        # Catch-all takes precedence: the domain accepts mail, but the exact
        # mailbox cannot be confirmed reliably.
        if catch_all is True:
            return VerificationStatus.CATCH_ALL.value

        normalized = str(deliverability or "").strip().lower()
        mapping = {
            "deliverable": VerificationStatus.DELIVERABLE.value,
            "undeliverable": VerificationStatus.UNDELIVERABLE.value,
            "risky": VerificationStatus.RISKY.value,
            "unknown": VerificationStatus.UNKNOWN.value,
        }
        return mapping.get(normalized, VerificationStatus.FAILED.value)

    @staticmethod
    def _flag(value: Any) -> bool | None:
        """Read Abstract's boolean fields, which may be plain bools or {value: bool}."""
        if isinstance(value, bool):
            return value
        if isinstance(value, Mapping):
            nested = value.get("value")
            return nested if isinstance(nested, bool) else None
        return None

    @staticmethod
    def _validate_status(status: str) -> str:
        allowed = {item.value for item in VerificationStatus}
        if status not in allowed:
            raise ValueError(f"Invalid verification status: {status!r}")
        return status

    @staticmethod
    def _mask_email(email: str) -> str:
        """Mask the local part while retaining enough context for debugging."""
        if "@" not in email:
            return "***"
        local, domain = email.rsplit("@", 1)
        if not local or not domain:
            return "***"
        return f"{local[0]}***@{domain}"


class EmailVerifierClient:
    """Adapt the normalized verifier result to the verification service contract."""

    def __init__(self) -> None:
        settings = get_settings()
        self._verifier = EmailVerifier(sandbox=settings.EMAIL_VERIFIER_SANDBOX)

    def verify(self, email: str) -> dict[str, Any]:
        result = self._verifier.verify(email)
        return {
            "result": result,
            "raw_response": {"normalized_status": result},
        }
