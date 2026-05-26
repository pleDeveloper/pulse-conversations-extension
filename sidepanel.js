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
  els.transcriptStatus.textContent = "Loading…";
  els.transcriptSearch.value = "";
  transcriptSearchTerm = "";
  activeSpeakerFilter = null;
  allMessages = [];
  lastRenderedCount = 0;
  unseenCount = 0;
  updateJumpButton();
  show(els.transcriptView);
  await loadTranscript();
  startPolling();
}

async function loadTranscript() {
  if (!currentMeeting) return;
  try {
    const data = await send("sf.fetchTranscript", {
      meetingId: currentMeeting.Id,
    });
    const newMessages = data.messages || [];
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
    if (!newMessages.length) {
      els.transcriptStatus.textContent = data.message || "No messages yet.";
    } else {
      els.transcriptStatus.textContent = `${newMessages.length} messages`;
    }
  } catch (e) {
    els.transcriptStatus.textContent = e.message;
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
      }
    });
  });
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

els.openInSf.addEventListener("click", () => {
  if (instanceUrl && currentMeeting?.Id) {
    chrome.tabs.create({ url: `${instanceUrl}/${currentMeeting.Id}` });
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
  if (!els.transcriptView.classList.contains("hidden")) loadTranscript();
  else loadMeetings(lastSearchTerm);
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
