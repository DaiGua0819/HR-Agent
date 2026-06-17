const { createInterviewStore } = require("./store");
const { createFeishuClient } = require("./feishuClient");
const { enrichSessionWithMatches } = require("./candidateMatcher");
const { generateInterviewQuestions, summarizeConversation } = require("./questionGenerator");
const { generateInterviewEvaluation } = require("./feedbackBackfill");
const { ensureBitableResumeImage, ensureBitableInterviewRecordImage } = require("./bitableAssets");
const { clipText, nowIso, parseJson, randomId, safeArray } = require("./utils");

const DAY_SECONDS = 24 * 60 * 60;
const BACKFILL_GRACE_SECONDS = 10 * 60;
const AUTO_BACKFILL_INTERVAL_MS = Math.max(60000, Number(process.env.INTERVIEW_BACKFILL_INTERVAL_MS || 5 * 60 * 1000));
const AUTO_BACKFILL_MAX_PER_TICK = Math.max(1, Math.min(Number(process.env.INTERVIEW_BACKFILL_MAX_PER_TICK || 3), 10));
const AUTO_BACKFILL_MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.INTERVIEW_BACKFILL_MAX_ATTEMPTS || 3), 10));
const AUTO_BACKFILL_ENABLED = !/^(0|false|no)$/i.test(String(process.env.INTERVIEW_AUTO_BACKFILL_ENABLED ?? "true"));
const AUTO_CALENDAR_SYNC_INTERVAL_MS = Math.max(60000, Number(process.env.INTERVIEW_CALENDAR_SYNC_INTERVAL_MS || 5 * 60 * 1000));
const AUTO_CALENDAR_SYNC_ENABLED = !/^(0|false|no)$/i.test(String(process.env.INTERVIEW_CALENDAR_SYNC_ENABLED ?? "true"));

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

  async function backfillSession(sessionId, { force = false } = {}) {
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
    const availableAt = Number(session.endTime || session.startTime || 0) + BACKFILL_GRACE_SECONDS;
    if (!force && availableAt && nowSeconds < availableAt) {
      const availableAtText = new Date(availableAt * 1000).toLocaleString("zh-CN", { hour12: false });
      const error = new Error(`面试结束后 10 分钟才可读取纪要，预计 ${availableAtText} 可回灌`);
      error.statusCode = 409;
      error.payload = { availableAt, endTime: session.endTime || 0 };
      throw error;
    }
    if (session.interviewEvaluation && !force) return session;
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
      return session;
    } catch (error) {
      const failed = store.saveSession({
        ...session,
        status: "backfill_failed",
        lastBackfillError: error.message || "面试回灌失败",
        backfilledAt: nowIso(),
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
      const result = {
        range: { startTime, endTime },
        total: events.length,
        interviewLike: interviewLikeCount,
        prepared: prepared.length,
        prepareErrors,
        bitableResumeResults,
        sessions: store.listSessions({ startTime, endTime }).filter((item) => item.isInterviewLike),
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
    send(response, 200, {
      ok: true,
      status: feishu.getStatus(),
      sessions: store.listSessions({ startTime, endTime, status }).filter((item) => item.isInterviewLike),
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
    send(response, 200, { ok: true, session: body.prepare ? await prepareSession(id) : next, logs: store.listLogs("", 50) });
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
    send(response, 200, { ok: true, session: await prepareSession(id, { force: Boolean(body.force) }), logs: store.listLogs("", 50) });
  }

  async function handleBackfill(id, request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    send(response, 200, { ok: true, session: await backfillSession(id, { force: Boolean(body.force) }), logs: store.listLogs("", 50) });
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
    send(response, 200, { ok: true, session: next, logs: store.listLogs("", 50) });
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
