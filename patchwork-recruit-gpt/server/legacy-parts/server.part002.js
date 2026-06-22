    .replace(/^\d+\s+/, "")
    .replace(/^\d{1,2}[:：]\d{2}\s+/, "")
    .trim();
  const token = stripped.split(/\s+/)[0] || "";
  return cleanAutomationCandidateName(token);
}

function automationCandidateNameFromFilename(filename = "") {
  const base = path.basename(String(filename || ""), path.extname(String(filename || "")));
  const token = base.split(/[_\s-]+/)[0] || "";
  return cleanAutomationCandidateName(token);
}

function automationEmailCandidateNameFromFilename(filename = "") {
  const base = path.basename(String(filename || ""), path.extname(String(filename || "")));
  const withoutPrefix = base.replace(/^邮箱_\d+_/, "");
  const bracketMatch = withoutPrefix.match(/[】\]]([^_]+)(?:_|$)/);
  const token = bracketMatch?.[1] || withoutPrefix.split(/[_\s-]+/).filter(Boolean).at(-2) || "";
  return cleanAutomationCandidateName(token);
}

function resolveAutomationCandidateName(...values) {
  for (const value of values) {
    const name = cleanAutomationCandidateName(value);
    if (name) return name;
  }
  return "";
}

function normalizeAutomationPhone(value = "") {
  const text = String(value || "");
  const mobile = text.match(/(?:\+?86[\s-]?)?(1[3-9]\d{9})/);
  if (mobile) return mobile[1];
  const masked = text.match(/(?:\+?86[\s-]?)?(1[3-9]\d[\d*]{4}\d{4})/);
  return masked ? masked[1] : "";
}

function automationRecordPhoneKey(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const counterpart = record.conversation?.counterpart || {};
  const candidates = [
    record.phone,
    record.mobile,
    record.candidatePhone,
    record.contactPhone,
    current.phone,
    current.mobile,
    current.candidatePhone,
    current.contactPhone,
    current.telephone,
    current.replyTarget?.phone,
    current.replyTarget?.mobile,
    current.resume?.phone,
    current.resume?.mobile,
    current.profile?.phone,
    current.profile?.mobile,
    current.candidate?.phone,
    current.candidate?.mobile,
    counterpart.phone,
    counterpart.mobile,
  ];
  for (const value of candidates) {
    const phone = normalizeAutomationPhone(value);
    if (phone) return phone;
  }
  return "";
}

function automationRecordNameKey(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const rawName = resolveAutomationCandidateName(
    record.candidateName,
    current.candidateName,
    current.name,
    current.replyTarget?.candidateName,
    record.conversation?.counterpart?.name,
    automationCandidateNameFromLabel(record.candidateLabel || record.conversation?.counterpart?.rawHeader || "", record.appliedPosition),
    automationCandidateNameFromLabel(record.phrase || "", record.appliedPosition)
  );
  return normalizeAutomationName(rawName);
}

function automationRecordJobKey(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const rawJob = String(
    record.appliedPosition ||
      current.appliedPosition ||
      current.position ||
      current.job ||
      current.replyTarget?.appliedPosition ||
      record.conversation?.counterpart?.appliedPosition ||
      record.conversation?.counterpart?.role ||
      ""
  ).trim();
  return (normalizeJobType(rawJob) || rawJob).trim().toLowerCase();
}

function automationRecordPersonKey(record = {}) {
  const phone = automationRecordPhoneKey(record);
  if (phone) return `phone:${phone}`;
  const name = automationRecordNameKey(record);
  const job = automationRecordJobKey(record);
  const platform = normalizeAutomationPlatformId(record.platform || automationPlatformFromValue(record.sourceKey || record.source || "", "boss"));
  if (name) return `name:${name}|job:${job || "unknown"}|platform:${platform}`;
  const current = record.conversation?.currentRecord || {};
  const conversationKey = String(current.conversationKey || record.conversationKey || "").trim();
  if (conversationKey) return `conversation:${conversationKey}`;
  const resumeFile = (record.resumeFiles || []).map((file) => file.fileName).filter(Boolean).join("|");
  if (resumeFile) return `resume:${resumeFile}`;
  return `fallback:${normalizeAutomationName(record.candidateLabel || record.phrase || record.id || "")}`;
}

function automationRecordHasCandidateIdentity(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const explicitName = resolveAutomationCandidateName(
    record.candidateName,
    current.candidateName,
    current.name,
    current.replyTarget?.candidateName,
    record.conversation?.counterpart?.name
  );
  return Boolean(automationRecordPhoneKey(record) || normalizeAutomationName(explicitName));
}

function automationSourceKeyFromFilename(filename = "") {
  const text = String(filename || "").toLowerCase();
  if (/job51_b|51_b|51_和新红|和新红.*51/.test(text)) return "job51_b";
  if (/job51_a|51_a|51_宋峰峰|51_宋锋峰|boss_a_宋峰峰|boss_a_boss_a|宋峰峰.*51|宋锋峰.*51/.test(text)) return "job51_a";
  if (/51job|job51|51-resumes|前程/.test(text)) return "job51_unknown";
  if (/zhilian_b|zhaopin_b/.test(text)) return "zhilian_b";
  if (/zhilian_a|zhaopin_a/.test(text)) return "zhilian_a";
  if (/zhilian|zhaopin|智联/.test(text)) return "zhilian_unknown";
  if (/boss_b|hexinhong/.test(text)) return "boss_b";
  return "boss_a";
}

function automationPlatformFromValue(value = "", fallback = "boss") {
  const text = String(value || "").toLowerCase();
  if (/51job|job51|前程/.test(text)) return "51job";
  if (/zhilian|zhaopin|智联/.test(text)) return "zhilian";
  if (/boss|zhipin|kanzhun/.test(text)) return "boss";
  return fallback;
}

