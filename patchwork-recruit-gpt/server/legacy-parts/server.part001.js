      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        const parsedText = normalizeRuleSuggestionText(parsed);
        if (parsedText) return parsedText;
      } catch {
        // Keep the original text when it only looks like JSON.
      }
    }
    return trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeRuleSuggestionText(item))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value !== "object") return String(value || "").trim();

  const lines = [];
  const primary =
    value.suggestion ||
    value.rule ||
    value.change ||
    value.title ||
    value.summary ||
    value.description ||
    value.content ||
    value.text;
  const dimension = value.dimension || value.category || value.field || value.target || value.scope;
  const reason = value.reason || value.rationale || value.why;
  const evidence = value.evidence || value.example || value.examples || value.case;
  const before = value.before || value.oldRule || value.from;
  const after = value.after || value.newRule || value.to;
  const score = value.scoreDelta ?? value.weight ?? value.points ?? value.score;

  if (primary && primary !== value) lines.push(normalizeRuleSuggestionText(primary));
  if (dimension) lines.push(`维度：${normalizeRuleSuggestionText(dimension)}`);
  if (reason) lines.push(`原因：${normalizeRuleSuggestionText(reason)}`);
  if (evidence) lines.push(`依据：${normalizeRuleSuggestionText(evidence)}`);
  if (before || after) {
    lines.push(`调整：${normalizeRuleSuggestionText(before) || "-"} -> ${normalizeRuleSuggestionText(after) || "-"}`);
  }
  if (score !== undefined && score !== null && score !== "") {
    lines.push(`分值/权重：${normalizeRuleSuggestionText(score)}`);
  }

  if (lines.length) return lines.filter(Boolean).join("\n");

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "").trim();
  }
}

function normalizeRuleSuggestionArray(value) {
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => normalizeRuleSuggestionText(item))
    .filter(Boolean);
}

function sanitizeFeedback(input = {}) {
  const decision = String(input.decision || "pending").trim();
  const allowedDecisions = new Set(["suitable", "unsuitable", "pending", "interview"]);
  return {
    decision: allowedDecisions.has(decision) ? decision : "pending",
    positiveTags: normalizeStringArray(input.positiveTags),
    negativeTags: normalizeStringArray(input.negativeTags),
    dimensions: normalizeStringArray(input.dimensions),
    reason: String(input.reason || "").trim(),
    affectsScoring: Boolean(input.affectsScoring),
    reviewedAt: "",
    review: null,
  };
}

function publicRuleSuggestion(row) {
  const payload = parsePayload(row.payload, {});
  return {
    id: row.id,
    resumeId: row.resume_id,
    jobType: normalizeJobType(row.job_type || payload.jobType || DEFAULT_JOB_TYPE),
    suggestion:
      normalizeRuleSuggestionText(row.suggestion) ||
      normalizeRuleSuggestionText(payload.suggestion) ||
      normalizeRuleSuggestionText(payload.suggestedRuleChanges),
    status: row.status,
    sourceSummary: row.source_summary || "",
    resumeName: payload.resumeName || "",
    resumePhone: payload.resumePhone || "",
    createdAt: row.created_at,
    adoptedAt: row.adopted_at || "",
    rejectedAt: row.rejected_at || "",
  };
}

function listRuleSuggestionRows(jobType = "") {
  const normalizedJobType = jobType ? normalizeJobType(jobType) : "";
  const whereClause = normalizedJobType ? "WHERE job_type = ?" : "";
  const statement = getDb().prepare(
    `SELECT id, resume_id, job_type, suggestion, status, source_summary, payload, created_at, adopted_at, rejected_at, updated_at
     FROM rule_suggestions
     ${whereClause}
     ORDER BY
       CASE status WHEN 'pending' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END,
       created_at DESC`
  );
  return normalizedJobType ? statement.all(normalizedJobType) : statement.all();
}

function createRuleSuggestionsFromFeedback(record, feedback) {
  const suggestions = normalizeRuleSuggestionArray(feedback?.review?.suggestedRuleChanges).slice(0, 12);
  if (!feedback?.affectsScoring || !suggestions.length) return [];

  const now = new Date().toISOString();
  const inserted = [];
  const db = getDb();
  const jobType = normalizeJobType(record.jobType || DEFAULT_JOB_TYPE);
  const insert = db.prepare(`
    INSERT INTO rule_suggestions
      (id, resume_id, job_type, suggestion, status, source_summary, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `);

  suggestions.forEach((suggestion) => {
    const id = crypto.randomUUID();
    insert.run(
      id,
      record.id,
      jobType,
      suggestion,
      feedback.review?.summary || "",
      JSON.stringify({
        jobType,
        resumeName: record.name || "",
        resumePhone: record.phone || "",
        decision: feedback.decision,
        positiveTags: feedback.positiveTags,
        negativeTags: feedback.negativeTags,
        dimensions: feedback.dimensions,
        reason: feedback.reason,
        scoreDiagnosis: feedback.review?.scoreDiagnosis || "",
        suggestedRuleChanges: suggestions,
      }),
      now,
      now
    );
    inserted.push(id);
  });

  return inserted;
}

function getAdoptedRulesText() {
  try {
    const rows = listAdoptedRuleRows();

    if (!rows.length) return "";
    return `\n\n以下是人工审核后已采纳的评分规则补充，后续解析和评分必须参考：\n${rows
      .map((row, index) => `${index + 1}. 【${normalizeJobType(row.job_type || DEFAULT_JOB_TYPE)}】${normalizeRuleSuggestionText(row.suggestion)}`)
      .filter((line) => !line.endsWith("】"))
      .join("\n")}`;
  } catch {
    return "";
  }
}

function listAdoptedRuleRows(limit = 30, jobType = "") {
  const normalizedJobType = jobType ? normalizeJobType(jobType) : "";
  const whereClause = normalizedJobType ? "WHERE status = 'adopted' AND job_type = ?" : "WHERE status = 'adopted'";
  const statement = getDb().prepare(
    `SELECT id, resume_id, job_type, suggestion, source_summary, payload, created_at, adopted_at
     FROM rule_suggestions
     ${whereClause}
     ORDER BY adopted_at ASC, created_at ASC
     LIMIT ?`
  );
  return normalizedJobType ? statement.all(normalizedJobType, limit) : statement.all(limit);
}

function getCurrentScoringVersion(jobType = DEFAULT_JOB_TYPE) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const baseMeta = getBaseScoringMeta(normalizedJobType);

  try {
    const adoptedCount = getDb()
      .prepare("SELECT COUNT(*) AS count FROM rule_suggestions WHERE status = 'adopted' AND job_type = ?")
      .get(normalizedJobType).count;
    return adoptedCount ? `${baseMeta.version}+rules-${adoptedCount}` : baseMeta.version;
  } catch {
    return baseMeta.version;
  }
}

function getScoringVersionMeta(version = "", jobType = DEFAULT_JOB_TYPE) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const baseMeta = getBaseScoringMeta(normalizedJobType);
  const rawVersion = String(version || getCurrentScoringVersion(normalizedJobType) || baseMeta.version);
  const match = rawVersion.match(/^(.+?)(?:\+rules-(\d+))?$/);
  const baseVersion = match?.[1] || rawVersion;
  const adoptedRuleCount = match?.[2] ? Number(match[2]) : 0;
  const isKnownBase = baseVersion === baseMeta.version;

  return {
    version: rawVersion,
    baseVersion,
    displayName: isKnownBase ? baseMeta.name : `评分版本 ${baseVersion}`,
    description: isKnownBase ? baseMeta.description : SCORING_VERSION_DESCRIPTION,
    adoptedRuleCount,
    ruleScope: adoptedRuleCount
      ? `${baseMeta.ruleScope} + ${adoptedRuleCount} 条人工补充规则`
      : baseMeta.ruleScope,
    isCurrent: rawVersion === getCurrentScoringVersion(normalizedJobType),
  };
}

function getAppliedAdoptedRulesForVersion(version = "", jobType = DEFAULT_JOB_TYPE) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);

  const rawVersion = String(version || "");
  if (!rawVersion) return listAdoptedRuleRows(30, normalizedJobType);

  const match = rawVersion.match(/\+rules-(\d+)$/);
  const limit = match?.[1] ? Number(match[1]) : 0;
  return limit > 0 ? listAdoptedRuleRows(limit, normalizedJobType) : [];
}

function getPositionScoringDefinition(jobType) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const direct = POSITION_SCORING_RULES[normalizedJobType] || null;
  if (!direct) return null;
  if (!direct.inherit) return direct;
  const base = POSITION_SCORING_RULES[direct.inherit] || {};
  return {
    ...base,
    ...direct,
    mustHave: direct.mustHave || base.mustHave || [],
    bonus: direct.bonus || base.bonus || [],
    risks: direct.risks || base.risks || [],
  };
}

function buildPositionScoringDimensions(definition = {}) {
  return [
    {
      name: "必须项",
      weight: "优先级最高",
      logic: "必须项用于判断候选人是否进入后续复核；缺失时不要因为关键词或加分项给高优先级。",
      items: definition.mustHave || [],
    },
    {
      name: "加分项",
      weight: "排序增强",
      logic: "加分项用于区分优先级；命中越多越值得优先看，但不能替代必须项。",
      items: definition.bonus || [],
    },
    {
      name: "风险项",
      weight: "降级/复核",
      logic: "风险项命中时需要降级或人工复核，避免纯关键词匹配误判。",
      items: definition.risks || [],
    },
  ].filter((dimension) => dimension.items.length);
}

