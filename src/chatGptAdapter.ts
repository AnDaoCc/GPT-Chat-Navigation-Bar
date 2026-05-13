export type AdapterRole = "user" | "assistant";
export type SiteId = "chatgpt";
export type AdapterHealthStatus = "ok" | "degraded" | "unsupported";
export type CompatRulesSource = "built-in" | "remote";

export interface ParsedMessage {
  role: AdapterRole;
  element: HTMLElement;
  text: string;
}

export interface SupplementalContext {
  kind: "canvas" | "file";
  element: HTMLElement;
  text: string;
}

export interface AdapterHealth {
  status: AdapterHealthStatus;
  reason: string;
  ruleId: string;
  messageCount: number;
  userCount: number;
  assistantCount: number;
  canAnchor: boolean;
  tokenTextAvailable: boolean;
  source: CompatRulesSource;
}

export interface ChatGptDomRule {
  id: string;
  label: string;
  priority: number;
  source: CompatRulesSource;
  messageSelectors: string[];
  turnSelectors: string[];
  modelSelectors: string[];
  supplementalSelectors: string[];
  supplementalExcludeSelectors: string[];
  textControlSelectors: string[];
  textIgnoredSelectors: string[];
  userHints: string[];
  assistantHints: string[];
  fallbackRoleByOrder?: boolean;
}

export interface ChatGptCompatRulesPayload {
  schemaVersion: 1;
  rules: Partial<ChatGptDomRule>[];
}

export interface ChatGptCollectResult {
  messages: ParsedMessage[];
  supplementalContexts: SupplementalContext[];
  health: AdapterHealth;
}

export interface ChatGptAdapter {
  id: SiteId;
  label: string;
  matches: (host: string) => boolean;
  collect: () => ChatGptCollectResult;
  detectModelLabel: () => string;
}

const ROOT_ID = "conversation-navigator-root";
const CHATGPT_HOSTS = new Set(["chat.openai.com", "chatgpt.com"]);
const SUPPLEMENTAL_CONTEXT_LIMIT = 8;
const SUPPLEMENTAL_CANDIDATE_LIMIT = 80;
const SUPPLEMENTAL_TEXT_LIMIT = 60000;

export const CHATGPT_COMPAT_RULES_URL =
  "https://raw.githubusercontent.com/AnDaoCc/GPT-Chat-Navigation-Bar/main/compat/chatgpt-dom-rules.json";

const DEFAULT_TEXT_CONTROL_SELECTORS = [
  "button",
  '[role="button"]',
  '[role="menuitem"]',
  "select",
  "textarea",
  "input",
  "option"
];

const DEFAULT_TEXT_IGNORED_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "menu",
  '[role="menu"]',
  '[role="toolbar"]',
  "[hidden]",
  '[aria-hidden="true"]',
  '[data-testid*="copy" i]',
  '[data-testid*="clipboard" i]',
  '[data-testid*="action" i]',
  '[data-testid*="toolbar" i]',
  '[class*="copy" i]',
  '[class*="toolbar" i]'
];

