import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { categories, pairs } from "../data.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const voice = process.env.LISTENQUEST_VOICE || "Ava (Premium)";
const rate = process.env.LISTENQUEST_RATE || "155";
const categoryFilter = process.env.LISTENQUEST_CATEGORY || "";
const overwriteExisting = process.env.LISTENQUEST_OVERWRITE === "1";
const sentenceFrames = [
  (word) => `Please say ${word} again.`,
  (word) => `I heard the word ${word} clearly.`,
  (word) => `She said ${word} twice.`,
  (word) => `The word was ${word}.`,
  (word) => `Did you say ${word}?`,
];

function baseName(pair, key) {
  return `${pair.categoryId}-${String(pair.number).padStart(2, "0")}-${key}`;
}

function sentenceFrameIndex(pair) {
  const categoryNumber = Number(pair.categoryId.slice(1));
  return (categoryNumber + pair.number) % sentenceFrames.length;
}

function sentenceFor(pair, word) {
  return sentenceFrames[sentenceFrameIndex(pair)](word);
}

async function createWav(text, output, temporaryDirectory, overwrite = false) {
  try {
    const current = await fs.stat(output);
    if (!overwrite && current.size > 5000) return false;
    await fs.unlink(output);
  } catch {
    // Create missing audio below.
  }
  const aiff = path.join(temporaryDirectory, `${path.basename(output, ".wav")}.aiff`);
  await execFileAsync("say", ["-v", voice, "-r", rate, "-o", aiff, text]);
  const aiffStat = await fs.stat(aiff);
  if (aiffStat.size <= 5000) throw new Error(`Speech synthesis returned an empty file for: ${text}`);
  await execFileAsync("afconvert", ["-f", "WAVE", "-d", "LEI16@24000", aiff, output]);
  const wavStat = await fs.stat(output);
  if (wavStat.size <= 5000) throw new Error(`Audio conversion returned an empty file for: ${text}`);
  await fs.unlink(aiff);
  return true;
}

const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "listeningquest-audio-"));
let created = 0;
let processed = 0;
try {
  const jobs = [];
  for (const pair of pairs) {
    if (categoryFilter && pair.categoryId !== categoryFilter) continue;
    const phase = categories.find((category) => category.id === pair.categoryId)?.phase;
    const outputDirectory = path.join(root, `audio/phase${phase}`);
    await fs.mkdir(outputDirectory, { recursive: true });
    for (const key of ["a", "b"]) {
      const base = baseName(pair, key);
      const word = pair[key].word;
      jobs.push({ text: word, output: path.join(outputDirectory, `${base}-word.wav`), overwrite: overwriteExisting });
      jobs.push({ text: sentenceFor(pair, word), output: path.join(outputDirectory, `${base}-sentence.wav`), overwrite: overwriteExisting });
    }
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      if (await createWav(job.text, job.output, temporaryDirectory, job.overwrite)) created += 1;
      processed += 1;
      if (processed % 20 === 0) console.log(`processed ${processed}/${jobs.length} audio files`);
    }
  };
  const concurrency = Math.max(1, Number(process.env.LISTENQUEST_AUDIO_WORKERS) || 4);
  await Promise.all(Array.from({ length: concurrency }, worker));
} finally {
  await fs.rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(`complete: ${created} new files (${processed} total), voice=${voice}, rate=${rate}`);
