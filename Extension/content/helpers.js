// LinkedIn AI Analyzer content script - Page helpers, theme, per-profile storage, the profile action buttons.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ─── Helpers ──────────────────────────────────────────────────────────────────
// The person's main profile page (also while a /overlay/… modal such as Contact
// info is open over it). Sub-pages like /recent-activity/ or /details/ have no
// top card, so no Activity / ICP buttons there.
function isProfilePage() { return /^\/in\/[^/]+\/?(overlay\/.*)?$/i.test(location.pathname); }

function currentProfileSlug() { return liLeadSlug(location.href); }

// "kristin-bryce-6b5a7a26" → "Kristin Bryce". A readable name from the URL alone, for
// the moments when the page's own <h1> cannot be read. The trailing hash LinkedIn adds
// to disambiguate people is dropped; the admin builds its display names the same way.
function nameFromSlug(slug) {
  return String(slug || "").replace(/-?[0-9a-f]{6,}$/i, "")
    .split(/[-_]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Who a result panel is about. Both panels head their result with this, so they can
// never disagree about the same person: the first candidate that is a real name wins,
// then the slug in the URL. "Unknown" is what scrapeProfile answers when LinkedIn's
// <h1> is not readable — it is the absence of a name, never a name to print.
function safeScrape() {
  try { return scrapeProfile(); }
  catch (e) { console.error("[LI-AI] profile scrape failed", e); return {}; }
}

function profileDisplayName(...candidates) {
  return candidates.find((v) => v && v !== "Unknown") || nameFromSlug(currentProfileSlug());
}

// One canonical URL per person: https://www.linkedin.com/in/<slug>/
function profileKeyUrl() { return liProfileUrl(location.href) || location.href.split("?")[0]; }

// LinkedIn's own profile action buttons (Message / More / Connect / Follow …),
// found by their text or screen-reader label so class-name changes don't matter.
const ACTION_BTN_SEL = 'button, a[role="button"], a[href*="/messaging/"]';
const actionLabel = (b) => cleanLine((b.innerText || b.textContent || "") + " " + (b.getAttribute("aria-label") || ""));
function actionButtons(scope) {
  return [...scope.querySelectorAll(ACTION_BTN_SEL)]
    .filter((b) => !b.closest("aside, header, nav, footer, " + OUR_UI_SEL + ', [class*="msg-overlay"]'));
}
function pickActionButton(btns) {
  const has = (re) => btns.find((b) => re.test(actionLabel(b)));
  return has(/^more\b/i) || has(/^message\b/i) || has(/^(connect|follow|pending)\b|\binvite .+ to connect\b/i) ||
    has(/^open to\b/i) || null;
}

// The card holding the person's name: a <section> in LinkedIn's usual markup;
// otherwise the smallest block around the name that also holds its action buttons.
function topCardSection() {
  const main = document.querySelector("main") || document.body;
  const h1 = main.querySelector("h1");
  if (!h1) return null;
  const known = h1.closest('section, [class*="top-card"], [componentkey*="topcard" i], [data-view-name*="top-card"]');
  if (known && known !== main) return known;
  for (let el = h1.parentElement, i = 0; el && el !== main && i < 10; el = el.parentElement, i++) {
    if (pickActionButton(actionButtons(el))) return el;
  }
  // No buttons at all: the nearest block that also holds the lines under the name
  for (let el = h1.parentElement, i = 0; el && el !== main && i < 4; el = el.parentElement, i++) {
    if (visibleLines(el).length >= 3) return el;
  }
  return h1.parentElement;
}

let _noNameLogged = false;
function findActionTarget() {
  const card = topCardSection();
  const selectors = [
    '[class*="pv-s-profile-actions"]',
    '[class*="profile-actions"]',
    '[class*="profile-card-actions"]',
  ];
  for (const scope of [card, document]) {
    if (!scope) continue;
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el && !el.closest("aside")) return el.querySelector('button, a[role="button"]') || el;
    }
  }
  // Unknown layout: LinkedIn's own buttons by label — the name's card first, then the page
  for (const scope of [card, document.querySelector("main")]) {
    const hit = scope && pickActionButton(actionButtons(scope));
    if (hit) return hit;
  }
  // Last resort: right under the person's name, so the buttons are never missing
  const h1 = (document.querySelector("main") || document).querySelector("h1");
  if (h1) return h1.parentElement && h1.parentElement !== document.body ? h1.parentElement : h1;
  if (!_noNameLogged) { _noNameLogged = true; console.info("[LI-AI] Activity / ICP buttons: profile name not found on this page yet"); }
  return null;
}


// ─── Automatic light/dark switch (follows LinkedIn's own theme) ───────────────
function detectDarkTheme() {
  try {
    const html = document.documentElement;
    const body = document.body;
    const hints = [
      html.getAttribute("data-theme"), html.getAttribute("data-color-theme"),
      html.getAttribute("data-theme-name"), html.getAttribute("data-mode"),
      body ? body.getAttribute("data-theme") || "" : "",
      (html.className || "") + " " + (body ? body.className || "" : ""),
    ].join(" ");
    if (/\b(dark|dim|night)\b/i.test(hints)) return true;
    if (/\b(light|daytime)\b/i.test(hints)) return false;
    // No explicit marker → measure the actual page background luminance
    for (const el of [body, html]) {
      if (!el) continue;
      const bg = getComputedStyle(el).backgroundColor;
      const rgba = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?/.exec(bg);
      if (!rgba) continue;
      if (rgba[4] !== undefined && parseFloat(rgba[4]) === 0) continue; // transparent
      const lum = 0.2126 * +rgba[1] + 0.7152 * +rgba[2] + 0.0722 * +rgba[3];
      if (lum < 70)  return true;   // near-black background → dark mode
      if (lum > 150) return false;  // white-ish background → light mode
    }
  } catch (e) { /* fall through */ }
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch (e) { return false; }
}

