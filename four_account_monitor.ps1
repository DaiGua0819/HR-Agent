param(
  [int]$PollSeconds = 120,
  [int]$UnreadMax = 80,
  [int]$ProactiveMax = 5,
  [switch]$Once
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$BaseBossA = "http://127.0.0.1:8787"
$BaseBossB = "http://127.0.0.1:8788"
$Base51Job = "http://127.0.0.1:8789"
$BaseZhilian = "http://127.0.0.1:8790"
$LogPath = Join-Path $PSScriptRoot "four_account_monitor.log"
$PidPath = Join-Path $PSScriptRoot "four_account_monitor.pid"

function Write-MonitorLog {
  param([string]$Message)
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Decode-JsonString {
  param([string]$Escaped)
  return ('{"value":"' + $Escaped + '"}' | ConvertFrom-Json).value
}

function Short-Text {
  param([object]$Value, [int]$MaxLength = 240)
  $text = [string]$Value
  $text = $text -replace "[`r`n]+", " "
  $text = $text.Trim()
  if ($text.Length -gt $MaxLength) {
    return $text.Substring(0, $MaxLength) + "..."
  }
  return $text
}

function Get-Property {
  param([object]$Object, [string]$Name)
  if ($null -eq $Object) {
    return $null
  }
  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) {
    return $null
  }
  return $prop.Value
}

function Test-AgentBusy {
  param([string]$BaseUrl, [string]$Label)
  try {
    $status = Invoke-RestMethod -Uri ($BaseUrl.TrimEnd("/") + "/api/status") -Method Get -TimeoutSec 8
    if ([bool](Get-Property $status "busy")) {
      $timing = Get-Property $status "operationTiming"
      $message = Get-Property $timing "message"
      Write-MonitorLog ("SKIP_BUSY " + $Label + " current=" + (Short-Text $message 180))
      return $true
    }
    return $false
  } catch {
    Write-MonitorLog ("SKIP_STATUS_ERROR " + $Label + " " + (Short-Text $_.Exception.Message 220))
    return $true
  }
}

function Convert-BodyToJson {
  param([hashtable]$Body)
  return ($Body | ConvertTo-Json -Depth 20 -Compress)
}

function Start-AgentRequestJob {
  param(
    [string]$BaseUrl,
    [string]$Path,
    [hashtable]$Body,
    [string]$Label,
    [int]$TimeoutSec = 1800
  )
  if (Test-AgentBusy -BaseUrl $BaseUrl -Label $Label) {
    return $null
  }

  $uri = $BaseUrl.TrimEnd("/") + $Path
  $bodyJson = Convert-BodyToJson $Body
  Write-MonitorLog "START_ASYNC $Label $uri"

  $job = Start-Job -ArgumentList @($uri, $bodyJson, $Label, $TimeoutSec) -ScriptBlock {
    param([string]$Uri, [string]$BodyJson, [string]$Label, [int]$TimeoutSec)
    $ErrorActionPreference = "Continue"
    $ProgressPreference = "SilentlyContinue"

    function Short-TextJob {
      param([object]$Value, [int]$MaxLength = 240)
      $text = [string]$Value
      $text = $text -replace "[`r`n]+", " "
      $text = $text.Trim()
      if ($text.Length -gt $MaxLength) {
        return $text.Substring(0, $MaxLength) + "..."
      }
      return $text
    }

    function Get-PropertyJob {
      param([object]$Object, [string]$Name)
      if ($null -eq $Object) {
        return $null
      }
      $prop = $Object.PSObject.Properties[$Name]
      if ($null -eq $prop) {
        return $null
      }
      return $prop.Value
    }

    function Get-ResultMessageJob {
      param([object]$Result)
      foreach ($name in @("message", "reply", "error")) {
        $value = Get-PropertyJob $Result $name
        if ($null -ne $value -and [string]$value) {
          return [string]$value
        }
      }
      return "ok"
    }

    function Get-ProcessedPeopleJob {
      param([object]$Result)
      $state = Get-PropertyJob $Result "state"
      $processed = Get-PropertyJob $state "processedPeople"
      if ($null -ne $processed) {
        return [int]$processed
      }
      $results = Get-PropertyJob $Result "results"
      if ($null -ne $results) {
        try {
          return [int]$results.Count
        } catch {
          return -1
        }
      }
      return -1
    }

    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($BodyJson)
      $result = Invoke-RestMethod -Uri $Uri -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec $TimeoutSec
      $message = Get-ResultMessageJob $result
      $processed = Get-ProcessedPeopleJob $result
      [pscustomobject]@{
        ok = $true
        label = $Label
        processedPeople = $processed
        message = Short-TextJob $message 300
        error = ""
      }
    } catch {
      $detail = Short-TextJob $_.Exception.Message 260
      if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
        $detail = $detail + " response=" + (Short-TextJob $_.ErrorDetails.Message 420)
      }
      [pscustomobject]@{
        ok = $false
        label = $Label
        processedPeople = -1
        message = ""
        error = $detail
      }
    }
  }

  return [pscustomobject]@{
    Label = $Label
    Job = $job
  }
}

