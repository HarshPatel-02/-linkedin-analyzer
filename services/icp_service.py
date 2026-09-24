import json
import os
from apify_client import ApifyClient

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
        "hospitals and health", "hospital", "health care services",
    ],

    "RELATED_INDUSTRIES": [
        "health, wellness & fitness",
        "medical practices", "retail pharmacies",
        "healthcare", "health",
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


def get_icp_config() -> dict:
    """Current keywords: icp_config.json (when present) merged over the defaults."""
    config = {key: list(defaults) for key, defaults in DEFAULT_ICP_CONFIG.items()}
    config["POINTS"] = dict(DEFAULT_ICP_POINTS)
    try:
        if os.path.exists(ICP_CONFIG_FILE):
            with open(ICP_CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                for key, defaults in DEFAULT_ICP_CONFIG.items():
                    if saved.get(key) is not None:
                        config[key] = _to_list(saved[key], defaults)
                config["POINTS"] = _clean_points(saved.get("POINTS"), DEFAULT_ICP_POINTS)
    except Exception:
        pass
    return config


def apply_icp_config(config: dict) -> dict:
    """Point the module level keyword lists at this config (used when scoring)."""
    g = globals()
    for key, defaults in DEFAULT_ICP_CONFIG.items():
        g[key] = _to_list(config.get(key, defaults), defaults)
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

    with open(ICP_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2, ensure_ascii=False)
    return apply_icp_config(clean)


# Load the saved keywords (if any) as soon as the server starts
apply_icp_config(get_icp_config())

# ─── Scoring Logic ────────────────────────────────────────────────────────────

def score_industry(text: str) -> tuple:
    if not text or text == "Not specified":
        return 0, "No data"
    text_lower = text.lower()
    for kw in EXACT_INDUSTRIES:
        if kw.lower() in text_lower:
            return ICP_POINTS["EXACT_INDUSTRIES"], f"Exact match ({kw})"
    for kw in RELATED_INDUSTRIES:
        if kw.lower() in text_lower:
            return ICP_POINTS["RELATED_INDUSTRIES"], f"Related ({kw})"
    return 0, "Other"

def score_job_title(position: str) -> tuple:
    if not position or position == "Not specified":
        return 0, "No data"
    pos_lower = position.lower()
    for kw in TIER_1_TITLES:
        if kw.lower() in pos_lower:
            return ICP_POINTS["TIER_1_TITLES"], f"Tier 1 ({kw})"
    for kw in TIER_2_TITLES:
        if kw.lower() in pos_lower:
            return ICP_POINTS["TIER_2_TITLES"], f"Tier 2 ({kw})"
    for kw in TIER_3_TITLES:
        if kw.lower() in pos_lower:
            return ICP_POINTS["TIER_3_TITLES"], f"Tier 3 ({kw})"
    return 0, "Other"

def score_company_size(text: str) -> tuple:
    if not text or text == "Not specified":
        return 0, "No data"
    text_lower = text.lower()
    for kw in EXACT_COMPANY_SIZE_KEYWORDS:
        if kw.lower() in text_lower:
            return ICP_POINTS["EXACT_COMPANY_SIZE_KEYWORDS"], f"Exact ({kw})"
    for kw in NEARBY_COMPANY_SIZE_KEYWORDS:
        if kw.lower() in text_lower:
            return ICP_POINTS["NEARBY_COMPANY_SIZE_KEYWORDS"], f"Nearby ({kw})"
    return 0, "Other"

def score_geography(country: str) -> tuple:
    if not country or country == "Not specified":
        return 0, "No data"
    country_lower = country.lower()
    for g in PRIMARY_GEOGRAPHIES:
        g = g.lower()
        if g in country_lower or country_lower in g:
            return ICP_POINTS["PRIMARY_GEOGRAPHIES"], f"Primary ({country})"
    for g in SECONDARY_GEOGRAPHIES:
        g = g.lower()
        if g in country_lower or country_lower in g:
            return ICP_POINTS["SECONDARY_GEOGRAPHIES"], f"Secondary ({country})"
    return 0, "Other"

def score_keywords(text: str) -> tuple:
    if not text or text == "Not specified":
        return 0, "No data"
    text_lower = text.lower()
    matches = 0
    matched = []
    for kw in ALL_ICP_KEYWORDS:
        if kw.lower() in text_lower:
            matches += 1
            if kw not in matched:
                matched.append(kw)
    full = ICP_POINTS["ALL_ICP_KEYWORDS"]   # 5+ matches = full, 3+ = two thirds, 1+ = one third
    if matches >= 5:
        return full, f"{matches} matches: {', '.join(matched[:3])}..."
    elif matches >= 3:
        return int(round(full * 2 / 3)), f"{matches} matches: {', '.join(matched[:3])}"
    elif matches >= 1:
        return int(round(full / 3)), f"1 match: {matched[0]}"
    return 0, "Other"

def _emp_to_range(emp_count) -> str:
    """Convert employee count number to range string for keyword matching."""
    try:
        n = int(emp_count)
    except (ValueError, TypeError):
        return str(emp_count) if emp_count else ""
    if n == 1: return "self-employed"
    if n <= 10: return "1-10"
    if n <= 50: return "11-50"
    if n <= 200: return "51-200"
    if n <= 500: return "201-500"
    if n <= 1000: return "501-1000"
    if n <= 5000: return "1001-5000"
    return "5000+"

def calculate_icp(profile: dict) -> dict:
    position  = profile.get("position", "")
    country   = profile.get("country", "")
    company   = profile.get("current_company_name") or profile.get("current_company", "")
    about     = profile.get("about", "")
    emp_count = profile.get("current_company_employee_count", "")
    industry  = profile.get("industry", "")
    
    search_text = f"{about} {company} {position} {industry}"
    size_text   = f"{company} {about} {_emp_to_range(emp_count)}"

    ind_score, ind_reason      = score_industry(search_text)
    title_score, title_reason  = score_job_title(position)
    size_score, size_reason    = score_company_size(size_text)
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
    raw_total = ind_score + title_score + size_score + geo_score + kw_score
    max_total = sum(maxes.values())
    # Shown out of 100 whatever the points add up to (the defaults total 100)
    total = int(round(raw_total * 100 / max_total)) if max_total else 0

    return {
        "icp_score": total,
        "score_raw": raw_total,
        "score_max": max_total,
        "breakdown": {
            "Industry Match":       {"score": ind_score,   "max": maxes["Industry Match"],     "reason": ind_reason},
            "Job Title Match":      {"score": title_score, "max": maxes["Job Title Match"],    "reason": title_reason},
            "Company Size Match":   {"score": size_score,  "max": maxes["Company Size Match"], "reason": size_reason},
            "Geography Match":      {"score": geo_score,   "max": maxes["Geography Match"],    "reason": geo_reason},
            "Profile Keywords":     {"score": kw_score,    "max": maxes["Profile Keywords"],   "reason": kw_reason},
        },
    }

def run_company_actor(profile_url: str) -> dict:
    try:
        token = os.getenv("APIFY_API_TOKEN")
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
            if emp_count is not None:
                emp_count = int(emp_count)
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
