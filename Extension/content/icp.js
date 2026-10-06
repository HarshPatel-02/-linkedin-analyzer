// LinkedIn AI Analyzer content script - The ICP panel: picking an ICP, feature switches, rules, Calculate, the result.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ── Which ICP scores this person ─────────────────────────────────────────────
// The admin holds several published ICPs and one of them is "the" scoring ICP.
// Choosing here moves that workspace selection, so the admin shows the same ICP
// and the same score rather than its own stale idea of which is in force.
let icpChoices = { icps: [], selected: null, loaded: false, error: "" };

function adminMessage(msg) {
  return liAsk(Object.assign({ type: "li-admin" }, msg));
}

// ─── Feature switches (Admin → ICPs → Feature settings) ───────────────────────
// The scoring ICP's switches decide what the extension shows: Activity analysis → the
// Activity button and panel; Message generation → ✨ on invite notes; Conversation
// analysis and Reply generation → ✨ in chats. Until the admin answers, or when it cannot
// be reached, everything stays on, as it did before the switches were read at all.
const FEATURES_ALL_ON = { profileAnalysis: true, activityAnalysis: true, aiExplanation: true,
  messageGeneration: true, conversationAnalysis: true, replyGeneration: true };
let liFeatures = Object.assign({}, FEATURES_ALL_ON);
const featureOn = (key) => liFeatures[key] !== false;
const chatSparkOn = () => featureOn("conversationAnalysis") && featureOn("replyGeneration");

// Take away what was just switched off; the 3-second tick puts back what was switched on.
function setFeatures(features) {
  liFeatures = Object.assign({}, FEATURES_ALL_ON, features || {});
  if (!featureOn("activityAnalysis")) {
    const btn = document.getElementById(PANELS.activity.btnId);
    if (btn) btn.remove();
    const panel = document.getElementById(PANELS.activity.id);
    if (panel) panel.remove();
  }
  try {
    for (const root of collectRoots()) {
      if (!chatSparkOn()) root.querySelectorAll(".li-spark-btn").forEach((b) => b.remove());
      if (!featureOn("messageGeneration")) root.querySelectorAll(".li-spark-invite").forEach((b) => (b.parentElement || b).remove());
    }
  } catch (e) { /* the next tick tries again */ }
}

async function loadFeatures() {
  const res = await adminMessage({ action: "icp-selected" });
  if (res && res.ok) setFeatures(((res.data || {}).config || {}).features);
}

async function loadIcpChoices(force) {
  // The list rarely changes while a panel is open, so reopening reuses it unless a
  // refresh is asked for. Every reopen used to refetch.
  if (icpChoices.loaded && !force && !icpChoices.error) return icpChoices;
  const res = await adminMessage({ action: "icps" });
  if (!res || !res.ok) {
    icpChoices = { icps: [], selected: null, loaded: true, savedId: icpChoices.savedId,
                   error: (res && res.error) || "admin backend unreachable" };
    return icpChoices;
  }
  const list = (res.data || {}).icps || [];
  // The response marks which ICP is in force, so no second request is needed.
  icpChoices = { icps: list, selected: list.find((i) => i.selected) || null,
                 loaded: true, savedId: icpChoices.savedId, error: "" };
  return icpChoices;
}

function chosenIcpId() {
  const saved = icpChoices.savedId;
  if (saved && icpChoices.icps.some((i) => i.id === saved)) return saved;
  if (icpChoices.selected && icpChoices.selected.id) return icpChoices.selected.id;
  return icpChoices.icps.length === 1 ? icpChoices.icps[0].id : "";
}

// The dropdown, or an honest note when there is nothing to choose between.
function icpSelectHTML() {
  if (!icpChoices.loaded) return '<div class="li-form-note">Loading ICP profiles\u2026</div>';
  if (icpChoices.error) {
    return '<div class="li-form-note">Could not reach the admin backend (' + liEsc(icpChoices.error) +
           '). Set the Admin URL in the extension popup.</div>';
  }
  if (!icpChoices.icps.length) {
    return '<div class="li-form-note">No published ICP profile. Create and publish one in the admin panel, then reopen this.</div>';
  }
  const current = chosenIcpId();
  return '<div class="li-form-field full">' +
    '<label class="li-form-label" for="li-icp-select">Select ICP Profile ' +
      '<span>the score is calculated with this profile\u2019s rules</span></label>' +
    '<select id="li-icp-select" class="li-input li-select">' +
      icpChoices.icps.map((i) =>
        '<option value="' + liEsc(i.id) + '"' + (i.id === current ? " selected" : "") + '>' +
        liEsc(i.name) + (i.version ? " \u00b7 version " + i.version : "") + '</option>').join("") +
    '</select></div>';
}

// The dropdown lives in a holder with a fixed id, so it can be redrawn once the
// ICP list arrives without having to guess which element it was.
function icpPickHTML() { return '<div id="li-icp-pick">' + icpSelectHTML() + '</div>'; }

function redrawIcpPick(root) {
  const holder = (root || document).querySelector("#li-icp-pick");
  if (!holder) return;
  holder.innerHTML = icpSelectHTML();
  wireIcpSelect(root || document);
}

