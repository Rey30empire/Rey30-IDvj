import json
import math
import os
import re
import sys
import threading
import time
import unicodedata
import wave
from pathlib import Path


MIN_SECONDS = 18
MAX_SECONDS = 25
MAX_WAV_BYTES = 5 * 1024 * 1024
MAX_REQUEST_BYTES = 16 * 1024
MIN_COVERAGE_PERCENT = 35
MIN_CONTENT_PAIRS = 2
THREAD_LIMIT = 5
ACCENTS = str.maketrans('áéíóúü', 'aeiouu')
FUNCTION_WORDS = frozenset(
    'a al algo algun ante aquel aquellos asi con contra cual cuando de del desde donde '
    'e el ella ellas ello ellos en entre era es esa esas ese esos esta estas este esto estos '
    'ha han hasta la las le les lo los me mi mis mucha mucho muy nada ni no nos nuestra nuestro '
    'o otra otro para pero por porque pues que se sea ser si sin sobre son su sus te tu tus u '
    'un una unas uno unos usted ustedes ya y yo'.split()
)


def normalized_words(text):
    text = unicodedata.normalize('NFC', text.casefold()).translate(ACCENTS)
    return re.findall(r'[^\W_]+', text)


def lyrics_lines(text):
    return [re.sub(r'\[[^\]\r\n]{1,80}\]', '', line) for line in text.splitlines()]


def ordered_word_matches(expected, actual):
    previous = [0] * (len(actual) + 1)
    for word in expected:
        current = [0]
        for index, other in enumerate(actual):
            if word == other:
                current.append(previous[index] + 1)
            else:
                current.append(max(current[-1], previous[index + 1]))
        previous = current
    return previous[-1]


def content_pairs(words):
    content = [word for word in words if len(word) > 2 and word not in FUNCTION_WORDS]
    return set(zip(content, content[1:]))


def compare_lyrics(lines, transcript):
    expected_lines = [normalized_words(line) for line in lines]
    expected = [word for line in expected_lines for word in line]
    actual = normalized_words(transcript)
    matched = ordered_word_matches(expected, actual)
    expected_pairs = set().union(*(content_pairs(line) for line in expected_lines))
    pair_count = len(expected_pairs & content_pairs(actual))
    return {
        'accepted': matched * 100 >= MIN_COVERAGE_PERCENT * len(expected) and pair_count >= MIN_CONTENT_PAIRS,
        'coverage': round(matched / len(expected), 4),
        'matchedWords': matched,
        'expectedWords': len(expected),
        'matchedContentPairs': pair_count,
    }


def read_lyrics(path):
    if not path.is_absolute() or not path.is_file():
        raise ValueError('invalid_request')
    with path.open('rb') as request_file:
        raw = request_file.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError('invalid_request')
    request = json.loads(raw.decode('utf-8-sig'))
    lyrics = request.get('lyrics') if isinstance(request, dict) else None
    if not isinstance(lyrics, str) or len(lyrics) > 4096:
        raise ValueError('invalid_request')
    lines = lyrics_lines(lyrics)
    if not any(normalized_words(line) for line in lines):
        raise ValueError('invalid_request')
    return lyrics, lines


def read_wave(path):
    if not path.is_absolute() or not path.is_file() or path.stat().st_size > MAX_WAV_BYTES:
        raise ValueError('invalid_wav')
    with wave.open(str(path), 'rb') as audio:
        rate = audio.getframerate()
        channels = audio.getnchannels()
        frames = audio.getnframes()
        if (
            not 16000 <= rate <= 48000
            or channels not in (1, 2)
            or audio.getsampwidth() != 2
            or audio.getcomptype() != 'NONE'
            or not MIN_SECONDS * rate <= frames <= MAX_SECONDS * rate
        ):
            raise ValueError('invalid_wav')
        pcm = audio.readframes(frames)
    if len(pcm) != frames * channels * 2:
        raise ValueError('invalid_wav')
    return pcm, rate, channels, frames / rate


def transcribe(pcm, rate, channels):
    os.environ.update({
        'CUDA_VISIBLE_DEVICES': '',
        'HIP_VISIBLE_DEVICES': '',
        'ROCR_VISIBLE_DEVICES': '',
        'HF_HUB_OFFLINE': '1',
        'TRANSFORMERS_OFFLINE': '1',
        'HF_HUB_DISABLE_TELEMETRY': '1',
        'OMP_NUM_THREADS': str(THREAD_LIMIT),
        'MKL_NUM_THREADS': str(THREAD_LIMIT),
        'OPENBLAS_NUM_THREADS': str(THREAD_LIMIT),
    })
    import numpy as np
    import torch
    from scipy.signal import resample_poly
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
    from transformers.utils import logging

    logging.set_verbosity_error()
    logging.disable_progress_bar()
    torch.set_num_threads(THREAD_LIMIT)
    torch.set_num_interop_threads(1)
    samples = np.frombuffer(pcm, dtype='<i2').reshape(-1, channels)
    signal = samples.mean(axis=1, dtype=np.float32) / 32768.0
    if rate != 16000:
        divisor = math.gcd(16000, rate)
        signal = resample_poly(signal, 16000 // divisor, rate // divisor)

    model_path = (Path.home() / 'ai-hub/models/audio/whisper-large-v3-turbo').resolve(strict=True)
    processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_path, dtype=torch.float32, low_cpu_mem_usage=True, local_files_only=True,
    ).to('cpu').eval()
    inputs = processor(signal, sampling_rate=16000, return_tensors='pt', return_attention_mask=True)
    with torch.inference_mode():
        tokens = model.generate(**inputs, language='es', task='transcribe', max_new_tokens=128)
    return processor.batch_decode(
        tokens, skip_special_tokens=True, clean_up_tokenization_spaces=False,
    )[0].strip()


def unavailable(reason):
    print(json.dumps({'accepted': False, 'error': reason}))
    return 3


def stop_when_request_disappears(path):
    try:
        while path.is_file():
            time.sleep(0.35)
    except OSError:
        pass
    os._exit(3)


def main(args):
    flags = args[2:]
    if len(args) < 2 or len(set(flags)) != len(flags) or set(flags) - {'--diagnostic', '--watch-request'}:
        return unavailable('invalid_arguments')
    request_path = Path(args[1])
    try:
        lyrics, lines = read_lyrics(request_path)
        pcm, rate, channels, seconds = read_wave(Path(args[0]))
    except (OSError, ValueError, wave.Error, EOFError, RecursionError):
        return unavailable('invalid_input')

    if '--watch-request' in flags:
        threading.Thread(target=stop_when_request_disappears, args=(request_path,), daemon=True).start()
    try:
        transcript = transcribe(pcm, rate, channels)
    except Exception:
        return unavailable('verifier_unavailable')

    result = compare_lyrics(lines, transcript)
    result['seconds'] = round(seconds, 3)
    if '--diagnostic' in flags:
        result.update({'lyrics': lyrics, 'transcript': transcript})
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result['accepted'] else 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