const CURRENT_CHATGPT_RULE: ChatGptDomRule = {
  id: "chatgpt-current-2026",
  label: "ChatGPT current DOM",
  priority: 100,
  source: "built-in",
  messageSelectors: [
    '[data-message-author-role="user"]',
    '[data-message-author-role="assistant"]'
  ],
  turnSelectors: [
    'article[data-testid^="conversation-turn"]',
    '[data-testid^="conversation-turn"]'
  ],
  modelSelectors: [
    '[data-testid*="model" i]',
    '[aria-label*="model" i]',
    '[aria-label*="GPT" i]',
    "main form button",
    "form button",
    "header button",
    "button",
    '[role="button"]'
  ],
  supplementalSelectors: [
    '[data-testid*="canvas" i]',
    '[data-testid*="artifact" i]',
    '[data-testid*="document" i]',
    '[data-testid*="attachment" i]',
    '[data-testid*="file" i]',
    '[data-testid*="image" i]',
    '[data-testid*="media" i]',
    '[data-testid*="picture" i]',
    '[aria-label*="canvas" i]',
    '[aria-label*="artifact" i]',
    '[aria-label*="document" i]',
    '[aria-label*="attachment" i]',
    '[aria-label*="file" i]',
    '[aria-label*="image" i]',
    '[aria-label*="picture" i]',
    '[aria-label*="画布" i]',
    '[aria-label*="文档" i]',
    '[aria-label*="附件" i]',
    '[aria-label*="文件" i]',
    '[aria-label*="图片" i]',
    '[aria-label*="圖片" i]',
    '[class*="canvas" i]',
    '[class*="artifact" i]',
    '[class*="document" i]',
    '[class*="attachment" i]',
    '[class*="generated-image" i]',
    '[class*="image" i]',
    '[class*="textLayer" i]',
    ".ProseMirror",
    ".cm-content",
    ".monaco-editor",
    '[contenteditable="true"]',
    "[data-page-number]"
  ],
  supplementalExcludeSelectors: [
    `#${ROOT_ID}`,
    'article[data-testid^="conversation-turn"]',
    '[data-testid^="conversation-turn"]',
    '[data-message-author-role]',
    '[data-testid*="composer" i]',
    '[aria-label*="composer" i]',
    '[aria-label*="输入" i]',
    '[aria-label*="發送訊息" i]',
    '[aria-label*="发送消息" i]',
    "form"
  ],
  textControlSelectors: DEFAULT_TEXT_CONTROL_SELECTORS,
  textIgnoredSelectors: DEFAULT_TEXT_IGNORED_SELECTORS,
  userHints: ["user", "human", "prompt", "query", "request"],
  assistantHints: ["assistant", "model", "response", "answer", "chatgpt"],
  fallbackRoleByOrder: true
};

const GENERIC_CHATGPT_RULE: ChatGptDomRule = {
  ...CURRENT_CHATGPT_RULE,
  id: "chatgpt-generic-visible-text",
  label: "Generic visible text fallback",
  priority: 10,
  messageSelectors: [],
  turnSelectors: [
    "main article",
    "main [role='article']",
    'main [data-testid*="turn" i]',
    'main [data-testid*="conversation" i]',
    'main [class*="message" i]'
  ],
  fallbackRoleByOrder: true
};

export const BUILT_IN_CHATGPT_RULES: ChatGptDomRule[] = [
  CURRENT_CHATGPT_RULE,
  GENERIC_CHATGPT_RULE
];

export function createDefaultAdapterHealth(reason = "Waiting for ChatGPT page structure."): AdapterHealth {
  return {
    status: "unsupported",
    reason,
    ruleId: "none",
    messageCount: 0,
    userCount: 0,
    assistantCount: 0,
    canAnchor: false,
    tokenTextAvailable: false,
    source: "built-in"
  };
}

export function normalizeCompatRulesPayload(value: unknown): ChatGptDomRule[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const payload = value as Partial<ChatGptCompatRulesPayload>;
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.rules)) {
    return [];
  }

  return payload.rules
    .map((rule, index) => normalizeRemoteRule(rule, index))
    .filter((rule): rule is ChatGptDomRule => Boolean(rule));
}

export function createChatGptAdapter(remoteRules: ChatGptDomRule[] = []): ChatGptAdapter {
  const rules = getOrderedRules(remoteRules);

  return {
    id: "chatgpt",
    label: "ChatGPT",
    matches: (host) => CHATGPT_HOSTS.has(host),
    collect: () => collectWithRules(rules),
    detectModelLabel: () => detectModelLabelWithRules(rules)
  };
}

