#!/usr/bin/env python3
"""Acoustically align Phase3-1 speech chunks to the 40 reference WAVs.

Requires NumPy. The app uses the resulting static phase3-audio-map.js; this
script is only a diagnostic for locating an inserted/repeated speech chunk.
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
TARGET_RATE = 16000


def read_wav(path, start=None, end=None):
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        if width != 2:
            raise ValueError(f"Expected 16-bit PCM: {path}")
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    if start is not None:
        samples = samples[int(start * rate):int(end * rate)]
    if rate != TARGET_RATE:
        old_x = np.arange(len(samples), dtype=np.float32)
        new_x = np.linspace(0, max(0, len(samples) - 1), round(len(samples) * TARGET_RATE / rate), dtype=np.float32)
        samples = np.interp(new_x, old_x, samples).astype(np.float32)
    peak = np.max(np.abs(samples)) if len(samples) else 1.0
    return samples / max(1.0, peak)


def hz_to_mel(value):
    return 2595 * np.log10(1 + value / 700)


def mel_to_hz(value):
    return 700 * (10 ** (value / 2595) - 1)


def features(samples):
    frame = round(0.025 * TARGET_RATE)
    hop = round(0.02 * TARGET_RATE)
    if len(samples) < frame:
        samples = np.pad(samples, (0, frame - len(samples)))
    count = 1 + (len(samples) - frame) // hop
    indices = np.arange(frame)[None, :] + hop * np.arange(count)[:, None]
    frames = samples[indices] * np.hamming(frame)[None, :]
    spectrum = np.abs(np.fft.rfft(frames, n=512)) ** 2
    mel_points = np.linspace(hz_to_mel(80), hz_to_mel(7600), 28)
    bins = np.floor((512 + 1) * mel_to_hz(mel_points) / TARGET_RATE).astype(int)
    bank = np.zeros((26, spectrum.shape[1]), dtype=np.float32)
    for index in range(26):
        left, center, right = bins[index:index + 3]
        if center > left:
            bank[index, left:center] = np.arange(center - left) / (center - left)
        if right > center:
            bank[index, center:right] = np.arange(right - center, 0, -1) / (right - center)
    logged = np.log(np.maximum(spectrum @ bank.T, 1e-8))
    n = np.arange(26)
    k = np.arange(13)[:, None]
    dct = np.cos(np.pi / 26 * (n + 0.5) * k)
    mfcc = logged @ dct.T
    mfcc = mfcc[:, 1:13]
    mfcc = (mfcc - mfcc.mean(axis=0)) / np.maximum(mfcc.std(axis=0), 1e-5)
    delta = np.vstack([np.zeros((1, mfcc.shape[1])), np.diff(mfcc, axis=0)])
    return np.hstack([mfcc, delta]).astype(np.float32)


def dtw(left, right):
    previous = np.full(len(right) + 1, np.inf, dtype=np.float32)
    previous[0] = 0
    for row in left:
        costs = np.sqrt(np.sum((right - row) ** 2, axis=1))
        current = np.full(len(right) + 1, np.inf, dtype=np.float32)
        for index, value in enumerate(costs, start=1):
            current[index] = value + min(current[index - 1], previous[index], previous[index - 1])
        previous = current
    return float(previous[-1] / (len(left) + len(right)))


master_paths = [ROOT / f"audio/Phase3-{index}.wav" for index in range(1, 4)]
analyses = json.loads(subprocess.check_output([
    sys.executable, str(ROOT / "scripts/analyze-phase3-master.py"), *map(str, master_paths)
]))
segments = []
master_features = []
for file_index, (path, analysis) in enumerate(zip(master_paths, analyses), start=1):
    master = read_wav(path)
    for local_index, item in enumerate(analysis["segments"], start=1):
        segments.append({**item, "file": f"Phase3-{file_index}.wav", "localSegment": local_index})
        master_features.append(features(master[int(item["start"] * TARGET_RATE):int(item["end"] * TARGET_RATE)]))
reference_features = []
for question_index in range(90):
    category = question_index // 10 + 1
    item = question_index % 10 + 1
    reference_features.append(features(read_wav(ROOT / f"audio/phase3/P30{category}-{item:02d}.wav")))

matrix = np.array([[dtw(reference, candidate) for candidate in master_features] for reference in reference_features])
skip_scores = []
for skip in range(91):
    score = sum(matrix[q, q if q < skip else q + 1] for q in range(90))
    skip_scores.append((score, skip))

print(json.dumps({
    "bestSkippedSegments": [
        {"segment": skip + 1, "score": round(score, 4), **segments[skip]}
        for score, skip in sorted(skip_scores)[:10]
    ],
    "bestLocalMatches": [
        {"question": q + 1, "segment": int(np.argmin(matrix[q])) + 1, "score": round(float(np.min(matrix[q])), 4)}
        for q in range(90)
    ],
}, indent=2))
