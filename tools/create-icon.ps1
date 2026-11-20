[CmdletBinding()]
param(
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '..\build\icon' }

function New-DreamSkinBitmap {
  param([System.Drawing.Image]$Source, [int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($Source, 0, 0, $Size, $Size)
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
  param([string]$Path, [int[]]$Sizes, [System.Drawing.Image]$Source)
  $images = New-Object 'System.Collections.Generic.List[byte[]]'
  foreach ($size in $Sizes) {
    $bitmap = New-DreamSkinBitmap -Source $Source -Size $size
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

$sourcePath = Join-Path $PSScriptRoot '..\assets\branding\dream-skin.png'
$source = [System.Drawing.Image]::FromFile([System.IO.Path]::GetFullPath($sourcePath))
try {
  $source.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-MultiSizeIcon -Path $icoPath -Sizes @(16, 24, 32, 48, 64, 128, 256) -Source $source
} finally { $source.Dispose() }

[pscustomobject]@{
  Png = $pngPath
  Icon = $icoPath
  Sizes = '16,24,32,48,64,128,256'
}
