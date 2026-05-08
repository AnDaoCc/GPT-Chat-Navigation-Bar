import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  ChevronRight,
  ChevronsUpDown,
  GripVertical,
  Languages,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star
} from "lucide-react";
import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";
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
const MODEL_CATALOG_STORAGE_KEY = "conversationNavigator:modelCatalog:v1";
const SCAN_DEBOUNCE_MS = 350;
const CHAT_STYLE_ID = "conversation-navigator-chat-style";
const OFFICIAL_THREAD_WIDTH = 60;
const THREAD_WIDTH_MIN = 60;
const THREAD_WIDTH_MAX = 100;
const DEFAULT_TOKEN_BUDGET = 128000;
const TOKEN_CACHE_LIMIT = 900;
const MODEL_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_HUD_WIDTH = 246;
const DEFAULT_HUD_GAP = 26;
const TEXT_CONTROL_SELECTOR = [
  "button",
  '[role="button"]',
  '[role="menuitem"]',
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
  "menu",
  '[role="menu"]',
  '[role="toolbar"]',
  "[hidden]",
  '[aria-hidden="true"]',
  '[data-testid*="copy" i]',
  '[data-testid*="clipboard" i]',
  '[data-testid*="action" i]',
  '[data-testid*="toolbar" i]',
  '[class*="copy" i]',
  '[class*="toolbar" i]'
].join(",");

type Role = "user" | "assistant";
type SiteId = "chatgpt";
type ColorTheme = "light" | "dark";
type HeatLevel = 0 | 1 | 2 | 3;

interface ParsedMessage {
  role: Role;
  element: HTMLElement;
  text: string;
}

interface TokenBreakdown {
  total: number;
  code: number;
  table: number;
}

interface NavigatorItem {
  id: string;
  promptPreview: string;
  answerSummary: string;
  turnIndex: number;
  favorite: boolean;
  promptTokens: number;
  answerTokens: number;
  totalTokens: number;
  heatLevel: HeatLevel;
  site: SiteId;
}

interface MessageMapEntry {
  id: string;
  role: Role;
  tokenCount: number;
  codeTokens: number;
  tableTokens: number;
  text: string;
  turnIndex: number;
  favorite: boolean;
  heatLevel: HeatLevel;
}

interface BuildNavigatorResult {
  items: NavigatorItem[];
  mapEntries: MessageMapEntry[];
}

interface TokenStats {
  total: number;
  viewport: number;
  user: number;
  assistant: number;
  code: number;
  table: number;
  budget: number;
  budgetSource: "model" | "manual";
  budgetLabel: string;
  modelLabel: string;
  hotMessages: number;
}

interface ViewportMetrics {
  tokenCount: number;
  visibleIds: Set<string>;
  topRatio: number;
  heightRatio: number;
}

interface ModelBudgetEntry {
  id: string;
  label: string;
  budget: number;
  source: "built-in" | "openai";
  aliases: string[];
}

interface StoredModelCatalog {
  updatedAt: number;
  models: ModelBudgetEntry[];
}

type ModelSyncStatus = "idle" | "syncing" | "synced" | "failed";

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
const tokenCountCache = new Map<string, number>();
const tokenKeyQueue: string[] = [];
let nextNodeAnchorIndex = 1;
let tokenizer: Tiktoken | null = null;

const BUILT_IN_MODEL_BUDGETS: ModelBudgetEntry[] = [
  {
    id: "chatgpt-auto",
    label: "自动识别当前模型",
    budget: DEFAULT_TOKEN_BUDGET,
    source: "built-in",
    aliases: ["auto", "current model", "chatgpt"]
  },
  {
    id: "gpt-5.5-instant",
    label: "GPT-5.5 Instant",
    budget: 32000,
    source: "built-in",
    aliases: ["gpt-5.5 instant", "gpt 5.5 instant", "instant", "fast"]
  },
  {
    id: "gpt-5.5-thinking",
    label: "GPT-5.5 Thinking",
    budget: 256000,
    source: "built-in",
    aliases: ["gpt-5.5 thinking", "gpt 5.5 thinking", "thinking", "reasoning"]
  },
  {
    id: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    budget: 400000,
    source: "built-in",
    aliases: ["gpt-5.5-pro", "gpt-5.5 pro", "gpt 5.5 pro", "pro"]
  }
];

const OPENAI_MODEL_SYNC_URLS = [
  "https://raw.githubusercontent.com/AnDaoCc/GPT-/main/model-catalog.json",
  "https://help.openai.com/en/articles/11909943-gpt-53-and-gpt-55-in-chatgpt",
  "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
  "https://openai.com/index/gpt-5-5-instant/",
  "https://openai.com/index/introducing-gpt-5-5/",
  "https://platform.openai.com/docs/deprecations",
  "https://platform.openai.com/docs/models"
];

const RETIRED_CHATGPT_MODEL_IDS = new Set([
  "gpt-3.5",
  "gpt-4",
  "gpt-4-turbo",
  "gpt-4o",
  "gpt-4.1",
  "gpt-5",
  "gpt-5-chat",
  "gpt-5.1",
  "gpt-5.2",
  "o-series",
  "o1",
  "o3",
  "o4",
  "o4-mini"
]);

const NON_CHATGPT_MODEL_PATTERN = /(audio|realtime|transcribe|tts|image|vision|sora|embedding|moderation|codex|computer-use|deep-research|search|davinci|babbage|whisper|dall)/i;
const MODEL_MODE_ORDER = ["instant", "thinking", "pro", "base"];

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

function getTokenizer(): Tiktoken {
  tokenizer ??= new Tiktoken(o200kBase);
  return tokenizer;
}

