"""A user's own Activity points and keywords ride with their request and touch nobody else's."""
import asyncio

import pytest
from fastapi.testclient import TestClient

import main
from routers import common
from services import scoring_service


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(common, "run_apify_actor", lambda url: {})
    monkeypatch.setattr(common, "run_posts_actor", lambda url, max_posts=20, errors=None: [])
    return TestClient(main.app)


FORM = {"profile_url": "https://www.linkedin.com/in/priya/", "name": "Priya", "position": "Founder",
        "about": "We are hiring nurses", "activity": "Posted 2 days ago", "posts_30_days": 4}


def test_without_settings_the_saved_defaults_score(client):
    data = client.post("/analyze", json=FORM).json()
    assert data["score_activity"] == 30                     # recent activity at its default max
    assert data["signal_hits"] == {"hiring": "hiring"}


def test_a_requests_own_points_change_only_that_request(client):
    mine = client.post("/analyze", json={**FORM, "activity_points": {"recent_activity": 10}}).json()
    assert mine["score_activity"] == 10
    after = client.post("/analyze", json=FORM).json()
    assert after["score_activity"] == 30                    # nothing was saved for the next caller
    assert scoring_service.get_activity_points()["recent_activity"] == 30


def test_a_requests_own_keywords_replace_the_saved_ones(client):
    data = client.post("/analyze", json={**FORM, "activity_keywords": {"hiring": ["nurses"]}}).json()
    assert data["signal_hits"] == {"hiring": "nurses"}


def test_two_requests_at_once_never_see_each_others_settings():
    seen = {}

    async def one(name, points):
        scoring_service.bind_activity_settings(points, None)
        await asyncio.sleep(0.01)                           # let the other one run in between
        seen[name] = await asyncio.to_thread(lambda: scoring_service.get_activity_points()["engagement"])

    async def both():
        await asyncio.gather(asyncio.create_task(one("a", {"engagement": 40})),
                             asyncio.create_task(one("b", {"engagement": 5})))

    asyncio.run(both())
    assert seen == {"a": 40, "b": 5}
