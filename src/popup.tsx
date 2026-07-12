import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Copy,
  Database,
  Download,
  FileText,
  Gauge,
  Languages,
  MoveHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Type
} from "lucide-react";
import {
  AppLanguage,
  DEFAULT_SETTINGS,
  EXPORT_SNAPSHOT_MESSAGE,
  ExportSnapshot,
  LIBRARY_STORAGE_KEY,
  LibraryItem,
  MATERIALS_LIST_MESSAGE,
  NavigatorSettings,
  PAGE_STATUS_MESSAGE,
  PageAdapterHealth,
  PageMaterial,
  SELECTION_GET_MESSAGE,
  normalizeSettings,
  SelectionMaterial,
  STORAGE_SETTINGS_KEY,
  StoredLibrary
} from "./shared";
import { getTranslation, LANGUAGE_NAMES } from "./i18n";
import { CHATGPT_COMPAT_RULES_URL, normalizeCompatRulesPayload } from "./chatGptAdapter";

type PageStatusResponse = {
  ok?: boolean;
  health?: PageAdapterHealth | null;
  error?: string;
};

type MaterialsResponse = {
  ok?: boolean;
  materials?: PageMaterial[];
  error?: string;
};

type SelectionResponse = {
  ok?: boolean;
  material?: SelectionMaterial | null;
  error?: string;
};

type ExportSnapshotResponse = {
  ok?: boolean;
  snapshot?: ExportSnapshot;
  error?: string;
};

type DisplayNumberSetting =
  | "chatFontScale"
  | "chatLetterSpacing"
  | "chatLineHeight"
  | "chatContentWidth"
  | "canvasFontScale"
  | "canvasLetterSpacing"
  | "canvasLineHeight"
  | "canvasContentWidth";

type CompatStatus = "idle" | "syncing" | "synced" | "failed";
type PageBridgeStatus = "idle" | "loading" | "ready" | "failed";
type ExportContentMode = "chat" | "full" | "outline";
type ExportDocumentFormat = "md" | "html" | "docx";

interface PopupModelBudgetEntry {
  id: string;
  label: string;
  budget: number;
  aliases?: string[];
}

interface StoredPopupModelCatalog {
  updatedAt?: number;
  models?: unknown[];
}

interface StoredPopupCompatRules {
  updatedAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  rules?: unknown[];
}

const OFFICIAL_THREAD_WIDTH = 60;
const THREAD_WIDTH_MIN = 60;
const THREAD_WIDTH_MAX = 100;
const DEFAULT_TOKEN_MODEL_ID = "chatgpt-auto";
const MODEL_CATALOG_STORAGE_KEY = "conversationNavigator:modelCatalog:v1";
const COMPAT_RULES_STORAGE_KEY = "conversationNavigator:compatRules:v1";
const EXPORT_DOCUMENT_FORMAT_STORAGE_KEY = "conversationNavigator:exportFormat:v1";
const TOKEN_BUDGET_PRESETS = [32000, 128000, 200000, 400000, 1000000, 2000000];
const EXPORT_CONTENT_MODES: ExportContentMode[] = ["chat", "full", "outline"];
const EXPORT_DOCUMENT_FORMATS: ExportDocumentFormat[] = ["docx", "html", "md"];
const POPUP_BUILT_IN_MODEL_BUDGETS: PopupModelBudgetEntry[] = [
  {
    id: DEFAULT_TOKEN_MODEL_ID,
    label: "",
    budget: 128000,
    aliases: ["auto", "current model", "chatgpt"]
  },
  {
    id: "gpt-5.5-instant",
    label: "GPT-5.5 Instant",
    budget: 32000,
    aliases: ["gpt-5.5 instant", "gpt 5.5 instant", "instant", "fast"]
  },
  {
    id: "gpt-5.5-thinking",
    label: "GPT-5.5 Thinking",
    budget: 256000,
    aliases: ["gpt-5.5 thinking", "gpt 5.5 thinking", "thinking", "reasoning"]
  },
  {
    id: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    budget: 400000,
    aliases: ["gpt-5.5-pro", "gpt-5.5 pro", "gpt 5.5 pro", "pro"]
  }
];

function getPopupExtraLabels(language: AppLanguage) {
  if (language === "en") {
    return {
      readingDisplay: "Reading display",
      behavior: "Behavior",
      tokenSettings: "Token settings",
      preciseValue: "Precise value",
      enableTokenPanel: "Enable token panel",
      remoteCompat: "Automatically sync compatibility rules",
      syncCompat: "Sync remote rules",
      resetCompat: "Use built-in rules",
      widthHandle: "Width resize handle",
      canvasWidthControl: "Show canvas resize handles",
      canvasOfficialWidth: "Official canvas width",
      enabled: "Enabled",
      disabled: "Disabled",
      library: "Library",
      currentMaterials: "Current page materials",
      markdownExport: "Export document",
      searchLibrary: "Search library",
      noLibraryItems: "No saved prompts or code yet.",
      copy: "Copy",
      delete: "Delete",
      clearLibrary: "Clear library",
      addToLibrary: "Save",
      saved: "Saved",
      duplicateSaved: "Already saved",
      collectSelection: "Save selected text",
      refreshMaterials: "Refresh materials",
      noMaterials: "Open a ChatGPT conversation and refresh materials.",
      promptKind: "Prompt",
      codeKind: "Code",
      selectionKind: "Selection",
      exportContent: "Content",
      exportChatOnly: "Chat only",
      exportDetailed: "Detailed document",
      exportOutlineMode: "Structure outline",
      exportDocument: "Export document",
      exportFormat: "Format",
      exportFormatMarkdown: "Markdown (.md)",
      exportFormatHtml: "HTML (.html)",
      exportFormatDocx: "Word (.docx)",
      exportNote: "Exports the current ChatGPT page only. Nothing is uploaded.",
      noActiveChat: "No active ChatGPT tab detected.",
      copied: "Copied",
      libraryCount: "items"
    };
  }

  if (language === "zh-TW") {
    return {
      readingDisplay: "閱讀顯示",
      behavior: "功能行為",
      tokenSettings: "Token 設定",
      preciseValue: "精準數值",
      enableTokenPanel: "啟用 Token 面板",
      remoteCompat: "自動同步遠端相容規則",
      syncCompat: "同步遠端規則",
      resetCompat: "使用內建規則",
      widthHandle: "正文寬度調節",
      canvasWidthControl: "顯示畫布調節豎條",
      canvasOfficialWidth: "恢復官方畫布黑邊",
      enabled: "已啟用",
      disabled: "已停用",
      library: "收藏庫",
      currentMaterials: "目前頁面素材",
      markdownExport: "匯出文件",
      searchLibrary: "搜尋收藏",
      noLibraryItems: "還沒有保存的提示詞或代碼。",
      copy: "複製",
      delete: "刪除",
      clearLibrary: "清空收藏庫",
      addToLibrary: "保存",
      saved: "已保存",
      duplicateSaved: "已收藏",
      collectSelection: "收藏選中文字",
      refreshMaterials: "刷新素材",
      noMaterials: "打開 ChatGPT 對話後刷新素材。",
      promptKind: "提示詞",
      codeKind: "代碼",
      selectionKind: "選區",
      exportContent: "匯出內容",
      exportChatOnly: "僅聊天內容",
      exportDetailed: "詳細文件",
      exportOutlineMode: "結構大綱",
      exportDocument: "匯出文件",
      exportFormat: "格式",
      exportFormatMarkdown: "Markdown (.md)",
      exportFormatHtml: "HTML (.html)",
      exportFormatDocx: "Word (.docx)",
      exportNote: "僅匯出目前 ChatGPT 頁面，不上傳內容。",
      noActiveChat: "未偵測到目前 ChatGPT 分頁。",
      copied: "已複製",
      libraryCount: "項"
    };
  }

  return {
    readingDisplay: "阅读显示",
    behavior: "功能行为",
    tokenSettings: "Token 设置",
    preciseValue: "精准数值",
    enableTokenPanel: "启用 Token 面板",
    remoteCompat: "自动同步远程兼容规则",
    syncCompat: "同步远程规则",
    resetCompat: "使用内置规则",
    widthHandle: "正文宽度调节",
    canvasWidthControl: "显示画布调节竖条",
    canvasOfficialWidth: "恢复官方画布黑边",
    enabled: "已启用",
    disabled: "已停用",
    library: "收藏库",
    currentMaterials: "当前页素材",
    markdownExport: "导出文档",
    searchLibrary: "搜索收藏",
    noLibraryItems: "还没有保存的提示词或代码。",
    copy: "复制",
    delete: "删除",
    clearLibrary: "清空收藏库",
    addToLibrary: "保存",
    saved: "已保存",
    duplicateSaved: "已收藏",
    collectSelection: "收藏选中文本",
    refreshMaterials: "刷新素材",
    noMaterials: "打开 ChatGPT 对话后刷新素材。",
    promptKind: "提示词",
    codeKind: "代码",
    selectionKind: "选区",
    exportContent: "导出内容",
    exportChatOnly: "仅聊天内容",
    exportDetailed: "详细文档",
    exportOutlineMode: "结构大纲",
    exportDocument: "导出文档",
    exportFormat: "格式",
    exportFormatMarkdown: "Markdown (.md)",
    exportFormatHtml: "HTML (.html)",
    exportFormatDocx: "Word (.docx)",
    exportNote: "仅导出当前 ChatGPT 页面，不上传内容。",
    noActiveChat: "未检测到当前 ChatGPT 标签页。",
    copied: "已复制",
    libraryCount: "项"
  };
}

