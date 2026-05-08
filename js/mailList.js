/**
 * mailList.js — メール一覧の表示・フィルタリング・編集
 */

const MailList = (() => {
  let _entries = [];
  let _filteredEntries = [];
  let _filterText = '';
  let _sortMode = 'date-desc';
  let _showDuplicatesOnly = false;

  // ===== 公開API =====

  function setEntries(entries) {
    _entries = entries;
    applyFilterAndSort();
    render();
    renderSummaryCards();
  }

  function getSelectedEntries() {
    return _entries.filter(e => {
      const cb = document.getElementById(`cb_${CSS.escape(e.id)}`);
      return cb && cb.checked;
    });
  }

  function getKeptEntries() {
    return _entries.filter(e => e.isKept !== false);
  }

  // ===== フィルタ・ソート =====

  function applyFilterAndSort() {
    let list = [..._entries];

    // フィルタ
    if (_filterText) {
      const q = _filterText.toLowerCase();
      list = list.filter(e =>
        e.subject.toLowerCase().includes(q) ||
        e.date.includes(q) ||
        e.addresses.some(a => a.toLowerCase().includes(q)) ||
        e.folderName.toLowerCase().includes(q)
      );
    }

    // 重複のみ表示
    if (_showDuplicatesOnly) {
      list = list.filter(e => e.isDuplicate);
    }

    // ソート
    list.sort((a, b) => {
      if (_sortMode === 'date-desc') return b.date.localeCompare(a.date);
      if (_sortMode === 'date-asc') return a.date.localeCompare(b.date);
      if (_sortMode === 'subject') return a.subject.localeCompare(b.subject, 'ja');
      return 0;
    });

    _filteredEntries = list;
  }

  // ===== レンダリング =====

  function render() {
    const container = document.getElementById('mailList');
    if (!container) return;

    if (_filteredEntries.length === 0) {
      container.innerHTML = `
        <div class="text-center py-10 text-slate-400">
          <svg class="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="text-sm">${_filterText ? '条件に一致するメールがありません' : 'メールがありません'}</p>
        </div>`;
      return;
    }

    container.innerHTML = _filteredEntries.map(e => renderMailItem(e)).join('');

    // フォルダ名のインライン編集イベント
    container.querySelectorAll('.folder-name-input').forEach(input => {
      input.addEventListener('change', (ev) => {
        const id = ev.target.dataset.id;
        const entry = _entries.find(e => e.id === id);
        if (entry) {
          entry.folderName = ev.target.value;
          // 同じグループの entries も更新（同一件名・日付）
          _entries.forEach(e2 => {
            if (e2 !== entry &&
                e2.date === entry.date &&
                e2.subject === entry.subject) {
              e2.folderName = ev.target.value;
            }
          });
        }
      });
    });

    // チェックボックス変更
    container.querySelectorAll('.mail-checkbox').forEach(cb => {
      cb.addEventListener('change', updateSelectStats);
    });
  }

  function renderMailItem(e) {
    const isKept = e.isKept !== false;
    const isDup = e.isDuplicate;

    // バッジ
    let badge = '';
    if (isDup && isKept) {
      badge = `<span class="dup-badge bg-emerald-100 text-emerald-700">優先保持</span>`;
    } else if (isDup && !isKept) {
      badge = `<span class="dup-badge bg-rose-100 text-rose-600">重複除外</span>`;
    }

    // アドレスの表示
    const addrHtml = e.addresses.length > 0
      ? e.addresses.map(a => `<span class="inline-block bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-mono">${escHtml(a)}</span>`).join(' ')
      : '<span class="text-slate-300 text-xs">アドレスなし</span>';

    const rowBg = !isKept && isDup
      ? 'bg-rose-50 border-rose-100'
      : isKept && isDup
        ? 'bg-emerald-50 border-emerald-100'
        : 'bg-white border-slate-200';

    const safeId = CSS.escape(e.id);

    return `
      <div class="mail-item border rounded-xl p-3 transition-all hover:shadow-sm ${rowBg}" data-id="${escAttr(e.id)}">
        <div class="flex items-start gap-3">
          <input type="checkbox" id="cb_${safeId}" class="mail-checkbox mt-1 w-4 h-4 rounded accent-blue-500 shrink-0 cursor-pointer"
            data-id="${escAttr(e.id)}" ${isKept ? 'checked' : ''} />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg">${escHtml(e.date)}</span>
              ${badge}
              ${e.groupSize > 1 ? `<span class="text-xs text-slate-400">${e.groupSize}件の重複グループ</span>` : ''}
            </div>
            <p class="text-sm font-semibold text-slate-800 truncate mb-1" title="${escAttr(e.subject)}">
              ${highlightText(escHtml(e.subject || '（件名なし）'), _filterText)}
            </p>
            <div class="flex flex-wrap gap-1 mb-2">${addrHtml}</div>
            <!-- フォルダ名（インライン編集） -->
            <div class="flex items-center gap-2">
              <svg class="w-3.5 h-3.5 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
              </svg>
              <input
                type="text"
                class="folder-name-input flex-1 text-xs font-mono text-slate-600 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-300 focus:bg-white rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-200 transition-all min-w-0"
                value="${escAttr(e.folderName)}"
                data-id="${escAttr(e.id)}"
                title="クリックして編集"
              />
            </div>
          </div>
        </div>
      </div>`;
  }

  // ===== サマリーカード =====

  function renderSummaryCards() {
    const container = document.getElementById('summaryCards');
    if (!container) return;

    const total = _entries.length;
    const dupGroups = new Set(_entries.filter(e => e.isDuplicate).map(e => e.date + e.subject)).size;
    const kept = _entries.filter(e => e.isKept !== false).length;
    const excluded = total - kept;

    container.innerHTML = `
      <div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
        <p class="text-2xl font-bold text-blue-700">${total}</p>
        <p class="text-xs text-blue-500 mt-0.5">総メール数</p>
      </div>
      <div class="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
        <p class="text-2xl font-bold text-amber-600">${dupGroups}</p>
        <p class="text-xs text-amber-500 mt-0.5">重複グループ</p>
      </div>
      <div class="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
        <p class="text-2xl font-bold text-emerald-700">${kept}</p>
        <p class="text-xs text-emerald-500 mt-0.5">保持 / <span class="text-rose-500">${excluded}</span> 除外</p>
      </div>`;

    // ステップ2の統計表示更新
    const statsEl = document.getElementById('step2Stats');
    if (statsEl) {
      statsEl.innerHTML = `
        <span class="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">${kept}件を処理</span>`;
    }
  }

  function updateSelectStats() {
    const selected = getSelectedEntries().length;
    const total = _filteredEntries.length;
    // 必要に応じてUIに反映（将来拡張用）
  }

  // ===== 選択操作 =====

  function selectAll() {
    document.querySelectorAll('.mail-checkbox').forEach(cb => { cb.checked = true; });
  }

  function deselectAll() {
    document.querySelectorAll('.mail-checkbox').forEach(cb => { cb.checked = false; });
  }

  // ===== CSV エクスポート =====

  function exportCsv() {
    const selected = getSelectedEntries();
    if (selected.length === 0) {
      Toast.show('エクスポートするメールを選択してください', 'warning');
      return;
    }

    const header = ['日付', '件名', 'アドレス', 'フォルダ名', 'ステータス'];
    const rows = selected.map(e => [
      e.date,
      e.subject,
      e.addresses.join('; '),
      e.folderName,
      e.isKept ? '保持' : '除外'
    ]);

    const csv = [header, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const bom = '\uFEFF'; // BOM (Excel対応)
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `joruri_mail_${formatDate(new Date())}.csv`);
    Toast.show(`${selected.length}件をCSVとしてエクスポートしました`, 'success');
  }

  // ===== フィルタ・ソートの更新 =====

  function setFilter(text) {
    _filterText = text;
    applyFilterAndSort();
    render();
  }

  function setSort(mode) {
    _sortMode = mode;
    applyFilterAndSort();
    render();
  }

  function setShowDuplicatesOnly(val) {
    _showDuplicatesOnly = val;
    applyFilterAndSort();
    render();
  }

  // ===== ユーティリティ =====

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  function highlightText(html, query) {
    if (!query) return html;
    const q = escHtml(query.toLowerCase());
    return html.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
      '<mark class="highlight">$1</mark>');
  }

  function formatDate(d) {
    return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  return {
    setEntries,
    getSelectedEntries,
    getKeptEntries,
    selectAll,
    deselectAll,
    exportCsv,
    setFilter,
    setSort,
    setShowDuplicatesOnly,
  };
})();
