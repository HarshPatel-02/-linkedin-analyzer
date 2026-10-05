"""The Apify token for the request being served.

It comes from the extension, never from the server's .env: the extension's Development
section stores the token and sends it as the X-Apify-Token header, so a new token applies
on the very next call instead of after an .env edit and a restart.

It lives in a context variable rather than a parameter because every Apify call runs
through asyncio.to_thread, which copies context variables into the worker thread. The
actor functions read it where they need it, and nothing between the endpoint and them has
to carry it.
"""
from contextvars import ContextVar

from fastapi import Header

TOKEN_HEADER = "X-Apify-Token"
MISSING = "No Apify token - set APIFY_API_TOKEN in the extension's Development section"

_token: ContextVar[str] = ContextVar("apify_token", default="")


def current_apify_token() -> str:
    return _token.get()


async def bind_apify_token(token: str | None = Header(default=None, alias=TOKEN_HEADER)) -> None:
    """Global dependency. It is async so it runs in the request's own task: a sync
    dependency runs in a thread pool, and a value set there would never reach the endpoint."""
    _token.set((token or "").strip())
