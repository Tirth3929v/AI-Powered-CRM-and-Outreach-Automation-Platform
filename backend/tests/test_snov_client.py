import time
from unittest.mock import MagicMock, patch

import httpx
import pytest

from backend.app.integrations.snov_client import SnovClient


def _make_client(sandbox: bool = False, client_id: str = "test-id", client_secret: str = "test-secret"):
    with patch.dict(
        "os.environ",
        {
            "ENRICHMENT_SANDBOX": "true" if sandbox else "false",
            "SNOV_CLIENT_ID": client_id,
            "SNOV_CLIENT_SECRET": client_secret,
        },
        clear=False,
    ):
        return SnovClient()


def _mock_response(status_code: int = 200, json_body: dict = None) -> MagicMock:
    response = MagicMock(spec=httpx.Response)
    response.status_code = status_code
    response.json.return_value = json_body or {}
    if status_code >= 400:
        response.raise_for_status.side_effect = httpx.HTTPStatusError(
            message=f"HTTP {status_code}",
            request=MagicMock(),
            response=response,
        )
    else:
        response.raise_for_status.return_value = None
    return response


def _token_response() -> MagicMock:
    return _mock_response(200, {"access_token": "test-bearer-token", "expires_in": 3600})


def _start_response(task_hash: str = "abc123") -> MagicMock:
    return _mock_response(200, {"success": True, "task_hash": task_hash})


def _result_response(status: str, data: list = None) -> MagicMock:
    body = {"status": status}
    if data is not None:
        body["data"] = data
    return _mock_response(200, body)


FULL_ROW = {
    "first_name": "Jane",
    "last_name": "Doe",
    "position": "Technical Recruiter",
    "emails": [{"email": "jane.doe@example.com", "status": "valid"}],
}


class TestSandboxMode:
    def test_returns_name(self):
        client = _make_client(sandbox=True)
        result = client.get_contact("Jane", "Doe", "example.com")
        assert result["name"] == "Jane Doe"

    def test_returns_none_role_title(self):
        client = _make_client(sandbox=True)
        result = client.get_contact("Jane", "Doe", "example.com")
        assert result["role_title"] is None

    def test_returns_one_email_method(self):
        client = _make_client(sandbox=True)
        result = client.get_contact("Jane", "Doe", "example.com")
        assert len(result["methods"]) == 1
        assert result["methods"][0]["kind"] == "email"

    def test_email_value_is_lowercased(self):
        client = _make_client(sandbox=True)
        result = client.get_contact("Jane", "Doe", "example.com")
        assert result["methods"][0]["value"] == "jane.doe@example.com"

    def test_provenance_is_enriched_via_snov(self):
        client = _make_client(sandbox=True)
        result = client.get_contact("Jane", "Doe", "example.com")
        assert result["methods"][0]["provenance"] == "Enriched via snov"

    def test_name_is_stripped(self):
        client = _make_client(sandbox=True)
        result = client.get_contact("Jane", "", "example.com")
        assert result["name"] == "Jane"

    def test_no_http_calls_made(self):
        client = _make_client(sandbox=True)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get:
            client.get_contact("Jane", "Doe", "example.com")
            mock_post.assert_not_called()
            mock_get.assert_not_called()


class TestCredentialValidation:
    def test_missing_client_id_raises_value_error(self):
        client = _make_client(sandbox=False, client_id="", client_secret="secret")
        with pytest.raises(ValueError, match="SNOV_CLIENT_ID and SNOV_CLIENT_SECRET must be set"):
            client.get_contact("Jane", "Doe", "example.com")

    def test_missing_client_secret_raises_value_error(self):
        client = _make_client(sandbox=False, client_id="my-id", client_secret="")
        with pytest.raises(ValueError, match="SNOV_CLIENT_ID and SNOV_CLIENT_SECRET must be set"):
            client.get_contact("Jane", "Doe", "example.com")

    def test_both_credentials_missing_raises_value_error(self):
        client = _make_client(sandbox=False, client_id="", client_secret="")
        with pytest.raises(ValueError):
            client.get_contact("Jane", "Doe", "example.com")


