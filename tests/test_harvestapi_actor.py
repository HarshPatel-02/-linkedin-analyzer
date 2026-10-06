"""Profiles come from harvestapi/linkedin-profile-scraper (no cookies, $4 per 1,000).

The fixture is the actor's own README example, trimmed. Its output is camelCase
(firstName, photo, location.linkedinText, experience[].position) where the mapper
reads snake_case, so without from_harvestapi every result was rejected as
"item without a name".
"""
import pytest

from services import actor_service as actors
from services import apify_token
from services.actor_service import from_harvestapi, map_apify_to_profile

URL = "https://www.linkedin.com/in/towhid-rahman"
HARVEST = {
    "publicIdentifier": "towhid-rahman", "linkedinUrl": URL,
    "firstName": "Towhid", "lastName": "Rahman, PharmD",
    "headline": "Pharmacology | Medical Science Liasion",
    "about": "With over eight years of experience in pharmacology.",
    "openToWork": False, "hiring": False,
    "photo": "https://media.licdn.com/dms/image/photo.jpg",
    "location": {"linkedinText": "Los Angeles, California, United States", "countryCode": "US",
                 "parsed": {"text": "Los Angeles, CA, United States", "countryCode": "US",
                            "country": "United States", "state": "California", "city": "Los Angeles"}},
    "connectionsCount": 261, "followerCount": 264,
    "currentPosition": [{"companyName": "CVS Health"}],
    "experience": [
        {"position": "Pharmacy Intern", "companyName": "Harbor-UCLA",
         "startDate": {"year": 2021}, "endDate": {"text": "Jun 2022"}},
        {"position": "Staff Pharmacist", "companyName": "CVS Health",
         "startDate": {"month": "Jan", "year": 2024, "text": "Jan 2024"}, "endDate": {"text": "Present"}},
    ],
    "education": [{"schoolName": "Western University of Health Sciences", "degree": "Doctor of Pharmacy",
                   "fieldOfStudy": "Pharmacy", "startDate": {"year": 2018}, "endDate": {"year": 2022}}],
    "skills": [{"name": "Drug Therapy Optimization"}, {"name": "Microsoft Excel"}],
    "projects": [{"title": "Cardiovascular Medicine Availability", "description": "Generic drug plans."}],
    "status": 200,
}


from routers import common
from routers import collect as collect_route


def profile(item=HARVEST):
    return map_apify_to_profile(from_harvestapi(dict(item)), URL, [])


def test_every_field_the_page_used_to_supply_comes_through():
    p = profile()
    assert p.name == "Towhid Rahman, PharmD"
    assert p.headline == "Pharmacology | Medical Science Liasion"
    assert p.current_company == "CVS Health"
    assert p.country == "Los Angeles, California, United States"
    assert p.avatar.endswith("photo.jpg")
    assert p.about.startswith("With over eight years")
    assert (p.followers, p.connections) == (264, 261)
    assert "Western University of Health Sciences, Doctor of Pharmacy, Pharmacy (2018" in p.education
    assert "Drug Therapy Optimization" in p.skills and "Cardiovascular" in p.projects


def test_the_current_role_is_the_one_still_running_not_the_first_listed():
    assert profile().position == "Staff Pharmacist"


def test_a_skill_never_replaces_the_persons_name():
    """The skills loop reused `name`, so this profile was called "Microsoft Excel"."""
    assert profile().name == "Towhid Rahman, PharmD"
    old_shape = {"name": "Jane Doe", "skills": [{"name": "Microsoft Excel"}]}
    assert map_apify_to_profile(old_shape, URL, []).name == "Jane Doe"


def test_the_full_location_names_the_country():
    assert profile().country.endswith("United States")


def test_a_complete_profile_is_scored_complete():
    assert profile().completeness_missing == []


def test_the_old_actors_city_and_country_code_still_name_a_country():
    p = map_apify_to_profile({"name": "X", "city": "San Jose", "country_code": "US"}, URL, [])
    assert p.country == "San Jose, US"


def test_no_headline_falls_back_to_the_current_role():
    p = map_apify_to_profile({"name": "X", "experience": [{"title": "CTO", "company": "ABC"}]}, URL, [])
    assert p.position == "CTO" and p.headline == "CTO"


def test_an_item_that_is_not_harvestapis_passes_through_unchanged():
    item = {"name": "X", "city": "Austin"}
    assert from_harvestapi(item) is item


