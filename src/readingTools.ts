import {
  CitationCheckResult,
  CitationRecord,
  ExportCodeBlock,
  ExportContentBlock,
  ExportNavigatorNode,
  SelectiveExportPreferences,
  SelectiveExportMessage,
  SelectiveExportSnapshot
} from "./shared";

export interface ReadingSourceMessage {
  id: string;
  role: "user" | "assistant";
  element: HTMLElement;
  text: string;
  turnIndex: number;
}

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid"
]);

function normalizeText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function getTableRows(table: HTMLTableElement): string[][] {
  return Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => normalizeText(cell.innerText || cell.textContent || ""))
  );
}

function getBlockKind(element: HTMLElement): ExportContentBlock["kind"] {
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "pre") return "code";
  if (tag === "table") return "table";
  if (tag === "ul" || tag === "ol") return "list";
  if (/attachment|file/i.test(`${element.getAttribute("data-testid") || ""} ${element.getAttribute("aria-label") || ""}`)) {
    return "attachment";
  }
  if (tag === "img") return "image";
  return "paragraph";
}

function getBlockText(element: HTMLElement, kind: ExportContentBlock["kind"]): string {
  if (kind === "image") {
    const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
    return normalizeText(
      image?.alt ||
      image?.title ||
      element.getAttribute("aria-label") ||
      element.innerText ||
      "图片"
    );
  }
  return normalizeText(element.innerText || element.textContent || "");
}

function isNestedCandidate(element: HTMLElement, candidates: Set<HTMLElement>): boolean {
  const parent = element.parentElement?.closest<HTMLElement>(
    "h1,h2,h3,h4,h5,h6,p,pre,table,ul,ol,[data-testid*='attachment' i],[data-testid*='file' i]"
  );
  if (!parent || !candidates.has(parent)) return false;
  if (element instanceof HTMLImageElement && getBlockKind(parent) !== "attachment") return false;
  return true;
}

export function extractMessageBlocks(message: ReadingSourceMessage): ExportContentBlock[] {
  const selector = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "pre",
    "table",
    "ul",
    "ol",
    "img",
    "[data-testid*='attachment' i]",
    "[data-testid*='file' i]"
  ].join(",");
  const rawCandidates = Array.from(message.element.querySelectorAll<HTMLElement>(selector))
    .filter((element) => !element.closest("#conversation-navigator-root"));
  const candidateSet = new Set(rawCandidates);
  const candidates = rawCandidates.filter((element) => !isNestedCandidate(element, candidateSet));
  const blocks: ExportContentBlock[] = [];

  for (const element of candidates) {
    const kind = getBlockKind(element);
    const text = getBlockText(element, kind);
    if (!text && kind !== "table") continue;
    const order = blocks.length;
    const nestedImage = element instanceof HTMLImageElement ? element : element.querySelector<HTMLImageElement>("img");
    const sourceLink = kind === "image"
      ? nestedImage?.currentSrc || nestedImage?.src
      : element.querySelector<HTMLAnchorElement>("a[href]")?.href;
    const block: ExportContentBlock = {
      id: `${message.id}:block:${kind}:${order}`,
      messageId: message.id,
      role: message.role,
      kind,
      text,
      order
    };
    if (kind === "heading") block.level = Number(element.tagName.slice(1)) || 2;
    if (kind === "table" && element instanceof HTMLTableElement) block.rows = getTableRows(element);
    if (kind === "code") {
      block.language = element.getAttribute("data-language") ||
        element.querySelector<HTMLElement>("code")?.className.match(/language-([\w+-]+)/i)?.[1];
    }
    if ((kind === "image" || kind === "attachment") && sourceLink) block.sourceUrl = sourceLink;
    blocks.push(block);
  }

  if (blocks.length === 0 && normalizeText(message.text)) {
    blocks.push({
      id: `${message.id}:block:paragraph:0`,
      messageId: message.id,
      role: message.role,
      kind: "paragraph",
      text: normalizeText(message.text),
      order: 0
    });
  }
  return blocks;
}

