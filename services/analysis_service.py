"""One analysis per profile — the single result the extension and admin both show.

Both clients call this and display what comes back; neither recomputes anything.
The ICP and Activity scores are deterministic (administrator rules in
icp_config.json / activity_points.json), so the same profile and the same
configuration always produce the same numbers. AI is used elsewhere, for wording
messages — never to produce these scores.

Unavailable data is reported as unavailable: a profile with no readable posts
returns activity_data_available = false rather than a zero dressed up as a score.
"""
from __future__ import annotations

from datetime import datetime, timezone

from models import ProfileData
from services.icp_service import calculate_icp, icp_config_version, icp_matches
from services.scoring_service import (calc_days_ago, compute_score, dedupe_posts, get_activity_points,
                                      post_date, post_text, split_own_posts)

# Share of the overall score. Editable per deployment; the extension and the admin
# panel both read the value back from the response rather than assuming it.
OVERALL_WEIGHTS = {"icp": 0.5, "activity": 0.5}

# An ICP/Activity score at or above this counts as a match for the tick marks.
MATCH_THRESHOLDS = {"icp": 60, "activity": 50}

RELEVANT_POSTS_MAX = 5


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _icp_reasons(breakdown: dict) -> list[str]:
    """Why the ICP score is what it is, one line per category that has data."""
    reasons = []
    for category, row in breakdown.items():
        reason = str(row.get("reason") or "")
        if not reason or reason == "No data":
            continue
        if row.get("score"):
            reasons.append(f"{category}: {reason} (+{row['score']})")
        else:
            reasons.append(f"{category}: no match ({reason})")
    return reasons


def activity_block(profile: ProfileData, raw_data: dict, posts_data: list, score: dict) -> dict:
    """Activity as it can actually be evidenced, or an explicit 'not available'."""
    posts = dedupe_posts(posts_data, (raw_data or {}).get("posts") if isinstance((raw_data or {}).get("posts"), list) else [])
    own, reposted = split_own_posts(posts, profile.profileUrl)
    available = bool(posts)

    relevant = []
    for post in sorted(own, key=lambda p: (post_date(p) == "", post_date(p)), reverse=True)[:RELEVANT_POSTS_MAX]:
        iso = post_date(post)
        relevant.append({
            "text": (post_text(post) or "")[:280],
            "posted_at": iso,
            "days_ago": calc_days_ago(iso) if iso else None,
            "url": post.get("url") or post.get("linkedinUrl") or post.get("postUrl") or "",
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
    max_activity = max(1, int(score.get("max_activity") or 30))
    share = (score.get("score_activity") or 0) / max_activity
    if available:
        level = "high" if share >= 0.75 else "medium" if share >= 0.4 else "low"

    return {
        "activity_score": score.get("score_activity", 0),
        "activity_max": score.get("max_activity", 30),
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


def analyze_profile(profile: ProfileData, raw_data: dict | None, posts_data: list | None,
                    icp_input: dict | None = None) -> dict:
    """The one analysis both clients render. Deterministic; no AI involved."""
    raw_data = raw_data or {}
    posts_data = posts_data or []

    activity = compute_score(profile, raw_data, posts_data)
    icp_profile = dict(icp_input or {})
    for key, value in profile.model_dump().items():
        icp_profile.setdefault(key, value)
    icp = calculate_icp(icp_profile)
    matches = icp_matches(icp_profile)

    icp_score = int(icp["icp_score"])
    activity_score_100 = round(100 * (activity["score_total"] or 0) / 100)   # already scaled to 100
    overall = round(OVERALL_WEIGHTS["icp"] * icp_score + OVERALL_WEIGHTS["activity"] * activity_score_100)

    act_block = activity_block(profile, raw_data, posts_data, activity)
    reasons = _icp_reasons(icp["breakdown"]) + act_block["activity_reasons"]

    return {
        "profile_url":  profile.profileUrl,
        "analyzed_at":  _now(),
        "scoring_config_version": icp_config_version(),
        "scoring_weights": dict(OVERALL_WEIGHTS),
        "match_thresholds": dict(MATCH_THRESHOLDS),

        "icp_score":      icp_score,
        "activity_score": activity_score_100,
        "overall_score":  overall,
        "icp_match":      icp_score >= MATCH_THRESHOLDS["icp"],
        "activity_match": activity_score_100 >= MATCH_THRESHOLDS["activity"],

        **matches,
        "score_reasons":  reasons,
        "icp_breakdown":  icp["breakdown"],
        "icp_missing":    icp["missing"],
        "activity":       act_block,
        # The full activity breakdown, so the admin can show the same bars the extension does.
        "activity_breakdown": {k: activity[k] for k in (
            "score_activity", "score_posts", "score_engagement", "score_completeness",
            "score_signals", "score_mutuals", "max_activity", "max_posts", "max_engagement",
            "max_completeness", "max_signals", "max_mutuals", "score_label", "engagement_label",
            "completeness_missing", "signal_hits") if k in activity},
        "activity_points": get_activity_points(),
    }
