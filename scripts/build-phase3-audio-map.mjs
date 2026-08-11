import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { phase3Questions } from "../phase3-data.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["audio/Phase3-1.wav", "audio/Phase3-2.wav", "audio/Phase3-3.wav"];
const expectedRanges = [[0, 40], [40, 78], [78, 90]];
const { stdout } = await execFileAsync("python3", [path.join(root, "scripts/analyze-phase3-master.py"), ...files.map((file) => path.join(root, file))]);
const analyses = JSON.parse(stdout);

function feature(question) {
  const letters = question.sentence.replace(/[^A-Za-z]/g, "").length;
  return letters + question.wordCount * 2.5;
}

function fitCost(questionSlice, groups) {
  const xs = questionSlice.map(feature);
  const ys = groups.map((group) => group.reduce((sum, segment) => sum + segment.end - segment.start, 0));
  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((sum, x, index) => sum + (x - xMean) * (ys[index] - yMean), 0)
    / Math.max(0.0001, xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0));
  const intercept = yMean - slope * xMean;
  const residuals = ys.map((y, index) => y - (intercept + slope * xs[index]));
  return residuals.reduce((sum, residual) => sum + residual ** 2, 0);
}

function alignSegments(analysis, questionSlice, fileIndex) {
  const segments = analysis.segments;
  if (segments.length === questionSlice.length) return { groups: segments.map((segment) => [segment]), note: "one-to-one" };
  // Phase3-1 contains one additional spoken chunk after the 40 requested lines.
  // Keep lines 1–40 one-to-one and ignore that final extra chunk. Merging two
  // neighbouring chunks caused P304-01 to include P304-02 and shifted P304 onward.
  if (fileIndex === 0 && segments.length === questionSlice.length + 1) {
    return {
      groups: segments.slice(0, questionSlice.length).map((segment) => [segment]),
      note: `one-to-one; trailing segment ${segments.length} overlaps with the next master file`,
    };
  }
  if (segments.length !== questionSlice.length + 1) {
    throw new Error(`${analysis.file}: expected ${questionSlice.length} or ${questionSlice.length + 1} segments, found ${segments.length}`);
  }

  const candidates = questionSlice.map((_, mergeIndex) => {
    const groups = questionSlice.map((__, questionIndex) => {
      if (questionIndex < mergeIndex) return [segments[questionIndex]];
      if (questionIndex === mergeIndex) return [segments[questionIndex], segments[questionIndex + 1]];
      return [segments[questionIndex + 1]];
    });
    return { mergeIndex, groups, cost: fitCost(questionSlice, groups) };
  }).sort((a, b) => a.cost - b.cost);

  return {
    groups: candidates[0].groups,
    note: `merged detected segments ${candidates[0].mergeIndex + 1}-${candidates[0].mergeIndex + 2}; alternatives ${candidates.slice(0, 5).map((item) => `${item.mergeIndex + 1}:${item.cost.toFixed(3)}`).join(", ")}`,
  };
}

const audioMap = {};
const diagnostics = [];
analyses.forEach((analysis, fileIndex) => {
  const [startIndex, endIndex] = expectedRanges[fileIndex];
  const questions = phase3Questions.slice(startIndex, endIndex);
  const aligned = alignSegments(analysis, questions, fileIndex);
  diagnostics.push({ file: files[fileIndex], expectedQuestions: questions.length, detectedSegments: analysis.segmentCount, note: aligned.note });
  aligned.groups.forEach((group, localIndex) => {
    const question = questions[localIndex];
    audioMap[question.id] = {
      file: `audio/phase3-recorded/${question.id}.wav`,
    };
  });
});

const output = `// Generated from the three Phase 3 master recordings.\nexport const phase3AudioMap = ${JSON.stringify(audioMap, null, 2)};\n`;
await fs.writeFile(path.join(root, "phase3-audio-map.js"), output);
await fs.writeFile(path.join(root, "outputs/phase3_audio_master/audio_map_diagnostics.json"), JSON.stringify(diagnostics, null, 2));
console.log(JSON.stringify({ mapped: Object.keys(audioMap).length, diagnostics }, null, 2));
