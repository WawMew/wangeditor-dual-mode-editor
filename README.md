# wangEditor 双模式富文本编辑器

基于 [wangEditor v5](https://github.com/wangeditor-team/wangEditor)（`@wangeditor/editor@5.1.23`，已本地 vendor）
构建的富文本编辑器，面向 **博客文章编辑** 与 **BBS 发帖 / 回复** 场景，提供两种可实时切换的编辑模式：

| 模式 | 对齐的官方示例 | 核心还原点 |
| --- | --- | --- |
| **默认模式** | <https://www.wangeditor.com/demo/index.html> | 全量工具栏（41 项）、`1px #ccc` 边框容器、工具栏与编辑区之间分隔线、编辑区固定 500px 且内部滚动、`Text length / Selected text length` 统计行 |
| **仿腾讯文档** | <https://www.wangeditor.com/demo/like-qq-doc.html> | 工具栏贴顶整行居中（1350px / `#FCFCFC`）、隐藏「全屏」菜单（41 → 40 项）、浅灰画布 `#f5f5f5` + 居中 850px 白色纸张（描边 + 阴影）、纸张顶部 30px 大标题输入框、`scroll: false` 页面级滚动、点击纸张空白处聚焦末尾 |

两种模式的还原效果已由自动化自检逐条断言（**42 项全部通过**），详见 [`_selftest.html`](./_selftest.html)。

---

## 一、快速运行

```bash
# 方式一：本地静态服务（推荐，剪贴板 API 与 localStorage 均可正常工作）
python -m http.server 8321 --bind 127.0.0.1
# 然后打开 http://127.0.0.1:8321/index.html

# Windows 可直接双击 start-server.cmd
```

也可以直接双击 `index.html`（纯静态、无构建）。
注意：在 `file://` 协议下，浏览器会禁用 `navigator.clipboard` 与 `localStorage`，
此时「复制」会走 `execCommand` 回退方案、「保存到本地」不可用，但「导出 HTML」始终可用。

**URL 参数**

| 参数 | 作用 |
| --- | --- |
| `?demo=1` | 跳过草稿，直接载入示例内容（便于演示 / 截图） |
| `?mode=default` / `?mode=qqdoc` | 直接进入指定模式 |
| `#default` / `#qqdoc` | 同上（hash 形式，切换时地址栏会自动同步） |

---

## 二、项目结构

```
wangeditor-app/
├── index.html                  应用入口：顶栏（模式切换 + 操作区）/ 主区 / 状态栏 / 模态框
├── start-server.cmd            Windows 一键启动本地静态服务
├── _selftest.html              自动化自检页（在 iframe 中加载 index.html 并断言 42 项）
├── README.md                   本文档
│
├── css/
│   ├── base.css                应用外壳：设计变量、顶栏、按钮、抽屉、模态框、Toast、响应式
│   ├── mode-default.css        「默认模式」皮肤（对齐 index 示例）
│   └── mode-qqdoc.css          「仿腾讯文档」皮肤（对齐 like-qq-doc 示例）
│
├── js/
│   ├── editor-factory.js       编辑器实例工厂：渲染模式模板 → 合并配置 → createEditor/createToolbar → 销毁
│   ├── app.js                  应用编排：模式切换机制、顶栏动作、状态栏、自动草稿、快捷键
│   ├── modes/
│   │   ├── default.mode.js     「默认模式」定义（模板 / 配置 / 生命周期钩子）
│   │   └── qqdoc.mode.js       「仿腾讯文档模式」定义
│   ├── features/
│   │   ├── clipboard.js        剪贴板：富文本（text/html + text/plain）与纯文本，含 execCommand 回退
│   │   ├── exporter.js         导出：独立 HTML 文档生成、下载、HTML 源码格式化、字节数格式化
│   │   └── storage.js          本地持久化：自动草稿 + 命名存档（localStorage）
│   └── content/
│       └── sample.js           示例内容（「示例」按钮 / `?demo=1`）
│
├── vendor/wangeditor/          本地依赖，离线可用
│   ├── index.js                @wangeditor/editor@5.1.23 UMD 构建（暴露 window.wangEditor）
│   └── style.css               官方样式
│
├── samples/
│   └── export-sample.html      「导出 HTML」产物的示例（独立可打开，内嵌阅读态样式）
└── _shots/                     两种模式与导出效果的验证截图
```

**加载顺序**（全部为传统 `<script>`，无模块、无构建，保证 `file://` 双击可用）：

```
vendor/wangeditor/index.js
  → features/{storage, clipboard, exporter}.js
  → editor-factory.js
  → modes/{default, qqdoc}.mode.js
  → content/sample.js
  → app.js
```

---

## 三、模式切换机制

### 3.1 一个模式 = 一份「声明」

`js/modes/*.mode.js` 把每个模式声明成纯数据 + 生命周期钩子，皮肤（CSS）、版式（template）、
菜单（toolbarConfig）、行为（editorConfig / onMount）全部内聚在同一个对象里：

```js
window.AppModes['qqdoc'] = {
  id: 'qqdoc',                    // 同时写入 <body data-mode="qqdoc">，驱动 CSS 皮肤切换
  label: '仿腾讯文档',
  template: '…',                  // 注入 #editor-stage，须含 #editor-toolbar 与 #editor-text-area
  editorConfig: { scroll: false },// 关闭编辑器内部滚动 → 交由整页滚动
  toolbarConfig: { excludeKeys: ['fullScreen'] },
  onMount(ctx)   { /* 点击纸张空白处 focus 末尾 */ },
  onUnmount(ctx) { /* 解绑事件 */ }
};
```

皮肤切换靠 **属性选择器**，无需切换 `<link>`：
`body[data-mode="default"]` → `css/mode-default.css`，`body[data-mode="qqdoc"]` → `css/mode-qqdoc.css`。

### 3.2 切换时序（`js/app.js` → `switchMode()`）

```
switchMode(nextModeId)
 │
 ├─ 1. 取出当前内容     state.html = editor.getHtml()   ← 模式间唯一的交接物
 │                      state.title = #doc-title.value
 ├─ 2. 销毁旧实例       editor.destroy()                 ← 官方 API，内部连带销毁 textarea / toolbar / hoverbar
 │                      mode.onUnmount()                 ← 解绑该模式自己加的监听
 ├─ 3. 换皮肤与标识     body[data-mode] / html[data-app-mode] / 顶栏按钮态 / location.hash
 ├─ 4. 渲染新模板       #editor-stage.innerHTML = mode.template
 ├─ 5. 重建实例         AppEditor.create(mode, { html: state.html, onChange, onSelectionChange })
 │                      → E.createEditor({ selector:'#editor-text-area', … })
 │                      → E.createToolbar({ editor, selector:'#editor-toolbar', … })
 ├─ 6. 回填标题         #doc-title.value = state.title（仅带标题栏的模式存在该节点）
 └─ 7. 刷新界面         状态栏 / 源码抽屉 / 统计行 / 自动草稿
```

**为什么同一时刻只保留一个实例**：两种模式的 `scroll`、工具栏布局、宿主 DOM 结构都不同，
单实例无法同时满足；而 `editor.isDestroyed` 与 `editor.destroy()` 是官方提供的幂等销毁入口，
所以「销毁旧的 → 用同一份 HTML 新建」比「双实例互切」更干净，也不会残留 DOM 与事件。
自检中对这两点有断言：`同一时刻只有一个编辑器实例`、`舞台内不残留上一模式的 DOM`。

**内容为什么不会丢**：内容从不依赖 DOM，而是每次切换前通过 `editor.getHtml()` 取出、
新建时经 `createEditor({ html })` 注入。自检验证了 default → qqdoc → default 两次切换后
内容与「在 qqdoc 模式下继续编辑的结果」都被完整延续。

**为什么不会切出野实例**：`#editor-toolbar` / `#editor-text-area` 两个 id 在每个模板中各出现一次，
同一时刻页面上只有一套模板，因此官方 API 要求的字符串选择器始终唯一命中；模板缺节点时工厂会抛出
明确错误并在舞台上渲染 `.stage-error` 提示，而不是静默失败。

---

## 四、功能清单

| 顶栏按钮 | 行为 | 关键实现 |
| --- | --- | --- |
| **复制** | 有选中内容则复制选区，否则复制全文；同时写入 `text/html` + `text/plain`，粘到 Word / 公众号保留格式 | `AppClipboard.copyRich()`；异步 Clipboard API 不可用时回退 `execCommand('copy')` |
| **复制 HTML** | 复制原始 HTML 源码字符串 | `AppClipboard.copyPlain()` |
| **预览** | 模态框内以只读文档渲染「导出后的最终效果」，可导出 / 新窗口打开 / 复制源码 | `AppExporter.buildDocument()` → `iframe.srcdoc` |
| **导出 HTML** | 下载 `标题-年月日-时分.html`，独立可打开、内嵌阅读态样式与打印样式 | `AppExporter.buildDocument()` + `download()` |
| **保存** | 打开「本地存档」模态框：命名保存当前文档、列出历史存档（打开 / 删除） | `AppStorage.saveSlot/listSlots/removeSlot`（localStorage，同名覆盖） |
| **导入** | 粘贴 HTML 源码或选择本地 `.html` 文件；若为完整文档会自动提取 `<title>` / `.doc-title` 与 `body` 内容 | `DOMParser` + `editor.setHtml()` |
| **示例** | 注入内置示例内容 | `js/content/sample.js` |
| **清空** | 二次确认后清空内容与标题 | — |
| **源码** | 右侧抽屉展示格式化后的 HTML 源码，可刷新 / 复制 | `AppExporter.prettyHtml()` |

其他：

- **自动草稿**：内容变更后 800ms 节流写入 localStorage；`visibilitychange` 与 `beforeunload` 再兜底一次；
  下次打开自动恢复（状态栏显示「自动保存 HH:MM」/「已恢复草稿 HH:MM」）。
- **状态栏**：当前模式、字数、选中字数、草稿状态、操作提示。
- **快捷键**：`Ctrl/Cmd + S` 打开存档、`Esc` 关闭模态框。
- **图片 / 视频**：无服务端也能跑 —— 本地图片 < 10MB 走 wangEditor 的 base64 直插，
  更大的与本地视频通过 `MENU_CONF.uploadImage/uploadVideo.customUpload` 转为 dataURL 插入（大小上限 10MB / 20MB）；
  「网络图片」「插入视频」按 URL 输入，开箱即用。
- **调试入口**：`window.App.switchMode('qqdoc')`、`window.App.state`、`window.App.errors`。

---

## 五、自动化自检

```bash
# 前提：本地服务已在 8321 端口运行
# 浏览器打开 http://127.0.0.1:8321/_selftest.html
```

自检页在 `<iframe>` 中加载真实的 `index.html?demo=1`，跨模式断言 42 项，覆盖：
依赖与初始化、默认模式的 DOM 与 `scroll: true`、`setHtml/getHtml` 往返、统计口径、
导出文档完整性、localStorage 增删查、切换到 qqdoc 后的纸张宽度 850px / 工具栏背景 `#FCFCFC` /
按钮数 41 → 40（仅差 fullScreen）/ `scroll: false`、跨模式内容保持、实例隔离、剪贴板 API、
运行期无未捕获错误。当前结果：**42 passed / 0 failed**。

---

## 六、还原口径与已知边界

- 工具栏按钮数 41 → 40 的差异**只来自**官方那句 `excludeKeys: 'fullScreen'`；
  官方写的是字符串（依赖 `String.prototype.includes` 恰好成立），本项目改为规范数组 `['fullScreen']`，效果一致。
- 官方 `scroll: false` 时编辑器高度会溢出纸张容器，本项目在 `mode-qqdoc.css` 中把
  `.w-e-text-container` / `.w-e-scroll` 的高度改为 `auto`，让白色纸张随内容自然增长（版式更接近在线文档）。
- 编辑区默认高度按官方取 500px，屏幕较高时（`min-height: 960px`）放宽到 620px；
  「固定高度 + 内部滚动」的交互模型不变。
- 图片 / 视频以 base64 内嵌，适合单文档场景；若用于生产环境，建议给 `MENU_CONF.uploadImage.server`
  配置上传接口替换 `customUpload`。
- 存档保存在浏览器 localStorage，会受配额限制（含大量 base64 图片时可能写失败并提示「超配额」）；
  需要跨机器保存请用「导出 HTML」。
