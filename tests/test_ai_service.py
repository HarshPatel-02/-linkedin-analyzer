import json

import pytest

from services import ai_service as ai


@pytest.fixture
def fake_ai(monkeypatch):
    """AI provider stub: returns queued replies and records every prompt it was sent."""
    calls = {"prompts": [], "replies": []}

    def _call(prompt, deadline=None):
        calls["prompts"].append(prompt)
        reply = calls["replies"].pop(0) if calls["replies"] else ""
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(ai, "_providers", lambda: [{"name": "Fake", "url": "", "key": "k"}])
    monkeypatch.setattr(ai, "_call_ai", _call)
    monkeypatch.setattr(ai.time, "sleep", lambda s: None)
    return calls


def chat(*pairs):
    return [{"sender": s, "name": "Priya Sharma" if s == "them" else "You", "text": t} for s, t in pairs]


# ─── History window ───────────────────────────────────────────────────────────
def test_history_keeps_the_whole_loaded_thread_up_to_the_limit():
    short = ai._trim_history(chat(*[("them" if i % 2 else "me", f"message {i}") for i in range(30)]), "Priya")
    assert len(short) == 30, "everything the page had loaded is kept"
    msgs = chat(*[("them" if i % 2 else "me", f"message {i}") for i in range(50)])
    trimmed = ai._trim_history(msgs, "Priya")
    assert len(trimmed) == ai.HISTORY_LIMIT == 40
    assert trimmed[-1]["text"] == "message 49"

    long = ai._trim_history(chat(("them", "x" * 2000)), "Priya")
    assert len(long[0]["text"]) == ai.MESSAGE_CHAR_CAP and long[0]["text"].endswith("…")


def test_history_transcript_budget_drops_oldest_first():
    msgs = chat(*[("them", f"{i} " + "y" * 590) for i in range(12)])
    trimmed = ai._trim_history(msgs, "Priya")
    assert len(ai._transcript(trimmed, "Priya")) <= ai.TRANSCRIPT_CHAR_CAP
    assert trimmed[-1]["text"].startswith("11 ") and len(trimmed) < 12, "token budget still bounds long messages"


def test_history_skips_empty_and_invalid_messages():
    msgs = [{"sender": "them", "text": "  "}, None, {"sender": "me", "text": "hello"}]
    assert ai._trim_history(msgs, "Priya") == [{"sender": "me", "text": "hello"}]


# ─── Parsing ──────────────────────────────────────────────────────────────────
def test_parse_reply_with_analysis():
    content = '```json\n{"analysis": "They asked about pricing — answer it.", "suggestions": ' \
              '["Our pricing depends on scope, happy to share", "Great question, here is how we price"]}\n```'
    suggestions, pain, analysis, meta = ai._parse_reply_full(content)
    assert len(suggestions) == 2 and pain == ""
    assert analysis == "They asked about pricing — answer it."


def test_parse_reply_without_analysis_and_bullets_fallback():
    assert ai._parse_reply_full('{"suggestions": ["a long enough suggestion", "another long suggestion"]}')[2] == ""
    suggestions, _, analysis, _meta = ai._parse_reply_full("1. First bullet suggestion here\n2. Second bullet suggestion")
    assert suggestions == ["First bullet suggestion here", "Second bullet suggestion"] and analysis == ""
    assert ai._parse_reply_full("User Safety: safe")[:3] == ([], "", "")


# ─── Reply prompt ─────────────────────────────────────────────────────────────
def _system(messages, awaiting=None):
    prompt = ai._reply_prompt(ai.get_pitch_config(), messages, "casual", "Priya", {}, {}, 300, awaiting)
    return prompt[0]["content"], prompt[1]["content"]


def test_reply_prompt_asks_for_analysis_and_stage():
    system, user = _system(chat(("them", "What does it cost?")))
    assert '"analysis"' in system and "stage" in system
    assert "Priya Sharma: What does it cost?" in user


