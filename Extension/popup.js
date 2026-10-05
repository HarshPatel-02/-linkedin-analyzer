let API_BASE = LI_API_DEFAULT;   // replaced by the saved setting on load
const PITCH_FIELDS = ["who", "expertise", "offer", "services", "casual_opener"];

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function ago(ts) {
  if (!ts) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return mins + " min ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.round(hrs / 24) + "d ago";
}

function openUrl(url) { if (url) chrome.tabs.create({ url }); }

// ─── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll("nav [data-tab]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav [data-tab]").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("main section").forEach((sec) => { sec.hidden = sec.id !== "tab-" + b.dataset.tab; });
    if (b.dataset.tab === "pitch") loadApiBase(loadPitch);
  };
});

// ─── Follow-ups + Leads (chrome.storage.local) ────────────────────────────────
function load(cb) {
  chrome.storage.local.get([LI_LEADS_KEY, LI_SETTINGS_KEY], (r) => {
    cb((r && r[LI_LEADS_KEY]) || {}, (r && r[LI_SETTINGS_KEY]) || {});
  });
}

function render() {
  load((leads, settings) => {
    const days = settings.followupDays || LI_DEFAULT_FOLLOWUP_DAYS;
    $("followup-days").value = days;

    const due = liDueFollowups(leads, days);
    $("due-count").hidden = !due.length;
    $("due-count").textContent = due.length;
    $("due-list").innerHTML = due.length ? due.map((l) =>
      '<div class="card">' +
        '<div class="name">' + esc(l.name || "Unknown") + "</div>" +
        '<div class="meta">' + (l.lastSentKind === "invite" ? "Invite note" : "Message") + " sent " + esc(ago(l.lastSentAt)) + " · no reply yet</div>" +
        '<div class="text">' + esc((l.lastSentText || "").slice(0, 160)) + "</div>" +
        '<div class="actions">' +
          (l.url ? '<button type="button" class="btn primary" data-open="' + esc(l.url) + '">Open profile</button>' : "") +
          '<button type="button" class="btn" data-done="' + esc(l.key) + '">Done</button>' +
        "</div>" +
      "</div>").join("")
      : '<div class="empty">🎉 No follow-ups due.<br>Messages and invite notes you send on LinkedIn are tracked here.</div>';

    const waiting = Object.values(leads).filter((l) => l.awaitingReply).length - due.length;
    $("waiting-line").textContent = waiting > 0 ? waiting + " more waiting for a reply (not due yet)." : "";

    const list = Object.values(leads).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    $("lead-count").textContent = list.length + " lead" + (list.length === 1 ? "" : "s") + " logged";
    $("lead-list").innerHTML = list.length ? list.slice(0, 40).map((l) =>
      '<div class="card">' +
        '<div class="name">' + esc(l.name || "Unknown") + "</div>" +
        '<div class="meta">' + esc([l.headline, l.company].filter(Boolean).join(" · ").slice(0, 90)) + "</div>" +
        "<div>" +
          (l.icpScore != null ? '<span class="chip">ICP ' + esc(l.icpScore) + "</span>" : "") +
          (l.activityScore != null ? '<span class="chip">Activity ' + esc(l.activityScore) + "</span>" : "") +
          (l.awaitingReply ? '<span class="chip">awaiting reply</span>' : "") +
        "</div>" +
        (l.painPoint ? '<div class="text" style="margin-top:4px;">🎯 ' + esc(l.painPoint) + "</div>" : "") +
        (l.url ? '<div class="actions"><button type="button" class="btn" data-open="' + esc(l.url) + '">Open profile</button></div>' : "") +
      "</div>").join("")
      : '<div class="empty">No leads yet. Scores (Activity / ICP), ✨ pain points and sent messages are logged here.</div>';

    document.querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => openUrl(b.dataset.open); });
    document.querySelectorAll("[data-done]").forEach((b) => {
      b.onclick = () => load((all) => {
        const lead = all[b.dataset.done];
        if (!lead) return;
        lead.followupDismissedAt = Date.now();
        chrome.storage.local.set({ [LI_LEADS_KEY]: all }, render);
      });
    });
  });
}

$("followup-days").onchange = () => {
  const days = Math.max(1, Math.min(30, parseInt($("followup-days").value, 10) || LI_DEFAULT_FOLLOWUP_DAYS));
  load((_, settings) => chrome.storage.local.set({ [LI_SETTINGS_KEY]: Object.assign(settings, { followupDays: days }) }, render));
};

