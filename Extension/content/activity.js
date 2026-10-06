// LinkedIn AI Analyzer content script - The Activity score form: points, keywords, Calculate.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ─── Activity Score: form with the details used by scoring_service.py ─────────
// Points: `def` = default max points, `ptsKey` = key in activity_points.json.
// The number on each field is editable; the rule (tooltip) scales with it.
const ptsOf = (p, part, of) => Math.round((p * part) / of);
const ACTIVITY_FIELDS = [
  { key: "position",           label: "Headline / Position",   type: "text", hint: "blank = from Apify", ptsKey: "signals", def: 20,
    rule: (p) => `Hiring/growth signals (also read from About and recent posts): hiring now ${ptsOf(p, 5, 10)} · recent promotion ${ptsOf(p, 3, 10)} · company growing ${ptsOf(p, 2, 10)}` },
  { key: "activity",           label: "Recent Activity",       type: "text", hint: "blank = from Apify", ptsKey: "recent_activity", def: 30,
    rule: (p) => `Last activity within 7 days = ${p} · within 30 days = ${ptsOf(p, 2, 3)} · within 90 days = ${ptsOf(p, 1, 3)}` },
  { key: "posts_90_days",      label: "Posts in Last 90 Days", type: "number", hint: "blank = count from Apify", ptsKey: "posting_frequency", def: 20,
    rule: (p) => `Posting frequency (last 90 days): 10+ posts = ${p} · 5-9 = ${ptsOf(p, 3, 4)} · 1-4 = ${ptsOf(p, 1, 2)}` },
  { key: "posts_30_days",      label: "Posts in Last 30 Days", type: "number", hint: "shown in the breakdown" },
  { key: "avg_likes",          label: "Avg Likes / Post",      type: "number", hint: "blank = Apify average", ptsKey: "engagement", def: 20,
    rule: (p) => `Engagement: High = ${p} · Medium = ${ptsOf(p, 1, 2)} · Low = ${ptsOf(p, 1, 4)} — High needs 2 of: 10+ likes, 5+ comments, 3+ reposts` },
  { key: "avg_comments",       label: "Avg Comments / Post",   type: "number", hint: "blank = Apify average" },
  { key: "avg_reposts",        label: "Avg Reposts / Post",    type: "number", hint: "blank = Apify average" },
];
// Scored from the Apify profile (no form field), but its points are editable too
const ACTIVITY_COMPLETENESS = { label: "Profile Completeness", ptsKey: "completeness", def: 10,
  rule: (p) => `From Apify: photo, headline, About, experience and company — ${+(p / 5).toFixed(1)} each` };
const ACTIVITY_POINT_DEFS = [...ACTIVITY_FIELDS, ACTIVITY_COMPLETENESS];

// Hiring / growth signal keywords (activity_keywords.json). Each list earns its
// share of the Headline / Position (signals) points when found in the headline,
// About or the newest posts.
const SIGNAL_KW_FIELDS = [
  { key: "hiring", label: "Hiring words", share: 50 },
  { key: "job",    label: "Promotion words", share: 30 },
  { key: "growth", label: "Growth words", share: 20 },
];

function signalKeywordsHTML() {
  return `<div class="li-form-field full li-sig">
      <div class="li-form-head"><span class="li-form-label">Hiring / Growth Signal Keywords
        <span>found in the headline, About or recent posts</span></span></div>
      <div class="li-sig-grid">${SIGNAL_KW_FIELDS.map((f) => `<div class="li-form-field">
        <div class="li-form-head"><label class="li-form-label" for="li-sig-${f.key}-new">${f.label}</label>
          <span class="li-sig-share" data-share="${f.share}"></span></div>
        ${kwEditorHTML("li-sig", f.key, f.label, "blue", "Add a keyword")}</div>`).join("")}</div>
    </div>`;
}

// "5 pts" etc. = each list's share of the current signals points
function refreshSignalShares(root) {
  const el = root.querySelector('.li-pts-in[data-pts="signals"]');
  const total = el ? Math.max(0, Math.min(100, Math.round(Number(el.value) || 0))) : 10;
  root.querySelectorAll(".li-sig-share").forEach((s) => { s.textContent = `${Math.round((total * s.dataset.share) / 100)} pts`; });
}

