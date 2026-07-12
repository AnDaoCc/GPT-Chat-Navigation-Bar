# Chrome 安装指南

Chrome 稳定版可能会阻止直接拖拽安装本地 `.crx` 文件，并提示“此扩展程序未列在 Chrome 网上应用店中”。这属于 Chrome 的安装策略限制，不代表插件代码有问题。

推荐使用“加载已解压的扩展程序”方式安装。

## 安装步骤

1. 打开 Chrome 扩展管理页：

```text
chrome://extensions
```

2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择打包后的目录：

```text
D:\APPKF\GPT页面增强工具\release\conversation-navigator-unpacked
```

5. 打开或刷新 ChatGPT 页面。

## 开发模式

如果你正在开发或调试，也可以直接加载构建目录：

```text
D:\APPKF\GPT页面增强工具\dist
```

每次修改源码后执行：

```bash
npm run build
```

然后在 `chrome://extensions` 中点击该插件的刷新按钮。

## 打包命令

```bash
npm install
npm run package
```

打包后会生成：

- `release/conversation-navigator-unpacked/`：推荐加载的目录。
- `release/conversation-navigator-unpacked.zip`：已解压目录的压缩包。
- `release/conversation-navigator.zip`：发布用压缩包。
- `release/conversation-navigator.crx`：如果本机 Chrome 支持命令行打包则生成。

## 关于 CRX

本地 `.crx` 更适合 Chromium 系浏览器、企业策略安装或测试环境。普通 Chrome 稳定版个人用户建议始终使用“加载已解压的扩展程序”。
