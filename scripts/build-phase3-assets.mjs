import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "outputs", "phase3_connected_speech_v1");
const audioDir = path.join(root, "audio", "phase3");
const typeNames = ["文の二択", "空欄補充", "語数判定", "チップ復元", "変化判定"];

const rawCategories = [
  {
    id: "P301", name: "子音→母音リンキング", example: "pick it up / turn it off", point: "語末子音を次の語頭母音へつなげて聞く",
    items: [
      ["Pick it up before you leave.", "出かける前にそれを拾って。", "pick it up", "pick‿it‿up：/k/ と /t/ が次の母音へ連結"],
      ["Turn it off when you finish.", "終わったらそれを消して。", "turn it off", "turn‿it‿off：/n/ と /t/ が次の母音へ連結"],
      ["Take it out of the box.", "箱からそれを取り出して。", "take it out", "take‿it‿out：/k/ と /t/ が次の母音へ連結"],
      ["Put it on the table.", "それをテーブルに置いて。", "put it on", "put‿it‿on：語境界を切らずに連結"],
      ["Read it aloud for us.", "私たちのためにそれを音読して。", "read it aloud", "read‿it‿aloud：/d/ と /t/ が次の母音へ連結"],
      ["Send it over tonight.", "今夜それを送って。", "send it over", "send‿it‿over：/d/ と /t/ が次の母音へ連結"],
      ["Leave it at the desk.", "それを受付に置いて。", "leave it at", "leave‿it‿at：/v/ と /t/ が次の母音へ連結"],
      ["Check it again tomorrow.", "明日もう一度確認して。", "check it again", "check‿it‿again：/k/ と /t/ が次の母音へ連結"],
      ["Hold on a minute.", "ちょっと待って。", "hold on", "hold‿on：/d/ が次の母音へ連結"],
      ["Come in and sit down.", "入って座って。", "come in", "come‿in：/m/ が次の母音へ連結"],
    ],
  },
  {
    id: "P302", name: "母音→母音リンキング", example: "go out / see it", point: "/w/・/j/ の渡り音を手掛かりに母音間を聞く",
    items: [
      ["Go out and get some air.", "外に出て空気を吸って。", "go out", "go‿(w)out：/w/ の渡り音"],
      ["Do it again for me.", "私のためにもう一度やって。", "do it", "do‿(w)it：/w/ の渡り音"],
      ["I agree with your idea.", "あなたの考えに賛成です。", "I agree", "I‿(j)agree：/j/ の渡り音"],
      ["We asked for some help.", "私たちは助けを求めた。", "we asked", "we‿(j)asked：/j/ の渡り音"],
      ["See it for yourself.", "自分で確かめて。", "see it", "see‿(j)it：/j/ の渡り音"],
      ["She always arrives early.", "彼女はいつも早く着く。", "she always", "she‿(j)always：/j/ の渡り音"],
      ["Go over the details.", "詳細を確認して。", "go over", "go‿(w)over：/w/ の渡り音"],
      ["Who is at the door?", "ドアの所にいるのは誰？", "who is", "who‿(w)is：/w/ の渡り音"],
      ["They are already here.", "彼らはもうここにいる。", "they are", "they‿(j)are：/j/ の渡り音"],
      ["Try it one more time.", "もう一度やってみて。", "try it", "try‿(j)it：/j/ の渡り音"],
    ],
  },
  {
    id: "P303", name: "隣接子音の連結", example: "big game / good day", point: "同じ・近い子音を二度破裂させず一まとまりで聞く",
    items: [
      ["The big game starts tonight.", "大きな試合は今夜始まる。", "big game", "big‿game：/g/ を一度だけ長めに保持"],
      ["We had two good days.", "私たちは良い日を二日過ごした。", "good days", "good‿days：/d/ を重ねて一度に解放"],
      ["Take care on the stairs.", "階段では気をつけて。", "take care", "take‿care：/k/ を重ねて連結"],
      ["Keep practicing every day.", "毎日練習を続けて。", "keep practicing", "keep‿practicing：/p/ を重ねて連結"],
      ["The red door is open.", "赤いドアは開いている。", "red door", "red‿door：/d/ を一度にまとめる"],
      ["Stop playing with that.", "それで遊ぶのをやめて。", "stop playing", "stop‿playing：/p/ を一度にまとめる"],
      ["A black cat crossed the road.", "黒猫が道路を渡った。", "black cat", "black‿cat：/k/ を重ねて連結"],
      ["This bus stop is crowded.", "このバス停は混んでいる。", "bus stop", "bus‿stop：/s/ を切らずに保持"],
      ["She felt tired today.", "彼女は今日疲れていた。", "felt tired", "felt‿tired：/t/ を重ねて連結"],
      ["The top player scored again.", "トップ選手がまた得点した。", "top player", "top‿player：/p/ を一度だけ解放"],
    ],
  },
  {
    id: "P304", name: "弱形・シュワー", example: "him・her・his / to・for・of・at", point: "代名詞の目的格・所有格と前置詞などの弱形を復元する",
    items: [
      ["Tell him about the meeting.", "彼に会議のことを伝えて。", "him", "him /hɪm/ → /ɪm/：/h/ 脱落を伴う弱形"],
      ["I saw her at the station.", "駅で彼女を見かけた。", "her", "her /hɝː/ → /ər/：/h/ 脱落を伴う弱形"],
      ["That is his new car.", "あれは彼の新しい車です。", "his", "his /hɪz/ → /ɪz/：/h/ 脱落を伴う弱形"],
      ["Give them a few minutes.", "彼らに数分あげて。", "them", "them /ðem/ → /ðəm/：母音がシュワー化"],
      ["We are going to the store.", "私たちは店へ行くところです。", "to", "to /tuː/ → /tə/：前置詞の弱形"],
      ["This gift is for my sister.", "この贈り物は姉へのものです。", "for", "for /fɔːr/ → /fər/：前置詞の弱形"],
      ["I need a cup of coffee.", "コーヒーを一杯ください。", "of", "of /ʌv/ → /əv, ə/：前置詞の弱形"],
      ["Meet me at the entrance.", "入口で会いましょう。", "at", "at /æt/ → /ət/：前置詞の弱形"],
      ["She came from the office.", "彼女はオフィスから来た。", "from", "from /frʌm/ → /frəm/：前置詞の弱形"],
      ["Bread and butter, please.", "パンとバターをお願いします。", "and", "and /ænd/ → /ən, n/：接続詞の弱形"],
    ],
  },
  {
    id: "P305", name: "文の強弱・リズム", example: "content words / function words", point: "内容語の強勢と機能語の弱化から意味の核をつかむ",
    items: [
      ["The CHILD bought a NEW red BIKE.", "その子は新しい赤い自転車を買った。", "child / new / bike", "内容語 CHILD・NEW・BIKE に強勢"],
      ["Please SEND me the FILE by FOUR.", "4時までにファイルを送って。", "send / file / four", "意味の核 SEND・FILE・FOUR に強勢"],
      ["We NEED to FIND a CHEAP hotel.", "安いホテルを探す必要がある。", "need / find / cheap / hotel", "内容語が拍を作り機能語は短くなる"],
      ["She LEFT her KEYS on the TRAIN.", "彼女は電車に鍵を忘れた。", "left / keys / train", "LEFT・KEYS・TRAIN に強勢"],
      ["I ORDERED the SOUP and a SALAD.", "スープとサラダを注文した。", "ordered / soup / salad", "内容語間をほぼ等間隔で発音"],
      ["They MOVED to a HOUSE near SCHOOL.", "彼らは学校近くの家に引っ越した。", "moved / house / school", "MOVED・HOUSE・SCHOOL に強勢"],
      ["Can you CALL me AFTER LUNCH?", "昼食後に電話してくれる？", "call / after / lunch", "CALL・AFTER・LUNCH が強勢核"],
      ["The MEETING starts at HALF past NINE.", "会議は9時半に始まる。", "meeting / half / nine", "時刻を担う語に強勢"],
      ["He DROVE through the RAIN all NIGHT.", "彼は一晩中雨の中を運転した。", "drove / rain / night", "DROVE・RAIN・NIGHT に強勢"],
      ["I REALLY LIKE your NEW idea.", "あなたの新しい案が本当に好き。", "really / like / new / idea", "焦点語を強く、機能語を弱く発音"],
    ],
  },
  {
    id: "P306", name: "T・Dのフラップ", example: "get it / a lot of", point: "母音間の /t, d/ が日本語のラ行に近い弾き音になる",
    items: [
      ["I got it at the market.", "市場でそれを手に入れた。", "got it", "got it：/t/ → [ɾ]"],
      ["Put it on the table.", "それをテーブルに置いて。", "put it", "put it：/t/ → [ɾ]"],
      ["What are you doing?", "何をしているの？", "what are", "what are：/t/ → [ɾ]"],
      ["We need a lot of water.", "水がたくさん必要です。", "lot of water", "lot of / water：/t/ → [ɾ]"],
      ["She wrote it in a letter.", "彼女はそれを手紙に書いた。", "wrote it", "wrote it：/t/ → [ɾ]"],
      ["Get out of the car.", "車から降りて。", "get out", "get out：/t/ → [ɾ]"],
      ["I bought a better computer.", "より良いパソコンを買った。", "better computer", "better：/t/ → [ɾ]"],
      ["He waited at the station.", "彼は駅で待った。", "waited at", "waited at：/t, d/ の連続がフラップ化"],
      ["That is a beautiful city.", "あれは美しい街です。", "beautiful city", "beautiful / city：強勢のない母音間 /t/ → [ɾ]"],
      ["I met her at a party.", "パーティーで彼女に会った。", "at a party", "at a：/t/ → [ɾ]"],
    ],
  },
  {
    id: "P307", name: "音の脱落", example: "next day / old man", point: "子音群で落ちやすい /t, d/ を文脈から補う",
    items: [
      ["I went there last night.", "昨夜そこへ行った。", "last night", "last night：/t/ が脱落しやすい"],
      ["The next day was sunny.", "翌日は晴れだった。", "next day", "next day：/t/ が脱落しやすい"],
      ["She held my hand.", "彼女は私の手を握った。", "held my", "held my：/d/ が弱化・脱落しやすい"],
      ["He left the door open.", "彼はドアを開けたままにした。", "left the", "left the：子音群で /t/ が弱くなる"],
      ["We must go now.", "もう行かなければならない。", "must go", "must go：/t/ が脱落しやすい"],
      ["I do not know the answer.", "答えが分かりません。", "do not know", "not know：/t/ が脱落しやすい"],
      ["She asked me twice.", "彼女は私に二度尋ねた。", "asked me", "asked me：子音群 /sktm/ が簡略化"],
      ["It was the best movie.", "それが一番良い映画だった。", "best movie", "best movie：/t/ が脱落しやすい"],
      ["They found the old man.", "彼らはその老人を見つけた。", "found the", "found the：/d/ が弱化・脱落しやすい"],
      ["I kept the first prize.", "私は一等賞を取っておいた。", "first prize", "first prize：子音群で /t/ が脱落しやすい"],
    ],
  },
  {
    id: "P308", name: "同化・音の融合", example: "did you / don’t you", point: "隣り合う音が相手に近づく、または新しい音に融合する",
    items: [
      ["Did you call me?", "私に電話した？", "did you", "did you：/d + j/ → /dʒ/"],
      ["Would you like some tea?", "紅茶はいかが？", "would you", "would you：/d + j/ → /dʒ/"],
      ["Don't you know her?", "彼女を知らないの？", "don't you", "don't you：/t + j/ → /tʃ/"],
      ["Could you open the door?", "ドアを開けてくれる？", "could you", "could you：/d + j/ → /dʒ/"],
      ["I miss you already.", "もうあなたが恋しい。", "miss you", "miss you：/s + j/ → /ʃ/"],
      ["Bless you.", "お大事に。", "bless you", "bless you：/s + j/ → /ʃ/"],
      ["As you know, we are ready.", "ご存じのとおり準備はできています。", "as you", "as you：/z + j/ → /ʒ/"],
      ["This year went quickly.", "今年はあっという間だった。", "this year", "this year：/s + j/ が /ʃ/ に近づく"],
      ["Ten boys joined the team.", "10人の少年がチームに入った。", "ten boys", "ten boys：/n/ → /m/（両唇音の前）"],
      ["Green paper is on the desk.", "緑の紙は机の上です。", "green paper", "green paper：/n/ → /m/（両唇音の前）"],
    ],
  },
  {
    id: "P309", name: "頻出リダクション", example: "gonna / wanna / hafta", point: "会話で頻出するまとまりを一つの音の塊として認識する",
    items: [
      ["I am going to call you.", "あなたに電話するつもりです。", "going to", "going to → gonna"],
      ["Do you want to come?", "一緒に来たい？", "want to", "want to → wanna"],
      ["I have to leave now.", "もう出なければならない。", "have to", "have to → hafta"],
      ["Let me check it.", "確認させて。", "let me", "let me → lemme"],
      ["Give me a minute.", "少し時間をください。", "give me", "give me → gimme"],
      ["I have got to go.", "もう行かなければ。", "got to", "got to → gotta"],
      ["You should have told me.", "私に言うべきだった。", "should have", "should have → shoulda /ʃʊdə/"],
      ["I could have helped you.", "あなたを助けられたのに。", "could have", "could have → coulda /kʊdə/"],
      ["What are you doing?", "何をしているの？", "what are you", "what are you → whaddaya（速い会話）"],
      ["It is kind of strange.", "ちょっと変だね。", "kind of", "kind of → kinda"],
    ],
  },
];

