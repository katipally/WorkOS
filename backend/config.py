from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # In Docker: env vars are injected via docker-compose environment: block — env_file is ignored.
    # Local dev (running uvicorn directly from backend/): reads backend/.env if present.
    # Local dev (running from project root): reads ../.env (the single root .env).
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = "postgresql://app:apppassword@localhost:5432/ai_workforce"

    # Public base URL used to build OAuth redirect URIs (no trailing slash)
    APP_BASE_URL: str = "https://localhost:3443"

    # GitHub OAuth App credentials
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""

    # Slack OAuth App credentials
    SLACK_CLIENT_ID: str = ""
    SLACK_CLIENT_SECRET: str = ""

    # Atlassian (Jira) OAuth 2.0 (3LO) credentials
    ATLASSIAN_CLIENT_ID: str = ""
    ATLASSIAN_CLIENT_SECRET: str = ""

    # AI / LLM configuration
    OPENAI_API_KEY: str = ""
    OLLAMA_BASE_URL: str = "http://host.docker.internal:11434"

    # File uploads directory (inside container)
    UPLOAD_DIR: str = "/app/uploads"


settings = Settings()
