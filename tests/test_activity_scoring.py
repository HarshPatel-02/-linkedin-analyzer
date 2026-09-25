import pytest

from models import ProfileData
from services import scoring_service as sc
from services.scoring_service import _num, compute_score, dedupe_posts


def profile(**kw) -> ProfileData:
    return ProfileData(**kw)


def score(prof=None, raw=None, posts=None) -> dict:
    return compute_score(prof or profile(), raw if raw is not None else {}, posts if posts is not None else [])


# ─── Duplicates + number parsing ──────────────────────────────────────────────
def test_dedupe_by_url_and_by_text(ago):
    a = {"url": "https://www.linkedin.com/posts/p1?utm=x", "text": "Hello world post", "postedAt": ago(2)}
    b = {"url": "https://www.linkedin.com/posts/p1/", "text": "Hello world post"}
    c = {"text": "Same text, no id", "postedAt": ago(5)}
    d = {"text": "Same   text, no id", "postedAt": ago(5)}
    e = {"text": "A different post", "postedAt": ago(5)}
    assert len(dedupe_posts([a, c], [b, d, e, None, "junk"])) == 3
    assert dedupe_posts(None, None) == []


@pytest.mark.parametrize("value, expected", [
    (12, 12.0), (12.5, 12.5), ("1,234", 1234.0), ("1.2K", 1200.0), ("3M", 3_000_000.0), ("500+", 500.0),
    ({"count": 5}, 5.0), ({"like": 3, "love": 2}, 5.0), ([1, 2, 3], 3.0),
    (True, None), (None, None), ("abc", None), ({}, None),
])
def test_num_parses_every_actor_shape(value, expected):
    assert _num(value) == expected


# ─── Recent activity ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("days, points", [(3, 30), (20, 20), (60, 10), (200, 0)])
def test_recency_from_newest_post(ago, days, points):
    posts = [{"text": "older", "postedAt": ago(300)}, {"text": "newest", "postedAt": ago(days)}]
    assert score(posts=posts)["score_activity"] == points


def test_recency_from_form_when_no_dated_posts():
    assert score(profile(activity="Posted 2 weeks ago"))["score_activity"] == 20
    assert score(profile(activity="3d"))["score_activity"] == 30
    assert score(profile(activity=""))["score_activity"] == 0


def test_raw_profile_posts_count_for_recency(ago):
    result = score(raw={"name": "X", "posts": [{"text": "from the profile actor", "postedAt": ago(2)}]})
    assert result["score_activity"] == 30
    assert result["posts_analyzed"] == 1 and result["data_source"] == "apify"


def test_none_inputs_do_not_crash():
    result = compute_score(profile(), None, None)
    assert result["score_total"] == 0 and result["data_source"] == "form" and result["posts_analyzed"] == 0


# ─── Posting frequency: the last 90 days — 10+ = 20 · 5-9 = 15 · 1-4 = 10 ──────
@pytest.mark.parametrize("n90, points", [(0, 0), (1, 10), (4, 10), (5, 15), (9, 15), (10, 20), (30, 20)])
def test_posting_frequency_tiers(n90, points):
    assert score(profile(posts_90_days=n90))["score_posts"] == points


def test_posts_in_the_last_30_days_count_toward_the_90_day_window():
    result = score(profile(posts_30_days=6))
    assert result["posts_90_days"] == 6 and result["score_posts"] == 15


def test_post_counts_from_dated_posts(ago):
    posts = [{"text": f"p{i}", "postedAt": ago(i * 10 + 1)} for i in range(6)]   # 1, 11, 21, 31, 41, 51 days
    result = score(posts=posts)
    assert result["posts_30_days"] == 3 and result["posts_90_days"] == 6
    assert result["score_posts"] == 15 and result["max_posts"] == 20


# ─── Engagement: High = 20 · Medium = 10 · Low = 5 · none = 0 ─────────────────
@pytest.mark.parametrize("likes, comments, reposts, points, label", [
    (0, 0, 0, 0, "No data"),
    (3, 0, 0, 5, "Low (form)"),          # one weak signal
    (0, 0, 1, 5, "Low (form)"),
    (3, 2, 0, 10, "Medium (form)"),      # two weak signals
    (10, 0, 0, 10, "Medium (form)"),     # one strong signal
    (0, 5, 0, 10, "Medium (form)"),
    (10, 5, 0, 20, "High (form)"),       # two strong signals
    (10, 5, 3, 20, "High (form)"),
])
def test_engagement_from_form(likes, comments, reposts, points, label):
    result = score(profile(avg_likes=likes, avg_comments=comments, avg_reposts=reposts))
    assert result["score_engagement"] == points and result["engagement_label"] == label


