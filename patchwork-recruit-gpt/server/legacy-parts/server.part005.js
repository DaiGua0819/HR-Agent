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

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
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

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const resumeMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)$/);
  const resumeReEvaluateMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/re-evaluate$/);
  const resumeFeedbackMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/feedback$/);
  const resumePdfMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/pdf$/);
  const resumeConversationMatch = url.pathname.match(/^\/api\/resumes\/([^/]+)\/conversation$/);
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


