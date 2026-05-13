import React, { useEffect, useMemo, useState } from "react";
import { Database, HardDrive, Languages, ShieldCheck, Trash2 } from "lucide-react";
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

function sortRecordEntries(records: StoredRecordEntry[]): StoredRecordEntry[] {
  return records
    .filter((entry) => typeof entry.key === "string" && Array.isArray(entry.record?.nodes))
    .sort((a, b) => (b.record.updatedAt || 0) - (a.record.updatedAt || 0));
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

async function sendPageCacheMessage(type: string, namespace: string): Promise<PageCacheResponse | undefined> {
  const tabId = await queryActiveTabId();
  if (typeof tabId !== "number") {
    return undefined;
  }

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type, namespace }, (response?: PageCacheResponse) => {
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
    await sendPageCacheMessage(PAGE_CACHE_CLEAR_MESSAGE, settings.cacheNamespace);
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

function removeStoredRecords(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

export function Popup() {
  const [settings, setSettings] = useState<NavigatorSettings>(DEFAULT_SETTINGS);
  const t = getTranslation(settings.language);
  const [records, setRecords] = useState<StoredRecordEntry[]>([]);
  const [isClearing, setIsClearing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const nextSettings = await readSettings();
      setSettings(nextSettings);
      setRecords(await readRecords(nextSettings));
    }

    load();
  }, []);

  const totalNodes = useMemo(
    () => records.reduce((sum, entry) => sum + entry.record.nodes.length, 0),
    [records]
  );
  const activeRecordPrefix = `${settings.cacheNamespace}:page:`;

  const handleClear = async () => {
    setIsClearing(true);
    await clearRecords(settings, records);
    setRecords(await readRecords(settings));
    setIsClearing(false);
  };

  const updateSettings = async (patch: Partial<NavigatorSettings>) => {
    setIsSaving(true);
    const nextSettings = normalizeSettings({ ...settings, ...patch });
    setSettings(nextSettings);
    await writeSettings(nextSettings);
    setRecords(await readRecords(nextSettings));
    setIsSaving(false);
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

      <section className="popup-settings" aria-label="Cache settings">
        <div className="popup-settings-title">
          <HardDrive size={17} aria-hidden="true" />
          <span>{t.cacheLocation}</span>
          {isSaving ? <small>{t.saving}</small> : null}
        </div>

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
      </section>

      <button
        className="popup-clear"
        type="button"
        onClick={handleClear}
        disabled={records.length === 0 || isClearing}
      >
        <Trash2 size={16} aria-hidden="true" />
        {isClearing ? t.clearing : t.clearLocalIndex}
      </button>

      <p className="popup-footnote">
        {t.defaultKeyPrefix}: <code>{STORAGE_RECORD_PREFIX}</code>
        <br />
        {t.activeKeyPrefix}: <code>{activeRecordPrefix}</code>
      </p>
    </main>
  );
}
