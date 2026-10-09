/* ==========================================================================
   app.js — 应用引导与编排
     · 模式切换机制：两种模式**完全独立** —— 各自持有自己的文档与自动草稿。
       切换时先把当前模式的现场落回它自己的槽位，再用目标模式自己的内容重建实例，
       模式之间不传递任何内容。
     · 顶栏动作：复制 / 复制 HTML / 预览 / 导出 HTML / 保存 / 导入 / 示例 / 清空 / 源码
     · 状态栏：当前模式、字数、选中字数、草稿状态
     · 自动草稿：变更后节流写入 localStorage（**按模式分别存储**），关闭页面前再兜底一次
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;
  var Storage = global.AppStorage;
  var Clipboard = global.AppClipboard;
  var Exporter = global.AppExporter;
  var Templates = global.AppTemplates;
  var Modes = global.AppModes || {};
  var DEFAULT_MODE = 'default';
  var DRAFT_DEBOUNCE = 800;
  var EMPTY_HTML = '<p><br></p>';
  var MAX_THUMBS = 24;

  // 每个模式一份独立文档：docs[modeId] = { html, templateId }
  // templateId 记住该文档套用的模板（版式层），为空表示不套版式。
  var docs = {};

  function blankDoc() { return { html: EMPTY_HTML, templateId: '' }; }

  function ensureDocs() {
    Object.keys(Modes).forEach(function (id) {
      if (!docs[id]) docs[id] = blankDoc();
    });
  }

  function currentDoc() {
    var id = state.modeId || DEFAULT_MODE;
    if (!docs[id]) docs[id] = blankDoc();
    return docs[id];
  }

  // templates/ 目录下的外部系统模板（运行期异步加载）
  var externalTemplates = [];

  var state = {
    modeId: null,
    docs: docs,      // 各模式各自的文档（同一引用，便于调试 / 自检）
    instance: null   // { editor, toolbar, destroy(), getStats() ... }
  };

  // 运行时错误收集（便于排查，也方便自动化自检读取）
  var runtimeErrors = [];
  global.addEventListener('error', function (event) {
    runtimeErrors.push('error: ' + (event.message || event.type));
  });
  global.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    runtimeErrors.push('unhandledrejection: ' + (reason && reason.message ? reason.message : reason));
  });

  /* ======================= 基础工具 ======================= */

  function $(selector, root) { return (root || doc).querySelector(selector); }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || doc).querySelectorAll(selector));
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function datetime(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + clock(ts);
  }

  var toastTimer = null;
  function toast(message, isError) {
    var node = doc.getElementById('toast');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    node.classList.toggle('is-error', !!isError);
    // 强制回流后再加类，保证过渡动画生效
    void node.offsetWidth;
    node.classList.add('is-show');
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      node.classList.remove('is-show');
      global.setTimeout(function () { node.hidden = true; }, 220);
    }, 2200);
  }

  function setStatus(name, value) {
    var node = $('[data-status="' + name + '"]');
    if (node) node.textContent = value;
  }

  function setHint(text) { setStatus('hint', text); }

  /* ======================= 内容读取 ======================= */

  function liveEditor() {
    var inst = state.instance;
    if (inst && inst.editor && !inst.editor.isDestroyed) return inst.editor;
    return null;
  }

  function currentHtml() {
    var editor = liveEditor();
    return editor ? editor.getHtml() : currentDoc().html;
  }

  function currentText() {
    var editor = liveEditor();
    return editor ? String(editor.getText() || '') : '';
  }

  /** 取当前选区的 HTML 片段（无选区返回空串） */
  function selectedHtml() {
    var sel = global.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    var range = sel.getRangeAt(0);
    var host = doc.createElement('div');
    host.appendChild(range.cloneContents());
    return host.innerHTML;
  }

  /* ======================= 状态栏 / 源码面板 ======================= */

  function refreshStats() {
    var inst = state.instance;
    if (!inst) return;
    var stats = inst.getStats();
    setStatus('total', stats.total);
    setStatus('selected', stats.selected);

    // 默认模式下的官方统计行
    var totalNode = $('[data-stat="total-length"]');
    if (totalNode) totalNode.textContent = stats.total;
    var selNode = $('[data-stat="selected-length"]');
    if (selNode) selNode.textContent = stats.selected;
  }

  function refreshSource() {
    var code = $('[data-role="source-code"]');
    var html = currentHtml();
    if (code) code.textContent = Exporter.prettyHtml(html);
    setStatus('source-size', Exporter.byteSize(html));
  }

  var sourceTimer = null;
  function refreshSourceSoon() {
    if (sourceTimer) global.clearTimeout(sourceTimer);
    sourceTimer = global.setTimeout(refreshSource, 300);
  }

  /* ======================= 自动草稿 ======================= */

  var draftTimer = null;
  function refreshDraftStatus(text) {
    setStatus('draft', text || '未保存');
  }

  function saveDraftNow() {
    if (!Storage.available) { refreshDraftStatus('不可用'); return; }
    var ok = Storage.saveDraft(state.modeId, {
      html: currentHtml(),
      templateId: currentDoc().templateId || ''
    });
    refreshDraftStatus(ok ? '自动保存 ' + clock(Date.now()) : '超配额');
  }

  function scheduleDraft() {
    if (draftTimer) global.clearTimeout(draftTimer);
    draftTimer = global.setTimeout(saveDraftNow, DRAFT_DEBOUNCE);
  }

  /* ======================= 模式切换 ======================= */

  function updateModeButtons() {
    $$('.mode-btn').forEach(function (btn) {
      var active = btn.getAttribute('data-mode') === state.modeId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderStageError(err) {
    var stage = doc.getElementById('editor-stage');
    var message = err && err.message ? err.message : String(err);
    stage.innerHTML = '';
    var box = doc.createElement('div');
    box.className = 'stage-error';
    box.innerHTML =
      '<strong>编辑器初始化失败</strong><br />' +
      '<span></span><br />' +
      '请确认 <code>vendor/wangeditor/index.js</code> 与 <code>vendor/wangeditor/style.css</code> ' +
      '已被完整下载（可直接双击 index.html，或通过本地 HTTP 服务打开）。';
    box.querySelector('span').textContent = message;
    stage.appendChild(box);
  }

  /* ======================= 内容安全通道 =======================

     所有「HTML → 编辑器」的入口都必须走 setEditorHtmlSafe：
     1) 先经 Templates.coalesceRuns() 预合并相邻同格式文本片段
        （wangEditor 5.1.23 对 ≥3 个相邻片段会在 Slate 归一化时崩溃）；
     2) setHtml 再包一层 try/catch —— 万一仍崩溃，编辑器保住、
        原文存进 failed-restore 备份键，弹窗提供「导出备份 / 从空白开始」。 */

  function resetEditorBlank() {
    try {
      state.instance.setHtml(EMPTY_HTML);
      return true;
    } catch (e) { /* 继续走重建 */ }

    try { state.instance.destroy(); } catch (e) { /* noop */ }
    var mode = Modes[state.modeId];
    if (!mode) return false;
    try {
      state.instance = global.AppEditor.create(mode, {
        html: EMPTY_HTML,
        onChange: function () {
          refreshStats();
          refreshSourceSoon();
          scheduleDraft();
        },
        onSelectionChange: refreshStats
      });
      return true;
    } catch (e) {
      renderStageError(e);
      return false;
    }
  }

  /**
   * 把 HTML 安全地灌入当前编辑器（草稿恢复 / 导入 / 模板共用）。
   * @returns {boolean} 是否成功
   */
  function setEditorHtmlSafe(html) {
    var editor = liveEditor();
    if (!editor) return false;
    var safe = Templates.coalesceRuns(html);

    try {
      editor.setHtml(safe);
      currentDoc().html = safe;
      return true;
    } catch (err) {
      // 原文备份：不清 localStorage，留给用户导出找回
      Storage.saveFailedRestore(state.modeId, html);
      runtimeErrors.push({
        at: 'setEditorHtmlSafe',
        message: err && err.message ? String(err.message).slice(0, 300) : String(err),
        time: Date.now()
      });
      resetEditorBlank();
      currentDoc().html = EMPTY_HTML;
      openFailedRestoreModal(err);
      return false;
    }
  }

  /** 恢复失败兜底弹窗：导出备份 or 放弃 */
  function openFailedRestoreModal(err) {
    var wrap = doc.createElement('div');

    var hint = doc.createElement('p');
    hint.className = 'import-hint';
    hint.textContent = '内容恢复失败（编辑器格式引擎崩溃，多为网页粘贴产生的特殊片段结构）。' +
      '原文已留存，可导出 .html 备份后用「导入」分段找回；或从空白重新开始。';
    wrap.appendChild(hint);

    if (err && err.message) {
      var detail = doc.createElement('p');
      detail.className = 'tpl-error-detail';
      detail.textContent = '技术细节：' + String(err.message).slice(0, 160);
      wrap.appendChild(detail);
    }

    var row = doc.createElement('div');
    row.className = 'save-row';
    row.appendChild(makeButton('导出草稿备份', 'btn btn-primary', function () {
      var backup = Storage.getFailedRestore(state.modeId);
      var html = (backup && backup.html) || '';
      Exporter.download(
        Exporter.safeFilename('草稿备份-' + Exporter.timestamp(), '.html', '草稿备份'),
        Exporter.buildDocument({ html: html, mode: state.modeId }),
        'text/html'
      );
      Storage.clearFailedRestore(state.modeId);
      closeModal();
      toast('已导出草稿备份，本地草稿已清空');
      refreshDraftStatus('未保存');
    }));
    row.appendChild(makeButton('从空白开始', 'btn', function () {
      Storage.clearDraft(state.modeId);
      Storage.clearFailedRestore(state.modeId);
      closeModal();
      refreshDraftStatus('未保存');
      setHint('已从空白开始');
    }));
    wrap.appendChild(row);

    openModal({ title: '草稿恢复失败', node: wrap, bodyClass: 'is-plain' });
  }

  /**
   * 切换模式
   * 两种模式完全独立：只把「当前模式」的现场写回它自己的文档槽，
   * 再用「目标模式」自己的文档重建实例 —— 不存在跨模式的内容交接。
   * @param {string} modeId  目标模式 id
   * @param {object} options { force, silent }
   */
  function switchMode(modeId, options) {
    options = options || {};
    var mode = Modes[modeId];
    if (!mode) return;

    var sameMode = state.instance && state.modeId === modeId;
    if (sameMode && !options.force) return;

    // ---- 1) 把当前模式的现场落回它自己的文档槽（仅真正换模式时）----
    if (state.instance && state.modeId !== modeId) {
      currentDoc().html = currentHtml();
    }

    // ---- 2) 销毁旧实例（editor.destroy() 会连带销毁 toolbar）----
    if (state.instance) {
      try { state.instance.destroy(); } catch (e) { global.console && global.console.warn(e); }
      state.instance = null;
    }

    // ---- 3) 切换皮肤与模式标识 ----
    state.modeId = modeId;
    doc.body.setAttribute('data-mode', modeId);
    doc.documentElement.setAttribute('data-app-mode', modeId);
    updateModeButtons();

    // ---- 4) 用「目标模式自己的文档」重建新实例 ----
    // 编辑器先以空白创建，内容一律走安全通道恢复：
    // 内容崩溃时保住编辑器，原文进 failed-restore 备份，而不是整个舞台报错。
    try {
      var restoreHtml = currentDoc().html || EMPTY_HTML;
      state.instance = global.AppEditor.create(mode, {
        html: EMPTY_HTML,
        onChange: function () {
          refreshStats();
          refreshSourceSoon();
          scheduleDraft();
        },
        onSelectionChange: refreshStats
      });
      if (restoreHtml && restoreHtml !== EMPTY_HTML) {
        setEditorHtmlSafe(restoreHtml);
      }
    } catch (err) {
      renderStageError(err);
      return;
    }

    // ---- 5) 同步地址栏，支持 #qqdoc 直接进入某个模式 ----
    if (!options.silent) {
      var hash = '#' + modeId;
      if (global.location.hash !== hash) {
        try {
          global.history.replaceState(null, '', global.location.pathname + global.location.search + hash);
        } catch (e) {
          global.location.hash = modeId;
        }
      }
    }

    // ---- 6) 记下当前模式，下次打开回到同一模式 ----
    Storage.saveLastMode(modeId);

    // ---- 7) 界面状态 ----
    // 注意：这里不能 scheduleDraft() —— 启动/切换时若编辑器还是空白，
    // 自动保存会用空内容覆盖掉 localStorage 里的旧草稿（数据丢失）。
    // 自动保存只由 onChange（真实编辑行为）驱动。
    setStatus('mode', mode.label);
    setHint(mode.description || '');
    refreshTemplateStatus();
    refreshStats();
    refreshSource();
  }

  /* ======================= 模态框 ======================= */

  function makeButton(label, className, onClick) {
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = className || 'btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function openModal(config) {
    var root = doc.getElementById('modal-root');
    var body = doc.getElementById('modal-body');
    var tools = doc.getElementById('modal-tools');

    doc.getElementById('modal-title').textContent = config.title || '';
    body.className = 'modal-body' + (config.bodyClass ? ' ' + config.bodyClass : '');
    body.innerHTML = '';
    tools.innerHTML = '';

    if (config.node) body.appendChild(config.node);
    (config.tools || []).forEach(function (t) { tools.appendChild(t); });

    root.hidden = false;
  }

  function closeModal() {
    var root = doc.getElementById('modal-root');
    if (!root || root.hidden) return;
    root.hidden = true;
    doc.getElementById('modal-body').innerHTML = '';
    doc.getElementById('modal-tools').innerHTML = '';
  }

  /* ======================= 动作实现 ======================= */

  /** 导出载荷：正文原样来自编辑器；模板版式（若有）优先于模式外壳 */
  function documentPayload() {
    return {
      html: currentHtml(),
      mode: state.modeId,
      template: currentTemplate()
    };
  }

  function buildExportHtml() {
    return Exporter.buildDocument(documentPayload());
  }

  /* ---- 复制（富文本）---- */
  function actionCopy() {
    var editor = liveEditor();
    if (!editor) { toast('编辑器尚未就绪', true); return; }

    var selHtml = selectedHtml();
    var selText = '';
    try { selText = editor.getSelectionText() || ''; } catch (e) { selText = ''; }

    var useSelection = !!selHtml && !!selText;
    var html = useSelection ? selHtml : currentHtml();
    var text = useSelection ? selText : currentText();

    Clipboard.copyRich(html, text).then(function (ok) {
      if (!ok) { toast('复制失败：请手动选中内容后按 Ctrl+C', true); return; }
      toast(useSelection
        ? '已复制选中内容（' + selText.length + ' 字，保留格式）'
        : '已复制全文（' + text.replace(/\n/g, '').length + ' 字，保留格式）');
    });
  }

  /* ---- 复制 HTML 源码 ---- */
  function actionCopyHtml() {
    var html = currentHtml();
    Clipboard.copyPlain(html).then(function (ok) {
      toast(ok ? '已复制 HTML 源码（' + Exporter.byteSize(html) + '）' : '复制失败', !ok);
    });
  }

  function actionCopySource() {
    var pretty = Exporter.prettyHtml(currentHtml());
    Clipboard.copyPlain(pretty).then(function (ok) {
      toast(ok ? '已复制格式化后的 HTML 源码' : '复制失败', !ok);
    });
  }

  /* ---- 预览 ---- */
  function actionPreview() {
    var srcdoc = buildExportHtml();
    var frame = doc.createElement('iframe');
    frame.setAttribute('title', '导出预览');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.srcdoc = srcdoc;

    var tools = [
      makeButton('导出 HTML', 'btn btn-primary', function () { actionExport(); }),
      makeButton('在新窗口打开', 'btn', function () {
        var url = global.URL.createObjectURL(new global.Blob([srcdoc], { type: 'text/html;charset=utf-8' }));
        var win = global.open(url, '_blank');
        if (!win) toast('新窗口被浏览器拦截，请改用「导出 HTML」', true);
        global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 60000);
      }),
      makeButton('复制源码', 'btn', actionCopySource)
    ];

    openModal({ title: '预览（导出效果）', node: frame, tools: tools, bodyClass: 'is-frame' });
  }

  /* ---- 导出 HTML 文件 ---- */
  function actionExport() {
    var html = Exporter.buildDocument(documentPayload());
    var filename = Exporter.safeFilename('文档-' + Exporter.timestamp(), '.html', '文档');

    Exporter.download(filename, html, 'text/html');
    toast('已导出：' + filename);
    setHint('导出文件：' + filename);
  }

  /* ---- 保存到本地（存档列表）---- */
  function renderSlotList(host) {
    host.innerHTML = '';
    var slots = Storage.listSlots();

    if (!Storage.available) {
      var warn = doc.createElement('p');
      warn.className = 'import-hint';
      warn.textContent = '当前浏览器禁用了 localStorage（隐私模式或站点限制），无法保存到本地。可改用「导出 HTML」保存为文件。';
      host.appendChild(warn);
      return;
    }

    if (!slots.length) {
      var empty = doc.createElement('p');
      empty.className = 'import-hint';
      empty.textContent = '暂无本地存档。';
      host.appendChild(empty);
      return;
    }

    var list = doc.createElement('ul');
    list.className = 'slot-list';

    slots.forEach(function (slot) {
      var li = doc.createElement('li');
      li.className = 'slot-item';

      var main = doc.createElement('div');
      main.className = 'slot-main';
      var name = doc.createElement('span');
      name.className = 'slot-name';
      name.textContent = slot.name;
      var meta = doc.createElement('span');
      meta.className = 'slot-meta';
      var tpl = slot.templateId ? findTemplate(slot.templateId) : null;
      meta.textContent = (Modes[slot.mode] ? Modes[slot.mode].label : slot.mode) +
        (slot.templateId ? ' · 模板 ' + (tpl ? tpl.name : '已失效') : '') +
        ' · ' + Exporter.byteSize(slot.html || '') + ' · ' + datetime(slot.updatedAt);
      main.appendChild(name);
      main.appendChild(meta);

      var actions = doc.createElement('div');
      actions.className = 'slot-actions';
      actions.appendChild(makeButton('打开', 'btn btn-mini', function () {
        openSlot(slot);
      }));
      actions.appendChild(makeButton('删除', 'btn btn-mini', function () {
        Storage.removeSlot(slot.id);
        renderSlotList(host);
        toast('已删除存档：' + slot.name);
      }));

      li.appendChild(main);
      li.appendChild(actions);
      list.appendChild(li);
    });

    host.appendChild(list);
  }

  function openSlot(slot) {
    var modeId = Modes[slot.mode] ? slot.mode : DEFAULT_MODE;

    // 写进「该模式自己的」文档槽，再切过去 —— 模式之间不共享内容
    if (!docs[modeId]) docs[modeId] = blankDoc();
    docs[modeId].html = slot.html || EMPTY_HTML;
    docs[modeId].templateId = slot.templateId || '';

    closeModal();
    switchMode(modeId, { force: true });
    toast('已打开存档：' + slot.name);
    setHint('已打开存档：' + slot.name);
  }

  function actionSave() {
    var wrap = doc.createElement('div');

    var hint = doc.createElement('p');
    hint.className = 'import-hint';
    hint.textContent = '存档保存在本机浏览器（localStorage），不会上传；同名存档会被覆盖。若需跨机器保存，请用「导出 HTML」。';
    wrap.appendChild(hint);

    var row = doc.createElement('div');
    row.className = 'save-row';

    var input = doc.createElement('input');
    input.type = 'text';
    input.className = 'save-input';
    input.placeholder = '存档名称，例如：文档-01';
    input.value = '文档-' + Exporter.timestamp();
    row.appendChild(input);

    var listHost = doc.createElement('div');

    row.appendChild(makeButton('保存当前文档', 'btn btn-primary', function () {
      var item = Storage.saveSlot(input.value, {
        html: currentHtml(),
        mode: state.modeId,
        templateId: currentDoc().templateId || ''
      });
      if (!item) {
        toast('保存失败：本地存储不可用或已超出配额', true);
        return;
      }
      refreshDraftStatus('已保存 ' + clock(Date.now()));
      renderSlotList(listHost);
      toast('已保存到本地：' + item.name);
    }));

    wrap.appendChild(row);
    wrap.appendChild(listHost);
    renderSlotList(listHost);

    openModal({ title: '本地存档', node: wrap, bodyClass: 'is-plain' });
  }

  /* ---- 导入 ---- */
  function extractImport(raw) {
    var trimmed = String(raw || '').trim();
    var looksLikeDocument = /^<!doctype/i.test(trimmed) ||
      /<html[\s>]/i.test(trimmed) ||
      /<body[\s>]/i.test(trimmed);

    if (looksLikeDocument) {
      try {
        var parsed = new global.DOMParser().parseFromString(trimmed, 'text/html');
        // 仿腾讯文档模式的导出外层是 <article class="doc …">：取其内部内容，
        // 避免把文档外壳（模式皮肤）一起塞进编辑器；
        // 默认模式是纯内容导出（没有 article），直接取 body。
        var host = parsed.querySelector('article.doc') || parsed.body;
        var styles = Array.prototype.slice.call(parsed.querySelectorAll('style'))
          .map(function (s) { return s.textContent; }).join('\n');
        return {
          html: host ? host.innerHTML : trimmed,
          css: Templates.stripBaseCss(styles, Exporter.BASE_CSS)
        };
      } catch (e) { /* 落到下面的兜底分支 */ }
    }
    return { html: trimmed, css: '' };
  }

  function applyImport(result, sourceLabel) {
    if (!result.html) { toast('没有可导入的内容', true); return; }
    var editor = liveEditor();
    if (!editor) { toast('编辑器尚未就绪', true); return; }

    var target = currentDoc();
    // 「导入 HTML」只导入正文：版式层不属于正文，需要走「模板 → 导入模板文件」
    target.templateId = '';

    if (!setEditorHtmlSafe(result.html)) {
      toast('导入失败：内容触发了编辑器格式引擎的已知崩溃，原文已留存', true);
      return;
    }

    refreshStats();
    refreshSource();
    refreshTemplateStatus();
    saveDraftNow();
    closeModal();
    toast('已导入' + (sourceLabel ? '：' + sourceLabel : ''));

    if (result.css) {
      setHint('文件里含版式样式，已忽略 —— 如需保留，请用「模板 → 导入模板文件」');
    }
  }

  function actionImport() {
    var wrap = doc.createElement('div');

    var hint = doc.createElement('p');
    hint.className = 'import-hint';
    hint.textContent = '粘贴完整 HTML 源码，或选择本地 .html 文件。导入将替换当前编辑内容（可先导出备份）。';
    wrap.appendChild(hint);

    var area = doc.createElement('textarea');
    area.className = 'import-area';
    area.placeholder = '<h1>文章标题</h1>\n<p>正文内容…</p>';
    wrap.appendChild(area);

    var fileInput = doc.getElementById('import-file');
    var tools = [
      makeButton('选择本地文件', 'btn', function () {
        fileInput.value = '';
        fileInput.click();
      }),
      makeButton('导入', 'btn btn-primary', function () {
        applyImport(extractImport(area.value), '粘贴的源码');
      })
    ];

    fileInput.onchange = function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new global.FileReader();
      reader.onload = function () {
        area.value = String(reader.result || '');
        toast('已读取文件：' + file.name + '，确认后点「导入」');
      };
      reader.onerror = function () { toast('文件读取失败', true); };
      reader.readAsText(file, 'utf-8');
    };

    openModal({ title: '导入 HTML', node: wrap, tools: tools, bodyClass: 'is-plain' });
  }

  /* ---- 示例内容 ---- */
  function actionSample() {
    var editor = liveEditor();
    if (!editor) return;
    var html = global.AppSample.html;

    var target = currentDoc();
    target.html = html;
    target.templateId = '';   // 示例内容不带模板版式

    editor.setHtml(html);

    refreshStats();
    refreshSource();
    refreshTemplateStatus();
    saveDraftNow();
    toast('已插入示例内容');
  }

  /* ---- 清空 ---- */
  function actionClear() {
    var editor = liveEditor();
    if (!editor) return;
    if (!global.confirm('确定清空当前模式的编辑内容？此操作不可撤销（可先用「导出 HTML」备份）。')) return;

    var target = currentDoc();
    target.html = EMPTY_HTML;
    target.templateId = '';   // 清空同时卸下模板版式

    editor.setHtml(EMPTY_HTML);

    refreshStats();
    refreshSource();
    refreshTemplateStatus();
    saveDraftNow();
    toast('已清空');
  }

  /* ---- 源码抽屉 ---- */
  function toggleSource(force) {
    var drawer = doc.getElementById('source-drawer');
    var open = typeof force === 'boolean' ? force : !drawer.classList.contains('is-open');
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');

    $$('[data-action="toggle-source"]').forEach(function (btn) {
      btn.classList.toggle('is-active', open && btn.classList.contains('btn-ghost'));
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (btn.classList.contains('btn-ghost')) btn.textContent = open ? '收起源码' : '源码';
    });

    if (open) refreshSource();
    global.setTimeout(function () { if (state.instance) refreshStats(); }, 220);
  }

  /* ======================= 富文本模板（双轨） =======================
     模板 = 内容层（进编辑器，可继续编辑）+ 版式层（只在预览 / 导出时注入）。
     来源三路：内置种子（JS）→ templates/ 外部文件（运行期 fetch）→ 用户自建（localStorage）。
     详见 js/content/templates.js 顶部的说明与 README「模板编写规范」。          */

  function allTemplates() {
    var out = [];

    (Templates.SEEDS || []).forEach(function (t) {
      out.push({
        id: t.id, name: t.name, note: t.note, accent: t.accent,
        content: t.content, skin: t.skin, builtin: true, source: '内置'
      });
    });

    externalTemplates.forEach(function (t) {
      out.push({
        id: t.id, name: t.name, note: t.note, accent: t.accent,
        content: t.content, skin: t.skin, builtin: true,
        external: true, source: 'templates/', notes: t.notes
      });
    });

    Storage.listTemplates().forEach(function (t) {
      out.push({
        id: t.id, name: t.name, note: t.note || '', accent: '#378add',
        content: t.content,
        skin: t.css ? { wrapperClass: t.wrapperClass || 'doc doc--tpl', css: t.css } : null,
        builtin: false, source: '我的', notes: t.notes
      });
    });

    return out;
  }

  function findTemplate(id) {
    if (!id) return null;
    var list = allTemplates();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** 当前模式文档套用的模板（找不到返回 null，例如用户清过浏览器数据） */
  function currentTemplate() {
    return findTemplate(currentDoc().templateId);
  }

  function refreshTemplateStatus() {
    var tpl = currentTemplate();
    setStatus('template', tpl ? tpl.name : '无');
  }

  /** 缩略图用的完整页面：与「导出」同源同构，所见即所得 */
  function thumbDocument(tpl) {
    return Exporter.buildDocument({
      html: tpl.content || EMPTY_HTML,
      mode: state.modeId,
      template: tpl,
      title: tpl.name
    });
  }

  function renderTemplateCard(tpl, host, refresh, withThumb) {
    var card = doc.createElement('article');
    card.className = 'tpl-card';
    card.setAttribute('data-template-id', tpl.id);
    if (tpl.accent) card.style.setProperty('--tpl-accent', tpl.accent);

    /* ---- 小窗预览：真实渲染 + 等比缩放 ---- */
    var thumb = doc.createElement('div');
    thumb.className = 'tpl-thumb';

    if (withThumb) {
      var frame = doc.createElement('iframe');
      frame.className = 'tpl-thumb-frame';
      // 最严沙箱：模板里的 <script> 一律不执行，模板文件无法影响主页面
      frame.setAttribute('sandbox', '');
      frame.setAttribute('scrolling', 'no');
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('title', tpl.name + ' 模板预览');
      frame.srcdoc = thumbDocument(tpl);
      thumb.appendChild(frame);
    } else {
      var lazy = doc.createElement('div');
      lazy.className = 'tpl-thumb-lazy';
      lazy.textContent = '（缩略图已省略）';
      thumb.appendChild(lazy);
    }

    var badge = doc.createElement('span');
    badge.className = 'tpl-badge' + (tpl.builtin ? '' : ' is-user');
    badge.textContent = tpl.source || '内置';
    thumb.appendChild(badge);
    card.appendChild(thumb);

    /* ---- 文字信息 ---- */
    var body = doc.createElement('div');
    body.className = 'tpl-body';

    var name = doc.createElement('div');
    name.className = 'tpl-name';
    name.textContent = tpl.name;
    body.appendChild(name);

    if (tpl.note) {
      var note = doc.createElement('div');
      note.className = 'tpl-note';
      note.textContent = tpl.note;
      body.appendChild(note);
    }

    // 保真预检：列出 wangEditor 承载不了、已被标准化的地方。
    // 模板若已带 notes（导入时算好的），直接沿用 —— sanitize 是幂等的，重算永远是 0。
    var tplNotes = (tpl.notes && tpl.notes.length)
      ? tpl.notes
      : Templates.sanitize(tpl.content || '').notes;
    if (tplNotes.length) {
      var details = doc.createElement('details');
      details.className = 'tpl-notes';
      var sum = doc.createElement('summary');
      sum.textContent = '标准化 ' + tplNotes.length + ' 处';
      details.appendChild(sum);
      var ul = doc.createElement('ul');
      tplNotes.forEach(function (n) {
        var li = doc.createElement('li');
        li.textContent = n;
        ul.appendChild(li);
      });
      details.appendChild(ul);
      body.appendChild(details);
    }
    card.appendChild(body);

    /* ---- 操作 ---- */
    var actions = doc.createElement('div');
    actions.className = 'tpl-actions';
    actions.appendChild(makeButton('使用模板', 'btn btn-mini btn-primary', function () {
      applyTemplate(tpl);
    }));
    actions.appendChild(makeButton('导出', 'btn btn-mini', function () {
      exportTemplate(tpl);
    }));

    if (!tpl.builtin) {
      actions.appendChild(makeButton('重命名', 'btn btn-mini', function () {
        var next = global.prompt('重命名模板', tpl.name);
        if (next == null) return;
        if (!Storage.renameTemplate(tpl.id, next)) { toast('重命名失败', true); return; }
        refresh();
        toast('已重命名模板');
      }));
      actions.appendChild(makeButton('删除', 'btn btn-mini', function () {
        if (!global.confirm('确定删除模板「' + tpl.name + '」？此操作不可撤销。')) return;
        Storage.removeTemplate(tpl.id);
        refresh();
        toast('已删除模板：' + tpl.name);
      }));
    }

    card.appendChild(actions);
    host.appendChild(card);
  }

  function renderTemplateGrid(grid) {
    grid.innerHTML = '';
    var list = allTemplates();

    var groups = [
      { title: '内置模板', items: list.filter(function (t) { return t.source === '内置'; }) },
      { title: 'templates/ 目录', items: list.filter(function (t) { return t.external; }) },
      { title: '我的模板', items: list.filter(function (t) { return t.source === '我的'; }) }
    ];

    var total = 0;
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var head = doc.createElement('h3');
      head.className = 'tpl-group';
      head.textContent = g.title + ' · ' + g.items.length;
      grid.appendChild(head);
      g.items.forEach(function (tpl) {
        renderTemplateCard(tpl, grid, function () { renderTemplateGrid(grid); }, total < MAX_THUMBS);
        total++;
      });
    });

    if (!list.length) {
      var empty = doc.createElement('p');
      empty.className = 'import-hint';
      empty.textContent = '暂无模板。';
      grid.appendChild(empty);
    }
  }

  function openTemplateGallery() {
    var wrap = doc.createElement('div');
    wrap.className = 'tpl-gallery';

    var hint = doc.createElement('p');
    hint.className = 'import-hint';
    hint.innerHTML = '模板分两层：<b>正文</b>进入编辑器可继续编辑，<b>版式</b>' +
      '（背景 / 字体 / 行距 / 页宽）只在预览与导出时套用。' +
      '使用模板会替换当前模式的全部内容（当前内容会先自动存为草稿）。';
    wrap.appendChild(hint);

    var grid = doc.createElement('div');
    grid.className = 'tpl-grid';
    wrap.appendChild(grid);

    renderTemplateGrid(grid);

    var tools = [
      makeButton('从当前文档另存为模板', 'btn', function () { saveCurrentAsTemplate(grid); }),
      makeButton('导入模板文件', 'btn', function () {
        var input = doc.getElementById('template-file');
        if (!input) { toast('未找到文件输入控件', true); return; }
        input.value = '';
        input.click();
      })
    ];

    openModal({ title: '富文本模板', node: wrap, tools: tools, bodyClass: 'is-plain is-templates' });
  }

  /** 使用模板：内容层进编辑器，版式层记进当前模式的文档槽 */
  function applyTemplate(tpl) {
    var editor = liveEditor();
    if (!editor) { toast('编辑器尚未就绪', true); return; }

    var modeLabel = Modes[state.modeId] ? Modes[state.modeId].label : state.modeId;
    if (!global.confirm('使用模板「' + tpl.name + '」会替换「' + modeLabel +
      '」的全部内容（当前内容会先自动存为草稿）。是否继续？')) return;

    saveDraftNow();

    var res = Templates.sanitize(tpl.content || '');
    var target = currentDoc();
    target.templateId = tpl.id;

    if (!setEditorHtmlSafe(res.html)) {
      target.templateId = '';
      toast('模板「' + tpl.name + '」应用失败：内容触发了编辑器崩溃，已从备份找回', true);
      return;
    }
    refreshTemplateStatus();
    closeModal();

    // setHtml 的渲染是异步的：稍后再读一次统计 / 源码，避免拿到旧值
    global.setTimeout(function () {
      refreshStats();
      refreshSource();
      saveDraftNow();
    }, 80);

    toast('已应用模板：' + tpl.name + (res.notes.length ? '（标准化 ' + res.notes.length + ' 处）' : ''));
    setHint('模板「' + tpl.name + '」' + (tpl.skin ? '：导出将套用其版式' : '：无版式层，导出沿用当前模式皮肤'));
  }

  /** 导出模板文件：格式与本应用的导出文档一致，可再被「导入模板文件」读回 */
  function exportTemplate(tpl) {
    var html = Exporter.buildDocument({
      html: tpl.content || EMPTY_HTML,
      mode: state.modeId,
      template: tpl,
      title: tpl.name
    });
    var filename = Exporter.safeFilename('模板-' + tpl.name, '.html', '模板');
    Exporter.download(filename, html, 'text/html');
    toast('已导出：' + filename);
    setHint('把该文件放进项目 templates/ 目录，刷新后即成系统模板');
  }

  /** 从当前文档另存为模板（内容层 = 当前正文；版式层沿用当前模式） */
  function saveCurrentAsTemplate(grid) {
    var editor = liveEditor();
    if (!editor) { toast('编辑器尚未就绪', true); return; }

    var name = global.prompt('模板名称', '我的模板-' + Exporter.timestamp());
    if (name == null) return;
    name = String(name).trim();
    if (!name) { toast('模板名称不能为空', true); return; }

    var res = Templates.sanitize(currentHtml());
    if (!res.html || res.html === EMPTY_HTML) {
      toast('当前内容为空，未保存模板', true);
      return;
    }

    var modeLabel = Modes[state.modeId] ? Modes[state.modeId].label : state.modeId;
    var item = Storage.saveTemplate({
      name: name,
      note: '另存自当前文档（' + modeLabel + '）；版式沿用当前模式，不含自定义版式层',
      content: res.html,
      notes: res.notes
    });

    if (!item) { toast('保存失败：本地存储不可用或已超出配额', true); return; }
    if (grid) renderTemplateGrid(grid);
    toast('已保存模板：' + item.name + (res.notes.length ? '（标准化 ' + res.notes.length + ' 处）' : ''));
  }

  /** 导入模板文件：整份 HTML 拆成「正文层 + 版式层」 */
  function importTemplateFile(file, grid) {
    var reader = new global.FileReader();
    reader.onload = function () {
      var parsed = Templates.parseDocumentTemplate(String(reader.result || ''), Exporter.BASE_CSS);
      var clean = Templates.sanitize(parsed.content || '');

      if (!clean.html || clean.html === EMPTY_HTML) {
        toast('该文件里没有可用的正文内容', true);
        return;
      }

      var name = (parsed.name || file.name.replace(/\.html?$/i, '')).trim() || '导入的模板';
      var item = Storage.saveTemplate({
        name: name,
        note: parsed.note || ('导入自文件 ' + file.name + (parsed.css ? '，含版式层' : '，仅正文层')),
        content: clean.html,
        css: parsed.css || '',
        wrapperClass: 'doc doc--tpl',
        notes: clean.notes
      });

      if (!item) { toast('保存失败：本地存储不可用或已超出配额', true); return; }
      if (grid) renderTemplateGrid(grid);
      toast('已导入模板：' + item.name + (parsed.css ? '（含版式层）' : '（仅正文层）'));
      setHint('同名模板会被覆盖：' + item.name);
    };
    reader.onerror = function () { toast('文件读取失败', true); };
    reader.readAsText(file, 'utf-8');
  }

  /* ======================= 事件绑定 ======================= */

  var ACTIONS = {
    'copy': actionCopy,
    'copy-html': actionCopyHtml,
    'copy-source': actionCopySource,
    'preview': actionPreview,
    'export': actionExport,
    'save': actionSave,
    'import': actionImport,
    'templates': openTemplateGallery,
    'sample': actionSample,
    'clear': actionClear,
    'refresh-source': refreshSource,
    'toggle-source': function () { toggleSource(); }
  };

  function bindChrome() {
    $$('.mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var modeId = btn.getAttribute('data-mode');
        switchMode(modeId);
      });
    });

    doc.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!target) return;
      var name = target.getAttribute('data-action');
      if (ACTIONS[name]) {
        event.preventDefault();
        try { ACTIONS[name](); } catch (e) {
          toast('操作失败：' + (e && e.message ? e.message : e), true);
        }
      }
    });

    $$('[data-modal-close]').forEach(function (node) {
      node.addEventListener('click', closeModal);
    });

    // 模板文件导入（与「导入 HTML」分开，避免语义混淆）
    var tplFileInput = doc.getElementById('template-file');
    if (tplFileInput) {
      tplFileInput.addEventListener('change', function () {
        var file = tplFileInput.files && tplFileInput.files[0];
        if (!file) return;
        var grid = doc.querySelector('.tpl-grid');
        importTemplateFile(file, grid);
      });
    }

    doc.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'Escape') { closeModal(); return; }
      var meta = event.ctrlKey || event.metaKey;
      if (!meta) return;
      if (key === 's' || key === 'S') {
        event.preventDefault();
        actionSave();
      }
    });

    global.addEventListener('hashchange', function () {
      var modeId = global.location.hash.replace(/^#/, '');
      if (Modes[modeId] && modeId !== state.modeId) switchMode(modeId, { silent: true });
    });

    // 草稿与源码兜底：切换/关闭页面时立即落盘
    global.addEventListener('beforeunload', function () {
      if (draftTimer) global.clearTimeout(draftTimer);
      saveDraftNow();
    });

    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') saveDraftNow();
    });
  }

  /* ======================= 初始化 ======================= */

  function resolveInitialMode() {
    var byQuery = /[?&]mode=([a-zA-Z0-9_-]+)/.exec(global.location.search);
    if (byQuery && Modes[byQuery[1]]) return byQuery[1];

    var byHash = global.location.hash.replace(/^#/, '');
    if (Modes[byHash]) return byHash;

    // 上次所处的模式（草稿已按模式分开存储，模式本身单独记忆）
    var last = Storage.loadLastMode();
    if (last && Modes[last]) return last;

    return DEFAULT_MODE;
  }

  /** ?demo=1 —— 跳过草稿，直接载入示例内容（便于演示与截图） */
  function wantDemoContent() {
    return /[?&]demo=1/.test(global.location.search);
  }

  /** 草稿恢复确认：默认每次询问，勾选后记住偏好（auto / never） */
  function openDraftRestoreModal(modeId, pending) {
    var modeLabel = Modes[modeId] ? Modes[modeId].label : modeId;
    var wrap = doc.createElement('div');

    var hint = doc.createElement('p');
    hint.className = 'import-hint';
    hint.textContent = '检测到上次自动保存的「' + modeLabel + '」草稿（更新于 ' +
      datetime(pending.updatedAt || Date.now()) + '）。是否恢复到编辑器？';
    wrap.appendChild(hint);

    var chkRow = doc.createElement('label');
    chkRow.className = 'restore-pref';
    var chk = doc.createElement('input');
    chk.type = 'checkbox';
    chkRow.appendChild(chk);
    chkRow.appendChild(doc.createTextNode('记住我的选择，以后刷新不再询问'));
    wrap.appendChild(chkRow);

    var row = doc.createElement('div');
    row.className = 'save-row';

    function applyChoice(wantRestore) {
      if (chk.checked) {
        Storage.saveRestorePref(wantRestore ? 'auto' : 'never');
      }
      closeModal();
      if (!wantRestore) {
        // 草稿留在 localStorage，直到用户新内容保存时自然覆盖
        refreshDraftStatus('未保存');
        setHint('已从空白开始（旧草稿仍保留，可在刷新时恢复）');
        return;
      }
      docs[modeId].html = pending.html;
      docs[modeId].templateId = pending.templateId || '';
      if (state.modeId === modeId && setEditorHtmlSafe(pending.html)) {
        refreshStats();
        refreshSource();
        refreshTemplateStatus();
        refreshDraftStatus('已恢复草稿 ' + clock(pending.updatedAt || Date.now()));
        toast('已恢复「' + modeLabel + '」的草稿');
      }
    }

    row.appendChild(makeButton('恢复草稿', 'btn btn-primary', function () { applyChoice(true); }));
    row.appendChild(makeButton('从空白开始', 'btn', function () { applyChoice(false); }));
    wrap.appendChild(row);

    openModal({ title: '恢复草稿', node: wrap, bodyClass: 'is-plain' });
  }

  function bootstrap() {
    bindChrome();

    if (!global.AppEditor.isReady()) {
      renderStageError(new Error('wangEditor 未加载'));
      setHint('依赖缺失：请检查 vendor/wangeditor/index.js');
      return;
    }

    // 与官方示例一致：切换为中文
    if (global.wangEditor && typeof global.wangEditor.i18nChangeLanguage === 'function') {
      global.wangEditor.i18nChangeLanguage('zh-CN');
    }

    var demo = wantDemoContent();
    var initial = resolveInitialMode();

    ensureDocs();

    // 每个模式各自载入自己的草稿（含该文档套用的模板）；?demo=1 时统一载入示例内容
    Object.keys(Modes).forEach(function (id) {
      if (demo) {
        docs[id].html = global.AppSample ? global.AppSample.html : EMPTY_HTML;
        docs[id].templateId = '';
        return;
      }
      var own = Storage.available ? Storage.loadDraft(id) : null;
      docs[id].html = (own && own.html) ? own.html : EMPTY_HTML;
      docs[id].templateId = (own && own.templateId) ? own.templateId : '';
    });

    // 初始模式的草稿恢复遵循用户偏好：ask（弹窗确认）/ auto（直接恢复）/ never（空白启动）
    var pendingDraft = null;
    if (!demo) {
      var pref = Storage.loadRestorePref();
      var draft = Storage.available ? Storage.loadDraft(initial) : null;
      var hasDraft = !!(draft && draft.html && draft.html !== EMPTY_HTML);

      if (hasDraft && pref === 'ask') {
        // 先把草稿从槽位取走，编辑器以空白启动，等用户决定
        pendingDraft = {
          html: docs[initial].html,
          templateId: docs[initial].templateId || '',
          updatedAt: draft.updatedAt
        };
        docs[initial].html = EMPTY_HTML;
        docs[initial].templateId = '';
      } else if (hasDraft && pref === 'never') {
        docs[initial].html = EMPTY_HTML;
        docs[initial].templateId = '';
      }
    }

    switchMode(initial, { force: true, silent: !demo });

    if (pendingDraft) openDraftRestoreModal(initial, pendingDraft);

    // 外部系统模板（templates/ 目录）异步载入，不阻塞首屏
    if (Templates && typeof Templates.loadExternal === 'function') {
      Templates.loadExternal(Exporter.BASE_CSS).then(function (list) {
        externalTemplates = list || [];
        if (externalTemplates.length) {
          setHint('已载入 ' + externalTemplates.length + ' 个系统模板（templates/）');
        }
        refreshTemplateStatus();
      });
    }

    if (demo) {
      refreshDraftStatus('示例内容');
      setHint('已载入示例内容（?demo=1）');
    } else if (!pendingDraft) {
      var draftNow = Storage.available ? Storage.loadDraft(initial) : null;
      var autoRestored = docs[initial].html && docs[initial].html !== EMPTY_HTML;
      refreshDraftStatus(autoRestored
        ? '已恢复草稿 ' + clock((draftNow && draftNow.updatedAt) || Date.now())
        : '未保存');
      if (autoRestored) {
        toast('已恢复「' + (Modes[initial] ? Modes[initial].label : initial) +
          '」的草稿（' + clock((draftNow && draftNow.updatedAt) || Date.now()) + '）');
      }
    } else {
      refreshDraftStatus('待确认');
    }
  }

  // 暴露给控制台调试：window.App.switchMode('qqdoc') / window.App.state / window.App.docs
  global.App = {
    state: state,
    docs: docs,
    errors: runtimeErrors,
    switchMode: switchMode,
    save: actionSave,
    exportHtml: actionExport,
    preview: actionPreview,
    buildExport: buildExportHtml,
    prettyHtml: function () { return Exporter.prettyHtml(currentHtml()); },

    /* 模板相关：给控制台与自动化自检用 */
    templates: allTemplates,
    findTemplate: findTemplate,
    currentTemplate: currentTemplate,
    applyTemplate: applyTemplate,
    exportTemplate: exportTemplate,
    openTemplates: openTemplateGallery,
    sanitize: function (html) { return Templates.sanitize(html); },
    externalTemplates: function () { return externalTemplates; }
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
