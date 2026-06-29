from datetime import datetime, timezone
from models import ProfileData

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

def calc_days_ago(dt_str: str):
    if not isinstance(dt_str, str):
        return None
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except:
        return None

def compute_score(profile: ProfileData, raw_data: dict, posts_data: list) -> dict:

    most_recent_days = None

    def _get_date(post: dict) -> str:
        for key in ("postedAt", "date", "createdAt", "timestamp", "postedDate", "time"):
            val = post.get(key)
            if not val:
                continue
            if isinstance(val, dict):
                val = val.get("date") or val.get("postedDate") or ""
            if isinstance(val, str) and val:
                return val
        return ""

    if posts_data:
        for post in posts_data:
            pub = _get_date(post)
            if pub:
                d = calc_days_ago(pub)
                if d is not None and (most_recent_days is None or d < most_recent_days):
                    most_recent_days = d
    if most_recent_days is not None:
        if most_recent_days <= 7:    score_activity = 30
        elif most_recent_days <= 30: score_activity = 20
        elif most_recent_days <= 90: score_activity = 10
        else:                        score_activity = 0
    else:
        score_activity = 0

    posts_90_days = 0
    posts_with_no_date = 0

    if posts_data:
        for post in posts_data:
            pub = _get_date(post)
            if pub:
                d = calc_days_ago(pub)
                if d is not None and d <= 90:
                    posts_90_days += 1
            else:
                posts_with_no_date += 1

    if posts_90_days == 0 and posts_with_no_date > 0:
        posts_90_days = posts_with_no_date
    if posts_90_days >= 10:   score_posts = 20
    elif posts_90_days >= 5:  score_posts = 15
    elif posts_90_days >= 1:  score_posts = 10
    else:                     score_posts = 0

    engagement_totals = []

    for post in posts_data:
        eng = post.get("engagement") or {}

        reactions = (
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
        total = reactions + comments
        engagement_totals.append(total)
    if engagement_totals:
        avg_engagement = sum(engagement_totals) / len(engagement_totals)
        if avg_engagement >= 50:
            score_engagement = 20
            engagement_label = "High"
        elif avg_engagement >= 10:
            score_engagement = 10
            engagement_label = "Medium"
        elif avg_engagement >= 1:
            score_engagement = 5
            engagement_label = "Low"
        else:
            score_engagement = 0
            engagement_label = "None"
    else:
        avg_engagement = 0
        score_engagement = 0
        engagement_label = "No data"

    c = 0
    if profile.avatar:                                                         c += 2
    if profile.position:                                                       c += 2
    if profile.about    and profile.about    != "Not specified":               c += 2
    if profile.experience and profile.experience != "Not specified":           c += 2
    if profile.current_company and profile.current_company != "Not specified": c += 2
    score_completeness = c

    conns = profile.mutual_connections or 0
    if conns >= 20:   score_mutuals = 10
    elif conns >= 10: score_mutuals = 7
    elif conns >= 5:  score_mutuals = 5
    elif conns >= 1:  score_mutuals = 2
    else:             score_mutuals = 0

    about_l    = (profile.about or "").lower()
    position_l = (profile.position or "").lower()
    signals    = 0

    hiring_kw = ["hiring", "we're hiring", "join our team", "open roles",
                 "apply now", "job opening", "looking for"]
    promo_kw  = ["promoted", "new role", "excited to announce", "joining",
                 "started as", "just joined"]
    growth_kw = ["growing", "we raised", "series a", "series b", "funded",
                 "expansion", "launched", "new product"]

    for kw in hiring_kw:
        if kw in about_l or kw in position_l: signals += 5; break
    for kw in promo_kw:
        if kw in about_l or kw in position_l: signals += 3; break
    for kw in growth_kw:
        if kw in about_l or kw in position_l: signals += 2; break

    if posts_data:
        for post in posts_data[:5]:
            pt = (post.get("text") or post.get("content") or "").lower()
            for kw in hiring_kw:
                if kw in pt and signals < 10: signals += 5; break
            for kw in growth_kw:
                if kw in pt and signals < 10: signals += 2; break

    score_signals = min(signals, 10)

    total = (score_activity + score_posts + score_engagement +
             score_completeness + score_signals + score_mutuals)

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
        "avg_engagement":     round(avg_engagement, 1),
        "posts_90_days":      posts_90_days,
        "engagement_label":   engagement_label,
    }
