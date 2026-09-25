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

function scrapeProfile() {
  const result = {
    avatar: "", name: "", position: "", headline: "", country: "",
    about: "", current_company: "", education: "", experience: "",
    skills: "", projects: "", activity: "",
    mutual_connections: 0,
    profileUrl: window.location.href.split("?")[0]
  };

  // Mutual connections — LinkedIn renders as: "Name, Name and X other mutual connections"
  (function scrapeMutuals() {
    const parseNum = (str) => parseInt((str || "").replace(/,/g, ""), 10);

    // ── Strategy 1: match LinkedIn's exact format ─────────────────────────────
    // e.g. "Aayushi, Poonam and 8 other mutual connections"  → total = named + X
    // e.g. "Aayushi and 1 other mutual connection"
    // e.g. "Aayushi and Poonam are mutual connections"        → count named names
    // e.g. "5 mutual connections"                             → plain number
    const allEls = document.querySelectorAll("button, a, span, div, p, li");
    for (const el of allEls) {
      const txt = (el.innerText || el.textContent || "").trim();
      if (!txt || txt.length > 200) continue;
      if (!/mutual/i.test(txt)) continue;

      // "Aayushi, Poonam and 8 other mutual connections"
      const mOther = txt.match(/and\s+([\d,]+)\s+other\s+mutual/i);
      if (mOther) {
        // Count named people before "and X other": split on ", " and "and X other"
        const namedPart = txt.split(/\s+and\s+[\d,]+\s+other/i)[0] || "";
        const namedCount = namedPart.split(",").filter(s => s.trim().length > 0).length;
        result.mutual_connections = namedCount + parseNum(mOther[1]);
        return;
      }

      // "Aayushi and Poonam are mutual connections" — only named, no number
      const mAre = txt.match(/^(.+?)\s+are\s+mutual\s+connection/i);
      if (mAre) {
        const names = mAre[1].split(/,|\band\b/).filter(s => s.trim().length > 0);
        result.mutual_connections = names.length;
        return;
      }

      // "RAJVI is a mutual connection" — single named person, no number
      const mIs = txt.match(/^(.+?)\s+is\s+a\s+mutual\s+connection/i);
      if (mIs) {
        result.mutual_connections = 1;
        return;
      }

      // "5 mutual connections" — plain number
      const mPlain = txt.match(/^([\d,]+)\s+mutual/i);
      if (mPlain) {
        result.mutual_connections = parseNum(mPlain[1]);
        return;
      }
    }

    // ── Strategy 2: raw HTML scan ─────────────────────────────────────────────
    const html = document.documentElement.outerHTML;
    const m = html.match(/and\s+([\d,]+)\s+other\s+mutual/i)
           || html.match(/"mutualConnectionsCount"\s*:\s*(\d+)/i)
           || html.match(/"mutualConnection"\s*:\s*(\d+)/i)
           || html.match(/"mutualCount"\s*:\s*(\d+)/i)
           || html.match(/(\d+)\s+mutual\s+connection/i)
           || html.match(/>(\d+)\s+mutual/i)
           || html.match(/\bis\s+a\s+mutual\s+connection\b/i);
    if (m) {
      result.mutual_connections = parseNum(m[1]);
      // "is a mutual connection" pattern has no number — count is 1
      if (isNaN(result.mutual_connections) && /is a mutual connection/i.test(m[0])) {
        result.mutual_connections = 1;
      }
      return;
    }

    // ── Strategy 3: body innerText scan (resilient to text changes) ──────────
    const bodyText = document.body.innerText;
    // Find all lines containing "mutual" in the body text
    for (const line of bodyText.split("\n")) {
      if (!/mutual/i.test(line)) continue;
      // Try all patterns on this line
      let match;
      // "and 8 other mutual connections" → number
      if (match = line.match(/and\s+([\d,]+)\s+other\s+mutual/i)) {
        const namedPart = line.split(/\s+and\s+[\d,]+\s+other/i)[0] || "";
        const namedCount = namedPart.split(",").filter(s => s.trim().length > 0).length;
        result.mutual_connections = namedCount + parseNum(match[1]);
        return;
      }
      // "5 mutual connections" → number
      if (match = line.match(/(\d+)\s+mutual\s+connection/i)) {
        result.mutual_connections = parseNum(match[1]);
        return;
      }
      // "X and Y are mutual connections" → count names
      if (match = line.match(/^(.+?)\s+are\s+mutual\s+connection/i)) {
        const names = match[1].split(/,|\band\b/).filter(s => s.trim().length > 0);
        result.mutual_connections = names.length;
        return;
      }
      // "X is a mutual connection" → 1
      if (match = line.match(/\bis\s+a\s+mutual\s+connection\b/i)) {
        result.mutual_connections = 1;
        return;
      }
      // Fallback: any line mentioning "mutual connection" → assume at least 1
      if (/\bmutual\s+connection\b/i.test(line)) {
        result.mutual_connections = 1;
        return;
      }
    }
  })();

  // Avatar — pick the largest profile-displayphoto (owner's photo, not a mutual connection's thumbnail)
  let bestAvatar = "", bestSize = 0;
  for (const img of document.querySelectorAll("img")) {
    if (!(img.src || "").includes("profile-displayphoto")) continue;
    const size = (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
    if (size > bestSize) { bestSize = size; bestAvatar = img.src; }
  }
  // Fallback: if sizes are all 0 (not yet loaded), take the first one inside the top profile section
  if (!bestAvatar) {
    const topImg = document.querySelector("main section img[src*='profile-displayphoto']");
    bestAvatar = topImg ? topImg.src : "";
  }
  result.avatar = bestAvatar;

  const mainEl = document.querySelector("main") || document;
  const nameEl = mainEl.querySelector("h1") || document.querySelector("h1");
  if (nameEl) {
    result.name = (nameEl.innerText || nameEl.textContent || "").trim()
      .replace(/\s*\([^)]*\)\s*$/g, "").trim() || "Unknown";
  }

  // ── Headline: the tagline under the name (kept behind the scenes for scoring) ──
  const blocked = /notification|connection|follower|about|activity|message|invitation|search|for business/i;
  const rawHeadline = txt => {
    const t = (txt || "").split("\n")[0].trim();
    if (t.length <= 2 || t.length >= 200) return "";
    if (blocked.test(t)) return "";
    if (result.name && t === result.name) return "";
    if (/^linkedin$/i.test(t)) return "";
    return t;
  };

  // Headline sits right under the name in the intro card:
  // take the first valid line that appears AFTER the name in the DOM
  if (nameEl) {
    const cands = [...mainEl.querySelectorAll(
      '[class*="text-body-medium"], [class*="break-words"], [class*="inline-show-more"], [class*="headline"]')];
    for (const el of cands) {
      if (!(nameEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const t = rawHeadline(el.innerText);
      if (t) { result.headline = t; break; }
    }
  }
  // Fallbacks: an h2-based element inside main, then the page title
  if (!result.headline) {
    const headlineEl = mainEl.querySelector('[class*="headline"]') || mainEl.querySelector("h2");
    result.headline = rawHeadline(headlineEl && headlineEl.innerText);
  }
  if (!result.headline) {
    // "Name - Position | LinkedIn"  or  "Name | Position | LinkedIn"
    const parts = document.title.split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1])) {
      result.headline = rawHeadline(parts.slice(1, -1).join(", "));
    }
    if (!result.headline) {
      const titleMatch = document.title.match(/—\s*(.+?)\s*\|/);
      if (titleMatch) result.headline = rawHeadline(titleMatch[1]);
    }
  }

  const allSections = [...document.querySelectorAll("section")].filter(s => !s.closest("#li-ai-panel"));

  const profileCardSection = allSections.find((s, i) => {
    const h2text = (s.querySelector("h2")?.innerText || "").trim();
    const isUI = /activity|about|featured|people|might|experience|education|skill|recommendation/i.test(h2text);
    return h2text.length > 2 && !isUI && i >= 1;
  });
  if (profileCardSection) {
    const cardLines = (profileCardSection.innerText || "").split("\n").map(l => l.trim()).filter(l => l.length > 1);
    for (const line of cardLines) {
      if (line.length > 3 && line.length < 80 &&
          (line.includes(",") || /(india|usa|uk|canada|australia|germany|singapore|remote|area)/i.test(line))) {
        result.country = line; break;
      }
    }
  }

  const aboutSection = allSections.find(s => (s.querySelector("h2")?.innerText || "").trim() === "About");
  if (aboutSection) {
    const clone = aboutSection.cloneNode(true);
    clone.querySelectorAll("h2, button, svg, #li-ai-panel").forEach(el => el.remove());
    result.about = (clone.innerText || "").replace(/^About\s*/i, "").replace(/\s{3,}/g, " ").trim() || "Not specified";
  }

  const expSection = allSections.find(s => (s.querySelector("h2")?.innerText || "").trim() === "Experience");
  if (expSection) {
    const liItems = expSection.querySelectorAll("li");
    const expTitles = [];
    for (const li of liItems) {
      const clone = li.cloneNode(true);
      clone.querySelectorAll("button, svg, ul").forEach(el => el.remove());
      const lines = (clone.innerText || "").split("\n").map(l => l.trim()).filter(l => l);
      if (lines[0] && lines[0].length > 2) expTitles.push(lines[0]);
    }
    if (expTitles.length) {
      // Full Experience string (was previously only available from Apify)
      result.experience = expTitles.slice(0, 10).join(" | ");
      const expText = expTitles[0];
      result.current_company = expText.includes(" at ")
        ? expText.split(" at ").slice(-1)[0].trim()
        : expText;
      // "Headline / Position" = current job title from the top Experience entry.
      // Skip lines that are clearly not a title (e.g. lines containing years).
      const looksLikeTitle =
        expText && expText.length <= 120 && !/\b(19|20)\d{2}\b/.test(expText);
      if (looksLikeTitle) result.position = expText;
    }
  }
  // No usable Experience entry → fall back to the LinkedIn headline
  if (!result.position) result.position = result.headline;
  if (!result.current_company) result.current_company = "Not specified";

  const eduSection = allSections.find(s => (s.querySelector("h2")?.innerText || "").trim() === "Education");
  if (eduSection) {
    const eduList = [];
    for (const li of eduSection.querySelectorAll("li")) {
      const clone = li.cloneNode(true);
      clone.querySelectorAll("button, svg, ul").forEach(el => el.remove());
      const txt = (clone.innerText || "").split("\n")[0]?.trim() || "";
      if (txt.length > 2) eduList.push(txt);
    }
    result.education = eduList.join(" | ") || "Not specified";
  }
  if (!result.education) result.education = "Not specified";

  const skillSection = allSections.find(s => (s.querySelector("h2")?.innerText || "").trim() === "Skills");
  if (skillSection) {
    const skillList = [];
    for (const li of skillSection.querySelectorAll("li")) {
      const clone = li.cloneNode(true);
      clone.querySelectorAll("button, svg, ul").forEach(el => el.remove());
      const txt = (clone.innerText || "").split("\n")[0]?.trim() || "";
      if (txt.length > 1 && txt.length < 100) skillList.push(txt);
    }
    result.skills = skillList.slice(0, 15).join(" • ") || "Not specified";
  }
  if (!result.skills) result.skills = "Not specified";

  const projSection = allSections.find(s => (s.querySelector("h2")?.innerText || "").trim() === "Projects");
  if (projSection) {
    const projList = [];
    for (const li of projSection.querySelectorAll("li")) {
      const clone = li.cloneNode(true);
      clone.querySelectorAll("button, svg, ul").forEach(el => el.remove());
      const txt = (clone.innerText || "").split("\n")[0]?.trim() || "";
      if (txt.length > 2) projList.push(txt);
    }
    result.projects = projList.join(" | ") || "No projects";
  }
  if (!result.projects) result.projects = "No projects";

  const actSection = allSections.find(s => (s.querySelector("h2")?.innerText || "").trim() === "Activity");
  if (actSection) {
    const fullText = actSection.innerText || "";
    // The section lists several items (posts, comments, reposts) — take the NEWEST
    // time on it, not the first one, and read LinkedIn's compact "3d • / 2w • / 1mo •".
    result.activity = newestActivityText(fullText);
    if (!result.activity) {
      result.activity = fullText.toLowerCase().includes("posted") ? "Posted recently"
        : fullText.length > 200 ? "Has recent activity"
        : "No recent activity";
    }
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
      --li-blue:#0a66c2; --li-green:#059669; --li-purple:#7c3aed;
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
      --li-blue:#6cb1ff; --li-green:#45c08b; --li-purple:#a78bfa;
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
    .li-sig-share{flex-shrink:0;padding:1px 8px;border-radius:999px;background:rgba(10,102,194,.1);color:var(--li-blue);font-size:11px!important;font-weight:700;font-variant-numeric:tabular-nums;}
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
    .li-cs-tab.active-casual{border-color:var(--li-purple);background:var(--li-purple);color:#fff;}
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
    .li-ai-mini.on{border-color:var(--li-purple);background:var(--li-purple);color:#fff;}
    .li-ai-close{background:none;border:none;color:var(--li-muted-2);font-size:16px!important;cursor:pointer;line-height:1;padding:0 2px;}
    .li-ai-close:hover{color:var(--li-fg);}
    .li-ai-ctx{font-size:11px!important;color:var(--li-muted-2);padding:0 12px 6px 12px;}
    .li-ai-sug{border:1px solid var(--li-border);border-radius:8px;padding:9px 12px;margin:0 10px 8px 10px;font-size:12.5px!important;line-height:1.5;color:var(--li-fg-2);cursor:pointer;background:var(--li-bg);}
    .li-ai-sug:hover{border-color:var(--li-purple);background:var(--li-surface);}

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
function isProfilePage() { return /linkedin\.com\/in\//i.test(window.location.href); }

function findActionTarget() {
  const selectors = [
    '[class*="pv-s-profile-actions"]',
    '[class*="profile-actions"]',
    '[class*="profile-card-actions"]',
    '[data-view-name*="profile"]',
    'main .ph5:not([class*="profile"])',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const btn = el.querySelector('button, a[role="button"]');
      if (btn) return btn;
      return el;
    }
  }
  const allBtns = [...document.querySelectorAll('main button, main a[role="button"]')];
  const moreBtn    = allBtns.find(el => (el.innerText || "").trim().toLowerCase().includes("more"));
  const messageBtn = allBtns.find(el => (el.innerText || "").trim().toLowerCase().includes("message"));
  const openToBtn  = allBtns.find(el => (el.innerText || "").trim().toLowerCase().includes("open to"));
  return moreBtn || messageBtn || openToBtn || allBtns[0] || null;
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

// ─── Stored scores: one press calculates AND keeps the result per profile ─────
function scoreStoreKey() {
  return "liScore:" + window.location.href.split("?")[0];
}

function loadStoredScores() {
  return new Promise(resolve => {
    try {
      const key = scoreStoreKey();
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], r => resolve((r && r[key]) || {}));
      } else {
        resolve(JSON.parse(localStorage.getItem(key) || "{}"));
      }
    } catch (e) { resolve({}); }
  });
}

function saveStoredScore(kind, data) {
  loadStoredScores().then(all => {
    all[kind] = { data, savedAt: Date.now() };
    try {
      const key = scoreStoreKey();
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [key]: all });
      } else {
        localStorage.setItem(key, JSON.stringify(all));
      }
    } catch (e) { /* storage unavailable — score still displayed */ }
  });
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
function apiFetch(path, body) {
  return new Promise((resolve, reject) => {
    const reloaded = () => reject(new Error("Extension was reloaded — refresh this LinkedIn tab"));
    try {
      if (!chrome.runtime || !chrome.runtime.id) return reloaded();
      chrome.runtime.sendMessage({ type: "li-api", path, method: body === undefined ? "GET" : "POST", body }, (res) => {
        if (chrome.runtime.lastError || !res) return reloaded();
        if (res.error) return reject(new Error(res.error));
        if (!res.ok) {
          const d = res.data && res.data.detail;
          return reject(new Error(typeof d === "string" ? d : d ? JSON.stringify(d).slice(0, 200) : `Server error ${res.status}`));
        }
        resolve(res.data);
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

// ─── Activity Score: form with the details used by scoring_service.py ─────────
// Points: `def` = default max points, `ptsKey` = key in activity_points.json.
// The number on each field is editable; the rule (tooltip) scales with it.
const ptsOf = (p, part, of) => Math.round((p * part) / of);
const ACTIVITY_FIELDS = [
  { key: "position",           label: "Headline / Position",   type: "text", ptsKey: "signals", def: 10,
    rule: (p) => `Hiring/growth signals (also read from About and recent posts): hiring words ${ptsOf(p, 5, 10)} · job openings ${ptsOf(p, 3, 10)} · growth news ${ptsOf(p, 2, 10)}` },
  { key: "activity",           label: "Recent Activity",       type: "text", hint: 'e.g. "Posted 2 weeks ago"', ptsKey: "recent_activity", def: 30,
    rule: (p) => `Last post within 7 days = ${p} · within 30 days = ${ptsOf(p, 15, 30)} · within 90 days = ${ptsOf(p, 5, 30)}` },
  { key: "posts_30_days",      label: "Posts in Last 30 Days", type: "number", hint: "blank = count from Apify", ptsKey: "posts_30_days", def: 10,
    rule: (p) => `4 or more posts in the last 30 days = ${p}` },
  { key: "posts_90_days",      label: "Posts in Last 90 Days", type: "number", hint: "blank = count from Apify", ptsKey: "posts_90_days", def: 10,
    rule: (p) => `10 or more posts in the last 90 days = ${p}` },
  { key: "avg_likes",          label: "Avg Likes / Post",      type: "number", hint: "blank = Apify average", ptsKey: "avg_likes", def: 5,
    rule: (p) => `10 or more likes per post = ${p}` },
  { key: "avg_comments",       label: "Avg Comments / Post",   type: "number", hint: "blank = Apify average", ptsKey: "avg_comments", def: 10,
    rule: (p) => `5 or more comments per post = ${p}` },
  { key: "avg_reposts",        label: "Avg Reposts / Post",    type: "number", hint: "blank = Apify average", ptsKey: "avg_reposts", def: 5,
    rule: (p) => `3 or more reposts per post = ${p}` },
  { key: "mutual_connections", label: "Mutual Connections",    type: "number", ptsKey: "mutual_connections", def: 10,
    rule: (p) => `10+ mutual = ${p} · 5+ = ${ptsOf(p, 5, 10)} · 1+ = ${ptsOf(p, 2, 10)}` },
];
// Scored from the page (no form field), but its points are editable too
const ACTIVITY_COMPLETENESS = { label: "Profile Completeness", ptsKey: "completeness", def: 10,
  rule: (p) => `Read from the page: headline, About, experience, skills and photo — ${+(p / 5).toFixed(1)} each` };
const ACTIVITY_POINT_DEFS = [...ACTIVITY_FIELDS, ACTIVITY_COMPLETENESS];

// Hiring / growth signal keywords (activity_keywords.json). Each list earns its
// share of the Headline / Position (signals) points when found in the headline,
// About or the newest posts.
const SIGNAL_KW_FIELDS = [
  { key: "hiring", label: "Hiring words", share: 50 },
  { key: "job",    label: "Job-opening words", share: 30 },
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

function openActivityForm() {
  createPanel({
    id: "li-ai-panel", btnId: "li-ai-analyze-btn", title: "⚡ Activity Score",
    bodyId: "li-ai-body", closeId: "li-ai-close",
  });

  const p    = scrapeProfile();
  const body = document.getElementById("li-ai-body");
  body.innerHTML = `
    <div class="li-form-note">
      Sent to <code>/analyze</code> and scored by <code>services/scoring_service.py</code>.
      Name, About, Company, Education, Skills and Projects come from the page automatically.
      Click a points number to change how much that field counts.
    </div>
    <form id="li-activity-form" class="li-form-grid">
      ${ACTIVITY_FIELDS.map(f => activityFieldHTML(f, formValue(f.key, p[f.key]))).join("")}
      <input type="hidden" id="li-f-profile_url" value="${escAttr(p.profileUrl)}">
      <input type="hidden" id="li-f-avatar" value="${escAttr(p.avatar)}">
      <input type="hidden" id="li-f-headline" value="${escAttr(p.headline)}">
      ${signalKeywordsHTML()}
    </form>
    ${ptsTotalHTML("li-ai-pts-total", `<span class="li-pts-extra">Profile Completeness <span>from the page</span> ${ptsPillHTML(ACTIVITY_COMPLETENESS, "blue")}</span>`)}
    <div class="li-form-status" id="li-ai-status"></div>
    <div class="li-form-actions">
      <button type="button" class="li-btn li-btn-ghost" id="li-ai-refresh">🔄 Refresh from Page</button>
      <button type="button" class="li-btn li-btn-blue" id="li-ai-calc">📊 Calculate Score</button>
    </div>
  `;

  document.getElementById("li-activity-form").addEventListener("submit", e => e.preventDefault());
  const refreshActPts = wirePoints(body, ACTIVITY_POINT_DEFS, document.getElementById("li-ai-pts-total"), ACTIVITY_TOTAL,
    () => setActivityStatus("Points changed — press Calculate Score to use them."));
  apiFetch("/activity-points").then((pts) => { setPoints(body, pts); refreshActPts(); refreshSignalShares(body); }).catch(() => {});
  wireChipEditors(body, "li-sig", () => setActivityStatus("Keywords changed — press Calculate Score to use them."));
  body.addEventListener("input", (e) => { if (e.target.closest('.li-pts-in[data-pts="signals"]')) refreshSignalShares(body); });
  body.querySelector(".li-pts-reset")?.addEventListener("click", () => refreshSignalShares(body));
  SIGNAL_KW_FIELDS.forEach((f) => renderChips("li-sig", f.key));
  refreshSignalShares(body);
  apiFetch("/activity-keywords").then((lists) => setKwLists("li-sig", lists)).catch(() => {});
  document.getElementById("li-ai-refresh").onclick = openActivityForm;
  document.getElementById("li-ai-calc").onclick    = calculateActivityScore;

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

async function calculateActivityScore() {
  const value  = key => document.getElementById(`li-f-${key}`)?.value ?? "";
  const btn    = document.getElementById("li-ai-calc");
  const p      = scrapeProfile();   // details no longer shown in the form
  const payload = {
    profile_url:        value("profile_url"),
    profileUrl:         value("profile_url"),
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
    country:            value("country")  || p.country,
    activity:           value("activity"),
    posts_30_days:      parseInt(value("posts_30_days"), 10)   || 0,
    posts_90_days:      parseInt(value("posts_90_days"), 10)   || 0,
    avg_likes:          parseFloat(value("avg_likes"))         || 0,
    avg_comments:       parseFloat(value("avg_comments"))      || 0,
    avg_reposts:        parseFloat(value("avg_reposts"))       || 0,
    mutual_connections: parseInt(value("mutual_connections"), 10) || 0,
  };

  btn.disabled = true;
  btn.textContent = "⏳ Calculating...";
  setActivityStatus("Scoring profile activity...");

  try {
    // Save the points first: the server scores every factor with them
    await apiFetch("/activity-points", readPoints(document.getElementById("li-ai-body")));
    await apiFetch("/activity-keywords", collectSignalKeywords());
    const data = await apiFetch("/analyze", payload);
    renderPanel(data);
    saveStoredScore("activity", data);
    updateLead(p.profileUrl, data.name || p.name, {
      headline: data.headline || p.headline || "",
      company: (data.current_company && data.current_company !== "Not specified") ? data.current_company : (p.current_company || ""),
      activityScore: data.score_total || 0,
      activityLabel: data.score_label || "",
    });
  } catch (err) {
    console.error("[LI-AI] ❌", err);
    const status = document.getElementById("li-ai-status");
    if (status) status.innerHTML = `❌ <strong>${escHtml(err.message)}</strong> — is the server running? Start it with <code>run_server.bat</code> (port 8765)`;
    btn.disabled = false;
    btn.textContent = "📊 Calculate Score";
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
  wireChipEditors(form, "li-icp", () => setIcpStatus("Unsaved changes — press Save Keywords or Calculate ICP Score."));
}

async function openIcpForm() {
  createPanel({
    id: "li-icp-panel", btnId: "li-icp-btn", title: "🎯 ICP Score",
    headerColor: "#059669", bodyId: "li-icp-body", closeId: "li-icp-close",
  });

  const body = document.getElementById("li-icp-body");
  body.innerHTML = `
    <form id="li-icp-form" class="li-form-grid">
      ${ICP_FIELDS.map(icpFieldHTML).join("")}
    </form>
    ${ptsTotalHTML("li-icp-pts-total")}
    <div class="li-form-status" id="li-icp-status">Loading saved keywords…</div>
    <div class="li-form-actions">
      <button type="button" class="li-btn li-btn-ghost" id="li-icp-save">💾 Save Keywords</button>
      <button type="button" class="li-btn li-btn-green" id="li-icp-calc">🎯 Calculate ICP Score</button>
    </div>
  `;

  const icpForm = document.getElementById("li-icp-form");
  icpForm.addEventListener("submit", e => e.preventDefault());
  wireIcpChipEditors(icpForm);
  ICP_FIELDS.forEach((f) => renderIcpChips(f.key));
  const refreshIcpPts = wirePoints(body, ICP_FIELDS, document.getElementById("li-icp-pts-total"), ICP_TOTAL,
    () => setIcpStatus("Unsaved changes — press Save Keywords or Calculate ICP Score."));
  document.getElementById("li-icp-save").onclick = async () => {
    try {
      const saved = await saveIcpKeywords();
      setIcpStatus(`✅ Saved ${countKeywords(saved)} keywords to icp_config.json`);
    } catch (err) {
      setIcpStatus(`❌ ${err.message} — is the server running? Start it with <code>run_server.bat</code> (port 8765)`);
    }
  };
  document.getElementById("li-icp-calc").onclick = calculateIcpScore;

  try {
    const config = await apiFetch("/icp-config");
    for (const f of ICP_FIELDS) {
      const el = document.getElementById(`li-icp-${f.key}`);
      if (el) el.value = (config[f.key] || []).join("\n");
      renderIcpChips(f.key);
    }
    setPoints(body, config.POINTS);
    refreshIcpPts();
    setIcpStatus(`Loaded ${countKeywords(config)} saved keywords.`);
  } catch (err) {
    setIcpStatus(`⚠️ Could not load saved keywords (${err.message}) — type them in and press Save.`);
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
  return Object.values(config).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
}

async function saveIcpKeywords() {
  return apiFetch("/icp-config", collectIcpKeywords());
}

async function calculateIcpScore() {
  const btn     = document.getElementById("li-icp-calc");
  const saveBtn = document.getElementById("li-icp-save");
  btn.disabled = true;
  saveBtn.disabled = true;
  btn.textContent = "⏳ Calculating...";

  try {
    const saved = await saveIcpKeywords();
    setIcpStatus(`✅ Saved ${countKeywords(saved)} keywords — scoring...`);

    const p    = scrapeProfile();
    const result = await apiFetch("/icp-score", {
      name:                 p.name,
      country:              p.country,
      position:             p.position,
      about:                p.about,
      current_company_name: p.current_company,
      current_company:      p.current_company,
      profile_url:          p.profileUrl,
      profileUrl:           p.profileUrl,
    });
    const kCount   = countKeywords(saved);
    renderIcpResult(result, kCount);
    saveStoredScore("icp", { result, keywordCount: kCount });
    updateLead(p.profileUrl, p.name, {
      headline: p.headline || "",
      company: (p.current_company && p.current_company !== "Not specified") ? p.current_company : "",
      icpScore: result.icp_score || 0,
    });
  } catch (err) {
    setIcpStatus(`❌ ${err.message}`);
    btn.disabled = false;
    saveBtn.disabled = false;
    btn.textContent = "🎯 Calculate ICP Score";
  }
}

function renderIcpResult(result, keywordCount, storedAt) {
  applyTheme();
  const rows = Object.entries(result.breakdown || {}).map(([label, data]) => {
    const pct   = data.max ? Math.round((data.score / data.max) * 100) : 0;
    const color = data.score === data.max ? "var(--li-green)" : data.score > 0 ? "var(--li-blue)" : "var(--li-track)";
    const textColor = data.score > 0 ? color : "var(--li-muted)";   // track grey is invisible as text
    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:500;color:var(--li-fg-2);">${escHtml(label)}</span>
          <span style="font-size:13px;font-weight:700;color:${textColor};font-variant-numeric:tabular-nums;">${data.score}/${data.max}</span>
        </div>
        <div style="height:6px;background:var(--li-track);border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
        </div>
        <div style="font-size:11px;color:var(--li-muted);margin-top:3px;">${escHtml(data.reason || "")}</div>
      </div>`;
  }).join("");

  const score = result.icp_score || 0;
  const color = score >= 70 ? "var(--li-green)" : score >= 40 ? "var(--li-warn)" : "var(--li-bad)";

  document.getElementById("li-icp-body").innerHTML = `
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
    <div style="border-top:1px solid var(--li-border);padding-top:14px;">
      ${rows}
    </div>
  `;
  document.getElementById("li-icp-edit").onclick = openIcpForm;
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
function renderPanel(data, storedAt) {
  applyTheme();
  const name            = data.name            || "Unknown";
  const country         = data.country         || "Not specified";
  const current_company = data.current_company || "Not specified";
  const position        = (/notification|follower|connection/i.test(data.position || "") ? "" : data.position) || "";
  const activity        = data.activity        || "No activity data";
  const activity_url    = data.activity_url    || "";

  let score_total        = data.score_total        || 0;
  let score_label        = data.score_label        ||
    (score_total >= 70 ? "🟢 Ready to Engage" : score_total >= 40 ? "🟡 Needs Nurturing" : "🔴 Difficult to Engage");
  let score_activity     = data.score_activity     || 0;
  let score_posts        = data.score_posts        || 0;
  let score_engagement   = data.score_engagement   || 0;
  let score_completeness = data.score_completeness || 0;
  let score_signals      = data.score_signals      || 0;
  let score_mutuals      = data.score_mutuals      || 0;
  const avg_engagement   = data.avg_engagement     || 0;
  const posts_30_days    = data.posts_30_days      || 0;
  const posts_90_days    = data.posts_90_days      || 0;
  const engagement_label = data.engagement_label   || "No data";
  const mutual_count     = data.mutual_connections  || 0;

  // Server-side maxima (editable points); older stored scores use the defaults
  const max = {
    activity: data.max_activity ?? 30, posts: data.max_posts ?? 20, engagement: data.max_engagement ?? 20,
    completeness: data.max_completeness ?? 10, signals: data.max_signals ?? 10, mutuals: data.max_mutuals ?? 10,
  };
  const sig = (v) => Math.round((v * max.signals) / 10);   // 5 / 3 / 2 on the default 10-point scale

  // Re-check signals from page-scraped text (more accurate since user is logged in)
  const positionText = (data.position || "").toLowerCase();
  const aboutText    = (data.about    || "").toLowerCase();
  let signalsFixed   = score_signals;
  const sk           = data.signal_keywords || {};
  const lc           = (list) => list.map((k) => String(k).toLowerCase());
  const hiringKw     = lc(sk.hiring || ["hiring", "we're hiring", "join our team", "open roles"]);
  const promoKw      = lc(sk.job    || ["promoted", "new role", "excited to announce"]);
  const growthKw     = lc(sk.growth || ["growing", "we raised", "series a", "series b", "funded"]);
  for (const kw of hiringKw) {
    if (positionText.includes(kw) || aboutText.includes(kw)) { signalsFixed = Math.max(signalsFixed, sig(5)); break; }
  }
  for (const kw of promoKw) {
    if (positionText.includes(kw) || aboutText.includes(kw)) { signalsFixed = Math.max(signalsFixed, sig(3)); break; }
  }
  for (const kw of growthKw) {
    if (positionText.includes(kw) || aboutText.includes(kw)) { signalsFixed = Math.max(signalsFixed, sig(2)); break; }
  }
  if (signalsFixed !== score_signals) {
    score_signals = signalsFixed;
    const maxTotal = data.score_max || Object.values(max).reduce((a, b) => a + b, 0);
    const raw = score_activity + score_posts + score_engagement + score_completeness + score_signals + score_mutuals;
    score_total   = maxTotal ? Math.round((raw * 100) / maxTotal) : 0;
    score_label   = score_total >= 70 ? "🟢 Ready to Engage" : score_total >= 40 ? "🟡 Needs Nurturing" : "🔴 Difficult to Engage";
  }

  // Colors
  let scoreColor = "var(--li-bad)";
  if (score_total >= 70) scoreColor = "var(--li-ok)";
  else if (score_total >= 40) scoreColor = "var(--li-warn)";

  // Activity HTML
  let activityHTML = escHtml(activity);
  if (activity_url) {
    activityHTML = `<a href="${escHtml(activity_url)}" target="_blank" style="color:var(--li-blue);text-decoration:none;font-weight:600;">${escHtml(activity)} 🔗</a>`;
  } else if (activity.includes("ago") || activity.toLowerCase().includes("today") || activity.toLowerCase().includes("yesterday")) {
    activityHTML = `<strong style="color:var(--li-ok);">⏱️ ${escHtml(activity)}</strong>`;
  } else if (activity.toLowerCase().includes("recent")) {
    activityHTML = `<strong style="color:var(--li-warn);">⏱️ ${escHtml(activity)}</strong>`;
  }

  // Score breakdown rows
  const scoreRows = [
    { label: "Recent Activity",    score: score_activity,     max: max.activity, detail: "" },
    { label: "Posting Frequency",  score: score_posts,        max: max.posts, detail: `${posts_30_days} posts / 30d - ${posts_90_days} posts / 90d` },
    { label: "Engagement Level",   score: score_engagement,   max: max.engagement, detail: engagement_label },
    { label: "Profile Completeness", score: score_completeness, max: max.completeness, detail: "" },
    { label: "Hiring/Growth Signals", score: score_signals,   max: max.signals, detail: "" },
    { label: "Mutual Connections", score: score_mutuals,      max: max.mutuals, detail: `${mutual_count} mutual` },
  ];

  const scoreRowsHTML = scoreRows.map(row => {
    const pct   = row.max ? Math.round((row.score / row.max) * 100) : 0;
    const color = row.score === row.max ? "var(--li-ok)" : row.score > 0 ? "var(--li-blue)" : "var(--li-track)";
    const textColor = row.score > 0 ? color : "var(--li-muted)";   // track grey is invisible as text
    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:500;color:var(--li-fg-2);">${escHtml(row.label)}</span>
          <span style="font-size:13px;font-weight:700;color:${textColor};font-variant-numeric:tabular-nums;">${row.score}/${row.max}</span>
        </div>
        <div style="height:6px;background:var(--li-track);border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
        </div>
        ${row.detail ? `<div style="font-size:11px;color:var(--li-muted);margin-top:3px;">${escHtml(row.detail)}</div>` : ""}
      </div>
    `;
  }).join("");

  document.getElementById("li-ai-body").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div>
        <div style="font-size:17px;font-weight:700;color:var(--li-fg);">${escHtml(name)}</div>
        <div style="font-size:12px;color:var(--li-muted);">${escHtml([current_company, country].filter(v => v && v !== "Not specified").join(" • "))}</div>
      </div>
      <button type="button" class="li-btn li-btn-ghost" id="li-ai-edit">✏️ Edit Details</button>
    </div>
    ${data.scrape_warning ? `<div class="li-form-note" style="border-color:var(--li-warn-border);background:var(--li-warn-bg);color:var(--li-warn-fg);">⚠️ ${escHtml(data.scrape_warning)}</div>` : ""}
    ${storedAt ? `<div class="li-form-note">💾 Stored score from <strong>${escHtml(fmtSavedAt(storedAt))}</strong> — press <strong>Edit Details</strong> to calculate a fresh one.</div>` : ""}


    <!-- Outreach Readiness Score -->
    <div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div style="font-size:40px;font-weight:800;color:${scoreColor};line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;">${score_total}</div>
        <div>
          <div style="font-size:11px;color:var(--li-muted);">out of 100</div>
          <div style="font-size:16px;color:var(--li-fg);font-weight:700;margin-top:2px;">${escHtml(score_label)}</div>
        </div>
      </div>
      <div style="border-top:1px solid var(--li-border);padding-top:14px;">
        ${scoreRowsHTML}
      </div>
    </div>
  `;
  document.getElementById("li-ai-edit").onclick = openActivityForm;
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
const AI_MINI_CSS = "padding:3px 10px;border:1px solid var(--li-border-2,#cbd5e1);border-radius:999px;background:var(--li-input-bg,#fff);color:var(--li-fg-2,#374151);font-size:11px;font-weight:700;cursor:pointer;";

// ✨ popup analyses exactly this many recent chat messages.
const AI_HISTORY_LIMIT = 5;

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
      name = inviteFullName(ed);
      url = inviteProfileUrl(name);
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
      ...aiProfileContext(req.first),
    });
    const list = (data.suggestions || []).filter((s) => typeof s === "string" && s.trim());
    if (!list.length) throw new Error("no suggestions returned");
    entry = { list, pain: data.pain_point || "", painSource: data.pain_source || "" };
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
    box.style.position = "fixed";
    box.style.width = w + "px";
    // horizontally CENTERED over the message box, clamped inside the viewport
    const centerX = r.left + (r.width - w) / 2;
    box.style.left = Math.round(Math.max(8, Math.min(centerX, vw - w - 8))) + "px";
    box.style.overflowY = "auto";
    box.style.zIndex = "99999";
    box.style.top = ""; box.style.bottom = ""; box.style.maxHeight = "";

    // bottom edge sits just ABOVE the send button (bottom-right corner of the box)
    let anchorY = opts.above ? r.top - 4 : r.bottom - 8;
    if (!opts.above) {
      try {
        const send = el.querySelector('.msg-form__send-btn, .msg-form__send-button, button[type="submit"], .artdeco-button--circle');
        if (send) { const sr = send.getBoundingClientRect(); if (sr.height) anchorY = sr.bottom - 4; }   // ~36px lower
      } catch (e) { /* ignore */ }
    }

    const need = box.offsetHeight || 220;          // natural height after paint()
    const maxH = Math.round(vh * 0.48);
    const spaceAbove = anchorY - 8;                // anchor → viewport top
    const spaceBelow = vh - anchorY - 8;           // anchor → viewport bottom

    if (spaceAbove >= Math.min(need, 200)) {
      // grow upward from the send button, never past the top of the screen
      box.style.bottom = Math.round(vh - anchorY) + "px";
      box.style.maxHeight = Math.max(140, Math.min(maxH, spaceAbove - 8)) + "px";
    } else if (spaceBelow >= Math.min(need, 200)) {
      // no room above → drop below the anchor instead
      box.style.top = Math.round(anchorY + 8) + "px";
      box.style.maxHeight = Math.min(spaceBelow, maxH) + "px";
    } else if (spaceAbove >= spaceBelow) {
      // squeeze between the top of the screen and the anchor:
      // top + bottom both set → exact fit, header row stays visible, body scrolls
      box.style.top = "8px";
      box.style.bottom = Math.round(vh - anchorY) + "px";
      box.style.maxHeight = "none";
    } else {
      box.style.top = Math.round(anchorY + 8) + "px";
      box.style.bottom = "8px";
      box.style.maxHeight = "none";
    }
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

// Drawn icons for the ✨ popup header (one stroke weight, follow text color).
const ICON_REFRESH = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3.2h-3.2"/></svg>';
const ICON_CLOSE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

// opts.context = "invite" → Connect → "Add a note" box (no chat history,
// LinkedIn's own character limit, popup opens above the note box).
function toggleAiPopup(editable, spark, opts) {
  opts = opts || {};
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
  const state = { tone: editable._liTone || "casual", action: "", draft: "", notice: "" };
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
      body = heading + painLine + entry.list.map((s) => '<button type="button" class="li-ai-sug" style="' + AI_ITEM_CSS + '">' + escHtml(s) + "</button>").join("");
    } else if (entry && entry.error) {
      body = '<div role="alert" style="padding:10px 12px;border:1px solid #fca5a5;border-radius:8px;background:rgba(239,68,68,.08);color:var(--li-fg,#111827);font-size:12.5px;line-height:1.45;">' +
        "⚠️ AI unavailable — " + escHtml(entry.error) +
        '<div style="margin-top:8px;"><button type="button" data-act="retry" style="' + AI_MINI_CSS + '">Retry</button></div></div>';
    } else {
      const loading = state.action ? "✍️ Rewriting your draft…"
        : (!n && state.tone === "pro") ? "🔎 Reading their recent posts to find the real pain point… (first time can take up to a minute)"
        : "✨ Generating suggestions…";
      body = '<div role="status" style="padding:14px 12px;font-size:12.5px;color:var(--li-muted,#6b7280);">' + loading + "</div>";
    }
    const draftRow =
      '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:8px 0 2px;font-size:11px;color:var(--li-muted,#6b7280);">' +
      '<span style="margin-right:2px;">Your draft:</span>' +
      DRAFT_ACTIONS.map(([k, label]) => '<button type="button" data-draft="' + k + '" aria-pressed="' + (state.action === k) + '" style="' + AI_MINI_CSS +
        (state.action === k ? "background:#7c3aed;color:#fff;border-color:#7c3aed;" : "") + '">' + label + "</button>").join("") +
      (state.action ? '<button type="button" data-act="back" style="' + AI_MINI_CSS + '">← Suggestions</button>' : "") +
      (state.notice ? '<span role="status" style="flex-basis:100%;color:var(--li-warn-fg,#92400e);margin-top:2px;">' + escHtml(state.notice) + "</span>" : "") +
      "</div>";
    box.innerHTML =
      '<div style="position:sticky;top:-12px;margin:-12px -12px 0;padding:12px 12px 4px;background:var(--li-bg,#fff);display:flex;justify-content:space-between;align-items:center;gap:8px;border-radius:10px 10px 0 0;z-index:2;box-shadow:0 1px 0 var(--li-border,#e5e7eb);">' +
      '<span style="font-size:11px;font-weight:800;letter-spacing:.6px;color:var(--li-blue,#0a66c2);">' + (invite ? "AI NOTE" : "AI SUGGESTIONS") + "</span>" +
      '<span style="display:flex;gap:4px;align-items:center;">' +
      '<button type="button" data-tone="casual" aria-pressed="' + (state.tone === "casual") + '" style="' + AI_MINI_CSS + (state.tone === "casual" ? "background:#7c3aed;color:#fff;border-color:#7c3aed;" : "") + '">Casual</button>' +
      '<button type="button" data-tone="pro" aria-pressed="' + (state.tone === "pro") + '" style="' + AI_MINI_CSS + (state.tone === "pro" ? "background:#0a66c2;color:#fff;border-color:#0a66c2;" : "") + '">Pro</button>' +
      '<button type="button" data-act="refresh" title="Generate new AI suggestions" aria-label="Generate new AI suggestions" style="' + AI_MINI_CSS + 'padding:4px 8px;display:inline-flex;align-items:center;">' + ICON_REFRESH + "</button>" +
      '<button type="button" data-act="close" title="Close" aria-label="Close AI suggestions" style="background:none;border:none;padding:4px;border-radius:6px;cursor:pointer;color:var(--li-muted,#6b7280);display:inline-flex;align-items:center;">' + ICON_CLOSE + "</button>" +
      "</span></div>" +
      draftRow +
      '<div style="height:4px;"></div>' +
      body;
    state.notice = "";
    box.querySelector('[data-act="close"]').onclick = removeBox;
    box.querySelector('[data-act="refresh"]').onclick = (e) => { e.preventDefault(); paint({ force: true }); };
    const retry = box.querySelector('[data-act="retry"]');
    if (retry) retry.onclick = (e) => { e.preventDefault(); paint({ force: true }); };
    const back = box.querySelector('[data-act="back"]');
    if (back) back.onclick = (e) => { e.preventDefault(); state.action = ""; state.draft = ""; paint(); };
    box.querySelectorAll("[data-tone]").forEach((b) => { b.onclick = (e) => { e.preventDefault(); state.tone = b.dataset.tone === "pro" ? "pro" : "casual"; paint(); }; });
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
  };

  // opts.force = drop the cached answer (↻ / Retry); opts.debounce = live refresh,
  // wait for the thread to settle so a burst of DOM mutations = one request.
  const paint = (opts) => {
    opts = opts || {};
    const history = invite ? [] : scrapeChatMessages(editable, AI_HISTORY_LIMIT);
    const fullName = invite ? inviteFullName(editable) : chatFullName(editable, history);
    const first = invite ? (fullName.split(/\s+/)[0] || "there") : chatFirstName(editable, history);
    editable._liTone = state.tone;
    const histKey = history.map((m) => m.sender + ":" + m.text).join("|");
    box.dataset.histKey = histKey;
    const profileUrl = invite ? inviteProfileUrl(fullName) : chatProfileUrl(editable, first);
    if (editable._liLoggedKey !== histKey) {
      editable._liLoggedKey = histKey;
      try { console.log("[LI-AI] scraped chat history (" + history.length + "):", history.map((m) => "[" + (m.sender || "?") + "] " + m.text)); } catch (e) {}
      noteReplies(history, profileUrl, fullName);
    }
    // Person + mode are part of the key: an empty history ("") must not reuse another chat's openers.
    const act = state.action ? state.action + ":" + state.draft : "";
    const cacheKey = [record.context, first, profileUrl, histKey, state.tone, act].join("|");
    if (opts.force && !record.pending[cacheKey]) delete record.cache[cacheKey];
    record.view = { history, first, cacheKey, tone: state.tone, profileUrl };
    render();
    if (record.cache[cacheKey] || record.pending[cacheKey]) return;
    clearTimeout(record.fetchTimer);
    const req = { history, first, fullName, tone: state.tone, profileUrl, context: record.context, maxChars,
                  draft: state.action ? state.draft : "", action: state.action };
    record.fetchTimer = setTimeout(() => fetchAiSuggestions(record, req, cacheKey, render), opts.debounce ? 1500 : 0);
  };
  record.paint = paint;
  // Persistent popup: clicking anywhere — suggestions, ✨, Send, Enter — never
  // hides it, so you can keep changing tone and picking lines. Only the ×
  // button (or the composer being removed) closes it.
  openSpark.push(record);
  document.body.appendChild(box);
  paint();                      // fill content FIRST so placement measures real height
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
  spark.title = "AI Suggestions — based on last 5 messages";
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
watchTheme();
applyTheme();
setTimeout(() => { addAIButton(); injectComposeSuggestions(); }, 1500);
setInterval(() => { addAIButton(); injectComposeSuggestions(); }, 3000);

let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    document.getElementById("li-ai-analyze-btn")?.remove();
    document.getElementById("li-icp-btn")?.remove();
    document.getElementById("li-ai-panel")?.remove();
    document.getElementById("li-icp-panel")?.remove();
    setTimeout(addAIButton, 1500);
  } else {
    addAIButton();
    injectComposeSuggestions();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

watchSends();

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