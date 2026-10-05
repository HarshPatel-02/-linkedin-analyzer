from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import traceback
from datetime import datetime, timezone
from dotenv import load_dotenv

# MUST run before the service imports below: they read .env values at import time
load_dotenv()

from models import (AnalyzeRequest, IcpScore, ProfileData, IcpConfig, SuggestRequest, PitchConfig,
                    OutreachRequest, LeadMessageRequest, CollectRequest)
from services.actor_service import run_apify_actor, run_posts_actor, map_apify_to_profile
from services.ai_service import (generate_chat_suggestions, generate_outreach, generate_lead_message,
                                 get_pitch_config, save_pitch_config)
from services.icp_service import calculate_icp, run_company_actor, get_icp_config, save_icp_config
from services.analysis_service import analyze_profile, activity_block
from services.scoring_service import (compute_score, newest_post, get_activity_points, save_activity_points,
                                      get_signal_keywords, save_signal_keywords,
                                      get_activity_rules, save_activity_rules)
from services.apify_token import TOKEN_HEADER, bind_apify_token

# Every request binds the Apify token it carries, so each endpoint - and every thread it
# starts - sees the token the extension sent with that request.
app = FastAPI(title="LinkedIn AI Analyzer API", dependencies=[Depends(bind_apify_token)])

# Only the extension talks to this server: its background worker and toolbar
# popup (chrome-extension://…). Other websites can no longer call it from a browser.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", TOKEN_HEADER],
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
            # The page count, zero included: falling back to Apify's figure on a zero gave
            # the mutual connections of the account Apify scrapes as.
            profile = map_apify_to_profile(apify_data, data.profile_url, posts_data,
                                           mutual_connections=data.mutual_connections)
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
            "score_uncapped":     profile.score_uncapped,
            "failed_required":    profile.failed_required,
            "mutual_min":         profile.mutual_min,
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

REQUIRED_PROFILE_FIELDS = ("name", "profile_url")


@app.post("/profiles/analyze")
async def profiles_analyze(data: AnalyzeRequest):
    """One analysis per profile: ICP + Activity + overall, with what matched and why.

    The single source of truth for scoring — the extension and the admin panel both
    render this response and neither recalculates. Scores are deterministic: they
    come from the administrator's ICP keywords and activity points, not from AI.
    """
    payload = data.model_dump()
    profile_url = (payload.get("profile_url") or payload.get("profileUrl") or "").strip()
    missing = [f for f in REQUIRED_PROFILE_FIELDS
               if not str(payload.get(f) or (profile_url if f == "profile_url" else "")).strip()]
    if missing:
        # Never score a profile we could not actually read.
        return {"success": False, "data_available": False, "missing_fields": missing,
                "message": "Required profile data could not be collected."}

    apify_data, posts_data, notes = {}, [], []
    if profile_url:
        try:
            apify_task = asyncio.to_thread(run_apify_actor, profile_url)
            posts_task = asyncio.to_thread(run_posts_actor, profile_url, 20, notes)
            apify_data, posts_data = await asyncio.gather(apify_task, posts_task)
        except Exception as exc:
            notes.append(f"profile scrape failed: {exc}")
            apify_data, posts_data = {}, []

    try:
        if apify_data:
            profile = map_apify_to_profile(apify_data, profile_url, posts_data,
                                           mutual_connections=payload.get("mutual_connections") or 0)
            edits = collect_form_edits(payload)
            if edits.get("activity") and newest_post(list(posts_data or []) + list(apify_data.get("posts") or [])):
                edits.pop("activity")
            if edits:
                profile = ProfileData(**{**profile.model_dump(), **edits})
        else:
            allowed = set(ProfileData.model_fields.keys())
            profile = ProfileData(**{k: v for k, v in payload.items() if k in allowed})
            profile.profileUrl = profile.profileUrl or profile_url

        result = analyze_profile(profile, apify_data, posts_data, icp_input=payload)
        return {"success": True, "data_available": True, "missing_fields": [],
                "collection_notes": notes,
                "profile": profile.model_dump(include=set(ProfileData.model_fields) - {"timestamp"}),
                **result}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, str(e))


