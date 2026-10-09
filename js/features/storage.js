/* ==========================================================================
   storage.js — 本地持久化（localStorage）
   四类数据：
     1) draft:<modeId> : **每个模式各自独立**的自动草稿（切模式不互相覆盖）
     2) last-mode      : 上次所处的模式，用于下次打开时回到同一模式
     3) slots          : 用户「保存」的命名存档列表（跨模式共享的文档库，可恢复 / 删除）
     4) templates      : 用户自建的富文本模板（跨模式共享；内置模板不走这里）
   草稿与存档都会带上 templateId，用于记住该文档套用的是哪个模板版式。

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
  var KEY_TEMPLATES = PREFIX + 'templates';
  var MAX_SLOTS = 30;
  var MAX_TEMPLATES = 50;

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
      templateId: payload.templateId || '',
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
      var migrated = {
        html: legacy.html || '', mode: id,
        templateId: legacy.templateId || '', updatedAt: legacy.updatedAt
      };
      writeJSON(KEY_DRAFT_PREFIX + id, migrated);
      removeKey(KEY_LEGACY_DRAFT);
      return migrated;
    }
    return null;
  }

  function clearDraft(modeId) {
    removeKey(KEY_DRAFT_PREFIX + (modeId || 'default'));
  }

  /* ---------- 草稿恢复偏好：ask（每次询问）| auto（自动恢复）| never（空白开始） ---------- */

  var KEY_RESTORE_PREF = PREFIX + 'restore-pref';

  function loadRestorePref() {
    var v = readJSON(KEY_RESTORE_PREF, 'ask');
    return (v === 'auto' || v === 'never') ? v : 'ask';
  }

  function saveRestorePref(v) {
    return writeJSON(KEY_RESTORE_PREF, (v === 'auto' || v === 'never') ? v : 'ask');
  }

  /* ---------- 恢复失败的草稿备份（每模式各留最后一份，供导出找回） ---------- */

  var KEY_FAILED_PREFIX = PREFIX + 'failed-restore:';

  function saveFailedRestore(modeId, html) {
    return writeJSON(KEY_FAILED_PREFIX + (modeId || 'default'), {
      html: String(html || ''),
      mode: modeId || 'default',
      at: Date.now()
    });
  }

  function getFailedRestore(modeId) {
    return readJSON(KEY_FAILED_PREFIX + (modeId || 'default'), null);
  }

  function clearFailedRestore(modeId) {
    removeKey(KEY_FAILED_PREFIX + (modeId || 'default'));
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
      item.templateId = payload.templateId || '';
      item.updatedAt = Date.now();
    } else {
      item = {
        id: uid(),
        name: trimmed,
        html: payload.html || '',
        mode: payload.mode || 'default',
        templateId: payload.templateId || '',
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

  /* ---------- 用户自建模板（内置模板不写这里） ----------
     体积账：纯文本模板 1~4 KB/个，50 个约 200 KB，
     localStorage 的 5 MB 配额绰绰有余；只有模板里嵌 base64 图片才需要换 IndexedDB。 */

  function listTemplates() {
    var list = readJSON(KEY_TEMPLATES, []);
    return Array.isArray(list) ? list : [];
  }

  function getTemplate(id) {
    var list = listTemplates();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /**
   * 新建或覆盖同名模板
   * @param {object} payload { name, note, content, css, wrapperClass }
   */
  function saveTemplate(payload) {
    payload = payload || {};
    var list = listTemplates();
    var trimmed = (payload.name || '').trim() || '未命名模板';
    var item = null;

    for (var i = 0; i < list.length; i++) {
      if (list[i].name === trimmed) { item = list[i]; break; }
    }

    if (item) {
      item.note = payload.note || '';
      item.content = payload.content || '';
      item.css = payload.css || '';
      item.wrapperClass = payload.wrapperClass || 'doc doc--tpl';
      item.notes = Array.isArray(payload.notes) ? payload.notes.slice(0, 20) : (item.notes || []);
      item.updatedAt = Date.now();
    } else {
      item = {
        id: 'user-' + uid(),
        name: trimmed,
        note: payload.note || '',
        content: payload.content || '',
        css: payload.css || '',
        wrapperClass: payload.wrapperClass || 'doc doc--tpl',
        notes: Array.isArray(payload.notes) ? payload.notes.slice(0, 20) : [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      list.unshift(item);
    }

    if (list.length > MAX_TEMPLATES) list = list.slice(0, MAX_TEMPLATES);

    var ok = writeJSON(KEY_TEMPLATES, list);
    return ok ? item : null;
  }

  function renameTemplate(id, name) {
    var list = listTemplates();
    var trimmed = (name || '').trim();
    if (!trimmed) return null;
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { list[i].name = trimmed; list[i].updatedAt = Date.now(); hit = list[i]; }
    }
    if (!hit) return null;
    return writeJSON(KEY_TEMPLATES, list) ? hit : null;
  }

  function removeTemplate(id) {
    var list = listTemplates().filter(function (t) { return t.id !== id; });
    writeJSON(KEY_TEMPLATES, list);
    return list;
  }

  global.AppStorage = {
    available: OK,
    DRAFT_KEY_PREFIX: KEY_DRAFT_PREFIX,
    TEMPLATE_KEY: KEY_TEMPLATES,
    MAX_TEMPLATES: MAX_TEMPLATES,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    loadRestorePref: loadRestorePref,
    saveRestorePref: saveRestorePref,
    saveFailedRestore: saveFailedRestore,
    getFailedRestore: getFailedRestore,
    clearFailedRestore: clearFailedRestore,
    saveLastMode: saveLastMode,
    loadLastMode: loadLastMode,
    listSlots: listSlots,
    saveSlot: saveSlot,
    getSlot: getSlot,
    removeSlot: removeSlot,
    listTemplates: listTemplates,
    getTemplate: getTemplate,
    saveTemplate: saveTemplate,
    renameTemplate: renameTemplate,
    removeTemplate: removeTemplate
  };
})(window);