@pytest.mark.parametrize("messages, awaiting, expected", [
    (chat(("them", "hi"), ("me", "Would you be open to a call?")), 3, True),
    (chat(("them", "hi"), ("me", "Would you be open to a call?")), 1, False),
    (chat(("them", "hi"), ("me", "Would you be open to a call?")), None, False),
    (chat(("me", "hello"), ("them", "Sure, tell me more")), 5, False),
])
def test_followup_rule_only_when_my_message_is_waiting(messages, awaiting, expected):
    system, _ = _system(messages, awaiting)
    assert ("no reply for" in system) is expected


def test_generate_chat_suggestions_returns_analysis(fake_ai):
    fake_ai["replies"].append(json.dumps({
        "analysis": "They asked about pricing; answer and offer a call.",
        "suggestions": ["Pricing depends on scope — happy to walk you through it", "Good question! Can I share a quick breakdown?"],
    }))
    result = ai.generate_chat_suggestions(chat(("them", "What does it cost?")), "casual", "Priya", {},
                                          awaiting_reply_days=0)
    assert result["mode"] == "reply" and len(result["suggestions"]) == 2
    assert result["analysis"] == "They asked about pricing; answer and offer a call."


def test_generate_chat_suggestions_passes_follow_up_days(fake_ai):
    fake_ai["replies"].append('{"analysis": "x", "suggestions": ["long enough suggestion one", "long enough suggestion two"]}')
    ai.generate_chat_suggestions(chat(("them", "hi"), ("me", "Open to a call?")), "pro", "Priya", {},
                                 awaiting_reply_days=4)
    assert "no reply for 4 days" in fake_ai["prompts"][0][0]["content"]


def test_opener_mode_has_no_analysis(fake_ai):
    fake_ai["replies"].append('{"suggestions": ["Hi Priya, great to connect with you", "Hi Priya, loved your profile"]}')
    result = ai.generate_chat_suggestions([], "casual", "Priya", {})
    assert result["mode"] == "opener" and result["analysis"] == ""


def test_chat_suggestions_without_keys_raise():
    with pytest.raises(Exception, match="No AI key set"):
        ai.generate_chat_suggestions(chat(("them", "hi")), "casual", "Priya", {})


# ─── Outreach ─────────────────────────────────────────────────────────────────
def test_unknown_sender_is_not_attributed_to_the_partner():
    t = ai._transcript([{"sender": "unknown", "text": "hello"}, {"sender": "them", "name": "Priya", "text": "hi"},
                        {"sender": "me", "text": "yo"}], "Priya")
    assert t.splitlines() == ["Unknown sender: hello", "Priya: hi", "Me: yo"]


def test_call_ai_respects_the_deadline(monkeypatch):
    import time
    seen = []
    monkeypatch.setattr(ai, "_providers", lambda: [{"name": "A", "url": "", "key": "k"}, {"name": "B", "url": "", "key": "k"}])
    monkeypatch.setattr(ai, "_exhausted", {})

    def slow(p, prompt, timeout=40):
        seen.append((p["name"], timeout))
        raise ai.TransientAIError(p["name"] + " timed out")
    monkeypatch.setattr(ai, "_post_chat", slow)
    with pytest.raises(ai.TransientAIError):
        ai._call_ai([], deadline=time.time() + 10)
    assert seen and all(t <= 10 for _, t in seen)
    seen.clear()
    with pytest.raises(ai.TransientAIError, match="time budget"):
        ai._call_ai([], deadline=time.time() + 1)
    assert seen == []


PRIYA = {
    "first_name": "Priya", "name": "Priya Sharma", "position": "Founder & CEO", "current_company": "Acme Health",
    "headline": "Founder & CEO at Acme Health | Building telehealth for clinics", "country": "Mumbai, Maharashtra, India",
    "activity": 'Last posted 3 days ago — "We are hiring 2 backend engineers for our telehealth platform"',
    "icp_score": 75, "icp_breakdown": {"Industry Match": {"score": 35, "max": 35, "reason": "Exact match (Health care)"}},
    "signal_hits": {"hiring": "hiring"},
}