function truncateFeedbackTag(text, maxLength = 28) {
  const value = String(text || "")
    .replace(/[。；;，,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function uniqueLimitedStrings(values, limit = 14) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function buildFeedbackTagOptions(jobType, definition = null) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const mustHave = Array.isArray(definition?.mustHave) ? definition.mustHave : [];
  const bonus = Array.isArray(definition?.bonus) ? definition.bonus : [];
  const risks = Array.isArray(definition?.risks) ? definition.risks : [];

  if (!definition) {
    return {
      positiveTags: ["基础信息完整", "岗位归类可信", "经历可复核", "表达清楚"],
      negativeTags: ["基础信息不足", "岗位归类存疑", "经历不清楚", "需要人工复核"],
      dimensions: ["岗位归类", "基础信息", "经历完整度", "表达质量", "人工复核"],
    };
  }

  return {
    positiveTags: uniqueLimitedStrings([
      "必须项满足",
      "加分项突出",
      `${normalizedJobType}岗位匹配`,
      ...mustHave.map((item) => `满足：${truncateFeedbackTag(item)}`),
      ...bonus.map((item) => `加分：${truncateFeedbackTag(item)}`),
      "经历真实完整",
      "表达沟通好",
    ]),
    negativeTags: uniqueLimitedStrings([
      "必须项缺失",
      "信息不足",
      "表达不清",
      `${normalizedJobType}岗位不匹配`,
      ...mustHave.map((item) => `缺失：${truncateFeedbackTag(item)}`),
      ...risks.map((item) => `风险：${truncateFeedbackTag(item)}`),
    ]),
    dimensions: uniqueLimitedStrings([
      "必须项",
      "加分项",
      "风险项",
      `${normalizedJobType}岗位适配`,
      "行业/产品经验",
      "项目或职责证据",
      "学历专业",
      "表达质量",
      "信息完整度",
    ], 12),
  };
}

function getCurrentScoringRules(jobType, version = "") {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const scoringVersion = String(version || getCurrentScoringVersion(normalizedJobType));
  const versionMeta = getScoringVersionMeta(scoringVersion, normalizedJobType);
  const scoringDefinition = getPositionScoringDefinition(normalizedJobType);
  const isAiV4 = isAiScoringJobType(normalizedJobType);

  if (!scoringDefinition) {
    return {
      jobType: normalizedJobType,
      scoringVersion,
      versionMeta,
      rules: {
        title: `${normalizedJobType}评分规则`,
        description:
          "当前岗位还没有配置专属必须项和加分项，暂时只做简历基础信息提取、岗位归类和人工复核。",
        dimensions: [],
        scoreBands: [
          "优先补齐该岗位的必须项、加分项和风险项。",
          "未配置前不要自动给出高优先级判断。"
        ],
      },
      feedbackTags: buildFeedbackTagOptions(normalizedJobType, null),
    };
  }

  return {
    jobType: normalizedJobType,
    scoringVersion,
    versionMeta,
    rules: {
      title: scoringDefinition.title || `${normalizedJobType}评分规则`,
      description: isAiV4
        ? AI_V4_SCORING_VERSION_DESCRIPTION
        : scoringDefinition.description || "按岗位必须项、加分项和风险项进行复核。",
      dimensions: isAiV4 ? buildAiV4ScoringDimensions(scoringDefinition) : buildPositionScoringDimensions(scoringDefinition),
      scoreBands: isAiV4
        ? [
            "项目经历最多 65 分：必须先有Agent/RAG/大模型应用项目门槛，再看项目证据、本人职责、工程落地和模块深度。",
            "技术栈最多 35 分：重点看LLM Agent、RAG、工具调用、Prompt、大模型、后端服务化和部署能力。",
            "三条已采纳回灌会额外影响人工复核方向：LoRA/QLoRA微调能力、Agent能力纵深、RAG技术深度校验。",
          ]
        : [
            "A：必须项明确满足，并命中多个高价值加分项，建议优先查看。",
            "B：必须项基本满足，有部分加分项，建议进入人工复核。",
            "C：必须项信息不足，或只命中少量加分项，暂缓判断。",
            "D：关键必须项缺失，或命中明显风险项，建议跳过或人工确认。",
          ],
    },
    feedbackTags: buildFeedbackTagOptions(normalizedJobType, scoringDefinition),
  };
}

function readJdTagOverrides() {
  try {
    const payload = JSON.parse(fsSync.readFileSync(JD_TAG_OVERRIDES_PATH, "utf8"));
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

async function writeJdTagOverrides(overrides) {
  await fs.mkdir(path.dirname(JD_TAG_OVERRIDES_PATH), { recursive: true });
  await fs.writeFile(JD_TAG_OVERRIDES_PATH, JSON.stringify(overrides || {}, null, 2), "utf8");
}

function normalizeJdTagGroup(group) {
  const value = String(group || "").trim();
  if (value === "mustHave" || value === "bonus" || value === "risks") return value;
  if (/risk|风险/i.test(value)) return "risks";
  if (/bonus|加分/i.test(value)) return "bonus";
  return "mustHave";
}

function uniqueJdTags(values, limit = 80) {
  const seen = new Set();
  const tags = [];
  for (const value of values || []) {
    const tag = String(value || "").trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= limit) break;
  }
  return tags;
}

function applyJdTagOverrides(profileId, group, baseTags, overrides = readJdTagOverrides()) {
  const entry = overrides?.[profileId]?.[group] || {};
  const removed = new Set(normalizeStringArray(entry.removed));
  return uniqueJdTags([...normalizeStringArray(baseTags), ...normalizeStringArray(entry.added)]).filter((tag) => !removed.has(tag));
}

function buildJdDimensions(profileId, scoringDefinition, overrides = readJdTagOverrides()) {
  const mustHave = applyJdTagOverrides(profileId, "mustHave", scoringDefinition?.mustHave || [], overrides);
  const bonus = applyJdTagOverrides(profileId, "bonus", scoringDefinition?.bonus || [], overrides);
  const risks = applyJdTagOverrides(profileId, "risks", scoringDefinition?.risks || [], overrides);
  return [
    {
      key: "mustHave",
      name: "必须项",
      weight: "45%",
      logic: "必须项是 JD 匹配的主体；完全缺失时会限制最终等级。",
      tags: mustHave,
    },
    {
      key: "bonus",
      name: "加分项",
      weight: "35%",
      logic: "加分项用于区分优先级，命中越多越靠前。",
      tags: bonus,
    },
    {
      key: "risks",
      name: "风险项",
      weight: "降级",
      logic: "风险项命中时会扣分，并进入人工复核。",
      tags: risks,
    },
  ].filter((dimension) => dimension.tags.length);
}

function buildJdProfile(definition, overrides = readJdTagOverrides()) {
  const scoringDefinition = getPositionScoringDefinition(definition.jobType) || {};
  const dimensions = buildJdDimensions(definition.id, scoringDefinition, overrides);
  const tags = uniqueJdTags(dimensions.flatMap((dimension) => dimension.tags));
  return {
    id: definition.id,
    title: scoringDefinition.title || `${definition.jobType} JD 匹配`,
    shortTitle: definition.shortTitle || definition.jobType,
    matchedJobTypes: uniqueJdTags(definition.matchedJobTypes || [definition.jobType]),
    sourceJobNames: uniqueJdTags([definition.jobType, ...(definition.matchedJobTypes || [])]),
    targetRoles: uniqueJdTags(definition.targetRoles || [definition.jobType]),
    sources: [{ name: `${definition.jobType}岗位评分规则` }],
    tags,
    rules: {
      title: scoringDefinition.title || `${definition.jobType} JD 匹配规则`,
      description: scoringDefinition.description || "根据岗位必须项、加分项和风险项进行 JD 匹配。",
      targetRoles: uniqueJdTags(definition.targetRoles || [definition.jobType]),
      sourceJobNames: uniqueJdTags([definition.jobType, ...(definition.matchedJobTypes || [])]),
      matchedJobTypes: uniqueJdTags(definition.matchedJobTypes || [definition.jobType]),
      tags,
      dimensions,
      synonymHints: [
        "销售/客户开发/商务拓展可互相参考。",
        "技术支持/应用测试/配方服务可互相参考。",
        "HRBP/人力资源/招聘支持可互相参考。",
      ],
      reviewChecklist: [
        "先看必须项是否有明确证据。",
        "再看加分项是否来自真实项目或工作经历。",
        "命中风险项时不要只按关键词高排。",
      ],
      boosts: [
        "简历岗位归属与当前 JD 一致时加权。",
        "文件名、专业、经历中出现岗位核心词时加权。",
      ],
      scoreBands: [
        "A：75 分及以上，必须项和加分项都有较好命中。",
        "B：55-74 分，基本匹配，建议人工复核。",
        "C：35-54 分，信息不足或只命中部分标签。",
        "D：35 分以下，关键项缺失或风险较多。",
      ],
      guardrails: [
        "必须项完全未命中时最高 C。",
        "风险项命中 2 条及以上时最高 B。",
      ],
    },
  };
}

function listJdProfiles() {
  const overrides = readJdTagOverrides();
  return JD_PROFILE_DEFINITIONS.map((definition) => buildJdProfile(definition, overrides));
}

function findJdProfile(profileId) {
  const id = String(profileId || "").trim();
  return listJdProfiles().find((profile) => profile.id === id) || null;
}

function normalizeJdSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getResumeSearchText(record = {}) {
  return normalizeJdSearchText(
    [
      record.name,
      record.phone,
      record.jobType,
      record.major,
      record.school,
      record.schoolLevel,
      record.graduation,
      record.fileName,
      JSON.stringify(record.projects || []),
      JSON.stringify(record.scoreBreakdown || {}),
      JSON.stringify(record.parseQuality || {}),
      JSON.stringify(record.feedback || {}),
    ].join(" ")
  );
}

function buildAiV4ResumeMatchText(record = {}) {
  return [
    record.name,
    record.phone,
    record.jobType,
    record.major,
    record.school,
    record.schoolLevel,
    record.graduation,
    record.fileName,
    record.source,
    record.sourceLabel,
    JSON.stringify(record.projects || []),
    JSON.stringify(record.parseQuality?.warnings || []),
  ].join(" ");
}

function getAiV4RuleHitLabels(text, rules = []) {
  const source = String(text || "");
  return rules.filter((rule) => rule.pattern.test(source)).map((rule) => rule.label);
}

function calculateAiV4MatchScoreDetails(text) {
  const source = String(text || "");
  const hasAgentProject = AI_V4_AGENT_PROJECT_GATE_PATTERNS.some((pattern) => pattern.test(source));
  const projectHits = hasAgentProject ? getAiV4RuleHitLabels(source, AI_V4_PROJECT_RULES) : [];
  const skillHits = getAiV4RuleHitLabels(source, AI_V4_SKILL_RULES);
  const projectScoreRaw = (projectHits.length / AI_V4_PROJECT_RULES.length) * 65;
  const techScoreRaw = (skillHits.length / AI_V4_SKILL_RULES.length) * 35;

  return {
    score: Math.max(0, Math.min(100, Math.round(projectScoreRaw + techScoreRaw))),
    projectScore: Math.max(0, Math.min(65, Math.round(projectScoreRaw))),
    techScore: Math.max(0, Math.min(35, Math.round(techScoreRaw))),
    projectHits,
    skillHits,
    hasAgentProject,
  };
}

function buildAiV4ScoringDimensions() {
  return [
    {
      name: "项目经历",
      weight: "65分",
      logic: "先命中Agent/RAG/大模型应用项目门槛，再按项目证据、本人职责、工程落地和Agent/RAG模块深度计分。",
      items: AI_V4_PROJECT_RULES.map((rule) => rule.label),
    },
    {
      name: "技术栈",
      weight: "35分",
      logic: "按LLM Agent开发栈、RAG、工具调用、Prompt、大模型、后端服务化和部署能力计分。",
      items: AI_V4_SKILL_RULES.map((rule) => rule.label),
    },
  ];
}

function cleanJdKeyword(value) {
  return String(value || "")
    .replace(/^(有|懂|熟悉|具备|能够|能接受|接受|必须|需要|优先|同时|明确|重点看)/, "")
    .replace(/(之一|优先|作为核心判断项|相关|经验|经历|背景|能力|方向|岗位)$/g, "")
    .replace(/[“”"'.。；;，,]+/g, "")
    .trim();
}

function extractJdKeywords(tags = []) {
  const values = [];
  for (const tag of tags || []) {
    const text = String(tag || "");
    const parts = text.split(/[，,。、；;：:（）()\s/]+|或|和|及|与|、/g);
    for (const part of parts) {
      const clean = cleanJdKeyword(part);
      if (clean.length >= 2 && !JD_MATCH_STOP_WORDS.has(clean)) values.push(clean);
    }
    const latin = text.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) || [];
    values.push(...latin);
  }
  return uniqueJdTags(values, 120);
}

function matchJdKeywords(tags, searchText) {
  const matched = [];
  for (const keyword of extractJdKeywords(tags)) {
    const normalized = normalizeJdSearchText(keyword);
    if (normalized.length >= 2 && searchText.includes(normalized)) matched.push(keyword);
  }
  return uniqueJdTags(matched, 60);
}

function matchJdRuleItems(tags, searchText) {
  const matchedItems = [];
  const matchedKeywords = [];
  for (const tag of tags || []) {
    const keywords = extractJdKeywords([tag]);
    const itemMatches = keywords.filter((keyword) => {
      const normalized = normalizeJdSearchText(keyword);
      return normalized.length >= 2 && searchText.includes(normalized);
    });
    if (!itemMatches.length) continue;
    matchedItems.push(tag);
    matchedKeywords.push(...itemMatches);
  }
  return {
    items: uniqueJdTags(matchedItems, 60),
    keywords: uniqueJdTags(matchedKeywords, 60),
  };
}

function profileMatchesResume(profile, record) {
  const recordJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const matchedJobTypes = new Set((profile?.matchedJobTypes || []).map((jobType) => normalizeJobType(jobType)));
  return matchedJobTypes.size === 0 || matchedJobTypes.has(recordJobType);
}

function getJdLevel(score) {
  if (score >= 75) return "A 优先";
  if (score >= 55) return "B 复核";
  if (score >= 35) return "C 暂缓";
  return "D 不优先";
}

function calculateJdMatch(record, profile) {
  const searchText = getResumeSearchText(record);
  const dimensions = profile.rules?.dimensions || [];
  const must = dimensions.find((dimension) => dimension.key === "mustHave") || { tags: [] };
  const bonus = dimensions.find((dimension) => dimension.key === "bonus") || { tags: [] };
  const risks = dimensions.find((dimension) => dimension.key === "risks") || { tags: [] };
  const mustMatches = matchJdRuleItems(must.tags, searchText);
  const bonusMatches = matchJdRuleItems(bonus.tags, searchText);
  const riskMatches = matchJdRuleItems(risks.tags, searchText);
  const matchedKeywords = uniqueJdTags([...mustMatches.keywords, ...bonusMatches.keywords, ...riskMatches.keywords], 30);
  const mustRatio = must.tags?.length ? mustMatches.items.length / Math.max(1, must.tags.length) : 0;
  const bonusRatio = bonus.tags?.length ? bonusMatches.items.length / Math.max(1, bonus.tags.length) : 0;
  const recordJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const roleBoost = (profile.matchedJobTypes || []).some((jobType) => normalizeJobType(jobType) === recordJobType) ? 15 : 0;
  const focusBoost = matchedKeywords.some((keyword) => searchText.includes(normalizeJdSearchText(keyword))) ? 5 : 0;
  const riskPenalty = Math.min(30, riskMatches.items.length * 10);
  let score = Math.round(mustRatio * 50 + bonusRatio * 30 + roleBoost + focusBoost - riskPenalty);
  const capReasons = [];
  if ((must.tags || []).length && !mustMatches.items.length) {
    score = Math.min(score, 45);
    capReasons.push("必须项未命中");
  }
  if ((must.tags || []).length && mustRatio > 0 && mustRatio < 0.5) {
    score = Math.min(score, 68);
    capReasons.push("必须项命中不足一半");
  }
  if (riskMatches.items.length >= 2) {
    score = Math.min(score, 74);
    capReasons.push("风险项较多");
  }
  score = Math.max(0, Math.min(100, score));
  const level = getJdLevel(score);
  return {
    resumeId: record.id,
    name: record.name || "",
    phone: record.phone || "",
    jobType: recordJobType,
    score,
    level,
    profileId: profile.id,
    profileTitle: profile.title,
    profileShortTitle: profile.shortTitle,
    matchedKeywords,
    suggestion: score >= 75 ? "建议优先查看" : score >= 55 ? "建议人工复核" : score >= 35 ? "信息不足，暂缓判断" : "不建议优先处理",
    breakdown: {
      core: mustMatches.items.length,
      industry: bonusMatches.items.length,
      capability: matchedKeywords.length,
      education: 0,
      bonus: bonusMatches.items.length,
      riskPenalty,
      roleBoost,
      focusBoost,
      capReasons,
    },
  };
}

function summarizeJdCounts(results = []) {
  const counts = { total: results.length, A: 0, B: 0, C: 0, D: 0 };
  for (const result of results) {
    const key = String(result.level || "D").charAt(0);
    if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
  }
  return counts;
}

function buildAutoJdProfileForJobType(jobType) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  if (!getPositionScoringDefinition(normalizedJobType)) return null;
  return buildJdProfile({
    id: `auto_${normalizedJobType}`,
    jobType: normalizedJobType,
    shortTitle: normalizedJobType,
    matchedJobTypes: [normalizedJobType],
    targetRoles: [normalizedJobType],
  });
}

function findPositionRuleProfileForRecord(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const profiles = listJdProfiles().filter((profile) =>
    profileMatchesResume(profile, { ...record, jobType: normalizedJobType })
  );
  if (profiles.length) {
    return (
      profiles.find((profile) =>
        [...(profile.sourceJobNames || []), ...(profile.matchedJobTypes || [])].some(
          (jobType) => normalizeJobType(jobType) === normalizedJobType
        )
      ) || profiles[0]
    );
  }
  return buildAutoJdProfileForJobType(normalizedJobType);
}

function calculatePositionRuleMatch(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const profile = findPositionRuleProfileForRecord({ ...record, jobType: normalizedJobType });
  if (!profile) return null;
  return calculateJdMatch({ ...record, jobType: normalizedJobType }, profile);
}

function applyAiV4Scoring(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || AI_SCORING_JOB_TYPE, `${record.fileName || ""} ${record.name || ""}`);
  const existingBreakdown = record.scoreBreakdown && typeof record.scoreBreakdown === "object" ? record.scoreBreakdown : {};
  const aiScore = calculateAiV4MatchScoreDetails(buildAiV4ResumeMatchText({ ...record, jobType: normalizedJobType }));
  const hitEvidence = uniqueLimitedStrings([...aiScore.projectHits, ...aiScore.skillHits], 8);

  return {
    ...record,
    jobType: normalizedJobType,
    matchScore: aiScore.score,
    jdMatch: null,
    scoreBreakdown: {
      ...existingBreakdown,
      projectScore: aiScore.projectScore,
      techScore: aiScore.techScore,
      summary: `v4 Agent项目深度评分 ${aiScore.score} 分：项目经历 ${aiScore.projectScore}/65，技术栈 ${aiScore.techScore}/35。`,
      strengths: uniqueLimitedStrings(
        [
          ...aiScore.projectHits.map((item) => `项目命中：${item}`),
          ...aiScore.skillHits.map((item) => `技术命中：${item}`),
        ],
        8
      ),
      risks: aiScore.hasAgentProject
        ? normalizeStringArray(existingBreakdown.risks).filter((item) => !/必须项|风险项扣分|命中不足/.test(item)).slice(0, 8)
        : uniqueLimitedStrings(["未命中Agent/RAG/大模型应用项目门槛"], 8),
      evidence: hitEvidence,
    },
    scoringVersion: getCurrentScoringVersion(normalizedJobType),
  };
}

function applyPositionRuleScoring(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  if (isNoScoreDirectImportJobType(normalizedJobType)) {
    const existingBreakdown = record.scoreBreakdown && typeof record.scoreBreakdown === "object" ? record.scoreBreakdown : {};
    return {
      ...record,
      jobType: normalizedJobType,
      matchScore: "",
      jdMatch: null,
      scoreBreakdown: {
        ...existingBreakdown,
        projectScore: "",
        techScore: "",
        summary: "该岗位配置为免评分直接入库。",
        strengths: normalizeStringArray(existingBreakdown.strengths).slice(0, 8),
        risks: normalizeStringArray(existingBreakdown.risks).slice(0, 8),
        evidence: uniqueLimitedStrings([
          ...normalizeStringArray(existingBreakdown.evidence),
          "direct-import-no-score",
        ], 8),
      },
      scoringVersion: getCurrentScoringVersion(normalizedJobType),
    };
  }
  if (isAiScoringJobType(normalizedJobType)) {
    return applyAiV4Scoring({ ...record, jobType: normalizedJobType });
  }

  const scoringResult = calculatePositionRuleMatch({ ...record, jobType: normalizedJobType });
  if (!scoringResult) {
    return {
      ...record,
      jobType: normalizedJobType,
      matchScore: normalizeScoreValue(record.matchScore),
      scoringVersion: getCurrentScoringVersion(normalizedJobType),
    };
  }

  const existingBreakdown = record.scoreBreakdown && typeof record.scoreBreakdown === "object" ? record.scoreBreakdown : {};
  const matchedKeywords = normalizeStringArray(scoringResult.matchedKeywords).slice(0, 8);
  const capReasons = normalizeStringArray(scoringResult.breakdown?.capReasons).slice(0, 4);
  const ruleRisks = [
    ...capReasons,
    scoringResult.breakdown?.riskPenalty ? `风险项扣分 ${scoringResult.breakdown.riskPenalty}` : "",
  ].filter(Boolean);

  return {
    ...record,
    jobType: normalizedJobType,
    matchScore: scoringResult.score,
    scoreBreakdown: {
      ...existingBreakdown,
      summary: `规则评分 ${scoringResult.score} 分（${scoringResult.level}）：${scoringResult.suggestion}`,
      strengths: uniqueLimitedStrings(
        [
          ...normalizeStringArray(existingBreakdown.strengths),
          ...matchedKeywords.map((keyword) => `命中：${keyword}`),
        ],
        8
      ),
      risks: uniqueLimitedStrings([...normalizeStringArray(existingBreakdown.risks), ...ruleRisks], 8),
      evidence: uniqueLimitedStrings(
        [
          ...normalizeStringArray(existingBreakdown.evidence),
          ...matchedKeywords,
          scoringResult.profileShortTitle ? `规则：${scoringResult.profileShortTitle}` : "",
        ],
        8
      ),
    },
    scoringVersion: getCurrentScoringVersion(normalizedJobType),
  };
}

function recordsNeedScoreUpdate(left = {}, right = {}) {
  return (
    String(left.jobType || "") !== String(right.jobType || "") ||
    String(left.matchScore ?? "") !== String(right.matchScore ?? "") ||
    String(left.scoringVersion || "") !== String(right.scoringVersion || "") ||
    JSON.stringify(left.scoreBreakdown || {}) !== JSON.stringify(right.scoreBreakdown || {})
  );
}

function publicRecord(record) {
  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    gender: record.gender || "",
    jobType: normalizeJobType(record.jobType, `${record.fileName || ""} ${record.name || ""} ${record.school || ""}`),
    school: record.school,
    major: record.major || "",
    schoolLevel: normalizeSchoolLevel(record.schoolLevel, record.school),
    graduation: record.graduation,
    matchScore: record.matchScore ?? "",
    scoreBreakdown: record.scoreBreakdown || null,
    parseQuality: record.parseQuality || null,
    projects: Array.isArray(record.projects) ? record.projects : [],
    fileName: record.fileName || "",
    parseMode: record.parseMode || "",
    source: record.source || "",
    sourceLabel: record.sourceLabel || "",
    sourceName: record.sourceName || "",
    sourcePlatform: record.sourcePlatform || "",
    platform: record.platform || "",
    importSource: record.importSource || "",
    accountId: record.accountId || "",
    accountName: record.accountName || "",
    sourceKey: record.sourceKey || "",
    platformCandidateId: record.platformCandidateId || "",
    conversationKey: record.conversationKey || "",
    candidateIdentityKey: record.candidateIdentityKey || "",
    detailUrl: record.detailUrl || "",
    platformContact: record.platformContact || null,
    interviewInvite: record.interviewInvite || null,
    interviewEvaluation: record.interviewEvaluation || null,
    hasPdf: Boolean(record.pdfPath),
    scoringVersion: record.scoringVersion || getCurrentScoringVersion(record.jobType),
    scoringVersionMeta: getScoringVersionMeta(record.scoringVersion || getCurrentScoringVersion(record.jobType), record.jobType),
    feedback: record.feedback || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function publicResumeListRecord(record) {
  const contact = record.platformContact && typeof record.platformContact === "object" ? record.platformContact : null;
  const invite = record.interviewInvite && typeof record.interviewInvite === "object" ? record.interviewInvite : null;
  const feedback = record.feedback && typeof record.feedback === "object" ? record.feedback : null;
  const parseQuality = record.parseQuality && typeof record.parseQuality === "object" ? record.parseQuality : null;
  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    gender: record.gender || "",
    jobType: normalizeJobType(record.jobType, `${record.fileName || ""} ${record.name || ""} ${record.school || ""}`),
    school: record.school,
    major: record.major || "",
    schoolLevel: normalizeSchoolLevel(record.schoolLevel, record.school),
    graduation: record.graduation,
    matchScore: record.matchScore ?? "",
    fileName: record.fileName || "",
    parseMode: record.parseMode || "",
    source: record.source || "",
    sourceLabel: record.sourceLabel || "",
    sourceName: record.sourceName || "",
    sourcePlatform: record.sourcePlatform || "",
    platform: record.platform || "",
    importSource: record.importSource || "",
    accountId: record.accountId || "",
    accountName: record.accountName || "",
    sourceKey: record.sourceKey || "",
    platformCandidateId: record.platformCandidateId || "",
    conversationKey: record.conversationKey || "",
    candidateIdentityKey: record.candidateIdentityKey || "",
    detailUrl: record.detailUrl || "",
    platformContact: contact
      ? {
          displayName: contact.displayName || "",
          label: contact.label || "",
          appliedPosition: contact.appliedPosition || "",
          capturedAt: contact.capturedAt || "",
          chatEvidenceCount: Array.isArray(contact.chatEvidence) ? contact.chatEvidence.length : 0,
        }
      : null,
    interviewInvite: invite
      ? {
          status: invite.status || "",
          message: invite.message || "",
          reason: invite.reason || "",
          platform: invite.platform || "",
          accountId: invite.accountId || "",
          sourceKey: invite.sourceKey || "",
          sourceLabel: invite.sourceLabel || "",
          searchName: invite.searchName || "",
          dryRun: Boolean(invite.dryRun),
          bridged: Boolean(invite.bridged),
          sentAt: invite.sentAt || "",
          updatedAt: invite.updatedAt || "",
        }
      : null,
    interviewEvaluation:
      record.interviewEvaluation && typeof record.interviewEvaluation === "object"
        ? {
            overallRecommendation: record.interviewEvaluation.overallRecommendation || "",
            summary: record.interviewEvaluation.summary || "",
            humanReviewRequired: Boolean(record.interviewEvaluation.humanReviewRequired),
            updatedAt: record.interviewEvaluation.updatedAt || "",
          }
        : null,
    hasPdf: Boolean(record.pdfPath),
    parseQuality: parseQuality
      ? {
          needsManualReview: Boolean(parseQuality.needsManualReview),
          confidence: parseQuality.confidence ?? "",
          warningCount: Array.isArray(parseQuality.warnings) ? parseQuality.warnings.length : 0,
          missingFieldCount: Array.isArray(parseQuality.missingFields) ? parseQuality.missingFields.length : 0,
        }
      : null,
    feedback: feedback
      ? {
          decision: feedback.decision || "pending",
          reason: feedback.reason || "",
          affectsScoring: Boolean(feedback.affectsScoring),
          updatedAt: feedback.updatedAt || "",
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function createRecordPayload(body = {}) {
  const nestedResume = body.resume && typeof body.resume === "object" ? body.resume : {};
  const source = {
    ...nestedResume,
    ...body,
    fileName: body.fileName || body.filename || nestedResume.fileName || nestedResume.filename || "",
    parseMode: body.parseMode || nestedResume.parseMode || "",
  };
  const fields = sanitizeResumeFields(source);
  const details = sanitizeResumeDetails(source);
  const sourceMeta = buildResumeSourceMetadata(source);
  const automationIdentityMeta = buildResumeAutomationIdentityMetadata(source);
  const now = new Date().toISOString();
  return applyPositionRuleScoring({
    id: crypto.randomUUID(),
    ...fields,
    ...details,
    fileName: String(source.fileName || "").trim(),
    parseMode: String(source.parseMode || "").trim(),
    ...sourceMeta,
    ...automationIdentityMeta,
    pdfPath: "",
    scoringVersion: getCurrentScoringVersion(fields.jobType),
    feedback: null,
    createdAt: now,
    updatedAt: now,
  });
}

function getBossBrowserStartHint() {
  return [
    "请用普通 Chrome/Edge 启动一个调试浏览器并登录 BOSS：",
    'chrome.exe --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\Documents\\New project\\招聘智能体\\data\\boss-browser-profile"',
    "打开 BOSS 候选人页面后，再回到系统点击检测或获取。",
  ].join("\n");
}

async function isCdpReady(cdpPort) {
  try {
    await fetchLocalJson(`http://127.0.0.1:${cdpPort}/json/version`, { timeoutMs: 1200 });
    return true;
  } catch {
    return false;
  }
}

function spawnDetached(command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function spawnDetachedBrowser(command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  return child.pid;
}

function findCloakBrowserExecutable() {
  const explicit = String(process.env.CLOAK_BROWSER_PATH || process.env.CLOAK_BROWSER_EXE || "").trim();
  const candidates = [];
  if (explicit) candidates.push(explicit);

  const projectCloakBrowserRoot = path.join(AUTOMATION_WORKSPACE, "cloakbrowser-runtime");
  try {
    const entries = fsSync.existsSync(projectCloakBrowserRoot)
      ? fsSync.readdirSync(projectCloakBrowserRoot, { withFileTypes: true })
      : [];
    entries
      .filter((entry) => entry.isDirectory() && /^chromium-/i.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name))
      .forEach((entry) => candidates.push(path.join(projectCloakBrowserRoot, entry.name, "chrome.exe")));
  } catch {
    // Best-effort discovery only; explicit error is raised below if no executable exists.
  }

  try {
    const entries = fsSync.existsSync(DEFAULT_CLOAK_BROWSER_ROOT)
      ? fsSync.readdirSync(DEFAULT_CLOAK_BROWSER_ROOT, { withFileTypes: true })
      : [];
    entries
      .filter((entry) => entry.isDirectory() && /^chromium-/i.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name))
      .forEach((entry) => candidates.push(path.join(DEFAULT_CLOAK_BROWSER_ROOT, entry.name, "chrome.exe")));
  } catch {
    // Best-effort discovery only; explicit error is raised below if no executable exists.
  }

  candidates.push(
    path.join(process.env.LOCALAPPDATA || "", "CloakBrowser", "CloakBrowser.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "CloakBrowser", "CloakBrowser.exe"),
    path.join(process.env.PROGRAMFILES || "", "CloakBrowser", "CloakBrowser.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "CloakBrowser", "CloakBrowser.exe")
  );

  return candidates.find((candidate) => candidate && fsSync.existsSync(candidate)) || "";
}

function logBrowserLaunch(event, payload = {}) {
  try {
    console.log(`[browser-launch] ${event} ${JSON.stringify(payload)}`);
  } catch {
    console.log(`[browser-launch] ${event}`);
  }
}

function buildCdpBrowserArgs(cdpPort, profileDir, startUrl) {
  return [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-background-mode",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    startUrl || "about:blank",
  ];
}

function quoteWindowsCmdArgument(value = "") {
  return `"${String(value).replace(/"/g, "")}"`;
}

function launchCloakBrowserDirectly({ cdpPort, profileDir, startUrl, browserPath }) {
  fsSync.mkdirSync(profileDir, { recursive: true });
  const args = buildCdpBrowserArgs(cdpPort, profileDir, startUrl);
  const pid = spawnDetachedBrowser(browserPath, args, AUTOMATION_WORKSPACE);
  return { pid, args };
}

function automationBrowserVisibleLaunchEnabled() {
  return !/^(0|false|no)$/i.test(String(process.env.AUTOMATION_BROWSER_VISIBLE ?? "true"));
}

async function launchCloakBrowserInteractiveTask({ cdpPort, profileDir, startUrl, browserPath }) {
  fsSync.mkdirSync(profileDir, { recursive: true });
  const args = buildCdpBrowserArgs(cdpPort, profileDir, startUrl);
  const logDir = path.join(AUTOMATION_WORKSPACE, "logs");
  fsSync.mkdirSync(logDir, { recursive: true });
  const scriptPath = path.join(logDir, `visible-browser-${cdpPort}.cmd`);
  const taskName = `\\RecruitAgentVisibleBrowser-${cdpPort}`;
  const taskUser = process.env.AUTOMATION_BROWSER_INTERACTIVE_USER || process.env.USERNAME || "Administrator";
  const scriptBody = [
    "@echo off",
    `cd /d ${quoteWindowsCmdArgument(AUTOMATION_WORKSPACE)}`,
    `start "" ${quoteWindowsCmdArgument(browserPath)} ${args.map(quoteWindowsCmdArgument).join(" ")}`,
    "",
  ].join("\r\n");
  fsSync.writeFileSync(scriptPath, scriptBody, "utf8");
  const command = [
    "$ErrorActionPreference = 'Continue'",
    `& schtasks.exe /Delete /TN ${powerShellSingleQuoted(taskName)} /F 2>$null | Out-Null`,
    "$ErrorActionPreference = 'Stop'",
    [
      "$CreateOutput = & schtasks.exe /Create",
      `/TN ${powerShellSingleQuoted(taskName)}`,
      "/SC ONCE",
      "/ST 23:59",
      `/TR ${powerShellSingleQuoted(scriptPath)}`,
      `/RU ${powerShellSingleQuoted(taskUser)}`,
      "/RL HIGHEST",
      "/IT",
      "/F",
      "2>&1",
    ].join(" "),
    "if ($LASTEXITCODE -ne 0) { throw ('创建可视化浏览器任务失败：' + ($CreateOutput -join ' ')) }",
    `$RunOutput = & schtasks.exe /Run /TN ${powerShellSingleQuoted(taskName)} 2>&1`,
    "if ($LASTEXITCODE -ne 0) { throw ('运行可视化浏览器任务失败：' + ($RunOutput -join ' ')) }",
    "Start-Sleep -Seconds 3",
    "$ErrorActionPreference = 'Continue'",
    `$CleanupOutput = & schtasks.exe /Delete /TN ${powerShellSingleQuoted(taskName)} /F 2>&1`,
    "if ($LASTEXITCODE -ne 0) { Write-Output ('清理可视化浏览器任务失败：' + ($CleanupOutput -join ' ')) }",
  ].join("; ");
  await runPowerShellAutomationCommand(command, { timeoutMs: 20000 });
  return { pid: null, args, taskName, scriptPath };
}

async function waitForCdpReady(cdpPort, timeoutMs = 75000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isCdpReady(cdpPort)) return true;
    await sleep(300);
  }
  return false;
}

async function waitForCdpClosed(cdpPort, timeoutMs = 6000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!(await isCdpReady(cdpPort))) return true;
    await sleep(300);
  }
  return false;
}

const browserLaunchJobs = new Map();
const BROWSER_LAUNCH_JOB_TTL_MS = 30 * 60 * 1000;

function cleanupBrowserLaunchJobs() {
  const cutoff = Date.now() - BROWSER_LAUNCH_JOB_TTL_MS;
  for (const [jobId, job] of browserLaunchJobs.entries()) {
    if (Number(job.updatedAtMs || job.createdAtMs || 0) < cutoff) {
      browserLaunchJobs.delete(jobId);
    }
  }
}

function powerShellSingleQuoted(value = "") {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function encodePowerShellCommand(command) {
  return Buffer.from(command, "utf16le").toString("base64");
}

async function runPowerShellAutomationCommand(command, { timeoutMs = 15000 } = {}) {
  return runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShellCommand(command)],
    {
      timeoutMs,
      timeoutMessage: "自动化进程操作超时",
      failureMessage: "自动化进程操作失败",
    }
  );
}

function automationBrowserPortFromBaseUrl(baseUrl = "") {
  try {
    const url = new URL(String(baseUrl || ""));
    return Number(url.port || (url.protocol === "https:" ? 443 : 80)) || 0;
  } catch {
    return 0;
  }
}

function getAutomationBrowserRuntimeTarget(account, platform) {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const platformConfig = BROWSER_PLATFORM_CONFIG[normalizedPlatform] || BROWSER_PLATFORM_CONFIG.boss;
  const cdpTarget = account.platforms?.[normalizedPlatform] || {};
  const sourceKey = automationBrowserSourceKey(normalizedPlatform, account.id);
  const source = AUTOMATION_SUMMARY_SOURCES[sourceKey] || {};
  return {
    account,
    accountId: account.id,
    accountName: account.name,
    platform: normalizedPlatform,
    platformLabel: platformConfig.label,
    startUrl: platformConfig.startUrl,
    cdpPort: Number(cdpTarget.cdpPort || 0),
    profileDir: cdpTarget.profileDir || "",
    sourceKey,
    agentPort: automationBrowserPortFromBaseUrl(source.baseUrl),
  };
}

function resolveAutomationPythonPath() {
  const candidates = [
    process.env.AGENT_PYTHON_PATH,
    process.env.PYTHON_PATH,
    process.env.PYTHON,
    path.join(AUTOMATION_WORKSPACE, ".cloakbrowser-venv", "Scripts", "python.exe"),
    "C:\\Python314\\python.exe",
    "C:\\Python313\\python.exe",
    "C:\\Python312\\python.exe",
    "C:\\Python311\\python.exe",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python", "Python314", "python.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python", "Python313", "python.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python", "Python312", "python.exe") : "",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Python", "Python311", "python.exe") : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (/\\WindowsApps\\/i.test(candidate)) continue;
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return process.env.AGENT_PYTHON_COMMAND || "python.exe";
}

function safeAutomationProcessName(value = "") {
  return String(value || "agent")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent";
}

function automationAgentScriptName(sourceKey, agentPort) {
  const normalizedSource = String(sourceKey || "").trim();
  const nameBySource = {
    boss_a: "boss_a",
    boss_b: "boss_b",
    job51_a: "job51_a",
    job51_b: "job51_b",
    zhilian_a: "zhilian_a",
    zhilian_b: "zhilian_b",
  };
  const suffix = nameBySource[normalizedSource] || normalizedSource || "agent";
  return `run-agent-${agentPort}-${suffix}.ps1`;
}

function buildAutomationAgentFallbackCommand(target, pythonPath, stdoutLog, stderrLog) {
  const agentAccountName = target.platform === "boss" ? target.accountName : `${target.platformLabel} ${target.accountName}`;
  return [
    `$env:AGENT_WEB_PORT = ${powerShellSingleQuoted(String(target.agentPort))}`,
    `$env:AGENT_ACCOUNT_ID = ${powerShellSingleQuoted(target.sourceKey || target.accountId)}`,
    `$env:AGENT_ACCOUNT_NAME = ${powerShellSingleQuoted(agentAccountName)}`,
    `$env:AUTOMATION_PLATFORM = ${powerShellSingleQuoted(target.platform)}`,
    `$env:AUTOMATION_ACCOUNT_ID = ${powerShellSingleQuoted(target.sourceKey || target.accountId)}`,
    [
      `Start-Process -FilePath ${powerShellSingleQuoted(pythonPath)}`,
      "-ArgumentList @('-u','agent_web_server.py')",
      `-WorkingDirectory ${powerShellSingleQuoted(AUTOMATION_WORKSPACE)}`,
      "-WindowStyle Hidden",
      `-RedirectStandardOutput ${powerShellSingleQuoted(stdoutLog)}`,
      `-RedirectStandardError ${powerShellSingleQuoted(stderrLog)}`,
    ].join(" "),
  ];
}

async function waitForAutomationAgentReady(sourceKey, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const { payload } = await fetchAgentJson(sourceKey, "/api/status", { timeoutMs: 1500 });
      return { ready: true, payload };
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  return { ready: false, error: lastError?.message || "agent 服务未响应" };
}

async function inspectAutomationLocalPortOwner(port) {
  const normalizedPort = Number(port || 0);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0) {
    return { listening: false, port: normalizedPort };
  }
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$Port = ${normalizedPort}`,
    "$Connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $Connection) { [PSCustomObject]@{ listening = $false; port = $Port } | ConvertTo-Json -Compress; return }",
    "$Proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$($Connection.OwningProcess)\"",
    "$Payload = [PSCustomObject]@{ listening = $true; port = $Port; processId = [int]$Connection.OwningProcess; sessionId = [int]$Proc.SessionId; name = [string]$Proc.Name; commandLine = [string]$Proc.CommandLine }",
    "$Payload | ConvertTo-Json -Compress -Depth 4",
  ].join("; ");
  const output = await runPowerShellAutomationCommand(command, { timeoutMs: 6000 });
  return JSON.parse(String(output || "{}"));
}

async function startAutomationAgentProcess(target) {
  if (!target.agentPort || !target.sourceKey) {
    throw new Error(`${target.platformLabel} ${target.accountName} agent 端口未配置`);
  }
  const pythonPath = resolveAutomationPythonPath();
  const logDir = path.join(AUTOMATION_WORKSPACE, "logs");
  const scriptPath = path.join(logDir, automationAgentScriptName(target.sourceKey, target.agentPort));
  const processName = safeAutomationProcessName(`agent-${target.agentPort}-${target.sourceKey}`);
  const stdoutLog = path.join(logDir, `${processName}.button.out.log`);
  const stderrLog = path.join(logDir, `${processName}.button.err.log`);
  const startCommands = fsSync.existsSync(scriptPath)
    ? [[
      "Start-Process -FilePath 'powershell.exe'",
      "-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',",
      `${powerShellSingleQuoted(scriptPath)})`,
      `-WorkingDirectory ${powerShellSingleQuoted(AUTOMATION_WORKSPACE)}`,
      "-WindowStyle Hidden",
    ].join(" ")]
    : buildAutomationAgentFallbackCommand(target, pythonPath, stdoutLog, stderrLog);
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Remove-Item Env:\\PYTHONHOME -ErrorAction SilentlyContinue",
    "Remove-Item Env:\\PYTHONPATH -ErrorAction SilentlyContinue",
    `New-Item -ItemType Directory -Force -Path ${powerShellSingleQuoted(logDir)} | Out-Null`,
    ...startCommands,
  ].join("; ");
  await runPowerShellAutomationCommand(command, { timeoutMs: 12000 });
  return { started: true, pythonPath, scriptPath: fsSync.existsSync(scriptPath) ? scriptPath : "", stdoutLog, stderrLog };
}

async function ensureAutomationBrowserAgentReady(target) {
  if (!target.sourceKey || !target.agentPort) {
    return { ready: false, started: false, agentPort: target.agentPort || 0, error: "agent 服务未配置" };
  }
  const current = await waitForAutomationAgentReady(target.sourceKey, 1800);
  if (current.ready) {
    return { ready: true, started: false, agentPort: target.agentPort, status: current.payload };
  }
  const started = await startAutomationAgentProcess(target);
  const ready = await waitForAutomationAgentReady(target.sourceKey, 15000);
  if (!ready.ready) {
    throw new Error(`${target.platformLabel} ${target.accountName} agent 启动后未就绪：${ready.error || "未知错误"}`);
  }
  return { ready: true, started: true, agentPort: target.agentPort, status: ready.payload, ...started };
}

async function inspectCdpPageForStatus(page) {
  const expression =
    "(() => ({ href: location.href, title: document.title || '', readyState: document.readyState, text: ((document.body && document.body.innerText) || '').slice(0, 3000) }))()";
  const result = await callPageCdp(page, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, 1800).catch(() => null);
  return result?.result?.value || {};
}

async function inspectAutomationBrowserStatusPage(runtimeTarget) {
  const result = {
    page: null,
    needsLogin: false,
    authenticated: false,
    accountAbnormal: false,
    captcha: false,
    blockReason: "",
  };
  if (!runtimeTarget.cdpPort) return result;
  const pages = await fetchCdpJson(runtimeTarget.cdpPort, "/json/list", { timeoutMs: 1800 }).catch(() => []);
  const page = pickPlatformPage(pages, runtimeTarget.startUrl);
  if (!page) return result;
  const inspected = await inspectCdpPageForStatus(page);
  const pageUrl = inspected.href || page.url || "";
  result.page = {
    title: inspected.title || page.title || "",
    url: pageUrl || runtimeTarget.startUrl,
    readyState: inspected.readyState || "",
  };
  result.captcha = browserTargetLooksCaptcha(page, inspected);
  result.accountAbnormal = browserTargetLooksAccountAbnormal(page, inspected);
  result.blockReason = result.captcha ? "captcha" : result.accountAbnormal ? "account_abnormal" : "";
  result.needsLogin = browserTargetLooksLoggedOut(page, runtimeTarget.platform, inspected);
  result.authenticated = browserTargetLooksAuthenticated(runtimeTarget.platform, runtimeTarget.account, inspected);
  return result;
}

async function stopAutomationLocalPort(port, kind) {
  const normalizedPort = Number(port || 0);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0) {
    return { ok: false, kind, port: normalizedPort, listening: false, stoppedPids: [], errors: ["端口无效"] };
  }
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$Port = ${normalizedPort}`,
    "$Connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)",
    "$ProcessIds = @($Connections | Where-Object { $_.OwningProcess -and $_.OwningProcess -ne 0 } | Select-Object -ExpandProperty OwningProcess -Unique)",
    "$Stopped = @()",
    "$Errors = @()",
    "foreach ($TargetProcessId in $ProcessIds) { try { Stop-Process -Id $TargetProcessId -Force -ErrorAction Stop; $Stopped += [int]$TargetProcessId } catch { $Errors += [string]$_.Exception.Message } }",
    "$Payload = [PSCustomObject]@{ ok = ($Errors.Count -eq 0); port = $Port; listening = ($ProcessIds.Count -gt 0); processIds = @($ProcessIds); stoppedPids = @($Stopped); errors = @($Errors) }",
    "$Payload | ConvertTo-Json -Compress -Depth 5",
  ].join("; ");
  try {
    const output = await runPowerShellAutomationCommand(command, { timeoutMs: 10000 });
    const payload = JSON.parse(String(output || "{}"));
    return { kind, ...payload, ok: Boolean(payload.ok) };
  } catch (error) {
    return {
      ok: false,
      kind,
      port: normalizedPort,
      listening: false,
      stoppedPids: [],
      errors: [error.message || "停止端口失败"],
    };
  }
}

