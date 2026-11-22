
import pytest

from ai.diagnosis.payload_fixer import suggest_payload_fix


class FakeGeminiClient:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error

    def generate(self, prompt, schema=None, temperature=0.1):
        if self.error:
            raise self.error
        return self.response, {}


def make_response(changes, corrected_payload=None, retry=None):
    return {
        "summary": "Payload validation error.",
        "corrected_payload": corrected_payload,
        "changes": changes,
        "needs_human_input": [],
        "retry_parameters": retry,
    }


def test_valid_integer_conversion():
    payload = {"age": "20"}

    response = make_response(
        [{"path": "age", "issue": "Expected integer", "new_value": 20}],
        {"age": 20},
    )

    result = suggest_payload_fix(
        payload,
        "age must be integer",
        client=FakeGeminiClient(response),
    )

    assert result["corrected_payload"] == {"age": 20}
    assert len(result["changes"]) == 1
    assert result["needs_human_input"] == []


def test_reject_invented_value():
    payload = {"age": "wrong"}

    response = make_response(
        [{"path": "age", "issue": "Expected integer", "new_value": 20}],
        {"age": 20},
    )

    result = suggest_payload_fix(
        payload,
        "age must be integer",
        client=FakeGeminiClient(response),
    )

    assert result["corrected_payload"] is None
    assert result["changes"] == []
    assert result["needs_human_input"]


def test_missing_required_field():
    payload = {"name": "Test"}

    response = make_response(
        [{
            "path": "email",
            "issue": "Required field missing",
            "new_value": "test@example.com",
        }],
        {"name": "Test", "email": "test@example.com"},
    )

    result = suggest_payload_fix(
        payload,
        "Missing required email",
        client=FakeGeminiClient(response),
    )

    assert result["corrected_payload"] is None
    assert result["changes"] == []
    assert result["needs_human_input"]


def test_nested_array_conversion():
    payload = {
        "items": [
            {"quantity": "3"},
            {"quantity": 2},
        ]
    }

    response = make_response(
        [{
            "path": "items[0].quantity",
            "issue": "Expected integer",
            "new_value": 3,
        }]
    )

    result = suggest_payload_fix(
        payload,
        "First quantity must be integer",
        client=FakeGeminiClient(response),
    )

    assert result["corrected_payload"] == {
        "items": [
            {"quantity": 3},
            {"quantity": 2},
        ]
    }


def test_uncertain_iso_date():
    payload = {"delivery_date": "20/11/2026"}

    response = make_response(
        [{
            "path": "delivery_date",
            "issue": "Expected ISO 8601 date",
            "new_value": "2026-11-20",
        }]
    )

    result = suggest_payload_fix(
        payload,
        "Invalid ISO date",
        client=FakeGeminiClient(response),
    )

    assert result["corrected_payload"] is None
    assert result["needs_human_input"]


@pytest.mark.parametrize(
    "category",
    [
        "send_timeout",
        "provider_rejection",
        "permanent_provider_rejection",
    ],
)
def test_blocked_retry_categories(category):
    response = make_response(
        [],
        retry={"retry_count": 3, "delay_seconds": 60},
    )

    result = suggest_payload_fix(
        {"job_id": "123"},
        "Delivery failed",
        category=category,
        client=FakeGeminiClient(response),
    )

    assert result["retry_parameters"] is None


def test_api_failure_fallback():
    result = suggest_payload_fix(
        {"name": "Test"},
        "Validation error",
        client=FakeGeminiClient(
            error=TimeoutError("API timeout")
        ),
    )

    assert result["corrected_payload"] is None
    assert result["retry_parameters"] is None
    assert result["needs_human_input"]


def test_invalid_ai_response_fallback():
    result = suggest_payload_fix(
        {"name": "Test"},
        "Validation error",
        client=FakeGeminiClient({"unexpected": "data"}),
    )

    assert result["corrected_payload"] is None
    assert result["needs_human_input"]


