export const STORAGE_SETTINGS_KEY = "conversationNavigator:settings";
export const TOKEN_COUNT_BATCH_MESSAGE = "conversationNavigator:countTokensBatch";
export const LIBRARY_STORAGE_KEY = "conversationNavigator:library:v1";
export const MATERIALS_LIST_MESSAGE = "conversationNavigator:materials:list";
export const SELECTION_GET_MESSAGE = "conversationNavigator:selection:get";
export const EXPORT_SNAPSHOT_MESSAGE = "conversationNavigator:export:snapshot";
export const PAGE_STATUS_MESSAGE = "conversationNavigator:pageStatus";

export type AppLanguage = "zh-CN" | "zh-TW" | "en";
export type TokenBudgetMode = "model" | "manual";
export type AdapterHealthStatus = "ok" | "degraded" | "unsupported";
export type CompatRulesSource = "built-in" | "remote";
export type LibraryItemKind = "prompt" | "code" | "selection";

export interface TokenCountBatchItem {
  id: string;
  text: string;
}

export interface TokenCountBatchRequest {
  type: typeof TOKEN_COUNT_BATCH_MESSAGE;
  sessionId: string;
  items: TokenCountBatchItem[];
}

export interface TokenCountBatchResponse {
  ok: boolean;
  sessionId?: string;
  counts?: Array<{ id: string; count: number }>;
  error?: string;
}

export interface LibraryItem {
  id: string;
  kind: LibraryItemKind;
  title: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  sourceUrl: string;
  sourceTitle: string;
  pageKey: string;
  language?: string;
  filename?: string;
}

export interface StoredLibrary {
  schemaVersion: 1;
  updatedAt: number;
  items: LibraryItem[];
}

export interface PageMaterial {
  id: string;
  kind: "prompt" | "code";
  title: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  pageKey: string;
  language?: string;
  filename?: string;
}

export interface SelectionMaterial {
  id: string;
  kind: LibraryItemKind;
  title: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  pageKey: string;
  language?: string;
  filename?: string;
}

export interface ExportChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  turnIndex: number;
}

export interface ExportCodeBlock {
  id: string;
  text: string;
  language?: string;
  filename?: string;
}

export interface ExportNavigatorNode {
  id: string;
  title: string;
  promptPreview: string;
  answerSummary: string;
  groupLabel: string;
  turnIndex: number;
  promptTokens: number;
  answerTokens: number;
  totalTokens: number;
}

export interface ExportSnapshot {
  title: string;
  url: string;
  pageKey: string;
  exportedAt: number;
  messages: ExportChatMessage[];
  codeBlocks: ExportCodeBlock[];
  nodes: ExportNavigatorNode[];
}

export interface PageAdapterHealth {
  status: AdapterHealthStatus;
  reason: string;
  ruleId: string;
  messageCount: number;
  userCount: number;
  assistantCount: number;
  source: CompatRulesSource;
  updatedAt: number;
}

export interface NavigatorSettings {
  language: AppLanguage;
  chatFontScale: number;
  chatLetterSpacing: number;
  chatLineHeight: number;
  canvasFontScale: number;
  canvasLetterSpacing: number;
  canvasLineHeight: number;
  canvasContentWidth: number;
  canvasWidthEnabled: boolean;
  chatLayoutVersion: 2;
  chatContentWidth: number;
  threadResizeEnabled: boolean;
  tokenPanelEnabled: boolean;
  tokenPanelCollapsed: boolean;
  tokenBudgetMode: TokenBudgetMode;
  tokenModelId: string;
  manualTokenBudget: number;
  tokenHudX: number;
  tokenHudY: number;
  compatRulesRemoteEnabled: boolean;
  compatRulesAutoSyncEnabled: boolean;
  compatRulesLastSyncAt: number;
  compatRulesSource: CompatRulesSource;
  navigateAnimationEnabled: boolean;
}

