"""Runtime configuration for the Dhruva backend.

Values come from the repo-root ``.env`` (gitignored) or the process environment.
The API key is held as a ``SecretStr`` so it never lands in a log line or repr.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Process-wide settings. Frozen stack decisions live here as defaults."""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Provider access: one OpenAI-compatible client pointed at OpenRouter.
    provider: str = Field(default="openai_compat", validation_alias="DHRUVA_PROVIDER")
    openai_base_url: str = Field(
        default="https://openrouter.ai/api/v1", validation_alias="OPENAI_BASE_URL"
    )
    openai_api_key: SecretStr = Field(default=SecretStr(""), validation_alias="OPENAI_API_KEY")

    # Model ids (frozen in Phase 0).
    agent_model: str = "anthropic/claude-sonnet-5"
    judge_model: str = "openai/gpt-5-mini"
    compressor_model: str = "openai/gpt-5-mini"

    # On-disk layout.
    runs_dir: Path = PROJECT_ROOT / "runs"
    fixtures_dir: Path = PROJECT_ROOT / "fixtures"
    config_dir: Path = PROJECT_ROOT / "config"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached process settings."""
    return Settings()
