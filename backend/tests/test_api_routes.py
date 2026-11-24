"""API route tests for authentication, campaigns, approvals and guardrails."""

import hashlib

import pytest


ADMIN = {
    "id": "test-admin",
    "email": "admin@test.com",
    "full_name": "Test Admin",
    "role": "admin",
}

RESEARCHER = {
    "id": "test-researcher",
    "email": "researcher@test.com",
    "full_name": "Test Researcher",
    "role": "researcher",
}

DEVELOPER = {
    "id": "test-developer",
    "email": "developer@test.com",
    "full_name": "Test Developer",
    "role": "developer",
}

CAMPAIGN_MANAGER = {
    "id": "test-manager",
    "email": "manager@test.com",
    "full_name": "Test Manager",
    "role": "campaign_manager",
}


# ---------------- AUTH ----------------

def test_login_success(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123!"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "Bearer"
    assert body["user"]["role"] == "admin"
    assert body["access_token"]


def test_login_invalid_credentials(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "wrong@example.com", "password": "wrong"},
    )

    assert response.status_code == 401


def test_login_missing_password(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com"},
    )

    assert response.status_code == 422


def test_me_without_token_returns_unauthorized(client):
    response = client.get("/api/v1/auth/me")

    assert response.status_code in (401, 403)


def test_me_with_valid_token(client):
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "Password123!"},
    )
    token = login.json()["access_token"]

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "admin"


# ---------------- APPROVALS ----------------

def test_approve_draft_success(client, authenticated_user):
    authenticated_user(ADMIN)

    response = client.post(
        "/api/v1/approvals",
        json={
            "draft_id": "draft-test-1",
            "approved": True,
            "edited_subject": "Test subject",
            "edited_body": "Test body",
        },
    )

    assert response.status_code == 200
    body = response.json()
    expected_hash = hashlib.sha256(
        b"Test subject:Test body"
    ).hexdigest()

    assert body["draft_id"] == "draft-test-1"
    assert body["content_hash"] == expected_hash
    assert body["approved_by"] == ADMIN["id"]


def test_reject_draft(client, authenticated_user):
    authenticated_user(CAMPAIGN_MANAGER)

    response = client.post(
        "/api/v1/approvals",
        json={"draft_id": "draft-test-2", "approved": False},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "rejected",
        "draft_id": "draft-test-2",
    }


def test_approval_missing_fields_returns_422(client, authenticated_user):
    authenticated_user(ADMIN)

    response = client.post(
        "/api/v1/approvals",
        json={"draft_id": "draft-test"},
    )

    assert response.status_code == 422


def test_researcher_cannot_approve_draft(client, authenticated_user):
    authenticated_user(RESEARCHER)

    response = client.post(
        "/api/v1/approvals",
        json={"draft_id": "draft-test", "approved": True},
    )

    assert response.status_code == 403


# ---------------- CAMPAIGNS ----------------

def test_list_campaigns_success(client, authenticated_user):
    authenticated_user(ADMIN)

    response = client.get("/api/v1/campaigns")

    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert response.json()[0]["status"] == "active"


