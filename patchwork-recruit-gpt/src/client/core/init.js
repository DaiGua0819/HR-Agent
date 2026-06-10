async function importZhilianResumeFolder() {
  if (isBatchRunning) {
    setStatus("批量任务运行中，请稍后再导入");
    return;
  }

  if (!zhilianFolderScan?.files?.length) {
    await scanZhilianResumeFolder();
    if (!zhilianFolderScan?.files?.length) return;
  }

  clearBatchPoll();
  batchPage = 1;
  setBatchPanelExpanded(true);
  setStatus("正在导入智联简历文件夹", "is-working");
  if (elements.batchSummary) elements.batchSummary.textContent = "已确认导入，正在创建智联简历批量解析任务...";
  if (elements.scanZhilianFolderBtn) elements.scanZhilianFolderBtn.disabled = true;
  if (elements.importZhilianFolderBtn) elements.importZhilianFolderBtn.disabled = true;

  try {
    const payload = await requestJson("/api/import-folder/zhilian-resumes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parseMode: "direct",
        limit: 30,
      }),
    });

    const summary = payload.summary || {};
    if (!payload.job) {
      zhilianFolderScan = null;
      setStatus(payload.message || "没有新增智联简历", "is-done");
      if (elements.batchSummary) {
        elements.batchSummary.textContent = `${payload.message || "没有新增智联简历"}；已扫描 ${summary.scanned || 0} 个 PDF，已导入过 ${summary.skippedImported || 0} 个`;
      }
      if (elements.zhilianFolderSummary) elements.zhilianFolderSummary.textContent = "没有新增 PDF，请下载新简历后重新扫描";
      return;
    }

    zhilianFolderScan = null;
    currentBatchJobId = payload.job.id;
    window.localStorage.setItem(BATCH_JOB_STORAGE_KEY, currentBatchJobId);
    applyBatchJob(payload.job);
    if (elements.zhilianFolderSummary) elements.zhilianFolderSummary.textContent = `已确认导入 ${summary.imported || 0} 份，正在批量解析`;
    setStatus(`已导入 ${summary.imported || 0} 份智联简历`, "is-done");
    await pollBatchJob(currentBatchJobId);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "导入智联简历失败");
    if (elements.batchSummary) elements.batchSummary.textContent = error.message || "导入智联简历失败";
  } finally {
    if (elements.scanZhilianFolderBtn) elements.scanZhilianFolderBtn.disabled = false;
    if (elements.importZhilianFolderBtn) elements.importZhilianFolderBtn.disabled = true;
  }
}

function renderBossBrowserResult(payload = {}) {
  const scan = payload.scan || {};
  const triggerCount = Array.isArray(scan.triggers) ? scan.triggers.length : 0;
  const downloaded = Array.isArray(payload.downloaded) ? payload.downloaded : [];
  const statusText = payload.connected === false
    ? payload.error || "未连接到普通浏览器"
    : `${scan.isBossPage ? "已连接 BOSS 页面" : "已连接浏览器"}，可见下载入口 ${triggerCount} 个`;

  if (elements.bossBrowserSummary) {
    elements.bossBrowserSummary.textContent = downloaded.length
      ? `已下载 ${downloaded.length} 份到 boss-resumes，可继续扫描文件夹`
      : statusText;
  }

  const details = [
    payload.message || statusText,
    scan.title ? `页面：${scan.title}` : "",
    scan.url ? `地址：${scan.url}` : "",
    payload.startHint ? `启动提示：\n${payload.startHint}` : "",
    downloaded.length ? `新文件：${downloaded.map((file) => file.filename).join("、")}` : "",
  ].filter(Boolean);
  elements.batchSummary.textContent = details.join("；");
}

