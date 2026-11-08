param(
    [switch]$Dev,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$candidates = @(
    (Join-Path $projectRoot 'artifacts\desktop\Rey30-IDvj.exe'),
    (Join-Path $projectRoot 'src-tauri\target\release\Rey30-IDvj.exe'),
    (Join-Path $projectRoot 'src-tauri\target\debug\Rey30-IDvj.exe')
)

if (-not $Dev) {
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            if ($Check) {
                Write-Output "UI compilada: $candidate"
                exit 0
            }
            if (-not $env:REY30_CONFIG_HOME) {
                $agentHome = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Rey30-IDvj\agent'
                New-Item -ItemType Directory -Force -Path $agentHome | Out-Null
                $env:REY30_CONFIG_HOME = $agentHome
            }
            $launch = New-Object System.Diagnostics.ProcessStartInfo
            $launch.FileName = $candidate
            $launch.WorkingDirectory = Split-Path -Parent $candidate
            $launch.UseShellExecute = $false
            $launch.CreateNoWindow = $true
            $process = [System.Diagnostics.Process]::Start($launch)
            if (-not $process) { throw 'Windows no pudo crear el proceso de Rey30 IDvj.' }
            exit 0
        }
    }
}

if (-not (Get-Command corepack.cmd -ErrorAction SilentlyContinue)) {
    throw 'Se necesita Node.js con Corepack para iniciar el modo de desarrollo.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules') -PathType Container)) {
    throw 'Faltan dependencias. Ejecuta corepack yarn install en la carpeta del proyecto.'
}
if ($Check) {
    Write-Output 'UI disponible en modo de desarrollo mediante corepack yarn dev.'
    exit 0
}

Set-Location -LiteralPath $projectRoot
if (-not $env:REY30_CONFIG_HOME) {
    $agentHome = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Rey30-IDvj\agent'
    New-Item -ItemType Directory -Force -Path $agentHome | Out-Null
    $env:REY30_CONFIG_HOME = $agentHome
}
& corepack.cmd yarn dev
exit $LASTEXITCODE
