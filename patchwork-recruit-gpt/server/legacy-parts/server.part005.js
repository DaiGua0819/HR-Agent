    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("PDF not found");
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      timeoutMs = 12000,
      timeoutMessage = "复制超时",
      failureMessage = "复制失败",
      ...spawnOptions
    } = options || {};
    const child = spawn(command, args, { windowsHide: true, ...spawnOptions });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || failureMessage));
      }
    });
  });
}

async function copyPdfFileToClipboard(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (path.extname(resolvedPath).toLowerCase() !== ".pdf") {
    throw new Error("只能复制 PDF 文件");
  }
  await fs.access(resolvedPath);
  const escapedPath = resolvedPath.replace(/'/g, "''");
  const command = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$files = New-Object System.Collections.Specialized.StringCollection",
    `[void]$files.Add('${escapedPath}')`,
    "$data = New-Object System.Windows.Forms.DataObject",
    "$data.SetFileDropList($files)",
    "[System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 300)",
  ].join("; ");
  const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await runProcess("powershell.exe", ["-NoProfile", "-STA", "-NonInteractive", "-EncodedCommand", encodedCommand]);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError || new Error("复制失败");
}

async function handleCopyResumePdf(id, response) {
  try {
    const { record } = await findResume(id);
    if (!record) {
      sendJson(response, 404, { ok: false, error: "简历不存在" });
      return;
    }
    const pdfPath = record.pdfPath || path.join(UPLOAD_DIR, `${id}.pdf`);
    await fs.access(pdfPath);
    await fs.mkdir(RESUME_COPY_DIR, { recursive: true });
    const fileName = buildResumeCopyFileName(record);
    const copiedPdfPath = path.join(RESUME_COPY_DIR, fileName);
    await fs.copyFile(pdfPath, copiedPdfPath);
    await copyPdfFileToClipboard(copiedPdfPath);
    sendJson(response, 200, { ok: true, message: "复制成功", fileName, filePath: copiedPdfPath });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message || "复制失败" });
  }
}

function requestBaseUrl(request = {}) {
  const host = String(request.headers?.host || "").trim();
  return host ? `http://${host}` : `http://${HOST}:${PORT}`;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, requestBaseUrl(request));
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const targetPath = path.normalize(path.join(ROOT, pathname));
  const rootWithSeparator = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

  if (targetPath !== ROOT && !targetPath.startsWith(rootWithSeparator)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(targetPath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(targetPath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  }
}

const PARTIAL_PROGRESS_ACTIONS = new Set([
  "sent_basic_conditions",
  "position_screening_sent_waiting",
  "basic_conditions_sent_waiting",
  "accepted_requested_resume",
  "knowledge_answered_and_requested_resume",
  "accepted_resume_already_requested",
  "knowledge_answered_resume_already_requested",
  "accepted_resume_downloaded",
  "knowledge_answered_resume_downloaded",
  "resume_downloaded",
  "knowledge_answered",
  "knowledge_answered_and_sent_screening",
  "rejected_skipped",
  "unconfigured_position_skipped",
  "unclear_or_waiting_skipped",
  "blocked",
]);

const PARTIAL_REQUESTED_RESUME_ACTIONS = new Set([
  "accepted_requested_resume",
  "knowledge_answered_and_requested_resume",
  "accepted_resume_already_requested",
  "knowledge_answered_resume_already_requested",
]);

const PARTIAL_DOWNLOADED_RESUME_ACTIONS = new Set([
  "accepted_resume_downloaded",
  "knowledge_answered_resume_downloaded",
  "resume_downloaded",
]);

function parseChinaDateTimeMs(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const zonedMs = Date.parse(text);
    return Number.isFinite(zonedMs) ? zonedMs : 0;
  }
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]) - 8,
      Number(match[5]),
      Number(match[6] || 0)
    );
  }
  const isoMs = Date.parse(text);
  return Number.isFinite(isoMs) ? isoMs : 0;
}

