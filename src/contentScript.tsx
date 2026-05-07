import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronRight,
  Languages,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star
} from "lucide-react";
import {
  AppLanguage,
  DEFAULT_SETTINGS,
  NavigatorSettings,
  STORAGE_SETTINGS_KEY,
  StoredConversationRecord,
  makeRecordKey,
  normalizeSettings
} from "./shared";
import { getTranslation, LANGUAGE_NAMES } from "./i18n";
import "./styles/content.css";

const ROOT_ID = "conversation-navigator-root";
const ANCHOR_ATTR = "data-conversation-navigator-id";
const SCAN_DEBOUNCE_MS = 350;
const CHAT_STYLE_ID = "conversation-navigator-chat-style";
const OFFICIAL_THREAD_WIDTH = 60;
const THREAD_WIDTH_MIN = 60;
const THREAD_WIDTH_MAX = 100;
const TEXT_CONTROL_SELECTOR = [
  "button",
  '[role="button"]',
  "select",
  "textarea",
  "input",
  "option"
].join(",");
const TEXT_IGNORED_CONTAINER_SELECTOR = [
  "script",
  "style",
  "noscript",
  "svg",
  "[hidden]",
  '[aria-hidden="true"]'
].join(",");

type Role = "user" | "assistant";
type SiteId = "chatgpt";
type ColorTheme = "light" | "dark";

interface ParsedMessage {
  role: Role;
  element: HTMLElement;
  text: string;
}

interface NavigatorItem {
  id: string;
  promptPreview: string;
  answerSummary: string;
  turnIndex: number;
  favorite: boolean;
  legacyIds?: string[];
  site: SiteId;
}

interface ResizeFrame {
  left: number;
  right: number;
  top: number;
  height: number;
}

interface SiteAdapter {
  id: SiteId;
  label: string;
  matches: (host: string) => boolean;
  collect: () => ParsedMessage[];
}

const anchorRegistry = new Map<string, HTMLElement>();
const nodeAnchorRegistry = new WeakMap<HTMLElement, string>();
let nextNodeAnchorIndex = 1;

const CHATGPT_HOSTS = new Set(["chat.openai.com", "chatgpt.com"]);

const siteAdapters: SiteAdapter[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    matches: (host) => CHATGPT_HOSTS.has(host),
    collect: collectChatGptMessages
  }
];

function getAdapter(): SiteAdapter {
  return siteAdapters.find((adapter) => adapter.matches(location.hostname)) ?? siteAdapters[0];
}

function detectPageTheme(): ColorTheme {
  if (document.documentElement.classList.contains("dark") || document.body.classList.contains("dark")) {
    return "dark";
  }

  const background = window.getComputedStyle(document.body).backgroundColor;
  const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match) {
    const red = Number(match[1]);
    const green = Number(match[2]);
    const blue = Number(match[3]);
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return luma < 128 ? "dark" : "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getPageId(): string {
  const pathKey = `${location.hostname}${location.pathname}`.replace(/\/+$/, "");
  return pathKey || location.hostname;
}

function getPageStorageKey(settings: NavigatorSettings, pageId = getPageId()): string {
  return makeRecordKey(settings.cacheNamespace, pageId);
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError;
      if (error?.message) {
        console.warn("[GPT聊天导航器] 读取本地缓存失败：", error.message);
        resolve(undefined);
        return;
      }

      resolve(result[key] as T | undefined);
    });
  });
}

function storageSet(values: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error?.message) {
        console.warn("[GPT聊天导航器] 写入本地缓存失败：", error.message);
        resolve(false);
        return;
      }

      resolve(true);
    });
  });
}

async function loadSettings(): Promise<NavigatorSettings> {
  return normalizeSettings(await storageGet<Partial<NavigatorSettings>>(STORAGE_SETTINGS_KEY));
}

function saveSettings(settings: NavigatorSettings): Promise<boolean> {
  return storageSet({ [STORAGE_SETTINGS_KEY]: normalizeSettings(settings) });
}

function readPageStorageRecord(pageKey: string): StoredConversationRecord | undefined {
  try {
    const value = window.localStorage.getItem(pageKey);
    return value ? (JSON.parse(value) as StoredConversationRecord) : undefined;
  } catch {
    return undefined;
  }
}

function writePageStorageRecord(pageKey: string, record: StoredConversationRecord): boolean {
  try {
    window.localStorage.setItem(pageKey, JSON.stringify(record));
    return true;
  } catch {
    console.warn("[GPT聊天导航器] 写入页面 localStorage 失败。当前导航仍会继续工作。");
    return false;
  }
}

