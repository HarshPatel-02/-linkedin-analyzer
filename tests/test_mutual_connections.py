"""Mutual connections are no longer part of the Activity score.

The count could only be read from the LinkedIn page - Apify scrapes as a different
account, so its "mutual" figure is shared with that account, not with the user - and
reading the page is what the extension stopped doing. The factor is gone, and so is
the "at least N mutual connections" requirement, whose only rule was this count:
left behind with every count now 0, it would have capped every score at 39.
"""
import json

from services import scoring_service as sc
from services.scoring_service import compute_score
from models import ProfileData


def score(**fields):
    return compute_score(ProfileData(name="X", **fields), {}, [])


def test_the_factor_is_not_scored_or_reported():
    result = score()
    assert "score_mutuals" not in result and "max_mutuals" not in result
    assert "mutual_connections" not in sc.get_activity_points()


def test_the_five_remaining_factors_share_the_100():
    """Its 10 points went to Hiring/Growth Signals, so the rows add up to the score."""
    assert sum(sc.get_activity_points().values()) == 100
    assert sc.get_activity_points()["signals"] == 20
    assert score()["score_max"] == 100


def test_an_old_points_file_with_a_mutual_entry_is_ignored(isolated_config):
    (isolated_config / "activity_points.json").write_text(
        json.dumps({"recent_activity": 30, "mutual_connections": 10}), encoding="utf-8")
    assert "mutual_connections" not in sc.get_activity_points()
    assert score()["score_max"] == 30 + 20 + 20 + 10 + 20     # saved 30 kept, the rest defaults


def test_an_old_requirement_file_no_longer_caps_anyone(isolated_config, ago):
    (isolated_config / "activity_rules.json").write_text(json.dumps({"mutual_min": 1}), encoding="utf-8")
    posts = [{"text": f"post {i}", "postedAt": ago(i + 1),
              "numLikes": 12, "numComments": 6, "numShares": 3} for i in range(10)]
    result = compute_score(ProfileData(name="X", position="Founder", about="a", experience="x",
                                       current_company="Acme", avatar="a.png"), {"name": "X"}, posts)
    assert result["score_total"] > 39
    assert "failed_required" not in result
