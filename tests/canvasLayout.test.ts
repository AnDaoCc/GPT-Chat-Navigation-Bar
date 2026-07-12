import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  applyCanvasLayoutWidth,
  canvasMutationsRequireSessionRefresh,
  captureCanvasScroll,
  clearCanvasLayoutSession,
  createCanvasLayoutSession,
  isCanvasLayoutSessionConnected,
  markCanvasLayoutSession,
  restoreCanvasScroll,
  shouldApplyCanvasTypography
} from "../src/canvasLayout";

function installDom(html: string) {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/canvas-test" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement
  });
  return dom;
}

function defineDimension(element: HTMLElement, name: "clientHeight" | "scrollHeight", get: () => number) {
  Object.defineProperty(element, name, {
    configurable: true,
    get
  });
}

test("canvas session keeps the same layout target during internal lazy DOM changes", () => {
  installDom(`
    <main>
      <section id="root" data-testid="canvas-panel">
        <div id="scroll" style="overflow-y:auto">
          <div id="layout"><div id="text" class="ProseMirror"><p>Start</p></div></div>
        </div>
      </section>
    </main>
  `);
  const root = document.querySelector<HTMLElement>("#root")!;
  const scroll = document.querySelector<HTMLElement>("#scroll")!;
  const text = document.querySelector<HTMLElement>("#text")!;
  defineDimension(scroll, "clientHeight", () => 200);
  defineDimension(scroll, "scrollHeight", () => 900);

  const session = createCanvasLayoutSession(root, text);
  const initialLayoutTarget = session.layoutTarget;
  const paragraph = document.createElement("p");
  paragraph.textContent = "Lazy content";
  text.appendChild(paragraph);
  paragraph.remove();

  assert.equal(session.layoutTarget, initialLayoutTarget);
  assert.equal(isCanvasLayoutSessionConnected(session), true);

  const result = canvasMutationsRequireSessionRefresh(
    session,
    [{
      type: "childList",
      target: text,
      addedNodes: [paragraph],
      removedNodes: []
    }],
    (element) => element.matches('[data-testid*="canvas"]')
  );
  assert.deepEqual(result, { discover: false, replace: false });
});

test("unrelated page mutations do not trigger canvas discovery", () => {
  installDom("<main><section id=\"ordinary\"></section></main>");
  const ordinary = document.querySelector<HTMLElement>("#ordinary")!;
  const child = document.createElement("p");
  const result = canvasMutationsRequireSessionRefresh(
    null,
    [{
      type: "childList",
      target: ordinary,
      addedNodes: [child],
      removedNodes: []
    }],
    (element) => element.matches('[data-testid*="canvas"]')
  );
  assert.deepEqual(result, { discover: false, replace: false });
});

test("canvas width application is idempotent", () => {
  installDom(`
    <main><section id="root"><div id="layout"><div id="text" class="ProseMirror">Text</div></div></section></main>
  `);
  const session = createCanvasLayoutSession(
    document.querySelector<HTMLElement>("#root")!,
    document.querySelector<HTMLElement>("#text")!
  );

  assert.equal(applyCanvasLayoutWidth(session, 720.2), true);
  assert.equal(applyCanvasLayoutWidth(session, 720.4), false);
  assert.equal(session.layoutTarget.style.getPropertyValue("--cnav-canvas-target-width"), "720px");
});

test("canvas width markers use exact true values and are removed when disabled", () => {
  installDom(`
    <main><section id="root"><div id="layout"><div id="text" class="ProseMirror">Text</div></div></section></main>
  `);
  const session = createCanvasLayoutSession(
    document.querySelector<HTMLElement>("#root")!,
    document.querySelector<HTMLElement>("#text")!
  );

  markCanvasLayoutSession(session, true);
  assert.equal(session.layoutTarget.getAttribute("data-cnav-canvas-width-target"), "true");
  assert.equal(session.layoutTarget.getAttribute("data-cnav-canvas-active-target"), "true");
  assert.equal(session.layoutTarget.matches('[data-cnav-canvas-width-target="true"]'), true);
  assert.equal(session.layoutTarget.matches('[data-cnav-canvas-active-target="true"]'), true);

  markCanvasLayoutSession(session, false);
  assert.equal(session.layoutTarget.hasAttribute("data-cnav-canvas-width-target"), false);
  assert.equal(session.layoutTarget.hasAttribute("data-cnav-canvas-active-target"), false);
});

