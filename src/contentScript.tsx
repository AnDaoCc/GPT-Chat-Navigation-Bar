import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  ChevronRight,
  ChevronsUpDown,
  GripVertical,
  Languages,
  Map as MapIcon,
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
const SCAN_DEBOUNCE_MS = 350;
const CHAT_STYLE_ID = "conversation-navigator-chat-style";
const OFFICIAL_THREAD_WIDTH = 60;
const THREAD_WIDTH_MIN = 60;
const THREAD_WIDTH_MAX = 100;
const DEFAULT_TOKEN_BUDGET = 128000;
const TOKEN_CACHE_LIMIT = 900;
const MINIMAP_MAX_BLOCKS = 220;
const DEFAULT_HUD_WIDTH = 246;
const DEFAULT_HUD_GAP = 26;
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
  legacyIds?: string[];
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
  budgetSource: "auto" | "manual";
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

interface MinimapBlock {
  id: string;
  role: Role | "mixed";
  top: number;
  height: number;
  heatLevel: HeatLevel;
  tokenCount: number;
  active: boolean;
  visible: boolean;
  favorite: boolean;
  queryMatch: boolean;
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
const tokenCountCache = new Map<string, number>();
const tokenKeyQueue: string[] = [];
let nextNodeAnchorIndex = 1;
let tokenizer: Tiktoken | null = null;

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

    const legacyIds = [getLegacyAnchorId(message, items.length)];
    const favorite = Boolean(favorites[id] || legacyIds.some((legacyId) => favorites[legacyId]));
    const totalTokens = tokenBreakdown.total + answerTokens;
    const heatLevel = getHeatLevel(totalTokens, cumulativeTokens + answerTokens, tokenBudget);

