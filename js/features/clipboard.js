/* ==========================================================================
   clipboard.js — 剪贴板能力
     copyRich(html, text) : 同时写入 text/html 与 text/plain，
                            粘贴到 Word / 公众号 / 邮件时保留格式
     copyPlain(text)      : 只写纯文本（复制 HTML 源码用）
   优先使用异步 Clipboard API（需 https 或 localhost 安全上下文），
   失败或不可用时回退到 contenteditable + execCommand('copy')。
   ========================================================================== */
(function (global) {
  'use strict';

  var doc = global.document;

  function canUseAsyncApi() {
    return !!(global.navigator &&
      global.navigator.clipboard &&
      typeof global.ClipboardItem === 'function' &&
      global.isSecureContext);
  }

  /** 回退方案：临时 contenteditable 节点 + execCommand */
  function legacyCopy(html, text) {
    var host = doc.createElement('div');
    host.contentEditable = 'true';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = [
      'position:fixed',
      'left:-99999px',
      'top:0',
      'width:1px',
      'height:1px',
      'overflow:hidden',
      'opacity:0'
    ].join(';');

    if (html) host.innerHTML = html;
    else host.textContent = text || '';

    doc.body.appendChild(host);

    var range = doc.createRange();
    range.selectNodeContents(host);

    var sel = global.getSelection();
    var previous = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;

    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    var ok = false;
    try {
      ok = doc.execCommand('copy');
    } catch (e) {
      ok = false;
    }

    if (sel) {
      sel.removeAllRanges();
      if (previous) sel.addRange(previous);
    }
    doc.body.removeChild(host);

    return ok;
  }

  /** 富文本复制：html 为空时退化为纯文本 */
  function copyRich(html, text) {
    text = text == null ? '' : String(text);

    if (canUseAsyncApi()) {
      var items = {};
      if (html) items['text/html'] = new global.Blob([html], { type: 'text/html' });
      items['text/plain'] = new global.Blob([text], { type: 'text/plain' });

      return global.navigator.clipboard
        .write([new global.ClipboardItem(items)])
        .then(function () { return true; })
        .catch(function () { return legacyCopy(html, text); });
    }

    return Promise.resolve(legacyCopy(html, text));
  }

  /** 纯文本复制 */
  function copyPlain(text) {
    text = text == null ? '' : String(text);

    if (canUseAsyncApi()) {
      return global.navigator.clipboard
        .writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy('', text); });
    }

    return Promise.resolve(legacyCopy('', text));
  }

  global.AppClipboard = {
    copyRich: copyRich,
    copyPlain: copyPlain,
    legacyCopy: legacyCopy
  };
})(window);
