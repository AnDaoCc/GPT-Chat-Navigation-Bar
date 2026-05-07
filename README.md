# GPT聊天导航器

Local-only MV3 extension that injects a React sidebar into ChatGPT pages.

## Features

- Extracts user prompts and deterministic assistant-response summaries from the page DOM.
- Adds a scrollable right-side navigator with clickable anchors.
- Supports search, collapse, favorites, manual refresh, and active-node highlighting.
- Adds a local Token / Context estimate panel powered by `js-tiktoken` with floating and docked modes.
- Supports model-based token budgets with an online model catalog sync plus manual 32k/128k/200k/400k/1M/2M presets.
- Adds a VS Code-style message minimap with page-edge and docked modes.
- Adapts to ChatGPT light and dark themes.
- Supports Simplified Chinese, Traditional Chinese, and English UI.
- Lets you choose the local cache target: extension `chrome.storage.local`, ChatGPT page `localStorage`, or no persistent cache.
- Does not read hidden system prompts, hidden memory, or server-side safety layers.
- Does not call ChatGPT or OpenAI APIs. Optional model sync only downloads model-budget metadata.

## Permissions

- `storage`: saves local navigator state, indexed summaries, and favorites.
- Host permissions are limited to:
  - `https://chat.openai.com/*`
  - `https://chatgpt.com/*`
  - `https://raw.githubusercontent.com/AnDaoCc/GPT-/main/model-catalog.json`
  - `https://platform.openai.com/docs/models*`

The extension does not request `tabs`, `webRequest`, or `<all_urls>`.

## Development

```bash
npm install
npm run typecheck
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select the `dist` folder.

For rebuild-on-change:

```bash
npm run watch
```

## Packaging

```bash
npm run package
```

This creates:

- `release/conversation-navigator-unpacked/`
- `release/conversation-navigator-unpacked.zip`
- `release/conversation-navigator.zip`
- `release/conversation-navigator.crx` when Chrome is available

Google Chrome Stable can block direct off-store `.crx` installs and show "This extension is not listed in the Chrome Web Store". In that case, use "Load unpacked" and select `release/conversation-navigator-unpacked` or `dist`.

Keep the `.pem` file if you want future CRX builds to keep the same extension ID.

## File Layout

```text
manifest.json
popup.html
package.json
tsconfig.json
assets/
  icon.svg
  icon16.png
  icon32.png
  icon48.png
  icon128.png
scripts/
  build.mjs
  package.ps1
src/
  background.ts
  contentScript.tsx
  index.tsx
  popup.tsx
  shared.ts
  styles/
    content.css
    popup.css
```
