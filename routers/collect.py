"""/collect: everything knowable about one profile, for the admin. No ICP scoring here -
the admin owns the ICP rules and the database; this service owns the LinkedIn side."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter

from models import CollectRequest, ProfileData
from routers.common import failure, fetch_profile_and_posts, profile_from_form
from services.actor_service import (apply_score, map_apify_to_profile, run_company_actor, run_company_details,
                                    same_company)
from services.analysis_service import activity_block
from services.scoring_service import bind_activity_settings, compute_score, get_activity_points

router = APIRouter()


async def _company(apify_data: dict, url: str, notes: list) -> dict:
    """Industry and head count come from the company page the profile names for the current
    job, so that lookup waits for the profile. Without a page, the profile-based actor."""
    company_url = (apify_data or {}).get("current_company_url") or ""
    if not company_url:
        company = await asyncio.to_thread(run_company_actor, url, notes)
        if not company:
            notes.append("company lookup: the profile names no company page, and the fallback company "
                         "actor returned nothing")
        return company
    company = await asyncio.to_thread(run_company_details, company_url, notes)
    # A job can link to an unrelated page; its industry and size are not this company's.
    job_company = (apify_data or {}).get("current_company_name") or ""
    page_name = company.get("current_company_name") or ""
    if company and job_company and not same_company(job_company, page_name):
        notes.append(f'their job at "{job_company}" links to the LinkedIn page of "{page_name}", '
                     "a different company, so its industry and size were not used")
        return {}
    return company


@router.post("/collect")
async def collect(data: CollectRequest):
    """The profile, the posts, the company (including the employee count a profile page
    never shows) and the activity score, plus an explicit list of what could not be
    collected - so a missing field is never mistaken for a zero."""
    bind_activity_settings(data.activity_points, data.activity_keywords)
    url = (data.profile_url or "").strip()
    if not url:
        return {"success": False, "data_available": False, "missing_fields": ["profile_url"],
                "message": "A profile URL is required to collect anything."}

    notes: list = []
    apify_data, posts_data = {}, []
    try:
        apify_data, posts_data = await fetch_profile_and_posts(url, data.max_posts, notes)
    except Exception as exc:
        # A failed fetch is reported, never disguised as an empty profile.
        notes.append(f"profile fetch failed: {type(exc).__name__}: {exc}")
    company = await _company(apify_data, url, notes)

    try:
        profile = (map_apify_to_profile(apify_data, url, posts_data) if apify_data
                   else apply_score(profile_from_form(data.scraped, url), {}, posts_data))
        # The roles rules match on the headline: the fetched one, else what the page showed.
        if not (profile.headline or "").strip():
            profile.headline = (company.get("headline") or (data.scraped or {}).get("headline") or "").strip()
        if not (profile.position or "").strip():
            profile.position = profile.headline
        # A profile page never shows this; the company lookup does.
        if company.get("current_company_industry"):
            profile.industry = company["current_company_industry"]

        score = compute_score(profile, apify_data, posts_data)
        act = activity_block(profile, apify_data, posts_data, score)
        missing = [name for name, value in (
            ("company_employee_count", company.get("current_company_employee_count")),
            ("company_industry", company.get("current_company_industry")),
        ) if not value]
        return {
            "success": True,
            "data_available": bool(apify_data or data.scraped),
            "collected_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "profile": profile.model_dump(include=set(ProfileData.model_fields) - {"timestamp"}),
            "company": company,
            "activity": act,
            "activity_breakdown": {k: score[k] for k in score if k.startswith(("score_", "max_", "avg_", "posts_"))},
            "activity_points": get_activity_points(),
            "posts_analyzed": act.get("posts_analyzed", 0),
            "collection_notes": notes,
            "missing_fields": missing,
        }
    except Exception as e:
        raise failure(e, "Profile collection")
