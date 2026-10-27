param([switch]$CheckOnly)

$ErrorActionPreference = "Stop"
$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Version = "0.2.32"
$BuildRoot = Join-Path $env:LOCALAPPDATA "A2RoutineBossTrackerBuild-v$Version"
$ReleaseRoot = Join-Path $SourceDir "release"
$Transcript = Join-Path $SourceDir "WINDOWS_BUILD.log"

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $Hint"
    }
}

function Invoke-Native([string]$Label, [string]$CommandLine) {
    Write-Host "== $Label =="
    & $env:ComSpec /d /s /c "$CommandLine 2>&1"
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed (exit $LASTEXITCODE)"
    }
}

$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
Require-Command "node" "Install Node.js LTS."
Require-Command "npm" "Install Node.js LTS."
Require-Command "cargo" "Install Rust stable-msvc using rustup."
Require-Command "rustc" "Install Rust stable-msvc using rustup."

$VsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $VsWhere)) {
    throw "Visual Studio 2022 Build Tools was not found. Install Desktop development with C++."
}
$VsPath = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $VsPath) {
    throw "Visual Studio C++ build tools were not found."
}

Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"
Write-Host "Rust: $(rustc --version)"
Write-Host "VS:   $VsPath"
if ($CheckOnly) {
    Write-Host "BUILD_ENV_OK"
    exit 0
}

Start-Transcript -Path $Transcript -Force | Out-Null
try {
    New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
    & robocopy $SourceDir $BuildRoot /MIR /XD node_modules target release /XF WINDOWS_BUILD.log | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Copying to the local build folder failed (robocopy $LASTEXITCODE)" }
    Set-Location $BuildRoot

    Invoke-Native "Restore npm dependencies" "npm ci"
    Invoke-Native "JavaScript tests" "npm test"
    Invoke-Native "Rust tests" "cargo test --locked --manifest-path src-tauri/Cargo.toml"
    Invoke-Native "Tauri Windows build" "npm run tauri -- build --bundles nsis"

    $Exe = Join-Path $BuildRoot "src-tauri\target\release\A2RoutineBossTracker.exe"
    if (-not (Test-Path $Exe)) { throw "Built EXE was not found: $Exe" }
    $Installer = Get-ChildItem (Join-Path $BuildRoot "src-tauri\target\release\bundle\nsis\*.exe") |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $Installer) { throw "Built NSIS installer was not found." }

    $PackageDir = Join-Path $ReleaseRoot "A2-Routine-Boss-Tracker-v$Version"
    if (Test-Path $PackageDir) { Remove-Item $PackageDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null
    Copy-Item $Exe (Join-Path $PackageDir "A2RoutineBossTracker.exe")
    Copy-Item (Join-Path $BuildRoot "README.md") (Join-Path $PackageDir "README.md")
    $Hash = (Get-FileHash (Join-Path $PackageDir "A2RoutineBossTracker.exe") -Algorithm SHA256).Hash.ToLowerInvariant()
    "$Hash  A2RoutineBossTracker.exe" | Set-Content (Join-Path $PackageDir "SHA256SUMS.txt") -Encoding ascii

    $Zip = Join-Path $ReleaseRoot "A2-Routine-Boss-Tracker-v$Version-portable.zip"
    if (Test-Path $Zip) { Remove-Item $Zip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $PackageDir,
        $Zip,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )
    $ZipHash = (Get-FileHash $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
    "$ZipHash  $(Split-Path $Zip -Leaf)" | Set-Content (Join-Path $ReleaseRoot "PORTABLE_SHA256.txt") -Encoding ascii

    $InstallerTarget = Join-Path $ReleaseRoot "A2-Routine-Boss-Tracker-v$Version-setup.exe"
    Copy-Item $Installer.FullName $InstallerTarget -Force
    $InstallerHash = (Get-FileHash $InstallerTarget -Algorithm SHA256).Hash.ToLowerInvariant()
    $Checksums = Join-Path $ReleaseRoot "SHA256SUMS.txt"
    @(
        "$ZipHash  $(Split-Path $Zip -Leaf)"
        "$InstallerHash  $(Split-Path $InstallerTarget -Leaf)"
    ) | Set-Content $Checksums -Encoding ascii

    $DistributionRoot = Split-Path $SourceDir -Parent
    $PublishedPackageDir = Join-Path $DistributionRoot "A2-Routine-Boss-Tracker-v$Version-portable"
    $PublishedZip = Join-Path $DistributionRoot "A2-Routine-Boss-Tracker-v$Version-portable.zip"
    $PublishedInstaller = Join-Path $DistributionRoot "A2-Routine-Boss-Tracker-v$Version-setup.exe"
    $PublishedChecksums = Join-Path $DistributionRoot "A2-Routine-Boss-Tracker-v$Version-SHA256SUMS.txt"
    if (Test-Path $PublishedPackageDir) { Remove-Item $PublishedPackageDir -Recurse -Force }
    Copy-Item $PackageDir $PublishedPackageDir -Recurse
    Copy-Item $Zip $PublishedZip -Force
    Copy-Item $InstallerTarget $PublishedInstaller -Force
    Copy-Item $Checksums $PublishedChecksums -Force

    Write-Host "BUILD_OK"
    Write-Host "EXE=$PackageDir\A2RoutineBossTracker.exe"
    Write-Host "ZIP=$Zip"
    Write-Host "INSTALLER=$InstallerTarget"
    Write-Host "CHECKSUMS=$Checksums"
    Write-Host "PUBLISHED_EXE=$PublishedPackageDir\A2RoutineBossTracker.exe"
    Write-Host "PUBLISHED_ZIP=$PublishedZip"
    Write-Host "PUBLISHED_INSTALLER=$PublishedInstaller"
} finally {
    Stop-Transcript | Out-Null
}
