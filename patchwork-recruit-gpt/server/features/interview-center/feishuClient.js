const { clipText, compactText, normalizeDateSeconds, safeArray } = require("./utils");
const fs = require("node:fs/promises");

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

function extractMinuteTokensFromText(text = "") {
  const raw = String(text || "");
  const tokens = new Set();
  const patterns = [
    /\/minutes\/([A-Za-z0-9_-]+)/g,
    /\/minute\/([A-Za-z0-9_-]+)/g,
    /minute_token=([A-Za-z0-9_-]+)/g,
    /"minute_token"\s*:\s*"([^"]+)"/g,
    /"minuteToken"\s*:\s*"([^"]+)"/g,
    /"minutes_token"\s*:\s*"([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw))) {
      if (match[1]) tokens.add(match[1]);
    }
  }
  return [...tokens];
}

function transcriptPayloadToText(payload = {}) {
  const data = payload.data || payload;
  const direct = data.content || data.text || data.transcript || data.raw_content;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const items = safeArray(data.items || data.sentences || data.segments || data.transcripts || data.paragraphs);
  if (!items.length) return "";
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      const speaker = item.speaker?.name || item.speaker_name || item.user_name || item.name || "";
      const timestamp = item.start_time || item.startTime || item.time || "";
      const text = item.text || item.content || item.sentence || item.words || "";
      return [timestamp ? `[${timestamp}]` : "", speaker ? `${speaker}:` : "", text].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

function meaningfulInterviewDocText(text = "", baseline = "") {
  const value = compactText(text);
  if (!value) return "";
  const base = compactText(baseline);
  if (base && value === base) return "";
  if (base && value.length <= base.length + 80 && value.includes("面试官记录") && value.includes("AI 回灌区")) return "";
  return value;
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

function richTextPayload(content = "", options = {}) {
  return {
    elements: [
      {
        text_run: {
          content: compactText(content),
          text_element_style: options.bold ? { bold: true } : {},
        },
      },
    ],
    style: {},
  };
}

function splitTextChunks(text = "", maxLength = 1800) {
  const value = compactText(text);
  if (!value) return [];
  if (value.length <= maxLength) return [value];
  const chunks = [];
  for (let index = 0; index < value.length; index += maxLength) {
    chunks.push(value.slice(index, index + maxLength));
  }
  return chunks;
}

function docLineToBlocks(line = "") {
  const content = compactText(line);
  if (!content) return [];
  const heading = /^(#{1,9})\s+(.+)$/.exec(content);
  if (heading) {
    const level = Math.min(heading[1].length, 9);
    const field = `heading${level}`;
    return [
      {
        block_type: level + 2,
        [field]: richTextPayload(clipText(heading[2], 1200)),
      },
    ];
  }
  return splitTextChunks(content).map((chunk) => ({
    block_type: 2,
    text: richTextPayload(chunk, { bold: /^问题：/.test(chunk) }),
  }));
}

function docTextToBlocks(text = "") {
  return String(text || "")
    .split(/\n+/)
    .flatMap((line) => docLineToBlocks(line))
    .slice(0, 180);
}

function chunkArray(items = [], size = 40) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
  let bitableFieldsCache = null;
  let bitableTableCache = null;

  async function requestJson(url, options = {}, action = "飞书请求") {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || (typeof payload.code === "number" && payload.code !== 0)) {
      throw createFeishuError(action, payload, response.status);
    }
    return payload;
  }

  async function requestTextExport(url, options = {}, action = "飞书文本导出") {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    const rawText = await response.text();
    let payload = null;
    if (contentType.includes("application/json") || /^\s*\{/.test(rawText)) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = null;
      }
    }
    if (!response.ok || (payload && typeof payload.code === "number" && payload.code !== 0)) {
      throw createFeishuError(action, payload || { msg: rawText || response.statusText }, response.status);
    }
    if (payload) {
      const text = transcriptPayloadToText(payload);
      return text || compactText(rawText);
    }
    return compactText(rawText);
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

  function bitableBaseUrl() {
    if (!bitableAppToken || !bitableTableId) return "";
    return `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(bitableAppToken)}/tables/${encodeURIComponent(bitableTableId)}`;
  }

  function assertBitableConfigured() {
    if (!bitableAppToken || !bitableTableId) {
      const error = new Error("未配置飞书面试台账");
      error.statusCode = 400;
      throw error;
    }
  }

  async function getBitableFields({ force = false } = {}) {
    assertBitableConfigured();
    if (bitableFieldsCache && !force) return bitableFieldsCache;
    const tenantToken = await getTenantAccessToken();
    const fields = [];
    let pageToken = "";
    do {
      const url = new URL(`${bitableBaseUrl()}/fields`);
      url.searchParams.set("page_size", "100");
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const payload = await requestJson(
        url.toString(),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tenantToken}` },
        },
        "读取飞书多维表字段"
      );
      const data = payload.data || {};
      fields.push(...safeArray(data.items));
      pageToken = data.page_token || "";
      if (!data.has_more) pageToken = "";
    } while (pageToken);
    const byName = new Map(fields.map((field) => [field.field_name, field]));
    bitableFieldsCache = { items: fields, byName, fetchedAt: new Date().toISOString() };
    return bitableFieldsCache;
  }

  async function getBitableTableInfo({ force = false } = {}) {
    assertBitableConfigured();
    if (bitableTableCache && !force) return bitableTableCache;
    const tenantToken = await getTenantAccessToken();
    try {
      const payload = await requestJson(
        `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(bitableAppToken)}/tables/${encodeURIComponent(bitableTableId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tenantToken}` },
        },
        "读取飞书多维表信息"
      );
      bitableTableCache = payload.data?.table || payload.data || {};
      return bitableTableCache;
    } catch {
      try {
        const payload = await requestJson(
          `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(bitableAppToken)}/tables`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${tenantToken}` },
          },
          "读取飞书多维表列表"
        );
        const tables = safeArray(payload.data?.items || payload.data?.tables);
        bitableTableCache = tables.find((table) => table.table_id === bitableTableId || table.id === bitableTableId) || {};
        return bitableTableCache;
      } catch {
        bitableTableCache = {
          table_id: bitableTableId,
          name: process.env.FEISHU_INTERVIEW_BITABLE_TABLE_NAME || "",
        };
      }
    }
    return bitableTableCache;
  }

  function pickExistingBitableFields(fields, fieldMap) {
    const result = {};
    for (const [name, value] of Object.entries(fields || {})) {
      if (value === undefined || value === null || value === "") continue;
      if (!fieldMap.byName?.has(name)) continue;
      result[name] = value;
    }
    return result;
  }

  async function listBitableRecords({ pageSize = 500, maxRecords = 2000 } = {}) {
    assertBitableConfigured();
    const tenantToken = await getTenantAccessToken();
    const records = [];
    let pageToken = "";
    do {
      const url = new URL(`${bitableBaseUrl()}/records`);
      url.searchParams.set("page_size", String(Math.max(1, Math.min(Number(pageSize || 500), 500))));
      url.searchParams.set("user_id_type", "open_id");
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const payload = await requestJson(
        url.toString(),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tenantToken}` },
        },
        "读取飞书面试表记录"
      );
      const data = payload.data || {};
      records.push(...safeArray(data.items));
      pageToken = data.page_token || "";
      if (!data.has_more || records.length >= maxRecords) pageToken = "";
    } while (pageToken);
    return records;
  }

  async function getBitableRecord(recordId) {
    if (!recordId) return null;
    assertBitableConfigured();
    const tenantToken = await getTenantAccessToken();
    const url = new URL(`${bitableBaseUrl()}/records/${encodeURIComponent(recordId)}`);
    url.searchParams.set("user_id_type", "open_id");
    const payload = await requestJson(
      url.toString(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${tenantToken}` },
      },
      "读取飞书面试表记录"
    );
    return payload.data?.record || payload.data || null;
  }

  async function createBitableRecord(fields) {
    assertBitableConfigured();
    const fieldMap = await getBitableFields();
    const tenantToken = await getTenantAccessToken();
    const payload = await requestJson(
      `${bitableBaseUrl()}/records?user_id_type=open_id`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ fields: pickExistingBitableFields(fields, fieldMap) }),
      },
      "新建飞书面试表记录"
    );
    return payload.data?.record || payload.data || {};
  }

  async function updateBitableRecord(recordId, fields) {
    if (!recordId) return createBitableRecord(fields);
    assertBitableConfigured();
    const fieldMap = await getBitableFields();
    const tenantToken = await getTenantAccessToken();
    const payload = await requestJson(
      `${bitableBaseUrl()}/records/${encodeURIComponent(recordId)}?user_id_type=open_id`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tenantToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ fields: pickExistingBitableFields(fields, fieldMap) }),
      },
      "更新飞书面试表记录"
    );
    return payload.data?.record || payload.data || {};
  }

  async function uploadBitableAttachment({ filePath, filename = "image.png", contentType = "image/png" }) {
    assertBitableConfigured();
    const tenantToken = await getTenantAccessToken();
    const buffer = await fs.readFile(filePath);
    const baseFields = {
      file_name: filename,
      parent_node: bitableAppToken,
      size: String(buffer.length),
      extra: JSON.stringify({ drive_route_token: bitableAppToken }),
    };
    const parentTypes = contentType.startsWith("image/") ? ["bitable_image", "bitable_file"] : ["bitable_file"];
    let lastError = null;
    for (const parentType of parentTypes) {
      const form = new FormData();
      for (const [key, value] of Object.entries({ ...baseFields, parent_type: parentType })) {
        form.append(key, value);
      }
      form.append("file", new Blob([buffer], { type: contentType }), filename);
      try {
        const payload = await requestJson(
          `${FEISHU_API_BASE}/drive/v1/medias/upload_all`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${tenantToken}` },
            body: form,
          },
          "上传飞书多维表附件"
        );
        const data = payload.data || {};
        return {
          fileToken: data.file_token || data.fileToken || data.token || "",
          name: filename,
          type: contentType,
          size: buffer.length,
          parentType,
          uploadedAt: new Date().toISOString(),
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("上传飞书多维表附件失败");
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
    let contentErrorPayload = null;
    try {
      await writeDocumentBlocks(documentId, docText, userToken);
      contentSynced = true;
    } catch (error) {
      contentError = error.message || "写入飞书文档内容失败";
      contentErrorPayload = error.payload || null;
    }

    return {
      documentId,
      url: document.url || document.document_url || `https://feishu.cn/docx/${documentId}`,
      title,
      contentSynced,
      contentError,
      contentErrorPayload,
      localText: docText,
      syncedAt: new Date().toISOString(),
    };
  }

  async function writeDocumentBlocks(documentId, docText, userToken) {
    const blocks = docTextToBlocks(docText);
    if (!blocks.length) return;
    let insertIndex = 0;
    for (const children of chunkArray(blocks)) {
      await requestJson(
        `${FEISHU_API_BASE}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${userToken}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({ index: insertIndex, children }),
        },
        "写入飞书面试文档"
      );
      insertIndex += children.length;
    }
  }

  async function syncInterviewDocumentContent(documentId, session) {
    if (!documentId) {
      const error = new Error("飞书文档不存在");
      error.statusCode = 400;
      throw error;
    }
    const userToken = await getValidUserToken();
    const docText = typeof session === "string" ? session : questionSetToDocText(session);
    await writeDocumentBlocks(documentId, docText, userToken);
    return {
      contentSynced: true,
      contentError: "",
      contentErrorPayload: null,
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

  async function readMinutesTranscript(minuteToken) {
    if (!minuteToken) return "";
    const url = new URL(`${FEISHU_API_BASE}/minutes/v1/minutes/${encodeURIComponent(minuteToken)}/transcript`);
    url.searchParams.set("need_speaker", "true");
    url.searchParams.set("need_timestamp", "true");
    url.searchParams.set("file_format", "txt");
    const errors = [];
    try {
      const tenantToken = await getTenantAccessToken();
      return await requestTextExport(
        url.toString(),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tenantToken}` },
        },
        "读取飞书妙记转录"
      );
    } catch (error) {
      errors.push(error.message || "tenant token 读取失败");
    }
    try {
      const userToken = await getValidUserToken();
      return await requestTextExport(
        url.toString(),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${userToken}` },
        },
        "读取飞书妙记转录"
      );
    } catch (error) {
      errors.push(error.message || "user token 读取失败");
    }
    const finalError = new Error(errors.filter(Boolean).join("；") || "读取飞书妙记转录失败");
    finalError.statusCode = 502;
    throw finalError;
  }

  async function syncBitableRecord(session) {
    if (!bitableAppToken || !bitableTableId) {
      return { skipped: true, reason: "missing_bitable_config", message: "未配置飞书面试台账" };
    }
    const fields = {
      姓名: session.resume?.name || session.matchedResume?.name || "",
      候选人联系电话: session.resume?.phone || "",
      初次沟通日期: session.startTime ? Number(session.startTime) * 1000 : "",
    };
    const record = session.bitableRecordId ? await updateBitableRecord(session.bitableRecordId, fields) : await createBitableRecord(fields);
    return {
      recordId: record.record_id || record.id || session.bitableRecordId || "",
      fields,
      syncedAt: new Date().toISOString(),
    };
  }

  async function collectBackfillSources(session) {
    const documentTexts = [];
    const sources = [];
    const errors = [];
    const docId = session.feishuDoc?.documentId || "";
    if (docId) {
      try {
        const text = await readDocumentText(docId);
        const docText = meaningfulInterviewDocText(text, session.feishuDoc?.localText || "");
        if (docText) {
          documentTexts.push(docText);
          sources.push({ type: "interview_doc", id: docId, length: docText.length, url: session.feishuDoc?.url || "" });
        } else if (text) {
          sources.push({ type: "interview_doc", id: docId, length: 0, url: session.feishuDoc?.url || "" });
        }
      } catch (error) {
        errors.push(`面试文档读取失败：${error.message}`);
      }
    }
    const sourceText = [session.description, session.meetingUrl, session.rawEvent ? JSON.stringify(session.rawEvent) : ""].join("\n");
    const linkedDocIds = extractDocumentTokensFromText(sourceText).filter((token) => token !== docId);
    for (const token of linkedDocIds.slice(0, 3)) {
      try {
        const text = await readDocumentText(token);
        if (text) {
          documentTexts.push(text);
          sources.push({ type: "linked_doc", id: token, length: text.length, url: `https://feishu.cn/docx/${token}` });
        }
      } catch (error) {
        errors.push(`会议纪要/关联文档读取失败：${error.message}`);
      }
    }
    const minuteTokens = extractMinuteTokensFromText(sourceText);
    for (const token of minuteTokens.slice(0, 3)) {
      try {
        const text = await readMinutesTranscript(token);
        if (text) {
          documentTexts.push(text);
          sources.push({ type: "minutes_transcript", id: token, length: text.length, url: `https://feishu.cn/minutes/${token}` });
        }
      } catch (error) {
        errors.push(`飞书妙记转录读取失败：${error.message}`);
      }
    }
    const text = documentTexts.filter(Boolean).join("\n\n");
    return {
      text,
      source: {
        types: [...new Set(sources.map((item) => item.type))],
        rawTextLength: text.length,
        linkedDocIds,
        minuteTokens,
        sources,
        errors,
      },
      linkedDocIds,
      minuteTokens,
      sources,
      errors,
    };
  }

  async function collectBackfillText(session) {
    const collected = await collectBackfillSources(session);
    return {
      text: collected.text,
      errors: collected.errors,
      linkedDocIds: collected.linkedDocIds,
      minuteTokens: collected.minuteTokens,
      source: collected.source,
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
    syncInterviewDocumentContent,
    readDocumentText,
    syncBitableRecord,
    getBitableFields,
    getBitableTableInfo,
    listBitableRecords,
    getBitableRecord,
    createBitableRecord,
    updateBitableRecord,
    uploadBitableAttachment,
    readMinutesTranscript,
    collectBackfillSources,
    collectBackfillText,
  };
}

module.exports = {
  createFeishuClient,
  normalizeCalendarEvent,
  isInterviewLikeEvent,
  extractDocumentTokensFromText,
  extractMinuteTokensFromText,
};
