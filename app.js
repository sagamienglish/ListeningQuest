import { categories, pairs } from "./data.js?v=20260811-5";
import { phase3Categories, phase3Questions } from "./phase3-data.js";
import { phase3AudioMap } from "./phase3-audio-map.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const STORAGE_KEY = "listeningquest-progress-v3";
const V2_STORAGE_KEY = "listenquest-progress-v2";
const V1_STORAGE_KEY = "listenquest-progress-v1";
const CATEGORY_CONTENT_REVISIONS = { C16: "hard-heard-v1" };
const sessionSize = 5;
const sentenceFrames = [
  (word) => `Please say ${word} again.`,
  (word) => `I heard the word “${word}” clearly.`,
  (word) => `She said ${word} twice.`,
  (word) => `The word was ${word}.`,
  (word) => `Did you say ${word}?`,
];
const phase12SentenceOverrides = new Map([
  ["C06-05-b", "This book is thick."],
]);
const planets = [
  { name: "水星", en: "Mercury", slug: "mercury" },
  { name: "金星", en: "Venus", slug: "venus" },
  { name: "火星", en: "Mars", slug: "mars" },
  { name: "木星", en: "Jupiter", slug: "jupiter" },
  { name: "土星", en: "Saturn", slug: "saturn" },
  { name: "天王星", en: "Uranus", slug: "uranus" },
  { name: "海王星", en: "Neptune", slug: "neptune" },
  { name: "月", en: "Moon", slug: "moon" },
];
const earth = { name: "地球", en: "Earth", slug: "earth" };
const planetConnections = [[0, 1], [1, 2], [3, 4], [5, 6], [6, 7]];
const phase3ShortNames = {
  P301: "子音→母音",
  P302: "母音→母音",
  P303: "子音の連結",
  P304: "弱形・シュワー",
  P305: "強弱・リズム",
  P306: "T・Dフラップ",
  P307: "音の脱落",
  P308: "同化・融合",
  P309: "リダクション",
};

function planetArt(planet, compact = false) {
  return `<span class="planet-art planet-${planet.slug} ${compact ? "is-compact" : ""}" aria-hidden="true"><i></i></span>`;
}

function categoryById(categoryId) {
  return categories.find((category) => category.id === categoryId)
    || phase3Categories.find((category) => category.id === categoryId);
}
const state = {
  view: "home",
  homeMode: "training",
  trainingMenuOpen: false,
  phase: 1,
  mode: "random",
  category: null,
  questions: [],
  questionIndex: 0,
  selected: null,
  phase3TokenAnswer: [],
  answers: [],
  questionStartedAt: 0,
  lastFeedback: null,
  lastRewards: null,
  finalQuiz: null,
  batchResponses: [],
};

let speechTimer;
let activeUtterance;
let feedbackAudioContext;
let ratingTimer;
let ratingFallbackTimer;
let phase3Audio;
let phase3ClipTimer;

const speakerSvg = `
  <svg class="speaker-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4Zm12.4-.7a1 1 0 0 0-1.4 1.4A3.2 3.2 0 0 1 16 12c0 .9-.36 1.72-1 2.3a1 1 0 1 0 1.4 1.4A5.17 5.17 0 0 0 18 12c0-1.45-.6-2.76-1.6-3.7Zm2.82-2.82a1 1 0 0 0-1.41 1.42A7.17 7.17 0 0 1 20 12c0 2-.84 3.8-2.19 5.1a1 1 0 1 0 1.41 1.42A9.15 9.15 0 0 0 22 12c0-2.55-1.06-4.86-2.78-6.52Z"/>
  </svg>`;

function emptyProgress() {
  return {
    phaseRatings: { 1: 1000, 2: 1000, 3: 1000 },
    ratingHistory: { 1: [1000], 2: [1000], 3: [1000] },
    overallRating: 1000,
    overallRatingHistory: [1000],
    mistakes: [],
    categoryContentRevisions: { ...CATEGORY_CONTENT_REVISIONS },
    totalCorrect: 0,
    totalQuestions: 0,
    categories: {},
  };
}

function migrateProgress() {
  const migrated = emptyProgress();
  try {
    const v2 = JSON.parse(localStorage.getItem(V2_STORAGE_KEY));
    if (v2?.categories) {
      migrated.totalCorrect = Number(v2.totalCorrect) || 0;
      migrated.totalQuestions = Number(v2.totalQuestions) || 0;
      migrated.categories = v2.categories;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    const v1 = JSON.parse(localStorage.getItem(V1_STORAGE_KEY));
    if (v1 && typeof v1 === "object") {
      Object.entries(v1).forEach(([categoryId, item]) => {
        if (!categories.some((category) => category.id === categoryId)) return;
        const correct = Number(item.totalCorrect) || 0;
        const questions = Number(item.totalQuestions) || 0;
        migrated.categories[categoryId] = {
          attempts: Number(item.attempts) || 0,
          mastery: Math.min(100, correct * 4 + Math.max(0, questions - correct)),
          totalCorrect: correct,
          totalQuestions: questions,
          lastPlayed: item.lastPlayed || null,
        };
        migrated.totalCorrect += correct;
        migrated.totalQuestions += questions;
      });
    }
  } catch {
    return emptyProgress();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  return migrated;
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.phaseRatings && saved?.categories) {
      saved.overallRating = Number(saved.overallRating) || 1000;
      saved.overallRatingHistory = Array.isArray(saved.overallRatingHistory) && saved.overallRatingHistory.length
        ? saved.overallRatingHistory.map(Number).filter(Number.isFinite).slice(-30)
        : [saved.overallRating];
      saved.mistakes = Array.isArray(saved.mistakes) ? saved.mistakes.slice(-40) : [];
      saved.categoryContentRevisions ||= {};
      let contentChanged = false;
      Object.entries(CATEGORY_CONTENT_REVISIONS).forEach(([categoryId, revision]) => {
        if (saved.categoryContentRevisions[categoryId] === revision) return;
        delete saved.categories[categoryId];
        saved.mistakes = saved.mistakes.filter((mistake) => mistake.categoryId !== categoryId);
        saved.categoryContentRevisions[categoryId] = revision;
        contentChanged = true;
      });
      saved.ratingHistory ||= {};
      [1, 2, 3].forEach((phase) => {
        const current = Number(saved.phaseRatings[phase]) || 1000;
        const history = Array.isArray(saved.ratingHistory[phase]) ? saved.ratingHistory[phase] : [];
        saved.ratingHistory[phase] = history.length ? history.map((item) => Number(item?.value ?? item) || current).slice(-30) : [current];
      });
      if (contentChanged) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      return saved;
    }
  } catch {
    // Ignore broken local values and start with a clean profile.
  }
  return migrateProgress();
}

function levelFromRating(rating) {
  return Math.max(1, Math.min(10, Math.floor(((Number(rating) || 1000) - 1000) / 100) + 1));
}

function ratingDelta(correct, seconds) {
  if (correct) {
    if (seconds <= 2) return 20;
    if (seconds <= 4) return 15;
    if (seconds <= 6) return 10;
    return 6;
  }
  if (seconds <= 2) return -16;
  if (seconds <= 4) return -12;
  if (seconds <= 6) return -9;
  return -6;
}

function mistakeKey(answer) {
  return answer.questionId || `${answer.categoryId}-${answer.pairNumber || answer.correctWord}-${answer.promptType || "word"}`;
}

function updateMistakeBank(progress, answer) {
  progress.mistakes ||= [];
  const key = mistakeKey(answer);
  progress.mistakes = progress.mistakes.filter((item) => item.key !== key);
  if (!answer.correct) {
    progress.mistakes.push({
      key,
      phase: answer.phase || (String(answer.categoryId).startsWith("P3") ? 3 : categoryById(answer.categoryId)?.phase),
      categoryId: answer.categoryId,
      questionId: answer.questionId || null,
      pairNumber: answer.pairNumber || null,
      promptType: answer.promptType || "word",
      correctWord: answer.correctWord,
      selectedWord: answer.selectedWord,
      lastWrong: new Date().toISOString(),
    });
    progress.mistakes = progress.mistakes.slice(-40);
  }
}

function saveSession(finalBonus = 0) {
  const progress = loadProgress();
  const beforeRating = Number(progress.phaseRatings[state.phase]) || 1000;
  const requestedDelta = state.mode === "random" ? state.answers.reduce((sum, answer) => sum + answer.ratingDelta, 0) + finalBonus : 0;
  const afterRating = Math.max(600, Math.min(2000, beforeRating + requestedDelta));
  const categoryChangeMap = new Map();

  progress.phaseRatings[state.phase] = afterRating;
  progress.ratingHistory ||= {};
  progress.ratingHistory[state.phase] = [...(progress.ratingHistory[state.phase] || [beforeRating]), afterRating].slice(-30);
  state.answers.forEach((answer) => {
    const previous = progress.categories[answer.categoryId] || {
      attempts: 0,
      mastery: 0,
      totalCorrect: 0,
      totalQuestions: 0,
    };
    const previousMastery = Number(previous.mastery) || 0;
    const requestedMasteryDelta = answer.correct ? 4 : -2;
    const mastery = Math.max(0, Math.min(100, previousMastery + requestedMasteryDelta));
    progress.categories[answer.categoryId] = {
      attempts: previous.attempts + 1,
      mastery,
      totalCorrect: previous.totalCorrect + (answer.correct ? 1 : 0),
      totalQuestions: previous.totalQuestions + 1,
      lastPlayed: new Date().toISOString(),
    };
    const change = categoryChangeMap.get(answer.categoryId) || {
      categoryId: answer.categoryId,
      name: categoryById(answer.categoryId)?.name || answer.categoryId,
      delta: 0,
      mastery,
    };
    change.delta += mastery - previousMastery;
    change.mastery = mastery;
    categoryChangeMap.set(answer.categoryId, change);
    updateMistakeBank(progress, answer);
  });

  const correct = state.answers.filter((answer) => answer.correct).length;
  progress.totalCorrect += correct;
  progress.totalQuestions += state.answers.length;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));

  return {
    beforeRating,
    afterRating,
    ratingDelta: afterRating - beforeRating,
    beforeLevel: levelFromRating(beforeRating),
    level: levelFromRating(afterRating),
    averageSeconds: state.answers.reduce((sum, answer) => sum + answer.seconds, 0) / state.answers.length,
    categoryChanges: [...categoryChangeMap.values()],
    finalBonus,
  };
}

function saveAssessmentSession() {
  const progress = loadProgress();
  const beforeRating = Number(progress.overallRating) || 1000;
  const requestedDelta = state.mode === "weakness" ? 0 : state.answers.reduce((sum, answer) => sum + answer.ratingDelta, 0);
  const afterRating = Math.max(600, Math.min(2000, beforeRating + requestedDelta));
  const categoryChangeMap = new Map();
  progress.overallRating = afterRating;
  progress.overallRatingHistory = [...(progress.overallRatingHistory || [beforeRating]), afterRating].slice(-30);
  state.answers.forEach((answer) => {
    const previous = progress.categories[answer.categoryId] || { attempts: 0, mastery: 0, totalCorrect: 0, totalQuestions: 0 };
    const previousMastery = Number(previous.mastery) || 0;
    const mastery = Math.max(0, Math.min(100, previousMastery + (answer.correct ? 4 : -2)));
    progress.categories[answer.categoryId] = {
      attempts: previous.attempts + 1,
      mastery,
      totalCorrect: previous.totalCorrect + (answer.correct ? 1 : 0),
      totalQuestions: previous.totalQuestions + 1,
      lastPlayed: new Date().toISOString(),
    };
    categoryChangeMap.set(answer.categoryId, {
      categoryId: answer.categoryId,
      name: categoryById(answer.categoryId)?.name || answer.categoryId,
      delta: mastery - previousMastery,
      mastery,
    });
    updateMistakeBank(progress, answer);
  });
  const correct = state.answers.filter((answer) => answer.correct).length;
  progress.totalCorrect += correct;
  progress.totalQuestions += state.answers.length;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  return {
    beforeRating,
    afterRating,
    ratingDelta: afterRating - beforeRating,
    beforeLevel: levelFromRating(beforeRating),
    level: levelFromRating(afterRating),
    averageSeconds: state.answers.reduce((sum, answer) => sum + answer.seconds, 0) / state.answers.length,
    categoryChanges: [...categoryChangeMap.values()],
    finalBonus: 0,
  };
}