function collectSignalKeywords() {
  const out = {};
  for (const f of SIGNAL_KW_FIELDS) out[f.key] = kwList("li-sig", f.key);
  return out;
}

// Editable points pill: a small number input styled as the pill.
function ptsPillHTML(f, tone) {
  if (!f.ptsKey) return "";
  return `<span class="li-pts${tone === "blue" ? " blue" : ""}" title="${liEsc(f.rule(f.def))}">
      <input type="number" class="li-pts-in" min="0" max="100" step="1" inputmode="numeric" value="${f.def}"
        data-pts="${f.ptsKey}" data-def="${f.def}" aria-label="Points for ${liEsc(f.label)} (default ${f.def})">pts</span>`;
}

// Label row: field name + hint on the left, its editable points on the right.
function formHeadHTML(f, forId, tone) {
  const hint = f.hint ? ` <span>${liEsc(f.hint)}</span>` : "";
  return `<div class="li-form-head"><label class="li-form-label" for="${forId}">${f.label}${hint}</label>${ptsPillHTML(f, tone)}</div>`;
}

// Points row under a form: running total (score is always shown out of 100) + reset.
function ptsTotalHTML(id, extraHTML) {
  return `<div class="li-pts-total" id="${id}">${extraHTML || ""}<span class="li-pts-sum"></span>
    <button type="button" class="li-pts-reset" hidden>Reset to default points</button></div>`;
}

function readPoints(root) {
  const out = {};
  root.querySelectorAll(".li-pts-in").forEach((el) => {
    const n = Math.round(Number(el.value));
    out[el.dataset.pts] = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : Number(el.dataset.def);
  });
  return out;
}

function setPoints(root, values) {
  root.querySelectorAll(".li-pts-in").forEach((el) => {
    const v = values && values[el.dataset.pts];
    if (v !== undefined && v !== null && v !== "") el.value = v;
  });
}

// Keep tooltips, "changed" marks, the total and the reset button in step with the inputs.
// totalOf(points) = the max total the server will scale to 100.
function refreshPoints(root, defs, totalEl, totalOf) {
  const pts = readPoints(root);
  let changed = false;
  root.querySelectorAll(".li-pts-in").forEach((el) => {
    const def = defs.find((d) => d.ptsKey === el.dataset.pts);
    const p = pts[el.dataset.pts];
    const diff = p !== Number(el.dataset.def);
    changed = changed || diff;
    const pill = el.parentElement;
    pill.classList.toggle("changed", diff);
    if (def) pill.title = def.rule(p) + (diff ? ` (default ${el.dataset.def})` : "");
  });
  if (totalEl) {
    const total = totalOf(pts);
    totalEl.querySelector(".li-pts-sum").textContent = total === 100
      ? "Points total 100 — score out of 100"
      : `Points total ${total} — score scaled to 100`;
    totalEl.querySelector(".li-pts-reset").hidden = !changed;
  }
}

function wirePoints(root, defs, totalEl, totalOf, onEdit) {
  const refresh = () => refreshPoints(root, defs, totalEl, totalOf);
  root.addEventListener("input", (e) => { if (e.target.closest(".li-pts-in")) { refresh(); onEdit(); } });
  root.addEventListener("change", (e) => {            // clamp to 0–100 whole points on commit
    const el = e.target.closest(".li-pts-in");
    if (el) { const n = Math.round(Number(el.value)); el.value = Number.isFinite(n) && el.value !== "" ? Math.max(0, Math.min(100, n)) : el.dataset.def; refresh(); }
  });
  totalEl && totalEl.querySelector(".li-pts-reset").addEventListener("click", () => {
    root.querySelectorAll(".li-pts-in").forEach((el) => { el.value = el.dataset.def; });
    refresh(); onEdit();
  });
  refresh();
  return refresh;
}

const ACTIVITY_TOTAL = (pts) => Object.values(pts).reduce((a, b) => a + b, 0);