    items.push({
      id,
      promptPreview: compactPreview(message.text, 112),
      answerSummary: summarizeAnswer(answerParts.join("\n\n")),
      turnIndex: items.length + 1,
      favorite,
      legacyIds,
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

function detectModelLabel(): string {
  const selectors = [
    '[data-testid*="model"]',
    '[aria-label*="model" i]',
    '[aria-label*="GPT" i]',
    "header button"
  ];

  for (const selector of selectors) {
    for (const element of safeQueryAll(selector)) {
      const text = normalizeText(element.innerText || element.getAttribute("aria-label") || "");
      if (/(gpt|chatgpt|o[1345]|model|thinking|auto)/i.test(text) && text.length <= 80) {
        return text;
      }
    }
  }

  return "";
}

function inferAutoTokenBudget(modelLabel: string): number {
  const label = modelLabel.toLowerCase();
  if (/\b(gpt-5|gpt-4\.1|o3|o4|200k)\b/.test(label)) {
    return 200000;
  }

  if (/\b(gpt-4o|gpt-4\.5|o1|128k)\b/.test(label)) {
    return 128000;
  }

  if (/\b(32k|gpt-4(?!o)|gpt-3\.5)\b/.test(label)) {
    return 32000;
  }

  return DEFAULT_TOKEN_BUDGET;
}

function getTokenBudget(settings: NavigatorSettings, modelLabel = detectModelLabel()) {
  if (settings.tokenBudgetMode === "manual") {
    return {
      budget: settings.manualTokenBudget,
      budgetSource: "manual" as const,
      budgetLabel: `${formatTokenCount(settings.manualTokenBudget)}`
    };
  }

  const budget = inferAutoTokenBudget(modelLabel);
  return {
    budget,
    budgetSource: "auto" as const,
    budgetLabel: `${formatTokenCount(budget)} auto`
  };
}

function buildTokenStats(
  entries: MessageMapEntry[],
  viewport: ViewportMetrics,
  settings: NavigatorSettings,
  modelLabel: string
): TokenStats {
  const budgetInfo = getTokenBudget(settings, modelLabel);
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

function scrollDocumentToRatio(ratio: number, behavior: ScrollBehavior = "smooth") {
  const viewportHeight = Math.max(1, window.innerHeight);
  const documentHeight = Math.max(
    viewportHeight,
    document.documentElement.scrollHeight,
    document.body.scrollHeight
  );
  const scrollableHeight = Math.max(1, documentHeight - viewportHeight);
  window.scrollTo({
    top: Math.min(scrollableHeight, Math.max(0, ratio * scrollableHeight)),
    behavior
  });
}

function toPercent(value: number): string {
  return `${Math.min(100, Math.max(0, value)).toFixed(2)}%`;
}

function buildMinimapBlocks(
  entries: MessageMapEntry[],
  activeId: string | null,
  visibleIds: Set<string>,
  query: string
): MinimapBlock[] {
  if (entries.length === 0) {
    return [];
  }

  const normalizedQuery = query.trim().toLowerCase();
  const chunkSize = Math.max(1, Math.ceil(entries.length / MINIMAP_MAX_BLOCKS));
  const blocks: MinimapBlock[] = [];

  for (let index = 0; index < entries.length; index += chunkSize) {
    const chunk = entries.slice(index, index + chunkSize);
    const first = chunk[0];
    const role = chunk.every((entry) => entry.role === first.role) ? first.role : "mixed";
    const top = (index / entries.length) * 100;
    const height = Math.max(1.4, (chunk.length / entries.length) * 100);
    const heatLevel = Math.max(...chunk.map((entry) => entry.heatLevel)) as HeatLevel;
    const queryMatch =
      Boolean(normalizedQuery) &&
      chunk.some((entry) => entry.text.toLowerCase().includes(normalizedQuery));

    blocks.push({
      id: first.id,
      role,
      top,
      height,
      heatLevel,
      tokenCount: chunk.reduce((sum, entry) => sum + entry.tokenCount, 0),
      active: chunk.some((entry) => entry.id === activeId),
      visible: chunk.some((entry) => visibleIds.has(entry.id)),
      favorite: chunk.some((entry) => entry.favorite),
      queryMatch
    });
  }

  return blocks;
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
    const { budget } = getTokenBudget(settingsRef.current);
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
  }, [favorites, pageKey, scan, settings.cacheMode, settings.manualTokenBudget, settings.tokenBudgetMode]);

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
    () => buildTokenStats(mapEntries, viewportMetrics, settings, detectedModelLabel),
    [detectedModelLabel, mapEntries, settings, viewportMetrics]
  );
  const tokenBudgetPercent = tokenStats.budget > 0 ? (tokenStats.total / tokenStats.budget) * 100 : 0;
  const minimapBlocks = useMemo(
    () => buildMinimapBlocks(mapEntries, activeId, viewportMetrics.visibleIds, query),
    [activeId, mapEntries, query, viewportMetrics.visibleIds]
  );
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

  const jumpFromMinimapPointer = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const track = event.currentTarget;
    const pointerId = event.pointerId;
    track.setPointerCapture(pointerId);

    const jump = (clientY: number, behavior: ScrollBehavior) => {
      const rect = track.getBoundingClientRect();
      const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
      scrollDocumentToRatio(ratio, behavior);
    };

    jump(event.clientY, "smooth");

    const handleMove = (moveEvent: PointerEvent) => jump(moveEvent.clientY, "auto");
    const handleUp = () => {
      track.releasePointerCapture(pointerId);
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointercancel", handleUp, true);
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
    if (value === "auto") {
      updateSettings({ tokenBudgetMode: "auto" });
      return;
    }

    if (value === "custom") {
      updateSettings({
        tokenBudgetMode: "manual",
        manualTokenBudget: [32000, 128000, 200000].includes(settings.manualTokenBudget)
          ? 160000
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
        <div className="cnav-token-head" onPointerDown={variant === "hud" ? startTokenHudDrag : undefined}>
          {variant === "hud" ? <GripVertical size={14} aria-hidden="true" /> : <BarChart3 size={14} aria-hidden="true" />}
          <span>{t.tokenPanelShort}</span>
          <small>{t.tokenPanelEstimated}</small>
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

  const renderMinimap = (mode: "page-edge" | "dock") => {
    if (!settings.minimapEnabled || minimapBlocks.length === 0) {
      return null;
    }

    const edgeStyle =
      mode === "page-edge"
        ? {
            left: resizeFrame
              ? Math.min(window.innerWidth - 34, resizeFrame.right + 10)
              : window.innerWidth - 42,
            top: resizeFrame?.top ?? 112,
            height: resizeFrame?.height ?? Math.max(260, window.innerHeight - 224)
          }
        : undefined;

    return (
      <aside
        className={`cnav-minimap cnav-minimap-${mode}`}
        data-theme={theme}
        style={edgeStyle}
        aria-label={t.minimap}
        title={t.minimapJump}
      >
        <div className="cnav-minimap-track" onPointerDown={jumpFromMinimapPointer}>
          <span
            className="cnav-minimap-viewport"
            style={{
              top: toPercent(viewportMetrics.topRatio * 100),
              height: toPercent(viewportMetrics.heightRatio * 100)
            }}
          />
          {minimapBlocks.map((block) => (
            <button
              key={`${block.id}:${block.top}`}
              type="button"
              className={[
                "cnav-minimap-block",
                `is-${block.role}`,
                block.active ? "is-active" : "",
                block.visible ? "is-visible" : "",
                block.favorite ? "is-favorite" : "",
                block.queryMatch ? "is-query" : "",
                block.heatLevel > 0 ? `is-heat-${block.heatLevel}` : ""
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                top: toPercent(block.top),
                height: toPercent(block.height)
              }}
              aria-label={`${t.minimap} ${formatTokenCount(block.tokenCount)}`}
              onClick={(event) => {
                event.stopPropagation();
                scrollToNavigatorItem(block.id);
              }}
            />
          ))}
        </div>
      </aside>
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
      {settings.minimapMode === "page-edge" ? renderMinimap("page-edge") : null}

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
                    settings.tokenBudgetMode === "auto"
                      ? "auto"
                      : [32000, 128000, 200000].includes(settings.manualTokenBudget)
                        ? String(settings.manualTokenBudget)
                        : "custom"
                  }
                  onChange={(event) => updateBudgetPreset(event.currentTarget.value)}
                >
                  <option value="auto">{t.tokenBudgetAuto}</option>
                  <option value="32000">32k</option>
                  <option value="128000">128k</option>
                  <option value="200000">200k</option>
                  <option value="custom">{t.tokenBudgetCustom}</option>
                </select>
              </label>
              {settings.tokenBudgetMode === "manual" &&
              ![32000, 128000, 200000].includes(settings.manualTokenBudget) ? (
                <label className="cnav-display-field cnav-number-field">
                  <span>{t.tokenManualBudget}</span>
                  <input
                    type="number"
                    min="8000"
                    max="1000000"
                    step="1000"
                    value={settings.manualTokenBudget}
                    onChange={(event) => updateSettings({ manualTokenBudget: Number(event.currentTarget.value) })}
                  />
                </label>
              ) : null}
              <label className="cnav-toggle-field">
                <span>{t.minimap}</span>
                <input
                  type="checkbox"
                  checked={settings.minimapEnabled}
                  onChange={(event) => updateSettings({ minimapEnabled: event.currentTarget.checked })}
                />
              </label>
              <label className="cnav-display-field cnav-select-field">
                <span>{t.minimap}</span>
                <select
                  value={settings.minimapMode}
                  onChange={(event) =>
                    updateSettings({ minimapMode: event.currentTarget.value === "dock" ? "dock" : "page-edge" })
                  }
                >
                  <option value="page-edge">{t.minimapPageEdge}</option>
                  <option value="dock">{t.minimapDock}</option>
                </select>
              </label>
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

          <div className={`cnav-list-wrap${settings.minimapMode === "dock" ? " has-minimap" : ""}`}>
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
            {settings.minimapMode === "dock" ? renderMinimap("dock") : null}
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