function Wait-AgentRequestJobs {
  param(
    [object[]]$Requests,
    [string]$Phase,
    [int]$TimeoutSec = 5400
  )
  $pending = @($Requests | Where-Object { $null -ne $_ -and $null -ne $_.Job })
  if (@($pending).Count -eq 0) {
    Write-MonitorLog "PHASE_EMPTY $Phase"
    return
  }

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $lastHeartbeat = Get-Date
  while (@($pending).Count -gt 0 -and (Get-Date) -lt $deadline) {
    $jobs = @($pending | ForEach-Object { $_.Job })
    $finished = Wait-Job -Job $jobs -Any -Timeout 5
    if ($null -ne $finished) {
      foreach ($job in @($finished)) {
        $wrapper = @($pending | Where-Object { $_.Job.Id -eq $job.Id } | Select-Object -First 1)
        $label = if (@($wrapper).Count -gt 0) { [string]$wrapper[0].Label } else { "job_$($job.Id)" }
        $items = @(Receive-Job -Job $job)
        foreach ($item in $items) {
          if ($item.ok) {
            Write-MonitorLog ("OK " + $item.label + " processedPeople=" + $item.processedPeople + " message=" + (Short-Text $item.message 320))
          } else {
            Write-MonitorLog ("ERROR " + $item.label + " " + (Short-Text $item.error 520))
          }
        }
        if (@($items).Count -eq 0) {
          Write-MonitorLog "ERROR $label no job output"
        }
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        $pending = @($pending | Where-Object { $_.Job.Id -ne $job.Id })
      }
    } else {
      if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge 60) {
        $labels = (@($pending | ForEach-Object { $_.Label }) -join ",")
        Write-MonitorLog "RUNNING $Phase pending=$labels"
        $lastHeartbeat = Get-Date
      }
    }
  }

  if (@($pending).Count -gt 0) {
    foreach ($item in $pending) {
      Write-MonitorLog "TIMEOUT $($item.Label) phase=$Phase"
      Stop-Job -Job $item.Job -Force -ErrorAction SilentlyContinue
      Remove-Job -Job $item.Job -Force -ErrorAction SilentlyContinue
    }
  }
}

$BossUnreadTemplate = Decode-JsonString "\u8bf7\u5904\u7406\u5168\u90e8\u672a\u8bfb\u6d88\u606f\uff0c\u6240\u6709\u5c97\u4f4d\u3001\u5168\u5c97\u4f4d\u90fd\u8981\u5904\u7406\uff0c\u6309\u6700\u65b0\u57fa\u7840\u6761\u4ef6\u3001\u77e5\u8bc6\u5e93\u7b54\u7591\u3001\u6c42\u7b80\u5386\u89c4\u5219\u6267\u884c\uff0cmaxTotal={0}\u3002\u4e0d\u8981\u53ea\u5904\u7406AI\uff0c\u4e0d\u8981\u6267\u884c\u65e7\u7684AI\u5b9e\u4e60\u751f\u5355\u5c97\u4f4d\u903b\u8f91\u3002"

