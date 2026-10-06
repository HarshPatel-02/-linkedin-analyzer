import logging
import re
from apify_client import ApifyClient
from models import ProfileData
from services.config import settings
from services.scoring_service import time_ago, compute_score, newest_post, post_url, split_own_posts
from services.apify_token import MISSING, current_apify_token

log = logging.getLogger(__name__)

# The token is not here: it arrives with each request from the extension (see
# services/apify_token.py). The actor IDs are deployment settings (services/config.py).


class ApifyError(Exception):
    """An Apify run failed, timed out or could not start. The message is safe to show."""


def _call_actor(token: str, actor_id: str, run_input: dict) -> list:
    """One actor run, its dataset items. Apify stops the run - and its billing - after
    settings.apify_run_timeout_s, so a stuck scrape can't outlive the request that wanted it."""
    client = ApifyClient(token)
    run = client.actor(actor_id).call(run_input=run_input, timeout_secs=settings.apify_run_timeout_s)
    if not run:
        raise ApifyError(f"no answer within {settings.apify_run_timeout_s}s")
    if run.get("status") not in (None, "SUCCEEDED"):
        raise ApifyError(f"run {str(run.get('status')).lower()}")
    return list(client.dataset(run["defaultDatasetId"]).iterate_items())


def apply_score(profile: ProfileData, data: dict, posts: list) -> ProfileData:
    """Score the profile and write every score field onto it."""
    for key, value in compute_score(profile, data, posts).items():
        setattr(profile, key, value)
    return profile


def parse_count(value) -> int:
    """'1,234' / '500+' / 12.0 / None -> a whole number, never a crash."""
    try:
        return int(float(str(value or 0).replace(",", "").rstrip("+").strip() or 0))
    except (TypeError, ValueError):
        return 0


# harvestapi/linkedin-profile-scraper: no cookies, no login, $4 per 1,000 profiles. It is
# from the same publisher as the posts actor, and unlike the previous profile actor it
# returns the headline and the full location ("Los Angeles, California, United States").
HARVESTAPI_PROFILE_ACTORS = {"LpVuK3Zozwuipa5bp", "harvestapi/linkedin-profile-scraper",
                             "harvestapi~linkedin-profile-scraper"}
# The only mode that never looks up an email. The other one costs $10 per 1,000.
HARVESTAPI_MODE = "Profile details no email ($4 per 1k)"


def _profile_input(actor_id: str, profile_url: str) -> dict:
    if actor_id in HARVESTAPI_PROFILE_ACTORS:
        return {"urls": [profile_url], "profileScraperMode": HARVESTAPI_MODE}
    return {"urls": [profile_url], "resolveEmails": False}


def _year(date) -> str:
    return str(date.get("year") or "") if isinstance(date, dict) else ""


def from_harvestapi(item: dict) -> dict:
    """harvestapi's camelCase output, renamed to the keys map_apify_to_profile reads.

    The original keys stay alongside, so nothing that reads them is affected."""
    if not isinstance(item, dict) or item.get("name") or not (item.get("firstName") or item.get("lastName")):
        return item
    out = dict(item)
    out["name"] = f"{item.get('firstName') or ''} {item.get('lastName') or ''}".strip()
    out["avatar"] = item.get("photo") or ""
    loc = item.get("location")
    if isinstance(loc, dict):
        parsed = loc.get("parsed") if isinstance(loc.get("parsed"), dict) else {}
        out["location"] = loc.get("linkedinText") or parsed.get("text") or ""
        out["city"] = parsed.get("city") or ""
        out["country_code"] = loc.get("countryCode") or parsed.get("countryCode") or ""

    roles = [e for e in (item.get("experience") or []) if isinstance(e, dict)]
    # The role still running ("Present") is the current one; otherwise the newest.
    current = next((e for e in roles if str((e.get("endDate") or {}).get("text") or "").lower() == "present"),
                   roles[0] if roles else {})
    out["experience"] = [{"title": e.get("position") or "", "company": e.get("companyName") or ""} for e in roles]
    out["position"] = current.get("position") or ""
    first_current = next((c for c in (item.get("currentPosition") or []) if isinstance(c, dict)), {})
    out["current_company_name"] = first_current.get("companyName") or current.get("companyName") or ""
    # The company page of that job, for the company lookup (industry, head count).
    same = next((e for e in roles if e.get("companyName") == out["current_company_name"] and e.get("companyLinkedinUrl")),
                current)
    out["current_company_url"] = same.get("companyLinkedinUrl") or ""

    out["education"] = [{
        "title": ", ".join(x for x in (e.get("schoolName"), e.get("degree"), e.get("fieldOfStudy")) if x),
        "start_year": _year(e.get("startDate")), "end_year": _year(e.get("endDate")),
    } for e in (item.get("education") or []) if isinstance(e, dict)]
    out["followers"] = item.get("followerCount") or 0
    out["connections"] = item.get("connectionsCount") or 0
    return out


