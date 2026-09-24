import json
import os
import re
import time
import urllib.error
import urllib.request

from services.actor_service import run_posts_actor

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

HISTORY_LIMIT   = 5     # the ✨ popup analyses the last 5 chat messages
SUGGESTION_MAX  = 3
MAX_CHARS       = 300   # default cap; invite notes send LinkedIn's own limit
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
    for post in run_posts_actor(profile_url, max_posts=POSTS_FOR_PAIN + 3):
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


def _json_format(pain: bool = False) -> str:
    if pain:
        return 'Return ONLY JSON: {"pain_point": "<one short phrase>", "suggestions": ["...", "...", "..."]}'
    return 'Return ONLY JSON: {"suggestions": ["...", "...", "..."]}'


def _speaker(name: str | None, first: str) -> str:
    """Their label in the transcript; the extension's placeholders ("Them"/"You") fall back to the first name."""
    name = (name or "").strip()
    return first if not name or name.lower() in ("them", "you", "unknown") else name


def _transcript(messages: list[dict], first: str) -> str:
    return "\n".join(
        f"{'Me' if m.get('sender') == 'me' else _speaker(m.get('name'), first)}: {m.get('text', '').strip()}"
        for m in messages
    )


def _reply_prompt(pitch, messages, tone, first, profile, lead, max_chars) -> list[dict]:
    system = (
        _persona(pitch) + f"{TONE_RULES[tone]}\n"
        "Rules:\n"
        f"- Write {SUGGESTION_MAX} different next messages I could send, each under {max_chars} characters.\n"
        "- If the last message is from them, reply directly to it (answer their question, react to what they said).\n"
        "- If the last message is mine, write a natural follow-up — never repeat my previous text.\n"
        "- Each suggestion takes a different angle; keep the sales offer light and relevant.\n"
        f"- A line like [shared a post by X: \"…\"] is a LinkedIn post shared in the chat. X is only the post's author, "
        f"NOT the person I'm chatting with — never greet or address X; talk to {first} about the post if relevant.\n"
        + _fit_rule(lead) + _language_rule(messages) + COMMON_RULES +
        f"- Address them as {first} when natural.\n" + _json_format()
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


def _parse_reply(content: str, max_chars: int = MAX_CHARS) -> tuple[list[str], str]:
    """-> (suggestions, pain_point)"""
    text = (content or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I).strip()
    items: list = []
    pain = ""
    match = re.search(r"\{.*\}", text, flags=re.S)
    if match:
        try:
            data = json.loads(match.group(0))
            items = data.get("suggestions") or []
            pain = str(data.get("pain_point") or "").strip()
        except (json.JSONDecodeError, AttributeError):
            items = []
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
    return out[:SUGGESTION_MAX], pain[:120]


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
                              max_chars: int = MAX_CHARS) -> dict:
    """-> {"suggestions": [...], "mode": "reply"|"opener"|"rewrite", "pain_point": str, "pain_source": str}"""
    if not _providers():
        raise Exception("No AI key set — add GROQ_API_KEY (or OPENROUTER_API_KEY) to .env and restart the server")
    tone = "pro" if tone == "pro" else "casual"
    first = first_name or "them"
    lead = lead or {}
    invite = context == "invite"
    max_chars = max(80, min(int(max_chars or MAX_CHARS), 1000))
    messages = [] if invite else [m for m in messages if (m.get("text") or "").strip()][-HISTORY_LIMIT:]
    pitch = get_pitch_config()

    pain_source = ""
    if draft.strip():
        mode = "rewrite"
        prompt = _rewrite_prompt(pitch, draft.strip()[:2000], action if action in REWRITE_ACTIONS else "improve",
                                 tone, first, messages, max_chars)
    elif messages:
        mode, prompt = "reply", _reply_prompt(pitch, messages, tone, first, profile, lead, max_chars)
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
    for attempt in range(4):
        try:
            content = _call_ai(prompt)
        except TransientAIError as e:
            last_error = str(e)
            time.sleep(1 + attempt)
            continue
        suggestions, pain = _parse_reply(content, max_chars)
        if len(suggestions) >= 2 or (mode == "rewrite" and suggestions):
            return {
                "suggestions": suggestions,
                "mode":        mode,
                "pain_point":  pain if pain_source else "",
                "pain_source": pain_source if pain else "",
            }
    raise Exception(last_error)


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


def _call_ai(prompt: list[dict]) -> str:
    """First provider that answers wins; a used-up daily quota skips that provider."""
    providers = _providers()
    if not providers:
        raise Exception("No AI key set — add GROQ_API_KEY (or OPENROUTER_API_KEY) to .env and restart the server")
    errors, transient = [], False
    for p in providers:
        spent = _exhausted.get(p["name"])
        if spent and time.time() - spent < EXHAUSTED_RECHECK:
            errors.append(f"{p['name']} daily limit reached")
            continue
        try:
            return _post_chat(p, prompt)
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


def _post_chat(p: dict, prompt: list[dict]) -> str:
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
        with urllib.request.urlopen(req, timeout=40) as resp:
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