function ratingChartSvg(history, current) {
  const values = (history?.length ? history : [current]).map(Number);
  const chartValues = values.length === 1 ? [values[0], values[0]] : values;
  const min = Math.min(...chartValues) - 20;
  const max = Math.max(...chartValues) + 20;
  const points = chartValues.map((value, index) => {
    const x = 4 + (index / Math.max(1, chartValues.length - 1)) * 142;
    const y = 42 - ((value - min) / Math.max(1, max - min)) * 34;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = points.split(" ").at(-1).split(",");
  return `<svg viewBox="0 0 150 48" role="img" aria-label="最近${values.length}回のレート推移"><defs><linearGradient id="rating-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ec59c0" stop-opacity=".35"/><stop offset="1" stop-color="#6f58f7" stop-opacity="0"/></linearGradient></defs><polygon points="4,46 ${points} 146,46" fill="url(#rating-area)"/><polyline points="${points}" fill="none" stroke="#b8adff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="#ec59c0" stroke="#fff" stroke-width="1.5"/></svg>`;
}

function levelProgressData(rating) {
  const level = levelFromRating(rating);
  const floor = 1000 + (level - 1) * 100;
  const next = level >= 10 ? 2000 : floor + 100;
  const percent = level >= 10 ? 100 : Math.max(0, Math.min(100, ((rating - floor) / 100) * 100));
  return { level, next, percent, remaining: Math.max(0, next - rating) };
}

function levelProgressMarkup(rating, beforeRating = rating, compact = false) {
  const data = levelProgressData(rating);
  const before = levelProgressData(beforeRating);
  const startPercent = before.level === data.level ? before.percent : 0;
  return `<div class="level-progress ${compact ? "is-compact" : ""}" style="--level-progress:${data.percent}%;--level-start:${startPercent}%"><div><span>LEVEL ${data.level}</span><strong>${data.level >= 10 ? "MAX LEVEL" : `次のLEVELまで あと${data.remaining}`}</strong><small>${rating} RATE</small></div><i><b></b><em></em></i>${compact ? "" : `<footer><span>${data.level >= 10 ? "2000" : data.next - 100}</span><span>${data.next}</span></footer>`}</div>`;
}

function primaryModesMarkup(progress) {
  const overallRating = Number(progress.overallRating) || 1000;
  const mistakeCount = progress.mistakes?.length || 0;
  const mode = state.homeMode || "training";
  return `<nav class="learning-mode-nav" aria-label="学習モード"><button class="learning-mode-button is-training ${mode === "training" ? "is-active" : ""}" type="button" data-home-mode="training" aria-current="${mode === "training" ? "page" : "false"}"><span>▶</span><small>LEARN</small><strong>音声トレーニング</strong></button><button class="learning-mode-button is-assessment ${mode === "assessment" ? "is-active" : ""}" type="button" data-home-mode="assessment" aria-current="${mode === "assessment" ? "page" : "false"}"><span>★</span><small>ALL PHASES · LEVEL ${levelFromRating(overallRating)}</small><strong>総合レベルテスト</strong></button><button class="learning-mode-button is-weakness ${mode === "weakness" ? "is-active" : ""}" type="button" data-home-mode="weakness" aria-current="${mode === "weakness" ? "page" : "false"}"><span>↻</span><small>${mistakeCount ? `${mistakeCount}問を保存中` : "誤答なし"}</small><strong>苦手リトライ</strong></button></nav>`;
}

function trainingContextMarkup() {
  return `<section class="training-context-bar" aria-label="音声トレーニングの現在位置"><span>▶</span><div><small>LISTENING TRAINING</small><strong>音声トレーニング <i>›</i> <em>Phaseを選択</em></strong></div><button type="button" data-training-overview="true">概要へ戻る</button></section>`;
}

function phaseCourseSelectorMarkup(activePhase) {
  return `<div class="phase-course-grid" role="group" aria-label="学習コース">${[1, 2, 3].map((phase) => `<article class="phase-launch-card ${activePhase === phase ? "is-active" : ""}"><button class="phase-course-button" type="button" data-phase="${phase}" aria-pressed="${activePhase === phase}"><strong>Phase ${phase}</strong></button><button class="phase-inline-start" type="button" ${phase === 3 ? `data-phase3-random="true"` : `data-random="${phase}"`}><span>▶</span><strong>ランダム5題</strong><i>→</i></button></article>`).join("")}</div>`;
}

function focusItemsMarkup(progress, categoryPool) {
  const focus = categoryPool.map((category) => {
    const item = progress.categories[category.id];
    const questions = Number(item?.totalQuestions) || 0;
    const correct = Number(item?.totalCorrect) || 0;
    return { category, questions, accuracy: questions ? Math.round((correct / questions) * 100) : 0, mastery: Number(item?.mastery) || 0 };
  }).filter((item) => item.questions > 0)
    .sort((left, right) => left.accuracy - right.accuracy || left.mastery - right.mastery || right.questions - left.questions)
    .slice(0, 3);
  if (!focus.length) return `<div class="focus-items"><strong>重点項目</strong><span>回答後に苦手な音を表示</span></div>`;
  return `<div class="focus-items"><strong>重点項目</strong>${focus.map((item) => `<span>${item.category.name}<small>正答率 ${item.accuracy}%</small></span>`).join("")}</div>`;
}

function globalTrainingStrip(progress) {
  const overallRating = Number(progress.overallRating) || 1000;
  const mistakeCount = progress.mistakes?.length || 0;
  return `<section class="global-training-strip" aria-label="全Phase共通トレーニング"><div><p class="eyebrow">All phases</p><strong>全Phase共通</strong><small>Phase別メニューとは独立したトレーニング</small></div><button class="global-mode-button is-assessment" type="button" data-assessment="true"><span>★</span><span><small>RATE ${overallRating} · LEVEL ${levelFromRating(overallRating)}</small><strong>総合レベル判定</strong></span><i>→</i></button><button class="global-mode-button is-weakness" type="button" data-weakness="true" ${mistakeCount ? "" : "disabled"}><span>↻</span><span><small>${mistakeCount ? `${mistakeCount}問を保存中` : "誤答後に利用できます"}</small><strong>苦手分野攻略</strong></span><i>→</i></button></section>`;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function phase12AudioPath(pair, key, kind = "word") {
  const phase = categories.find((category) => category.id === pair.categoryId)?.phase;
  return `audio/phase${phase}/${pair.categoryId}-${String(pair.number).padStart(2, "0")}-${key}-${kind}.wav`;
}

function sentenceForPair(pair, key) {
  const override = phase12SentenceOverrides.get(`${pair.categoryId}-${String(pair.number).padStart(2, "0")}-${key}`);
  if (override) return override;
  const categoryNumber = Number(pair.categoryId.slice(1));
  return sentenceFrames[(categoryNumber + pair.number) % sentenceFrames.length](pair[key].word);
}

function decorateQuestion(pair, promptType = "word") {
  const target = Math.random() < 0.5 ? "a" : "b";
  const spokenText = promptType === "sentence" ? sentenceForPair(pair, target) : pair[target].word;
  return {
    ...pair,
    target,
    choices: Math.random() < 0.5 ? ["a", "b"] : ["b", "a"],
    promptType,
    spokenText,
    audioFile: phase12AudioPath(pair, target, promptType),
    wordAudioFiles: { a: phase12AudioPath(pair, "a"), b: phase12AudioPath(pair, "b") },
  };
}

function makeRandomQuestions(phase) {
  return shuffle(categories.filter((category) => category.phase === phase))
    .slice(0, sessionSize)
    .map((category, index) => {
      const categoryPairs = pairs.filter((pair) => pair.categoryId === category.id);
      return decorateQuestion(categoryPairs[Math.floor(Math.random() * categoryPairs.length)], index < 2 ? "sentence" : "word");
    });
}

function makeCategoryQuestions(categoryId) {
  return shuffle(pairs.filter((pair) => pair.categoryId === categoryId))
    .slice(0, sessionSize)
    .map((pair) => decorateQuestion(pair));
}

function currentQuestion() {
  return state.questions[state.questionIndex];
}

function currentCategory() {
  const question = currentQuestion();
  return categories.find((category) => category.id === question?.categoryId);
}

function setNav(view) {
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.action === (view === "about" ? "about" : "home"));
  });
}

function clearSampleHighlight() {
  document.querySelectorAll(".sample-word.is-playing").forEach((word) => word.classList.remove("is-playing"));
}

function stopSpeech() {
  clearTimeout(speechTimer);
  activeUtterance = null;
  if (phase3Audio) {
    phase3Audio.pause();
    phase3Audio.currentTime = 0;
    phase3Audio = null;
  }
  clearTimeout(phase3ClipTimer);
  phase3ClipTimer = null;
  window.speechSynthesis?.cancel();
  document.querySelectorAll(".is-speaking").forEach((element) => element.classList.remove("is-speaking"));
  clearSampleHighlight();
}

function stopRatingTimer() {
  clearInterval(ratingTimer);
  clearTimeout(ratingFallbackTimer);
  ratingTimer = null;
  ratingFallbackTimer = null;
}