def test_invite_template_notes_each_use_a_different_real_detail(monkeypatch):
    monkeypatch.setattr(ai, "_providers", lambda: [])
    out = ai.generate_invite_notes(PRIYA, "casual", 200)
    notes = out["suggestions"]
    assert out["source"] == "template" and len(notes) == 3 and len(set(notes)) == 3
    assert all(n.startswith("Hi Priya,") and len(n) <= 200 for n in notes)
    assert "hiring 2 backend" in notes[0] and "Acme Health" in notes[1] and "hiring" in notes[2]
    assert "Strong ICP fit" in out["analysis"]


def test_invite_ai_notes_use_the_analysis(fake_ai):
    fake_ai["replies"].append(json.dumps({
        "analysis": "Strong fit and hiring right now.",
        "suggestions": ["Hi Priya, saw Acme Health is hiring backend engineers — we build telehealth teams.",
                        "Hi Priya, your telehealth post for clinics resonated with our work.",
                        "Hi Priya, great profile, let's connect!"]}))
    out = ai.generate_invite_notes(PRIYA, "casual", 300)
    assert out["source"] == "ai" and out["analysis"] == "Strong fit and hiring right now."
    assert len(out["suggestions"]) == 2, "the generic 'great profile' note is dropped"
    prompt = fake_ai["prompts"][0]
    text = prompt[0]["content"] + prompt[1]["content"]
    for must in ("Acme Health", "Exact match (Health care)", "hiring 2 backend engineers", "Mumbai", "75/100", "DIFFERENT"):
        assert must in text, must


def test_invite_generic_ai_notes_fall_back_to_personal_templates(fake_ai):
    generic = json.dumps({"suggestions": ["Hi Priya, great profile, would love to connect!",
                                          "Hi Priya, let's connect and grow our networks.",
                                          "Hi Priya, happy to connect with you here."]})
    fake_ai["replies"].extend([generic, generic, generic])
    out = ai.generate_invite_notes(PRIYA, "pro", 300)
    assert out["source"] == "template" and "not specific" in out["notice"]
    assert any("Acme Health" in n for n in out["suggestions"])


def test_invite_without_details_says_so(monkeypatch):
    monkeypatch.setattr(ai, "_providers", lambda: [])
    out = ai.generate_invite_notes({"first_name": "Sam"}, "casual", 300)
    assert out["suggestions"] == [out["suggestions"][0]] and out["suggestions"][0].startswith("Hi Sam,")
    assert "No profile details" in out["notice"]


def test_invite_context_goes_through_generate_chat_suggestions(monkeypatch):
    monkeypatch.setattr(ai, "_providers", lambda: [])       # no AI key: still 3 personal notes, no exception
    out = ai.generate_chat_suggestions([], "casual", "Priya", {}, "", context="invite", max_chars=200, analysis=PRIYA)
    assert out["mode"] == "invite" and len(out["suggestions"]) == 3


# ─── Setup preferences: sender role + past-contact context ────────────────────
def test_chat_replies_speak_as_the_setup_role(fake_ai):
    fake_ai["replies"].append(json.dumps({"analysis": "x", "suggestions": [
        "Sure Priya, happy to walk you through pricing.", "Priya, here's a quick overview for your clinic."]}))
    ai.generate_chat_suggestions([{"sender": "them", "name": "Priya", "text": "pricing?"}], "pro", "Priya", {}, "",
                                 sender_role="Account Executive at MedTech Co")
    assert "on behalf of the Account Executive at MedTech Co" in fake_ai["prompts"][0][0]["content"]


