const POLL_MS = 3000;
const PAGE_SIZE = 50;

const KEYWORDS = {
  risk: [
    "concerned", "concern", "worry", "worried", "problem", "issue",
    "blocker", "blocked", "stuck", "frustrated", "frustrating",
    "risk", "delay", "delayed", "broken", "bug", "fail", "failed",
  ],
  positive: [
    "great", "awesome", "love", "perfect", "agree", "agreed",
    "excited", "fantastic", "amazing", "win", "wins", "celebrate",
    "shipped", "launched",
  ],
  strategic: [
    "roadmap", "plan", "vision", "strategy", "strategic", "north star",
    "OKR", "OKRs", "Q1", "Q2", "Q3", "Q4", "FY", "milestone",
    "initiative", "priority",
  ],
};

const els = {
  contextBar: document.getElementById("context-bar"),
  contextTitle: document.getElementById("context-title"),
  contextSub: document.getElementById("context-sub"),
  contextAction: document.getElementById("context-action"),
  authView: document.getElementById("auth-view"),
  listView: document.getElementById("list-view"),
  transcriptView: document.getElementById("transcript-view"),
  authInstance: document.getElementById("auth-instance"),
  authError: document.getElementById("auth-error"),
  loginBtn: document.getElementById("login-btn"),
  openOptions: document.getElementById("open-options"),
  searchInput: document.getElementById("search-input"),
  meetings: document.getElementById("meetings"),
  listStatus: document.getElementById("list-status"),
  transcriptTitle: document.getElementById("transcript-title"),
  transcriptSub: document.getElementById("transcript-sub"),
  transcriptSearch: document.getElementById("transcript-search"),
  transcriptSearchCount: document.getElementById("transcript-search-count"),
  speakerChips: document.getElementById("speaker-chips"),
  messagesWrap: document.querySelector(".messages-wrap"),
  messages: document.getElementById("messages"),
  jumpLatest: document.getElementById("jump-latest"),
  jumpLatestText: document.getElementById("jump-latest-text"),
  transcriptStatus: document.getElementById("transcript-status"),
  liveToggle: document.getElementById("live-toggle"),
  openInSf: document.getElementById("open-in-sf"),
  recordingBtn: document.getElementById("recording-btn"),
  noteBtn: document.getElementById("note-btn"),
  transcriptPane: document.getElementById("transcript-pane"),
  workflowPane: document.getElementById("workflow-pane"),
  insightsPane: document.getElementById("insights-pane"),
  insightsList: document.getElementById("insights-list"),
  coachingPane: document.getElementById("coaching-pane"),
  coachingGenerate: document.getElementById("coaching-generate"),
  coachingMode: document.getElementById("coaching-mode"),
  coachingOutput: document.getElementById("coaching-output"),
  coachingStatus: document.getElementById("coaching-status"),
  coachingMeta: document.getElementById("coaching-meta"),
  workflowHeader: document.getElementById("workflow-header"),
  actionsList: document.getElementById("actions-list"),
  workflowStatus: document.getElementById("workflow-status"),
  tabs: document.querySelectorAll(".tab"),
  backBtn: document.getElementById("back-btn"),
  refreshBtn: document.getElementById("refresh-btn"),
  settingsBtn: document.getElementById("settings-btn"),
  signoutBtn: document.getElementById("signout-btn"),
};

let currentMeeting = null;
let pollTimer = null;
let lastSearchTerm = "";
let lastMatchedMeetingId = null;
let lastTabUrl = null;
let userOpenedManually = false;

let allMessages = [];
let transcriptSearchTerm = "";
let activeSpeakerFilter = null;
let lastRenderedCount = 0;
let unseenCount = 0;
let instanceUrl = "";
let activeTab = "transcript";
let workflowLoaded = false;
let lastCoachingMode = null;
const statusOptionsCache = new Map();

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      if (chrome.runtime.lastError)
        return reject(new Error(chrome.runtime.lastError.message));
      if (!resp || !resp.ok) return reject(new Error(resp?.error || "Failed"));
      resolve(resp.data);
    });
  });
}

function show(view) {
  for (const v of [els.authView, els.listView, els.transcriptView]) {
    v.classList.add("hidden");
  }
  view.classList.remove("hidden");
  els.backBtn.classList.toggle("hidden", view !== els.transcriptView);
  els.refreshBtn.classList.toggle("hidden", view === els.authView);
}

