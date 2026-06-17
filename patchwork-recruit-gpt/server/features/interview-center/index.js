const { createInterviewStore } = require("./store");
const { createFeishuClient } = require("./feishuClient");
const { enrichSessionWithMatches } = require("./candidateMatcher");
const { generateInterviewQuestions, summarizeConversation } = require("./questionGenerator");
const { generateInterviewEvaluation } = require("./feedbackBackfill");
const { clipText, nowIso, parseJson, randomId, safeArray } = require("./utils");

const DAY_SECONDS = 24 * 60 * 60;
const BACKFILL_GRACE_SECONDS = 10 * 60;

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
        store.appendLog(session.id, "info", "已同步飞书面试台账", { recordId: bitable.recordId });
      }
    } catch (error) {
      bitableError = error.message || "同步飞书面试台账失败";
      store.appendLog(session.id, "warn", bitableError, error.payload || {});
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

    const { records, index, record } = await getResumeById(session.resumeId);
    if (!record || index < 0) {
      const error = new Error("绑定的候选人简历不存在");
      error.statusCode = 404;
      throw error;
    }

    const source = await feishu.collectBackfillText(session);
    const publicResume = context.publicRecord(record);
    const evaluation = await generateInterviewEvaluation({
      resume: publicResume,
      session,
      interviewText: source.text,
      gpt: makeGptContext(),
    });

    const interviewEvaluation = {
      ...evaluation,
      sessionId: session.id,
      feishuEventId: session.feishuEventId,
      feishuDocUrl: session.feishuDoc?.url || "",
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
      backfillSource: {
        hasText: Boolean(source.text),
        linkedDocIds: source.linkedDocIds,
        errors: source.errors,
      },
      status: "needs_review",
      backfilledAt: nowIso(),
    });
    store.appendLog(session.id, "info", "已完成面试回灌，等待人工复核", { ruleSuggestionIds });
    return session;
  }

  async function handleSync(request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    const startTime = Math.floor(Date.now() / 1000) - DAY_SECONDS;
    const endTime = startTime + 15 * DAY_SECONDS;
    const autoPrepare = body.autoPrepare !== false;
    const autoPrepareLimit = Math.max(0, Math.min(Number(body.autoPrepareLimit || context.autoPrepareLimit || 12), 30));
    const events = await feishu.listCalendarEvents({ startTime, endTime, calendarId: body.calendarId || "primary" });
    const resumes = await getPublicResumes();
    const synced = [];
    for (const event of events) {
      let session = store.upsertSessionFromEvent(event);
      if (event.isInterviewLike) {
        session = await matchAndSaveSession(session, resumes);
      }
      synced.push(session);
    }

    const prepared = [];
    const prepareErrors = [];
    if (autoPrepare) {
      for (const session of synced.filter((item) => item.isInterviewLike && item.resumeId && !item.feishuDoc?.documentId).slice(0, autoPrepareLimit)) {
        try {
          prepared.push(await prepareSession(session.id));
        } catch (error) {
          prepareErrors.push({ sessionId: session.id, error: error.message });
          store.appendLog(session.id, "error", error.message || "自动准备失败");
        }
      }
    }

    const interviewLikeCount = synced.filter((item) => item.isInterviewLike).length;
    store.appendLog("", "info", `已同步飞书日历：${events.length} 条日程，识别 ${interviewLikeCount} 条面试`, {
      total: events.length,
      interviewLike: interviewLikeCount,
      prepared: prepared.length,
      prepareErrors: prepareErrors.length,
    });

    send(response, 200, {
      ok: true,
      range: { startTime, endTime },
      total: events.length,
      interviewLike: interviewLikeCount,
      prepared: prepared.length,
      prepareErrors,
      sessions: store.listSessions({ startTime, endTime }).filter((item) => item.isInterviewLike),
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

  async function handlePrepare(id, request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    send(response, 200, { ok: true, session: await prepareSession(id, { force: Boolean(body.force) }), logs: store.listLogs("", 50) });
  }

  async function handleBackfill(id, request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    send(response, 200, { ok: true, session: await backfillSession(id, { force: Boolean(body.force) }), logs: store.listLogs("", 50) });
  }

  async function handleConfirm(id, request, response) {
    const body = await context.readJsonBody(request).catch(() => ({}));
    const session = store.getSession(id);
    if (!session) {
      send(response, 404, { ok: false, error: "面试日程不存在" });
      return;
    }
    const next = store.saveSession({
      ...session,
      status: "completed",
      humanReview: {
        confirmed: true,
        decision: body.decision || "reviewed",
        note: clipText(body.note || "", 1000),
        confirmedAt: nowIso(),
      },
    });
    store.appendLog(id, "info", "人工确认面试评估", next.humanReview);
    send(response, 200, { ok: true, session: next, logs: store.listLogs("", 50) });
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
    send(response, 200, { ok: true, ...feishu.getStatus() });
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

  async function handle(request, response, url) {
    store.ensure();
    const path = url.pathname;
    const sessionActionMatch = path.match(/^\/api\/interview-center\/sessions\/([^/]+)\/(bind|prepare|backfill|confirm)$/);

    if (request.method === "GET" && path === "/api/interview-center/feishu/auth-url") return handleAuthUrl(request, response);
    if (request.method === "GET" && path === "/api/interview-center/feishu/oauth/callback") return handleOAuthCallback(request, response, url);
    if (request.method === "GET" && path === "/api/interview-center/feishu/status") return handleStatus(request, response);
    if (request.method === "POST" && path === "/api/interview-center/feishu/disconnect") return handleDisconnect(request, response);
    if (request.method === "POST" && path === "/api/interview-center/sync") return handleSync(request, response);
    if (request.method === "GET" && path === "/api/interview-center/sessions") return handleSessions(request, response, url);
    if (request.method === "GET" && path === "/api/interview-center/logs") return handleLogs(request, response, url);

    if (sessionActionMatch && request.method === "POST") {
      const id = decodeURIComponent(sessionActionMatch[1]);
      const action = sessionActionMatch[2];
      if (action === "bind") return handleBind(id, request, response);
      if (action === "prepare") return handlePrepare(id, request, response);
      if (action === "backfill") return handleBackfill(id, request, response);
      if (action === "confirm") return handleConfirm(id, request, response);
    }

    send(response, 404, { ok: false, error: "未知面试中心接口" });
  }

  return {
    handle: (request, response, url) => handle(request, response, url).catch((error) => sendError(response, error)),
    prepareSession,
    backfillSession,
  };
}

module.exports = {
  createInterviewCenterFeature,
};