def test_generate_campaign_draft_success(client, authenticated_user):
    authenticated_user(CAMPAIGN_MANAGER)

    response = client.post(
        "/api/v1/campaigns/campaign-test/drafts",
        json={
            "opportunity_id": "opportunity-test",
            "recipient_contact_method_id": "contact-test",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["campaign_id"] == "campaign-test"
    assert body["draft_id"]


def test_generate_draft_missing_fields_returns_422(client, authenticated_user):
    authenticated_user(ADMIN)

    response = client.post(
        "/api/v1/campaigns/campaign-test/drafts",
        json={"opportunity_id": "opportunity-test"},
    )

    assert response.status_code == 422


def test_researcher_cannot_list_campaigns(client, authenticated_user):
    authenticated_user(RESEARCHER)

    response = client.get("/api/v1/campaigns")

    assert response.status_code == 403


# ---------------- SUPPRESSION ----------------

def test_list_suppressions_success(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(RESEARCHER)

    response = client.get("/api/v1/suppression")

    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert len(response.json()) >= 2


def test_add_suppression_success(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(ADMIN)

    response = client.post(
        "/api/v1/suppression",
        json={
            "value": "  NEW@EXAMPLE.COM ",
            "kind": "email",
            "reason": "Test opt out",
        },
    )

    assert response.status_code == 201
    assert response.json()["value"] == "new@example.com"
    assert response.json()["kind"] == "email"


def test_duplicate_suppression_returns_409(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(ADMIN)

    response = client.post(
        "/api/v1/suppression",
        json={
            "value": "optout@example.com",
            "kind": "email",
            "reason": "Duplicate test",
        },
    )

    assert response.status_code == 409


def test_suppression_missing_fields_returns_422(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(ADMIN)

    response = client.post(
        "/api/v1/suppression",
        json={"value": "new@example.com"},
    )

    assert response.status_code == 422


def test_researcher_cannot_add_suppression(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(RESEARCHER)

    response = client.post(
        "/api/v1/suppression",
        json={
            "value": "new@example.com",
            "kind": "email",
            "reason": "Test",
        },
    )

    assert response.status_code == 403


# ---------------- ERROR CENTER ----------------

def test_error_webhook_records_error(client, isolated_api_state):
    response = client.post(
        "/api/v1/guardrails/error-webhook",
        json={
            "workflow": "test_workflow",
            "job_id": "test_job",
            "correlation_id": "test-correlation",
            "failed_step": "test_step",
            "category": "rate_limit",
            "redacted_message": "Test error",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "recorded"
    assert response.json()["error_id"]


def test_error_webhook_disables_replay_for_send_timeout(
    client, isolated_api_state
):
    response = client.post(
        "/api/v1/guardrails/error-webhook",
        json={
            "workflow": "test_workflow",
            "job_id": "test_job",
            "correlation_id": "test-correlation",
            "failed_step": "send",
            "category": "send_timeout",
            "redacted_message": "Send timed out",
            "replay_eligible": True,
        },
    )

    assert response.status_code == 200

    from backend.app.api.v1.error_center import SAMPLE_ERRORS
    created = SAMPLE_ERRORS[-1]
    assert created["replay_eligible"] is False


def test_list_errors_requires_developer_or_admin(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(DEVELOPER)

    response = client.get("/api/v1/error_center")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_replay_eligible_error(client, authenticated_user, isolated_api_state):
    authenticated_user(ADMIN)

    response = client.post("/api/v1/error_center/err_001/replay")

    assert response.status_code == 200
    assert response.json()["status"] == "replay_queued"


def test_replay_missing_error_returns_404(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(ADMIN)

    response = client.post("/api/v1/error_center/missing-error/replay")

    assert response.status_code == 404


def test_replay_ineligible_error_returns_409(
    client, authenticated_user, isolated_api_state
):
    authenticated_user(ADMIN)

    client.post(
        "/api/v1/guardrails/error-webhook",
        json={
            "workflow": "test_workflow",
            "job_id": "test_job",
            "correlation_id": "test-correlation",
            "failed_step": "send",
            "category": "send_timeout",
            "redacted_message": "Send timed out",
        },
    )

    from backend.app.api.v1.error_center import SAMPLE_ERRORS
    error_id = SAMPLE_ERRORS[-1]["id"]

    response = client.post(
        f"/api/v1/error_center/{error_id}/replay"
    )

    assert response.status_code == 409


# ---------------- PROVIDER CALLBACKS ----------------

def test_provider_callback_success(client):
    response = client.post(
        "/api/v1/callbacks",
        json={"provider_event_id": "event-test-1", "type": "delivered"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "received",
        "event_id": "event-test-1",
    }


def test_provider_callback_without_event_id(client):
    response = client.post("/api/v1/callbacks", json={})

    assert response.status_code == 200
    assert response.json()["event_id"] is None



def test_list_errors_forbidden_for_researcher(client, authenticated_user):
    authenticated_user(RESEARCHER)

    response = client.get("/api/v1/error_center")

    assert response.status_code == 403


def test_replay_error_forbidden_for_researcher(client, authenticated_user):
    authenticated_user(RESEARCHER)

    response = client.post("/api/v1/error_center/err_001/replay")

    assert response.status_code == 403


def test_admin_can_list_errors(client, authenticated_user):
    authenticated_user(ADMIN)

    response = client.get("/api/v1/error_center")

    assert response.status_code == 200


def test_list_errors_requires_authentication(client):
    response = client.get("/api/v1/error_center")

    assert response.status_code == 403

def test_provider_callback_duplicate_event(client):
    payload = {"provider_event_id": "event-duplicate-001"}

    first = client.post("/api/v1/callbacks", json=payload)
    second = client.post("/api/v1/callbacks", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()


def test_provider_callback_malformed_payload(client):
    response = client.post(
        "/api/v1/callbacks",
        content="{invalid json",
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
