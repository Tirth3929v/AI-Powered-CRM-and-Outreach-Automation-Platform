import json
from unittest.mock import MagicMock, patch

from ai.gemini_client import GeminiClient


def test_generate_includes_response_json_schema():
    schema = {
        "type": "object",
        "properties": {
            "confidence": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
            },
        },
        "required": ["confidence"],
        "additionalProperties": False,
    }

    config = MagicMock()
    config.mock_mode = False
    config.gemini_api_key = "test-api-key"
    config.gemini_model = "gemini-test-model"
    config.timeout_seconds = 5

    api_response = MagicMock()
    api_response.status_code = 200
    api_response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": json.dumps({"confidence": 0.8}),
                        }
                    ]
                }
            }
        ],
        "usageMetadata": {
            "promptTokenCount": 10,
            "candidatesTokenCount": 5,
            "totalTokenCount": 15,
        },
    }
    api_response.raise_for_status.return_value = None

    http_client = MagicMock()
    http_client.__enter__.return_value = http_client
    http_client.__exit__.return_value = False
    http_client.post.return_value = api_response

    with patch("httpx.Client", return_value=http_client):
        client = GeminiClient(config=config)
        result, usage = client.generate(
            "Diagnose this error",
            schema=schema,
        )

    request_payload = http_client.post.call_args.kwargs["json"]
    generation_config = request_payload["generationConfig"]

    assert generation_config["responseMimeType"] == "application/json"
    assert generation_config["responseJsonSchema"] == schema
    assert result == {"confidence": 0.8}
    assert usage["total_tokens"] == 15


def test_generate_omits_response_json_schema_when_none():
    config = MagicMock()
    config.mock_mode = False
    config.gemini_api_key = "test-api-key"
    config.gemini_model = "gemini-test-model"
    config.timeout_seconds = 5

    api_response = MagicMock()
    api_response.status_code = 200
    api_response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [{"text": '{"ok": true}'}],
                }
            }
        ]
    }
    api_response.raise_for_status.return_value = None

    http_client = MagicMock()
    http_client.__enter__.return_value = http_client
    http_client.__exit__.return_value = False
    http_client.post.return_value = api_response

    with patch("httpx.Client", return_value=http_client):
        client = GeminiClient(config=config)
        client.generate("Test without schema")

    request_payload = http_client.post.call_args.kwargs["json"]
    assert "responseJsonSchema" not in request_payload["generationConfig"]