// ── The fields this ICP scores with ──────────────────────────────
// The same ten fields the backend scores with, in the same order. A field's points
// belong to the FIELD: any one of its keywords matching earns all of them, and a
// second match earns nothing more. Fields are grouped, and a group counts only its
// best field — matching an exact and a related industry is still one industry.
const ICP_FIELD_VIEW = [
  { key: "EXACT_INDUSTRIES",             label: "Industry — exact",      group: "industry",    hint: "the industries this ICP is for" },
  { key: "RELATED_INDUSTRIES",           label: "Industry — related",    group: "industry",    hint: "adjacent, worth less" },
  { key: "TIER_1_TITLES",                label: "Title — tier 1",        group: "title",       hint: "the people you most want" },
  { key: "TIER_2_TITLES",                label: "Title — tier 2",        group: "title",       hint: "senior, below tier 1" },
  { key: "TIER_3_TITLES",                label: "Title — tier 3",        group: "title",       hint: "worth some points" },
  { key: "EXACT_COMPANY_SIZE_KEYWORDS",  label: "Company size — exact",  group: "companySize", hint: "employee ranges: 1, 2-10, 11-50, 51-200, 201-500, 501-1000…" },
  { key: "NEARBY_COMPANY_SIZE_KEYWORDS", label: "Company size — nearby", group: "companySize", hint: "still fits, worth less" },
  { key: "PRIMARY_GEOGRAPHIES",          label: "Geography — primary",   group: "geography",   hint: "where this ICP sells" },
  { key: "SECONDARY_GEOGRAPHIES",        label: "Geography — secondary", group: "geography",   hint: "other places worth points" },
  { key: "ALL_ICP_KEYWORDS",             label: "Profile keywords",            group: "keywords",    hint: "anywhere in headline or About" },
];

const ICP_GROUP_LABELS = {
  industry: "Industry", title: "Title", companySize: "Company size",
  geography: "Geography", keywords: "Profile keywords",
};

const ICP_DEFAULT_POINTS = {
  EXACT_INDUSTRIES: 35, RELATED_INDUSTRIES: 25,
  TIER_1_TITLES: 25, TIER_2_TITLES: 20, TIER_3_TITLES: 15,
  EXACT_COMPANY_SIZE_KEYWORDS: 15, NEARBY_COMPANY_SIZE_KEYWORDS: 8,
  PRIMARY_GEOGRAPHIES: 10, SECONDARY_GEOGRAPHIES: 5, ALL_ICP_KEYWORDS: 15,
};

// A field can only score when it is on, worth something, and has something to match.
const icpFieldCounts = (f) => !!(f && f.enabled && (f.points || 0) > 0 && (f.keywords || []).length);
const icpFieldMax = (f) => (icpFieldCounts(f) ? f.points : 0);

function icpFieldHTML(view, field, editable) {
  const f = field || { points: ICP_DEFAULT_POINTS[view.key] || 0, enabled: true, required: false, keywords: [] };
  const off = !f.enabled;
  const words = f.keywords || [];
  const chips = words.length
    ? words.map((kw) =>
        '<span class="li-kw-chip' + (off ? " off" : "") + '" data-kw="' + liEsc(kw) + '" role="listitem">' +
        (editable ? '<button type="button" class="li-kw-text">' : '<span class="li-kw-text">') +
        liEsc(kw) + (editable ? "</button>" : "</span>") +
        (editable ? '<button type="button" class="li-kw-x" aria-label="' + liEsc("Remove " + kw) + '">' + ICON_X_SMALL + "</button>" : "") +
        "</span>").join("")
    : '<span class="li-kw-empty">No keywords — this field cannot score anyone</span>';

  const points = editable
    ? '<span class="li-max"><input class="li-kw-w-in" type="number" min="0" max="100" step="1" value="' + (f.points || 0) +
      '" aria-label="' + liEsc("Maximum points for " + view.label) + '"> pts</span>'
    : '<span class="li-max">max ' + (f.points || 0) + "</span>";

  const adder = editable
    ? '<div class="li-kw-add"><input class="li-kw-input" type="text" autocomplete="off" spellcheck="false"' +
      ' placeholder="' + liEsc("Add a keyword") + '">' +
      '<button type="button" class="li-kw-addbtn">' + ICON_PLUS_SMALL + "Add</button></div>"
    : "";

  const toggle = editable
    ? '<button type="button" class="li-field-off" aria-pressed="' + (off ? "true" : "false") + '">' +
      (off ? "Off" : "On") + "</button>"
    : "";

  return '<div class="li-form-field full li-field" data-key="' + liEsc(view.key) + '">' +
    '<div class="li-form-head"><span class="li-form-label">' + liEsc(view.label) +
      " <span>" + liEsc(view.hint) + "</span>" + (f.required ? ' <span class="li-req">required</span>' : "") + "</span>" +
      toggle + points + "</div>" +
    '<div class="li-kw' + (editable ? "" : " ro") + '">' +
      '<div class="li-kw-chips" role="list" aria-label="' + liEsc(view.label) + ' keywords">' + chips + "</div>" +
      adder + "</div></div>";
}

