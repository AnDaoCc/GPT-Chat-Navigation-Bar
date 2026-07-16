export const STORAGE_SETTINGS_KEY = "conversationNavigator:settings";
export const LIBRARY_STORAGE_KEY = "conversationNavigator:library:v1";
export const MATERIALS_LIST_MESSAGE = "conversationNavigator:materials:list";
export const SELECTION_GET_MESSAGE = "conversationNavigator:selection:get";
export const EXPORT_SNAPSHOT_MESSAGE = "conversationNavigator:export:snapshot";
export const PAGE_STATUS_MESSAGE = "conversationNavigator:pageStatus";
export const PAGE_COMMAND_MESSAGE = "conversationNavigator:pageCommand";
export const CITATION_CHECK_MESSAGE = "conversationNavigator:citations:check";
export const CITATION_PERMISSION_MESSAGE = "conversationNavigator:citations:permission";
export const EXPORT_PREFERENCES_STORAGE_KEY = "conversationNavigator:exportPreferences:v2";
export const CITATION_STATE_STORAGE_KEY = "conversationNavigator:citationState:v1";

export type AppLanguage = "zh-CN" | "zh-TW" | "en";
export type AdapterHealthStatus = "ok" | "degraded" | "unsupported";
export type CompatRulesSource = "built-in" | "remote";
export type LibraryItemKind = "prompt" | "code" | "selection";
export type ReadingToolPanel = "focus" | "export" | "citations";
export type DrawerMode = "auto" | "dock" | "overlay";
export type ExportDocumentFormat = "md" | "html" | "docx";
export type ExportContentBlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "code"
  | "table"
  | "image"
  | "attachment";
export type CitationCheckStatus =
  | "unchecked"
  | "checking"
  | "reachable"
  | "missing"
  | "restricted"
  | "temporary-error"
  | "blocked";
export type CitationCheckReason = "unsafe-url" | "permission-required";

export interface PageCommandMessage {
  type: typeof PAGE_COMMAND_MESSAGE;
  command: "open" | "close" | "toggle";
  panel?: ReadingToolPanel;
}

export interface ExportContentBlock {
  id: string;
  messageId: string;
  role: "user" | "assistant";
  kind: ExportContentBlockKind;
  text: string;
  order: number;
  level?: number;
  language?: string;
  filename?: string;
  rows?: string[][];
  sourceUrl?: string;
  sourceLabel?: string;
}

export interface SelectiveExportMessage extends ExportChatMessage {
  blocks: ExportContentBlock[];
}

export interface SelectiveExportSnapshot extends Omit<ExportSnapshot, "messages"> {
  messages: SelectiveExportMessage[];
  citations: CitationRecord[];
}

export interface SelectiveExportPreferences {
  schemaVersion: 2;
  format: ExportDocumentFormat;
  includeSourceMeta: boolean;
  includeExportedAt: boolean;
  includeModel: boolean;
  filterShortMessages: boolean;
  mergeAdjacentAnswers: boolean;
  generateToc: boolean;
}

export const DEFAULT_SELECTIVE_EXPORT_PREFERENCES: SelectiveExportPreferences = {
  schemaVersion: 2,
  format: "docx",
  includeSourceMeta: false,
  includeExportedAt: false,
  includeModel: false,
  filterShortMessages: false,
  mergeAdjacentAnswers: false,
  generateToc: false
};

export function normalizeSelectiveExportPreferences(value: unknown): SelectiveExportPreferences {
  const input = value && typeof value === "object" ? value as Partial<SelectiveExportPreferences> : {};
  const format: ExportDocumentFormat = input.format === "html" || input.format === "md" ? input.format : "docx";
  return {
    schemaVersion: 2,
    format,
    includeSourceMeta: Boolean(input.includeSourceMeta),
    includeExportedAt: Boolean(input.includeExportedAt),
    includeModel: Boolean(input.includeModel),
    filterShortMessages: Boolean(input.filterShortMessages),
    mergeAdjacentAnswers: Boolean(input.mergeAdjacentAnswers),
    generateToc: Boolean(input.generateToc)
  };
}

export interface CitationOccurrence {
  href: string;
  messageId: string;
  blockId: string;
  excerpt: string;
}

export interface CitationRecord {
  id: string;
  href: string;
  canonicalUrl: string;
  title: string;
  domain: string;
  messageId: string;
  blockId: string;
  excerpt: string;
  occurrenceCount: number;
  occurrences: CitationOccurrence[];
  openedAt: number;
  checkStatus: CitationCheckStatus;
  checkReason?: CitationCheckReason;
  statusCode?: number;
  checkedAt?: number;
}

export interface CitationCheckResult {
  url: string;
  status: CitationCheckStatus;
  reason?: CitationCheckReason;
  statusCode?: number;
  checkedAt: number;
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
}

export interface ExportSnapshot {
  title: string;
  url: string;
  pageKey: string;
  exportedAt: number;
  messages: ExportChatMessage[];
  codeBlocks: ExportCodeBlock[];
  nodes: ExportNavigatorNode[];
  exportPreferences?: SelectiveExportPreferences;
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
  compatRulesRemoteEnabled: boolean;
  compatRulesAutoSyncEnabled: boolean;
  compatRulesLastSyncAt: number;
  compatRulesSource: CompatRulesSource;
  navigateAnimationEnabled: boolean;
  drawerMode: DrawerMode;
  uiMotionEnabled: boolean;
  focusHideChrome: boolean;
  focusCollapseOtherTurns: boolean;
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
  compatRulesRemoteEnabled: false,
  compatRulesAutoSyncEnabled: true,
  compatRulesLastSyncAt: 0,
  compatRulesSource: "built-in",
  navigateAnimationEnabled: true,
  drawerMode: "auto",
  uiMotionEnabled: true,
  focusHideChrome: true,
  focusCollapseOtherTurns: true
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
  const compatRulesSource: CompatRulesSource = value?.compatRulesSource === "remote" ? "remote" : "built-in";
  const drawerMode: DrawerMode = value?.drawerMode === "dock" || value?.drawerMode === "overlay"
    ? value.drawerMode
    : "auto";
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
    compatRulesRemoteEnabled: Boolean(value?.compatRulesRemoteEnabled),
    compatRulesAutoSyncEnabled: value?.compatRulesAutoSyncEnabled !== false,
    compatRulesLastSyncAt: Math.round(clampNumber(value?.compatRulesLastSyncAt, 0, Number.MAX_SAFE_INTEGER, 0)),
    compatRulesSource: value?.compatRulesRemoteEnabled ? compatRulesSource : "built-in",
    navigateAnimationEnabled: value?.navigateAnimationEnabled !== false,
    drawerMode,
    uiMotionEnabled: value?.uiMotionEnabled !== false,
    focusHideChrome: value?.focusHideChrome !== false,
    focusCollapseOtherTurns: value?.focusCollapseOtherTurns !== false
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
