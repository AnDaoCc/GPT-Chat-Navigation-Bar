import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  FileText,
  GripVertical,
  Minimize2,
  MoveHorizontal,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Star,
  Table2
} from "lucide-react";
import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";
import {
  AppLanguage,
  CompatRulesSource,
  DEFAULT_SETTINGS,
  NavigatorSettings,
  PAGE_CACHE_CLEAR_MESSAGE,
  PAGE_CACHE_LIST_MESSAGE,
  STORAGE_SETTINGS_KEY,
  StoredAdapterHealth,
  StoredConversationRecord,
  StoredNavigatorNode,
  isNavigatorRecordKey,
  makeRecordKey,
  normalizeSettings
} from "./shared";
import { getTranslation } from "./i18n";
import {
  CHATGPT_COMPAT_RULES_URL,
  ChatGptAdapter,
  ChatGptDomRule,
  AdapterHealth,
  createChatGptAdapter,
  createDefaultAdapterHealth,
  normalizeCompatRulesPayload
} from "./chatGptAdapter";
import "./styles/content.css";

const ROOT_ID = "conversation-navigator-root";
const ANCHOR_ATTR = "data-conversation-navigator-id";
const MODEL_CATALOG_STORAGE_KEY = "conversationNavigator:modelCatalog:v1";
const COMPAT_RULES_STORAGE_KEY = "conversationNavigator:compatRules:v1";
const SCAN_DEBOUNCE_MS = 650;
const STREAMING_SCAN_DEBOUNCE_MS = 1400;
const IDLE_SCAN_TIMEOUT_MS = 1200;
const CHAT_STYLE_ID = "conversation-navigator-chat-style";
const TABLE_COPY_FORMAT_STORAGE_KEY = "conversationNavigator:tableCopyFormat:v1";
const OFFICIAL_THREAD_WIDTH = 60;
const THREAD_WIDTH_MIN = 60;
const THREAD_WIDTH_MAX = 100;
const DEFAULT_TOKEN_BUDGET = 128000;
const TOKEN_CACHE_LIMIT = 900;
const TOKENIZER_TEXT_LIMIT = 12000;
const TOKEN_BREAKDOWN_NODE_LIMIT = 80;
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
type NavigatorGroupKind =
  | "requirements"
  | "code"
  | "errors"
  | "data"
  | "summary"
  | "general";

interface ParsedMessage {
  role: Role;
  element: HTMLElement;
  text: string;
}

interface SupplementalContext {
  kind: "canvas" | "file";
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
  customTitle?: string;
  note?: string;
  turnIndex: number;
  domOrder: number;
  favorite: boolean;
  promptTokens: number;
  answerTokens: number;
  totalTokens: number;
  heatLevel: HeatLevel;
  site: SiteId;
  mounted: boolean;
}

interface NavigatorGroup {
  id: string;
  kind: NavigatorGroupKind;
  label: string;
  items: NavigatorItem[];
  tokenTotal: number;
  heatLevel: HeatLevel;
}

interface MessageMapEntry {
  id: string;
  role: Role;
  tokenCount: number;
  codeTokens: number;
  tableTokens: number;
  text: string;
  turnIndex: number;
  domOrder: number;
  favorite: boolean;
  heatLevel: HeatLevel;
  mounted: boolean;
}

interface BuildNavigatorResult {
  items: NavigatorItem[];
  mapEntries: MessageMapEntry[];
  health: AdapterHealth;
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

interface TokenDetailEntry {
  id: string;
  role: Role;
  label: string;
  tokenCount: number;
  codeTokens: number;
  tableTokens: number;
  turnIndex: number;
  heatLevel: HeatLevel;
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
type CompatRulesSyncStatus = "idle" | "syncing" | "synced" | "failed";

interface StoredCompatRules {
  updatedAt: number;
  rules: ChatGptDomRule[];
}

interface ScheduledIdleWork {
  id: number;
  type: "idle" | "timer";
}

interface ResizeFrame {
  left: number;
  right: number;
  top: number;
  height: number;
  toggleLeft: number;
}

function areResizeFramesEqual(first: ResizeFrame | null, second: ResizeFrame | null): boolean {
  return first?.left === second?.left &&
    first?.right === second?.right &&
    first?.top === second?.top &&
    first?.height === second?.height &&
    first?.toggleLeft === second?.toggleLeft;
}

const anchorRegistry = new Map<string, HTMLElement>();
const nodeAnchorRegistry = new WeakMap<HTMLElement, string>();
const tokenCountCache = new Map<string, number>();
const tokenKeyQueue: string[] = [];
let nextNodeAnchorIndex = 1;
let tokenizer: Tiktoken | null = null;
const volatilePageSessionId = Math.random().toString(36).slice(2, 10);

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
  "https://developers.openai.com/api/docs/models",
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

let activeCompatRules: ChatGptDomRule[] = [];
let activeCompatRulesSource: CompatRulesSource = "built-in";
let navigationAnimationFrame = 0;

function setActiveCompatRules(rules: ChatGptDomRule[], source: CompatRulesSource) {
  activeCompatRules = source === "remote" ? rules : [];
  activeCompatRulesSource = source === "remote" && rules.length > 0 ? "remote" : "built-in";
}

function getAdapter(): ChatGptAdapter {
  return createChatGptAdapter(activeCompatRules);
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

function getChatGptConversationId(): string | null {
  const segments = location.pathname.split("/").filter(Boolean);
  const conversationSegmentIndex = segments.findIndex((segment) => segment === "c");
  const conversationId = conversationSegmentIndex >= 0 ? segments[conversationSegmentIndex + 1] : "";

  if (conversationId && /^[a-zA-Z0-9_-]{8,}$/.test(conversationId)) {
    return conversationId;
  }

  return null;
}

function isVolatileChatPage(): boolean {
  const path = location.pathname.replace(/\/+$/, "");
  return location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com"
    ? !getChatGptConversationId() && (path === "" || path === "/" || path === "/chat")
    : false;
}

function getPageId(): string {
  const conversationId = getChatGptConversationId();
  if (conversationId) {
    return `${location.hostname}:conversation:${conversationId}`;
  }

  if (isVolatileChatPage()) {
    return `${location.hostname}:session:${volatilePageSessionId}`;
  }

  const pathKey = `${location.hostname}${location.pathname}${location.search}`.replace(/\/+$/, "");
  return pathKey || location.hostname;
}

function getPageStorageKey(settings: NavigatorSettings, pageId = getPageId()): string {
  return makeRecordKey(settings.cacheNamespace, pageId);
}

function isVolatilePageKey(pageKey: string): boolean {
  return pageKey.includes(":session:");
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

function readPageStorageRecords(namespace: string): Array<{ key: string; record: StoredConversationRecord }> {
  const records: Array<{ key: string; record: StoredConversationRecord }> = [];

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !isNavigatorRecordKey(key, namespace)) {
        continue;
      }

      const record = readPageStorageRecord(key);
      if (record?.schemaVersion === 1 && Array.isArray(record.nodes)) {
        records.push({ key, record });
      }
    }
  } catch {
    return [];
  }

  return records.sort((a, b) => b.record.updatedAt - a.record.updatedAt);
}

function clearPageStorageRecords(namespace: string, requestedKeys?: string[]): number {
  const keys = Array.isArray(requestedKeys) && requestedKeys.length > 0
    ? requestedKeys.filter((key) => typeof key === "string" && isNavigatorRecordKey(key, namespace))
    : readPageStorageRecords(namespace).map((entry) => entry.key);

  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Keep clearing the remaining records even if a single key fails.
    }
  }

  return keys.length;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== PAGE_CACHE_LIST_MESSAGE && message?.type !== PAGE_CACHE_CLEAR_MESSAGE) {
    return false;
  }

  const namespace = typeof message.namespace === "string" && message.namespace.trim()
    ? message.namespace
    : DEFAULT_SETTINGS.cacheNamespace;

  try {
    if (message.type === PAGE_CACHE_CLEAR_MESSAGE) {
      sendResponse({ ok: true, removed: clearPageStorageRecords(namespace, message.keys) });
      return false;
    }

    sendResponse({ ok: true, records: readPageStorageRecords(namespace) });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  return false;
});

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
  if (settings.cacheMode === "off" || isVolatilePageKey(pageKey)) {
    return undefined;
  }

  if (settings.cacheMode === "page") {
    return readPageStorageRecord(pageKey);
  }

  return storageGet<StoredConversationRecord>(pageKey);
}

function setStylePropertyIfChanged(style: CSSStyleDeclaration, property: string, value: string) {
  if (style.getPropertyValue(property) !== value) {
    style.setProperty(property, value);
  }
}

function installChatTypographyStyle() {
  let style = document.getElementById(CHAT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = CHAT_STYLE_ID;
    document.documentElement.appendChild(style);
  }

  if (style.dataset.cnavStatic === "true") {
    return;
  }

  const canvasTextSelector = [
    `body :is([data-testid*="canvas" i], [data-testid*="artifact" i], [aria-label*="canvas" i], [aria-label*="画布" i], [class*="canvas" i], [class*="artifact" i], [class*="textLayer" i], .ProseMirror, .cm-content, .monaco-editor):not(#${ROOT_ID} *):not([data-message-author-role] *):not(form *)`,
    `body :is([data-testid*="document" i], [aria-label*="document" i], [aria-label*="文档" i]):not(#${ROOT_ID} *):not([data-message-author-role] *):not(form *)`
  ].join(",\n    ");

  style.textContent = `
    html[data-cnav-wide-thread="true"] main {
      --thread-content-max-width: var(--cnav-thread-width) !important;
      --thread-content-width: var(--cnav-thread-width) !important;
    }

    html[data-cnav-wide-thread="true"] main :is(article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]):has([data-message-author-role]) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main :is(.mx-auto, [class*="max-w-"], [class*="thread-content"], [class*="conversation-turn"]):has([data-message-author-role]) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main :is(article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]):has([data-message-author-role]) > :is(div, section) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main :is(.mx-auto, [class*="thread-content"]):has(> [data-message-author-role]) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main [data-message-author-role] {
      max-width: 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    html[data-cnav-wide-thread="true"] main [data-message-author-role] > :is(div, section) {
      max-width: 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    html[data-cnav-wide-thread="true"] main [data-message-author-role="assistant"] :is(.markdown, .whitespace-pre-wrap) {
      width: 100% !important;
      max-width: 100% !important;
    }

    main [data-message-author-role] {
      font-size: var(--cnav-chat-font-size, 1rem) !important;
      letter-spacing: var(--cnav-chat-letter-spacing, 0px) !important;
      line-height: var(--cnav-chat-line-height, 1.55) !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }

    main [data-message-author-role] :where(.markdown, .prose, .whitespace-pre-wrap, .break-words, [data-start], p, li, span, strong, em, blockquote) {
      font-size: inherit !important;
      letter-spacing: var(--cnav-chat-letter-spacing, 0px) !important;
      line-height: var(--cnav-chat-line-height, 1.55) !important;
    }

    main [data-message-author-role] :where(.markdown p, .prose p, .markdown li, .prose li, p, li) {
      margin-top: var(--cnav-chat-paragraph-gap, 0.44em) !important;
      margin-bottom: var(--cnav-chat-paragraph-gap, 0.44em) !important;
    }

    main [data-message-author-role] :where(.markdown p:first-child, .prose p:first-child, p:first-child) {
      margin-top: 0 !important;
    }

    main [data-message-author-role] :where(.markdown p:last-child, .prose p:last-child, p:last-child) {
      margin-bottom: 0 !important;
    }

    main [data-message-author-role] :where(.markdown code, .markdown pre, .prose code, .prose pre, code, pre) {
      font-size: var(--cnav-chat-code-size, 0.94rem) !important;
      letter-spacing: var(--cnav-chat-code-letter-spacing, 0px) !important;
      line-height: var(--cnav-chat-code-line-height, 1.46) !important;
    }

    main [data-message-author-role="user"] :is(.whitespace-pre-wrap, .break-words) {
      max-width: min(760px, 72vw) !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }

    main [data-message-author-role="user"] :is(.whitespace-pre-wrap, .break-words):has(> :nth-child(8)) {
      max-height: 46vh;
      overflow-y: auto;
    }

    ${canvasTextSelector} {
      font-size: var(--cnav-canvas-font-size, 1rem) !important;
      letter-spacing: var(--cnav-canvas-letter-spacing, 0px) !important;
      line-height: var(--cnav-canvas-line-height, 1.55) !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }

    ${canvasTextSelector} :where(.ProseMirror, .cm-line, .view-line, .view-line span, .markdown, .prose, p, li, span, strong, em, blockquote) {
      font-size: inherit !important;
      letter-spacing: var(--cnav-canvas-letter-spacing, 0px) !important;
      line-height: var(--cnav-canvas-line-height, 1.55) !important;
    }

    ${canvasTextSelector} :where(p, li) {
      margin-top: var(--cnav-canvas-paragraph-gap, 0.4em) !important;
      margin-bottom: var(--cnav-canvas-paragraph-gap, 0.4em) !important;
    }

    ${canvasTextSelector} :where(p:first-child, li:first-child) {
      margin-top: 0 !important;
    }

    ${canvasTextSelector} :where(p:last-child, li:last-child) {
      margin-bottom: 0 !important;
    }

    ${canvasTextSelector} :where(code, pre, .cm-line, .view-line, .view-line span) {
      font-size: var(--cnav-canvas-code-size, 0.94rem) !important;
      letter-spacing: var(--cnav-canvas-code-letter-spacing, 0px) !important;
      line-height: var(--cnav-canvas-code-line-height, 1.46) !important;
    }
  `;
  style.dataset.cnavStatic = "true";
}

function applyChatTypography(settings: NavigatorSettings) {
  installChatTypographyStyle();

  const root = document.documentElement;
  const rootStyle = root.style;
  const contentWidth = `${getThreadWidthRem(settings.chatContentWidth).toFixed(2)}rem`;

  setStylePropertyIfChanged(rootStyle, "--cnav-chat-font-size", `${(settings.chatFontScale / 100).toFixed(2)}rem`);
  setStylePropertyIfChanged(rootStyle, "--cnav-chat-code-size", `${Math.max(0.85, (settings.chatFontScale / 100) * 0.94).toFixed(2)}rem`);
  setStylePropertyIfChanged(rootStyle, "--cnav-chat-letter-spacing", `${settings.chatLetterSpacing.toFixed(2)}px`);
  setStylePropertyIfChanged(rootStyle, "--cnav-chat-code-letter-spacing", `${Math.min(settings.chatLetterSpacing, 2).toFixed(2)}px`);
  setStylePropertyIfChanged(rootStyle, "--cnav-chat-line-height", `${(settings.chatLineHeight / 100).toFixed(2)}`);
  setStylePropertyIfChanged(rootStyle, "--cnav-chat-code-line-height", `${Math.max(1.38, settings.chatLineHeight / 100 * 0.94).toFixed(2)}`);
  setStylePropertyIfChanged(rootStyle, "--cnav-chat-paragraph-gap", `${Math.max(0.34, (settings.chatLineHeight - 125) * 0.006 + 0.26).toFixed(2)}em`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-font-size", `${(settings.canvasFontScale / 100).toFixed(2)}rem`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-code-size", `${Math.max(0.82, (settings.canvasFontScale / 100) * 0.94).toFixed(2)}rem`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-letter-spacing", `${settings.canvasLetterSpacing.toFixed(2)}px`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-code-letter-spacing", `${Math.min(settings.canvasLetterSpacing, 2).toFixed(2)}px`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-line-height", `${(settings.canvasLineHeight / 100).toFixed(2)}`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-code-line-height", `${Math.max(1.34, settings.canvasLineHeight / 100 * 0.94).toFixed(2)}`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-paragraph-gap", `${Math.max(0.28, (settings.canvasLineHeight - 120) * 0.005 + 0.22).toFixed(2)}em`);
  setStylePropertyIfChanged(rootStyle, "--cnav-thread-width", `min(${contentWidth}, calc(100vw - 24px))`);

  if (settings.chatContentWidth > OFFICIAL_THREAD_WIDTH) {
    root.dataset.cnavWideThread = "true";
  } else {
    delete root.dataset.cnavWideThread;
  }
}

function safeQueryAll(selector: string, root: ParentNode = document): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function requestIdleWork(callback: () => void, timeout = IDLE_SCAN_TIMEOUT_MS): ScheduledIdleWork {
  const win = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  };

  if (typeof win.requestIdleCallback === "function") {
    return {
      id: win.requestIdleCallback(() => callback(), { timeout }),
      type: "idle"
    };
  }

  return {
    id: window.setTimeout(callback, 0),
    type: "timer"
  };
}

