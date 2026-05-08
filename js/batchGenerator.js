/**
 * batchGenerator.js — Windowsバッチ(.bat) / PowerShell(.ps1) スクリプト生成
 */

const BatchGenerator = (() => {

  /**
   * Windowsバッチファイル(.bat)を生成してダウンロード
   */
  function generateBat(queue, mailEntries) {
    if (!queue || queue.length === 0) {
      Toast.show('処理キューにファイルがありません', 'warning');
      return;
    }

    const dest = Settings.get('batDestFolder') || '%USERPROFILE%\\Desktop\\メール';
    const today = formatDate(new Date());
    const lines = [];

    // ===== ヘッダー =====
    lines.push('@echo off');
    lines.push('chcp 65001 > nul');
    lines.push('setlocal EnableDelayedExpansion');
    lines.push('');
    lines.push(`:: ============================================================`);
    lines.push(`:: JoruriMail 整理バッチファイル`);
    lines.push(`:: 生成日時: ${today}`);
    lines.push(`:: 保存先: ${dest}`);
    lines.push(`:: ============================================================`);
    lines.push('');
    lines.push(':: 保存先フォルダの作成');
    lines.push(`set "DEST=${dest}"`);
    lines.push('if not exist "%DEST%" mkdir "%DEST%"');
    lines.push('');
    lines.push('echo.');
    lines.push('echo  JoruriMail 整理スクリプトを開始します...');
    lines.push('echo  保存先: %DEST%');
    lines.push('echo.');
    lines.push('');

    // ===== Zipファイルの展開処理 =====
    lines.push(':: ---- Zipファイルの展開 ----');
    lines.push('');

    queue.forEach((item, idx) => {
      const folderName = item.folderName || item.file.name.replace(/\.zip$/i, '');
      const safeFolder = sanitizeWindowsPath(folderName);
      const origName = item.file.name;

      lines.push(`:: [${idx + 1}] ${origName}`);
      lines.push(`set "FOLDER_NAME=${safeFolder}"`);
      lines.push(`set "TARGET_DIR=%DEST%\\!FOLDER_NAME!"`);
      lines.push('');
      lines.push(':: ダウンロードフォルダからZipを検索');
      lines.push(`set "ZIP_CANDIDATES="`);
      lines.push(`for %%f in ("%USERPROFILE%\\Downloads\\${sanitizeWindowsPath(origName)}" "%USERPROFILE%\\Desktop\\${sanitizeWindowsPath(origName)}") do (`);
      lines.push('  if exist "%%f" set "ZIP_FILE=%%f"');
      lines.push(')');
      lines.push('');
      lines.push(`if not defined ZIP_FILE (`);
      lines.push(`  echo  [警告] Zipファイルが見つかりません: ${origName}`);
      lines.push(`  goto :next_${idx}`);
      lines.push(')');
      lines.push('');
      lines.push(`if not exist "!TARGET_DIR!" mkdir "!TARGET_DIR!"`);
      lines.push('');
      lines.push(':: PowerShellを使用してZip展開');
      lines.push(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '!ZIP_FILE!' -DestinationPath '!TARGET_DIR!' -Force"`);
      lines.push('');
      lines.push('if %errorlevel% == 0 (');
      lines.push(`  echo  [OK] 展開完了: !FOLDER_NAME!`);
      lines.push(`  del /f /q "!ZIP_FILE!"`);
      lines.push(`  echo  [OK] Zipを削除: ${origName}`);
      lines.push(') else (');
      lines.push(`  echo  [エラー] 展開に失敗しました: ${origName}`);
      lines.push(')');
      lines.push('');
      lines.push(`:next_${idx}`);
      lines.push('set "ZIP_FILE="');
      lines.push('');
    });

    // ===== フォルダ一覧の作成（対象メールのみ）=====
    if (mailEntries && mailEntries.length > 0) {
      lines.push('');
      lines.push(':: ---- 対象メールのフォルダ一覧を作成 ----');
      lines.push('');
      lines.push(`set "LIST_FILE=%DEST%\\mail_folder_list_${today}.txt"`);
      lines.push(`echo JoruriMail フォルダ一覧 (${today}) > "%LIST_FILE%"`);
      lines.push(`echo ============================== >> "%LIST_FILE%"`);
      mailEntries
        .filter(e => e.isKept !== false)
        .forEach(e => {
          const safe = sanitizeWindowsPath(e.folderName);
          lines.push(`echo ${safe} >> "%LIST_FILE%"`);
        });
      lines.push('');
      lines.push(`echo  [OK] フォルダ一覧を作成: %LIST_FILE%`);
    }

    // ===== フッター =====
    lines.push('');
    lines.push('echo.');
    lines.push('echo  ============================================================');
    lines.push('echo  処理が完了しました。');
    lines.push(`echo  保存先フォルダを開きますか?`);
    lines.push('echo  ============================================================');
    lines.push('echo.');
    lines.push('set /p OPEN="保存先を開く場合はYを入力してEnterを押してください (Y/N): "');
    lines.push('if /i "%OPEN%"=="Y" explorer "%DEST%"');
    lines.push('');
    lines.push('endlocal');
    lines.push('pause');

    const content = lines.join('\r\n');  // Windows改行
    const blob = new Blob([content], { type: 'text/plain;charset=shift-jis' });
    downloadBlob(blob, `joruri_mail_organize_${today}.bat`);
    Toast.show('バッチファイルを生成しました (.bat)', 'success');
    Log.append('📄 バッチファイル (.bat) を生成しました', 'success');
  }

  /**
   * PowerShellスクリプト(.ps1)を生成してダウンロード
   */
  function generatePowerShell(queue, mailEntries) {
    if (!queue || queue.length === 0) {
      Toast.show('処理キューにファイルがありません', 'warning');
      return;
    }

    const dest = Settings.get('batDestFolder') || '%USERPROFILE%\\Desktop\\メール';
    const destPs = dest
      .replace('%USERPROFILE%', '$env:USERPROFILE')
      .replace('%TEMP%', '$env:TEMP');
    const today = formatDate(new Date());
    const lines = [];

    // ===== ヘッダー =====
    lines.push('# ============================================================');
    lines.push('# JoruriMail 整理 PowerShellスクリプト');
    lines.push(`# 生成日時: ${today}`);
    lines.push('# ============================================================');
    lines.push('# 使用方法:');
    lines.push('#   1. このファイルを右クリック → "PowerShellで実行"');
    lines.push('#   2. または: powershell -ExecutionPolicy Bypass -File "このファイル.ps1"');
    lines.push('# ============================================================');
    lines.push('');
    lines.push('[Console]::OutputEncoding = [Text.Encoding]::UTF8');
    lines.push('$ErrorActionPreference = "Continue"');
    lines.push('');
    lines.push('# ===== 設定 =====');
    lines.push(`$DestBase = "${destPs}"`);
    lines.push('$SearchPaths = @(');
    lines.push('  "$env:USERPROFILE\\Downloads",');
    lines.push('  "$env:USERPROFILE\\Desktop",');
    lines.push('  "$env:USERPROFILE\\Documents"');
    lines.push(')');
    lines.push('');
    lines.push('# ===== 保存先フォルダを作成 =====');
    lines.push('if (-not (Test-Path $DestBase)) {');
    lines.push('  New-Item -ItemType Directory -Path $DestBase -Force | Out-Null');
    lines.push('  Write-Host "[作成] 保存先フォルダ: $DestBase" -ForegroundColor Cyan');
    lines.push('}');
    lines.push('');
    lines.push('$Results = @()');
    lines.push('');
    lines.push('# ===== Zipファイルの展開処理 =====');

    queue.forEach((item, idx) => {
      const folderName = item.folderName || item.file.name.replace(/\.zip$/i, '');
      const safeFolder = folderName.replace(/'/g, "''");
      const origName = item.file.name.replace(/'/g, "''");

      lines.push('');
      lines.push(`# [${idx + 1}/${queue.length}] ${origName}`);
      lines.push(`$ZipName = '${origName}'`);
      lines.push(`$FolderName = '${safeFolder}'`);
      lines.push('$ZipFile = $null');
      lines.push('foreach ($dir in $SearchPaths) {');
      lines.push('  $candidate = Join-Path $dir $ZipName');
      lines.push('  if (Test-Path $candidate) { $ZipFile = $candidate; break }');
      lines.push('}');
      lines.push('');
      lines.push('if ($null -eq $ZipFile) {');
      lines.push('  Write-Host "[警告] Zipが見つかりません: $ZipName" -ForegroundColor Yellow');
      lines.push(`  $Results += [PSCustomObject]@{ File = '$origName'; Status = '見つからない'; Folder = $FolderName }`);
      lines.push('} else {');
      lines.push('  $TargetDir = Join-Path $DestBase $FolderName');
      lines.push('  try {');
      lines.push('    Expand-Archive -LiteralPath $ZipFile -DestinationPath $TargetDir -Force');
      lines.push('    Write-Host "[OK] 展開: $FolderName" -ForegroundColor Green');
      lines.push('    Remove-Item -LiteralPath $ZipFile -Force');
      lines.push('    Write-Host "[OK] Zip削除: $ZipName" -ForegroundColor Green');
      lines.push(`    $Results += [PSCustomObject]@{ File = '$origName'; Status = '完了'; Folder = $FolderName }`);
      lines.push('  } catch {');
      lines.push('    Write-Host "[エラー] 展開失敗: $ZipName — $_" -ForegroundColor Red');
      lines.push(`    $Results += [PSCustomObject]@{ File = '$origName'; Status = 'エラー'; Folder = $FolderName }`);
      lines.push('  }');
      lines.push('}');
    });

    // ===== フォルダ一覧 =====
    if (mailEntries && mailEntries.length > 0) {
      lines.push('');
      lines.push('# ===== メールフォルダ一覧の出力 =====');
      lines.push(`$ListFile = Join-Path $DestBase 'mail_folder_list_${today}.txt'`);
      lines.push(`$ListContent = @(`);
      lines.push(`  "JoruriMail フォルダ一覧 (${today})"`)
      lines.push(`  "=============================="`)
      mailEntries.filter(e => e.isKept !== false).forEach(e => {
        const safe = e.folderName.replace(/'/g, "''");
        lines.push(`  '${safe}'`);
      });
      lines.push(')');
      lines.push('$ListContent | Out-File -FilePath $ListFile -Encoding UTF8');
      lines.push('Write-Host "[OK] フォルダ一覧を保存: $ListFile" -ForegroundColor Cyan');
    }

    // ===== 結果サマリー =====
    lines.push('');
    lines.push('# ===== 結果サマリー =====');
    lines.push('Write-Host ""');
    lines.push('Write-Host "============================================================" -ForegroundColor Cyan');
    lines.push('Write-Host "  処理完了" -ForegroundColor Cyan');
    lines.push('Write-Host "============================================================" -ForegroundColor Cyan');
    lines.push('$Results | Format-Table -AutoSize');
    lines.push('');
    lines.push('$ans = Read-Host "保存先フォルダを開きますか? (Y/N)"');
    lines.push('if ($ans -imatch "^Y") { Start-Process explorer.exe $DestBase }');
    lines.push('');
    lines.push('Read-Host "Enterを押して終了してください"');

    const content = lines.join('\r\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + content], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `joruri_mail_organize_${today}.ps1`);
    Toast.show('PowerShellスクリプトを生成しました (.ps1)', 'success');
    Log.append('📄 PowerShellスクリプト (.ps1) を生成しました', 'success');
  }

  // ===== ユーティリティ =====

  function sanitizeWindowsPath(s) {
    // Windowsのパス非許可文字を除去（バッチファイル用）
    return String(s)
      .replace(/[\/\*\?\"<>\|]/g, '_')
      .replace(/:/g, '_')
      .trim();
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
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  return { generateBat, generatePowerShell };
})();
