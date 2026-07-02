# CLAUDE.md

**Project:** LinkedIn AI Assistant (Chrome extension + FastAPI backend)

**Goal:** Speed up LinkedIn outreach — score profiles (Activity + ICP) and generate
AI reply suggestions / grammar fixes inside chat, cookie-free (no account logout risk).

**Tech stack**
- Extension: Chrome MV3 — `Extension/content.js`, `background.js`, `manifest.json`, `popup.html`
- Backend: FastAPI (Python) — `main.py`, `models.py`, `services/*`
- Scraping: Apify actors (profile/posts/company) via `APIFY_API_TOKEN`
- AI: Groq `llama-3.3-70b-versatile` (primary) → OpenRouter free models (fallback)
- Deploy: Render (`https://linkedin-analyzer-90ne.onrender.com`) for Activity/ICP;
  AI suggestions currently hit `http://localhost:8000`
- Secrets in `Extension/.env` (gitignored): APIFY_API_TOKEN, GROQ_API_KEY,
  OPENROUTER_API_KEY, ANTHROPIC_API_KEY

**Endpoints:** `/analyze`, `/icp-score`, `/generate-suggestions`, `/grammar-fix`, `/health`

**Current status:** Working — Activity + ICP buttons on profiles; ✨ AI reply + ✍️
grammar icons in the chat composer footer (shadow-DOM aware). Suggestions have tone
selector, regenerate (varied), per-chat cache, copy, first-message personalization,
floating auto-closing panel. Backend on Groq.

**Important decisions**
- Removed old cookie-based chat (server used user's li_at on Apify → LinkedIn logouts).
- Read the open conversation from the browser DOM (safe) instead of Apify actor
  `wVzvCSQjiaxpbxvqM` (which requires a LinkedIn cookie).
- AI = Groq free (Anthropic had no credits; OpenRouter $0 has a ~50/day free cap).
- No auto-send/automation — user always presses Send (keeps account safe).

**Project rules**
- Never put secrets/keys or a LinkedIn cookie in the extension; keys live in backend `.env`.
- No LinkedIn cookie server-side; no Apify for private messages.
- DOM is used ONLY for UI injection + reading the open chat; never automate actions.
- LinkedIn messaging is in an OPEN Shadow DOM → walk shadow roots; use EXACT classes
  (`.msg-s-event-listitem`, `.msg-s-event__content`, `.msg-form__left-actions`); use
  inline styles inside shadow DOM.
- Run backend from `c:\Activity\Extension`; VS Code interpreter = `C:\Activity\.venv`.

**Next task:** Commit the uncommitted polish, then merge `feature/ai-reply-suggestions`
→ `master`. Optional new features: connection-note generator, post-comment generator,
quick-reply hotkeys (all reuse the Groq pipeline).