function normalizeRemoteRule(rule: Partial<ChatGptDomRule>, index: number): ChatGptDomRule | null {
  const id = sanitizeRuleId(rule.id) || `remote-rule-${index + 1}`;
  const messageSelectors = sanitizeSelectors(rule.messageSelectors);
  const turnSelectors = sanitizeSelectors(rule.turnSelectors);

  if (messageSelectors.length === 0 && turnSelectors.length === 0) {
    return null;
  }

  return {
    id,
    label: typeof rule.label === "string" && rule.label.trim() ? rule.label.trim().slice(0, 80) : id,
    priority: clampNumber(rule.priority, 20, 200, 120),
    source: "remote",
    messageSelectors: messageSelectors.length ? messageSelectors : CURRENT_CHATGPT_RULE.messageSelectors,
    turnSelectors: turnSelectors.length ? turnSelectors : CURRENT_CHATGPT_RULE.turnSelectors,
    modelSelectors: sanitizeSelectors(rule.modelSelectors, CURRENT_CHATGPT_RULE.modelSelectors),
    supplementalSelectors: sanitizeSelectors(rule.supplementalSelectors, CURRENT_CHATGPT_RULE.supplementalSelectors),
    supplementalExcludeSelectors: sanitizeSelectors(
      rule.supplementalExcludeSelectors,
      CURRENT_CHATGPT_RULE.supplementalExcludeSelectors
    ),
    textControlSelectors: sanitizeSelectors(rule.textControlSelectors, DEFAULT_TEXT_CONTROL_SELECTORS),
    textIgnoredSelectors: sanitizeSelectors(rule.textIgnoredSelectors, DEFAULT_TEXT_IGNORED_SELECTORS),
    userHints: sanitizeHints(rule.userHints, CURRENT_CHATGPT_RULE.userHints),
    assistantHints: sanitizeHints(rule.assistantHints, CURRENT_CHATGPT_RULE.assistantHints),
    fallbackRoleByOrder: Boolean(rule.fallbackRoleByOrder)
  };
}

function getOrderedRules(remoteRules: ChatGptDomRule[]): ChatGptDomRule[] {
  return [...remoteRules, ...BUILT_IN_CHATGPT_RULES]
    .map((rule) => ({ ...rule }))
    .sort((a, b) => b.priority - a.priority);
}

function collectWithRules(rules: ChatGptDomRule[]): ChatGptCollectResult {
  let best: InternalCollectResult | null = null;
  const results: InternalCollectResult[] = [];

  for (const rule of rules) {
    const result = collectMessagesByRule(rule);
    if (result.messages.length === 0) {
      continue;
    }

    results.push(result);
    if (!best || getCollectScore(result) > getCollectScore(best)) {
      best = result;
    }
  }

  if (!best) {
    return {
      messages: [],
      supplementalContexts: [],
      health: createDefaultAdapterHealth("No visible ChatGPT conversation messages were recognized.")
    };
  }

  const merged = mergeCollectResults(best, results);
  const supplementalContexts = safeCollectSupplementalContexts(createSupplementalRule(best.rule, rules));
  const health = createHealth(merged, supplementalContexts);
  return {
    messages: merged.messages,
    supplementalContexts,
    health
  };
}

interface InternalCollectResult {
  rule: ChatGptDomRule;
  messages: ParsedMessage[];
  userCount: number;
  assistantCount: number;
  usedFallbackRoles: boolean;
}

function createSupplementalRule(base: ChatGptDomRule, rules: ChatGptDomRule[]): ChatGptDomRule {
  return {
    ...base,
    supplementalSelectors: uniqueStrings(rules.flatMap((rule) => rule.supplementalSelectors)),
    supplementalExcludeSelectors: uniqueStrings(rules.flatMap((rule) => rule.supplementalExcludeSelectors)),
    textControlSelectors: uniqueStrings(rules.flatMap((rule) => rule.textControlSelectors)),
    textIgnoredSelectors: uniqueStrings(rules.flatMap((rule) => rule.textIgnoredSelectors))
  };
}

