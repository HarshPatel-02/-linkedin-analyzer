import json
import logging
import os
import re
import time
import urllib.error
import urllib.request

from services.actor_service import run_posts_actor
from services.config import BASE_DIR, settings
from services.config_store import read_config, write_config
from services.matching import find_phrase, normalize
from services.scoring_service import parse_activity_to_days, split_own_posts

log = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

HISTORY_LIMIT   = 40    # the ✨ popup analyses the whole loaded thread, up to this many messages
MESSAGE_CHAR_CAP    = 600    # one message in the transcript
TRANSCRIPT_CHAR_CAP = 5000   # whole transcript — oldest messages drop first
SUGGESTION_MAX  = 3
MAX_CHARS       = 300   # default cap; invite notes send LinkedIn's own limit
POSTS_FOR_PAIN  = 5     # recent posts read to find the pro opener's pain point
POSTS_CACHE_TTL = 6 * 3600
# ICP fit, as every prompt and template talks about it: strong from 70, weak below 40
# (the same bands the extension colours the ICP score with).
STRONG_FIT = 70
WEAK_FIT   = 40

# ─── Pitch: who "I" am in every message ───────────────────────────────────────
# Edited from the extension toolbar popup (Settings) and stored in
# pitch_config.json next to main.py (services/config_store.py).
PITCH_CONFIG_FILE = os.path.join(BASE_DIR, "pitch_config.json")

DEFAULT_PITCH = {
    "who":           "Founder of a healthcare IT company",
    "expertise":     "healthcare tech experts",
    "offer":         "if you need anything in tech, we can help",
    "services":      "",
    "casual_opener": "We are healthcare tech experts — if you're looking for anything in tech, we can help.",
}


def _merge_pitch(saved) -> dict:
    """The saved pitch over the defaults; a blank field is treated as unset."""
    pitch = dict(DEFAULT_PITCH)
    if isinstance(saved, dict):
        pitch.update({k: str(v).strip() for k, v in saved.items() if k in DEFAULT_PITCH and str(v).strip()})
    return pitch


def get_pitch_config() -> dict:
    """Saved pitch (pitch_config.json) merged over the defaults."""
    return read_config(PITCH_CONFIG_FILE, _merge_pitch)


def save_pitch_config(data: dict) -> dict:
    pitch = get_pitch_config()
    pitch.update({k: str(v).strip() for k, v in data.items() if k in DEFAULT_PITCH and v is not None})
    write_config(PITCH_CONFIG_FILE, pitch)
    return get_pitch_config()


def _pitch_for(sender_role) -> dict:
    """The saved pitch, with "who I am" overridden by the Setup role when one is set."""
    pitch = get_pitch_config()
    role = _plain_role(sender_role)
    return {**pitch, "who": role} if role else pitch


def _plain_role(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:120]


def _models() -> list[str]:
    """OPENROUTER_MODEL may list fallbacks: "primary,backup,openrouter/free"."""
    raw = settings.openrouter_model
    return [m.strip() for m in raw.split(",") if m.strip()][:3]


TONE_RULES = {
    "casual": "Casual tone: warm, friendly, conversational. Short sentences. At most one emoji per message.",
    "pro":    "Professional tone: polite, formal, concise business language. No emojis, no slang.",
}

COMMON_RULES = (
    "- Never invent numbers, percentages, client names or case-study results.\n"
    "- Don't claim we have a specific product/platform or past clients; say what we can help with.\n"
    "- No placeholders like [Name] or [Company], no subject lines, no signatures.\n"
)

LANGUAGE_RULE_CHAT = (
    "- Write in the same language and script they use in the chat (e.g. Hindi, Gujarati, or Hinglish in "
    "Latin letters). If their language is unclear, use English.\n"
)
LANGUAGE_RULE_OPENER = "- Write in English unless their posts are clearly in another language — then use that.\n"

_HINGLISH = set("hai hain kya aap hum bhai nahi nahin haan kar karo karna sakte sakta ho hamare hamara mera meri tum "
                "bahut acha accha theek thik ji kaise kyun lekin aur bhi toh hoga raha rahe chahiye abhi".split())
_GUJLISH  = set("che chhe tame ame shu kem maja saru nathi hatu kevi tamaru amaru chho joiye".split())


def _chat_language(messages: list[dict]) -> str:
    """Language of THEIR messages, when it isn't plain English."""
    text = " ".join(m.get("text", "") for m in messages if m.get("sender") != "me")
    if re.search(r"[઀-૿]", text):
        return "Gujarati (Gujarati script)"
    if re.search(r"[ऀ-ॿ]", text):
        return "Hindi (Devanagari script)"
    words = re.findall(r"[a-z]+", text.lower())
    if sum(w in _GUJLISH for w in words) >= 2:
        return "Gujarati written in Latin letters"
    if sum(w in _HINGLISH for w in words) >= 3:
        return "Hinglish (Hindi written in Latin letters)"
    return ""


def _language_rule(messages: list[dict]) -> str:
    lang = _chat_language(messages)
    if lang:
        return f"- Their messages are in {lang}. Write EVERY suggestion in {lang}.\n"
    return LANGUAGE_RULE_CHAT

# profile_url -> (fetched_at, [post texts]) — Apify runs are slow and cost credits
_posts_cache: dict = {}


def recent_post_texts(profile_url: str) -> list[str]:
    """Their latest LinkedIn post texts (Apify posts actor), cached per profile."""
    hit = _posts_cache.get(profile_url)
    if hit and time.time() - hit[0] < POSTS_CACHE_TTL:
        return hit[1]
    texts = []
    errors: list = []
    # Own posts only: a repost's text is someone else's words — reading a "pain
    # point" out of it would personalise the message to the wrong person.
    own, _ = split_own_posts(run_posts_actor(profile_url, max_posts=POSTS_FOR_PAIN + 3, errors=errors),
                             profile_url)
    for post in own:
        if not isinstance(post, dict):
            continue
        text = next((post.get(k) for k in ("text", "content", "postText", "commentary", "description")
                     if isinstance(post.get(k), str) and post.get(k).strip()), "")
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 30:
            texts.append(text[:600])
        if len(texts) >= POSTS_FOR_PAIN:
            break
    # Only a real answer is worth remembering. An empty list caused by a missing token
    # or a failed fetch would otherwise hide a token saved a minute later for six hours.
    if not errors:
        _posts_cache[profile_url] = (time.time(), texts)
    return texts