function browserLaunchTargetLabel(target = {}) {
  return `${target.platformLabel || automationPlatformLabel(target.platform)} ${target.accountName || automationAccountLabel(target.accountId)} ${target.cdpPort || ""}`.trim();
}

function buildBrowserLaunchSummary(job) {
  const targets = Array.isArray(job?.targets) ? job.targets : [];
  const summary = targets.reduce(
    (acc, target) => {
      if (target.status === "ready") acc.ready += 1;
      if (target.status === "needs_login") acc.needsLogin += 1;
      if (target.status === "account_abnormal") acc.accountAbnormal += 1;
      if (target.status === "captcha") acc.captcha += 1;
      if (target.status === "failed") acc.failed += 1;
      if (target.status === "running") acc.running += 1;
      if (target.status === "pending") acc.pending += 1;
      return acc;
    },
    { ready: 0, needsLogin: 0, accountAbnormal: 0, captcha: 0, failed: 0, running: 0, pending: 0 }
  );
  summary.total = targets.length;
  return summary;
}

function updateBrowserLaunchJob(job, patch = {}) {
  Object.assign(job, patch, {
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
  });
  job.summary = buildBrowserLaunchSummary(job);
  const doneCount = job.summary.ready + job.summary.needsLogin + job.summary.accountAbnormal + job.summary.captcha + job.summary.failed;
  const issueCount = job.summary.accountAbnormal + job.summary.captcha + job.summary.failed;
  if (doneCount >= job.summary.total && job.summary.total) {
    if (issueCount >= job.summary.total) {
      job.status = "failed";
    } else if (issueCount > 0) {
      job.status = "completed_with_errors";
    } else {
      job.status = "completed";
    }
  }
  job.message = formatBrowserLaunchJobMessage(job);
}

