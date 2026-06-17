const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const DEFAULT_CYCLE_DELAY_MS = 15 * 60 * 1000;
const DEFAULT_ACTIVE_START = "06:00";
const DEFAULT_ACTIVE_END = "23:00";
const DEFAULT_MAX_CYCLES = 0;
const PROCESS_TASK_START_TIMEOUT_MS = 30000;
const PROCESS_TASK_POLL_TIMEOUT_MS = 12000;
const PROCESS_TASK_POLL_MS = 5000;
const PROCESS_TASK_MAX_MS = 90 * 60 * 1000;
const PROCESS_TASK_POLL_FAILURE_LIMIT = 12;
const DEFAULT_TARGETS = [
  { platform: "boss", accountId: "boss_a" },
  { platform: "boss", accountId: "boss_b" },
  { platform: "51job", accountId: "boss_a" },
  { platform: "51job", accountId: "boss_b" },
  { platform: "zhilian", accountId: "boss_a" },
  { platform: "zhilian", accountId: "boss_b" },
];

function chinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function chinaTimeText(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function normalizeCount(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizeDelayMinutes(value, fallback = 15) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.min(Math.floor(number), 1440) : fallback;
}

function normalizeCycleLimit(value, fallback = DEFAULT_MAX_CYCLES) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number <= 0) return 0;
  return Math.min(Math.floor(number), 999);
}

function normalizeTimeText(value, fallback) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeTextToMinutes(value) {
  const [hour, minute] = String(value || "00:00").split(":").map((item) => Number(item));
  return hour * 60 + minute;
}

function chinaClockMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function normalizeSchedulerSettings(input = {}, fallback = {}) {
  const fallbackDelayMinutes = normalizeDelayMinutes(
    fallback.cycleDelayMinutes ?? Number(fallback.cycleDelayMs || DEFAULT_CYCLE_DELAY_MS) / 60000,
    15
  );
  const cycleDelayMinutes = normalizeDelayMinutes(
    input.cycleDelayMinutes ?? input.delayMinutes ?? Number(input.cycleDelayMs || 0) / 60000,
    fallbackDelayMinutes
  );
  const activeStart = normalizeTimeText(input.activeStart ?? input.runStart ?? input.startTime, fallback.activeStart || DEFAULT_ACTIVE_START);
  const activeEnd = normalizeTimeText(input.activeEnd ?? input.runEnd ?? input.endTime, fallback.activeEnd || DEFAULT_ACTIVE_END);
  const fallbackMaxCycles = normalizeCycleLimit(
    fallback.maxCycles ?? fallback.totalCycles ?? fallback.cycleLimit ?? DEFAULT_MAX_CYCLES,
    DEFAULT_MAX_CYCLES
  );
  const maxCycles = normalizeCycleLimit(
    input.maxCycles ?? input.totalCycles ?? input.cycleLimit ?? input.maxCycleCount,
    fallbackMaxCycles
  );
  return {
    cycleDelayMinutes,
    cycleDelayMs: cycleDelayMinutes * 60 * 1000,
    activeStart,
    activeEnd,
    maxCycles,
  };
}

function isWithinActiveWindow(settings, date = new Date()) {
  const start = timeTextToMinutes(settings.activeStart);
  const end = timeTextToMinutes(settings.activeEnd);
  if (start === end) return true;
  const current = chinaClockMinutes(date);
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function msUntilActiveWindow(settings, date = new Date()) {
  if (isWithinActiveWindow(settings, date)) return 0;
  const start = date.getTime();
  for (let offset = 60 * 1000; offset <= 48 * 60 * 60 * 1000; offset += 60 * 1000) {
    if (isWithinActiveWindow(settings, new Date(start + offset))) return offset;
  }
  return 15 * 60 * 1000;
}

function sumCountKeys(object, keys) {
  if (!object || typeof object !== "object") return 0;
  return keys.reduce((total, key) => total + normalizeCount(object[key], 0), 0);
}

const REQUESTED_RESUME_COUNT_KEYS = [
  "accepted_requested_resume",
  "knowledge_answered_and_requested_resume",
  "accepted_resume_already_requested",
  "knowledge_answered_resume_already_requested",
];

const DOWNLOADED_RESUME_COUNT_KEYS = [
  "accepted_resume_downloaded",
  "knowledge_answered_resume_downloaded",
  "resume_downloaded",
];

function resultArray(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.result?.results)) return payload.result.results;
  return [];
}

function extractRunStats(payload) {
  const state = payload?.state && typeof payload.state === "object" ? payload.state : {};
  const counts = payload?.counts && typeof payload.counts === "object"
    ? payload.counts
    : state.counts && typeof state.counts === "object"
      ? state.counts
      : {};
  const results = resultArray(payload);
  const processed = normalizeCount(
    state.processedPeople ?? state.processed ?? state.processedRecords ?? payload?.processedPeople,
    results.length
  );
  const requestedResume = normalizeCount(
    state.requestedResume,
    sumCountKeys(counts, REQUESTED_RESUME_COUNT_KEYS)
  );
  const downloadedResume = normalizeCount(
    state.downloadedResume,
    sumCountKeys(counts, DOWNLOADED_RESUME_COUNT_KEYS)
  );
  return {
    processed,
    requestedResume,
    downloadedResume,
    resumeTotal: requestedResume + downloadedResume,
    blocked: normalizeCount(state.blocked, sumCountKeys(counts, ["blocked", "halted_unsent_draft"])),
    message: String(payload?.message || payload?.reply || payload?.result?.message || "").replace(/\s+/g, " ").trim(),
    counts,
    state,
  };
}