def test_invite_notes_speak_as_the_setup_role(fake_ai):
    fake_ai["replies"].append(json.dumps({"analysis": "a", "suggestions": [
        "Hi Priya, about Acme Health — note one.", "Hi Priya, your telehealth work — note two."]}))
    out = ai.generate_chat_suggestions([], "casual", "Priya", {}, "", context="invite", max_chars=200,
                                       analysis=dict(PRIYA), sender_role="Sales Director")
    assert out["source"] == "ai"
    assert "on behalf of the Sales Director" in fake_ai["prompts"][0][0]["content"]


def test_invite_prompt_includes_pain_point_and_previous_contact(fake_ai):
    fake_ai["replies"].append(json.dumps({"suggestions": [
        "Hi Priya, tackling slow patient onboarding is hard — note.", "Hi Priya, Acme Health note here."]}))
    req = dict(PRIYA, pain_point="slow patient onboarding", prior_contact='I last wrote: "hello there"')
    out = ai.generate_invite_notes(req, "pro", 300)
    user = fake_ai["prompts"][0][1]["content"]
    assert "Known pain point" in user and "slow patient onboarding" in user
    assert "Previous contact" in user and "hello there" in user
    assert "messaged them before" in fake_ai["prompts"][0][0]["content"]
    assert out["source"] == "ai" and len(out["suggestions"]) == 2, "the pain-point note counts as personal"


def test_parse_reply_returns_intent_tone_and_follow_up():
    """The reply assistant labels each suggestion so the UI can show
    "Suggested response" without printing the model's reasoning."""
    content = ('{"intent": "asking about pricing", "tone": "friendly", "needs_follow_up": true, '
               '"analysis": "They asked what it costs.", '
               '"suggestions": ["Pricing depends on scope - what size team are you thinking?", '
               '"Happy to walk through pricing, how many users?"]}')
    suggestions, _, analysis, meta = ai._parse_reply_full(content)
    assert suggestions[0].startswith("Pricing depends on scope")
    assert analysis == "They asked what it costs."
    assert meta == {"intent": "asking about pricing", "tone": "friendly", "needs_follow_up": True}


def test_parse_reply_metadata_tolerates_missing_or_odd_values():
    _, _, _, meta = ai._parse_reply_full('{"suggestions": ["a long enough suggestion here"]}')
    assert meta == {"intent": "", "tone": "", "needs_follow_up": None}
    # a string boolean and an unknown tone are normalised, not trusted blindly
    _, _, _, meta2 = ai._parse_reply_full(
        '{"tone": "salesy", "needs_follow_up": "false", "suggestions": ["a long enough suggestion here"]}')
    assert meta2["tone"] == "" and meta2["needs_follow_up"] is False


# ─── Admin panel: one message per lead ────────────────────────────────────────
PROFILE = {"name": "Brad Hively", "headline": "Healthcare executive", "job_title": "CEO",
           "company": "CarePath Health", "industry": "Healthcare", "location": "Los Angeles",
           "about": "Building patient-first care networks", "recent_activity": "Posted about clinic staffing"}


def _stub_lead_message(monkeypatch, payload):
    monkeypatch.setattr(ai, "_providers", lambda: [{"name": "Stub", "url": "", "key": "k"}])
    monkeypatch.setattr(ai, "_call_ai", lambda prompt, deadline=None: json.dumps(payload))


def test_lead_message_first_contact_has_no_conversation(monkeypatch):
    captured = {}
    monkeypatch.setattr(ai, "_providers", lambda: [{"name": "Stub", "url": "", "key": "k"}])

    def fake(prompt, deadline=None):
        captured["system"] = prompt[0]["content"]
        captured["user"] = prompt[1]["content"]
        return json.dumps({"conversation_exists": False, "profile_summary": "CEO of a care network.",
                           "contact_reason": "He runs clinics and posts about staffing.",
                           "intent": "improving clinic operations", "recommended_tone": "professional",
                           "suggested_message": "Saw your post on clinic staffing - we work with care networks on exactly that. Open to comparing notes?",
                           "personalization_points": ["Recent activity: posted about clinic staffing"],
                           "needs_review": True})
    monkeypatch.setattr(ai, "_call_ai", fake)
    out = ai.generate_lead_message({**PROFILE, "messages": []})
    assert out["conversation_exists"] is False
    assert "NO previous conversation" in captured["system"]
    assert "(none - this is the first message)" in captured["user"]
    assert "Los Angeles" in captured["user"] and "CarePath Health" in captured["user"]
    assert out["suggested_message"].startswith("Saw your post")
    assert out["personalization_points"] == ["Recent activity: posted about clinic staffing"]
    assert out["needs_review"] is True


