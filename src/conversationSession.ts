export function buildConversationSessionId(
  hostname: string,
  conversationId: string | null,
  tabSessionId: string,
  generation: number
): string {
  const safeGeneration = Math.max(0, Math.trunc(generation));
  return conversationId
    ? `${hostname}:conversation:${conversationId}:epoch:${safeGeneration}`
    : `${hostname}:session:${tabSessionId}:epoch:${safeGeneration}`;
}

export function hasConversationPromptOverlap(
  previousPrompts: Iterable<string>,
  currentPrompts: Iterable<string>
): boolean {
  const current = new Set(currentPrompts);
  for (const prompt of previousPrompts) {
    if (current.has(prompt)) {
      return true;
    }
  }
  return false;
}

export function buildConversationStorageKey(
  hostname: string,
  conversationId: string | null,
  tabSessionId: string
): string {
  return conversationId
    ? `${hostname}:conversation:${conversationId}`
    : `${hostname}:session:${tabSessionId}`;
}
