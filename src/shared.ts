export const DEFAULT_CACHE_NAMESPACE = "conversationNavigator";
export const STORAGE_RECORD_PREFIX = `${DEFAULT_CACHE_NAMESPACE}:page:`;
export const STORAGE_SETTINGS_KEY = "conversationNavigator:settings";

export type CacheMode = "chrome" | "page" | "off";
export type AppLanguage = "zh-CN" | "zh-TW" | "en";
export type TokenPanelMode = "floating" | "dock";
export type TokenBudgetMode = "model" | "manual";

export interface StoredNavigatorNode {
  id: string;
  promptPreview: string;
  answerSummary: string;
  turnIndex: number;
  favorite: boolean;
  promptTokens?: number;
  answerTokens?: number;
  totalTokens?: number;
  heatLevel?: number;
  updatedAt: number;
}

export interface StoredConversationRecord {
  schemaVersion: 1;
  pageKey: string;
  url: string;
  host: string;
  title: string;
  updatedAt: number;
  nodes: StoredNavigatorNode[];
  favorites: Record<string, true>;
}

export interface NavigatorSettings {
  collapsed: boolean;
  cacheMode: CacheMode;
  cacheNamespace: string;
  language: AppLanguage;
  chatFontScale: number;
  chatLetterSpacing: number;
  chatLineHeight: number;
  canvasFontScale: number;
  canvasLetterSpacing: number;
  canvasLineHeight: number;
  chatLayoutVersion: 2;
  chatContentWidth: number;
  autoCollapseOnOutsideClick: boolean;
  tokenPanelEnabled: boolean;
  tokenPanelMode: TokenPanelMode;
  tokenPanelCollapsed: boolean;
  tokenBudgetMode: TokenBudgetMode;
  tokenModelId: string;
  manualTokenBudget: number;
  tokenHudX: number;
  tokenHudY: number;
}

export const DEFAULT_SETTINGS: NavigatorSettings = {
  collapsed: false,
  cacheMode: "chrome",
  cacheNamespace: DEFAULT_CACHE_NAMESPACE,
  language: "zh-CN",
  chatFontScale: 100,
  chatLetterSpacing: 0,
  chatLineHeight: 155,
  canvasFontScale: 100,
  canvasLetterSpacing: 0,
  canvasLineHeight: 155,
  chatLayoutVersion: 2,
  chatContentWidth: 60,
  autoCollapseOnOutsideClick: false,
  tokenPanelEnabled: true,
  tokenPanelMode: "floating",
  tokenPanelCollapsed: false,
  tokenBudgetMode: "model",
  tokenModelId: "chatgpt-auto",
  manualTokenBudget: 128000,
  tokenHudX: 0,
  tokenHudY: 0
};

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

export function sanitizeCacheNamespace(value: string | undefined): string {
  const normalized = (value || DEFAULT_CACHE_NAMESPACE)
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);

  return normalized || DEFAULT_CACHE_NAMESPACE;
}

export function normalizeSettings(value: Partial<NavigatorSettings> | undefined): NavigatorSettings {
  const cacheMode: CacheMode =
    value?.cacheMode === "page" || value?.cacheMode === "off" ? value.cacheMode : "chrome";
  const language: AppLanguage =
    value?.language === "zh-TW" || value?.language === "en" ? value.language : "zh-CN";
  const tokenPanelMode: TokenPanelMode = value?.tokenPanelMode === "dock" ? "dock" : "floating";
  const tokenBudgetMode: TokenBudgetMode = value?.tokenBudgetMode === "manual" ? "manual" : "model";
  const isCurrentLayout = value?.chatLayoutVersion === 2;

  return {
    collapsed: Boolean(value?.collapsed),
    cacheMode,
    cacheNamespace: sanitizeCacheNamespace(value?.cacheNamespace),
    language,
    chatFontScale: clampNumber(value?.chatFontScale, 85, 220, 100),
    chatLetterSpacing: clampNumber(value?.chatLetterSpacing, 0, 8, 0),
    chatLineHeight: clampNumber(value?.chatLineHeight, 125, 220, 155),
    canvasFontScale: clampNumber(value?.canvasFontScale, 75, 220, 100),
    canvasLetterSpacing: clampNumber(value?.canvasLetterSpacing, 0, 8, 0),
    canvasLineHeight: clampNumber(value?.canvasLineHeight, 120, 230, 155),
    chatLayoutVersion: 2,
    chatContentWidth: clampNumber(isCurrentLayout ? value?.chatContentWidth : undefined, 60, 100, 60),
    autoCollapseOnOutsideClick: Boolean(value?.autoCollapseOnOutsideClick),
    tokenPanelEnabled: value?.tokenPanelEnabled !== false,
    tokenPanelMode,
    tokenPanelCollapsed: Boolean(value?.tokenPanelCollapsed),
    tokenBudgetMode,
    tokenModelId: typeof value?.tokenModelId === "string" && value.tokenModelId.trim()
      ? value.tokenModelId.trim().slice(0, 80)
      : "chatgpt-auto",
    manualTokenBudget: Math.round(clampNumber(value?.manualTokenBudget, 8000, 2000000, 128000)),
    tokenHudX: Math.round(clampNumber(value?.tokenHudX, 0, 10000, 0)),
    tokenHudY: Math.round(clampNumber(value?.tokenHudY, 0, 10000, 0))
  };
}

export function makeRecordKey(namespace: string, pageId: string): string {
  return `${sanitizeCacheNamespace(namespace)}:page:${pageId}`;
}

export function isNavigatorRecordKey(key: string, namespace?: string): boolean {
  if (namespace) {
    return key.startsWith(`${sanitizeCacheNamespace(namespace)}:page:`);
  }

  return /^[a-zA-Z0-9:_-]+:page:/.test(key);
}
