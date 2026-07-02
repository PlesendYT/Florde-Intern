Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 10, 10, 15))
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0,0)),
    (New-Object System.Drawing.Point(256,256)),
    [System.Drawing.Color]::FromArgb(255, 124, 58, 237),
    [System.Drawing.Color]::FromArgb(255, 59, 130, 246)
)
$g.FillRectangle($brush, 40, 40, 176, 176)
$font = New-Object System.Drawing.Font('Segoe UI', 72, [System.Drawing.FontStyle]::Bold)
$g.DrawString('F', $font, [System.Drawing.Brushes]::White, 70, 55)
$bmp.Save('config\icon\icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output 'PNG created'
