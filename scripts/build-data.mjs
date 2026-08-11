import fs from "node:fs/promises";

const root = new URL("../", import.meta.url);
const phase1Source = await fs.readFile(new URL(".tmp_spreadsheet_minimal_pairs/build_minimal_pairs.mjs", root), "utf8");
const phase2Source = await fs.readFile(new URL(".tmp_spreadsheet_minimal_pairs/build_phase2.mjs", root), "utf8");

function readArray(source, variableName) {
  const match = source.match(new RegExp(`const ${variableName} = (\\[[\\s\\S]*?\\n\\]);`));
  if (!match) throw new Error(`Could not find ${variableName}`);
  return Function(`"use strict"; return (${match[1]});`)();
}

const categoryRows = [
  ...readArray(phase1Source, "categories").map((row) => [1, ...row]),
  ...readArray(phase2Source, "phase2Categories").map((row) => [2, ...row]),
];
const pairRows = [
  ...readArray(phase1Source, "pairData"),
  ...readArray(phase2Source, "phase2Data"),
];

const categories = categoryRows.map(([phase, id, name, contrast, example, goal, priority]) => ({
  phase,
  id,
  name,
  contrast,
  example,
  goal,
  priority,
}));

const pairs = pairRows.map(([categoryId, , , number, a, ipaA, meaningA, b, ipaB, meaningB, position, difficulty]) => ({
  categoryId,
  number,
  a: { word: a, ipa: ipaA, meaning: meaningA },
  b: { word: b, ipa: ipaB, meaning: meaningB },
  position,
  difficulty,
}));

const oldPair = pairs.find((pair) => pair.categoryId === "C08" && pair.number === 9);
Object.assign(oldPair, {
  a: { word: "pin", ipa: "/pɪn/", meaning: "ピン、ピンで留める" },
  b: { word: "ping", ipa: "/pɪŋ/", meaning: "ピング音、通信確認を送る" },
});

const output = `// Generated from the approved ListenQuest workbook.\nexport const categories = ${JSON.stringify(categories, null, 2)};\n\nexport const pairs = ${JSON.stringify(pairs, null, 2)};\n`;
await fs.writeFile(new URL("data.js", root), output);
console.log(`Generated ${categories.length} categories and ${pairs.length} pairs.`);
