$ErrorActionPreference = "Continue"

Write-Host "RiftCoach Windows dev doctor"
Write-Host "-----------------------------"

$nodeVersionRaw = (node --version) 2>$null
if (-not $nodeVersionRaw) {
  Write-Host "Node: not found" -ForegroundColor Red
} else {
  Write-Host "Node:" $nodeVersionRaw
  $nodeVersion = $nodeVersionRaw.TrimStart("v").Split(".")
  $major = [int]$nodeVersion[0]
  $minor = [int]$nodeVersion[1]
  if ($major -ne 24 -or $minor -lt 14) {
    Write-Host "Expected Node >=24.14 <25 for this Windows desktop build." -ForegroundColor Yellow
  }
}

try { Write-Host "pnpm:" (pnpm --version) } catch { Write-Host "pnpm: not found" -ForegroundColor Red }
Write-Host "PowerShell:" $PSVersionTable.PSVersion

try {
  $electronVersion = (node -p "require('./apps/desktop/package.json').devDependencies.electron")
  Write-Host "Electron target:" $electronVersion
} catch {
  Write-Host "Electron target: unknown"
}

try {
  $sqliteVersion = (node -p "require('./packages/storage/package.json').dependencies['better-sqlite3']")
  Write-Host "better-sqlite3 target:" $sqliteVersion
} catch {
  Write-Host "better-sqlite3 target: unknown"
}

Write-Host ""
Write-Host "Checking League Live Client API. This is only reachable while a game is active."
try {
  Invoke-WebRequest -Uri "https://127.0.0.1:2999/liveclientdata/gamestats" -SkipCertificateCheck -TimeoutSec 2 | Out-Null
  Write-Host "Live Client API: reachable" -ForegroundColor Green
} catch {
  Write-Host "Live Client API: not reachable. Normal outside an active game." -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "Checking Ollama."
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
  Write-Host "Ollama: reachable" -ForegroundColor Green
} catch {
  Write-Host "Ollama: not reachable" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "If pnpm install falls back to node-gyp, install Visual Studio Build Tools with Desktop development with C++."
