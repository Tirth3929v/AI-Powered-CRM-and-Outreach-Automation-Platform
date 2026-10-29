
"""
Gemini Flash Client Wrapper.
Handles API requests, retries, token tracking, and offline test mocks.
"""

import json
import logging
import time
from typing import Optional, Dict, Any, Tuple

from ai.config import get_ai_config

logger = logging.getLogger(__name__)


class GeminiClient:
    def __init__(self, config=None):
        self.config = config or get_ai_config()

    def generate(
        self,
        prompt: str,
        schema: Optional[Dict[str, Any]] = None,
        temperature: float = 0.3
    ) -> Tuple[Dict[str, Any], Dict[str, int]]:
        """
        Generates text using Google Gemini Flash model.
        Returns: (parsed_json_output, token_usage_dict)
        """
        # Return canned output when mock mode is enabled or API key is missing.
        if self.config.mock_mode or not self.config.gemini_api_key:
            logger.info(
                "GeminiClient running in mock mode; returning offline fixture."
            )
            mock_payload = {
                "subject": "Regarding your entry-level opening",
                "body": (
                    "Hi there,\n\n"
                    "I saw your verified job listing for the software "
                    "engineer position. Our interns have proven skills "
                    "in Python, FastAPI, and direct SQL workflows.\n\n"
                    "Best regards,\nOutreach Team"
                ),
                "personalization_summary": (
                    "Generated using verified listing attributes."
                ),
                "claims_used": [
                    {
                        "fact_id": "fact_01",
                        "claim": "Software engineer role",
                    }
                ],
                "missing_information_warnings": [],
                "confidence_note": (
                    "Mock generated response compliant with draft schema."
                ),
            }
            usage = {
                "prompt_tokens": 120,
                "completion_tokens": 65,
                "total_tokens": 185,
            }
            return mock_payload, usage

        # Real API request with bounded exponential backoff on 429 / 5xx.
        import httpx

        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.config.gemini_model}:generateContent"
            f"?key={self.config.gemini_api_key}"
        )
        headers = {"Content-Type": "application/json"}

        generation_config = {
            "temperature": temperature,
            "responseMimeType": "application/json",
        }
        if schema is not None:
            generation_config["responseJsonSchema"] = schema

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": generation_config,
        }

        attempts = 3
        delay = 1.0

        for attempt in range(1, attempts + 1):
            try:
                with httpx.Client(
                    timeout=self.config.timeout_seconds
                ) as client:
                    resp = client.post(url, headers=headers, json=payload)

                    if resp.status_code in (429, 500, 502, 503, 504):
                        if attempt < attempts:
                            time.sleep(delay)
                            delay *= 2
                            continue

                    resp.raise_for_status()
                    data = resp.json()
                    text_content = (
                        data["candidates"][0]["content"]["parts"][0]["text"]
                    )
                    parsed = json.loads(text_content)
                    usage_metadata = data.get("usageMetadata", {})
                    usage = {
                        "prompt_tokens": usage_metadata.get(
                            "promptTokenCount", 0
                        ),
                        "completion_tokens": usage_metadata.get(
                            "candidatesTokenCount", 0
                        ),
                        "total_tokens": usage_metadata.get(
                            "totalTokenCount", 0
                        ),
                    }
                    return parsed, usage

            except Exception as e:
                if attempt >= attempts:
                    logger.error(
                        "Gemini request failed after %d attempts: %s",
                        attempts,
                        e,
                    )
                    raise
                time.sleep(delay)
                delay *= 2
