[CmdletBinding()]
param(
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '..\build\icon' }

function New-RoundedRectanglePath {
  param([System.Drawing.RectangleF]$Rectangle, [float]$Radius)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-DreamSkinBitmap {
  param([int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.ScaleTransform($Size / 1024.0, $Size / 1024.0)

    $tileRectangle = New-Object System.Drawing.RectangleF(64, 64, 896, 896)
    $tilePath = New-RoundedRectanglePath -Rectangle $tileRectangle -Radius 210
    $tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.PointF(120, 80)),
      (New-Object System.Drawing.PointF(920, 950)),
      ([System.Drawing.ColorTranslator]::FromHtml('#121722')),
      ([System.Drawing.ColorTranslator]::FromHtml('#25162D'))
    )
    $graphics.FillPath($tileBrush, $tilePath)

    $innerRectangle = New-Object System.Drawing.RectangleF(83, 83, 858, 858)
    $innerPath = New-RoundedRectanglePath -Rectangle $innerRectangle -Radius 192
    $rimPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(82, 177, 205, 255), 5)
    $graphics.DrawPath($rimPen, $innerPath)

    $dPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $dPath.StartFigure()
    $dPath.AddLine(335, 255, 335, 770)
    $dPath.AddBezier(335, 770, 650, 815, 780, 625, 780, 510)
    $dPath.AddBezier(780, 510, 780, 385, 650, 215, 335, 255)

    $sPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $sPath.StartFigure()
    $sPath.AddBezier(710, 302, 605, 215, 420, 240, 408, 390)
    $sPath.AddBezier(408, 390, 396, 525, 684, 460, 690, 615)
    $sPath.AddBezier(690, 615, 696, 770, 470, 820, 320, 704)

    $dGlow = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(44, 48, 196, 255), 166)
    $dGlow.StartCap = $dGlow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $dGlow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($dGlow, $dPath)

    $sGlow = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(42, 255, 55, 181), 158)
    $sGlow.StartCap = $sGlow.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $sGlow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($sGlow, $sPath)

    $dBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.PointF(290, 230)),
      (New-Object System.Drawing.PointF(805, 790)),
      ([System.Drawing.ColorTranslator]::FromHtml('#32D7FF')),
      ([System.Drawing.ColorTranslator]::FromHtml('#8B46FF'))
    )
    $dPen = New-Object System.Drawing.Pen($dBrush, 104)
    $dPen.StartCap = $dPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $dPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($dPen, $dPath)

    $sBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.PointF(710, 260)),
      (New-Object System.Drawing.PointF(330, 760)),
      ([System.Drawing.ColorTranslator]::FromHtml('#FF4FA8')),
      ([System.Drawing.ColorTranslator]::FromHtml('#8D42FF'))
    )
    $sPen = New-Object System.Drawing.Pen($sBrush, 92)
    $sPen.StartCap = $sPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $sPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($sPen, $sPath)

    $highlightPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(118, 255, 255, 255), 13)
    $highlightPen.StartCap = $highlightPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawPath($highlightPen, $dPath)

    $sparkle = New-Object System.Drawing.Drawing2D.GraphicsPath
    $sparkle.AddPolygon([System.Drawing.PointF[]]@(
      (New-Object System.Drawing.PointF(528, 442)),
      (New-Object System.Drawing.PointF(548, 493)),
      (New-Object System.Drawing.PointF(602, 514)),
      (New-Object System.Drawing.PointF(548, 535)),
      (New-Object System.Drawing.PointF(528, 590)),
      (New-Object System.Drawing.PointF(508, 535)),
      (New-Object System.Drawing.PointF(454, 514)),
      (New-Object System.Drawing.PointF(508, 493))
    ))
    $sparkleGlow = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(105, 98, 223, 255), 34)
    $sparkleGlow.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($sparkleGlow, $sparkle)
    $sparkleBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.PointF(490, 460)),
      (New-Object System.Drawing.PointF(560, 570)),
      [System.Drawing.Color]::White,
      ([System.Drawing.ColorTranslator]::FromHtml('#A8F4FF'))
    )
    $graphics.FillPath($sparkleBrush, $sparkle)

    foreach ($item in @($sparkleBrush, $sparkleGlow, $sparkle, $highlightPen, $sPen, $sBrush, $dPen, $dBrush, $sGlow, $dGlow, $sPath, $dPath, $rimPen, $innerPath, $tileBrush, $tilePath)) {
      if ($null -ne $item) { $item.Dispose() }
    }
  } finally {
    $graphics.Dispose()
  }
  return $bitmap
}

function Convert-BitmapToPngBytes {
  param([System.Drawing.Bitmap]$Bitmap)
  $stream = New-Object System.IO.MemoryStream
  try {
    $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return ,$stream.ToArray()
  } finally {
    $stream.Dispose()
  }
}

function Write-MultiSizeIcon {
  param([string]$Path, [int[]]$Sizes)
  $images = New-Object 'System.Collections.Generic.List[byte[]]'
  foreach ($size in $Sizes) {
    $bitmap = New-DreamSkinBitmap -Size $size
    try { $images.Add([byte[]](Convert-BitmapToPngBytes -Bitmap $bitmap)) } finally { $bitmap.Dispose() }
  }

  $stream = [System.IO.File]::Create($Path)
  $writer = New-Object System.IO.BinaryWriter($stream)
  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$Sizes.Count)
    $offset = 6 + (16 * $Sizes.Count)
    for ($i = 0; $i -lt $Sizes.Count; $i++) {
      $dimension = if ($Sizes[$i] -ge 256) { 0 } else { $Sizes[$i] }
      $writer.Write([byte]$dimension)
      $writer.Write([byte]$dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$images[$i].Length)
      $writer.Write([uint32]$offset)
      $offset += $images[$i].Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image) }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($resolvedOutput) | Out-Null
$pngPath = Join-Path $resolvedOutput 'CodexDreamSkinManager-icon.png'
$icoPath = Join-Path $resolvedOutput 'CodexDreamSkinManager.ico'

$source = New-DreamSkinBitmap -Size 1024
try { $source.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $source.Dispose() }
Write-MultiSizeIcon -Path $icoPath -Sizes @(16, 24, 32, 48, 64, 128, 256)

[pscustomobject]@{
  Png = $pngPath
  Icon = $icoPath
  Sizes = '16,24,32,48,64,128,256'
}
