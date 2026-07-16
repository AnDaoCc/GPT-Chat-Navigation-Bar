import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  applySelectiveExportPreferences,
  buildSelectiveExportSnapshot,
  canonicalizeCitationUrl,
  classifyCitationFetchResponse,
  classifyCitationHttpStatus,
  extractMessageBlocks,
  filterSelectiveSnapshot,
  getAllSelectableBlockIds,
  isPublicCitationUrl,
  isReusableCitationCheckResult,
  ReadingSourceMessage
} from "../src/readingTools";
import { DEFAULT_SELECTIVE_EXPORT_PREFERENCES } from "../src/shared";

function installDom(html: string) {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/reading-tools-test" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    HTMLTableElement: dom.window.HTMLTableElement,
    HTMLAnchorElement: dom.window.HTMLAnchorElement
  });
  return dom;
}

function sourceMessage(id: string, role: "user" | "assistant", element: HTMLElement, turnIndex = 1): ReadingSourceMessage {
  return { id, role, element, text: element.textContent || "", turnIndex };
}

test("message blocks keep stable ids when the streaming tail grows", () => {
  installDom(`<article id="message"><h2>Heading</h2><p id="first">Stable paragraph</p><p id="tail">First token</p></article>`);
  const element = document.querySelector<HTMLElement>("#message")!;
  const message = sourceMessage("assistant-1", "assistant", element);
  const before = extractMessageBlocks(message);
  document.querySelector("#tail")!.textContent = "First token and the rest of the streamed answer";
  const after = extractMessageBlocks({ ...message, text: element.textContent || "" });

  assert.deepEqual(after.map((block) => block.id), before.map((block) => block.id));
  assert.equal(after[1].text, before[1].text);
  assert.notEqual(after[2].text, before[2].text);
});

test("content block parser recognizes headings, lists, code, tables, images and attachments", () => {
  installDom(`<article id="message">
    <h3>Title</h3><p>Paragraph</p><ul><li>List item</li></ul>
    <pre><code class="language-ts">const value = 1;</code></pre>
    <table><tr><th>A</th></tr><tr><td>B</td></tr></table>
    <img alt="Generated chart" src="https://images.example/chart.png">
    <div data-testid="file-attachment"><a href="https://files.example/report.pdf">report.pdf</a></div>
  </article>`);
  const blocks = extractMessageBlocks(sourceMessage(
    "assistant-2",
    "assistant",
    document.querySelector<HTMLElement>("#message")!
  ));

  assert.deepEqual(blocks.map((block) => block.kind), [
    "heading", "paragraph", "list", "code", "table", "image", "attachment"
  ]);
  assert.equal(blocks.find((block) => block.kind === "code")?.language, "ts");
  assert.deepEqual(blocks.find((block) => block.kind === "table")?.rows, [["A"], ["B"]]);
});

test("citation urls are normalized, deduplicated and preserve the first visible link", () => {
  installDom(`<main>
    <article id="assistant"><p>Read <a href="https://www.example.com/report?utm_source=chatgpt&id=2#part">Report</a>
      and <a href="https://www.example.com/report?id=2&utm_medium=test">duplicate</a>.</p></article>
  </main>`);
  const snapshot = buildSelectiveExportSnapshot({
    title: "Test",
    url: location.href,
    pageKey: "page-1",
    exportedAt: 1,
    sourceMessages: [sourceMessage("assistant-3", "assistant", document.querySelector<HTMLElement>("#assistant")!)]
  });

  assert.equal(canonicalizeCitationUrl("https://www.example.com/report?utm_source=x&id=2#part"), "https://www.example.com/report?id=2");
  assert.equal(snapshot.citations.length, 1);
  assert.equal(snapshot.citations[0].occurrenceCount, 2);
  assert.match(snapshot.citations[0].href, /utm_source=chatgpt/);
});

test("citation safety rejects local, private, credentialed and non-http targets", () => {
  const blocked = [
    "http://localhost/test",
    "http://service.local/test",
    "http://127.0.0.1/test",
    "http://10.1.2.3/test",
    "http://100.64.1.2/test",
    "http://172.20.1.2/test",
    "http://192.168.1.5/test",
    "http://[::1]/test",
    "http://[::ffff:127.0.0.1]/test",
    "http://[::ffff:10.1.2.3]/test",
    "http://[::ffff:192.168.1.5]/test",
    "http://0.0.0.0/test",
    "http://224.0.0.1/test",
    "http://255.255.255.255/test",
    "http://[2001:db8::1]/test",
    "http://[ff02::1]/test",
    "http://user:pass@example.com/test",
    "ftp://example.com/test"
  ];
  assert.ok(blocked.every((url) => !isPublicCitationUrl(url)));
  assert.equal(isPublicCitationUrl("https://example.com/report"), true);
});

