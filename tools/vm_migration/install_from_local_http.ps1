param(
  [string]$BaseUrl = "http://192.168.254.227:8899",
  [string]$InstallRoot = "C:\Users\Public\Documents\RecruitAgent",
  [switch]$ForceDownload,
  [switch]$SkipStart
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message =="
}

function Test-ProjectRoot {
  param([string]$Path)
  return (
    (Test-Path (Join-Path $Path "patchwork-recruit-gpt\server.js")) -and
    (Test-Path (Join-Path $Path "agent_web_server.py")) -and
    (Test-Path (Join-Path $Path "start_recruit_agent_vm.ps1"))
  )
}

$MigrationDir = Join-Path $InstallRoot "migration"
$ZipPath = Join-Path $MigrationDir "migration.zip"
$ExtractRootBase = Join-Path $InstallRoot "extract"
$ExtractRoot = Join-Path $InstallRoot ("extract_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
$ProjectRoot = Join-Path $InstallRoot "project"

New-Item -ItemType Directory -Force -Path $MigrationDir | Out-Null

Write-Step "Check local HTTP server"
$healthUrl = "$BaseUrl/health.txt"
try {
  $health = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 10
  Write-Host "HTTP OK: $($health.Content.Trim())"
} catch {
  throw "Cannot access $healthUrl. Check local HTTP server, firewall, and VM network. Error: $($_.Exception.Message)"
}

Write-Step "Download migration zip"
$zipUrl = "$BaseUrl/migration.zip"
$remoteLength = 0
try {
  $head = Invoke-WebRequest -Uri $zipUrl -Method Head -UseBasicParsing -TimeoutSec 10
  $remoteLength = [int64]($head.Headers["Content-Length"] | Select-Object -First 1)
} catch {
  Write-Host "Could not read remote zip size, continuing with local size check."
}

$useExistingZip = $false
if ((-not $ForceDownload) -and (Test-Path $ZipPath)) {
  $existingZip = Get-Item -LiteralPath $ZipPath
  if (($remoteLength -gt 0 -and $existingZip.Length -eq $remoteLength) -or ($remoteLength -eq 0 -and $existingZip.Length -gt 2000000000)) {
    $useExistingZip = $true
    Write-Host "Use existing zip: $ZipPath"
  }
}

if (-not $useExistingZip) {
  Invoke-WebRequest -Uri $zipUrl -OutFile $ZipPath -UseBasicParsing
}
$zipItem = Get-Item -LiteralPath $ZipPath
Write-Host "Zip: $ZipPath"
Write-Host ("Size: {0:N2} GB" -f ($zipItem.Length / 1GB))

Write-Step "Extract locally inside VM"
$oldExtractDirs = @()
if (Test-Path $ExtractRootBase) {
  $oldExtractDirs += $ExtractRootBase
}
$oldExtractDirs += Get-ChildItem -LiteralPath $InstallRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "extract_*" } |
  ForEach-Object { $_.FullName }
foreach ($oldDir in $oldExtractDirs) {
  try {
    Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Host "Could not remove old extract dir, skipping: $oldDir"
  }
}
New-Item -ItemType Directory -Force -Path $ExtractRoot | Out-Null
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if (-not $tar) {
  throw "tar.exe was not found. Install Windows tar support or use PowerShell 7."
}
& $tar.Source -xf $ZipPath -C $ExtractRoot
if ($LASTEXITCODE -ne 0) {
  throw "tar.exe extraction failed with exit code $LASTEXITCODE"
}

$extractedProject = Get-ChildItem -LiteralPath $ExtractRoot -Recurse -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-ProjectRoot $_.FullName } |
  Select-Object -First 1
if (-not $extractedProject) {
  throw "Extraction finished, but project root was not found. ExtractRoot: $ExtractRoot"
}

Write-Step "Install project directory"
if (Test-Path $ProjectRoot) {
  $backup = Join-Path $InstallRoot ("project_backup_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
  Rename-Item -LiteralPath $ProjectRoot -NewName (Split-Path $backup -Leaf)
  Write-Host "Old project renamed to: $backup"
}
Move-Item -LiteralPath $extractedProject.FullName -Destination $ProjectRoot
Write-Host "ProjectRoot: $ProjectRoot"

Write-Step "Refresh VM helper scripts"
try {
  Invoke-WebRequest -Uri "$BaseUrl/start_recruit_agent_vm.ps1" -OutFile (Join-Path $ProjectRoot "start_recruit_agent_vm.ps1") -UseBasicParsing -TimeoutSec 20
  Write-Host "Updated start_recruit_agent_vm.ps1"
} catch {
  Write-Host "Could not update start script from HTTP server: $($_.Exception.Message)"
}

Write-Step "Check Node and Python"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Write-Host "Node: $($node.Source)"
  & node --version
} else {
  Write-Host "Node.js not found. Install Node.js 22+ before starting services."
}

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
  Write-Host "Python: $($python.Source)"
  & python --version
} else {
  Write-Host "Python not found. Install Python before starting services."
}

Write-Step "Check key migration files"
$required = @(
  "browser_agent.env",
  "patchwork-recruit-gpt\email_config.json",
  "patchwork-recruit-gpt\data",
  "cdp-browser-profile",
  "cdp-browser-profile-boss-b",
  "cdp-browser-profile-51job",
  "cdp-browser-profile-51job-boss-b",
  "cdp-browser-profile-zhilian",
  "cdp-browser-profile-zhilian-boss-b",
  "cloakbrowser-runtime"
)
foreach ($relative in $required) {
  $path = Join-Path $ProjectRoot $relative
  if (Test-Path $path) {
    Write-Host "[OK] $relative"
  } else {
    Write-Host "[MISSING] $relative"
  }
}

if (-not $SkipStart) {
  Write-Step "Start recruit agent services"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ProjectRoot "start_recruit_agent_vm.ps1") -PublicWeb
  Start-Sleep -Seconds 5
  Start-Process "http://127.0.0.1:8765/index.html"
}

Write-Step "Done"
Write-Host "VM local URL: http://127.0.0.1:8765/index.html"
Write-Host "LAN URL: http://<VM-IP>:8765/index.html"
