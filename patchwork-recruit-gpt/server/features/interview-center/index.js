const { createInterviewStore } = require("./store");
const { createFeishuClient } = require("./feishuClient");
const { enrichSessionWithMatches } = require("./candidateMatcher");
const { generateInterviewQuestions, summarizeConversation } = require("./questionGenerator");
const { generateInterviewEvaluation, formatSkillEvaluationDocumentText } = require("./feedbackBackfill");
const { ensureBitableResumeImage, ensureBitableInterviewRecordImage, ensureBitableSkillEvaluationDocument } = require("./bitableAssets");
const { clipText, compactText, normalizeText, nowIso, parseJson, randomId, safeArray } = require("./utils");

const DAY_SECONDS = 24 * 60 * 60;
const BACKFILL_GRACE_SECONDS = 10 * 60;
const AUTO_BACKFILL_INTERVAL_MS = Math.max(60000, Number(process.env.INTERVIEW_BACKFILL_INTERVAL_MS || 5 * 60 * 1000));
const AUTO_BACKFILL_MAX_PER_TICK = Math.max(1, Math.min(Number(process.env.INTERVIEW_BACKFILL_MAX_PER_TICK || 3), 10));
const AUTO_BACKFILL_MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.INTERVIEW_BACKFILL_MAX_ATTEMPTS || 3), 10));
const AUTO_BACKFILL_ENABLED = !/^(0|false|no)$/i.test(String(process.env.INTERVIEW_AUTO_BACKFILL_ENABLED ?? "true"));
const AUTO_CALENDAR_SYNC_INTERVAL_MS = Math.max(60000, Number(process.env.INTERVIEW_CALENDAR_SYNC_INTERVAL_MS || 5 * 60 * 1000));
const AUTO_CALENDAR_SYNC_ENABLED = !/^(0|false|no)$/i.test(String(process.env.INTERVIEW_CALENDAR_SYNC_ENABLED ?? "true"));
const BITABLE_INTERVIEW_STAGE_FIELD = process.env.FEISHU_INTERVIEW_STAGE_FIELD || "面试阶段";
const BITABLE_SESSION_META_TTL_MS = Math.max(15000, Number(process.env.INTERVIEW_BITABLE_META_TTL_MS || 60000));

