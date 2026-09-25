import json
import os
import re
import time
import urllib.error
import urllib.request

from services.actor_service import run_posts_actor
from services.matching import find_phrase, normalize
from services.scoring_service import parse_activity_to_days, split_own_posts

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

HISTORY_LIMIT   = 40    # the ✨ popup analyses the whole loaded thread, up to this many messages
MESSAGE_CHAR_CAP    = 600    # one message in the transcript
TRANSCRIPT_CHAR_CAP = 5000   # whole transcript — oldest messages drop first
SUGGESTION_MAX  = 3
MAX_CHARS       = 300   # default cap; invite notes send LinkedIn's own limit
OUTREACH_NOTE_MAX    = 300   # LinkedIn's connection-note limit
OUTREACH_MESSAGE_MAX = 700
POSTS_FOR_PAIN  = 5     # recent posts read to find the pro opener's pain point
POSTS_CACHE_TTL = 6 * 3600

# ─── Pitch: who "I" am in every message ───────────────────────────────────────
# Edited from the extension toolbar popup (Settings) and stored in
# pitch_config.json next to main.py — same pattern as icp_config.json.
BASE_DIR          = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PITCH_CONFIG_FILE = os.path.join(BASE_DIR, "pitch_config.json")

DEFAULT_PITCH = {
    "who":           "Founder of a healthcare IT company",
    "expertise":     "healthcare tech experts",
    "offer":         "if you need anything in tech, we can help",
    "services":      "",
    "casual_opener": "We are healthcare tech experts — if you're looking for anything in tech, we can help.",
}