class TestTokenFetch:
    def test_auth_http_error_propagates(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post", return_value=_mock_response(401)):
            with pytest.raises(httpx.HTTPStatusError):
                client.get_contact("Jane", "Doe", "example.com")

    def test_token_is_cached_and_reused(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [
                _token_response(),
                _start_response("hash-1"),
                _start_response("hash-2"),
            ]
            mock_get.side_effect = [
                _result_response("completed", [FULL_ROW]),
                _result_response("completed", [FULL_ROW]),
            ]

            client.get_contact("Jane", "Doe", "example.com")
            client.get_contact("Jane", "Doe", "example.com")

            assert mock_post.call_count == 3

    def test_expired_token_is_refreshed(self):
        client = _make_client(sandbox=False)
        client._token = "old-token"
        client._token_expires_at = time.monotonic() - 1.0

        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response()]
            mock_get.return_value = _result_response("completed", [FULL_ROW])

            client.get_contact("Jane", "Doe", "example.com")

            token_calls = [c for c in mock_post.call_args_list if "oauth" in str(c)]
            assert len(token_calls) == 1
            assert client._token == "test-bearer-token"


class TestStartRequest:
    def test_start_http_error_propagates(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _mock_response(500)]
            with pytest.raises(httpx.HTTPStatusError):
                client.get_contact("Jane", "Doe", "example.com")

    def test_success_false_raises_value_error(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("time.sleep"):
            mock_post.side_effect = [
                _token_response(),
                _mock_response(200, {"success": False, "message": "invalid domain"}),
            ]
            with pytest.raises(ValueError, match="Snov.io start request failed"):
                client.get_contact("Jane", "Doe", "example.com")

    def test_missing_task_hash_raises_value_error(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("time.sleep"):
            mock_post.side_effect = [
                _token_response(),
                _mock_response(200, {"success": True}),
            ]
            with pytest.raises(ValueError, match="no task_hash"):
                client.get_contact("Jane", "Doe", "example.com")


class TestPolling:
    def test_completed_status_returns_contact(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response()]
            mock_get.return_value = _result_response("completed", [FULL_ROW])

            result = client.get_contact("Jane", "Doe", "example.com")

            assert result["name"] == "Jane Doe"

    def test_pending_then_completed_polls_until_done(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response()]
            mock_get.side_effect = [
                _result_response("pending"),
                _result_response("processing"),
                _result_response("in_progress"),
                _result_response("completed", [FULL_ROW]),
            ]

            result = client.get_contact("Jane", "Doe", "example.com")

            assert mock_get.call_count == 4
            assert result["name"] == "Jane Doe"

    def test_failed_status_raises_runtime_error(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response()]
            mock_get.return_value = _result_response("failed")

            with pytest.raises(RuntimeError, match="failed"):
                client.get_contact("Jane", "Doe", "example.com")

    def test_error_status_raises_runtime_error(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response()]
            mock_get.return_value = _result_response("error")

            with pytest.raises(RuntimeError, match="failed"):
                client.get_contact("Jane", "Doe", "example.com")

    def test_unknown_status_raises_value_error(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response()]
            mock_get.return_value = _result_response("queued")

            with pytest.raises(ValueError, match="unexpected task status"):
                client.get_contact("Jane", "Doe", "example.com")

    def test_poll_http_error_propagates(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response()]
            mock_get.return_value = _mock_response(429)

            with pytest.raises(httpx.HTTPStatusError):
                client.get_contact("Jane", "Doe", "example.com")

    def test_timeout_after_max_attempts(self):
        client = _make_client(sandbox=False)
        with patch("httpx.post") as mock_post, patch("httpx.get") as mock_get, patch("time.sleep"):
            mock_post.side_effect = [_token_response(), _start_response("hash-xyz")]
            mock_get.return_value = _result_response("pending")

            with pytest.raises(TimeoutError, match="hash-xyz"):
                client.get_contact("Jane", "Doe", "example.com")


class TestNormalize:
    def _completed_payload(self, row: dict) -> dict:
        return {"status": "completed", "data": [row]}

    def test_full_row_maps_all_fields(self):
        client = _make_client(sandbox=True)
        result = client._normalize(self._completed_payload(FULL_ROW), "Jane", "Doe")

        assert result["name"] == "Jane Doe"
        assert result["role_title"] == "Technical Recruiter"
        assert len(result["methods"]) == 1
        assert result["methods"][0] == {
            "kind": "email",
            "value": "jane.doe@example.com",
            "provenance": "Enriched via snov",
        }

    def test_empty_data_list_falls_back_to_inputs(self):
        client = _make_client(sandbox=True)
        result = client._normalize({"status": "completed", "data": []}, "Jane", "Doe")

        assert result["name"] == "Jane Doe"
        assert result["role_title"] is None
        assert result["methods"] == []

    def test_missing_data_key_falls_back_to_inputs(self):
        client = _make_client(sandbox=True)
        result = client._normalize({"status": "completed"}, "Jane", "Doe")

        assert result["name"] == "Jane Doe"
        assert result["methods"] == []

    def test_job_title_field_used_when_position_absent(self):
        client = _make_client(sandbox=True)
        row = {**FULL_ROW, "position": None, "job_title": "HR Manager"}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["role_title"] == "HR Manager"

    def test_role_title_is_none_when_both_title_fields_absent(self):
        client = _make_client(sandbox=True)
        row = {k: v for k, v in FULL_ROW.items() if k != "position"}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["role_title"] is None

    def test_email_without_at_sign_is_skipped(self):
        client = _make_client(sandbox=True)
        row = {**FULL_ROW, "emails": [{"email": "not-an-email"}]}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["methods"] == []

    def test_email_entry_with_empty_value_is_skipped(self):
        client = _make_client(sandbox=True)
        row = {**FULL_ROW, "emails": [{"email": ""}]}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["methods"] == []

    def test_non_dict_email_entry_is_skipped(self):
        client = _make_client(sandbox=True)
        row = {**FULL_ROW, "emails": ["jane.doe@example.com"]}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["methods"] == []

    def test_non_list_emails_field_yields_empty_methods(self):
        client = _make_client(sandbox=True)
        row = {**FULL_ROW, "emails": None}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["methods"] == []

    def test_multiple_emails_all_appear_in_methods(self):
        client = _make_client(sandbox=True)
        row = {
            **FULL_ROW,
            "emails": [
                {"email": "jane.doe@example.com"},
                {"email": "j.doe@example.com"},
            ],
        }
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert len(result["methods"]) == 2
        assert result["methods"][0]["value"] == "jane.doe@example.com"
        assert result["methods"][1]["value"] == "j.doe@example.com"

    def test_api_name_overrides_input_name(self):
        client = _make_client(sandbox=True)
        row = {**FULL_ROW, "first_name": "Jonathan", "last_name": "Doeman"}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["name"] == "Jonathan Doeman"

    def test_input_name_used_when_api_name_absent(self):
        client = _make_client(sandbox=True)
        row = {k: v for k, v in FULL_ROW.items() if k not in ("first_name", "last_name")}
        result = client._normalize(self._completed_payload(row), "Jane", "Doe")

        assert result["name"] == "Jane Doe"

    def test_non_dict_data_row_falls_back_gracefully(self):
        client = _make_client(sandbox=True)
        result = client._normalize({"status": "completed", "data": ["unexpected-string"]}, "Jane", "Doe")

        assert result["name"] == "Jane Doe"
        assert result["methods"] == []

    def test_returned_dict_has_exactly_three_keys(self):
        client = _make_client(sandbox=True)
        result = client._normalize(self._completed_payload(FULL_ROW), "Jane", "Doe")

        assert set(result.keys()) == {"name", "role_title", "methods"}