function icpRulesHTML(editable) {
  if (icpChoices.configError) {
    return '<div class="li-form-note">Could not load this ICP’s rules (' + liEsc(icpChoices.configError) + ").</div>";
  }
  const icp = icpChoices.config;
  if (!icp) return '<div class="li-form-note">Loading this ICP’s rules…</div>';

  const cfg = icp.config || {};
  const fields = editable ? icpDraftFields() : (cfg.fields || {});

  // A group offers its best field only, so the ceiling is the sum of group bests.
  const groups = [];
  for (const view of ICP_FIELD_VIEW) {
    let g = groups.find((x) => x.key === view.group);
    if (!g) { g = { key: view.group, label: ICP_GROUP_LABELS[view.group], views: [] }; groups.push(g); }
    g.views.push(view);
  }
  const total = groups.reduce(
    (sum, g) => sum + Math.max.apply(null, [0].concat(g.views.map((v) => icpFieldMax(fields[v.key])))), 0);

  const groupHTML = groups.map((g) =>
    '<div class="li-group">' +
      '<div class="li-group-head">' + liEsc(g.label) +
        (g.views.length > 1 ? " <span>best field counts</span>" : "") + "</div>" +
      g.views.map((v) => icpFieldHTML(v, fields[v.key], editable)).join("") +
    "</div>").join("");

  return '<div class="li-rules">' + groupHTML +
    '<div class="li-pts-total"><span class="li-pts-extra"><span>Scored with</span> ' +
      liEsc(icp.name || "this ICP") + (icp.version ? " · version " + icp.version : "") + "</span>" +
      "<span>" + (total
        ? total + " points possible — the score is the share of them earned"
        : "No keywords yet — this ICP cannot score anyone") + "</span></div></div>";
}

// ── Editing the fields ────────────────────────────────────
// A working copy, so an abandoned edit never becomes the scoring rules. Saving
// publishes a new ICP version; the admin reads the same one.
let icpDraft = null;

function icpDraftFields() {
  if (!icpDraft) {
    const src = (icpChoices.config && icpChoices.config.config && icpChoices.config.config.fields) || {};
    icpDraft = { icpId: icpChoices.config && icpChoices.config.id, dirty: false, fields: {} };
    for (const v of ICP_FIELD_VIEW) {
      const f = src[v.key] || {};
      icpDraft.fields[v.key] = {
        points: f.points == null ? (ICP_DEFAULT_POINTS[v.key] || 0) : f.points,
        enabled: f.enabled !== false,
        required: !!f.required,
        keywords: (f.keywords || []).slice(),
      };
    }
  }
  return icpDraft.fields;
}

function icpDraftReset() { icpDraft = null; }

function icpMarkDirty(dirty) {
  if (icpDraft) icpDraft.dirty = dirty !== false;
  const save = document.getElementById("li-icp-save");
  if (save) {
    save.disabled = !(icpDraft && icpDraft.dirty);
    save.classList.toggle("li-rules-dirty", !!(icpDraft && icpDraft.dirty));
  }
}

function wireRuleEditors(root) {
  if (!root) return;
  root.querySelectorAll(".li-field[data-key]").forEach((box) => {
    const key = box.getAttribute("data-key");
    const field = () => icpDraftFields()[key];

    const pts = box.querySelector(".li-kw-w-in");
    if (pts) {
      pts.oninput = () => {
        field().points = Math.max(0, Math.min(100, Math.round(Number(pts.value) || 0)));
        icpMarkDirty();
        refreshIcpTotal(root);
      };
      pts.onblur = () => { pts.value = String(field().points); };
    }

    const toggle = box.querySelector(".li-field-off");
    if (toggle) toggle.onclick = () => {
      field().enabled = !field().enabled;
      icpMarkDirty();
      redrawIcpRules(null, true);
    };

    box.querySelectorAll(".li-kw-chip[data-kw]").forEach((chip) => {
      const kw = chip.getAttribute("data-kw");
      const drop = () => {
        const f = field();
        f.keywords = f.keywords.filter((k) => k !== kw);
        icpMarkDirty();
        redrawIcpRules(null, true);
      };
      const text = chip.querySelector(".li-kw-text");
      if (text) text.onclick = drop;
      const x = chip.querySelector(".li-kw-x");
      if (x) x.onclick = drop;
    });

    const input = box.querySelector(".li-kw-input");
    const add = () => {
      const value = (input.value || "").trim();
      if (!value) return;
      const f = field();
      if (f.keywords.some((k) => k.toLowerCase() === value.toLowerCase())) {
        input.value = "";
        setIcpStatus("“" + value + "” is already in " + key + ".");
        return;
      }
      f.keywords.push(value);
      input.value = "";
      icpMarkDirty();
      redrawIcpRules(null, true);
      const again = document.querySelector('.li-field[data-key="' + key + '"] .li-kw-input');
      if (again) again.focus();
    };
    if (input) input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
    const btn = box.querySelector(".li-kw-addbtn");
    if (btn) btn.onclick = add;
  });
}

