// LinkedIn AI Analyzer content script - Calls to the analyzer and the admin, the lead log, AI preferences.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ─── Backend calls ─────────────────────────────────────────────────────────────
// Routed through background.js: the extension (not the LinkedIn page) talks to
// the local server, so Chrome's page → localhost restrictions never apply.
// Time limits per call are in LI_TIMEOUTS (leads.js).
const API_TIMEOUTS = { "/analyze": LI_TIMEOUTS.analyze, "/suggest-messages": LI_TIMEOUTS.suggest };

function apiFetch(path, body) {
  const timeoutMs = API_TIMEOUTS[path] || LI_TIMEOUTS.analyzer;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(guard); fn(arg); } };
    const reloaded = () => finish(reject, new Error("Extension was reloaded — refresh this LinkedIn tab"));
    // Safety net in case the background worker never answers
    const guard = setTimeout(() => finish(reject, new Error(`No response after ${Math.round(timeoutMs / 1000)}s — refresh the page and try again`)), timeoutMs + LI_TIMEOUTS.workerGrace);
    try {
      if (!chrome.runtime || !chrome.runtime.id) return reloaded();
      chrome.runtime.sendMessage({ type: "li-api", path, method: body === undefined ? "GET" : "POST", body, timeoutMs }, (res) => {
        if (chrome.runtime.lastError || !res) return reloaded();
        if (res.error) return finish(reject, new Error(res.error));
        if (!res.ok) {
          const d = res.data && res.data.detail;
          return finish(reject, new Error(typeof d === "string" ? d : d ? JSON.stringify(d).slice(0, 200) : `Server error ${res.status}`));
        }
        finish(resolve, res.data);
      });
    } catch (e) { reloaded(); }
  });
}

// ─── Lead log (helpers in leads.js) ────────────────────────────────────────────
function withLeads(fn) {
  try {
    if (!chrome.runtime || !chrome.runtime.id) return;
    chrome.storage.local.get([LI_LEADS_KEY], (r) => {
      const leads = (r && r[LI_LEADS_KEY]) || {};
      fn(leads, () => chrome.storage.local.set({ [LI_LEADS_KEY]: leads }));
    });
  } catch (e) { /* extension reloaded — skip logging */ }
}

// The profile facts the admin panel scores against (role, About text, country).
// Without them a synced lead has only a headline and scores near zero there, so
// they ride along on every lead record. `about` is capped: this is a log, not a copy.
// What the ICP request takes from the page: who this is, nothing about the person.
// The admin collects the profile and company through Apify; the name only identifies
// the lead when no Apify name comes back.
// "Company • Country" for the ICP header, from the Apify data the Activity score fetched.
// Blank until that score has run once for this person: the page is not read for it.
async function apifyMeta() {
  const stored = await loadStoredScores();
  const act = (stored.activity && stored.activity.data) || {};
  return [act.current_company, act.country].filter((v) => v && v !== "Not specified").join(" • ");
}

function icpPageFacts(p) {
  return { profileUrl: p.profileUrl, name: p.name };
}

// What Apify returned for this person. Nothing falls back to the page: a field Apify
// did not return stays blank, and a blank never overwrites a value the admin holds.
function leadProfileFields(data) {
  const val = liClean;
  data = data || {};
  return {
    position: val(data.position) || val(data.headline),
    country: val(data.country),
    about: val(data.about).slice(0, 1200),
    activity: val(data.activity),
  };
}

