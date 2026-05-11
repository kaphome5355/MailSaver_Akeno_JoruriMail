/**
 * batchGenerator.js
 * 保存済みメール本文(.txt) と 添付ファイルを
 * デスクトップの「メール」フォルダへ整理するバッチ/.ps1 を生成
 *
 * v4 — アーカイブ展開バグ全面修正
 *   [修正A] bat版 zipPsScript:
 *           単発 Expand-Archive から「アーカイブがなくなるまで多パスループ」に書き換え。
 *           .zip/.7z/.rar/.tar/.gz/.tgz/.bz2/.xz/.lzh/.cab すべて再帰展開。
 *           7-Zip 未インストール時は警告表示してコピーにフォールバック。
 *   [修正B] PS1版 Expand-OneArchive:
 *           空 catch を廃止 → Expand-Archive 失敗時は Write-Host でエラーを表示し
 *           明示的に 7-Zip へフォールバック。
 *           7-Zip なしで .zip 以外が来た場合も警告を出して $false を返す。
 *   [修正C] PS1版 generatePs 添付処理:
 *           Copy-Item 後に Test-Path で存在確認。
 *           失敗時は早期リターンして Expand-RecursiveArchive を呼ばない。
 *           Write-Host によるデバッグ表示を強化。
 *
 * 過去の修正（v3 引き継ぎ）:
 *   [修正1] :: コメントを rem に変更
 *   [修正2] 本文保存を -EncodedCommand（UTF-16LE Base64）方式に変更
 *   [修正3] ZIP展開PS1の echo 書き出し方式を廃止 → -EncodedCommand 方式に変更
 */