function shuffledWords(sentence) {
  const words = sentence.replace(/[?.!,]/g, "").split(/\s+/);
  return [...words.slice(1), words[0]].join(" / ");
}

const phase3Categories = rawCategories.map(({ items, ...category }) => ({ ...category, count: items.length }));
const phase3Questions = rawCategories.flatMap((category) => category.items.map((item, index) => {
  const [sentence, japanese, targetChunk, soundChange] = item;
  const questionType = typeNames[index % typeNames.length];
  const wordCount = sentence.replace(/[?.!,]/g, "").split(/\s+/).length;
  const distractor = questionType === "語数判定"
    ? `${Math.max(1, wordCount - 1)}語 / ${wordCount + 1}語`
    : questionType === "チップ復元"
      ? shuffledWords(sentence)
      : questionType === "変化判定"
        ? "変化なし / 単語を一語ずつ区切る"
        : `聞き取り注意：${targetChunk}`;
  return {
    id: `${category.id}-${String(index + 1).padStart(2, "0")}`,
    categoryId: category.id,
    category: category.name,
    learningPoint: category.point,
    questionType,
    sentence,
    japanese,
    targetChunk,
    soundChange,
    prompt: questionType === "文の二択" ? "自然な音声に含まれた文を選ぶ" : questionType === "空欄補充" ? "聞こえた語句を空欄に入れる" : questionType === "語数判定" ? "聞こえた語数を選ぶ" : questionType === "チップ復元" ? "語句チップを並べて文を復元する" : "起きている音の変化を選ぶ",
    distractor,
    wordCount,
    audioFile: `audio/phase3/${category.id}-${String(index + 1).padStart(2, "0")}.wav`,
    status: "Draft audio",
    note: "音声合成版。正式版では狙った音変化を再現した収録音声に差し替える。",
  };
}));