function collectMessagesByRule(rule: ChatGptDomRule): InternalCollectResult {
  const messages: ParsedMessage[] = [];
  const usedRoots = new Set<HTMLElement>();
  let usedFallbackRoles = false;

  for (const selector of rule.messageSelectors) {
    for (const roleNode of safeQueryAll(selector)) {
      const role = inferRole(roleNode, rule);
      if (!role) {
        continue;
      }

      const root = getMessageRoot(roleNode, rule);
      const text =
        extractVisibleText(roleNode, rule) ||
        extractVisibleText(root, rule) ||
        inferNonTextMessageLabel(roleNode) ||
        inferNonTextMessageLabel(root);
      if (text) {
        messages.push({ role, element: role === "user" ? root : roleNode, text });
        usedRoots.add(root);
      }
    }
  }

  for (const selector of rule.turnSelectors) {
    const articles = sortElementsByDomOrder(uniqueElements(safeQueryAll(selector)));
    for (let index = 0; index < articles.length; index += 1) {
      const article = articles[index];
      if (usedRoots.has(article) || article.closest(`#${ROOT_ID}`)) {
        continue;
      }

      const inferredRole = inferRole(article, rule);
      const fallbackRole =
        rule.fallbackRoleByOrder && !inferredRole && isLikelyFallbackTurnCandidate(article)
          ? inferFallbackRole(article, index)
          : null;
      const role = inferredRole ?? fallbackRole;
      const text = extractVisibleText(article, rule) || (role ? inferNonTextMessageLabel(article) : "");
      if (role && text && text.length >= 2) {
        messages.push({ role, element: article, text });
        usedRoots.add(article);
        if (fallbackRole) {
          usedFallbackRoles = true;
        }
      }
    }
  }

  const compacted = compactMessages(messages);
  return {
    rule,
    messages: compacted,
    userCount: compacted.filter((message) => message.role === "user").length,
    assistantCount: compacted.filter((message) => message.role === "assistant").length,
    usedFallbackRoles
  };
}

function mergeCollectResults(base: InternalCollectResult, results: InternalCollectResult[]): InternalCollectResult {
  const messages = [...base.messages];
  let usedFallbackRoles = base.usedFallbackRoles;

  for (const result of results) {
    for (const message of result.messages) {
      if (messages.some((existing) => isDuplicateMessage(existing, message))) {
        continue;
      }

      if (hasConflictingNestedRole(message, messages)) {
        continue;
      }

      const overlapsExisting = messages.some((existing) => isNestedElement(existing.element, message.element));
      if (result.rule === base.rule || isVisualMessage(message) || (!overlapsExisting && hasExplicitRoleMarker(message.element))) {
        messages.push(message);
        usedFallbackRoles = usedFallbackRoles || result.usedFallbackRoles;
      }
    }
  }

  const compacted = compactMessages(messages);
  return {
    ...base,
    messages: compacted,
    userCount: compacted.filter((message) => message.role === "user").length,
    assistantCount: compacted.filter((message) => message.role === "assistant").length,
    usedFallbackRoles
  };
}

function inferRoleByTurnOrder(index: number): AdapterRole {
  return index % 2 === 0 ? "user" : "assistant";
}

function inferFallbackRole(element: HTMLElement, index: number): AdapterRole {
  if (hasVisibleMedia(element) && !isLikelyUserMediaElement(element)) {
    return "assistant";
  }

  return inferRoleByTurnOrder(index);
}

function isLikelyUserMediaElement(element: HTMLElement): boolean {
  const descriptor = getElementDescriptor(element);
  return /(uploaded|upload|composer|prompt|user|human|attachment|file|document|附件|上传|上傳|文件|檔案|文档)/i.test(descriptor);
}

function isLikelyFallbackTurnCandidate(element: HTMLElement): boolean {
  if (element.closest(`#${ROOT_ID}`)) {
    return false;
  }

  const descriptor = getElementDescriptor(element);

  const mediaLike = /(image|img|picture|gallery|media|thumbnail|attachment|file|artifact|canvas|dall|生成图片|圖片|图片|附件|文件|檔案|画布|畫布)/i.test(descriptor);
  const strongConversationMarker = /(conversation-turn|data-message|message-author|chat-message|\bmessage\b|\bturn\b)/i.test(descriptor);
  if (mediaLike && !strongConversationMarker) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 220 || rect.height < 32) {
    return false;
  }

  const text = normalizeText(element.innerText || "");
  const hasMedia = hasVisibleMedia(element);
  if (text.length < 8 && !(strongConversationMarker && hasMedia)) {
    return false;
  }

  const controlCount = element.querySelectorAll("button, [role='button'], input, textarea, select").length;
  const imageCount = element.querySelectorAll("img, picture, canvas, video, svg").length;
  if (imageCount > 0 && !strongConversationMarker && text.length < 160) {
    return false;
  }

  if (imageCount > 0 && controlCount >= 2 && text.length < 80) {
    return false;
  }

  const mainArticle = element.matches("main article, main [role='article']");
  return strongConversationMarker || (mainArticle && text.length >= 20 && imageCount <= 1);
}

