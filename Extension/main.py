from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import traceback
from dotenv import load_dotenv
from models import AnalyzeRequest, IcpScore, ProfileData, SuggestionsRequest
from services.actor_service import run_apify_actor, run_posts_actor, map_apify_to_profile
from services.icp_service import calculate_icp, run_company_actor
from services.suggestion_service import generate_suggestions

load_dotenv()

app = FastAPI(title="LinkedIn AI Analyzer API")

# ─── In-memory cache (resets on server restart) ───────────────────────────────
_profile_cache: dict = {}
_icp_cache: dict = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/analyze")
async def analyze(data: AnalyzeRequest):
    try:
        if data.profile_url:
            cache_key = data.profile_url.rstrip("/")
            if cache_key in _profile_cache:
                return _profile_cache[cache_key]

            apify_task = asyncio.to_thread(run_apify_actor, data.profile_url)
            posts_task = asyncio.to_thread(run_posts_actor, data.profile_url)
            apify_data, posts_data = await asyncio.gather(apify_task, posts_task)
            if not apify_data.get("name") and not apify_data.get("first_name"):
                raise Exception("Profile could not be scraped — LinkedIn may have blocked it")
            profile = map_apify_to_profile(apify_data, data.profile_url, posts_data)
        else:
            allowed = set(ProfileData.model_fields.keys())
            profile = ProfileData(**{k: v for k, v in data.model_dump().items() if k in allowed})

        result = {
            "success":            True,
            "avatar":             profile.avatar,
            "name":               profile.name,
            "country":            profile.country,
            "position":           profile.position,
            "about":              profile.about,
            "current_company":    profile.current_company,
            "education":          profile.education,
            "skills":             profile.skills,
            "projects":           profile.projects,
            "activity":           profile.activity,
            "activity_url":       profile.activity_url,
            "mutual_connections": profile.mutual_connections,
            "profile_url":        profile.profileUrl,
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
            "posts_90_days":      profile.posts_90_days,
            "engagement_label":   profile.engagement_label,
        }
        if data.profile_url:
            _profile_cache[data.profile_url.rstrip("/")] = result
        return result
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/icp-score")
async def icp_score(data: IcpScore):
    try:
        profile_dict = data.model_dump()
        url = profile_dict.get("profile_url") or profile_dict.get("profileUrl") or ""
        if url:
            cache_key = url.rstrip("/")
            if cache_key in _icp_cache:
                return _icp_cache[cache_key]

            company_data = run_company_actor(url)
            if company_data:
                if company_data.get("headline"):
                    profile_dict["position"] = company_data["headline"]
                if company_data.get("about"):
                    profile_dict["about"] = company_data["about"]
                if company_data.get("location"):
                    loc = company_data["location"]
                    if isinstance(loc, dict):
                        profile_dict["country"] = loc.get("country") or loc.get("full") or ""
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

        result = calculate_icp(profile_dict)
        if url:
            _icp_cache[url.rstrip("/")] = result
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.post("/generate-suggestions")
async def generate_suggestions_endpoint(data: SuggestionsRequest):
    try:
        suggestions = await asyncio.to_thread(generate_suggestions, data.messages, data.participant)
        return {"suggestions": suggestions}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))

@app.get("/health")
async def health():
    return {"status": "ok", "version": "4.0"}