function render() {
  stopSpeech();
  stopRatingTimer();
  document.body.dataset.view = state.view;
  setNav(state.view);
  if (state.view === "home") renderHome();
  if (state.view === "about") renderAbout();
  if (state.view === "training") renderTraining();
  if (state.view === "phase3Training") renderPhase3Training();
  if (state.view === "assessmentTraining") renderAssessmentTraining();
  if (state.view === "assessmentResult") renderAssessmentResult();
  if (state.view === "finalQuiz") renderFinalQuiz();
  if (state.view === "result") renderResult();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderHome() {
  const progress = loadProgress();
  if (state.homeMode === "training" && !state.trainingMenuOpen) return renderModeHome(progress);
  if (state.homeMode !== "training") return renderModeHome(progress);
  if (state.phase === 3) return renderPhase3Home(progress);
  const phaseCategories = categories.filter((category) => category.phase === state.phase);

  app.innerHTML = `
    <section class="dashboard-shell training-dashboard-shell" aria-label="音声トレーニング">
      ${primaryModesMarkup(progress)}
      ${trainingContextMarkup()}
      ${phaseCourseSelectorMarkup(state.phase)}
      <div class="category-section-title"><span>カテゴリー</span>${focusItemsMarkup(progress, phaseCategories)}</div>
      <div class="category-grid">
        ${phaseCategories.map((category) => categoryCard(category, progress.categories[category.id])).join("")}
      </div>
    </section>`;
}

function renderModeHome(progress) {
  const isTraining = state.homeMode === "training";
  const isAssessment = state.homeMode === "assessment";
  const rating = Number(progress.overallRating) || 1000;
  const phaseRating = Number(progress.phaseRatings?.[state.phase]) || 1000;
  const mistakes = progress.mistakes || [];
  const attempted = Number(progress.totalQuestions) || 0;
  const accuracy = attempted ? Math.round(((Number(progress.totalCorrect) || 0) / attempted) * 100) : 0;
  const mistakeCategories = [...new Set(mistakes.map((item) => item.categoryId))].map((id) => categoryById(id)).filter(Boolean).slice(0, 5);
  const title = isTraining ? "音声トレーニング" : isAssessment ? "総合レベルテスト" : "苦手リトライ";
  const eyebrow = isTraining ? "LISTENING TRAINING" : isAssessment ? "ALL PHASES ASSESSMENT" : "WEAK POINT REVIEW";
  const description = isTraining ? "Phaseを選び、ランダム5題またはカテゴリー別の個別練習に進みます。" : isAssessment ? "Phase 1〜3から5題を出題。正答率と回答速度から総合レベルを判定します。" : "保存された誤答から最大5題を再出題。苦手な音を集中して聞き直します。";
  app.innerHTML = `
    <section class="dashboard-shell mode-home-shell" aria-labelledby="mode-home-title">
      ${primaryModesMarkup(progress)}
      <div class="mode-preview-panel ${isTraining ? "is-training" : isAssessment ? "is-assessment" : "is-weakness"}">
        <div class="mode-preview-heading"><p class="eyebrow">${eyebrow}</p><h1 id="mode-home-title">${title}</h1><p>${description}</p></div>
        <div class="mode-progress-card">
          <span>学習進捗</span>
          ${isTraining ? levelProgressMarkup(phaseRating, phaseRating) : isAssessment ? levelProgressMarkup(rating, rating) : `<div class="weakness-count"><strong>${mistakes.length}</strong><small>問を復習リストに保存</small></div>`}
        </div>
        <div class="mode-stat-grid">
          ${isTraining ? `<div><small>COURSES</small><strong>3 Phase</strong></div><div><small>CATEGORIES</small><strong>${categories.length + phase3Categories.length}</strong></div><div><small>CURRENT</small><strong>Phase ${state.phase}</strong></div>` : isAssessment ? `<div><small>OVERALL RATE</small><strong>${rating}</strong></div><div><small>ANSWERED</small><strong>${attempted}</strong></div><div><small>ACCURACY</small><strong>${accuracy}%</strong></div>` : `<div><small>SAVED</small><strong>${mistakes.length}問</strong></div><div class="mode-focus-list"><small>重点カテゴリー</small><strong>${mistakeCategories.length ? mistakeCategories.map((category) => category.name).join(" · ") : "誤答後に表示"}</strong></div>`}
        </div>
        <button class="mode-start-button" type="button" ${isTraining ? `data-open-training="true"` : isAssessment ? `data-assessment="true"` : `data-weakness="true" ${mistakes.length ? "" : "disabled"}`}><span>${isTraining ? "▶" : isAssessment ? "★" : "↻"}</span><small>${isTraining ? "3 PHASES · CATEGORY TRAINING" : isAssessment ? "5 QUESTIONS · ALL PHASES" : `${mistakes.length} QUESTIONS · REVIEW`}</small><strong>${title}を始める</strong><i>→</i></button>
      </div>
    </section>`;
}

function renderPhase3Home(progress = loadProgress()) {
  app.innerHTML = `
    <section class="dashboard-shell phase3-shell training-dashboard-shell" aria-label="音声トレーニング Phase 3">
      ${primaryModesMarkup(progress)}
      ${trainingContextMarkup()}
      ${phaseCourseSelectorMarkup(3)}
      <div class="category-section-title"><span>カテゴリー</span>${focusItemsMarkup(progress, phase3Categories)}</div>
      <div class="phase3-grid">
        ${phase3Categories.map((category, index) => {
          const sample = phase3Questions.find((question) => question.categoryId === category.id);
          const mastery = Number(progress.categories[category.id]?.mastery) || 0;
          return `<article class="phase3-card" data-category-card="${category.id}"><button class="category-summary" type="button" data-category-toggle="${category.id}" aria-expanded="false"><span><b>${String(index + 1).padStart(2, "0")}</b><small>${phase3ShortNames[category.id] || category.name}</small></span><strong>${mastery}%</strong><i aria-hidden="true">＋</i></button><div class="category-details"><div class="phase3-category-copy"><h2>${category.name}</h2><p>${category.point}</p></div><button class="category-start-button" type="button" data-phase3-category="${category.id}" aria-label="${category.name}を個別に5問練習">個別練習 <span aria-hidden="true">→</span></button><button class="phase3-sample-button" type="button" data-phase3-sample="${category.id}" aria-label="${category.name}の例文を再生"><span>▶</span><em>サンプルを聞く</em><strong>${sample?.targetChunk || "Sample"}</strong><small>${sample?.sentence || ""}</small></button></div><span class="progress-line" aria-hidden="true"><span style="width:${mastery}%"></span></span></article>`;
        }).join("")}
      </div>
    </section>`;
}

function categoryCard(category, progress) {
  const mastery = progress?.mastery || 0;
  const [leftWord, rightWord] = category.example.split(" / ");
  return `
    <article class="category-card" data-category-card="${category.id}">
      <button class="category-summary" type="button" data-category-toggle="${category.id}" aria-expanded="false">
        <span><b>${category.id}</b><small>${category.contrast}</small></span><strong>${mastery}%</strong><i aria-hidden="true">＋</i>
      </button>
      <div class="category-details">
        <div class="category-copy"><span class="card-name">${category.name}</span><span class="contrast">${category.contrast}</span></div>
        <button class="category-start-button" type="button" data-category="${category.id}" aria-label="${category.name}を個別に5問練習">個別練習 <span aria-hidden="true">→</span></button>
        <button class="sample-button" type="button" data-sample="${category.id}" aria-label="${category.example}のサンプルを再生">
          <span class="sample-icon" aria-hidden="true">▶</span>
          <span><small>サンプルを聞く</small><strong><span class="sample-word" data-sample-index="0">${leftWord}</span><em>/</em><span class="sample-word" data-sample-index="1">${rightWord}</span></strong></span>
        </button>
      </div>
      <span class="progress-line" aria-hidden="true"><span style="width:${mastery}%"></span></span>
    </article>`;
}

function renderTraining() {
  const category = currentCategory();
  const question = currentQuestion();
  if (!category || !question) return goHome();
  const answered = state.selected !== null;
  const correctKey = question.target;
  const selectedIsCorrect = state.selected === correctKey;
  const target = question[correctKey];
  const modeLabel = state.mode === "random" ? "" : "カテゴリー別";

  app.innerHTML = `
    <section class="training-shell ${answered ? (selectedIsCorrect ? "answer-correct" : "answer-wrong") : ""}">
      <div class="training-top">
        <button class="back-button" type="button" data-action="home">← 一覧</button>
        <div class="training-progress-copy">${modeLabel ? `<strong>${modeLabel}</strong>` : ""}<span>${category.name}</span><span>QUESTION ${state.questionIndex + 1} / ${state.questions.length}</span></div>
      </div>
      <div class="question-progress" aria-label="進捗 ${state.questionIndex + 1}/${state.questions.length}"><span style="width:${((state.questionIndex + (answered ? 1 : 0)) / state.questions.length) * 100}%"></span></div>
      <div class="speed-meter ${answered ? "is-stopped" : ""}">
        <span><small>SPEED RATE</small><strong id="speed-rate">${answered ? `${state.lastFeedback.ratingDelta >= 0 ? "+" : ""}${state.lastFeedback.ratingDelta}` : "+20"}</strong></span>
        <i><b id="speed-fill" style="width:${answered ? "0" : "100"}%"></b></i>
      </div>
      <div class="training-card">
        <div class="audio-panel">
          <p class="training-meta">${question.promptType === "sentence" ? "SENTENCE" : "WORD"}<small>${category.name} · ${category.contrast}</small></p>
          <button class="listen-button" type="button" data-speak="normal" aria-label="問題の単語を再生">${speakerSvg}<span>再生</span></button>
          <div class="audio-actions">
            <button type="button" data-speak="normal"><span aria-hidden="true">↻</span> もう一度</button>
            <button type="button" data-speak="slow"><span aria-hidden="true">◴</span> 低速</button>
          </div>
        </div>
        <div class="challenge-panel">
          <div class="answer-grid">
            ${question.choices.map((key) => {
              const status = answered ? (key === correctKey ? "is-correct" : key === state.selected ? "is-wrong" : "") : "";
              const choice = question[key];
              return `
                <button class="answer-button ${status}" type="button" data-answer="${key}" ${answered ? "disabled" : ""} aria-label="${choice.word} ${choice.ipa} ${choice.meaning}">
                  <strong>${choice.word}</strong>
                  <span class="answer-ipa" lang="en">${choice.ipa}</span>
                  <span class="answer-meaning">${choice.meaning}</span>
                  ${answered && key === correctKey ? `<span class="answer-status" aria-hidden="true">✓</span>` : ""}
                  ${answered && key === state.selected && key !== correctKey ? `<span class="answer-status" aria-hidden="true">×</span>` : ""}
                </button>`;
            }).join("")}
          </div>
          <div class="feedback ${answered ? "" : "is-idle"}" aria-live="polite">
            ${answered ? `
              <span class="feedback-mark ${selectedIsCorrect ? "is-correct" : "is-wrong"}" aria-hidden="true">${selectedIsCorrect ? "✓" : "×"}</span>
              <span><strong>${selectedIsCorrect ? "Nice!" : `正解は “${target.word}”`}</strong><small>${state.lastFeedback.seconds.toFixed(1)}秒 · ${state.mode === "random" ? "RATE" : "MASTERY"} <b class="${state.lastFeedback.feedbackDelta >= 0 ? "rate-up" : "rate-down"}">${state.lastFeedback.feedbackDelta >= 0 ? "+" : ""}${state.lastFeedback.feedbackDelta}</b>${question.promptType === "sentence" ? `<em>${question.spokenText}</em>` : ""}</small></span>` : `<span>Listen & choose</span>`}
          </div>
          ${answered ? `<button class="next-button" type="button" data-action="next">${state.questionIndex === state.questions.length - 1 ? "結果を見る" : "次へ"} <span aria-hidden="true">→</span></button>` : ""}
        </div>
        ${answered && selectedIsCorrect ? `<div class="success-sparkles" aria-hidden="true">${Array.from({ length: 12 }, (_, index) => `<i style="--i:${index}"></i>`).join("")}</div>` : ""}
      </div>
    </section>`;
}

function soundParts(soundChange) {
  const [natural = soundChange, explanation = ""] = soundChange.split("：");
  const ipa = [...soundChange.matchAll(/\/[^/]+\//g)].map((match) => match[0]);
  return { natural, explanation, ipa };
}

const phase3WordDistractors = {
  it: ["lit", "at"], up: ["cup", "us"], off: ["of", "on"], out: ["at", "up"],
  in: ["inn", "on"], on: ["one", "in"], over: ["ever", "of"], again: ["against", "a"],
  aloud: ["allowed", "around"], send: ["sent", "said"], leave: ["live", "leaf"], check: ["cheque", "chick"],
  hold: ["old", "whole"], come: ["gum", "calm"], go: ["got", "gone"], do: ["due", "you"],
  i: ["eye", "a"], agree: ["a green", "degree"], see: ["she", "sea"], she: ["sea", "he"],
  always: ["all ways", "away"], who: ["whose", "you"], is: ["his", "this"], they: ["day", "the"],
  are: ["our", "or"], try: ["dry", "tie"], we: ["wee", "way"], asked: ["axed", "ask"],
  big: ["pig", "bit"], game: ["gain", "came"], good: ["could", "wood"], days: ["daze", "day"],
  take: ["tape", "cake"], care: ["hair", "car"], keep: ["kept", "key"], practicing: ["practice", "processing"],
  red: ["read", "led"], door: ["tour", "more"], stop: ["top", "shop"], playing: ["praying", "plain"],
  black: ["blank", "back"], cat: ["cap", "cut"], bus: ["buzz", "boss"], felt: ["fell", "belt"],
  tired: ["tide", "tire"], top: ["stop", "tap"], player: ["prayer", "place"],
  him: ["hymn", "them"], her: ["hair", "him"], his: ["is", "he"], them: ["then", "him"],
  to: ["a", "two", "too"], for: ["four", "from"], of: ["off", "at"], at: ["add", "it"], from: ["form", "for"], and: ["end", "an"],
  got: ["god", "get"], put: ["foot", "but"], what: ["watt", "that"], lot: ["rot", "light"],
  wrote: ["road", "write"], get: ["gate", "got"], better: ["bitter", "butter"], waited: ["weighted", "wanted"],
  city: ["silly", "pretty"], last: ["least", "lost"], night: ["light", "right"], next: ["neck", "nest"],
  day: ["they", "date"], held: ["help", "hold"], my: ["mine", "me"], left: ["let", "lift"],
  must: ["missed", "most"], not: ["knot", "now"], know: ["no", "now"], best: ["vest", "test"],
  movie: ["moving", "moody"], found: ["find", "frowned"], the: ["they", "a"], first: ["fast", "fist"], prize: ["price", "pride"],
  did: ["dig", "do"], would: ["wood", "could"], could: ["good", "would"], you: ["ewe", "your"],
  "don't": ["done", "do"], miss: ["mist", "mess"], bless: ["less", "best"], as: ["has", "is"],
  this: ["thus", "these"], year: ["ear", "your"], ten: ["then", "tin"], boys: ["voice", "buoys"],
  green: ["grin", "grain"], paper: ["pepper", "piper"], going: ["gone", "getting"], want: ["won't", "went"],
  have: ["of", "has"], let: ["lit", "late"], me: ["my", "be"], give: ["gave", "get"], should: ["could", "would"], kind: ["caned", "find"],
};

const phase3FallbackDistractors = {
  P301: ["lit", "at", "on", "in"], P302: ["at", "we", "you", "are"],
  P303: ["the", "a", "day", "take"], P304: ["is", "off", "two", "four"],
  P305: ["the", "a", "to", "and"], P306: ["get", "at", "the", "in"],
  P307: ["the", "a", "there", "now"], P308: ["do", "your", "could", "we"],
  P309: ["got", "of", "to", "you"],
};

function phase3AnswerTokens(question) {
  const words = (question.categoryId === "P305" ? question.targetChunk.split("/") : question.targetChunk.split(/\s+/))
    .map((word) => word.trim()).filter(Boolean);
  if (question.categoryId !== "P305" && words.length > 2) return words.slice(1);
  return words;
}

function normalizeStressSentence(sentence) {
  const normalized = sentence.toLowerCase().replace(/\bi\b/g, "I");
  return normalized.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function phase3SequenceExercise(question) {
  const answerTokens = phase3AnswerTokens(question);
  const clozeTarget = question.categoryId === "P305" ? question.targetChunk : answerTokens.join(" ");
  if (question.categoryId === "P305") {
    const displaySentence = normalizeStressSentence(question.sentence);
    const sentenceWords = [...displaySentence.matchAll(/[A-Za-z']+/g)].map((match) => match[0]);
    const choiceTokens = sentenceWords.map((word, index) => ({ id: `${index}-${word}`, word }));
    return { ...question, answerTokens, choiceTokens, clozeTarget, displaySentence, stressSelection: true };
  }
  const normalizedAnswers = new Set(answerTokens.map((word) => word.toLowerCase()));
  const distractors = [];
  const addDistractor = (word) => {
    if (!word || normalizedAnswers.has(word.toLowerCase()) || distractors.some((item) => item.toLowerCase() === word.toLowerCase())) return;
    distractors.push(word);
  };
  answerTokens.forEach((word) => addDistractor((phase3WordDistractors[word.toLowerCase()] || [])[0]));
  answerTokens.forEach((word) => (phase3WordDistractors[word.toLowerCase()] || []).slice(1).forEach(addDistractor));
  (phase3FallbackDistractors[question.categoryId] || []).forEach(addDistractor);
  const distractorCount = answerTokens.length === 1 ? 3 : 2;
  const choiceTokens = shuffle([...answerTokens, ...distractors.slice(0, distractorCount)]).map((word, index) => ({ id: `${index}-${word}`, word }));
  return { ...question, answerTokens, choiceTokens, clozeTarget };
}

function phase3SelectionCorrect(question, selectedWords) {
  const selected = selectedWords.map((word) => word.toLowerCase());
  const expected = question.answerTokens.map((word) => word.toLowerCase());
  if (question.categoryId === "P305") return selected.slice().sort().join("|") === expected.slice().sort().join("|");
  return selected.every((word, index) => word === expected[index]);
}

function makePhase3Questions() {
  return shuffle(phase3Categories).slice(0, sessionSize).map((category) => {
    const pool = phase3Questions.filter((question) => question.categoryId === category.id);
    return phase3SequenceExercise(pool[Math.floor(Math.random() * pool.length)]);
  });
}

function makePhase3CategoryQuestions(categoryId) {
  return shuffle(phase3Questions.filter((question) => question.categoryId === categoryId))
    .slice(0, sessionSize)
    .map(phase3SequenceExercise);
}

function makeAssessmentQuestions() {
  const phasePlan = shuffle([1, 2, 3, ...shuffle([1, 2, 3]).slice(0, 2)]);
  const usedCategories = new Set();
  return phasePlan.map((phase, index) => {
    if (phase === 3) {
      const available = shuffle(phase3Categories).filter((category) => !usedCategories.has(category.id));
      const category = available[0] || shuffle(phase3Categories)[0];
      usedCategories.add(category.id);
      const pool = phase3Questions.filter((question) => question.categoryId === category.id);
      return { ...phase3SequenceExercise(pool[Math.floor(Math.random() * pool.length)]), assessmentPhase: 3, assessmentType: "phase3" };
    }
    const available = shuffle(categories.filter((category) => category.phase === phase && !usedCategories.has(category.id)));
    const category = available[0] || shuffle(categories.filter((item) => item.phase === phase))[0];
    usedCategories.add(category.id);
    const pool = pairs.filter((pair) => pair.categoryId === category.id);
    return { ...decorateQuestion(pool[Math.floor(Math.random() * pool.length)], index % 2 === 0 ? "sentence" : "word"), assessmentPhase: phase, assessmentType: "phase12" };
  });
}

function makeWeaknessQuestions() {
  const mistakes = [...(loadProgress().mistakes || [])].reverse().slice(0, sessionSize);
  return mistakes.map((mistake) => {
    if (mistake.questionId) {
      const original = phase3Questions.find((question) => question.id === mistake.questionId);
      return original ? { ...phase3SequenceExercise(original), assessmentPhase: 3, assessmentType: "phase3" } : null;
    }
    const pair = pairs.find((item) => item.categoryId === mistake.categoryId && item.number === mistake.pairNumber);
    if (!pair) return null;
    const question = decorateQuestion(pair, mistake.promptType || "word");
    question.target = pair.a.word === mistake.correctWord ? "a" : "b";
    question.spokenText = question.promptType === "sentence" ? sentenceForPair(pair, question.target) : pair[question.target].word;
    question.audioFile = phase12AudioPath(pair, question.target, question.promptType);
    return { ...question, assessmentPhase: categoryById(pair.categoryId)?.phase || 1, assessmentType: "phase12" };
  }).filter(Boolean);
}

function beginBatchSession(mode, questions) {
  if (!questions.length) {
    showToast("復習できる誤答はまだありません");
    return;
  }
  state.mode = mode;
  state.category = null;
  state.questions = questions;
  state.questionIndex = 0;
  state.selected = null;
  state.phase3TokenAnswer = [];
  state.batchResponses = questions.map(() => ({ selectedKey: null, tokenIds: [], startedAt: 0, seconds: null }));
  state.answers = [];
  state.lastFeedback = null;
  state.lastRewards = null;
  state.view = "assessmentTraining";
  render();
}

function beginAssessment() {
  beginBatchSession("assessment", makeAssessmentQuestions());
}

function beginWeaknessSession() {
  beginBatchSession("weakness", makeWeaknessQuestions());
}

function batchClozeSentence(question, response) {
  const chosen = response.tokenIds.map((id) => question.choiceTokens.find((choice) => choice.id === id)?.word || "");
  const slot = (index) => `<span class="batch-cloze-slot ${chosen[index] ? "is-filled" : ""}">${chosen[index] || "＿"}</span>`;
  if (question.categoryId === "P305") {
    return `${question.displaySentence || normalizeStressSentence(question.sentence)} <span class="batch-stress-count"><b>${question.answerTokens.length}語</b>選択</span>`;
  }
  const escaped = question.clozeTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return question.sentence.replace(new RegExp(escaped, "i"), question.answerTokens.map((_, index) => slot(index)).join(" "));
}

function renderAssessmentTraining() {
  const answeredCount = state.batchResponses.filter((response, index) => state.questions[index].assessmentType === "phase3" ? response.tokenIds.length === state.questions[index].answerTokens.length : Boolean(response.selectedKey)).length;
  const title = state.mode === "weakness" ? "苦手分野攻略" : "総合レベル判定";
  app.innerHTML = `<section class="batch-assessment-shell"><div class="batch-heading"><button class="back-button" type="button" data-action="home">← 一覧</button><div><p class="eyebrow">${state.mode === "weakness" ? "Review mistakes" : "All phases assessment"}</p><h1>${title}</h1><small>${state.mode === "weakness" ? "保存された誤答をもう一度聞き取る" : "5問をすべて回答してから一括判定"}</small></div><strong>${answeredCount} / ${state.questions.length}</strong></div><div class="batch-question-list">${state.questions.map((question, index) => { const response = state.batchResponses[index]; const category = categoryById(question.categoryId); const isPhase3 = question.assessmentType === "phase3"; const answered = isPhase3 ? response.tokenIds.length === question.answerTokens.length : Boolean(response.selectedKey); return `<article class="batch-question-row ${answered ? "is-answered" : ""}"><div class="batch-question-meta"><b>Q${index + 1}</b><span>Phase&nbsp;${question.assessmentPhase}</span><small>${category.name}</small><button type="button" data-batch-play="${index}" aria-label="問題${index + 1}を再生">${speakerSvg}</button></div><div class="batch-question-body">${isPhase3 ? `<p lang="en">${batchClozeSentence(question, response)}</p><div class="batch-token-bank">${question.choiceTokens.map((choice) => { const used = response.tokenIds.includes(choice.id); return `<button type="button" data-batch-token="${index}" data-token-id="${choice.id}" class="${used ? "is-used" : ""}" ${used || response.tokenIds.length >= question.answerTokens.length ? "disabled" : ""}>${choice.word}</button>`; }).join("")}${response.tokenIds.length ? `<button class="batch-undo" type="button" data-batch-undo="${index}">↶</button>` : ""}</div>` : `<div class="batch-pair">${question.choices.map((key) => `<button type="button" data-batch-answer="${index}" data-answer-key="${key}" class="${response.selectedKey === key ? "is-selected" : ""}"><strong>${question[key].word}</strong><small>${question[key].ipa}</small></button>`).join("")}</div>`}</div><div class="batch-answer-state">${answered ? `<strong>回答済み</strong><small>${(response.seconds || 7).toFixed(1)}秒</small>` : `<span>未回答</span>`}</div></article>`; }).join("")}</div><div class="batch-footer"><span>正解・不正解は回答後にまとめて表示します</span><button class="primary-button" type="button" data-action="submit-batch" ${answeredCount === state.questions.length ? "" : "disabled"}>${state.mode === "weakness" ? "復習結果を見る" : "5問を判定する"} →</button></div></section>`;
}

function playBatchQuestion(index, rate = 1) {
  const question = state.questions[index];
  const response = state.batchResponses[index];
  const button = document.querySelector(`[data-batch-play="${index}"]`);
  response.startedAt = 0;
  const startResponseClock = () => { response.startedAt = performance.now(); };
  if (question.assessmentType === "phase3") playPhase3Clip(question, { button, rate, onEnd: startResponseClock });
  else playRecordedAudio(question.audioFile, { button, rate, onEnd: startResponseClock });
}

function batchSeconds(response) {
  return response.seconds || (response.startedAt ? Math.max(.1, (performance.now() - response.startedAt) / 1000) : 7);
}

function selectBatchAnswer(index, key) {
  const response = state.batchResponses[index];
  response.selectedKey = key;
  response.seconds ||= batchSeconds(response);
  renderAssessmentTraining();
}

function selectBatchToken(index, tokenId) {
  const question = state.questions[index];
  const response = state.batchResponses[index];
  if (response.tokenIds.includes(tokenId) || response.tokenIds.length >= question.answerTokens.length) return;
  response.tokenIds.push(tokenId);
  if (response.tokenIds.length === question.answerTokens.length) response.seconds ||= batchSeconds(response);
  renderAssessmentTraining();
}

function undoBatchToken(index) {
  const response = state.batchResponses[index];
  response.tokenIds.pop();
  response.seconds = null;
  renderAssessmentTraining();
}

function submitBatch() {
  const complete = state.questions.every((question, index) => question.assessmentType === "phase3" ? state.batchResponses[index].tokenIds.length === question.answerTokens.length : Boolean(state.batchResponses[index].selectedKey));
  if (!complete) return;
  state.answers = state.questions.map((question, index) => {
    const response = state.batchResponses[index];
    const seconds = response.seconds || 7;
    if (question.assessmentType === "phase3") {
      const words = response.tokenIds.map((id) => question.choiceTokens.find((choice) => choice.id === id)?.word || "");
      const correct = phase3SelectionCorrect(question, words);
      return { phase: 3, categoryId: question.categoryId, questionId: question.id, correct, correctWord: question.answerTokens.join(" "), selectedWord: words.join(" "), ipa: question.soundChange, seconds, ratingDelta: ratingDelta(correct, seconds) };
    }
    const key = response.selectedKey;
    const correct = key === question.target;
    return { phase: question.assessmentPhase, categoryId: question.categoryId, pairNumber: question.number, promptType: question.promptType, correct, correctWord: question[question.target].word, selectedWord: question[key].word, ipa: question[question.target].ipa, seconds, ratingDelta: ratingDelta(correct, seconds) };
  });
  state.lastRewards = saveAssessmentSession();
  state.view = "assessmentResult";
  render();
}

function renderAssessmentResult() {
  const correct = state.answers.filter((answer) => answer.correct).length;
  const score = Math.round((correct / state.answers.length) * 100);
  const rewards = state.lastRewards;
  const isWeakness = state.mode === "weakness";
  const levelDirection = rewards.level > rewards.beforeLevel ? "LEVEL UP" : rewards.level < rewards.beforeLevel ? "LEVEL DOWN" : `LEVEL ${rewards.level}`;
  app.innerHTML = `
    <section class="result-shell">
      <div class="result-card assessment-result-card">
        <div class="result-heading">
          <div><p class="eyebrow">${isWeakness ? "Review complete" : "Assessment complete"}</p><h1>${isWeakness ? "復習完了" : `総合 LEVEL ${rewards.level}`}</h1><p>${isWeakness ? "苦手問題を再トレーニング" : `${correct} / ${state.answers.length} correct`}</p></div>
          <div class="result-score" style="--score:${score}%"><span>${score}%</span></div>
        </div>
        ${isWeakness ? "" : levelProgressMarkup(rewards.afterRating, rewards.beforeRating)}
        <div class="reward-grid compact-rewards">
          <div class="reward-card"><span>${isWeakness ? "REVIEW" : "RATE"}</span><strong>${isWeakness ? `${correct} / ${state.answers.length}` : `${rewards.beforeRating} → ${rewards.afterRating}`}</strong><small class="${rewards.ratingDelta >= 0 ? "rate-up" : "rate-down"}">${isWeakness ? "正解した問題は苦手リストから解除" : `${rewards.ratingDelta >= 0 ? "+" : ""}${rewards.ratingDelta}`}</small></div>
          <div class="reward-card"><span>LEVEL</span><strong>${rewards.level}</strong><small>${isWeakness ? "総合レートは変動なし" : levelDirection}</small></div>
          <div class="reward-card"><span>AVG.</span><strong>${rewards.averageSeconds.toFixed(1)}s</strong><small>回答速度</small></div>
        </div>
        <div class="assessment-breakdown">${state.answers.map((answer, index) => `<div class="assessment-answer-row ${answer.correct ? "is-correct" : "is-wrong"}"><span>${answer.correct ? "✓" : "×"}</span><small>Q${index + 1} · Phase ${answer.phase}<b>${categoryById(answer.categoryId)?.name || answer.categoryId}</b></small><strong>${answer.selectedWord}</strong><i>正解 ${answer.correctWord}</i><em>${answer.seconds.toFixed(1)}秒${isWeakness ? "" : ` · ${answer.ratingDelta >= 0 ? "+" : ""}${answer.ratingDelta}`}</em></div>`).join("")}</div>
        <div class="result-actions"><button class="primary-button" type="button" data-action="${isWeakness ? "retry-weakness" : "retry-assessment"}">${isWeakness ? "残りを復習" : "もう一度判定"}</button><button class="secondary-button" type="button" data-action="home">一覧へ</button></div>
      </div>
    </section>`;
}

function phase3ClozeSentence(question) {
  if (state.selected !== null) {
    if (question.categoryId === "P305") {
      const strongWords = new Set(question.answerTokens.map((word) => word.toLowerCase()));
      return (question.displaySentence || normalizeStressSentence(question.sentence)).split(/(\s+)/).map((part) => {
        const clean = part.replace(/[?.!,]/g, "").toLowerCase();
        return strongWords.has(clean) ? `<span class="cloze-stress-word">${part}</span>` : part;
      }).join("");
    }
    const escapedTarget = question.targetChunk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return question.sentence.replace(new RegExp(escapedTarget, "i"), `<span class="phase3-answer-annotated">${phase3AnnotatedPhrase(question)}</span>`);
  }
  const chosen = state.phase3TokenAnswer.map((id) => question.choiceTokens.find((choice) => choice.id === id)?.word || "");
  const slot = (index) => `<span class="phase3-cloze-slot ${chosen[index] ? "is-filled" : ""}">${chosen[index] || "＿＿"}</span>`;
  if (question.categoryId === "P305") {
    return question.displaySentence || normalizeStressSentence(question.sentence);
  }
  const escaped = question.clozeTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return question.sentence.replace(new RegExp(escaped, "i"), `<span class="phase3-cloze-group">${question.answerTokens.map((_, index) => slot(index)).join("")}</span>`);
}

function phase3AnnotatedToken(question, token, index) {
  if (question.categoryId === "P306" && index === 0) {
    return token.replace(/[td]+/i, (letters) => `<span class="flap-letter">${letters}</span>`);
  }
  if (question.categoryId === "P304" && /^h/i.test(token)) {
    return token.replace(/^h/i, (letter) => `<span class="weak-h">${letter}<i>△</i></span>`);
  }
  if (question.categoryId === "P307" && index === 0) {
    return token.replace(/[td](?=[^td]*$)/i, (letter) => `<span class="drop-letter">${letter}</span>`);
  }
  return token;
}

function phase3AnnotatedPhrase(question) {
  const tokens = question.targetChunk.split(/\s+/).filter(Boolean);
  const linked = ["P301", "P302", "P303", "P308"].includes(question.categoryId);
  const letterDetail = ["P304", "P306"].includes(question.categoryId);
  return tokens.map((token, index) => `<span class="annotated-word ${letterDetail ? "is-letter-detail" : ""}">${phase3AnnotatedToken(question, token, index)}</span>${linked && index < tokens.length - 1 ? `<i class="answer-bridge" aria-hidden="true"></i>` : ""}`).join("");
}

const phase3InsightCopy = {
  P301: ["子音→母音がひと続き", "前の語末子音を、次の母音へ滑らせて聞きます。"],
  P302: ["母音の間に渡り音", "/w/・/j/ の短い音が橋になり、語の境目が薄くなります。"],
  P303: ["隣接する子音が一つの塊", "同じ・近い子音を二度破裂させず、まとめて発音します。"],
  P304: ["弱形は短く・曖昧に", "機能語の母音がシュワーへ近づき、子音も弱くなることがあります。"],
  P305: ["内容語がリズムの拍", "強い語の間へ、機能語が短く収まります。"],
  P306: ["T・Dがフラップへ変化", "母音にはさまれた T・D が、短いラ行のように聞こえます。"],
  P307: ["子音群の一部が脱落", "消えやすい /t/・/d/ を、前後の語と文脈から復元します。"],
  P308: ["二つの音が同化・融合", "語境界の音が近づき、新しい一つの音として聞こえます。"],
  P309: ["頻出語句が一つの音へ", "単語ごとではなく、会話で使われる短い音の塊として覚えます。"],
};

function phase3InsightPhrase(question) {
  if (question.categoryId === "P305") {
    const strongWords = new Set(question.answerTokens.map((word) => word.toLowerCase()));
    return (question.displaySentence || normalizeStressSentence(question.sentence)).split(/(\s+)/).map((part) => {
      const clean = part.replace(/[?.!,]/g, "").toLowerCase();
      return strongWords.has(clean) ? `<span class="insight-stress">${part}<i></i></span>` : `<span>${part}</span>`;
    }).join("");
  }
  const tokens = question.targetChunk.split(/\s+/).filter(Boolean);
  const linked = ["P301", "P302", "P303", "P308"].includes(question.categoryId);
  const letterDetail = ["P304", "P306"].includes(question.categoryId);
  return tokens.map((token, index) => `<span class="insight-word ${letterDetail ? "is-letter-detail" : ""}">${phase3AnnotatedToken(question, token, index)}</span>${linked && index < tokens.length - 1 ? `<i class="sound-bridge" aria-hidden="true"></i>` : ""}`).join("");
}

function phase3InsightMarkup(question) {
  const [title, note] = phase3InsightCopy[question.categoryId] || ["音の変化に注目", question.learningPoint];
  return `<div class="sound-insight"><span class="sound-insight-label">LISTENING POINT</span><div class="sound-insight-main"><div class="sound-insight-phrase" lang="en">${phase3InsightPhrase(question)}</div><div><strong>${title}</strong><small>${note}</small><em>${question.soundChange}</em></div></div></div>`;
}

function renderPhase3Training() {
  const question = currentQuestion();
  if (!question) return goHome();
  const category = categoryById(question.categoryId);
  const answered = state.selected !== null;
  const selectedIsCorrect = Boolean(state.lastFeedback?.correct);
  const answerComplete = state.phase3TokenAnswer.length === question.answerTokens.length;
  const feedbackDelta = state.lastFeedback?.feedbackDelta || 0;
  const feedbackLabel = state.mode === "random" ? "RATE" : "MASTERY";

  app.innerHTML = `
    <section class="training-shell phase3-training ${answered ? (selectedIsCorrect ? "answer-correct" : "answer-wrong") : ""}">
      <div class="training-top"><button class="back-button" type="button" data-action="home">← 一覧</button><div class="training-progress-copy"><span>${category.name}</span><span>QUESTION ${state.questionIndex + 1} / ${state.questions.length}</span></div></div>
      <div class="question-progress"><span style="width:${((state.questionIndex + (answered ? 1 : 0)) / state.questions.length) * 100}%"></span></div>
      <div class="speed-meter ${answered ? "is-stopped" : ""}"><span><small>${state.mode === "random" ? "SPEED RATE" : "MASTERY"}</small><strong id="speed-rate">${answered ? `${feedbackDelta >= 0 ? "+" : ""}${feedbackDelta}` : state.mode === "random" ? "+20" : "+4"}</strong></span><i><b id="speed-fill" style="width:${answered ? "0" : "100"}%"></b></i></div>
      <div class="training-card">
        <div class="audio-panel">
          <p class="training-meta">TARGET LISTENING<small>${category.name} · ${question.categoryId === "P305" ? `強く読む語を <b class="stress-count-inline">${question.answerTokens.length}語</b> 選択` : "聞こえた語を順番に選択"}</small></p>
          <button class="listen-button" type="button" data-action="play-phase3-question" aria-label="問題文を再生">${speakerSvg}<span>再生</span></button>
          <div class="audio-actions"><button type="button" data-action="play-phase3-question"><span aria-hidden="true">↻</span> もう一度</button></div>
        </div>
        <div class="challenge-panel">
          <p class="phase3-question-prompt">${answered ? (selectedIsCorrect ? "正解。上の文で音の変化を確認してください" : "正解の語句に直しました。上の文で音の変化を確認してください") : question.categoryId === "P305" ? `音声を聞き、強く読むべき語を <strong class="stress-count-badge">${question.answerTokens.length}語</strong> 選んでください` : "音声を聞き、空欄を左から順に完成させてください"}</p>
          <p class="phase3-target-sentence phase3-cloze-sentence" lang="en">${phase3ClozeSentence(question)}</p>
          <div class="phase3-token-bank" aria-label="語彙の選択肢">
            ${question.choiceTokens.map((choice) => {
              const used = state.phase3TokenAnswer.includes(choice.id);
              return `<button class="phase3-token ${used ? "is-used" : ""}" type="button" data-phase3-token="${choice.id}" ${answered || used ? "disabled" : ""}>${choice.word}</button>`;
            }).join("")}
          </div>
          <div class="phase3-token-actions">${!answered ? `<button type="button" data-action="undo-phase3-token" ${state.phase3TokenAnswer.length ? "" : "disabled"}>1つ戻す</button><button class="phase3-confirm-button" type="button" data-action="confirm-phase3-tokens" ${answerComplete ? "" : "disabled"}>回答する</button>` : ""}</div>
          <div class="feedback phase3-feedback ${answered ? "" : "is-idle"}" aria-live="polite">${answered ? `<div class="phase3-feedback-result"><span class="feedback-mark ${selectedIsCorrect ? "is-correct" : "is-wrong"}">${selectedIsCorrect ? "✓" : "×"}</span><span><strong>${selectedIsCorrect ? "Nice!" : `正解は “${question.answerTokens.join(" ")}”`}</strong><small>${state.lastFeedback.seconds.toFixed(1)}秒 · ${feedbackLabel} <b class="${feedbackDelta >= 0 ? "rate-up" : "rate-down"}">${feedbackDelta >= 0 ? "+" : ""}${feedbackDelta}</b></small></span></div>${phase3InsightMarkup(question)}` : question.categoryId === "P305" ? `<span><strong class="stress-count-badge">${question.answerTokens.length}語</strong> 選んでください</span>` : `<span>${question.answerTokens.length}つの語を選んでください</span>`}</div>
          ${answered ? `<button class="next-button" type="button" data-action="next-phase3">${state.questionIndex === state.questions.length - 1 ? "結果を見る" : "次へ"} <span aria-hidden="true">→</span></button>` : ""}
        </div>
        ${answered && selectedIsCorrect ? `<div class="success-sparkles" aria-hidden="true">${Array.from({ length: 12 }, (_, index) => `<i style="--i:${index}"></i>`).join("")}</div>` : ""}
      </div>
    </section>`;
}

function beginPhase3Session(categoryId = null) {
  state.phase = 3;
  state.mode = categoryId ? "category" : "random";
  state.category = categoryId ? phase3Categories.find((category) => category.id === categoryId) : null;
  state.questions = categoryId ? makePhase3CategoryQuestions(categoryId) : makePhase3Questions();
  state.questionIndex = 0;
  state.selected = null;
  state.phase3TokenAnswer = [];
  state.answers = [];
  state.lastFeedback = null;
  state.lastRewards = null;
  state.view = "phase3Training";
  render();
  startPhase3Question();
}

function playPhase3Clip(question, { button, onStart, onEnd, rate = 1 } = {}) {
  const clip = phase3AudioMap[question.id];
  const source = clip?.file || question.audioFile;
  const hasRange = Number.isFinite(clip?.start) && Number.isFinite(clip?.end);
  stopSpeech();
  const audio = new Audio(source);
  phase3Audio = audio;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(phase3ClipTimer);
    phase3ClipTimer = null;
    audio.pause();
    button?.classList.remove("is-speaking");
    if (phase3Audio === audio) phase3Audio = null;
    onEnd?.();
  };
  const begin = () => {
    if (hasRange) audio.currentTime = clip.start;
    audio.playbackRate = rate;
    audio.play().catch(() => {
      showToast("再生ボタンを押して音声を開始してください");
      finish();
    });
  };
  audio.addEventListener("play", () => {
    button?.classList.add("is-speaking");
    if (hasRange) phase3ClipTimer = setTimeout(finish, ((clip.end - clip.start) / rate + 0.18) * 1000);
    onStart?.();
  }, { once: true });
  audio.addEventListener("timeupdate", () => {
    if (hasRange && audio.currentTime >= clip.end) finish();
  });
  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", () => {
    showToast("音声ファイルを再生できませんでした");
    finish();
  }, { once: true });
  if (audio.readyState >= 1) begin();
  else audio.addEventListener("loadedmetadata", begin, { once: true });
  return true;
}

function playPhase3Current(onEnd, rate = 1) {
  const question = currentQuestion();
  if (!question) return false;
  const button = document.querySelector(".listen-button");
  return playPhase3Clip(question, { button, rate, onStart: () => { state.questionStartedAt = performance.now(); }, onEnd });
}

function startPhase3Question() {
  state.questionStartedAt = performance.now();
  playPhase3Current(startRatingTimer);
  ratingFallbackTimer = setTimeout(() => {
    if (!ratingTimer && state.selected === null) startRatingTimer();
  }, 4500);
}

function selectPhase3Token(tokenId) {
  if (state.selected !== null) return;
  const question = currentQuestion();
  if (!question || state.phase3TokenAnswer.length >= question.answerTokens.length || state.phase3TokenAnswer.includes(tokenId)) return;
  state.phase3TokenAnswer.push(tokenId);
  if (state.view === "assessmentTraining") renderAssessmentTraining();
  else renderPhase3Training();
}

function undoPhase3Token() {
  if (state.selected !== null || !state.phase3TokenAnswer.length) return;
  state.phase3TokenAnswer.pop();
  if (state.view === "assessmentTraining") renderAssessmentTraining();
  else renderPhase3Training();
}

function confirmPhase3Tokens() {
  if (state.selected !== null) return;
  const question = currentQuestion();
  if (!question || state.phase3TokenAnswer.length !== question.answerTokens.length) return;
  const selectedWords = state.phase3TokenAnswer.map((id) => question.choiceTokens.find((choice) => choice.id === id)?.word || "");
  const correct = phase3SelectionCorrect(question, selectedWords);
  const seconds = Math.max(0.1, (performance.now() - state.questionStartedAt) / 1000);
  const delta = ratingDelta(correct, seconds);
  stopSpeech();
  stopRatingTimer();
  state.selected = "tokens";
  state.lastFeedback = { correct, seconds, ratingDelta: delta, feedbackDelta: state.mode === "random" ? delta : (correct ? 4 : -2) };
  state.answers.push({ phase: 3, categoryId: question.categoryId, questionId: question.id, correct, correctWord: question.answerTokens.join(" "), selectedWord: selectedWords.join(" "), ipa: question.soundChange, seconds, ratingDelta: delta });
  renderPhase3Training();
  playFeedbackSound(correct);
}

function nextPhase3Question() {
  if (state.questionIndex >= state.questions.length - 1) {
    state.lastRewards = saveSession();
    state.view = "result";
    render();
    return;
  }
  state.questionIndex += 1;
  state.selected = null;
  state.phase3TokenAnswer = [];
  state.lastFeedback = null;
  renderPhase3Training();
  startPhase3Question();
}

function renderResult() {
  const correct = state.answers.filter((answer) => answer.correct).length;
  const score = Math.round((correct / state.answers.length) * 100);
  const rewards = state.lastRewards;
  const levelDirection = rewards.level > rewards.beforeLevel ? "LEVEL UP" : rewards.level < rewards.beforeLevel ? "LEVEL DOWN" : `LEVEL ${rewards.level}`;
  const message = score === 100 ? "Perfect run." : score >= 80 ? "Great run." : score >= 60 ? "Good progress." : "Keep going.";
  const isRandom = state.mode === "random";

  app.innerHTML = `
    <section class="result-shell">
      <div class="result-card">
        <div class="result-heading">
          <div><p class="eyebrow">${isRandom ? "Random challenge" : "Category practice"} complete</p><h1>${message}</h1><p>${isRandom ? `Phase ${state.phase} · 5カテゴリー` : `${state.category.name} · 個別5問`}</p></div>
          <div class="result-score" style="--score:${score}%" aria-label="正答率 ${score}パーセント"><span>${score}%</span></div>
        </div>
        <div class="reward-grid">
          <div class="reward-card"><span>RATE</span><strong>${rewards.beforeRating}${isRandom ? ` → ${rewards.afterRating}` : ""}</strong><small class="${rewards.ratingDelta >= 0 ? "rate-up" : "rate-down"}">${isRandom ? `${rewards.ratingDelta >= 0 ? "+" : ""}${rewards.ratingDelta}${rewards.finalBonus ? `（天体 +${rewards.finalBonus}）` : ""}` : "ランダムのみ変動"}</small></div>
          <div class="reward-card"><span>LEVEL</span><strong>${rewards.level}</strong><small>${levelDirection}</small></div>
          <div class="reward-card"><span>AVG. SPEED</span><strong>${rewards.averageSeconds.toFixed(1)}s</strong><small>${correct} / 5 correct</small></div>
        </div>
        <div class="category-change-grid" aria-label="カテゴリー習熟度の変化">
          ${rewards.categoryChanges.map((item) => `<span><small>${item.name}</small><strong>${item.mastery}%</strong><b class="${item.delta >= 0 ? "rate-up" : "rate-down"}">${item.delta >= 0 ? "+" : ""}${item.delta}</b></span>`).join("")}
        </div>
        <div class="result-actions">
          <button class="primary-button" type="button" data-action="retry">もう一度</button>
          <button class="secondary-button" type="button" data-action="home">カテゴリー一覧へ</button>
        </div>
      </div>
    </section>`;
}

function renderAbout() {
  app.innerHTML = `
    <section class="about-shell">
      <div class="about-card">
        <p class="eyebrow">How rating works</p>
        <h1>正確に、素早く聞き分ける。</h1>
        <p>Phase別トレーニングに加え、Phase 1〜3を混ぜた総合レベル判定を用意しています。総合判定は5問をすべて回答してから一括採点し、正確さと回答速度の両方でレートが変わります。</p>
        <div class="about-grid">
          <article class="about-step"><b>1</b><h2>3段階を横断</h2><p>音素・単語・connected speechを5問に混ぜて、総合力を測ります。</p></article>
          <article class="about-step"><b>2</b><h2>速度でレート変動</h2><p>正解なら+6〜+20、不正解なら−6〜−16。速さと正確さの両方を評価します。</p></article>
          <article class="about-step"><b>3</b><h2>最後に一括判定</h2><p>途中で答えを見せず、5問後に総合レベルと各問の正解を表示します。</p></article>
        </div>
        <div class="result-actions"><button class="primary-button" type="button" data-action="home">トレーニングへ</button></div>
      </div>
    </section>`;
}

function beginSession({ mode, phase = state.phase, categoryId = null }) {
  state.phase = phase;
  state.mode = mode;
  state.category = categoryId ? categories.find((category) => category.id === categoryId) : null;
  state.questions = mode === "random" ? makeRandomQuestions(phase) : makeCategoryQuestions(categoryId);
  state.questionIndex = 0;
  state.selected = null;
  state.answers = [];
  state.lastFeedback = null;
  state.lastRewards = null;
  state.view = "training";
  render();
  startQuestion();
}

function startQuestion() {
  state.questionStartedAt = performance.now();
  const started = speakCurrent("normal", startRatingTimer);
  if (!started) startRatingTimer();
  ratingFallbackTimer = setTimeout(() => {
    if (!ratingTimer && state.selected === null) startRatingTimer();
  }, currentQuestion().promptType === "sentence" ? 4200 : 2200);
}

function startRatingTimer() {
  if (ratingTimer || state.selected !== null) return;
  state.questionStartedAt = performance.now();
  const duration = 7000;
  ratingTimer = setInterval(() => {
    const elapsed = performance.now() - state.questionStartedAt;
    const remaining = Math.max(0, 1 - elapsed / duration);
    const seconds = elapsed / 1000;
    const projected = ratingDelta(true, seconds);
    const fill = document.querySelector("#speed-fill");
    const rate = document.querySelector("#speed-rate");
    if (fill) fill.style.width = `${remaining * 100}%`;
    if (rate) rate.textContent = `+${projected}`;
    if (!remaining) stopRatingTimer();
  }, 80);
}

function selectAnswer(key) {
  if (state.selected !== null) return;
  const question = currentQuestion();
  const seconds = Math.max(0.1, (performance.now() - state.questionStartedAt) / 1000);
  const correct = key === question.target;
  const delta = ratingDelta(correct, seconds);
  stopRatingTimer();
  state.selected = key;
  state.lastFeedback = { correct, seconds, ratingDelta: delta, feedbackDelta: state.mode === "random" ? delta : (correct ? 4 : -2) };
  state.answers.push({
    phase: state.phase,
    categoryId: question.categoryId,
    pairNumber: question.number,
    promptType: question.promptType,
    correct,
    correctWord: question[question.target].word,
    selectedWord: question[key].word,
    ipa: question[question.target].ipa,
    seconds,
    ratingDelta: delta,
  });
  renderTraining();
  playFeedbackSound(correct);
}

function nextQuestion() {
  if (state.questionIndex >= state.questions.length - 1) {
    if (state.mode === "random") prepareFinalQuiz();
    else {
      state.lastRewards = saveSession();
      state.view = "result";
      render();
    }
    return;
  }
  state.questionIndex += 1;
  state.selected = null;
  state.lastFeedback = null;
  renderTraining();
  startQuestion();
}

function prepareFinalQuiz() {
  const sequence = state.questions.map((question) => {
    const key = Math.random() < 0.5 ? "a" : "b";
    return { key, word: question[key].word, categoryId: question.categoryId, audioFile: question.wordAudioFiles?.[key] };
  });
  const planetIndex = planetForChoices(sequence.map((item) => item.key));
  state.finalQuiz = { sequence, planetIndex, userChoices: [], eliminatedRoutes: [], failedChoices: null, attempts: 0, playingIndex: -1, completed: false, bonus: 0 };
  state.view = "finalQuiz";
  render();
}

function planetForChoices(choices) {
  if (choices.length < 5) return null;
  const nodeIndex = choices.slice(0, 4).reduce((sum, key) => sum + (key === "b" ? 1 : 0), 0);
  return planetConnections[nodeIndex][choices[4] === "b" ? 1 : 0];
}

function routeFromChoices(choices) {
  let nodeIndex = 0;
  const segments = [];
  choices.slice(0, 4).forEach((key, stage) => {
    const nextIndex = nodeIndex + (key === "b" ? 1 : 0);
    segments.push({ stage, key, from: nodeIndex, to: nextIndex });
    nodeIndex = nextIndex;
  });
  return { segments, nodeIndex, planetIndex: choices.length === 5 ? planetForChoices(choices) : null };
}

function routeSvgMarkup(quiz) {
  const layers = [
    { x: 35, ys: [180] },
    { x: 170, ys: [120, 240] },
    { x: 305, ys: [80, 180, 280] },
    { x: 440, ys: [60, 140, 220, 300] },
    { x: 575, ys: [40, 110, 180, 250, 320] },
  ];
  const planetYs = [28, 74, 120, 166, 212, 258, 304, 344];
  const shownChoices = quiz.failedChoices || quiz.userChoices;
  const shownRoute = routeFromChoices(shownChoices);
  const eliminatedRouteStates = quiz.eliminatedRoutes.map((signature) => routeFromChoices(signature.split("")));
  const lines = [];
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const from = layers[layerIndex];
    const to = layers[layerIndex + 1];
    from.ys.forEach((fromY, nodeIndex) => {
      [nodeIndex, nodeIndex + 1].forEach((nextIndex, choiceIndex) => {
        const key = choiceIndex === 0 ? "a" : "b";
        const selected = shownRoute.segments.some((segment) => segment.stage === layerIndex && segment.from === nodeIndex && segment.to === nextIndex);
        const stateClass = selected ? (quiz.completed ? "is-arrived" : "is-selected") : "";
        lines.push(`<line class="route-line ${stateClass}" data-stage="${layerIndex}" data-choice="${key}" x1="${from.x}" y1="${fromY}" x2="${to.x}" y2="${to.ys[nextIndex]}"/>`);
      });
    });
  }
  planetConnections.forEach((destinations, sourceIndex) => destinations.forEach((planetIndex) => {
    lines.push(`<line class="route-line planet-route" x1="575" y1="${layers[4].ys[sourceIndex]}" x2="748" y2="${planetYs[planetIndex]}"/>`);
  }));
  if (shownRoute.planetIndex !== null) {
    const stateClass = quiz.completed ? "is-arrived" : quiz.failedChoices ? "is-eliminated" : "is-selected";
    lines.push(`<line class="route-line planet-route route-current ${stateClass}" x1="575" y1="${layers[4].ys[shownRoute.nodeIndex]}" x2="748" y2="${planetYs[shownRoute.planetIndex]}"/>`);
  }
  eliminatedRouteStates.forEach((route, index) => {
    if (quiz.failedChoices?.join("") === quiz.eliminatedRoutes[index]) return;
    lines.push(`<line class="route-line planet-route is-eliminated history-route" x1="575" y1="${layers[4].ys[route.nodeIndex]}" x2="748" y2="${planetYs[route.planetIndex]}"/>`);
  });
  const nodes = layers.flatMap((layer, layerIndex) => layer.ys.map((y, nodeIndex) => {
    if (layerIndex === 0) return "";
    const activeLayer = quiz.playingIndex === Math.max(0, layerIndex - 1) && layerIndex > 0 ? "is-active" : "";
    const selectedNode = layerIndex === 0 || shownRoute.segments.some((segment) => segment.stage === layerIndex - 1 && segment.to === nodeIndex);
    const stateClass = selectedNode && layerIndex > 0 ? (quiz.completed ? "is-arrived" : "is-selected") : "";
    let interaction = "";
    let clickable = "";
    if (layerIndex > 0 && !quiz.completed && !quiz.failedChoices) {
      const stage = layerIndex - 1;
      const prefixRoute = routeFromChoices(quiz.userChoices.slice(0, stage));
      if (stage <= quiz.userChoices.length && (nodeIndex === prefixRoute.nodeIndex || nodeIndex === prefixRoute.nodeIndex + 1)) {
        const key = nodeIndex === prefixRoute.nodeIndex ? "a" : "b";
        interaction = `data-route-node-stage="${stage}" data-route-node-key="${key}" role="button" tabindex="0" aria-label="ステージ${stage + 1}の${key === "a" ? "上" : "下"}を選択"`;
        clickable = "is-clickable";
      }
    }
    return `<circle class="route-node ${activeLayer} ${stateClass} ${clickable}" ${interaction} cx="${layer.x}" cy="${y}" r="${layerIndex === 0 ? 20 : 14}"/>`;
  }));
  return `${lines.join("")}${nodes.join("")}`;
}

function renderFinalQuiz() {
  const quiz = state.finalQuiz;
  const selectedPlanet = quiz.userChoices.length === 5 ? planetForChoices(quiz.userChoices) : null;
  const eliminatedPlanets = new Set(quiz.eliminatedRoutes.map((signature) => planetForChoices(signature.split(""))));
  app.innerHTML = `
    <section class="final-quiz-shell">
      <div class="final-quiz-heading">
        <div><p class="eyebrow">Final route</p><h1>地球から8つの天体へ</h1><p>5列の上・下から聞こえた単語を選び、ルートを完成させる</p></div>
        <button class="sequence-play-button ${quiz.playingIndex >= 0 ? "is-speaking" : ""}" type="button" data-action="play-sequence">${speakerSvg}<span>${quiz.playingIndex >= 0 ? `${quiz.playingIndex + 1} / 5` : "5つの音を聞く"}</span></button>
      </div>
      <div class="route-quiz-board">
        <div class="route-map">
          <svg viewBox="0 0 760 360" preserveAspectRatio="none">
            ${routeSvgMarkup(quiz)}
          </svg>
          <span class="route-earth-start">${planetArt(earth)}<small>EARTH · START</small></span>
          <div class="route-choice-columns">
            ${state.questions.map((question, index) => {
              const selected = quiz.userChoices[index];
              const locked = index > quiz.userChoices.length || quiz.completed || Boolean(quiz.failedChoices);
              const choiceClass = (key) => selected === key ? (quiz.completed ? "is-correct" : "is-selected") : "";
              return `<div class="route-choice-column ${quiz.playingIndex === index ? "is-playing" : ""}"><button type="button" class="route-word route-word-top ${choiceClass("a")}" data-route-stage="${index}" data-route-key="a" ${locked ? "disabled" : ""}><small>UP</small><strong>${question.a.word}</strong></button><span>${index + 1}<small>${categories.find((category) => category.id === question.categoryId)?.name || "Sound"}</small></span><button type="button" class="route-word route-word-bottom ${choiceClass("b")}" data-route-stage="${index}" data-route-key="b" ${locked ? "disabled" : ""}><strong>${question.b.word}</strong><small>DOWN</small></button></div>`;
            }).join("")}
          </div>
          <div class="route-stage-labels">${state.questions.map((question, index) => `<span class="${quiz.playingIndex === index ? "is-active" : ""}">${index + 1}<small>${categories.find((category) => category.id === question.categoryId)?.name || "Sound"}</small></span>`).join("")}</div>
        </div>
        <div class="planet-list">
          ${planets.map((planet, index) => `<div class="planet-button ${eliminatedPlanets.has(index) && !(quiz.completed && quiz.planetIndex === index) ? "is-eliminated" : ""} ${selectedPlanet === index ? "is-selected" : ""} ${quiz.completed && quiz.planetIndex === index ? "is-arrived" : ""}">${planetArt(planet)}<strong>${planet.name}</strong><small>${planet.en}</small></div>`).join("")}
        </div>
      </div>
      <div class="final-quiz-footer">
        <span>${quiz.completed ? (quiz.gaveUp ? `正解ルートを表示しました · 天体ボーナスなし` : `正解 · 地球から目的の天体までつながりました`) : quiz.attempts ? `${quiz.attempts}ルート消去 · 薄い線を避けて再挑戦` : `単語または中央の○を左から順に選択`}</span>
        <div class="final-route-actions">${!quiz.completed ? `<button class="secondary-button give-up-button" type="button" data-action="give-up-route">ギブアップ</button>` : ""}${quiz.completed ? `<button class="primary-button" type="button" data-action="finish-route">結果を見る →</button>` : quiz.userChoices.length === 5 ? `<button class="primary-button route-confirm-button" type="button" data-action="confirm-route">${planetArt(planets[selectedPlanet], true)}${planets[selectedPlanet].name}へ進む</button>` : ""}</div>
      </div>
    </section>`;
}

function playFinalSequence(force = false) {
  const quiz = state.finalQuiz;
  if (!quiz || (quiz.completed && !force)) return;
  const playAt = (index) => {
    if (index >= quiz.sequence.length) {
      quiz.playingIndex = -1;
      renderFinalQuiz();
      return;
    }
    quiz.playingIndex = index;
    renderFinalQuiz();
    const sequenceButton = document.querySelector(".sequence-play-button");
    const onEnd = () => { speechTimer = setTimeout(() => playAt(index + 1), 180); };
    const started = quiz.sequence[index].audioFile
      ? playRecordedAudio(quiz.sequence[index].audioFile, { button: sequenceButton, onEnd })
      : speakWord(quiz.sequence[index].word, { onEnd });
    if (!started) speechTimer = setTimeout(() => playAt(index + 1), 550);
  };
  playAt(0);
}

function selectRouteWord(stage, key) {
  const quiz = state.finalQuiz;
  if (!quiz || quiz.completed || quiz.failedChoices || stage > quiz.userChoices.length) return;
  quiz.userChoices = quiz.userChoices.slice(0, stage);
  quiz.userChoices[stage] = key;
  renderFinalQuiz();
}

function confirmRoute() {
  const quiz = state.finalQuiz;
  if (!quiz || quiz.completed || quiz.userChoices.length !== 5) return;
  const signature = quiz.userChoices.join("");
  if (quiz.eliminatedRoutes.includes(signature)) {
    showToast("このルートは消去済みです。選択を変えてください");
    return;
  }
  const correct = quiz.sequence.every((item, index) => item.key === quiz.userChoices[index]);
  if (correct) {
    quiz.completed = true;
    quiz.bonus = quiz.attempts === 0 ? 30 : quiz.attempts === 1 ? 15 : 5;
    playFeedbackSound(true);
    renderFinalQuiz();
  } else {
    quiz.eliminatedRoutes.push(signature);
    quiz.failedChoices = [...quiz.userChoices];
    quiz.attempts += 1;
    playFeedbackSound(false);
    renderFinalQuiz();
    speechTimer = setTimeout(() => {
      quiz.userChoices = [];
      quiz.failedChoices = null;
      renderFinalQuiz();
      playFinalSequence();
    }, 800);
  }
}

function giveUpRoute() {
  const quiz = state.finalQuiz;
  if (!quiz || quiz.completed) return;
  stopSpeech();
  quiz.userChoices = quiz.sequence.map((item) => item.key);
  quiz.failedChoices = null;
  quiz.completed = true;
  quiz.gaveUp = true;
  quiz.bonus = 0;
  renderFinalQuiz();
  showToast("正解ルートの5つの音を再生します");
  speechTimer = setTimeout(() => playFinalSequence(true), 180);
}

function getEnglishVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return voices.find((voice) => voice.lang === "en-US" && /Samantha|Ava|Alex|Evan|Google US English/i.test(voice.name))
    || voices.find((voice) => voice.lang === "en-US")
    || voices.find((voice) => voice.lang?.startsWith("en"));
}

function speakWord(word, { mode = "normal", buttonSelector = ".listen-button", onStart, onEnd } = {}) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    showToast("このブラウザは音声合成に対応していません。SafariまたはChromeでお試しください。");
    return false;
  }

  const wasBusy = Boolean(window.speechSynthesis.speaking || window.speechSynthesis.pending || activeUtterance);
  stopSpeech();
  const button = document.querySelector(buttonSelector);
  const play = () => {
    const utterance = new SpeechSynthesisUtterance(word);
    activeUtterance = utterance;
    utterance.lang = "en-US";
    utterance.rate = mode === "slow" ? 0.4 : 0.88;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = getEnglishVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => {
      button?.classList.add("is-speaking");
      onStart?.();
    };
    utterance.onend = () => {
      button?.classList.remove("is-speaking");
      activeUtterance = null;
      onEnd?.();
    };
    utterance.onerror = () => {
      button?.classList.remove("is-speaking");
      activeUtterance = null;
      clearSampleHighlight();
    };
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  };
  if (wasBusy) speechTimer = setTimeout(play, 45);
  else play();
  return true;
}

