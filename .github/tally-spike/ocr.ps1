# Text on a screenshot by Windows' own OCR (Windows.Media.Ocr), for the screen checks between keys. Runs under Windows
# PowerShell 5.1 (powershell.exe: the WinRT types are not reachable from pwsh 7). The picture is enlarged 2x first
# (Tally's small fonts). Prints the lines it read; prints "OCR-UNAVAILABLE <why>" when the engine cannot be made.
param([string]$path, [int]$scale = 2)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Bitmap]::FromFile($path)
  $big = New-Object System.Drawing.Bitmap ($src.Width * $scale), ($src.Height * $scale)
  $g = [System.Drawing.Graphics]::FromImage($big); $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($src, 0, 0, $big.Width, $big.Height); $g.Dispose(); $src.Dispose()
  $tmp = [IO.Path]::Combine([IO.Path]::GetTempPath(), "ocr-$PID.png"); $big.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
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
  foreach ($l in $res.Lines) { Write-Output $l.Text }
} catch { Write-Output "OCR-UNAVAILABLE $($_.Exception.Message)" }
