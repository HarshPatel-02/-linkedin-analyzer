import os
import requests

# ─── Config ───────────────────────────────────────────────────────────────────
# Provider: Groq (fast + generous free tier). Set GROQ_API_KEY in .env.
GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# Higher temperature = more varied wording, so Regenerate gives fresh options.
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.9"))

# Conversation context is read in the user's OWN logged-in browser tab and sent
# here as `messages`. No LinkedIn cookie and no Apify actor are involved, so this
# path cannot trigger LinkedIn "impossible travel" logouts.


# ─── 1. Build the AI prompt ───────────────────────────────────────────────────
def build_prompt(messages: list, participant: str = "", profile: dict = None, tone: str = "", nonce: str = "") -> str:
    profile = profile or {}
    name = (profile.get("name") or participant or "").strip()
    headline = (profile.get("headline") or "").strip()
    who = name or "the other person"

    lines = []
    for m in (messages or []):
        sender = (m.get("sender") or "Them").strip() if isinstance(m, dict) else "Them"
        text = (m.get("text") or "").strip() if isinstance(m, dict) else str(m).strip()
        if text:
            lines.append(f"{sender}: {text}")

    # who the recipient is (used most for a first message)
    recipient = ""
    if name:
        recipient += f"Recipient: {name}\n"
    if headline:
        recipient += f"Their LinkedIn headline: {headline}\n"

    if lines:
        conversation = "\n".join(lines)
        task = (
            f"You are writing the reply. The most recent message is from {who}; reply to it, "
            "using the earlier messages as context."
        )
    else:
        # No prior messages → craft a personalized FIRST outreach message.
        conversation = "(No prior messages — this is a first outreach message.)"
        task = (
            f"There is no prior conversation. Write a personalized FIRST message to {who} to start a "
            "conversation. If a headline is given, reference what they do so it feels tailored, not generic."
        )

    tone_line = f"Preferred tone: {tone}.\n" if tone else ""
    variety_line = (
        "These must be clearly DIFFERENT from any earlier suggestions — vary the opening, "
        f"wording and angle. (variation #{nonce})\n" if nonce else ""
    )

    return (
        "You are a LinkedIn networking assistant.\n\n"
        "Generate 3 possible messages.\n\n"
        "Rules:\n"
        "- Professional\n"
        "- Human sounding\n"
        "- Short\n"
        "- Context aware\n"
        "- Do not mention AI\n\n"
        f"{recipient}"
        f"{tone_line}"
        f"{variety_line}"
        f"{task}\n"
        "Return ONLY the 3 messages, each on its own line, numbered 1., 2., 3. "
        "with no extra commentary.\n\n"
        f"Conversation:\n{conversation}"
    )


# ─── 2. Call the LLM (Groq) ───────────────────────────────────────────────────
def _call_llm(prompt: str) -> str:
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise Exception("GROQ_API_KEY is not set in environment variables")
    resp = requests.post(
        GROQ_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": GROQ_MODEL,
            "max_tokens": int(os.getenv("GROQ_MAX_TOKENS", "400")),
            "temperature": LLM_TEMPERATURE,
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    text = resp.json()["choices"][0]["message"]["content"]
    if not (text and text.strip()):
        raise Exception("Groq returned empty content")
    print(f"[suggestions] provider: groq ({GROQ_MODEL})")
    return text


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
def generate_suggestions(messages: list, participant: str = "", profile: dict = None, tone: str = "", nonce: str = "") -> list:
    prompt = build_prompt(messages or [], participant, profile, tone, nonce)

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


# ─── 5. Grammar fix — clean up the user's own typed draft ─────────────────────
def fix_grammar(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    prompt = (
        "Correct the grammar, spelling and clarity of this LinkedIn message. "
        "Keep the same meaning, language, tone and roughly the same length. "
        "Do not add new information, greetings or explanations. "
        "Return ONLY the corrected message.\n\n"
        f"Message:\n{text}"
    )
    try:
        out = _call_llm(prompt).strip()
        # strip wrapping quotes the model sometimes adds
        if len(out) >= 2 and out[0] in "\"'" and out[-1] in "\"'":
            out = out[1:-1].strip()
        return out or text
    except Exception as e:
        print("[grammar] failed:", e)
        return text  # fall back to the user's original draft
