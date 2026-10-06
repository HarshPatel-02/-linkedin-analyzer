"""The Activity part of /collect: what the posts actually show, or an explicit 'not available'.

Unavailable data is reported as unavailable: a profile with no readable posts returns
activity_data_available = false rather than a zero dressed up as a score.
"""
from __future__ import annotations

from models import ProfileData
from services.scoring_service import calc_days_ago, dedupe_posts, post_date, post_text, post_url, split_own_posts

RELEVANT_POSTS_MAX = 5
POST_SNIPPET_CHARS = 280


def activity_block(profile: ProfileData, raw_data: dict, posts_data: list, score: dict) -> dict:
    """Activity as it can actually be evidenced, or an explicit 'not available'."""
    embedded = (raw_data or {}).get("posts")
    posts = dedupe_posts(posts_data, embedded if isinstance(embedded, list) else [])
    own, reposted = split_own_posts(posts, profile.profileUrl)
    available = bool(posts)

    relevant = []
    for post in sorted(own, key=lambda p: (post_date(p) == "", post_date(p)), reverse=True)[:RELEVANT_POSTS_MAX]:
        iso = post_date(post)
        relevant.append({
            "text": (post_text(post) or "")[:POST_SNIPPET_CHARS],
            "posted_at": iso,
            "days_ago": calc_days_ago(iso) if iso else None,
            "url": post_url(post),
        })

    reasons: list[str] = []
    if not available:
        reasons.append("No posts could be read for this profile.")
    else:
        reasons.append(f"{len(posts)} post(s) read — {len(own)} written by them, {len(reposted)} reposted.")
        if score.get("posts_30_days") or score.get("posts_90_days"):
            reasons.append(f"{score['posts_30_days']} post(s) in 30 days, {score['posts_90_days']} in 90 days.")
        if profile.activity:
            reasons.append(profile.activity)
        if score.get("engagement_label") and score["engagement_label"] != "No data":
            reasons.append(f"Engagement: {score['engagement_label']} (avg {score.get('avg_likes', 0)} likes, "
                           f"{score.get('avg_comments', 0)} comments).")
    for name, keyword in (score.get("signal_hits") or {}).items():
        reasons.append(f'Hiring/growth signal — {name}: "{keyword}".')

    level = "none"
    max_activity = max(1, int(score.get("max_activity") or 1))
    share = (score.get("score_activity") or 0) / max_activity
    if available:
        level = "high" if share >= 0.75 else "medium" if share >= 0.4 else "low"

    return {
        "activity_score": score.get("score_activity", 0),
        "activity_max": score.get("max_activity", 0),
        "activity_level": level,
        "activity_data_available": available,
        "relevant_posts": relevant,
        "matched_keywords": sorted({kw for kw in (score.get("signal_hits") or {}).values() if kw}),
        "activity_reasons": reasons,
        "posts_analyzed": score.get("posts_analyzed", 0),
        "posts_30_days": score.get("posts_30_days", 0),
        "posts_90_days": score.get("posts_90_days", 0),
        "data_source": score.get("data_source", "form"),
    }
