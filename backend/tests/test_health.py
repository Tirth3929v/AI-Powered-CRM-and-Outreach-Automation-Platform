"""
Unit tests covering Health check and middleware functionality (BE-01).
"""

from fastapi.testclient import TestClient

from backend.app.main import app


def test_health_endpoint(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data
    assert "timestamp" in data
    assert "x-correlation-id" in response.headers


def test_system_health_endpoint(client):
    response = client.get("/api/v1/system/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "daily_credit_budget" in data
    assert "monthly_credit_budget" in data


def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "docs" in data
    assert "health" in data


def test_validation_error_returns_422_and_correlation_id():
    def validation_route(limit: int):
        return {"limit": limit}

    app.add_api_route(
        "/test-validation-error",
        validation_route,
        methods=["GET"],
    )

    try:
        with TestClient(app, raise_server_exceptions=False) as test_client:
            response = test_client.get(
                "/test-validation-error?limit=invalid"
            )
    finally:
        app.router.routes[:] = [
            route for route in app.router.routes
            if getattr(route, "path", None) != "/test-validation-error"
        ]

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.headers.get("X-Correlation-ID")
    assert (
        response.json()["correlation_id"]
        == response.headers["X-Correlation-ID"]
    )


def test_unexpected_error_returns_safe_500_and_correlation_id():
    def unexpected_error():
        raise RuntimeError("SECRET_DATABASE_PASSWORD")

    app.add_api_route(
        "/test-unexpected-error",
        unexpected_error,
        methods=["GET"],
    )

    try:
        with TestClient(app, raise_server_exceptions=False) as test_client:
            response = test_client.get("/test-unexpected-error")
    finally:
        app.router.routes[:] = [
            route for route in app.router.routes
            if getattr(route, "path", None) != "/test-unexpected-error"
        ]

    assert response.status_code == 500
    assert response.json()["code"] == "INTERNAL_SERVER_ERROR"
    assert "SECRET_DATABASE_PASSWORD" not in response.text
    assert response.headers.get("X-Correlation-ID")
    assert (
        response.json()["correlation_id"]
        == response.headers["X-Correlation-ID"]
    )


def test_correlation_id_is_propagated(client):
    supplied_id = "test-correlation-123"

    response = client.get(
        "/api/v1/health",
        headers={"X-Correlation-ID": supplied_id},
    )

    assert response.headers["X-Correlation-ID"] == supplied_id