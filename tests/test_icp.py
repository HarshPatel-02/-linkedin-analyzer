import pytest

from services import icp_service as icp
from services.icp_service import (calculate_icp, score_company_size, score_geography, score_industry,
                                  score_job_title, score_keywords)

CATEGORIES = ["Industry Match", "Job Title Match", "Company Size Match", "Geography Match", "Profile Keywords"]


# ─── Job titles ───────────────────────────────────────────────────────────────
@pytest.mark.parametrize("position", [
    "Director of Engineering",          # "cto" is inside "direCTOr"
    "Executive Assistant to the CEO",
    "EA to CEO | Operations",
    "Chief of Staff, Office of the CEO",
    "Ex-CEO, now angel investor",
    "Former Founder of Acme",
    "Aspiring founder",
    "Product Owner at Acme Health",     # "owner" is a Tier 1 keyword
    "Helping CEOs scale clinics",       # plural never counts for titles
])
def test_titles_that_are_not_the_role(position):
    assert score_job_title(position) == (0, "Other")


@pytest.mark.parametrize("position, points, reason", [
    ("Co-Founder & CEO at Acme Health", 25, "Tier 1 (founder)"),
    ("Owner, Smile Dental Clinic", 25, "Tier 1 (owner)"),
    ("Medical Director", 20, "Tier 2 (medical director)"),
    ("Managing Director, Acme", 15, "Tier 3 (managing director)"),   # used to hit Tier 2 via "cto"
    ("CTO", 20, "Tier 2 (cto)"),
    ("Head of Sales, reporting to the CEO | Co-founder at Side Project", 25, "Tier 1 (founder)"),
])
def test_titles_that_match(position, points, reason):
    assert score_job_title(position) == (points, reason)


def test_title_falls_back_to_headline():
    assert score_job_title("Senior Engineer", "Founder at Acme | Builder") == (25, "Tier 1 (founder) — from headline")
    assert score_job_title("", "CEO of Acme") == (25, "Tier 1 (ceo) — from headline")


def test_title_position_wins_over_headline():
    assert score_job_title("Medical Director", "Founder of a podcast") == (20, "Tier 2 (medical director)")


@pytest.mark.parametrize("position, headline", [("", ""), ("Not specified", ""), (None, None)])
def test_title_no_data(position, headline):
    assert score_job_title(position, headline) == (0, "No data")


# ─── Company size ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("count, points, reason", [
    (5, 15, "Exact (1-10)"),
    (1, 15, "Exact (1-10)"),
    (30, 8, "Nearby (11-50)"),
    (750, 8, "Nearby (501-1000)"),
    ("11-50", 8, "Nearby (11-50)"),
    (20000, 0, "Other"),
])
def test_company_size_from_head_count(count, points, reason):
    assert score_company_size("", count) == (points, reason)


def test_company_size_text_is_digit_safe():
    # "501-1000" used to match the exact keyword "1-10"
    assert score_company_size("Acme Health · 501-1000 employees") == (8, "Nearby (501-1000)")
    assert score_company_size("Freelance UX designer") == (15, "Exact (freelance)")
    assert score_company_size("Acme Health") == (0, "Other")


def test_company_size_no_data():
    assert score_company_size("", None) == (0, "No data")
    assert score_company_size("Not specified", "") == (0, "No data")


def test_company_size_with_spaced_user_ranges():
    icp.apply_icp_config({**icp.get_icp_config(),
                          "EXACT_COMPANY_SIZE_KEYWORDS": ["11 - 50"],
                          "NEARBY_COMPANY_SIZE_KEYWORDS": ["51-70", "1-50"]})
    assert score_company_size("", 30) == (15, "Exact (11 - 50)")
    assert score_company_size("", 60) == (8, "Nearby (51-70)")
    assert score_company_size("", 5) == (8, "Nearby (1-50)")


def test_one_person_company_counts_as_self_employed():
    icp.apply_icp_config({**icp.get_icp_config(), "EXACT_COMPANY_SIZE_KEYWORDS": ["self-employed"]})
    assert score_company_size("", 1) == (15, "Exact (self-employed)")


# ─── Geography ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("location, result", [
    ("Greater Mumbai Area", (5, "Secondary (india)")),
    ("Dubai, United Arab Emirates", (10, "Primary (uae)")),
    ("Austin, Texas, United States", (10, "Primary (usa)")),
    ("London, England, United Kingdom", (5, "Secondary (uk)")),
    ("Kyiv, Ukraine", (0, "Other")),
    ("Indianapolis, Indiana", (0, "Other")),
    ("", (0, "No data")),
])
def test_geography(location, result):
    assert score_geography(location) == result


