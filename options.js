const els = {
  instance: document.getElementById("instance"),
  clientId: document.getElementById("client-id"),
  save: document.getElementById("save"),
  status: document.getElementById("status"),
  redirect: document.getElementById("redirect-uri"),
  extensionId: document.getElementById("extension-id"),
  copyBtn: document.getElementById("copy-redirect"),
};

const redirectUrl = chrome.identity.getRedirectURL();
els.redirect.textContent = redirectUrl;
els.extensionId.textContent = chrome.runtime.id;

chrome.storage.local.get(["instanceUrl", "clientId"], (cfg) => {
  els.instance.value = cfg.instanceUrl || "";
  els.clientId.value = cfg.clientId || "";
});

els.save.addEventListener("click", async () => {
  const instanceUrl = els.instance.value.trim().replace(/\/$/, "");
  const clientId = els.clientId.value.trim();
  if (!instanceUrl || !clientId) {
    els.status.textContent = "Both fields are required.";
    return;
  }
  await chrome.storage.local.set({ instanceUrl, clientId });
  els.status.textContent = "Saved.";
  setTimeout(() => (els.status.textContent = ""), 2000);
});

els.copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(redirectUrl);
    els.copyBtn.textContent = "Copied";
    setTimeout(() => (els.copyBtn.textContent = "Copy"), 1500);
  } catch (e) {
    els.status.textContent = e.message;
  }
});