export const DEFAULT_SETTINGS: NavigatorSettings = {
  language: "zh-CN",
  chatFontScale: 100,
  chatLetterSpacing: 0,
  chatLineHeight: 155,
  canvasFontScale: 100,
  canvasLetterSpacing: 0,
  canvasLineHeight: 155,
  canvasContentWidth: 60,
  canvasWidthEnabled: false,
  chatLayoutVersion: 2,
  chatContentWidth: 60,
  threadResizeEnabled: false,
  tokenPanelEnabled: true,
  tokenPanelCollapsed: false,
  tokenBudgetMode: "model",
  tokenModelId: "chatgpt-auto",
  manualTokenBudget: 128000,
  tokenHudX: 0,
  tokenHudY: 0,
  compatRulesRemoteEnabled: false,
  compatRulesAutoSyncEnabled: true,
  compatRulesLastSyncAt: 0,
  compatRulesSource: "built-in",
  navigateAnimationEnabled: true
};

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

export function normalizeSettings(value: Partial<NavigatorSettings> | undefined): NavigatorSettings {
  const language: AppLanguage =
    value?.language === "zh-TW" || value?.language === "en" ? value.language : "zh-CN";
  const tokenBudgetMode: TokenBudgetMode = value?.tokenBudgetMode === "manual" ? "manual" : "model";
  const compatRulesSource: CompatRulesSource = value?.compatRulesSource === "remote" ? "remote" : "built-in";
  const isCurrentLayout = value?.chatLayoutVersion === 2;

  return {
    language,
    chatFontScale: clampNumber(value?.chatFontScale, 85, 220, 100),
    chatLetterSpacing: clampNumber(value?.chatLetterSpacing, 0, 8, 0),
    chatLineHeight: clampNumber(value?.chatLineHeight, 125, 220, 155),
    canvasFontScale: clampNumber(value?.canvasFontScale, 75, 220, 100),
    canvasLetterSpacing: clampNumber(value?.canvasLetterSpacing, 0, 8, 0),
    canvasLineHeight: clampNumber(value?.canvasLineHeight, 120, 230, 155),
    canvasContentWidth: clampNumber(isCurrentLayout ? value?.canvasContentWidth : undefined, 60, 100, 60),
    canvasWidthEnabled: Boolean(value?.canvasWidthEnabled),
    chatLayoutVersion: 2,
    chatContentWidth: clampNumber(isCurrentLayout ? value?.chatContentWidth : undefined, 60, 100, 60),
    threadResizeEnabled: Boolean(value?.threadResizeEnabled),
    tokenPanelEnabled: value?.tokenPanelEnabled !== false,
    tokenPanelCollapsed: Boolean(value?.tokenPanelCollapsed),
    tokenBudgetMode,
    tokenModelId: typeof value?.tokenModelId === "string" && value.tokenModelId.trim()
      ? value.tokenModelId.trim().slice(0, 80)
      : "chatgpt-auto",
    manualTokenBudget: Math.round(clampNumber(value?.manualTokenBudget, 8000, 2000000, 128000)),
    tokenHudX: Math.round(clampNumber(value?.tokenHudX, 0, 10000, 0)),
    tokenHudY: Math.round(clampNumber(value?.tokenHudY, 0, 10000, 0)),
    compatRulesRemoteEnabled: Boolean(value?.compatRulesRemoteEnabled),
    compatRulesAutoSyncEnabled: value?.compatRulesAutoSyncEnabled !== false,
    compatRulesLastSyncAt: Math.round(clampNumber(value?.compatRulesLastSyncAt, 0, Number.MAX_SAFE_INTEGER, 0)),
    compatRulesSource: value?.compatRulesRemoteEnabled ? compatRulesSource : "built-in",
    navigateAnimationEnabled: value?.navigateAnimationEnabled !== false
  };
}

export function isLegacyConversationRecord(value: unknown, key?: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as {
    schemaVersion?: unknown;
    pageKey?: unknown;
    nodes?: unknown;
  };
  if (
    record.schemaVersion !== 1 ||
    typeof record.pageKey !== "string" ||
    !Array.isArray(record.nodes)
  ) {
    return false;
  }

  return key === undefined || (key.includes(":page:") && record.pageKey === key);
}

export function findLegacyConversationRecordKeys(values: Record<string, unknown>): string[] {
  return Object.entries(values)
    .filter(([key, value]) => isLegacyConversationRecord(value, key))
    .map(([key]) => key);
}
