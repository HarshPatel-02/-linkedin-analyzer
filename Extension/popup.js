const API_BASE = "http://127.0.0.1:8765";
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

// ─── My pitch (backend: /pitch-config → pitch_config.json) ────────────────────
async function loadPitch() {
  $("pitch-status").textContent = "Loading…";
  try {
    const resp = await fetch(API_BASE + "/pitch-config");
    if (!resp.ok) throw new Error("server error " + resp.status);
    const pitch = await resp.json();
    PITCH_FIELDS.forEach((k) => { $("p-" + k).value = pitch[k] || ""; });
    $("pitch-status").textContent = "";
  } catch (e) {
    $("pitch-status").textContent = "⚠️ Backend not running — start uvicorn to edit the pitch.";
  }
}

$("pitch-form").onsubmit = async (e) => {
  e.preventDefault();
  const body = {};
  PITCH_FIELDS.forEach((k) => { body[k] = $("p-" + k).value.trim(); });
  $("pitch-status").textContent = "Saving…";
  try {
    const resp = await fetch(API_BASE + "/pitch-config", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error("server error " + resp.status);
    $("pitch-status").textContent = "✅ Saved — next ✨ suggestions use it.";
  } catch (err) {
    $("pitch-status").textContent = "❌ " + err.message;
  }
};

render();
