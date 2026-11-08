[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [string] $OfficialDirectory = (Join-Path $PSScriptRoot '../src-tauri/resources/pluma-llama'),
    [string] $SourceArchive = (Join-Path $PSScriptRoot '../artifacts/downloads/pluma/llama-8642541b.tar.gz')
)

$ErrorActionPreference = 'Stop'
$commit = '8642541b255bfb5dc39cd351a178be09013a55d6'
$archiveUrl = "https://codeload.github.com/ggml-org/llama.cpp/tar.gz/$commit"
$archiveHash = '1688a167a8edd9499cdd0c19b8bd044f0fa184b466981977bbf2222d884953a4'
$officialHash = 'bac6914b5e83523eb008c6789eaa12669f93fbc196c3b9e8237b6672323b33e9'
$officialMtmdHash = 'e82d563ae9dad225a3d15d0f189e046909713e26759ae9a046f89430bc845bd3'

function Get-Sha256([string] $File) {
    (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Confirm-Command([string] $Description) {
    if ($LASTEXITCODE -ne 0) { throw "$Description (código $LASTEXITCODE)." }
}

$output = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Selecciona un directorio de salida nuevo.' }
$official = (Resolve-Path -LiteralPath $OfficialDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $official 'SOURCE.json') -Raw | ConvertFrom-Json
if ($manifest.commit -ne $commit -or $manifest.tag -ne 'b11960' -or $manifest.archiveSha256 -ne $officialHash) {
    throw 'Se requiere el motor oficial verificado. Ejecuta primero node scripts/prepare-pluma-runtime.mjs.'
}
foreach ($resource in $manifest.resources) {
    if ($resource.name -ne [IO.Path]::GetFileName($resource.name)) { throw 'Nombre de recurso inválido.' }
    $file = Get-Item -LiteralPath (Join-Path $official $resource.name)
    if ($file.Length -ne $resource.bytes -or (Get-Sha256 $file.FullName) -ne $resource.sha256) {
        throw "El recurso oficial no coincide: $($resource.name)."
    }
}
if ((Get-Sha256 (Join-Path $official 'mtmd.dll')) -ne $officialMtmdHash) { throw 'mtmd.dll oficial inválida.' }

$archive = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SourceArchive)
if (!(Test-Path -LiteralPath $archive)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $archive) | Out-Null
    & curl.exe --fail --location --retry 2 --max-time 120 --output "$archive.part" $archiveUrl
    Confirm-Command 'Falló la descarga del código fuente'
    if ((Get-Sha256 "$archive.part") -ne $archiveHash) { throw 'SHA-256 incorrecto para el código fuente.' }
    Move-Item -LiteralPath "$archive.part" -Destination $archive
}
if ((Get-Sha256 $archive) -ne $archiveHash) { throw 'SHA-256 incorrecto para el código fuente.' }

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$visualStudio = & $vswhere -latest -version '[17.0,18.0)' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
Confirm-Command 'Falló la detección de Visual Studio 2022'
if (!$visualStudio) { throw 'Instala Visual Studio 2022 con las herramientas de compilación de C++ x64.' }
$toolset = Get-Content -LiteralPath (Join-Path $visualStudio 'VC/Auxiliary/Build/Microsoft.VCToolsVersion.default.txt') -TotalCount 1
$tools = Join-Path $visualStudio "VC/Tools/MSVC/$toolset/bin/Hostx64/x64"
$dumpbin = Join-Path $tools 'dumpbin.exe'
$libTool = Join-Path $tools 'lib.exe'

$work = Join-Path (Split-Path -Parent $archive) ("tts-build-" + [Guid]::NewGuid().ToString('N'))
$imports = Join-Path $work 'imports'
New-Item -ItemType Directory -Force -Path $imports | Out-Null
& tar.exe -xf $archive -C $work
Confirm-Command 'Falló la extracción del código fuente'
$source = Join-Path $work "llama.cpp-$commit"
$project = Join-Path $PSScriptRoot 'pluma-tts-runtime'
$patch = Join-Path $project 'qwen-speaker-cache.patch'
& git -C $source init --quiet
Confirm-Command 'Falló la preparación del directorio aislado'
& git -C $source apply $patch
Confirm-Command 'Falló la aplicación del parche de timbre'

foreach ($name in @('llama', 'ggml', 'ggml-base')) {
    $exports = @(& $dumpbin /EXPORTS (Join-Path $official "$name.dll") | ForEach-Object {
        if ($_ -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)') { $Matches[1] }
    })
    Confirm-Command "Falló la lectura de las exportaciones de $name.dll"
    if (!$exports.Count) { throw "Sin exportaciones para $name.dll." }
    $definition = Join-Path $imports "$name.def"
    @("LIBRARY $name.dll", 'EXPORTS') + $exports | Set-Content -LiteralPath $definition -Encoding ascii
    & $libTool /NOLOGO "/DEF:$definition" /MACHINE:X64 "/OUT:$imports/$name.lib"
    Confirm-Command "Falló la biblioteca de importación para $name.dll"
}

$build = Join-Path $work 'build'
& cmake -S $project -B $build -G 'Visual Studio 17 2022' -A x64 "-DUPSTREAM=$source" "-DIMPORTS=$imports" "-DCMAKE_GENERATOR_INSTANCE=$visualStudio"
Confirm-Command 'Falló la configuración de mtmd'
& cmake --build $build --config Release --target mtmd --parallel
Confirm-Command 'Falló la compilación de mtmd'
$patched = Join-Path $build 'mtmd/Release/mtmd.dll'

$parent = Split-Path -Parent $output
$stage = Join-Path $parent ('.pluma-tts-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $parent | Out-Null
New-Item -ItemType Directory -Path $stage | Out-Null
$resources = foreach ($resource in $manifest.resources) {
    $inputFile = if ($resource.name -eq 'mtmd.dll') { $patched } else { Join-Path $official $resource.name }
    $file = Get-Item -LiteralPath $inputFile
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $stage $resource.name)
    [ordered]@{ name = $resource.name; bytes = $file.Length; sha256 = Get-Sha256 $file.FullName }
}

$manifest | Add-Member -NotePropertyName modified -NotePropertyValue ([ordered]@{
    resource = 'mtmd.dll'
    stockSha256 = $officialMtmdHash
    sourceArchiveUrl = $archiveUrl
    sourceArchiveSha256 = $archiveHash
    patch = 'scripts/pluma-tts-runtime/qwen-speaker-cache.patch'
    patchSha256 = Get-Sha256 $patch
    build = 'scripts/prepare-pluma-tts-runtime.ps1'
    toolchain = "MSVC $toolset, Release x64"
})
$manifest.resources = @($resources)
$json = ($manifest | ConvertTo-Json -Depth 6) + "`n"
[IO.File]::WriteAllText((Join-Path $stage 'SOURCE.json'), $json, [Text.UTF8Encoding]::new($false))
& (Join-Path $stage 'llama-server.exe') --version
Confirm-Command 'El motor con la DLL recompilada no arrancó'

if (Test-Path -LiteralPath $output) { throw 'El directorio de salida ya existe.' }
Move-Item -LiteralPath $stage -Destination $output
Write-Host "Motor Qwen preparado en $output"
