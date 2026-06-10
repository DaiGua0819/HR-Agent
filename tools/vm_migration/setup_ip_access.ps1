param(
  [string]$ProjectRoot = "C:\Users\Public\Documents\RecruitAgent\project",
  [int]$WebPort = 8080,
  [int]$DesktopPort = 8443,
  [string]$WebUser = "admin",
  [string[]]$WebUsers = @(),
  [string]$WebPassword = "",
  [switch]$SkipMeshCentral
)

$ErrorActionPreference = "Stop"

function Quote-Argument {
  param([string]$Value)
  if ($null -eq $Value) {
    return '""'
  }
  return '"' + ($Value -replace '"', '\"') + '"'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "This setup needs Administrator rights for firewall rules and startup tasks."
  Write-Host "Requesting an elevated PowerShell window. Please click Yes in the UAC prompt."
  if ($WebPassword) {
    Write-Host "For security, the password will not be passed to the elevated process. Please enter it again."
  }

  $elevatedArgs = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    (Quote-Argument $PSCommandPath),
    "-ProjectRoot",
    (Quote-Argument $ProjectRoot),
    "-WebPort",
    "$WebPort",
    "-DesktopPort",
    "$DesktopPort",
    "-WebUser",
    (Quote-Argument $WebUser),
    "-WebUsers",
    (Quote-Argument ($WebUsers -join ",")))
  if ($SkipMeshCentral) {
    $elevatedArgs += "-SkipMeshCentral"
  }
  Start-Process -FilePath "powershell.exe" -ArgumentList $elevatedArgs -Verb RunAs | Out-Null
  exit 0
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "== $Message =="
}

function ConvertTo-PlainText {
  param([securestring]$Secure)
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function Find-CommandPath {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd -or -not $cmd.Source) {
    throw "Cannot find command: $Name"
  }
  return $cmd.Source
}

function Add-FirewallRule {
  param(
    [string]$Name,
    [string[]]$Port
  )
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Firewall rule exists: $Name"
    return
  }
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
  Write-Host "Firewall rule added: $Name / TCP $($Port -join ',')"
}

function Add-BlockFirewallRule {
  param(
    [string]$Name,
    [string[]]$Port
  )
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Firewall block rule exists: $Name"
    return
  }
  New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Block -Protocol TCP -LocalPort $Port | Out-Null
  Write-Host "Firewall block rule added: $Name / TCP $($Port -join ',')"
}

function Stop-PortProcess {
  param([int]$Port)
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    if ($connection.OwningProcess -and $connection.OwningProcess -ne 0) {
      try {
        Stop-Process -Id $connection.OwningProcess -Force -ErrorAction Stop
        Write-Host "Stopped PID $($connection.OwningProcess) on port $Port"
      } catch {
        Write-Host "Could not stop PID $($connection.OwningProcess): $($_.Exception.Message)"
      }
    }
  }
}

function Test-LocalPort {
  param([int]$Port)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1000, $false)
    if (-not $ok) {
      return $false
    }
    $client.EndConnect($iar)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-LocalPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 60
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort $Port) {
      return $true
    }
    Start-Sleep -Seconds 2
  }
  return $false
}

