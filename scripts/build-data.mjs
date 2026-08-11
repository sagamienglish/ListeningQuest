import fs from "node:fs/promises";
import { phase12Additions } from "./phase12-additions.mjs";

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

const hardHeardCategory = categories.find((category) => category.id === "C16");
Object.assign(hardHeardCategory, {
  name: "hard / heard",
  contrast: "/ɑr/ – /ɝ/",
  example: "hard / heard",
  goal: "Rの前の開いた /ɑr/ とR音化した中央母音 /ɝ/ を識別する",
  priority: "高",
});

const hardHeardPairs = [
  [1, "hard", "/hɑrd/", "難しい、硬い", "heard", "/hɝd/", "聞いた", "語中母音", "初級"],
  [2, "heart", "/hɑrt/", "心、心臓", "hurt", "/hɝt/", "傷つける、痛む", "語中母音", "初級"],
  [3, "barn", "/bɑrn/", "納屋", "burn", "/bɝn/", "燃える、燃やす", "語中母音", "初級"],
  [4, "far", "/fɑr/", "遠くに", "fur", "/fɝ/", "毛皮", "語中母音", "初級"],
  [5, "park", "/pɑrk/", "公園、駐車する", "perk", "/pɝk/", "特典、元気を取り戻す", "語中母音", "中級"],
  [6, "star", "/stɑr/", "星", "stir", "/stɝ/", "かき混ぜる", "語中母音", "初級"],
  [7, "farm", "/fɑrm/", "農場", "firm", "/fɝm/", "会社、堅い", "語中母音", "初級"],
  [8, "carve", "/kɑrv/", "彫る、切り分ける", "curve", "/kɝv/", "曲線、曲がる", "語中母音", "中級"],
  [9, "dart", "/dɑrt/", "投げ矢、素早く動く", "dirt", "/dɝt/", "土、汚れ", "語中母音", "初級"],
  [10, "lark", "/lɑrk/", "ヒバリ、楽しい遊び", "lurk", "/lɝk/", "潜む", "語中母音", "中級"],
].map(([number, a, ipaA, meaningA, b, ipaB, meaningB, position, difficulty]) => ({
  categoryId: "C16",
  number,
  a: { word: a, ipa: ipaA, meaning: meaningA },
  b: { word: b, ipa: ipaB, meaning: meaningB },
  position,
  difficulty,
}));
const hardHeardStart = pairs.findIndex((pair) => pair.categoryId === "C16");
pairs.splice(hardHeardStart, 10, ...hardHeardPairs);

const pairNumbers = new Set(pairs.map((pair) => `${pair.categoryId}:${pair.number}`));
for (const pair of phase12Additions) {
  const key = `${pair.categoryId}:${pair.number}`;
  if (pairNumbers.has(key)) throw new Error(`Duplicate pair number: ${key}`);
  pairs.push(pair);
  pairNumbers.add(key);
}
pairs.sort((left, right) =>
  left.categoryId.localeCompare(right.categoryId) || left.number - right.number,
);

const output = `// Generated from the approved ListenQuest workbook.\nexport const categories = ${JSON.stringify(categories, null, 2)};\n\nexport const pairs = ${JSON.stringify(pairs, null, 2)};\n`;
await fs.writeFile(new URL("data.js", root), output);
console.log(`Generated ${categories.length} categories and ${pairs.length} pairs.`);
