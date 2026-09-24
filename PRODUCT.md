# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The founder and sales team of a healthcare IT company, prospecting on LinkedIn. They work inside LinkedIn itself: opening prospect profiles, scoring them, and writing connection notes and chat messages to start and continue sales conversations.

## Product Purpose

A Chrome extension that turns LinkedIn prospecting into a guided workflow: judge whether a person is worth pursuing (Activity score, ICP score) and what to say to them (AI-written openers, replies, and follow-ups), without leaving the LinkedIn page. Success means the team spends less time per prospect and sends messages that fit the person and the conversation.

## Positioning

Everything happens in place on LinkedIn, grounded in real signals from the page: the prospect's profile, their recent posts, and the last messages of the open chat. Scores and messages come from that evidence, not from generic templates.

## Operating Context

- Runs as a Chrome (Manifest V3) extension on linkedin.com; its UI is injected into LinkedIn pages: buttons on profile pages, score panels below the profile card, a ✨ popup in the messaging composer, an "✨ AI note" button in the Connect → Add a note dialog, and a toolbar popup.
- Talks to a local FastAPI backend (http://127.0.0.1:8765 — its own port, so other local projects on 8000 cannot collide) that must be running; the backend scrapes via Apify and generates text via Groq (primary) or OpenRouter (backup).
- Used repeatedly throughout the day, one prospect at a time, alongside LinkedIn's own UI.

## Capabilities and Constraints

- **Activity score** (0–100): outreach readiness from recent activity, posting frequency, engagement, profile completeness, hiring/growth signals, and mutual connections.
- **ICP score** (0–100): fit against editable keyword lists (industry, job title tiers, company size, geography, profile keywords), saved to `icp_config.json`.
- **✨ AI suggestions** in the chat composer: replies based on the last 5 messages, or first messages when there is no chat (casual: the saved core line; professional: a pain point found in the person's recent posts). Casual/Pro tone, draft rewrite (Improve / Shorten / Fix grammar), language matching (English, Hindi, Gujarati, Hinglish).
- **Connection notes** within LinkedIn's note character limit.
- **Toolbar popup**: follow-up reminders (no reply after N days), lead log with CSV export, and the "My pitch" settings saved to `pitch_config.json`.
- Constraint: the UI lives inside LinkedIn's DOM (partly Shadow DOM) and must not break LinkedIn's own layout or controls.
- Constraint: scores and lead data are stored per browser in `chrome.storage.local`.

## Brand Commitments

- **Native to LinkedIn**: the extension's UI blends in with LinkedIn's look (LinkedIn blue, clean and quiet) so panels feel built-in rather than like a separate brand.
- **Keep the current panel layouts**: the Activity and ICP panel structures were tuned by the user; future work refines details, it does not restructure them. The ICP panel keeps its green header and its own layout.
- **Light and dark mode**: follow LinkedIn's dark mode automatically, as now.
- **Score meaning by color**: 70–100 green, 40–69 yellow/amber, below 40 red — in every place a score is shown.
- Sender voice (editable in "My pitch"): Founder of a healthcare IT company; "healthcare tech experts — if you're looking for anything in tech, we can help."

## Evidence on Hand

No testimonials, case studies, client names, metrics, or press exist in the project. AI messages and any UI copy must not invent clients, numbers, or results.

## Product Principles

1. **Stay in the flow.** Every action happens where the user already is on LinkedIn; no switching to another tool.
2. **Evidence over templates.** Scores and messages are built from the person's real profile, posts, and chat — and say so when data is missing.
3. **Fast to judge.** A score and its label should be readable at a glance; details are there for whoever wants them.
4. **The user stays in control.** Suggestions are drafts to pick and edit; nothing is sent automatically.
5. **Honest outreach.** No fabricated claims, clients, or numbers in anything the extension writes.
