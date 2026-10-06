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
// Where the admin's web app is, when the admin doesn't say (its /auth/config does).
const LI_ADMIN_UI_DEFAULT = "http://localhost:5173";

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
// The extension signs in to the admin with a personal extension key (Admin → your
// name → Account & extension keys). The admin decides who that is: each user has
// their own workspace there, and the key only ever reaches that user's data.
//
// chrome.storage.local["liAuth"] = { v, email, name, signedInAt } - who is signed in.
//   Read everywhere: the popup gates its tabs on it, content.js gates the panels on
//   linkedin.com, and signing out anywhere is seen everywhere through onChanged.
// chrome.storage.local["liAuthKey"] = the key itself. Read only by the background
//   worker and the popup, never by content.js, so it never sits in a LinkedIn tab.
// chrome.storage.local["liOwner"] = whose leads are stored in this browser, so signing
//   in as someone else clears them first and a sync can never hand one user's leads
//   to another.
const LI_AUTH_KEY = "liAuth";
const LI_AUTH_TOKEN_KEY = "liAuthKey";
const LI_OWNER_KEY = "liOwner";
// Sessions from before real sign-in (a local stand-in token) are not valid any more.
const LI_AUTH_VERSION = 2;

const liAuthValid = (auth) => !!(auth && auth.v === LI_AUTH_VERSION && auth.email);

function liGetAuth(cb) {
  try { chrome.storage.local.get([LI_AUTH_KEY], (r) => cb((r && r[LI_AUTH_KEY]) || null)); }
  catch (e) { cb(null); }
}

function liGetAuthToken() {
  return new Promise((res) => {
    try { chrome.storage.local.get([LI_AUTH_TOKEN_KEY], (r) => res((r && r[LI_AUTH_TOKEN_KEY]) || "")); }
    catch (e) { res(""); }
  });
}

// "harsh.patel@acme.com" -> "Harsh Patel", for an account with no name set yet.
function liNameFromEmail(email) {
  return String(email || "").split("@")[0].split(/[._-]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const liStore = {
  get: (keys) => new Promise((res) => chrome.storage.local.get(keys, (r) => res(r || {}))),
  set: (items) => new Promise((res) => chrome.storage.local.set(items, res)),
  remove: (keys) => new Promise((res) => chrome.storage.local.remove(keys, res)),
};

// Asks the admin who this key belongs to. Resolves to { email, name, token, base } or
// throws an Error written for the person reading the form.
async function liRequestSignIn(key, adminUrl) {
  key = String(key || "").trim();
  if (!key) throw new Error("Paste your extension key.");
  if (!/^la_[A-Za-z0-9_-]{20,}$/.test(key)) {
    throw new Error("That doesn't look like an extension key. Keys start with la_ - copy it again from the admin.");
  }
  const cleanUrl = liCleanApiBase(adminUrl);
  if (String(adminUrl || "").trim() && !cleanUrl) throw new Error("The admin address isn't a URL.");
  const base = cleanUrl || LI_ADMIN_DEFAULT;
  let resp;
  try {
    resp = await fetch(base + "/auth/me", { headers: { Authorization: "Bearer " + key } });
  } catch (e) {
    throw new Error("Can't reach the admin at " + base + ". Check the address and that it is running.");
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) throw new Error("That key isn't valid or was revoked. Create a new one in the admin under Account.");
  if (!resp.ok || !data.user) throw new Error(data.detail || "The admin answered " + resp.status + ". Try again in a moment.");
  return { email: data.user.email, name: data.user.name || liNameFromEmail(data.user.email), token: key, base: cleanUrl };
}

// Everything in this browser that belongs to one user: the lead log, every saved
// score, typed form value and draft, and their ICP / pitch choices. Device settings
// (analyzer and admin addresses, follow-up days, developer keys) stay.
async function liWipeUserData() {
  const all = await liStore.get(null);
  const keys = Object.keys(all).filter((k) => k === LI_LEADS_KEY || /^(liScore|liActForm|liOutreach):/.test(k));
  if (keys.length) await liStore.remove(keys);
  const settings = Object.assign({}, all[LI_SETTINGS_KEY] || {});
  for (const k of ["icpId", "senderRole", "aiSetupDone"]) delete settings[k];
  await liStore.set({ [LI_SETTINGS_KEY]: settings });
}

// Runs the sign-in and, only if it succeeds, saves the session. Resolves with it.
async function liSignIn(key, adminUrl) {
  const s = await liRequestSignIn(key, adminUrl);
  const r = await liStore.get([LI_OWNER_KEY, LI_SETTINGS_KEY]);
  if (r[LI_OWNER_KEY] && r[LI_OWNER_KEY] !== s.email) await liWipeUserData();
  const settings = Object.assign({}, (await liStore.get([LI_SETTINGS_KEY]))[LI_SETTINGS_KEY] || {});
  if (s.base) settings.adminBase = s.base;
  // The key goes in before the session, so nothing sees "signed in" without a key.
  await liStore.set({ [LI_AUTH_TOKEN_KEY]: s.token, [LI_OWNER_KEY]: s.email, [LI_SETTINGS_KEY]: settings });
  const auth = { v: LI_AUTH_VERSION, email: s.email, name: s.name, signedInAt: Date.now() };
  await liStore.set({ [LI_AUTH_KEY]: auth });
  return auth;
}

// Signing out forgets the key; leads and scores stay for when the same person signs
// back in (signing in as someone else clears them).
function liSignOut(cb) {
  chrome.storage.local.remove([LI_AUTH_KEY, LI_AUTH_TOKEN_KEY], () => cb && cb());
}

// ─── Shared helpers (popup, background worker and content scripts all load this) ──
// Text made safe for HTML, inside an element or an attribute.
function liEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// What the analyzer writes for a value it didn't find. Shown as nothing, never as text.
const LI_NA_RE = /^(not specified|unknown|no activity data|no recent activity|no projects)$/i;
function liClean(v) {
  const s = String(v == null ? "" : v).trim();
  return s && !LI_NA_RE.test(s) ? s : "";
}

// How long each kind of call may take, in ms. Apify scrapes and AI are slow, and a
// sleeping Render server adds ~30-50 s, so the long ones are generous.
const LI_TIMEOUTS = {
  analyzer: 45000,        // any analyzer call without its own entry
  analyzerMax: 170000,
  analyze: 150000,        // Activity score: profile + posts from Apify
  suggest: 100000,        // ✨ suggestions
  admin: 15000,           // any admin call without its own entry
  adminMax: 240000,
  adminAnalyze: 220000,   // ICP score: the admin collects through the analyzer first
  saveRules: 30000,       // publishing a new ICP version
  check: 12000,           // the popup's "is it reachable" checks
  workerGrace: 8000,      // extra wait for the background worker itself to answer
};

// One message to the background worker; resolves with its answer, or null when the
// extension was reloaded or the worker didn't answer.
function liAsk(msg) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) return resolve(null);
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res || null);
      });
    } catch (e) { resolve(null); }
  });
}
