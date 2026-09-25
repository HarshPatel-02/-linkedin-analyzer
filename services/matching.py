"""Keyword matching shared by the ICP and Activity scores.

Whole-word, case-insensitive phrase matching: "cto" never matches "director",
"uk" never matches "ukraine", "health care" also matches "healthcare", and a
size range like "1-10" never matches inside "501-1000".
"""
import math
import re
from fractions import Fraction
from functools import lru_cache

_DASHES = "‐‑‒–—―−"
_QUOTES = {"‘": "'", "’": "'", "‛": "'", "′": "'", "“": '"', "”": '"', "„": '"'}


def normalize(text) -> str:
    """Lowercase, one kind of dash and quote, single spaces."""
    s = str(text or "")
    if not s:
        return ""
    s = s.lower().replace(" ", " ")
    for d in _DASHES:
        s = s.replace(d, "-")
    for k, v in _QUOTES.items():
        s = s.replace(k, v)
    return re.sub(r"\s+", " ", s).strip()


def pts(max_points, fraction) -> int:
    """`fraction` of `max_points`, rounded half-up exactly like JS Math.round(p * part / of)."""
    value = Fraction(max_points) * Fraction(fraction)
    return int(math.floor(value + Fraction(1, 2)))


@lru_cache(maxsize=4096)
def phrase_pattern(kw: str, plural: bool = True):
    tokens = [t for t in re.split(r"[\s\-]+", normalize(kw)) if t]
    if not tokens:
        return None
    parts = [re.escape(tokens[0])]
    for prev, tok in zip(tokens, tokens[1:]):
        # digits keep a real separator ("11-50" ≠ "1150"); words may be joined ("health care" ~ "healthcare")
        parts.append(r"\s*(?:-|to)\s*" if prev[-1].isdigit() and tok[0].isdigit() else r"[\s\-]*")
        parts.append(re.escape(tok))
    # plurals only for real words: "series a" must not match "series as"
    suffix = r"(?:s|es)?(?![a-z0-9])" if plural and tokens[-1].isalpha() and len(tokens[-1]) > 2 else r"(?![a-z0-9])"
    return re.compile(r"(?<![a-z0-9])" + "".join(parts) + suffix)


def find_phrase(kw, text, plural: bool = True):
    pat = phrase_pattern(str(kw or ""), plural)
    return pat.search(normalize(text)) if pat else None


def first_match(keywords, text, plural: bool = True, reject=None):
    """First keyword (original spelling) found in text; `reject(norm_text, match)` can veto a hit."""
    norm = normalize(text)
    if not norm:
        return None
    for kw in keywords or []:
        pat = phrase_pattern(str(kw or ""), plural)
        if not pat:
            continue
        for m in pat.finditer(norm):
            if reject and reject(norm, m):
                continue
            return kw
    return None


def all_matches(keywords, text, plural: bool = True) -> list:
    """Distinct keywords found in text, in list order."""
    norm = normalize(text)
    out, seen = [], set()
    if not norm:
        return out
    for kw in keywords or []:
        key = normalize(kw)
        if not key or key in seen:
            continue
        pat = phrase_pattern(str(kw), plural)
        if pat and pat.search(norm):
            seen.add(key)
            out.append(kw)
    return out


# ─── Company size ranges ──────────────────────────────────────────────────────
_NUM = r"(\d[\d,]*(?:\.\d+)?)\s*([km])?"
_SIZE_WORDS = r"\s*(?:employees?|people|staff)\s*$"


def _to_int(num: str, suffix) -> int:
    n = float(num.replace(",", ""))
    n *= {"k": 1_000, "m": 1_000_000}.get(suffix or "", 1)
    return int(n)


