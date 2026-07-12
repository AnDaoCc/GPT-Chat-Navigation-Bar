import {
  findLegacyConversationRecordKeys,
  normalizeSettings,
  STORAGE_SETTINGS_KEY,
  TOKEN_COUNT_BATCH_MESSAGE,
  TokenCountBatchResponse
} from "./shared";
import { countTokenBatchItems, normalizeTokenBatchItems } from "./tokenWorker";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (result) => {
    const legacyKeys = findLegacyConversationRecordKeys(result);
    if ("conversationNavigator:installedAt" in result) {
      legacyKeys.push("conversationNavigator:installedAt");
    }
    if (legacyKeys.length > 0) {
      chrome.storage.local.remove(legacyKeys);
    }

    if (result[STORAGE_SETTINGS_KEY]) {
      chrome.storage.local.set({
        [STORAGE_SETTINGS_KEY]: normalizeSettings(result[STORAGE_SETTINGS_KEY])
      });
    }
  });
});

const MODEL_SYNC_ALLOWED_URLS = [
  "https://raw.githubusercontent.com/AnDaoCc/GPT-/main/model-catalog.json",
  "https://raw.githubusercontent.com/AnDaoCc/GPT-Chat-Navigation-Bar/main/compat/chatgpt-dom-rules.json",
  "https://help.openai.com/en/articles/11909943-gpt-53-and-gpt-55-in-chatgpt",
  "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
  "https://developers.openai.com/api/docs/models",
  "https://openai.com/index/gpt-5-5-instant/",
  "https://openai.com/index/introducing-gpt-5-5/",
  "https://platform.openai.com/docs/deprecations",
  "https://platform.openai.com/docs/models",
  "https://openai.com/index/"
];

function isAllowedModelSyncUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return MODEL_SYNC_ALLOWED_URLS.some((allowed) => value === allowed || value.startsWith(`${allowed}/`)) ||
      (url.hostname === "developers.openai.com" && url.pathname.startsWith("/api/docs/models")) ||
      (url.hostname === "platform.openai.com" && (
        url.pathname.startsWith("/docs/models") ||
        url.pathname.startsWith("/docs/deprecations")
      )) ||
      (url.hostname === "openai.com" && url.pathname.startsWith("/index/")) ||
      (url.hostname === "help.openai.com" && url.pathname.startsWith("/en/articles/"));
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === TOKEN_COUNT_BATCH_MESSAGE) {
    const sessionId = typeof message.sessionId === "string" ? message.sessionId.slice(0, 160) : "";
    const items = normalizeTokenBatchItems(message.items);
    if (!sessionId || items.length === 0) {
      sendResponse({
        ok: false,
        sessionId,
        error: "Token batch is invalid"
      } satisfies TokenCountBatchResponse);
      return false;
    }

    try {
      const counts = countTokenBatchItems(items);
      sendResponse({ ok: true, sessionId, counts } satisfies TokenCountBatchResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      } satisfies TokenCountBatchResponse);
    }
    return false;
  }

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
