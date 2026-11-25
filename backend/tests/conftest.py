"""
Test fixtures and configuration for backend pytest suite.
"""

import os
import sys
from pathlib import Path
import pytest

# Ensure repository root and backend directories are on sys.path
CWD = Path.cwd().resolve()
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = REPO_ROOT / "backend"

for p in (CWD, REPO_ROOT, BACKEND_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from fastapi.testclient import TestClient

# Set test environment variables before importing app
os.environ["ENVIRONMENT"] = "testing"
os.environ["SECRET_KEY"] = "test-secret-key-for-unit-testing-min-32-chars-long!"
os.environ["GEMINI_MOCK_MODE"] = "true"

try:
    from backend.app.main import app
except ModuleNotFoundError:
    from app.main import app


@pytest.fixture(scope="session")
def client():
    """Provides a TestClient instance for API tests."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def authenticated_user():
    """Override the current user dependency for role-based API tests."""
    from backend.app.core.security import get_current_user

    previous_override = app.dependency_overrides.get(get_current_user)
    had_previous_override = get_current_user in app.dependency_overrides

    def set_user(user):
        app.dependency_overrides[get_current_user] = lambda: user

    try:
        yield set_user
    finally:
        if had_previous_override:
            app.dependency_overrides[get_current_user] = previous_override
        else:
            app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def isolated_api_state():
    """Restore mutable API sample data after each test."""
    import copy
    from backend.app.api.v1.suppression import SUPPRESSION_LIST
    from backend.app.api.v1.error_center import SAMPLE_ERRORS

    original_suppressions = copy.deepcopy(SUPPRESSION_LIST)
    original_errors = copy.deepcopy(SAMPLE_ERRORS)

    try:
        yield
    finally:
        SUPPRESSION_LIST[:] = original_suppressions
        SAMPLE_ERRORS[:] = original_errors