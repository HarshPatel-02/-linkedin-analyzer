"""What keeps the analyzer to its owner once it runs anywhere but this machine.

On Render the server is reachable by anyone, and it holds the AI keys and settings.
Every request then needs the server key (ANALYZER_API_KEY) in the X-Api-Key header,
sent by the extension from its Development section. CORS is not this: it only
restrains browsers, and anyone can call the server without one.

Three rules:
  - Local, no key configured: open, because it only listens on 127.0.0.1.
  - On Render, no key configured: closed. A deploy that forgot the key refuses every
    request instead of quietly serving the internet.
  - Key configured: the header must match it, compared in constant time.

The limit caps how fast one client can call it, so even a leaked key cannot run up
the AI or Apify bill quickly. The key is never logged or echoed back.
"""
import secrets
import time
from collections import deque

from fastapi import Header, HTTPException, Request

from services.config import settings

KEY_HEADER = "X-Api-Key"
OPEN_PATHS = {"/", "/health"}        # say the server is up, and nothing else
_WINDOW = 60.0                       # the limit is settings.rate_limit_per_minute
_MAX_TRACKED_CLIENTS = 10000
_hits: dict = {}


def configured_key() -> str:
    return settings.server_key


def on_render() -> bool:
    """Render sets RENDER=true in every service it runs."""
    return settings.on_render


def is_public() -> bool:
    return bool(configured_key()) or on_render()


def _client(request: Request) -> str:
    # Behind Render's proxy the connecting address is the proxy. Its last
    # X-Forwarded-For entry is the one it added itself; earlier entries come from
    # the client and can say anything.
    forwarded = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    if forwarded:
        return forwarded[-1]
    return request.client.host if request.client else "unknown"


async def rate_limit(request: Request) -> None:
    if request.url.path in OPEN_PATHS or not is_public():
        return
    now = time.monotonic()
    if len(_hits) > _MAX_TRACKED_CLIENTS:                   # forget clients long gone
        for key in [k for k, q in _hits.items() if not q or now - q[-1] > _WINDOW]:
            del _hits[key]
    hits = _hits.setdefault(_client(request), deque())
    while hits and now - hits[0] > _WINDOW:
        hits.popleft()
    if len(hits) >= settings.rate_limit_per_minute:
        raise HTTPException(429, detail="Too many requests - wait a minute and try again.",
                            headers={"Retry-After": str(int(_WINDOW))})
    hits.append(now)


async def require_server_key(request: Request,
                             key: str | None = Header(default=None, alias=KEY_HEADER)) -> None:
    if request.url.path in OPEN_PATHS:
        return
    expected = configured_key()
    if not expected:
        if on_render():
            raise HTTPException(503, detail="This server has no ANALYZER_API_KEY set, so it refuses every "
                                            "request. Add one in Render -> Environment and redeploy.")
        return
    if not secrets.compare_digest((key or "").strip().encode(), expected.encode()):
        raise HTTPException(401, detail="Missing or wrong server key - paste it into the extension's "
                                        "Development section.")
