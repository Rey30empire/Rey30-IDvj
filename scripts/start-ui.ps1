param(
    [switch]$Dev,
    [switch]$Check,
    # Open the existing copy even if the code is newer.
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$candidates = @(
    (Join-Path $projectRoot 'artifacts\desktop\Rey30-IDvj.exe'),
    (Join-Path $projectRoot 'src-tauri\target\release\Rey30-IDvj.exe'),
    (Join-Path $projectRoot 'src-tauri\target\debug\Rey30-IDvj.exe')
)

# The copy this launcher opens is a snapshot, so a commit to the app's code
# leaves it behind. Bring it up to date first, or say why it could not be.
function Update-PublishedApp {
    $published = $candidates[0]
    $seconds = & git -C $projectRoot log -1 --format=%ct -- web-app src-tauri core extensions package.json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $seconds) { return }
    $changed = [DateTimeOffset]::FromUnixTimeSeconds([long]$seconds).UtcDateTime
    if ((Test-Path -LiteralPath $published -PathType Leaf) -and (Get-Item -LiteralPath $published).LastWriteTimeUtc -ge $changed) { return }

    Write-Host 'Hay cambios nuevos en el codigo: actualizando Rey30 IDvj.'
    try {
        $built = Join-Path $projectRoot 'src-tauri\target\release\Rey30-IDvj.exe'
        $fresh = (Test-Path -LiteralPath $built -PathType Leaf) -and (Get-Item -LiteralPath $built).LastWriteTimeUtc -ge $changed
        & (Join-Path $PSScriptRoot 'build-desktop.ps1') -PublishOnly:$fresh
    } catch {
        Write-Warning "No se pudo actualizar: $($_.Exception.Message)"
        Write-Warning 'Se abrira la version anterior.'
        # The window closes as soon as the app opens; leave time to read this.
        Start-Sleep -Seconds 10
    }
}

if (-not $Dev) {
    if (-not $Check -and -not $NoBuild) { Update-PublishedApp }
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
