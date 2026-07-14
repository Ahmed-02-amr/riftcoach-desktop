$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm was not found. Install pnpm or run: npm install -g pnpm"
}

pnpm install
pnpm build
pnpm verify:desktop
pnpm --filter @riftcoach/desktop exec electron-builder --win nsis --x64
