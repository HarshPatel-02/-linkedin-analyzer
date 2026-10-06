// LinkedIn AI Analyzer content script - The ✨ popup: fetching suggestions, placing and drawing it, the spark buttons.
// One of the content/*.js files manifest.json loads in order into the same page world.

// POST to the backend (/suggest-messages → OpenRouter). The result is cached
// under cacheKey; render() shows it only if that key is still current.
async function fetchAiSuggestions(record, req, cacheKey, render) {
  if (record.pending[cacheKey] || record.cache[cacheKey]) return;
  record.pending[cacheKey] = true;
  let entry;
  try {
    const scores = await getLeadScores(req.profileUrl, req.fullName);
    // Invite notes: the invitee's profile + saved ICP / Activity analysis. Chats: light
    // profile context when the chat partner's profile is the page on screen.
    const about = req.context === "invite" ? await inviteAnalysis(req.target) : aiProfileContext(req.first);
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
      ...about,
      sender_role: req.role || "",
    });
    const list = (data.suggestions || []).filter((s) => typeof s === "string" && s.trim());
    if (!list.length) throw new Error("no suggestions returned");
    entry = { list, pain: data.pain_point || "", painSource: data.pain_source || "", analysis: data.analysis || "",
              intent: data.intent || "", needsFollowUp: data.needs_follow_up === true,
              source: data.source || "ai", notice: data.notice || "",
              basis: req.context === "invite" ? noteBasis({ ...scores, ...about }) : [] };
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
    // horizontally CENTERED over the message box, clamped inside the viewport
    const centerX = r.left + (r.width - w) / 2;
    const next = {
      position: "fixed", width: w + "px", left: Math.round(Math.max(8, Math.min(centerX, vw - w - 8))) + "px",
      overflowY: "auto", zIndex: "99999", top: "", bottom: "", maxHeight: "",
    };

    // bottom edge sits just ABOVE the send button (bottom-right corner of the box)
    let anchorY = opts.above ? r.top - 4 : r.bottom - 8;
    if (!opts.above) {
      try {
        const send = el.querySelector('.msg-form__send-btn, .msg-form__send-button, button[type="submit"], .artdeco-button--circle');
        if (send) { const sr = send.getBoundingClientRect(); if (sr.height) anchorY = sr.bottom - 4; }   // ~36px lower
      } catch (e) { /* ignore */ }
    }

    // Full content height WITHOUT lifting max-height: un-setting it, even for one
    // measurement, collapses the scroll box and throws the reader back to the top.
    const need = box.scrollHeight || 220;
    const maxH = Math.round(vh * 0.48);
    const spaceAbove = anchorY - 8;                // anchor → viewport top
    const spaceBelow = vh - anchorY - 8;           // anchor → viewport bottom

    if (spaceAbove >= Math.min(need, 200)) {
      // grow upward from the send button, never past the top of the screen
      next.bottom = Math.round(vh - anchorY) + "px";
      next.maxHeight = Math.max(140, Math.min(maxH, spaceAbove - 8)) + "px";
    } else if (spaceBelow >= Math.min(need, 200)) {
      // no room above → drop below the anchor instead
      next.top = Math.round(anchorY + 8) + "px";
      next.maxHeight = Math.min(spaceBelow, maxH) + "px";
    } else if (spaceAbove >= spaceBelow) {
      // squeeze between the top of the screen and the anchor:
      // top + bottom both set → exact fit, header row stays visible, body scrolls
      next.top = "8px";
      next.bottom = Math.round(vh - anchorY) + "px";
      next.maxHeight = "none";
    } else {
      next.top = Math.round(anchorY + 8) + "px";
      next.bottom = "8px";
      next.maxHeight = "none";
    }

    // Touch only what changed (this runs on every page tick) and keep the scroll spot
    const scroll = box.scrollTop;
    for (const [k, v] of Object.entries(next)) if (box.style[k] !== v) box.style[k] = v;
    if (box.scrollTop !== scroll) box.scrollTop = scroll;
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
// Tone pills on every ✨ AI note / AI suggestion — the tones the backend writes in.
const TONES = [["casual", "Casual", "Warm and friendly, in plain words"],
               ["pro", "Pro", "Professional: formal, concise, no emoji"]];
