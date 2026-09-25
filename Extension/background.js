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
// content.js → {type:"li-api", path, method, body} → local FastAPI server.
// The request comes from the extension (host_permissions), not from linkedin.com.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "li-api") return false;
  (async () => {
    try {
      const init = { method: msg.method || "GET" };
      if (msg.body !== undefined) {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(msg.body);
      }
      const resp = await fetch(API_BASE + msg.path, init);
      const data = await resp.json().catch(() => ({}));
      sendResponse({ ok: resp.ok, status: resp.status, data });
    } catch (e) {
      sendResponse({ ok: false, status: 0, data: {}, error: "backend not running at " + API_BASE + " — start uvicorn" });
    }
  })();
  return true;   // keep the channel open for the async reply
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
