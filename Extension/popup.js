const API_BASE = "https://linkedin-analyzer-90ne.onrender.com";
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
    if (b.dataset.tab === "pitch") loadPitch();
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

render();
