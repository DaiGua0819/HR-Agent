const { clipText, parseMaybeJsonObject, safeArray, uniqStrings } = require("./utils");
const { summarizeResume } = require("./questionGenerator");

const EVALUATION_VERSION = "v2_qa_evidence";
const SKILL_EVALUATION_TEMPLATE_URL =
  process.env.FEISHU_SKILL_EVALUATION_TEMPLATE_URL ||
  "https://rnftvujbd6.feishu.cn/docx/OGw0d6cT9o5LDXxdbePccZSgnwd";
const SIGNALS = new Set(["强", "中", "弱", "风险", "未回答"]);
const RECOMMENDATIONS = new Set(["通过", "淘汰", "补问", "待复核"]);

function normalizeSignal(value) {
  const text = String(value || "").trim();
  if (SIGNALS.has(text)) return text;
  if (/强|优秀|通过|明确/.test(text)) return "强";
  if (/风险|不符|存疑|矛盾/.test(text)) return "风险";
  if (/弱|不足|欠缺/.test(text)) return "弱";
  if (/未回答|没回答|无回答|缺失/.test(text)) return "未回答";
  return text ? "中" : "未回答";
}

function normalizeRecommendation(value) {
  const text = String(value || "").trim();
  if (RECOMMENDATIONS.has(text)) return text;
  if (/通过|推荐|进入/.test(text)) return "通过";
  if (/淘汰|不通过|拒绝/.test(text)) return "淘汰";
  if (/补问|追问|二次确认/.test(text)) return "补问";
  return "待复核";
}

function normalizeEvidenceQuotes(value) {
  return uniqStrings(safeArray(value).map((item) => clipText(item, 120)), 3);
}

function sourceRefsFromSource(source = {}) {
  return safeArray(source.sources)
    .slice(0, 5)
    .map((item) => ({
      type: item.type || "",
      id: item.id || "",
      url: item.url || "",
    }))
    .filter((item) => item.type || item.id || item.url);
}

function questionFallbackRows(session = {}, source = {}) {
  return safeArray(session.questionSet?.questions).slice(0, 10).map((item, index) => ({
    questionId: item.id || `q${index + 1}`,
    ability: clipText(item.ability || "能力项", 80),
    question: clipText(item.question || "", 500),
    expectedSignal: clipText(item.strongSignal || "", 300),
    answerSummary: source.rawTextLength ? "已读取面试记录，但需要人工复核该问题的回答。" : "未读取到有效面试回答。",
    evidenceQuotes: [],
    signal: source.rawTextLength ? "中" : "未回答",
    reason: source.rawTextLength ? "模型未能完成该问题的结构化判断。" : "飞书来源未返回有效回答文本。",
    followUpSuggestion: safeArray(item.followUps)[0] || "",
    answered: false,
    sourceRefs: sourceRefsFromSource(source),
  }));
}

function fallbackEvaluation({ resume = {}, session = {}, interviewText = "", source = {}, reason = "" } = {}) {
  const hasText = Boolean(String(interviewText || "").trim());
  const sourceSummary = {
    types: safeArray(source.types),
    rawTextLength: Number(source.rawTextLength || String(interviewText || "").length || 0),
    linkedDocIds: safeArray(source.linkedDocIds),
    minuteTokens: safeArray(source.minuteTokens),
    sources: safeArray(source.sources),
    errors: safeArray(source.errors),
  };
  const qaEvidence = questionFallbackRows(session, sourceSummary);
  const evaluation = {
    version: EVALUATION_VERSION,
    generatedAt: new Date().toISOString(),
    sourceType: "fallback",
    error: reason,
    candidateName: resume.name || session.matchedResume?.name || "",
    targetRole: resume.jobType || session.matchedResume?.jobType || "",
    overallRecommendation: "待复核",
    summary: hasText ? "已读取飞书面试记录，但系统未能完成结构化判断，请人工复核。" : "未读取到有效面试回答，请回到飞书确认纪要或手动重新回灌。",
    strengths: [],
    risks: hasText ? ["AI 结构化回灌失败"] : ["缺少有效面试记录"],
    nextAction: hasText ? "人工查看飞书原文并复核。" : "确认飞书会议纪要/文档是否生成后重新回灌。",
    qaEvidence,
    abilityProfile: qaEvidence.map((item) => ({
      ability: item.ability,
      evidenceFromResume: "",
      question: item.question,
      answerSummary: item.answerSummary,
      signal: item.signal,
      reason: item.reason,
      followUp: item.followUpSuggestion,
    })),
    source: sourceSummary,
    review: {
      status: "pending",
      decision: "",
      note: "",
      reviewedAt: "",
    },
    suggestedRuleChanges: [],
    humanReviewRequired: true,
  };
  return evaluation;
}

