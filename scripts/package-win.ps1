<#
.SYNOPSIS
    Packages Priority Audio Studio into a Windows NSIS installer via electron-builder.

.DESCRIPTION
    1. Verifies prerequisites (Node.js, electron-builder, native addon).
    2. Cleans dist/ and release/.
    3. Runs vite build (production bundle).
    4. Runs electron-builder --win nsis --x64.
    5. Copies native addon into release/win-unpacked/resources/native/.
    6. Repacks NSIS installer so the .node file is embedded.
    7. Reports installer path and size.

.PARAMETER SkipNativeRebuild
    Skip the native addon check. Use for M1-only builds (no C++ engine).

.PARAMETER Portable
    Also produce a portable .exe (no installer).

.EXAMPLE
    .\scripts\package-win.ps1
    .\scripts\package-win.ps1 -SkipNativeRebuild
    .\scripts\package-win.ps1 -Portable
#>

[CmdletBinding()]
param(
    [switch]$SkipNativeRebuild,
    [switch]$Portable
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Priority Audio Studio - Windows Packaging (M5)" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# ── Paths ──────────────────────────────────────────────────────────────
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$DistDir     = Join-Path $ProjectRoot "dist"
$ReleaseDir  = Join-Path $ProjectRoot "release"
$NativeAddon = Join-Path $ProjectRoot "audio-engine\build\Release\pas_engine.node"
$EBPath      = Join-Path $ProjectRoot "node_modules\.bin\electron-builder.cmd"

# ── Prereqs ────────────────────────────────────────────────────────────
Write-Host "Checking prerequisites..." -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  [FAIL] node not found" -ForegroundColor Red
    exit 1
}
$nodeVer = (& node --version).Trim()
Write-Host "  [OK] node $nodeVer" -ForegroundColor Green

if (-not (Test-Path $EBPath)) {
    Write-Host "  [FAIL] electron-builder not installed" -ForegroundColor Red
    Write-Host "         Run: npm install --save-dev electron-builder" -ForegroundColor Yellow
    exit 1
}
Write-Host "  [OK] electron-builder installed" -ForegroundColor Green

# electron-builder config in package.json?
$pkgPath = Join-Path $ProjectRoot "package.json"
$pkgJson = Get-Content $pkgPath -Raw | ConvertFrom-Json
if (-not $pkgJson.build) {
    Write-Host "  [WARN] package.json has no 'build' section for electron-builder" -ForegroundColor Yellow
    Write-Host "         Adding a minimal default config..." -ForegroundColor Yellow

    # Minimal config — user can customize
    $defaultBuild = [ordered]@{
        appId = "com.priorityaudio.studio"
        productName = "Priority Audio Studio"
        directories = @{
            output = "release"
            buildResources = "assets"
        }
        files = @(
            "dist/**/*",
            "electron/**/*",
            "package.json"
        )
        extraResources = @(
            @{
                from = "audio-engine/build/Release"
                to = "native"
                filter = @("*.node")
            }
        )
        win = @{
            target = @(
                @{ target = "nsis"; arch = @("x64") }
            )
            icon = "assets/icon.ico"
        }
        nsis = @{
            oneClick = $false
            perMachine = $false
            allowElevation = $true
            allowToChangeInstallationDirectory = $true
            createDesktopShortcut = $true
            createStartMenuShortcut = $true
            shortcutName = "Priority Audio Studio"
        }
    }

    $pkgJson | Add-Member -NotePropertyName "build" -NotePropertyValue $defaultBuild -Force
    $pkgJson | ConvertTo-Json -Depth 20 | Set-Content -Path $pkgPath -Encoding UTF8
    Write-Host "  [OK] added default 'build' config to package.json" -ForegroundColor Green
} else {
    Write-Host "  [OK] package.json has 'build' config" -ForegroundColor Green
}

# Native addon
if ($SkipNativeRebuild) {
    Write-Host "  [SKIP] native addon check (-SkipNativeRebuild)" -ForegroundColor Yellow
} else {
    if (-not (Test-Path $NativeAddon)) {
        Write-Host "  [FAIL] Native addon not built: $NativeAddon" -ForegroundColor Red
        Write-Host "         Run scripts\build-native.ps1 first." -ForegroundColor Yellow
        Write-Host "         For M1-only builds use: -SkipNativeRebuild" -ForegroundColor Yellow
        exit 1
    }
    $addonFi = Get-Item $NativeAddon
    Write-Host "  [OK] native addon: $([math]::Round($addonFi.Length/1KB,2)) KB" -ForegroundColor Green
}

# Icon
$iconPath = Join-Path $ProjectRoot "assets\icon.ico"
if (-not (Test-Path $iconPath)) {
    Write-Host "  [WARN] assets\icon.ico missing - installer will use Electron default icon" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] icon.ico present" -ForegroundColor Green
}

# ── Clean ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Cleaning previous build output..." -ForegroundColor Cyan