async function startBossAutomation() {
  if (isBatchRunning) {
    setStatus("批量任务运行中，BOSS 自动化入口已打开", "is-working");
  }

  setBatchPanelExpanded(true);
  showBossAutomationActions("正在启动自动化，启动完成后可以处理消息");
  setStatus("正在启动 BOSS 自动化", "is-working");
  if (elements.bossAutomationBtn) elements.bossAutomationBtn.disabled = true;
  if (elements.bossBrowserSummary) {
    elements.bossBrowserSummary.textContent = `正在启动${bossAutomationAccountLabel()}的 CloakBrowser、Playwright，并跳转 BOSS 招聘页面...`;
  }
  if (elements.batchSummary) {
    elements.batchSummary.textContent = "正在启动浏览器和自动化服务，请稍等...";
  }

  try {
    const payload = await requestJson(`/api/boss-automation/start?accountId=${encodeURIComponent(bossAutomationAccountId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    renderBossBrowserResult(payload);
    const totalMs = Number(payload.timings?.totalMs);
    const elapsedText = Number.isFinite(totalMs) ? `用时 ${(totalMs / 1000).toFixed(1)} 秒` : "";
    const openText = payload.navigation?.skipped ? "已复用 BOSS 招聘页面" : "已打开 BOSS 招聘页面";
    const statusText = [
      payload.cdp?.started ? "已启动 CloakBrowser" : "CloakBrowser 已在运行",
      payload.agent?.started ? "已启动 Playwright 服务" : "Playwright 服务已在运行",
      openText,
      elapsedText,
    ].filter(Boolean).join("，");
    if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = statusText;
    showBossAutomationActions(`${bossAutomationAccountLabel()}自动化已就绪，可以点击处理消息`);
    await refreshBossAutomationSummary();
    setStatus("BOSS 自动化已启动", "is-done");
  } catch (error) {
    console.error(error);
    const payload = { connected: false, error: error.message };
    renderBossBrowserResult(payload);
    setStatus(error.message || "启动 BOSS 自动化失败");
  } finally {
    if (elements.bossAutomationBtn) elements.bossAutomationBtn.disabled = false;
  }
}

function formatBrowserLaunchSummary(payload) {
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  const failures = Array.isArray(payload?.failures) ? payload.failures : [];
  if (!targets.length && !failures.length) return payload?.message || "浏览器已启动";
  const successText = targets
    .map((target) => {
      const accountName = target.accountName || bossAutomationAccountLabel(target.accountId);
      const platformName = target.platformLabel || automationPlatformLabel(target.platform);
      const state = target.started ? "已启动" : "已在运行";
      const loginHint = target.needsLogin ? "，请登录" : "";
      return `${accountName} ${platformName} ${state}（${target.cdpPort || "-"}）${loginHint}`;
    })
    .join("；");
  const failureText = failures
    .map((target) => {
      const accountName = target.accountName || bossAutomationAccountLabel(target.accountId);
      const platformName = target.platformLabel || automationPlatformLabel(target.platform);
      return `${accountName} ${platformName} 失败：${target.error || "启动失败"}`;
    })
    .join("；");
  return [payload?.message, successText, failureText].filter(Boolean).join("；");
}

async function oneClickLaunchAutomationBrowser() {
  const platformLabel = "默认六窗口";
  const button = elements.oneClickLaunchBrowserBtn;
  if (button) button.disabled = true;
  if (elements.bossBrowserSummary) {
    elements.bossBrowserSummary.textContent = "正在启动 BOSS 宋峰峰、BOSS 和新红、51 宋峰峰、51 和新红、智联 宋峰峰、智联 和新红 CloakBrowser...";
  }
  setStatus("正在启动默认六个 CloakBrowser", "is-working");

  try {
    const payload = await requestJson("/api/automation-browser/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        launchSet: "default-four",
      }),
    });
    const summary = formatBrowserLaunchSummary(payload);
    if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = summary;
    if (elements.batchSummary) elements.batchSummary.textContent = summary;
    showAutomationActions(`${platformLabel} 已打开，确认账号后可以处理消息或主动联系`);
    await refreshBossAutomationSummary();
    setStatus(payload.message || "默认六个 CloakBrowser 已启动", "is-done");
  } catch (error) {
    console.error(error);
    const message = error.message || "一键启动浏览器失败";
    if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = message;
    setStatus(message);
  } finally {
    if (button) button.disabled = false;
  }
}

function browserLaunchStatusLabel(status) {
  return {
    pending: "等待启动",
    running: "启动中",
    ready: "已就绪",
    needs_login: "需要登录",
    failed: "启动失败",
  }[status] || status || "未知";
}

function getBrowserLaunchJob(payload) {
  return payload?.job && typeof payload.job === "object" ? payload.job : payload;
}

function formatBrowserLaunchJobSummary(payload, statusPrefix = "浏览器启动") {
  const job = getBrowserLaunchJob(payload) || {};
  const targets = Array.isArray(job.targets) ? job.targets : [];
  const summary = job.summary || targets.reduce(
    (acc, target) => {
      if (target.status === "ready") acc.ready += 1;
      if (target.status === "needs_login") acc.needsLogin += 1;
      if (target.status === "failed") acc.failed += 1;
      return acc;
    },
    { ready: 0, needsLogin: 0, failed: 0 }
  );
  const fallbackHeader = `${statusPrefix}：就绪 ${summary.ready || 0}，需登录 ${summary.needsLogin || 0}，失败 ${summary.failed || 0}`;
  const message = String(job.message || "").trim();
  const header = message && !/^\?+$/.test(message) ? message : fallbackHeader;
  const detail = targets.map((target) => {
    const platformName = target.platformLabel || automationPlatformLabel(target.platform);
    const accountName = target.accountName || bossAutomationAccountLabel(target.accountId);
    const attempt = `${target.attempt || 0}/${target.maxAttempts || 2}`;
    const error = target.status === "failed" && target.error ? `，${target.error}` : "";
    return `${platformName} ${accountName} ${target.cdpPort || "-"} ${browserLaunchStatusLabel(target.status)} ${attempt}${error}`;
  }).join("；");
  return [header, detail].filter(Boolean).join("；");
}

function isBrowserLaunchJobDone(job = {}) {
  return ["completed", "completed_with_errors", "failed"].includes(job.status);
}

function updateBrowserLaunchProgress(payload, statusPrefix = "一键启动") {
  const summary = formatBrowserLaunchJobSummary(payload, statusPrefix);
  if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = summary;
  if (elements.batchSummary) elements.batchSummary.textContent = summary;
  const job = getBrowserLaunchJob(payload) || {};
  const counts = job.summary || {};
  const failed = Number(counts.failed || 0);
  const needsLogin = Number(counts.needsLogin || 0);
  const ready = Number(counts.ready || 0);
  const statusText = `${statusPrefix}：就绪 ${ready}，需登录 ${needsLogin}，失败 ${failed}`;
  setStatus(statusText, failed ? "" : "is-working");
}

async function pollAutomationBrowserLaunchJob(jobId, statusPrefix = "一键启动") {
  let latest = null;
  for (let index = 0; index < 120; index += 1) {
    const payload = await requestJson(`/api/automation-browser/jobs/${encodeURIComponent(jobId)}`);
    latest = payload;
    updateBrowserLaunchProgress(payload, statusPrefix);
    if (isBrowserLaunchJobDone(payload.job)) return payload;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  return latest;
}

function getBrowserLaunchButtonTarget(button) {
  const platform = normalizeAutomationPlatform(button?.dataset?.browserLaunchPlatform || "boss");
  const accountId = normalizeBossAutomationAccountId(button?.dataset?.browserLaunchAccount || "all");
  const agentPort = button?.dataset?.agentPort || "";
  const cdpPort = button?.dataset?.cdpPort || "";
  return {
    platform,
    accountId,
    platformParam: automationPlatformParam(platform),
    agentPort,
    cdpPort,
    ports: [agentPort, cdpPort].filter(Boolean).join(" / "),
    label: `${automationPlatformLabel(platform)} ${bossAutomationAccountLabel(accountId)}`,
  };
}

function renderBrowserLaunchButton(button, status = "idle") {
  if (!button) return;
  const target = getBrowserLaunchButtonTarget(button);
  const statusNode = button.querySelector(".launch-status");
  const label = status === "running" ? "运行中" : status === "starting" ? "启动中" : status === "failed" ? "失败" : "启动";
  button.classList.toggle("is-running", status === "running");
  button.classList.toggle("is-starting", status === "starting");
  button.classList.toggle("is-error", status === "failed");
  button.disabled = status === "starting";
  if (statusNode) statusNode.textContent = `${label} ${target.ports}`;
  button.title = `${target.label} ${label} ${target.ports}`;
  button.setAttribute("aria-label", button.title);
}

function getBrowserLaunchButtonStatus(target = {}) {
  if (target.status === "ready" || target.status === "needs_login") return "running";
  if (target.status === "failed") return "failed";
  if (target.status === "running" || target.status === "pending") return "starting";
  if (target.started || target.authenticated || target.needsLogin) return "running";
  return "idle";
}

function syncBrowserLaunchButtonsFromJob(payload) {
  const job = getBrowserLaunchJob(payload) || {};
  const targets = Array.isArray(job.targets) ? job.targets : [];
  for (const target of targets) {
    const platform = normalizeAutomationPlatform(target.platform);
    const accountId = normalizeBossAutomationAccountId(target.accountId);
    const button = elements.browserLaunchButtons?.find((candidate) => (
      normalizeAutomationPlatform(candidate.dataset.browserLaunchPlatform) === platform &&
      normalizeBossAutomationAccountId(candidate.dataset.browserLaunchAccount) === accountId
    ));
    renderBrowserLaunchButton(button, getBrowserLaunchButtonStatus(target));
  }
}

function setBrowserLaunchButtonsDisabled(disabled, exceptButton = null) {
  elements.browserLaunchButtons?.forEach((button) => {
    if (button === exceptButton) return;
    button.disabled = Boolean(disabled);
  });
  if (elements.oneClickLaunchBrowserBtn && elements.oneClickLaunchBrowserBtn !== exceptButton) {
    elements.oneClickLaunchBrowserBtn.disabled = Boolean(disabled);
  }
}

async function launchAutomationBrowserTarget(button) {
  const target = getBrowserLaunchButtonTarget(button);
  renderBrowserLaunchButton(button, "starting");
  setBrowserLaunchButtonsDisabled(true, button);
  selectAutomationPlatform(target.platform, `${target.label} 正在启动`);
  setBossAutomationAccount(target.accountId);
  if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = `正在启动 ${target.label} CloakBrowser...`;
  setStatus(`${target.label} 启动中`, "is-working");

  try {
    const payload = await requestJson("/api/automation-browser/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targets: [{ platform: target.platformParam, accountId: target.accountId }],
        retryFailed: true,
        maxAttempts: 2,
        waitTimeoutMs: 45000,
      }),
    });
    updateBrowserLaunchProgress(payload, target.label);
    syncBrowserLaunchButtonsFromJob(payload);
    const finalPayload = payload.jobId ? await pollAutomationBrowserLaunchJob(payload.jobId, target.label) : payload;
    updateBrowserLaunchProgress(finalPayload, target.label);
    syncBrowserLaunchButtonsFromJob(finalPayload);
    const finalJob = getBrowserLaunchJob(finalPayload) || {};
    const counts = finalJob.summary || {};
    const failed = Number(counts.failed || 0);
    const needsLogin = Number(counts.needsLogin || 0);
    const ready = Number(counts.ready || 0);
    showAutomationActions(`${target.label} 启动检测完成，可以继续处理消息或主动联系`);
    await refreshBossAutomationSummary();
    if (!isBrowserLaunchJobDone(finalJob)) {
      setStatus(`${target.label} 仍在启动：就绪 ${ready}，需登录 ${needsLogin}，失败 ${failed}`, "is-working");
    } else if (failed) {
      setStatus(`${target.label} 启动完成：就绪 ${ready}，需登录 ${needsLogin}，失败 ${failed}`, "");
    } else {
      setStatus(`${target.label} 启动完成：就绪 ${ready}，需登录 ${needsLogin}，失败 0`, "is-done");
    }
  } catch (error) {
    console.error(error);
    const message = error.message || `${target.label} 启动失败`;
    renderBrowserLaunchButton(button, "failed");
    if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = message;
    setStatus(message);
  } finally {
    setBrowserLaunchButtonsDisabled(false, button);
  }
}

async function oneClickLaunchAutomationBrowserJobMode() {
  const button = elements.oneClickLaunchBrowserBtn;
  if (button) button.disabled = true;
  setBrowserLaunchButtonsDisabled(true, button);
  if (elements.bossBrowserSummary) {
    elements.bossBrowserSummary.textContent = "正在创建六个 CloakBrowser 后台启动任务...";
  }
  setStatus("正在并行启动六个 CloakBrowser", "is-working");

  try {
    const payload = await requestJson("/api/automation-browser/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        launchSet: "default-six",
        retryFailed: true,
        maxAttempts: 2,
        waitTimeoutMs: 45000,
      }),
    });
    updateBrowserLaunchProgress(payload);
    syncBrowserLaunchButtonsFromJob(payload);
    const finalPayload = payload.jobId ? await pollAutomationBrowserLaunchJob(payload.jobId) : payload;
    updateBrowserLaunchProgress(finalPayload);
    syncBrowserLaunchButtonsFromJob(finalPayload);
    const finalJob = getBrowserLaunchJob(finalPayload) || {};
    const counts = finalJob.summary || {};
    const failed = Number(counts.failed || 0);
    const needsLogin = Number(counts.needsLogin || 0);
    const ready = Number(counts.ready || 0);
    showAutomationActions("六个浏览器启动检测完成，可以继续处理消息或主动联系");
    await refreshBossAutomationSummary();
    if (!isBrowserLaunchJobDone(finalJob)) {
      setStatus(`一键启动仍在进行：就绪 ${ready}，需登录 ${needsLogin}，失败 ${failed}`, "is-working");
    } else if (failed) {
      setStatus(`一键启动完成：就绪 ${ready}，需登录 ${needsLogin}，失败 ${failed}`, "");
    } else {
      setStatus(`一键启动完成：就绪 ${ready}，需登录 ${needsLogin}，失败 0`, "is-done");
    }
  } catch (error) {
    console.error(error);
    const message = error.message || "一键启动浏览器失败";
    if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = message;
    setStatus(message);
  } finally {
    if (button) button.disabled = false;
    setBrowserLaunchButtonsDisabled(false, button);
  }
}

async function runBossAutomationTask({
  button,
  taskLabel,
  runningHint,
  runningStatus,
  summaryText,
  doneHint,
  doneStatus,
  failHint,
  failStatus,
  message,
}) {
  setBatchPanelExpanded(true);
  showBossAutomationActions(runningHint);
  setStatus(runningStatus, "is-working");
  if (button) button.disabled = true;
  if (elements.batchSummary) elements.batchSummary.textContent = summaryText;

  try {
    const payload = await requestJson("/api/boss-automation/process-messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(message ? { message } : {}),
        accountId: bossAutomationAccountId,
        options: {
          speedFactor: bossAutomationSpeedFactor,
          speedMultiplier: BOSS_AUTOMATION_BASE_SPEED_MULTIPLIER * bossAutomationSpeedFactor,
        },
      }),
    });
    const result = payload.result || {};
    const text = result.reply || result.message || payload.message || `${taskLabel}任务已完成`;
    if (elements.batchSummary) elements.batchSummary.textContent = text;
    showBossAutomationActions(doneHint);
    await refreshBossAutomationSummary(bossAutomationSummaryDate, { force: true });
    setStatus(doneStatus, "is-done");
  } catch (error) {
    console.error(error);
    const text = error.message || failStatus;
    if (elements.batchSummary) elements.batchSummary.textContent = text;
    showBossAutomationActions(failHint);
    setStatus(text);
  } finally {
    if (button) button.disabled = false;
  }
}

async function processBossMessages() {
  const state = getProcessMessagesState();
  setBatchPanelExpanded(true);
  showBossAutomationActions("点击开始处理后，智能体会处理所有已配置岗位的未读消息");
  setBossAutomationMode("process");
  if (elements.proactiveContactControlPanel) elements.proactiveContactControlPanel.hidden = true;
  if (elements.processMessagesControlPanel) elements.processMessagesControlPanel.hidden = false;
  setProcessMessagesStatus(state.running && !state.paused ? "处理中。" : state.paused ? "已暂停" : "等待开始");
  updateProcessMessagesButton();
  refreshBossAutomationSummary().catch(console.error);
}

async function startOrPauseProcessMessages() {
  const accountId = getCurrentBossAutomationAccountId();
  const state = getProcessMessagesState(accountId);
  const toggleNow = Date.now();
  if (toggleNow - state.lastToggleAt < 1200) return;
  state.lastToggleAt = toggleNow;

  if (state.running && !state.paused) {
    await pauseBossAutomation({ fromInlineControl: true, accountId });
    state.runId += 1;
    state.paused = true;
    state.running = false;
    stopProcessMessagesLiveTimers(accountId);
    if (isCurrentBossAutomationAccount(accountId)) {
      setProcessMessagesStatus("已暂停");
      updateProcessMessagesButton();
    }
    return;
  }

  if (state.paused) {
    try {
      await setBossAutomationPause(false, "用户在招聘智能体页面继续处理", accountId);
    } catch (error) {
      console.error(error);
      if (isCurrentBossAutomationAccount(accountId)) {
        setProcessMessagesStatus("继续失败");
        if (elements.batchSummary) elements.batchSummary.textContent = error.message || "继续处理失败";
        showBossAutomationActions("继续失败，可以检查智能体服务是否运行");
        updateProcessMessagesButton();
      }
      return;
    }
  }

  state.running = true;
  state.paused = false;
  const runId = ++state.runId;
  updateProcessMessagesButton();
  startProcessMessagesLiveTimers(accountId);
  setBatchPanelExpanded(true);
  if (isCurrentBossAutomationAccount(accountId)) {
    showBossAutomationActions(`正在处理${bossAutomationAccountLabel(accountId)}所有已配置岗位的未读消息，请等待任务完成`);
    setStatus(`正在处理 ${bossAutomationAccountLabel(accountId)} BOSS 全岗位消息`, "is-working");
  }
  if (isCurrentBossAutomationAccount(accountId) && elements.batchSummary) {
    elements.batchSummary.textContent = "智能体正在处理所有已配置岗位的未读消息；未配置岗位只记录并跳过。今日概览会自动刷新。";
  }

  try {
    const payload = await requestJson("/api/boss-automation/process-messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: BOSS_PROCESS_ALL_POSITIONS_MESSAGE,
        accountId,
        options: {
          speedFactor: bossAutomationSpeedFactor,
          speedMultiplier: BOSS_AUTOMATION_BASE_SPEED_MULTIPLIER * bossAutomationSpeedFactor,
        },
      }),
    });
    if (runId !== state.runId) return;
    if (state.paused) {
      stopProcessMessagesLiveTimers(accountId);
      if (isCurrentBossAutomationAccount(accountId)) {
        setProcessMessagesStatus("已暂停");
        updateProcessMessagesButton();
        await refreshBossAutomationSummary(bossAutomationSummaryDate, { force: true });
      }
      return;
    }
    const result = payload.result || {};
    const text = result.reply || result.message || payload.message || "处理消息任务已完成";
    state.running = false;
    state.paused = false;
    stopProcessMessagesLiveTimers(accountId);
    if (isCurrentBossAutomationAccount(accountId)) {
      if (elements.batchSummary) elements.batchSummary.textContent = text;
      setProcessMessagesStatus("处理完成");
      updateProcessMessagesButton();
      showBossAutomationActions("消息处理完成，可以继续执行下一轮");
      await refreshBossAutomationSummary(bossAutomationSummaryDate, { force: true });
      setStatus("消息处理完成", "is-done");
    }
  } catch (error) {
    if (runId !== state.runId) return;
    console.error(error);
    const text = error.message || "处理消息失败";
    state.running = false;
    stopProcessMessagesLiveTimers(accountId);
    if (isCurrentBossAutomationAccount(accountId)) {
      if (elements.batchSummary) elements.batchSummary.textContent = text;
      if (!state.paused) {
        setProcessMessagesStatus("处理失败");
        showBossAutomationActions("处理失败，可以检查浏览器或稍后重试");
        setStatus(text);
      }
      updateProcessMessagesButton();
    }
  }
}

async function startOrPauseProactiveBossContact() {
  const accountId = getCurrentBossAutomationAccountId();
  const state = getProactiveContactState(accountId);
  const toggleNow = Date.now();
  if (toggleNow - state.lastToggleAt < 1200) return;
  state.lastToggleAt = toggleNow;

  if (state.running && !state.paused) {
    await pauseBossAutomation({ fromInlineControl: true, accountId });
    state.paused = true;
    stopProactiveContactLiveTimers(accountId);
    if (isCurrentBossAutomationAccount(accountId)) {
      setBossAutomationMode("proactive");
      setProactiveContactStatus("已暂停");
      updateProactiveContactButton();
    }
    return;
  }

  if (state.paused) {
    try {
      await setBossAutomationPause(false, "用户在招聘智能体页面继续主动联系", accountId);
      state.paused = false;
      if (state.running) {
        startProactiveContactLiveTimers(accountId);
        if (isCurrentBossAutomationAccount(accountId)) {
          setBossAutomationMode("proactive");
          setProactiveContactStatus("继续执行中");
          updateProactiveContactButton();
        }
        return;
      }
    } catch (error) {
      console.error(error);
      if (isCurrentBossAutomationAccount(accountId)) {
        setProactiveContactStatus("继续失败");
        if (elements.batchSummary) elements.batchSummary.textContent = error.message || "继续主动联系失败";
        showBossAutomationActions("继续主动联系失败，可以检查智能体服务是否运行");
        updateProactiveContactButton();
      }
      return;
    }
  }

  await runProactiveBossContact(accountId);
}

async function runProactiveBossContact(accountId = bossAutomationAccountId) {
  const state = getProactiveContactState(accountId);
  const targetPosition = getSelectedProactiveContactPosition();
  const targetLabel = getSelectedProactiveContactPositionLabel();
  const targetCount = getProactiveContactCount();
  const customRules = getProactiveContactRules();
  const ruleSummary = describeProactiveContactRules(customRules);
  if (!targetPosition) {
    setProactiveContactStatus("请先选择岗位");
    return;
  }

  setBatchPanelExpanded(true);
  if (isCurrentBossAutomationAccount(accountId)) {
    showBossAutomationActions(`正在用${bossAutomationAccountLabel(accountId)}慢速进入推荐牛人，先查看在线简历，再按${ruleSummary}主动联系${targetLabel}候选人`);
    setBossAutomationMode("proactive");
    setStatus("正在执行主动联系", "is-working");
  }
  state.running = true;
  state.paused = false;
  const runId = ++state.runId;
  startProactiveContactLiveTimers(accountId);
  if (isCurrentBossAutomationAccount(accountId)) setProactiveContactStatus(`正在慢速主动联系：${targetLabel}，目标 ${targetCount} 人`);
  if (isCurrentBossAutomationAccount(accountId) && elements.batchSummary) {
    elements.batchSummary.textContent = `智能体会以慢速节奏进入${targetLabel}推荐页，按顺序点开在线简历，符合主动联系规则后再打招呼，目标 ${targetCount} 人；当前规则：${ruleSummary}`;
  }

  try {
    const payload = await requestJson("/api/boss-automation/proactive-contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetPosition,
        maxTotal: targetCount,
        accountId,
        requireMatch: false,
        customRules,
        options: {
          speedFactor: bossAutomationSpeedFactor,
          speedMultiplier: BOSS_AUTOMATION_BASE_SPEED_MULTIPLIER * bossAutomationSpeedFactor,
        },
      }),
    });
    if (runId !== state.runId) return;
    if (state.paused) {
      state.running = false;
      stopProactiveContactLiveTimers(accountId);
      if (isCurrentBossAutomationAccount(accountId)) {
        setProactiveContactStatus("已暂停");
        updateProactiveContactButton();
        await refreshBossAutomationSummary(bossAutomationSummaryDate, { force: true });
      }
      return;
    }
    const result = payload.result || {};
    const text = result.reply || result.message || payload.message || "主动联系任务已完成";
    state.running = false;
    state.paused = false;
    stopProactiveContactLiveTimers(accountId);
    if (isCurrentBossAutomationAccount(accountId)) {
      if (elements.batchSummary) elements.batchSummary.textContent = text;
      showBossAutomationActions("主动联系完成，可以继续处理消息或再次执行主动联系");
      setBossAutomationMode("proactive");
      setProactiveContactStatus(`已完成：${targetLabel}`);
      updateProactiveContactButton();
      await refreshBossAutomationSummary(bossAutomationSummaryDate, { force: true });
      setStatus("主动联系完成", "is-done");
    }
  } catch (error) {
    if (runId !== state.runId) return;
    console.error(error);
    const text = error.message || "主动联系失败";
    state.running = false;
    stopProactiveContactLiveTimers(accountId);
    if (isCurrentBossAutomationAccount(accountId)) {
      if (elements.batchSummary) elements.batchSummary.textContent = text;
      showBossAutomationActions("主动联系失败，可以检查推荐牛人页面是否已打开");
      setBossAutomationMode("proactive");
      setProactiveContactStatus(text);
      updateProactiveContactButton();
      setStatus(text);
    }
  }
}

async function setBossAutomationPause(paused, reason, accountId = bossAutomationAccountId) {
  return requestJson("/api/boss-automation/pause", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountId,
      paused: Boolean(paused),
      reason: reason || (paused ? "用户在招聘智能体页面点击暂停" : "用户在招聘智能体页面继续处理"),
    }),
  });
}

async function setPlatformAutomationPause(platform, paused, reason, accountId = bossAutomationAccountId) {
  const normalized = normalizeAutomationPlatform(platform);
  const config = PLATFORM_AUTOMATION_CONFIG[normalized];
  if (!config) throw new Error("未知自动化平台");
  const normalizedAccountId = normalizeBossAutomationAccountId(accountId);
  return requestJson(`${config.basePath}/pause?accountId=${encodeURIComponent(normalizedAccountId)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountId: normalizedAccountId,
      paused: Boolean(paused),
      pause: Boolean(paused),
      reason: reason || (paused ? "用户在招聘智能体页面点击暂停" : "用户在招聘智能体页面继续处理"),
    }),
  });
}

