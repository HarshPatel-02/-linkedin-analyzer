import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Set BEFORE main.py runs load_dotenv(): dotenv never overrides an existing
# variable, so the real .env keys can't leak into tests (no network calls).
SECRET_VARS = ("GROQ_API_KEY", "GROQ_MODEL", "OPENROUTER_API_KEY", "OPENROUTER_MODEL", "APIFY_API_TOKEN",
               "APIFY_ACTOR_ID", "APIFY_POSTS_ACTOR_ID", "APIFY_COMPANY_ACTOR_ID")
for _var in SECRET_VARS:
    os.environ[_var] = ""

from services import ai_service, icp_service, scoring_service  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    """Every test gets default keywords/points and writes only to tmp_path — never the repo's JSON files."""
    for var in SECRET_VARS:
        monkeypatch.setenv(var, "")
    monkeypatch.setattr(icp_service, "ICP_CONFIG_FILE", str(tmp_path / "icp_config.json"))
    monkeypatch.setattr(scoring_service, "ACTIVITY_POINTS_FILE", str(tmp_path / "activity_points.json"))
    monkeypatch.setattr(scoring_service, "ACTIVITY_KEYWORDS_FILE", str(tmp_path / "activity_keywords.json"))
    monkeypatch.setattr(ai_service, "PITCH_CONFIG_FILE", str(tmp_path / "pitch_config.json"))
    ai_service._exhausted.clear()
    ai_service._posts_cache.clear()
    icp_service.apply_icp_config(icp_service.get_icp_config())
    yield tmp_path
    icp_service.apply_icp_config(icp_service.get_icp_config())


def days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


@pytest.fixture
def ago():
    return days_ago
