# Paperweight Installer for Windows
# Run as Administrator in PowerShell:
#   cd C:\paperweight
#   .\scripts\install.ps1
#
# Cloudflare Tunnel is optional. To install it too:
#   $env:PAPERWEIGHT_INSTALL_CLOUDFLARED="true"; .\scripts\install.ps1

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
    Write-Host ""
    Write-Host "ERROR: Run this script as Administrator." -ForegroundColor Red
    Write-Host "Right-click Start -> Terminal (Admin), navigate here, and try again."
    Write-Host ""
    exit 1
}

if (-NOT (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "ERROR: winget not found." -ForegroundColor Red
    Write-Host "Install 'App Installer' from the Microsoft Store, then try again."
    Write-Host ""
    exit 1
}

$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "Paperweight Windows installer"
Write-Host ""

Write-Host "-- Node.js"
winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
if (-NOT (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node was not found after install. Reopen PowerShell and rerun preflight." -ForegroundColor Red
    exit 1
}
Write-Host "OK   Node.js installed"

Write-Host "-- FFmpeg"
winget install Gyan.FFmpeg --silent --accept-source-agreements --accept-package-agreements
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
if ((-NOT (Get-Command ffmpeg -ErrorAction SilentlyContinue)) -or (-NOT (Get-Command ffprobe -ErrorAction SilentlyContinue))) {
    Write-Host "ERROR: ffmpeg or ffprobe was not found after install. Reopen PowerShell and rerun preflight." -ForegroundColor Red
    exit 1
}
Write-Host "OK   FFmpeg and ffprobe installed"

if ($env:PAPERWEIGHT_INSTALL_CLOUDFLARED -eq "true") {
    Write-Host "-- cloudflared"
    winget install Cloudflare.cloudflared --silent --accept-source-agreements --accept-package-agreements
    Write-Host "OK   cloudflared installed"
} else {
    Write-Host "SKIP cloudflared (set PAPERWEIGHT_INSTALL_CLOUDFLARED=true to install it)"
}

Write-Host "-- PM2"
npm install -g pm2 pm2-windows-startup
Write-Host "OK   PM2 installed"

Write-Host "-- npm packages"
Set-Location $ROOT
npm install
Write-Host "OK   npm packages installed"

Write-Host "-- Firewall"
$existing = Get-NetFirewallRule -DisplayName "Paperweight" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "OK   Firewall rule already exists"
} else {
    New-NetFirewallRule -DisplayName "Paperweight" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow | Out-Null
    Write-Host "OK   Firewall rule added (port 3000)"
}

Write-Host ""
Write-Host "Installation complete." -ForegroundColor Green
Write-Host "Next step: open Git Bash in this folder and run:"
Write-Host "  bash scripts/setup.sh"
Write-Host ""