async function pauseBossAutomation({ fromInlineControl = false, accountId = bossAutomationAccountId } = {}) {
  setBatchPanelExpanded(true);
  if (isCurrentBossAutomationAccount(accountId)) {
    showBossAutomationActions("正在暂停自动化任务");
    setStatus("正在暂停自动化", "is-working");
  }

  try {
    const payload = await setBossAutomationPause(true, "用户在招聘智能体页面点击暂停", accountId);
    const text = payload.message || "自动化已暂停";
    if (isCurrentBossAutomationAccount(accountId) && elements.batchSummary) elements.batchSummary.textContent = text;
    if (fromInlineControl) return payload;
    if (isCurrentBossAutomationAccount(accountId)) {
      showBossAutomationActions("自动化已暂停，后续可以再启动或继续配置");
      setStatus("自动化已暂停", "is-done");
    }
  } catch (error) {
    console.error(error);
    const text = error.message || "暂停失败";
    if (isCurrentBossAutomationAccount(accountId)) {
      if (elements.batchSummary) elements.batchSummary.textContent = text;
      showBossAutomationActions("暂停失败，可以检查智能体服务是否运行");
      setStatus(text);
    }
  }
}

const PLATFORM_AUTOMATION_CONFIG = {
  job51: {
    label: "51job",
    basePath: "/api/51job",
    status: () => elements.job51AutomationStatus,
    processButton: () => elements.job51ProcessMessagesBtn,
    proactiveButton: () => elements.job51ProactiveContactBtn,
    quickButton: () => elements.job51QuickAutomationBtn,
    maxInput: () => elements.job51MaxTotalInput,
    positionSelect: () => elements.job51ProactivePositionSelect,
  },
  zhilian: {
    label: "智联",
    basePath: "/api/zhilian",
    status: () => elements.zhilianAutomationStatus,
    processButton: () => elements.zhilianProcessMessagesBtn,
    proactiveButton: () => elements.zhilianProactiveContactBtn,
    quickButton: () => elements.zhilianQuickAutomationBtn,
    maxInput: () => elements.zhilianMaxTotalInput,
    positionSelect: () => elements.zhilianProactivePositionSelect,
  },
};

