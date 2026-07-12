import assert from "node:assert/strict";
import test from "node:test";
import {
  findLegacyConversationRecordKeys,
  isLegacyConversationRecord,
  normalizeSettings
} from "../src/shared";
import {
  buildConversationSessionId,
  hasConversationPromptOverlap,
  isCurrentTokenSession
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
    cacheNamespace: "legacy"
  } as Parameters<typeof normalizeSettings>[0] & Record<string, unknown>);

  assert.equal(normalized.language, "en");
  assert.equal(normalized.chatFontScale, 135);
  assert.equal("cacheMode" in normalized, false);
  assert.equal("cacheNamespace" in normalized, false);
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

test("prompt overlap and token responses are accepted only for the active session", () => {
  assert.equal(hasConversationPromptOverlap(["first", "second"], ["second", "third"]), true);
  assert.equal(hasConversationPromptOverlap(["old"], ["new"]), false);
  assert.equal(isCurrentTokenSession("session-new", "session-new"), true);
  assert.equal(isCurrentTokenSession("session-old", "session-new"), false);
});