function formatBudgetLabel(value: number): string {
  if (value >= 1000000) {
    return `${value / 1000000}M`;
  }

  return `${Math.round(value / 1000)}k`;
}

function formatExportTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return Math.round(value).toLocaleString();
}

function normalizePopupModelEntry(value: unknown): PopupModelBudgetEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const model = value as Partial<PopupModelBudgetEntry>;
  const id = typeof model.id === "string" ? model.id.trim().slice(0, 80) : "";
  const label = typeof model.label === "string" ? model.label.trim().slice(0, 80) : "";
  const budget = Number(model.budget);
  if (!id || !Number.isFinite(budget) || budget < 8000) {
    return null;
  }

  return {
    id,
    label: label || id,
    budget: Math.round(Math.min(2000000, budget)),
    aliases: Array.isArray(model.aliases)
      ? model.aliases.filter((alias): alias is string => typeof alias === "string").slice(0, 12)
      : []
  };
}

function mergePopupModelCatalog(models: unknown[]): PopupModelBudgetEntry[] {
  const byId = new Map<string, PopupModelBudgetEntry>();
  const ordered: PopupModelBudgetEntry[] = [];
  const addModel = (model: PopupModelBudgetEntry | null) => {
    if (!model) {
      return;
    }

    const existing = byId.get(model.id);
    if (existing) {
      byId.set(model.id, { ...existing, ...model });
      return;
    }

    byId.set(model.id, model);
    ordered.push(model);
  };

  addModel(POPUP_BUILT_IN_MODEL_BUDGETS[0]);
  models.map(normalizePopupModelEntry).forEach(addModel);
  POPUP_BUILT_IN_MODEL_BUDGETS.slice(1).forEach(addModel);

  return ordered.map((model) => byId.get(model.id) ?? model);
}

function readStoredModelCatalog(): Promise<PopupModelBudgetEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(MODEL_CATALOG_STORAGE_KEY, (result) => {
      const stored = result[MODEL_CATALOG_STORAGE_KEY] as StoredPopupModelCatalog | undefined;
      resolve(mergePopupModelCatalog(Array.isArray(stored?.models) ? stored.models : []));
    });
  });
}

function formatModelOptionLabel(model: PopupModelBudgetEntry, autoLabel: string): string {
  if (model.id === DEFAULT_TOKEN_MODEL_ID) {
    return autoLabel;
  }

  return `${model.label} · ${formatBudgetLabel(model.budget)}`;
}

function normalizePopupText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

function normalizeLibraryItem(value: unknown): LibraryItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<LibraryItem>;
  const kind = item.kind === "prompt" || item.kind === "code" || item.kind === "selection" ? item.kind : null;
  const text = typeof item.text === "string" ? item.text.slice(0, 200000) : "";
  if (!kind || !text.trim()) {
    return null;
  }

  const now = Date.now();
  const title = typeof item.title === "string" && item.title.trim()
    ? item.title.trim().slice(0, 120)
    : normalizePopupText(text).slice(0, 72) || kind;

  return {
    id: typeof item.id === "string" && item.id ? item.id : `library-${stableHash(`${kind}:${text}`)}`,
    kind,
    title,
    text,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
    sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : "",
    sourceTitle: typeof item.sourceTitle === "string" ? item.sourceTitle : "",
    pageKey: typeof item.pageKey === "string" ? item.pageKey : "",
    language: typeof item.language === "string" && item.language.trim() ? item.language.trim().slice(0, 40) : undefined,
    filename: typeof item.filename === "string" && item.filename.trim() ? item.filename.trim().slice(0, 120) : undefined
  };
}

function readLibrary(): Promise<LibraryItem[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(LIBRARY_STORAGE_KEY, (result) => {
      const stored = result[LIBRARY_STORAGE_KEY] as Partial<StoredLibrary> | undefined;
      const items = Array.isArray(stored?.items)
        ? stored.items.map(normalizeLibraryItem).filter((item): item is LibraryItem => Boolean(item))
        : [];
      resolve(items.sort((a, b) => b.updatedAt - a.updatedAt));
    });
  });
}

function writeLibrary(items: LibraryItem[]): Promise<void> {
  const normalized = items
    .map(normalizeLibraryItem)
    .filter((item): item is LibraryItem => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 300);

  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [LIBRARY_STORAGE_KEY]: {
          schemaVersion: 1,
          updatedAt: Date.now(),
          items: normalized
        } satisfies StoredLibrary
      },
      () => resolve()
    );
  });
}

function getLibraryDedupeKey(item: Pick<LibraryItem, "kind" | "text" | "sourceUrl">): string {
  return `${item.kind}:${stableHash(item.text)}:${item.sourceUrl}`;
}

function createLibraryItem(material: PageMaterial | SelectionMaterial): LibraryItem {
  const now = Date.now();
  const text = material.text.slice(0, 200000);
  return {
    id: `library-${stableHash(`${material.kind}:${material.sourceUrl}:${text}`)}`,
    kind: material.kind,
    title: material.title || normalizePopupText(text).slice(0, 72) || material.kind,
    text,
    createdAt: now,
    updatedAt: now,
    sourceUrl: material.sourceUrl,
    sourceTitle: material.sourceTitle,
    pageKey: material.pageKey,
    language: material.language,
    filename: material.filename
  };
}

async function writePopupTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function safeFilenamePart(value: string): string {
  return (value || "chatgpt")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "") || "chatgpt";
}

function formatTimestampForFilename(value: number): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function isExportDocumentFormat(value: string | null): value is ExportDocumentFormat {
  return value === "md" || value === "html" || value === "docx";
}

function readPreferredExportDocumentFormat(): ExportDocumentFormat {
  try {
    const value = window.localStorage.getItem(EXPORT_DOCUMENT_FORMAT_STORAGE_KEY);
    return isExportDocumentFormat(value) ? value : "docx";
  } catch {
    return "docx";
  }
}

function writePreferredExportDocumentFormat(format: ExportDocumentFormat) {
  try {
    window.localStorage.setItem(EXPORT_DOCUMENT_FORMAT_STORAGE_KEY, format);
  } catch {
    // The export still works if the preference cannot be persisted.
  }
}

