<#
.SYNOPSIS
    Builds the native C++ audio engine (pas_engine.node) via node-gyp.

.DESCRIPTION
    1. Verifies prerequisites: Node.js 18+, Python 3.x, MSVC toolchain,
       node-addon-api, node-gyp.
    2. Cleans previous build directory.
    3. Runs node-gyp configure + build --release.
    4. Copies the .node output to audio-engine/build/Release/ where
       nativeEngine.js expects to find it.
    5. Runs a smoke test — loads the addon and lists its exports.

.PARAMETER Clean
    Force clean before build (default: always clean).

.PARAMETER Debug
    Build in Debug configuration instead of Release (default: Release).

.EXAMPLE
    .\scripts\build-native.ps1
    .\scripts\build-native.ps1 -Debug
#>

param(
    [switch]$Debug
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$config = if ($Debug) { "Debug" } else { "Release" }

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Priority Audio Studio - Native Engine Build ($config)" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# ── Paths ──────────────────────────────────────────────────────────────
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$AddonDir    = Join-Path $ProjectRoot "audio-engine\addon"
$BuildOutDir = Join-Path $ProjectRoot "audio-engine\build\$config"
$ExpectedOut = Join-Path $BuildOutDir "pas_engine.node"

Write-Host "Project root:   $ProjectRoot"
Write-Host "Addon dir:      $AddonDir"
Write-Host "Expected output: $ExpectedOut"
Write-Host ""

# ── Prerequisites ──────────────────────────────────────────────────────
Write-Host "Checking prerequisites..." -ForegroundColor Cyan

function Test-CommandExists($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

$fail = 0

# Node.js
if (Test-CommandExists "node") {
    $nodeVer = (& node --version).Trim()
    Write-Host "  [OK] node $nodeVer" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] node not found in PATH" -ForegroundColor Red
    Write-Host "         Install Node.js 22 LTS: https://nodejs.org" -ForegroundColor Yellow
    $fail++
}

# npm
if (Test-CommandExists "npm") {
    $npmVer = (& npm --version).Trim()
    Write-Host "  [OK] npm $npmVer" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] npm not found" -ForegroundColor Red
    $fail++
}

# Python
$pythonCmd = $null
if (Test-CommandExists "python") {
    $pythonCmd = "python"
} elseif (Test-CommandExists "python3") {
    $pythonCmd = "python3"
}
if ($pythonCmd) {
    $pyVer = (& $pythonCmd --version 2>&1).Trim()
    Write-Host "  [OK] $pythonCmd $pyVer" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Python not found - node-gyp requires Python 3.x" -ForegroundColor Red
    Write-Host "         Install: https://www.python.org/downloads/" -ForegroundColor Yellow
    $fail++
}

# MSVC (Visual Studio Build Tools)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msvcFound = $false
if (Test-Path $vswhere) {
    $vsInstall = (& $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath 2>&1 | Out-String).Trim()
    if ($vsInstall) {
        Write-Host "  [OK] MSVC via VS at: $vsInstall" -ForegroundColor Green
        $msvcFound = $true
    }
}
if (-not $msvcFound) {
    if (Test-CommandExists "cl") {
        Write-Host "  [OK] cl.exe in PATH" -ForegroundColor Green
        $msvcFound = $true
    }
}
if (-not $msvcFound) {
    Write-Host "  [FAIL] MSVC C++ toolchain not found" -ForegroundColor Red
    Write-Host "         Install Visual Studio Build Tools 2022 with 'Desktop development with C++'" -ForegroundColor Yellow
    Write-Host "         https://visualstudio.microsoft.com/downloads/" -ForegroundColor Yellow
    $fail++
}

# node-addon-api
$nodeAddonApi = Join-Path $ProjectRoot "node_modules\node-addon-api"
if (Test-Path $nodeAddonApi) {
    Write-Host "  [OK] node-addon-api installed" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] node-addon-api not installed" -ForegroundColor Red
    Write-Host "         Run: npm install --save-dev node-addon-api node-gyp" -ForegroundColor Yellow
    $fail++
}

# node-gyp
$nodeGypBin = Join-Path $ProjectRoot "node_modules\.bin\node-gyp.cmd"
if (Test-Path $nodeGypBin) {
    Write-Host "  [OK] node-gyp installed" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] node-gyp not installed" -ForegroundColor Red
    Write-Host "         Run: npm install --save-dev node-addon-api node-gyp" -ForegroundColor Yellow
    $fail++
}

# binding.gyp present
$bindingGyp = Join-Path $AddonDir "binding.gyp"
if (Test-Path $bindingGyp) {
    Write-Host "  [OK] binding.gyp present" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] binding.gyp not found at $bindingGyp" -ForegroundColor Red
    $fail++
}

