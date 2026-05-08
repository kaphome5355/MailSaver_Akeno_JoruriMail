/**
 * fileProcessor.js — Zipファイルの処理（展開・リネーム・紐付け）
 */

const FileProcessor = (() => {
  let _queue = [];      // { file, folderName, status, linked }
  let _mailEntries = [];

  // ===== キュー管理 =====

  function addFiles(files) {
    const zipFiles = Array.from(files).filter(f =>
      f.name.toLowerCase().endsWith('.zip') || f.type === 'application/zip'
    );

    if (zipFiles.length === 0) {
      Toast.show('Zipファイルのみ追加できます', 'warning');
      return 0;
    }

    zipFiles.forEach(file => {
      // 重複チェック
      const exists = _queue.some(q => q.file.name === file.name && q.file.size === file.size);
      if (!exists) {
        const item = {
          id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          file,
          folderName: autoLink(file),
          status: 'pending',  // pending | processing | done | error
          linked: false,
        };
        _queue.push(item);
      }
    });

    renderQueue();
    updateActionButtons();
    return zipFiles.length;
  }

  function removeFromQueue(id) {
    _queue = _queue.filter(q => q.id !== id);
    renderQueue();
    updateActionButtons();
  }

  function clearQueue() {
    _queue = [];
    renderQueue();
    updateActionButtons();
  }

  function setMailEntries(entries) {
    _mailEntries = entries;
  }

  // ===== 自動紐付け =====

  function autoLink(file) {
    // ファイル名から日付を抽出して対応するメールを探す
    const dateMatch = file.name.match(/(\d{4})[-_\/]?(\d{2})[-_\/]?(\d{2})/);
    if (dateMatch && _mailEntries.length > 0) {
      const ymd = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
      const matched = _mailEntries.find(e => e.date === ymd && e.isKept !== false);
      if (matched) return matched.folderName;
    }

    // 件名キーワードで検索
    const nameLower = file.name.replace(/\.zip$/i, '').toLowerCase();
    if (_mailEntries.length > 0) {
      const matched = _mailEntries.find(e =>
        e.isKept !== false && (
          e.subject.toLowerCase().includes(nameLower.slice(0, 10)) ||
          nameLower.includes(e.subject.toLowerCase().slice(0, 10))
        )
      );
      if (matched) return matched.folderName;
    }

    // マッチしない場合はファイル名から生成
    return file.name.replace(/\.zip$/i, '').replace(/[\s_\-]+/g, '_');
  }

  // ===== キューレンダリング =====

  function renderQueue() {
    const container = document.getElementById('fileQueue');
    if (!container) return;

    if (_queue.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-slate-300">
          <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p class="text-sm">ファイルがありません</p>
        </div>`;
      return;
    }

    container.innerHTML = _queue.map(item => renderQueueItem(item)).join('');

    // リネームフィールドのイベント
    container.querySelectorAll('.rename-input').forEach(input => {
      input.addEventListener('change', ev => {
        const id = ev.target.dataset.id;
        const item = _queue.find(q => q.id === id);
        if (item) item.folderName = ev.target.value;
      });
    });

    // 紐付けセレクトのイベント
    container.querySelectorAll('.link-select').forEach(sel => {
      sel.addEventListener('change', ev => {
        const id = ev.target.dataset.id;
        const item = _queue.find(q => q.id === id);
        if (item) {
          item.folderName = ev.target.value;
          item.linked = true;
          // input フィールドも同期
          const input = document.querySelector(`.rename-input[data-id="${CSS.escape(id)}"]`);
          if (input) input.value = ev.target.value;
        }
      });
    });

    // 削除ボタン
    container.querySelectorAll('.remove-queue-btn').forEach(btn => {
      btn.addEventListener('click', () => removeFromQueue(btn.dataset.id));
    });
  }

  function renderQueueItem(item) {
    const sizeMB = (item.file.size / 1024 / 1024).toFixed(2);
    const statusIcon = {
      pending: `<span class="w-5 h-5 rounded-full bg-slate-200 border-2 border-slate-300 flex items-center justify-center shrink-0"></span>`,
      processing: `<span class="w-5 h-5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0"></span>`,
      done: `<span class="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
               <svg class="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
               </svg></span>`,
      error: `<span class="w-5 h-5 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <svg class="w-3 h-3 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/>
                </svg></span>`,
    }[item.status] || '';

    // メール一覧のオプション
    const mailOptions = _mailEntries.filter(e => e.isKept !== false)
      .map(e => `<option value="${escAttr(e.folderName)}" ${e.folderName === item.folderName ? 'selected' : ''}>${escHtml(e.folderName)}</option>`)
      .join('');

    const renameMode = document.getElementById('renameMode')?.value || 'auto';

    return `
      <div class="queue-item border border-slate-200 rounded-xl p-3 bg-white" data-id="${item.id}">
        <div class="flex items-start gap-2 mb-2">
          ${statusIcon}
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-slate-700 truncate" title="${escAttr(item.file.name)}">
              ${escHtml(item.file.name)}
            </p>
            <p class="text-xs text-slate-400">${sizeMB} MB</p>
          </div>
          <button class="remove-queue-btn text-slate-300 hover:text-rose-500 transition-colors shrink-0" data-id="${item.id}" title="削除">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <!-- フォルダ名（リネーム先） -->
        <div class="space-y-1.5">
          <label class="text-xs text-slate-400">保存フォルダ名</label>
          <input type="text" class="rename-input w-full px-2 py-1.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-200 bg-slate-50"
            value="${escAttr(item.folderName)}"
            data-id="${item.id}"
            placeholder="フォルダ名..." />
          ${renameMode === 'manual' && mailOptions
            ? `<select class="link-select w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-200 bg-white text-slate-600" data-id="${item.id}">
                <option value="">— メールと紐付け —</option>
                ${mailOptions}
               </select>`
            : ''}
        </div>
      </div>`;
  }

  // ===== Zip展開処理 =====

  async function extractAll() {
    const pending = _queue.filter(q => q.status === 'pending');
    if (pending.length === 0) {
      Toast.show('処理するファイルがありません', 'warning');
      return;
    }

    const folderStructure = document.getElementById('folderStructure')?.value || 'flat';
    Log.clear();
    Log.show();

    for (const item of pending) {
      await extractItem(item, folderStructure);
    }

    renderQueue();
    const doneCount = _queue.filter(q => q.status === 'done').length;
    const errCount  = _queue.filter(q => q.status === 'error').length;
    Toast.show(
      `完了: ${doneCount}件展開、${errCount}件エラー`,
      errCount > 0 ? 'warning' : 'success'
    );
  }

  async function extractItem(item, folderStructure) {
    item.status = 'processing';
    renderQueueItem_update(item);
    Log.append(`🔄 処理中: ${item.file.name}`, 'info');

    try {
      const zip = new JSZip();
      const loaded = await zip.loadAsync(item.file);

      const datePrefix = extractDateFromFolderName(item.folderName);
      const basePath = buildBasePath(item.folderName, datePrefix, folderStructure);

      Log.append(`📂 展開先: ${basePath}/`, 'info');

      // 全ファイルをまとめてZipにまとめてダウンロード
      const outputZip = new JSZip();
      let fileCount = 0;

      const fileEntries = Object.values(loaded.files).filter(f => !f.dir);

      for (const zipEntry of fileEntries) {
        const content = await zipEntry.async('arraybuffer');
        const fileName = zipEntry.name.split('/').pop(); // パスの最後のファイル名のみ
        const outputPath = `${basePath}/${fileName}`;
        outputZip.file(outputPath, content);
        fileCount++;
        Log.append(`  ✔ ${fileName}`, 'success');
      }

      // まとめてダウンロード
      const outputBlob = await outputZip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      const downloadName = `${item.folderName}.zip`;
      downloadBlob(outputBlob, downloadName);

      item.status = 'done';
      Log.append(`✅ 完了: ${fileCount}ファイルを展開 → ${downloadName}`, 'success');

    } catch (err) {
      item.status = 'error';
      Log.append(`❌ エラー: ${item.file.name} — ${err.message}`, 'error');
      console.error('展開エラー:', err);
    }
  }

  function renderQueueItem_update(item) {
    // 特定アイテムのステータスアイコンのみ更新
    const el = document.querySelector(`#fileQueue [data-id="${CSS.escape(item.id)}"]`);
    if (el) {
      const newEl = document.createElement('div');
      newEl.innerHTML = renderQueueItem(item);
      const newChild = newEl.firstElementChild;
      if (newChild) el.replaceWith(newChild);
    }
  }

  function buildBasePath(folderName, datePrefix, folderStructure) {
    if (folderStructure === 'flat') return folderName;
    if (folderStructure === 'year' && datePrefix) return `${datePrefix.slice(0, 4)}/${folderName}`;
    if (folderStructure === 'yearmonth' && datePrefix) return `${datePrefix.slice(0, 4)}/${datePrefix.slice(4, 6)}/${folderName}`;
    return folderName;
  }

  function extractDateFromFolderName(name) {
    const m = name.match(/^(\d{8})/);
    return m ? m[1] : null;
  }

  // ===== アクションボタンの有効/無効 =====

  function updateActionButtons() {
    const hasItems = _queue.length > 0;
    ['extractAllBtn', 'generateBatBtn', 'generatePsBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = !hasItems;
    });
  }

  // ===== ユーティリティ =====

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function getQueue() { return _queue; }

  return {
    addFiles,
    clearQueue,
    setMailEntries,
    extractAll,
    getQueue,
  };
})();


// ===== ログUI =====
const Log = (() => {
  function append(msg, type = 'info') {
    const container = document.getElementById('logContent');
    if (!container) return;
    const colors = { info: 'text-slate-300', success: 'text-emerald-400', error: 'text-rose-400', warning: 'text-amber-400' };
    const div = document.createElement('div');
    div.className = colors[type] || 'text-slate-300';
    div.textContent = `[${timestamp()}] ${msg}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function clear() {
    const c = document.getElementById('logContent');
    if (c) c.innerHTML = '';
  }

  function show() {
    const el = document.getElementById('processLog');
    if (el) el.classList.remove('hidden');
  }

  function timestamp() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }

  return { append, clear, show };
})();