# ─── Industry ─────────────────────────────────────────────────────────────────
def test_industry_field_is_matched_first():
    assert score_industry("volunteered at a hospital", "Medical Practices") == (25, "Related (medical practices)")
    assert score_industry("", "Hospitals and Health Care") == (35, "Exact match (hospitals and health)")


def test_industry_text_fallback_and_no_false_prefix():
    assert score_industry("We run a hospital network") == (35, "Exact match (hospital)")
    assert score_industry("Hospitality management") == (0, "Other")
    assert score_industry("", "") == (0, "No data")


# ─── ICP keywords ─────────────────────────────────────────────────────────────
def test_keyword_reasons_and_tiers():
    assert score_keywords("We build a Telehealth platform") == (5, "1 match: Telehealth platform")
    assert score_keywords("Telehealth platform with Remote monitoring") == (
        5, "2 matches: Telehealth platform, Remote monitoring")
    three = "AI platform, Telehealth platform, Remote monitoring"
    assert score_keywords(three) == (10, "3 matches: AI platform, Telehealth platform, Remote monitoring")
    five = three + ", Patient engagement, Care coordination"
    points, reason = score_keywords(five)
    assert points == 15 and reason.startswith("5 matches: ") and reason.endswith("…")
    assert score_keywords("") == (0, "No data")
    assert score_keywords("nothing relevant") == (0, "Other")


def test_keyword_points_round_half_up_with_custom_points():
    cfg = icp.get_icp_config()
    cfg["POINTS"]["ALL_ICP_KEYWORDS"] = 10
    icp.apply_icp_config(cfg)
    assert score_keywords("AI platform")[0] == 3            # 3.33 → 3
    assert score_keywords("AI platform, Remote monitoring, Care coordination")[0] == 7   # 6.67 → 7


# ─── calculate_icp ────────────────────────────────────────────────────────────
def test_calculate_icp_full_profile():
    result = calculate_icp({
        "position": "Founder & CEO",
        "headline": "Building a Telehealth platform",
        "country": "Dubai, United Arab Emirates",
        "about": "We run a hospital network with Remote monitoring",
        "current_company_name": "Acme Health",
        "current_company_employee_count": "8",
        "industry": "Hospitals and Health Care",
    })
    b = result["breakdown"]
    assert list(b) == CATEGORIES
    assert b["Industry Match"]["score"] == 35
    assert b["Job Title Match"]["score"] == 25
    assert b["Company Size Match"]["score"] == 15
    assert b["Geography Match"]["score"] == 10
    assert b["Profile Keywords"] == {"score": 5, "max": 15, "reason": "2 matches: Telehealth platform, Remote monitoring"}
    assert result["score_raw"] == 90 and result["score_max"] == 100 and result["icp_score"] == 90
    assert result["missing"] == [] and result["coverage"] == {"with_data": 5, "total": 5}


def test_calculate_icp_empty_profile_reports_missing_data():
    result = calculate_icp({})
    assert result["icp_score"] == 0
    assert result["missing"] == CATEGORIES
    assert result["coverage"] == {"with_data": 0, "total": 5}


def test_calculate_icp_not_specified_is_missing():
    result = calculate_icp({"position": "Founder", "country": "Not specified", "current_company": "Not specified"})
    assert "Geography Match" in result["missing"]
    assert result["breakdown"]["Job Title Match"]["score"] == 25


def test_calculate_icp_scales_to_100_with_custom_points():
    cfg = icp.get_icp_config()
    cfg["POINTS"]["TIER_1_TITLES"] = 50     # max total becomes 125
    icp.apply_icp_config(cfg)
    result = calculate_icp({"position": "Founder"})
    assert result["score_max"] == 125 and result["score_raw"] == 50
    assert result["icp_score"] == 40


def test_save_icp_config_roundtrip(isolated_config):
    saved = icp.save_icp_config({"TIER_1_TITLES": "founder\nowner", "POINTS": {"TIER_1_TITLES": 30}})
    assert saved["TIER_1_TITLES"] == ["founder", "owner"]
    assert icp.get_icp_config()["POINTS"]["TIER_1_TITLES"] == 30
    assert (isolated_config / "icp_config.json").exists()
    assert score_job_title("Owner")[0] == 30
