(function () {
  const api = window.InterviewCenterApi;
  const state = window.InterviewCenterState;

  const els = {
    connectionPill: document.querySelector("#connectionPill"),
    connectBtn: document.querySelector("#connectBtn"),
    disconnectBtn: document.querySelector("#disconnectBtn"),
    syncBtn: document.querySelector("#syncBtn"),
    backHomeBtn: document.querySelector("#backHomeBtn"),
    refreshSessionsBtn: document.querySelector("#refreshSessionsBtn"),
    statusFilter: document.querySelector("#statusFilter"),
    workspaceGrid: document.querySelector(".workspace-grid"),
    eventList: document.querySelector("#eventList"),
    matchList: document.querySelector("#matchList"),
    workspaceTitle: document.querySelector("#workspaceTitle"),
    workspaceStatus: document.querySelector("#workspaceStatus"),
    workspaceBody: document.querySelector("#workspaceBody"),
    prepareBtn: document.querySelector("#prepareBtn"),
    openDocBtn: document.querySelector("#openDocBtn"),
    backfillBtn: document.querySelector("#backfillBtn"),
    confirmBtn: document.querySelector("#confirmBtn"),
    logList: document.querySelector("#logList"),
    metricTotal: document.querySelector("#metricTotal"),
    metricMatched: document.querySelector("#metricMatched"),
    metricPrepared: document.querySelector("#metricPrepared"),
    metricBackfill: document.querySelector("#metricBackfill"),
  };

  const statusLabels = {
    synced: "已同步",
    non_interview: "非面试",
    ignored: "已忽略",
    needs_match: "待匹配",
    needs_confirmation: "需确认",
    matched: "已绑定",
    questions_generated: "已生成问题",
    prepared: "已准备",
    prepared_local: "本地准备",
    needs_review: "待复核",
    completed: "已完成",
  };

  const columnStorageKey = "interviewCenter.columnWidths.v1";
  const columnMins = {
    calendar: 280,
    match: 340,
    workspace: 420,
  };
  const backfillGraceSeconds = 10 * 60;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(seconds) {
    if (!seconds) return "-";
    return new Date(Number(seconds) * 1000).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function backfillAvailability(session) {
    const availableAt = Number(session?.endTime || session?.startTime || 0) + backfillGraceSeconds;
    if (!availableAt) return { ready: false, label: "面试结束后可回灌" };
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
      ready: nowSeconds >= availableAt,
      availableAt,
      label: nowSeconds >= availableAt ? "读取纪要并回灌" : `面试结束后可回灌 ${formatTime(availableAt)}`,
    };
  }

  function setBusy(flag, text = "") {
    state.busy = flag;
    [els.connectBtn, els.disconnectBtn, els.syncBtn, els.refreshSessionsBtn, els.prepareBtn, els.backfillBtn, els.confirmBtn].forEach((button) => {
      if (button) button.disabled = flag || button.dataset.disabledByState === "true";
    });
    if (text) els.connectionPill.textContent = text;
  }

  function selectedSession() {
    return state.sessions.find((item) => item.id === state.selectedId) || null;
  }

  function filteredSessions() {
    return state.sessions.filter((item) => !state.statusFilter || item.status === state.statusFilter);
  }

  function statusClass(status) {
    if (status === "prepared" || status === "completed") return "is-good";
    if (status === "needs_confirmation" || status === "needs_match" || status === "prepared_local") return "is-warn";
    if (status === "needs_review") return "is-review";
    return "";
  }

  function updateConnectionUi() {
    els.connectionPill.className = `connection-pill ${state.connected ? "is-connected" : state.configured ? "is-ready" : "is-error"}`;
    if (!state.configured) {
      els.connectionPill.textContent = "飞书应用未配置";
    } else if (state.connected) {
      const name = state.userInfo?.name || state.userInfo?.en_name || "已授权";
      els.connectionPill.textContent = `飞书已连接：${name}`;
    } else {
      els.connectionPill.textContent = "飞书未授权";
    }
    els.connectBtn.hidden = state.connected;
    els.disconnectBtn.hidden = !state.connected;
    els.syncBtn.disabled = !state.connected || state.busy;
    els.syncBtn.dataset.disabledByState = !state.connected ? "true" : "false";
  }

  function renderMetrics() {
    const sessions = state.sessions;
    els.metricTotal.textContent = sessions.length;
    els.metricMatched.textContent = sessions.filter((item) => item.resumeId).length;
    els.metricPrepared.textContent = sessions.filter((item) => ["prepared", "prepared_local", "needs_review", "completed"].includes(item.status)).length;
    els.metricBackfill.textContent = sessions.filter((item) => item.status === "needs_review").length;
  }

  function renderEvents() {
    const sessions = filteredSessions();
    if (!sessions.length) {
      els.eventList.innerHTML = '<div class="empty-state">当前筛选下暂无面试日程</div>';
      return;
    }
    els.eventList.innerHTML = sessions
      .map(
        (item) => `
          <button class="event-row ${item.id === state.selectedId ? "is-active" : ""}" type="button" data-select-session="${escapeHtml(item.id)}">
            <span class="event-time">${escapeHtml(formatTime(item.startTime))}</span>
            <strong>${escapeHtml(item.title || "未命名日程")}</strong>
            <small>${escapeHtml(item.matchedResume?.name || item.resume?.name || item.matchMessage || "未绑定候选人")}</small>
            <em class="status-badge ${statusClass(item.status)}">${escapeHtml(statusLabels[item.status] || item.status || "-")}</em>
          </button>
        `
      )
      .join("");
  }

  function renderMatches() {
    const sessions = filteredSessions();
    if (!sessions.length) {
      els.matchList.innerHTML = '<div class="empty-state">暂无候选人匹配记录</div>';
      return;
    }
    els.matchList.innerHTML = sessions
      .map((item) => {
        const matchedName = item.resume?.name || item.matchedResume?.name || "";
        const candidates = (item.matchCandidates || [])
          .slice(0, 3)
          .map(
            (candidate) => `
              <div class="candidate-option">
                <div>
                  <strong>${escapeHtml(candidate.name || "-")}</strong>
                  <small>${escapeHtml(candidate.jobType || "")}</small>
                  <span>${escapeHtml(candidate.source || "")}</span>
                </div>
                <button class="ghost-btn small" type="button" data-bind-session="${escapeHtml(item.id)}" data-resume-id="${escapeHtml(candidate.resumeId)}">绑定</button>
              </div>
            `
          )
          .join("");
        return `
          <article class="match-card ${item.id === state.selectedId ? "is-active" : ""}">
            <button type="button" class="match-main" data-select-session="${escapeHtml(item.id)}">
              <span>${escapeHtml(formatTime(item.startTime))}</span>
              <strong>${escapeHtml(matchedName || item.title || "待匹配日程")}</strong>
              <small>${escapeHtml(item.resume?.jobType || item.matchedResume?.jobType || item.title || "")}</small>
              <em>匹配分 ${escapeHtml(item.match?.score ?? "-")}</em>
            </button>
            ${item.status === "needs_confirmation" || item.status === "needs_match" ? `<div class="candidate-options">${candidates || '<span class="empty-inline">没有候选建议</span>'}</div>` : ""}
          </article>
        `;
      })
      .join("");
  }

  function questionHtml(session) {
    const questions = session.questionSet?.questions || [];
    if (!questions.length) return '<div class="empty-state">尚未生成面试问题</div>';
    return questions
      .map(
        (item, index) => `
          <article class="question-item">
            <div class="question-index">${index + 1}</div>
            <div>
              <strong>${escapeHtml(item.ability || "能力项")}</strong>
              <p>${escapeHtml(item.question || "")}</p>
              <small>追问：${escapeHtml((item.followUps || []).join("；") || "-")}</small>
              <small>强信号：${escapeHtml(item.strongSignal || "-")}</small>
              <small>风险信号：${escapeHtml(item.riskSignal || "-")}</small>
            </div>
          </article>
        `
      )
      .join("");
  }

  function evaluationHtml(session) {
    const evaluation = session.interviewEvaluation;
    if (!evaluation) return '<div class="empty-state">尚未回灌面试结果</div>';
    const profile = evaluation.abilityProfile || [];
    return `
      <div class="evaluation-summary">
        <strong>总体建议：${escapeHtml(evaluation.overallRecommendation || "待复核")}</strong>
        <p>${escapeHtml(evaluation.summary || "")}</p>
      </div>
      ${profile
        .map(
          (item) => `
            <article class="ability-row">
              <span>${escapeHtml(item.signal || "待复核")}</span>
              <div>
                <strong>${escapeHtml(item.ability || "")}</strong>
                <p>${escapeHtml(item.answerSummary || "")}</p>
                <small>${escapeHtml(item.reason || "")}</small>
              </div>
            </article>
          `
        )
        .join("")}
    `;
  }

  function renderWorkspace() {
    const session = selectedSession();
    if (!session) {
      els.workspaceTitle.textContent = "面试工作区";
      els.workspaceStatus.textContent = "未选择";
      els.workspaceStatus.className = "status-badge";
      els.workspaceBody.innerHTML = '<div class="empty-state large">从左侧选择一个面试日程</div>';
      [els.prepareBtn, els.openDocBtn, els.backfillBtn, els.confirmBtn].forEach((button) => {
        button.disabled = true;
        button.dataset.disabledByState = "true";
      });
      els.prepareBtn.textContent = "生成问题并同步飞书";
      els.backfillBtn.textContent = "读取纪要并回灌";
      return;
    }

    els.workspaceTitle.textContent = session.resume?.name || session.matchedResume?.name || session.title || "面试日程";
    els.workspaceStatus.textContent = statusLabels[session.status] || session.status || "-";
    els.workspaceStatus.className = `status-badge ${statusClass(session.status)}`;
    els.prepareBtn.textContent = state.busyAction === "prepare" ? "生成中..." : "生成问题并同步飞书";
    els.prepareBtn.disabled = !session.resumeId || state.busy;
    els.prepareBtn.dataset.disabledByState = !session.resumeId ? "true" : "false";
    els.openDocBtn.disabled = !session.feishuDoc?.url || state.busy;
    els.openDocBtn.dataset.disabledByState = !session.feishuDoc?.url ? "true" : "false";
    const backfill = backfillAvailability(session);
    let backfillDisabledByState = "";
    if (!session.resumeId) backfillDisabledByState = "先绑定候选人";
    else if (!session.feishuDoc?.documentId) backfillDisabledByState = "先生成面试文档";
    else if (!backfill.ready) backfillDisabledByState = backfill.label;
    els.backfillBtn.textContent = backfillDisabledByState || "读取纪要并回灌";
    els.backfillBtn.disabled = Boolean(backfillDisabledByState) || state.busy;
    els.backfillBtn.dataset.disabledByState = backfillDisabledByState ? "true" : "false";
    els.backfillBtn.title = backfillDisabledByState || "";
    els.confirmBtn.disabled = !session.interviewEvaluation || state.busy;
    els.confirmBtn.dataset.disabledByState = !session.interviewEvaluation ? "true" : "false";
    const docLinkText = session.feishuDoc?.contentSynced === false ? "已创建，正文未同步" : "已创建";
    const docErrorHtml =
      session.feishuDoc?.contentSynced === false && session.feishuDoc?.contentError
        ? `<small class="detail-error">${escapeHtml(session.feishuDoc.contentError)}</small>`
        : "";

    els.workspaceBody.innerHTML = `
      <section class="detail-section">
        <h3>日程信息</h3>
        <dl class="detail-grid">
          <div><dt>时间</dt><dd>${escapeHtml(formatTime(session.startTime))}</dd></div>
          <div><dt>标题</dt><dd>${escapeHtml(session.title || "-")}</dd></div>
          <div><dt>候选人</dt><dd>${escapeHtml(session.resume?.name || session.matchedResume?.name || "未绑定")}</dd></div>
          <div><dt>岗位</dt><dd>${escapeHtml(session.resume?.jobType || session.matchedResume?.jobType || "-")}</dd></div>
          <div><dt>飞书文档</dt><dd>${session.feishuDoc?.url ? `<a href="${escapeHtml(session.feishuDoc.url)}" target="_blank" rel="noreferrer">${escapeHtml(docLinkText)}</a>${docErrorHtml}` : "未创建"}</dd></div>
          <div><dt>台账</dt><dd>${escapeHtml(session.bitable?.skipped ? "未配置" : session.bitable?.recordId ? "已同步" : "未同步")}</dd></div>
        </dl>
      </section>
      <section class="detail-section">
        <h3>面试问题</h3>
        ${questionHtml(session)}
      </section>
      <section class="detail-section">
        <h3>面试回灌</h3>
        ${evaluationHtml(session)}
      </section>
    `;
  }

  function renderLogs() {
    if (!state.logs.length) {
      els.logList.textContent = "暂无日志";
      return;
    }
    els.logList.innerHTML = state.logs
      .slice(0, 30)
      .map(
        (log) => `
          <div class="log-row is-${escapeHtml(log.level || "info")}">
            <time>${escapeHtml(new Date(log.createdAt || Date.now()).toLocaleString("zh-CN"))}</time>
            <span>${escapeHtml(log.message || "")}</span>
          </div>
        `
      )
      .join("");
  }

  function renderAll() {
    updateConnectionUi();
    renderMetrics();
    renderEvents();
    renderMatches();
    renderWorkspace();
    renderLogs();
  }

  function applyColumnWidths(widths = {}) {
    if (!els.workspaceGrid) return;
    if (widths.calendar) els.workspaceGrid.style.setProperty("--calendar-col", `${Math.round(widths.calendar)}px`);
    if (widths.match) els.workspaceGrid.style.setProperty("--match-col", `${Math.round(widths.match)}px`);
    if (widths.workspace) els.workspaceGrid.style.setProperty("--workspace-col", `${Math.round(widths.workspace)}px`);
  }

  function loadColumnWidths() {
    try {
      const widths = JSON.parse(localStorage.getItem(columnStorageKey) || "{}");
      applyColumnWidths(widths);
    } catch {}
  }

  function saveColumnWidths(widths) {
    try {
      localStorage.setItem(columnStorageKey, JSON.stringify(widths));
    } catch {}
  }

  function currentColumnWidths() {
    const calendar = els.workspaceGrid?.querySelector(".calendar-panel")?.getBoundingClientRect().width || 0;
    const match = els.workspaceGrid?.querySelector(".match-panel")?.getBoundingClientRect().width || 0;
    const workspace = els.workspaceGrid?.querySelector(".workspace-panel")?.getBoundingClientRect().width || 0;
    return { calendar, match, workspace };
  }

  function resetColumnWidths() {
    if (!els.workspaceGrid) return;
    ["--calendar-col", "--match-col", "--workspace-col"].forEach((name) => els.workspaceGrid.style.removeProperty(name));
    try {
      localStorage.removeItem(columnStorageKey);
    } catch {}
  }

  function initColumnResizers() {
    if (!els.workspaceGrid) return;
    loadColumnWidths();
    els.workspaceGrid.querySelectorAll(".column-resizer").forEach((handle) => {
      handle.addEventListener("dblclick", resetColumnWidths);
      handle.addEventListener("pointerdown", (event) => {
        if (window.innerWidth <= 1180) return;
        const type = handle.dataset.resizer;
        const startX = event.clientX;
        const start = currentColumnWidths();
        handle.classList.add("is-dragging");
        handle.setPointerCapture?.(event.pointerId);

        const onMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX;
          const next = { ...start };
          if (type === "calendar-match") {
            const total = start.calendar + start.match;
            next.calendar = Math.max(columnMins.calendar, Math.min(total - columnMins.match, start.calendar + delta));
            next.match = total - next.calendar;
          } else if (type === "match-workspace") {
            const total = start.match + start.workspace;
            next.match = Math.max(columnMins.match, Math.min(total - columnMins.workspace, start.match + delta));
            next.workspace = total - next.match;
          }
          applyColumnWidths(next);
          saveColumnWidths(next);
        };

        const onUp = () => {
          handle.classList.remove("is-dragging");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      });
    });
  }

  async function loadStatus() {
    const payload = await api.status();
    state.configured = Boolean(payload.configured);
    state.connected = Boolean(payload.connected);
    state.bitableConfigured = Boolean(payload.bitableConfigured);
    state.userInfo = payload.userInfo || null;
    renderAll();
  }

  async function loadSessions() {
    const payload = await api.sessions();
    state.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    state.logs = Array.isArray(payload.logs) ? payload.logs : [];
    if (!state.selectedId && state.sessions.length) state.selectedId = state.sessions[0].id;
    if (state.selectedId && !state.sessions.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.sessions[0]?.id || "";
    }
    renderAll();
  }

  async function runAction(label, task, options = {}) {
    try {
      state.busyAction = options.busyAction || "";
      setBusy(true, label);
      renderWorkspace();
      const payload = await task();
      if (payload.sessions) state.sessions = payload.sessions;
      if (payload.session) {
        const index = state.sessions.findIndex((item) => item.id === payload.session.id);
        if (index >= 0) state.sessions[index] = payload.session;
        else state.sessions.unshift(payload.session);
        state.selectedId = payload.session.id;
      }
      if (payload.logs) state.logs = payload.logs;
      await loadStatus().catch(() => {});
      renderAll();
    } catch (error) {
      els.connectionPill.textContent = error.message || "操作失败";
      els.connectionPill.className = "connection-pill is-error";
    } finally {
      state.busyAction = "";
      setBusy(false);
      updateConnectionUi();
      renderAll();
    }
  }

  function bindEvents() {
    els.backHomeBtn.addEventListener("click", () => {
      location.href = "./index.html";
    });
    els.connectBtn.addEventListener("click", () =>
      runAction("正在打开飞书授权", async () => {
        const payload = await api.authUrl();
        location.href = payload.authUrl;
        return {};
      })
    );
    els.disconnectBtn.addEventListener("click", () =>
      runAction("正在断开飞书", async () => {
        await api.disconnect();
        state.connected = false;
        state.userInfo = null;
        return {};
      })
    );
    els.syncBtn.addEventListener("click", () => runAction("正在同步飞书日历", () => api.sync()));
    els.refreshSessionsBtn.addEventListener("click", () => runAction("正在刷新面试中心", () => api.sessions()));
    els.statusFilter.addEventListener("change", () => {
      state.statusFilter = els.statusFilter.value;
      renderAll();
    });
    els.eventList.addEventListener("click", handleDelegatedClick);
    els.matchList.addEventListener("click", handleDelegatedClick);
    els.prepareBtn.addEventListener("click", () => {
      const session = selectedSession();
      if (session) runAction("正在生成面试题并同步飞书", () => api.prepare(session.id, true), { busyAction: "prepare" });
    });
    els.openDocBtn.addEventListener("click", () => {
      const url = selectedSession()?.feishuDoc?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
    els.backfillBtn.addEventListener("click", () => {
      const session = selectedSession();
      if (session) runAction("正在读取飞书记录并回灌", () => api.backfill(session.id));
    });
    els.confirmBtn.addEventListener("click", () => {
      const session = selectedSession();
      if (session) runAction("正在确认评估", () => api.confirm(session.id));
    });
  }

  function handleDelegatedClick(event) {
    const selectButton = event.target.closest("[data-select-session]");
    if (selectButton) {
      state.selectedId = selectButton.dataset.selectSession || "";
      renderAll();
      return;
    }
    const bindButton = event.target.closest("[data-bind-session]");
    if (bindButton) {
      const sessionId = bindButton.dataset.bindSession;
      const resumeId = bindButton.dataset.resumeId;
      runAction("正在绑定候选人", () => api.bind(sessionId, resumeId, false));
    }
  }

  async function init() {
    bindEvents();
    initColumnResizers();
    window.setInterval(() => {
      if (!state.busy) renderWorkspace();
    }, 60000);
    if (new URLSearchParams(location.search).get("feishu") === "connected") {
      els.connectionPill.textContent = "飞书授权成功，正在加载";
    }
    await loadStatus().catch((error) => {
      els.connectionPill.textContent = error.message || "飞书状态读取失败";
      els.connectionPill.className = "connection-pill is-error";
    });
    await loadSessions().catch(() => renderAll());
  }

  init();
})();
