const { clipText, parseMaybeJsonObject, safeArray, uniqStrings } = require("./utils");
const { summarizeResume } = require("./questionGenerator");

const EVALUATION_VERSION = "v2_qa_evidence";
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
  generateInterviewEvaluation,
  fallbackEvaluation,
};
