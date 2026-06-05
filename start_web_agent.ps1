$ErrorActionPreference = "Stop"
$Log = Join-Path $PSScriptRoot "start_web_agent.log"
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] start script" | Out-File -FilePath $Log -Encoding utf8 -Append

$ProjectRoot = Join-Path $env:USERPROFILE "Documents\New project"
$Python = Get-ChildItem -Path $ProjectRoot -Filter python.exe -Recurse |
  Where-Object { $_.FullName -like "*\.cloakbrowser-venv\Scripts\python.exe" } |
  Select-Object -First 1

if (-not $Python) {
  "Cannot find python under $ProjectRoot" | Out-File -FilePath $Log -Encoding utf8 -Append
  throw "Cannot find .cloakbrowser-venv\Scripts\python.exe under $ProjectRoot"
}

$Script = Join-Path $PSScriptRoot "agent_web_server.py"
$EnvFile = Join-Path $PSScriptRoot "browser_agent.env"
$DotEnvFile = Join-Path $PSScriptRoot ".env"
if (-not $env:DASHSCOPE_API_KEY -and -not (Test-Path $EnvFile) -and -not (Test-Path $DotEnvFile)) {
  Write-Host ""
  Write-Host "Missing DASHSCOPE_API_KEY."
  Write-Host "Create one of these files before using model-powered chat:"
  Write-Host "  $EnvFile"
  Write-Host "  $DotEnvFile"
  Write-Host ""
  Write-Host "File content example:"
  Write-Host "  DASHSCOPE_API_KEY=your_key_here"
  Write-Host ""
}
"Python: $($Python.FullName)" | Out-File -FilePath $Log -Encoding utf8 -Append
"Script: $Script" | Out-File -FilePath $Log -Encoding utf8 -Append
Write-Host "Starting web agent with: $($Python.FullName)"
Write-Host "Open: http://127.0.0.1:8787"
Write-Host "Keep this PowerShell window open while using the web agent."
try {
  & $Python.FullName -u $Script 2>&1 | Tee-Object -FilePath $Log -Append
} catch {
  "ERROR: $($_.Exception.Message)" | Out-File -FilePath $Log -Encoding utf8 -Append
  throw
}
