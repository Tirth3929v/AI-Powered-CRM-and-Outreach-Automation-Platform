"""BE-27 regression tests without a live DB or JWT service."""

from contextlib import contextmanager
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api.v1 import lead_status
from backend.app.core.security import get_current_user
from backend.app.services.lead_lifecycle import is_valid_transition

LEAD_ID = "11111111-1111-4111-8111-111111111111"


class FakeCursor:
    def __init__(self, db):
        self.db = db
        self.last_row = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, query, params):
        statement = " ".join(query.split()).upper()
        self.db["queries"].append((statement, params))
        if statement.startswith("SELECT STATUS"):
            self.last_row = ((self.db["status"],)
                             if self.db["exists"] else None)
        elif statement.startswith("UPDATE OPPORTUNITIES"):
            self.db["status"] = params[0]
            self.db["updates"] += 1
        elif statement.startswith("INSERT INTO AUDIT_LOGS"):
            self.db["audits"] += 1

    def fetchone(self):
        return self.last_row


class FakeConnection:
    def __init__(self, db):
        self.db = db

    def cursor(self):
        return FakeCursor(self.db)


@pytest.fixture
def api(monkeypatch):
    db = {"status": "new", "exists": True, "updates": 0,
          "audits": 0, "queries": []}

    @contextmanager
    def fake_transaction():
        yield FakeConnection(db)

    monkeypatch.setattr(lead_status, "transaction", fake_transaction)
    app = FastAPI()
    app.include_router(lead_status.router, prefix="/api/v1")
    app.dependency_overrides[get_current_user] = lambda: {"id": "test-user"}
    with TestClient(app) as client:
        yield client, db


def test_retrieve_status(api):
    client, _ = api
    result = client.get(f"/api/v1/leads/{LEAD_ID}/status")
    assert result.status_code == 200
    assert result.json()["status"] == "new"


def test_valid_update_and_audit(api):
    client, db = api
    result = client.patch(f"/api/v1/leads/{LEAD_ID}/status",
                          json={"status": "verified"})
    assert result.status_code == 200
    assert result.json()["changed"] is True
    assert db["status"] == "verified"
    assert db["updates"] == db["audits"] == 1
    assert any("FOR UPDATE" in q for q, _ in db["queries"])


def test_invalid_value(api):
    client, db = api
    result = client.patch(f"/api/v1/leads/{LEAD_ID}/status",
                          json={"status": "unknown"})
    assert result.status_code == 422
    assert db["updates"] == 0


def test_missing_lead(api):
    client, db = api
    db["exists"] = False
    assert client.get(f"/api/v1/leads/{LEAD_ID}/status").status_code == 404
    assert client.patch(f"/api/v1/leads/{LEAD_ID}/status",
                        json={"status": "verified"}).status_code == 404


def test_invalid_uuid(api):
    client, _ = api
    assert client.get("/api/v1/leads/not-a-uuid/status").status_code == 404


def test_invalid_transition(api):
    client, db = api
    result = client.patch(f"/api/v1/leads/{LEAD_ID}/status",
                          json={"status": "sent"})
    assert result.status_code == 409
    assert db["updates"] == 0
    assert db["audits"] == 0


def test_same_status_is_noop(api):
    client, db = api
    result = client.patch(f"/api/v1/leads/{LEAD_ID}/status",
                          json={"status": "new"})
    assert result.status_code == 200
    assert result.json()["changed"] is False
    assert db["updates"] == db["audits"] == 0


def test_extra_field_rejected(api):
    client, _ = api
    result = client.patch(f"/api/v1/leads/{LEAD_ID}/status",
                          json={"status": "verified", "title": "overwritten"})
    assert result.status_code == 422


def test_terminal_status():
    assert not is_valid_transition("closed", "new")
    assert is_valid_transition("closed", "closed")
