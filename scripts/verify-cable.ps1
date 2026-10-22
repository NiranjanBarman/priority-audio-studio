<#
.SYNOPSIS
    Verifies VB-CABLE installation and configuration for Voice Priority Audio.

.DESCRIPTION
    Runs 5 checks:
      1. VB-CABLE driver is installed (via Get-PnpDevice).
      2. 'CABLE Input' playback endpoint exists.
      3. 'CABLE Output' recording endpoint exists.
      4. Sample rates on both endpoints match.
      5. 'CABLE Input' is NOT the default playback device.

    Exit code 0 = all pass (or warnings only). Exit code 1 = blocking failures.

.EXAMPLE
    .\scripts\verify-cable.ps1
#>

[CmdletBinding()]
param()

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Voice Priority Audio - VB-CABLE Verification" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

$fail = 0
$warn = 0

$RenderKey  = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render"
$CaptureKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture"

# PKEY_FriendlyName = {a45c254e-df1c-4efd-8020-67d146a850e0},2
# PKEY_AudioEngine_DeviceFormat = {e4870e26-3cc5-4cd2-ba46-ca0a9a70ed04},3
$PKEY_FriendlyName = "{a45c254e-df1c-4efd-8020-67d146a850e0},2"
$PKEY_DeviceFormat = "{e4870e26-3cc5-4cd2-ba46-ca0a9a70ed04},3"

# ── Check 1: VB-CABLE driver installed ─────────────────────────────────
Write-Host "[1/5] VB-CABLE driver presence..." -ForegroundColor Cyan

$vbcableDevices = @()
try {
    $vbcableDevices = Get-PnpDevice -Class MEDIA -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -match "VB-Audio|VB-CABLE|CABLE" }
} catch {
    Write-Host "  [WARN] Get-PnpDevice failed: $_" -ForegroundColor Yellow
    $warn++
}

if ($vbcableDevices -and $vbcableDevices.Count -gt 0) {
    foreach ($dev in $vbcableDevices) {
        $statusColor = if ($dev.Status -eq "OK") { "Green" } else { "Yellow" }
        Write-Host "  [OK] $($dev.FriendlyName)  [Status: $($dev.Status)]" -ForegroundColor $statusColor
    }
} else {
    Write-Host "  [FAIL] VB-CABLE driver not detected" -ForegroundColor Red
    Write-Host "         Install from: https://vb-audio.com/Cable/" -ForegroundColor Yellow
    Write-Host "         After install: REBOOT REQUIRED." -ForegroundColor Yellow
    $fail++
}

# ── Helpers: find endpoint by friendly name match ──────────────────────
function Find-EndpointByName($baseKey, $namePattern) {
    if (-not (Test-Path $baseKey)) { return $null }

    $result = $null
    Get-ChildItem $baseKey -ErrorAction SilentlyContinue | ForEach-Object {
        $guid = $_.PSChildName
        $propsKey = Join-Path $_.PSPath "Properties"
        if (Test-Path $propsKey) {
            $name = $null
            try {
                $val = Get-ItemProperty -Path $propsKey -Name $PKEY_FriendlyName -ErrorAction SilentlyContinue
                if ($val) { $name = $val.$PKEY_FriendlyName }
            } catch { }
            if ($name -and $name -match $namePattern) {
                $result = [PSCustomObject]@{
                    Guid         = $guid
                    FriendlyName = $name
                    KeyPath      = (Join-Path $baseKey $guid)
                }
            }
        }
    }
    return $result
}

# ── Check 2: CABLE Input (playback) ────────────────────────────────────
Write-Host ""
Write-Host "[2/5] 'CABLE Input' playback endpoint..." -ForegroundColor Cyan

$cableInput = Find-EndpointByName $RenderKey "CABLE Input"
if ($cableInput) {
    Write-Host "  [OK] Found: $($cableInput.FriendlyName)" -ForegroundColor Green
    Write-Host "       GUID: $($cableInput.Guid)"
} else {
    Write-Host "  [FAIL] 'CABLE Input' not found in playback devices" -ForegroundColor Red
    Write-Host "         Windows Sound -> Playback tab -> right-click -> Show Disabled Devices" -ForegroundColor Yellow
    $fail++
}

# ── Check 3: CABLE Output (recording) ──────────────────────────────────
Write-Host ""
Write-Host "[3/5] 'CABLE Output' recording endpoint..." -ForegroundColor Cyan

