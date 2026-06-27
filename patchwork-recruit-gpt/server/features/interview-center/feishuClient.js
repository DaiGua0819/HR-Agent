const { clipText, compactText, normalizeDateSeconds, safeArray } = require("./utils");
const fs = require("node:fs/promises");

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
const DOCX_WRITE_DELAY_MS = Math.max(0, Number(process.env.FEISHU_DOCX_WRITE_DELAY_MS || 150));
const DEFAULT_BITABLE_TABLE_ROUTES = [
  {
    tableId: "tblJTlyRbGdsbJmM",
    tableName: "AI实习生",
    keywords: ["AI应用开发实习生", "AI应用开发工程师", "AI应用开发", "AI Agent开发", "AI实习生", "智能体", "Agent", "RAG"],
  },
  {
    tableId: "tblbADJqkdRhRlxv",
    tableName: "HR",
    keywords: ["HRBP", "hrbp", "人力资源管培生", "人力资源", "HR"],
  },
  {
    tableId: "tblt5Wr599vRy9Oq",
    tableName: "石油销售",
    keywords: ["销售工程师（石油钻井泥浆膨润土）", "石油钻井泥浆膨润土销售", "石油销售"],
  },
  {
    tableId: "tbl1IXITxRv8uJhg",
    tableName: "应用技术",
    keywords: ["应用技术经理（工业涂料领域）", "应用技术管培生（涂料领域）", "应用技术", "工业涂料"],
  },
  {
    tableId: "tblbzO2P0T5d0kqE",
    tableName: "销售管培生",
    keywords: ["销售管培生"],
  },
  {
    tableId: "tblw4hW6JMm6PtML",
    tableName: "国际业务管培生",
    keywords: ["国际业务管培生"],
  },
  {
    tableId: "tblWR0OsR9y0FUmu",
    tableName: "膨润土销售",
    keywords: ["膨润土销售人员", "膨润土销售"],
  },
  {
    tableId: "tblWNla7BrBqZv6h",
    tableName: "阳原电气工程师",
    keywords: ["电气工程师", "阳原电气工程师"],
  },
  {
    tableId: "tbll8HD8jymNLNWg",
    tableName: "沙粉销售",
    keywords: ["沙粉销售"],
  },
  {
    tableId: "tblmSgGhJCU0rrMX",
    tableName: "运营A表",
    keywords: ["运营A", "企业内容运营负责人（B2B/短视频方向）", "企业内容运营负责人", "B2B/短视频方向", "短视频方向", "内容运营负责人"],
  },
  {
    tableId: "tblXyHjYr0Ba1rhe",
    tableName: "运营B表",
    keywords: ["运营B", "B端社交媒体运营", "社交媒体运营", "B端运营"],
  },
  {
    tableId: "tblEyxP6FuiSPZGO",
    tableName: "投资交易策略研究员（量化与市场情绪方向）",
    keywords: ["投资交易策略研究员（量化与市场情绪方向）", "投资交易策略研究员", "量化与市场情绪方向"],
  },
  {
    tableId: "tbloqD6Lc0BXi0vs",
    tableName: "外部财务产品顾问",
    keywords: ["外部财务产品顾问"],
  },
  {
    tableId: "tblLD6fXxV2RqFcw",
    tableName: "AI智能体解决方案负责人",
    keywords: ["AI智能体解决方案负责人", "智能体解决方案负责人"],
  },
];
const DEFAULT_FEISHU_OAUTH_SCOPES = [
  "offline_access",
  "auth:user.id:read",
  "calendar:calendar:readonly",
  "calendar:calendar.event:read",
  "docx:document",
  "bitable:app",
  "drive:drive",
  "drive:drive:readonly",
  "drive:file:upload",
  "vc:meeting.meetingevent:read",
  "vc:meeting.search:read",
  "vc:record:readonly",
  "vc:note:read",
  "minutes:minutes:readonly",
  "minutes:minutes.artifacts:read",
  "minutes:minutes.search:read",
  "minutes:minutes.transcript:export",
].join(" ");

function normalizeRouteText(value = "") {
  return compactText(value)
    .toLowerCase()
    .replace(/[\s_\-—–、，,。:：/\\()（）\[\]【】]+/g, "");
}

function splitRouteKeywords(value = "") {
  return String(value || "")
    .split(/[,\n;，；|]+/)
    .map((item) => compactText(item))
    .filter(Boolean);
}

