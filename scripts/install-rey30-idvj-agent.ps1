#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Dir = $env:REY30_INSTALL_DIR,
    [switch]$Source,
    [switch]$AddToPath
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Dir) { $Dir = Join-Path $env:USERPROFILE '.local\bin' }
$destinationRoot = [IO.Path]::GetFullPath($Dir)
$manifestPath = Join-Path $projectRoot 'src-tauri\rey30-idvj-cli\Cargo.toml'
$cliTargetRoot = Join-Path $projectRoot 'src-tauri\rey30-idvj-cli\target'
foreach ($profile in @('debug', 'release')) {
    $guiOutput = Join-Path $projectRoot ('src-tauri\target\' + $profile)
    if ($destinationRoot.TrimEnd('\', '/') -ieq $guiOutput.TrimEnd('\', '/')) {
        throw 'La carpeta de salida de la aplicacion GUI no puede ser destino del CLI.'
    }
}
if (Test-Path -LiteralPath $destinationRoot -PathType Container) {
    $entries = @(Get-ChildItem -LiteralPath $destinationRoot -Force)
    $uninstaller = @($entries | Where-Object { -not $_.PSIsContainer -and $_.Name -ieq 'uninstall.exe' })
    $resources = @($entries | Where-Object { $_.PSIsContainer -and $_.Name -ieq 'resources' })
    $guiBinary = @($entries | Where-Object { -not $_.PSIsContainer -and $_.Name -ieq 'Rey30-IDvj.exe' })
    if ($uninstaller.Count -gt 0 -or ($resources.Count -gt 0 -and $guiBinary.Count -gt 0)) {
        throw 'El destino contiene una aplicacion GUI; el CLI se debe instalar en otra carpeta.'
    }
}
# Source builds keep this distribution independent of upstream release channels.
& cargo build --release --manifest-path $manifestPath --target-dir $cliTargetRoot --no-default-features --features cli
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el CLI Rey30 IDvj.' }
$binary = Join-Path $cliTargetRoot 'release\rey30-idvj.exe'
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "No se encontro $binary" }
New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
$destination = Join-Path $destinationRoot 'rey30-idvj.exe'
if (Test-Path -LiteralPath $destination) {
    $backup = $destination + '.backup-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')
    Copy-Item -LiteralPath $destination -Destination $backup -ErrorAction Stop
}
Copy-Item -LiteralPath $binary -Destination $destination -Force
if ($AddToPath) {
    $environmentKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try {
        $currentPath = $environmentKey.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
        $valueKind = if ($environmentKey.GetValueNames() -contains 'Path') {
            $environmentKey.GetValueKind('Path')
        } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
        if ($valueKind -notin @([Microsoft.Win32.RegistryValueKind]::String, [Microsoft.Win32.RegistryValueKind]::ExpandString)) {
            throw 'El PATH existente usa un formato inesperado; se conserva sin cambios.'
        }
        if (($currentPath -split ';') -notcontains $destinationRoot) {
            $newPath = ($currentPath -as [string]).TrimEnd(';') + ';' + $destinationRoot
            $environmentKey.SetValue('Path', $newPath, $valueKind)
        }
    } finally {
        $environmentKey.Dispose()
    }
}
Write-Output "CLI instalado: $destination"
