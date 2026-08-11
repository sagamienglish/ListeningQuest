#!/usr/bin/env python3
"""Split the three Phase 3 master recordings into 90 reliable question WAVs."""
import wave
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "audio/phase3-recorded"
spec = importlib.util.spec_from_file_location("phase3_analyzer", ROOT / "scripts/analyze-phase3-master.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
analyze = module.analyze


def question_ids():
    ids = []
    for category in range(1, 10):
        for item in range(1, 11):
            ids.append(f"P30{category}-{item:02d}")
    return ids


def split_file(source, ids):
    analysis = analyze(source)
    segments = analysis["segments"]
    if len(segments) < len(ids):
        raise RuntimeError(f"{source.name}: {len(segments)} segments for {len(ids)} questions")
    with wave.open(str(source), "rb") as reader:
        params = reader.getparams()
        rate = reader.getframerate()
        frames = reader.readframes(reader.getnframes())
    frame_bytes = params.sampwidth * params.nchannels
    for question_id, segment in zip(ids, segments):
        start = max(0, int((segment["start"] - 0.08) * rate))
        end = min(params.nframes, int((segment["end"] + 0.10) * rate))
        clip = frames[start * frame_bytes:end * frame_bytes]
        with wave.open(str(OUTPUT / f"{question_id}.wav"), "wb") as writer:
            writer.setparams(params)
            writer.writeframes(clip)


OUTPUT.mkdir(parents=True, exist_ok=True)
ids = question_ids()
split_file(ROOT / "audio/Phase3-1.wav", ids[:40])
split_file(ROOT / "audio/Phase3-2.wav", ids[40:78])
split_file(ROOT / "audio/Phase3-3.wav", ids[78:])
print(f"created {len(list(OUTPUT.glob('*.wav')))} clips in {OUTPUT}")