function cancelIdleWork(work: ScheduledIdleWork | null) {
  if (!work) {
    return;
  }

  const win = window as Window & {
    cancelIdleCallback?: (handle: number) => void;
  };

  if (work.type === "idle" && typeof win.cancelIdleCallback === "function") {
    win.cancelIdleCallback(work.id);
    return;
  }

  window.clearTimeout(work.id);
}

function normalizeText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(You said:|ChatGPT said:|User:|Assistant:|Model:)\s*/i, "")
    .trim();
}

function extractVisibleText(element: HTMLElement, maxCharacters = Number.POSITIVE_INFINITY): string {
  const parts: string[] = [];
  let length = 0;
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
      const available = maxCharacters - length;
      if (available <= 0) {
        break;
      }

      const nextText = text.length > available ? text.slice(0, available) : text;
      parts.push(nextText);
      length += nextText.length;
    }
  }

  return normalizeText(parts.join(" "));
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
    count =
      normalized.length > TOKENIZER_TEXT_LIMIT
        ? approximateTokenCount(normalized)
        : getTokenizer().encode(normalized).length;
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
  let nodeCount = 0;

  for (const child of safeQueryAll(selector, element)) {
    if (nodeCount >= TOKEN_BREAKDOWN_NODE_LIMIT) {
      break;
    }

    const text = extractVisibleText(child);
    if (!text) {
      continue;
    }

    nodeCount += 1;
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
  addCandidate(element.querySelector<HTMLElement>("img, picture, canvas, video"));
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
    if (testId && /\b(message|conversation-turn|turn|canvas|artifact|document|attachment|file|image|media|picture)\b/i.test(testId)) {
      return `data-testid:${testId}`;
    }

    const id = candidate.id.trim();
    if (id && /\b(message|conversation|turn|canvas|artifact|document|attachment|file|image|media|picture)\b/i.test(id)) {
      return `id:${id}`;
    }

    if (candidate instanceof HTMLImageElement) {
      const source = candidate.currentSrc || candidate.src;
      if (source) {
        return `image-src:${stableHash(source)}`;
      }
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

function getMessageAnchorElement(element: HTMLElement): HTMLElement {
  return (
    element.closest<HTMLElement>('article[data-testid^="conversation-turn"]') ??
    element.closest<HTMLElement>('[data-testid^="conversation-turn"]') ??
    element.closest<HTMLElement>("[data-message-author-role]") ??
    element
  );
}

function getStableAnchorId(message: ParsedMessage): string {
  const anchorElement = getMessageAnchorElement(message.element);
  const nativeKey = getNativeMessageKey(anchorElement);
  if (nativeKey) {
    const id = `cnav-msg-${stableHash(`${location.hostname}:${location.pathname}:${message.role}:${nativeKey}`)}`;
    anchorElement.setAttribute(ANCHOR_ATTR, id);
    return id;
  }

  const existing = anchorElement.getAttribute(ANCHOR_ATTR);
  if (existing) {
    return existing;
  }

  const id = getNodeSessionAnchorId(anchorElement);
  anchorElement.setAttribute(ANCHOR_ATTR, id);
  return id;
}

function getNativeTurnOrder(element: HTMLElement): number | null {
  const candidates: HTMLElement[] = [];
  const addCandidate = (candidate: HTMLElement | null) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  addCandidate(element);
  addCandidate(element.closest<HTMLElement>('article[data-testid^="conversation-turn"]'));
  addCandidate(element.closest<HTMLElement>('[data-testid^="conversation-turn"]'));
  addCandidate(element.querySelector<HTMLElement>('article[data-testid^="conversation-turn"]'));
  addCandidate(element.querySelector<HTMLElement>('[data-testid^="conversation-turn"]'));
  addCandidate(element.closest<HTMLElement>("[data-turn-index], [data-message-index], [data-index], [aria-posinset]"));

  for (const candidate of candidates) {
    const numericAttribute = [
      candidate.getAttribute("data-turn-index"),
      candidate.getAttribute("data-message-index"),
      candidate.getAttribute("data-index"),
      candidate.getAttribute("aria-posinset")
    ]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value >= 0);

    if (typeof numericAttribute === "number") {
      return numericAttribute;
    }

    const descriptor = [
      candidate.getAttribute("data-testid"),
      candidate.getAttribute("data-turn-id"),
      candidate.id
    ]
      .filter(Boolean)
      .join(" ");
    const match = descriptor.match(/\bconversation-turn[-_:]?(\d+)\b/i) ??
      descriptor.match(/\bturn[-_:]?(\d+)\b/i);

    if (match?.[1]) {
      return Number(match[1]);
    }
  }

  return null;
}

function getElementDocumentOrder(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const scrollContainer = getScrollContainer(element);

  if (scrollContainer === window) {
    return window.scrollY + rect.top;
  }

  const scrollElement = scrollContainer as HTMLElement;
  const containerRect = scrollElement.getBoundingClientRect();
  return scrollElement.scrollTop + rect.top - containerRect.top;
}

function getMessageDomOrder(message: ParsedMessage, fallbackIndex: number): number {
  const anchorElement = getMessageAnchorElement(message.element);
  const nativeOrder = getNativeTurnOrder(anchorElement);

  if (typeof nativeOrder === "number") {
    return nativeOrder * 2 + (message.role === "assistant" ? 1 : 0);
  }

  return getElementDocumentOrder(anchorElement) + fallbackIndex / 1000;
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

function getNavigatorDisplayTitle(item: NavigatorItem): string {
  const customTitle = normalizeText(item.customTitle || "");
  return customTitle || item.promptPreview;
}

function getNavigatorSearchText(item: NavigatorItem): string {
  return [
    item.promptPreview,
    item.answerSummary,
    item.customTitle || "",
    item.note || "",
    getNavigatorGroupLabel(inferNavigatorGroupKind(item), "zh-CN"),
    getNavigatorGroupLabel(inferNavigatorGroupKind(item), "en")
  ].join(" ");
}

function getNavigatorGroupLabel(kind: NavigatorGroupKind, language: AppLanguage): string {
  if (language === "en") {
    return {
      requirements: "Requirements",
      code: "Code changes",
      errors: "Troubleshooting",
      data: "Tables/Data",
      summary: "Summary",
      general: "General"
    }[kind];
  }

  if (language === "zh-TW") {
    return {
      requirements: "需求討論",
      code: "代碼修改",
      errors: "報錯排查",
      data: "表格/數據",
      summary: "總結整理",
      general: "常規對話"
    }[kind];
  }

  return {
    requirements: "需求讨论",
    code: "代码修改",
    errors: "报错排查",
    data: "表格/数据",
    summary: "总结整理",
    general: "常规对话"
  }[kind];
}

function inferNavigatorGroupKind(item: NavigatorItem): NavigatorGroupKind {
  const text = `${item.promptPreview} ${item.answerSummary} ${item.customTitle || ""} ${item.note || ""}`.toLowerCase();

  if (/(报错|錯誤|错误|失敗|失败|异常|例外|bug|崩溃|崩潰|error|exception|failed|failure|traceback|stack trace)/i.test(text)) {
    return "errors";
  }

  if (/(代码|代碼|函数|函式|组件|組件|接口|修复|修正|重构|重構|实现|實現|tsx?|jsx?|python|typescript|javascript|npm|build|typecheck|commit|git|css|html)/i.test(text)) {
    return "code";
  }

  if (/(表格|表單|表单|数据|數據|csv|tsv|excel|spreadsheet|json|markdown table|download|导出|匯出|导入|匯入)/i.test(text)) {
    return "data";
  }

  if (/(总结|總結|整理|归纳|歸納|复盘|復盤|摘要|结论|結論|summary|recap|takeaway)/i.test(text)) {
    return "summary";
  }

  if (/(需求|方案|计划|計劃|功能|优化|優化|设计|設計|讨论|討論|可行性|体验|體驗|feature|plan|proposal|requirement)/i.test(text)) {
    return "requirements";
  }

  return "general";
}

function buildNavigatorGroups(items: NavigatorItem[], language: AppLanguage): NavigatorGroup[] {
  const groups: NavigatorGroup[] = [];

  for (const item of items) {
    const kind = inferNavigatorGroupKind(item);
    const previous = groups[groups.length - 1];
    if (previous && previous.kind === kind) {
      previous.items.push(item);
      previous.tokenTotal += item.totalTokens;
      previous.heatLevel = Math.max(previous.heatLevel, item.heatLevel) as HeatLevel;
      continue;
    }

    groups.push({
      id: `${kind}-${stableHash(item.id).slice(0, 8)}`,
      kind,
      label: getNavigatorGroupLabel(kind, language),
      items: [item],
      tokenTotal: item.totalTokens,
      heatLevel: item.heatLevel
    });
  }

  return groups;
}

function filterNavigatorGroups(groups: NavigatorGroup[], visibleItemIds: Set<string>): NavigatorGroup[] {
  return groups
    .map((group) => {
      const visibleItems = group.items.filter((item) => visibleItemIds.has(item.id));
      if (visibleItems.length === 0) {
        return null;
      }

      return {
        ...group,
        items: visibleItems,
        tokenTotal: visibleItems.reduce((sum, item) => sum + item.totalTokens, 0),
        heatLevel: visibleItems.reduce<number>((heat, item) => Math.max(heat, item.heatLevel), 0) as HeatLevel
      };
    })
    .filter((group): group is NavigatorGroup => Boolean(group));
}

function formatSupplementalContextText(context: SupplementalContext): string {
  const text = normalizeText(context.text);
  if (!text) {
    return context.kind === "canvas" ? "画布内容" : "图片内容";
  }

  if (/^(图片内容|圖片內容|画布内容|畫布內容|附件内容|附件內容)$/i.test(text)) {
    return text;
  }

  return context.kind === "canvas" ? `画布内容：${text}` : `附件内容：${text}`;
}

function isContextCoveredByMessage(context: SupplementalContext, messages: ParsedMessage[]): boolean {
  return messages.some((message) => {
    if (message.element === context.element) {
      return true;
    }

    return message.element.contains(context.element) || context.element.contains(message.element);
  });
}

function buildNavigatorData(favorites: Record<string, true>, tokenBudget = DEFAULT_TOKEN_BUDGET): BuildNavigatorResult {
  const adapter = getAdapter();
  const collection = adapter.collect();
  const contextMessages: ParsedMessage[] = collection.supplementalContexts
    .filter((context) => !isContextCoveredByMessage(context, collection.messages))
    .map((context) => ({
      role: "assistant",
      element: context.element,
      text: formatSupplementalContextText(context)
    }));
  const messages = sortByDomOrder([...collection.messages, ...contextMessages]);
  const items: NavigatorItem[] = [];
  const mapEntries: MessageMapEntry[] = [];
  const messageIds: string[] = [];
  const messageDomOrders: number[] = [];
  const tokenBreakdowns: TokenBreakdown[] = [];
  anchorRegistry.clear();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const id = getStableAnchorId(message);
    const tokenBreakdown = getTokenBreakdown(message, id);
    const domOrder = getMessageDomOrder(message, index);

    messageIds.push(id);
    messageDomOrders.push(domOrder);
    tokenBreakdowns.push(tokenBreakdown);
    anchorRegistry.set(id, getMessageAnchorElement(message.element));
  }

  let cumulativeTokens = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const id = messageIds[index];
    const domOrder = messageDomOrders[index] ?? index;
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
        domOrder,
        favorite: false,
        heatLevel: getHeatLevel(tokenBreakdown.total, cumulativeTokens, tokenBudget),
        mounted: true
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
      domOrder,
      favorite,
      promptTokens: tokenBreakdown.total,
      answerTokens,
      totalTokens,
      heatLevel,
      site: adapter.id,
      mounted: true
    });

    mapEntries.push({
      id,
      role: message.role,
      tokenCount: tokenBreakdown.total,
      codeTokens: tokenBreakdown.code,
      tableTokens: tokenBreakdown.table,
      text: message.text,
      turnIndex: items.length,
      domOrder,
      favorite,
      heatLevel,
      mounted: true
    });
  }

  return {
    items,
    mapEntries,
    health: {
      ...collection.health,
      canAnchor: anchorRegistry.size > 0,
      tokenTextAvailable: mapEntries.some((entry) => entry.tokenCount > 0)
    }
  };
}

function getNavigatorItemKey(item: NavigatorItem): string {
  return stableHash(
    [
      normalizeText(item.promptPreview).toLowerCase(),
      normalizeText(item.answerSummary).toLowerCase(),
      Math.round(item.promptTokens / 8),
      Math.round(item.answerTokens / 8)
    ].join("|")
  );
}

function getMapEntryKey(entry: MessageMapEntry): string {
  return stableHash(
    [
      entry.role,
      normalizeText(entry.text).toLowerCase(),
      Math.round(entry.tokenCount / 8)
    ].join("|")
  );
}

function applyFavorite(item: NavigatorItem, favorites: Record<string, true>): NavigatorItem {
  return {
    ...item,
    favorite: Boolean(favorites[item.id] || item.favorite)
  };
}

function getNavigatorSortOrder(item: NavigatorItem): number {
  return Number.isFinite(item.domOrder) ? item.domOrder : item.turnIndex;
}

function getMapEntrySortOrder(entry: MessageMapEntry): number {
  return Number.isFinite(entry.domOrder) ? entry.domOrder : entry.turnIndex;
}

function normalizeNavigatorOrder(items: NavigatorItem[]): NavigatorItem[] {
  return [...items].sort((a, b) => getNavigatorSortOrder(a) - getNavigatorSortOrder(b))
    .map((item, index) => ({
    ...item,
    turnIndex: index + 1
  }));
}

function normalizeMapEntryOrder(entries: MessageMapEntry[]): MessageMapEntry[] {
  return [...entries].sort((a, b) => getMapEntrySortOrder(a) - getMapEntrySortOrder(b));
}

