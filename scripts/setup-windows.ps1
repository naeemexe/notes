# Sets up Notes on a Windows laptop:
#   Node server under pm2  +  Cloudflare Tunnel at https://notes.naeemislam.com  +  auto-start at login.
# Safe to re-run (it updates the code and restarts everything).
#
# Run in PowerShell (not as admin):
#   irm https://raw.githubusercontent.com/naeemexe/notes/main/scripts/setup-windows.ps1 -OutFile setup-notes.ps1
#   powershell -ExecutionPolicy Bypass -File setup-notes.ps1 -DataZip "$HOME\Downloads\notes-data.zip"

param(
  [string]$Hostname = 'notes.naeemislam.com',
  [string]$Dir = "$HOME\notes",
  [string]$DataZip = ''
)
$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Run { & $args[0] @($args | Select-Object -Skip 1); if ($LASTEXITCODE) { throw "Failed: $args" } }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  foreach ($p in "$env:APPDATA\npm", "${env:ProgramFiles(x86)}\cloudflared", "$env:ProgramFiles\cloudflared") {
    if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) { $env:Path += ";$p" }
  }
}
function WingetInstall($id) {
  winget install -e --id $id --silent --accept-source-agreements --accept-package-agreements
  RefreshPath
}

Step '1/7 Installing Node, Git, cloudflared (skips what you already have)'
RefreshPath
if (-not (Have node)) { WingetInstall 'OpenJS.NodeJS.LTS' }
if (-not (Have git)) { WingetInstall 'Git.Git' }
if (-not (Have cloudflared)) { WingetInstall 'Cloudflare.cloudflared' }
foreach ($c in 'node', 'git', 'cloudflared') {
  if (-not (Have $c)) { throw "$c is installed but not on PATH yet. Close PowerShell, open a new one, and run this script again." }
}

Step "2/7 Getting the code into $Dir"
if (Test-Path "$Dir\.git") { Run git -C $Dir pull --ff-only }
else { Run git clone https://github.com/naeemexe/notes.git $Dir }
Set-Location $Dir

Step '3/7 Notes data'
if ($DataZip) {
  if (-not (Test-Path $DataZip)) { throw "Data zip not found: $DataZip" }
  if (Test-Path 'data\index.json') {
    $bak = 'data.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Move-Item data $bak
    Write-Host "Existing data moved to $bak"
  }
  Expand-Archive -Path $DataZip -DestinationPath $Dir -Force
  if (-not (Test-Path 'data\index.json')) { throw 'The zip did not contain data\index.json' }
  Write-Host 'Notes imported.'
} elseif (Test-Path 'data\index.json') { Write-Host 'Keeping existing data folder.' }
else { Write-Host 'No data yet: the app will start with an empty notebook.' }

Step '4/7 Installing packages and building the app'
Run npm.cmd install --no-audit --no-fund
Run npm.cmd run build

Step '5/7 Starting the server with pm2'
if (-not (Have pm2)) { Run npm.cmd install -g pm2; RefreshPath }
cmd /c "pm2 delete notes >nul 2>&1"
Run pm2.cmd start server.mjs --name notes

Step "6/7 Cloudflare Tunnel for $Hostname"
$cfDir = "$HOME\.cloudflared"
if (-not (Test-Path "$cfDir\cert.pem")) {
  Write-Host 'A browser window opens: log in to Cloudflare and click naeemislam.com to authorize.' -ForegroundColor Yellow
  Run cloudflared tunnel login
}
function FindTunnel { (cloudflared tunnel list --output json | ConvertFrom-Json) | Where-Object { $_.name -eq 'notes' } | Select-Object -First 1 }
$tunnel = FindTunnel
if (-not $tunnel) {
  Run cloudflared tunnel create notes
  $tunnel = FindTunnel
}
$id = $tunnel.id
if (-not (Test-Path "$cfDir\$id.json")) {
  throw "Tunnel 'notes' exists but its credentials file $cfDir\$id.json is missing. Delete the tunnel in the Cloudflare dashboard (Zero Trust > Networks > Tunnels) and re-run."
}
Run cloudflared tunnel route dns --overwrite-dns notes $Hostname
$cfg = "$cfDir\notes.yml"
@"
tunnel: $id
credentials-file: '$cfDir\$id.json'
ingress:
  - hostname: $Hostname
    service: http://localhost:5180
  - service: http_status:404
"@ | Set-Content -Path $cfg -Encoding ascii
cmd /c "pm2 delete notes-tunnel >nul 2>&1"
Run pm2.cmd start (Get-Command cloudflared).Source --name notes-tunnel --interpreter none '--' tunnel --config $cfg run
Run pm2.cmd save

Step '7/7 Auto-start at login and stay awake on power'
$startup = [Environment]::GetFolderPath('Startup')
"@echo off`r`n`"$((Get-Command pm2.cmd).Source)`" resurrect" | Set-Content -Path "$startup\notes-start.cmd" -Encoding ascii
Write-Host "Added $startup\notes-start.cmd (starts Notes + tunnel when you log in)."
powercfg /change standby-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
Write-Host 'When plugged in: never sleep, closing the lid does nothing.'

Write-Host "`nDone. Open https://$Hostname (give DNS a minute the first time)." -ForegroundColor Green
Write-Host 'Next: add a login in Cloudflare Zero Trust > Access > Applications (see README).' -ForegroundColor Yellow
Write-Host 'Useful: pm2 status | pm2 logs notes | pm2 restart notes'
