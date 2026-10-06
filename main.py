"""LinkedIn AI Analyzer API: the app, its access rules and its routes.

The routes live in routers/, the work in services/, every setting in services/config.py.
"""
import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from services.config import VERSION   # loads .env before anything reads a setting
from services.apify_token import TOKEN_HEADER, bind_apify_token
from services.server_key import KEY_HEADER, is_public, rate_limit, require_server_key
from routers import ai, analyze, collect, pitch

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# Every request is rate-limited and must carry the server key once the server is public
# (services/server_key.py), then binds the Apify token it carries, so each endpoint - and
# every thread it starts - sees the token the extension sent with that request. A public
# server does not publish its API map either: /docs and /openapi.json are off there.
_docs = not is_public()
app = FastAPI(title="LinkedIn AI Analyzer API", version=VERSION,
              docs_url="/docs" if _docs else None, redoc_url="/redoc" if _docs else None,
              openapi_url="/openapi.json" if _docs else None,
              dependencies=[Depends(rate_limit), Depends(require_server_key), Depends(bind_apify_token)])

# Only the extension talks to this server from a browser: its background worker and
# toolbar popup (chrome-extension://…). The admin calls it server to server.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", TOKEN_HEADER, KEY_HEADER],
)

for module in (analyze, collect, ai, pitch):
    app.include_router(module.router)


@app.get("/")
async def root():
    return {"status": "ok", "service": "LinkedIn AI Analyzer API"}


@app.get("/health")
async def health():
    return {"status": "ok", "version": VERSION}