function playRecordedAudio(source, { rate = 1, buttonSelector = ".listen-button", button, onStart, onEnd } = {}) {
  stopSpeech();
  const targetButton = button || document.querySelector(buttonSelector);
  const audio = new Audio(source);
  phase3Audio = audio;
  audio.playbackRate = rate;
  audio.addEventListener("play", () => {
    targetButton?.classList.add("is-speaking");
    onStart?.();
  }, { once: true });
  const finish = () => {
    targetButton?.classList.remove("is-speaking");
    if (phase3Audio === audio) phase3Audio = null;
    onEnd?.();
  };
  audio.addEventListener("ended", finish, { once: true });
  audio.addEventListener("error", () => {
    showToast("音声ファイルを再生できませんでした");
    finish();
  }, { once: true });
  audio.play().catch(() => {
    showToast("再生ボタンを押して音声を開始してください");
    finish();
  });
  return true;
}

function speakCurrent(mode = "normal", onEnd) {
  const question = currentQuestion();
  if (!question) return false;
  if (question.audioFile) {
    if (mode === "slow") showToast("0.75倍速で再生します");
    return playRecordedAudio(question.audioFile, { rate: mode === "slow" ? 0.75 : 1, onStart: () => {}, onEnd });
  }
  const started = speakWord(question.spokenText || question[question.target].word, { mode, onEnd });
  if (mode === "slow") showToast("低速で再生します");
  return started;
}

