import json
import os
import re
from datetime import datetime, timezone
from models import ProfileData

# ─── Editable points ──────────────────────────────────────────────────────────
# Max points per Activity factor. Edited from the Activity form in the extension
# and saved to activity_points.json (GET/POST /activity-points). Each factor's
# own rules (e.g. posted within 7 / 30 / 90 days) scale with its max, and the
# total is scaled to 100 — with the defaults nothing changes.
BASE_DIR             = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACTIVITY_POINTS_FILE = os.path.join(BASE_DIR, "activity_points.json")

DEFAULT_ACTIVITY_POINTS = {
    "recent_activity":    30,
    "posts_30_days":      10,
    "posts_90_days":      10,
    "avg_likes":          5,
    "avg_comments":       10,
    "avg_reposts":        5,
    "completeness":       10,
    "signals":            10,
    "mutual_connections": 10,
}


def _clean_points(values, defaults: dict, fallback: dict) -> dict:
    """Whole points 0–100 per known key; missing / invalid keys keep `fallback`."""
    out = dict(fallback)
    if isinstance(values, dict):
        for key in defaults:
            try:
                if values.get(key) is not None:
                    out[key] = max(0, min(100, int(round(float(values[key])))))
            except (TypeError, ValueError):
                pass
    return out


def get_activity_points() -> dict:
    try:
        if os.path.exists(ACTIVITY_POINTS_FILE):
            with open(ACTIVITY_POINTS_FILE, "r", encoding="utf-8") as f:
                return _clean_points(json.load(f), DEFAULT_ACTIVITY_POINTS, DEFAULT_ACTIVITY_POINTS)
    except Exception:
        pass
    return dict(DEFAULT_ACTIVITY_POINTS)


def save_activity_points(values: dict) -> dict:
    """Keys left out keep their saved value; {"reset": true} restores the defaults."""
    points = (dict(DEFAULT_ACTIVITY_POINTS) if isinstance(values, dict) and values.get("reset")
              else _clean_points(values, DEFAULT_ACTIVITY_POINTS, get_activity_points()))
    with open(ACTIVITY_POINTS_FILE, "w", encoding="utf-8") as f:
        json.dump(points, f, indent=2)
    return points


# Hiring / growth signal keywords (edited as chips in the Activity form, saved to
# activity_keywords.json via GET/POST /activity-keywords). Matched case-insensitively
# in the About, headline, position and the 5 newest posts.
ACTIVITY_KEYWORDS_FILE = os.path.join(BASE_DIR, "activity_keywords.json")
DEFAULT_SIGNAL_KEYWORDS = {
    "hiring": ["hiring", "now hiring", "we're hiring", "join our team"],
    "job":    ["open roles", "apply now", "job opening", "job posting",
               "we are looking for", "looking for", "careers"],
    "growth": ["growing", "we raised", "series a", "series b", "funded",
               "expansion", "launched", "new product"],
}


def _kw_list(value, fallback: list) -> list:
    if isinstance(value, str):
        value = value.splitlines() if "\n" in value else value.split(",")
    if not isinstance(value, list):
        return list(fallback)
    out = []
    for v in value:
        v = str(v).strip()
        if v and v.lower() not in (x.lower() for x in out):
            out.append(v)
    return out


