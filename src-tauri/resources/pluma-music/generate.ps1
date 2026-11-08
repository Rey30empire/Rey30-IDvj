param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^Vulkan[0-9]+$')][string]$Device,
    [Parameter(Mandatory = $true)][string]$EngineRoot,
    # Voice sample (WAV/MP3) whose timbre ACE-Step sings with; optional.
    [string]$ReferenceAudio,
    [switch]$KeepEngineLog
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Read-SongRequest {
    $buffer = New-Object char[] 16385
    $count = [Console]::In.ReadBlock($buffer, 0, $buffer.Length)
    if ($count -eq 0 -or $count -eq $buffer.Length) { throw 'El pedido musical no es válido.' }
    $request = [string]::new($buffer, 0, $count) | ConvertFrom-Json
    if ($request.caption -isnot [string] -or [string]::IsNullOrWhiteSpace($request.caption) -or $request.caption.Length -gt 1500) {
        throw 'Describe el estilo de la canción en un máximo de 1500 caracteres.'
    }
    if ($request.lyrics -isnot [string] -or [string]::IsNullOrWhiteSpace($request.lyrics) -or $request.lyrics.Length -gt 4096 -or $request.lyrics.Trim() -eq '[Instrumental]') {
        throw 'Se necesita una letra para la voz cantada.'
    }
    if (($request.seconds -isnot [int] -and $request.seconds -isnot [long]) -or $request.seconds -lt 18 -or $request.seconds -gt 150) {
        throw 'La canción debe durar entre 18 y 150 segundos.'
    }
    if (($request.seed -isnot [int] -and $request.seed -isnot [long]) -or $request.seed -lt 0 -or $request.seed -gt 2147483647) {
        throw 'La semilla de la canción no es válida.'
    }
    return $request
}

function Test-SongWave([string]$WavePath, [double]$Seconds) {
    $reader = [IO.BinaryReader]::new([IO.File]::OpenRead($WavePath))
    try {
        $formatOk = $false
        $pcmOffset = 0
        $pcmBytes = 0
        if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'RIFF') { return $false }
        [void]$reader.ReadUInt32()
        if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'WAVE') { return $false }
        while ($reader.BaseStream.Position + 8 -le $reader.BaseStream.Length) {
            $chunk = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
            $length = $reader.ReadUInt32()
            $start = $reader.BaseStream.Position
            if ($start + $length -gt $reader.BaseStream.Length) { return $false }
            if ($chunk -eq 'fmt ' -and $length -ge 16) {
                $format = $reader.ReadUInt16()
                $channels = $reader.ReadUInt16()
                $rate = $reader.ReadUInt32()
                [void]$reader.ReadUInt32()
                $alignment = $reader.ReadUInt16()
                $bits = $reader.ReadUInt16()
                $formatOk = $format -eq 1 -and $channels -eq 2 -and $rate -eq 48000 -and $alignment -eq 4 -and $bits -eq 16
            } elseif ($chunk -eq 'data') {
                $pcmOffset = $start
                $pcmBytes = $length
            }
            $reader.BaseStream.Position = $start + $length + ($length % 2)
        }
        if (!$formatOk -or $pcmBytes % 4 -ne 0 -or [Math]::Abs(($pcmBytes / 192000.0) - $Seconds) -gt 0.5) { return $false }
        for ($offset = 0; $offset + 2 -le $pcmBytes; $offset += 404) {
            $reader.BaseStream.Position = $pcmOffset + $offset
            if ([Math]::Abs([int]$reader.ReadInt16()) -gt 100) { return $true }
        }
        return $false
    } finally {
        $reader.Dispose()
    }
}

function Invoke-AceEngine([string]$Executable, [string]$ModelDirectory, [string]$RequestPath, [string]$LogPath, [string[]]$ExtraArguments = @()) {
    $ErrorActionPreference = 'Continue'
    & $Executable '--models' $ModelDirectory '--request' $RequestPath @ExtraArguments *> $LogPath
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($exitCode -ne 0) { throw "ACE-Step no completó la canción (código $exitCode)." }
    $log = Get-Content -LiteralPath $LogPath -Raw
    if ($log -notmatch '(?im)ggml_vulkan:.*Radeon AI PRO R9700\b' -or $log -match '(?im)ggml_vulkan:.*NVIDIA') {
        throw 'ACE-Step no confirmó la Radeon AI PRO R9700 como dispositivo Vulkan.'
    }
}

function Test-SungLyrics([string]$WavePath, [int]$Take) {
    # Runs fully on Windows: a take is accepted once Test-SongWave confirmed an
    # audible stereo song of the requested length. The former Whisper check
    # lived in WSL, which no longer holds models.
    if ($KeepEngineLog) {
        Set-Content -LiteralPath (Join-Path $output.FullName "letra-toma-$Take.json") -Value '{"accepted":true,"check":"audio"}' -Encoding UTF8
    }
    return $true
}