function getThreadWidthRem(widthSetting: number): number {
  return 48 + (widthSetting - THREAD_WIDTH_MIN) * 1.55;
}

function getThreadWidthSettingFromPixels(widthPixels: number): number {
  const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  const widthRem = widthPixels / rem;
  const value = THREAD_WIDTH_MIN + (widthRem - 48) / 1.55;
  return Math.min(THREAD_WIDTH_MAX, Math.max(THREAD_WIDTH_MIN, Math.round(value)));
}

function getThreadWidthPixels(widthSetting: number): number {
  const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  return getThreadWidthRem(widthSetting) * rem;
}

async function readStoredRecord(
  settings: NavigatorSettings,
  pageKey: string
): Promise<StoredConversationRecord | undefined> {
  if (settings.cacheMode === "off") {
    return undefined;
  }

  if (settings.cacheMode === "page") {
    return readPageStorageRecord(pageKey);
  }

  return storageGet<StoredConversationRecord>(pageKey);
}

function applyChatTypography(settings: NavigatorSettings) {
  let style = document.getElementById(CHAT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = CHAT_STYLE_ID;
    document.documentElement.appendChild(style);
  }

  const fontSize = `${(settings.chatFontScale / 100).toFixed(2)}rem`;
  const codeSize = `${Math.max(0.85, (settings.chatFontScale / 100) * 0.94).toFixed(2)}rem`;
  const letterSpacing = `${settings.chatLetterSpacing.toFixed(2)}px`;
  const contentWidth = `${getThreadWidthRem(settings.chatContentWidth).toFixed(2)}rem`;
  const threadWidth = `min(${contentWidth}, calc(100vw - 24px))`;
  const layoutWidthRules =
    settings.chatContentWidth > OFFICIAL_THREAD_WIDTH
      ? `
    main {
      --cnav-thread-width: ${threadWidth};
      --thread-content-max-width: var(--cnav-thread-width) !important;
      --thread-content-width: var(--cnav-thread-width) !important;
    }

    main :is(article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]):has([data-message-author-role]) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    main :is(.mx-auto, [class*="max-w-"], [class*="thread-content"], [class*="conversation-turn"]):has([data-message-author-role]) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    main :is(article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]):has([data-message-author-role]) > :is(div, section) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    main :is(.mx-auto, [class*="thread-content"]):has(> [data-message-author-role]) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    main [data-message-author-role] {
      max-width: 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    main [data-message-author-role] > :is(div, section) {
      max-width: 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    main [data-message-author-role="assistant"] :is(.markdown, .whitespace-pre-wrap) {
      width: 100% !important;
      max-width: 100% !important;
    }
  `
      : "";

  style.textContent = `
    ${layoutWidthRules}

    main [data-message-author-role="assistant"] :is(.markdown, .whitespace-pre-wrap),
    main [data-message-author-role="assistant"] .markdown,
    main [data-message-author-role="user"] :is(.whitespace-pre-wrap, .break-words, p) {
      font-size: ${fontSize} !important;
      letter-spacing: ${letterSpacing} !important;
    }

    main [data-message-author-role="assistant"] :where(.markdown p, .markdown li, .markdown span, .markdown strong, .markdown em, .whitespace-pre-wrap, p, li),
    main [data-message-author-role="user"] :where(.whitespace-pre-wrap, .break-words, p, span) {
      font-size: inherit !important;
      letter-spacing: ${letterSpacing} !important;
    }

    main [data-message-author-role="assistant"] :where(.markdown code, .markdown pre, code, pre) {
      font-size: ${codeSize} !important;
      letter-spacing: ${Math.min(settings.chatLetterSpacing, 0.6).toFixed(2)}px !important;
    }

    main [data-message-author-role="user"] :is(.whitespace-pre-wrap, .break-words) {
      max-width: min(760px, 72vw) !important;
      overflow-wrap: anywhere !important;
      word-break: break-word !important;
    }

    main [data-message-author-role="user"] :is(.whitespace-pre-wrap, .break-words):has(> :nth-child(8)) {
      max-height: 46vh;
      overflow-y: auto;
    }
  `;
}

function safeQueryAll(selector: string, root: ParentNode = document): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(You said:|ChatGPT said:|User:|Assistant:|Model:)\s*/i, "")
    .trim();
}

