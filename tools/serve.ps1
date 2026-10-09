# ==========================================================================
# serve.ps1 -- zero-dependency static file server for local preview
#
#   Why not "python -m http.server"?
#   On Windows the PATH usually resolves `python` to the Microsoft Store stub
#   (C:\Users\<you>\AppData\Local\Microsoft\WindowsApps\python.exe). That stub
#   is not a real interpreter: it either opens the Store or exits silently,
#   which is exactly why double-clicking a .cmd launcher appeared to do nothing.
#   PowerShell is part of Windows itself, so this server always runs.
#
#   Usage:  powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 8321
# ==========================================================================
param(
  [int]$Port = 8321,
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  # tools\serve.ps1 -> project root is the parent of this script's folder
  $Root = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
  Write-Host "[ERROR] Root folder not found: $Root" -ForegroundColor Red
  exit 1
}
$Root = (Resolve-Path -LiteralPath $Root).Path

$mime = @{
  ".html"  = "text/html; charset=utf-8"
  ".htm"   = "text/html; charset=utf-8"
  ".css"   = "text/css; charset=utf-8"
  ".js"    = "application/javascript; charset=utf-8"
  ".mjs"   = "application/javascript; charset=utf-8"
  ".json"  = "application/json; charset=utf-8"
  ".map"   = "application/json; charset=utf-8"
  ".svg"   = "image/svg+xml"
  ".png"   = "image/png"
  ".jpg"   = "image/jpeg"
  ".jpeg"  = "image/jpeg"
  ".gif"   = "image/gif"
  ".webp"  = "image/webp"
  ".ico"   = "image/x-icon"
  ".woff"  = "font/woff"
  ".woff2" = "font/woff2"
  ".ttf"   = "font/ttf"
  ".txt"   = "text/plain; charset=utf-8"
  ".md"    = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
# Both loopback prefixes are registered so that http://127.0.0.1:PORT and
# http://localhost:PORT work. A machine-wide prefix ("http://+:PORT/") would
# need an elevated URL ACL, so it is deliberately avoided.
foreach ($hostName in @("localhost", "127.0.0.1")) {
  $prefix = "http://{0}:{1}/" -f $hostName, $Port
  try {
    $listener.Prefixes.Add($prefix)
  } catch {
    Write-Host "[WARN] Cannot register prefix $prefix : $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

try {
  $listener.Start()
} catch {
  Write-Host "[ERROR] Cannot listen on port $Port : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "        Another program may be using the port. Try: start-server.cmd 8322"
  exit 1
}

Write-Host "Root : $Root"
Write-Host "URL  : http://127.0.0.1:$Port/index.html"
Write-Host "Stop : press Ctrl+C in this window"
Write-Host ""

while ($listener.IsListening) {
  $ctx = $null
  try { $ctx = $listener.GetContext() } catch { break }

  $res = $ctx.Response
  $status = 200
  $bytes = $null
  $ctype = "application/octet-stream"
  $path = $ctx.Request.Url.AbsolutePath

  try {
    $rel = [System.Uri]::UnescapeDataString($path).TrimStart('/')
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root ($rel -replace '/', '\')))

    if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $status = 403
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
      $ctype = "text/plain; charset=utf-8"
    } elseif (Test-Path -LiteralPath $full -PathType Container) {
      $idx = Join-Path $full 'index.html'
      if (Test-Path -LiteralPath $idx -PathType Leaf) { $full = $idx } else { $full = $null }
      if (-not $full) {
        $status = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
        $ctype = "text/plain; charset=utf-8"
      }
    }

    if ($status -eq 200) {
      if (Test-Path -LiteralPath $full -PathType Leaf) {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        if ($mime.ContainsKey($ext)) { $ctype = $mime[$ext] }
      } else {
        $status = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
        $ctype = "text/plain; charset=utf-8"
      }
    }
  } catch {
    $status = 500
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("500 " + $_.Exception.Message)
    $ctype = "text/plain; charset=utf-8"
  }

  try {
    $res.StatusCode = $status
    $res.ContentType = $ctype
    $res.Headers.Add("Cache-Control", "no-store")
    $res.KeepAlive = $false
    if ($bytes) {
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.ContentLength64 = 0
    }
  } catch {
    # client went away; nothing to do
  }

  try { $res.OutputStream.Close() } catch {}
  try { $res.Close() } catch {}

  if ($status -ne 200) {
    Write-Host ("  {0}  {1}" -f $status, $path)
  }
}
