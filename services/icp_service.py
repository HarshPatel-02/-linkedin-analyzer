import json
import math
import os
import re
from fractions import Fraction
from apify_client import ApifyClient

from services.matching import (normalize, phrase_pattern, first_match, all_matches, parse_size_range,
                               employee_count_range, expand_location, pts)
from services.apify_token import current_apify_token
from services.config_store import read_config, write_config

APIFY_COMPANY_ACTOR_ID = os.getenv("APIFY_COMPANY_ACTOR_ID")

# ─── CONFIG ────────────────────────────────────────────────────────────────────
# The lists below are the DEFAULT ICP keywords.
# They are edited through the "ICP Score" form in the browser extension and
# stored in icp_config.json (created next to main.py on the first save):
#   GET  /icp-config  → current keywords
#   POST /icp-config  → save keywords, used by every score from then on

BASE_DIR        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICP_CONFIG_FILE = os.path.join(BASE_DIR, "icp_config.json")

DEFAULT_ICP_CONFIG = {
    "EXACT_INDUSTRIES": [
        "hospitals and health", "hospital", "health care services","Healthcare","HealthTech"
    ],

    "RELATED_INDUSTRIES": [
        "health, wellness & fitness","healthcare",
    ],

    "TIER_1_TITLES": [
        "founder", "co-founder", "ceo", "owner",
    ],

    "TIER_2_TITLES": [
        "cto", "operation head", "medical director",
    ],

    "TIER_3_TITLES": [
        "product head", "managing director",
    ],

    "EXACT_COMPANY_SIZE_KEYWORDS": [
        "self-employed", "self employed", "freelance", "1-10", "2-10", "2 to 10",
    ],

    "NEARBY_COMPANY_SIZE_KEYWORDS": [
        "11-50", "11 to 50",
        "51-200", "51 to 200",
        "201-500", "201 to 500",
        "501-1000", "501 to 1000",
        "1001-5000", "1001 to 5000",
    ],

    "PRIMARY_GEOGRAPHIES": [
        "usa", "united states", "aus", "australia", "uae",
    ],

    "SECONDARY_GEOGRAPHIES": [
        "uk", "united kingdom", "india",
    ],

    "ALL_ICP_KEYWORDS": [
        "AI platform", "Digital health platform", "Virtual clinic", "Telehealth platform",
        "Health platform", "Care coordination", "Patient engagement", "Remote monitoring",
        "Practice management", "Healthcare SaaS", "AI documentation", "Clinical workflow",
    ],
}

# Points per keyword list (edited next to each list in the ICP form, saved in
# icp_config.json under "POINTS"). A category's max is its best tier; the total
# is scaled to 100, so with the defaults nothing changes.
DEFAULT_ICP_POINTS = {
    "EXACT_INDUSTRIES": 35, "RELATED_INDUSTRIES": 25,
    "TIER_1_TITLES": 25, "TIER_2_TITLES": 20, "TIER_3_TITLES": 15,
    "EXACT_COMPANY_SIZE_KEYWORDS": 15, "NEARBY_COMPANY_SIZE_KEYWORDS": 8,
    "PRIMARY_GEOGRAPHIES": 10, "SECONDARY_GEOGRAPHIES": 5,
    "ALL_ICP_KEYWORDS": 15,
}
ICP_POINTS = dict(DEFAULT_ICP_POINTS)


def _clean_points(values, fallback: dict) -> dict:
    """Whole points 0–100 per known list; missing / invalid keep `fallback`."""
    out = dict(fallback)
    if isinstance(values, dict):
        for key in DEFAULT_ICP_POINTS:
            try:
                if values.get(key) is not None:
                    out[key] = max(0, min(100, int(round(float(values[key])))))
            except (TypeError, ValueError):
                pass
    return out

# Module level lists read by the scoring functions below
EXACT_INDUSTRIES             = list(DEFAULT_ICP_CONFIG["EXACT_INDUSTRIES"])
RELATED_INDUSTRIES           = list(DEFAULT_ICP_CONFIG["RELATED_INDUSTRIES"])
TIER_1_TITLES                = list(DEFAULT_ICP_CONFIG["TIER_1_TITLES"])
TIER_2_TITLES                = list(DEFAULT_ICP_CONFIG["TIER_2_TITLES"])
TIER_3_TITLES                = list(DEFAULT_ICP_CONFIG["TIER_3_TITLES"])
EXACT_COMPANY_SIZE_KEYWORDS  = list(DEFAULT_ICP_CONFIG["EXACT_COMPANY_SIZE_KEYWORDS"])
NEARBY_COMPANY_SIZE_KEYWORDS = list(DEFAULT_ICP_CONFIG["NEARBY_COMPANY_SIZE_KEYWORDS"])
PRIMARY_GEOGRAPHIES          = list(DEFAULT_ICP_CONFIG["PRIMARY_GEOGRAPHIES"])
SECONDARY_GEOGRAPHIES        = list(DEFAULT_ICP_CONFIG["SECONDARY_GEOGRAPHIES"])
ALL_ICP_KEYWORDS             = list(DEFAULT_ICP_CONFIG["ALL_ICP_KEYWORDS"])