function normalizeQaEvidence(value, session = {}, source = {}) {
  const questions = safeArray(session.questionSet?.questions);
  const sourceRefs = sourceRefsFromSource(source);
  const rows = safeArray(value).slice(0, 12).map((item, index) => {
    const question = questions[index] || {};
    const signal = normalizeSignal(item.signal);
    return {
      questionId: clipText(item.questionId || item.question_id || question.id || `q${index + 1}`, 80),
      ability: clipText(item.ability || question.ability || "能力项", 80),
      question: clipText(item.question || question.question || "", 500),
      expectedSignal: clipText(item.expectedSignal || item.expected_signal || question.strongSignal || "", 300),
      answerSummary: clipText(item.answerSummary || item.answer_summary || "", 700),
      evidenceQuotes: normalizeEvidenceQuotes(item.evidenceQuotes || item.evidence_quotes || item.quotes),
      signal,
      reason: clipText(item.reason || "", 700),
      followUpSuggestion: clipText(item.followUpSuggestion || item.follow_up_suggestion || item.followUp || item.follow_up || "", 500),
      answered: item.answered === false ? false : signal !== "未回答",
      sourceRefs: safeArray(item.sourceRefs || item.source_refs).length ? safeArray(item.sourceRefs || item.source_refs).slice(0, 5) : sourceRefs,
    };
  });
  if (rows.length) return rows;
  return questionFallbackRows(session, source);
}

function normalizeEvaluation(value, fallback, { session = {}, source = {} } = {}) {
  const parsed = value && typeof value === "object" ? value : null;
  if (!parsed) return fallback;
  const qaEvidence = normalizeQaEvidence(parsed.qaEvidence || parsed.qa_evidence || parsed.abilityProfile || parsed.ability_profile, session, source);
  const recommendation = normalizeRecommendation(parsed.overallRecommendation || parsed.overall_recommendation || fallback.overallRecommendation);
  return {
    version: EVALUATION_VERSION,
    generatedAt: new Date().toISOString(),
    sourceType: parsed.sourceType || parsed.source || "gpt",
    candidateName: clipText(parsed.candidateName || parsed.candidate_name || fallback.candidateName || "", 80),
    targetRole: clipText(parsed.targetRole || parsed.target_role || fallback.targetRole || "", 120),
    overallRecommendation: recommendation,
    summary: clipText(parsed.summary || parsed.reason || fallback.summary || "", 1200),
    strengths: safeArray(parsed.strengths || parsed.advantages).map((item) => clipText(item, 260)).filter(Boolean).slice(0, 8),
    risks: safeArray(parsed.risks || parsed.riskSignals || parsed.risk_signals).map((item) => clipText(item, 260)).filter(Boolean).slice(0, 8),
    nextAction: clipText(parsed.nextAction || parsed.next_action || "", 500),
    qaEvidence,
    abilityProfile: qaEvidence.map((item) => ({
      ability: item.ability,
      evidenceFromResume: "",
      question: item.question,
      answerSummary: item.answerSummary,
      signal: item.signal,
      reason: item.reason,
      followUp: item.followUpSuggestion,
    })),
    source: {
      types: safeArray(source.types),
      rawTextLength: Number(source.rawTextLength || 0),
      linkedDocIds: safeArray(source.linkedDocIds),
      minuteTokens: safeArray(source.minuteTokens),
      sources: safeArray(source.sources),
      errors: safeArray(source.errors),
    },
    review: {
      status: "pending",
      decision: "",
      note: "",
      reviewedAt: "",
    },
    suggestedRuleChanges: safeArray(parsed.suggestedRuleChanges || parsed.suggested_rule_changes)
      .map((item) => (typeof item === "string" ? clipText(item, 800) : clipText(JSON.stringify(item), 800)))
      .filter(Boolean)
      .slice(0, 12),
    humanReviewRequired: true,
  };
}