$cableOutput = Find-EndpointByName $CaptureKey "CABLE Output"
if ($cableOutput) {
    Write-Host "  [OK] Found: $($cableOutput.FriendlyName)" -ForegroundColor Green
    Write-Host "       GUID: $($cableOutput.Guid)"
} else {
    Write-Host "  [FAIL] 'CABLE Output' not found in recording devices" -ForegroundColor Red
    Write-Host "         Windows Sound -> Recording tab -> right-click -> Show Disabled Devices" -ForegroundColor Yellow
    $fail++
}

# ── Helper: read sample rate from PKEY_AudioEngine_DeviceFormat ────────
# The WAVEFORMATEX blob is binary; sample rate is bytes 4-7 (DWORD little-endian).
function Get-DeviceSampleRate($endpoint) {
    if (-not $endpoint) { return $null }
    try {
        $propsKey = Join-Path $endpoint.KeyPath "Properties"
        $val = Get-ItemProperty -Path $propsKey -Name $PKEY_DeviceFormat -ErrorAction Stop
        $bytes = $val.$PKEY_DeviceFormat
        if ($bytes -and $bytes.Length -ge 8) {
            return [BitConverter]::ToUInt32($bytes, 4)
        }
    } catch { }
    return $null
}

# ── Check 4: Sample rate match ─────────────────────────────────────────
Write-Host ""
Write-Host "[4/5] Sample rate match..." -ForegroundColor Cyan

$inSR  = Get-DeviceSampleRate $cableInput
$outSR = Get-DeviceSampleRate $cableOutput

if ($inSR -and $outSR) {
    Write-Host "       CABLE Input  (playback):  $inSR Hz"
    Write-Host "       CABLE Output (recording): $outSR Hz"
    if ($inSR -eq $outSR) {
        Write-Host "  [OK] Sample rates match" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Sample rates DO NOT match - distortion/crackle likely" -ForegroundColor Red
        Write-Host "         Fix: Windows Sound -> each CABLE device -> Properties -> Advanced" -ForegroundColor Yellow
        Write-Host "         Set both to the same rate. Recommended: 48000 Hz, 24-bit." -ForegroundColor Yellow
        $fail++
    }
} else {
    Write-Host "  [WARN] Could not read sample rates from registry" -ForegroundColor Yellow
    Write-Host "         Verify manually: both CABLE devices -> Advanced tab -> same format" -ForegroundColor Yellow
    $warn++
}

# ── Check 5: CABLE Input NOT default playback ──────────────────────────
# Default playback device is stored per-role in the device's key.
# If 'Role:0' (Console default) exists and is non-empty, it's the default.
Write-Host ""
Write-Host "[5/5] CABLE Input is not default playback..." -ForegroundColor Cyan

$isDefault = $false
if ($cableInput) {
    try {
        $roleVal = Get-ItemProperty -Path $cableInput.KeyPath -Name "Role:0" -ErrorAction SilentlyContinue
        if ($roleVal -and $null -ne $roleVal."Role:0") {
            $isDefault = $true
        }
    } catch { }
}

if ($isDefault) {
    Write-Host "  [WARN] CABLE Input is set as default playback device" -ForegroundColor Yellow
    Write-Host "         This is NOT recommended:" -ForegroundColor Yellow
    Write-Host "         - System sounds will route into the cable" -ForegroundColor Yellow
    Write-Host "         - You won't hear anything on your headphones" -ForegroundColor Yellow
    Write-Host "         Fix: Windows Sound -> set headphones/speakers as Default" -ForegroundColor Yellow
    $warn++
} else {
    Write-Host "  [OK] CABLE Input is not the default playback device" -ForegroundColor Green
}

# ── Summary ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan

if ($fail -eq 0 -and $warn -eq 0) {
    Write-Host "  ALL CHECKS PASSED" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor Cyan
    Write-Host "    1. In your game or emulator, set Microphone = CABLE Output"
    Write-Host "    2. Launch Voice Priority Audio -> Dashboard -> Output = CABLE Input"
    Write-Host "    3. Play a file -> verify music reaches the game's microphone"
    Write-Host "===============================================================" -ForegroundColor Cyan
    exit 0
} elseif ($fail -eq 0) {
    Write-Host "  $warn warning(s) - not blocking, but review above" -ForegroundColor Yellow
    Write-Host "===============================================================" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "  $fail check(s) FAILED, $warn warning(s)" -ForegroundColor Red
    Write-Host "  Fix the failures above before proceeding." -ForegroundColor Red
    Write-Host "===============================================================" -ForegroundColor Red
    exit 1
}