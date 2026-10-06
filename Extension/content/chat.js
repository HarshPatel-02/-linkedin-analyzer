// LinkedIn AI Analyzer content script - Finding message boxes and reading the conversation.
// One of the content/*.js files manifest.json loads in order into the same page world.

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
const AI_ROW_LABEL_CSS = "flex:0 0 auto;min-width:58px;margin-right:2px;";
const AI_MINI_CSS = "padding:3px 10px;border:1px solid var(--li-border-2,#cbd5e1);border-radius:999px;background:var(--li-input-bg,#fff);color:var(--li-fg-2,#374151);font-size:11px;font-weight:700;cursor:pointer;";

// ✨ popup analyses this many recent chat messages (the backend caps the length).
const AI_HISTORY_LIMIT = 40;

// Profile bits for the AI — only when the profile on screen is the chat partner
// (a chat overlay can be open over someone else's profile page).
function aiProfileContext(first) {
  let prof = {};
  try { prof = scrapeProfile() || {}; } catch (e) { return {}; }
  const pname = String(prof.name || "").split("\n")[0].trim();
  if (!pname || !first || pname.split(/\s+/)[0].toLowerCase() !== String(first).toLowerCase()) return {};
  // Only the name: who they are comes from the lead log (Apify), via getLeadScores.
  return { name: pname };
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
