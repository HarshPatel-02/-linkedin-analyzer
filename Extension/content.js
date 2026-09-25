// ─── LinkedIn Profile Scraper ──────────────────────────────────────────────────

// "Last active 3 days ago" from the most recent time found in LinkedIn's Activity
// section text ("2 weeks ago", "3d •", "1mo •", "2y •"); "" when none is found.
function newestActivityText(text) {
  const perDay = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365,
                   h: 1 / 24, d: 1, w: 7, mo: 30, yr: 365, y: 365 };
  const names = { h: "hour", d: "day", w: "week", mo: "month", yr: "year", y: "year" };
  const re = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago|(\d+)\s*(mo|yr|[hdwy])\s*•/gi;
  let best = null;
  for (const m of String(text || "").matchAll(re)) {
    const n = parseInt(m[1] || m[3], 10);
    const u = (m[2] || m[4]).toLowerCase();
    const days = n * perDay[u];
    if (!Number.isFinite(days)) continue;
    if (!best || days < best.days) best = { days, n, unit: names[u] || u };
  }
  if (!best) return "";
  if (best.days < 1 / 24) return "Last active just now";
  return `Last active ${best.n} ${best.unit}${best.n === 1 ? "" : "s"} ago`;
}

// ─── Scrape helpers ────────────────────────────────────────────────────────────
const cleanLine = (s) => String(s || "").replace(/\s+/g, " ").trim();
const BLOCK_TAG_RE = /^(DIV|P|LI|UL|OL|SECTION|ARTICLE|HEADER|FOOTER|H[1-6]|TR|TABLE|DL|DT|DD|BLOCKQUOTE|FIGURE|FIGCAPTION|MAIN|ASIDE|NAV)$/;
const SKIP_TAG_RE = /^(BUTTON|SVG|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IMG|INPUT|TEXTAREA|SELECT)$/;
const DATE_RANGE_RE = /\b(19|20)\d{2}\b|\bpresent\b/i;
const UI_LINE_RE = /^(about|activity|message|messaging|more|connect|follow|following|pending|contact info|open to|add profile section|enhance profile|resources|home|my network|jobs|notifications?|search|for business|linkedin|show all\b.*|see (more|all)\b.*|…\s*see more)$/i;
const COUNT_LINE_RE = /\b[\d,.]+\+?\s*(connections?|followers?)\b|\bmutual connections?\b/i;
const LOCATION_WORD_RE = /\b(area|region|metropolitan|greater|remote|india|united states|usa|uk|united kingdom|canada|australia|germany|singapore|uae|united arab emirates|dubai|france|netherlands|ireland|new zealand|south africa|nigeria|kenya|pakistan|bangladesh|philippines|indonesia|malaysia|japan|brazil|mexico|spain|italy|sweden|switzerland)\b/i;
const OUR_UI_SEL = "#li-ai-panel, #li-icp-panel";

// Visible text of `el`, one entry per line. LinkedIn prints every string twice —
// a visible span[aria-hidden="true"] plus a .visually-hidden copy for screen
// readers — so each visible span becomes one line and the copies are skipped,
// along with buttons, icons and closed menus.
function visibleLines(el, skipSubLists) {
  if (!el) return [];
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === 3) { parts.push(node.nodeValue); return; }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName).toUpperCase();
    if (SKIP_TAG_RE.test(tag) || node.hidden) return;
    const cls = typeof node.className === "string" ? node.className : "";
    if (/\bvisually-hidden\b/.test(cls)) return;
    if (node.getAttribute("aria-hidden") === "true") {
      if (tag === "SPAN") parts.push("\n", spanText(node), "\n");
      return;
    }
    if (skipSubLists && node !== el && (tag === "UL" || tag === "OL")) return;
    if (tag === "BR") { parts.push("\n"); return; }
    const block = BLOCK_TAG_RE.test(tag);
    if (block) parts.push("\n");
    for (const c of node.childNodes) walk(c);
    if (block) parts.push("\n");
  };
  try { walk(el); } catch (e) { return []; }
  const lines = parts.join("").split("\n").map(cleanLine).filter((l) => l && !/^[·•|,\-–—…]+$/.test(l));
  return lines.filter((l, i) => l !== lines[i - 1]);
}

// Text of one visible span; <br> and block children still break the line, so
// "Services<br>Remote monitoring" never turns into "ServicesRemote monitoring".
function spanText(span) {
  let out = "";
  for (const c of span.childNodes) {
    if (c.nodeType === 3) out += c.nodeValue;
    else if (c.nodeType === 1) {
      const tag = String(c.tagName).toUpperCase();
      if (tag === "BR") out += "\n";
      else if (!SKIP_TAG_RE.test(tag)) {
        const inner = spanText(c);
        out += BLOCK_TAG_RE.test(tag) ? "\n" + inner + "\n" : inner;
      }
    }
  }
  return out;
}

function sectionHeading(sec) {
  const h = sec.querySelector("h2, h3");
  return h ? (visibleLines(h)[0] || "").toLowerCase() : "";
}

// A profile card by LinkedIn's anchor id (#about, #experience …) or, when the
// markup changes, by its heading text.
function findSection(title, anchorId) {
  const anchor = anchorId ? document.getElementById(anchorId) : null;
  if (anchor && !anchor.closest(OUR_UI_SEL)) {
    const sec = anchor.closest("section") || anchor.parentElement;
    if (sec) return sec;
  }
  const want = title.toLowerCase();
  for (const sec of (document.querySelector("main") || document).querySelectorAll("section")) {
    if (sec.closest(OUR_UI_SEL) || sec.closest("aside")) continue;
    if (sectionHeading(sec) === want) return sec;
  }
  return null;
}

// Top-level entries of a card; nested lists hold grouped roles or skill details.
function sectionEntries(sec) {
  if (!sec) return [];
  return [...sec.querySelectorAll("li")].filter((li) => {
    const outer = li.parentElement && li.parentElement.closest("li");
    return !outer || !sec.contains(outer);
  });
}

function firstLines(sec, max, maxLen) {
  const out = [];
  for (const li of sectionEntries(sec)) {
    const t = (visibleLines(li, true).filter((l) => !UI_LINE_RE.test(l))[0]) || "";
    if (t.length > 1 && t.length < (maxLen || 200) && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

// [{title, company}] newest first. Grouped entries (one company, several roles)
// list the company first and the roles in a nested list.
function parseExperience(sec) {
  const entries = [];
  for (const li of sectionEntries(sec)) {
    const lines = visibleLines(li, true).filter((l) => !UI_LINE_RE.test(l));
    if (!lines.length) continue;
    const roles = [...li.querySelectorAll("li")].filter((x) => x !== li)
      .map((x) => visibleLines(x, true)).filter((ls) => ls.length && DATE_RANGE_RE.test(ls.join(" ")));
    let title = "", company = "";
    if (roles.length && !DATE_RANGE_RE.test(lines.slice(0, 3).join(" "))) {
      company = lines[0];
      title = roles[0][0];
    } else {
      title = lines[0];
      const second = lines[1] || "";
      company = second && !DATE_RANGE_RE.test(second) ? second.split(" · ")[0].trim() : "";
    }
    if (title && !company && / at /i.test(title)) {
      const parts = title.split(/ at /i);
      company = parts.pop().trim();
      title = parts.join(" at ").trim();
    }
    if (title.length > 1) entries.push({ title, company });
  }
  return entries;
}

function currentCompanyFromTopCard(topCard) {
  try {
    const el = topCard.querySelector('[aria-label^="Current company" i]');
    const m = el && /current company:\s*(.+?)(?:\.\s*click\b.*)?$/i.exec(el.getAttribute("aria-label") || "");
    return m ? cleanLine(m[1]) : "";
  } catch (e) { return ""; }
}

function headlineOK(t, name) {
  return !!t && t.length > 2 && t.length < 220 && t !== name &&
    !UI_LINE_RE.test(t) && !COUNT_LINE_RE.test(t) && !/notification/i.test(t);
}

function scrapeHeadline(topCard, mainEl, nameEl, name) {
  const after = (el) => !nameEl || !!(nameEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const sel = '[class*="text-body-medium"], [data-generated-suggestion-target], [class*="headline"]';
  for (const scope of [topCard, mainEl]) {
    for (const el of scope.querySelectorAll(sel)) {
      if (!after(el) || el.closest(OUR_UI_SEL + ", aside, button")) continue;
      const t = visibleLines(el)[0] || "";
      if (headlineOK(t, name)) return t;
    }
  }
  // Page title: "Name - Headline | LinkedIn" or "Name | Headline | LinkedIn"
  const title = document.title || "";
  const parts = title.split("|").map(cleanLine).filter(Boolean);
  let t = parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1]) ? parts.slice(1, -1).join(", ") : "";
  if (!t) { const m = title.match(/\s[—-]\s(.+?)\s*\|\s*LinkedIn/i); t = m ? cleanLine(m[1]) : ""; }
  return headlineOK(t, name) ? t : "";
}

// Redesigned top cards without the usual classes: the first plain line under the name.
function headlineFromLines(topCard, name, location) {
  const lines = visibleLines(topCard);
  const i = lines.findIndex((l) => name && l.startsWith(name));
  for (const l of lines.slice(i + 1, i + 7)) {
    if (/^(he|she|they)\s*\/\s*(him|her|them)$|^·?\s*(1st|2nd|3rd\+?)$|^(premium|verified)$/i.test(l)) continue;
    if (l === location) continue;
    if (headlineOK(l, name)) return l;
  }
  return "";
}

function scrapeLocation(topCard, headline) {
  // Some layouts print the "Contact info" link on the same line as the location
  const strip = (t) => cleanLine(String(t || "").replace(/\s*[·•]?\s*contact info\s*$/i, ""));
  const ok = (t) => !!t && t.length > 2 && t.length < 100 && t !== headline &&
    !COUNT_LINE_RE.test(t) && !UI_LINE_RE.test(t) && !/contact info|[|@]/i.test(t) &&
    (/,/.test(t) || LOCATION_WORD_RE.test(t));
  const smalls = [...topCard.querySelectorAll('[class*="text-body-small"]')]
    .filter((el) => !el.closest("button, a, " + OUR_UI_SEL));
  const ci = topCard.querySelector('#top-card-text-details-contact-info, a[href*="contact-info"]');
  const near = ci ? smalls.filter((el) => el.parentElement && el.parentElement.contains(ci)) : [];
  for (const el of [...near, ...smalls]) {
    const t = strip(visibleLines(el)[0]);
    if (ok(t)) return t;
  }
  const lines = visibleLines(topCard).map(strip);
  const start = headline ? lines.indexOf(headline) + 1 : 0;
  return lines.slice(start, start + 8).find(ok) || "";
}

function parseMutualText(txt) {
  const num = (s) => parseInt(String(s || "").replace(/,/g, ""), 10) || 0;
  let m;
  if ((m = txt.match(/and\s+([\d,]+)\s+others?\s+mutual/i))) {
    const named = (txt.split(/\s+and\s+[\d,]+\s+others?/i)[0] || "").split("\n").pop();
    return named.split(",").filter((s) => s.trim()).length + num(m[1]);
  }
  if ((m = txt.match(/(?:^|\n)\s*([^\n]+?)\s+are\s+mutual\s+connections?/i))) {
    return m[1].split(/,|\band\b/).filter((s) => s.trim()).length;
  }
  if (/\bis\s+a\s+mutual\s+connection/i.test(txt)) return 1;
  if ((m = txt.match(/([\d,]+)\s+mutual\s+connections?/i))) return num(m[1]);
  return 0;
}

// Only the top card counts: the sidebar ("People also viewed") shows OTHER
// people's mutual connections.
function scrapeMutualConnections(topCard) {
  for (const el of topCard.querySelectorAll("a, span, p, li, div, button")) {
    if (el.closest("aside, " + OUR_UI_SEL)) continue;
    const txt = (el.innerText || el.textContent || "").trim();
    if (!txt || txt.length > 200 || !/mutual/i.test(txt)) continue;
    const n = parseMutualText(txt);
    if (n) return n;
  }
  return 0;
}

// The profile owner's photo. Never the viewer's own nav avatar, a sidebar
// thumbnail or the mutual-connection face pile, so a profile without a photo
// stays without one.
function scrapeAvatar(topCard) {
  let best = "", bestSize = -1;
  for (const img of topCard.querySelectorAll('img[src*="profile-displayphoto"]')) {
    if (img.closest("aside, header, nav, #global-nav, " + OUR_UI_SEL)) continue;
    if (img.closest('a[href*="/search/results"], [class*="mutual"], [class*="facepile"], [class*="face-pile"]')) continue;
    const link = img.closest("a");
    if (link && /mutual/i.test(link.textContent || "")) continue;
    const size = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
    if (size > bestSize) { best = img.src; bestSize = size; }
  }
  return best;
}

function scrapeProfile() {
  const result = {
    avatar: "", name: "", position: "", headline: "", country: "",
    about: "", current_company: "", education: "", experience: "",
    skills: "", projects: "", activity: "",
    mutual_connections: 0,
    profileUrl: liProfileUrl(location.href) || location.href.split("?")[0],
  };

  const mainEl = document.querySelector("main") || document.body;
  const nameEl = mainEl.querySelector("h1") || document.querySelector("h1");
  const topCard = topCardSection() || mainEl;

  if (nameEl) {
    const raw = visibleLines(nameEl)[0] || cleanLine(nameEl.textContent);
    result.name = raw.replace(/\s*\([^)]*\)\s*$/g, "").trim() || "Unknown";
  }

  result.mutual_connections = scrapeMutualConnections(topCard);
  result.avatar = scrapeAvatar(topCard);
  result.headline = scrapeHeadline(topCard, mainEl, nameEl, result.name);
  result.country = scrapeLocation(topCard, result.headline);
  if (!result.headline) result.headline = headlineFromLines(topCard, result.name, result.country);

  const aboutSec = findSection("About", "about");
  if (aboutSec) {
    const lines = visibleLines(aboutSec).filter((l) => !/^about$/i.test(l) && !UI_LINE_RE.test(l));
    result.about = lines.join(" ").trim() || "Not specified";
  }

  const roles = parseExperience(findSection("Experience", "experience"));
  if (roles.length) {
    result.experience = roles.slice(0, 10).map((r) => r.title + (r.company ? " at " + r.company : "")).join(" | ");
    const cur = roles[0];
    // "Headline / Position" = the current job title from the newest Experience entry
    if (cur.title.length <= 120 && !DATE_RANGE_RE.test(cur.title)) result.position = cur.title;
    result.current_company = cur.company;
  }
  result.current_company = currentCompanyFromTopCard(topCard) || result.current_company || "Not specified";
  if (!result.position) result.position = result.headline;

  result.education = firstLines(findSection("Education", "education"), 6).join(" | ") || "Not specified";
  result.skills    = firstLines(findSection("Skills", "skills"), 15, 100).join(" • ") || "Not specified";
  result.projects  = firstLines(findSection("Projects", "projects"), 6).join(" | ") || "No projects";

  const actSec = findSection("Activity", "content_collections");
  if (actSec) {
    // innerText has LinkedIn's compact "3d •"; textContent adds the screen-reader "3 days ago"
    const text = (actSec.innerText || "") + "\n" + (actSec.textContent || "");
    result.activity = newestActivityText(text) ||
      (/\bposted\b/i.test(text) ? "Posted recently" : text.length > 200 ? "Has recent activity" : "No recent activity");
  }
  if (!result.activity) result.activity = "No activity data";

  return result;
}

// ─── Message Listener ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getProfile") {
    try { sendResponse({ success: true, data: scrapeProfile() }); }
    catch (e) { sendResponse({ success: false, error: e.message }); }
  }
  return true;
});