function automationSourceKeyFromRecord(record = {}, filename = "") {
  const accountText = [record.accountId, record.accountName, record.accountLabel, record.sourceLabel, record.sourceName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const locationText = [record.filePath, record.path, record.localPath, record.filename, record.originalName, filename]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const platformText = [record.platform, record.sourcePlatform, record.source, record.channel, filename, locationText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const text = [accountText, platformText, locationText].filter(Boolean).join(" ");

  if (/job51_b|51_b|51_和新红/.test(text)) return "job51_b";
  if (/job51_a|51_a|51_宋峰峰|51_宋锋峰|boss_a_宋峰峰|boss_a_boss_a/.test(text)) return "job51_a";

  const hasJob51Hint = /51job|job51|51-resumes|前程/.test(text);
  if (hasJob51Hint) {
    if (/boss_b|hexinhong|和新红/.test(accountText)) return "job51_b";
    if (/boss_a|songfengfeng|宋峰峰|宋锋峰/.test(accountText)) return "job51_a";
    return "job51_unknown";
  }

  if (/zhilian_b|zhaopin_b/.test(text)) return "zhilian_b";
  if (/zhilian_a|zhaopin_a/.test(text)) return "zhilian_a";
  const hasZhilianHint = /zhaopin|zhilian|智联/.test(text);
  if (hasZhilianHint) {
    if (/boss_b|hexinhong|和新红/.test(accountText)) return "zhilian_b";
    if (/boss_a|songfengfeng|宋峰峰|宋锋峰/.test(accountText)) return "zhilian_a";
    return "zhilian_unknown";
  }

  if (/boss_b|hexinhong|和新红/.test(text)) return "boss_b";
  if (/songfengfeng|boss_a|宋峰峰|宋锋峰/.test(text)) return "boss_a";
  return automationSourceKeyFromFilename(filename);
}

function automationSourceKeyAccountId(sourceKey = "") {
  const key = String(sourceKey || "").toLowerCase();
  if (/^(boss_b|job51_b|zhilian_b)$/.test(key) || /_b$/.test(key)) return "boss_b";
  if (/^(boss_a|job51_a|zhilian_a)$/.test(key) || /_a$/.test(key)) return "boss_a";
  return "";
}

function automationAccountMatches(sourceKey, accountId = "all") {
  const normalized = normalizeBossAutomationAccountId(accountId);
  if (normalized === "all") return true;
  return automationSourceKeyAccountId(sourceKey) === normalized;
}

function automationPlatformMatches(recordPlatform, requestedPlatform) {
  return normalizeAutomationPlatformId(recordPlatform) === normalizeAutomationPlatformId(requestedPlatform);
}

function automationRecordContactKey(record = {}, metricKey = "processed", options = {}) {
  const includeDate = options.includeDate !== false;
  const date = includeDate ? automationDateKeyFromValue(record.updatedAt) : "";
  const platform = normalizeAutomationPlatformId(record.platform || automationPlatformFromValue(record.sourceKey || record.source || "", "boss"));
  const identity = automationRecordPersonKey(record);
  return [platform, date, metricKey, identity].join("|");
}

function automationRecordHasSavedResumeEvidence(record = {}) {
  const files = Array.isArray(record.resumeFiles) ? record.resumeFiles : [];
  if (files.some((file) => file && String(file.fileName || file.name || "").trim())) return true;
  const current = record.conversation?.currentRecord || {};
  const evidenceText = [
    record.phrase,
    record.candidateLabel,
    current.filename,
    current.fileName,
    current.resumeFileName,
    current.filePath,
    current.path,
    current.localPath,
    current.message,
  ]
    .filter(Boolean)
    .join(" ");
  return /\.(?:pdf|docx?|wps)\b/i.test(evidenceText) || /PDF\s*已保存|在线简历\s*PDF\s*已保存|简历.*已保存/.test(evidenceText);
}

function automationMetricPayloadFromRecords(records = [], options = {}) {
  const items = Array.isArray(records) ? records : [];
  const includeDate = options.includeDate !== false;
  const countFlag = (key) =>
    new Set(
      items
        .filter(
          (record) =>
            record.type !== "event" &&
            automationRecordHasCandidateIdentity(record) &&
            Boolean(record.flags?.[key] || record.statusGroup === key) &&
            (key !== "savedResumes" || automationRecordHasSavedResumeEvidence(record))
        )
        .map((record) => automationRecordContactKey(record, key, { includeDate }))
    ).size;
  const processed = new Set(
    items
      .filter(
        (record) =>
          record.type !== "event" &&
          automationRecordHasCandidateIdentity(record) &&
          !Boolean(
            record.flags?.proactiveOpened ||
              record.flags?.proactiveGreeted ||
              record.statusGroup === "proactiveOpened" ||
              record.statusGroup === "proactiveGreeted"
          )
      )
      .map((record) => automationRecordContactKey(record, "processed", { includeDate }))
  ).size;
  return [
    { key: "processed", label: "处理人数", value: processed },
    { key: "sentCompanyInfo", label: "询问问题", value: countFlag("sentCompanyInfo") },
    { key: "requestedResume", label: "求简历", value: countFlag("requestedResume") },
    { key: "userQuestions", label: "候选人提问", value: countFlag("userQuestions") },
    { key: "savedResumes", label: "获取简历", value: countFlag("savedResumes") },
    { key: "knowledgeAnswered", label: "已答疑", value: countFlag("knowledgeAnswered") },
    { key: "proactiveOpened", label: "点开人数", value: countFlag("proactiveOpened") },
    { key: "proactiveGreeted", label: "主动打招呼", value: countFlag("proactiveGreeted") },
    { key: "proactiveReplied", label: "主动回复", value: countFlag("proactiveReplied") },
    { key: "proactiveQualified", label: "主动符合", value: countFlag("proactiveQualified") },
  ];
}

function automationMetricMaxMerge(metrics = [], updates = {}) {
  const labels = {
    proactiveOpened: "点开人数",
    proactiveGreeted: "主动打招呼",
  };
  const next = (Array.isArray(metrics) ? metrics : []).map((metric) => ({ ...metric }));
  for (const [key, rawValue] of Object.entries(updates || {})) {
    const value = automationMetricCount(rawValue);
    if (!value) continue;
    let metric = next.find((item) => item?.key === key);
    if (!metric) {
      metric = { key, label: labels[key] || key, value: 0 };
      next.push(metric);
    }
    if (value > automationMetricCount(metric.value)) metric.value = value;
  }
  return next;
}

function automationProactiveReportCountValue(source = {}, ...keys) {
  for (const key of keys) {
    const value = automationMetricCount(source?.[key]);
    if (value) return value;
  }
  return 0;
}

function automationProactiveCountsFromReport(report = {}) {
  const state = report?.state && typeof report.state === "object" ? report.state : {};
  const counts = state.counts && typeof state.counts === "object" ? state.counts : report?.counts || {};
  const text = `${report?.type || ""} ${report?.message || ""} ${state.platform || ""} ${state.targetPosition || ""}`.toLowerCase();
  const opened = automationProactiveReportCountValue(counts, "proactiveOpened", "openedCandidates", "opened");
  const greeted = automationProactiveReportCountValue(counts, "proactiveGreeted", "greeted", "proactive_greeted");
  const isProactiveReport = /proactive|recommend|主动|推荐|打招呼|人才望远镜|推荐人才/.test(text);
  if (!isProactiveReport && !opened && !greeted) return null;
  return { proactiveOpened: opened, proactiveGreeted: greeted };
}

async function collectProactiveReportMetricTotals(platform = "boss", accountId = "all", selectedDate = automationChinaDateKey()) {
  let filenames = [];
  try {
    filenames = await fs.readdir(AUTOMATION_WORKSPACE);
  } catch {
    return {};
  }
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const totals = { proactiveOpened: 0, proactiveGreeted: 0 };
  for (const filename of filenames) {
    if (!/^recruiter_batch_reports\b.*\.json$/i.test(filename)) continue;
    const payload = await readAutomationJsonFile(filename);
    if (!Array.isArray(payload)) continue;
    for (const report of payload) {
      const item = automationItemContext(filename, report || {});
      if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) continue;
      if (!automationDetailDateMatches(report?.createdAt || report?.updatedAt, selectedDate)) continue;
      const counts = automationProactiveCountsFromReport(report);
      if (!counts) continue;
      totals.proactiveOpened += counts.proactiveOpened;
      totals.proactiveGreeted += counts.proactiveGreeted;
    }
  }
  return totals;
}

function automationProactiveActionTimestamp(action = {}) {
  const raw = action?.createdAtTs || action?.updatedAtTs || "";
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }
  const idMatch = String(action?.actionLogId || "").match(/pal_(\d{10,13})/);
  if (idMatch) {
    const fromId = Number(idMatch[1]);
    if (Number.isFinite(fromId) && fromId > 0) return fromId > 100000000000 ? fromId : fromId * 1000;
  }
  return 0;
}

function automationProactiveActionDateKey(action = {}) {
  const timestamp = automationProactiveActionTimestamp(action);
  if (timestamp) return automationChinaDateKey(new Date(timestamp));
  return automationDateKeyFromValue(action?.createdAt || action?.updatedAt || action?.time || "");
}

