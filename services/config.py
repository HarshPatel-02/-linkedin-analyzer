"""Every setting the analyzer reads, with its name and default in one place.

Values come from the environment (.env locally, the service's environment on Render). Each
is read when it is used rather than once at import, so a changed variable - or one a test
sets - takes effect without depending on the order modules happen to be imported in.

What is deliberately NOT here: the Apify token. It arrives with each request from the
extension (services/apify_token.py) and the server never reads one of its own.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

# The repository root: the runtime JSON files (pitch_config.json, ...) live here.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

VERSION = "1.1"


def _str(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name) or default)
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name) or default)
    except ValueError:
        return default


class Settings:
    # ── Apify actors ─────────────────────────────────────────────────────────
    @property
    def apify_profile_actor(self) -> str:
        """harvestapi/linkedin-profile-scraper by default."""
        return _str("APIFY_ACTOR_ID", "LpVuK3Zozwuipa5bp")

    @property
    def apify_posts_actor(self) -> str:
        return _str("APIFY_POSTS_ACTOR_ID")

    @property
    def apify_company_actor(self) -> str:
        """The older profile-based actor: used when the profile names no company page."""
        return _str("APIFY_COMPANY_ACTOR_ID")

    @property
    def apify_company_details_actor(self) -> str:
        """harvestapi/linkedin-company: industry and head count from a company page."""
        return _str("APIFY_COMPANY_DETAILS_ACTOR_ID", "UwSdACBp7ymaGUJjS")

    @property
    def apify_run_timeout_s(self) -> int:
        """Apify stops a run (and its billing) after this. Profile and posts run side by side,
        then the company: two of these must fit the admin's 180 s wait, one the extension's 150 s."""
        return _int("APIFY_RUN_TIMEOUT", 75)

    @property
    def max_posts(self) -> int:
        return _int("MAX_POSTS", 20)

    # ── AI providers (OpenAI-compatible chat APIs) ───────────────────────────
    @property
    def groq_api_key(self) -> str:
        return _str("GROQ_API_KEY")

    @property
    def groq_model(self) -> str:
        """Empty: the best chat model Groq currently offers is picked automatically."""
        return _str("GROQ_MODEL")

    @property
    def openrouter_api_key(self) -> str:
        return _str("OPENROUTER_API_KEY")

    @property
    def openrouter_model(self) -> str:
        """One model, or a comma-separated list OpenRouter falls back down."""
        return _str("OPENROUTER_MODEL", "openrouter/free")

    @property
    def ai_temperature(self) -> float:
        return _float("AI_TEMPERATURE", 0.8)

    # ── Access ───────────────────────────────────────────────────────────────
    @property
    def server_key(self) -> str:
        return _str("ANALYZER_API_KEY")

    @property
    def on_render(self) -> bool:
        return bool(os.getenv("RENDER"))

    @property
    def rate_limit_per_minute(self) -> int:
        return _int("RATE_LIMIT_PER_MINUTE", 60)


settings = Settings()
