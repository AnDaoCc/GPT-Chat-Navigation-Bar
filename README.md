# GPT页面增强工具

GPT页面增强工具是一款面向 ChatGPT 网页端的本地增强浏览器插件。它提供阅读显示调节、画布显示调节、Token 面板、文档导出、素材收藏、表格复制工具和代码块工具条，帮助长对话、长表格、脚本拆分、资料整理这类高信息密度场景更容易阅读和保存。

当前版本：`2026-V9正式版 / 2026.9.0`

## 核心原则

- 只在浏览器本地处理当前页面 DOM、插件设置和收藏素材。
- 不调用外部 AI/API，不上传聊天内容。
- 模型目录和兼容规则只同步公开元数据或 JSON 配置。
- 不持久保存聊天页面或消息索引；旧版索引升级后会自动清理。

## 主要功能

### 导出文档与结构整理

- 支持导出当前 ChatGPT 页面为 Word、HTML 或 Markdown。
- 默认导出“仅聊天内容”，只保留用户提问和 GPT 回答，适合直接阅读或分享。
- 支持“详细文档”，保留基础元信息、完整消息和去重后的代码块。
- 支持“结构大纲”，基于当前页面临时数据输出分组、标题和 Token。
- 所有导出都在浏览器本地完成，不上传聊天内容。

### Token 面板

- 本地估算当前聊天的 Token / Context 使用量。
- 每个标签页和会话独立统计，切换聊天或新建窗口时不会继承上一会话数据。
- 支持悬浮显示。
- 支持模型预算选择，也支持 32k、128k、200k、400k、1M、2M 等手动预算。
- 支持消息明细展开，显示最耗 token 的前 5 条消息。
- 显示总 token、代码 token、表格 token，并支持点击明细跳转到对应消息。
- 超过预算 82% 显示黄色预警，超过 100% 显示红色预警，并给出建议优先裁剪的内容。

### 阅读显示调节

- 支持调整聊天正文的字号、左右字距、上下行距和正文宽度。
- 支持单独调整画布内容字号、字距和行距。
- 数值滑块在弹窗示例区预览，松手、失焦或按 Enter 后才一次应用到页面。
- 字体和宽度样式使用 CSS 变量更新，避免反复重写大段样式。
- 正文和画布宽度竖条拖动时只显示轻量轮廓，松手后一次应用，避免长页面持续重排。
- 弹窗后台中的设置项按分类折叠，平时更清爽，需要时再展开。

### 表格工具

- 为 ChatGPT 回答中的表格提供更灵活的复制工具。
- 支持复制整表、复制当前行、复制当前列、复制选中区域。
- 支持下载 CSV。
- 表格会按 DOM 顺序编号，例如 `表 1/3`，并支持上一张/下一张表格跳转。
- 工具条改为右侧竖向显示，并尽量避开正文、宽度调节线、官方按钮和画布按钮。
- 复制格式沿用当前偏好：Markdown、TSV、CSV 或 HTML。

### 代码块工具

- 为 ChatGPT 的代码块增加右上工具条。
- 支持复制文件名、复制为 Markdown、下载文件、折叠或展开长代码。
- 文件名会优先从代码块标题或语言推断，没有标题时使用 `snippet-{序号}.{扩展名}`。
- 支持常见语言扩展名映射，例如 `ts`、`js`、`py`、`json`、`md`、`sh`。
- diff 代码块会高亮 `+` / `-` 行，普通代码不会误判高亮。

### 本地数据

- 仅保留显示设置、Token 设置、收藏素材、模型目录、兼容规则和操作偏好。
- 聊天消息映射只存在于当前标签页内存中，关闭标签页后自动释放。
- 从旧版本升级时会自动删除扩展存储和 ChatGPT `localStorage` 中的聊天索引。

### 兼容性

- 支持 `https://chat.openai.com/*` 和 `https://chatgpt.com/*`。
- 支持内置和远程 ChatGPT DOM 兼容规则，便于页面结构变化后快速恢复识别能力。
- 支持简体中文、繁体中文和英文界面。
- 自动适配 ChatGPT 明暗主题。

## 安装使用

推荐使用“加载已解压的扩展程序”方式安装：

1. 执行打包命令：

```bash
npm install
npm run package
```

2. 打开 Chrome 的扩展管理页：

```text
chrome://extensions
```

3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择：

```text
D:\APPKF\GPT页面增强工具\release\conversation-navigator-unpacked
```

也可以在开发阶段直接选择：

```text
D:\APPKF\GPT页面增强工具\dist
```

安装后打开或刷新 ChatGPT 页面即可使用。插件图标的弹窗后台用于查看状态、调节阅读显示、管理收藏和兼容规则。

## 开发命令

```bash
npm install
npm run typecheck
npm run build
npm run package
```

开发时持续构建：

```bash
npm run watch
```

## 打包产物

执行 `npm run package` 后会生成：

- `release/conversation-navigator-unpacked/`
- `release/conversation-navigator-unpacked.zip`
- `release/conversation-navigator.zip`
- `release/conversation-navigator.crx`，如果本机 Chrome 支持命令行打包

`release/` 是本地打包产物目录，仓库默认忽略。需要安装包时在本机重新执行 `npm run package` 即可生成。

Chrome 稳定版可能阻止直接拖拽安装未上架商店的 `.crx` 文件。这不是插件代码问题，而是 Chrome 的安全策略。个人本地使用建议通过“加载已解压的扩展程序”安装。

## 权限说明

- `storage`：保存素材收藏、导出偏好、显示设置、Token 面板设置、模型目录和兼容规则；不保存聊天索引。
- `clipboardWrite`：用于表格和代码块复制。
- 主机权限仅限 ChatGPT 页面、公开模型目录、公开兼容规则和 OpenAI 官方文档页面。

插件不申请 `tabs`、`webRequest` 或 `<all_urls>` 权限。

## 目录结构

```text
assets/
compat/
scripts/
src/
  background.ts
  chatGptAdapter.ts
  conversationSession.ts
  contentScript.tsx
  index.tsx
  popup.tsx
  shared.ts
  styles/
    content.css
    popup.css
manifest.json
popup.html
package.json
tsconfig.json
```