function automationProactiveActionDateMatches(action = {}, selectedDate = automationChinaDateKey()) {
  if (selectedDate === "all") return true;
  const dateKey = automationProactiveActionDateKey(action);
  if (!dateKey) return false;
  const dates = automationDateListFromState(selectedDate);
  return dates.length ? dates.includes(dateKey) : dateKey === selectedDate;
}

function automationProactiveActionCheckpointPassed(action = {}, patterns = []) {
  const checkpoints = Array.isArray(action?.checkpoints) ? action.checkpoints : [];
  return checkpoints.some((checkpoint) => {
    const name = String(checkpoint?.name || "").toLowerCase();
    const status = String(checkpoint?.status || "").toLowerCase();
    return patterns.some((pattern) => pattern.test(name)) && /passed|clicked|success|sent|completed|done/.test(status);
  });
}

function automationProactiveActionWasGreeted(action = {}) {
  const decision = String(action?.decision || action?.status || "").toLowerCase();
  if (/greeted|proactive_greeted/.test(decision)) return true;
  return automationProactiveActionCheckpointPassed(action, [/greet/, /say_hi/, /greeting/]);
}

function automationProactiveActionWasOpened(action = {}) {
  if (automationProactiveActionWasGreeted(action)) return true;
  return automationProactiveActionCheckpointPassed(action, [/open_resume_dialog/, /open.*candidate/, /open.*resume/, /read_resume/]);
}

function automationProactiveActionIdentityKey(action = {}, sourceKey = "", dateKey = "") {
  const identity = String(
    action?.candidateKey ||
      action?.candidateId ||
      action?.platformCandidateId ||
      action?.candidateName ||
      action?.name ||
      action?.cardPreview ||
      action?.actionLogId ||
      ""
  ).trim();
  return [sourceKey || "unknown", dateKey || "", identity || JSON.stringify(action).slice(0, 300)].join("|");
}

