# userfile233.ps1 - branch next-userfile (input only=userfile, bridge_ref next-userfile): each Windows user's add-on lines go
# to that user's own daily file <company GUID>-<day>-<Windows user>.txt, every line carrying "|w=<Windows user>" after tw,
# and each user's bridge reads only its own user's files. Dot-sourced by flow4.ps1 (its helpers, both Tallys with the
# add-on from the ref, both bridges running). One ledger saved on the screen in each user's Tally (the Ledger form's
# hook), then:
#   UF1 the recorder folder: a file named for each Windows user (runneradmin, fcuser2), none other written by them
#   UF2 every line in each user's file carries w= of that user (and its company's GUID)
#   UF3 the stub: bridge 1 sent user 1's ledger and nothing of user 2's company, bridge 2 the reverse
#   UF4 the beats: bridge 1's recorderFiles names no fcuser2 file, bridge 2's no runneradmin file
function UF233 {
  Say '---- UF: each Windows user''s own recorder file (next-userfile)'
  $m0 = Mark
  $before = @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue | ForEach-Object Name)
  Write-Host "  recorder folder before: $($before -join ', ')"
  KeysTo 9000 'c' 3 'uf-1-create'; KeysTo 9000 'Ledger{ENTER}' 3; KeysTo 9000 'UF Party One{ENTER}' 2; KeysTo 9000 '{ENTER}' 2; KeysTo 9000 'Sundry Debtors{ENTER}' 2 'uf-1-form'; KeysTo 9000 '^a' 4 'uf-1-saved'
  KeysTo 9000 '{ESC}' 2
  $h0 = $script:harness
  if ($tally2) { Keys2 'c' 3 'uf-2-create'; Keys2 'Ledger{ENTER}' 3; Keys2 'UF Party Two{ENTER}' 2; Keys2 '{ENTER}' 2; Keys2 'Sundry Debtors{ENTER}' 2 'uf-2-form'; Keys2 '^a' 4 'uf-2-saved'; Keys2 '{ESC}' 2 }
  Start-Sleep 5
  $files = @(Get-ChildItem $rec -File -ErrorAction SilentlyContinue)
  $files | ForEach-Object { Copy-Item $_.FullName (Join-Path $out "uf-rec-$($_.Name)"); Write-Host "  file $($_.Name) $($_.Length) bytes"; Get-Content $_.FullName -Encoding Unicode | ForEach-Object { Write-Host "    $_" } }
  $f1 = @($files | Where-Object { $_.Name -match '-runneradmin\.txt$' })
  $f2 = @($files | Where-Object { $_.Name -match "-$u2\.txt$" })
  $cg1 = [regex]::Match((ListCo 9000), '(?s)NAME="' + [regex]::Escape($co1) + '".*?<GUID[^>]*>([^<]+)</GUID>').Groups[1].Value
  $cg2 = if ($tally2) { [regex]::Match((ListCo 9001), '(?s)NAME="' + [regex]::Escape($co2) + '".*?<GUID[^>]*>([^<]+)</GUID>').Groups[1].Value } else { '' }
  Write-Host "  company GUIDs: $co1 $cg1; $co2 $cg2"
  $n1ok = $f1.Count -ge 1 -and @($f1 | Where-Object { $_.Name -like "$cg1-*" }).Count -eq $f1.Count
  $n2ok = $f2.Count -ge 1 -and @($f2 | Where-Object { $_.Name -like "$cg2-*" }).Count -eq $f2.Count
  $hn = $script:harness - $h0
  Result 'UF1 a file per Windows user' ($n1ok -and $n2ok) ("runneradmin: {0}; {1}: {2}; every file now: {3}{4}" -f (($f1 | ForEach-Object Name) -join ', '), $u2, (($f2 | ForEach-Object Name) -join ', '), (($files | ForEach-Object Name) -join ', '), $(if ($hn) { "; user 2's task did not run ($hn step(s))" } else { '' })) ($hn -gt 0 -and -not $n2ok)
  # UF2 every line's w= is its file's user
  function WOf($l) { [regex]::Match($l, '^FCR1\|ev=[^|]*\|t0=[^|]*\|tw=[^|]*\|w=([^|]*)\|cguid=').Groups[1].Value }
  $bad = @(); $n = 0; $ev = @()
  foreach ($f in @($f1) + @($f2)) {
    $who = if ($f.Name -match '-runneradmin\.txt$') { 'runneradmin' } else { $u2 }
    foreach ($l in @(Get-Content $f.FullName -Encoding Unicode | Where-Object { $_ -like 'FCR1|*' })) {
      $n++; $w = WOf $l; $ev += "$($f.Name): $([regex]::Match($l, '^FCR1\|ev=([^|]*)').Groups[1].Value) w=$w"
      if ($w -notmatch "(^|\\)$who$" -or $l -notmatch '\|t1=[^|]*\|src=live\s*$') { $bad += "$($f.Name): $l" }
    }
  }
  Result 'UF2 every line names its Windows user' ($n -ge 2 -and $bad.Count -eq 0) ("{0} line(s): {1}; not the file's user (or not ending |t1=..|src=live): {2}" -f $n, ($ev -join '; '), $(if ($bad.Count) { $bad[0] } else { 'none' }))
  # UF3 the stub: each bridge its own user's ledger only
  $hit1 = WaitLine $m0 { $_.ev -like 'ledger_*' -and $_.company -eq $co1 } 120
  $hit2 = if ($tally2) { WaitLine $m0 { $_.ev -like 'ledger_*' -and $_.company -eq $co2 } 120 } else { @() }
  Snap 'uf'
  $all = StubLines $m0
  $all | ForEach-Object { Write-Host "  uf: $(Ev $_)" }
  $wrong = @($all | Where-Object { ($_.company -eq $co1 -and $_.bid -ne $B[1].id) -or ($_.company -eq $co2 -and $_.bid -ne $B[2].id) })
  $b1 = @($hit1 | Where-Object bid -eq $B[1].id)[0]; $b2 = @($hit2 | Where-Object bid -eq $B[2].id)[0]
  Result 'UF3 each bridge sent only its own user''s lines' ([bool]$b1 -and [bool]$b2 -and $wrong.Count -eq 0) ("bridge 1: {0} | bridge 2: {1} | lines from the other user's bridge: {2}{3}" -f (Ev $b1), (Ev $b2), $wrong.Count, $(if ($wrong.Count) { ' e.g. ' + (Ev $wrong[0]) } else { '' }))
  # UF4 the beats' recorderFiles
  Start-Sleep 40
  $reqs = StubReqs
  $bt1 = @($reqs | Where-Object { $_.kind -eq 'beat' -and $_.body.bridge.id -eq $B[1].id }) | Select-Object -Last 1
  $bt2 = @($reqs | Where-Object { $_.kind -eq 'beat' -and $_.body.bridge.id -eq $B[2].id }) | Select-Object -Last 1
  $rf1 = @($bt1.body.recorderFiles); $rf2 = @($bt2.body.recorderFiles)
  $ok4 = $bt1 -and $bt2 -and @($rf1 | Where-Object { $_ -match "-$u2\.txt$" }).Count -eq 0 -and @($rf2 | Where-Object { $_ -match '-runneradmin\.txt$' }).Count -eq 0 -and @($rf1 | Where-Object { $_ -match '-runneradmin\.txt$' }).Count -ge 1 -and @($rf2 | Where-Object { $_ -match "-$u2\.txt$" }).Count -ge 1
  Result 'UF4 each bridge read only its own user''s files' ([bool]$ok4) ("bridge 1 (runneradmin) recorderFiles: {0} | bridge 2 ({1}) recorderFiles: {2}" -f ($rf1 -join ', '), $u2, ($rf2 -join ', '))
}
