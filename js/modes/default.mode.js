/* ==========================================================================
   default.mode.js — 「默认模式」定义
   对齐官方示例 https://www.wangeditor.com/demo/index.html
     · 全量工具栏（toolbarConfig 为空对象，交给 wangEditor 默认配置）
     · 1px 边框容器包裹「工具栏 + 编辑区」，两者之间 1px 分隔线
     · 编辑区固定高度，超出部分由编辑器内部滚动（scroll: true）
     · 保留官方的内容统计行（Text length / Selected text length）
   ========================================================================== */
(function (global) {
  'use strict';

  var Modes = global.AppModes || (global.AppModes = {});

  Modes['default'] = {
    id: 'default',
    label: '默认模式',
    tagline: '官方 index 示例',
    description: '全量工具栏 + 边框容器，编辑器内部滚动，功能与官方 demo 一致。',

    template: [
      '<div class="default-layout">',
      '  <div class="default-shell">',
      '    <div id="editor-toolbar" class="default-toolbar" data-role="toolbar"></div>',
      '    <div id="editor-text-area" class="default-textarea" data-role="textarea"></div>',
      '  </div>',
      '  <p class="default-stats">',
      '    Text length: <b data-stat="total-length">0</b>；',
      '    Selected text length: <b data-stat="selected-length">0</b>；',
      '  </p>',
      '</div>'
    ].join('\n'),

    editorConfig: {
      placeholder: '请输入内容…支持博客长文与 BBS 发帖 / 回复',
      scroll: true
    },

    // 官方示例：config: {} —— 全量菜单
    toolbarConfig: {}
  };
})(window);
