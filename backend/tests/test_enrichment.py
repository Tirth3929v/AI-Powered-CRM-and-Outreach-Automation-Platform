import pytest
from types import SimpleNamespace

from backend.app.main import app
from backend.app.core.security import get_current_user
from backend.app.services.enrichment_service import (
    enrich_lead,
    save_enriched_contact,
    save_enrichment_request,
    validate_credit_confirmation,
)


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "test-user",
        "email": "test@example.com",
        "full_name": "Test User",
        "role": "researcher",
    }

    yield

    app.dependency_overrides.pop(get_current_user, None)


def test_enrichment_missing_confirmed_credits_returns_422(
    client, monkeypatch
):
    def fail_if_called(*args, **kwargs):
        pytest.fail("Database operation should not be called")

    monkeypatch.setattr(
        "backend.app.api.v1.enrichment.enrich_lead",
        fail_if_called
    )

    monkeypatch.setattr(
        "backend.app.services.enrichment_service.get_conn",
        fail_if_called
    )

    response = client.post(
        "/api/v1/leads/1/enrich",
        json={"provider": "contactout"}
    )

    assert response.status_code == 422


def test_monthly_credit_budget_exceeded(monkeypatch):
    monkeypatch.setattr(
        "backend.app.services.enrichment_service.get_settings",
        lambda: SimpleNamespace(MONTHLY_CREDIT_BUDGET=5)
    )

    with pytest.raises(
        ValueError,
        match="Monthly credit budget exceeded"
    ):
        validate_credit_confirmation(
            estimated_credits=1,
            confirmed_credits=1,
            monthly_used=5
        )


def test_enrichment_request_saves_provider_and_timestamp():
    class FakeCursor:
        def execute(self, query, params):
            self.query = query
            self.params = params

        def fetchone(self):
            return (101,)

    cursor = FakeCursor()
    request_id = save_enrichment_request(
        cur=cursor,
        lead_id=1,
        provider="contactout",
        credits_used=1
    )

    assert request_id == 101
    assert "INSERT INTO enrichment_requests" in cursor.query
    assert "provider" in cursor.query
    assert "created_at" in cursor.query
    assert "NOW()" in cursor.query
    assert cursor.params == (1, "contactout", 1, "completed")


def test_enriched_contact_is_saved():
    class FakeCursor:
        def execute(self, query, params):
            self.query = query
            self.params = params

        def fetchone(self):
            return (201,)

    cursor = FakeCursor()

    contact_id = save_enriched_contact(
        cur=cursor,
        lead_id=1,
        contact={
            "email": "jane@example.com",
            "phone": "9876543210"
        },
        provider="contactout"
    )

    assert contact_id == 201
    assert "INSERT INTO contacts" in cursor.query
    assert cursor.params == (
        1,
        "jane@example.com",
        "9876543210",
        "contactout"
    )


def test_enrich_lead_budget_exceeded_before_calling_provider(monkeypatch):
    class FakeCursor:
        def execute(self, query, params=None):
            pass

        def fetchone(self):
            return (10,)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    class FakeConn:
        def cursor(self):
            return FakeCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    monkeypatch.setattr(
        "backend.app.services.enrichment_service.get_conn",
        lambda: FakeConn()
    )
    monkeypatch.setattr(
        "backend.app.services.enrichment_service.get_settings",
        lambda: SimpleNamespace(MONTHLY_CREDIT_BUDGET=5)
    )

    def fail_if_provider_called(lead):
        pytest.fail("Provider lookup should not have been called when budget is exceeded")

    monkeypatch.setattr(
        "backend.app.services.enrichment_service.mock_contactout_lookup",
        fail_if_provider_called
    )

    with pytest.raises(ValueError, match="Monthly credit budget exceeded"):
        enrich_lead(
            lead_id=1,
            lead={"id": 1},
            provider="contactout",
            confirmed_credits=1
        )