// The ceiling only changes when a points box does, so it is cheaper to update the
// one line than to redraw every field and lose the caret.
function refreshIcpTotal(root) {
  const el = (root || document).querySelector(".li-pts-total span:last-child");
  if (!el) return;
  const fields = icpDraftFields();
  const seen = {};
  for (const v of ICP_FIELD_VIEW) {
    seen[v.group] = Math.max(seen[v.group] || 0, icpFieldMax(fields[v.key]));
  }
  const total = Object.keys(seen).reduce((n, g) => n + seen[g], 0);
  el.textContent = total
    ? total + " points possible — the score is the share of them earned"
    : "No keywords yet — this ICP cannot score anyone";
}

async function saveIcpRules() {
  if (!icpDraft || !icpDraft.dirty) return;
  setBusy(["li-icp-save", "li-icp-calc", "li-icp-recalc"], true);
  setIcpStatus("Saving the fields…");
  const res = await adminMessage({ action: "save-rules", fields: icpDraft.fields });
  setBusy(["li-icp-save", "li-icp-calc", "li-icp-recalc"], false);
  if (!res) { setIcpStatus("❌ The extension’s background worker restarted — press Save again"); return; }
  if (!res.ok) { setIcpStatus("❌ " + (res.error || "The fields could not be saved")); return; }

  // The response is the published ICP, so the panel shows exactly what was stored
  // rather than the draft it sent.
  icpChoices.config = res.data || icpChoices.config;
  icpChoices.configError = "";
  icpDraftReset();
  const list = icpChoices.icps.find((i) => i.id === (icpChoices.config || {}).id);
  if (list && icpChoices.config) list.version = icpChoices.config.version;
  redrawIcpRules(null, true);
  redrawIcpPick(document.getElementById("li-icp-body"));   // the option label carries the version
  icpMarkDirty(false);
  setIcpStatus("✅ Saved as version " + ((icpChoices.config || {}).version || "?") +
               ". Press " + icpCta() + " to score this profile with it.");
}

// Read the selected ICP's rules and draw them, whatever happens.
//
// Every caller used to do this as a bare `loadIcpRules(...).then(draw)`. Nothing caught
// a failure, so a thrown error became an unhandled rejection in the console and the
// panel sat on "Loading this ICP's rules…" for good — no message, no retry, no clue.
// A failure now reaches icpRulesHTML as configError and is drawn like any other.
function refreshIcpRules(root, editable, force) {
  return loadIcpRules(force)
    .catch((err) => {
      icpChoices.config = null;
      icpChoices.configError = (err && err.message) || "the rules could not be read";
    })
    .then(() => { if (!root || root.isConnected) redrawIcpRules(root, editable); })
    .catch((err) => console.error("[LI-AI] ICP rules could not be drawn", err));
}

function redrawIcpRules(root, editable) {
  const holder = (root || document).querySelector("#li-icp-rules");
  if (!holder) return;
  holder.innerHTML = icpRulesHTML(editable);
  if (editable) { wireRuleEditors(holder); icpMarkDirty(icpDraft && icpDraft.dirty); }
}

// The options list carries no configuration, so the rules are a separate read.
async function loadIcpRules(force) {
  if (icpChoices.config && !force) return icpChoices.config;
  const res = await adminMessage({ action: "icp-selected" });
  icpChoices.config = res && res.ok ? (res.data || null) : null;
  if (icpChoices.config) setFeatures((icpChoices.config.config || {}).features);
  icpChoices.configError = res ? (res.ok ? "" : (res.error || "admin backend error"))
                               : "the extension’s background worker restarted";
  return icpChoices.config;
}

// The remembered choice, so it survives moving between profiles.
function writeIcpChoice(icpId) {
  try {
    chrome.storage.local.get([LI_SETTINGS_KEY], (r) => {
      const settings = Object.assign({}, (r && r[LI_SETTINGS_KEY]) || {}, { icpId: icpId || "" });
      chrome.storage.local.set({ [LI_SETTINGS_KEY]: settings });
    });
  } catch (e) { /* extension reloaded: the next panel open reads the backend anyway */ }
}

function wireIcpSelect(root) {
  const sel = root && root.querySelector("#li-icp-select");
  if (!sel) return;
  sel.onchange = async () => {
    try { await icpSelectionChanged(sel); }
    catch (err) {
      console.error("[LI-AI] ICP selection failed", err);
      setIcpStatus("❌ " + ((err && err.message) || "that ICP could not be selected"));
    }
  };
}