async function init() {
  const cfg = await chrome.storage.local.get(["instanceUrl", "clientId"]);
  instanceUrl = cfg.instanceUrl || "";
  if (!cfg.instanceUrl || !cfg.clientId) {
    els.authInstance.textContent =
      "Set the instance URL and Client ID in settings first.";
    els.signoutBtn.classList.add("hidden");
    show(els.authView);
    return;
  }
  els.authInstance.textContent = `Org: ${cfg.instanceUrl}`;

  const status = await send("auth.status");
  if (!status.authenticated) {
    els.signoutBtn.classList.add("hidden");
    show(els.authView);
    return;
  }
  els.signoutBtn.classList.remove("hidden");
  await loadMeetings();
  show(els.listView);
  watchActiveTab();
  evaluateActiveTab();
}

function watchActiveTab() {
  chrome.tabs.onActivated.addListener(() => evaluateActiveTab());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === "complete") evaluateActiveTab();
  });
}

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0]?.url || null;
}

async function evaluateActiveTab() {
  const url = await getActiveTabUrl();
  if (url === lastTabUrl) return;
  lastTabUrl = url;
  if (!url) {
    hideContextBar();
    return;
  }
  let result;
  try {
    result = await send("sf.matchMeeting", { url });
  } catch (e) {
    hideContextBar();
    return;
  }
  if (!result.matched) {
    hideContextBar();
    return;
  }
  renderContextBar(result);
  if (
    !userOpenedManually &&
    lastMatchedMeetingId !== result.topRecord.Id
  ) {
    lastMatchedMeetingId = result.topRecord.Id;
    openTranscript(result.topRecord);
  }
}

function hideContextBar() {
  els.contextBar.classList.add("hidden");
  els.contextBar.classList.remove("live", "other");
}

function renderContextBar(result) {
  const r = result.topRecord;
  const live = r.ple__Meeting_Status__c === "Processing";
  els.contextBar.classList.remove("hidden", "live", "other");
  els.contextBar.classList.add(live ? "live" : "other");
  if (!result.topIsOwn) els.contextBar.classList.add("other");
  els.contextTitle.textContent = r.Name || "Matched meeting";
  const who = result.topIsOwn ? "Your bot" : `Bot owned by ${r.Owner?.Name || "another user"}`;
  const when = live ? "live now" : formatRelative(r.ple__Start_Time__c || r.CreatedDate);
  const extra =
    result.totalCandidates > 1
      ? ` · +${result.totalCandidates - 1} other capture${result.totalCandidates - 1 === 1 ? "" : "s"}`
      : "";
  els.contextSub.textContent = `${who} · ${when}${extra}`;
  els.contextAction.onclick = () => {
    userOpenedManually = false;
    openTranscript(r);
  };
}

async function loadMeetings(searchTerm = "") {
  els.meetings.innerHTML = "";
  els.listStatus.textContent = "Loading…";
  const where = buildSearchWhere(searchTerm);
  const soql =
    `SELECT Id, Name, AccountPulse__c, AccountPulse__r.Name, ` +
    `ple__Meeting_Status__c, ple__Start_Time__c, ple__End_Time__c, CreatedDate ` +
    `FROM ple__Meeting__c ${where} ORDER BY ple__Start_Time__c DESC NULLS LAST, CreatedDate DESC LIMIT ${PAGE_SIZE}`;
  try {
    const data = await send("sf.query", { soql });
    renderMeetings(data.records || []);
    els.listStatus.textContent = data.records?.length
      ? `${data.records.length} meetings`
      : "No meetings found.";
  } catch (e) {
    els.listStatus.textContent = e.message;
  }
}