def get_signal_keywords() -> dict:
    lists = {k: list(v) for k, v in DEFAULT_SIGNAL_KEYWORDS.items()}
    try:
        if os.path.exists(ACTIVITY_KEYWORDS_FILE):
            with open(ACTIVITY_KEYWORDS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                for k in DEFAULT_SIGNAL_KEYWORDS:
                    if saved.get(k) is not None:
                        lists[k] = _kw_list(saved[k], lists[k])
    except Exception:
        pass
    return lists


def save_signal_keywords(values: dict) -> dict:
    """Lists left out keep their saved value; {"reset": true} restores the defaults."""
    if isinstance(values, dict) and values.get("reset"):
        lists = {k: list(v) for k, v in DEFAULT_SIGNAL_KEYWORDS.items()}
    else:
        current = get_signal_keywords()
        lists = {k: (current[k] if not isinstance(values, dict) or values.get(k) is None
                     else _kw_list(values[k], current[k])) for k in DEFAULT_SIGNAL_KEYWORDS}
    with open(ACTIVITY_KEYWORDS_FILE, "w", encoding="utf-8") as f:
        json.dump(lists, f, indent=2, ensure_ascii=False)
    return lists


def _scaled(earned: float, default_max: float, new_max: float) -> int:
    """A factor's default-rule score re-expressed out of the user's max."""
    return int(round(earned * new_max / default_max)) if default_max else 0

def time_ago(dt_str: str) -> str:
    if isinstance(dt_str, dict):
        dt_str = dt_str.get("date") or dt_str.get("postedDate") or ""
    if not isinstance(dt_str, str) or not dt_str:
        return ""
    try:
        post_time = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        diff  = datetime.now(timezone.utc) - post_time
        days  = diff.days
        if days == 0:
            hours = diff.seconds // 3600
            return f"{hours}h ago" if hours > 0 else "today"
        elif days == 1:  return "yesterday"
        elif days < 7:   return f"{days} days ago"
        elif days < 30:  return f"{days // 7} week{'s' if days//7 > 1 else ''} ago"
        elif days < 365: return f"{days // 30} month{'s' if days//30 > 1 else ''} ago"
        else:            return f"{days // 365} year{'s' if days//365 > 1 else ''} ago"
    except Exception:
        return dt_str[:10] if dt_str else ""

POST_DATE_KEYS = ("postedAt", "date", "createdAt", "created_at", "posted_at", "timestamp", "postedDate",
                  "time", "publishedAt", "publishedAtISO", "createdTime")


def post_date(post: dict) -> str:
    """ISO date of a post from any Apify actor shape ('' when it has none).
    Handles nested {"date": ...} objects and epoch timestamps (s or ms)."""
    if not isinstance(post, dict):
        return ""
    for key in POST_DATE_KEYS:
        val = post.get(key)
        if not val:
            continue
        if isinstance(val, dict):
            val = val.get("date") or val.get("postedDate") or val.get("timestamp") or ""
        if isinstance(val, (int, float)) and not isinstance(val, bool) and val > 0:
            secs = val / 1000 if val > 1e11 else val
            try:
                return datetime.fromtimestamp(secs, tz=timezone.utc).isoformat()
            except (OverflowError, OSError, ValueError):
                continue
        if isinstance(val, str) and val:
            return val
    return ""


def newest_post(posts: list):
    """(days_ago, iso_date, post) for the most recent dated post, or None."""
    best = None
    for post in posts or []:
        iso = post_date(post)
        days = calc_days_ago(iso) if iso else None
        if days is None or days < 0:
            continue
        if best is None or days < best[0]:
            best = (days, iso, post)
    return best


def calc_days_ago(dt_str: str):
    if not isinstance(dt_str, str):
        return None
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except:
        return None

def parse_activity_to_days(activity_text: str):
    """Read the recency out of the Activity form field, e.g. "Posted 2 weeks ago".
    Returns days ago (0 = today) or None when nothing can be parsed."""
    if not isinstance(activity_text, str) or not activity_text.strip():
        return None
    text = activity_text.lower()
    if re.search(r"\b(today|just now|right now)\b", text):
        return 0
    if re.search(r"\byesterday\b", text):
        return 1
    # "Posted 2 weeks ago" / "last activity 3 days ago"
    m = re.search(r"(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago", text)
    # LinkedIn's compact form: "4d", "2w", "1mo", "5h"
    if not m:
        m = re.search(r"(\d+)\s*(mo|[dwyh])\b", text)
    if not m:
        return None
    amount = int(m.group(1))
    unit   = {"mo": "month", "d": "day", "w": "week", "y": "year", "h": "hour"}.get(m.group(2), m.group(2))
    days   = {"second": 1 / 86400, "minute": 1 / 1440, "hour": 1 / 24,
              "day": 1, "week": 7, "month": 30, "year": 365}[unit]
    return max(0, int(amount * days))

def compute_score(profile: ProfileData, raw_data: dict, posts_data: list) -> dict:
    P = get_activity_points()   # max points per factor (editable in the Activity form)

    most_recent_days = None
    _get_date = post_date

    if posts_data:
        for post in posts_data:
            pub = _get_date(post)
            if pub:
                d = calc_days_ago(pub)
                if d is not None and (most_recent_days is None or d < most_recent_days):
                    most_recent_days = d
    # No dated posts → fall back to the Activity value from the Activity form
    if most_recent_days is None:
        most_recent_days = parse_activity_to_days(profile.activity)

    # RECENT_ACTIVITY (30) — cumulative: <=7d adds 15, <=30d adds 10, <=90d adds 5
    score_activity = 0
    if most_recent_days is not None:
        if most_recent_days <= 90: score_activity += 5
        if most_recent_days <= 30: score_activity += 10
        if most_recent_days <= 7:  score_activity += 15
    score_activity = _scaled(score_activity, 30, P["recent_activity"])

    posts_30_days = 0
    posts_90_days = 0
    posts_with_no_date = 0

    if posts_data:
        for post in posts_data:
            pub = _get_date(post)
            if pub:
                d = calc_days_ago(pub)
                if d is not None:
                    if d <= 90: posts_90_days += 1
                    if d <= 30: posts_30_days += 1
            else:
                posts_with_no_date += 1

    if posts_90_days == 0 and posts_with_no_date > 0:
        posts_90_days = posts_with_no_date
    # Values typed into the Activity form fill in whatever Apify could not give us
    if posts_30_days == 0 and profile.posts_30_days:
        posts_30_days = int(profile.posts_30_days)
    if posts_90_days == 0 and profile.posts_90_days:
        posts_90_days = int(profile.posts_90_days)

    # POSTING_FREQUENCY (20): >=4 posts / 30d = 10, >=10 posts / 90d = 10
    score_posts = 0
    if posts_30_days >= 4:  score_posts += P["posts_30_days"]
    if posts_90_days >= 10: score_posts += P["posts_90_days"]

    # ENGAGEMENT_LEVEL (20) — averages per post:
    #   avg likes >= 10 -> 5 | avg comments >= 5 -> 10 | avg reposts >= 3 -> 5
    likes_totals, comments_totals, reposts_totals = [], [], []

    for post in posts_data:
        eng = post.get("engagement") or {}

        likes = (
            eng.get("numLikes")
            or eng.get("likes")
            or eng.get("reactionsCount")
            or eng.get("numReactions")
            or eng.get("likeCount")
            or eng.get("count")
            or post.get("numLikes")
            or post.get("likesCount")
            or post.get("reactionsCount")
            or post.get("numReactions")
            or post.get("likeCount")
            or len(post.get("reactions", []))
            or 0
        )
        comments = (
            eng.get("numComments")
            or eng.get("commentsCount")
            or eng.get("commentCount")
            or post.get("numComments")
            or post.get("commentsCount")
            or post.get("commentCount")
            or len(post.get("comments", []))
            or 0
        )
        reposts = (
            eng.get("numShares")
            or eng.get("shares")
            or eng.get("repostsCount")
            or eng.get("numReposts")
            or eng.get("repostCount")
            or eng.get("sharesCount")
            or post.get("numShares")
            or post.get("sharesCount")
            or post.get("repostsCount")
            or post.get("numReposts")
            or len(post.get("reposts", []))
            or 0
        )
        likes_totals.append(likes)
        comments_totals.append(comments)
        reposts_totals.append(reposts)

    if likes_totals:
        avg_likes    = sum(likes_totals)    / len(likes_totals)
        avg_comments = sum(comments_totals) / len(comments_totals)
        avg_reposts  = sum(reposts_totals)  / len(reposts_totals)
        engagement_from_form = False
    else:
        # No post data → the three "Avg ... / Post" values typed into the form
        avg_likes    = float(profile.avg_likes    or 0)
        avg_comments = float(profile.avg_comments or 0)
        avg_reposts  = float(profile.avg_reposts  or 0)
        engagement_from_form = True

    score_engagement = 0
    if avg_likes    >= 10: score_engagement += P["avg_likes"]
    if avg_comments >= 5:  score_engagement += P["avg_comments"]
    if avg_reposts  >= 3:  score_engagement += P["avg_reposts"]
    max_engagement = P["avg_likes"] + P["avg_comments"] + P["avg_reposts"]

    form_tag = " (form)" if engagement_from_form else ""
    if   max_engagement and score_engagement >= max_engagement:     engagement_label = "High" + form_tag
    elif max_engagement and score_engagement >= max_engagement / 2: engagement_label = "Medium" + form_tag
    elif score_engagement >  0:  engagement_label = "Low" + form_tag
    else:                        engagement_label = "No data"

    avg_engagement = round(avg_likes + avg_comments, 1)

    # PROFILE_COMPLETENESS (10): headline, about, experience, skills, photo — 2 each
    c = 0
    if profile.headline or profile.position:                             c += 2  # headline exists
    if profile.about     and profile.about     != "Not specified":  c += 2
    if profile.experience and profile.experience != "Not specified": c += 2
    if profile.skills    and profile.skills    != "Not specified":  c += 2
    if profile.avatar:                                               c += 2  # photo
    score_completeness = _scaled(c, 10, P["completeness"])

    # MUTUAL_CONNECTIONS (10): 10+ = 10, 5+ = 5, 1+ = 2, none = 0
    conns = profile.mutual_connections or 0
    if conns >= 10:   score_mutuals = 10
    elif conns >= 5:  score_mutuals = 5
    elif conns >= 1:  score_mutuals = 2
    else:             score_mutuals = 0
    score_mutuals = _scaled(score_mutuals, 10, P["mutual_connections"])

    about_l    = (profile.about or "").lower()
    position_l = (profile.position or "").lower()
    headline_l = (profile.headline or "").lower()
    signals    = 0

    # HIRING_GROWTH_SIGNALS (10): hiring activity 5, job posting 3, growth signal 2
    # — keyword lists editable in the Activity form (activity_keywords.json)
    KW = get_signal_keywords()
    hiring_kw = [k.lower() for k in KW["hiring"]]
    job_kw    = [k.lower() for k in KW["job"]]
    growth_kw = [k.lower() for k in KW["growth"]]

    score_hiring = score_job = score_growth = 0

    def _scan(text: str):
        nonlocal score_hiring, score_job, score_growth
        if not text:
            return
        if not score_hiring and any(kw in text for kw in hiring_kw): score_hiring = 5
        if not score_job    and any(kw in text for kw in job_kw):    score_job    = 3
        if not score_growth and any(kw in text for kw in growth_kw): score_growth = 2

    _scan(about_l)
    _scan(headline_l)
    _scan(position_l)
    if posts_data:
        for post in posts_data[:5]:
            _scan((post.get("text") or post.get("content") or "").lower())

    score_signals = _scaled(min(score_hiring + score_job + score_growth, 10), 10, P["signals"])

    raw_total = (score_activity + score_posts + score_engagement +
                 score_completeness + score_signals + score_mutuals)
    max_total = sum(P.values())
    # Shown out of 100 whatever the points add up to (the defaults total 100)
    total = int(round(raw_total * 100 / max_total)) if max_total else 0

    if total >= 70:   label = "\U0001f7e2 Ready to Engage"
    elif total >= 40: label = "\U0001f7e1 Needs Nurturing"
    else:             label = "\U0001f534 Difficult to Engage"

    return {
        "score_total":        total,
        "score_label":        label,
        "score_activity":     score_activity,
        "score_posts":        score_posts,
        "score_engagement":   score_engagement,
        "score_completeness": score_completeness,
        "score_signals":      score_signals,
        "score_mutuals":      score_mutuals,
        "max_activity":       P["recent_activity"],
        "max_posts":          P["posts_30_days"] + P["posts_90_days"],
        "max_engagement":     max_engagement,
        "max_completeness":   P["completeness"],
        "max_signals":        P["signals"],
        "max_mutuals":        P["mutual_connections"],
        "score_raw":          raw_total,
        "score_max":          max_total,
        "avg_engagement":     round(avg_engagement, 1),
        "posts_30_days":      posts_30_days,
        "posts_90_days":      posts_90_days,
        "avg_likes":          round(avg_likes, 1),
        "avg_comments":       round(avg_comments, 1),
        "avg_reposts":        round(avg_reposts, 1),
        "engagement_label":   engagement_label,
    }
