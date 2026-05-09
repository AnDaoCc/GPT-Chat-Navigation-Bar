# GPT聊天导航器

这是一个仅在本地运行的 Chrome MV3 扩展，用于在 ChatGPT 页面中加入对话导航、Token 估算和阅读显示调节功能。

## 功能

- 从当前 ChatGPT 页面 DOM 中提取用户提问，并生成稳定的助手回复摘要。
- 在页面右侧加入可滚动的聊天导航栏，支持点击节点快速跳转到对应消息。
- 支持搜索、折叠、收藏、手动刷新和当前节点高亮。
- 提供本地 Token / Context 估算面板，基于 `js-tiktoken` 进行估算，支持悬浮和侧栏内两种显示模式。
- 支持按模型选择 Token 预算，也支持手动选择 32k、128k、200k、400k、1M、2M 等预算。
- 支持自动同步模型预算目录，用于跟随 OpenAI / ChatGPT 模型变化更新候选项。
- 支持调节主聊天内容的字号、左右字距、上下行距和正文宽度。
- 支持单独调节画布内容的字号、左右字距和上下行距，不影响主聊天界面。
- 自动适配 ChatGPT 的亮色和暗色主题。
- 支持简体中文、繁体中文和英文界面。
- 可选择本地缓存位置：扩展本地存储 `chrome.storage.local`、ChatGPT 页面 `localStorage`，或仅内存模式。
- 不读取隐藏系统 Prompt、隐藏 Memory 或服务端安全层内容。
- 不调用 ChatGPT API 或 OpenAI API；可选模型同步只下载模型预算元数据。

## 权限

- `storage`：用于保存本地导航状态、索引摘要、收藏、显示设置和 Token 面板设置。
- 主机权限仅限以下地址：
  - `https://chat.openai.com/*`
  - `https://chatgpt.com/*`
  - `https://raw.githubusercontent.com/AnDaoCc/GPT-/main/model-catalog.json`
  - `https://platform.openai.com/docs/models*`
  - `https://platform.openai.com/docs/deprecations*`
  - `https://openai.com/index/*`
  - `https://help.openai.com/en/articles/*`

本扩展不申请 `tabs`、`webRequest` 或 `<all_urls>` 权限。

## 开发

```bash
npm install
npm run typecheck
npm run build
```

然后打开 `chrome://extensions`，启用开发者模式，点击“加载已解压的扩展程序”，选择 `dist` 目录。

如需开发时自动重新构建：

```bash
npm run watch
```

## 打包

```bash
npm run package
```

打包后会生成：

- `release/conversation-navigator-unpacked/`
- `release/conversation-navigator-unpacked.zip`
- `release/conversation-navigator.zip`
- 如果本机可用 Chrome，还会生成 `release/conversation-navigator.crx`

Chrome 稳定版可能会阻止直接安装未上架商店的 `.crx` 文件，并提示“此扩展程序未列在 Chrome 网上应用店中”。这种情况下，请使用“加载已解压的扩展程序”，选择 `release/conversation-navigator-unpacked` 或 `dist`。

如果希望以后生成的 CRX 保持相同扩展 ID，请保留 `.pem` 文件。

## 文件结构

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