# Sources present
$srcFiles = @(
    "..\src\Engine.cpp",
    "..\src\PriorityMixer.cpp",
    "..\src\WasapiRender.cpp",
    "..\src\WasapiLoopback.cpp",
    "..\src\Meter.cpp",
    "..\src\DtxInjector.cpp",
    "..\src\Equalizer.cpp",
    "..\src\Limiter.cpp",
    "..\src\Compressor.cpp"
)
$missingSrc = @()
foreach ($src in $srcFiles) {
    $fullPath = Join-Path $AddonDir $src
    if (-not (Test-Path $fullPath)) {
        $missingSrc += $src
    }
}
if ($missingSrc.Count -eq 0) {
    Write-Host "  [OK] All 9 source files present" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Missing source files:" -ForegroundColor Red
    foreach ($m in $missingSrc) { Write-Host "         $m" -ForegroundColor Yellow }
    $fail++
}

if ($fail -gt 0) {
    Write-Host ""
    Write-Host "Build aborted - fix the above and retry." -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "All prerequisites met." -ForegroundColor Green
Write-Host ""

# ── Clean ──────────────────────────────────────────────────────────────
$buildDir = Join-Path $AddonDir "build"
if (Test-Path $buildDir) {
    Write-Host "Cleaning previous build directory..." -ForegroundColor Yellow
    try {
        Remove-Item -Path $buildDir -Recurse -Force
        Write-Host "  [OK] build/ removed" -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] Could not remove build/ (file in use?): $_" -ForegroundColor Yellow
    }
}

# ── Configure ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Running node-gyp configure..." -ForegroundColor Cyan
Push-Location $AddonDir
try {
    & $nodeGypBin configure --$($config.ToLower())
    if ($LASTEXITCODE -ne 0) {
        throw "node-gyp configure failed (exit code $LASTEXITCODE)"
    }
    Write-Host "  [OK] configured" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "[FAIL] Configuration failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common causes:" -ForegroundColor Yellow
    Write-Host "  - MSVC not in PATH: launch from 'Developer PowerShell for VS 2022'"
    Write-Host "  - Python path has spaces: node-gyp needs clean Python install"
    Write-Host "  - binding.gyp syntax error: check include_dirs line (must use node-addon-api helper)"
    Pop-Location
    exit 1
}
Pop-Location

# ── Build ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Running node-gyp build..." -ForegroundColor Cyan
Push-Location $AddonDir
try {
    & $nodeGypBin build --$($config.ToLower())
    if ($LASTEXITCODE -ne 0) {
        throw "node-gyp build failed (exit code $LASTEXITCODE)"
    }
    Write-Host "  [OK] built" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "[FAIL] Build failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common compile errors:" -ForegroundColor Yellow
    Write-Host "  - 'Cannot find napi.h' -> node-addon-api include path wrong in binding.gyp"
    Write-Host "  - 'mmdeviceapi.h not found' -> need Windows 10 SDK (comes with VS Build Tools)"
    Write-Host "  - unresolved externals in WASAPI -> check 'libraries' in binding.gyp"
    Pop-Location
    exit 1
}
Pop-Location

# ── Copy to shared location ────────────────────────────────────────────
$BuiltNode = Join-Path $AddonDir "build\$config\pas_engine.node"
if (-not (Test-Path $BuiltNode)) {
    Write-Host ""
    Write-Host "[FAIL] Built file not found at: $BuiltNode" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $BuildOutDir)) {
    New-Item -ItemType Directory -Path $BuildOutDir -Force | Out-Null
}

Copy-Item -Path $BuiltNode -Destination $ExpectedOut -Force

$fi = Get-Item $ExpectedOut
Write-Host ""
Write-Host "Build artifact:" -ForegroundColor Cyan
Write-Host "  Path:     $($fi.FullName)"
Write-Host "  Size:     $([math]::Round($fi.Length / 1KB, 2)) KB"
Write-Host "  Modified: $($fi.LastWriteTime)"
Write-Host ""

# ── Smoke test ─────────────────────────────────────────────────────────
Write-Host "Running smoke test..." -ForegroundColor Cyan
$escapedPath = $ExpectedOut.Replace('\', '\\')
$testJs = @"
const path = require('path');
const addon = require('$escapedPath');
const keys = Object.keys(addon).sort();
console.log('  Export count: ' + keys.length);
console.log('  Exports:');
for (const k of keys) {
  console.log('    - ' + k);
}
if (typeof addon.init !== 'function') {
  console.error('  ERROR: addon.init is missing');
  process.exit(1);
}
console.log('  [OK] addon.init present');
process.exit(0);
"@

$tempFile = Join-Path $env:TEMP "pas_smoke_$([guid]::NewGuid().ToString('N')).js"
Set-Content -Path $tempFile -Value $testJs -Encoding UTF8

try {
    & node $tempFile
    $smokeExit = $LASTEXITCODE
} catch {
    Write-Host "  [FAIL] node execution failed: $_" -ForegroundColor Red
    Remove-Item $tempFile -ErrorAction SilentlyContinue
    exit 1
} finally {
    Remove-Item $tempFile -ErrorAction SilentlyContinue
}

if ($smokeExit -ne 0) {
    Write-Host ""
    Write-Host "[FAIL] Smoke test failed - addon loaded but exports are wrong" -ForegroundColor Red
    exit 1
}

# ── Done ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Build complete." -ForegroundColor Green
Write-Host "  Restart the app or call window.pas.native.reload() to pick up." -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
exit 0