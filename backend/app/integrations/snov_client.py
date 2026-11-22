import logging
import os
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_TOKEN_URL = "https://api.snov.io/v1/oauth/access_token"
_START_URL = "https://api.snov.io/v2/emails-by-domain-by-name/start"
_RESULT_URL = "https://api.snov.io/v2/emails-by-domain-by-name/result"

_POLL_INTERVAL_SECONDS = 2
_POLL_MAX_ATTEMPTS = 15
_REQUEST_TIMEOUT = 15.0


class SnovClient:
    def __init__(self) -> None:
        self._client_id: str = os.environ.get("SNOV_CLIENT_ID", "")
        self._client_secret: str = os.environ.get("SNOV_CLIENT_SECRET", "")
        self._sandbox: bool = os.environ.get("ENRICHMENT_SANDBOX", "true").lower() != "false"
        self._token: Optional[str] = None
        self._token_expires_at: float = 0.0

    def _get_token(self) -> str:
        if self._token and time.monotonic() < self._token_expires_at:
            return self._token

        if not self._client_id or not self._client_secret:
            raise ValueError("SNOV_CLIENT_ID and SNOV_CLIENT_SECRET must be set")

        response = httpx.post(
            _TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
            timeout=_REQUEST_TIMEOUT,
        )
        response.raise_for_status()

        payload = response.json()
        self._token = payload["access_token"]
        expires_in = int(payload.get("expires_in", 3600))
        self._token_expires_at = time.monotonic() + expires_in - 60
        return self._token

    def _sandbox_contact(self, first_name: str, last_name: str, domain: str) -> dict:
        return {
            "name": f"{first_name} {last_name}".strip(),
            "role_title": None,
            "methods": [
                {
                    "kind": "email",
                    "value": f"{first_name.lower()}.{last_name.lower()}@{domain}",
                    "provenance": "Enriched via snov",
                }
            ],
        }

    def get_contact(self, first_name: str, last_name: str, domain: str) -> dict:
        if self._sandbox:
            logger.info("Snov.io sandbox mode: returning mock contact for %s %s", first_name, last_name)
            return self._sandbox_contact(first_name, last_name, domain)

        token = self._get_token()
        headers = {"Authorization": f"Bearer {token}"}

        start_response = httpx.post(
            _START_URL,
            json={
                "rows": [
                    {
                        "first_name": first_name,
                        "last_name": last_name,
                        "domain": domain,
                    }
                ]
            },
            headers=headers,
            timeout=_REQUEST_TIMEOUT,
        )
        start_response.raise_for_status()

        start_payload = start_response.json()
        if not start_payload.get("success"):
            raise ValueError(f"Snov.io start request failed: {start_payload}")

        task_hash = start_payload.get("task_hash")
        if not task_hash:
            raise ValueError("Snov.io returned no task_hash in start response")

        for attempt in range(_POLL_MAX_ATTEMPTS):
            time.sleep(_POLL_INTERVAL_SECONDS)

            result_response = httpx.get(
                _RESULT_URL,
                params={"task_hash": task_hash},
                headers=headers,
                timeout=_REQUEST_TIMEOUT,
            )
            result_response.raise_for_status()

            result_payload = result_response.json()
            status = result_payload.get("status", "")

            if status == "completed":
                return self._normalize(result_payload, first_name, last_name)

            if status in ("failed", "error"):
                raise RuntimeError(f"Snov.io task {task_hash} failed: {result_payload}")

            if status not in ("pending", "processing", "in_progress"):
                raise ValueError(f"Snov.io unexpected task status '{status}': {result_payload}")

            logger.debug(
                "Snov.io task %s attempt %d/%d: status=%s",
                task_hash,
                attempt + 1,
                _POLL_MAX_ATTEMPTS,
                status,
            )

        raise TimeoutError(f"Snov.io task {task_hash} did not complete after {_POLL_MAX_ATTEMPTS} polls")

    def _normalize(self, payload: dict, first_name: str, last_name: str) -> dict:
        data = payload.get("data") if isinstance(payload, dict) else None
        row = data[0] if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict) else {}

        resolved_first = str(row.get("first_name") or first_name or "").strip()
        resolved_last = str(row.get("last_name") or last_name or "").strip()
        full_name = f"{resolved_first} {resolved_last}".strip()

        raw_title = row.get("position") or row.get("job_title")
        role_title = str(raw_title).strip() if raw_title else None

        methods = []
        raw_emails = row.get("emails")
        if isinstance(raw_emails, list):
            for email_entry in raw_emails:
                if isinstance(email_entry, dict):
                    address = str(email_entry.get("email") or "").strip()
                    if address and "@" in address:
                        methods.append(
                            {
                                "kind": "email",
                                "value": address,
                                "provenance": "Enriched via snov",
                            }
                        )

        contact: dict = {
            "name": full_name,
            "role_title": role_title,
            "methods": methods,
        }
        return contact