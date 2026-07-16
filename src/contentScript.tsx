import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  BookOpen,
  Check,
  CheckCircle2,
  CheckSquare2,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Focus,
  Link2,
  ListChecks,
  Loader2,
  Minimize2,
  PanelRightOpen,
  Search,
  Square,
  Table2,
  X
} from "lucide-react";
import {
  AppLanguage,
  CITATION_CHECK_MESSAGE,
  CITATION_STATE_STORAGE_KEY,
  CitationCheckResult,
  CitationRecord,
  CompatRulesSource,
  DEFAULT_SELECTIVE_EXPORT_PREFERENCES,
  DEFAULT_SETTINGS,
  EXPORT_PREFERENCES_STORAGE_KEY,
  EXPORT_SNAPSHOT_MESSAGE,
  ExportDocumentFormat,
  ExportChatMessage,
  ExportCodeBlock,
  ExportNavigatorNode,
  ExportSnapshot,
  MATERIALS_LIST_MESSAGE,
  NavigatorSettings,
  PAGE_COMMAND_MESSAGE,
  PAGE_STATUS_MESSAGE,
  PageAdapterHealth,
  PageMaterial,
  ReadingToolPanel,
  SELECTION_GET_MESSAGE,
  SelectiveExportSnapshot,
  SelectiveExportPreferences,
  STORAGE_SETTINGS_KEY,
  SelectionMaterial,
  isLegacyConversationRecord,
  normalizeSelectiveExportPreferences,
  normalizeSettings
} from "./shared";
import { getTranslation } from "./i18n";
import {
  buildConversationStorageKey,
  buildConversationSessionId,
  hasConversationPromptOverlap
} from "./conversationSession";
import {
  CanvasLayoutSession,
  applyCanvasLayoutWidth,
  canvasMutationsRequireSessionRefresh,
  captureCanvasScroll,
  clearCanvasLayoutSession,
  createCanvasLayoutSession,
  isCanvasLayoutSessionConnected,
  isVirtualizedCodeCanvas,
  markCanvasLayoutSession,
  restoreCanvasScroll,
  shouldApplyCanvasTypography
} from "./canvasLayout";
import {
  ChatGptAdapter,
  ChatGptDomRule,
  AdapterHealth,
  CHATGPT_ASSISTANT_MESSAGE_NODE_SELECTOR,
  CHATGPT_COMPOSER_SELECTORS,
  CHATGPT_COMPAT_RULES_URL,
  CHATGPT_HEADER_SELECTORS,
  CHATGPT_MESSAGE_NODE_SELECTOR,
  CHATGPT_SIDEBAR_SELECTORS,
  CHATGPT_TURN_NODE_SELECTOR,
  CHATGPT_USER_MESSAGE_NODE_SELECTOR,
  createChatGptAdapter,
  normalizeCompatRulesPayload
} from "./chatGptAdapter";
import {
  applySelectiveExportPreferences,
  buildSelectiveExportSnapshot,
  canonicalizeCitationUrl,
  filterSelectiveSnapshot,
  getAllSelectableBlockIds,
  ReadingMessageParseCache,
  ReadingSourceMessage
} from "./readingTools";
import { buildExportDocument, downloadExportFile } from "./popup";
import "./styles/content.css";

const ROOT_ID = "conversation-navigator-root";
const ANCHOR_ATTR = "data-conversation-navigator-id";
const MESSAGE_ROLE_ATTR = "data-cnav-message-role";
const MESSAGE_ROLE_SELECTOR = `[${MESSAGE_ROLE_ATTR}]`;
const CHATGPT_MESSAGE_OR_MARKER_SELECTOR = `${CHATGPT_MESSAGE_NODE_SELECTOR},${MESSAGE_ROLE_SELECTOR}`;
const CHATGPT_TURN_OR_MARKER_SELECTOR = `${CHATGPT_TURN_NODE_SELECTOR},${MESSAGE_ROLE_SELECTOR}`;
const CHATGPT_MESSAGE_STYLE_SELECTOR = `:is(${CHATGPT_MESSAGE_NODE_SELECTOR},${MESSAGE_ROLE_SELECTOR})`;
const CHATGPT_USER_MESSAGE_STYLE_SELECTOR = `:is(${CHATGPT_USER_MESSAGE_NODE_SELECTOR},[${MESSAGE_ROLE_ATTR}="user"])`;
const CHATGPT_ASSISTANT_MESSAGE_STYLE_SELECTOR = `:is(${CHATGPT_ASSISTANT_MESSAGE_NODE_SELECTOR},[${MESSAGE_ROLE_ATTR}="assistant"])`;
const COMPAT_RULES_STORAGE_KEY = "conversationNavigator:compatRules:v1";
const SCAN_DEBOUNCE_MS = 650;
const STREAMING_SCAN_DEBOUNCE_MS = 1400;
const IDLE_SCAN_TIMEOUT_MS = 1200;
const CHAT_STYLE_ID = "conversation-navigator-chat-style";
const CHAT_STYLE_VERSION = "2026-07-v10-reading-tools-v1";
const TABLE_COPY_FORMAT_STORAGE_KEY = "conversationNavigator:tableCopyFormat:v1";
const PAGE_COMMAND_EVENT = "conversation-navigator-page-command";
const FOCUS_ACTIVE_ATTR = "data-cnav-focus-active";
const FOCUS_HIDDEN_ATTR = "data-cnav-focus-hidden";
const FOCUS_CHROME_ATTR = "data-cnav-focus-chrome";
const CITATION_HIGHLIGHT_ATTR = "data-cnav-citation-highlight";
const OFFICIAL_THREAD_WIDTH = 60;
const THREAD_WIDTH_MIN = 60;
const THREAD_WIDTH_MAX = 100;
const COMPAT_RULES_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
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
type ColorTheme = "light" | "dark";
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

interface NavigatorItem {
  id: string;
  promptPreview: string;
  answerSummary: string;
  turnIndex: number;
  domOrder: number;
  mounted: boolean;
}

interface NavigatorGroup {
  id: string;
  kind: NavigatorGroupKind;
  label: string;
  items: NavigatorItem[];
}

interface MessageMapEntry {
  id: string;
  role: Role;
  text: string;
  turnIndex: number;
  domOrder: number;
  mounted: boolean;
}

interface BuildNavigatorResult {
  items: NavigatorItem[];
  mapEntries: MessageMapEntry[];
  health: AdapterHealth;
}

interface StoredCompatRules {
  updatedAt: number;
  rules: ChatGptDomRule[];
  lastAttemptAt?: number;
  lastError?: string;
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

type CanvasWidthTarget = CanvasLayoutSession;

interface CanvasResizeMetrics {
  boundsRect: DOMRect;
  leftBound: number;
  rightBound: number;
  availableWidth: number;
  width: number;
  center: number;
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
let nextNodeAnchorIndex = 1;
const tabSessionId = Math.random().toString(36).slice(2, 10);
let activeConversationSessionId = "";

let activeCompatRules: ChatGptDomRule[] = [];
let activeCompatRulesSource: CompatRulesSource = "built-in";
let navigationAnimationFrame = 0;
let latestPageHealth: PageAdapterHealth | null = null;
let latestNavigatorExportState: {
  items: NavigatorItem[];
  pageKey: string;
  language: AppLanguage;
} = {
  items: [],
  pageKey: "",
  language: DEFAULT_SETTINGS.language
};

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

function createConversationSessionId(generation: number): string {
  return buildConversationSessionId(
    location.hostname,
    getChatGptConversationId(),
    tabSessionId,
    generation
  );
}

function getPageId(): string {
  return activeConversationSessionId || createConversationSessionId(0);
}

function getCitationStorageKey(): string {
  return buildConversationStorageKey(location.hostname, getChatGptConversationId(), tabSessionId);
}

interface StoredCitationConversation {
  updatedAt: number;
  citations: Record<string, Partial<CitationRecord>>;
}

interface StoredCitationState {
  schemaVersion: 1;
  conversations: Record<string, StoredCitationConversation>;
}

let extensionStorageUnavailableWarned = false;

function getExtensionStorageLocal() {
  const chromeApi = typeof chrome === "undefined" ? undefined : chrome;
  return chromeApi?.storage?.local ?? null;
}

function getExtensionStorageOnChanged() {
  const chromeApi = typeof chrome === "undefined" ? undefined : chrome;
  return chromeApi?.storage?.onChanged ?? null;
}

function getRuntimeLastErrorMessage(): string | undefined {
  const chromeApi = typeof chrome === "undefined" ? undefined : chrome;
  return chromeApi?.runtime?.lastError?.message;
}

function warnExtensionStorageUnavailableOnce(action: string, error?: unknown) {
  if (extensionStorageUnavailableWarned) {
    return;
  }

  extensionStorageUnavailableWarned = true;
  console.warn(
    `[GPT页面增强工具] ${action}时扩展存储暂不可用，当前页面将使用降级模式继续运行。`,
    error
  );
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const storage = getExtensionStorageLocal();
    if (!storage) {
      warnExtensionStorageUnavailableOnce("读取本地缓存");
      resolve(undefined);
      return;
    }

    try {
      storage.get(key, (result) => {
        const errorMessage = getRuntimeLastErrorMessage();
        if (errorMessage) {
          console.warn("[GPT页面增强工具] 读取本地缓存失败：", errorMessage);
          resolve(undefined);
          return;
        }

        resolve(result[key] as T | undefined);
      });
    } catch (error) {
      warnExtensionStorageUnavailableOnce("读取本地缓存", error);
      resolve(undefined);
    }
  });
}

function storageSet(values: Record<string, unknown>): Promise<boolean> {
  return new Promise((resolve) => {
    const storage = getExtensionStorageLocal();
    if (!storage) {
      warnExtensionStorageUnavailableOnce("写入本地缓存");
      resolve(false);
      return;
    }

    try {
      storage.set(values, () => {
        const errorMessage = getRuntimeLastErrorMessage();
        if (errorMessage) {
          console.warn("[GPT页面增强工具] 写入本地缓存失败：", errorMessage);
          resolve(false);
          return;
        }

        resolve(true);
      });
    } catch (error) {
      warnExtensionStorageUnavailableOnce("写入本地缓存", error);
      resolve(false);
    }
  });
}

async function loadSettings(): Promise<NavigatorSettings> {
  return normalizeSettings(await storageGet<Partial<NavigatorSettings>>(STORAGE_SETTINGS_KEY));
}

function saveSettings(settings: NavigatorSettings): Promise<boolean> {
  return storageSet({ [STORAGE_SETTINGS_KEY]: normalizeSettings(settings) });
}

async function loadSelectiveExportPreferences(): Promise<SelectiveExportPreferences> {
  return normalizeSelectiveExportPreferences(
    await storageGet<SelectiveExportPreferences>(EXPORT_PREFERENCES_STORAGE_KEY)
  );
}

function saveSelectiveExportPreferences(preferences: SelectiveExportPreferences): Promise<boolean> {
  return storageSet({
    [EXPORT_PREFERENCES_STORAGE_KEY]: normalizeSelectiveExportPreferences(preferences)
  });
}

function normalizeStoredCitationState(value: unknown): StoredCitationState {
  if (!value || typeof value !== "object") {
    return { schemaVersion: 1, conversations: {} };
  }
  const candidate = value as Partial<StoredCitationState>;
  return {
    schemaVersion: 1,
    conversations: candidate.conversations && typeof candidate.conversations === "object"
      ? candidate.conversations
      : {}
  };
}

async function readCitationConversation(pageKey: string): Promise<Record<string, Partial<CitationRecord>>> {
  const stored = normalizeStoredCitationState(await storageGet<StoredCitationState>(CITATION_STATE_STORAGE_KEY));
  return stored.conversations[pageKey]?.citations ?? {};
}

async function writeCitationConversation(
  pageKey: string,
  citations: Record<string, Partial<CitationRecord>>
): Promise<void> {
  const stored = normalizeStoredCitationState(await storageGet<StoredCitationState>(CITATION_STATE_STORAGE_KEY));
  stored.conversations[pageKey] = { updatedAt: Date.now(), citations };
  const conversations = Object.entries(stored.conversations)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, 50);
  let remaining = 500;
  const compacted: StoredCitationState["conversations"] = {};
  for (const [key, conversation] of conversations) {
    if (remaining <= 0) break;
    const entries = Object.entries(conversation.citations)
      .sort(([, a], [, b]) =>
        Math.max(Number(b.checkedAt || 0), Number(b.openedAt || 0)) -
        Math.max(Number(a.checkedAt || 0), Number(a.openedAt || 0))
      )
      .slice(0, remaining);
    remaining -= entries.length;
    compacted[key] = { ...conversation, citations: Object.fromEntries(entries) };
  }
  await storageSet({
    [CITATION_STATE_STORAGE_KEY]: { schemaVersion: 1, conversations: compacted } satisfies StoredCitationState
  });
}

function clearLegacyPageStorageRecords(): number {
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.includes(":page:")) {
        continue;
      }

      const rawValue = window.localStorage.getItem(key);
      if (!rawValue) {
        continue;
      }

      try {
        if (isLegacyConversationRecord(JSON.parse(rawValue), key)) {
          keys.push(key);
        }
      } catch {
        // Ignore unrelated or malformed page data.
      }
    }

    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    return 0;
  }

  return keys.length;
}

clearLegacyPageStorageRecords();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === PAGE_COMMAND_MESSAGE) {
    window.dispatchEvent(new CustomEvent(PAGE_COMMAND_EVENT, { detail: message }));
    sendResponse({ ok: true });
    return false;
  }

  const supportedMessageTypes = new Set([
    MATERIALS_LIST_MESSAGE,
    SELECTION_GET_MESSAGE,
    EXPORT_SNAPSHOT_MESSAGE,
    PAGE_STATUS_MESSAGE
  ]);

  if (!supportedMessageTypes.has(message?.type)) {
    return false;
  }

  try {
    if (message.type === PAGE_STATUS_MESSAGE) {
      sendResponse({ ok: true, health: latestPageHealth });
      return false;
    }

    if (message.type === MATERIALS_LIST_MESSAGE) {
      sendResponse({ ok: true, materials: createPageMaterials() });
      return false;
    }

    if (message.type === SELECTION_GET_MESSAGE) {
      sendResponse({ ok: true, material: createSelectionMaterial() });
      return false;
    }

    sendResponse({ ok: true, snapshot: createExportSnapshot() });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }

  return false;
});

function getThreadWidthRem(widthSetting: number): number {
  return 48 + (widthSetting - THREAD_WIDTH_MIN) * 1.55;
}

function getThreadWidthSettingFromPixels(widthPixels: number, roundValue = true): number {
  const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  const widthRem = widthPixels / rem;
  const value = THREAD_WIDTH_MIN + (widthRem - 48) / 1.55;
  const clampedValue = Math.min(THREAD_WIDTH_MAX, Math.max(THREAD_WIDTH_MIN, value));
  return roundValue ? Math.round(clampedValue) : Number(clampedValue.toFixed(3));
}

function getThreadWidthPixels(widthSetting: number): number {
  const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
  return getThreadWidthRem(widthSetting) * rem;
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

  if (style.dataset.cnavStatic === CHAT_STYLE_VERSION) {
    return;
  }

  style.textContent = `
    html[data-cnav-wide-thread="true"] main {
      --thread-content-max-width: var(--cnav-thread-width) !important;
      --thread-content-width: var(--cnav-thread-width) !important;
    }

    html[data-cnav-wide-thread="true"] main :is(article[data-testid*="conversation-turn" i], [data-testid*="conversation-turn" i], [data-turn-id], [data-message-id], [data-cnav-message-role]):has(${CHATGPT_MESSAGE_STYLE_SELECTOR}) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main :is(.mx-auto, [class*="max-w-"], [class*="thread-content"], [class*="conversation-turn"]):has(${CHATGPT_MESSAGE_STYLE_SELECTOR}) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main :is(article[data-testid*="conversation-turn" i], [data-testid*="conversation-turn" i], [data-turn-id], [data-message-id], [data-cnav-message-role]):has(${CHATGPT_MESSAGE_STYLE_SELECTOR}) > :is(div, section) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main :is(.mx-auto, [class*="thread-content"]):has(> ${CHATGPT_MESSAGE_STYLE_SELECTOR}) {
      max-width: var(--cnav-thread-width) !important;
      width: min(var(--cnav-thread-width), 100%) !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    html[data-cnav-wide-thread="true"] main ${CHATGPT_MESSAGE_STYLE_SELECTOR} {
      max-width: 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    html[data-cnav-wide-thread="true"] main ${CHATGPT_MESSAGE_STYLE_SELECTOR} > :is(div, section) {
      max-width: 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    html[data-cnav-wide-thread="true"] main ${CHATGPT_ASSISTANT_MESSAGE_STYLE_SELECTOR} :is(.markdown, .whitespace-pre-wrap) {
      width: 100% !important;
      max-width: 100% !important;
    }

    main ${CHATGPT_MESSAGE_STYLE_SELECTOR} {
      font-size: var(--cnav-chat-font-size, 1rem) !important;
      letter-spacing: var(--cnav-chat-letter-spacing, 0px) !important;
      line-height: var(--cnav-chat-line-height, 1.55) !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }

    main ${CHATGPT_MESSAGE_STYLE_SELECTOR} :where(.markdown, .prose, .whitespace-pre-wrap, .break-words, [data-start], p, li, span, strong, em, blockquote) {
      font-size: var(--cnav-chat-font-size, 1rem) !important;
      letter-spacing: var(--cnav-chat-letter-spacing, 0px) !important;
      line-height: var(--cnav-chat-line-height, 1.55) !important;
    }

    main ${CHATGPT_MESSAGE_STYLE_SELECTOR} :where(.markdown p, .prose p, .markdown li, .prose li, p, li) {
      margin-top: var(--cnav-chat-paragraph-gap, 0.44em) !important;
      margin-bottom: var(--cnav-chat-paragraph-gap, 0.44em) !important;
    }

    main ${CHATGPT_MESSAGE_STYLE_SELECTOR} :where(.markdown p:first-child, .prose p:first-child, p:first-child) {
      margin-top: 0 !important;
    }

    main ${CHATGPT_MESSAGE_STYLE_SELECTOR} :where(.markdown p:last-child, .prose p:last-child, p:last-child) {
      margin-bottom: 0 !important;
    }

    main ${CHATGPT_MESSAGE_STYLE_SELECTOR} :where(.markdown code, .markdown pre, .prose code, .prose pre, code, pre) {
      font-size: var(--cnav-chat-code-size, 0.94rem) !important;
      letter-spacing: var(--cnav-chat-code-letter-spacing, 0px) !important;
      line-height: var(--cnav-chat-code-line-height, 1.46) !important;
    }

    main ${CHATGPT_MESSAGE_STYLE_SELECTOR},
    main ${CHATGPT_MESSAGE_STYLE_SELECTOR} *,
    [data-cnav-canvas-kind="document"],
    [data-cnav-canvas-kind="document"] *,
    html[data-cnav-wide-thread="true"] main ${CHATGPT_MESSAGE_STYLE_SELECTOR},
    html[data-cnav-wide-thread="true"] main ${CHATGPT_MESSAGE_STYLE_SELECTOR} *,
    html[data-cnav-wide-canvas="true"] [data-cnav-canvas-width-target="true"] {
      animation: none !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }

    main ${CHATGPT_USER_MESSAGE_STYLE_SELECTOR} :is(.whitespace-pre-wrap, .break-words) {
      max-width: min(760px, 72vw) !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }

    main ${CHATGPT_USER_MESSAGE_STYLE_SELECTOR} :is(.whitespace-pre-wrap, .break-words):has(> :nth-child(8)) {
      max-height: 46vh;
      overflow-y: auto;
    }

    [data-cnav-canvas-kind="document"][data-cnav-canvas-text-root="true"],
    [data-cnav-canvas-kind="document"] :is(
      [data-cnav-canvas-text-root="true"],
      [data-cnav-canvas-text-root="true"] :where(.ProseMirror, .markdown, .prose, [data-lexical-editor="true"], [contenteditable="true"], p, li, ul, ol, strong, em, blockquote, h1, h2, h3, h4, h5, h6)
    ) {
      font-size: var(--cnav-canvas-font-size, 1rem) !important;
      letter-spacing: var(--cnav-canvas-letter-spacing, 0px) !important;
      line-height: var(--cnav-canvas-line-height, 1.55) !important;
      overflow-wrap: anywhere !important;
      word-break: normal !important;
    }

    [data-cnav-canvas-kind="document"] [data-cnav-canvas-text-root="true"] :where(code, pre) {
      font-size: var(--cnav-canvas-code-size, 0.94rem) !important;
      letter-spacing: var(--cnav-canvas-code-letter-spacing, 0px) !important;
      line-height: var(--cnav-canvas-code-line-height, 1.46) !important;
    }

    [data-cnav-canvas-kind="document"] [data-cnav-canvas-text-root="true"] :where(p, li) {
      margin-top: var(--cnav-canvas-paragraph-gap, 0.4em) !important;
      margin-bottom: var(--cnav-canvas-paragraph-gap, 0.4em) !important;
    }

    [data-cnav-canvas-scroll-root="true"] {
      overflow-anchor: none !important;
    }

    html[data-cnav-wide-canvas="true"] [data-cnav-canvas-width-target="true"] {
      box-sizing: border-box !important;
      max-width: var(--cnav-canvas-target-width, var(--cnav-canvas-width)) !important;
      width: var(--cnav-canvas-target-width, min(var(--cnav-canvas-width), calc(100vw - 24px))) !important;
      margin-inline: auto !important;
      min-width: 0 !important;
    }

    html[data-cnav-wide-canvas="true"] [data-cnav-canvas-kind="document"][data-cnav-canvas-text-root="true"],
    html[data-cnav-wide-canvas="true"] [data-cnav-canvas-kind="document"] [data-cnav-canvas-text-root="true"] {
      max-width: 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }
  `;
  style.dataset.cnavStatic = CHAT_STYLE_VERSION;
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
  setStylePropertyIfChanged(rootStyle, "--cnav-thread-width", `min(${contentWidth}, calc(100vw - 24px))`);

  if (settings.chatContentWidth > OFFICIAL_THREAD_WIDTH) {
    root.dataset.cnavWideThread = "true";
  } else {
    delete root.dataset.cnavWideThread;
  }
}

