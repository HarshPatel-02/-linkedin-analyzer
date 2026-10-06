importScripts("leads.js");

// Resolved per request from the saved setting, so changing Backend URL in the
// popup takes effect immediately - no service-worker restart, no rebuild.
function apiBase() {
  return new Promise((res) =>
    chrome.storage.local.get([LI_SETTINGS_KEY], (r) => res(liApiBase((r && r[LI_SETTINGS_KEY]) || {}))));
}

// The Apify token and the analyzer's server key, both set in the popup's Development
// section and read per request like the URLs above, so a newly saved value is used on
// the very next call. A hosted (Render) analyzer refuses a request without the key.
function devHeaders() {
  return new Promise((res) =>
    chrome.storage.local.get([LI_DEV_KEY], (r) => {
      const dev = (r && r[LI_DEV_KEY]) || {};
      const headers = {};
      const token = String(dev.apifyToken || "").trim();
      const key = String(dev.apiKey || "").trim();
      if (token) headers["X-Apify-Token"] = token;
      if (key) headers["X-Api-Key"] = key;
      res(headers);
    }));
}

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
    const timeoutMs = Math.max(5000, Math.min(Number(msg.timeoutMs) || LI_TIMEOUTS.analyzer, LI_TIMEOUTS.analyzerMax));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      // Every analyzer call carries the token, GETs included: the analyzer is the one
      // service that talks to Apify, and it no longer reads a token of its own.
      const init = { method: msg.method || "GET", signal: ctrl.signal, headers: await devHeaders() };
      if (msg.body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(msg.body);
      }
      const base = await apiBase();
      const resp = await fetch(base + msg.path, init);
      const data = await resp.json().catch(() => ({}));
      sendResponse({ ok: resp.ok, status: resp.status, data });
    } catch (e) {
      const error = e && e.name === "AbortError"
        ? `Timed out after ${Math.round(timeoutMs / 1000)}s — the server may be waking up (Render free tier sleeps when idle) or the scrape is slow. Try again.`
        : "Backend unreachable at " + (await apiBase()) + " — start it, or set Backend URL in the extension popup";
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
// Resolved per request from the saved setting, like the analyzer base, so
// switching between a local admin and a hosted one needs no code change.
function adminBase() {
  return new Promise((res) =>
    chrome.storage.local.get([LI_SETTINGS_KEY], (r) => res(liAdminBase((r && r[LI_SETTINGS_KEY]) || {}))));
}

// The admin panel upserts by the profile's /in/<slug>, so one lead or all of them
// go to the same endpoint in the same shape.
const syncBody = (leads) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads }) });

// The first of these that holds a real value (see liClean in leads.js).
const liVal = (...vals) => vals.map(liClean).find(Boolean) || "";

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
      // When that newest post went up and where it is, so the admin's Activity card can
      // show and link it. Apify's own values, from the stored Activity score.
      activityDate: liVal(a.activity_date),
      activityUrl: /^https?:\/\//i.test(String(a.activity_url || "")) ? a.activity_url : "",
    });
  });
}

// Erase people from this browser: their lead record and every score, form value and
// outreach draft stored under their profile. `people` are {url, name}.
async function forgetLocally(people) {
  const all = await new Promise((res) => chrome.storage.local.get(null, res));
  const leads = Object.assign({}, (all && all[LI_LEADS_KEY]) || {});
  const slugs = new Set(people.map((p) => liLeadSlug(p.url) || liLeadSlug(p.name)).filter(Boolean));
  for (const p of people) {
    const key = liFindLeadKey(leads, p.url, p.name);
    if (key) delete leads[key];
  }
  const stores = Object.keys(all || {}).filter((k) => /^(liScore|liActForm|liOutreach):/.test(k) && slugs.has(liLeadSlug(k)));
  await new Promise((res) => chrome.storage.local.set({ [LI_LEADS_KEY]: leads }, res));
  if (stores.length) await new Promise((res) => chrome.storage.local.remove(stores, res));
}

// A sync answers with the people deleted in the admin; they go from here too, or the
// next sync would send them straight back.
async function dropRemoved(data) {
  const removed = (data && Array.isArray(data.removed)) ? data.removed : [];
  if (removed.length) await forgetLocally(removed.map((x) => (/^https?:/i.test(x) ? { url: x, name: "" } : { url: "", name: x })));
  return data;
}

class SignedOutError extends Error {}

// Every admin call is made as the signed-in user: their extension key reaches only
// their own workspace. A refused key (revoked, or the user removed) signs the
// extension out everywhere, so it asks for a new key instead of failing quietly.
async function adminFetch(path, init, timeoutMs) {
  const token = await liGetAuthToken();
  if (!token) throw new Error("Sign in to the extension first: open it from the toolbar.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(5000, Math.min(timeoutMs || LI_TIMEOUTS.admin, LI_TIMEOUTS.adminMax)));
  try {
    const base = await adminBase();
    const opts = Object.assign({ signal: ctrl.signal }, init);
    opts.headers = Object.assign({}, (init && init.headers) || {}, { Authorization: "Bearer " + token });
    const resp = await fetch(base + path, opts);
    const data = await resp.json().catch(() => ({}));
    if (resp.status === 401) {
      await new Promise((res) => chrome.storage.local.remove([LI_AUTH_KEY, LI_AUTH_TOKEN_KEY], res));
      throw new SignedOutError("Your sign-in ended (the key was revoked or the account removed). Open the extension and sign in again.");
    }
    if (!resp.ok) throw new Error(data.detail || "admin backend error " + resp.status);
    return data;
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "admin backend timed out"
      : (e.message || "admin backend unreachable - check the Admin URL in the extension popup"));
  } finally { clearTimeout(timer); }
}

