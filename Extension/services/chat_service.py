import os
import re
from apify_client import ApifyClient
import anthropic

CHAT_ACTOR_ID = "g139cYMCVrGA7cnCY"


def _get_client():
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise Exception("APIFY_API_TOKEN is not set")
    return ApifyClient(token)


def run_chat_actor(conversation_url: str) -> list:
    """Fetch conversation messages via Apify actor g139cYMCVrGA7cnCY."""
    client = _get_client()
    cookie = os.getenv("LINKEDIN_COOKIE", "")

    run_input = {"conversationUrls": [conversation_url]}
    if cookie:
        run_input["cookie"] = cookie

    run = client.actor(CHAT_ACTOR_ID).call(run_input=run_input)

    messages = []
    for item in client.dataset(run.default_dataset_id).iterate_items():
        if item:
            messages.append(item)

    return messages


def clean_messages(raw: list) -> list:
    """Normalize Apify output to [{sender, text, timestamp}]."""
    cleaned = []
    for msg in raw:
        if not isinstance(msg, dict):
            continue
        sender = (
            msg.get("senderName") or msg.get("sender_name") or
            msg.get("sender") or msg.get("from") or
            msg.get("authorName") or "Unknown"
        )
        text = (
            msg.get("text") or msg.get("body") or
            msg.get("content") or msg.get("message") or ""
        )
        ts = (
            msg.get("timestamp") or msg.get("date") or
            msg.get("sentAt") or msg.get("createdAt") or ""
        )
        if text and str(text).strip():
            cleaned.append({
                "sender": str(sender).strip(),
                "text": str(text).strip(),
                "timestamp": str(ts),
            })
    return cleaned


def _detect_tone(messages: list) -> str:
    """Infer conversation tone from message content."""
    text = " ".join(m["text"] for m in messages).lower()
    casual  = ["hey ", "hi!", "cool", "awesome", "thanks!", "haha", "lol", "btw", "yeah"]
    formal  = ["dear ", "regards", "sincerely", "herewith", "please find", "kindly", "pursuant"]
    c_score = sum(1 for w in casual if w in text)
    f_score = sum(1 for w in formal if w in text)
    if f_score > c_score:
        return "professional"
    if c_score > f_score:
        return "casual"
    return "professional"


def _detect_relationship_stage(messages: list) -> str:
    """Estimate relationship stage from message count and content."""
    count = len(messages)
    first_text = messages[0]["text"].lower() if messages else ""
    greetings = ["just wanted to connect", "i came across your profile", "reach out", "your background"]
    if any(g in first_text for g in greetings) or count <= 2:
        return "initial outreach"
    if count <= 6:
        return "early conversation"
    return "ongoing relationship"


def generate_suggestions(messages: list, profile_context: str = "") -> list:
    """Call Claude to generate 3 context-aware reply suggestions."""
    

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise Exception("ANTHROPIC_API_KEY is not set in environment variables")

    client = anthropic.Anthropic(api_key=api_key)

    recent = messages[-10:]
    tone   = _detect_tone(recent)
    stage  = _detect_relationship_stage(messages)

    convo_text = "\n".join(f"{m['sender']}: {m['text']}" for m in recent)
    last_msg   = recent[-1]["text"] if recent else ""

    prompt = f"""You are a LinkedIn messaging assistant. Analyze this conversation and write exactly 3 short, natural reply suggestions.

Conversation (most recent at bottom):
{convo_text}

Context:
- Tone: {tone}
- Relationship stage: {stage}
- Last message: "{last_msg}"
{f'- About the contact: {profile_context}' if profile_context else ''}

Rules:
- Each reply must be 1-3 sentences, human and natural — not templated
- Match the {tone} tone of the conversation
- Reference specific details from the conversation, not generic phrases
- Each suggestion must take a different angle or intent (e.g., one asks a question, one shares insight, one advances next step)
- Avoid: "Hope this finds you well", "I wanted to reach out", "Great connecting"
- Do NOT include the other person's name
- Reply ONLY with exactly 3 numbered suggestions, nothing else

1. [reply]
2. [reply]
3. [reply]"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()

    suggestions = []
    for line in raw.split("\n"):
        m = re.match(r'^[123][\.\)]\s+(.+)', line.strip())
        if m:
            suggestions.append(m.group(1).strip())

    # Fallback if regex parsing fails
    if len(suggestions) < 3:
        suggestions = [
            re.sub(r'^[123][\.\)]\s*', '', l).strip()
            for l in raw.split("\n")
            if l.strip() and not re.match(r'^[123][\.\)]\s*$', l.strip())
        ][:3]

    return suggestions[:3]


def analyze_chat(conversation_url: str, profile_url: str = "", passed_messages: list = None) -> dict:
    """Main entry: fetch conversation via Apify, generate AI reply suggestions."""
    raw_messages = []
    apify_error  = None

    try:
        raw_messages = run_chat_actor(conversation_url)
    except Exception as e:
        apify_error = str(e)

    messages = clean_messages(raw_messages)

    # Fallback to caller-supplied messages if Apify returned nothing
    if not messages and passed_messages:
        if passed_messages and isinstance(passed_messages[0], dict) and "sender" in passed_messages[0]:
            messages = clean_messages(passed_messages)
        else:
            messages = [{"sender": "User", "text": str(m), "timestamp": ""} for m in passed_messages]

    if not messages:
        detail = f"Apify error: {apify_error}" if apify_error else "No messages returned"
        raise Exception(f"No messages found in conversation. {detail}")

    suggestions = generate_suggestions(messages, profile_context="")

    return {
        "suggestions":    suggestions,
        "message_count":  len(messages),
        "last_sender":    messages[-1]["sender"] if messages else "",
        "tone":           _detect_tone(messages),
        "stage":          _detect_relationship_stage(messages),
    }