function playCategorySample(categoryId) {
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return;
  const pair = pairs.find((item) => item.categoryId === categoryId);
  if (!pair) return;
  const buttonSelector = `[data-sample="${categoryId}"]`;
  document.querySelector(buttonSelector)?.classList.add("is-revealed");
  const playAt = (index) => {
    const key = index === 0 ? "a" : "b";
    playRecordedAudio(phase12AudioPath(pair, key), {
      buttonSelector,
      onStart: () => document.querySelector(`${buttonSelector} [data-sample-index="${index}"]`)?.classList.add("is-playing"),
      onEnd: () => {
        clearSampleHighlight();
        if (index === 0) speechTimer = setTimeout(() => playAt(1), 220);
      },
    });
  };
  playAt(0);
}

function playPhase3Sample(categoryId) {
  const question = phase3Questions.find((item) => item.categoryId === categoryId);
  if (!question) return;
  const button = document.querySelector(`[data-phase3-sample="${categoryId}"]`);
  button?.classList.add("is-revealed");
  playPhase3Clip(question, { button });
}

function playFeedbackSound(correct) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  feedbackAudioContext ||= new AudioContextClass();
  const context = feedbackAudioContext;
  context.resume?.();
  const now = context.currentTime;
  const notes = correct ? [523.25, 659.25, 783.99] : [220, 164.81];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + index * (correct ? 0.085 : 0.11);
    oscillator.type = correct ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(correct ? 0.12 : 0.085, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + (correct ? 0.25 : 0.2));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.28);
  });
}

