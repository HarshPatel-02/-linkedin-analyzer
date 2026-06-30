// const API_BASE_URL = "http://127.0.0.1:8000";
const API_BASE_URL = "https://linkedin-analyzer-90ne.onrender.com";
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
      <span>⚡ Activity</span>
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

    setStatus("Fetching data..");

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

    renderPanel(apiData);

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
async function ICPButton() {
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
    const profile_url = window.location.href.split("?")[0];
    const resp = await fetch(`${API_BASE_URL}/icp-score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_url }),
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
            <div style="font-size:14px;font-weight:700;color:#374151;">ICP</div>
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
    { label: "Recent Activity",    score: score_activity,     max: 30, detail: (activity.includes("ago") || activity.includes("today") || activity.includes("yesterday")) ? activity.split(" —")[0].trim() : "" },
    { label: "Posting Frequency",  score: score_posts,        max: 20, detail: posts_90_days > 0 ? `${posts_90_days} posts in 90 days` : "0 posts found" },
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