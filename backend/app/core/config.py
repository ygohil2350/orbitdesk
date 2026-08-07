from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "OrbitDesk"
    environment: str = "production"
    database_url: str = "postgresql+asyncpg://orbit:orbit@db:5432/orbitdesk"
    jwt_secret: str = Field(min_length=32)
    jwt_ttl_minutes: int = Field(default=480, ge=5, le=1440)
    upload_dir: Path = Path("/app/uploads")
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1024, le=25 * 1024 * 1024)
    cors_origin: str = ""

    @field_validator("jwt_secret")
    @classmethod
    def reject_placeholder_secret(cls, value: str) -> str:
        if value in {"change-me", "secret", "replace-with-a-long-random-value"}:
            raise ValueError("JWT_SECRET must not be a placeholder")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