test("citation http status classification follows the conservative status model", () => {
  assert.equal(classifyCitationHttpStatus(204), "reachable");
  assert.equal(classifyCitationHttpStatus(302), "reachable");
  assert.equal(classifyCitationHttpStatus(404), "missing");
  assert.equal(classifyCitationHttpStatus(410), "missing");
  assert.equal(classifyCitationHttpStatus(403), "restricted");
  assert.equal(classifyCitationHttpStatus(429), "restricted");
  assert.equal(classifyCitationHttpStatus(503), "temporary-error");
});

test("manual redirects reported as opaqueredirect remain reachable without a synthetic status code", () => {
  assert.deepEqual(classifyCitationFetchResponse(0, "opaqueredirect"), {
    status: "reachable"
  });
  assert.deepEqual(classifyCitationFetchResponse(0, "default"), {
    status: "temporary-error"
  });
});

test("blocked citation checks are never reused from the permission-sensitive cache", () => {
  const now = 10_000;
  assert.equal(isReusableCitationCheckResult({
    url: "https://example.com/source",
    status: "blocked",
    reason: "permission-required",
    checkedAt: now - 1
  }, now, 24 * 60 * 60 * 1000), false);
  assert.equal(isReusableCitationCheckResult({
    url: "https://example.com/source",
    status: "reachable",
    checkedAt: now - 1
  }, now, 24 * 60 * 60 * 1000), true);
});

test("citation extraction ignores hidden and aria-hidden links", () => {
  installDom(`<article id="assistant">
    <p>Visible <a href="https://visible.example/source">source</a></p>
    <p hidden><a href="https://hidden.example/source">hidden source</a></p>
    <p aria-hidden="true"><a href="https://aria-hidden.example/source">aria-hidden source</a></p>
    <p style="display: none"><a href="https://display-none.example/source">display-none source</a></p>
    <details><p><a href="https://closed-details.example/source">closed details source</a></p></details>
  </article>`);
  const snapshot = buildSelectiveExportSnapshot({
    title: "Visibility",
    url: location.href,
    pageKey: "page-visible",
    exportedAt: 1,
    sourceMessages: [sourceMessage(
      "assistant-visible",
      "assistant",
      document.querySelector<HTMLElement>("#assistant")!
    )]
  });

  assert.deepEqual(snapshot.citations.map((citation) => citation.domain), ["visible.example"]);
});

test("duplicate citations across messages preserve every occurrence and survive selecting the later one", () => {
  installDom(`<main>
    <article id="first"><p>First <a href="https://example.com/report?utm_source=first&id=7">source</a></p></article>
    <article id="second"><p>Second <a href="https://example.com/report?id=7&utm_source=second">source</a></p></article>
  </main>`);
  const snapshot = buildSelectiveExportSnapshot({
    title: "Occurrences",
    url: location.href,
    pageKey: "page-occurrences",
    exportedAt: 1,
    sourceMessages: [
      sourceMessage("assistant-first", "assistant", document.querySelector<HTMLElement>("#first")!, 1),
      sourceMessage("assistant-second", "assistant", document.querySelector<HTMLElement>("#second")!, 2)
    ]
  });

  assert.equal(snapshot.citations.length, 1);
  assert.equal(snapshot.citations[0].occurrenceCount, 2);
  assert.deepEqual(
    snapshot.citations[0].occurrences.map((occurrence) => occurrence.messageId),
    ["assistant-first", "assistant-second"]
  );

  const secondBlockId = snapshot.messages[1].blocks[0].id;
  const filtered = filterSelectiveSnapshot(snapshot, new Set([secondBlockId]));
  assert.equal(filtered.citations.length, 1);
  assert.equal(filtered.citations[0].occurrenceCount, 1);
  assert.equal(filtered.citations[0].messageId, "assistant-second");
  assert.deepEqual(filtered.citations[0].occurrences.map((occurrence) => occurrence.blockId), [secondBlockId]);
});

