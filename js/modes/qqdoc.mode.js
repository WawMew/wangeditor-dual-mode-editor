/* ==========================================================================
   qqdoc.mode.js — 「仿腾讯文档模式」定义
   对齐官方示例 https://www.wangeditor.com/demo/like-qq-doc.html
     · 工具栏贴顶、整行居中（1350px / #FCFCFC），排除「全屏」菜单
     · 浅灰画布 + 居中 850px 白色纸张（描边 + 阴影）
     · 纸张内**没有独立标题栏**，开头即正文
     · editorConfig.scroll = false —— 编辑器自身不滚动，滚动交给外层画布
     · 点击纸张空白处聚焦编辑器末尾（官方示例行为）

   本模式与「默认模式」完全独立：各自持有自己的文档与草稿，切换不互相传递内容。
   ========================================================================== */
(function (global) {
  'use strict';

  var Modes = global.AppModes || (global.AppModes = {});

  Modes['qqdoc'] = {
    id: 'qqdoc',
    label: '仿腾讯文档',
    tagline: 'like-qq-doc 示例',
    description: '在线文档式版面：纸张居中、页面级滚动，适合沉浸式长文写作。',

    template: [
      '<div class="qqdoc-layout">',
      '  <div class="qqdoc-toolbar-bar">',
      '    <div id="editor-toolbar" class="qqdoc-toolbar" data-role="toolbar"></div>',
      '  </div>',
      '  <div class="qqdoc-canvas">',
      '    <div class="qqdoc-page">',
      '      <div id="editor-text-area" class="qqdoc-textarea" data-role="textarea"></div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n'),

    editorConfig: {
      placeholder: '请输入正文…',
      // 关键：关闭编辑器内部滚动，让整页随内容滚动（官方示例写法）
      scroll: false
    },

    // 官方示例写法 config: { excludeKeys: 'fullScreen' }
    // 这里用规范的数组形式，效果一致：工具栏隐藏「全屏」
    toolbarConfig: {
      excludeKeys: ['fullScreen']
    },

    /** 点击纸张空白处 → 聚焦到编辑器末尾（还原官方交互） */
    onMount: function (ctx) {
      var host = ctx.stage.querySelector('#editor-text-area');
      if (!host) return;

      var handler = function (event) {
        var target = event.target;
        var isBlank = target === host ||
          (target.classList && target.classList.contains('w-e-scroll')) ||
          (target.classList && target.classList.contains('w-e-text-container'));
        if (!isBlank) return;
        ctx.editor.blur();
        ctx.editor.focus(true); // focus 到末尾
      };

      host.addEventListener('click', handler);
      ctx.__qqdocBlankClick = handler;
    },

    onUnmount: function (ctx) {
      var host = ctx.stage.querySelector('#editor-text-area');
      if (host && ctx.__qqdocBlankClick) {
        host.removeEventListener('click', ctx.__qqdocBlankClick);
      }
    }
  };
})(window);