function approximateTokenCount(text: string): number {
  const normalized = normalizeText(text);
  if (!normalized) {
    return 0;
  }

  const cjk = normalized.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
  const asciiWords = normalized.match(/[a-zA-Z0-9_]+/g)?.length ?? 0;
  const punctuation = normalized.match(/[^\s\w\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
  return Math.max(1, Math.ceil(cjk * 1.08 + asciiWords * 1.25 + punctuation * 0.55));
}

function countTokens(text: string, cacheSeed: string): number {
  const normalized = normalizeText(text);
  if (!normalized) {
    return 0;
  }

  const cacheKey = `${cacheSeed}:${stableHash(normalized)}`;
  const cached = tokenCountCache.get(cacheKey);
  if (typeof cached === "number") {
    return cached;
  }

  let count = 0;
  try {
    count = getTokenizer().encode(normalized).length;
  } catch {
    count = approximateTokenCount(normalized);
  }

  tokenCountCache.set(cacheKey, count);
  tokenKeyQueue.push(cacheKey);
  while (tokenKeyQueue.length > TOKEN_CACHE_LIMIT) {
    const staleKey = tokenKeyQueue.shift();
    if (staleKey) {
      tokenCountCache.delete(staleKey);
    }
  }

  return count;
}

function sumDescendantTokens(element: HTMLElement, selector: string, seed: string): number {
  const seen = new Set<string>();
  let total = 0;

  for (const child of safeQueryAll(selector, element)) {
    const text = extractVisibleText(child);
    if (!text) {
      continue;
    }

    const key = stableHash(text);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    total += countTokens(text, `${seed}:${selector}:${seen.size}`);
  }

  return total;
}

function getTokenBreakdown(message: ParsedMessage, id: string): TokenBreakdown {
  const total = countTokens(message.text, id);
  const code = Math.min(total, sumDescendantTokens(message.element, "pre, code", `${id}:code`));
  const table = Math.min(total, sumDescendantTokens(message.element, "table, [role='table']", `${id}:table`));
  return { total, code, table };
}

function getHeatLevel(tokenCount: number, cumulativeTokens: number, budget: number): HeatLevel {
  if (tokenCount >= 8000 || cumulativeTokens > budget) {
    return 3;
  }

  if (tokenCount >= 3000 || cumulativeTokens > budget * 0.82) {
    return 2;
  }

  if (tokenCount >= 1200 || cumulativeTokens > budget * 0.62) {
    return 1;
  }

  return 0;
}

function getNativeMessageKey(element: HTMLElement): string | null {
  const candidates: HTMLElement[] = [];
  const addCandidate = (candidate: HTMLElement | null) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  addCandidate(element);
  addCandidate(element.querySelector<HTMLElement>("[data-message-id]"));
  addCandidate(element.querySelector<HTMLElement>("[data-turn-id]"));
  addCandidate(element.querySelector<HTMLElement>('article[data-testid^="conversation-turn"]'));
  addCandidate(element.querySelector<HTMLElement>('[data-testid^="conversation-turn"]'));
  addCandidate(element.closest<HTMLElement>("[data-message-id]"));
  addCandidate(element.closest<HTMLElement>("[data-turn-id]"));
  addCandidate(element.closest<HTMLElement>('article[data-testid^="conversation-turn"]'));
  addCandidate(element.closest<HTMLElement>('[data-testid^="conversation-turn"]'));
  addCandidate(element.closest<HTMLElement>("[data-testid]"));
  addCandidate(element.closest<HTMLElement>("[id]"));

  for (const candidate of candidates) {
    const messageId = candidate.getAttribute("data-message-id")?.trim();
    if (messageId) {
      return `data-message-id:${messageId}`;
    }

    const turnId = candidate.getAttribute("data-turn-id")?.trim();
    if (turnId) {
      return `data-turn-id:${turnId}`;
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

function buildNavigatorData(favorites: Record<string, true>, tokenBudget = DEFAULT_TOKEN_BUDGET): BuildNavigatorResult {
  const adapter = getAdapter();
  const messages = adapter.collect();
  const items: NavigatorItem[] = [];
  const mapEntries: MessageMapEntry[] = [];
  const messageIds: string[] = [];
  const tokenBreakdowns: TokenBreakdown[] = [];
  anchorRegistry.clear();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const id = getStableAnchorId(message);
    const tokenBreakdown = getTokenBreakdown(message, id);

    messageIds.push(id);
    tokenBreakdowns.push(tokenBreakdown);
    anchorRegistry.set(id, message.element);
  }

  let cumulativeTokens = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const id = messageIds[index];
    const tokenBreakdown = tokenBreakdowns[index];
    cumulativeTokens += tokenBreakdown.total;

    if (message.role !== "user") {
      mapEntries.push({
        id,
        role: message.role,
        tokenCount: tokenBreakdown.total,
        codeTokens: tokenBreakdown.code,
        tableTokens: tokenBreakdown.table,
        text: message.text,
        turnIndex: Math.max(1, items.length),
        favorite: false,
        heatLevel: getHeatLevel(tokenBreakdown.total, cumulativeTokens, tokenBudget)
      });
      continue;
    }

    const answerParts: string[] = [];
    let answerTokens = 0;
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
      const nextMessage = messages[nextIndex];
      if (nextMessage.role === "user") {
        break;
      }

      answerParts.push(nextMessage.text);
      answerTokens += tokenBreakdowns[nextIndex]?.total ?? 0;
    }

    const favorite = Boolean(favorites[id]);
    const totalTokens = tokenBreakdown.total + answerTokens;
    const heatLevel = getHeatLevel(totalTokens, cumulativeTokens + answerTokens, tokenBudget);

    items.push({
      id,
      promptPreview: compactPreview(message.text, 112),
      answerSummary: summarizeAnswer(answerParts.join("\n\n")),
      turnIndex: items.length + 1,
      favorite,
      promptTokens: tokenBreakdown.total,
      answerTokens,
      totalTokens,
      heatLevel,
      site: adapter.id
    });

    mapEntries.push({
      id,
      role: message.role,
      tokenCount: tokenBreakdown.total,
      codeTokens: tokenBreakdown.code,
      tableTokens: tokenBreakdown.table,
      text: message.text,
      turnIndex: items.length,
      favorite,
      heatLevel
    });
  }

  return { items, mapEntries };
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
      promptTokens: item.promptTokens,
      answerTokens: item.answerTokens,
      totalTokens: item.totalTokens,
      heatLevel: item.heatLevel,
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
    .map((item) => `${item.id}:${item.promptPreview}:${item.answerSummary}:${item.totalTokens}:${item.favorite ? "1" : "0"}`)
    .join("|");

  return `${favoriteIds}::${itemSignature}`;
}

function formatTokenCount(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  }

  return String(value);
}

function normalizeDetectedChatGptModelLabel(value: string): string {
  const text = normalizeText(value)
    .replace(/\b(model|mode|当前模型|模型)\b\s*[:：]?\s*/gi, "")
    .trim();
  const lower = text.toLowerCase();

  if (!text || text.length > 72 || /token|预算|local estimate|copy|share|settings|导航器|navigator/i.test(text)) {
    return "";
  }

  const explicit = text.match(/\bGPT\s*[- ]?\s*(\d+(?:\.\d+)?)(?:\s*[- ]?\s*(instant|thinking|pro))?\b/i);
  if (explicit) {
    const version = explicit[1];
    const mode = explicit[2]?.toLowerCase();
    if (mode === "instant") {
      return `GPT-${version} Instant`;
    }
    if (mode === "thinking") {
      return `GPT-${version} Thinking`;
    }
    if (mode === "pro") {
      return `GPT-${version} Pro`;
    }
    return `GPT-${version}`;
  }

  if (/^(instant|fast)$/i.test(text) || /\binstant\b/.test(lower)) {
    return "GPT-5.5 Instant";
  }

  if (/^(thinking|reasoning)$/i.test(text) || /\bthinking\b/.test(lower)) {
    return "GPT-5.5 Thinking";
  }

  if (/^pro$/i.test(text) || /\bgpt\b.*\bpro\b/i.test(text)) {
    return "GPT-5.5 Pro";
  }

  return "";
}

function scoreModelCandidate(element: HTMLElement, normalizedLabel: string, rawText: string): number {
  let score = 0;
  const testId = element.getAttribute("data-testid") || "";
  const ariaLabel = element.getAttribute("aria-label") || "";
  const text = normalizeText(rawText);

  if (/model|gpt/i.test(testId) || /model|gpt/i.test(ariaLabel)) {
    score += 40;
  }
  if (/^(Instant|Thinking|Pro)$/i.test(text)) {
    score += 34;
  }
  if (/GPT[- ]?\d/i.test(text)) {
    score += 30;
  }
  if (element.closest("form, main")) {
    score += 12;
  }
  if (element.matches("button, [role='button']")) {
    score += 8;
  }
  if (/Thinking|Pro/.test(normalizedLabel)) {
    score += 6;
  }

  return score - Math.max(0, text.length - 32);
}

function detectModelLabel(): string {
  const selectors = [
    '[data-testid*="model" i]',
    '[aria-label*="model" i]',
    '[aria-label*="GPT" i]',
    "main form button",
    "form button",
    "header button",
    "button",
    '[role="button"]'
  ];
  let best: { label: string; score: number } | null = null;

  for (const selector of selectors) {
    for (const element of safeQueryAll(selector)) {
      if (!isVisibleElement(element) || element.closest(`#${ROOT_ID}`)) {
        continue;
      }

      const textValues = [
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean) as string[];

      for (const rawText of textValues) {
        const label = normalizeDetectedChatGptModelLabel(rawText);
        if (!label) {
          continue;
        }
        const rawNormalized = normalizeText(rawText);
        const modelishAttributes = `${element.getAttribute("data-testid") || ""} ${element.getAttribute("aria-label") || ""}`;
        if (/^Pro$/i.test(rawNormalized) && !element.closest("form, main") && !/model|gpt/i.test(modelishAttributes)) {
          continue;
        }

        const score = scoreModelCandidate(element, label, rawText);
        if (!best || score > best.score) {
          best = { label, score };
        }
      }
    }
  }

  return best?.label ?? "";
}

function parseBudgetText(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim().toLowerCase();
  const million = normalized.match(/^(\d+(?:\.\d+)?)\s*m$/);
  if (million) {
    return Math.round(Number(million[1]) * 1000000);
  }

  const thousand = normalized.match(/^(\d+(?:\.\d+)?)\s*k$/);
  if (thousand) {
    return Math.round(Number(thousand[1]) * 1000);
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 8000 ? Math.round(numeric) : null;
}

function normalizeModelId(value: string): string | null {
  const modelMatch = value
    .replace(/\bGPT\s*[- ]?\s*(\d)/gi, "gpt-$1")
    .match(/\b(?:gpt|o)[a-z0-9_.-]*(?:[\s_-]+(?:mini|nano|pro|chat|thinking|instant|codex|max|audio|realtime))*\b/i);

  if (!modelMatch?.[0]) {
    return null;
  }

  const id = modelMatch[0]
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");

  return /^(?:gpt|o)[a-z0-9]/.test(id) ? id : null;
}

function formatModelLabelFromId(id: string): string {
  return id
    .replace(/^gpt-/, "GPT-")
    .replace(/\bmini\b/g, "Mini")
    .replace(/\bnano\b/g, "Nano")
    .replace(/\bpro\b/g, "Pro")
    .replace(/\bchat\b/g, "Chat")
    .replace(/\bthinking\b/g, "Thinking")
    .replace(/\binstant\b/g, "Instant")
    .replace(/\bcodex\b/g, "Codex")
    .replace(/\bmax\b/g, "Max")
    .replace(/\baudio\b/g, "Audio")
    .replace(/\brealtime\b/g, "Realtime");
}

function makeModelAliases(id: string, label: string, aliases: string[] = []): string[] {
  return Array.from(new Set([
    id,
    id.replace(/-/g, " "),
    label,
    label.toLowerCase(),
    ...aliases
  ].filter(Boolean)));
}

function defaultBudgetForModelId(id: string): number {
  if (/\bpro\b/.test(id)) {
    return 400000;
  }
  if (/\bthinking\b/.test(id)) {
    return 256000;
  }
  if (/\binstant\b/.test(id)) {
    return 32000;
  }
  return DEFAULT_TOKEN_BUDGET;
}

function createModelEntry(rawName: string, budget?: number | null, aliases: string[] = []): ModelBudgetEntry | null {
  const id = normalizeModelId(rawName);
  if (!id || !/^gpt-\d/.test(id) || NON_CHATGPT_MODEL_PATTERN.test(id)) {
    return null;
  }

  const label = formatModelLabelFromId(id);
  return {
    id,
    label,
    budget: budget && budget >= 8000 ? Math.round(budget) : defaultBudgetForModelId(id),
    source: "openai",
    aliases: makeModelAliases(id, label, aliases)
  };
}

function parseOnlineModelCatalog(text: string): ModelBudgetEntry[] {
  try {
    const parsed = JSON.parse(text) as { models?: Array<Partial<ModelBudgetEntry>> };
    if (!Array.isArray(parsed.models)) {
      return [];
    }

    const models: ModelBudgetEntry[] = [];
    for (const model of parsed.models) {
      const budget = Number(model.budget);
      const aliases = Array.isArray(model.aliases)
        ? model.aliases.map((alias) => String(alias))
        : [];
      const entry = createModelEntry(String(model.id || model.label || ""), budget, aliases);
      if (!entry) {
        continue;
      }

      models.push(entry);
    }

    return models;
  } catch {
    return [];
  }
}

function cleanModelDocText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDynamicModelBudgetsFromDocs(text: string): ModelBudgetEntry[] {
  const normalized = cleanModelDocText(text);
  const models = new Map<string, ModelBudgetEntry>();
  const budgetPattern = "((?:\\d{1,3},)*\\d{3,}|\\d+(?:\\.\\d+)?\\s*[mk])";

  const addModel = (rawName: string, rawBudget: string) => {
    const budget = parseBudgetText(rawBudget);
    const entry = createModelEntry(rawName, budget);
    if (!entry) {
      return;
    }

    const existing = models.get(entry.id);
    models.set(entry.id, {
      ...entry,
      budget: Math.max(existing?.budget ?? 0, entry.budget),
      aliases: makeModelAliases(entry.id, entry.label, existing?.aliases)
    });
  };

  for (const match of normalized.matchAll(new RegExp(`\\bModel ID\\s+([a-z0-9][a-z0-9_.-]*(?:-[a-z0-9_.-]+)*)[\\s\\S]{0,900}?\\bContext window\\s+${budgetPattern}`, "gi"))) {
    addModel(match[1], match[2]);
  }

  for (const match of normalized.matchAll(new RegExp(`\\b((?:GPT|gpt|o)[A-Za-z0-9 ._-]{1,44}?)[\\s\\S]{0,900}?\\bContext window\\s+${budgetPattern}`, "gi"))) {
    addModel(match[1], match[2]);
  }

  for (const match of normalized.matchAll(new RegExp(`\\b((?:GPT|gpt|o)[A-Za-z0-9 ._-]{1,44}?)[\\s\\S]{0,700}?${budgetPattern}\\s*(?:tokens?\\s*)?(?:context|context window)\\b`, "gi"))) {
    addModel(match[1], match[2]);
  }

  return Array.from(models.values());
}

function parseCurrentChatGptModelsFromDocs(text: string): ModelBudgetEntry[] {
  const normalized = cleanModelDocText(text);
  const models = new Map<string, ModelBudgetEntry>();

  for (const match of normalized.matchAll(/\bGPT\s*[- ]?\s*(\d+(?:\.\d+)?)(?:\s*[- ]?\s*(Instant|Thinking|Pro))?\b/gi)) {
    const rawName = `gpt-${match[1]}${match[2] ? `-${match[2].toLowerCase()}` : ""}`;
    const index = match.index ?? 0;
    const context = normalized.slice(Math.max(0, index - 160), index + 260).toLowerCase();
    if (/(retired|deprecated|deprecat|removed|legacy|sunset|淘汰|弃用)/i.test(context)) {
      continue;
    }

    const entry = createModelEntry(rawName);
    if (entry) {
      models.set(entry.id, entry);
    }
  }

  return Array.from(models.values());
}

function parseRetiredModelIdsFromDocs(text: string): Set<string> {
  const normalized = cleanModelDocText(text);
  const retiredIds = new Set<string>();

  for (const match of normalized.matchAll(/\b(?:GPT\s*[- ]?\s*\d+(?:\.\d+)?(?:\s*[- ]?\s*(?:Instant|Thinking|Pro))?|gpt-[a-z0-9_.-]+|o\d(?:-mini)?)\b/gi)) {
    const id = normalizeModelId(match[0]);
    if (!id) {
      continue;
    }

    const index = match.index ?? 0;
    const context = normalized.slice(Math.max(0, index - 220), index + 340).toLowerCase();
    if (/(retired|deprecated|deprecat|legacy|sunset|shut down|shutdown|removed|removal|replaced by|no longer available|淘汰|弃用)/i.test(context)) {
      retiredIds.add(id);
    }
  }

  return retiredIds;
}

function fetchTextFromBackground(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) {
      reject(new Error("Extension runtime is unavailable"));
      return;
    }

    const timer = window.setTimeout(() => reject(new Error("Background fetch timed out")), timeoutMs + 1000);
    chrome.runtime.sendMessage(
      {
        type: "conversationNavigator:fetchText",
        url,
        timeoutMs
      },
      (response?: { ok?: boolean; text?: string; error?: string }) => {
        window.clearTimeout(timer);
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError?.message) {
          reject(new Error(runtimeError.message));
          return;
        }

        if (response?.ok && typeof response.text === "string") {
          resolve(response.text);
          return;
        }

        reject(new Error(response?.error || "Background fetch failed"));
      }
    );
  });
}