def _persona(pitch: dict) -> str:
    services = f" Services: {pitch['services']}." if pitch.get("services") else ""
    return (f"You write LinkedIn messages on behalf of the {pitch['who']}. "
            f"We are {pitch['expertise']} — {pitch['offer']}.{services}\n")


def _profile_block(profile: dict) -> str:
    lines = [f"{k}: {v}" for k, v in profile.items() if v and v != "Not specified"]
    return "Their profile:\n" + ("\n".join(lines) or "(unknown)")


def _fit_rule(lead: dict) -> str:
    """How hard to push, from the ICP / Activity scores saved in the extension."""
    icp = lead.get("icp_score")
    act = lead.get("activity_score")
    if icp is None and act is None:
        return ""
    bits = []
    if icp is not None:
        bits.append(f"ICP fit {icp}/100")
    if act is not None:
        bits.append(f"LinkedIn activity {act}/100" + (f" ({lead['activity_label']})" if lead.get("activity_label") else ""))
    if icp is not None and icp >= STRONG_FIT:
        how = "Strong fit: be confident and direct — a clear ask for a short 15-minute call is fine."
    elif icp is not None and icp < WEAK_FIT:
        how = "Weak fit: build the relationship only — no pitch and no call request."
    else:
        how = "Medium fit: lead with value and end with a soft, low-pressure question."
    return f"- Lead score: {', '.join(bits)}. {how}\n"


def _json_format(pain: bool = False, analysis: bool = False) -> str:
    if pain:
        return 'Return ONLY JSON: {"pain_point": "<one short phrase>", "suggestions": ["...", "...", "..."]}'
    if analysis:
        # suggestions[0] is the one the UI offers to copy and send; the rest are
        # alternatives. intent / tone / needs_follow_up let the UI label the reply
        # without putting the model's reasoning on screen.
        return ('Return ONLY JSON: {"intent": "<what THEY want in the latest message, 2-5 words>", '
                '"tone": "professional"|"friendly"|"casual", '
                '"needs_follow_up": true|false, '
                '"analysis": "<one sentence: where the chat stands and what the next message should do>", '
                '"suggestions": ["<the reply to send>", "<alternative>", "<alternative>"]}')
    return 'Return ONLY JSON: {"suggestions": ["...", "...", "..."]}'


def _speaker(name: str | None, first: str) -> str:
    """Their label in the transcript; the extension's placeholders ("Them"/"You") fall back to the first name."""
    name = (name or "").strip()
    return first if not name or name.lower() in ("them", "you", "unknown") else name


def _label(m: dict, first: str) -> str:
    sender = m.get("sender")
    if sender == "me":
        return "Me"
    if sender == "unknown":
        return "Unknown sender"   # the page didn't say who wrote it — don't guess
    return _speaker(m.get("name"), first)


def _transcript(messages: list[dict], first: str) -> str:
    return "\n".join(f"{_label(m, first)}: {m.get('text', '').strip()}" for m in messages)


def _trim_history(messages: list[dict], first: str) -> list[dict]:
    """Last HISTORY_LIMIT non-empty messages, each ≤ MESSAGE_CHAR_CAP chars, transcript ≤ TRANSCRIPT_CHAR_CAP."""
    out = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        text = re.sub(r"\s+", " ", str(m.get("text") or "")).strip()
        if not text:
            continue
        if len(text) > MESSAGE_CHAR_CAP:
            text = text[:MESSAGE_CHAR_CAP - 1].rstrip() + "…"
        out.append({**m, "text": text})
    out = out[-HISTORY_LIMIT:]
    while len(out) > 1 and len(_transcript(out, first)) > TRANSCRIPT_CHAR_CAP:
        out.pop(0)
    return out


def _followup_rule(messages: list[dict], awaiting_reply_days) -> str:
    """My message has sat unanswered for days → a polite, value-adding follow-up."""
    if not messages or messages[-1].get("sender") != "me":
        return ""
    try:
        days = int(awaiting_reply_days)
    except (TypeError, ValueError):
        return ""
    if days < 2:
        return ""
    return (f"- My last message has had no reply for {days} days: every suggestion is a short, polite follow-up that "
            "adds something new (a useful thought, a resource, or one easy question). Never guilt-trip, never "
            "write 'just checking in' or 'bumping this', never repeat my last message.\n")


