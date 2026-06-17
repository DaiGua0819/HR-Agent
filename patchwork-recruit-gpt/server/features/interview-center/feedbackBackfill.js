const { clipText, parseMaybeJsonObject, safeArray } = require("./utils");
const { summarizeResume } = require("./questionGenerator");

function fallbackEvaluation({ resume = {}, session = {}, interviewText = "", reason = "" } = {}) {
  const questions = safeArray(session.questionSet?.questions);
  const hasText = Boolean(String(interviewText || "").trim());
  return {
    generatedAt: new Date().toISOString(),
    source: "fallback",
    error: reason,
    candidateName: resume.name || session.matchedResume?.name || "",
    targetRole: resume.jobType || session.matchedResume?.jobType || "",
    abilityProfile: questions.slice(0, 8).map((item) => ({
      ability: item.ability || "能力项",
      evidenceFromResume: item.resumeEvidence || "",
      question: item.question || "",
      answerSummary: hasText ? "已读取面试记录，模型评估失败，需人工复核原文。" : "暂无可回灌的面试记录。",
      signal: hasText ? "待复核" : "风险",
      reason: hasText ? "系统未能完成结构化评分。" : "未读取到飞书文档记录或会议纪要。",
      followUp: safeArray(item.followUps)[0] || "",
    })),
    overallRecommendation: "待复核",
    summary: hasText ? "已读取面试原文，但需要人工复核。" : "未读取到有效面试内容。",
    risks: hasText ? ["AI 结构化回灌失败"] : ["缺少面试记录"],
    suggestedRuleChanges: [],
    humanReviewRequired: true,
  };
}

function normalizeEvaluation(value, fallback) {
  const parsed = value && typeof value === "object" ? value : null;
  if (!parsed) return fallback;
  const profile = safeArray(parsed.abilityProfile || parsed.ability_profile).map((item) => ({
    ability: clipText(item.ability || "", 80),
    evidenceFromResume: clipText(item.evidenceFromResume || item.evidence_from_resume || "", 400),
    question: clipText(item.question || "", 500),
    answerSummary: clipText(item.answerSummary || item.answer_summary || "", 700),
    signal: clipText(item.signal || "待复核", 30),
    reason: clipText(item.reason || "", 700),
    followUp: clipText(item.followUp || item.follow_up || "", 500),
  }));
  return {
    generatedAt: new Date().toISOString(),
    source: parsed.source || "gpt",
    candidateName: clipText(parsed.candidateName || parsed.candidate_name || fallback.candidateName || "", 80),
    targetRole: clipText(parsed.targetRole || parsed.target_role || fallback.targetRole || "", 120),
    abilityProfile: profile.length ? profile : fallback.abilityProfile,
    overallRecommendation: clipText(parsed.overallRecommendation || parsed.overall_recommendation || "待复核", 40),
    summary: clipText(parsed.summary || parsed.reason || fallback.summary || "", 1200),
    risks: safeArray(parsed.risks || parsed.riskSignals || parsed.risk_signals).map((item) => clipText(item, 260)).filter(Boolean),
    suggestedRuleChanges: safeArray(parsed.suggestedRuleChanges || parsed.suggested_rule_changes)
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .filter(Boolean)
      .slice(0, 12),
    humanReviewRequired: true,
  };
}

async function generateInterviewEvaluation({ resume, session, interviewText, gpt }) {
  const fallback = fallbackEvaluation({ resume, session, interviewText });
  if (!String(interviewText || "").trim()) return fallback;
  if (!gpt?.callGptJson || !gpt?.makeAbortController) return fallbackEvaluation({ resume, session, interviewText, reason: "未配置模型能力" });

  const { controller, timeoutId } = gpt.makeAbortController(gpt.timeoutMs || 180000);
  try {
    const content = await gpt.callGptJson(
      [
        {
          role: "system",
          content:
            "你是招聘面试回灌助手。你只能根据面试记录、问题包和简历证据生成能力评估与规则建议；不得做自动录用、淘汰、定薪等最终决策。只返回 JSON。",
        },
        {
          role: "user",
          content: `候选人简历：\n${summarizeResume(resume)}\n\n面试问题包：\n${JSON.stringify(session.questionSet || {})}\n\n飞书面试记录/会议纪要：\n${String(interviewText || "").slice(0, 50000)}\n\n请返回 JSON：\n{\n  "candidateName": "",\n  "targetRole": "",\n  "abilityProfile": [\n    {\n      "ability": "",\n      "evidenceFromResume": "",\n      "question": "",\n      "answerSummary": "",\n      "signal": "强|中|弱|风险|待复核",\n      "reason": "",\n      "followUp": ""\n    }\n  ],\n  "overallRecommendation": "通过|待复核|淘汰|补问",\n  "summary": "",\n  "risks": [],\n  "suggestedRuleChanges": [],\n  "humanReviewRequired": true\n}\n\n注意：如果面试记录没有回答某个问题，要标记待复核或补问；规则建议只提出可复用的岗位评估改进，不要因为单个候选人过拟合。`,
        },
      ],
      controller.signal
    );
    return normalizeEvaluation(parseMaybeJsonObject(content), fallback);
  } catch (error) {
    return fallbackEvaluation({ resume, session, interviewText, reason: error.message || "模型回灌失败" });
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  generateInterviewEvaluation,
  fallbackEvaluation,
};