def test_lead_message_reply_uses_the_latest_message(monkeypatch):
    captured = {}
    monkeypatch.setattr(ai, "_providers", lambda: [{"name": "Stub", "url": "", "key": "k"}])

    def fake(prompt, deadline=None):
        captured["user"] = prompt[1]["content"]
        return json.dumps({"conversation_exists": True, "profile_summary": "CEO.", "contact_reason": "He replied.",
                           "intent": "asking about pricing", "recommended_tone": "friendly",
                           "suggested_message": "Pricing depends on how many clinics you run - how many sites are you covering?",
                           "personalization_points": ["Their last message asked about pricing"], "needs_review": True})
    monkeypatch.setattr(ai, "_call_ai", fake)
    msgs = [{"sender": "me", "text": "Happy to share how we help care networks."},
            {"sender": "them", "name": "Brad Hively", "text": "What does it cost?"}]
    out = ai.generate_lead_message({**PROFILE, "messages": msgs})
    assert out["conversation_exists"] is True
    assert "LATEST_MESSAGE" in captured["user"] and captured["user"].rstrip().endswith("What does it cost?")
    assert out["recommended_tone"] == "friendly"


def test_lead_message_clamps_untrusted_model_output(monkeypatch):
    _stub_lead_message(monkeypatch, {
        "conversation_exists": True,                      # ignored: there is no conversation
        "recommended_tone": "aggressive",                  # off-list
        "suggested_message": "A perfectly fine opening message.",
        "personalization_points": "Headline: CEO",         # a string, not a list
        "needs_review": False,                             # a human still sends it
    })
    out = ai.generate_lead_message({**PROFILE, "messages": []})
    assert out["conversation_exists"] is False
    assert out["recommended_tone"] == "professional"
    assert out["personalization_points"] == ["Headline: CEO"]
    assert out["needs_review"] is True


def test_lead_message_without_a_message_is_an_error(monkeypatch):
    _stub_lead_message(monkeypatch, {"suggested_message": "   "})
    with pytest.raises(Exception):
        ai.generate_lead_message({**PROFILE, "messages": []})


def test_lead_message_rejects_a_draft_with_a_placeholder(monkeypatch):
    """A "[Your Company]" left in the draft is pasted straight into LinkedIn, so it
    is retried rather than returned."""
    calls = {"n": 0}
    monkeypatch.setattr(ai, "_providers", lambda: [{"name": "Stub", "url": "", "key": "k"}])

    def fake(prompt, deadline=None):
        calls["n"] += 1
        msg = ("Hi Brad, at [Your Company] we help care networks." if calls["n"] == 1
               else "Hi Brad, we help care networks with value-based care reporting.")
        return json.dumps({"profile_summary": "CEO.", "contact_reason": "Runs clinics.",
                           "intent": "operations", "recommended_tone": "professional",
                           "suggested_message": msg, "personalization_points": [], "needs_review": True})
    monkeypatch.setattr(ai, "_call_ai", fake)
    out = ai.generate_lead_message({**PROFILE, "messages": []})
    assert calls["n"] == 2                       # the first draft was thrown away
    assert "[" not in out["suggested_message"]


def test_lead_message_gives_up_if_every_draft_has_a_placeholder(monkeypatch):
    _stub_lead_message(monkeypatch, {"suggested_message": "Hi [Name], quick question.",
                                     "recommended_tone": "professional"})
    with pytest.raises(Exception):
        ai.generate_lead_message({**PROFILE, "messages": []})
