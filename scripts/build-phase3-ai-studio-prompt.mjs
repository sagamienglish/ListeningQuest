import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { phase3Categories, phase3Questions } from "../phase3-data.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "outputs", "phase3_audio_master");

const categoryDirections = {
  P301: "Use natural consonant-to-vowel linking across word boundaries. Do not insert pauses between the linked words.",
  P302: "Use natural /w/ or /j/ glide transitions between adjacent vowels where appropriate.",
  P303: "For adjacent identical or similar consonants, hold and release the consonant naturally rather than producing two separate explosions.",
  P304: "Use authentic conversational weak forms. Reduce him, her, his, them and function words such as to, for, of, at, from, and. Preserve grammatical meaning.",
  P305: "Use natural English stress timing. Stress the capitalized content words and compress unstressed function words without sounding theatrical.",
  P306: "Use a natural General American flap [ɾ] for eligible intervocalic T or D sounds.",
  P307: "Use natural conversational consonant-cluster simplification and T/D deletion where appropriate, without deleting words.",
  P308: "Use natural assimilation and coalescence such as did you, would you, don't you, miss you, and place assimilation before bilabials.",
  P309: "Use common conversational reductions such as gonna, wanna, hafta, lemme, gimme, gotta, shoulda, coulda, whaddaya, and kinda, while keeping the written sentence unchanged in meaning.",
};

const directionBlock = phase3Categories.map((category, index) => {
  const start = index * 10 + 1;
  return `Lines ${start}-${start + 9} (${category.id}, ${category.name}): ${categoryDirections[category.id]}`;
}).join("\n");

const transcript = phase3Questions.map((question) => question.sentence).join("\n");
const prompt = `Create one master audio recording for an English listening-training application.

VOICE AND DELIVERY — these instructions must not be spoken:
- One adult native speaker of General American English.
- Warm, clear, contemporary, and neutral. Sound like natural conversation, not a textbook word list.
- Medium conversational pace, approximately 150-165 words per minute.
- Read every sentence exactly once, in the exact order supplied.
- Do not speak line numbers, category names, instructions, XML tags, or commentary.
- Do not add, remove, paraphrase, repeat, or correct any sentence.
- Keep the volume, microphone distance, voice identity, and speaking rate consistent across the entire recording.
- After every sentence, insert approximately 2.0 seconds of clean digital silence. Do not fill the silence with breathing, music, room tone, or sound effects.
- Begin with 1.0 second of silence and end with 2.0 seconds of silence.
- Preserve natural connected speech. Do not over-enunciate word boundaries.

CATEGORY-SPECIFIC PERFORMANCE — these instructions must not be spoken:
${directionBlock}

QUALITY CHECK — these instructions must not be spoken:
- The result must contain exactly 90 spoken sentences.
- There must be no introduction and no closing message.
- If an instruction conflicts with natural General American pronunciation, prioritize natural connected speech while preserving every word.

Read only the text inside <SPOKEN_TEXT>. Each newline marks a new sentence and requires the silent gap described above.

<SPOKEN_TEXT>
${transcript}
</SPOKEN_TEXT>
`;

const cueSheet = phase3Questions.map((question, index) => `${String(index + 1).padStart(2, "0")}\t${question.id}\t${question.categoryId}\t${question.sentence}`).join("\n");

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "Google_AI_Studio_Phase3_master_audio_prompt.txt"), prompt);
await fs.writeFile(path.join(outputDir, "Phase3_master_audio_cue_sheet.txt"), `LINE\tID\tCATEGORY\tSENTENCE\n${cueSheet}\n`);
console.log(JSON.stringify({ outputDir, sentences: phase3Questions.length }, null, 2));
