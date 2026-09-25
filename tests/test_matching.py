import math
from fractions import Fraction

import pytest

from services.matching import (all_matches, employee_count_range, expand_location, find_phrase, first_match,
                               normalize, parse_size_range, pts)


def test_normalize_dashes_quotes_and_spaces():
    assert normalize("We’re  Hiring – Now !") == "we're hiring - now !"
    assert normalize(None) == ""


@pytest.mark.parametrize("kw, text, plural, hit", [
    ("cto", "Director of Engineering", False, False),
    ("cto", "CTO at Acme", False, True),
    ("cto", "Managing Director", False, False),
    ("health care", "Healthcare IT", True, True),
    ("health care", "health-care services", True, True),
    ("co-founder", "Cofounder & CEO", False, True),
    ("co founder", "Co-Founder, Acme", False, True),
    ("1-10", "501-1000 employees", False, False),
    ("1-10", "1-10 employees", False, True),
    ("11-50", "1150 staff", False, False),
    ("11-50", "11 to 50 people", False, True),
    ("hospital", "Hospitals and Health Care", True, True),
    ("hospital", "Hospitality management", True, False),
    ("we're hiring", "We’re hiring engineers!", True, True),
    ("c++", "Senior C++ developer", True, True),
])
def test_find_phrase_is_whole_word(kw, text, plural, hit):
    assert bool(find_phrase(kw, text, plural=plural)) is hit


def test_first_match_returns_original_spelling_and_honours_reject():
    assert first_match(["CEO", "Founder"], "founder & ceo") == "CEO"
    reject_all_ceo = lambda norm, m: m.group(0) == "ceo"
    assert first_match(["CEO", "Founder"], "founder & ceo", reject=reject_all_ceo) == "Founder"
    assert first_match([], "anything") is None
    assert first_match(["x"], "") is None


def test_all_matches_distinct_in_list_order():
    kws = ["Telehealth platform", "AI platform", "ai platform", "Remote monitoring"]
    assert all_matches(kws, "Remote monitoring + AI platform for telehealth platforms") == [
        "Telehealth platform", "AI platform", "Remote monitoring"]


@pytest.mark.parametrize("kw, expected", [
    ("1-10", (1, 10)),
    ("2 to 10", (2, 10)),
    ("11 - 50", (11, 50)),
    ("1,001-5,000", (1001, 5000)),
    ("5000+", (5000, math.inf)),
    ("10k+", (10000, math.inf)),
    ("10,001+", (10001, math.inf)),
    ("51-200 employees", (51, 200)),
    ("self-employed", None),
    ("", None),
])
def test_parse_size_range(kw, expected):
    assert parse_size_range(kw) == expected


@pytest.mark.parametrize("value, expected", [
    (30, (30, 30)),
    ("250", (250, 250)),
    ("11-50", (11, 50)),
    ("11-50 employees", (11, 50)),
    ("5000+", (5000, math.inf)),
    (0, None), ("0", None), (None, None), (True, None), ("", None), ("unknown", None),
])
def test_employee_count_range(value, expected):
    assert employee_count_range(value) == expected


def test_expand_location_aliases():
    assert "india" in expand_location("Greater Mumbai Area")
    assert "uae" in expand_location("Dubai, United Arab Emirates")
    assert "united states" in expand_location("San Francisco Bay Area")


@pytest.mark.parametrize("location, keyword", [
    ("Kyiv, Ukraine", "uk"),
    ("Indianapolis, Indiana, United States", "india"),
    ("Business Bay, Dubai", "us"),
    ("São Paulo, Latin America", "usa"),
])
def test_expand_location_never_matches_inside_words(location, keyword):
    assert first_match([keyword], expand_location(location), plural=False) is None


def test_expand_location_empty():
    assert expand_location("") == ""


@pytest.mark.parametrize("max_points, fraction, expected", [
    (5, Fraction(1, 2), 3),       # 2.5 → 3 (half-up, like JS Math.round)
    (15, Fraction(3, 10), 5),     # 4.5 → 5
    (10, Fraction(3, 10), 3),
    (30, Fraction(1, 6), 5),
    (15, Fraction(2, 3), 10),
    (0, Fraction(1), 0),
])
def test_pts_rounds_half_up(max_points, fraction, expected):
    assert pts(max_points, fraction) == expected


# ─── Review regressions ───────────────────────────────────────────────────────
@pytest.mark.parametrize("location, country, other", [
    ("Hyderabad, Sindh, Pakistan", None, "india"),
    ("London, Ontario, Canada", None, "uk"),
    ("Sydney, New South Wales, Australia", "australia", "uk"),
    ("Cardiff, Wales, United Kingdom", "uk", "india"),
    ("Greater Mumbai Area", "india", "uk"),
    ("San Francisco Bay Area", "usa", "uk"),
    ("Buenos Aires, Argentina, Latin America", None, "usa"),
])
def test_named_country_decides_over_city_aliases(location, country, other):
    expanded = expand_location(location)
    if country:
        assert find_phrase(country, expanded, plural=False)
    assert not find_phrase(other, expanded, plural=False)


def test_single_letter_keywords_take_no_plural():
    assert not find_phrase("series a", "a new series as well")
    assert find_phrase("series a", "we closed our Series A")
    assert find_phrase("clinic", "for small clinics")