async function writeBrowserData() {
  const contents = `export const phase3Categories = ${JSON.stringify(phase3Categories, null, 2)};\n\nexport const phase3Questions = ${JSON.stringify(phase3Questions, null, 2)};\n`;
  await fs.writeFile(path.join(root, "phase3-data.js"), contents);
}

async function buildAudio() {
  await fs.mkdir(audioDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "listenquest-phase3-"));
  try {
    for (const [index, question] of phase3Questions.entries()) {
      const fileName = path.basename(question.audioFile);
      const target = path.join(audioDir, fileName);
      try {
        const stat = await fs.stat(target);
        if (stat.size > 4096) continue;
      } catch {
        // Generate a missing prototype file.
      }
      const tempAiff = path.join(tempDir, `${question.id}.aiff`);
      await execFileAsync("/usr/bin/say", ["-v", "Samantha", "-r", "205", "-o", tempAiff, question.sentence]);
      await execFileAsync("/usr/bin/afconvert", [tempAiff, "-o", target, "-f", "WAVE", "-d", "LEI16"]);
      if ((index + 1) % 10 === 0) console.log(`audio ${index + 1}/${phase3Questions.length}`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function styleTitle(sheet, rangeAddress, title) {
  const range = sheet.getRange(rangeAddress);
  range.merge();
  range.values = [[title]];
  range.format = { fill: "#15131F", font: { bold: true, color: "#FFFFFF", size: 20 }, verticalAlignment: "center" };
  range.format.rowHeight = 38;
}

function styleHeader(range) {
  range.format = {
    fill: "#6F58F7",
    font: { bold: true, color: "#FFFFFF" },
    verticalAlignment: "center",
    wrapText: true,
    borders: { bottom: { style: "medium", color: "#EC59C0" } },
  };
  range.format.rowHeight = 30;
}

async function buildWorkbook() {
  await fs.mkdir(outputDir, { recursive: true });
  const workbook = Workbook.create();
  const readme = workbook.worksheets.add("README");
  const categorySheet = workbook.worksheets.add("Categories");
  const formatSheet = workbook.worksheets.add("Question Formats");
  const questionSheet = workbook.worksheets.add("Phase 3 Questions");

  for (const sheet of [readme, categorySheet, formatSheet, questionSheet]) sheet.showGridLines = false;

  styleTitle(readme, "A1:H1", "ListeningQuest — Phase 3 Connected Speech");
  readme.getRange("A3:B9").values = [
    ["項目", "内容"],
    ["教材数", 90],
    ["カテゴリー数", 9],
    ["音声", "Samantha (en-US) / 205 wpm のプロトタイプ音声"],
    ["用途", "文中のリンキング・弱形・フラップ・脱落・同化・リダクションの聞き取り"],
    ["重要", "正式版は、各行の狙った音変化を確実に発音した収録音声へ差し替えてください。"],
    ["編集方法", "Phase 3 Questions の Status と Review Notes を確認・更新してください。"],
  ];
  styleHeader(readme.getRange("A3:B3"));
  readme.getRange("A4:A9").format = { fill: "#EDE9FE", font: { bold: true, color: "#2B2147" } };
  readme.getRange("A3:B9").format.wrapText = true;
  readme.getRange("A3:A9").format.columnWidth = 18;
  readme.getRange("B3:B9").format.columnWidth = 72;
  readme.getRange("A4:B9").format.rowHeight = 28;

  styleTitle(categorySheet, "A1:F1", "Phase 3 — 9 Learning Points");
  const categoryRows = phase3Categories.map((c, index) => [index + 1, c.id, c.name, c.point, c.example, c.count]);
  categorySheet.getRange(`A3:F${categoryRows.length + 3}`).values = [["No.", "Category ID", "カテゴリー", "学習ポイント", "代表例", "設問数"], ...categoryRows];
  styleHeader(categorySheet.getRange("A3:F3"));
  categorySheet.tables.add(`A3:F${categoryRows.length + 3}`, true, "Phase3CategoriesTable").style = "TableStyleMedium4";
  categorySheet.freezePanes.freezeRows(3);
  categorySheet.getRange("A:A").format.columnWidth = 7;
  categorySheet.getRange("B:B").format.columnWidth = 13;
  categorySheet.getRange("C:C").format.columnWidth = 25;
  categorySheet.getRange("D:D").format.columnWidth = 52;
  categorySheet.getRange("E:E").format.columnWidth = 30;
  categorySheet.getRange("F:F").format.columnWidth = 9;
  categorySheet.getRange("A3:F12").format.wrapText = true;
  categorySheet.getRange("A4:F12").format.rowHeight = 34;

  styleTitle(formatSheet, "A1:E1", "Phase 3 — Question Design");
  const formatRows = [
    ["文の二択", "音声を1回聞く", "自然な音声に含まれた文を選ぶ", "意味の近い二文を並べる", "意味ではなく音声情報で判断"],
    ["空欄補充", "音声を1〜2回聞く", "聞こえた弱形・連結語句を補う", "候補チップを3〜4個表示", "弱形を空白として聞き逃さない"],
    ["語数判定", "音声を1回聞く", "聞こえた語数を選ぶ", "±1語を主な誤答にする", "音の塊と実際の単語数を切り分ける"],
    ["チップ復元", "音声を聞いて並べ替え", "語句チップを文順に復元する", "機能語も独立チップにする", "弱くなった語も文法から復元"],
    ["変化判定", "対象部分を再生", "起きた音声変化を選ぶ", "連結・弱化・脱落・同化を混在", "現象名と実音声を結び付ける"],
  ];
  formatSheet.getRange("A3:E8").values = [["出題形式", "再生", "学習者の操作", "誤答設計", "ねらい"], ...formatRows];
  styleHeader(formatSheet.getRange("A3:E3"));
  formatSheet.tables.add("A3:E8", true, "Phase3FormatsTable").style = "TableStyleMedium4";
  formatSheet.getRange("A:A").format.columnWidth = 16;
  formatSheet.getRange("B:B").format.columnWidth = 23;
  formatSheet.getRange("C:E").format.columnWidth = 38;
  formatSheet.getRange("A3:E8").format.wrapText = true;
  formatSheet.getRange("A4:E8").format.rowHeight = 44;

  styleTitle(questionSheet, "A1:P1", "Phase 3 — 90 Question Set");
  const headers = ["ID", "Category ID", "カテゴリー", "学習ポイント", "出題形式", "英文", "日本語", "対象チャンク", "期待する音変化", "問題文", "誤答・チップ案", "語数", "音声ファイル", "Status", "Review Notes", "制作メモ"];
  const rows = phase3Questions.map((q) => [q.id, q.categoryId, q.category, q.learningPoint, q.questionType, q.sentence, q.japanese, q.targetChunk, q.soundChange, q.prompt, q.distractor, q.wordCount, q.audioFile, q.status, "", q.note]);
  questionSheet.getRange(`A3:P${rows.length + 3}`).values = [headers, ...rows];
  styleHeader(questionSheet.getRange("A3:P3"));
  questionSheet.tables.add(`A3:P${rows.length + 3}`, true, "Phase3QuestionsTable").style = "TableStyleMedium4";
  questionSheet.freezePanes.freezeRows(3);
  questionSheet.freezePanes.freezeColumns(2);
  const columnLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
  const widths = [15, 13, 24, 42, 14, 38, 34, 22, 42, 30, 35, 8, 34, 17, 30, 48];
  widths.forEach((width, index) => { questionSheet.getRange(`${columnLetters[index]}:${columnLetters[index]}`).format.columnWidth = width; });
  questionSheet.getRange(`A3:P${rows.length + 3}`).format.wrapText = true;
  questionSheet.getRange(`A4:P${rows.length + 3}`).format.rowHeight = 48;
  questionSheet.getRange(`L4:L${rows.length + 3}`).format.numberFormat = "0";
  questionSheet.getRange(`N4:N${rows.length + 3}`).dataValidation = { rule: { type: "list", values: ["Draft audio", "Needs review", "Approved", "Recorded"] } };
  questionSheet.getRange(`N4:N${rows.length + 3}`).conditionalFormats.add("containsText", { text: "Approved", format: { fill: "#D1FAE5", font: { color: "#065F46", bold: true } } });
  questionSheet.getRange(`N4:N${rows.length + 3}`).conditionalFormats.add("containsText", { text: "Needs review", format: { fill: "#FEE2E2", font: { color: "#991B1B", bold: true } } });

  const inspect = await workbook.inspect({ kind: "workbook,sheet,table", maxChars: 9000, tableMaxRows: 4, tableMaxCols: 8, tableMaxCellChars: 80 });
  await fs.writeFile(path.join(outputDir, "workbook_inspect.ndjson"), inspect.ndjson || JSON.stringify(inspect, null, 2));
  const keyRange = await workbook.inspect({ kind: "region", sheetId: "Phase 3 Questions", range: "A1:P12", maxChars: 12000 });
  await fs.writeFile(path.join(outputDir, "questions_key_range.ndjson"), keyRange.ndjson || JSON.stringify(keyRange, null, 2));
  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, maxChars: 5000 });
  await fs.writeFile(path.join(outputDir, "formula_error_scan.ndjson"), errors.ndjson || JSON.stringify(errors, null, 2));

  for (const sheetName of ["README", "Categories", "Question Formats", "Phase 3 Questions"]) {
    const preview = await workbook.render({ sheetName, autoCrop: "all", scale: sheetName === "Phase 3 Questions" ? 0.5 : 1, format: "png" });
    const safeName = sheetName.toLowerCase().replaceAll(" ", "_");
    await fs.writeFile(path.join(outputDir, `${safeName}_preview.png`), new Uint8Array(await preview.arrayBuffer()));
  }

  const xlsx = await SpreadsheetFile.exportXlsx(workbook);
  await xlsx.save(path.join(outputDir, "ListeningQuest_Phase3_90_questions.xlsx"));
}

await writeBrowserData();
await buildAudio();
await buildWorkbook();
console.log(JSON.stringify({ categories: phase3Categories.length, questions: phase3Questions.length, outputDir, audioDir }, null, 2));