def _to_list(value, fallback: list) -> list:
    """Accept a list, or a string split on newlines (or commas) → clean list."""
    if isinstance(value, str):
        value = value.splitlines() if "\n" in value else value.split(",")
    if not isinstance(value, list):
        return list(fallback)
    return [str(v).strip() for v in value if str(v).strip()]


def _merge_icp_config(saved) -> dict:
    """The saved keywords over the defaults; `None` (nothing saved yet) gives the defaults."""
    config = {key: list(defaults) for key, defaults in DEFAULT_ICP_CONFIG.items()}
    config["POINTS"] = dict(DEFAULT_ICP_POINTS)
    if isinstance(saved, dict):
        for key, defaults in DEFAULT_ICP_CONFIG.items():
            if saved.get(key) is not None:
                config[key] = _to_list(saved[key], defaults)
        config["POINTS"] = _clean_points(saved.get("POINTS"), DEFAULT_ICP_POINTS)
        config["DISABLED"] = _disabled_map(saved)
    config.setdefault("DISABLED", {key: [] for key in DEFAULT_ICP_CONFIG})
    return config


def get_icp_config() -> dict:
    """Current keywords: icp_config.json (when present) merged over the defaults."""
    return read_config(ICP_CONFIG_FILE, _merge_icp_config)


def _disabled_map(config: dict) -> dict:
    """{list name: [keywords switched off]} — kept out of scoring but not deleted."""
    raw = config.get("DISABLED") if isinstance(config, dict) else None
    out = {}
    if isinstance(raw, dict):
        for key in DEFAULT_ICP_CONFIG:
            out[key] = _to_list(raw.get(key), [])
    return out


def active_keywords(config: dict, key: str) -> list:
    """The keywords of one list that are switched on."""
    off = {normalize(k) for k in _disabled_map(config).get(key, [])}
    return [k for k in _to_list(config.get(key), DEFAULT_ICP_CONFIG[key]) if normalize(k) not in off]


def apply_icp_config(config: dict) -> dict:
    """Point the module level keyword lists at this config (used when scoring).

    A keyword switched off stays in the saved list but is left out of the lists
    the scorer sees, so turning a rule off never loses what was typed.
    """
    g = globals()
    for key in DEFAULT_ICP_CONFIG:
        g[key] = active_keywords(config, key)
    g["ICP_POINTS"] = _clean_points(config.get("POINTS"), DEFAULT_ICP_POINTS)
    return config


def save_icp_config(config: dict) -> dict:
    """Persist the keywords to icp_config.json and score with them from now on.
    Keys missing from the request keep their previously saved value."""
    current = get_icp_config()
    clean   = {}
    for key in DEFAULT_ICP_CONFIG:
        value = config.get(key) if isinstance(config, dict) else None
        clean[key] = current[key] if value is None else _to_list(value, current[key])
    points = config.get("POINTS") if isinstance(config, dict) else None
    clean["POINTS"] = (dict(DEFAULT_ICP_POINTS) if points == "reset"
                       else _clean_points(points, current["POINTS"]))
    # Switched-off keywords: sent as a whole map, or left out to keep the saved one.
    incoming = config.get("DISABLED") if isinstance(config, dict) else None
    clean["DISABLED"] = (_disabled_map({"DISABLED": incoming}) if isinstance(incoming, dict)
                         else _disabled_map(current))

    # Every save is a new configuration version, so an analysis can record which
    # rules produced it and older results stay traceable.
    clean["version"] = icp_config_version() + 1

    return apply_icp_config(write_config(ICP_CONFIG_FILE, clean))


# Load the saved keywords (if any) as soon as the server starts
apply_icp_config(get_icp_config())

# ─── Scoring Logic ────────────────────────────────────────────────────────────
# Whole-word matching (services/matching.py): "cto" never matches "director",
# "uk" never matches "ukraine", "1-10" never matches inside "501-1000".