function createInterviewCenterFeature(context) {
  const store = createInterviewStore({ getDb: context.getDb });
  const feishu = createFeishuClient({
    appId: context.feishuAppId,
    appSecret: context.feishuAppSecret,
    store,
    bitableAppToken: context.bitableAppToken,
    bitableTableId: context.bitableTableId,
    authorizeUrl: context.authorizeUrl,
  });
  const backfillRunning = new Set();
  const backfillScheduler = {
    enabled: AUTO_BACKFILL_ENABLED,
    running: false,
    timer: 0,
    lastRunAt: "",
    lastError: "",
    lastProcessed: [],
  };
  const calendarSyncScheduler = {
    enabled: AUTO_CALENDAR_SYNC_ENABLED,
    running: false,
    timer: 0,
    lastRunAt: "",
    lastError: "",
    lastResult: null,
  };
  const bitableSessionMetaCache = {
    fetchedAt: 0,
    records: [],
  };

  function send(response, statusCode, payload) {
    context.sendJson(response, statusCode, payload);
  }

  function sendError(response, error, fallback = "面试中心处理失败") {
    send(response, error.statusCode || 500, {
      ok: false,
      error: error.message || fallback,
      ...(error.payload || {}),
    });
  }

  function getBaseUrl(request) {
    const proto = request.headers["x-forwarded-proto"] || (request.socket?.encrypted ? "https" : "http");
    const host = request.headers["x-forwarded-host"] || request.headers.host || "127.0.0.1:8765";
    return `${proto}://${host}`;
  }

  function getRedirectUri(request) {
    return context.redirectUri || `${getBaseUrl(request)}/api/interview-center/feishu/oauth/callback`;
  }

  function sendHtml(response, statusCode, html) {
    response.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
  }

  async function getResumeRecords() {
    const records = await context.readDatabase();
    return records.filter((record) => record && record.id);
  }

  async function getPublicResumes() {
    const records = await getResumeRecords();
    return records.map(context.publicResumeListRecord || context.publicRecord);
  }

  async function getResumeById(id) {
    if (context.findResume) {
      const found = await context.findResume(id);
      if (found?.record) return found;
    }
    const records = await getResumeRecords();
    const index = records.findIndex((record) => record.id === id);
    return { records, index, record: index >= 0 ? records[index] : null };
  }

  async function getConversationForResume(resume) {
    const contactEvidence = safeArray(resume.platformContact?.chatEvidence).map((text) => ({
      sender: "other",
      text: typeof text === "string" ? text : text?.text || "",
    }));
    const fallback = {
      summary: contactEvidence.length ? contactEvidence.map((item) => item.text).join("\n") : "",
      recentMessages: contactEvidence,
    };
    if (!context.collectAutomationConversationCandidates || !context.scoreResumeConversationMatch) return fallback;
    try {
      const candidates = (await context.collectAutomationConversationCandidates())
        .map((candidate) => ({ candidate, match: context.scoreResumeConversationMatch(context.publicRecord(resume), candidate) }))
        .filter((item) => item.match.score >= 70)
        .sort((left, right) => right.match.score - left.match.score);
      return candidates[0]?.candidate?.conversation || fallback;
    } catch {
      return fallback;
    }
  }

  function makeGptContext() {
    return {
      callGptJson: context.callGptJson,
      makeAbortController: context.makeAbortController,
      timeoutMs: context.gptTextTimeoutMs || 180000,
    };
  }

  function extractBitableFieldText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return compactText(value);
    if (Array.isArray(value)) return value.map(extractBitableFieldText).filter(Boolean).join(" ");
    if (typeof value === "object") {
      return compactText(
        [
          value.text,
          value.name,
          value.value,
          value.email,
          value.id,
          safeArray(value.text_arr).map(extractBitableFieldText).join(" "),
        ]
          .filter(Boolean)
          .join(" ")
      );
    }
    return "";
  }

  function bitableRecordId(record = {}) {
    return record?.record_id || record?.id || "";
  }

  function sessionBitableRecordId(session = {}) {
    return (
      session.bitableRecordId ||
      session.bitable?.recordId ||
      session.bitableResumeImage?.recordId ||
      session.bitableInterviewRecordImage?.recordId ||
      session.bitableSkillEvaluationDocument?.recordId ||
      ""
    );
  }

  async function listBitableRecordsForSessionMeta() {
    if (!feishu.getStatus().bitableConfigured) return [];
    if (bitableSessionMetaCache.records.length && Date.now() - bitableSessionMetaCache.fetchedAt < BITABLE_SESSION_META_TTL_MS) {
      return bitableSessionMetaCache.records;
    }
    const records = await feishu.listBitableRecords({ pageSize: 500, maxRecords: 3000 });
    bitableSessionMetaCache.records = records;
    bitableSessionMetaCache.fetchedAt = Date.now();
    return records;
  }

  function findBitableRecordForSession(session = {}, records = [], recordsById = new Map()) {
    const directId = sessionBitableRecordId(session);
    if (directId && recordsById.has(directId)) return recordsById.get(directId);

    const phone = normalizeText(session.resume?.phone || "");
    if (phone) {
      const byPhone = records.find((record) => normalizeText(extractBitableFieldText(record.fields?.候选人联系电话)).includes(phone));
      if (byPhone) return byPhone;
    }

    const names = [
      session.resume?.name,
      session.matchedResume?.name,
      session.bitable?.fields?.姓名,
      session.bitable?.fields?.候选人姓名,
    ]
      .map(normalizeText)
      .filter(Boolean);
    if (!names.length) return null;
    return (
      records.find((record) => {
        const fields = record.fields || {};
        const recordNames = [fields.姓名, fields.候选人姓名].map((value) => normalizeText(extractBitableFieldText(value))).filter(Boolean);
        return recordNames.some((name) => names.includes(name));
      }) || null
    );
  }

  function deriveInterviewRound({ stageText = "", session = {} } = {}) {
    const rawText = compactText([stageText, session.title, session.description].filter(Boolean).join(" "));
    const normalized = normalizeText(rawText);
    if (/二面|二试|复试|复面|second|2面|2试/.test(rawText) || /二面|二试|复试|复面|second|2面|2试/i.test(normalized)) {
      return { key: "second", label: "二面" };
    }
    if (/终面|三面|三试/.test(rawText)) return { key: "other", label: "其他轮次" };
    if (/初面|初试|一面|一试|简历通过|待面试|面试/.test(rawText) || !rawText) return { key: "first", label: "初面" };
    return { key: "other", label: "其他轮次" };
  }

  function deriveInterviewGroup({ stageText = "", record = null, session = {}, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
    const rawStage = compactText(stageText);
    if (rawStage) {
      if (/简历通过|待面试|待初面|待一面|待二面|待复试|已约|约面|邀约/.test(rawStage)) {
        return { key: "waiting", label: "等待面试" };
      }
      if (/初面|初试|一面|二面|二试|复试|复面|终面|面试|通过|未通过|淘汰|不合适|完成|结束/.test(rawStage)) {
        return { key: "completed", label: "已经面试" };
      }
    }
    const fields = record?.fields || {};
    if (
      session.interviewEvaluation ||
      session.bitableInterviewRecordImage?.fileToken ||
      extractBitableFieldText(fields.面试记录) ||
      extractBitableFieldText(fields.HR面试评价) ||
      extractBitableFieldText(fields.复试结果评价)
    ) {
      return { key: "completed", label: "已经面试" };
    }
    const end = Number(session.endTime || session.startTime || 0);
    return end && end < nowSeconds ? { key: "completed", label: "已经面试" } : { key: "waiting", label: "等待面试" };
  }

  function makeInterviewFlow(session = {}, record = null, bitableError = "") {
    const fields = record?.fields || {};
    const stageText = extractBitableFieldText(fields[BITABLE_INTERVIEW_STAGE_FIELD] ?? fields.面试阶段);
    const group = deriveInterviewGroup({ stageText, record, session });
    const round = deriveInterviewRound({ stageText, session });
    return {
      groupKey: group.key,
      groupLabel: group.label,
      roundKey: round.key,
      roundLabel: round.label,
      stageText,
      source: record ? "bitable" : "calendar",
      recordId: bitableRecordId(record) || sessionBitableRecordId(session),
      error: bitableError || "",
    };
  }

  async function enrichSessionsWithInterviewFlow(sessions = []) {
    const items = safeArray(sessions);
    if (!items.length) return [];
    let records = [];
    let bitableError = "";
    if (feishu.getStatus().bitableConfigured) {
      try {
        records = await listBitableRecordsForSessionMeta();
      } catch (error) {
        bitableError = error.message || "读取飞书面试表状态失败";
      }
    }
    const recordsById = new Map(records.map((record) => [bitableRecordId(record), record]).filter(([id]) => id));
    return items.map((session) => {
      const record = findBitableRecordForSession(session, records, recordsById);
      return {
        ...session,
        interviewFlow: makeInterviewFlow(session, record, bitableError),
      };
    });
  }

  async function enrichSessionWithInterviewFlow(session) {
    const [next] = await enrichSessionsWithInterviewFlow(session ? [session] : []);
    return next || session;
  }

  function backfillAvailableAt(session = {}) {
    const baseTime = Number(session.endTime || session.startTime || 0);
    return baseTime ? baseTime + BACKFILL_GRACE_SECONDS : 0;
  }

  function prematureBackfillGuard(session = {}) {
    if (!session.interviewEvaluation) return null;
    const availableAt = backfillAvailableAt(session);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (session.earlyBackfillOverride?.usedAt && Number(session.earlyBackfillOverride.availableAt || 0) === availableAt) {
      return null;
    }
    if (availableAt && nowSeconds < availableAt) {
      return {
        reason: "interview_not_finished",
        availableAt,
        nowSeconds,
        endTime: Number(session.endTime || 0),
      };
    }
    return null;
  }

  function isEarlyBackfillOverrideAllowed(session = {}, token = "") {
    const override = session.earlyBackfillOverride || {};
    if (!override.allowed || override.usedAt || override.failedAt) return false;
    const expectedToken = compactText(override.token || "");
    if (!expectedToken) return false;
    if (expectedToken && expectedToken !== compactText(token || "")) return false;
    const expiresAt = override.expiresAt ? Date.parse(override.expiresAt) : 0;
    if (expiresAt && Date.now() > expiresAt) return false;
    return true;
  }

  function statusWithoutBackfill(session = {}) {
    if (session.feishuDoc?.documentId) return session.feishuDoc.contentSynced === false ? "prepared_local" : "prepared";
    if (session.questionSet) return "questions_generated";
    if (session.resumeId) return "matched";
    if (["backfilling", "backfill_failed", "needs_review", "completed"].includes(session.status)) return "synced";
    return session.status || "synced";
  }

  async function clearResumePrematureBackfill(session, stalePayload) {
    if (!session.resumeId) return false;
    const { records, index, record } = await getResumeById(session.resumeId);
    if (!record || index < 0) return false;
    if (record.interviewEvaluation?.sessionId && record.interviewEvaluation.sessionId !== session.id) return false;
    if (!record.interviewEvaluation) return false;
    const nextRecord = {
      ...record,
      staleInterviewEvaluation: {
        ...(stalePayload || {}),
        evaluation: record.interviewEvaluation,
      },
      updatedAt: nowIso(),
    };
    delete nextRecord.interviewEvaluation;
    records[index] = nextRecord;
    await context.writeDatabase(records);
    context.invalidateResumeListResponseCache?.();
    return true;
  }

  async function clearPrematureBackfill(session, guard, source = "calendar_sync") {
    const stalePayload = {
      evaluation: session.interviewEvaluation,
      backfillSource: session.backfillSource || session.interviewEvaluation?.source || null,
      ruleSuggestionIds: safeArray(session.ruleSuggestionIds),
      backfilledAt: session.backfilledAt || "",
      clearedAt: nowIso(),
      reason: guard.reason,
      source,
      availableAt: guard.availableAt,
      endTime: guard.endTime,
    };
    await clearResumePrematureBackfill(session, stalePayload).catch((error) => {
      store.appendLog(session.id, "warn", error.message || "清理简历库过早回灌结果失败", error.payload || {});
    });
    const history = [stalePayload, ...safeArray(session.staleInterviewEvaluationHistory)].slice(0, 5);
    const next = store.saveSession({
      ...session,
      status: statusWithoutBackfill(session),
      interviewEvaluation: null,
      backfillSource: null,
      ruleSuggestionIds: [],
      backfillStartedAt: "",
      backfilledAt: "",
      lastBackfillError: "",
      staleInterviewEvaluation: stalePayload,
      staleInterviewEvaluationHistory: history,
    });
    store.appendLog(session.id, "warn", "已清理未到面试时间的历史回灌结果", stalePayload);
    return next;
  }

  async function protectPrematureBackfills(sessions = [], source = "sessions") {
    const protectedSessions = [];
    for (const session of safeArray(sessions)) {
      const guard = prematureBackfillGuard(session);
      protectedSessions.push(guard ? await clearPrematureBackfill(session, guard, source) : session);
    }
    return protectedSessions;
  }

  async function matchAndSaveSession(session, resumes) {
    const enriched = enrichSessionWithMatches(session, resumes, {
      minScore: context.autoMatchMinScore || 85,
      leadScore: context.autoMatchLeadScore || 15,
    });
    const saved = store.saveSession(enriched);
    if (saved.resumeId && saved.matchMode === "auto" && session.resumeId !== saved.resumeId) {
      store.appendLog(saved.id, "info", "已自动绑定高置信候选人", { resumeId: saved.resumeId, match: saved.match });
    }
    return saved;
  }

  async function syncSessionResumeImageToBitable(session) {
    if (!session?.resumeId || !session.isInterviewLike) return { skipped: true, reason: "missing_resume_binding" };
    const { record: resume } = await getResumeById(session.resumeId);
    if (!resume) return { skipped: true, reason: "resume_not_found" };
    const result = await ensureBitableResumeImage({
      feishu,
      store,
      session,
      resume,
      dataDir: context.dataDir,
    });
    if (result.ok) {
      store.appendLog(session.id, "info", "已同步简历长截图到飞书面试表", {
        recordId: result.recordId,
        fileToken: result.resumeImage?.fileToken,
      });
    }
    return result;
  }

  async function syncSessionInterviewRecordImageToBitable(session, resume) {
    const result = await ensureBitableInterviewRecordImage({
      feishu,
      store,
      session,
      resume,
      dataDir: context.dataDir,
    });
    if (result.ok) {
      store.appendLog(session.id, "info", "已同步面试记录总结截图到飞书面试表", {
        recordId: result.recordId,
        fileToken: result.interviewRecordImage?.fileToken,
      });
    }
    return result;
  }

  async function syncSessionSkillEvaluationDocumentToBitable(session, resume) {
    const publicResume = context.publicRecord(resume);
    const result = await ensureBitableSkillEvaluationDocument({
      feishu,
      store,
      session,
      resume: publicResume,
      createDocument: async () =>
        feishu.createDocumentFromText({
          title: `${session.interviewEvaluation?.candidateName || publicResume.name || session.matchedResume?.name || "候选人"}-${session.interviewEvaluation?.targetRole || publicResume.jobType || "面试"}-技能评价`,
          docText: formatSkillEvaluationDocumentText({
            resume: publicResume,
            session,
            evaluation: session.interviewEvaluation,
          }),
          action: "创建飞书技能评价文档",
        }),
      fieldText: "",
    });
    if (result.ok) {
      store.appendLog(session.id, "info", "已生成技能评价飞书文档并同步到飞书面试表", {
        recordId: result.recordId,
        documentId: result.skillEvaluationDocument?.documentId,
        url: result.skillEvaluationDocument?.url,
      });
    }
    return result;
  }

  async function prepareSession(sessionId, { force = false } = {}) {
    let session = store.getSession(sessionId);
    if (!session) {
      const error = new Error("面试日程不存在");
      error.statusCode = 404;
      throw error;
    }
    if (!session.resumeId) {
      const error = new Error("该日程尚未绑定候选人");
      error.statusCode = 409;
      throw error;
    }

    const { record: resume } = await getResumeById(session.resumeId);
    if (!resume) {
      const error = new Error("绑定的候选人简历不存在");
      error.statusCode = 404;
      throw error;
    }

    const publicResume = context.publicRecord(resume);
    const conversation = await getConversationForResume(resume);
    const scoringRules = context.getCurrentScoringRules
      ? context.getCurrentScoringRules(publicResume.jobType || resume.jobType || "")
      : {};
    const questionSet =
      !force && session.questionSet
        ? session.questionSet
        : await generateInterviewQuestions({
            resume: publicResume,
            conversation,
            scoringRules,
            gpt: makeGptContext(),
          });

    session = store.saveSession({
      ...session,
      resumeId: resume.id,
      resume: publicResume,
      conversationSummary: summarizeConversation(conversation),
      questionSet,
      status: session.feishuDoc && !force ? "prepared" : "questions_generated",
      preparedAt: nowIso(),
    });

    let feishuDoc = session.feishuDoc || null;
    let docError = "";
    if (force || !feishuDoc?.documentId) {
      try {
        feishuDoc = await feishu.createInterviewDocument({
          ...session,
          resume: publicResume,
          questionSet,
        });
        if (feishuDoc.contentSynced === false) {
          docError = feishuDoc.contentError || "飞书面试文档已创建，但正文写入失败";
          store.appendLog(session.id, "warn", docError, {
            documentId: feishuDoc.documentId,
            url: feishuDoc.url,
            payload: feishuDoc.contentErrorPayload || {},
          });
        } else {
          store.appendLog(session.id, "info", "已创建并写入飞书面试文档", { documentId: feishuDoc.documentId, url: feishuDoc.url });
        }
      } catch (error) {
        docError = error.message || "创建飞书文档失败";
        store.appendLog(session.id, "error", docError, error.payload || {});
      }
    } else if (feishuDoc.contentSynced === false) {
      try {
        const syncResult = await feishu.syncInterviewDocumentContent(feishuDoc.documentId, {
          ...session,
          resume: publicResume,
          questionSet,
        });
        feishuDoc = { ...feishuDoc, ...syncResult };
        store.appendLog(session.id, "info", "已补写飞书面试文档正文", { documentId: feishuDoc.documentId, url: feishuDoc.url });
      } catch (error) {
        docError = error.message || "补写飞书文档正文失败";
        feishuDoc = {
          ...feishuDoc,
          contentSynced: false,
          contentError: docError,
          contentErrorPayload: error.payload || null,
        };
        store.appendLog(session.id, "warn", docError, error.payload || {});
      }
    }

    let bitable = session.bitable || null;
    let bitableError = "";
    const documentReady = Boolean(feishuDoc?.documentId && feishuDoc.contentSynced !== false);
    if (session.bitableRecordId || bitable?.recordId) {
      try {
        bitable = await feishu.syncBitableRecord({
          ...session,
          resume: publicResume,
          questionSet,
          feishuDoc,
          bitableRecordId: session.bitableRecordId || bitable?.recordId || "",
          status: documentReady ? "prepared" : "prepared_local",
        });
        if (!bitable?.skipped) {
          store.appendLog(session.id, "info", "已更新飞书面试表基础信息", { recordId: bitable.recordId });
        }
      } catch (error) {
        bitableError = error.message || "更新飞书面试表基础信息失败";
        store.appendLog(session.id, "warn", bitableError, error.payload || {});
      }
    }

    return store.saveSession({
      ...session,
      resume: publicResume,
      questionSet,
      feishuDoc,
      bitable,
      bitableRecordId: bitable?.recordId || session.bitableRecordId || "",
      status: documentReady ? "prepared" : "prepared_local",
      prepareErrors: [docError, bitableError].filter(Boolean),
      preparedAt: nowIso(),
    });
  }

  async function backfillSession(sessionId, { force = false, earlyOverride = false, earlyOverrideReason = "", earlyOverrideToken = "" } = {}) {
    let session = store.getSession(sessionId);
    if (!session) {
      const error = new Error("面试日程不存在");
      error.statusCode = 404;
      throw error;
    }
    if (!session.resumeId) {
      const error = new Error("该日程尚未绑定候选人");
      error.statusCode = 409;
      throw error;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const availableAt = backfillAvailableAt(session);
    const allowEarlyBackfill = Boolean(earlyOverride && force && isEarlyBackfillOverrideAllowed(session, earlyOverrideToken));
    if (availableAt && nowSeconds < availableAt && earlyOverride && force && !allowEarlyBackfill) {
      const error = new Error("提前回灌未授权或授权已使用，已停止避免误读会议纪要");
      error.statusCode = 403;
      throw error;
    }
    if (availableAt && nowSeconds < availableAt && !allowEarlyBackfill) {
      const availableAtText = new Date(availableAt * 1000).toLocaleString("zh-CN", { hour12: false });
      const error = new Error(`面试结束后 10 分钟才可读取纪要，预计 ${availableAtText} 可回灌`);
      error.statusCode = 409;
      error.payload = { availableAt, endTime: session.endTime || 0 };
      throw error;
    }
    if (session.interviewEvaluation && !force) {
      if (!session.bitableSkillEvaluationDocument?.documentId) {
        const { record } = await getResumeById(session.resumeId);
        if (record) {
          try {
            const skillEvaluationResult = await syncSessionSkillEvaluationDocumentToBitable(session, record);
            if (skillEvaluationResult.session) return skillEvaluationResult.session;
          } catch (error) {
            store.appendLog(session.id, "warn", error.message || "补同步技能评价文档到飞书面试表失败", error.payload || {});
          }
        }
      }
      return store.getSession(session.id) || session;
    }
    if (backfillRunning.has(session.id)) return session;

    const { records, index, record } = await getResumeById(session.resumeId);
    if (!record || index < 0) {
      const error = new Error("绑定的候选人简历不存在");
      error.statusCode = 404;
      throw error;
    }

    backfillRunning.add(session.id);
    try {
      session = store.saveSession({
        ...session,
        status: "backfilling",
        backfillStartedAt: nowIso(),
        backfillAttempts: Number(session.backfillAttempts || 0) + 1,
        lastBackfillError: "",
        earlyBackfillOverride: allowEarlyBackfill
          ? {
              allowed: true,
              requestedAt: nowIso(),
              requestedBeforeAvailableAt: availableAt || 0,
              availableAt: availableAt || 0,
              reason: clipText(earlyOverrideReason || "one_off_manual_override", 300),
            }
          : session.earlyBackfillOverride || null,
      });

      const collected = await feishu.collectBackfillSources(session);
      const source = publicBackfillSource(collected.source || {});
      if (!String(collected.text || "").trim()) {
        const failed = store.saveSession({
          ...session,
          status: "backfill_failed",
          backfillSource: source,
          lastBackfillError: "未读取到有效面试记录",
          backfilledAt: nowIso(),
        });
        store.appendLog(session.id, "warn", "面试回灌失败：未读取到有效面试记录", source);
        return failed;
      }

      const publicResume = context.publicRecord(record);
      const evaluation = await generateInterviewEvaluation({
        resume: publicResume,
        session,
        interviewText: collected.text,
        source,
        gpt: makeGptContext(),
      });

      const interviewEvaluation = {
        ...evaluation,
        sessionId: session.id,
        feishuEventId: session.feishuEventId,
        feishuDocUrl: session.feishuDoc?.url || "",
        source,
        sourceErrors: source.errors,
        updatedAt: nowIso(),
        humanReviewRequired: true,
      };

      records[index] = {
        ...record,
        interviewEvaluation,
        updatedAt: nowIso(),
      };
      await context.writeDatabase(records);
      context.invalidateResumeListResponseCache?.();

      let ruleSuggestionIds = [];
      if (context.createRuleSuggestionsFromFeedback && safeArray(evaluation.suggestedRuleChanges).length) {
        ruleSuggestionIds = context.createRuleSuggestionsFromFeedback(records[index], {
          decision: "pending",
          positiveTags: [],
          negativeTags: [],
          dimensions: [],
          reason: evaluation.summary || evaluation.overallRecommendation || "",
          affectsScoring: true,
          reviewedAt: nowIso(),
          review: {
            conflictLevel: "medium",
            summary: evaluation.summary || "面试回灌产生规则建议",
            scoreDiagnosis: safeArray(evaluation.risks).join("；"),
            suggestedRuleChanges: evaluation.suggestedRuleChanges,
            needsHumanApproval: true,
          },
        });
      }

      session = store.saveSession({
        ...session,
        resume: context.publicRecord(records[index]),
        interviewEvaluation,
        ruleSuggestionIds,
        backfillSource: source,
        lastBackfillError: "",
        status: "needs_review",
        backfilledAt: nowIso(),
        earlyBackfillOverride: allowEarlyBackfill
          ? {
              ...(session.earlyBackfillOverride || {}),
              allowed: true,
              usedAt: nowIso(),
              availableAt: availableAt || 0,
              reason: clipText(earlyOverrideReason || session.earlyBackfillOverride?.reason || "one_off_manual_override", 300),
            }
          : session.earlyBackfillOverride || null,
      });
      store.appendLog(session.id, "info", "已完成面试回灌，等待人工复核", { ruleSuggestionIds, source });
      try {
        const bitableRecordResult = await syncSessionInterviewRecordImageToBitable(session, records[index]);
        if (bitableRecordResult.session) session = bitableRecordResult.session;
        if (
          bitableRecordResult.skipped &&
          !["missing_bitable_config", "interview_record_image_already_synced", "bitable_interview_record_field_already_has_attachment"].includes(bitableRecordResult.reason)
        ) {
          store.appendLog(session.id, "info", "飞书面试表面试记录图同步已跳过", bitableRecordResult);
        }
      } catch (error) {
        store.appendLog(session.id, "warn", error.message || "同步面试记录图到飞书面试表失败", error.payload || {});
      }
      try {
        const skillEvaluationResult = await syncSessionSkillEvaluationDocumentToBitable(session, records[index]);
        if (skillEvaluationResult.session) session = skillEvaluationResult.session;
        if (
          skillEvaluationResult.skipped &&
          ![
            "missing_bitable_config",
            "skill_evaluation_document_already_synced",
            "bitable_skill_evaluation_field_already_has_value",
          ].includes(skillEvaluationResult.reason)
        ) {
          store.appendLog(session.id, "info", "飞书面试表技能评价文档同步已跳过", skillEvaluationResult);
        }
      } catch (error) {
        store.appendLog(session.id, "warn", error.message || "同步技能评价文档到飞书面试表失败", error.payload || {});
      }
      return session;
    } catch (error) {
      const failed = store.saveSession({
        ...session,
        status: "backfill_failed",
        lastBackfillError: error.message || "面试回灌失败",
        backfilledAt: nowIso(),
        earlyBackfillOverride: allowEarlyBackfill
          ? {
              ...(session.earlyBackfillOverride || {}),
              allowed: true,
              failedAt: nowIso(),
              availableAt: availableAt || 0,
              reason: clipText(earlyOverrideReason || session.earlyBackfillOverride?.reason || "one_off_manual_override", 300),
            }
          : session.earlyBackfillOverride || null,
      });
      store.appendLog(session.id, "error", error.message || "面试回灌失败", error.payload || {});
      return failed;
    } finally {
      backfillRunning.delete(session.id);
    }
  }

  async function syncCalendarSessions({ calendarId = "primary", autoPrepare = false, autoPrepareLimit = context.autoPrepareLimit || 12, source = "manual", skipIfRunning = false } = {}) {
    if (calendarSyncScheduler.running) {
      if (skipIfRunning) {
        return {
          skipped: true,
          reason: "calendar_sync_running",
          range: null,
          total: 0,
          interviewLike: 0,
          prepared: 0,
          prepareErrors: [],
          sessions: [],
        };
      }
      const error = new Error("飞书日历同步正在运行");
      error.statusCode = 409;
      throw error;
    }

    calendarSyncScheduler.running = true;
    calendarSyncScheduler.lastRunAt = nowIso();
    calendarSyncScheduler.lastError = "";
    const startTime = Math.floor(Date.now() / 1000) - DAY_SECONDS;
    const endTime = startTime + 15 * DAY_SECONDS;
    const prepareLimit = Math.max(0, Math.min(Number(autoPrepareLimit || context.autoPrepareLimit || 12), 30));

    try {
      const events = await feishu.listCalendarEvents({ startTime, endTime, calendarId });
      const resumes = await getPublicResumes();
      const synced = [];
      const bitableResumeResults = [];
      for (const event of events) {
        let session = store.upsertSessionFromEvent(event);
        if (event.isInterviewLike) {
          session = await matchAndSaveSession(session, resumes);
          if (session.resumeId) {
            try {
              const bitableResult = await syncSessionResumeImageToBitable(session);
              bitableResumeResults.push({ sessionId: session.id, ...bitableResult });
              if (bitableResult.session) session = bitableResult.session;
              if (bitableResult.skipped && !["missing_bitable_config", "resume_image_already_synced", "bitable_resume_field_already_has_attachment"].includes(bitableResult.reason)) {
                store.appendLog(session.id, "info", "飞书面试表简历图同步已跳过", bitableResult);
              }
            } catch (error) {
              const payload = error.payload || {};
              bitableResumeResults.push({ sessionId: session.id, ok: false, error: error.message || "同步简历图失败", payload });
              store.appendLog(session.id, "warn", error.message || "同步简历图到飞书面试表失败", payload);
            }
          }
        }
        session = await enrichSessionWithInterviewFlow(session);
        session = (await protectPrematureBackfills([session], source === "auto" ? "auto_calendar_sync" : "calendar_sync"))[0] || session;
        synced.push(session);
      }

      const prepared = [];
      const prepareErrors = [];
      if (autoPrepare) {
        for (const session of synced.filter((item) => item.isInterviewLike && item.resumeId && !item.feishuDoc?.documentId).slice(0, prepareLimit)) {
          try {
            prepared.push(await prepareSession(session.id));
          } catch (error) {
            prepareErrors.push({ sessionId: session.id, error: error.message });
            store.appendLog(session.id, "error", error.message || "自动准备失败");
          }
        }
      }

      const interviewLikeCount = synced.filter((item) => item.isInterviewLike).length;
      const sessions = await protectPrematureBackfills(
        await enrichSessionsWithInterviewFlow(store.listSessions({ startTime, endTime }).filter((item) => item.isInterviewLike)),
        source === "auto" ? "auto_calendar_sync_result" : "calendar_sync_result"
      );
      const result = {
        range: { startTime, endTime },
        total: events.length,
        interviewLike: interviewLikeCount,
        prepared: prepared.length,
        prepareErrors,
        bitableResumeResults,
        sessions,
      };
      calendarSyncScheduler.lastResult = {
        source,
        total: result.total,
        interviewLike: result.interviewLike,
        prepared: result.prepared,
        prepareErrors: result.prepareErrors.length,
        bitableResumeSynced: result.bitableResumeResults.filter((item) => item.ok).length,
        bitableResumeSkipped: result.bitableResumeResults.filter((item) => item.skipped).length,
        bitableResumeErrors: result.bitableResumeResults.filter((item) => item.ok === false).length,
        range: result.range,
        syncedAt: calendarSyncScheduler.lastRunAt,
      };
      store.appendLog("", "info", `${source === "auto" ? "自动" : "手动"}同步飞书日历：${events.length} 条日程，识别 ${interviewLikeCount} 条面试`, {
        source,
        total: events.length,
        interviewLike: interviewLikeCount,
        prepared: prepared.length,
        prepareErrors: prepareErrors.length,
        bitableResumeSynced: result.bitableResumeResults.filter((item) => item.ok).length,
        bitableResumeErrors: result.bitableResumeResults.filter((item) => item.ok === false).length,
      });
      return result;
    } catch (error) {
      calendarSyncScheduler.lastError = error.message || "飞书日历同步失败";
      throw error;
    } finally {
      calendarSyncScheduler.running = false;
    }
  }

  async function handleSync(request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    const result = await syncCalendarSessions({
      calendarId: body.calendarId || "primary",
      autoPrepare: body.autoPrepare !== false,
      autoPrepareLimit: body.autoPrepareLimit || context.autoPrepareLimit || 12,
      source: "manual",
    });
    send(response, 200, {
      ok: true,
      range: result.range,
      total: result.total,
      interviewLike: result.interviewLike,
      prepared: result.prepared,
      prepareErrors: result.prepareErrors,
      bitableResumeResults: result.bitableResumeResults,
      sessions: result.sessions,
      logs: store.listLogs("", 30),
    });
  }

  async function handleSessions(request, response, url) {
    const now = Math.floor(Date.now() / 1000);
    const startTime = Number(url.searchParams.get("startTime") || now - DAY_SECONDS);
    const endTime = Number(url.searchParams.get("endTime") || now + 14 * DAY_SECONDS);
    const status = url.searchParams.get("status") || "";
    const sessions = await protectPrematureBackfills(
      await enrichSessionsWithInterviewFlow(store.listSessions({ startTime, endTime, status }).filter((item) => item.isInterviewLike)),
      "sessions_response"
    );
    send(response, 200, {
      ok: true,
      status: feishu.getStatus(),
      sessions,
      logs: store.listLogs("", 50),
    });
  }

  async function handleBind(id, request, response) {
    const body = await context.readJsonBody(request);
    const { record } = await getResumeById(body.resumeId || "");
    if (!record) {
      send(response, 404, { ok: false, error: "候选人简历不存在" });
      return;
    }
    const session = store.getSession(id);
    if (!session) {
      send(response, 404, { ok: false, error: "面试日程不存在" });
      return;
    }
    const next = store.saveSession({
      ...session,
      resumeId: record.id,
      resume: context.publicRecord(record),
      matchedResume: {
        id: record.id,
        name: record.name || "",
        jobType: record.jobType || "",
      },
      matchMode: "manual",
      status: session.questionSet ? "prepared" : "matched",
      manualBoundAt: nowIso(),
    });
    store.appendLog(id, "info", "已人工绑定候选人", { resumeId: record.id, name: record.name });
    send(response, 200, { ok: true, session: await enrichSessionWithInterviewFlow(body.prepare ? await prepareSession(id) : next), logs: store.listLogs("", 50) });
  }

  function publicBackfillSource(source = {}) {
    return {
      types: safeArray(source.types),
      rawTextLength: Number(source.rawTextLength || 0),
      linkedDocIds: safeArray(source.linkedDocIds),
      minuteTokens: safeArray(source.minuteTokens),
      sources: safeArray(source.sources).map((item) => ({
        type: item.type || "",
        id: item.id || "",
        url: item.url || "",
        length: Number(item.length || 0),
      })),
      errors: safeArray(source.errors),
    };
  }

  async function handlePrepare(id, request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    send(response, 200, { ok: true, session: await enrichSessionWithInterviewFlow(await prepareSession(id, { force: Boolean(body.force) })), logs: store.listLogs("", 50) });
  }

  async function handleBackfill(id, request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    send(response, 200, {
      ok: true,
      session: await enrichSessionWithInterviewFlow(
        await backfillSession(id, {
          force: Boolean(body.force),
          earlyOverride: Boolean(body.earlyOverride),
          earlyOverrideReason: body.earlyOverrideReason || "",
          earlyOverrideToken: body.earlyOverrideToken || "",
        })
      ),
      logs: store.listLogs("", 50),
    });
  }

  function normalizeReviewDecision(value) {
    const decision = String(value || "").trim();
    return ["passed", "rejected", "need_followup"].includes(decision) ? decision : "passed";
  }

  function reviewStatusForDecision(decision) {
    return decision === "need_followup" ? "needs_review" : "completed";
  }

  async function handleReview(id, request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    const session = store.getSession(id);
    if (!session) {
      send(response, 404, { ok: false, error: "面试日程不存在" });
      return;
    }
    const decision = normalizeReviewDecision(body.decision);
    const note = clipText(body.note || "", 1000);
    const reviewedAt = nowIso();
    const review = {
      status: decision,
      decision,
      note,
      reviewedAt,
    };
    const interviewEvaluation = {
      ...(session.interviewEvaluation || {}),
      review,
      humanReviewRequired: decision === "need_followup",
      reviewedAt,
    };
    const next = store.saveSession({
      ...session,
      status: reviewStatusForDecision(decision),
      interviewEvaluation,
      humanReview: {
        confirmed: true,
        decision,
        note,
        confirmedAt: reviewedAt,
      },
    });
    if (next.resumeId) {
      const { records, index, record } = await getResumeById(next.resumeId);
      if (record && index >= 0) {
        records[index] = {
          ...record,
          interviewEvaluation,
          updatedAt: nowIso(),
        };
        await context.writeDatabase(records);
        context.invalidateResumeListResponseCache?.();
      }
    }
    store.appendLog(id, "info", "已完成人工复核", next.humanReview);
    send(response, 200, { ok: true, session: await enrichSessionWithInterviewFlow(next), logs: store.listLogs("", 50) });
  }

  async function handleConfirm(id, request, response) {
    return handleReview(id, request, response);
  }

  async function handleAuthUrl(request, response) {
    const redirectUri = getRedirectUri(request);
    const state = randomId("feishu");
    send(response, 200, {
      ok: true,
      configured: feishu.getStatus().configured,
      redirectUri,
      authUrl: feishu.buildAuthUrl({ redirectUri, state }),
    });
  }

  async function handleOAuthCallback(request, response, url) {
    const code = url.searchParams.get("code") || "";
    if (!code) {
      sendHtml(response, 400, "<p>飞书授权失败：缺少 code</p>");
      return;
    }
    try {
      await feishu.exchangeCode(code);
      sendHtml(
        response,
        200,
        `<!doctype html><meta charset="utf-8"><title>飞书授权成功</title><script>location.replace('/interview-center.html?feishu=connected')</script><p>飞书授权成功，正在返回面试中心...</p>`
      );
    } catch (error) {
      sendHtml(
        response,
        error.statusCode || 500,
        `<!doctype html><meta charset="utf-8"><title>飞书授权失败</title><p>飞书授权失败：${String(error.message || "").replace(/[<>]/g, "")}</p><p><a href="/interview-center.html">返回面试中心</a></p>`
      );
    }
  }

  async function handleStatus(_request, response) {
    send(response, 200, { ok: true, ...feishu.getStatus(), calendarSync: calendarSyncStatusPayload() });
  }

  async function handleDisconnect(_request, response) {
    store.clearToken();
    send(response, 200, { ok: true, message: "已断开飞书日历授权" });
  }

  async function handleLogs(request, response, url) {
    send(response, 200, {
      ok: true,
      logs: store.listLogs(url.searchParams.get("sessionId") || "", Number(url.searchParams.get("limit") || 80)),
    });
  }

  function calendarSyncStatusPayload() {
    return {
      enabled: calendarSyncScheduler.enabled,
      running: calendarSyncScheduler.running,
      intervalMs: AUTO_CALENDAR_SYNC_INTERVAL_MS,
      lastRunAt: calendarSyncScheduler.lastRunAt,
      lastError: calendarSyncScheduler.lastError,
      lastResult: calendarSyncScheduler.lastResult,
    };
  }

  async function runAutoCalendarSyncTick() {
    if (!calendarSyncScheduler.enabled || calendarSyncScheduler.running) return calendarSyncStatusPayload();
    if (!feishu.getStatus().connected) {
      calendarSyncScheduler.lastError = "飞书未授权，跳过自动日历同步";
      return calendarSyncStatusPayload();
    }
    try {
      await syncCalendarSessions({
        calendarId: "primary",
        autoPrepare: false,
        autoPrepareLimit: 0,
        source: "auto",
        skipIfRunning: true,
      });
    } catch (error) {
      calendarSyncScheduler.lastError = error.message || "自动同步飞书日历失败";
      store.appendLog("", "warn", calendarSyncScheduler.lastError, error.payload || {});
    }
    return calendarSyncStatusPayload();
  }

  function startCalendarSyncScheduler() {
    if (!calendarSyncScheduler.enabled || calendarSyncScheduler.timer) return;
    const schedule = (delay = AUTO_CALENDAR_SYNC_INTERVAL_MS) => {
      calendarSyncScheduler.timer = setTimeout(async () => {
        calendarSyncScheduler.timer = 0;
        await runAutoCalendarSyncTick();
        schedule();
      }, delay);
      calendarSyncScheduler.timer.unref?.();
    };
    schedule(Math.min(30000, AUTO_CALENDAR_SYNC_INTERVAL_MS));
  }

  async function handleCalendarSyncStatus(_request, response) {
    send(response, 200, { ok: true, ...calendarSyncStatusPayload() });
  }

  function backfillStatusPayload() {
    return {
      enabled: backfillScheduler.enabled,
      running: backfillScheduler.running,
      intervalMs: AUTO_BACKFILL_INTERVAL_MS,
      maxPerTick: AUTO_BACKFILL_MAX_PER_TICK,
      maxAttempts: AUTO_BACKFILL_MAX_ATTEMPTS,
      lastRunAt: backfillScheduler.lastRunAt,
      lastError: backfillScheduler.lastError,
      lastProcessed: backfillScheduler.lastProcessed,
      inFlightSessionIds: [...backfillRunning],
      pendingCount: autoBackfillCandidates().length,
    };
  }

  function autoBackfillCandidates() {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const startTime = nowSeconds - 30 * DAY_SECONDS;
    return store
      .listSessions({ startTime, endTime: nowSeconds + DAY_SECONDS })
      .filter((session) => {
        if (!session?.isInterviewLike) return false;
        if (!session.resumeId) return false;
        if (!session.feishuDoc?.documentId) return false;
        if (session.interviewEvaluation) return false;
        if (backfillRunning.has(session.id)) return false;
        if (["non_interview", "ignored", "completed", "needs_review", "backfilling"].includes(session.status)) return false;
        if (Number(session.backfillAttempts || 0) >= AUTO_BACKFILL_MAX_ATTEMPTS) return false;
        const availableAt = Number(session.endTime || session.startTime || 0) + BACKFILL_GRACE_SECONDS;
        return Boolean(availableAt && nowSeconds >= availableAt);
      })
      .sort((left, right) => Number(left.endTime || left.startTime || 0) - Number(right.endTime || right.startTime || 0));
  }

  async function runAutoBackfillTick() {
    if (!backfillScheduler.enabled || backfillScheduler.running) return backfillStatusPayload();
    backfillScheduler.running = true;
    backfillScheduler.lastRunAt = nowIso();
    backfillScheduler.lastError = "";
    const processed = [];
    try {
      store.ensure();
      const candidates = autoBackfillCandidates().slice(0, AUTO_BACKFILL_MAX_PER_TICK);
      for (const session of candidates) {
        try {
          const next = await backfillSession(session.id, { force: false });
          processed.push({
            sessionId: session.id,
            title: session.title || "",
            resumeName: session.resume?.name || session.matchedResume?.name || "",
            status: next.status,
            error: next.lastBackfillError || "",
          });
        } catch (error) {
          processed.push({
            sessionId: session.id,
            title: session.title || "",
            resumeName: session.resume?.name || session.matchedResume?.name || "",
            status: "error",
            error: error.message || "auto backfill failed",
          });
          store.appendLog(session.id, "error", error.message || "自动回灌失败", error.payload || {});
        }
      }
      backfillScheduler.lastProcessed = processed;
    } catch (error) {
      backfillScheduler.lastError = error.message || "auto backfill tick failed";
      store.appendLog("", "error", backfillScheduler.lastError, error.payload || {});
    } finally {
      backfillScheduler.running = false;
    }
    return backfillStatusPayload();
  }

  function startBackfillScheduler() {
    if (!backfillScheduler.enabled || backfillScheduler.timer) return;
    const schedule = () => {
      backfillScheduler.timer = setTimeout(async () => {
        backfillScheduler.timer = 0;
        await runAutoBackfillTick();
        schedule();
      }, AUTO_BACKFILL_INTERVAL_MS);
      backfillScheduler.timer.unref?.();
    };
    schedule();
  }

  async function handleBackfillStatus(_request, response) {
    send(response, 200, { ok: true, ...backfillStatusPayload() });
  }

  async function handleBackfillSource(id, _request, response) {
    const session = store.getSession(id);
    if (!session) {
      send(response, 404, { ok: false, error: "面试日程不存在" });
      return;
    }
    send(response, 200, {
      ok: true,
      source: publicBackfillSource(session.backfillSource || session.interviewEvaluation?.source || {}),
      lastBackfillError: session.lastBackfillError || "",
    });
  }

  async function handle(request, response, url) {
    store.ensure();
    const path = url.pathname;
    const sessionActionMatch = path.match(/^\/api\/interview-center\/sessions\/([^/]+)\/(bind|prepare|backfill|review|confirm)$/);
    const sessionBackfillSourceMatch = path.match(/^\/api\/interview-center\/sessions\/([^/]+)\/backfill-source$/);

    if (request.method === "GET" && path === "/api/interview-center/feishu/auth-url") return handleAuthUrl(request, response);
    if (request.method === "GET" && path === "/api/interview-center/feishu/oauth/callback") return handleOAuthCallback(request, response, url);
    if (request.method === "GET" && path === "/api/interview-center/feishu/status") return handleStatus(request, response);
    if (request.method === "POST" && path === "/api/interview-center/feishu/disconnect") return handleDisconnect(request, response);
    if (request.method === "POST" && path === "/api/interview-center/sync") return handleSync(request, response);
    if (request.method === "GET" && path === "/api/interview-center/sync/status") return handleCalendarSyncStatus(request, response);
    if (request.method === "GET" && path === "/api/interview-center/sessions") return handleSessions(request, response, url);
    if (request.method === "GET" && path === "/api/interview-center/logs") return handleLogs(request, response, url);
    if (request.method === "GET" && path === "/api/interview-center/backfill/status") return handleBackfillStatus(request, response);
    if (sessionBackfillSourceMatch && request.method === "GET") {
      return handleBackfillSource(decodeURIComponent(sessionBackfillSourceMatch[1]), request, response);
    }

    if (sessionActionMatch && request.method === "POST") {
      const id = decodeURIComponent(sessionActionMatch[1]);
      const action = sessionActionMatch[2];
      if (action === "bind") return handleBind(id, request, response);
      if (action === "prepare") return handlePrepare(id, request, response);
      if (action === "backfill") return handleBackfill(id, request, response);
      if (action === "review") return handleReview(id, request, response);
      if (action === "confirm") return handleConfirm(id, request, response);
    }

    send(response, 404, { ok: false, error: "未知面试中心接口" });
  }

  startCalendarSyncScheduler();
  startBackfillScheduler();

  return {
    handle: (request, response, url) => handle(request, response, url).catch((error) => sendError(response, error)),
    prepareSession,
    backfillSession,
  };
}

module.exports = {
  createInterviewCenterFeature,
};
