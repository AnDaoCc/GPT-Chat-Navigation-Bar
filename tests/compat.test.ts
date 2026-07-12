import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createChatGptAdapter,
  normalizeCompatRulesPayload
} from "../src/chatGptAdapter";

function installDom(html: string) {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/test-conversation" });
  const win = dom.window;
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    Node: win.Node,
    NodeFilter: win.NodeFilter
  });
  Object.defineProperty(win.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: 400,
        width: 800,
        height: 400,
        toJSON() {
          return {};
        }
      };
    }
  });
  return dom;
}

test("healthy built-in rules stay preferred over higher-priority remote rules", () => {
  installDom(`
    <main>
      <article data-testid="conversation-turn-1"><div data-message-author-role="user">Question</div></article>
      <article data-testid="conversation-turn-2"><div data-message-author-role="assistant">Answer</div></article>
    </main>
  `);
  const remote = normalizeCompatRulesPayload({
    schemaVersion: 1,
    rules: [{
      id: "remote-generic",
      priority: 200,
      messageSelectors: ["main article"],
      turnSelectors: ["main article"],
      fallbackRoleByOrder: true
    }]
  });

  const result = createChatGptAdapter(remote).collect();
  assert.equal(result.health.status, "ok");
  assert.equal(result.health.source, "built-in");
  assert.equal(result.messages.length, 2);
});

test("remote rules are selected when built-in rules cannot recognize the page", () => {
  installDom(`
    <main>
      <section class="remote-user">Question</section>
      <section class="remote-assistant">Answer</section>
    </main>
  `);
  const remote = normalizeCompatRulesPayload({
    schemaVersion: 1,
    rules: [{
      id: "remote-current",
      priority: 130,
      messageSelectors: [".remote-user", ".remote-assistant"],
      turnSelectors: [".remote-user", ".remote-assistant"],
      userHints: ["remote-user"],
      assistantHints: ["remote-assistant"]
    }]
  });

  const result = createChatGptAdapter(remote).collect();
  assert.equal(result.health.source, "remote");
  assert.equal(result.health.status, "ok");
  assert.equal(result.health.userCount, 1);
  assert.equal(result.health.assistantCount, 1);
});

test("current adapter recognizes role attributes used by the refreshed ChatGPT DOM", () => {
  installDom(`
    <main id="main">
      <section data-testid="conversation-turn-user" data-turn-id="turn-user" data-turn="user">
        <div class="whitespace-pre-wrap">Question from refreshed UI</div>
      </section>
      <section data-testid="conversation-turn-assistant" data-turn-id="turn-assistant" data-turn="assistant">
        <div class="markdown">Answer from refreshed UI</div>
      </section>
    </main>
  `);

  const result = createChatGptAdapter().collect();
  assert.equal(result.health.status, "ok");
  assert.equal(result.health.ruleId, "chatgpt-current-2026-07");
  assert.deepEqual(result.messages.map((message) => message.role), ["user", "assistant"]);
  assert.deepEqual(result.messages.map((message) => message.text), [
    "Question from refreshed UI",
    "Answer from refreshed UI"
  ]);
});

test("current adapter recognizes nested author markers and message ids", () => {
  installDom(`
    <main id="main">
      <article data-testid="conversation-turn-1">
        <div data-message-id="message-1" data-author="user">Nested question</div>
      </article>
      <article data-testid="conversation-turn-2">
        <div data-message-id="message-2" data-role="assistant">Nested answer</div>
      </article>
    </main>
  `);

  const result = createChatGptAdapter().collect();
  assert.equal(result.health.status, "ok");
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages.map((message) => message.role), ["user", "assistant"]);
});

test("refreshed composer is not mistaken for canvas supplemental content", () => {
  installDom(`
    <main id="main">
      <form class="group/composer">
        <textarea aria-label="Chat with ChatGPT"></textarea>
        <div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox">
          Draft prompt that must stay outside exported conversation content
        </div>
      </form>
    </main>
  `);

  const result = createChatGptAdapter().collect();
  assert.equal(result.messages.length, 0);
  assert.equal(result.supplementalContexts.length, 0);
});

test("invalid remote selectors are rejected", () => {
  installDom("<main></main>");
  const rules = normalizeCompatRulesPayload({
    schemaVersion: 1,
    rules: [{ id: "broken", messageSelectors: ["[broken"], turnSelectors: [] }]
  });
  assert.equal(rules.length, 0);
});

test("canvas supplemental content appears and disappears with the DOM", () => {
  const dom = installDom(`
    <main>
      <article data-testid="conversation-turn-1"><div data-message-author-role="user">Question</div></article>
      <article data-testid="conversation-turn-2"><div data-message-author-role="assistant">Answer</div></article>
      <section data-testid="canvas-panel"><div class="ProseMirror">${"Canvas text ".repeat(30)}</div></section>
    </main>
  `);
  const adapter = createChatGptAdapter();
  assert.ok(adapter.collect().supplementalContexts.some((context) => context.kind === "canvas"));
  dom.window.document.querySelector('[data-testid="canvas-panel"]')?.remove();
  assert.equal(adapter.collect().supplementalContexts.length, 0);
});