async function collectProactiveActionLogMetricTotals(platform = "boss", accountId = "all", selectedDate = automationChinaDateKey()) {
  let filenames = [];
  try {
    filenames = await fs.readdir(AUTOMATION_WORKSPACE);
  } catch {
    return {};
  }
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const openedKeys = new Set();
  const greetedKeys = new Set();
  for (const filename of filenames) {
    if (!/^recruiter_proactive_action_log\b.*\.jsonl$/i.test(filename)) continue;
    let content = "";
    try {
      content = await fs.readFile(path.join(AUTOMATION_WORKSPACE, filename), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      let action = null;
      try {
        action = JSON.parse(text);
      } catch {
        continue;
      }
      if (action?.dryRun) continue;
      const actionPlatform = normalizeAutomationPlatformId(
        action?.platform || action?.sourcePlatform || action?.source || automationPlatformFromValue(filename, "boss")
      );
      if (!automationPlatformMatches(actionPlatform, normalizedPlatform)) continue;
      const sourceKey = automationSourceKeyFromRecord(action || {}, filename);
      if (!automationAccountMatches(sourceKey, accountId)) continue;
      if (!automationProactiveActionDateMatches(action, selectedDate)) continue;
      const dateKey = automationProactiveActionDateKey(action);
      const identityKey = automationProactiveActionIdentityKey(action, sourceKey, dateKey);
      if (automationProactiveActionWasOpened(action)) openedKeys.add(identityKey);
      if (automationProactiveActionWasGreeted(action)) greetedKeys.add(identityKey);
    }
  }
  return { proactiveOpened: openedKeys.size, proactiveGreeted: greetedKeys.size };
}

async function applyProactiveReportMetricFallback(metrics = [], { platform = "boss", accountId = "all", date = "" } = {}) {
  const selectedDate = normalizeAutomationDetailDate(date);
  const reportTotals = await collectProactiveReportMetricTotals(platform, accountId, selectedDate);
  const actionLogTotals = await collectProactiveActionLogMetricTotals(platform, accountId, selectedDate);
  return automationMetricMaxMerge(automationMetricMaxMerge(metrics, reportTotals), actionLogTotals);
}

function automationDetailTimestamp(value = "") {
  const text = String(value || "").trim();
  const parsedIso = Date.parse(text);
  if (Number.isFinite(parsedIso)) return parsedIso;
  const parsed = Date.parse(text.replace(/-/g, "/"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAutomationDetailMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === "object" && String(message.text || "").trim())
    .slice(-80)
    .map((message) => ({
      sender: ["me", "other", "system"].includes(String(message.sender || "")) ? String(message.sender) : "other",
      time: String(message.time || message.timestamp || ""),
      status: clipText(message.status || "", 40),
      text: clipText(message.text || "", 900),
      synthetic: Boolean(message.synthetic),
    }));
}

function automationDetailResumeFiles(result = {}) {
  const files = [];
  const resume = result.resume && typeof result.resume === "object" ? result.resume : null;
  const fileName = resume?.filename || resume?.fileName || result.resumeFileName || result.fileName || "";
  if (fileName) {
    files.push({
      fileName: path.basename(String(fileName)),
      size: Number(resume?.size || result.resumeSize || 0),
    });
  }
  return files;
}

function automationDetailRecordFromResult(result, report, item, index) {
  if (!result || typeof result !== "object") return null;
  const action = String(result.action || result.nextAction || "");
  const status = String(result.screeningStatus || result.status || "");
  const reportType = String(report.type || "");
  let statusGroup = normalizeAutomationDetailStatusGroup(action, status, reportType);
  const resultMessage = String(result.message || result.error || "");
  if (
    statusGroup === "savedResumes" &&
    /跳过重复下载|已记忆.*简历下载记录|already.*(?:download|resume)/i.test(resultMessage)
  ) {
    statusGroup = "processed";
  }
  const updatedAt = String(result.updatedAt || result.createdAt || result.time || report.createdAt || "");
  const appliedPosition = String(result.appliedPosition || result.position || result.job || result.candidateIdentity?.appliedPosition || "").trim();
  const candidateLabel = clipText(result.label || result.candidateLabel || result.pageTextPreview || result.message || report.message || "", 220);
  const candidateName = resolveAutomationCandidateName(
    result.candidateName,
    result.name,
    result.replyTarget?.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const messages = normalizeAutomationDetailMessages(result.messages || result.recentMessages);
  if (!candidateName && !candidateLabel && !messages.length) return null;
  const flags = automationDetailFlags(statusGroup);
  const proactiveText = `${reportType} ${report.message || ""} ${action} ${result.workflow || ""} ${result.source || ""}`.toLowerCase();
  const proactiveReport = /proactive|recommend|主动|推荐|打招呼/.test(proactiveText);
  const openedLike = Boolean(
    result.opened ||
      result.openedCandidate ||
      result.detailUrl ||
      result.detailPreview ||
      result.resumeInfo ||
      result.resumeBrowse ||
      result.resumePreview ||
      result.browseActions ||
      result.commonGate ||
      result.screening ||
      result.evidenceText ||
      /greeted|dry_run_would_greet|screening_not_qualified|not_qualified|no_hi_button|no_greet_button/.test(action.toLowerCase())
  );
  if (proactiveReport && openedLike) {
    flags.proactiveOpened = true;
  }
  const idSeed = [
    item.source || item.platform || "",
    report.runId || report.createdAt || "",
    result.conversationKey || result.id || result.index || index,
    candidateName,
    appliedPosition,
    action,
  ].join("|");
  return {
    id: `automation-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    candidateName,
    appliedPosition,
    status,
    statusGroup,
    statusLabel: automationDetailStatusLabel(statusGroup, action, status),
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.accountName || item.platform || "自动化",
    candidateLabel,
    phrase: clipText(result.lastOther || result.message || report.message || candidateLabel, 240),
    question: clipText(result.question || result.normalizedQuestion || "", 180),
    answer: clipText(result.answer || result.reply || "", 180),
    action,
    flags,
    resumeFiles: automationDetailResumeFiles(result),
    conversation: {
      summary: clipText(result.message || report.message || "", 1200),
      counterpart: {
        name: candidateName,
        organization: "",
        role: appliedPosition,
        appliedPosition,
        rawHeader: clipText(result.pageTextPreview || result.label || "", 1600),
      },
      recentMessages: messages,
      currentRecord: result,
    },
  };
}

function automationEventDetailRecord(event, item, index) {
  if (!event || typeof event !== "object") return null;
  const updatedAt = String(event.time || event.createdAt || "");
  const message = clipText(event.message || event.action || event.type || "自动化事件", 240);
  if (!message) return null;
  const idSeed = [item.source || item.platform || "", updatedAt, message, index].join("|");
  return {
    id: `automation-event-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "event",
    typeLabel: "事件",
    candidateName: "自动化事件",
    appliedPosition: "",
    status: "event",
    statusGroup: "processed",
    statusLabel: "事件记录",
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.accountName || item.platform || "自动化",
    candidateLabel: message,
    phrase: message,
    question: "",
    answer: "",
    action: String(event.action || event.type || ""),
    flags: automationDetailFlags("processed"),
    resumeFiles: [],
    conversation: {
      summary: message,
      counterpart: { name: "自动化事件", organization: "", role: "", appliedPosition: "", rawHeader: message },
      recentMessages: [{ sender: "system", time: updatedAt, status: "事件", text: message }],
      currentRecord: event,
    },
  };
}

function automationQuestionDetailRecord(question, item, index) {
  if (!question || typeof question !== "object") return null;
  const updatedAt = String(question.time || question.capturedAt || question.createdAt || "");
  const appliedPosition = String(question.appliedPosition || question.replyTarget?.appliedPosition || question.candidateIdentity?.appliedPosition || "").trim();
  const candidateLabel = clipText(question.candidateLabel || question.candidate || question.candidateIdentity?.listLabel || "", 220);
  const candidateName = resolveAutomationCandidateName(
    question.candidateName,
    question.replyTarget?.candidateName,
    question.candidateIdentity?.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const action = String(question.action || "");
  const questionAnswer = String(question.answer || "").trim();
  const statusGroup =
    questionAnswer || /knowledge_answered|answerable_by_kb/.test(`${action} ${question.questionCategory || ""}`.toLowerCase())
      ? "knowledgeAnswered"
      : "userQuestions";
  const flags = {
    ...automationDetailFlags(statusGroup),
    userQuestions: true,
    knowledgeAnswered: statusGroup === "knowledgeAnswered",
  };
  const idSeed = [item.sourceKey || item.source || "", question.id || question.fingerprint || question.questionKey || index, updatedAt].join("|");
  return {
    id: `automation-question-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status: String(question.status || question.screeningStatus || ""),
    statusGroup,
    statusLabel: automationDetailStatusLabel(statusGroup, action, question.status || ""),
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(question.question || question.normalizedQuestion || "", 240),
    question: clipText(question.question || question.normalizedQuestion || "", 180),
    answer: clipText(question.answer || "", 180),
    action,
    flags,
    resumeFiles: [],
    conversation: {
      summary: clipText(question.questionPoolReason || question.answer || question.question || "", 1200),
      counterpart: { name: candidateName, organization: "", role: appliedPosition, appliedPosition, rawHeader: clipText(candidateLabel || "", 1600) },
      recentMessages: [
        { sender: "other", time: updatedAt, status: "候选人提问", text: clipText(question.question || question.normalizedQuestion || "", 900) },
        ...(question.answer ? [{ sender: "me", time: updatedAt, status: "已答复", text: clipText(question.answer, 900) }] : []),
      ],
      currentRecord: question,
    },
  };
}

function automationDownloadDetailRecord(download, item, index) {
  if (!download || typeof download !== "object") return null;
  const updatedAt = String(download.downloadedAt || download.time || download.createdAt || "");
  const appliedPosition = String(download.appliedPosition || download.position || download.candidateIdentity?.appliedPosition || "").trim();
  const fileName = download.filename || download.name || (download.filePath ? path.basename(String(download.filePath)) : "");
  const candidateLabel = clipText(download.candidateLabel || `${download.candidateName || ""} ${appliedPosition}`, 220);
  const candidateName = resolveAutomationCandidateName(
    download.candidateName,
    automationCandidateNameFromFilename(fileName),
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const idSeed = [item.sourceKey || item.source || "", download.fileHash || download.filePath || fileName || index, updatedAt].join("|");
  return {
    id: `automation-download-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status: "saved_resume",
    statusGroup: "savedResumes",
    statusLabel: "已获取简历",
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(fileName || "获取简历", 240),
    question: "",
    answer: "",
    action: "resume_downloaded",
    flags: automationDetailFlags("savedResumes"),
    resumeFiles: fileName ? [{ fileName: path.basename(String(fileName)), size: Number(download.fileSize || download.size || 0) }] : [],
    conversation: {
      summary: clipText(`已获取简历：${fileName || "-"}`, 1200),
      counterpart: { name: candidateName, organization: "", role: appliedPosition, appliedPosition, rawHeader: clipText(candidateLabel || "", 1600) },
      recentMessages: [{ sender: "system", time: updatedAt, status: "获取简历", text: fileName || "已获取简历" }],
      currentRecord: download,
    },
  };
}

async function collectBossEmailBatchDetailRecords({ accountId = "all", selectedDate = automationChinaDateKey() } = {}) {
  await ensureDatabase();
  const normalizedAccount = normalizeBossAutomationAccountId(accountId);
  const rows = getDb()
    .prepare(
      `SELECT bi.id, bi.job_id, bi.filename, bi.file_path, bi.status, bi.message, bi.resume_id,
              bi.payload, bi.created_at, bi.updated_at,
              r.payload AS resume_payload, r.job_type AS resume_job_type, r.match_score AS resume_match_score
         FROM batch_items bi
         LEFT JOIN resumes r ON r.id = bi.resume_id
        WHERE bi.status IN ('saved', 'duplicate')
          AND (bi.filename LIKE '邮箱_%' OR bi.payload LIKE '%"trigger":"email%')
        ORDER BY bi.updated_at DESC`
    )
    .all();
  const records = [];
  const manifest = await readBossImportManifest();
  const manifestByItemId = new Map(
    (Array.isArray(manifest.files) ? manifest.files : [])
      .filter((entry) => entry?.itemId)
      .map((entry) => [entry.itemId, entry])
  );

  rows.forEach((row, index) => {
    const payload = parsePayload(row.payload, {});
    const manifestEntry = manifestByItemId.get(row.id) || {};
    const manifestAccountIds = new Set(
      [
        manifestEntry.accountId,
        ...(Array.isArray(manifestEntry.accounts) ? manifestEntry.accounts.map((item) => item?.accountId) : []),
      ]
        .filter(Boolean)
        .map((value) => normalizeBossAutomationAccountId(value))
    );
    const rowAccountId = (payload.accountId || manifestEntry.accountId)
      ? normalizeBossAutomationAccountId(payload.accountId || manifestEntry.accountId)
      : "";
    if (normalizedAccount !== "all") {
      if (manifestAccountIds.size) {
        if (!manifestAccountIds.has(normalizedAccount)) return;
      } else if (rowAccountId) {
        if (rowAccountId !== normalizedAccount) return;
      } else {
        return;
      }
    }
    const updatedAt = String(row.updated_at || row.created_at || "");
    if (!automationDetailDateMatches(updatedAt, selectedDate)) return;
    const resumePayload = parsePayload(row.resume_payload, {});
    const effectiveAccountId = normalizedAccount !== "all" && manifestAccountIds.has(normalizedAccount) ? normalizedAccount : rowAccountId;
    const sourceLabel = effectiveAccountId ? automationAccountLabel(effectiveAccountId) : "BOSS邮箱";
    const candidateName = resumePayload.name || automationEmailCandidateNameFromFilename(row.filename);
    const appliedPosition = normalizeJobType(
      row.resume_job_type || resumePayload.jobType || payload.jobType || "",
      `${row.filename || ""} ${candidateName || ""}`
    );
    const record = automationDownloadDetailRecord(
      {
        downloadedAt: updatedAt,
        appliedPosition,
        filename: row.filename,
        filePath: payload.sourcePath || manifestEntry.sourcePath || row.file_path,
        fileHash: payload.sourceHash || manifestEntry.hash || row.id,
        size: payload.size || manifestEntry.size || 0,
        candidateName,
        phone: resumePayload.phone || "",
        candidateLabel: `${candidateName || "邮箱简历"} ${appliedPosition}`.trim(),
        createdAt: row.created_at,
      },
      {
        platform: "boss",
        sourceKey: effectiveAccountId || "boss_email",
        source: effectiveAccountId || "boss_email",
        sourceLabel,
      },
      index
    );
    if (record) {
      records.push({
        ...record,
        id: `automation-email-${row.id}`,
        source: sourceLabel,
        sourceKey: effectiveAccountId || "boss_email",
        platform: "boss",
        status: row.status === "duplicate" ? "saved_resume_duplicate" : "saved_resume",
        statusLabel: row.status === "duplicate" ? "已获取简历（重复）" : "已获取简历",
        conversation: {
          ...record.conversation,
          summary: clipText(row.message || record.conversation?.summary || "", 1200),
          currentRecord: {
            batchItemId: row.id,
            batchJobId: row.job_id,
            resumeId: row.resume_id,
            status: row.status,
            accountId: effectiveAccountId,
            accountLabel: manifestEntry.accountLabel || payload.accountLabel || "",
            email: manifestEntry.email || payload.email || "",
            payload,
          },
        },
      });
    }
  });

  return records;
}

function automationDecisionDetailRecord(decision, item, index) {
  if (!decision || typeof decision !== "object") return null;
  const updatedAt = String(decision.time || decision.createdAt || decision.updatedAt || "");
  const action = String(decision.action || decision.nextAction || decision.status || "");
  const status = String(decision.screeningStatus || decision.status || "");
  const statusGroup = normalizeAutomationDetailStatusGroup(action, status, decision.workflow || "");
  const appliedPosition = String(decision.appliedPosition || decision.position || decision.replyTarget?.appliedPosition || decision.candidateIdentity?.appliedPosition || "").trim();
  const candidateLabel = clipText(decision.candidateLabel || decision.candidateIdentity?.listLabel || "", 220);
  const candidateName = resolveAutomationCandidateName(
    decision.candidateName,
    decision.replyTarget?.candidateName,
    decision.candidateIdentity?.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const idSeed = [item.sourceKey || item.source || "", decision.id || decision.conversationKey || index, updatedAt, action].join("|");
  return {
    id: `automation-decision-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status,
    statusGroup,
    statusLabel: automationDetailStatusLabel(statusGroup, action, status),
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(decision.lastOther || decision.stage || decision.status || "", 240),
    question: clipText(decision.question || "", 180),
    answer: clipText(decision.knowledgeAnswer || "", 180),
    action,
    flags: automationDetailFlags(statusGroup),
    resumeFiles: [],
    conversation: {
      summary: clipText(decision.conversationReview?.summary || decision.stage || decision.status || "", 1200),
      counterpart: { name: candidateName, organization: "", role: appliedPosition, appliedPosition, rawHeader: clipText(candidateLabel || "", 1600) },
      recentMessages: decision.lastOther ? [{ sender: "other", time: updatedAt, status: decision.stage || "", text: clipText(decision.lastOther, 900) }] : [],
      currentRecord: decision,
    },
  };
}

function automationMemoryDetailRecord(key, memory, item, index) {
  if (!memory || typeof memory !== "object") return null;
  const counterpart = memory.counterpart && typeof memory.counterpart === "object" ? memory.counterpart : {};
  const updatedAt = String(memory.updatedAt || memory.lastUpdatedAt || memory.createdAt || "");
  if (!automationDateKeyFromValue(updatedAt)) return null;
  const appliedPosition = String(memory.appliedPosition || counterpart.appliedPosition || counterpart.role || "").trim();
  const candidateLabel = clipText(counterpart.rawHeader || memory.summary || `${memory.candidateName || counterpart.name || ""} ${appliedPosition}`, 220);
  const candidateName = resolveAutomationCandidateName(
    counterpart.name,
    memory.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  if (!candidateName && !appliedPosition) return null;
  const idSeed = [item.sourceKey || item.source || "", key || index, updatedAt].join("|");
  return {
    id: `automation-memory-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status: "memory",
    statusGroup: "processed",
    statusLabel: "联系人记录",
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(memory.summary || "", 240),
    question: "",
    answer: "",
    action: "chat_memory",
    flags: automationDetailFlags("processed"),
    resumeFiles: [],
    conversation: {
      summary: clipText(memory.summary || "", 1200),
      counterpart: { name: candidateName, organization: String(counterpart.organization || ""), role: String(counterpart.role || ""), appliedPosition, rawHeader: clipText(candidateLabel || counterpart.rawHeader || "", 1600) },
      recentMessages: normalizeAutomationDetailMessages(memory.recentMessages || []),
      currentRecord: { conversationKey: key },
    },
  };
}

function automationItemContext(filename, raw = {}) {
  const sourceKey = automationSourceKeyFromRecord(raw, filename);
  const filePlatform = automationPlatformFromValue(filename, sourceKey.startsWith("job51") ? "51job" : sourceKey.startsWith("zhilian") ? "zhilian" : "boss");
  const sourcePlatform = AUTOMATION_SUMMARY_SOURCES[sourceKey]?.platform || filePlatform;
  const sourceScopedPlatform = /^(boss|job51|zhilian)_[ab]$/.test(sourceKey) ? sourcePlatform : "";
  const platform = sourceScopedPlatform || automationPlatformFromValue(raw.platform || raw.state?.platform || raw.type || filename, sourcePlatform);
  return {
    sourceKey,
    platform,
    source: sourceKey,
    sourceLabel: AUTOMATION_SUMMARY_SOURCES[sourceKey]?.label || automationSourceLabel(filename),
    accountName: raw.accountName || AUTOMATION_SUMMARY_SOURCES[sourceKey]?.label || "",
  };
}

async function collectDeepAutomationDetailRecords(platform, accountId = "all", selectedDate = "all") {
  let filenames = [];
  try {
    filenames = await fs.readdir(AUTOMATION_WORKSPACE);
  } catch {
    return [];
  }
  const records = [];
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  for (const filename of filenames) {
    if (
      !/^(recruiter_batch_reports|agent_web_events|recruiter_decision_log|recruiter_user_questions|recruiter_unclear_questions|recruiter_resume_downloads|job51_resume_downloads|agent_files|agent_chat_memory)\b.*\.(json|jsonl)$/i.test(
        filename
      )
    ) {
      continue;
    }
    const payload = await readAutomationJsonFile(filename);
    if (!payload) continue;
    const values = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? Object.entries(payload).map(([key, value]) => ({ key, value })) : [];

    if (/^recruiter_batch_reports\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((report, reportIndex) => {
        const item = automationItemContext(filename, report || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const results = Array.isArray(report?.results) ? report.results : [];
        results.forEach((result, index) => {
          const record = automationDetailRecordFromResult(result, report, item, index);
          if (record) records.push({ ...record, platform: item.platform, sourceKey: item.sourceKey });
        });
        if (!results.length) {
          const record = automationEventDetailRecord({ createdAt: report?.createdAt, message: report?.message, type: report?.type }, item, reportIndex);
          if (record) records.push({ ...record, platform: item.platform, sourceKey: item.sourceKey });
        }
      });
      continue;
    }

    if (/^agent_web_events\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((event, index) => {
        const item = automationItemContext(filename, event || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationEventDetailRecord({ ...event, message: event.text || event.message || event.kind, type: event.kind || event.type }, item, index);
        if (record) records.push({ ...record, platform: item.platform, sourceKey: item.sourceKey });
      });
      continue;
    }

    if (/^recruiter_decision_log\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((decision, index) => {
        const item = automationItemContext(filename, decision || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationDecisionDetailRecord(decision, item, index);
        if (record) records.push(record);
      });
      continue;
    }

    if (/^recruiter_(user|unclear)_questions\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((question, index) => {
        const item = automationItemContext(filename, question?.candidateIdentity || question || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationQuestionDetailRecord(question, item, index);
        if (record) records.push(record);
      });
      continue;
    }

    if (/^(recruiter_resume_downloads|job51_resume_downloads|agent_files)\b/i.test(filename)) {
      values.forEach((entry, index) => {
        const value = entry.value || entry;
        const item = automationItemContext(filename, value || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationDownloadDetailRecord(value, item, index);
        if (record) records.push(record);
      });
      continue;
    }

    if (/^agent_chat_memory\b/i.test(filename)) {
      values.forEach((entry, index) => {
        const value = entry.value || entry;
        const item = automationItemContext(filename, value || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationMemoryDetailRecord(entry.key || "", value, item, index);
        if (record) records.push(record);
      });
    }
  }
  if (normalizedPlatform === "boss") {
    records.push(...(await collectBossEmailBatchDetailRecords({ accountId, selectedDate })));
  }
  return records
    .filter((record) => automationDetailDateMatches(record.updatedAt, selectedDate))
    .sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
}

function dedupeAutomationDetailRecords(records = [], metricKey = "", options = {}) {
  const byId = new Map();
  const includeDate = options.includeDate !== false;
  const flagWeight = (record) => {
    const requestedWeight = metricKey && (record.flags?.[metricKey] || record.statusGroup === metricKey) ? 100 : 0;
    return (
      requestedWeight +
      ["savedResumes", "requestedResume", "knowledgeAnswered", "userQuestions", "sentCompanyInfo", "processed"].reduce(
        (score, key, index) => score + (record.flags?.[key] || record.statusGroup === key ? 10 - index : 0),
        0
      )
    );
  };
  for (const record of records) {
    const key = automationRecordContactKey(record, metricKey || record.statusGroup || "processed", { includeDate });
    const current = byId.get(key);
    if (!current || flagWeight(record) > flagWeight(current) || Number(record.updatedAtTs || 0) > Number(current.updatedAtTs || 0)) {
      byId.set(key, record);
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
}

function automationDetailRecordsFromSummaries(items, selectedDate) {
  const records = [];
  for (const item of items) {
    const reports = Array.isArray(item.latestReports) ? item.latestReports : [];
    for (const report of reports) {
      if (!automationDetailDateMatches(report?.createdAt, selectedDate)) continue;
      const results = Array.isArray(report?.results) ? report.results : [];
      results.forEach((result, index) => {
        const record = automationDetailRecordFromResult(result, report, item, index);
        if (record) records.push(record);
      });
      if (!results.length) {
        const record = automationEventDetailRecord(
          { createdAt: report.createdAt, message: report.message, type: report.type },
          item,
          records.length
        );
        if (record) records.push(record);
      }
    }
    const events = Array.isArray(item.latestEvents) ? item.latestEvents : [];
    for (const event of events.slice(0, 24)) {
      if (!automationDetailDateMatches(event?.time || event?.createdAt, selectedDate)) continue;
      const record = automationEventDetailRecord(event, item, records.length);
      if (record) records.push(record);
    }
  }
  return records.sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
}

function filterAutomationDetailRecordsForRequest(records, options = {}) {
  const metric = String(options.metric || "").trim();
  const includeDate = normalizeAutomationDetailDate(options.date) !== "all";
  const baseRecords = Array.isArray(records) ? records : [];
  const filteredRecords = !metric || metric === "processed"
    ? baseRecords.filter(
        (record) =>
          record.type !== "event" &&
          automationRecordHasCandidateIdentity(record) &&
          !Boolean(
            record.flags?.proactiveOpened ||
              record.flags?.proactiveGreeted ||
              record.statusGroup === "proactiveOpened" ||
              record.statusGroup === "proactiveGreeted"
          )
      )
    : baseRecords.filter(
        (record) =>
          automationRecordHasCandidateIdentity(record) &&
          Boolean(record.flags?.[metric] || record.statusGroup === metric) &&
          (metric !== "savedResumes" || automationRecordHasSavedResumeEvidence(record))
      );
  return dedupeAutomationDetailRecords(filteredRecords, metric || "processed", { includeDate });
}

async function buildAutomationDetailsPayload(platform, sourceKeys, options = {}) {
  const selectedDate = normalizeAutomationDetailDate(options.date);
  const accountId = options.accountId || "all";
  const deepRecords = await collectDeepAutomationDetailRecords(platform, accountId, selectedDate);
  let items = [];
  let agentOffline = false;
  let agentError = "";
  if (!deepRecords.length) {
    try {
      items = await Promise.all(sourceKeys.map((sourceKey) => fetchAutomationSummary(sourceKey)));
    } catch (error) {
      agentOffline = true;
      agentError = error.message || "自动化 agent 未启动";
      items = [];
    }
  }
  let baseRecords = deepRecords.length ? deepRecords : automationDetailRecordsFromSummaries(items, selectedDate);
  const baseMetrics = automationMetricPayloadFromRecords(baseRecords, { includeDate: selectedDate !== "all" });
  const records = filterAutomationDetailRecordsForRequest(baseRecords, options);
  const jobs = [...new Set(records.map((record) => record.appliedPosition).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
  const useRecordMetrics = automationDateListFromState(selectedDate).length > 1;
  const sourceMetrics =
    deepRecords.length || useRecordMetrics || agentOffline
      ? baseMetrics
      : automationDetailMetricPayload(items, platform, {
          accountId: options.accountId,
          date: selectedDate,
        });
  const mergedSourceMetrics = await applyProactiveReportMetricFallback(sourceMetrics, { platform, accountId, date: selectedDate });
  const metricsPayload = applyAutomation24hProgressFallback(
    { metrics: mergedSourceMetrics, date: selectedDate },
    { platform, accountId, date: selectedDate }
  );
  return {
    platform,
    date: selectedDate,
    today: automationChinaDateKey(),
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    metrics: metricsPayload.metrics || mergedSourceMetrics,
    records,
    recoveredFrom24hStatus: Boolean(metricsPayload.recoveredFrom24hStatus),
    recoveryNote: metricsPayload.recoveredFrom24hStatus
      ? "当前统计含24小时自动运转进度兜底；兜底只补充摘要数字，不生成候选人明细，也不参与岗位扇形图。"
      : "",
    agentOffline,
    error: agentError,
    filters: {
      jobs,
      statuses: [
        { key: "proactiveReplied", label: "主动联系后已回复" },
        { key: "proactiveQualified", label: "主动联系后符合要求" },
        { key: "proactiveOpened", label: "主动联系已点开" },
        { key: "proactiveGreeted", label: "已主动打招呼" },
        { key: "sentCompanyInfo", label: "已发话术/问题" },
        { key: "requestedResume", label: "已求简历" },
        { key: "userQuestions", label: "用户提问" },
        { key: "savedResumes", label: "获取简历" },
        { key: "waiting", label: "等待/待判断" },
      ],
      types: [
        { key: "candidate", label: "候选人" },
        { key: "event", label: "事件" },
      ],
    },
  };
}

async function handleAutomationDetails(request, response, platform, sourceKeys, accountId = "all") {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const payload = await buildAutomationDetailsPayload(platform, sourceKeys, {
      date: requestUrl.searchParams.get("date") || "",
      mode: requestUrl.searchParams.get("mode") || "",
      metric: requestUrl.searchParams.get("metric") || "",
      accountId,
    });
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "自动化明细读取失败" });
  }
}

async function handlePlatformAutomationDetails(request, response, platform) {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const accountId = normalizeBossAutomationAccountId(requestUrl.searchParams.get("accountId") || "all");
    const normalizedPlatform = normalizeAutomationPlatformId(platform);
    const sourceKeys = platformAutomationSources(normalizedPlatform, accountId);
    await handleAutomationDetails(request, response, normalizedPlatform, sourceKeys, accountId);
  } catch (error) {
    sendJson(response, error.statusCode || 502, { error: error.message || "自动化明细读取失败" });
  }
}

async function fetchAgentJson(sourceKey, targetPath, { method = "GET", body = null, timeoutMs = 900000 } = {}) {
  return automationProxyService.fetchAgentJson(sourceKey, targetPath, { method, body, timeoutMs });
}

async function proxyAgentResponse(request, response, sourceKey, targetPath, { timeoutMs = 900000 } = {}) {
  return automationProxyService.proxyAgentResponse(request, response, sourceKey, targetPath, { timeoutMs });
}

function parseJsonRequestBuffer(buffer) {
  return automationProxyService.parseJsonRequestBuffer(buffer);
}

async function proxyPlatformAutomationResponse(request, response, platform, targetPath, { timeoutMs = 900000 } = {}) {
  return automationProxyService.proxyPlatformAutomationResponse(request, response, platform, targetPath, { timeoutMs });
}

async function listBossBrowserPages() {
  const pages = await fetchLocalJson(`${BOSS_BROWSER_DEBUG_URL}/json/list`);
  return Array.isArray(pages) ? pages.filter((page) => page.type === "page") : [];
}

function isBossPageUrl(url = "") {
  return /zhipin\.com|kanzhun\.com/i.test(String(url));
}

async function getBossBrowserPage() {
  let pages;
  try {
    pages = await listBossBrowserPages();
  } catch {
    const error = new Error("未连接到普通 Chrome/Edge 调试浏览器");
    error.statusCode = 409;
    error.payload = { startHint: getBossBrowserStartHint() };
    throw error;
  }

  const page = pages.find((item) => isBossPageUrl(item.url));
  if (!page?.webSocketDebuggerUrl) {
    const error = new Error("没有找到可控制的浏览器页面");
    error.statusCode = 409;
    error.payload = { startHint: getBossBrowserStartHint() };
    throw error;
  }
  return page;
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    if (typeof WebSocket === "undefined") {
      throw new Error("当前 Node 版本不支持 WebSocket，无法连接浏览器调试端口");
    }

    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || "浏览器命令失败"));
        } else {
          resolve(message.result || {});
        }
        return;
      }
      if (message.method) {
        this.events.push(message);
      }
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接浏览器超时")), 5000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("连接浏览器失败"));
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} 执行超时`));
      }, 10000);
    });
  }

  async evaluate(expression, { timeoutMs = 10000 } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
    }
    return result.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

const BOSS_PAGE_SCAN_SCRIPT = `(() => {
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || el.title || "").replace(/\\s+/g, " ").trim();
  const isDisabled = (el) => el.disabled || /disabled|disable/.test(String(el.className || "")) || el.getAttribute("aria-disabled") === "true";
  const elements = [...document.querySelectorAll("a,button,[role='button']")];
  const triggers = elements
    .map((el, index) => ({
      index,
      text: textOf(el),
      href: el.href || "",
      className: String(el.className || ""),
      visible: visible(el),
      disabled: isDisabled(el)
    }))
    .filter((item) => item.visible && !item.disabled && (/下载|在线简历|附件简历/.test(item.text) || /resume|download|attachment|pdf/i.test(item.href)))
    .slice(0, 20);
  const bodyText = document.body?.innerText || "";
  const onlineResumeOpen = Boolean(document.querySelector(".resume-common-dialog,.new-resume-online-main-ui,.resume-detail-wrap"));
  return {
    url: location.href,
    title: document.title,
    isBossPage: /zhipin\\.com|kanzhun\\.com/i.test(location.href),
    blocked: /验证码|安全验证|登录后|请登录|异常访问|访问受限/.test(bodyText),
    onlineResumeOpen,
    triggers
  };
})()`;

function makeBossClickDownloadScript(domIndex) {
  return `(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || el.title || "").replace(/\\s+/g, " ").trim();
    const elements = [...document.querySelectorAll("a,button,[role='button']")];
    const el = elements[${Number(domIndex)}];
    if (!el || !visible(el)) return { clicked: false, reason: "下载入口不可见" };
    const text = textOf(el);
    const href = el.href || "";
    const disabled = el.disabled || /disabled|disable/.test(String(el.className || "")) || el.getAttribute("aria-disabled") === "true";
    if (disabled) return { clicked: false, reason: "入口不可用", text, href };
    if (!(/下载|在线简历|附件简历/.test(text) || /resume|download|attachment|pdf/i.test(href))) {
      return { clicked: false, reason: "该入口不像下载按钮", text, href };
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.click();
    return { clicked: true, text, href };
  })()`;
}

async function getBossResumeFilesSnapshot() {
  const files = await listBossResumePdfFiles();
  const stats = await Promise.all(
    files.map(async (filePath) => {
      const stat = await fs.stat(filePath).catch(() => null);
      return stat ? { filePath, filename: path.basename(filePath), size: stat.size, mtimeMs: stat.mtimeMs } : null;
    })
  );
  return stats.filter(Boolean);
}

async function waitForBossDownloads(beforeFiles, timeoutMs = 8000) {
  const beforeKeys = new Set(beforeFiles.map((file) => `${file.filename}:${file.size}`));
  const start = Date.now();
  let latest = [];

  while (Date.now() - start < timeoutMs) {
    const current = await getBossResumeFilesSnapshot();
    latest = current.filter((file) => !beforeKeys.has(`${file.filename}:${file.size}`));
    const tempFiles = await fs
      .readdir(BOSS_RESUMES_DIR)
      .then((files) => files.filter((name) => /\.crdownload$|\.tmp$/i.test(name)))
      .catch(() => []);
    if (latest.length && !tempFiles.length) break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return latest;
}

function getResumeJobDisplayLabel(jobType) {
  return RESUME_JOB_DISPLAY_LABELS[jobType] || jobType || "";
}

function buildResumeCopyFileName(record = {}) {
  const sourceText = `${record.fileName || ""} ${record.name || ""} ${record.school || ""}`;
  const name = compactSafeFilePart(record.name || path.parse(record.fileName || "").name, "候选人");
  const jobType = normalizeJobType(record.jobType || "", sourceText);
  const jobLabel = compactSafeFilePart(getResumeJobDisplayLabel(jobType), "岗位");
  return `${name}_${jobLabel}.pdf`;
}

function imapQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function waitForImapBuffer(test, getBuffer, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (test(getBuffer())) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("邮箱连接超时"));
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

async function createEmailImapClient(emailConfig = getEmailAccountConfig()) {
  const socket = tls.connect({
    host: emailConfig.imapHost,
    port: emailConfig.imapPort,
    servername: emailConfig.imapHost,
  });
  socket.setEncoding("binary");

  let buffer = "";
  let tagIndex = 1;
  socket.on("data", (chunk) => {
    buffer += chunk;
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`连接邮箱 IMAP 超时：${emailConfig.imapHost}:${emailConfig.imapPort}`)), 10000);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await waitForImapBuffer((data) => /\* OK/i.test(data), () => buffer, 10000);
  buffer = "";

  return {
    async command(commandText, { timeoutMs = 30000 } = {}) {
      const tag = `A${String(tagIndex++).padStart(4, "0")}`;
      socket.write(`${tag} ${commandText}\r\n`, "binary");
      const tagLine = new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)[^\\r\\n]*(?:\\r?\\n)?`, "i");
      await waitForImapBuffer((data) => tagLine.test(data), () => buffer, timeoutMs);
      const match = buffer.match(tagLine);
      const end = match.index + match[0].length;
      const responseText = buffer.slice(0, end);
      buffer = buffer.slice(end);
      if (!new RegExp(`${tag} OK`, "i").test(match[0])) {
        throw new Error(`邮箱 IMAP 命令失败：${match[0].trim()}`);
      }
      return responseText;
    },
    close() {
      try {
        socket.end();
      } catch {}
    },
  };
}

function decodeMimeWords(value = "") {
  return String(value).replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_all, charset, encoding, text) => {
    try {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))), "binary");
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      try {
        return Buffer.from(text, encoding.toUpperCase() === "B" ? "base64" : "binary").toString("utf8");
      } catch {
        return text;
      }
    }
  });
}