function applyCanvasTypography(settings: NavigatorSettings) {
  installChatTypographyStyle();

  const root = document.documentElement;
  const rootStyle = root.style;
  const canvasContentWidth = `${getThreadWidthRem(settings.canvasContentWidth).toFixed(2)}rem`;

  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-font-size", `${(settings.canvasFontScale / 100).toFixed(2)}rem`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-code-size", `${Math.max(0.82, (settings.canvasFontScale / 100) * 0.94).toFixed(2)}rem`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-letter-spacing", `${settings.canvasLetterSpacing.toFixed(2)}px`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-code-letter-spacing", `${Math.min(settings.canvasLetterSpacing, 2).toFixed(2)}px`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-line-height", `${(settings.canvasLineHeight / 100).toFixed(2)}`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-code-line-height", `${Math.max(1.34, settings.canvasLineHeight / 100 * 0.94).toFixed(2)}`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-paragraph-gap", `${Math.max(0.28, (settings.canvasLineHeight - 120) * 0.005 + 0.22).toFixed(2)}em`);
  setStylePropertyIfChanged(rootStyle, "--cnav-canvas-width", `min(${canvasContentWidth}, calc(100vw - 24px))`);

  if (shouldApplyCanvasWidthLayout(settings)) {
    root.dataset.cnavWideCanvas = "true";
  } else {
    delete root.dataset.cnavWideCanvas;
  }
}

function shouldApplyCanvasWidthLayout(settings: NavigatorSettings): boolean {
  return settings.canvasContentWidth !== OFFICIAL_THREAD_WIDTH;
}

function shouldTrackCanvasWidthTarget(settings: NavigatorSettings): boolean {
  return settings.canvasWidthEnabled || shouldApplyCanvasWidthLayout(settings);
}

function safeQueryAll(selector: string, root: ParentNode = document): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function isCanvasTextEditorElement(element: HTMLElement): boolean {
  return element.matches([
    ".ProseMirror",
    ".cm-content",
    ".monaco-editor",
    ".cm-editor",
    ".markdown",
    ".prose",
    '[contenteditable="true"]',
    '[data-lexical-editor="true"]',
    "[data-page-number]",
    '[role="document"]'
  ].join(","));
}

const CANVAS_DISCOVERY_SELECTOR = [
  '[data-testid*="canvas" i]',
  '[data-testid*="artifact" i]',
  '[data-testid*="document" i]',
  '[data-testid*="doc" i]',
  '[data-testid*="editor" i]',
  '[aria-label*="canvas" i]',
  '[aria-label*="artifact" i]',
  '[aria-label*="document" i]',
  '[aria-label*="doc" i]',
  '[aria-label*="画布" i]',
  '[aria-label*="文档" i]',
  '[class*="canvas" i]',
  '[class*="artifact" i]',
  '[class*="document" i]',
  '[class*="doc-" i]',
  '[class*="editor" i]',
  '[class*="textLayer" i]',
  ".ProseMirror",
  ".cm-content",
  ".cm-editor",
  ".monaco-editor",
  '[contenteditable="true"]',
  '[data-lexical-editor="true"]',
  '[role="document"]',
  "[data-page-number]"
].join(",");

const CANVAS_SHELL_SELECTOR = [
  '[data-testid*="canvas" i]',
  '[data-testid*="artifact" i]',
  '[data-testid*="document" i]',
  '[data-testid*="doc" i]',
  '[aria-label*="canvas" i]',
  '[aria-label*="artifact" i]',
  '[aria-label*="document" i]',
  '[aria-label*="doc" i]',
  '[aria-label*="画布" i]',
  '[aria-label*="文档" i]',
  '[class*="canvas" i]',
  '[class*="artifact" i]',
  '[class*="document" i]'
].join(",");

function findCanvasSessionRoot(seedRoot: HTMLElement, textRoot: HTMLElement): HTMLElement {
  const closestShell = textRoot.closest<HTMLElement>(CANVAS_SHELL_SELECTOR);
  if (closestShell && !isExcludedCanvasElement(closestShell)) {
    return closestShell;
  }
  return seedRoot;
}

function isCanvasLikeElement(element: HTMLElement): boolean {
  const descriptor = [
    element.getAttribute("data-testid") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("role") || "",
    element.id || "",
    element.className || ""
  ].join(" ");

  return /(canvas|artifact|document|doc-|editor|textlayer|page|画布|文档)/i.test(descriptor) ||
    isCanvasTextEditorElement(element);
}

function isExcludedCanvasElement(element: HTMLElement): boolean {
  return Boolean(
    element.closest(`#${ROOT_ID}`) ||
      element.closest(CHATGPT_MESSAGE_OR_MARKER_SELECTOR) ||
      element.closest("form") ||
      element.closest("header, nav, menu, [role='menu'], [role='toolbar']") ||
      element.closest("[data-testid*='composer' i], [aria-label*='composer' i]")
  );
}

function isCanvasWidthTargetCandidate(element: HTMLElement): boolean {
  if (
    isExcludedCanvasElement(element)
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!isRectVisible(rect) || rect.width < 320 || rect.height < 72) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }

  const textLength = normalizeText(element.innerText || element.textContent || "").length;
  return isCanvasTextEditorElement(element) || textLength >= 80;
}

function getCanvasCandidateScore(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const textLength = Math.min(8000, normalizeText(element.innerText || element.textContent || "").length);
  const areaScore = Math.min(1400000, rect.width * rect.height) / 1000;
  const editorBonus = isCanvasTextEditorElement(element) ? 120 : 0;
  const compactPenalty = rect.height < 160 ? 180 : 0;
  return areaScore + textLength * 0.08 + editorBonus - compactPenalty;
}

function collectCanvasWidthTargetCandidates(root: HTMLElement): HTMLElement[] {
  const contentSelector = [
    ".ProseMirror",
    ".cm-content",
    ".cm-editor",
    ".monaco-editor",
    ".markdown",
    ".prose",
    '[contenteditable="true"]',
    '[data-lexical-editor="true"]',
    "[data-page-number]",
    '[role="document"]',
    "main",
    "article",
    "section",
    "[class*='content' i]",
    "[class*='body' i]",
    "[class*='page' i]",
    "[class*='editor' i]"
  ].join(",");

  const candidates = [
    root,
    ...safeQueryAll(contentSelector, root)
  ].filter(isCanvasWidthTargetCandidate);

  return Array.from(new Set(candidates))
    .sort((first, second) => getCanvasCandidateScore(second) - getCanvasCandidateScore(first));
}

function getCanvasEvidenceDescriptor(element: HTMLElement): string {
  return [
    element.getAttribute("placeholder") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("title") || "",
    element.getAttribute("data-testid") || "",
    element.textContent || ""
  ].join(" ");
}

function hasCanvasModificationComposer(): boolean {
  const editPromptPattern = /(描述修改|修改内容|改写|编辑此|修改此|describe\s+(the\s+)?(change|edit|modification)|what\s+to\s+(change|edit|modify)|ask\s+.*\s+(change|edit|modify)|make\s+changes|edit\s+this|modify\s+this)/i;
  return safeQueryAll("textarea, input, [contenteditable='true'], [role='textbox']").some((element) => {
    if (element.closest(`#${ROOT_ID}`) || element.closest(CHATGPT_MESSAGE_OR_MARKER_SELECTOR)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (!isRectVisible(rect) || rect.width < 180 || rect.height < 24) {
      return false;
    }

    return editPromptPattern.test(getCanvasEvidenceDescriptor(element));
  });
}

function hasCanvasTopBarEvidence(): boolean {
  const controls = safeQueryAll("button, a, [role='button']").filter((element) => {
    if (element.closest(`#${ROOT_ID}`) || element.closest(CHATGPT_MESSAGE_OR_MARKER_SELECTOR)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return isRectVisible(rect) && rect.top < 130;
  });
  const hasLeftClose = controls.some((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < 180 && /(关闭|返回|退出|close|back|exit|×|x)/i.test(getCanvasEvidenceDescriptor(element));
  });
  const rightActionCount = controls.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.right > window.innerWidth - 260 &&
      /(复制|下载|全屏|打开|copy|download|fullscreen|expand|open)/i.test(getCanvasEvidenceDescriptor(element));
  }).length;

  return hasLeftClose && rightActionCount >= 2;
}

function hasCanvasModeEvidence(): boolean {
  return hasCanvasModificationComposer() || hasCanvasTopBarEvidence();
}

function getFallbackCanvasCandidateScore(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const textLength = Math.min(16000, normalizeText(element.innerText || element.textContent || "").length);
  const idealWidth = Math.min(980, Math.max(620, window.innerWidth * 0.48));
  const widthDistance = Math.abs(rect.width - idealWidth);
  const widthScore = Math.max(0, 460 - widthDistance * 0.42);
  const textScore = Math.min(700, textLength * 0.06);
  const heightScore = Math.min(260, rect.height * 0.12);
  const centerDistance = Math.abs((rect.left + rect.right) / 2 - window.innerWidth / 2);
  const centerScore = Math.max(0, 180 - centerDistance * 0.1);
  const hugePenalty = rect.width > window.innerWidth * 0.82 ? 520 : 0;
  const tinyPenalty = rect.width < 460 ? 180 : 0;
  const controlCount = safeQueryAll("button, input, textarea, select, [role='button']", element).length;
  const controlsPenalty = controlCount > 8 ? Math.min(360, controlCount * 18) : 0;

  return widthScore + textScore + heightScore + centerScore - hugePenalty - tinyPenalty - controlsPenalty;
}

function findFallbackCanvasWidthTarget(): CanvasWidthTarget | null {
  if (!hasCanvasModeEvidence()) {
    return null;
  }

  const root = document.querySelector<HTMLElement>("main") ?? document.body;
  if (!root || !isRectVisible(root.getBoundingClientRect())) {
    return null;
  }

  const candidates = Array.from(new Set([
    root,
    ...safeQueryAll("article, section, [role='document'], [role='main'], main, div", root).slice(0, 1800)
  ])).filter((element) => {
    if (isExcludedCanvasElement(element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (!isRectVisible(rect) || rect.width < 360 || rect.height < 120) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const textLength = normalizeText(element.innerText || element.textContent || "").length;
    return textLength >= 160;
  });

  const [target] = candidates.sort(
    (first, second) => getFallbackCanvasCandidateScore(second) - getFallbackCanvasCandidateScore(first)
  );

  return target ? createCanvasLayoutSession(findCanvasSessionRoot(root, target), target) : null;
}

function findCanvasWidthTargets(): CanvasWidthTarget[] {
  const roots = safeQueryAll(CANVAS_DISCOVERY_SELECTOR)
    .filter((element) =>
      !isExcludedCanvasElement(element) &&
      isCanvasLikeElement(element)
    );

  const targets: CanvasWidthTarget[] = [];
  const seenTargets = new Set<HTMLElement>();
  for (const root of roots.slice(0, 100)) {
    const [textRoot] = collectCanvasWidthTargetCandidates(root);
    if (!textRoot) {
      continue;
    }

    const session = createCanvasLayoutSession(findCanvasSessionRoot(root, textRoot), textRoot);
    if (seenTargets.has(session.layoutTarget)) {
      continue;
    }

    seenTargets.add(session.layoutTarget);
    targets.push(session);
  }

  const fallbackTarget = findFallbackCanvasWidthTarget();
  if (fallbackTarget && !seenTargets.has(fallbackTarget.layoutTarget)) {
    seenTargets.add(fallbackTarget.layoutTarget);
    targets.push(fallbackTarget);
  }

  return targets
    .sort((first, second) => getCanvasCandidateScore(second.textRoot) - getCanvasCandidateScore(first.textRoot))
    .slice(0, 12);
}

function clearOrphanedCanvasLayoutMarkers() {
  document
    .querySelectorAll<HTMLElement>("[data-cnav-canvas-root], [data-cnav-canvas-kind], [data-cnav-canvas-text-root], [data-cnav-canvas-scroll-root], [data-cnav-canvas-width-target], [data-cnav-canvas-active-target]")
    .forEach((element) => {
      element.removeAttribute("data-cnav-canvas-root");
      element.removeAttribute("data-cnav-canvas-kind");
      element.removeAttribute("data-cnav-canvas-text-root");
      element.removeAttribute("data-cnav-canvas-scroll-root");
      element.removeAttribute("data-cnav-canvas-width-target");
      element.removeAttribute("data-cnav-canvas-active-target");
      element.style.removeProperty("--cnav-canvas-target-width");
      element.style.removeProperty("--cnav-canvas-target-shift");
    });
}

function syncCanvasWidthTargets(
  settings: NavigatorSettings,
  currentSession: CanvasWidthTarget | null
): CanvasWidthTarget | null {
  if (isCanvasLayoutSessionConnected(currentSession)) {
    markCanvasLayoutSession(currentSession, shouldApplyCanvasWidthLayout(settings));
    return currentSession;
  }

  clearCanvasLayoutSession(currentSession);
  clearOrphanedCanvasLayoutMarkers();
  const targets = findCanvasWidthTargets();
  const activeTarget = targets[0] ?? null;
  if (activeTarget) {
    markCanvasLayoutSession(activeTarget, shouldApplyCanvasWidthLayout(settings));
  }

  return activeTarget;
}

function getActiveCanvasWidthTarget(): CanvasWidthTarget | null {
  const layoutTarget =
    document.querySelector<HTMLElement>('[data-cnav-canvas-active-target="true"]') ??
    document.querySelector<HTMLElement>('[data-cnav-canvas-width-target="true"]');
  const root = document.querySelector<HTMLElement>('[data-cnav-canvas-root="true"]');
  const textRoot = document.querySelector<HTMLElement>('[data-cnav-canvas-text-root="true"]');
  if (!layoutTarget || !root || !textRoot || !isRectVisible(layoutTarget.getBoundingClientRect())) {
    return null;
  }

  const session = createCanvasLayoutSession(root, textRoot);
  session.layoutTarget = layoutTarget;
  session.scrollContainer = document.querySelector<HTMLElement>('[data-cnav-canvas-scroll-root="true"]');
  session.lastWidthPixels = Number.parseFloat(
    layoutTarget.style.getPropertyValue("--cnav-canvas-target-width")
  ) || null;
  return session;
}

function getCanvasResizeBoundsRect(target: HTMLElement, root: HTMLElement): DOMRect {
  const targetRect = target.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  let bestRect = isRectVisible(rootRect) ? rootRect : targetRect;

  for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (parent.closest(`#${ROOT_ID}`) || parent.closest(CHATGPT_MESSAGE_OR_MARKER_SELECTOR)) {
      continue;
    }

    const rect = parent.getBoundingClientRect();
    if (
      !isRectVisible(rect) ||
      rect.width < targetRect.width + 80 ||
      rect.height < Math.min(220, targetRect.height * 0.5)
    ) {
      continue;
    }

    if (isCanvasLikeElement(parent) || rect.width > bestRect.width + 80) {
      bestRect = rect;
      break;
    }
  }

  if (bestRect.width < targetRect.width + 80) {
    const mainRect = document.querySelector<HTMLElement>("main")?.getBoundingClientRect();
    if (mainRect && isRectVisible(mainRect) && mainRect.width > bestRect.width + 80) {
      bestRect = mainRect;
    }
  }

  return bestRect;
}

function getCanvasResizeMetrics(
  target: CanvasWidthTarget,
  settings: NavigatorSettings,
  widthPixelsOverride?: number
): CanvasResizeMetrics | null {
  const boundsRect = getCanvasResizeBoundsRect(target.layoutTarget, target.root);
  const leftBound = Math.max(0, boundsRect.left);
  const rightBound = Math.min(window.innerWidth, boundsRect.right);
  if (rightBound - leftBound < 360) {
    return null;
  }

  const availableWidth = Math.max(340, rightBound - leftBound - 24);
  const desiredWidth = widthPixelsOverride ?? getThreadWidthPixels(settings.canvasContentWidth);
  const width = Math.min(desiredWidth, availableWidth);
  const center = leftBound + (rightBound - leftBound) / 2;

  return {
    boundsRect,
    leftBound,
    rightBound,
    availableWidth,
    width,
    center
  };
}

function applyCanvasWidthTargetLayout(
  target: CanvasWidthTarget,
  settings: NavigatorSettings,
  widthPixelsOverride?: number
): CanvasResizeMetrics | null {
  const metrics = getCanvasResizeMetrics(target, settings, widthPixelsOverride);
  if (!metrics) {
    target.layoutTarget.style.removeProperty("--cnav-canvas-target-width");
    target.lastWidthPixels = null;
    return null;
  }

  const scrollSnapshot = captureCanvasScroll(target);
  if (applyCanvasLayoutWidth(target, metrics.width)) {
    window.requestAnimationFrame(() => {
      restoreCanvasScroll(scrollSnapshot);
      window.requestAnimationFrame(() => restoreCanvasScroll(scrollSnapshot));
    });
  }

  return metrics;
}

function getCanvasResizeFrameFromMetrics(target: CanvasWidthTarget, metrics: CanvasResizeMetrics): ResizeFrame {
  const targetRect = target.textRoot.getBoundingClientRect();
  const boundsRect = metrics.boundsRect;
  const topCandidate = Math.max(targetRect.top, boundsRect.top + 52);
  const top = Math.max(76, Math.min(Math.round(topCandidate), window.innerHeight - 320));
  const bottomCandidate = Math.min(window.innerHeight - 72, Math.max(targetRect.bottom, boundsRect.bottom - 32));
  const height = Math.max(260, Math.round(bottomCandidate - top));

  return {
    left: Math.round(metrics.center - metrics.width / 2),
    right: Math.round(metrics.center + metrics.width / 2),
    top,
    height,
    toggleLeft: Math.round(Math.max(18, metrics.leftBound + 18))
  };
}

function getCanvasResizeFrame(
  target: CanvasWidthTarget,
  settings: NavigatorSettings,
  widthPixelsOverride?: number
): ResizeFrame | null {
  const metrics = getCanvasResizeMetrics(target, settings, widthPixelsOverride);
  return metrics ? getCanvasResizeFrameFromMetrics(target, metrics) : null;
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
  addCandidate(element.querySelector<HTMLElement>('article[data-testid*="conversation-turn" i]'));
  addCandidate(element.querySelector<HTMLElement>('[data-testid*="conversation-turn" i]'));
  addCandidate(element.closest<HTMLElement>("[data-message-id]"));
  addCandidate(element.closest<HTMLElement>("[data-turn-id]"));
  addCandidate(element.closest<HTMLElement>('article[data-testid*="conversation-turn" i]'));
  addCandidate(element.closest<HTMLElement>('[data-testid*="conversation-turn" i]'));
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
    element.closest<HTMLElement>('article[data-testid*="conversation-turn" i]') ??
    element.closest<HTMLElement>('[data-testid*="conversation-turn" i]') ??
    element.closest<HTMLElement>("[data-turn-id]") ??
    element.closest<HTMLElement>("[data-message-id]") ??
    element.closest<HTMLElement>(CHATGPT_MESSAGE_NODE_SELECTOR) ??
    element
  );
}