def _reply_prompt(pitch, messages, tone, first, profile, lead, max_chars, awaiting_reply_days=None) -> list[dict]:
    system = (
        _persona(pitch) +
        "You are a professional LinkedIn conversation assistant. Read the whole conversation, then write the "
        "message I should send next.\n"
        f"{TONE_RULES[tone]}\n"
        "Judge where the chat stands: who spoke last, any question of theirs still unanswered, and the stage "
        "(first contact / building rapport / discussing needs / scheduling a call / gone quiet).\n"
        "Rules:\n"
        f"- Write {SUGGESTION_MAX} messages I could send, each under {max_chars} characters. The FIRST is the "
        "one I am most likely to send; the others are alternatives.\n"
        "- Answer what they actually asked. If something is genuinely missing, ask one natural follow-up "
        "question.\n"
        "- Sound like a person typing on LinkedIn: natural and conversational, never like a chatbot, template "
        "or sales automation. No corporate filler.\n"
        "- Never repeat what the conversation already says, and never re-introduce myself or re-pitch something "
        "they already heard.\n"
        "- Match the tone they are using. Keep it concise unless their question needs detail.\n"
        "- No greetings or sign-offs unless the conversation calls for one.\n"
        "- Never invent facts, prices, availability, timelines or personal details.\n"
        "- On business, hiring, sales or networking topics, stay helpful rather than promotional.\n"
        "- If the last message is mine, write a natural follow-up instead of a reply.\n"
        f"- A line like [shared a post by X: \"…\"] is a LinkedIn post shared in the chat. X is only the "
        f"post's author, NOT the person I am chatting with — never greet or address X; talk to {first} about "
        "the post if relevant.\n"
        + _followup_rule(messages, awaiting_reply_days)
        + _fit_rule(lead) + _language_rule(messages) + COMMON_RULES +
        f"- Address them as {first} when natural.\n" + _json_format(analysis=True)
    )
    # Three labelled blocks: who they are, the thread, and the message being answered.
    latest = messages[-1] if messages else None
    latest_block = "(none — I spoke last)"
    if latest:
        latest_block = f"{_speaker(latest.get('name'), first)}: {latest.get('text', '')}"
    user = (
        f"PROFILE_DATA\n{_profile_block(profile)}\n\n"
        f"CONVERSATION_HISTORY (last {len(messages)} message(s), oldest first)\n"
        f"{_transcript(messages, first)}\n\n"
        f"LATEST_MESSAGE\n{latest_block}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]

def _casual_opener_prompt(pitch, first, profile, lead, max_chars, invite) -> list[dict]:
    kind = "connection-request notes" if invite else "first LinkedIn messages (we have never chatted)"
    system = (
        _persona(pitch) + f"You write short {kind}.\n{TONE_RULES['casual']}\n"
        f'Core message to keep in every suggestion: "{pitch["casual_opener"]}"\n'
        "Rules:\n"
        f"- Write {SUGGESTION_MAX} variations, each under {max_chars} characters.\n"
        f"- Start with a friendly greeting to {first}. Suggestion 1 stays very close to the core message.\n"
        "- Suggestions 2 and 3 may add one light, specific touch from their profile (role or company) if known.\n"
        "- No hard sell, no call booking, no questions longer than a few words.\n"
        + LANGUAGE_RULE_OPENER + COMMON_RULES + _json_format()
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": _profile_block(profile)}]


def _pro_opener_prompt(pitch, first, profile, posts, lead, max_chars, invite) -> list[dict]:
    kind = "connection-request notes" if invite else "first LinkedIn messages (we have never chatted)"
    system = (
        _persona(pitch) + f"You write {kind}.\n{TONE_RULES['pro']}\n"
        "Steps:\n"
        "1. From their recent posts (or profile if there are no posts), identify the ONE most concrete business or "
        "technology pain point they actually face — use their own topic, not a generic guess.\n"
        f"2. Write {SUGGESTION_MAX} professional messages to {first}, each under {max_chars} characters, that "
        "reference that post topic specifically, name the pain point, and say briefly how we can help.\n"
        + (_fit_rule(lead) or "- End with a soft, low-pressure ask.\n")
        + LANGUAGE_RULE_OPENER + COMMON_RULES +
        "- Do not quote long passages; paraphrase the post topic in a few words.\n" + _json_format(pain=True)
    )
    if posts:
        post_block = "Their recent LinkedIn posts (newest first):\n" + "\n".join(f"{i + 1}. {t}" for i, t in enumerate(posts))
    else:
        post_block = "Their recent LinkedIn posts: (none found)"
    return [{"role": "system", "content": system}, {"role": "user", "content": f"{_profile_block(profile)}\n\n{post_block}"}]


REWRITE_ACTIONS = {
    "improve": "Rewrite it to be clearer and more engaging, same meaning and intent.",
    "shorten": "Make it noticeably shorter and punchier — keep the key point and the ask.",
    "grammar": "Fix only grammar, spelling and punctuation; keep the wording and tone as close as possible.",
}


def _rewrite_prompt(pitch, draft, action, tone, first, messages, max_chars) -> list[dict]:
    # No offer/services here: a rewrite must stay the user's own message, not grow a pitch.
    system = (
        f"You polish LinkedIn messages written by the {pitch['who']}.\n{TONE_RULES[tone]}\n"
        f"Task: the user drafted a LinkedIn message to {first}. {REWRITE_ACTIONS[action]}\n"
        "Rules:\n"
        f"- Give {SUGGESTION_MAX} alternative versions, each under {max_chars} characters.\n"
        "- Keep the draft's language and script (Hindi/Gujarati/Hinglish stays as is).\n"
        "- Use ONLY what the draft says — do not add services, offers, details or claims that aren't in it.\n"
        + COMMON_RULES + _json_format()
    )
    context = f"Recent chat, oldest first:\n{_transcript(messages, first)}\n\n" if messages else ""
    return [{"role": "system", "content": system}, {"role": "user", "content": f"{context}My draft:\n{draft}"}]


def _strip_fences(content: str) -> str:
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", (content or "").strip(), flags=re.I).strip()


def _json_object(content: str):
    """The JSON object inside a model reply (code fences / chatter around it tolerated), or None."""
    match = re.search(r"\{.*\}", _strip_fences(content), flags=re.S)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _parse_reply_full(content: str, max_chars: int = MAX_CHARS) -> tuple[list[str], str, str, dict]:
    """-> (suggestions, pain_point, analysis, meta)

    meta carries the reply assistant's labels for the UI: what they want
    (intent), the register to answer in (tone) and whether a question of
    ours is still open (needs_follow_up). Absent keys simply stay empty.
    """
    text = _strip_fences(content)
    items: list = []
    pain = analysis = ""
    meta: dict = {}
    data = _json_object(text)
    if data is not None:
        items = data.get("suggestions") or []
        if not isinstance(items, list):
            items = []
        pain = str(data.get("pain_point") or "").strip()
        analysis = re.sub(r"\s+", " ", str(data.get("analysis") or "")).strip()
        intent = re.sub(r"\s+", " ", str(data.get("intent") or "")).strip()
        reply_tone = str(data.get("tone") or "").strip().lower()
        follow = data.get("needs_follow_up")
        if isinstance(follow, str):
            follow = follow.strip().lower() in ("true", "yes", "1")
        meta = {
            "intent": intent[:80],
            "tone": reply_tone if reply_tone in ("professional", "friendly", "casual") else "",
            "needs_follow_up": bool(follow) if follow is not None else None,
        }
    if not items:
        # Model ignored the JSON instruction → take numbered / bulleted lines only
        # (anything else, e.g. a guard model's "User Safety: safe", is rejected)
        marker = re.compile(r"^\s*(?:\d+[.)]|[-*•])\s+")
        items = [marker.sub("", line) for line in text.splitlines() if marker.match(line)]
    out = []
    for s in items:
        s = str(s).strip().strip('"').strip()
        if len(s) >= 15:
            out.append(_fit_length(s, max_chars))
    return out[:SUGGESTION_MAX], pain[:120], analysis[:240], meta


def _fit_length(s: str, max_chars: int) -> str:
    """Trim at a sentence/word boundary instead of mid-word (invite notes are hard-capped)."""
    if len(s) <= max_chars:
        return s
    cut = s[:max_chars]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if end >= max_chars * 0.6:
        return cut[:end + 1]
    return cut[:cut.rfind(" ")].rstrip(",;:—- ") if " " in cut else cut


def generate_chat_suggestions(messages: list[dict], tone: str, first_name: str, profile: dict,
                              profile_url: str = "", *, draft: str = "", action: str = "",
                              lead: dict | None = None, context: str = "chat",
                              max_chars: int = MAX_CHARS, awaiting_reply_days=None,
                              analysis: dict | None = None, sender_role: str = "") -> dict:
    """-> {"suggestions": [...], "mode": "reply"|"opener"|"rewrite"|"invite", "pain_point": str, "pain_source": str,
           "analysis": str}"""
    if context == "invite" and not (draft or "").strip():
        # Connect → "Add a note": always about this person, AI or template
        req = dict(analysis or {})
        req.setdefault("first_name", first_name)
        if sender_role and not req.get("sender_role"):
            req["sender_role"] = sender_role
        return generate_invite_notes(req, tone, max_chars, profile_url)
    if not _providers():
        raise AIUnavailable(NO_AI_KEY)
    tone = "pro" if tone == "pro" else "casual"
    first = first_name or "them"
    lead = lead or {}
    invite = context == "invite"
    max_chars = max(80, min(int(max_chars or MAX_CHARS), 1000))
    messages = [] if invite else _trim_history(messages, first)
    pitch = _pitch_for(sender_role)

    pain_source = ""
    if draft.strip():
        mode = "rewrite"
        prompt = _rewrite_prompt(pitch, draft.strip()[:2000], action if action in REWRITE_ACTIONS else "improve",
                                 tone, first, messages, max_chars)
    elif messages:
        mode, prompt = "reply", _reply_prompt(pitch, messages, tone, first, profile, lead, max_chars,
                                              awaiting_reply_days)
    elif tone == "casual":
        mode, prompt = "opener", _casual_opener_prompt(pitch, first, profile, lead, max_chars, invite)
    else:
        posts = recent_post_texts(profile_url) if profile_url else []
        pain_source = "recent posts" if posts else ("profile" if any(profile.values()) else "")
        mode, prompt = "opener", _pro_opener_prompt(pitch, first, profile, posts, lead, max_chars, invite)

    # Providers are tried in order (Groq → OpenRouter); a reply that isn't usable (a guard
    # model answering "User Safety: safe", too few suggestions) is asked for again.
    def accept(content):
        suggestions, pain, analysis, meta = _parse_reply_full(content, max_chars)
        if len(suggestions) >= 2 or (mode == "rewrite" and suggestions):
            return {
                "suggestions": suggestions,
                # The one to copy and send; the rest are alternatives.
                "suggested_response": suggestions[0] if suggestions else "",
                "mode":        mode,
                "pain_point":  pain if pain_source else "",
                "pain_source": pain_source if pain else "",
                "analysis":    analysis if mode == "reply" else "",
                "intent":           meta.get("intent", "") if mode == "reply" else "",
                "reply_tone":       meta.get("tone", "") if mode == "reply" else "",
                "needs_follow_up":  meta.get("needs_follow_up") if mode == "reply" else None,
            }, None
        return None, None

    result, problem = _ask_ai(prompt, CHAT_BUDGET_S, 4, accept)
    if result is None:
        raise AIUnavailable(problem or "AI returned no usable suggestions — try again")
    return result


# The extension gives up after 100s (chat) / 90s (outreach) and a sleeping Render
# server eats part of that, so the server stops retrying well before.
AI_REQUEST_TIMEOUT = 40
CHAT_BUDGET_S = 75
MESSAGE_BUDGET_S = 40      # the admin's lead message


class TransientAIError(Exception):
    """Rate limit / overload / network blip — worth another try."""


class AIUnavailable(Exception):
    """No AI could produce a usable answer. The message is safe to show the user."""


def _ask_ai(prompt: list[dict], budget_s: float, attempts: int, accept, *, give_up_on_error: bool = False):
    """Ask until `accept(content)` returns a result, within `budget_s` seconds and `attempts` tries.

    `accept` returns (result, None) to finish or (None, why) to try again. Quick failures -
    rate limits, overload, a router pick that ignores the format - are retried with a short
    back-off. Returns (result, None) or (None, the last reason). A non-transient error is
    raised, unless `give_up_on_error`, which returns it as the reason instead."""
    deadline = time.time() + budget_s
    problem = None
    for attempt in range(attempts):
        if time.time() > deadline - 5:
            problem = problem or "the AI took too long"
            break
        try:
            content = _call_ai(prompt, deadline)
        except TransientAIError as e:
            problem = str(e)
            time.sleep(min(1 + attempt, max(0.0, deadline - time.time() - 5)))
            continue
        except Exception as e:
            if not give_up_on_error:
                raise
            problem = str(e)
            break
        result, why = accept(content)
        if result is not None:
            return result, None
        problem = why or problem
    return None, problem


class QuotaExhausted(Exception):
    """Provider's daily quota is used up — skip it until it resets."""


# ─── AI providers (OpenAI-compatible chat APIs) ───────────────────────────────
# .env: GROQ_API_KEY (+ optional GROQ_MODEL) is tried first, then
# OPENROUTER_API_KEY / OPENROUTER_MODEL as the backup.
GROQ_URL        = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models"
USER_AGENT      = "LinkedIn-AI-Analyzer/1.0"

_groq_model_cache: dict = {}
_exhausted: dict = {}          # provider name -> when its daily quota ran out
EXHAUSTED_RECHECK = 3600       # try an exhausted provider again after an hour


NO_AI_KEY = "No AI key set — add GROQ_API_KEY (or OPENROUTER_API_KEY) to .env and restart the server"


def _providers() -> list[dict]:
    out = []
    if settings.groq_api_key:
        out.append({"name": "Groq", "url": GROQ_URL, "key": settings.groq_api_key})
    if settings.openrouter_api_key:
        out.append({"name": "OpenRouter", "url": OPENROUTER_URL, "key": settings.openrouter_api_key})
    return out


def _groq_model(key: str) -> str:
    """GROQ_MODEL from .env, else the best chat model Groq currently offers."""
    if settings.groq_model:
        return settings.groq_model
    if "id" in _groq_model_cache:
        return _groq_model_cache["id"]
    req = urllib.request.Request(GROQ_MODELS_URL, headers={"Authorization": f"Bearer {key}", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            ids = [m["id"] for m in json.loads(r.read()).get("data", []) if m.get("active", True)]
    except urllib.error.HTTPError as e:
        raise Exception(f"Groq {e.code}: could not list models — check GROQ_API_KEY")
    except (urllib.error.URLError, TimeoutError) as e:
        raise TransientAIError(f"Groq unreachable: {getattr(e, 'reason', e)}")
    chat = [i for i in ids if not re.search(r"whisper|tts|guard|embed|playai|orpheus|distil|compound|allam", i, re.I)]
    pick = None
    for pref in (r"llama-3\.3-70b", r"gpt-oss-120b", r"llama-4-maverick", r"llama-4", r"qwen", r"70b"):
        pick = next((i for i in chat if re.search(pref, i, re.I)), None)
        if pick:
            break
    _groq_model_cache["id"] = pick or (chat[0] if chat else "llama-3.3-70b-versatile")
    log.info("Groq model: %s", _groq_model_cache["id"])
    return _groq_model_cache["id"]


def _call_ai(prompt: list[dict], deadline: float | None = None) -> str:
    """First provider that answers wins; a used-up daily quota skips that provider.
    `deadline` (a time.time() value) caps the whole call so the caller can still answer in time."""
    providers = _providers()
    if not providers:
        raise AIUnavailable(NO_AI_KEY)
    errors, transient = [], False
    for p in providers:
        spent = _exhausted.get(p["name"])
        if spent and time.time() - spent < EXHAUSTED_RECHECK:
            errors.append(f"{p['name']} daily limit reached")
            continue
        remaining = (deadline - time.time()) if deadline else AI_REQUEST_TIMEOUT
        if remaining < 4:
            transient = True
            errors.append("time budget used up")
            break
        try:
            return _post_chat(p, prompt, timeout=min(AI_REQUEST_TIMEOUT, remaining))
        except QuotaExhausted as e:
            _exhausted[p["name"]] = time.time()
            errors.append(str(e))
        except TransientAIError as e:
            transient = True
            errors.append(str(e))
        except Exception as e:
            errors.append(str(e))
    if all("daily limit" in e for e in errors) and not settings.groq_api_key:
        errors.append("add a free GROQ_API_KEY to .env")
    raise (TransientAIError if transient else Exception)(" | ".join(errors))


def _post_chat(p: dict, prompt: list[dict], timeout: float = 40) -> str:
    name = p["name"]
    headers = {"Authorization": f"Bearer {p['key']}", "Content-Type": "application/json", "User-Agent": USER_AGENT}
    if name == "Groq":
        payload = {"model": _groq_model(p["key"]), "messages": prompt, "temperature": settings.ai_temperature}
    else:
        models = _models()
        payload = {"model": models[0], "messages": prompt, "temperature": settings.ai_temperature}
        if len(models) > 1:
            payload["models"] = models      # OpenRouter falls back down this list
        headers["X-Title"] = "LinkedIn AI Analyzer"
    req = urllib.request.Request(p["url"], data=json.dumps(payload).encode("utf-8"), method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try:
            detail = json.loads(detail).get("error", {}).get("message") or detail
        except (json.JSONDecodeError, AttributeError):
            pass
        if e.code == 429 and re.search(r"per[- ]day|\((RPD|TPD)\)", detail, re.I):
            # Daily quota — retrying can't help until it resets
            raise QuotaExhausted(f"{name} daily limit reached")
        err = TransientAIError if e.code in (408, 429, 500, 502, 503, 504) else Exception
        raise err(f"{name} {e.code}: {detail[:200]}")
    except (urllib.error.URLError, TimeoutError) as e:
        raise TransientAIError(f"{name} unreachable: {getattr(e, 'reason', e)}")

    if data.get("error"):
        # Errors inside a 200 response are upstream-provider hiccups (e.g. "overloaded")
        raise TransientAIError(f"{name}: {data['error'].get('message', data['error'])}")
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        return ""


# ─── What we know about the person, cleaned for prompts and templates ─────────
_EMPTY_VALUES = ("not specified", "unknown", "no activity data", "no recent activity", "none", "n/a")


def _plain(value, limit: int = 0) -> str:
    s = re.sub(r"\s+", " ", str(value or "")).strip()
    if s.lower() in _EMPTY_VALUES:
        return ""
    return s[:limit].rstrip() if limit and len(s) > limit else s


def _as_int(value):
    try:
        return None if value is None or value == "" else int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _outreach_context(req: dict) -> dict:
    name = _plain(req.get("name"), 120)
    first = _plain(req.get("first_name"), 60) or (name.split(" ")[0] if name else "")
    activity = _plain(req.get("activity"), 400)
    quoted = re.search(r'"([^"]{8,})', activity)
    snippet = quoted.group(1).rstrip("…. ").strip() if quoted else ""
    breakdown = req.get("icp_breakdown") if isinstance(req.get("icp_breakdown"), dict) else {}
    hits = req.get("signal_hits") if isinstance(req.get("signal_hits"), dict) else {}
    return {
        "name":        name,
        "first":       first,
        "headline":    _plain(req.get("headline"), 220),
        "position":    _plain(req.get("position"), 120),
        "company":     _plain(req.get("current_company"), 120),
        "country":     _plain(req.get("country"), 120),
        "about":       _plain(req.get("about"), 900),
        "activity":    activity,
        "snippet":     snippet,
        "days":        parse_activity_to_days(activity) if activity else None,
        "icp":         _as_int(req.get("icp_score")),
        "breakdown":   {str(k): v for k, v in breakdown.items() if isinstance(v, dict)},
        "act":         _as_int(req.get("activity_score")),
        "act_label":   _plain(req.get("activity_label"), 60),
        "engagement":  _plain(req.get("engagement_label"), 40),
        "hits":        {str(k): _plain(v, 60) for k, v in hits.items() if _plain(v)},
        "pain":        _plain(req.get("pain_point"), 200),
        "prior":       _plain(req.get("prior_contact"), 300),
    }


def _short_topic(snippet: str, words: int = 8) -> str:
    parts = snippet.split()
    return " ".join(parts[:words]) + ("…" if len(parts) > words else "")


def _outreach_angle(ctx: dict) -> str:
    parts = []
    icp = ctx["icp"]
    if icp is not None:
        if icp >= STRONG_FIT:
            parts.append(f"Strong ICP fit ({icp}/100)")
        elif icp >= WEAK_FIT:
            parts.append(f"Partial ICP fit ({icp}/100)")
        else:
            parts.append(f"Weak ICP fit ({icp}/100) — build the relationship, no pitch yet")
    hits = ctx["hits"]
    if hits.get("hiring"):
        parts.append(f'they\'re hiring ("{hits["hiring"]}")')
    elif hits.get("job"):
        parts.append(f'job openings mentioned ("{hits["job"]}")')
    if hits.get("growth"):
        parts.append(f'growth signal ("{hits["growth"]}")')
    if ctx.get("pain"):
        parts.append(f"known pain point: {_plain(ctx['pain'], 50)}")
    days = ctx["days"]
    if days is not None and days <= 30 and ctx["snippet"]:
        parts.append("active recently — open with their latest post")
    elif days is not None and days <= 30:
        parts.append("active on LinkedIn in the last month")
    elif ctx["act"] is not None and ctx["act"] < WEAK_FIT:
        parts.append("rarely active on LinkedIn — keep the note short and personal")
    if not parts:
        return "Not much to go on yet — keep the first note short, personal and pitch-free."
    angle = "; ".join(parts[:3])
    return angle[0].upper() + angle[1:] + "."


def _analysis_block(ctx: dict) -> str:
    lines = []
    if ctx["icp"] is not None:
        lines.append(f"ICP fit score: {ctx['icp']}/100")
        for cat, row in ctx["breakdown"].items():
            lines.append(f"  - {cat}: {row.get('score', 0)}/{row.get('max', 0)} — {_plain(row.get('reason'), 120)}")
    if ctx["act"] is not None:
        label = f" ({ctx['act_label']})" if ctx["act_label"] else ""
        lines.append(f"LinkedIn activity score: {ctx['act']}/100{label}")
    if ctx["engagement"]:
        lines.append(f"Engagement on their posts: {ctx['engagement']}")
    if ctx["activity"]:
        lines.append(f"Recent activity: {ctx['activity']}")
    for name, kw in ctx["hits"].items():
        lines.append(f'{name.capitalize()} signal found: "{kw}"')
    if ctx["pain"]:
        lines.append(f"Known pain point (from an earlier analysis of their posts): {ctx['pain']}")
    if ctx["prior"]:
        lines.append(f"Previous contact with them: {ctx['prior']}")
    return "Analysis:\n" + ("\n".join(lines) or "(no scores yet)")


# ─── Connect → "Add a note": notes written for THIS person ────────────────────
# Words too common to prove a note is personal ("Hi Priya, great profile!" is not).
_GENERIC_WORDS = set("""the and for with from your you our their about this that have been will would
    linkedin profile network connect connecting company team work working role people person experience
    great good nice love happy glad keen passionate professional helping building""".split())


def _detail_tokens(ctx: dict) -> list:
    """Concrete words only this person's note would contain: company, role, post topic, matched ICP terms, signals."""
    texts = [ctx["company"], ctx["position"], ctx["headline"], ctx["snippet"]]
    for row in ctx["breakdown"].values():
        m = re.search(r"\(([^)]+)\)", str(row.get("reason") or ""))
        if m:
            texts.append(m.group(1))
    texts += list(ctx["hits"].values())
    texts.append(ctx.get("pain", ""))
    texts.append(ctx.get("prior", ""))
    texts.append(ctx["country"].split(",")[0] if ctx["country"] else "")
    out = []
    for t in texts:
        for w in re.findall(r"[a-z0-9][a-z0-9&+'.-]{2,}", normalize(t)):
            w = w.strip(".'-")
            if len(w) >= 3 and w not in _GENERIC_WORDS and w not in out:
                out.append(w)
    return out


def _is_personal(note: str, tokens: list) -> bool:
    return any(find_phrase(t, note, plural=False) for t in tokens)


def _note_fit_hint(icp) -> str:
    if icp is None:
        return "- Keep any mention of what we do to a few words.\n"
    if icp >= STRONG_FIT:
        return f"- Strong ICP fit ({icp}/100): you may say in a few words how we help people like them.\n"
    if icp < WEAK_FIT:
        return f"- Weak ICP fit ({icp}/100): relationship only — do not mention our services.\n"
    return f"- Partial ICP fit ({icp}/100): at most a light hint of what we do.\n"


def _invite_prompt(ctx: dict, pitch: dict, tone: str, max_chars: int, posts: list) -> list[dict]:
    first = ctx["first"] or "there"
    system = (
        _persona(pitch) + 'You write LinkedIn connection-request notes (the "Add a note" box).\n'
        f"{TONE_RULES[tone]}\n"
        "Rules:\n"
        f"- Write {SUGGESTION_MAX} different notes to {first}, each under {max_chars} characters, "
        f"greeting {first} by first name.\n"
        "- Every note must mention a concrete detail about THIS person from the profile or analysis below, and "
        "each note a DIFFERENT one: their role or company, their latest post topic, a hiring or growth signal, "
        'or the industry / focus that matched our ICP. Generic lines like "great profile" do not count.\n'
        "- Give one short reason to connect that links that detail to us. No meeting request, no links, no hard sell.\n"
        + _note_fit_hint(ctx["icp"])
        + ("- We've messaged them before (see Previous contact): acknowledge it naturally; never repeat the same opener.\n" if ctx["prior"] else "")
        + ("- If the known pain point fits, reference it in ONE of the notes.\n" if ctx["pain"] else "")
        + "- Use only facts given below; leave out anything unknown. No placeholders.\n"
        + LANGUAGE_RULE_OPENER + COMMON_RULES +
        'Return ONLY JSON: {"analysis": "<one sentence: why this person is worth connecting with, from the analysis>", '
        '"suggestions": ["...", "...", "..."]}'
    )
    profile = {"name": ctx["name"], "headline": ctx["headline"], "position": ctx["position"],
               "current_company": ctx["company"], "location": ctx["country"], "about": ctx["about"]}
    user = f"{_profile_block(profile)}\n\n{_analysis_block(ctx)}"
    if posts:
        user += "\n\nTheir recent LinkedIn posts (newest first):\n" + "\n".join(f"{i + 1}. {t}" for i, t in enumerate(posts))
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _matched_industry(ctx: dict) -> str:
    for cat, row in ctx["breakdown"].items():
        if cat.startswith("Industry") and row.get("score"):
            m = re.search(r"\(([^)]+)\)", str(row.get("reason") or ""))
            if m:
                return m.group(1)
    return ""


def _invite_templates(ctx: dict, pitch: dict, tone: str, max_chars: int) -> list:
    """Up to 3 notes, each built on a different detail about the person."""
    first = ctx["first"] or "there"
    pro = tone == "pro"
    hooks = []
    if ctx["snippet"]:
        hooks.append(f'I {"read" if pro else "enjoyed"} your recent post on "{_short_topic(ctx["snippet"], 7)}"')
    if ctx["position"] and ctx["company"]:
        hooks.append(f"I came across your work as {ctx['position']} at {ctx['company']}")
    elif ctx["position"] or ctx["headline"]:
        hooks.append(f"I came across your work as {ctx['position'] or _plain(ctx['headline'], 80)}")
    if ctx["hits"].get("hiring") or ctx["hits"].get("job"):
        hooks.append(f"I saw {ctx['company'] or 'your team'} is hiring")
    industry = _matched_industry(ctx)
    if industry:
        hooks.append(f"I'm always glad to meet people working in {industry}")
    if not hooks:
        hooks.append("I came across your profile")
    weak = ctx["icp"] is not None and ctx["icp"] < WEAK_FIT
    expertise = _plain(pitch.get("expertise"), 60)
    if weak or not expertise:
        bridge = "I'd welcome the chance to connect." if pro else "Would be great to connect!"
    else:
        bridge = (f"I work with {expertise} and would welcome the chance to connect." if pro
                  else f"We're {expertise} — would be great to connect!")
    return [_fit_length(f"Hi {first}, {hook}. {bridge}", max_chars) for hook in hooks[:SUGGESTION_MAX]]


def generate_invite_notes(req: dict, tone: str, max_chars: int, profile_url: str = "") -> dict:
    """Connection-request notes personalised from the profile + ICP / Activity analysis.
    AI notes that mention nothing specific to the person are rejected; the fallback
    is a template built from their details. Never raises for AI trouble."""
    tone = "pro" if tone == "pro" else "casual"
    max_chars = max(80, min(int(max_chars or MAX_CHARS), 1000))
    req = req if isinstance(req, dict) else {}
    pitch = _pitch_for(req.get("sender_role"))
    ctx = _outreach_context(req)
    tokens = _detail_tokens(ctx)
    angle = _outreach_angle(ctx)
    result = {"mode": "invite", "analysis": angle, "pain_point": "", "pain_source": "",
              "source": "template", "notice": ""}

    if not tokens:
        return {**result, "suggestions": _invite_templates(ctx, pitch, tone, max_chars),
                "notice": "No profile details found for this person — open their profile, or calculate ICP / "
                          "Activity, for a personalised note."}
    if not _providers():
        return {**result, "suggestions": _invite_templates(ctx, pitch, tone, max_chars),
                "notice": "AI is not set up — notes built from their profile."}

    posts = recent_post_texts(profile_url) if (tone == "pro" and profile_url and not ctx["snippet"]) else []
    prompt = _invite_prompt(ctx, pitch, tone, max_chars, posts)
    best: list = []

    def accept(content):
        nonlocal best
        suggestions, pain, analysis, _meta = _parse_reply_full(content, max_chars)
        personal = [n for n in suggestions if _is_personal(n, tokens)]
        if len(personal) >= 2:
            return {**result, "suggestions": personal, "analysis": analysis or angle, "source": "ai",
                    "pain_point": pain if posts else "", "pain_source": "recent posts" if posts and pain else ""}, None
        if len(personal) > len(best):
            best = personal
        return None, "the AI notes were not specific to this person"

    done, problem = _ask_ai(prompt, CHAT_BUDGET_S, 3, accept, give_up_on_error=True)
    if done is not None:
        return done
    problem = problem or "the AI reply could not be read"
    templates = [t for t in _invite_templates(ctx, pitch, tone, max_chars) if t not in best]
    return {**result, "suggestions": (best + templates)[:SUGGESTION_MAX], "source": "ai" if best else "template",
            "notice": f"AI unavailable ({_plain(problem, 120)}) — notes built from their profile."}


# ─── Admin panel: one ready-to-send message per lead ──────────────────────────
# The panel shows Profile + Conversation + a suggested message with Edit / Copy /
# Send. It needs the message AND the labels around it (why this person, what they
# want, what the personalisation was drawn from), so this returns all of it at once.
LEAD_MESSAGE_MAX = 900
PERSONALIZATION_MAX = 5
# "[Your Company]", "[Name]" - a fill-in-the-blank left in the draft. The prompt
# forbids them, but a model still slips one in, and pasting it into LinkedIn is
# the kind of mistake that cannot be taken back, so it is checked rather than trusted.
PLACEHOLDER_RE = re.compile(r'\[[^]]{2,40}\]')

LEAD_MESSAGE_FIELDS = ("name", "headline", "about", "company", "job_title", "industry",
                       "location", "profile_url", "experience", "skills", "recent_activity")


def _lead_profile_block(profile: dict) -> str:
    labels = [("name", "Name"), ("headline", "Headline"), ("job_title", "Job title"),
              ("company", "Current company"), ("industry", "Industry"), ("location", "Location"),
              ("about", "About"), ("experience", "Experience"), ("skills", "Skills"),
              ("recent_activity", "Recent activity/posts"), ("profile_url", "Profile URL")]
    lines = []
    for key, label in labels:
        value = str(profile.get(key) or "").strip()
        if value and value.lower() not in _EMPTY_VALUES:
            lines.append(f"{label}: {value[:600]}")
    return "\n".join(lines) or "(no profile details available)"


def _lead_message_prompt(pitch: dict, profile: dict, messages: list, goal: str, has_convo: bool) -> list:
    first = str(profile.get("name") or "").split()[0] if profile.get("name") else "them"
    case = (
        "CASE: there IS a conversation. Read all of it, focus on the latest message, and reply directly to it. "
        "Keep the tone the conversation already has. Do not repeat what was already said. Answer any question "
        "they asked, and add a natural follow-up question when one is warranted."
        if has_convo else
        "CASE: there is NO previous conversation. Write a first message. Base the reason for contact ONLY on the "
        "profile. Never imply you have spoken before. If the profile is thin, send something simply professional "
        "rather than inventing a detail - and never the generic \"I saw your profile and wanted to connect\"."
    )
    system = (
        _persona(pitch) +
        "You help an admin write one LinkedIn message to this person.\n" + case + "\n"
        "Style: human, concise, professional but conversational; match how they write; no emoji unless they use "
        "them; no gushing, no AI-sounding phrases, no long explanations, no fake personalisation. Never mention "
        "that this was AI-written.\n"
        "Never invent facts, numbers, prices, availability, commitments or past contact.\n"
        f"Keep suggested_message under {LEAD_MESSAGE_MAX} characters, with no subject line and no signature.\n"
        "personalization_points: the concrete things you actually used, each naming its source, e.g. "
        '"Headline: Founder at Acme" or "Their last message asked about pricing". Use [] when the profile and '
        "conversation gave you nothing specific.\n"
        + COMMON_RULES +
        "Return ONLY JSON: {"
        f'"conversation_exists": {"true" if has_convo else "false"}, '
        '"profile_summary": "<one or two sentences about this person>", '
        '"contact_reason": "<why contacting them makes sense>", '
        '"intent": "<what they likely want; for a first message, what they would care about>", '
        '"recommended_tone": "professional"|"friendly"|"casual", '
        '"suggested_message": "<the message, ready to send>", '
        '"personalization_points": ["..."], '
        '"needs_review": true}'
    )
    parts = [f"PROFILE\n{_lead_profile_block(profile)}"]
    if has_convo:
        parts.append("CONVERSATION (oldest first)\n" + _transcript(messages, first))
        latest = messages[-1]
        parts.append("LATEST_MESSAGE\n" + f"{_label(latest, first)}: {latest.get('text', '').strip()}")
    else:
        parts.append("CONVERSATION\n(none - this is the first message)")
    if goal:
        parts.append("ADMIN_GOAL\n" + goal[:400])
    return [{"role": "system", "content": system}, {"role": "user", "content": "\n\n".join(parts)}]


def _clean_lead_message(data: dict, has_convo: bool, max_chars: int) -> dict:
    """Trust nothing the model returns: clamp every field to the shape the panel renders."""
    def text(key, limit):
        return re.sub(r"\s+", " ", str(data.get(key) or "")).strip()[:limit]

    tone = str(data.get("recommended_tone") or "").strip().lower()
    points = data.get("personalization_points")
    if isinstance(points, str):
        points = [points]
    if not isinstance(points, list):
        points = []
    points = [re.sub(r"\s+", " ", str(p)).strip()[:160] for p in points]
    points = [p for p in points if p][:PERSONALIZATION_MAX]
    message = text("suggested_message", max_chars + 200)
    return {
        "conversation_exists": has_convo,
        "profile_summary":     text("profile_summary", 400),
        "contact_reason":      text("contact_reason", 300),
        "intent":              text("intent", 200),
        "recommended_tone":    tone if tone in ("professional", "friendly", "casual") else "professional",
        "suggested_message":   _fit_length(message, max_chars) if message else "",
        "personalization_points": points,
        # Always true: a person sends this, so it is a draft until they approve it.
        "needs_review":        True,
    }


def generate_lead_message(req: dict) -> dict:
    """Profile (+ conversation, when there is one) -> the admin panel's message card."""
    profile = {k: str(req.get(k) or "").strip() for k in LEAD_MESSAGE_FIELDS}
    messages = [m for m in (req.get("messages") or []) if isinstance(m, dict) and str(m.get("text") or "").strip()]
    has_convo = bool(messages)
    goal = str(req.get("goal") or "").strip()
    max_chars = max(120, min(int(req.get("max_chars") or LEAD_MESSAGE_MAX), LEAD_MESSAGE_MAX))
    if not _providers():
        raise AIUnavailable(NO_AI_KEY)

    pitch = _pitch_for(req.get("sender_role") or "")
    prompt = _lead_message_prompt(pitch, profile, messages, goal, has_convo)

    def accept(content):
        data = _json_object(content)
        if not isinstance(data, dict):
            return None, None
        result = _clean_lead_message(data, has_convo, max_chars)
        message = result["suggested_message"]
        if message and PLACEHOLDER_RE.search(message):
            # Ask again rather than hand over a draft with a blank to fill in.
            return None, "AI left a placeholder in the message - try again"
        return (result, None) if message else (None, None)

    result, problem = _ask_ai(prompt, MESSAGE_BUDGET_S, 3, accept)
    if result is None:
        raise AIUnavailable(problem or "AI returned no usable message - try again")
    return result