function mergeNavigatorData(
  previousItems: NavigatorItem[],
  previousEntries: MessageMapEntry[],
  currentItems: NavigatorItem[],
  currentEntries: MessageMapEntry[],
  favorites: Record<string, true>,
  previousScrollY: number
): Pick<BuildNavigatorResult, "items" | "mapEntries"> {
  if (previousItems.length === 0) {
    return {
      items: normalizeNavigatorOrder(currentItems.map((item) => applyFavorite({ ...item, mounted: true }, favorites))),
      mapEntries: normalizeMapEntryOrder(currentEntries.map((entry) => ({ ...entry, mounted: true })))
    };
  }

  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const usedPreviousIds = new Set<string>();
  const currentToMergedId = new Map<string, string>();
  const replacementByPreviousId = new Map<string, NavigatorItem>();
  const currentMergedItems: NavigatorItem[] = [];
  const matchedCurrentIds = new Set<string>();

  const findPreviousMatch = (item: NavigatorItem): NavigatorItem | undefined => {
    const exact = previousById.get(item.id);
    if (exact && !usedPreviousIds.has(exact.id)) {
      return exact;
    }

    const key = getNavigatorItemKey(item);
    return previousItems.find((candidate) => !usedPreviousIds.has(candidate.id) && getNavigatorItemKey(candidate) === key);
  };

  for (const item of currentItems) {
    const matched = findPreviousMatch(item);
    const mergedId = matched?.id ?? item.id;
    const currentAnchor = anchorRegistry.get(item.id);
    if (currentAnchor) {
      anchorRegistry.set(mergedId, currentAnchor);
    }

    currentToMergedId.set(item.id, mergedId);
    const mergedItem = applyFavorite(
      {
        ...(matched ?? item),
        ...item,
        id: mergedId,
        customTitle: matched?.customTitle ?? item.customTitle,
        note: matched?.note ?? item.note,
        mounted: true
      },
      favorites
    );

    currentMergedItems.push(mergedItem);
    if (matched) {
      usedPreviousIds.add(matched.id);
      matchedCurrentIds.add(mergedId);
      replacementByPreviousId.set(matched.id, mergedItem);
    }
  }

  const result = previousItems.map((item) =>
    replacementByPreviousId.get(item.id) ?? applyFavorite({ ...item, mounted: false }, favorites)
  );

  const insertFreshItem = (item: NavigatorItem, currentIndex: number) => {
    if (result.some((existing) => existing.id === item.id || getNavigatorItemKey(existing) === getNavigatorItemKey(item))) {
      return;
    }

    const nextKnown = currentMergedItems.slice(currentIndex + 1).find((candidate) => matchedCurrentIds.has(candidate.id));
    if (nextKnown) {
      const nextIndex = result.findIndex((candidate) => candidate.id === nextKnown.id);
      if (nextIndex >= 0) {
        result.splice(nextIndex, 0, item);
        return;
      }
    }

    const previousKnown = [...currentMergedItems.slice(0, currentIndex)]
      .reverse()
      .find((candidate) => matchedCurrentIds.has(candidate.id));
    if (previousKnown) {
      const previousIndex = result.findIndex((candidate) => candidate.id === previousKnown.id);
      if (previousIndex >= 0) {
        result.splice(previousIndex + 1, 0, item);
        return;
      }
    }

    if (window.scrollY < previousScrollY) {
      result.unshift(item);
      return;
    }

    result.push(item);
  };

  currentMergedItems.forEach((item, index) => {
    if (!matchedCurrentIds.has(item.id)) {
      insertFreshItem(item, index);
    }
  });

  return {
    items: normalizeNavigatorOrder(result),
    mapEntries: normalizeMapEntryOrder(mergeMapEntries(previousEntries, currentEntries, currentToMergedId, favorites))
  };
}

function mergeMapEntries(
  previousEntries: MessageMapEntry[],
  currentEntries: MessageMapEntry[],
  currentToMergedId: Map<string, string>,
  favorites: Record<string, true>
): MessageMapEntry[] {
  const result = previousEntries.map((entry) => ({
    ...entry,
    favorite: Boolean(favorites[entry.id] || entry.favorite),
    mounted: false
  }));

  const replaceOrAdd = (entry: MessageMapEntry) => {
    const id = currentToMergedId.get(entry.id) ?? entry.id;
    const currentAnchor = anchorRegistry.get(entry.id);
    if (currentAnchor) {
      anchorRegistry.set(id, currentAnchor);
    }

    const nextEntry: MessageMapEntry = {
      ...entry,
      id,
      favorite: Boolean(favorites[id] || entry.favorite),
      mounted: true
    };
    const existingIndex = result.findIndex(
      (candidate) => candidate.id === id || getMapEntryKey(candidate) === getMapEntryKey(nextEntry)
    );

    if (existingIndex >= 0) {
      result[existingIndex] = nextEntry;
      return;
    }

    result.push(nextEntry);
  };

  currentEntries.forEach(replaceOrAdd);
  return result;
}

function restoreItemsFromRecord(record: StoredConversationRecord | undefined, favorites: Record<string, true>): NavigatorItem[] {
  if (!record?.nodes.length) {
    return [];
  }

  return normalizeNavigatorOrder(record.nodes.map((node) => restoreItemFromNode(node, favorites)));
}

function restoreItemFromNode(node: StoredNavigatorNode, favorites: Record<string, true>): NavigatorItem {
  return {
    id: node.id,
    promptPreview: node.promptPreview,
    answerSummary: node.answerSummary,
    customTitle: node.customTitle,
    note: node.note,
    turnIndex: node.turnIndex,
    domOrder: typeof node.domOrder === "number" && Number.isFinite(node.domOrder) ? node.domOrder : node.turnIndex,
    favorite: Boolean(favorites[node.id] || node.favorite),
    promptTokens: node.promptTokens ?? 0,
    answerTokens: node.answerTokens ?? 0,
    totalTokens: node.totalTokens ?? (node.promptTokens ?? 0) + (node.answerTokens ?? 0),
    heatLevel: (node.heatLevel ?? 0) as HeatLevel,
    site: "chatgpt",
    mounted: false
  };
}

function restoreMapEntriesFromItems(items: NavigatorItem[]): MessageMapEntry[] {
  return items.map((item) => ({
    id: item.id,
    role: "user",
    tokenCount: item.totalTokens,
    codeTokens: 0,
    tableTokens: 0,
    text: `${item.promptPreview} ${item.answerSummary}`,
    turnIndex: item.turnIndex,
    domOrder: item.domOrder,
    favorite: item.favorite,
    heatLevel: item.heatLevel,
    mounted: false
  }));
}

function scrollToNavigatorItem(id: string, animate = true) {
  const element = anchorRegistry.get(id) ?? document.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="${id}"]`);
  if (!element) {
    return;
  }

  const anchorElement = getMessageAnchorElement(element);
  jumpToElement(anchorElement, animate);
  flashAnchor(anchorElement);
}

function scrollToChatBoundary(edge: "top" | "bottom", animate = true) {
  const anchors = getConversationAnchorElements();
  const useAnimation = animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (edge === "top") {
    const firstAnchor = anchors[0];
    if (firstAnchor) {
      scrollAnchorToTop(firstAnchor, useAnimation);
      flashAnchor(firstAnchor);
      return;
    }

    scrollWindowTo(0, useAnimation);
    return;
  }

  const referenceAnchor = anchors[anchors.length - 1];
  const scrollContainer = referenceAnchor ? getScrollContainer(referenceAnchor) : window;
  if (scrollContainer === window) {
    scrollWindowTo(getDocumentMaxScrollTop(), useAnimation);
    return;
  }

  const scrollElement = scrollContainer as HTMLElement;
  scrollElementTo(scrollElement, Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight), useAnimation);
}

function scrollAnchorToTop(element: HTMLElement, animate: boolean) {
  const scrollContainer = getScrollContainer(element);

  if (scrollContainer === window) {
    const rect = element.getBoundingClientRect();
    scrollWindowTo(Math.max(0, window.scrollY + rect.top - 92), animate);
    verifyJump(element, scrollContainer, animate ? 360 : 80);
    return;
  }

  const scrollElement = scrollContainer as HTMLElement;
  const containerRect = scrollElement.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const top = Math.max(0, scrollElement.scrollTop + rect.top - containerRect.top - 18);
  scrollElementTo(scrollElement, top, animate);
  verifyJump(element, scrollContainer, animate ? 360 : 80);
}

function getConversationAnchorElements(): HTMLElement[] {
  const candidates = Array.from(
    new Set([
      ...Array.from(anchorRegistry.values()),
      ...Array.from(document.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`))
    ])
  )
    .map(getMessageAnchorElement)
    .filter(isConversationAnchorElement);

  return sortElementsByDomPosition(Array.from(new Set(candidates)));
}

function isConversationAnchorElement(element: HTMLElement): boolean {
  if (!document.body.contains(element) || element.closest(`#${ROOT_ID}`) || !element.closest("main")) {
    return false;
  }

  return Boolean(
    element.matches('article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"], [data-message-author-role]') ||
      element.querySelector('[data-message-author-role]')
  );
}

function sortElementsByDomPosition(elements: HTMLElement[]): HTMLElement[] {
  return [...elements].sort((a, b) => {
    if (a === b) {
      return 0;
    }

    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  });
}

function jumpToElement(element: HTMLElement, animate: boolean) {
  const scrollContainer = getScrollContainer(element);
  const useAnimation = animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (scrollContainer === window) {
    const rect = element.getBoundingClientRect();
    const offset = Math.max(92, Math.min(220, (window.innerHeight - Math.min(rect.height, window.innerHeight * 0.7)) / 2));
    const top = Math.max(0, window.scrollY + rect.top - offset);
    scrollWindowTo(top, useAnimation);
    verifyJump(element, scrollContainer, useAnimation ? 360 : 80);
    return;
  }

  const scrollElement = scrollContainer as HTMLElement;
  const containerRect = scrollElement.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const offset = Math.max(24, Math.min(160, (scrollElement.clientHeight - Math.min(rect.height, scrollElement.clientHeight * 0.7)) / 2));
  const top = Math.max(0, scrollElement.scrollTop + rect.top - containerRect.top - offset);
  scrollElementTo(scrollElement, top, useAnimation);
  verifyJump(element, scrollContainer, useAnimation ? 360 : 80);
}

function scrollWindowTo(top: number, animate: boolean) {
  if (!animate) {
    cancelNavigationAnimation();
    window.scrollTo({ top, behavior: "auto" });
    return;
  }

  animateScroll(window.scrollY, top, (value) => window.scrollTo({ top: value, behavior: "auto" }));
}

function getDocumentMaxScrollTop(): number {
  const scrollingElement = document.scrollingElement ?? document.documentElement;
  const scrollHeight = Math.max(
    0,
    scrollingElement.scrollHeight,
    document.documentElement.scrollHeight,
    document.body.scrollHeight
  );

  return Math.max(0, scrollHeight - window.innerHeight);
}

function scrollElementTo(element: HTMLElement, top: number, animate: boolean) {
  if (!animate) {
    cancelNavigationAnimation();
    element.scrollTo({ top, behavior: "auto" });
    return;
  }

  animateScroll(element.scrollTop, top, (value) => element.scrollTo({ top: value, behavior: "auto" }));
}

function animateScroll(from: number, to: number, apply: (value: number) => void) {
  cancelNavigationAnimation();

  const distance = to - from;
  if (Math.abs(distance) < 4) {
    apply(to);
    return;
  }

  const start = performance.now();
  const duration = Math.min(420, Math.max(180, Math.abs(distance) * 0.22));
  const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    apply(Math.round(from + distance * easeOutCubic(progress)));

    if (progress < 1) {
      navigationAnimationFrame = window.requestAnimationFrame(step);
      return;
    }

    navigationAnimationFrame = 0;
    apply(to);
  };

  navigationAnimationFrame = window.requestAnimationFrame(step);
}

function cancelNavigationAnimation() {
  if (!navigationAnimationFrame) {
    return;
  }

  window.cancelAnimationFrame(navigationAnimationFrame);
  navigationAnimationFrame = 0;
}

function getScrollContainer(element: HTMLElement): HTMLElement | Window {
  let current = element.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
    if (canScroll && current.scrollHeight > current.clientHeight + 4) {
      return current;
    }
    current = current.parentElement;
  }

  return window;
}

function verifyJump(element: HTMLElement, scrollContainer: HTMLElement | Window, delay = 80) {
  window.setTimeout(() => {
    const rect = element.getBoundingClientRect();
    const topLimit = scrollContainer === window
      ? 72
      : (scrollContainer as HTMLElement).getBoundingClientRect().top + 16;
    const bottomLimit = scrollContainer === window
      ? window.innerHeight - 96
      : (scrollContainer as HTMLElement).getBoundingClientRect().bottom - 16;

    if (rect.bottom >= topLimit && rect.top <= bottomLimit) {
      return;
    }

    if (scrollContainer === window) {
      const top = Math.max(0, window.scrollY + rect.top - topLimit);
      scrollWindowTo(top, false);
      return;
    }

    const scrollElement = scrollContainer as HTMLElement;
    const containerRect = scrollElement.getBoundingClientRect();
    const top = Math.max(0, scrollElement.scrollTop + rect.top - containerRect.top - 16);
    scrollElementTo(scrollElement, top, false);
  }, delay);
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
  favorites: Record<string, true>,
  health?: AdapterHealth,
  groupCollapsed?: Record<string, true>
): Promise<boolean> {
  if (settings.cacheMode === "off" || isVolatilePageKey(pageKey)) {
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
    health: health ? toStoredAdapterHealth(health) : undefined,
    nodes: items.map((item) => ({
      id: item.id,
      promptPreview: item.promptPreview,
      answerSummary: item.answerSummary,
      customTitle: normalizeText(item.customTitle || "") || undefined,
      note: normalizeText(item.note || "") || undefined,
      turnIndex: item.turnIndex,
      domOrder: item.domOrder,
      favorite: item.favorite,
      promptTokens: item.promptTokens,
      answerTokens: item.answerTokens,
      totalTokens: item.totalTokens,
      heatLevel: item.heatLevel,
      updatedAt: Date.now()
    })),
    groupCollapsed
  };

  if (settings.cacheMode === "page") {
    return Promise.resolve(writePageStorageRecord(pageKey, record));
  }

  return storageSet({ [pageKey]: record });
}

function toStoredAdapterHealth(health: AdapterHealth): StoredAdapterHealth {
  return {
    status: health.status,
    reason: health.reason,
    ruleId: health.ruleId,
    messageCount: health.messageCount,
    userCount: health.userCount,
    assistantCount: health.assistantCount,
    source: health.source,
    updatedAt: Date.now()
  };
}

