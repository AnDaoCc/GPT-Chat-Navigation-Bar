import {
  CITATION_CHECK_MESSAGE,
  CitationCheckResult,
  findLegacyConversationRecordKeys,
  normalizeSettings,
  STORAGE_SETTINGS_KEY
} from "./shared";
import {
  classifyCitationFetchResponse,
  isPublicCitationUrl,
  isReusableCitationCheckResult
} from "./readingTools";

const LEGACY_MODEL_CATALOG_STORAGE_KEY = "conversationNavigator:modelCatalog:v1";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(null, (result) => {
    const legacyKeys = findLegacyConversationRecordKeys(result);
    if ("conversationNavigator:installedAt" in result) {
      legacyKeys.push("conversationNavigator:installedAt");
    }
    if (LEGACY_MODEL_CATALOG_STORAGE_KEY in result) {
      legacyKeys.push(LEGACY_MODEL_CATALOG_STORAGE_KEY);
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

const COMPAT_RULES_URL =
  "https://raw.githubusercontent.com/AnDaoCc/GPT-Chat-Navigation-Bar/main/compat/chatgpt-dom-rules.json";
const CITATION_CACHE_STORAGE_KEY = "conversationNavigator:citationCheckCache:v1";
const CITATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CITATION_CHECK_LIMIT = 500;
const CITATION_CHECK_CONCURRENCY = 4;
const citationCheckWaiters: Array<() => void> = [];
const inFlightCitationChecks = new Map<string, Promise<CitationCheckResult>>();
let activeCitationCheckCount = 0;
let citationCacheWriteQueue: Promise<void> = Promise.resolve();

function isAllowedCompatRulesUrl(value: string): boolean {
  return value === COMPAT_RULES_URL;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === CITATION_CHECK_MESSAGE) {
    const urls = Array.isArray(message.urls)
      ? message.urls.map((value: unknown) => String(value || "")).slice(0, CITATION_CHECK_LIMIT)
      : [];
    checkCitationUrls(urls)
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  }

  if (message?.type !== "conversationNavigator:fetchText") {
    return false;
  }

  const url = String(message.url || "");
  const timeoutMs = Math.min(15000, Math.max(3000, Number(message.timeoutMs) || 8000));
  if (!isAllowedCompatRulesUrl(url)) {
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

function getCitationCache(): Promise<Record<string, CitationCheckResult>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(CITATION_CACHE_STORAGE_KEY, (result) => {
      const value = result[CITATION_CACHE_STORAGE_KEY];
      resolve(value && typeof value === "object" ? value as Record<string, CitationCheckResult> : {});
    });
  });
}

function setCitationCache(cache: Record<string, CitationCheckResult>): Promise<void> {
  const entries = Object.entries(cache)
    .sort(([, a], [, b]) => b.checkedAt - a.checkedAt)
    .slice(0, 500);
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CITATION_CACHE_STORAGE_KEY]: Object.fromEntries(entries) }, () => resolve());
  });
}

async function hasCitationPermission(url: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin;
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

async function fetchCitationStatus(url: string): Promise<CitationCheckResult> {
  const checkedAt = Date.now();
  if (!isPublicCitationUrl(url)) {
    return { url, status: "blocked", reason: "unsafe-url", checkedAt };
  }
  if (!(await hasCitationPermission(url))) {
    return { url, status: "blocked", reason: "permission-required", checkedAt };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
    }
    void response.body?.cancel();
    return { url, ...classifyCitationFetchResponse(response.status, response.type), checkedAt };
  } catch {
    return { url, status: "temporary-error", checkedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function withCitationCheckSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeCitationCheckCount >= CITATION_CHECK_CONCURRENCY) {
    await new Promise<void>((resolve) => citationCheckWaiters.push(resolve));
  }
  activeCitationCheckCount += 1;
  try {
    return await task();
  } finally {
    activeCitationCheckCount -= 1;
    citationCheckWaiters.shift()?.();
  }
}

function scheduleCitationCheck(url: string): Promise<CitationCheckResult> {
  const existing = inFlightCitationChecks.get(url);
  if (existing) return existing;
  const pending = withCitationCheckSlot(() => fetchCitationStatus(url))
    .finally(() => inFlightCitationChecks.delete(url));
  inFlightCitationChecks.set(url, pending);
  return pending;
}

function mergeCitationCache(results: CitationCheckResult[]): Promise<void> {
  const write = citationCacheWriteQueue.then(async () => {
    const latest = await getCitationCache();
    for (const result of results) {
      if (result.status === "blocked") delete latest[result.url];
      else latest[result.url] = result;
    }
    await setCitationCache(latest);
  });
  citationCacheWriteQueue = write.catch(() => undefined);
  return write;
}

async function checkCitationUrls(values: string[]): Promise<CitationCheckResult[]> {
  const urls = Array.from(new Set(values.filter(Boolean)));
  const cache = await getCitationCache();
  const now = Date.now();
  const results = new Map<string, CitationCheckResult>();
  const pending: string[] = [];

  for (const url of urls) {
    if (!isPublicCitationUrl(url)) {
      results.set(url, { url, status: "blocked", reason: "unsafe-url", checkedAt: now });
      continue;
    }
    if (!(await hasCitationPermission(url))) {
      results.set(url, { url, status: "blocked", reason: "permission-required", checkedAt: now });
      continue;
    }
    const cached = cache[url];
    if (isReusableCitationCheckResult(cached, now, CITATION_CACHE_TTL_MS)) {
      results.set(url, cached);
    } else {
      pending.push(url);
    }
  }

  const checked = await Promise.all(pending.map((url) => scheduleCitationCheck(url)));
  for (const result of checked) results.set(result.url, result);
  if (checked.length > 0) await mergeCitationCache(checked);
  return urls.map((url) => results.get(url) ?? { url, status: "temporary-error", checkedAt: now });
}