function New-WebPasswordRecord {
  param(
    [string]$Username,
    [string]$Password
  )
  $saltBytes = New-Object byte[] 16
  $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
  try {
    $rng.GetBytes($saltBytes)
  } finally {
    $rng.Dispose()
  }
  $salt = -join ($saltBytes | ForEach-Object { $_.ToString("x2") })
  $pbkdf2 = New-Object Security.Cryptography.Rfc2898DeriveBytes($Password, $saltBytes, 120000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try {
    $derived = $pbkdf2.GetBytes(32)
  } finally {
    $pbkdf2.Dispose()
  }
  $hash = -join ($derived | ForEach-Object { $_.ToString("x2") })
  return [ordered]@{
    username = $Username
    salt = $salt
    hash = $hash
    iterations = 120000
  }
}

if (-not (Test-Path (Join-Path $ProjectRoot "patchwork-recruit-gpt\server.js"))) {
  throw "RecruitAgent project not found: $ProjectRoot"
}

$NodePath = Find-CommandPath "node"
$NpmPath = Find-CommandPath "npm"
$AccessRoot = Join-Path $ProjectRoot "remote-access"
$ProxyRoot = Join-Path $AccessRoot "web-proxy"
$MeshRoot = Join-Path $AccessRoot "meshcentral"
New-Item -ItemType Directory -Force -Path $AccessRoot, $ProxyRoot | Out-Null

if (-not $WebUsers -or $WebUsers.Count -eq 0) {
  $WebUsers = @($WebUser)
}
$WebUsers = @($WebUsers | ForEach-Object { "$_" -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique)
if ($WebUsers.Count -eq 0) {
  throw "At least one Web user is required."
}

$ProxyUserRecords = @()
foreach ($userName in $WebUsers) {
  $passwordForUser = $WebPassword
  if (-not $passwordForUser -or $WebUsers.Count -gt 1) {
    $secure = Read-Host "Enter password for Web user '$userName'" -AsSecureString
    $passwordForUser = ConvertTo-PlainText $secure
  }
  if (-not $passwordForUser) {
    throw "Web password cannot be empty for user: $userName"
  }
  $ProxyUserRecords += New-WebPasswordRecord -Username $userName -Password $passwordForUser
}

Write-Step "Write Web reverse proxy"
$ProxyScript = @'
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");

const configPath = process.env.RECRUIT_PROXY_CONFIG || "web_proxy_config.json";
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const listenPort = Number(config.listenPort || 8080);
const target = new URL(config.target || "http://127.0.0.1:8765");

function verifyPassword(user, password) {
  const account = (config.users || []).find((item) => item.username === user);
  if (!account) return false;
  const hash = crypto.pbkdf2Sync(password, Buffer.from(account.salt, "hex"), account.iterations || 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(account.hash, "hex"));
}

function unauthorized(res) {
  res.writeHead(401, { "WWW-Authenticate": 'Basic realm="RecruitAgent"', "Content-Type": "text/plain; charset=utf-8" });
  res.end("Authentication required");
}

function isAuthorized(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const splitAt = decoded.indexOf(":");
  if (splitAt < 0) return false;
  const user = decoded.slice(0, splitAt);
  const password = decoded.slice(splitAt + 1);
  return verifyPassword(user, password);
}

const server = http.createServer((req, res) => {
  if (!isAuthorized(req)) return unauthorized(res);

  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: target.host },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (error) => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Proxy error: ${error.message}`);
  });
  req.pipe(proxyReq);
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`RecruitAgent web proxy listening on 0.0.0.0:${listenPort}, target=${target.href}`);
});
'@
$ProxyScriptPath = Join-Path $ProxyRoot "web_proxy.js"
$ProxyConfigPath = Join-Path $ProxyRoot "web_proxy_config.json"
$ProxyStartPath = Join-Path $ProxyRoot "start_web_proxy.ps1"
$ProxyScript | Set-Content -Path $ProxyScriptPath -Encoding ASCII

$config = [ordered]@{
  listenPort = $WebPort
  target = "http://127.0.0.1:8765"
  users = @($ProxyUserRecords)
}
$config | ConvertTo-Json -Depth 6 | Set-Content -Path $ProxyConfigPath -Encoding ASCII

@"
`$ErrorActionPreference = "Stop"
Set-Location '$ProxyRoot'
`$env:RECRUIT_PROXY_CONFIG = '$ProxyConfigPath'
& '$NodePath' '$ProxyScriptPath' *>> '$ProxyRoot\web_proxy.log'
"@ | Set-Content -Path $ProxyStartPath -Encoding ASCII

Write-Step "Start Web reverse proxy"
Stop-PortProcess $WebPort
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ProxyStartPath) -WindowStyle Hidden | Out-Null
Start-Sleep -Seconds 2
Add-FirewallRule -Name "RecruitAgent Web Proxy $WebPort" -Port $WebPort
Add-BlockFirewallRule -Name "RecruitAgent Internal Web 8765 Block External" -Port "8765"
Add-BlockFirewallRule -Name "RecruitAgent Internal Agent Ports Block External" -Port "8787-8792"
Add-BlockFirewallRule -Name "RecruitAgent Internal CDP Ports Block External" -Port @("9222","9230","9224","9225","9226","9231")

Write-Step "Register Web proxy startup task"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ProxyStartPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "RecruitAgentWebProxy" -Action $action -Trigger $trigger -RunLevel Highest -Force | Out-Null
Write-Host "Scheduled task registered: RecruitAgentWebProxy"

if (-not $SkipMeshCentral) {
  Write-Step "Install or update MeshCentral"
  New-Item -ItemType Directory -Force -Path $MeshRoot | Out-Null
  Set-Location $MeshRoot
  if (-not (Test-Path (Join-Path $MeshRoot "package.json"))) {
    & $NpmPath init -y | Out-Null
  }
  & $NpmPath install meshcentral

  $MeshDataRoot = Join-Path $MeshRoot "meshcentral-data"
  New-Item -ItemType Directory -Force -Path $MeshDataRoot | Out-Null
  $meshConfig = [ordered]@{
    settings = [ordered]@{
      port = $DesktopPort
      redirPort = 0
      exactPorts = $true
      cert = "192.168.254.253"
      agentPong = 300
      selfUpdate = $false
    }
    domains = [ordered]@{
      "" = [ordered]@{
        title = "RecruitAgent Remote Desktop"
        newAccounts = $true
      }
    }
  }
  $meshConfig | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $MeshDataRoot "config.json") -Encoding ASCII

  $MeshStartPath = Join-Path $MeshRoot "start_meshcentral.ps1"
  $MeshEntry = Join-Path $MeshRoot "node_modules\meshcentral\meshcentral.js"
  if (-not (Test-Path $MeshEntry)) {
    $MeshEntry = Join-Path $MeshRoot "node_modules\meshcentral"
  }
  @"
`$ErrorActionPreference = "Stop"
Set-Location '$MeshRoot'
& '$NodePath' '$MeshEntry' --datapath '$MeshDataRoot' *>> '$MeshRoot\meshcentral.log'
"@ | Set-Content -Path $MeshStartPath -Encoding ASCII

  Stop-PortProcess $DesktopPort
  Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $MeshStartPath) -WindowStyle Hidden | Out-Null
  if (-not (Wait-LocalPort -Port $DesktopPort -TimeoutSeconds 90)) {
    Write-Host "MeshCentral did not start listening on $DesktopPort within 90 seconds."
    $meshLog = Join-Path $MeshRoot "meshcentral.log"
    if (Test-Path $meshLog) {
      Write-Host "Last MeshCentral log lines:"
      Get-Content -Path $meshLog -Tail 80
    }
    throw "MeshCentral startup failed on port $DesktopPort"
  }
  Add-FirewallRule -Name "RecruitAgent MeshCentral $DesktopPort" -Port $DesktopPort

  $meshAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$MeshStartPath`""
  $meshTrigger = New-ScheduledTaskTrigger -AtLogOn
  Register-ScheduledTask -TaskName "RecruitAgentMeshCentral" -Action $meshAction -Trigger $meshTrigger -RunLevel Highest -Force | Out-Null
  Write-Host "Scheduled task registered: RecruitAgentMeshCentral"
}

Write-Step "Check listening ports"
Get-NetTCPConnection -LocalPort $WebPort,$DesktopPort -ErrorAction SilentlyContinue |
  Select-Object LocalPort,State,OwningProcess |
  Sort-Object LocalPort |
  Format-Table -AutoSize

Write-Step "Done"
Write-Host "Web URL: http://192.168.254.253:$WebPort"
Write-Host "Remote desktop URL: https://192.168.254.253:$DesktopPort"
Write-Host "Do not expose ports 8787-8792 or 9222/9230/9224/9225/9226/9231."
Write-Host "MeshCentral first visit: create the first admin account, create a device group, then install the MeshAgent on this VM."
Write-Host "After the MeshAgent connects, create colleague accounts and only grant access to this VM."
