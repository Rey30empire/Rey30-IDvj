# SPDX-License-Identifier: GPL-3.0-or-later
# Adaptador de audio local, distribuido con su código fuente y los avisos del motor.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $resourcePath = [string]$request.resourceDir
  if ($resourcePath.StartsWith('\\?\UNC\')) { $resourcePath = '\\' + $resourcePath.Substring(8) }
  elseif ($resourcePath.StartsWith('\\?\')) { $resourcePath = $resourcePath.Substring(4) }
  $root = [IO.Path]::GetFullPath($resourcePath)
  $hasEspeak = (Test-Path -LiteralPath (Join-Path $root 'espeak-ng.dll')) -and (Test-Path -LiteralPath (Join-Path $root 'espeak-ng-data/es_dict'))
  $hasVosk = (Test-Path -LiteralPath (Join-Path $root 'libvosk.dll')) -and (Test-Path -LiteralPath (Join-Path $root 'vosk-model-small-es-0.42/am/final.mdl'))
  if ($request.operation -eq 'catalog') {
    $voices = @()
    if ($hasEspeak) {
      foreach ($variant in @('m1','m2','m3','m4','m5','f3')) { $voices += @{id="espeak:es-419+$variant"; name="Español latino local · $variant"; language='es-419'; provider='eSpeak NG'; gender=$(if($variant.StartsWith('f')){'Female'}else{'Male'})} }
    }
    try {
      Add-Type -AssemblyName System.Speech
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
      foreach ($voice in $synth.GetInstalledVoices()) {
        if ($voice.Enabled) { $info=$voice.VoiceInfo; $voices += @{id="windows:$($info.Name)";name=$info.Name;language=$info.Culture.Name;provider='Windows';gender=$info.Gender.ToString()} }
      }
      $synth.Dispose()
    } catch { }
    @{voices=@($voices); dictation=$hasVosk; dictationLanguage='es';localOnly=$true} | ConvertTo-Json -Depth 5 -Compress
    exit 0
  }
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class CharacterAudio {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int SynthCallback(IntPtr samples, int count, IntPtr events);
  [DllImport("espeak-ng.dll", CallingConvention=CallingConvention.Cdecl)] static extern int espeak_Initialize(int output, int buffer, [MarshalAs(UnmanagedType.LPStr)] string data, int options);
  [DllImport("espeak-ng.dll", CallingConvention=CallingConvention.Cdecl)] static extern void espeak_SetSynthCallback(SynthCallback callback);
  [DllImport("espeak-ng.dll", CallingConvention=CallingConvention.Cdecl)] static extern int espeak_SetVoiceByName([MarshalAs(UnmanagedType.LPStr)] string voice);
  [DllImport("espeak-ng.dll", CallingConvention=CallingConvention.Cdecl)] static extern int espeak_SetParameter(int parameter, int value, int relative);
  [DllImport("espeak-ng.dll", CallingConvention=CallingConvention.Cdecl)] static extern int espeak_Synth(byte[] text, UIntPtr size, uint position, int positionType, uint endPosition, uint flags, IntPtr id, IntPtr userData);
  [DllImport("espeak-ng.dll", CallingConvention=CallingConvention.Cdecl)] static extern int espeak_Synchronize();
  [DllImport("espeak-ng.dll", CallingConvention=CallingConvention.Cdecl)] static extern int espeak_Terminate();
  public static byte[] Synthesize(string root, string text, string voice, double rate, double pitch, double volume) {
    SetDllDirectory(root);
    int sampleRate=espeak_Initialize(1, 0, root, 0);
    if(sampleRate<=0) throw new Exception("Motor local no disponible");
    try {
      if(espeak_SetVoiceByName(voice)!=0) throw new Exception("Voz no disponible");
      espeak_SetParameter(1,(int)(175*rate),0); espeak_SetParameter(2,(int)(volume*100),0); espeak_SetParameter(3,Math.Max(0,Math.Min(99,(int)(50*pitch))),0);
      using(var pcm=new MemoryStream()) {
        SynthCallback callback=(pointer,count,events)=> { if(count>0 && pointer!=IntPtr.Zero) { if(pcm.Length+count*2>20*1024*1024) return 1; byte[] data=new byte[count*2]; Marshal.Copy(pointer,data,0,data.Length); pcm.Write(data,0,data.Length); } return 0; };
        espeak_SetSynthCallback(callback);
        byte[] utf8=Encoding.UTF8.GetBytes(text+"\0");
        if(espeak_Synth(utf8,(UIntPtr)utf8.Length,0,0,0,1|0x1000,IntPtr.Zero,IntPtr.Zero)!=0) throw new Exception("Síntesis fallida");
        espeak_Synchronize(); GC.KeepAlive(callback);
        using(var wave=new MemoryStream()) using(var writer=new BinaryWriter(wave)) {
          writer.Write(Encoding.ASCII.GetBytes("RIFF"));writer.Write((int)pcm.Length+36);writer.Write(Encoding.ASCII.GetBytes("WAVEfmt "));writer.Write(16);writer.Write((short)1);writer.Write((short)1);writer.Write(sampleRate);writer.Write(sampleRate*2);writer.Write((short)2);writer.Write((short)16);writer.Write(Encoding.ASCII.GetBytes("data"));writer.Write((int)pcm.Length);pcm.Position=0;pcm.CopyTo(wave);return wave.ToArray();
        }
      }
    } finally { espeak_Terminate(); }
  }
  [DllImport("libvosk.dll",CallingConvention=CallingConvention.Cdecl)] static extern void vosk_set_log_level(int level);
  [DllImport("libvosk.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr vosk_model_new(byte[] path);
  [DllImport("libvosk.dll",CallingConvention=CallingConvention.Cdecl)] static extern void vosk_model_free(IntPtr model);
  [DllImport("libvosk.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr vosk_recognizer_new(IntPtr model,float rate);
  [DllImport("libvosk.dll",CallingConvention=CallingConvention.Cdecl)] static extern void vosk_recognizer_free(IntPtr recognizer);
  [DllImport("libvosk.dll",CallingConvention=CallingConvention.Cdecl)] static extern int vosk_recognizer_accept_waveform(IntPtr recognizer,byte[] data,int length);
  [DllImport("libvosk.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr vosk_recognizer_final_result(IntPtr recognizer);
  public static string Transcribe(string root,byte[] pcm) {
    SetDllDirectory(root);vosk_set_log_level(-1);
    IntPtr model=vosk_model_new(Encoding.UTF8.GetBytes(Path.Combine(root,"vosk-model-small-es-0.42")+"\0"));
    if(model==IntPtr.Zero) throw new Exception("Modelo de dictado no disponible");
    try {
      IntPtr recognizer=vosk_recognizer_new(model,16000);
      if(recognizer==IntPtr.Zero) throw new Exception("Dictado no disponible");
      try {
        if(vosk_recognizer_accept_waveform(recognizer,pcm,pcm.Length)<0) throw new Exception("Audio no válido");
        IntPtr result=vosk_recognizer_final_result(recognizer);if(result==IntPtr.Zero) throw new Exception("Dictado vacío");int count=0;while(count<100000 && Marshal.ReadByte(result,count)!=0) count++;
        byte[] data=new byte[count];Marshal.Copy(result,data,0,count);return Encoding.UTF8.GetString(data);
      } finally { vosk_recognizer_free(recognizer); }
    } finally { vosk_model_free(model); }
  }
}
'@
  if ($request.operation -eq 'synthesize') {
    if ($request.voiceId.StartsWith('espeak:')) {
      if(-not $hasEspeak) {throw 'Audio local no instalado'}
      $voice = $request.voiceId.Substring(7)
      if ($voice -notmatch '^es(?:-419)?\+[mf][1-5]$') { throw 'Voz no admitida' }
      $audio = [CharacterAudio]::Synthesize($root,$request.text,$voice,$request.rate,$request.pitch,$request.volume)
    } else {
      Add-Type -AssemblyName System.Speech
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
      $stream = New-Object IO.MemoryStream
      try { $synth.SelectVoice($request.voiceId.Substring(8));$synth.Rate=[Math]::Max(-10,[Math]::Min(10,[int](($request.rate-1)*10)));$synth.Volume=[int]($request.volume*100);$synth.SetOutputToWaveStream($stream);$synth.Speak($request.text);$audio=$stream.ToArray() }
      finally { $synth.Dispose();$stream.Dispose() }
    }
    @{audioBase64=[Convert]::ToBase64String($audio);mime='audio/wav';localOnly=$true} | ConvertTo-Json -Compress
  } elseif ($request.operation -eq 'transcribe') {
    if(-not $hasVosk) {throw 'Dictado español no instalado'}
    $result = [CharacterAudio]::Transcribe($root,[Convert]::FromBase64String($request.pcmBase64)) | ConvertFrom-Json
    @{text=[string]$result.text;localOnly=$true} | ConvertTo-Json -Compress
  } else { throw 'Operación no válida' }
} catch {
  @{error='El audio local no está disponible. Comprueba los recursos de voz y dictado; el chat sigue funcionando.'} | ConvertTo-Json -Compress
}
