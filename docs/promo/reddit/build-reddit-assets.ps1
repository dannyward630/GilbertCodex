param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
)

$ErrorActionPreference = "Stop"

$sourceDir = Join-Path $RepoRoot "docs\assets\readme"
$outputDir = Join-Path $PSScriptRoot "images"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$assets = @(
  @{ Source = "gilbert-codex-overview.png"; Target = "01-overview-chat-workspace.png" },
  @{ Source = "gilbert-codex-activity.png"; Target = "02-live-activity-tools-sources.png" },
  @{ Source = "gilbert-codex-toolbox.png"; Target = "03-toolbox-tool-toggles.png" },
  @{ Source = "gilbert-codex-settings.png"; Target = "04-local-settings-providers.png" },
  @{ Source = "gilbert-codex-readme-demo.gif"; Target = "05-readme-demo.gif" }
)

foreach ($asset in $assets) {
  $source = Join-Path $sourceDir $asset.Source
  $target = Join-Path $outputDir $asset.Target
  Copy-Item -LiteralPath $source -Destination $target -Force
}

Add-Type -AssemblyName System.Drawing

function New-SolidBrush([string]$hex) {
  $color = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return New-Object System.Drawing.SolidBrush($color)
}

function Draw-FitImage($graphics, $image, [int]$x, [int]$y, [int]$width, [int]$height) {
  $sourceRatio = $image.Width / $image.Height
  $targetRatio = $width / $height

  if ($sourceRatio -gt $targetRatio) {
    $drawWidth = $width
    $drawHeight = [int]($width / $sourceRatio)
  } else {
    $drawHeight = $height
    $drawWidth = [int]($height * $sourceRatio)
  }

  $drawX = $x + [int](($width - $drawWidth) / 2)
  $drawY = $y + [int](($height - $drawHeight) / 2)
  $graphics.DrawImage($image, $drawX, $drawY, $drawWidth, $drawHeight)
}

$coverPath = Join-Path $outputDir "00-reddit-cover-collage.png"
$canvas = New-Object System.Drawing.Bitmap(1600, 1200)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#f4f2ed"))

$ink = New-SolidBrush "#111318"
$muted = New-SolidBrush "#555b62"
$accent = New-SolidBrush "#1d6fd8"
$panel = New-SolidBrush "#ffffff"
$borderPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#d7d9dd"), 2)

$titleFont = New-Object System.Drawing.Font("Segoe UI", 54, [System.Drawing.FontStyle]::Bold)
$subFont = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Regular)
$tagFont = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$smallFont = New-Object System.Drawing.Font("Segoe UI", 17, [System.Drawing.FontStyle]::Regular)

$graphics.DrawString("Gilbert Codex", $titleFont, $ink, 72, 52)
$graphics.DrawString("Open-source desktop agent workspace", $subFont, $muted, 78, 132)
$graphics.FillRectangle($accent, 78, 190, 10, 28)
$graphics.DrawString("Tauri 2 + React + Rust / Windows alpha / MIT", $tagFont, $ink, 104, 184)
$graphics.DrawString("Looking for testers, porting help, and contributors.", $smallFont, $muted, 104, 222)

$positions = @(
  @{ Path = "01-overview-chat-workspace.png"; X = 70; Y = 300; W = 710; H = 398 },
  @{ Path = "02-live-activity-tools-sources.png"; X = 820; Y = 300; W = 710; H = 398 },
  @{ Path = "03-toolbox-tool-toggles.png"; X = 70; Y = 744; W = 710; H = 398 },
  @{ Path = "04-local-settings-providers.png"; X = 820; Y = 744; W = 710; H = 398 }
)

foreach ($position in $positions) {
  $imagePath = Join-Path $outputDir $position.Path
  $image = [System.Drawing.Image]::FromFile($imagePath)
  try {
    $graphics.FillRectangle($panel, $position.X, $position.Y, $position.W, $position.H)
    $graphics.DrawRectangle($borderPen, $position.X, $position.Y, $position.W, $position.H)
    Draw-FitImage $graphics $image ($position.X + 10) ($position.Y + 10) ($position.W - 20) ($position.H - 20)
  } finally {
    $image.Dispose()
  }
}

$graphics.Dispose()
$canvas.Save($coverPath, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()

Write-Host "Wrote Reddit assets to $outputDir"
