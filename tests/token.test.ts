import assert from "node:assert/strict";
import test from "node:test";
import { approximateTokenCount } from "../src/tokenApprox";
import {
  TOKEN_BATCH_MAX_BYTES,
  TOKEN_BATCH_MAX_ITEMS,
  countTokenBatchItems,
  normalizeTokenBatchItems
} from "../src/tokenWorker";

test("fallback token estimator handles Chinese, English, code and empty text", () => {
  assert.equal(approximateTokenCount(""), 0);
  assert.ok(approximateTokenCount("这是中文测试。") > 0);
  assert.ok(approximateTokenCount("This is an English token test.") > 0);
  assert.ok(approximateTokenCount("const value = items.map((item) => item.id);") > 0);
});

test("background token worker returns stable exact counts", () => {
  const items = [
    { id: "zh", text: "这是中文测试。" },
    { id: "en", text: "This is an English token test." },
    { id: "code", text: "const value = items.map((item) => item.id);" }
  ];
  const first = countTokenBatchItems(items);
  const second = countTokenBatchItems(items);
  assert.deepEqual(first, second);
  assert.ok(first.every((item) => item.count > 0));
});

test("token batch enforces item and payload limits", () => {
  const many = Array.from({ length: TOKEN_BATCH_MAX_ITEMS + 20 }, (_, index) => ({
    id: String(index),
    text: "test"
  }));
  assert.equal(normalizeTokenBatchItems(many).length, TOKEN_BATCH_MAX_ITEMS);

  const oversized = [
    { id: "large", text: "x".repeat(TOKEN_BATCH_MAX_BYTES) },
    { id: "after", text: "test" }
  ];
  assert.equal(normalizeTokenBatchItems(oversized).length, 0);
});
