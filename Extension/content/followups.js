// LinkedIn AI Analyzer content script - Remembering what was sent, to whom, and when.
// One of the content/*.js files manifest.json loads in order into the same page world.

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
