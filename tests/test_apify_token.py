"""The Apify token comes from the extension's X-Apify-Token header, never from .env."""
import asyncio
import time

import httpx
import pytest
from fastapi.testclient import TestClient

import main
from routers import common
from services import actor_service, ai_service
from services.apify_token import MISSING, current_apify_token

EXTENSION_ORIGIN = "chrome-extension://" + "a" * 32


@pytest.fixture
def client():
    return TestClient(main.app)


def _record_tokens(monkeypatch):
    """Stub the actors so each call records the token visible inside its worker thread."""
    seen = []

    def profile(url):
        seen.append((url, current_apify_token()))
        return {"name": "Priya Sharma", "position": "Founder"}

    monkeypatch.setattr(common, "run_apify_actor", profile)
    monkeypatch.setattr(common, "run_posts_actor", lambda url, max_posts=20, errors=None: [])
    return seen


def test_the_header_reaches_the_actor_inside_its_worker_thread(client, monkeypatch):
    seen = _record_tokens(monkeypatch)
    client.post("/analyze", json={"profile_url": "https://www.linkedin.com/in/a/"},
                headers={"X-Apify-Token": "apify_api_from_extension"})
    assert seen == [("https://www.linkedin.com/in/a/", "apify_api_from_extension")]


def test_without_the_header_there_is_no_token_even_when_env_has_one(client, monkeypatch):
    """The extension is the only source: a token left in .env must not be picked up."""
    monkeypatch.setenv("APIFY_API_TOKEN", "apify_api_from_env")
    seen = _record_tokens(monkeypatch)
    client.post("/analyze", json={"profile_url": "https://www.linkedin.com/in/a/"})
    assert seen == [("https://www.linkedin.com/in/a/", "")]


def test_a_token_does_not_leak_into_the_next_request(client, monkeypatch):
    seen = _record_tokens(monkeypatch)
    for token in ("apify_api_first", None, "apify_api_second"):
        client.post("/analyze", json={"profile_url": "https://www.linkedin.com/in/a/"},
                    headers={"X-Apify-Token": token} if token else {})
    assert [t for _, t in seen] == ["apify_api_first", "", "apify_api_second"]


def test_concurrent_requests_each_see_their_own_token(monkeypatch):
    seen = {}

    def slow_profile(url):
        time.sleep(0.2)                 # hold the thread so the two requests overlap
        seen[url] = current_apify_token()
        return {"name": "Someone"}

    monkeypatch.setattr(common, "run_apify_actor", slow_profile)
    monkeypatch.setattr(common, "run_posts_actor", lambda url, max_posts=20, errors=None: [])

    async def both():
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://analyzer") as c:
            await asyncio.gather(
                c.post("/analyze", json={"profile_url": "https://www.linkedin.com/in/a/"},
                       headers={"X-Apify-Token": "apify_api_a"}),
                c.post("/analyze", json={"profile_url": "https://www.linkedin.com/in/b/"},
                       headers={"X-Apify-Token": "apify_api_b"}),
            )

    asyncio.run(both())
    assert seen == {"https://www.linkedin.com/in/a/": "apify_api_a",
                    "https://www.linkedin.com/in/b/": "apify_api_b"}


def test_the_extension_may_send_the_token_header(client):
    r = client.options("/analyze", headers={
        "Origin": EXTENSION_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-apify-token",
    })
    assert r.status_code == 200
    assert "x-apify-token" in r.headers["access-control-allow-headers"].lower()


def test_the_actors_say_where_the_token_goes_when_it_is_missing(monkeypatch):
    monkeypatch.setenv("APIFY_API_TOKEN", "apify_api_from_env")
    with pytest.raises(Exception, match="Development section"):
        actor_service.run_apify_actor("https://www.linkedin.com/in/a/")
    errors: list = []
    assert actor_service.run_posts_actor("https://www.linkedin.com/in/a/", errors=errors) == []
    assert errors == ["posts actor skipped: " + MISSING]
    notes: list = []
    assert actor_service.run_company_actor("https://www.linkedin.com/in/a/", notes) == {}
    assert notes and "Development section" in notes[0]


def test_a_failed_posts_fetch_is_not_cached():
    """Otherwise the empty result of a missing token would hide a token saved a minute
    later for the next six hours."""
    url = "https://www.linkedin.com/in/a/"
    assert ai_service.recent_post_texts(url) == []
    assert url not in ai_service._posts_cache


def test_a_fetch_that_worked_is_still_cached(monkeypatch):
    url = "https://www.linkedin.com/in/a/"
    monkeypatch.setattr(ai_service, "run_posts_actor", lambda u, max_posts=20, errors=None: [])
    assert ai_service.recent_post_texts(url) == []
    assert url in ai_service._posts_cache
