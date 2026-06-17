const { clipText, compactText, normalizeDateSeconds, safeArray } = require("./utils");

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

function createFeishuError(action, payload, status = 500) {
  const message = payload?.msg || payload?.message || payload?.error?.message || `${action}失败`;
  const error = new Error(message);
  error.statusCode = status;
  error.payload = payload || {};
  return error;
}

function feishuTimestampToSeconds(value) {
  if (!value) return 0;
  if (typeof value === "object") {
    return normalizeDateSeconds(value.timestamp || value.date || value.datetime);
  }
  return normalizeDateSeconds(value);
}

function normalizeEventTime(time = {}) {
  return {
    startTime: feishuTimestampToSeconds(time.start_time || time.startTime || time.start),
    endTime: feishuTimestampToSeconds(time.end_time || time.endTime || time.end),
  };
}

function normalizeAttendees(event = {}) {
  return safeArray(event.attendees)
    .map((item) => {
      const user = item.user || item.attendee || item;
      return compactText(user.name || user.display_name || user.email || user.open_id || user.user_id || "");
    })
    .filter(Boolean)
    .slice(0, 20);
}

function isInterviewLikeEvent(event = {}) {
  const text = [event.summary, event.description, event.location?.name, event.location, ...normalizeAttendees(event)].join(" ");
  if (/面试|初试|复试|终面|一面|二面|三面|面谈|面聊|约面|候选人|应聘|招聘|interview/i.test(text)) return true;
  if (/AI应用|HRBP|管培|应用技术|运营A|运营B|销售|人力资源/.test(text)) return true;
  return false;
}

function normalizeCalendarEvent(calendarId, event = {}) {
  const { startTime, endTime } = normalizeEventTime(event);
  const summary = compactText(event.summary || event.title || "未命名日程");
  const description = compactText(event.description || event.note || "");
  const attendees = normalizeAttendees(event);
  const meetingUrl =
    event.vchat?.meeting_url ||
    event.video_meeting_url ||
    event.meeting_url ||
    event.online_meeting_url ||
    event.app_link ||
    "";

  return {
    calendarId,
    feishuEventId: String(event.event_id || event.id || event.uid || `${calendarId}:${summary}:${startTime}`),
    title: summary,
    description: clipText(description, 5000),
    location: compactText(event.location?.name || event.location || ""),
    attendees,
    meetingUrl,
    startTime,
    endTime,
    rawEvent: event,
    isInterviewLike: isInterviewLikeEvent(event),
    status: isInterviewLikeEvent(event) ? "synced" : "non_interview",
  };
}

function extractDocumentTokensFromText(text = "") {
  const raw = String(text || "");
  const tokens = new Set();
  const patterns = [
    /\/docx\/([A-Za-z0-9]+)/g,
    /\/docs\/([A-Za-z0-9]+)/g,
    /\/wiki\/([A-Za-z0-9]+)/g,
    /document_id=([A-Za-z0-9]+)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw))) {
      if (match[1]) tokens.add(match[1]);
    }
  }
  return [...tokens];
}

function questionSetToDocText(session = {}) {
  const resume = session.resume || {};
  const questionSet = session.questionSet || {};
  const questions = safeArray(questionSet.questions);
  const lines = [
    `# ${resume.name || session.title || "候选人"} 面试问题包`,
    "",
    "## 候选人信息",
    `- 姓名：${resume.name || "-"}`,
    `- 应聘岗位：${resume.jobType || session.matchedResume?.jobType || "-"}`,
    `- 来源：${[resume.sourcePlatform || resume.platform || "", resume.accountName || ""].filter(Boolean).join(" / ") || "-"}`,
    `- 面试时间：${session.startTime ? new Date(session.startTime * 1000).toLocaleString("zh-CN") : "-"}`,
    "",
    "## 简历摘要",
    questionSet.resumeSummary || resume.scoreBreakdown?.summary || "暂无摘要",
    "",
    "## 聊天摘要",
    questionSet.chatSummary || "暂无聊天摘要",
    "",
    "## 面试问题",
    ...questions.flatMap((item, index) => [
      "",
      `### ${index + 1}. ${item.ability || "能力项"}`,
      `问题：${item.question || ""}`,
      `追问：${safeArray(item.followUps).join("；") || "-"}`,
      `强信号：${item.strongSignal || "-"}`,
      `风险信号：${item.riskSignal || "-"}`,
      `简历证据：${item.resumeEvidence || "-"}`,
    ]),
    "",
    "## 面试官记录",
    "请在这里记录候选人的关键回答、追问结果和判断依据。",
    "",
    "## AI 回灌区",
    "面试结束后由系统写入能力评估、风险点和回灌建议。",
  ];
  return lines.join("\n");
}

