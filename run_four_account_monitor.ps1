param(
  [int]$PollSeconds = 120,
  [int]$UnreadMax = 40,
  [int]$ProactiveMax = 5,
  [switch]$Once
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$BossA = "http://127.0.0.1:8787"
$BossB = "http://127.0.0.1:8788"
$LogPath = Join-Path $PSScriptRoot "four_account_monitor.log"

function Write-MonitorLog {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Invoke-AgentJson {
  param(
    [string]$Base,
    [string]$Path,
    [hashtable]$Body,
    [int]$TimeoutSec = 900
  )
  $uri = "$Base$Path"
  try {
    $json = $Body | ConvertTo-Json -Depth 24 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $result = Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec $TimeoutSec
    $message = [string]($result.message | Out-String).Trim()
    if (-not $message) { $message = "ok" }
    Write-MonitorLog "OK $uri :: $message"
    return @{ ok = $true; result = $result; message = $message }
  } catch {
    $err = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $err = "$err :: $($_.ErrorDetails.Message)" }
    Write-MonitorLog "ERROR $uri :: $err"
    return @{ ok = $false; error = $err }
  }
}

function Wait-AgentIdle {
  param(
    [string]$Base,
    [string]$Label,
    [int]$MaxWaitSec = 1800
  )
  $deadline = (Get-Date).AddSeconds($MaxWaitSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = Invoke-RestMethod -Uri "$Base/api/status" -TimeoutSec 10
      if (-not [bool]$status.busy) { return $true }
      $op = $status.operationTiming
      $msg = if ($op) { [string]$op.message } else { "" }
      Write-MonitorLog "WAIT $Label busy :: $msg"
    } catch {
      Write-MonitorLog "WAIT $Label status error :: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 10
  }
  Write-MonitorLog "TIMEOUT $Label did not become idle in $MaxWaitSec seconds"
  return $false
}

function Process-BossUnread {
  param([string]$Base, [string]$Label)
  if (-not (Wait-AgentIdle $Base $Label 1800)) { return @{ ok = $false; error = "not idle" } }
  $message = "请直接执行 recruiter_process_unread_all_positions，maxTotal=$UnreadMax。处理所有岗位未读招聘消息；不要只处理 AI 实习生；先切到未读，逐个打开未读联系人并读取应聘岗位；只处理 boss_chat_rules.json 知识库里已经添加的岗位；没有添加或没有配置的岗位只记录并跳过，不回复、不求简历；已配置岗位按岗位 screening 规则提问、答疑、求简历。"
  return Invoke-AgentJson $Base "/api/chat" @{
    message = $message
    options = @{ cursor = $true; humanize = $true; pace = "fast" }
  } 1800
}

function Process-51Unread {
  if (-not (Wait-AgentIdle $BossA "51job" 1800)) { return @{ ok = $false; error = "not idle" } }
  return Invoke-AgentJson $BossA "/api/51job/process-messages" @{
    maxTotal = $UnreadMax
    options = @{ cursor = $true; humanize = $true; pace = "fast" }
  } 1200
}

function Process-ZhilianUnread {
  if (-not (Wait-AgentIdle $BossA "zhilian" 1800)) { return @{ ok = $false; error = "not idle" } }
  return Invoke-AgentJson $BossA "/api/zhilian/process-messages" @{
    maxTotal = $UnreadMax
    options = @{ cursor = $true; humanize = $true; pace = "fast" }
  } 1200
}

function Proactive-BossHrbp {
  param([string]$Base, [string]$Label)
  if (-not (Wait-AgentIdle $Base $Label 1800)) { return @{ ok = $false; error = "not idle" } }
  return Invoke-AgentJson $Base "/api/recruiter/proactive-contact" @{
    targetPosition = "HRBP"
    maxTotal = $ProactiveMax
    dryRun = $false
    requireMatch = $false
    options = @{ cursor = $true; humanize = $true; pace = "fast" }
  } 1800
}

function Proactive-51Hrbp {
  if (-not (Wait-AgentIdle $BossA "51job proactive" 1800)) { return @{ ok = $false; error = "not idle" } }
  return Invoke-AgentJson $BossA "/api/51job/proactive-contact" @{
    targetPosition = "hrbp"
    maxTotal = $ProactiveMax
    dryRun = $false
    options = @{ cursor = $true; humanize = $true; pace = "fast" }
  } 900
}

function Proactive-ZhilianHrbp {
  if (-not (Wait-AgentIdle $BossA "zhilian proactive" 1800)) { return @{ ok = $false; error = "not idle" } }
  return Invoke-AgentJson $BossA "/api/zhilian/proactive-contact" @{
    targetPosition = "hrbp"
    maxTotal = $ProactiveMax
    dryRun = $false
    options = @{ cursor = $true; humanize = $true; pace = "fast" }
  } 900
}

Write-MonitorLog "START four-account monitor poll=${PollSeconds}s unreadMax=$UnreadMax proactiveMax=$ProactiveMax once=$Once"

do {
  Write-MonitorLog "CYCLE start"

  Process-BossUnread $BossA "boss_a" | Out-Null
  Process-BossUnread $BossB "boss_b" | Out-Null
  Process-51Unread | Out-Null
  Process-ZhilianUnread | Out-Null

  Write-MonitorLog "MESSAGE phase completed; start HRBP proactive phase"

  Proactive-BossHrbp $BossA "boss_a proactive" | Out-Null
  Proactive-BossHrbp $BossB "boss_b proactive" | Out-Null
  Proactive-51Hrbp | Out-Null
  Proactive-ZhilianHrbp | Out-Null

  Write-MonitorLog "CYCLE completed"
  if ($Once) { break }
  Start-Sleep -Seconds $PollSeconds
} while ($true)

Write-MonitorLog "STOP four-account monitor"
