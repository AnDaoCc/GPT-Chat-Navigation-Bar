chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("conversationNavigator:installedAt", (result) => {
    if (!result["conversationNavigator:installedAt"]) {
      chrome.storage.local.set({
        "conversationNavigator:installedAt": Date.now()
      });
    }
  });
});

const MODEL_SYNC_ALLOWED_URLS = [
  "https://raw.githubusercontent.com/AnDaoCc/GPT-/main/model-catalog.json",
  "https://developers.openai.com/api/docs/models",
  "https://developers.openai.com/api/docs/models/compare",
  "https://developers.openai.com/api/docs/models/gpt-5.5",
  "https://developers.openai.com/api/docs/models/gpt-5.5-pro",
  "https://platform.openai.com/docs/models",
  "https://platform.openai.com/docs/models/compare",
  "https://openai.com/index/",
  "https://help.openai.com/en/articles/11909943"
];

function isAllowedModelSyncUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return MODEL_SYNC_ALLOWED_URLS.some((allowed) => value === allowed || value.startsWith(`${allowed}/`)) ||
      (url.hostname === "developers.openai.com" && url.pathname.startsWith("/api/docs/models")) ||
      (url.hostname === "platform.openai.com" && url.pathname.startsWith("/docs/models")) ||
      (url.hostname === "openai.com" && url.pathname.startsWith("/index/")) ||
      (url.hostname === "help.openai.com" && url.pathname.startsWith("/en/articles/"));
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "conversationNavigator:fetchText") {
    return false;
  }

  const url = String(message.url || "");
  const timeoutMs = Math.min(15000, Math.max(3000, Number(message.timeoutMs) || 8000));
  if (!isAllowedModelSyncUrl(url)) {
    sendResponse({ ok: false, error: "URL is not allowed" });
    return false;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  fetch(url, {
    cache: "no-store",
    credentials: "omit",
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      sendResponse({ ok: true, text: await response.text() });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => clearTimeout(timer));

  return true;
});