async function icpSelectionChanged(sel) {
    const previous = icpChoices.savedId || (icpChoices.selected && icpChoices.selected.id) || "";
    const chosen = sel.value;
    const picked = icpChoices.icps.find((i) => i.id === chosen);

    // Put the choice back the way it was, in whichever select is on screen now:
    // the panel may have been redrawn while the request was in flight.
    const revert = (why) => {
      icpChoices.savedId = previous;
      const live = document.getElementById("li-icp-select") || sel;
      if (previous) live.value = previous;
      else if (live.selectedIndex >= 0) live.selectedIndex = -1;   // nothing was chosen before
      writeIcpChoice(previous);
      setIcpStatus("❌ " + why);
    };

    icpChoices.savedId = chosen;
    writeIcpChoice(chosen);
    // Saved the moment it is picked, so the admin shows the same ICP without waiting
    // for an analysis. Calculate then only has to analyze.
    sel.disabled = true;
    let res;
    try {
      res = await adminMessage({ action: "select-icp", icpId: chosen });
    } catch (err) {
      revert(err && err.message ? err.message : "That ICP could not be selected");
      return;
    } finally {
      // Always give the control back, even if the panel was replaced meanwhile.
      sel.disabled = false;
      const live = document.getElementById("li-icp-select");
      if (live) live.disabled = false;
    }

    // No response at all means the service worker was torn down mid-request, so
    // the backend never heard about this. Treating that as success is what let the
    // panel claim one ICP while the admin went on scoring with another.
    if (!res) { revert("The extension's background worker restarted — pick it again"); return; }
    if (!res.ok) { revert(res.error || "That ICP could not be selected"); return; }

    icpChoices.selected = picked || icpChoices.selected;
    // The PUT answers with the whole ICP, so the rules update without another read.
    if (res.data && res.data.id) {
      icpChoices.config = res.data;
      icpChoices.configError = "";
      setFeatures((res.data.config || {}).features);
    } else {
      icpChoices.config = null;
    }
    // A different ICP has different rules, so the edit in progress belonged to the
    // old one. Start again from what was just selected.
    icpDraftReset();
    setIcpStatus((picked ? "Scoring with " + picked.name : "ICP changed") +
                 " — press " + icpCta() + " to score this profile with it.");
    // Draw once, in the mode the panel is actually in. Drawing before the editable flag
    // was known flashed the read-only rules first.
    const editable = !!document.getElementById("li-icp-save");
    if (icpChoices.config) redrawIcpRules(null, editable);
    else refreshIcpRules(null, editable, true);
}

function restoreIcpChoice() {
  return new Promise((resolve) =>
    chrome.storage.local.get([LI_SETTINGS_KEY], (r) => {
      icpChoices.savedId = ((r && r[LI_SETTINGS_KEY]) || {}).icpId || "";
      resolve(icpChoices.savedId);
    }));
}

const ICP_ACTIONS = ["li-icp-refresh", "li-icp-save", "li-icp-calc", "li-icp-recalc"];

async function openIcpForm(reset) {
  createPanel(PANELS.icp);

  const body = freshPanelBody("li-icp-body");
  if (!body) return;
  // Just the choice and the button. The keyword lists that used to live here were
  // the analyzer's; scoring moved to the admin's rule engine, so editing them could
  // not change a score. ICP rules are edited in the admin, which is what scores.
  body.innerHTML = `
    ${icpPickHTML()}
    <div class="li-form-status" id="li-icp-status" role="status"></div>
    <div class="li-form-actions">
      <button type="button" class="li-btn li-btn-ghost" id="li-icp-refresh">🔄 Refresh</button>
      <button type="button" class="li-btn li-btn-ghost" id="li-icp-save" disabled>💾 Save rules</button>
      <button type="button" class="li-btn li-btn-green" id="li-icp-calc">🎯 Calculate ICP Score</button>
    </div>
    <div id="li-icp-rules"></div>
  `;

  wireIcpSelect(body);
  document.getElementById("li-icp-refresh").onclick = () => openIcpForm(true);
  document.getElementById("li-icp-save").onclick = () => saveIcpRules();
  document.getElementById("li-icp-calc").onclick = () => calculateIcpScore();

  // Nothing can be scored until we know which ICPs exist, so hold the button.
  setBusy(ICP_ACTIONS, true);
  setIcpStatus("Loading ICP profiles…");
  await restoreIcpChoice();
  await loadIcpChoices(reset === true);
  if (!body.isConnected) return;            // replaced by a newer panel

  redrawIcpPick(body);
  // The rules are a second small read; the dropdown is usable before they land.
  // They are editable here — the admin's ICP Builder edits the same version.
  icpDraftReset();
  refreshIcpRules(body, true, reset === true);

  setBusy(ICP_ACTIONS, false);
  if (icpChoices.error) {
    statusWithRetry("li-icp-status", "⚠️ " + icpChoices.error, () => openIcpForm(true));
    setBusy(["li-icp-calc"], true);
  } else if (!icpChoices.icps.length) {
    setBusy(["li-icp-calc"], true);         // nothing to score against
  } else {
    const picked = icpChoices.icps.find((i) => i.id === chosenIcpId());
    setIcpStatus(picked ? "Scoring with " + picked.name + " — press " + icpCta() + "." : "");
  }
}