# Titles that contain a tier keyword but are not that role ("Product Owner" is not a business owner)
NEGATIVE_TITLE_PHRASES = [
    "product owner", "process owner", "data owner", "business process owner",
    "service owner", "system owner", "content owner", "account owner",
]
# A title preceded by these is about someone else or a past/future role:
# "Assistant to the CEO", "Office of the CEO", "Ex-Founder", "Aspiring founder"
_TITLE_CONTEXT_REJECT = re.compile(
    r"(?:(?<![a-z0-9])(?:executive\s+assistant|assistant|ea|pa|secretary|advisor|adviser|consultant|"
    r"reporting|reports|staff)\s+to(?:\s+the)?"
    r"|(?<![a-z0-9])to(?:\s+the)?"
    r"|(?<![a-z0-9])office\s+of(?:\s+the)?"
    r"|(?<![a-z0-9])(?:ex|former|formerly|aspiring|future|previous|prev))[\s\-.:]*$"
)


def _clean_text(value) -> str:
    s = str(value or "").strip()
    return "" if s.lower() in ("not specified", "unknown", "none") else s


def _reject_title_context(norm: str, match) -> bool:
    return bool(_TITLE_CONTEXT_REJECT.search(norm[:match.start()]))


def _strip_negative_titles(text: str) -> str:
    norm = normalize(text)
    for phrase in NEGATIVE_TITLE_PHRASES:
        pat = phrase_pattern(phrase, True)
        if pat:
            norm = pat.sub(" ", norm)
    return norm


def _tier_title(text: str):
    """(points, tier, keyword) for the best title tier in text, or None."""
    norm = _strip_negative_titles(text)
    if not norm.strip():
        return None
    for key, tier in (("TIER_1_TITLES", 1), ("TIER_2_TITLES", 2), ("TIER_3_TITLES", 3)):
        kw = first_match(globals()[key], norm, plural=False, reject=_reject_title_context)
        if kw:
            return ICP_POINTS[key], tier, kw
    return None


def score_industry(text: str, industry: str = "") -> tuple:
    industry, text = _clean_text(industry), _clean_text(text)
    if not industry and not text:
        return 0, "No data"
    for source in [s for s in (industry, text) if s]:
        kw = first_match(EXACT_INDUSTRIES, source)
        if kw:
            return ICP_POINTS["EXACT_INDUSTRIES"], f"Exact match ({kw})"
        kw = first_match(RELATED_INDUSTRIES, source)
        if kw:
            return ICP_POINTS["RELATED_INDUSTRIES"], f"Related ({kw})"
    return 0, "Other"


# How much of About counts as self-description. People open with their own title
# ("Founder & CEO of Acme"); further down they describe clients and colleagues,
# whose titles are not theirs.
ABOUT_TITLE_CHARS = 200
# "we help founders", "advisor to CEOs" - somebody else's title, not this person's.
_ABOUT_TITLE_REJECT = re.compile(
    r"(?:help(?:s|ing)?|work(?:s|ing)?\s+with|serv(?:e|es|ing)|support(?:s|ing)?|advis(?:e|es|or|ing)|"
    r"coach(?:es|ing)?|recruit(?:s|ing)?|hire(?:s|d)?|partner(?:s|ing)?\s+with|for)\s+[\w\s,&-]{0,20}$")


def _about_title(about: str):
    """A title the person claims for themselves in the opening of their About."""
    opening = _clean_text(about)[:ABOUT_TITLE_CHARS]
    if not opening:
        return None
    hit = _tier_title(opening)
    if not hit:
        return None
    match = first_match([hit[2]], opening)
    if match:
        norm = normalize(opening)
        pattern = phrase_pattern(hit[2])
        found = pattern.search(norm) if pattern else None
        if found and _ABOUT_TITLE_REJECT.search(norm[:found.start()]):
            return None            # the title belongs to the people they serve
    return hit


def score_job_title(position: str, headline: str = "", about: str = "") -> tuple:
    position, headline = _clean_text(position), _clean_text(headline)
    if not position and not headline and not _clean_text(about):
        return 0, "No data"
    hit = _tier_title(position) if position else None
    source = ""
    if not hit and headline and normalize(headline) != normalize(position):
        hit = _tier_title(headline)
        source = " — from headline"
    if not hit and about:
        # A LinkedIn headline is often just the person's name; their About still
        # states the role. Labelled, so the breakdown shows where it came from.
        hit = _about_title(about)
        source = " — from About" if hit else ""
    if hit:
        points, tier, kw = hit
        return points, f"Tier {tier} ({kw}){source}"
    return 0, "Other"


