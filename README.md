# LinkedIn AI Analyzer

Two parts in this repository:

| Part | Folder | What it does |
|---|---|---|
| **Analyzer API** (FastAPI) | repo root | Fetches LinkedIn profiles, posts and companies through Apify, scores **Activity**, writes AI message suggestions |
| **Chrome extension** (MV3) | `Extension/` | The Activity / ICP panels and ✨ suggestions on linkedin.com |

The **ICP score** is not here: it belongs to the LeadAgent admin (a separate project), which calls this
API's `/collect` and stores every result. AI is used only for wording messages, never for scores.

## Layout

```
main.py              app, access rules (server key, rate limit, Apify token), CORS, routers
routers/             one file per area: analyze, collect, ai, pitch (+ common helpers)
services/
  config.py          every setting, read from the environment (see .env.example)
  actor_service.py   Apify: profile, posts, company; profile mapping
  scoring_service.py the Activity score
  analysis_service.py the Activity summary returned by /collect
  ai_service.py      AI providers (Groq, OpenRouter) and the message prompts
  server_key.py      the server key and rate limit for a public server
  apify_token.py     the per-request Apify token sent by the extension
  config_store.py    saved settings files (atomic writes)
models.py            request / response models
tests/               pytest
Extension/           the Chrome extension
```

## Run locally

```bash
python -m venv .venv && .venv/Scripts/activate      # Windows; source .venv/bin/activate elsewhere
pip install -r requirements-dev.txt
cp .env.example .env                                 # then fill in what you use
uvicorn main:app --port 8010 --reload
pytest -q
```

Endpoints: `POST /analyze` (extension Activity score), `POST /collect` (admin), `POST /suggest-messages`,
`POST /lead-message`, `GET|POST /pitch-config`, `GET /health`. `/docs` is available only while the server
is local and has no server key.

## Settings

All in `.env.example`, read by `services/config.py`. The **Apify token is never configured on the server**:
the extension sends it with each request (`X-Apify-Token`).

## Deploy (Render)

Build `pip install -r requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`.
Set `ANALYZER_API_KEY` (the server refuses every request without it on Render) and the actor IDs.
Render's disk is wiped on each deploy, so the saved pitch lasts only until the next one
(the committed `pitch_config.json` is what a fresh server starts from).

## Tests and releases

Every push runs the tests (`.github/workflows/tests.yml`). A release is a version tag:

```bash
# 1. set VERSION in services/config.py (e.g. "1.2"), commit, push main
git tag -a v1.2.0 -m "What changed"
git push origin v1.2.0
```

`release.yml` then runs the tests, deploys on Render through its deploy hook, waits until
`/health` reports the new version and publishes a GitHub Release. Setup, once: the secret
`RENDER_DEPLOY_HOOK` (Render → service → Settings → Deploy Hook) and the variable
`HEALTH_URL`. Keep Render's auto-deploy off: releases go out through the tag.

## Extension

Load `Extension/` unpacked in `chrome://extensions`. Sign in with an extension key from the LeadAgent
admin (your name → Account & keys). The analyzer address, admin address, Apify token and server key are
set in the popup.
