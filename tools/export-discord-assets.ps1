param([string]$OutputDirectory = '')

$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path $PSScriptRoot -Parent
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoDirectory 'tools/logs/discord-pack' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
Add-Type -AssemblyName System.Drawing

# Technical PNG exports only: keep the artwork and alpha, fit it inside the
# square canvas Discord expects. Existing originals are never overwritten.
$sources = @(
  Get-ChildItem -LiteralPath (Join-Path $repoDirectory 'assets/stickers') -Filter '*.png' -File
  Get-ChildItem -LiteralPath (Join-Path $repoDirectory 'assets/discord') -Filter '*.png' -File
)
$manifest = @()
foreach ($kind in @('emoji', 'sticker')) {
  $side = if ($kind -eq 'emoji') { 128 } else { 320 }
  $destinationDirectory = Join-Path $OutputDirectory $kind
  New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  foreach ($sourceFile in $sources) {
    $sourceImage = [Drawing.Image]::FromFile($sourceFile.FullName)
    $canvas = [Drawing.Bitmap]::new($side, $side, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scale = [Math]::Min(($side - 8) / $sourceImage.Width, ($side - 8) / $sourceImage.Height)
      $width = [int][Math]::Round($sourceImage.Width * $scale)
      $height = [int][Math]::Round($sourceImage.Height * $scale)
      $rect = [Drawing.Rectangle]::new([int](($side - $width) / 2), [int](($side - $height) / 2), $width, $height)
      $graphics.DrawImage($sourceImage, $rect)
      $name = $sourceFile.BaseName.Replace('-', '_')
      $destination = Join-Path $destinationDirectory ($name + '.png')
      $canvas.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
      $bytes = (Get-Item -LiteralPath $destination).Length
      if ($bytes -gt 256KB) { throw "Export exceeds conservative Discord size limit: $destination" }
      $manifest += [pscustomobject]@{ name = $name; kind = $kind; width = $side; height = $side; bytes = $bytes; path = $destination }
    } finally {
      $graphics.Dispose()
      $canvas.Dispose()
      $sourceImage.Dispose()
    }
  }
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'manifest.json') -Encoding utf8
$manifest | Select-Object name, kind, width, height, bytes | Format-Table -AutoSize