function activityFieldHTML(f, value) {
  const cls  = f.full ? "li-form-field full" : "li-form-field";
  if (f.type === "area") {
    return `<div class="${cls}">
      ${formHeadHTML(f, `li-f-${f.key}`, "blue")}
      <textarea class="li-textarea" id="li-f-${f.key}">${liEsc(value)}</textarea>
    </div>`;
  }
  return `<div class="${cls}">
    ${formHeadHTML(f, `li-f-${f.key}`, "blue")}
    <input class="li-input" type="${f.type === "number" ? "number" : "text"}" id="li-f-${f.key}" value="${liEsc(value)}">
  </div>`;
}

// scrapeProfile() fills a missing activity with the placeholder "No activity data".
// Pre-filling the form with it would send it to /analyze, where typed values
// override Apify's real activity — so start that field empty instead.
function formValue(key, value) {
  if (key === "activity" && /^no activity data$/i.test(String(value || "").trim())) return "";
  return value;
}

function setBusy(ids, busy) {
  for (const id of ids) { const b = document.getElementById(id); if (b) b.disabled = !!busy; }
}

function statusWithRetry(id, message, onRetry) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message + " ";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "li-link";
  b.textContent = "Try again";
  b.onclick = onRetry;
  el.appendChild(b);
}
const ACTIVITY_ACTIONS = ["li-ai-refresh", "li-ai-save", "li-ai-calc"];

async function openActivityForm(reset) {
  reset = reset === true;   // a click event must never count as "reset"
  createPanel(PANELS.activity);

  const p     = scrapeProfile();
  const saved = await loadActivityFormValues();
  // The person's details come from Apify, not from this page: every box starts blank,
  // and a blank box means "use what Apify returns".
  const start = {};
  // The starting values — only values that differ from them are "yours" and get saved
  const scraped = Object.fromEntries(ACTIVITY_FIELDS.map((f) => [f.key, String(formValue(f.key, start[f.key]) ?? "")]));
  for (const f of ACTIVITY_FIELDS) {
    if (f.readOnly) continue;
    if (!saved._v && PAGE_FIELDS.includes(f.key)) continue;   // stale page value from an old build
    // Posts, Avg Likes, etc. reset to blank on Refresh like the keywords do.
    if (!reset && Object.prototype.hasOwnProperty.call(saved, f.key)) start[f.key] = saved[f.key];
  }
  const body = freshPanelBody("li-ai-body");
  if (!body) return;
  body.innerHTML = `
    <form id="li-activity-form" class="li-form-grid">
      ${ACTIVITY_FIELDS.map(f => activityFieldHTML(f, formValue(f.key, start[f.key]))).join("")}
      <input type="hidden" id="li-f-profile_url" value="${liEsc(p.profileUrl)}">
      ${signalKeywordsHTML()}
    </form>
    ${ptsTotalHTML("li-ai-pts-total", `<span class="li-pts-extra">Profile Completeness <span>from Apify</span> ${ptsPillHTML(ACTIVITY_COMPLETENESS, "blue")}</span>`)}
    <div class="li-form-status" id="li-ai-status" role="status"></div>
    <div class="li-form-actions">
      <button type="button" class="li-btn li-btn-ghost" id="li-ai-refresh">🔄 Refresh</button>
      <button type="button" class="li-btn li-btn-ghost" id="li-ai-save">💾 Save</button>
      <button type="button" class="li-btn li-btn-blue" id="li-ai-calc">🎯 Calculate Activity Score</button>
    </div>
  `;

  document.getElementById("li-activity-form").addEventListener("submit", e => e.preventDefault());
  for (const f of ACTIVITY_FIELDS) {
    const el = document.getElementById(`li-f-${f.key}`);
    if (el) el.dataset.scraped = scraped[f.key];
  }
  const refreshActPts = wirePoints(body, ACTIVITY_POINT_DEFS, document.getElementById("li-ai-pts-total"), ACTIVITY_TOTAL,
    () => setActivityStatus("Points changed — press Save or Calculate to use them."));
  wireChipEditors(body, "li-sig", () => setActivityStatus("Keywords changed — press Save or Calculate to use them."));
  body.addEventListener("input", (e) => { if (e.target.closest('.li-pts-in[data-pts="signals"]')) refreshSignalShares(body); });
  body.querySelector(".li-pts-reset")?.addEventListener("click", () => refreshSignalShares(body));
  SIGNAL_KW_FIELDS.forEach((f) => renderChips("li-sig", f.key));
  refreshSignalShares(body);
  document.getElementById("li-ai-refresh").onclick = () => openActivityForm(true);
  document.getElementById("li-ai-save").onclick    = () => saveActivitySettings();
  document.getElementById("li-ai-calc").onclick    = () => calculateActivityScore();

  // Save / Calculate post the whole keyword lists, so they stay off until the saved
  // lists have loaded — otherwise one click would overwrite them with blanks.
  setBusy(["li-ai-save", "li-ai-calc"], true);
  setActivityStatus(reset ? "Loading saved points…" : "Loading saved keywords and points…");
  loadActivitySettings()
    .then(({ points: pts, keywords }) => {
      const lists = reset ? null : keywords;
      if (!body.isConnected) return;   // replaced by a newer form
      setPoints(body, pts); refreshActPts(); refreshSignalShares(body);
      if (lists) {
        setKwLists("li-sig", lists);
        setActivityStatus(`Loaded ${countKeywords(lists)} saved keywords.`);
      } else {
        setActivityStatus("Fields and keywords cleared — Save or Calculate will store the keywords blank. Close and reopen the panel to reload your saved ones.");
      }
      setBusy(["li-ai-save", "li-ai-calc"], false);
    })
    .catch((err) => {
      if (!body.isConnected) return;
      statusWithRetry("li-ai-status", `⚠️ Could not load your saved keywords/points (${err.message}). Save and Calculate stay off so they aren't overwritten.`,
        () => openActivityForm(reset));
    });

}

