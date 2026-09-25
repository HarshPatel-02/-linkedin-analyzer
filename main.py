from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import traceback
from dotenv import load_dotenv

# MUST run before the service imports below: they read .env values at import time
load_dotenv()

from models import AnalyzeRequest, IcpScore, ProfileData, IcpConfig, SuggestRequest, PitchConfig, OutreachRequest
from services.actor_service import run_apify_actor, run_posts_actor, map_apify_to_profile
from services.ai_service import generate_chat_suggestions, generate_outreach, get_pitch_config, save_pitch_config
from services.icp_service import calculate_icp, run_company_actor, get_icp_config, save_icp_config
from services.scoring_service import (compute_score, newest_post, get_activity_points, save_activity_points,
                                      get_signal_keywords, save_signal_keywords)

app = FastAPI(title="LinkedIn AI Analyzer API")

# Only the extension talks to this server: its background worker and toolbar
# popup (chrome-extension://…). Other websites can no longer call it from a browser.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

@app.get("/")
async def root():
    return {"status": "ok", "service": "LinkedIn AI Analyzer API", "docs": "/docs"}

def collect_form_edits(payload: dict) -> dict:
    """Details typed into the Activity form win over the scraped values."""
    edits = {}
    for key in ProfileData.model_fields:
        if key in ("profileUrl", "timestamp"):
            continue
        value = payload.get(key)
        if isinstance(value, str):
            value = value.strip()
            if value:
                edits[key] = value
        elif isinstance(value, (int, float)) and value:
            edits[key] = value
    return edits