function Invoke-MonitorCycle {
  $cycleId = Get-Date -Format "yyyyMMdd-HHmmss"
  Write-MonitorLog "CYCLE_START_PARALLEL $cycleId unreadMax=$UnreadMax proactiveMax=$ProactiveMax"

  $bossMessage = [string]::Format($BossUnreadTemplate, $UnreadMax)
  $unreadJobs = @()
  $unreadJobs += Start-AgentRequestJob -BaseUrl $BaseBossA -Path "/api/chat" -Label "boss_a_unread" -TimeoutSec 5400 -Body @{
    message = $bossMessage
  }
  $unreadJobs += Start-AgentRequestJob -BaseUrl $BaseBossB -Path "/api/chat" -Label "boss_b_unread" -TimeoutSec 5400 -Body @{
    message = $bossMessage
  }
  $unreadJobs += Start-AgentRequestJob -BaseUrl $Base51Job -Path "/api/51job/process-messages" -Label "51job_unread" -TimeoutSec 3600 -Body @{
    maxTotal = $UnreadMax
  }
  $unreadJobs += Start-AgentRequestJob -BaseUrl $BaseZhilian -Path "/api/zhilian/process-messages" -Label "zhilian_unread" -TimeoutSec 3600 -Body @{
    maxTotal = $UnreadMax
  }
  Wait-AgentRequestJobs -Requests $unreadJobs -Phase "unread" -TimeoutSec 6000

  Write-MonitorLog "PROACTIVE_START_PARALLEL $cycleId targetPosition=HRBP dryRun=false"
  $proactiveJobs = @()
  $proactiveJobs += Start-AgentRequestJob -BaseUrl $BaseBossA -Path "/api/recruiter/proactive-contact" -Label "boss_a_hrbp_proactive" -TimeoutSec 3600 -Body @{
    targetPosition = "HRBP"
    maxTotal = $ProactiveMax
    dryRun = $false
  }
  $proactiveJobs += Start-AgentRequestJob -BaseUrl $BaseBossB -Path "/api/recruiter/proactive-contact" -Label "boss_b_hrbp_proactive" -TimeoutSec 3600 -Body @{
    targetPosition = "HRBP"
    maxTotal = $ProactiveMax
    dryRun = $false
  }
  $proactiveJobs += Start-AgentRequestJob -BaseUrl $Base51Job -Path "/api/51job/proactive-contact" -Label "51job_hrbp_proactive" -TimeoutSec 2700 -Body @{
    targetPosition = "HRBP"
    maxTotal = $ProactiveMax
    dryRun = $false
  }
  $proactiveJobs += Start-AgentRequestJob -BaseUrl $BaseZhilian -Path "/api/zhilian/proactive-contact" -Label "zhilian_hrbp_proactive" -TimeoutSec 2700 -Body @{
    targetPosition = "HRBP"
    maxTotal = $ProactiveMax
    dryRun = $false
  }
  Wait-AgentRequestJobs -Requests $proactiveJobs -Phase "proactive" -TimeoutSec 4200

  Write-MonitorLog "CYCLE_END_PARALLEL $cycleId"
}

Set-Content -LiteralPath $PidPath -Value $PID -Encoding ASCII
Write-MonitorLog "MONITOR_START_PARALLEL pid=$PID pollSeconds=$PollSeconds once=$Once"

do {
  Invoke-MonitorCycle
  if ($Once) {
    break
  }
  Write-MonitorLog "SLEEP seconds=$PollSeconds"
  Start-Sleep -Seconds $PollSeconds
} while ($true)

Write-MonitorLog "MONITOR_STOP pid=$PID"
