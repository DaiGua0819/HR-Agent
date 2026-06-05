param(
  [int]$Port = 9222,
  [string]$ProfileDir = "",
  [string]$StartUrl = "about:blank",
  [string]$BrowserPath = ""
)

$ErrorActionPreference = "Stop"

$port = $Port
if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
  $profileDir = Join-Path $PSScriptRoot "cdp-browser-profile"
} else {
  $profileDir = $ProfileDir
}

function Test-CdpPort {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (Test-CdpPort) {
  Write-Host "CDP is already running at http://127.0.0.1:$port"
  exit 0
}

if ([string]::IsNullOrWhiteSpace($StartUrl)) {
  $StartUrl = "about:blank"
}

$candidates = @()
if (-not [string]::IsNullOrWhiteSpace($BrowserPath)) {
  $candidates += $BrowserPath
}
$candidates += @(
  "$env:USERPROFILE\.cloakbrowser\chromium-146.0.7680.177.4\chrome.exe",
  "$env:LOCALAPPDATA\CloakBrowser\CloakBrowser.exe",
  "$env:LOCALAPPDATA\Programs\CloakBrowser\CloakBrowser.exe",
  "$env:PROGRAMFILES\CloakBrowser\CloakBrowser.exe",
  "${env:PROGRAMFILES(X86)}\CloakBrowser\CloakBrowser.exe",
  "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe",
  "${env:PROGRAMFILES(X86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:PROGRAMFILES\Microsoft\Edge\Application\msedge.exe",
  "${env:PROGRAMFILES(X86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) }

if (-not $candidates.Count) {
  Write-Host "No CloakBrowser/Chrome/Edge executable was found automatically."
  Write-Host "Start your browser manually like this:"
  Write-Host "  `"browser.exe`" --remote-debugging-port=$port --user-data-dir=`"C:\path\to\profile`""
  exit 1
}

New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$browser = $candidates[0]
$args = @(
  "--remote-debugging-port=$port",
  "--remote-allow-origins=*",
  "--user-data-dir=$profileDir",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-session-crashed-bubble",
  "--disable-background-mode",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  $StartUrl
)

Start-Process -FilePath $browser -ArgumentList $args -WindowStyle Normal
Write-Host "Started: $browser"
Write-Host "Waiting for CDP at http://127.0.0.1:$port ..."

for ($i = 0; $i -lt 150; $i += 1) {
  Start-Sleep -Milliseconds 300
  if (Test-CdpPort) {
    Write-Host "CDP is ready. Now run:"
    Write-Host "& `"C:\Users\24471\Documents\New project\招聘智能体\.cloakbrowser-venv\Scripts\python.exe`" cloak_terminal_controller.py --cdp http://127.0.0.1:$port"
    exit 0
  }
}

Write-Host "Browser started, but CDP port $port is still not ready."
Write-Host "Make sure your browser supports --remote-debugging-port."
exit 1
