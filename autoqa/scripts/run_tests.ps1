#!/usr/bin/env pwsh
# Windows test runner script

param(
    [string]$Rey30AppPath,
    [string]$ProcessName,
    [string]$RpToken
)

Write-Host "Starting Auto QA Tests..."

Write-Host "Rey30 IDvj app path: $Rey30AppPath"
Write-Host "Process name: $ProcessName"
Write-Host "Current working directory: $(Get-Location)"
Write-Host "Contents of current directory:"
Get-ChildItem
Write-Host "Contents of trajectories directory (if exists):"
if (Test-Path "trajectories") {
    Get-ChildItem "trajectories"
} else {
    Write-Host "trajectories directory not found"
}

# Run the main test with proper arguments
if ($Rey30AppPath -and $ProcessName) {
    python main.py --enable-reportportal --rp-token "$RpToken" --rey30-app-path "$Rey30AppPath" --rey30-process-name "$ProcessName"
} elseif ($Rey30AppPath) {
    python main.py --enable-reportportal --rp-token "$RpToken" --rey30-app-path "$Rey30AppPath"
} else {
    python main.py --enable-reportportal --rp-token "$RpToken"
}
