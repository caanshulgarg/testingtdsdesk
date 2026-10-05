# Screenshot of the whole desktop into $env:SHOTS\<name>.png (logs failure instead of failing)
param([string]$name)
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
  New-Item -ItemType Directory -Force $env:SHOTS | Out-Null
  $bmp.Save("$env:SHOTS\$name.png", [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "[shot] $name ($($b.Width)x$($b.Height))"
} catch { Write-Host "[shot] $name FAILED: $_" }
