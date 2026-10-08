/* ==========================================================================
   editor-factory.js — 编辑器实例工厂
   职责单一：给定一个「模式定义」，把它的模板渲染到舞台，
   并创建 / 销毁成对的 editor + toolbar 实例。

   模式定义（见 js/modes/*.mode.js）需提供：
     id            模式唯一标识，同时写入 <body data-mode="...">
     label         模式中文名
     template      注入 #editor-stage 的 HTML 片段
                   必须包含 id="editor-toolbar" 与 id="editor-text-area"
     editorConfig  传给 createEditor 的 config（不含 MENU_CONF / onChange）
     toolbarConfig 传给 createToolbar 的 config
     onMount(ctx)  可选，实例创建完成后的额外接线（返回清理函数或由 onUnmount 处理）
     onUnmount(ctx)可选，销毁前的解绑
   ========================================================================== */
(function (global) {
  'use strict';

  var E = global.wangEditor;

  /* ---------------- 小工具 ---------------- */

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) global.clearTimeout(timer);
      timer = global.setTimeout(function () {
        timer = null;
        fn.apply(self, args);
      }, wait);
    };
  }

  /* ---------------- 图片 / 视频：完全离线可用（转 dataURL 插入） ---------------- */

  function readAsDataURL(file, onDone, onError) {
    var reader = new global.FileReader();
    reader.onload = function () { onDone(reader.result); };
    reader.onerror = function () { onError && onError(reader.error); };
    reader.readAsDataURL(file);
  }

  function buildMenuConf() {
    return {
      // 网络图片 / 插入视频走 URL 输入，开箱即用；
      // 本地上传在无服务端的情况下转为 dataURL，保证离线可跑。
      uploadImage: {
        fieldName: 'your-fileName',
        base64LimitSize: 10 * 1024 * 1024,
        maxFileSize: 10 * 1024 * 1024,
        allowedFileTypes: ['image/*'],
        customUpload: function (file, insertFn) {
          readAsDataURL(file, function (url) { insertFn(url, file.name, ''); });
        }
      },
      uploadVideo: {
        fieldName: 'your-fileName',
        maxFileSize: 20 * 1024 * 1024,
        allowedFileTypes: ['video/*'],
        customUpload: function (file, insertFn) {
          readAsDataURL(file, function (url) { insertFn(url, ''); });
        }
      }
    };
  }

  /* ---------------- 创建 ---------------- */

  function create(mode, options) {
    if (!E) {
      throw new Error('wangEditor 未加载：请确认 vendor/wangeditor/index.js 存在且可访问。');
    }

    options = options || {};
    var stage = global.document.getElementById('editor-stage');

    // 1) 渲染模式模板（会先清掉上一模式的 DOM）
    stage.innerHTML = mode.template;

    var toolbarEl = stage.querySelector('#editor-toolbar');
    var textAreaEl = stage.querySelector('#editor-text-area');
    if (!toolbarEl || !textAreaEl) {
      throw new Error('模式「' + mode.id + '」模板缺少 #editor-toolbar 或 #editor-text-area 节点。');
    }

    // 2) 合并编辑器配置
    var sourceConfig = mode.editorConfig || {};
    var config = {};
    for (var k in sourceConfig) {
      if (Object.prototype.hasOwnProperty.call(sourceConfig, k)) config[k] = sourceConfig[k];
    }
    config.placeholder = sourceConfig.placeholder || mode.placeholder || '请输入内容…';
    config.MENU_CONF = Object.assign({}, buildMenuConf(), mode.menuConf || {}, sourceConfig.MENU_CONF || {});
    config.onChange = function (editor) {
      if (typeof options.onChange === 'function') options.onChange(editor);
    };

    // 3) 创建 editor（wangEditor v5 官方 API）
    var editor = E.createEditor({
      selector: '#editor-text-area',
      html: options.html || '<p><br></p>',
      config: config,
      mode: 'default'
    });

    // 4) 创建 toolbar
    var toolbar = E.createToolbar({
      editor: editor,
      selector: '#editor-toolbar',
      config: mode.toolbarConfig || {},
      mode: 'default'
    });

    // 5) 选区变化 → 同步「选中字数」（官方示例只在 change 时更新，这里额外补充）
    var onSelectionChange = debounce(function () {
      if (typeof options.onSelectionChange === 'function') {
        options.onSelectionChange(editor);
      }
    }, 120);

    global.document.addEventListener('selectionchange', onSelectionChange);

    var instance = {
      mode: mode,
      editor: editor,
      toolbar: toolbar,
      stage: stage,

      getHtml: function () { return editor.getHtml(); },
      getText: function () { return editor.getText(); },
      getSelectionText: function () { return editor.getSelectionText(); },
      setHtml: function (html) { editor.setHtml(html || '<p><br></p>'); },

      /* 统计：字数与选中字数（与官方示例口径一致：去掉换行符） */
      getStats: function () {
        var all = String(editor.getText() || '').replace(/\n|\r/gm, '');
        var sel = '';
        try { sel = editor.getSelectionText() || ''; } catch (e) { sel = ''; }
        return { total: all.length, selected: sel.length };
      },

      destroy: function () {
        global.document.removeEventListener('selectionchange', onSelectionChange);
        if (typeof mode.onUnmount === 'function') {
          try { mode.onUnmount(instance); } catch (e) { /* noop */ }
        }
        try {
          // editor.destroy() 内部会一并销毁 textarea / toolbar / hoverbar
          if (editor && !editor.isDestroyed) editor.destroy();
        } catch (e) { /* noop */ }
        stage.innerHTML = '';
      }
    };

    if (typeof mode.onMount === 'function') {
      mode.onMount(instance);
    }

    return instance;
  }

  global.AppEditor = {
    create: create,
    buildMenuConf: buildMenuConf,
    isReady: function () { return !!E; },
    lib: E
  };
})(window);
