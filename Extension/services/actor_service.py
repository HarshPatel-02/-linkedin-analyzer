import os
from datetime import datetime, timezone
from apify_client import ApifyClient
from models import ProfileData
from services.scoring_service import time_ago, compute_score

APIFY_API_TOKEN        = os.getenv("APIFY_API_TOKEN")
APIFY_ACTOR_ID         = os.getenv("APIFY_ACTOR_ID")
APIFY_POSTS_ACTOR_ID   = os.getenv("APIFY_POSTS_ACTOR_ID")
APIFY_COMPANY_ACTOR_ID = os.getenv("APIFY_COMPANY_ACTOR_ID")


def _get_client():
    token = os.getenv("APIFY_API_TOKEN")
    if not token:
        raise Exception("APIFY_API_TOKEN is not set in environment variables")
    return ApifyClient(token)

def _normalize_datadoping(item: dict, username: str) -> dict:
    loc = item.get("location", {})
    if isinstance(loc, dict):
        item["location"] = loc.get("full") or loc.get("country") or ""
        item["city"] = loc.get("city") or ""
    item["name"] = item.get("fullname") or item.get("fullName") or item.get("name") or ""
    item["position"] = item.get("headline", "")
    item["followers"] = item.get("follower_count", 0)
    item["connections"] = item.get("connection_count", 0)
    item["avatar"] = item.get("profile_picture_url", "")
    item["mutual_connections"] = item.get("mutual_connections", 0)
    return item

def run_apify_actor(profile_url: str) -> dict:
    username = profile_url.rstrip("/").split("/")[-1]
    client = _get_client()

    for actor_id in (APIFY_ACTOR_ID, APIFY_COMPANY_ACTOR_ID):
        if not actor_id:
            continue
        try:
            run = client.actor(actor_id).call(run_input={
                "profiles": [username],
                "isEmailRequired": False,
            })
            for item in client.dataset(run["defaultDatasetId"]).iterate_items():
                if item:
                    return _normalize_datadoping(item, username)
        except Exception:
            pass

    raise Exception("No data returned from Apify profile actor")

def run_posts_actor(profile_url: str) -> list:
    try:
        from datetime import timedelta

        limit_date = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")

        client = _get_client()
        run = client.actor(APIFY_POSTS_ACTOR_ID).call(run_input={
            "targetUrls":      [profile_url],
            "maxPosts":        20,
            "postedLimitDate": limit_date,
        })
        posts = []
        for item in client.dataset(run["defaultDatasetId"]).iterate_items():
            posts.append(item)

        return posts
    except Exception:
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

    if act_list and isinstance(act_list[0], dict):
        first        = act_list[0]
        interaction  = first.get("interaction") or ""
        post_title   = first.get("title") or ""
        activity_url = first.get("url") or first.get("post_url") or first.get("link") or ""
        activity     = interaction + (f' \u2014 "{post_title}\u2026"' if post_title else "") or "Has recent activity"
    elif posts_raw and isinstance(posts_raw[0], dict):
        latest       = posts_raw[0]
        created_at   = latest.get("created_at") or ""
        ago          = time_ago(created_at) if created_at else ""
        post_title   = latest.get("title") or ""
        activity_url = latest.get("url") or latest.get("post_url") or latest.get("link") or ""
        activity     = (f"Last posted {ago}" + (f' \u2014 "{post_title}\u2026"' if post_title else "")) if ago else (post_title or "Has recent activity")
    elif posts_data:
        latest       = posts_data[0]
        pub          = latest.get("publishedAt") or latest.get("postedAt") or ""
        ago          = time_ago(pub) if pub else ""
        post_text    = (latest.get("text") or latest.get("content") or "")[:80]
        activity_url = latest.get("url") or latest.get("postUrl") or ""
        activity     = (f"Last posted {ago}" + (f' \u2014 "{post_text}\u2026"' if post_text else "")) if ago else (post_text or "Has recent activity")
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
