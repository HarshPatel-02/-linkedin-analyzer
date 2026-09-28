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
