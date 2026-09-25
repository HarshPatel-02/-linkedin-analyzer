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
    suggestions, pain, analysis = ai._parse_reply_full(content)
    assert len(suggestions) == 2 and pain == ""
    assert analysis == "They asked about pricing — answer it."
    assert ai._parse_reply(content) == (suggestions, "")      # old 2-tuple API unchanged


def test_parse_reply_without_analysis_and_bullets_fallback():
    assert ai._parse_reply_full('{"suggestions": ["a long enough suggestion", "another long suggestion"]}')[2] == ""
    suggestions, _, analysis = ai._parse_reply_full("1. First bullet suggestion here\n2. Second bullet suggestion")
    assert suggestions == ["First bullet suggestion here", "Second bullet suggestion"] and analysis == ""
    assert ai._parse_reply_full("User Safety: safe") == ([], "", "")


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
RICH = {
    "name": "Priya Sharma", "position": "Founder & CEO", "current_company": "Acme Health",
    "headline": "Founder & CEO at Acme Health", "country": "Mumbai, India",
    "activity": 'Last posted 3 days ago — "Why most clinics struggle with patient follow-ups after discharge…"',
    "icp_score": 82, "icp_breakdown": {"Job Title Match": {"score": 25, "max": 25, "reason": "Tier 1 (founder)"}},
    "activity_score": 71, "activity_label": "Ready to Engage", "engagement_label": "High",
    "signal_hits": {"hiring": "we're hiring"},
}


def test_outreach_template_without_keys():
    result = ai.generate_outreach(RICH)
    assert result["source"] == "template" and "not set up" in result["notice"]
    note = result["connection_note"]
    assert note.startswith("Hi Priya, ") and len(note) <= ai.OUTREACH_NOTE_MAX
    assert "recent post" in note and "Why most clinics" in note
    assert "15-minute call" in result["message"]          # strong fit → clear ask
    assert result["angle"].startswith("Strong ICP fit (82/100)") and "hiring" in result["angle"]


def test_outreach_template_weak_fit_has_no_pitch_or_ask():
    result = ai.generate_outreach({**RICH, "icp_score": 25, "activity": ""})
    assert "We're" not in result["connection_note"]
    assert "No agenda" in result["message"] and "call" not in result["message"]
    assert result["angle"].startswith("Weak ICP fit")


def test_outreach_template_with_almost_nothing():
    result = ai.generate_outreach({})
    assert result["connection_note"].startswith("Hi there, ") and result["source"] == "template"
    assert result["message"] and result["angle"]
    assert "Not enough profile details" in result["notice"]


def test_outreach_role_hook_without_post():
    result = ai.generate_outreach({"name": "Ravi K", "position": "CTO", "current_company": "MedTech"})
    assert "your work as CTO at MedTech" in result["connection_note"]


def test_outreach_ai_path(fake_ai):
    long_note = "Hi Priya, " + "really enjoyed your post on clinic follow-ups and patient retention. " * 8
    fake_ai["replies"].append(json.dumps({"angle": "Founder, strong fit, hiring now.",
                                          "connection_note": long_note,
                                          "message": "Thanks for connecting, Priya! We help clinics with follow-ups."}))
    result = ai.generate_outreach({**RICH, "tone": "pro"})
    assert result["source"] == "ai" and result["notice"] == ""
    assert len(result["connection_note"]) <= ai.OUTREACH_NOTE_MAX
    system, user = fake_ai["prompts"][0][0]["content"], fake_ai["prompts"][0][1]["content"]
    assert "Professional tone" in system and "Strong fit" in system
    assert "ICP fit score: 82/100" in user and "Tier 1 (founder)" in user and 'Hiring signal found' in user


@pytest.mark.parametrize("reply", [
    "User Safety: safe",
    '{"angle": "x", "connection_note": "Hi [Name], let us connect today!", "message": "Thanks [Name] for connecting!"}',
    '{"connection_note": "short", "message": "short"}',
])
def test_outreach_falls_back_on_unusable_ai_output(fake_ai, reply):
    fake_ai["replies"].extend([reply] * 3)
    result = ai.generate_outreach(RICH)
    assert result["source"] == "template" and "AI unavailable" in result["notice"]
    assert len(fake_ai["prompts"]) == 3


def test_outreach_falls_back_on_ai_errors(fake_ai):
    fake_ai["replies"].extend([ai.TransientAIError("Groq 429: slow down")] * 3)
    result = ai.generate_outreach(RICH)
    assert result["source"] == "template" and "Groq 429" in result["notice"]

    fake_ai["replies"].append(Exception("Groq 401: bad key"))
    result = ai.generate_outreach(RICH)
    assert result["source"] == "template" and "401" in result["notice"]


# ─── Review regressions ───────────────────────────────────────────────────────
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


def test_outreach_gives_up_on_ai_in_time_and_returns_the_template(monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(ai.time, "time", lambda: clock["t"])
    monkeypatch.setattr(ai.time, "sleep", lambda s: clock.__setitem__("t", clock["t"] + s))
    monkeypatch.setattr(ai, "_providers", lambda: [{"name": "Fake", "url": "", "key": "k"}])

    def hang(prompt, deadline=None):
        clock["t"] += 30          # every attempt eats 30 seconds
        raise ai.TransientAIError("Fake timed out")
    monkeypatch.setattr(ai, "_call_ai", hang)
    out = ai.generate_outreach({"first_name": "Priya", "position": "Founder", "current_company": "Acme"})
    assert out["source"] == "template"
    assert clock["t"] - 1000.0 <= ai.OUTREACH_BUDGET_S + 30


# ─── Connect → "Add a note" ───────────────────────────────────────────────────
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


def test_outreach_uses_role_pain_and_prior(fake_ai):
    fake_ai["replies"].append(json.dumps({"angle": "a",
        "connection_note": "Hi Priya, saw Acme Health is hiring — short note.",
        "message": "Thanks Priya — telehealth message for your team."}))
    ai.generate_outreach(dict(PRIYA, sender_role="Growth Lead", pain_point="slow onboarding",
                              prior_contact='They replied: "thanks"'))
    p = fake_ai["prompts"][0]
    assert "on behalf of the Growth Lead" in p[0]["content"]
    assert "Known pain point" in p[1]["content"] and "Previous contact" in p[1]["content"]
