/* app.js — 本地版主程序：hash 路由 + 全部页面（原生 JS，无外部依赖） */
(function () {
  "use strict";
  const app = document.getElementById("app");
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const qs = (sel, el) => (el || document).querySelector(sel);
  const qsa = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  /* ================= 数据访问层 ================= */
  const D = {
    chapters: window.DATA_CHAPTERS,
    kps: window.DATA_KPS,
    questions: window.DATA_QUESTIONS,
    lessons: window.DATA_LESSONS,
    domains: window.DATA_DOMAINS,
    prereqQuestions: window.DATA_PREREQ_QUESTIONS,
    chapterPrereqs: window.DATA_CHAPTER_PREREQS,
    edges: window.DATA_EDGES,
  };
  const chapterByCode = (code) => D.chapters.find((c) => c.code === code);
  const chapterById = (id) => D.chapters.find((c) => c.id === id);
  const kpsOf = (chapterId) => D.kps.filter((k) => k.chapterId === chapterId);
  const lessonsOf = (chapterId) => D.lessons.filter((l) => l.chapterId === chapterId);
  const questionsOf = (chapterId) => D.questions.filter((q) => q.chapterId === chapterId);
  const prereqsOf = (chapterId) =>
    D.chapterPrereqs.filter((p) => p.chapterId === chapterId)
      .map((p) => ({ ...p, domain: D.domains.find((d) => d.id === p.domainId) }));
  const parseOptions = (q) => { try { return JSON.parse(q.options); } catch (e) { return []; } };

  /* ================= 学习数据派生逻辑（移植自服务端） ================= */
  // 某章平均掌握度（仅统计已评估知识点）
  function chapterMastery(chapterId) {
    const m = Store.getKpMastery();
    const vals = kpsOf(chapterId).map((k) => m[k.id]).filter(Boolean).map((x) => x.mastery);
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  // 章节前置关系：toChapterId <- fromChapterId
  function prereqChaptersOf(chapterId) {
    return D.edges.filter((e) => e.toChapterId === chapterId).map((e) => e.fromChapterId);
  }
  // 学习路径状态：done / current / open / locked
  function learningPath() {
    const progress = Store.getProgress();
    const items = D.chapters.map((ch) => {
      const p = progress[ch.id];
      const mastery = chapterMastery(ch.id);
      let state;
      if (p && p.completed) state = "done";
      else {
        const pres = prereqChaptersOf(ch.id);
        const met = pres.every((pid) => {
          const pp = progress[pid];
          if (pp && pp.completed) return true;
          const pm = chapterMastery(pid);
          return pm !== null && pm >= 60;
        });
        state = met ? "open" : "locked";
      }
      return { chapter: ch, mastery, state, lessonsRead: (progress[ch.id] || {}).lessonsRead || [] };
    });
    const firstOpen = items.find((i) => i.state === "open");
    if (firstOpen) firstOpen.state = "current";
    return items;
  }
  // 前置领域缺口：score 为空或 <60
  function domainStatus() {
    const dm = Store.getDomainMastery();
    return D.domains.map((d) => {
      const rec = dm[d.id];
      const score = rec ? rec.score : null;
      return { domain: d, score, source: rec ? rec.source : null, gap: score === null || score < 60 };
    });
  }
  function chapterGapMap() {
    const status = domainStatus();
    const map = {};
    D.chapters.forEach((ch) => {
      map[ch.id] = prereqsOf(ch.id)
        .filter((p) => {
          const st = status.find((s) => s.domain.id === p.domainId);
          return st && st.gap;
        })
        .map((p) => p.domain.name);
    });
    return map;
  }
  function weakKps(limit) {
    const m = Store.getKpMastery();
    return D.kps
      .map((k) => ({ kp: k, rec: m[k.id] }))
      .filter((x) => x.rec && x.rec.mastery < 60)
      .sort((a, b) => a.rec.mastery - b.rec.mastery)
      .slice(0, limit || 6);
  }
  // 自适应出题：错题优先 → 未做过（按知识点掌握度升序）→ 已掌握
  function pickAdaptiveQuestions(chapterId) {
    const m = Store.getKpMastery();
    const masteryOf = (q) => (q.kpId && m[q.kpId] ? m[q.kpId].mastery : -1);
    const hasWrong = (q) => q.kpId && m[q.kpId] && m[q.kpId].correct < m[q.kpId].attempts;
    const attempted = (q) => q.kpId && m[q.kpId];
    const qsAll = questionsOf(chapterId);
    const wrong = qsAll.filter(hasWrong).sort((a, b) => masteryOf(a) - masteryOf(b));
    const fresh = qsAll.filter((q) => !attempted(q)).sort((a, b) => masteryOf(a) - masteryOf(b));
    const rest = qsAll.filter((q) => attempted(q) && !hasWrong(q)).sort((a, b) => masteryOf(a) - masteryOf(b));
    return wrong.concat(fresh, rest);
  }

  /* ================= 通用 UI 片段 ================= */
  const tag = (text, cls) => '<span class="tag ' + (cls || "") + '">' + esc(text) + "</span>";
  const bar = (pct, low) =>
    '<div class="bar"><i class="' + (low ? "low" : "") + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';
  const stateTag = (s) =>
    ({ done: tag("已完成"), current: tag("进行中", "tag-blue"), open: tag("已解锁", "tag-gray"), locked: tag("未解锁", "tag-gray") }[s]);

  function accordion(title, bodyHtml, extra) {
    return '<div class="acc"><button class="acc-head" type="button"><span>' + title +
      '</span><span class="muted">' + (extra || "展开 ▾") + "</span></button>" +
      '<div class="acc-body" style="display:none">' + bodyHtml + "</div></div>";
  }
  document.addEventListener("click", (e) => {
    const head = e.target.closest(".acc-head");
    if (head) {
      const body = head.nextElementSibling;
      body.style.display = body.style.display === "none" ? "" : "none";
    }
  });

  /* ================= 页面：首页 ================= */
  function pageHome() {
    const attempts = Store.getAttempts();
    const correct = attempts.filter((a) => a.correct).length;
    const path = learningPath();
    const doneCount = path.filter((i) => i.state === "done").length;
    app.innerHTML =
      '<section class="hero">' +
      "<h1>自然语言处理 · 智能学习平台</h1>" +
      "<p>中山大学人工智能学院《自然语言处理》课程配套学习平台（本地单机版）。涵盖 12 章完整课程内容：" +
      "在线讲义、课件浏览、自适应练习、前置知识评估、个性化学习路径与 AI 助教。学习数据仅保存在本机浏览器中。</p>" +
      '<div class="row">' +
      '<a class="btn btn-solid" href="#/chapters">开始学习</a>' +
      '<a class="btn" href="#/path">个性化学习路径</a>' +
      '<a class="btn" href="#/chat">AI 助教</a>' +
      "</div></section>" +
      '<div class="grid grid-4">' +
      '<div class="card"><div class="stat-num">12</div><div class="muted">课程章节</div></div>' +
      '<div class="card"><div class="stat-num">' + D.lessons.length + '</div><div class="muted">讲义小节</div></div>' +
      '<div class="card"><div class="stat-num">' + D.kps.length + '</div><div class="muted">知识点</div></div>' +
      '<div class="card"><div class="stat-num">' + D.questions.length + '</div><div class="muted">练习题</div></div>' +
      "</div>" +
      '<div class="grid grid-2">' +
      '<div class="card"><h2>我的学习概况</h2>' +
      '<div class="row" style="margin-bottom:10px">' + tag("已完成章节 " + doneCount + " / 12") +
      tag("累计答题 " + attempts.length + " 道", "tag-blue") +
      (attempts.length ? tag("正确率 " + Math.round((correct / attempts.length) * 100) + "%", "tag-amber") : "") + "</div>" +
      '<div class="muted">从「课程内容」进入任一章节开始在线学习；从「个性化学习路径」评估基础，获取为你定制的学习路线。</div></div>' +
      '<div class="card"><h2>功能导航</h2>' +
      '<div class="grid grid-2">' +
      '<a class="btn" href="#/chapters">📖 课程内容（讲义 / 课件 / 知识点）</a>' +
      '<a class="btn" href="#/path">🧭 个性化学习路径（基础评估）</a>' +
      '<a class="btn" href="#/dashboard">📊 学习仪表盘（进度与成效）</a>' +
      '<a class="btn" href="#/chat">🤖 AI 助教（Kimi 智能问答）</a>' +
      "</div></div></div>";
  }

  /* ================= 页面：章节列表 ================= */
  function pageChapters() {
    const path = learningPath();
    app.innerHTML = '<div class="card"><h2>课程内容</h2>' +
      '<div class="muted">12 章完整内容：每章含在线讲义、课件 PDF、知识点详解、自适应练习与个性化指导。</div></div>' +
      '<div class="grid grid-3">' +
      path.map((i) => {
        const ch = i.chapter;
        const total = lessonsOf(ch.id).length;
        const read = i.lessonsRead.length;
        return '<a class="card ch-card" href="#/chapter/' + ch.code + '">' +
          '<div class="row" style="margin-bottom:10px">' +
          '<span class="ch-num">' + ch.sortOrder + "</span>" +
          '<span class="ch-title">' + esc(ch.title) + "</span>" + stateTag(i.state) + "</div>" +
          '<div class="muted" style="min-height:40px;margin-bottom:10px">' + esc(ch.summary.slice(0, 52)) + "…</div>" +
          '<div class="row" style="margin-bottom:8px">' +
          tag("讲义 " + total + " 节") + tag("知识点 " + kpsOf(ch.id).length) + tag("课件 PDF", "tag-blue") + "</div>" +
          bar(total ? (read / total) * 100 : 0) +
          '<div class="muted" style="margin-top:5px">讲义进度 ' + read + " / " + total + "</div></a>";
      }).join("") + "</div>";
  }

  /* ================= 页面：章节详情 ================= */
  function pageChapter(code, tab, lessonIdx) {
    const ch = chapterByCode(code);
    if (!ch) { app.innerHTML = '<div class="card">章节不存在。</div>'; return; }
    tab = tab || "lessons";
    lessonIdx = lessonIdx || 0;
    const lessons = lessonsOf(ch.id);
    const kps = kpsOf(ch.id);
    const mastery = Store.getKpMastery();

    const tabsDef = [
      ["lessons", "在线讲义"], ["courseware", "课件浏览"],
      ["kps", "知识点"], ["guide", "个性化指导"],
    ];
    let html =
      '<div class="card">' +
      '<div class="row" style="margin-bottom:8px">' +
      '<span class="ch-num">' + ch.sortOrder + "</span><h2 style=" + '"margin:0"' + ">第 " + ch.sortOrder + " 章 · " + esc(ch.title) + "</h2></div>" +
      '<p class="muted" style="line-height:1.8;margin-bottom:10px">' + esc(ch.summary) + "</p>" +
      '<div class="row">' +
      '<a class="btn btn-primary btn-sm" href="#/practice/' + ch.code + '">开始本章练习</a>' +
      '<a class="btn btn-sm" href="courseware/' + ch.code + '.pdf" target="_blank">打开课件 PDF</a>' +
      "</div></div>" +
      '<div class="tabs">' +
      tabsDef.map((t) =>
        '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? "active" : "") + '">' + t[1] + "</button>"
      ).join("") + "</div>" +
      '<div id="tab-body"></div>';
    app.innerHTML = html;

    qsa(".tabs button").forEach((b) =>
      b.addEventListener("click", () => pageChapter(code, b.dataset.tab, 0))
    );
    const body = qs("#tab-body");

    if (tab === "lessons") {
      const cur = lessons[lessonIdx];
      Store.markLessonRead(ch.id, cur.id);
      const readSet = new Set((Store.getProgress()[ch.id] || { lessonsRead: [] }).lessonsRead);
      body.innerHTML =
        '<div class="lesson-layout">' +
        '<div class="card lesson-nav" style="margin:0">' +
        lessons.map((l, i) =>
          '<a href="javascript:void(0)" data-i="' + i + '" class="' + (i === lessonIdx ? "active" : "") + '">' +
          esc(l.sectionTitle) + (readSet.has(l.id) ? '<span class="read-dot">✓</span>' : "") + "</a>"
        ).join("") +
        '<div style="margin-top:14px"><button id="btn-complete" class="btn btn-primary btn-sm" style="width:100%">标记本章已完成</button></div>' +
        "</div>" +
        '<div class="card" style="margin:0">' +
        "<h2>" + esc(cur.sectionTitle) + "</h2>" +
        MD.render(cur.content) +
        '<div class="row" style="margin-top:18px;justify-content:space-between">' +
        (lessonIdx > 0 ? '<button id="prev-l" class="btn btn-sm">← 上一节</button>' : "<span></span>") +
        (lessonIdx < lessons.length - 1 ? '<button id="next-l" class="btn btn-sm">下一节 →</button>' : "<span></span>") +
        "</div></div></div>";
      qsa(".lesson-nav a").forEach((a) =>
        a.addEventListener("click", () => pageChapter(code, "lessons", +a.dataset.i)));
      const prev = qs("#prev-l"), next = qs("#next-l");
      if (prev) prev.addEventListener("click", () => pageChapter(code, "lessons", lessonIdx - 1));
      if (next) next.addEventListener("click", () => pageChapter(code, "lessons", lessonIdx + 1));
      qs("#btn-complete").addEventListener("click", () => {
        Store.markChapterCompleted(ch.id);
        alert("已标记本章完成！学习路径将同步更新。");
        pageChapter(code, "lessons", lessonIdx);
      });
    }

    if (tab === "courseware") {
      body.innerHTML =
        '<div class="card">' +
        '<div class="row" style="margin-bottom:12px;justify-content:space-between">' +
        "<h3>本章课件（PDF）</h3>" +
        '<a class="btn btn-sm" href="courseware/' + ch.code + '.pdf" target="_blank">新窗口打开</a></div>' +
        '<iframe class="pdf-frame" src="courseware/' + ch.code + '.pdf"></iframe>' +
        '<div class="muted" style="margin-top:8px">课件文件位于 courseware/ 文件夹，浏览器内直接阅读；如加载较慢请耐心等待。</div></div>';
    }

    if (tab === "kps") {
      body.innerHTML =
        '<div class="card"><h3>学习目标</h3><ul class="md-ul">' +
        ch.objectives.split("\n").map((o) => "<li>" + esc(o) + "</li>").join("") +
        '</ul></div><div class="card"><h3>知识点（' + kps.length + "）</h3>" +
        kps.map((k) => {
          const rec = mastery[k.id];
          const badge = rec
            ? tag("掌握度 " + rec.mastery + "%", rec.mastery < 60 ? "tag-amber" : "")
            : tag("未评估", "tag-gray");
          return accordion("<b>" + esc(k.name) + "</b>&nbsp;" + badge,
            '<p class="md-p">' + esc(k.description) + "</p>" +
            (rec ? bar(rec.mastery, rec.mastery < 60) : ""));
        }).join("") + "</div>";
    }

    if (tab === "guide") renderGuideTab(body, ch, lessons);
  }

  /* ---------- 个性化指导标签页 ---------- */
  function renderGuideTab(body, ch, lessons) {
    const status = domainStatus();
    const pres = prereqsOf(ch.id);
    const guides = Store.getGuides();
    const cached = guides[ch.id];

    let html = '<div class="card"><h3>本章前置知识依赖</h3>';
    if (!Store.getProfile() && !Object.keys(Store.getDomainMastery()).length) {
      html += '<div class="note note-amber">尚未评估你的前置基础。请先到 <a href="#/path"><b>个性化学习路径</b></a> 页面完成自评或测评，此处将给出针对性的补习建议。</div>';
    }
    html += pres.map((p) => {
      const st = status.find((s) => s.domain.id === p.domainId);
      const stars = '<span class="stars">' + "★".repeat(p.weight) + "☆".repeat(3 - p.weight) + "</span>";
      const badge = st.score === null
        ? tag("未评估", "tag-gray")
        : tag("掌握度 " + st.score + "%" + (st.source === "self" ? "（自评）" : ""), st.gap ? "tag-amber" : "");
      const head = "<b>" + esc(p.domain.name) + "</b>&nbsp;" + stars + "&nbsp;" + badge;
      let bdy = '<div class="note note-blue" style="margin-bottom:10px">' + esc(p.note) + "</div>";
      if (st.gap) {
        bdy += "<h3>📚 补习讲义：" + esc(p.domain.name) + "</h3>" + MD.render(p.domain.supplement) +
          '<div style="margin-top:10px"><a class="btn btn-sm" href="#/path/quiz/' + p.domain.id + '">参加该领域测评 →</a></div>';
      } else {
        bdy += '<div class="note note-green">该前置基础达标，可以按正常节奏学习本章相关内容。</div>';
      }
      return accordion(head, bdy);
    }).join("");
    html += "</div>";

    // AI 个性化指导
    html += '<div class="card"><h3>🤖 AI 个性化学习指导</h3>';
    if (cached) {
      html += '<div id="guide-content">' + MD.render(cached.content) + "</div>" +
        '<div class="muted" style="margin:8px 0 12px">生成于 ' + new Date(cached.ts).toLocaleString("zh-CN") + "</div>" +
        '<button id="btn-guide" class="btn btn-sm">重新生成</button>';
    } else {
      html += '<div class="muted" style="margin-bottom:12px">基于你的前置知识评估结果，由 Kimi 大模型为本章生成个性化学习指导：补偿性讲解薄弱前置知识、给出各节详略建议。</div>' +
        '<button id="btn-guide" class="btn btn-primary">生成本章个性化指导</button>';
    }
    html += ' <span id="guide-status"></span></div>';
    body.innerHTML = html;

    qs("#btn-guide").addEventListener("click", async () => {
      const statusEl = qs("#guide-status");
      if (!window.Kimi.isConfigured()) {
        alert("尚未填写 Kimi API Key，请到「设置」页填写后再生成。");
        location.hash = "#/settings";
        return;
      }
      statusEl.innerHTML = '<span class="spin"></span>AI 正在为你备课（约 20 秒）……';
      qs("#btn-guide").disabled = true;
      try {
        const weak = [], strong = [];
        pres.forEach((p) => {
          const st = status.find((s) => s.domain.id === p.domainId);
          if (st.gap) weak.push({ name: p.domain.name, score: st.score === null ? -1 : st.score });
          else strong.push(p.domain.name);
        });
        const content = await window.Kimi.generateChapterGuide(ch, lessons, weak, strong);
        Store.saveGuide(ch.id, { content, weakDomains: weak.map((w) => w.name), ts: Date.now() });
        renderGuideTab(body, ch, lessons);
      } catch (e) {
        statusEl.innerHTML = '<span class="tag tag-amber">' + esc(e.message) + "</span>";
        qs("#btn-guide").disabled = false;
      }
    });
  }

  /* ================= 页面：章节练习（自适应） ================= */
  function pagePractice(code) {
    const ch = chapterByCode(code);
    if (!ch) { app.innerHTML = '<div class="card">章节不存在。</div>'; return; }
    const queue = pickAdaptiveQuestions(ch.id);
    if (!queue.length) { app.innerHTML = '<div class="card">本章暂无练习题。</div>'; return; }
    runQuiz({
      title: "第 " + ch.sortOrder + " 章 · " + ch.title + "（自适应练习）",
      questions: queue,
      onAnswer: (q, correct) =>
        Store.recordAttempt({ questionId: q.id, chapterId: ch.id, kpId: q.kpId, correct, ts: Date.now() }),
      backHash: "#/chapter/" + code,
    });
  }

  /* ---------- 通用答题器 ---------- */
  // cfg: {title, questions, onAnswer(q, correct), backHash, onFinish(result)}
  function runQuiz(cfg) {
    let idx = 0, correctCount = 0;
    const results = [];
    function renderQ() {
      const q = cfg.questions[idx];
      const opts = parseOptions(q);
      app.innerHTML =
        '<div class="card">' +
        '<div class="row" style="justify-content:space-between;margin-bottom:14px">' +
        "<h3>" + esc(cfg.title) + "</h3>" +
        '<span class="muted">第 ' + (idx + 1) + " / " + cfg.questions.length + " 题</span></div>" +
        bar(((idx) / cfg.questions.length) * 100) +
        '<div style="margin-top:16px" class="quiz-q">' + esc(q.stem) + "</div>" +
        '<div id="opts">' +
        opts.map((o, i) => '<button class="opt" data-i="' + i + '">' + esc(o) + "</button>").join("") +
        "</div>" +
        '<div id="q-foot"></div></div>';
      qsa("#opts .opt").forEach((b) =>
        b.addEventListener("click", () => {
          const letter = String.fromCharCode(65 + (+b.dataset.i));
          const correct = letter === q.answer;
          qsa("#opts .opt").forEach((x) => {
            x.disabled = true;
            const l = String.fromCharCode(65 + (+x.dataset.i));
            if (l === q.answer) x.classList.add("correct");
          });
          if (!correct) b.classList.add("wrong");
          if (correct) correctCount++;
          results.push({ q, correct });
          if (cfg.onAnswer) cfg.onAnswer(q, correct);
          qs("#q-foot").innerHTML =
            '<div class="quiz-explain"><b>' + (correct ? "✓ 回答正确" : "✗ 正确答案：" + esc(q.answer)) + "</b><br>" +
            esc(q.explanation || "") + "</div>" +
            '<div style="margin-top:14px;text-align:right"><button id="q-next" class="btn btn-primary btn-sm">' +
            (idx < cfg.questions.length - 1 ? "下一题" : "查看结果") + "</button></div>";
          qs("#q-next").addEventListener("click", () => {
            idx++;
            if (idx < cfg.questions.length) renderQ();
            else finish();
          });
        })
      );
    }
    function finish() {
      const pct = Math.round((correctCount / cfg.questions.length) * 100);
      app.innerHTML =
        '<div class="card" style="text-align:center;padding:40px 24px">' +
        '<div class="stat-num" style="font-size:40px">' + pct + " 分</div>" +
        '<div class="muted" style="margin:8px 0 20px">答对 ' + correctCount + " / " + cfg.questions.length + " 题</div>" +
        '<div class="row" style="justify-content:center">' +
        '<a class="btn" href="' + (cfg.backHash || "#/") + '">返回</a>' +
        '<button id="q-retry" class="btn btn-primary">再练一次</button></div>' +
        '<div id="finish-extra" style="margin-top:16px"></div></div>';
      qs("#q-retry").addEventListener("click", () => runQuiz(cfg));
      if (cfg.onFinish) cfg.onFinish({ pct, correctCount, total: cfg.questions.length, results });
    }
    renderQ();
  }

  /* ================= 页面：个性化学习路径 ================= */
  const DIMS = [
    ["programming", "编程基础（Python）"],
    ["math", "数学基础（线代/概率/微积分）"],
    ["ml", "机器学习基础"],
    ["nlp", "语言学与NLP常识"],
  ];
  const LEVELS = ["完全不了解", "了解一点", "基本掌握", "比较熟练", "非常熟练"];

  function pagePath(sub, arg) {
    if (sub === "assess") return pageAssess();
    if (sub === "diagnostic") return pageDiagnostic();
    if (sub === "quiz") return pagePrereqQuiz(+arg);
    const profile = Store.getProfile();
    const dStatus = domainStatus();
    const path = learningPath();
    const gapMap = chapterGapMap();
    const weak = weakKps(6);

    let html = "";

    // —— 学习者画像 ——
    html += '<div class="card"><div class="row" style="justify-content:space-between">' +
      "<h2>我的学习基础画像</h2><div class='row'>" +
      '<a class="btn btn-sm" href="#/path/assess">' + (profile ? "重新自评" : "开始自评（1 分钟）") + "</a>" +
      '<a class="btn btn-sm" href="#/path/diagnostic">参加交互式诊断测评</a></div></div>';
    if (profile) {
      html += '<div class="grid grid-4" style="margin-top:12px">' +
        DIMS.map((d) =>
          '<div><div class="muted" style="margin-bottom:4px">' + d[1] + "</div>" +
          bar((profile[d[0]] / 5) * 100) +
          '<div class="muted" style="margin-top:3px">' + LEVELS[profile[d[0]] - 1] + "</div></div>"
        ).join("") + "</div>";
      if (profile.diagnosticScore != null) {
        html += '<div style="margin-top:10px">' + tag("诊断测评得分 " + profile.diagnosticScore + " 分", "tag-blue") + "</div>";
      }
    } else {
      html += '<div class="note note-amber" style="margin-top:10px">还没有你的基础画像。可通过<b>自评</b>快速填写，或参加<b>诊断测评</b>（12 道交互式题目）自动评估。完成后将为你生成个性化学习路径。</div>';
    }
    html += "</div>";

    // —— 前置知识域掌握情况 ——
    html += '<div class="card"><h2>前置知识域掌握情况</h2>' +
      '<div class="muted" style="margin-bottom:12px">课程涉及 7 个前置知识域；存在缺口（&lt;60 分）的领域建议在相关章节学习前完成补习讲义。</div>' +
      dStatus.map((s) =>
        '<div class="row" style="margin-bottom:10px">' +
        '<span style="width:150px;font-size:13.5px">' + esc(s.domain.name) + "</span>" +
        '<span style="flex:1">' + bar(s.score === null ? 0 : s.score, s.gap) + "</span>" +
        '<span style="width:150px;text-align:right">' +
        (s.score === null ? tag("未评估", "tag-gray")
          : tag(s.score + " 分" + (s.source === "self" ? "·自评" : ""), s.gap ? "tag-amber" : "")) +
        ' <a class="btn btn-sm" href="#/path/quiz/' + s.domain.id + '">测评</a></span></div>'
      ).join("") + "</div>";

    // —— 学习路径时间线 ——
    const stateIcon = { done: "✓", current: "▶", open: "○", locked: "🔒" };
    html += '<div class="card"><h2>个性化学习路径</h2>' +
      '<div class="muted" style="margin-bottom:14px">按章节前置关系与知识点掌握度动态生成；完成本章练习可提升掌握度并解锁后续章节。</div>' +
      path.map((i, n) => {
        const gaps = gapMap[i.chapter.id] || [];
        return '<div class="tl-item">' +
          '<div class="tl-rail"><div class="tl-dot ' + i.state + '">' + stateIcon[i.state] + "</div>" +
          (n < path.length - 1 ? '<div class="tl-line"></div>' : "") + "</div>" +
          '<div class="tl-body"><div class="row" style="margin-bottom:5px">' +
          '<a href="#/chapter/' + i.chapter.code + '"><b>第 ' + i.chapter.sortOrder + " 章 · " + esc(i.chapter.title) + "</b></a>" +
          stateTag(i.state) + "</div>" +
          '<div class="row">' +
          '<span style="width:180px">' + (i.mastery !== null ? bar(i.mastery, i.mastery < 60) : bar(0)) + "</span>" +
          '<span class="muted">' + (i.mastery !== null ? "知识点掌握度 " + i.mastery + "%" : "尚未开始练习") + "</span></div>" +
          (gaps.length
            ? '<div class="note note-amber" style="margin-top:6px">⚠ 本章涉及你的薄弱前置：' + gaps.map(esc).join("、") + "（可在章节「个性化指导」页查看补习讲义）</div>"
            : "") +
          "</div></div>";
      }).join("") + "</div>";

    // —— 薄弱知识点巩固 ——
    html += '<div class="card"><h2>薄弱知识点巩固</h2>';
    if (!weak.length) {
      html += '<div class="muted">暂无掌握度低于 60% 的知识点。完成各章练习后，需要巩固的知识点会出现在这里。</div>';
    } else {
      html += weak.map((w) => {
        const ch = chapterById(w.kp.chapterId);
        return '<div class="row" style="margin-bottom:10px">' +
          '<span style="width:200px;font-size:13.5px">' + esc(w.kp.name) + "</span>" +
          '<span style="flex:1">' + bar(w.rec.mastery, true) + "</span>" +
          '<span style="width:120px;text-align:right">' + tag(w.rec.mastery + "%", "tag-amber") + "</span>" +
          '<a class="btn btn-sm" href="#/practice/' + ch.code + '">巩固练习</a></div>';
      }).join("");
    }
    html += "</div>";
    app.innerHTML = html;
  }

  /* ---------- 基础自评 ---------- */
  function pageAssess() {
    const profile = Store.getProfile() || { programming: 3, math: 3, ml: 3, nlp: 3 };
    const sel = { ...profile };
    app.innerHTML = '<div class="card"><h2>学习基础自评</h2>' +
      '<div class="muted" style="margin-bottom:16px">按真实情况选择每个维度的掌握程度（1 = 完全不了解，5 = 非常熟练），将用于定位你的前置知识缺口。</div>' +
      DIMS.map((d) =>
        '<div class="dim-row"><span style="font-size:13.5px">' + d[1] + '</span>' +
        '<div class="dim-btns" data-dim="' + d[0] + '">' +
        LEVELS.map((lv, i) =>
          '<button data-v="' + (i + 1) + '" class="' + (sel[d[0]] === i + 1 ? "sel" : "") + '">' + (i + 1) + " " + lv + "</button>"
        ).join("") + "</div></div>"
      ).join("") +
      '<div style="margin-top:18px"><button id="save-assess" class="btn btn-primary">保存并生成学习路径</button> ' +
      '<a class="btn" href="#/path">返回</a></div></div>';
    qsa(".dim-btns").forEach((g) =>
      qsa("button", g).forEach((b) =>
        b.addEventListener("click", () => {
          sel[g.dataset.dim] = +b.dataset.v;
          qsa("button", g).forEach((x) => x.classList.toggle("sel", x === b));
        })
      )
    );
    qs("#save-assess").addEventListener("click", () => {
      const old = Store.getProfile() || {};
      Store.saveProfile({ ...sel, diagnosticScore: old.diagnosticScore, diagnosticAt: old.diagnosticAt });
      location.hash = "#/path";
    });
  }

  /* ---------- 诊断测评（每章 1 道诊断题，共 12 题） ---------- */
  function pageDiagnostic() {
    const qsAll = D.questions.filter((q) => q.isDiagnostic);
    runQuiz({
      title: "交互式基础诊断测评",
      questions: qsAll,
      onAnswer: (q, correct) =>
        Store.recordAttempt({ questionId: q.id, chapterId: q.chapterId, kpId: q.kpId, correct, ts: Date.now() }),
      backHash: "#/path",
      onFinish: (r) => {
        const old = Store.getProfile() || { programming: 3, math: 3, ml: 3, nlp: 3 };
        Store.saveProfile({ ...old, diagnosticScore: r.pct, diagnosticAt: Date.now() });
        qs("#finish-extra").innerHTML =
          '<div class="note note-green">诊断结果已保存，各章知识点掌握度已更新。返回 <a href="#/path"><b>个性化学习路径</b></a> 查看。</div>';
      },
    });
  }

  /* ---------- 前置领域测评 ---------- */
  function pagePrereqQuiz(domainId) {
    const domain = D.domains.find((d) => d.id === domainId);
    const qsAll = D.prereqQuestions.filter((q) => q.domainId === domainId);
    if (!domain || !qsAll.length) { app.innerHTML = '<div class="card">测评不存在。</div>'; return; }
    runQuiz({
      title: "前置知识测评 · " + domain.name,
      questions: qsAll,
      onAnswer: (q, correct) => Store.bumpDomainMastery(domainId, correct),
      backHash: "#/path",
      onFinish: (r) => {
        const score = Store.getDomainMastery()[domainId].score;
        qs("#finish-extra").innerHTML =
          '<div class="note ' + (score >= 60 ? "note-green" : "note-amber") + '">' +
          "当前「" + esc(domain.name) + "」掌握度评估为 <b>" + score + " 分</b>。" +
          (score >= 60 ? "已达标，可正常学习相关章节。" : "存在缺口，建议在相关章节学习前阅读补习讲义。") +
          ' <a href="#/path">返回学习路径</a></div>';
      },
    });
  }

  /* ================= 页面：学习仪表盘 ================= */
  function pageDashboard() {
    const attempts = Store.getAttempts();
    const correct = attempts.filter((a) => a.correct).length;
    const path = learningPath();
    const doneCount = path.filter((i) => i.state === "done").length;
    const masteryVals = path.map((i) => i.mastery).filter((v) => v !== null);
    const avgMastery = masteryVals.length ? Math.round(masteryVals.reduce((a, b) => a + b, 0) / masteryVals.length) : 0;

    const rows = D.chapters.map((ch) => {
      const atts = attempts.filter((a) => a.chapterId === ch.id);
      const corr = atts.filter((a) => a.correct).length;
      const m = chapterMastery(ch.id);
      const lessons = lessonsOf(ch.id).length;
      const read = ((Store.getProgress()[ch.id] || {}).lessonsRead || []).length;
      return { ch, m, acc: atts.length ? Math.round((corr / atts.length) * 100) : null, n: atts.length, read, lessons };
    });

    app.innerHTML =
      '<div class="grid grid-4">' +
      '<div class="card"><div class="stat-num">' + doneCount + ' / 12</div><div class="muted">已完成章节</div></div>' +
      '<div class="card"><div class="stat-num">' + attempts.length + '</div><div class="muted">累计答题</div></div>' +
      '<div class="card"><div class="stat-num">' + (attempts.length ? Math.round((correct / attempts.length) * 100) + "%" : "—") + '</div><div class="muted">练习正确率</div></div>' +
      '<div class="card"><div class="stat-num">' + (masteryVals.length ? avgMastery + "%" : "—") + '</div><div class="muted">平均知识点掌握度</div></div>' +
      "</div>" +
      '<div class="card"><h2>各章掌握度 vs 练习正确率</h2>' +
      '<div class="row" style="margin-bottom:10px">' +
      '<span class="tag">绿：知识点掌握度</span><span class="tag tag-blue">蓝：练习正确率</span></div>' +
      '<canvas id="radar" width="640" height="480" style="max-width:100%;margin:0 auto;display:block"></canvas></div>' +
      '<div class="card"><h2>分章明细</h2>' +
      '<table class="md-table"><thead><tr><th>章节</th><th>讲义进度</th><th>知识点掌握度</th><th>答题数</th><th>练习正确率</th></tr></thead><tbody>' +
      rows.map((r) =>
        "<tr><td><a href='#/chapter/" + r.ch.code + "'>第 " + r.ch.sortOrder + " 章 " + esc(r.ch.title) + "</a></td>" +
        "<td>" + r.read + " / " + r.lessons + "</td>" +
        "<td>" + (r.m !== null ? r.m + "%" : "—") + "</td>" +
        "<td>" + r.n + "</td>" +
        "<td>" + (r.acc !== null ? r.acc + "%" : "—") + "</td></tr>"
      ).join("") + "</tbody></table></div>";

    drawRadar(qs("#radar"),
      D.chapters.map((c) => c.sortOrder),
      rows.map((r) => (r.m === null ? 0 : r.m)),
      rows.map((r) => (r.acc === null ? 0 : r.acc)));
  }

  /* ---------- 手绘雷达图（无外部依赖） ---------- */
  function drawRadar(canvas, labels, seriesA, seriesB) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2 + 8, R = Math.min(W, H) / 2 - 60;
    const n = labels.length;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, v) => [cx + Math.cos(angle(i)) * R * (v / 100), cy + Math.sin(angle(i)) * R * (v / 100)];
    ctx.clearRect(0, 0, W, H);
    // 网格
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const v = ring * 25, [x, y] = pt(i % n, v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#e5e7eb"; ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, 100);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = "#eef0f1"; ctx.stroke();
      const [lx, ly] = pt(i, 118);
      ctx.fillStyle = "#6b7280"; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("第" + labels[i] + "章", lx, ly + 4);
    }
    const drawSeries = (vals, color, fill) => {
      ctx.beginPath();
      vals.forEach((v, i) => {
        const [x, y] = pt(i, v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.lineWidth = 1;
    };
    drawSeries(seriesB, "#2563eb", "rgba(37,99,235,.10)");
    drawSeries(seriesA, "#059669", "rgba(5,150,105,.16)");
  }

  /* ================= 页面：AI 助教 ================= */
  function pageChat() {
    const msgs = Store.getChat();
    app.innerHTML =
      '<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:12px">' +
      "<h2>🤖 AI 助教 · NLP 学伴</h2>" +
      (window.Kimi.isConfigured()
        ? tag("Kimi API 已连接")
        : '<a href="#/settings">' + tag("未配置 API Key，点击前往设置", "tag-amber") + "</a>") +
      "</div>" +
      '<div class="chat-box" id="chat-box"></div>' +
      '<div class="chat-input">' +
      '<textarea id="chat-in" placeholder="向助教提问，如：解释一下 Transformer 的自注意力机制…（Enter 发送，Shift+Enter 换行）"></textarea>' +
      '<button id="chat-send" class="btn btn-primary">发送</button></div>' +
      '<div class="muted" style="margin-top:8px">回答由 Kimi 大模型生成；你的 API Key 仅保存在本机浏览器，请求直接发往 api.moonshot.cn。</div></div>';

    const box = qs("#chat-box");
    function paint() {
      box.innerHTML = msgs.length
        ? msgs.map((m) =>
            '<div class="msg ' + (m.role === "user" ? "user" : "ai") + '">' +
            (m.role === "user" ? esc(m.content) : MD.render(m.content)) + "</div>"
          ).join("")
        : '<div class="muted" style="text-align:center;padding:30px 0">你好！我是课程智能助教，关于自然语言处理的任何问题都可以问我。</div>';
      box.scrollTop = box.scrollHeight;
    }
    paint();

    async function send() {
      const ta = qs("#chat-in");
      const text = ta.value.trim();
      if (!text) return;
      if (!window.Kimi.isConfigured()) {
        alert("请先到「设置」页填写 Kimi API Key。");
        location.hash = "#/settings";
        return;
      }
      msgs.push({ role: "user", content: text });
      ta.value = "";
      paint();
      const sendBtn = qs("#chat-send");
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span class="spin" style="border-color:rgba(255,255,255,.4);border-top-color:#fff"></span>思考中';
      try {
        const reply = await window.Kimi.chat(msgs);
        msgs.push({ role: "assistant", content: reply });
      } catch (e) {
        msgs.push({ role: "assistant", content: "⚠ " + e.message });
      }
      Store.saveChat(msgs.slice(-40));
      sendBtn.disabled = false;
      sendBtn.textContent = "发送";
      paint();
    }
    qs("#chat-send").addEventListener("click", send);
    qs("#chat-in").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  /* ================= 页面：设置 ================= */
  function pageSettings() {
    const key = Store.getApiKey();
    app.innerHTML =
      '<div class="card"><h2>Kimi API 设置</h2>' +
      '<div class="note note-blue" style="margin-bottom:6px">本地版没有服务器，AI 功能由浏览器直接调用 Kimi（Moonshot）API。请在下方填入<b>你自己的</b> API Key（可在 platform.moonshot.cn 申请）。Key 仅保存在本机浏览器 localStorage 中，不会发送到任何第三方服务器。</div>' +
      '<label class="f-label">API Key</label>' +
      '<input id="api-key" class="input" type="password" placeholder="sk-..." value="' + esc(key) + '" />' +
      '<div class="row" style="margin-top:12px">' +
      '<button id="save-key" class="btn btn-primary">保存</button>' +
      '<span class="muted">当前模型：kimi-k2.6 · 接口：https://api.moonshot.cn/v1</span></div></div>' +
      '<div class="card"><h2>学习数据管理</h2>' +
      '<div class="muted" style="margin-bottom:12px">学习画像、掌握度、答题记录、AI 讲义缓存均保存在本机浏览器中。</div>' +
      '<div class="row">' +
      '<button id="export-data" class="btn">导出学习数据（JSON）</button>' +
      '<button id="reset-data" class="btn" style="color:#dc2626;border-color:#fecaca">清空学习数据</button>' +
      "</div></div>" +
      '<div class="card"><h2>关于本地版</h2><div class="muted" style="line-height:2">' +
      "· 全部课程数据存放于 data/ 文件夹（JS 数据文件），课件 PDF 存放于 courseware/ 文件夹；<br>" +
      "· 双击 index.html 即可使用，无需安装任何软件、无需联网（AI 功能除外）；<br>" +
      "· 学习记录存于浏览器 localStorage，更换浏览器或清理缓存会丢失，可先「导出学习数据」备份。</div></div>";

    qs("#save-key").addEventListener("click", () => {
      Store.setApiKey(qs("#api-key").value.trim());
      alert("已保存。AI 助教与个性化指导功能已" + (qs("#api-key").value.trim() ? "启用" : "停用") + "。");
    });
    qs("#export-data").addEventListener("click", () => {
      const data = {};
      ["profile", "kpMastery", "domainMastery", "progress", "attempts", "guides", "chat"].forEach((k) => {
        data[k] = Store["get" + k[0].toUpperCase() + k.slice(1)]
          ? Store["get" + k[0].toUpperCase() + k.slice(1)]()
          : null;
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "nlp学习数据_" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
    });
    qs("#reset-data").addEventListener("click", () => {
      if (confirm("确定清空本机保存的全部学习数据？此操作不可恢复。")) {
        Store.resetAll();
        alert("已清空。");
        location.hash = "#/";
      }
    });
  }

  /* ================= 路由 ================= */
  function route() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const seg = hash.split("/").filter(Boolean);
    qsa("#nav-links a").forEach((a) => {
      const r = a.dataset.route;
      a.classList.toggle("active", r === "/" ? seg.length === 0 : "/" + seg[0] === r);
    });
    window.scrollTo(0, 0);
    if (seg.length === 0) return pageHome();
    if (seg[0] === "chapters") return pageChapters();
    if (seg[0] === "chapter") return pageChapter(seg[1]);
    if (seg[0] === "practice") return pagePractice(seg[1]);
    if (seg[0] === "path") return pagePath(seg[1], seg[2]);
    if (seg[0] === "dashboard") return pageDashboard();
    if (seg[0] === "chat") return pageChat();
    if (seg[0] === "settings") return pageSettings();
    pageHome();
  }
  window.addEventListener("hashchange", route);
  route();
})();
