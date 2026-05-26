// Service worker: OAuth (PKCE), token storage, refresh, and Salesforce API proxy.

const API_VERSION = "v60.0";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "auth.login":
          sendResponse({ ok: true, data: await login() });
          break;
        case "auth.logout":
          await logout();
          sendResponse({ ok: true });
          break;
        case "auth.status":
          sendResponse({ ok: true, data: await getAuthStatus() });
          break;
        case "sf.query":
          sendResponse({ ok: true, data: await sfQuery(msg.soql) });
          break;
        case "sf.fetchTranscript":
          sendResponse({
            ok: true,
            data: await fetchTranscript(msg.meetingId),
          });
          break;
        case "sf.matchMeeting":
          sendResponse({
            ok: true,
            data: await matchMeeting(msg.url),
          });
          break;
        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});

async function getConfig() {
  const { instanceUrl, clientId } = await chrome.storage.local.get([
    "instanceUrl",
    "clientId",
  ]);
  if (!instanceUrl || !clientId) {
    throw new Error(
      "Missing instance URL or Client ID. Open the extension options page to set them."
    );
  }
  return { instanceUrl: instanceUrl.replace(/\/$/, ""), clientId };
}

function base64UrlEncode(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(s) {
  const buf = new TextEncoder().encode(s);
  return crypto.subtle.digest("SHA-256", buf);
}

async function login() {
  const { instanceUrl, clientId } = await getConfig();
  const redirectUri = chrome.identity.getRedirectURL();
  const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
  const codeVerifier = base64UrlEncode(verifierBytes);
  const codeChallenge = base64UrlEncode(await sha256(codeVerifier));

  const authUrl = new URL(`${instanceUrl}/services/oauth2/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "api refresh_token");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log("[Pulse] redirectUri =", redirectUri);
  console.log("[Pulse] authUrl =", authUrl.toString());

  let redirectResp;
  try {
    redirectResp = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });
  } catch (e) {
    throw new Error(
      `${e.message || e}\n\nTry opening this URL directly in a regular tab to see Salesforce's response:\n${authUrl.toString()}`
    );
  }
  if (!redirectResp) throw new Error("OAuth was cancelled.");
  const code = new URL(redirectResp).searchParams.get("code");
  if (!code) {
    const err = new URL(redirectResp).searchParams.get("error");
    const desc = new URL(redirectResp).searchParams.get("error_description");
    throw new Error(`Did not receive an authorization code. ${err || ""} ${desc || ""}`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const tokenResp = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = await tokenResp.json();
  if (!tokenResp.ok) {
    throw new Error(
      `Token exchange failed: ${token.error || tokenResp.status} ${
        token.error_description || ""
      }`
    );
  }
  const userId = parseUserIdFromIdentityUrl(token.id);
  await chrome.storage.local.set({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenInstanceUrl: token.instance_url,
    identityUrl: token.id,
    userId,
    issuedAt: Date.now(),
  });
  return { instanceUrl: token.instance_url, identityUrl: token.id, userId };
}

function parseUserIdFromIdentityUrl(idUrl) {
  if (!idUrl) return null;
  try {
    const parts = new URL(idUrl).pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch (_) {
    return null;
  }
}

async function logout() {
  const { accessToken, tokenInstanceUrl } = await chrome.storage.local.get([
    "accessToken",
    "tokenInstanceUrl",
  ]);
  if (accessToken && tokenInstanceUrl) {
    try {
      await fetch(`${tokenInstanceUrl}/services/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(accessToken)}`,
      });
    } catch (_) {}
  }
  await chrome.storage.local.remove([
    "accessToken",
    "refreshToken",
    "tokenInstanceUrl",
    "identityUrl",
    "issuedAt",
  ]);
}

async function getAuthStatus() {
  const { accessToken, tokenInstanceUrl, identityUrl } =
    await chrome.storage.local.get([
      "accessToken",
      "tokenInstanceUrl",
      "identityUrl",
    ]);
  return {
    authenticated: !!accessToken,
    instanceUrl: tokenInstanceUrl || null,
    identityUrl: identityUrl || null,
  };
}

async function refreshAccessToken() {
  const { refreshToken } = await chrome.storage.local.get(["refreshToken"]);
  if (!refreshToken) throw new Error("Not signed in.");
  const { instanceUrl, clientId } = await getConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const resp = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(
      `Refresh failed: ${data.error || resp.status} ${
        data.error_description || ""
      }`
    );
  }
  await chrome.storage.local.set({
    accessToken: data.access_token,
    tokenInstanceUrl: data.instance_url || (await getStoredInstanceUrl()),
    issuedAt: Date.now(),
  });
  return data.access_token;
}

async function getStoredInstanceUrl() {
  const { tokenInstanceUrl } = await chrome.storage.local.get([
    "tokenInstanceUrl",
  ]);
  return tokenInstanceUrl;
}

async function sfFetch(path, init = {}) {
  let { accessToken, tokenInstanceUrl } = await chrome.storage.local.get([
    "accessToken",
    "tokenInstanceUrl",
  ]);
  if (!accessToken) throw new Error("Not signed in.");
  const doFetch = (token) =>
    fetch(`${tokenInstanceUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });
  let resp = await doFetch(accessToken);
  if (resp.status === 401) {
    accessToken = await refreshAccessToken();
    resp = await doFetch(accessToken);
  }
  return resp;
}

async function sfQuery(soql) {
  const resp = await sfFetch(
    `/services/data/${API_VERSION}/query/?q=${encodeURIComponent(soql)}`
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Query failed: ${resp.status} ${text}`);
  }
  return resp.json();
}

