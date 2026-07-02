Add-Type -AssemblyName System.Drawing

function ConvertTo-Ico {
    param([string]$pngPath, [string]$icoPath)
    $png = [System.IO.File]::ReadAllBytes($pngPath)
    $fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
    $w = New-Object System.IO.BinaryWriter($fs)
    # ICO header
    $w.Write([byte]0); $w.Write([byte]0)  # reserved
    $w.Write([byte]1); $w.Write([byte]0)  # type = 1 (ICO)
    $w.Write([byte]1); $w.Write([byte]0)  # count = 1
    # Directory entry (using PNG data directly)
    $w.Write([byte]0)   # width (0=256)
    $w.Write([byte]0)   # height (0=256)
    $w.Write([byte]0)   # colors
    $w.Write([byte]0)   # reserved
    $w.Write([byte]1); $w.Write([byte]0)  # planes
    $w.Write([byte]32); $w.Write([byte]0) # bpp
    $w.Write([int]$png.Length)  # size
    $w.Write([int]22)           # offset (header 6 + dir 16 = 22)
    $w.Write($png)
    $w.Close()
    $fs.Close()
}

function ConvertTo-Bmp {
    param([string]$pngPath, [string]$bmpPath, [int]$w=164, [int]$h=314)
    $img = [System.Drawing.Image]::FromFile($pngPath)
    $bmp = New-Object System.Drawing.Bitmap($img, $w, $h)
    $bmp.Save($bmpPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bmp.Dispose()
    $img.Dispose()
}

$pngPath = Join-Path $PSScriptRoot "icon.png"

# Create ICO
$icoPath = Join-Path $PSScriptRoot "icon.ico"
ConvertTo-Ico -pngPath $pngPath -icoPath $icoPath
Write-Output "ICO created: $icoPath"

# Create BMP
$bmpPath = Join-Path $PSScriptRoot "installer-sidebar.bmp"
ConvertTo-Bmp -pngPath $pngPath -bmpPath $bmpPath
Write-Output "BMP created: $bmpPath"

Write-Output "Done"
