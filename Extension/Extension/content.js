// const API_BASE_URL = "http://127.0.0.1:8000";
const API_BASE_URL = "https://linkedin-analyzer-90ne.onrender.com";
// ─── LinkedIn Profile Scraper ──────────────────────────────────────────────────

function scrapeProfile() {
  const result = {
    avatar: "", name: "", position: "", country: "",
    about: "", current_company: "", education: "",
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

  const nameEl = document.querySelector("h1");
  if (nameEl) {
    result.name = (nameEl.innerText || nameEl.textContent || "").trim()
      .replace(/\s*\([^)]*\)\s*$/g, "").trim() || "Unknown";
  }

  const headlineEl = document.querySelector('[class*="text-body-medium"]') ||
                     document.querySelector('[class*="headline"]') ||
                     document.querySelector('[class*="break-words"]') ||
                     document.querySelector('[class*="inline-show-more"]') ||
                     document.querySelector("main h2");
  if (headlineEl) {
    const txt = (headlineEl.innerText || "").trim();
    const blocked = /notification|connection|follower|about|activity|message|invitation/i;
    if (txt.length > 2 && txt.length < 200 && !blocked.test(txt))
      result.position = txt;
  }
  // Fallback: extract from page title "Name — Position | LinkedIn"
  if (!result.position) {
    const titleMatch = document.title.match(/—\s*(.+?)\s*\|/);
    if (titleMatch) result.position = titleMatch[1].trim();
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
    if (liItems.length > 0) {
      const clone = liItems[0].cloneNode(true);
      clone.querySelectorAll("button, svg, ul").forEach(el => el.remove());
      const expText = (clone.innerText || "").split("\n").map(l => l.trim()).filter(l => l)[0] || "";
      result.current_company = expText.includes(" at ")
        ? expText.split(" at ").slice(-1)[0].trim()
        : expText;
    }
  }
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
    const patterns = [
      /Posted\s+(\d+\s*(?:second|minute|hour|day|week|month|year)s?\s*ago)/i,
      /(\d+\s*(?:second|minute|hour|day|week|month|year)s?\s*ago)/i,
    ];
    for (const pattern of patterns) {
      const match = fullText.match(pattern);
      if (match) { result.activity = match[1] || match[0]; break; }
    }
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
    #li-ai-analyze-btn, #li-icp-btn {
      display:inline-flex;align-items:center;justify-content:center;
      gap:6px;padding:0 16px;height:34px;
      border:1.5px solid #0a66c2;border-radius:999px;
      background:#fff;color:#0a66c2;cursor:pointer;
      font-size:13px;font-weight:600;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
      transition:all .15s ease;
      white-space:nowrap;flex-shrink:0;z-index:9999;position:relative;align-self:center;
    }
    #li-ai-analyze-btn:hover{background:#0a66c2;color:#fff;box-shadow:0 2px 8px rgba(10,102,194,.25);}
    #li-icp-btn{border-color:#059669;color:#059669;}
    #li-icp-btn:hover{background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,.25);}
    #li-ai-panel, #li-icp-panel{
      margin:12px 0;border-radius:10px;border:1px solid #e5e7eb;
      background:#fff;box-shadow:0 2px 16px rgba(0,0,0,.06);overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    }
    .panel-header{padding:18px 22px;background:#0a66c2;color:#fff;display:flex;justify-content:space-between;align-items:center;}
    .panel-header span{font-weight:700;font-size:20px!important;letter-spacing:-.2px;}
    .panel-close{background:none;border:none;color:#fff;font-size:24px!important;cursor:pointer;line-height:1;padding:0 4px;opacity:.7;}
    .panel-close:hover{opacity:1;}
    .panel-body{padding:22px;max-height:80vh;overflow-y:auto;font-size:16px!important;}
    .li-profile-card{display:flex;gap:16px;padding:18px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:16px;align-items:flex-start;}
    .li-avatar{width:80px;height:80px;border-radius:999px;object-fit:cover;flex-shrink:0;}
    .li-profile-info{flex:1;}
    .li-name{font-size:22px!important;font-weight:700;color:#111827;margin-bottom:4px;}
    .li-meta{font-size:14px!important;color:#6b7280;margin-bottom:2px;}
    .li-section{margin-bottom:14px;}
    .li-section-title{font-size:11px!important;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;margin-bottom:6px;}
    .li-section-content{font-size:14px!important;color:#374151;line-height:1.6;padding:14px 16px;background:#f9fafb;border-radius:6px;}
    .score-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:600;}
    @keyframes li-spin{to{transform:rotate(360deg);}}
    .panel-body::-webkit-scrollbar{width:5px;}
    .panel-body::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px;}
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

// ─── Buttons ──────────────────────────────────────────────────────────────────
function addAIButton() {
  if (!isProfilePage()) return;
  if (document.getElementById("li-ai-analyze-btn") && document.getElementById("li-icp-btn")) return;
  const anchor = findActionTarget();
  if (!anchor) return;
  injectStyles();

  if (!document.getElementById("li-ai-analyze-btn")) {
    const btn = document.createElement("button");
    btn.id = "li-ai-analyze-btn";
    btn.type = "button";
    btn.textContent = "Activity Score";
    anchor.insertAdjacentElement("afterend", btn);
    btn.addEventListener("click", handleAnalyzeClick);
  }

  if (!document.getElementById("li-icp-btn")) {
    const icpBtn = document.createElement("button");
    icpBtn.id = "li-icp-btn";
    icpBtn.type = "button";
    icpBtn.textContent = "ICP Score";
    const actBtn = document.getElementById("li-ai-analyze-btn");
    (actBtn || anchor).insertAdjacentElement("afterend", icpBtn);
    icpBtn.addEventListener("click", handleIcpClick);
  }
}


// ─── Click Handler ─────────────────────────────────────────────────────────────
async function handleAnalyzeClick() {
  const existing = document.getElementById("li-ai-panel");
  if (existing) { existing.remove(); return; }

  const panel = document.createElement("div");
  panel.id = "li-ai-panel";
  panel.innerHTML = `
    <div class="panel-header">
      <span>⚡ Activity Score</span>
      <button class="panel-close" id="li-ai-close">×</button>
    </div>
    <div class="panel-body" id="li-ai-body">
      <div style="display:flex;flex-direction:column;gap:10px;padding:16px;">
        <div style="display:flex;align-items:center;gap:10px;color:#6b7280;">
          <div style="width:16px;height:16px;border:2.5px solid #e5e7eb;border-top-color:#0a66c2;border-radius:50%;animation:li-spin .7s linear infinite;flex-shrink:0;"></div>
          <span id="li-ai-status">Fetching profile data...</span>
        </div>
       
      </div>
    </div>
  `;

  const btn = document.getElementById("li-ai-analyze-btn");
  const topCard = btn?.closest("section") || btn?.parentElement?.parentElement;
  topCard ? topCard.insertAdjacentElement("afterend", panel) : document.querySelector("main")?.prepend(panel);
  document.getElementById("li-ai-close").onclick = () => panel.remove();

  const setStep = (id, text, done = false) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = `<span style="color:${done ? '#16a34a' : '#0a66c2'}">${done ? '✅' : '🔄'} ${text}</span>`;
  };
  const setStatus = (txt) => {
    const el = document.getElementById("li-ai-status");
    if (el) el.textContent = txt;
  };

  try {
    const profile_url = window.location.href.split("?")[0];
    let pageData = scrapeProfile();

    // Retry mutual connections once if 0 (LinkedIn lazy-loads this section)
    if (!pageData.mutual_connections) {
      await new Promise(r => setTimeout(r, 1500));
      pageData = scrapeProfile();
    }

    setStatus("Fetching data..");
  

    const resp = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_url,
        mutual_connections: pageData.mutual_connections || 0,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.detail || `Server error ${resp.status}`);
    }

    setStep("step-profile", "Actor 1: Profile scraper", true);
    setStep("step-posts",   "Actor 2: Posts scraper", true);
    setStatus("Computing score...");
    setStep("step-score", "Computing Outreach Readiness Score", true);

    const apiData = await resp.json();

    // Merge: page data (logged-in view) + API data (Apify)
    const merged = {
      ...apiData,
      name:              pageData.name                                                            || apiData.name,
      country:           pageData.country && pageData.country !== "Not specified"                  ? pageData.country : apiData.country,
      about:             pageData.about && pageData.about !== "Not specified"                      ? pageData.about : apiData.about,
      current_company:   pageData.current_company && pageData.current_company !== "Not specified"  ? pageData.current_company : apiData.current_company,
      position:          pageData.position && pageData.position !== "Not specified"                ? pageData.position : apiData.position,
      education:         pageData.education && pageData.education !== "Not specified"              ? pageData.education : apiData.education,
      skills:            pageData.skills && pageData.skills !== "Not specified"                    ? pageData.skills : apiData.skills,
      projects:          pageData.projects && pageData.projects !== "Not specified"                ? pageData.projects : apiData.projects,
      mutual_connections: pageData.mutual_connections > 0 ? pageData.mutual_connections : apiData.mutual_connections,
    };

    renderPanel(merged);

  } catch (err) {
    console.error("[LI-AI] ❌", err);
    document.getElementById("li-ai-body").innerHTML = `
      <div style="color:#dc2626;padding:16px;">
        ❌ <strong>${err.message}</strong><br><br>
        Make sure the server is running:<br>
        <code style="font-size:12px;color:#9ca3af;">uvicorn main:app --reload</code>
      </div>`;
  }
}

