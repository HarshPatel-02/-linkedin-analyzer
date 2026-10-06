import json

import pytest
from fastapi.testclient import TestClient

import main
from routers import common
from routers import collect as collect_route
from services import ai_service


@pytest.fixture
def client():
    return TestClient(main.app)


def test_root_and_health(client):
    assert client.get("/").json()["status"] == "ok"
    from services.config import VERSION
    assert client.get("/health").json() == {"status": "ok", "version": VERSION}


def _apify_profile():
    return {
        "name": "Priya Sharma", "position": "Founder & CEO", "about": "We're hiring clinicians",
        "avatar": "https://img/p.jpg", "skills": ["Healthcare", "Sales"],
        "experience": [{"title": "Founder & CEO", "company": "Acme Health"}],
        "location": "Mumbai, India",
    }


def test_analyze_with_apify(client, monkeypatch, ago):
    posts = [{"url": f"https://p/{i}", "text": f"post {i}", "postedAt": ago(i + 1),
              "numLikes": 15, "numComments": 6, "numShares": 3} for i in range(5)]
    posts.append(dict(posts[0]))   # duplicate from the actor
    monkeypatch.setattr(common, "run_apify_actor", lambda url: _apify_profile())
    monkeypatch.setattr(common, "run_posts_actor", lambda url, max_posts=20, errors=None: posts)
    data = client.post("/analyze", json={"profile_url": "https://www.linkedin.com/in/priya/"}).json()
    assert data["success"] and data["scrape_warning"] == ""
    assert data["posts_analyzed"] == 5 and data["data_source"] == "apify"
    assert data["signal_hits"] == {"hiring": "hiring"}
    assert data["completeness_missing"] == []
    assert data["score_activity"] == 30 and data["posts_30_days"] == 5
    assert data["activity"].startswith("Last posted") and data["activity_url"] == "https://p/0"
    assert data["activity_date"] == posts[0]["postedAt"]   # machine-readable date for render-time "X ago"
    for key in ("score_total", "score_label", "max_posts", "score_max", "engagement_label"):
        assert key in data


def test_analyze_when_scrape_fails_uses_form(client, monkeypatch):
    def boom(url):
        raise Exception("APIFY_API_TOKEN is empty")
    monkeypatch.setattr(common, "run_apify_actor", boom)
    monkeypatch.setattr(common, "run_posts_actor", lambda url, max_posts=20, errors=None: [])
    data = client.post("/analyze", json={
        "profile_url": "https://www.linkedin.com/in/priya/", "name": "Priya", "position": "Founder",
        "about": "Series A funded startup", "activity": "Posted 2 weeks ago", "posts_30_days": 4,
        "avg_comments": 5,
    }).json()
    assert "APIFY_API_TOKEN is empty" in data["scrape_warning"]
    assert data["data_source"] == "form" and data["posts_analyzed"] == 0
    assert data["score_activity"] == 20 and data["score_posts"] == 10 and data["score_engagement"] == 10
    assert data["signal_hits"] == {"growth": "series a"}
    assert data["engagement_label"] == "Medium (form)"
    assert set(data["completeness_missing"]) == {"experience", "company", "photo"}


def test_analyze_without_profile_url(client):
    data = client.post("/analyze", json={"name": "X"}).json()
    assert data["success"] and data["score_total"] == 0 and data["scrape_warning"] == ""


def test_suggest_messages(client, monkeypatch):
    prompts = []
    monkeypatch.setattr(ai_service, "_providers", lambda: [{"name": "Fake", "url": "", "key": "k"}])

    def fake(prompt, deadline=None):
        prompts.append(prompt)
        return json.dumps({"analysis": "My call request is unanswered; follow up with value.",
                           "suggestions": ["Hi Priya, sharing a quick idea on follow-ups", "Hi Priya, one thought on patient retention"]})
    monkeypatch.setattr(ai_service, "_call_ai", fake)
    res = client.post("/suggest-messages", json={
        "messages": [{"sender": "them", "name": "Priya Sharma", "text": "hi"},
                     {"sender": "me", "name": "You", "text": "Open to a quick call?"}],
        "first_name": "Priya", "awaiting_reply_days": 3,
    })
    body = res.json()
    assert res.status_code == 200 and body["success"] and body["mode"] == "reply"
    assert body["analysis"].startswith("My call request") and len(body["suggestions"]) == 2
    assert "no reply for 3 days" in prompts[0][0]["content"]


def test_suggest_messages_without_keys_is_an_error(client):
    res = client.post("/suggest-messages", json={"messages": [{"sender": "them", "text": "hi"}]})
    assert res.status_code == 503 and "No AI key set" in res.json()["detail"]


def test_invite_note_endpoint_is_personal_without_ai_keys(client):
    res = client.post("/suggest-messages", json={
        "context": "invite", "max_chars": 200, "first_name": "Priya", "name": "Priya Sharma",
        "position": "Founder & CEO", "current_company": "Acme Health", "country": "Mumbai, Maharashtra, India",
        "activity": 'Last posted 3 days ago — "We are hiring 2 backend engineers for our telehealth platform"',
        "icp_score": 75, "icp_breakdown": {"Industry Match": {"score": 35, "max": 35, "reason": "Exact match (Health care)"}},
        "signal_hits": {"hiring": "hiring"},
    })
    body = res.json()
    assert res.status_code == 200 and body["mode"] == "invite" and body["source"] == "template"
    assert len(body["suggestions"]) == 3 and all("Priya" in s and len(s) <= 200 for s in body["suggestions"])


def test_suggest_messages_accepts_setup_fields(client):
    res = client.post("/suggest-messages", json={
        "context": "invite", "max_chars": 200, "first_name": "Priya",
        "position": "Founder", "current_company": "Acme Health",
        "sender_role": "Sales Director", "pain_point": "slow onboarding", "prior_contact": "I last wrote: 'hi'",
    })
    body = res.json()
    assert res.status_code == 200 and body["mode"] == "invite" and len(body["suggestions"]) >= 1


def test_lead_message_endpoint(client, monkeypatch):
    """Admin panel: POST /lead-message -> the message card, first-contact case."""
    monkeypatch.setattr(ai_service, "_providers", lambda: [{"name": "Fake", "url": "", "key": "k"}])
    monkeypatch.setattr(ai_service, "_call_ai", lambda prompt, deadline=None: json.dumps({
        "conversation_exists": False, "profile_summary": "Runs a care network.",
        "contact_reason": "Posts about clinic staffing.", "intent": "clinic operations",
        "recommended_tone": "professional",
        "suggested_message": "Saw your note on clinic staffing - we work with care networks on that. Worth a chat?",
        "personalization_points": ["Recent activity: clinic staffing"], "needs_review": True}))
    res = client.post("/lead-message", json={"name": "Brad Hively", "company": "CarePath Health",
                                             "job_title": "CEO", "messages": []})
    body = res.json()
    assert res.status_code == 200 and body["success"] is True
    assert body["conversation_exists"] is False and body["needs_review"] is True
    assert body["suggested_message"].startswith("Saw your note")
    assert set(body) >= {"profile_summary", "contact_reason", "intent", "recommended_tone",
                         "personalization_points"}


def test_lead_message_without_ai_keys_is_an_error(client):
    res = client.post("/lead-message", json={"name": "Brad Hively"})
    assert res.status_code == 503 and "No AI key set" in res.json()["detail"]


# ─── Single source of truth: one analysis both clients render ─────────────────
