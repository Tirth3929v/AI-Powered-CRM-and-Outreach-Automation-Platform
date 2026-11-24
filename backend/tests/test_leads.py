
import pytest
from unittest.mock import patch

from backend.app.main import app
from backend.app.core.security import get_current_user
from backend.app.api.v1.leads import SAMPLE_LEADS


@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "test-user",
        "email": "test@example.com",
        "full_name": "Test User",
        "role": "user",
    }

    yield

    app.dependency_overrides.pop(get_current_user, None)


def test_list_leads_uses_repository(client):
    with patch(
        "backend.app.api.v1.leads.leads_repo.list_leads",
        return_value=(SAMPLE_LEADS[:1], 1),
        create=True,
    ) as mock_list:
        response = client.get("/api/v1/leads")

    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["page"] == 1
    assert data["page_size"] == 25
    assert len(data["items"]) == 1

    mock_list.assert_called_once()


def test_list_leads_passes_filters(client):
    with patch(
        "backend.app.api.v1.leads.leads_repo.list_leads",
        return_value=([], 0),
        create=True,
    ) as mock_list:
        response = client.get(
            "/api/v1/leads",
            params={
                "source": "Internshala",
                "experience_min": 1,
                "experience_max": 5,
                "score_band": "high",
                "status": "verified",
                "assigned_to": "user-123",
                "search": "Python",
                "sort_by": "score",
                "sort_order": "asc",
            },
        )

    assert response.status_code == 200

    filters = mock_list.call_args.kwargs["filters"]

    assert filters["source"] == "Internshala"
    assert filters["experience_min"] == 1
    assert filters["experience_max"] == 5
    assert filters["score_band"] == "high"
    assert filters["status"] == "verified"
    assert filters["assigned_to"] == "user-123"
    assert filters["search"] == "Python"
    assert filters["sort_by"] == "score"
    assert filters["sort_order"] == "asc"


def test_list_leads_rejects_invalid_experience_range(client):
    response = client.get(
        "/api/v1/leads",
        params={
            "experience_min": 10,
            "experience_max": 2,
        },
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page": -1},
        {"page_size": 0},
        {"page_size": 101},
        {"status": "invalid_status"},
        {"score_band": "invalid_band"},
        {"sort_by": "title; DROP TABLE users;--"},
        {"sort_order": "random"},
    ],
)
def test_list_leads_rejects_invalid_parameters(client, params):
    response = client.get("/api/v1/leads", params=params)

    assert response.status_code == 422


def test_list_leads_supports_custom_pagination(client):
    with patch(
        "backend.app.api.v1.leads.leads_repo.list_leads",
        return_value=([], 35),
        create=True,
    ) as mock_list:
        response = client.get(
            "/api/v1/leads",
            params={"page": 2, "page_size": 10},
        )

    assert response.status_code == 200

    data = response.json()

    assert data["page"] == 2
    assert data["page_size"] == 10
    assert data["total"] == 35
    assert data["total_pages"] == 4

    mock_list.assert_called_once()
    assert mock_list.call_args.kwargs["page"] == 2
    assert mock_list.call_args.kwargs["page_size"] == 10


def test_get_lead_by_id_uses_repository(client):
    lead = SAMPLE_LEADS[0]

    with patch(
        "backend.app.api.v1.leads.leads_repo.get_lead_by_id",
        return_value=lead,
        create=True,
    ) as mock_get:
        response = client.get(f"/api/v1/leads/{lead['id']}")

    assert response.status_code == 200
    assert response.json()["id"] == lead["id"]

    mock_get.assert_called_once_with(lead_id=lead["id"])


def test_get_missing_lead_returns_standard_404(client):
    with patch(
        "backend.app.api.v1.leads.leads_repo.get_lead_by_id",
        return_value=None,
        create=True,
    ):
        response = client.get("/api/v1/leads/nonexistent-id")

    assert response.status_code == 404

    data = response.json()["detail"]

    assert data["status"] == 404
    assert data["code"] == "RESOURCE_NOT_FOUND"
    assert "message" in data