function readPlatformLimit(input, fallback = 40) {
  const raw = Number(input?.value || fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(120, Math.round(raw)));
}

function setPlatformAutomationStatus(platform, text, state = "") {
  const config = PLATFORM_AUTOMATION_CONFIG[platform];
  const status = config?.status?.();
  if (!status) return;
  status.textContent = text || "等待操作";
  status.classList.toggle("is-working", state === "working");
  status.classList.toggle("is-done", state === "done");
  status.classList.toggle("is-error", state === "error");
}

function setPlatformAutomationDisabled(platform, disabled) {
  const normalized = normalizeAutomationPlatform(platform);
  const config = PLATFORM_AUTOMATION_CONFIG[platform];
  config?.processButton?.()?.toggleAttribute("disabled", Boolean(disabled));
  config?.proactiveButton?.()?.toggleAttribute("disabled", Boolean(disabled));
  config?.quickButton?.()?.toggleAttribute("disabled", Boolean(disabled));
  if (normalized === activeAutomationPlatform) {
    elements.processBossMessagesBtn?.toggleAttribute("disabled", Boolean(disabled));
    elements.proactiveBossContactBtn?.toggleAttribute("disabled", Boolean(disabled));
    elements.startProcessMessagesBtn?.toggleAttribute("disabled", Boolean(disabled));
    elements.startProactiveContactBtn?.toggleAttribute("disabled", Boolean(disabled));
  }
}

