/**
 * batchGenerator.js
 * 保存済みメール本文(.txt) と 添付ファイルを
 * デスクトップの「メール」フォルダへ整理するバッチ (.bat) を生成
 *
 * v5 — BAT版に一本化・元圧縮ファイルを削除しない
 *   [変更1] PS1版（generatePs）を廃止。BAT版のみに統一。
 *           理由: PS1版はファイル書き出し時の文字エスケープ問題が根本的に
 *                 解決できず、動作が不安定。BAT版の -EncodedCommand 方式が
 *                 安定しており同等機能を提供できる。
 *   [変更2] 元の圧縮ファイルを削除しない。
 *           展開・コピー後も元ファイルはそのままにしておく。
 *           （旧: del /f /q "!ATT_FILE!" を除去）
 *   [変更3] 通常ファイルのコピー後も元ファイルを削除しない。
 *
 * v4からの引き継ぎ:
 *   [修正A] 多パス再帰展開ロジック（最大20パス、入れ子ZIP完全対応）
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
  //  バッチファイル (.bat) 生成  v5
  //
  //  【設計方針】
  //  .bat は「起動ランチャー」に徹し、全ての実質処理を
  //  -EncodedCommand（UTF-16LE Base64）で渡す単発 PowerShell 呼び出しに委ねる。
  //  これにより echo/:: によるエスケープ問題を根絶する。
  //
  //  処理フロー:
  //    1. フォルダ作成        → PowerShell -EncodedCommand
  //    2. 本文.txt 保存       → PowerShell -EncodedCommand
  //    3. 添付ファイル検索    → bat の FOR ループ（ファイルパス取得のみ）
  //    4. アーカイブ展開      → PowerShell -EncodedCommand（多パス再帰展開）
  //    5. 通常ファイルコピー  → PowerShell -EncodedCommand
  //    ※ 元ファイルは削除しない（コピー元をそのまま残す）
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
    L.push('rem JoruriMail 整理バッチファイル  v5');
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

      L.push('rem ---- [' + (idx + 1) + '/' + savedMails.length + '] ' + safeFolder + ' ----');
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
          const fname       = winSafe(att.file.name);
          const fnameLow    = fname.toLowerCase();
          const archiveExts = ['.zip','.7z','.rar','.tar','.gz','.tgz','.bz2','.xz','.lzh','.cab'];
          const isArchive   = archiveExts.some(e => fnameLow.endsWith(e));
          const nextLabel   = 'NEXT_' + label + '_' + ai;

          // ファイルをダウンロード・デスクトップ・ドキュメントから検索
          L.push('set "ATT_FILE="');
          L.push('for %%D in ("%USERPROFILE%\\Downloads" "%USERPROFILE%\\Desktop" "%USERPROFILE%\\Documents") do (');
          L.push('  if exist "%%~D\\' + fname + '" set "ATT_FILE=%%~D\\' + fname + '"');
          L.push(')');
          L.push('if not defined ATT_FILE (');
          L.push('  echo  [警告] 見つかりません（Downloads/Desktop/Documents を確認）: ' + fname);
          L.push('  goto :' + nextLabel);
          L.push(')');
          L.push('');

          if (isArchive) {
            // ============================================================
            // アーカイブ: 多パス再帰展開ロジック（最大20パス）
            //
            // 手順:
            //   1. $src（元ファイル）を $dst（メールフォルダ）へコピー
            //      ※ 元ファイルは削除しない
            //   2. $dst 内にアーカイブがなくなるまでループ展開:
            //      各アーカイブを tmpDir へ展開 → SmartFlatten → $dst へ移動
            //      → tmpDir 削除 → アーカイブ本体削除（コピー先のみ）
            //   3. 空フォルダを削除
            //
            // 対応形式:
            //   .zip → Expand-Archive 試行 → 失敗なら 7-Zip
            //   .7z/.rar/.tar/.gz 等 → 7-Zip 直接
            //   7-Zip 未インストール → 警告してコピーのみ
            // ============================================================
            const arcPsScript = [
              'param()',
              '$src=$env:ATT_FILE;$dst=$env:MAIL_DIR;',
              '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',

              // ---- Get-UniqueFileName（インライン関数）
              'function gufn{param($d,$f)',
              '  $b=[IO.Path]::GetFileNameWithoutExtension($f);',
              '  $e=[IO.Path]::GetExtension($f);',
              '  $c=Join-Path $d $f;$n=1;',
              '  while(Test-Path $c){$c=Join-Path $d "$b($n)$e";$n++};',
              '  return $c}',

              // ---- SmartFlatten（インライン関数）
              // 展開フォルダ直下が1つのフォルダだけなら中身を上げる
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

              // ---- Expand-OneArchive（インライン関数）
              // .zip: Expand-Archive 試行 → 失敗なら 7-Zip
              // その他: 7-Zip 直接
              'function expand1{param($ap,$dd)',
              '  $ex=[IO.Path]::GetExtension($ap).ToLower();',
              '  if($ex -eq ".zip"){',
              '    try{Expand-Archive -LiteralPath $ap -DestinationPath $dd -Force -EA Stop;return $true}',
              '    catch{Write-Host "  [情報] Expand-Archive 失敗、7-Zip を試みます" -ForegroundColor DarkYellow}}',
              '  if($null -eq $7z){',
              '    Write-Host "  [警告] 7-Zip 未インストール。https://www.7-zip.org/ からインストールしてください: $([IO.Path]::GetFileName($ap))" -ForegroundColor Yellow;',
              '    return $false}',
              '  $a=@("x",$ap,("-o"+$dd),"-y");',
              '  $p=Start-Process -FilePath $7z -ArgumentList $a -Wait -PassThru -NoNewWindow `',
              '    -RedirectStandardOutput ($env:TEMP+"\\7z_stdout.txt") `',
              '    -RedirectStandardError ($env:TEMP+"\\7z_stderr.txt");',
              '  if($p.ExitCode -ne 0){',
              '    $em="";if(Test-Path ($env:TEMP+"\\7z_stderr.txt")){$em=Get-Content ($env:TEMP+"\\7z_stderr.txt") -Raw -EA SilentlyContinue};',
              '    Write-Host "  [エラー] 7-Zip 失敗(ExitCode=$($p.ExitCode)): $em" -ForegroundColor Red;',
              '    return $false};',
              '  return $true}',

              // ---- STEP1: 元アーカイブを $dst へコピー（元ファイルは残す）
              '$arcExts=@(".zip",".7z",".rar",".tar",".gz",".tgz",".bz2",".xz",".lzh",".cab");',
              '$fname=[IO.Path]::GetFileName($src);',
              '$arcDest=gufn $dst $fname;',
              'Write-Host "  [コピー] $fname -> $([IO.Path]::GetFileName($arcDest))" -ForegroundColor Cyan;',
              'Copy-Item -LiteralPath $src -Destination $arcDest -Force -EA Stop;',
              'if(-not(Test-Path $arcDest)){',
              '  Write-Host "  [エラー] コピー失敗: $arcDest" -ForegroundColor Red;exit 1};',

              // ---- STEP2: 多パス再帰展開（$dst 内にアーカイブがなくなるまで）
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
              '      Remove-Item -LiteralPath $ap -Force -EA SilentlyContinue;',  // コピー先のアーカイブを削除（$dst内）
              '      flatten $td;',
              '      Get-ChildItem -LiteralPath $td -Force|%{',
              '        $x=gufn $ad $_.Name;',
              '        Move-Item -LiteralPath $_.FullName -Destination $x -Force -EA SilentlyContinue};',
              '      Remove-Item -LiteralPath $td -Recurse -Force -EA SilentlyContinue;',
              '      Write-Host "       完了: $($arc.Name)" -ForegroundColor Green',
              '    }else{',
              '      Write-Host "       スキップ（展開不可）: $($arc.Name)" -ForegroundColor Yellow;',
              '      if(Test-Path $td){Remove-Item -LiteralPath $td -Recurse -Force -EA SilentlyContinue}}}};',

              // ---- STEP3: 空フォルダ削除
              'Get-ChildItem -LiteralPath $dst -Recurse -Directory|',
              '  Sort-Object FullName -Desc|%{',
              '    if(-not(Get-ChildItem -LiteralPath $_.FullName -Force)){',
              '      Remove-Item -LiteralPath $_.FullName -Force -EA SilentlyContinue}};',
              'Write-Host "  [完了] 展開処理が終わりました。元ファイルはそのまま残してあります: $fname" -ForegroundColor Green;',
              'exit 0'
            ].join('');

            const arcB64 = toBase64Cmd(arcPsScript);
            L.push('rem アーカイブ展開（多パス再帰・スマートフラットニング・衝突回避）');
            L.push('rem 元ファイルはそのまま残します');
            L.push('powershell -NoProfile -NonInteractive -EncodedCommand ' + arcB64);
            L.push('if !errorlevel!==0 (');
            L.push('  echo  [OK] アーカイブ展開完了: ' + fname);
            L.push(') else (');
            L.push('  echo  [注意] アーカイブ展開に失敗しました: ' + fname);
            L.push(')');

          } else {
            // 通常ファイル: 衝突回避コピー（元ファイルは残す）
            const fileCopyB64 = toBase64Cmd(
              '$src=$env:ATT_FILE;$dst=$env:MAIL_DIR;' +
              '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' +
              '$dn=[IO.Path]::GetFileName($src);' +
              '$dd=Join-Path $dst $dn;$i=1;' +
              'while(Test-Path $dd){' +
                '$dd=Join-Path $dst (([IO.Path]::GetFileNameWithoutExtension($dn))+"($i)"+[IO.Path]::GetExtension($dn));$i++};' +
              'Copy-Item -LiteralPath $src -Destination $dd -Force;' +
              'Write-Host "  コピー先: $dd" -ForegroundColor DarkGray;' +
              'exit 0'
            );
            L.push('rem 通常ファイルコピー（元ファイルはそのまま残します）');
            L.push('powershell -NoProfile -NonInteractive -EncodedCommand ' + fileCopyB64);
            L.push('if !errorlevel!==0 (');
            L.push('  echo  [OK] コピー完了: ' + fname);
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
    L.push('echo  ※ 元の添付ファイルはそのまま残してあります');
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

  return { generateBat };
})();
