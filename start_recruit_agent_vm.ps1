param(
  [switch]$PublicWeb,
  [string]$PythonPath = "",
  [string]$NodeCommand = "node"
)

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$FrontendRoot = Join-Path $ProjectRoot "patchwork-recruit-gpt"
$ExternalDataRoot = Join-Path $ProjectRoot "external-recruit-data"
$LogDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Find-ExternalRecruitRoot {
  param([string]$Root)
  if (-not (Test-Path $Root)) {
    return ""
  }
  $candidate = Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue |
    Where-Object {
      (Test-Path (Join-Path $_.FullName "data")) -or
      (Test-Path (Join-Path $_.FullName "51-resumes")) -or
      (Test-Path (Join-Path $_.FullName "recruiter-resumes"))
    } |
    Select-Object -First 1
  if ($candidate) {
    return $candidate.FullName
  }
  return ""
}

function Test-PythonExe {
  param([string]$ExePath)
  if (-not $ExePath) {
    return $false
  }
  if ($ExePath -match "\\WindowsApps\\") {
    return $false
  }
  if (-not (Test-Path $ExePath)) {
    return $false
  }
  try {
    $version = & $ExePath --version 2>&1
    return ($LASTEXITCODE -eq 0 -and [string]$version -match "Python")
  } catch {
    return $false
  }
}

function Resolve-PythonExe {
  param([string]$PreferredPath)

  $candidates = @()
  if ($PreferredPath) {
    $candidates += $PreferredPath
  }
  $candidates += @(
    "C:\Python314\python.exe",
    "C:\Python313\python.exe",
    "C:\Python312\python.exe",
    "C:\Python311\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
    "$env:ProgramFiles\Python314\python.exe",
    "$env:ProgramFiles\Python313\python.exe",
    "$env:ProgramFiles\Python312\python.exe",
    "$env:ProgramFiles\Python311\python.exe"
  )

  foreach ($commandName in @("python.exe", "python3.exe")) {
    try {
      $commands = Get-Command $commandName -All -ErrorAction SilentlyContinue
      foreach ($command in $commands) {
        if ($command.Source) {
          $candidates += $command.Source
        }
      }
    } catch {
      # Best-effort discovery.
    }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (Test-PythonExe $candidate) {
      return $candidate
    }
  }

  try {
    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyLauncher -and $pyLauncher.Source -and ($pyLauncher.Source -notmatch "\\WindowsApps\\")) {
      $resolved = & $pyLauncher.Source -3 -c "import sys; print(sys.executable)" 2>$null
      if ($LASTEXITCODE -eq 0 -and (Test-PythonExe ([string]$resolved).Trim())) {
        return ([string]$resolved).Trim()
      }
    }
  } catch {
    # Best-effort discovery.
  }

  throw "Cannot find a real Python executable. Install Python 3.12+ from python.org, then rerun this script. Do not use the WindowsApps Microsoft Store alias."
}

$PythonPath = Resolve-PythonExe $PythonPath
Write-Host "Python selected: $PythonPath"

try {
  & $PythonPath -c "import playwright.sync_api" 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "missing"
  }
} catch {
  Write-Host "Python package missing: playwright"
  Write-Host "Run this in the VM, then rerun this script:"
  Write-Host "  & `"$PythonPath`" -m pip install playwright"
  throw "Missing Python dependency: playwright"
}

function Quote-PowerShellLiteral {
  param([string]$Value)
  return "'" + ($Value -replace "'", "''") + "'"
}

function Start-ProjectProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [hashtable]$Environment = @{},
    [string]$WorkingDirectory = $ProjectRoot
  )

  $logPath = Join-Path $LogDir "$Name.log"
  $commands = @('$ErrorActionPreference = "Stop"')
  $commands += 'Remove-Item Env:\PYTHONHOME -ErrorAction SilentlyContinue'
  $commands += 'Remove-Item Env:\PYTHONPATH -ErrorAction SilentlyContinue'
  foreach ($key in $Environment.Keys) {
    $commands += ('$env:{0} = {1}' -f $key, (Quote-PowerShellLiteral ([string]$Environment[$key])))
  }
  $commands += ('Set-Location {0}' -f (Quote-PowerShellLiteral $WorkingDirectory))
  $quotedArgs = @($ArgumentList | ForEach-Object { Quote-PowerShellLiteral ([string]$_) })
  $commands += ('& {0} {1} *>> {2}' -f (Quote-PowerShellLiteral $FilePath), ($quotedArgs -join " "), (Quote-PowerShellLiteral $logPath))
  $command = $commands -join "; "

  Start-Process `
    -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden | Out-Null
}

$webHost = if ($PublicWeb) { "0.0.0.0" } else { "127.0.0.1" }
$frontendEnv = @{
  WEB_HOST = $webHost
  PORT = "8765"
}

$ExternalRoot = Find-ExternalRecruitRoot $ExternalDataRoot
if ($ExternalRoot) {
  $frontendEnv["JOB51_RESUMES_DIR"] = Join-Path $ExternalRoot "51-resumes"
  $frontendEnv["ZHILIAN_RESUMES_ROOT_DIR"] = Join-Path $ExternalRoot "recruiter-resumes"
  $frontendEnv["ZHILIAN_RESUMES_DIR"] = Join-Path $ExternalRoot "recruiter-resumes"
  $frontendEnv["EXTERNAL_ANALYZED_RESUME_DB_PATH"] = Join-Path $ExternalRoot "data\resumes.sqlite"
  $frontendEnv["EXTERNAL_ANALYZED_RESUME_JSON_PATH"] = Join-Path $ExternalRoot "data\resumes.json"
}

Start-ProjectProcess `
  -Name "web-8765" `
  -FilePath $NodeCommand `
  -ArgumentList @("server.js") `
  -Environment $frontendEnv `
  -WorkingDirectory $FrontendRoot

$agents = @(
  @{ Name = "agent-8787-boss-a"; Port = "8787" },
  @{ Name = "agent-8788-boss-b"; Port = "8788" },
  @{ Name = "agent-8789-51job-a"; Port = "8789" },
  @{ Name = "agent-8790-zhilian-a"; Port = "8790" },
  @{ Name = "agent-8791-51job-b"; Port = "8791" },
  @{ Name = "agent-8792-zhilian-b"; Port = "8792" }
)

foreach ($agent in $agents) {
  Start-ProjectProcess `
    -Name $agent.Name `
    -FilePath $PythonPath `
    -ArgumentList @("-u", "agent_web_server.py") `
    -Environment @{ AGENT_WEB_PORT = $agent.Port } `
    -WorkingDirectory $ProjectRoot
}

Write-Host "Started Web and six Agent services."
Write-Host "VM local URL: http://127.0.0.1:8765/index.html"
if ($PublicWeb) {
  Write-Host "LAN URL: http://<VM-IP>:8765/index.html"
}