def get_pitch_config() -> dict:
    """Saved pitch (pitch_config.json) merged over the defaults."""
    pitch = dict(DEFAULT_PITCH)
    try:
        with open(PITCH_CONFIG_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        pitch.update({k: str(v).strip() for k, v in saved.items() if k in DEFAULT_PITCH and str(v).strip()})
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return pitch


def save_pitch_config(data: dict) -> dict:
    pitch = get_pitch_config()
    pitch.update({k: str(v).strip() for k, v in data.items() if k in DEFAULT_PITCH and v is not None})
    with open(PITCH_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(pitch, f, indent=2, ensure_ascii=False)
    return get_pitch_config()


def _pitch_for(sender_role) -> dict:
    """The saved pitch, with "who I am" overridden by the Setup role when one is set."""
    pitch = get_pitch_config()
    role = _plain_role(sender_role)
    return {**pitch, "who": role} if role else pitch


def _plain_role(value) -> str:
    import re as _re
    return _re.sub(r"\s+", " ", str(value or "")).strip()[:120]


def _models() -> list[str]:
    """OPENROUTER_MODEL may list fallbacks: "primary,backup,openrouter/free"."""
    raw = os.getenv("OPENROUTER_MODEL") or "openrouter/free"
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
    # Own posts only: a repost's text is someone else's words — reading a "pain
    # point" out of it would personalise the message to the wrong person.
    own, _ = split_own_posts(run_posts_actor(profile_url, max_posts=POSTS_FOR_PAIN + 3), profile_url)
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
    if icp is not None and icp >= 70:
        how = "Strong fit: be confident and direct — a clear ask for a short 15-minute call is fine."
    elif icp is not None and icp < 40:
        how = "Weak fit: build the relationship only — no pitch and no call request."
    else:
        how = "Medium fit: lead with value and end with a soft, low-pressure question."
    return f"- Lead score: {', '.join(bits)}. {how}\n"


def _json_format(pain: bool = False, analysis: bool = False) -> str:
    if pain:
        return 'Return ONLY JSON: {"pain_point": "<one short phrase>", "suggestions": ["...", "...", "..."]}'
    if analysis:
        return ('Return ONLY JSON: {"analysis": "<one sentence: where the chat stands and what the next message '
                'should do>", "suggestions": ["...", "...", "..."]}')
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
        _persona(pitch) + f"{TONE_RULES[tone]}\n"
        "First read the whole conversation and judge where it stands: who spoke last, any question of theirs "
        "still unanswered, and the stage (first contact / building rapport / discussing needs / scheduling a call "
        "/ gone quiet). Write the next messages for THAT situation.\n"
        "Rules:\n"
        f"- Write {SUGGESTION_MAX} different next messages I could send, each under {max_chars} characters.\n"
        "- If the last message is from them, reply directly to it (answer their question, react to what they said).\n"
        "- If the last message is mine, write a natural follow-up — never repeat my previous text.\n"
        "- Build on what was already said; never re-introduce myself or re-pitch something they already heard.\n"
        "- Each suggestion takes a different angle; keep the sales offer light and relevant.\n"
        f"- A line like [shared a post by X: \"…\"] is a LinkedIn post shared in the chat. X is only the post's author, "
        f"NOT the person I'm chatting with — never greet or address X; talk to {first} about the post if relevant.\n"
        + _followup_rule(messages, awaiting_reply_days)
        + _fit_rule(lead) + _language_rule(messages) + COMMON_RULES +
        f"- Address them as {first} when natural.\n" + _json_format(analysis=True)
    )
    user = f"{_profile_block(profile)}\n\nLast {len(messages)} message(s), oldest first:\n{_transcript(messages, first)}"
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


def _parse_reply(content: str, max_chars: int = MAX_CHARS) -> tuple[list[str], str]:
    """-> (suggestions, pain_point)"""
    suggestions, pain, _ = _parse_reply_full(content, max_chars)
    return suggestions, pain


def _parse_reply_full(content: str, max_chars: int = MAX_CHARS) -> tuple[list[str], str, str]:
    """-> (suggestions, pain_point, analysis)"""
    text = (content or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I).strip()
    items: list = []
    pain = analysis = ""
    data = _json_object(text)
    if data is not None:
        items = data.get("suggestions") or []
        if not isinstance(items, list):
            items = []
        pain = str(data.get("pain_point") or "").strip()
        analysis = re.sub(r"\s+", " ", str(data.get("analysis") or "")).strip()
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
    return out[:SUGGESTION_MAX], pain[:120], analysis[:240]


def _fit_length(s: str, max_chars: int) -> str:
    """Trim at a sentence/word boundary instead of mid-word (invite notes are hard-capped)."""
    if len(s) <= max_chars:
        return s
    cut = s[:max_chars]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if end >= max_chars * 0.6:
        return cut[:end + 1]
    return cut[:cut.rfind(" ")].rstrip(",;:—- ") if " " in cut else cut


def _parse_suggestions(content: str) -> list[str]:
    return _parse_reply(content)[0]


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
        raise Exception("No AI key set — add GROQ_API_KEY (or OPENROUTER_API_KEY) to .env and restart the server")
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

    # Providers are tried in order (Groq → OpenRouter). Quick failures — rate
    # limits, overload, or a router pick that ignores the format (a guard model
    # answering "User Safety: safe") — are retried a few times before giving up.
    last_error = "AI returned no usable suggestions — try again"
    deadline = time.time() + CHAT_BUDGET_S
    for attempt in range(4):
        if time.time() > deadline - 5:
            break
        try:
            content = _call_ai(prompt, deadline)
        except TransientAIError as e:
            last_error = str(e)
            time.sleep(min(1 + attempt, max(0.0, deadline - time.time() - 5)))
            continue
        suggestions, pain, analysis = _parse_reply_full(content, max_chars)
        if len(suggestions) >= 2 or (mode == "rewrite" and suggestions):
            return {
                "suggestions": suggestions,
                "mode":        mode,
                "pain_point":  pain if pain_source else "",
                "pain_source": pain_source if pain else "",
                "analysis":    analysis if mode == "reply" else "",
            }
    raise Exception(last_error)


# The extension gives up after 100s (chat) / 90s (outreach) and a sleeping Render
# server eats part of that, so the server stops retrying well before.
AI_REQUEST_TIMEOUT = 40
CHAT_BUDGET_S = 75
OUTREACH_BUDGET_S = 40


class TransientAIError(Exception):
    """Rate limit / overload / network blip — worth another try."""


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


def _providers() -> list[dict]:
    out = []
    if os.getenv("GROQ_API_KEY"):
        out.append({"name": "Groq", "url": GROQ_URL, "key": os.getenv("GROQ_API_KEY")})
    if os.getenv("OPENROUTER_API_KEY"):
        out.append({"name": "OpenRouter", "url": OPENROUTER_URL, "key": os.getenv("OPENROUTER_API_KEY")})
    return out


def _groq_model(key: str) -> str:
    """GROQ_MODEL from .env, else the best chat model Groq currently offers."""
    if os.getenv("GROQ_MODEL"):
        return os.getenv("GROQ_MODEL")
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
    print(f"[LI-AI] Groq model: {_groq_model_cache['id']}")
    return _groq_model_cache["id"]


def _call_ai(prompt: list[dict], deadline: float | None = None) -> str:
    """First provider that answers wins; a used-up daily quota skips that provider.
    `deadline` (a time.time() value) caps the whole call so the caller can still answer in time."""
    providers = _providers()
    if not providers:
        raise Exception("No AI key set — add GROQ_API_KEY (or OPENROUTER_API_KEY) to .env and restart the server")
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
    if all("daily limit" in e for e in errors) and not os.getenv("GROQ_API_KEY"):
        errors.append("add a free GROQ_API_KEY to .env")
    raise (TransientAIError if transient else Exception)(" | ".join(errors))


def _post_chat(p: dict, prompt: list[dict], timeout: float = 40) -> str:
    name = p["name"]
    headers = {"Authorization": f"Bearer {p['key']}", "Content-Type": "application/json", "User-Agent": USER_AGENT}
    if name == "Groq":
        payload = {"model": _groq_model(p["key"]), "messages": prompt, "temperature": 0.8}
    else:
        models = _models()
        payload = {"model": models[0], "messages": prompt, "temperature": 0.8}
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


# ─── Outreach: connection note + first message from the ICP / Activity analysis ─
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
        if icp >= 70:
            parts.append(f"Strong ICP fit ({icp}/100)")
        elif icp >= 40:
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
    elif ctx["act"] is not None and ctx["act"] < 40:
        parts.append("rarely active on LinkedIn — keep the note short and personal")
    if not parts:
        return "Not much to go on yet — keep the first note short, personal and pitch-free."
    angle = "; ".join(parts[:3])
    return angle[0].upper() + angle[1:] + "."


def _outreach_template(ctx: dict, pitch: dict, tone: str, notice: str = "") -> dict:
    first = ctx["first"] or "there"
    pro = tone == "pro"
    if ctx["snippet"]:
        verb = "read" if pro else "enjoyed"
        hook = f'I {verb} your recent post on "{_short_topic(ctx["snippet"])}"'
    elif ctx["position"] and ctx["company"]:
        hook = f"I came across your work as {ctx['position']} at {ctx['company']}"
    elif ctx["position"]:
        hook = f"I came across your work as {ctx['position']}"
    elif ctx["headline"]:
        hook = f"I came across your profile ({_plain(ctx['headline'], 90)})"
    else:
        hook = "I came across your profile"
    weak = ctx["icp"] is not None and ctx["icp"] < 40
    expertise = _plain(pitch.get("expertise"), 80)
    intro = "" if weak or not expertise else f" We're {expertise}."
    close = " I'd welcome the chance to connect." if pro else " Would be great to connect!"
    note = _fit_length(f"Hi {first}, {hook}.{intro}{close}", OUTREACH_NOTE_MAX)

    opener = _plain(pitch.get("casual_opener"), 260) or _plain(pitch.get("offer"), 200)
    icp = ctx["icp"]
    if weak:
        ask = "No agenda — just happy to be connected and to swap ideas anytime."
        opener = ""
    elif icp is not None and icp >= 70:
        ask = "Would you be open to a quick 15-minute call next week to see if there's a fit?"
    else:
        ask = "Would it help if I shared a couple of ideas for your team?"
    thanks = f"Thank you for connecting, {first}." if pro else f"Thanks for connecting, {first}!"
    ref = ""
    if ctx["snippet"]:
        ref = f' Your post on "{_short_topic(ctx["snippet"], 6)}" stood out.'
    elif ctx["company"]:
        ref = f" Great to see what you're building at {ctx['company']}."
    message = _fit_length(" ".join(x for x in (thanks + ref, opener, ask) if x), OUTREACH_MESSAGE_MAX)
    return {"angle": _outreach_angle(ctx), "connection_note": note, "message": message,
            "source": "template", "notice": notice}


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


def _outreach_prompt(ctx: dict, pitch: dict, tone: str) -> list[dict]:
    first = ctx["first"] or "there"
    lead = {"icp_score": ctx["icp"], "activity_score": ctx["act"], "activity_label": ctx["act_label"]}
    system = (
        _persona(pitch) +
        "You write a LinkedIn connection-request note and the first message to send after they accept.\n"
        f"{TONE_RULES[tone]}\n"
        "Rules:\n"
        "- angle: one short sentence — why this person is worth contacting now and how to approach them, "
        "based only on the analysis.\n"
        f"- connection_note: under {OUTREACH_NOTE_MAX} characters, greets {first}, mentions ONE concrete detail "
        "from the analysis (their recent post topic, role, company, or a hiring/growth signal), no hard sell.\n"
        f"- message: under {OUTREACH_MESSAGE_MAX} characters, sent after they accept: thank them, link that detail "
        "to how we can help, end with an ask that matches the fit.\n"
        + (_fit_rule(lead) or "- End the message with a soft, low-pressure question.\n")
        + "- Use only facts from the profile or analysis; leave out anything unknown.\n"
        + LANGUAGE_RULE_OPENER + COMMON_RULES +
        'Return ONLY JSON: {"angle": "...", "connection_note": "...", "message": "..."}'
    )
    profile = {"name": ctx["name"], "headline": ctx["headline"], "position": ctx["position"],
               "current_company": ctx["company"], "location": ctx["country"], "about": ctx["about"]}
    user = f"{_profile_block(profile)}\n\n{_analysis_block(ctx)}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _parse_outreach(content: str):
    data = _json_object(content)
    if not data:
        return None
    note = _plain(data.get("connection_note")).strip('"')
    message = _plain(data.get("message")).strip('"')
    if len(note) < 15 or len(message) < 15 or re.search(r"\[[A-Za-z ]+\]", note + message):
        return None   # too short, or placeholders like [Name] left in
    return {
        "angle": _plain(data.get("angle"), 240),
        "connection_note": _fit_length(note, OUTREACH_NOTE_MAX),
        "message": _fit_length(message, OUTREACH_MESSAGE_MAX),
    }


def generate_outreach(req: dict) -> dict:
    """-> {"angle", "connection_note", "message", "source": "ai"|"template", "notice"}. Never raises for AI trouble."""
    req = req if isinstance(req, dict) else {}
    pitch = _pitch_for(req.get("sender_role"))
    tone = "pro" if req.get("tone") == "pro" else "casual"
    ctx = _outreach_context(req)
    if not any(ctx[k] for k in ("position", "company", "headline", "snippet", "about", "hits", "breakdown")):
        # Nothing concrete to personalise with — an AI would only invent details
        return _outreach_template(ctx, pitch, tone,
                                  "Not enough profile details for a personalised AI note — calculate the ICP or "
                                  "Activity score first. This is a template.")
    if not _providers():
        return _outreach_template(ctx, pitch, tone,
                                  "AI is not set up (no GROQ_API_KEY / OPENROUTER_API_KEY) — this is a template "
                                  "built from the analysis.")
    prompt = _outreach_prompt(ctx, pitch, tone)
    problem = "the AI reply could not be read"
    deadline = time.time() + OUTREACH_BUDGET_S
    for attempt in range(3):
        if time.time() > deadline - 5:
            problem = "the AI took too long" if attempt == 0 else problem
            break
        try:
            content = _call_ai(prompt, deadline)
        except TransientAIError as e:
            problem = str(e)
            time.sleep(min(0.5 * (attempt + 1), max(0.0, deadline - time.time() - 5)))
            continue
        except Exception as e:
            problem = str(e)
            break
        parsed = _parse_outreach(content)
        if parsed:
            if not parsed["angle"]:
                parsed["angle"] = _outreach_angle(ctx)
            return {**parsed, "source": "ai", "notice": ""}
    return _outreach_template(ctx, pitch, tone,
                              f"AI unavailable ({_plain(problem, 140)}) — this is a template built from the analysis.")


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
    if icp >= 70:
        return f"- Strong ICP fit ({icp}/100): you may say in a few words how we help people like them.\n"
    if icp < 40:
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
    weak = ctx["icp"] is not None and ctx["icp"] < 40
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
    deadline = time.time() + CHAT_BUDGET_S
    best, problem = [], "the AI reply could not be read"
    for attempt in range(3):
        if time.time() > deadline - 5:
            break
        try:
            content = _call_ai(prompt, deadline)
        except TransientAIError as e:
            problem = str(e)
            time.sleep(min(1 + attempt, max(0.0, deadline - time.time() - 5)))
            continue
        except Exception as e:
            problem = str(e)
            break
        suggestions, pain, analysis = _parse_reply_full(content, max_chars)
        personal = [n for n in suggestions if _is_personal(n, tokens)]
        if len(personal) >= 2:
            return {**result, "suggestions": personal, "analysis": analysis or angle, "source": "ai",
                    "pain_point": pain if posts else "", "pain_source": "recent posts" if posts and pain else ""}
        if len(personal) > len(best):
            best = personal
        problem = "the AI notes were not specific to this person"
    templates = [t for t in _invite_templates(ctx, pitch, tone, max_chars) if t not in best]
    return {**result, "suggestions": (best + templates)[:SUGGESTION_MAX], "source": "ai" if best else "template",
            "notice": f"AI unavailable ({_plain(problem, 120)}) — notes built from their profile."}