function inferNonTextMessageLabel(element: HTMLElement): string {
  const descriptor = getElementDescriptor(element);

  if (/(canvas|artifact|画布|畫布)/i.test(descriptor)) {
    return "画布内容";
  }

  if (/(attachment|file|document|upload|附件|文件|檔案|文档|文件)/i.test(descriptor)) {
    return "附件内容";
  }

  if (hasVisibleMedia(element)) {
    return "图片内容";
  }

  return "";
}

function hasVisibleMedia(element: HTMLElement): boolean {
  const candidates = [
    element.matches("img, picture, canvas, video") ? element : null,
    ...Array.from(element.querySelectorAll<HTMLElement>("img, picture, canvas, video"))
  ].filter((candidate): candidate is HTMLElement => Boolean(candidate));

  return candidates.some((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width >= 24 && rect.height >= 24;
  });
}

function isVisualMessage(message: ParsedMessage): boolean {
  return hasVisibleMedia(message.element) || Boolean(inferNonTextMessageLabel(message.element));
}

function hasExplicitRoleMarker(element: HTMLElement): boolean {
  return Boolean(element.closest("[data-message-author-role]") || element.querySelector("[data-message-author-role]"));
}

function isDuplicateMessage(existing: ParsedMessage, candidate: ParsedMessage): boolean {
  if (existing.element === candidate.element) {
    return true;
  }

  if (!isNestedElement(existing.element, candidate.element)) {
    return false;
  }

  if (existing.role !== candidate.role) {
    return false;
  }

  return (
    existing.text === candidate.text ||
    existing.text.includes(candidate.text) ||
    candidate.text.includes(existing.text) ||
    isVisualMessage(existing) ||
    isVisualMessage(candidate)
  );
}

function hasConflictingNestedRole(candidate: ParsedMessage, messages: ParsedMessage[]): boolean {
  return messages.some((existing) => isNestedElement(existing.element, candidate.element) && existing.role !== candidate.role);
}

function isNestedElement(first: HTMLElement, second: HTMLElement): boolean {
  return first === second || first.contains(second) || second.contains(first);
}

function getCollectScore(result: InternalCollectResult): number {
  return (
    result.rule.priority * 4 +
    result.messages.length * 4 +
    result.userCount * 8 +
    result.assistantCount * 6 -
    (result.usedFallbackRoles ? 12 : 0)
  );
}

function createHealth(result: InternalCollectResult, supplementalContexts: SupplementalContext[]): AdapterHealth {
  const canAnchor = result.messages.every((message) => message.element instanceof HTMLElement);
  const tokenTextAvailable = result.messages.some((message) => message.text.length > 0) ||
    supplementalContexts.some((context) => context.text.length > 0);
  const missingRole = result.userCount === 0 || result.assistantCount === 0;
  const builtInFallback = result.rule.source === "built-in" && result.rule.id !== CURRENT_CHATGPT_RULE.id;
  const degraded = result.usedFallbackRoles || missingRole || builtInFallback;

  return {
    status: degraded ? "degraded" : "ok",
    reason: degraded
      ? getDegradedReason(result)
      : "ChatGPT page structure is recognized.",
    ruleId: result.rule.id,
    messageCount: result.messages.length,
    userCount: result.userCount,
    assistantCount: result.assistantCount,
    canAnchor,
    tokenTextAvailable,
    source: result.rule.source
  };
}

