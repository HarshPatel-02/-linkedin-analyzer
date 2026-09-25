import os
from datetime import datetime, timezone
from apify_client import ApifyClient
from models import ProfileData
from services.scoring_service import time_ago, compute_score, newest_post

APIFY_API_TOKEN        = os.getenv("APIFY_API_TOKEN")
APIFY_ACTOR_ID         = os.getenv("APIFY_ACTOR_ID")
APIFY_POSTS_ACTOR_ID   = os.getenv("APIFY_POSTS_ACTOR_ID")
APIFY_COMPANY_ACTOR_ID = os.getenv("APIFY_COMPANY_ACTOR_ID")


def _env(name: str, fallback: str = "") -> str:
    """Read at call time. Importing this module can happen before .env is
    loaded, which would leave the module-level constants as None."""
    return os.getenv(name) or fallback or ""


def run_apify_actor(profile_url: str) -> dict:
    """Run the profile actor, fall back to the company actor.
    Any failure is collected so the caller can report WHY no data came back."""
    token      = _env("APIFY_API_TOKEN", APIFY_API_TOKEN)
    actor_id   = _env("APIFY_ACTOR_ID", APIFY_ACTOR_ID)
    company_id = _env("APIFY_COMPANY_ACTOR_ID", APIFY_COMPANY_ACTOR_ID)
    if not token:
        raise Exception("APIFY_API_TOKEN is empty — add it to .env and restart the server")
    if not actor_id:
        raise Exception("APIFY_ACTOR_ID is empty — add it to .env and restart the server")

    errors = []
    client = ApifyClient(token)
    try:
        run = client.actor(actor_id).call(run_input={
            "urls": [profile_url],
            "resolveEmails": False,
        })
        items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
        for item in items:
            if item.get("name") or item.get("first_name"):
                return item
        errors.append(f"profile actor {actor_id}: ran OK but {len(items)} item(s) without a name")
    except Exception as e:
        errors.append(f"profile actor {actor_id}: {type(e).__name__}: {e}")

    try:
        username = profile_url.rstrip("/").split("/")[-1]
        client2 = ApifyClient(token)
        run2 = client2.actor(company_id).call(run_input={
            "profiles": [username],
            "isEmailRequired": False,
        })
        items2 = list(client2.dataset(run2["defaultDatasetId"]).iterate_items())
        for item in items2:
            if item.get("fullname") or item.get("first_name"):
                loc = item.get("location", {})
                if isinstance(loc, dict):
                    item["location"] = loc.get("full") or loc.get("country") or ""
                    item["city"] = loc.get("city") or ""
                item["name"] = item.get("fullname") or ""
                item["position"] = item.get("headline", "")
                item["followers"] = item.get("follower_count", 0)
                item["connections"] = item.get("connection_count", 0)
                item["avatar"] = item.get("profile_picture_url", "")
                item["mutual_connections"] = item.get("mutual_connections", 0)
                return item
        errors.append(f"company actor {company_id}: ran OK but {len(items2)} item(s) without a name")
    except Exception as e:
        errors.append(f"company actor {company_id}: {type(e).__name__}: {e}")

    raise Exception("No data returned from Apify -> " + " | ".join(errors))

def run_posts_actor(profile_url: str, max_posts: int = 20) -> list:
    token    = _env("APIFY_API_TOKEN", APIFY_API_TOKEN)
    actor_id = _env("APIFY_POSTS_ACTOR_ID", APIFY_POSTS_ACTOR_ID)
    if not token or not actor_id:
        print(f"[LI-AI] posts actor skipped: APIFY_API_TOKEN/APIFY_POSTS_ACTOR_ID not set in .env")
        return []
    try:
        from datetime import timedelta

        limit_date = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")

        client = ApifyClient(token)
        run = client.actor(actor_id).call(run_input={
            "targetUrls":      [profile_url],
            "maxPosts":        max_posts,
            "postedLimitDate": limit_date,
        })
        posts = []
        for item in client.dataset(run["defaultDatasetId"]).iterate_items():
            posts.append(item)
        return posts
    except Exception as e:
        print(f"[LI-AI] posts actor {actor_id} failed: {type(e).__name__}: {e}")
        return []