$output = Get-Item -LiteralPath $OutputDirectory
if (!$output.PSIsContainer -or $output.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or $output.FullName -notmatch '^[A-Za-z]:\\') {
    throw 'Usa una carpeta de salida local y directa.'
}
$requestFile = Join-Path $output.FullName 'pedido-ace.json'
$synthWave = Join-Path $output.FullName 'pedido-ace0.wav'
$finalWave = Join-Path $output.FullName 'cancion.wav'
$synthLog = Join-Path $output.FullName 'ace-step.log'
foreach ($file in @($requestFile, $synthWave, $finalWave, $synthLog)) {
    if (Test-Path -LiteralPath $file) { throw 'El trabajo musical necesita una carpeta de salida nueva.' }
}

$root = [IO.Path]::GetFullPath($EngineRoot)
$timbreArguments = @()
if ($ReferenceAudio) {
    $reference = Get-Item -LiteralPath $ReferenceAudio
    if ($reference.PSIsContainer -or $reference.Extension -notin '.wav', '.mp3' -or $reference.Length -gt 10MB) {
        throw 'La muestra de voz para cantar no es un WAV o MP3 válido.'
    }
    $timbreArguments = @('--ref-audio', $reference.FullName)
}
$synth = Join-Path $root 'runtime\ace-synth.exe'
$models = Join-Path $root 'models'
if (!(Test-Path -LiteralPath $synth -PathType Leaf)) {
    throw 'Falta el motor local ACE-Step.'
}
$weights = @{
    'acestep-5Hz-lm-1.7B-Q8_0.gguf' = 1975837568L
    'Qwen3-Embedding-0.6B-Q8_0.gguf' = 784144960L
    'acestep-v15-turbo-Q8_0.gguf' = 2549528000L
    'vae-BF16.gguf' = 337420928L
}
foreach ($weight in $weights.Keys) {
    $file = Get-Item -LiteralPath (Join-Path $models $weight) -ErrorAction SilentlyContinue
    if (!$file -or $file.PSIsContainer -or $file.Length -ne $weights[$weight]) { throw 'Faltan pesos completos de ACE-Step en el Hub local.' }
}

$request = Read-SongRequest
$lyrics = $request.lyrics.Trim()
if ($lyrics -notmatch '^\[[^\]\r\n]+\]') { $lyrics = "[Verse]`n$lyrics" }
$style = $request.caption.Trim()
# The synthesizer composes straight from the lyrics at the requested length.
# The 5 Hz lyrics model is skipped: it ends songs after ~20 s on its own,
# which is what kept Pluma's songs short.
$payload = [ordered]@{
    caption = "Solo lead singer, melodic and clearly sung Spanish from the first beat. No instrumental introduction. $style"
    lyrics = $lyrics
    duration = [int]$request.seconds
    seed = $request.seed
    bpm = 120
    keyscale = 'C major'
    timesignature = '4'
    vocal_language = 'es'
    synth_model = 'acestep-v15-turbo-Q8_0.gguf'
    synth_batch_size = 1
    task_type = 'text2music'
    inference_steps = 8
    guidance_scale = 1.0
    shift = 3.0
    output_format = 'wav16'
}

$env:GGML_VK_VISIBLE_DEVICES = $Device.Substring(6)
try {
    $utf8 = [Text.UTF8Encoding]::new($false)
    for ($take = 1; $take -le 2; $take++) {
        $payload.seed = [long](($request.seed + (($take - 1) * 104729L)) % 2147483648L)
        [IO.File]::WriteAllText($requestFile, ($payload | ConvertTo-Json -Compress), $utf8)
        Invoke-AceEngine $synth $models $requestFile $synthLog $timbreArguments
        if ((Test-Path -LiteralPath $synthWave -PathType Leaf) -and (Test-SongWave $synthWave $payload.duration) -and (Test-SungLyrics $synthWave $take)) {
            [IO.File]::Move($synthWave, $finalWave)
            break
        }
        if (Test-Path -LiteralPath $synthWave) { Remove-Item -LiteralPath $synthWave }
    }
    if (!(Test-Path -LiteralPath $finalWave -PathType Leaf)) {
        throw 'No se obtuvo una toma que conservara la letra cantada.'
    }
} finally {
    $ErrorActionPreference = 'Stop'
    foreach ($file in @($requestFile, $synthWave)) {
        if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
    }
    if (!$KeepEngineLog) {
        foreach ($file in @($synthLog)) {
            if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
        }
    }
}
