# wangEditor 双模式富文本编辑器

基于 [wangEditor v5](https://github.com/wangeditor-team/wangEditor)（`@wangeditor/editor@5.1.23`，已本地 vendor）
构建的富文本编辑器，面向 **博客文章编辑** 与 **BBS 发帖 / 回复** 场景，提供两种可实时切换的编辑模式：

| 模式 | 参考官方示例 | 核心还原点 |
| --- | --- | --- |
| **默认模式** | <https://www.wangeditor.com/demo/index.html> | 全量工具栏（41 项）、`1px #ccc` 边框容器、工具栏与编辑区之间分隔线、编辑区固定 500px 且内部滚动、`Text length / Selected text length` 统计行 |
| **仿腾讯文档** | <https://www.wangeditor.com/demo/like-qq-doc.html> | 工具栏贴顶整行居中（1350px / `#FCFCFC`）、隐藏「全屏」菜单（41 → 40 项）、浅灰画布 `#f5f5f5` + 居中 850px 白色纸张（描边 + 阴影）、**纸张内无独立标题栏、开头即正文**、`scroll: false` 页面级滚动、点击纸张空白处聚焦末尾 |

两种模式**完全独立**：各自持有自己的文档与自动草稿，切换模式不传递内容。
还原效果已由自动化自检逐条断言（**65 项全部通过**），详见 [`_selftest.html`](./_selftest.html)。

---

## 一、快速运行

**方式一：双击 `start-server.cmd`（Windows，推荐）**

零依赖 —— 不需要装 Python 或 Node，直接用 Windows 自带的脚本宿主起服务：

```
start-server.cmd           # 默认端口 8321
start-server.cmd 8322      # 也可指定端口
```

启动后窗口会一直开着并打印地址，浏览器打开 <http://127.0.0.1:8321/index.html> 即可；
按 `Ctrl+C` 停止。服务实现见 `tools/serve.ps1`（`HttpListener`，支持 MIME 识别、
404、目录默认 `index.html`、路径穿越防护；同时注册 `localhost` 与 `127.0.0.1` 两个前缀）。

> 为什么不用 `python -m http.server`：本机 PATH 里的 `python` 往往是
> `…\AppData\Local\Microsoft\WindowsApps\python.exe` —— 微软商店的占位程序而非解释器，
> 运行后要么打开应用商店要么直接退出，表现就是「双击了没反应」。

**方式二：任意静态服务器**

```bash
python -m http.server 8321 --bind 127.0.0.1
# 或 npx serve .
```

**方式三：直接双击 `index.html`**（纯静态、无构建）。
注意：在 `file://` 协议下浏览器会禁用 `navigator.clipboard` 与 `localStorage`，
此时「复制」走 `execCommand` 回退、「保存到本地」不可用，但「导出 HTML」始终可用。

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
├── start-server.cmd            Windows 一键启动本地静态服务（无需 Python / Node）
├── tools/
│   └── serve.ps1               零依赖静态文件服务（HttpListener）
├── _selftest.html              自动化自检页（在 iframe 中加载 index.html 并断言 65 项）
├── README.md                   本文档
│
├── css/
│   ├── base.css                应用外壳：设计变量、顶栏、按钮、抽屉、模态框、Toast、响应式
│   ├── mode-default.css        「默认模式」皮肤
│   └── mode-qqdoc.css          「仿腾讯文档」皮肤
│
├── js/
│   ├── editor-factory.js       编辑器实例工厂：渲染模式模板 → 合并配置 → createEditor/createToolbar → 销毁
│   ├── app.js                  应用编排：模式切换机制、各模式独立的文档状态、顶栏动作、自动草稿
│   ├── modes/
│   │   ├── default.mode.js     「默认模式」定义（模板 / 配置 / 生命周期钩子）
│   │   └── qqdoc.mode.js       「仿腾讯文档模式」定义
│   ├── features/
│   │   ├── clipboard.js        剪贴板：富文本（text/html + text/plain）与纯文本，含 execCommand 回退
│   │   ├── exporter.js         导出：按模式生成独立 HTML 文档、下载、HTML 源码格式化、字节数格式化
│   │   └── storage.js          本地持久化：与模式一一对应的自动草稿 + 命名存档（localStorage）
│   └── content/
│       └── sample.js           示例内容（「示例」按钮 / `?demo=1`）
│
├── vendor/wangeditor/          本地依赖，离线可用
│   ├── index.js                @wangeditor/editor@5.1.23 UMD 构建（暴露 window.wangEditor）
│   └── style.css               官方样式
│
├── samples/
│   ├── export-sample-default.html  「默认模式」导出产物示例（纯内容，43 行 / 1.5 KB）
│   ├── export-sample-qqdoc.html    「仿腾讯文档」导出产物示例（完整文档，灰底 + 850px 白纸）
│   └── export-sample-empty.html    空文档导出示例（外壳 9 行，无任何注入文案）
└── _shots/                     两种模式、导出效果、全屏与自检结果的验证截图
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

### 3.2 两种模式完全独立

**不存在「内容交接」这回事。** 每个模式各自持有一份文档，存在 `app.js` 的 `docs[modeId] = { html }`；
自动草稿也按模式分别写入 `localStorage['wangeditor-blog-editor:draft:<modeId>']`。
切换模式时只做一件事：**把当前模式落回它自己的槽位 → 用目标模式自己的内容重建实例**。

```
switchMode(nextModeId)
 │
 ├─ 1. 落回自己       docs[当前].html = editor.getHtml()   ← 只写回「自己」的槽位，且仅在真正换模式时执行
 ├─ 2. 销毁旧实例     editor.destroy()                     ← 官方 API，内部连带销毁 textarea / toolbar / hoverbar
 │                    mode.onUnmount()                     ← 解绑该模式自己加的监听
 ├─ 3. 换皮肤与标识   body[data-mode] / html[data-app-mode] / 顶栏按钮态
 ├─ 4. 重建实例       AppEditor.create(mode, { html: 空白, onChange, onSelectionChange })
 │                    → 内容走安全通道恢复：coalesceRuns 预合并 + setHtml 兜底 try/catch
 │                    → E.createEditor({ selector:'#editor-text-area', … })
 │                    → E.createToolbar({ editor, selector:'#editor-toolbar', … })
 ├─ 5. 同步地址栏     location.hash = #<modeId>
 ├─ 6. 记住模式       localStorage['…:last-mode'] = modeId ← 下次打开回到同一模式
 └─ 7. 刷新界面       状态栏 / 源码抽屉 / 统计行（注意：此处不触发自动保存，防止空内容覆盖旧草稿）
```

**为什么同一时刻只保留一个实例**：两种模式的 `scroll`、工具栏布局、宿主 DOM 结构都不同，
单实例无法同时满足；而 `editor.isDestroyed` 与 `editor.destroy()` 是官方提供的幂等销毁入口，
所以「销毁旧的 → 用目标模式的 HTML 新建」比「双实例互切」更干净，也不会残留 DOM 与事件。
自检中对这两点有断言：`同一时刻只有一个编辑器实例`、`舞台内不残留上一模式的 DOM`。

**内容为什么各自独立**：内容从不驻留在 DOM 里，而是每次切换前用 `editor.getHtml()` 落回
**当前模式自己的**槽位，重建时只读取**目标模式自己的**槽位。因此 default → qqdoc → default
往返后，默认模式的内容原样还在，而 qqdoc 里的编辑结果**不会**出现在默认模式里。

### 3.3 草稿恢复与崩溃防护

**恢复确认**：刷新页面后若存在非空草稿，默认（`restore-pref = ask`）弹窗询问
「恢复草稿 / 从空白开始」，可勾选「记住我的选择」（`auto` / `never`）不再询问。

**崩溃防护（wangEditor 5.1.23 已知缺陷）**：从网页复制粘贴的内容常带有
`<p><span>a，</span><span>b，</span><span>c。</span></p>` 这类相邻同格式文本片段，
wangEditor 在 Slate 归一化时会对同一路径重复执行两次 `merge_node`，直接抛出
`Cannot find a descendant at path [x,1]` 导致编辑器初始化失败。对策分三层：

1. **预防**：所有内容入口（草稿恢复 / 导入 / 模板 / 打开存档）先过
   `Templates.coalesceRuns()`，在 DOM 层把相邻同格式片段合并成一个；
2. **兜底**：`setHtml` 再包 try/catch —— 万一仍崩溃，编辑器保住、原文写入
   `localStorage['…:failed-restore:<modeId>']`，弹窗提供「导出草稿备份 / 从空白开始」；
3. **防误覆盖**：实例重建不触发自动保存，自动保存只由真实编辑行为（onChange）驱动。

自检断言：`coalesceRuns：相邻同格式 span 合并为一个`、`草稿恢复偏好默认 ask` 等。
自检断言：`模式独立：qqdoc 的编辑结果没有进入默认模式`、`切回默认模式：它自己的内容仍在`、
`草稿 key 按模式区分（两个 key 都存在）`。

> 两个模式后续可以各自独立调整：改 `js/modes/<id>.mode.js` 的模板 / 配置、
> `css/mode-<id>.css` 的皮肤，都不会波及其他模式——它们不共享任何渲染状态。

**为什么不会切出野实例**：`#editor-toolbar` / `#editor-text-area` 两个 id 在每个模板中各出现一次，
同一时刻页面上只有一套模板，因此官方 API 要求的字符串选择器始终唯一命中；模板缺节点时工厂会抛出
明确错误并在舞台上渲染 `.stage-error` 提示，而不是静默失败。

---

## 四、功能清单

| 顶栏按钮 | 行为 | 关键实现 |
| --- | --- | --- |
| **复制** | 有选中内容则复制选区，否则复制全文；同时写入 `text/html` + `text/plain`，粘到 Word / 公众号保留格式 | `AppClipboard.copyRich()`；异步 Clipboard API 不可用时回退 `execCommand('copy')` |
| **复制 HTML** | 复制原始 HTML 源码字符串 | `AppClipboard.copyPlain()` |
| **预览** | 模态框内以只读文档渲染「导出后的最终效果」，可导出 / 新窗口打开 / 复制源码 | `AppExporter.buildDocument()` → `iframe.srcdoc`（与导出文件同源同构） |
| **导出 HTML** | 下载独立可打开的 `文档-年月日-时分.html`，版式随当前模式 | `AppExporter.buildDocument()` + `download()`；内容与当前模式见 [4.1](#41-导出规则内容一致--模式独立) |
| **保存** | 打开「本地存档」模态框：命名保存当前文档、列出历史存档（打开 / 删除） | `AppStorage.saveSlot/listSlots/removeSlot`（localStorage，同名覆盖） |
| **导入** | 粘贴 HTML 源码或选择本地 `.html` 文件；完整文档会自动剥掉 `<article class="doc">` 外壳只取正文 | `DOMParser` + `editor.setHtml()` |
| **示例** | 注入内置示例内容（写入当前模式自己的文档） | `js/content/sample.js` |
| **清空** | 二次确认后清空**当前模式**的编辑内容（不影响另一模式） | — |
| **源码** | 右侧抽屉展示格式化后的 HTML 源码，可刷新 / 复制 | `AppExporter.prettyHtml()` |

其他：

- **自动草稿**：内容变更后 800ms 节流写入 localStorage，**按模式分别存**
  （`draft:default` / `draft:qqdoc`）；`visibilitychange` 与 `beforeunload` 再兜底一次；
  下次打开按「上次所处的模式」恢复该模式自己的草稿（状态栏显示「自动保存 HH:MM」/「已恢复草稿 HH:MM」）。
- **状态栏**：当前模式、字数、选中字数、草稿状态、操作提示。
- **快捷键**：`Ctrl/Cmd + S` 打开存档、`Esc` 关闭模态框。
- **全屏编辑（默认模式）**：点击工具栏「全屏」按钮后，编辑器容器铺满视口，
  应用自己的顶栏、状态栏、源码抽屉全部隐藏；退出全屏后自动还原。
  实现：`editor.on('fullScreen' / 'unFullScreen')` 给 `<body>` 切换 `is-editor-fullscreen` 类，
  同时提升 `.w-e-full-screen-container` 的 `z-index` 并把编辑区设为 `flex:1`。
- **图片 / 视频**：无服务端也能跑 —— 本地图片 < 10MB 走 wangEditor 的 base64 直插，
  更大的与本地视频通过 `MENU_CONF.uploadImage/uploadVideo.customUpload` 转为 dataURL 插入（大小上限 10MB / 20MB）；
  「网络图片」「插入视频」按 URL 输入，开箱即用。
- **调试入口**：`window.App.switchMode('qqdoc')`、`window.App.state`、`window.App.errors`。

### 4.1 导出规则：两种模式各按定位导出

「预览」与「导出 HTML」共用 `AppExporter.buildDocument({ html, mode })`。
两个模式走**两条不同的导出策略**，由 `MODE_SKINS[mode].bare` 开关分派。

**① 默认模式 = 纯内容导出（`bare: true`）**

整个文件只有 6 行外壳，其余全是编辑器正文：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
</head>
<body data-mode="default">
…editor.getHtml() 原样输出…
</body>
</html>
```

| 不注入的东西 | 原因 |
| --- | --- |
| `<style>` 块 | 纯内容导出，排版交给目标站点（博客 / BBS 后台）的样式 |
| `generator` / `source-mode` / `exported-at` 等 `<meta>` | 导出内容里不需要这类元信息 |
| `<article class="doc …">` 包装节点 | 只需要一个 `<body>` |
| 空 `<title>` | 没有标题就不输出该节点 |

保留三样是**功能性必需**，不是装饰：`<!DOCTYPE html>`（避免浏览器进入怪异模式）、
`<meta charset="UTF-8">`（没有它中文可能乱码）、`<body>`。

**② 仿腾讯文档模式 = 完整文档导出**

保留完整 `<head>`（viewport / meta / 内嵌样式）与 `<article class="doc doc--qqdoc">` 外壳，
双击即还原「浅灰画布 + 850px 白色纸张」，样式块内已含中文友好的排版规则与
`word-wrap:break-word; overflow-wrap:break-word`（超长英文 / 链接会像编辑器里一样换行）。

**③ 两种模式仍然各自独立**

两份导出文件的差异是结构性的（一个有样式块与外壳、一个没有），
并且都带 `<body data-mode="default|qqdoc">`，便于再次导入时识别来源模式 ——
`js/app.js` 的 `extractImport()` 会优先取 `article.doc` 的 innerHTML，没有该节点则直接取 `<body>`。

**④ 共同规则：正文零注入**

| 项 | 行为 |
| --- | --- |
| 正文 | 原样来自 `editor.getHtml()`，不包装、不改写、不追加页脚 |
| 空文档 | 导出结果就是 `<p><br></p>`，不出现「未命名文档」之类占位文案 |

> `buildDocument()` 另支持可选的 `title` 参数（传入才输出 `<h1>`）。
> 当前两个模式都没有标题栏，应用**不会**传它，保留该参数是为了后续单独给某个模式加标题栏时无须改导出层。

> 历史问题：早期版本会在正文写死一行 `wangEditor v5 · …模式 · 导出于 …` 水印，并把空标题填成「未命名文档」；
> 同时 `buildDocument()` 只有一套外壳，`mode` 仅用于拼那句水印，导致两种模式导出的 HTML 除该句外完全一致。
> 现已移除注入文案、按模式分派版式，并在自检中加入对应断言（见 [五](#五自动化自检)）。

---

## 五、自动化自检

```bash
# 前提：本地服务已在 8321 端口运行
# 浏览器打开 http://127.0.0.1:8321/_selftest.html
```

自检页在 `<iframe>` 中加载真实的 `index.html?demo=1`，跨模式断言 65 项，覆盖：
依赖与初始化、默认模式的 DOM 与 `scroll: true`、`setHtml/getHtml` 往返、统计口径、
**导出内容一致性**（空文档不注入「未命名文档」、无水印行、正文与 `getHtml()` 逐字一致）与
**导出模式独立性**（两模式导出互不相同、默认模式无 `<style>` / 无 `<article>` / 外壳≤10 行、
qqdoc 保留 `doc--qqdoc` 外壳与灰底 + 850px 白纸、`data-mode` 各自正确、
qqdoc 样式含超长文本换行规则）、
localStorage 增删查、**模式内容独立性**（qqdoc 有自己的内容、默认模式的编辑不进入 qqdoc、
切回后各自内容仍在、自动草稿按模式分 key 存储）、qqdoc 纸张内**无**标题栏、纸张宽度 850px /
工具栏背景 `#FCFCFC` / 按钮数 41 → 40（仅差 fullScreen）/ `scroll: false`、
模式按钮上无「对齐xxx示例」注释、实例隔离、剪贴板 API、运行期无未捕获错误。
当前结果：**65 passed / 0 failed**。

---

## 六、还原口径与已知边界

- 工具栏按钮数 41 → 40 的差异**只来自**官方那句 `excludeKeys: 'fullScreen'`；
  官方写的是字符串（依赖 `String.prototype.includes` 恰好成立），本项目改为规范数组 `['fullScreen']`，效果一致。
- 官方 `like-qq-doc` 示例的纸张顶部有一个 30px 大标题输入框；按需求本项目**去掉了该标题栏**，
  纸张顶部直接开始正文。`js/modes/qqdoc.mode.js`、`css/mode-qqdoc.css`、`index.html` 中
  均不再有任何标题 / `#doc-title` 相关节点与样式。
- 两个模式**不共享任何渲染状态**：文档（`docs[modeId]`）、自动草稿（`draft:<modeId>`）、
  模板、皮肤、`editorConfig` 全部按模式分开，可各自独立调整而互不影响。
- 官方 `scroll: false` 时编辑器高度会溢出纸张容器，本项目在 `mode-qqdoc.css` 中把
  `.w-e-text-container` / `.w-e-scroll` 的高度改为 `auto`，让白色纸张随内容自然增长（版式更接近在线文档）。
- 编辑区默认高度按官方取 500px，屏幕较高时（`min-height: 960px`）放宽到 620px；
  「固定高度 + 内部滚动」的交互模型不变。
- **默认模式的导出是纯内容、不带任何样式**（按需求如此设计）。因此把导出的 `.html` 单独双击打开时，
  渲染用的是浏览器默认样式：观感朴素，且**超长英文单词 / 长 URL 不会被断开**（浏览器默认
  `overflow-wrap: normal`），窗口较窄时会向右溢出。这是「零样式导出」的固有取舍 ——
  正文贴进博客 / BBS 后由站点的样式接管，通常不存在该问题。若希望独立打开也不溢出，
  在 `js/features/exporter.js` 的 `buildDocument()` 里给 `<body>` 加一个属性即可：
  `<body data-mode="default" style="overflow-wrap:break-word">`。
- 图片 / 视频以 base64 内嵌，适合单文档场景；若用于生产环境，建议给 `MENU_CONF.uploadImage.server`
  配置上传接口替换 `customUpload`。
- 存档保存在浏览器 localStorage，会受配额限制（含大量 base64 图片时可能写失败并提示「超配额」）；
  需要跨机器保存请用「导出 HTML」。
