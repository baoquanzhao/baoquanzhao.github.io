/* store.js — 本地学习数据存储（localStorage），替代原系统的云端数据库 */
(function () {
  const NS = "nlp_";
  const S = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(NS + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, val) { localStorage.setItem(NS + key, JSON.stringify(val)); },
    remove(key) { localStorage.removeItem(NS + key); },
  };

  /* ---------- 学习者画像（自评 1-5） ---------- */
  // { programming, math, ml, nlp, diagnosticScore, diagnosticAt }
  const getProfile = () => S.get("profile", null);
  const saveProfile = (p) => {
    S.set("profile", p);
    initDomainMasteryFromProfile(p);
  };

  /* ---------- 知识点掌握度 { kpId: {mastery, attempts, correct} } ---------- */
  const getKpMastery = () => S.get("kpMastery", {});
  const bumpKpMastery = (kpId, correct) => {
    if (!kpId) return;
    const all = getKpMastery();
    const prev = all[kpId];
    let mastery;
    if (!prev) mastery = correct ? 70 : 25;
    else mastery = Math.round(prev.mastery * 0.65 + (correct ? 100 : 0) * 0.35);
    mastery = Math.max(0, Math.min(100, mastery));
    all[kpId] = {
      mastery,
      attempts: (prev ? prev.attempts : 0) + 1,
      correct: (prev ? prev.correct : 0) + (correct ? 1 : 0),
    };
    S.set("kpMastery", all);
  };

  /* ---------- 前置领域掌握度 { domainId: {score, attempts, correct, source} } ---------- */
  const getDomainMastery = () => S.get("domainMastery", {});
  const bumpDomainMastery = (domainId, correct) => {
    const all = getDomainMastery();
    const prev = all[domainId];
    let score;
    if (!prev) score = correct ? 70 : 25;
    else score = Math.round(prev.score * 0.65 + (correct ? 100 : 0) * 0.35);
    score = Math.max(0, Math.min(100, score));
    all[domainId] = {
      score,
      attempts: (prev ? prev.attempts : 0) + 1,
      correct: (prev ? prev.correct : 0) + (correct ? 1 : 0),
      source: "quiz",
    };
    S.set("domainMastery", all);
  };
  // 由自评画像初始化领域分（仅当该领域还没有测评记录时）
  const initDomainMasteryFromProfile = (p) => {
    if (!p) return;
    const byCode = {};
    window.DATA_DOMAINS.forEach((d) => (byCode[d.code] = d));
    const map = {
      prog: p.programming,
      linalg: p.math, prob: p.math, calc: p.math,
      ml: p.ml, dl: Math.max(1, p.ml - 1),
      ling: p.nlp,
    };
    const all = getDomainMastery();
    Object.keys(map).forEach((code) => {
      const d = byCode[code];
      if (!d || all[d.id]) return;
      all[d.id] = { score: map[code] * 20, attempts: 0, correct: 0, source: "self" };
    });
    S.set("domainMastery", all);
  };

  /* ---------- 章节进度 { chapterId: {lessonsRead:[], completed, completedAt} } ---------- */
  const getProgress = () => S.get("progress", {});
  const markLessonRead = (chapterId, lessonId) => {
    const all = getProgress();
    const p = all[chapterId] || { lessonsRead: [], completed: false };
    if (!p.lessonsRead.includes(lessonId)) p.lessonsRead.push(lessonId);
    all[chapterId] = p;
    S.set("progress", all);
  };
  const markChapterCompleted = (chapterId) => {
    const all = getProgress();
    const p = all[chapterId] || { lessonsRead: [], completed: false };
    p.completed = true;
    p.completedAt = Date.now();
    all[chapterId] = p;
    S.set("progress", all);
  };

  /* ---------- 答题记录 ---------- */
  const getAttempts = () => S.get("attempts", []);
  const recordAttempt = (rec) => {
    // rec: {questionId, chapterId, kpId, correct, ts}
    const all = getAttempts();
    all.push(rec);
    S.set("attempts", all);
    if (rec.kpId) bumpKpMastery(rec.kpId, rec.correct);
  };

  /* ---------- AI 生成的个性化讲义缓存 { chapterId: {content, weakDomains, ts} } ---------- */
  const getGuides = () => S.get("guides", {});
  const saveGuide = (chapterId, guide) => {
    const all = getGuides();
    all[chapterId] = guide;
    S.set("guides", all);
  };

  /* ---------- Kimi API 密钥（仅存本地浏览器） ---------- */
  const getApiKey = () => S.get("apiKey", "");
  const setApiKey = (k) => S.set("apiKey", k);

  /* ---------- 聊天记录 ---------- */
  const getChat = () => S.get("chat", []);
  const saveChat = (msgs) => S.set("chat", msgs);

  const resetAll = () => {
    ["profile", "kpMastery", "domainMastery", "progress", "attempts", "guides", "chat"]
      .forEach((k) => S.remove(k));
  };

  window.Store = {
    getProfile, saveProfile,
    getKpMastery, bumpKpMastery,
    getDomainMastery, bumpDomainMastery, initDomainMasteryFromProfile,
    getProgress, markLessonRead, markChapterCompleted,
    getAttempts, recordAttempt,
    getGuides, saveGuide,
    getApiKey, setApiKey,
    getChat, saveChat,
    resetAll,
  };
})();
