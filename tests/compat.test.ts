import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  CHATGPT_ASSISTANT_MESSAGE_NODE_SELECTOR,
  CHATGPT_MESSAGE_NODE_SELECTOR,
  CHATGPT_USER_MESSAGE_NODE_SELECTOR,
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

test("streaming role selectors match refreshed messages before adapter markers exist", () => {
  installDom(`
    <main id="main">
      <section id="legacy-user" data-message-author-role="user">Legacy user</section>
      <section id="author-role-user" data-author-role="user">Author role user</section>
      <section id="author-assistant" data-author="assistant">Author assistant</section>
      <section id="role-assistant" data-role="assistant">Role assistant</section>
      <section id="turn-assistant" data-turn="assistant">First streaming token</section>
      <section id="testid-assistant" data-testid="assistant-message">Test id assistant</section>
    </main>
  `);

  const userNodes = Array.from(document.querySelectorAll(CHATGPT_USER_MESSAGE_NODE_SELECTOR));
  const assistantNodes = Array.from(document.querySelectorAll(CHATGPT_ASSISTANT_MESSAGE_NODE_SELECTOR));
  const allMessageNodes = Array.from(document.querySelectorAll(CHATGPT_MESSAGE_NODE_SELECTOR));

  assert.deepEqual(userNodes.map((node) => node.id), ["legacy-user", "author-role-user"]);
  assert.deepEqual(assistantNodes.map((node) => node.id), [
    "author-assistant",
    "role-assistant",
    "turn-assistant",
    "testid-assistant"
  ]);
  assert.equal(allMessageNodes.length, 6);
  assert.ok(allMessageNodes.every((node) => !node.hasAttribute("data-cnav-message-role")));
});

test("chat typography applies the configured size directly instead of inheriting ChatGPT defaults", () => {
  const source = readFileSync(new URL("../src/contentScript.tsx", import.meta.url), "utf8");
  const rule = source.match(
    /main \$\{CHATGPT_MESSAGE_STYLE_SELECTOR\} :where\([^}]+\) \{([\s\S]*?)\n    \}/
  );

  assert.ok(rule?.[1], "chat descendant typography rule should exist");
  assert.match(rule[1], /font-size: var\(--cnav-chat-font-size, 1rem\) !important/);
  assert.doesNotMatch(rule[1], /font-size:\s*inherit/);
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

test("schema v2 compatibility rules accept layout anchors and citation selectors", () => {
  installDom("<main></main>");
  const rules = normalizeCompatRulesPayload({
    schemaVersion: 2,
    rules: [{
      id: "v10-layout",
      messageSelectors: ["main article"],
      turnSelectors: ["main article"],
      layoutSelectors: {
        sidebar: ["nav"],
        composer: ["form"],
        header: ["header"]
      },
      citationSelectors: ["a[href^='https://']"]
    }]
  });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].layoutSelectors, { sidebar: ["nav"], composer: ["form"], header: ["header"] });
  assert.deepEqual(rules[0].citationSelectors, ["a[href^='https://']"]);
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