function parseMimeHeaders(headerText = "") {
  const headers = {};
  const lines = String(headerText).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = headers[key] ? `${headers[key]} ${value}` : value;
  }
  return headers;
}

function splitMimeMessage(raw = "") {
  const match = String(raw).match(/\r?\n\r?\n/);
  if (!match) return { headers: {}, body: raw };
  const index = match.index;
  const headerText = raw.slice(0, index);
  const body = raw.slice(index + match[0].length);
  return { headers: parseMimeHeaders(headerText), body };
}

function getMimeBoundary(contentType = "") {
  const match = String(contentType).match(/boundary\*?=(?:[^']*''|")?([^";\r\n]+)"?/i);
  return match ? match[1].trim() : "";
}

function getHeaderFilename(headers = {}) {
  const combined = `${headers["content-disposition"] || ""}; ${headers["content-type"] || ""}`;
  const star = combined.match(/filename\*=([^;\r\n]+)/i) || combined.match(/name\*=([^;\r\n]+)/i);
  if (star) {
    const value = star[1].trim().replace(/^"|"$/g, "");
    const encoded = value.includes("''") ? value.split("''").slice(1).join("''") : value;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return decodeMimeWords(encoded);
    }
  }
  const normal = combined.match(/filename="?([^";\r\n]+)"?/i) || combined.match(/name="?([^";\r\n]+)"?/i);
  return normal ? decodeMimeWords(normal[1].trim()) : "";
}

function decodeQuotedPrintable(text = "") {
  return Buffer.from(
    String(text)
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))),
    "binary"
  );
}

