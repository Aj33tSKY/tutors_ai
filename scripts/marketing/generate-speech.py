"""Generate silent hero animation data using macOS voices and ffmpeg.

Each sentence is assembled from word clips, giving exact word boundaries.
Only derived measurements ship to the browser; temporary recordings stay local.
Run: python3 scripts/marketing/generate-speech.py
"""
import array
import concurrent.futures
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'src/components/marketing/data/lesson-scenarios.json'
OUTPUT = ROOT / 'src/components/marketing/data/lesson-speech.json'
RATE = 8000
HOP = 320
VOICES = {'tutor': 'Daniel', 'student': 'Samantha'}


def generate(job):
    speaker, text = job
    words = list(re.finditer(r'\S+', text))
    samples = array.array('h')
    boundaries = []
    with tempfile.TemporaryDirectory(prefix='hero-speech-') as folder:
        for i, word in enumerate(words):
            aiff = Path(folder) / f'{i}.aiff'
            wav = Path(folder) / f'{i}.wav'
            subprocess.run(['say', '-v', VOICES[speaker], '-r', '175', '-o', str(aiff), word.group()], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(aiff), '-ar', str(RATE), '-ac', '1', str(wav)], check=True)
            with wave.open(str(wav)) as audio:
                pcm = array.array('h', audio.readframes(audio.getnframes()))
            # Remove synthesis padding while preserving consonants at word edges.
            voiced = [j for j, value in enumerate(pcm) if abs(value) > 180]
            if not voiced:
                raise RuntimeError(f'No speech generated for {word.group()}')
            pcm = pcm[max(0, voiced[0] - 160):min(len(pcm), voiced[-1] + 240)]
            start = len(samples) / RATE
            samples.extend(pcm)
            boundaries.append([round(start, 3), round(len(samples) / RATE, 3), word.start(), word.end()])
            samples.extend([0] * (800 if word.group().endswith(('.', '?', '!')) else 280))
    frames = []
    for offset in range(0, len(samples), HOP):
        chunk = samples[offset:offset + HOP]
        rms = math.sqrt(sum(x * x for x in chunk) / max(1, len(chunk))) / 32768
        # Normalised autocorrelation over a 60ms window; unvoiced frames have no pitch.
        window = samples[max(0, offset - 160):offset + HOP]
        mean = sum(window) / max(1, len(window))
        values = [v - mean for v in window]
        best, lag_best = 0, 0
        if rms > .006 and len(values) >= 320:
            for lag in range(20, 101):
                left, right = values[:-lag], values[lag:]
                denominator = math.sqrt(sum(v*v for v in left) * sum(v*v for v in right))
                score = sum(a*b for a, b in zip(left, right)) / denominator if denominator else 0
                if score > best:
                    best, lag_best = score, lag
        frames.append([rms, round(RATE / lag_best) if best > .65 else 0])
    peak = max(frame[0] for frame in frames)
    frames = [[round(min(1, level / peak), 3), pitch] for level, pitch in frames]
    return {'text': text, 'duration': round(len(samples) / RATE, 3), 'words': boundaries, 'frames': frames}


if __name__ == '__main__':
    scenarios = json.loads(SOURCE.read_text())
    pairs = [(item['tutor'], item['student']) for item in scenarios]
    if not pairs:
        raise RuntimeError('No exchanges found')
    jobs = [(speaker, text) for pair in pairs for speaker, text in zip(('tutor', 'student'), pair)]
    cached = {}
    if OUTPUT.exists():
        previous = json.loads(OUTPUT.read_text())
        if previous.get('voices') == VOICES and previous.get('frameSeconds') == HOP / RATE:
            cached = {(speaker, profile['text']): profile for exchange in previous['exchanges'] for speaker, profile in exchange.items()}
    pending = list(dict.fromkeys(job for job in jobs if job not in cached))
    print(f'Reusing {len(jobs) - len(pending)} profiles; generating {len(pending)}', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for job, profile in zip(pending, pool.map(generate, pending)):
            cached[job] = profile
    results = [cached[job] for job in jobs]
    data = {'frameSeconds': HOP / RATE, 'voices': VOICES, 'exchanges': [dict(zip(('tutor', 'student'), results[i:i+2])) for i in range(0, len(results), 2)]}
    OUTPUT.write_text(json.dumps(data, separators=(',', ':')) + '\n')
    print(f'Generated {len(results)} speech profiles ({OUTPUT.stat().st_size} bytes)')
