// LinkedIn AI Analyzer content script - Rendering the Activity result.
// One of the content/*.js files manifest.json loads in order into the same page world.

// ─── Render Panel ──────────────────────────────────────────────────────────────
// Shows the server's numbers as-is: the panel, the lead log and the AI all use
// the same score.
const SIGNAL_NAMES = { hiring: "Hiring", job: "Promotion", growth: "Growth" };
const COMPLETENESS_NAMES = { photo: "photo", headline: "headline", about: "About", experience: "experience", company: "company" };

// Same wording as the server's time_ago(); recomputed at render time so a stored
// score never keeps saying "Last posted yesterday" a week after it was saved.
function liTimeAgoText(d) {
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((Date.now() - d.getTime()) / 3600000);
    return hours > 0 ? `${hours}h ago` : "today";
  }
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7);  return `${w} week${w > 1 ? "s" : ""} ago`; }
  if (days < 365) { const m = Math.floor(days / 30); return `${m} month${m > 1 ? "s" : ""} ago`; }
  const y = Math.floor(days / 365); return `${y} year${y > 1 ? "s" : ""} ago`;
}

// The Recent Activity line for an /analyze result. With the post's real date
// (activity_date) the relative phrase is rebuilt NOW and the exact local date
// and time is shown; older stored scores without it keep the server's text.
//
// The post's own words are left out. This factor scores WHEN they last posted, not what
// they said, and a quoted opening line ran past the row, pushed the date out of view and
// read as if it were evidence for the points. The line still links to the post.
function liActivityText(data) {
  const raw = ((data && data.activity) || "No activity data").replace(/\s—\s".*$/, "");
  const d = data && data.activity_date ? new Date(data.activity_date) : null;
  if (!d || isNaN(d.getTime())) return raw;
  const abs = d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const verb = /^reposted/i.test(raw) ? "Reposted someone else's post" : "Last posted";
  return `${verb} ${liTimeAgoText(d)} (${abs})`;
}

// The six Activity factors of an /analyze result. The Activity panel draws these and the
// same list is sent to the admin, so the breakdown there is this one, word for word.
function activityFactors(data) {
  // Server-side maxima (editable points); older stored scores use the defaults
  const max = {
    activity: data.max_activity ?? 30, posts: data.max_posts ?? 20, engagement: data.max_engagement ?? 20,
    completeness: data.max_completeness ?? 10, signals: data.max_signals ?? 20,
  };
  const engagement = data.engagement_label || "No data";
  const engDetail = /^no data/i.test(engagement) ? engagement
    : `${engagement} · avg ${data.avg_likes || 0} likes, ${data.avg_comments || 0} comments, ${data.avg_reposts || 0} reposts per post`;
  const missing = (data.completeness_missing || []).map((k) => COMPLETENESS_NAMES[k] || k);
  const hits = Object.entries(data.signal_hits || {}).filter(([, kw]) => kw);
  const signalDetail = hits.length
    ? hits.map(([list, kw]) => `${SIGNAL_NAMES[list] || list}: "${kw}"`).join(" · ")
    : ("signal_hits" in data ? "No hiring or growth words found" : "");
  return [
    { key: "activity",     label: "Recent Activity",       score: data.score_activity || 0,     max: max.activity,     detail: liActivityText(data) },
    { key: "posts",        label: "Posting Frequency",     score: data.score_posts || 0,        max: max.posts,        detail: `${data.posts_90_days || 0} posts in 90 days · ${data.posts_30_days || 0} in the last 30` },
    { key: "engagement",   label: "Engagement Level",      score: data.score_engagement || 0,   max: max.engagement,   detail: engDetail },
    { key: "completeness", label: "Profile Completeness",  score: data.score_completeness || 0, max: max.completeness,
      detail: missing.length ? "Missing: " + missing.join(", ") : ("completeness_missing" in data ? "Nothing missing" : "") },
    { key: "signals",      label: "Hiring/Growth Signals", score: data.score_signals || 0,      max: max.signals,      detail: signalDetail },
  ];
}

function renderPanel(data, storedAt, opts) {
  applyTheme();
  const body = freshPanelBody("li-ai-body");
  if (!body) return;
  const scraped         = safeScrape();
  const name            = profileDisplayName(data.name, scraped.name);
  const country         = data.country         || "Not specified";
  const current_company = data.current_company || "Not specified";
  const activity        = liActivityText(data);
  const activity_url    = /^https?:\/\//i.test(data.activity_url || "") ? data.activity_url : "";

  const score_total = data.score_total || 0;
  const score_label = data.score_label ||
    (score_total >= 70 ? "🟢 Ready to Engage" : score_total >= 40 ? "🟡 Needs Nurturing" : "🔴 Difficult to Engage");

  let scoreColor = "var(--li-bad)";
  if (score_total >= 70) scoreColor = "var(--li-ok)";
  else if (score_total >= 40) scoreColor = "var(--li-warn)";

  let activityHTML = liEsc(activity);
  if (activity_url) {
    activityHTML = `<a href="${liEsc(activity_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--li-blue);text-decoration:none;font-weight:600;">${liEsc(activity)}</a>`;
  } else if (/\b(ago|today|yesterday)\b/i.test(activity)) {
    activityHTML = `<strong style="color:var(--li-ok);">⏱️ ${liEsc(activity)}</strong>`;
  } else if (/recent/i.test(activity)) {
    activityHTML = `<strong style="color:var(--li-warn);">⏱️ ${liEsc(activity)}</strong>`;
  }

  // Recent Activity keeps its link to the post here; everywhere else it is plain text.
  const scoreRows = activityFactors(data).map((f) =>
    f.key === "activity" ? { label: f.label, score: f.score, max: f.max, rawDetail: activityHTML } : f);
  const n = data.posts_analyzed || 0;
  const basis = n ? `Based on ${n} recent post${n === 1 ? "" : "s"} plus the profile.`
    : data.data_source === "form" ? "No data from Apify — scored from the values you typed only." : "";

  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div>
        ${name ? `<div data-li-name style="font-size:17px;font-weight:700;color:var(--li-fg);">${liEsc(name)}</div>` : ""}
        ${[current_company, country].filter(v => v && v !== "Not specified").length
          ? `<div style="font-size:12px;color:var(--li-muted);">${liEsc([current_company, country].filter(v => v && v !== "Not specified").join(" • "))}</div>` : ""}
      </div>
      <button type="button" class="li-btn li-btn-ghost" id="li-ai-edit">✏️ Edit Details</button>
    </div>
    ${data.scrape_warning ? `<div class="li-form-note" style="border-color:var(--li-warn-border);background:var(--li-warn-bg);color:var(--li-warn-fg);">⚠️ ${liEsc(data.scrape_warning)}</div>` : ""}
    ${storedAt ? `<div class="li-form-note">💾 Stored score from <strong>${liEsc(fmtSavedAt(storedAt))}</strong> — press <strong>Edit Details</strong> to calculate a fresh one.</div>` : ""}
    <div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
        ${scoreRingHTML(score_total, scoreColor, { label: "Activity score" })}
        <div>
          <div style="font-size:16px;color:var(--li-fg);font-weight:700;">${liEsc(score_label)}</div>
          ${basis ? `<div style="font-size:12px;color:var(--li-muted);margin-top:5px;">${liEsc(basis)}</div>` : ""}
        </div>
      </div>
      <div style="border-top:1px solid var(--li-border);padding-top:14px;">
        ${scoreRowsHTML(scoreRows, "var(--li-ok)")}
      </div>
    </div>
  `;
  document.getElementById("li-ai-edit").onclick = () => openActivityForm();
  if (opts && opts.fresh) revealFreshScore(body);
}