// ─── ICP Score Click Handler ──────────────────────────────────────────────────
async function handleIcpClick() {
  const existing = document.getElementById("li-icp-panel");
  if (existing) { existing.remove(); return; }

  const panel = document.createElement("div");
  panel.id = "li-icp-panel";
  panel.innerHTML = `
    <div class="panel-header" style="background:#059669;">
      <span>🎯 ICP Score</span>
      <button class="panel-close" id="li-icp-close">×</button>
    </div>
    <div class="panel-body" id="li-icp-body">
      <div style="display:flex;flex-direction:column;gap:10px;padding:16px;">
        <div style="display:flex;align-items:center;gap:10px;color:#6b7280;">
          <div style="width:16px;height:16px;border:2.5px solid #e5e7eb;border-top-color:#059669;border-radius:50%;animation:li-spin .7s linear infinite;flex-shrink:0;"></div>
          <span id="li-icp-status">Calculating ICP Score...</span>
        </div>
      </div>
    </div>
  `;

  const icpBtn = document.getElementById("li-icp-btn");
  const topCard = icpBtn?.closest("section") || icpBtn?.parentElement?.parentElement;
  topCard ? topCard.insertAdjacentElement("afterend", panel) : document.querySelector("main")?.prepend(panel);
  document.getElementById("li-icp-close").onclick = () => panel.remove();

  try {
    const pageData = scrapeProfile();
    const resp = await fetch(`${API_BASE_URL}/icp-score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pageData),
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const result = await resp.json();

    const bd = result.breakdown;
    const rows = Object.entries(bd).map(([label, data]) => {
      const pct = Math.round((data.score / data.max) * 100);
      const color = data.score === data.max ? "#059669" : data.score > 0 ? "#0a66c2" : "#e5e7eb";
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#374151;margin-bottom:2px;">
            <span>${label}</span>
            <span style="color:${color};">${data.score}/${data.max}</span>
          </div>
          <div style="height:5px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${data.reason}</div>
        </div>`;
    }).join("");

    document.getElementById("li-icp-body").innerHTML = `
      <div style="padding:16px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="font-size:36px;font-weight:800;color:${result.icp_score >= 70 ? "#059669" : result.icp_score >= 40 ? "#f59e0b" : "#dc2626"};">${result.icp_score}</div>
          <div>
            <div style="font-size:11px;color:#9ca3af;">out of 100</div>
            <div style="font-size:14px;font-weight:700;color:#374151;">ICP Score</div>
          </div>
        </div>
        ${rows}
      </div>`;
  } catch (err) {
    document.getElementById("li-icp-body").innerHTML = `
      <div style="color:#dc2626;padding:16px;">❌ ${err.message}</div>`;
  }
}

