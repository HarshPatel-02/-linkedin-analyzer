import os
import time
import requests

# ─── Config ───────────────────────────────────────────────────────────────────
# For testing we call Claude Sonnet through OpenRouter (OpenAI-compatible API) so
# an OpenRouter balance can be used instead of a direct Anthropic balance.
# Set OPENROUTER_API_KEY in .env. Optionally override OPENROUTER_MODEL — e.g. a
# free model like "meta-llama/llama-3.3-70b-instruct:free" for zero-cost testing.
OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemma-4-26b-a4b-it:free")

# Try several free models in order — each has its own separate free allowance, so
# if one is rate-limited / out of free quota ("afford 5"), the next may still work.
FALLBACK_MODELS = [
    OPENROUTER_MODEL,
    "openai/gpt-oss-20b:free",
    "google/gemma-4-26b-a4b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
]

# Conversation context is read in the user's OWN logged-in browser tab and sent
# here as `messages`. No LinkedIn cookie and no Apify actor are involved, so this
# path cannot trigger LinkedIn "impossible travel" logouts.


# ─── 1. Build the AI prompt ───────────────────────────────────────────────────
def build_prompt(messages: list, participant: str = "") -> str:
    who = participant or "the other person"

    if messages:
        lines = []
        for m in messages:
            sender = (m.get("sender") or "Them").strip() if isinstance(m, dict) else "Them"
            text = (m.get("text") or "").strip() if isinstance(m, dict) else str(m).strip()
            if text:
                lines.append(f"{sender}: {text}")
        conversation = "\n".join(lines) or "(No prior messages — write a friendly professional opener.)"
    else:
        conversation = "(No prior messages — write a friendly professional opener.)"

    return (
        "You are a LinkedIn networking assistant.\n\n"
        "Analyze this conversation.\n\n"
        "Generate 3 possible replies.\n\n"
        "Rules:\n"
        "- Professional\n"
        "- Human sounding\n"
        "- Short\n"
        "- Context aware\n"
        "- Do not mention AI\n\n"
        f"You are writing the reply. The most recent message is from {who}; reply to it.\n"
        "Return ONLY the 3 replies, each on its own line, numbered 1., 2., 3. "
        "with no extra commentary.\n\n"
        f"Conversation:\n{conversation}"
    )


# ─── 2. Call the LLM via OpenRouter ───────────────────────────────────────────
def _call_llm(prompt: str) -> str:
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise Exception("OPENROUTER_API_KEY is not set in environment variables")

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # optional attribution headers OpenRouter recommends
        "HTTP-Referer": "https://linkedin-analyzer.local",
        "X-Title": "LinkedIn AI Reply",
    }
    max_tokens = int(os.getenv("OPENROUTER_MAX_TOKENS", "200"))
    # de-dupe the model list while preserving order
    models, seen = [], set()
    for m in FALLBACK_MODELS:
        if m and m not in seen:
            seen.add(m); models.append(m)

    last = None
    for model in models:
        payload = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        # one quick retry per model for transient upstream hiccups
        for attempt in range(2):
            resp = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=30)
            if resp.status_code == 200:
                text = resp.json()["choices"][0]["message"]["content"]
                if text and text.strip():
                    print(f"[suggestions] model used: {model}")
                    return text
                break  # empty body — try next model
            last = f"{model} -> {resp.status_code}: {resp.text[:120]}"
            if resp.status_code in (429, 502, 503):
                time.sleep(1.2)
                continue
            break  # 402/400/etc — move to the next model
    raise Exception(f"All free models failed. Last: {last}")


# ─── 3. Parse LLM output into exactly 3 suggestions ───────────────────────────
def _parse_suggestions(text: str) -> list:
    suggestions = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        # strip a leading "1.", "2)", "- ", "•", "*" style prefix
        line = line.lstrip("1234567890.)-•*# \t").strip()
        if line:
            suggestions.append(line)

    suggestions = suggestions[:3]
    while len(suggestions) < 3:
        suggestions.append("Thanks for reaching out — I'd be glad to connect and learn more.")
    return suggestions


# ─── 4. Generate suggestions from browser-supplied conversation ───────────────
def generate_suggestions(messages: list, participant: str = "") -> list:
    prompt = build_prompt(messages or [], participant)

    try:
        text = _call_llm(prompt)
        return _parse_suggestions(text)
    except Exception as e:
        print("[suggestions] llm call failed:", e)
        # Never break the UI — return safe generic replies.
        return [
            "Thanks for reaching out — happy to connect!",
            "Appreciate the message. Could you share a bit more about what you had in mind?",
            "Great to hear from you — let's find a good time to chat.",
        ]