export function canonicalizeCitationUrl(value: string, baseUrl?: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function isPublicCitationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (host.includes(":")) {
      if (
        host === "::" ||
        host === "::1" ||
        host.startsWith("::ffff:") ||
        /^(?:fc|fd|fe8|fe9|fea|feb|fec|fed|fee|fef|ff)/i.test(host) ||
        /^2001:db8(?::|$)/i.test(host)
      ) return false;
      return true;
    }
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a, b, c, d] = ipv4.slice(1).map(Number);
      if ([a, b, c, d].some((part) => part > 255)) return false;
      if (a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a >= 224) return false;
      return true;
    }
    if (!host.includes(".")) return false;
    return true;
  } catch {
    return false;
  }
}

export function classifyCitationHttpStatus(statusCode: number): CitationCheckResult["status"] {
  if (statusCode >= 200 && statusCode < 400) return "reachable";
  if (statusCode === 404 || statusCode === 410) return "missing";
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) return "restricted";
  return "temporary-error";
}

export function classifyCitationFetchResponse(
  statusCode: number,
  responseType = "default"
): Pick<CitationCheckResult, "status" | "statusCode"> {
  if (responseType === "opaqueredirect") return { status: "reachable" };
  return {
    status: classifyCitationHttpStatus(statusCode),
    ...(statusCode > 0 ? { statusCode } : {})
  };
}

export function isReusableCitationCheckResult(
  result: CitationCheckResult | undefined,
  now: number,
  ttlMs: number
): result is CitationCheckResult {
  return Boolean(
    result &&
    result.status !== "blocked" &&
    result.status !== "checking" &&
    Number.isFinite(result.checkedAt) &&
    now - result.checkedAt >= 0 &&
    now - result.checkedAt < ttlMs
  );
}

function findCitationBlockId(anchor: HTMLAnchorElement, blocks: ExportContentBlock[]): string {
  const container = anchor.closest<HTMLElement>("h1,h2,h3,h4,h5,h6,p,li,pre,table,figure");
  if (!container) return blocks[0]?.id || "";
  const list = container.closest<HTMLElement>("ul,ol");
  const blockContainer = list ?? container;
  const kind = getBlockKind(blockContainer);
  const text = getBlockText(blockContainer, kind);
  const exact = blocks.find((block) => block.kind === kind && (!text || block.text === text));
  if (exact) return exact.id;
  const contained = blocks.find((block) => text && (block.text === text || block.text.includes(text)));
  return contained?.id || blocks[0]?.id || "";
}

function isVisibleCitationAnchor(anchor: HTMLAnchorElement, boundary: HTMLElement): boolean {
  const closedDetails = anchor.closest("details:not([open])");
  if (closedDetails && !anchor.closest("summary")) return false;
  let current: HTMLElement | null = anchor;
  while (current) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0")) {
      return false;
    }
    if (current === boundary) break;
    current = current.parentElement;
  }
  return true;
}