foreach ($dir in @($DistDir, $ReleaseDir)) {
    if (Test-Path $dir) {
        Write-Host "  Removing $dir"
        try {
            Remove-Item -Path $dir -Recurse -Force
        } catch {
            Write-Host "  [FAIL] Could not remove ${dir}: $_" -ForegroundColor Red
            Write-Host "         Is the app running? Close it and retry." -ForegroundColor Yellow
            exit 1
        }
    }
}
Write-Host "  [OK] clean" -ForegroundColor Green

# ── Vite production build ──────────────────────────────────────────────
Write-Host ""
Write-Host "Running vite build..." -ForegroundColor Cyan
Push-Location $ProjectRoot
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "vite build failed (exit code $LASTEXITCODE)"
    }
} catch {
    Write-Host "  [FAIL] $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

if (-not (Test-Path $DistDir)) {
    Write-Host "  [FAIL] dist/ not created" -ForegroundColor Red
    exit 1
}
$distFiles = Get-ChildItem $DistDir -Recurse -File
Write-Host "  [OK] dist/ ($($distFiles.Count) files, $([math]::Round((($distFiles | Measure-Object Length -Sum).Sum / 1MB), 2)) MB)" -ForegroundColor Green

# ── electron-builder ──────────────────────────────────────────────────
Write-Host ""
Write-Host "Running electron-builder (NSIS x64)..." -ForegroundColor Cyan

$ebArgs = @("--win", "nsis", "--x64")
if ($Portable) { $ebArgs += "--config.win.target=portable" }

Push-Location $ProjectRoot
try {
    & $EBPath @ebArgs
    if ($LASTEXITCODE -ne 0) {
        throw "electron-builder failed (exit code $LASTEXITCODE)"
    }
} catch {
    Write-Host "  [FAIL] $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "  [OK] packaging complete" -ForegroundColor Green

# ── Verify native addon in packaged output ─────────────────────────────
$UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
$PackagedAddon = Join-Path $UnpackedDir "resources\native\pas_engine.node"

if ($SkipNativeRebuild) {
    Write-Host "  [SKIP] native addon verification" -ForegroundColor Yellow
} elseif (Test-Path $PackagedAddon) {
    $pfi = Get-Item $PackagedAddon
    Write-Host "  [OK] native addon packaged: $([math]::Round($pfi.Length/1KB,2)) KB" -ForegroundColor Green
} else {
    Write-Host "  [WARN] native addon NOT found in packaged output" -ForegroundColor Yellow
    Write-Host "         Attempting manual copy + repack..." -ForegroundColor Yellow

    $ResourcesNative = Join-Path $UnpackedDir "resources\native"
    if (-not (Test-Path $ResourcesNative)) {
        New-Item -ItemType Directory -Path $ResourcesNative -Force | Out-Null
    }
    Copy-Item -Path $NativeAddon -Destination $PackagedAddon -Force
    Write-Host "  [OK] copied addon manually" -ForegroundColor Green

    Write-Host "  Repacking NSIS installer..." -ForegroundColor Cyan
    Push-Location $ProjectRoot
    try {
        & $EBPath --win nsis --x64 --prepackaged $UnpackedDir
        if ($LASTEXITCODE -ne 0) {
            throw "repack failed"
        }
    } catch {
        Write-Host "  [FAIL] repack failed: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Host "  [OK] repacked" -ForegroundColor Green
}

# ── Final report ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Packaging complete" -ForegroundColor Green
Write-Host "===============================================================" -ForegroundColor Cyan

$installers = @()
if (Test-Path $ReleaseDir) {
    $installers = Get-ChildItem $ReleaseDir -File |
        Where-Object { $_.Extension -in '.exe', '.msi' }
}

if ($installers.Count -gt 0) {
    foreach ($inst in $installers) {
        $sizeMB = [math]::Round($inst.Length / 1MB, 2)
        Write-Host ""
        Write-Host "  Installer: $($inst.Name)" -ForegroundColor Green
        Write-Host "             $sizeMB MB"
        Write-Host "             $($inst.FullName)"
    }
} else {
    Write-Host "  [WARN] No installer found in $ReleaseDir" -ForegroundColor Yellow
}

$UnpackedExe = Join-Path $ReleaseDir "win-unpacked\Priority Audio Studio.exe"
if (Test-Path $UnpackedExe) {
    Write-Host ""
    Write-Host "  Portable app:" -ForegroundColor Cyan
    Write-Host "    $UnpackedExe"
}

Write-Host ""
Write-Host "  Post-build smoke test checklist:" -ForegroundColor Yellow
Write-Host "    [ ] Installer runs without error"
Write-Host "    [ ] App launches, Dashboard renders"
Write-Host "    [ ] CABLE Input appears in output device list"
Write-Host "    [ ] Play a file -> meters show activity"
Write-Host "    [ ] BlueStacks mic receives audio (verify in Free Fire)"
Write-Host "    [ ] Uninstaller removes all files cleanly"
Write-Host "===============================================================" -ForegroundColor Cyan
exit 0