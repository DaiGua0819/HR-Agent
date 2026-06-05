const elements = {
  title: document.querySelector("#detailsTitle"),
  subtitle: document.querySelector("#detailsSubtitle"),
  dateInput: document.querySelector("#detailsDateInput"),
  selectedDates: document.querySelector("#detailsSelectedDates"),
  todayBtn: document.querySelector("#detailsTodayBtn"),
  allDatesBtn: document.querySelector("#detailsAllDatesBtn"),
  metricGrid: document.querySelector("#detailsMetricGrid"),
  searchInput: document.querySelector("#detailsSearchInput"),
  jobFilter: document.querySelector("#detailsJobFilter"),
  statusFilter: document.querySelector("#detailsStatusFilter"),
  typeFilter: document.querySelector("#detailsTypeFilter"),
  resetBtn: document.querySelector("#detailsResetBtn"),
  count: document.querySelector("#detailsCount"),
  activeFilter: document.querySelector("#detailsActiveFilter"),
  tableBody: document.querySelector("#detailsTableBody"),
  pagination: document.querySelector("#detailsPagination"),
  conversationDialog: document.querySelector("#detailsConversationDialog"),
  conversationTitle: document.querySelector("#detailsConversationTitle"),
  conversationBody: document.querySelector("#detailsConversationBody"),
  conversationCloseBtn: document.querySelector("#detailsConversationCloseBtn"),
};

const DETAIL_PAGE_SIZE = 10;
const DETAIL_METRICS_BY_MODE = {
  process: ["processed", "sentCompanyInfo", "requestedResume", "userQuestions", "savedResumes"],
  proactive: ["proactiveOpened", "proactiveGreeted", "proactiveReplied", "proactiveQualified"],
};
const DETAIL_STATUS_BY_MODE = {
  proactive: ["proactiveOpened", "proactiveGreeted", "proactiveReplied", "proactiveQualified"],
};
const PROACTIVE_DETAIL_METRICS = new Set(DETAIL_METRICS_BY_MODE.proactive);
const detailSearchParams = new URLSearchParams(window.location.search);

function normalizeDetailPlatform(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (text === "51job" || text === "51" || text === "job51") return "51job";
  if (text === "zhilian" || text === "zhaopin" || text === "智联") return "zhilian";
  return "boss";
}

function detailPlatformLabel() {
  if (state.platform === "zhilian") return "智联自动化";
  return state.platform === "51job" ? "51自动化" : "BOSS自动化";
}

function normalizeDetailMode(value, metric = "") {
  const text = String(value || "").trim();
  if (text === "proactive" || text === "process") return text;
  return PROACTIVE_DETAIL_METRICS.has(metric) ? "proactive" : "process";
}

function defaultMetricForMode(mode) {
  return mode === "proactive" ? "proactiveOpened" : "processed";
}

function detailModeLabel() {
  return state.mode === "proactive" ? "主动联系" : "处理消息";
}

const state = {
  platform: normalizeDetailPlatform(detailSearchParams.get("platform")),
  mode: normalizeDetailMode(detailSearchParams.get("mode"), detailSearchParams.get("metric") || ""),
  metric: detailSearchParams.get("metric") || defaultMetricForMode(normalizeDetailMode(detailSearchParams.get("mode"), detailSearchParams.get("metric") || "")),
  date: normalizeDateState(detailSearchParams.get("date")),
  accountId: ["all", "boss_a", "boss_b", "zhilian_a"].includes(detailSearchParams.get("accountId") || "") ? detailSearchParams.get("accountId") : "all",
  page: normalizePage(detailSearchParams.get("page")),
  pageSize: DETAIL_PAGE_SIZE,
  metrics: [],
  records: [],
};

function getChinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeDateKey(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function dateStateToDates(value = "") {
  return [
    ...new Set(
      String(value || "")
        .split(/[,\s]+/)
        .map(normalizeDateKey)
        .filter(Boolean)
    ),
  ].sort();
}

function datesToDateState(dates = []) {
  return [...new Set((Array.isArray(dates) ? dates : []).map(normalizeDateKey).filter(Boolean))].sort().join(",");
}

function isAllDateState(value = "") {
  const text = String(value || "").trim();
  return text === "all" || text === "全部";
}

function normalizeDateState(value) {
  const text = String(value || "").trim();
  if (isAllDateState(text)) return "all";
  const dates = dateStateToDates(text);
  return dates.length ? datesToDateState(dates) : getChinaDateKey();
}

function dateStateLabel(value = "") {
  if (isAllDateState(value) || !String(value || "").trim()) return "全部日期";
  const dates = dateStateToDates(value);
  if (!dates.length) return "全部日期";
  if (dates.length === 1) return dates[0];
  return `${dates[0]} 等${dates.length}天`;
}

function setDateInputValue(input, dateState) {
  if (!input) return;
  const dates = dateStateToDates(dateState);
  input.value = dates.length === 1 ? dates[0] : "";
}

function renderDateChips(container, dateState, onRemove) {
  if (!container) return;
  const dates = dateStateToDates(dateState);
  container.replaceChildren(
    ...dates.map((date) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "date-chip";
      chip.textContent = date;
      chip.title = `移除 ${date}`;
      chip.addEventListener("click", () => onRemove?.(date));
      return chip;
    })
  );
}

