export function approximateTokenCount(text: string): number {
  const normalized = text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return 0;
  }

  const cjk = normalized.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
  const asciiWords = normalized.match(/[a-zA-Z0-9_]+/g)?.length ?? 0;
  const punctuation = normalized.match(/[^\s\w\u3400-\u9FFF\uF900-\uFAFF]/g)?.length ?? 0;
  return Math.max(1, Math.ceil(cjk * 1.08 + asciiWords * 1.25 + punctuation * 0.55));
}
