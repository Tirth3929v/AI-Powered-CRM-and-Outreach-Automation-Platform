"""
Application Configuration Module.
Loads and validates settings from environment variables using Pydantic Settings.
"""

from functools import lru_cache
from typing import List, Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Core Application Settings
    ENVIRONMENT: str = Field(default="development", description="Runtime environment")
    APP_VERSION: str = Field(default="1.0.0", description="Application version")
    HOST: str = Field(default="0.0.0.0")
    PORT: int = Field(default=8000)
    SECRET_KEY: str = Field(default="default-insecure-secret-key-change-in-production-min-32-chars")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60)
    CORS_ORIGINS: str = Field(default="http://localhost:5173,http://localhost:3000")

    # Database Configuration (Neon PostgreSQL)
    DATABASE_URL: str = Field(
        default="postgresql://crm_user:password@localhost:5432/crm_db",
        description="PostgreSQL connection string"
    )
    DB_MIN_CONNECTIONS: int = Field(default=1)
    DB_MAX_CONNECTIONS: int = Field(default=5)
    DB_TIMEOUT_SECONDS: float = Field(default=10.0)

    # Webhook & Internal Security Secrets
    SCRAPER_INGEST_SECRET: str = Field(default="test-scraper-secret")
    PROVIDER_WEBHOOK_SECRET: str = Field(default="test-webhook-secret")

    # Gemini AI Configuration
    GEMINI_API_KEY: Optional[str] = Field(default=None)
    GEMINI_MODEL: str = Field(default="gemini-1.5-flash")
    GEMINI_TIMEOUT_SECONDS: int = Field(default=30)
    GEMINI_MOCK_MODE: bool = Field(default=True)

    # Enrichment & Verification Settings
    DAILY_CREDIT_BUDGET: int = Field(default=50)
    MONTHLY_CREDIT_BUDGET: int = Field(default=1000)
    ENRICHMENT_SANDBOX: bool = Field(default=True)
    EMAIL_VERIFIER_PROVIDER: str = Field(default="mock")
    EMAIL_VERIFIER_API_KEY: Optional[str] = Field(default=None)
    EMAIL_VERIFIER_SANDBOX: bool = Field(default=True)
    EMAIL_SANDBOX_MODE: bool = Field(default=True)
    DAILY_SEND_LIMIT: int = Field(default=100)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


@lru_cache()
def get_settings() -> Settings:
    """Returns cached application settings instance."""
    return Settings()