async function fetchTextWithTimeout(url: string, timeoutMs = 8000): Promise<string> {
  try {
    return await fetchTextFromBackground(url, timeoutMs);
  } catch {
    // Fall back to page fetch for CORS-enabled endpoints such as raw GitHub.
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    window.clearTimeout(timer);
  }
}

function getModelVersion(model: ModelBudgetEntry): { major: number; minor: number } | null {
  const match = model.id.match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0)
  };
}

function getModelLine(model: ModelBudgetEntry): string {
  const match = model.id.match(/^gpt-\d+(?:\.\d+)?/);
  return match?.[0] ?? model.id;
}

function getModelMode(model: ModelBudgetEntry): string {
  const lower = `${model.id} ${model.label}`.toLowerCase();
  if (/\binstant\b/.test(lower)) {
    return "instant";
  }
  if (/\bthinking\b/.test(lower)) {
    return "thinking";
  }
  if (/\bpro\b/.test(lower)) {
    return "pro";
  }
  return "base";
}

function compareModelVersion(a: ModelBudgetEntry, b: ModelBudgetEntry): number {
  const aVersion = getModelVersion(a);
  const bVersion = getModelVersion(b);
  if (!aVersion || !bVersion) {
    return 0;
  }

  return aVersion.major === bVersion.major
    ? aVersion.minor - bVersion.minor
    : aVersion.major - bVersion.major;
}

