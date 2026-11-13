# Локальный сервер Hub: распаковывает hub-repo.zip в папку "Сайт" и открывает сайт в браузере.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$zip = Join-Path $here 'hub-repo.zip'
$site = Join-Path $here 'Сайт'
$stamp = Join-Path $site '.zipstamp'
$zt = (Get-Item $zip).LastWriteTime.ToString('o')
if (-not (Test-Path $stamp) -or ((Get-Content $stamp -Raw).Trim() -ne $zt)) {
  Write-Host 'Распаковываю сайт...'
  if (Test-Path $site) { Remove-Item $site -Recurse -Force }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $site)
  Set-Content -Path $stamp -Value $zt
}
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
  '.json'='application/json; charset=utf-8'; '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg';
  '.ico'='image/x-icon'; '.webmanifest'='application/manifest+json'; '.txt'='text/plain; charset=utf-8';
  '.woff2'='font/woff2'; '.woff'='font/woff'; '.mp3'='audio/mpeg'; '.wav'='audio/wav' }
$port = 8765
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
$l.Start()
Write-Host "Сайт: http://localhost:$port/artem.html  (закрой это окно, чтобы остановить)"
Start-Process "http://localhost:$port/artem.html"
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath)
    if ($p.EndsWith('/')) { $p += 'index.html' }
    $f = [System.IO.Path]::GetFullPath((Join-Path $site $p.TrimStart('/').Replace('/', '\')))
    if ($f.StartsWith($site) -and (Test-Path $f -PathType Leaf)) {
      $b = [System.IO.File]::ReadAllBytes($f)
      $ext = [System.IO.Path]::GetExtension($f).ToLower()
      $c.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
      $c.Response.ContentLength64 = $b.Length
      $c.Response.OutputStream.Write($b, 0, $b.Length)
    } else { $c.Response.StatusCode = 404 }
  } catch { $c.Response.StatusCode = 500 }
  $c.Response.Close()
}
