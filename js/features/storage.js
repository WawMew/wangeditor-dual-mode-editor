/* ==========================================================================
   storage.js — 本地持久化（localStorage）
   两类数据：
     1) draft  : 当前文档的自动草稿（每次变更节流写入，关闭页面后仍在）
     2) slots  : 用户「保存」的命名存档列表（可恢复 / 删除）
   ========================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'wangeditor-blog-editor:';
  var KEY_DRAFT = PREFIX + 'draft';
  var KEY_SLOTS = PREFIX + 'slots';
  var MAX_SLOTS = 30;

  function available() {
    try {
      var k = PREFIX + '__probe';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  var OK = available();

  function readJSON(key, fallback) {
    if (!OK) return fallback;
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    if (!OK) return false;
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // 多为超配额（base64 图片过多）
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /** 把当前文档写入自动草稿 */
  function saveDraft(payload) {
    payload = payload || {};
    return writeJSON(KEY_DRAFT, {
      html: payload.html || '',
      title: payload.title || '',
      mode: payload.mode || 'default',
      updatedAt: Date.now()
    });
  }

  function loadDraft() {
    return readJSON(KEY_DRAFT, null);
  }

  function clearDraft() {
    if (!OK) return;
    try { global.localStorage.removeItem(KEY_DRAFT); } catch (e) { /* noop */ }
  }

  /** 命名存档：同名则覆盖 */
  function listSlots() {
    var list = readJSON(KEY_SLOTS, []);
    return Array.isArray(list) ? list : [];
  }

  function saveSlot(name, payload) {
    payload = payload || {};
    var list = listSlots();
    var trimmed = (name || '').trim() || '未命名文档';
    var item = null;

    for (var i = 0; i < list.length; i++) {
      if (list[i].name === trimmed) { item = list[i]; break; }
    }

    if (item) {
      item.html = payload.html || '';
      item.title = payload.title || '';
      item.mode = payload.mode || 'default';
      item.updatedAt = Date.now();
    } else {
      item = {
        id: uid(),
        name: trimmed,
        html: payload.html || '',
        title: payload.title || '',
        mode: payload.mode || 'default',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      list.unshift(item);
    }

    // 超出上限时丢弃最旧的
    if (list.length > MAX_SLOTS) list = list.slice(0, MAX_SLOTS);

    var ok = writeJSON(KEY_SLOTS, list);
    return ok ? item : null;
  }

  function getSlot(id) {
    var list = listSlots();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function removeSlot(id) {
    var list = listSlots().filter(function (s) { return s.id !== id; });
    writeJSON(KEY_SLOTS, list);
    return list;
  }

  global.AppStorage = {
    available: OK,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    listSlots: listSlots,
    saveSlot: saveSlot,
    getSlot: getSlot,
    removeSlot: removeSlot
  };
})(window);
