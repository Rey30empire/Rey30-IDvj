# Builds the release app and publishes it to artifacts\desktop, the copy that
# Iniciar-Rey30-IDvj.bat opens. Run it directly to force a fresh build.
param(
    # Publish the existing release build without compiling again.
    [switch]$PublishOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $projectRoot 'src-tauri\target\release'
$desktop = Join-Path $projectRoot 'artifacts\desktop'
$publishedExe = Join-Path $desktop 'Rey30-IDvj.exe'

$running = Get-Process -Name 'Rey30-IDvj' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $publishedExe }
if ($running) {
    throw 'Rey30 IDvj esta abierto. Cierralo y vuelve a intentarlo para poder actualizarlo.'
}

Set-Location -LiteralPath $projectRoot
if (-not $PublishOnly) {
    Write-Host 'Compilando Rey30 IDvj (puede tardar de 10 a 20 minutos)...'
    & corepack.cmd yarn tauri build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo (codigo $LASTEXITCODE)." }
}

$builtExe = Join-Path $release 'Rey30-IDvj.exe'
if (-not (Test-Path -LiteralPath $builtExe -PathType Leaf)) {
    throw "No existe la compilacion en $builtExe."
}

New-Item -ItemType Directory -Force -Path $desktop | Out-Null
Copy-Item -LiteralPath $builtExe -Destination $publishedExe -Force
$resources = Join-Path $release 'resources'
if (Test-Path -LiteralPath $resources -PathType Container) {
    Copy-Item -Path (Join-Path $resources '*') -Destination (New-Item -ItemType Directory -Force -Path (Join-Path $desktop 'resources')).FullName -Recurse -Force
}

$manifest = Join-Path $desktop 'BUILD.json'
if (Test-Path -LiteralPath $manifest -PathType Leaf) {
    $build = [System.IO.File]::ReadAllText($manifest) | ConvertFrom-Json
    $build.createdAt = (Get-Date).ToUniversalTime().ToString('o')
    $build.releaseSha256 = (Get-FileHash -LiteralPath $publishedExe -Algorithm SHA256).Hash.ToLowerInvariant()
    $commit = (& git -C $projectRoot rev-parse HEAD).Trim()
    $build | Add-Member -NotePropertyName 'commit' -NotePropertyValue $commit -Force
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($manifest, ($build | ConvertTo-Json -Depth 8), $encoding)
}

Write-Host "Rey30 IDvj actualizado en $desktop"
