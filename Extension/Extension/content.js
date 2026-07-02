// const API_BASE_URL = "http://127.0.0.1:8000";
const API_BASE_URL = "https://linkedin-analyzer-90ne.onrender.com";

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
async function cacheGet(key) {
  const r = await chrome.storage.local.get(key);
  if (!r[key]) return null;
  if (Date.now() - r[key].ts > CACHE_TTL) { chrome.storage.local.remove(key); return null; }
  return r[key].data;
}
async function cacheSet(key, val) { await chrome.storage.local.set({ [key]: { data: val, ts: Date.now() } }); }
// ─── Styles ───────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById("li-ai-styles")) return;
  const style = document.createElement("style");
  style.id = "li-ai-styles";
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    #li-ai-analyze-btn, #li-icp-btn {
      display:inline-flex;align-items:center;justify-content:center;
      gap:6px;padding:0 16px;height:34px;
      border:1.5px solid #0a66c2;border-radius:999px;
      background:#fff;color:#0a66c2;cursor:pointer;
      font-size:13px;font-weight:600;
      font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      transition:all .15s ease;
      white-space:nowrap;flex-shrink:0;z-index:9999;position:relative;align-self:center;
    }
    #li-ai-analyze-btn:hover{background:#0a66c2;color:#fff;box-shadow:0 2px 8px rgba(10,102,194,.25);}
    #li-icp-btn{border-color:#059669;color:#059669;}
    #li-icp-btn:hover{background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,.25);}
    #li-ai-panel, #li-icp-panel{
      margin:12px 0;border-radius:10px;border:1px solid #e5e7eb;
      background:#fff;box-shadow:0 2px 16px rgba(0,0,0,.06);overflow:hidden;
      font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
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
    /* ── AI Suggest (message composer) ── */
    .li-suggest-btn{
      display:inline-flex;align-items:center;gap:6px;
      margin:6px 8px;padding:6px 14px;
      border:1.5px solid #0a66c2;border-radius:999px;
      background:#eef3fb;color:#0a66c2;cursor:pointer;
      font-size:13px;font-weight:600;line-height:1;
      font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      transition:all .15s ease;
    }
    .li-suggest-btn:hover{background:#0a66c2;color:#fff;box-shadow:0 2px 8px rgba(10,102,194,.25);}
    .li-suggest-btn:disabled{opacity:.6;cursor:default;}
    .li-suggest-box{
      margin:6px 8px 10px;padding:12px;border:1px solid #e5e7eb;border-radius:10px;
      background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.06);
      font-family:'Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    .li-suggest-box-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
    .li-suggest-box-head span{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#0a66c2;}
    .li-suggest-box-close{background:none;border:none;font-size:18px;line-height:1;cursor:pointer;color:#9ca3af;padding:0 2px;}
    .li-suggest-box-close:hover{color:#111827;}
    .li-suggest-item{
      display:block;width:100%;text-align:left;margin:6px 0;padding:10px 12px;
      border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;color:#111827;
      font-size:13px;line-height:1.45;cursor:pointer;transition:all .15s ease;
      font-family:inherit;
    }
    .li-suggest-item:hover{border-color:#0a66c2;background:#eef3fb;}
    .li-suggest-msg{font-size:12px;color:#6b7280;padding:4px 2px;}
  `;
  document.head.appendChild(style);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isProfilePage()   { return /linkedin\.com\/in\//i.test(window.location.href); }

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
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Turn a client-side error into a clean user-facing message (hide "Failed to fetch").
function clientErrorMessage(err) {
  const m = (err && err.message) || "";
  if (!m || /failed to fetch|networkerror|load failed|network request failed/i.test(m)) {
    return "Server error. Please try again later.";
  }
  return m;
}

// Professional error card shown inside a panel body.
function errorCardHTML(message) {
  return `
    <div style="padding:28px 20px;text-align:center;font-family:'Inter',-apple-system,sans-serif;">
      <div style="width:44px;height:44px;border-radius:50%;background:#fef2f2;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:22px;">⚠️</div>
      <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">Something went wrong</div>
      <div style="font-size:13px;color:#6b7280;line-height:1.5;">${escHtml(message)}</div>
    </div>`;
}

function safeUrl(u) {
  try {
    const url = new URL(u, location.href);
    return /^https?:$/.test(url.protocol) ? url.href : "#";
  } catch { return "#"; }
}

function scoreCircle(score, max, color) {
  const pct  = Math.min(score / max, 1);
  const r    = 42;
  const circ = 2 * Math.PI * r;
  const off  = circ * (1 - pct);
  return `
    <svg width="112" height="112" viewBox="0 0 112 112" style="flex-shrink:0;">
      <circle cx="56" cy="56" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="7"/>
      <circle cx="56" cy="56" r="${r}" fill="none" stroke="${color}" stroke-width="7"
        stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
        stroke-linecap="round" transform="rotate(-90 56 56)"/>
      <text x="56" y="53" text-anchor="middle" font-size="28" font-weight="800" fill="${color}" font-family="Inter,-apple-system,sans-serif">${score}</text>
      <text x="56" y="70" text-anchor="middle" font-size="12" fill="#9ca3af" font-family="Inter,-apple-system,sans-serif">/${max}</text>
    </svg>`;
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
function activityButton() {
  if (!isProfilePage()) return;
  if (document.getElementById("li-ai-analyze-btn") && document.getElementById("li-icp-btn")) return;
  const anchor = findActionTarget();
  if (!anchor) return;
  injectStyles();

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
    icpBtn.addEventListener("click", ICPButton);
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
      <span>Activity Score</span>
      <button class="panel-close" id="li-ai-close">×</button>
    </div>
    <div class="panel-body" id="li-ai-body">
      <div style="display:flex;flex-direction:column;gap:10px;padding:16px;">
        <div style="display:flex;align-items:center;gap:10px;color:#6b7280;">
          <div style="width:16px;height:16px;border:2.5px solid #e5e7eb;border-top-color:#0a66c2;border-radius:50%;animation:li-spin .7s linear infinite;flex-shrink:0;"></div>
          <span id="li-ai-status">Calculating Activity Score...</span>
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
    const cacheKey    = "act_" + profile_url;

    const cached = await cacheGet(cacheKey);
    if (cached) { renderPanel(cached); return; }

    setStatus("Calculating Activity Score..");

    const resp = await fetch(`${API_BASE_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_url }),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(errBody.detail || `Server error ${resp.status}`);
    }

    setStatus("Computing score...");

    const apiData = await resp.json();
    await cacheSet(cacheKey, apiData);

    renderPanel(apiData);

  } catch (err) {
    console.error("[LI-AI]", err);
    (document.getElementById("li-ai-body") || {}).innerHTML = errorCardHTML(clientErrorMessage(err));
  }
}

// ─── ICP Score Click Handler ──────────────────────────────────────────────────
async function ICPButton() {
  const existing = document.getElementById("li-icp-panel");
  if (existing) { existing.remove(); return; }

  const panel = document.createElement("div");
  panel.id = "li-icp-panel";
  panel.innerHTML = `
    <div class="panel-header" style="background:#059669;">
      <span>ICP Score</span>
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
    const profile_url = window.location.href.split("?")[0];
    const cacheKey    = "icp_" + profile_url;

    let result = await cacheGet(cacheKey);
    if (!result) {
      const resp = await fetch(`${API_BASE_URL}/icp-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_url }),
      });
      if (!resp.ok) {
        const b = await resp.json().catch(() => ({}));
        throw new Error(b.detail || `Server error ${resp.status}`);
      }
      result = await resp.json();
      await cacheSet(cacheKey, result);
    }

    const bd = result.breakdown;
    const rows = Object.entries(bd).map(([label, data]) => {
      const pct = Math.round((data.score / data.max) * 100);
      const color = data.score === data.max ? "#059669" : data.score > 0 ? "#0a66c2" : "#e5e7eb";
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#374151;margin-bottom:2px;">
            <span>${escHtml(label)}</span>
            <span style="color:${color};">${data.score}/${data.max}</span>
          </div>
          <div style="height:5px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:999px;"></div>
          </div>
          <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${escHtml(data.reason)}</div>
        </div>`;
    }).join("");

    const icpColor = result.icp_score >= 70 ? "#059669" : result.icp_score >= 40 ? "#eab308" : "#dc2626";
    const icpLabel = result.icp_score >= 70 ? "Good Match" : result.icp_score >= 40 ? "Need Nurturing" : "Poor Match";
    const icpSub   = result.icp_score >= 70 ? "This lead aligns well with your ideal customer profile." : result.icp_score >= 40 ? "Build engagement to improve outreach success." : "This lead is outside your ideal customer profile.";
    (document.getElementById("li-icp-body") || {}).innerHTML = `
      <div style="padding:16px;">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
          ${scoreCircle(result.icp_score, 100, icpColor)}
          <div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:${icpColor}1a;border:1px solid ${icpColor}40;">
                <span style="width:7px;height:7px;border-radius:50%;background:${icpColor};display:inline-block;flex-shrink:0;"></span>
                <span style="font-size:13px;font-weight:700;color:#111827;">${escHtml(icpLabel)}</span>
              </span>
            </div>
            <div style="font-size:12px;color:#6b7280;line-height:1.4;">${escHtml(icpSub)}</div>
          </div>
        </div>
        ${rows}
      </div>`;
  } catch (err) {
    (document.getElementById("li-icp-body") || {}).innerHTML = errorCardHTML(clientErrorMessage(err));
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
  else if (score_total >= 40) scoreColor = "#eab308";

  // Activity HTML
  let activityHTML = escHtml(activity);
  if (activity_url) {
    activityHTML = `<a href="${escHtml(safeUrl(activity_url))}" target="_blank" style="color:#0a66c2;text-decoration:none;font-weight:600;">${escHtml(activity)} 🔗</a>`;
  } else if (activity.includes("ago") || activity.toLowerCase().includes("today") || activity.toLowerCase().includes("yesterday")) {
    activityHTML = `<strong style="color:#16a34a;">⏱️ ${escHtml(activity)}</strong>`;
  } else if (activity.toLowerCase().includes("recent")) {
    activityHTML = `<strong style="color:#eab308;">⏱️ ${escHtml(activity)}</strong>`;
  }

  // Score breakdown rows
  const scoreRows = [
    { label: "Recent Activity",    score: score_activity,     max: 35, detail: (activity.includes("ago") || activity.includes("today") || activity.includes("yesterday")) ? activity.split(" —")[0].trim() : "" },
    { label: "Posting Frequency",  score: score_posts,        max: 25, detail: posts_90_days > 0 ? `${posts_90_days} posts in 90 days` : "0 posts found" },
    { label: "Engagement Level",   score: score_engagement,   max: 20, detail: engagement_label },
    { label: "Profile Completeness", score: score_completeness, max: 10, detail: "" },
    { label: "Hiring/Growth Signals", score: score_signals,   max: 10, detail: "" },
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

  const cleanLabel = score_total >= 70 ? "Ready to Engage" : score_total >= 40 ? "Needs Nurturing" : "Difficult to Engage";
  const actSub     = score_total >= 70 ? "High outreach potential — great time to connect." : score_total >= 40 ? "Moderate potential — consider warming up first." : "Low engagement may not respond well.";

  (document.getElementById("li-ai-body") || {}).innerHTML = `
    <div style="padding:18px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
        ${scoreCircle(score_total, 100, scoreColor)}
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
            <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:${scoreColor}1a;border:1px solid ${scoreColor}40;">
              <span style="width:7px;height:7px;border-radius:50%;background:${scoreColor};display:inline-block;flex-shrink:0;"></span>
              <span style="font-size:13px;font-weight:700;color:#111827;">${escHtml(cleanLabel)}</span>
            </span>
          </div>
          <div style="font-size:12px;color:#6b7280;line-height:1.5;">${escHtml(actSub)}</div>
        </div>
      </div>
      ${scoreRowsHTML}
    </div>
  `;
}

// ─── Init ──────────────────────────────────────────────────────────────────────
setTimeout(activityButton, 1500);
setInterval(activityButton, 3000);

let lastUrl = location.href;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    document.getElementById("li-ai-analyze-btn")?.remove();
    document.getElementById("li-icp-btn")?.remove();
    document.getElementById("li-ai-panel")?.remove();
    document.getElementById("li-icp-panel")?.remove();
    setTimeout(activityButton, 1500);
  } else {
    activityButton();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// ═══════════════════════════════════════════════════════════════════════════
// AI Suggest — reply suggestions in the LinkedIn message composer
// Self-contained: does NOT touch the Activity/ICP code above.
// DOM is used ONLY for UI injection + writing the chosen reply — never to read
// conversation text (that is fetched server-side via the Apify actor).
// ═══════════════════════════════════════════════════════════════════════════
const API_CHAT_URL = "http://localhost:8000";

// LinkedIn renders the messaging overlay inside an (open) Shadow DOM, so plain
// document.querySelector cannot see the composer or messages, and external CSS
// cannot style anything inside it. Everything below walks shadow roots and uses
// inline styles. DOM is used only for UI injection + writing the chosen reply.

// Inline styles (external CSS can't cross the shadow boundary).
// Icon-only button, styled to sit inline with LinkedIn's footer action icons.
const SUGGEST_BTN_CSS =
  "display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;" +
  "margin:0 2px;padding:0;border:none;border-radius:50%;background:transparent;color:#0a66c2;" +
  "font-size:16px;line-height:1;cursor:pointer;flex-shrink:0;";
const SUGGEST_BOX_CSS =
  "margin:6px 8px 10px;padding:12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;" +
  "box-shadow:0 2px 12px rgba(0,0,0,.15);font-family:'Inter',-apple-system,'Segoe UI',sans-serif;";
const SUGGEST_ITEM_CSS =
  "display:block;width:100%;text-align:left;margin:6px 0;padding:10px 12px;border:1px solid #e5e7eb;" +
  "border-radius:8px;background:#f9fafb;color:#111827;font:400 13px/1.45 'Inter',sans-serif;cursor:pointer;";
const TONE_CSS =
  "padding:3px 10px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#374151;" +
  "font:600 11px/1 'Inter',sans-serif;cursor:pointer;";
const COPY_CSS =
  "position:absolute;top:6px;right:6px;width:24px;height:24px;padding:0;border:none;border-radius:6px;" +
  "background:rgba(255,255,255,.85);cursor:pointer;font-size:13px;line-height:1;";

// In-memory cache of suggestions per (conversation + tone). Cleared on page reload.
const suggestCache = new Map();
function convoSignature(editable, messages) {
  const last = messages.length ? (messages[messages.length - 1].text || "") : "new";
  return getConversationId(editable) + "|" + messages.length + "|" + last.slice(0, 40);
}

// Collect the document plus every OPEN shadow root, recursively.
function collectRoots() {
  const roots = [document];
  const walk = (root) => {
    let els;
    try { els = root.querySelectorAll("*"); } catch { return; }
    els.forEach((el) => { if (el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); } });
  };
  walk(document);
  return roots;
}

// Every open "Write a message…" composer, across light DOM and shadow roots.
function findComposers() {
  const found = [];
  for (const root of collectRoots()) {
    let eds;
    try {
      eds = root.querySelectorAll('[contenteditable="true"], [contenteditable=""], [role="textbox"], textarea');
    } catch { continue; }
    eds.forEach((ed) => {
      const label = (ed.getAttribute("aria-label") || "") + " " + (ed.getAttribute("placeholder") || "");
      if (/message/i.test(label) || (ed.closest && ed.closest('.msg-form, [class*="msg-form"]'))) {
        found.push(ed);
      }
    });
  }
  return found;
}

// Widest ancestor of the composer that still holds exactly ONE message list =
// this single conversation's boundary (stop before a shared multi-chat container).
function convoContainer(editable) {
  let el = editable, best = null;
  for (let i = 0; el && i < 15; i++, el = el.parentElement) {
    if (!el.querySelectorAll) continue;
    const n = el.querySelectorAll(".msg-s-message-list").length;
    if (n === 1) best = el;        // still one conversation — keep widening
    else if (n > 1) break;         // reached a container with multiple chats — stop
  }
  return best || editable.getRootNode();
}

// Read this conversation's messages (account-safe: never touches the session cookie).
// Uses LinkedIn's EXACT classes — substring/wildcard selectors match sub-elements
// (__body, __link, __profile-picture…) and massively inflate/duplicate the results.
function scrapeConversation(editable) {
  const container = convoContainer(editable);
  const out = [];
  let name = "Them";
  container.querySelectorAll(".msg-s-event-listitem").forEach((item) => {
    const nameEl = item.querySelector(".msg-s-message-group__name");
    if (nameEl && nameEl.innerText.trim()) name = nameEl.innerText.trim();
    const isOther = /--other/.test(item.className || "");
    const bodyEl = item.querySelector(".msg-s-event__content, .msg-s-event-listitem__body");
    const text = bodyEl ? bodyEl.innerText.trim() : "";
    if (text) out.push({ sender: isOther ? name : "You", text });
  });
  return out.slice(-30); // cap the context sent to the backend
}

// Name of the person being replied to = first sender that isn't "You".
function getParticipant(messages) {
  const other = messages.find((m) => m.sender && m.sender !== "You");
  return other ? other.sender : "";
}

// Recipient's name + LinkedIn headline from the chat header (used to personalize
// a FIRST message when there are no prior messages to reply to).
function getRecipientProfile(editable) {
  let el = editable, container = null;
  for (let i = 0; el && i < 20; i++, el = el.parentElement) {
    if (
      el.querySelector &&
      el.querySelector(".artdeco-entity-lockup__title, .msg-entity-lockup__entity-title") &&
      el.querySelector(".artdeco-entity-lockup__subtitle, .msg-entity-lockup__entity-subtitle")
    ) { container = el; break; } // nearest header block holding both name + headline
  }
  if (!container) return { name: "", headline: "" };
  const t = container.querySelector(".artdeco-entity-lockup__title, .msg-entity-lockup__entity-title");
  const s = container.querySelector(".artdeco-entity-lockup__subtitle, .msg-entity-lockup__entity-subtitle");
  return {
    name: t ? t.innerText.trim().split("\n")[0].trim() : "",
    headline: s ? s.innerText.trim().replace(/\s+/g, " ") : "",
  };
}

// Conversation id (best-effort; backend uses the scraped messages, not this).
function getConversationId(editable) {
  const m = window.location.href.match(/\/messaging\/thread\/([^/?#]+)/);
  if (m) return m[1];
  const c = convoContainer(editable);
  const urn = c.querySelector && c.querySelector("[data-event-urn]");
  if (urn) return urn.getAttribute("data-event-urn");
  return "current_chat_id";
}

function hoverBg(btn) {
  btn.addEventListener("mouseenter", () => { btn.style.background = "rgba(0,0,0,.08)"; });
  btn.addEventListener("mouseleave", () => { btn.style.background = "transparent"; });
}

// Small transient message at the bottom of the screen (for grammar fix feedback).
function showToast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText =
    "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;" +
    "padding:10px 16px;border-radius:8px;font:500 13px/1.3 'Inter',sans-serif;max-width:360px;" +
    "z-index:100000;box-shadow:0 4px 16px rgba(0,0,0,.3);";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function injectSuggestButton() {
  ensureShadowObservers();
  pruneOrphanPanels(); // close panels whose chat was closed/navigated away
  for (const editable of findComposers()) {
    const form = (editable.closest && (editable.closest(".msg-form") || editable.closest("form"))) || null;
    if (!form) continue;
    // put the icons next to LinkedIn's footer icons (attach / GIF / emoji)
    const actions = form.querySelector(".msg-form__left-actions") || form;
    if (actions.querySelector(".li-suggest-btn")) continue; // already added to this composer

    // ✨ AI Suggest
    const btn = document.createElement("button");
    btn.className = "li-suggest-btn";
    btn.type = "button";
    btn.title = "AI Suggest reply";
    btn.textContent = "✨";
    btn.style.cssText = SUGGEST_BTN_CSS;
    hoverBg(btn);
    btn.addEventListener("click", () => handleSuggestClick(editable, form, btn));
    actions.appendChild(btn);

    // ✍️ Grammar fix (cleans up the user's own typed draft)
    const gbtn = document.createElement("button");
    gbtn.className = "li-grammar-btn";
    gbtn.type = "button";
    gbtn.title = "Fix grammar of your draft";
    gbtn.textContent = "✍️";
    gbtn.style.cssText = SUGGEST_BTN_CSS;
    hoverBg(gbtn);
    gbtn.addEventListener("click", () => handleGrammarFix(editable, gbtn));
    actions.appendChild(gbtn);
  }
}

// Clean up the user's own typed draft in place.
async function handleGrammarFix(editable, btn) {
  const text = (editable.innerText || "").trim();
  const prev = btn.textContent;
  if (!text) { showToast("✍️ Type a message first, then click to fix its grammar."); return; }
  btn.disabled = true;
  btn.textContent = "…";
  try {
    let resp;
    try {
      resp = await fetch(`${API_CHAT_URL}/grammar-fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch (netErr) {
      showToast("Server error. Please try again later.");
      return;
    }
    if (!resp.ok) {
      showToast(`Server error ${resp.status}. Check the backend logs.`);
      return;
    }
    const data = await resp.json();
    if (data.error) showToast("⚠️ " + data.error);         // clear reason
    else if (data.text) insertIntoComposer(editable, data.text);
  } finally {
    btn.disabled = false;
    if (btn.textContent === "…") btn.textContent = prev;
  }
}