function buildSearchWhere(term) {
  if (!term) return "";
  const safe = term.replace(/'/g, "\\'");
  return `WHERE Name LIKE '%${safe}%' OR AccountPulse__r.Name LIKE '%${safe}%'`;
}

function renderMeetings(rows) {
  els.meetings.innerHTML = "";
  for (const m of rows) {
    const item = document.createElement("button");
    item.className = "meeting-item";
    const status = m.ple__Meeting_Status__c;
    const live = status === "Processing";
    const done = status === "Done";
    const startMs = m.ple__Start_Time__c ? new Date(m.ple__Start_Time__c).getTime() : null;
    const endMs = m.ple__End_Time__c ? new Date(m.ple__End_Time__c).getTime() : null;
    const duration =
      startMs && endMs ? formatDuration(endMs - startMs) : null;
    item.innerHTML = `
      <div class="meeting-row-top">
        <span class="status-dot ${live ? "live" : done ? "done" : "idle"}"></span>
        <div class="meeting-name">${escapeHtml(m.Name || "Untitled")}</div>
      </div>
      <div class="meeting-sub muted small">
        ${escapeHtml(m.AccountPulse__r?.Name || "—")}
        · ${formatRelative(m.ple__Start_Time__c || m.CreatedDate)}
        ${duration ? `· ${duration}` : ""}
        ${live ? `· <span class="live-pill">live</span>` : ""}
      </div>
    `;
    item.addEventListener("click", () => {
      userOpenedManually = true;
      openTranscript(m);
    });
    els.meetings.appendChild(item);
  }
}

async function openTranscript(meeting) {
  currentMeeting = meeting;
  els.transcriptTitle.textContent = meeting.Name || "Transcript";
  els.transcriptSub.textContent =
    (meeting.AccountPulse__r?.Name || "") +
    " · " +
    formatRelative(meeting.ple__Start_Time__c || meeting.CreatedDate);
  els.messages.innerHTML = "";
  els.actionsList.innerHTML = "";
  els.workflowHeader.innerHTML = "";
  els.workflowStatus.textContent = "";
  els.coachingOutput.innerHTML = "";
  els.coachingStatus.textContent = "";
  els.coachingMeta.textContent = "";
  els.transcriptStatus.textContent = "Loading…";
  els.transcriptSearch.value = "";
  transcriptSearchTerm = "";
  activeSpeakerFilter = null;
  allMessages = [];
  lastRenderedCount = 0;
  unseenCount = 0;
  workflowLoaded = false;
  cachedWorkflowActions = null;
  updateRecordingButton(null);
  switchTab("transcript");
  updateJumpButton();
  show(els.transcriptView);
  await loadTranscript();
  startPolling();
}

function switchTab(name) {
  activeTab = name;
  els.tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  els.transcriptPane.classList.toggle("hidden", name !== "transcript");
  els.workflowPane.classList.toggle("hidden", name !== "workflow");
  els.coachingPane.classList.toggle("hidden", name !== "coaching");
  els.insightsPane.classList.toggle("hidden", name !== "insights");
  if (name === "workflow" && !workflowLoaded) loadWorkflow();
  if (name === "insights") renderInsights();
}

async function generateCoaching() {
  const mode = els.coachingMode.value;
  if (!currentMeeting) {
    els.coachingStatus.textContent = "Open a meeting first.";
    return;
  }
  if (!allMessages.length) {
    els.coachingStatus.textContent = "No transcript yet — wait until messages arrive.";
    return;
  }
  els.coachingGenerate.disabled = true;
  els.coachingGenerate.textContent = "Generating…";
  els.coachingStatus.textContent = "";
  els.coachingOutput.innerHTML = '<div class="coaching-loading">Thinking…</div>';
  try {
    const data = await send("ai.coach", {
      mode,
      messages: allMessages,
      meeting: {
        Name: currentMeeting.Name,
        AccountPulse__r: currentMeeting.AccountPulse__r,
      },
    });
    els.coachingOutput.innerHTML = renderMarkdown(data.text || "(no output)");
    lastCoachingMode = mode;
    const usage = data.usage || {};
    els.coachingMeta.textContent =
      usage.input_tokens || usage.output_tokens
        ? `${usage.input_tokens || 0} in · ${usage.output_tokens || 0} out tokens`
        : "";
  } catch (e) {
    els.coachingOutput.innerHTML = "";
    els.coachingStatus.textContent = e.message;
  } finally {
    els.coachingGenerate.disabled = false;
    els.coachingGenerate.textContent = "Generate coaching";
  }
}

function renderMarkdown(md) {
  if (!md) return "";
  const escaped = escapeHtml(md);
  const lines = escaped.split(/\r?\n/);
  const out = [];
  let listType = null;
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  let inPara = false;
  const flushPara = () => {
    if (inPara) {
      out.push("</p>");
      inPara = false;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      flushList();
      flushPara();
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushList();
      flushPara();
      const n = Math.min(4, h[1].length);
      out.push(`<h${n + 1}>${formatInline(h[2])}</h${n + 1}>`);
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.*)/);
    if (bullet) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${formatInline(bullet[1])}</li>`);
      continue;
    }
    const num = line.match(/^\d+\.\s+(.*)/);
    if (num) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${formatInline(num[1])}</li>`);
      continue;
    }
    flushList();
    if (!inPara) {
      out.push("<p>");
      inPara = true;
    } else {
      out.push("<br>");
    }
    out.push(formatInline(line));
  }
  flushList();
  flushPara();
  return out.join("");
}

