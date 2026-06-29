import os
from apify_client import ApifyClient

APIFY_COMPANY_ACTOR_ID = os.getenv("APIFY_COMPANY_ACTOR_ID")

# ─── CONFIG: Edit these lists for your ICP ────────────────────────────────────

EXACT_INDUSTRIES = [
    "hospitals and health", "hospital", "health care services",
]

RELATED_INDUSTRIES = [
    "health, wellness & fitness",
    "medical practices", "retail pharmacies",
    "healthcare", "health",
]

TIER_1_TITLES = [
    "founder", "co-founder", "ceo", "owner",
]

TIER_2_TITLES = [
    "cto", "operation head", "medical director",
]

TIER_3_TITLES = [
    "product head", "managing director",
]

EXACT_COMPANY_SIZE_KEYWORDS = [
    "self-employed", "self employed", "freelance", "1-10", "2-10", "2 to 10",
]

NEARBY_COMPANY_SIZE_KEYWORDS = [
    "11-50", "11 to 50",
    "51-200", "51 to 200",
    "201-500", "201 to 500",
    "501-1000", "501 to 1000",
    "1001-5000", "1001 to 5000",
]

PRIMARY_GEOGRAPHIES = [
    "usa", "united states", "aus", "australia", "uae",
]

SECONDARY_GEOGRAPHIES = [
    "uk", "united kingdom", "india",
]

ALL_ICP_KEYWORDS =["AI platform", "Digital health platform", "Virtual clinic", "Telehealth platform", "Health platform", "Care coordination", "Patient engagement", "Remote monitoring", "Practice management", "Healthcare SaaS", "AI documentation", "Clinical workflow"]


    

# ─── Scoring Logic ────────────────────────────────────────────────────────────

def score_industry(text: str) -> tuple:
    if not text or text == "Not specified":
        return 0, "No data"
    text_lower = text.lower()
    for kw in EXACT_INDUSTRIES:
        if kw in text_lower:
            return 35, f"Exact match ({kw})"
    for kw in RELATED_INDUSTRIES:
        if kw in text_lower:
            return 25, f"Related ({kw})"
    return 0, "Other"

def score_job_title(position: str) -> tuple:
    if not position or position == "Not specified":
        return 0, "No data"
    pos_lower = position.lower()
    for kw in TIER_1_TITLES:
        if kw in pos_lower:
            return 25, f"Tier 1 ({kw})"
    for kw in TIER_2_TITLES:
        if kw in pos_lower:
            return 20, f"Tier 2 ({kw})"
    for kw in TIER_3_TITLES:
        if kw in pos_lower:
            return 15, f"Tier 3 ({kw})"
    return 0, "Other"

def score_company_size(text: str) -> tuple:
    if not text or text == "Not specified":
        return 0, "No data"
    text_lower = text.lower()
    for kw in EXACT_COMPANY_SIZE_KEYWORDS:
        if kw in text_lower:
            return 15, f"Exact ({kw})"
    for kw in NEARBY_COMPANY_SIZE_KEYWORDS:
        if kw in text_lower:
            return 8, f"Nearby ({kw})"
    return 0, "Other"

def score_geography(country: str) -> tuple:
    if not country or country == "Not specified":
        return 0, "No data"
    country_lower = country.lower()
    for g in PRIMARY_GEOGRAPHIES:
        if g in country_lower or country_lower in g:
            return 10, f"Primary ({country})"
    for g in SECONDARY_GEOGRAPHIES:
        if g in country_lower or country_lower in g:
            return 5, f"Secondary ({country})"
    return 0, "Other"

def score_keywords(text: str) -> tuple:
    if not text or text == "Not specified":
        return 0, "No data"
    text_lower = text.lower()
    matches = 0
    matched = []
    for kw in ALL_ICP_KEYWORDS:
        if kw in text_lower:
            matches += 1
            if kw not in matched:
                matched.append(kw)
    if matches >= 5:
        return 15, f"{matches} matches: {', '.join(matched[:3])}..."
    elif matches >= 3:
        return 10, f"{matches} matches: {', '.join(matched[:3])}"
    elif matches >= 1:
        return 5, f"1 match: {matched[0]}"
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

    total = ind_score + title_score + size_score + geo_score + kw_score

    return {
        "icp_score": total,
        "breakdown": {
            "Industry Match":       {"score": ind_score,   "max": 35, "reason": ind_reason},
            "Job Title Match":      {"score": title_score, "max": 25, "reason": title_reason},
            "Company Size Match":   {"score": size_score,  "max": 15, "reason": size_reason},
            "Geography Match":      {"score": geo_score,   "max": 10, "reason": geo_reason},
            "Profile Keywords":     {"score": kw_score,    "max": 15, "reason": kw_reason},
        },
    }

def run_company_actor(profile_url: str) -> dict:
    try:
        token = os.getenv("APIFY_API_TOKEN")
        if not token:
            return {}
        username = profile_url.rstrip("/").split("/")[-1]
        client = ApifyClient(token)
        run = client.actor(APIFY_COMPANY_ACTOR_ID).call(run_input={
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
