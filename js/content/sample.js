/* ==========================================================================
   sample.js — 示例内容（「示例」按钮注入，也是 ?demo=1 的初始内容）
   用于演示：多级标题、加粗 / 斜体 / 下划线 / 删除线 / 彩色文字、行内代码、
   链接、有序与无序列表、引用、代码块、表格、分隔线
   ========================================================================== */
(function (global) {
  'use strict';

  global.AppSample = {
    html: [
      '<h1>wangEditor 双模式富文本编辑器</h1>',
      '<p>这是一段示例内容，用于演示基础格式：<strong>加粗</strong>、<em>斜体</em>、<u>下划线</u>、',
      '<s>删除线</s>、<span style="color: #2b6cff;">彩色文字</span>、行内代码 <code>editor.getHtml()</code>，',
      '以及 <a href="https://www.wangeditor.com/" target="_blank">wangEditor 官网</a> 链接。</p>',

      '<h2>一、两种编辑模式</h2>',
      '<ol>',
      '<li><strong>默认模式</strong>：工具栏功能最全，编辑区固定高度、内部滚动</li>',
      '<li><strong>仿腾讯文档模式</strong>：纸张式版式，纸张随内容增长，滚动交给整页</li>',
      '</ol>',
      '<blockquote>两种模式各自独立：切换模式<strong>不会互相传递内容</strong>，',
      '每个模式各自保留自己的文档与自动草稿。</blockquote>',

      '<h2>二、代码块</h2>',
      '<p>代码块走 wangEditor 内置高亮：</p>',
      '<pre><code>const { createEditor, createToolbar } = window.wangEditor',
      'const editor = createEditor({ selector: \'#editor-text-area\' })',
      'const toolbar = createToolbar({ editor, selector: \'#editor-toolbar\' })',
      '</code></pre>',

      '<h2>三、表格</h2>',
      '<table>',
      '<tbody>',
      '<tr><th>能力</th><th>默认模式</th><th>仿腾讯文档</th></tr>',
      '<tr><td>工具栏</td><td>全量</td><td>全量（隐藏全屏）</td></tr>',
      '<tr><td>滚动方式</td><td>编辑器内部滚动</td><td>整页滚动</td></tr>',
      '<tr><td>版式</td><td>边框容器</td><td>灰底 + 850px 白纸</td></tr>',
      '<tr><td>正文起点</td><td>编辑区顶部</td><td>纸张顶部（无独立标题）</td></tr>',
      '</tbody>',
      '</table>',

      '<hr />',
      '<p>下面可以试试：选中部分文字后点「复制」（富文本会带格式进剪贴板），',
      '或点「导出 HTML」得到一份可独立打开的文档。</p>',
      '<p><br></p>'
    ].join('\n')
  };
})(window);
