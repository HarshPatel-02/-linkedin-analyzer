importScripts("leads.js");

const API_BASE = "https://linkedin-analyzer-90ne.onrender.com";

// Alarms can be cleared on browser restart → (re)create on install and startup.
function startFollowupAlarm() {
  chrome.alarms.create("li-followups", { periodInMinutes: 60 });
  refreshBadge();
}
chrome.runtime.onInstalled.addListener(() => {
  console.log("[LI-AI] Extension installed");
  startFollowupAlarm();
});
chrome.runtime.onStartup.addListener(startFollowupAlarm);

// ─── Backend proxy ─────────────────────────────────────────────────────────────
// content.js → {type:"li-api", path, method, body, timeoutMs} → FastAPI backend.
// The request comes from the extension (host_permissions), not from linkedin.com.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "li-api") return false;
  (async () => {
    const timeoutMs = Math.max(5000, Math.min(Number(msg.timeoutMs) || 45000, 170000));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const init = { method: msg.method || "GET", signal: ctrl.signal };
      if (msg.body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(msg.body);
      }
      const resp = await fetch(API_BASE + msg.path, init);
      const data = await resp.json().catch(() => ({}));
      sendResponse({ ok: resp.ok, status: resp.status, data });
    } catch (e) {
      const error = e && e.name === "AbortError"
        ? `Timed out after ${Math.round(timeoutMs / 1000)}s — the server may be waking up (Render free tier sleeps when idle) or the scrape is slow. Try again.`
        : "Backend unreachable at " + API_BASE + " — it may be waking up (Render free tier sleeps when idle), wait ~30s and try again";
      sendResponse({ ok: false, status: 0, data: {}, error });
    } finally {
      clearTimeout(timer);
    }
  })();
  return true;   // keep the channel open for the async reply
});

// ─── Admin panel (LeadAgent) sync ──────────────────────────────────────────────
// popup → {type:"li-admin", action:"status"|"sync"} and content.js → action:"push"
// → LeadAgent backend. Runs here (not in the page or popup) so host_permissions
// apply and CORS never blocks.
const ADMIN_API = "http://127.0.0.1:8001/api";

// The admin panel upserts by the profile's /in/<slug>, so one lead or all of them
// go to the same endpoint in the same shape.
const syncBody = (leads) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads }) });

const LI_NA_RE = /^(not specified|unknown|no activity data|no recent activity|no projects)$/i;
const liVal = (...vals) => {
  for (const v of vals) {
    const s = String(v == null ? "" : v).trim();
    if (s && !LI_NA_RE.test(s)) return s;
  }
  return "";
};

// A lead record holds only what the lead log tracks, but the full analysis for the
// same person is already saved under "liScore:<profile url>" (role, country, About,
// latest activity). Merging it means leads logged before those fields were tracked
// still reach the admin complete — without re-analyzing anyone.
async function enrichLeads(leads) {
  const all = await new Promise((res) => chrome.storage.local.get(null, res));
  const scores = Object.entries(all || {}).filter(([k, v]) => k.startsWith("liScore:") && v);
  return leads.map((lead) => {
    const slug = liLeadSlug(lead.url) || liLeadSlug(lead.name);
    const hit = slug ? scores.find(([k]) => liLeadSlug(k) === slug) : null;
    const a = (hit && hit[1].activity && hit[1].activity.data) || {};
    return Object.assign({}, lead, {
      name: liVal(lead.name, a.name),
      headline: liVal(lead.headline, a.headline),
      position: liVal(lead.position, a.position, a.headline),
      company: liVal(lead.company, a.current_company),
      country: liVal(lead.country, a.country),
      about: liVal(lead.about, a.about).slice(0, 1200),
      activity: liVal(lead.activity, a.activity),
    });
  });
}

async function adminFetch(path, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(ADMIN_API + path, Object.assign({ signal: ctrl.signal }, init));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.detail || "admin backend error " + resp.status);
    return data;
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "admin backend timed out"
      : (e.message || "admin backend unreachable — start it: uvicorn app.main:app --port 8001"));
  } finally { clearTimeout(timer); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "li-admin") return false;
  (async () => {
    try {
      if (msg.action === "status") {
        sendResponse({ ok: true, data: await adminFetch("/extension/status") });
      } else if (msg.action === "sync") {
        const r = await new Promise((res) => chrome.storage.local.get([LI_LEADS_KEY], res));
        const leads = Object.values(r[LI_LEADS_KEY] || {});
        if (!leads.length) { sendResponse({ ok: false, error: "No leads logged yet — analyze a profile first." }); return; }
        sendResponse({ ok: true, data: await adminFetch("/extension/sync", { method: "POST", ...syncBody(await enrichLeads(leads)) }) });
      } else if (msg.action === "push") {
        // One freshly scored person, sent the moment content.js saves the score.
        // Fire-and-forget: the page never waits for this and never shows its errors,
        // so a stopped admin panel just means "sync it later" (the popup button).
        const r = await new Promise((res) => chrome.storage.local.get([LI_LEADS_KEY], res));
        const leads = r[LI_LEADS_KEY] || {};
        const lead = leads[liFindLeadKey(leads, msg.url, msg.name) || ""];
        if (!lead || !(lead.name || lead.url)) { sendResponse({ ok: false, error: "nothing to push" }); return; }
        sendResponse({ ok: true, data: await adminFetch("/extension/sync", { method: "POST", ...syncBody(await enrichLeads([lead])) }) });
      } else {
        sendResponse({ ok: false, error: "unknown admin action" });
      }
    } catch (e) { sendResponse({ ok: false, error: e.message }); }
  })();
  return true;
});

// ─── Follow-up badge: number of people due a follow-up ────────────────────────
function refreshBadge() {
  chrome.storage.local.get([LI_LEADS_KEY, LI_SETTINGS_KEY], (r) => {
    const days = ((r && r[LI_SETTINGS_KEY]) || {}).followupDays || LI_DEFAULT_FOLLOWUP_DAYS;
    const due = liDueFollowups((r && r[LI_LEADS_KEY]) || {}, days).length;
    chrome.action.setBadgeText({ text: due ? String(due) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#7c3aed" });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "li-followups") refreshBadge(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[LI_LEADS_KEY] || changes[LI_SETTINGS_KEY])) refreshBadge();
});
