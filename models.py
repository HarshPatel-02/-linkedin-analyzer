from typing import Optional
from pydantic import BaseModel, field_validator

# Keyword lists edited through the "ICP Score" form in the extension
ICP_LIST_FIELDS = [
    "EXACT_INDUSTRIES", "RELATED_INDUSTRIES",
    "TIER_1_TITLES", "TIER_2_TITLES", "TIER_3_TITLES",
    "EXACT_COMPANY_SIZE_KEYWORDS", "NEARBY_COMPANY_SIZE_KEYWORDS",
    "PRIMARY_GEOGRAPHIES", "SECONDARY_GEOGRAPHIES", "ALL_ICP_KEYWORDS",
]

class AnalyzeRequest(BaseModel):
    profile_url:       str = ""
    avatar:            str = ""
    name:              str = ""
    country:           str = ""
    position:          str = ""
    headline:          str = ""
    about:             str = ""
    current_company:   str = ""
    education:         str = ""
    experience:        str = ""
    skills:            str = ""
    projects:          str = ""
    activity:          str = ""
    posts_30_days:     int = 0
    posts_90_days:     int = 0
    avg_engagement:    float = 0.0
    avg_likes:         float = 0.0
    avg_comments:      float = 0.0
    avg_reposts:       float = 0.0
    followers:         int = 0
    connections:       int = 0
    mutual_connections: int = 0
    profileUrl:        str = ""
    timestamp:         str = ""

class ProfileData(BaseModel):
    avatar:             str   = ""
    name:               str   = ""
    country:            str   = ""
    position:           str   = ""
    headline:           str   = ""
    about:              str   = ""
    current_company:    str   = ""
    education:          str   = ""
    experience:          str = ""
    skills:             str   = ""
    projects:           str   = ""
    activity:           str   = ""
    activity_url:       str   = ""
    activity_date:      str   = ""   # ISO date of the newest activity — the extension recomputes "X ago" from it
    followers:          int   = 0
    connections:        int   = 0
    mutual_connections: int   = 0
    profileUrl:         str   = ""
    timestamp:          str   = ""
    score_total:        int   = 0
    score_label:        str   = ""
    score_activity:     int   = 0
    score_posts:        int   = 0
    score_engagement:   int   = 0
    score_completeness: int   = 0
    score_signals:      int   = 0
    score_mutuals:      int   = 0
    avg_engagement:     float = 0.0
    posts_30_days:      int   = 0
    posts_90_days:      int   = 0
    avg_likes:          float = 0.0
    avg_comments:       float = 0.0
    avg_reposts:        float = 0.0
    engagement_label:   str   = ""
    # Max points per factor (editable) + raw total before scaling to 100
    max_activity:       int   = 30
    max_posts:          int   = 20
    max_engagement:     int   = 20
    max_completeness:   int   = 10
    max_signals:        int   = 10
    max_mutuals:        int   = 10
    score_raw:          int   = 0
    score_max:          int   = 100
    # What the score was based on (shown in the panel, used for outreach suggestions)
    signal_hits:          dict      = {}   # {"hiring": "we're hiring", ...} — lists that matched
    completeness_missing: list[str] = []   # e.g. ["about", "skills"]
    posts_analyzed:       int       = 0
    data_source:          str       = ""   # "apify" | "form"