def _size_hit(keywords, text: str, rng) -> str:
    """First keyword in the list that fits the head count (or appears in text)."""
    mid = None
    if rng:
        lo, hi = rng
        mid = lo if hi == math.inf else (lo + hi) / 2
    for kw in keywords:
        kw_range = parse_size_range(kw)
        if kw_range:
            if mid is not None:
                if kw_range[0] <= mid <= kw_range[1]:
                    return kw
            elif text and first_match([kw], text, plural=False):
                return kw
        else:
            if text and first_match([kw], text):
                return kw
    return ""


def score_company_size(text: str, emp_count=None) -> tuple:
    text = _clean_text(text)
    rng = employee_count_range(emp_count)
    if rng is None and not text:
        return 0, "No data"
    kw = _size_hit(EXACT_COMPANY_SIZE_KEYWORDS, text, rng)
    if not kw and rng and rng == (1, 1):
        # A one-person company is "self-employed" / "freelance" whatever the wording
        kw = next((k for k in EXACT_COMPANY_SIZE_KEYWORDS if not parse_size_range(k)), "")
    if kw:
        return ICP_POINTS["EXACT_COMPANY_SIZE_KEYWORDS"], f"Exact ({kw})"
    kw = _size_hit(NEARBY_COMPANY_SIZE_KEYWORDS, text, rng)
    if kw:
        return ICP_POINTS["NEARBY_COMPANY_SIZE_KEYWORDS"], f"Nearby ({kw})"
    return 0, "Other"


def score_geography(country: str) -> tuple:
    country = _clean_text(country)
    if not country:
        return 0, "No data"
    text = expand_location(country)
    kw = first_match(PRIMARY_GEOGRAPHIES, text, plural=False)
    if kw:
        return ICP_POINTS["PRIMARY_GEOGRAPHIES"], f"Primary ({kw})"
    kw = first_match(SECONDARY_GEOGRAPHIES, text, plural=False)
    if kw:
        return ICP_POINTS["SECONDARY_GEOGRAPHIES"], f"Secondary ({kw})"
    return 0, "Other"


def score_keywords(text: str) -> tuple:
    text = _clean_text(text)
    if not text:
        return 0, "No data"
    matched = all_matches(ALL_ICP_KEYWORDS, text)
    n = len(matched)
    full = ICP_POINTS["ALL_ICP_KEYWORDS"]   # 5+ matches = full, 3+ = two thirds, 1+ = one third
    if n == 0:
        return 0, "Other"
    shown = ", ".join(matched[:3]) + ("…" if n > 3 else "")
    reason = f"1 match: {matched[0]}" if n == 1 else f"{n} matches: {shown}"
    if n >= 5:
        return full, reason
    if n >= 3:
        return pts(full, Fraction(2, 3)), reason
    return pts(full, Fraction(1, 3)), reason


def _is_just_the_name(text: str, name: str) -> bool:
    """A "headline" that is only the person's name carries no job title.

    LinkedIn's name row reads "Kristin Bryce · 2nd", and a page scrape can easily
    hand that back as the headline. Treating it as a headline scores the profile
    on a string with no title in it, so it is discarded and the real sources
    (Apify's headline, the About text) are used instead.
    """
    if not text or not name:
        return False
    a, b = normalize(text), normalize(name)
    if a == b:
        return True
    if a.startswith(b):
        rest = re.sub(r"(1st|2nd|3rd|premium|verified|he|him|she|her|they|them)", " ", a[len(b):])
        return not re.sub(r"[^a-z0-9]+", "", rest)
    return False


