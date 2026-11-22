import pytest

from ai.diagnosis.error_diagnoser import (
    ErrorDiagnosisOutput,
    diagnose_error,
    redact_sensitive_data,
)


@pytest.mark.parametrize(
    "stack_trace",
    [
        "TimeoutError: request timed out",
        "ConnectionError: connection refused",
        "ValueError: invalid input",
        "KeyError: missing user_id",
        "TypeError: unexpected argument",
        "FileNotFoundError: config file missing",
        "PermissionError: access denied",
        "RuntimeError: processing failed",
        "ZeroDivisionError: division by zero",
        "Exception: unknown failure",
    ],
)
def test_mock_diagnosis_returns_valid_structure(stack_trace):
    result = diagnose_error(
        component_name="test-service",
        stack_trace=stack_trace,
        payload_snapshot={"status": 500},
    )

    validated = ErrorDiagnosisOutput.model_validate(result)

    assert set(validated.model_dump().keys()) == {
        "likely_root_cause",
        "confidence",
        "suggested_action",
        "is_transient",
    }


def test_sensitive_data_is_redacted():
    result = redact_sensitive_data(
        {
            "api_key": "secret123",
            "user_email": "piyush@example.com",
            "message": "Authorization: Bearer abc123XYZ",
        }
    )

    assert result["api_key"] == "[REDACTED_SECRET]"
    assert result["user_email"] == "[REDACTED_EMAIL]"
    assert "abc123XYZ" not in result["message"]


class TimeoutClient:
    def generate(self, prompt, schema=None, temperature=0.3):
        raise TimeoutError("Simulated API timeout")


def test_timeout_returns_fallback_instead_of_raising():
    result = diagnose_error(
        component_name="payment-service",
        stack_trace="Payment processing failed",
        payload_snapshot={"status": 504},
        client=TimeoutClient(),
    )

    assert result == {
        "likely_root_cause": (
            "Diagnosis unavailable because the analysis "
            "could not be completed."
        ),
        "confidence": 0.0,
        "suggested_action": "",
        "is_transient": False,
    }


class RecordingClient:
    def __init__(self, response):
        self.response = response
        self.received_schema = None

    def generate(self, prompt, schema=None, temperature=0.3):
        self.received_schema = schema
        return self.response, {"total_tokens": 10}


def test_client_receives_error_diagnosis_schema():
    client = RecordingClient(
        {
            "likely_root_cause": "The database connection was refused.",
            "confidence": 0.9,
            "suggested_action": (
                "Verify the database service and connection settings."
            ),
            "is_transient": True,
        }
    )

    result = diagnose_error(
        component_name="database-service",
        stack_trace="ConnectionError: connection refused",
        payload_snapshot={"status": 500},
        client=client,
    )

    assert result["likely_root_cause"] == (
        "The database connection was refused."
    )
    assert client.received_schema is not None
    assert client.received_schema["additionalProperties"] is False
    assert set(client.received_schema["required"]) == {
        "likely_root_cause",
        "confidence",
        "suggested_action",
        "is_transient",
    }


def test_invalid_client_response_returns_fallback():
    client = RecordingClient(
        {
            "likely_root_cause": "Unknown error",
            "confidence": 1.5,
            "suggested_action": "Inspect logs",
            "is_transient": False,
        }
    )

    result = diagnose_error(
        component_name="test-service",
        stack_trace="ValueError: invalid input",
        payload_snapshot={},
        client=client,
    )

    assert result["confidence"] == 0.0
    assert result["suggested_action"] == ""
