#!/usr/bin/env pwsh
# Windows download script for Rey30 IDvj app

param(
    [string]$WorkflowInputUrl = "",
    [string]$WorkflowInputIsNightly = "",
    [string]$RepoVariableUrl = "",
    [string]$RepoVariableIsNightly = "",
    [string]$DefaultUrl = "",
    [string]$DefaultIsNightly = ""
)

# Determine Rey30 IDvj app URL and nightly flag from multiple sources (priority order):
# 1. Workflow dispatch input (manual trigger)
# 2. Repository variable REY30_APP_URL
# 3. Default URL from env

$rey30AppUrl = ""
$isNightly = $false

if ($WorkflowInputUrl -ne "") {
    $rey30AppUrl = $WorkflowInputUrl
    $isNightly = [System.Convert]::ToBoolean($WorkflowInputIsNightly)
    Write-Host "Using Rey30 IDvj app URL from workflow input: $rey30AppUrl"
    Write-Host "Is nightly build: $isNightly"
}
elseif ($RepoVariableUrl -ne "") {
    $rey30AppUrl = $RepoVariableUrl
    $isNightly = [System.Convert]::ToBoolean($RepoVariableIsNightly)
    Write-Host "Using Rey30 IDvj app URL from repository variable: $rey30AppUrl"
    Write-Host "Is nightly build: $isNightly"
}
else {
    $rey30AppUrl = $DefaultUrl
    $isNightly = [System.Convert]::ToBoolean($DefaultIsNightly)
    Write-Host "Using default Rey30 IDvj app URL: $rey30AppUrl"
    Write-Host "Is nightly build: $isNightly"
}

# Set environment variables for later steps
Write-Output "REY30_APP_URL=$rey30AppUrl" >> $env:GITHUB_ENV
Write-Output "IS_NIGHTLY=$isNightly" >> $env:GITHUB_ENV

Write-Host "Downloading Rey30 IDvj app from: $rey30AppUrl"

$downloadPath = "$env:TEMP\rey30-installer.exe"

try {
    # Use wget for better performance
    wget.exe "$rey30AppUrl" -O "$downloadPath"

    if (Test-Path $downloadPath) {
        $fileSize = (Get-Item $downloadPath).Length
        Write-Host "Downloaded Rey30 IDvj app successfully. Size: $fileSize bytes"
        Write-Host "File saved to: $downloadPath"
    } else {
        throw "Downloaded file not found"
    }
}
catch {
    Write-Error "Failed to download Rey30 IDvj app: $_"
    exit 1
}