const BatchGenerator = (() => {

  // ================================================================
  //  ブラウザ側ユーティリティ: 文字列 → UTF-16LE Base64
  //  PowerShell の -EncodedCommand 引数に渡す形式
  // ================================================================
  function toBase64Cmd(psScript) {
    const buf = [];
    for (let i = 0; i < psScript.length; i++) {
      const c = psScript.charCodeAt(i);
      buf.push(c & 0xff, (c >> 8) & 0xff);
    }
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
    // [修正B] 空 catch を廃止。Expand-Archive 失敗は明示的にエラー表示してから
    //         7-Zip へフォールバック。7-Zip なし かつ zip 以外なら警告して $false。
    F.push('function Expand-OneArchive {');
    F.push('  param([string]$ArchivePath, [string]$DestDir, [string]$Password = "")');
    F.push('  $ext = [System.IO.Path]::GetExtension($ArchivePath).ToLower()');
    F.push('');
    F.push('  # .zip かつパスワードなし → まず PowerShell 組み込みを試みる');
    F.push('  if ($ext -eq ".zip" -and $Password -eq "") {');
    F.push('    try {');
    F.push('      Expand-Archive -LiteralPath $ArchivePath -DestinationPath $DestDir -Force -ErrorAction Stop');
    F.push('      return $true');
    F.push('    } catch {');
    F.push('      # Expand-Archive 失敗 → エラーを表示して 7-Zip へフォールバック');
    F.push('      Write-Host "  [情報] Expand-Archive 失敗、7-Zip を試みます: $($_.Exception.Message)" -ForegroundColor DarkYellow');
    F.push('    }');
    F.push('  }');
    F.push('');
    F.push('  # 7-Zip を探す');
    F.push('  $7zPaths = @(');
    F.push('    ($env:ProgramFiles        + "\\7-Zip\\7z.exe"),');
    F.push('    (${env:ProgramFiles(x86)} + "\\7-Zip\\7z.exe"),');
    F.push('    ($env:LOCALAPPDATA        + "\\Programs\\7-Zip\\7z.exe")');
    F.push('  )');
    F.push('  $7z = $null');
    F.push('  foreach ($p in $7zPaths) { if ($p -and (Test-Path $p)) { $7z = $p; break } }');
    F.push('');
    F.push('  if ($null -eq $7z) {');
    F.push('    Write-Host "  [警告] 7-Zip が見つかりません。https://www.7-zip.org/ からインストールしてください。" -ForegroundColor Yellow');
    F.push('    Write-Host "         対象ファイル: $([System.IO.Path]::GetFileName($ArchivePath))" -ForegroundColor Yellow');
    F.push('    return $false');
    F.push('  }');
    F.push('');
    F.push('  # 7-Zip で展開');
    F.push('  $args7z = @("x", $ArchivePath, ("-o" + $DestDir), "-y")');
    F.push('  if ($Password -ne "") { $args7z += ("-p" + $Password) }');
    F.push('  $proc = Start-Process -FilePath $7z -ArgumentList $args7z -Wait -PassThru -NoNewWindow `');
    F.push('    -RedirectStandardOutput ($env:TEMP + "\\7z_stdout.txt") `');
    F.push('    -RedirectStandardError  ($env:TEMP + "\\7z_stderr.txt")');
    F.push('  if ($proc.ExitCode -ne 0) {');
    F.push('    $errMsg = ""');
    F.push('    if (Test-Path ($env:TEMP + "\\7z_stderr.txt")) {');
    F.push('      $errMsg = (Get-Content ($env:TEMP + "\\7z_stderr.txt") -Raw -ErrorAction SilentlyContinue)');
    F.push('    }');
    F.push('    Write-Host "  [エラー] 7-Zip 終了コード: $($proc.ExitCode) $errMsg" -ForegroundColor Red');
    F.push('    return $false');
    F.push('  }');
    F.push('  return $true');
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
    F.push('    Write-Host "  [パス $($pass+1)] 圧縮ファイル $($archives.Count) 個を展開します..." -ForegroundColor DarkCyan');
    F.push('    foreach ($arc in $archives) {');
    F.push('      $arcPath = $arc.FullName');
    F.push('      $arcDir  = $arc.DirectoryName');
    F.push('      $arcBase = [System.IO.Path]::GetFileNameWithoutExtension($arc.Name)');
    F.push('      $tmpDir  = Get-UniqueFileName -Dir $arcDir -FileName $arcBase');
    F.push('      Write-Host "  [展開中] $($arc.Name) -> $([System.IO.Path]::GetFileName($tmpDir))" -ForegroundColor Cyan');
    F.push('      New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null');
    F.push('      $ok = Expand-OneArchive -ArchivePath $arcPath -DestDir $tmpDir -Password ""');
    F.push('      if (-not $ok) {');
    F.push('        $retry = 0');
    F.push('        while (-not $ok -and $retry -lt 3) {');
    F.push('          Write-Host "  *** パスワードが必要です: $($arc.Name) ***" -ForegroundColor Magenta');
    F.push('          $pw = Read-Host "      パスワードを入力してください（スキップはそのままEnter）"');
    F.push('          if ($pw -eq "") { break }');
    F.push('          if (Test-Path $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }');
    F.push('          New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null');
    F.push('          $ok = Expand-OneArchive -ArchivePath $arcPath -DestDir $tmpDir -Password $pw');
    F.push('          $retry++');
    F.push('        }');
    F.push('      }');
    F.push('      if ($ok) {');
    F.push('        # 展開成功: 元アーカイブを削除してフラットニング＋移動');
    F.push('        Remove-Item -LiteralPath $arcPath -Force -ErrorAction Stop');
    F.push('        Invoke-SmartFlatten -Dir $tmpDir');
    F.push('        $moved = 0');
    F.push('        Get-ChildItem -LiteralPath $tmpDir -Force | ForEach-Object {');
    F.push('          $dst = Get-UniqueFileName -Dir $arcDir -FileName $_.Name');
    F.push('          Move-Item -LiteralPath $_.FullName -Destination $dst -Force -ErrorAction Stop');
    F.push('          $moved++');
    F.push('        }');
    F.push('        Remove-Item -LiteralPath $tmpDir -Force -Recurse -ErrorAction SilentlyContinue');
    F.push('        Write-Host "    -> 完了: $($arc.Name) ($moved 個のアイテムを展開)" -ForegroundColor Green');
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
  //  バッチファイル (.bat) 生成  v4
  //
  //  【設計方針】
  //  .bat は「起動ランチャー」に徹し、全ての実質処理を
  //  -EncodedCommand（UTF-16LE Base64）で渡す単発 PowerShell 呼び出しに委ねる。
  //
  //  処理フロー:
  //    1. フォルダ作成        → PowerShell -EncodedCommand
  //    2. 本文.txt 保存       → PowerShell -EncodedCommand
  //    3. 添付ファイル検索    → bat の FOR ループ（ファイルパス取得のみ）
  //    4. アーカイブ展開/コピー → PowerShell -EncodedCommand（多パス再帰展開）
  //
  //  [修正A] zipPsScript: 多パスループで入れ子アーカイブを完全展開
  //          .zip は Expand-Archive → 失敗なら 7-Zip へフォールバック
  //          .7z/.rar 等は直接 7-Zip
  //          7-Zip 未インストール時は警告してコピーにフォールバック
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
    L.push('rem ====================================================');
    L.push('rem JoruriMail 整理バッチファイル  v4');
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
      const label      = 'M' + idx;

      L.push('rem ---- [' + (idx + 1) + '/' + savedMails.length + '] ----');
      L.push('set "MAIL_DIR=%DEST%\\' + safeFolder + '"');
      L.push('if not exist "!MAIL_DIR!" mkdir "!MAIL_DIR!"');
      L.push('');

      // ── 本文.txt 保存（EncodedCommand方式）──────────────────
      const bodyText =
        '件名: ' + mail.subject + '\r\n' +
        '日付: ' + mail.date   + '\r\n' +
        '='.repeat(40)         + '\r\n\r\n' +
        mail.body;

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
          const nextLabel   = 'NEXT_' + label + '_' + ai;

          L.push('set "ATT_FILE="');
          L.push('for %%D in ("%USERPROFILE%\\Downloads" "%USERPROFILE%\\Desktop" "%USERPROFILE%\\Documents") do (');
          L.push('  if exist "%%~D\\' + fname + '" set "ATT_FILE=%%~D\\' + fname + '"');
          L.push(')');
          L.push('if not defined ATT_FILE (');
          L.push('  echo  [警告] 見つかりません: ' + fname);
          L.push('  goto :' + nextLabel);
          L.push(')');
          L.push('');

          if (isArchive) {
            // ================================================================
            // [修正A] 多パス再帰展開ロジック
            // $dst（メールフォルダ）内にアーカイブがなくなるまで最大20パス展開。
            // .zip: Expand-Archive → 失敗なら 7-Zip
            // .7z/.rar 等: 直接 7-Zip
            // 7-Zip 未インストール: 警告してコピーのみ（展開なし）
            // ================================================================
            const arcPsScript = [
              'param()',
              '$src=$env:ATT_FILE;$dst=$env:MAIL_DIR;',
              '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
              // ---- Get-UniqueFileName（インライン）
              'function gufn{param($d,$f)',
              '  $b=[IO.Path]::GetFileNameWithoutExtension($f);',
              '  $e=[IO.Path]::GetExtension($f);',
              '  $c=Join-Path $d $f;$n=1;',
              '  while(Test-Path $c){$c=Join-Path $d "$b($n)$e";$n++};',
              '  return $c}',
              // ---- Invoke-SmartFlatten（インライン）
              'function flatten{param($d)',
              '  while($true){',
              '    $it=@(Get-ChildItem -LiteralPath $d -Force);',
              '    if($it.Count -eq 1 -and $it[0].PSIsContainer){',
              '      $ch=$it[0].FullName;',
              '      Get-ChildItem -LiteralPath $ch -Force|%{',
              '        $x=gufn $d $_.Name;',
              '        Move-Item -LiteralPath $_.FullName -Destination $x -Force -EA SilentlyContinue};',
              '      Remove-Item -LiteralPath $ch -Recurse -Force -EA SilentlyContinue',
              '    }else{break}}}',
              // ---- 7-Zip パス解決
              '$7zPaths=@(',
              '  ($env:ProgramFiles+"\\7-Zip\\7z.exe"),',
              '  (${env:ProgramFiles(x86)}+"\\7-Zip\\7z.exe"),',
              '  ($env:LOCALAPPDATA+"\\Programs\\7-Zip\\7z.exe"));',
              '$7z=$null;',
              'foreach($p in $7zPaths){if($p -and (Test-Path $p)){$7z=$p;break}};',
              // ---- Expand-OneArchive（インライン）
              // .zip: Expand-Archive 試行 → 失敗なら 7-Zip
              // その他: 直接 7-Zip
              'function expand1{param($ap,$dd)',
              '  $ex=[IO.Path]::GetExtension($ap).ToLower();',
              '  if($ex -eq ".zip"){',
              '    try{Expand-Archive -LiteralPath $ap -DestinationPath $dd -Force -EA Stop;return $true}',
              '    catch{Write-Host "  [情報] Expand-Archive 失敗、7-Zip を試みます" -ForegroundColor DarkYellow}',
              '  }',
              '  if($null -eq $7z){',
              '    Write-Host "  [警告] 7-Zip 未インストール: $([IO.Path]::GetFileName($ap))" -ForegroundColor Yellow;',
              '    return $false}',
              '  $a=@("x",$ap,("-o"+$dd),"-y");',
              '  $p=Start-Process -FilePath $7z -ArgumentList $a -Wait -PassThru -NoNewWindow `',
              '    -RedirectStandardOutput ($env:TEMP+"\\7z_stdout.txt") `',
              '    -RedirectStandardError ($env:TEMP+"\\7z_stderr.txt");',
              '  if($p.ExitCode -ne 0){',
              '    $em="";',
              '    if(Test-Path ($env:TEMP+"\\7z_stderr.txt")){$em=Get-Content ($env:TEMP+"\\7z_stderr.txt") -Raw -EA SilentlyContinue};',
              '    Write-Host "  [エラー] 7-Zip 失敗(ExitCode=$($p.ExitCode)): $em" -ForegroundColor Red;',
              '    return $false}',
              '  return $true}',
              // ---- アーカイブをメールフォルダへコピー
              '$arcExts=@(".zip",".7z",".rar",".tar",".gz",".tgz",".bz2",".xz",".lzh",".cab");',
              '$fname=[IO.Path]::GetFileName($src);',
              '$arcDest=gufn $dst $fname;',
              'Write-Host "  [コピー] $fname -> $([IO.Path]::GetFileName($arcDest))" -ForegroundColor Cyan;',
              'Copy-Item -LiteralPath $src -Destination $arcDest -Force -EA Stop;',
              'if(-not(Test-Path $arcDest)){',
              '  Write-Host "  [エラー] コピー失敗: $arcDest" -ForegroundColor Red;exit 1};',
              // ---- 多パス再帰展開ループ
              'for($pass=0;$pass -lt 20;$pass++){',
              '  $arcs=@(Get-ChildItem -LiteralPath $dst -Recurse -File|',
              '    Where-Object{$arcExts -contains $_.Extension.ToLower()});',
              '  if($arcs.Count -eq 0){break};',
              '  Write-Host "  [パス $($pass+1)] $($arcs.Count) 個のアーカイブを展開中..." -ForegroundColor DarkCyan;',
              '  foreach($arc in $arcs){',
              '    $ap=$arc.FullName;$ad=$arc.DirectoryName;',
              '    $ab=[IO.Path]::GetFileNameWithoutExtension($arc.Name);',
              '    $td=gufn $ad $ab;',
              '    Write-Host "    -> $($arc.Name)" -ForegroundColor Cyan;',
              '    New-Item -ItemType Directory -Path $td -Force|Out-Null;',
              '    $ok=expand1 $ap $td;',
              '    if($ok){',
              '      Remove-Item -LiteralPath $ap -Force -EA SilentlyContinue;',
              '      flatten $td;',
              '      Get-ChildItem -LiteralPath $td -Force|%{',
              '        $x=gufn $ad $_.Name;',
              '        Move-Item -LiteralPath $_.FullName -Destination $x -Force -EA SilentlyContinue};',
              '      Remove-Item -LiteralPath $td -Recurse -Force -EA SilentlyContinue;',
              '      Write-Host "       完了: $($arc.Name)" -ForegroundColor Green',
              '    }else{',
              '      Write-Host "       スキップ（展開不可）: $($arc.Name)" -ForegroundColor Yellow;',
              '      if(Test-Path $td){Remove-Item -LiteralPath $td -Recurse -Force -EA SilentlyContinue}}}};',
              // ---- 空フォルダ削除
              'Get-ChildItem -LiteralPath $dst -Recurse -Directory|',
              '  Sort-Object FullName -Desc|%{',
              '    if(-not(Get-ChildItem -LiteralPath $_.FullName -Force)){',
              '      Remove-Item -LiteralPath $_.FullName -Force -EA SilentlyContinue}};',
              'exit 0'
            ].join('');

            const arcB64 = toBase64Cmd(arcPsScript);
            L.push('rem アーカイブ展開（多パス再帰・スマートフラットニング・衝突回避）');
            L.push('powershell -NoProfile -NonInteractive -EncodedCommand ' + arcB64);
            L.push('if !errorlevel!==0 (');
            L.push('  echo  [OK] アーカイブ展開完了: ' + fname);
            L.push('  del /f /q "!ATT_FILE!" 2>nul');
            L.push(') else (');
            L.push('  echo  [注意] アーカイブ展開に失敗しました。PS1版での再実行を推奨: ' + fname);
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
    Toast.show('バッチファイルを生成しました！', 'success');
  }

  // ================================================================
  //  PowerShell スクリプト (.ps1) 生成  v4 ← 全形式対応・メイン推奨
  //
  //  [修正C] 添付処理:
  //    Copy-Item 後に Test-Path で存在確認。
  //    コピー失敗時は早期リターン（Expand-RecursiveArchive を呼ばない）。
  //    Write-Host によるデバッグ表示を強化。
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
    L.push('# JoruriMail 整理 PowerShell スクリプト  v4');
    L.push('# 生成日時 : ' + today);
    L.push('# 実行方法 : 右クリック→「PowerShellで実行」');
    L.push('#            または: powershell -ExecutionPolicy Bypass -File "このファイル.ps1"');
    L.push('# 対応形式 : .zip .7z .rar .tar .gz .tgz .bz2 .xz .lzh .cab');
    L.push('# 注意     : .zip以外は 7-Zip (https://www.7-zip.org/) が必要です');
    L.push('# ====================================================');
    L.push('[Console]::OutputEncoding = [Text.Encoding]::UTF8');
    L.push('$ErrorActionPreference = "Stop"');   // ← Continue から Stop に変更（無音スキップ防止）
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
      const bodyText =
        '件名: ' + mail.subject + '\n' +
        '日付: ' + mail.date   + '\n' +
        '='.repeat(40)         + '\n\n' +
        mail.body;
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
          L.push('    Write-Host "  [処理開始] ' + fname + '" -ForegroundColor DarkCyan');
          L.push('    Write-Host "    ソース: $AttFile" -ForegroundColor DarkGray');

          if (isArchive) {
            // [修正C] Copy-Item 後に Test-Path で確認してから展開
            L.push("    $arcDest = Get-UniqueFileName -Dir $MailDir -FileName '" + fname + "'");
            L.push('    Write-Host "    コピー先: $arcDest" -ForegroundColor DarkGray');
            L.push('    Copy-Item -LiteralPath $AttFile -Destination $arcDest -Force -ErrorAction Stop');
            L.push('    # コピー確認（フェイルセーフ）');
            L.push('    if (-not (Test-Path $arcDest)) {');
            L.push('      Write-Host "  [エラー] コピー失敗（ファイルが存在しない）: $arcDest" -ForegroundColor Red');
            L.push('      throw "Copy-Item succeeded but destination not found: $arcDest"');
            L.push('    }');
            L.push('    $copiedSize = (Get-Item -LiteralPath $arcDest).Length');
            L.push('    Write-Host "    コピー完了: $([math]::Round($copiedSize/1KB, 1)) KB" -ForegroundColor DarkGray');
            L.push('    Write-Host "  [展開中] アーカイブ再帰展開を開始します..." -ForegroundColor Cyan');
            L.push('    Expand-RecursiveArchive -Dir $MailDir');
            L.push('    Write-Host "  [OK] アーカイブ展開完了: ' + fname + '" -ForegroundColor Green');
            L.push('    Remove-Item -LiteralPath $AttFile -Force -ErrorAction SilentlyContinue');
          } else {
            L.push("    $dst = Get-UniqueFileName -Dir $MailDir -FileName '" + fname + "'");
            L.push('    Copy-Item -LiteralPath $AttFile -Destination $dst -Force -ErrorAction Stop');
            L.push('    Write-Host "  [OK] コピー: ' + fname + '" -ForegroundColor Green');
            L.push('    Remove-Item -LiteralPath $AttFile -Force -ErrorAction SilentlyContinue');
          }

          L.push('  } catch {');
          L.push('    Write-Host "  [エラー] $($_.Exception.Message)" -ForegroundColor Red');
          L.push('    Write-Host "  [エラー詳細] $($_.ScriptStackTrace)" -ForegroundColor DarkRed');
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
