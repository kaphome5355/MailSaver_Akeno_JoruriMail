/**
 * settings.js — アプリ設定の管理（localStorage永続化）
 */

const Settings = (() => {
  const STORAGE_KEY = 'joruri_mail_settings_v2';

  const defaults = {
    folderFormat: '{YYYYMMDD}_{件名}',
    maxSubjectLen: 30,
    batDestFolder: '%USERPROFILE%\\Desktop\\メール',
    replaceChar: '_',
  };

  let current = { ...defaults };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) current = { ...defaults, ...JSON.parse(raw) };
    } catch (e) {
      console.warn('設定読み込みエラー:', e);
    }
    applyToUI();
  }

  function save() {
    readFromUI();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.warn('設定保存エラー:', e);
    }
  }

  function readFromUI() {
    current.folderFormat   = document.getElementById('folderFormat')?.value  || defaults.folderFormat;
    current.maxSubjectLen  = parseInt(document.getElementById('maxSubjectLen')?.value) || defaults.maxSubjectLen;
    current.batDestFolder  = document.getElementById('batDestFolder')?.value  || defaults.batDestFolder;
    current.replaceChar    = (document.getElementById('replaceChar')?.value || '_')[0] || '_';
  }

  function applyToUI() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('folderFormat',  current.folderFormat);
    set('maxSubjectLen', current.maxSubjectLen);
    set('batDestFolder', current.batDestFolder);
    set('replaceChar',   current.replaceChar);
  }

  /** フォルダ名を生成する  dateStr: 'YYYY/MM/DD' など */
  function buildFolderName(dateStr, subject) {
    const p = parseDateParts(dateStr);
    const safe = sanitizeFilename(subject || '件名なし', current.replaceChar)
                   .substring(0, current.maxSubjectLen).trim();
    return current.folderFormat
      .replace('{YYYYMMDD}', `${p.y}${p.m}${p.d}`)
      .replace('{YYYY}', p.y).replace('{MM}', p.m).replace('{DD}', p.d)
      .replace('{件名}', safe);
  }

  function parseDateParts(dateStr) {
    const s = String(dateStr).replace(/[\/\-\.]/g, '');
    if (s.length >= 8) return { y: s.slice(0,4), m: s.slice(4,6), d: s.slice(6,8) };
    return { y:'0000', m:'00', d:'00' };
  }

  function sanitizeFilename(name, replChar = '_') {
    return String(name).replace(/[\\\/:\*\?"<>|]/g, replChar).replace(/\s+/g, ' ').trim();
  }

  function get(key) { return current[key]; }

  return { load, save, get, buildFolderName, sanitizeFilename };
})();