function formatList(items = [], fallback = "暂无明确内容") {
  const values = safeArray(items)
    .map((item) => clipText(item, 260))
    .filter(Boolean);
  if (!values.length) return [`- ${fallback}`];
  return values.map((item) => `- ${item}`);
}

function formatQaEvidenceRows(items = []) {
  const rows = safeArray(items);
  if (!rows.length) return ["- 暂无结构化问答证据，需要人工复核飞书会议纪要。"];
  return rows.flatMap((item, index) => {
    const evidence = normalizeEvidenceQuotes(item.evidenceQuotes || item.evidence_quotes || item.quotes);
    return [
      `### ${index + 1}. ${item.ability || "能力项"}｜${item.signal || "未回答"}`,
      `面试官问题：${item.question || "-"}`,
      `候选人回答摘要：${item.answerSummary || "-"}`,
      `判断依据：${item.reason || "-"}`,
      `证据短句：${evidence.length ? evidence.join("；") : "-"}`,
      `后续建议：${item.followUpSuggestion || item.followUp || "-"}`,
      "",
    ];
  });
}

function dateTextFromSession(session = {}) {
  const seconds = Number(session.startTime || session.endTime || 0);
  const date = seconds ? new Date(seconds * 1000) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scoreFromSignal(signal = "") {
  const text = String(signal || "");
  if (text.includes("强")) return "7.5";
  if (text.includes("风险") || text.includes("弱")) return "6.2";
  if (text.includes("未回答")) return "待复核";
  return "7.0";
}

function qaTypeFromAbility(ability = "", question = "") {
  const text = `${ability} ${question}`;
  if (/动机|规划|稳定|适配|表达|沟通|协作|复盘|owner/i.test(text)) return "behavior";
  if (/技术|项目|rag|agent|python|工程|系统|接口|权限|检索|模型|部署|数据|架构/i.test(text)) return "technical";
  return "technical";
}

function tableRow(values = []) {
  return values.map((value) => clipText(value || "-", 220)).join(" | ");
}

function formatBehaviorTable(rows = []) {
  const items = rows.length ? rows : [];
  return [
    tableRow(["问题（简写）", "类型", "想测什么", "候选人回答摘要", "有效证据", "不足/风险", "是否追问到位"]),
    tableRow(["---", "---", "---", "---", "---", "---", "---"]),
    ...items.map((item) =>
      tableRow([
        item.question || item.ability || "行为问题",
        item.ability || "履历/动机核验",
        item.expectedSignal || "求职动机、职业规划、岗位适配度",
        item.answerSummary || "-",
        safeArray(item.evidenceQuotes)[0] || item.reason || "-",
        item.signal === "风险" || item.signal === "弱" ? item.reason || "存在待确认风险" : item.followUpSuggestion || "仍需结合后续问题验证",
        item.answered === false ? "未回答" : "基本到位",
      ])
    ),
  ];
}

function formatTechnicalTable(rows = []) {
  const items = rows.length ? rows : [];
  return [
    tableRow(["问题（简写）", "类型", "想测什么", "回答摘要", "真实信号", "薄弱信号", "追问是否到位", "单题评分"]),
    tableRow(["---", "---", "---", "---", "---", "---", "---", "---"]),
    ...items.map((item) =>
      tableRow([
        item.question || item.ability || "技术问题",
        item.ability || "技术核验",
        item.expectedSignal || "岗位核心能力与项目真实性",
        item.answerSummary || "-",
        safeArray(item.evidenceQuotes)[0] || item.reason || "-",
        item.signal === "风险" || item.signal === "弱" ? item.reason || "深度不足或证据不充分" : item.followUpSuggestion || "指标化和边界场景仍需补问",
        item.answered === false ? "未回答" : "基本到位",
        scoreFromSignal(item.signal),
      ])
    ),
  ];
}

function abilityScoreRows(evaluation = {}) {
  const qa = safeArray(evaluation.qaEvidence);
  const technical = qa.filter((item) => qaTypeFromAbility(item.ability, item.question) === "technical");
  const behavior = qa.filter((item) => qaTypeFromAbility(item.ability, item.question) === "behavior");
  const avgSignal = (rows) => {
    if (!rows.length) return "7.0";
    const scores = rows.map((item) => Number(scoreFromSignal(item.signal))).filter(Number.isFinite);
    if (!scores.length) return "待复核";
    return (scores.reduce((sum, item) => sum + item, 0) / scores.length).toFixed(1);
  };
  return [
    ["自我表达", avgSignal(behavior), "能围绕经历、动机和诉求展开表达", "结合面试官复核调整"],
    ["结构化思考", avgSignal(qa), "能按问题拆解回答并给出部分依据", "关注是否有指标、边界和复盘"],
    ["ownership", avgSignal(behavior), "从经历中提取主动性和问题意识", "需要结合具体项目追问"],
    ["岗位匹配", evaluation.overallRecommendation === "通过" ? "7.4" : "7.0", evaluation.summary || "岗位匹配度待复核", "以最终人工复核为准"],
    ["智能体/RAG工程能力", avgSignal(technical), "从项目链路、工具使用和工程细节判断", "重点看真实实现深度"],
    ["系统治理能力", avgSignal(technical.filter((item) => /权限|安全|治理|异常|稳定|部署/i.test(`${item.ability} ${item.question}`))), "从权限、异常、监控和边界意识判断", "没有追问时应补测"],
    ["协作/复盘能力", avgSignal(behavior), "从复盘、沟通和学习方式判断", "建议下一轮继续验证"],
    ["稳定性", avgSignal(behavior), "从工作条件接受度和长期规划判断", "对实习时长/节奏需明确确认"],
  ];
}

function formatSkillEvaluationDocumentText({ resume = {}, session = {}, evaluation = {} } = {}) {
  const source = evaluation.source || session.backfillSource || {};
  const candidateName = evaluation.candidateName || resume.name || session.matchedResume?.name || "候选人";
  const dateText = dateTextFromSession(session);
  const qa = safeArray(evaluation.qaEvidence);
  const behaviorRows = qa.filter((item) => qaTypeFromAbility(item.ability, item.question) === "behavior");
  const technicalRows = qa.filter((item) => qaTypeFromAbility(item.ability, item.question) === "technical");
  const behaviorItems = behaviorRows.length ? behaviorRows : qa.slice(0, 3);
  const technicalItems = technicalRows.length ? technicalRows : qa.slice(0, 6);
  const sourceTitle = source.sources?.[0]?.id ? `飞书会议纪要 ${source.sources[0].id}` : `${candidateName}初试（${dateText}）`;
  const scoreRows = abilityScoreRows(evaluation);
  const role = evaluation.targetRole || resume.jobType || session.matchedResume?.jobType || "目标岗位";
  const recommendation = evaluation.overallRecommendation || "待复核";
  const summary = evaluation.summary || "建议结合原始纪要进行人工复核。";
  const followUps = safeArray(evaluation.qaEvidence)
    .map((item) => item.followUpSuggestion)
    .filter(Boolean)
    .slice(0, 5);
  return [
    `# ${candidateName}初试总结-${dateText}`,
    "",
    `参考模板：${SKILL_EVALUATION_TEMPLATE_URL}`,
    "",
    `本报告基于《智能纪要：${sourceTitle}》生成，按照指定飞书技能评价模板输出。说明：当前依据为智能纪要/面试文档，涉及行为判断与技术评估已按证据强弱标注。`,
    "",
    "## 总结",
    summary,
    `- 初步结论：${role}（初试）${recommendation}`,
    `- 主要优势：${safeArray(evaluation.strengths).slice(0, 3).join("；") || "暂未形成明确优势，需要结合原始纪要复核。"}`,
    `- 主要风险：${safeArray(evaluation.risks).slice(0, 3).join("；") || "暂未形成明确风险，需要结合原始纪要复核。"}`,
    "",
    "## 公司与求职者基本情况",
    tableRow(["项目", "内容"]),
    tableRow(["---", "---"]),
    tableRow(["候选人", candidateName]),
    tableRow(["应聘岗位", role]),
    tableRow(["面试时间", dateText]),
    tableRow(["资料来源", sourceTitle]),
    tableRow(["当前建议", recommendation]),
    "",
    "## 项目技术交流",
    "### 技术与项目问题记录",
    ...formatTechnicalTable(technicalItems),
    "",
    "### 技术侧观察",
    ...formatList(evaluation.strengths, "暂未形成明确技术优势，需要继续结合面试原文复核。"),
    ...formatList(evaluation.risks, "暂未形成明确技术风险，需要继续结合面试原文复核。"),
    "",
    "## 公司相关问题交流",
    "### 动机、稳定性与匹配度记录",
    ...formatBehaviorTable(behaviorItems),
    "",
    "### 风险与待确认",
    ...formatList(evaluation.risks, "行为面暂未暴露明确风险，建议结合原始纪要复核。"),
    "",
    "## 初步评价",
    tableRow(["维度", "分数", "证据", "备注"]),
    tableRow(["---", "---", "---", "---"]),
    ...scoreRows.map(tableRow),
    "",
    "## 综合结论",
    `${role}（初试）：${recommendation}。${summary}`,
    `下一步建议：${evaluation.nextAction || "结合原始纪要和业务面需求进行人工复核。"}`,
    "",
    "## 下一轮重点追问",
    "### Behavior 题",
    "- 你为什么选择这个方向？什么条件会让你稳定投入？",
    "- 讲一个你自己解决问题、而不是主要靠别人或 AI 的案例。",
    "- 如果入职后节奏比预期更快，你会怎么调整？",
    "### 技术/业务场景题",
    ...(followUps.length ? followUps.map((item) => `- ${item}`) : ["- 选择一个真实项目，展开讲技术方案、关键取舍、失败场景和复盘结果。"]),
  ].join("\n");
}

async function generateInterviewEvaluation({ resume, session, interviewText, source = {}, gpt }) {
  const normalizedSource = {
    types: safeArray(source.types),
    rawTextLength: Number(source.rawTextLength || String(interviewText || "").length || 0),
    linkedDocIds: safeArray(source.linkedDocIds),
    minuteTokens: safeArray(source.minuteTokens),
    sources: safeArray(source.sources),
    errors: safeArray(source.errors),
  };
  const fallback = fallbackEvaluation({ resume, session, interviewText, source: normalizedSource });
  if (!String(interviewText || "").trim()) return fallbackEvaluation({ resume, session, interviewText, source: normalizedSource, reason: "未读取到有效面试记录" });
  if (!gpt?.callGptJson || !gpt?.makeAbortController) {
    return fallbackEvaluation({ resume, session, interviewText, source: normalizedSource, reason: "未配置模型能力" });
  }

  const { controller, timeoutId } = gpt.makeAbortController(gpt.timeoutMs || 180000);
  try {
    const content = await gpt.callGptJson(
      [
        {
          role: "system",
          content:
            "你是招聘面试回灌助手。你只能根据面试记录、问题包和简历证据生成结构化复核材料；不得做自动录用、定薪等最终决策。只返回 JSON。",
        },
        {
          role: "user",
          content: `候选人简历：\n${summarizeResume(resume)}\n\n面试问题包：\n${JSON.stringify(session.questionSet || {})}\n\n飞书面试记录/会议纪要：\n${String(interviewText || "").slice(0, 50000)}\n\n请按每个面试问题提取候选人的实际回答，返回 JSON：\n{\n  "candidateName": "",\n  "targetRole": "",\n  "overallRecommendation": "通过|淘汰|补问|待复核",\n  "summary": "",\n  "strengths": [],\n  "risks": [],\n  "nextAction": "",\n  "qaEvidence": [\n    {\n      "questionId": "",\n      "ability": "",\n      "question": "",\n      "expectedSignal": "",\n      "answerSummary": "",\n      "evidenceQuotes": ["每条不超过120字，最多3条"],\n      "signal": "强|中|弱|风险|未回答",\n      "reason": "",\n      "followUpSuggestion": "",\n      "answered": true\n    }\n  ],\n  "suggestedRuleChanges": []\n}\n\n要求：没有回答的问题必须标记 signal=未回答、answered=false；证据片段只截取短句，不要输出完整原文；规则建议只提出可复用的岗位评估改进。`,
        },
      ],
      controller.signal
    );
    return normalizeEvaluation(parseMaybeJsonObject(content), fallback, { session, source: normalizedSource });
  } catch (error) {
    return fallbackEvaluation({ resume, session, interviewText, source: normalizedSource, reason: error.message || "模型回灌失败" });
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  SKILL_EVALUATION_TEMPLATE_URL,
  generateInterviewEvaluation,
  fallbackEvaluation,
  formatSkillEvaluationDocumentText,
};
