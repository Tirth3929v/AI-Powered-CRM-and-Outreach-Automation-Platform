"""BE-28 campaign API contract, authorization, and PostgreSQL tests."""

import os
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from psycopg.errors import ForeignKeyViolation
from psycopg_pool import ConnectionPool

from backend.app.core import db
from backend.app.core.security import create_access_token
from backend.app.repositories import campaigns_repo

URL = "/api/v1/campaigns"
USER = "33333333-3333-3333-3333-333333333333"
CID = "d0000001-0000-0000-0000-000000000001"
ITEM = {"id": CID, "name": "Placement drive", "purpose": "Invite employers",
        "status": "draft", "daily_limit": 50}


def auth(role="campaign_manager", user_id=USER):
    token = create_access_token({"sub": user_id, "role": role})
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_contract(client):
    with patch.object(campaigns_repo, "create_campaign", return_value=ITEM) as create:
        response = client.post(URL, json={"name": " Placement drive ", "purpose": ITEM["purpose"]}, headers=auth())
    assert response.status_code == 201
    assert response.json() == ITEM
    create.assert_called_once_with(name=ITEM["name"], purpose=ITEM["purpose"], status="draft",
                                   daily_limit=50, created_by=USER)
    with patch.object(campaigns_repo, "list_campaigns", return_value=[ITEM]):
        response = client.get(URL, headers=auth("admin"))
    assert response.status_code == 200
    assert response.json() == [ITEM]


def test_get_patch_and_delete(client):
    path = f"{URL}/{CID}"
    with patch.object(campaigns_repo, "get_campaign_by_id", return_value=ITEM):
        response = client.get(path, headers=auth())
    assert response.status_code == 200
    assert response.json() == ITEM
    updated = {**ITEM, "status": "paused"}
    with patch.object(campaigns_repo, "update_campaign", return_value=updated) as update:
        response = client.patch(path, json={"status": "paused"}, headers=auth())
    assert response.status_code == 200
    assert response.json() == updated
    update.assert_called_once_with(UUID(CID), status="paused")
    with patch.object(campaigns_repo, "delete_campaign", return_value=True):
        response = client.delete(path, headers=auth())
    assert response.status_code == 204
    assert response.content == b""


@pytest.mark.parametrize("method,repo_method", [
    ("GET", "get_campaign_by_id"), ("PATCH", "update_campaign"), ("DELETE", "delete_campaign"),
])
def test_unknown_campaign(client, method, repo_method):
    with patch.object(campaigns_repo, repo_method, return_value=None):
        body = {"status": "active"} if method == "PATCH" else None
        response = client.request(method, f"{URL}/{CID}", headers=auth(), json=body)
    assert response.status_code == 404
    assert response.json()["code"] == "RESOURCE_NOT_FOUND"


@pytest.mark.parametrize("body", [
    {"name": "Missing purpose"}, {"purpose": "Missing name"}, {"name": "  ", "purpose": "Invite"},
    {"name": "x" * 256, "purpose": "Invite"}, {"name": "Drive", "purpose": "\t "},
    {"name": "Bad\x00name", "purpose": "Invite"}, {"name": "Drive", "purpose": "Invite", "created_by": USER},
])
def test_invalid_create(client, body):
    with patch.object(campaigns_repo, "create_campaign") as create:
        assert client.post(URL, json=body, headers=auth()).status_code == 422
    create.assert_not_called()


@pytest.mark.parametrize("body", [
    {}, {"name": None}, {"purpose": " "}, {"status": "sent"}, {"daily_limit": -1},
    {"daily_limit": 0}, {"daily_limit": True}, {"daily_limit": 2**31}, {"dailyLimit": 4},
])
def test_invalid_patch(client, body):
    with patch.object(campaigns_repo, "update_campaign") as update:
        assert client.patch(f"{URL}/{CID}", json=body, headers=auth()).status_code == 422
    update.assert_not_called()


def test_malformed_id(client):
    assert client.get(f"{URL}/bad-id", headers=auth()).status_code == 422


@pytest.mark.parametrize("method,path,body", [
    ("GET", URL, None), ("POST", URL, {"name": "Drive", "purpose": "Invite"}),
    ("GET", f"{URL}/{CID}", None), ("PATCH", f"{URL}/{CID}", {"status": "active"}),
    ("DELETE", f"{URL}/{CID}", None),
])
def test_role_and_authentication_required(client, method, path, body):
    assert client.request(method, path, headers=auth("researcher"), json=body).status_code == 403
    assert client.request(method, path, json=body).status_code in (401, 403)


def test_cannot_delete_referenced_campaign(client):
    with patch.object(campaigns_repo, "delete_campaign", side_effect=ForeignKeyViolation()):
        response = client.delete(f"{URL}/{CID}", headers=auth())
    assert response.status_code == 409
    assert response.json()["code"] == "RESOURCE_CONFLICT"


@pytest.fixture
def postgres_actor(monkeypatch):
    """Use a migrated test database and clean up only rows owned by this test."""
    dsn = os.getenv("CAMPAIGN_TEST_DATABASE_URL")
    if not dsn:
        pytest.skip("set CAMPAIGN_TEST_DATABASE_URL to a migrated PostgreSQL test database")
    user = str(uuid4())
    with ConnectionPool(dsn, min_size=1, max_size=2, timeout=5) as pool:
        monkeypatch.setattr(db, "get_pool", lambda: pool)
        with pool.connection() as conn:
            conn.execute("INSERT INTO users (id, email, full_name, password_hash) VALUES (%s, %s, %s, %s)",
                         (user, f"{user}@example.invalid", "Campaign test", "unused"))
        try:
            yield user, pool
        finally:
            with pool.connection() as conn:
                conn.execute("DELETE FROM campaigns WHERE created_by = %s", (user,))
                conn.execute("DELETE FROM users WHERE id = %s", (user,))


@pytest.mark.integration_db
def test_crud_against_postgres(client, postgres_actor):
    user, pool = postgres_actor
    headers = auth(user_id=user)
    created = client.post(URL, headers=headers, json={"name": "Intern's drive", "purpose": "Invite employers"})
    assert created.status_code == 201
    record = created.json()
    assert record["status"] == "draft" and record["daily_limit"] == 50
    path = f"{URL}/{record['id']}"
    with pool.connection() as conn:
        creator = conn.execute("SELECT created_by FROM campaigns WHERE id = %s", (record["id"],)).fetchone()
        assert creator == (UUID(user),)
    assert record in client.get(URL, headers=headers).json()
    assert client.get(path, headers=headers).json() == record
    changes = {"name": "Next drive", "status": "active", "daily_limit": 5}
    assert client.patch(path, headers=headers, json=changes).json() == {**record, **changes}
    assert client.get(path, headers=headers).json() == {**record, **changes}
    assert client.delete(path, headers=headers).status_code == 204
    assert client.get(path, headers=headers).status_code == 404