function isCurrentChatGptModel(model: ModelBudgetEntry, retiredIds = RETIRED_CHATGPT_MODEL_IDS): boolean {
  if (model.id === "chatgpt-auto") {
    return true;
  }

  if (retiredIds.has(model.id) || NON_CHATGPT_MODEL_PATTERN.test(model.id)) {
    return false;
  }

  return /^gpt-\d/.test(model.id);
}

function sortModelCatalog(models: ModelBudgetEntry[]): ModelBudgetEntry[] {
  return [...models].sort((a, b) => {
    if (a.id === "chatgpt-auto") {
      return -1;
    }
    if (b.id === "chatgpt-auto") {
      return 1;
    }

    const versionDiff = compareModelVersion(b, a);
    if (versionDiff !== 0) {
      return versionDiff;
    }

    const modeDiff = MODEL_MODE_ORDER.indexOf(getModelMode(a)) - MODEL_MODE_ORDER.indexOf(getModelMode(b));
    if (modeDiff !== 0) {
      return modeDiff;
    }

    return a.label.localeCompare(b.label);
  });
}

function curateModelCatalog(models: ModelBudgetEntry[], dynamicRetiredIds = new Set<string>()): ModelBudgetEntry[] {
  const retiredIds = new Set([...RETIRED_CHATGPT_MODEL_IDS, ...dynamicRetiredIds]);
  const byId = new Map<string, ModelBudgetEntry>();
  for (const model of [...BUILT_IN_MODEL_BUDGETS, ...models]) {
    if (!isCurrentChatGptModel(model, retiredIds)) {
      continue;
    }

    const existing = byId.get(model.id);
    byId.set(model.id, existing ? {
      ...existing,
      ...model,
      aliases: makeModelAliases(model.id, model.label, [...existing.aliases, ...model.aliases])
    } : {
      ...model,
      aliases: makeModelAliases(model.id, model.label, model.aliases)
    });
  }

  const currentModels = Array.from(byId.values()).filter((model) => model.id !== "chatgpt-auto");
  const latestVersion = currentModels.reduce<ModelBudgetEntry | null>((latest, model) => {
    if (!latest) {
      return model;
    }
    return compareModelVersion(model, latest) > 0 ? model : latest;
  }, null);

  if (latestVersion) {
    const latestLine = getModelLine(latestVersion);
    for (const model of currentModels) {
      if (getModelLine(model) !== latestLine) {
        byId.delete(model.id);
      }
    }
  }

  const modeCounts = new Map<string, number>();
  for (const model of byId.values()) {
    const mode = getModelMode(model);
    modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
  }

  for (const model of byId.values()) {
    if (model.id === "chatgpt-auto") {
      continue;
    }
    const mode = getModelMode(model);
    if (mode === "base" && (modeCounts.get("instant") || modeCounts.get("thinking") || modeCounts.get("pro"))) {
      byId.delete(model.id);
    }
  }

  return sortModelCatalog(Array.from(byId.values())).slice(0, 7);
}

