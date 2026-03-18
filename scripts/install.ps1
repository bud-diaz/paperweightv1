# Paperweight Installer for Windows
# Run as Administrator in PowerShell:
#   cd C:\paperweight
#   .\scripts\install.ps1

# ── Admin check ───────────────────────────────────────────────────────────────
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
    Write-Host ""
    Write-Host "  ERROR: Run this script as Administrator." -ForegroundColor Red
    Write-Host "  Right-click the Start button -> Terminal (Admin), navigate here, and try again."
    Write-Host ""
    exit 1
}

# ── winget check ──────────────────────────────────────────────────────────────
if (-NOT (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "  ERROR: winget not found." -ForegroundColor Red
    Write-Host "  Install 'App Installer' from the Microsoft Store, then try again."
    Write-Host ""
    exit 1
}

$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "╔══════════════════════════════════════╗"
Write-Host "║      PAPERWEIGHT INSTALLER           ║"
Write-Host "╚══════════════════════════════════════╝"
Write-Host ""

# ── Node.js ───────────────────────────────────────────────────────────────────
Write-Host "── Node.js ──────────────────────────"
winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
Write-Host "  ✓ Node.js installed"

# Refresh PATH so npm is available in this session
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# ── FFmpeg ────────────────────────────────────────────────────────────────────
Write-Host "── FFmpeg ───────────────────────────"
winget install Gyan.FFmpeg --silent --accept-source-agreements --accept-package-agreements
Write-Host "  ✓ FFmpeg installed"

# ── cloudflared ───────────────────────────────────────────────────────────────
Write-Host "── cloudflared ──────────────────────"
winget install Cloudflare.cloudflared --silent --accept-source-agreements --accept-package-agreements
Write-Host "  ✓ cloudflared installed"

# ── PM2 ───────────────────────────────────────────────────────────────────────
Write-Host "── PM2 ──────────────────────────────"
npm install -g pm2 pm2-windows-startup
Write-Host "  ✓ PM2 installed"

# ── npm packages ──────────────────────────────────────────────────────────────
Write-Host "── npm packages ─────────────────────"
Set-Location $ROOT
npm install
Write-Host "  ✓ npm packages installed"

# ── Firewall rule ─────────────────────────────────────────────────────────────
Write-Host "── Firewall ─────────────────────────"
$existing = Get-NetFirewallRule -DisplayName "Paperweight" -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "  ✓ Firewall rule already exists"
} else {
    New-NetFirewallRule -DisplayName "Paperweight" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow | Out-Null
    Write-Host "  ✓ Firewall rule added (port 3000)"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ✓ Installation complete." -ForegroundColor Green
Write-Host ""
Write-Host "  Close this window, open Git Bash, navigate to your paperweight folder, and run:"
Write-Host "    bash scripts/setup.sh"
Write-Host ""
