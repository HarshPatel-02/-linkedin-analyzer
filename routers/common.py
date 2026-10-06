"""What the routes share: fetching a profile, turning form input into a profile, and
answering errors without leaking internals."""
from __future__ import annotations

import asyncio
import logging

from fastapi import HTTPException

from models import ProfileData
from services.actor_service import ApifyError, run_apify_actor, run_posts_actor
from services.ai_service import AIUnavailable

log = logging.getLogger("analyzer")

# Keys of a request that describe the person (everything ProfileData holds).
PROFILE_FIELDS = set(ProfileData.model_fields)


async def fetch_profile_and_posts(profile_url: str, max_posts: int | None, notes: list) -> tuple[dict, list]:
    """The profile and its posts, fetched side by side. A failed profile fetch raises;
    a failed posts fetch is written to `notes` and returns no posts."""
    return await asyncio.gather(
        asyncio.to_thread(run_apify_actor, profile_url),
        asyncio.to_thread(run_posts_actor, profile_url, max_posts, notes),
    )


def profile_from_form(values: dict, profile_url: str = "") -> ProfileData:
    """A profile from what the extension sent, when nothing could be fetched."""
    profile = ProfileData(**{k: v for k, v in (values or {}).items() if k in PROFILE_FIELDS})
    profile.profileUrl = profile.profileUrl or profile_url
    return profile


def form_edits(payload: dict) -> dict:
    """Details typed into the Activity form: they win over the fetched values."""
    edits = {}
    for key in PROFILE_FIELDS - {"profileUrl", "timestamp"}:
        value = payload.get(key)
        if isinstance(value, str):
            if value.strip():
                edits[key] = value.strip()
        elif isinstance(value, (int, float)) and value:
            edits[key] = value
    return edits


def failure(e: Exception, what: str) -> HTTPException:
    """A known failure (no AI key, Apify trouble) says what happened; anything else is
    logged with its traceback and answered without internals."""
    if isinstance(e, (AIUnavailable, ApifyError)):
        return HTTPException(503, detail=str(e))
    log.exception("%s failed", what)
    return HTTPException(500, detail=f"{what} failed on the server - see the server log.")