function downloadExportFile(filename: string, data: string | Uint8Array, mimeType: string) {
  const blobPart: BlobPart = typeof data === "string"
    ? data
    : (() => {
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      return copy.buffer as ArrayBuffer;
    })();
  const blob = new Blob([blobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getExportFilename(snapshot: ExportSnapshot, mode: ExportContentMode, format: ExportDocumentFormat): string {
  const source = safeFilenamePart(snapshot.title || snapshot.pageKey || "chatgpt");
  return `chatgpt-${source}-${mode}-${formatTimestampForFilename(snapshot.exportedAt)}.${format}`;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function getCodeFence(text: string): string {
  const longestFence = Math.max(3, ...Array.from(text.matchAll(/`+/g)).map((match) => match[0].length + 1));
  return "`".repeat(longestFence);
}

function formatCodeBlockMarkdown(text: string, language?: string): string {
  const fence = getCodeFence(text);
  return `${fence}${language || ""}\n${text.trimEnd()}\n${fence}`;
}

type ExportCodeBlockItem = ExportSnapshot["codeBlocks"][number];

interface OrganizedChatTurn {
  index: number;
  user: string;
  assistant: string;
}

function cleanExportText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function organizeChatTurns(snapshot: ExportSnapshot): OrganizedChatTurn[] {
  const turns: OrganizedChatTurn[] = [];
  let currentTurn: OrganizedChatTurn | null = null;

  for (const message of snapshot.messages) {
    const text = cleanExportText(message.text);
    if (!text) {
      continue;
    }

    if (message.role === "user") {
      currentTurn = {
        index: turns.length + 1,
        user: text,
        assistant: ""
      };
      turns.push(currentTurn);
      continue;
    }

    if (!currentTurn) {
      currentTurn = {
        index: turns.length + 1,
        user: "",
        assistant: text
      };
      turns.push(currentTurn);
      continue;
    }

    currentTurn.assistant = [currentTurn.assistant, text].filter(Boolean).join("\n\n");
  }

  return turns;
}

function getUniqueStandaloneCodeBlocks(snapshot: ExportSnapshot): ExportCodeBlockItem[] {
  const messageText = snapshot.messages.map((message) => cleanExportText(message.text)).join("\n\n");
  const seen = new Set<string>();
  const blocks: ExportCodeBlockItem[] = [];

  for (const block of snapshot.codeBlocks) {
    const text = cleanExportText(block.text);
    if (!text) {
      continue;
    }

    const key = `${block.language || ""}\n${block.filename || ""}\n${text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    if (text.length >= 12 && messageText.includes(text)) {
      continue;
    }

    blocks.push(block);
  }

  return blocks;
}

function formatChatOnlyMarkdown(snapshot: ExportSnapshot): string {
  const lines: string[] = [`# ${snapshot.title || "ChatGPT 聊天内容"}`, ""];
  const turns = organizeChatTurns(snapshot);

  if (turns.length === 0) {
    lines.push("_没有识别到可导出的聊天内容。_", "");
    return `${lines.join("\n").trim()}\n`;
  }

  for (const turn of turns) {
    lines.push(`## 第 ${turn.index} 轮`, "");
    if (turn.user) {
      lines.push("### 用户", "");
      lines.push(escapeMarkdownText(turn.user), "");
    }
    if (turn.assistant) {
      lines.push("### GPT", "");
      lines.push(escapeMarkdownText(turn.assistant), "");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatFullChatMarkdown(snapshot: ExportSnapshot): string {
  const uniqueCodeBlocks = getUniqueStandaloneCodeBlocks(snapshot);
  const lines: string[] = [
    `# ${snapshot.title || "ChatGPT conversation"}`,
    "",
    `- URL: ${snapshot.url}`,
    `- Exported: ${new Date(snapshot.exportedAt).toLocaleString()}`,
    "",
    "## Conversation",
    ""
  ];

  if (snapshot.messages.length === 0) {
    lines.push("_No visible messages were found._", "");
  }

  snapshot.messages.forEach((message, index) => {
    lines.push(`### ${index + 1}. ${message.role === "user" ? "User" : "Assistant"}`, "");
    lines.push(escapeMarkdownText(cleanExportText(message.text)), "");
  });

  if (uniqueCodeBlocks.length > 0) {
    lines.push("## Code Blocks", "");
    uniqueCodeBlocks.forEach((block, index) => {
      lines.push(`### ${index + 1}. ${block.filename || "Code block"}`, "");
      lines.push(formatCodeBlockMarkdown(block.text, block.language), "");
    });
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatOutlineMarkdown(snapshot: ExportSnapshot): string {
  const lines: string[] = [
    `# ${snapshot.title || "ChatGPT outline"}`,
    "",
    `- URL: ${snapshot.url}`,
    `- Exported: ${new Date(snapshot.exportedAt).toLocaleString()}`,
    `- Outline items: ${snapshot.nodes.length}`,
    "",
    "## Timeline",
    ""
  ];

  if (snapshot.nodes.length === 0) {
    lines.push("_No outline items were found._", "");
    return `${lines.join("\n").trim()}\n`;
  }

  let currentGroup = "";
  for (const node of snapshot.nodes) {
    if (node.groupLabel !== currentGroup) {
      currentGroup = node.groupLabel;
      lines.push(`## ${currentGroup}`, "");
    }

    lines.push(`### #${node.turnIndex} ${node.title}`);
    lines.push("");
    lines.push(`- Tokens: ${formatExportTokenCount(node.totalTokens)} total / ${formatExportTokenCount(node.promptTokens)} prompt / ${formatExportTokenCount(node.answerTokens)} answer`);
    lines.push("");
    lines.push(`**Prompt**: ${node.promptPreview}`);
    lines.push("");
    lines.push(`**Answer**: ${node.answerSummary || "-"}`);
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatHtmlTextBlock(value: string): string {
  const text = cleanExportText(value);
  if (!text) {
    return `<p class="empty">-</p>`;
  }

  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function formatHtmlShell(snapshot: ExportSnapshot, heading: string, body: string, options: { includeMeta?: boolean; chatOnly?: boolean } = {}): string {
  const exportedAt = new Date(snapshot.exportedAt).toLocaleString();
  const includeMeta = options.includeMeta !== false;
  const mainClass = options.chatOnly ? " class=\"chat-export\"" : "";
  const metaSection = includeMeta
    ? `    <section class="meta">
      <div><strong>URL:</strong> ${escapeHtml(snapshot.url)}</div>
      <div><strong>Exported:</strong> ${escapeHtml(exportedAt)}</div>
    </section>
`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(heading)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: linear-gradient(180deg, #f5f7fb 0%, #eef2f7 100%); color: #202123; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.62; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 24px 56px; background: #fff; min-height: 100vh; box-shadow: 0 18px 60px rgba(15, 23, 42, 0.08); }
    main.chat-export { max-width: 860px; }
    h1 { margin: 0 0 12px; font-size: 28px; line-height: 1.25; }
    h2 { margin: 32px 0 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 20px; }
    h3 { margin: 22px 0 8px; font-size: 16px; }
    p { margin: 8px 0; }
    .meta { margin: 0 0 24px; padding: 12px 14px; border: 1px solid #dbeafe; border-radius: 8px; background: #eff6ff; color: #1e3a8a; font-size: 13px; }
    .message, .node { margin: 14px 0; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
    .user { border-left: 4px solid #10a37f; }
    .assistant { border-left: 4px solid #2563eb; }
    .turn { margin: 24px 0 32px; }
    .turn-title { margin: 0 0 12px; color: #475569; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .qa-block { margin: 12px 0; padding: 16px 18px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06); }
    .qa-block.user { border-left: 5px solid #10a37f; background: linear-gradient(180deg, #f0fdf9 0%, #ffffff 100%); }
    .qa-block.assistant { border-left: 5px solid #2563eb; background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%); }
    .qa-role { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 8px; color: #0f172a; font-size: 14px; font-weight: 700; }
    .qa-block.user .qa-role { color: #047857; }
    .qa-block.assistant .qa-role { color: #1d4ed8; }
    pre { overflow-x: auto; white-space: pre-wrap; word-break: break-word; margin: 10px 0 18px; padding: 12px; border-radius: 8px; background: #f3f4f6; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.5; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .empty { color: #64748b; }
  </style>
</head>
<body>
  <main${mainClass}>
    <h1>${escapeHtml(heading)}</h1>
${metaSection}
${body}
  </main>
</body>
</html>
`;
}

function formatChatOnlyHtml(snapshot: ExportSnapshot): string {
  const turns = organizeChatTurns(snapshot);
  const body: string[] = [];

  if (turns.length === 0) {
    body.push(`    <p class="empty">没有识别到可导出的聊天内容。</p>`);
  }

  for (const turn of turns) {
    body.push(`    <section class="turn">`);
    body.push(`      <div class="turn-title">第 ${turn.index} 轮</div>`);
    if (turn.user) {
      body.push(`      <article class="qa-block user">`);
      body.push(`        <div class="qa-role">用户</div>`);
      body.push(formatHtmlTextBlock(turn.user).replace(/^/gm, "        "));
      body.push(`      </article>`);
    }
    if (turn.assistant) {
      body.push(`      <article class="qa-block assistant">`);
      body.push(`        <div class="qa-role">GPT</div>`);
      body.push(formatHtmlTextBlock(turn.assistant).replace(/^/gm, "        "));
      body.push(`      </article>`);
    }
    body.push(`    </section>`);
  }

  return formatHtmlShell(snapshot, snapshot.title || "ChatGPT 聊天内容", body.join("\n"), {
    includeMeta: false,
    chatOnly: true
  });
}

function formatFullChatHtml(snapshot: ExportSnapshot): string {
  const uniqueCodeBlocks = getUniqueStandaloneCodeBlocks(snapshot);
  const body: string[] = [`    <h2>Conversation</h2>`];

  if (snapshot.messages.length === 0) {
    body.push(`    <p class="empty">No visible messages were found.</p>`);
  }

  snapshot.messages.forEach((message, index) => {
    const role = message.role === "user" ? "User" : "Assistant";
    body.push(`    <article class="message ${message.role}">`);
    body.push(`      <h3>${index + 1}. ${role}</h3>`);
    body.push(formatHtmlTextBlock(cleanExportText(message.text)).replace(/^/gm, "      "));
    body.push(`    </article>`);
  });

  if (uniqueCodeBlocks.length > 0) {
    body.push(`    <h2>Code Blocks</h2>`);
    uniqueCodeBlocks.forEach((block, index) => {
      body.push(`    <h3>${index + 1}. ${escapeHtml(block.filename || "Code block")}</h3>`);
      body.push(`    <pre><code>${escapeHtml(block.text.trimEnd())}</code></pre>`);
    });
  }

  return formatHtmlShell(snapshot, snapshot.title || "ChatGPT conversation", body.join("\n"));
}

function formatOutlineHtml(snapshot: ExportSnapshot): string {
  const body: string[] = [
    `    <h2>Timeline</h2>`,
    `    <p><strong>Outline items:</strong> ${snapshot.nodes.length}</p>`
  ];

  if (snapshot.nodes.length === 0) {
    body.push(`    <p class="empty">No outline items were found.</p>`);
    return formatHtmlShell(snapshot, snapshot.title || "ChatGPT outline", body.join("\n"));
  }

  let currentGroup = "";
  for (const node of snapshot.nodes) {
    if (node.groupLabel !== currentGroup) {
      currentGroup = node.groupLabel;
      body.push(`    <h2>${escapeHtml(currentGroup)}</h2>`);
    }

    body.push(`    <article class="node">`);
    body.push(`      <h3>#${node.turnIndex} ${escapeHtml(node.title)}</h3>`);
    body.push(`      <p><strong>Tokens:</strong> ${formatExportTokenCount(node.totalTokens)} total / ${formatExportTokenCount(node.promptTokens)} prompt / ${formatExportTokenCount(node.answerTokens)} answer</p>`);
    body.push(`      <p><strong>Prompt:</strong> ${escapeHtml(node.promptPreview)}</p>`);
    body.push(`      <p><strong>Answer:</strong> ${escapeHtml(node.answerSummary || "-")}</p>`);
    body.push(`    </article>`);
  }

  return formatHtmlShell(snapshot, snapshot.title || "ChatGPT outline", body.join("\n"));
}

function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type DocxParagraphStyle =
  | "Normal"
  | "Title"
  | "Heading1"
  | "Heading2"
  | "Meta"
  | "CodeBlock"
  | "UserLabel"
  | "AssistantLabel";

function docxParagraph(text: string, style: DocxParagraphStyle = "Normal"): string {
  const styleXml = style === "Normal" ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  const content = text
    ? `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
    : `<w:r><w:t></w:t></w:r>`;
  return `<w:p>${styleXml}${content}</w:p>`;
}

function docxParagraphsFromText(text: string, style: DocxParagraphStyle = "Normal"): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.length > 0 ? lines.map((line) => docxParagraph(line, style)) : [docxParagraph("", style)];
}

function createDocxDocument(paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function createDocxStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="40"/></w:rPr>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="30"/></w:rPr>
    <w:pPr><w:spacing w:before="360" w:after="160"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Meta">
    <w:name w:val="Meta"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:color w:val="475569"/><w:sz w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="UserLabel">
    <w:name w:val="UserLabel"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="180" w:after="80"/><w:shd w:val="clear" w:color="auto" w:fill="ECFDF5"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="047857"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="AssistantLabel">
    <w:name w:val="AssistantLabel"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="180" w:after="80"/><w:shd w:val="clear" w:color="auto" w:fill="EFF6FF"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="CodeBlock"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Consolas"/><w:sz w:val="20"/></w:rPr>
  </w:style>
</w:styles>`;
}

function formatChatOnlyDocxDocument(snapshot: ExportSnapshot): string {
  const turns = organizeChatTurns(snapshot);
  const paragraphs: string[] = [
    docxParagraph(snapshot.title || "ChatGPT 聊天内容", "Title")
  ];

  if (turns.length === 0) {
    paragraphs.push(docxParagraph("没有识别到可导出的聊天内容。"));
    return createDocxDocument(paragraphs);
  }

  for (const turn of turns) {
    paragraphs.push(docxParagraph(`第 ${turn.index} 轮`, "Heading2"));
    if (turn.user) {
      paragraphs.push(docxParagraph("用户", "UserLabel"));
      paragraphs.push(...docxParagraphsFromText(turn.user));
    }
    if (turn.assistant) {
      paragraphs.push(docxParagraph("GPT", "AssistantLabel"));
      paragraphs.push(...docxParagraphsFromText(turn.assistant));
    }
  }

  return createDocxDocument(paragraphs);
}

function formatFullChatDocxDocument(snapshot: ExportSnapshot): string {
  const uniqueCodeBlocks = getUniqueStandaloneCodeBlocks(snapshot);
  const paragraphs: string[] = [
    docxParagraph(snapshot.title || "ChatGPT conversation", "Title"),
    docxParagraph(`URL: ${snapshot.url}`, "Meta"),
    docxParagraph(`Exported: ${new Date(snapshot.exportedAt).toLocaleString()}`, "Meta"),
    docxParagraph("", "Normal"),
    docxParagraph("Conversation", "Heading1")
  ];

  if (snapshot.messages.length === 0) {
    paragraphs.push(docxParagraph("No visible messages were found."));
  }

  snapshot.messages.forEach((message, index) => {
    paragraphs.push(docxParagraph(`${index + 1}. ${message.role === "user" ? "User" : "Assistant"}`, "Heading2"));
    paragraphs.push(...docxParagraphsFromText(cleanExportText(message.text)));
  });

  if (uniqueCodeBlocks.length > 0) {
    paragraphs.push(docxParagraph("Code Blocks", "Heading1"));
    uniqueCodeBlocks.forEach((block, index) => {
      paragraphs.push(docxParagraph(`${index + 1}. ${block.filename || "Code block"}`, "Heading2"));
      paragraphs.push(...docxParagraphsFromText(block.text.trimEnd(), "CodeBlock"));
    });
  }

  return createDocxDocument(paragraphs);
}

function formatOutlineDocxDocument(snapshot: ExportSnapshot): string {
  const paragraphs: string[] = [
    docxParagraph(snapshot.title || "ChatGPT outline", "Title"),
    docxParagraph(`URL: ${snapshot.url}`, "Meta"),
    docxParagraph(`Exported: ${new Date(snapshot.exportedAt).toLocaleString()}`, "Meta"),
    docxParagraph(`Outline items: ${snapshot.nodes.length}`, "Meta"),
    docxParagraph("Timeline", "Heading1")
  ];

  if (snapshot.nodes.length === 0) {
    paragraphs.push(docxParagraph("No outline items were found."));
    return createDocxDocument(paragraphs);
  }

  let currentGroup = "";
  for (const node of snapshot.nodes) {
    if (node.groupLabel !== currentGroup) {
      currentGroup = node.groupLabel;
      paragraphs.push(docxParagraph(currentGroup, "Heading1"));
    }

    paragraphs.push(docxParagraph(`#${node.turnIndex} ${node.title}`, "Heading2"));
    paragraphs.push(docxParagraph(`Tokens: ${formatExportTokenCount(node.totalTokens)} total / ${formatExportTokenCount(node.promptTokens)} prompt / ${formatExportTokenCount(node.answerTokens)} answer`, "Meta"));
    paragraphs.push(docxParagraph(`Prompt: ${node.promptPreview}`));
    paragraphs.push(docxParagraph(`Answer: ${node.answerSummary || "-"}`));
  }

  return createDocxDocument(paragraphs);
}

let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (crc32Table) {
    return crc32Table;
  }

  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  crc32Table = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function getZipDosDateTime(date = new Date()): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function createZipArchive(entries: Array<{ name: string; data: string | Uint8Array }>): Uint8Array {
  const fileParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const centralEntries: Array<{
    nameBytes: Uint8Array;
    crc: number;
    size: number;
    localOffset: number;
    dosDate: number;
    dosTime: number;
  }> = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name);
    const data = typeof entry.data === "string" ? encodeUtf8(entry.data) : entry.data;
    const checksum = crc32(data);
    const { dosDate, dosTime } = getZipDosDateTime();
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    centralEntries.push({
      nameBytes,
      crc: checksum,
      size: data.length,
      localOffset: offset,
      dosDate,
      dosTime
    });
    fileParts.push(localHeader, data);
    offset += localHeader.length + data.length;
  }

  const centralDirectoryOffset = offset;
  for (const entry of centralEntries) {
    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(centralHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, entry.dosTime, true);
    view.setUint16(14, entry.dosDate, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.localOffset, true);
    centralHeader.set(entry.nameBytes, 46);
    centralParts.push(centralHeader);
    offset += centralHeader.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, centralEntries.length, true);
  endView.setUint16(10, centralEntries.length, true);
  endView.setUint32(12, centralDirectorySize, true);
  endView.setUint32(16, centralDirectoryOffset, true);
  endView.setUint16(20, 0, true);

  return concatBytes([...fileParts, ...centralParts, endRecord]);
}

function createDocxPackage(documentXml: string): Uint8Array {
  return createZipArchive([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    },
    {
      name: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: createDocxStyles() }
  ]);
}

function buildExportDocument(snapshot: ExportSnapshot, mode: ExportContentMode, format: ExportDocumentFormat) {
  const filename = getExportFilename(snapshot, mode, format);
  if (format === "html") {
    return {
      filename,
      mimeType: "text/html;charset=utf-8",
      data: mode === "chat"
        ? formatChatOnlyHtml(snapshot)
        : mode === "full"
          ? formatFullChatHtml(snapshot)
          : formatOutlineHtml(snapshot)
    };
  }

  if (format === "docx") {
    const documentXml = mode === "chat"
      ? formatChatOnlyDocxDocument(snapshot)
      : mode === "full"
        ? formatFullChatDocxDocument(snapshot)
        : formatOutlineDocxDocument(snapshot);
    return {
      filename,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: createDocxPackage(documentXml)
    };
  }

  return {
    filename,
    mimeType: "text/markdown;charset=utf-8",
    data: mode === "chat"
      ? formatChatOnlyMarkdown(snapshot)
      : mode === "full"
        ? formatFullChatMarkdown(snapshot)
        : formatOutlineMarkdown(snapshot)
  };
}

function isExportContentMode(value: string): value is ExportContentMode {
  return value === "chat" || value === "full" || value === "outline";
}

function getExportContentModeLabel(mode: ExportContentMode, labels: ReturnType<typeof getPopupExtraLabels>): string {
  if (mode === "full") {
    return labels.exportDetailed;
  }

  if (mode === "outline") {
    return labels.exportOutlineMode;
  }

  return labels.exportChatOnly;
}

function getExportFormatLabel(format: ExportDocumentFormat, labels: ReturnType<typeof getPopupExtraLabels>): string {
  if (format === "html") {
    return labels.exportFormatHtml;
  }

  if (format === "docx") {
    return labels.exportFormatDocx;
  }

  return labels.exportFormatMarkdown;
}

function getLibraryKindLabel(kind: LibraryItem["kind"], labels: ReturnType<typeof getPopupExtraLabels>): string {
  if (kind === "prompt") {
    return labels.promptKind;
  }

  if (kind === "code") {
    return labels.codeKind;
  }

  return labels.selectionKind;
}

function normalizeDisplayNumber(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  const clamped = Math.min(max, Math.max(min, value));
  if (step >= 1) {
    return Math.round(clamped);
  }

  const precision = Math.max(0, String(step).split(".")[1]?.length ?? 0);
  const factor = 10 ** precision;
  return Math.round(clamped * factor) / factor;
}

function queryActiveTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (!chrome.tabs?.query) {
      resolve(undefined);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0]?.id);
    });
  });
}

async function sendActiveTabMessage<T>(message: Record<string, unknown>): Promise<T | undefined> {
  const tabId = await queryActiveTabId();
  if (typeof tabId !== "number") {
    return undefined;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response?: T) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }

      resolve(response);
    });
  });
}

function readSettings(): Promise<NavigatorSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_SETTINGS_KEY, (result) => {
      resolve(normalizeSettings(result[STORAGE_SETTINGS_KEY]));
    });
  });
}

function writeSettings(settings: NavigatorSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: normalizeSettings(settings) }, () => resolve());
  });
}

function readStoredCompatRules(): Promise<StoredPopupCompatRules> {
  return new Promise((resolve) => {
    chrome.storage.local.get(COMPAT_RULES_STORAGE_KEY, (result) => {
      resolve((result[COMPAT_RULES_STORAGE_KEY] as StoredPopupCompatRules | undefined) ?? {});
    });
  });
}

function writeStoredCompatRules(rules: unknown[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [COMPAT_RULES_STORAGE_KEY]: {
          updatedAt: Date.now(),
          lastAttemptAt: Date.now(),
          rules
        }
      },
      () => resolve()
    );
  });
}

function removeStoredCompatRules(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(COMPAT_RULES_STORAGE_KEY, () => resolve());
  });
}

