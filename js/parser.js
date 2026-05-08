/**
 * parser.js — JoruriMailのテキスト解析・重複排除エンジン
 */

const Parser = (() => {

  // ===== 日付パターン =====
  const DATE_PATTERNS = [
    // YYYY/MM/DD HH:MM
    /(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/,
    // MM/DD/YYYY
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
  ];

  // ===== メールアドレスパターン =====
  const EMAIL_PATTERN = /[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+/gi;

  /**
   * 貼り付けテキストを解析してメール情報の配列を返す
   * @param {string} text
   * @returns {Array<MailEntry>}
   */
  function parse(text) {
    if (!text || !text.trim()) return [];

    const lines = text.split('\n').map(l => l.trimEnd());
    const entries = [];

    // ===== 戦略1: 行単位でパース（1行 = 1メール の表形式）=====
    const tableEntries = parseTableFormat(lines);
    if (tableEntries.length > 0) {
      return postProcess(tableEntries);
    }

    // ===== 戦略2: ブロック単位でパース（複数行で1メール）=====
    const blockEntries = parseBlockFormat(lines);
    return postProcess(blockEntries);
  }

  /**
   * 表形式（1行 = 1メール）のパース
   * JoruriMailの一般的な一覧コピー形式:
   *   2024/01/15  請求書送付のご連絡  billing@example.com
   */
  function parseTableFormat(lines) {
    const results = [];
    let consecutiveHits = 0;

    for (const line of lines) {
      if (!line.trim()) continue;

      const dateMatch = extractDate(line);
      if (!dateMatch) continue;

      const emails = extractEmails(line);
      const subject = extractSubject(line, dateMatch.raw, emails);

      if (subject || emails.length > 0) {
        consecutiveHits++;
        results.push({
          rawLine: line,
          date: dateMatch.normalized,
          dateRaw: dateMatch.raw,
          subject: cleanSubject(subject),
          addresses: emails,
          folderName: '',
        });
      }
    }

    // 表形式と判断するには連続するヒットが必要
    return consecutiveHits >= 1 ? results : [];
  }

  /**
   * ブロック形式のパース
   * 複数行にわたる詳細表示形式に対応
   */
  function parseBlockFormat(lines) {
    const results = [];
    let current = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 日付行の検出
      const dateMatch = extractDate(line);
      if (dateMatch) {
        if (current) results.push(current);
        current = {
          rawLine: line,
          date: dateMatch.normalized,
          dateRaw: dateMatch.raw,
          subject: '',
          addresses: extractEmails(line),
          folderName: '',
        };
        // 同じ行から件名も取得を試みる
        const sub = extractSubject(line, dateMatch.raw, current.addresses);
        if (sub) current.subject = cleanSubject(sub);
        continue;
      }

      if (!current) continue;

      // 件名行の検出（"件名:" "Subject:" などのプレフィックス）
      const subjectMatch = line.match(/^(?:件名|subject|タイトル|title)\s*[:：]\s*(.+)/i);
      if (subjectMatch) {
        current.subject = cleanSubject(subjectMatch[1]);
        continue;
      }

      // メールアドレスの補完
      const emails = extractEmails(line);
      if (emails.length > 0) {
        emails.forEach(e => {
          if (!current.addresses.includes(e)) current.addresses.push(e);
        });
        continue;
      }

      // まだ件名が未確定で、それっぽい行なら件名として採用
      if (!current.subject && line.trim() && !line.match(/^[-=_*]+$/)) {
        const cleaned = line.trim().replace(/^\s*[\|│]\s*/, '').trim();
        if (cleaned.length >= 2 && cleaned.length <= 200) {
          current.subject = cleanSubject(cleaned);
        }
      }
    }

    if (current) results.push(current);
    return results;
  }

  /**
   * テキストから日付を抽出
   */
  function extractDate(text) {
    for (const pat of DATE_PATTERNS) {
      const m = text.match(pat);
      if (!m) continue;

      let y, mo, d;
      // YYYY/MM/DD 形式
      if (m[1].length === 4) {
        y = m[1]; mo = m[2].padStart(2, '0'); d = m[3].padStart(2, '0');
      } else {
        // MM/DD/YYYY
        y = m[3]; mo = m[1].padStart(2, '0'); d = m[2].padStart(2, '0');
      }

      const year = parseInt(y);
      const month = parseInt(mo);
      const day = parseInt(d);
      if (year < 2000 || year > 2099) continue;
      if (month < 1 || month > 12) continue;
      if (day < 1 || day > 31) continue;

      return {
        raw: m[0],
        normalized: `${y}/${mo}/${d}`,
        yyyymmdd: `${y}${mo}${d}`,
      };
    }
    return null;
  }

  /**
   * テキストからメールアドレスを抽出
   */
  function extractEmails(text) {
    EMAIL_PATTERN.lastIndex = 0;
    const found = [];
    let m;
    while ((m = EMAIL_PATTERN.exec(text)) !== null) {
      const addr = m[0].toLowerCase();
      if (!found.includes(addr)) found.push(addr);
    }
    return found;
  }

  /**
   * 日付・アドレスを除いた残りを件名として抽出
   */
  function extractSubject(text, dateRaw, emails) {
    let s = text;
    // 日付部分を除去
    if (dateRaw) s = s.replace(dateRaw, '');
    // メールアドレスを除去
    emails.forEach(e => { s = s.replace(e, ''); });
    // 区切り文字・記号を除去
    s = s.replace(/[\t|│｜,，;；]+/g, ' ');
    // 連続スペースを単一に
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
  }

  /**
   * 件名のクリーニング
   */
  function cleanSubject(s) {
    return s
      .replace(/^[\s\-\|_\/\\]+/, '')  // 先頭の区切り文字
      .replace(/[\s\-\|_\/\\]+$/, '')  // 末尾の区切り文字
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 後処理: フォルダ名生成 & 重複フラグ設定
   */
  function postProcess(entries) {
    // フォルダ名生成
    entries.forEach(e => {
      e.folderName = Settings.buildFolderName(e.date, e.subject || '件名なし');
      e.id = generateId(e);
    });

    // 重複検出
    markDuplicates(entries);

    return entries;
  }

  /**
   * 重複検出と優先アドレスによる選別
   */
  function markDuplicates(entries) {
    const priorityAddrs = Settings.get('priorityAddresses') || [];

    // groupKey: 日付 + 件名（正規化）でグループ化
    const groups = {};
    entries.forEach(e => {
      const key = `${e.date}__${normalizeSubject(e.subject)}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });

    Object.values(groups).forEach(group => {
      if (group.length === 1) {
        group[0].isDuplicate = false;
        group[0].isKept = true;
        group[0].groupSize = 1;
        return;
      }

      // 重複グループ
      group.forEach(e => {
        e.isDuplicate = true;
        e.groupSize = group.length;
      });

      // 優先アドレスに基づいて残すものを選ぶ
      let kept = null;

      if (priorityAddrs.length > 0) {
        // 優先アドレス順に照合
        for (const pAddr of priorityAddrs) {
          const match = group.find(e =>
            e.addresses.some(a => a.includes(pAddr) || pAddr.includes(a))
          );
          if (match) { kept = match; break; }
        }
      }

      // 優先アドレスで決まらなかった場合は最初のエントリを残す
      if (!kept) kept = group[0];

      group.forEach(e => {
        e.isKept = (e === kept);
        e.keptReason = e.isKept
          ? (priorityAddrs.length > 0 && kept === e && priorityAddrs.some(p => e.addresses.some(a => a.includes(p))) ? '優先アドレス' : '最初のエントリ')
          : null;
      });
    });
  }

  function normalizeSubject(s) {
    return (s || '')
      .replace(/\s+/g, '')
      .replace(/[　]/g, '')
      .toLowerCase();
  }

  function generateId(e) {
    return `${e.date}_${(e.subject || '').slice(0, 20)}_${(e.addresses[0] || '')}`.replace(/\s/g, '_');
  }

  return { parse };
})();