function formatInline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(
      /(\bhttps?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}

function renderInsights() {
  els.insightsList.innerHTML = "";
  if (!allMessages.length) {
    els.insightsList.innerHTML =
      '<div class="empty muted small" style="margin: 24px auto; text-align: center;">No messages yet — insights will appear once the transcript starts.</div>';
    return;
  }

  // Speaker talk-share by approximate word count
  const speakerStats = new Map();
  let totalWords = 0;
  for (const m of allMessages) {
    const s = m.participantName || "Unknown";
    const words = (m.message || "").split(/\s+/).filter(Boolean).length;
    const cur = speakerStats.get(s) || { words: 0, count: 0 };
    cur.words += words;
    cur.count += 1;
    speakerStats.set(s, cur);
    totalWords += words;
  }

  // Keyword hits across categories with sample excerpts
  const hits = { risk: [], positive: [], strategic: [] };
  for (const m of allMessages) {
    const text = m.message || "";
    const speaker = m.participantName || "Unknown";
    const time = m.createDate ? new Date(m.createDate) : null;
    for (const [cat, words] of Object.entries(KEYWORDS)) {
      const re = new RegExp(`\\b(${words.map(escapeRegex).join("|")})\\b`, "gi");
      const found = text.match(re);
      if (found && found.length) {
        hits[cat].push({ text, speaker, time, matches: found });
      }
    }
  }

  els.insightsList.appendChild(
    insightsCard(
      "Meeting overview",
      "",
      `
      <div class="kv-grid">
        <div><b>${allMessages.length}</b><span>messages</span></div>
        <div><b>${speakerStats.size}</b><span>speakers</span></div>
        <div><b>${totalWords.toLocaleString()}</b><span>words</span></div>
      </div>
    `
    )
  );

  const speakersHtml = [...speakerStats.entries()]
    .sort((a, b) => b[1].words - a[1].words)
    .map(([name, st]) => {
      const pct = totalWords ? Math.round((st.words / totalWords) * 100) : 0;
      return `
        <div class="speaker-row">
          <div class="speaker-row-top">
            <span class="avatar small" style="background:${colorFor(name)}">${initials(name)}</span>
            <span class="speaker">${escapeHtml(name)}</span>
            <span class="muted small">${pct}% · ${st.count} msg</span>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%; background:${colorFor(name)}"></div></div>
        </div>
      `;
    })
    .join("");
  els.insightsList.appendChild(
    insightsCard("Talk share", "Approximate by word count.", speakersHtml)
  );

  for (const cat of ["risk", "positive", "strategic"]) {
    const list = hits[cat];
    if (!list.length) continue;
    const label = cat === "risk" ? "Risk mentions" : cat === "positive" ? "Positive moments" : "Strategic mentions";
    const samples = list.slice(0, 5).map((h) => `
      <div class="insight-snippet">
        <div class="muted small">${escapeHtml(h.speaker)}${h.time ? " · " + h.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</div>
        <div>${highlightCategory(h.text, cat)}</div>
      </div>
    `).join("");
    els.insightsList.appendChild(
      insightsCard(
        `${label} (${list.length})`,
        list.length > 5 ? `Showing 5 of ${list.length}` : "",
        samples,
        cat
      )
    );
  }
}

function insightsCard(title, subtitle, bodyHtml, cat = "") {
  const div = document.createElement("div");
  div.className = "insight-card" + (cat ? " insight-" + cat : "");
  div.innerHTML = `
    <div class="insight-title">${escapeHtml(title)}</div>
    ${subtitle ? `<div class="muted small">${escapeHtml(subtitle)}</div>` : ""}
    <div class="insight-body">${bodyHtml}</div>
  `;
  return div;
}

function highlightCategory(text, cat) {
  const words = KEYWORDS[cat] || [];
  let escaped = escapeHtml(text);
  if (words.length) {
    const re = new RegExp(`\\b(${words.map(escapeRegex).join("|")})\\b`, "gi");
    escaped = escaped.replace(re, `<span class="hl-${cat}">$1</span>`);
  }
  return escaped;
}

async function loadWorkflow() {
  if (!currentMeeting) return;
  workflowLoaded = true;
  cachedWorkflowActions = null;
  els.actionsList.innerHTML = "";
  els.workflowHeader.innerHTML = "";
  els.workflowStatus.textContent = "Loading workflow…";
  try {
    const data = await send("sf.fetchWorkflow", {
      meetingId: currentMeeting.Id,
    });
    if (!data.workflow) {
      els.workflowStatus.textContent = data.message || "No workflow found.";
      return;
    }
    cachedWorkflowActions = data.actions || [];
    renderWorkflow(data.workflow, data.actions || []);
    els.workflowStatus.textContent = data.actions?.length
      ? `${data.actions.length} action${data.actions.length === 1 ? "" : "s"}`
      : "Workflow has no actions yet.";
  } catch (e) {
    workflowLoaded = false; // allow retry
    els.workflowStatus.textContent = e.message;
  }
}

function renderWorkflow(workflow, actions) {
  els.workflowHeader.innerHTML = `
    <div class="workflow-name">${escapeHtml(workflow.Name || "Workflow")}</div>
    <div class="muted small workflow-meta">
      ${escapeHtml(workflow.ple__Workflow_Stage__c || "")}
      ${
        instanceUrl
          ? ` · <a href="${instanceUrl}/${workflow.Id}" target="_blank" rel="noopener">Open ↗</a>`
          : ""
      }
    </div>
  `;
  els.actionsList.innerHTML = "";
  const sorted = [...actions].sort((a, b) => {
    const sa = statusWeight(a.ple__Status__c);
    const sb = statusWeight(b.ple__Status__c);
    if (sa !== sb) return sa - sb;
    return (a.Name || "").localeCompare(b.Name || "");
  });
  for (const a of sorted) {
    const card = document.createElement("div");
    card.className = "action-card status-" + statusClass(a.ple__Status__c);
    card.innerHTML = `
      <div class="action-row-top">
        <button class="status-pill" data-act="edit-status" title="Change status">${escapeHtml(a.ple__Status__c || "—")}</button>
        <span class="action-name">${escapeHtml(a.Name || "Action")}</span>
        <button class="icon-btn small" data-act="open-action" title="Open in Salesforce">↗</button>
      </div>
      <div class="muted small">Updated ${formatRelative(a.LastModifiedDate)}</div>
    `;
    bindActionCard(card, a);
    els.actionsList.appendChild(card);
  }
}

function bindActionCard(card, action) {
  const pill = card.querySelector('[data-act="edit-status"]');
  const open = card.querySelector('[data-act="open-action"]');
  if (open) {
    open.addEventListener("click", (e) => {
      e.stopPropagation();
      if (instanceUrl) chrome.tabs.create({ url: `${instanceUrl}/${action.Id}` });
    });
  }
  if (pill) {
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      openStatusEditor(action, pill);
    });
  }
}