function formatBrowserLaunchJobMessage(job) {
  const summary = job.summary || buildBrowserLaunchSummary(job);
  const failedTargets = (job.targets || []).filter((target) => ["failed", "account_abnormal", "captcha"].includes(target.status));
  const base = `浏览器启动：成功 ${summary.ready} 个，需要登录 ${summary.needsLogin} 个，账号异常 ${summary.accountAbnormal || 0} 个，人机验证 ${summary.captcha || 0} 个，失败 ${summary.failed} 个`;
  if (!failedTargets.length) return base;
  const failedText = failedTargets
    .map((target) => `${browserLaunchTargetLabel(target)} 启动失败：${target.error || "未知错误"}`)
    .join("；");
  return `${base}；${failedText}`;
}

function getPublicBrowserLaunchJob(job) {
  if (!job) return null;
  const targets = job.targets.map((target) => ({
    accountId: target.accountId,
    accountName: target.accountName,
    platform: target.platform,
    platformLabel: target.platformLabel,
    cdpPort: target.cdpPort,
    debugUrl: target.debugUrl,
    profileDir: target.profileDir,
    startUrl: target.startUrl,
    status: target.status,
    attempt: target.attempt,
    maxAttempts: target.maxAttempts,
    sourceKey: target.sourceKey || "",
    agentPort: target.agentPort || 0,
    agentStarted: Boolean(target.agentStarted),
    agentReady: Boolean(target.agentReady),
    started: Boolean(target.started),
    needsLogin: Boolean(target.needsLogin),
    authenticated: Boolean(target.authenticated),
    openedNewTab: Boolean(target.openedNewTab),
    pid: target.pid || null,
    launchMethod: target.launchMethod || "",
    browserPath: target.browserPath || "",
    page: target.page || null,
    agentError: target.agentError || "",
    error: target.error || "",
  }));
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    targets,
    failures: targets.filter((target) => ["failed", "account_abnormal", "captcha"].includes(target.status)),
    summary: job.summary || buildBrowserLaunchSummary(job),
    message: job.message || formatBrowserLaunchJobMessage(job),
  };
}

