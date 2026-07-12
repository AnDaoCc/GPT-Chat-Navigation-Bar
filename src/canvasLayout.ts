export type CanvasKind = "document" | "virtualized-code";

export interface CanvasLayoutSession {
  root: HTMLElement;
  textRoot: HTMLElement;
  layoutTarget: HTMLElement;
  scrollContainer: HTMLElement | null;
  kind: CanvasKind;
  lastWidthPixels: number | null;
}

export interface CanvasScrollSnapshot {
  element: HTMLElement;
  scrollTop: number;
  distanceFromBottom: number;
  stickToBottom: boolean;
}

export interface CanvasMutationLike {
  type: string;
  target: Node;
  addedNodes: Iterable<Node>;
  removedNodes: Iterable<Node>;
}

const VIRTUALIZED_CODE_SELECTOR = [
  ".monaco-editor",
  ".view-lines",
  ".view-line",
  ".cm-editor",
  ".cm-scroller",
  ".cm-content"
].join(",");

function canHostLayout(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.display !== "contents" &&
    style.visibility !== "hidden" &&
    !/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`)
  );
}

export function isVirtualizedCodeCanvas(root: HTMLElement, textRoot: HTMLElement): boolean {
  return root.matches(VIRTUALIZED_CODE_SELECTOR) ||
    textRoot.matches(VIRTUALIZED_CODE_SELECTOR) ||
    Boolean(root.querySelector(VIRTUALIZED_CODE_SELECTOR));
}

export function detectCanvasKind(root: HTMLElement, textRoot: HTMLElement): CanvasKind {
  return isVirtualizedCodeCanvas(root, textRoot) ? "virtualized-code" : "document";
}

export function shouldApplyCanvasTypography(session: CanvasLayoutSession | null): boolean {
  return session?.kind !== "virtualized-code";
}

export function findCanvasScrollContainer(
  textRoot: HTMLElement,
  _boundary: HTMLElement
): HTMLElement | null {
  for (
    let current: HTMLElement | null = textRoot;
    current && current !== document.body && current !== document.documentElement;
    current = current.parentElement
  ) {
    const style = window.getComputedStyle(current);
    const canScroll = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
    if (canScroll && current.clientHeight > 48) {
      return current;
    }
  }

  return null;
}

export function findCanvasLayoutTarget(
  textRoot: HTMLElement,
  root: HTMLElement,
  scrollContainer: HTMLElement | null
): HTMLElement {
  let candidate = textRoot;
  let current = textRoot.parentElement;

  while (
    current &&
    current !== scrollContainer &&
    current !== document.body &&
    current !== document.documentElement &&
    current.tagName.toLowerCase() !== "main"
  ) {
    if (canHostLayout(current)) {
      candidate = current;
    }
    if (current === root) {
      break;
    }
    current = current.parentElement;
  }

  return candidate;
}

export function createCanvasLayoutSession(
  root: HTMLElement,
  textRoot: HTMLElement
): CanvasLayoutSession {
  const scrollContainer = findCanvasScrollContainer(textRoot, root);
  return {
    root,
    textRoot,
    layoutTarget: findCanvasLayoutTarget(textRoot, root, scrollContainer),
    scrollContainer,
    kind: detectCanvasKind(root, textRoot),
    lastWidthPixels: null
  };
}

export function isCanvasLayoutSessionConnected(
  session: CanvasLayoutSession | null
): session is CanvasLayoutSession {
  return Boolean(
    session &&
    session.root.isConnected &&
    session.textRoot.isConnected &&
    session.layoutTarget.isConnected &&
    (!session.scrollContainer || session.scrollContainer.isConnected)
  );
}

export function captureCanvasScroll(
  session: CanvasLayoutSession | null
): CanvasScrollSnapshot | null {
  const element = session?.scrollContainer;
  if (!element) {
    return null;
  }

  const distanceFromBottom = Math.max(
    0,
    element.scrollHeight - element.clientHeight - element.scrollTop
  );
  return {
    element,
    scrollTop: element.scrollTop,
    distanceFromBottom,
    stickToBottom: distanceFromBottom <= 24
  };
}

export function restoreCanvasScroll(snapshot: CanvasScrollSnapshot | null): void {
  if (!snapshot?.element.isConnected) {
    return;
  }

  const maximum = Math.max(0, snapshot.element.scrollHeight - snapshot.element.clientHeight);
  snapshot.element.scrollTop = snapshot.stickToBottom
    ? maximum
    : Math.min(maximum, Math.max(0, snapshot.scrollTop));
}

export function applyCanvasLayoutWidth(
  session: CanvasLayoutSession,
  widthPixels: number
): boolean {
  const roundedWidth = Math.max(0, Math.round(widthPixels));
  const value = `${roundedWidth}px`;
  if (
    session.lastWidthPixels === roundedWidth &&
    session.layoutTarget.style.getPropertyValue("--cnav-canvas-target-width") === value
  ) {
    return false;
  }

  session.layoutTarget.style.setProperty("--cnav-canvas-target-width", value);
  session.lastWidthPixels = roundedWidth;
  return true;
}

export function clearCanvasLayoutSession(session: CanvasLayoutSession | null): void {
  if (!session) {
    return;
  }

  session.root.removeAttribute("data-cnav-canvas-root");
  session.root.removeAttribute("data-cnav-canvas-kind");
  session.textRoot.removeAttribute("data-cnav-canvas-text-root");
  session.layoutTarget.removeAttribute("data-cnav-canvas-width-target");
  session.layoutTarget.removeAttribute("data-cnav-canvas-active-target");
  session.scrollContainer?.removeAttribute("data-cnav-canvas-scroll-root");
  session.layoutTarget.style.removeProperty("--cnav-canvas-target-width");
  session.lastWidthPixels = null;
}

export function markCanvasLayoutSession(
  session: CanvasLayoutSession,
  widthActive: boolean
): void {
  session.root.setAttribute("data-cnav-canvas-root", "true");
  session.root.setAttribute("data-cnav-canvas-kind", session.kind);
  session.textRoot.setAttribute("data-cnav-canvas-text-root", "true");
  session.scrollContainer?.setAttribute("data-cnav-canvas-scroll-root", "true");
  if (widthActive) {
    session.layoutTarget.setAttribute("data-cnav-canvas-width-target", "true");
    session.layoutTarget.setAttribute("data-cnav-canvas-active-target", "true");
  } else {
    session.layoutTarget.removeAttribute("data-cnav-canvas-width-target");
    session.layoutTarget.removeAttribute("data-cnav-canvas-active-target");
  }
}

export function canvasMutationsRequireSessionRefresh(
  session: CanvasLayoutSession | null,
  mutations: Iterable<CanvasMutationLike>,
  isCanvasCandidate: (element: HTMLElement) => boolean
): { discover: boolean; replace: boolean } {
  let replace = Boolean(session && !isCanvasLayoutSessionConnected(session));
  let discover = false;

  for (const mutation of mutations) {
    const element = mutation.target instanceof HTMLElement
      ? mutation.target
      : mutation.target.parentElement;
    if (!element) {
      continue;
    }

    if (mutation.type === "attributes") {
      if (session && (element === session.root || element === session.layoutTarget)) {
        replace = !session.layoutTarget.isConnected;
      } else if (!session && isCanvasCandidate(element)) {
        discover = true;
      }
      continue;
    }

    for (const node of mutation.removedNodes) {
      if (
        session &&
        node instanceof HTMLElement &&
        (node === session.root || node.contains(session.root))
      ) {
        replace = true;
      }
    }

    for (const node of mutation.addedNodes) {
      if (!(node instanceof HTMLElement) || session?.root.contains(node)) {
        continue;
      }
      if (isCanvasCandidate(node)) {
        replace = Boolean(session);
        discover = true;
      }
    }
  }

  return { discover, replace };
}