async function openStatusEditor(action, anchor) {
  document.querySelectorAll(".status-menu").forEach((m) => m.remove());

  const configActionId = action.ple__Config_Action_Id__c;
  let statuses = statusOptionsCache.get(configActionId);
  if (!statuses) {
    try {
      const data = await send("sf.fetchActionStatuses", { configActionId });
      statuses = data.statuses || [];
    } catch (e) {
      statuses = [];
    }
    statusOptionsCache.set(configActionId, statuses);
  }
  if (!statuses.length) {
    statuses = ["Open", "In Progress", "On Hold", "Complete"];
  }

  const menu = document.createElement("div");
  menu.className = "status-menu";
  for (const s of statuses) {
    const item = document.createElement("button");
    item.className = "status-menu-item" + (s === action.ple__Status__c ? " current" : "");
    item.textContent = s;
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.remove();
      await applyStatusChange(action, s);
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${r.left}px`;

  const closer = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("mousedown", closer);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", closer), 0);
}

async function applyStatusChange(action, newStatus) {
  if (!newStatus || newStatus === action.ple__Status__c) return;
  const card = [...document.querySelectorAll(".action-card")].find((c) =>
    c.textContent.includes(action.Name || "")
  );
  const prevPill = card?.querySelector(".status-pill")?.textContent;
  if (card) card.classList.add("saving");
  try {
    await send("sf.updateAction", {
      actionId: action.Id,
      fields: { ple__Status__c: newStatus },
    });
    workflowLoaded = false;
    await loadWorkflow();
  } catch (e) {
    if (card) card.classList.remove("saving");
    els.workflowStatus.textContent = e.message;
  }
}

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (!s) return "none";
  if (s.includes("complete") || s.includes("done")) return "done";
  if (s.includes("hold") || s.includes("blocked")) return "hold";
  if (s.includes("progress") || s.includes("active") || s.includes("open")) return "open";
  return "other";
}

function statusWeight(status) {
  switch (statusClass(status)) {
    case "open": return 0;
    case "other": return 1;
    case "hold": return 2;
    case "done": return 3;
    default: return 4;
  }
}

async function loadTranscript() {
  if (!currentMeeting) return;
  try {
    const data = await send("sf.fetchTranscript", {
      meetingId: currentMeeting.Id,
    });
    const newMessages = data.messages || [];
    updateRecordingButton(data.recording);
    const grew = newMessages.length > allMessages.length;
    const atBottom = isAtBottom();
    allMessages = newMessages;
    renderTranscript({ preserveScroll: !atBottom });
    if (!atBottom && grew) {
      unseenCount += newMessages.length - lastRenderedCount;
      updateJumpButton();
    } else {
      unseenCount = 0;
      updateJumpButton();
    }
    lastRenderedCount = newMessages.length;
    if (activeTab === "insights") renderInsights();
    if (!newMessages.length) {
      els.transcriptStatus.textContent = data.message || "No messages yet.";
    } else {
      els.transcriptStatus.textContent = `${newMessages.length} messages`;
    }
  } catch (e) {
    els.transcriptStatus.textContent = e.message;
  }
}

let currentRecording = null;
function updateRecordingButton(recording) {
  currentRecording = recording || null;
  if (recording && instanceUrl) {
    els.recordingBtn.classList.remove("hidden");
    els.recordingBtn.title = `Open ${recording.fileType} recording in Salesforce`;
  } else {
    els.recordingBtn.classList.add("hidden");
  }
}

function isAtBottom() {
  return (
    els.messages.scrollHeight - els.messages.clientHeight -
      els.messages.scrollTop <
    60
  );
}

function uniqueSpeakers() {
  const seen = new Map();
  for (const m of allMessages) {
    const s = m.participantName || "Unknown";
    seen.set(s, (seen.get(s) || 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]);
}

function renderTranscript({ preserveScroll = false } = {}) {
  const prevScrollTop = els.messages.scrollTop;
  const prevScrollHeight = els.messages.scrollHeight;

  renderSpeakerChips();
  const filtered = applyFilters(allMessages);
  renderMessages(filtered);
  renderSearchCount(filtered);

  if (preserveScroll) {
    const delta = els.messages.scrollHeight - prevScrollHeight;
    els.messages.scrollTop = prevScrollTop + Math.max(0, delta);
  } else if (!transcriptSearchTerm && !activeSpeakerFilter) {
    els.messages.scrollTop = els.messages.scrollHeight;
  }
}

function renderSpeakerChips() {
  const speakers = uniqueSpeakers();
  if (speakers.length <= 1) {
    els.speakerChips.innerHTML = "";
    els.speakerChips.classList.add("empty");
    return;
  }
  els.speakerChips.classList.remove("empty");
  els.speakerChips.innerHTML = "";
  for (const [name, count] of speakers) {
    const chip = document.createElement("button");
    const isActive = activeSpeakerFilter === name;
    chip.className = "speaker-chip" + (isActive ? " active" : "");
    chip.innerHTML = `
      <span class="chip-dot" style="background:${colorFor(name)}"></span>
      <span class="chip-name">${escapeHtml(name)}</span>
      <span class="chip-count">${count}</span>
    `;
    chip.addEventListener("click", () => {
      activeSpeakerFilter = isActive ? null : name;
      renderTranscript();
    });
    els.speakerChips.appendChild(chip);
  }
  if (activeSpeakerFilter) {
    const clear = document.createElement("button");
    clear.className = "speaker-chip clear";
    clear.textContent = "Clear ×";
    clear.addEventListener("click", () => {
      activeSpeakerFilter = null;
      renderTranscript();
    });
    els.speakerChips.appendChild(clear);
  }
}

function applyFilters(messages) {
  let out = messages;
  if (activeSpeakerFilter) {
    out = out.filter((m) => (m.participantName || "Unknown") === activeSpeakerFilter);
  }
  if (transcriptSearchTerm) {
    const lc = transcriptSearchTerm.toLowerCase();
    out = out.filter((m) =>
      (m.message || "").toLowerCase().includes(lc) ||
      (m.participantName || "").toLowerCase().includes(lc)
    );
  }
  return out;
}

function renderSearchCount(filtered) {
  if (!transcriptSearchTerm && !activeSpeakerFilter) {
    els.transcriptSearchCount.textContent = "";
    return;
  }
  const total = allMessages.length;
  els.transcriptSearchCount.textContent = `${filtered.length} of ${total}`;
}

function renderMessages(messages) {
  els.messages.innerHTML = "";
  let lastSpeaker = null;
  for (const m of messages) {
    const speaker = m.participantName || "Unknown";
    const newGroup = speaker !== lastSpeaker;
    const row = document.createElement("div");
    row.className = "msg" + (newGroup ? " msg-first" : "");
    row.dataset.sequence = m.sequence ?? "";
    row.innerHTML = `
      ${
        newGroup
          ? `<div class="msg-head">
              <span class="avatar" style="background:${colorFor(speaker)}">${initials(
              speaker
            )}</span>
              <span class="speaker">${escapeHtml(speaker)}</span>
              <span class="ts muted small">${formatTime(m.createDate)}</span>
            </div>`
          : ""
      }
      <div class="msg-body">${decorateText(m.message || "")}</div>
      <div class="msg-actions">
        <button class="msg-act" data-act="pin" title="Pin to a workflow action">📌</button>
        <button class="msg-act" data-act="copy" title="Copy text">📋</button>
        <button class="msg-act" data-act="copy-quote" title="Copy as quote">❝</button>
        ${
          instanceUrl && currentMeeting
            ? `<button class="msg-act" data-act="open-sf" title="Open meeting in Salesforce">↗</button>`
            : ""
        }
      </div>
    `;
    bindMessageActions(row, m);
    els.messages.appendChild(row);
    lastSpeaker = speaker;
  }
}

function bindMessageActions(row, m) {
  row.querySelectorAll(".msg-act").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "copy") {
        await navigator.clipboard.writeText(m.message || "");
        flashActionLabel(btn, "Copied");
      } else if (act === "copy-quote") {
        const speaker = m.participantName || "Unknown";
        const ts = m.createDate ? new Date(m.createDate).toLocaleString() : "";
        const text = `> ${m.message || ""}\n> — ${speaker} (${ts})`;
        await navigator.clipboard.writeText(text);
        flashActionLabel(btn, "Quoted");
      } else if (act === "open-sf") {
        if (instanceUrl && currentMeeting?.Id) {
          chrome.tabs.create({
            url: `${instanceUrl}/${currentMeeting.Id}`,
          });
        }
      } else if (act === "pin") {
        openPinPicker(m, btn);
      }
    });
  });
}

let cachedWorkflowActions = null;
async function ensureWorkflowActions() {
  if (cachedWorkflowActions) return cachedWorkflowActions;
  if (!currentMeeting?.Id) return [];
  const data = await send("sf.fetchWorkflow", { meetingId: currentMeeting.Id });
  cachedWorkflowActions = data.actions || [];
  return cachedWorkflowActions;
}

async function openPinPicker(message, anchor) {
  document.querySelectorAll(".status-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "status-menu pin-menu";
  menu.innerHTML = '<div class="pin-loading muted small">Loading actions…</div>';
  document.body.appendChild(menu);
  positionMenu(menu, anchor);

  let actions = [];
  try {
    actions = await ensureWorkflowActions();
  } catch (e) {
    menu.innerHTML = `<div class="pin-loading error">${escapeHtml(e.message)}</div>`;
    return;
  }
  if (!actions.length) {
    menu.innerHTML = '<div class="pin-loading muted small">No workflow actions found for this meeting.</div>';
    return;
  }
  menu.innerHTML = "";
  const header = document.createElement("div");
  header.className = "pin-header muted small";
  header.textContent = "Pin this message to…";
  menu.appendChild(header);
  for (const a of actions.slice(0, 50)) {
    const item = document.createElement("button");
    item.className = "status-menu-item";
    item.innerHTML = `
      <span class="action-name">${escapeHtml(a.Name || "Action")}</span>
      <span class="muted small">${escapeHtml(a.ple__Status__c || "—")}</span>
    `;
    item.addEventListener("click", async (e) => {
      e.stopPropagation();
      item.disabled = true;
      item.textContent = "Pinning…";
      try {
        const speaker = message.participantName || "Unknown";
        const time = message.createDate
          ? new Date(message.createDate).toLocaleString()
          : "";
        const quoted = [
          `Pinned from meeting transcript:`,
          ``,
          `"${(message.message || "").slice(0, 800)}"`,
          ``,
          `— ${speaker}${time ? " · " + time : ""}`,
        ].join("\n");
        await send("sf.pinToAction", {
          actionId: a.Id,
          text: quoted,
        });
        menu.innerHTML = `<div class="pin-loading success">Pinned to ${escapeHtml(a.Name || "action")}.</div>`;
        setTimeout(() => menu.remove(), 1400);
      } catch (err) {
        menu.innerHTML = `<div class="pin-loading error">${escapeHtml(err.message)}</div>`;
      }
    });
    menu.appendChild(item);
  }

  const closer = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("mousedown", closer);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", closer), 0);
}

function positionMenu(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, r.left - 100)}px`;
  menu.style.maxHeight = `${Math.min(360, window.innerHeight - r.bottom - 16)}px`;
  menu.style.overflowY = "auto";
}

async function postMeetingNote() {
  if (!currentMeeting?.Id) return;
  const text = prompt("Note to post on this meeting (visible in Salesforce Chatter):", "");
  if (!text || !text.trim()) return;
  try {
    els.transcriptStatus.textContent = "Posting note…";
    await send("sf.postNoteOnMeeting", {
      meetingId: currentMeeting.Id,
      text: text.trim(),
    });
    els.transcriptStatus.textContent = "Note posted.";
  } catch (e) {
    els.transcriptStatus.textContent = e.message;
  }
}

function flashActionLabel(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  btn.classList.add("flashed");
  setTimeout(() => {
    btn.textContent = old;
    btn.classList.remove("flashed");
  }, 900);
}

function decorateText(text) {
  if (!text) return "";
  const urlRe = /\bhttps?:\/\/[^\s<]+/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: text.slice(last, m.index) });
    parts.push({ kind: "url", value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });

  return parts
    .map((p) => {
      const safe = escapeHtml(p.value);
      if (p.kind === "url") {
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
      }
      let s = safe;
      if (transcriptSearchTerm) {
        const re = new RegExp(`(${escapeRegex(transcriptSearchTerm)})`, "gi");
        s = s.replace(re, '<mark class="hl-search">$1</mark>');
      }
      for (const [cat, words] of Object.entries(KEYWORDS)) {
        if (!words.length) continue;
        const re = new RegExp(`\\b(${words.map(escapeRegex).join("|")})\\b`, "gi");
        s = s.replace(re, `<span class="hl-${cat}">$1</span>`);
      }
      return s;
    })
    .join("");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateJumpButton() {
  if (!unseenCount || isAtBottom()) {
    els.jumpLatest.classList.add("hidden");
    return;
  }
  els.jumpLatest.classList.remove("hidden");
  els.jumpLatestText.textContent =
    unseenCount === 1
      ? "1 new message"
      : unseenCount > 1
      ? `${unseenCount} new messages`
      : "Jump to latest";
}