function makeBrowserLaunchTarget(account, platform, maxAttempts) {
  const runtimeTarget = getAutomationBrowserRuntimeTarget(account, platform);
  return {
    account,
    platform: runtimeTarget.platform,
    accountId: account.id,
    accountName: account.name,
    platformLabel: runtimeTarget.platformLabel,
    cdpPort: runtimeTarget.cdpPort,
    profileDir: runtimeTarget.profileDir,
    startUrl: runtimeTarget.startUrl,
    sourceKey: runtimeTarget.sourceKey,
    agentPort: runtimeTarget.agentPort,
    status: "pending",
    attempt: 0,
    maxAttempts,
    agentStarted: false,
    agentReady: false,
    agentError: "",
    started: false,
    needsLogin: false,
    authenticated: false,
    accountAbnormal: false,
    captcha: false,
    blockReason: "",
    openedNewTab: false,
    pid: null,
    launchMethod: "",
    browserPath: "",
    page: null,
    error: "",
  };
}

async function runBrowserLaunchTarget(job, target, waitTimeoutMs) {
  for (let attempt = 1; attempt <= target.maxAttempts; attempt += 1) {
    Object.assign(target, {
      status: "running",
      attempt,
      error: "",
    });
    updateBrowserLaunchJob(job);
    try {
      const result = await startBrowserTarget(target.account, target.platform, { waitTimeoutMs });
      Object.assign(target, result, {
        status: result.captcha ? "captcha" : result.accountAbnormal ? "account_abnormal" : result.needsLogin ? "needs_login" : "ready",
        error: "",
      });
      updateBrowserLaunchJob(job);
      return;
    } catch (error) {
      if (error.launchPid) target.pid = error.launchPid;
      if (error.launchMethod) target.launchMethod = error.launchMethod;
      if (error.browserPath) target.browserPath = error.browserPath;
      target.error = error.message || "启动失败";
      updateBrowserLaunchJob(job);
      if (attempt < target.maxAttempts) {
        await sleep(1000);
      }
    }
  }
  target.status = "failed";
  updateBrowserLaunchJob(job);
}

async function runBrowserLaunchJob(jobId) {
  const job = browserLaunchJobs.get(jobId);
  if (!job || job.started) return;
  job.started = true;
  updateBrowserLaunchJob(job, { status: "running" });
  await Promise.all(job.targets.map((target) => runBrowserLaunchTarget(job, target, job.waitTimeoutMs)));
  updateBrowserLaunchJob(job);
}