// ─── Styles ───────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("li-ai-styles")) return;
  const style = document.createElement("style");
  style.id = "li-ai-styles";
  style.textContent = `
    /* ── Theme variables: switch automatically with LinkedIn's dark mode ── */
    :root{
      --li-bg:#fff; --li-fg:#111827; --li-fg-2:#374151; --li-muted:#6b7280; --li-muted-2:#9ca3af;
      --li-border:#e5e7eb; --li-border-2:#d1d5db; --li-surface:#f9fafb; --li-surface-2:#f3f4f6;
      --li-input-bg:#fff; --li-track:#e5e7eb; --li-thumb:#d1d5db;
      --li-blue:#0a66c2; --li-green:#059669; --li-purple:#7c3aed; --li-purple-fg:#fff;
      --li-blue-fill:#0a66c2; --li-blue-fg:#fff;
      --li-green-fill:#059669; --li-green-fg:#fff;
      --li-ok:#16a34a; --li-warn:#f59e0b; --li-bad:#dc2626;
      --li-chip-bg:#ecfdf5; --li-chip-fg:#059669; --li-kw-fg:#047857;
      --li-warn-bg:#fffbeb; --li-warn-fg:#92400e; --li-warn-border:#fcd34d;
      --li-shadow:rgba(0,0,0,.06); --li-hover:#f3f4f6;
    }
    :root[data-li-theme="dark"]{
      --li-bg:#1d2226; --li-fg:#e6eaed; --li-fg-2:#cfd4d8; --li-muted:#9aa3ab; --li-muted-2:#949ca3;
      --li-border:#363c42; --li-border-2:#454c53; --li-surface:#23282d; --li-surface-2:#2b3136;
      --li-input-bg:#2b3136; --li-track:#363c42; --li-thumb:#454c53;
      --li-blue:#6cb1ff; --li-green:#45c08b; --li-purple:#a78bfa; --li-purple-fg:#101418;
      --li-blue-fill:#6cb1ff; --li-blue-fg:#101418;
      --li-green-fill:#45c08b; --li-green-fg:#101418;
      --li-ok:#4ade80; --li-warn:#fbbf24; --li-bad:#f87171;
      --li-chip-bg:#103326; --li-chip-fg:#45c08b; --li-kw-fg:#45c08b;
      --li-warn-bg:#3a2f10; --li-warn-fg:#fde68a; --li-warn-border:#a16207;
      --li-shadow:rgba(0,0,0,.45); --li-hover:#2b3136;
    }
    #li-ai-analyze-btn, #li-icp-btn {
      display:inline-flex;align-items:center;justify-content:center;
      gap:6px;padding:0 16px;height:34px;
      border:1.5px solid var(--li-blue);border-radius:999px;
      background:var(--li-input-bg);color:var(--li-blue);cursor:pointer;
      font-size:13px;font-weight:600;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      transition:all .15s ease;
      white-space:nowrap;flex-shrink:0;z-index:9999;position:relative;align-self:center;
    }
    #li-ai-analyze-btn:hover{background:var(--li-blue-fill);color:var(--li-blue-fg);box-shadow:0 2px 8px rgba(10,102,194,.25);}
    #li-icp-btn{border-color:var(--li-green);color:var(--li-green);}
    #li-icp-btn:hover{background:var(--li-green-fill);color:var(--li-green-fg);box-shadow:0 2px 8px rgba(5,150,105,.25);}
    #li-ai-panel, #li-icp-panel{
      margin:12px 0;border-radius:10px;border:1px solid var(--li-border);
      background:var(--li-bg);box-shadow:0 2px 16px var(--li-shadow);overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    }
    .panel-header{padding:18px 22px;background:#0a66c2;color:#fff;display:flex;justify-content:space-between;align-items:center;}
    .panel-header span{font-weight:700;font-size:20px!important;letter-spacing:-.2px;}
    .panel-close{background:none;border:none;color:#fff;font-size:24px!important;cursor:pointer;line-height:1;padding:0 4px;opacity:.7;}
    .panel-close:hover{opacity:1;}
    .panel-body{padding:22px;max-height:80vh;overflow-y:auto;font-size:16px!important;color:var(--li-fg);}
    .li-profile-card{display:flex;gap:16px;padding:18px;border:1px solid var(--li-border);border-radius:10px;margin-bottom:16px;align-items:flex-start;}
    .li-avatar{width:80px;height:80px;border-radius:999px;object-fit:cover;flex-shrink:0;}
    .li-profile-info{flex:1;}
    .li-name{font-size:22px!important;font-weight:700;color:var(--li-fg);margin-bottom:4px;}
    .li-meta{font-size:14px!important;color:var(--li-muted);margin-bottom:2px;}
    .li-section{margin-bottom:14px;}
    .li-section-title{font-size:11px!important;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--li-muted-2);margin-bottom:6px;}
    .li-section-content{font-size:14px!important;color:var(--li-fg-2);line-height:1.6;padding:14px 16px;background:var(--li-surface);border-radius:6px;}
    .score-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:600;}
    @keyframes li-spin{to{transform:rotate(360deg);}}
    .panel-body::-webkit-scrollbar{width:5px;}
    .panel-body::-webkit-scrollbar-thumb{background:var(--li-thumb);border-radius:3px;}

    /* ── Forms: ICP keywords + Activity details ─────────────────────────── */
    .li-form-note{font-size:12px!important;color:var(--li-muted);background:var(--li-surface);border:1px solid var(--li-border);border-radius:6px;padding:9px 11px;margin-bottom:12px;line-height:1.5;text-align:left;}
    .li-form-note code{font-size:11px!important;color:var(--li-blue);}
    .li-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;text-align:left;}
    .li-form-field{display:flex;flex-direction:column;gap:4px;min-width:0;}
    .li-form-field.full{grid-column:1 / -1;}
    .li-form-label{font-size:11px!important;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--li-muted);}
    .li-form-label span{color:var(--li-muted);font-weight:500;text-transform:none;letter-spacing:0;}
    .li-form-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;}
    .li-pts{flex-shrink:0;padding:1px 8px;border-radius:999px;background:var(--li-chip-bg);color:var(--li-chip-fg);font-size:11px!important;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;cursor:help;}
    .li-pts.blue{background:rgba(10,102,194,.1);color:var(--li-blue);}
    .li-pts{display:inline-flex;align-items:center;gap:3px;cursor:text;box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .15s ease;}
    .li-pts:hover{box-shadow:inset 0 0 0 1px currentColor;}
    .li-pts:focus-within{box-shadow:inset 0 0 0 1.5px currentColor;}
    .li-pts.changed{background:var(--li-warn-bg);color:var(--li-warn-fg);}
    .li-pts-in{width:3.1ch;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:800;text-align:right;
      font-variant-numeric:tabular-nums;-moz-appearance:textfield;appearance:textfield;text-decoration:underline dotted;text-underline-offset:3px;}
    .li-pts-in::-webkit-outer-spin-button,.li-pts-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
    .li-pts-in:focus{outline:none;text-decoration:none;}
    .li-pts-total{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px 14px;margin-top:12px;font-size:12px!important;color:var(--li-muted);}
    .li-pts-extra{display:inline-flex;align-items:center;gap:6px;margin-right:auto;font-weight:700;color:var(--li-fg-2);}
    .li-pts-extra > span:first-child{font-weight:500;color:var(--li-muted);}
    .li-pts-sum{font-variant-numeric:tabular-nums;}
    .li-pts-reset{border:0;padding:0;background:none;color:var(--li-blue);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}
    .li-pts-reset:focus-visible{outline:2px solid var(--li-blue);outline-offset:2px;border-radius:2px;}
    /* ICP keyword chip editor — looks like the form's inputs, green like the ICP panel */
    .li-kw{border:1px solid var(--li-border-2);border-radius:6px;background:var(--li-input-bg);padding:6px;cursor:text;transition:border-color .15s ease,box-shadow .15s ease;}
    .li-kw:focus-within{border-color:var(--li-green);box-shadow:0 0 0 2px rgba(5,150,105,.15);}
    .li-kw-chips{display:flex;flex-wrap:wrap;gap:5px;max-height:132px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--li-thumb) transparent;}
    .li-kw-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:2px 3px 2px 9px;border-radius:999px;background:var(--li-chip-bg);color:var(--li-kw-fg);font-size:12px!important;font-weight:600;line-height:18px;}
    .li-kw-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .li-kw-x{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;opacity:.7;}
    .li-kw-x:hover{opacity:1;background:rgba(5,150,105,.18);}
    .li-kw-x:focus-visible{outline:2px solid var(--li-green);outline-offset:1px;opacity:1;}
    .li-kw-chip.dupe{animation:li-kw-dupe .6s ease-out;}
    @keyframes li-kw-dupe{0%,100%{box-shadow:0 0 0 0 transparent;}25%{box-shadow:0 0 0 2px var(--li-warn);}}
    .li-kw-empty{font-size:12px!important;color:var(--li-muted);padding:2px 4px;}
    .li-kw-add{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--li-border);}
    .li-kw-input{flex:1;min-width:0;border:0;background:transparent;color:var(--li-fg);font:13px/1.4 inherit;font-family:inherit;padding:3px 4px;}
    .li-kw-input:focus{outline:none;}
    .li-kw-input::placeholder{color:var(--li-muted);}
    .li-kw-addbtn{display:inline-flex;align-items:center;gap:4px;flex-shrink:0;height:24px;padding:0 10px;border:1px solid var(--li-green);border-radius:999px;background:transparent;color:var(--li-kw-fg);font-size:12px!important;font-weight:600;font-family:inherit;cursor:pointer;}
    .li-kw-addbtn:hover{background:var(--li-green-fill);color:var(--li-green-fg);}
    .li-kw-addbtn:focus-visible{outline:2px solid var(--li-green);outline-offset:2px;}
    @media (prefers-reduced-motion:reduce){.li-kw-chip.dupe{animation:none;}}
    .li-kw.blue:focus-within{border-color:var(--li-blue);box-shadow:0 0 0 2px rgba(10,102,194,.15);}
    .li-kw.blue .li-kw-chip{background:rgba(10,102,194,.1);color:var(--li-blue);}
    .li-kw.blue .li-kw-x:hover{background:rgba(10,102,194,.18);}
    .li-kw.blue .li-kw-x:focus-visible,.li-kw.blue .li-kw-addbtn:focus-visible{outline-color:var(--li-blue);}
    .li-kw.blue .li-kw-addbtn{border-color:var(--li-blue);color:var(--li-blue);}
    .li-kw.blue .li-kw-addbtn:hover{background:var(--li-blue-fill);color:var(--li-blue-fg);}
    .li-sig{margin-top:6px;padding-top:12px;border-top:1px solid var(--li-border);}
    .li-sig-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 14px;}
    .li-sig-share{display:inline-flex;align-items:center;flex-shrink:0;padding:2px 9px;border-radius:999px;background:rgba(10,102,194,.12);color:var(--li-blue);font-size:11px!important;font-weight:700;line-height:1.4;font-variant-numeric:tabular-nums;}
    @media (max-width:660px){.li-sig-grid{grid-template-columns:1fr;}}
    .li-input,.li-textarea{width:100%;box-sizing:border-box;border:1px solid var(--li-border-2);border-radius:6px;padding:7px 9px;font-size:13px!important;font-family:inherit;color:var(--li-fg);background:var(--li-input-bg);text-align:left;}
    .li-textarea{min-height:72px;max-height:190px;resize:vertical;line-height:1.45;}
    .li-input:focus,.li-textarea:focus{outline:none;border-color:var(--li-blue);box-shadow:0 0 0 2px rgba(10,102,194,.15);}
    .li-input[readonly]{background:var(--li-surface-2);color:var(--li-muted);}
    .li-form-status{font-size:12px!important;color:var(--li-muted);margin-top:10px;min-height:16px;line-height:1.5;text-align:left;word-break:break-word;}
    .li-form-status a,.li-form-status code{color:var(--li-blue);}
    .li-form-actions{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:14px;flex-wrap:wrap;}
    .li-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:999px;border:1.5px solid transparent;font-size:13px!important;font-weight:600;font-family:inherit;cursor:pointer;background:var(--li-input-bg);transition:all .15s ease;white-space:nowrap;}
    .li-btn:disabled{opacity:.55;cursor:default;}
    .li-btn-ghost{border-color:var(--li-border-2);color:var(--li-muted);}
    .li-btn-ghost:hover:not(:disabled){background:var(--li-hover);color:var(--li-fg-2);}
    .li-btn-blue{border-color:var(--li-blue);color:var(--li-blue);}
    .li-btn-blue:hover:not(:disabled){background:var(--li-blue-fill);color:var(--li-blue-fg);}
    .li-btn-green{border-color:var(--li-green);color:var(--li-green);}
    .li-btn-green:hover:not(:disabled){background:var(--li-green-fill);color:var(--li-green-fg);}
    .li-chip{display:inline-flex;align-items:center;padding:5px 11px;border-radius:999px;background:var(--li-chip-bg);color:var(--li-chip-fg);font-size:12px!important;font-weight:600;}
    @media (max-width:660px){.li-form-grid{grid-template-columns:1fr;}}
    .li-compose-suggest{border:1px solid var(--li-border);border-radius:8px;background:var(--li-surface);padding:8px 10px;margin:6px 8px 4px 8px;font-family:inherit;}
    .li-cs-row{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;}
    .li-cs-label{font-size:11px!important;font-weight:700;color:var(--li-purple);text-transform:uppercase;letter-spacing:.5px;}
    .li-cs-tab{border:1.5px solid var(--li-border-2);background:var(--li-input-bg);color:var(--li-muted);border-radius:999px;font-size:12px!important;font-weight:600;padding:3px 12px;cursor:pointer;font-family:inherit;}
    .li-cs-tab.active-casual{border-color:var(--li-purple);background:var(--li-purple);color:var(--li-purple-fg);}
    .li-cs-tab.active-pro{border-color:var(--li-blue);background:var(--li-blue-fill);color:var(--li-blue-fg);}
    .li-cs-text{font-size:12.5px!important;line-height:1.5;color:var(--li-fg-2);background:var(--li-input-bg);border:1px solid var(--li-border);border-radius:6px;padding:7px 9px;margin-bottom:6px;max-height:110px;overflow-y:auto;white-space:pre-wrap;}
    .li-cs-actions{display:flex;gap:6px;justify-content:flex-end;}
    .li-cs-btn{border-radius:999px;font-size:12px!important;font-weight:600;padding:3px 12px;cursor:pointer;font-family:inherit;border:1.5px solid var(--li-purple);color:var(--li-purple);background:var(--li-input-bg);}
    .li-cs-btn:hover{background:var(--li-purple);color:#fff;}
    .li-cs-btn.ghost{border-color:var(--li-border-2);color:var(--li-muted);}
    .li-cs-btn.ghost:hover{background:var(--li-hover);color:var(--li-fg-2);}
    .li-cs-ctx{font-size:11px!important;color:var(--li-muted-2);margin-bottom:6px;line-height:1.5;}
    .li-cs-ctx b{color:var(--li-muted);}
    .li-spark-btn{background:transparent;border:none;cursor:pointer;font-size:16px!important;line-height:1;padding:4px 6px;border-radius:6px;opacity:.8;}
    .li-spark-btn:hover{opacity:1;background:var(--li-hover);}
    .li-spark-btn.open{background:var(--li-chip-bg);opacity:1;box-shadow:0 0 0 1.5px var(--li-purple) inset;}
    .li-ai-popup{border:1px solid var(--li-border);border-radius:10px;background:var(--li-bg);box-shadow:0 4px 20px var(--li-shadow);margin:6px 8px 2px 8px;overflow:hidden;}
    .li-ai-popup-header{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 12px 4px 12px;}
    .li-ai-title{font-size:11px!important;font-weight:800;letter-spacing:.6px;color:var(--li-blue);}
    .li-ai-head-actions{display:flex;gap:4px;align-items:center;}
    .li-ai-mini{border:1px solid var(--li-border-2);background:var(--li-input-bg);color:var(--li-muted);border-radius:999px;font-size:11px!important;font-weight:700;padding:2px 10px;cursor:pointer;font-family:inherit;}
    .li-ai-mini.on{border-color:var(--li-purple);background:var(--li-purple);color:var(--li-purple-fg);}
    .li-ai-close{background:none;border:none;color:var(--li-muted-2);font-size:16px!important;cursor:pointer;line-height:1;padding:0 2px;}
    .li-ai-close:hover{color:var(--li-fg);}
    .li-ai-ctx{font-size:11px!important;color:var(--li-muted-2);padding:0 12px 6px 12px;}
    .li-ai-sug{border:1px solid var(--li-border);border-radius:8px;padding:9px 12px;margin:0 10px 8px 10px;font-size:12.5px!important;line-height:1.5;color:var(--li-fg-2);cursor:pointer;background:var(--li-bg);}
    .li-ai-sug:hover{border-color:var(--li-purple);background:var(--li-surface);}
    .li-ai-mini.on.pro{border-color:var(--li-blue-fill);background:var(--li-blue-fill);color:var(--li-blue-fg);}
    .li-ai-mini:disabled{opacity:.55;cursor:default;}

    /* ── Suggested outreach (bottom of both result panels) ─────────────── */
    .li-outreach{margin-top:18px;padding-top:16px;border-top:1px solid var(--li-border);text-align:left;}
    .li-outreach-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;}
    .li-outreach-title{margin:0;font-size:14px!important;font-weight:700;color:var(--li-fg);}
    .li-outreach-tools{display:flex;gap:6px;align-items:center;}
    .li-outreach-icon{display:inline-flex;align-items:center;padding:3px 8px;}
    .li-outreach-angle{margin:0 0 10px;font-size:13px!important;line-height:1.5;color:var(--li-fg-2);}
    .li-outreach-angle strong{color:var(--li-fg);}
    .li-outreach-item{border:1px solid var(--li-border);border-radius:8px;padding:10px 12px 8px;margin-bottom:8px;background:var(--li-surface);}
    .li-outreach-label{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px;font-size:11px!important;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--li-muted);}
    .li-outreach-count{font-weight:600;text-transform:none;letter-spacing:0;font-variant-numeric:tabular-nums;}
    .li-outreach-count.over{color:var(--li-bad);}
    .li-outreach-text{margin:0 0 6px;font-size:13px!important;line-height:1.55;color:var(--li-fg);white-space:pre-wrap;word-break:break-word;}
    .li-outreach-row{display:flex;justify-content:flex-end;}
    .li-outreach-copy{height:28px;padding:0 12px;}
    .li-outreach-status{margin:0 0 10px;font-size:12.5px!important;line-height:1.5;color:var(--li-muted);}
    .li-outreach-error{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;padding:8px 10px;border:1px solid var(--li-warn-border);border-radius:8px;background:var(--li-warn-bg);color:var(--li-warn-fg);font-size:12.5px!important;line-height:1.45;}
    .li-outreach-foot{margin:4px 0 0;font-size:11px!important;line-height:1.5;color:var(--li-muted);}
    .li-outreach-skel{height:12px;margin:10px 0;border-radius:4px;background:var(--li-surface-2);animation:li-pulse 1.4s ease-in-out infinite;}
    .li-outreach-skel.short{width:62%;}
    @keyframes li-pulse{50%{opacity:.45;}}
    .li-link{border:0;padding:0;background:none;color:var(--li-blue);font:inherit;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}
    .li-outreach button:focus-visible{outline:2px solid var(--li-blue);outline-offset:2px;}
    @media (prefers-reduced-motion:reduce){.li-outreach-skel{animation:none;}}

    /* ── Keyboard focus + scrollbars (panels, forms, ✨ popup, AI note) ── */
    #li-ai-analyze-btn:focus-visible,#li-icp-btn:focus-visible,.li-btn:focus-visible,
    .li-ai-popup button:focus-visible,.li-spark-invite:focus-visible,.li-spark-btn:focus-visible{outline:2px solid var(--li-blue);outline-offset:2px;}
    .li-ai-popup .li-ai-sug:focus-visible{outline:2px solid var(--li-purple);outline-offset:1px;}
    .panel-close:focus-visible{outline:2px solid #fff;outline-offset:2px;opacity:1;}
    .li-ai-popup{scrollbar-width:thin;scrollbar-color:var(--li-thumb) transparent;}
    .li-ai-popup::-webkit-scrollbar{width:6px;}
    .li-ai-popup::-webkit-scrollbar-thumb{background:var(--li-thumb);border-radius:3px;}
    .li-ai-popup svg{display:block;}
  `;
  document.head.appendChild(style);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// The person's main profile page (also while a /overlay/… modal such as Contact