async function syncOpenAiModelCatalog(): Promise<ModelBudgetEntry[]> {
  const pages = await Promise.allSettled(OPENAI_MODEL_SYNC_URLS.map((url) => fetchTextWithTimeout(url)));
  const fetchedText = pages
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .map((result) => result.value);
  const onlineModels = fetchedText.flatMap(parseOnlineModelCatalog);
  const dynamicModels = fetchedText.flatMap(parseDynamicModelBudgetsFromDocs);
  const currentChatGptModels = fetchedText.flatMap(parseCurrentChatGptModelsFromDocs);
  const retiredIds = fetchedText.reduce((ids, text) => {
    for (const id of parseRetiredModelIdsFromDocs(text)) {
      ids.add(id);
    }
    return ids;
  }, new Set<string>());
  const joined = fetchedText.join("\n");

  if (!joined && onlineModels.length === 0 && dynamicModels.length === 0 && currentChatGptModels.length === 0) {
    throw new Error("No OpenAI model docs fetched");
  }

  return curateModelCatalog([...currentChatGptModels, ...dynamicModels, ...onlineModels], retiredIds);
}

function findModelBudget(modelCatalog: ModelBudgetEntry[], modelId: string): ModelBudgetEntry | undefined {
  return modelCatalog.find((model) => model.id === modelId);
}

function detectModelBudget(modelCatalog: ModelBudgetEntry[], modelLabel: string): ModelBudgetEntry | undefined {
  const label = modelLabel.toLowerCase();
  if (!label) {
    return undefined;
  }

  return modelCatalog
    .filter((model) => model.id !== "chatgpt-auto")
    .find((model) => model.aliases.some((alias) => label.includes(alias.toLowerCase())));
}

function getTokenBudget(
  settings: NavigatorSettings,
  modelLabel = detectModelLabel(),
  modelCatalog = BUILT_IN_MODEL_BUDGETS
) {
  if (settings.tokenBudgetMode === "manual") {
    return {
      budget: settings.manualTokenBudget,
      budgetSource: "manual" as const,
      budgetLabel: `${formatTokenCount(settings.manualTokenBudget)}`
    };
  }

  const selectedModel =
    settings.tokenModelId === "chatgpt-auto"
      ? detectModelBudget(modelCatalog, modelLabel)
      : findModelBudget(modelCatalog, settings.tokenModelId) ?? detectModelBudget(modelCatalog, modelLabel);
  const budget = selectedModel?.budget ?? DEFAULT_TOKEN_BUDGET;
  return {
    budget,
    budgetSource: "model" as const,
    budgetLabel: `${selectedModel?.label ?? "GPT"} ${formatTokenCount(budget)}`
  };
}