function automationAgentScopedFile(baseName, sourceKey) {
  const parsed = path.parse(baseName);
  const normalizedSource = String(sourceKey || "").trim();
  if (!normalizedSource || normalizedSource === "boss_a" || normalizedSource === "default") {
    return path.join(AUTOMATION_WORKSPACE, baseName);
  }
  return path.join(AUTOMATION_WORKSPACE, `${parsed.name}.${normalizedSource}${parsed.ext}`);
}

async function readJsonArrayFile(filePath) {
  if (!filePath || !fsSync.existsSync(filePath)) return [];
  const payload = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return Object.values(payload);
  return [];
}

function normalizePartialProgressAction(rawAction, item = {}) {
  const action = String(rawAction || "").trim();
  const lower = action.toLowerCase();
  if (!lower) return "";
  if (PARTIAL_PROGRESS_ACTIONS.has(lower)) return lower;
  if (lower.includes("resume_downloaded") || lower === "done_resume_downloaded") {
    return lower.includes("knowledge") ? "knowledge_answered_resume_downloaded" : "accepted_resume_downloaded";
  }
  if (lower.includes("resume_already_requested") || lower === "done_resume_already_requested") {
    return lower.includes("knowledge") ? "knowledge_answered_resume_already_requested" : "accepted_resume_already_requested";
  }
  if (lower.includes("resume_requested") || lower === "done_resume_requested") {
    return lower.includes("knowledge") ? "knowledge_answered_and_requested_resume" : "accepted_requested_resume";
  }
  if (lower.endsWith("_sent_waiting") || lower === "wait_candidate_reply") {
    const status = String(item.status || "").trim().toLowerCase();
    if (status.startsWith("knowledge_answered")) return "knowledge_answered";
    if (status.includes("position_screening")) return "position_screening_sent_waiting";
    if (status.includes("basic_conditions")) return "basic_conditions_sent_waiting";
    return "sent_basic_conditions";
  }
  if (lower.startsWith("knowledge_answered")) return "knowledge_answered";
  if (lower === "knowledge_silent_skipped") return "unclear_or_waiting_skipped";
  if (lower.endsWith("_rejected") || lower === "done_skip_unsuitable") return "rejected_skipped";
  if (lower.endsWith("_unclear") || lower.endsWith("_waiting") || lower === "wait_or_manual_review") {
    return "unclear_or_waiting_skipped";
  }
  if (lower.includes("unconfigured_position")) return "unconfigured_position_skipped";
  if (lower.includes("blocked") || lower.startsWith("retry_")) return "blocked";
  return "";
}

function partialProgressAction(item = {}) {
  return (
    normalizePartialProgressAction(item.action, item) ||
    normalizePartialProgressAction(item.status, item) ||
    normalizePartialProgressAction(item.nextAction, item)
  );
}

function partialProgressKey(item = {}) {
  const identity = item.candidateIdentity && typeof item.candidateIdentity === "object" ? item.candidateIdentity : {};
  const key = [
    item.conversationKey,
    item.candidateIdentityKey,
    identity.identityKey,
    identity.conversationKey,
    item.candidateName,
    item.candidateLabel,
  ].map((value) => String(value || "").trim()).find(Boolean);
  if (key) return key;
  return crypto.createHash("sha1").update(JSON.stringify(item)).digest("hex").slice(0, 24);
}

function choosePartialProgressAction(actions) {
  const priority = [
    ...PARTIAL_DOWNLOADED_RESUME_ACTIONS,
    ...PARTIAL_REQUESTED_RESUME_ACTIONS,
    "position_screening_sent_waiting",
    "knowledge_answered_and_sent_screening",
    "basic_conditions_sent_waiting",
    "sent_basic_conditions",
    "knowledge_answered",
    "rejected_skipped",
    "blocked",
    "unconfigured_position_skipped",
    "unclear_or_waiting_skipped",
  ];
  for (const action of priority) {
    if (actions.has(action)) return action;
  }
  return Array.from(actions)[0] || "processed";
}