function getDegradedReason(result: InternalCollectResult): string {
  if (result.usedFallbackRoles) {
    return "Using generic visible-text fallback because exact ChatGPT role markers were not fully recognized.";
  }

  if (result.userCount === 0 || result.assistantCount === 0) {
    return "Messages were found, but user and assistant roles were not both recognized.";
  }

  if (result.rule.source === "remote") {
    return "Using remote ChatGPT compatibility rule.";
  }

  return "Using a fallback ChatGPT compatibility rule.";
}

function getMessageRoot(element: HTMLElement, rule: ChatGptDomRule): HTMLElement {
  for (const selector of rule.turnSelectors) {
    const root = element.closest<HTMLElement>(selector);
    if (root) {
      return root;
    }
  }

  return element;
}

function inferRole(element: HTMLElement, rule: ChatGptDomRule): AdapterRole | null {
  const explicitRole = element.getAttribute("data-message-author-role");
  if (explicitRole === "user" || explicitRole === "assistant") {
    return explicitRole;
  }

  const descriptor = getElementDescriptor(element);

  if (rule.userHints.some((hint) => descriptor.includes(hint.toLowerCase()))) {
    return "user";
  }

  if (rule.assistantHints.some((hint) => descriptor.includes(hint.toLowerCase()))) {
    return "assistant";
  }

  return null;
}