async function ensureUserId() {
  const resp = await sfFetch(`/services/oauth2/userinfo`);
  if (!resp.ok) return null;
  const info = await resp.json();
  const userId = info.user_id || null;
  if (userId) await chrome.storage.local.set({ userId });
  return userId;
}

function extractMeetCode(tabUrl) {
  if (!tabUrl) return null;
  let u;
  try {
    u = new URL(tabUrl);
  } catch (_) {
    return null;
  }
  const host = u.hostname;
  const path = u.pathname.replace(/\/+$/, "");
  if (host === "meet.google.com") {
    // Real meetings are at /xxx-xxxx-xxx; ignore /landing, /lookup, etc.
    const m = path.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/);
    return m ? { provider: "meet", code: m[1], prefix: `https://meet.google.com/${m[1]}` } : null;
  }
  if (host.endsWith("zoom.us")) {
    const m = path.match(/^\/(?:j|wc\/join)\/(\d+)/);
    return m ? { provider: "zoom", code: m[1], prefix: `${u.origin}/j/${m[1]}` } : null;
  }
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) {
    const m = path.match(/meetup-join\/([^/?]+)/);
    return m ? { provider: "teams", code: m[1], prefix: `${u.origin}${u.pathname}` } : null;
  }
  return null;
}

async function matchMeeting(tabUrl) {
  const meet = extractMeetCode(tabUrl);
  if (!meet) return { matched: false, reason: "no-meet-url", meet: null };

  let { userId } = await chrome.storage.local.get(["userId"]);
  if (!userId) userId = await ensureUserId();
  const escapedPrefix = meet.prefix.replace(/'/g, "\\'");
  const soql =
    `SELECT Id, Name, OwnerId, Owner.Name, AccountPulse__c, AccountPulse__r.Name, ` +
    `ple__Meeting_Link__c, ple__Bot_ID__c, ple__Bot_Name__c, ple__Meeting_Status__c, ` +
    `ple__Start_Time__c, ple__End_Time__c, CreatedDate ` +
    `FROM ple__Meeting__c ` +
    `WHERE ple__Meeting_Link__c LIKE '${escapedPrefix}%' ` +
    `AND ple__Start_Time__c = LAST_N_DAYS:2 ` +
    `ORDER BY ple__Start_Time__c DESC LIMIT 25`;
  const data = await sfQuery(soql);
  const candidates = data.records || [];
  if (!candidates.length) return { matched: false, reason: "no-records", meet };

  const scored = candidates.map((r) => ({
    record: r,
    isOwn: userId && r.OwnerId === userId,
    isLive: r.ple__Meeting_Status__c === "Processing",
    startMs: r.ple__Start_Time__c ? new Date(r.ple__Start_Time__c).getTime() : 0,
  }));
  scored.sort((a, b) => {
    if (a.isOwn !== b.isOwn) return a.isOwn ? -1 : 1;
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    return b.startMs - a.startMs;
  });
  const top = scored[0];
  const otherUsers = scored.filter((s) => !s.isOwn).length;
  return {
    matched: true,
    meet,
    topRecord: top.record,
    topIsOwn: top.isOwn,
    totalCandidates: scored.length,
    otherUsers,
  };
}

async function fetchTranscript(meetingId) {
  if (!meetingId) throw new Error("Missing meetingId.");

  const linkSoql = `SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId='${meetingId}'`;
  const links = await sfQuery(linkSoql);
  const docIds = (links.records || [])
    .map((r) => r.ContentDocumentId)
    .filter(Boolean);
  if (!docIds.length) {
    return { messages: [], message: "No transcript attached yet." };
  }
  const idList = docIds.map((id) => `'${id}'`).join(",");
  const cvSoql = `SELECT Id, Title, FileType, ContentDocumentId, CreatedDate FROM ContentVersion WHERE ContentDocumentId IN (${idList}) AND FileType='JSON' AND Title LIKE 'Meeting_Transcript_%' ORDER BY CreatedDate DESC LIMIT 1`;
  const cvs = await sfQuery(cvSoql);
  const cv = (cvs.records || [])[0];
  if (!cv) return { messages: [], message: "No transcript JSON found." };

  const dataResp = await sfFetch(
    `/services/data/${API_VERSION}/sobjects/ContentVersion/${cv.Id}/VersionData`
  );
  if (!dataResp.ok) {
    throw new Error(`Failed to download transcript: ${dataResp.status}`);
  }
  const text = await dataResp.text();
  let messages = [];
  try {
    const parsed = JSON.parse(text);
    messages = Array.isArray(parsed) ? parsed : parsed.messages || [];
  } catch (e) {
    throw new Error("Transcript file is not valid JSON.");
  }
  messages.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return { messages, contentVersionId: cv.Id, title: cv.Title };
}