function normalizePage(value) {
  const page = Number.parseInt(String(value || "1"), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function text(value, fallback = "-") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function questionCategoryLabel(category = "") {
  const map = {
    knowledge_gap: "知识库缺口",
    needs_human_answer: "待人工补充",
    unknown_policy: "政策不明确",
    unclear_company_policy: "公司规则待确认",
    substantive_unanswered_question: "实质未答问题",
    rule_only: "规则兜底",
    rule_fallback: "模型失败兜底",
  };
  return map[category] || category || "";
}

function appendText(parent, value, className = "") {
  const node = document.createElement("span");
  if (className) node.className = className;
  node.textContent = text(value);
  parent.append(node);
  return node;
}

function formatSize(size) {
  const value = Number(size || 0);
  if (!value) return "";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function fileHref(fileName) {
  return `./boss-resumes/${encodeURIComponent(fileName).replace(/%2F/g, "")}`;
}

function renderOptions(select, options, defaultLabel) {
  select.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = defaultLabel;
  select.append(defaultOption);
  for (const option of options || []) {
    const node = document.createElement("option");
    node.value = option.key || option;
    node.textContent = option.label || option;
    select.append(node);
  }
}

function metricLabel(metricKey) {
  return state.metrics.find((metric) => metric.key === metricKey)?.label || "今日处理";
}

function visibleMetricsForMode() {
  const keys = DETAIL_METRICS_BY_MODE[state.mode] || [];
  return keys.length ? state.metrics.filter((metric) => keys.includes(metric.key || "")) : state.metrics;
}

function visibleStatusesForMode(statuses = []) {
  const keys = DETAIL_STATUS_BY_MODE[state.mode] || [];
  if (!keys.length) return statuses.filter((item) => !PROACTIVE_DETAIL_METRICS.has(item.key || ""));
  return statuses.filter((item) => keys.includes(item.key || ""));
}

function updateUrlState() {
  const url = new URL(window.location.href);
  url.searchParams.set("platform", state.platform || "boss");
  url.searchParams.set("mode", state.mode || "process");
  url.searchParams.set("metric", state.metric || "processed");
  url.searchParams.set("date", state.date || getChinaDateKey());
  url.searchParams.set("accountId", state.accountId || "all");
  url.searchParams.set("page", String(state.page || 1));
  window.history.replaceState({}, "", url);
}

function syncDateControl() {
  if (elements.dateInput) {
    setDateInputValue(elements.dateInput, state.date);
    elements.dateInput.disabled = false;
  }
  renderDateChips(elements.selectedDates, state.date, (date) => {
    const dates = dateStateToDates(state.date).filter((item) => item !== date);
    state.date = dates.length ? datesToDateState(dates) : "all";
    state.page = 1;
    updateUrlState();
    loadDetails();
  });
  elements.todayBtn?.classList.toggle("is-active", state.date === getChinaDateKey());
  elements.allDatesBtn?.classList.toggle("is-active", isAllDateState(state.date));
}

function renderMetrics() {
  const metrics = visibleMetricsForMode();
  elements.metricGrid.replaceChildren(
    ...metrics.map((metric) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `details-metric${state.metric === metric.key ? " is-active" : ""}`;
      button.addEventListener("click", () => {
        state.metric = metric.key || "processed";
        state.page = 1;
        updateUrlState();
        loadDetails();
      });
      appendText(button, metric.label || "-");
      const value = document.createElement("strong");
      value.textContent = String(metric.value ?? 0);
      button.append(value);
      return button;
    })
  );
}

function recordMatchesMetric(record) {
  if (state.mode === "proactive") {
    return Boolean(record.flags?.[state.metric] || record.statusGroup === state.metric);
  }
  if (!state.metric || state.metric === "processed") {
    return !Boolean(
      record.flags?.proactiveOpened ||
        record.flags?.proactiveGreeted ||
        record.statusGroup === "proactiveOpened" ||
        record.statusGroup === "proactiveGreeted"
    );
  }
  return Boolean(record.flags?.[state.metric] || record.statusGroup === state.metric);
}

function recordMatchesFilters(record) {
  if (!recordMatchesMetric(record)) return false;

  const keyword = elements.searchInput.value.trim().toLowerCase();
  if (keyword) {
    const haystack = [
      record.candidateName,
      record.appliedPosition,
      record.statusLabel,
      record.candidateLabel,
      record.phrase,
      record.question,
      record.answer,
      record.action,
      ...(record.resumeFiles || []).map((file) => file.fileName),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(keyword)) return false;
  }

  if (elements.jobFilter.value && record.appliedPosition !== elements.jobFilter.value) return false;
  if (elements.statusFilter.value && !(record.statusGroup === elements.statusFilter.value || record.flags?.[elements.statusFilter.value])) {
    return false;
  }
  if (elements.typeFilter.value && record.type !== elements.typeFilter.value) return false;
  return true;
}

function renderQuestionCell(cell, record) {
  const wrapper = document.createElement("div");
  wrapper.className = "detail-text-block";
  const normalizedQuestion = record.normalizedQuestion && record.normalizedQuestion !== record.question ? record.normalizedQuestion : "";
  const categoryLabel = questionCategoryLabel(record.questionCategory);
  if (categoryLabel) appendText(wrapper, `类型：${categoryLabel}`, "detail-badge");
  if (normalizedQuestion) appendText(wrapper, `归一化：${normalizedQuestion}`);
  if (record.question) appendText(wrapper, `原问：${record.question}`);
  if (record.questionPoolReason) appendText(wrapper, `判断：${record.questionPoolReason}`, "detail-muted");
  if (record.answer) appendText(wrapper, `答：${record.answer}`);
  if (!record.question && !record.answer && record.phrase) appendText(wrapper, record.phrase);
  if (!record.question && !record.answer && !record.phrase) appendText(wrapper, record.candidateLabel || "-");
  const detailButton = document.createElement("button");
  detailButton.type = "button";
  detailButton.className = "detail-inline-btn";
  detailButton.textContent = "查看对话";
  detailButton.addEventListener("click", () => showConversation(record));
  wrapper.append(detailButton);
  cell.append(wrapper);
}

function appendDialogueBlock(parent, title, lines, emptyText = "暂无记录") {
  const section = document.createElement("section");
  section.className = "dialogue-section";
  const heading = document.createElement("strong");
  heading.textContent = title;
  section.append(heading);
  const list = document.createElement("div");
  list.className = "dialogue-list";
  const validLines = (Array.isArray(lines) ? lines : []).filter((line) => String(line || "").trim());
  if (!validLines.length) {
    const empty = document.createElement("p");
    empty.className = "detail-muted";
    empty.textContent = emptyText;
    list.append(empty);
  } else {
    for (const line of validLines) {
      const item = document.createElement("p");
      item.textContent = line;
      list.append(item);
    }
  }
  section.append(list);
  parent.append(section);
}

function buildTranscriptMessages(conversation, record) {
  const messages = (Array.isArray(conversation?.recentMessages) ? conversation.recentMessages : []).filter((message) =>
    String(message?.text || "").trim()
  );
  if (messages.length) return { messages, fallback: false };

  const current = conversation?.currentRecord || {};
  const fallbackMessages = [];
  const question = current.question || record.question || "";
  const answer = current.answer || record.answer || "";
  if (question) fallbackMessages.push({ sender: "other", text: question, time: current.updatedAt || record.updatedAt || "" });
  if (answer) fallbackMessages.push({ sender: "me", text: answer, time: current.updatedAt || record.updatedAt || "" });
  if (fallbackMessages.length) return { messages: fallbackMessages, fallback: "qa" };

  const rawHeader = text(conversation?.counterpart?.rawHeader, "");
  if (rawHeader) {
    return {
      messages: [{ sender: "system", text: rawHeader, time: current.updatedAt || record.updatedAt || "", status: "原始页面文本" }],
      fallback: "raw",
    };
  }
  return { messages: [], fallback: false };
}

function renderChatTranscript(parent, messages, fallback = false) {
  const section = document.createElement("section");
  section.className = "dialogue-chat-section";
  const heading = document.createElement("strong");
  heading.textContent = "聊天记录";
  section.append(heading);
  const list = document.createElement("div");
  list.className = "dialogue-chat-window";
  const validMessages = (Array.isArray(messages) ? messages : []).filter((message) => message?.text);
  if (!validMessages.length) {
    const empty = document.createElement("p");
    empty.className = "dialogue-empty";
    empty.textContent = "暂无原始聊天记录";
    list.append(empty);
  } else {
    if (fallback) {
      const note = document.createElement("p");
      note.className = "dialogue-empty";
      note.textContent =
        fallback === "raw" ? "旧记录未保存结构化聊天，下面显示当时抓取的 BOSS 页面文本" : "旧记录未保存完整原始聊天，这里只显示本条问答";
      list.append(note);
    }
    for (const message of validMessages) {
      const item = document.createElement("article");
      item.className = `dialogue-message is-${
        message.sender === "me" ? "me" : message.sender === "other" ? "other" : message.sender === "system" ? "system" : "unknown"
      }`;
      const meta = document.createElement("span");
      const senderLabel = message.sender === "me" ? "我方" : message.sender === "other" ? "对方" : message.sender === "system" ? "状态" : "未知";
      meta.textContent = `${senderLabel}${message.time ? ` · ${message.time}` : ""}${message.status ? ` · ${message.status}` : ""}`;
      const body = document.createElement("p");
      body.textContent = message.text;
      item.append(meta, body);
      list.append(item);
    }
  }
  section.append(list);
  parent.append(section);
}

function showConversation(record) {
  const conversation = record.conversation || {};
  if (elements.conversationTitle) {
    elements.conversationTitle.textContent = `${text(record.candidateName, "未知候选人")} · ${text(record.appliedPosition, "未识别岗位")}`;
  }
  if (!elements.conversationBody || !elements.conversationDialog) return;
  const body = document.createElement("div");
  body.className = "dialogue-content";

  const meta = document.createElement("div");
  meta.className = "dialogue-meta";
  [record.statusLabel, record.updatedAt, record.source].filter(Boolean).forEach((item) => appendText(meta, item, "detail-badge"));
  if (record.questionCategory) appendText(meta, questionCategoryLabel(record.questionCategory), "detail-badge");
  if (record.questionPoolJudge?.modelEnabled) appendText(meta, "大模型判断", "detail-badge");
  body.append(meta);

  if (record.question || record.normalizedQuestion || record.questionPoolReason) {
    appendDialogueBlock(
      body,
      "用户提问判断",
      [
        record.normalizedQuestion ? `归一化问题：${record.normalizedQuestion}` : "",
        record.question ? `原始问题：${record.question}` : "",
        record.questionCategory ? `类型：${questionCategoryLabel(record.questionCategory)}` : "",
        record.questionPoolReason ? `判断原因：${record.questionPoolReason}` : "",
      ],
      "暂无提问判断"
    );
  }

  const decision = record.agentDecision || {};
  const decisionLines = [
    record.agentWorkflow || decision.workflow ? `工作流：${record.agentWorkflow || decision.workflow}` : "",
    record.agentStage || decision.stage ? `阶段：${record.agentStage || decision.stage}` : "",
    record.agentNextAction || decision.nextAction ? `下一步：${record.agentNextAction || decision.nextAction}` : "",
    decision.screeningReason ? `筛选依据：${decision.screeningReason}` : decision.lastScreening ? `筛选依据：${decision.lastScreening}` : "",
    decision.lastOther ? `候选人最近回复：${decision.lastOther}` : "",
    decision.conversationReview?.summary ? `会话复盘：${decision.conversationReview.summary}` : "",
  ].filter(Boolean);
  const progressLines = (Array.isArray(decision.screeningProgress) ? decision.screeningProgress : [])
    .map((item) => {
      const question = item.question || item.questionId || "";
      const status = item.status || "";
      const answer = item.answerText || "";
      return [question, status, answer ? `答：${answer}` : ""].filter(Boolean).join(" · ");
    })
    .filter(Boolean);
  if (decisionLines.length || progressLines.length) {
    appendDialogueBlock(body, "智能体决策", [...decisionLines, ...progressLines], "暂无决策记录");
  }

  const transcript = buildTranscriptMessages(conversation, record);
  renderChatTranscript(body, transcript.messages, transcript.fallback);

  elements.conversationBody.replaceChildren(body);
  document.documentElement.classList.add("details-dialog-open");
  document.body.classList.add("details-dialog-open");
  elements.conversationDialog.hidden = false;
}

function closeConversation() {
  if (elements.conversationDialog) elements.conversationDialog.hidden = true;
  document.documentElement.classList.remove("details-dialog-open");
  document.body.classList.remove("details-dialog-open");
}

function renderResumeCell(cell, record) {
  const files = Array.isArray(record.resumeFiles) ? record.resumeFiles : [];
  if (!files.length) {
    cell.textContent = "-";
    return;
  }
  const list = document.createElement("ul");
  list.className = "detail-resume-list";
  for (const file of files) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = fileHref(file.fileName);
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = file.fileName;
    item.append(link);
    const size = formatSize(file.size);
    if (size) appendText(item, ` ${size}`, "detail-muted");
    list.append(item);
  }
  cell.append(list);
}

function renderPagination(totalRows, totalPages) {
  if (!elements.pagination) return;
  elements.pagination.replaceChildren();

  if (!totalRows) {
    appendText(elements.pagination, "每页 10 条", "detail-muted");
    return;
  }

  const start = (state.page - 1) * state.pageSize + 1;
  const end = Math.min(totalRows, state.page * state.pageSize);
  const info = document.createElement("span");
  info.className = "detail-muted";
  info.textContent = `${start}-${end} / ${totalRows}，每页 ${state.pageSize} 条`;
  elements.pagination.append(info);

  if (totalPages <= 1) return;

  const controls = document.createElement("div");
  controls.className = "details-pagination-controls";

  const addPageButton = (label, page, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `details-page-btn${options.active ? " is-active" : ""}`;
    button.textContent = label;
    button.disabled = Boolean(options.disabled);
    button.addEventListener("click", () => {
      if (button.disabled || state.page === page) return;
      state.page = page;
      updateUrlState();
      renderTable();
    });
    controls.append(button);
  };

  addPageButton("上一页", Math.max(1, state.page - 1), { disabled: state.page <= 1 });

  const pageNumbers =
    totalPages <= 7
      ? Array.from({ length: totalPages }, (_, index) => index + 1)
      : [...new Set([1, state.page - 1, state.page, state.page + 1, totalPages])]
          .filter((page) => page >= 1 && page <= totalPages)
          .sort((a, b) => a - b);
  let previousPage = 0;
  for (const page of pageNumbers) {
    if (previousPage && page - previousPage > 1) {
      const ellipsis = document.createElement("span");
      ellipsis.className = "details-page-ellipsis";
      ellipsis.textContent = "...";
      controls.append(ellipsis);
    }
    addPageButton(String(page), page, { active: page === state.page });
    previousPage = page;
  }

  addPageButton("下一页", Math.min(totalPages, state.page + 1), { disabled: state.page >= totalPages });
  elements.pagination.append(controls);
}

function renderTable() {
  const rows = state.records.filter(recordMatchesFilters);
  const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  const requestedPage = state.page;
  state.page = Math.min(Math.max(1, state.page), totalPages);
  if (state.page !== requestedPage) updateUrlState();
  elements.count.textContent = `共 ${rows.length} 条记录 · 第 ${state.page}/${totalPages} 页`;
  const dateLabel = dateStateLabel(state.date);
  elements.activeFilter.textContent = `${dateLabel} · ${metricLabel(state.metric)} · ${elements.jobFilter.value || "全部岗位"} · ${
    elements.statusFilter.selectedOptions[0]?.textContent || "全部状态"
  }`;

  elements.activeFilter.textContent = `${detailModeLabel()} · ${elements.activeFilter.textContent}`;

  if (!rows.length) {
    renderPagination(0, 1);
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "没有匹配的处理记录";
    row.append(cell);
    elements.tableBody.replaceChildren(row);
    return;
  }

  renderPagination(rows.length, totalPages);
  const visibleRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  elements.tableBody.replaceChildren(
    ...visibleRows.map((record) => {
      const row = document.createElement("tr");

      const nameCell = document.createElement("td");
      const nameBox = document.createElement("div");
      nameBox.className = "detail-name";
      const name = document.createElement("strong");
      name.textContent = text(record.candidateName, "未知候选人");
      nameBox.append(name);
      appendText(nameBox, record.typeLabel || record.type, "detail-muted");
      nameCell.append(nameBox);

      const jobCell = document.createElement("td");
      jobCell.textContent = text(record.appliedPosition, "未识别岗位");

      const statusCell = document.createElement("td");
      appendText(statusCell, record.statusLabel || "已处理", "detail-badge");

      const timeCell = document.createElement("td");
      timeCell.textContent = text(record.updatedAt);

      const questionCell = document.createElement("td");
      renderQuestionCell(questionCell, record);

      const sourceCell = document.createElement("td");
      const sourceBox = document.createElement("div");
      sourceBox.className = "detail-text-block";
      appendText(sourceBox, record.source || "-");
      if (record.action) appendText(sourceBox, record.action, "detail-muted");
      sourceCell.append(sourceBox);

      const resumeCell = document.createElement("td");
      renderResumeCell(resumeCell, record);

      row.append(nameCell, jobCell, statusCell, timeCell, questionCell, sourceCell, resumeCell);
      return row;
    })
  );
}

async function loadDetails() {
  try {
    const endpoint =
      state.platform === "zhilian"
        ? "./api/zhilian-automation/details"
        : state.platform === "51job"
        ? "./api/51-automation/details"
        : "./api/boss-automation/details";
    const query = new URLSearchParams({
      date: state.date,
      mode: state.mode,
      metric: state.metric,
    });
    query.set("accountId", state.accountId || "all");
    const response = await fetch(`${endpoint}?${query.toString()}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "加载失败");

    state.platform = normalizeDetailPlatform(payload.platform || state.platform);
    state.date = normalizeDateState(payload.date || state.date);
    syncDateControl();
    state.metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
    state.records = Array.isArray(payload.records) ? payload.records : [];
    const metricKeys = new Set(visibleMetricsForMode().map((metric) => metric.key));
    if (!metricKeys.has(state.metric)) state.metric = defaultMetricForMode(state.mode);
    if (elements.title) elements.title.textContent = `${detailPlatformLabel()}处理明细`;

    const dateLabel = dateStateLabel(state.date);
    elements.subtitle.textContent = `${detailPlatformLabel()} · ${dateLabel} ${detailModeLabel()}记录，更新 ${payload.updatedAt || "-"}`;
    renderOptions(
      elements.jobFilter,
      (payload.filters?.jobs || []).map((job) => ({ key: job, label: job })),
      "全部岗位"
    );
    renderOptions(elements.statusFilter, visibleStatusesForMode(payload.filters?.statuses || []), "全部状态");
    renderOptions(elements.typeFilter, payload.filters?.types || [], "全部类型");
    renderMetrics();
    renderTable();
  } catch (error) {
    elements.subtitle.textContent = error.message || `加载${detailPlatformLabel()}明细失败`;
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = elements.subtitle.textContent;
    row.append(cell);
    elements.tableBody.replaceChildren(row);
  }
}

function resetPageAndRender() {
  state.page = 1;
  updateUrlState();
  renderTable();
}

[elements.searchInput, elements.jobFilter, elements.statusFilter, elements.typeFilter].forEach((input) => {
  input.addEventListener("input", resetPageAndRender);
  input.addEventListener("change", resetPageAndRender);
});

elements.resetBtn.addEventListener("click", () => {
  state.metric = defaultMetricForMode(state.mode);
  state.page = 1;
  elements.searchInput.value = "";
  elements.jobFilter.value = "";
  elements.statusFilter.value = "";
  elements.typeFilter.value = "";
  updateUrlState();
  loadDetails();
});

elements.dateInput?.addEventListener("change", () => {
  const nextDate = normalizeDateKey(elements.dateInput.value);
  if (!nextDate) return;
  state.date = datesToDateState([...dateStateToDates(state.date), nextDate]);
  state.page = 1;
  updateUrlState();
  loadDetails();
});

elements.todayBtn?.addEventListener("click", () => {
  state.date = getChinaDateKey();
  state.page = 1;
  updateUrlState();
  loadDetails();
});

elements.allDatesBtn?.addEventListener("click", () => {
  state.date = "all";
  state.page = 1;
  updateUrlState();
  loadDetails();
});

elements.conversationCloseBtn?.addEventListener("click", closeConversation);
elements.conversationDialog?.addEventListener("click", (event) => {
  if (event.target === elements.conversationDialog) closeConversation();
});
elements.conversationDialog?.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
elements.conversationDialog?.addEventListener("touchmove", (event) => event.stopPropagation(), { passive: true });

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeConversation();
});

loadDetails();