function applyTheme() {
  try {
    const want = detectDarkTheme() ? "dark" : "light";
    if (document.documentElement.getAttribute("data-li-theme") !== want) {
      document.documentElement.setAttribute("data-li-theme", want);
    }
  } catch (e) { /* keep current theme */ }
}

function watchTheme() {
  applyTheme();
  try {
    const obs = new MutationObserver(applyTheme);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-theme", "data-theme-name", "data-mode", "style"],
    });
    if (document.body) {
      obs.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    }
  } catch (e) { /* observer optional */ }
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", applyTheme);
  } catch (e) { /* media query optional */ }
}

// ─── Per-profile storage (scores and typed form values) ────────────────────────
// Keys use the canonical profile URL. Older builds keyed by the raw address
// (with or without the trailing slash) — those are still read, then replaced.
function storeKey(prefix) { return prefix + profileKeyUrl(); }

function legacyStoreKeys(prefix) {
  const raw = location.href.split("?")[0].split("#")[0];
  const alt = raw.endsWith("/") ? raw.slice(0, -1) : raw + "/";
  return [prefix + raw, prefix + alt].filter((k) => k !== storeKey(prefix));
}

function storageGet(keys) {
  return new Promise((resolve) => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) return resolve({});
      chrome.storage.local.get(keys, (r) => resolve(r || {}));
    } catch (e) { resolve({}); }
  });
}

function storageSet(items, removeKeys) {
  try {
    if (!chrome.runtime || !chrome.runtime.id) return;
    chrome.storage.local.set(items);
    if (removeKeys && removeKeys.length) chrome.storage.local.remove(removeKeys);
  } catch (e) { /* extension reloaded — the page keeps working without storage */ }
}

// Object stored under `prefix` for this profile, merged over any legacy copies.
async function loadProfileStore(prefix) {
  const key = storeKey(prefix);
  const legacy = legacyStoreKeys(prefix);
  const r = await storageGet([key, ...legacy]);
  return Object.assign({}, ...legacy.map((k) => r[k] || {}), r[key] || {});
}

function saveProfileStore(prefix, value, key) {
  storageSet({ [key || storeKey(prefix)]: value }, key ? [] : legacyStoreKeys(prefix));
}

function scoreStoreKey() { return storeKey("liScore:"); }

// ─── Stored Activity form values: typed fields survive a page reload ──────────
function loadActivityFormValues() { return loadProfileStore("liActForm:"); }

// _v:2 = holds only typed values. Older stores also kept page values
// (activity text, mutual count), which must not override a fresh scrape.
function saveActivityFormValues(values, key) { saveProfileStore("liActForm:", Object.assign({ _v: 2 }, values), key); }
const PAGE_FIELDS = ["activity"];

// Only the values you typed. Pre-filled page values (e.g. "Last active 2 days ago")
// are left out so a later visit reads them fresh instead of reusing stale ones.
function collectActivityFormValues() {
  const out = {};
  for (const f of ACTIVITY_FIELDS) {
    if (f.readOnly) continue;
    const el = document.getElementById(`li-f-${f.key}`);
    if (el && el.value !== (el.dataset.scraped || "")) out[f.key] = el.value;
  }
  return out;
}

function loadStoredScores() { return loadProfileStore("liScore:"); }

// `key` = the profile key captured when the calculation STARTED, so a result
// never lands on another person if the user navigated away meanwhile.
async function saveStoredScore(kind, data, key) {
  key = key || scoreStoreKey();
  const r = await storageGet([key]);
  const all = Object.assign({}, key === scoreStoreKey() ? await loadStoredScores() : {}, r[key] || {});
  all[kind] = { data, savedAt: Date.now() };
  saveProfileStore("liScore:", all, key === scoreStoreKey() ? undefined : key);
}

function fmtSavedAt(ts) {
  if (!ts) return "";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
function addAIButton() {
  if (!isProfilePage()) return;
  const wantActivity = featureOn("activityAnalysis");    // the ICP's Activity analysis switch
  if ((!wantActivity || document.getElementById("li-ai-analyze-btn")) && document.getElementById("li-icp-btn")) return;
  const anchor = findActionTarget();
  if (!anchor) return;
  applyTheme();

  if (wantActivity && !document.getElementById("li-ai-analyze-btn")) {
    const btn = document.createElement("button");
    btn.id = "li-ai-analyze-btn";
    btn.type = "button";
    btn.textContent = "Activity";
    anchor.insertAdjacentElement("afterend", btn);
    btn.addEventListener("click", handleAnalyzeClick);
  }

  if (!document.getElementById("li-icp-btn")) {
    const icpBtn = document.createElement("button");
    icpBtn.id = "li-icp-btn";
    icpBtn.type = "button";
    icpBtn.textContent = "ICP";
    const actBtn = document.getElementById("li-ai-analyze-btn");
    (actBtn || anchor).insertAdjacentElement("afterend", icpBtn);
    icpBtn.addEventListener("click", handleIcpClick);
  }
}
