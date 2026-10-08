/* ==========================================================================
   sample.js — 示例内容（「示例」按钮注入）
   同时用于演示：标题、多级标题、列表、引用、代码块、表格、链接、分隔线
   ========================================================================== */
(function (global) {
  'use strict';

  global.AppSample = {
    title: 'wangEditor 双模式编辑器使用说明',
    html: [
      '<h1>wangEditor 双模式富文本编辑器</h1>',
      '<p>这是一段示例内容，用于演示基础格式：<strong>加粗</strong>、<em>斜体</em>、<u>下划线</u>、',
      '<s>删除线</s>、<span style="color: #2b6cff;">彩色文字</span>、行内代码 <code>editor.getHtml()</code>，',
      '以及 <a href="https://www.wangeditor.com/" target="_blank">wangEditor 官网</a> 链接。</p>',

      '<h2>一、适用场景</h2>',
      '<ul>',
      '<li>博客文章撰写：长文排版、多级标题、图片与代码块</li>',
      '<li>BBS 发帖与回复：快捷工具条、引用他人内容、表情</li>',
      '</ul>',

      '<h2>二、两种可切换模式</h2>',
      '<ol>',
      '<li><strong>默认模式</strong>：对齐官方 index 示例，工具栏功能最全，编辑区内部滚动</li>',
      '<li><strong>仿腾讯文档模式</strong>：纸张式版式 + 大标题，滚动交给整页，适合沉浸写作</li>',
      '</ol>',
      '<blockquote>在顶栏切换模式不会丢失内容：切换前会先取出 <code>editor.getHtml()</code>，',
      '销毁旧实例后用同一份内容重建新实例。</blockquote>',

      '<h2>三、代码块与表格</h2>',
      '<p>代码块走 wangEditor 内置高亮：</p>',
      '<pre><code>const { createEditor, createToolbar } = window.wangEditor',
      'const editor = createEditor({ selector: \'#editor-text-area\' })',
      'const toolbar = createToolbar({ editor, selector: \'#editor-toolbar\' })',
      '</code></pre>',
      '<table>',
      '<tbody>',
      '<tr><th>能力</th><th>默认模式</th><th>仿腾讯文档</th></tr>',
      '<tr><td>工具栏</td><td>全量</td><td>全量（隐藏全屏）</td></tr>',
      '<tr><td>滚动方式</td><td>编辑器内部滚动</td><td>整页滚动</td></tr>',
      '<tr><td>标题输入</td><td>无</td><td>纸张顶部 30px 输入框</td></tr>',
      '</tbody>',
      '</table>',

      '<hr />',
      '<p>下面可以试试：选中部分文字后点「复制」（富文本会带格式进剪贴板），',
      '或点「导出 HTML」得到一份可独立打开的文档。</p>',
      '<p><br></p>'
    ].join('\n')
  };
})(window);