test("merging adjacent assistant answers retains citations from every merged message", () => {
  installDom(`<main>
    <article id="first"><p>First answer <a href="https://first.example/source">first source</a></p></article>
    <article id="second"><p>Second answer <a href="https://second.example/source">second source</a></p></article>
  </main>`);
  const snapshot = buildSelectiveExportSnapshot({
    title: "Merged answers",
    url: location.href,
    pageKey: "page-merged",
    exportedAt: 1,
    sourceMessages: [
      sourceMessage("assistant-merge-first", "assistant", document.querySelector<HTMLElement>("#first")!, 1),
      sourceMessage("assistant-merge-second", "assistant", document.querySelector<HTMLElement>("#second")!, 1)
    ]
  });
  const merged = applySelectiveExportPreferences(snapshot, {
    ...DEFAULT_SELECTIVE_EXPORT_PREFERENCES,
    mergeAdjacentAnswers: true
  });

  assert.equal(merged.messages.length, 1);
  assert.deepEqual(merged.citations.map((citation) => citation.domain).sort(), [
    "first.example",
    "second.example"
  ]);
  assert.deepEqual(
    merged.citations.flatMap((citation) => citation.occurrences.map((occurrence) => occurrence.messageId)).sort(),
    ["assistant-merge-first", "assistant-merge-second"]
  );
});

test("a citation inside a list maps to the list block and survives list-only selection", () => {
  installDom(`<article id="assistant">
    <p>Intro without a source.</p>
    <ul><li>Listed <a href="https://example.com/list-source">source</a></li></ul>
  </article>`);
  const snapshot = buildSelectiveExportSnapshot({
    title: "List citation",
    url: location.href,
    pageKey: "page-list",
    exportedAt: 1,
    sourceMessages: [sourceMessage(
      "assistant-list",
      "assistant",
      document.querySelector<HTMLElement>("#assistant")!
    )]
  });
  const listBlock = snapshot.messages[0].blocks.find((block) => block.kind === "list")!;

  assert.equal(snapshot.citations[0].blockId, listBlock.id);
  const filtered = filterSelectiveSnapshot(snapshot, new Set([listBlock.id]));
  assert.equal(filtered.citations.length, 1);
  assert.equal(filtered.citations[0].occurrences[0].blockId, listBlock.id);
});

test("parent and child selection filters messages, code blocks and citations together", () => {
  installDom(`<main>
    <article id="user"><p>Question</p></article>
    <article id="assistant"><p>Answer with <a href="https://example.com/source">source</a></p><pre>code()</pre></article>
  </main>`);
  const snapshot = buildSelectiveExportSnapshot({
    title: "Test",
    url: location.href,
    pageKey: "page-2",
    exportedAt: 1,
    sourceMessages: [
      sourceMessage("user-1", "user", document.querySelector<HTMLElement>("#user")!),
      sourceMessage("assistant-4", "assistant", document.querySelector<HTMLElement>("#assistant")!)
    ]
  });
  const allIds = getAllSelectableBlockIds(snapshot);
  assert.equal(allIds.size, 3);
  const assistantParagraphId = snapshot.messages[1].blocks[0].id;
  const filtered = filterSelectiveSnapshot(snapshot, new Set([assistantParagraphId]));
  assert.equal(filtered.messages.length, 1);
  assert.equal(filtered.messages[0].role, "assistant");
  assert.equal(filtered.codeBlocks.length, 0);
  assert.equal(filtered.citations.length, 1);
});

test("faithful export is the default while optional cleanup only runs when enabled", () => {
  installDom(`<main><article id="one"><p>好的</p></article><article id="two"><p>First answer</p></article><article id="three"><p>Second answer</p></article></main>`);
  const snapshot = buildSelectiveExportSnapshot({
    title: "Test",
    url: location.href,
    pageKey: "page-3",
    exportedAt: 1,
    sourceMessages: [
      sourceMessage("user-short", "user", document.querySelector<HTMLElement>("#one")!),
      sourceMessage("assistant-a", "assistant", document.querySelector<HTMLElement>("#two")!),
      sourceMessage("assistant-b", "assistant", document.querySelector<HTMLElement>("#three")!)
    ]
  });
  const faithful = applySelectiveExportPreferences(snapshot, DEFAULT_SELECTIVE_EXPORT_PREFERENCES);
  assert.equal(faithful.messages.length, 3);
  const cleaned = applySelectiveExportPreferences(snapshot, {
    ...DEFAULT_SELECTIVE_EXPORT_PREFERENCES,
    filterShortMessages: true,
    mergeAdjacentAnswers: true
  });
  assert.equal(cleaned.messages.length, 1);
  assert.match(cleaned.messages[0].text, /First answer\n\nSecond answer/);
});