function buildTokenStats(
  entries: MessageMapEntry[],
  viewport: ViewportMetrics,
  settings: NavigatorSettings,
  modelLabel: string,
  modelCatalog: ModelBudgetEntry[]
): TokenStats {
  const budgetInfo = getTokenBudget(settings, modelLabel, modelCatalog);
  return {
    total: entries.reduce((sum, entry) => sum + entry.tokenCount, 0),
    viewport: viewport.tokenCount,
    user: entries.reduce((sum, entry) => sum + (entry.role === "user" ? entry.tokenCount : 0), 0),
    assistant: entries.reduce((sum, entry) => sum + (entry.role === "assistant" ? entry.tokenCount : 0), 0),
    code: entries.reduce((sum, entry) => sum + entry.codeTokens, 0),
    table: entries.reduce((sum, entry) => sum + entry.tableTokens, 0),
    hotMessages: entries.filter((entry) => entry.heatLevel >= 2).length,
    modelLabel: modelLabel || "",
    ...budgetInfo
  };
}

function createViewportMetrics(entries: MessageMapEntry[]): ViewportMetrics {
  const visibleIds = new Set<string>();
  let tokenCount = 0;
  const viewportHeight = Math.max(1, window.innerHeight);
  const documentHeight = Math.max(
    viewportHeight,
    document.documentElement.scrollHeight,
    document.body.scrollHeight
  );
  const scrollableHeight = Math.max(1, documentHeight - viewportHeight);

  for (const entry of entries) {
    const element = anchorRegistry.get(entry.id);
    const rect = element?.getBoundingClientRect();
    if (!rect || rect.bottom < 0 || rect.top > viewportHeight) {
      continue;
    }

    visibleIds.add(entry.id);
    tokenCount += entry.tokenCount;
  }

  return {
    tokenCount,
    visibleIds,
    topRatio: Math.min(1, Math.max(0, window.scrollY / scrollableHeight)),
    heightRatio: Math.min(1, Math.max(0.05, viewportHeight / documentHeight))
  };
}