function countKeywords(config) {
  return Object.values(config || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

// Bumped by every run. A run that is no longer the latest must not save or render:
// switching ICP twice in a row would otherwise let the slower first answer land last
// and leave the panel showing a score the selected ICP did not produce.
let icpRunSeq = 0;

async function calculateIcpScore() {
  // The form calls this button Calculate, the result panel calls it Re-analyze.
  // Looking only for the form's id meant Re-analyze silently did nothing.
  const btn = document.getElementById("li-icp-calc") || document.getElementById("li-icp-recalc");
  if (!btn) return;
  const seq      = ++icpRunSeq;
  const label    = btn.textContent;
  const scoreKey = scoreStoreKey();     // this person, even if the user navigates away
  const slug     = currentProfileSlug();
  const p        = scrapeProfile();     // before any wait: the page may change while we save
  setBusy(ICP_ACTIONS, true);
  btn.textContent = "⏳ Analyzing…";
  setIcpStatus("");
  const loading = showScoringLoader("li-icp-body", {
    title: "Calculating the ICP score", stage: "Loading the selected ICP…",
    rows: Object.values(ICP_GROUP_LABELS), accent: "var(--li-green)",
  });
  let shown = false;

  try {
    if (currentProfileSlug() !== slug) return;   // moved to someone else: don't score them as this person
    // The dropdown already saved the choice, so this only has to analyze.
    if (!icpChoices.loaded) { await restoreIcpChoice(); await loadIcpChoices(); }
    const icpId = chosenIcpId();
    if (!icpId && icpChoices.icps.length) throw new Error("Choose an ICP profile first");
    const icpName = (icpChoices.icps.find((i) => i.id === icpId) || {}).name;
    loading.stage("Collecting this profile and scoring it against " + (icpName || "the selected ICP") + "…");

    // One call. The admin backend collects, scores against the ICP selected there,
    // stores the analysis and hands it back. Nothing is scored in this panel, which
    // is why the number here always equals the number in the admin.
    const res = await new Promise((resolve) =>
      chrome.runtime.sendMessage({ type: "li-admin", action: "analyze",
        profileUrl: p.profileUrl, scraped: icpPageFacts(p), collect: true, icpId: icpId || null }, resolve));
    if (!res) throw new Error("Extension was reloaded — refresh this LinkedIn tab");
    if (!res.ok) throw new Error(res.error || "The admin backend could not be reached");
    const out = res.data || {};
    if (out.success === false) throw new Error(out.message || "This profile could not be analyzed");
    if (seq !== icpRunSeq) return;    // a newer ICP was picked while this ran

    out.profileName = p.name || "";      // the admin answers with a score, not a person
    out.profileMeta = await apifyMeta();
    await saveStoredScore("icp", out, scoreKey);
    // The admin's answer carries the score, not the person: their details reach the
    // lead log from the Apify data the Activity score fetched, merged in background.js.
    updateLead(p.profileUrl, p.name, {
      icpScore: out.score || 0,
      icpBand: out.bandLabel || "",
      adminLeadId: out.leadId || "",
    });
    if (currentProfileSlug() !== slug || !document.getElementById("li-icp-body")) return;   // saved; nothing to show here
    if (seq !== icpRunSeq) return;
    renderIcpResult(out, 0, null, { fresh: true });
    shown = true;
  } catch (err) {
    if (seq !== icpRunSeq) return;    // superseded: its own error is not news
    loading.restore();
    setIcpStatus("❌ " + err.message);
    const b = document.getElementById("li-icp-calc") || document.getElementById("li-icp-recalc");
    if (b) b.textContent = label;
    setBusy(ICP_ACTIONS, false);
  } finally {
    if (!shown) loading.restore();     // nothing drawn over it: give the panel back
  }
}

// Breakdown bars shared by both result panels. `rawDetail` is trusted HTML.
// A score drawn as a ring: the arc is the share of 100 earned, the number sits inside
// it. Starts at noon and fills clockwise, and the arc carries the band colour so the
// shape and the figure can never disagree. The label always travels beside it, so the
// colour is never the only thing reporting the verdict.
function scoreRingHTML(score, color, opts) {
  const size   = (opts && opts.size)   || 104;
  const stroke = (opts && opts.stroke) || 9;
  const label  = (opts && opts.label)  || "";
  const r    = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct  = Math.max(0, Math.min(100, Number(score) || 0));
  const mid  = size / 2;
  return `
    <div role="img" aria-label="${liEsc(`${label || "Score"} ${score} out of 100`)}"
         style="position:relative;flex-shrink:0;width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}" style="display:block;transform:rotate(-90deg);" aria-hidden="true">
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--li-track)" stroke-width="${stroke}"></circle>
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
                stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}"
                stroke-dashoffset="${(circ - (pct / 100) * circ).toFixed(2)}"
                style="transition:stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1),stroke .3s;"></circle>
      </svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <span class="li-score-num" style="font-size:30px;font-weight:800;color:${color};line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;">${score}</span>
        <span style="font-size:10px;color:var(--li-muted);margin-top:4px;">out of 100</span>
      </div>
    </div>`;
}

function scoreRowsHTML(rows, fullColor) {
  return rows.map((row, i) => {
    const pct   = row.max ? Math.max(0, Math.min(100, Math.round((row.score / row.max) * 100))) : 0;
    const color = row.max && row.score >= row.max ? fullColor : row.score > 0 ? "var(--li-blue)" : "var(--li-track)";
    const textColor = row.score > 0 ? color : "var(--li-muted)";   // track grey is invisible as text
    const detail = row.rawDetail || (row.detail ? liEsc(row.detail) : "");
    return `
      <div style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px;">
          <span style="font-size:13px;font-weight:600;color:var(--li-fg-2);">${liEsc(row.label)}</span>
          <span style="font-size:13px;font-weight:700;color:${textColor};font-variant-numeric:tabular-nums;">${row.score}/${row.max}</span>
        </div>
        <div style="height:6px;background:var(--li-track);border-radius:999px;overflow:hidden;">
          <div class="li-bar-fill" style="--i:${i};height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
        </div>
        ${detail ? `<div style="font-size:11px;color:var(--li-muted);margin-top:6px;line-height:1.5;">${detail}</div>` : ""}
      </div>`;
  }).join("");
}

// ─── Backend analysis: shown exactly as the admin stored it ──────────────────
// Nothing here decides a score or a label. The number, the band, the breakdown
// and the evidence all come from the admin backend, which is what stops this
// panel and the admin panel disagreeing about the same person.

// ── ICP result -> what the AI endpoints accept ───────────────────────────────
// A stored analysis from the admin backend carries a ScoreResult whose breakdown
// is a list; the AI endpoints want {label: {score, max, reason}}. Converting here
// keeps the reasons the panel already shows, so the AI sees why a score is what it
// is rather than a bare number.
// The AI endpoints take plain text, and icpRowDetail is markup for the panel.
const stripTags = (html) => String(html || "").replace(/<br\s*\/?>/gi, " \u00b7 ").replace(/<[^>]*>/g, "");

function icpForAi(data) {
  if (!data) return { score: null, breakdown: {} };
  const result = data.result || data;
  if (!Array.isArray(result.breakdown)) {
    // A score stored before the backends were unified.
    return { score: Math.round(result.icp_score || 0), breakdown: result.breakdown || {} };
  }
  const breakdown = {};
  for (const row of result.breakdown) {
    breakdown[row.label || row.category] = {
      score: row.earned || 0,
      max: row.possible || 0,
      reason: stripTags(icpRowDetail(result, row.key || row.category)) || "no match",
    };
  }
  const score = data.score != null ? data.score : (result.score || 0);
  return { score: Math.round(score), breakdown };
}

// Which tier produced a group's points, and which of its keywords matched. Only the
// winning tier is shown: the lower tiers stop mattering once a higher one matches, so
// listing them reads as a row of failures beside the win. The points are the tier's and
// are counted once, so the row reads "Title — tier 2 · VP · +20", never "+20 +20".
//
// When nothing matched, that is one fact, not one per tier. Naming every tier that
// failed ("Title — tier 1 (max 13): no keyword matched", then tier 2, then tier 3) said
// the same thing three times and buried the groups that did score; the row already
// carries 0 / max beside it.
function icpRowDetail(result, groupKey) {
  const group = (result.breakdown || []).find((b) => (b.key || b.category) === groupKey);
  const fields = (group && group.fields) || [];
  const live = fields.filter((f) => (f.keywords || []).length);
  if (!live.length) return "";
  const winnerKey = group && group.matchedField && group.matchedField.key;
  if (!winnerKey) return "No keyword matched";
  return live.filter((f) => f.key === winnerKey).map((f) => {
    const hit = (f.matched || []).length
      ? `matched ${f.matched.map(liEsc).join(", ")} — <strong>+${f.earned}</strong>`
      : "no keyword matched";
    return `${liEsc(f.label)} (max ${f.points}): ${hit}`;
  }).join("<br>");
}

function renderAnalysis(out, storedAt, opts) {
  applyTheme();
  const body = freshPanelBody("li-icp-body");
  if (!body) return;

  const result = out.result || {};
  const score = out.score || 0;
  const color = score >= 70 ? "var(--li-green)" : score >= 40 ? "var(--li-warn)" : "var(--li-bad)";
  // The same green / amber / red signal the Activity panel puts beside its label, on the
  // same 70 / 40 thresholds this panel already colours the number with. The band word
  // still travels with it, so the colour is never the only thing carrying the verdict.
  const signal = score >= 70 ? "\u{1F7E2}" : score >= 40 ? "\u{1F7E1}" : "\u{1F534}";
  const rows = (result.breakdown || [])
    .filter((b) => (b.possible || 0) > 0 || (b.fields || []).some((f) => (f.keywords || []).length))
    .map((b) => ({
      label: b.label || b.key,
      score: b.earned || 0,
      max: b.possible || 0,
      // Trusted HTML: icpRowDetail escapes every value it interpolates, and it emits the
      // <strong> and <br> that make a row readable. Passed as `detail` those tags were
      // escaped and printed as text.
      rawDetail: icpRowDetail(result, b.key || b.category),
    }));

  const icp = out.icp || {};
  const when = out.analyzedAt ? new Date(out.analyzedAt) : null;

  // Who this is, read from the page: the admin's response carries the score, not the
  // person. The Activity panel heads its result the same way, and both panels now run
  // header → score → basis → evidence in the same order at the same sizes.
  const p    = safeScrape();
  // scrapeProfile answers the literal "Unknown" when LinkedIn's <h1> is not readable
  // yet — which is common here, because this panel often opens on a stored score before
  // the page has finished rendering. The slug in the URL is always there, so fall back
  // to it the way the admin derives its own display name, and show nothing rather than
  // the word "Unknown" if even that fails.
  const name = profileDisplayName(out.profileName, p.name);
  const meta = out.profileMeta || "";   // Apify's company • country, saved with the score
  const scored = `${when ? `Scored ${liEsc(when.toLocaleString())}` : ""}${
    out.adminLeadUrl ? `${when ? " · " : ""}<a href="${liEsc(out.adminLeadUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--li-blue);">open in admin</a>` : ""}`;

  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div>
        ${name ? `<div data-li-name style="font-size:17px;font-weight:700;color:var(--li-fg);">${liEsc(name)}</div>` : ""}
        ${meta ? `<div style="font-size:12px;color:var(--li-muted);">${liEsc(meta)}</div>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="button" class="li-btn li-btn-ghost" id="li-icp-edit">✏️ Edit Details</button>
        <button type="button" class="li-btn li-btn-green" id="li-icp-recalc">🔄 Re-analyze</button>
      </div>
    </div>
    ${storedAt ? `<div class="li-form-note">💾 Stored score from <strong>${liEsc(fmtSavedAt(storedAt))}</strong> — press <strong>Re-analyze</strong> for a fresh one.</div>` : ""}
    <div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
        ${scoreRingHTML(score, color, { label: "ICP match score" })}
        <div>
          <div style="font-size:16px;color:var(--li-fg);font-weight:700;">${signal} ${liEsc(result.bandLabel || out.classification || "")}</div>
          <div style="font-size:12px;color:var(--li-muted);margin-top:5px;">Earned ${result.earned || 0} of ${result.possible || 0} points.</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:11.5px;color:var(--li-muted);margin-bottom:16px;">
        ${icpPickHTML()}
        <div class="li-form-status li-status-inline" id="li-icp-status" role="status"></div>
        ${scored ? `<div>${scored}</div>` : ""}
      </div>
      <div style="border-top:1px solid var(--li-border);padding-top:14px;">
        ${scoreRowsHTML(rows, "var(--li-green)")}
      </div>
    </div>
  `;
  // A score stored before the name was stamped has none, and the live scrape can come
  // back empty here, so the header falls back to the slug: "Shahilbhatt" where the
  // Activity panel says "Shahil Bhatt". The lead record kept the real name from when the
  // score was calculated - use it, rather than have the two panels name one person twice.
  if (name && name === nameFromSlug(currentProfileSlug())) {
    withLeads((leads) => {
      const lead = leads[liFindLeadKey(leads, p.profileUrl, "")] || {};
      const el = body.querySelector("[data-li-name]");
      if (el && lead.name && lead.name !== name) el.textContent = lead.name;
    });
  }

  const edit = document.getElementById("li-icp-edit");
  if (edit) edit.onclick = () => openIcpForm();
  wireIcpSelect(body);
  // Opening straight to a stored score renders before the ICP list has been
  // fetched, which would leave the dropdown saying "Loading ICP profiles…" for
  // good. Fill it in when it lands.
  if (!icpChoices.loaded) {
    restoreIcpChoice()
      .then(() => loadIcpChoices())
      .catch((err) => { icpChoices.loaded = true; icpChoices.error = (err && err.message) || "admin backend unreachable"; })
      .then(() => { if (body.isConnected) redrawIcpPick(body); })
      .catch((err) => console.error("[LI-AI] ICP list could not be drawn", err));
  }
  // The rules themselves are not repeated here - the breakdown already names the tier
  // that scored, and the full list belongs to Edit ICP.
  const recalc = document.getElementById("li-icp-recalc");
  if (recalc) recalc.onclick = () => calculateIcpScore();
  if (opts && opts.fresh) revealFreshScore(body);
}

/** Whether a stored or fresh score came from the admin backend and can be rendered. */
function isScoredResult(result) {
  return !!(result && result.result && result.icp);
}

function renderIcpResult(result, keywordCount, storedAt, opts) {
  // Only the admin backend's shape can be rendered: it carries its own ScoreResult and
  // the ICP that produced it. A score stored before the backends were unified has none
  // of that, and drawing it produced a panel of 0/0 rows reading "Weak Fit" - worse than
  // showing nothing. Offer the rules instead, so one press recalculates it properly.
  if (isScoredResult(result)) return renderAnalysis(result, storedAt, opts);
  openIcpForm();
}

// Pressing the button closes an open panel, shows the score already stored for this
// person, or — with nothing stored — opens the form. `canRender` differs because a
// stored ICP score from before the backends were unified cannot be drawn.
async function toggleScorePanel(kind, { canRender, render, openForm, refresh }) {
  const existing = document.getElementById(PANELS[kind].id);
  if (existing) { existing.remove(); return; }
  const stored = (await loadStoredScores())[kind];
  if (stored && canRender(stored.data)) {
    createPanel(PANELS[kind]);        // the stored score right away: no request, no recalculation
    render(stored.data, stored.savedAt);
    if (refresh) refresh(stored.data);
  } else {
    openForm();
  }
}