// ─── Render Panel ──────────────────────────────────────────────────────────────
function renderPanel(data) {
  const name            = data.name            || "Unknown";
  const country         = data.country         || "Not specified";
  const current_company = data.current_company || "Not specified";
  const position        = (/notification|follower|connection/i.test(data.position || "") ? "" : data.position) || "";
  const activity        = data.activity        || "No activity data";
  const activity_url    = data.activity_url    || "";

  let score_total        = data.score_total        || 0;
  let score_label        = data.score_label        || "";
  let score_activity     = data.score_activity     || 0;
  let score_posts        = data.score_posts        || 0;
  let score_engagement   = data.score_engagement   || 0;
  let score_completeness = data.score_completeness || 0;
  let score_signals      = data.score_signals      || 0;
  let score_mutuals      = data.score_mutuals      || 0;
  const avg_engagement   = data.avg_engagement     || 0;
  const posts_90_days    = data.posts_90_days      || 0;
  const engagement_label = data.engagement_label   || "No data";
  const mutual_count     = data.mutual_connections  || 0;

  // Re-check signals from page-scraped text (more accurate since user is logged in)
  const positionText = (data.position || "").toLowerCase();
  const aboutText    = (data.about    || "").toLowerCase();
  let signalsFixed   = score_signals;
  const hiringKw     = ["hiring", "we're hiring", "join our team", "open roles"];
  const promoKw      = ["promoted", "new role", "excited to announce"];
  const growthKw     = ["growing", "we raised", "series a", "series b", "funded"];
  for (const kw of hiringKw) {
    if (positionText.includes(kw) || aboutText.includes(kw)) { signalsFixed = Math.max(signalsFixed, 5); break; }
  }
  for (const kw of promoKw) {
    if (positionText.includes(kw) || aboutText.includes(kw)) { signalsFixed = Math.max(signalsFixed, 3); break; }
  }
  for (const kw of growthKw) {
    if (positionText.includes(kw) || aboutText.includes(kw)) { signalsFixed = Math.max(signalsFixed, 2); break; }
  }
  if (signalsFixed !== score_signals) {
    score_signals = signalsFixed;
    score_total   = score_activity + score_posts + score_engagement + score_completeness + score_signals + score_mutuals;
    score_label   = score_total >= 70 ? "🟢 Ready to Engage" : score_total >= 40 ? "🟡 Needs Nurturing" : "🔴 Difficult to Engage";
  }

  // Colors
  let scoreColor = "#dc2626";
  if (score_total >= 70) scoreColor = "#16a34a";
  else if (score_total >= 40) scoreColor = "#f59e0b";

  // Activity HTML
  let activityHTML = escHtml(activity);
  if (activity_url) {
    activityHTML = `<a href="${escHtml(activity_url)}" target="_blank" style="color:#0a66c2;text-decoration:none;font-weight:600;">${escHtml(activity)} 🔗</a>`;
  } else if (activity.includes("ago") || activity.toLowerCase().includes("today") || activity.toLowerCase().includes("yesterday")) {
    activityHTML = `<strong style="color:#16a34a;">⏱️ ${escHtml(activity)}</strong>`;
  } else if (activity.toLowerCase().includes("recent")) {
    activityHTML = `<strong style="color:#f59e0b;">⏱️ ${escHtml(activity)}</strong>`;
  }

  // Score breakdown rows
  const scoreRows = [
    { label: "Recent Activity",    score: score_activity,     max: 30, detail: "" },
    { label: "Posting Frequency",  score: score_posts,        max: 20, detail: posts_90_days > 0 ? `${posts_90_days} posts in 90 days` : "0 posts found" },
    { label: "Engagement Level",   score: score_engagement,   max: 20, detail: engagement_label },
    { label: "Profile Completeness", score: score_completeness, max: 10, detail: "" },
    { label: "Hiring/Growth Signals", score: score_signals,   max: 10, detail: "" },
    { label: "Mutual Connections", score: score_mutuals,      max: 10, detail: `${mutual_count} mutual` },
  ];

  const scoreRowsHTML = scoreRows.map(row => {
    const pct   = Math.round((row.score / row.max) * 100);
    const color = row.score === row.max ? "#16a34a" : row.score > 0 ? "#0a66c2" : "#e5e7eb";
    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:600;color:#374151;">${escHtml(row.label)}</span>
          <span style="font-size:13px;font-weight:700;color:${color};">${row.score}/${row.max}</span>
        </div>
        <div style="height:6px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;transition:width .6s ease;"></div>
        </div>
        ${row.detail ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px;">${escHtml(row.detail)}</div>` : ""}
      </div>
    `;
  }).join("");

  document.getElementById("li-ai-body").innerHTML = `

    <!-- Outreach Readiness Score -->
    <div style="background:#f9fafb;border-radius:10px;padding:18px;margin-bottom:14px;border-left:5px solid ${scoreColor};">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;margin-bottom:8px;">
        📊 Outreach Readiness Score
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div style="font-size:40px;font-weight:800;color:${scoreColor};line-height:1;">${score_total}</div>
        <div>
          <div style="font-size:11px;color:#9ca3af;">out of 100</div>
          <div style="font-size:16px;color:#374151;font-weight:700;margin-top:2px;">${escHtml(score_label)}</div>
        </div>
      </div>
      ${scoreRowsHTML}
    </div>
  `;
}

// ─── Init ──────────────────────────────────────────────────────────────────────
setTimeout(addAIButton, 1500);
setInterval(addAIButton, 3000);

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
  }
});
observer.observe(document.body, { childList: true, subtree: true });