import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  HardDrive,
  Languages,
  MoveHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Type
} from "lucide-react";
import {
  AppLanguage,
  CacheMode,
  DEFAULT_SETTINGS,
  NavigatorSettings,
  PAGE_CACHE_CLEAR_MESSAGE,
  PAGE_CACHE_LIST_MESSAGE,
  isNavigatorRecordKey,
  normalizeSettings,
  sanitizeCacheNamespace,
  STORAGE_RECORD_PREFIX,
  STORAGE_SETTINGS_KEY,
  StoredConversationRecord
} from "./shared";
import { getTranslation, LANGUAGE_NAMES } from "./i18n";
import { CHATGPT_COMPAT_RULES_URL, normalizeCompatRulesPayload } from "./chatGptAdapter";

type StoredRecordEntry = {
  key: string;
  record: StoredConversationRecord;
};

type PageCacheResponse = {
  ok?: boolean;
  records?: StoredRecordEntry[];
  removed?: number;
  error?: string;
};

type DisplayNumberSetting =
  | "chatFontScale"
  | "chatLetterSpacing"
  | "chatLineHeight"
  | "chatContentWidth"
  | "canvasFontScale"
  | "canvasLetterSpacing"
  | "canvasLineHeight";

type CompatStatus = "idle" | "syncing" | "synced" | "failed";

const OFFICIAL_THREAD_WIDTH = 60;
const THREAD_WIDTH_MIN = 60;
const THREAD_WIDTH_MAX = 100;
const MODEL_CATALOG_STORAGE_KEY = "conversationNavigator:modelCatalog:v1";
const COMPAT_RULES_STORAGE_KEY = "conversationNavigator:compatRules:v1";
const TABLE_COPY_FORMAT_STORAGE_KEY = "conversationNavigator:tableCopyFormat:v1";
const TOKEN_BUDGET_PRESETS = [32000, 128000, 200000, 400000, 1000000, 2000000];

function getPopupExtraLabels(language: AppLanguage) {
  if (language === "en") {
    return {
      readingDisplay: "Reading display",
      behavior: "Behavior",
      tokenSettings: "Token settings",
      preciseValue: "Precise value",
      enableTokenPanel: "Enable token panel",
      panelPosition: "Panel position",
      remoteCompat: "Remote compatibility rules",
      syncCompat: "Sync remote rules",
      resetCompat: "Use built-in rules",
      widthHandle: "Width resize handle",
      enabled: "Enabled",
      disabled: "Disabled"
    };
  }

  if (language === "zh-TW") {
    return {
      readingDisplay: "閱讀顯示",
      behavior: "功能行為",
      tokenSettings: "Token 設定",
      preciseValue: "精準數值",
      enableTokenPanel: "啟用 Token 面板",
      panelPosition: "面板位置",
      remoteCompat: "遠端相容規則",
      syncCompat: "同步遠端規則",
      resetCompat: "使用內建規則",
      widthHandle: "正文寬度調節",
      enabled: "已啟用",
      disabled: "已停用"
    };
  }

  return {
    readingDisplay: "阅读显示",
    behavior: "功能行为",
    tokenSettings: "Token 设置",
    preciseValue: "精准数值",
    enableTokenPanel: "启用 Token 面板",
    panelPosition: "面板位置",
    remoteCompat: "远程兼容规则",
    syncCompat: "同步远程规则",
    resetCompat: "使用内置规则",
    widthHandle: "正文宽度调节",
    enabled: "已启用",
    disabled: "已停用"
  };
}

