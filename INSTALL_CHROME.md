# Google Chrome Installation

If Chrome shows "This extension is not listed in the Chrome Web Store", the extension code is not the cause. That warning is Chrome blocking a local `.crx` install because it did not come from the Chrome Web Store.

Use this local development install path instead:

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click "Load unpacked".
4. Select this folder:

```text
C:\Users\zhang\Desktop\GPT插件\release\conversation-navigator-unpacked
```

You can also select:

```text
C:\Users\zhang\Desktop\GPT插件\dist
```

The `.crx` file is still generated for Chromium builds or environments that allow local CRX installation. Google Chrome Stable may disable it by policy.

## Why Not Drag-To-Install CRX?

Chrome Stable restricts off-store extension installation. For private local use, "Load unpacked" is the supported path. For normal one-click installation in Chrome, the extension must be published through the Chrome Web Store or installed by managed enterprise policy.