function makeRecordSignature(
  items: NavigatorItem[],
  favorites: Record<string, true>,
  groupCollapsed: Record<string, true> = {}
): string {
  const favoriteIds = Object.keys(favorites).sort().join(",");
  const collapsedIds = Object.keys(groupCollapsed).sort().join(",");
  const itemSignature = items
    .map((item) =>
      `${item.id}:${item.promptPreview}:${item.answerSummary}:${item.customTitle || ""}:${item.note || ""}:${item.totalTokens}:${item.favorite ? "1" : "0"}`
    )
    .join("|");

  return `${favoriteIds}::${collapsedIds}::${itemSignature}`;
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

type TableCopyFormat = "markdown" | "tsv" | "csv" | "html";

interface FloatingControlPosition {
  right: number;
  bottom: number;
}

interface FloatingRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface TableCopyOverlay {
  id: string;
  table: HTMLTableElement;
  top: number;
  left: number;
  menuAlign: "left" | "right";
  rowCount: number;
  columnCount: number;
  index: number;
  total: number;
}

interface TableCellCoordinate {
  tableId: string;
  rowIndex: number;
  columnIndex: number;
}

interface TableAreaSelection {
  tableId: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

interface TableCopyLabels {
  copy: string;
  copied: string;
  menu: string;
  rows: string;
  columns: string;
  table: string;
  fullTable: string;
  currentRow: string;
  currentColumn: string;
  selectedArea: string;
  selectArea: string;
  cancelSelection: string;
  downloadCsv: string;
  previousTable: string;
  nextTable: string;
  formats: Record<TableCopyFormat, string>;
}

const TABLE_COPY_FORMATS: TableCopyFormat[] = ["markdown", "tsv", "csv", "html"];
const FLOATING_CONTROL_GAP = 10;
const TABLE_COPY_TOOLBAR_WIDTH = 42;
const TABLE_COPY_TOOLBAR_HEIGHT = 104;
const TABLE_COPY_MENU_WIDTH = 224;
const TABLE_COPY_RIGHT_RAIL_RESERVE = 96;
const TABLE_COPY_OUTSIDE_GAP = 14;
const SCROLL_JUMP_WIDTH = 42;
const SCROLL_JUMP_HEIGHT = 76;
const tableCopyIdRegistry = new WeakMap<HTMLTableElement, string>();
let nextTableCopyIndex = 1;

function getTableCopyLabels(language: AppLanguage): TableCopyLabels {
  if (language === "en") {
    return {
      copy: "Copy table",
      copied: "Copied",
      menu: "Copy format",
      rows: "rows",
      columns: "cols",
      table: "Table",
      fullTable: "Copy full table",
      currentRow: "Copy current row",
      currentColumn: "Copy current column",
      selectedArea: "Copy selected area",
      selectArea: "Select area",
      cancelSelection: "Cancel selection",
      downloadCsv: "Download CSV",
      previousTable: "Previous table",
      nextTable: "Next table",
      formats: {
        markdown: "Markdown",
        tsv: "TSV for sheets",
        csv: "CSV",
        html: "Rich HTML"
      }
    };
  }

  if (language === "zh-TW") {
    return {
      copy: "複製表格",
      copied: "已複製",
      menu: "複製格式",
      rows: "行",
      columns: "列",
      table: "表",
      fullTable: "複製整表",
      currentRow: "複製當前行",
      currentColumn: "複製當前列",
      selectedArea: "複製選中區域",
      selectArea: "選擇區域",
      cancelSelection: "取消選擇",
      downloadCsv: "下載 CSV",
      previousTable: "上一張表",
      nextTable: "下一張表",
      formats: {
        markdown: "Markdown 表格",
        tsv: "TSV 表格",
        csv: "CSV",
        html: "富文本表格"
      }
    };
  }

  return {
    copy: "复制表格",
    copied: "已复制",
    menu: "复制格式",
    rows: "行",
    columns: "列",
    table: "表",
    fullTable: "复制整表",
    currentRow: "复制当前行",
    currentColumn: "复制当前列",
    selectedArea: "复制选中区域",
    selectArea: "选择区域",
    cancelSelection: "取消选择",
    downloadCsv: "下载 CSV",
    previousTable: "上一张表",
    nextTable: "下一张表",
    formats: {
      markdown: "Markdown 表格",
      tsv: "TSV 表格",
      csv: "CSV",
      html: "富文本表格"
    }
  };
}

function isTableCopyFormat(value: string | null): value is TableCopyFormat {
  return TABLE_COPY_FORMATS.includes(value as TableCopyFormat);
}

function readPreferredTableCopyFormat(): TableCopyFormat {
  try {
    const value = window.localStorage.getItem(TABLE_COPY_FORMAT_STORAGE_KEY);
    return isTableCopyFormat(value) ? value : "markdown";
  } catch {
    return "markdown";
  }
}

function writePreferredTableCopyFormat(format: TableCopyFormat) {
  try {
    window.localStorage.setItem(TABLE_COPY_FORMAT_STORAGE_KEY, format);
  } catch {
    // Remembering the format is a convenience only.
  }
}

function getTableCopyId(table: HTMLTableElement): string {
  const existing = tableCopyIdRegistry.get(table);
  if (existing) {
    return existing;
  }

  const id = `cnav-table-${nextTableCopyIndex.toString(36)}`;
  nextTableCopyIndex += 1;
  tableCopyIdRegistry.set(table, id);
  return id;
}

function isCopyableTable(table: HTMLTableElement): boolean {
  if (
    table.closest(`#${ROOT_ID}`) ||
    table.closest("form, textarea, input, select") ||
    table.rows.length === 0
  ) {
    return false;
  }

  const rect = table.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 36 || rect.bottom < 56 || rect.top > window.innerHeight - 24) {
    return false;
  }

  const style = window.getComputedStyle(table);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getTableColumnCount(table: HTMLTableElement): number {
  let columnCount = 0;
  for (const row of Array.from(table.rows)) {
    const rowColumns = Array.from(row.cells).reduce((sum, cell) => sum + Math.max(1, cell.colSpan || 1), 0);
    columnCount = Math.max(columnCount, rowColumns);
  }

  return columnCount;
}

function findCopyableTables(): HTMLTableElement[] {
  return safeQueryAll("main table")
    .filter((element): element is HTMLTableElement => element instanceof HTMLTableElement)
    .filter(isCopyableTable);
}

function getNavigatorAvoidRect(navigatorCollapsed: boolean): DOMRect | null {
  if (navigatorCollapsed) {
    return null;
  }

  const shell = document.querySelector<HTMLElement>(`#${ROOT_ID} .cnav-shell:not(.is-collapsed)`);
  const rect = shell?.getBoundingClientRect();
  if (!rect || rect.width < 80 || rect.height < 80) {
    return null;
  }

  return rect;
}

function isRectVisible(rect: DOMRect): boolean {
  return rect.width > 0 &&
    rect.height > 0 &&
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight;
}

function isCompactFloatingControlRect(rect: DOMRect): boolean {
  return rect.width <= 150 && rect.height <= 120;
}

function getFloatingAvoidRects(navigatorCollapsed: boolean): DOMRect[] {
  const rects: DOMRect[] = [];
  const navigatorRect = getNavigatorAvoidRect(navigatorCollapsed);
  if (navigatorRect) {
    rects.push(navigatorRect);
  }

  for (const handle of safeQueryAll(`#${ROOT_ID} .cnav-thread-handle`)) {
    const rect = handle.getBoundingClientRect();
    if (isRectVisible(rect)) {
      rects.push(rect);
    }
  }

  const selectors = [
    "button",
    '[role="button"]',
    "[data-testid]",
    "[aria-label]"
  ].join(",");
  const allCandidates = safeQueryAll(selectors);
  const candidates = Array.from(new Set([
    ...allCandidates.slice(0, 260),
    ...allCandidates.slice(-260)
  ]));
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  for (const element of candidates) {
    if (element.closest(`#${ROOT_ID}`)) {
      continue;
    }

    const rect = element.getBoundingClientRect();
    if (
      !isRectVisible(rect) ||
      rect.width < 20 ||
      rect.height < 20 ||
      !isCompactFloatingControlRect(rect)
    ) {
      continue;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      continue;
    }

    const fixedLike = style.position === "fixed" || style.position === "sticky";
    const nearRightRail = rect.right > viewportWidth - 150;
    const nearBottomRail = rect.bottom > viewportHeight - 150 && rect.right > viewportWidth - 180;
    const nearTopRightRail = rect.top < 150 && rect.right > viewportWidth - 190;

    if (fixedLike || nearRightRail || nearBottomRail || nearTopRightRail) {
      rects.push(rect);
    }
  }

  return rects;
}

function rectsOverlap(
  left: number,
  top: number,
  width: number,
  height: number,
  rect: DOMRect,
  gap = FLOATING_CONTROL_GAP
): boolean {
  return left < rect.right + gap &&
    left + width > rect.left - gap &&
    top < rect.bottom + gap &&
    top + height > rect.top - gap;
}

function shiftLeftAwayFromRects(
  left: number,
  top: number,
  width: number,
  height: number,
  minLeft: number,
  avoidRects: DOMRect[]
): number {
  let nextLeft = left;

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const rect of avoidRects) {
      if (!rectsOverlap(nextLeft, top, width, height, rect)) {
        continue;
      }

      const candidateLeft = rect.left - width - FLOATING_CONTROL_GAP;
      if (candidateLeft < nextLeft) {
        nextLeft = candidateLeft;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return Math.max(minLeft, nextLeft);
}

function clampFloatingValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canPlaceFloatingControl(
  left: number,
  top: number,
  width: number,
  height: number,
  avoidRects: DOMRect[]
): boolean {
  if (
    left < 8 ||
    top < 8 ||
    left + width > window.innerWidth - 8 ||
    top + height > window.innerHeight - 8
  ) {
    return false;
  }

  return avoidRects.every((rect) => !rectsOverlap(left, top, width, height, rect));
}

function getClippedTableRect(table: HTMLTableElement): FloatingRect {
  const tableRect = table.getBoundingClientRect();
  const clippedRect: FloatingRect = {
    top: tableRect.top,
    right: tableRect.right,
    bottom: tableRect.bottom,
    left: tableRect.left
  };

  for (let parent = table.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    const clipsX = /(auto|scroll|hidden|clip)/.test(style.overflowX);
    const clipsY = /(auto|scroll|hidden|clip)/.test(style.overflowY);
    if (!clipsX && !clipsY) {
      continue;
    }

    const parentRect = parent.getBoundingClientRect();
    if (clipsX) {
      clippedRect.left = Math.max(clippedRect.left, parentRect.left);
      clippedRect.right = Math.min(clippedRect.right, parentRect.right);
    }
    if (clipsY) {
      clippedRect.top = Math.max(clippedRect.top, parentRect.top);
      clippedRect.bottom = Math.min(clippedRect.bottom, parentRect.bottom);
    }
  }

  return clippedRect;
}

function getTableCopyPosition(
  rect: FloatingRect,
  avoidRects: DOMRect[]
): { left: number; top: number; menuAlign: "left" | "right" } | null {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const visibleTop = Math.max(rect.top, 76);
  const visibleBottom = Math.min(rect.bottom, viewportHeight - 72);
  const visibleLeft = Math.max(rect.left, 8);
  let visibleRight = Math.min(rect.right, viewportWidth - TABLE_COPY_RIGHT_RAIL_RESERVE);

  for (const avoidRect of avoidRects) {
    if (visibleRight > avoidRect.left - 8 && visibleBottom > avoidRect.top && visibleTop < avoidRect.bottom) {
      visibleRight = Math.min(visibleRight, avoidRect.left - 8);
    }
  }

  if (visibleBottom <= visibleTop + 24 || visibleRight <= visibleLeft + 44) {
    return null;
  }

  const baseTop = clampFloatingValue(
    Math.round(visibleTop + 8),
    76,
    Math.max(76, Math.round(visibleBottom - TABLE_COPY_TOOLBAR_HEIGHT))
  );
  const topCandidates = Array.from(new Set([
    baseTop,
    Math.round(visibleTop - TABLE_COPY_TOOLBAR_HEIGHT - 8),
    Math.round(visibleTop + 44)
  ])).filter((top) => top >= 76 && top <= visibleBottom - TABLE_COPY_TOOLBAR_HEIGHT);

  const rightLimit = Math.min(viewportWidth - TABLE_COPY_RIGHT_RAIL_RESERVE, viewportWidth - 8);
  const outsideRightLeft = Math.round(visibleRight + TABLE_COPY_OUTSIDE_GAP);
  const insideRightLeft = shiftLeftAwayFromRects(
    Math.round(visibleRight - TABLE_COPY_TOOLBAR_WIDTH),
    baseTop,
    TABLE_COPY_TOOLBAR_WIDTH,
    TABLE_COPY_TOOLBAR_HEIGHT,
    Math.round(visibleLeft),
    avoidRects
  );
  const leftCandidates = [
    outsideRightLeft,
    insideRightLeft,
    Math.round(visibleRight - TABLE_COPY_TOOLBAR_WIDTH - 12),
    Math.round(visibleLeft + 8)
  ].filter((left) => left + TABLE_COPY_TOOLBAR_WIDTH <= rightLimit);

  for (const top of topCandidates) {
    for (const left of leftCandidates) {
      if (canPlaceFloatingControl(left, top, TABLE_COPY_TOOLBAR_WIDTH, TABLE_COPY_TOOLBAR_HEIGHT, avoidRects)) {
        return {
          left: Math.round(left),
          top: Math.round(top),
          menuAlign: left - TABLE_COPY_MENU_WIDTH + TABLE_COPY_TOOLBAR_WIDTH >= 8 ? "right" : "left"
        };
      }
    }
  }

  const fallbackOutsideLeft = outsideRightLeft + TABLE_COPY_TOOLBAR_WIDTH <= rightLimit
    ? outsideRightLeft
    : insideRightLeft;
  const fallbackLeft = clampFloatingValue(
    fallbackOutsideLeft,
    Math.round(visibleLeft),
    rightLimit - TABLE_COPY_TOOLBAR_WIDTH
  );
  return {
    left: Math.round(fallbackLeft),
    top: Math.round(baseTop),
    menuAlign: fallbackLeft - TABLE_COPY_MENU_WIDTH + TABLE_COPY_TOOLBAR_WIDTH >= 8 ? "right" : "left"
  };
}

function getTableCopyOverlay(
  table: HTMLTableElement,
  avoidRects: DOMRect[],
  index: number,
  total: number
): TableCopyOverlay | null {
  const rect = getClippedTableRect(table);
  const position = getTableCopyPosition(rect, avoidRects);
  if (!position) {
    return null;
  }

  return {
    id: getTableCopyId(table),
    table,
    top: position.top,
    left: position.left,
    menuAlign: position.menuAlign,
    rowCount: table.rows.length,
    columnCount: getTableColumnCount(table),
    index,
    total
  };
}

function getDefaultScrollJumpPosition(): FloatingControlPosition {
  return window.innerWidth <= 760
    ? { right: 12, bottom: 82 }
    : { right: 56, bottom: 30 };
}

function getScrollJumpPosition(navigatorCollapsed: boolean): FloatingControlPosition {
  const defaultPosition = getDefaultScrollJumpPosition();
  let left = window.innerWidth - defaultPosition.right - SCROLL_JUMP_WIDTH;
  let top = window.innerHeight - defaultPosition.bottom - SCROLL_JUMP_HEIGHT;
  const avoidRects = getFloatingAvoidRects(navigatorCollapsed);

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const rect of avoidRects) {
      if (!rectsOverlap(left, top, SCROLL_JUMP_WIDTH, SCROLL_JUMP_HEIGHT, rect)) {
        continue;
      }

      const leftCandidate = rect.left - SCROLL_JUMP_WIDTH - FLOATING_CONTROL_GAP;
      if (leftCandidate >= 8 && leftCandidate < left) {
        left = leftCandidate;
        changed = true;
        continue;
      }

      const topCandidate = rect.top - SCROLL_JUMP_HEIGHT - FLOATING_CONTROL_GAP;
      if (topCandidate >= 8 && topCandidate < top) {
        top = topCandidate;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  left = Math.min(Math.max(8, left), window.innerWidth - SCROLL_JUMP_WIDTH - 8);
  top = Math.min(Math.max(8, top), window.innerHeight - SCROLL_JUMP_HEIGHT - 8);

  return {
    right: Math.round(window.innerWidth - left - SCROLL_JUMP_WIDTH),
    bottom: Math.round(window.innerHeight - top - SCROLL_JUMP_HEIGHT)
  };
}

function areTableOverlaysEqual(first: TableCopyOverlay[], second: TableCopyOverlay[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((overlay, index) => {
    const candidate = second[index];
    return Boolean(candidate) &&
      overlay.id === candidate.id &&
      overlay.table === candidate.table &&
      overlay.top === candidate.top &&
      overlay.left === candidate.left &&
      overlay.menuAlign === candidate.menuAlign &&
      overlay.rowCount === candidate.rowCount &&
      overlay.columnCount === candidate.columnCount &&
      overlay.index === candidate.index &&
      overlay.total === candidate.total;
  });
}

function getTableCellText(cell: HTMLTableCellElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, [role='button'], svg, script, style, noscript").forEach((node) => node.remove());
  return normalizeText(clone.innerText || clone.textContent || "");
}

function tableToMatrix(table: HTMLTableElement): string[][] {
  const matrix: string[][] = [];
  const rows = Array.from(table.rows);

  rows.forEach((row, rowIndex) => {
    matrix[rowIndex] ??= [];
    let columnIndex = 0;

    for (const cell of Array.from(row.cells)) {
      while (matrix[rowIndex][columnIndex] !== undefined) {
        columnIndex += 1;
      }

      const text = getTableCellText(cell);
      const colSpan = Math.max(1, cell.colSpan || 1);
      const rowSpan = Math.max(1, cell.rowSpan || 1);

      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        matrix[targetRow] ??= [];
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          matrix[targetRow][columnIndex + columnOffset] = rowOffset === 0 && columnOffset === 0 ? text : "";
        }
      }

      columnIndex += colSpan;
    }
  });

  const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  return matrix
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ""));
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
}

function matrixToMarkdown(matrix: string[][]): string {
  if (matrix.length === 0) {
    return "";
  }

  const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const padded = matrix.map((row) => Array.from({ length: columnCount }, (_, index) => escapeMarkdownCell(row[index] ?? "")));
  const header = padded[0];
  const separator = Array.from({ length: columnCount }, () => "---");
  const body = padded.slice(1);
  return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function normalizePlainTableCell(value: string): string {
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ").trim();
}

function matrixToTsv(matrix: string[][]): string {
  return matrix.map((row) => row.map(normalizePlainTableCell).join("\t")).join("\n");
}

function matrixToCsv(matrix: string[][]): string {
  return matrix
    .map((row) =>
      row
        .map((cell) => {
          const value = normalizePlainTableCell(cell);
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(",")
    )
    .join("\n");
}

function matrixToHtml(matrix: string[][]): string {
  const rows = matrix.map((row) =>
    `<tr>${row.map((cell) => `<td>${cell
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</td>`).join("")}</tr>`
  );
  return `<table>${rows.join("")}</table>`;
}

function tableToClipboardHtml(table: HTMLTableElement): string {
  const clone = table.cloneNode(true) as HTMLTableElement;
  clone.querySelectorAll("button, [role='button'], svg, script, style, noscript").forEach((node) => node.remove());
  return clone.outerHTML;
}

function getMatrixClipboardText(matrix: string[][], format: TableCopyFormat): string {
  if (format === "tsv") {
    return matrixToTsv(matrix);
  }

  if (format === "csv") {
    return matrixToCsv(matrix);
  }

  if (format === "html") {
    return matrixToTsv(matrix);
  }

  return matrixToMarkdown(matrix);
}

function getTableClipboardText(table: HTMLTableElement, format: TableCopyFormat): string {
  return getMatrixClipboardText(tableToMatrix(table), format);
}

async function writeTextWithExecCommand(text: string): Promise<void> {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("execCommand copy failed");
    }
  } finally {
    textarea.remove();
  }
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy copy path below.
    }
  }

  await writeTextWithExecCommand(text);
}

async function writeHtmlToClipboard(html: string, plainText: string): Promise<void> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" })
        })
      ]);
      return;
    } catch {
      // Some Chrome surfaces expose ClipboardItem but still reject HTML writes.
    }
  }

  await writeTextToClipboard(plainText);
}

