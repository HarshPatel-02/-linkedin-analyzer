// ─── Lead log + follow-ups — shared by content.js, background.js and popup.js ──
// chrome.storage.local["liLeads"] = { "<key>": lead }, key = "in:<profile slug>"
// (or "name:<full name>" until the person's profile link is known).
// lead = { name, url, headline, company, icpScore, activityScore, activityLabel,
//          painPoint, lastSentText, lastSentAt, lastSentKind, awaitingReply,
//          theirLastBeforeSend, lastReplyAt, lastTheirText, followupDismissedAt,
//          createdAt, updatedAt }

// ─── Backend ──────────────────────────────────────────────────────────────────
// Which analyzer backend to talk to. Editable in the toolbar popup (Settings ->
// Backend URL) and stored with the other settings, so switching between a local
// server and the hosted one needs no code change and no rebuild.
const LI_API_DEFAULT = "http://127.0.0.1:8010";
const LI_API_HOSTED  = "https://linkedin-analyzer-90ne.onrender.com";

function liCleanApiBase(url) {
  const s = String(url || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
}

function liApiBase(settings) {
  return liCleanApiBase((settings || {}).apiBase) || LI_API_DEFAULT;
}

// The admin backend (LeadAgent): it owns the ICP rules, the scoring and the
// database. Scores shown here come from it, so the extension and the admin panel
// can never disagree about the same person.
const LI_ADMIN_DEFAULT = "http://127.0.0.1:8001/api";

function liAdminBase(settings) {
  return liCleanApiBase((settings || {}).adminBase) || LI_ADMIN_DEFAULT;
}

const LI_LEADS_KEY = "liLeads";
const LI_SETTINGS_KEY = "liSettings";
// Developer-only settings: { devMode, apifyToken }. Kept out of liSettings on purpose -
// content.js reads the whole of liSettings on linkedin.com, and the token must never
// reach LinkedIn's page. Only the background worker and the popup read this key.
const LI_DEV_KEY = "liDev";
const LI_DEFAULT_FOLLOWUP_DAYS = 3;

function liLeadSlug(url) {
  const m = String(url || "").match(/\/in\/([^/?#]+)/i);
  if (!m) return "";
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch (e) { return m[1].toLowerCase(); }
}

function liProfileUrl(url) {
  const slug = liLeadSlug(url);
  return slug ? "https://www.linkedin.com/in/" + encodeURIComponent(slug) + "/" : "";
}

function liLeadKey(url, name) {
  const slug = liLeadSlug(url);
  if (slug) return "in:" + slug;
  const nm = String(name || "").trim().toLowerCase();
  return nm ? "name:" + nm : "";
}

// Existing record for this person: by profile link first, then by full name.
function liFindLeadKey(leads, url, name) {
  const key = liLeadKey(url, "");
  if (key && leads[key]) return key;
  const nm = String(name || "").trim().toLowerCase();
  if (!nm) return key || "";
  for (const [k, l] of Object.entries(leads)) {
    if (String(l.name || "").trim().toLowerCase() === nm) return k;
  }
  return key || "name:" + nm;
}

// Sent a message / invite note, no reply yet, older than `days`, not dismissed.
function liDueFollowups(leads, days, now) {
  now = now || Date.now();
  const ms = (days || LI_DEFAULT_FOLLOWUP_DAYS) * 86400000;
  return Object.entries(leads || {})
    .map(([key, l]) => Object.assign({ key }, l))
    .filter((l) => l.awaitingReply && l.lastSentAt && now - l.lastSentAt >= ms &&
      !(l.followupDismissedAt && l.followupDismissedAt >= l.lastSentAt))
    .sort((a, b) => a.lastSentAt - b.lastSentAt);
}

function liLeadsToCsv(leads) {
  const cols = [
    ["Name", "name"], ["Profile URL", "url"], ["Headline", "headline"], ["Company", "company"],
    ["ICP score", "icpScore"], ["Activity score", "activityScore"], ["Activity label", "activityLabel"],
    ["Pain point", "painPoint"], ["Last sent", "lastSentAt"], ["Last sent type", "lastSentKind"],
    ["Last sent message", "lastSentText"], ["Awaiting reply", "awaitingReply"],
    ["Last reply", "lastReplyAt"], ["Their last message", "lastTheirText"], ["Updated", "updatedAt"],
  ];
  const cell = (v, field) => {
    if (v === undefined || v === null) v = "";
    if (/At$/.test(field) && v) v = new Date(v).toISOString().replace("T", " ").slice(0, 16);
    if (typeof v === "boolean") v = v ? "yes" : "no";
    return '"' + String(v).replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
  };
  const rows = Object.values(leads || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return "﻿" + [cols.map((c) => cell(c[0], "")).join(",")]
    .concat(rows.map((l) => cols.map((c) => cell(l[c[1]], c[1])).join(",")))
    .join("\r\n");
}

// ─── Sign-in ──────────────────────────────────────────────────────────────────
// chrome.storage.local["liAuth"] = { email, name, token, signedInAt }.
// One session, shared by everything: the popup gates its tabs on it, content.js
// gates the score panels and ✨ AI on linkedin.com, and signing out anywhere is
// seen everywhere through chrome.storage.onChanged. The password is never stored.
const LI_AUTH_KEY = "liAuth";

const liAuthValid = (auth) => !!(auth && auth.token && auth.email);

function liGetAuth(cb) {
  try { chrome.storage.local.get([LI_AUTH_KEY], (r) => cb((r && r[LI_AUTH_KEY]) || null)); }
  catch (e) { cb(null); }
}

const liEmailLooksReal = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "").trim());

// "harsh.patel@acme.com" → "Harsh Patel", so the popup can greet someone by name
// before the backend has a name field to send.
function liNameFromEmail(email) {
  return String(email || "").split("@")[0].split(/[._-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── The one function to replace when the backend grows accounts ───────────────
// Everything else — the form, the gate, the session, the sign-out — is already
// built against a real answer. This stub only checks that the credentials are
// filled in and well-formed; it does NOT verify anyone, so treat the gate as a
// lock on this browser, not as security.
//
// To go live, replace the body with the request and change nothing else. It must
// resolve to { email, name, token } or throw an Error whose message is shown on
// the form (so write it for the person reading it, not for a log):
//
//   const resp = await fetch(base + "/auth/login", {
//     method: "POST", headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ email, password }),
//   });
//   const data = await resp.json().catch(() => ({}));
//   if (resp.status === 401) throw new Error("That email and password don't match. Check both and try again.");
//   if (!resp.ok) throw new Error(data.detail || "Sign-in is unavailable right now — try again in a moment.");
//   return { email: data.email, name: data.name || liNameFromEmail(data.email), token: data.token };
async function liRequestSignIn(email, password) {
  email = String(email || "").trim();
  password = String(password || "");
  if (!email) throw new Error("Enter the email you use for this extension.");
  if (!liEmailLooksReal(email)) throw new Error("That email doesn't look right — check for a typo.");
  if (!password) throw new Error("Enter your password.");
  if (password.length < 6) throw new Error("Passwords are at least 6 characters.");
  return { email, name: liNameFromEmail(email), token: "local-" + Date.now().toString(36) };
}

// Runs the sign-in and, only if it succeeds, saves the session. Resolves with it.
function liSignIn(email, password) {
  return liRequestSignIn(email, password).then((session) => new Promise((resolve) => {
    const auth = Object.assign({ signedInAt: Date.now() }, session);
    chrome.storage.local.set({ [LI_AUTH_KEY]: auth }, () => resolve(auth));
  }));
}

// Leads, scores and settings survive: signing out locks the extension, it does
// not throw away the work.
function liSignOut(cb) {
  chrome.storage.local.remove(LI_AUTH_KEY, () => cb && cb());
}