function markMessageRole(element: HTMLElement, role: Role) {
  const anchorElement = getMessageAnchorElement(element);
  const nativeRoleSelector = `[data-message-author-role="${role}"]`;
  if (
    element.matches(nativeRoleSelector) ||
    Boolean(element.querySelector(nativeRoleSelector)) ||
    anchorElement.matches(nativeRoleSelector) ||
    Boolean(anchorElement.querySelector(nativeRoleSelector))
  ) {
    element.removeAttribute(MESSAGE_ROLE_ATTR);
    anchorElement.removeAttribute(MESSAGE_ROLE_ATTR);
    return;
  }

  element.setAttribute(MESSAGE_ROLE_ATTR, role);
  anchorElement.setAttribute(MESSAGE_ROLE_ATTR, role);
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
  addCandidate(element.closest<HTMLElement>('article[data-testid*="conversation-turn" i]'));
  addCandidate(element.closest<HTMLElement>('[data-testid*="conversation-turn" i]'));
  addCandidate(element.querySelector<HTMLElement>('article[data-testid*="conversation-turn" i]'));
  addCandidate(element.querySelector<HTMLElement>('[data-testid*="conversation-turn" i]'));
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
  return item.promptPreview;
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
  const text = `${item.promptPreview} ${item.answerSummary}`.toLowerCase();

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
      continue;
    }

    groups.push({
      id: `${kind}-${stableHash(item.id).slice(0, 8)}`,
      kind,
      label: getNavigatorGroupLabel(kind, language),
      items: [item]
    });
  }

  return groups;
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

function buildNavigatorData(): BuildNavigatorResult {
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
  anchorRegistry.clear();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    markMessageRole(message.element, message.role);
    const id = getStableAnchorId(message);
    const domOrder = getMessageDomOrder(message, index);

    messageIds.push(id);
    messageDomOrders.push(domOrder);
    anchorRegistry.set(id, getMessageAnchorElement(message.element));
  }

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const id = messageIds[index];
    const domOrder = messageDomOrders[index] ?? index;

    if (message.role !== "user") {
      mapEntries.push({
        id,
        role: message.role,
        text: message.text,
        turnIndex: Math.max(1, items.length),
        domOrder,
        mounted: true
      });
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

    items.push({
      id,
      promptPreview: compactPreview(message.text, 112),
      answerSummary: summarizeAnswer(answerParts.join("\n\n")),
      turnIndex: items.length + 1,
      domOrder,
      mounted: true
    });

    mapEntries.push({
      id,
      role: message.role,
      text: message.text,
      turnIndex: items.length,
      domOrder,
      mounted: true
    });
  }

  return {
    items,
    mapEntries,
    health: {
      ...collection.health,
      canAnchor: anchorRegistry.size > 0
    }
  };
}

function getNavigatorItemKey(item: NavigatorItem): string {
  return stableHash(
    [
      normalizeText(item.promptPreview).toLowerCase(),
      normalizeText(item.answerSummary).toLowerCase()
    ].join("|")
  );
}