function docTextToBlocks(text = "") {
  return String(text || "")
    .split(/\n+/)
    .map((line) => compactText(line))
    .filter(Boolean)
    .slice(0, 180)
    .map((content) => ({
      block_type: content.startsWith("#") ? 3 : 2,
      text: {
        elements: [
          {
            text_run: {
              content: content.replace(/^#+\s*/, ""),
              text_element_style: {},
            },
          },
        ],
        style: {},
      },
    }));
}

function createFeishuClient({
  appId,
  appSecret,
  store,
  bitableAppToken = "",
  bitableTableId = "",
  authorizeUrl = "https://open.feishu.cn/open-apis/authen/v1/authorize",
}) {
  let appTokenCache = null;
  let tenantTokenCache = null;

  async function requestJson(url, options = {}, action = "飞书请求") {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
      throw createFeishuError(action, payload, response.status);
    }
    return payload;
  }

  function assertConfigured() {
    if (!appId || !appSecret) {
      const error = new Error("未配置 FEISHU_APP_ID 或 FEISHU_APP_SECRET");
      error.statusCode = 400;
      throw error;
    }
  }

  async function getAppAccessToken() {
    assertConfigured();
    if (appTokenCache && appTokenCache.expiresAt > Date.now() + 60000) return appTokenCache.token;
    const payload = await requestJson(
      `${FEISHU_API_BASE}/auth/v3/app_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
      "获取飞书 app_access_token"
    );
    appTokenCache = {
      token: payload.app_access_token,
      expiresAt: Date.now() + Math.max(0, Number(payload.expire || 0) - 120) * 1000,
    };
    return appTokenCache.token;
  }

  async function getTenantAccessToken() {
    assertConfigured();
    if (tenantTokenCache && tenantTokenCache.expiresAt > Date.now() + 60000) return tenantTokenCache.token;
    const payload = await requestJson(
      `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
      "获取飞书 tenant_access_token"
    );
    tenantTokenCache = {
      token: payload.tenant_access_token,
      expiresAt: Date.now() + Math.max(0, Number(payload.expire || 0) - 120) * 1000,
    };
    return tenantTokenCache.token;
  }

  async function refreshUserToken(token) {
    const appToken = await getAppAccessToken();
    const payload = await requestJson(
      `${FEISHU_API_BASE}/authen/v1/refresh_access_token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: token.refreshToken,
        }),
      },
      "刷新飞书用户授权"
    );
    const data = payload.data || {};
    const nextToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || token.refreshToken,
      expiresAt: Date.now() + Math.max(0, Number(data.expires_in || data.expire || 0) - 120) * 1000,
      refreshExpiresAt: data.refresh_expires_in
        ? Date.now() + Math.max(0, Number(data.refresh_expires_in) - 120) * 1000
        : token.refreshExpiresAt || 0,
      userInfo: token.userInfo || null,
      updatedAt: new Date().toISOString(),
    };
    store.saveToken(nextToken);
    return nextToken;
  }

  async function getValidUserToken() {
    let token = store.getToken();
    if (!token?.accessToken) {
      const error = new Error("飞书日历未授权");
      error.statusCode = 401;
      throw error;
    }
    if (token.expiresAt && token.expiresAt <= Date.now() + 60000 && token.refreshToken) {
      token = await refreshUserToken(token);
    }
    return token.accessToken;
  }

  function buildAuthUrl({ redirectUri, state = "" }) {
    assertConfigured();
    const url = new URL(authorizeUrl);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    if (state) url.searchParams.set("state", state);
    return url.toString();
  }

  async function exchangeCode(code) {
    const appToken = await getAppAccessToken();
    const payload = await requestJson(
      `${FEISHU_API_BASE}/authen/v1/access_token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code,
        }),
      },
      "获取飞书用户访问凭证"
    );
    const data = payload.data || {};
    const token = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Math.max(0, Number(data.expires_in || data.expire || 0) - 120) * 1000,
      refreshExpiresAt: data.refresh_expires_in
        ? Date.now() + Math.max(0, Number(data.refresh_expires_in) - 120) * 1000
        : 0,
      userInfo: null,
      updatedAt: new Date().toISOString(),
    };
    token.userInfo = await getUserInfo(token.accessToken).catch(() => null);
    store.saveToken(token);
    return token;
  }

  async function getUserInfo(accessToken = "") {
    const userToken = accessToken || (await getValidUserToken());
    const payload = await requestJson(
      `${FEISHU_API_BASE}/authen/v1/user_info`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${userToken}` },
      },
      "读取飞书用户信息"
    );
    return payload.data || {};
  }

  async function listCalendarEvents({ startTime, endTime, calendarId = "primary" }) {
    const userToken = await getValidUserToken();
    const events = [];
    let pageToken = "";
    do {
      const url = new URL(`${FEISHU_API_BASE}/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set("page_size", "50");
      if (startTime) url.searchParams.set("start_time", String(startTime));
      if (endTime) url.searchParams.set("end_time", String(endTime));
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const payload = await requestJson(
        url.toString(),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${userToken}` },
        },
        "读取飞书日历日程"
      );
      const data = payload.data || {};
      events.push(...safeArray(data.items || data.events).map((item) => normalizeCalendarEvent(calendarId, item)));
      pageToken = data.page_token || data.next_page_token || "";
      if (!data.has_more) pageToken = "";
    } while (pageToken);
    return events;
  }

  async function createInterviewDocument(session) {
    const userToken = await getValidUserToken();
    const title = `${session.resume?.name || session.matchedResume?.name || "候选人"}-${session.resume?.jobType || session.matchedResume?.jobType || "面试"}-面试问题`;
    const created = await requestJson(
      `${FEISHU_API_BASE}/docx/v1/documents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ title: clipText(title, 120) }),
      },
      "创建飞书面试文档"
    );
    const document = created.data?.document || created.data || {};
    const documentId = document.document_id || document.documentId || document.obj_token || "";
    if (!documentId) throw createFeishuError("创建飞书面试文档", created, 500);

    const docText = questionSetToDocText(session);
    let contentSynced = false;
    let contentError = "";
    try {
      await requestJson(
        `${FEISHU_API_BASE}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({ children: docTextToBlocks(docText) }),
        },
        "写入飞书面试文档"
      );
      contentSynced = true;
    } catch (error) {
      contentError = error.message || "写入飞书文档内容失败";
    }

    return {
      documentId,
      url: document.url || document.document_url || `https://feishu.cn/docx/${documentId}`,
      title,
      contentSynced,
      contentError,
      localText: docText,
      syncedAt: new Date().toISOString(),
    };
  }

  async function readDocumentText(documentId) {
    if (!documentId) return "";
    const userToken = await getValidUserToken();
    try {
      const payload = await requestJson(
        `${FEISHU_API_BASE}/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${userToken}` },
        },
        "读取飞书文档内容"
      );
      return compactText(payload.data?.content || payload.data?.text || "");
    } catch (error) {
      const payload = await requestJson(
        `${FEISHU_API_BASE}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${userToken}` },
        },
        "读取飞书文档块"
      );
      const blocks = safeArray(payload.data?.items || payload.data?.blocks);
      return compactText(
        blocks
          .map((block) =>
            safeArray(block.text?.elements)
              .map((element) => element.text_run?.content || "")
              .join("")
          )
          .join("\n")
      );
    }
  }

  async function syncBitableRecord(session) {
    if (!bitableAppToken || !bitableTableId) {
      return { skipped: true, reason: "missing_bitable_config", message: "未配置飞书面试台账" };
    }
    const tenantToken = await getTenantAccessToken();
    const fields = {
      候选人: session.resume?.name || session.matchedResume?.name || "",
      岗位: session.resume?.jobType || session.matchedResume?.jobType || "",
      面试时间: session.startTime ? new Date(session.startTime * 1000).toISOString() : "",
      面试状态: session.status || "",
      匹配分: Number(session.match?.score || 0),
      飞书文档: session.feishuDoc?.url || "",
      来源平台: session.resume?.sourcePlatform || session.resume?.platform || "",
    };
    const base = `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(bitableAppToken)}/tables/${encodeURIComponent(bitableTableId)}/records`;
    const method = session.bitableRecordId ? "PUT" : "POST";
    const url = session.bitableRecordId ? `${base}/${encodeURIComponent(session.bitableRecordId)}` : base;
    const payload = await requestJson(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ fields }),
      },
      "同步飞书面试台账"
    );
    return {
      recordId: payload.data?.record?.record_id || payload.data?.record_id || session.bitableRecordId || "",
      fields,
      syncedAt: new Date().toISOString(),
    };
  }

  async function collectBackfillText(session) {
    const documentTexts = [];
    const errors = [];
    const docId = session.feishuDoc?.documentId || "";
    if (docId) {
      try {
        documentTexts.push(await readDocumentText(docId));
      } catch (error) {
        errors.push(`面试文档读取失败：${error.message}`);
      }
    }
    const linkedDocIds = extractDocumentTokensFromText(
      [session.description, session.meetingUrl, session.rawEvent ? JSON.stringify(session.rawEvent) : ""].join("\n")
    ).filter((token) => token !== docId);
    for (const token of linkedDocIds.slice(0, 3)) {
      try {
        documentTexts.push(await readDocumentText(token));
      } catch (error) {
        errors.push(`会议纪要/关联文档读取失败：${error.message}`);
      }
    }
    return {
      text: documentTexts.filter(Boolean).join("\n\n"),
      errors,
      linkedDocIds,
    };
  }

  function getStatus() {
    const token = store.getToken();
    return {
      configured: Boolean(appId && appSecret),
      connected: Boolean(token?.accessToken),
      userInfo: token?.userInfo || null,
      expiresAt: token?.expiresAt || 0,
      bitableConfigured: Boolean(bitableAppToken && bitableTableId),
    };
  }

  return {
    buildAuthUrl,
    exchangeCode,
    getUserInfo,
    getStatus,
    listCalendarEvents,
    createInterviewDocument,
    readDocumentText,
    syncBitableRecord,
    collectBackfillText,
  };
}

module.exports = {
  createFeishuClient,
  normalizeCalendarEvent,
  isInterviewLikeEvent,
  extractDocumentTokensFromText,
};