@app.post("/collect")
async def collect(data: CollectRequest):
    """Everything knowable about one LinkedIn profile, with no ICP scoring.

    The admin backend owns the ICP rules and the database; this service owns the
    LinkedIn side. It returns the profile, the posts, the company (including the
    employee count, which a profile page never shows) and the activity score, plus
    an explicit list of what could not be collected - so a missing field is never
    mistaken for a zero.
    """
    url = (data.profile_url or "").strip()
    if not url:
        return {"success": False, "data_available": False, "missing_fields": ["profile_url"],
                "message": "A profile URL is required to collect anything."}

    notes: list = []
    apify_data: dict = {}
    posts_data: list = []
    company: dict = {}
    try:
        apify_task = asyncio.to_thread(run_apify_actor, url)
        posts_task = asyncio.to_thread(run_posts_actor, url, data.max_posts, notes)
        company_task = asyncio.to_thread(run_company_actor, url)
        apify_data, posts_data, company = await asyncio.gather(
            apify_task, posts_task, company_task, return_exceptions=False)
    except Exception as exc:
        # A failed fetch is reported, never disguised as an empty profile.
        notes.append(f"profile fetch failed: {type(exc).__name__}: {exc}")

    try:
        if apify_data:
            # `scraped` is the extension's read of the user's own view of the page.
            profile = map_apify_to_profile(apify_data, url, posts_data,
                                           mutual_connections=(data.scraped or {}).get("mutual_connections") or 0)
        else:
            allowed = set(ProfileData.model_fields.keys())
            profile = ProfileData(**{k: v for k, v in (data.scraped or {}).items() if k in allowed})
            profile.profileUrl = profile.profileUrl or url
            for key, value in compute_score(profile, {}, posts_data).items():
                setattr(profile, key, value)

        # map_apify_to_profile never sets a headline, and the roles rules match on it.
        # Prefer the fetched headline, then whatever the page showed.
        if not (profile.headline or "").strip():
            profile.headline = (company.get("headline") or (data.scraped or {}).get("headline") or "").strip()
        if not (profile.position or "").strip():
            profile.position = profile.headline
        # A profile page never shows these; the company lookup does.
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

def settings_routes(path: str, read, write, *, reads: str, writes: str) -> None:
    """A settings file the extension reads and writes back: GET returns it, POST saves it.

    Every one of these was the same nine lines around a different pair of functions.
    `/icp-config` is deliberately not one of them: it posts a typed model, so a bad
    payload there is a 422 from FastAPI rather than a 500 from here.
    """
    name = path.strip("/").replace("-", "_")

    async def _read():
        return read()

    async def _write(data: dict):
        try:
            return write(data)
        except Exception as e:
            raise HTTPException(500, str(e))

    _read.__name__, _read.__doc__ = f"read_{name}", reads
    _write.__name__, _write.__doc__ = f"write_{name}", writes
    app.get(path)(_read)
    app.post(path)(_write)


settings_routes(
    "/activity-points", get_activity_points, save_activity_points,
    reads="Max points per Activity factor (activity_points.json merged over the defaults).",
    writes='Save points edited in the Activity form; {"reset": true} restores the defaults.')

settings_routes(
    "/activity-rules", get_activity_rules, save_activity_rules,
    reads="Requirements for the Activity score, e.g. a minimum of mutual connections.",
    writes="Save requirements edited in the Activity form.")

settings_routes(
    "/activity-keywords", get_signal_keywords, save_signal_keywords,
    reads="Hiring / growth signal keywords for the Activity score.",
    writes='Save the signal keyword chips from the Activity form; {"reset": true} restores the defaults.')

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

@app.post("/lead-message")
async def lead_message(data: LeadMessageRequest):
    """Admin panel: profile (+ conversation) -> one ready-to-send LinkedIn message
    plus the labels the panel shows around it. Nothing is ever sent from here."""
    try:
        result = await asyncio.to_thread(generate_lead_message, data.model_dump())
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
