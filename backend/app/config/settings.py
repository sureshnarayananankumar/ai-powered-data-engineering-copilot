"""Application settings.

All secrets are read from environment variables (or a local `.env` file that is
NOT committed). Nothing sensitive is hard-coded here.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- LLM ---
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"

    # --- Snowflake (least-privilege, read-only role) ---
    snowflake_account: str | None = None
    snowflake_user: str | None = None
    snowflake_password: str | None = None
    snowflake_role: str = "COPILOT_READONLY"
    snowflake_warehouse: str = "COPILOT_WH"
    snowflake_database: str | None = None
    snowflake_schema: str | None = None

    # --- SQL guard limits ---
    sql_allowed_schemas: str = "ANALYTICS,STAGING"  # comma separated
    sql_max_rows: int = 500
    sql_timeout_seconds: int = 60

    # --- RAG ---
    knowledge_base_dir: str = "../knowledge_base/sample_docs"

    # --- API ---
    cors_origins: str = "http://localhost:4200"

    @property
    def allowed_schemas(self) -> set[str]:
        return {s.strip().upper() for s in self.sql_allowed_schemas.split(",") if s.strip()}

    @property
    def llm_configured(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def snowflake_configured(self) -> bool:
        return all([self.snowflake_account, self.snowflake_user, self.snowflake_password])


@lru_cache
def get_settings() -> Settings:
    return Settings()