def map_apify_to_profile(data: dict, profile_url: str, posts_data: list) -> ProfileData:

    avatar   = data.get("avatar") or ""
    name     = data.get("name") or (
        f"{data.get('first_name','')} {data.get('last_name','')}".strip()
    ) or "Unknown"
    country  = data.get("city") or data.get("location") or "Not specified"
    position = data.get("position") or ""
    about    = data.get("about") or "Not specified"

    exp_data = data.get("experienceData") or {}
    current_company = (
        exp_data.get("companyName") or
        data.get("companyName") or
        data.get("current_company_name") or
        ""
    )
    if not current_company:
        cc = data.get("current_company")
        if isinstance(cc, dict):   current_company = cc.get("name") or ""
        elif isinstance(cc, str):  current_company = cc
    if not current_company:
        current_company = data.get("currentCompany") or ""
    if not current_company:
        exp = (data.get("experience") or exp_data.get("experiences") or
               data.get("experiences") or data.get("positions") or [])
        if exp and isinstance(exp[0], dict):
            current_company = exp[0].get("company") or exp[0].get("companyName") or ""
    current_company = current_company or "Not specified"

    exp = data.get("experience") or data.get("experienceData") or []

    if isinstance(exp, list):
        experience = " | ".join([
            f"{e.get('title','')} @ {e.get('company','')}"
            for e in exp
                if isinstance(e, dict)
            ])
    else:
        experience = str(exp)

    edu_list = data.get("education") or []
    if edu_list:
        parts = []
        for e in edu_list:
            if not isinstance(e, dict): continue
            title = e.get("title") or ""
            sy, ey = e.get("start_year") or "", e.get("end_year") or ""
            years  = f" ({sy}\u2013{ey})" if (sy or ey) else ""
            if title: parts.append(f"{title}{years}")
        education = " | ".join(parts) or "Not specified"
    else:
        education = data.get("educations_details") or "Not specified"

    skill_list = data.get("skills") or []
    if skill_list:
        skills = " \u2022 ".join(skill_list)
    else:
        exp = data.get("experience") or []
        roles = []
        for e in exp:
            if not isinstance(e, dict): continue
            t, c = e.get("title") or "", e.get("company") or ""
            roles.append(f"{t} @ {c}" if (t and c) else t)
        skills = " \u2022 ".join(filter(None, roles)) or "Not specified"

    proj_list = data.get("projects") or []
    if proj_list:
        parts = []
        for p in proj_list:
            if not isinstance(p, dict): continue
            title = p.get("title") or ""
            desc  = p.get("description") or ""
            if title:
                parts.append(f"{title}" + (f" \u2014 {desc}\u2026" if desc else ""))
        projects = " | ".join(parts) or "No projects"
    else:
        projects = "No projects"

    posts_raw    = data.get("posts") or []
    act_list     = data.get("activity") or []
    activity_url = ""

    # "Last posted \u2026" must describe the NEWEST dated post across both actors \u2014 the
    # same posts the Recent Activity score is computed from \u2014 never just list[0],
    # which can be an old or featured post ("2 years ago" next to a 20/30 score).
    newest = newest_post(list(posts_data or []) + [p for p in posts_raw if isinstance(p, dict)])
    if newest:
        _, iso, latest = newest
        snippet      = " ".join(str(latest.get("text") or latest.get("content") or latest.get("title") or "").split())[:80]
        activity_url = latest.get("url") or latest.get("postUrl") or latest.get("post_url") or latest.get("link") or ""
        activity     = f"Last posted {time_ago(iso)}" + (f' \u2014 "{snippet}\u2026"' if snippet else "")
    elif act_list and isinstance(act_list[0], dict):
        first        = act_list[0]
        interaction  = first.get("interaction") or ""
        post_title   = first.get("title") or ""
        activity_url = first.get("url") or first.get("post_url") or first.get("link") or ""
        activity     = interaction + (f' \u2014 "{post_title}\u2026"' if post_title else "") or "Has recent activity"
    elif posts_raw or posts_data:
        activity = "Has recent activity"
    else:
        activity = "No recent activity"

    followers          = int(data.get("followers")          or 0)
    connections        = int(data.get("connections")        or 0)
    mutual_connections = int(data.get("mutual_connections") or 0)

    profile = ProfileData(
        avatar=avatar, name=name, country=country, position=position,
        about=about, current_company=current_company, education=education,
        skills=skills, projects=projects, activity=activity,
        activity_url=activity_url, followers=followers, connections=connections,
        mutual_connections=mutual_connections,
        profileUrl=profile_url, timestamp="", experience=experience
    )

    score = compute_score(profile, data, posts_data)
    for k, v in score.items():
        setattr(profile, k, v)
    return profile
