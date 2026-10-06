// LinkedIn AI Analyzer content script - The score panels' shell, click handling and the scoring loader.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ─── Click Handler ─────────────────────────────────────────────────────────────


// "Calculate ICP Score" in the form, "Re-analyze" over an existing result.
function icpCta() {
  return document.getElementById("li-icp-recalc") ? "Re-analyze" : "Calculate ICP Score";
}

// The two score panels are the same panel twice: same shell, same status line, same
// open/stored/render cycle. Only the ids, the wording and the accent differ, so they
// are described once here and everything else takes a `kind`.
const PANELS = {
  activity: { id: "li-ai-panel",  btnId: "li-ai-analyze-btn", title: "⚡ Activity Score",
              bodyId: "li-ai-body",  closeId: "li-ai-close",  statusId: "li-ai-status" },
  icp:      { id: "li-icp-panel", btnId: "li-icp-btn",        title: "🎯 ICP Score",
              headerColor: "#059669",
              bodyId: "li-icp-body", closeId: "li-icp-close", statusId: "li-icp-status" },
};

function setPanelStatus(kind, text) {
  const el = document.getElementById(PANELS[kind].statusId);
  if (el) el.textContent = text;
}

function setIcpStatus(text)      { setPanelStatus("icp", text); }
function setActivityStatus(text) { setPanelStatus("activity", text); }

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
  body.classList.remove("li-is-loading", "li-fresh");
  old.replaceWith(body);
  return body;
}

// ─── Calculating: the panel shows the score taking shape ─────────────────────
// A calculation can take up to a minute while the profile and posts are read, and a
// relabelled button at the bottom of a long form was easy to miss. The panel's content
// steps aside for the outline of the result - the total and one empty bar per factor -
// with what is happening now and how long it has taken. The content is hidden, not
// removed: the calculation still reads the form, and an error brings it back exactly as
// it was, with the message beside the button that was pressed.
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function showScoringLoader(bodyId, { title, stage, rows, accent }) {
  const body = document.getElementById(bodyId);
  if (!body) return { stage() {}, restore() {} };
  body.querySelector(":scope > .li-loading")?.remove();
  const scrollTop = body.scrollTop;
  const el = document.createElement("div");
  el.className = "li-loading";
  el.setAttribute("role", "status");
  el.style.setProperty("--li-accent", accent);
  el.innerHTML = `
    <div class="li-loading-head">
      <span class="li-loading-spin" aria-hidden="true"></span>
      <div class="li-loading-copy">
        <div class="li-loading-title">${liEsc(title)}</div>
        <div class="li-loading-stage"></div>
      </div>
      <span class="li-loading-time" aria-hidden="true">0s</span>
    </div>
    <div class="li-loading-hero" aria-hidden="true">
      <span class="li-skel li-skel-num"></span>
      <span class="li-skel-lines"><span class="li-skel"></span><span class="li-skel short"></span></span>
    </div>
    <div aria-hidden="true">
      ${rows.map((label, i) => `
        <div class="li-loading-row" style="--i:${i}">
          <div class="li-loading-label"><span>${liEsc(label)}</span><span class="li-skel li-skel-pts"></span></div>
          <div class="li-loading-track"></div>
        </div>`).join("")}
    </div>
    <div class="li-loading-note">Usually under a minute.</div>`;

  const stageEl = el.querySelector(".li-loading-stage");
  const timeEl  = el.querySelector(".li-loading-time");
  const noteEl  = el.querySelector(".li-loading-note");
  const started = Date.now();
  let slow = false;
  const timer = setInterval(() => {
    if (!el.isConnected) { clearInterval(timer); return; }
    const s = Math.floor((Date.now() - started) / 1000);
    timeEl.textContent = s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (s >= 60 && !slow) { slow = true; noteEl.textContent = "Taking longer than usual — still waiting for the profile data."; }
  }, 1000);

  stageEl.textContent = stage;
  body.classList.add("li-is-loading");
  body.prepend(el);
  body.scrollTop = 0;
  return {
    stage(text) { stageEl.textContent = text; },
    // Put the panel back as it was: after an error, or when the result belongs to a
    // profile that is no longer on screen. Once the result has replaced it, a no-op.
    restore() {
      clearInterval(timer);
      if (!el.isConnected) return;
      el.remove();
      body.classList.remove("li-is-loading");
      body.scrollTop = scrollTop;
    },
  };
}

// A score that was just calculated arrives the way it was worked out: the total counts
// up while each factor's bar fills to its share. A stored score is drawn still.
function revealFreshScore(body) {
  if (!body) return;
  body.classList.add("li-fresh");
  const num = body.querySelector(".li-score-num");
  if (!num || reducedMotion() || document.hidden) return;   // a background tab would hold it at 0
  const to = parseInt(num.textContent, 10) || 0;
  num.style.minWidth = num.offsetWidth + "px";      // the label beside it must not shift as digits appear
  const start = performance.now();
  const tick = (now) => {
    if (!num.isConnected) return;
    const t = Math.min(1, (now - start) / 700);
    num.textContent = t < 1 ? Math.round(to * (1 - Math.pow(2, -10 * t))) : to;
    if (t < 1) requestAnimationFrame(tick);
  };
  num.textContent = 0;
  requestAnimationFrame(tick);
}
