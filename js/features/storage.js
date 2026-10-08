/* ==========================================================================
   storage.js — 本地持久化（localStorage）
   三类数据：
     1) draft:<modeId> : **每个模式各自独立**的自动草稿（切模式不互相覆盖）
     2) last-mode      : 上次所处的模式，用于下次打开时回到同一模式
     3) slots          : 用户「保存」的命名存档列表（跨模式共享的文档库，可恢复 / 删除）

   说明：旧版本只有一份全局草稿 `…:draft`。loadDraft() 会做一次兼容迁移：
   若该旧草稿记录的 mode 与请求的模式一致，则当作该模式的草稿使用。
   ========================================================================== */
(function (global) {
  'use strict';

  var PREFIX = 'wangeditor-blog-editor:';
  var KEY_DRAFT_PREFIX = PREFIX + 'draft:';
  var KEY_LEGACY_DRAFT = PREFIX + 'draft';
  var KEY_LAST_MODE = PREFIX + 'last-mode';
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

  function removeKey(key) {
    if (!OK) return;
    try { global.localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 自动草稿：按模式分开存储 ---------- */

  function saveDraft(modeId, payload) {
    payload = payload || {};
    return writeJSON(KEY_DRAFT_PREFIX + (modeId || 'default'), {
      html: payload.html || '',
      mode: modeId || 'default',
      updatedAt: Date.now()
    });
  }

  function loadDraft(modeId) {
    var id = modeId || 'default';
    var own = readJSON(KEY_DRAFT_PREFIX + id, null);
    if (own) return own;

    // 兼容旧版单份草稿：仅当它记录的 mode 与当前模式一致时沿用
    var legacy = readJSON(KEY_LEGACY_DRAFT, null);
    if (legacy && (legacy.mode || 'default') === id) {
      var migrated = { html: legacy.html || '', mode: id, updatedAt: legacy.updatedAt };
      writeJSON(KEY_DRAFT_PREFIX + id, migrated);
      removeKey(KEY_LEGACY_DRAFT);
      return migrated;
    }
    return null;
  }

  function clearDraft(modeId) {
    removeKey(KEY_DRAFT_PREFIX + (modeId || 'default'));
  }

  /* ---------- 上次所处模式 ---------- */

  function saveLastMode(modeId) {
    return writeJSON(KEY_LAST_MODE, String(modeId || ''));
  }

  function loadLastMode() {
    var v = readJSON(KEY_LAST_MODE, '');
    return typeof v === 'string' ? v : '';
  }

  /* ---------- 命名存档（跨模式共享的文档库） ---------- */

  function listSlots() {
    var list = readJSON(KEY_SLOTS, []);
    return Array.isArray(list) ? list : [];
  }

  function saveSlot(name, payload) {
    payload = payload || {};
    var list = listSlots();
    var trimmed = (name || '').trim() || '未命名存档';
    var item = null;

    for (var i = 0; i < list.length; i++) {
      if (list[i].name === trimmed) { item = list[i]; break; }
    }

    if (item) {
      item.html = payload.html || '';
      item.mode = payload.mode || 'default';
      item.updatedAt = Date.now();
    } else {
      item = {
        id: uid(),
        name: trimmed,
        html: payload.html || '',
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
    DRAFT_KEY_PREFIX: KEY_DRAFT_PREFIX,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    saveLastMode: saveLastMode,
    loadLastMode: loadLastMode,
    listSlots: listSlots,
    saveSlot: saveSlot,
    getSlot: getSlot,
    removeSlot: removeSlot
  };
})(window);