// The signed-in user's own Activity scoring: points and keywords live in their
// workspace in the admin, and go with each /analyze request. They used to be saved
// on the analyzer, in one file every user shared.
async function loadActivitySettings() {
  const res = await adminMessage({ action: "activity-settings" });
  if (!res || !res.ok) throw new Error((res && res.error) || "the admin panel is not reachable");
  return res.data;
}

async function storeActivitySettings(points, keywords) {
  const res = await adminMessage({ action: "save-activity-settings", points, keywords });
  if (!res || !res.ok) throw new Error((res && res.error) || "the admin panel is not reachable");
  return res.data;
}

async function saveActivitySettings() {
  setBusy(ACTIVITY_ACTIONS, true);
  setActivityStatus("Saving…");
  try {
    saveActivityFormValues(collectActivityFormValues());
    const { keywords } = await storeActivitySettings(readPoints(document.getElementById("li-ai-body")), collectSignalKeywords());
    setActivityStatus(`✅ Saved ${countKeywords(keywords)} keywords, your points and this profile's typed values.`);
  } catch (err) {
    setActivityStatus(`❌ Not saved: ${err.message}`);
  } finally {
    setBusy(ACTIVITY_ACTIONS, false);
  }
}

async function calculateActivityScore() {
  const value  = key => document.getElementById(`li-f-${key}`)?.value ?? "";
  const btn    = document.getElementById("li-ai-calc");
  if (!btn) return;
  const p      = scrapeProfile();
  const scoreKey = scoreStoreKey();     // this person, even if the user navigates away
  const slug     = currentProfileSlug();
  const payload = {
    profile_url:        value("profile_url") || p.profileUrl,
    profileUrl:         value("profile_url") || p.profileUrl,
    // Everything about the person (name, headline, About, experience, company,
    // country, posts) comes from Apify on the server. Only what was typed into the
    // form is sent, and a typed value overrides Apify for that one field.
    position:           value("position"),
    activity:           value("activity"),
    posts_30_days:      parseInt(value("posts_30_days"), 10)   || 0,
    posts_90_days:      parseInt(value("posts_90_days"), 10)   || 0,
    avg_likes:          parseFloat(value("avg_likes"))         || 0,
    avg_comments:       parseFloat(value("avg_comments"))      || 0,
    avg_reposts:        parseFloat(value("avg_reposts"))       || 0,
  };

  setBusy(ACTIVITY_ACTIONS, true);
  btn.textContent = "⏳ Calculating…";
  setActivityStatus("");
  const loading = showScoringLoader("li-ai-body", {
    title: "Calculating the Activity score", stage: "Saving your points and keywords…",
    rows: activityFactors({}).map((f) => f.label), accent: "var(--li-blue)",
  });

  try {
    saveActivityFormValues(collectActivityFormValues());
    // Kept as this user's settings, and sent with the request: the analyzer scores
    // this one request with them and stores nothing.
    const points = readPoints(document.getElementById("li-ai-body"));
    const keywords = collectSignalKeywords();
    await storeActivitySettings(points, keywords);
    loading.stage("Reading their profile and recent posts…");
    const data = await apiFetch("/analyze", Object.assign({}, payload, { activity_points: points, activity_keywords: keywords }));
    await saveStoredScore("activity", data, scoreKey);
    updateLead(p.profileUrl, data.name || p.name, Object.assign(leadProfileFields(data), {
      headline: data.headline || "",
      company: (data.current_company && data.current_company !== "Not specified") ? data.current_company : "",
      activityScore: data.score_total || 0,
      activityLabel: data.score_label || "",
      activityBreakdown: activityFactors(data),
    }), () => pushLeadToAdmin(p.profileUrl, data.name || p.name));
    if (currentProfileSlug() !== slug || !document.getElementById("li-ai-body")) { loading.restore(); return; }   // saved; nothing to show here
    renderPanel(data, null, { fresh: true });
  } catch (err) {
    console.error("[LI-AI] ❌", err);
    loading.restore();
    setActivityStatus(`❌ ${err.message}`);
    const b = document.getElementById("li-ai-calc");
    if (b) b.textContent = "🎯 Calculate Activity Score";
    setBusy(ACTIVITY_ACTIONS, false);
  }
}

