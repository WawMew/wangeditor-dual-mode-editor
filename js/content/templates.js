/* ==========================================================================
   templates.js — 富文本模板（双轨）

   为什么模板要分两层？
     实测（_probe-fidelity.html / _probe-whitelist.html）证明：wangEditor v5 在
     setHtml → getHtml 往返中只保留它自己菜单认识的「格式白名单」。
       · 未知包裹元素（<div>/<section>）会被拆掉，整棵子树被压成一个 <p>，标题层级消失；
       · 块级 background / padding、img 的 width、hr 的 border、td 的 border 全部丢弃；
       · font-size / line-height / font-family 只有落在菜单列表里的取值才存活；
       · 「段落级 font-family」（整段正文字体）无论怎么配都保留不了。
     所以「复杂样式模板」不能整体塞进编辑器，必须拆成两层：

     内容层 content —— 进编辑器、可继续编辑，严格使用 KEEP_TAGS + 允许的 style 子集，
                       sanitize() 会把不合规的写法自动降级并生成调整清单。
     版式层 skin    —— 任意 CSS，不经过编辑器，只在「预览 / 导出」时注入 <style>。
                       页面背景、纸张宽度、留白、正文字体、行距都在这里，100% 保真。

   模板来源三路（见 app.js 的 collectTemplates）：
     1) SEEDS            内置种子，写在 JS 里，file:// 双击打开也能用；
     2) templates/*.html 外部系统模板，运行期读取（launcher 有 /_list/templates 端点）；
     3) localStorage     用户自建 / 从文件导入的模板。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;

  /* ====================== 1. 白名单（单一事实来源） ======================
     editor-factory.js 会用 FORMAT_LISTS 去配置 MENU_CONF，
     保证「模板里写得出」与「编辑器存得住」是同一套取值。          */
  var FORMAT_LISTS = {
    fontSize: ['12px', '13px', '14px', '15px', '16px', '18px', '20px', '22px',
      '24px', '28px', '32px', '36px', '40px', '48px'],
    lineHeight: ['1', '1.15', '1.4', '1.5', '1.6', '1.75', '1.9', '2', '2.5', '3'],
    fontFamily: [
      { name: '宋体', value: 'SimSun' },
      { name: '黑体', value: 'SimHei' },
      { name: '微软雅黑', value: 'Microsoft YaHei' },
      { name: '楷体', value: 'KaiTi' },
      { name: '仿宋', value: 'FangSong' },
      { name: 'Arial', value: 'Arial' },
      { name: 'Verdana', value: 'Verdana' },
      { name: 'Georgia', value: 'Georgia' },
      { name: 'Consolas', value: 'Consolas' }
    ]
  };

  // 可以留在文档里、且 wangEditor 认得的标签
  var KEEP_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'blockquote', 'ul', 'ol',
    'li', 'hr', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'span',
    'br', 'sub', 'sup'];

  // 「块级」标签：允许 text-align / text-indent / line-height，行内样式会被下移到 span
  var BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'blockquote', 'li', 'td', 'th'];

  // 只允许出现在 span / a / code 上
  var INLINE_STYLE = ['color', 'background-color', 'font-size', 'font-family'];
  var BLOCK_STYLE = ['text-align', 'text-indent', 'line-height'];

  // 包裹型标签：解包（保留子节点），并计入调整清单
  var UNWRAP_TAGS = ['div', 'section', 'article', 'main', 'header', 'footer',
    'aside', 'nav', 'figure', 'figcaption', 'font', 'center', 'small', 'label',
    'dl', 'dd', 'dt', 'fieldset', 'address', 'caption', 'colgroup', 'col'];

  // 直接删除：安全风险或 wangEditor 完全不承载
  var DROP_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link',
    'meta', 'base', 'noscript', 'svg', 'canvas', 'form', 'input', 'button',
    'select', 'option', 'textarea', 'audio', 'source', 'template'];

  var ATTR_ALLOW = {
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan']
  };

  var SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/]+\)|[a-z]{3,20})$/i;
  var SAFE_LENGTH = /^-?[\d.]+(px|em|rem|%|pt)?$/i;

  /* ====================== 2. 样式工具 ====================== */

  function parseStyle(text) {
    var out = {};
    String(text || '').split(';').forEach(function (part) {
      var i = part.indexOf(':');
      if (i < 0) return;
      var k = part.slice(0, i).trim().toLowerCase();
      var v = part.slice(i + 1).trim();
      if (k && v) out[k] = v;
    });
    return out;
  }

  function styleText(map) {
    return Object.keys(map).map(function (k) { return k + ': ' + map[k] + ';'; }).join(' ');
  }

  function setStyle(el, map) {
    var t = styleText(map);
    if (t) el.setAttribute('style', t);
    else el.removeAttribute('style');
  }

  function unquote(v) {
    return String(v || '').replace(/^['"]|['"]$/g, '').trim();
  }

  function isFontSize(v) {
    var s = String(v).trim().toLowerCase();
    if (/^\d+(\.\d+)?$/.test(s)) s += 'px';
    return FORMAT_LISTS.fontSize.indexOf(s) >= 0 ? s : null;
  }

  function isLineHeight(v) {
    var s = String(v).trim();
    return FORMAT_LISTS.lineHeight.indexOf(s) >= 0 ? s : null;
  }

  function isFontFamily(v) {
    var s = unquote(v).toLowerCase();
    for (var i = 0; i < FORMAT_LISTS.fontFamily.length; i++) {
      if (FORMAT_LISTS.fontFamily[i].value.toLowerCase() === s) {
        return FORMAT_LISTS.fontFamily[i].value;
      }
    }
    return null;
  }

  function isAlign(v) {
    var s = String(v).trim().toLowerCase();
    return /^(left|center|right|justify)$/.test(s) ? s : null;
  }

  /** 校验并规范化一条 style 声明；不合法返回 null */
  function normalizeDecl(prop, value) {
    if (prop === 'font-size') return isFontSize(value);
    if (prop === 'line-height') return isLineHeight(value);
    if (prop === 'font-family') return isFontFamily(value);
    if (prop === 'text-align') return isAlign(value);
    if (prop === 'text-indent') return SAFE_LENGTH.test(String(value).trim()) ? String(value).trim() : null;
    if (prop === 'color' || prop === 'background-color') {
      return SAFE_COLOR.test(String(value).trim()) ? String(value).trim() : null;
    }
    return null;
  }

  /** 按 wangEditor 的喜好输出颜色（它回读时会给 rgb()，这里保持原样即可） */
  function normalizeColor(v) { return String(v).trim(); }

  /* ====================== 3. 净化 ====================== */

  function collectText(el) {
    // 用于判断节点是否「只剩空白」
    return String(el.textContent || '').replace(/\s|\u00a0/g, '');
  }

  /**
   * 把任意 HTML 净化为「wangEditor 能完整承载」的内容层 HTML。
   * @returns {{html:string, notes:string[]}}
   */
  function sanitize(raw, options) {
    options = options || {};
    var notes = [];
    var seen = {};
    function note(msg) {
      if (seen[msg]) return;
      seen[msg] = 1;
      notes.push(msg);
    }

    var parsed = new global.DOMParser().parseFromString(
      '<!DOCTYPE html><html><body>' + String(raw == null ? '' : raw) + '</body></html>',
      'text/html'
    );
    var host = parsed.body;

    // ---- 3.1 删掉危险 / 不承载的标签 ----
    DROP_TAGS.forEach(function (tag) {
      var list = Array.prototype.slice.call(host.getElementsByTagName(tag));
      if (list.length) note('已移除 <' + tag + '>（wangEditor 不承载或存在安全风险）');
      list.forEach(function (el) { el.parentNode && el.parentNode.removeChild(el); });
    });

    // ---- 3.2 解包包裹型标签（自内向外，避免父节点被摘掉后子节点丢失）----
    var unwrapFound = {};
    var pass = 0;
    var guard = 0;
    while (pass < 8 && guard++ < 200) {
      var changed = false;
      var all = Array.prototype.slice.call(host.getElementsByTagName('*'));
      for (var i = all.length - 1; i >= 0; i--) {
        var el = all[i];
        var tag = el.tagName.toLowerCase();
        // wangEditor 自己产出的节点（如 data-w-e-type="video"）原样保留
        if (el.hasAttribute && el.hasAttribute('data-w-e-type')) continue;
        if (UNWRAP_TAGS.indexOf(tag) < 0) continue;
        unwrapFound[tag] = true;
        unwrap(el);
        changed = true;
        break;
      }
      if (!changed) break;
      pass++;
    }
    Object.keys(unwrapFound).forEach(function (tag) {
      note('<' + tag + '> 包裹层已拆解（编辑器不保留包裹元素），内部节点已上提');
    });

    // ---- 3.3 逐元素处理样式与属性 ----
    var all2 = Array.prototype.slice.call(host.getElementsByTagName('*'));
    all2.forEach(function (el) {
      var tag = el.tagName.toLowerCase();

      if (el.hasAttribute('data-w-e-type')) return;

      if (KEEP_TAGS.indexOf(tag) < 0) {
        // 白名单外的漏网标签：解包
        note('<' + tag + '> 不在可用标签内，已拆解为纯文本');
        unwrap(el);
        return;
      }

      // 属性白名单
      var allowed = ATTR_ALLOW[tag] || [];
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        var name = attr.name.toLowerCase();
        if (name === 'style') return;
        if (name === 'data-w-e-type') return;
        if (allowed.indexOf(name) < 0) el.removeAttribute(attr.name);
      });

      var isBlock = BLOCK_TAGS.indexOf(tag) >= 0;
      var isInline = ['span', 'a', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup'].indexOf(tag) >= 0;

      var decls = parseStyle(el.getAttribute('style'));
      var props = Object.keys(decls);
      if (!props.length) return;

      var inlineOut = {};
      var blockOut = {};

      props.forEach(function (prop) {
        var value = normalizeDecl(prop, decls[prop]);
        if (value === null) {
          if (INLINE_STYLE.indexOf(prop) >= 0 || BLOCK_STYLE.indexOf(prop) >= 0) {
            var listName = prop === 'font-size' ? '可用字号'
              : prop === 'line-height' ? '可用行距'
                : prop === 'font-family' ? '可用字体' : '允许的取值';
            note('已忽略 ' + prop + ': ' + decls[prop] +
              '（' + listName + '见 README「模板编写规范」）');
          }
          return;
        }
        if (INLINE_STYLE.indexOf(prop) >= 0) inlineOut[prop] = normalizeColor(value);
        else if (BLOCK_STYLE.indexOf(prop) >= 0 && isBlock) blockOut[prop] = value;
        else if (BLOCK_STYLE.indexOf(prop) >= 0) {
          // 块级属性写在了行内标签上：丢弃
          note('已忽略 ' + prop + '（只能写在段落、标题等块级元素上）');
        } else if (isInline) {
          note('已忽略不支持的样式 ' + prop);
        }
      });

      if (!Object.keys(inlineOut).length) {
        if (Object.keys(blockOut).length) setStyle(el, blockOut);
        else el.removeAttribute('style');
        return;
      }

      // 块级元素上的字体/字号/颜色：wangEditor 会丢，必须下移到 <span>
      if (isBlock) elevate(el, inlineOut, blockOut);
      else {
        var merged = {};
        Object.keys(decls).forEach(function (p) { if (inlineOut[p]) merged[p] = inlineOut[p]; });
        setStyle(el, merged);
      }
    });

    // ---- 3.4 收尾：去掉空壳 p 与「样式已被丢掉」的空 span ----
    var ps = Array.prototype.slice.call(host.getElementsByTagName('p'));
    ps.forEach(function (p) {
      if (!collectText(p) && !p.querySelector('img') && !p.querySelector('br')) {
        p.parentNode && p.parentNode.removeChild(p);
      }
    });

    // 样式被剔除后剩下的 <span> 没有意义，去掉可以让 HTML 干净很多
    for (var round = 0; round < 6; round++) {
      var spans = Array.prototype.slice.call(host.getElementsByTagName('span'));
      var dropped = 0;
      spans.forEach(function (sp) {
        if (sp.attributes.length === 0) { unwrap(sp); dropped++; }
      });
      if (!dropped) break;
    }

    var html = host.innerHTML
      .replace(/[ \t]*\r?\n[ \t]*\r?\n\s*/g, '\n')   // 元素被移除后留下的连续空行
      .replace(/^\s+|\s+$/g, '');
    if (!html || !collectText(host) && !host.querySelector('img,hr,table')) {
      html = '<p><br></p>';
    }
    return { html: html, notes: notes };
  }

  /** 解包：用子节点替换元素本身 */
  function unwrap(el) {
    var parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  /** 把块级元素上的行内样式（字号/颜色/字体）下移到内部 <span> */
  function elevate(el, inlineOut, blockOut) {
    var keepTags = ['ul', 'ol', 'table', 'pre', 'blockquote'];
    var movable = [];
    var cursor = el.firstChild;
    while (cursor) {
      var next = cursor.nextSibling;
      var isKeep = cursor.nodeType === 1 && keepTags.indexOf(cursor.tagName.toLowerCase()) >= 0;
      if (isKeep) break;
      movable.push(cursor);
      cursor = next;
    }

    if (!movable.length) {
      setStyle(el, blockOut);
      return;
    }

    var single = movable.length === 1 && movable[0].nodeType === 1 &&
      movable[0].tagName.toLowerCase() === 'span' ? movable[0] : null;

    if (single) {
      var merged = parseStyle(single.getAttribute('style'));
      Object.keys(inlineOut).forEach(function (p) { if (!merged[p]) merged[p] = inlineOut[p]; });
      // 只保留行内允许的
      var cleaned = {};
      Object.keys(merged).forEach(function (p) {
        var v = normalizeDecl(p, merged[p]);
        if (v !== null && INLINE_STYLE.indexOf(p) >= 0) cleaned[p] = v;
      });
      setStyle(single, cleaned);
    } else {
      var span = el.ownerDocument.createElement('span');
      setStyle(span, inlineOut);
      movable.forEach(function (node) { span.appendChild(node); });
      el.insertBefore(span, el.firstChild);
    }
    setStyle(el, blockOut);
  }

  /* ====================== 4. 整份 HTML 文档拆分 ====================== */

  /** 去掉注入时加的公共排版样式，还原模板自己的 CSS */
  function stripBaseCss(css, baseCss) {
    var out = String(css || '');
    if (!baseCss) return out.trim();
    var idx = out.indexOf(baseCss);
    if (idx >= 0) out = out.slice(0, idx) + out.slice(idx + baseCss.length);
    return out.replace(/^\s+|\s+$/g, '');
  }

  /**
   * 解析一份完整 HTML 文档 → 模板对象骨架
   * 兼容本应用导出的模板文件（带 wangeditor-template-* meta）与任意手写文档。
   */
  function parseDocumentTemplate(raw, baseCss) {
    var parsed = new global.DOMParser().parseFromString(String(raw == null ? '' : raw), 'text/html');

    function metaOf(name) {
      var node = parsed.querySelector('meta[name="' + name + '"]');
      return node ? String(node.getAttribute('content') || '').trim() : '';
    }

    var styles = Array.prototype.slice.call(parsed.querySelectorAll('style'))
      .map(function (s) { return s.textContent; }).join('\n');
    styles = stripBaseCss(styles, baseCss);

    var host = parsed.querySelector('article.doc') || parsed.querySelector('article') || parsed.body;
    var content = host ? host.innerHTML : '';

    var name = metaOf('wangeditor-template-name');
    if (!name) {
      var title = parsed.querySelector('title');
      name = title ? String(title.textContent || '').trim() : '';
    }

    return {
      name: name,
      note: metaOf('wangeditor-template-note'),
      content: content,
      css: styles
    };
  }

  /* ====================== 5. 内置种子模板 ======================
     内容层刻意只用白名单写法；版式层承担编辑器做不到的部分
     （页面背景、纸张、正文字体、块级留白）。                       */

  var SKIN_COMMON =
    '.doc{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Arial,sans-serif}\n' +
    '.doc h1,.doc h2,.doc h3{font-weight:700}\n';

  var T_COLUMN = {
    id: 'seed-column',
    name: '专栏文章',
    note: '居中大标题 + 导语 + 小节 + 引用，暖白纸张、衬线强调线',
    accent: '#c8a26a',
    content: [
      '<h1 style="text-align: center;"><span style="font-size: 36px;">文章标题写在这里</span></h1>',
      '<p style="text-align: center;"><span style="font-size: 13px; color: #8f959e;">2026-10-09 · 作者名</span></p>',
      '<hr>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">这里是导语。用一两句话讲清楚全文要解决什么问题，让读者在三十秒内决定要不要继续读下去。</span></p>',
      '<h2><span style="font-size: 22px;">一、小节标题</span></h2>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">这里是正文段落。示例文字用于展示模板的字体、字号与行距设置，直接替换成你自己的内容即可。</span></p>',
      '<blockquote><span style="font-size: 15px; color: #5b6066;">这里是一段引用。用来强调观点、摘录原文，或者给出结论。</span></blockquote>',
      '<h2><span style="font-size: 22px;">二、要点清单</span></h2>',
      '<ul>',
      '<li><span style="font-size: 16px;">要点一：先给结论，再给论据。</span></li>',
      '<li><span style="font-size: 16px;">要点二：一个要点只讲一件事。</span></li>',
      '<li><span style="font-size: 16px;">要点三：结尾给出可执行的动作。</span></li>',
      '</ul>',
      '<hr>',
      '<p style="text-align: center;"><span style="font-size: 12px; color: #8f959e;">— 全文完 —</span></p>'
    ].join('\n'),
    skin: {
      wrapperClass: 'doc doc--tpl-column',
      css: SKIN_COMMON + [
        'body{background:#f6f4f0}',
        '.doc--tpl-column{width:760px;max-width:100%;margin:36px auto 72px;background:#fffdfa;',
        '  padding:56px 64px 72px;box-shadow:0 2px 14px rgba(90,70,40,.10);border-radius:2px}',
        '.doc--tpl-column h1{font-size:36px;line-height:1.32;margin:0 0 10px;text-align:center;letter-spacing:.5px}',
        '.doc--tpl-column h2{font-size:22px;margin:36px 0 14px;padding-left:12px;border-left:4px solid #c8a26a}',
        '.doc--tpl-column p{font-size:16px;line-height:1.9;margin:14px 0}',
        '.doc--tpl-column blockquote{margin:20px 0;padding:14px 18px;background:#faf7f1;color:#5b6066}',
        '.doc--tpl-column hr{border:0;border-top:1px solid #e8e2d8;margin:32px 0}',
        '.doc--tpl-column li{margin:8px 0}',
        '@media(max-width:820px){.doc--tpl-column{width:100%;margin:0;padding:28px 20px 48px;box-shadow:none}}'
      ].join('\n')
    }
  };

  var T_TECH = {
    id: 'seed-tech',
    name: '技术文档',
    note: '标题 + 元信息 + 代码块 + 对比表格，冷灰底、等宽点缀',
    accent: '#2b6cff',
    content: [
      '<h1><span style="font-size: 32px;">组件名称 / 功能标题</span></h1>',
      '<p><span style="font-size: 14px; color: #5f5e5a;">适用范围：内部系统 · 版本 v1.0 · 更新于 2026-10-09</span></p>',
      '<hr>',
      '<h2><span style="font-size: 22px;">1. 概述</span></h2>',
      '<p style="line-height: 1.75;"><span style="font-size: 15px;">用一段话说明这个组件解决什么问题、在什么场景下使用，以及它不负责什么。</span></p>',
      '<h2><span style="font-size: 22px;">2. 快速开始</span></h2>',
      '<pre><code>npm install your-package\nimport { create } from \'your-package\'\n\nconst app = create({ debug: true })</code></pre>',
      '<h2><span style="font-size: 22px;">3. 参数说明</span></h2>',
      '<table><tbody>',
      '<tr><th><span style="font-size: 14px;">参数</span></th><th><span style="font-size: 14px;">类型</span></th><th><span style="font-size: 14px;">说明</span></th></tr>',
      '<tr><td><span style="font-size: 13px;">debug</span></td><td><span style="font-size: 13px;">boolean</span></td><td><span style="font-size: 13px;">是否输出调试日志</span></td></tr>',
      '<tr><td><span style="font-size: 13px;">theme</span></td><td><span style="font-size: 13px;">string</span></td><td><span style="font-size: 13px;">主题标识</span></td></tr>',
      '</tbody></table>',
      '<blockquote><span style="font-size: 14px; color: #5f5e5a;">注意：production 环境下请关闭 debug，避免日志泄漏内部路径。</span></blockquote>',
      '<h2><span style="font-size: 22px;">4. 常见问题</span></h2>',
      '<ol>',
      '<li><span style="font-size: 15px;">依赖安装失败时先检查镜像源配置。</span></li>',
      '<li><span style="font-size: 15px;">样式不生效通常是构建缓存未清理。</span></li>',
      '</ol>'
    ].join('\n'),
    skin: {
      wrapperClass: 'doc doc--tpl-tech',
      css: SKIN_COMMON + [
        'body{background:#f2f4f7}',
        '.doc--tpl-tech{width:840px;max-width:100%;margin:32px auto 64px;background:#fff;',
        '  padding:44px 56px 60px;border:1px solid #e3e6eb;border-radius:8px}',
        '.doc--tpl-tech h1{font-size:32px;line-height:1.3;margin:0 0 8px}',
        '.doc--tpl-tech h2{font-size:22px;margin:32px 0 12px;padding-bottom:8px;border-bottom:1px solid #e3e6eb}',
        '.doc--tpl-tech p{font-size:15px;line-height:1.75;margin:12px 0}',
        '.doc--tpl-tech pre{background:#f6f8fa;border:1px solid #e3e6eb;border-radius:6px;padding:14px 16px;overflow:auto}',
        '.doc--tpl-tech pre code{font-family:Consolas,Monaco,monospace;font-size:13px}',
        '.doc--tpl-tech code{background:#f6f8fa;border-radius:3px;padding:2px 6px;font-family:Consolas,Monaco,monospace}',
        '.doc--tpl-tech table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}',
        '.doc--tpl-tech th,.doc--tpl-tech td{border:1px solid #e3e6eb;padding:8px 10px;text-align:left}',
        '.doc--tpl-tech th{background:#f6f8fa}',
        '.doc--tpl-tech blockquote{margin:18px 0;padding:12px 16px;background:#fff8e6;',
        '  border-left:4px solid #e0a800;color:#6b5a2e;border-radius:0 4px 4px 0}',
        '@media(max-width:900px){.doc--tpl-tech{width:100%;margin:0;padding:24px 18px 40px;border:0;border-radius:0}}'
      ].join('\n')
    }
  };

  var T_NOTICE = {
    id: 'seed-notice',
    name: '通知公告',
    note: '红头居中标题 + 条款正文 + 右对齐落款，米白底',
    accent: '#a32d2d',
    content: [
      '<h1 style="text-align: center;"><span style="font-size: 28px; color: #a32d2d;">关于××××工作的通知</span></h1>',
      '<p style="text-align: center;"><span style="font-size: 13px; color: #8f959e;">×××办公室 · 2026年10月9日</span></p>',
      '<hr>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">各部门、各单位：</span></p>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">为进一步规范相关工作流程，经研究决定，现将有关事项通知如下。</span></p>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">一、适用范围。本通知适用于本单位全部部门与下属机构。</span></p>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">二、执行要求。各部门应在本通知印发之日起十个工作日内完成自查，并将结果书面报送办公室。</span></p>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">三、责任分工。由办公室负责统筹协调，各业务部门负责具体落实。</span></p>',
      '<p style="text-indent: 2em; line-height: 1.9;"><span style="font-size: 16px;">特此通知。</span></p>',
      '<p style="text-align: right;"><span style="font-size: 16px;">×××办公室</span></p>',
      '<p style="text-align: right;"><span style="font-size: 16px;">2026年10月9日</span></p>'
    ].join('\n'),
    skin: {
      wrapperClass: 'doc doc--tpl-notice',
      css: SKIN_COMMON + [
        'body{background:#efece5}',
        '.doc--tpl-notice{width:800px;max-width:100%;margin:32px auto 64px;background:#fffefb;',
        '  padding:56px 64px 64px;border-top:4px solid #a32d2d;box-shadow:0 2px 12px rgba(80,50,40,.10)}',
        '.doc--tpl-notice h1{font-size:28px;line-height:1.4;margin:0 0 10px;letter-spacing:1px}',
        '.doc--tpl-notice p{font-size:16px;line-height:1.9;margin:14px 0}',
        '.doc--tpl-notice hr{border:0;border-top:1px solid #e6ddd0;margin:28px 0}',
        '@media(max-width:860px){.doc--tpl-notice{width:100%;margin:0;padding:28px 20px 44px;box-shadow:none}}'
      ].join('\n')
    }
  };

  var T_PLAIN = {
    id: 'seed-plain',
    name: '极简纯文本',
    note: '只有标签层级、不带任何版式；导出沿用当前模式的皮肤',
    accent: '#888780',
    content: [
      '<h1>标题</h1>',
      '<p>正文段落。这个模板刻意不带版式层，用来对照「有版式」与「无版式」的差别。</p>',
      '<h2>小节</h2>',
      '<p>继续写你的内容。</p>',
      '<ul><li>列表项</li><li>列表项</li></ul>'
    ].join('\n'),
    skin: null
  };

  var SEEDS = [T_COLUMN, T_TECH, T_NOTICE, T_PLAIN];

  /* ====================== 6. 外部模板清单 ======================
     两条通道，按顺序尝试：
       1) /_list/templates —— 本项目 launcher（tools/serve.ps1）提供的纯文本清单，
          一行一个文件名，新增模板只要把 .html 丢进 templates/ 即可，零维护；
       2) templates/manifest.json —— 通用静态服务器下的手工清单。
     两者都拿不到（例如直接 file:// 双击打开）时静默跳过，只用内置种子。   */

  function fetchText(url) {
    if (typeof global.fetch !== 'function') return global.Promise.resolve(null);
    if (global.location && global.location.protocol === 'file:') return global.Promise.resolve(null);
    return global.fetch(url, { cache: 'no-store' }).then(function (res) {
      return res.ok ? res.text() : null;
    }).catch(function () { return null; });
  }

  function listExternalFiles() {
    return fetchText('_list/templates').then(function (text) {
      if (text && text.trim()) {
        return text.split(/\r?\n/).map(function (s) { return s.trim(); })
          .filter(function (s) { return /\.html?$/i.test(s); });
      }
      return fetchText('templates/manifest.json').then(function (json) {
        if (!json) return [];
        try {
          var data = JSON.parse(json);
          var files = Array.isArray(data) ? data : (data && data.files) || [];
          return files.filter(function (f) { return /\.html?$/i.test(String(f)); });
        } catch (e) { return []; }
      });
    });
  }

  /** 运行期加载 templates/ 下的外部系统模板 */
  function loadExternal(baseCss) {
    return listExternalFiles().then(function (files) {
      if (!files.length) return [];
      return global.Promise.all(files.map(function (file) {
        return fetchText('templates/' + file).then(function (text) {
          if (!text) return null;
          var parsed = parseDocumentTemplate(text, baseCss);
          var sanitized = sanitize(parsed.content);
          return {
            id: 'ext-' + file.replace(/[^a-z0-9._-]/gi, '-'),
            name: parsed.name || file.replace(/\.html?$/i, ''),
            note: parsed.note || '来自 templates/ 目录',
            accent: '#1d9e75',
            builtin: true,
            external: true,
            origin: 'templates/' + file,
            content: sanitized.html,
            notes: sanitized.notes,
            skin: parsed.css ? { wrapperClass: 'doc doc--tpl-ext', css: parsed.css } : null
          };
        });
      })).then(function (list) {
        return list.filter(Boolean);
      });
    }).catch(function () { return []; });
  }

  /* ====================== 7. 文本片段预合并（wangEditor 崩溃防护） ======================

     背景（实测确认，wangEditor 5.1.23 / Slate）：
     当一段 HTML 里同一段落含 ≥3 个相邻且格式完全相同的文本片段时——
       <p><span>a，</span><span>b，</span><span>c。</span></p>          （网页复制粘贴的典型产物）
     wangEditor 解析后会对同一路径重复执行两次 merge_node，
     Slate 直接抛 "Cannot find a descendant at path [x,1]"，编辑器初始化失败。

     对策：在内容进入编辑器之前，先在 DOM 层把相邻同格式片段合并成一个，
     让 Slate 根本不需要 merge_node。所有内容入口（草稿恢复 / 导入 / 模板）
     都必须先过 coalesceRuns()。                                      */

  /** 判断节点的「格式签名」：相同签名的相邻节点视觉上完全等价，可合并。
      返回 null 表示原子节点（不参与合并），'#text' 表示裸文本。 */
  function runSignature(node) {
    if (node.nodeType === 3) return '#text';
    if (node.nodeType !== 1) return null;
    var name = node.nodeName;
    if (name === 'BR' || name === 'IMG' || name === 'HR' ||
        name === 'TABLE' || name === 'PRE' || name === 'HR') return null;
    var style = (node.getAttribute && node.getAttribute('style')) || '';
    var cls = (node.getAttribute && node.getAttribute('class')) || '';
    return name + '|' + style.replace(/\s+/g, ' ').trim() + '|' + cls.trim();
  }

  function isBlankText(node) {
    return node.nodeType === 3 && !/\S/.test(node.nodeValue || '');
  }

  function coalesceIn(container) {
    // 1) 先递归处理子元素（自底向上，内层先合并好）
    Array.prototype.slice.call(container.children).forEach(coalesceIn);

    // 2) 合并相邻同签名元素；元素间夹的纯空白文本视为源码换行，一并吞掉
    var children = Array.prototype.slice.call(container.childNodes);
    var i = 0;
    while (i < children.length - 1) {
      var cur = children[i];
      var sig = runSignature(cur);
      if (sig === null || sig === '#text') { i++; continue; }

      // 向后吃掉：[空白文本] + 同签名元素，可重复
      var j = i + 1;
      var merged = false;
      while (j < children.length) {
        var nx = children[j];
        if (isBlankText(nx)) { j++; continue; }
        if (runSignature(nx) === sig) {
          while (nx.firstChild) cur.appendChild(nx.firstChild);
          container.removeChild(nx);
          children.splice(j, 1);
          merged = true;
          continue; // 继续尝试并入下一个
        }
        break;
      }
      // 合并后内层可能出现新的相邻同签名片段，再整理一次
      if (merged) coalesceIn(cur);
      i++;
    }

    // 3) 合并相邻裸文本节点（DOM 原生能力）
    try { container.normalize(); } catch (e) { /* noop */ }
  }

  /** 内容进编辑器前的最后一道工序：合并相邻同格式文本片段 */
  function coalesceRuns(html) {
    var trimmed = String(html || '').trim();
    if (!trimmed) return trimmed;
    var host = doc.createElement('div');
    host.innerHTML = trimmed;
    coalesceIn(host);
    return host.innerHTML;
  }

  /* ====================== 8. 导出 ====================== */

  global.AppTemplates = {
    FORMAT_LISTS: FORMAT_LISTS,
    KEEP_TAGS: KEEP_TAGS,
    UNWRAP_TAGS: UNWRAP_TAGS,
    SEEDS: SEEDS,
    sanitize: sanitize,
    coalesceRuns: coalesceRuns,
    parseDocumentTemplate: parseDocumentTemplate,
    stripBaseCss: stripBaseCss,
    loadExternal: loadExternal,
    parseStyle: parseStyle,
    styleText: styleText,
    /** 供预览/导出复用的「模板 → skin」转换 */
    skinOf: function (tpl) {
      if (!tpl || !tpl.skin || !tpl.skin.css) return null;
      return {
        id: tpl.id,
        label: tpl.name,
        wrapperClass: tpl.skin.wrapperClass || 'doc doc--tpl',
        css: tpl.skin.css,
        bare: false
      };
    }
  };
})(window);