def parse_size_range(kw):
    """(lo, hi) for "1-10", "2 to 10", "11 - 50", "1,001-5,000", "5000+", "10k+"; None otherwise."""
    s = re.sub(_SIZE_WORDS, "", normalize(kw))
    m = re.fullmatch(_NUM + r"\s*(?:-|to)\s*" + _NUM, s)
    if m:
        lo, hi = _to_int(m.group(1), m.group(2)), _to_int(m.group(3), m.group(4))
        return (min(lo, hi), max(lo, hi))
    m = re.fullmatch(_NUM + r"\s*\+", s)
    if m:
        return (_to_int(m.group(1), m.group(2)), math.inf)
    return None


def employee_count_range(value):
    """(n, n) for a head count, (lo, hi) for "11-50" / "5000+"; None when unknown."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if not math.isfinite(value) or value <= 0:
            return None
        return (int(value), int(value))
    s = normalize(value)
    if not s:
        return None
    rng = parse_size_range(s)
    if rng:
        return rng
    m = re.fullmatch(_NUM + r"(?:" + _SIZE_WORDS + r")?", s)
    if m:
        n = _to_int(m.group(1), m.group(2))
        return (n, n) if n > 0 else None
    return None


# ─── Locations ────────────────────────────────────────────────────────────────
# country = names of the country itself; places = cities / regions that imply it
# when LinkedIn shows no country ("Greater Mumbai Area", "San Francisco Bay Area").
LOCATION_GROUPS = [
    {"country": ["united states", "usa", "us", "u.s.", "u.s.a.", "america"],
     "places": ["bay area", "silicon valley", "new york", "san francisco", "los angeles", "chicago", "boston",
                "seattle", "austin", "dallas", "houston", "atlanta", "miami", "denver", "washington dc",
                "philadelphia", "san diego"]},
    {"country": ["united kingdom", "uk", "u.k.", "great britain", "england", "scotland", "wales",
                 "northern ireland"],
     "places": ["london", "manchester"]},
    {"country": ["united arab emirates", "uae", "u.a.e."], "places": ["dubai", "abu dhabi", "sharjah"]},
    {"country": ["australia", "aus"], "places": ["sydney", "melbourne", "brisbane", "perth"]},
    {"country": ["india"],
     "places": ["bengaluru", "bangalore", "mumbai", "delhi", "new delhi", "hyderabad", "pune", "chennai",
                "ahmedabad", "kolkata", "gurgaon", "gurugram", "noida"]},
]
# Countries outside the groups: once one is named, city aliases must not pull in
# another country ("Hyderabad, Sindh, Pakistan", "London, Ontario, Canada").
OTHER_COUNTRIES = [
    "pakistan", "canada", "bangladesh", "sri lanka", "nepal", "germany", "france", "netherlands", "ireland",
    "new zealand", "south africa", "singapore", "malaysia", "indonesia", "philippines", "saudi arabia", "qatar",
    "kuwait", "oman", "bahrain", "egypt", "nigeria", "kenya", "brazil", "mexico", "japan", "china", "spain",
    "italy", "sweden", "switzerland", "belgium", "poland", "portugal", "israel", "turkey", "vietnam", "thailand",
]
# Regions whose names contain a group alias but are elsewhere
_ELSEWHERE = re.compile(r"(?<![a-z0-9])(?:(?:latin|south|central)\s+america|new\s+south\s+wales)(?![a-z0-9])")


def _has_any(words, text) -> bool:
    return any(find_phrase(w, text, plural=False) for w in words)


def expand_location(text) -> str:
    """Location text plus every alias of the country it is in ("Greater Mumbai Area" → + india).
    LinkedIn ends a location with its country, so a named country decides; cities
    only count when no country is given."""
    norm = normalize(text)
    if not norm:
        return ""
    probe = _ELSEWHERE.sub(" ", norm)
    last = probe.split(",")[-1].strip()
    groups = [g for g in LOCATION_GROUPS if _has_any(g["country"], last)]
    if not groups and not _has_any(OTHER_COUNTRIES, last):
        groups = [g for g in LOCATION_GROUPS if _has_any(g["country"] + g["places"], probe)]
    extra = [w for g in groups for w in g["country"] + g["places"]]
    return norm + (" | " + " | ".join(extra) if extra else "")
