const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const DEFAULT_CYCLE_DELAY_MS = 15 * 60 * 1000;
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

function sumCountKeys(object, keys) {
  if (!object || typeof object !== "object") return 0;
  return keys.reduce((total, key) => total + normalizeCount(object[key], 0), 0);
}

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
    sumCountKeys(counts, [
      "accepted_requested_resume",
      "knowledge_answered_and_requested_resume",
      "accepted_resume_already_requested",
      "knowledge_answered_resume_already_requested",
    ])
  );
  const downloadedResume = normalizeCount(
    state.downloadedResume,
    sumCountKeys(counts, ["accepted_resume_downloaded", "knowledge_answered_resume_downloaded", "resume_downloaded"])
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
    return `${time} ${label} 处理中断，原因：${entry.reason || entry.error || "未知"}`;
  }
  if (entry.event === "target_completed") {
    return `${time} ${label} 处理完成，共处理 ${entry.processed || 0} 条消息，获取 ${entry.downloadedResume || 0} 个简历`;
  }
  if (entry.event === "cycle_completed") {
    return `${time} 第${entry.cycle}大轮处理完成，等待 ${Math.round((entry.delayMs || 0) / 60000)} 分钟`;
  }
  if (entry.event === "stop_requested") {
    return `${time} 已请求停止24小时自动运转，当前候选人处理完后停止`;
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
  ensureTargetReady,
  cleanupTarget,
  fetchAgentJson,
} = {}) {
  if (!dataDir) throw new Error("automation24h requires dataDir");
  if (typeof sleep !== "function") throw new Error("automation24h requires sleep");
  if (typeof resolveTarget !== "function") throw new Error("automation24h requires resolveTarget");
  if (typeof ensureTargetReady !== "function") throw new Error("automation24h requires ensureTargetReady");
  if (typeof fetchAgentJson !== "function") throw new Error("automation24h requires fetchAgentJson");
  const cleanupFinishedTarget = typeof cleanupTarget === "function" ? cleanupTarget : async () => null;

  const logDir = path.join(dataDir, "automation-24h-logs");
  const state = {
    ok: true,
    active: false,
    stopping: false,
    stopRequested: false,
    status: "stopped",
    message: "24小时自动运转未启动",
    runId: "",
    startedAt: "",
    updatedAt: "",
    cycle: 0,
    currentBatch: [],
    nextRunAt: "",
    lastError: "",
    targets: [],
    summary: {
      running: 0,
      waiting: targets.length,
      completed: 0,
      failed: 0,
      remainingUnread: 0,
      remainingActionable: 0,
    },
  };
  let loopPromise = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function publicTarget(spec, patch = {}) {
    const resolved = resolveTarget(spec);
    return {
      id: `${resolved.platform}:${resolved.accountId}`,
      platform: resolved.platform,
      platformLabel: resolved.platformLabel,
      accountId: resolved.accountId,
      accountName: resolved.accountName,
      sourceKey: resolved.sourceKey,
      label: `${resolved.platformLabel} ${resolved.accountName}`,
      status: "waiting",
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
    state.summary = {
      running: rows.filter((item) => item.status === "running").length,
      waiting: rows.filter((item) => item.status === "waiting").length,
      completed: rows.filter((item) => item.status === "completed").length,
      stopping: rows.filter((item) => item.status === "stopping").length,
      failed: rows.filter((item) => item.status === "failed" || item.status === "interrupted").length,
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

  function targetProcessRequest(target) {
    if (target.platform === "51job") {
      return {
        path: "/api/51job/process-messages",
        body: { accountId: target.accountId, maxTotal: maxTotalPerRound },
        timeoutMs: 5400000,
      };
    }
    if (target.platform === "zhilian") {
      return {
        path: "/api/zhilian/process-messages",
        body: { accountId: target.accountId, maxTotal: maxTotalPerRound },
        timeoutMs: 5400000,
      };
    }
    return {
      path: "/api/recruiter/process-messages",
      body: { accountId: target.accountId, maxTotal: maxTotalPerRound },
      timeoutMs: 5400000,
    };
  }

  function shouldRunSecondRound(observed) {
    if (!observed?.ok || observed.busy) return false;
    return normalizeCount(observed.remainingUnread, 0) > 0 || normalizeCount(observed.remainingActionable, 0) > 0;
  }

  async function runRound(target, round) {
    await pauseTarget(target, false, "24小时自动运转开始处理前自动解除暂停");
    const request = targetProcessRequest(target);
    const { payload } = await fetchAgentJson(target.sourceKey, request.path, {
      method: "POST",
      body: request.body,
      timeoutMs: request.timeoutMs,
    });
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

  async function runTarget(spec) {
    const target = resolveTarget(spec);
    target.id = `${target.platform}:${target.accountId}`;
    target.label = `${target.platformLabel} ${target.accountName}`;
    setTarget(target.id, {
      status: "running",
      round: 0,
      error: "",
      lastMessage: "正在启动浏览器和agent",
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

      let totalProcessed = 0;
      let totalRequested = 0;
      let totalDownloaded = 0;
      let lastObserved = await observeTarget(target);

      for (let round = 1; round <= maxRoundsPerTarget; round += 1) {
        if (state.stopRequested) break;
        setTarget(target.id, {
          status: "running",
          round,
          lastMessage: `第${round}轮处理中`,
          remainingUnread: lastObserved.ok ? lastObserved.remainingUnread : null,
          remainingActionable: lastObserved.ok ? lastObserved.remainingActionable : null,
        });
        let roundResult;
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
        if (!shouldRunSecondRound(lastObserved)) break;
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
      setTarget(target.id, {
        status: reason === "human_verification" ? "captcha" : reason === "needs_login" ? "needs_login" : "failed",
        error: error.message || "处理失败",
        lastMessage: "处理中断",
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
      });
    } finally {
      if (!state.stopRequested) {
        try {
          const cleanup = await cleanupFinishedTarget(target);
          await appendLog({
            event: "target_agent_closed",
            targetId: target.id,
            targetLabel: target.label,
            platform: target.platform,
            platformLabel: target.platformLabel,
            accountId: target.accountId,
            accountName: target.accountName,
            sourceKey: target.sourceKey,
            cleanup,
            message: `${chinaTimeText()} ${target.label} agent进程已关闭，浏览器保持打开`,
          });
        } catch (cleanupError) {
          await appendLog({
            event: "target_agent_close_failed",
            targetId: target.id,
            targetLabel: target.label,
            platform: target.platform,
            platformLabel: target.platformLabel,
            accountId: target.accountId,
            accountName: target.accountName,
            sourceKey: target.sourceKey,
            error: cleanupError.message || "agent进程关闭失败",
            message: `${chinaTimeText()} ${target.label} agent进程关闭失败：${cleanupError.message || "未知原因"}`,
          });
        }
      }
    }
  }

  async function runBatch(batch) {
    await Promise.all(batch.map((spec) => runTarget(spec)));
  }

  async function runLoop() {
    try {
      while (!state.stopRequested) {
        state.cycle += 1;
        resetTargets();
        state.status = "running";
        state.message = `第${state.cycle}大轮运行中`;
        updateSummary();
        await appendLog({ event: "cycle_started", message: `${chinaTimeText()} 第${state.cycle}大轮开始` });

        for (let index = 0; index < targets.length && !state.stopRequested; index += concurrency) {
          const batch = targets.slice(index, index + concurrency);
          await runBatch(batch);
        }

        if (state.stopRequested) break;
        state.status = "waiting";
        state.message = `第${state.cycle}大轮完成，等待下一轮`;
        state.nextRunAt = new Date(Date.now() + cycleDelayMs).toISOString();
        updateSummary();
        await appendLog({ event: "cycle_completed", cycle: state.cycle, delayMs: cycleDelayMs });

        const waitUntil = Date.now() + cycleDelayMs;
        while (!state.stopRequested && Date.now() < waitUntil) {
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

    state.status = "stopped";
    state.active = false;
    state.stopping = false;
    state.stopRequested = false;
    state.message = "24小时自动运转已停止";
    state.nextRunAt = "";
    updateSummary();
    await appendLog({ event: "scheduler_stopped", message: `${chinaTimeText()} 24小时自动运转已停止` });
  }

  async function start() {
    if (state.active) return status();
    state.active = true;
    state.stopping = false;
    state.stopRequested = false;
    state.status = "running";
    state.runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    state.startedAt = nowIso();
    state.updatedAt = state.startedAt;
    state.cycle = 0;
    state.lastError = "";
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
    state.message = "停止中，当前候选人处理完后停止";
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
