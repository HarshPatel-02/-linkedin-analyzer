import json
import math
import os
import re
from datetime import datetime, timezone
from fractions import Fraction
from urllib.parse import unquote
from models import ProfileData
from services.config_store import read_config, write_config
from services.matching import normalize, first_match, pts

# ─── Editable points ──────────────────────────────────────────────────────────
# Max points per Activity factor. Edited from the Activity form in the extension
# and saved to activity_points.json (GET/POST /activity-points). Each factor's
# own rules (e.g. posted within 7 / 30 / 90 days) scale with its max, and the
# total is scaled to 100 — with the defaults nothing changes.
BASE_DIR             = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACTIVITY_POINTS_FILE = os.path.join(BASE_DIR, "activity_points.json")

DEFAULT_ACTIVITY_POINTS = {
    "recent_activity":    30,
    "posting_frequency":  20,
    "engagement":         20,
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
    return read_config(ACTIVITY_POINTS_FILE,
                        lambda v: _clean_points(v, DEFAULT_ACTIVITY_POINTS, DEFAULT_ACTIVITY_POINTS))


def save_activity_points(values: dict) -> dict:
    """Keys left out keep their saved value; {"reset": true} restores the defaults."""
    points = (dict(DEFAULT_ACTIVITY_POINTS) if isinstance(values, dict) and values.get("reset")
              else _clean_points(values, DEFAULT_ACTIVITY_POINTS, get_activity_points()))
    return write_config(ACTIVITY_POINTS_FILE, points)


# Requirements, edited in the Activity form (activity_rules.json via GET/POST
# /activity-rules). Kept out of the points file on purpose: every value there is summed
# into the maximum, so a "2" would quietly become two more possible points.
ACTIVITY_RULES_FILE = os.path.join(BASE_DIR, "activity_rules.json")
DEFAULT_ACTIVITY_RULES = {"mutual_min": 0}      # 0 = no requirement

# Failing a requirement caps the total here: the top of "Difficult to Engage".
REQUIRED_CAP = 39


def _clean_rules(values, fallback: dict) -> dict:
    out = dict(fallback)
    if isinstance(values, dict) and values.get("mutual_min") is not None:
        try:
            out["mutual_min"] = max(0, min(500, int(round(float(values["mutual_min"])))))
        except (TypeError, ValueError):
            pass
    return out


def get_activity_rules() -> dict:
    return read_config(ACTIVITY_RULES_FILE, lambda v: _clean_rules(v, DEFAULT_ACTIVITY_RULES))


def save_activity_rules(values: dict) -> dict:
    return write_config(ACTIVITY_RULES_FILE, _clean_rules(values, get_activity_rules()))


# Hiring / growth signal keywords (edited as chips in the Activity form, saved to
# activity_keywords.json via GET/POST /activity-keywords). Matched case-insensitively
# in the About, headline, position and the 5 newest posts.
ACTIVITY_KEYWORDS_FILE = os.path.join(BASE_DIR, "activity_keywords.json")
DEFAULT_SIGNAL_KEYWORDS = {
    "hiring": ["hiring", "now hiring", "we're hiring", "join our team"],
    "job":    ["promoted", "excited to announce", "new role", "starting a new position",
               "new chapter"],
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


def _clean_keywords(values, fallback: dict) -> dict:
    """One list per known key; a key left out keeps `fallback`."""
    out = {k: list(v) for k, v in fallback.items()}
    if isinstance(values, dict):
        for key in DEFAULT_SIGNAL_KEYWORDS:
            if values.get(key) is not None:
                out[key] = _kw_list(values[key], out[key])
    return out


def get_signal_keywords() -> dict:
    return read_config(ACTIVITY_KEYWORDS_FILE, lambda v: _clean_keywords(v, DEFAULT_SIGNAL_KEYWORDS))


def save_signal_keywords(values: dict) -> dict:
    """Lists left out keep their saved value; {"reset": true} restores the defaults."""
    lists = ({k: list(v) for k, v in DEFAULT_SIGNAL_KEYWORDS.items()}
             if isinstance(values, dict) and values.get("reset")
             else _clean_keywords(values, get_signal_keywords()))
    return write_config(ACTIVITY_KEYWORDS_FILE, lists)


def _scaled(earned: float, default_max: float, new_max: float) -> int:
    """A factor's default-rule score re-expressed out of the user's max (half-up, like JS Math.round)."""
    return pts(new_max, Fraction(earned).limit_denominator() / Fraction(default_max)) if default_max else 0

def time_ago(dt_str: str) -> str:
    if isinstance(dt_str, dict):
        dt_str = dt_str.get("date") or dt_str.get("postedDate") or ""
    if not isinstance(dt_str, str) or not dt_str:
        return ""
    try:
        post_time = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        diff  = datetime.now(timezone.utc) - post_time
        days  = diff.days
        if days < 0:     # clock skew / a just-published post — never "-1 days ago"
            return "today"
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

# ─── Post helpers ─────────────────────────────────────────────────────────────
POST_ID_KEYS   = ("url", "postUrl", "post_url", "link", "urn", "postUrn", "shareUrn", "activityUrn", "id")
POST_TEXT_KEYS = ("text", "content", "postText", "commentary", "description", "title")

LIKE_KEYS    = ("numLikes", "likes", "likesCount", "likeCount", "reactionsCount", "numReactions",
                "totalReactionCount", "reactionCount", "reactions")
COMMENT_KEYS = ("numComments", "comments", "commentsCount", "commentCount")
REPOST_KEYS  = ("numShares", "shares", "sharesCount", "repostsCount", "numReposts", "repostCount", "reposts")


def post_text(post) -> str:
    if not isinstance(post, dict):
        return ""
    for key in POST_TEXT_KEYS:
        val = post.get(key)
        if isinstance(val, str) and val.strip():
            return val
    return ""


def _post_ids(post: dict) -> list:
    ids = []
    for key in POST_ID_KEYS:
        val = post.get(key)
        if isinstance(val, (str, int)) and not isinstance(val, bool) and str(val).strip():
            ids.append(str(val).split("?")[0].rstrip("/").lower())
    return ids


# ─── Post ownership ───────────────────────────────────────────────────────────
# The posts actor scrapes the profile's activity feed, which mixes the person's
# own posts with reposts of OTHER people's posts. A repost item carries the
# original author, so "Last posted …" (and engagement / signal keywords) must
# never be read from it as if the person wrote it.
AUTHOR_DICT_KEYS = ("author", "postAuthor", "actor", "authorProfile", "user")
AUTHOR_ID_KEYS   = ("publicIdentifier", "public_identifier", "universalName", "username", "publicId")
AUTHOR_URL_KEYS  = ("linkedinUrl", "linkedin_url", "url", "profileUrl", "profile_url", "authorUrl", "author_url")
AUTHOR_FLAT_KEYS = ("authorProfileUrl", "author_profile_url", "authorUrl", "author_url",
                    "authorPublicIdentifier", "authorUsername")


def profile_slug(url) -> str:
    """The /in/<slug> of a LinkedIn profile URL, lowercased ('' when unreadable)."""
    s = unquote(str(url or "")).strip().lower()
    if not s:
        return ""
    m = re.search(r"/(?:in|pub|company|school)/([^/?#]+)", s)
    if m:
        return m.group(1).strip().rstrip("/")
    # a bare username ("jane-doe") is already a slug; any other URL is unreadable
    return s if re.fullmatch(r"[\w.\-%]+", s) else ""


def post_author_slug(post) -> str:
    """Slug of whoever WROTE this post, when the actor names an author ('' when unknown)."""
    if not isinstance(post, dict):
        return ""
    for key in AUTHOR_DICT_KEYS:
        author = post.get(key)
        if isinstance(author, str) and "/" in author:
            slug = profile_slug(author)
            if slug:
                return slug
        if not isinstance(author, dict):
            continue
        for k in AUTHOR_ID_KEYS:
            val = author.get(k)
            if isinstance(val, str) and val.strip():
                return val.strip().rstrip("/").lower()
        for k in AUTHOR_URL_KEYS:
            val = author.get(k)
            if isinstance(val, str) and "/" in val:
                slug = profile_slug(val)
                if slug:
                    return slug
    for key in AUTHOR_FLAT_KEYS:
        val = post.get(key)
        if isinstance(val, str) and val.strip():
            slug = profile_slug(val) if "/" in val else val.strip().rstrip("/").lower()
            if slug:
                return slug
    return ""


def split_own_posts(posts, profile_url):
    """(own, reposted): posts the person wrote vs feed items written by someone
    else (their reposts of other people's posts — real activity, not their words).
    A post with no author info counts as their own: every actor is asked for one
    profile's posts, and some actor shapes don't name the author at all."""
    slug = profile_slug(profile_url)
    if not slug:
        return list(posts or []), []
    own, reposted = [], []
    for post in posts or []:
        author = post_author_slug(post)
        (reposted if author and author != slug else own).append(post)
    return own, reposted


def dedupe_posts(*sources) -> list:
    """Posts from every source once: same url/urn/id, or same text + day = the same post."""
    out, seen_ids, seen_text = [], set(), set()
    for src in sources:
        for post in src or []:
            if not isinstance(post, dict):
                continue
            ids = _post_ids(post)
            text = normalize(post_text(post))[:120]
            text_key = (text, post_date(post)[:10]) if text else None
            if any(i in seen_ids for i in ids) or (text_key and text_key in seen_text):
                continue
            seen_ids.update(ids)
            if text_key:
                seen_text.add(text_key)
            out.append(post)
    return out


def _num(value):
    """A count from any actor shape: 12, 12.0, "1,234", "1.2K", "3M", {"count": 5}, [..] → len."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, (list, tuple)):
        return float(len(value))
    if isinstance(value, dict):
        for key in ("count", "total", "totalCount", "value"):
            n = _num(value.get(key))
            if n is not None:
                return n
        nums = [_num(v) for v in value.values() if not isinstance(v, (dict, list))]
        nums = [n for n in nums if n is not None]
        return float(sum(nums)) if nums else None
    if isinstance(value, str):
        m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([km])?\+?", value.strip().lower().replace(",", ""))
        if m:
            return float(m.group(1)) * {"k": 1_000, "m": 1_000_000}.get(m.group(2) or "", 1)
    return None


def _metric(post: dict, keys):
    """First known count for this metric, looking in engagement/stats blocks, then the post itself."""
    blocks = [post.get(k) for k in ("engagement", "stats", "socialActivityCounts")]
    for block in [b for b in blocks if isinstance(b, dict)] + [post]:
        for key in keys:
            if key in block:
                n = _num(block[key])
                if n is not None:
                    return n
    return None


def _tier(value, tiers) -> Fraction:
    for threshold, fraction in tiers:
        if value >= threshold:
            return fraction
    return Fraction(0)


# The Outreach Readiness rubric — each factor earns a share of its (editable) max.
RECENCY_TIERS  = [(7, Fraction(1)), (30, Fraction(2, 3)), (90, Fraction(1, 3))]   # 30 / 20 / 10 of 30
POSTING_TIERS  = [(10, Fraction(1)), (5, Fraction(3, 4)), (1, Fraction(1, 2))]    # 90 days: 20 / 15 / 10 of 20
# Engagement class → share of 20: High = 20, Medium = 10, Low = 5, none = 0.
# strong: likes ≥ 10, comments ≥ 5, reposts ≥ 3 · some: likes ≥ 3, comments ≥ 2, reposts ≥ 1
# High = two strong signals, Medium = one strong (or two some), Low = anything at all.
ENGAGEMENT_SHARES = {"High": Fraction(1), "Medium": Fraction(1, 2), "Low": Fraction(1, 4)}
MUTUAL_TIERS   = [(20, Fraction(1)), (10, Fraction(7, 10)), (5, Fraction(1, 2)), (1, Fraction(1, 5))]  # 10/7/5/2
SIGNAL_SHARES  = {"hiring": Fraction(1, 2), "job": Fraction(3, 10), "growth": Fraction(1, 5)}          # 5/3/2
COMPLETENESS_PARTS = ["photo", "headline", "about", "experience", "company"]                            # 2 each


def engagement_class(avg_likes, avg_comments, avg_reposts) -> str:
    strong = (avg_likes >= 10) + (avg_comments >= 5) + (avg_reposts >= 3)
    some   = (avg_likes >= 3) + (avg_comments >= 2) + (avg_reposts >= 1)
    if strong >= 2:
        return "High"
    if strong >= 1 or some >= 2:
        return "Medium"
    return "Low" if some >= 1 else "None"


def _filled(value) -> bool:
    return bool(value) and str(value).strip().lower() not in ("not specified", "no projects", "unknown")


def compute_score(profile: ProfileData, raw_data: dict, posts_data: list) -> dict:
    P = get_activity_points()   # max points per factor (editable in the Activity form)
    raw_data = raw_data if isinstance(raw_data, dict) else {}
    posts = dedupe_posts(posts_data, raw_data.get("posts") if isinstance(raw_data.get("posts"), list) else [])
    # Reposts of other people's posts count as activity (recency, frequency) but
    # their text and engagement belong to the original author, never this person.
    own_posts, _reposts = split_own_posts(posts, profile.profileUrl)

    # RECENT_ACTIVITY — newest dated post; no dated posts → the Activity form value
    newest = newest_post(posts)
    most_recent_days = newest[0] if newest else parse_activity_to_days(profile.activity)
    recency = Fraction(0)
    if most_recent_days is not None:
        recency = next((fr for days, fr in RECENCY_TIERS if most_recent_days <= days), Fraction(0))
    score_activity = pts(P["recent_activity"], recency)

    # POSTING_FREQUENCY — dated posts in the last 30 / 90 days
    posts_30_days = posts_90_days = posts_with_no_date = 0
    for post in posts:
        pub = post_date(post)
        days = calc_days_ago(pub) if pub else None
        if days is None:
            posts_with_no_date += 1
            continue
        days = max(0, days)
        if days <= 90: posts_90_days += 1
        if days <= 30: posts_30_days += 1
    # An undated post used to be counted as if it were posted inside the 90-day window,
    # which scored 12 undated posts 20/20 while 12 posts known to be two years old scored
    # 0/20 — the less we knew, the better somebody did. A date we cannot read is not
    # evidence of posting recently, so it earns nothing and is reported instead.
    # Values typed into the Activity form fill in only when NOTHING could be read. Once
    # posts are in hand, "none of them fall in the window" is an answer, not a gap: a
    # profile whose 30 posts are all from 2015 was scoring 20/20 from a 10 left in the
    # form, while Recent Activity on the same panel reported "last posted 10 years ago".
    if not posts:
        if posts_30_days == 0 and profile.posts_30_days:
            posts_30_days = int(profile.posts_30_days)
        if posts_90_days == 0 and profile.posts_90_days:
            posts_90_days = int(profile.posts_90_days)
    # A post from the last 30 days is inside the 90-day window too
    posts_90_days = max(posts_90_days, posts_30_days)
    score_posts = pts(P["posting_frequency"], _tier(posts_90_days, POSTING_TIERS))

    # ENGAGEMENT_LEVEL — averages over the person's OWN posts that expose
    # engagement counts (a repost's likes belong to the original author)
    rows = []
    for post in own_posts:
        likes, comments, reposts = _metric(post, LIKE_KEYS), _metric(post, COMMENT_KEYS), _metric(post, REPOST_KEYS)
        if likes is None and comments is None and reposts is None:
            continue
        rows.append((likes or 0, comments or 0, reposts or 0))
    if rows:
        avg_likes    = sum(r[0] for r in rows) / len(rows)
        avg_comments = sum(r[1] for r in rows) / len(rows)
        avg_reposts  = sum(r[2] for r in rows) / len(rows)
        engagement_from_form = False
    else:
        # No post data → the three "Avg ... / Post" values typed into the form
        avg_likes    = float(profile.avg_likes    or 0)
        avg_comments = float(profile.avg_comments or 0)
        avg_reposts  = float(profile.avg_reposts  or 0)
        engagement_from_form = True

    level = engagement_class(avg_likes, avg_comments, avg_reposts)
    score_engagement = pts(P["engagement"], ENGAGEMENT_SHARES.get(level, Fraction(0)))
    max_engagement = P["engagement"]
    engagement_label = "No data" if level == "None" else level + (" (form)" if engagement_from_form else "")

    avg_engagement = round(avg_likes + avg_comments, 1)

    # PROFILE_COMPLETENESS — photo, headline, About, experience, company (2 of 10 each)
    present = {
        "photo":      _filled(profile.avatar),
        "headline":   _filled(profile.headline) or _filled(profile.position),
        "about":      _filled(profile.about),
        "experience": _filled(profile.experience),
        "company":    _filled(profile.current_company),
    }
    completeness_missing = [part for part in COMPLETENESS_PARTS if not present[part]]
    score_completeness = pts(P["completeness"], Fraction(len(COMPLETENESS_PARTS) - len(completeness_missing),
                                                         len(COMPLETENESS_PARTS)))

    # MUTUAL_CONNECTIONS
    # With a required minimum set, that number IS the bar: reaching it earns the factor's
    # whole points and falling short earns none. Scoring 3 mutuals as 2/10 while the
    # administrator had asked for "at least 2" contradicted the rule they wrote.
    # With no requirement (mutual_min = 0) the default ladder decides instead.
    R = get_activity_rules()
    mutuals = int(profile.mutual_connections or 0)
    if R["mutual_min"]:
        mutual_share = Fraction(1) if mutuals >= R["mutual_min"] else Fraction(0)
    else:
        mutual_share = _tier(mutuals, MUTUAL_TIERS)
    score_mutuals = pts(P["mutual_connections"], mutual_share)

    # HIRING_GROWTH_SIGNALS — keyword lists editable in the Activity form (activity_keywords.json),
    # whole-word matches in the About, headline, position and the 5 newest OWN posts
    # (a reposted "we're hiring" is the original author's news, not this person's)
    KW = get_signal_keywords()
    def _age(post):   # newest first, undated posts last
        pub = post_date(post)
        days = calc_days_ago(pub) if pub else None
        return (days is None, days if days is not None else 0)
    newest_first = sorted(own_posts, key=_age)
    texts = [profile.about, profile.headline, profile.position] + [post_text(p) for p in newest_first[:5]]
    texts = [t for t in texts if _filled(t)]
    signal_hits = {}
    for name in ("hiring", "job", "growth"):
        for text in texts:
            kw = first_match(KW.get(name) or [], text)
            if kw:
                signal_hits[name] = kw
                break
    share = min(sum((SIGNAL_SHARES[n] for n in signal_hits), Fraction(0)), Fraction(1))
    score_signals = pts(P["signals"], share)

    raw_total = (score_activity + score_posts + score_engagement +
                 score_completeness + score_signals + score_mutuals)
    max_total = sum(P.values())
    # Shown out of 100 whatever the points add up to (the defaults total 100)
    total = pts(100, Fraction(raw_total, max_total)) if max_total else 0

    # A required minimum of mutual connections: falling short caps the whole score,
    # however active the person is - "compulsory" means not a good lead without it.
    uncapped = total
    failed_required = []
    if R["mutual_min"] and mutuals < R["mutual_min"]:
        failed_required.append(f"{R['mutual_min']}+ mutual connections (has {mutuals})")
        total = min(total, REQUIRED_CAP)

    if total >= 70:   label = "\U0001f7e2 Ready to Engage"
    elif total >= 40: label = "\U0001f7e1 Needs Nurturing"
    else:             label = "\U0001f534 Difficult to Engage"

    return {
        "score_total":        total,
        "score_label":        label,
        "score_uncapped":     uncapped,
        "failed_required":    failed_required,
        "mutual_min":         R["mutual_min"],
        "score_activity":     score_activity,
        "score_posts":        score_posts,
        "score_engagement":   score_engagement,
        "score_completeness": score_completeness,
        "score_signals":      score_signals,
        "score_mutuals":      score_mutuals,
        "max_activity":       P["recent_activity"],
        "max_posts":          P["posting_frequency"],
        "max_engagement":     max_engagement,
        "max_completeness":   P["completeness"],
        "max_signals":        P["signals"],
        "max_mutuals":        P["mutual_connections"],
        "score_raw":          raw_total,
        "score_max":          max_total,
        "avg_engagement":     round(avg_engagement, 1),
        "posts_30_days":      posts_30_days,
        "posts_undated":      posts_with_no_date,
        "posts_90_days":      posts_90_days,
        "avg_likes":          round(avg_likes, 1),
        "avg_comments":       round(avg_comments, 1),
        "avg_reposts":        round(avg_reposts, 1),
        "engagement_label":   engagement_label,
        "signal_hits":        signal_hits,
        "completeness_missing": completeness_missing,
        "posts_analyzed":     len(posts),
        "data_source":        "apify" if (posts or raw_data) else "form",
    }