function extractVisibleText(element: HTMLElement): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      const text = node.nodeValue?.trim();

      if (!parent || !text || parent.closest(`#${ROOT_ID}`)) {
        return NodeFilter.FILTER_REJECT;
      }

      const control = parent.closest(TEXT_CONTROL_SELECTOR);
      if (control && element.contains(control)) {
        return NodeFilter.FILTER_REJECT;
      }

      const ignoredContainer = parent.closest(TEXT_IGNORED_CONTAINER_SELECTOR);
      if (ignoredContainer && element.contains(ignoredContainer)) {
        return NodeFilter.FILTER_REJECT;
      }

      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue;
    if (text) {
      parts.push(text);
    }
  }

  return normalizeText(parts.join(" "));
}

function isVisibleElement(element: HTMLElement): boolean {
  if (element.closest(`#${ROOT_ID}`)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function inferRole(element: HTMLElement): Role | null {
  const explicitRole = element.getAttribute("data-message-author-role");
  if (explicitRole === "user" || explicitRole === "assistant") {
    return explicitRole;
  }

  const descriptor = [
    element.tagName,
    element.id,
    element.className,
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.getAttribute("role")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(user|human|prompt|query|request)\b/.test(descriptor)) {
    return "user";
  }

  if (/\b(assistant|model|response|answer|chatgpt)\b/.test(descriptor)) {
    return "assistant";
  }

  return null;
}

function sortByDomOrder(messages: ParsedMessage[]): ParsedMessage[] {
  return [...messages].sort((a, b) => {
    if (a.element === b.element) {
      return 0;
    }

    const position = a.element.compareDocumentPosition(b.element);
    return position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  });
}

function compactMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const compacted: ParsedMessage[] = [];

  for (const message of sortByDomOrder(messages).map((message) => ({
      ...message,
      text: normalizeText(message.text)
    }))) {
    if (!message.text || message.text.length < 2 || !document.body.contains(message.element)) {
      continue;
    }

    const duplicate = compacted.some((existing) => {
      if (existing.role !== message.role) {
        return false;
      }

      if (existing.element === message.element) {
        return true;
      }

      const nested = existing.element.contains(message.element) || message.element.contains(existing.element);
      if (!nested) {
        return false;
      }

      return existing.text === message.text || existing.text.includes(message.text) || message.text.includes(existing.text);
    });

    if (!duplicate) {
      compacted.push(message);
    }
  }

  return compacted;
}

function collectChatGptMessages(): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  const usedRoots = new Set<HTMLElement>();

  for (const roleNode of safeQueryAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')) {
    const role = inferRole(roleNode);
    if (!role) {
      continue;
    }

    const root =
      roleNode.closest<HTMLElement>('article[data-testid^="conversation-turn"]') ??
      roleNode.closest<HTMLElement>('[data-testid^="conversation-turn"]') ??
      roleNode;
    const text = extractVisibleText(roleNode) || extractVisibleText(root);

    if (text) {
      messages.push({ role, element: role === "user" ? root : roleNode, text });
      usedRoots.add(root);
    }
  }

  for (const article of safeQueryAll('article[data-testid^="conversation-turn"]')) {
    if (usedRoots.has(article)) {
      continue;
    }

    const role = inferRole(article);
    const text = extractVisibleText(article);
    if (role && text) {
      messages.push({ role, element: article, text });
    }
  }

  return compactMessages(messages);
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function getNativeMessageKey(element: HTMLElement): string | null {
  const candidates: HTMLElement[] = [];
  const addCandidate = (candidate: HTMLElement | null) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  addCandidate(element);
  addCandidate(element.closest<HTMLElement>("[data-message-id]"));
  addCandidate(element.closest<HTMLElement>('article[data-testid^="conversation-turn"]'));
  addCandidate(element.closest<HTMLElement>('[data-testid^="conversation-turn"]'));
  addCandidate(element.closest<HTMLElement>("[data-testid]"));
  addCandidate(element.closest<HTMLElement>("[id]"));

  for (const candidate of candidates) {
    const messageId = candidate.getAttribute("data-message-id")?.trim();
    if (messageId) {
      return `data-message-id:${messageId}`;
    }

    const testId = candidate.getAttribute("data-testid")?.trim();
    if (testId && /\b(message|conversation-turn|turn)\b/i.test(testId)) {
      return `data-testid:${testId}`;
    }

    const id = candidate.id.trim();
    if (id && /\b(message|conversation|turn)\b/i.test(id)) {
      return `id:${id}`;
    }
  }

  return null;
}

function getNodeSessionAnchorId(element: HTMLElement): string {
  const existing = nodeAnchorRegistry.get(element);
  if (existing) {
    return existing;
  }

  const id = `cnav-node-${nextNodeAnchorIndex.toString(36)}`;
  nextNodeAnchorIndex += 1;
  nodeAnchorRegistry.set(element, id);
  return id;
}

function getLegacyAnchorId(message: ParsedMessage, index: number): string {
  return `cnav-${stableHash(`${location.pathname}:${index}:${message.role}:${message.text.slice(0, 180)}`)}`;
}

function getStableAnchorId(message: ParsedMessage): string {
  const nativeKey = getNativeMessageKey(message.element);
  if (nativeKey) {
    const id = `cnav-msg-${stableHash(`${location.hostname}:${location.pathname}:${message.role}:${nativeKey}`)}`;
    message.element.setAttribute(ANCHOR_ATTR, id);
    return id;
  }

  const existing = message.element.getAttribute(ANCHOR_ATTR);
  if (existing) {
    return existing;
  }

  const id = getNodeSessionAnchorId(message.element);
  message.element.setAttribute(ANCHOR_ATTR, id);
  return id;
}

function compactPreview(text: string, maxLength: number): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function summarizeAnswer(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "No assistant response captured yet.";
  }

  const sentence = normalized.match(/^(.{40,180}?[.!?])\s/);
  if (sentence?.[1]) {
    return sentence[1];
  }

  return compactPreview(normalized, 180);
}