# harvestapi/linkedin-company (settings.apify_company_details_actor): a company's industry
# and head count, looked up by its LinkedIn page. The profile actor names that page for the
# current job, so the two run one after the other. A profile never shows either value, and
# the previous company actor returned neither while hiding every failure.


# Legal and filler words that do not tell two companies apart.
_COMPANY_NOISE = re.compile(r"\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pvt|private|the)\b")


def _company_words(name) -> set:
    words = re.sub(r"[^a-z0-9]+", " ", str(name or "").lower())
    return set(_COMPANY_NOISE.sub(" ", words).split())


def same_company(job_company, page_name) -> bool:
    """Whether a company page is the job's company: the same words once punctuation and
    legal suffixes go, or one name inside the other ("Google" / "Google LLC").

    A job entry can link to an unrelated page - Andrian's "VLAI-Solutions" linked to
    "Vyapar Launchpad", whose head count then scored as his company's size."""
    a, b = _company_words(job_company), _company_words(page_name)
    return bool(a and b) and (a <= b or b <= a)


def company_from_harvestapi(item: dict) -> dict:
    """The company actor's output, in the keys /collect and the admin already read."""
    # Live output lists each industry as an object ({"id", "name", "urn", ...}); the README
    # example shows plain strings. str() on the object stored "{'id': '6', 'name': ..." as
    # the industry, so the name is taken from either shape.
    def _industry(x):
        return str((x.get("name") or x.get("title") or "") if isinstance(x, dict) else (x or "")).strip()
    industries = [n for n in (_industry(x) for x in (item.get("industries") or [])) if n]
    count = parse_count(item.get("employeeCount")) if item.get("employeeCount") not in (None, "") else None
    if not count:
        # Only a range published: its lower bound still lands in the right size bucket.
        start = (item.get("employeeCountRange") or {}).get("start")
        count = int(start) if isinstance(start, (int, float)) else None
    hq = next((l for l in (item.get("locations") or []) if isinstance(l, dict) and l.get("headquarter")), {})
    return {
        "current_company_name": item.get("name") or "",
        "current_company_employee_count": count,
        "current_company_industry": ", ".join(industries),
        "current_company_headquarters": {"city": hq.get("city") or "", "state": hq.get("geographicArea") or "",
                                         "country": hq.get("country") or ""} if hq else {},
        "current_company_website": item.get("website") or "",
        "current_company_url": item.get("linkedinUrl") or "",
    }


def run_company_details(company_url: str, notes: list | None = None) -> dict:
    """One company's details. Every failure is written to `notes`: an empty result with
    no reason is what made "LinkedIn did not publish an industry" impossible to explain."""
    notes = notes if notes is not None else []
    token = current_apify_token()
    if not token:
        notes.append("company lookup skipped: " + MISSING)
        return {}
    actor_id = settings.apify_company_details_actor
    try:
        items = _call_actor(token, actor_id, {"companies": [company_url]})
    except Exception as e:
        log.warning("company actor %s failed for %s: %s", actor_id, company_url, e)
        notes.append(f"company actor {actor_id}: {type(e).__name__}: {e}")
        return {}
    item = next((i for i in items if isinstance(i, dict) and i.get("name")), None)
    if not item:
        notes.append(f"company actor {actor_id}: ran OK but returned nothing for {company_url}")
        return {}
    company = company_from_harvestapi(item)
    if not company["current_company_industry"] and company["current_company_employee_count"] is None:
        notes.append(f"{company['current_company_name'] or company_url}: the company page lists no industry "
                     "and no employee count")
    return company