def test_engagement_from_posts_ignores_posts_without_counts(ago):
    posts = [
        {"url": "u1", "numLikes": 20, "numComments": 6, "numShares": 4, "postedAt": ago(1)},
        {"url": "u2", "engagement": {"likes": "1.2K", "comments": 4, "shares": 0}, "postedAt": ago(2)},
        {"url": "u3", "text": "no engagement fields at all", "postedAt": ago(3)},
    ]
    result = score(profile(avg_likes=0), posts=posts)
    assert result["avg_likes"] == 610.0 and result["avg_comments"] == 5.0 and result["avg_reposts"] == 2.0
    assert result["score_engagement"] == 20 and result["max_engagement"] == 20
    assert result["engagement_label"] == "High"


# ─── Completeness, mutuals, signals ───────────────────────────────────────────
def test_completeness_missing_parts():
    result = score(profile(headline="Founder", about="We build things", experience="",
                           current_company="Not specified", avatar=""))
    assert result["completeness_missing"] == ["photo", "experience", "company"]
    assert result["score_completeness"] == 4


def test_completeness_full():
    result = score(profile(position="CEO", about="a", experience="CEO @ X",
                           current_company="Acme Health", avatar="img.png"))
    assert result["completeness_missing"] == [] and result["score_completeness"] == 10


@pytest.mark.parametrize("mutuals, points", [(0, 0), (1, 2), (4, 2), (5, 5), (9, 5), (10, 7), (19, 7), (20, 10), (99, 10)])
def test_mutual_connection_tiers(mutuals, points):
    assert score(profile(mutual_connections=mutuals))["score_mutuals"] == points


def test_signal_hits_whole_words():
    result = score(profile(about="We're hiring engineers after our Series A!"))
    assert result["signal_hits"] == {"hiring": "hiring", "growth": "series a"}   # first keyword in list order
    assert result["score_signals"] == 7


def test_job_seeking_is_not_a_signal():
    assert "looking for" not in " ".join(sc.DEFAULT_SIGNAL_KEYWORDS["job"])
    result = score(profile(about="Open to work — looking for opportunities"))
    assert result["signal_hits"] == {} and result["score_signals"] == 0


def test_recent_promotion_is_the_middle_signal():
    result = score(profile(about="Excited to announce my new role as VP of Sales!"))
    assert result["signal_hits"] == {"job": "excited to announce"}
    assert result["score_signals"] == 3


def test_signals_scan_only_the_five_newest_posts(ago):
    old = {"text": "We just closed our Series B", "postedAt": ago(80)}
    newer = [{"text": f"update number {i}", "postedAt": ago(i + 1)} for i in range(5)]
    assert score(posts=[old] + newer)["signal_hits"] == {}
    newest = {"text": "We just closed our Series B", "postedAt": ago(0.2)}
    assert score(posts=[old] + newer[:4] + [newest])["signal_hits"] == {"growth": "series b"}


def test_custom_signal_keywords_are_used():
    sc.save_signal_keywords({"hiring": ["join us"]})
    result = score(profile(headline="Come join us at Acme"))
    assert result["signal_hits"] == {"hiring": "join us"}


# ─── Totals + custom points ───────────────────────────────────────────────────
def test_total_and_label(ago):
    posts = [{"url": f"u{i}", "text": f"post {i}", "postedAt": ago(i * 3 + 1),
              "numLikes": 12, "numComments": 6, "numShares": 3} for i in range(10)]
    prof = profile(position="Founder", about="We're hiring", experience="Founder @ X",
                   current_company="Acme", avatar="a.png", mutual_connections=25)
    result = score(prof, raw={"name": "X"}, posts=posts)
    # 30 + 20 + 20 + 10 + 5 (hiring only) + 10 = 95
    assert result["score_total"] == 95
    assert result["score_label"].endswith("Ready to Engage")
    assert result["posts_analyzed"] == 10