function getPopupCacheLabels(language: AppLanguage) {
  if (language === "en") {
    return {
      cacheDocuments: "Cached chats",
      selectedClear: "Delete selected",
      selectAll: "Select all",
      deselectAll: "Deselect",
      noCacheRecords: "No cached chat records in this storage target.",
      safeToDelete: "Safe to delete",
      keepItem: "Keep",
      deleteRecord: "Delete",
      cacheFolder: "Cache location guide",
      openProfile: "Open chrome://version",
      cacheFolderNote: "Chrome extension cache is stored in the browser profile, not in a normal extension folder. Open chrome://version and use Profile Path, then check Local Extension Settings/{id}.",
      storageItems: "What can be deleted",
      conversationRecords: "Conversation records",
      modelCatalog: "Model catalog",
      compatRulesItem: "Compatibility rules",
      tablePreference: "Table copy preference",
      settingsItem: "Extension settings",
      extensionFiles: "Extension files",
      canDeleteDescription: "Can be removed; it will rebuild when needed.",
      keepDescription: "Do not delete unless you want to reset or reinstall.",
      selectedCount: "selected",
      nodes: "nodes",
      updated: "Updated",
      cacheKey: "Key"
    };
  }

  if (language === "zh-TW") {
    return {
      cacheDocuments: "快取聊天",
      selectedClear: "刪除選中",
      selectAll: "全選",
      deselectAll: "取消",
      noCacheRecords: "目前儲存目標沒有聊天快取。",
      safeToDelete: "可刪",
      keepItem: "保留",
      deleteRecord: "刪除",
      cacheFolder: "快取位置說明",
      openProfile: "打開 chrome://version",
      cacheFolderNote: "Chrome 擴充快取在瀏覽器資料目錄中，不是普通擴充資料夾。打開 chrome://version 後查看 Profile Path，再找 Local Extension Settings/{id}。",
      storageItems: "哪些能刪",
      conversationRecords: "聊天記錄快取",
      modelCatalog: "模型目錄",
      compatRulesItem: "相容規則",
      tablePreference: "表格複製偏好",
      settingsItem: "插件設定",
      extensionFiles: "插件檔案",
      canDeleteDescription: "可以移除，需要時會重新生成。",
      keepDescription: "不要刪，除非要重置或重裝。",
      selectedCount: "已選",
      nodes: "節點",
      updated: "更新",
      cacheKey: "鍵"
    };
  }

  return {
    cacheDocuments: "缓存聊天文档",
    selectedClear: "删除选中",
    selectAll: "全选",
    deselectAll: "取消",
    noCacheRecords: "当前存储目标里没有聊天缓存。",
    safeToDelete: "可删",
    keepItem: "保留",
    deleteRecord: "删除",
    cacheFolder: "缓存位置说明",
    openProfile: "打开 chrome://version",
    cacheFolderNote: "Chrome 扩展缓存存在浏览器资料目录里，不是普通扩展文件夹。打开 chrome://version 后看 Profile Path，再找 Local Extension Settings/{id}。",
    storageItems: "哪些能删",
    conversationRecords: "聊天记录缓存",
    modelCatalog: "模型目录",
    compatRulesItem: "兼容规则",
    tablePreference: "表格复制偏好",
    settingsItem: "插件设置",
    extensionFiles: "插件文件",
    canDeleteDescription: "可以移除，需要时会重新生成。",
    keepDescription: "不要删，除非你想重置或重装。",
    selectedCount: "已选",
    nodes: "节点",
    updated: "更新",
    cacheKey: "键"
  };
}

function formatBudgetLabel(value: number): string {
  if (value >= 1000000) {
    return `${value / 1000000}M`;
  }

  return `${Math.round(value / 1000)}k`;
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

function sortRecordEntries(records: StoredRecordEntry[]): StoredRecordEntry[] {
  return records
    .filter((entry) => typeof entry.key === "string" && Array.isArray(entry.record?.nodes))
    .sort((a, b) => (b.record.updatedAt || 0) - (a.record.updatedAt || 0));
}

function getRecordTitle(entry: StoredRecordEntry): string {
  const title = entry.record.title?.trim();
  if (title) {
    return title;
  }

  try {
    return new URL(entry.record.url).pathname || entry.record.host || entry.key;
  } catch {
    return entry.record.host || entry.key;
  }
}

function formatRecordDate(value: number): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function readChromeRecords(namespace: string): Promise<StoredRecordEntry[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (result) => {
      const records = Object.entries(result)
        .filter(([key]) => isNavigatorRecordKey(key, namespace))
        .map(([key, value]) => ({
          key,
          record: value as StoredConversationRecord
        }));

      resolve(sortRecordEntries(records));
    });
  });
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

async function sendPageCacheMessage(
  type: string,
  namespace: string,
  keys?: string[]
): Promise<PageCacheResponse | undefined> {
  const tabId = await queryActiveTabId();
  if (typeof tabId !== "number") {
    return undefined;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type, namespace, keys }, (response?: PageCacheResponse) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }

      resolve(response);
    });
  });
}

async function readPageRecords(namespace: string): Promise<StoredRecordEntry[]> {
  const response = await sendPageCacheMessage(PAGE_CACHE_LIST_MESSAGE, namespace);
  return response?.ok && Array.isArray(response.records) ? sortRecordEntries(response.records) : [];
}

