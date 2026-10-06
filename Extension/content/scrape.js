// LinkedIn AI Analyzer content script - Reading the profile page, and answering the popup.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ─── LinkedIn Profile Scraper ──────────────────────────────────────────────────

// ─── Scrape helpers ────────────────────────────────────────────────────────────
const cleanLine = (s) => String(s || "").replace(/\s+/g, " ").trim();
const BLOCK_TAG_RE = /^(DIV|P|LI|UL|OL|SECTION|ARTICLE|HEADER|FOOTER|H[1-6]|TR|TABLE|DL|DT|DD|BLOCKQUOTE|FIGURE|FIGCAPTION|MAIN|ASIDE|NAV)$/;
const SKIP_TAG_RE = /^(BUTTON|SVG|SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IMG|INPUT|TEXTAREA|SELECT)$/;
const UI_LINE_RE = /^(about|activity|message|messaging|more|connect|follow|following|pending|contact info|open to|add profile section|enhance profile|resources|home|my network|jobs|notifications?|search|for business|linkedin|show all\b.*|see (more|all)\b.*|…\s*see more)$/i;
const COUNT_LINE_RE = /\b[\d,.]+\+?\s*(connections?|followers?)\b|\bmutual connections?\b/i;
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


// Who this profile belongs to: its address and the name in the page heading. Everything
// about the person - headline, About, experience, company, location, photo, activity -
// comes from Apify on the server, so the page is no longer read for any of it. The other
// keys stay, empty, so every caller still finds the shape it expects.
function scrapeProfile() {
  const result = {
    avatar: "", name: "", position: "", headline: "", country: "",
    about: "", current_company: "", education: "", experience: "",
    skills: "", projects: "", activity: "",
    profileUrl: liProfileUrl(location.href) || location.href.split("?")[0],
  };
  const mainEl = document.querySelector("main") || document.body;
  const nameEl = mainEl.querySelector("h1") || document.querySelector("h1");
  if (nameEl) {
    const raw = visibleLines(nameEl)[0] || cleanLine(nameEl.textContent);
    result.name = raw.replace(/\s*\([^)]*\)\s*$/g, "").trim() || "Unknown";
  }
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