class IcpConfig(BaseModel):
    """ICP keywords saved from the extension form → icp_config.json.
    A field left out of the request keeps its previously saved value."""
    EXACT_INDUSTRIES:             Optional[list[str]] = None
    RELATED_INDUSTRIES:           Optional[list[str]] = None
    TIER_1_TITLES:                Optional[list[str]] = None
    TIER_2_TITLES:                Optional[list[str]] = None
    TIER_3_TITLES:                Optional[list[str]] = None
    EXACT_COMPANY_SIZE_KEYWORDS:  Optional[list[str]] = None
    NEARBY_COMPANY_SIZE_KEYWORDS: Optional[list[str]] = None
    PRIMARY_GEOGRAPHIES:          Optional[list[str]] = None
    SECONDARY_GEOGRAPHIES:        Optional[list[str]] = None
    ALL_ICP_KEYWORDS:             Optional[list[str]] = None
    POINTS:                       Optional[dict | str] = None   # {list: points} or "reset"

    @field_validator(*ICP_LIST_FIELDS, mode="before")
    @classmethod
    def _keyword_list(cls, v):
        """Accept a list, or a string split on newlines (or commas)."""
        if v is None:
            return None
        if isinstance(v, str):
            v = v.splitlines() if "\n" in v else v.split(",")
        if not isinstance(v, list):
            return None
        return [str(x).strip() for x in v if str(x).strip()]


class ChatMessage(BaseModel):
    sender: str = ""   # "me" | "them" | "unknown"
    name:   str = ""
    text:   str = ""


class SuggestRequest(BaseModel):
    """✨ popup: last chat messages + light profile context → AI next-message ideas."""
    messages:        list[ChatMessage] = []
    tone:            str = "casual"   # "casual" | "pro"
    first_name:      str = ""
    name:            str = ""
    headline:        str = ""
    position:        str = ""
    current_company: str = ""
    profile_url:     str = ""   # chat partner's /in/ URL — pro opener reads their recent posts
    context:         str = "chat"   # "chat" | "invite" (Connect → Add a note)
    max_chars:       int = 300      # invite notes send LinkedIn's own limit
    draft:           str = ""       # non-empty → rewrite the user's draft
    action:          str = ""       # "improve" | "shorten" | "grammar"
    icp_score:       Optional[int] = None   # saved ICP / Activity scores for this person
    activity_score:  Optional[int] = None
    activity_label:  str = ""
    awaiting_reply_days: Optional[int] = None   # my last message unanswered for N days → follow-up
    # Connect → "Add a note": what the extension knows about this person
    country:          str = ""
    about:            str = ""
    activity:         str = ""   # e.g. 'Last posted 3 days ago — "post snippet…"'
    icp_breakdown:    dict = {}
    engagement_label: str = ""
    signal_hits:      dict = {}
    sender_role:      str = ""   # Setup: who "I" am — overrides the pitch "who"
    pain_point:       str = ""   # from the lead log (earlier ✨ analysis of their posts)
    prior_contact:    str = ""   # earlier messages exchanged with them, if any


class OutreachRequest(BaseModel):
    """Profile + ICP / Activity analysis → a connection note and a first message."""
    name:             str = ""
    first_name:       str = ""
    headline:         str = ""
    position:         str = ""
    current_company:  str = ""
    country:          str = ""
    about:            str = ""
    activity:         str = ""   # e.g. 'Last posted 3 days ago — "post snippet…"'
    profile_url:      str = ""
    icp_score:        Optional[int] = None
    icp_breakdown:    dict = {}  # {"Industry Match": {"score": 35, "max": 35, "reason": "Exact match (hospital)"}, ...}
    activity_score:   Optional[int] = None
    activity_label:   str = ""
    engagement_label: str = ""
    signal_hits:      dict = {}  # {"hiring": "we're hiring", ...}
    tone:             str = "casual"   # "casual" | "pro"
    sender_role:      str = ""
    pain_point:       str = ""
    prior_contact:    str = ""


class PitchConfig(BaseModel):
    """Who "I" am in every AI message — saved to pitch_config.json."""
    who:           Optional[str] = None
    expertise:     Optional[str] = None
    offer:         Optional[str] = None
    services:      Optional[str] = None
    casual_opener: Optional[str] = None


class IcpScore(BaseModel):
    name:               str   = ""
    country:            str   = ""
    position:           str   = ""
    headline:           str   = ""
    industry:           str   = ""
    about:              str   = ""
    current_company_name: str =""
    current_company:    str   = ""
    current_company_employee_count: str =""
    current_company_headquarters: str ="" 
    profile_url:        str   = ""
    profileUrl:         str   = ""
