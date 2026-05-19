# GPT聊天导航器

GPT聊天导航器是一款面向 ChatGPT 网页端的本地增强浏览器插件。它会在当前 ChatGPT 页面中生成聊天导航、Token 面板、阅读显示调节、表格复制工具和代码块工具条，帮助长对话、长表格、脚本拆分、代码排查这类高信息密度场景更容易阅读和回溯。

当前版本：`2026-V6 / 2026.6.0`

## 核心原则

- 只在浏览器本地处理当前页面 DOM 和本地缓存。
- 不调用外部 AI/API，不上传聊天内容。
- 模型目录和兼容规则只同步公开元数据或 JSON 配置。
- 缓存字段保持向后兼容，旧版本保存的数据可继续读取。

## 主要功能

### 聊天导航

- 从 ChatGPT 页面中识别用户问题，生成稳定的导航节点。
- 支持节点搜索、收藏、当前节点高亮和快速跳转。
- 支持导航节点智能分组，默认包含：`需求讨论`、`代码修改`、`报错排查`、`表格/数据`、`总结整理`、`常规对话`。
- 分组可折叠，活跃节点所在分组会自动展开。
- 节点支持重命名、备注和恢复默认标题。
- 缓存按会话隔离，避免新标签页误显示上一个标签页的导航气泡。
- 清理缓存后重新进入已有聊天时，导航顺序按页面 DOM 从上到下稳定恢复。

### Token 面板

- 本地估算当前聊天的 Token / Context 使用量。
- 支持悬浮显示和侧栏显示。
- 支持模型预算选择，也支持 32k、128k、200k、400k、1M、2M 等手动预算。
- 支持消息明细展开，显示最耗 token 的前 5 条消息或节点。
- 显示总 token、代码 token、表格 token，并支持点击明细跳转到对应消息。
- 超过预算 82% 显示黄色预警，超过 100% 显示红色预警，并给出建议优先裁剪的节点。

### 阅读显示调节

- 支持调整聊天正文的字号、左右字距、上下行距和正文宽度。
- 支持单独调整画布内容字号、字距和行距。
- 数值滑块已优化为“拖动时实时预览，停止后保存”，减少长对话页面卡顿。
- 字体和宽度样式使用 CSS 变量更新，避免反复重写大段样式。
- 正文宽度调节提供左下角开关，避免误触，也减少与表格复制按钮重叠。
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

### 缓存管理

- 弹窗后台显示页面数、节点数和缓存状态。
- 支持选择清除指定聊天文档缓存，也支持一键清除不重要缓存。
- 支持清除当前 ChatGPT 页面 `localStorage` 中的插件缓存。
- 提供缓存位置说明和“哪些可以删 / 哪些应保留”的标注。
- Chrome 扩展无法直接打开任意系统文件夹，因此插件会提供可定位缓存的浏览器页面和说明。

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
D:\APPKF\GPT聊天导航\release\conversation-navigator-unpacked
```

也可以在开发阶段直接选择：

```text
D:\APPKF\GPT聊天导航\dist
```

安装后打开或刷新 ChatGPT 页面即可使用。插件图标的弹窗后台用于查看状态、调节阅读显示、管理缓存和兼容规则。

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

- `storage`：保存导航状态、节点索引、收藏、重命名、备注、显示设置、Token 面板设置、模型目录和兼容规则。
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