// A JSON request body for adminFetch.
const jsonBody = (method, body, extraHeaders) => ({
  method, headers: Object.assign({ "Content-Type": "application/json" }, extraHeaders || {}), body: JSON.stringify(body),
});

const storedLeads = async () => ((await liStore.get([LI_LEADS_KEY]))[LI_LEADS_KEY]) || {};

// Every admin action the popup and the content scripts can ask for. Each returns the
// answer to send back; a thrown error becomes { ok: false, error }.
const ADMIN_ACTIONS = {
  status: async () => ({ ok: true, data: await adminFetch("/extension/status") }),

  sync: async () => {
    const leads = Object.values(await storedLeads());
    if (!leads.length) return { ok: false, error: "No leads logged yet — analyze a profile first." };
    return { ok: true, data: await dropRemoved(await adminFetch("/extension/sync", { method: "POST", ...syncBody(await enrichLeads(leads)) })) };
  },

  // One freshly scored person, sent the moment content.js saves the score. Fire-and-forget:
  // the page never waits for this, so a stopped admin just means "sync it later".
  push: async (msg) => {
    const leads = await storedLeads();
    const lead = leads[liFindLeadKey(leads, msg.url, msg.name) || ""];
    if (!lead || !(lead.name || lead.url)) return { ok: false, error: "nothing to push" };
    return { ok: true, data: await dropRemoved(await adminFetch("/extension/sync", { method: "POST", ...syncBody(await enrichLeads([lead])) })) };
  },

  // Removing a lead in the popup. Erased here first, so it works with the admin switched
  // off; then the admin erases its copy and remembers the removal.
  forget: async (msg) => {
    const person = { url: String(msg.url || ""), name: String(msg.name || "") };
    await forgetLocally([person]);
    try {
      await adminFetch("/extension/forget", jsonBody("POST", person));
      return { ok: true, admin: true };
    } catch (e) {
      return { ok: true, admin: false, error: e.message };
    }
  },

  // The published ICPs and which one scores: a few hundred bytes for the dropdown.
  icps: async () => ({ ok: true, data: { icps: (await adminFetch("/icp/options")) || [] } }),

  // The full rules of the ICP in force, so the panel can show what it scores with.
  "icp-selected": async () => ({ ok: true, data: await adminFetch("/icp/selected") }),

  // Editing rules publishes a new ICP version; the answer is that published ICP.
  "save-rules": async (msg) => ({ ok: true, data: await adminFetch("/icp/selected/rules",
    jsonBody("PUT", { fields: msg.fields || {} }), LI_TIMEOUTS.saveRules) }),

  // Picking in the extension moves the workspace selection, so the admin shows the same ICP.
  "select-icp": async (msg) => ({ ok: true, data: await adminFetch("/icp/selected",
    jsonBody("PUT", { icpId: msg.icpId || null })) }),

  // The one call that produces a score: the admin collects (through the analyzer, so the
  // Apify token and server key ride along), scores against the selected ICP and stores it.
  analyze: async (msg) => ({ ok: true, data: await adminFetch("/extension/analyze", jsonBody("POST", {
    profileUrl: msg.profileUrl || "", scraped: msg.scraped || {},
    collect: msg.collect !== false, icpId: msg.icpId || null,
  }, await devHeaders()), LI_TIMEOUTS.adminAnalyze) }),

  // This user's own Activity points and keywords, kept in their workspace in the admin.
  "activity-settings": async () => ({ ok: true, data: await adminFetch("/me/activity-settings") }),
  "save-activity-settings": async (msg) => ({ ok: true, data: await adminFetch("/me/activity-settings",
    jsonBody("PUT", { points: msg.points || {}, keywords: msg.keywords || {} })) }),

  // One lead as the admin holds it now, so a stored ICP score can catch up with a re-score.
  lead: async (msg) => ({ ok: true, data: await adminFetch("/leads/" + encodeURIComponent(String(msg.leadId || ""))) }),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "li-admin") return false;
  const action = Object.prototype.hasOwnProperty.call(ADMIN_ACTIONS, msg.action) ? ADMIN_ACTIONS[msg.action] : null;
  if (!action) { sendResponse({ ok: false, error: "unknown admin action" }); return false; }
  action(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
  return true;   // keep the channel open for the async reply
});

// ─── Sign in from the page ────────────────────────────────────────────────────
// The "Open the extension" button on the in-page sign-in prompt. A content script
// cannot open the toolbar popup itself, and chrome.action.openPopup() is Chrome
// 127+ and can still be refused, so the answer says which happened and the page
// falls back to pointing at the toolbar icon.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "li-open-popup") return false;
  (async () => {
    try {
      if (!chrome.action || !chrome.action.openPopup) throw new Error("this Chrome version cannot open it for you");
      await chrome.action.openPopup();
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: (e && e.message) || "could not open the popup" });
    }
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
