#!/usr/bin/env pwsh
# Windows install script for Rey30 IDvj app

param(
    [string]$IsNightly = "false"
)

$installerPath = "$env:TEMP\rey30-installer.exe"
$isNightly = [System.Convert]::ToBoolean($IsNightly)

Write-Host "Installing Rey30 IDvj app..."
Write-Host "Is nightly build: $isNightly"

# Try silent installation first
try {
    Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -NoNewWindow
    Write-Host "Rey30 IDvj app installed silently"
}
catch {
    Write-Host "Silent installation failed, trying normal installation..."
    Start-Process -FilePath $installerPath -Wait -NoNewWindow
}

# Wait a bit for installation to complete
Start-Sleep -Seconds 10

Write-Host "[INFO] Waiting for Rey30 IDvj app first initialization (120 seconds)..."
Write-Host "This allows Rey30 IDvj to complete its initial setup and configuration"
Start-Sleep -Seconds 120
Write-Host "[SUCCESS] Initialization wait completed"

# Verify installation based on nightly flag
if ($isNightly) {
    $defaultRey30 IDvjPath = "$env:LOCALAPPDATA\Programs\rey30-nightly\Rey30-IDvj-nightly.exe"
    $processName = "Rey30-IDvj-nightly.exe"
} else {
    $defaultRey30 IDvjPath = "$env:LOCALAPPDATA\Programs\Rey30 IDvj\Rey30-IDvj.exe"
    $processName = "Rey30-IDvj.exe"
}

if (Test-Path $defaultRey30 IDvjPath) {
    Write-Host "Rey30 IDvj app installed successfully at: $defaultRey30 IDvjPath"
    Write-Output "REY30_APP_PATH=$defaultRey30 IDvjPath" >> $env:GITHUB_ENV
    Write-Output "REY30_PROCESS_NAME=$processName" >> $env:GITHUB_ENV
} else {
    Write-Warning "Rey30 IDvj app not found at expected location: $defaultRey30 IDvjPath"
    Write-Host "Will auto-detect during test run"
}
