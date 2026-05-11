/**
 * batchGenerator.js
 * 保存済みメール本文(.txt) と 添付ファイルを
 * デスクトップの「メール」フォルダへ整理するバッチ/.ps1 を生成
 *
 * v3 — bat版バグ修正
 *   [修正1] :: コメントを rem に変更（FOR/IFブロック内でクラッシュする問題）
 *   [修正2] 本文保存を -EncodedCommand（UTF-16LE Base64）方式に変更
 *           （本文中の改行/特殊文字がechoコマンドとして誤認識される問題）
 *   [修正3] ZIP展開PS1の echo 書き出し方式を廃止 → -EncodedCommand 方式に変更
 *           （\" がPS1に混入してクォートが壊れる問題）
 */

const BatchGenerator = (() => {

  // ================================================================
  //  ブラウザ側ユーティリティ: 文字列 → UTF-16LE Base64
  //  PowerShell の -EncodedCommand 引数に渡す形式
  // ================================================================
  function toBase64Cmd(psScript) {
    // UTF-16LE でエンコード
    const buf = [];
    for (let i = 0; i < psScript.length; i++) {
      const c = psScript.charCodeAt(i);
      buf.push(c & 0xff, (c >> 8) & 0xff);
    }
    // Uint8Array → btoa
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin);
  }

  // ================================================================
  //  PowerShell ヘルパー関数ブロック（PS1スクリプト先頭に埋め込む）
  // ================================================================
  function getPsFunctions() {
    const F = [];

    F.push('# ============================================================');
    F.push('#  ヘルパー関数');
    F.push('# ============================================================');
    F.push('');

    // ---- Get-UniqueFileName ----------------------------------------
    F.push('function Get-UniqueFileName {');
    F.push('  param([string]$Dir, [string]$FileName)');
    F.push('  $base      = [System.IO.Path]::GetFileNameWithoutExtension($FileName)');
    F.push('  $ext       = [System.IO.Path]::GetExtension($FileName)');
    F.push('  $candidate = Join-Path $Dir $FileName');
    F.push('  $n = 1');
    F.push('  while (Test-Path $candidate) {');
    F.push('    $candidate = Join-Path $Dir "$base($n)$ext"');
    F.push('    $n++');
    F.push('  }');
    F.push('  return $candidate');
    F.push('}');
    F.push('');

    // ---- Remove-EmptyDirs ------------------------------------------
    F.push('function Remove-EmptyDirs {');
    F.push('  param([string]$Root)');
    F.push('  if (-not (Test-Path $Root)) { return }');
    F.push('  Get-ChildItem -LiteralPath $Root -Recurse -Directory |');
    F.push('    Sort-Object FullName -Descending |');
    F.push('    ForEach-Object {');
    F.push('      if (-not (Get-ChildItem -LiteralPath $_.FullName -Force)) {');
    F.push('        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue');
    F.push('      }');
    F.push('    }');
    F.push('}');
    F.push('');

    // ---- Invoke-SmartFlatten ---------------------------------------
    F.push('function Invoke-SmartFlatten {');
    F.push('  param([string]$Dir)');
    F.push('  while ($true) {');
    F.push('    $items = @(Get-ChildItem -LiteralPath $Dir -Force)');
    F.push('    if ($items.Count -eq 1 -and $items[0].PSIsContainer) {');
    F.push('      $child = $items[0].FullName');
    F.push('      Get-ChildItem -LiteralPath $child -Force | ForEach-Object {');
    F.push('        $dst = Get-UniqueFileName -Dir $Dir -FileName $_.Name');
    F.push('        Move-Item -LiteralPath $_.FullName -Destination $dst -Force -ErrorAction SilentlyContinue');
    F.push('      }');
    F.push('      Remove-Item -LiteralPath $child -Force -Recurse -ErrorAction SilentlyContinue');
    F.push('    } else {');
    F.push('      break');
    F.push('    }');
    F.push('  }');
    F.push('}');
    F.push('');

    // ---- Expand-OneArchive -----------------------------------------
    F.push('function Expand-OneArchive {');
    F.push('  param([string]$ArchivePath, [string]$DestDir, [string]$Password = "")');
    F.push('  $ext = [System.IO.Path]::GetExtension($ArchivePath).ToLower()');
    F.push('  if ($ext -eq ".zip") {');
    F.push('    try {');
    F.push('      if ($Password -ne "") { throw "password-protected" }');
    F.push('      Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestDir -Force -ErrorAction Stop');
    F.push('      return $true');
    F.push('    } catch { }');
    F.push('  }');
    F.push('  $7zPaths = @(');
    F.push('    ($env:ProgramFiles + "\\7-Zip\\7z.exe"),');
    F.push('    ($env:ProgramFiles + " (x86)\\7-Zip\\7z.exe"),');
    F.push('    ($env:LOCALAPPDATA + "\\Programs\\7-Zip\\7z.exe")');
    F.push('  )');
    F.push('  $7z = $null');
    F.push('  foreach ($p in $7zPaths) { if (Test-Path $p) { $7z = $p; break } }');
    F.push('  if ($null -eq $7z) {');
    F.push('    Write-Host "  [警告] 7-Zip が見つかりません。https://www.7-zip.org/ からインストールしてください。" -ForegroundColor Yellow');
    F.push('    return $false');
    F.push('  }');
    F.push('  $args7z = @("x", $ArchivePath, ("-o" + $DestDir), "-y")');
    F.push('  if ($Password -ne "") { $args7z += ("-p" + $Password) }');
    F.push('  $proc = Start-Process -FilePath $7z -ArgumentList $args7z -Wait -PassThru -NoNewWindow `');
    F.push('    -RedirectStandardOutput ($env:TEMP + "\\7z_stdout.txt") `');
    F.push('    -RedirectStandardError  ($env:TEMP + "\\7z_stderr.txt")');
    F.push('  return ($proc.ExitCode -eq 0)');
    F.push('}');
    F.push('');

    // ---- Expand-RecursiveArchive -----------------------------------
    F.push('function Expand-RecursiveArchive {');
    F.push('  param([string]$Dir)');
    F.push('  $archiveExts = @(".zip",".7z",".rar",".tar",".gz",".tgz",".bz2",".xz",".lzh",".cab")');
    F.push('  for ($pass = 0; $pass -lt 20; $pass++) {');
    F.push('    $archives = @(Get-ChildItem -LiteralPath $Dir -Recurse -File |');
    F.push('      Where-Object { $archiveExts -contains $_.Extension.ToLower() })');
    F.push('    if ($archives.Count -eq 0) { break }');
    F.push('    foreach ($arc in $archives) {');
    F.push('      $arcPath = $arc.FullName');
    F.push('      $arcDir  = $arc.DirectoryName');
    F.push('      $arcBase = [System.IO.Path]::GetFileNameWithoutExtension($arc.Name)');
    F.push('      $tmpDir  = Get-UniqueFileName -Dir $arcDir -FileName $arcBase');
    F.push('      Write-Host "  [展開中] $($arc.Name)" -ForegroundColor Cyan');
    F.push('      $ok = Expand-OneArchive -ArchivePath $arcPath -DestDir $tmpDir -Password ""');
    F.push('      if (-not $ok) {');
    F.push('        $retry = 0');
    F.push('        while (-not $ok -and $retry -lt 3) {');
    F.push('          Write-Host "  *** パスワードが必要です: $($arc.Name) ***" -ForegroundColor Magenta');
    F.push('          $pw = Read-Host "      パスワードを入力してください（スキップはそのままEnter）"');
    F.push('          if ($pw -eq "") { break }');
    F.push('          if (Test-Path $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }');
    F.push('          $ok = Expand-OneArchive -ArchivePath $arcPath -DestDir $tmpDir -Password $pw');
    F.push('          $retry++');
    F.push('        }');
    F.push('      }');
    F.push('      if ($ok) {');
    F.push('        Remove-Item -LiteralPath $arcPath -Force -ErrorAction SilentlyContinue');
    F.push('        Invoke-SmartFlatten -Dir $tmpDir');
    F.push('        Get-ChildItem -LiteralPath $tmpDir -Force | ForEach-Object {');
    F.push('          $dst = Get-UniqueFileName -Dir $arcDir -FileName $_.Name');
    F.push('          Move-Item -LiteralPath $_.FullName -Destination $dst -Force -ErrorAction SilentlyContinue');
    F.push('        }');
    F.push('        Remove-Item -LiteralPath $tmpDir -Force -Recurse -ErrorAction SilentlyContinue');
    F.push('        Write-Host "    -> 完了: $($arc.Name)" -ForegroundColor Green');
    F.push('      } else {');
    F.push('        Write-Host "  [スキップ] 展開できませんでした: $($arc.Name)" -ForegroundColor Yellow');
    F.push('        if (Test-Path $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }');
    F.push('      }');
    F.push('    }');
    F.push('  }');
    F.push('  Remove-EmptyDirs -Root $Dir');
    F.push('}');
    F.push('');

    return F.join('\r\n');
  }

  // ================================================================
  //  バッチファイル (.bat) 生成  v3
  //
  //  【設計方針】
  //  .bat は「起動ランチャー」に徹し、全ての実質処理を
  //  -EncodedCommand（UTF-16LE Base64）で渡す単発 PowerShell 呼び出しに委ねる。
  //  これにより echo/:: によるエスケープ問題を根絶する。
  //
  //  処理フロー:
  //    1. フォルダ作成        → PowerShell -EncodedCommand
  //    2. 本文.txt 保存       → PowerShell -EncodedCommand  ← バグ2修正
  //    3. 添付ファイル検索    → bat の FOR ループ（ファイルパス取得のみ）
  //    4. ZIP展開/コピー      → PowerShell -EncodedCommand  ← バグ3修正
  //    5. :: コメント → rem  ← バグ1修正
  // ================================================================
  function generateBat(savedMails, attachItems) {
    if (!savedMails || savedMails.length === 0) {
      Toast.show('STEP 1 で本文を保存リストに追加してください', 'warning');
      return;
    }

    const dest  = Settings.get('batDestFolder') || '%USERPROFILE%\\Desktop\\メール';
    const today = fmtDate(new Date());
    const L = [];

    L.push('@echo off');
    L.push('chcp 65001 > nul');
    L.push('setlocal EnableDelayedExpansion');
    L.push('');
    // バグ1修正: :: をトップレベル以外でも安全な rem に変更
    L.push('rem ====================================================');
    L.push('rem JoruriMail 整理バッチファイル  v3');
    L.push('rem 生成日時 : ' + today);
    L.push('rem 保存先   : ' + dest);
    L.push('rem ====================================================');
    L.push('');
    L.push('set "DEST=' + dest + '"');
    L.push('if not exist "%DEST%" mkdir "%DEST%"');
    L.push('echo.');
    L.push('echo  === JoruriMail 整理開始 ===');
    L.push('echo  保存先: %DEST%');
    L.push('echo.');
    L.push('');

    savedMails.forEach((mail, idx) => {
      const safeFolder = winSafe(mail.folderName);
      const label      = 'M' + idx; // goto ラベル用（短く安全に）

      L.push('rem ---- [' + (idx + 1) + '/' + savedMails.length + '] ----');
      L.push('set "MAIL_DIR=%DEST%\\' + safeFolder + '"');
      L.push('if not exist "!MAIL_DIR!" mkdir "!MAIL_DIR!"');
      L.push('');

      // ── 本文.txt 保存（EncodedCommand方式）──────────────────
      // バグ2修正: 本文中の改行や特殊文字を完全にBase64でラップ
      const bodyText =
        '件名: ' + mail.subject + '\r\n' +
        '日付: ' + mail.date   + '\r\n' +
        '='.repeat(40)         + '\r\n\r\n' +
        mail.body;

      // PSスクリプト: パスを引数として受け取り本文を書き込む
      // bat変数(!MAIL_DIR!)はechoで展開するのではなく
      // 環境変数 MAIL_DIR を powershell 側から $env:MAIL_DIR で参照する
      const bodyB64 = toBase64Cmd(
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
        '[IO.File]::WriteAllText(' +
          '(Join-Path $env:MAIL_DIR "メール本文.txt"),' +
          '[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("' +
            btoa(unescape(encodeURIComponent(bodyText))) +
          '")),' +
          '[Text.Encoding]::UTF8' +
        ')'
      );
      L.push('rem 本文.txt を保存');
      L.push('powershell -NoProfile -NonInteractive -EncodedCommand ' + bodyB64);
      L.push('if %errorlevel%==0 (');
      L.push('  echo  [OK] 本文保存: ' + safeFolder + '\\メール本文.txt');
      L.push(') else (');
      L.push('  echo  [エラー] 本文保存失敗: ' + safeFolder);
      L.push(')');
      L.push('');

      // ── 添付ファイル処理 ─────────────────────────────────────
      const linked = attachItems.filter(a => a.folderName === mail.folderName);
      if (linked.length > 0) {
        linked.forEach((att, ai) => {
          const fname    = winSafe(att.file.name);
          const fnameLow = fname.toLowerCase();
          const archiveExts = ['.zip','.7z','.rar','.tar','.gz','.tgz','.bz2','.xz','.lzh','.cab'];
          const isArchive   = archiveExts.some(e => fnameLow.endsWith(e));
          const isZipOnly   = fnameLow.endsWith('.zip');
          const nextLabel   = 'NEXT_' + label + '_' + ai;

          // ファイル検索（bat の FOR は単純なファイルパス取得なので安全）
          L.push('set "ATT_FILE="');
          L.push('for %%D in ("%USERPROFILE%\\Downloads" "%USERPROFILE%\\Desktop" "%USERPROFILE%\\Documents") do (');
          L.push('  if exist "%%~D\\' + fname + '" set "ATT_FILE=%%~D\\' + fname + '"');
          L.push(')');
          L.push('if not defined ATT_FILE (');
          L.push('  echo  [警告] 見つかりません: ' + fname);
          L.push('  goto :' + nextLabel);
          L.push(')');
          L.push('');

          if (isZipOnly) {
            // バグ3修正: echo によるPS1書き出しを廃止 → EncodedCommand
            // bat変数 ATT_FILE / MAIL_DIR を環境変数として PS 側から参照
            const zipPsScript =
              'param()' +
              '$src=$env:ATT_FILE;$dst=$env:MAIL_DIR;' +
              '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
              '$base=[IO.Path]::GetFileNameWithoutExtension($src);' +
              '$tmp=Join-Path $dst $base;$n=1;' +
              'while(Test-Path $tmp){$tmp=Join-Path $dst ($base+"($n)");$n++};' +
              'try{' +
                'Expand-Archive -LiteralPath $src -DestinationPath $tmp -Force -EA Stop;' +
                'while($true){' +
                  '$items=@(Get-ChildItem -LiteralPath $tmp -Force);' +
                  'if($items.Count -eq 1 -and $items[0].PSIsContainer){' +
                    '$child=$items[0].FullName;' +
                    'Get-ChildItem -LiteralPath $child -Force|%{' +
                      '$dn=$_.Name;$dd=Join-Path $tmp $dn;$i=1;' +
                      'while(Test-Path $dd){$dd=Join-Path $tmp (([IO.Path]::GetFileNameWithoutExtension($dn))+"($i)"+[IO.Path]::GetExtension($dn));$i++};' +
                      'Move-Item -LiteralPath $_.FullName -Destination $dd -Force' +
                    '};' +
                    'Remove-Item -LiteralPath $child -Force -Recurse' +
                  '}else{break}' +
                '};' +
                'Get-ChildItem -LiteralPath $tmp -Force|%{' +
                  '$dn=$_.Name;$dd=Join-Path $dst $dn;$i=1;' +
                  'while(Test-Path $dd){$dd=Join-Path $dst (([IO.Path]::GetFileNameWithoutExtension($dn))+"($i)"+[IO.Path]::GetExtension($dn));$i++};' +
                  'Move-Item -LiteralPath $_.FullName -Destination $dd -Force' +
                '};' +
                'Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue;' +
                'Get-ChildItem -LiteralPath $dst -Recurse -Directory|Sort-Object FullName -Desc|%{' +
                  'if(-not(Get-ChildItem -LiteralPath $_.FullName -Force)){Remove-Item -LiteralPath $_.FullName -Force}' +
                '};' +
                'exit 0' +
              '}catch{Write-Host "Error:$_" -ForegroundColor Red;' +
              'if(Test-Path $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -EA SilentlyContinue};' +
              'exit 1}';

            const zipB64 = toBase64Cmd(zipPsScript);
            L.push('rem ZIP展開（再帰・スマートフラットニング・衝突回避）');
            L.push('powershell -NoProfile -NonInteractive -EncodedCommand ' + zipB64);
            L.push('if !errorlevel!==0 (');
            L.push('  echo  [OK] ZIP展開完了: ' + fname);
            L.push('  del /f /q "!ATT_FILE!" 2>nul');
            L.push(') else (');
            L.push('  echo  [注意] ZIP展開に失敗しました。PS1版での再実行を推奨: ' + fname);
            L.push(')');

          } else if (isArchive) {
            // .7z/.rar等: コピーのみ（展開はPS1版で）
            const copyB64 = toBase64Cmd(
              '$src=$env:ATT_FILE;$dst=$env:MAIL_DIR;' +
              '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
              '$dn=[IO.Path]::GetFileName($src);' +
              '$dd=Join-Path $dst $dn;$i=1;' +
              'while(Test-Path $dd){$dd=Join-Path $dst (([IO.Path]::GetFileNameWithoutExtension($dn))+"($i)"+[IO.Path]::GetExtension($dn));$i++};' +
              'Copy-Item -LiteralPath $src -Destination $dd -Force;' +
              'exit 0'
            );
            L.push('rem アーカイブ（.zip以外）はコピーのみ。展開はPS1版推奨');
            L.push('powershell -NoProfile -NonInteractive -EncodedCommand ' + copyB64);
            L.push('if !errorlevel!==0 (');
            L.push('  echo  [OK] コピー完了（展開はPS1版で実行してください）: ' + fname);
            L.push('  del /f /q "!ATT_FILE!" 2>nul');
            L.push(') else (');
            L.push('  echo  [エラー] コピー失敗: ' + fname);
            L.push(')');

          } else {
            // 通常ファイル: 衝突回避コピー
            const fileCopyB64 = toBase64Cmd(
              '$src=$env:ATT_FILE;$dst=$env:MAIL_DIR;' +
              '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
              '$dn=[IO.Path]::GetFileName($src);' +
              '$dd=Join-Path $dst $dn;$i=1;' +
              'while(Test-Path $dd){$dd=Join-Path $dst (([IO.Path]::GetFileNameWithoutExtension($dn))+"($i)"+[IO.Path]::GetExtension($dn));$i++};' +
              'Copy-Item -LiteralPath $src -Destination $dd -Force;' +
              'exit 0'
            );
            L.push('powershell -NoProfile -NonInteractive -EncodedCommand ' + fileCopyB64);
            L.push('if !errorlevel!==0 (');
            L.push('  echo  [OK] コピー: ' + fname);
            L.push('  del /f /q "!ATT_FILE!"');
            L.push(') else (');
            L.push('  echo  [エラー] コピー失敗: ' + fname);
            L.push(')');
          }

          L.push('');
          L.push(':' + nextLabel);
          L.push('set "ATT_FILE="');
          L.push('');
        });
      }
    });

    L.push('echo.');
    L.push('echo  ====================================================');
    L.push('echo  整理が完了しました！');
    L.push('echo  ====================================================');
    L.push('echo.');
    L.push('set /p OPEN="デスクトップの「メール」フォルダを開きますか？(Y/N): "');
    L.push('if /i "!OPEN!"=="Y" explorer "%DEST%"');
    L.push('endlocal');
    L.push('pause');

    const blob = new Blob([L.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    dlBlob(blob, 'joruri_mail_' + today + '.bat');
    Toast.show('バッチファイルを生成しました！（.7z/.rar等はPS1版を推奨）', 'success');
  }

  // ================================================================
  //  PowerShell スクリプト (.ps1) 生成  ← 全形式対応・メイン推奨
  // ================================================================
  function generatePs(savedMails, attachItems) {
    if (!savedMails || savedMails.length === 0) {
      Toast.show('STEP 1 で本文を保存リストに追加してください', 'warning');
      return;
    }

    const dest  = (Settings.get('batDestFolder') || '%USERPROFILE%\\Desktop\\メール')
                    .replace('%USERPROFILE%', '$env:USERPROFILE');
    const today = fmtDate(new Date());
    const L = [];

    L.push('# ====================================================');
    L.push('# JoruriMail 整理 PowerShell スクリプト  v3');
    L.push('# 生成日時 : ' + today);
    L.push('# 実行方法 : 右クリック→「PowerShellで実行」');
    L.push('#            または: powershell -ExecutionPolicy Bypass -File "このファイル.ps1"');
    L.push('# 対応形式 : .zip .7z .rar .tar .gz .tgz .bz2 .xz .lzh .cab');
    L.push('# 注意     : .zip以外は 7-Zip (https://www.7-zip.org/) が必要です');
    L.push('# ====================================================');
    L.push('[Console]::OutputEncoding = [Text.Encoding]::UTF8');
    L.push('$ErrorActionPreference = "Continue"');
    L.push('');
    L.push('$DestBase   = "' + dest + '"');
    L.push('$SearchDirs = @(');
    L.push('  ($env:USERPROFILE + "\\Downloads"),');
    L.push('  ($env:USERPROFILE + "\\Desktop"),');
    L.push('  ($env:USERPROFILE + "\\Documents")');
    L.push(')');
    L.push('');
    L.push('if (-not (Test-Path $DestBase)) { New-Item -ItemType Directory -Path $DestBase -Force | Out-Null }');
    L.push('Write-Host ""');
    L.push('Write-Host " === JoruriMail 整理開始（高度アーカイブ処理）===" -ForegroundColor Cyan');
    L.push('Write-Host " 保存先: $DestBase" -ForegroundColor Cyan');
    L.push('Write-Host ""');
    L.push('');

    L.push(getPsFunctions());

    savedMails.forEach((mail, idx) => {
      const safeFolder = mail.folderName.replace(/'/g, "''");
      // PS1側の本文はシングルクォート here-string @'...'@ を使い特殊文字を無効化
      // ただし @'...'@ はここでは改行が必要なため、別方法で安全に渡す
      // → Base64経由で書き込む（PS1でも同様に安全化）
      const bodyText =
        '件名: ' + mail.subject + '\n' +
        '日付: ' + mail.date   + '\n' +
        '='.repeat(40)         + '\n\n' +
        mail.body;
      // UTF-8 bytes → Base64
      const bodyB64Ps = btoa(unescape(encodeURIComponent(bodyText)));

      L.push('# ---- [' + (idx + 1) + '/' + savedMails.length + '] ' + safeFolder + ' ----');
      L.push("$MailDir = Join-Path $DestBase '" + safeFolder + "'");
      L.push('if (-not (Test-Path $MailDir)) { New-Item -ItemType Directory -Path $MailDir -Force | Out-Null }');
      L.push('');
      L.push('# 本文.txt を保存（Base64経由でUTF-8書き込み）');
      L.push('$bodyBytes = [System.Convert]::FromBase64String("' + bodyB64Ps + '")');
      L.push('$bodyText  = [System.Text.Encoding]::UTF8.GetString($bodyBytes)');
      L.push('[IO.File]::WriteAllText((Join-Path $MailDir "メール本文.txt"), $bodyText, [Text.Encoding]::UTF8)');
      L.push('Write-Host "  [OK] 本文保存: ' + safeFolder + '" -ForegroundColor Green');
      L.push('');

      const linked = attachItems.filter(a => a.folderName === mail.folderName);
      if (linked.length > 0) {
        linked.forEach(att => {
          const fname    = att.file.name.replace(/'/g, "''");
          const fnameLow = att.file.name.toLowerCase();
          const archiveExts = ['.zip','.7z','.rar','.tar','.gz','.tgz','.bz2','.xz','.lzh','.cab'];
          const isArchive   = archiveExts.some(e => fnameLow.endsWith(e));

          L.push("# 添付: " + fname);
          L.push('$AttFile = $null');
          L.push('foreach ($d in $SearchDirs) {');
          L.push("  $c = Join-Path $d '" + fname + "'");
          L.push('  if (Test-Path $c) { $AttFile = $c; break }');
          L.push('}');
          L.push('if ($null -eq $AttFile) {');
          L.push('  Write-Host "  [警告] 見つかりません: ' + fname + '" -ForegroundColor Yellow');
          L.push('} else {');
          L.push('  try {');

          if (isArchive) {
            L.push('    Write-Host "  [処理] アーカイブ展開開始: ' + fname + '" -ForegroundColor Cyan');
            L.push("    $arcDest = Get-UniqueFileName -Dir $MailDir -FileName '" + fname + "'");
            L.push('    Copy-Item -LiteralPath $AttFile -Destination $arcDest -Force');
            L.push('    Expand-RecursiveArchive -Dir $MailDir');
            L.push('    Write-Host "  [OK] アーカイブ展開完了: ' + fname + '" -ForegroundColor Green');
            L.push('    Remove-Item -LiteralPath $AttFile -Force -ErrorAction SilentlyContinue');
          } else {
            L.push("    $dst = Get-UniqueFileName -Dir $MailDir -FileName '" + fname + "'");
            L.push('    Copy-Item -LiteralPath $AttFile -Destination $dst -Force');
            L.push('    Write-Host "  [OK] コピー: ' + fname + '" -ForegroundColor Green');
            L.push('    Remove-Item -LiteralPath $AttFile -Force');
          }

          L.push('  } catch {');
          L.push('    Write-Host "  [エラー] $($_.Exception.Message)" -ForegroundColor Red');
          L.push('  }');
          L.push('}');
          L.push('');
        });
      }

      L.push('Remove-EmptyDirs -Root $MailDir');
      L.push('Write-Host ""');
      L.push('');
    });

    L.push('Write-Host ""');
    L.push('Write-Host " ====================================================" -ForegroundColor Cyan');
    L.push('Write-Host " 整理が完了しました！" -ForegroundColor Cyan');
    L.push('Write-Host " ====================================================" -ForegroundColor Cyan');
    L.push('Write-Host ""');
    L.push('$ans = Read-Host "デスクトップの「メール」フォルダを開きますか？(Y/N)"');
    L.push('if ($ans -imatch "^Y") { Start-Process explorer.exe $DestBase }');
    L.push('Read-Host "Enterを押して終了"');

    const bom  = '\uFEFF';
    const blob = new Blob([bom + L.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    dlBlob(blob, 'joruri_mail_' + today + '.ps1');
    Toast.show('PowerShellスクリプトを生成しました！', 'success');
  }

  // ── ユーティリティ ──────────────────────────────────────
  function winSafe(s) {
    return String(s).replace(/[\/\*\?"<>|]/g, '_').replace(/:/g, '_').trim();
  }

  function fmtDate(d) {
    return '' + d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
  }

  function dlBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  return { generateBat, generatePs };
})();
