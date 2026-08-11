#!/usr/bin/env python3
import audioop
import json
import sys
import wave
from pathlib import Path


def analyze(path: Path):
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        width = wav.getsampwidth()
        channels = wav.getnchannels()
        frame_samples = max(1, round(rate * 0.02))
        chunks = []
        while True:
            data = wav.readframes(frame_samples)
            if not data:
                break
            if channels > 1:
                data = audioop.tomono(data, width, 0.5, 0.5)
            chunks.append(audioop.rms(data, width))

    peak = max(chunks, default=0)
    threshold = max(120, peak * 0.025)
    active = [value >= threshold for value in chunks]

    # Bridge tiny gaps inside a sentence, but retain inter-sentence pauses.
    max_bridge = round(0.18 / 0.02)
    index = 0
    while index < len(active):
        if active[index]:
            index += 1
            continue
        start = index
        while index < len(active) and not active[index]:
            index += 1
        if start > 0 and index < len(active) and index - start <= max_bridge:
            active[start:index] = [True] * (index - start)

    segments = []
    min_pause_frames = round(0.55 / 0.02)
    index = 0
    speech_start = None
    while index < len(active):
        if active[index] and speech_start is None:
            speech_start = index
        if not active[index] and speech_start is not None:
            silence_start = index
            while index < len(active) and not active[index]:
                index += 1
            if index - silence_start >= min_pause_frames:
                segments.append({"start": speech_start * 0.02, "end": silence_start * 0.02})
                speech_start = None
            continue
        index += 1
    if speech_start is not None:
        segments.append({"start": speech_start * 0.02, "end": len(active) * 0.02})

    return {
        "file": str(path),
        "duration": len(chunks) * 0.02,
        "threshold": round(threshold, 2),
        "segmentCount": len(segments),
        "segments": segments,
    }


if __name__ == "__main__":
    print(json.dumps([analyze(Path(arg)) for arg in sys.argv[1:]], ensure_ascii=False, indent=2))
