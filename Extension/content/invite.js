// LinkedIn AI Analyzer content script - Connect -> "Add a note": the ✨ note button.
// One of the content/*.js files manifest.json loads in order into the same page world.

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

// Everything known about the invitee: their saved Activity / ICP analysis (Apify), the
// lead log, or at least the card's headline.
async function inviteAnalysis(t) {
  const val = liClean;
  const out = { name: t.fullName, first_name: t.first === "there" ? "" : t.first };
  // Their saved Apify analysis fills the rest below; the open profile page is not read.
  if (!t.onProfile && t.card) out.headline = val(t.card.headline);
  if (!t.url) return out;
  const scoreKey = "liScore:" + t.url;
  const r = await storageGet([scoreKey, LI_LEADS_KEY]);
  const stored = r[scoreKey] || {};
  const act = (stored.activity && stored.activity.data) || null;
  const icp = (stored.icp && stored.icp.data) || null;
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
  if (icp) { const forAi = icpForAi(icp); out.icp_score = forAi.score; out.icp_breakdown = forAi.breakdown; }
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
