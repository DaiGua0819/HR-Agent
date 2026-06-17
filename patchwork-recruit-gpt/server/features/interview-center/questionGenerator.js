const { clipText, parseMaybeJsonObject, safeArray, uniqStrings } = require("./utils");

function summarizeResume(resume = {}) {
  const projects = safeArray(resume.projects)
    .slice(0, 5)
    .map((item) => [item.name, item.role, item.description || item.evidence].filter(Boolean).join("："))
    .filter(Boolean);
  return [
    `姓名：${resume.name || "-"}`,
    `岗位：${resume.jobType || "-"}`,
    `学校：${resume.school || "-"} / ${resume.major || "-"} / ${resume.schoolLevel || "-"}`,
    `毕业：${resume.graduation || "-"}`,
    `匹配分：${resume.matchScore ?? "-"}`,
    `评分摘要：${resume.scoreBreakdown?.summary || "-"}`,
    `亮点：${safeArray(resume.scoreBreakdown?.strengths).join("；") || "-"}`,
    `风险：${safeArray(resume.scoreBreakdown?.risks).join("；") || "-"}`,
    `项目：${projects.join("；") || "-"}`,
  ].join("\n");
}

function summarizeConversation(conversation = {}) {
  const messages = safeArray(conversation.recentMessages || conversation.messages)
    .slice(-8)
    .map((message) => `${message.sender || ""}：${message.text || ""}`)
    .filter(Boolean);
  return clipText([conversation.summary || "", ...messages].filter(Boolean).join("\n"), 1800);
}

function fallbackQuestions({ resume = {}, conversation = {}, reason = "" } = {}) {
  const jobType = resume.jobType || "目标岗位";
  const risks = safeArray(resume.scoreBreakdown?.risks);
  const strengths = safeArray(resume.scoreBreakdown?.strengths);
  return {
    generatedAt: new Date().toISOString(),
    source: "fallback",
    error: reason,
    resumeSummary: summarizeResume(resume),
    chatSummary: summarizeConversation(conversation) || "暂无聊天摘要",
    questions: [
      {
        ability: "岗位动机与稳定性",
        resumeEvidence: `${jobType} 应聘记录`,
        question: `你为什么选择这个${jobType}岗位？你希望在前三个月做到什么结果？`,
        followUps: ["你对湖州长兴和单休节奏是否确认能接受？", "你之前换工作或实习选择的核心原因是什么？"],
        strongSignal: "能讲清岗位选择、地点/节奏接受度和短期目标。",
        riskSignal: "只表达试试看，或对地点、工作节奏、岗位任务没有明确认知。",
      },
      {
        ability: "经历真实性",
        resumeEvidence: strengths[0] || "简历项目/实习经历",
        question: "请选一个你简历里最能代表能力的项目，按背景、你的职责、具体动作、结果复盘讲一遍。",
        followUps: ["你个人负责的部分是什么？", "项目里最难的问题是怎么解决的？"],
        strongSignal: "能讲清个人贡献、关键决策、结果和复盘。",
        riskSignal: "只讲团队做了什么，个人动作和结果不清楚。",
      },
      {
        ability: "学习与执行",
        resumeEvidence: strengths[1] || "学习/项目经历",
        question: "如果入职第一周给你一个没人完整教过的任务，你会怎么拆解并推进？",
        followUps: ["你会如何确认需求边界？", "遇到卡点多久会反馈？"],
        strongSignal: "能主动拆目标、查资料、做最小版本、及时反馈。",
        riskSignal: "等待安排，或没有明确推进和反馈机制。",
      },
      {
        ability: "风险确认",
        resumeEvidence: risks[0] || "简历中需要进一步确认的信息",
        question: `我注意到你的简历里有一个需要确认的点：${risks[0] || "部分经历细节不够完整"}。你可以展开说明一下吗？`,
        followUps: ["这个情况对后续工作有什么影响？", "你后来怎么改进？"],
        strongSignal: "能正面解释事实，并说明改进动作。",
        riskSignal: "回避细节、前后说法不一致或全部归因外部。",
      },
      {
        ability: "沟通协作",
        resumeEvidence: "团队/项目/客户沟通经历",
        question: "讲一次你和同事、客户或老师意见不一致，但最后推动事情继续往前走的经历。",
        followUps: ["对方当时的核心诉求是什么？", "你做了哪些沟通动作？"],
        strongSignal: "能换位理解、澄清分歧、推动共识并有结果。",
        riskSignal: "只说服从或直接争论，没有结构化沟通动作。",
      },
      {
        ability: "岗位任务模拟",
        resumeEvidence: `${jobType}岗位任务`,
        question: "如果今天让你接手一个真实工作任务，你会先问哪三个问题，第一天交付什么？",
        followUps: ["怎么判断交付物是否合格？", "如果时间不够你怎么取舍？"],
        strongSignal: "能围绕目标、边界、资源、验收标准拆解。",
        riskSignal: "只描述努力做，没有明确交付和验收意识。",
      },
    ],
  };
}

function normalizeQuestionSet(value, fallback) {
  const parsed = value && typeof value === "object" ? value : null;
  if (!parsed || !Array.isArray(parsed.questions)) return fallback;
  return {
    generatedAt: new Date().toISOString(),
    source: parsed.source || "gpt",
    resumeSummary: clipText(parsed.resumeSummary || fallback.resumeSummary || "", 2500),
    chatSummary: clipText(parsed.chatSummary || fallback.chatSummary || "", 1800),
    questions: parsed.questions.slice(0, 10).map((item) => ({
      ability: clipText(item.ability || "能力项", 80),
      resumeEvidence: clipText(item.resumeEvidence || item.evidence_from_resume || "", 260),
      question: clipText(item.question || "", 500),
      followUps: uniqStrings(item.followUps || item.follow_up || [], 5),
      strongSignal: clipText(item.strongSignal || item.strong_signal || "", 500),
      riskSignal: clipText(item.riskSignal || item.risk_signal || "", 500),
    })),
  };
}

async function generateInterviewQuestions({ resume, conversation, scoringRules, gpt }) {
  const fallback = fallbackQuestions({ resume, conversation });
  if (!gpt?.callGptJson || !gpt?.makeAbortController) return fallback;

  const { controller, timeoutId } = gpt.makeAbortController(gpt.timeoutMs || 180000);
  try {
    const content = await gpt.callGptJson(
      [
        {
          role: "system",
          content:
            "你是招聘面试问题设计助手。你只能基于简历、聊天记录和岗位能力模型生成结构化面试问题，不做录用决定。只返回 JSON。",
        },
        {
          role: "user",
          content: `候选人简历摘要：\n${summarizeResume(resume)}\n\n聊天摘要：\n${summarizeConversation(conversation)}\n\n岗位评分/能力规则：\n${JSON.stringify(scoringRules || {})}\n\n请生成 6-8 个面试问题，覆盖岗位动机、经历真实性、岗位核心能力、风险确认和任务模拟。返回 JSON：\n{\n  "resumeSummary": "",\n  "chatSummary": "",\n  "questions": [\n    {\n      "ability": "",\n      "resumeEvidence": "",\n      "question": "",\n      "followUps": [],\n      "strongSignal": "",\n      "riskSignal": ""\n    }\n  ]\n}`,
        },
      ],
      controller.signal
    );
    return normalizeQuestionSet(parseMaybeJsonObject(content), fallback);
  } catch (error) {
    return fallbackQuestions({ resume, conversation, reason: error.message || "模型生成失败" });
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  generateInterviewQuestions,
  fallbackQuestions,
  summarizeResume,
  summarizeConversation,
};