export function extractMessageCitations(
  message: ReadingSourceMessage,
  blocks: ExportContentBlock[],
  baseUrl: string
): CitationRecord[] {
  if (message.role !== "assistant") return [];
  const citations = new Map<string, CitationRecord>();
  const anchors = Array.from(message.element.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .filter((anchor) => !anchor.closest("#conversation-navigator-root"))
    .filter((anchor) => isVisibleCitationAnchor(anchor, message.element));

  for (const anchor of anchors) {
    const canonicalUrl = canonicalizeCitationUrl(anchor.href, baseUrl);
    if (!canonicalUrl || canonicalUrl.startsWith("https://chatgpt.com/") || canonicalUrl.startsWith("https://chat.openai.com/")) {
      continue;
    }
    const existing = citations.get(canonicalUrl);
    const blockId = findCitationBlockId(anchor, blocks);
    const block = blocks.find((candidate) => candidate.id === blockId);
    const occurrence = {
      href: anchor.href,
      messageId: message.id,
      blockId,
      excerpt: (block?.text || normalizeText(message.text)).slice(0, 220)
    };
    if (existing) {
      existing.occurrenceCount += 1;
      existing.occurrences.push(occurrence);
      continue;
    }
    const url = new URL(canonicalUrl);
    citations.set(canonicalUrl, {
      id: `citation-${stableHash(`${message.id}:${canonicalUrl}`)}`,
      href: anchor.href,
      canonicalUrl,
      title: normalizeText(anchor.innerText || anchor.title || url.hostname) || url.hostname,
      domain: url.hostname.replace(/^www\./i, ""),
      messageId: message.id,
      blockId,
      excerpt: occurrence.excerpt,
      occurrenceCount: 1,
      occurrences: [occurrence],
      openedAt: 0,
      checkStatus: isPublicCitationUrl(canonicalUrl) ? "unchecked" : "blocked",
      ...(!isPublicCitationUrl(canonicalUrl) ? { checkReason: "unsafe-url" as const } : {})
    });
  }
  return Array.from(citations.values());
}

export interface ReadingMessageParseCacheEntry {
  element: HTMLElement;
  role: ReadingSourceMessage["role"];
  text: string;
  baseUrl: string;
  blocks: ExportContentBlock[];
  citations: CitationRecord[];
}

export type ReadingMessageParseCache = Map<string, ReadingMessageParseCacheEntry>;

function cloneCitation(citation: CitationRecord): CitationRecord {
  return {
    ...citation,
    occurrences: citation.occurrences.map((occurrence) => ({ ...occurrence }))
  };
}

function parseSourceMessage(
  message: ReadingSourceMessage,
  baseUrl: string,
  cache?: ReadingMessageParseCache
): Pick<ReadingMessageParseCacheEntry, "blocks" | "citations"> {
  const cached = cache?.get(message.id);
  if (
    cached &&
    cached.element === message.element &&
    cached.role === message.role &&
    cached.text === message.text &&
    cached.baseUrl === baseUrl
  ) {
    return cached;
  }
  const blocks = extractMessageBlocks(message);
  const citations = extractMessageCitations(message, blocks, baseUrl);
  cache?.set(message.id, {
    element: message.element,
    role: message.role,
    text: message.text,
    baseUrl,
    blocks,
    citations
  });
  return { blocks, citations };
}

export function buildSelectiveExportSnapshot({
  title,
  url,
  pageKey,
  exportedAt,
  sourceMessages,
  nodes = [],
  previousCitationState = new Map<string, Partial<CitationRecord>>(),
  messageCache
}: {
  title: string;
  url: string;
  pageKey: string;
  exportedAt: number;
  sourceMessages: ReadingSourceMessage[];
  nodes?: ExportNavigatorNode[];
  previousCitationState?: Map<string, Partial<CitationRecord>>;
  messageCache?: ReadingMessageParseCache;
}): SelectiveExportSnapshot {
  const messages: SelectiveExportMessage[] = [];
  const allCitations = new Map<string, CitationRecord>();
  const codeBlocks: ExportCodeBlock[] = [];
  const activeMessageIds = new Set(sourceMessages.map((message) => message.id));
  if (messageCache) {
    for (const id of messageCache.keys()) {
      if (!activeMessageIds.has(id)) messageCache.delete(id);
    }
  }

  for (const message of sourceMessages) {
    const { blocks, citations } = parseSourceMessage(message, url, messageCache);
    for (const citation of citations) {
      const saved = previousCitationState.get(citation.canonicalUrl);
      const merged = {
        ...cloneCitation(citation),
        ...saved,
        id: citation.id,
        href: citation.href,
        canonicalUrl: citation.canonicalUrl,
        title: citation.title,
        domain: citation.domain,
        messageId: citation.messageId,
        blockId: citation.blockId,
        excerpt: citation.excerpt,
        occurrenceCount: citation.occurrenceCount,
        occurrences: citation.occurrences.map((occurrence) => ({ ...occurrence }))
      };
      const existing = allCitations.get(citation.canonicalUrl);
      if (existing) {
        existing.occurrenceCount += citation.occurrenceCount;
        existing.occurrences.push(...citation.occurrences.map((occurrence) => ({ ...occurrence })));
      } else {
        allCitations.set(citation.canonicalUrl, merged);
      }
    }
    for (const block of blocks) {
      if (block.kind === "code") {
        codeBlocks.push({
          id: block.id,
          text: block.text,
          language: block.language,
          filename: block.filename
        });
      }
    }
    messages.push({
      id: message.id,
      role: message.role,
      text: message.text,
      turnIndex: message.turnIndex,
      blocks
    });
  }

  return {
    title,
    url,
    pageKey,
    exportedAt,
    messages,
    codeBlocks,
    nodes,
    citations: Array.from(allCitations.values())
  };
}

export function filterSelectiveSnapshot(
  snapshot: SelectiveExportSnapshot,
  selectedBlockIds: ReadonlySet<string>
): SelectiveExportSnapshot {
  const messages = snapshot.messages
    .map((message) => {
      const blocks = message.blocks.filter((block) => selectedBlockIds.has(block.id));
      return {
        ...message,
        blocks,
        text: blocks.map((block) => block.text).filter(Boolean).join("\n\n")
      };
    })
    .filter((message) => message.blocks.length > 0);
  const selectedIds = new Set(messages.flatMap((message) => message.blocks.map((block) => block.id)));
  const citations = snapshot.citations.flatMap((citation) => {
    const occurrences = citation.occurrences.filter((occurrence) => selectedIds.has(occurrence.blockId));
    const first = occurrences[0];
    if (!first) return [];
    return [{
      ...citation,
      href: first.href,
      messageId: first.messageId,
      blockId: first.blockId,
      excerpt: first.excerpt,
      occurrenceCount: occurrences.length,
      occurrences
    }];
  });
  return {
    ...snapshot,
    exportedAt: Date.now(),
    messages,
    codeBlocks: snapshot.codeBlocks.filter((block) => selectedIds.has(block.id)),
    citations
  };
}

export function applySelectiveExportPreferences(
  snapshot: SelectiveExportSnapshot,
  preferences: SelectiveExportPreferences
): SelectiveExportSnapshot {
  const isDisposableShortMessage = (message: SelectiveExportMessage) => {
    const text = normalizeText(message.text);
    return text.length <= 8 && /^(?:好|好的|继续|可以|行|嗯|谢谢|ok|okay|yes|go on|continue)[.!！。… ]*$/i.test(text);
  };
  const sourceMessages = preferences.filterShortMessages
    ? snapshot.messages.filter((message) => !isDisposableShortMessage(message))
    : snapshot.messages;
  const messages: SelectiveExportMessage[] = [];

  for (const message of sourceMessages) {
    const previous = messages[messages.length - 1];
    if (preferences.mergeAdjacentAnswers && previous?.role === "assistant" && message.role === "assistant") {
      previous.text = [previous.text, message.text].filter(Boolean).join("\n\n");
      previous.blocks = [...previous.blocks, ...message.blocks];
      continue;
    }
    messages.push({ ...message, blocks: [...message.blocks] });
  }

  const blockIds = new Set(messages.flatMap((message) => message.blocks.map((block) => block.id)));
  const citations = snapshot.citations.flatMap((citation) => {
    const occurrences = citation.occurrences.filter((occurrence) => blockIds.has(occurrence.blockId));
    const first = occurrences[0];
    if (!first) return [];
    return [{
      ...citation,
      href: first.href,
      messageId: first.messageId,
      blockId: first.blockId,
      excerpt: first.excerpt,
      occurrenceCount: occurrences.length,
      occurrences
    }];
  });
  return {
    ...snapshot,
    messages,
    codeBlocks: snapshot.codeBlocks.filter((block) => blockIds.has(block.id)),
    citations,
    exportPreferences: preferences
  };
}

export function getAllSelectableBlockIds(snapshot: SelectiveExportSnapshot): Set<string> {
  return new Set(snapshot.messages.flatMap((message) => message.blocks.map((block) => block.id)));
}