function CollapsibleSection({
  title,
  icon,
  badge,
  ariaLabel,
  children
}: {
  title: string;
  icon: React.ReactNode;
  badge?: string | null;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className={`popup-settings${open ? " is-open" : ""}`} aria-label={ariaLabel}>
      <button
        className="popup-section-toggle"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {icon}
        <span>{title}</span>
        {badge ? <small>{badge}</small> : null}
        <ChevronDown className="popup-section-chevron" size={15} aria-hidden="true" />
      </button>
      {open ? <div className="popup-section-body">{children}</div> : null}
    </section>
  );
}

export function Popup() {
  const [settings, setSettings] = useState<NavigatorSettings>(DEFAULT_SETTINGS);
  const t = getTranslation(settings.language);
  const extra = getPopupExtraLabels(settings.language);
  const [isSaving, setIsSaving] = useState(false);
  const [compatStatus, setCompatStatus] = useState<CompatStatus>("idle");
  const [compatRuleCount, setCompatRuleCount] = useState(0);
  const [compatMeta, setCompatMeta] = useState<StoredPopupCompatRules>({});
  const [pageHealth, setPageHealth] = useState<PageAdapterHealth | null>(null);
  const [modelCatalog, setModelCatalog] = useState<PopupModelBudgetEntry[]>(POPUP_BUILT_IN_MODEL_BUDGETS);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [materials, setMaterials] = useState<PageMaterial[]>([]);
  const [pageBridgeStatus, setPageBridgeStatus] = useState<PageBridgeStatus>("idle");
  const [libraryNotice, setLibraryNotice] = useState("");
  const [exportContentMode, setExportContentMode] = useState<ExportContentMode>("chat");
  const [exportFormat, setExportFormat] = useState<ExportDocumentFormat>(() => readPreferredExportDocumentFormat());
  const [displayNumberDrafts, setDisplayNumberDrafts] = useState<Partial<Record<DisplayNumberSetting, string>>>({});
  const [displayRangeDrafts, setDisplayRangeDrafts] = useState<Partial<Record<DisplayNumberSetting, number>>>({});

  const showLibraryNotice = (message: string) => {
    setLibraryNotice(message);
    window.setTimeout(() => {
      setLibraryNotice((current) => (current === message ? "" : current));
    }, 1600);
  };

  const refreshMaterials = async () => {
    setPageBridgeStatus("loading");
    const response = await sendActiveTabMessage<MaterialsResponse>({
      type: MATERIALS_LIST_MESSAGE
    });

    if (response?.ok && Array.isArray(response.materials)) {
      setMaterials(response.materials);
      setPageBridgeStatus("ready");
      return response.materials;
    }

    setMaterials([]);
    setPageBridgeStatus("failed");
    return [];
  };

  const refreshPageHealth = async () => {
    const response = await sendActiveTabMessage<PageStatusResponse>({
      type: PAGE_STATUS_MESSAGE
    });
    setPageHealth(response?.ok ? response.health ?? null : null);
  };

  const saveMaterialToLibrary = async (material: PageMaterial | SelectionMaterial) => {
    const item = createLibraryItem(material);
    const dedupeKey = getLibraryDedupeKey(item);
    if (libraryItems.some((existing) => getLibraryDedupeKey(existing) === dedupeKey)) {
      showLibraryNotice(extra.duplicateSaved);
      return;
    }

    const nextItems = [item, ...libraryItems].slice(0, 300);
    setLibraryItems(nextItems);
    await writeLibrary(nextItems);
    showLibraryNotice(extra.saved);
  };

  const saveSelectedText = async () => {
    const response = await sendActiveTabMessage<SelectionResponse>({
      type: SELECTION_GET_MESSAGE
    });

    if (response?.ok && response.material) {
      await saveMaterialToLibrary(response.material);
      return;
    }

    showLibraryNotice(extra.noActiveChat);
  };

  const copyLibraryItem = async (item: LibraryItem) => {
    const text = item.kind === "code"
      ? formatCodeBlockMarkdown(item.text, item.language)
      : item.text;
    await writePopupTextToClipboard(text);
    showLibraryNotice(extra.copied);
  };

  const deleteLibraryItem = async (id: string) => {
    const nextItems = libraryItems.filter((item) => item.id !== id);
    setLibraryItems(nextItems);
    await writeLibrary(nextItems);
  };

  const clearLibrary = async () => {
    setLibraryItems([]);
    await writeLibrary([]);
  };

  const updateExportFormat = (format: ExportDocumentFormat) => {
    setExportFormat(format);
    writePreferredExportDocumentFormat(format);
  };

  const exportDocument = async () => {
    const response = await sendActiveTabMessage<ExportSnapshotResponse>({
      type: EXPORT_SNAPSHOT_MESSAGE
    });

    if (!response?.ok || !response.snapshot) {
      showLibraryNotice(extra.noActiveChat);
      return;
    }

    const file = buildExportDocument(response.snapshot, exportContentMode, exportFormat);
    downloadExportFile(file.filename, file.data, file.mimeType);
  };

  useEffect(() => {
    async function load() {
      const nextSettings = await readSettings();
      setSettings(nextSettings);
      const [storedCompat, storedModels, storedLibrary] = await Promise.all([
        readStoredCompatRules(),
        readStoredModelCatalog(),
        readLibrary()
      ]);
      setCompatMeta(storedCompat);
      setCompatRuleCount(Array.isArray(storedCompat.rules) ? storedCompat.rules.length : 0);
      setModelCatalog(storedModels);
      setLibraryItems(storedLibrary);
    }

    load();
  }, []);

  useEffect(() => {
    void refreshMaterials();
    void refreshPageHealth();
  }, []);

  const selectedTokenModelId = useMemo(
    () => modelCatalog.some((model) => model.id === settings.tokenModelId)
      ? settings.tokenModelId
      : DEFAULT_TOKEN_MODEL_ID,
    [modelCatalog, settings.tokenModelId]
  );
  const activeCompatSource =
    pageHealth?.source ??
    (settings.compatRulesRemoteEnabled ? settings.compatRulesSource : "built-in");
  const filteredLibraryItems = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) {
      return libraryItems;
    }

    return libraryItems.filter((item) =>
      [
        item.title,
        item.text,
        item.filename || "",
        item.language || "",
        item.sourceTitle
      ].join(" ").toLowerCase().includes(query)
    );
  }, [libraryItems, libraryQuery]);

  const updateSettings = async (patch: Partial<NavigatorSettings>) => {
    setIsSaving(true);
    const nextSettings = normalizeSettings({ ...settings, ...patch });
    setSettings(nextSettings);
    await writeSettings(nextSettings);
    setIsSaving(false);
  };

  const makeDisplayNumberPatch = (setting: DisplayNumberSetting, value: number): Partial<NavigatorSettings> => {
    const patch = { [setting]: value } as Partial<NavigatorSettings>;
    if (setting === "chatContentWidth" || setting === "canvasContentWidth") {
      patch.chatLayoutVersion = 2;
    }

    return patch;
  };

  const updateBudgetPreset = (value: string) => {
    if (value === "model") {
      updateSettings({ tokenBudgetMode: "model" });
      return;
    }

    if (value === "custom") {
      updateSettings({
        tokenBudgetMode: "manual",
        manualTokenBudget: TOKEN_BUDGET_PRESETS.includes(settings.manualTokenBudget)
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

  const syncCompatRules = async () => {
    setCompatStatus("syncing");
    try {
      const response = await fetch(CHATGPT_COMPAT_RULES_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rules = normalizeCompatRulesPayload(await response.json());
      await writeStoredCompatRules(rules);
      const nextCompatMeta = {
        updatedAt: Date.now(),
        lastAttemptAt: Date.now(),
        rules
      };
      setCompatMeta(nextCompatMeta);
      setCompatRuleCount(rules.length);
      await updateSettings({
        compatRulesAutoSyncEnabled: true,
        compatRulesRemoteEnabled: true,
        compatRulesLastSyncAt: Date.now(),
        compatRulesSource: "remote"
      });
      setCompatStatus("synced");
      window.setTimeout(() => void refreshPageHealth(), 250);
    } catch {
      setCompatMeta((current) => ({
        ...current,
        lastAttemptAt: Date.now(),
        lastError: "sync-failed"
      }));
      setCompatStatus("failed");
    }
  };

  const resetCompatRules = async () => {
    await removeStoredCompatRules();
    setCompatRuleCount(0);
    setCompatMeta({});
    setCompatStatus("idle");
    await updateSettings({
      compatRulesAutoSyncEnabled: false,
      compatRulesRemoteEnabled: false,
      compatRulesLastSyncAt: 0,
      compatRulesSource: "built-in"
    });
    window.setTimeout(() => void refreshPageHealth(), 250);
  };

  const renderDisplayRange = ({
    label,
    setting,
    min,
    max,
    step,
    unit,
    resetValue
  }: {
    label: string;
    setting: DisplayNumberSetting;
    min: number;
    max: number;
    step: number;
    unit: string;
    resetValue: number;
  }) => {
    const savedValue = Number(settings[setting]);
    const value = displayRangeDrafts[setting] ?? savedValue;
    const displayValue = step < 1 ? value.toFixed(1) : String(Math.round(value));
    const inputValue = displayNumberDrafts[setting] ?? displayValue;
    const normalizeValue = (rawValue: number) =>
      normalizeDisplayNumber(rawValue, min, max, step);
    const previewValue = (rawValue: number) => {
      const nextValue = normalizeValue(rawValue);
      setDisplayRangeDrafts((current) => ({ ...current, [setting]: nextValue }));
      return nextValue;
    };
    const clearRangeDraft = () => {
      setDisplayRangeDrafts((current) => {
        if (current[setting] === undefined) {
          return current;
        }
        const { [setting]: _removed, ...rest } = current;
        return rest;
      });
    };
    const commitValue = (rawValue: number) => {
      const nextValue = normalizeDisplayNumber(rawValue, min, max, step);
      clearRangeDraft();
      if (nextValue !== savedValue) {
        void updateSettings(makeDisplayNumberPatch(setting, nextValue));
      }
    };
    const clearDraft = () => {
      setDisplayNumberDrafts((current) => {
        if (current[setting] === undefined) {
          return current;
        }

        const { [setting]: _removed, ...rest } = current;
        return rest;
      });
    };
    const commitInputValue = (rawValue: string) => {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) {
        commitValue(parsed);
      }
      clearDraft();
    };

    return (
      <label className="popup-range-field" key={setting}>
        <span>{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            clearDraft();
            previewValue(Number(event.currentTarget.value));
          }}
          onPointerUp={(event) => commitValue(Number(event.currentTarget.value))}
          onPointerCancel={() => {
            clearDraft();
            clearRangeDraft();
          }}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
              commitValue(Number(event.currentTarget.value));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              clearDraft();
              clearRangeDraft();
            }
          }}
        />
        <span className="popup-number-control">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            inputMode="decimal"
            value={inputValue}
            aria-label={`${label} ${extra.preciseValue}`}
            onChange={(event) => {
              const nextText = event.currentTarget.value;
              setDisplayNumberDrafts((current) => ({ ...current, [setting]: nextText }));
              const parsed = Number(nextText);
              if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
                return;
              }
              previewValue(parsed);
            }}
            onBlur={(event) => commitInputValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                clearDraft();
                clearRangeDraft();
              }
            }}
          />
          <small>{unit}</small>
        </span>
        <button
          type="button"
          className="popup-reset"
          onClick={() => {
            clearDraft();
            clearRangeDraft();
            void updateSettings(makeDisplayNumberPatch(setting, resetValue));
          }}
        >
          {t.resetDisplay}
        </button>
      </label>
    );
  };

  const previewSettings = normalizeSettings({ ...settings, ...displayRangeDrafts });
  const renderTypographyPreview = (kind: "chat" | "canvas") => {
    const isCanvas = kind === "canvas";
    const fontScale = isCanvas ? previewSettings.canvasFontScale : previewSettings.chatFontScale;
    const letterSpacing = isCanvas ? previewSettings.canvasLetterSpacing : previewSettings.chatLetterSpacing;
    const lineHeight = isCanvas ? previewSettings.canvasLineHeight : previewSettings.chatLineHeight;
    const contentWidth = isCanvas ? previewSettings.canvasContentWidth : previewSettings.chatContentWidth;
    const widthPercent = Math.min(96, 58 + (contentWidth - THREAD_WIDTH_MIN) * 0.95);

    return (
      <div className="popup-display-preview" aria-hidden="true">
        <div style={{ width: `${widthPercent}%` }}>
          <strong>{isCanvas ? t.canvasDisplay : extra.readingDisplay}</strong>
          <p
            style={{
              fontSize: `${(12 * fontScale / 100).toFixed(1)}px`,
              letterSpacing: `${letterSpacing}px`,
              lineHeight: lineHeight / 100
            }}
          >
            {settings.language === "en"
              ? "Preview changes here; the page updates once when adjustment ends."
              : "在这里预览效果，结束调节后页面才会一次应用。"}
          </p>
        </div>
      </div>
    );
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="popup-mark">
          <Database size={20} aria-hidden="true" />
        </div>
        <div>
          <h1>{t.appName}</h1>
          <p>{t.popupSubtitle}</p>
        </div>
      </header>

      <section className="popup-privacy">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>{t.privacy}</p>
      </section>

      <CollapsibleSection
        title={extra.library}
        icon={<ClipboardList size={17} aria-hidden="true" />}
        badge={`${libraryItems.length} ${extra.libraryCount}`}
        ariaLabel="Local library"
      >
        <label className="popup-field">
          <span>
            <Search size={13} aria-hidden="true" />
            {extra.searchLibrary}
          </span>
          <input
            value={libraryQuery}
            onChange={(event) => setLibraryQuery(event.currentTarget.value)}
            spellCheck={false}
          />
        </label>
        {libraryNotice ? <p className="popup-inline-status">{libraryNotice}</p> : null}
        <div className="popup-library-list">
          {filteredLibraryItems.length === 0 ? (
            <p className="popup-empty">{extra.noLibraryItems}</p>
          ) : (
            filteredLibraryItems.map((item) => (
              <article className="popup-library-item" key={item.id}>
                <div className="popup-library-main">
                  <span>{getLibraryKindLabel(item.kind, extra)}</span>
                  <strong>{item.title}</strong>
                  <small>
                    {`${item.filename || item.sourceTitle || item.sourceUrl || "-"} · ${new Date(item.updatedAt).toLocaleDateString()}`}
                  </small>
                  <p>{normalizePopupText(item.text).slice(0, 160)}</p>
                </div>
                <div className="popup-library-actions">
                  <button
                    className="popup-record-delete is-copy"
                    type="button"
                    onClick={() => void copyLibraryItem(item)}
                    title={extra.copy}
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                  <button
                    className="popup-record-delete"
                    type="button"
                    onClick={() => void deleteLibraryItem(item.id)}
                    title={extra.delete}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
        <button
          className="popup-clear"
          type="button"
          onClick={() => void clearLibrary()}
          disabled={libraryItems.length === 0}
        >
          <Trash2 size={16} aria-hidden="true" />
          {extra.clearLibrary}
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        title={extra.currentMaterials}
        icon={<FileText size={17} aria-hidden="true" />}
        badge={`${materials.length} ${extra.libraryCount}`}
        ariaLabel="Current page materials"
      >
        <div className="popup-action-row">
          <button
            className="popup-secondary"
            type="button"
            onClick={() => void refreshMaterials()}
            disabled={pageBridgeStatus === "loading"}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {extra.refreshMaterials}
          </button>
          <button className="popup-secondary" type="button" onClick={() => void saveSelectedText()}>
            <Plus size={15} aria-hidden="true" />
            {extra.collectSelection}
          </button>
        </div>
        {pageBridgeStatus === "failed" ? <p className="popup-empty">{extra.noActiveChat}</p> : null}
        <div className="popup-library-list">
          {materials.length === 0 ? (
            <p className="popup-empty">{extra.noMaterials}</p>
          ) : (
            materials.map((material) => (
              <article className="popup-library-item" key={material.id}>
                <div className="popup-library-main">
                  <span>{material.kind === "prompt" ? extra.promptKind : extra.codeKind}</span>
                  <strong>{material.title}</strong>
                  <small>{material.filename || material.sourceTitle || material.sourceUrl}</small>
                  <p>{normalizePopupText(material.text).slice(0, 160)}</p>
                </div>
                <button
                  className="popup-record-delete is-save"
                  type="button"
                  onClick={() => void saveMaterialToLibrary(material)}
                  title={extra.addToLibrary}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </article>
            ))
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={extra.markdownExport}
        icon={<Download size={17} aria-hidden="true" />}
        badge={`${getExportContentModeLabel(exportContentMode, extra)} · ${getExportFormatLabel(exportFormat, extra)}`}
        ariaLabel="Document export"
      >
        <label className="popup-field">
          <span>
            <ClipboardList size={13} aria-hidden="true" />
            {extra.exportContent}
          </span>
          <select
            value={exportContentMode}
            onChange={(event) => {
              const nextMode = event.currentTarget.value;
              if (isExportContentMode(nextMode)) {
                setExportContentMode(nextMode);
              }
            }}
          >
            {EXPORT_CONTENT_MODES.map((mode) => (
              <option value={mode} key={mode}>
                {getExportContentModeLabel(mode, extra)}
              </option>
            ))}
          </select>
        </label>
        <label className="popup-field">
          <span>
            <FileText size={13} aria-hidden="true" />
            {extra.exportFormat}
          </span>
          <select
            value={exportFormat}
            onChange={(event) => {
              const nextFormat = event.currentTarget.value;
              if (isExportDocumentFormat(nextFormat)) {
                updateExportFormat(nextFormat);
              }
            }}
          >
            {EXPORT_DOCUMENT_FORMATS.map((format) => (
              <option value={format} key={format}>
                {getExportFormatLabel(format, extra)}
              </option>
            ))}
          </select>
        </label>
        <div className="popup-action-row">
          <button className="popup-secondary" type="button" onClick={() => void exportDocument()}>
            <Download size={15} aria-hidden="true" />
            {extra.exportDocument}
          </button>
        </div>
        <p>{pageBridgeStatus === "failed" ? extra.noActiveChat : extra.exportNote}</p>
      </CollapsibleSection>

      <CollapsibleSection
        title={extra.readingDisplay}
        icon={<SlidersHorizontal size={17} aria-hidden="true" />}
        badge={isSaving ? t.saving : null}
        ariaLabel="Display settings"
      >
        {renderTypographyPreview("chat")}
        <div className="popup-range-group">
          {renderDisplayRange({
            label: t.fontSize,
            setting: "chatFontScale",
            min: 85,
            max: 220,
            step: 1,
            unit: "%",
            resetValue: 100
          })}
          {renderDisplayRange({
            label: t.letterSpacing,
            setting: "chatLetterSpacing",
            min: 0,
            max: 8,
            step: 0.1,
            unit: "px",
            resetValue: 0
          })}
          {renderDisplayRange({
            label: t.lineSpacing,
            setting: "chatLineHeight",
            min: 125,
            max: 220,
            step: 1,
            unit: "%",
            resetValue: 155
          })}
          {renderDisplayRange({
            label: t.contentWidth,
            setting: "chatContentWidth",
            min: THREAD_WIDTH_MIN,
            max: THREAD_WIDTH_MAX,
            step: 1,
            unit: "%",
            resetValue: OFFICIAL_THREAD_WIDTH
          })}
          <label className="popup-toggle">
            <span>{extra.widthHandle}</span>
            <input
              type="checkbox"
              checked={settings.threadResizeEnabled}
              onChange={(event) => updateSettings({ threadResizeEnabled: event.currentTarget.checked })}
            />
          </label>
        </div>
        <button
          className="popup-secondary"
          type="button"
          onClick={() =>
            updateSettings({
              chatLayoutVersion: 2,
              chatContentWidth: OFFICIAL_THREAD_WIDTH
            })
          }
        >
          <MoveHorizontal size={15} aria-hidden="true" />
          {t.officialWidthReset}
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        title={t.canvasDisplay}
        icon={<Type size={17} aria-hidden="true" />}
        ariaLabel="Canvas display settings"
      >
        {renderTypographyPreview("canvas")}
        <div className="popup-range-group">
          <label className="popup-toggle">
            <span>{extra.canvasWidthControl}</span>
            <input
              type="checkbox"
              checked={settings.canvasWidthEnabled}
              onChange={(event) => updateSettings({ canvasWidthEnabled: event.currentTarget.checked })}
            />
          </label>
          {renderDisplayRange({
            label: t.contentWidth,
            setting: "canvasContentWidth",
            min: THREAD_WIDTH_MIN,
            max: THREAD_WIDTH_MAX,
            step: 1,
            unit: "%",
            resetValue: OFFICIAL_THREAD_WIDTH
          })}
          {renderDisplayRange({
            label: t.fontSize,
            setting: "canvasFontScale",
            min: 75,
            max: 220,
            step: 1,
            unit: "%",
            resetValue: 100
          })}
          {renderDisplayRange({
            label: t.letterSpacing,
            setting: "canvasLetterSpacing",
            min: 0,
            max: 8,
            step: 0.1,
            unit: "px",
            resetValue: 0
          })}
          {renderDisplayRange({
            label: t.lineSpacing,
            setting: "canvasLineHeight",
            min: 120,
            max: 230,
            step: 1,
            unit: "%",
            resetValue: 155
          })}
        </div>
        {settings.canvasWidthEnabled || settings.canvasContentWidth !== OFFICIAL_THREAD_WIDTH ? (
          <button
            className="popup-secondary"
            type="button"
            onClick={() =>
              updateSettings({
                canvasWidthEnabled: false,
                chatLayoutVersion: 2,
                canvasContentWidth: OFFICIAL_THREAD_WIDTH
              })
            }
          >
            <MoveHorizontal size={15} aria-hidden="true" />
            {extra.canvasOfficialWidth}
          </button>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection
        title={extra.behavior}
        icon={<CheckCircle2 size={17} aria-hidden="true" />}
        badge={isSaving ? t.saving : null}
        ariaLabel="Behavior settings"
      >
        <label className="popup-field">
          <span>
            <Languages size={13} aria-hidden="true" />
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
        <label className="popup-toggle">
          <span>{t.navigateAnimation}</span>
          <input
            type="checkbox"
            checked={settings.navigateAnimationEnabled}
            onChange={(event) => updateSettings({ navigateAnimationEnabled: event.currentTarget.checked })}
          />
        </label>
      </CollapsibleSection>

      <CollapsibleSection
        title={extra.tokenSettings}
        icon={<Gauge size={17} aria-hidden="true" />}
        badge={settings.tokenPanelEnabled ? extra.enabled : extra.disabled}
        ariaLabel="Token settings"
      >
        <label className="popup-toggle">
          <span>{extra.enableTokenPanel}</span>
          <input
            type="checkbox"
            checked={settings.tokenPanelEnabled}
            onChange={(event) => updateSettings({ tokenPanelEnabled: event.currentTarget.checked })}
          />
        </label>
        <label className="popup-field">
          <span>{t.tokenBudget}</span>
          <select
            value={
              settings.tokenBudgetMode === "model"
                ? "model"
                : TOKEN_BUDGET_PRESETS.includes(settings.manualTokenBudget)
                  ? String(settings.manualTokenBudget)
                  : "custom"
            }
            onChange={(event) => updateBudgetPreset(event.currentTarget.value)}
          >
            <option value="model">{t.tokenBudgetAuto}</option>
            {TOKEN_BUDGET_PRESETS.map((budget) => (
              <option value={budget} key={budget}>
                {formatBudgetLabel(budget)}
              </option>
            ))}
            <option value="custom">{t.tokenBudgetCustom}</option>
          </select>
        </label>
        {settings.tokenBudgetMode === "model" ? (
          <label className="popup-field">
            <span>{t.tokenModel}</span>
            <select
              value={selectedTokenModelId}
              onChange={(event) =>
                updateSettings({
                  tokenBudgetMode: "model",
                  tokenModelId: event.currentTarget.value
                })
              }
            >
              {modelCatalog.map((model) => (
                <option value={model.id} key={model.id}>
                  {formatModelOptionLabel(model, t.tokenModelAuto)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {settings.tokenBudgetMode === "manual" && !TOKEN_BUDGET_PRESETS.includes(settings.manualTokenBudget) ? (
          <label className="popup-field">
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
      </CollapsibleSection>

      <CollapsibleSection
        title={t.compatRules}
        icon={<Database size={17} aria-hidden="true" />}
        badge={`${compatRuleCount} ${t.compatRulesCount}`}
        ariaLabel="Compatibility settings"
      >
        <label className="popup-toggle">
          <span>{extra.remoteCompat}</span>
          <input
            type="checkbox"
            checked={settings.compatRulesAutoSyncEnabled}
            onChange={(event) => {
              if (event.currentTarget.checked) {
                void syncCompatRules();
              } else {
                void resetCompatRules();
              }
            }}
          />
        </label>
        <div className="popup-action-row">
          <button
            className="popup-secondary"
            type="button"
            onClick={() => void syncCompatRules()}
            disabled={compatStatus === "syncing"}
          >
            {compatStatus === "syncing" ? t.compatRulesSyncing : extra.syncCompat}
          </button>
          <button className="popup-secondary" type="button" onClick={() => void resetCompatRules()}>
            {extra.resetCompat}
          </button>
        </div>
        <div className="popup-compat-status">
          <span>
            {settings.language === "en" ? "Active" : "当前"}:
            {" "}
            {activeCompatSource === "remote"
              ? (settings.language === "en" ? "remote rule" : "远程规则")
              : (settings.language === "en" ? "built-in rule" : "内置规则")}
          </span>
          <span>
            {settings.language === "en" ? "Health" : "健康状态"}:
            {" "}
            {pageHealth?.status ?? "unknown"}
          </span>
          <span>
            {settings.language === "en" ? "Last sync" : "最后同步"}:
            {" "}
            {compatMeta.updatedAt ? new Date(compatMeta.updatedAt).toLocaleString() : "-"}
          </span>
          {compatMeta.lastError ? (
            <span className="is-error">{settings.language === "en" ? "Last sync failed" : "最近同步失败，继续使用已有规则"}</span>
          ) : null}
        </div>
        <p>{t.compatRulesNote}</p>
      </CollapsibleSection>

    </main>
  );
}
