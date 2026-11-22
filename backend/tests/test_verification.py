"""Tests for lead contact email verification."""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from backend.app.services.verification_service import (
    EmailNotFoundError,
    LeadNotFoundError,
    verify_lead_contact_email,
)


@patch("backend.app.services.verification_service.get_lead_by_id")
def test_raises_error_when_lead_not_found(mock_get_lead):
    mock_get_lead.return_value = None

    with pytest.raises(LeadNotFoundError):
        verify_lead_contact_email("missing-lead")

    mock_get_lead.assert_called_once_with("missing-lead")


@patch("backend.app.services.verification_service.get_lead_by_id")
def test_raises_error_when_lead_has_no_email(mock_get_lead):
    mock_get_lead.return_value = {
        "contacts": [
            {
                "methods": [
                    {"id": "phone-1", "kind": "phone", "value": "123456"}
                ]
            }
        ]
    }

    with pytest.raises(EmailNotFoundError):
        verify_lead_contact_email("lead-1")


@patch("backend.app.services.verification_service.transaction")
@patch("backend.app.services.verification_service.EmailVerifierClient")
@patch("backend.app.services.verification_service.get_lead_by_id")
def test_saves_verification_result(
    mock_get_lead,
    mock_verifier_class,
    mock_transaction,
):
    mock_get_lead.return_value = {
        "contacts": [
            {
                "methods": [
                    {
                        "id": "email-method-1",
                        "kind": "email",
                        "value": "person@example.com",
                    }
                ]
            }
        ]
    }

    mock_verifier = mock_verifier_class.return_value
    mock_verifier.verify.return_value = {
        "result": "deliverable",
        "raw_response": {"provider": "test"},
    }

    checked_at = datetime.now(timezone.utc)

    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchone.return_value = (checked_at,)

    transaction_context = MagicMock()
    transaction_context.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    mock_transaction.return_value = transaction_context

    result = verify_lead_contact_email("lead-1")

    mock_verifier.verify.assert_called_once_with("person@example.com")

    assert result["status"] == "completed"
    assert result["result"] == "deliverable"
    assert result["checked_at"] == checked_at.isoformat()

    assert cursor.execute.call_count == 2

    update_call = cursor.execute.call_args_list[0]
    assert "UPDATE contact_methods" in update_call.args[0]
    assert update_call.args[1] == ("deliverable", "email-method-1")

    insert_call = cursor.execute.call_args_list[1]
    assert "INSERT INTO verification_results" in insert_call.args[0]
    assert insert_call.args[1][0] == "email-method-1"
    assert insert_call.args[1][1] == "deliverable"
    assert insert_call.args[1][2].obj == {"provider": "test"}


@patch("backend.app.services.verification_service.transaction")
@patch("backend.app.services.verification_service.EmailVerifierClient")
@patch("backend.app.services.verification_service.get_lead_by_id")
def test_invalid_provider_result_is_saved_as_unknown(
    mock_get_lead,
    mock_verifier_class,
    mock_transaction,
):
    mock_get_lead.return_value = {
        "contacts": [
            {
                "methods": [
                    {
                        "id": "email-method-2",
                        "kind": "email",
                        "value": "person@example.com",
                    }
                ]
            }
        ]
    }

    mock_verifier_class.return_value.verify.return_value = {
        "result": "unexpected-value",
        "raw_response": {},
    }

    checked_at = datetime.now(timezone.utc)

    conn = MagicMock()
    cursor = MagicMock()
    cursor.fetchone.return_value = (checked_at,)

    transaction_context = MagicMock()
    transaction_context.__enter__.return_value = conn
    conn.cursor.return_value.__enter__.return_value = cursor
    mock_transaction.return_value = transaction_context

    result = verify_lead_contact_email("lead-2")

    assert result["result"] == "unknown"
    assert cursor.execute.call_args_list[0].args[1] == (
        "unknown",
        "email-method-2",
    )

from backend.app.main import app
from backend.app.core.security import get_current_user


def test_verify_endpoint_success(client):
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "admin-1",
        "email": "admin@example.com",
        "role": "admin",
    }

    try:
        with patch(
            "backend.app.api.v1.verification.verify_lead_contact_email",
            return_value={
                "status": "completed",
                "result": "unknown",
                "checked_at": "2026-11-02T09:00:00+00:00",
            },
        ) as mock_verify:
            response = client.post("/api/v1/leads/lead-1/verify")

        assert response.status_code == 200
        assert response.json()["result"] == "unknown"
        mock_verify.assert_called_once_with("lead-1")
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_verify_endpoint_returns_404_for_missing_lead(client):
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "admin-1",
        "email": "admin@example.com",
        "role": "admin",
    }

    try:
        with patch(
            "backend.app.api.v1.verification.verify_lead_contact_email",
            side_effect=LeadNotFoundError("Lead not found."),
        ):
            response = client.post("/api/v1/leads/missing-lead/verify")

        assert response.status_code == 404
        assert response.json()["detail"] == "Lead not found."
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_verify_endpoint_rejects_user_role(client):
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "user-1",
        "email": "user@example.com",
        "role": "user",
    }

    try:
        response = client.post("/api/v1/leads/lead-1/verify")

        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)
