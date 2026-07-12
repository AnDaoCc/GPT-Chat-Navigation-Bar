import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";
import { TokenCountBatchItem } from "./shared";

export const TOKEN_BATCH_MAX_ITEMS = 128;
export const TOKEN_BATCH_MAX_BYTES = 512 * 1024;

let tokenizer: Tiktoken | null = null;

function getTokenizer(): Tiktoken {
  tokenizer ??= new Tiktoken(o200kBase);
  return tokenizer;
}

export function normalizeTokenBatchItems(value: unknown): TokenCountBatchItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  let payloadBytes = 0;
  const items: TokenCountBatchItem[] = [];
  for (const candidate of value.slice(0, TOKEN_BATCH_MAX_ITEMS)) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const item = candidate as Partial<TokenCountBatchItem>;
    const id = typeof item.id === "string" ? item.id.slice(0, 160) : "";
    const text = typeof item.text === "string" ? item.text : "";
    const nextBytes = (id.length + text.length) * 2;
    if (!id || !text || payloadBytes + nextBytes > TOKEN_BATCH_MAX_BYTES) {
      break;
    }

    payloadBytes += nextBytes;
    items.push({ id, text });
  }

  return items;
}

export function countTokenBatchItems(items: TokenCountBatchItem[]): Array<{ id: string; count: number }> {
  const encoder = getTokenizer();
  return items.map((item) => ({
    id: item.id,
    count: encoder.encode(item.text).length
  }));
}
