from pydantic import BaseModel

class AnalyzeRequest(BaseModel):
    profile_url:       str = ""
    avatar:            str = ""
    name:              str = ""
    country:           str = ""
    position:          str = ""
    about:             str = ""
    current_company:   str = ""
    education:         str = ""
    skills:            str = ""
    projects:          str = ""
    activity:          str = ""
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
    about:              str   = ""
    current_company:    str   = ""
    education:          str   = ""
    experience:          str = ""
    skills:             str   = ""
    projects:           str   = ""
    activity:           str   = ""
    activity_url:       str   = ""
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
    posts_90_days:      int   = 0
    engagement_label:   str   = ""

class SuggestionsRequest(BaseModel):
    conversation_id: str = ""
    participant: str = ""
    messages: list[dict] = []   # [{sender, text}] read in the user's own browser

class SuggestionsResponse(BaseModel):
    suggestions: list[str] = []

class IcpScore(BaseModel):
    name:               str   = ""   
    country:            str   = ""
    position:           str   = ""
    about:              str   = ""
    current_company_name: str =""
    current_company:    str   = ""
    current_company_employee_count: str =""
    current_company_headquarters: str ="" 
    profile_url:        str   = ""
    profileUrl:         str   = ""
