param(
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\src-tauri\windows")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-Color {
  param([string]$Hex)

  return [System.Drawing.ColorTranslator]::FromHtml($Hex)
}

function New-SolidBrush {
  param([string]$Hex)

  return [System.Drawing.SolidBrush]::new((New-Color $Hex))
}

function New-Pen {
  param(
    [string]$Hex,
    [float]$Width = 1
  )

  return [System.Drawing.Pen]::new((New-Color $Hex), $Width)
}

function New-RoundedPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Fill-RoundedRect {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Color,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $brush = New-SolidBrush $Color
  $path = New-RoundedPath $X $Y $Width $Height $Radius
  $Graphics.FillPath($brush, $path)
  $path.Dispose()
  $brush.Dispose()
}

function Stroke-RoundedRect {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Color,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius,
    [float]$StrokeWidth = 1
  )

  $pen = New-Pen $Color $StrokeWidth
  $path = New-RoundedPath $X $Y $Width $Height $Radius
  $Graphics.DrawPath($pen, $path)
  $path.Dispose()
  $pen.Dispose()
}

function Draw-Text {
  param(
    [System.Drawing.Graphics]$Graphics,
    [string]$Text,
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Size,
    [string]$Color,
    [string]$Style = "Regular",
    [System.Drawing.StringAlignment]$Alignment = [System.Drawing.StringAlignment]::Near
  )

  $fontStyle = [System.Enum]::Parse([System.Drawing.FontStyle], $Style)
  $font = [System.Drawing.Font]::new("Segoe UI", $Size, $fontStyle, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-SolidBrush $Color
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = $Alignment
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $rect = [System.Drawing.RectangleF]::new($X, $Y, $Width, $Height)
  $Graphics.DrawString($Text, $font, $brush, $rect, $format)
  $format.Dispose()
  $brush.Dispose()
  $font.Dispose()
}

function Draw-Mark {
  param(
    [System.Drawing.Graphics]$Graphics,
    [float]$X,
    [float]$Y,
    [float]$Size
  )

  Fill-RoundedRect $Graphics "#0E1726" $X $Y $Size $Size 8
  Stroke-RoundedRect $Graphics "#C7D2FE" $X $Y $Size $Size 8 1

  $nodeBrush = New-SolidBrush "#8B5CF6"
  $accentBrush = New-SolidBrush "#21C7A8"
  $warmBrush = New-SolidBrush "#F2B84B"
  $linePen = New-Pen "#E8EEF7" 2

  $Graphics.DrawLine($linePen, $X + ($Size * 0.30), $Y + ($Size * 0.34), $X + ($Size * 0.68), $Y + ($Size * 0.46))
  $Graphics.DrawLine($linePen, $X + ($Size * 0.40), $Y + ($Size * 0.70), $X + ($Size * 0.68), $Y + ($Size * 0.46))
  $Graphics.FillEllipse($nodeBrush, $X + ($Size * 0.20), $Y + ($Size * 0.22), $Size * 0.22, $Size * 0.22)
  $Graphics.FillEllipse($accentBrush, $X + ($Size * 0.58), $Y + ($Size * 0.36), $Size * 0.22, $Size * 0.22)
  $Graphics.FillEllipse($warmBrush, $X + ($Size * 0.30), $Y + ($Size * 0.60), $Size * 0.22, $Size * 0.22)

  $linePen.Dispose()
  $warmBrush.Dispose()
  $accentBrush.Dispose()
  $nodeBrush.Dispose()
}

function New-InstallerSidebar {
  $bitmap = [System.Drawing.Bitmap]::new(164, 314, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $top = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    ([System.Drawing.Rectangle]::new(0, 0, 164, 314)),
    (New-Color "#F8FAFC"),
    (New-Color "#0B1220"),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
  )
  $graphics.FillRectangle($top, 0, 0, 164, 314)
  $top.Dispose()

  Fill-RoundedRect $graphics "#FFFFFF" 14 16 136 112 10
  Stroke-RoundedRect $graphics "#D9E2F0" 14 16 136 112 10 1
  Fill-RoundedRect $graphics "#EEF4FF" 26 32 66 9 4
  Fill-RoundedRect $graphics "#21C7A8" 26 50 92 7 3
  Fill-RoundedRect $graphics "#8B5CF6" 26 64 74 7 3
  Fill-RoundedRect $graphics "#F2B84B" 26 78 48 7 3
  Draw-Text $graphics "Light" 26 98 80 20 13 "#172033" "Bold"

  Fill-RoundedRect $graphics "#0E1726" 14 150 136 136 12
  Stroke-RoundedRect $graphics "#314157" 14 150 136 136 12 1
  Draw-Mark $graphics 28 168 42
  Draw-Text $graphics "Gilbert" 26 222 108 22 16 "#F8FAFC" "Bold"
  Draw-Text $graphics "Codex" 26 244 108 22 16 "#B9C6DA" "Bold"
  Draw-Text $graphics "Dark ready" 26 268 108 18 11 "#21C7A8" "Regular"

  $graphics.Dispose()
  return $bitmap
}

function New-InstallerHeader {
  $bitmap = [System.Drawing.Bitmap]::new(150, 57, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    ([System.Drawing.Rectangle]::new(0, 0, 150, 57)),
    (New-Color "#FFFFFF"),
    (New-Color "#EAF1F8"),
    [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal
  )
  $graphics.FillRectangle($background, 0, 0, 150, 57)
  $background.Dispose()

  Fill-RoundedRect $graphics "#0E1726" 96 7 42 42 9
  Fill-RoundedRect $graphics "#21C7A8" 104 17 10 10 5
  Fill-RoundedRect $graphics "#8B5CF6" 120 17 10 10 5
  Fill-RoundedRect $graphics "#F2B84B" 112 31 10 10 5
  Draw-Text $graphics "Gilbert Codex" 8 8 86 18 12 "#172033" "Bold"
  Draw-Text $graphics "Light + dark" 8 28 86 16 10 "#58677D" "Regular"

  $graphics.Dispose()
  return $bitmap
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$sidebarPath = Join-Path $OutputDir "installer-sidebar.bmp"
$headerPath = Join-Path $OutputDir "installer-header.bmp"

$sidebar = New-InstallerSidebar
$sidebar.Save($sidebarPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$sidebar.Dispose()

$header = New-InstallerHeader
$header.Save($headerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$header.Dispose()

Write-Host "Generated installer assets:"
Write-Host "  $sidebarPath"
Write-Host "  $headerPath"
