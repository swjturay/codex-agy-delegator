$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Installing Codex Agent Delegator (Windows)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

foreach ($cmd in @("git", "node", "npm")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Error: $cmd is required but not installed." -ForegroundColor Red
        exit 1
    }
}

$NodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 20) {
    Write-Host "Error: Node.js 20 or newer is required." -ForegroundColor Red
    exit 1
}

$LegacyTarget = Join-Path $env:USERPROFILE ".codex-agy-delegator"
if (Test-Path (Join-Path $LegacyTarget ".git")) {
    $TargetDir = $LegacyTarget
} else {
    $TargetDir = Join-Path $env:LOCALAPPDATA "codex-agent-delegator"
}

if (Test-Path (Join-Path $TargetDir ".git")) {
    Write-Host "Updating existing installation in $TargetDir..." -ForegroundColor Yellow
    Set-Location $TargetDir
    if (git status --porcelain) {
        Write-Host "Error: existing installation has local changes; refusing to overwrite them." -ForegroundColor Red
        exit 1
    }
    git pull --ff-only origin main
} elseif (Test-Path $TargetDir) {
    Write-Host "Error: $TargetDir exists but is not a git checkout." -ForegroundColor Red
    exit 1
} else {
    Write-Host "Installing to $TargetDir..." -ForegroundColor Yellow
    git clone --quiet https://github.com/swjturay/codex-agy-delegator.git $TargetDir
    Set-Location $TargetDir
}

Write-Host "Installing locked dependencies..." -ForegroundColor Yellow
npm ci
Write-Host "Building the MCP server..." -ForegroundColor Yellow
npm run build
Write-Host "Installing Codex skills and MCP configuration..." -ForegroundColor Yellow
npm run setup

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Codex Agent Delegator installed successfully." -ForegroundColor Green
Write-Host "Restart Codex, then call list_agent_backends to verify your agent CLIs."
Write-Host "==================================================" -ForegroundColor Cyan