function normalizeRecoveredStats(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      recovered: false,
      processed: 0,
      requestedResume: 0,
      downloadedResume: 0,
      counts: {},
      message: "",
      source: "",
    };
  }
  const counts = payload.counts && typeof payload.counts === "object" ? payload.counts : {};
  const processed = normalizeCount(payload.processed ?? payload.processedPeople ?? payload.processedRecords, 0);
  const requestedResume = normalizeCount(
    payload.requestedResume,
    sumCountKeys(counts, REQUESTED_RESUME_COUNT_KEYS)
  );
  const downloadedResume = normalizeCount(
    payload.downloadedResume,
    sumCountKeys(counts, DOWNLOADED_RESUME_COUNT_KEYS)
  );
  return {
    ok: Boolean(payload.ok),
    recovered: Boolean(payload.recovered || processed || requestedResume || downloadedResume),
    processed,
    requestedResume,
    downloadedResume,
    counts,
    message: String(payload.message || "").replace(/\s+/g, " ").trim(),
    source: String(payload.source || ""),
    details: payload.details && typeof payload.details === "object" ? payload.details : null,
  };
}

function detectInterruption(error, payload) {
  const text = [
    error?.message,
    payload?.error,
    payload?.message,
    payload?.reply,
    JSON.stringify(payload || {}),
  ].filter(Boolean).join(" ");
  if (/人机|验证码|captcha|安全验证/i.test(text)) return "human_verification";
  if (/登录|未登录|login/i.test(text)) return "needs_login";
  if (/账号异常|account_abnormal/i.test(text)) return "account_abnormal";
  if (/暂停|停止中|任务已暂停|pause/i.test(text)) return "graceful_stop";
  return "error";
}

function buildLogMessage(entry) {
  const time = entry.timeText || chinaTimeText(new Date(entry.timestamp || Date.now()));
  const label = entry.targetLabel || entry.platformLabel || entry.platform || "自动化";
  if (entry.event === "round_completed") {
    return `${time} ${label} 第${entry.round}轮处理完成，处理 ${entry.processed || 0} 条消息，获取 ${entry.downloadedResume || 0} 个简历，求简历 ${entry.requestedResume || 0} 个，剩余红点 ${entry.remainingUnread ?? "-"}`;
  }
  if (entry.event === "target_interrupted") {
    if (entry.partialStatsRecovered && normalizeCount(entry.partialProcessed, 0) > 0) {
      return `${time} ${label} 处理中断，已恢复中断前进度：处理 ${entry.partialProcessed || 0} 条消息，获取 ${entry.partialDownloadedResume || 0} 个简历，求简历 ${entry.partialRequestedResume || 0} 个，原因：${entry.reason || entry.error || "未知"}`;
    }
    return `${time} ${label} 处理中断，原因：${entry.reason || entry.error || "未知"}`;
  }
  if (entry.event === "target_completed") {
    return `${time} ${label} 处理完成，共处理 ${entry.processed || 0} 条消息，获取 ${entry.downloadedResume || 0} 个简历`;
  }
  if (entry.event === "cycle_completed") {
    return `${time} 第${entry.cycle}轮已经处理完毕，等待下一轮启动中，间隔 ${Math.round((entry.delayMs || 0) / 60000)} 分钟`;
  }
  if (entry.event === "target_browser_ready") {
    return `${time} ${label} 浏览器已登录，等待调度处理`;
  }
  if (entry.event === "target_browser_blocked") {
    return `${time} ${label} 浏览器检查未通过：${entry.reason || entry.error || "未知"}`;
  }
  if (entry.event === "target_browser_failed") {
    return `${time} ${label} 浏览器检查失败：${entry.error || "未知原因"}`;
  }
  if (entry.event === "target_agent_ready") {
    return `${time} ${label} agent 已启动，开始处理消息`;
  }
  if (entry.event === "stop_requested") {
    return `${time} 已请求停止24小时自动运转，当前候选人处理完后关闭对应 agent，浏览器保持打开`;
  }
  if (entry.event === "target_runtime_closed") {
    return `${time} ${label} agent 已关闭，浏览器保持打开`;
  }
  if (entry.event === "target_runtime_close_failed") {
    return `${time} ${label} agent 关闭失败：${entry.error || "未知原因"}`;
  }
  return `${time} ${label} ${entry.message || entry.event || "状态更新"}`;
}

