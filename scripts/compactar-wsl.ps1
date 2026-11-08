# Compacta el disco virtual de Ubuntu (WSL) para devolver a C: el espacio que
# ya no usa. Necesita permisos de administrador: si no los tiene, se vuelve a
# abrir pidiéndolos (aviso de UAC). Apaga WSL mientras trabaja.
param([string]$Log = (Join-Path $PSScriptRoot '..\artifacts\qa\compactar-wsl.log'))

$ErrorActionPreference = 'Stop'
$vhd = 'C:\Users\rey30\AppData\Local\wsl\{41c63989-a173-4f06-a97f-6b0ad7b0b196}\ext4.vhdx'
$Log = [IO.Path]::GetFullPath($Log)

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $process = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Log', "`"$Log`"")
    exit $process.ExitCode
}

New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
Start-Transcript -LiteralPath $Log -Force | Out-Null
try {
    if (-not (Test-Path -LiteralPath $vhd)) { throw "No existe $vhd" }
    $before = (Get-Item -LiteralPath $vhd).Length
    Write-Output ("Antes: {0:N1} GB" -f ($before / 1GB))
    wsl.exe --shutdown
    Start-Sleep -Seconds 5
    $commands = @(
        "select vdisk file=`"$vhd`""
        'attach vdisk readonly'
        'compact vdisk'
        'detach vdisk'
    ) -join "`r`n"
    $script = Join-Path $env:TEMP 'rey30-compactar-wsl.txt'
    Set-Content -LiteralPath $script -Value $commands -Encoding ascii
    diskpart.exe /s $script
    $code = $LASTEXITCODE
    Remove-Item -LiteralPath $script -Force
    if ($code -ne 0) { throw "diskpart terminó con código $code" }
    $after = (Get-Item -LiteralPath $vhd).Length
    Write-Output ("Despues: {0:N1} GB" -f ($after / 1GB))
    Write-Output ("Recuperado en C: {0:N1} GB" -f (($before - $after) / 1GB))
    Write-Output 'RESULTADO: OK'
} catch {
    Write-Output "RESULTADO: ERROR $($_.Exception.Message)"
    exit 1
} finally {
    Stop-Transcript | Out-Null
}
