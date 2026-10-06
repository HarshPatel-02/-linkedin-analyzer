"""The extension's Activity score: fetch the profile and posts, merge the form, score."""
from __future__ import annotations

from fastapi import APIRouter

from models import AnalyzeRequest, ProfileData
from routers.common import failure, fetch_profile_and_posts, form_edits, profile_from_form
from services.actor_service import apply_score, map_apify_to_profile
from services.scoring_service import bind_activity_settings, newest_post

router = APIRouter()


@router.post("/analyze")
async def analyze(data: AnalyzeRequest):
    bind_activity_settings(data.activity_points, data.activity_keywords)
    try:
        scrape_warning = ""
        apify_data, posts_data, posts_errors = {}, [], []
        if data.profile_url:
            try:
                apify_data, posts_data = await fetch_profile_and_posts(data.profile_url, None, posts_errors)
                if not apify_data.get("name") and not apify_data.get("first_name"):
                    raise ValueError("Profile could not be scraped — LinkedIn may have blocked it")
            except Exception as scrape_error:
                # Apify unavailable: still score whatever the form contains.
                scrape_warning = f"Apify scrape failed: {scrape_error}"
                apify_data, posts_data = {}, []
            # Profile came back but the posts fetch failed: say so instead of a silent
            # "No recent activity" (recency then falls back to the form value).
            if apify_data and posts_errors and not posts_data and not scrape_warning:
                scrape_warning = ("Couldn't fetch their posts (" + "; ".join(posts_errors) +
                                  ") — Recent Activity was scored from the page instead.")

        if apify_data:
            profile = map_apify_to_profile(apify_data, data.profile_url, posts_data)
            edits = form_edits(data.model_dump())
            # Recency comes from dated posts first; keep the shown "Last posted …" on that same
            # source instead of the page's value (which can be an old item next to a 20/30).
            if edits.get("activity") and newest_post(list(posts_data or []) + list(apify_data.get("posts") or [])):
                edits.pop("activity")
            if edits:
                profile = apply_score(ProfileData(**{**profile.model_dump(), **edits}), apify_data, posts_data)
        else:
            profile = apply_score(profile_from_form(data.model_dump()), {}, [])

        body = profile.model_dump(exclude={"profileUrl"})
        return {"success": True, **body, "profile_url": profile.profileUrl, "scrape_warning": scrape_warning}
    except Exception as e:
        raise failure(e, "Activity analysis")