function platformResultText(payload, fallback) {
  const result = payload?.result || payload || {};
  if (typeof result.reply === "string" && result.reply.trim()) return result.reply.trim();
  if (typeof result.message === "string" && result.message.trim()) return result.message.trim();
  if (typeof payload?.message === "string" && payload.message.trim()) return payload.message.trim();
  const state = result.state || payload?.state || {};
  const processed = Number(state.processedPeople ?? state.processed ?? -1);
  if (Number.isFinite(processed) && processed >= 0) return `${fallback}，处理 ${processed} 人`;
  return fallback;
}

function stopPlatformAutomationLiveTimers(platform, mode, accountId = bossAutomationAccountId) {
  const state = getPlatformAutomationTaskState(platform, mode, accountId);
  window.clearInterval(state.dotsTimer);
  window.clearInterval(state.summaryTimer);
  state.dotsTimer = 0;
  state.summaryTimer = 0;
}

function setPlatformInlineStatus(platform, mode, accountId, text) {
  if (!isCurrentPlatformAutomationTask(platform, mode, accountId)) return;
  if (mode === "proactive") {
    setProactiveContactStatus(text);
  } else {
    setProcessMessagesStatus(text);
  }
}

function startPlatformAutomationLiveTimers(platform, mode, accountId = bossAutomationAccountId) {
  const state = getPlatformAutomationTaskState(platform, mode, accountId);
  stopPlatformAutomationLiveTimers(platform, mode, accountId);
  state.dotCount = 0;
  if (isCurrentPlatformAutomationTask(platform, mode, accountId)) {
    setPlatformInlineStatus(platform, mode, accountId, "可点击按钮暂停");
    syncPlatformAutomationStartControls();
  }
  state.dotsTimer = window.setInterval(() => {
    state.dotCount = (state.dotCount % 3) + 1;
    if (isCurrentPlatformAutomationTask(platform, mode, accountId)) syncPlatformAutomationStartControls();
  }, 450);
  state.summaryTimer = window.setInterval(() => {
    if (isCurrentPlatformAutomationTask(platform, mode, accountId)) refreshBossAutomationSummary();
  }, 5000);
}

