"""A post whose date cannot be read is not evidence of posting recently.

The 90-day window used to fall back to "every undated post counts", which scored a
profile with twelve undated posts 20/20 while twelve posts known to be two years old
scored 0/20 — the less the scraper could tell us, the better somebody did.
"""
import pytest

from models import ProfileData
from services.scoring_service import compute_score

PROFILE = ProfileData(profileUrl="https://www.linkedin.com/in/x/", name="X", position="Founder",
                      headline="Founder at Acme", avatar="a.png", current_company="Acme")


def dated(n, iso):
    return [{"text": f"post {i}", "postedAt": iso} for i in range(n)]


def undated(n):
    return [{"text": f"post {i}"} for i in range(n)]


def score(posts, **profile_fields):
    profile = PROFILE.model_copy(update=profile_fields) if profile_fields else PROFILE
    return compute_score(profile, {}, posts)


def test_undated_posts_earn_nothing_however_many_there_are():
    s = score(undated(12))
    assert s["posts_90_days"] == 0
    assert s["posts_30_days"] == 0
    assert s["posts_undated"] == 12
    assert s["score_posts"] == 0


def test_an_undated_post_never_scores_better_than_a_post_known_to_be_old(ago):
    old = score(dated(12, ago(730)))["score_posts"]
    assert score(undated(12))["score_posts"] <= old


def test_dated_posts_still_score(ago):
    s = score(dated(12, ago(10)))
    assert s["posts_90_days"] == 12 and s["posts_undated"] == 0
    assert s["score_posts"] == 20


def test_undated_posts_do_not_inflate_the_dated_ones(ago):
    s = score(dated(4, ago(5)) + undated(8))
    assert s["posts_90_days"] == 4        # the four we can date, not twelve
    assert s["posts_undated"] == 8
    assert s["score_posts"] == 10         # 1-9 posts in 90 days = half of 20


@pytest.mark.parametrize("n_90, expected", [(0, 0), (1, 10), (5, 15), (10, 20), (30, 20)])
def test_the_ladder_is_unchanged_for_posts_we_can_date(ago, n_90, expected):
    assert score(dated(n_90, ago(40)))["score_posts"] == expected


def test_a_typed_count_still_fills_in_when_no_posts_could_be_read():
    """The form is the fallback for a profile whose posts Apify could not fetch."""
    s = score([], posts_30_days=2, posts_90_days=6)
    assert s["posts_90_days"] == 6
    assert s["score_posts"] == 15


# ─── A typed count never overrides posts that were actually read ─────────────
# Michael Raviv: 30 posts read, all from 2015, and a 10 left in the form. The panel
# reported "last posted 10 years ago" beside "10 posts in 90 days" and scored 20/20.

def test_a_typed_count_is_ignored_once_posts_have_been_read(ago):
    s = score(dated(30, 3800), posts_30_days=10)
    assert s["posts_90_days"] == 0 and s["posts_30_days"] == 0
    assert s["score_posts"] == 0


def test_recency_and_frequency_cannot_contradict_each_other(ago):
    """Nothing posted in 90 days means nothing posted in 30 either."""
    s = score(dated(30, 3800), posts_30_days=10, posts_90_days=9)
    assert s["score_activity"] == 0          # last post is years old
    assert s["score_posts"] == 0             # so the frequency cannot be full marks


def test_the_form_still_fills_in_when_nothing_could_be_read():
    s = score([], posts_30_days=10)
    assert s["posts_90_days"] == 10
    assert s["score_posts"] == 20