class FakeApify:
    def __init__(self, items):
        self.items, self.inputs = items, []

    def __call__(self, token):
        return self

    def actor(self, actor_id):
        self.actor_id = actor_id
        return self

    def call(self, run_input, **_options):
        self.inputs.append(run_input)
        return {"defaultDatasetId": "d"}

    def dataset(self, _id):
        return self

    def iterate_items(self):
        return iter(self.items)


@pytest.fixture
def token():
    t = apify_token._token.set("t")
    yield
    apify_token._token.reset(t)


def test_the_actor_is_asked_for_the_4_dollar_no_email_mode(monkeypatch, token):
    fake = FakeApify([dict(HARVEST)])
    monkeypatch.setattr(actors, "ApifyClient", fake)
    monkeypatch.setenv("APIFY_ACTOR_ID", "LpVuK3Zozwuipa5bp")
    item = actors.run_apify_actor(URL)
    assert fake.inputs[0] == {"urls": [URL], "profileScraperMode": "Profile details no email ($4 per 1k)"}
    assert item["name"] == "Towhid Rahman, PharmD"      # accepted, not "item without a name"


def test_the_previous_actor_keeps_its_own_input(monkeypatch, token):
    fake = FakeApify([{"name": "X", "city": "Austin"}])
    monkeypatch.setattr(actors, "ApifyClient", fake)
    monkeypatch.setenv("APIFY_ACTOR_ID", "EacyHlzi4GOX8oMge")
    actors.run_apify_actor(URL)
    assert fake.inputs[0] == {"urls": [URL], "resolveEmails": False}


# ─── Industry and company size: harvestapi/linkedin-company ──────────────────
# The company actor's README example. The previous company actor returned neither field
# and swallowed every error, so the panel could only say "did not publish an industry".
NETFLIX = {"name": "Netflix", "linkedinUrl": "https://www.linkedin.com/company/netflix",
           "website": "https://jobs.netflix.com", "industries": ["Entertainment Providers"],
           "employeeCount": 16985, "employeeCountRange": {"start": 10001},
           "locations": [{"country": "US", "geographicArea": "CA", "city": "Los Gatos", "headquarter": True}]}
COMPANY_URL = "https://www.linkedin.com/company/cvshealth/"
WITH_COMPANY_PAGE = {**HARVEST, "experience": [
    {"position": "Staff Pharmacist", "companyName": "CVS Health", "companyLinkedinUrl": COMPANY_URL,
     "endDate": {"text": "Present"}}]}


def test_the_profile_names_the_company_page_of_the_current_job():
    assert from_harvestapi(dict(WITH_COMPANY_PAGE))["current_company_url"] == COMPANY_URL


def test_industry_size_and_headquarters_are_read_from_the_company():
    c = actors.company_from_harvestapi(NETFLIX)
    assert c["current_company_industry"] == "Entertainment Providers"
    assert c["current_company_employee_count"] == 16985
    assert c["current_company_headquarters"] == {"city": "Los Gatos", "state": "CA", "country": "US"}


def test_a_published_range_alone_still_gives_a_size():
    c = actors.company_from_harvestapi({"name": "X", "employeeCountRange": {"start": 11, "end": 50}})
    assert c["current_company_employee_count"] == 11


def test_the_company_actor_is_asked_by_company_page(monkeypatch, token):
    fake = FakeApify([dict(NETFLIX)])
    monkeypatch.setattr(actors, "ApifyClient", fake)
    c = actors.run_company_details(COMPANY_URL)
    assert fake.inputs[0] == {"companies": [COMPANY_URL]}
    assert fake.actor_id == "UwSdACBp7ymaGUJjS"
    assert c["current_company_industry"] == "Entertainment Providers"


def test_a_failed_company_lookup_says_why(monkeypatch, token):
    class Boom(FakeApify):
        def call(self, run_input, **_options):
            raise RuntimeError("actor run failed")
    monkeypatch.setattr(actors, "ApifyClient", Boom([]))
    notes = []
    assert actors.run_company_details(COMPANY_URL, notes) == {}
    assert notes and "actor run failed" in notes[0]


def test_an_empty_company_lookup_says_so(monkeypatch, token):
    monkeypatch.setattr(actors, "ApifyClient", FakeApify([]))
    notes = []
    assert actors.run_company_details(COMPANY_URL, notes) == {}
    assert "returned nothing" in notes[0]