@app.post("/analyze")
async def analyze(data: AnalyzeRequest):
    try:
        scrape_warning = ""
        apify_data, posts_data = {}, []
        posts_errors: list = []

        if data.profile_url:
            try:
                apify_task = asyncio.to_thread(run_apify_actor, data.profile_url)
                posts_task = asyncio.to_thread(run_posts_actor, data.profile_url, 20, posts_errors)
                apify_data, posts_data = await asyncio.gather(apify_task, posts_task)
                if not apify_data.get("name") and not apify_data.get("first_name"):
                    raise Exception("Profile could not be scraped \u2014 LinkedIn may have blocked it")
            except Exception as scrape_error:
                # Apify unavailable → still score whatever the form contains
                scrape_warning = f"Apify scrape failed: {scrape_error}"
                apify_data, posts_data = {}, []
            # Profile came back but the posts fetch failed: say so instead of a
            # silent "No recent activity" (recency then falls back to the form value)
            if apify_data and posts_errors and not posts_data and not scrape_warning:
                scrape_warning = ("Couldn't fetch their posts (" + "; ".join(posts_errors) +
                                  ") — Recent Activity was scored from the page instead.")

        if apify_data:
            if data.mutual_connections:
                apify_data["mutual_connections"] = data.mutual_connections
            profile = map_apify_to_profile(apify_data, data.profile_url, posts_data)
            # Re-score with the details filled in through the Activity form
            edits = collect_form_edits(data.model_dump())
            # The score takes recency from dated Apify posts first; keep the shown
            # "Last posted …" text on that same source instead of the page-scraped
            # form value (which can be an old item → "2 years ago" beside 20/30).
            if edits.get("activity") and newest_post(list(posts_data or []) + list(apify_data.get("posts") or [])):
                edits.pop("activity")
            if edits:
                profile = ProfileData(**{**profile.model_dump(), **edits})
                for key, value in compute_score(profile, apify_data, posts_data).items():
                    setattr(profile, key, value)
        else:
            allowed = set(ProfileData.model_fields.keys())
            profile = ProfileData(**{k: v for k, v in data.model_dump().items() if k in allowed})
            for key, value in compute_score(profile, {}, []).items():
                setattr(profile, key, value)

        return {
            "success":            True,
            "avatar":             profile.avatar,
            "name":               profile.name,
            "country":            profile.country,
            "position":           profile.position,
            "headline":           profile.headline,
            "about":              profile.about,
            "current_company":    profile.current_company,
            "education":          profile.education,
            "experience":         profile.experience,
            "skills":             profile.skills,
            "projects":           profile.projects,
            "activity":           profile.activity,
            "activity_url":       profile.activity_url,
            "activity_date":      profile.activity_date,
            "mutual_connections":  profile.mutual_connections,
            "profile_url":         profile.profileUrl,
            "timestamp":          profile.timestamp,
            "score_total":        profile.score_total,
            "score_label":        profile.score_label,
            "score_activity":     profile.score_activity,
            "score_posts":        profile.score_posts,
            "score_engagement":   profile.score_engagement,
            "score_completeness": profile.score_completeness,
            "score_signals":      profile.score_signals,
            "score_mutuals":      profile.score_mutuals,
            "avg_engagement":     profile.avg_engagement,
            "posts_30_days":      profile.posts_30_days,
            "posts_90_days":      profile.posts_90_days,
            "avg_likes":          profile.avg_likes,
            "avg_comments":       profile.avg_comments,
            "avg_reposts":        profile.avg_reposts,
            "engagement_label":   profile.engagement_label,
            "max_activity":       profile.max_activity,
            "max_posts":          profile.max_posts,
            "max_engagement":     profile.max_engagement,
            "max_completeness":   profile.max_completeness,
            "max_signals":        profile.max_signals,
            "max_mutuals":        profile.max_mutuals,
            "score_raw":          profile.score_raw,
            "score_max":          profile.score_max,
            "signal_hits":        profile.signal_hits,
            "completeness_missing": profile.completeness_missing,
            "posts_analyzed":     profile.posts_analyzed,
            "data_source":        profile.data_source,
            "signal_keywords":    get_signal_keywords(),
            "scrape_warning":     scrape_warning,
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.post("/icp-score")
async def icp_score(data: IcpScore):
    try:
        profile_dict = data.model_dump()
        url = profile_dict.get("profile_url") or profile_dict.get("profileUrl") or ""
        if url:
            company_data = await asyncio.to_thread(run_company_actor, url)
            if company_data:
                # The page's own position (top Experience title) stays the title source;
                # Apify's headline is matched as a second chance, never instead of it.
                if company_data.get("headline"):
                    profile_dict["headline"] = company_data["headline"]
                if company_data.get("about"):
                    profile_dict["about"] = company_data["about"]
                if company_data.get("location"):
                    loc = company_data["location"]
                    if isinstance(loc, dict):
                        profile_dict["country"] = loc.get("full") or loc.get("country") or ""
                    else:
                        profile_dict["country"] = loc
                if company_data.get("current_company_name"):
                    profile_dict["current_company_name"] = company_data["current_company_name"]
                emp = company_data.get("current_company_employee_count")
                if emp is not None:
                    profile_dict["current_company_employee_count"] = str(emp)
                if company_data.get("current_company_industry"):
                    profile_dict["industry"] = company_data["current_company_industry"]
                hq = company_data.get("current_company_headquarters", {})
                if hq and isinstance(hq, dict):
                    parts = [v for v in (hq.get("city"), hq.get("state"), hq.get("country")) if v]
                    if parts:
                        profile_dict["current_company_headquarters"] = ", ".join(parts)
        return calculate_icp(profile_dict)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.get("/icp-config")
async def read_icp_config():
    """Current ICP keywords (icp_config.json merged over the defaults)."""
    return get_icp_config()

@app.post("/icp-config")
async def write_icp_config(data: IcpConfig):
    """Save ICP keywords typed into the extension form → icp_config.json."""
    try:
        return save_icp_config(data.model_dump())
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/activity-points")
async def read_activity_points():
    """Max points per Activity factor (activity_points.json merged over the defaults)."""
    return get_activity_points()

@app.post("/activity-points")
async def write_activity_points(data: dict):
    """Save points edited in the Activity form; {"reset": true} restores the defaults."""
    try:
        return save_activity_points(data)
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/activity-keywords")
async def read_activity_keywords():
    """Hiring / growth signal keywords for the Activity score."""
    return get_signal_keywords()

@app.post("/activity-keywords")
async def write_activity_keywords(data: dict):
    """Save the signal keyword chips from the Activity form; {"reset": true} restores the defaults."""
    try:
        return save_signal_keywords(data)
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/suggest-messages")
async def suggest_messages(data: SuggestRequest):
    """✨ popup: AI next-message suggestions from the recent chat history."""
    try:
        profile = {
            "name":            data.name,
            "headline":        data.headline,
            "position":        data.position,
            "current_company": data.current_company,
        }
        lead = {
            "icp_score":      data.icp_score,
            "activity_score": data.activity_score,
            "activity_label": data.activity_label,
        }
        # Profile + ICP / Activity analysis for a personalised connection note
        analysis = data.model_dump(include={
            "name", "first_name", "headline", "position", "current_company", "country", "about", "activity",
            "icp_score", "icp_breakdown", "activity_score", "activity_label", "engagement_label", "signal_hits",
            "sender_role", "pain_point", "prior_contact",
        })
        result = await asyncio.to_thread(
            lambda: generate_chat_suggestions(
                [m.model_dump() for m in data.messages],
                data.tone, data.first_name, profile, data.profile_url.strip(),
                draft=data.draft, action=data.action, lead=lead,
                context=data.context, max_chars=data.max_chars,
                awaiting_reply_days=data.awaiting_reply_days, analysis=analysis, sender_role=data.sender_role,
            )
        )
        return {"success": True, **result}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.post("/outreach-suggestion")
async def outreach_suggestion(data: OutreachRequest):
    """Connection note + first message from the ICP / Activity analysis (AI, or a template fallback)."""
    try:
        result = await asyncio.to_thread(generate_outreach, data.model_dump())
        return {"success": True, **result}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.get("/pitch-config")
async def read_pitch_config():
    """Who "I" am in AI messages (pitch_config.json merged over the defaults)."""
    return get_pitch_config()

@app.post("/pitch-config")
async def write_pitch_config(data: PitchConfig):
    """Save the pitch typed into the extension toolbar popup → pitch_config.json."""
    try:
        return save_pitch_config(data.model_dump(exclude_none=True))
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/health")
async def health():
    return {"status": "ok", "version": "4.0"}