// Each keyword list is a chip editor: × removes a keyword, Enter / comma / Add
// adds one (paste a list to add many). The hidden textarea keeps one keyword per
// line, so loading and saving read the list exactly as a plain textarea would.
const ICON_X_SMALL = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const ICON_PLUS_SMALL = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

// Shared chip editor. `prefix` names the editor family ("li-sig" is the only one
// left, now that ICP rules are edited in the admin):
// the hidden textarea #<prefix>-<key> holds one keyword per line.
const KW_ON_EDIT = {};   // prefix → called after every add / remove
// "<prefix>|<key>" → Set of lowercased keywords switched off. A switched-off
// keyword stays in the list and keeps its place; it is just left out of scoring,
// so trying a rule without it never means retyping it.
const KW_OFF = {};
const kwOffSet = (prefix, key) => (KW_OFF[prefix + "|" + key] ||= new Set());
const kwIsOff = (prefix, key, kw) => kwOffSet(prefix, key).has(String(kw).toLowerCase());

function kwEditorHTML(prefix, key, label, tone, placeholder) {
  return `<div class="li-kw${tone === "blue" ? " blue" : ""}" data-prefix="${prefix}" data-key="${key}">
      <div class="li-kw-chips" role="list" aria-label="${liEsc(label)}"></div>
      <div class="li-kw-add">
        <input class="li-kw-input" id="${prefix}-${key}-new" type="text" autocomplete="off" spellcheck="false"
          placeholder="${liEsc(placeholder || "Type a keyword, press Enter")}">
        <button type="button" class="li-kw-addbtn" aria-label="Add keyword to ${liEsc(label)}">${ICON_PLUS_SMALL}Add</button>
      </div>
    </div>
    <textarea id="${prefix}-${key}" hidden></textarea>`;
}

const kwBox = (prefix, key) => document.querySelector(`.li-kw[data-prefix="${prefix}"][data-key="${key}"]`);

function kwList(prefix, key) {
  const ta = document.getElementById(`${prefix}-${key}`);
  return (ta ? ta.value : "").split("\n").map((s) => s.trim()).filter(Boolean);
}

// Redraw one editor's chips from its textarea (the source of truth).
function renderChips(prefix, key) {
  const box = kwBox(prefix, key)?.querySelector(".li-kw-chips");
  if (!box) return;
  const list = kwList(prefix, key);
  box.innerHTML = list.length
    ? list.map((kw, i) => {
        const off = kwIsOff(prefix, key, kw);
        return `<span class="li-kw-chip${off ? " off" : ""}" role="listitem">
        <button type="button" class="li-kw-text" data-toggle="${i}" aria-pressed="${off ? "false" : "true"}"
          title="${liEsc(off ? "Switch on: " + kw : "Switch off (keeps it in the list): " + kw)}">${liEsc(kw)}</button>
        <button type="button" class="li-kw-x" data-i="${i}" aria-label="Remove ${liEsc(kw)}">${ICON_X_SMALL}</button></span>`;
      }).join("")
    : `<span class="li-kw-empty">No keywords yet</span>`;
}