function createAutomation24hScheduler({
  dataDir,
  targets = DEFAULT_TARGETS,
  concurrency = 2,
  maxRoundsPerTarget = 2,
  cycleDelayMs = DEFAULT_CYCLE_DELAY_MS,
  maxTotalPerRound = 40,
  sleep,
  resolveTarget,
  prepareTargetBrowser,
  ensureTargetReady,
  cleanupTarget,
  fetchAgentJson,
  recoverPartialStats,
} = {}) {
  if (!dataDir) throw new Error("automation24h requires dataDir");
  if (typeof sleep !== "function") throw new Error("automation24h requires sleep");
  if (typeof resolveTarget !== "function") throw new Error("automation24h requires resolveTarget");
  if (typeof ensureTargetReady !== "function") throw new Error("automation24h requires ensureTargetReady");
  if (typeof fetchAgentJson !== "function") throw new Error("automation24h requires fetchAgentJson");
  const prepareBrowser = typeof prepareTargetBrowser === "function" ? prepareTargetBrowser : null;
  const cleanupFinishedTarget = typeof cleanupTarget === "function" ? cleanupTarget : async () => null;
  const recoverPartialRunStats = typeof recoverPartialStats === "function" ? recoverPartialStats : null;

  const logDir = path.join(dataDir, "automation-24h-logs");
  const settingsPath = path.join(dataDir, "automation-24h-settings.json");
  let storedSettings = {};
  try {
    storedSettings = fsSync.existsSync(settingsPath) ? JSON.parse(fsSync.readFileSync(settingsPath, "utf8")) : {};
  } catch {
    storedSettings = {};
  }
  let schedulerSettings = normalizeSchedulerSettings(
    storedSettings,
    { cycleDelayMs, activeStart: DEFAULT_ACTIVE_START, activeEnd: DEFAULT_ACTIVE_END }
  );
  const state = {
    ok: true,
    active: false,
    stopping: false,
    stopRequested: false,
    windowPauseRequested: false,
    status: "stopped",
    message: "24小时自动运转未启动",
    runId: "",
    startedAt: "",
    updatedAt: "",
    cycle: 0,
    currentBatch: [],
    nextRunAt: "",
    lastError: "",
    settings: { ...schedulerSettings },
    withinActiveWindow: isWithinActiveWindow(schedulerSettings),
    targets: [],
    summary: {
      running: 0,
      waiting: targets.length,
      preparing: 0,
      browserReady: 0,
      completed: 0,
      stopping: 0,
      failed: 0,
      needsLogin: 0,
      captcha: 0,
      remainingUnread: 0,
      remainingActionable: 0,
    },
  };
  let loopPromise = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function publicSettings() {
    return {
      cycleDelayMinutes: schedulerSettings.cycleDelayMinutes,
      cycleDelayMs: schedulerSettings.cycleDelayMs,
      activeStart: schedulerSettings.activeStart,
      activeEnd: schedulerSettings.activeEnd,
      maxCycles: schedulerSettings.maxCycles,
    };
  }

  function nextActiveAtIso() {
    const waitMs = msUntilActiveWindow(schedulerSettings);
    return waitMs > 0 ? new Date(Date.now() + waitMs).toISOString() : "";
  }

  function materializeTarget(spec) {
    const resolved = resolveTarget(spec);
    return {
      ...resolved,
      id: `${resolved.platform}:${resolved.accountId}`,
      label: `${resolved.platformLabel} ${resolved.accountName}`,
    };
  }

  function publicTarget(spec, patch = {}) {
    const resolved = materializeTarget(spec);
    return {
      id: resolved.id,
      platform: resolved.platform,
      platformLabel: resolved.platformLabel,
      accountId: resolved.accountId,
      accountName: resolved.accountName,
      sourceKey: resolved.sourceKey,
      label: resolved.label,
      cdpPort: resolved.cdpPort || 0,
      agentPort: resolved.agentPort || 0,
      status: "waiting",
      browserReady: false,
      agentReady: false,
      round: 0,
      processed: 0,
      requestedResume: 0,
      downloadedResume: 0,
      remainingUnread: null,
      remainingActionable: null,
      lastMessage: "",
      error: "",
      updatedAt: nowIso(),
      ...patch,
    };
  }

  function resetTargets() {
    state.targets = targets.map((spec) => publicTarget(spec));
  }

  function updateSummary() {
    const rows = state.targets || [];
    state.settings = publicSettings();
    state.withinActiveWindow = isWithinActiveWindow(schedulerSettings);
    state.summary = {
      running: rows.filter((item) => item.status === "running").length,
      waiting: rows.filter((item) => item.status === "waiting" || item.status === "preparing" || item.status === "browser_ready").length,
      preparing: rows.filter((item) => item.status === "preparing").length,
      browserReady: rows.filter((item) => item.status === "browser_ready").length,
      completed: rows.filter((item) => item.status === "completed").length,
      stopping: rows.filter((item) => item.status === "stopping").length,
      failed: rows.filter((item) => item.status === "failed" || item.status === "interrupted" || item.status === "account_abnormal").length,
      needsLogin: rows.filter((item) => item.status === "needs_login").length,
      captcha: rows.filter((item) => item.status === "captcha").length,
      remainingUnread: rows.reduce((sum, item) => sum + normalizeCount(item.remainingUnread, 0), 0),
      remainingActionable: rows.reduce((sum, item) => sum + normalizeCount(item.remainingActionable, 0), 0),
    };
    state.currentBatch = rows
      .filter((item) => item.status === "running" || item.status === "stopping")
      .map((item) => ({
        id: item.id,
        label: item.label,
        platform: item.platform,
        accountId: item.accountId,
        round: item.round,
        status: item.status,
      }));
    state.updatedAt = nowIso();
  }

  function setTarget(id, patch) {
    const item = state.targets.find((target) => target.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: nowIso() });
    updateSummary();
    return item;
  }

  async function appendLog(entry) {
    const timestamp = entry.timestamp || nowIso();
    const payload = {
      timestamp,
      timeText: entry.timeText || chinaTimeText(new Date(timestamp)),
      runId: state.runId,
      cycle: state.cycle,
      ...entry,
    };
    payload.message = payload.message || buildLogMessage(payload);
    await fs.mkdir(logDir, { recursive: true });
    const filePath = path.join(logDir, `${chinaDateKey(new Date(timestamp))}.jsonl`);
    await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
    return payload;
  }

  async function saveSettings() {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(settingsPath, `${JSON.stringify(publicSettings(), null, 2)}\n`, "utf8");
  }

  async function updateSettings(input = {}) {
    schedulerSettings = normalizeSchedulerSettings(input, schedulerSettings);
    updateSummary();
    await saveSettings();
    await appendLog({
      event: "settings_updated",
      settings: publicSettings(),
      message: `${chinaTimeText()} 24小时自动运转设置已更新：等待 ${schedulerSettings.cycleDelayMinutes} 分钟，运行 ${schedulerSettings.activeStart}-${schedulerSettings.activeEnd}，总轮数 ${schedulerSettings.maxCycles || "不限"}`,
    });
    return status();
  }

  async function observeTarget(target) {
    try {
      const { payload } = await fetchAgentJson(target.sourceKey, "/api/automation-observe", { timeoutMs: 12000 });
      const remaining = payload.remaining && typeof payload.remaining === "object" ? payload.remaining : {};
      return {
        ok: Boolean(payload.ok),
        busy: Boolean(payload.busy),
        remainingUnread: remaining.unreadBadgeCount ?? payload.unread?.count ?? null,
        remainingActionable: remaining.actionableCount ?? remaining.unreadBadgeCount ?? payload.unread?.count ?? null,
        payload,
      };
    } catch (error) {
      return { ok: false, error: error.message || "观察剩余消息失败" };
    }
  }

  async function pauseTarget(target, paused, reason) {
    return fetchAgentJson(target.sourceKey, "/api/pause", {
      method: "POST",
      body: { paused: Boolean(paused), pause: Boolean(paused), reason },
      timeoutMs: 30000,
    }).catch((error) => ({ error: error.message || "暂停信号发送失败" }));
  }

  function targetMaxTotalPerRound(target) {
    if (target.platform === "zhilian") {
      const configuredLimit = Number(process.env.AUTOMATION_24H_ZHILIAN_MAX_TOTAL || 0);
      if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
        return Math.max(1, Math.min(maxTotalPerRound, Math.floor(configuredLimit)));
      }
    }
    return maxTotalPerRound;
  }

  function targetProcessRequest(target) {
    const maxTotal = targetMaxTotalPerRound(target);
    if (target.platform === "51job") {
      return {
        path: "/api/51job/process-messages",
        body: { accountId: target.accountId, maxTotal },
        timeoutMs: 5400000,
      };
    }
    if (target.platform === "zhilian") {
      return {
        path: "/api/zhilian/process-messages",
        body: { accountId: target.accountId, maxTotal },
        timeoutMs: 5400000,
      };
    }
    return {
      path: "/api/recruiter/process-messages",
      body: { accountId: target.accountId, maxTotal },
      timeoutMs: 5400000,
    };
  }

  function shouldRunSecondRound(observed) {
    if (!observed?.ok || observed.busy) return false;
    return normalizeCount(observed.remainingUnread, 0) > 0 || normalizeCount(observed.remainingActionable, 0) > 0;
  }

  function shouldRunBossConfirmRound(target, round, roundResult, observed) {
    if (target?.platform !== "boss" || round !== 1) return false;
    if (observed?.busy) return false;
    return normalizeCount(roundResult?.stats?.processed, 0) > 0;
  }

  function nextRoundDecision(target, round, roundResult, observed) {
    if (round >= maxRoundsPerTarget) return { run: false, reason: "max_rounds_reached" };
    if (shouldRunSecondRound(observed)) return { run: true, reason: "remaining_messages" };
    if (shouldRunBossConfirmRound(target, round, roundResult, observed)) {
      return { run: true, reason: "boss_confirm_after_processed" };
    }
    return { run: false, reason: observed?.ok ? "no_remaining_messages" : "observe_failed" };
  }

  function processTaskRoutes(target) {
    if (target?.platform === "boss") {
      return {
        label: "BOSS",
        startPath: "/api/recruiter/process-messages/start",
        taskPath: "/api/recruiter/process-messages/task",
        cancelPath: "/api/recruiter/process-messages/cancel",
      };
    }
    if (target?.platform === "51job") {
      return {
        label: "51",
        startPath: "/api/51job/process-messages/start",
        taskPath: "/api/51job/process-messages/task",
        cancelPath: "/api/51job/process-messages/cancel",
      };
    }
    if (target?.platform === "zhilian") {
      return {
        label: "Zhilian",
        startPath: "/api/zhilian/process-messages/start",
        taskPath: "/api/zhilian/process-messages/task",
        cancelPath: "/api/zhilian/process-messages/cancel",
      };
    }
    return null;
  }

  function browserStatusFromResult(result = {}) {
    const item = result || {};
    if (item.captcha) return "captcha";
    if (item.accountAbnormal) return "account_abnormal";
    if (item.needsLogin) return "needs_login";
    return "browser_ready";
  }

  function browserStatusMessage(status) {
    if (status === "browser_ready") return "浏览器已登录，等待调度处理";
    if (status === "needs_login") return "账号未登录，需要人工登录";
    if (status === "captcha") return "检测到人机验证，需要人工处理";
    if (status === "account_abnormal") return "账号异常，需要人工处理";
    return "浏览器检查完成";
  }

  function blockedReasonFromStatus(status) {
    if (status === "needs_login") return "needs_login";
    if (status === "captcha") return "human_verification";
    if (status === "account_abnormal") return "account_abnormal";
    return status || "blocked";
  }

  async function prepareOneBrowser(spec) {
    const target = materializeTarget(spec);
    setTarget(target.id, {
      status: "preparing",
      round: 0,
      error: "",
      browserReady: false,
      agentReady: false,
      cdpPort: target.cdpPort || 0,
      agentPort: target.agentPort || 0,
      lastMessage: "正在打开浏览器并检查登录状态",
    });
    try {
      const result = await prepareBrowser(target);
      const status = browserStatusFromResult(result);
      const browserReady = status === "browser_ready";
      setTarget(target.id, {
        status,
        browserReady,
        agentReady: false,
        cdpPort: result?.cdpPort || target.cdpPort || 0,
        agentPort: target.agentPort || 0,
        page: result?.page || null,
        authenticated: Boolean(result?.authenticated),
        error: browserReady ? "" : result?.error || "",
        lastMessage: browserStatusMessage(status),
      });
      await appendLog({
        event: browserReady ? "target_browser_ready" : "target_browser_blocked",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
        status,
        reason: browserReady ? "" : blockedReasonFromStatus(status),
        error: result?.error || "",
      });
      return browserReady ? spec : null;
    } catch (error) {
      setTarget(target.id, {
        status: "failed",
        browserReady: false,
        agentReady: false,
        error: error.message || "浏览器检查失败",
        lastMessage: "浏览器检查失败",
      });
      await appendLog({
        event: "target_browser_failed",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
        error: error.message || "浏览器检查失败",
      });
      return null;
    }
  }

  async function prepareBrowsersForCycle() {
    if (!prepareBrowser) return targets.slice();
    state.message = `第${state.cycle}大轮：正在打开浏览器并检查登录状态`;
    updateSummary();
    await appendLog({
      event: "cycle_browser_preparing",
      message: `${chinaTimeText()} 第${state.cycle}大轮开始检查浏览器登录状态`,
    });

    const readySpecs = [];
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), targets.length);
    async function worker() {
      while (!state.stopRequested && nextIndex < targets.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const ready = await prepareOneBrowser(targets[currentIndex]);
        if (ready) readySpecs.push({ index: currentIndex, spec: ready });
      }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    readySpecs.sort((left, right) => left.index - right.index);
    const orderedReadySpecs = readySpecs.map((item) => item.spec);
    state.message = `第${state.cycle}大轮：浏览器检查完成，就绪 ${orderedReadySpecs.length} 个，开始处理消息`;
    updateSummary();
    return orderedReadySpecs;
  }

  async function waitForActiveWindow() {
    while (!state.stopRequested && !isWithinActiveWindow(schedulerSettings)) {
      const waitMs = msUntilActiveWindow(schedulerSettings);
      state.status = "outside_window";
      state.message = `当前不在运行时间段 ${schedulerSettings.activeStart}-${schedulerSettings.activeEnd}，等待到运行时间再继续`;
      state.nextRunAt = new Date(Date.now() + waitMs).toISOString();
      updateSummary();
      await appendLog({
        event: "outside_window_waiting",
        delayMs: waitMs,
        settings: publicSettings(),
        message: `${chinaTimeText()} 当前不在运行时间段 ${schedulerSettings.activeStart}-${schedulerSettings.activeEnd}，等待到运行时间再继续`,
      });
      await sleep(Math.min(60 * 1000, waitMs));
    }
    if (!state.stopRequested) {
      state.nextRunAt = "";
      state.windowPauseRequested = false;
      updateSummary();
    }
  }

  async function requestWindowPauseIfNeeded() {
    if (state.stopRequested || state.windowPauseRequested || isWithinActiveWindow(schedulerSettings)) return false;
    state.windowPauseRequested = true;
    state.status = "outside_window_stopping";
    state.message = `已超出运行时间段 ${schedulerSettings.activeStart}-${schedulerSettings.activeEnd}，当前候选人处理完后暂停`;
    state.nextRunAt = nextActiveAtIso();
    updateSummary();
    await appendLog({
      event: "outside_window_pause_requested",
      settings: publicSettings(),
      message: `${chinaTimeText()} 已超出运行时间段 ${schedulerSettings.activeStart}-${schedulerSettings.activeEnd}，当前候选人处理完后暂停`,
    });
    const running = state.targets.filter((target) => target.status === "running" || target.status === "stopping");
    await Promise.all(running.map((target) => pauseTarget(target, true, "超出24小时自动运转运行时间段：当前候选人处理完后暂停")));
    return true;
  }

  async function finishRoundFromPayload(target, round, payload) {
    if (payload?.paused || payload?.pause?.paused) {
      throw new Error(payload.reply || payload.message || "任务已暂停");
    }
    const stats = extractRunStats(payload);
    const observed = await observeTarget(target);
    const remainingUnread = observed.ok ? observed.remainingUnread : null;
    const remainingActionable = observed.ok ? observed.remainingActionable : null;
    await appendLog({
      event: "round_completed",
      targetId: target.id,
      targetLabel: target.label,
      platform: target.platform,
      platformLabel: target.platformLabel,
      accountId: target.accountId,
      accountName: target.accountName,
      sourceKey: target.sourceKey,
      round,
      processed: stats.processed,
      requestedResume: stats.requestedResume,
      downloadedResume: stats.downloadedResume,
      remainingUnread,
      remainingActionable,
      counts: stats.counts,
      resultMessage: stats.message,
    });
    return { stats, observed };
  }

  async function cancelProcessTask(target, taskId, reason, routes) {
    if (!taskId) return null;
    try {
      const { payload } = await fetchAgentJson(target.sourceKey, routes.cancelPath, {
        method: "POST",
        body: { taskId, reason },
        timeoutMs: 30000,
      });
      return payload;
    } catch (error) {
      await appendLog({
        event: "round_task_cancel_failed",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
        taskId,
        error: error.message || "cancel failed",
        message: `${chinaTimeText()} ${target.label} background task cancel failed: ${error.message || "unknown"}`,
      });
      return null;
    }
  }

  async function pollProcessTaskResult(target, round, taskId, routes) {
    const startedAt = Date.now();
    let cancelSent = false;
    let pollFailures = 0;
    while (true) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > PROCESS_TASK_MAX_MS) {
        if (!cancelSent) {
          cancelSent = true;
          await cancelProcessTask(target, taskId, "background task exceeded time limit", routes);
        }
        throw new Error(`${routes.label} background task exceeded time limit`);
      }

      if ((state.stopRequested || state.windowPauseRequested) && !cancelSent) {
        cancelSent = true;
        await cancelProcessTask(target, taskId, "24h scheduler stop requested; finish current candidate then stop", routes);
        setTarget(target.id, {
          status: "stopping",
          lastMessage: "Stop requested; waiting current candidate to finish",
          error: "",
        });
      }

      let payload;
      try {
        const response = await fetchAgentJson(
          target.sourceKey,
          `${routes.taskPath}?taskId=${encodeURIComponent(taskId)}`,
          { timeoutMs: PROCESS_TASK_POLL_TIMEOUT_MS }
        );
        payload = response.payload;
        pollFailures = 0;
      } catch (error) {
        pollFailures += 1;
        if (pollFailures > PROCESS_TASK_POLL_FAILURE_LIMIT) {
          throw new Error(`${routes.label} background task polling failed: ${error.message || error}`);
        }
        setTarget(target.id, {
          status: cancelSent ? "stopping" : "running",
          lastMessage: `${routes.label} task polling retry ${pollFailures}/${PROCESS_TASK_POLL_FAILURE_LIMIT}`,
        });
        await sleep(PROCESS_TASK_POLL_MS);
        continue;
      }

      if (payload?.ok === false) {
        throw new Error(payload.error || `${routes.label} background task not found`);
      }

      const task = payload?.task && typeof payload.task === "object" ? payload.task : payload;
      const status = String(task?.status || payload?.status || "");
      const result = task?.result || payload?.result || {};
      if (status === "completed") {
        return result && typeof result === "object" ? result : task;
      }
      if (status === "paused" || result?.paused || payload?.paused || payload?.pause?.paused) {
        const error = new Error(result?.reply || result?.message || task?.error || payload?.error || `${routes.label} background task paused`);
        error.payload = result || payload;
        throw error;
      }
      if (status === "failed") {
        const error = new Error(task?.error || result?.error || payload?.error || `${routes.label} background task failed`);
        error.payload = result || payload;
        throw error;
      }

      setTarget(target.id, {
        status: cancelSent ? "stopping" : "running",
        lastMessage: cancelSent
          ? "Stop requested; waiting current candidate to finish"
          : `${routes.label} round ${round} running ${Math.floor(elapsedMs / 60000)}m`,
      });
      await sleep(PROCESS_TASK_POLL_MS);
    }
  }

  async function runProcessTaskRound(target, round, request, routes) {
    const { payload: startPayload } = await fetchAgentJson(target.sourceKey, routes.startPath, {
      method: "POST",
      body: request.body,
      timeoutMs: PROCESS_TASK_START_TIMEOUT_MS,
    });
    const taskId = String(startPayload?.taskId || startPayload?.task?.taskId || "");
    if (!taskId) {
      throw new Error(`${routes.label} background task did not return taskId`);
    }
    await appendLog({
      event: "round_task_started",
      targetId: target.id,
      targetLabel: target.label,
      platform: target.platform,
      platformLabel: target.platformLabel,
      accountId: target.accountId,
      accountName: target.accountName,
      sourceKey: target.sourceKey,
      round,
      taskId,
      alreadyRunning: Boolean(startPayload?.alreadyRunning),
      message: `${chinaTimeText()} ${target.label} background task started (${taskId})`,
    });
    setTarget(target.id, {
      status: "running",
      lastMessage: startPayload?.alreadyRunning ? `Attached to running ${routes.label} task` : `${routes.label} task started`,
    });
    const result = await pollProcessTaskResult(target, round, taskId, routes);
    return finishRoundFromPayload(target, round, result);
  }

  async function runRound(target, round) {
    await pauseTarget(target, false, "24小时自动运转开始处理前自动解除暂停");
    const request = targetProcessRequest(target);
    const routes = processTaskRoutes(target);
    if (routes) {
      return runProcessTaskRound(target, round, request, routes);
    }
    const { payload } = await fetchAgentJson(target.sourceKey, request.path, {
      method: "POST",
      body: request.body,
      timeoutMs: request.timeoutMs,
    });
    return finishRoundFromPayload(target, round, payload);
  }

  async function recoverInterruptedRound(target, round, roundStartedAt, error) {
    if (!recoverPartialRunStats) {
      return { stats: normalizeRecoveredStats(null), observed: null };
    }
    try {
      const stats = normalizeRecoveredStats(await recoverPartialRunStats({
        target,
        round,
        roundStartedAt,
        error,
        runId: state.runId,
        cycle: state.cycle,
      }));
      if (!stats.recovered) {
        return { stats, observed: null };
      }
      const observed = await observeTarget(target);
      await appendLog({
        event: "round_partial_stats_recovered",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
        round,
        processed: stats.processed,
        requestedResume: stats.requestedResume,
        downloadedResume: stats.downloadedResume,
        counts: stats.counts,
        source: stats.source,
        error: error.message || "interrupted",
        remainingUnread: observed?.ok ? observed.remainingUnread : null,
        remainingActionable: observed?.ok ? observed.remainingActionable : null,
        message: `${chinaTimeText()} ${target.label} 第${round}轮中断前进度已恢复：处理 ${stats.processed} 条消息，获取 ${stats.downloadedResume} 个简历，求简历 ${stats.requestedResume} 个`,
      });
      return { stats, observed };
    } catch (recoverError) {
      await appendLog({
        event: "round_partial_stats_recover_failed",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
        round,
        error: recoverError.message || "partial stats recovery failed",
        originalError: error.message || "",
        message: `${chinaTimeText()} ${target.label} 第${round}轮中断前进度恢复失败：${recoverError.message || "未知原因"}`,
      });
      return { stats: normalizeRecoveredStats(null), observed: null };
    }
  }

  async function runTarget(spec) {
    const target = materializeTarget(spec);
    let totalProcessed = 0;
    let totalRequested = 0;
    let totalDownloaded = 0;
    let lastObserved = null;
    setTarget(target.id, {
      status: "running",
      round: 0,
      error: "",
      browserReady: true,
      agentReady: false,
      lastMessage: "正在启动 agent",
    });
    await appendLog({
      event: "target_started",
      targetId: target.id,
      targetLabel: target.label,
      platform: target.platform,
      platformLabel: target.platformLabel,
      accountId: target.accountId,
      accountName: target.accountName,
      sourceKey: target.sourceKey,
      message: `${chinaTimeText()} ${target.label} 开始处理`,
    });

    try {
      const ready = await ensureTargetReady(target);
      if (ready?.captcha) throw new Error("检测到人机验证");
      if (ready?.needsLogin) throw new Error("账号未登录，需要人工登录");
      if (ready?.accountAbnormal) throw new Error("账号异常，需要人工处理");
      setTarget(target.id, {
        status: "running",
        agentReady: true,
        cdpPort: ready?.cdpPort || target.cdpPort || 0,
        agentPort: ready?.agentPort || target.agentPort || 0,
        lastMessage: "agent 已启动，准备处理消息",
      });
      await appendLog({
        event: "target_agent_ready",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
      });

      lastObserved = await observeTarget(target);

      for (let round = 1; round <= maxRoundsPerTarget; round += 1) {
        if (state.stopRequested || state.windowPauseRequested) break;
        setTarget(target.id, {
          status: "running",
          round,
          lastMessage: `第${round}轮处理中`,
          remainingUnread: lastObserved.ok ? lastObserved.remainingUnread : null,
          remainingActionable: lastObserved.ok ? lastObserved.remainingActionable : null,
        });
        let roundResult;
        const roundStartedAt = nowIso();
        try {
          roundResult = await runRound(target, round);
        } catch (error) {
          if (state.stopRequested || /任务已暂停|暂停/.test(String(error.message || ""))) {
            setTarget(target.id, {
              status: "stopping",
              lastMessage: "当前候选人已处理完，正在停止",
              error: "",
            });
            break;
          }
          const partialResult = await recoverInterruptedRound(target, round, roundStartedAt, error);
          if (partialResult?.stats?.recovered) {
            totalProcessed += partialResult.stats.processed;
            totalRequested += partialResult.stats.requestedResume;
            totalDownloaded += partialResult.stats.downloadedResume;
            lastObserved = partialResult.observed || lastObserved;
            error.partialStats = partialResult.stats;
            setTarget(target.id, {
              processed: totalProcessed,
              requestedResume: totalRequested,
              downloadedResume: totalDownloaded,
              remainingUnread: lastObserved?.ok ? lastObserved.remainingUnread : null,
              remainingActionable: lastObserved?.ok ? lastObserved.remainingActionable : null,
              partialStatsRecovered: true,
              partialProcessed: partialResult.stats.processed,
              partialRequestedResume: partialResult.stats.requestedResume,
              partialDownloadedResume: partialResult.stats.downloadedResume,
              lastMessage: `第${round}轮中断，已恢复部分处理进度`,
            });
          }
          throw error;
        }

        totalProcessed += roundResult.stats.processed;
        totalRequested += roundResult.stats.requestedResume;
        totalDownloaded += roundResult.stats.downloadedResume;
        lastObserved = roundResult.observed;
        setTarget(target.id, {
          processed: totalProcessed,
          requestedResume: totalRequested,
          downloadedResume: totalDownloaded,
          remainingUnread: lastObserved.ok ? lastObserved.remainingUnread : null,
          remainingActionable: lastObserved.ok ? lastObserved.remainingActionable : null,
          lastMessage: `第${round}轮完成`,
        });
        const nextDecision = nextRoundDecision(target, round, roundResult, lastObserved);
        if (!nextDecision.run) break;
        if (nextDecision.reason === "boss_confirm_after_processed") {
          await appendLog({
            event: "round_confirm_scheduled",
            targetId: target.id,
            targetLabel: target.label,
            platform: target.platform,
            platformLabel: target.platformLabel,
            accountId: target.accountId,
            accountName: target.accountName,
            sourceKey: target.sourceKey,
            round,
            processed: roundResult.stats.processed,
            remainingUnread: lastObserved?.ok ? lastObserved.remainingUnread : null,
            remainingActionable: lastObserved?.ok ? lastObserved.remainingActionable : null,
            reason: nextDecision.reason,
            message: `${chinaTimeText()} ${target.label} 第${round}轮处理过候选人但剩余红点为 0，已追加 BOSS 确认轮，避免漏处理`,
          });
        }
      }

      const stopped = state.stopRequested;
      const finalStatus = stopped ? "stopped" : "completed";
      setTarget(target.id, {
        status: finalStatus,
        processed: totalProcessed,
        requestedResume: totalRequested,
        downloadedResume: totalDownloaded,
        lastMessage: stopped ? "已按停止请求退出" : "处理完成",
      });
      await appendLog({
        event: stopped ? "target_stopped" : "target_completed",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
        processed: totalProcessed,
        requestedResume: totalRequested,
        downloadedResume: totalDownloaded,
      });
    } catch (error) {
      const reason = detectInterruption(error);
      const partialStats = error.partialStats && typeof error.partialStats === "object" ? error.partialStats : null;
      setTarget(target.id, {
        status: reason === "human_verification" ? "captcha" : reason === "needs_login" ? "needs_login" : reason === "account_abnormal" ? "account_abnormal" : "failed",
        error: error.message || "处理失败",
        processed: totalProcessed,
        requestedResume: totalRequested,
        downloadedResume: totalDownloaded,
        partialStatsRecovered: Boolean(partialStats?.recovered),
        partialProcessed: partialStats?.processed || 0,
        partialRequestedResume: partialStats?.requestedResume || 0,
        partialDownloadedResume: partialStats?.downloadedResume || 0,
        lastMessage: partialStats?.recovered ? "处理中断，已恢复中断前进度" : "处理中断",
      });
      state.lastError = `${target.label}：${error.message || "处理失败"}`;
      await appendLog({
        event: "target_interrupted",
        targetId: target.id,
        targetLabel: target.label,
        platform: target.platform,
        platformLabel: target.platformLabel,
        accountId: target.accountId,
        accountName: target.accountName,
        sourceKey: target.sourceKey,
        reason,
        error: error.message || "处理失败",
        partialStatsRecovered: Boolean(partialStats?.recovered),
        partialProcessed: partialStats?.processed || 0,
        partialRequestedResume: partialStats?.requestedResume || 0,
        partialDownloadedResume: partialStats?.downloadedResume || 0,
        counts: partialStats?.counts || {},
      });
    } finally {
      try {
        const cleanup = await cleanupFinishedTarget(target);
        if (cleanup && cleanup.ok === false) {
          const cleanupErrors = [
            cleanup.error,
            cleanup.agent?.errors,
          ].flat().filter(Boolean).join("；");
          throw new Error(cleanupErrors || "agent 关闭失败");
        }
        const latestTarget = state.targets.find((item) => item.id === target.id);
        const cleanupPatch = {
          agentReady: false,
          browserReady: latestTarget ? !["failed", "captcha", "needs_login", "account_abnormal"].includes(latestTarget.status) : true,
        };
        if (latestTarget && ["completed", "stopped"].includes(latestTarget.status)) {
          cleanupPatch.lastMessage = `${latestTarget.lastMessage || "处理完成"}，agent 已关闭，浏览器保持打开`;
        }
        setTarget(target.id, cleanupPatch);
        await appendLog({
          event: "target_runtime_closed",
          targetId: target.id,
          targetLabel: target.label,
          platform: target.platform,
          platformLabel: target.platformLabel,
          accountId: target.accountId,
          accountName: target.accountName,
          sourceKey: target.sourceKey,
          cleanup,
          message: `${chinaTimeText()} ${target.label} agent 已关闭，浏览器保持打开`,
        });
      } catch (cleanupError) {
        await appendLog({
          event: "target_runtime_close_failed",
          targetId: target.id,
          targetLabel: target.label,
          platform: target.platform,
          platformLabel: target.platformLabel,
          accountId: target.accountId,
          accountName: target.accountName,
          sourceKey: target.sourceKey,
          error: cleanupError.message || "agent 关闭失败",
          message: `${chinaTimeText()} ${target.label} agent 关闭失败：${cleanupError.message || "未知原因"}`,
        });
      }
    }
  }

  async function runReadyTargets(readyTargets) {
    if (!readyTargets.length) {
      await appendLog({
        event: "cycle_no_ready_targets",
        message: `${chinaTimeText()} 第${state.cycle}大轮没有可处理的已登录浏览器`,
      });
      return;
    }
    let nextIndex = 0;
    let finished = false;

    async function worker() {
      while (!state.stopRequested && !state.windowPauseRequested && nextIndex < readyTargets.length) {
        if (!isWithinActiveWindow(schedulerSettings)) {
          await requestWindowPauseIfNeeded();
          break;
        }
        const currentIndex = nextIndex;
        nextIndex += 1;
        await runTarget(readyTargets[currentIndex]);
      }
    }

    const workerCount = Math.min(Math.max(1, concurrency), readyTargets.length);
    const poolPromise = Promise.all(Array.from({ length: workerCount }, () => worker())).finally(() => {
      finished = true;
    });
    while (!finished && !state.stopRequested) {
      await sleep(5000);
      await requestWindowPauseIfNeeded();
    }
    await poolPromise;
  }

  async function runLoop() {
    let finalStatus = "stopped";
    let finalMessage = "24小时自动运转已停止";
    let finalEvent = "scheduler_stopped";
    try {
      while (!state.stopRequested) {
        await waitForActiveWindow();
        if (state.stopRequested) break;

        state.cycle += 1;
        resetTargets();
        state.status = "running";
        state.message = `第${state.cycle}大轮运行中`;
        updateSummary();
        await appendLog({ event: "cycle_started", message: `${chinaTimeText()} 第${state.cycle}大轮开始` });

        const readyTargets = await prepareBrowsersForCycle();
        if (!state.stopRequested && !state.windowPauseRequested) {
          if (!isWithinActiveWindow(schedulerSettings)) {
            await requestWindowPauseIfNeeded();
          } else {
            await runReadyTargets(readyTargets);
          }
        }

        if (state.stopRequested) break;
        if (state.windowPauseRequested) {
          state.status = "outside_window";
          state.message = `已暂停，等待运行时间段 ${schedulerSettings.activeStart}-${schedulerSettings.activeEnd}`;
          state.nextRunAt = nextActiveAtIso();
          updateSummary();
          await appendLog({
            event: "outside_window_paused",
            settings: publicSettings(),
            message: `${chinaTimeText()} 已暂停，等待运行时间段 ${schedulerSettings.activeStart}-${schedulerSettings.activeEnd}`,
          });
          continue;
        }

        if (schedulerSettings.maxCycles > 0 && state.cycle >= schedulerSettings.maxCycles) {
          finalStatus = "completed";
          finalMessage = `已完成设置的 ${schedulerSettings.maxCycles} 轮自动运转`;
          finalEvent = "scheduler_completed";
          await appendLog({
            event: "cycle_limit_reached",
            cycle: state.cycle,
            maxCycles: schedulerSettings.maxCycles,
            message: `${chinaTimeText()} 已完成设置的 ${schedulerSettings.maxCycles} 轮自动运转`,
          });
          break;
        }

        const delayMs = schedulerSettings.cycleDelayMs;
        state.status = "waiting";
        state.message = `第${state.cycle}轮已经处理完毕，等待下一轮启动中`;
        state.nextRunAt = new Date(Date.now() + delayMs).toISOString();
        updateSummary();
        await appendLog({ event: "cycle_completed", cycle: state.cycle, delayMs });

        const waitUntil = Date.now() + delayMs;
        while (!state.stopRequested && Date.now() < waitUntil) {
          if (!isWithinActiveWindow(schedulerSettings)) break;
          await sleep(Math.min(5000, waitUntil - Date.now()));
        }
        state.nextRunAt = "";
      }
    } catch (error) {
      state.status = "failed";
      state.active = false;
      state.stopping = false;
      state.lastError = error.message || "24小时自动运转异常";
      state.message = state.lastError;
      await appendLog({ event: "scheduler_failed", error: state.lastError, message: `${chinaTimeText()} 24小时自动运转异常：${state.lastError}` });
      updateSummary();
      return;
    }

    state.status = finalStatus;
    state.active = false;
    state.stopping = false;
    state.stopRequested = false;
    state.windowPauseRequested = false;
    state.message = finalMessage;
    state.nextRunAt = "";
    updateSummary();
    await appendLog({ event: finalEvent, message: `${chinaTimeText()} ${finalMessage}` });
  }

  async function start() {
    if (state.active) return status();
    state.active = true;
    state.stopping = false;
    state.stopRequested = false;
    state.windowPauseRequested = false;
    state.status = "running";
    state.runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    state.startedAt = nowIso();
    state.updatedAt = state.startedAt;
    state.cycle = 0;
    state.lastError = "";
    state.settings = publicSettings();
    state.withinActiveWindow = isWithinActiveWindow(schedulerSettings);
    state.message = "24小时自动运转已启动";
    resetTargets();
    updateSummary();
    await appendLog({ event: "scheduler_started", message: `${chinaTimeText()} 24小时自动运转已启动` });
    loopPromise = runLoop();
    return status();
  }

  async function stop(reason = "用户确认中断24小时自动运转") {
    if (!state.active) return status();
    state.stopRequested = true;
    state.stopping = true;
    state.status = "stopping";
    state.message = "停止中，当前候选人处理完后关闭对应 agent，浏览器保持打开";
    updateSummary();
    await appendLog({ event: "stop_requested", reason });
    const running = state.targets.filter((target) => target.status === "running" || target.status === "stopping");
    await Promise.all(running.map((target) => pauseTarget(target, true, "24小时自动运转停止：当前候选人处理完后停止")));
    return status();
  }

  function status() {
    updateSummary();
    return JSON.parse(JSON.stringify(state));
  }

  async function readLogs(date) {
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : chinaDateKey();
    const filePath = path.join(logDir, `${dateKey}.jsonl`);
    if (!fsSync.existsSync(filePath)) {
      return { ok: true, date: dateKey, logs: [] };
    }
    const raw = await fs.readFile(filePath, "utf8");
    const logs = raw
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
    return { ok: true, date: dateKey, logs };
  }

  resetTargets();
  updateSummary();

  return {
    start,
    stop,
    status,
    updateSettings,
    readLogs,
    get loopPromise() {
      return loopPromise;
    },
  };
}

module.exports = {
  createAutomation24hScheduler,
  DEFAULT_TARGETS,
};