function startPolling() {
  stopPolling();
  if (!els.liveToggle.checked) return;
  pollTimer = setInterval(loadTranscript, POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

let searchDebounce;
els.searchInput.addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  const term = e.target.value.trim();
  searchDebounce = setTimeout(() => {
    if (term === lastSearchTerm) return;
    lastSearchTerm = term;
    loadMeetings(term);
  }, 250);
});

let transcriptSearchDebounce;
els.transcriptSearch.addEventListener("input", (e) => {
  clearTimeout(transcriptSearchDebounce);
  const term = e.target.value.trim();
  transcriptSearchDebounce = setTimeout(() => {
    transcriptSearchTerm = term;
    renderTranscript({ preserveScroll: true });
  }, 120);
});

els.transcriptSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    els.transcriptSearch.value = "";
    transcriptSearchTerm = "";
    renderTranscript({ preserveScroll: true });
  }
});

els.messages.addEventListener("scroll", () => {
  if (isAtBottom()) {
    unseenCount = 0;
    updateJumpButton();
  }
});

els.jumpLatest.addEventListener("click", () => {
  els.messages.scrollTop = els.messages.scrollHeight;
  unseenCount = 0;
  updateJumpButton();
});

els.tabs.forEach((t) =>
  t.addEventListener("click", () => switchTab(t.dataset.tab))
);

