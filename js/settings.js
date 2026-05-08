/**
 * settings.js — アプリ設定の管理（localStorage永続化）
 */

const Settings = (() => {
  const STORAGE_KEY = 'joruri_mail_settings';

  const defaults = {
    priorityAddresses: [],
    folderFormat: '{YYYYMMDD}_{件名}',
    maxSubjectLen: 30,
    batDestFolder: '%USERPROFILE%\\Desktop\\メール',
    replaceChar: '_',
  };

  let current = { ...defaults };

  // ロード
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        current = { ...defaults, ...parsed };
      }
    } catch (e) {
      console.warn('設定の読み込みに失敗しました:', e);
    }
    applyToUI();
  }

  // 保存
  function save() {
    readFromUI();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
      console.warn('設定の保存に失敗しました:', e);
    }
  }

  // UIから読み込み
  function readFromUI() {
    const addrRaw = document.getElementById('priorityAddresses')?.value ?? '';
    current.priorityAddresses = addrRaw
      .split('\n')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    current.folderFormat = document.getElementById('folderFormat')?.value || defaults.folderFormat;
    current.maxSubjectLen = parseInt(document.getElementById('maxSubjectLen')?.value) || defaults.maxSubjectLen;
    current.batDestFolder = document.getElementById('batDestFolder')?.value || defaults.batDestFolder;
    current.replaceChar = (document.getElementById('replaceChar')?.value || '_')[0] || '_';
  }

  // UIへ反映
  function applyToUI() {
    const addrEl = document.getElementById('priorityAddresses');
    if (addrEl) addrEl.value = current.priorityAddresses.join('\n');

    const formatEl = document.getElementById('folderFormat');
    if (formatEl) formatEl.value = current.folderFormat;

    const maxLenEl = document.getElementById('maxSubjectLen');
    if (maxLenEl) maxLenEl.value = current.maxSubjectLen;

    const batEl = document.getElementById('batDestFolder');
    if (batEl) batEl.value = current.batDestFolder;

    const replEl = document.getElementById('replaceChar');
    if (replEl) replEl.value = current.replaceChar;
  }

  // フォルダ名生成
  function buildFolderName(dateStr, subject) {
    // dateStr: 'YYYY/MM/DD' or 'YYYY-MM-DD' or 'YYYYMMDD'
    const parts = parseDateParts(dateStr);
    const safeSubject = sanitizeFilename(subject, current.replaceChar)
      .substring(0, current.maxSubjectLen)
      .trim();

    return current.folderFormat
      .replace('{YYYYMMDD}', `${parts.y}${parts.m}${parts.d}`)
      .replace('{YYYY}', parts.y)
      .replace('{MM}', parts.m)
      .replace('{DD}', parts.d)
      .replace('{件名}', safeSubject);
  }

  function parseDateParts(dateStr) {
    // 様々な日付形式に対応
    const s = dateStr.replace(/[\/\-\.]/g, '');
    if (s.length >= 8) {
      return { y: s.slice(0, 4), m: s.slice(4, 6), d: s.slice(6, 8) };
    }
    return { y: '0000', m: '00', d: '00' };
  }

  // ファイル名の禁止文字を除去
  function sanitizeFilename(name, replChar = '_') {
    return name
      .replace(/[\\\/:\*\?"<>|]/g, replChar)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function get(key) {
    return current[key];
  }

  return { load, save, get, buildFolderName, sanitizeFilename, defaults };
})();