function getElementDescriptor(element: HTMLElement): string {
  return [
    element.tagName,
    element.id,
    element.className,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("alt"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-test-id"),
    element.getAttribute("role")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compactMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const compacted: ParsedMessage[] = [];

  for (const message of sortByDomOrder(messages).map((message) => ({
      ...message,
      text: normalizeText(message.text)
    }))) {
    if (!message.text || message.text.length < 2 || !document.body.contains(message.element)) {
      continue;
    }

    const duplicate = compacted.some((existing) => {
      if (existing.role !== message.role) {
        return false;
      }

      if (existing.element === message.element) {
        return true;
      }

      const nested = existing.element.contains(message.element) || message.element.contains(existing.element);
      if (!nested) {
        return false;
      }

      return existing.text === message.text || existing.text.includes(message.text) || message.text.includes(existing.text);
    });

    if (!duplicate) {
      compacted.push(message);
    }
  }

  return compacted;
}

function safeCollectSupplementalContexts(rule: ChatGptDomRule): SupplementalContext[] {
  try {
    return collectSupplementalContexts(rule);
  } catch {
    return [];
  }
}

function collectSupplementalContexts(rule: ChatGptDomRule): SupplementalContext[] {
  const contexts: SupplementalContext[] = [];

  for (const selector of rule.supplementalSelectors) {
    for (const element of safeQueryAll(selector).slice(0, SUPPLEMENTAL_CANDIDATE_LIMIT)) {
      if (!isSupplementalContextCandidate(element, rule)) {
        continue;
      }

      const text = extractVisibleText(element, rule, SUPPLEMENTAL_TEXT_LIMIT) || inferNonTextMessageLabel(element);
      if (!text || /^(copy|copied|download|open|close|share|复制|已复制|下载|打开|关闭|分享)$/i.test(text)) {
        continue;
      }

      contexts.push({
        kind: inferSupplementalContextKind(element),
        element,
        text
      });
    }
  }

  return compactSupplementalContexts(contexts).slice(0, SUPPLEMENTAL_CONTEXT_LIMIT);
}

function isSupplementalContextCandidate(element: HTMLElement, rule: ChatGptDomRule): boolean {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "html" || tagName === "body" || tagName === "main") {
    return false;
  }

  if (!isVisibleElement(element) || rule.supplementalExcludeSelectors.some((selector) => Boolean(element.closest(selector)))) {
    return false;
  }

  if (!element.closest("main")) {
    return false;
  }

  if (isLikelyControlOnlyElement(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width >= 40 && rect.height >= 12;
}

function isLikelyContentCard(element: HTMLElement): boolean {
  const descriptor = getElementDescriptor(element);
  const contentLike = /(image|picture|media|canvas|artifact|attachment|file|document|upload|图片|圖片|画布|畫布|附件|文件|檔案|文档)/i.test(descriptor);
  const actionOnly = /(copy|copied|download|open|close|share|menu|toolbar|action|more|复制|已复制|下载|打开|关闭|分享|更多)/i.test(descriptor);
  if (!contentLike || actionOnly) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width >= 80 && rect.height >= 28;
}

function isLikelyControlOnlyElement(element: HTMLElement): boolean {
  const descriptor = getElementDescriptor(element);
  if (/(copy|copied|download|open|close|share|menu|toolbar|action|more|复制|已复制|下载|打开|关闭|分享|更多)/i.test(descriptor)) {
    return true;
  }

  return element.matches("button, [role='button']") && !isLikelyContentCard(element);
}

function inferSupplementalContextKind(element: HTMLElement): SupplementalContext["kind"] {
  const descriptor = getElementDescriptor(element);

  return /(canvas|artifact|画布|prosemirror|cm-content|monaco)/i.test(descriptor) ? "canvas" : "file";
}

function compactSupplementalContexts(contexts: SupplementalContext[]): SupplementalContext[] {
  const compacted: SupplementalContext[] = [];
  const seenText = new Set<string>();

  for (const context of sortByDomOrder(contexts).map((context) => ({
      ...context,
      text: normalizeText(context.text)
    }))) {
    if (!context.text || context.text.length < 4 || !document.body.contains(context.element)) {
      continue;
    }

    const textKey = stableHash(`${context.kind}:${context.text}`);
    if (seenText.has(textKey)) {
      continue;
    }

    let shouldAdd = true;
    for (let index = 0; index < compacted.length; index += 1) {
      const existing = compacted[index];
      const nested = existing.element.contains(context.element) || context.element.contains(existing.element);
      const overlappingText =
        existing.text === context.text || existing.text.includes(context.text) || context.text.includes(existing.text);

      if (!nested && !overlappingText) {
        continue;
      }

      if (context.text.length > existing.text.length && context.element.contains(existing.element)) {
        compacted[index] = context;
      }

      shouldAdd = false;
      break;
    }

    if (shouldAdd) {
      compacted.push(context);
      seenText.add(textKey);
    }
  }

  return compacted;
}

function detectModelLabelWithRules(rules: ChatGptDomRule[]): string {
  let best: { label: string; score: number } | null = null;
  const selectors = uniqueStrings(rules.flatMap((rule) => rule.modelSelectors));

  for (const selector of selectors) {
    for (const element of safeQueryAll(selector)) {
      if (!isVisibleElement(element) || element.closest(`#${ROOT_ID}`)) {
        continue;
      }

      const textValues = [
        element.innerText,
        element.getAttribute("aria-label"),
        element.getAttribute("title")
      ].filter(Boolean) as string[];

      for (const rawText of textValues) {
        const label = normalizeDetectedChatGptModelLabel(rawText);
        if (!label) {
          continue;
        }

        const rawNormalized = normalizeText(rawText);
        const modelishAttributes = `${element.getAttribute("data-testid") || ""} ${element.getAttribute("aria-label") || ""}`;
        if (/^Pro$/i.test(rawNormalized) && !element.closest("form, main") && !/model|gpt/i.test(modelishAttributes)) {
          continue;
        }

        const score = scoreModelCandidate(element, label, rawText);
        if (!best || score > best.score) {
          best = { label, score };
        }
      }
    }
  }

  return best?.label ?? "";
}

function normalizeDetectedChatGptModelLabel(value: string): string {
  const text = normalizeText(value)
    .replace(/\b(current model|selected model|model selector|选择模型|当前模型)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = text.match(/\b(?:GPT\s*[- ]?\s*\d+(?:\.\d+)?|gpt\s*[- ]?\s*\d+(?:\.\d+)?|o\d(?:\s*[- ]?\s*mini)?)(?:\s*[- ]?\s*(?:Instant|Thinking|Pro|Mini|Nano|Chat))?\b/i);
  if (!match?.[0]) {
    return "";
  }

  return match[0]
    .replace(/\s+/g, " ")
    .replace(/\bgpt\b/i, "GPT")
    .replace(/\bo(\d)/i, "o$1")
    .replace(/\binstant\b/i, "Instant")
    .replace(/\bthinking\b/i, "Thinking")
    .replace(/\bpro\b/i, "Pro")
    .replace(/\bmini\b/i, "Mini")
    .replace(/\bnano\b/i, "Nano")
    .replace(/\bchat\b/i, "Chat")
    .trim();
}

function scoreModelCandidate(element: HTMLElement, normalizedLabel: string, rawText: string): number {
  const text = normalizeText(rawText);
  let score = 0;
  if (/gpt|model/i.test(`${element.getAttribute("data-testid") || ""} ${element.getAttribute("aria-label") || ""}`)) {
    score += 18;
  }
  if (text.length <= 40) {
    score += 10;
  }
  if (element.closest("form, main")) {
    score += 12;
  }
  if (element.matches("button, [role='button']")) {
    score += 8;
  }
  if (/Thinking|Pro/.test(normalizedLabel)) {
    score += 6;
  }

  return score - Math.max(0, text.length - 32);
}

function extractVisibleText(
  element: HTMLElement,
  rule: ChatGptDomRule,
  maxCharacters = Number.POSITIVE_INFINITY
): string {
  const parts: string[] = [];
  let length = 0;
  const controlSelector = joinSelectors(rule.textControlSelectors);
  const ignoredSelector = joinSelectors(rule.textIgnoredSelectors);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      const text = node.nodeValue?.trim();

      if (!parent || !text || parent.closest(`#${ROOT_ID}`)) {
        return NodeFilter.FILTER_REJECT;
      }

      const control = parent.closest(controlSelector);
      if (control && element.contains(control) && !isLikelyContentCard(control as HTMLElement)) {
        return NodeFilter.FILTER_REJECT;
      }

      const ignoredContainer = parent.closest(ignoredSelector);
      if (ignoredContainer && element.contains(ignoredContainer)) {
        return NodeFilter.FILTER_REJECT;
      }

      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue;
    if (text) {
      const available = maxCharacters - length;
      if (available <= 0) {
        break;
      }

      const nextText = text.length > available ? text.slice(0, available) : text;
      parts.push(nextText);
      length += nextText.length;
    }
  }

  return normalizeText(parts.join(" "));
}

function isVisibleElement(element: HTMLElement): boolean {
  if (element.closest(`#${ROOT_ID}`)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function safeQueryAll(selector: string, root: ParentNode = document): HTMLElement[] {
  try {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
  } catch {
    return [];
  }
}

function sortByDomOrder<T extends { element: HTMLElement }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.element === b.element) {
      return 0;
    }

    const position = a.element.compareDocumentPosition(b.element);
    return position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  });
}

function sortElementsByDomOrder(elements: HTMLElement[]): HTMLElement[] {
  return [...elements].sort((a, b) => {
    if (a === b) {
      return 0;
    }

    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
  });
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return Array.from(new Set(elements));
}

function normalizeText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(You said:|ChatGPT said:|User:|Assistant:|Model:)\s*/i, "")
    .trim();
}

function joinSelectors(selectors: string[]): string {
  return selectors.length ? selectors.join(",") : "*";
}

function sanitizeRuleId(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 80)
    : "";
}

function sanitizeSelectors(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const selectors = value
    .filter((selector): selector is string => typeof selector === "string")
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && selector.length < 240)
    .filter(isValidSelector);

  return selectors.length ? uniqueStrings(selectors) : fallback;
}

function sanitizeHints(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const hints = value
    .filter((hint): hint is string => typeof hint === "string")
    .map((hint) => hint.trim().toLowerCase())
    .filter((hint) => hint.length > 0 && hint.length < 48);

  return hints.length ? uniqueStrings(hints) : fallback;
}

function isValidSelector(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}