async function recoverAutomation24hPartialStats({ target, roundStartedAt } = {}) {
  if (!target || target.platform !== "boss") {
    return { ok: true, recovered: false, source: "unsupported_platform" };
  }
  const sourceKey = target.sourceKey || automationBrowserSourceKey(target.platform, target.accountId);
  const decisionLogPath = automationAgentScopedFile("recruiter_decision_log.json", sourceKey);
  const parsedStartMs = parseChinaDateTimeMs(roundStartedAt);
  const startMs = parsedStartMs ? parsedStartMs - 5000 : 0;
  const endMs = Date.now() + 60000;
  if (!parsedStartMs) {
    return { ok: false, recovered: false, source: "decision_log", message: "missing round start time" };
  }

  const rows = await readJsonArrayFile(decisionLogPath);
  const byConversation = new Map();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const itemMs = parseChinaDateTimeMs(item.time || item.updatedAt || item.createdAt);
    if (!itemMs || itemMs < startMs || itemMs > endMs) continue;
    const action = partialProgressAction(item);
    if (!PARTIAL_PROGRESS_ACTIONS.has(action)) continue;
    const key = partialProgressKey(item);
    if (!byConversation.has(key)) {
      byConversation.set(key, { actions: new Set(), item });
    }
    byConversation.get(key).actions.add(action);
  }

  const counts = {};
  let requestedResume = 0;
  let downloadedResume = 0;
  for (const record of byConversation.values()) {
    const primaryAction = choosePartialProgressAction(record.actions);
    counts[primaryAction] = (counts[primaryAction] || 0) + 1;
    if ([...record.actions].some((action) => PARTIAL_DOWNLOADED_RESUME_ACTIONS.has(action))) {
      downloadedResume += 1;
    } else if ([...record.actions].some((action) => PARTIAL_REQUESTED_RESUME_ACTIONS.has(action))) {
      requestedResume += 1;
    }
  }

  const processed = byConversation.size;
  return {
    ok: true,
    recovered: processed > 0 || requestedResume > 0 || downloadedResume > 0,
    source: "decision_log",
    processed,
    requestedResume,
    downloadedResume,
    counts,
    message: processed > 0 ? `Recovered ${processed} processed conversations from ${path.basename(decisionLogPath)}` : "",
    details: {
      filePath: decisionLogPath,
      since: roundStartedAt,
      scanned: rows.length,
    },
  };
}

const automation24hScheduler = createAutomation24hScheduler({
  dataDir: DATA_DIR,
  targets: DEFAULT_BROWSER_LAUNCH_TARGETS,
  concurrency: 2,
  maxRoundsPerTarget: 2,
  cycleDelayMs: Math.max(60000, Number(process.env.AUTOMATION_24H_CYCLE_DELAY_MS || 15 * 60 * 1000)),
  maxTotalPerRound: Math.max(1, Math.min(Number(process.env.AUTOMATION_24H_MAX_TOTAL || 40), 120)),
  sleep,
  fetchAgentJson,
  recoverPartialStats: recoverAutomation24hPartialStats,
  resolveTarget(spec = {}) {
    const accountId = normalizeBossAutomationAccountId(spec.accountId || spec.account || "boss_a");
    const platform = normalizeAutomationPlatformId(spec.platform || spec.source || "boss");
    const account = getBrowserAutomationAccounts(accountId)[0];
    if (!account) throw new Error(`未找到自动化账号：${accountId}`);
    return getAutomationBrowserRuntimeTarget(account, platform);
  },
  async prepareTargetBrowser(target) {
    return startBrowserTarget(target.account, target.platform, { waitTimeoutMs: 45000 });
  },
  async ensureTargetReady(target) {
    const cdpReady = target.cdpPort ? await isCdpReady(target.cdpPort).catch(() => false) : false;
    if (!cdpReady) {
      throw new Error(`${target.label || target.platformLabel || target.platform} 浏览器 CDP 未就绪，需要重新打开浏览器`);
    }
    const browser = await inspectAutomationBrowserStatusPage(target);
    if (!browser.page && !browser.authenticated) {
      throw new Error(`${target.label || target.platformLabel || target.platform} 浏览器页面未就绪，需要重新打开浏览器`);
    }
    if (browser.captcha || browser.needsLogin || browser.accountAbnormal) {
      return {
        ...browser,
        cdpPort: target.cdpPort || 0,
        agentPort: target.agentPort || 0,
        captcha: Boolean(browser.captcha),
        needsLogin: Boolean(browser.needsLogin),
        accountAbnormal: Boolean(browser.accountAbnormal),
      };
    }
    const agent = await ensureAutomationBrowserAgentReady(target);
    return {
      ...browser,
      agent,
      cdpPort: target.cdpPort || 0,
      agentPort: target.agentPort || 0,
      agentReady: Boolean(agent.ready),
      captcha: Boolean(browser.captcha),
      needsLogin: Boolean(browser.needsLogin),
      accountAbnormal: Boolean(browser.accountAbnormal),
    };
  },
  async cleanupTarget(target) {
    const agent = target.agentPort
      ? await stopAutomationLocalPort(target.agentPort, "agent")
      : { ok: true, kind: "agent", skipped: true, reason: "agent_port_missing" };
    return {
      ok: Boolean(agent.ok),
      cdpPort: target.cdpPort || 0,
      agentPort: target.agentPort || 0,
      browser: { ok: true, kind: "browser", skipped: true, keptOpen: true, reason: "browser_kept_open" },
      agent,
    };
  },
});