function isResumeAttachment(headers = {}, filename = "") {
  const contentType = String(headers["content-type"] || "").toLowerCase();
  const lowerName = String(filename || "").toLowerCase();
  return (
    /\.pdf$/i.test(lowerName) ||
    /\.docx?$/i.test(lowerName) ||
    /application\/pdf/i.test(contentType) ||
    /application\/msword/i.test(contentType) ||
    /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(contentType)
  );
}

function isValidResumeAttachmentBuffer(buffer, filename = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  const lowerName = String(filename || "").toLowerCase();
  if (/\.pdf$/i.test(lowerName)) return buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if (/\.docx$/i.test(lowerName)) return buffer.subarray(0, 2).equals(Buffer.from("PK"));
  if (/\.doc$/i.test(lowerName)) return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  return true;
}

function collectResumeAttachments(raw = "", attachments = [], depth = 0) {
  if (depth > 8) return attachments;
  const { headers, body } = splitMimeMessage(raw);
  const contentType = headers["content-type"] || "";
  const boundary = getMimeBoundary(contentType);

  if (/multipart\//i.test(contentType) && boundary) {
    const marker = `--${boundary}`;
    const parts = body.split(marker).slice(1);
    for (const part of parts) {
      if (part.startsWith("--")) continue;
      collectResumeAttachments(part.replace(/^\r?\n/, ""), attachments, depth + 1);
    }
    return attachments;
  }

  const filename = getHeaderFilename(headers);
  if (!isResumeAttachment(headers, filename)) return attachments;

  const encoding = String(headers["content-transfer-encoding"] || "").toLowerCase();
  let buffer;
  if (encoding.includes("base64")) {
    buffer = Buffer.from(body.replace(/\s+/g, ""), "base64");
  } else if (encoding.includes("quoted-printable")) {
    buffer = decodeQuotedPrintable(body);
  } else {
    buffer = Buffer.from(body, "binary");
  }

  if (isValidResumeAttachmentBuffer(buffer, filename)) {
    attachments.push({
      filename: filename || "邮箱简历.pdf",
      buffer,
    });
  }
  return attachments;
}

function extractImapLiteral(responseText = "") {
  const match = responseText.match(/\{(\d+)\}\r\n/i);
  if (!match) return "";
  const start = match.index + match[0].length;
  const length = Number(match[1]);
  return responseText.slice(start, start + length);
}

function parseSearchUids(responseText = "") {
  const line = String(responseText)
    .split(/\r?\n/)
    .find((item) => /^\* SEARCH/i.test(item));
  if (!line) return [];
  return line
    .replace(/^\* SEARCH/i, "")
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

const IMAP_SEARCH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatImapSearchDate(date = new Date()) {
  return `${date.getDate()}-${IMAP_SEARCH_MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function addLocalDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getEmailSearchCommand() {
