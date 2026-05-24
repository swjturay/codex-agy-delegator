$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "🚀 Installing Codex-Agy Delegator (Windows)" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Check dependencies
$commands = @("git", "node", "npm")
foreach ($cmd in $commands) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "❌ Error: $cmd is required but not installed. Please install $cmd and try again." -ForegroundColor Red
        exit 1
    }
}

$TargetDir = "$env:USERPROFILE\.codex-agy-delegator"

if (Test-Path $TargetDir) {
    Write-Host "📦 Updating existing installation in $TargetDir..." -ForegroundColor Yellow
    Set-Location $TargetDir
    git pull --quiet origin main
} else {
    Write-Host "📦 Downloading Codex-Agy Delegator to $TargetDir..." -ForegroundColor Yellow
    git clone --quiet https://github.com/swjturay/codex-agy-delegator.git $TargetDir
    Set-Location $TargetDir
}

Write-Host "⚙️  Installing dependencies..." -ForegroundColor Yellow
npm install --no-fund --no-audit --silent

Write-Host "🔨 Compiling project..." -ForegroundColor Yellow
npm run build | Out-Null

Write-Host "🛠  Running setup..." -ForegroundColor Yellow
npm run setup

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "✨ Codex-Agy Delegator has been successfully installed!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
