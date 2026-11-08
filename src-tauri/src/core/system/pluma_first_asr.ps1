$ErrorActionPreference = 'Stop'
$root = $env:REY30_PLUMA_ASR_RESOURCE_DIR
if ($root.StartsWith('\\?\UNC\')) { $root = '\\' + $root.Substring(8) }
elseif ($root.StartsWith('\\?\')) { $root = $root.Substring(4) }
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class PlumaFirstAsr {
    const int MaxBytes = 102400;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectory(string path);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void vosk_set_log_level(int level);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr vosk_model_new(byte[] path);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void vosk_model_free(IntPtr model);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr vosk_recognizer_new(IntPtr model, float sampleRate);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void vosk_recognizer_free(IntPtr recognizer);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern void vosk_recognizer_set_words(IntPtr recognizer, int enabled);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern int vosk_recognizer_accept_waveform(IntPtr recognizer, byte[] data, int length);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr vosk_recognizer_result(IntPtr recognizer);
    [DllImport("libvosk.dll", CallingConvention = CallingConvention.Cdecl)]
    static extern IntPtr vosk_recognizer_final_result(IntPtr recognizer);

    static void WriteSegment(IntPtr result) {
        if (result == IntPtr.Zero) throw new InvalidDataException();
        int count = 0;
        while (count < 16384 && Marshal.ReadByte(result, count) != 0) count++;
        if (count == 16384) throw new InvalidDataException();
        byte[] json = new byte[count];
        Marshal.Copy(result, json, 0, count);
        Console.WriteLine(Convert.ToBase64String(json));
    }

    public static void Run(string root) {
        if (!SetDllDirectory(root)) throw new IOException();
        vosk_set_log_level(-1);
        string path = Path.Combine(root, "vosk-model-small-es-0.42");
        IntPtr model = vosk_model_new(Encoding.UTF8.GetBytes(path + "\0"));
        if (model == IntPtr.Zero) throw new IOException();
        try {
            IntPtr recognizer = vosk_recognizer_new(model, 16000);
            if (recognizer == IntPtr.Zero) throw new IOException();
            try {
                vosk_recognizer_set_words(recognizer, 1);
                Console.WriteLine("ready");
                Console.Out.Flush();
                using (var input = new BinaryReader(Console.OpenStandardInput())) {
                    int remaining = MaxBytes;
                    while (true) {
                        int length = input.ReadInt32();
                        if (length == 0) break;
                        if (length < 0 || length > remaining || length % 2 != 0) throw new InvalidDataException();
                        byte[] pcm = input.ReadBytes(length);
                        if (pcm.Length != length) throw new EndOfStreamException();
                        remaining -= length;
                        int status = vosk_recognizer_accept_waveform(recognizer, pcm, length);
                        if (status < 0) throw new InvalidDataException();
                        if (status > 0) WriteSegment(vosk_recognizer_result(recognizer));
                    }
                }
                WriteSegment(vosk_recognizer_final_result(recognizer));
                Console.WriteLine("done");
                Console.Out.Flush();
            } finally { vosk_recognizer_free(recognizer); }
        } finally { vosk_model_free(model); }
    }
}
'@
[PlumaFirstAsr]::Run($root)