def test_custom_points_scale_to_100(ago):
    sc.save_activity_points({"recent_activity": 50})
    result = score(posts=[{"text": "hi", "postedAt": ago(1)}])
    assert result["score_activity"] == 50 and result["max_activity"] == 50
    assert result["score_max"] == 120
    assert result["score_raw"] == 50 + 10   # + one post in the 90-day window (half of 20)
    assert result["score_total"] == 50      # 60 / 120


def test_reset_points_restores_defaults():
    sc.save_activity_points({"signals": 40})
    assert sc.get_activity_points()["signals"] == 40
    sc.save_activity_points({"reset": True})
    assert sc.get_activity_points() == sc.DEFAULT_ACTIVITY_POINTS


# ─── Post ownership: reposts of other people's posts ─────────────────────────
from services.actor_service import map_apify_to_profile                       # noqa: E402
from services.scoring_service import post_author_slug, profile_slug, split_own_posts  # noqa: E402

URL = "https://www.linkedin.com/in/jane-doe/"


def repost(posted_at, author="someone-else"):
    """A feed item written by someone else — the shape the posts actor returns for a repost."""
    return {"id": "r1", "content": "We raised a Series B!", "postedAt": posted_at,
            "author": {"publicIdentifier": author,
                       "linkedinUrl": f"https://www.linkedin.com/in/{author}?miniProfileUrn=x"},
            "engagement": {"likes": 900, "comments": 300, "shares": 50}}


def test_profile_and_author_slugs():
    assert profile_slug(URL) == "jane-doe"
    assert profile_slug("https://www.linkedin.com/in/Jane-Doe?utm=1") == "jane-doe"
    assert profile_slug("jane-doe") == "jane-doe"
    assert profile_slug("") == ""
    assert post_author_slug({"author": {"publicIdentifier": "Jane-Doe"}}) == "jane-doe"
    assert post_author_slug({"author": {"linkedinUrl": "https://www.linkedin.com/in/jane-doe?mini=1"}}) == "jane-doe"
    assert post_author_slug({"text": "no author info"}) == ""


def test_split_keeps_authorless_and_own_posts(ago):
    own = {"text": "mine", "postedAt": ago(1), "author": {"publicIdentifier": "jane-doe"}}
    unknown = {"text": "no author info", "postedAt": ago(2)}
    other = repost(ago(0.5))
    o, r = split_own_posts([own, unknown, other], URL)
    assert o == [own, unknown] and r == [other]
    o2, r2 = split_own_posts([other], "")    # unknown profile URL → nothing is discarded
    assert o2 == [other] and r2 == []


def test_repost_counts_as_activity_but_not_engagement_or_signals(ago):
    prof = profile(profileUrl=URL)
    posts = [repost(ago(1)),
             {"text": "my own post", "postedAt": ago(40), "url": "https://p/own",
              "author": {"publicIdentifier": "jane-doe"},
              "engagement": {"likes": 4, "comments": 1, "shares": 0}}]
    result = compute_score(prof, {}, posts)
    assert result["score_activity"] == 30      # the repost IS recent activity…
    assert result["posts_30_days"] == 1
    assert result["avg_likes"] == 4.0          # …but its 900 likes are the original author's
    assert result["signal_hits"] == {}         # "Series B" is the original author's news


def test_display_never_shows_someone_elses_post_as_last_posted(ago):
    own_date = ago(3)
    posts = [repost(ago(0.5)),
             {"text": "My clinic hiring story", "postedAt": own_date,
              "author": {"publicIdentifier": "jane-doe"}, "url": "https://p/own"}]
    prof = map_apify_to_profile({"name": "Jane Doe"}, URL, posts)
    assert prof.activity.startswith("Last posted 3 days ago")
    assert "Series B" not in prof.activity
    assert prof.activity_url == "https://p/own"
    assert prof.activity_date == own_date      # the extension re-renders "X ago" from this


def test_display_labels_a_repost_when_it_is_the_only_activity(ago):
    repost_date = ago(2)
    prof = map_apify_to_profile({"name": "Jane Doe"}, URL, [repost(repost_date)])
    assert prof.activity == "Reposted someone else's post 2 days ago"
    assert "Series B" not in prof.activity
    assert prof.activity_date == repost_date


def test_no_posts_leaves_activity_date_empty():
    prof = map_apify_to_profile({"name": "Jane Doe"}, URL, [])
    assert prof.activity == "No recent activity" and prof.activity_date == ""