async function copyTableToClipboard(table: HTMLTableElement, format: TableCopyFormat): Promise<void> {
  const text = getTableClipboardText(table, format);
  if (format === "html") {
    await writeHtmlToClipboard(tableToClipboardHtml(table), text);
    return;
  }

  await writeTextToClipboard(text);
}

async function copyMatrixToClipboard(matrix: string[][], format: TableCopyFormat): Promise<void> {
  const text = getMatrixClipboardText(matrix, format);
  if (format === "html") {
    await writeHtmlToClipboard(matrixToHtml(matrix), text);
    return;
  }

  await writeTextToClipboard(text);
}

function downloadMatrixCsv(matrix: string[][], filename: string) {
  const blob = new Blob([matrixToCsv(matrix)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getTableCellCoordinate(cell: HTMLTableCellElement): TableCellCoordinate | null {
  const table = cell.closest("table");
  const row = cell.closest("tr");
  if (!(table instanceof HTMLTableElement) || !(row instanceof HTMLTableRowElement)) {
    return null;
  }

  return {
    tableId: getTableCopyId(table),
    rowIndex: row.rowIndex,
    columnIndex: cell.cellIndex
  };
}

function getHoveredMatrix(table: HTMLTableElement, coordinate: TableCellCoordinate | null, axis: "row" | "column"): string[][] {
  if (!coordinate || coordinate.tableId !== getTableCopyId(table)) {
    return [];
  }

  const matrix = tableToMatrix(table);
  if (axis === "row") {
    return matrix[coordinate.rowIndex] ? [matrix[coordinate.rowIndex]] : [];
  }

  return matrix.map((row) => [row[coordinate.columnIndex] ?? ""]).filter((row) => row.some((cell) => cell.trim()));
}

function normalizeTableSelection(selection: TableAreaSelection): TableAreaSelection {
  return {
    tableId: selection.tableId,
    startRow: Math.min(selection.startRow, selection.endRow),
    endRow: Math.max(selection.startRow, selection.endRow),
    startColumn: Math.min(selection.startColumn, selection.endColumn),
    endColumn: Math.max(selection.startColumn, selection.endColumn)
  };
}

function getSelectionMatrix(table: HTMLTableElement, selection: TableAreaSelection | null): string[][] {
  if (!selection || selection.tableId !== getTableCopyId(table)) {
    return [];
  }

  const normalized = normalizeTableSelection(selection);
  return tableToMatrix(table)
    .slice(normalized.startRow, normalized.endRow + 1)
    .map((row) => row.slice(normalized.startColumn, normalized.endColumn + 1))
    .filter((row) => row.some((cell) => cell.trim()));
}

function clearTableSelectionMarks() {
  document
    .querySelectorAll<HTMLElement>("[data-cnav-table-selected]")
    .forEach((cell) => cell.removeAttribute("data-cnav-table-selected"));
}

function applyTableSelectionMarks(table: HTMLTableElement, selection: TableAreaSelection | null) {
  clearTableSelectionMarks();
  if (!selection || selection.tableId !== getTableCopyId(table)) {
    return;
  }

  const normalized = normalizeTableSelection(selection);
  for (const row of Array.from(table.rows)) {
    for (const cell of Array.from(row.cells)) {
      const selected =
        row.rowIndex >= normalized.startRow &&
        row.rowIndex <= normalized.endRow &&
        cell.cellIndex >= normalized.startColumn &&
        cell.cellIndex <= normalized.endColumn;
      if (selected) {
        cell.setAttribute("data-cnav-table-selected", "true");
      }
    }
  }
}

function TableCopyLayer({
  theme,
  language,
  navigatorCollapsed
}: {
  theme: ColorTheme;
  language: AppLanguage;
  navigatorCollapsed: boolean;
}) {
  const labels = useMemo(() => getTableCopyLabels(language), [language]);
  const [overlays, setOverlays] = useState<TableCopyOverlay[]>([]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [preferredFormat, setPreferredFormat] = useState<TableCopyFormat>(() => readPreferredTableCopyFormat());
  const [copied, setCopied] = useState<{ id: string; format: TableCopyFormat } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<TableCellCoordinate | null>(null);
  const [selectionModeTableId, setSelectionModeTableId] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<TableAreaSelection | null>(null);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const selectionStartRef = useRef<TableCellCoordinate | null>(null);

  const updateOverlays = useCallback(() => {
    const avoidRects = getFloatingAvoidRects(navigatorCollapsed);
    const tables = findCopyableTables();
    const nextOverlays = tables
      .map((table, index) => getTableCopyOverlay(table, avoidRects, index + 1, tables.length))
      .filter((overlay): overlay is TableCopyOverlay => Boolean(overlay));

    setOverlays((current) => (areTableOverlaysEqual(current, nextOverlays) ? current : nextOverlays));
  }, [navigatorCollapsed]);

  useEffect(() => {
    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateOverlays();
      });
    };

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    scheduleUpdate();
    const interval = window.setInterval(scheduleUpdate, 1800);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [updateOverlays]);

  useEffect(() => {
    if (!menuId) {
      return undefined;
    }

    const closeMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".cnav-table-copy-toolbar")) {
        setMenuId(null);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuId(null);
      }
    };

    document.addEventListener("pointerdown", closeMenu, true);
    document.addEventListener("keydown", closeOnEscape, true);

    return () => {
      document.removeEventListener("pointerdown", closeMenu, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [menuId]);

  useEffect(() => {
    const trackHoveredCell = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const cell = target?.closest("td, th");
      if (!(cell instanceof HTMLTableCellElement)) {
        return;
      }

      const coordinate = getTableCellCoordinate(cell);
      if (coordinate) {
        setHoveredCell(coordinate);
      }
    };

    document.addEventListener("pointerover", trackHoveredCell, true);
    return () => document.removeEventListener("pointerover", trackHoveredCell, true);
  }, []);

  useEffect(() => {
    if (!selectionModeTableId) {
      selectionStartRef.current = null;
      return undefined;
    }

    const cancelSelection = () => {
      selectionStartRef.current = null;
      setSelectionModeTableId(null);
      setActiveSelection(null);
      clearTableSelectionMarks();
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(`#${ROOT_ID}`)) {
        return;
      }

      const cell = target?.closest("td, th");
      if (!(cell instanceof HTMLTableCellElement)) {
        cancelSelection();
        return;
      }

      const coordinate = getTableCellCoordinate(cell);
      if (!coordinate || coordinate.tableId !== selectionModeTableId) {
        cancelSelection();
        return;
      }

      event.preventDefault();
      selectionStartRef.current = coordinate;
      setActiveSelection({
        tableId: coordinate.tableId,
        startRow: coordinate.rowIndex,
        startColumn: coordinate.columnIndex,
        endRow: coordinate.rowIndex,
        endColumn: coordinate.columnIndex
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      const start = selectionStartRef.current;
      if (!start) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const cell = target?.closest("td, th");
      if (!(cell instanceof HTMLTableCellElement)) {
        return;
      }

      const coordinate = getTableCellCoordinate(cell);
      if (!coordinate || coordinate.tableId !== start.tableId) {
        return;
      }

      setActiveSelection({
        tableId: start.tableId,
        startRow: start.rowIndex,
        startColumn: start.columnIndex,
        endRow: coordinate.rowIndex,
        endColumn: coordinate.columnIndex
      });
    };

    const handlePointerUp = () => {
      selectionStartRef.current = null;
      setSelectionModeTableId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelSelection();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerUp, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", cancelSelection, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
      document.removeEventListener("pointercancel", handlePointerUp, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", cancelSelection, true);
    };
  }, [selectionModeTableId]);

  useEffect(() => {
    const table = overlays.find((overlay) => overlay.id === activeSelection?.tableId)?.table;
    if (!table) {
      clearTableSelectionMarks();
      return;
    }

    applyTableSelectionMarks(table, activeSelection);
  }, [activeSelection, overlays]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
      clearTableSelectionMarks();
    };
  }, []);

  const copyOverlay = async (overlay: TableCopyOverlay, format: TableCopyFormat) => {
    setPreferredFormat(format);
    writePreferredTableCopyFormat(format);

    try {
      await copyTableToClipboard(overlay.table, format);
      setCopied({ id: overlay.id, format });
      setMenuId(null);
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(null), 1400);
    } catch (error) {
      console.warn("[GPT聊天导航器] 复制表格失败：", error);
    }
  };

  const copyMatrix = async (overlay: TableCopyOverlay, matrix: string[][], format: TableCopyFormat) => {
    if (matrix.length === 0) {
      return;
    }

    setPreferredFormat(format);
    writePreferredTableCopyFormat(format);

    try {
      await copyMatrixToClipboard(matrix, format);
      setCopied({ id: overlay.id, format });
      setMenuId(null);
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => setCopied(null), 1400);
    } catch (error) {
      console.warn("[GPT聊天导航器] 复制表格区域失败：", error);
    }
  };

  const toggleAreaSelection = (overlay: TableCopyOverlay) => {
    if (selectionModeTableId === overlay.id || activeSelection?.tableId === overlay.id) {
      selectionStartRef.current = null;
      setSelectionModeTableId(null);
      setActiveSelection(null);
      clearTableSelectionMarks();
      return;
    }

    setMenuId(null);
    setActiveSelection(null);
    setSelectionModeTableId(overlay.id);
  };

  const jumpToSiblingTable = (overlay: TableCopyOverlay, offset: number) => {
    const nextIndex = overlays.findIndex((candidate) => candidate.id === overlay.id) + offset;
    const nextOverlay = overlays[nextIndex];
    if (!nextOverlay) {
      return;
    }

    jumpToElement(nextOverlay.table, true);
    setMenuId(nextOverlay.id);
  };

  if (overlays.length === 0) {
    return null;
  }

  return (
    <div className="cnav-table-copy-layer" data-theme={theme}>
      {overlays.map((overlay) => {
        const isCopied = copied?.id === overlay.id;
        const activeFormat = isCopied ? copied.format : preferredFormat;
        const title = `${isCopied ? labels.copied : labels.copy} · ${labels.formats[activeFormat]}`;
        const rowMatrix = getHoveredMatrix(overlay.table, hoveredCell, "row");
        const columnMatrix = getHoveredMatrix(overlay.table, hoveredCell, "column");
        const selectionMatrix = getSelectionMatrix(overlay.table, activeSelection);
        const canJumpPrevious = overlays.findIndex((candidate) => candidate.id === overlay.id) > 0;
        const canJumpNext = overlays.findIndex((candidate) => candidate.id === overlay.id) < overlays.length - 1;

        return (
          <div
            className={`cnav-table-copy-toolbar is-menu-${overlay.menuAlign}${menuId === overlay.id ? " is-open" : ""}${isCopied ? " is-copied" : ""}`}
            key={overlay.id}
            style={{ left: overlay.left, top: overlay.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="cnav-table-copy-button"
              type="button"
              title={title}
              aria-label={title}
              onClick={() => void copyOverlay(overlay, preferredFormat)}
            >
              {isCopied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
            </button>
            <span className="cnav-table-copy-count">
              <small>{labels.table}</small>
              <strong>{`${overlay.index}/${overlay.total}`}</strong>
            </span>
            <button
              className="cnav-table-copy-menu-button"
              type="button"
              title={labels.menu}
              aria-label={labels.menu}
              aria-expanded={menuId === overlay.id}
              onClick={() => setMenuId((current) => (current === overlay.id ? null : overlay.id))}
            >
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {isCopied ? (
              <span className="cnav-table-copy-toast">
                {labels.copied} · {labels.formats[activeFormat]}
              </span>
            ) : null}
            {menuId === overlay.id ? (
              <div className="cnav-table-copy-menu" role="menu">
                <div className="cnav-table-copy-meta">
                  <Table2 size={13} aria-hidden="true" />
                  <span>{`${labels.table} ${overlay.index}/${overlay.total} · ${overlay.rowCount} ${labels.rows} x ${overlay.columnCount} ${labels.columns}`}</span>
                </div>
                <button type="button" role="menuitem" onClick={() => void copyOverlay(overlay, preferredFormat)}>
                  <Copy size={13} aria-hidden="true" />
                  <span>{labels.fullTable}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={rowMatrix.length === 0}
                  onClick={() => void copyMatrix(overlay, rowMatrix, preferredFormat)}
                >
                  <Table2 size={13} aria-hidden="true" />
                  <span>{labels.currentRow}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={columnMatrix.length === 0}
                  onClick={() => void copyMatrix(overlay, columnMatrix, preferredFormat)}
                >
                  <Table2 size={13} aria-hidden="true" />
                  <span>{labels.currentColumn}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={selectionMatrix.length === 0}
                  onClick={() => void copyMatrix(overlay, selectionMatrix, preferredFormat)}
                >
                  <Copy size={13} aria-hidden="true" />
                  <span>{labels.selectedArea}</span>
                </button>
                <button type="button" role="menuitem" onClick={() => toggleAreaSelection(overlay)}>
                  <Table2 size={13} aria-hidden="true" />
                  <span>{selectionModeTableId === overlay.id || activeSelection?.tableId === overlay.id ? labels.cancelSelection : labels.selectArea}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => downloadMatrixCsv(tableToMatrix(overlay.table), `table-${overlay.index}.csv`)}
                >
                  <ArrowDownToLine size={13} aria-hidden="true" />
                  <span>{labels.downloadCsv}</span>
                </button>
                <div className="cnav-table-copy-nav">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canJumpPrevious}
                    onClick={() => jumpToSiblingTable(overlay, -1)}
                  >
                    <ChevronRight size={13} aria-hidden="true" />
                    <span>{labels.previousTable}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!canJumpNext}
                    onClick={() => jumpToSiblingTable(overlay, 1)}
                  >
                    <ChevronRight size={13} aria-hidden="true" />
                    <span>{labels.nextTable}</span>
                  </button>
                </div>
                {TABLE_COPY_FORMATS.map((format) => (
                  <button
                    className={format === preferredFormat ? "is-active" : ""}
                    type="button"
                    role="menuitem"
                    key={format}
                    onClick={() => void copyOverlay(overlay, format)}
                  >
                    {format === "html" ? (
                      <FileText size={13} aria-hidden="true" />
                    ) : (
                      <Table2 size={13} aria-hidden="true" />
                    )}
                    <span>{labels.formats[format]}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface CodeBlockOverlay {
  id: string;
  pre: HTMLPreElement;
  top: number;
  left: number;
  language: string;
  filename: string;
  lineCount: number;
  isDiff: boolean;
}

interface CodeBlockLabels {
  copyName: string;
  copyMarkdown: string;
  download: string;
  collapse: string;
  expand: string;
  copied: string;
}

const CODE_BLOCK_TOOLBAR_WIDTH = 156;
const CODE_BLOCK_TOOLBAR_HEIGHT = 32;
const codeBlockIdRegistry = new WeakMap<HTMLPreElement, string>();
let nextCodeBlockIndex = 1;

function getCodeBlockLabels(language: AppLanguage): CodeBlockLabels {
  if (language === "en") {
    return {
      copyName: "Copy filename",
      copyMarkdown: "Copy as Markdown",
      download: "Download file",
      collapse: "Collapse",
      expand: "Expand",
      copied: "Copied"
    };
  }

  if (language === "zh-TW") {
    return {
      copyName: "複製文件名",
      copyMarkdown: "複製為 Markdown",
      download: "下載文件",
      collapse: "折疊",
      expand: "展開",
      copied: "已複製"
    };
  }

  return {
    copyName: "复制文件名",
    copyMarkdown: "复制为 Markdown",
    download: "下载文件",
    collapse: "折叠",
    expand: "展开",
    copied: "已复制"
  };
}

function getCodeBlockId(pre: HTMLPreElement): string {
  const existing = codeBlockIdRegistry.get(pre);
  if (existing) {
    return existing;
  }

  const id = `cnav-code-${nextCodeBlockIndex.toString(36)}`;
  nextCodeBlockIndex += 1;
  codeBlockIdRegistry.set(pre, id);
  return id;
}

function isCopyableCodeBlock(pre: HTMLPreElement): boolean {
  if (pre.closest(`#${ROOT_ID}`)) {
    return false;
  }

  const rect = pre.getBoundingClientRect();
  if (rect.width < 120 || rect.height < 44 || rect.bottom < 56 || rect.top > window.innerHeight - 24) {
    return false;
  }

  const text = extractCodeBlockText(pre);
  if (!text.trim()) {
    return false;
  }

  const style = window.getComputedStyle(pre);
  return style.display !== "none" && style.visibility !== "hidden";
}

function findCopyableCodeBlocks(): HTMLPreElement[] {
  return safeQueryAll("main pre")
    .filter((element): element is HTMLPreElement => element instanceof HTMLPreElement)
    .filter(isCopyableCodeBlock);
}

function extractCodeBlockText(pre: HTMLPreElement): string {
  const clone = pre.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("button, [role='button'], svg, script, style, noscript, .cnav-code-toolbar")
    .forEach((node) => node.remove());
  const diffLines = Array.from(clone.querySelectorAll<HTMLElement>(".cnav-diff-add, .cnav-diff-remove, .cnav-diff-line"));
  if (diffLines.length > 0) {
    return diffLines.map((line) => line.textContent || "").join("\n").trimEnd();
  }

  const code = clone.querySelector("code");
  return (code?.innerText || clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function detectCodeLanguage(pre: HTMLPreElement): string {
  const candidates = [
    pre.getAttribute("data-language"),
    pre.querySelector("code")?.getAttribute("data-language"),
    pre.querySelector("code")?.className,
    pre.className
  ].filter(Boolean).join(" ");

  const match = candidates.match(/(?:language-|lang-)([a-z0-9_+#.-]+)/i);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }

  const header = normalizeText(pre.parentElement?.querySelector<HTMLElement>("[data-language], [class*='language']")?.textContent || "");
  if (/typescript|tsx/i.test(header)) {
    return "ts";
  }
  if (/javascript|jsx/i.test(header)) {
    return "js";
  }
  if (/python/i.test(header)) {
    return "py";
  }
  if (/json/i.test(header)) {
    return "json";
  }

  return "";
}

function getCodeExtension(language: string): string {
  const normalized = language.toLowerCase();
  const extensions: Record<string, string> = {
    typescript: "ts",
    ts: "ts",
    tsx: "tsx",
    javascript: "js",
    js: "js",
    jsx: "jsx",
    python: "py",
    py: "py",
    json: "json",
    markdown: "md",
    md: "md",
    bash: "sh",
    shell: "sh",
    sh: "sh",
    css: "css",
    html: "html",
    diff: "diff",
    patch: "diff",
    yaml: "yml",
    yml: "yml"
  };
  return extensions[normalized] || "txt";
}

function detectCodeFilename(pre: HTMLPreElement, index: number, language: string): string {
  const extension = getCodeExtension(language);
  const nearbyText = [
    pre.previousElementSibling?.textContent || "",
    pre.parentElement?.firstElementChild?.textContent || "",
    pre.parentElement?.textContent?.slice(0, 180) || ""
  ].join(" ");
  const filenameMatch = nearbyText.match(/\b[\w.-]+\.(?:tsx?|jsx?|py|json|md|sh|bash|css|html|ya?ml|diff|patch)\b/i);
  return filenameMatch?.[0] || `snippet-${index}.${extension}`;
}

function isDiffCodeBlock(language: string, text: string): boolean {
  if (/^(diff|patch)$/i.test(language)) {
    return true;
  }

  const lines = text.split("\n").slice(0, 80);
  const changedLines = lines.filter((line) => /^[+-](?![+-]{2})/.test(line.trimStart())).length;
  return changedLines >= 3;
}

function decorateDiffCodeBlock(pre: HTMLPreElement, language: string, text: string) {
  const isDiff = isDiffCodeBlock(language, text);
  pre.toggleAttribute("data-cnav-code-diff", isDiff);
  if (!isDiff || pre.getAttribute("data-cnav-diff-decorated") === "true") {
    return;
  }

  const code = pre.querySelector("code");
  if (!code || code.children.length > 0) {
    return;
  }

  code.textContent = "";
  for (const line of text.split("\n")) {
    const span = document.createElement("span");
    span.className = line.trimStart().startsWith("+")
      ? "cnav-diff-add"
      : line.trimStart().startsWith("-")
        ? "cnav-diff-remove"
        : "cnav-diff-line";
    span.textContent = line || " ";
    code.appendChild(span);
  }
  pre.setAttribute("data-cnav-diff-decorated", "true");
}

function getCodeBlockOverlay(
  pre: HTMLPreElement,
  avoidRects: DOMRect[],
  index: number
): CodeBlockOverlay | null {
  const rect = pre.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const visibleTop = Math.max(rect.top, 76);
  const visibleBottom = Math.min(rect.bottom, viewportHeight - 72);
  let visibleRight = Math.min(rect.right, viewportWidth - 18);
  const visibleLeft = Math.max(rect.left, 8);

  for (const avoidRect of avoidRects) {
    if (visibleRight > avoidRect.left - 8 && visibleBottom > avoidRect.top && visibleTop < avoidRect.bottom) {
      visibleRight = Math.min(visibleRight, avoidRect.left - 8);
    }
  }

  if (visibleBottom <= visibleTop + 24 || visibleRight <= visibleLeft + 58) {
    return null;
  }

  const text = extractCodeBlockText(pre);
  const language = detectCodeLanguage(pre);
  const id = getCodeBlockId(pre);
  const top = Math.round(Math.min(Math.max(visibleTop + 6, 76), visibleBottom - CODE_BLOCK_TOOLBAR_HEIGHT));
  const left = shiftLeftAwayFromRects(
    Math.round(visibleRight - CODE_BLOCK_TOOLBAR_WIDTH),
    top,
    CODE_BLOCK_TOOLBAR_WIDTH,
    CODE_BLOCK_TOOLBAR_HEIGHT,
    Math.round(visibleLeft),
    avoidRects
  );

  decorateDiffCodeBlock(pre, language, text);

  return {
    id,
    pre,
    top,
    left: Math.round(left),
    language,
    filename: detectCodeFilename(pre, index, language),
    lineCount: text.split("\n").length,
    isDiff: isDiffCodeBlock(language, text)
  };
}

function areCodeOverlaysEqual(first: CodeBlockOverlay[], second: CodeBlockOverlay[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((overlay, index) => {
    const candidate = second[index];
    return Boolean(candidate) &&
      overlay.id === candidate.id &&
      overlay.pre === candidate.pre &&
      overlay.top === candidate.top &&
      overlay.left === candidate.left &&
      overlay.filename === candidate.filename &&
      overlay.lineCount === candidate.lineCount &&
      overlay.isDiff === candidate.isDiff;
  });
}

function downloadCodeFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CodeBlockLayer({
  theme,
  language,
  navigatorCollapsed
}: {
  theme: ColorTheme;
  language: AppLanguage;
  navigatorCollapsed: boolean;
}) {
  const labels = useMemo(() => getCodeBlockLabels(language), [language]);
  const [overlays, setOverlays] = useState<CodeBlockOverlay[]>([]);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, true>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | undefined>(undefined);

  const updateOverlays = useCallback(() => {
    const avoidRects = getFloatingAvoidRects(navigatorCollapsed);
    const nextOverlays = findCopyableCodeBlocks()
      .map((pre, index) => getCodeBlockOverlay(pre, avoidRects, index + 1))
      .filter((overlay): overlay is CodeBlockOverlay => Boolean(overlay));

    setOverlays((current) => (areCodeOverlaysEqual(current, nextOverlays) ? current : nextOverlays));
  }, [navigatorCollapsed]);

  useEffect(() => {
    let frame = 0;
    const scheduleUpdate = () => {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateOverlays();
      });
    };

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    scheduleUpdate();
    const interval = window.setInterval(scheduleUpdate, 1800);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [updateOverlays]);

  useEffect(() => {
    for (const overlay of overlays) {
      overlay.pre.toggleAttribute("data-cnav-code-collapsed", Boolean(collapsedBlocks[overlay.id]));
      overlay.pre.toggleAttribute("data-cnav-code-long", overlay.lineCount > 40);
    }
  }, [collapsedBlocks, overlays]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
      for (const overlay of overlays) {
        overlay.pre.removeAttribute("data-cnav-code-collapsed");
        overlay.pre.removeAttribute("data-cnav-code-long");
      }
    };
  }, [overlays]);

  const showCopied = (id: string) => {
    setCopiedId(id);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopiedId(null), 1300);
  };

  const copyFilename = async (overlay: CodeBlockOverlay) => {
    await writeTextToClipboard(overlay.filename);
    showCopied(overlay.id);
  };

  const copyMarkdown = async (overlay: CodeBlockOverlay) => {
    const text = extractCodeBlockText(overlay.pre);
    const fenceLanguage = overlay.language || getCodeExtension(overlay.language);
    await writeTextToClipboard(`\`\`\`${fenceLanguage}\n${text}\n\`\`\``);
    showCopied(overlay.id);
  };

  if (overlays.length === 0) {
    return null;
  }

  return (
    <div className="cnav-code-layer" data-theme={theme}>
      {overlays.map((overlay) => {
        const isCollapsed = Boolean(collapsedBlocks[overlay.id]);
        const isCopied = copiedId === overlay.id;
        return (
          <div
            className={`cnav-code-toolbar${isCopied ? " is-copied" : ""}${overlay.lineCount > 40 ? " is-long" : ""}`}
            key={overlay.id}
            style={{ left: overlay.left, top: overlay.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              title={labels.copyName}
              aria-label={labels.copyName}
              onClick={() => void copyFilename(overlay)}
            >
              <FileText size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              title={labels.copyMarkdown}
              aria-label={labels.copyMarkdown}
              onClick={() => void copyMarkdown(overlay)}
            >
              {isCopied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            </button>
            <button
              type="button"
              title={labels.download}
              aria-label={labels.download}
              onClick={() => downloadCodeFile(overlay.filename, extractCodeBlockText(overlay.pre))}
            >
              <ArrowDownToLine size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              title={isCollapsed ? labels.expand : labels.collapse}
              aria-label={isCollapsed ? labels.expand : labels.collapse}
              onClick={() =>
                setCollapsedBlocks((current) => {
                  const next = { ...current };
                  if (next[overlay.id]) {
                    delete next[overlay.id];
                  } else {
                    next[overlay.id] = true;
                  }
                  return next;
                })
              }
            >
              <Minimize2 size={13} aria-hidden="true" />
            </button>
            {isCopied ? <span>{labels.copied}</span> : null}
          </div>
        );
      })}
    </div>
  );
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
  try {
    return getAdapter().detectModelLabel();
  } catch {
    return "";
  }
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

function canFallbackToPageFetch(url: string): boolean {
  try {
    return new URL(url).hostname === "raw.githubusercontent.com";
  } catch {
    return false;
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs = 8000): Promise<string> {
  let backgroundError: unknown;
  try {
    return await fetchTextFromBackground(url, timeoutMs);
  } catch (error) {
    backgroundError = error;
    // Fall back to page fetch for CORS-enabled endpoints such as raw GitHub.
  }

  if (!canFallbackToPageFetch(url)) {
    throw backgroundError instanceof Error ? backgroundError : new Error("Background fetch failed");
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

async function fetchRemoteCompatRules(): Promise<ChatGptDomRule[]> {
  const text = await fetchTextWithTimeout(CHATGPT_COMPAT_RULES_URL, 8000);
  const parsed = JSON.parse(text) as unknown;
  const rules = normalizeCompatRulesPayload(parsed);
  if (rules.length === 0) {
    throw new Error("Remote compatibility rules are empty or invalid");
  }

  return rules;
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

function buildTokenDetailEntries(entries: MessageMapEntry[], items: NavigatorItem[]): TokenDetailEntry[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return [...entries]
    .sort((a, b) => b.tokenCount - a.tokenCount)
    .slice(0, 5)
    .map((entry) => {
      const item = itemById.get(entry.id);
      return {
        id: entry.id,
        role: entry.role,
        label: item ? getNavigatorDisplayTitle(item) : compactPreview(entry.text, 56),
        tokenCount: entry.tokenCount,
        codeTokens: entry.codeTokens,
        tableTokens: entry.tableTokens,
        turnIndex: item?.turnIndex ?? entry.turnIndex,
        heatLevel: Math.max(item?.heatLevel ?? 0, entry.heatLevel) as HeatLevel
      };
    });
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
  const [isOpening, setIsOpening] = useState(false);
  const [items, setItems] = useState<NavigatorItem[]>([]);
  const [mapEntries, setMapEntries] = useState<MessageMapEntry[]>([]);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, true>>({});
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, true>>({});
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingNote, setEditingNote] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ColorTheme>(detectPageTheme);
  const [resizeFrame, setResizeFrame] = useState<ResizeFrame | null>(null);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);
  const [scrollJumpPosition, setScrollJumpPosition] = useState<FloatingControlPosition>(() =>
    getDefaultScrollJumpPosition()
  );
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
  const [adapterHealth, setAdapterHealth] = useState<AdapterHealth>(() => createDefaultAdapterHealth());
  const [detectedModelLabel, setDetectedModelLabel] = useState("");
  const [compatRulesSyncStatus, setCompatRulesSyncStatus] = useState<CompatRulesSyncStatus>("idle");
  const [compatRuleCount, setCompatRuleCount] = useState(0);
  const favoritesRef = useRef(favorites);
  const groupCollapsedRef = useRef(groupCollapsed);
  const itemsRef = useRef(items);
  const mapEntriesRef = useRef(mapEntries);
  const pageKeyRef = useRef(pageKey);
  const settingsRef = useRef(settings);
  const modelCatalogRef = useRef(modelCatalog);
  const resizeFrameRef = useRef(resizeFrame);
  const listRef = useRef<HTMLDivElement | null>(null);
  const revealLatestOnNextPaintRef = useRef(true);
  const openingTimerRef = useRef<number | undefined>(undefined);
  const settingsSaveTimerRef = useRef<number | undefined>(undefined);
  const settingsPreviewFrameRef = useRef<number | undefined>(undefined);
  const pendingPreviewSettingsRef = useRef<NavigatorSettings | null>(null);
  const lastRecordSignatureRef = useRef("");
  const scanTimerRef = useRef<number | undefined>(undefined);
  const scanIdleWorkRef = useRef<ScheduledIdleWork | null>(null);
  const scanRunningRef = useRef(false);
  const scanQueuedRef = useRef(false);
  const lastScanScrollYRef = useRef(window.scrollY);
  const forceDomRebuildOnNextScanRef = useRef(true);

  favoritesRef.current = favorites;
  groupCollapsedRef.current = groupCollapsed;
  itemsRef.current = items;
  mapEntriesRef.current = mapEntries;
  pageKeyRef.current = pageKey;
  settingsRef.current = settings;
  modelCatalogRef.current = modelCatalog;
  resizeFrameRef.current = resizeFrame;

  const scan = useCallback(async () => {
    if (scanRunningRef.current) {
      scanQueuedRef.current = true;
      return;
    }

    scanRunningRef.current = true;
    try {
      const modelLabel = detectModelLabel();
      const { budget } = getTokenBudget(settingsRef.current, modelLabel, modelCatalogRef.current);
      const { items: nextItems, mapEntries: nextMapEntries, health: nextHealth } = buildNavigatorData(
        favoritesRef.current,
        budget
      );
      const shouldRebuildFromDom = forceDomRebuildOnNextScanRef.current || itemsRef.current.length === 0;
      const merged = shouldRebuildFromDom
        ? {
            items: normalizeNavigatorOrder(
              nextItems.map((item) => applyFavorite({ ...item, mounted: true }, favoritesRef.current))
            ),
            mapEntries: normalizeMapEntryOrder(nextMapEntries.map((entry) => ({ ...entry, mounted: true })))
          }
        : mergeNavigatorData(
            itemsRef.current,
            mapEntriesRef.current,
            nextItems,
            nextMapEntries,
            favoritesRef.current,
            lastScanScrollYRef.current
          );
      forceDomRebuildOnNextScanRef.current = false;
      lastScanScrollYRef.current = window.scrollY;
      itemsRef.current = merged.items;
      mapEntriesRef.current = merged.mapEntries;
      setItems(merged.items);
      setMapEntries(merged.mapEntries);
      setAdapterHealth(nextHealth);
      setDetectedModelLabel((current) => (current === modelLabel ? current : modelLabel));
      const nextSignature = makeRecordSignature(merged.items, favoritesRef.current, groupCollapsedRef.current);
      if (nextSignature !== lastRecordSignatureRef.current) {
        lastRecordSignatureRef.current = nextSignature;
        await persistRecord(
          settingsRef.current,
          pageKeyRef.current,
          merged.items,
          favoritesRef.current,
          nextHealth,
          groupCollapsedRef.current
        );
      }
    } catch (error) {
      console.warn("[GPT聊天导航器] 扫描当前页面失败，保留上一轮数据：", error);
      setAdapterHealth((current) => ({
        ...current,
        status: current.messageCount > 0 ? "degraded" : "unsupported",
        reason: error instanceof Error ? error.message : "Scan failed before the page could be indexed."
      }));
    } finally {
      scanRunningRef.current = false;
      if (scanQueuedRef.current) {
        scanQueuedRef.current = false;
        window.setTimeout(() => {
          scanIdleWorkRef.current = requestIdleWork(() => {
            scanIdleWorkRef.current = null;
            void scan();
          });
        }, SCAN_DEBOUNCE_MS);
      }
    }
  }, []);

  const scheduleScan = useCallback((delay = SCAN_DEBOUNCE_MS) => {
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current);
    }
    cancelIdleWork(scanIdleWorkRef.current);
    scanIdleWorkRef.current = null;

    scanTimerRef.current = window.setTimeout(() => {
      scanTimerRef.current = undefined;
      scanIdleWorkRef.current = requestIdleWork(() => {
        scanIdleWorkRef.current = null;
        void scan();
      });
    }, delay);
  }, [scan]);

  const applySettingsNow = (nextSettings: NavigatorSettings) => {
    if (settingsPreviewFrameRef.current) {
      window.cancelAnimationFrame(settingsPreviewFrameRef.current);
      settingsPreviewFrameRef.current = undefined;
    }

    pendingPreviewSettingsRef.current = null;
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    applyChatTypography(nextSettings);
  };

  const applySettingsPatch = (patch: Partial<NavigatorSettings>) => {
    const nextSettings = normalizeSettings({ ...settingsRef.current, ...patch });
    applySettingsNow(nextSettings);
    return nextSettings;
  };

  const scheduleSettingsSave = (settingsToSave = settingsRef.current, delay = 450) => {
    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current);
    }

    settingsSaveTimerRef.current = window.setTimeout(() => {
      settingsSaveTimerRef.current = undefined;
      void saveSettings(settingsToSave);
    }, delay);
  };

  const flushSettingsSave = () => {
    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current);
      settingsSaveTimerRef.current = undefined;
    }

    void saveSettings(settingsRef.current);
  };

  const previewSettingsPatch = (patch: Partial<NavigatorSettings>) => {
    const nextSettings = normalizeSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = nextSettings;
    pendingPreviewSettingsRef.current = nextSettings;

    if (!settingsPreviewFrameRef.current) {
      settingsPreviewFrameRef.current = window.requestAnimationFrame(() => {
        settingsPreviewFrameRef.current = undefined;
        const pendingSettings = pendingPreviewSettingsRef.current;
        pendingPreviewSettingsRef.current = null;
        if (!pendingSettings) {
          return;
        }

        setSettings(pendingSettings);
        applyChatTypography(pendingSettings);
      });
    }

    return nextSettings;
  };

  const previewDisplaySettings = (patch: Partial<NavigatorSettings>) => {
    const nextSettings = previewSettingsPatch(patch);
    scheduleSettingsSave(nextSettings);
  };

  const commitSettingsPatch = async (patch: Partial<NavigatorSettings>) => {
    if (settingsSaveTimerRef.current) {
      window.clearTimeout(settingsSaveTimerRef.current);
      settingsSaveTimerRef.current = undefined;
    }

    const nextSettings = applySettingsPatch(patch);
    await saveSettings(nextSettings);
  };
  const updateSettings = commitSettingsPatch;

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

  const syncCompatRules = async () => {
    setCompatRulesSyncStatus("syncing");
    try {
      const rules = await fetchRemoteCompatRules();
      const updatedAt = Date.now();
      setActiveCompatRules(rules, "remote");
      setCompatRuleCount(rules.length);
      await storageSet({
        [COMPAT_RULES_STORAGE_KEY]: {
          updatedAt,
          rules
        } satisfies StoredCompatRules
      });
      await updateSettings({
        compatRulesRemoteEnabled: true,
        compatRulesLastSyncAt: updatedAt,
        compatRulesSource: "remote"
      });
      setCompatRulesSyncStatus("synced");
      scheduleScan(100);
    } catch (error) {
      console.warn("[GPT聊天导航器] 同步 ChatGPT 兼容规则失败：", error);
      setActiveCompatRules([], "built-in");
      setCompatRuleCount(0);
      await updateSettings({
        compatRulesRemoteEnabled: false,
        compatRulesSource: "built-in"
      });
      setCompatRulesSyncStatus("failed");
      scheduleScan(100);
    }
  };

  const resetCompatRules = async () => {
    setActiveCompatRules([], "built-in");
    setCompatRuleCount(0);
    setCompatRulesSyncStatus("idle");
    await updateSettings({
      compatRulesRemoteEnabled: false,
      compatRulesLastSyncAt: 0,
      compatRulesSource: "built-in"
    });
    await storageSet({
      [COMPAT_RULES_STORAGE_KEY]: {
        updatedAt: 0,
        rules: []
      } satisfies StoredCompatRules
    });
    scheduleScan(100);
  };

  useEffect(() => {
    installRouteEvents();
    let lastHref = location.href;

    const updatePageKey = () => {
      const nextPageId = getPageId();
      revealLatestOnNextPaintRef.current = true;
      forceDomRebuildOnNextScanRef.current = true;
      itemsRef.current = [];
      mapEntriesRef.current = [];
      groupCollapsedRef.current = {};
      pageKeyRef.current = getPageStorageKey(settingsRef.current, nextPageId);
      lastRecordSignatureRef.current = "";
      lastScanScrollYRef.current = window.scrollY;
      anchorRegistry.clear();
      setItems([]);
      setMapEntries([]);
      setGroupCollapsed({});
      setEditingItemId(null);
      setActiveId(null);
      setAdapterHealth(createDefaultAdapterHealth());
      setPageId(nextPageId);
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
    let catalogSyncWork: ScheduledIdleWork | null = null;

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
        catalogSyncWork = requestIdleWork(() => {
          if (!cancelled) {
            void syncModelCatalog(false);
          }
        }, 3000);
      }
    }

    loadModelCatalog();

    return () => {
      cancelled = true;
      cancelIdleWork(catalogSyncWork);
    };
  }, [syncModelCatalog]);

  useEffect(() => {
    let cancelled = false;

    async function loadCompatRules() {
      if (!settings.compatRulesRemoteEnabled || settings.compatRulesSource !== "remote") {
        setActiveCompatRules([], "built-in");
        setCompatRuleCount(0);
        return;
      }

      const stored = await storageGet<StoredCompatRules>(COMPAT_RULES_STORAGE_KEY);
      if (cancelled) {
        return;
      }

      const rules = normalizeCompatRulesPayload({
        schemaVersion: 1,
        rules: stored?.rules ?? []
      });

      if (rules.length === 0) {
        setActiveCompatRules([], "built-in");
        setCompatRuleCount(0);
        setCompatRulesSyncStatus("failed");
        return;
      }

      setActiveCompatRules(rules, "remote");
      setCompatRuleCount(rules.length);
      setCompatRulesSyncStatus("synced");
      scheduleScan(100);
    }

    void loadCompatRules();

    return () => {
      cancelled = true;
    };
  }, [scheduleScan, settings.compatRulesRemoteEnabled, settings.compatRulesSource]);

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
        applySettingsNow(nextSettings);
      }
    });

    const handleSettingsChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local" || !changes[STORAGE_SETTINGS_KEY]) {
        return;
      }

      applySettingsNow(normalizeSettings(changes[STORAGE_SETTINGS_KEY].newValue));
    };

    chrome.storage.onChanged.addListener(handleSettingsChange);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleSettingsChange);
    };
  }, []);

  const updateResizeFrame = useCallback(() => {
    if (adapter.id !== "chatgpt") {
      if (resizeFrameRef.current) {
        resizeFrameRef.current = null;
        setResizeFrame(null);
      }
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

    const nextFrame = {
      left: Math.round(center - width / 2),
      right: Math.round(center + width / 2),
      top: Math.round(top),
      height: Math.max(260, Math.round(window.innerHeight - top - bottomGap)),
      toggleLeft: Math.round(Math.max(18, leftBound + 18))
    };

    setResizeFrame((current) => {
      if (areResizeFramesEqual(current, nextFrame)) {
        return current;
      }

      resizeFrameRef.current = nextFrame;
      return nextFrame;
    });
  }, [adapter.id]);

  useEffect(() => {
    applyChatTypography(settings);
    window.requestAnimationFrame(updateResizeFrame);
  }, [
    settings.chatContentWidth,
    settings.chatFontScale,
    settings.chatLetterSpacing,
    settings.chatLineHeight,
    settings.canvasFontScale,
    settings.canvasLetterSpacing,
    settings.canvasLineHeight,
    updateResizeFrame
  ]);

  useEffect(() => {
    return () => {
      if (openingTimerRef.current) {
        window.clearTimeout(openingTimerRef.current);
      }
      if (scanTimerRef.current) {
        window.clearTimeout(scanTimerRef.current);
      }
      if (settingsSaveTimerRef.current) {
        window.clearTimeout(settingsSaveTimerRef.current);
      }
      if (settingsPreviewFrameRef.current) {
        window.cancelAnimationFrame(settingsPreviewFrameRef.current);
      }
      cancelIdleWork(scanIdleWorkRef.current);
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
    let frame = 0;

    const updateScrollJumpPosition = () => {
      frame = 0;
      const nextPosition = getScrollJumpPosition(settingsRef.current.collapsed);
      setScrollJumpPosition((current) =>
        current.right === nextPosition.right && current.bottom === nextPosition.bottom
          ? current
          : nextPosition
      );
    };

    const scheduleUpdate = () => {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(updateScrollJumpPosition);
    };

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    scheduleUpdate();
    const interval = window.setInterval(scheduleUpdate, 1600);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.clearInterval(interval);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [settings.collapsed]);

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

      const nextFavorites = storedRecord?.favorites ?? {};
      const nextGroupCollapsed = storedRecord?.groupCollapsed ?? {};
      const restoredItems = restoreItemsFromRecord(storedRecord, nextFavorites);
      const restoredEntries = restoreMapEntriesFromItems(restoredItems);
      favoritesRef.current = nextFavorites;
      groupCollapsedRef.current = nextGroupCollapsed;
      itemsRef.current = restoredItems;
      mapEntriesRef.current = restoredEntries;
      forceDomRebuildOnNextScanRef.current = restoredItems.length === 0;
      lastRecordSignatureRef.current = makeRecordSignature(restoredItems, nextFavorites, nextGroupCollapsed);
      setFavorites(nextFavorites);
      setGroupCollapsed(nextGroupCollapsed);
      setItems(restoredItems);
      setMapEntries(restoredEntries);
      setAdapterHealth(storedRecord?.health ? {
        status: storedRecord.health.status,
        reason: storedRecord.health.reason,
        ruleId: storedRecord.health.ruleId,
        messageCount: storedRecord.health.messageCount,
        userCount: storedRecord.health.userCount,
        assistantCount: storedRecord.health.assistantCount,
        canAnchor: false,
        tokenTextAvailable: restoredEntries.length > 0,
        source: storedRecord.health.source
      } : createDefaultAdapterHealth());
    }

    loadState();

    return () => {
      cancelled = true;
    };
  }, [pageKey, settings.cacheMode]);

  useEffect(() => {
    scheduleScan(100);
  }, [
    favorites,
    modelCatalog,
    pageKey,
    scheduleScan,
    settings.compatRulesRemoteEnabled,
    settings.compatRulesSource,
    settings.cacheMode,
    settings.manualTokenBudget,
    settings.tokenBudgetMode,
    settings.tokenModelId
  ]);

  useEffect(() => {
    const getMutationElement = (mutation: MutationRecord): HTMLElement | null => {
      const target = mutation.target;
      if (target instanceof HTMLElement) {
        return target;
      }

      return target.parentElement;
    };

    const observer = new MutationObserver((mutations) => {
      let hasRelevantMutation = false;
      let textOnly = true;

      for (const mutation of mutations) {
        const element = getMutationElement(mutation);
        if (!element || element.closest(`#${ROOT_ID}`)) {
          continue;
        }

        hasRelevantMutation = true;
        if (mutation.type !== "characterData") {
          textOnly = false;
          break;
        }
      }

      if (!hasRelevantMutation) {
        return;
      }

      scheduleScan(textOnly ? STREAMING_SCAN_DEBOUNCE_MS : SCAN_DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });

    return () => {
      observer.disconnect();
    };
  }, [scheduleScan]);

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
      if (settingsRef.current.tokenPanelEnabled) {
        setViewportMetrics(createViewportMetrics(mapEntries));
      }
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
  }, [items, mapEntries, settings.tokenPanelEnabled]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (favoritesOnly && !item.favorite) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return getNavigatorSearchText(item).toLowerCase().includes(normalizedQuery);
    });
  }, [favoritesOnly, items, query]);
  const allGroups = useMemo(() => buildNavigatorGroups(items, settings.language), [items, settings.language]);
  const filteredItemIds = useMemo(() => new Set(filteredItems.map((item) => item.id)), [filteredItems]);
  const visibleGroups = useMemo(
    () => filterNavigatorGroups(allGroups, filteredItemIds),
    [allGroups, filteredItemIds]
  );

  const tokenStats = useMemo(
    () => buildTokenStats(mapEntries, viewportMetrics, settings, detectedModelLabel, modelCatalog),
    [detectedModelLabel, mapEntries, modelCatalog, settings, viewportMetrics]
  );
  const tokenDetailEntries = useMemo(
    () => buildTokenDetailEntries(mapEntries, items),
    [items, mapEntries]
  );
  const tokenBudgetPercent = tokenStats.budget > 0 ? (tokenStats.total / tokenStats.budget) * 100 : 0;
  const healthLabel =
    adapterHealth.status === "ok"
      ? t.adapterStatusOk
      : adapterHealth.status === "degraded"
        ? t.adapterStatusDegraded
        : t.adapterStatusUnsupported;
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
  const showThreadHandles = Boolean(resizeFrame && (settings.threadResizeEnabled || resizingSide));
  const showWidthToggle = Boolean(resizeFrame);
  const widthToggleLabels =
    settings.language === "en"
      ? {
          enable: "Show width handles",
          disable: "Hide width handles"
        }
      : settings.language === "zh-TW"
        ? {
            enable: "顯示寬度調節",
            disable: "隱藏寬度調節"
          }
        : {
            enable: "显示宽度调节",
            disable: "隐藏宽度调节"
          };
  const navLabels =
    settings.language === "en"
      ? {
          collapseGroup: "Collapse group",
          expandGroup: "Expand group",
          rename: "Rename / note",
          customTitle: "Custom title",
          note: "Note",
          save: "Save",
          cancel: "Cancel",
          restore: "Restore default"
        }
      : settings.language === "zh-TW"
        ? {
            collapseGroup: "折疊分組",
            expandGroup: "展開分組",
            rename: "重命名/備註",
            customTitle: "自定義標題",
            note: "備註",
            save: "保存",
            cancel: "取消",
            restore: "恢復默認"
          }
        : {
            collapseGroup: "折叠分组",
            expandGroup: "展开分组",
            rename: "重命名/备注",
            customTitle: "自定义标题",
            note: "备注",
            save: "保存",
            cancel: "取消",
            restore: "恢复默认"
          };

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
      const main = document.querySelector<HTMLElement>("main");
      const rect = main?.getBoundingClientRect();
      const leftBound = Math.max(0, rect?.left ?? 0);
      const rightBound = Math.min(window.innerWidth, rect?.right ?? window.innerWidth);
      const availableWidth = Math.max(340, rightBound - leftBound - 24);
      const center = leftBound + (rightBound - leftBound) / 2;
      const top = Math.max(112, (rect?.top ?? 0) + 28);
      const bottomGap = 112;
      const height = Math.max(260, Math.round(window.innerHeight - top - bottomGap));
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      let latestValue = settingsRef.current.chatContentWidth;
      let dragFrame = 0;

      setResizingSide(side);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      const applyDragPreview = () => {
        dragFrame = 0;
        const nextSettings = normalizeSettings({
          ...settingsRef.current,
          chatContentWidth: latestValue,
          chatLayoutVersion: 2
        });
        const width = Math.min(getThreadWidthPixels(nextSettings.chatContentWidth), availableWidth);
        const nextFrame = {
          left: Math.round(center - width / 2),
          right: Math.round(center + width / 2),
          top: Math.round(top),
          height,
          toggleLeft: Math.round(Math.max(18, leftBound + 18))
        };

        settingsRef.current = nextSettings;
        applyChatTypography(nextSettings);
        setResizeFrame((current) => {
          if (areResizeFramesEqual(current, nextFrame)) {
            return current;
          }

          resizeFrameRef.current = nextFrame;
          return nextFrame;
        });
      };

      const scheduleDragPreview = () => {
        if (!dragFrame) {
          dragFrame = window.requestAnimationFrame(applyDragPreview);
        }
      };

      const handleMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault();
        const delta = side === "right" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        latestValue = getThreadWidthSettingFromPixels(startWidth + delta * 2);
        scheduleDragPreview();
      };

      const handleUp = () => {
        if (dragFrame) {
          window.cancelAnimationFrame(dragFrame);
          applyDragPreview();
        }

        const finalSettings = normalizeSettings({
          ...settingsRef.current,
          chatContentWidth: latestValue,
          chatLayoutVersion: 2
        });
        setResizingSide(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("pointermove", handleMove, true);
        document.removeEventListener("pointerup", handleUp, true);
        document.removeEventListener("pointercancel", handleUp, true);
        applySettingsNow(finalSettings);
        void saveSettings(finalSettings);
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

  const commitNavigatorState = async (
    nextItems: NavigatorItem[],
    nextFavorites = favoritesRef.current,
    nextGroupCollapsed = groupCollapsedRef.current
  ) => {
    favoritesRef.current = nextFavorites;
    groupCollapsedRef.current = nextGroupCollapsed;
    itemsRef.current = nextItems;
    setFavorites(nextFavorites);
    setGroupCollapsed(nextGroupCollapsed);
    setItems(nextItems);
    lastRecordSignatureRef.current = makeRecordSignature(nextItems, nextFavorites, nextGroupCollapsed);
    await persistRecord(
      settingsRef.current,
      pageKeyRef.current,
      nextItems,
      nextFavorites,
      adapterHealth,
      nextGroupCollapsed
    );
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

    setMapEntries((currentEntries) => {
      const nextEntries = currentEntries.map((entry) =>
        entry.id === item.id ? { ...entry, favorite: !itemFavorite } : entry
      );
      mapEntriesRef.current = nextEntries;
      return nextEntries;
    });
    await commitNavigatorState(nextItems, nextFavorites, groupCollapsedRef.current);
  };

  const beginEditingItem = (item: NavigatorItem) => {
    setEditingItemId(item.id);
    setEditingTitle(item.customTitle || "");
    setEditingNote(item.note || "");
  };

  const updateNavigatorItemMetadata = async (id: string, title: string, note: string) => {
    const nextTitle = normalizeText(title).slice(0, 80);
    const nextNote = normalizeText(note).slice(0, 180);
    const nextItems = itemsRef.current.map((item) =>
      item.id === id
        ? {
            ...item,
            customTitle: nextTitle || undefined,
            note: nextNote || undefined
          }
        : item
    );

    await commitNavigatorState(nextItems, favoritesRef.current, groupCollapsedRef.current);
  };

  const saveEditingItem = async () => {
    if (!editingItemId) {
      return;
    }

    await updateNavigatorItemMetadata(editingItemId, editingTitle, editingNote);
    setEditingItemId(null);
  };

  const restoreNavigatorItemTitle = async (item: NavigatorItem) => {
    await updateNavigatorItemMetadata(item.id, "", "");
    if (editingItemId === item.id) {
      setEditingTitle("");
      setEditingNote("");
      setEditingItemId(null);
    }
  };

  const toggleGroupCollapsed = async (groupId: string) => {
    const nextGroupCollapsed = { ...groupCollapsedRef.current };
    if (nextGroupCollapsed[groupId]) {
      delete nextGroupCollapsed[groupId];
    } else {
      nextGroupCollapsed[groupId] = true;
    }

    await commitNavigatorState(itemsRef.current, favoritesRef.current, nextGroupCollapsed);
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
    const tokenWarningLevel = tokenBudgetPercent >= 100 ? "danger" : tokenBudgetPercent >= 82 ? "warning" : "normal";
    const tokenPanelLabels =
      settings.language === "en"
        ? {
            details: "Message details",
            warning: "Token budget is getting tight",
            danger: "Token budget exceeded",
            trim: "Trim high-token nodes first",
            user: "User",
            assistant: "Assistant",
            code: "code",
            table: "table"
          }
        : settings.language === "zh-TW"
          ? {
              details: "消息明細",
              warning: "Token 預算接近上限",
              danger: "Token 預算已超出",
              trim: "優先裁剪高 token 節點",
              user: "用戶",
              assistant: "助手",
              code: "代碼",
              table: "表格"
            }
          : {
              details: "消息明细",
              warning: "Token 预算接近上限",
              danger: "Token 预算已超出",
              trim: "优先裁剪高 token 节点",
              user: "用户",
              assistant: "助手",
              code: "代码",
              table: "表格"
            };
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
            {tokenWarningLevel !== "normal" ? (
              <div className={`cnav-token-warning is-${tokenWarningLevel}`}>
                <strong>{tokenWarningLevel === "danger" ? tokenPanelLabels.danger : tokenPanelLabels.warning}</strong>
                <span>{tokenPanelLabels.trim}</span>
              </div>
            ) : null}
            <details className="cnav-token-details">
              <summary>{tokenPanelLabels.details}</summary>
              <div className="cnav-token-detail-list">
                {tokenDetailEntries.map((entry) => (
                  <button
                    className={`cnav-token-detail is-heat-${entry.heatLevel}`}
                    type="button"
                    key={entry.id}
                    onClick={() => scrollToNavigatorItem(entry.id, settings.navigateAnimationEnabled)}
                  >
                    <span>
                      {entry.role === "user" ? tokenPanelLabels.user : tokenPanelLabels.assistant} #{entry.turnIndex}
                    </span>
                    <strong>{formatTokenCount(entry.tokenCount)}</strong>
                    <small>{entry.label}</small>
                    <em>
                      {`${tokenPanelLabels.code} ${formatTokenCount(entry.codeTokens)} · ${tokenPanelLabels.table} ${formatTokenCount(entry.tableTokens)}`}
                    </em>
                  </button>
                ))}
              </div>
            </details>
            <div className="cnav-token-scope">{t.tokenVisibleDomOnly}</div>
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      {showThreadHandles && resizeFrame ? (
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

      {showWidthToggle ? (
        <button
          className={`cnav-width-toggle${settings.threadResizeEnabled ? " is-active" : ""}`}
          type="button"
          data-theme={theme}
          style={{ left: resizeFrame?.toggleLeft ?? 18 }}
          onClick={() => updateSettings({ threadResizeEnabled: !settings.threadResizeEnabled })}
          onMouseDown={(event) => event.stopPropagation()}
          title={settings.threadResizeEnabled ? widthToggleLabels.disable : widthToggleLabels.enable}
          aria-label={settings.threadResizeEnabled ? widthToggleLabels.disable : widthToggleLabels.enable}
          aria-pressed={settings.threadResizeEnabled}
        >
          <MoveHorizontal size={18} aria-hidden="true" />
        </button>
      ) : null}

      {settings.tokenPanelMode === "floating" ? renderTokenPanel("hud") : null}

      <TableCopyLayer
        theme={theme}
        language={settings.language}
        navigatorCollapsed={settings.collapsed}
      />

      <CodeBlockLayer
        theme={theme}
        language={settings.language}
        navigatorCollapsed={settings.collapsed}
      />

      <div
        className="cnav-scroll-jump"
        data-theme={theme}
        style={{ right: scrollJumpPosition.right, bottom: scrollJumpPosition.bottom }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="cnav-scroll-jump-button"
          type="button"
          onClick={() => scrollToChatBoundary("top", settings.navigateAnimationEnabled)}
          title={t.scrollToTop}
          aria-label={t.scrollToTop}
        >
          <ArrowUpToLine size={18} aria-hidden="true" />
        </button>
        <button
          className="cnav-scroll-jump-button"
          type="button"
          onClick={() => scrollToChatBoundary("bottom", settings.navigateAnimationEnabled)}
          title={t.scrollToBottom}
          aria-label={t.scrollToBottom}
        >
          <ArrowDownToLine size={18} aria-hidden="true" />
        </button>
      </div>

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
              <span
                className={`cnav-health-badge is-${adapterHealth.status}`}
                title={`${adapterHealth.reason} · ${adapterHealth.ruleId}`}
              >
                {healthLabel}
              </span>
            </div>
            <div className="cnav-header-actions">
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
                visibleGroups.map((group) => {
                  const hasActiveItem = group.items.some((item) => item.id === activeId);
                  const isCollapsed = Boolean(groupCollapsed[group.id]) && !hasActiveItem;
                  return (
                    <section className={`cnav-group is-heat-${group.heatLevel}`} key={group.id}>
                      <button
                        className="cnav-group-head"
                        type="button"
                        onClick={() => toggleGroupCollapsed(group.id)}
                        title={isCollapsed ? navLabels.expandGroup : navLabels.collapseGroup}
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? (
                          <ChevronRight size={13} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={13} aria-hidden="true" />
                        )}
                        <span>{group.label}</span>
                        <small>{`${group.items.length} · ${formatTokenCount(group.tokenTotal)} ${t.tokenPanelShort}`}</small>
                      </button>
                      {isCollapsed ? null : (
                        <div className="cnav-group-list">
                          {group.items.map((item) => (
                            <div
                              className={`cnav-item${activeId === item.id ? " is-active" : ""}${item.mounted ? "" : " is-unmounted"} is-heat-${item.heatLevel}`}
                              key={item.id}
                              role="listitem"
                            >
                              <button
                                className="cnav-item-main"
                                type="button"
                                onClick={() => scrollToNavigatorItem(item.id, settings.navigateAnimationEnabled)}
                                title={item.mounted ? undefined : t.nodeUnmounted}
                              >
                                <span className="cnav-item-index">{item.turnIndex}</span>
                                <span className="cnav-item-copy">
                                  <span className="cnav-prompt">{getNavigatorDisplayTitle(item)}</span>
                                  <span className="cnav-answer">{item.note || item.answerSummary}</span>
                                  <span className="cnav-token-line">
                                    {`${formatTokenCount(item.totalTokens)} ${t.tokenPanelShort}${item.mounted ? "" : ` · ${t.nodeUnmounted}`}`}
                                  </span>
                                </span>
                                <ChevronRight className="cnav-item-arrow" size={15} aria-hidden="true" />
                              </button>
                              <button
                                className="cnav-star"
                                type="button"
                                onClick={() => beginEditingItem(item)}
                                title={navLabels.rename}
                                aria-label={navLabels.rename}
                              >
                                <FileText size={14} aria-hidden="true" />
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
                              {editingItemId === item.id ? (
                                <div className="cnav-item-editor">
                                  <input
                                    value={editingTitle}
                                    onChange={(event) => setEditingTitle(event.currentTarget.value)}
                                    placeholder={navLabels.customTitle}
                                    maxLength={80}
                                  />
                                  <textarea
                                    value={editingNote}
                                    onChange={(event) => setEditingNote(event.currentTarget.value)}
                                    placeholder={navLabels.note}
                                    maxLength={180}
                                    rows={2}
                                  />
                                  <div className="cnav-item-editor-actions">
                                    <button type="button" onClick={() => void saveEditingItem()}>
                                      <Check size={13} aria-hidden="true" />
                                      <span>{navLabels.save}</span>
                                    </button>
                                    <button type="button" onClick={() => setEditingItemId(null)}>
                                      <Minimize2 size={13} aria-hidden="true" />
                                      <span>{navLabels.cancel}</span>
                                    </button>
                                    <button type="button" onClick={() => void restoreNavigatorItemTitle(item)}>
                                      <RefreshCw size={13} aria-hidden="true" />
                                      <span>{navLabels.restore}</span>
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })
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