$("export-csv").onclick = () => load((leads) => {
  const blob = new Blob([liLeadsToCsv(leads)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "linkedin-leads-" + new Date().toISOString().slice(0, 10) + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$("clear-leads").onclick = () => {
  if (!confirm("Delete all logged leads and follow-ups? Export a CSV first if you need them.")) return;
  chrome.storage.local.remove(LI_LEADS_KEY, render);
};

// ─── Admin panel (LeadAgent) connection ───────────────────────────────────────
const ADMIN_LEADS_URL = "http://localhost:5173/leads";
const adminMsg = (action) => new Promise((res) => chrome.runtime.sendMessage({ type: "li-admin", action }, res));

async function adminStatus() {
  const r = await adminMsg("status");
  if (!r || !r.ok) { $("admin-status").textContent = "⚪ Admin panel not connected (" + esc((r && r.error) || "no response") + ")"; return null; }
  const d = r.data;
  const sso = d.ssoConfigured ? (d.ssoConnected ? "SSO: " + (d.ssoName || "connected") : "SSO not connected") : "SSO not configured (dev)";
  $("admin-status").textContent = "🟢 Connected · " + sso + " · active ICP: " +
    (d.activeIcp ? d.activeIcp.name : "none") + " · " + d.syncedLeads + " synced";
  return d;
}

$("admin-open").onclick = () => openUrl(ADMIN_LEADS_URL);
$("admin-sync").onclick = async () => {
  $("admin-sync").disabled = true;
  $("admin-status").textContent = "Syncing…";
  try {
    const r = await adminMsg("sync");
    if (!r || !r.ok) throw new Error((r && r.error) || "no response");
    const d = r.data;
    $("admin-status").textContent = d.synced
      ? "✅ Synced " + d.synced + " lead" + (d.synced === 1 ? "" : "s") +
        ' to ICP "' + esc(d.icpName) + '" — open the admin to see them.'
      : "⚠️ Nothing synced: all " + (d.received || 0) + " logged lead" + (d.received === 1 ? "" : "s") +
        " lack a profile link and a name, so they can't be identified.";
  } catch (e) {
    $("admin-status").textContent = "❌ Sync failed: " + esc(e.message);
  } finally {
    $("admin-sync").disabled = false;
  }
};
document.querySelector('nav [data-tab="leads"]').addEventListener("click", () => { adminStatus(); });

// ─── Backend URL ──────────────────────────────────────────────────────────────
// Saved with the other settings and read by background.js on every request, so a
// local server and the hosted one are one field apart.
function loadApiBase(cb) {
  chrome.storage.local.get([LI_SETTINGS_KEY], (r) => {
    const settings = (r && r[LI_SETTINGS_KEY]) || {};
    API_BASE = liApiBase(settings);
    $("api-base").value = settings.apiBase || "";
    $("admin-base").value = settings.adminBase || "";
    $("admin-base").placeholder = LI_ADMIN_DEFAULT;
    $("api-base").placeholder = LI_API_DEFAULT;
    if (cb) cb();
  });
}

async function saveApiBase(url) {
  const clean = liCleanApiBase(url);
  if (url.trim() && !clean) { $("api-status").textContent = "❌ Not a URL (http://… or https://…)"; return; }
  chrome.storage.local.get([LI_SETTINGS_KEY], async (r) => {
    const settings = Object.assign({}, (r && r[LI_SETTINGS_KEY]) || {}, { apiBase: clean });
    chrome.storage.local.set({ [LI_SETTINGS_KEY]: settings }, async () => {
      API_BASE = liApiBase(settings);
      $("api-base").value = clean;
      $("api-status").textContent = "Testing " + API_BASE + "…";
      try {
        const resp = await fetchWithTimeout(API_BASE + "/health", {}, 12000);
        const data = await resp.json().catch(() => ({}));
        $("api-status").textContent = resp.ok && data.status === "ok"
          ? "✅ Connected to " + API_BASE
          : "⚠️ Reached " + API_BASE + " but it did not answer /health";
      } catch (e) {
        $("api-status").textContent = "❌ " + API_BASE + " — " + e.message;
      }
    });
  });
}

$("api-save").onclick = () => { saveApiBase($("api-base").value); saveAdminBase($("admin-base").value); };

// The admin backend is where scores and ICP rules live, so it gets the same
// treatment: saved with the other settings, tested straight after saving.
async function saveAdminBase(url) {
  const clean = liCleanApiBase(url);
  if (url.trim() && !clean) { $("api-status").textContent = "❌ Admin URL is not a URL"; return; }
  chrome.storage.local.get([LI_SETTINGS_KEY], (r) => {
    const settings = Object.assign({}, (r && r[LI_SETTINGS_KEY]) || {}, { adminBase: clean });
    chrome.storage.local.set({ [LI_SETTINGS_KEY]: settings }, async () => {
      const base = liAdminBase(settings);
      try {
        const resp = await fetchWithTimeout(base + "/extension/status", {}, 12000);
        const data = await resp.json().catch(() => ({}));
        $("api-status").textContent = resp.ok
          ? "✅ Admin connected · scoring ICP: " + ((data.activeIcp && data.activeIcp.name) || "none selected")
          : "⚠️ Admin reached but returned " + resp.status;
      } catch (e) {
        $("api-status").textContent = "❌ Admin " + base + " — " + e.message;
      }
    });
  });
}
$("api-hosted").onclick = () => { $("api-base").value = LI_API_HOSTED; saveApiBase(LI_API_HOSTED); };

// ─── My pitch (backend: /pitch-config → pitch_config.json) ────────────────────
// A sleeping Render server can take ~30-50s to answer; don't wait forever.
async function fetchWithTimeout(url, init, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 45000);
  try { return await fetch(url, Object.assign({}, init, { signal: ctrl.signal })); }
  catch (e) { throw new Error(e && e.name === "AbortError" ? "timed out — the server may be waking up, try again" : "backend unreachable"); }
  finally { clearTimeout(timer); }
}

const pitchSaveBtn = () => document.querySelector('#pitch-form button[type="submit"]');

async function loadPitch() {
  $("pitch-status").textContent = "Loading…";
  pitchSaveBtn().disabled = true;   // saving half-loaded fields would replace your pitch
  try {
    const resp = await fetchWithTimeout(API_BASE + "/pitch-config");
    if (!resp.ok) throw new Error("server error " + resp.status);
    const pitch = await resp.json();
    PITCH_FIELDS.forEach((k) => { $("p-" + k).value = pitch[k] || ""; });
    $("pitch-status").textContent = "";
    pitchSaveBtn().disabled = false;
  } catch (e) {
    $("pitch-status").textContent = "⚠️ Couldn't load your pitch (" + e.message + "). Reopen this tab in ~30s.";
  }
}

$("pitch-form").onsubmit = async (e) => {
  e.preventDefault();
  const body = {};
  PITCH_FIELDS.forEach((k) => { body[k] = $("p-" + k).value.trim(); });
  $("pitch-status").textContent = "Saving…";
  pitchSaveBtn().disabled = true;
  try {
    const resp = await fetchWithTimeout(API_BASE + "/pitch-config", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error("server error " + resp.status);
    // Keep the ✨ Setup preferences in step: role = "Who you are". Tone is not
    // saved here — each AI note / AI suggestion picks its own tone as you write.
    chrome.storage.local.get([LI_SETTINGS_KEY], (r) => {
      const s = Object.assign({}, (r && r[LI_SETTINGS_KEY]) || {}, {
        senderRole: body.who || "",
        aiSetupDone: Date.now(),
      });
      delete s.aiTone;                       // drop the retired "Message tone" setting
      chrome.storage.local.set({ [LI_SETTINGS_KEY]: s });
    });
    $("pitch-status").textContent = "✅ Saved — the next AI suggestions use it.";
  } catch (err) {
    $("pitch-status").textContent = "❌ Not saved: " + err.message;
  } finally {
    pitchSaveBtn().disabled = false;
  }
};

// ─── Development (developer mode only) ───────────────────────────────────────
// Five clicks on the title within two seconds toggle developer mode. The token lives
// under its own key (LI_DEV_KEY), read by background.js on every request, so saving
// here changes the very next Apify call. The saved token is never put back into the
// page: the field starts empty and only a masked form is shown.
function loadDev(cb) {
  chrome.storage.local.get([LI_DEV_KEY], (r) => cb((r && r[LI_DEV_KEY]) || {}));
}

function updateDev(patch, cb) {
  loadDev((dev) => {
    const next = Object.assign({}, dev, patch);
    Object.keys(next).forEach((k) => { if (next[k] === "" || next[k] == null) delete next[k]; });
    chrome.storage.local.set({ [LI_DEV_KEY]: next }, () => cb && cb(next));
  });
}

// A fixed run of dots, so the mask never gives away the token's length. Too short a
// value shows no tail at all rather than most of itself.
function maskToken(token) {
  if (!token) return "";
  const head = token.startsWith("apify_api_") ? "apify_api_" : "";
  return head + "•".repeat(10) + (token.length > 12 ? token.slice(-4) : "");
}

function renderDev(dev) {
  $("dev-section").hidden = !dev.devMode;
  $("apify-saved").textContent = dev.apifyToken
    ? "Saved · " + maskToken(dev.apifyToken)
    : "No token saved — Apify calls are skipped and scores use page data only.";
  $("apify-clear").disabled = !dev.apifyToken;
}

function setReveal(on) {
  $("apify-token").type = on ? "text" : "password";
  $("apify-reveal").textContent = on ? "Hide" : "Show";
  $("apify-reveal").setAttribute("aria-pressed", on ? "true" : "false");
}

let titleClicks = [];
document.querySelector("header h1").addEventListener("click", () => {
  const now = Date.now();
  titleClicks = titleClicks.filter((t) => now - t < 2000).concat(now);
  if (titleClicks.length < 5) return;
  titleClicks = [];
  loadDev((dev) => updateDev({ devMode: !dev.devMode }, (next) => {
    renderDev(next);
    if (next.devMode) {
      document.querySelector('nav [data-tab="pitch"]').click();
      $("dev-status").textContent = "Developer mode on.";
      $("dev-section").scrollIntoView({ block: "nearest" });
    } else {
      // Hiding the section is not switching the token off.
      $("api-status").textContent = next.apifyToken
        ? "Developer mode off — the saved Apify token stays in use."
        : "Developer mode off.";
    }
  }));
});

$("apify-reveal").onclick = () => setReveal($("apify-token").type === "password");

function saveApifyToken() {
  const token = $("apify-token").value.trim();
  if (!token) { $("dev-status").textContent = "Paste a token first — or Clear to remove the saved one."; return; }
  if (/\s/.test(token)) { $("dev-status").textContent = "❌ A token has no spaces — check what was pasted."; return; }
  updateDev({ apifyToken: token }, (next) => {
    $("apify-token").value = "";
    setReveal(false);
    renderDev(next);
    $("dev-status").textContent = token.startsWith("apify_api_")
      ? "✅ Saved — the next Apify call uses it."
      : "⚠️ Saved, but Apify tokens start with apify_api_ — check it's the right value.";
  });
}

$("apify-save").onclick = saveApifyToken;
$("apify-token").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveApifyToken(); } });

$("apify-clear").onclick = () => {
  if (!confirm("Remove the saved Apify token? Apify calls are skipped until a new one is saved.")) return;
  updateDev({ apifyToken: "" }, (next) => {
    renderDev(next);
    $("dev-status").textContent = "Token removed.";
  });
};

// ─── Sign-in gate (session in leads.js: liSignIn / liSignOut / liGetAuth) ────
// The popup is either the sign-in screen or the app, never both. Everything the
// app does — reading leads, calling the backend, the Apify token — waits behind
// this, and signing out here locks the LinkedIn page panels too: content.js
// watches the same storage key.
let appStarted = false;

function showSignInError(message) {
  $("signin-error").hidden = !message;
  $("signin-error-text").textContent = message || "";
}

function setSignInBusy(busy) {
  $("signin-submit").disabled = busy;
  $("signin-submit").textContent = busy ? "Signing in…" : "Sign in";
  $("signin-email").disabled = busy;
  $("signin-password").disabled = busy;
}

function showGate() {
  $("app").hidden = true;
  $("auth-gate").hidden = false;
  $("signin-password").value = "";
  setSignInReveal(false);
  showSignInError("");
  setSignInBusy(false);
  $("signin-email").focus();
}

// The app is only ever started once, however often the gate is crossed: its
// listeners are bound at load and its first paint reads storage.
function showApp(auth) {
  $("auth-gate").hidden = true;
  $("app").hidden = false;
  $("account-email").textContent = auth.email;
  $("account-email").title = "Signed in as " + auth.email;
  if (appStarted) { render(); return; }
  appStarted = true;
  render();
  loadApiBase();
  loadDev(renderDev);
}

function setSignInReveal(on) {
  $("signin-password").type = on ? "text" : "password";
  $("signin-reveal").textContent = on ? "Hide" : "Show";
  $("signin-reveal").setAttribute("aria-pressed", on ? "true" : "false");
}

$("signin-reveal").onclick = () => setSignInReveal($("signin-password").type === "password");

$("signin-form").onsubmit = async (e) => {
  e.preventDefault();
  showSignInError("");
  setSignInBusy(true);
  try {
    showApp(await liSignIn($("signin-email").value, $("signin-password").value));
    $("signin-password").value = "";
  } catch (err) {
    showSignInError(err.message || "Could not sign in — try again.");
    setSignInBusy(false);
    // Send them back to the field that needs fixing, not to the top of the form.
    (/password/i.test(err.message || "") ? $("signin-password") : $("signin-email")).focus();
    return;
  }
  setSignInBusy(false);
};

$("sign-out").onclick = () => liSignOut(showGate);

// Signed out in another window (or from a LinkedIn tab) — follow it here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[LI_AUTH_KEY]) return;
  const auth = changes[LI_AUTH_KEY].newValue;
  if (liAuthValid(auth)) showApp(auth); else if ($("app").hidden === false) showGate();
});

liGetAuth((auth) => { if (liAuthValid(auth)) showApp(auth); else showGate(); });
