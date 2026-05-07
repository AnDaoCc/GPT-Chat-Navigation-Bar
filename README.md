# GPT聊天导航器

Local-only MV3 extension that injects a React sidebar into ChatGPT pages.

## Features

- Extracts user prompts and deterministic assistant-response summaries from the page DOM.
- Adds a scrollable right-side navigator with clickable anchors.
- Supports search, collapse, favorites, manual refresh, and active-node highlighting.
- Adds a ChatGPT chat switcher that reads visible project and recent-chat links from the left sidebar for one-click switching.
- Adapts to ChatGPT light and dark themes.
- Supports Simplified Chinese, Traditional Chinese, and English UI.
- Lets you choose the local cache target: extension `chrome.storage.local`, ChatGPT page `localStorage`, or no persistent cache.
- Does not call ChatGPT, OpenAI APIs, or third-party services.

## Permissions

- `storage`: saves local navigator state, indexed summaries, and favorites.
- Host permissions are limited to:
  - `https://chat.openai.com/*`
  - `https://chatgpt.com/*`

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
