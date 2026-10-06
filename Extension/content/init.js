// LinkedIn AI Analyzer content script - Start-up: theme, the tick loop, observers.
// One of the content/*.js files manifest.json loads in order into the same page world.

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
  // Leaving a profile tears down both buttons and both panels; the next tick rebuilds them.
  for (const p of Object.values(PANELS)) for (const id of [p.btnId, p.id]) document.getElementById(id)?.remove();
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
loadFeatures();                      // this ICP's switches, before the first buttons go in
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
      noteConversation(history, chatProfileUrl(ed, name.split(/\s+/)[0]), name);
    } catch (err) { /* ignore */ }
  }, 150);
}, true);

// Signing in or out in the popup reaches every open LinkedIn tab (content/auth.js).
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[LI_AUTH_KEY]) return;
    _liAuth = changes[LI_AUTH_KEY].newValue || null;
    const stale = signedIn() ? isLockedUI : () => true;
    for (const p of Object.values(PANELS)) {
      const panel = document.getElementById(p.id);
      if (panel && stale(panel)) panel.remove();
    }
    openSpark.slice().forEach((rec) => {
      try { if (stale(rec.box)) removeSparkRec(rec); } catch (e) { /* already gone */ }
    });
  });
} catch (e) { /* no storage events: the check on every click still holds */ }

refreshAuth();