@pytest.mark.parametrize(
    "retry_params",
    [
        {"retry_count": -1},
        {"delay_seconds": -10},
        {"batch_size": 201},
        {"batch_size": 0},
        {"batch_size": "100"},
        {"retry_count": True},
        {"unknown_parameter": 5},
    ],
)
def test_invalid_retry_parameters(retry_params):
    response = make_response(
        [],
        retry=retry_params,
    )

    result = suggest_payload_fix(
        {"job_id": "123"},
        "Temporary processing failure",
        category="temporary_error",
        client=FakeGeminiClient(response),
    )

    assert result["retry_parameters"] is None
    assert result["needs_human_input"]


def test_valid_retry_parameters():
    response = make_response(
        [],
        retry={
            "retry_count": 2,
            "delay_seconds": 30,
            "batch_size": 100,
        },
    )

    result = suggest_payload_fix(
        {"job_id": "123"},
        "Temporary processing failure",
        category="temporary_error",
        client=FakeGeminiClient(response),
    )

    assert result["retry_parameters"] == {
        "retry_count": 2,
        "delay_seconds": 30,
        "batch_size": 100,
    }


def test_preserves_email_and_api_key():
    """Corrections must preserve original sensitive values."""
    payload = {
        "email": "user@example.com",
        "api_key": "secret123",
        "age": "20",
    }

    response = make_response(
        [{
            "path": "age",
            "issue": "Expected integer",
            "new_value": 20,
        }]
    )

    result = suggest_payload_fix(
        payload,
        "age must be integer",
        client=FakeGeminiClient(response),
    )

    assert result["corrected_payload"] == {
        "email": "user@example.com",
        "api_key": "secret123",
        "age": 20,
    }

    assert payload == {
        "email": "user@example.com",
        "api_key": "secret123",
        "age": "20",
    }


@pytest.mark.parametrize(
    "sensitive_field",
    ["email", "api_key"],
)
def test_rejects_sensitive_field_changes(sensitive_field):
    """Gemini must not automatically modify sensitive fields."""
    payload = {
        "email": "user@example.com",
        "api_key": "secret123",
    }

    response = make_response(
        [{
            "path": sensitive_field,
            "issue": "Expected integer",
            "new_value": 123,
        }]
    )

    result = suggest_payload_fix(
        payload,
        "Invalid field type",
        client=FakeGeminiClient(response),
    )

    assert result["corrected_payload"] is None
    assert result["changes"] == []
    assert result["needs_human_input"]


@pytest.mark.parametrize(
    "retry_params",
    [
        {"retry_count": 6},
        {"delay_seconds": 3601},
    ],
)
def test_retry_safety_limits(retry_params):
    """Reject retry suggestions exceeding configured limits."""
    response = make_response(
        [],
        retry=retry_params,
    )

    result = suggest_payload_fix(
        {"job_id": "123"},
        "Temporary processing failure",
        category="temporary_error",
        client=FakeGeminiClient(response),
    )

    assert result["retry_parameters"] is None
    assert result["needs_human_input"]


def test_blocked_retry_category_case_insensitive():
    """Blocked retry categories must be case-insensitive."""
    response = make_response(
        [],
        retry={"retry_count": 2},
    )

    result = suggest_payload_fix(
        {"job_id": "123"},
        "Delivery failed",
        category="SEND_TIMEOUT",
        client=FakeGeminiClient(response),
    )

    assert result["retry_parameters"] is None


def test_gemini_receives_redacted_sensitive_data():
    """Gemini must not receive original sensitive values."""

    class CapturingGeminiClient(FakeGeminiClient):
        def generate(self, prompt, schema=None, temperature=0.1):
            self.captured_prompt = prompt
            return super().generate(
                prompt,
                schema=schema,
                temperature=temperature,
            )

    payload = {
        "email": "private.user@example.com",
        "api_key": "super-secret-api-key-123",
        "age": "20",
    }

    response = make_response([
        {
            "path": "age",
            "issue": "Expected integer",
            "new_value": 20,
        }
    ])

    client = CapturingGeminiClient(response)

    result = suggest_payload_fix(
        payload,
        "age must be integer",
        client=client,
    )

    assert "private.user@example.com" not in client.captured_prompt
    assert "super-secret-api-key-123" not in client.captured_prompt

    assert result["corrected_payload"] == {
        "email": "private.user@example.com",
        "api_key": "super-secret-api-key-123",
        "age": 20,
    }

    assert payload == {
        "email": "private.user@example.com",
        "api_key": "super-secret-api-key-123",
        "age": "20",
    }