const TONE_ON_CSS = {
  casual: "background:var(--li-purple,#7c3aed);color:var(--li-purple-fg,#fff);border-color:var(--li-purple,#7c3aed);",
  pro:    "background:var(--li-blue-fill,#0a66c2);color:var(--li-blue-fg,#fff);border-color:var(--li-blue-fill,#0a66c2);",
};

// Drawn icons for the ✨ popup header (one stroke weight, follow text color).
const ICON_REFRESH = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3.2h-3.2"/></svg>';
const ICON_CLOSE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

// opts.context = "invite" → Connect → "Add a note" box (no chat history,
// LinkedIn's own character limit, popup opens above the note box).
// The ✨ popup's shell with the sign-in block in it. It joins `openSpark` like a
// real one, so the page tick keeps it in place, a dead composer prunes it, and ✕
// closes it — every rule that governs the AI popup governs this too.
function openSignedOutSpark({ form, editable, spark, anchor, invite }) {
  const box = document.createElement("div");
  box.className = "li-ai-popup";
  box.style.cssText = AI_BOX_CSS + "position:relative;";
  box.innerHTML = '<button type="button" class="li-signout-close" data-act="close" aria-label="Close">×</button>' +
    signedOutHTML(invite ? "write this connection note" : "write with AI here");
  const record = { form, editable, box, spark, anchor, context: invite ? "invite" : "chat" };
  record.place = () => placeSparkBox((record.anchor && record.anchor.isConnected) ? record.anchor : record.form, box, { above: invite });
  record.removeBox = () => removeSparkRec(record);
  box.querySelector('[data-act="close"]').onclick = record.removeBox;
  wireSignInPrompt(box);
  openSpark.push(record);
  document.body.appendChild(box);
  record.place();
  try { spark.style.background = "rgba(124,58,237,.15)"; } catch (e) {}
}