function setKwList(prefix, key, list) {
  const ta = document.getElementById(`${prefix}-${key}`);
  if (ta) ta.value = list.join("\n");
  renderChips(prefix, key);
  if (KW_ON_EDIT[prefix]) KW_ON_EDIT[prefix]();
}

function setKwLists(prefix, lists) {
  for (const [key, list] of Object.entries(lists || {})) {
    const ta = document.getElementById(`${prefix}-${key}`);
    if (ta && Array.isArray(list)) { ta.value = list.join("\n"); renderChips(prefix, key); }
  }
}

// Add typed / pasted keywords (comma, semicolon or newline separated); duplicates are skipped and flagged.
function addKeywords(prefix, key, raw) {
  const list  = kwList(prefix, key);
  const lower = list.map((k) => k.toLowerCase());
  const dupes = [];
  for (const kw of String(raw || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
    if (lower.includes(kw.toLowerCase())) { dupes.push(kw); continue; }
    list.push(kw); lower.push(kw.toLowerCase());
  }
  if (list.length !== kwList(prefix, key).length) setKwList(prefix, key, list);
  for (const d of dupes) {
    const chip = kwBox(prefix, key)?.querySelectorAll(".li-kw-chip")[lower.indexOf(d.toLowerCase())];
    if (chip) { chip.classList.remove("dupe"); void chip.offsetWidth; chip.classList.add("dupe"); }
  }
}

function wireChipEditors(root, prefix, onEdit) {
  KW_ON_EDIT[prefix] = onEdit;
  const mine = (el) => { const kw = el.closest(".li-kw"); return kw && kw.dataset.prefix === prefix ? kw : null; };
  root.addEventListener("click", (e) => {
    const kw = mine(e.target);
    if (!kw) return;
    const key = kw.dataset.key;
    const x = e.target.closest(".li-kw-x");
    if (x) {
      const list = kwList(prefix, key);
      list.splice(+x.dataset.i, 1);
      setKwList(prefix, key, list);
      document.getElementById(`${prefix}-${key}-new`)?.focus();
      return;
    }
    const toggle = e.target.closest(".li-kw-text");
    if (toggle) {
      const kwText = kwList(prefix, key)[+toggle.dataset.toggle];
      if (kwText) {
        const set = kwOffSet(prefix, key);
        const id = String(kwText).toLowerCase();
        set.has(id) ? set.delete(id) : set.add(id);
        renderChips(prefix, key);
        if (KW_ON_EDIT[prefix]) KW_ON_EDIT[prefix]();
      }
      return;
    }
    const add = e.target.closest(".li-kw-addbtn");
    if (add) {
      const input = kw.querySelector(".li-kw-input");
      addKeywords(prefix, key, input.value);
      input.value = "";
      input.focus();
      return;
    }
    // Clicking the empty area of the box focuses its input
    if (!e.target.closest("button, input")) kw.querySelector(".li-kw-input")?.focus();
  });
  root.addEventListener("keydown", (e) => {
    const input = e.target.closest(".li-kw-input");
    const kw = input && mine(input);
    if (!kw) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addKeywords(prefix, kw.dataset.key, input.value);
      input.value = "";
    } else if (e.key === "Backspace" && !input.value) {
      const list = kwList(prefix, kw.dataset.key);
      if (list.length) { list.pop(); setKwList(prefix, kw.dataset.key, list); }
    }
  });
  root.addEventListener("paste", (e) => {
    const input = e.target.closest(".li-kw-input");
    const kw = input && mine(input);
    const text = e.clipboardData && e.clipboardData.getData("text");
    if (!kw || !text || !/[\n,;]/.test(text)) return;   // single word: normal paste
    e.preventDefault();
    addKeywords(prefix, kw.dataset.key, input.value + "," + text);
    input.value = "";
  });
}