function normalizeBitableRoute(route = {}) {
  const tableId = compactText(route.tableId || route.table_id || route.id || "");
  const tableName = compactText(route.tableName || route.table_name || route.name || "");
  const keywords = safeArray(route.keywords || route.jobs || route.jobTypes || route.job_types)
    .flatMap((item) => (typeof item === "string" ? splitRouteKeywords(item) : []))
    .concat(splitRouteKeywords(route.keyword || route.job || route.jobType || ""))
    .filter(Boolean);
  if (!tableId || !keywords.length) return null;
  return { tableId, tableName, keywords };
}

function parseConfiguredBitableRoutes(value = "") {
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return safeArray(parsed).map(normalizeBitableRoute).filter(Boolean);
  } catch {
    return text
      .split(/\r?\n/)
      .map((line) => {
        const [keywordsText, tableId, tableName = ""] = line.split("=>").length > 1 ? line.split("=>") : line.split("=");
        return normalizeBitableRoute({ tableId, tableName, keywords: splitRouteKeywords(keywordsText) });
      })
      .filter(Boolean);
  }
}

function defaultBitableRoutes(defaultTableId = "") {
  return DEFAULT_BITABLE_TABLE_ROUTES.map((route) => {
    if (route.tableName === "AI实习生" && defaultTableId) return { ...route, tableId: defaultTableId };
    return route;
  });
}

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

function extractMeetingIdsFromText(text = "") {
  const raw = String(text || "");
  const ids = new Set();
  const patterns = [
    /vc\.feishu\.cn\/j\/([0-9]+)/g,
    /meetings\/([0-9]+)/g,
    /"meeting_id"\s*:\s*"([^"]+)"/g,
    /"meetingId"\s*:\s*"([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw))) {
      if (match[1]) ids.add(match[1]);
    }
  }
  return [...ids];
}

function appendUnique(target, items) {
  for (const item of safeArray(items)) {
    if (item && !target.includes(item)) target.push(item);
  }
}

function toRfc3339(seconds) {
  const value = Number(seconds || 0);
  if (!value) return "";
  return new Date(value * 1000).toISOString();
}

function extractMinuteTokenFromUrl(url = "") {
  const raw = String(url || "");
  const match = /\/minutes\/([A-Za-z0-9_-]+)/.exec(raw);
  return match?.[1] || "";
}

function stringIds(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (item === null || item === undefined ? "" : String(item)))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const single = value === null || value === undefined ? "" : String(value).trim();
  return single ? [single] : [];
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

function splitMarkdownTableRow(line = "") {
  const value = String(line || "").trim();
  if (!value.includes("|")) return [];
  const normalized = value.replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").map((cell) => compactText(cell));
}

function isMarkdownTableSeparator(line = "") {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableRow(line = "") {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && !isMarkdownTableSeparator(line);
}

function normalizeTableRows(rows = []) {
  const rawRows = safeArray(rows)
    .map((row) => safeArray(row).map((cell) => clipText(compactText(cell) || "-", 1000)))
    .filter((row) => row.length >= 2);
  if (!rawRows.length) return [];
  const columnSize = Math.max(2, Math.min(9, Math.max(...rawRows.map((row) => row.length))));
  return rawRows.map((row) => {
    const next = row.slice(0, columnSize);
    while (next.length < columnSize) next.push("-");
    return next;
  });
}

function docTextToFragments(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const fragments = [];
  let pendingLines = [];

  const flushPending = () => {
    const blocks = pendingLines.flatMap((line) => docLineToBlocks(line));
    if (blocks.length) fragments.push({ type: "blocks", blocks });
    pendingLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[index + 1] || "")) {
      flushPending();
      const rows = [splitMarkdownTableRow(line)];
      index += 2;
      for (; index < lines.length; index += 1) {
        const rowLine = lines[index] || "";
        if (!isMarkdownTableRow(rowLine)) break;
        rows.push(splitMarkdownTableRow(rowLine));
      }
      index -= 1;
      const tableRows = normalizeTableRows(rows);
      if (tableRows.length) fragments.push({ type: "table", rows: tableRows });
      continue;
    }
    pendingLines.push(line);
  }
  flushPending();
  return fragments;
}

