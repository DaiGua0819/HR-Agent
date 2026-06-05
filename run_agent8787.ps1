$ErrorActionPreference = "Stop"

$workspace = Join-Path $env:USERPROFILE "Documents\Codex\2026-05-19\c-users-24471-documents-new-project"
$projectName = -join ([char]0x62db, [char]0x8058, [char]0x667a, [char]0x80fd, [char]0x4f53)
$project = Join-Path $env:USERPROFILE ("Documents\New project\" + $projectName)
$python = Join-Path $project ".cloakbrowser-venv\Scripts\python.exe"
$server = Join-Path $workspace "agent_web_server.py"
$log = Join-Path $workspace "agent_web_server.runtime.log"

Set-Location -LiteralPath $workspace
& $python $server *> $log
