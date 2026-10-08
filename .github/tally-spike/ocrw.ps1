# ocrw.ps1 - mode mhook: ocr.ps1 with positions, and Tally's current field. Runs under Windows PowerShell 5.1
# (powershell.exe: the WinRT OCR types). Prints:
#   HL <x> <y> <w> <h>        each box filled with Tally's current-field colour (254,232,175) (rows of >= 12 such pixels)
#   L <x> <y> <w> <h> <text>  each OCR line, in screen pixels
#   OCR-UNAVAILABLE <why>     when the engine cannot be made
param([string]$path, [int]$scale = 2)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class MHHl {
  public static List<int[]> Boxes(Bitmap b) {
    var d = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    int w = b.Width, h = b.Height; var px = new int[w * h]; Marshal.Copy(d.Scan0, px, 0, w * h); b.UnlockBits(d);
    var rows = new List<int[]>();   // y, x0, x1 of runs
    for (int y = 0; y < h; y++) { int s = -1;
      for (int x = 0; x <= w; x++) { bool on = x < w && IsHl(px[y * w + x]);
        if (on && s < 0) s = x; if (!on && s >= 0) { if (x - s >= 12) rows.Add(new int[] { y, s, x - 1 }); s = -1; } } }
    var boxes = new List<int[]>();  // x0, y0, x1, y1
    foreach (var r in rows) { bool m = false;
      foreach (var bx in boxes) { if (r[0] <= bx[3] + 2 && r[2] >= bx[0] - 2 && r[1] <= bx[2] + 2) { bx[0] = Math.Min(bx[0], r[1]); bx[2] = Math.Max(bx[2], r[2]); bx[3] = r[0]; m = true; break; } }
      if (!m) boxes.Add(new int[] { r[1], r[0], r[2], r[0] }); }
    return boxes;
  }
  static bool IsHl(int p) { int r = (p >> 16) & 255, g = (p >> 8) & 255, bl = p & 255; return Math.Abs(r - 254) <= 3 && Math.Abs(g - 232) <= 6 && Math.Abs(bl - 175) <= 8; }
}
'@
  $src = [System.Drawing.Bitmap]::FromFile($path)
  foreach ($bx in [MHHl]::Boxes($src)) { if (($bx[3] - $bx[1]) -ge 6) { Write-Output ('HL {0} {1} {2} {3}' -f $bx[0], $bx[1], ($bx[2] - $bx[0] + 1), ($bx[3] - $bx[1] + 1)) } }
  $big = New-Object System.Drawing.Bitmap ($src.Width * $scale), ($src.Height * $scale)
  $g = [System.Drawing.Graphics]::FromImage($big); $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($src, 0, 0, $big.Width, $big.Height); $g.Dispose(); $src.Dispose()
  $tmp = [IO.Path]::Combine([IO.Path]::GetTempPath(), "ocrw-$PID.png"); $big.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $eng) { $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
  if (-not $eng) { Write-Output 'OCR-UNAVAILABLE no OCR engine for the profile languages or en-US'; exit 0 }
  $res = Await ($eng.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose(); Remove-Item $tmp -ErrorAction SilentlyContinue
  foreach ($l in $res.Lines) {
    # a line split where words are far apart (a label and its value on one screen row are two lines)
    $cur = @(); $lastX = -1
    $flush = { param($ws) if ($ws.Count) { $x0 = ($ws | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum; $y0 = ($ws | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
        $x1 = ($ws | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum; $y1 = ($ws | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
        Write-Output ('L {0} {1} {2} {3} {4}' -f [int]($x0 / $scale), [int]($y0 / $scale), [int](($x1 - $x0) / $scale), [int](($y1 - $y0) / $scale), (($ws | ForEach-Object { $_.Text }) -join ' ')) } }
    foreach ($w in $l.Words) {
      if ($lastX -ge 0 -and ($w.BoundingRect.X - $lastX) -gt (24 * $scale)) { & $flush $cur; $cur = @() }
      $cur += $w; $lastX = $w.BoundingRect.X + $w.BoundingRect.Width
    }
    & $flush $cur
  }
} catch { Write-Output "OCR-UNAVAILABLE $($_.Exception.Message)" }
