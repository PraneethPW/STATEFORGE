from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = ""
    database_pool_size: int = 10
    environment: str = "development"
    frontend_url: str = "http://127.0.0.1:5173"
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    openrouter_api_key: str = ""
    openrouter_model: str = "openrouter/free"
    allow_registration: bool = True
    session_hours: int = 12
    worker_poll_seconds: float = 1.0
    job_timeout_seconds: int = 90


@lru_cache
def settings():
    return Settings()
