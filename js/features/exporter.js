/* ==========================================================================
   exporter.js — 导出 / 预览 能力
     buildDocument({title, html, mode}) : 生成「独立可打开的完整 HTML 文档」
     download(filename, content, mime)  : 触发浏览器下载
     previewSrcdoc(...)                 : 供预览模态框的 iframe.srcdoc 使用
     prettyHtml(html)                   : HTML 源码格式化（仅用于展示）

   导出策略（两种模式各按自己的定位导出）
   1) 默认模式 = 纯内容导出（bare）
      只输出 <!DOCTYPE html> + <meta charset> + <body data-mode="default"> + 正文，
      不注入任何 <style>、<meta>、<article> 包装或文案。适合直接贴进博客 / BBS 后台，
      由目标站点的样式接管排版。两份导出文件之间只差 body 上的 data-mode 标记。
   2) 仿腾讯文档模式 = 完整文档导出
      保留完整 <head>（viewport / generator / source-mode / exported-at / 内嵌样式）
      与 <article class="doc doc--qqdoc"> 外壳，独立打开即还原「灰底 + 850px 白纸」。
   3) 两者共同遵守：正文原样取自 editor.getHtml()，不注入任何文案
      （无「未命名文档」占位、无工具名 / 时间水印）。
   4) 模板（富文本模板功能）的版式层优先于模式皮肤：
      模板 skin 非空时，即使处于默认模式也走「完整文档」导出，
      并在 head 输出 wangeditor-template-* 标记，便于再导入还原。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;

  /* ---------- 共享排版样式（两种模式通用） ---------- */
  var BASE_CSS = [
    ':root{--ink:#262626;--ink-2:#5b6066;--line:#e3e6eb;--accent:#2b6cff;--code-bg:#f6f8fa}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;padding:0}',
    'body{color:var(--ink);font-size:16px;line-height:1.75;',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;',
    '  -webkit-font-smoothing:antialiased}',
    /* 标题与正文：与编辑器内所见一致 */
    'h1,h2,h3,h4,h5{margin:24px 0 12px;line-height:1.4;font-weight:700}',
    'h1{font-size:26px}h2{font-size:22px}h3{font-size:18px}h4{font-size:16px}h5{font-size:15px}',
    'p,li,td,th,h1,h2,h3,h4,h5{word-wrap:break-word;overflow-wrap:break-word}',
    'p{margin:14px 0}',
    'a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(43,108,255,.35)}',
    'a:hover{border-bottom-color:var(--accent)}',
    'ul,ol{margin:14px 0;padding-left:26px}li{margin:6px 0}',
    'blockquote{margin:16px 0;padding:12px 16px;background:#f7f9fc;border-left:4px solid var(--accent);',
    '  border-radius:0 4px 4px 0;color:var(--ink-2)}',
    'code{background:var(--code-bg);border-radius:3px;padding:2px 6px;font-size:.9em;',
    '  font-family:Consolas,Monaco,"Andale Mono",monospace}',
    'pre{background:var(--code-bg);border:1px solid var(--line);border-radius:6px;padding:14px 16px;overflow:auto}',
    'pre code{background:none;padding:0;font-size:13px;line-height:1.6}',
    'img{max-width:100%;height:auto;border-radius:4px}',
    'hr{border:0;border-top:1px solid var(--line);margin:28px 0}',
    'table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px}',
    'th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;line-height:1.6}',
    'th{background:#f6f8fa;font-weight:700;text-align:center}',
    '[data-w-e-type="video"]{max-width:100%}',
    'video{max-width:100%}',
    /* 文档标题：仅当用户填了标题才会输出该节点 */
    '.doc-title{margin:0;font-weight:700}',
    '@media print{body{background:#fff}.doc{box-shadow:none;margin:0;padding:0;width:auto;max-width:none}}'
  ].join('\n');

  /* ---------- 各模式的文档外壳 ----------
     bare: true  → 纯内容导出：不注入 <style> / meta / 包装节点，只保留 body 上的
                   data-mode 标记（两种模式的导出因此仍可被识别与再次导入）。
     其余模式    → 完整文档：head 元信息 + 内嵌样式 + <article> 外壳。   */
  var MODE_SKINS = {
    'default': {
      id: 'default',
      label: '默认模式',
      bare: true
    },
    'qqdoc': {
      id: 'qqdoc',
      label: '仿腾讯文档模式',
      wrapperClass: 'doc doc--qqdoc',
      css: [
        /* 在线文档态：浅灰画布 + 850px 白色纸张（对齐编辑器内纸张尺寸） */
        'body{background:#f2f2f2}',
        '.doc--qqdoc{width:850px;max-width:100%;margin:40px auto 80px;background:#fff;',
        '  padding:44px 60px 64px;box-shadow:0 2px 10px rgba(0,0,0,.12)}',
        '.doc--qqdoc .doc-title{font-size:30px;line-height:1.35;margin:0 0 24px}',
        '@media(max-width:900px){.doc--qqdoc{width:100%;margin:0;padding:24px 20px 48px;box-shadow:none}}'
      ].join('\n')
    }
  };

  function resolveSkin(mode) {
    return MODE_SKINS[mode] || MODE_SKINS['default'];
  }

  /**
   * 皮肤解析优先级：模板版式层 > 模式皮肤。
   * 模板一旦带版式（skin.css 非空），导出就走「完整文档」分支 —— 即便是默认模式，
   * 否则模板的背景 / 正文字体 / 页宽都无处安放。
   */
  function resolveSkinFor(options) {
    var T = global.AppTemplates;
    var tplSkin = (T && options.template) ? T.skinOf(options.template) : null;
    return tplSkin || resolveSkin(options.mode);
  }

  /* ---------- 文本工具 ---------- */

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 把标题转成安全的文件名（不再注入「未命名文档」，由调用方决定空名回退） */
  function safeFilename(name, ext, fallback) {
    var base = String(name == null ? '' : name)
      .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    if (!base) base = String(fallback == null ? '' : fallback).trim();
    return base + (ext || '');
  }

  function timestamp(d) {
    d = d || new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function byteSize(str) {
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes += 1;
      else if (c < 0x800) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { bytes += 4; i++; }
      else bytes += 3;
    }
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  /* ---------- HTML 源码格式化（仅用于展示，不改动真实数据） ---------- */

  var BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'pre', 'hr', 'figure', 'figcaption', 'section'];

  function prettyHtml(html) {
    if (!html) return '';

    var BLOCK_RE = new RegExp('<(/?)(' + BLOCK_TAGS.join('|') + ')(?=[\\s/>])', 'gi');
    var VOID = /^(hr|br|img|input|meta|link)$/i;

    // 先按块级标签边界断行（不触碰标签内部文本）
    var lines = String(html)
      .replace(/\s*\r?\n\s*/g, '')
      .replace(BLOCK_RE, '\n<$1$2')
      .split('\n');

    var out = [];
    var depth = 0;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var isClose = /^<\//.test(line);
      var match = /^<(\/?)([a-zA-Z0-9-]+)/.exec(line);
      var tag = match ? match[2].toLowerCase() : '';
      var selfClose = isClose || VOID.test(tag) || /\/>$/.test(line);

      if (isClose) depth = Math.max(0, depth - 1);
      out.push(new Array(depth + 1).join('  ') + line);
      if (!selfClose) depth += 1;
    }

    return out.join('\n');
  }

  /* ---------- 生成独立文档 ---------- */

  function buildDocument(options) {
    options = options || {};
    var skin = resolveSkinFor(options);
    var bare = skin.bare === true;
    // 模板导出的模板标记（供「导出模板文件 → 手工放进 templates/」再导入时还原）
    var tpl = options.template || null;
    var skinMode = tpl ? ('tpl:' + escapeHtml(tpl.id)) : escapeHtml(options.mode);

    // 标题：空即不输出，绝不注入占位文案
    var title = String(options.title == null ? '' : options.title).trim();
    // 正文：原样来自编辑器 getHtml()，不做任何包装或改写
    var body = options.html == null ? '' : String(options.html);

    /* 极简（默认模式）：DOCTYPE / charset / body 三样是「能被浏览器正确打开」
       的最低要求，其余一律不注入 —— 没有 <style>、没有 <meta>、没有包装节点。 */
    if (bare) {
      var bareOut = [
        '<!DOCTYPE html>',
        '<html lang="zh-CN">',
        '<head>',
        '<meta charset="UTF-8" />'
      ];
      if (title) bareOut.push('<title>' + escapeHtml(title) + '</title>');
      bareOut.push('</head>');
      bareOut.push('<body data-mode="' + escapeHtml(skin.id) + '">');
      if (title) bareOut.push('<h1>' + escapeHtml(title) + '</h1>');
      bareOut.push(body, '</body>', '</html>');
      return bareOut.join('\n');
    }

    /* 完整文档（仿腾讯文档模式 / 带版式的模板） */
    var stamp = timestamp();
    if (!title && tpl && tpl.name) title = tpl.name;

    var out = [
      '<!DOCTYPE html>',
      '<html lang="zh-CN">',
      '<head>',
      '<meta charset="UTF-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<title>' + escapeHtml(title) + '</title>',
      /* 元信息只留在 head，不进正文 */
      '<meta name="generator" content="wangEditor v5 双模式富文本工作台" />',
      '<meta name="source-mode" content="' + skinMode + '" />',
      '<meta name="exported-at" content="' + stamp + '" />'
    ];

    if (tpl) {
      out.push('<meta name="wangeditor-template" content="1" />');
      out.push('<meta name="wangeditor-template-name" content="' + escapeHtml(tpl.name || '') + '" />');
      if (tpl.note) {
        out.push('<meta name="wangeditor-template-note" content="' + escapeHtml(tpl.note) + '" />');
      }
    }

    out.push(
      '<style>',
      BASE_CSS,
      skin.css,
      '</style>',
      '</head>',
      '<body data-mode="' + escapeHtml(options.mode || 'default') + '"' +
      (tpl ? ' data-template="' + escapeHtml(tpl.id) + '"' : '') + '>',
      '<article class="' + skin.wrapperClass + '">'
    );

    if (title) {
      out.push('<h1 class="doc-title">' + escapeHtml(title) + '</h1>');
    }

    out.push(body, '</article>', '</body>', '</html>');
    return out.join('\n');
  }

  /** 预览用：与导出文件同源同构 */
  function previewSrcdoc(options) {
    return buildDocument(options);
  }

  /* ---------- 下载 ---------- */

  function download(filename, content, mime) {
    var blob = new global.Blob([content], {
      type: (mime || 'text/html') + ';charset=utf-8'
    });
    var url = global.URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    global.setTimeout(function () {
      doc.body.removeChild(a);
      global.URL.revokeObjectURL(url);
    }, 0);
    return filename;
  }

  global.AppExporter = {
    BASE_CSS: BASE_CSS,
    MODE_SKINS: MODE_SKINS,
    resolveSkin: resolveSkin,
    resolveSkinFor: resolveSkinFor,
    escapeHtml: escapeHtml,
    safeFilename: safeFilename,
    timestamp: timestamp,
    byteSize: byteSize,
    prettyHtml: prettyHtml,
    buildDocument: buildDocument,
    previewSrcdoc: previewSrcdoc,
    download: download
  };
})(window);