function buildNavigatorItems(favorites: Record<string, true>): NavigatorItem[] {
  const adapter = getAdapter();
  const messages = adapter.collect();
  const items: NavigatorItem[] = [];
  anchorRegistry.clear();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.role !== "user") {
      continue;
    }

    const answerParts: string[] = [];
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
      const nextMessage = messages[nextIndex];
      if (nextMessage.role === "user") {
        break;
      }

      answerParts.push(nextMessage.text);
    }

    const legacyIds = [getLegacyAnchorId(message, items.length)];
    const id = getStableAnchorId(message);
    anchorRegistry.set(id, message.element);

    items.push({
      id,
      promptPreview: compactPreview(message.text, 112),
      answerSummary: summarizeAnswer(answerParts.join("\n\n")),
      turnIndex: items.length + 1,
      favorite: Boolean(favorites[id] || legacyIds.some((legacyId) => favorites[legacyId])),
      legacyIds,
      site: adapter.id
    });
  }

  return items;
}

function scrollToNavigatorItem(id: string) {
  const element = anchorRegistry.get(id) ?? document.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="${id}"]`);
  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center" });
  flashAnchor(element);
}

function flashAnchor(element: HTMLElement) {
  const previousOutline = element.style.outline;
  const previousOutlineOffset = element.style.outlineOffset;
  const previousTransition = element.style.transition;

  element.style.transition = "outline-color 120ms ease, outline-offset 120ms ease";
  element.style.outline = "2px solid #2563eb";
  element.style.outlineOffset = "4px";

  window.setTimeout(() => {
    element.style.outline = previousOutline;
    element.style.outlineOffset = previousOutlineOffset;
    element.style.transition = previousTransition;
  }, 1300);
}

function installRouteEvents() {
  const marker = "__conversationNavigatorRouteEventsInstalled";
  const win = window as unknown as Window & Record<string, boolean>;
  if (win[marker]) {
    return;
  }

  win[marker] = true;
  const notify = () => window.dispatchEvent(new Event("conversation-navigator-route-change"));
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    notify();
    return result;
  };

  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    notify();
    return result;
  };
}

function persistRecord(
  settings: NavigatorSettings,
  pageKey: string,
  items: NavigatorItem[],
  favorites: Record<string, true>
): Promise<boolean> {
  if (settings.cacheMode === "off") {
    return Promise.resolve(true);
  }

  const record: StoredConversationRecord = {
    schemaVersion: 1,
    pageKey,
    url: location.href,
    host: location.hostname,
    title: document.title || getAdapter().label,
    updatedAt: Date.now(),
    favorites,
    nodes: items.map((item) => ({
      id: item.id,
      promptPreview: item.promptPreview,
      answerSummary: item.answerSummary,
      turnIndex: item.turnIndex,
      favorite: item.favorite,
      updatedAt: Date.now()
    }))
  };

  if (settings.cacheMode === "page") {
    return Promise.resolve(writePageStorageRecord(pageKey, record));
  }

  return storageSet({ [pageKey]: record });
}

function makeRecordSignature(items: NavigatorItem[], favorites: Record<string, true>): string {
  const favoriteIds = Object.keys(favorites).sort().join(",");
  const itemSignature = items
    .map((item) => `${item.id}:${item.promptPreview}:${item.answerSummary}:${item.favorite ? "1" : "0"}`)
    .join("|");

  return `${favoriteIds}::${itemSignature}`;
}

function ConversationNavigator() {
  const adapter = getAdapter();
  const [settings, setSettings] = useState<NavigatorSettings>(DEFAULT_SETTINGS);
  const t = getTranslation(settings.language);
  const [pageId, setPageId] = useState(getPageId);
  const pageKey = useMemo(() => getPageStorageKey(settings, pageId), [pageId, settings]);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [items, setItems] = useState<NavigatorItem[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, true>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ColorTheme>(detectPageTheme);
  const [resizeFrame, setResizeFrame] = useState<ResizeFrame | null>(null);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);
  const favoritesRef = useRef(favorites);
  const pageKeyRef = useRef(pageKey);
  const settingsRef = useRef(settings);
  const listRef = useRef<HTMLDivElement | null>(null);
  const revealLatestOnNextPaintRef = useRef(true);
  const openingTimerRef = useRef<number | undefined>(undefined);
  const lastRecordSignatureRef = useRef("");

  favoritesRef.current = favorites;
  pageKeyRef.current = pageKey;
  settingsRef.current = settings;

  const scan = useCallback(async () => {
    const nextItems = buildNavigatorItems(favoritesRef.current);
    setItems(nextItems);
    const nextSignature = makeRecordSignature(nextItems, favoritesRef.current);
    if (nextSignature !== lastRecordSignatureRef.current) {
      lastRecordSignatureRef.current = nextSignature;
      await persistRecord(settingsRef.current, pageKeyRef.current, nextItems, favoritesRef.current);
    }
  }, []);

  const applySettingsPatch = (patch: Partial<NavigatorSettings>) => {
    const nextSettings = normalizeSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    applyChatTypography(nextSettings);
    return nextSettings;
  };

  const updateSettings = async (patch: Partial<NavigatorSettings>) => {
    const nextSettings = applySettingsPatch(patch);
    await saveSettings(nextSettings);
  };

  useEffect(() => {
    installRouteEvents();
    let lastHref = location.href;

    const updatePageKey = () => {
      revealLatestOnNextPaintRef.current = true;
      window.setTimeout(() => setPageId(getPageId()), 50);
    };

    const checkRoute = () => {
      if (location.href === lastHref) {
        return;
      }

      lastHref = location.href;
      updatePageKey();
    };

    const routeInterval = window.setInterval(checkRoute, 1000);

    window.addEventListener("popstate", updatePageKey);
    window.addEventListener("hashchange", updatePageKey);
    window.addEventListener("conversation-navigator-route-change", updatePageKey);

    return () => {
      window.clearInterval(routeInterval);
      window.removeEventListener("popstate", updatePageKey);
      window.removeEventListener("hashchange", updatePageKey);
      window.removeEventListener("conversation-navigator-route-change", updatePageKey);
    };
  }, []);

  useEffect(() => {
    const syncTheme = () => setTheme(detectPageTheme());
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const observer = new MutationObserver(syncTheme);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"]
    });

    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"]
      });
    }

    mediaQuery.addEventListener("change", syncTheme);
    syncTheme();

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", syncTheme);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadSettings().then((nextSettings) => {
      if (!cancelled) {
        setSettings(nextSettings);
      }
    });

    const handleSettingsChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[STORAGE_SETTINGS_KEY]) {
        return;
      }

      setSettings(normalizeSettings(changes[STORAGE_SETTINGS_KEY].newValue));
    };

    chrome.storage.onChanged.addListener(handleSettingsChange);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleSettingsChange);
    };
  }, []);

  const updateResizeFrame = useCallback(() => {
    if (adapter.id !== "chatgpt") {
      setResizeFrame(null);
      return;
    }

    const main = document.querySelector<HTMLElement>("main");
    const rect = main?.getBoundingClientRect();
    const leftBound = Math.max(0, rect?.left ?? 0);
    const rightBound = Math.min(window.innerWidth, rect?.right ?? window.innerWidth);
    const availableWidth = Math.max(340, rightBound - leftBound - 24);
    const width = Math.min(getThreadWidthPixels(settingsRef.current.chatContentWidth), availableWidth);
    const center = leftBound + (rightBound - leftBound) / 2;
    const top = Math.max(112, (rect?.top ?? 0) + 28);
    const bottomGap = 112;

    setResizeFrame({
      left: Math.round(center - width / 2),
      right: Math.round(center + width / 2),
      top: Math.round(top),
      height: Math.max(260, Math.round(window.innerHeight - top - bottomGap))
    });
  }, [adapter.id]);

  useEffect(() => {
    applyChatTypography(settings);
    window.requestAnimationFrame(updateResizeFrame);
  }, [settings.chatContentWidth, settings.chatFontScale, settings.chatLetterSpacing, updateResizeFrame]);

  useEffect(() => {
    return () => {
      if (openingTimerRef.current) {
        window.clearTimeout(openingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    updateResizeFrame();
    const handleResize = () => updateResizeFrame();
    const interval = window.setInterval(updateResizeFrame, 1600);

    window.addEventListener("resize", handleResize);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", handleResize);
    };
  }, [pageId, updateResizeFrame]);

  useEffect(() => {
    if (!settings.autoCollapseOnOutsideClick || settings.collapsed) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || document.getElementById(ROOT_ID)?.contains(target)) {
        return;
      }

      updateSettings({ collapsed: true });
    };

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [settings.autoCollapseOnOutsideClick, settings.collapsed]);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      const storedRecord = await readStoredRecord(settings, pageKey);

      if (cancelled) {
        return;
      }

      setFavorites(storedRecord?.favorites ?? {});
    }

    loadState();

    return () => {
      cancelled = true;
    };
  }, [pageKey, settings]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      scan();
    }, 100);

    return () => window.clearTimeout(timer);
  }, [favorites, pageKey, scan, settings.cacheMode]);

  useEffect(() => {
    let timer: number | undefined;
    const scheduleScan = () => {
      if (timer) {
        window.clearTimeout(timer);
      }

      timer = window.setTimeout(() => {
        scan();
      }, SCAN_DEBOUNCE_MS);
    };

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });

    return () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      observer.disconnect();
    };
  }, [scan]);

  useEffect(() => {
    if (
      settings.collapsed ||
      items.length === 0 ||
      favoritesOnly ||
      query.trim() ||
      !revealLatestOnNextPaintRef.current
    ) {
      return undefined;
    }

    revealLatestOnNextPaintRef.current = false;

    const scrollToLatest = () => {
      const list = listRef.current;
      if (!list) {
        return;
      }

      list.scrollTo({
        top: list.scrollHeight,
        behavior: "smooth"
      });
    };

    const frame = window.requestAnimationFrame(scrollToLatest);
    const timer = window.setTimeout(scrollToLatest, 180);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [favoritesOnly, items.length, query, settings.collapsed]);

  useEffect(() => {
    let frame = 0;

    const updateActive = () => {
      frame = 0;
      let selected: string | null = null;
      let bestTop = Number.NEGATIVE_INFINITY;
      const threshold = window.innerHeight * 0.45;

      for (const item of items) {
        const element = anchorRegistry.get(item.id);
        if (!element) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        if (rect.top <= threshold && rect.bottom >= 0 && rect.top > bestTop) {
          selected = item.id;
          bestTop = rect.top;
        }
      }

      if (!selected) {
        selected =
          items.find((item) => {
            const element = anchorRegistry.get(item.id);
            const rect = element?.getBoundingClientRect();
            return rect ? rect.top >= 0 && rect.top < window.innerHeight : false;
          })?.id ?? null;
      }

      setActiveId(selected);
    };

    const scheduleActiveUpdate = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(updateActive);
    };

    scheduleActiveUpdate();
    window.addEventListener("scroll", scheduleActiveUpdate, { passive: true });
    window.addEventListener("resize", scheduleActiveUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", scheduleActiveUpdate);
      window.removeEventListener("resize", scheduleActiveUpdate);
    };
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (favoritesOnly && !item.favorite) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return `${item.promptPreview} ${item.answerSummary}`.toLowerCase().includes(normalizedQuery);
    });
  }, [favoritesOnly, items, query]);

  const cacheLabel =
    settings.cacheMode === "chrome"
      ? t.extensionCache
      : settings.cacheMode === "page"
        ? t.pageCache
        : t.memoryOnly;

  const toggleCollapsed = async () => {
    if (settings.collapsed) {
      revealLatestOnNextPaintRef.current = true;
      setIsOpening(true);
      if (openingTimerRef.current) {
        window.clearTimeout(openingTimerRef.current);
      }
      openingTimerRef.current = window.setTimeout(() => {
        setIsOpening(false);
        openingTimerRef.current = undefined;
      }, 300);
    } else {
      setIsOpening(false);
      if (openingTimerRef.current) {
        window.clearTimeout(openingTimerRef.current);
        openingTimerRef.current = undefined;
      }
    }

    await updateSettings({ collapsed: !settings.collapsed });
  };

  const startThreadResize =
    (side: "left" | "right") => (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = getThreadWidthPixels(settingsRef.current.chatContentWidth);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      setResizingSide(side);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = side === "right" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        const nextWidth = startWidth + delta * 2;
        const nextValue = getThreadWidthSettingFromPixels(nextWidth);
        applySettingsPatch({ chatContentWidth: nextValue, chatLayoutVersion: 2 });
        updateResizeFrame();
      };

      const handleUp = () => {
        setResizingSide(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("pointermove", handleMove, true);
        document.removeEventListener("pointerup", handleUp, true);
        document.removeEventListener("pointercancel", handleUp, true);
        saveSettings(settingsRef.current);
      };

      document.addEventListener("pointermove", handleMove, true);
      document.addEventListener("pointerup", handleUp, true);
      document.addEventListener("pointercancel", handleUp, true);
    };

  const toggleFavorite = async (item: NavigatorItem) => {
    const nextFavorites = { ...favorites };
    const itemFavorite = Boolean(
      nextFavorites[item.id] || item.legacyIds?.some((legacyId) => nextFavorites[legacyId])
    );

    if (itemFavorite) {
      delete nextFavorites[item.id];
      item.legacyIds?.forEach((legacyId) => delete nextFavorites[legacyId]);
    } else {
      nextFavorites[item.id] = true;
    }

    const nextItems = items.map((current) => ({
      ...current,
      favorite: current.id === item.id ? !itemFavorite : current.favorite
    }));

    setFavorites(nextFavorites);
    setItems(nextItems);
    await persistRecord(settings, pageKey, nextItems, nextFavorites);
  };

  return (
    <>
      {resizeFrame ? (
        <>
          <button
            className={`cnav-thread-handle is-left${resizingSide === "left" ? " is-dragging" : ""}`}
            type="button"
            style={{
              left: resizeFrame.left,
              top: resizeFrame.top,
              height: resizeFrame.height
            }}
            aria-label={t.contentWidth}
            title={t.contentWidth}
            onPointerDown={startThreadResize("left")}
          />
          <button
            className={`cnav-thread-handle is-right${resizingSide === "right" ? " is-dragging" : ""}`}
            type="button"
            style={{
              left: resizeFrame.right,
              top: resizeFrame.top,
              height: resizeFrame.height
            }}
            aria-label={t.contentWidth}
            title={t.contentWidth}
            onPointerDown={startThreadResize("right")}
          />
        </>
      ) : null}

      <aside
        className={`cnav-shell${settings.collapsed ? " is-collapsed" : ""}${isOpening ? " is-opening" : ""}`}
        data-cache-mode={settings.cacheMode}
        data-theme={theme}
        aria-label={t.appName}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
      {settings.collapsed ? (
        <button
          className="cnav-collapsed-button"
          type="button"
          onClick={toggleCollapsed}
          title={t.openNavigator}
          aria-label={t.openNavigator}
        >
          <PanelRightOpen size={20} aria-hidden="true" />
          <span>{items.length}</span>
        </button>
      ) : (
        <div className="cnav-panel">
          <header className="cnav-header">
            <div className="cnav-title-group">
              <span className="cnav-kicker">{adapter.label}</span>
              <h1>{t.appName}</h1>
            </div>
            <div className="cnav-header-actions">
              <button
                className={`cnav-icon-button${displayOpen ? " is-active" : ""}`}
                type="button"
                onClick={() => setDisplayOpen((value) => !value)}
                title={t.displaySettings}
                aria-label={t.displaySettings}
              >
                <SlidersHorizontal size={17} aria-hidden="true" />
              </button>
              <button
                className="cnav-icon-button"
                type="button"
                onClick={toggleCollapsed}
                title={t.collapseNavigator}
                aria-label={t.collapseNavigator}
              >
                <PanelRightClose size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          {displayOpen ? (
            <div className="cnav-display-panel">
              <label className="cnav-display-field cnav-language-field">
                <span>
                  <Languages size={14} aria-hidden="true" />
                  {t.language}
                </span>
                <select
                  value={settings.language}
                  onChange={(event) =>
                    updateSettings({ language: event.currentTarget.value as AppLanguage })
                  }
                >
                  {(Object.keys(LANGUAGE_NAMES) as AppLanguage[]).map((language) => (
                    <option value={language} key={language}>
                      {LANGUAGE_NAMES[language]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="cnav-display-field">
                <span>{t.fontSize}</span>
                <input
                  type="range"
                  min="85"
                  max="220"
                  step="1"
                  value={settings.chatFontScale}
                  onChange={(event) => updateSettings({ chatFontScale: Number(event.currentTarget.value) })}
                />
                <output>{settings.chatFontScale}%</output>
                <button
                  className="cnav-reset-button"
                  type="button"
                  onClick={() => updateSettings({ chatFontScale: 100 })}
                >
                  {t.resetDisplay}
                </button>
              </div>
              <div className="cnav-display-field">
                <span>{t.letterSpacing}</span>
                <input
                  type="range"
                  min="0"
                  max="1.2"
                  step="0.05"
                  value={settings.chatLetterSpacing}
                  onChange={(event) =>
                    updateSettings({ chatLetterSpacing: Number(event.currentTarget.value) })
                  }
                />
                <output>{settings.chatLetterSpacing.toFixed(2)}px</output>
                <button
                  className="cnav-reset-button"
                  type="button"
                  onClick={() => updateSettings({ chatLetterSpacing: 0 })}
                >
                  {t.resetDisplay}
                </button>
              </div>
              <button
                className="cnav-official-button"
                type="button"
                onClick={() =>
                  updateSettings({
                    chatLayoutVersion: 2,
                    chatContentWidth: OFFICIAL_THREAD_WIDTH
                  })
                }
              >
                {t.officialWidthReset}
              </button>
              <label className="cnav-toggle-field">
                <span>{t.autoCollapse}</span>
                <input
                  type="checkbox"
                  checked={settings.autoCollapseOnOutsideClick}
                  onChange={(event) =>
                    updateSettings({ autoCollapseOnOutsideClick: event.currentTarget.checked })
                  }
                />
              </label>
            </div>
          ) : null}

          <div className="cnav-controls">
            <label className="cnav-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t.searchNodes}
                type="search"
              />
            </label>
            <button
              className={`cnav-icon-button${favoritesOnly ? " is-active" : ""}`}
              type="button"
              onClick={() => setFavoritesOnly((value) => !value)}
              title={t.showFavoritesOnly}
              aria-label={t.showFavoritesOnly}
            >
              <Star size={17} aria-hidden="true" />
            </button>
            <button
              className="cnav-icon-button"
              type="button"
              onClick={scan}
              title={t.refresh}
              aria-label={t.refresh}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="cnav-list" role="list" ref={listRef}>
            {filteredItems.length === 0 ? (
              <div className="cnav-empty">
                {items.length === 0 ? t.noNodes : t.noNodeMatches}
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  className={`cnav-item${activeId === item.id ? " is-active" : ""}`}
                  key={item.id}
                  role="listitem"
                >
                  <button
                    className="cnav-item-main"
                    type="button"
                    onClick={() => scrollToNavigatorItem(item.id)}
                  >
                    <span className="cnav-item-index">{item.turnIndex}</span>
                    <span className="cnav-item-copy">
                      <span className="cnav-prompt">{item.promptPreview}</span>
                      <span className="cnav-answer">{item.answerSummary}</span>
                    </span>
                    <ChevronRight className="cnav-item-arrow" size={15} aria-hidden="true" />
                  </button>
                  <button
                    className={`cnav-star${item.favorite ? " is-favorite" : ""}`}
                    type="button"
                    onClick={() => toggleFavorite(item)}
                    title={item.favorite ? t.favoriteRemove : t.favoriteAdd}
                    aria-label={item.favorite ? t.favoriteRemove : t.favoriteAdd}
                  >
                    <Star size={15} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>

          <footer className="cnav-footer">
            <span>{`${items.length} ${t.nodesIndexed}`}</span>
            <span className="cnav-watermark">{t.watermark}</span>
            <span>{cacheLabel}</span>
          </footer>
        </div>
      )}
      </aside>
    </>
  );
}

function mount() {
  if (document.getElementById(ROOT_ID)) {
    return;
  }

  const rootElement = document.createElement("div");
  rootElement.id = ROOT_ID;
  document.documentElement.appendChild(rootElement);
  createRoot(rootElement).render(<ConversationNavigator />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}

