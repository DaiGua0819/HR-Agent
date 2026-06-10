param(
  [string]$OutputPath = "C:\Users\Public\Documents\RecruitAgentMigration\vm_network_check_result.txt"
)

$ErrorActionPreference = "Continue"

function Add-Line {
  param([string]$Text = "")
  $script:Lines += $Text
}

function Test-Tcp {
  param(
    [string]$HostName,
    [int]$Port,
    [int]$TimeoutMs = 3000
  )
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
    if ($ok -and $client.Connected) {
      $client.EndConnect($async)
      return "OK"
    }
    return "FAIL"
  } catch {
    return "FAIL: $($_.Exception.Message)"
  } finally {
    $client.Close()
  }
}

function Test-Http {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    return "OK $($response.StatusCode)"
  } catch {
    return "FAIL: $($_.Exception.Message)"
  }
}

$script:Lines = @()
Add-Line "VM network check"
Add-Line "Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Add-Line ""

Add-Line "== IP configuration =="
try {
  Get-NetIPConfiguration |
    Select-Object InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer |
    Format-List |
    Out-String |
    ForEach-Object { Add-Line $_.TrimEnd() }
} catch {
  Add-Line "Get-NetIPConfiguration failed: $($_.Exception.Message)"
  ipconfig | ForEach-Object { Add-Line $_ }
}

Add-Line ""
Add-Line "== DNS =="
foreach ($name in @("www.baidu.com", "www.zhipin.com", "www.51job.com", "www.zhaopin.com")) {
  try {
    $resolved = Resolve-DnsName $name -ErrorAction Stop | Select-Object -First 2 -ExpandProperty IPAddress
    Add-Line "$name => $($resolved -join ', ')"
  } catch {
    Add-Line "$name => FAIL: $($_.Exception.Message)"
  }
}

Add-Line ""
Add-Line "== TCP =="
$tcpTargets = @(
  @("192.168.254.205", 8097, "model-service"),
  @("imap.263.net", 993, "263-imap"),
  @("www.baidu.com", 443, "baidu-https"),
  @("www.zhipin.com", 443, "boss-https"),
  @("www.51job.com", 443, "51job-https"),
  @("www.zhaopin.com", 443, "zhilian-https")
)
foreach ($target in $tcpTargets) {
  Add-Line "$($target[2]) $($target[0]):$($target[1]) => $(Test-Tcp -HostName $target[0] -Port $target[1])"
}

Add-Line ""
Add-Line "== HTTP =="
foreach ($url in @(
  "https://www.baidu.com",
  "https://www.zhipin.com",
  "https://www.51job.com",
  "https://www.zhaopin.com",
  "http://192.168.254.205:8097/v1/models"
)) {
  Add-Line "$url => $(Test-Http $url)"
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath -Parent) | Out-Null
$script:Lines | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "Network check finished."
Write-Host "Result: $OutputPath"
