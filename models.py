from typing import Optional
from pydantic import BaseModel

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
    # Posts read whose date could not be parsed: counted, never assumed recent.
    posts_undated:     int = 0
    avg_engagement:    float = 0.0
    avg_likes:         float = 0.0
    avg_comments:      float = 0.0
    avg_reposts:       float = 0.0
    followers:         int = 0
    connections:       int = 0
    profileUrl:        str = ""
    timestamp:         str = ""
    # The signed-in user's own Activity scoring (from the admin). Absent = the saved defaults.
    activity_points:   Optional[dict] = None
    activity_keywords: Optional[dict] = None

class ProfileData(BaseModel):
    avatar:             str   = ""
    name:               str   = ""
    country:            str   = ""
    position:           str   = ""
    headline:           str   = ""
    industry:           str   = ""   # from the company lookup - a profile page never shows it
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
    profileUrl:         str   = ""
    timestamp:          str   = ""
    score_total:        int   = 0
    score_label:        str   = ""
    score_activity:     int   = 0
    score_posts:        int   = 0
    score_engagement:   int   = 0
    score_completeness: int   = 0
    score_signals:      int   = 0
    avg_engagement:     float = 0.0
    posts_30_days:      int   = 0
    posts_90_days:      int   = 0
    posts_undated:      int   = 0
    avg_likes:          float = 0.0
    avg_comments:       float = 0.0
    avg_reposts:        float = 0.0
    engagement_label:   str   = ""
    # Max points per factor (editable) + raw total before scaling to 100
    max_activity:       int   = 30
    max_posts:          int   = 20
    max_engagement:     int   = 20
    max_completeness:   int   = 10
    max_signals:        int   = 20
    score_raw:          int   = 0
    score_max:          int   = 100
    # What the score was based on (shown in the panel, used for outreach suggestions)
    signal_hits:          dict      = {}   # {"hiring": "we're hiring", ...} — lists that matched
    completeness_missing: list[str] = []   # e.g. ["about", "skills"]
    posts_analyzed:       int       = 0
    data_source:          str       = ""   # "apify" | "form"

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


class LeadMessageRequest(BaseModel):
    """Admin panel: this person's profile + any conversation -> one message to send."""
    name:            str = ""
    headline:        str = ""
    about:           str = ""
    company:         str = ""
    job_title:       str = ""
    industry:        str = ""
    location:        str = ""
    profile_url:     str = ""
    experience:      str = ""
    skills:          str = ""
    recent_activity: str = ""
    messages:        list[ChatMessage] = []   # empty -> first-message case
    goal:            str = ""                 # what the admin wants from this message
    sender_role:     str = ""
    max_chars:       int = 900


class CollectRequest(BaseModel):
    """Collect one LinkedIn profile: the admin backend asks, this service fetches.

    No ICP scoring happens here - that belongs to whoever owns the ICP rules. This
    returns the facts (profile, posts, company, activity) and says plainly which of
    them could not be collected.
    """
    profile_url: str = ""
    max_posts:   Optional[int] = None   # None: settings.max_posts
    scraped:     dict = {}     # what the extension could read off the page
    # The workspace's own Activity scoring, sent by the admin. Absent = the saved defaults.
    activity_points:   Optional[dict] = None
    activity_keywords: Optional[dict] = None


class PitchConfig(BaseModel):
    """Who "I" am in every AI message — saved to pitch_config.json."""
    who:           Optional[str] = None
    expertise:     Optional[str] = None
    offer:         Optional[str] = None
    services:      Optional[str] = None
    casual_opener: Optional[str] = None