// info is open over it). Sub-pages like /recent-activity/ or /details/ have no
// top card, so no Activity / ICP buttons there.
function isProfilePage() { return /^\/in\/[^/]+\/?(overlay\/.*)?$/i.test(location.pathname); }

function currentProfileSlug() { return liLeadSlug(location.href); }

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

function escHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
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

// ─── Per-profile storage (scores, typed form values, outreach drafts) ─────────
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
const PAGE_FIELDS = ["activity", "mutual_connections"];

// Only the values you typed. Pre-filled page values (e.g. "Last active 2 days ago")
// are left out so a later visit reads them fresh instead of reusing stale ones.
function collectActivityFormValues() {
  const out = {};
  for (const f of ACTIVITY_FIELDS) {
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
  if (document.getElementById("li-ai-analyze-btn") && document.getElementById("li-icp-btn")) return;
  const anchor = findActionTarget();
  if (!anchor) return;
  injectStyles();
  applyTheme();

  if (!document.getElementById("li-ai-analyze-btn")) {
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

// ─── Backend calls ─────────────────────────────────────────────────────────────
// Routed through background.js: the extension (not the LinkedIn page) talks to
// the local server, so Chrome's page → localhost restrictions never apply.
// Apify scrapes and AI calls are slow; a sleeping Render server adds ~30-50s.
const API_TIMEOUTS = { "/analyze": 150000, "/icp-score": 120000, "/suggest-messages": 100000, "/outreach-suggestion": 90000,
  "/icp-config": 70000, "/activity-points": 70000, "/activity-keywords": 70000 };

function apiFetch(path, body) {
  const timeoutMs = API_TIMEOUTS[path] || 45000;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, arg) => { if (!done) { done = true; clearTimeout(guard); fn(arg); } };
    const reloaded = () => finish(reject, new Error("Extension was reloaded — refresh this LinkedIn tab"));
    // Safety net in case the background worker never answers
    const guard = setTimeout(() => finish(reject, new Error(`No response after ${Math.round(timeoutMs / 1000)}s — refresh the page and try again`)), timeoutMs + 8000);
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

// Merge `patch` into this person's lead record (created on first sight).
function updateLead(url, name, patch) {
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

// ─── Click Handler ─────────────────────────────────────────────────────────────

function escAttr(str) {
  return escHtml(String(str ?? "")).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function setIcpStatus(text) {
  const el = document.getElementById("li-icp-status");
  if (el) el.textContent = text;
}

function setActivityStatus(text) {
  const el = document.getElementById("li-ai-status");
  if (el) el.textContent = text;
}

function createPanel({ id, btnId, title, headerColor, bodyId, closeId }) {
  let panel = document.getElementById(id);
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = id;
  panel.innerHTML = `
    <div class="panel-header"${headerColor ? ` style="background:${headerColor};"` : ""}>
      <span>${title}</span>
      <button type="button" class="panel-close" id="${closeId}" aria-label="Close panel">×</button>
    </div>
    <div class="panel-body" id="${bodyId}"></div>
  `;
  const anchor  = document.getElementById(btnId);
  const topCard = anchor?.closest("section") || anchor?.parentElement?.parentElement;
  topCard ? topCard.insertAdjacentElement("afterend", panel) : document.querySelector("main")?.prepend(panel);
  document.getElementById(closeId).onclick = () => panel.remove();
  return panel;
}

// A new, empty panel body. Forms attach their listeners to the body, so reusing
// the old element after Refresh / Edit would fire every handler twice (one ✕
// click removing two keywords, one Enter adding a keyword twice).
function freshPanelBody(bodyId) {
  const old = document.getElementById(bodyId);
  if (!old) return null;
  const body = old.cloneNode(false);
  old.replaceWith(body);
  return body;
}

// ─── Activity Score: form with the details used by scoring_service.py ─────────
// Points: `def` = default max points, `ptsKey` = key in activity_points.json.
// The number on each field is editable; the rule (tooltip) scales with it.
const ptsOf = (p, part, of) => Math.round((p * part) / of);
const ACTIVITY_FIELDS = [
  { key: "position",           label: "Headline / Position",   type: "text", ptsKey: "signals", def: 10,
    rule: (p) => `Hiring/growth signals (also read from About and recent posts): hiring now ${ptsOf(p, 5, 10)} · recent promotion ${ptsOf(p, 3, 10)} · company growing ${ptsOf(p, 2, 10)}` },
  { key: "activity",           label: "Recent Activity",       type: "text", hint: 'e.g. "Posted 2 weeks ago"', ptsKey: "recent_activity", def: 30,
    rule: (p) => `Last activity within 7 days = ${p} · within 30 days = ${ptsOf(p, 2, 3)} · within 90 days = ${ptsOf(p, 1, 3)}` },
  { key: "posts_90_days",      label: "Posts in Last 90 Days", type: "number", hint: "blank = count from Apify", ptsKey: "posting_frequency", def: 20,
    rule: (p) => `Posting frequency (last 90 days): 10+ posts = ${p} · 5-9 = ${ptsOf(p, 3, 4)} · 1-4 = ${ptsOf(p, 1, 2)}` },
  { key: "posts_30_days",      label: "Posts in Last 30 Days", type: "number", hint: "shown in the breakdown" },
  { key: "avg_likes",          label: "Avg Likes / Post",      type: "number", hint: "blank = Apify average", ptsKey: "engagement", def: 20,
    rule: (p) => `Engagement: High = ${p} · Medium = ${ptsOf(p, 1, 2)} · Low = ${ptsOf(p, 1, 4)} — High needs 2 of: 10+ likes, 5+ comments, 3+ reposts` },
  { key: "avg_comments",       label: "Avg Comments / Post",   type: "number", hint: "blank = Apify average" },
  { key: "avg_reposts",        label: "Avg Reposts / Post",    type: "number", hint: "blank = Apify average" },
  { key: "mutual_connections", label: "Mutual Connections",    type: "number", ptsKey: "mutual_connections", def: 10,
    rule: (p) => `20+ mutual = ${p} · 10-19 = ${ptsOf(p, 7, 10)} · 5-9 = ${ptsOf(p, 5, 10)} · 1-4 = ${ptsOf(p, 2, 10)}` },
];
// Scored from the page (no form field), but its points are editable too
const ACTIVITY_COMPLETENESS = { label: "Profile Completeness", ptsKey: "completeness", def: 10,
  rule: (p) => `Read from the page: photo, headline, About, experience and company — ${+(p / 5).toFixed(1)} each` };
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
  return `<span class="li-pts${tone === "blue" ? " blue" : ""}" title="${escAttr(f.rule(f.def))}">
      <input type="number" class="li-pts-in" min="0" max="100" step="1" inputmode="numeric" value="${f.def}"
        data-pts="${f.ptsKey}" data-def="${f.def}" aria-label="Points for ${escAttr(f.label)} (default ${f.def})">pts</span>`;
}

// Label row: field name + hint on the left, its editable points on the right.
function formHeadHTML(f, forId, tone) {
  const hint = f.hint ? ` <span>${escHtml(f.hint)}</span>` : "";
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
      <textarea class="li-textarea" id="li-f-${f.key}">${escHtml(value)}</textarea>
    </div>`;
  }
  return `<div class="${cls}">
    ${formHeadHTML(f, `li-f-${f.key}`, "blue")}
    <input class="li-input" type="${f.type === "number" ? "number" : "text"}" id="li-f-${f.key}" value="${escAttr(value)}">
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
  createPanel({
    id: "li-ai-panel", btnId: "li-ai-analyze-btn", title: "⚡ Activity Score",
    bodyId: "li-ai-body", closeId: "li-ai-close",
  });

  const p     = scrapeProfile();
  const saved = await loadActivityFormValues();
  // What the page says right now — only values that differ from it are "yours" and get saved
  const scraped = Object.fromEntries(ACTIVITY_FIELDS.map((f) => [f.key, String(formValue(f.key, p[f.key]) ?? "")]));
  for (const f of ACTIVITY_FIELDS) {
    if (f.key === "position") {
      // Always prefer what the page actually shows; a saved value (even a stale
      // blank from an earlier Save) only fills in when the page scrape is empty.
      if (!p.position && saved.position) p.position = saved.position;
      continue;
    }
    if (!saved._v && PAGE_FIELDS.includes(f.key)) continue;   // stale page value from an old build
    // Posts, Avg Likes, etc. reset to blank on Refresh like the keywords do.
    if (!reset && Object.prototype.hasOwnProperty.call(saved, f.key)) p[f.key] = saved[f.key];
  }
  const body = freshPanelBody("li-ai-body");
  if (!body) return;
  body.innerHTML = `
    <form id="li-activity-form" class="li-form-grid">
      ${ACTIVITY_FIELDS.map(f => activityFieldHTML(f, formValue(f.key, p[f.key]))).join("")}
      <input type="hidden" id="li-f-profile_url" value="${escAttr(p.profileUrl)}">
      <input type="hidden" id="li-f-avatar" value="${escAttr(p.avatar)}">
      <input type="hidden" id="li-f-headline" value="${escAttr(p.headline)}">
      ${signalKeywordsHTML()}
    </form>
    ${ptsTotalHTML("li-ai-pts-total", `<span class="li-pts-extra">Profile Completeness <span>from the page</span> ${ptsPillHTML(ACTIVITY_COMPLETENESS, "blue")}</span>`)}
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
  Promise.all([apiFetch("/activity-points"), reset ? Promise.resolve(null) : apiFetch("/activity-keywords")])
    .then(([pts, lists]) => {
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

  // LinkedIn lazy-loads mutual connections — pick them up shortly after opening
  if (!p.mutual_connections) {
    setTimeout(() => {
      const el = document.getElementById("li-f-mutual_connections");
      if (el && !el.value && document.activeElement !== el) {
        const again = scrapeProfile();
        if (again.mutual_connections) el.value = again.mutual_connections;
      }
    }, 1500);
  }
}

async function saveActivitySettings() {
  setBusy(ACTIVITY_ACTIONS, true);
  setActivityStatus("Saving…");
  try {
    saveActivityFormValues(collectActivityFormValues());
    await apiFetch("/activity-points", readPoints(document.getElementById("li-ai-body")));
    const keywords = await apiFetch("/activity-keywords", collectSignalKeywords());
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
    avatar:             value("avatar") || p.avatar,
    name:               p.name,
    about:              p.about,
    current_company:    p.current_company,
    education:          p.education,
    skills:             p.skills,
    projects:           p.projects,
    experience:         p.experience,
    position:           value("position") || p.position,
    headline:           value("headline") || p.headline,
    country:            p.country,
    activity:           value("activity"),
    posts_30_days:      parseInt(value("posts_30_days"), 10)   || 0,
    posts_90_days:      parseInt(value("posts_90_days"), 10)   || 0,
    avg_likes:          parseFloat(value("avg_likes"))         || 0,
    avg_comments:       parseFloat(value("avg_comments"))      || 0,
    avg_reposts:        parseFloat(value("avg_reposts"))       || 0,
    mutual_connections: parseInt(value("mutual_connections"), 10) || 0,
  };

  setBusy(ACTIVITY_ACTIONS, true);
  btn.textContent = "⏳ Calculating…";
  setActivityStatus("Reading their profile and recent posts — this can take up to a minute…");

  try {
    saveActivityFormValues(collectActivityFormValues());
    // Save the points first: the server scores every factor with them
    await apiFetch("/activity-points", readPoints(document.getElementById("li-ai-body")));
    await apiFetch("/activity-keywords", collectSignalKeywords());
    const data = await apiFetch("/analyze", payload);
    await saveStoredScore("activity", data, scoreKey);
    updateLead(p.profileUrl, data.name || p.name, {
      headline: data.headline || p.headline || "",
      company: (data.current_company && data.current_company !== "Not specified") ? data.current_company : (p.current_company || ""),
      activityScore: data.score_total || 0,
      activityLabel: data.score_label || "",
    });
    if (currentProfileSlug() !== slug || !document.getElementById("li-ai-body")) return;   // saved; nothing to show here
    renderPanel(data, null, { fresh: true });
  } catch (err) {
    console.error("[LI-AI] ❌", err);
    setActivityStatus(`❌ ${err.message}`);
    const b = document.getElementById("li-ai-calc");
    if (b) b.textContent = "🎯 Calculate Activity Score";
    setBusy(ACTIVITY_ACTIONS, false);
  }
}

// ─── ICP Score: form with the keywords used by icp_service.py ────────────────
// Points per list (`def` = default), editable on each field and saved in
// icp_config.json → POINTS. A category's max is its best tier.
const ICP_FIELDS = [
  { key: "EXACT_INDUSTRIES",             label: "Exact Industries",             hint: "", def: 35, rule: (p) => `Industry Match: an exact industry = ${p}` },
  { key: "RELATED_INDUSTRIES",           label: "Related Industries",           hint: "", def: 25, rule: (p) => `Industry Match: a related industry = ${p}` },
  { key: "TIER_1_TITLES",                label: "Tier 1 Titles",                hint: "Top decision makers", def: 25, rule: (p) => `Job Title Match: Tier 1 title = ${p}` },
  { key: "TIER_2_TITLES",                label: "Tier 2 Titles",                hint: "", def: 20, rule: (p) => `Job Title Match: Tier 2 title = ${p}` },
  { key: "TIER_3_TITLES",                label: "Tier 3 Titles",                hint: "", def: 15, rule: (p) => `Job Title Match: Tier 3 title = ${p}` },
  { key: "EXACT_COMPANY_SIZE_KEYWORDS",  label: "Exact Company Size Keywords",  hint: "", def: 15, rule: (p) => `Company Size Match: exact size = ${p}` },
  { key: "NEARBY_COMPANY_SIZE_KEYWORDS", label: "Nearby Company Size Keywords", hint: "", def: 8,  rule: (p) => `Company Size Match: nearby size = ${p}` },
  { key: "PRIMARY_GEOGRAPHIES",          label: "Primary Geographies",          hint: "", def: 10, rule: (p) => `Geography Match: primary country = ${p}` },
  { key: "SECONDARY_GEOGRAPHIES",        label: "Secondary Geographies",        hint: "", def: 5,  rule: (p) => `Geography Match: secondary country = ${p}` },
  { key: "ALL_ICP_KEYWORDS",             label: "All ICP Keywords",             hint: "About + company + headline", full: true, def: 15,
    rule: (p) => `Profile Keywords: 5+ matches = ${p} · 3+ = ${ptsOf(p, 2, 3)} · 1+ = ${ptsOf(p, 1, 3)}` },
].map((f) => ({ ...f, ptsKey: f.key }));
// Same maths as icp_service.calculate_icp: each category counts its best tier
const ICP_GROUPS = [["EXACT_INDUSTRIES", "RELATED_INDUSTRIES"], ["TIER_1_TITLES", "TIER_2_TITLES", "TIER_3_TITLES"],
  ["EXACT_COMPANY_SIZE_KEYWORDS", "NEARBY_COMPANY_SIZE_KEYWORDS"], ["PRIMARY_GEOGRAPHIES", "SECONDARY_GEOGRAPHIES"], ["ALL_ICP_KEYWORDS"]];
const ICP_TOTAL = (pts) => ICP_GROUPS.reduce((sum, g) => sum + Math.max(...g.map((k) => pts[k] || 0)), 0);

// Each keyword list is a chip editor: × removes a keyword, Enter / comma / Add
// adds one (paste a list to add many). The hidden textarea keeps one keyword per
// line, so loading and saving (collectIcpKeywords) read it exactly as before.
const ICON_X_SMALL = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const ICON_PLUS_SMALL = '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

// Shared chip editor. `prefix` names the editor family ("li-icp", "li-sig"):
// the hidden textarea #<prefix>-<key> holds one keyword per line.
const KW_ON_EDIT = {};   // prefix → called after every add / remove

function kwEditorHTML(prefix, key, label, tone, placeholder) {
  return `<div class="li-kw${tone === "blue" ? " blue" : ""}" data-prefix="${prefix}" data-key="${key}">
      <div class="li-kw-chips" role="list" aria-label="${escAttr(label)}"></div>
      <div class="li-kw-add">
        <input class="li-kw-input" id="${prefix}-${key}-new" type="text" autocomplete="off" spellcheck="false"
          placeholder="${escAttr(placeholder || "Type a keyword, press Enter")}">
        <button type="button" class="li-kw-addbtn" aria-label="Add keyword to ${escAttr(label)}">${ICON_PLUS_SMALL}Add</button>
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
    ? list.map((kw, i) => `<span class="li-kw-chip" role="listitem" title="${escAttr(kw)}">
        <span class="li-kw-text">${escHtml(kw)}</span>
        <button type="button" class="li-kw-x" data-i="${i}" aria-label="Remove ${escAttr(kw)}">${ICON_X_SMALL}</button></span>`).join("")
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

// ICP keyword lists use the shared editor
function icpFieldHTML(f) {
  const cls  = f.full ? "li-form-field full" : "li-form-field";
  return `<div class="${cls}">
    ${formHeadHTML(f, `li-icp-${f.key}-new`, "green")}
    ${kwEditorHTML("li-icp", f.key, f.label, "green")}
  </div>`;
}
const renderIcpChips = (key) => renderChips("li-icp", key);
function wireIcpChipEditors(form) {
  wireChipEditors(form, "li-icp", () => setIcpStatus("Unsaved changes — press Save or Calculate ICP Score."));
}

const ICP_ACTIONS = ["li-icp-refresh", "li-icp-save", "li-icp-calc"];

async function openIcpForm(reset) {
  reset = reset === true;   // a click event must never count as "reset"
  createPanel({
    id: "li-icp-panel", btnId: "li-icp-btn", title: "🎯 ICP Score",
    headerColor: "#059669", bodyId: "li-icp-body", closeId: "li-icp-close",
  });

  const body = freshPanelBody("li-icp-body");
  if (!body) return;
  body.innerHTML = `
    <div class="li-form-note">Keywords match whole words. Plurals and space/hyphen variants count too, so "health care" also finds "healthcare".</div>
    <form id="li-icp-form" class="li-form-grid">
      ${ICP_FIELDS.map(icpFieldHTML).join("")}
    </form>
    ${ptsTotalHTML("li-icp-pts-total")}
    <div class="li-form-status" id="li-icp-status" role="status">${reset ? "Loading saved points…" : "Loading saved keywords…"}</div>
    <div class="li-form-actions">
      <button type="button" class="li-btn li-btn-ghost" id="li-icp-refresh">🔄 Refresh</button>
      <button type="button" class="li-btn li-btn-ghost" id="li-icp-save">💾 Save</button>
      <button type="button" class="li-btn li-btn-green" id="li-icp-calc">🎯 Calculate ICP Score</button>
    </div>
  `;

  const icpForm = document.getElementById("li-icp-form");
  icpForm.addEventListener("submit", e => e.preventDefault());
  wireIcpChipEditors(icpForm);
  ICP_FIELDS.forEach((f) => renderIcpChips(f.key));
  const refreshIcpPts = wirePoints(body, ICP_FIELDS, document.getElementById("li-icp-pts-total"), ICP_TOTAL,
    () => setIcpStatus("Unsaved changes — press Save or Calculate ICP Score."));
  document.getElementById("li-icp-refresh").onclick = () => openIcpForm(true);
  document.getElementById("li-icp-save").onclick = () => saveIcpClick();
  document.getElementById("li-icp-calc").onclick = () => calculateIcpScore();

  // Save / Calculate post every keyword list, so they stay off until the saved
  // lists have loaded — otherwise one click would overwrite them with blanks.
  setBusy(["li-icp-save", "li-icp-calc"], true);
  try {
    const config = await apiFetch("/icp-config");
    if (!body.isConnected) return;   // replaced by a newer form
    if (!reset) {
      for (const f of ICP_FIELDS) {
        const el = document.getElementById(`li-icp-${f.key}`);
        if (el) el.value = (config[f.key] || []).join("\n");
        renderIcpChips(f.key);
      }
    }
    setPoints(body, config.POINTS);
    refreshIcpPts();
    setIcpStatus(reset
      ? "Keywords cleared — Save or Calculate will store them blank. Close and reopen the panel to reload your saved ones."
      : `Loaded ${countKeywords(config)} saved keywords.`);
    setBusy(["li-icp-save", "li-icp-calc"], false);
  } catch (err) {
    if (!body.isConnected) return;
    statusWithRetry("li-icp-status", `⚠️ Could not load your saved keywords (${err.message}). Save and Calculate stay off so they aren't overwritten.`,
      () => openIcpForm(reset));
  }
}

async function saveIcpClick() {
  setBusy(ICP_ACTIONS, true);
  setIcpStatus("Saving…");
  try {
    const saved = await saveIcpKeywords();
    setIcpStatus(`✅ Saved ${countKeywords(saved)} keywords and your points.`);
  } catch (err) {
    setIcpStatus(`❌ Not saved: ${err.message}`);
  } finally {
    setBusy(ICP_ACTIONS, false);
  }
}

function collectIcpKeywords() {
  const config = {};
  for (const f of ICP_FIELDS) {
    const el = document.getElementById(`li-icp-${f.key}`);
    config[f.key] = (el ? el.value : "").split("\n").map(s => s.trim()).filter(Boolean);
  }
  const form = document.getElementById("li-icp-form");
  if (form) config.POINTS = readPoints(form);
  return config;
}

function countKeywords(config) {
  return Object.values(config || {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

async function saveIcpKeywords() {
  return apiFetch("/icp-config", collectIcpKeywords());
}

async function calculateIcpScore() {
  const btn = document.getElementById("li-icp-calc");
  if (!btn) return;
  const scoreKey = scoreStoreKey();     // this person, even if the user navigates away
  const slug     = currentProfileSlug();
  const p        = scrapeProfile();     // before any wait: the page may change while we save
  setBusy(ICP_ACTIONS, true);
  btn.textContent = "⏳ Calculating…";

  try {
    const saved = await saveIcpKeywords();
    if (currentProfileSlug() !== slug) return;   // moved to someone else: don't score them as this person
    setIcpStatus(`✅ Saved ${countKeywords(saved)} keywords — scoring (the company lookup can take up to a minute)…`);

    const company = p.current_company && p.current_company !== "Not specified" ? p.current_company : "";
    const result = await apiFetch("/icp-score", {
      name:                 p.name,
      country:              p.country,
      position:             p.position,
      headline:             p.headline,
      about:                p.about && p.about !== "Not specified" ? p.about : "",
      current_company_name: company,
      current_company:      company,
      profile_url:          p.profileUrl,
      profileUrl:           p.profileUrl,
    });
    const kCount = countKeywords(saved);
    await saveStoredScore("icp", { result, keywordCount: kCount }, scoreKey);
    updateLead(p.profileUrl, p.name, {
      headline: p.headline || "",
      company,
      icpScore: result.icp_score || 0,
    });
    if (currentProfileSlug() !== slug || !document.getElementById("li-icp-body")) return;   // saved; nothing to show here
    renderIcpResult(result, kCount, null, { fresh: true });
  } catch (err) {
    setIcpStatus(`❌ ${err.message}`);
    const b = document.getElementById("li-icp-calc");
    if (b) b.textContent = "🎯 Calculate ICP Score";
    setBusy(ICP_ACTIONS, false);
  }
}

// Breakdown bars shared by both result panels. `rawDetail` is trusted HTML.
function scoreRowsHTML(rows, fullColor) {
  return rows.map((row) => {
    const pct   = row.max ? Math.max(0, Math.min(100, Math.round((row.score / row.max) * 100))) : 0;
    const color = row.max && row.score >= row.max ? fullColor : row.score > 0 ? "var(--li-blue)" : "var(--li-track)";
    const textColor = row.score > 0 ? color : "var(--li-muted)";   // track grey is invisible as text
    const detail = row.rawDetail || (row.detail ? escHtml(row.detail) : "");
    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:500;color:var(--li-fg-2);">${escHtml(row.label)}</span>
          <span style="font-size:13px;font-weight:700;color:${textColor};font-variant-numeric:tabular-nums;">${row.score}/${row.max}</span>
        </div>
        <div style="height:6px;background:var(--li-track);border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
        </div>
        ${detail ? `<div style="font-size:11px;color:var(--li-muted);margin-top:3px;line-height:1.45;">${detail}</div>` : ""}
      </div>`;
  }).join("");
}

function renderIcpResult(result, keywordCount, storedAt, opts) {
  applyTheme();
  const body = freshPanelBody("li-icp-body");
  if (!body) return;
  // Fixed order: chrome.storage hands stored objects back with their keys sorted
  const ORDER = ["Industry Match", "Job Title Match", "Company Size Match", "Geography Match", "Profile Keywords"];
  const rank = (k) => (ORDER.indexOf(k) + 1) || 99;
  const rows = Object.entries(result.breakdown || {}).sort(([a], [b]) => rank(a) - rank(b)).map(([label, d]) => ({
    label, score: (d && d.score) || 0, max: (d && d.max) || 0, detail: (d && d.reason) || "",
  }));
  const missing = Array.isArray(result.missing) ? result.missing
    : rows.filter((r) => r.detail === "No data").map((r) => r.label);

  const score = result.icp_score || 0;
  const color = score >= 70 ? "var(--li-green)" : score >= 40 ? "var(--li-warn)" : "var(--li-bad)";

  body.innerHTML = `
    ${storedAt ? `<div class="li-form-note">💾 Stored score from <strong>${escHtml(fmtSavedAt(storedAt))}</strong> — press <strong>Edit Keywords</strong> to calculate a fresh one.</div>` : ""}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="font-size:36px;font-weight:800;color:${color};font-variant-numeric:tabular-nums;letter-spacing:-.02em;">${score}</div>
        <div>
          <div style="font-size:11px;color:var(--li-muted);">out of 100</div>
          <div style="font-size:16px;color:var(--li-fg);font-weight:700;margin-top:2px;">${score >= 70 ? "🟢 Strong ICP Fit" : score >= 40 ? "🟡 Partial Fit" : "🔴 Weak Fit"}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="li-chip">${keywordCount} keywords</span>
        <button type="button" class="li-btn li-btn-green" id="li-icp-edit">✏️ Edit Keywords</button>
      </div>
    </div>
    ${missing.length ? `<div class="li-form-note">No data on this profile for <strong>${escHtml(missing.join(", "))}</strong>. Those count as 0, so the real fit may be higher.</div>` : ""}
    <div style="border-top:1px solid var(--li-border);padding-top:14px;">
      ${scoreRowsHTML(rows, "var(--li-green)")}
    </div>
    ${outreachBlockHTML("icp")}
  `;
  document.getElementById("li-icp-edit").onclick = () => openIcpForm();
  mountOutreach(body.querySelector(".li-outreach"), { fresh: !!(opts && opts.fresh) });
}

async function handleAnalyzeClick() {
  const existing = document.getElementById("li-ai-panel");
  if (existing) { existing.remove(); return; }
  const stored = (await loadStoredScores()).activity;
  if (stored && stored.data) {
    // Show the stored score right away — no new request, no recalculation
    createPanel({
      id: "li-ai-panel", btnId: "li-ai-analyze-btn", title: "⚡ Activity Score",
      bodyId: "li-ai-body", closeId: "li-ai-close",
    });
    renderPanel(stored.data, stored.savedAt);
  } else {
    openActivityForm();
  }
}

async function handleIcpClick() {
  const existing = document.getElementById("li-icp-panel");
  if (existing) { existing.remove(); return; }
  const stored = (await loadStoredScores()).icp;
  if (stored && stored.data && stored.data.result) {
    createPanel({
      id: "li-icp-panel", btnId: "li-icp-btn", title: "🎯 ICP Score",
      headerColor: "#059669", bodyId: "li-icp-body", closeId: "li-icp-close",
    });
    renderIcpResult(stored.data.result, stored.data.keywordCount || 0, stored.savedAt);
  } else {
    openIcpForm();
  }
}

// ─── Render Panel ──────────────────────────────────────────────────────────────
// Shows the server's numbers as-is: the panel, the lead log and the AI all use
// the same score.
const SIGNAL_NAMES = { hiring: "Hiring", job: "Promotion", growth: "Growth" };
const COMPLETENESS_NAMES = { photo: "photo", headline: "headline", about: "About", experience: "experience", company: "company" };

// Same wording as the server's time_ago(); recomputed at render time so a stored
// score never keeps saying "Last posted yesterday" a week after it was saved.
function liTimeAgoText(d) {
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - d.getTime()) / 3600000);
    return hours > 0 ? `${hours}h ago` : "today";
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7);  return `${w} week${w > 1 ? "s" : ""} ago`; }
  if (days < 365) { const m = Math.floor(days / 30); return `${m} month${m > 1 ? "s" : ""} ago`; }
  const y = Math.floor(days / 365); return `${y} year${y > 1 ? "s" : ""} ago`;
}

// The Recent Activity line for an /analyze result. With the post's real date
// (activity_date) the relative phrase is rebuilt NOW and the exact local date
// and time is shown; older stored scores without it keep the server's text.
function liActivityText(data) {
  const raw = (data && data.activity) || "No activity data";
  const d = data && data.activity_date ? new Date(data.activity_date) : null;
  if (!d || isNaN(d.getTime())) return raw;
  const abs = d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const snippet = (raw.match(/\s—\s(".*")\s*$/) || [])[0] || "";
  const verb = /^reposted/i.test(raw) ? "Reposted someone else's post" : "Last posted";
  return `${verb} ${liTimeAgoText(d)} (${abs})${snippet}`;
}

function renderPanel(data, storedAt, opts) {
  applyTheme();
  const body = freshPanelBody("li-ai-body");
  if (!body) return;
  const name            = data.name            || "Unknown";
  const country         = data.country         || "Not specified";
  const current_company = data.current_company || "Not specified";
  const activity        = liActivityText(data);
  const activity_url    = /^https?:\/\//i.test(data.activity_url || "") ? data.activity_url : "";

  const score_total = data.score_total || 0;
  const score_label = data.score_label ||
    (score_total >= 70 ? "🟢 Ready to Engage" : score_total >= 40 ? "🟡 Needs Nurturing" : "🔴 Difficult to Engage");

  // Server-side maxima (editable points); older stored scores use the defaults
  const max = {
    activity: data.max_activity ?? 30, posts: data.max_posts ?? 20, engagement: data.max_engagement ?? 20,
    completeness: data.max_completeness ?? 10, signals: data.max_signals ?? 10, mutuals: data.max_mutuals ?? 10,
  };

  let scoreColor = "var(--li-bad)";
  if (score_total >= 70) scoreColor = "var(--li-ok)";
  else if (score_total >= 40) scoreColor = "var(--li-warn)";

  let activityHTML = escHtml(activity);
  if (activity_url) {
    activityHTML = `<a href="${escAttr(activity_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--li-blue);text-decoration:none;font-weight:600;">${escHtml(activity)} 🔗</a>`;
  } else if (/\b(ago|today|yesterday)\b/i.test(activity)) {
    activityHTML = `<strong style="color:var(--li-ok);">⏱️ ${escHtml(activity)}</strong>`;
  } else if (/recent/i.test(activity)) {
    activityHTML = `<strong style="color:var(--li-warn);">⏱️ ${escHtml(activity)}</strong>`;
  }

  const engagement = data.engagement_label || "No data";
  const engDetail = /^no data/i.test(engagement) ? engagement
    : `${engagement} · avg ${data.avg_likes || 0} likes, ${data.avg_comments || 0} comments, ${data.avg_reposts || 0} reposts per post`;
  const missing = (data.completeness_missing || []).map((k) => COMPLETENESS_NAMES[k] || k);
  const hits = Object.entries(data.signal_hits || {}).filter(([, kw]) => kw);
  const signalDetail = hits.length
    ? hits.map(([list, kw]) => `${SIGNAL_NAMES[list] || list}: "${kw}"`).join(" · ")
    : ("signal_hits" in data ? "No hiring or growth words found" : "");

  const scoreRows = [
    { label: "Recent Activity",       score: data.score_activity || 0,     max: max.activity,     rawDetail: activityHTML },
    { label: "Posting Frequency",     score: data.score_posts || 0,        max: max.posts,        detail: `${data.posts_90_days || 0} posts in 90 days · ${data.posts_30_days || 0} in the last 30` },
    { label: "Engagement Level",      score: data.score_engagement || 0,   max: max.engagement,   detail: engDetail },
    { label: "Profile Completeness",  score: data.score_completeness || 0, max: max.completeness, detail: missing.length ? "Missing: " + missing.join(", ") : "" },
    { label: "Hiring/Growth Signals", score: data.score_signals || 0,      max: max.signals,      detail: signalDetail },
    { label: "Mutual Connections",    score: data.score_mutuals || 0,      max: max.mutuals,      detail: `${data.mutual_connections || 0} mutual` },
  ];
  const n = data.posts_analyzed || 0;
  const basis = n ? `Based on ${n} recent post${n === 1 ? "" : "s"} plus the profile.`
    : data.data_source === "form" ? "No post data — scored from the page and the values you typed." : "";

  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div>
        <div style="font-size:17px;font-weight:700;color:var(--li-fg);">${escHtml(name)}</div>
        <div style="font-size:12px;color:var(--li-muted);">${escHtml([current_company, country].filter(v => v && v !== "Not specified").join(" • "))}</div>
      </div>
      <button type="button" class="li-btn li-btn-ghost" id="li-ai-edit">✏️ Edit Details</button>
    </div>
    ${data.scrape_warning ? `<div class="li-form-note" style="border-color:var(--li-warn-border);background:var(--li-warn-bg);color:var(--li-warn-fg);">⚠️ ${escHtml(data.scrape_warning)}</div>` : ""}
    ${storedAt ? `<div class="li-form-note">💾 Stored score from <strong>${escHtml(fmtSavedAt(storedAt))}</strong> — press <strong>Edit Details</strong> to calculate a fresh one.</div>` : ""}
    <div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:${basis ? 6 : 16}px;">
        <div style="font-size:40px;font-weight:800;color:${scoreColor};line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;">${score_total}</div>
        <div>
          <div style="font-size:11px;color:var(--li-muted);">out of 100</div>
          <div style="font-size:16px;color:var(--li-fg);font-weight:700;margin-top:2px;">${escHtml(score_label)}</div>
        </div>
      </div>
      ${basis ? `<div style="font-size:12px;color:var(--li-muted);margin-bottom:14px;">${escHtml(basis)}</div>` : ""}
      <div style="border-top:1px solid var(--li-border);padding-top:14px;">
        ${scoreRowsHTML(scoreRows, "var(--li-ok)")}
      </div>
    </div>
    ${outreachBlockHTML("activity")}
  `;
  document.getElementById("li-ai-edit").onclick = () => openActivityForm();
  mountOutreach(body.querySelector(".li-outreach"), { fresh: !!(opts && opts.fresh) });
}

// ─── Suggested outreach: a connection note + first message from the analysis ─
const ICON_COPY = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>';
const NOTE_LIMIT = 300;              // LinkedIn's connection-note limit
const _outreachPending = {};         // "<profile>|<tone>" → in-flight request

function outreachBlockHTML(kind) {
  return `<section class="li-outreach" data-for="${kind}" aria-label="Suggested outreach">
    <div class="li-outreach-head">
      <h3 class="li-outreach-title">Suggested outreach</h3>
      <div class="li-outreach-tools">
        <button type="button" class="li-ai-mini" data-tone="casual" aria-pressed="false">Casual</button>
        <button type="button" class="li-ai-mini" data-tone="pro" aria-pressed="false">Pro</button>
        <button type="button" class="li-ai-mini li-outreach-icon" data-act="regen" title="Write a new suggestion" aria-label="Write a new suggestion">${ICON_REFRESH}</button>
      </div>
    </div>
    <div class="li-outreach-body" aria-live="polite"></div>
  </section>`;
}

function outreachItemHTML(field, label, text, limit) {
  const count = limit ? `<span class="li-outreach-count${text.length > limit ? " over" : ""}">${text.length}/${limit}</span>` : "";
  return `<div class="li-outreach-item">
      <div class="li-outreach-label"><span>${label}</span>${count}</div>
      <p class="li-outreach-text" data-field="${field}">${escHtml(text)}</p>
      <div class="li-outreach-row"><button type="button" class="li-btn li-btn-ghost li-outreach-copy" data-copy="${field}">${ICON_COPY}<span>Copy</span></button></div>
    </div>`;
}

function outreachBodyHTML(s) {
  if (s.loading) {
    return `<p class="li-outreach-status">Writing a ${s.tone === "pro" ? "professional" : "casual"} note from this analysis…</p>
      <div class="li-outreach-skel"></div><div class="li-outreach-skel short"></div>`;
  }
  if (s.empty) {
    return `<p class="li-outreach-status">Get a connection note and a first message written from this person's scores and profile.</p>
      <div class="li-outreach-row"><button type="button" class="li-btn li-btn-blue" data-act="generate">Write suggestion</button></div>`;
  }
  let html = "";
  if (s.error) {
    html += `<div class="li-outreach-error" role="alert">Couldn't write a new suggestion: ${escHtml(s.error)}
      <button type="button" class="li-ai-mini" data-act="retry">Retry</button></div>`;
  }
  const e = s.entry;
  if (!e) return html;
  if (s.stale) html += `<p class="li-outreach-status">Written before the latest score. <button type="button" class="li-link" data-act="regen">Rewrite it</button> to use the new analysis.</p>`;
  if (e.angle) html += `<p class="li-outreach-angle"><strong>Why reach out:</strong> ${escHtml(e.angle)}</p>`;
  if (e.note) html += outreachItemHTML("note", "Connection note", e.note, NOTE_LIMIT);
  if (e.message) html += outreachItemHTML("message", "First message after they accept", e.message);
  const from = [e.icp != null ? `ICP ${e.icp}` : "", e.activity != null ? `Activity ${e.activity}` : ""].filter(Boolean).join(" + ");
  const who = e.source === "template" ? "Template (AI unavailable" + (e.notice ? ": " + escHtml(e.notice) : "") + ")" : "Written by AI";
  html += `<p class="li-outreach-foot">${who} from ${from ? escHtml(from) : "the profile"}${e.role ? " · as " + escHtml(e.role) : ""} · ${escHtml(fmtSavedAt(e.at))}. Review before sending.</p>`;
  return html;
}

// Everything the extension knows about this person: page + stored scores.
async function outreachContext(tone) {
  const p = scrapeProfile();
  const stored = await loadStoredScores();
  const prefs = await loadAiPrefs();
  const leadsR = await storageGet([LI_LEADS_KEY]);
  const allLeads = leadsR[LI_LEADS_KEY] || {};
  const act = (stored.activity && stored.activity.data) || null;
  const icp = (stored.icp && stored.icp.data && stored.icp.data.result) || null;
  const NA = /^(not specified|unknown|no activity data|no recent activity|no projects)$/i;
  const val = (v) => (v && !NA.test(String(v).trim()) ? String(v).trim() : "");
  const name = val(act && act.name) || val(p.name);
  const req = {
    name,
    first_name: name.split(/\s+/)[0] || "",
    headline: val(p.headline) || val(act && act.headline),
    position: val(p.position) || val(act && act.position),
    current_company: val(p.current_company) || val(act && act.current_company),
    country: val(p.country) || val(act && act.country),
    about: (val(act && act.about) || val(p.about)).slice(0, 1500),
    activity: val(act ? liActivityText(act) : "") || val(p.activity),
    profile_url: profileKeyUrl(),
    icp_score: icp ? Math.round(icp.icp_score || 0) : null,
    icp_breakdown: icp ? icp.breakdown || {} : {},
    activity_score: act ? Math.round(act.score_total || 0) : null,
    activity_label: (act && act.score_label) || "",
    engagement_label: (act && act.engagement_label) || "",
    signal_hits: (act && act.signal_hits) || {},
    tone,
    sender_role: prefs.senderRole || "",
  };
  const lead = allLeads[liFindLeadKey(allLeads, req.profile_url, name)] || {};
  if (val(lead.painPoint)) req.pain_point = val(lead.painPoint).slice(0, 200);
  const prior = [];
  if (val(lead.lastSentText)) prior.push('I last wrote: "' + val(lead.lastSentText).slice(0, 140).replace(/"/g, "'") + '"');
  if (val(lead.lastTheirText)) prior.push('They replied: "' + val(lead.lastTheirText).slice(0, 140).replace(/"/g, "'") + '"');
  if (prior.length) req.prior_contact = prior.join(" · ");
  // Which scores the text was written from — a newer score makes it stale
  const basis = [icp ? stored.icp.savedAt : 0, act ? stored.activity.savedAt : 0].join(":");
  return { req, basis };
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

// Read-merge-write by the key captured for this person: another open panel may
// have written meanwhile, and the page may already show someone else.
async function updateOutreachStore(key, patch) {
  const r = await storageGet([key]);
  const next = Object.assign({}, r[key] || {}, patch);
  storageSet({ [key]: next });
  return next;
}

// opts.fresh = a score was just calculated → write a new suggestion right away.
async function mountOutreach(section, opts) {
  if (!section) return;
  const key = storeKey("liOutreach:");
  let store = await loadProfileStore("liOutreach:");
  let tone = store.tone === "pro" || store.tone === "casual" ? store.tone : lastAiTone;
  const bodyEl = section.querySelector(".li-outreach-body");
  const show = (state) => { if (section.isConnected) bodyEl.innerHTML = outreachBodyHTML(state); };
  const paintTools = (busy) => section.querySelectorAll(".li-outreach-tools button").forEach((b) => {
    b.disabled = !!busy;
    if (!b.dataset.tone) return;
    const on = b.dataset.tone === tone;
    b.classList.toggle("on", on);
    b.classList.toggle("pro", on && tone === "pro");
    b.setAttribute("aria-pressed", String(on));
  });

  const generate = async (force) => {
    const { req, basis } = await outreachContext(tone);
    const cached = store[tone];
    if (!force && cached && cached.basis === basis) { show({ entry: cached }); return; }
    show({ loading: true, tone });
    paintTools(true);
    const pendKey = key + "|" + tone;
    try {
      if (!_outreachPending[pendKey]) {
        _outreachPending[pendKey] = apiFetch("/outreach-suggestion", req).finally(() => { delete _outreachPending[pendKey]; });
      }
      const data = await _outreachPending[pendKey];
      const entry = {
        angle: data.angle || "", note: data.connection_note || "", message: data.message || "",
        source: data.source || "ai", notice: data.notice || "", basis, role: req.sender_role || "", at: Date.now(),
        icp: req.icp_score, activity: req.activity_score,
      };
      if (!entry.note && !entry.message) throw new Error("the server returned an empty suggestion");
      store = await updateOutreachStore(key, { tone, [tone]: entry });
      show({ entry });
    } catch (err) {
      show({ error: err.message, entry: cached });
    } finally {
      paintTools(false);
    }
  };

  section.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b || !section.contains(b) || b.disabled) return;
    if (b.dataset.tone) {
      if (b.dataset.tone === tone) return;
      tone = rememberAiTone(b.dataset.tone);
      paintTools(false);
      store = await updateOutreachStore(key, { tone });
      generate(false);
    } else if (b.dataset.act) {
      generate(true);
    } else if (b.dataset.copy) {
      const text = section.querySelector(`.li-outreach-text[data-field="${b.dataset.copy}"]`)?.textContent || "";
      const ok = await copyText(text);
      const label = b.querySelector("span");
      if (label) {
        label.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(() => { if (label.isConnected) label.textContent = "Copy"; }, 1600);
      }
    }
  });

  paintTools(false);
  if (opts && opts.fresh) return generate(true);
  const cached = store[tone];
  if (!cached) return show({ empty: true });
  const { basis } = await outreachContext(tone);
  show({ entry: cached, stale: cached.basis !== basis });
}

// ─── Message-box suggestions: Casual vs Professional ────────────────────────
// Injects a small helper into LinkedIn's "New message" compose popup.
function collectRoots() {
  const roots = [document];
  const walk = (root) => {
    let els;
    try { els = root.querySelectorAll("*"); } catch (e) { return; }
    els.forEach((el) => { if (el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); } });
  };
  walk(document);
  return roots;
}

// Every "Write a message" composer, across light DOM AND open shadow roots
// (LinkedIn renders the messaging overlay inside a Shadow DOM).
function composeEditors() {
  const out = [];
  const seen = new Set();
  const push = (el) => { if (el && !seen.has(el)) { seen.add(el); out.push(el); } };
  for (const root of collectRoots()) {
    let eds;
    try { eds = root.querySelectorAll('[contenteditable="true"], [contenteditable=""], [role="textbox"], textarea'); }
    catch (e) { continue; }
    eds.forEach((ed) => {
      const label = (ed.getAttribute("aria-label") || "") + " " + (ed.getAttribute("placeholder") || "");
      if (/message/i.test(label)) { push(ed); return; }
      try {
        if (ed.closest && ed.closest('.msg-form, [class*="msg-form"], aside, [class*="msg-overlay"], [class*="messaging"]')) push(ed);
      } catch (e) { /* ignore */ }
    });
  }
  try {
    document.querySelectorAll('div.msg-form__contenteditable[contenteditable="true"]').forEach(push);
    document.querySelectorAll('[aria-label*="Write a message"][contenteditable="true"]').forEach(push);
  } catch (e) { /* ignore */ }
  return out;
}

// Widest ancestor holding exactly ONE message list = this conversation's box.
function convoContainer(editable) {
  let el = editable, best = null;
  for (let i = 0; el && i < 15; i++, el = el.parentElement) {
    if (!el.querySelectorAll) continue;
    let n = 0;
    try { n = el.querySelectorAll(".msg-s-message-list").length; } catch (e) { continue; }
    if (n === 1) best = el;
    else if (n > 1) break;
  }
  return best || (editable.getRootNode ? editable.getRootNode() : document);
}

// True for LinkedIn UI chrome mistaken for chat text (attach/photo/GIF/send
// buttons, tooltips, timestamps, headers) — never a real message.
function isChatJunk(txt) {
  const s = String(txt || "").replace(/\s+/g, " ").trim();
  if (!s || s.length < 2 || s.length > 2000) return true;
  if (/^\d{1,2}:\d{2}(\s?[AP]M)?$/.test(s)) return true;
  if (/^\d{1,2} \w+ at \d{1,2}:\d{2}.*$/i.test(s)) return true;
  return /^(write a message[.…]*|type a message[.…]*|message([.…]+)?|start a (new )?message|(free )?message|subject( \(optional\))?|new message|messaging|inbox|free message|why\?|seen|delivered|sent|typing[.…]{0,3}|today|yesterday|attach( a)? files?|add( a)? photos?|photos?|gif(s)?|emojis?|stickers?|insert (gif|emoji)|upload( (a|your) files?)?|browse files?|drop files? here|choose files?|send|like|comment|repost|share|reply|react|follow|connect|more|show (more|less|all)|see more|view (more|profile)|open to work|#opentowork|audio call|video call|call|images?|files?|documents?|videos?|(attach|add|insert|upload|choose|send|share|take|record|open) (an? |your )?(image|images|photo|photos|file|files|document|documents|video|videos|voice( message| note)?|audio|media( picker| browser)?)|open emoji keyboard|emoji keyboard|gif keyboard|select your files?|(or )?drag (&|and) drop( here| (your )?files?| to upload| next time)?|drop (your )?files?( here| to upload)?|choose (a )?files?|browse( to upload)?|upload (a )?files?( here)?)$/i.test(s);
}

// Two or more toolbar/button labels mashed in one string (e.g. the whole footer
// read as "Attach an image Attach a file Open Emoji Keyboard") = UI, not chat.
function hasToolbarConcat(txt) {
  const s = " " + String(txt || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const phrases = ["attach an image", "attach a file", "attach file", "add a photo", "open emoji keyboard",
    "emoji keyboard", "gif keyboard", "insert gif", "browse files", "drop files here", "type a message",
    "write a message", "subject (optional)", "free message", "start a video", "start an audio",
    "select your file", "drag & drop", "drag and drop", "choose a file", "drop files"];
  const singles = ["gif", "emoji", "emojis", "send", "attach", "upload", "sticker", "stickers"];
  let ph = 0, sg = 0;
  for (const l of phrases) { if (s.includes(l)) ph++; }
  for (const w of singles) { if (s.includes(" " + w + " ")) sg++; }
  return ph >= 2 || (ph >= 1 && sg >= 2) || sg >= 4;
}

// Inbox-LIST markup (conversation cards, snippets, timestamps) is NEVER chat
// history — the open thread is the only valid source.
const LIST_CHROME_RE = /conversation-listitem|conversation-card|message-snippet|list-bubble__|convo-card|convo-item|inbox-shortcuts|participant-names|selectable-entity/i;

// A post / article / link shared INTO a message renders as a card with its own
// author lockup. That author is not the chat partner: never read a name from it,
// and pass the card to the AI as "[shared a post by X: …]" instead of plain text.
const SHARED_CARD_SEL = '[class*="shared-update"], [class*="shared-content"], [class*="feed-shared"], [class*="update-components"], [class*="feed-mini-update"], [class*="attachment"], [class*="unfurl"], [class*="link-preview"], article';
const CARD_AUTHOR_SEL = '[class*="actor__name"], [class*="actor__title"], [class*="entity-lockup__title"], [class*="author"]';

// True when el sits inside a shared card that is itself inside `within`
// (the message item / chat scope) — the item's own classes never count.
function inSharedCard(el, within) {
  for (let n = el; n && n !== within; n = n.parentElement) {
    try { if (n.matches && n.matches(SHARED_CARD_SEL)) return true; } catch (e) { return false; }
  }
  return false;
}

// Outermost shared cards inside a message item.
function sharedCards(item) {
  let all = [];
  try { all = [...item.querySelectorAll(SHARED_CARD_SEL)]; } catch (e) { return []; }
  return all.filter((c) => !inSharedCard(c.parentElement, item));
}

// Message text without the shared cards, plus one "[shared a post by X: …]" per card.
function messageTextWithCards(item, bodyEl) {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  let own = "";
  if (bodyEl && !inSharedCard(bodyEl, item)) {
    try {
      const copy = bodyEl.cloneNode(true);
      copy.querySelectorAll(SHARED_CARD_SEL).forEach((c) => c.remove());
      own = sharedCards(bodyEl).length ? clean(copy.textContent) : (bodyEl.innerText || "").trim();
    } catch (e) { own = (bodyEl.innerText || "").trim(); }
  }
  const notes = sharedCards(item).map((card) => {
    let author = "";
    try { const a = card.querySelector(CARD_AUTHOR_SEL); author = clean(a && (a.innerText || a.textContent)).split(/ [•·] /)[0]; } catch (e) {}
    // Post text only: drop the author block (name, headline, "• 2nd", time)
    let body = "";
    try {
      const copy = card.cloneNode(true);
      copy.querySelectorAll('[class*="actor"], [class*="entity-lockup"]').forEach((a) => a.remove());
      body = clean(copy.textContent);
    } catch (e) { body = clean(card.innerText || card.textContent); }
    if (author && body.startsWith(author)) body = body.slice(author.length).trim();
    if (body.length > 200) body = body.slice(0, 197) + "…";
    return (author ? "[shared a post by " + author : "[shared a post/attachment") + (body ? ': "' + body + '"' : "") + "]";
  });
  return [own, ...notes].filter(Boolean).join(" ");
}

// True for anything inside the thread's message list (messages + shared cards),
// i.e. never the chat header that names the partner.
function inMessageList(el) {
  try { return !!(el.closest && el.closest('.msg-s-message-list, [class*="msg-s-message-list"], [class*="message-list"]')) || inSharedCard(el, null); }
  catch (e) { return false; }
}

// Exact-class reader (LinkedIn's own classes) -> [{sender:'me'|'them', name, text}].
// Falls back to the generic light-DOM reader when the exact classes miss.
function scrapeChatMessages(editable, limit) {
  limit = limit || 5;
  try {
    const container = convoContainer(editable);
    let formEl = null;
    try { formEl = editable.closest('form, .msg-form, [class*="msg-form"]'); } catch (e) {}
    const cand = [];
    let name = "Them";
    // Exact class first; broaden when LinkedIn ships a variant for this thread,
    // so an open PAST conversation is still read for whichever user you clicked.
    let items = [];
    for (const s of [".msg-s-event-listitem", 'li[class*="msg-s-event"]', '[class*="msg-s-message-list"] li', '[class*="msg-s-message-group"] li']) {
      try { items = [...container.querySelectorAll(s)]; } catch (e) { items = []; }
      if (items.length) break;
    }
    items.forEach((item) => {
      // Sender name = the message group's own name, never a shared post's author
      let nm = null;
      try {
        nm = [...item.querySelectorAll('.msg-s-message-group__name, [class*="message-group__name"], [class*="entity-lockup__title"]')]
          .find((el) => !inSharedCard(el, item) && (el.innerText || "").trim()) || null;
      } catch (e) {}
      if (nm) name = nm.innerText.trim();
      let isOther = /--other/.test(item.className || "");
      try { if (!isOther) isOther = [...item.querySelectorAll('[class*="--other"], [class*="event-listitem--other"]')].some((el) => !inSharedCard(el, item)); } catch (e) {}
      let bodyEl = null;
      try {
        bodyEl = [...item.querySelectorAll('.msg-s-event__content, .msg-s-event-listitem__body, [class*="event-listitem__body"], [class*="message-body"], [class*="event__content"]')]
          .find((el) => !inSharedCard(el, item)) || null;
      } catch (e) {}
      const text = messageTextWithCards(item, bodyEl);
      if (formEl && formEl.contains && formEl.contains(item)) return;
      if (/footer|toolbar|left-actions|right-actions|composer/i.test(item.className || "")) return;
      if (/suggest|smart-reply|pill|chip|reaction/i.test(item.className || "")) return;
      if (LIST_CHROME_RE.test(item.className || "")) return;
      if (!text || isChatJunk(text) || hasToolbarConcat(text)) return;
      cand.push({ item, sender: isOther ? "them" : "me", name: isOther ? name : "You", text });
    });
    // Prefer the visible thread (LinkedIn can keep a hidden clone mounted).
    let vis = cand;
    try {
      const shown = cand.filter((cc) => { try { return cc.item.offsetParent !== null; } catch (e) { return true; } });
      if (shown.length) vis = shown;
    } catch (e) { /* ignore */ }
    // Collapse consecutive duplicates (render doubles), keep real repeats.
    const out = [];
    for (const m of vis) {
      const prev = out[out.length - 1];
      if (prev && prev.sender === m.sender && prev.text === m.text) continue;
      out.push({ sender: m.sender, name: m.name, text: m.text });
    }
    if (out.length) return out.slice(-limit);
  } catch (e) { /* fall through */ }
  // Last resort: the generic light-DOM reader for this same chat scope (same
  // junk/toolbar filters). A brand-new compose still returns [] here, so it
  // shows the generic opener instead of quoting page chrome.
  try {
    const alt = readRecentMessages(editable, limit);
    if (alt && alt.length) return alt;
  } catch (e) { /* ignore */ }
  return [];
}

// LinkedIn renders only the newest page of a thread; earlier messages join the
// DOM when the list is scrolled to its top. Scroll up a few times so the AI sees
// the whole conversation, then put the reader back exactly where they were.
async function harvestOlderMessages(editable, maxRounds) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ITEM_SEL = '.msg-s-event-listitem, li[class*="msg-s-event"], [class*="msg-s-message-list"] li';
  try {
    const container = convoContainer(editable);
    const count = () => { try { return container.querySelectorAll(ITEM_SEL).length; } catch (e) { return 0; } };
    const first = container.querySelector(ITEM_SEL);
    if (!first) return 0;
    let scroller = null;
    for (let el = first.parentElement; el && el !== document.body; el = el.parentElement) {
      let oy = "";
      try { oy = getComputedStyle(el).overflowY; } catch (e) { break; }
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 20) { scroller = el; break; }
    }
    if (!scroller) return 0;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;   // keep the reader's place
    let before = count();
    const start = before;
    for (let round = 0; round < (maxRounds || 4); round++) {
      scroller.scrollTop = 0;
      try { scroller.dispatchEvent(new Event("scroll", { bubbles: true })); } catch (e) { /* ignore */ }
      await wait(700);
      const now = count();
      if (now <= before) break;    // LinkedIn loaded nothing more — that's the whole thread
      before = now;
      if (now >= AI_HISTORY_LIMIT * 2) break;   // far beyond what one request can use
    }
    scroller.scrollTop = scroller.scrollHeight - fromBottom;
    return before - start;
  } catch (e) { return 0; }
}

function chatFirstName(editable, history) {
  const other = (history || []).find((m) => m && m.sender !== "me" && m.name && !/^(you|them)$/i.test(m.name));
  if (other) return other.name.split(/\s+/)[0];
  try {
    // Thread header title only — a lockup inside the message list is a shared post's author
    const headerTitle = (root) => [...root.querySelectorAll(".artdeco-entity-lockup__title, .msg-entity-lockup__entity-title")]
      .find((t) => !inMessageList(t)) || null;
    let el = editable, container = null;
    for (let i = 0; el && i < 20; i++, el = el.parentElement) {
      if (el.querySelectorAll && headerTitle(el)) { container = el; break; }
    }
    if (container) {
      const tt = headerTitle(container);
      const nm = tt ? ((tt.innerText || "").trim().split("\n")[0].trim()) : "";
      if (nm && !/^(new message|messaging)$/i.test(nm)) return nm.split(/\s+/)[0];
    }
  } catch (e) { /* ignore */ }
  try { return ((composeRecipientName(editable) || "there").split(/\s+/)[0]) || "Hi"; }
  catch (e) { return "Hi"; }
}

// Write the chosen reply into LinkedIn's composer (UI write only).
function insertIntoComposer(editable, text) {
  try { editable.focus(); } catch (e) {}
  try {
    if (editable.tagName === "TEXTAREA" && "value" in editable) {
      // Native setter so framework-controlled textareas (invite note) see the change
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(editable, text);
    }
    else {
      editable.innerHTML = "";
      const pp = document.createElement("p");
      pp.textContent = text;
      editable.appendChild(pp);
    }
  } catch (e) { try { editable.textContent = text; } catch (_e) {} }
  try { editable.dispatchEvent(new InputEvent("input", { bubbles: true })); }
  catch (e) { try { editable.dispatchEvent(new Event("input", { bubbles: true })); } catch (_e) {} }
  try {
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) { /* ignore */ }
  try { editable.scrollTop = editable.scrollHeight; } catch (e) { /* ignore */ }
}

// Mutations inside a shadow root don't reach the document observer —
// attach an observer to each discovered shadow root (once).
const _observedRoots = new WeakSet();
function ensureShadowObservers() {
  try {
    for (const root of collectRoots()) {
      if (root === document || _observedRoots.has(root)) continue;
      _observedRoots.add(root);
      new MutationObserver(() => { try { injectComposeSuggestions(); } catch (e) {} }).observe(root, { childList: true, subtree: true });
    }
  } catch (e) { /* observer optional */ }
}

// Inline styles: external CSS cannot cross the shadow boundary.
const SPARK_CSS = "display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;margin:0 2px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--li-blue,#0a66c2);font-size:16px;line-height:1;cursor:pointer;flex-shrink:0;vertical-align:middle;opacity:.85;";
const AI_BOX_CSS = "margin:0;padding:12px;border:1px solid var(--li-border,#e5e7eb);border-radius:10px;background:var(--li-bg,#fff);box-shadow:0 4px 20px rgba(0,0,0,.18);font-family:-apple-system,'Segoe UI',Roboto,sans-serif;";
const AI_ITEM_CSS = "display:block;width:100%;text-align:left;margin:6px 0;padding:10px 12px;border:1px solid var(--li-border,#e5e7eb);border-radius:8px;background:var(--li-surface,#f9fafb);color:var(--li-fg,#111827);font-size:13px;line-height:1.45;cursor:pointer;font-family:inherit;";
const AI_ROW_LABEL_CSS = "flex:0 0 auto;min-width:58px;margin-right:2px;";
const AI_MINI_CSS = "padding:3px 10px;border:1px solid var(--li-border-2,#cbd5e1);border-radius:999px;background:var(--li-input-bg,#fff);color:var(--li-fg-2,#374151);font-size:11px;font-weight:700;cursor:pointer;";

// ✨ popup analyses this many recent chat messages (the backend caps the length).
const AI_HISTORY_LIMIT = 40;

// Profile bits for the AI — only when the profile on screen is the chat partner
// (a chat overlay can be open over someone else's profile page).
function aiProfileContext(first) {
  let prof = {};
  try { prof = scrapeProfile() || {}; } catch (e) { return {}; }
  const pname = String(prof.name || "").split("\n")[0].trim();
  if (!pname || !first || pname.split(/\s+/)[0].toLowerCase() !== String(first).toLowerCase()) return {};
  const val = (v) => (v && v !== "Not specified") ? String(v).slice(0, 300) : "";
  return { name: pname, headline: val(prof.headline), position: val(prof.position), current_company: val(prof.current_company) };
}

// Chat partner's profile URL (https://www.linkedin.com/in/<slug>/) — the backend
// reads their recent posts from it for the professional first-message pain point.
function chatProfileUrl(editable, first) {
  const norm = (href) => {
    const m = String(href || "").match(/\/in\/([^/?#]+)/i);
    return m ? "https://www.linkedin.com/in/" + m[1] + "/" : "";
  };
  const firstLc = String(first || "").toLowerCase();
  // strict = link text must carry their first name (the thread also links to MY profile)
  const pick = (root, strict) => {
    if (!root || !root.querySelectorAll) return "";
    for (const a of root.querySelectorAll('a[href*="/in/"]')) {
      if (inSharedCard(a, root)) continue;   // a shared post's author, not the partner
      const txt =((a.innerText || a.textContent || "") + " " + (a.getAttribute("aria-label") || "")).toLowerCase();
      if (strict && (!firstLc || !txt.includes(firstLc))) continue;
      const u = norm(a.getAttribute("href") || a.href);
      if (u) return u;
    }
    return "";
  };
  let form = null;
  try { form = (editable.closest && (editable.closest(".msg-form") || editable.closest("form"))) || null; } catch (e) {}
  let header = null;
  try { header = findChatHeader(editable, form); } catch (e) {}
  let url = pick(header, true) || pick(header, false);
  if (!url) { try { url = pick(convoContainer(editable), true); } catch (e) {} }
  if (!url && /^\/in\//.test(location.pathname)) {
    try {
      const pname = String(scrapeProfile().name || "").toLowerCase();
      if (firstLc && pname.startsWith(firstLc)) url = norm(location.pathname);
    } catch (e) { /* ignore */ }
  }
  return url;
}

// Full name of the chat partner (lead log key when no profile link is known).
function chatFullName(editable, history) {
  const other = (history || []).find((m) => m && m.sender === "them" && m.name && !/^(you|them)$/i.test(m.name));
  if (other) return other.name.split("\n")[0].trim();
  try {
    const form = (editable.closest && (editable.closest(".msg-form") || editable.closest("form"))) || null;
    const header = findChatHeader(editable, form);
    const t = header && header.querySelector('.artdeco-entity-lockup__title, .msg-entity-lockup__entity-title, h2, a[href*="/in/"]');
    const nm = t ? (t.innerText || t.textContent || "").trim().split("\n")[0].trim() : "";
    if (nm && !/^(new message|messaging)$/i.test(nm)) return nm;
  } catch (e) { /* ignore */ }
  try { const nm = composeRecipientName(editable); return nm === "there" ? "" : nm; } catch (e) { return ""; }
}

function editableText(ed) {
  try { return String(ed.tagName === "TEXTAREA" ? ed.value : (ed.innerText || "")).trim(); } catch (e) { return ""; }
}

// ─── Connect → "Add a note" dialog ─────────────────────────────────────────────
function inviteTextareas() {
  const out = [];
  for (const root of collectRoots()) {
    let tas = [];
    try { tas = [...root.querySelectorAll('[role="dialog"] textarea, .artdeco-modal textarea')]; } catch (e) { continue; }
    for (const ta of tas) {
      const lbl = [ta.id, ta.name, ta.getAttribute("placeholder"), ta.getAttribute("aria-label")].join(" ");
      if (/custom-message|message|note|invitation/i.test(lbl) && !(ta.closest && ta.closest(".msg-form"))) out.push(ta);
    }
  }
  return out;
}

function inviteFullName(ta) {
  try {
    const dlg = ta.closest('[role="dialog"], .artdeco-modal');
    const txt = dlg ? (dlg.innerText || "") : "";
    const m = txt.match(/invitation to ([^\n.,!?]+?)(?:\s+by\b|\s+with\b|[\n.,!?]|$)/i);
    if (m && m[1].trim().length > 1) return m[1].trim();
  } catch (e) { /* ignore */ }
  try { if (isProfilePage()) return String(scrapeProfile().name || "").split("\n")[0].trim(); } catch (e) { /* ignore */ }
  return "";
}

// Profile URL for an invite — only when the open profile page is that person.
function inviteProfileUrl(fullName) {
  if (!/^\/in\//.test(location.pathname)) return "";
  try {
    const pname = String(scrapeProfile().name || "").toLowerCase();
    const first = String(fullName || "").split(/\s+/)[0].toLowerCase();
    if (!first || pname.startsWith(first)) return liProfileUrl(location.pathname);
  } catch (e) { /* ignore */ }
  return "";
}

// Connect clicked on a search result, My Network or feed card: remember whose card
// it was, so the "Add a note" dialog can use that person's profile and scores.
let _lastConnect = null;   // { url, name, headline, at }
function watchConnectClicks() {
  document.addEventListener("click", (e) => {
    try {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const btn = path.find((el) => el && el.matches && el.matches('button, [role="button"], a[href*="custom-invite"]'));
      if (!btn || btn.closest(OUR_UI_SEL)) return;
      if (!/^connect\b|\binvite .+ to connect\b/i.test(actionLabel(btn))) return;
      let card = btn.parentElement, link = null;
      for (let i = 0; card && i < 10; i++, card = card.parentElement) {
        link = [...card.querySelectorAll('a[href*="/in/"]')].find((a) => !inSharedCard(a, card)) || null;
        if (link) break;
      }
      const named = /invite (.+?) to connect/i.exec(btn.getAttribute("aria-label") || "");
      const name = (named && cleanLine(named[1])) || (link ? cleanLine((link.innerText || link.textContent || "").split("\n")[0]) : "");
      const lines = card ? visibleLines(card).filter((l) => l !== name && !UI_LINE_RE.test(l) && !COUNT_LINE_RE.test(l) &&
        !/^(connect|message|follow|pending|·?\s*(1st|2nd|3rd\+?)|.*\bdegree connection)$/i.test(l)) : [];
      _lastConnect = {
        url: link ? liProfileUrl(link.getAttribute("href") || link.href) : "",
        name, headline: lines.find((l) => l.length > 8) || "", at: Date.now(),
      };
    } catch (err) { /* never block LinkedIn's own click */ }
  }, true);
}

// Who the open "Add a note" dialog is for: the dialog names them; their profile
// URL comes from the page (on their profile) or from the card whose Connect was clicked.
function inviteTarget(ta) {
  const first = (s) => String(s || "").split(/\s+/)[0].toLowerCase();
  const fromDialog = inviteFullName(ta);
  const recent = _lastConnect && Date.now() - _lastConnect.at < 120000 ? _lastConnect : null;
  const card = recent && (!fromDialog || first(recent.name) === first(fromDialog)) ? recent : null;
  const fullName = fromDialog || (card && card.name) || "";
  let url = inviteProfileUrl(fullName);
  const onProfile = !!url;
  if (!url && card) url = card.url;
  return { fullName, first: fullName.split(/\s+/)[0] || "there", url, onProfile, card };
}

// Everything known about the invitee: their profile page (when open), their saved
// Activity / ICP analysis, the lead log, or at least the card's headline.
async function inviteAnalysis(t) {
  const NA = /^(not specified|unknown|no activity data|no recent activity|no projects)$/i;
  const val = (v) => (v && !NA.test(String(v).trim()) ? String(v).trim() : "");
  const out = { name: t.fullName, first_name: t.first === "there" ? "" : t.first };
  if (t.onProfile) {
    const p = scrapeProfile();
    Object.assign(out, { headline: val(p.headline), position: val(p.position), current_company: val(p.current_company),
      country: val(p.country), about: val(p.about).slice(0, 1500), activity: val(p.activity) });
  } else if (t.card) {
    out.headline = val(t.card.headline);
  }
  if (!t.url) return out;
  const scoreKey = "liScore:" + t.url;
  const r = await storageGet([scoreKey, LI_LEADS_KEY]);
  const stored = r[scoreKey] || {};
  const act = (stored.activity && stored.activity.data) || null;
  const icp = (stored.icp && stored.icp.data && stored.icp.data.result) || null;
  const leads = r[LI_LEADS_KEY] || {};
  const lead = leads[liFindLeadKey(leads, t.url, t.fullName)] || {};
  const fill = (k, v) => { if (!out[k] && val(v)) out[k] = val(v); };
  if (act) {
    out.activity = val(liActivityText(act)) || out.activity || "";   // the server's text quotes their latest post ("X ago" recomputed now)
    ["headline", "position", "current_company", "country"].forEach((k) => fill(k, act[k]));
    if (!out.about) out.about = val(act.about).slice(0, 1500);
    out.activity_score = Math.round(act.score_total || 0);
    out.activity_label = act.score_label || "";
    out.engagement_label = act.engagement_label || "";
    out.signal_hits = act.signal_hits || {};
  }
  if (icp) { out.icp_score = Math.round(icp.icp_score || 0); out.icp_breakdown = icp.breakdown || {}; }
  fill("headline", lead.headline);
  fill("current_company", lead.company);
  if (val(lead.painPoint)) out.pain_point = val(lead.painPoint).slice(0, 200);
  const prior = [];
  if (val(lead.lastSentText)) prior.push('I last wrote: "' + val(lead.lastSentText).slice(0, 140).replace(/"/g, "'") + '"');
  if (val(lead.lastTheirText)) prior.push('They replied: "' + val(lead.lastTheirText).slice(0, 140).replace(/"/g, "'") + '"');
  if (prior.length) out.prior_contact = prior.join(" · ");
  return out;
}

// What a note was personalised from, shown under the suggestions.
function noteBasis(a) {
  const out = [];
  if (a.position && a.current_company) out.push(`${a.position} at ${a.current_company}`);
  else if (a.position || a.headline) out.push(a.position || a.headline);
  if (a.icp_score != null) out.push(`ICP ${a.icp_score}`);
  if (a.activity_score != null) out.push(`Activity ${a.activity_score}`);
  if (/"/.test(a.activity || "")) out.push("latest post");
  const sig = Object.keys(a.signal_hits || {});
  if (sig.length) out.push(sig.join(" + ") + " signal");
  if (a.pain_point) out.push("pain point");
  if (a.prior_contact) out.push("past messages");
  return out;
}

// One small "✨ AI note" pill above LinkedIn's invitation-note box.
function injectInviteSpark() {
  for (const ta of inviteTextareas()) {
    if (ta._liSparkRow && ta._liSparkRow.isConnected) continue;
    try { injectStyles(); } catch (e) { /* inline fallbacks still apply */ }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:flex-end;margin:6px 0 4px;";
    const spark = document.createElement("button");
    spark.type = "button";
    spark.className = "li-spark-invite";
    spark.textContent = "✨ AI note";
    spark.title = "AI connection note — Casual / Pro";
    spark.style.cssText = AI_MINI_CSS + "color:var(--li-purple,#7c3aed);border-color:var(--li-purple,#7c3aed);";
    spark.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleAiPopup(ta, spark, { context: "invite" }); };
    row.appendChild(spark);
    try { ta.parentElement.insertBefore(row, ta); ta._liSparkRow = row; } catch (e) { /* layout changed */ }
  }
}

// ─── Follow-up tracking: remember what I sent, to whom, and when ─────────────
function recordSent(ed, text, kind) {
  try {
    let name = "", url = "", theirLast = "";
    if (kind === "invite") {
      const t = inviteTarget(ed);
      name = t.fullName;
      url = t.url;
    } else {
      const history = scrapeChatMessages(ed, AI_HISTORY_LIMIT);
      name = chatFullName(ed, history);
      url = chatProfileUrl(ed, name.split(/\s+/)[0]);
      const theirs = history.filter((m) => m.sender === "them");
      theirLast = theirs.length ? theirs[theirs.length - 1].text : "";
    }
    updateLead(url, name, {
      lastSentText: text.slice(0, 500), lastSentAt: Date.now(), lastSentKind: kind,
      awaitingReply: true, theirLastBeforeSend: theirLast.slice(0, 300),
    });
  } catch (e) { /* never break sending */ }
}

// Send button / Enter in a chat, "Send" in the invite dialog. Counted as sent
// only if the box is empty (or gone) a moment later.
function watchSends() {
  const later = (ed, text, kind) => setTimeout(() => {
    if (ed.isConnected && editableText(ed)) return;   // still there → not sent
    recordSent(ed, text, kind);
  }, 900);
  document.addEventListener("click", (e) => {
    try {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const btn = path.find((el) => el && el.tagName === "BUTTON");
      if (!btn) return;
      const form = btn.closest(".msg-form");
      if (form && btn.matches('.msg-form__send-button, .msg-form__send-btn, button[type="submit"]')) {
        const ed = form.querySelector('[contenteditable="true"], textarea');
        if (ed && editableText(ed)) later(ed, editableText(ed), "message");
        return;
      }
      const dlg = btn.closest('[role="dialog"], .artdeco-modal');
      const label = (btn.innerText || "") + " " + (btn.getAttribute("aria-label") || "");
      if (dlg && /\bsend\b/i.test(label) && !/without/i.test(label)) {
        const ta = inviteTextareas().find((t) => dlg.contains(t));
        if (ta && editableText(ta)) later(ta, editableText(ta), "invite");
      }
    } catch (err) { /* ignore */ }
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    try {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const ed = path.find((el) => el && el.getAttribute && el.getAttribute("contenteditable") === "true");
      if (ed && ed.closest(".msg-form") && editableText(ed)) later(ed, editableText(ed), "message");
    } catch (err) { /* ignore */ }
  }, true);
}

// POST to the backend (/suggest-messages → OpenRouter). The result is cached
// under cacheKey; render() shows it only if that key is still current.
async function fetchAiSuggestions(record, req, cacheKey, render) {
  if (record.pending[cacheKey] || record.cache[cacheKey]) return;
  record.pending[cacheKey] = true;
  let entry;
  try {
    const scores = await getLeadScores(req.profileUrl, req.fullName);
    // Invite notes: the invitee's profile + saved ICP / Activity analysis. Chats: light
    // profile context when the chat partner's profile is the page on screen.
    const about = req.context === "invite" ? await inviteAnalysis(req.target) : aiProfileContext(req.first);
    const data = await apiFetch("/suggest-messages", {
      messages: req.history.map((m) => ({ sender: m.sender || "unknown", name: m.name || "", text: m.text })),
      tone: req.tone,
      first_name: (req.first && !/^(hi|there|you)$/i.test(req.first)) ? req.first : "",
      profile_url: req.profileUrl || "",
      context: req.context,
      max_chars: req.maxChars,
      draft: req.draft,
      action: req.action,
      ...scores,
      ...about,
      sender_role: req.role || "",
    });
    const list = (data.suggestions || []).filter((s) => typeof s === "string" && s.trim());
    if (!list.length) throw new Error("no suggestions returned");
    entry = { list, pain: data.pain_point || "", painSource: data.pain_source || "", analysis: data.analysis || "",
              source: data.source || "ai", notice: data.notice || "",
              basis: req.context === "invite" ? noteBasis({ ...scores, ...about }) : [] };
    if (entry.pain) updateLead(req.profileUrl, req.fullName, { painPoint: entry.pain });
  } catch (e) {
    entry = { error: String((e && e.message) || e).slice(0, 200) };
  }
  delete record.pending[cacheKey];
  record.cache[cacheKey] = entry;
  if (record.view && record.view.cacheKey === cacheKey) render();
}

const openSpark = [];
function sparkBoxFor(form) {
  const rec = openSpark.find((r) => r.form === form);
  return rec && rec.box.isConnected ? rec : null;
}
function removeSparkRec(rec) {
  try { rec.box.remove(); } catch (e) {}
  try { rec.spark.style.background = rec.context === "invite" ? "var(--li-input-bg,#fff)" : "transparent"; } catch (e) { /* ignore */ }
  const i = openSpark.indexOf(rec);
  if (i >= 0) openSpark.splice(i, 1);
}
function pruneSparkPopups() {
  for (let i = openSpark.length - 1; i >= 0; i--) {
    const rec = openSpark[i];
    let gone = true;
    try { gone = !rec.form.isConnected || !rec.editable.isConnected || rec.form.getBoundingClientRect().height === 0; }
    catch (e) { gone = true; }
    if (gone) removeSparkRec(rec);
  }
}
// opts.above = sit on top of `el` (invite note: keep LinkedIn's note box visible).
function placeSparkBox(el, box, opts) {
  opts = opts || {};
  try {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.round(Math.min(Math.max(r.width, 260), 480));
    // horizontally CENTERED over the message box, clamped inside the viewport
    const centerX = r.left + (r.width - w) / 2;
    const next = {
      position: "fixed", width: w + "px", left: Math.round(Math.max(8, Math.min(centerX, vw - w - 8))) + "px",
      overflowY: "auto", zIndex: "99999", top: "", bottom: "", maxHeight: "",
    };

    // bottom edge sits just ABOVE the send button (bottom-right corner of the box)
    let anchorY = opts.above ? r.top - 4 : r.bottom - 8;
    if (!opts.above) {
      try {
        const send = el.querySelector('.msg-form__send-btn, .msg-form__send-button, button[type="submit"], .artdeco-button--circle');
        if (send) { const sr = send.getBoundingClientRect(); if (sr.height) anchorY = sr.bottom - 4; }   // ~36px lower
      } catch (e) { /* ignore */ }
    }

    // Full content height WITHOUT lifting max-height: un-setting it, even for one
    // measurement, collapses the scroll box and throws the reader back to the top.
    const need = box.scrollHeight || 220;
    const maxH = Math.round(vh * 0.48);
    const spaceAbove = anchorY - 8;                // anchor → viewport top
    const spaceBelow = vh - anchorY - 8;           // anchor → viewport bottom

    if (spaceAbove >= Math.min(need, 200)) {
      // grow upward from the send button, never past the top of the screen
      next.bottom = Math.round(vh - anchorY) + "px";
      next.maxHeight = Math.max(140, Math.min(maxH, spaceAbove - 8)) + "px";
    } else if (spaceBelow >= Math.min(need, 200)) {
      // no room above → drop below the anchor instead
      next.top = Math.round(anchorY + 8) + "px";
      next.maxHeight = Math.min(spaceBelow, maxH) + "px";
    } else if (spaceAbove >= spaceBelow) {
      // squeeze between the top of the screen and the anchor:
      // top + bottom both set → exact fit, header row stays visible, body scrolls
      next.top = "8px";
      next.bottom = Math.round(vh - anchorY) + "px";
      next.maxHeight = "none";
    } else {
      next.top = Math.round(anchorY + 8) + "px";
      next.bottom = "8px";
      next.maxHeight = "none";
    }

    // Touch only what changed (this runs on every page tick) and keep the scroll spot
    const scroll = box.scrollTop;
    for (const [k, v] of Object.entries(next)) if (box.style[k] !== v) box.style[k] = v;
    if (box.scrollTop !== scroll) box.scrollTop = scroll;
  } catch (e) { /* ignore */ }
}

function composeRecipientName(editor) {
  const box = editor.closest('aside, [class*="msg-overlay"], [class*="messaging"], [class*="conversation"], div[class*="overlay"]') || (editor.getRootNode ? editor.getRootNode() : document);
  // Skip links/headings inside the messages: a shared post links to its author
  const link = [...box.querySelectorAll('a[href*="/in/"]')].find((a) => !inMessageList(a));
  let name = (link && (link.innerText || link.textContent) || "").trim();
  if (!name) {
    const h = [...box.querySelectorAll("h2, h3, [class*='bubble-header'] span, [class*='header'] span")].find((x) => !inMessageList(x));
    name = ((h && (h.innerText || h.textContent)) || "").trim();
  }
  name = name.split("\n")[0].trim().replace(/\s*\(.*\)\s*$/, "");
  if (!name || /^(new message|messaging|inbox|message)$/i.test(name)) {
    // Fallback: profile page being viewed
    try { name = (scrapeProfile().name || "").split("\n")[0]; } catch (e) {}
  }
  return name || "there";
}

function readRecentMessages(editor, limit) {
  limit = limit || 5;
  try {
    const scope = editor.closest('aside, [class*="msg-overlay"], [class*="messaging"], [class*="conversation"], div[class*="overlay"]') || document;
    let formEl = null;
    try { formEl = editor.closest('form, .msg-form, [class*="msg-form"]'); } catch (e) {}
    const sels = [
      'li[class*="msg-s-event"]',
      'div[class*="msg-s-message-group"]',
      'div[class*="event-listitem"]',
      'li[class*="event-listitem"]',
      '[class*="message-list"] li',
      '[class*="conversation"] li'
    ];
    let nodes = [];
    for (const s of sels) {
      try { nodes = [...scope.querySelectorAll(s)]; } catch (e) { nodes = []; }
      if (nodes.length) break;
    }
    // Fallback: any bubble-like div with decent text inside the chat scope
    if (!nodes.length) {
      nodes = [...scope.querySelectorAll('li, div[class*="msg-"], div[class*="message"]')].filter((el) => {
        if (el.querySelector('li, div[class*="msg-s-event"], div[class*="message-group"]')) return false;
        if (formEl && formEl.contains && formEl.contains(el)) return false;
        if (el.closest && el.closest('button, a, input, textarea, select, [role="button"], [role="link"]')) return false;
        if (/footer|toolbar|left-actions|right-actions|composer/i.test(el.className || "")) return false;
        if (/suggest|smart-reply|pill|chip|reaction/i.test(el.className || "")) return false;
        if (LIST_CHROME_RE.test(el.className || "")) return false;
        if (el.closest && !el.closest('[class*="message-list"], [class*="conversation"], [class*="thread"], [class*="chat"], ul, ol, [role="log"], [role="list"], [role="listitem"]')) return false;
        const txt = ((el.innerText || el.textContent) || "").trim();
        return txt.length > 1 && txt.length < 2000 && el !== editor && !el.closest('.li-compose-suggest, .li-ai-popup');
      });
    }
    const out = [];
    const seenText = new Set();
    for (const n of nodes) {
      if (n.closest('.li-compose-suggest, .li-ai-popup')) continue;
      if (formEl && (n === formEl || (formEl.contains && formEl.contains(n)))) continue;
      if (n.closest && n.closest('button, a, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"]')) continue;
      if (inSharedCard(n, scope)) continue;    // pieces of a shared post, not a message
      let body = [...n.querySelectorAll('[class*="event-listitem__body"], [class*="message-body"], p, [class*="body"]')]
        .find((el) => !inSharedCard(el, n)) || n;
      let txt = (sharedCards(n).length ? messageTextWithCards(n, body)
        : ((body.innerText || body.textContent) || "")).replace(/\s+/g, " ").trim();
      if (!txt || txt.length < 2 || txt.length > 2000) continue;
      if (isChatJunk(txt)) continue;
      if (hasToolbarConcat(txt)) continue;
      if (/footer|toolbar|left-actions|right-actions|composer/i.test((n.className || "") + " " + ((body && body.className) || ""))) continue;
      if (/suggest|smart-reply|pill|chip|reaction/i.test((n.className || "") + " " + ((body && body.className) || ""))) continue;
      if (LIST_CHROME_RE.test((n.className || "") + " " + ((body && body.className) || ""))) continue;
      if (/^write a message/i.test(txt)) continue;
      if (seenText.has(txt)) continue;
      seenText.add(txt);
      const cls = (n.className || "") + " " + ((body && body.className) || "");
      let sender = "unknown";
      if (/sent|outgoing|own|self|mine|--sent/i.test(cls)) sender = "me";
      else if (/received|incoming|their|other|contact|--received/i.test(cls)) sender = "them";
      out.push({ sender, text: txt });
    }
    return out.slice(-limit);
  } catch (e) { return []; }
}

const DRAFT_ACTIONS = [["improve", "Improve"], ["shorten", "Shorten"], ["grammar", "Fix grammar"]];
// Tone pills on every ✨ AI note / AI suggestion — the tones the backend writes in.
const TONES = [["casual", "Casual", "Warm and friendly, in plain words"],
               ["pro", "Pro", "Professional: formal, concise, no emoji"]];
const TONE_ON_CSS = {
  casual: "background:var(--li-purple,#7c3aed);color:var(--li-purple-fg,#fff);border-color:var(--li-purple,#7c3aed);",
  pro:    "background:var(--li-blue-fill,#0a66c2);color:var(--li-blue-fg,#fff);border-color:var(--li-blue-fill,#0a66c2);",
};

// Drawn icons for the ✨ popup header (one stroke weight, follow text color).
const ICON_REFRESH = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3.2h-3.2"/></svg>';
const ICON_CLOSE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

// opts.context = "invite" → Connect → "Add a note" box (no chat history,
// LinkedIn's own character limit, popup opens above the note box).
async function toggleAiPopup(editable, spark, opts) {
  opts = opts || {};
  const prefs = await loadAiPrefs();
  // Theme variables live in the shared stylesheet, which profile pages inject on
  // their own; chats on /messaging or the feed need it too or the popup stays light.
  try { injectStyles(); applyTheme(); } catch (e) { /* inline fallbacks still apply */ }
  const invite = opts.context === "invite";
  let form = null;
  try {
    form = invite
      ? (editable.closest('[role="dialog"], .artdeco-modal') || editable.parentElement)
      : ((editable.closest && (editable.closest(".msg-form") || editable.closest("form"))) || editable.parentElement);
  } catch (e) { form = editable.parentElement; }
  if (!form) return;
  // Anchor = the text-editor container (.msg-form__msg-content-container): the
  // popup opens directly above it. Invite: above the "✨ AI note" row.
  let anchor = null;
  try { anchor = invite ? spark.parentElement : ((editable.closest && editable.closest(".msg-form__msg-content-container")) || null); } catch (e) { anchor = null; }
  const rec = sparkBoxFor(form);
  // Re-clicking ✨ must NOT hide the popup — refresh it instead (× closes it).
  if (rec) {
    try { if (typeof rec.paint === "function") rec.paint(); } catch (e) {}
    try { spark.style.background = "rgba(124,58,237,.15)"; } catch (e) {}
    return;
  }
  openSpark.slice().forEach((r) => removeSparkRec(r));

  const box = document.createElement("div");
  box.className = "li-ai-popup";
  box.style.cssText = AI_BOX_CSS;
  // action/draft set = "Your draft" rewrite view; notice = one-off hint line
  const state = { tone: cleanTone(editable._liTone || lastAiTone), action: "", draft: "", notice: "",
                  role: prefs.senderRole || "" };
  const maxChars = invite ? ((editable.maxLength > 0 && editable.maxLength) || 300) : 300;
  // cache: key -> {list} | {error}; pending: keys with a request in flight.
  // Repaints for an unchanged thread never hit the API again.
  const record = { form, editable, box, spark, anchor, cache: {}, pending: {}, fetchTimer: null, view: null,
                   context: invite ? "invite" : "chat" };
  const removeBox = () => { clearTimeout(record.fetchTimer); removeSparkRec(record); };
  record.removeBox = removeBox;
  record.place = () => placeSparkBox((record.anchor && record.anchor.isConnected) ? record.anchor : record.form, box, { above: invite });

  const render = () => {
    const v = record.view;
    if (!v || !box.isConnected) return;
    const entry = record.cache[v.cacheKey];
    const n = v.history.length;
    let body;
    if (entry && entry.list) {
      const painLine = entry.pain
        ? '<div style="margin:0 0 6px;padding:6px 10px;border-radius:8px;background:rgba(10,102,194,.08);color:var(--li-fg-2,#374151);font-size:11.5px;line-height:1.4;">🎯 Pain point' +
          (entry.painSource ? " (from " + escHtml(entry.painSource) + ")" : "") + ": <strong>" + escHtml(entry.pain) + "</strong></div>"
        : "";
      const heading = state.action
        ? '<div style="font-size:11px;font-weight:700;color:var(--li-muted,#6b7280);margin:2px 0;">Rewrites of your draft — click to replace it</div>'
        : "";
      // The AI's read of where the chat stands, so you can see why it suggests what it does
      const lineCss = "margin:0 0 6px;padding:6px 10px;border-radius:8px;background:var(--li-surface-2,#f3f4f6);color:var(--li-fg-2,#374151);font-size:11.5px;line-height:1.4;";
      const analysisLine = entry.analysis && !state.action
        ? '<div data-role="analysis" style="' + lineCss + '"><strong>' +
          (invite ? "Why this person:" : "Conversation (" + n + " message" + (n === 1 ? "" : "s") + " read):") +
          "</strong> " + escHtml(entry.analysis) + "</div>"
        : "";
      // Invite notes: what they were personalised from, and whether the AI or the template wrote them
      const basisLine = invite && !state.action && (entry.basis || []).length
        ? '<div data-role="basis" style="margin:0 0 6px;font-size:11px;line-height:1.4;color:var(--li-muted,#6b7280);">Personalized from: ' +
          escHtml(entry.basis.join(" · ")) + "</div>"
        : "";
      const noticeLine = entry.source === "template" && entry.notice
        ? '<div data-role="notice" role="status" style="margin:0 0 6px;font-size:11px;line-height:1.4;color:var(--li-warn-fg,#92400e);">Template — ' +
          escHtml(entry.notice) + "</div>"
        : "";
      body = heading + analysisLine + basisLine + noticeLine + painLine +
        entry.list.map((s) => '<button type="button" class="li-ai-sug" style="' + AI_ITEM_CSS + '">' + escHtml(s) + "</button>").join("");
    } else if (entry && entry.error) {
      body = '<div role="alert" style="padding:10px 12px;border:1px solid #fca5a5;border-radius:8px;background:rgba(239,68,68,.08);color:var(--li-fg,#111827);font-size:12.5px;line-height:1.45;">' +
        "⚠️ AI unavailable — " + escHtml(entry.error) +
        '<div style="margin-top:8px;"><button type="button" data-act="retry" style="' + AI_MINI_CSS + '">Retry</button></div></div>';
    } else {
      const loading = state.action ? "✍️ Rewriting your draft…"
        : record.harvesting ? "⏳ Loading the earlier messages of this conversation…"
        : (!n && state.tone === "pro") ? "🔎 Reading their recent posts to find the real pain point… (first time can take up to a minute)"
        : n ? `✨ Reading ${n} message${n === 1 ? "" : "s"} and writing replies…`
        : "✨ Generating suggestions…";
      body = '<div role="status" style="padding:14px 12px;font-size:12.5px;color:var(--li-muted,#6b7280);">' + loading + "</div>";
    }
    // Tone belongs to the message being written, not to a saved setting: pick it
    // here and the suggestions below are rewritten in it.
    const toneRow =
      '<div role="group" aria-label="Message tone" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:8px 0 0;font-size:11px;color:var(--li-muted,#6b7280);">' +
      '<span style="' + AI_ROW_LABEL_CSS + '">Tone:</span>' +
      TONES.map(([k, label, hint]) => '<button type="button" data-tone="' + k + '" title="' + escAttr(hint) + '" aria-pressed="' + (state.tone === k) +
        '" style="' + AI_MINI_CSS + (state.tone === k ? TONE_ON_CSS[k] : "") + '">' + label + "</button>").join("") +
      "</div>";
    const draftRow =
      '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:6px 0 2px;font-size:11px;color:var(--li-muted,#6b7280);">' +
      '<span style="' + AI_ROW_LABEL_CSS + '">Your draft:</span>' +
      DRAFT_ACTIONS.map(([k, label]) => '<button type="button" data-draft="' + k + '" aria-pressed="' + (state.action === k) + '" style="' + AI_MINI_CSS +
        (state.action === k ? "background:#7c3aed;color:#fff;border-color:#7c3aed;" : "") + '">' + label + "</button>").join("") +
      (state.action ? '<button type="button" data-act="back" style="' + AI_MINI_CSS + '">← Suggestions</button>' : "") +
      (state.notice ? '<span role="status" style="flex-basis:100%;color:var(--li-warn-fg,#92400e);margin-top:2px;">' + escHtml(state.notice) + "</span>" : "") +
      "</div>";
    const html =
      '<div style="position:sticky;top:-12px;margin:-12px -12px 0;padding:12px 12px 4px;background:var(--li-bg,#fff);display:flex;justify-content:space-between;align-items:center;gap:8px;border-radius:10px 10px 0 0;z-index:2;box-shadow:0 1px 0 var(--li-border,#e5e7eb);">' +
      '<span style="font-size:11px;font-weight:800;letter-spacing:.6px;color:var(--li-blue,#0a66c2);">' + (invite ? "AI NOTE" : "AI SUGGESTIONS") + "</span>" +
      '<span style="display:flex;gap:4px;align-items:center;">' +
      (state.role ? '<span title="' + escAttr("Sending as: " + state.role + " — change it from the extension icon → My pitch") + '" style="max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:700;color:var(--li-muted,#6b7280);padding:2px 4px;">as ' + escHtml(state.role) + "</span>" : "") +
      '<button type="button" data-act="refresh" title="Generate new AI suggestions" aria-label="Generate new AI suggestions" style="' + AI_MINI_CSS + 'padding:4px 8px;display:inline-flex;align-items:center;">' + ICON_REFRESH + "</button>" +
      '<button type="button" data-act="close" title="Close" aria-label="Close AI suggestions" style="background:none;border:none;padding:4px;border-radius:6px;cursor:pointer;color:var(--li-muted,#6b7280);display:inline-flex;align-items:center;">' + ICON_CLOSE + "</button>" +
      "</span></div>" +
      toneRow +
      draftRow +
      '<div style="height:4px;"></div>' +
      body;
    state.notice = "";
    // The page tick repaints often: an unchanged popup is left alone, so the reader's
    // scroll position (and focus) survive; the same view keeps its scroll after a rebuild.
    if (html === record.lastHtml) { record.place(); return; }
    const keepScroll = record.lastViewKey === v.cacheKey ? box.scrollTop : 0;
    box.innerHTML = html;
    record.lastHtml = html;
    record.lastViewKey = v.cacheKey;
    box.querySelector('[data-act="close"]').onclick = removeBox;
    box.querySelector('[data-act="refresh"]').onclick = (e) => { e.preventDefault(); paint({ force: true }); };
    const retry = box.querySelector('[data-act="retry"]');
    if (retry) retry.onclick = (e) => { e.preventDefault(); paint({ force: true }); };
    const back = box.querySelector('[data-act="back"]');
    if (back) back.onclick = (e) => { e.preventDefault(); state.action = ""; state.draft = ""; paint(); };
    box.querySelectorAll("[data-tone]").forEach((b) => { b.onclick = (e) => { e.preventDefault(); if (state.tone === b.dataset.tone) return; state.tone = rememberAiTone(b.dataset.tone); paint(); }; });
    box.querySelectorAll("[data-draft]").forEach((b) => {
      b.onclick = (e) => {
        e.preventDefault();
        const draft = editableText(editable);
        if (!draft) { state.notice = "Type your draft in the message box first."; render(); return; }
        state.action = b.dataset.draft;
        state.draft = draft;
        paint();
      };
    });
    box.querySelectorAll(".li-ai-sug").forEach((el) => {
      el.onmouseenter = () => { el.style.borderColor = "var(--li-purple,#7c3aed)"; el.style.background = "var(--li-hover,#f5f0ff)"; };
      el.onmouseleave = () => { el.style.borderColor = "var(--li-border,#e5e7eb)"; el.style.background = "var(--li-surface,#f9fafb)"; };
      el.onclick = () => { insertIntoComposer(editable, el.innerText); };   // keep popup open (tone/list stay usable)
    });
    record.place();
    box.scrollTop = keepScroll;
  };

  // opts.force = drop the cached answer (↻ / Retry); opts.debounce = live refresh,
  // wait for the thread to settle so a burst of DOM mutations = one request.
  const paint = (opts) => {
    opts = opts || {};
    const history = invite ? [] : scrapeChatMessages(editable, AI_HISTORY_LIMIT);
    const target = invite ? (record.target || (record.target = inviteTarget(editable))) : null;
    const fullName = invite ? target.fullName : chatFullName(editable, history);
    const first = invite ? target.first : chatFirstName(editable, history);
    editable._liTone = state.tone;
    const histKey = history.map((m) => m.sender + ":" + m.text).join("|");
    box.dataset.histKey = histKey;
    const profileUrl = invite ? target.url : chatProfileUrl(editable, first);
    if (editable._liLoggedKey !== histKey) {
      editable._liLoggedKey = histKey;
      try { console.log("[LI-AI] scraped chat history (" + history.length + "):", history.map((m) => "[" + (m.sender || "?") + "] " + m.text)); } catch (e) {}
      noteReplies(history, profileUrl, fullName);
    }
    // Person + mode are part of the key: an empty history ("") must not reuse another chat's openers.
    const act = state.action ? state.action + ":" + state.draft : "";
    const cacheKey = [record.context, first, profileUrl, histKey, state.tone, state.role, act].join("|");
    if (opts.force && !record.pending[cacheKey]) delete record.cache[cacheKey];
    record.view = { history, first, cacheKey, tone: state.tone, profileUrl };
    render();
    if (record.harvesting) return;   // fetch once the earlier messages have loaded
    if (record.cache[cacheKey] || record.pending[cacheKey]) return;
    clearTimeout(record.fetchTimer);
    const req = { history, first, fullName, target, tone: state.tone, role: state.role, profileUrl, context: record.context, maxChars,
                  draft: state.action ? state.draft : "", action: state.action };
    record.fetchTimer = setTimeout(() => fetchAiSuggestions(record, req, cacheKey, render), opts.debounce ? 1500 : 0);
  };
  record.paint = paint;
  // Persistent popup: clicking anywhere — suggestions, ✨, Send, Enter — never
  // hides it, so you can keep changing tone and picking lines. Only the ×
  // button (or the composer being removed) closes it.
  openSpark.push(record);
  document.body.appendChild(box);
  if (!invite) record.harvesting = true;
  paint();                      // fill content FIRST so placement measures real height
  if (!invite) {
    harvestOlderMessages(editable).then((added) => {
      record.harvesting = false;
      if (added) console.log("[LI-AI] loaded " + added + " earlier message(s) from this thread");
      if (box.isConnected) paint();
    });
  }
  try { spark.style.background = "rgba(124,58,237,.15)"; } catch (e) {}
}

// Nearest chat header bar for this composer (climb at most 8 levels so we never
// grab another chat window's header). Climbs out of badge/title sub-blocks.
function findChatHeader(editable, form) {
  let el = null;
  try { el = form || editable; } catch (e) { el = editable; }
  for (let i = 0; el && i < 8; i++, el = el.parentElement) {
    if (!el.querySelector) continue;
    let h = null;
    try { h = el.querySelector('.msg-overlay-bubble-header, [class*="bubble-header"], [class*="overlay-header"], [class*="conversation-header"]'); } catch (e) {}
    if (h) {
      while (h && /badge-container|lockup|entity-title|entity-subtitle/i.test(h.className || "") && h.parentElement) h = h.parentElement;
      return h;
    }
  }
  return null;
}

function makeSparkButton() {
  const spark = document.createElement("button");
  spark.type = "button";
  spark.className = "li-spark-btn";
  spark.textContent = "✨";
  spark.title = `AI Suggestions — reads this conversation (up to ${AI_HISTORY_LIMIT} messages)`;
  spark.setAttribute("aria-label", "AI Suggestions");
  spark.style.cssText = SPARK_CSS;
  spark.onmouseenter = () => { spark.style.background = "rgba(0,0,0,.08)"; };
  spark.onmouseleave = () => {
    const open = openSpark.some((r) => r.spark === spark);
    spark.style.background = open ? "rgba(124,58,237,.15)" : "transparent";
  };
  return spark;
}

// Composer belonging to a footer: walk up to the overlay, search down.
// Footer-first lookup so the button never depends on composer detection.
function editorForFooter(foot) {
  const sels = [
    'div.msg-form__contenteditable[contenteditable="true"]',
    '[aria-label*="Write a message"][contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea'
  ];
  let box = null;
  try { box = foot.parentElement; } catch (e) {}
  for (let i = 0; i < 10 && box; i++) {
    for (const s of sels) {
      let ed = null;
      try { ed = box.querySelector(s); } catch (e) {}
      if (ed) return ed;
    }
    box = box.parentElement;
  }
  try {
    const root = foot.getRootNode ? foot.getRootNode() : document;
    for (const s of sels) {
      let ed = null;
      try { ed = root.querySelector(s); } catch (e) {}
      if (ed) return ed;
    }
  } catch (e) { /* ignore */ }
  return null;
}

// LinkedIn's image-attach button (the gallery icon you see first in the icon row)
const IMG_BTN_SEL = 'button[title^="Attach an image"], button[aria-label^="Attach an image"], [data-test-msg-ui-upload-attachment-presenter] button';

// The row that holds the image button → ✨ goes on its LEFT side.
function sparkRow(scope) {
  try {
    const img = scope.querySelector(IMG_BTN_SEL);
    if (img) {
      const actions = img.closest ? img.closest(".msg-form__left-actions") : null;
      if (actions) return { row: actions, img };
      // Unknown layout: climb to the ancestor that already holds >1 button
      // (that is LinkedIn's icon row) instead of the single-button wrapper.
      let node = (img.closest && (img.closest(".msg-form__upload-attachment") || img.parentElement)) || img.parentElement;
      for (let i = 0; i < 4 && node; i++) {
        if (node.querySelectorAll && node.querySelectorAll("button").length > 1) break;
        if (!node.parentElement) break;
        node = node.parentElement;
      }
      if (node && node.querySelectorAll("button").length > 1) return { row: node, img };
      if (img.parentElement) return { row: img.parentElement, img };
    }
  } catch (e) { /* ignore */ }
  try { return { row: scope.querySelector(".msg-form__left-actions"), img: null }; }
  catch (e) { return { row: null, img: null }; }
}

// Exactly one ✨ per composer, inserted immediately LEFT of the image button.
// Strays (wrong container) and duplicates are removed every tick.
function placeSpark(scope, editorFor) {
  const parts = sparkRow(scope);
  const row = parts.row, img = parts.img;
  if (!row) return;   // row not rendered yet — the 3s tick retries
  scope.querySelectorAll(".li-spark-btn").forEach(s => { if (s.parentElement !== row) s.remove(); });
  const inRow = row.querySelectorAll(".li-spark-btn");
  for (let i = 1; i < inRow.length; i++) inRow[i].remove();
  if (inRow.length) return;   // already exactly one, correctly placed

  const spark = makeSparkButton();
  spark.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    try { const ed = editorFor(); if (ed) toggleAiPopup(ed, spark); } catch (err) { /* ignore */ }
  };

  // Anchor = LinkedIn's image button (or its wrapper) when it is a direct child of the row
  let anchor = null;
  if (img) {
    const wrap = (img.closest && img.closest(".msg-form__upload-attachment")) || null;
    if (wrap && wrap.parentElement === row) anchor = wrap;
    else if (img.parentElement === row) anchor = img;
  }
  if (!anchor) anchor = row.querySelector("button");
  if (anchor && anchor !== spark) row.insertBefore(spark, anchor);
  else row.appendChild(spark);
}

function injectComposeSuggestions() {
  try { ensureShadowObservers(); } catch (e) {}
  pruneSparkPopups();
  // 1) Exactly ONE ✨ per composer footer, on the left side of the gallery (image) icon.
  //    Strays (duplicates or a button landed in the wrong container) are removed.
  try {
    const seenFoot = new Set();
    for (const root of collectRoots()) {
      let foots = [];
      try { foots = [...root.querySelectorAll('footer.msg-form__footer, footer[class*="msg-form"], [class*="msg-form__footer"]')]; }
      catch (e) { continue; }
      for (const foot of foots) {
        if (!foot || seenFoot.has(foot)) continue;
        seenFoot.add(foot);
        try { placeSpark(foot, () => editorForFooter(foot)); }
        catch (e) { /* never break chat */ }
      }
    }
  } catch (e) { /* ignore */ }
  // 2) Rare composers without a footer — same rule: one button, icon row only.
  for (const editable of composeEditors()) {
    try {
      let form = null;
      try { form = (editable.closest && (editable.closest(".msg-form") || editable.closest("form"))) || null; }
      catch (e) { form = null; }
      if (!form) continue;
      // footer path already owns this composer
      if (form.querySelector('footer.msg-form__footer, footer[class*="msg-form"], [class*="msg-form__footer"]')) continue;
      placeSpark(form, () => editable);
    } catch (e) { /* never break chat */ }
  }
  // 3) ✨ AI note above LinkedIn's Connect → "Add a note" box.
  try { injectInviteSpark(); } catch (e) { /* never break the invite dialog */ }
  // 4) Live refresh: repaint an open popup if new chat messages arrived.
  openSpark.slice().forEach((rec) => {
    try {
      rec.place();
      if (rec.context === "invite") return;   // no chat history in an invite
      const key = scrapeChatMessages(rec.editable, AI_HISTORY_LIMIT).map((m) => m.sender + ":" + m.text).join("|");
      if (rec.box.dataset.histKey !== key && typeof rec.paint === "function") rec.paint({ debounce: true });
    } catch (e) { /* ignore */ }
  });
}

// ─── Init ──────────────────────────────────────────────────────────────────────
// Buttons and panels belong to one person. Opening an overlay (Contact info)
// keeps them; moving to someone else or off the profile removes them.
let _navState = "";
function handleNavigation() {
  const state = (isProfilePage() ? "profile:" : "other:") + (currentProfileSlug() || location.pathname);
  if (state === _navState) return;
  const first = !_navState;
  _navState = state;
  if (first) return;
  for (const id of ["li-ai-analyze-btn", "li-icp-btn", "li-ai-panel", "li-icp-panel"]) document.getElementById(id)?.remove();
}

// LinkedIn mutates the DOM constantly: batch our work into at most one pass
// every 400 ms instead of re-scanning the page on every mutation.
let _tickTimer = 0, _lastTick = 0;
function runTick() {
  _tickTimer = 0;
  _lastTick = Date.now();
  try { handleNavigation(); } catch (e) { /* ignore */ }
  try { addAIButton(); } catch (e) { /* retried next tick */ }
  try { injectComposeSuggestions(); } catch (e) { /* never break chat */ }
}
function scheduleTick() {
  if (_tickTimer) return;
  _tickTimer = setTimeout(runTick, Math.max(0, 400 - (Date.now() - _lastTick)));
}

watchTheme();
applyTheme();
setTimeout(runTick, 1500);
setInterval(scheduleTick, 3000);
new MutationObserver(scheduleTick).observe(document.body, { childList: true, subtree: true });

watchSends();
watchConnectClicks();

let _focusSparkTimer = null;
document.addEventListener("focusin", (e) => {
  clearTimeout(_focusSparkTimer);
  // Clicking into a chat = good moment to notice a reply (stops its follow-up reminder)
  let ed = null;
  try {
    const path = e.composedPath ? e.composedPath() : [e.target];
    ed = path.find((el) => el && el.getAttribute && el.getAttribute("contenteditable") === "true" && el.closest && el.closest(".msg-form"));
  } catch (err) { ed = null; }
  _focusSparkTimer = setTimeout(() => {
    try { injectComposeSuggestions(); } catch (err) {}
    if (!ed) return;
    try {
      const history = scrapeChatMessages(ed, AI_HISTORY_LIMIT);
      const name = chatFullName(ed, history);
      noteReplies(history, chatProfileUrl(ed, name.split(/\s+/)[0]), name);
    } catch (err) { /* ignore */ }
  }, 150);
}, true);