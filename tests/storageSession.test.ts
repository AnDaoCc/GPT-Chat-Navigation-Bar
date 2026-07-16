import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SELECTIVE_EXPORT_PREFERENCES,
  findLegacyConversationRecordKeys,
  isLegacyConversationRecord,
  normalizeSelectiveExportPreferences,
  normalizeSettings
} from "../src/shared";
import {
  buildConversationStorageKey,
  buildConversationSessionId,
  hasConversationPromptOverlap
} from "../src/conversationSession";

test("legacy conversation records are identified by both key and payload shape", () => {
  const record = {
    schemaVersion: 1,
    pageKey: "conversationNavigator:page:chatgpt.com:conversation:abc12345",
    nodes: []
  };

  assert.equal(isLegacyConversationRecord(record, record.pageKey), true);
  assert.equal(isLegacyConversationRecord(record, "unrelated:page:key"), false);
  assert.equal(isLegacyConversationRecord({ schemaVersion: 1, pageKey: record.pageKey }, record.pageKey), false);
  assert.deepEqual(findLegacyConversationRecordKeys({
    [record.pageKey]: record,
    "conversationNavigator:settings": { language: "zh-CN" },
    "unrelated:page:key": { schemaVersion: 2, pageKey: "unrelated:page:key", nodes: [] }
  }), [record.pageKey]);
});

test("legacy cache settings are discarded while user settings remain", () => {
  const normalized = normalizeSettings({
    language: "en",
    chatFontScale: 135,
    cacheMode: "page",
    cacheNamespace: "legacy",
    tokenPanelEnabled: true,
    manualTokenBudget: 128000
  } as Parameters<typeof normalizeSettings>[0] & Record<string, unknown>);

  assert.equal(normalized.language, "en");
  assert.equal(normalized.chatFontScale, 135);
  assert.equal("cacheMode" in normalized, false);
  assert.equal("cacheNamespace" in normalized, false);
  assert.equal("tokenPanelEnabled" in normalized, false);
  assert.equal("manualTokenBudget" in normalized, false);
  assert.equal(normalized.drawerMode, "auto");
  assert.equal(normalized.uiMotionEnabled, true);
  assert.equal(normalized.focusHideChrome, true);
  assert.equal(normalized.focusCollapseOtherTurns, true);
});

test("V10 settings migration preserves existing display values and validates new controls", () => {
  const normalized = normalizeSettings({
    language: "zh-TW",
    chatFontScale: 132,
    chatContentWidth: 78,
    chatLayoutVersion: 2,
    canvasFontScale: 115,
    drawerMode: "overlay",
    uiMotionEnabled: false,
    focusHideChrome: false
  });
  assert.equal(normalized.language, "zh-TW");
  assert.equal(normalized.chatFontScale, 132);
  assert.equal(normalized.chatContentWidth, 78);
  assert.equal(normalized.canvasFontScale, 115);
  assert.equal(normalized.drawerMode, "overlay");
  assert.equal(normalized.uiMotionEnabled, false);
  assert.equal(normalized.focusHideChrome, false);
});

test("selective export preferences default to faithful source content", () => {
  assert.deepEqual(normalizeSelectiveExportPreferences(undefined), DEFAULT_SELECTIVE_EXPORT_PREFERENCES);
  assert.deepEqual(normalizeSelectiveExportPreferences({
    schemaVersion: 1,
    format: "html",
    filterShortMessages: true,
    generateToc: true
  }), {
    ...DEFAULT_SELECTIVE_EXPORT_PREFERENCES,
    format: "html",
    filterShortMessages: true,
    generateToc: true
  });
});

test("conversation sessions isolate tabs, drafts, epochs, and conversation ids", () => {
  assert.equal(
    buildConversationSessionId("chatgpt.com", "conversation-1", "tab-a", 2),
    "chatgpt.com:conversation:conversation-1:epoch:2"
  );
  assert.notEqual(
    buildConversationSessionId("chatgpt.com", null, "tab-a", 0),
    buildConversationSessionId("chatgpt.com", null, "tab-b", 0)
  );
  assert.notEqual(
    buildConversationSessionId("chatgpt.com", null, "tab-a", 0),
    buildConversationSessionId("chatgpt.com", null, "tab-a", 1)
  );
});

test("conversation storage keys stay stable across epochs and tabs while drafts remain tab-scoped", () => {
  const firstTabKey = buildConversationStorageKey("chatgpt.com", "conversation-1", "tab-a");
  const secondTabKey = buildConversationStorageKey("chatgpt.com", "conversation-1", "tab-b");

  assert.equal(firstTabKey, "chatgpt.com:conversation:conversation-1");
  assert.equal(secondTabKey, firstTabKey);
  assert.notEqual(
    buildConversationSessionId("chatgpt.com", "conversation-1", "tab-a", 0),
    buildConversationSessionId("chatgpt.com", "conversation-1", "tab-a", 1)
  );
  assert.equal(
    buildConversationStorageKey("chatgpt.com", "conversation-1", "tab-a"),
    buildConversationStorageKey("chatgpt.com", "conversation-1", "tab-a")
  );
  assert.notEqual(
    buildConversationStorageKey("chatgpt.com", null, "tab-a"),
    buildConversationStorageKey("chatgpt.com", null, "tab-b")
  );
});

test("prompt overlap distinguishes retained and replaced conversations", () => {
  assert.equal(hasConversationPromptOverlap(["first", "second"], ["second", "third"]), true);
  assert.equal(hasConversationPromptOverlap(["old"], ["new"]), false);
});
