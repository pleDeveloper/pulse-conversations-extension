const POLL_MS = 3000;
const PAGE_SIZE = 50;

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
  messages: document.getElementById("messages"),
  transcriptStatus: document.getElementById("transcript-status"),
  liveToggle: document.getElementById("live-toggle"),
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
  const soql = `SELECT Id, Name, AccountPulse__c, AccountPulse__r.Name, CreatedDate FROM ple__Meeting__c ${where} ORDER BY CreatedDate DESC LIMIT ${PAGE_SIZE}`;
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
    item.innerHTML = `
      <div class="meeting-name">${escapeHtml(m.Name || "Untitled")}</div>
      <div class="meeting-sub muted small">
        ${escapeHtml(m.AccountPulse__r?.Name || "—")}
        · ${formatRelative(m.CreatedDate)}
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
    formatRelative(meeting.CreatedDate);
  els.messages.innerHTML = "";
  els.transcriptStatus.textContent = "Loading…";
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
    renderMessages(data.messages || []);
    if (!data.messages?.length) {
      els.transcriptStatus.textContent = data.message || "No messages yet.";
    } else {
      els.transcriptStatus.textContent = `${data.messages.length} messages`;
    }
  } catch (e) {
    els.transcriptStatus.textContent = e.message;
  }
}

function renderMessages(messages) {
  const wasAtBottom =
    els.messages.scrollHeight - els.messages.clientHeight -
      els.messages.scrollTop < 60;
  els.messages.innerHTML = "";
  let lastSpeaker = null;
  for (const m of messages) {
    const speaker = m.participantName || "Unknown";
    const newGroup = speaker !== lastSpeaker;
    const row = document.createElement("div");
    row.className = "msg" + (newGroup ? " msg-first" : "");
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
      <div class="msg-body">${escapeHtml(m.message || "")}</div>
    `;
    els.messages.appendChild(row);
    lastSpeaker = speaker;
  }
  if (wasAtBottom) els.messages.scrollTop = els.messages.scrollHeight;
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