function getMapEntryKey(entry: MessageMapEntry): string {
  return stableHash(
    [
      entry.role,
      normalizeText(entry.text).toLowerCase()
    ].join("|")
  );
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
  previousScrollY: number
): Pick<BuildNavigatorResult, "items" | "mapEntries"> {
  if (previousItems.length === 0) {
    return {
      items: normalizeNavigatorOrder(currentItems.map((item) => ({ ...item, mounted: true }))),
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
    const mergedItem: NavigatorItem = {
      ...(matched ?? item),
      ...item,
      id: mergedId,
      mounted: true
    };

    currentMergedItems.push(mergedItem);
    if (matched) {
      usedPreviousIds.add(matched.id);
      matchedCurrentIds.add(mergedId);
      replacementByPreviousId.set(matched.id, mergedItem);
    }
  }

  const result = previousItems.map((item) =>
    replacementByPreviousId.get(item.id) ?? { ...item, mounted: false }
  );

  const currentScrollTop = getCurrentConversationScrollTop();
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

    if (currentScrollTop < previousScrollY) {
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
    mapEntries: normalizeMapEntryOrder(mergeMapEntries(previousEntries, currentEntries, currentToMergedId))
  };
}

function mergeMapEntries(
  previousEntries: MessageMapEntry[],
  currentEntries: MessageMapEntry[],
  currentToMergedId: Map<string, string>
): MessageMapEntry[] {
  const result = previousEntries.map((entry) => ({
    ...entry,
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
    element.matches(CHATGPT_TURN_OR_MARKER_SELECTOR) ||
      Boolean(element.querySelector(CHATGPT_MESSAGE_OR_MARKER_SELECTOR))
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

function isScrollableElement(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const canScroll = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
  return canScroll && element.clientHeight > 48 && element.scrollHeight > element.clientHeight + 4;
}

function getScrollContainer(element: HTMLElement): HTMLElement | Window {
  let current: HTMLElement | null = element;
  while (current && current !== document.body && current !== document.documentElement) {
    if (isScrollableElement(current)) {
      return current;
    }
    current = current.parentElement;
  }

  return window;
}

function getContainerViewportRect(scrollContainer: HTMLElement | Window): { top: number; bottom: number; height: number } {
  if (scrollContainer === window) {
    return {
      top: 0,
      bottom: window.innerHeight,
      height: Math.max(1, window.innerHeight)
    };
  }

  const rect = (scrollContainer as HTMLElement).getBoundingClientRect();
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  return {
    top,
    bottom,
    height: Math.max(1, bottom - top)
  };
}

function getContainerScrollTop(scrollContainer: HTMLElement | Window): number {
  return scrollContainer === window ? window.scrollY : (scrollContainer as HTMLElement).scrollTop;
}

function getContainerScrollHeight(scrollContainer: HTMLElement | Window): number {
  if (scrollContainer === window) {
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return Math.max(scrollingElement.scrollHeight, document.documentElement.scrollHeight, document.body.scrollHeight);
  }

  return (scrollContainer as HTMLElement).scrollHeight;
}

function getContainerClientHeight(scrollContainer: HTMLElement | Window): number {
  return scrollContainer === window ? window.innerHeight : (scrollContainer as HTMLElement).clientHeight;
}

function getPrimaryConversationScrollContainer(): HTMLElement | Window {
  const firstAnchor = getConversationAnchorElements()[0];
  if (firstAnchor) {
    return getScrollContainer(firstAnchor);
  }

  const main = document.querySelector<HTMLElement>("main");
  return main ? getScrollContainer(main) : window;
}

function getCurrentConversationScrollTop(): number {
  return getContainerScrollTop(getPrimaryConversationScrollContainer());
}

function setCurrentConversationScrollTop(top: number) {
  const scrollContainer = getPrimaryConversationScrollContainer();
  if (scrollContainer === window) window.scrollTo({ top, behavior: "auto" });
  else (scrollContainer as HTMLElement).scrollTo({ top, behavior: "auto" });
}

function isElementVisibleInContainer(element: HTMLElement, scrollContainer: HTMLElement | Window): boolean {
  const rect = element.getBoundingClientRect();
  const viewport = getContainerViewportRect(scrollContainer);
  return rect.bottom >= viewport.top + 10 && rect.top <= viewport.bottom - 10;
}

function scrollElementIntoView(element: HTMLElement, animate: boolean) {
  try {
    element.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: animate ? "smooth" : "auto"
    });
  } catch {
    element.scrollIntoView();
  }
}

function verifyJump(element: HTMLElement, scrollContainer: HTMLElement | Window, delay = 80) {
  window.setTimeout(() => {
    const activeScrollContainer = document.body.contains(element) ? getScrollContainer(element) : scrollContainer;
    const rect = element.getBoundingClientRect();
    const viewport = getContainerViewportRect(activeScrollContainer);
    const topLimit = activeScrollContainer === window ? viewport.top + 72 : viewport.top + 16;
    const bottomLimit = activeScrollContainer === window ? viewport.bottom - 96 : viewport.bottom - 16;

    if (rect.bottom >= topLimit && rect.top <= bottomLimit) {
      return;
    }

    if (activeScrollContainer === window) {
      const top = Math.max(0, window.scrollY + rect.top - topLimit);
      scrollWindowTo(top, false);
      window.setTimeout(() => {
        if (!isElementVisibleInContainer(element, getScrollContainer(element))) {
          scrollElementIntoView(element, false);
        }
      }, 80);
      return;
    }

    const scrollElement = activeScrollContainer as HTMLElement;
    const containerRect = scrollElement.getBoundingClientRect();
    const top = Math.max(0, scrollElement.scrollTop + rect.top - containerRect.top - 16);
    scrollElementTo(scrollElement, top, false);
    window.setTimeout(() => {
      if (!isElementVisibleInContainer(element, getScrollContainer(element))) {
        scrollElementIntoView(element, false);
      }
    }, 80);
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

function toPageAdapterHealth(health: AdapterHealth): PageAdapterHealth {
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

function getPageSourceMeta() {
  return {
    sourceUrl: location.href,
    sourceTitle: document.title || getAdapter().label,
    pageKey: getPageId()
  };
}

function getMaterialTitle(text: string, fallback: string): string {
  return compactPreview(normalizeText(text), 72) || fallback;
}

function getAllReadableCodeBlocks(): HTMLPreElement[] {
  return safeQueryAll("main pre")
    .filter((element): element is HTMLPreElement => element instanceof HTMLPreElement)
    .filter((pre) => !pre.closest(`#${ROOT_ID}`))
    .filter((pre) => {
      const text = extractCodeBlockText(pre);
      if (!text.trim()) {
        return false;
      }

      const style = window.getComputedStyle(pre);
      return style.display !== "none" && style.visibility !== "hidden";
    });
}

function createPageMaterials(): PageMaterial[] {
  const source = getPageSourceMeta();
  const collection = getAdapter().collect();
  const prompts = collection.messages
    .filter((message) => message.role === "user")
    .slice(0, 80)
    .map<PageMaterial>((message, index) => {
      const text = normalizeText(message.text).slice(0, 200000);
      return {
        id: `prompt-${stableHash(`${source.pageKey}:${index}:${text}`)}`,
        kind: "prompt",
        title: getMaterialTitle(text, `Prompt ${index + 1}`),
        text,
        ...source
      };
    })
    .filter((material) => material.text.length > 0);

  const codeBlocks = getAllReadableCodeBlocks()
    .slice(0, 120)
    .map<PageMaterial>((pre, index) => {
      const text = extractCodeBlockText(pre).slice(0, 200000);
      const language = detectCodeLanguage(pre);
      const filename = detectCodeFilename(pre, index + 1, language);
      return {
        id: `code-${stableHash(`${source.pageKey}:${index}:${filename}:${text}`)}`,
        kind: "code",
        title: filename || getMaterialTitle(text, `Code ${index + 1}`),
        text,
        language,
        filename,
        ...source
      };
    })
    .filter((material) => material.text.length > 0);

  return [...prompts, ...codeBlocks];
}

function createSelectionMaterial(): SelectionMaterial | null {
  const selection = window.getSelection();
  const rawText = selection?.toString() ?? "";
  const text = rawText.trim();
  if (!selection || !text) {
    return null;
  }

  const source = getPageSourceMeta();
  const parentNode = selection.anchorNode instanceof HTMLElement
    ? selection.anchorNode
    : selection.anchorNode?.parentNode instanceof HTMLElement
      ? selection.anchorNode.parentNode
      : null;
  const pre = parentNode?.closest<HTMLPreElement>("pre") ?? null;

  if (pre && !pre.closest(`#${ROOT_ID}`)) {
    const language = detectCodeLanguage(pre);
    const filename = detectCodeFilename(pre, 1, language);
    return {
      id: `selection-code-${stableHash(`${source.pageKey}:${filename}:${text}`)}`,
      kind: "code",
      title: filename || getMaterialTitle(text, "Selected code"),
      text,
      language,
      filename,
      ...source
    };
  }

  return {
    id: `selection-${stableHash(`${source.pageKey}:${text}`)}`,
    kind: "selection",
    title: getMaterialTitle(text, "Selected text"),
    text,
    ...source
  };
}

function createExportMessages(): ExportChatMessage[] {
  const collection = getAdapter().collect();
  return sortByDomOrder(collection.messages)
    .map<ExportChatMessage>((message, index) => {
      const text = normalizeText(message.text);
      return {
        id: `message-${stableHash(`${message.role}:${index}:${text}`)}`,
        role: message.role,
        text,
        turnIndex: getNativeTurnOrder(getMessageAnchorElement(message.element)) ?? index + 1
      };
    })
    .filter((message) => message.text.length > 0);
}

function createExportCodeBlocks(): ExportCodeBlock[] {
  const source = getPageSourceMeta();
  return getAllReadableCodeBlocks()
    .slice(0, 160)
    .map<ExportCodeBlock>((pre, index) => {
      const text = extractCodeBlockText(pre);
      const language = detectCodeLanguage(pre);
      const filename = detectCodeFilename(pre, index + 1, language);
      return {
        id: `export-code-${stableHash(`${source.pageKey}:${index}:${filename}:${text}`)}`,
        text,
        language,
        filename
      };
    })
    .filter((block) => block.text.trim().length > 0);
}

function createExportNodes(): ExportNavigatorNode[] {
  const stateItems = latestNavigatorExportState.items.length
    ? latestNavigatorExportState.items
    : buildNavigatorData().items;
  const groups = buildNavigatorGroups(stateItems, latestNavigatorExportState.language);
  const groupByItemId = new Map<string, string>();
  for (const group of groups) {
    for (const item of group.items) {
      groupByItemId.set(item.id, group.label);
    }
  }

  return stateItems.map((item) => ({
    id: item.id,
    title: getNavigatorDisplayTitle(item),
    promptPreview: item.promptPreview,
    answerSummary: item.answerSummary,
    groupLabel: groupByItemId.get(item.id) ?? getNavigatorGroupLabel(inferNavigatorGroupKind(item), latestNavigatorExportState.language),
    turnIndex: item.turnIndex
  }));
}

function createExportSnapshot(): ExportSnapshot {
  const source = getPageSourceMeta();
  return {
    title: source.sourceTitle,
    url: source.sourceUrl,
    pageKey: source.pageKey,
    exportedAt: Date.now(),
    messages: createExportMessages(),
    codeBlocks: createExportCodeBlocks(),
    nodes: createExportNodes()
  };
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

interface TablePointerSnapshot {
  x: number;
  y: number;
  time: number;
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
const TABLE_COPY_POINTER_TTL_MS = 12000;
const TABLE_COPY_POINTER_RIGHT_EXTENSION = TABLE_COPY_OUTSIDE_GAP + TABLE_COPY_TOOLBAR_WIDTH + 96;
const TABLE_COPY_POINTER_LEFT_TOLERANCE = 12;
const TABLE_COPY_POINTER_VERTICAL_TOLERANCE = 22;
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

function getTableCellCount(table: HTMLTableElement): number {
  return Array.from(table.rows).reduce((sum, row) => sum + row.cells.length, 0);
}

function getTableTextSignature(table: HTMLTableElement): string {
  const matrixText = Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells)
        .map((cell) => normalizeText(cell.textContent || ""))
        .join("\u001f")
    )
    .join("\u001e");

  return stableHash(matrixText || normalizeText(table.textContent || ""));
}

function getRectOverlapRatio(first: DOMRect, second: DOMRect): number {
  const left = Math.max(first.left, second.left);
  const right = Math.min(first.right, second.right);
  const top = Math.max(first.top, second.top);
  const bottom = Math.min(first.bottom, second.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const overlapArea = width * height;
  const smallerArea = Math.min(first.width * first.height, second.width * second.height);

  return smallerArea > 0 ? overlapArea / smallerArea : 0;
}

function areTableRectsVisuallySame(first: DOMRect, second: DOMRect): boolean {
  const edgeTolerance = 4;
  if (
    Math.abs(first.left - second.left) <= edgeTolerance &&
    Math.abs(first.top - second.top) <= edgeTolerance &&
    Math.abs(first.right - second.right) <= edgeTolerance &&
    Math.abs(first.bottom - second.bottom) <= edgeTolerance
  ) {
    return true;
  }

  return getRectOverlapRatio(first, second) >= 0.97;
}

function areDuplicateCopyableTables(first: HTMLTableElement, second: HTMLTableElement): boolean {
  const firstRect = first.getBoundingClientRect();
  const secondRect = second.getBoundingClientRect();

  return areTableRectsVisuallySame(firstRect, secondRect) &&
    getTableTextSignature(first) === getTableTextSignature(second);
}

function pickPreferredCopyableTable(first: HTMLTableElement, second: HTMLTableElement): HTMLTableElement {
  const firstCellCount = getTableCellCount(first);
  const secondCellCount = getTableCellCount(second);
  if (firstCellCount !== secondCellCount) {
    return secondCellCount > firstCellCount ? second : first;
  }

  if (first.rows.length !== second.rows.length) {
    return second.rows.length > first.rows.length ? second : first;
  }

  if (first.contains(second)) {
    return second;
  }

  return first;
}

function dedupeCopyableTables(tables: HTMLTableElement[]): HTMLTableElement[] {
  const unique: HTMLTableElement[] = [];

  for (const table of tables) {
    const existingIndex = unique.findIndex((candidate) => areDuplicateCopyableTables(candidate, table));
    if (existingIndex < 0) {
      unique.push(table);
      continue;
    }

    unique[existingIndex] = pickPreferredCopyableTable(unique[existingIndex], table);
  }

  return unique;
}

function findCopyableTables(): HTMLTableElement[] {
  const candidates = safeQueryAll("main table")
    .filter((element): element is HTMLTableElement => element instanceof HTMLTableElement)
    .filter(isCopyableTable);

  return dedupeCopyableTables(candidates);
}

function getCopyableTableFromTarget(target: EventTarget | null): HTMLTableElement | null {
  if (!(target instanceof Element) || target.closest(`#${ROOT_ID}`)) {
    return null;
  }

  const table = target.closest("table");
  return table instanceof HTMLTableElement && isCopyableTable(table) ? table : null;
}

function getFreshTablePointer(pointer: TablePointerSnapshot | null): TablePointerSnapshot | null {
  if (!pointer || Date.now() - pointer.time > TABLE_COPY_POINTER_TTL_MS) {
    return null;
  }

  return pointer;
}

function getTablePointerScore(table: HTMLTableElement, pointer: TablePointerSnapshot): number {
  const rect = getClippedTableRect(table);
  const left = rect.left - TABLE_COPY_POINTER_LEFT_TOLERANCE;
  const right = rect.right + TABLE_COPY_POINTER_RIGHT_EXTENSION;
  const top = rect.top - TABLE_COPY_POINTER_VERTICAL_TOLERANCE;
  const bottom = rect.bottom + TABLE_COPY_POINTER_VERTICAL_TOLERANCE;

  if (pointer.x < left || pointer.x > right || pointer.y < top || pointer.y > bottom) {
    return Number.POSITIVE_INFINITY;
  }

  const horizontalDistance = pointer.x < rect.left
    ? rect.left - pointer.x
    : pointer.x > rect.right
      ? pointer.x - rect.right
      : 0;
  const verticalDistance = pointer.y < rect.top
    ? rect.top - pointer.y
    : pointer.y > rect.bottom
      ? pointer.y - rect.bottom
      : 0;
  const centerDistance = Math.abs(pointer.y - (rect.top + rect.bottom) / 2);

  return verticalDistance * 6 + horizontalDistance * 0.4 + centerDistance * 0.04;
}

function pickCopyableTableNearPointer(
  tables: HTMLTableElement[],
  pointer: TablePointerSnapshot
): HTMLTableElement | null {
  let bestTable: HTMLTableElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const table of tables) {
    const score = getTablePointerScore(table, pointer);
    if (score < bestScore) {
      bestScore = score;
      bestTable = table;
    }
  }

  return Number.isFinite(bestScore) ? bestTable : null;
}

function pickActiveCopyableTable(
  tables: HTMLTableElement[],
  preferredTable: HTMLTableElement | null,
  pointer: TablePointerSnapshot | null,
  forcedTableId: string | null
): HTMLTableElement | null {
  if (forcedTableId) {
    const forcedTable = tables.find((table) => getTableCopyId(table) === forcedTableId);
    if (forcedTable) {
      return forcedTable;
    }
  }

  if (preferredTable && tables.includes(preferredTable)) {
    return preferredTable;
  }

  const freshPointer = getFreshTablePointer(pointer);
  return freshPointer ? pickCopyableTableNearPointer(tables, freshPointer) : null;
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

const OFFICIAL_POPOVER_SELECTORS = [
  '[role="menu"]',
  '[role="dialog"]',
  '[role="listbox"]',
  "[data-radix-popper-content-wrapper]",
  "[data-radix-menu-content]",
  "[data-radix-popover-content]",
  '[data-state="open"][data-side]',
  '[data-state="open"][data-align]',
  '[class*="popover" i]',
  '[class*="dropdown" i]',
  '[class*="menu" i]'
].join(",");

function isOfficialPopoverElement(element: HTMLElement): boolean {
  if (
    element.closest(`#${ROOT_ID}`) ||
    element === document.body ||
    element === document.documentElement ||
    element.closest(`main ${CHATGPT_MESSAGE_OR_MARKER_SELECTOR}`)
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (!isRectVisible(rect) || rect.width < 32 || rect.height < 28) {
    return false;
  }

  if (
    rect.width > window.innerWidth * 0.52 &&
    rect.height > window.innerHeight * 0.52 &&
    hasCanvasModeEvidence()
  ) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0 ||
    element.getAttribute("aria-hidden") === "true" ||
    element.hidden
  ) {
    return false;
  }

  const role = element.getAttribute("role") || "";
  const descriptor = [
    role,
    element.getAttribute("class") || "",
    element.getAttribute("data-state") || "",
    element.getAttribute("data-side") || "",
    element.getAttribute("data-align") || ""
  ].join(" ");
  const explicitPopover = /(menu|dialog|listbox|popover|dropdown|radix|open)/i.test(descriptor) ||
    element.hasAttribute("data-radix-popper-content-wrapper") ||
    element.hasAttribute("data-radix-menu-content") ||
    element.hasAttribute("data-radix-popover-content");
  if (!explicitPopover) {
    return false;
  }

  const zIndex = Number.parseInt(style.zIndex || "0", 10);
  const floatingLike = /(fixed|absolute|sticky)/.test(style.position) || zIndex >= 10;
  const nearTopRightMenu = rect.top < 260 && rect.right > window.innerWidth - 420;
  const modalLike = role === "dialog" && rect.width >= 240 && rect.height >= 120;

  return floatingLike || nearTopRightMenu || modalLike;
}

function hasOpenOfficialPopover(): boolean {
  return safeQueryAll(OFFICIAL_POPOVER_SELECTORS).some(isOfficialPopoverElement);
}

function getFloatingAvoidRects(navigatorCollapsed: boolean): DOMRect[] {
  const rects: DOMRect[] = [];
  void navigatorCollapsed;

  for (const handle of safeQueryAll(`#${ROOT_ID} :is(.cnav-thread-handle,.cnav-reading-actions)`)) {
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
    : { right: 22, bottom: 82 };
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
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [preferredFormat, setPreferredFormat] = useState<TableCopyFormat>(() => readPreferredTableCopyFormat());
  const [copied, setCopied] = useState<{ id: string; format: TableCopyFormat } | null>(null);
  const [hoveredCell, setHoveredCell] = useState<TableCellCoordinate | null>(null);
  const [selectionModeTableId, setSelectionModeTableId] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<TableAreaSelection | null>(null);
  const activeTableRef = useRef<HTMLTableElement | null>(null);
  const pointerSnapshotRef = useRef<TablePointerSnapshot | null>(null);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const selectionStartRef = useRef<TableCellCoordinate | null>(null);

  const updateOverlays = useCallback(() => {
    const avoidRects = getFloatingAvoidRects(navigatorCollapsed);
    const tables = findCopyableTables();
    const nextOverlays = tables
      .map((table, index) => getTableCopyOverlay(table, avoidRects, index + 1, tables.length))
      .filter((overlay): overlay is TableCopyOverlay => Boolean(overlay));

    setOverlays((current) => (areTableOverlaysEqual(current, nextOverlays) ? current : nextOverlays));
    const forcedTableId = menuId || selectionModeTableId || activeSelection?.tableId || copied?.id || null;
    const activeTable = pickActiveCopyableTable(tables, activeTableRef.current, pointerSnapshotRef.current, forcedTableId);
    const nextActiveTableId = activeTable ? getTableCopyId(activeTable) : null;
    setActiveTableId((current) => (current === nextActiveTableId ? current : nextActiveTableId));
  }, [activeSelection, copied, menuId, navigatorCollapsed, selectionModeTableId]);

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

    const rememberPointer = (event: PointerEvent, force = false) => {
      if (event.target instanceof Element && event.target.closest(`#${ROOT_ID}`)) {
        return false;
      }

      const current = pointerSnapshotRef.current;
      pointerSnapshotRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: Date.now()
      };

      if (force || !current) {
        return true;
      }

      return Math.abs(current.x - event.clientX) > 6 || Math.abs(current.y - event.clientY) > 6;
    };

    const updateActiveTableFromTarget = (target: EventTarget | null) => {
      const table = getCopyableTableFromTarget(target);
      if (table) {
        if (activeTableRef.current === table) {
          return false;
        }

        activeTableRef.current = table;
        return true;
      }

      if (target instanceof Element && target.closest(`#${ROOT_ID}`)) {
        return false;
      }

      if (!activeTableRef.current) {
        return false;
      }

      activeTableRef.current = null;
      return true;
    };

    const handlePointerOver = (event: PointerEvent) => {
      const pointerChanged = rememberPointer(event, true);
      const activeChanged = updateActiveTableFromTarget(event.target);
      if (pointerChanged || activeChanged) {
        scheduleUpdate();
      }
    };

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("pointerover", handlePointerOver, true);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("pointerover", handlePointerOver, true);
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
      console.warn("[GPT页面增强工具] 复制表格失败：", error);
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
      console.warn("[GPT页面增强工具] 复制表格区域失败：", error);
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
    activeTableRef.current = nextOverlay.table;
    setActiveTableId(nextOverlay.id);
    setMenuId(nextOverlay.id);
  };

  if (overlays.length === 0) {
    return null;
  }

  const visibleTableId = menuId || selectionModeTableId || activeSelection?.tableId || copied?.id || activeTableId;
  const overlay = visibleTableId ? overlays.find((candidate) => candidate.id === visibleTableId) : null;

  if (!overlay) {
    return null;
  }

  const isCopied = copied?.id === overlay.id;
  const activeFormat = isCopied ? copied.format : preferredFormat;
  const title = `${isCopied ? labels.copied : labels.copy} · ${labels.formats[activeFormat]}`;
  const rowMatrix = getHoveredMatrix(overlay.table, hoveredCell, "row");
  const columnMatrix = getHoveredMatrix(overlay.table, hoveredCell, "column");
  const selectionMatrix = getSelectionMatrix(overlay.table, activeSelection);
  const activeOverlayIndex = overlays.findIndex((candidate) => candidate.id === overlay.id);
  const canJumpPrevious = activeOverlayIndex > 0;
  const canJumpNext = activeOverlayIndex >= 0 && activeOverlayIndex < overlays.length - 1;

  return (
    <div className="cnav-table-copy-layer" data-theme={theme}>
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

interface CodeBlockPointerSnapshot {
  x: number;
  y: number;
  time: number;
}

const CODE_BLOCK_TOOLBAR_WIDTH = 42;
const CODE_BLOCK_TOOLBAR_HEIGHT = 136;
const CODE_BLOCK_OUTSIDE_GAP = 48;
const CODE_BLOCK_POINTER_TTL_MS = 12000;
const CODE_BLOCK_POINTER_RIGHT_EXTENSION = CODE_BLOCK_OUTSIDE_GAP + CODE_BLOCK_TOOLBAR_WIDTH + 96;
const CODE_BLOCK_POINTER_LEFT_TOLERANCE = 14;
const CODE_BLOCK_POINTER_VERTICAL_TOLERANCE = 28;
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
  const candidates = safeQueryAll("main pre")
    .filter((element): element is HTMLPreElement => element instanceof HTMLPreElement)
    .filter(isCopyableCodeBlock);

  return dedupeCopyableCodeBlocks(candidates);
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

function getCodeBlockTextSignature(pre: HTMLPreElement): string {
  return stableHash(extractCodeBlockText(pre));
}

function areDuplicateCopyableCodeBlocks(first: HTMLPreElement, second: HTMLPreElement): boolean {
  const firstRect = first.getBoundingClientRect();
  const secondRect = second.getBoundingClientRect();

  return areTableRectsVisuallySame(firstRect, secondRect) &&
    getCodeBlockTextSignature(first) === getCodeBlockTextSignature(second);
}

function pickPreferredCopyableCodeBlock(first: HTMLPreElement, second: HTMLPreElement): HTMLPreElement {
  if (first.contains(second)) {
    return second;
  }

  if (second.contains(first)) {
    return first;
  }

  const firstTextLength = extractCodeBlockText(first).length;
  const secondTextLength = extractCodeBlockText(second).length;
  return secondTextLength > firstTextLength ? second : first;
}

function dedupeCopyableCodeBlocks(blocks: HTMLPreElement[]): HTMLPreElement[] {
  const unique: HTMLPreElement[] = [];

  for (const block of blocks) {
    const existingIndex = unique.findIndex((candidate) => areDuplicateCopyableCodeBlocks(candidate, block));
    if (existingIndex < 0) {
      unique.push(block);
      continue;
    }

    unique[existingIndex] = pickPreferredCopyableCodeBlock(unique[existingIndex], block);
  }

  return unique;
}

function getCopyableCodeBlockFromTarget(target: EventTarget | null): HTMLPreElement | null {
  if (!(target instanceof Element) || target.closest(`#${ROOT_ID}`)) {
    return null;
  }

  const pre = target.closest("pre");
  return pre instanceof HTMLPreElement && isCopyableCodeBlock(pre) ? pre : null;
}

function getCodeBlockViewportScore(pre: HTMLPreElement): number {
  const rect = pre.getBoundingClientRect();
  const visibleTop = Math.max(rect.top, 76);
  const visibleBottom = Math.min(rect.bottom, window.innerHeight - 72);

  if (visibleBottom <= visibleTop) {
    return Number.POSITIVE_INFINITY;
  }

  const visibleCenter = (visibleTop + visibleBottom) / 2;
  const targetCenter = window.innerHeight * 0.48;
  return Math.abs(visibleCenter - targetCenter);
}

function getCodeBlockPointerScore(pre: HTMLPreElement, pointer: CodeBlockPointerSnapshot): number {
  const rect = pre.getBoundingClientRect();
  const left = rect.left - CODE_BLOCK_POINTER_LEFT_TOLERANCE;
  const right = rect.right + CODE_BLOCK_POINTER_RIGHT_EXTENSION;
  const top = rect.top - CODE_BLOCK_POINTER_VERTICAL_TOLERANCE;
  const bottom = rect.bottom + CODE_BLOCK_POINTER_VERTICAL_TOLERANCE;

  if (pointer.x < left || pointer.x > right || pointer.y < top || pointer.y > bottom) {
    return Number.POSITIVE_INFINITY;
  }

  const horizontalDistance = pointer.x < rect.left
    ? rect.left - pointer.x
    : pointer.x > rect.right
      ? pointer.x - rect.right
      : 0;
  const verticalDistance = pointer.y < rect.top
    ? rect.top - pointer.y
    : pointer.y > rect.bottom
      ? pointer.y - rect.bottom
      : 0;
  const centerDistance = Math.abs(pointer.y - (rect.top + rect.bottom) / 2);

  return verticalDistance * 6 + horizontalDistance * 0.45 + centerDistance * 0.05;
}

function getFreshCodeBlockPointer(pointer: CodeBlockPointerSnapshot | null): CodeBlockPointerSnapshot | null {
  if (!pointer || Date.now() - pointer.time > CODE_BLOCK_POINTER_TTL_MS) {
    return null;
  }

  return pointer;
}

function pickCopyableCodeBlockNearPointer(
  blocks: HTMLPreElement[],
  pointer: CodeBlockPointerSnapshot
): HTMLPreElement | null {
  let bestBlock: HTMLPreElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const block of blocks) {
    const score = getCodeBlockPointerScore(block, pointer);
    if (score < bestScore) {
      bestScore = score;
      bestBlock = block;
    }
  }

  return Number.isFinite(bestScore) ? bestBlock : null;
}

function pickActiveCopyableCodeBlock(
  blocks: HTMLPreElement[],
  preferredPre: HTMLPreElement | null,
  pointer: CodeBlockPointerSnapshot | null
): HTMLPreElement | null {
  if (preferredPre && blocks.includes(preferredPre)) {
    return preferredPre;
  }

  const freshPointer = getFreshCodeBlockPointer(pointer);
  if (freshPointer) {
    return pickCopyableCodeBlockNearPointer(blocks, freshPointer);
  }

  let bestBlock: HTMLPreElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const block of blocks) {
    const score = getCodeBlockViewportScore(block);
    if (score < bestScore) {
      bestScore = score;
      bestBlock = block;
    }
  }

  return bestBlock;
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
  const preferredOutsideLeft = Math.round(rect.right + CODE_BLOCK_OUTSIDE_GAP);
  const outsideLeft = preferredOutsideLeft + CODE_BLOCK_TOOLBAR_WIDTH <= viewportWidth - 8
    ? preferredOutsideLeft
    : Math.round(visibleRight + CODE_BLOCK_OUTSIDE_GAP);
  const outsideFits = canPlaceFloatingControl(
    outsideLeft,
    top,
    CODE_BLOCK_TOOLBAR_WIDTH,
    CODE_BLOCK_TOOLBAR_HEIGHT,
    avoidRects
  );
  const left = outsideFits
    ? outsideLeft
    : shiftLeftAwayFromRects(
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

function areCodeOverlaysEqual(first: CodeBlockOverlay | null, second: CodeBlockOverlay | null): boolean {
  if (!first || !second) {
    return first === second;
  }

  return first.id === second.id &&
    first.pre === second.pre &&
    first.top === second.top &&
    first.left === second.left &&
    first.filename === second.filename &&
    first.lineCount === second.lineCount &&
    first.isDiff === second.isDiff;
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
  const [overlay, setOverlay] = useState<CodeBlockOverlay | null>(null);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Record<string, true>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const activePreRef = useRef<HTMLPreElement | null>(null);
  const pointerSnapshotRef = useRef<CodeBlockPointerSnapshot | null>(null);
  const visibleCodeBlocksRef = useRef<Set<HTMLPreElement>>(new Set());
  const copiedTimerRef = useRef<number | undefined>(undefined);

  const updateOverlays = useCallback(() => {
    const avoidRects = getFloatingAvoidRects(navigatorCollapsed);
    const blocks = findCopyableCodeBlocks();
    const nextVisibleBlocks = new Set(blocks);

    for (const pre of visibleCodeBlocksRef.current) {
      if (!nextVisibleBlocks.has(pre)) {
        pre.removeAttribute("data-cnav-code-collapsed");
        pre.removeAttribute("data-cnav-code-long");
      }
    }

    visibleCodeBlocksRef.current = nextVisibleBlocks;

    for (const pre of blocks) {
      const text = extractCodeBlockText(pre);
      const language = detectCodeLanguage(pre);
      const id = getCodeBlockId(pre);
      decorateDiffCodeBlock(pre, language, text);
      pre.toggleAttribute("data-cnav-code-collapsed", Boolean(collapsedBlocks[id]));
      pre.toggleAttribute("data-cnav-code-long", text.split("\n").length > 40);
    }

    const activePre = pickActiveCopyableCodeBlock(blocks, activePreRef.current, pointerSnapshotRef.current);
    const activeIndex = activePre ? blocks.indexOf(activePre) + 1 : -1;
    const nextOverlay = activePre && activeIndex > 0
      ? getCodeBlockOverlay(activePre, avoidRects, activeIndex)
      : null;

    setOverlay((current) => (areCodeOverlaysEqual(current, nextOverlay) ? current : nextOverlay));
  }, [collapsedBlocks, navigatorCollapsed]);

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

    const rememberPointer = (event: PointerEvent, force = false) => {
      if (event.target instanceof Element && event.target.closest(`#${ROOT_ID}`)) {
        return false;
      }

      const current = pointerSnapshotRef.current;
      pointerSnapshotRef.current = {
        x: event.clientX,
        y: event.clientY,
        time: Date.now()
      };

      if (force || !current) {
        return true;
      }

      return Math.abs(current.x - event.clientX) > 6 || Math.abs(current.y - event.clientY) > 6;
    };

    const updateActivePreFromTarget = (target: EventTarget | null) => {
      const pre = getCopyableCodeBlockFromTarget(target);
      if (pre) {
        if (activePreRef.current === pre) {
          return false;
        }

        activePreRef.current = pre;
        return true;
      }

      if (target instanceof Element && target.closest(`#${ROOT_ID}`)) {
        return false;
      }

      if (!activePreRef.current) {
        return false;
      }

      activePreRef.current = null;
      return true;
    };

    const handlePointerOver = (event: PointerEvent) => {
      const pointerChanged = rememberPointer(event, true);
      const activeChanged = updateActivePreFromTarget(event.target);
      if (pointerChanged || activeChanged) {
        scheduleUpdate();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const pre = getCopyableCodeBlockFromTarget(event.target);
      if (pre && activePreRef.current !== pre) {
        activePreRef.current = pre;
        scheduleUpdate();
      }
    };

    const handleFocusOut = (event: FocusEvent) => {
      const pre = getCopyableCodeBlockFromTarget(event.target);
      if (!pre || activePreRef.current !== pre) {
        return;
      }

      if (event.relatedTarget instanceof Element && pre.contains(event.relatedTarget)) {
        return;
      }

      activePreRef.current = null;
      scheduleUpdate();
    };

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
    };
  }, [updateOverlays]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
      for (const pre of visibleCodeBlocksRef.current) {
        pre.removeAttribute("data-cnav-code-collapsed");
        pre.removeAttribute("data-cnav-code-long");
      }
    };
  }, []);

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

  if (!overlay) {
    return null;
  }

  const isCollapsed = Boolean(collapsedBlocks[overlay.id]);
  const isCopied = copiedId === overlay.id;

  return (
    <div className="cnav-code-layer" data-theme={theme}>
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
    </div>
  );
}

function fetchTextFromBackground(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) {
      reject(new Error("Extension runtime is unavailable"));
      return;
    }

    const timer = window.setTimeout(() => reject(new Error("Background fetch timed out")), timeoutMs + 1000);
    try {
      chrome.runtime.sendMessage(
        {
          type: "conversationNavigator:fetchText",
          url,
          timeoutMs
        },
        (response?: { ok?: boolean; text?: string; error?: string }) => {
          window.clearTimeout(timer);
          const runtimeErrorMessage = getRuntimeLastErrorMessage();
          if (runtimeErrorMessage) {
            reject(new Error(runtimeErrorMessage));
            return;
          }

          if (response?.ok && typeof response.text === "string") {
            resolve(response.text);
            return;
          }

          reject(new Error(response?.error || "Background fetch failed"));
        }
      );
    } catch (error) {
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function checkCitationsFromBackground(urls: string[]): Promise<CitationCheckResult[]> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: CITATION_CHECK_MESSAGE, urls },
        (response?: { ok?: boolean; results?: CitationCheckResult[]; error?: string }) => {
          const runtimeErrorMessage = getRuntimeLastErrorMessage();
          if (runtimeErrorMessage) {
            reject(new Error(runtimeErrorMessage));
            return;
          }
          if (response?.ok && Array.isArray(response.results)) {
            resolve(response.results);
            return;
          }
          reject(new Error(response?.error || "Citation check failed"));
        }
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function getReadingToolsLabels(language: AppLanguage) {
  if (language === "en") {
    return {
      title: "Reading tools",
      close: "Close reading tools",
      focus: "Focus",
      export: "Select export",
      citations: "Sources",
      enterFocus: "Enter focus mode",
      exitFocus: "Exit focus mode",
      focusDescription: "Keep the active question and answer in view.",
      previous: "Previous",
      next: "Next",
      turn: "Turn",
      progress: "Reading progress",
      selectAll: "Select all",
      clear: "Clear",
      selected: "selected",
      exportNow: "Export selected",
      noContent: "No readable chat content was found.",
      searchSources: "Search sources",
      checkSources: "Check links",
      checking: "Checking",
      copySources: "Copy references",
      groupDomain: "By domain",
      groupMessage: "By message",
      openSource: "Open source",
      locate: "Locate",
      sourceCoverage: "Visible source coverage",
      needsReview: "Needs review",
      permissionHint: "Enable optional website access in extension settings before checking links.",
      unsafeHint: "Local, private, or unsupported source addresses are blocked for safety.",
      opened: "Opened",
      format: "Format",
      selectUser: "User only",
      selectAssistant: "GPT only",
      preview: "Live preview",
      exportOptions: "Export options",
      includeSourceMeta: "Include source URL",
      includeExportedAt: "Include export time",
      filterShortMessages: "Filter short acknowledgements",
      mergeAdjacentAnswers: "Merge adjacent GPT messages",
      generateToc: "Generate contents"
    };
  }
  if (language === "zh-TW") {
    return {
      title: "閱讀工具",
      close: "關閉閱讀工具",
      focus: "專注閱讀",
      export: "選擇匯出",
      citations: "引用管理",
      enterFocus: "進入專注閱讀",
      exitFocus: "退出專注閱讀",
      focusDescription: "只保留目前一輪問題與回答。",
      previous: "上一輪",
      next: "下一輪",
      turn: "第",
      progress: "閱讀進度",
      selectAll: "全部選取",
      clear: "清空",
      selected: "已選",
      exportNow: "匯出已選內容",
      noContent: "沒有識別到可讀取的聊天內容。",
      searchSources: "搜尋引用來源",
      checkSources: "檢查連結",
      checking: "檢查中",
      copySources: "複製參考資料",
      groupDomain: "按網站",
      groupMessage: "按訊息",
      openSource: "開啟來源",
      locate: "定位原文",
      sourceCoverage: "可見來源覆蓋",
      needsReview: "待核對",
      permissionHint: "請先在插件設定中授權引用連結檢查。",
      unsafeHint: "為安全起見，本機、私人網路或不支援的來源位址不會被檢查。",
      opened: "已開啟",
      format: "格式",
      selectUser: "只選使用者",
      selectAssistant: "只選 GPT",
      preview: "即時預覽",
      exportOptions: "匯出選項",
      includeSourceMeta: "包含來源網址",
      includeExportedAt: "包含匯出時間",
      filterShortMessages: "過濾簡短確認訊息",
      mergeAdjacentAnswers: "合併連續 GPT 訊息",
      generateToc: "產生目錄"
    };
  }
  return {
    title: "阅读工具",
    close: "关闭阅读工具",
    focus: "专注阅读",
    export: "选择导出",
    citations: "引用管理",
    enterFocus: "进入专注阅读",
    exitFocus: "退出专注阅读",
    focusDescription: "只保留当前一轮问题与回答。",
    previous: "上一轮",
    next: "下一轮",
    turn: "第",
    progress: "阅读进度",
    selectAll: "全部选择",
    clear: "清空",
    selected: "已选择",
    exportNow: "导出已选内容",
    noContent: "没有识别到可读取的聊天内容。",
    searchSources: "搜索引用来源",
    checkSources: "检查链接",
    checking: "检查中",
    copySources: "复制参考资料",
    groupDomain: "按网站",
    groupMessage: "按消息",
    openSource: "打开来源",
    locate: "定位原文",
    sourceCoverage: "可见来源覆盖",
    needsReview: "待核对",
    permissionHint: "请先在插件设置中授权引用链接检查。",
    unsafeHint: "出于安全考虑，本机、局域网或不支持的来源地址不会被检查。",
    opened: "已打开",
    format: "格式",
    selectUser: "只选用户",
    selectAssistant: "只选 GPT",
    preview: "实时预览",
    exportOptions: "导出选项",
    includeSourceMeta: "包含来源网址",
    includeExportedAt: "包含导出时间",
    filterShortMessages: "过滤简短确认消息",
    mergeAdjacentAnswers: "合并连续 GPT 消息",
    generateToc: "生成目录"
  };
}

function getExportBlockLabel(kind: SelectiveExportSnapshot["messages"][number]["blocks"][number]["kind"], language: AppLanguage) {
  const labels = language === "en"
    ? { heading: "Heading", paragraph: "Paragraph", list: "List", code: "Code", table: "Table", image: "Image", attachment: "Attachment" }
    : language === "zh-TW"
      ? { heading: "標題", paragraph: "段落", list: "清單", code: "代碼", table: "表格", image: "圖片", attachment: "附件" }
      : { heading: "标题", paragraph: "段落", list: "列表", code: "代码", table: "表格", image: "图片", attachment: "附件" };
  return labels[kind];
}

function getCitationStatusLabel(status: CitationRecord["checkStatus"], language: AppLanguage): string {
  const labels = language === "en"
    ? { unchecked: "Unchecked", checking: "Checking", reachable: "Available", missing: "Missing", restricted: "Manual check", "temporary-error": "Temporary error", blocked: "Not permitted" }
    : language === "zh-TW"
      ? { unchecked: "未檢查", checking: "檢查中", reachable: "可存取", missing: "已失效", restricted: "需手動確認", "temporary-error": "暫時異常", blocked: "未授權" }
      : { unchecked: "未检查", checking: "检查中", reachable: "可访问", missing: "已失效", restricted: "需手动确认", "temporary-error": "暂时异常", blocked: "未授权" };
  return labels[status];
}

interface ReadingToolsDrawerProps {
  open: boolean;
  docked: boolean;
  panel: ReadingToolPanel;
  language: AppLanguage;
  theme: ColorTheme;
  motionEnabled: boolean;
  snapshot: SelectiveExportSnapshot;
  selectedBlockIds: ReadonlySet<string>;
  items: NavigatorItem[];
  focusMode: boolean;
  activeTurnIndex: number;
  readingProgress: number;
  citationsChecking: boolean;
  exportPreferences: SelectiveExportPreferences;
  onClose: () => void;
  onPanelChange: (panel: ReadingToolPanel) => void;
  onToggleFocus: () => void;
  onChangeTurn: (index: number) => void;
  onSelectAll: (selected: boolean) => void;
  onSelectRole: (role: "user" | "assistant") => void;
  onToggleMessage: (messageId: string) => void;
  onToggleBlock: (blockId: string) => void;
  onExportPreferencesChange: (preferences: SelectiveExportPreferences) => void;
  onExport: () => void;
  onCheckCitations: () => void;
  onOpenCitation: (citation: CitationRecord, openExternal: boolean) => void;
  onCopyCitations: () => void;
}

function ReadingToolsDrawer({
  open,
  docked,
  panel,
  language,
  theme,
  motionEnabled,
  snapshot,
  selectedBlockIds,
  items,
  focusMode,
  activeTurnIndex,
  readingProgress,
  citationsChecking,
  exportPreferences,
  onClose,
  onPanelChange,
  onToggleFocus,
  onChangeTurn,
  onSelectAll,
  onSelectRole,
  onToggleMessage,
  onToggleBlock,
  onExportPreferencesChange,
  onExport,
  onCheckCitations,
  onOpenCitation,
  onCopyCitations
}: ReadingToolsDrawerProps) {
  const labels = getReadingToolsLabels(language);
  const [citationQuery, setCitationQuery] = useState("");
  const [citationGroup, setCitationGroup] = useState<"domain" | "message">("domain");
  const selectedCount = selectedBlockIds.size;
  const totalBlockCount = snapshot.messages.reduce((total, message) => total + message.blocks.length, 0);
  const previewSnapshot = useMemo(
    () => filterSelectiveSnapshot(snapshot, selectedBlockIds),
    [selectedBlockIds, snapshot]
  );
  const filteredCitations = useMemo(() => {
    const query = citationQuery.trim().toLowerCase();
    return snapshot.citations.filter((citation) => !query || [citation.title, citation.domain, citation.excerpt]
      .join(" ").toLowerCase().includes(query));
  }, [citationQuery, snapshot.citations]);
  const groupedCitations = useMemo(() => {
    const groups = new Map<string, CitationRecord[]>();
    if (citationGroup === "domain") {
      for (const citation of filteredCitations) {
        const group = groups.get(citation.domain) ?? [];
        group.push(citation);
        groups.set(citation.domain, group);
      }
    } else {
      for (const citation of filteredCitations) {
        citation.occurrences.forEach((occurrence, index) => {
          const message = snapshot.messages.find((candidate) => candidate.id === occurrence.messageId);
          const key = `${labels.turn} ${message?.turnIndex ?? "-"}`;
          const group = groups.get(key) ?? [];
          group.push({
            ...citation,
            id: `${citation.id}:occurrence:${index}`,
            href: occurrence.href,
            messageId: occurrence.messageId,
            blockId: occurrence.blockId,
            excerpt: occurrence.excerpt,
            occurrenceCount: 1,
            occurrences: [occurrence]
          });
          groups.set(key, group);
        });
      }
    }
    return Array.from(groups.entries());
  }, [citationGroup, filteredCitations, labels.turn, snapshot.messages]);
  const assistantBlocks = snapshot.messages.filter((message) => message.role === "assistant").flatMap((message) => message.blocks);
  const citedBlockIds = new Set(snapshot.citations.flatMap((citation) => citation.occurrences.map((occurrence) => occurrence.blockId)));
  const coverageCount = assistantBlocks.filter((block) => citedBlockIds.has(block.id)).length;
  const suspectedUnlinkedCount = assistantBlocks.filter((block) =>
    !citedBlockIds.has(block.id) && /(?:据|根據|来源|來源|研究|报告|報告|according to|source|study|report)/i.test(block.text)
  ).length;

  const panelTabs: Array<{ id: ReadingToolPanel; label: string; icon: React.ReactNode }> = [
    { id: "focus", label: labels.focus, icon: <Focus size={16} aria-hidden="true" /> },
    { id: "export", label: labels.export, icon: <ListChecks size={16} aria-hidden="true" /> },
    { id: "citations", label: labels.citations, icon: <Link2 size={16} aria-hidden="true" /> }
  ];

  return (
    <aside
      className={`cnav-reading-drawer${open ? " is-open" : ""}${docked ? " is-docked" : " is-overlay"}${motionEnabled ? "" : " is-static"}`}
      data-theme={theme}
      aria-hidden={!open}
      aria-label={labels.title}
    >
      <header className="cnav-reading-header">
        <span className="cnav-reading-mark"><BookOpen size={18} aria-hidden="true" /></span>
        <div><strong>{labels.title}</strong><small>2026-V10</small></div>
        <button type="button" onClick={onClose} aria-label={labels.close} title={labels.close}><X size={18} aria-hidden="true" /></button>
      </header>
      <nav className="cnav-reading-tabs" aria-label={labels.title}>
        {panelTabs.map((tab) => (
          <button
            type="button"
            className={panel === tab.id ? "is-active" : ""}
            onClick={() => onPanelChange(tab.id)}
            key={tab.id}
          >
            {tab.icon}<span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="cnav-reading-body" key={panel}>
        {panel === "focus" ? (
          <section className="cnav-tool-panel cnav-focus-panel">
            <div className="cnav-tool-hero">
              <span><Focus size={20} aria-hidden="true" /></span>
              <div><strong>{labels.focus}</strong><p>{labels.focusDescription}</p></div>
            </div>
            <button className={`cnav-primary-action${focusMode ? " is-danger" : ""}`} type="button" onClick={onToggleFocus}>
              {focusMode ? <Minimize2 size={17} aria-hidden="true" /> : <Focus size={17} aria-hidden="true" />}
              {focusMode ? labels.exitFocus : labels.enterFocus}
            </button>
            {focusMode ? (
              <>
                <div className="cnav-progress-card">
                  <div><span>{labels.progress}</span><strong>{Math.round(readingProgress)}%</strong></div>
                  <span className="cnav-progress-track"><i style={{ width: `${readingProgress}%` }} /></span>
                </div>
                <div className="cnav-focus-navigation">
                  <button type="button" onClick={() => onChangeTurn(activeTurnIndex - 1)} disabled={activeTurnIndex <= 0}>
                    <ChevronLeft size={16} aria-hidden="true" />{labels.previous}
                  </button>
                  <strong>{activeTurnIndex + 1} / {Math.max(1, items.length)}</strong>
                  <button type="button" onClick={() => onChangeTurn(activeTurnIndex + 1)} disabled={activeTurnIndex >= items.length - 1}>
                    {labels.next}<ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : null}
            <div className="cnav-turn-list">
              {items.length === 0 ? <p className="cnav-tool-empty">{labels.noContent}</p> : items.map((item, index) => (
                <button
                  type="button"
                  className={activeTurnIndex === index ? "is-active" : ""}
                  onClick={() => onChangeTurn(index)}
                  key={item.id}
                >
                  <small>{labels.turn} {index + 1}</small>
                  <span>{item.promptPreview}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {panel === "export" ? (
          <section className="cnav-tool-panel cnav-export-panel">
            <div className="cnav-panel-toolbar">
              <div><strong>{selectedCount}</strong><span>/ {totalBlockCount} {labels.selected}</span></div>
              <div>
                <button type="button" onClick={() => onSelectAll(true)}>{labels.selectAll}</button>
                <button type="button" onClick={() => onSelectAll(false)}>{labels.clear}</button>
              </div>
            </div>
            <div className="cnav-export-role-actions">
              <button type="button" onClick={() => onSelectRole("user")}>{labels.selectUser}</button>
              <button type="button" onClick={() => onSelectRole("assistant")}>{labels.selectAssistant}</button>
            </div>
            <div className="cnav-export-list">
              {snapshot.messages.length === 0 ? <p className="cnav-tool-empty">{labels.noContent}</p> : snapshot.messages.map((message) => {
                const messageSelectedCount = message.blocks.filter((block) => selectedBlockIds.has(block.id)).length;
                const allSelected = message.blocks.length > 0 && messageSelectedCount === message.blocks.length;
                return (
                  <article className="cnav-export-message" key={message.id}>
                    <button className="cnav-export-message-toggle" type="button" onClick={() => onToggleMessage(message.id)}>
                      {allSelected ? <CheckSquare2 size={17} aria-hidden="true" /> : <Square size={17} aria-hidden="true" />}
                      <span>{message.role === "user" ? (language === "en" ? "You" : "用户") : "GPT"}</span>
                      <small>{messageSelectedCount}/{message.blocks.length}</small>
                    </button>
                    <div className="cnav-export-blocks">
                      {message.blocks.map((block) => (
                        <button
                          type="button"
                          className={selectedBlockIds.has(block.id) ? "is-selected" : ""}
                          onClick={() => onToggleBlock(block.id)}
                          key={block.id}
                        >
                          {selectedBlockIds.has(block.id) ? <Check size={14} aria-hidden="true" /> : <span />}
                          <small>{getExportBlockLabel(block.kind, language)}</small>
                          <p>{block.text.slice(0, 120) || block.sourceLabel || "-"}</p>
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
            <details className="cnav-export-preview" open>
              <summary>{labels.preview}<span>{previewSnapshot.messages.length}</span></summary>
              <div>
                {previewSnapshot.messages.length === 0 ? <p>{labels.noContent}</p> : previewSnapshot.messages.slice(0, 4).map((message) => (
                  <article key={message.id}>
                    <strong>{message.role === "user" ? (language === "en" ? "You" : "用户") : "GPT"}</strong>
                    <p>{message.text.slice(0, 260)}</p>
                  </article>
                ))}
              </div>
            </details>
            <details className="cnav-export-options">
              <summary>{labels.exportOptions}</summary>
              <div>
                {([
                  ["includeSourceMeta", labels.includeSourceMeta],
                  ["includeExportedAt", labels.includeExportedAt],
                  ["filterShortMessages", labels.filterShortMessages],
                  ["mergeAdjacentAnswers", labels.mergeAdjacentAnswers],
                  ["generateToc", labels.generateToc]
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={exportPreferences[key]}
                      onChange={(event) => onExportPreferencesChange({ ...exportPreferences, [key]: event.currentTarget.checked })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </details>
            <div className="cnav-export-footer">
              <label><span>{labels.format}</span><select value={exportPreferences.format} onChange={(event) => onExportPreferencesChange({ ...exportPreferences, format: event.currentTarget.value as ExportDocumentFormat })}>
                <option value="docx">Word (.docx)</option><option value="html">HTML (.html)</option><option value="md">Markdown (.md)</option>
              </select></label>
              <button className="cnav-primary-action" type="button" disabled={selectedCount === 0} onClick={onExport}>
                <Download size={17} aria-hidden="true" />{labels.exportNow}
              </button>
            </div>
          </section>
        ) : null}

        {panel === "citations" ? (
          <section className="cnav-tool-panel cnav-citation-panel">
            <div className="cnav-citation-summary">
              <div><span>{labels.sourceCoverage}</span><strong>{coverageCount}/{assistantBlocks.length}</strong></div>
              <div><span>{labels.needsReview}</span><strong>{suspectedUnlinkedCount}</strong></div>
            </div>
            <label className="cnav-tool-search"><Search size={15} aria-hidden="true" /><input value={citationQuery} onChange={(event) => setCitationQuery(event.currentTarget.value)} placeholder={labels.searchSources} /></label>
            <div className="cnav-citation-actions">
              <div className="cnav-segmented-control">
                <button type="button" className={citationGroup === "domain" ? "is-active" : ""} onClick={() => setCitationGroup("domain")}>{labels.groupDomain}</button>
                <button type="button" className={citationGroup === "message" ? "is-active" : ""} onClick={() => setCitationGroup("message")}>{labels.groupMessage}</button>
              </div>
              <button type="button" onClick={onCopyCitations} disabled={snapshot.citations.length === 0}><Copy size={15} aria-hidden="true" />{labels.copySources}</button>
            </div>
            <button className="cnav-primary-action" type="button" onClick={onCheckCitations} disabled={citationsChecking || snapshot.citations.length === 0}>
              {citationsChecking ? <Loader2 className="is-spinning" size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
              {citationsChecking ? labels.checking : labels.checkSources}
            </button>
            {snapshot.citations.some((citation) => citation.checkStatus === "blocked" && citation.checkReason === "permission-required") ? (
              <p className="cnav-permission-hint"><AlertTriangle size={14} aria-hidden="true" />{labels.permissionHint}</p>
            ) : null}
            {snapshot.citations.some((citation) => citation.checkStatus === "blocked" && citation.checkReason === "unsafe-url") ? (
              <p className="cnav-permission-hint is-unsafe"><AlertTriangle size={14} aria-hidden="true" />{labels.unsafeHint}</p>
            ) : null}
            <div className="cnav-citation-list">
              {groupedCitations.length === 0 ? <p className="cnav-tool-empty">{labels.noContent}</p> : groupedCitations.map(([group, citations]) => (
                <section key={group}>
                  <h3>{group}<span>{citations.length}</span></h3>
                  {citations.map((citation) => (
                    <article className="cnav-citation-item" key={citation.id}>
                      <div><strong>{citation.title}</strong><small>{citation.domain}{citation.openedAt ? ` · ${labels.opened}` : ""}</small></div>
                      <p>{citation.excerpt}</p>
                      <span className={`cnav-citation-status is-${citation.checkStatus}`}>{getCitationStatusLabel(citation.checkStatus, language)}{citation.statusCode ? ` · ${citation.statusCode}` : ""}</span>
                      <div className="cnav-citation-item-actions">
                        <button type="button" onClick={() => onOpenCitation(citation, false)}>{labels.locate}</button>
                        <button type="button" onClick={() => onOpenCitation(citation, true)}>{labels.openSource}<ExternalLink size={13} aria-hidden="true" /></button>
                      </div>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function clearFocusPresentation() {
  document.documentElement.removeAttribute("data-cnav-focus-mode");
  document.querySelectorAll<HTMLElement>(`[${FOCUS_ACTIVE_ATTR}],[${FOCUS_HIDDEN_ATTR}],[${FOCUS_CHROME_ATTR}]`)
    .forEach((element) => {
      element.removeAttribute(FOCUS_ACTIVE_ATTR);
      element.removeAttribute(FOCUS_HIDDEN_ATTR);
      element.removeAttribute(FOCUS_CHROME_ATTR);
    });
}

function markFocusChromeElements() {
  const remoteLayoutSelectors = activeCompatRules.flatMap((rule) => [
    ...(rule.layoutSelectors?.sidebar ?? []),
    ...(rule.layoutSelectors?.composer ?? []),
    ...(rule.layoutSelectors?.header ?? [])
  ]);
  const selectors = Array.from(new Set([
    ...CHATGPT_SIDEBAR_SELECTORS,
    ...CHATGPT_COMPOSER_SELECTORS,
    ...CHATGPT_HEADER_SELECTORS,
    ...remoteLayoutSelectors,
    "main form",
    '[aria-label*="composer" i]',
    '[role="banner"]',
    'nav[aria-label*="侧边栏" i]',
    'nav[aria-label*="邊欄" i]',
    'nav[aria-label*="sidebar" i]',
    'nav[aria-label*="历史聊天" i]',
    'nav[aria-label*="歷史聊天" i]'
  ]));
  const candidates = Array.from(new Set(selectors.flatMap((selector) => safeQueryAll(selector))));
  for (const element of candidates) {
    if (!element.closest(`#${ROOT_ID}`)) element.setAttribute(FOCUS_CHROME_ATTR, "true");
  }
}

function ConversationNavigator() {
  const adapter = getAdapter();
  const [settings, setSettings] = useState<NavigatorSettings>(DEFAULT_SETTINGS);
  const t = getTranslation(settings.language);
  const [pageId, setPageId] = useState(() => {
    const initialSessionId = createConversationSessionId(0);
    activeConversationSessionId = initialSessionId;
    return initialSessionId;
  });
  const pageKey = pageId;
  const [items, setItems] = useState<NavigatorItem[]>([]);
  const [mapEntries, setMapEntries] = useState<MessageMapEntry[]>([]);
  const [theme, setTheme] = useState<ColorTheme>(detectPageTheme);
  const [resizeFrame, setResizeFrame] = useState<ResizeFrame | null>(null);
  const [resizingSide, setResizingSide] = useState<"left" | "right" | null>(null);
  const [resizePreviewValue, setResizePreviewValue] = useState<number | null>(null);
  const [canvasResizeFrame, setCanvasResizeFrame] = useState<ResizeFrame | null>(null);
  const [canvasResizingSide, setCanvasResizingSide] = useState<"left" | "right" | null>(null);
  const [canvasResizePreviewValue, setCanvasResizePreviewValue] = useState<number | null>(null);
  const [scrollJumpPosition, setScrollJumpPosition] = useState<FloatingControlPosition>(() =>
    getDefaultScrollJumpPosition()
  );
  const [compatRuleCount, setCompatRuleCount] = useState(0);
  const [officialPopoverOpen, setOfficialPopoverOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeToolPanel, setActiveToolPanel] = useState<ReadingToolPanel>("focus");
  const [focusMode, setFocusMode] = useState(false);
  const [activeFocusTurn, setActiveFocusTurn] = useState(0);
  const [readingProgress, setReadingProgress] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [exportPreferences, setExportPreferences] = useState<SelectiveExportPreferences>(
    DEFAULT_SELECTIVE_EXPORT_PREFERENCES
  );
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [selectionPageKey, setSelectionPageKey] = useState("");
  const [citationState, setCitationState] = useState<Record<string, Partial<CitationRecord>>>({});
  const [citationsChecking, setCitationsChecking] = useState(false);
  const itemsRef = useRef(items);
  const mapEntriesRef = useRef(mapEntries);
  const sessionGenerationRef = useRef(0);
  const sessionIdRef = useRef(pageId);
  const settingsRef = useRef(settings);
  const resizeFrameRef = useRef(resizeFrame);
  const canvasResizeFrameRef = useRef(canvasResizeFrame);
  const canvasResizeTargetRef = useRef<CanvasWidthTarget | null>(null);
  const scanTimerRef = useRef<number | undefined>(undefined);
  const scanIdleWorkRef = useRef<ScheduledIdleWork | null>(null);
  const scanRunningRef = useRef(false);
  const scanQueuedRef = useRef(false);
  const lastScanScrollYRef = useRef(getCurrentConversationScrollTop());
  const forceDomRebuildOnNextScanRef = useRef(true);
  const focusScrollPositionsRef = useRef<Map<number, number>>(new Map());
  const focusPresentedTurnRef = useRef<number | null>(null);
  const readingSnapshotCacheRef = useRef<ReadingMessageParseCache>(new Map());
  const citationStateRef = useRef(citationState);
  const citationRequestGenerationRef = useRef(0);

  itemsRef.current = items;
  mapEntriesRef.current = mapEntries;
  sessionIdRef.current = pageId;
  activeConversationSessionId = pageId;
  settingsRef.current = settings;
  resizeFrameRef.current = resizeFrame;
  canvasResizeFrameRef.current = canvasResizeFrame;
  citationStateRef.current = citationState;
  latestNavigatorExportState = {
    items,
    pageKey,
    language: settings.language
  };

  const readingSourceMessages = useMemo<ReadingSourceMessage[]>(() => mapEntries
    .filter((entry) => entry.mounted && anchorRegistry.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      role: entry.role,
      element: anchorRegistry.get(entry.id) as HTMLElement,
      text: entry.text,
      turnIndex: entry.turnIndex
    })), [mapEntries]);
  const selectiveSnapshot = useMemo<SelectiveExportSnapshot>(() => {
    if (!drawerOpen) {
      return {
        title: document.title,
        url: location.href,
        pageKey,
        exportedAt: Date.now(),
        messages: [],
        codeBlocks: [],
        nodes: [],
        citations: []
      };
    }
    const source = getPageSourceMeta();
    return buildSelectiveExportSnapshot({
      title: source.sourceTitle,
      url: source.sourceUrl,
      pageKey: source.pageKey,
      exportedAt: Date.now(),
      sourceMessages: readingSourceMessages,
      nodes: createExportNodes(),
      previousCitationState: new Map(Object.entries(citationState)),
      messageCache: readingSnapshotCacheRef.current
    });
  }, [citationState, drawerOpen, pageKey, readingSourceMessages]);
  const drawerDocked = drawerOpen && (
    settings.drawerMode === "dock" ||
    (settings.drawerMode === "auto" && viewportWidth >= 1280 && !getActiveCanvasWidthTarget())
  );

  const resetConversationState = useCallback(() => {
    sessionGenerationRef.current += 1;
    const nextSessionId = createConversationSessionId(sessionGenerationRef.current);
    sessionIdRef.current = nextSessionId;
    activeConversationSessionId = nextSessionId;
    latestPageHealth = null;
    latestNavigatorExportState = {
      items: [],
      pageKey: nextSessionId,
      language: settingsRef.current.language
    };

    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = undefined;
    }
    cancelIdleWork(scanIdleWorkRef.current);
    scanIdleWorkRef.current = null;
    scanQueuedRef.current = false;
    forceDomRebuildOnNextScanRef.current = true;
    lastScanScrollYRef.current = getCurrentConversationScrollTop();
    itemsRef.current = [];
    mapEntriesRef.current = [];
    anchorRegistry.clear();
    focusScrollPositionsRef.current.clear();
    focusPresentedTurnRef.current = null;
    readingSnapshotCacheRef.current.clear();
    citationRequestGenerationRef.current += 1;
    citationStateRef.current = {};
    clearFocusPresentation();
    setFocusMode(false);
    setReadingProgress(0);
    setCitationState({});
    setCitationsChecking(false);
    setSelectionTouched(false);
    setSelectionPageKey("");
    setItems([]);
    setMapEntries([]);
    setPageId(nextSessionId);
  }, []);

  const scan = useCallback(() => {
    if (scanRunningRef.current) {
      scanQueuedRef.current = true;
      return;
    }

    const scanSessionId = sessionIdRef.current;
    scanRunningRef.current = true;
    try {
      const { items: nextItems, mapEntries: nextMapEntries, health: nextHealth } = buildNavigatorData();
      if (scanSessionId !== sessionIdRef.current) {
        return;
      }

      if (nextMapEntries.length === 0 && mapEntriesRef.current.length > 0) {
        resetConversationState();
        return;
      }

      const shouldRebuildFromDom = forceDomRebuildOnNextScanRef.current || itemsRef.current.length === 0;
      const merged = shouldRebuildFromDom
        ? {
            items: normalizeNavigatorOrder(nextItems.map((item) => ({ ...item, mounted: true }))),
            mapEntries: normalizeMapEntryOrder(nextMapEntries.map((entry) => ({ ...entry, mounted: true })))
          }
        : mergeNavigatorData(
            itemsRef.current,
            mapEntriesRef.current,
            nextItems,
            nextMapEntries,
            lastScanScrollYRef.current
          );
      if (scanSessionId !== sessionIdRef.current) {
        return;
      }

      forceDomRebuildOnNextScanRef.current = false;
      lastScanScrollYRef.current = getCurrentConversationScrollTop();
      itemsRef.current = merged.items;
      mapEntriesRef.current = merged.mapEntries;
      latestPageHealth = toPageAdapterHealth(nextHealth);
      setItems(merged.items);
      setMapEntries(merged.mapEntries);
    } catch (error) {
      console.warn("[GPT页面增强工具] 扫描当前页面失败，保留上一轮数据：", error);
    } finally {
      scanRunningRef.current = false;
      if (scanQueuedRef.current) {
        scanQueuedRef.current = false;
        window.setTimeout(() => {
          scanIdleWorkRef.current = requestIdleWork(() => {
            scanIdleWorkRef.current = null;
            scan();
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
        scan();
      });
    }, delay);
  }, [scan]);

  const applySettingsNow = (nextSettings: NavigatorSettings) => {
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  };

  const applySettingsPatch = (patch: Partial<NavigatorSettings>) => {
    const nextSettings = normalizeSettings({ ...settingsRef.current, ...patch });
    applySettingsNow(nextSettings);
    return nextSettings;
  };

  const commitSettingsPatch = async (patch: Partial<NavigatorSettings>) => {
    const nextSettings = applySettingsPatch(patch);
    await saveSettings(nextSettings);
  };
  const updateSettings = commitSettingsPatch;

  const setFocusTurn = (nextIndex: number) => {
    if (items.length === 0) return;
    if (focusMode) focusScrollPositionsRef.current.set(activeFocusTurn, getCurrentConversationScrollTop());
    const index = Math.min(items.length - 1, Math.max(0, nextIndex));
    setActiveFocusTurn(index);
    if (!focusMode) setFocusMode(true);
    setDrawerOpen(true);
    setActiveToolPanel("focus");
  };

  const toggleFocusMode = () => {
    if (!focusMode && items.length > 0) {
      const viewportTarget = Math.max(96, window.innerHeight * 0.32);
      let nextIndex = items.findIndex((item) => {
        const anchor = anchorRegistry.get(item.id);
        if (!anchor) return false;
        const rect = anchor.getBoundingClientRect();
        return rect.bottom >= viewportTarget && rect.top <= window.innerHeight * 0.72;
      });
      if (nextIndex < 0) nextIndex = Math.max(0, items.length - 1);
      setActiveFocusTurn(nextIndex);
    }
    setFocusMode((current) => !current);
    setDrawerOpen(true);
    setActiveToolPanel("focus");
  };

  const selectAllBlocks = (selected: boolean) => {
    setSelectionTouched(true);
    setSelectedBlockIds(selected ? getAllSelectableBlockIds(selectiveSnapshot) : new Set());
  };

  const toggleExportBlock = (blockId: string) => {
    setSelectionTouched(true);
    setSelectedBlockIds((current) => {
      const next = new Set(current);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  const toggleExportMessage = (messageId: string) => {
    const message = selectiveSnapshot.messages.find((candidate) => candidate.id === messageId);
    if (!message) return;
    setSelectionTouched(true);
    setSelectedBlockIds((current) => {
      const next = new Set(current);
      const allSelected = message.blocks.length > 0 && message.blocks.every((block) => next.has(block.id));
      for (const block of message.blocks) {
        if (allSelected) next.delete(block.id);
        else next.add(block.id);
      }
      return next;
    });
  };

  const selectExportRole = (role: "user" | "assistant") => {
    setSelectionTouched(true);
    setSelectedBlockIds(new Set(
      selectiveSnapshot.messages
        .filter((message) => message.role === role)
        .flatMap((message) => message.blocks.map((block) => block.id))
    ));
  };

  const updateSelectiveExportPreferences = (next: SelectiveExportPreferences) => {
    const normalized = normalizeSelectiveExportPreferences(next);
    setExportPreferences(normalized);
    void saveSelectiveExportPreferences(normalized);
  };

  const exportSelectedBlocks = () => {
    const filtered = applySelectiveExportPreferences(
      filterSelectiveSnapshot(selectiveSnapshot, selectedBlockIds),
      exportPreferences
    );
    const messages: ExportChatMessage[] = filtered.messages.map((message) => {
      const messageBlockIds = new Set(message.blocks.map((block) => block.id));
      const citations = filtered.citations.filter((citation) =>
        citation.occurrences.some((occurrence) => messageBlockIds.has(occurrence.blockId))
      );
      const references = citations.length
        ? `\n\n${settings.language === "en" ? "Sources" : "引用来源"}:\n${citations.map((citation) => `- ${citation.title}: ${citation.href}`).join("\n")}`
        : "";
      return { ...message, text: `${message.text}${references}` };
    });
    const exportSnapshot: ExportSnapshot = { ...filtered, messages };
    const file = buildExportDocument(exportSnapshot, "chat", exportPreferences.format);
    downloadExportFile(file.filename, file.data, file.mimeType);
  };

  const persistCitationState = async (
    next: Record<string, Partial<CitationRecord>>,
    storageKey = getCitationStorageKey()
  ) => {
    if (storageKey === getCitationStorageKey()) {
      citationStateRef.current = next;
      setCitationState(next);
    }
    await writeCitationConversation(storageKey, next);
  };

  const markCitationOpened = (citation: CitationRecord) => {
    const currentState = citationStateRef.current;
    const next = {
      ...currentState,
      [citation.canonicalUrl]: {
        ...currentState[citation.canonicalUrl],
        openedAt: Date.now()
      }
    };
    void persistCitationState(next);
  };

  const openCitation = (citation: CitationRecord, openExternal: boolean) => {
    const messageAnchor = anchorRegistry.get(citation.messageId);
    if (messageAnchor) {
      const exactAnchor = Array.from(messageAnchor.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .find((anchor) => canonicalizeCitationUrl(anchor.href, location.href) === citation.canonicalUrl);
      const target = exactAnchor?.closest<HTMLElement>("p,li,blockquote,div") ?? messageAnchor;
      target.setAttribute(CITATION_HIGHLIGHT_ATTR, "true");
      scrollElementIntoView(target, settings.navigateAnimationEnabled);
      window.setTimeout(() => target.removeAttribute(CITATION_HIGHLIGHT_ATTR), 1400);
    }
    if (openExternal) {
      markCitationOpened(citation);
      window.open(citation.href, "_blank", "noopener,noreferrer");
    }
  };

  const checkAllCitations = async () => {
    if (selectiveSnapshot.citations.length === 0 || citationsChecking) return;
    const requestGeneration = ++citationRequestGenerationRef.current;
    const storageKey = getCitationStorageKey();
    setCitationsChecking(true);
    const checking = { ...citationStateRef.current };
    for (const citation of selectiveSnapshot.citations) {
      checking[citation.canonicalUrl] = {
        ...checking[citation.canonicalUrl],
        checkStatus: "checking",
        checkReason: undefined
      };
    }
    citationStateRef.current = checking;
    setCitationState(checking);
    try {
      const urls = selectiveSnapshot.citations.map((citation) => citation.canonicalUrl);
      const results = await checkCitationsFromBackground(urls);
      if (
        requestGeneration !== citationRequestGenerationRef.current ||
        storageKey !== getCitationStorageKey()
      ) return;
      const resultByUrl = new Map(results.map((result) => [result.url, result]));
      const next = { ...checking };
      for (const url of urls) {
        const result = resultByUrl.get(url) ?? {
          url,
          status: "temporary-error" as const,
          checkedAt: Date.now()
        };
        next[url] = {
          ...next[url],
          checkStatus: result.status,
          checkReason: result.reason,
          statusCode: result.statusCode,
          checkedAt: result.checkedAt
        };
      }
      await persistCitationState(next, storageKey);
    } catch {
      if (
        requestGeneration !== citationRequestGenerationRef.current ||
        storageKey !== getCitationStorageKey()
      ) return;
      const next = { ...checking };
      for (const citation of selectiveSnapshot.citations) {
        next[citation.canonicalUrl] = {
          ...next[citation.canonicalUrl],
          checkStatus: "temporary-error",
          checkReason: undefined,
          checkedAt: Date.now()
        };
      }
      await persistCitationState(next, storageKey);
    } finally {
      if (requestGeneration === citationRequestGenerationRef.current) {
        setCitationsChecking(false);
      }
    }
  };

  const copyCitationList = async () => {
    const text = selectiveSnapshot.citations
      .map((citation, index) => `${index + 1}. ${citation.title} — ${citation.href}`)
      .join("\n");
    if (text) await writeTextToClipboard(text);
  };

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSelectiveExportPreferences().then((preferences) => {
      if (!cancelled) setExportPreferences(preferences);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string; panel?: ReadingToolPanel }>).detail;
      if (detail?.panel) setActiveToolPanel(detail.panel);
      if (detail?.command === "close") setDrawerOpen(false);
      else if (detail?.command === "toggle") setDrawerOpen((current) => !current);
      else setDrawerOpen(true);
    };
    window.addEventListener(PAGE_COMMAND_EVENT, handleCommand);
    return () => window.removeEventListener(PAGE_COMMAND_EVENT, handleCommand);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storageKey = getCitationStorageKey();
    void readCitationConversation(storageKey).then((state) => {
      if (!cancelled && storageKey === getCitationStorageKey()) {
        citationStateRef.current = state;
        setCitationState(state);
      }
    });
    return () => { cancelled = true; };
  }, [pageKey]);

  useEffect(() => {
    if (!drawerOpen || selectiveSnapshot.messages.length === 0) return;
    const allIds = getAllSelectableBlockIds(selectiveSnapshot);
    if (selectionPageKey !== selectiveSnapshot.pageKey) {
      setSelectionPageKey(selectiveSnapshot.pageKey);
      setSelectionTouched(false);
      setSelectedBlockIds(allIds);
      return;
    }
    if (!selectionTouched) {
      setSelectedBlockIds(allIds);
      return;
    }
    setSelectedBlockIds((current) => new Set(Array.from(current).filter((id) => allIds.has(id))));
  }, [drawerOpen, selectionPageKey, selectionTouched, selectiveSnapshot]);

  useEffect(() => {
    if (drawerDocked) document.documentElement.setAttribute("data-cnav-drawer-docked", "true");
    else document.documentElement.removeAttribute("data-cnav-drawer-docked");
    return () => document.documentElement.removeAttribute("data-cnav-drawer-docked");
  }, [drawerDocked]);

  useEffect(() => {
    if (settings.uiMotionEnabled) document.documentElement.removeAttribute("data-cnav-ui-motion");
    else document.documentElement.setAttribute("data-cnav-ui-motion", "off");
    return () => document.documentElement.removeAttribute("data-cnav-ui-motion");
  }, [settings.uiMotionEnabled]);

  useEffect(() => {
    if (!focusMode || items.length === 0) {
      focusPresentedTurnRef.current = null;
      clearFocusPresentation();
      return;
    }
    const activeTurn = Math.min(items.length - 1, Math.max(0, activeFocusTurn)) + 1;
    const shouldRestorePosition = focusPresentedTurnRef.current !== activeFocusTurn;
    focusPresentedTurnRef.current = activeFocusTurn;
    document.documentElement.setAttribute("data-cnav-focus-mode", "true");
    if (settings.focusHideChrome) {
      markFocusChromeElements();
    } else {
      document.querySelectorAll<HTMLElement>(`[${FOCUS_CHROME_ATTR}]`)
        .forEach((element) => element.removeAttribute(FOCUS_CHROME_ATTR));
    }
    for (const entry of mapEntries) {
      const anchor = anchorRegistry.get(entry.id);
      if (!anchor) continue;
      if (entry.turnIndex === activeTurn) {
        anchor.removeAttribute(FOCUS_HIDDEN_ATTR);
        anchor.setAttribute(FOCUS_ACTIVE_ATTR, "true");
      } else {
        anchor.removeAttribute(FOCUS_ACTIVE_ATTR);
        if (settings.focusCollapseOtherTurns) anchor.setAttribute(FOCUS_HIDDEN_ATTR, "true");
        else anchor.removeAttribute(FOCUS_HIDDEN_ATTR);
      }
    }
    const activeAnchor = anchorRegistry.get(items[activeTurn - 1]?.id);
    const savedPosition = focusScrollPositionsRef.current.get(activeFocusTurn);
    if (activeAnchor && shouldRestorePosition) window.requestAnimationFrame(() => {
      if (savedPosition !== undefined) setCurrentConversationScrollTop(savedPosition);
      else scrollAnchorToTop(activeAnchor, settings.navigateAnimationEnabled);
    });
  }, [activeFocusTurn, focusMode, items, mapEntries, settings.focusCollapseOtherTurns, settings.focusHideChrome, settings.navigateAnimationEnabled]);

  useEffect(() => clearFocusPresentation, []);

  useEffect(() => {
    if (!focusMode) {
      setReadingProgress(0);
      return;
    }
    const updateProgress = () => {
      const entry = mapEntries.find((candidate) => candidate.role === "assistant" && candidate.turnIndex === activeFocusTurn + 1);
      const anchor = entry ? anchorRegistry.get(entry.id) : null;
      if (!anchor) return;
      focusScrollPositionsRef.current.set(activeFocusTurn, getCurrentConversationScrollTop());
      const rect = anchor.getBoundingClientRect();
      const viewportHeight = Math.max(240, window.innerHeight - 144);
      if (rect.height <= viewportHeight) {
        setReadingProgress(100);
        return;
      }
      const progress = Math.min(100, Math.max(0, ((96 - rect.top) / Math.max(1, rect.height - viewportHeight)) * 100));
      setReadingProgress(progress);
    };
    updateProgress();
    window.addEventListener("scroll", updateProgress, true);
    window.addEventListener("resize", updateProgress);
    return () => {
      window.removeEventListener("scroll", updateProgress, true);
      window.removeEventListener("resize", updateProgress);
    };
  }, [activeFocusTurn, focusMode, mapEntries]);

  useEffect(() => {
    if (!focusMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFocusMode(false);
      } else if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        setFocusTurn(activeFocusTurn - 1);
      } else if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        setFocusTurn(activeFocusTurn + 1);
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeFocusTurn, focusMode, items.length]);

  useEffect(() => {
    if (!drawerOpen || selectiveSnapshot.citations.length === 0) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.closest(`#${ROOT_ID}`)) return;
      const canonical = canonicalizeCitationUrl(target.href, location.href);
      const citation = selectiveSnapshot.citations.find((candidate) => candidate.canonicalUrl === canonical);
      if (citation) markCitationOpened(citation);
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [drawerOpen, selectiveSnapshot.citations]);

  useEffect(() => {
    let frame = 0;
    const detectOfficialPopover = () => {
      frame = 0;
      const nextOpen = hasOpenOfficialPopover();
      setOfficialPopoverOpen((current) => (current === nextOpen ? current : nextOpen));
    };
    const scheduleDetect = () => {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(detectOfficialPopover);
    };

    const observer = new MutationObserver(scheduleDetect);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-hidden",
        "class",
        "data-align",
        "data-side",
        "data-state",
        "hidden",
        "role",
        "style"
      ]
    });

    scheduleDetect();
    document.addEventListener("click", scheduleDetect, true);
    document.addEventListener("keydown", scheduleDetect, true);
    document.addEventListener("pointerup", scheduleDetect, true);
    window.addEventListener("resize", scheduleDetect);
    window.addEventListener("scroll", scheduleDetect, true);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      document.removeEventListener("click", scheduleDetect, true);
      document.removeEventListener("keydown", scheduleDetect, true);
      document.removeEventListener("pointerup", scheduleDetect, true);
      window.removeEventListener("resize", scheduleDetect);
      window.removeEventListener("scroll", scheduleDetect, true);
    };
  }, []);

  useEffect(() => {
    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }

    if (officialPopoverOpen) {
      root.setAttribute("data-cnav-official-popover-open", "true");
    } else {
      root.removeAttribute("data-cnav-official-popover-open");
    }
  }, [officialPopoverOpen]);

  useEffect(() => {
    installRouteEvents();
    let lastHref = location.href;
    let routeCheckTimer = 0;

    const handleRouteChange = () => {
      const hrefChanged = location.href !== lastHref;
      lastHref = location.href;
      if (hrefChanged) {
        resetConversationState();
        scheduleScan(50);
        return;
      }

      if (routeCheckTimer) {
        window.clearTimeout(routeCheckTimer);
      }
      routeCheckTimer = window.setTimeout(() => {
        routeCheckTimer = 0;
        if (mapEntriesRef.current.length === 0) {
          return;
        }

        const currentPromptPreviews = new Set(
          getAdapter().collect().messages
            .filter((message) => message.role === "user")
            .map((message) => compactPreview(message.text, 112))
        );
        const hasPromptOverlap = hasConversationPromptOverlap(
          itemsRef.current.map((item) => item.promptPreview),
          currentPromptPreviews
        );
        if (!hasPromptOverlap) {
          resetConversationState();
          scheduleScan(50);
        }
      }, 80);
    };

    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("conversation-navigator-route-change", handleRouteChange);

    return () => {
      if (routeCheckTimer) {
        window.clearTimeout(routeCheckTimer);
      }
      window.removeEventListener("popstate", handleRouteChange);
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("conversation-navigator-route-change", handleRouteChange);
    };
  }, [resetConversationState, scheduleScan]);

  useEffect(() => {
    let cancelled = false;
    let syncWork: ScheduledIdleWork | null = null;

    async function loadCompatRules() {
      const stored = await storageGet<StoredCompatRules>(COMPAT_RULES_STORAGE_KEY);
      if (cancelled) {
        return;
      }

      const storedRules = normalizeCompatRulesPayload({
        schemaVersion: 1,
        rules: stored?.rules ?? []
      });
      const remoteAllowed =
        settings.compatRulesAutoSyncEnabled ||
        (settings.compatRulesRemoteEnabled && settings.compatRulesSource === "remote");

      if (!remoteAllowed || storedRules.length === 0) {
        setActiveCompatRules([], "built-in");
        setCompatRuleCount(0);
      } else {
        setActiveCompatRules(storedRules, "remote");
        setCompatRuleCount(storedRules.length);
        scheduleScan(100);
      }

      const stale = !stored?.updatedAt ||
        Date.now() - stored.updatedAt >= COMPAT_RULES_SYNC_INTERVAL_MS;
      if (!settings.compatRulesAutoSyncEnabled || !stale) {
        return;
      }

      syncWork = requestIdleWork(() => {
        void (async () => {
          const attemptAt = Date.now();
          try {
            const text = await fetchTextFromBackground(CHATGPT_COMPAT_RULES_URL, 8000);
            const parsed = JSON.parse(text) as unknown;
            const rules = normalizeCompatRulesPayload(parsed);
            if (rules.length === 0 || cancelled) {
              throw new Error("Remote compatibility rules are empty");
            }

            await storageSet({
              [COMPAT_RULES_STORAGE_KEY]: {
                updatedAt: attemptAt,
                lastAttemptAt: attemptAt,
                rules
              } satisfies StoredCompatRules,
              [STORAGE_SETTINGS_KEY]: normalizeSettings({
                ...settingsRef.current,
                compatRulesRemoteEnabled: true,
                compatRulesSource: "remote"
              })
            });
            if (!cancelled) {
              setActiveCompatRules(rules, "remote");
              setCompatRuleCount(rules.length);
              scheduleScan(50);
            }
          } catch (error) {
            await storageSet({
              [COMPAT_RULES_STORAGE_KEY]: {
                updatedAt: stored?.updatedAt ?? 0,
                lastAttemptAt: attemptAt,
                lastError: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
                rules: stored?.rules ?? []
              } satisfies StoredCompatRules
            });
          }
        })();
      }, 3000);
    }

    void loadCompatRules();

    return () => {
      cancelled = true;
      cancelIdleWork(syncWork);
    };
  }, [
    scheduleScan,
    settings.compatRulesAutoSyncEnabled,
    settings.compatRulesRemoteEnabled,
    settings.compatRulesSource
  ]);

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

    loadSettings()
      .then((nextSettings) => {
        if (!cancelled) {
          applySettingsNow(nextSettings);
        }
      })
      .catch((error) => {
        warnExtensionStorageUnavailableOnce("读取设置", error);
        if (!cancelled) {
          applySettingsNow(DEFAULT_SETTINGS);
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

    const storageChanged = getExtensionStorageOnChanged();
    if (storageChanged) {
      try {
        storageChanged.addListener(handleSettingsChange);
      } catch (error) {
        warnExtensionStorageUnavailableOnce("监听设置变化", error);
      }
    } else {
      warnExtensionStorageUnavailableOnce("监听设置变化");
    }

    return () => {
      cancelled = true;
      const cleanupStorageChanged = getExtensionStorageOnChanged();
      if (cleanupStorageChanged) {
        try {
          cleanupStorageChanged.removeListener(handleSettingsChange);
        } catch {
          // Extension context may already be invalidated while the page unloads.
        }
      }
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

  const updateCanvasResizeFrame = useCallback(() => {
    if (adapter.id !== "chatgpt") {
      canvasResizeTargetRef.current = null;
      if (canvasResizeFrameRef.current) {
        canvasResizeFrameRef.current = null;
        setCanvasResizeFrame(null);
      }
      return;
    }

    let target = canvasResizeTargetRef.current;
    if (
      !isCanvasLayoutSessionConnected(target) ||
      (target && !isRectVisible(target.layoutTarget.getBoundingClientRect()))
    ) {
      target = syncCanvasWidthTargets(settingsRef.current, target) ?? getActiveCanvasWidthTarget();
    } else {
      markCanvasLayoutSession(target, shouldApplyCanvasWidthLayout(settingsRef.current));
    }

    canvasResizeTargetRef.current = target;
    if (!shouldTrackCanvasWidthTarget(settingsRef.current)) {
      if (canvasResizeFrameRef.current) {
        canvasResizeFrameRef.current = null;
        setCanvasResizeFrame(null);
      }
      return;
    }

    const nextFrame = target ? getCanvasResizeFrame(target, settingsRef.current) : null;

    setCanvasResizeFrame((current) => {
      if (areResizeFramesEqual(current, nextFrame)) {
        return current;
      }

      canvasResizeFrameRef.current = nextFrame;
      return nextFrame;
    });
  }, [adapter.id]);

  useEffect(() => {
    applyChatTypography(settings);
  }, [
    settings.chatFontScale,
    settings.chatLetterSpacing,
    settings.chatLineHeight
  ]);

  useEffect(() => {
    applyChatTypography(settings);
    window.requestAnimationFrame(updateResizeFrame);
  }, [
    settings.chatContentWidth,
    updateResizeFrame
  ]);

  useEffect(() => {
    const target = canvasResizeTargetRef.current;
    const scrollSnapshot = shouldApplyCanvasTypography(target)
      ? captureCanvasScroll(target)
      : null;
    applyCanvasTypography(settings);
    if (scrollSnapshot) {
      window.requestAnimationFrame(() => {
        restoreCanvasScroll(scrollSnapshot);
        window.requestAnimationFrame(() => restoreCanvasScroll(scrollSnapshot));
      });
    }
  }, [
    settings.canvasFontScale,
    settings.canvasLetterSpacing,
    settings.canvasLineHeight
  ]);

  useEffect(() => {
    const widthScrollSnapshot = captureCanvasScroll(canvasResizeTargetRef.current);
    applyCanvasTypography(settings);
    let target = canvasResizeTargetRef.current;
    if (!isCanvasLayoutSessionConnected(target)) {
      target = syncCanvasWidthTargets(settingsRef.current, target);
      canvasResizeTargetRef.current = target;
    } else if (target) {
      markCanvasLayoutSession(target, shouldApplyCanvasWidthLayout(settings));
    }

    if (target && shouldApplyCanvasWidthLayout(settings)) {
      applyCanvasWidthTargetLayout(target, settings);
    } else if (target) {
      target.layoutTarget.style.removeProperty("--cnav-canvas-target-width");
      target.lastWidthPixels = null;
    }
    if (widthScrollSnapshot) {
      window.requestAnimationFrame(() => {
        restoreCanvasScroll(widthScrollSnapshot);
        window.requestAnimationFrame(() => restoreCanvasScroll(widthScrollSnapshot));
      });
    }
    window.requestAnimationFrame(updateCanvasResizeFrame);
  }, [
    settings.canvasContentWidth,
    settings.canvasWidthEnabled,
    updateCanvasResizeFrame
  ]);

  useEffect(() => {
    let frame = 0;
    let observedSession: CanvasWidthTarget | null = null;

    const observeSession = (session: CanvasWidthTarget | null) => {
      if (observedSession === session) {
        return;
      }
      resizeObserver?.disconnect();
      observedSession = session;
      const main = document.querySelector<HTMLElement>("main");
      if (main) {
        resizeObserver?.observe(main);
      }
      if (session) {
        resizeObserver?.observe(session.root);
        resizeObserver?.observe(session.layoutTarget);
        if (session.scrollContainer) {
          resizeObserver?.observe(session.scrollContainer);
        }
      }
    };

    const scheduleFrameUpdate = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          updateCanvasResizeFrame();
        });
      }
    };

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleFrameUpdate)
      : null;

    const refreshCanvasSession = (forceReplace = false) => {
      const current = canvasResizeTargetRef.current;
      if (forceReplace) {
        clearCanvasLayoutSession(current);
        canvasResizeTargetRef.current = null;
      }

      let next = canvasResizeTargetRef.current;
      if (!isCanvasLayoutSessionConnected(next)) {
        next = syncCanvasWidthTargets(settingsRef.current, next);
        canvasResizeTargetRef.current = next;
        if (next && shouldApplyCanvasWidthLayout(settingsRef.current)) {
          applyCanvasWidthTargetLayout(next, settingsRef.current);
        }
      }

      observeSession(next);
      updateCanvasResizeFrame();
    };

    const scheduleSessionRefresh = (forceReplace = false) => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshCanvasSession(forceReplace);
      });
    };

    const observer = new MutationObserver((mutations) => {
      const current = canvasResizeTargetRef.current;
      const relevantMutations = mutations.filter((mutation) => {
        const element = mutation.target instanceof HTMLElement
          ? mutation.target
          : mutation.target.parentElement;
        return Boolean(element && !element.closest(`#${ROOT_ID}`));
      });
      const result = canvasMutationsRequireSessionRefresh(
        current,
        relevantMutations,
        (element) =>
          element.matches(CANVAS_SHELL_SELECTOR) ||
          element.matches(CANVAS_DISCOVERY_SELECTOR) ||
          Boolean(element.querySelector(CANVAS_SHELL_SELECTOR))
      );
      const currentBecameHidden = Boolean(
        current &&
        relevantMutations.some((mutation) => mutation.type === "attributes" && mutation.target === current.root) &&
        !isRectVisible(current.layoutTarget.getBoundingClientRect())
      );
      if (
        current &&
        current.kind === "document" &&
        isVirtualizedCodeCanvas(current.root, current.textRoot)
      ) {
        current.kind = "virtualized-code";
        markCanvasLayoutSession(current, shouldApplyCanvasWidthLayout(settingsRef.current));
      }

      if (result.replace || result.discover || currentBecameHidden) {
        scheduleSessionRefresh(result.replace || currentBecameHidden);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-testid", "aria-label", "role"]
    });

    refreshCanvasSession();
    const handleWindowResize = () => {
      const current = canvasResizeTargetRef.current;
      if (current && shouldApplyCanvasWidthLayout(settingsRef.current)) {
        applyCanvasWidthTargetLayout(current, settingsRef.current);
      }
      scheduleFrameUpdate();
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      clearCanvasLayoutSession(canvasResizeTargetRef.current);
      canvasResizeTargetRef.current = null;
      clearOrphanedCanvasLayoutMarkers();
    };
  }, [updateCanvasResizeFrame]);

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) {
        window.clearTimeout(scanTimerRef.current);
      }
      cancelIdleWork(scanIdleWorkRef.current);
    };
  }, []);

  useEffect(() => {
    updateResizeFrame();
    updateCanvasResizeFrame();
    const handleResize = () => updateResizeFrame();
    const handleCanvasResize = () => updateCanvasResizeFrame();
    window.addEventListener("resize", handleResize);
    window.addEventListener("resize", handleCanvasResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("resize", handleCanvasResize);
    };
  }, [pageId, updateCanvasResizeFrame, updateResizeFrame]);

  useEffect(() => {
    let frame = 0;

    const updateScrollJumpPosition = () => {
      frame = 0;
      const nextPosition = getScrollJumpPosition(true);
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
    window.addEventListener("scroll", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [drawerOpen, focusMode]);

  useEffect(() => {
    scheduleScan(100);
  }, [
    pageKey,
    scheduleScan,
    settings.compatRulesRemoteEnabled,
    settings.compatRulesSource
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
      let removedConversationContent = false;

      for (const mutation of mutations) {
        const element = getMutationElement(mutation);
        if (!element || element.closest(`#${ROOT_ID}`)) {
          continue;
        }

        hasRelevantMutation = true;
        if (mutation.type !== "characterData") {
          textOnly = false;
          removedConversationContent ||= Array.from(mutation.removedNodes).some((node) =>
            node instanceof HTMLElement &&
            (
              node.matches(CHATGPT_TURN_OR_MARKER_SELECTOR) ||
              Boolean(node.querySelector(CHATGPT_TURN_OR_MARKER_SELECTOR))
            )
          );
        }
      }

      if (!hasRelevantMutation) {
        return;
      }

      if (
        removedConversationContent &&
        mapEntriesRef.current.length > 0 &&
        getAdapter().collect().messages.length === 0
      ) {
        resetConversationState();
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
  }, [resetConversationState, scheduleScan]);


  const showCanvasHandles = Boolean(canvasResizeFrame && (settings.canvasWidthEnabled || canvasResizingSide));
  const showThreadHandles = Boolean(resizeFrame && (settings.threadResizeEnabled || resizingSide) && !showCanvasHandles);
  const navigatorCollapsedForFloatingTools = true;

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
      setResizePreviewValue(latestValue);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      const applyDragPreview = () => {
        dragFrame = 0;
        const width = Math.min(getThreadWidthPixels(latestValue), availableWidth);
        const nextFrame = {
          left: Math.round(center - width / 2),
          right: Math.round(center + width / 2),
          top: Math.round(top),
          height,
          toggleLeft: Math.round(Math.max(18, leftBound + 18))
        };

        setResizePreviewValue(latestValue);
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

      const finishResize = (commit: boolean) => {
        if (dragFrame) {
          window.cancelAnimationFrame(dragFrame);
          dragFrame = 0;
        }

        setResizingSide(null);
        setResizePreviewValue(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("pointermove", handleMove, true);
        document.removeEventListener("pointerup", handleUp, true);
        document.removeEventListener("pointercancel", handleCancel, true);
        document.removeEventListener("keydown", handleKeyDown, true);

        if (!commit) {
          window.requestAnimationFrame(updateResizeFrame);
          return;
        }

        const finalSettings = normalizeSettings({
          ...settingsRef.current,
          chatContentWidth: latestValue,
          chatLayoutVersion: 2
        });
        applySettingsNow(finalSettings);
        void saveSettings(finalSettings);
      };

      const handleUp = () => finishResize(true);
      const handleCancel = () => finishResize(false);
      const handleKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finishResize(false);
        }
      };

      document.addEventListener("pointermove", handleMove, true);
      document.addEventListener("pointerup", handleUp, true);
      document.addEventListener("pointercancel", handleCancel, true);
      document.addEventListener("keydown", handleKeyDown, true);
    };

  const startCanvasResize =
    (side: "left" | "right") => (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const initialTarget = canvasResizeTargetRef.current ?? getActiveCanvasWidthTarget();
      if (!initialTarget) {
        return;
      }

      const startX = event.clientX;
      const boundsRect = getCanvasResizeBoundsRect(initialTarget.layoutTarget, initialTarget.root);
      const leftBound = Math.max(0, boundsRect.left);
      const rightBound = Math.min(window.innerWidth, boundsRect.right);
      const availableWidth = Math.max(340, rightBound - leftBound - 24);
      const minWidth = getThreadWidthPixels(THREAD_WIDTH_MIN);
      const maxWidth = Math.min(availableWidth, getThreadWidthPixels(THREAD_WIDTH_MAX));
      const startWidth = Math.min(maxWidth, Math.max(minWidth, getThreadWidthPixels(settingsRef.current.canvasContentWidth)));
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      let latestValue = settingsRef.current.canvasContentWidth;
      let latestWidthPixels = startWidth;
      let dragFrame = 0;

      setCanvasResizingSide(side);
      setCanvasResizePreviewValue(latestValue);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      const applyDragPreview = () => {
        dragFrame = 0;
        const nextSettings = normalizeSettings({
          ...settingsRef.current,
          canvasWidthEnabled: true,
          canvasContentWidth: latestValue,
          chatLayoutVersion: 2
        });
        const nextTarget = canvasResizeTargetRef.current ?? initialTarget;
        const nextFrame = getCanvasResizeFrame(nextTarget, nextSettings, latestWidthPixels);
        setCanvasResizePreviewValue(latestValue);
        setCanvasResizeFrame((current) => {
          if (areResizeFramesEqual(current, nextFrame)) {
            return current;
          }

          canvasResizeFrameRef.current = nextFrame;
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
        latestWidthPixels = Math.min(maxWidth, Math.max(minWidth, startWidth + delta * 2));
        latestValue = getThreadWidthSettingFromPixels(latestWidthPixels, false);
        scheduleDragPreview();
      };

      const finishResize = (commit: boolean) => {
        if (dragFrame) {
          window.cancelAnimationFrame(dragFrame);
          dragFrame = 0;
        }

        setCanvasResizingSide(null);
        setCanvasResizePreviewValue(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("pointermove", handleMove, true);
        document.removeEventListener("pointerup", handleUp, true);
        document.removeEventListener("pointercancel", handleCancel, true);
        document.removeEventListener("keydown", handleKeyDown, true);

        if (!commit) {
          window.requestAnimationFrame(updateCanvasResizeFrame);
          return;
        }

        const finalSettings = normalizeSettings({
          ...settingsRef.current,
          canvasWidthEnabled: true,
          canvasContentWidth: latestValue,
          chatLayoutVersion: 2
        });
        applySettingsNow(finalSettings);
        window.requestAnimationFrame(updateCanvasResizeFrame);
        void saveSettings(finalSettings);
      };

      const handleUp = () => finishResize(true);
      const handleCancel = () => finishResize(false);
      const handleKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finishResize(false);
        }
      };

      document.addEventListener("pointermove", handleMove, true);
      document.addEventListener("pointerup", handleUp, true);
      document.addEventListener("pointercancel", handleCancel, true);
      document.addEventListener("keydown", handleKeyDown, true);
    };

  return (
    <>
      <div className="cnav-reading-actions">
        {!drawerOpen ? (
          <button
            className="cnav-reading-launcher"
            data-theme={theme}
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={getReadingToolsLabels(settings.language).title}
            title={getReadingToolsLabels(settings.language).title}
          >
            <PanelRightOpen size={19} aria-hidden="true" />
            <span>{getReadingToolsLabels(settings.language).title}</span>
          </button>
        ) : null}
        {focusMode && !drawerOpen ? (
          <button className="cnav-focus-exit" data-theme={theme} type="button" onClick={toggleFocusMode}>
            <Minimize2 size={17} aria-hidden="true" />
            {getReadingToolsLabels(settings.language).exitFocus}
          </button>
        ) : null}
      </div>
      {drawerOpen && !drawerDocked ? (
        <button className="cnav-reading-backdrop" type="button" onClick={() => setDrawerOpen(false)} aria-label="Close" />
      ) : null}
      <ReadingToolsDrawer
        open={drawerOpen}
        docked={drawerDocked}
        panel={activeToolPanel}
        language={settings.language}
        theme={theme}
        motionEnabled={settings.uiMotionEnabled}
        snapshot={selectiveSnapshot}
        selectedBlockIds={selectedBlockIds}
        items={items}
        focusMode={focusMode}
        activeTurnIndex={activeFocusTurn}
        readingProgress={readingProgress}
        citationsChecking={citationsChecking}
        exportPreferences={exportPreferences}
        onClose={() => setDrawerOpen(false)}
        onPanelChange={setActiveToolPanel}
        onToggleFocus={toggleFocusMode}
        onChangeTurn={setFocusTurn}
        onSelectAll={selectAllBlocks}
        onSelectRole={selectExportRole}
        onToggleMessage={toggleExportMessage}
        onToggleBlock={toggleExportBlock}
        onExportPreferencesChange={updateSelectiveExportPreferences}
        onExport={exportSelectedBlocks}
        onCheckCitations={() => void checkAllCitations()}
        onOpenCitation={openCitation}
        onCopyCitations={() => void copyCitationList()}
      />
      {showThreadHandles && resizeFrame ? (
        <>
          {resizePreviewValue !== null ? (
            <div
              className="cnav-resize-preview-label"
              style={{ left: (resizeFrame.left + resizeFrame.right) / 2, top: resizeFrame.top + 10 }}
            >
              {Math.round(resizePreviewValue)}%
            </div>
          ) : null}
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

      {showCanvasHandles && canvasResizeFrame ? (
        <>
          {canvasResizePreviewValue !== null ? (
            <div
              className="cnav-resize-preview-label"
              style={{
                left: (canvasResizeFrame.left + canvasResizeFrame.right) / 2,
                top: canvasResizeFrame.top + 10
              }}
            >
              {Math.round(canvasResizePreviewValue)}%
            </div>
          ) : null}
          <button
            className={`cnav-thread-handle cnav-canvas-handle is-left${canvasResizingSide === "left" ? " is-dragging" : ""}`}
            type="button"
            style={{
              left: canvasResizeFrame.left,
              top: canvasResizeFrame.top,
              height: canvasResizeFrame.height
            }}
            aria-label={`${t.canvasDisplay} ${t.contentWidth}`}
            title={`${t.canvasDisplay} ${t.contentWidth}`}
            onPointerDown={startCanvasResize("left")}
          />
          <button
            className={`cnav-thread-handle cnav-canvas-handle is-right${canvasResizingSide === "right" ? " is-dragging" : ""}`}
            type="button"
            style={{
              left: canvasResizeFrame.right,
              top: canvasResizeFrame.top,
              height: canvasResizeFrame.height
            }}
            aria-label={`${t.canvasDisplay} ${t.contentWidth}`}
            title={`${t.canvasDisplay} ${t.contentWidth}`}
            onPointerDown={startCanvasResize("right")}
          />
        </>
      ) : null}

      <TableCopyLayer
        theme={theme}
        language={settings.language}
        navigatorCollapsed={navigatorCollapsedForFloatingTools}
      />

      <CodeBlockLayer
        theme={theme}
        language={settings.language}
        navigatorCollapsed={navigatorCollapsedForFloatingTools}
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