function toPercent(value: number): string {
  return `${Math.min(100, Math.max(0, value)).toFixed(2)}%`;
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
  const [mapEntries, setMapEntries] = useState<MessageMapEntry[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, true>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ColorTheme>(detectPageTheme);
  const [resizeFrame, setResizeFrame] = useState<ResizeFrame | null>(null);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);
  const [viewportMetrics, setViewportMetrics] = useState<ViewportMetrics>({
    tokenCount: 0,
    visibleIds: new Set<string>(),
    topRatio: 0,
    heightRatio: 0
  });
  const [tokenHudDraft, setTokenHudDraft] = useState<{ x: number; y: number } | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelBudgetEntry[]>(BUILT_IN_MODEL_BUDGETS);
  const [modelCatalogUpdatedAt, setModelCatalogUpdatedAt] = useState(0);
  const [modelSyncStatus, setModelSyncStatus] = useState<ModelSyncStatus>("idle");
  const favoritesRef = useRef(favorites);
  const pageKeyRef = useRef(pageKey);
  const settingsRef = useRef(settings);
  const modelCatalogRef = useRef(modelCatalog);
  const listRef = useRef<HTMLDivElement | null>(null);
  const revealLatestOnNextPaintRef = useRef(true);
  const openingTimerRef = useRef<number | undefined>(undefined);
  const lastRecordSignatureRef = useRef("");

  favoritesRef.current = favorites;
  pageKeyRef.current = pageKey;
  settingsRef.current = settings;
  modelCatalogRef.current = modelCatalog;

  const scan = useCallback(async () => {
    const { budget } = getTokenBudget(settingsRef.current, detectModelLabel(), modelCatalogRef.current);
    const { items: nextItems, mapEntries: nextMapEntries } = buildNavigatorData(
      favoritesRef.current,
      budget
    );
    setItems(nextItems);
    setMapEntries(nextMapEntries);
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

  const syncModelCatalog = useCallback(async (manual = false) => {
    setModelSyncStatus("syncing");
    try {
      const models = await syncOpenAiModelCatalog();
      const updatedAt = Date.now();
      setModelCatalog(models);
      setModelCatalogUpdatedAt(updatedAt);
      await storageSet({
        [MODEL_CATALOG_STORAGE_KEY]: {
          updatedAt,
          models
        } satisfies StoredModelCatalog
      });
      setModelSyncStatus("synced");
    } catch (error) {
      if (manual) {
        console.warn("[GPT聊天导航器] 同步 OpenAI 模型预算失败：", error);
      }
      setModelCatalog(BUILT_IN_MODEL_BUDGETS);
      setModelSyncStatus("failed");
    }
  }, []);

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
    let cancelled = false;

    async function loadModelCatalog() {
      const stored = await storageGet<StoredModelCatalog>(MODEL_CATALOG_STORAGE_KEY);
      if (cancelled) {
        return;
      }

      if (stored?.models?.length) {
        const models = curateModelCatalog(stored.models);
        setModelCatalog(models);
        setModelCatalogUpdatedAt(stored.updatedAt || 0);
      }

      const shouldSync = !stored?.updatedAt || Date.now() - stored.updatedAt > MODEL_SYNC_INTERVAL_MS;
      if (shouldSync) {
        syncModelCatalog(false);
      }
    }

    loadModelCatalog();

    return () => {
      cancelled = true;
    };
  }, [syncModelCatalog]);

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
  }, [
    favorites,
    modelCatalog,
    pageKey,
    scan,
    settings.cacheMode,
    settings.manualTokenBudget,
    settings.tokenBudgetMode,
    settings.tokenModelId
  ]);

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

    const updateViewport = () => {
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
      setViewportMetrics(createViewportMetrics(mapEntries));
    };

    const scheduleViewportUpdate = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(updateViewport);
    };

    scheduleViewportUpdate();
    window.addEventListener("scroll", scheduleViewportUpdate, { passive: true });
    window.addEventListener("resize", scheduleViewportUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", scheduleViewportUpdate);
      window.removeEventListener("resize", scheduleViewportUpdate);
    };
  }, [items, mapEntries]);

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

  const detectedModelLabel = useMemo(() => detectModelLabel(), [items.length, pageId]);
  const tokenStats = useMemo(
    () => buildTokenStats(mapEntries, viewportMetrics, settings, detectedModelLabel, modelCatalog),
    [detectedModelLabel, mapEntries, modelCatalog, settings, viewportMetrics]
  );
  const selectedTokenModelId = modelCatalog.some((model) => model.id === settings.tokenModelId)
    ? settings.tokenModelId
    : "chatgpt-auto";
  const tokenBudgetPercent = tokenStats.budget > 0 ? (tokenStats.total / tokenStats.budget) * 100 : 0;
  const syncStatusLabel =
    modelSyncStatus === "syncing"
      ? t.tokenModelSyncing
      : modelSyncStatus === "synced"
        ? t.tokenModelSynced
        : modelSyncStatus === "failed"
          ? t.tokenModelSyncFailed
          : t.tokenModelSync;
  const hudPosition =
    tokenHudDraft ??
    (settings.tokenHudX > 0 || settings.tokenHudY > 0
      ? { x: settings.tokenHudX, y: settings.tokenHudY }
      : null);

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

  const startTokenHudDrag = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const shell = event.currentTarget.closest<HTMLElement>(".cnav-token-hud");
    const rect = shell?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    let latestPosition = { x: Math.round(startLeft), y: Math.round(startTop) };

    const handleMove = (moveEvent: PointerEvent) => {
      const nextX = Math.round(
        Math.min(window.innerWidth - DEFAULT_HUD_WIDTH - 8, Math.max(8, startLeft + moveEvent.clientX - startX))
      );
      const nextY = Math.round(Math.min(window.innerHeight - 96, Math.max(8, startTop + moveEvent.clientY - startY)));
      latestPosition = { x: nextX, y: nextY };
      setTokenHudDraft(latestPosition);
    };

    const handleUp = () => {
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointercancel", handleUp, true);
      updateSettings({
        tokenHudX: latestPosition.x,
        tokenHudY: latestPosition.y
      });
      setTokenHudDraft(null);
    };

    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerup", handleUp, true);
    document.addEventListener("pointercancel", handleUp, true);
  };

  const updateBudgetPreset = (value: string) => {
    if (value === "model") {
      updateSettings({ tokenBudgetMode: "model" });
      return;
    }

    if (value === "custom") {
      updateSettings({
        tokenBudgetMode: "manual",
        manualTokenBudget: [32000, 128000, 200000, 400000, 1000000, 2000000].includes(settings.manualTokenBudget)
          ? 1500000
          : settings.manualTokenBudget
      });
      return;
    }

    const budget = Number(value);
    if (Number.isFinite(budget)) {
      updateSettings({ tokenBudgetMode: "manual", manualTokenBudget: budget });
    }
  };

  const toggleFavorite = async (item: NavigatorItem) => {
    const nextFavorites = { ...favorites };
    const itemFavorite = Boolean(nextFavorites[item.id]);

    if (itemFavorite) {
      delete nextFavorites[item.id];
    } else {
      nextFavorites[item.id] = true;
    }

    const nextItems = items.map((current) => ({
      ...current,
      favorite: current.id === item.id ? !itemFavorite : current.favorite
    }));

    setFavorites(nextFavorites);
    setItems(nextItems);
    setMapEntries((currentEntries) =>
      currentEntries.map((entry) =>
        entry.id === item.id ? { ...entry, favorite: !itemFavorite } : entry
      )
    );
    await persistRecord(settings, pageKey, nextItems, nextFavorites);
  };

  const renderTokenPanel = (variant: "hud" | "dock") => {
    if (!settings.tokenPanelEnabled) {
      return null;
    }

    const collapsed = variant === "hud" && settings.tokenPanelCollapsed;
    const userPercent = tokenStats.total > 0 ? (tokenStats.user / tokenStats.total) * 100 : 0;
    const assistantPercent = tokenStats.total > 0 ? (tokenStats.assistant / tokenStats.total) * 100 : 0;
    const codePercent = tokenStats.total > 0 ? (tokenStats.code / tokenStats.total) * 100 : 0;
    const tablePercent = tokenStats.total > 0 ? (tokenStats.table / tokenStats.total) * 100 : 0;
    const hudStyle =
      variant === "hud"
        ? hudPosition
          ? { left: hudPosition.x, top: hudPosition.y }
          : { right: DEFAULT_HUD_WIDTH + DEFAULT_HUD_GAP + 88, top: 118 }
        : undefined;

    return (
      <section
        className={`cnav-token-panel cnav-token-${variant}${collapsed ? " is-collapsed" : ""}`}
        data-theme={theme}
        style={hudStyle}
        aria-label={t.tokenPanel}
      >
        <div
          className="cnav-token-head"
          onPointerDown={variant === "hud" ? startTokenHudDrag : undefined}
          onDoubleClick={variant === "hud" ? () => updateSettings({ tokenPanelCollapsed: false }) : undefined}
        >
          {variant === "hud" ? <GripVertical size={14} aria-hidden="true" /> : <BarChart3 size={14} aria-hidden="true" />}
          <span>{t.tokenPanelShort}</span>
          <small>
            {collapsed
              ? `${formatTokenCount(tokenStats.total)} · ${Math.round(tokenBudgetPercent)}%`
              : t.tokenPanelEstimated}
          </small>
          <button
            type="button"
            className="cnav-token-mini-button"
            title={settings.tokenPanelMode === "floating" ? t.tokenPanelDock : t.tokenPanelFloating}
            aria-label={settings.tokenPanelMode === "floating" ? t.tokenPanelDock : t.tokenPanelFloating}
            onClick={() =>
              updateSettings({
                tokenPanelMode: settings.tokenPanelMode === "floating" ? "dock" : "floating"
              })
            }
          >
            <ChevronsUpDown size={13} aria-hidden="true" />
          </button>
          {variant === "hud" ? (
            <button
              type="button"
              className="cnav-token-mini-button"
              title={collapsed ? t.tokenPanelExpand : t.tokenPanelCollapse}
              aria-label={collapsed ? t.tokenPanelExpand : t.tokenPanelCollapse}
              onClick={() => updateSettings({ tokenPanelCollapsed: !settings.tokenPanelCollapsed })}
            >
              <Minimize2 size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {collapsed ? null : (
          <div className="cnav-token-body">
            <div className="cnav-token-total">
              <strong>{formatTokenCount(tokenStats.total)}</strong>
              <span>{t.tokenTotal}</span>
              <small>{tokenStats.modelLabel || t.tokenModelUnknown}</small>
            </div>
            <div className="cnav-token-grid">
              <span>{t.tokenViewport}</span>
              <strong>{formatTokenCount(tokenStats.viewport)}</strong>
              <span>{t.tokenBudget}</span>
              <strong>{`${Math.round(tokenBudgetPercent)}%`}</strong>
            </div>
            <div className="cnav-token-progress" aria-hidden="true">
              <span style={{ width: toPercent(tokenBudgetPercent) }} />
            </div>
            <div className="cnav-token-breakdown" aria-label={t.estimatedOnly}>
              <span style={{ ["--share" as string]: toPercent(userPercent) }}>{t.tokenUserShare}</span>
              <span style={{ ["--share" as string]: toPercent(assistantPercent) }}>{t.tokenAssistantShare}</span>
              <span style={{ ["--share" as string]: toPercent(codePercent) }}>{t.tokenCodeShare}</span>
              <span style={{ ["--share" as string]: toPercent(tablePercent) }}>{t.tokenTableShare}</span>
            </div>
            <div className="cnav-token-note">
              <span>{tokenStats.budgetLabel}</span>
              <span>{tokenStats.hotMessages > 0 ? `${tokenStats.hotMessages} ${t.tokenHeat}` : t.estimatedOnly}</span>
            </div>
          </div>
        )}
      </section>
    );
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

      {settings.tokenPanelMode === "floating" ? renderTokenPanel("hud") : null}

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
              <label className="cnav-toggle-field">
                <span>{t.tokenPanel}</span>
                <input
                  type="checkbox"
                  checked={settings.tokenPanelEnabled}
                  onChange={(event) => updateSettings({ tokenPanelEnabled: event.currentTarget.checked })}
                />
              </label>
              <label className="cnav-display-field cnav-select-field">
                <span>{t.tokenPanel}</span>
                <select
                  value={settings.tokenPanelMode}
                  onChange={(event) =>
                    updateSettings({ tokenPanelMode: event.currentTarget.value === "dock" ? "dock" : "floating" })
                  }
                >
                  <option value="floating">{t.tokenPanelFloating}</option>
                  <option value="dock">{t.tokenPanelDock}</option>
                </select>
              </label>
              <label className="cnav-display-field cnav-select-field">
                <span>{t.tokenBudget}</span>
                <select
                  value={
                    settings.tokenBudgetMode === "model"
                      ? "model"
                      : [32000, 128000, 200000, 400000, 1000000, 2000000].includes(settings.manualTokenBudget)
                        ? String(settings.manualTokenBudget)
                        : "custom"
                  }
                  onChange={(event) => updateBudgetPreset(event.currentTarget.value)}
                >
                  <option value="model">{t.tokenBudgetAuto}</option>
                  <option value="32000">32k</option>
                  <option value="128000">128k</option>
                  <option value="200000">200k</option>
                  <option value="400000">400k</option>
                  <option value="1000000">1M</option>
                  <option value="2000000">2M</option>
                  <option value="custom">{t.tokenBudgetCustom}</option>
                </select>
              </label>
              {settings.tokenBudgetMode === "model" ? (
                <label className="cnav-display-field cnav-model-field">
                  <span>{t.tokenModel}</span>
                  <select
                    value={selectedTokenModelId}
                    onChange={(event) => updateSettings({ tokenModelId: event.currentTarget.value })}
                  >
                    {modelCatalog.map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.id === "chatgpt-auto"
                          ? t.tokenModelAuto
                          : `${model.label} · ${formatTokenCount(model.budget)}`}
                      </option>
                    ))}
                  </select>
                  <button
                    className="cnav-sync-button"
                    type="button"
                    disabled={modelSyncStatus === "syncing"}
                    onClick={() => syncModelCatalog(true)}
                    title={
                      modelCatalogUpdatedAt
                        ? `${syncStatusLabel} ${new Date(modelCatalogUpdatedAt).toLocaleString()}`
                        : syncStatusLabel
                    }
                  >
                    {syncStatusLabel}
                  </button>
                </label>
              ) : null}
              {settings.tokenBudgetMode === "manual" &&
              ![32000, 128000, 200000, 400000, 1000000, 2000000].includes(settings.manualTokenBudget) ? (
                <label className="cnav-display-field cnav-number-field">
                  <span>{t.tokenManualBudget}</span>
                  <input
                    type="number"
                    min="8000"
                    max="2000000"
                    step="1000"
                    value={settings.manualTokenBudget}
                    onChange={(event) => updateSettings({ manualTokenBudget: Number(event.currentTarget.value) })}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {settings.tokenPanelMode === "dock" ? renderTokenPanel("dock") : null}

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

          <div className="cnav-list-wrap">
            <div className="cnav-list" role="list" ref={listRef}>
              {filteredItems.length === 0 ? (
                <div className="cnav-empty">
                  {items.length === 0 ? t.noNodes : t.noNodeMatches}
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div
                    className={`cnav-item${activeId === item.id ? " is-active" : ""} is-heat-${item.heatLevel}`}
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
                        <span className="cnav-token-line">
                          {`${formatTokenCount(item.totalTokens)} ${t.tokenPanelShort}`}
                        </span>
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

