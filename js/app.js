/**
 * app.js — メインコントローラー（新仕様版）
 * STEP1: 本文保存 → STEP2: 添付ファイル登録 → STEP3: バッチ生成
 */

// ===== トースト通知 =====
const Toast = (() => {
  function show(msg, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const colors = {
      success: 'bg-emerald-600 text-white',
      error:   'bg-rose-600 text-white',
      warning: 'bg-amber-500 text-white',
      info:    'bg-slate-700 text-white',
    };
    const icons = {
      success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>',
      error:   '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>',
      warning: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>',
      info:    '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>',
    };
    const toast = document.createElement('div');
    toast.className = `toast flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg max-w-xs text-sm font-medium ${colors[type] || colors.info}`;
    toast.innerHTML = `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icons[type]||icons.info}</svg><span>${esc(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, duration);
  }
  return { show };
})();


// ===== アプリ本体 =====
class App {
  constructor() {
    // ── データストア ──
    this.savedMails  = [];  // [{ id, date, subject, body, folderName }]
    this.attachItems = [];  // [{ id, file, folderName }]
    this.currentStep = 1;

    Settings.load();
    this.bindStep1();
    this.bindStep2();
    this.bindStep3();
    this.bindSettings();
    this.activateStep(1);

    // 今日の日付をデフォルト設定
    const dateEl = document.getElementById('mailDateInput');
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
  }

  // ================================================================
  //  ステップ管理
  // ================================================================
  activateStep(n) {
    this.currentStep = n;
    [1, 2, 3].forEach(i => {
      const sec = document.getElementById(`step${i}`);
      if (!sec) return;
      if (i <= n) {
        sec.classList.remove('opacity-40', 'pointer-events-none');
      } else {
        sec.classList.add('opacity-40', 'pointer-events-none');
      }
    });
    this.updateStepIndicators(n);
    if (n > 1) {
      setTimeout(() => {
        document.getElementById(`step${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  updateStepIndicators(cur) {
    [1, 2, 3].forEach(i => {
      const ind = document.querySelector(`.step-indicator[data-step="${i}"]`);
      if (!ind) return;
      const circle = ind.querySelector('.step-circle');
      const label  = ind.querySelector('span');
      // クラスをリセット
      circle.className = 'step-circle w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300';

      if (i < cur) {
        circle.classList.add('bg-emerald-500', 'text-white', 'shadow-md', 'shadow-emerald-200');
        circle.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>';
        label?.classList.replace('text-slate-400', 'text-emerald-600');
        label?.classList.replace('text-blue-700',  'text-emerald-600');
        label?.classList.replace('text-violet-700','text-emerald-600');
      } else if (i === cur) {
        const colors = ['bg-blue-600 shadow-blue-200', 'bg-violet-600 shadow-violet-200', 'bg-amber-500 shadow-amber-200'];
        const lblColors = ['text-blue-700', 'text-violet-700', 'text-amber-700'];
        circle.classList.add(...colors[i-1].split(' '), 'text-white', 'shadow-md');
        circle.textContent = i;
        if (label) {
          label.className = label.className.replace(/text-\w+-\d+/g, '');
          label.classList.add(lblColors[i-1], 'font-bold');
        }
      } else {
        circle.classList.add('bg-slate-200', 'text-slate-400');
        circle.textContent = i;
        if (label) {
          label.className = label.className.replace(/text-\w+-\d+/g, '');
          label.classList.add('text-slate-400');
        }
      }
    });

    // ステップ間ライン
    ['line-1-2', 'line-2-3'].forEach((id, idx) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (cur > idx + 1) {
        el.classList.add('bg-emerald-400');
        el.classList.remove('bg-slate-200');
      } else {
        el.classList.remove('bg-emerald-400');
        el.classList.add('bg-slate-200');
      }
    });
  }

  // ================================================================
  //  STEP 1 — 本文保存
  // ================================================================
  bindStep1() {
    // 「追加」ボタン
    document.getElementById('addToListBtn')?.addEventListener('click', () => this.addMail());

    // 「クリア」ボタン
    document.getElementById('clearBodyBtn')?.addEventListener('click', () => {
      document.getElementById('mailSubjectInput').value = '';
      document.getElementById('mailBodyInput').value    = '';
      document.getElementById('mailDateInput').value    = new Date().toISOString().slice(0,10);
    });

    // 「全件 .txt 一括ダウンロード」
    document.getElementById('downloadAllTxtBtn')?.addEventListener('click', () => this.downloadAllTxt());

    // 「リストをクリア」
    document.getElementById('clearSavedListBtn')?.addEventListener('click', () => {
      if (!confirm('保存リストをすべてクリアしますか？')) return;
      this.savedMails = [];
      this.renderSavedList();
      this.updateSavedBadge();
      Toast.show('リストをクリアしました', 'info');
    });

    // 「STEP 2 へ進む」
    document.getElementById('proceedToStep2Btn')?.addEventListener('click', () => {
      if (this.savedMails.length === 0) {
        Toast.show('本文を1件以上保存してから進んでください', 'warning');
        return;
      }
      this.activateStep(2);
      this.renderAttachLinkSelects(); // STEP2の紐付けプルダウン更新
      Toast.show(`${this.savedMails.length}件の本文を登録しました`, 'success');
    });
  }

  addMail() {
    const subject = document.getElementById('mailSubjectInput')?.value.trim();
    const dateVal = document.getElementById('mailDateInput')?.value;
    const body    = document.getElementById('mailBodyInput')?.value.trim();

    if (!subject) { Toast.show('件名を入力してください', 'warning'); return; }
    if (!dateVal)  { Toast.show('日付を入力してください', 'warning'); return; }
    if (!body)     { Toast.show('本文を貼り付けてください', 'warning'); return; }

    // 日付を YYYY/MM/DD 形式に
    const dateStr = dateVal.replace(/-/g, '/');

    const mail = {
      id:         `mail_${Date.now()}`,
      date:       dateStr,
      subject:    subject,
      body:       body,
      folderName: Settings.buildFolderName(dateStr, subject),
    };

    this.savedMails.push(mail);
    this.renderSavedList();
    this.updateSavedBadge();

    // 入力フィールドをクリア（件名・本文のみ）
    document.getElementById('mailSubjectInput').value = '';
    document.getElementById('mailBodyInput').value    = '';

    Toast.show(`保存しました：${mail.folderName}`, 'success');
  }

  renderSavedList() {
    const area = document.getElementById('savedMailsArea');
    const list = document.getElementById('savedMailsList');
    if (!area || !list) return;

    if (this.savedMails.length === 0) {
      area.classList.add('hidden');
      return;
    }
    area.classList.remove('hidden');

    list.innerHTML = this.savedMails.map((m, idx) => `
      <div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <div class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">${idx+1}</div>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-slate-700 truncate">${esc(m.folderName)}</p>
          <p class="text-xs text-slate-400 truncate">${esc(m.subject)}</p>
        </div>
        <div class="flex gap-2 shrink-0">
          <button class="text-xs px-2 py-1 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors dl-txt-btn" data-id="${m.id}">
            .txt
          </button>
          <button class="text-xs px-2 py-1 rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50 transition-colors del-mail-btn" data-id="${m.id}">
            削除
          </button>
        </div>
      </div>
    `).join('');

    // 個別ダウンロード
    list.querySelectorAll('.dl-txt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = this.savedMails.find(x => x.id === btn.dataset.id);
        if (m) this.downloadTxt(m);
      });
    });

    // 個別削除
    list.querySelectorAll('.del-mail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.savedMails = this.savedMails.filter(x => x.id !== btn.dataset.id);
        // 対応する添付ファイルの紐付けも解除
        this.attachItems = this.attachItems.filter(a => {
          const still = this.savedMails.some(m => m.folderName === a.folderName);
          return still;
        });
        this.renderSavedList();
        this.updateSavedBadge();
        this.renderAttachQueue();
        Toast.show('削除しました', 'info');
      });
    });
  }

  downloadTxt(mail) {
    const content = `件名: ${mail.subject}\n日付: ${mail.date}\n${'='.repeat(40)}\n\n${mail.body}`;
    const bom  = '\uFEFF';
    const blob = new Blob([bom + content], { type: 'text/plain;charset=utf-8' });
    dlBlob(blob, `${mail.folderName}_本文.txt`);
  }

  downloadAllTxt() {
    if (this.savedMails.length === 0) return;
    this.savedMails.forEach(m => this.downloadTxt(m));
    Toast.show(`${this.savedMails.length}件の .txt をダウンロードしました`, 'success');
  }

  updateSavedBadge() {
    const badge = document.getElementById('savedBadge');
    const cnt   = document.getElementById('savedCount');
    if (!badge || !cnt) return;
    cnt.textContent = this.savedMails.length;
    this.savedMails.length > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
  }

  // ================================================================
  //  STEP 2 — 添付ファイル登録
  // ================================================================
  bindStep2() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('attachFileInput');

    // ドラッグ&ドロップ
    dropZone?.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone?.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover'); });
    dropZone?.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer?.files?.length) this.addAttachFiles(e.dataTransfer.files);
    });
    dropZone?.addEventListener('click', e => { if (!e.target.closest('label')) fileInput?.click(); });

    // ファイル選択
    fileInput?.addEventListener('change', e => {
      if (e.target.files?.length) { this.addAttachFiles(e.target.files); e.target.value = ''; }
    });

    // クリア
    document.getElementById('clearAttachBtn')?.addEventListener('click', () => {
      this.attachItems = [];
      this.renderAttachQueue();
      this.updateAttachBadge();
      Toast.show('添付ファイルをクリアしました', 'info');
    });

    // STEP 1 に戻る
    document.getElementById('backToStep1Btn')?.addEventListener('click', () => this.activateStep(1));

    // STEP 3 へ進む
    document.getElementById('proceedToStep3Btn')?.addEventListener('click', () => {
      this.activateStep(3);
      this.renderPreview();
    });
  }

  addAttachFiles(files) {
    Array.from(files).forEach(file => {
      const exists = this.attachItems.some(a => a.file.name === file.name && a.file.size === file.size);
      if (exists) return;
      // デフォルト紐付け：保存済みメールが1件なら自動設定
      const defaultFolder = this.savedMails.length === 1 ? this.savedMails[0].folderName : '';
      this.attachItems.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        file,
        folderName: defaultFolder,
      });
    });
    this.renderAttachQueue();
    this.updateAttachBadge();
    Toast.show(`${files.length}件のファイルを追加しました`, 'success');
  }

  renderAttachQueue() {
    const container = document.getElementById('attachQueue');
    const empty     = document.getElementById('attachEmpty');
    if (!container) return;

    if (this.attachItems.length === 0) {
      container.innerHTML = '';
      if (empty) { empty.classList.remove('hidden'); container.appendChild(empty); }
      return;
    }
    if (empty) empty.classList.add('hidden');

    // 紐付けオプション
    const options = this.savedMails.map(m =>
      `<option value="${esc(m.folderName)}">${esc(m.folderName)}</option>`
    ).join('');

    container.innerHTML = this.attachItems.map(att => {
      const ext  = att.file.name.split('.').pop().toUpperCase();
      const size = (att.file.size / 1024).toFixed(0);
      const extColors = {
        ZIP:'bg-yellow-100 text-yellow-700',
        '7Z':'bg-orange-100 text-orange-700',
        RAR:'bg-orange-100 text-orange-700',
        TAR:'bg-amber-100 text-amber-700',
        GZ:'bg-amber-100 text-amber-700',
        TGZ:'bg-amber-100 text-amber-700',
        BZ2:'bg-amber-100 text-amber-700',
        XZ:'bg-amber-100 text-amber-700',
        LZH:'bg-yellow-100 text-yellow-700',
        CAB:'bg-yellow-100 text-yellow-700',
        PDF:'bg-red-100 text-red-700',
        DOCX:'bg-blue-100 text-blue-700', DOC:'bg-blue-100 text-blue-700',
        XLSX:'bg-green-100 text-green-700', XLS:'bg-green-100 text-green-700',
        PNG:'bg-purple-100 text-purple-700', JPG:'bg-purple-100 text-purple-700',
        JPEG:'bg-purple-100 text-purple-700', GIF:'bg-purple-100 text-purple-700',
      };
      const extColor = extColors[ext] || 'bg-slate-100 text-slate-600';

      return `
        <div class="border border-slate-200 rounded-xl p-3 bg-white" data-att-id="${att.id}">
          <div class="flex items-start gap-2 mb-2">
            <span class="text-xs font-bold px-1.5 py-0.5 rounded ${extColor} shrink-0">${esc(ext)}</span>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold text-slate-700 truncate">${esc(att.file.name)}</p>
              <p class="text-xs text-slate-400">${size} KB</p>
            </div>
            <button class="text-slate-300 hover:text-rose-500 transition-colors shrink-0 del-att-btn" data-id="${att.id}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div>
            <label class="text-xs text-slate-400 block mb-1">紐付け先メール</label>
            <select class="link-select w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-200 bg-white" data-id="${att.id}">
              <option value="">— メールを選択してください —</option>
              ${options}
            </select>
          </div>
        </div>`;
    }).join('');

    // セレクトの初期値を設定
    this.attachItems.forEach(att => {
      const sel = container.querySelector(`.link-select[data-id="${att.id}"]`);
      if (sel && att.folderName) sel.value = att.folderName;
    });

    // セレクト変更イベント
    container.querySelectorAll('.link-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const item = this.attachItems.find(a => a.id === e.target.dataset.id);
        if (item) item.folderName = e.target.value;
      });
    });

    // 削除ボタン
    container.querySelectorAll('.del-att-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.attachItems = this.attachItems.filter(a => a.id !== btn.dataset.id);
        this.renderAttachQueue();
        this.updateAttachBadge();
      });
    });
  }

  renderAttachLinkSelects() {
    // STEP 2 に戻ったときにもプルダウンを更新
    this.renderAttachQueue();
  }

  updateAttachBadge() {
    const badge = document.getElementById('attachBadge');
    const cnt   = document.getElementById('attachCount');
    if (!badge || !cnt) return;
    cnt.textContent = this.attachItems.length;
    this.attachItems.length > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
  }

  // ================================================================
  //  STEP 3 — プレビュー & バッチ生成
  // ================================================================
  bindStep3() {
    // STEP 2 に戻る
    document.getElementById('backToStep2Btn')?.addEventListener('click', () => this.activateStep(2));

    // バッチ生成
    document.getElementById('generateBatBtn')?.addEventListener('click', () => {
      BatchGenerator.generateBat(this.savedMails, this.attachItems);
    });

    // PowerShell 生成
    document.getElementById('generatePsBtn')?.addEventListener('click', () => {
      BatchGenerator.generatePs(this.savedMails, this.attachItems);
    });
  }

  renderPreview() {
    // 処理内容プレビュー
    const previewArea = document.getElementById('previewArea');
    if (previewArea) {
      if (this.savedMails.length === 0) {
        previewArea.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">登録されたメールがありません</p>';
      } else {
        previewArea.innerHTML = this.savedMails.map(m => {
          const linked = this.attachItems.filter(a => a.folderName === m.folderName);
          return `
            <div class="flex items-start gap-3 py-2 border-b border-slate-100 last:border-0">
              <svg class="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-semibold text-slate-700">${esc(m.folderName)}</p>
                <p class="text-xs text-slate-400">
                  本文.txt
                  ${linked.length > 0 ? `＋添付 ${linked.map(a => `<span class="bg-violet-100 text-violet-600 px-1 rounded">${esc(a.file.name)}</span>`).join(' ')}` : ''}
                </p>
              </div>
            </div>`;
        }).join('');
      }
    }

    // フォルダ構造プレビュー
    const folderPreview = document.getElementById('folderStructurePreview');
    if (folderPreview) {
      if (this.savedMails.length === 0) {
        folderPreview.innerHTML = '<p class="text-slate-500">　（STEP 1・2 で登録した内容が表示されます）</p>';
      } else {
        folderPreview.innerHTML = this.savedMails.map(m => {
          const linked = this.attachItems.filter(a => a.folderName === m.folderName);
          const files  = ['メール本文.txt', ...linked.map(a => a.file.name)];
          return `
            <p class="text-violet-400">　├─ ${esc(m.folderName)}/</p>
            ${files.map(f => `<p class="text-slate-400">　│　├─ ${esc(f)}</p>`).join('')}
          `;
        }).join('');
      }
    }
  }

  // ================================================================
  //  設定モーダル
  // ================================================================
  bindSettings() {
    const modal = document.getElementById('settingsModal');
    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      modal?.classList.remove('hidden'); modal?.classList.add('flex');
    });
    const close = () => { modal?.classList.add('hidden'); modal?.classList.remove('flex'); };
    document.getElementById('closeSettingsBtn')?.addEventListener('click', close);
    modal?.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal?.classList.contains('hidden')) close(); });
    document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
      Settings.save();
      // 保存済みメールのフォルダ名を再生成
      this.savedMails.forEach(m => {
        const newFolder = Settings.buildFolderName(m.date, m.subject);
        // 添付の紐付けも更新
        this.attachItems.forEach(a => { if (a.folderName === m.folderName) a.folderName = newFolder; });
        m.folderName = newFolder;
      });
      this.renderSavedList();
      this.renderAttachQueue();
      close();
      Toast.show('設定を保存しました', 'success');
    });
  }
}

// ── ユーティリティ ──────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function dlBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

// ── 起動 ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
