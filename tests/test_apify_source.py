"""The person's details come from Apify, never from the page the extension read.

Before, the Activity request carried the page's name, headline, About, company and
country, and every one of them overrode what Apify returned: Apify said "CTO at ABC
HealthTech", the page said "Student at Old Corp", and the page won. The extension now
sends only the profile URL and what was typed into the form.
"""
import pytest
from fastapi.testclient import TestClient

import main
from routers import common
from routers import collect as collect_route
from services.actor_service import map_apify_to_profile

URL = "https://www.linkedin.com/in/michael-raviv/"
APIFY = {"name": "Michael Raviv", "headline": "CTO at ABC HealthTech", "position": "CTO",
         "about": "Building healthcare data platforms.", "current_company_name": "ABC HealthTech",
         "location": "Austin, Texas, United States"}
HEADERS = {"X-Apify-Token": "t"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(common, "run_apify_actor", lambda url: dict(APIFY))
    monkeypatch.setattr(common, "run_posts_actor", lambda url, n=20, errors=None: [])
    return TestClient(main.app)


def request(**typed):
    """What content.js sends now: the URL and the typed boxes."""
    return {"profile_url": URL, "profileUrl": URL, "position": "", "activity": "", **typed}


def test_the_headline_is_read_from_apify():
    assert map_apify_to_profile(dict(APIFY), URL, []).headline == "CTO at ABC HealthTech"


def test_every_profile_detail_comes_from_apify(client):
    d = client.post("/analyze", json=request(), headers=HEADERS).json()
    assert d["name"] == "Michael Raviv"
    assert d["headline"] == "CTO at ABC HealthTech"
    assert d["position"] == "CTO"
    assert d["current_company"] == "ABC HealthTech"
    assert d["about"] == "Building healthcare data platforms."


def test_a_typed_box_still_overrides_apify_for_that_field(client):
    d = client.post("/analyze", json=request(position="VP Engineering"), headers=HEADERS).json()
    assert d["position"] == "VP Engineering"
    assert d["current_company"] == "ABC HealthTech"     # the untyped fields stay Apify's


def test_without_apify_only_typed_values_are_scored(monkeypatch):
    monkeypatch.setattr(common, "run_apify_actor", lambda url: {})
    monkeypatch.setattr(common, "run_posts_actor", lambda url, n=20, errors=None: [])
    d = TestClient(main.app).post("/analyze", json=request()).json()
    assert d["data_source"] == "form"
    assert d["current_company"] in ("", "Not specified", None)   # nothing invented


def test_the_icp_collect_reads_apify_not_the_page_facts(client, monkeypatch):
    monkeypatch.setattr(collect_route, "run_company_actor", lambda url, notes=None: {"current_company_industry": "Hospital & Health Care"})
    facts = {"profileUrl": URL, "name": "Mike R."}   # icpPageFacts()
    p = client.post("/collect", json={"profile_url": URL, "scraped": facts, "max_posts": 20},
                    headers=HEADERS).json()["profile"]
    assert p["name"] == "Michael Raviv"                  # Apify's, not the page's "Mike R."
    assert p["headline"] == "CTO at ABC HealthTech"
    assert p["current_company"] == "ABC HealthTech"