def _profile_company_items(token: str, actor_id: str, profile_url: str) -> list:
    """The older profile-based actor (settings.apify_company_actor), by LinkedIn username."""
    username = profile_url.rstrip("/").split("/")[-1]
    return _call_actor(token, actor_id, {"profiles": [username], "isEmailRequired": False})


def run_apify_actor(profile_url: str) -> dict:
    """Run the profile actor, fall back to the company actor.
    Any failure is collected so the caller can report WHY no data came back."""
    token      = current_apify_token()
    actor_id   = settings.apify_profile_actor
    company_id = settings.apify_company_actor
    if not token:
        raise ApifyError(MISSING)

    errors = []
    try:
        items = _call_actor(token, actor_id, _profile_input(actor_id, profile_url))
        for item in items:
            item = from_harvestapi(item)
            if item.get("name") or item.get("first_name"):
                return item
        errors.append(f"profile actor {actor_id}: ran OK but {len(items)} item(s) without a name")
    except Exception as e:
        errors.append(f"profile actor {actor_id}: {type(e).__name__}: {e}")

    if not company_id:
        raise ApifyError("No data returned from Apify -> " + " | ".join(errors))
    try:
        items2 = _profile_company_items(token, company_id, profile_url)
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
                return item
        errors.append(f"company actor {company_id}: ran OK but {len(items2)} item(s) without a name")
    except Exception as e:
        errors.append(f"company actor {company_id}: {type(e).__name__}: {e}")

    log.warning("no profile data for %s: %s", profile_url, " | ".join(errors))
    raise ApifyError("No data returned from Apify -> " + " | ".join(errors))


def run_company_actor(profile_url: str, notes: list | None = None) -> dict:
    """Company details through the profile-based actor: the fallback when a profile names
    no company page. The reason for an empty answer goes into `notes`."""
    notes = notes if notes is not None else []
    token, actor_id = current_apify_token(), settings.apify_company_actor
    if not token or not actor_id:
        notes.append("company lookup skipped: " + (MISSING if not token else "APIFY_COMPANY_ACTOR_ID is not set"))
        return {}
    try:
        items = _profile_company_items(token, actor_id, profile_url)
    except Exception as e:
        log.warning("company actor %s failed for %s: %s", actor_id, profile_url, e)
        notes.append(f"company actor {actor_id}: {type(e).__name__}: {e}")
        return {}
    for item in items:
        count = item.get("current_company_employee_count")
        return {
            "headline": item.get("headline", ""),
            "about": item.get("about", ""),
            "location": item.get("location", ""),
            "current_company_name": item.get("current_company_name") or item.get("current_company", ""),
            # A range like "11-50" stays as text: employee_count_range() reads it as is.
            "current_company_employee_count": (count if isinstance(count, str) and "-" in count
                                               else (parse_count(count) if count is not None else None)),
            "current_company_industry": item.get("current_company_industry", ""),
            "current_company_headquarters": item.get("current_company_headquarters", {}),
        }
    notes.append(f"company actor {actor_id}: ran OK but returned nothing")
    return {}


def run_posts_actor(profile_url: str, max_posts: int | None = None, errors: list | None = None) -> list:
    """Posts from the profile's activity feed, newest first (the actor sorts by
    date). `errors` (when given) collects the reason a fetch came back empty, so
    the caller can tell "no posts" from "fetch failed"."""
    token    = current_apify_token()
    actor_id = settings.apify_posts_actor
    if not token or not actor_id:
        why = MISSING if not token else "APIFY_POSTS_ACTOR_ID is not set in .env"
        log.info("posts actor skipped: %s", why)
        if errors is not None:
            errors.append(f"posts actor skipped: {why}")
        return []
    try:
        return _call_actor(token, actor_id, {
            # This actor takes target URLs. Passing a bare username under another
            # field name is accepted silently and the run comes back empty.
            "targetUrls":      [profile_url],
            # The newest posts, with no date floor. A 90-day cut-off looked sensible
            # but hid the answer to "when did they last post": somebody whose last
            # post is four months old returned nothing, and the panel fell back to a
            # stale post embedded in the profile and reported that as their latest.
            "maxPosts":        max_posts or settings.max_posts,
            # Reposts stay in: they count as activity. split_own_posts keeps their
            # text/engagement (the original author's) out of everything else.
            "includeReposts":    True,
            "includeQuotePosts": True,
        })
    except Exception as e:
        log.warning("posts actor %s failed: %s: %s", actor_id, type(e).__name__, e)
        if errors is not None:
            errors.append(f"posts actor {actor_id}: {type(e).__name__}: {e}")
        return []