def test_no_token_is_reported_not_hidden():
    notes = []
    assert actors.run_company_details(COMPANY_URL, notes) == {}
    assert "No Apify token" in notes[0]


def test_collect_looks_the_company_up_from_the_profile(monkeypatch):
    import main
    from fastapi.testclient import TestClient
    asked = []
    monkeypatch.setattr(common, "run_apify_actor", lambda url: from_harvestapi(dict(WITH_COMPANY_PAGE)))
    monkeypatch.setattr(common, "run_posts_actor", lambda url, n=20, errors=None: [])
    cvs = {**NETFLIX, "name": "CVS Health"}            # the page named like the job
    monkeypatch.setattr(collect_route, "run_company_details",
                        lambda u, notes=None: asked.append(u) or actors.company_from_harvestapi(cvs))
    monkeypatch.setattr(collect_route, "run_company_actor", lambda url, notes=None: pytest.fail("fallback must not run"))
    d = TestClient(main.app).post("/collect", json={"profile_url": URL, "scraped": {}, "max_posts": 20}).json()
    assert asked == [COMPANY_URL]
    assert d["company"]["current_company_industry"] == "Entertainment Providers"
    assert d["company"]["current_company_employee_count"] == 16985
    assert d["missing_fields"] == []


def test_collect_without_a_company_page_falls_back_and_explains(monkeypatch):
    import main
    from fastapi.testclient import TestClient
    monkeypatch.setattr(common, "run_apify_actor", lambda url: {"name": "X", "city": "Austin"})
    monkeypatch.setattr(common, "run_posts_actor", lambda url, n=20, errors=None: [])
    monkeypatch.setattr(collect_route, "run_company_actor", lambda url, notes=None: {})
    d = TestClient(main.app).post("/collect", json={"profile_url": URL, "scraped": {}, "max_posts": 20}).json()
    assert any("names no company page" in n for n in d["collection_notes"])


def test_an_industry_given_as_an_object_is_stored_as_its_name():
    """Live output, unlike the README: Andrian's company was stored as "{'id': '6', 'name': ..."."""
    c = actors.company_from_harvestapi({"name": "VLAI-Solutions", "industries": [
        {"id": "6", "name": "Technology, Information and Internet", "urn": "urn:li:fsd_industryV2:6"}]})
    assert c["current_company_industry"] == "Technology, Information and Internet"



# ─── A company page is only trusted when it names the job's company ─────────────
# Andrian's job "VLAI-Solutions" linked to the page of "Vyapar Launchpad" (2 employees),
# and that head count scored as his company's size.

@pytest.mark.parametrize("job, page, same", [
    ("CVS Health", "CVS Health", True),
    ("Google", "Google LLC", True),
    ("Meta", "Meta Platforms, Inc.", True),
    ("VLAI-Solutions", "Vyapar Launchpad", False),
    ("Acme Solutions", "Zeta Solutions", False),
    ("", "Anything", False),
])
def test_same_company(job, page, same):
    assert actors.same_company(job, page) is same


def test_a_page_for_a_different_company_is_not_used(monkeypatch):
    import main
    from fastapi.testclient import TestClient
    vlai = {**HARVEST, "currentPosition": [{"companyName": "VLAI-Solutions"}], "experience": [
        {"position": "Founder", "companyName": "VLAI-Solutions",
         "companyLinkedinUrl": "https://www.linkedin.com/showcase/vyapar-launchpad/", "endDate": {"text": "Present"}}]}
    monkeypatch.setattr(common, "run_apify_actor", lambda url: from_harvestapi(vlai))
    monkeypatch.setattr(common, "run_posts_actor", lambda url, n=20, errors=None: [])
    monkeypatch.setattr(collect_route, "run_company_details", lambda u, notes=None: actors.company_from_harvestapi(
        {"name": "Vyapar Launchpad", "employeeCount": 2, "industries": [{"name": "Technology, Information and Internet"}]}))
    d = TestClient(main.app).post("/collect", json={"profile_url": URL, "scraped": {}, "max_posts": 20}).json()
    assert d["company"] == {}
    assert set(d["missing_fields"]) == {"company_employee_count", "company_industry"}
    assert any("Vyapar Launchpad" in n and "different company" in n for n in d["collection_notes"])