async function handleAutomation24hStart(request, response) {
  try {
    sendJson(response, 200, await automation24hScheduler.start());
  } catch (error) {
    sendJson(response, error.statusCode || 500, { ok: false, error: error.message || "启动24小时自动运转失败" });
  }
}

async function handleAutomation24hStop(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    sendJson(response, 200, await automation24hScheduler.stop(body.reason || "用户确认中断24小时自动运转"));
  } catch (error) {
    sendJson(response, error.statusCode || 500, { ok: false, error: error.message || "停止24小时自动运转失败" });
  }
}

function handleAutomation24hStatus(request, response) {
  sendJson(response, 200, automation24hScheduler.status());
}

async function handleAutomation24hSettings(request, response) {
  try {
    if (request.method === "GET") {
      const current = automation24hScheduler.status();
      sendJson(response, 200, { ok: true, settings: current.settings || {} });
      return;
    }
    const body = await readJsonBody(request).catch(() => ({}));
    sendJson(response, 200, await automation24hScheduler.updateSettings(body));
  } catch (error) {
    sendJson(response, error.statusCode || 500, { ok: false, error: error.message || "更新24小时自动运转设置失败" });
  }
}

async function handleAutomation24hLogs(request, response) {
  try {
    const url = new URL(request.url, requestBaseUrl(request));
    sendJson(response, 200, await automation24hScheduler.readLogs(url.searchParams.get("date") || ""));
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message || "读取24小时自动运转日志失败" });
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, requestBaseUrl(request));
  const resumeMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)$/);
  const resumeReEvaluateMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/re-evaluate$/);
  const resumeFeedbackMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/feedback$/);
  const resumePdfMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/pdf$/);
  const resumeConversationMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/conversation$/);
  const resumeInterviewInviteMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/interview-invite$/);
  const resumeCopyPdfMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/copy-pdf$/);
  const ruleSuggestionActionMatch = url.pathname.match(/^\/api\/rule-suggestions\/([^/]+)\/(adopt|reject)$/);
  const batchJobMatch = url.pathname.match(/^\/api\/batch-jobs\/([^/]+)$/);
  const batchJobFilesMatch = url.pathname.match(/^\/api\/batch-jobs\/([^/]+)\/files$/);
  const batchJobActionMatch = url.pathname.match(/^\/api\/batch-jobs\/([^/]+)\/(start|retry|pause|resume|cancel)$/);
  const automationBrowserJobMatch = url.pathname.match(/^\/api\/automation-browser\/jobs\/([^/]+)$/);

  if (request.method === "GET" && url.pathname === "/api/boss-automation/summary") {
    handleBossAutomationSummary(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/platform-automation/summary") {
    handlePlatformAutomationSummary(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/boss-automation/details") {
    const accountId = normalizeBossAutomationAccountId(url.searchParams.get("accountId") || "all");
    handleAutomationDetails(request, response, "boss", bossAutomationSources(accountId), accountId);
    return;
  }

  if (request.method === "GET" && (url.pathname === "/api/51-automation/details" || url.pathname === "/api/51job-automation/details")) {
    handlePlatformAutomationDetails(request, response, "51job");
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/zhilian-automation/details") {
    handlePlatformAutomationDetails(request, response, "zhilian");
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/recruiter-automation/details") {
    const sourceKey = normalizeAutomationSummarySource(url.searchParams.get("source") || url.searchParams.get("platform") || "zhilian");
    const platform = AUTOMATION_SUMMARY_SOURCES[sourceKey]?.platform || sourceKey;
    handleAutomationDetails(request, response, platform, [sourceKey], sourceKey);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/automation-browser/start") {
    handleStartAutomationBrowser(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/automation-browser/stop") {
    handleStopAutomationBrowser(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/automation-browser/status") {
    handleAutomationBrowserStatus(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/automation-24h/start") {
    handleAutomation24hStart(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/automation-24h/stop") {
    handleAutomation24hStop(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/automation-24h/status") {
    handleAutomation24hStatus(request, response);
    return;
  }

  if ((request.method === "GET" || request.method === "POST") && url.pathname === "/api/automation-24h/settings") {
    handleAutomation24hSettings(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/automation-24h/logs") {
    handleAutomation24hLogs(request, response);
    return;
  }

  if (automationBrowserJobMatch && request.method === "GET") {
    handleGetAutomationBrowserJob(automationBrowserJobMatch[1], response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/boss-automation/start") {
    handleBossAutomationStart(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/boss-automation/process-messages") {
    handleBossAutomationProcessMessages(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/boss-automation/proactive-contact") {
    handleBossAutomationProactiveContact(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/boss-automation/pause") {
    handleBossAutomationPause(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/51job/pause") {
    proxyPlatformAutomationResponse(request, response, "51job", "/api/pause", { timeoutMs: 30000 });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/zhilian/pause") {
    proxyPlatformAutomationResponse(request, response, "zhilian", "/api/pause", { timeoutMs: 30000 });
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/51job/")) {
    proxyPlatformAutomationResponse(request, response, "51job", `${url.pathname}${url.search}`);
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/zhilian/")) {
    proxyPlatformAutomationResponse(request, response, "zhilian", `${url.pathname}${url.search}`);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/parse-resume-pdf") {
    handleParseResumePdf(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/parse-resume-text") {
    handleParseResumeText(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/feishu/status") {
    handleFeishuStatus(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/recruiter-automation/summary") {
    handleRecruiterAutomationSummary(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/batch-jobs") {
    handleCreateBatchJob(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/import-folder/boss-resumes") {
    handleImportBossResumeFolder(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/import-folder/boss-resumes/scan") {
    handleScanBossResumeFolder(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/import-folder/zhilian-resumes") {
    handleImportZhilianResumeFolder(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/import-folder/zhilian-resumes/scan") {
    handleScanZhilianResumeFolder(request, response);
    return;
  }

  if (
    request.method === "POST" &&
    (url.pathname === "/api/import-folder/51job-resumes" ||
      url.pathname === "/api/import-folder/job51-resumes" ||
      url.pathname === "/api/import-folder/51-resumes")
  ) {
    handleImportJob51ResumeFolder(request, response);
    return;
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/api/import-folder/51job-resumes/scan" ||
      url.pathname === "/api/import-folder/job51-resumes/scan" ||
      url.pathname === "/api/import-folder/51-resumes/scan")
  ) {
    handleScanJob51ResumeFolder(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/boss-browser/status") {
    handleBossBrowserStatus(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/boss-browser/download-current-page") {
    handleBossBrowserDownload(request, response);
    return;
  }

  if (
    request.method === "POST" &&
    (url.pathname === "/api/email/resumes/download" || url.pathname === "/api/email/qq-resumes/import")
  ) {
    handleImportEmailResumes(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/email/resumes/auto-status") {
    handleEmailAutoImportStatus(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/email/resumes/auto") {
    handleSetEmailAutoImport(request, response);
    return;
  }

  if (batchJobMatch && request.method === "GET") {
    handleGetBatchJob(batchJobMatch[1], response);
    return;
  }

  if (batchJobFilesMatch && request.method === "POST") {
    handleAddBatchFile(batchJobFilesMatch[1], request, response);
    return;
  }

  if (batchJobActionMatch && request.method === "POST") {
    if (batchJobActionMatch[2] === "start") {
      handleStartBatchJob(batchJobActionMatch[1], response);
    } else if (batchJobActionMatch[2] === "retry") {
      handleRetryBatchJob(batchJobActionMatch[1], response);
    } else if (batchJobActionMatch[2] === "pause") {
      handlePauseBatchJob(batchJobActionMatch[1], response);
    } else if (batchJobActionMatch[2] === "resume") {
      handleResumeBatchJob(batchJobActionMatch[1], response);
    } else {
      handleCancelBatchJob(batchJobActionMatch[1], response);
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/resumes") {
    handleListResumes(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/rule-suggestions") {
    handleListRuleSuggestions(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/scoring-rules") {
    handleGetScoringRules(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/jd-match/profiles") {
    handleListJdProfiles(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/jd-match/run") {
    handleRunJdMatch(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/jd-match/tags") {
    handleUpdateJdTags(request, response);
    return;
  }

  if (ruleSuggestionActionMatch && request.method === "POST") {
    handleUpdateRuleSuggestion(ruleSuggestionActionMatch[1], ruleSuggestionActionMatch[2], response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/resumes") {
    handleCreateResume(request, response);
    return;
  }

  if (resumeMatch && request.method === "GET") {
    handleGetResume(resumeMatch[1], response);
    return;
  }

  if (resumeConversationMatch && request.method === "GET") {
    handleGetResumeConversation(resumeConversationMatch[1], response);
    return;
  }

  if (resumeInterviewInviteMatch && request.method === "POST") {
    handleResumeInterviewInvite(resumeInterviewInviteMatch[1], request, response).catch((error) => {
      sendJson(response, error.statusCode || 500, { ok: false, error: error.message || "约面试失败" });
    });
    return;
  }

  if (resumeMatch && request.method === "PUT") {
    handleUpdateResume(resumeMatch[1], request, response);
    return;
  }

  if (resumeMatch && request.method === "DELETE") {
    handleDeleteResume(resumeMatch[1], response);
    return;
  }

  if (resumeReEvaluateMatch && request.method === "POST") {
    handleReEvaluateResume(resumeReEvaluateMatch[1], response);
    return;
  }

  if (resumeFeedbackMatch && request.method === "POST") {
    handleResumeFeedback(resumeFeedbackMatch[1], request, response);
    return;
  }

  if (resumePdfMatch && request.method === "POST") {
    handleUploadResumePdf(resumePdfMatch[1], request, response);
    return;
  }

  if (resumePdfMatch && request.method === "GET") {
    handleServeResumePdf(resumePdfMatch[1], response);
    return;
  }

  if (resumeCopyPdfMatch && request.method === "POST") {
    handleCopyResumePdf(resumeCopyPdfMatch[1], response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    serveStatic(request, response);
    return;
  }

  response.writeHead(405);
  response.end("Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`招聘智能体服务已启动: http://${HOST}:${PORT}/index.html`);
  startZhilianResumeAutoImport();
  startJob51ResumeAutoImport();
  if (emailAutoImportEnabled) {
    startEmailAutoImportTimer();
    setTimeout(() => {
      runEmailResumeAutoImport().catch((error) => {
        emailAutoImportLastError = error.message || "邮箱自动检测失败";
      });
    }, 1000);
  }
});