// Merge `patch` into this person's lead record (created on first sight).
// `done` runs once the record is in storage — the admin push waits for it.
function updateLead(url, name, patch, done) {
  name = String(name || "").split("\n")[0].trim();
  if (!liLeadSlug(url) && !name) return;
  withLeads((leads, save) => {
    const found = liFindLeadKey(leads, url, name);
    const key = liLeadSlug(url) ? liLeadKey(url, name) : found;   // no link → keep the existing record's key
    const base = Object.assign({}, leads[found] || {}, leads[key] || {});
    if (found && found !== key) delete leads[found];   // name-only record → now known by profile link
    leads[key] = Object.assign(base, patch, {
      name: name || base.name || "",
      url: liProfileUrl(url) || base.url || "",
      createdAt: base.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
    save();
    if (typeof done === "function") done();
  });
}

// Send this one person to the LeadAgent admin panel as soon as they are scored.
// Deliberately silent: the panel runs on localhost and is often off, and a score the
// user can already see must never turn into an error. Anything missed is picked up by
// "⇅ Sync to admin" in the toolbar popup, which sends every logged lead.
function pushLeadToAdmin(url, name) {
  try {
    if (!chrome.runtime || !chrome.runtime.id) return;
    chrome.runtime.sendMessage({ type: "li-admin", action: "push", url, name }, (res) => {
      void chrome.runtime.lastError;                     // panel off / worker asleep
      if (res && !res.ok && res.error !== "nothing to push") console.log("[LI-AI] admin push skipped:", res.error);
    });
  } catch (e) { /* extension reloaded — the popup's Sync button still has this lead */ }
}

// The visible chat thread as plain text, oldest first — the shape the admin
// panel's Conversation card reads. Capped at the length it accepts, keeping the
// NEWEST messages when a thread is longer.
const LI_TRANSCRIPT_MAX = 8000;
function transcriptFrom(history) {
  const lines = (history || [])
    .filter((m) => m && String(m.text || "").trim())
    .map((m) => (m.sender === "me" ? "You: " : m.sender === "them" ? "Them: " : "") +
                String(m.text).replace(/\s+/g, " ").trim());
  const text = lines.join("\n");
  return text.length > LI_TRANSCRIPT_MAX ? text.slice(text.length - LI_TRANSCRIPT_MAX) : text;
}

// Keep the thread itself on the lead, so the admin panel can show and analyze the
// real conversation instead of asking for it to be pasted. Only for people already
// in the lead log — reading a chat is not a reason to start tracking someone.
function noteConversation(history, url, name) {
  noteReplies(history, url, name);
  const transcript = transcriptFrom(history);
  if (!transcript) return;
  withLeads((leads, save) => {
    const lead = leads[liFindLeadKey(leads, url, name)];
    if (!lead || lead.transcript === transcript) return;
    Object.assign(lead, {
      transcript,
      messageCount: history.length,
      transcriptAt: Date.now(),
      updatedAt: Date.now(),
    });
    save();
  });
}

// Their newest message is new since my last send → they replied, stop the follow-up.
function noteReplies(history, url, name) {
  const last = history && history[history.length - 1];
  if (!last || last.sender !== "them") return;
  withLeads((leads, save) => {
    const lead = leads[liFindLeadKey(leads, url, name)];
    if (!lead || !lead.awaitingReply) return;
    if (lead.theirLastBeforeSend && lead.theirLastBeforeSend === last.text.slice(0, 300)) return;
    Object.assign(lead, { awaitingReply: false, lastReplyAt: Date.now(), lastTheirText: last.text.slice(0, 300), updatedAt: Date.now() });
    save();
  });
}

// Saved ICP / Activity scores for this person → how direct the AI message should be.
function getLeadScores(url, name) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) return resolve({});
      chrome.storage.local.get(null, (all) => {
        const out = {};
        const leads = (all && all[LI_LEADS_KEY]) || {};
        const lead = leads[liFindLeadKey(leads, url, name)];
        if (lead && lead.icpScore != null) out.icp_score = Math.round(lead.icpScore);
        if (lead && lead.activityScore != null) { out.activity_score = Math.round(lead.activityScore); out.activity_label = lead.activityLabel || ""; }
        if (lead && lead.awaitingReply && lead.lastSentAt) out.awaiting_reply_days = Math.floor((Date.now() - lead.lastSentAt) / 86400000);
        // Who they are, as Apify described them when they were scored - never this page
        for (const [key, field] of [["headline", "headline"], ["position", "position"], ["current_company", "company"], ["country", "country"]]) {
          if (lead && lead[field]) out[key] = String(lead[field]).slice(0, 300);
        }
        // Scores saved on the profile page before the lead log existed ("liScore:<url>")
        const slug = liLeadSlug(url);
        for (const [k, v] of Object.entries(all || {})) {
          if (!slug || !k.startsWith("liScore:") || liLeadSlug(k) !== slug || !v) continue;
          if (out.icp_score == null && v.icp && v.icp.data && v.icp.data.result) out.icp_score = Math.round(v.icp.data.result.icp_score || 0);
          if (out.activity_score == null && v.activity && v.activity.data) {
            out.activity_score = Math.round(v.activity.data.score_total || 0);
            out.activity_label = v.activity.data.score_label || "";
          }
        }
        resolve(out);
      });
    } catch (e) { resolve({}); }
  });
}

// ─── AI message preferences: sender role ─────────────────────────────────────
// Set once in the extension's toolbar popup (icon → "My pitch": role) and stored
// in liSettings; every AI surface on the page reads it here. Tone is NOT a saved
// setting — it is picked on each AI note / AI suggestion, right where you write.
function loadAiPrefs() {
  return storageGet([LI_SETTINGS_KEY]).then((r) => r[LI_SETTINGS_KEY] || {});
}

// The tone last picked on any AI surface, so the next note opens on it instead of
// resetting. Per-message choice still wins: every picker writes back through here.
// Tone precedence: this composer's own toggle → a toggle made anywhere this
// session → casual. There is no saved tone setting to fall back to.
let lastAiTone = "casual";
const cleanTone = (t) => (t === "pro" ? "pro" : "casual");
function rememberAiTone(t) { return (lastAiTone = cleanTone(t)); }