let toastTimer;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function openTrainingDashboard() {
  const panel = document.querySelector(".mode-preview-panel.is-training");
  panel?.classList.add("is-leaving");
  window.setTimeout(() => {
    state.trainingMenuOpen = true;
    renderHome();
  }, panel ? 260 : 0);
}

function goHome() {
  state.view = "home";
  state.category = null;
  render();
}

function toggleCategoryDetails(categoryId) {
  const card = document.querySelector(`[data-category-card="${categoryId}"]`);
  if (!card) return;
  const shouldExpand = !card.classList.contains("is-expanded");
  document.querySelectorAll("[data-category-card].is-expanded").forEach((openCard) => {
    openCard.classList.remove("is-expanded");
    const summary = openCard.querySelector("[data-category-toggle]");
    summary?.setAttribute("aria-expanded", "false");
  });
  if (shouldExpand) {
    card.classList.add("is-expanded");
    card.querySelector("[data-category-toggle]")?.setAttribute("aria-expanded", "true");
  }
}

document.addEventListener("click", (event) => {
  const routeNode = event.target.closest("[data-route-node-stage]");
  if (routeNode) {
    selectRouteWord(Number(routeNode.dataset.routeNodeStage), routeNode.dataset.routeNodeKey);
    return;
  }
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.homeMode) {
    state.homeMode = target.dataset.homeMode;
    if (state.homeMode === "training") state.trainingMenuOpen = false;
    renderHome();
  }
  if (target.dataset.openTraining) openTrainingDashboard();
  if (target.dataset.trainingOverview) { state.trainingMenuOpen = false; renderHome(); }
  if (target.dataset.assessment) beginAssessment();
  if (target.dataset.weakness) beginWeaknessSession();
  if (target.dataset.batchPlay !== undefined) playBatchQuestion(Number(target.dataset.batchPlay));
  if (target.dataset.batchAnswer !== undefined) selectBatchAnswer(Number(target.dataset.batchAnswer), target.dataset.answerKey);
  if (target.dataset.batchToken !== undefined) selectBatchToken(Number(target.dataset.batchToken), target.dataset.tokenId);
  if (target.dataset.batchUndo !== undefined) undoBatchToken(Number(target.dataset.batchUndo));
  if (target.dataset.random) beginSession({ mode: "random", phase: Number(target.dataset.random) });
  if (target.dataset.phase3Random) beginPhase3Session();
  if (target.dataset.phase3Category) beginPhase3Session(target.dataset.phase3Category);
  if (target.dataset.categoryToggle) toggleCategoryDetails(target.dataset.categoryToggle);
  if (target.dataset.category) beginSession({ mode: "category", categoryId: target.dataset.category, phase: categories.find((category) => category.id === target.dataset.category).phase });
  if (target.dataset.sample) playCategorySample(target.dataset.sample);
  if (target.dataset.phase3Sample) playPhase3Sample(target.dataset.phase3Sample);
  if (target.dataset.phase) { state.phase = Number(target.dataset.phase); renderHome(); }
  if (target.dataset.speak) speakCurrent(target.dataset.speak);
  if (target.dataset.answer) selectAnswer(target.dataset.answer);
  if (target.dataset.phase3Token) selectPhase3Token(target.dataset.phase3Token);
  if (target.dataset.action === "home") goHome();
  if (target.dataset.action === "about") { state.view = "about"; render(); }
  if (target.dataset.action === "next") nextQuestion();
  if (target.dataset.action === "retry") state.phase === 3 ? beginPhase3Session(state.mode === "category" ? state.category?.id : null) : beginSession({ mode: state.mode, phase: state.phase, categoryId: state.category?.id || null });
  if (target.dataset.action === "retry-assessment") beginAssessment();
  if (target.dataset.action === "retry-weakness") beginWeaknessSession();
  if (target.dataset.action === "submit-batch") submitBatch();
  if (target.dataset.action === "play-phase3-question") playPhase3Current(startRatingTimer);
  if (target.dataset.action === "undo-phase3-token") undoPhase3Token();
  if (target.dataset.action === "confirm-phase3-tokens") confirmPhase3Tokens();
  if (target.dataset.action === "next-phase3") nextPhase3Question();
  if (target.dataset.action === "play-sequence") playFinalSequence();
  if (target.dataset.routeStage) selectRouteWord(Number(target.dataset.routeStage), target.dataset.routeKey);
  if (target.dataset.action === "confirm-route") confirmRoute();
  if (target.dataset.action === "give-up-route") giveUpRoute();
  if (target.dataset.action === "finish-route") {
    state.lastRewards = saveSession(state.finalQuiz.bonus);
    state.view = "result";
    render();
  }
});

document.addEventListener("keydown", (event) => {
  if (!["training", "phase3Training"].includes(state.view) || event.repeat) return;
  const question = currentQuestion();
  if (state.selected === null && ["ArrowLeft", "ArrowRight"].includes(event.code)) {
    event.preventDefault();
    if (state.view === "training") selectAnswer(question.choices[event.code === "ArrowLeft" ? 0 : 1]);
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (state.view === "phase3Training") playPhase3Current(startRatingTimer);
    else speakCurrent("normal");
    return;
  }
  if (event.code === "KeyS" && state.view === "training") {
    event.preventDefault();
    speakCurrent("slow");
    return;
  }
  if (state.selected !== null && event.code === "Enter") {
    event.preventDefault();
    if (state.view === "phase3Training") nextPhase3Question();
    else nextQuestion();
  }
});

window.speechSynthesis?.addEventListener?.("voiceschanged", getEnglishVoice);
render();
