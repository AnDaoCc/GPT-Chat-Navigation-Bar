import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildExportDocument } from "../src/popup";
import { DEFAULT_SELECTIVE_EXPORT_PREFERENCES, ExportSnapshot } from "../src/shared";

test("manifest and package metadata are unified on the V10 release", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "2026.10.0");
  assert.equal(manifest.version_name, "2026-V10正式版");
  assert.equal(packageJson.version, "2026.10.0");
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
});

test("selective markdown and html exports honor metadata and contents preferences", () => {
  const snapshot: ExportSnapshot = {
    title: "V10 export",
    url: "https://chatgpt.com/c/test",
    pageKey: "page",
    exportedAt: 1,
    messages: [
      { id: "u1", role: "user", text: "Explain the result", turnIndex: 1 },
      { id: "a1", role: "assistant", text: "The answer", turnIndex: 1 }
    ],
    codeBlocks: [],
    nodes: [],
    exportPreferences: {
      ...DEFAULT_SELECTIVE_EXPORT_PREFERENCES,
      format: "md",
      includeSourceMeta: true,
      includeExportedAt: true,
      generateToc: true
    }
  };
  const markdown = buildExportDocument(snapshot, "chat", "md").data;
  assert.equal(typeof markdown, "string");
  assert.match(markdown as string, /URL: https:\/\/chatgpt\.com\/c\/test/);
  assert.match(markdown as string, /## 目录/);

  const html = buildExportDocument(snapshot, "chat", "html").data;
  assert.equal(typeof html, "string");
  assert.match(html as string, /class="meta"/);
  assert.match(html as string, /class="export-toc"/);
});

test("the redesigned popup keeps an intrinsic Chrome popup size and responsive inner states", () => {
  const popupCss = readFileSync(new URL("../src/styles/popup.css", import.meta.url), "utf8");
  const contentCss = readFileSync(new URL("../src/styles/content.css", import.meta.url), "utf8");
  const popupSource = readFileSync(new URL("../src/popup.tsx", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../src/contentScript.tsx", import.meta.url), "utf8");

  assert.match(
    popupCss,
    /html\s*\{[\s\S]*?width:\s*420px;[\s\S]*?min-width:\s*420px;[\s\S]*?height:\s*600px;[\s\S]*?min-height:\s*600px;/
  );
  assert.match(
    popupCss,
    /body,\s*#root\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;/
  );
  assert.doesNotMatch(popupCss, /width:\s*min\(420px,\s*100vw\)/);
  assert.doesNotMatch(popupCss, /height:\s*min\(600px,\s*100vh\)/);
  assert.match(popupCss, /@media\s*\(max-width:\s*340px\),\s*\(max-height:\s*440px\)/);
  assert.match(popupCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(contentCss, /\.cnav-reading-drawer/);
  assert.match(contentCss, /data-cnav-focus-mode/);
  assert.match(contentCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(popupSource, /type PopupTab = "tools" \| "display" \| "library" \| "settings"/);
  assert.match(contentSource, /Alt\+Up|event\.altKey/);
});

test("floating reading controls avoid each other and closed drawers cannot receive focus", () => {
  const contentCss = readFileSync(new URL("../src/styles/content.css", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../src/contentScript.tsx", import.meta.url), "utf8");

  assert.match(
    contentCss,
    /\.cnav-scroll-jump\s*\{[\s\S]*?right:\s*22px;[\s\S]*?bottom:\s*82px;/
  );
  assert.match(
    contentCss,
    /\.cnav-reading-actions\s*\{[\s\S]*?right:\s*22px;[\s\S]*?bottom:\s*24px;/
  );
  assert.match(
    contentCss,
    /\.cnav-reading-drawer\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/
  );
  assert.match(
    contentCss,
    /\.cnav-reading-drawer\.is-open\s*\{[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/
  );
  assert.match(contentSource, /aria-hidden=\{!open\}/);
  assert.match(contentSource, /\{!drawerOpen\s*\?\s*\([\s\S]*?className="cnav-reading-launcher"/);
});

test("manual motion preference disables popup and drawer micro-animations", () => {
  const popupCss = readFileSync(new URL("../src/styles/popup.css", import.meta.url), "utf8");
  const contentCss = readFileSync(new URL("../src/styles/content.css", import.meta.url), "utf8");
  const popupSource = readFileSync(new URL("../src/popup.tsx", import.meta.url), "utf8");
  const contentSource = readFileSync(new URL("../src/contentScript.tsx", import.meta.url), "utf8");

  assert.match(popupSource, /settings\.uiMotionEnabled\s*\?\s*""\s*:\s*" is-static"/);
  assert.match(popupCss, /\.popup-shell\.is-static \*[\s\S]*?animation-duration:\s*0s\s*!important/);
  assert.match(popupCss, /\.popup-shell\.is-static[\s\S]*?transform:\s*none\s*!important/);
  assert.match(contentSource, /motionEnabled\s*\?\s*""\s*:\s*" is-static"/);
  assert.match(contentCss, /\.cnav-reading-drawer\.is-static[\s\S]*?animation:\s*none\s*!important/);
});

test("popup exposes accessible tabs, live feedback, icon labels, and unavailable page states", () => {
  const popupSource = readFileSync(new URL("../src/popup.tsx", import.meta.url), "utf8");

  assert.match(popupSource, /role="tablist"/);
  assert.match(popupSource, /role="tab"/);
  assert.match(popupSource, /aria-controls=\{`popup-panel-\$\{tab\.id\}`\}/);
  assert.match(popupSource, /aria-selected=\{activeTab === tab\.id\}/);
  assert.match(popupSource, /role="tabpanel"/);
  assert.match(popupSource, /aria-labelledby=\{`popup-tab-\$\{activeTab\}`\}/);
  assert.match(popupSource, /className="popup-toast"\s+role="status"\s+aria-live="polite"/);
  assert.match(popupSource, /aria-label=\{extra\.copy\}\s+title=\{extra\.copy\}/);
  assert.match(popupSource, /aria-label=\{extra\.delete\}\s+title=\{extra\.delete\}/);
  assert.match(popupSource, /aria-label=\{extra\.addToLibrary\}\s+title=\{extra\.addToLibrary\}/);
  assert.match(
    popupSource,
    /pageConnected\s*=\s*pageBridgeStatus === "ready"\s*&&\s*pageHealth !== null\s*&&\s*pageHealth\.status !== "unsupported"/
  );
  assert.match(popupSource, /onClick=\{\(\) => void refreshMaterials\(\)\}\s+disabled=\{!pageConnected\}/);
  assert.match(popupSource, /onClick=\{\(\) => void saveSelectedText\(\)\}\s+disabled=\{!pageConnected\}/);
});