// The suggestions panel FLOATS just above the compose form (fixed position) so it
// never pushes the compose box out of view. Tracked per-form via a WeakMap.
const openBoxes = new WeakMap();
const openPanels = new Set(); // for lifecycle cleanup (iterable, unlike WeakMap)

// Close any panel whose chat was closed/minimized or navigated away from.
function pruneOrphanPanels() {
  for (const rec of openPanels) {
    let gone;
    try {
      gone = !rec.form.isConnected || !rec.editable.isConnected ||
             rec.form.getBoundingClientRect().height === 0; // closed or minimized
    } catch { gone = true; }
    if (gone) rec.removeBox();
  }
}

function existingBox(form) {
  const b = openBoxes.get(form);
  return b && b.isConnected ? b : null;
}
function placeBox(form, box) {
  const old = openBoxes.get(form);
  if (old) old.remove();
  const r = form.getBoundingClientRect();
  box.style.position = "fixed";
  box.style.left = Math.round(Math.max(8, r.left)) + "px";
  box.style.width = Math.round(Math.min(Math.max(r.width, 260), 400)) + "px";
  box.style.bottom = Math.round(window.innerHeight - r.top + 8) + "px"; // just above the composer
  box.style.margin = "0";
  box.style.maxHeight = "48vh";
  box.style.overflowY = "auto";
  box.style.zIndex = "99999";
  document.body.appendChild(box);   // in the top document → not clipped by the overlay
  openBoxes.set(form, box);
}

