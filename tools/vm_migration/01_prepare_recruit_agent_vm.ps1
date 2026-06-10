param(
  [switch]$ForceExtract
)

$ErrorActionPreference = "Stop"

$BaseDir = "C:\Users\Public\Documents\RecruitAgent"
$ZipDir = "C:\Users\Public\Documents\RecruitAgentMigration"
$ProjectRoot = Join-Path $BaseDir "project"
$LogDir = Join-Path $BaseDir "logs"
New-Item -ItemType Directory -Force -Path $BaseDir, $LogDir | Out-Null

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

Write-Step "检查迁移 zip"
$zip = Get-ChildItem -LiteralPath $ZipDir -Filter "*.zip" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $zip) {
  throw "未找到迁移 zip：$ZipDir"
}
Write-Host "Zip: $($zip.FullName)"

if ((Test-ProjectRoot $ProjectRoot) -and -not $ForceExtract) {
  Write-Step "项目目录已存在，跳过解压"
  Write-Host "ProjectRoot: $ProjectRoot"
} else {
  Write-Step "本地解压迁移包"
  $extractRoot = Join-Path $BaseDir ("zip_extract_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $zip.FullName -DestinationPath $extractRoot -Force

  $extractedProject = Get-ChildItem -LiteralPath $extractRoot -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-ProjectRoot $_.FullName } |
    Select-Object -First 1
  if (-not $extractedProject) {
    throw "解压完成，但没有找到项目目录。ExtractRoot: $extractRoot"
  }

  if (Test-Path $ProjectRoot) {
    $backupProject = Join-Path $BaseDir ("project_smb_backup_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
    Rename-Item -LiteralPath $ProjectRoot -NewName (Split-Path $backupProject -Leaf)
    Write-Host "旧 project 已改名为：$backupProject"
  }

  Move-Item -LiteralPath $extractedProject.FullName -Destination $ProjectRoot
  Write-Host "ProjectRoot: $ProjectRoot"
}

Write-Step "检查运行环境"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Write-Host "Node: $($node.Source)"
  & node --version
} else {
  Write-Host "未找到 Node.js。请安装 Node.js 22+ 后再启动。"
}

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
  Write-Host "Python: $($python.Source)"
  & python --version
} else {
  Write-Host "未找到 Python。请安装 Python 后再启动。"
}

Write-Step "检查关键文件"
$required = @(
  "browser_agent.env",
  "patchwork-recruit-gpt\email_config.json",
  "patchwork-recruit-gpt\data",
  "external-recruit-data\招聘智能体\data",
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
    Write-Host "[缺失] $relative"
  }
}

Write-Step "完成"
Write-Host "下一步运行："
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$ProjectRoot\start_recruit_agent_vm.ps1`" -PublicWeb"
Write-Host ""
Write-Host "VM 内访问： http://127.0.0.1:8765/index.html"
Write-Host "本机访问：  http://192.168.254.102:8765/index.html"
