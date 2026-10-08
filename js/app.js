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
  var Modes = global.AppModes || {};
  var DEFAULT_MODE = 'default';
  var DRAFT_DEBOUNCE = 800;
  var EMPTY_HTML = '<p><br></p>';

  // 每个模式一份独立文档：docs[modeId] = { html }
  var docs = {};

  function ensureDocs() {
    Object.keys(Modes).forEach(function (id) {
      if (!docs[id]) docs[id] = { html: EMPTY_HTML };
    });
  }

  function currentDoc() {
    var id = state.modeId || DEFAULT_MODE;
    if (!docs[id]) docs[id] = { html: EMPTY_HTML };
    return docs[id];
  }

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
    var ok = Storage.saveDraft(state.modeId, { html: currentHtml() });
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
    try {
      state.instance = global.AppEditor.create(mode, {
        html: currentDoc().html || EMPTY_HTML,
        onChange: function () {
          refreshStats();
          refreshSourceSoon();
          scheduleDraft();
        },
        onSelectionChange: refreshStats
      });
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
    setStatus('mode', mode.label);
    setHint(mode.description || '');
    refreshStats();
    refreshSource();
    scheduleDraft();
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

  /** 导出载荷：正文原样来自编辑器，模式决定文档外壳（两个模式导出各自独立） */
  function documentPayload() {
    return {
      html: currentHtml(),
      mode: state.modeId
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
      meta.textContent = (Modes[slot.mode] ? Modes[slot.mode].label : slot.mode) +
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
    if (!docs[modeId]) docs[modeId] = { html: EMPTY_HTML };
    docs[modeId].html = slot.html || EMPTY_HTML;

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
        mode: state.modeId
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
        // 本项目导出的文件外层是 <article class="doc …">：取其内部内容，
        // 避免把文档外壳（模式皮肤）一起塞进编辑器
        var host = parsed.querySelector('article.doc') || parsed.body;
        return { html: host ? host.innerHTML : trimmed };
      } catch (e) { /* 落到下面的兜底分支 */ }
    }
    return { html: trimmed };
  }

  function applyImport(result, sourceLabel) {
    if (!result.html) { toast('没有可导入的内容', true); return; }
    var editor = liveEditor();
    if (!editor) { toast('编辑器尚未就绪', true); return; }

    currentDoc().html = result.html;
    editor.setHtml(result.html);

    refreshStats();
    refreshSource();
    saveDraftNow();
    closeModal();
    toast('已导入' + (sourceLabel ? '：' + sourceLabel : ''));
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

    currentDoc().html = html;
    editor.setHtml(html);

    refreshStats();
    refreshSource();
    saveDraftNow();
    toast('已插入示例内容');
  }

  /* ---- 清空 ---- */
  function actionClear() {
    var editor = liveEditor();
    if (!editor) return;
    if (!global.confirm('确定清空当前模式的编辑内容？此操作不可撤销（可先用「导出 HTML」备份）。')) return;

    currentDoc().html = EMPTY_HTML;
    editor.setHtml(EMPTY_HTML);

    refreshStats();
    refreshSource();
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

  /* ======================= 事件绑定 ======================= */

  var ACTIONS = {
    'copy': actionCopy,
    'copy-html': actionCopyHtml,
    'copy-source': actionCopySource,
    'preview': actionPreview,
    'export': actionExport,
    'save': actionSave,
    'import': actionImport,
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

    // 每个模式各自载入自己的草稿；?demo=1 时统一载入示例内容
    Object.keys(Modes).forEach(function (id) {
      if (demo) {
        docs[id].html = global.AppSample ? global.AppSample.html : EMPTY_HTML;
        return;
      }
      var own = Storage.available ? Storage.loadDraft(id) : null;
      docs[id].html = (own && own.html) ? own.html : EMPTY_HTML;
    });

    switchMode(initial, { force: true, silent: !demo });

    var restored = demo ? null : Storage.loadDraft(initial);

    if (demo) {
      refreshDraftStatus('示例内容');
      setHint('已载入示例内容（?demo=1）');
    } else {
      refreshDraftStatus(restored
        ? '已恢复草稿 ' + clock(restored.updatedAt || Date.now())
        : '未保存');
      if (restored && restored.html && restored.html !== EMPTY_HTML) {
        toast('已恢复「' + (Modes[initial] ? Modes[initial].label : initial) +
          '」的草稿（' + clock(restored.updatedAt || Date.now()) + '）');
      }
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
    prettyHtml: function () { return Exporter.prettyHtml(currentHtml()); }
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
