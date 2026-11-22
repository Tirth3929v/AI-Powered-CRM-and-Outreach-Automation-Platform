import logging

import pytest

from backend.app.integrations.email_verifier import (
    EmailVerifier,
    EmailVerifierClient,
    VerificationStatus,
)


@pytest.mark.parametrize(
    ("provider_status", "expected"),
    [
        ("DELIVERABLE", "deliverable"),
        ("UNDELIVERABLE", "undeliverable"),
        ("RISKY", "risky"),
        ("UNKNOWN", "unknown"),
    ],
)
def test_maps_provider_deliverability_statuses(provider_status, expected):
    assert EmailVerifier._map_provider_response({"deliverability": provider_status}) == expected


def test_maps_catch_all_from_classic_response():
    payload = {
        "deliverability": "DELIVERABLE",
        "is_catchall_email": {"value": True, "text": "TRUE"},
    }
    assert EmailVerifier._map_provider_response(payload) == "catch_all"


def test_maps_catch_all_from_current_response_shape():
    payload = {
        "email_deliverability": {"status": "DELIVERABLE"},
        "email_quality": {"is_catchall": True},
    }
    assert EmailVerifier._map_provider_response(payload) == "catch_all"


def test_unknown_provider_status_is_failed():
    assert EmailVerifier._map_provider_response({"deliverability": "NOT_A_STATUS"}) == "failed"


def test_sandbox_returns_configured_mock_without_provider_call(monkeypatch):
    verifier = EmailVerifier(
        sandbox=True,
        sandbox_status="unknown",
        sandbox_responses={"demo@example.com": "deliverable"},
    )

    def must_not_call_provider(*args, **kwargs):
        raise AssertionError("Provider must not be called in sandbox mode")

    monkeypatch.setattr(verifier, "_request_provider", must_not_call_provider)
    assert verifier.verify("demo@example.com") == "deliverable"
    assert verifier.verify("other@example.com") == "unknown"


@pytest.mark.parametrize("status", [item.value for item in VerificationStatus])
def test_sandbox_supports_all_six_statuses(status):
    verifier = EmailVerifier(sandbox=True, sandbox_status=status)
    assert verifier.verify("demo@example.com") == status


def test_api_key_is_required_from_environment(monkeypatch):
    monkeypatch.delenv("ABSTRACT_API_KEY", raising=False)
    verifier = EmailVerifier()
    assert verifier.verify("demo@example.com") == "failed"


def test_live_request_uses_environment_key(monkeypatch):
    monkeypatch.setenv("ABSTRACT_API_KEY", "test-key")
    verifier = EmailVerifier()
    monkeypatch.setattr(
        verifier, "_request_provider",
        lambda email, api_key: {"deliverability": "DELIVERABLE"}
    )
    assert verifier.verify("demo@example.com") == "deliverable"


def test_provider_failure_returns_failed(monkeypatch):
    monkeypatch.setenv("ABSTRACT_API_KEY", "test-key")
    verifier = EmailVerifier()

    def fail(*args, **kwargs):
        raise TimeoutError("sensitive provider detail")

    monkeypatch.setattr(verifier, "_request_provider", fail)
    assert verifier.verify("demo@example.com") == "failed"


def test_logs_mask_email_address(caplog, monkeypatch):
    monkeypatch.delenv("ABSTRACT_API_KEY", raising=False)
    verifier = EmailVerifier()
    with caplog.at_level(logging.ERROR):
        verifier.verify("private.person@example.com")
    assert "private.person@example.com" not in caplog.text
    assert "p***@example.com" in caplog.text


def test_invalid_email_input_returns_failed():
    assert EmailVerifier(sandbox=True).verify("") == "failed"


def test_email_verifier_client_adapts_normalized_result(monkeypatch):
    monkeypatch.setattr(EmailVerifier, "verify", lambda self, email: "deliverable")

    result = EmailVerifierClient().verify("person@example.com")

    assert result == {
        "result": "deliverable",
        "raw_response": {"normalized_status": "deliverable"},
    }