function chunkArray(items = [], size = 40) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryFeishuWrite(error) {
  const status = Number(error?.statusCode || 0);
  if (status === 429 || status === 409) return true;
  if (status >= 500 && status < 600) return true;
  return !status && !Object.keys(error?.payload || {}).length;
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
  const configuredRoutes = parseConfiguredBitableRoutes(process.env.FEISHU_INTERVIEW_BITABLE_TABLE_ROUTES);
  const bitableTableRoutes = configuredRoutes.length ? configuredRoutes : defaultBitableRoutes(bitableTableId);
  const bitableFieldsCache = new Map();
  const bitableTableCache = new Map();

  function bitableRouteJobText(input = {}) {
    const session = input.session || input || {};
    const resume = input.resume || session.resume || session.matchedResume || {};
    return [
      resume.jobType,
      resume.appliedPosition,
      resume.position,
      resume.fileName,
      session.resume?.jobType,
      session.matchedResume?.jobType,
      session.title,
      session.summary,
      session.description,
    ]
      .map(compactText)
      .filter(Boolean)
      .join(" ");
  }

  function resolveBitableTarget(input = {}) {
    const jobText = bitableRouteJobText(input);
    const normalizedJobText = normalizeRouteText(jobText);
    let matchedKeyword = "";
    const route = normalizedJobText
      ? bitableTableRoutes.find((item) => {
          matchedKeyword = item.keywords.find((keyword) => normalizeRouteText(keyword) && normalizedJobText.includes(normalizeRouteText(keyword))) || "";
          return Boolean(matchedKeyword);
        })
      : null;
    const target = route || {};
    return {
      appToken: bitableAppToken,
      tableId: target.tableId || bitableTableId,
      tableName: target.tableName || "",
      routeMatched: Boolean(route),
      routeKeyword: matchedKeyword,
      route,
      jobText,
    };
  }

  function bitableCacheKey(target = {}) {
    return `${target.appToken || ""}|${target.tableId || ""}`;
  }

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

  function bitableBaseUrl(target = resolveBitableTarget()) {
    if (!target.appToken || !target.tableId) return "";
    return `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(target.appToken)}/tables/${encodeURIComponent(target.tableId)}`;
  }

  function assertBitableConfigured(target = resolveBitableTarget()) {
    if (!target.appToken || !target.tableId) {
      const error = new Error("未配置飞书面试台账");
      error.statusCode = 400;
      throw error;
    }
  }

  async function getBitableFields({ force = false, target = resolveBitableTarget() } = {}) {
    assertBitableConfigured(target);
    const cacheKey = bitableCacheKey(target);
    if (bitableFieldsCache.has(cacheKey) && !force) return bitableFieldsCache.get(cacheKey);
    const tenantToken = await getTenantAccessToken();
    const fields = [];
    let pageToken = "";
    do {
      const url = new URL(`${bitableBaseUrl(target)}/fields`);
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
    const cached = { items: fields, byName, fetchedAt: new Date().toISOString(), target };
    bitableFieldsCache.set(cacheKey, cached);
    return cached;
  }

  async function getBitableTableInfo({ force = false, target = resolveBitableTarget() } = {}) {
    assertBitableConfigured(target);
    const cacheKey = bitableCacheKey(target);
    if (bitableTableCache.has(cacheKey) && !force) return bitableTableCache.get(cacheKey);
    const tenantToken = await getTenantAccessToken();
    try {
      const payload = await requestJson(
        `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(target.appToken)}/tables/${encodeURIComponent(target.tableId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${tenantToken}` },
        },
        "读取飞书多维表信息"
      );
      const table = {
        ...(payload.data?.table || payload.data || {}),
        table_id: (payload.data?.table || payload.data || {}).table_id || target.tableId,
        name: (payload.data?.table || payload.data || {}).name || target.tableName,
        routeMatched: target.routeMatched,
        routeKeyword: target.routeKeyword,
        routeJobText: target.jobText,
      };
      bitableTableCache.set(cacheKey, table);
      return table;
    } catch {
      try {
        const payload = await requestJson(
          `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(target.appToken)}/tables`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${tenantToken}` },
          },
          "读取飞书多维表列表"
        );
        const tables = safeArray(payload.data?.items || payload.data?.tables);
        const table = {
          ...(tables.find((item) => item.table_id === target.tableId || item.id === target.tableId) || {}),
          table_id: target.tableId,
          name: tables.find((item) => item.table_id === target.tableId || item.id === target.tableId)?.name || target.tableName,
          routeMatched: target.routeMatched,
          routeKeyword: target.routeKeyword,
          routeJobText: target.jobText,
        };
        bitableTableCache.set(cacheKey, table);
        return table;
      } catch {
        const table = {
          table_id: target.tableId,
          name: target.tableName || process.env.FEISHU_INTERVIEW_BITABLE_TABLE_NAME || "",
          routeMatched: target.routeMatched,
          routeKeyword: target.routeKeyword,
          routeJobText: target.jobText,
        };
        bitableTableCache.set(cacheKey, table);
      }
    }
    return bitableTableCache.get(cacheKey);
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

  async function listBitableRecords({ pageSize = 500, maxRecords = 2000, target = resolveBitableTarget() } = {}) {
    assertBitableConfigured(target);
    const tenantToken = await getTenantAccessToken();
    const records = [];
    let pageToken = "";
    do {
      const url = new URL(`${bitableBaseUrl(target)}/records`);
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

  async function getBitableRecord(recordId, { target = resolveBitableTarget() } = {}) {
    if (!recordId) return null;
    assertBitableConfigured(target);
    const tenantToken = await getTenantAccessToken();
    const url = new URL(`${bitableBaseUrl(target)}/records/${encodeURIComponent(recordId)}`);
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

  async function createBitableRecord(fields, { target = resolveBitableTarget() } = {}) {
    assertBitableConfigured(target);
    const fieldMap = await getBitableFields({ target });
    const tenantToken = await getTenantAccessToken();
    const payload = await requestJson(
      `${bitableBaseUrl(target)}/records?user_id_type=open_id`,
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

  async function updateBitableRecord(recordId, fields, { target = resolveBitableTarget() } = {}) {
    if (!recordId) return createBitableRecord(fields, { target });
    assertBitableConfigured(target);
    const fieldMap = await getBitableFields({ target });
    const tenantToken = await getTenantAccessToken();
    const payload = await requestJson(
      `${bitableBaseUrl(target)}/records/${encodeURIComponent(recordId)}?user_id_type=open_id`,
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

  async function uploadBitableAttachment({ filePath, filename = "image.png", contentType = "image/png", target = resolveBitableTarget() }) {
    assertBitableConfigured(target);
    const tenantToken = await getTenantAccessToken();
    const buffer = await fs.readFile(filePath);
    const baseFields = {
      file_name: filename,
      parent_node: target.appToken,
      size: String(buffer.length),
      extra: JSON.stringify({ drive_route_token: target.appToken }),
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
    const scope = String(process.env.FEISHU_OAUTH_SCOPES || DEFAULT_FEISHU_OAUTH_SCOPES).trim();
    if (scope) url.searchParams.set("scope", scope);
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

  async function createDocumentFromText({ title, docText, action = "创建飞书文档" }) {
    const userToken = await getValidUserToken();
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
      action
    );
    const document = created.data?.document || created.data || {};
    const documentId = document.document_id || document.documentId || document.obj_token || "";
    if (!documentId) throw createFeishuError(action, created, 500);

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

  async function createInterviewDocument(session) {
    const title = `${session.resume?.name || session.matchedResume?.name || "候选人"}-${session.resume?.jobType || session.matchedResume?.jobType || "面试"}-面试问题`;
    const docText = questionSetToDocText(session);
    return createDocumentFromText({ title, docText, action: "创建飞书面试文档" });
  }

  async function insertDocumentChildren(documentId, parentBlockId, children, userToken, { index = 0, action = "写入飞书文档" } = {}) {
    return requestJson(
      `${FEISHU_API_BASE}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ index, children }),
      },
      action
    );
  }

  async function listDocumentBlocks(documentId, userToken) {
    const blocks = [];
    let pageToken = "";
    do {
      const url = new URL(`${FEISHU_API_BASE}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`);
      url.searchParams.set("page_size", "500");
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const payload = await requestJson(
        url.toString(),
        {
          method: "GET",
          headers: { Authorization: `Bearer ${userToken}` },
        },
        "读取飞书文档块"
      );
      const data = payload.data || {};
      blocks.push(...safeArray(data.items || data.blocks));
      pageToken = data.page_token || "";
      if (!data.has_more) pageToken = "";
    } while (pageToken);
    return blocks;
  }

  function tableColumnWidths(columnSize) {
    const presets = {
      4: [150, 90, 330, 240],
      7: [180, 100, 210, 240, 220, 220, 140],
      8: [170, 90, 200, 220, 180, 180, 140, 100],
    };
    return presets[columnSize] || Array.from({ length: columnSize }, () => 180);
  }

  async function updateDocumentTextBlock(documentId, blockId, text, userToken, { bold = false } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await requestJson(
          `${FEISHU_API_BASE}/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${userToken}`,
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({ update_text_elements: richTextPayload(text, { bold }) }),
          },
          "写入飞书表格单元格"
        );
      } catch (error) {
        lastError = error;
        if (attempt >= 3 || !shouldRetryFeishuWrite(error)) break;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastError || new Error("写入飞书表格单元格失败");
  }

  async function insertTableCellText(documentId, cellId, text, userToken, { bold = false } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await insertDocumentChildren(
          documentId,
          cellId,
          [{ block_type: 2, text: richTextPayload(text, { bold }) }],
          userToken,
          { index: 0, action: "写入飞书表格单元格" }
        );
      } catch (error) {
        lastError = error;
        if (attempt >= 3 || !shouldRetryFeishuWrite(error)) break;
        await sleep(400 * (attempt + 1));
      }
    }
    throw lastError || new Error("写入飞书表格单元格失败");
  }

  async function writeSingleTableCell(documentId, cellId, textBlockId, cellText, userToken, { bold = false, rowIndex = 0, columnIndex = 0 } = {}) {
    try {
      if (textBlockId) {
        return await updateDocumentTextBlock(documentId, textBlockId, cellText, userToken, { bold });
      }
      if (cellId) {
        return await insertTableCellText(documentId, cellId, cellText, userToken, { bold });
      }
      return null;
    } catch (error) {
      error.payload = {
        ...(error.payload || {}),
        statusCode: error.statusCode || 0,
        tableCell: {
          rowIndex,
          columnIndex,
          textPreview: clipText(cellText, 120),
        },
      };
      throw error;
    } finally {
      if (DOCX_WRITE_DELAY_MS) await sleep(DOCX_WRITE_DELAY_MS);
    }
  }

  async function writeDocumentTable(documentId, rows, userToken, insertIndex) {
    const tableRows = normalizeTableRows(rows);
    if (!tableRows.length) return null;
    const rowSize = tableRows.length;
    const columnSize = tableRows[0].length;
    const inserted = await insertDocumentChildren(
      documentId,
      documentId,
      [
        {
          block_type: 31,
          table: {
            property: {
              row_size: rowSize,
              column_size: columnSize,
              column_width: tableColumnWidths(columnSize),
            },
          },
        },
      ],
      userToken,
      { index: insertIndex, action: "创建飞书技能评价表格" }
    );
    const tableBlock = safeArray(inserted.data?.children || inserted.children)[0] || {};
    const cellIds = safeArray(tableBlock.table?.cells || tableBlock.children);
    if (!cellIds.length) return tableBlock;

    const blockMap = new Map((await listDocumentBlocks(documentId, userToken)).map((block) => [block.block_id, block]));
    for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < columnSize; columnIndex += 1) {
        const cellId = cellIds[rowIndex * columnSize + columnIndex];
        const cellBlock = blockMap.get(cellId);
        const textBlockId = safeArray(cellBlock?.children).find((childId) => blockMap.get(childId)?.block_type === 2) || safeArray(cellBlock?.children)[0];
        const cellText = tableRows[rowIndex][columnIndex] || "-";
        await writeSingleTableCell(documentId, cellId, textBlockId, cellText, userToken, {
          bold: rowIndex === 0,
          rowIndex,
          columnIndex,
        });
      }
    }
    return tableBlock;
  }

  async function writeDocumentBlocks(documentId, docText, userToken) {
    const fragments = docTextToFragments(docText);
    if (!fragments.length) return;
    let insertIndex = 0;
    for (const fragment of fragments) {
      if (fragment.type === "table") {
        await writeDocumentTable(documentId, fragment.rows, userToken, insertIndex);
        insertIndex += 1;
        continue;
      }
      const blocks = safeArray(fragment.blocks).slice(0, 180);
      for (const children of chunkArray(blocks)) {
        await insertDocumentChildren(documentId, documentId, children, userToken, { index: insertIndex, action: "写入飞书面试文档" });
        insertIndex += children.length;
      }
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

  function extractNoteArtifactDocTokens(note = {}) {
    const artifacts = safeArray(note.artifacts);
    const verbatim = [];
    const main = [];
    const other = [];
    for (const artifact of artifacts) {
      const docToken = compactText(artifact?.doc_token || artifact?.docToken || "");
      if (!docToken) continue;
      const type = Number(artifact?.artifact_type || artifact?.artifactType || 0);
      if (type === 2) verbatim.push(docToken);
      else if (type === 1) main.push(docToken);
      else other.push(docToken);
    }
    const refs = safeArray(note.references)
      .map((item) => compactText(item?.doc_token || item?.docToken || ""))
      .filter(Boolean);
    return [...new Set([...verbatim, ...main, ...other, ...refs])];
  }

  async function readMeetingDetail(meetingId) {
    if (!meetingId) return { noteId: "", source: null };
    const userToken = await getValidUserToken();
    const url = new URL(`${FEISHU_API_BASE}/vc/v1/meetings/${encodeURIComponent(meetingId)}`);
    url.searchParams.set("with_participants", "false");
    url.searchParams.set("query_mode", "0");
    const payload = await requestJson(
      url.toString(),
      {
        method: "GET",
        headers: { Authorization: `Bearer ${userToken}` },
      },
      "读取飞书会议详情"
    );
    const meeting = payload.data?.meeting || payload.meeting || {};
    const noteId = compactText(meeting.note_id || meeting.noteId || "");
    return {
      noteId,
      source: {
        type: "meeting_detail",
        id: compactText(meeting.id || meetingId),
        length: noteId ? 1 : 0,
        url: meeting.url || "",
      },
    };
  }

  async function readMeetingNoteDocTokens(noteId) {
    if (!noteId) return { docTokens: [], source: null };
    const userToken = await getValidUserToken();
    const payload = await requestJson(
      `${FEISHU_API_BASE}/vc/v1/notes/${encodeURIComponent(noteId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${userToken}` },
      },
      "读取飞书会议纪要详情"
    );
    const note = payload.data?.note || payload.note || {};
    const docTokens = extractNoteArtifactDocTokens(note);
    return {
      docTokens,
      source: {
        type: "meeting_note",
        id: noteId,
        length: docTokens.length,
        url: "",
      },
    };
  }

  async function resolveCalendarMeetingRelations(session = {}) {
    const eventId = session.feishuEventId || session.rawEvent?.event_id || "";
    if (!eventId) return { meetingIds: [], meetingNoteIds: [], sources: [], errors: [] };
    const userToken = await getValidUserToken();
    const calendarIds = [
      session.calendarId || "primary",
      "primary",
      session.rawEvent?.organizer_calendar_id || "",
    ].filter(Boolean);
    const uniqueCalendarIds = [...new Set(calendarIds)];
    const meetingIds = [];
    const meetingNoteIds = [];
    const sources = [];
    const errors = [];
    for (const calendarId of uniqueCalendarIds) {
      try {
        const payload = await requestJson(
          `${FEISHU_API_BASE}/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events/mget_instance_relation_info`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${userToken}`,
              "Content-Type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              instance_ids: [eventId],
              need_meeting_instance_ids: true,
              need_meeting_notes: true,
            }),
          },
          "读取飞书日程关联会议"
        );
        const infos = safeArray(payload.data?.instance_relation_infos || payload.data?.items);
        for (const info of infos) {
          appendUnique(meetingIds, [
            ...stringIds(info.meeting_instance_ids),
            ...stringIds(info.meeting_ids),
            ...stringIds(info.meeting_instance_id),
            ...stringIds(info.meeting_id),
          ]);
          appendUnique(meetingNoteIds, [
            ...stringIds(info.meeting_notes),
            ...stringIds(info.note_doc_tokens),
            ...stringIds(info.note_doc_token),
            ...stringIds(info.verbatim_doc_token),
          ]);
        }
        sources.push({
          type: "calendar_relation",
          id: eventId,
          length: meetingIds.length + meetingNoteIds.length,
          url: session.rawEvent?.app_link || "",
        });
        if (meetingIds.length || meetingNoteIds.length) break;
      } catch (error) {
        errors.push(`日程关联会议读取失败(${calendarId})：${error.message}`);
      }
    }
    return { meetingIds, meetingNoteIds, sources, errors };
  }

  async function readMeetingRecordingMinuteToken(meetingId) {
    if (!meetingId) return { token: "", source: null };
    const userToken = await getValidUserToken();
    const payload = await requestJson(
      `${FEISHU_API_BASE}/vc/v1/meetings/${encodeURIComponent(meetingId)}/recording`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${userToken}` },
      },
      "读取飞书会议录制"
    );
    const recording = payload.data?.recording || payload.recording || {};
    const recordingUrl = recording.url || recording.recording_url || "";
    const token = extractMinuteTokenFromUrl(recordingUrl);
    return {
      token,
      source: {
        type: "meeting_recording",
        id: meetingId,
        length: token ? 1 : 0,
        url: recordingUrl,
      },
    };
  }

  async function searchMeetingIdsForSession(session = {}) {
    const query = compactText(session.resume?.name || session.matchedResume?.name || session.title || "").slice(0, 50);
    if (!query && !session.startTime && !session.endTime) return { meetingIds: [], sources: [], errors: [] };
    const userToken = await getValidUserToken();
    const start = toRfc3339(Number(session.startTime || 0) - 60 * 60);
    const end = toRfc3339(Number(session.endTime || session.startTime || 0) + 2 * 60 * 60);
    const body = {};
    if (query) body.query = query;
    const meetingFilter = {};
    if (start || end) {
      meetingFilter.start_time = {
        ...(start ? { start_time: start } : {}),
        ...(end ? { end_time: end } : {}),
      };
    }
    if (Object.keys(meetingFilter).length) body.meeting_filter = meetingFilter;
    const url = new URL(`${FEISHU_API_BASE}/vc/v1/meetings/search`);
    url.searchParams.set("page_size", "10");
    const payload = await requestJson(
      url.toString(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      },
      "搜索飞书会议"
    );
    const items = safeArray(payload.data?.items || payload.items);
    const meetingIds = [];
    for (const item of items) {
      appendUnique(meetingIds, stringIds(item.id || item.meeting_id || item.meeting_instance_id));
    }
    return {
      meetingIds,
      sources: [
        {
          type: "meeting_search",
          id: query || `${session.startTime || ""}`,
          length: meetingIds.length,
          url: "",
        },
      ],
      errors: [],
    };
  }

  async function searchMinuteTokensForSession(session = {}) {
    const query = compactText(session.resume?.name || session.matchedResume?.name || session.title || "").slice(0, 50);
    if (!query && !session.startTime && !session.endTime) return { minuteTokens: [], sources: [], errors: [] };
    const userToken = await getValidUserToken();
    const start = toRfc3339(Number(session.startTime || 0) - 60 * 60);
    const end = toRfc3339(Number(session.endTime || session.startTime || 0) + 2 * 60 * 60);
    const body = {};
    if (query) body.query = query;
    const filter = {};
    if (start || end) {
      filter.create_time = {
        ...(start ? { start_time: start } : {}),
        ...(end ? { end_time: end } : {}),
      };
    }
    if (Object.keys(filter).length) body.filter = filter;
    const url = new URL(`${FEISHU_API_BASE}/minutes/v1/minutes/search`);
    url.searchParams.set("page_size", "10");
    const payload = await requestJson(
      url.toString(),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      },
      "搜索飞书妙记"
    );
    const items = safeArray(payload.data?.items || payload.items);
    const minuteTokens = [];
    for (const item of items) {
      appendUnique(minuteTokens, stringIds(item.token || item.minute_token || item.minuteToken));
    }
    return {
      minuteTokens,
      sources: [
        {
          type: "minutes_search",
          id: query || `${session.startTime || ""}`,
          length: minuteTokens.length,
          url: "",
        },
      ],
      errors: [],
    };
  }

  async function syncBitableRecord(session) {
    const target = resolveBitableTarget(session);
    if (!target.appToken || !target.tableId) {
      return { skipped: true, reason: "missing_bitable_config", message: "未配置飞书面试台账" };
    }
    const candidateName = session.resume?.name || session.matchedResume?.name || "";
    const fields = {
      候选人姓名: candidateName,
      姓名: candidateName,
      候选人联系电话: session.resume?.phone || "",
      初次沟通日期: session.startTime ? Number(session.startTime) * 1000 : "",
      职位: session.resume?.jobType || session.matchedResume?.jobType || "",
    };
    const recordId =
      session.bitableRecordId && (!session.bitableTableId || session.bitableTableId === target.tableId)
        ? session.bitableRecordId
        : "";
    const record = recordId ? await updateBitableRecord(recordId, fields, { target }) : await createBitableRecord(fields, { target });
    return {
      recordId: record.record_id || record.id || recordId || "",
      tableId: target.tableId,
      tableName: target.tableName,
      routeKeyword: target.routeKeyword,
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
    const discoveredMinuteTokens = [...minuteTokens];
    const meetingIds = [];
    const meetingIdsFromText = extractMeetingIdsFromText(sourceText);
    try {
      const relation = await resolveCalendarMeetingRelations(session);
      appendUnique(meetingIds, relation.meetingIds);
      appendUnique(sources, relation.sources);
      appendUnique(errors, relation.errors);
      const meetingNoteIds = safeArray(relation.meetingNoteIds).filter((token) => token && token !== docId);
      appendUnique(linkedDocIds, meetingNoteIds);
      for (const token of meetingNoteIds.slice(0, 3)) {
        try {
          const text = await readDocumentText(token);
          if (text) {
            documentTexts.push(text);
            sources.push({ type: "meeting_note_doc", id: token, length: text.length, url: `https://feishu.cn/docx/${token}` });
          }
        } catch (error) {
          errors.push(`飞书会议纪要文档读取失败(${token})：${error.message}`);
        }
      }
    } catch (error) {
      errors.push(`飞书会议关联解析失败：${error.message}`);
    }
    appendUnique(meetingIds, meetingIdsFromText);

    if (!meetingIds.length) {
      try {
        const meetingSearch = await searchMeetingIdsForSession(session);
        appendUnique(meetingIds, meetingSearch.meetingIds);
        appendUnique(sources, meetingSearch.sources);
        appendUnique(errors, meetingSearch.errors);
      } catch (error) {
        errors.push(`飞书会议搜索失败：${error.message}`);
      }
    }

    const discoveredMeetingNoteIds = [];
    for (const meetingId of meetingIds.slice(0, 5)) {
      try {
        const detail = await readMeetingDetail(meetingId);
        if (detail.source) sources.push(detail.source);
        appendUnique(discoveredMeetingNoteIds, detail.noteId ? [detail.noteId] : []);
      } catch (error) {
        errors.push(`飞书会议详情读取失败(${meetingId})：${error.message}`);
      }
    }

    const discoveredNoteDocIds = [];
    for (const noteId of discoveredMeetingNoteIds.slice(0, 5)) {
      try {
        const note = await readMeetingNoteDocTokens(noteId);
        if (note.source) sources.push(note.source);
        appendUnique(discoveredNoteDocIds, note.docTokens);
      } catch (error) {
        errors.push(`飞书会议纪要详情读取失败(${noteId})：${error.message}`);
      }
    }

    for (const token of discoveredNoteDocIds.filter((item) => item && item !== docId).slice(0, 8)) {
      appendUnique(linkedDocIds, [token]);
      try {
        const text = await readDocumentText(token);
        if (text) {
          documentTexts.push(text);
          sources.push({ type: "meeting_note_doc", id: token, length: text.length, url: `https://feishu.cn/docx/${token}` });
        }
      } catch (error) {
        errors.push(`飞书会议纪要文档读取失败(${token})：${error.message}`);
      }
    }

    for (const meetingId of meetingIds.slice(0, 5)) {
      try {
        const recording = await readMeetingRecordingMinuteToken(meetingId);
        if (recording.source) sources.push(recording.source);
        appendUnique(discoveredMinuteTokens, recording.token ? [recording.token] : []);
      } catch (error) {
        errors.push(`飞书会议录制读取失败(${meetingId})：${error.message}`);
      }
    }

    if (!discoveredMinuteTokens.length) {
      try {
        const minutesSearch = await searchMinuteTokensForSession(session);
        appendUnique(discoveredMinuteTokens, minutesSearch.minuteTokens);
        appendUnique(sources, minutesSearch.sources);
        appendUnique(errors, minutesSearch.errors);
      } catch (error) {
        errors.push(`飞书妙记搜索失败：${error.message}`);
      }
    }

    for (const token of discoveredMinuteTokens.slice(0, 5)) {
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
        minuteTokens: discoveredMinuteTokens,
        meetingNoteIds: discoveredMeetingNoteIds,
        sources,
        errors,
      },
      linkedDocIds,
      minuteTokens: discoveredMinuteTokens,
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
    const defaultTarget = resolveBitableTarget();
    return {
      configured: Boolean(appId && appSecret),
      connected: Boolean(token?.accessToken),
      userInfo: token?.userInfo || null,
      expiresAt: token?.expiresAt || 0,
      bitableConfigured: Boolean(defaultTarget.appToken && defaultTarget.tableId),
      bitableTableId: defaultTarget.tableId,
      bitableRoutes: bitableTableRoutes.map((route) => ({
        tableId: route.tableId,
        tableName: route.tableName,
        keywords: route.keywords,
      })),
    };
  }

  function forBitableTarget(input = {}) {
    const target = resolveBitableTarget(input);
    return {
      getBitableTarget: () => target,
      getStatus: () => ({
        ...getStatus(),
        bitableConfigured: Boolean(target.appToken && target.tableId),
        bitableTableId: target.tableId,
        bitableTableName: target.tableName,
        bitableRouteKeyword: target.routeKeyword,
        bitableRouteMatched: target.routeMatched,
      }),
      getBitableFields: (options = {}) => getBitableFields({ ...options, target }),
      getBitableTableInfo: (options = {}) => getBitableTableInfo({ ...options, target }),
      listBitableRecords: (options = {}) => listBitableRecords({ ...options, target }),
      getBitableRecord: (recordId, options = {}) => getBitableRecord(recordId, { ...options, target }),
      createBitableRecord: (fields, options = {}) => createBitableRecord(fields, { ...options, target }),
      updateBitableRecord: (recordId, fields, options = {}) => updateBitableRecord(recordId, fields, { ...options, target }),
      uploadBitableAttachment: (options = {}) => uploadBitableAttachment({ ...options, target }),
    };
  }

  return {
    buildAuthUrl,
    exchangeCode,
    getUserInfo,
    getStatus,
    listCalendarEvents,
    createInterviewDocument,
    createDocumentFromText,
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
    resolveBitableTarget,
    forBitableTarget,
  };
}

module.exports = {
  createFeishuClient,
  normalizeCalendarEvent,
  isInterviewLikeEvent,
  extractDocumentTokensFromText,
  extractMinuteTokensFromText,
};