def calculate_icp(profile: dict) -> dict:
    get = lambda key: _clean_text(profile.get(key))
    name      = get("name")
    position  = get("position")
    headline  = get("headline")
    if _is_just_the_name(position, name):
        position = ""
    if _is_just_the_name(headline, name):
        headline = ""
    country   = get("country")
    about     = get("about")
    industry  = get("industry")
    company   = get("current_company_name") or get("current_company")
    emp_count = profile.get("current_company_employee_count")

    search_text = " ".join(s for s in (about, company, position, headline, industry) if s)
    size_text   = " ".join(s for s in (company, about) if s)

    ind_score, ind_reason      = score_industry(search_text, industry)
    title_score, title_reason  = score_job_title(position, headline, about)
    size_score, size_reason    = score_company_size(size_text, emp_count)
    geo_score, geo_reason      = score_geography(country)
    kw_score, kw_reason        = score_keywords(search_text)

    P = ICP_POINTS
    maxes = {
        "Industry Match":     max(P["EXACT_INDUSTRIES"], P["RELATED_INDUSTRIES"]),
        "Job Title Match":    max(P["TIER_1_TITLES"], P["TIER_2_TITLES"], P["TIER_3_TITLES"]),
        "Company Size Match": max(P["EXACT_COMPANY_SIZE_KEYWORDS"], P["NEARBY_COMPANY_SIZE_KEYWORDS"]),
        "Geography Match":    max(P["PRIMARY_GEOGRAPHIES"], P["SECONDARY_GEOGRAPHIES"]),
        "Profile Keywords":   P["ALL_ICP_KEYWORDS"],
    }
    breakdown = {
        "Industry Match":     {"score": ind_score,   "max": maxes["Industry Match"],     "reason": ind_reason},
        "Job Title Match":    {"score": title_score, "max": maxes["Job Title Match"],    "reason": title_reason},
        "Company Size Match": {"score": size_score,  "max": maxes["Company Size Match"], "reason": size_reason},
        "Geography Match":    {"score": geo_score,   "max": maxes["Geography Match"],    "reason": geo_reason},
        "Profile Keywords":   {"score": kw_score,    "max": maxes["Profile Keywords"],   "reason": kw_reason},
    }
    raw_total = ind_score + title_score + size_score + geo_score + kw_score
    max_total = sum(maxes.values())
    # Shown out of 100 whatever the points add up to (the defaults total 100)
    total = pts(100, Fraction(raw_total, max_total)) if max_total else 0
    missing = [cat for cat, row in breakdown.items() if row["reason"] == "No data"]

    return {
        "icp_score": total,
        "score_raw": raw_total,
        "score_max": max_total,
        "breakdown": breakdown,
        "missing":   missing,
        "coverage":  {"with_data": len(breakdown) - len(missing), "total": len(breakdown)},
    }


def run_company_actor(profile_url: str) -> dict:
    try:
        token = current_apify_token()
        if not token:
            return {}
        actor_id = os.getenv("APIFY_COMPANY_ACTOR_ID") or APIFY_COMPANY_ACTOR_ID
        if not actor_id:
            return {}
        username = profile_url.rstrip("/").split("/")[-1]
        client = ApifyClient(token)
        run = client.actor(actor_id).call(run_input={
            "profiles": [username],
            "isEmailRequired": False,
        })
        for item in client.dataset(run["defaultDatasetId"]).iterate_items():
            # Map actor field names → standardized keys
            emp_count = item.get("current_company_employee_count")
            try:
                emp_count = int(emp_count) if emp_count is not None else None
            except (TypeError, ValueError):
                pass   # a range like "11-50" — employee_count_range() reads it as is
            return {
                "headline": item.get("headline", ""),
                "about": item.get("about", ""),
                "location": item.get("location", ""),
                "current_company_name": item.get("current_company_name") or item.get("current_company", ""),
                "current_company_employee_count": emp_count,
                "current_company_industry": item.get("current_company_industry", ""),
                "current_company_headquarters": item.get("current_company_headquarters", {}),
            }
        return {}
    except Exception:
        return {}


# ─── What actually matched, for the extension and admin panel ─────────────────
# Uses the same matchers the scorer uses, so the lists can never disagree with the
# score. Returned alongside it rather than parsed back out of the reason strings.
def icp_matches(profile: dict) -> dict:
    get = lambda key: _clean_text(profile.get(key))
    position = get("position")
    headline = get("headline")
    country  = get("country")
    about    = get("about")
    industry = get("industry")
    company  = get("current_company_name") or get("current_company")

    search_text = " ".join(s for s in (about, company, position, headline, industry) if s)
    title_text  = " ".join(s for s in (position, headline) if s)
    geo_text    = expand_location(country) if country else ""
    return {
        "matched_industries":   all_matches(EXACT_INDUSTRIES + RELATED_INDUSTRIES, search_text),
        "matched_titles":       all_matches(TIER_1_TITLES + TIER_2_TITLES + TIER_3_TITLES, title_text),
        "matched_geographies":  all_matches(PRIMARY_GEOGRAPHIES + SECONDARY_GEOGRAPHIES, geo_text, plural=False),
        "matched_keywords":     all_matches(ALL_ICP_KEYWORDS, search_text),
        "matched_company_size": all_matches(EXACT_COMPANY_SIZE_KEYWORDS + NEARBY_COMPANY_SIZE_KEYWORDS,
                                            " ".join(s for s in (company, about) if s)),
    }


def icp_config_version() -> int:
    """Bumped by save_icp_config; every analysis records the version it used."""
    try:
        if os.path.exists(ICP_CONFIG_FILE):
            with open(ICP_CONFIG_FILE, "r", encoding="utf-8") as f:
                return int(json.load(f).get("version") or 1)
    except Exception:
        pass
    return 1