def map_apify_to_profile(data: dict, profile_url: str, posts_data: list) -> ProfileData:

    avatar   = data.get("avatar") or ""
    name     = data.get("name") or (
        f"{data.get('first_name','')} {data.get('last_name','')}".strip()
    ) or "Unknown"
    # The full location first. A city on its own ("San Jose") names no country, so a
    # Geography rule for the USA could never match it; the country code fixes that, and
    # the location matcher already knows "US" means the United States.
    location = data.get("location")
    location = location if isinstance(location, str) else ""
    city_code = ", ".join(x for x in (data.get("city"), data.get("country_code")) if x)
    country  = location.strip() or city_code or "Not specified"
    position = data.get("position") or ""
    if not position:
        roles = data.get("experience") or data.get("experiences") or []
        if roles and isinstance(roles[0], dict):
            position = roles[0].get("title") or roles[0].get("position") or ""
    # The headline used to arrive from the page the extension read. The extension now
    # sends nothing about the person, so it must come from what Apify returned - and a
    # profile that publishes none is described by its current role instead.
    headline = str(data.get("headline") or "").strip() or position
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

    # Real skills only \u2014 job titles are not skills (they would inflate Profile Completeness)
    skill_list = data.get("skills") or []
    names = []
    # `skill`, not `name`: reusing `name` here replaced the person's name with their last
    # skill ("Microsoft Excel"). The page used to override it, which hid the bug.
    for s in skill_list if isinstance(skill_list, list) else []:
        skill = (s.get("name") or s.get("title") or "") if isinstance(s, dict) else str(s or "")
        if skill.strip():
            names.append(skill.strip())
    skills = " \u2022 ".join(names) or "Not specified"

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

    posts_raw     = data.get("posts") or []
    act_list      = data.get("activity") or []
    activity_url  = ""
    activity_date = ""

    # "Last posted \u2026" must describe the NEWEST dated post across both actors \u2014 the
    # same posts the Recent Activity score is computed from \u2014 never just list[0],
    # which can be an old or featured post ("2 years ago" next to a 20/30 score).
    # The feed also holds reposts of OTHER people's posts (the item's author is
    # the original writer): those may only ever show as "Reposted \u2026", never as
    # this person's own words or link.
    all_posts    = list(posts_data or []) + [p for p in posts_raw if isinstance(p, dict)]
    own, reposts = split_own_posts(all_posts, profile_url)
    newest = newest_post(own)

    newest_repost = newest_post(reposts)
    if newest:
        _, iso, latest = newest
        snippet       = " ".join(str(latest.get("text") or latest.get("content") or latest.get("title") or "").split())[:80]
        activity_url  = post_url(latest)
        activity_date = iso
        activity      = f"Last posted {time_ago(iso)}" + (f' \u2014 "{snippet}\u2026"' if snippet else "")
    elif newest_repost:
        _, iso, latest = newest_repost
        activity_url  = post_url(latest)
        activity_date = iso
        activity      = f"Reposted someone else's post {time_ago(iso)}"
    elif act_list and isinstance(act_list[0], dict):
        first        = act_list[0]
        interaction  = first.get("interaction") or ""
        post_title   = first.get("title") or ""
        activity_url = post_url(first)
        activity     = interaction + (f' \u2014 "{post_title}\u2026"' if post_title else "") or "Has recent activity"
    elif posts_raw or posts_data:
        activity = "Has recent activity"
    else:
        activity = "No recent activity"

    followers          = parse_count(data.get("followers"))
    connections        = parse_count(data.get("connections"))

    profile = ProfileData(
        avatar=avatar, name=name, country=country, position=position, headline=headline,
        about=about, current_company=current_company, education=education,
        skills=skills, projects=projects, activity=activity,
        activity_url=activity_url, activity_date=activity_date,
        followers=followers, connections=connections,
        profileUrl=profile_url, timestamp="", experience=experience
    )

    return apply_score(profile, data, posts_data)