async function fetchCdpJson(cdpPort, pathSuffix, { method = "GET", timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}${pathSuffix}`, {
      method,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `CDP 请求失败：${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeBrowserHost(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function isBlankBrowserPage(page = {}) {
  const url = String(page.url || "").trim().toLowerCase();
  return !url || url === "about:blank" || url.startsWith("chrome://newtab") || url.startsWith("devtools:");
}

function pageMatchesStartUrl(page = {}, startUrl = "") {
  if (isBlankBrowserPage(page)) return false;
  const targetHost = normalizeBrowserHost(startUrl);
  const pageHost = normalizeBrowserHost(page.url || "");
  return Boolean(targetHost && pageHost && pageHost === targetHost);
}

function pickPlatformPage(pages, startUrl) {
  const pageList = Array.isArray(pages) ? pages.filter((page) => page.type === "page") : [];
  return pageList.find((page) => pageMatchesStartUrl(page, startUrl)) || null;
}

function pickBlankPage(pages) {
  const pageList = Array.isArray(pages) ? pages.filter((page) => page.type === "page") : [];
  return pageList.find((page) => isBlankBrowserPage(page)) || null;
}

function browserTargetStatusText(page = {}, inspected = {}) {
  return `${page.url || ""} ${page.title || ""} ${inspected.href || ""} ${inspected.title || ""} ${inspected.text || ""}`.toLowerCase();
}

function browserTargetLooksLoggedOut(page = {}, platform = "", inspected = {}) {
  const text = browserTargetStatusText(page, inspected);
  if (/login|passport|signin|sso|auth/.test(text)) return true;
  if (/请登录|未登录|重新登录|登录后|扫码登录|账号登录|密码登录|验证码|安全验证|企业登录/.test(text)) return true;
  if (platform === "boss" && /登录boss|boss直聘登录/.test(text)) return true;
  if (platform === "51job" && /前程无忧.*登录|51job.*登录/.test(text)) return true;
  if (platform === "zhilian" && /智联.*登录|zhaopin.*登录/.test(text)) return true;
  return false;
}

function browserTargetLooksCaptcha(page = {}, inspected = {}) {
  const text = browserTargetStatusText(page, inspected);
  return /captcha|geetest|安全验证|人机验证|机器人验证|滑块|拖动滑块|行为验证|请完成验证|图形验证码|图片验证码/.test(text);
}

function browserTargetLooksAccountAbnormal(page = {}, inspected = {}) {
  const text = browserTargetStatusText(page, inspected);
  return /账号异常|账户异常|账号受限|账户受限|访问受限|异常访问|操作频繁|账号存在风险|账户存在风险|账号被限制|账户被限制|账号冻结|账户冻结|封禁|申诉/.test(text);
}

function browserTargetLooksAuthenticated(platform = "", account = {}, inspected = {}) {
  const text = `${inspected.href || ""} ${inspected.title || ""} ${inspected.text || ""}`;
  if (platform === "boss") {
    const accountName = String(account.name || "").trim();
    return Boolean(accountName && text.includes(accountName) && /职位管理|牛人管理|招聘数据|沟通/.test(text));
  }
  if (platform === "51job") {
    return /人才沟通/.test(text) && /职位管理|工作台|全部职位|人才管理/.test(text);
  }
  if (platform === "zhilian") {
    return /互动|聊天/.test(text) && /人才管理|个人中心|全部职位/.test(text);
  }
  return Boolean(text && !/请登录|未登录|登录后/.test(text));
}

function cdpMessageToString(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data || "");
}

function callPageCdp(page, method, params = {}, timeoutMs = 6000) {
  if (!page?.webSocketDebuggerUrl || typeof WebSocket !== "function") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const id = Date.now() + Math.floor(Math.random() * 100000);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // Ignore close failures during timeout cleanup.
      }
      reject(new Error(`CDP command timeout: ${method}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Ignore close failures after command completion.
      }
    };

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(event?.message || `CDP websocket failed: ${method}`));
    });
    ws.addEventListener("message", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(cdpMessageToString(event.data));
      } catch {
        return;
      }
      if (payload.id !== id) return;
      cleanup();
      if (payload.error) {
        reject(new Error(payload.error.message || `CDP command failed: ${method}`));
      } else {
        resolve(payload.result || {});
      }
    });
  });
}

async function inspectCdpPage(page) {
  const expression =
    "(() => ({ href: location.href, title: document.title || '', readyState: document.readyState, text: ((document.body && document.body.innerText) || '').slice(0, 3000) }))()";
  if (page?.webSocketDebuggerUrl && typeof CdpClient === "function") {
    const client = new CdpClient(page.webSocketDebuggerUrl);
    try {
      await client.connect();
      return (await client.evaluate(expression, { timeoutMs: 8000 })) || {};
    } catch (error) {
      logBrowserLaunch("inspect-failed", {
        url: page.url || "",
        title: page.title || "",
        error: error.message || String(error),
      });
    } finally {
      client.close();
    }
  }

  const result = await callPageCdp(page, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }).catch((error) => {
    logBrowserLaunch("inspect-fallback-failed", {
      url: page?.url || "",
      title: page?.title || "",
      error: error.message || String(error),
    });
    return null;
  });
  return result?.result?.value || {};
}

async function activateCdpPage(cdpPort, page) {
  if (!page?.id) return;
  await fetchCdpJson(cdpPort, `/json/activate/${encodeURIComponent(page.id)}`, { timeoutMs: 2500 }).catch(() => null);
}

async function openPlatformCdpPage(cdpPort, startUrl) {
  const created = await fetchCdpJson(cdpPort, `/json/new?${encodeURIComponent(startUrl)}`, {
    method: "PUT",
    timeoutMs: 6000,
  }).catch(() => null);
  if (created?.id) await activateCdpPage(cdpPort, created);
  return created;
}

async function waitForPlatformPageReady(cdpPort, startUrl, platform, account, timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastPage = null;
  while (Date.now() - startedAt < timeoutMs) {
    const pages = await fetchCdpJson(cdpPort, "/json/list", { timeoutMs: 4000 }).catch(() => []);
    const page = pickPlatformPage(pages, startUrl);
    if (page) {
      lastPage = page;
      await activateCdpPage(cdpPort, page);
      const inspected = await inspectCdpPage(page);
      const pageUrl = inspected.href || page.url || "";
      const readyState = inspected.readyState || "";
      const resultPage = {
        title: inspected.title || page.title || "",
        url: pageUrl || startUrl,
        readyState,
      };
      if (pageMatchesStartUrl({ url: pageUrl || page.url }, startUrl) && readyState !== "loading") {
        const captcha = browserTargetLooksCaptcha(page, inspected);
        const accountAbnormal = browserTargetLooksAccountAbnormal(page, inspected);
        const needsLogin = browserTargetLooksLoggedOut(page, platform, inspected);
        const authenticated = browserTargetLooksAuthenticated(platform, account, inspected);
        if (captcha || accountAbnormal || needsLogin || authenticated) {
          return {
            page: resultPage,
            needsLogin,
            authenticated,
            accountAbnormal,
            captcha,
            blockReason: captcha ? "captcha" : accountAbnormal ? "account_abnormal" : "",
          };
        }
      }
    }
    await sleep(500);
  }

  const observed = lastPage?.url || "about:blank";
  const error = new Error(`浏览器页面未确认登录态：期望 ${startUrl}，实际 ${observed}`);
  error.statusCode = 500;
  throw error;
}

function getBrowserAutomationAccounts(accountId = "all") {
  const normalized = normalizeBossAutomationAccountId(accountId);
  if (normalized === "all") return BROWSER_AUTOMATION_ACCOUNTS;
  return BROWSER_AUTOMATION_ACCOUNTS.filter((account) => account.id === normalized);
}

async function focusOrOpenCdpPage(target, startUrl, platform, account) {
  const pages = await fetchCdpJson(target.cdpPort, "/json/list").catch(() => []);
  const existing = pickPlatformPage(pages, startUrl);
  let openedNewTab = false;

  if (existing?.webSocketDebuggerUrl) {
    await activateCdpPage(target.cdpPort, existing);
  } else {
    const blankPage = pickBlankPage(pages);
    if (blankPage?.id) await activateCdpPage(target.cdpPort, blankPage);
    const created = await openPlatformCdpPage(target.cdpPort, startUrl);
    openedNewTab = Boolean(created);
  }

  const result = await waitForPlatformPageReady(target.cdpPort, startUrl, platform, account);
  return { openedNewTab, ...result };
}

async function startBrowserTarget(account, platform, { waitTimeoutMs = 30000 } = {}) {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const platformConfig = BROWSER_PLATFORM_CONFIG[normalizedPlatform] || BROWSER_PLATFORM_CONFIG.boss;
  const target = account.platforms?.[normalizedPlatform];
  if (!target?.cdpPort || !target.profileDir) {
    const error = new Error(`${account.name} ${platformConfig.label} 浏览器未配置`);
    error.statusCode = 400;
    throw error;
  }

  const visibleLaunch = automationBrowserVisibleLaunchEnabled();
  let wasRunning = await isCdpReady(target.cdpPort);
  let pid = null;
  let launchMethod = wasRunning ? "reuse-cdp" : (visibleLaunch ? "interactive-task-cloakbrowser" : "direct-cloakbrowser");
  let browserPath = "";
  if (wasRunning && visibleLaunch) {
    const owner = await inspectAutomationLocalPortOwner(target.cdpPort).catch(() => null);
    if (Number(owner?.sessionId) === 0) {
      logBrowserLaunch("replace-hidden-session0-browser", {
        accountId: account.id,
        accountName: account.name,
        platform: normalizedPlatform,
        cdpPort: target.cdpPort,
        processId: owner.processId,
      });
      await stopAutomationLocalPort(target.cdpPort, "browser");
      const closed = await waitForCdpClosed(target.cdpPort, 8000);
      if (!closed) {
        const error = new Error(`${account.name} ${platformConfig.label} 后台浏览器仍占用 ${target.cdpPort}，无法切换为桌面可视化窗口`);
        error.statusCode = 500;
        error.launchMethod = "replace-hidden-session0-browser";
        throw error;
      }
      wasRunning = false;
      launchMethod = "interactive-task-cloakbrowser";
    }
  }
  if (!wasRunning) {
    const cloakBrowserPath = findCloakBrowserExecutable();
    if (!cloakBrowserPath) {
      const error = new Error("未找到 CloakBrowser，已停止启动；不能回退到普通 Chrome/Edge");
      error.statusCode = 500;
      throw error;
    }
    browserPath = cloakBrowserPath;
    try {
      const launch = visibleLaunch
        ? await launchCloakBrowserInteractiveTask({
          cdpPort: target.cdpPort,
          profileDir: target.profileDir,
          startUrl: platformConfig.startUrl,
          browserPath: cloakBrowserPath,
        })
        : launchCloakBrowserDirectly({
          cdpPort: target.cdpPort,
          profileDir: target.profileDir,
          startUrl: platformConfig.startUrl,
          browserPath: cloakBrowserPath,
        });
      pid = launch.pid;
      logBrowserLaunch("started", {
        accountId: account.id,
        accountName: account.name,
        platform: normalizedPlatform,
        cdpPort: target.cdpPort,
        pid,
        profileDir: target.profileDir,
        browserPath: cloakBrowserPath,
        method: launchMethod,
        taskName: launch.taskName || "",
      });
    } catch (spawnError) {
      const error = new Error(`${account.name} ${platformConfig.label} CloakBrowser 进程启动失败：${spawnError.message || spawnError}`);
      error.statusCode = 500;
      error.launchMethod = launchMethod;
      error.browserPath = cloakBrowserPath;
      throw error;
    }
    const ready = await waitForCdpReady(target.cdpPort, waitTimeoutMs);
    if (!ready) {
      const error = new Error(
        `${account.name} ${platformConfig.label} CloakBrowser 已启动 PID ${pid || "-"}，但 ${target.cdpPort} 端口未就绪；路径：${cloakBrowserPath}`
      );
      error.statusCode = 500;
      error.launchPid = pid;
      error.launchMethod = launchMethod;
      error.browserPath = cloakBrowserPath;
        throw error;
      }
      if (visibleLaunch) {
        const owner = await inspectAutomationLocalPortOwner(target.cdpPort).catch(() => null);
        if (owner?.processId) pid = owner.processId;
        if (Number(owner?.sessionId) === 0) {
          const error = new Error(`${account.name} ${platformConfig.label} 浏览器已启动，但仍在后台 Session 0；请保持 Administrator 的 RDP 桌面登录后重试`);
          error.statusCode = 500;
          error.launchPid = pid;
          error.launchMethod = launchMethod;
          error.browserPath = cloakBrowserPath;
          throw error;
        }
      }
    logBrowserLaunch("ready", {
      accountId: account.id,
      accountName: account.name,
      platform: normalizedPlatform,
      cdpPort: target.cdpPort,
      pid,
      method: launchMethod,
    });
  }

  const pageResult = await focusOrOpenCdpPage(target, platformConfig.startUrl, normalizedPlatform, account);
  logBrowserLaunch("page-ready", {
    accountId: account.id,
    accountName: account.name,
    platform: normalizedPlatform,
    cdpPort: target.cdpPort,
    url: pageResult.page?.url || "",
    title: pageResult.page?.title || "",
    needsLogin: Boolean(pageResult.needsLogin),
    authenticated: Boolean(pageResult.authenticated),
  });
  return {
    accountId: account.id,
    accountName: account.name,
    platform: normalizedPlatform,
    platformLabel: platformConfig.label,
    cdpPort: target.cdpPort,
    debugUrl: `http://127.0.0.1:${target.cdpPort}`,
    profileDir: target.profileDir,
    startUrl: platformConfig.startUrl,
    started: !wasRunning,
    pid,
    launchMethod,
    browserPath,
    authenticated: Boolean(pageResult.authenticated),
    ...pageResult,
  };
}

function getBrowserLaunchSpecs(body = {}) {
  if (
    body.launchSet === "default-six" ||
    body.launchSet === "default-four" ||
    body.mode === "default-six" ||
    body.mode === "default-four" ||
    body.defaultFour === true
  ) {
    return DEFAULT_BROWSER_LAUNCH_TARGETS;
  }
  if (Array.isArray(body.targets) && body.targets.length) {
    return body.targets;
  }
  return [{ platform: body.platform || body.source || "boss", accountId: body.accountId || body.account || "all" }];
}

function getBrowserLaunchPlan(body = {}) {
  const seen = new Set();
  const plan = [];
  for (const spec of getBrowserLaunchSpecs(body)) {
    const platform = normalizeAutomationPlatformId(spec.platform || spec.source || body.platform || "boss");
    const accountId = normalizeBossAutomationAccountId(spec.accountId || spec.account || "all");
    const accounts = getBrowserAutomationAccounts(accountId);
    for (const account of accounts) {
      const key = `${account.id}:${platform}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plan.push({ account, platform });
    }
  }
  return plan;
}

async function handleStartAutomationBrowser(request, response) {
  try {
    cleanupBrowserLaunchJobs();
    const body = await readJsonBody(request).catch(() => ({}));
    const plan = getBrowserLaunchPlan(body);
    if (!plan.length) {
      sendJson(response, 400, { error: "未找到要启动的浏览器账号" });
      return;
    }

    const waitTimeoutMs = Math.max(10000, Math.min(Number(body.waitTimeoutMs || 45000), 90000));
    const maxAttempts = Math.max(1, Math.min(Number(body.maxAttempts || (body.retryFailed === false ? 1 : 2)), 3));
    const now = new Date();
    const job = {
      id: crypto.randomUUID(),
      status: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdAtMs: now.getTime(),
      updatedAtMs: now.getTime(),
      waitTimeoutMs,
      maxAttempts,
      started: false,
      targets: plan.map((item) => makeBrowserLaunchTarget(item.account, item.platform, maxAttempts)),
      summary: null,
      message: "",
    };

    updateBrowserLaunchJob(job, { status: "running" });
    browserLaunchJobs.set(job.id, job);
    runBrowserLaunchJob(job.id).catch((error) => {
      const current = browserLaunchJobs.get(job.id);
      if (!current) return;
      current.status = "failed";
      current.message = error.message || "浏览器启动失败";
      updateBrowserLaunchJob(current);
    });

    sendJson(response, 202, {
      ok: true,
      jobId: job.id,
      job: getPublicBrowserLaunchJob(job),
      message: "已创建浏览器启动和登录检查任务",
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "启动浏览器失败" });
  }
}

function handleGetAutomationBrowserJob(jobId, response) {
  cleanupBrowserLaunchJobs();
  const job = browserLaunchJobs.get(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "启动任务不存在或已过期" });
    return;
  }
  sendJson(response, 200, {
    ok: true,
    jobId: job.id,
    job: getPublicBrowserLaunchJob(job),
  });
}

async function handleStopAutomationBrowser(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const plan = getBrowserLaunchPlan(body);
    if (!plan.length) {
      sendJson(response, 400, { ok: false, error: "未找到要关闭的浏览器账号" });
      return;
    }
    const results = [];
    for (const item of plan) {
      const target = getAutomationBrowserRuntimeTarget(item.account, item.platform);
      const [browserResult, agentResult] = await Promise.all([
        stopAutomationLocalPort(target.cdpPort, "browser"),
        stopAutomationLocalPort(target.agentPort, "agent"),
      ]);
      const ok = Boolean(browserResult.ok && agentResult.ok);
      results.push({
        ok,
        accountId: target.accountId,
        accountName: target.accountName,
        platform: target.platform,
        platformLabel: target.platformLabel,
        sourceKey: target.sourceKey,
        cdpPort: target.cdpPort,
        agentPort: target.agentPort,
        browser: browserResult,
        agent: agentResult,
        error: ok
          ? ""
          : [browserResult.errors, agentResult.errors].flat().filter(Boolean).join("；") || "关闭失败",
      });
    }
    const failed = results.filter((item) => !item.ok);
    sendJson(response, failed.length ? 500 : 200, {
      ok: failed.length === 0,
      message: failed.length ? `关闭完成，但 ${failed.length} 个目标有异常` : "已关闭对应浏览器和 agent 进程",
      results,
      failures: failed,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { ok: false, error: error.message || "关闭自动化进程失败" });
  }
}

function automationBrowserSourceKey(platform, accountId) {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const normalizedAccount = normalizeBossAutomationAccountId(accountId);
  if (normalizedPlatform === "boss") return normalizedAccount === "boss_b" ? "boss_b" : "boss_a";
  if (normalizedPlatform === "51job") return normalizedAccount === "boss_b" ? "job51_b" : "job51_a";
  if (normalizedPlatform === "zhilian") return normalizedAccount === "boss_b" ? "zhilian_b" : "zhilian_a";
  return "";
}

async function inspectAutomationBrowserStatusTarget(account, platform) {
  const runtimeTarget = getAutomationBrowserRuntimeTarget(account, platform);
  const target = {
    platform: runtimeTarget.platform,
    accountId: account.id,
    accountName: account.name,
    platformLabel: runtimeTarget.platformLabel,
    sourceKey: runtimeTarget.sourceKey,
    agentPort: runtimeTarget.agentPort,
    cdpPort: runtimeTarget.cdpPort,
    cdpReady: false,
    agentReady: false,
    agentBusy: false,
    needsLogin: false,
    authenticated: false,
    accountAbnormal: false,
    captcha: false,
    blockReason: "",
    page: null,
    status: "closed",
    error: "",
  };

  const [cdpReady, agentStatus] = await Promise.all([
    runtimeTarget.cdpPort ? isCdpReady(runtimeTarget.cdpPort).catch(() => false) : Promise.resolve(false),
    runtimeTarget.sourceKey
      ? fetchAgentJson(runtimeTarget.sourceKey, "/api/status", { timeoutMs: 1200 })
          .then(({ payload }) => ({ ok: true, payload }))
          .catch((error) => ({ ok: false, error: error.message || "账号服务未响应" }))
      : Promise.resolve({ ok: false, error: "账号服务未配置" }),
  ]);

  target.cdpReady = Boolean(cdpReady);
  target.agentReady = Boolean(agentStatus.ok);
  target.agentBusy = Boolean(agentStatus.payload?.busy);
  if (target.cdpReady) {
    const pageState = await inspectAutomationBrowserStatusPage(runtimeTarget).catch((error) => ({
      page: null,
      needsLogin: false,
      authenticated: false,
      accountAbnormal: false,
      captcha: false,
      blockReason: "",
      error: error.message || "页面状态读取失败",
    }));
    target.page = pageState.page || null;
    target.needsLogin = Boolean(pageState.needsLogin);
    target.authenticated = Boolean(pageState.authenticated);
    target.accountAbnormal = Boolean(pageState.accountAbnormal);
    target.captcha = Boolean(pageState.captcha);
    target.blockReason = pageState.blockReason || "";
    if (pageState.error) target.pageError = pageState.error;
  }
  if (!target.cdpReady) {
    target.status = target.agentReady ? "failed" : "closed";
    if (target.agentReady) target.error = "浏览器 CDP 未响应";
  } else if (target.captcha) {
    target.status = "captcha";
  } else if (target.accountAbnormal) {
    target.status = "account_abnormal";
  } else if (target.needsLogin) {
    target.status = "needs_login";
  } else {
    target.status = "ready";
  }
  if (!target.agentReady && agentStatus.error) target.agentError = agentStatus.error;
  return target;
}

async function handleAutomationBrowserStatus(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const requestedPlatform = String(requestUrl.searchParams.get("platform") || "all").trim().toLowerCase();
    const requestedAccount = requestUrl.searchParams.get("accountId") || "all";
    const platforms = !requestedPlatform || requestedPlatform === "all" || requestedPlatform === "*"
      ? ["boss", "51job", "zhilian"]
      : [normalizeAutomationPlatformId(requestedPlatform)];
    const accounts = getBrowserAutomationAccounts(requestedAccount);
    const targets = [];
    for (const account of accounts) {
      for (const platform of platforms) {
        targets.push(inspectAutomationBrowserStatusTarget(account, platform));
      }
    }
    const inspectedTargets = await Promise.all(targets);
    const summary = inspectedTargets.reduce(
      (acc, target) => {
        if (target.cdpReady) acc.cdpReady += 1;
        if (target.agentReady) acc.agentReady += 1;
        if (target.status === "needs_login") acc.needsLogin += 1;
        if (target.status === "account_abnormal") acc.accountAbnormal += 1;
        if (target.status === "captcha") acc.captcha += 1;
        if (target.status === "failed") acc.failed += 1;
        if (target.status === "ready") acc.ready += 1;
        if (!target.cdpReady) acc.closed += 1;
        return acc;
      },
      { cdpReady: 0, agentReady: 0, ready: 0, needsLogin: 0, accountAbnormal: 0, captcha: 0, failed: 0, closed: 0 }
    );
    sendJson(response, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      intervalMs: 3000,
      summary,
      targets: inspectedTargets,
    });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message || "浏览器状态读取失败" });
  }
}

function configuredAutomationSources(sourceKeys) {
  return sourceKeys.filter((sourceKey) => Boolean(AUTOMATION_SUMMARY_SOURCES[sourceKey]?.baseUrl));
}

function platformAutomationSources(platform, accountId) {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const normalizedAccount = normalizeBossAutomationAccountId(accountId);
  if (normalizedPlatform === "boss") return bossAutomationSources(normalizedAccount);

  const sourceByAccount =
    normalizedPlatform === "51job"
      ? { boss_a: "job51_a", boss_b: "job51_b" }
      : { boss_a: "zhilian_a", boss_b: "zhilian_b" };
  const sourceKeys =
    normalizedAccount === "all"
      ? [sourceByAccount.boss_a, sourceByAccount.boss_b]
      : [sourceByAccount[normalizedAccount]];
  const configured = configuredAutomationSources(sourceKeys);
  if (configured.length) return configured;

  const error = new Error(`${automationPlatformLabel(normalizedPlatform)} ${automationAccountLabel(normalizedAccount)}自动化服务未配置`);
  error.statusCode = 502;
  throw error;
}

function countSummaryValue(source, ...keys) {
  for (const key of keys) {
    const value = Number(source?.[key] || 0);
    if (Number.isFinite(value) && value) return value;
  }
  return 0;
}

function sumSummaryValues(items, section, ...keys) {
  return items.reduce((total, item) => total + countSummaryValue(item?.[section] || {}, ...keys), 0);
}

function buildBossAutomationSummaryPayload(items, { accountId = "all", date = "" } = {}) {
  const selectedDate = date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const selectedDates = automationDateListFromState(selectedDate);
  const useAll = selectedDate === "all";
  const section = useAll ? "allSummary" : "todaySummary";
  const requestedResume =
    sumSummaryValues(items, section, "requestedResume") + sumSummaryValues(items, section, "alreadyRequestedResume");
  const processed = sumSummaryValues(items, section, "processedRecords", "processedPeople");
  const askedQuestions = sumSummaryValues(items, section, "askedQuestions", "sentBasic");
  const downloadedResume = sumSummaryValues(items, section, "downloadedResume");
  const knowledgeAnswered = sumSummaryValues(items, section, "knowledgeAnswered");
  const candidateQuestions = sumSummaryValues(items, section, "candidateQuestions");
  const proactiveOpened = sumSummaryValues(items, section, "proactiveOpened", "opened", "openedCandidates");
  const greeted = sumSummaryValues(items, section, "greeted");
  const recent = [];
  for (const item of items) {
    const latestEvents = Array.isArray(item.latestEvents) ? item.latestEvents : [];
    const latestReports = Array.isArray(item.latestReports) ? item.latestReports : [];
    for (const event of latestEvents.slice(0, 6)) {
      recent.push({
        time: String(event.time || event.createdAt || "").slice(0, 19),
        text: String(event.message || event.action || event.type || "自动化事件").slice(0, 180),
      });
    }
    for (const report of latestReports.slice(0, 4)) {
      recent.push({
        time: String(report.createdAt || "").slice(0, 19),
        text: String(report.message || report.type || "自动化报告").slice(0, 180),
      });
    }
  }
  let metrics = [
    { key: "processed", label: "处理人数", value: processed },
    { key: "sentCompanyInfo", label: "询问问题", value: askedQuestions },
    { key: "requestedResume", label: "求简历", value: requestedResume },
    { key: "userQuestions", label: "候选人提问", value: candidateQuestions },
    { key: "savedResumes", label: "获取简历", value: downloadedResume },
    { key: "knowledgeAnswered", label: "已答疑", value: knowledgeAnswered },
    { key: "proactiveOpened", label: "点开人数", value: proactiveOpened },
    { key: "proactiveGreeted", label: "主动打招呼", value: greeted },
    { key: "proactiveReplied", label: "主动回复", value: 0 },
    { key: "proactiveQualified", label: "主动符合", value: 0 },
  ];
  let recentItems = recent.slice(0, 12);
  if (selectedDates.length > 1) {
    const records = automationDetailRecordsFromSummaries(items, selectedDate);
    const dedupedRecords = dedupeAutomationDetailRecords(records, "processed", { includeDate: false });
    metrics = automationMetricPayloadFromRecords(records, { includeDate: false });
    recentItems = dedupedRecords.slice(0, 12).map((record) => ({
      time: String(record.updatedAt || "").slice(0, 19),
      text: String(record.phrase || record.candidateLabel || record.statusLabel || "自动化记录").slice(0, 180),
    }));
  }
  return {
    accountId: normalizeBossAutomationAccountId(accountId),
    date: selectedDate,
    today: items[0]?.today || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
    updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    metrics,
    proactiveByPosition: [],
    recent: recentItems,
  };
}

function buildAutomationSummaryPayloadFromRecords(records = [], { platform = "boss", accountId = "all", date = "" } = {}) {
  const selectedDate = normalizeAutomationDetailDate(date);
  const filteredRecords = (Array.isArray(records) ? records : [])
    .filter((record) => automationDetailDateMatches(record.updatedAt, selectedDate))
    .sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
  const includeDate = selectedDate !== "all";
  const recentRecords = dedupeAutomationDetailRecords(
    filteredRecords.filter((record) => record.type !== "event" && automationRecordHasCandidateIdentity(record)),
    "processed",
    { includeDate }
  );
  return {
    platform: normalizeAutomationPlatformId(platform),
    accountId: normalizeBossAutomationAccountId(accountId),
    date: selectedDate,
    today: automationChinaDateKey(),
    updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    metrics: automationMetricPayloadFromRecords(filteredRecords, { includeDate }),
    proactiveByPosition: [],
    recent: recentRecords.slice(0, 12).map((record) => ({
      time: String(record.updatedAt || "").slice(0, 19),
      text: String(record.phrase || record.candidateLabel || record.statusLabel || "自动化记录").slice(0, 180),
    })),
    deepStats: true,
  };
}

function automationChinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function automationDateListFromState(value = "") {
  return [
    ...new Set(
      String(value || "")
        .split(/[,\s]+/)
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
    ),
  ].sort();
}

function normalizeAutomationDetailDate(value = "") {
  const text = String(value || "").trim();
  if (text === "all" || text === "全部") return "all";
  const dates = automationDateListFromState(text);
  if (dates.length) return dates.join(",");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : automationChinaDateKey();
}

function automationDetailDateMatches(value = "", selectedDate = automationChinaDateKey()) {
  if (selectedDate === "all") return true;
  const dates = automationDateListFromState(selectedDate);
  const dateKey = automationDateKeyFromValue(value);
  if (dates.length) return dates.includes(dateKey);
  return dateKey === selectedDate;
}

function automationDetailMetricPayload(items, platform, { accountId = "all", date = "" } = {}) {
  if (platform === "boss") {
    return buildBossAutomationSummaryPayload(items, { accountId, date }).metrics;
  }
  const selectedDate = normalizeAutomationDetailDate(date);
  const section = selectedDate === "all" ? "allSummary" : "todaySummary";
  const summary = items.reduce((next, item) => {
    const source = item?.[section] || {};
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "number") next[key] = (next[key] || 0) + value;
    }
    return next;
  }, {});
  const requestedResume = Number(summary.requestedResume || 0) + Number(summary.alreadyRequestedResume || 0);
  const proactiveOpened = Number(summary.proactiveOpened || summary.opened || summary.openedCandidates || 0);
  return [
    { key: "processed", label: "处理人数", value: Number(summary.processedRecords || summary.processedPeople || 0) },
    { key: "sentCompanyInfo", label: "询问问题", value: Number(summary.askedQuestions || summary.sentBasic || 0) },
    { key: "requestedResume", label: "求简历", value: requestedResume },
    { key: "userQuestions", label: "候选人提问", value: Number(summary.candidateQuestions || 0) },
    { key: "savedResumes", label: "获取简历", value: Number(summary.downloadedResume || 0) },
    { key: "knowledgeAnswered", label: "已答疑", value: Number(summary.knowledgeAnswered || 0) },
    { key: "proactiveOpened", label: "点开人数", value: proactiveOpened },
    { key: "proactiveGreeted", label: "主动打招呼", value: Number(summary.greeted || 0) },
    { key: "proactiveReplied", label: "主动回复", value: 0 },
    { key: "proactiveQualified", label: "主动符合", value: 0 },
  ];
}

function normalizeAutomationDetailStatusGroup(action = "", status = "", reportType = "") {
  const text = `${action} ${status} ${reportType}`.toLowerCase();
  if (/already_viewed|already_greeted|state_duplicate|identity_duplicate|resume_open_failed|no_greet_button/.test(text)) return "processed";
  if (/dry_run_would_greet|screening_not_qualified|not_qualified|no_hi_button/.test(text) && /proactive|recommend|主动|推荐/.test(text)) {
    return "proactiveOpened";
  }
  if (/qualified|符合|matched/.test(text)) return "proactiveQualified";
  if (/reply|replied|回复/.test(text) && /proactive|greet|主动/.test(text)) return "proactiveReplied";
  if (/greeted|proactive_greeted|(^|[_\s-])greet($|[_\s-])|打招呼|已主动联系|已主动打招呼/.test(text)) return "proactiveGreeted";
  if (/opened|open.*candidate|open.*resume|detail|resume_dialog|read_resume|点开|查看候选/.test(text) && /proactive|recommend|主动|推荐/.test(text)) {
    return "proactiveOpened";
  }
  if (/download|saved_resume|resume_download|accepted_resume_downloaded|获取简历|下载简历/.test(text)) return "savedResumes";
  if (/request.*resume|requested_resume|accepted_requested_resume|求简历/.test(text)) return "requestedResume";
  if (/candidate_question|user_question|question_pool|knowledge_gap|needs_human_answer|knowledge_unknown/.test(text)) return "userQuestions";
  if (/knowledge_answered|(^|[_\s-])answered|答疑/.test(text)) return "knowledgeAnswered";
  if (
    /sent_basic_conditions|basic_conditions_(sent|waiting)|sent_position_screening|position_screening_(sent|waiting)|screening_question|sent_screening|已发公司情况|岗位筛选问题|筛选问题/.test(
      text
    )
  ) {
    return "sentCompanyInfo";
  }
  if (/waiting|not_asked|pending|blocked|halted/.test(text)) return "waiting";
  return "processed";
}

function automationDetailStatusLabel(statusGroup, action = "", status = "") {
  const labels = {
    processed: "已处理",
    sentCompanyInfo: "已询问",
    requestedResume: "已求简历",
    userQuestions: "候选人提问",
    savedResumes: "已获取简历",
    knowledgeAnswered: "已答疑",
    proactiveOpened: "已点开",
    proactiveGreeted: "已主动打招呼",
    proactiveReplied: "主动联系后已回复",
    proactiveQualified: "主动联系后符合",
    waiting: "等待/待判断",
  };
  return labels[statusGroup] || action || status || "已处理";
}

function automationDetailFlags(statusGroup) {
  return {
    sentCompanyInfo: statusGroup === "sentCompanyInfo",
    requestedResume: statusGroup === "requestedResume",
    userQuestions: statusGroup === "userQuestions",
    savedResumes: statusGroup === "savedResumes",
    knowledgeAnswered: statusGroup === "knowledgeAnswered",
    proactiveOpened:
      statusGroup === "proactiveOpened" ||
      statusGroup === "proactiveGreeted" ||
      statusGroup === "proactiveReplied" ||
      statusGroup === "proactiveQualified",
    proactiveGreeted: statusGroup === "proactiveGreeted" || statusGroup === "proactiveReplied" || statusGroup === "proactiveQualified",
    proactiveReplied: statusGroup === "proactiveReplied" || statusGroup === "proactiveQualified",
    proactiveQualified: statusGroup === "proactiveQualified",
    waiting: statusGroup === "waiting",
  };
}

function automationDateKeyFromValue(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const literalMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (hasExplicitTimezone) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) return automationChinaDateKey(new Date(parsed));
  }
  if (literalMatch) {
    return `${literalMatch[1]}-${String(literalMatch[2]).padStart(2, "0")}-${String(literalMatch[3]).padStart(2, "0")}`;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? automationChinaDateKey(new Date(parsed)) : "";
}

function automationDateKeyToUtcMs(dateKey = "") {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function automationDateDiffDays(leftDateKey = "", rightDateKey = "") {
  const leftMs = automationDateKeyToUtcMs(leftDateKey);
  const rightMs = automationDateKeyToUtcMs(rightDateKey);
  if (!leftMs || !rightMs) return null;
  return Math.round((leftMs - rightMs) / 86400000);
}

function automationMetricCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function automationMetricValue(metricsOrPayload = [], key = "") {
  const metrics = Array.isArray(metricsOrPayload) ? metricsOrPayload : metricsOrPayload?.metrics;
  const found = (Array.isArray(metrics) ? metrics : []).find((metric) => metric?.key === key);
  return automationMetricCount(found?.value);
}

function automationPreviousDateKey(dateKey = "") {
  const dateMs = automationDateKeyToUtcMs(dateKey);
  return dateMs ? automationChinaDateKey(new Date(dateMs - 86400000)) : "";
}

function automation24hStatusSnapshot() {
  try {
    return automation24hScheduler && typeof automation24hScheduler.status === "function" ? automation24hScheduler.status() : null;
  } catch {
    return null;
  }
}

function automation24hTargetMatchesRequest(target = {}, platform = "boss", accountId = "all") {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const normalizedAccount = normalizeBossAutomationAccountId(accountId);
  if (normalizeAutomationPlatformId(target.platform || "") !== normalizedPlatform) return false;
  if (normalizedAccount === "all") return true;
  return normalizeBossAutomationAccountId(target.accountId || "") === normalizedAccount;
}

function automation24hTargetBelongsToDate(target = {}, selectedDate = automationChinaDateKey()) {
  if (selectedDate === "all") return true;
  const targetDate = automationDateKeyFromValue(target.updatedAt || target.timestamp || "");
  if (!targetDate) return false;
  const selectedDates = automationDateListFromState(selectedDate);
  return selectedDates.length ? selectedDates.includes(targetDate) : targetDate === selectedDate;
}

function automation24hStatusProgressTargets(platform = "boss", accountId = "all", date = "") {
  const selectedDate = normalizeAutomationDetailDate(date);
  const status = automation24hStatusSnapshot();
  if (!status || !Array.isArray(status.targets)) return [];
  return status.targets
    .filter((target) => automation24hTargetMatchesRequest(target, platform, accountId))
    .filter((target) => automation24hTargetBelongsToDate(target, selectedDate))
    .filter(
      (target) =>
        automationMetricCount(target.processed) ||
        automationMetricCount(target.requestedResume) ||
        automationMetricCount(target.downloadedResume)
    )
    .map((target) => ({
      ...target,
      cycle: Number(status.cycle || 0),
      runId: String(status.runId || ""),
      progressSource: "status",
      progressKey: `${status.runId || "status"}|${status.cycle || 0}|${target.id || target.sourceKey || target.platform}`,
    }));
}

function automation24hLogDateKeys(selectedDate = automationChinaDateKey()) {
  const normalizedDate = normalizeAutomationDetailDate(selectedDate);
  if (normalizedDate === "all") return [];
  const dates = automationDateListFromState(normalizedDate);
  return dates.length ? dates : [normalizedDate];
}

function readAutomation24hLogEntries(dateKey = "") {
  const filePath = path.join(DATA_DIR, "automation-24h-logs", `${dateKey}.jsonl`);
  if (!dateKey || !fsSync.existsSync(filePath)) return [];
  try {
    return fsSync
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function automation24hSumCounts(counts = {}, keys = []) {
  if (!counts || typeof counts !== "object") return 0;
  return keys.reduce((total, key) => total + automationMetricCount(counts[key]), 0);
}

function automation24hMessageCount(message = "", patterns = []) {
  const text = String(message || "");
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return automationMetricCount(match[1]);
  }
  return 0;
}

function automation24hRoundMetricTotals(entry = {}) {
  const counts = entry.counts && typeof entry.counts === "object" ? entry.counts : {};
  const message = String(entry.resultMessage || entry.message || "");
  const sentCompanyInfo = Math.max(
    automation24hSumCounts(counts, [
      "sent_basic_conditions",
      "sent_position_screening",
      "knowledge_answered_and_sent_screening",
    ]),
    automation24hMessageCount(message, [/已发公司情况\/岗位筛选问题\s*(\d+)\s*人/])
  );
  const requestedResume = Math.max(
    automation24hSumCounts(counts, [
      "accepted_requested_resume",
      "knowledge_answered_and_requested_resume",
      "accepted_resume_already_requested",
      "knowledge_answered_resume_already_requested",
    ]),
    automation24hMessageCount(message, [/接受并求简历\s*(\d+)\s*人/])
  );
  const savedResumes = Math.max(
    automation24hSumCounts(counts, [
      "accepted_resume_downloaded",
      "knowledge_answered_resume_downloaded",
      "resume_downloaded",
    ]),
    automation24hMessageCount(message, [/接受并下载简历\s*(\d+)\s*人/])
  );
  const knowledgeAnswered = Math.max(
    automation24hSumCounts(counts, [
      "knowledge_answered",
      "knowledge_answered_and_sent_screening",
      "knowledge_answered_and_requested_resume",
      "knowledge_answered_resume_downloaded",
    ]),
    automation24hMessageCount(message, [/知识库答复\s*(\d+)\s*人/])
  );
  return {
    sentCompanyInfo,
    requestedResume,
    savedResumes,
    userQuestions: automation24hSumCounts(counts, ["candidate_question", "user_question", "knowledge_gap", "knowledge_unknown"]),
    knowledgeAnswered,
  };
}

function automation24hAddRoundMetrics(target = {}, metrics = {}) {
  for (const key of ["sentCompanyInfo", "requestedResume", "savedResumes", "userQuestions", "knowledgeAnswered"]) {
    target[key] = automationMetricCount(target[key]) + automationMetricCount(metrics[key]);
  }
}

function automation24hLogProgressTargets(platform = "boss", accountId = "all", date = "") {
  const selectedDate = normalizeAutomationDetailDate(date);
  const finalEvents = new Set(["target_completed", "target_stopped", "target_interrupted"]);
  const roundEvents = new Set(["round_completed"]);
  const byTargetRun = new Map();
  for (const dateKey of automation24hLogDateKeys(selectedDate)) {
    for (const entry of readAutomation24hLogEntries(dateKey)) {
      if (!entry || typeof entry !== "object") continue;
      const event = String(entry.event || "");
      if (!finalEvents.has(event) && !roundEvents.has(event)) continue;
      const progressKey = `${entry.runId || dateKey}|${entry.cycle || 0}|${entry.targetId || entry.platform || ""}:${entry.accountId || ""}`;
      const target = {
        id: entry.targetId || `${entry.platform}:${entry.accountId}`,
        platform: entry.platform,
        platformLabel: entry.platformLabel,
        accountId: entry.accountId,
        accountName: entry.accountName,
        sourceKey: entry.sourceKey,
        label: entry.targetLabel || entry.platformLabel || entry.platform,
        updatedAt: entry.timestamp || "",
        timestamp: entry.timestamp || "",
        cycle: Number(entry.cycle || 0),
        runId: String(entry.runId || ""),
        progressSource: "log",
        progressKey,
      };
      if (!automation24hTargetMatchesRequest(target, platform, accountId)) continue;
      if (!automation24hTargetBelongsToDate(target, selectedDate)) continue;
      const current =
        byTargetRun.get(progressKey) || {
          ...target,
          processed: 0,
          requestedResume: 0,
          downloadedResume: 0,
          roundProcessed: 0,
          roundRequestedResume: 0,
          roundDownloadedResume: 0,
          finalProcessed: 0,
          finalRequestedResume: 0,
          finalDownloadedResume: 0,
          interruptedProcessed: 0,
          interruptedRequestedResume: 0,
          interruptedDownloadedResume: 0,
          sentCompanyInfo: 0,
          savedResumes: 0,
          userQuestions: 0,
          knowledgeAnswered: 0,
        };
      Object.assign(current, {
        id: target.id || current.id,
        platform: target.platform || current.platform,
        platformLabel: target.platformLabel || current.platformLabel,
        accountId: target.accountId || current.accountId,
        accountName: target.accountName || current.accountName,
        sourceKey: target.sourceKey || current.sourceKey,
        label: target.label || current.label,
      });
      if (Date.parse(target.updatedAt || "") >= Date.parse(current.updatedAt || "")) {
        current.updatedAt = target.updatedAt;
        current.timestamp = target.timestamp;
      }
      if (event === "round_completed") {
        current.roundProcessed += automationMetricCount(entry.processed);
        current.roundRequestedResume += automationMetricCount(entry.requestedResume);
        current.roundDownloadedResume += automationMetricCount(entry.downloadedResume);
        automation24hAddRoundMetrics(current, automation24hRoundMetricTotals(entry));
      } else if (event === "target_interrupted") {
        current.interruptedProcessed += automationMetricCount(entry.partialProcessed || entry.processed);
        current.interruptedRequestedResume += automationMetricCount(entry.partialRequestedResume || entry.requestedResume);
        current.interruptedDownloadedResume += automationMetricCount(entry.partialDownloadedResume || entry.downloadedResume);
        automation24hAddRoundMetrics(current, automation24hRoundMetricTotals(entry));
      } else {
        current.finalProcessed = automationMetricCount(entry.processed);
        current.finalRequestedResume = automationMetricCount(entry.requestedResume);
        current.finalDownloadedResume = automationMetricCount(entry.downloadedResume);
      }
      current.processed = Math.max(current.finalProcessed, current.roundProcessed + current.interruptedProcessed);
      current.requestedResume = Math.max(
        current.finalRequestedResume,
        current.roundRequestedResume + current.interruptedRequestedResume,
        automationMetricCount(current.requestedResume)
      );
      current.downloadedResume = Math.max(
        current.finalDownloadedResume,
        current.roundDownloadedResume + current.interruptedDownloadedResume,
        automationMetricCount(current.downloadedResume),
        automationMetricCount(current.savedResumes)
      );
      if (
        automationMetricCount(current.processed) ||
        automationMetricCount(current.requestedResume) ||
        automationMetricCount(current.downloadedResume) ||
        automationMetricCount(current.sentCompanyInfo) ||
        automationMetricCount(current.knowledgeAnswered)
      ) {
        byTargetRun.set(progressKey, current);
      }
    }
  }
  return [...byTargetRun.values()];
}

function automation24hProgressLogicalKey(target = {}) {
  return [
    Number(target.cycle || 0),
    normalizeAutomationPlatformId(target.platform || ""),
    normalizeBossAutomationAccountId(target.accountId || ""),
    String(target.sourceKey || ""),
    String(target.id || ""),
  ].join("|");
}

function automation24hProgressCountsMatch(left = {}, right = {}) {
  return (
    automationMetricCount(left.processed) === automationMetricCount(right.processed) &&
    automationMetricCount(left.requestedResume) === automationMetricCount(right.requestedResume) &&
    automationMetricCount(left.downloadedResume) === automationMetricCount(right.downloadedResume)
  );
}

function automation24hProgressTargets(platform = "boss", accountId = "all", date = "") {
  const byKey = new Map();
  const logTargets = automation24hLogProgressTargets(platform, accountId, date);
  const statusTargets = automation24hStatusProgressTargets(platform, accountId, date).filter((statusTarget) => {
    const logicalKey = automation24hProgressLogicalKey(statusTarget);
    return !logTargets.some(
      (logTarget) =>
        automation24hProgressLogicalKey(logTarget) === logicalKey &&
        automation24hProgressCountsMatch(logTarget, statusTarget)
    );
  });
  for (const target of [...logTargets, ...statusTargets]) {
    const key = target.progressKey || `${target.id || target.sourceKey || target.platform}:${target.accountId || ""}`;
    const current = byKey.get(key);
    if (!current || automationMetricCount(target.processed) >= automationMetricCount(current.processed)) {
      byKey.set(key, target);
    }
  }
  return [...byKey.values()];
}

function automation24hProgressSummary(platform = "boss", accountId = "all", date = "") {
  const targets = automation24hProgressTargets(platform, accountId, date);
  if (!targets.length) return null;
  const totals = targets.reduce(
    (acc, target) => {
      acc.processed += automationMetricCount(target.processed);
      acc.requestedResume += automationMetricCount(target.requestedResume);
      acc.downloadedResume += automationMetricCount(target.downloadedResume);
      acc.sentCompanyInfo += automationMetricCount(target.sentCompanyInfo);
      acc.userQuestions += automationMetricCount(target.userQuestions);
      acc.knowledgeAnswered += automationMetricCount(target.knowledgeAnswered);
      return acc;
    },
    { processed: 0, requestedResume: 0, downloadedResume: 0, sentCompanyInfo: 0, userQuestions: 0, knowledgeAnswered: 0 }
  );
  if (
    !totals.processed &&
    !totals.requestedResume &&
    !totals.downloadedResume &&
    !totals.sentCompanyInfo &&
    !totals.userQuestions &&
    !totals.knowledgeAnswered
  ) {
    return null;
  }
  return {
    targets,
    totals,
    metrics: [
      { key: "processed", label: "处理人数", value: totals.processed },
      { key: "sentCompanyInfo", label: "询问问题", value: totals.sentCompanyInfo },
      { key: "requestedResume", label: "求简历", value: totals.requestedResume },
      { key: "userQuestions", label: "候选人提问", value: totals.userQuestions },
      { key: "savedResumes", label: "获取简历", value: totals.downloadedResume },
      { key: "knowledgeAnswered", label: "已答疑", value: totals.knowledgeAnswered },
      { key: "proactiveOpened", label: "点开人数", value: 0 },
      { key: "proactiveGreeted", label: "主动打招呼", value: 0 },
      { key: "proactiveReplied", label: "主动回复", value: 0 },
      { key: "proactiveQualified", label: "主动符合", value: 0 },
    ],
  };
}

function applyAutomation24hProgressFallback(payload = {}, { platform = "boss", accountId = "all", date = "" } = {}) {
  const recovered = automation24hProgressSummary(platform, accountId, date || payload.date || automationChinaDateKey());
  if (!recovered) return payload;
  let changed = false;
  const currentMetrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const hasCurrentMetrics = currentMetrics.some((metric) =>
    ["processed", "sentCompanyInfo", "requestedResume", "userQuestions", "savedResumes", "knowledgeAnswered"].includes(
      String(metric?.key || "")
    ) && automationMetricCount(metric?.value)
  );
  if (hasCurrentMetrics) return payload;
  const recoveredByKey = new Map(recovered.metrics.map((metric) => [metric.key, metric]));
  const metricKeys = new Set([...currentMetrics.map((metric) => metric.key), ...recoveredByKey.keys()]);
  const metrics = [...metricKeys].map((key) => {
    const current = currentMetrics.find((metric) => metric.key === key) || recoveredByKey.get(key) || { key, label: key, value: 0 };
    const recoveredMetric = recoveredByKey.get(key);
    if (recoveredMetric && automationMetricCount(recoveredMetric.value) > automationMetricCount(current.value)) {
      changed = true;
      return { ...current, value: automationMetricCount(recoveredMetric.value) };
    }
    return current;
  });
  if (!changed) return payload;
  return {
    ...payload,
    metrics,
    recoveredFrom24hStatus: true,
    recoverySource: "automation24h_progress",
    recoveryNote: "当前日期没有明细记录，已使用24小时自动运转最近一轮进度兜底展示。",
    recent: recovered.targets.slice(0, 12).map((target) => ({
      time: String(target.updatedAt || "").slice(0, 19),
      text: `${target.label || target.platformLabel || "自动化"}：处理 ${automationMetricCount(target.processed)}，获取 ${automationMetricCount(target.downloadedResume)}，求简历 ${automationMetricCount(target.requestedResume)}`,
    })),
  };
}

function automation24hFallbackDetailRecords(platform = "boss", accountId = "all", date = "", currentMetrics = []) {
  const targets = automation24hProgressTargets(platform, accountId, date);
  const records = [];
  let remainingSkip = automationMetricValue(currentMetrics, "processed");
  targets.forEach((target) => {
    const processed = automationMetricCount(target.processed);
    const requestedResume = automationMetricCount(target.requestedResume);
    const downloadedResume = automationMetricCount(target.downloadedResume);
    for (let index = 0; index < processed; index += 1) {
      if (remainingSkip > 0) {
        remainingSkip -= 1;
        continue;
      }
      const statusGroup =
        index < downloadedResume ? "savedResumes" : index < downloadedResume + requestedResume ? "requestedResume" : "processed";
      records.push({
        id: `automation-24h-${target.id || target.sourceKey || target.platform}-${index + 1}`,
        type: "candidate",
        typeLabel: "24h汇总",
        platform: normalizeAutomationPlatformId(target.platform || platform),
        sourceKey: target.sourceKey || "",
        candidateName: `${target.label || target.platformLabel || "24h"} 汇总 ${index + 1}`,
        appliedPosition: "未识别岗位",
        status: "automation24h_fallback",
        statusGroup,
        statusLabel: automationDetailStatusLabel(statusGroup, "automation24h_fallback", ""),
        updatedAt: target.updatedAt || "",
        updatedAtTs: automationDetailTimestamp(target.updatedAt || ""),
        source: target.label || target.platformLabel || "24小时自动运转",
        candidateLabel: `${target.label || "24h自动运转"} 汇总记录`,
        phrase: "24小时自动运转已关闭 agent，使用本轮进度兜底展示。",
        question: "",
        answer: "",
        action: "automation24h_fallback",
        flags: automationDetailFlags(statusGroup),
        resumeFiles: [],
        conversation: {
          summary: `${target.label || "24h自动运转"} 最近一轮处理 ${processed} 条消息，获取 ${downloadedResume} 个简历，求简历 ${requestedResume} 个。`,
          counterpart: {
            name: `${target.label || "24h"} 汇总 ${index + 1}`,
            organization: "",
            role: "未识别岗位",
            appliedPosition: "未识别岗位",
            rawHeader: `${target.label || "24h自动运转"} 汇总记录`,
          },
          recentMessages: [],
          currentRecord: target,
        },
        recoveredFrom24hStatus: true,
      });
    }
  });
  return records;
}

function normalizeAutomationName(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：()（）【】\[\]<>《》"'“”‘’]/g, "")
    .trim();
}

function cleanAutomationCandidateName(value = "") {
  const name = String(value || "")
    .replace(/^[\d\s.、-]+/, "")
    .replace(/^\d{1,2}[:：]\d{2}\s*/, "")
    .replace(/^\d{1,2}\/\d{1,2}\s*/, "")
    .replace(/^\d{4}-\d{2}-\d{2}\s*/, "")
    .replace(/[，,。.;；:：()（）【】\[\]<>《》"'“”‘’]/g, "")
    .trim();
  if (!name) return "";
  if (/^\d+$/.test(name) || /^\d{1,2}[:：]\d{2}$/.test(name) || /^\d{1,2}\/\d{1,2}$/.test(name)) return "";
  if (/^(候选人|自动化事件|未知|未命名|人才|对方|简历|附件简历|在线简历|已投|不合适)$/i.test(name)) return "";
  if (/^(hrbp|hr|AI实习生|AI应用开发实习生|AI应用开发工程师|电气工程师|销售管培生|国际业务管培生|膨润土销售人员)$/i.test(name)) return "";
  if (normalizeJobType(name) === name && RESUME_LIBRARY_JOB_TYPES.includes(name)) return "";
  return name;
}

function automationJobMarkersForParsing(jobType = "") {
  const markers = [
    jobType,
    normalizeJobType(jobType),
    ...RESUME_LIBRARY_JOB_TYPES,
    ...LEGACY_JOB_TYPES,
    "AI应用开发实习生",
    "AI实习生",
    "AI应用开发工程师",
    "应用技术管培生",
    "膨润土销售人员",
    "膨润土销售",
    "人力资源管培生",
    "hrbp",
    "HRBP",
    "电气工程师",
    "销售管培生",
    "国际业务管培生",
  ];
  return [...new Set(markers.filter(Boolean))].sort((left, right) => right.length - left.length);
}

function automationCandidateNameFromLabel(label = "", jobType = "") {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  for (const marker of automationJobMarkersForParsing(jobType)) {
    const index = text.toLowerCase().indexOf(String(marker).toLowerCase());
    if (index <= 0) continue;
    const prefix = text
      .slice(0, index)
      .replace(/^\d+\s+/, "")
      .replace(/^\d{1,2}[:：]\d{2}\s+/, "")
      .trim();
    const token = prefix.split(/\s+/)[0] || "";
    const name = cleanAutomationCandidateName(token);
    if (name) return name;
  }
  const stripped = text
