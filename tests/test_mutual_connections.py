"""Mutual connections come from the user's own view of the page, never from Apify.

Apify scrapes as a different LinkedIn account, so the connections it reports as mutual
are shared with that account. Its figure used to replace a page count of 0.
"""
import pytest
from fastapi.testclient import TestClient

import main

APIFY_SAYS = 500          # what the scraping account happens to share with this person


@pytest.fixture
def client(monkeypatch):
    profile = {"name": "Priya Sharma", "position": "Founder", "mutual_connections": APIFY_SAYS}
    monkeypatch.setattr(main, "run_apify_actor", lambda url: dict(profile))
    monkeypatch.setattr(main, "run_posts_actor", lambda url, max_posts=20, errors=None: [])
    monkeypatch.setattr(main, "run_company_actor", lambda url: {})
    return TestClient(main.app)


@pytest.mark.parametrize("on_page, points", [(0, 0), (7, 5), (25, 10)])
def test_analyze_scores_the_count_from_the_page(client, on_page, points):
    """0 included: LinkedIn showing no mutual connections must score none."""
    data = client.post("/analyze", json={"profile_url": "https://www.linkedin.com/in/priya/",
                                         "mutual_connections": on_page}).json()
    assert data["mutual_connections"] == on_page
    assert data["score_mutuals"] == points


def test_collect_uses_the_count_the_extension_read(client):
    data = client.post("/collect", json={"profile_url": "https://www.linkedin.com/in/priya/",
                                         "scraped": {"mutual_connections": 3}, "max_posts": 5}).json()
    assert data["profile"]["mutual_connections"] == 3
    assert data["activity_breakdown"]["score_mutuals"] == 2


def test_collect_without_a_page_count_is_zero_not_apifys(client):
    data = client.post("/collect", json={"profile_url": "https://www.linkedin.com/in/priya/",
                                         "scraped": {}, "max_posts": 5}).json()
    assert data["profile"]["mutual_connections"] == 0


# ─── A required minimum of mutual connections ────────────────────────────────

# A very active person, scored from the form (no Apify token in tests): would be 83.
ACTIVE = {"profile_url": "https://www.linkedin.com/in/active/", "name": "Active Person",
          "position": "Founder", "headline": "Founder at Acme", "about": "We are hiring",
          "avatar": "a.png", "current_company": "Acme", "activity": "Posted 2 days ago",
          "posts_30_days": 5, "posts_90_days": 12, "avg_likes": 15, "avg_comments": 6, "avg_reposts": 4}


@pytest.fixture
def form_client():
    return TestClient(main.app)


def test_the_requirement_is_saved_and_clamped(form_client):
    assert form_client.get("/activity-rules").json() == {"mutual_min": 0}
    assert form_client.post("/activity-rules", json={"mutual_min": 2}).json() == {"mutual_min": 2}
    assert form_client.get("/activity-rules").json() == {"mutual_min": 2}
    assert form_client.post("/activity-rules", json={"mutual_min": -5}).json() == {"mutual_min": 0}
    assert form_client.post("/activity-rules", json={"mutual_min": "lots"}).json() == {"mutual_min": 0}


def test_too_few_mutual_connections_caps_the_whole_score(form_client):
    """However active they are: 83 becomes 39, the top of Difficult to Engage."""
    form_client.post("/activity-rules", json={"mutual_min": 2})
    data = form_client.post("/analyze", json={**ACTIVE, "mutual_connections": 0}).json()
    assert data["score_uncapped"] > 39
    assert data["score_total"] == 39
    assert "Difficult to Engage" in data["score_label"]
    assert data["failed_required"] == ["2+ mutual connections (has 0)"]


def test_meeting_the_requirement_leaves_the_score_alone(form_client):
    form_client.post("/activity-rules", json={"mutual_min": 2})
    data = form_client.post("/analyze", json={**ACTIVE, "mutual_connections": 2}).json()
    assert data["failed_required"] == []
    assert data["score_total"] == data["score_uncapped"] > 39


def test_no_requirement_means_no_cap(form_client):
    data = form_client.post("/analyze", json={**ACTIVE, "mutual_connections": 0}).json()
    assert data["mutual_min"] == 0 and data["failed_required"] == []
    assert data["score_total"] == data["score_uncapped"] > 39


# ─── The requirement decides what the factor itself is worth ─────────────────
# With no requirement the default ladder applies (20+ = 10, 10-19 = 7, 5-9 = 5, 1-4 = 2).
# With one, the administrator has already said what "enough" means, so reaching it earns
# the factor's whole points. Scoring 3 mutuals as 2/10 while they had asked for "at
# least 2" contradicted the rule they wrote.

@pytest.mark.parametrize("required, has, expected", [
    (2, 3, 10),    # over the bar that was set -> full marks, not the 2 of the old ladder
    (2, 2, 10),    # exactly the bar -> full marks
    (2, 1, 0),     # under it -> nothing for this factor (and the total is capped)
    (5, 30, 10),
    (25, 20, 0),   # 20 alone would be the top tier, but the requirement is higher
])
def test_a_required_minimum_decides_the_factor(form_client, required, has, expected):
    form_client.post("/activity-rules", json={"mutual_min": required})
    data = form_client.post("/analyze", json={**ACTIVE, "mutual_connections": has}).json()
    assert data["score_mutuals"] == expected
    assert data["max_mutuals"] == 10


@pytest.mark.parametrize("has, expected", [(0, 0), (3, 2), (7, 5), (12, 7), (25, 10)])
def test_without_a_requirement_the_ladder_still_applies(form_client, has, expected):
    assert form_client.get("/activity-rules").json() == {"mutual_min": 0}
    data = form_client.post("/analyze", json={**ACTIVE, "mutual_connections": has}).json()
    assert data["score_mutuals"] == expected