async function pausePlatformAutomation(platform, mode) {
  const normalized = normalizeAutomationPlatform(platform);
  const actionMode = mode === "proactive" ? "proactive" : "process";
  const accountId = getCurrentBossAutomationAccountId();
  const state = getPlatformAutomationTaskState(normalized, actionMode, accountId);
  const now = Date.now();
  if (now - state.lastToggleAt < 1000) return;
  state.lastToggleAt = now;
  if (!state.running || state.paused) return;

  const label = automationPlatformLabel(normalized);
  const actionText = actionMode === "proactive" ? "主动联系" : "消息处理";
  try {
    await setPlatformAutomationPause(normalized, true, `用户在招聘智能体页面暂停${label}${actionText}`, accountId);
    state.runId += 1;
    state.running = false;
    state.paused = true;
    stopPlatformAutomationLiveTimers(normalized, actionMode, accountId);
    if (isCurrentPlatformAutomationTask(normalized, actionMode, accountId)) {
      setPlatformInlineStatus(normalized, actionMode, accountId, "已暂停");
      syncPlatformAutomationStartControls();
      setPlatformAutomationStatus(normalized, "已暂停", "done");
      if (elements.batchSummary) elements.batchSummary.textContent = `${label}${actionText}已暂停`;
      setStatus(`${label}${actionText}已暂停`, "is-done");
    }
  } catch (error) {
    console.error(error);
    const text = error.message || `${label}${actionText}暂停失败`;
    if (isCurrentPlatformAutomationTask(normalized, actionMode, accountId)) {
      setPlatformInlineStatus(normalized, actionMode, accountId, "暂停失败");
      syncPlatformAutomationStartControls();
      if (elements.batchSummary) elements.batchSummary.textContent = text;
      setStatus(text);
    }
  }
}

