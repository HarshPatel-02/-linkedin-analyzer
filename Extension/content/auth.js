// LinkedIn AI Analyzer content script - Signed-out state: the gate on panels and the ✨ popup.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ─── Signed out ───────────────────────────────────────────────────────────────
// The extension is locked until someone signs in through the toolbar popup. The
// buttons and the ✨ stay on the page — hiding them would just look broken — and
// say so when they are pressed. The session lives in chrome.storage (leads.js),
// so signing out in the popup reaches this tab through onChanged below.
let _liAuth = null;
// Reloading the extension orphans the content script already running in an open
// LinkedIn tab: chrome.* then throws "Extension context invalidated", or simply
// never calls back. That is NOT "signed out" — nothing this script does will work
// again and no amount of signing in helps, so it has to be told apart and say
// what actually fixes it. apiFetch() has said the same thing for a while.
let _liOrphaned = false;

const extensionAlive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };

function refreshAuth() {
  return new Promise((resolve) => {
    let settled = false, guard = 0;
    const done = (auth, orphaned) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      _liOrphaned = orphaned;
      resolve((_liAuth = auth));
    };
    if (!extensionAlive()) return done(null, true);
    // A dead context can also answer with silence; never leave a click hanging.
    guard = setTimeout(() => done(null, true), 4000);
    try { liGetAuth((auth) => done(auth, !extensionAlive())); }
    catch (e) { done(null, true); }
  });
}

const signedIn = () => liAuthValid(_liAuth);

const LOCK_SVG = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="4" y="8.5" width="12" height="8" rx="2"/><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5"/></svg>';

const REFRESH_SVG = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"/><path d="M16.5 3.5V6H14"/></svg>';

// One block, two homes: the score panels and the ✨ popup. `what` finishes the
// sentence "Sign in to …", so each place names the thing that was just asked for.
// An orphaned tab gets the other message entirely: signing in cannot fix it.
function signedOutHTML(what) {
  if (_liOrphaned) {
    return '<div class="li-signout">' +
      '<div class="li-signout-lock">' + REFRESH_SVG + "</div>" +
      '<div class="li-signout-title">Refresh this tab to keep going</div>' +
      '<p class="li-signout-text">The extension was reloaded, so this page is still running the old copy ' +
        "of it and can no longer reach your scores. Refreshing brings everything back — nothing was lost, " +
        "and you do not need to sign in again.</p>" +
      '<button type="button" class="li-signout-btn" data-act="reload-page">Refresh the page</button>' +
      '<div class="li-signout-hint" data-role="signin-hint"></div>' +
    "</div>";
  }
  return '<div class="li-signout">' +
    '<div class="li-signout-lock">' + LOCK_SVG + "</div>" +
    '<div class="li-signout-title">Sign in to ' + liEsc(what) + "</div>" +
    '<p class="li-signout-text">Scores, leads and AI notes are locked until you sign in to the ' +
      "LinkedIn AI Analyzer extension. Nothing you have already saved was removed.</p>" +
    '<button type="button" class="li-signout-btn" data-act="open-popup">Open the extension</button>' +
    '<div class="li-signout-hint" data-role="signin-hint"></div>' +
  "</div>";
}

// The toolbar popup can only be opened by the extension itself, and not on every
// Chrome version — so the button asks the background worker and, when that is
// refused, turns into the instruction it was standing in for.
function wireSignInPrompt(root) {
  const reload = root.querySelector('[data-act="reload-page"]');
  if (reload) { reload.onclick = () => location.reload(); return; }
  const btn = root.querySelector('[data-act="open-popup"]');
  const hint = root.querySelector('[data-role="signin-hint"]');
  if (!btn) return;
  btn.onclick = () => {
    btn.disabled = true;
    try {
      chrome.runtime.sendMessage({ type: "li-open-popup" }, (res) => {
        const failed = chrome.runtime.lastError || !res || !res.ok;
        btn.disabled = false;
        if (!failed) return;
        btn.remove();
        if (hint) hint.textContent = "Click the extension icon in your Chrome toolbar to sign in, then press this button again.";
      });
    } catch (e) {
      btn.disabled = false;
      if (hint) hint.textContent = "Click the extension icon in your Chrome toolbar to sign in.";
    }
  };
}

// Same shell, same ✕, same place on the page as a real score panel.
function showSignedOutPanel(kind, what) {
  const existing = document.getElementById(PANELS[kind].id);
  if (existing) { existing.remove(); return; }
  applyTheme();
  createPanel(PANELS[kind]);
  const body = freshPanelBody(PANELS[kind].bodyId);
  if (!body) return;
  body.innerHTML = signedOutHTML(what);
  wireSignInPrompt(body);
}

// Crossing the gate in the popup reaches every open LinkedIn tab. Signing out
// takes the panels and any ✨ popup down rather than leaving a score on screen
// that can no longer be refreshed; signing in clears the locked ones, which are
// now answering a question that has been settled.
const isLockedUI = (el) => !!(el && el.querySelector(".li-signout"));


async function handleAnalyzeClick() {
  await refreshAuth();
  if (!signedIn()) return showSignedOutPanel("activity", "score this profile’s activity");
  return toggleScorePanel("activity", {
    canRender: (data) => !!data, render: renderPanel, openForm: openActivityForm,
  });
}

async function handleIcpClick() {
  await refreshAuth();
  if (!signedIn()) return showSignedOutPanel("icp", "score this profile against your ICP");
  // What was stored is the whole analyze response, which is also what a fresh calculate
  // renders. Passing `.result` handed over the bare ScoreResult with no `icp` on it, so
  // the panel could not recognise its own stored score.
  return toggleScorePanel("icp", {
    canRender: isScoredResult,
    render: (data, savedAt) => renderIcpResult(data, 0, savedAt),
    openForm: openIcpForm,
    refresh: refreshIcpFromAdmin,
  });
}

// A stored ICP score is the admin's answer at the moment it was calculated, and the
// admin can score the lead again afterwards - a new ICP version, Re-analyze, a bulk
// re-score. The panel then asks for the lead's newest analysis and shows that, so the
// two never disagree. Nothing is collected from LinkedIn again: this is the admin's
// stored result, read back.
async function refreshIcpFromAdmin(stored) {
  const leadId = stored && stored.leadId;
  if (!leadId) return;
  const key = scoreStoreKey();
  const url = profileKeyUrl();
  const res = await new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type: "li-admin", action: "lead", leadId }, resolve); }
    catch (e) { resolve(null); }
  });
  const lead = res && res.ok ? res.data : null;
  if (!lead || !lead.result || !lead.analysisId || lead.analysisId === stored.analysisId) return;
  const r = lead.result;
  const fresh = Object.assign({}, stored, {
    analysisId: lead.analysisId,
    analyzedAt: lead.analyzedAt || stored.analyzedAt,
    score: r.score, band: r.band, bandLabel: r.bandLabel, earned: r.earned, possible: r.possible, result: r,
    classification: lead.classification || stored.classification,
    icp: { id: lead.icpId, name: lead.icpName || (stored.icp || {}).name, version: lead.scoredIcpVersion || lead.icpVersion },
  });
  await saveStoredScore("icp", fresh, key);
  updateLead(url, stored.profileName || "", { icpScore: r.score || 0, icpBand: r.bandLabel || "" });
  if (scoreStoreKey() !== key || !document.getElementById("li-icp-body")) return;   // moved on: saved, not shown
  renderIcpResult(fresh, 0, Date.parse(lead.analyzedAt) || Date.now());
}
