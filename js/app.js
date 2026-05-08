/**
 * app.js — アプリのメインコントローラー
 * ステップ管理・イベント配線・UI制御
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
      success: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>`,
      error:   `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>`,
      warning: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>`,
      info:    `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    };

    const toast = document.createElement('div');
    toast.className = `toast flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg max-w-xs text-sm font-medium ${colors[type] || colors.info}`;
    toast.innerHTML = `
      <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icons[type] || icons.info}</svg>
      <span>${msg}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  return { show };
})();


// ===== サンプルデータ =====
const SAMPLE_TEXT = `受信日時\t件名\t送信者
2024/03/01 09:15\t【重要】3月請求書のご送付について\tbilling@example.co.jp
2024/03/01 09:15\t【重要】3月請求書のご送付について\tinfo@example.co.jp
2024/03/05 14:30\t契約更新のお知らせ（2024年度）\tcontract@partner.com
2024/03/07 11:00\t商品カタログ送付のご依頼\tsales@supplier.jp
2024/03/07 11:00\t商品カタログ送付のご依頼\torder@supplier.jp
2024/03/10 16:45\t月次報告書_2024年2月分\treport@internal.example.com
2024/03/15 10:20\t【ご確認】見積書No.2024-0315\testimate@example.co.jp
2024/03/15 10:20\t【ご確認】見積書No.2024-0315\taccounting@example.co.jp
2024/03/20 13:00\t打合せ議事録（3/18 第3回定例会）\tmeeting@partner.com
2024/03/25 09:00\t年度末棚卸し結果報告\tinventory@internal.example.com`;


// ===== アプリメインクラス =====
class App {
  constructor() {
    this.currentStep = 1;
    this.parsedEntries = [];
    this.init();
  }

  init() {
    // 設定の読み込み
    Settings.load();

    // イベントのバインド
    this.bindStep1Events();
    this.bindStep2Events();
    this.bindStep3Events();
    this.bindSettingsEvents();

    // 初期ステップ表示
    this.activateStep(1);
  }

  // ===== ステップ管理 =====

  activateStep(stepNum) {
    this.currentStep = stepNum;

    // ステップセクションの有効/無効
    document.querySelectorAll('.step-section').forEach((section, idx) => {
      const sNum = idx + 1;
      if (sNum <= stepNum) {
        section.classList.remove('opacity-40', 'pointer-events-none');
        section.classList.add('active');
      } else {
        section.classList.add('opacity-40', 'pointer-events-none');
        section.classList.remove('active');
      }
    });

    // ステップインジケーター更新
    this.updateStepIndicators(stepNum);

    // スクロール
    if (stepNum > 1) {
      const section = document.getElementById(`step${stepNum}`);
      if (section) {
        setTimeout(() => section.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      }
    }
  }

  updateStepIndicators(currentStep) {
    document.querySelectorAll('.step-indicator').forEach(el => {
      const step = parseInt(el.dataset.step);
      const circle = el.querySelector('.step-circle');
      const label = el.querySelector('span');

      circle.classList.remove('done', 'active', 'inactive', 'bg-blue-600', 'text-white',
        'bg-emerald-500', 'bg-slate-200', 'text-slate-400', 'shadow-md', 'shadow-blue-200', 'shadow-emerald-200');

      if (step < currentStep) {
        // 完了済み
        circle.classList.add('done', 'bg-emerald-500', 'text-white', 'shadow-md', 'shadow-emerald-200');
        circle.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
        </svg>`;
        if (label) { label.classList.remove('text-slate-400', 'text-blue-700', 'text-violet-700'); label.classList.add('text-emerald-600'); }
      } else if (step === currentStep) {
        // 現在のステップ
        const activeColors = ['text-blue-600', 'text-emerald-600', 'text-violet-600'];
        const bgColors = ['bg-blue-600', 'bg-emerald-600', 'bg-violet-600'];
        const shadowColors = ['shadow-blue-200', 'shadow-emerald-200', 'shadow-violet-200'];
        const idx = step - 1;
        circle.classList.add('active', bgColors[idx] || 'bg-blue-600', 'text-white', 'shadow-md', shadowColors[idx] || 'shadow-blue-200');
        circle.textContent = step;
        if (label) { label.classList.remove('text-slate-400', 'text-emerald-600'); label.classList.add(activeColors[idx] || 'text-blue-700', 'font-bold'); }
      } else {
        // 未着手
        circle.classList.add('inactive', 'bg-slate-200', 'text-slate-400');
        circle.textContent = step;
        if (label) { label.classList.remove('text-blue-700', 'text-emerald-600', 'text-violet-700', 'font-bold'); label.classList.add('text-slate-400'); }
      }
    });

    // ステップ間ライン
    ['line-1-2', 'line-2-3'].forEach((id, idx) => {
      const line = document.getElementById(id);
      if (line) {
        if (currentStep > idx + 1) {
          line.classList.add('done', 'bg-emerald-400');
          line.style.backgroundColor = '';
        } else {
          line.classList.remove('done', 'bg-emerald-400');
        }
      }
    });
  }

  // ===== STEP 1: メール解析 =====

  bindStep1Events() {
    const textarea = document.getElementById('mailInput');
    const parseBtn = document.getElementById('parseBtn');
    const clearBtn = document.getElementById('clearTextBtn');
    const sampleBtn = document.getElementById('loadSampleBtn');

    if (!textarea) return;

    // テキスト変化時にボタンを有効化
    textarea.addEventListener('input', () => {
      const hasText = textarea.value.trim().length > 0;
      parseBtn.disabled = !hasText;
      const status = document.getElementById('inputStatus');
      if (status) {
        const lines = textarea.value.split('\n').filter(l => l.trim()).length;
        status.textContent = lines > 0 ? `${lines}行` : '';
      }
    });

    // クリア
    clearBtn?.addEventListener('click', () => {
      textarea.value = '';
      parseBtn.disabled = true;
      document.getElementById('inputStatus').textContent = '';
    });

    // サンプル読み込み
    sampleBtn?.addEventListener('click', () => {
      textarea.value = SAMPLE_TEXT;
      parseBtn.disabled = false;
      document.getElementById('inputStatus').textContent = `${SAMPLE_TEXT.split('\n').filter(l=>l.trim()).length}行`;
      Toast.show('サンプルデータを読み込みました', 'info');
    });

    // 解析実行
    parseBtn?.addEventListener('click', () => {
      this.runParse(textarea.value);
    });
  }

  runParse(text) {
    const parseBtn = document.getElementById('parseBtn');
    parseBtn.disabled = true;
    parseBtn.innerHTML = `
      <svg class="w-4 h-4 spinner" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
      </svg>
      解析中...`;

    // 非同期で処理（UIブロックを防ぐ）
    setTimeout(() => {
      try {
        const entries = Parser.parse(text);

        if (entries.length === 0) {
          Toast.show('メール情報を解析できませんでした。フォーマットを確認してください。', 'error', 5000);
          parseBtn.disabled = false;
          parseBtn.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
            解析する`;
          return;
        }

        this.parsedEntries = entries;
        MailList.setEntries(entries);
        FileProcessor.setMailEntries(entries);

        const keptCount = entries.filter(e => e.isKept !== false).length;
        const dupCount  = entries.filter(e => e.isDuplicate).length;

        Toast.show(
          `${entries.length}件を解析 — 保持:${keptCount}件 / 重複:${dupCount}件`,
          'success'
        );

        this.activateStep(2);

      } catch (err) {
        Toast.show(`解析エラー: ${err.message}`, 'error');
        console.error(err);
      } finally {
        parseBtn.disabled = false;
        parseBtn.innerHTML = `
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
          </svg>
          解析する`;
      }
    }, 50);
  }

  // ===== STEP 2: メール一覧 =====

  bindStep2Events() {
    // フィルタ
    document.getElementById('filterInput')?.addEventListener('input', (e) => {
      MailList.setFilter(e.target.value);
    });

    // ソート
    document.getElementById('sortSelect')?.addEventListener('change', (e) => {
      MailList.setSort(e.target.value);
    });

    // 重複のみ表示
    document.getElementById('showDuplicatesOnly')?.addEventListener('change', (e) => {
      MailList.setShowDuplicatesOnly(e.target.checked);
    });

    // 全選択 / 全解除
    document.getElementById('selectAllBtn')?.addEventListener('click', () => MailList.selectAll());
    document.getElementById('deselectAllBtn')?.addEventListener('click', () => MailList.deselectAll());

    // CSVエクスポート
    document.getElementById('exportCsvBtn')?.addEventListener('click', () => MailList.exportCsv());

    // STEP 3へ進む
    document.getElementById('proceedToStep3Btn')?.addEventListener('click', () => {
      const selected = MailList.getSelectedEntries();
      if (selected.length === 0) {
        Toast.show('少なくとも1件を選択してください', 'warning');
        return;
      }
      FileProcessor.setMailEntries(selected);
      this.activateStep(3);
      Toast.show(`${selected.length}件をSTEP 3に引き渡しました`, 'success');
    });
  }

  // ===== STEP 3: ファイル整理 =====

  bindStep3Events() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    // ===== ドラッグ&ドロップ =====
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', (e) => {
        if (!dropZone.contains(e.relatedTarget)) {
          dropZone.classList.remove('dragover');
        }
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          const added = FileProcessor.addFiles(files);
          if (added > 0) Toast.show(`${added}件のZipを追加しました`, 'success');
        }
      });
      dropZone.addEventListener('click', (e) => {
        // ラベル内クリックでない場合のみ発火
        if (!e.target.closest('label')) fileInput?.click();
      });
    }

    // ファイル選択
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files?.length > 0) {
        const added = FileProcessor.addFiles(e.target.files);
        if (added > 0) Toast.show(`${added}件のZipを追加しました`, 'success');
        e.target.value = '';
      }
    });

    // キュークリア
    document.getElementById('clearQueueBtn')?.addEventListener('click', () => {
      FileProcessor.clearQueue();
      Toast.show('キューをクリアしました', 'info');
    });

    // Zip展開
    document.getElementById('extractAllBtn')?.addEventListener('click', () => {
      FileProcessor.extractAll();
    });

    // バッチファイル生成
    document.getElementById('generateBatBtn')?.addEventListener('click', () => {
      const queue = FileProcessor.getQueue();
      const entries = MailList.getSelectedEntries().length > 0
        ? MailList.getSelectedEntries()
        : this.parsedEntries;
      BatchGenerator.generateBat(queue, entries);
    });

    // PowerShellスクリプト生成
    document.getElementById('generatePsBtn')?.addEventListener('click', () => {
      const queue = FileProcessor.getQueue();
      const entries = MailList.getSelectedEntries().length > 0
        ? MailList.getSelectedEntries()
        : this.parsedEntries;
      BatchGenerator.generatePowerShell(queue, entries);
    });

    // ログクリア
    document.getElementById('clearLogBtn')?.addEventListener('click', () => {
      Log.clear();
    });

    // リネームモード変更時にキューを再描画
    document.getElementById('renameMode')?.addEventListener('change', () => {
      FileProcessor.getQueue(); // 再描画トリガー
      // キューアイテムを再レンダリング
      const q = FileProcessor.getQueue();
      if (q.length > 0) {
        // addFiles で再描画させるため内部的に更新
        // renderQueueを直接呼べないためfileProcessor側で対応済み
      }
    });
  }

  // ===== 設定モーダル =====

  bindSettingsEvents() {
    const modal = document.getElementById('settingsModal');
    const openBtn = document.getElementById('settingsBtn');
    const closeBtn = document.getElementById('closeSettingsBtn');
    const saveBtn = document.getElementById('saveSettingsBtn');

    openBtn?.addEventListener('click', () => {
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    });

    const closeModal = () => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    };

    closeBtn?.addEventListener('click', closeModal);

    // オーバーレイクリックで閉じる
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // 設定保存
    saveBtn?.addEventListener('click', () => {
      Settings.save();
      closeModal();
      Toast.show('設定を保存しました', 'success');

      // 解析済みデータがある場合は再処理
      if (this.parsedEntries.length > 0) {
        const textarea = document.getElementById('mailInput');
        if (textarea?.value) {
          this.runParse(textarea.value);
        }
      }
    });

    // Escキーで閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }
}

// ===== アプリ起動 =====
document.addEventListener('DOMContentLoaded', () => {
  window.appInstance = new App();
});