async function runPlatformAutomation(platform, mode) {
  const normalizedPlatform = normalizeAutomationPlatform(platform);
  const config = PLATFORM_AUTOMATION_CONFIG[normalizedPlatform];
  if (!config) return;

  const isProactive = mode === "proactive";
  const accountId = getCurrentBossAutomationAccountId();
  const actionMode = isProactive ? "proactive" : "process";
  const state = getPlatformAutomationTaskState(normalizedPlatform, actionMode, accountId);
  if (state.running && !state.paused) return;

  const accountLabel = bossAutomationAccountLabel(accountId);
  const limit = isProactive ? getProactiveContactCount() : readPlatformLimit(config.maxInput?.(), 40);
  const targetPosition = isProactive
    ? getSelectedProactiveContactPosition()
    : String(config.positionSelect?.()?.value || "").trim();
  const targetLabel = isProactive ? getSelectedProactiveContactPositionLabel() : targetPosition;
  const actionText = isProactive ? "主动联系" : "处理消息";
  const endpoint = `${config.basePath}/${isProactive ? "proactive-contact" : "process-messages"}?accountId=${encodeURIComponent(accountId)}`;
  const body = {
    accountId,
    maxTotal: limit,
    options: {
      cursor: true,
      humanize: true,
      pace: "fast",
      speedFactor: bossAutomationSpeedFactor,
      speedMultiplier: BOSS_AUTOMATION_BASE_SPEED_MULTIPLIER * bossAutomationSpeedFactor,
    },
  };
  if (isProactive) {
    body.targetPosition = targetPosition;
    body.dryRun = false;
  }

  if (state.paused) {
    try {
      await setPlatformAutomationPause(normalizedPlatform, false, `用户在招聘智能体页面继续${config.label}${actionText}`, accountId);
      state.paused = false;
    } catch (error) {
      console.error(error);
      const text = error.message || `${config.label}${actionText}继续失败`;
      setPlatformInlineStatus(normalizedPlatform, actionMode, accountId, "继续失败");
      syncPlatformAutomationStartControls();
      if (elements.batchSummary) elements.batchSummary.textContent = text;
      setStatus(text);
      return;
    }
  }

  state.running = true;
  state.paused = false;
  const runId = ++state.runId;
  activeAutomationPlatform = normalizedPlatform;
  setBossAutomationMode(isProactive ? "proactive" : "process");
  showAutomationActions(`${config.label} · ${accountLabel}${actionText}运行中`);
  setBatchPanelExpanded(true);
  setPlatformAutomationStatus(normalizedPlatform, "运行中", "working");
  if (isProactive) {
    if (elements.processMessagesControlPanel) elements.processMessagesControlPanel.hidden = true;
    if (elements.proactiveContactControlPanel) elements.proactiveContactControlPanel.hidden = false;
    setProactiveContactStatus("可点击按钮暂停");
  } else {
    if (elements.proactiveContactControlPanel) elements.proactiveContactControlPanel.hidden = true;
    if (elements.processMessagesControlPanel) elements.processMessagesControlPanel.hidden = false;
    setProcessMessagesStatus("可点击按钮暂停");
  }
  startPlatformAutomationLiveTimers(normalizedPlatform, actionMode, accountId);
  setStatus(`${config.label}${accountLabel}${actionText}运行中`, "is-working");
  if (elements.batchSummary) {
    elements.batchSummary.textContent = isProactive
      ? `${config.label} · ${accountLabel} 正在按 ${targetLabel || "当前岗位"} 主动联系，目标 ${limit} 人`
      : `${config.label} · ${accountLabel} 正在处理全岗位未读消息，上限 ${limit} 人`;
  }

  try {
    const payload = await requestJson(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (runId !== state.runId) return;
    const text = platformResultText(payload, `${config.label}${actionText}完成`);
    state.running = false;
    state.paused = false;
    stopPlatformAutomationLiveTimers(normalizedPlatform, actionMode, accountId);
    setPlatformAutomationStatus(normalizedPlatform, "已完成", "done");
    if (isProactive) {
      setProactiveContactStatus("主动联系完成");
    } else {
      setProcessMessagesStatus("处理完成");
    }
    if (elements.batchSummary) elements.batchSummary.textContent = text;
    setStatus(`${config.label}${actionText}完成`, "is-done");
  } catch (error) {
    if (runId !== state.runId) return;
    console.error(error);
    const text = error.message || `${config.label}${actionText}失败`;
    state.running = false;
    stopPlatformAutomationLiveTimers(normalizedPlatform, actionMode, accountId);
    setPlatformAutomationStatus(normalizedPlatform, "失败", "error");
    if (isProactive) {
      setProactiveContactStatus(text);
    } else {
      setProcessMessagesStatus(text);
    }
    if (elements.batchSummary) elements.batchSummary.textContent = text;
    setStatus(text);
  } finally {
    if (runId === state.runId) {
      state.running = false;
      stopPlatformAutomationLiveTimers(normalizedPlatform, actionMode, accountId);
      if (normalizedPlatform === activeAutomationPlatform) syncPlatformAutomationStartControls();
      await refreshBossAutomationSummary(bossAutomationSummaryDate, { force: true });
    }
  }
}

async function startOrPausePlatformAutomation(platform, mode) {
  const normalized = normalizeAutomationPlatform(platform);
  const actionMode = mode === "proactive" ? "proactive" : "process";
  const accountId = getCurrentBossAutomationAccountId();
  const state = getPlatformAutomationTaskState(normalized, actionMode, accountId);
  if (state.running && !state.paused) {
    await pausePlatformAutomation(normalized, actionMode);
    return;
  }
  await runPlatformAutomation(normalized, actionMode);
}

function openQuickAutomationPlatform(platform) {
  const normalized = normalizeAutomationPlatform(platform);
  const label = automationPlatformLabel(normalized);
  selectAutomationPlatform(normalized, `${label} 已选中，可以处理消息或主动联系`);
  if (elements.bossBrowserSummary) elements.bossBrowserSummary.textContent = `已选择 ${label} 平台`;
}

async function showPlatformProcessControls() {
  const label = automationPlatformLabel();
  setBatchPanelExpanded(true);
  setBossAutomationMode("process");
  showAutomationActions(`${label} 已选中，点击开始处理后会处理当前账号的消息`);
  if (elements.proactiveContactControlPanel) elements.proactiveContactControlPanel.hidden = true;
  if (elements.processMessagesControlPanel) elements.processMessagesControlPanel.hidden = false;
  const state = getPlatformAutomationTaskState(activeAutomationPlatform, "process");
  setProcessMessagesStatus(state.paused ? "已暂停" : state.running ? "可点击按钮暂停" : "等待开始");
  syncPlatformAutomationStartControls();
  if (elements.batchSummary) elements.batchSummary.textContent = `${label} 消息处理不会立刻执行；确认账号和速度后点击开始处理`;
  await refreshBossAutomationSummary();
}

async function showPlatformProactiveControls() {
  const label = automationPlatformLabel();
  setBatchPanelExpanded(true);
  setBossAutomationMode("proactive");
  populateProactiveContactPositions();
  applyProactiveContactRulesToForm(readStoredProactiveContactRules(getSelectedProactiveContactPosition()));
  showAutomationActions(`${label} 已选中，确认岗位后可以开始主动联系`);
  if (elements.processMessagesControlPanel) elements.processMessagesControlPanel.hidden = true;
  if (elements.proactiveContactControlPanel) elements.proactiveContactControlPanel.hidden = false;
  const state = getPlatformAutomationTaskState(activeAutomationPlatform, "proactive");
  setProactiveContactStatus(state.paused ? "已暂停" : state.running ? "可点击按钮暂停" : "请选择岗位后开始");
  syncPlatformAutomationStartControls();
  if (elements.batchSummary) elements.batchSummary.textContent = `${label} 主动联系不会立刻执行；先选择岗位，再点击开始主动联系`;
  await refreshBossAutomationSummary();
}

async function handleProcessAutomationAction() {
  await showPlatformProcessControls();
}

async function handleProactiveAutomationAction() {
  if (activeAutomationPlatform === "boss") {
    await showProactiveContactControls();
    return;
  }
  await showPlatformProactiveControls();
}

async function handleStartProcessAutomation() {
  if (activeAutomationPlatform === "boss") {
    await startOrPauseProcessMessages();
    return;
  }
  await startOrPausePlatformAutomation(activeAutomationPlatform, "process");
}

async function handleStartProactiveAutomation() {
  if (activeAutomationPlatform === "boss") {
    await startOrPauseProactiveBossContact();
    return;
  }
  await startOrPausePlatformAutomation(activeAutomationPlatform, "proactive");
}

async function restoreBatchJob() {
  const jobId = window.localStorage.getItem(BATCH_JOB_STORAGE_KEY);
  if (!jobId) return;

  try {
    const payload = await requestJson(`/api/batch-jobs/${jobId}`);
    applyBatchJob(payload.job);
    if (isBatchJobActive(payload.job)) {
      setBatchPanelExpanded(true);
      await pollBatchJob(jobId);
    }
  } catch (error) {
    console.error(error);
    window.localStorage.removeItem(BATCH_JOB_STORAGE_KEY);
  }
}

async function handleFiles(files) {
  if (isBatchRunning) {
    setStatus("批量处理中", "is-working");
    return;
  }

  const selectedFiles = [...(files || [])];
  if (!selectedFiles.length) return;

  elements.input.value = "";
  elements.fileName.textContent = selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} 个文件`;
  elements.fileCard.hidden = false;
  resetFields();

  try {
    await startBackendBatch(selectedFiles);
  } catch (error) {
    console.error(error);
    isBatchRunning = false;
    renderBatchQueue();
    setStatus(error.message || "批量任务失败");
  }
}

async function handleFile(file) {
  await handleFiles(file ? [file] : []);
}

elements.pickFileBtn.addEventListener("click", () => elements.input.click());
elements.refreshAutomationStatsBtn?.addEventListener("click", refreshAutomationStats);
elements.automationSourceButtons?.forEach((button) => {
  button.addEventListener("click", () => setAutomationSource(button.dataset.automationSource || "zhilian"));
});
elements.scanBossFolderBtn?.addEventListener("click", scanBossResumeFolder);
elements.importBossFolderBtn?.addEventListener("click", importBossResumeFolder);
elements.scanZhilianFolderBtn?.addEventListener("click", scanZhilianResumeFolder);
elements.importZhilianFolderBtn?.addEventListener("click", importZhilianResumeFolder);
elements.importEmailBtn?.addEventListener("click", importEmailResumes);
elements.toggleEmailAutoBtn?.addEventListener("click", toggleEmailAutoImport);
if (elements.bossAutomationBtn) {
  elements.bossAutomationBtn.dataset.mainHandlerReady = "1";
  elements.bossAutomationBtn.addEventListener("click", () => openQuickAutomationPlatform("boss"));
}
elements.processBossMessagesBtn?.addEventListener("click", handleProcessAutomationAction);
elements.startProcessMessagesBtn?.addEventListener("click", handleStartProcessAutomation);
elements.proactiveBossContactBtn?.addEventListener("click", handleProactiveAutomationAction);
elements.startProactiveContactBtn?.addEventListener("click", handleStartProactiveAutomation);
elements.job51QuickAutomationBtn?.addEventListener("click", () => openQuickAutomationPlatform("job51"));
elements.zhilianQuickAutomationBtn?.addEventListener("click", () => openQuickAutomationPlatform("zhilian"));
elements.browserLaunchButtons?.forEach((button) => {
  button.addEventListener("click", () => launchAutomationBrowserTarget(button));
});
elements.oneClickLaunchBrowserBtn?.addEventListener("click", oneClickLaunchAutomationBrowserJobMode);
elements.job51ProcessMessagesBtn?.addEventListener("click", async () => {
  selectAutomationPlatform("job51", "51 已选中，可以处理消息或主动联系");
  await showPlatformProcessControls();
});
elements.job51ProactiveContactBtn?.addEventListener("click", () => startOrPausePlatformAutomation("job51", "proactive"));
elements.zhilianProcessMessagesBtn?.addEventListener("click", async () => {
  selectAutomationPlatform("zhilian", "智联 已选中，可以处理消息或主动联系");
  await showPlatformProcessControls();
});
elements.zhilianProactiveContactBtn?.addEventListener("click", () => startOrPausePlatformAutomation("zhilian", "proactive"));
elements.proactiveContactPositionSelect?.addEventListener("change", handleProactiveContactPositionChange);
elements.proactiveContactCountInput?.addEventListener("change", getProactiveContactCount);
[
  elements.proactiveRuleMode,
  elements.proactiveRequireEducationCheck,
  elements.proactiveRequireAgeCheck,
  elements.proactiveRequireKeywordCheck,
  elements.proactiveMinEducationSelect,
  elements.proactiveMaxAgeInput,
  elements.proactiveKeywordModeSelect,
  elements.proactiveUnknownPolicySelect,
  elements.proactiveKeywordInput,
].forEach((element) => {
  element?.addEventListener("change", getProactiveContactRules);
  element?.addEventListener("input", () => {
    if (element === elements.proactiveKeywordInput || element === elements.proactiveMaxAgeInput) getProactiveContactRules();
  });
});
elements.bossAutomationSpeedSelect?.addEventListener("change", (event) => {
  setBossAutomationSpeed(event.target.value);
});
elements.bossAccountSwitcher?.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-account-id]");
  if (!button) return;
  setBossAutomationAccount(button.dataset.accountId);
});
elements.automationPlatformSwitcher?.addEventListener("click", (event) => {
  const button = event.target?.closest?.("[data-automation-platform]");
  if (!button) return;
  openQuickAutomationPlatform(button.dataset.automationPlatform);
});
elements.bossAutomationDateInput?.addEventListener("change", () => {
  addBossAutomationSummaryDate(elements.bossAutomationDateInput.value);
});

elements.bossAutomationTodayBtn?.addEventListener("click", () => {
  setBossAutomationSummaryDate(getChinaDateKey());
});

elements.bossAutomationAllDatesBtn?.addEventListener("click", () => {
  setBossAutomationSummaryDate("all");
});
if (elements.proactiveBossContactBtn) {
  elements.proactiveBossContactBtn.title = "选择岗位并主动联系推荐牛人";
  elements.proactiveBossContactBtn.setAttribute("aria-label", "选择岗位并主动联系推荐牛人");
}
syncEditJobTypeOptions();
populateProactiveContactPositions();
applyProactiveContactRulesToForm();
syncBossAutomationSpeedSelect();
syncBossAutomationAccountSwitcher();
elements.input.addEventListener("change", (event) => handleFiles(event.target.files));
elements.clearBtn.addEventListener("click", () => {
  elements.input.value = "";
  elements.fileCard.hidden = true;
  clearBatchPoll();
  currentBatchJobId = "";
  currentBatchStatus = "";
  window.localStorage.removeItem(BATCH_JOB_STORAGE_KEY);
  isBatchRunning = false;
  batchPage = 1;
  batchQueue = [];
  setBatchPanelExpanded(false);
  renderBatchQueue();
  resetFields();
  setStatus("等待上传");
});

elements.editForm.addEventListener("submit", saveEdit);
elements.editJobType?.addEventListener("change", () => {
  loadFeedbackTagOptions(elements.editJobType.value, {
    positiveTags: collectCheckedValues("positiveTags"),
    negativeTags: collectCheckedValues("negativeTags"),
    dimensions: collectCheckedValues("dimensions"),
  }).catch(console.error);
});
elements.feedbackForm.addEventListener("submit", saveFeedback);
elements.reEvaluateBtn?.addEventListener("click", reEvaluateCurrentResume);
elements.detailVersionRulesBtn?.addEventListener("click", showDetailVersionRules);
elements.detailPrevResumeBtn?.addEventListener("click", () => navigateResumeDetail(-1));
elements.detailNextResumeBtn?.addEventListener("click", () => navigateResumeDetail(1));
elements.closeEditBtn.addEventListener("click", () => {
  elements.editPanel.hidden = true;
  elements.pdfPages.replaceChildren();
  activeDetailResume = null;
  syncResumeDetailNavControls();
});
elements.testFeishuBtn?.addEventListener("click", testFeishuConnection);
elements.ruleToggleBtn?.addEventListener("click", () => {
  setRulePanelExpanded(elements.ruleToggleBtn.getAttribute("aria-expanded") !== "true");
});
elements.scoringRulesBtn?.addEventListener("click", toggleScoringRules);
elements.jdMatchToggleBtn?.addEventListener("click", () => {
  setJdMatchExpanded(elements.jdMatchToggleBtn.getAttribute("aria-expanded") !== "true");
});
elements.batchToggleBtn?.addEventListener("click", () => {
  setBatchPanelExpanded(elements.batchToggleBtn.getAttribute("aria-expanded") !== "true");
});
elements.batchPrevBtn?.addEventListener("click", () => {
  batchPage = Math.max(1, batchPage - 1);
  renderBatchQueue();
});
elements.batchNextBtn?.addEventListener("click", () => {
  batchPage += 1;
  renderBatchQueue();
});
elements.pauseBatchBtn?.addEventListener("click", () => updateBatchJobAction("pause", "正在暂停批量任务"));
elements.resumeBatchBtn?.addEventListener("click", () => updateBatchJobAction("resume", "正在继续批量任务"));
elements.cancelBatchBtn?.addEventListener("click", () => updateBatchJobAction("cancel", "正在取消批量任务"));

[
  elements.recordSearchInput,
  elements.schoolLevelFilter,
  elements.decisionFilter,
  elements.graduationYearFilter,
  elements.minScoreFilter,
  elements.maxScoreFilter,
  elements.manualReviewFilter,
  elements.recordSortSelect,
]
  .filter(Boolean)
  .forEach((input) => {
    const updateFilteredView = () => {
      recordsPage = 1;
      refreshResumeView();
    };
    input.addEventListener("input", updateFilteredView);
    input.addEventListener("change", updateFilteredView);
  });

elements.recordFieldDisplaySelect?.addEventListener("change", () => {
  visibleResumeTableFieldKeys = normalizeResumeTableFieldKeys(getSelectedFilterValues(elements.recordFieldDisplaySelect));
  saveResumeTableFieldPreferences();
  syncResumeTableFieldSelect();
  renderResumeTable(getFilteredResumes(resumeCache));
});

elements.resumeCalendarInput?.addEventListener("change", () => {
  const nextDate = normalizeDateKey(elements.resumeCalendarInput.value);
  if (nextDate && !activeResumeDates.includes(nextDate)) {
    activeResumeDates = [...activeResumeDates, nextDate].sort();
  }
  recordsPage = 1;
  refreshResumeView();
});

elements.resumeCalendarTodayBtn?.addEventListener("click", () => {
  activeResumeDates = [getChinaDateKey()];
  recordsPage = 1;
  refreshResumeView();
});

elements.resumeCalendarAllBtn?.addEventListener("click", () => {
  activeResumeDates = [];
  recordsPage = 1;
  refreshResumeView();
});

elements.jdProfileSelect?.addEventListener("change", syncJdProfileSelection);
elements.runJdMatchBtn?.addEventListener("click", runJdMatch);
elements.addJdTagBtn?.addEventListener("click", () => {
  updateJdTagOverride("add", elements.jdTagGroupSelect?.value, elements.jdTagInput?.value);
});
elements.jdTagInput?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  updateJdTagOverride("add", elements.jdTagGroupSelect?.value, elements.jdTagInput?.value);
});

elements.recordsPrevBtn?.addEventListener("click", () => {
  recordsPage = Math.max(1, recordsPage - 1);
  renderResumeTable(getFilteredResumes(resumeCache));
});

elements.recordsNextBtn?.addEventListener("click", () => {
  recordsPage += 1;
  renderResumeTable(getFilteredResumes(resumeCache));
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (document.body.classList.contains("details-dialog-open")) return;
  if (elements.editPanel?.hidden || !activeDetailResume?.id) return;
  if (isResumeNavigationInputTarget(event.target)) return;
  event.preventDefault();
  navigateResumeDetail(event.key === "ArrowLeft" ? -1 : 1);
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
});

elements.dropZone.addEventListener("drop", (event) => {
  handleFiles(event.dataTransfer.files);
});

elements.retryFailedBtn.addEventListener("click", () => {
  retryFailedBatchItems();
});

window.addEventListener("popstate", refreshResumeView);

refreshAutomationStats().catch((error) => console.warn(error));
refreshEmailAutoStatus().catch((error) => console.warn(error));
emailAutoStatusTimer = window.setInterval(() => {
  refreshEmailAutoStatus().catch((error) => console.warn(error));
}, 30000);

loadFeedbackTagOptions(getActiveJobType() || RESUME_LIBRARY_JOB_TYPES[0]).catch(console.error);

Promise.all([loadResumeList(), loadRuleSuggestions(), loadScoringRules()])
  .then(() => restoreBatchJob())
  .catch((error) => {
    console.error(error);
    renderResumeTableHeader();
    elements.tableBody.innerHTML = `<tr><td colspan="${getResumeTableColumnCount()}">简历库加载失败</td></tr>`;
  });