els.coachingGenerate.addEventListener("click", () => generateCoaching());

els.openInSf.addEventListener("click", () => {
  if (instanceUrl && currentMeeting?.Id) {
    chrome.tabs.create({ url: `${instanceUrl}/${currentMeeting.Id}` });
  }
});

els.noteBtn.addEventListener("click", () => postMeetingNote());

els.recordingBtn.addEventListener("click", () => {
  if (currentRecording && instanceUrl) {
    chrome.tabs.create({
      url: `${instanceUrl}/lightning/r/ContentDocument/${currentRecording.contentDocumentId}/view`,
    });
  }
});

els.loginBtn.addEventListener("click", async () => {
  els.authError.textContent = "";
  els.loginBtn.disabled = true;
  els.loginBtn.textContent = "Connecting…";
  try {
    await send("auth.login");
    els.signoutBtn.classList.remove("hidden");
    await loadMeetings();
    show(els.listView);
  } catch (e) {
    els.authError.textContent = e.message;
  } finally {
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = "Sign in";
  }
});

els.signoutBtn.addEventListener("click", async () => {
  stopPolling();
  await send("auth.logout");
  els.signoutBtn.classList.add("hidden");
  show(els.authView);
});

els.backBtn.addEventListener("click", () => {
  stopPolling();
  currentMeeting = null;
  userOpenedManually = false;
  lastMatchedMeetingId = null;
  show(els.listView);
});

els.refreshBtn.addEventListener("click", () => {
  if (!els.transcriptView.classList.contains("hidden")) {
    if (activeTab === "workflow") {
      workflowLoaded = false;
      loadWorkflow();
    } else {
      loadTranscript();
    }
  } else {
    loadMeetings(lastSearchTerm);
  }
});

els.settingsBtn.addEventListener("click", () =>
  chrome.runtime.openOptionsPage()
);

els.openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

els.liveToggle.addEventListener("change", () => {
  if (els.liveToggle.checked) startPolling();
  else stopPolling();
});

init();
