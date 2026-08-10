/* kimi.js — 浏览器直连 Kimi（Moonshot）大模型 API
 * API Key 由使用者在「设置」页自行填写，仅保存在本地浏览器 localStorage 中，
 * 不会上传到任何服务器（请求直接发往 api.moonshot.cn）。
 */
(function () {
  const BASE_URL = "https://api.moonshot.cn/v1";
  const MODEL = "kimi-k2.6";

  const SYSTEM_PROMPT = `你是中山大学人工智能学院《自然语言处理》课程的智能助教“NLP学伴”。
课程共12章：绪论、词汇分析、句法分析、语义分析、篇章分析、语言模型、信息抽取、机器翻译、文本分类与情感分析、智能问答、文本摘要、知识图谱。
请以专业、严谨且通俗易懂的方式解答学生关于自然语言处理的问题：
1. 回答紧扣课程内容，涉及概念时给出清晰定义与直观例子；
2. 涉及算法与模型（如Transformer、预训练语言模型、词向量等）时，分步骤解释其核心思想；
3. 鼓励学生动手实践，可适当给出学习建议与延伸阅读方向；
4. 使用中文回答，必要时可附英文术语；回答结构清晰，适度使用分点；
5. 如问题超出自然语言处理范畴，礼貌引导学生回到课程主题。`;

  const GUIDE_PROMPT = `你是中山大学人工智能学院《自然语言处理》课程的个性化教学设计助手。
你的任务：根据学生的前置知识掌握情况，为指定章节生成“个性化学习指导”，用中文 Markdown 输出。要求：
1. 开头用一句话概括本章与该学生基础的匹配情况；
2. 针对学生薄弱的前置知识域，指出本章哪些知识点会用到它，并做“补偿性讲解”——用通俗语言补充该前置知识的最小必要概念（配 1 个 NLP 场景的小例子），让学生能跟上本章主线；
3. 给出本章各节的“详略建议”：基础薄弱处建议精读、放慢，已掌握处可以快读；
4. 给出 2-3 条具体可操作的学习建议（例如先完成哪个补习讲义、做哪类练习）；
5. 篇幅控制在 600 字以内，语气温和鼓励，不要罗列课程大纲原文。`;

  async function callKimi(messages) {
    const apiKey = window.Store.getApiKey();
    if (!apiKey) {
      throw new Error("尚未填写 Kimi API Key。请先到「设置」页填入你的 API Key（仅保存在本地浏览器），即可启用 AI 功能。");
    }
    const resp = await fetch(BASE_URL + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({ model: MODEL, messages, max_tokens: 4096 }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      if (resp.status === 401) {
        throw new Error("API Key 无效或已过期，请到「设置」页检查更新（401）。");
      }
      throw new Error("Kimi API 调用失败（" + resp.status + "）：" + errText.slice(0, 200));
    }
    const data = await resp.json();
    const c = data.choices && data.choices[0] && data.choices[0].message;
    return (c && c.content && c.content.trim()) || "（助教暂时无法回答，请换个方式提问）";
  }

  function chat(history) {
    const messages = [{ role: "system", content: SYSTEM_PROMPT }].concat(history.slice(-20));
    return callKimi(messages);
  }

  // chapter: 章节对象；lessons: 本章讲义小节数组；weakDomains/strongDomains: 前置域情况
  function generateChapterGuide(chapter, lessons, weakDomains, strongDomains) {
    const digest = lessons
      .map((l) => "【" + l.sectionTitle + "】" + String(l.content).slice(0, 260))
      .join("\n")
      .slice(0, 3000);
    const weakText = weakDomains.length
      ? weakDomains.map((d) => d.name + "（掌握度 " + (d.score < 0 ? "未评估" : d.score + "%") + "）").join("、")
      : "无明显薄弱项";
    const userMsg =
      "章节：《" + chapter.title + "》\n" +
      "学生薄弱的前置知识域：" + weakText + "\n" +
      "学生掌握较好的前置知识域：" + (strongDomains.join("、") || "暂无评估数据") + "\n" +
      "本章内容摘要：\n" + digest;
    return callKimi([
      { role: "system", content: GUIDE_PROMPT },
      { role: "user", content: userMsg },
    ]);
  }

  window.Kimi = { chat, generateChapterGuide, isConfigured: () => Boolean(window.Store.getApiKey()) };
})();