test("replacing the canvas root cleans the old session and discovers the new root", () => {
  installDom(`
    <main>
      <section id="old" data-testid="canvas-panel"><div id="oldText" class="ProseMirror">Old</div></section>
      <section id="host"></section>
    </main>
  `);
  const oldRoot = document.querySelector<HTMLElement>("#old")!;
  const oldSession = createCanvasLayoutSession(
    oldRoot,
    document.querySelector<HTMLElement>("#oldText")!
  );
  markCanvasLayoutSession(oldSession, true);
  const replacement = document.createElement("section");
  replacement.setAttribute("data-testid", "canvas-panel-new");
  replacement.innerHTML = '<div class="ProseMirror">New</div>';

  const result = canvasMutationsRequireSessionRefresh(
    oldSession,
    [{
      type: "childList",
      target: document.querySelector<HTMLElement>("main")!,
      addedNodes: [replacement],
      removedNodes: [oldRoot]
    }],
    (element) =>
      element.matches('[data-testid*="canvas"]') ||
      Boolean(element.querySelector('[data-testid*="canvas"]'))
  );
  assert.deepEqual(result, { discover: true, replace: true });

  clearCanvasLayoutSession(oldSession);
  assert.equal(oldRoot.hasAttribute("data-cnav-canvas-root"), false);
  assert.equal(oldSession.layoutTarget.style.getPropertyValue("--cnav-canvas-target-width"), "");
});

test("document canvas accepts typography while virtualized code canvas keeps native metrics", () => {
  installDom(`
    <main>
      <section id="document"><div id="documentText" class="ProseMirror">Document</div></section>
      <section id="code"><div class="cm-editor"><div id="codeText" class="cm-content">Code</div></div></section>
    </main>
  `);
  const documentSession = createCanvasLayoutSession(
    document.querySelector<HTMLElement>("#document")!,
    document.querySelector<HTMLElement>("#documentText")!
  );
  const codeSession = createCanvasLayoutSession(
    document.querySelector<HTMLElement>("#code")!,
    document.querySelector<HTMLElement>("#codeText")!
  );

  assert.equal(documentSession.kind, "document");
  assert.equal(shouldApplyCanvasTypography(documentSession), true);
  assert.equal(codeSession.kind, "virtualized-code");
  assert.equal(shouldApplyCanvasTypography(codeSession), false);
});

test("scroll restoration preserves middle position and bottom anchoring", () => {
  installDom(`
    <main>
      <section id="root"><div id="scroll" style="overflow-y:auto"><div id="text" class="ProseMirror">Text</div></div></section>
    </main>
  `);
  const root = document.querySelector<HTMLElement>("#root")!;
  const scroll = document.querySelector<HTMLElement>("#scroll")!;
  const text = document.querySelector<HTMLElement>("#text")!;
  let scrollHeight = 1000;
  defineDimension(scroll, "clientHeight", () => 200);
  defineDimension(scroll, "scrollHeight", () => scrollHeight);
  const session = createCanvasLayoutSession(root, text);

  scroll.scrollTop = 420;
  const middle = captureCanvasScroll(session);
  scrollHeight = 1300;
  scroll.scrollTop = 180;
  restoreCanvasScroll(middle);
  assert.equal(scroll.scrollTop, 420);

  scroll.scrollTop = 1100;
  const bottom = captureCanvasScroll(session);
  scrollHeight = 1500;
  scroll.scrollTop = 600;
  restoreCanvasScroll(bottom);
  assert.equal(scroll.scrollTop, 1300);
});