async function readRecords(settings: NavigatorSettings): Promise<StoredRecordEntry[]> {
  if (settings.cacheMode === "off") {
    return [];
  }

  return settings.cacheMode === "page"
    ? readPageRecords(settings.cacheNamespace)
    : readChromeRecords(settings.cacheNamespace);
}

async function clearRecords(settings: NavigatorSettings, records: StoredRecordEntry[]): Promise<void> {
  if (settings.cacheMode === "page") {
    await sendPageCacheMessage(
      PAGE_CACHE_CLEAR_MESSAGE,
      settings.cacheNamespace,
      records.map((entry) => entry.key)
    );
    return;
  }

  await removeStoredRecords(records.map((entry) => entry.key));
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

function readStoredCompatRuleCount(): Promise<number> {
  return new Promise((resolve) => {
    chrome.storage.local.get(COMPAT_RULES_STORAGE_KEY, (result) => {
      const rules = (result[COMPAT_RULES_STORAGE_KEY] as { rules?: unknown[] } | undefined)?.rules;
      resolve(Array.isArray(rules) ? rules.length : 0);
    });
  });
}

function writeStoredCompatRules(rules: unknown[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [COMPAT_RULES_STORAGE_KEY]: {
          updatedAt: Date.now(),
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

function removeStoredRecords(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
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
  const cacheText = getPopupCacheLabels(settings.language);
  const [records, setRecords] = useState<StoredRecordEntry[]>([]);
  const [selectedRecordKeys, setSelectedRecordKeys] = useState<Set<string>>(new Set());
  const [isClearing, setIsClearing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [compatStatus, setCompatStatus] = useState<CompatStatus>("idle");
  const [compatRuleCount, setCompatRuleCount] = useState(0);
  const [displayNumberDrafts, setDisplayNumberDrafts] = useState<Partial<Record<DisplayNumberSetting, string>>>({});

  useEffect(() => {
    async function load() {
      const nextSettings = await readSettings();
      setSettings(nextSettings);
      setRecords(await readRecords(nextSettings));
      const storedCompat = await readStoredCompatRuleCount();
      setCompatRuleCount(storedCompat);
    }

    load();
  }, []);

  useEffect(() => {
    const availableKeys = new Set(records.map((entry) => entry.key));
    setSelectedRecordKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => availableKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [records]);

  const totalNodes = useMemo(
    () => records.reduce((sum, entry) => sum + entry.record.nodes.length, 0),
    [records]
  );
  const selectedRecords = useMemo(
    () => records.filter((entry) => selectedRecordKeys.has(entry.key)),
    [records, selectedRecordKeys]
  );
  const activeRecordPrefix = `${settings.cacheNamespace}:page:`;

  const handleClear = async () => {
    setIsClearing(true);
    await clearRecords(settings, records);
    setRecords(await readRecords(settings));
    setSelectedRecordKeys(new Set());
    setIsClearing(false);
  };

  const handleClearSelected = async () => {
    if (selectedRecords.length === 0) {
      return;
    }

    setIsClearing(true);
    await clearRecords(settings, selectedRecords);
    setRecords(await readRecords(settings));
    setSelectedRecordKeys(new Set());
    setIsClearing(false);
  };

  const handleDeleteRecord = async (entry: StoredRecordEntry) => {
    setIsClearing(true);
    await clearRecords(settings, [entry]);
    setRecords(await readRecords(settings));
    setSelectedRecordKeys((current) => {
      const next = new Set(current);
      next.delete(entry.key);
      return next;
    });
    setIsClearing(false);
  };

  const toggleRecordSelection = (key: string) => {
    setSelectedRecordKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAllRecords = () => {
    setSelectedRecordKeys((current) =>
      current.size === records.length ? new Set() : new Set(records.map((entry) => entry.key))
    );
  };

  const openChromeProfileGuide = () => {
    if (chrome.tabs?.create) {
      chrome.tabs.create({ url: "chrome://version/" });
      return;
    }

    window.open("chrome://version/", "_blank", "noopener,noreferrer");
  };

  const updateSettings = async (patch: Partial<NavigatorSettings>) => {
    setIsSaving(true);
    const nextSettings = normalizeSettings({ ...settings, ...patch });
    setSettings(nextSettings);
    await writeSettings(nextSettings);
    setRecords(await readRecords(nextSettings));
    setIsSaving(false);
  };

  const makeDisplayNumberPatch = (setting: DisplayNumberSetting, value: number): Partial<NavigatorSettings> => {
    const patch = { [setting]: value } as Partial<NavigatorSettings>;
    if (setting === "chatContentWidth") {
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
      setCompatRuleCount(rules.length);
      await updateSettings({
        compatRulesRemoteEnabled: true,
        compatRulesLastSyncAt: Date.now(),
        compatRulesSource: "remote"
      });
      setCompatStatus("synced");
    } catch {
      setCompatStatus("failed");
    }
  };

  const resetCompatRules = async () => {
    await removeStoredCompatRules();
    setCompatRuleCount(0);
    setCompatStatus("idle");
    await updateSettings({
      compatRulesRemoteEnabled: false,
      compatRulesLastSyncAt: 0,
      compatRulesSource: "built-in"
    });
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
    const value = Number(settings[setting]);
    const displayValue = step < 1 ? value.toFixed(1) : String(Math.round(value));
    const inputValue = displayNumberDrafts[setting] ?? displayValue;
    const applyValue = (rawValue: number) => {
      const nextValue = normalizeDisplayNumber(rawValue, min, max, step);
      void updateSettings(makeDisplayNumberPatch(setting, nextValue));
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
        applyValue(parsed);
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
            applyValue(Number(event.currentTarget.value));
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
              applyValue(parsed);
            }}
            onBlur={(event) => commitInputValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitInputValue(event.currentTarget.value);
                event.currentTarget.blur();
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
            void updateSettings(makeDisplayNumberPatch(setting, resetValue));
          }}
        >
          {t.resetDisplay}
        </button>
      </label>
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

      <section className="popup-stats" aria-label="Stored navigation data">
        <div>
          <span className="popup-stat-value">{records.length}</span>
          <span className="popup-stat-label">{t.pages}</span>
        </div>
        <div>
          <span className="popup-stat-value">{totalNodes}</span>
          <span className="popup-stat-label">{t.nodes}</span>
        </div>
      </section>

      <section className="popup-privacy">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>{t.privacy}</p>
      </section>

      <CollapsibleSection
        title={extra.readingDisplay}
        icon={<SlidersHorizontal size={17} aria-hidden="true" />}
        badge={isSaving ? t.saving : null}
        ariaLabel="Display settings"
      >
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
        <div className="popup-range-group">
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
      </CollapsibleSection>

      <CollapsibleSection
        title={extra.behavior}
        icon={<CheckCircle2 size={17} aria-hidden="true" />}
        ariaLabel="Behavior settings"
      >
        <label className="popup-toggle">
          <span>{t.autoCollapse}</span>
          <input
            type="checkbox"
            checked={settings.autoCollapseOnOutsideClick}
            onChange={(event) => updateSettings({ autoCollapseOnOutsideClick: event.currentTarget.checked })}
          />
        </label>
        <label className="popup-toggle">
          <span>{t.navigateAnimation}</span>
          <input
            type="checkbox"
            checked={settings.navigateAnimationEnabled}
            onChange={(event) => updateSettings({ navigateAnimationEnabled: event.currentTarget.checked })}
          />
        </label>
        <label className="popup-toggle">
          <span>{extra.widthHandle}</span>
          <input
            type="checkbox"
            checked={settings.threadResizeEnabled}
            onChange={(event) => updateSettings({ threadResizeEnabled: event.currentTarget.checked })}
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
          <span>{extra.panelPosition}</span>
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
        title={t.cacheLocation}
        icon={<HardDrive size={17} aria-hidden="true" />}
        badge={isSaving ? t.saving : null}
        ariaLabel="Cache settings"
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

        <label className="popup-field">
          <span>{t.storageTarget}</span>
          <select
            value={settings.cacheMode}
            onChange={(event) =>
              updateSettings({ cacheMode: event.currentTarget.value as CacheMode })
            }
          >
            <option value="chrome">{t.storageChrome}</option>
            <option value="page">{t.storagePage}</option>
            <option value="off">{t.storageOff}</option>
          </select>
        </label>

        <label className="popup-field">
          <span>{t.cacheNamespace}</span>
          <input
            value={settings.cacheNamespace}
            onChange={(event) =>
              setSettings({
                ...settings,
                cacheNamespace: sanitizeCacheNamespace(event.currentTarget.value)
              })
            }
            onBlur={(event) => updateSettings({ cacheNamespace: event.currentTarget.value })}
            spellCheck={false}
          />
        </label>

        <p>{t.cacheNote}</p>
      </CollapsibleSection>

      <CollapsibleSection
        title={cacheText.cacheDocuments}
        icon={<FileText size={17} aria-hidden="true" />}
        badge={`${selectedRecords.length} ${cacheText.selectedCount}`}
        ariaLabel="Cached chat records"
      >
        <div className="popup-action-row">
          <button
            className="popup-secondary"
            type="button"
            onClick={toggleAllRecords}
            disabled={records.length === 0}
          >
            {selectedRecordKeys.size === records.length && records.length > 0
              ? cacheText.deselectAll
              : cacheText.selectAll}
          </button>
          <button
            className="popup-secondary"
            type="button"
            onClick={handleClearSelected}
            disabled={selectedRecords.length === 0 || isClearing}
          >
            {cacheText.selectedClear}
          </button>
        </div>

        <div className="popup-record-list">
          {records.length === 0 ? (
            <p className="popup-empty">{cacheText.noCacheRecords}</p>
          ) : (
            records.map((entry) => (
              <article className="popup-record" key={entry.key}>
                <label className="popup-record-main">
                  <input
                    type="checkbox"
                    checked={selectedRecordKeys.has(entry.key)}
                    onChange={() => toggleRecordSelection(entry.key)}
                  />
                  <span>
                    <strong>{getRecordTitle(entry)}</strong>
                    <small>
                      {`${entry.record.nodes.length} ${cacheText.nodes} · ${cacheText.updated} ${formatRecordDate(entry.record.updatedAt)}`}
                    </small>
                    <code>{entry.key}</code>
                  </span>
                </label>
                <button
                  className="popup-record-delete"
                  type="button"
                  onClick={() => void handleDeleteRecord(entry)}
                  disabled={isClearing}
                  title={cacheText.deleteRecord}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </article>
            ))
          )}
        </div>
        <button
          className="popup-clear"
          type="button"
          onClick={handleClear}
          disabled={records.length === 0 || isClearing}
        >
          <Trash2 size={16} aria-hidden="true" />
          {isClearing ? t.clearing : t.clearLocalIndex}
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        title={cacheText.cacheFolder}
        icon={<FolderOpen size={17} aria-hidden="true" />}
        ariaLabel="Cache folder guide"
      >
        <button className="popup-secondary" type="button" onClick={openChromeProfileGuide}>
          <ExternalLink size={15} aria-hidden="true" />
          {cacheText.openProfile}
        </button>
        <p>{cacheText.cacheFolderNote.replace("{id}", chrome.runtime.id)}</p>
        <div className="popup-storage-guide">
          {[
            {
              name: cacheText.conversationRecords,
              key: `${settings.cacheNamespace}:page:*`,
              deletable: true
            },
            {
              name: cacheText.modelCatalog,
              key: MODEL_CATALOG_STORAGE_KEY,
              deletable: true
            },
            {
              name: cacheText.compatRulesItem,
              key: COMPAT_RULES_STORAGE_KEY,
              deletable: true
            },
            {
              name: cacheText.tablePreference,
              key: TABLE_COPY_FORMAT_STORAGE_KEY,
              deletable: true
            },
            {
              name: cacheText.settingsItem,
              key: STORAGE_SETTINGS_KEY,
              deletable: false
            },
            {
              name: cacheText.extensionFiles,
              key: "manifest.json / assets/*.js / assets/*.css / assets/icon*.png",
              deletable: false
            }
          ].map((item) => (
            <div className="popup-storage-item" key={item.key}>
              <span className={item.deletable ? "is-safe" : "is-keep"}>
                {item.deletable ? cacheText.safeToDelete : cacheText.keepItem}
              </span>
              <strong>{item.name}</strong>
              <code>{item.key}</code>
              <small>{item.deletable ? cacheText.canDeleteDescription : cacheText.keepDescription}</small>
            </div>
          ))}
        </div>
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
            checked={settings.compatRulesRemoteEnabled && settings.compatRulesSource === "remote"}
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
        <p>{t.compatRulesNote}</p>
      </CollapsibleSection>

      <p className="popup-footnote">
        {t.defaultKeyPrefix}: <code>{STORAGE_RECORD_PREFIX}</code>
        <br />
        {t.activeKeyPrefix}: <code>{activeRecordPrefix}</code>
      </p>
    </main>
  );
}