async function toggleAiPopup(editable, spark, opts) {
  opts = opts || {};
  const prefs = await loadAiPrefs();
  await refreshAuth();
  // Chats on /messaging or the feed need the theme set too, or the popup stays light.
  try { applyTheme(); } catch (e) { /* inline fallbacks still apply */ }
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

  if (!signedIn()) { openSignedOutSpark({ form, editable, spark, anchor, invite }); return; }

  const box = document.createElement("div");
  box.className = "li-ai-popup";
  box.style.cssText = AI_BOX_CSS;
  // action/draft set = "Your draft" rewrite view; notice = one-off hint line
  const state = { tone: cleanTone(editable._liTone || lastAiTone), action: "", draft: "", notice: "",
                  role: prefs.senderRole || "" };
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
          (entry.painSource ? " (from " + liEsc(entry.painSource) + ")" : "") + ": <strong>" + liEsc(entry.pain) + "</strong></div>"
        : "";
      const heading = state.action
        ? '<div style="font-size:11px;font-weight:700;color:var(--li-muted,#6b7280);margin:2px 0;">Rewrites of your draft — click to replace it</div>'
        : "";
      // The AI's read of where the chat stands, so you can see why it suggests what it does
      const lineCss = "margin:0 0 6px;padding:6px 10px;border-radius:8px;background:var(--li-surface-2,#f3f4f6);color:var(--li-fg-2,#374151);font-size:11.5px;line-height:1.4;";
      // What they are asking for, so the suggestion can be read and sent without
      // wading through the model's reasoning. Falls back to the older analysis line.
      const intentLine = entry.intent && !state.action && !invite
        ? '<div data-role="intent" style="' + lineCss + '"><strong>They’re asking:</strong> ' +
          liEsc(entry.intent) +
          (entry.needsFollowUp ? ' · <span style="color:var(--li-warn-fg,#92400e);">needs a follow-up</span>' : "") +
          "</div>"
        : "";
      const analysisLine = entry.analysis && !state.action && !intentLine
        ? '<div data-role="analysis" style="' + lineCss + '"><strong>' +
          (invite ? "Why this person:" : "Conversation (" + n + " message" + (n === 1 ? "" : "s") + " read):") +
          "</strong> " + liEsc(entry.analysis) + "</div>"
        : "";
      // Invite notes: what they were personalised from, and whether the AI or the template wrote them
      const basisLine = invite && !state.action && (entry.basis || []).length
        ? '<div data-role="basis" style="margin:0 0 6px;font-size:11px;line-height:1.4;color:var(--li-muted,#6b7280);">Personalized from: ' +
          liEsc(entry.basis.join(" · ")) + "</div>"
        : "";
      const noticeLine = entry.source === "template" && entry.notice
        ? '<div data-role="notice" role="status" style="margin:0 0 6px;font-size:11px;line-height:1.4;color:var(--li-warn-fg,#92400e);">Template — ' +
          liEsc(entry.notice) + "</div>"
        : "";
      body = heading + intentLine + analysisLine + basisLine + noticeLine + painLine +
        entry.list.map((s) => '<button type="button" class="li-ai-sug" style="' + AI_ITEM_CSS + '">' + liEsc(s) + "</button>").join("");
    } else if (entry && entry.error) {
      body = '<div role="alert" style="padding:10px 12px;border:1px solid #fca5a5;border-radius:8px;background:rgba(239,68,68,.08);color:var(--li-fg,#111827);font-size:12.5px;line-height:1.45;">' +
        "⚠️ AI unavailable — " + liEsc(entry.error) +
        '<div style="margin-top:8px;"><button type="button" data-act="retry" style="' + AI_MINI_CSS + '">Retry</button></div></div>';
    } else {
      const loading = state.action ? "✍️ Rewriting your draft…"
        : (!n && state.tone === "pro") ? "🔎 Reading their recent posts to find the real pain point… (first time can take up to a minute)"
        : n ? `✨ Reading ${n} message${n === 1 ? "" : "s"} and writing replies…`
        : "✨ Generating suggestions…";
      body = '<div role="status" style="padding:14px 12px;font-size:12.5px;color:var(--li-muted,#6b7280);">' + loading + "</div>";
    }
    // Tone belongs to the message being written, not to a saved setting: pick it
    // here and the suggestions below are rewritten in it.
    const toneRow =
      '<div role="group" aria-label="Message tone" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:8px 0 0;font-size:11px;color:var(--li-muted,#6b7280);">' +
      '<span style="' + AI_ROW_LABEL_CSS + '">Tone:</span>' +
      TONES.map(([k, label, hint]) => '<button type="button" data-tone="' + k + '" title="' + liEsc(hint) + '" aria-pressed="' + (state.tone === k) +
        '" style="' + AI_MINI_CSS + (state.tone === k ? TONE_ON_CSS[k] : "") + '">' + label + "</button>").join("") +
      "</div>";
    const draftRow =
      '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:6px 0 2px;font-size:11px;color:var(--li-muted,#6b7280);">' +
      '<span style="' + AI_ROW_LABEL_CSS + '">Your draft:</span>' +
      DRAFT_ACTIONS.map(([k, label]) => '<button type="button" data-draft="' + k + '" aria-pressed="' + (state.action === k) + '" style="' + AI_MINI_CSS +
        (state.action === k ? "background:#7c3aed;color:#fff;border-color:#7c3aed;" : "") + '">' + label + "</button>").join("") +
      (state.action ? '<button type="button" data-act="back" style="' + AI_MINI_CSS + '">← Suggestions</button>' : "") +
      (state.notice ? '<span role="status" style="flex-basis:100%;color:var(--li-warn-fg,#92400e);margin-top:2px;">' + liEsc(state.notice) + "</span>" : "") +
      "</div>";
    const html =
      '<div style="position:sticky;top:-12px;margin:-12px -12px 0;padding:12px 12px 4px;background:var(--li-bg,#fff);display:flex;justify-content:space-between;align-items:center;gap:8px;border-radius:10px 10px 0 0;z-index:2;box-shadow:0 1px 0 var(--li-border,#e5e7eb);">' +
      '<span style="font-size:11px;font-weight:800;letter-spacing:.6px;color:var(--li-blue,#0a66c2);">' + (invite ? "AI NOTE" : "AI SUGGESTIONS") + "</span>" +
      '<span style="display:flex;gap:4px;align-items:center;">' +
      (state.role ? '<span title="' + liEsc("Sending as: " + state.role + " — change it from the extension icon → My pitch") + '" style="max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:700;color:var(--li-muted,#6b7280);padding:2px 4px;">as ' + liEsc(state.role) + "</span>" : "") +
      '<button type="button" data-act="refresh" title="Generate new AI suggestions" aria-label="Generate new AI suggestions" style="' + AI_MINI_CSS + 'padding:4px 8px;display:inline-flex;align-items:center;">' + ICON_REFRESH + "</button>" +
      '<button type="button" data-act="close" title="Close" aria-label="Close AI suggestions" style="background:none;border:none;padding:4px;border-radius:6px;cursor:pointer;color:var(--li-muted,#6b7280);display:inline-flex;align-items:center;">' + ICON_CLOSE + "</button>" +
      "</span></div>" +
      toneRow +
      draftRow +
      '<div style="height:4px;"></div>' +
      body;
    state.notice = "";
    // The page tick repaints often: an unchanged popup is left alone, so the reader's
    // scroll position (and focus) survive; the same view keeps its scroll after a rebuild.
    if (html === record.lastHtml) { record.place(); return; }
    const keepScroll = record.lastViewKey === v.cacheKey ? box.scrollTop : 0;
    box.innerHTML = html;
    record.lastHtml = html;
    record.lastViewKey = v.cacheKey;
    box.querySelector('[data-act="close"]').onclick = removeBox;
    box.querySelector('[data-act="refresh"]').onclick = (e) => { e.preventDefault(); paint({ force: true }); };
    const retry = box.querySelector('[data-act="retry"]');
    if (retry) retry.onclick = (e) => { e.preventDefault(); paint({ force: true }); };
    const back = box.querySelector('[data-act="back"]');
    if (back) back.onclick = (e) => { e.preventDefault(); state.action = ""; state.draft = ""; paint(); };
    box.querySelectorAll("[data-tone]").forEach((b) => { b.onclick = (e) => { e.preventDefault(); if (state.tone === b.dataset.tone) return; state.tone = rememberAiTone(b.dataset.tone); paint(); }; });
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
    box.scrollTop = keepScroll;
  };

  // opts.force = drop the cached answer (↻ / Retry); opts.debounce = live refresh,
  // wait for the thread to settle so a burst of DOM mutations = one request.
  const paint = (opts) => {
    opts = opts || {};
    const history = invite ? [] : scrapeChatMessages(editable, AI_HISTORY_LIMIT);
    const target = invite ? (record.target || (record.target = inviteTarget(editable))) : null;
    const fullName = invite ? target.fullName : chatFullName(editable, history);
    const first = invite ? target.first : chatFirstName(editable, history);
    editable._liTone = state.tone;
    const histKey = history.map((m) => m.sender + ":" + m.text).join("|");
    box.dataset.histKey = histKey;
    const profileUrl = invite ? target.url : chatProfileUrl(editable, first);
    if (editable._liLoggedKey !== histKey) {
      editable._liLoggedKey = histKey;
      try { console.log("[LI-AI] scraped chat history (" + history.length + "):", history.map((m) => "[" + (m.sender || "?") + "] " + m.text)); } catch (e) {}
      noteConversation(history, profileUrl, fullName);
    }
    // Person + mode are part of the key: an empty history ("") must not reuse another chat's openers.
    const act = state.action ? state.action + ":" + state.draft : "";
    const cacheKey = [record.context, first, profileUrl, histKey, state.tone, state.role, act].join("|");
    if (opts.force && !record.pending[cacheKey]) delete record.cache[cacheKey];
    record.view = { history, first, cacheKey, tone: state.tone, profileUrl };
    render();
    if (record.cache[cacheKey] || record.pending[cacheKey]) return;
    clearTimeout(record.fetchTimer);
    const req = { history, first, fullName, target, tone: state.tone, role: state.role, profileUrl, context: record.context, maxChars,
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
  spark.title = `AI Suggestions — reads this conversation (up to ${AI_HISTORY_LIMIT} messages)`;
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
  if (!chatSparkOn()) return;          // the ICP's Conversation analysis / Reply generation switches
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
  try { if (featureOn("messageGeneration")) injectInviteSpark(); } catch (e) { /* never break the invite dialog */ }
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