function smallBtn(txt, title) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = txt;
  b.title = title;
  b.style.cssText = "background:none;border:none;font-size:15px;line-height:1;cursor:pointer;color:#6b7280;margin-left:8px;";
  return b;
}

function handleSuggestClick(editable, form, btn) {
  if (existingBox(form)) { existingBox(form).remove(); return; } // toggle closed

  const box = document.createElement("div");
  box.className = "li-suggest-box";
  box.style.cssText = SUGGEST_BOX_CSS;

  const state = { tone: "", nonce: 0 };

  // Close + detach listeners (× button, Send click, Enter key).
  const sendBtn = form.querySelector(".msg-form__send-button");
  let onEnter;
  const removeBox = () => {
    box.remove();
    openBoxes.delete(form);
    openPanels.delete(record);
    if (sendBtn) sendBtn.removeEventListener("click", removeBox);
    editable.removeEventListener("keydown", onEnter);
  };
  const record = { form, editable, removeBox };
  openPanels.add(record); // so it can be auto-closed when the chat closes
  onEnter = (e) => { if (e.key === "Enter" && !e.shiftKey) setTimeout(removeBox, 30); };
  if (sendBtn) sendBtn.addEventListener("click", removeBox);
  editable.addEventListener("keydown", onEnter);

  // Header: title + 🔄 regenerate + × close
  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;";
  const title = document.createElement("span");
  title.textContent = "AI Suggestions";
  title.style.cssText = "font:700 12px/1 'Inter',sans-serif;text-transform:uppercase;letter-spacing:.5px;color:#0a66c2;";
  const controls = document.createElement("div");
  const regen = smallBtn("🔄", "Generate new suggestions");
  const close = smallBtn("×", "Close");
  close.style.fontSize = "18px";
  regen.addEventListener("click", () => { state.nonce++; load(false); }); // fresh + different
  close.addEventListener("click", removeBox);
  controls.appendChild(regen);
  controls.appendChild(close);
  head.appendChild(title);
  head.appendChild(controls);
  box.appendChild(head);

  // Tone selector
  const toneRow = document.createElement("div");
  toneRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;";
  const tones = ["Friendly", "Formal", "Short", "Enthusiastic"];
  const toneBtns = {};
  const paintTones = () => tones.forEach((t) => {
    const active = state.tone === t;
    toneBtns[t].style.cssText = TONE_CSS + (active ? "background:#0a66c2;color:#fff;border-color:#0a66c2;" : "");
  });
  tones.forEach((t) => {
    const tb = document.createElement("button");
    tb.type = "button";
    tb.textContent = t;
    tb.style.cssText = TONE_CSS;
    tb.addEventListener("click", () => { state.tone = state.tone === t ? "" : t; paintTones(); load(true); });
    toneBtns[t] = tb;
    toneRow.appendChild(tb);
  });
  box.appendChild(toneRow);

  // List container
  const listEl = document.createElement("div");
  box.appendChild(listEl);

  const setInfo = (text, color) => {
    listEl.innerHTML = "";
    const d = document.createElement("div");
    d.textContent = text;
    d.style.cssText = `font-size:12px;color:${color || "#6b7280"};padding:4px 2px;`;
    listEl.appendChild(d);
  };

  const renderList = (list, errorMsg) => {
    listEl.innerHTML = "";
    if (errorMsg) {
      const warn = document.createElement("div");
      warn.textContent = "⚠️ " + errorMsg;
      warn.style.cssText =
        "font-size:12px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;" +
        "border-radius:8px;padding:8px 10px;margin-bottom:8px;";
      listEl.appendChild(warn);
    }
    if (!list || !list.length) { if (!errorMsg) setInfo("No suggestions."); return; }
    let selected = null;
    const norm = (b) => { b.style.background = "#f9fafb"; b.style.borderColor = "#e5e7eb"; };
    const sel = (b) => { b.style.background = "#dbeafe"; b.style.borderColor = "#0a66c2"; };
    list.forEach((text) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;margin:6px 0;";
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = text;
      // padding-right leaves room for the copy icon in the top corner
      item.style.cssText = SUGGEST_ITEM_CSS + "margin:0;padding-right:34px;";
      item.addEventListener("mouseenter", () => { if (item !== selected) { item.style.borderColor = "#0a66c2"; item.style.background = "#eef3fb"; } });
      item.addEventListener("mouseleave", () => { item === selected ? sel(item) : norm(item); });
      // click the message → fills the compose box automatically
      item.addEventListener("click", () => { insertIntoComposer(editable, text); if (selected) norm(selected); selected = item; sel(item); });
      const copy = document.createElement("button");
      copy.type = "button";
      copy.title = "Copy to clipboard";
      copy.textContent = "📋";
      copy.style.cssText = COPY_CSS;
      copy.addEventListener("click", (ev) => {
        ev.stopPropagation();
        try { navigator.clipboard && navigator.clipboard.writeText(text); } catch {}
        copy.textContent = "✓";
        setTimeout(() => (copy.textContent = "📋"), 1000);
      });
      wrap.appendChild(item);   // message
      wrap.appendChild(copy);   // copy icon overlaid at top-right
      listEl.appendChild(wrap);
    });
  };

  // Fetch (or use cache) + render, for the current tone.
  // Everything is inside try/catch so the panel ALWAYS shows something on open
  // (suggestions or an error) — never a silent blank.
  async function load(useCache) {
    setInfo("Thinking…");

    // 1) read the conversation from the page
    let messages, profile, participant, sig, conversation_id;
    try {
      messages = scrapeConversation(editable);
      profile = getRecipientProfile(editable);
      participant = getParticipant(messages) || profile.name;
      sig = convoSignature(editable, messages) + "|" + state.tone;
      conversation_id = getConversationId(editable);
    } catch (e) {
      setInfo("Couldn't read this conversation. Try reopening the chat.", "#dc2626");
      return;
    }
    if (useCache && suggestCache.has(sig)) { renderList(suggestCache.get(sig)); return; }

    // 2) call the backend — separate "unreachable" from "server responded with error"
    let resp;
    try {
      resp = await fetch(`${API_CHAT_URL}/generate-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id, participant, messages, profile, tone: state.tone, nonce: state.nonce ? String(state.nonce) : "" }),
      });
    } catch (netErr) {
      setInfo("Server error. Please try again later.", "#dc2626");
      return;
    }
    if (!resp.ok) {
      let detail = "";
      try { detail = (await resp.json()).detail || ""; } catch {}
      setInfo(`Server error ${resp.status}${detail ? " — " + detail : ""}. Check the backend logs.`, "#dc2626");
      return;
    }

    // 3) success — the AI may still report a friendly error in data.error
    let data;
    try { data = await resp.json(); } catch { setInfo("Unexpected response from the server.", "#dc2626"); return; }
    const list = data.suggestions || [];
    suggestCache.set(sig, list);
    renderList(list, data.error || "");
  }

  paintTones();
  placeBox(form, box);
  load(true); // initial load (instant if cached)
}

// Write the chosen reply into LinkedIn's contenteditable composer (UI write only).
function insertIntoComposer(editable, text) {
  editable.focus();
  try {
    editable.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = text;
    editable.appendChild(p);
  } catch {
    editable.textContent = text;
  }
  editable.dispatchEvent(new InputEvent("input", { bubbles: true }));

  // Move the caret to the end and make the inserted text visible.
  try {
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false); // to the end
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
  editable.scrollTop = editable.scrollHeight;               // scroll box to the bottom
  try { editable.scrollIntoView({ block: "nearest" }); } catch {} // bring composer into view
}

// Mutations inside a shadow root don't bubble to a document observer, so attach
// an observer to each shadow root we discover (once).
const _observedRoots = new WeakSet();
function ensureShadowObservers() {
  for (const root of collectRoots()) {
    if (root === document || _observedRoots.has(root)) continue;
    _observedRoots.add(root);
    new MutationObserver(() => injectSuggestButton()).observe(root, { childList: true, subtree: true });
  }
}

// Lifecycle: detect chat popups/threads opening (light DOM + shadow DOM + poll).
setTimeout(injectSuggestButton, 1500);
setInterval(injectSuggestButton, 2000);
const suggestObserver = new MutationObserver(() => injectSuggestButton());
suggestObserver.observe(document.body, { childList: true, subtree: true });

// When opening a chat from a profile's "Message" button, the overlay appears and
// its composer gets focus a moment before our poll fires. focusin is `composed`
// so it reaches this document listener from inside the shadow DOM — inject then,
// so the ✨/✍️ buttons show up on the FIRST try (no need to reopen/go back).
let _focusInjectTimer = null;
document.addEventListener("focusin", () => {
  clearTimeout(_focusInjectTimer);
  _focusInjectTimer = setTimeout(injectSuggestButton, 150);
}, true);