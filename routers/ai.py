"""AI wording: the ✨ suggestions in the extension and the admin's lead message.
Nothing is ever sent from here."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from models import LeadMessageRequest, SuggestRequest
from routers.common import failure
from services.ai_service import generate_chat_suggestions, generate_lead_message

router = APIRouter()

# What the invite-note writer may know about the person.
ANALYSIS_FIELDS = {
    "name", "first_name", "headline", "position", "current_company", "country", "about", "activity",
    "icp_score", "icp_breakdown", "activity_score", "activity_label", "engagement_label", "signal_hits",
    "sender_role", "pain_point", "prior_contact",
}


@router.post("/suggest-messages")
async def suggest_messages(data: SuggestRequest):
    """✨ popup: next-message ideas from the recent chat, or connection notes."""
    try:
        profile = {"name": data.name, "headline": data.headline, "position": data.position,
                   "current_company": data.current_company}
        lead = {"icp_score": data.icp_score, "activity_score": data.activity_score,
                "activity_label": data.activity_label}
        result = await asyncio.to_thread(
            lambda: generate_chat_suggestions(
                [m.model_dump() for m in data.messages],
                data.tone, data.first_name, profile, data.profile_url.strip(),
                draft=data.draft, action=data.action, lead=lead,
                context=data.context, max_chars=data.max_chars,
                awaiting_reply_days=data.awaiting_reply_days,
                analysis=data.model_dump(include=ANALYSIS_FIELDS), sender_role=data.sender_role,
            )
        )
        return {"success": True, **result}
    except Exception as e:
        raise failure(e, "Message suggestions")


@router.post("/lead-message")
async def lead_message(data: LeadMessageRequest):
    """Admin panel: profile (+ conversation) -> one ready-to-send message and its labels."""
    try:
        return {"success": True, **await asyncio.to_thread(generate_lead_message, data.model_dump())}
    except Exception as e:
        raise failure(e, "Lead message")
