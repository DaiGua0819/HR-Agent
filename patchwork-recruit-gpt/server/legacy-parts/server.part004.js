    .prepare("SELECT COUNT(*) AS count FROM batch_items WHERE job_id = ? AND status = 'failed'")
    .get(jobId).count;
  updateBatchJobStatus(jobId, failed > 0 ? "completed_with_errors" : "completed");
}

function startBatchWorker(jobId) {
  if (batchWorkers.has(jobId)) return;
  const worker = processBatchJob(jobId).finally(() => {
    batchWorkers.delete(jobId);
  });
  batchWorkers.set(jobId, worker);
}

async function handleCreateBatchJob(request, response) {
  try {
    await ensureDatabase();
    const body = await readJsonBody(request).catch(() => ({}));
    const parseMode = body.parseMode === "fast" ? "fast" : "direct";
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    getDb()
      .prepare("INSERT INTO batch_jobs (id, parse_mode, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)")
      .run(id, parseMode, now, now);

    sendJson(response, 201, { job: await getPublicBatchJob(id) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "创建批量任务失败" });
  }
}

async function handleAddBatchFile(jobId, request, response) {
  try {
    await ensureDatabase();
    const job = getDb().prepare("SELECT id, status FROM batch_jobs WHERE id = ?").get(jobId);
    if (!job) {
      sendJson(response, 404, { error: "批量任务不存在" });
      return;
    }

    if (job.status !== "pending") {
      sendJson(response, 409, { error: "批量任务已开始，不能继续追加文件" });
      return;
    }

    const filename = decodeURIComponent(request.headers["x-file-name"] || "");
    const mimeType = request.headers["content-type"] || "";
    const pdfBuffer = await readRequestBuffer(request);
    assertPdfPayload({ filename, mimeType, pdfBuffer });

    const itemId = crypto.randomUUID();
    const filePath = path.join(BATCH_UPLOAD_DIR, `${jobId}-${itemId}.pdf`);
    const now = new Date().toISOString();
    await fs.writeFile(filePath, pdfBuffer);
    getDb()
      .prepare(
        `INSERT INTO batch_items
          (id, job_id, filename, file_path, status, message, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, '{}', ?, ?)`
      )
      .run(itemId, jobId, filename, filePath, "等待后端队列处理", now, now);

    sendJson(response, 201, { job: await getPublicBatchJob(jobId) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "上传批量文件失败" });
  }
}

async function handleGetBatchJob(jobId, response) {
  try {
    const job = await getPublicBatchJob(jobId);
    if (!job) {
      sendJson(response, 404, { error: "批量任务不存在" });
      return;
    }
    sendJson(response, 200, { job });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "加载批量任务失败" });
  }
}

async function handleStartBatchJob(jobId, response) {
  try {
    await ensureDatabase();
    const job = getDb().prepare("SELECT id, status FROM batch_jobs WHERE id = ?").get(jobId);
    if (!job) {
      sendJson(response, 404, { error: "批量任务不存在" });
      return;
    }
    if (!["pending", "running"].includes(job.status)) {
      sendJson(response, 409, { error: "当前批量任务不可启动" });
      return;
    }

    startBatchWorker(jobId);
    sendJson(response, 200, { job: await getPublicBatchJob(jobId) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "启动批量任务失败" });
  }
}

async function handleRetryBatchJob(jobId, response) {
  try {
    await ensureDatabase();
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        "UPDATE batch_items SET status = 'pending', message = ?, resume_id = NULL, updated_at = ? WHERE job_id = ? AND status = 'failed'"
      )
      .run("等待重试", now, jobId);

    if (!result.changes) {
      sendJson(response, 409, { error: "没有可重试的失败项" });
      return;
    }

    updateBatchJobStatus(jobId, "pending");
    startBatchWorker(jobId);
    sendJson(response, 200, { job: await getPublicBatchJob(jobId) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "重试批量任务失败" });
  }
}

async function handlePauseBatchJob(jobId, response) {
  try {
    await ensureDatabase();
    const job = getDb().prepare("SELECT id, status FROM batch_jobs WHERE id = ?").get(jobId);
    if (!job) {
      sendJson(response, 404, { error: "批量任务不存在" });
      return;
    }
    if (!["pending", "running"].includes(job.status)) {
      sendJson(response, 409, { error: "当前批量任务不可暂停" });
      return;
    }

    updateBatchJobStatus(jobId, "paused");
    sendJson(response, 200, { job: await getPublicBatchJob(jobId) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "暂停批量任务失败" });
  }
}

async function handleResumeBatchJob(jobId, response) {
  try {
    await ensureDatabase();
    const job = getDb().prepare("SELECT id, status FROM batch_jobs WHERE id = ?").get(jobId);
    if (!job) {
      sendJson(response, 404, { error: "批量任务不存在" });
      return;
    }
    if (job.status !== "paused") {
      sendJson(response, 409, { error: "只有已暂停任务可以继续" });
      return;
    }

    updateBatchJobStatus(jobId, "pending");
    startBatchWorker(jobId);
    sendJson(response, 200, { job: await getPublicBatchJob(jobId) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "继续批量任务失败" });
  }
}

async function handleCancelBatchJob(jobId, response) {
  try {
    await ensureDatabase();
    const job = getDb().prepare("SELECT id, status FROM batch_jobs WHERE id = ?").get(jobId);
    if (!job) {
      sendJson(response, 404, { error: "批量任务不存在" });
      return;
    }
    if (["completed", "completed_with_errors", "cancelled"].includes(job.status)) {
      sendJson(response, 409, { error: "当前批量任务不可取消" });
      return;
    }

    const now = new Date().toISOString();
    updateBatchJobStatus(jobId, "cancelled");
    getDb()
      .prepare(
        "UPDATE batch_items SET status = 'cancelled', message = ?, updated_at = ? WHERE job_id = ? AND status = 'pending'"
      )
      .run("任务已取消", now, jobId);
    sendJson(response, 200, { job: await getPublicBatchJob(jobId) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "取消批量任务失败" });
  }
}

function getFolderImportSourceById(sourceId) {
  return Object.values(FOLDER_IMPORT_SOURCES).find((source) => source.id === sourceId) || null;
}

function listFolderResumePdfFilesSync(source) {
  if (!source?.folder || !fsSync.existsSync(source.folder)) return [];
  const files = [];
  const walk = (folder, depth = 0) => {
    let entries = [];
    try {
      entries = fsSync.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const filePath = path.join(folder, entry.name);
      if (entry.isDirectory() && source.recursive && depth < 4) {
        walk(filePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) continue;
      if (source.includeFilePath && !source.includeFilePath(filePath)) continue;
      files.push(filePath);
    }
  };
  walk(source.folder);
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), "zh-Hans-CN"));
}

function fileHashMatches(filePath, expectedHash = "") {
  if (!filePath || !fsSync.existsSync(filePath)) return false;
  if (!expectedHash) return true;
  try {
    const hash = crypto.createHash("sha256").update(fsSync.readFileSync(filePath)).digest("hex");
    return hash === expectedHash;
  } catch {
    return false;
  }
}

function resolveBatchItemFileReference(item = {}, payload = {}) {
  const source = getFolderImportSourceById(payload.source || "");
  const expectedHash = String(payload.sourceHash || "").trim();
  const candidatePaths = [
    item.file_path,
    payload.filePath,
    payload.sourcePath,
    payload.pdfPath,
    payload.path,
    payload.originalPath,
    payload.targetPath,
  ].filter(Boolean);

  for (const filePath of candidatePaths) {
    if (fileHashMatches(filePath, expectedHash)) {
      return {
        filePath,
        sourcePath: source ? filePath : payload.sourcePath || filePath,
      };
    }
  }

  if (!source) return { filePath: "", sourcePath: payload.sourcePath || "" };

  const filename = path.basename(item.filename || payload.filename || payload.fileName || payload.sourcePath || "");
  const files = listFolderResumePdfFilesSync(source);
  const sameNameFiles = filename ? files.filter((filePath) => path.basename(filePath) === filename) : [];
  const searchGroups = [sameNameFiles, files];
  for (const group of searchGroups) {
    for (const filePath of group) {
      if (fileHashMatches(filePath, expectedHash)) {
        return { filePath, sourcePath: filePath };
      }
    }
  }

  if (!expectedHash && sameNameFiles.length) {
    return { filePath: sameNameFiles[0], sourcePath: sameNameFiles[0] };
  }

  return { filePath: "", sourcePath: payload.sourcePath || "" };
}

async function readFolderImportManifest(source) {
  try {
    const payload = JSON.parse(await fs.readFile(source.manifestPath, "utf8"));
    return {
      version: 1,
      files: Array.isArray(payload.files) ? payload.files : [],
    };
  } catch {
    return { version: 1, files: [] };
  }
}

async function writeFolderImportManifest(source, manifest) {
  await fs.mkdir(path.dirname(source.manifestPath), { recursive: true });
  await fs.writeFile(source.manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function readBossImportManifest() {
  return readFolderImportManifest(FOLDER_IMPORT_SOURCES.boss);
}

async function writeBossImportManifest(manifest) {
  await writeFolderImportManifest(FOLDER_IMPORT_SOURCES.boss, manifest);
}

function mergeEmailManifestAccounts(existingAccounts = [], metadata = {}) {
  const accounts = Array.isArray(existingAccounts) ? existingAccounts.filter((item) => item && typeof item === "object") : [];
  const accountId = metadata.accountId ? normalizeBossAutomationAccountId(metadata.accountId) : "";
  if (!accountId) return accounts;
  const now = new Date().toISOString();
  const nextAccount = {
    accountId,
    accountLabel: metadata.accountLabel || automationAccountLabel(accountId),
    email: metadata.email || "",
    imapHost: metadata.imapHost || "",
    lastSeenAt: now,
  };
  const index = accounts.findIndex((item) => normalizeBossAutomationAccountId(item.accountId) === accountId);
  if (index >= 0) {
    accounts[index] = { ...accounts[index], ...nextAccount };
  } else {
    accounts.push(nextAccount);
  }
  return accounts;
}

async function rememberBossEmailManifestAccount(hash, metadata = {}) {
  if (!hash || !metadata.accountId) return;
  const manifest = await readBossImportManifest();
  const entry = (manifest.files || []).find((item) => item?.hash === hash);
  if (!entry) return;
  entry.accounts = mergeEmailManifestAccounts(entry.accounts, metadata);
  entry.accountId = entry.accountId || normalizeBossAutomationAccountId(metadata.accountId);
  entry.accountLabel = entry.accountLabel || metadata.accountLabel || automationAccountLabel(metadata.accountId);
  entry.email = entry.email || metadata.email || "";
  entry.imapHost = entry.imapHost || metadata.imapHost || "";
  await writeFolderImportManifest(FOLDER_IMPORT_SOURCES.boss, manifest);
}

function getCompletedFolderImportHashes(source, manifest) {
  const hashes = new Set();
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const db = getDb();
  const itemLookup = db.prepare("SELECT status FROM batch_items WHERE id = ?");
  const doneStatuses = source.doneStatuses || BOSS_IMPORT_DONE_STATUSES;
  const skipStatuses = source.skipStatuses || BOSS_IMPORT_SKIP_STATUSES;

  for (const entry of files) {
    if (!entry?.hash) continue;
    if (doneStatuses.has(entry.status)) {
      hashes.add(entry.hash);
      continue;
    }
    if (!entry.itemId) continue;
    const item = itemLookup.get(entry.itemId);
    if (item && doneStatuses.has(item.status)) {
      hashes.add(entry.hash);
    }
  }

  const activeItems = db.prepare("SELECT status, payload FROM batch_items").all();
  for (const item of activeItems) {
    if (!skipStatuses.has(item.status)) continue;
    const payload = parsePayload(item.payload, {});
    if (payload.source === source.id && payload.sourceHash) {
      hashes.add(payload.sourceHash);
    }
  }

  return hashes;
}

async function resumeInterruptedFolderImportJobs(source) {
  await ensureDatabase();
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const activeItems = db
    .prepare(
      "SELECT id, job_id, filename, file_path, status, payload, updated_at FROM batch_items WHERE status IN ('pending', 'parsing')"
    )
    .all();
  const jobIds = new Set();
  const resetItem = db.prepare(
    "UPDATE batch_items SET status = 'pending', message = ?, updated_at = ? WHERE id = ? AND status = 'parsing'"
  );
  const failMissingFileItem = db.prepare(
    "UPDATE batch_items SET status = 'failed', message = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'parsing')"
  );
  const updateJob = db.prepare(
    "UPDATE batch_jobs SET status = 'pending', updated_at = ? WHERE id = ? AND status NOT IN ('paused', 'cancelled')"
  );

  for (const item of activeItems) {
    const payload = parsePayload(item.payload, {});
    if (payload.source !== source.id || !payload.sourceHash) continue;
    const fileResolution = resolveBatchItemFileReference(item, payload);
    if (!fileResolution.filePath) {
      failMissingFileItem.run("原始批量文件不存在，等待文件夹扫描重新入队", nowIso, item.id);
      console.warn(
        `[${nowIso}] [${source.id}] 跳过缺失原始文件的简历入库项：${item.filename || item.id}，job=${item.job_id}`
      );
      continue;
    }
    if (
      fileResolution.filePath !== item.file_path ||
      (payload.source && fileResolution.sourcePath && payload.sourcePath !== fileResolution.sourcePath)
    ) {
      updateBatchItemFileReference(item, payload, fileResolution, "已从当前下载目录找回原始文件，继续解析");
    }
    if (item.status === "pending") {
      jobIds.add(item.job_id);
      continue;
    }
    const updatedAt = Date.parse(item.updated_at || "");
    const elapsedMs = Number.isFinite(updatedAt) ? now.getTime() - updatedAt : FOLDER_IMPORT_STALE_RUNNING_MS + 1;
    if (elapsedMs < FOLDER_IMPORT_STALE_RUNNING_MS) continue;
    resetItem.run("检测到解析任务卡住，已自动重新入队", nowIso, item.id);
    jobIds.add(item.job_id);
    console.warn(
      `[${nowIso}] [${source.id}] 恢复卡住的简历入库项：${item.filename || item.id}，job=${item.job_id}`
    );
  }

  for (const jobId of jobIds) {
    updateJob.run(nowIso, jobId);
    startBatchWorker(jobId);
  }

  return jobIds.size;
}

function getCompletedBossImportHashes(manifest) {
  return getCompletedFolderImportHashes(FOLDER_IMPORT_SOURCES.boss, manifest);
}

async function markFolderImportCompleted(item, result = {}) {
  const payload = parsePayload(item.payload, {});
  const source = getFolderImportSourceById(payload.source || "");
  if (!source || !payload.sourceHash) return;
  const fileResolution = resolveBatchItemFileReference(item, payload);
  const sourcePath = fileResolution.sourcePath || payload.sourcePath || item.file_path || "";

  const manifest = await readFolderImportManifest(source);
  const hash = payload.sourceHash;
  const previousEntry = (manifest.files || []).find((entry) => entry?.hash === hash) || {};
  const accounts = mergeEmailManifestAccounts(previousEntry.accounts, {
    accountId: payload.accountId || previousEntry.accountId || "",
    accountLabel: payload.accountLabel || previousEntry.accountLabel || "",
    email: payload.email || previousEntry.email || "",
    imapHost: payload.imapHost || previousEntry.imapHost || "",
  });
  manifest.files = (manifest.files || []).filter((entry) => entry.hash !== hash);
  manifest.files.push({
    hash,
    filename: item.filename,
    sourcePath,
    size: payload.size || 0,
    importedAt: new Date().toISOString(),
    jobId: item.job_id,
    itemId: item.id,
    status: result.status,
    resumeId: result.resumeId || "",
    accountId: payload.accountId || previousEntry.accountId || "",
    accountLabel: payload.accountLabel || previousEntry.accountLabel || "",
    email: payload.email || previousEntry.email || "",
    imapHost: payload.imapHost || previousEntry.imapHost || "",
    emailSourceKind: payload.emailSourceKind || previousEntry.emailSourceKind || "",
    sourceLabel: payload.sourceLabel || previousEntry.sourceLabel || "",
    sourcePlatform: payload.sourcePlatform || previousEntry.sourcePlatform || "",
    accounts,
  });

  await writeFolderImportManifest(source, manifest);
}

async function markBossImportCompleted(item, result = {}) {
  await markFolderImportCompleted(item, result);
}

function getFileHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function listStoredResumeFiles(folder = BOSS_RESUMES_DIR) {
  await fs.mkdir(folder, { recursive: true });
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && /\.(pdf|doc|docx)$/i.test(entry.name))
    .map((entry) => path.join(folder, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "zh-Hans-CN"));
}

async function listFolderResumePdfFiles(source) {
  await fs.mkdir(source.folder, { recursive: true });
  const files = [];
  const walk = async (folder, depth = 0) => {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const filePath = path.join(folder, entry.name);
      if (entry.isDirectory() && source.recursive && depth < 4) {
        await walk(filePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) continue;
      if (source.includeFilePath && !source.includeFilePath(filePath)) continue;
      files.push(filePath);
    }
  };
  await walk(source.folder);
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b), "zh-Hans-CN"));
}

async function listBossResumePdfFiles() {
  return listFolderResumePdfFiles(FOLDER_IMPORT_SOURCES.boss);
}

async function collectFolderResumeImportCandidates(
  source,
  { limit = 30, stopAtLimit = false, minFileAgeMs = 0 } = {}
) {
  const files = await listFolderResumePdfFiles(source);
  const manifest = await readFolderImportManifest(source);
  const knownHashes = getCompletedFolderImportHashes(source, manifest);
  const candidates = [];
  let skippedImported = 0;
  let skippedInvalid = 0;
  let skippedTooNew = 0;
  const nowMs = Date.now();

  for (const filePath of files) {
    const filename = path.basename(filePath);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && minFileAgeMs > 0 && nowMs - stat.mtimeMs < minFileAgeMs) {
      skippedTooNew += 1;
      continue;
    }
    const pdfBuffer = await fs.readFile(filePath);
    if (!pdfBuffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      skippedInvalid += 1;
      continue;
    }

    const hash = getFileHash(pdfBuffer);
    if (knownHashes.has(hash)) {
      skippedImported += 1;
      continue;
    }

    candidates.push({
      filename,
      sourcePath: filePath,
      pdfBuffer,
      hash,
      size: pdfBuffer.length,
    });
    knownHashes.add(hash);

    if (stopAtLimit && candidates.length >= limit) break;
  }

  return {
    files,
    manifest,
    candidates,
    skippedImported,
    skippedInvalid,
    skippedTooNew,
    limit,
  };
}

async function collectBossResumeImportCandidates({ limit = 30, stopAtLimit = false } = {}) {
  return collectFolderResumeImportCandidates(FOLDER_IMPORT_SOURCES.boss, { limit, stopAtLimit });
}

function publicFolderImportCandidate(candidate) {
  return {
    filename: candidate.filename,
    size: candidate.size,
    hash: candidate.hash.slice(0, 16),
  };
}

function publicBossImportCandidate(candidate) {
  return publicFolderImportCandidate(candidate);
}

async function handleScanResumeFolderImport(source, request, response) {
  try {
    await ensureDatabase();
    await resumeInterruptedFolderImportJobs(source);
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const limit = Math.max(1, Math.min(Number(requestUrl.searchParams.get("limit") || 30), 100));
    const scan = await collectFolderResumeImportCandidates(source, { limit, stopAtLimit: false });
    const selected = scan.candidates.slice(0, limit);

    sendJson(response, 200, {
      summary: {
        folder: source.folder,
        scanned: scan.files.length,
        newFiles: scan.candidates.length,
        importable: selected.length,
        skippedImported: scan.skippedImported,
        skippedInvalid: scan.skippedInvalid,
        skippedTooNew: scan.skippedTooNew,
        limit,
      },
      files: selected.map(publicFolderImportCandidate),
      message: scan.files.length ? `${source.label} 简历文件夹扫描完成` : `${source.label} 简历文件夹为空`,
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || `扫描 ${source.label} 简历文件夹失败` });
  }
}

async function handleScanBossResumeFolder(request, response) {
  await handleScanResumeFolderImport(FOLDER_IMPORT_SOURCES.boss, request, response);
}

async function handleScanZhilianResumeFolder(request, response) {
  await handleScanResumeFolderImport(FOLDER_IMPORT_SOURCES.zhilian, request, response);
}

async function handleScanJob51ResumeFolder(request, response) {
  await handleScanResumeFolderImport(FOLDER_IMPORT_SOURCES.job51, request, response);
}

async function handleBossBrowserStatus(_request, response) {
  try {
    const result = await inspectBossBrowserPage();
    sendJson(response, 200, {
      connected: true,
      folder: BOSS_RESUMES_DIR,
      ...result,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      connected: false,
      error: error.message || "检测浏览器失败",
      startHint: getBossBrowserStartHint(),
      ...(error.payload || {}),
    });
  }
}

async function handleBossBrowserDownload(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const result = await downloadVisibleBossResumes({
      limit: body.limit || 5,
    });
    sendJson(response, 200, {
      folder: BOSS_RESUMES_DIR,
      ...result,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "获取当前页简历失败",
      startHint: getBossBrowserStartHint(),
      ...(error.payload || {}),
    });
  }
}

async function handleImportEmailResumes(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const result = await importEmailResumeAttachments({
      limit: body.limit || "all",
      accountId: body.accountId || body.account || requestUrl.searchParams.get("accountId") || requestUrl.searchParams.get("account") || "",
    });
    const importResult = await queueSavedEmailResumesForImport([...(result.saved || []), ...(result.existing || [])], {
      limit: EMAIL_AUTO_IMPORT_LIMIT,
      trigger: "email-manual",
    });
    const job = importResult.job || null;
    const counts = job?.counts || {};
    sendJson(response, 200, {
      ...result,
      job,
      summary: {
        ...result.summary,
        queued: importResult.summary?.queued || 0,
        imported: counts.saved || 0,
        duplicateResumes: counts.duplicate || 0,
        parseFailed: counts.failed || 0,
        skippedUnsupported: importResult.summary?.skippedUnsupported || 0,
        importJobId: job?.id || "",
      },
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "导入邮箱附件失败",
    });
  }
}

function getEmailAutoImportStatus() {
  return {
    enabled: emailAutoImportEnabled,
    running: emailAutoImportRunning,
    intervalMs: EMAIL_AUTO_IMPORT_INTERVAL_MS,
    limit: EMAIL_AUTO_IMPORT_LIMIT,
    lastSummary: emailAutoImportLastSummary,
    lastError: emailAutoImportLastError,
    lastStartedAt: emailAutoImportLastStartedAt,
    lastFinishedAt: emailAutoImportLastFinishedAt,
  };
}

async function runEmailResumeAutoImport() {
  if (!emailAutoImportEnabled || emailAutoImportRunning) return getEmailAutoImportStatus();
  emailAutoImportRunning = true;
  emailAutoImportLastStartedAt = new Date().toISOString();
  emailAutoImportLastError = "";
  try {
    const results = [];
    const errors = [];
    for (const accountId of getEmailAutoImportAccountIds()) {
      try {
        const result = await importEmailResumeAttachments({
          limit: EMAIL_AUTO_IMPORT_LIMIT,
          accountId,
        });
        const importResult = await queueSavedEmailResumesForImport([...(result.saved || []), ...(result.existing || [])], {
          limit: EMAIL_AUTO_IMPORT_LIMIT,
          trigger: "email-auto",
        });
        result.importJob = importResult.job || null;
        result.importSummary = importResult.summary || {};
        results.push(result);
      } catch (error) {
        errors.push(`${automationAccountLabel(accountId)}: ${error.message || "邮箱自动检测失败"}`);
      }
    }

    emailAutoImportLastSummary = {
      accounts: results.map((result) => ({
        accountId: result.accountId,
        accountLabel: result.accountLabel,
        email: result.email,
        imapHost: result.imapHost,
        checkedMessages: result.summary?.checkedMessages || 0,
        saved: result.summary?.saved || 0,
        existing: result.summary?.existing || 0,
        skippedNonBoss: result.summary?.skippedNonBoss || 0,
        skippedExcludedPlatform: result.summary?.skippedExcludedPlatform || 0,
        skippedNoResumePdf: result.summary?.skippedNoResumePdf || 0,
        skippedDuplicate: result.summary?.skippedDuplicate || 0,
        bossMessages: result.summary?.bossMessages || 0,
        directEmailMessages: result.summary?.directEmailMessages || 0,
        savedBoss: result.summary?.savedBoss || 0,
        savedDirectEmail: result.summary?.savedDirectEmail || 0,
        queued: result.importSummary?.queued || 0,
        imported: result.importJob?.counts?.saved || 0,
        duplicateResumes: result.importJob?.counts?.duplicate || 0,
        parseFailed: result.importJob?.counts?.failed || 0,
        importJobId: result.importJob?.id || "",
        limit: result.summary?.limit,
        todayOnly: result.summary?.todayOnly,
        sourceFilter: result.summary?.sourceFilter,
        dateRange: result.summary?.dateRange,
      })),
      checkedMessages: results.reduce((sum, result) => sum + (result.summary?.checkedMessages || 0), 0),
      saved: results.reduce((sum, result) => sum + (result.summary?.saved || 0), 0),
      existing: results.reduce((sum, result) => sum + (result.summary?.existing || 0), 0),
      skippedNonBoss: results.reduce((sum, result) => sum + (result.summary?.skippedNonBoss || 0), 0),
      skippedExcludedPlatform: results.reduce((sum, result) => sum + (result.summary?.skippedExcludedPlatform || 0), 0),
      skippedNoResumePdf: results.reduce((sum, result) => sum + (result.summary?.skippedNoResumePdf || 0), 0),
      skippedDuplicate: results.reduce((sum, result) => sum + (result.summary?.skippedDuplicate || 0), 0),
      bossMessages: results.reduce((sum, result) => sum + (result.summary?.bossMessages || 0), 0),
      directEmailMessages: results.reduce((sum, result) => sum + (result.summary?.directEmailMessages || 0), 0),
      savedBoss: results.reduce((sum, result) => sum + (result.summary?.savedBoss || 0), 0),
      savedDirectEmail: results.reduce((sum, result) => sum + (result.summary?.savedDirectEmail || 0), 0),
      queued: results.reduce((sum, result) => sum + (result.importSummary?.queued || 0), 0),
      imported: results.reduce((sum, result) => sum + (result.importJob?.counts?.saved || 0), 0),
      duplicateResumes: results.reduce((sum, result) => sum + (result.importJob?.counts?.duplicate || 0), 0),
      parseFailed: results.reduce((sum, result) => sum + (result.importJob?.counts?.failed || 0), 0),
      importJobIds: results.map((result) => result.importJob?.id).filter(Boolean),
      limit: EMAIL_AUTO_IMPORT_LIMIT,
      errorCount: errors.length,
    };
    emailAutoImportLastError = errors.join("；");
  } catch (error) {
    emailAutoImportLastError = error.message || "邮箱自动检测失败";
  } finally {
    emailAutoImportRunning = false;
    emailAutoImportLastFinishedAt = new Date().toISOString();
  }
  return getEmailAutoImportStatus();
}

function startEmailAutoImportTimer() {
  if (emailAutoImportTimer) return;
  emailAutoImportTimer = setInterval(() => {
    runEmailResumeAutoImport().catch((error) => {
      emailAutoImportLastError = error.message || "邮箱自动检测失败";
    });
  }, EMAIL_AUTO_IMPORT_INTERVAL_MS);
}

function stopEmailAutoImportTimer() {
  if (!emailAutoImportTimer) return;
  clearInterval(emailAutoImportTimer);
  emailAutoImportTimer = null;
}

async function handleEmailAutoImportStatus(response) {
  sendJson(response, 200, getEmailAutoImportStatus());
}

async function handleSetEmailAutoImport(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    emailAutoImportEnabled = Boolean(body.enabled);
    if (emailAutoImportEnabled) {
      startEmailAutoImportTimer();
      if (body.runNow) {
        setTimeout(() => {
          runEmailResumeAutoImport().catch((error) => {
            emailAutoImportLastError = error.message || "邮箱自动检测失败";
          });
        }, 0);
      }
    } else {
      stopEmailAutoImportTimer();
    }
    sendJson(response, 200, getEmailAutoImportStatus());
  } catch (error) {
    sendJson(response, 500, { error: error.message || "更新邮箱自动检测失败" });
  }
}

async function createFolderImportBatchJobFromCandidates(
  source,
  candidates,
  { limit = 30, parseMode = "direct", trigger = "manual", summary: summaryOverrides = {}, emptyMessage = "" } = {}
) {
  await ensureDatabase();
  const normalizedLimit = Math.max(1, Math.min(Number(limit || 30), 100));
  const normalizedParseMode = parseMode === "fast" ? "fast" : "direct";
  const selectedCandidates = (Array.isArray(candidates) ? candidates : []).slice(0, normalizedLimit);
  const scanned = Number(summaryOverrides.scanned ?? selectedCandidates.length) || 0;
  const skippedImported = Number(summaryOverrides.skippedImported || 0);
  const skippedInvalid = Number(summaryOverrides.skippedInvalid || 0);
  const skippedTooNew = Number(summaryOverrides.skippedTooNew || 0);
  const skippedUnsupported = Number(summaryOverrides.skippedUnsupported || 0);
  const now = new Date().toISOString();
  const summary = {
    folder: source.folder,
    scanned,
    imported: selectedCandidates.length,
    queued: selectedCandidates.length,
    skippedImported,
    skippedInvalid,
    skippedTooNew,
    skippedUnsupported,
    limit: normalizedLimit,
  };

  if (!selectedCandidates.length) {
    return {
      job: null,
      summary,
      message:
        emptyMessage ||
        (scanned ? `${source.label} 简历文件夹暂无新增 PDF` : `${source.label} 简历文件夹为空`),
    };
  }

  const jobId = crypto.randomUUID();
  getDb()
    .prepare("INSERT INTO batch_jobs (id, parse_mode, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)")
    .run(jobId, normalizedParseMode, now, now);

  for (const candidate of selectedCandidates) {
    const itemId = crypto.randomUUID();
    const filePath = path.join(BATCH_UPLOAD_DIR, `${jobId}-${itemId}.pdf`);
    const importLabel = candidate.sourceLabel || source.label;
    const sourceMeta = buildResumeSourceMetadata({
      source: source.id,
      sourceLabel: candidate.sourceLabel || "",
      sourcePlatform: candidate.sourcePlatform || "",
      platform: candidate.platform || "",
      sourcePath: candidate.sourcePath,
      filename: candidate.filename,
      accountId: candidate.accountId || "",
      accountLabel: candidate.accountLabel || "",
      accountName: candidate.accountName || "",
      emailSourceKind: candidate.emailSourceKind || "",
      trigger,
    });
    await fs.writeFile(filePath, candidate.pdfBuffer);
    getDb()
      .prepare(
        `INSERT INTO batch_items
          (id, job_id, filename, file_path, status, message, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
      )
      .run(
        itemId,
        jobId,
        candidate.filename,
        filePath,
        `来自 ${importLabel} 文件夹${trigger === "auto" || trigger === "email-auto" ? "自动" : ""}导入，等待后端队列处理`,
        JSON.stringify({
          ...sourceMeta,
          source: source.id,
          sourcePath: candidate.sourcePath,
          sourceHash: candidate.hash,
          size: candidate.size,
          trigger,
          importSource: source.id,
          accountId: candidate.accountId || sourceMeta.accountId || "",
          accountLabel: candidate.accountLabel || "",
          accountName: candidate.accountName || sourceMeta.accountName || "",
          email: candidate.email || "",
          imapHost: candidate.imapHost || "",
          emailSourceKind: candidate.emailSourceKind || sourceMeta.emailSourceKind || "",
          sourceLabel: sourceMeta.sourceLabel || "",
          sourcePlatform: sourceMeta.sourcePlatform || "",
        }),
        now,
        now
      );
  }

  startBatchWorker(jobId);

  return {
    job: await getPublicBatchJob(jobId),
    summary,
    message: `${source.label} 简历文件夹发现 ${selectedCandidates.length} 份新增 PDF，已进入解析队列`,
  };
}

async function createFolderImportBatchJob(
  source,
  { limit = 30, parseMode = "direct", trigger = "manual", minFileAgeMs = 0 } = {}
) {
  await ensureDatabase();
  await resumeInterruptedFolderImportJobs(source);
  const normalizedLimit = Math.max(1, Math.min(Number(limit || 30), 100));
  const normalizedParseMode = parseMode === "fast" ? "fast" : "direct";
  const scan = await collectFolderResumeImportCandidates(source, {
    limit: normalizedLimit,
    stopAtLimit: true,
    minFileAgeMs,
  });
  const { files, candidates, skippedImported, skippedInvalid, skippedTooNew } = scan;
  return createFolderImportBatchJobFromCandidates(source, candidates, {
    limit: normalizedLimit,
    parseMode: normalizedParseMode,
    trigger,
    summary: {
      scanned: files.length,
      skippedImported,
      skippedInvalid,
      skippedTooNew,
    },
  });
}

async function handleImportResumeFolder(source, request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const result = await createFolderImportBatchJob(source, {
      limit: body.limit || 30,
      parseMode: body.parseMode === "fast" ? "fast" : "direct",
      trigger: "manual",
    });
    sendJson(response, result.job ? 201 : 200, result);
  } catch (error) {
    sendJson(response, 500, { error: error.message || `导入 ${source.label} 简历文件夹失败` });
  }
}

async function handleImportBossResumeFolder(request, response) {
  await handleImportResumeFolder(FOLDER_IMPORT_SOURCES.boss, request, response);
}

async function handleImportZhilianResumeFolder(request, response) {
  await handleImportResumeFolder(FOLDER_IMPORT_SOURCES.zhilian, request, response);
}

async function handleImportJob51ResumeFolder(request, response) {
  await handleImportResumeFolder(FOLDER_IMPORT_SOURCES.job51, request, response);
}

async function runZhilianResumeAutoImport() {
  if (!ZHILIAN_AUTO_IMPORT_ENABLED || zhilianAutoImportRunning) return;
  zhilianAutoImportRunning = true;
  try {
    const result = await createFolderImportBatchJob(FOLDER_IMPORT_SOURCES.zhilian, {
      limit: ZHILIAN_AUTO_IMPORT_LIMIT,
      parseMode: ZHILIAN_AUTO_IMPORT_PARSE_MODE,
      trigger: "auto",
      minFileAgeMs: ZHILIAN_AUTO_IMPORT_FILE_MIN_AGE_MS,
    });
    if (result.summary.imported > 0) {
      console.log(
        `[${new Date().toISOString()}] [zhilian-auto-import] 新增 ${result.summary.imported} 份简历，job=${result.job?.id || ""}`
      );
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [zhilian-auto-import] 扫描失败: ${error.message}`);
  } finally {
    zhilianAutoImportRunning = false;
  }
}

function startZhilianResumeAutoImport() {
  if (!ZHILIAN_AUTO_IMPORT_ENABLED || zhilianAutoImportTimer) return;
  setTimeout(() => runZhilianResumeAutoImport(), 1500);
  zhilianAutoImportTimer = setInterval(runZhilianResumeAutoImport, ZHILIAN_AUTO_IMPORT_INTERVAL_MS);
  console.log(
    `[${new Date().toISOString()}] [zhilian-auto-import] 已启用，每 ${Math.round(
      ZHILIAN_AUTO_IMPORT_INTERVAL_MS / 1000
    )} 秒扫描：${ZHILIAN_RESUMES_DIR}`
  );
}

async function runJob51ResumeAutoImport() {
  if (!JOB51_AUTO_IMPORT_ENABLED || job51AutoImportRunning) return;
  job51AutoImportRunning = true;
  try {
    const result = await createFolderImportBatchJob(FOLDER_IMPORT_SOURCES.job51, {
      limit: JOB51_AUTO_IMPORT_LIMIT,
      parseMode: JOB51_AUTO_IMPORT_PARSE_MODE,
      trigger: "auto",
      minFileAgeMs: JOB51_AUTO_IMPORT_FILE_MIN_AGE_MS,
    });
    if (result.summary.imported > 0) {
      console.log(
        `[${new Date().toISOString()}] [51job-auto-import] 新增 ${result.summary.imported} 份简历，job=${result.job?.id || ""}`
      );
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [51job-auto-import] 扫描失败: ${error.message}`);
  } finally {
    job51AutoImportRunning = false;
  }
}

function startJob51ResumeAutoImport() {
  if (!JOB51_AUTO_IMPORT_ENABLED || job51AutoImportTimer) return;
  setTimeout(() => runJob51ResumeAutoImport(), 1500);
  job51AutoImportTimer = setInterval(runJob51ResumeAutoImport, JOB51_AUTO_IMPORT_INTERVAL_MS);
  console.log(
    `[${new Date().toISOString()}] [51job-auto-import] 已启用，每 ${Math.round(
      JOB51_AUTO_IMPORT_INTERVAL_MS / 1000
    )} 秒扫描：${JOB51_RESUMES_DIR}`
  );
}

function createResumeListCacheSignature(resumes = []) {
  return [
    resumes.length,
    ...resumes.map((resume) =>
      [
        resume.id || "",
        resume.updatedAt || "",
        resume.matchScore ?? "",
        resume.hasPdf ? "1" : "0",
        resume.feedback?.updatedAt || "",
        resume.feedback?.decision || "",
      ].join(":")
    ),
  ].join("|");
}

async function handleListResumes(_request, response) {
  await ensureDatabase();
  const cachedPayload = getCachedResumeListResponse();
  if (cachedPayload) {
    sendJson(response, 200, { ...cachedPayload, cached: true });
    return;
  }

  const records = await readDatabase();
  const resumes = getUniqueCandidateRecords(records)
    .map(publicRecord)
    .sort((left, right) => {
      const scoreDiff = getNumericScore(right) - getNumericScore(left);
      if (scoreDiff !== 0) return scoreDiff;
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
  const payload = {
    resumes,
    cacheSignature: createResumeListCacheSignature(resumes),
    generatedAt: new Date().toISOString(),
  };
  setCachedResumeListResponse(payload);
  sendJson(response, 200, { ...payload, cached: false });
}

async function handleCreateResume(request, response) {
  try {
    const body = await readJsonBody(request);
    const records = await readDatabase();
    const record = createRecordPayload(body);
    const duplicateRecord = findDuplicateCandidateRecord(records, record);

    if (duplicateRecord) {
      sendJson(response, 200, {
        duplicate: true,
        rank: getRecordRank(records, duplicateRecord.id),
        resume: publicRecord(duplicateRecord),
        message: "该候选人已上传过",
      });
      return;
    }

    records.push(record);
    await writeDatabase(records);
    sendJson(response, 201, {
      duplicate: false,
      rank: getRecordRank(records, record.id),
      resume: publicRecord(record),
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "保存简历失败" });
  }
}

async function findResume(id) {
  const records = await readDatabase();
  const index = records.findIndex((record) => record.id === id);
  return { records, index, record: index >= 0 ? records[index] : null };
}

async function handleGetResume(id, response) {
  const { record } = await findResume(id);
  if (!record) {
    sendJson(response, 404, { error: "简历不存在" });
    return;
  }
  sendJson(response, 200, { resume: publicRecord(record) });
}

function normalizeConversationMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === "object" && String(message.text || "").trim())
    .slice(-80)
    .map((message) => ({
      sender: ["me", "other", "system"].includes(String(message.sender || "")) ? String(message.sender) : "other",
      time: String(message.time || message.timestamp || ""),
      status: clipText(message.status || "", 40),
      text: clipText(message.text || "", 900),
      synthetic: Boolean(message.synthetic),
    }));
}

async function readAutomationJsonFile(filename) {
  try {
    const content = await fs.readFile(path.join(AUTOMATION_WORKSPACE, filename), "utf8");
    return JSON.parse(content || "null");
  } catch {
    return null;
  }
}

function automationSourceLabel(filename) {
  if (/job51/i.test(filename)) return "51job";
  if (/zhilian|zhaopin/i.test(filename)) return "智联";
  if (/boss_b|hexinhong/i.test(filename)) return "BOSS 和新红";
  if (/boss_a|songfengfeng/i.test(filename)) return "BOSS 宋峰峰";
  return "BOSS";
}

function buildConversationCandidateFromMemory(key, memory, sourceLabel) {
  if (!memory || typeof memory !== "object") return null;
  const counterpart = memory.counterpart && typeof memory.counterpart === "object" ? memory.counterpart : {};
  const messages = normalizeConversationMessages(memory.recentMessages);
  const candidateName = String(counterpart.name || memory.candidateName || "").trim();
  const appliedPosition = String(memory.appliedPosition || counterpart.appliedPosition || counterpart.role || "").trim();
  const rawHeader = String(counterpart.rawHeader || "");
  const summary = String(memory.summary || "");
  if (!candidateName && !rawHeader && !summary && !messages.length) return null;
  return {
    source: sourceLabel,
    conversationKey: String(key || memory.conversationKey || ""),
    candidateName,
    appliedPosition,
    updatedAt: String(memory.updatedAt || memory.lastUpdatedAt || ""),
    updatedAtTs: Number(memory.updatedAtTs || Date.parse(memory.updatedAt || "") || 0),
    conversation: {
      summary: clipText(summary, 1200),
      counterpart: {
        name: candidateName,
        organization: String(counterpart.organization || ""),
        role: String(counterpart.role || ""),
        appliedPosition,
        rawHeader: clipText(rawHeader, 1600),
      },
      recentMessages: messages,
      currentRecord: {},
    },
  };
}

function buildConversationCandidateFromResult(result, sourceLabel) {
  if (!result || typeof result !== "object") return null;
  const messages = normalizeConversationMessages(result.messages || result.recentMessages);
  const candidateName = String(result.candidateName || result.name || "").trim();
  const appliedPosition = String(result.appliedPosition || result.job || result.position || "").trim();
  const rawHeader = String(result.label || result.candidateLabel || result.pageTextPreview || "");
  if (!candidateName && !rawHeader && !messages.length) return null;
  return {
    source: sourceLabel,
    conversationKey: String(result.conversationKey || result.id || ""),
    candidateName,
    appliedPosition,
    updatedAt: String(result.updatedAt || result.createdAt || result.time || ""),
    updatedAtTs: Number(result.updatedAtTs || Date.parse(result.updatedAt || result.createdAt || "") || 0),
    conversation: {
      summary: clipText(result.message || result.lastOther || "", 1200),
      counterpart: {
        name: candidateName,
        organization: "",
        role: appliedPosition,
        appliedPosition,
        rawHeader: clipText(rawHeader, 1600),
      },
      recentMessages: messages,
      currentRecord: result,
    },
  };
}

async function collectAutomationConversationCandidates() {
  let filenames = [];
  try {
    filenames = await fs.readdir(AUTOMATION_WORKSPACE);
  } catch {
    return [];
  }

  const candidates = [];
  for (const filename of filenames) {
    if (!/^(agent_chat_memory|recruiter_batch_reports)\b.*\.json$/i.test(filename)) continue;
    const payload = await readAutomationJsonFile(filename);
    const sourceLabel = automationSourceLabel(filename);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      for (const [key, memory] of Object.entries(payload)) {
        const candidate = buildConversationCandidateFromMemory(key, memory, sourceLabel);
        if (candidate) candidates.push(candidate);
      }
      continue;
    }
    if (Array.isArray(payload)) {
      for (const report of payload) {
        const results = Array.isArray(report?.results) ? report.results : [];
        for (const result of results) {
          const candidate = buildConversationCandidateFromResult(result, sourceLabel);
          if (candidate) candidates.push(candidate);
        }
      }
    }
  }
  return candidates;
}

function scoreResumeConversationMatch(resume, candidate) {
  const resumeName = normalizeConversationName(resume.name || "");
  const candidateName = normalizeConversationName(candidate.candidateName || candidate.conversation?.counterpart?.name || "");
  const resumeFileName = normalizeConversationName(resume.fileName || "");
  const rawText = normalizeConversationName(
    [
      candidate.candidateName,
      candidate.appliedPosition,
      candidate.conversationKey,
      candidate.conversation?.summary,
      candidate.conversation?.counterpart?.rawHeader,
      ...(candidate.conversation?.recentMessages || []).map((message) => message.text),
    ].join(" ")
  );
  const reasons = [];
  let score = 0;
  let identityMatched = false;

  if (resumeName && candidateName && resumeName === candidateName) {
    score += 110;
    identityMatched = true;
    reasons.push("姓名完全匹配");
  } else if (resumeName && resumeName.length >= 2 && rawText.includes(resumeName)) {
    score += 80;
    identityMatched = true;
    reasons.push("聊天文本包含姓名");
  } else if (candidateName && candidateName.length >= 2 && resumeFileName.includes(candidateName)) {
    score += 70;
    identityMatched = true;
    reasons.push("文件名候选人匹配");
  }

  if (!identityMatched) return { score: 0, reasons: [] };

  const resumeJob = normalizeJobType(resume.jobType || "", `${resume.fileName || ""} ${resume.name || ""}`);
  const candidateJob = normalizeJobType(candidate.appliedPosition || "", `${candidate.candidateName || ""} ${candidate.conversation?.counterpart?.rawHeader || ""}`);
  if (resumeJob && candidateJob && resumeJob === candidateJob) {
    score += 18;
    reasons.push("岗位一致");
  }
  const messageCount = candidate.conversation?.recentMessages?.length || 0;
  if (messageCount) {
    score += Math.min(messageCount, 80) * 2;
    reasons.push("有聊天记录");
  }
  if (candidate.updatedAtTs) score += Math.min(candidate.updatedAtTs / 100000000000, 20);
  return { score, reasons };
}

async function handleGetResumeConversation(id, response) {
  try {
    const { record } = await findResume(id);
    if (!record) {
      sendJson(response, 404, { error: "简历不存在" });
      return;
    }

    const resume = publicRecord(record);
    const candidates = (await collectAutomationConversationCandidates())
      .map((candidate) => ({ candidate, match: scoreResumeConversationMatch(resume, candidate) }))
      .filter((item) => item.match.score >= 70)
      .sort((left, right) => {
        const scoreDiff = right.match.score - left.match.score;
        if (scoreDiff) return scoreDiff;
        return Number(right.candidate.updatedAtTs || 0) - Number(left.candidate.updatedAtTs || 0);
      });
    const best = candidates[0] || null;
    sendJson(response, 200, {
      resume,
      matched: Boolean(best),
      match: best
        ? {
            score: Math.round(best.match.score),
            reasons: best.match.reasons,
            source: best.candidate.source || "",
            conversationKey: best.candidate.conversationKey || "",
            candidateName: best.candidate.candidateName || "",
            appliedPosition: best.candidate.appliedPosition || "",
            updatedAt: best.candidate.updatedAt || "",
          }
        : null,
      conversation: best?.candidate?.conversation || {
        summary: "",
        counterpart: { name: resume.name || "", organization: "", role: "", rawHeader: "" },
        recentMessages: [],
        currentRecord: {},
      },
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "读取聊天记录失败" });
  }
}

async function handleUpdateResume(id, request, response) {
  try {
    const body = await readJsonBody(request);
    const { records, index, record } = await findResume(id);
    if (!record) {
      sendJson(response, 404, { error: "简历不存在" });
      return;
    }

    const nextFields = sanitizeResumeFields(body.resume || body);
    const duplicateRecord = findDuplicateCandidateRecord(records, { ...record, ...nextFields }, record.id);
    if (duplicateRecord) {
      const rank = getRecordRank(records, duplicateRecord.id);
      sendJson(response, 409, {
        error: `该电话已存在，当前排名第 ${rank} 名`,
        duplicate: true,
        rank,
        resume: publicRecord(duplicateRecord),
      });
      return;
    }

    records[index] = applyPositionRuleScoring({
      ...record,
      ...nextFields,
      updatedAt: new Date().toISOString(),
    });
    await writeDatabase(records);
    sendJson(response, 200, { resume: publicRecord(records[index]) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "更新简历失败" });
  }
}

async function handleDeleteResume(id, response) {
  try {
    const { records, index, record } = await findResume(id);
    if (!record) {
      sendJson(response, 404, { error: "简历不存在" });
      return;
    }

    const nextRecords = records.filter((item) => item.id !== id);
    await writeDatabase(nextRecords);

    if (record.pdfPath) {
      const resolvedPdfPath = path.resolve(record.pdfPath);
      const resolvedUploadDir = path.resolve(UPLOAD_DIR);
      if (resolvedPdfPath.startsWith(`${resolvedUploadDir}${path.sep}`)) {
        await fs.unlink(resolvedPdfPath).catch(() => {});
      }
    }

    sendJson(response, 200, {
      deleted: true,
      id,
      resumes: getUniqueCandidateRecords(nextRecords).map(publicRecord),
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "删除简历失败" });
  }
}

async function handleReEvaluateResume(id, response) {
  try {
    ensureGptKey();
    const record = await reEvaluateResumeRecord(id);
    const records = await readDatabase();
    sendJson(response, 200, {
      resume: publicRecord(record),
      rank: getRecordRank(records, record.id, record.jobType),
      message: "已按当前评分规则重新解析",
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "重评失败",
      ...(error.payload || {}),
    });
  }
}

async function handleResumeFeedback(id, request, response) {
  try {
    ensureGptKey();
    const body = await readJsonBody(request);
    const { records, index, record } = await findResume(id);
    if (!record) {
      sendJson(response, 404, { error: "简历不存在" });
      return;
    }

    const feedback = sanitizeFeedback(body);
    const { controller, timeoutId } = makeAbortController(GPT_TEXT_TIMEOUT_MS);
    try {
      const review = await askGptFeedbackReview({ resume: record, feedback }, controller.signal);
      feedback.review = {
        conflictLevel: String(review.conflictLevel || "low"),
        summary: String(review.summary || ""),
        scoreDiagnosis: String(review.scoreDiagnosis || ""),
        suggestedRuleChanges: normalizeRuleSuggestionArray(review.suggestedRuleChanges),
        needsHumanApproval: true,
      };
      feedback.reviewedAt = new Date().toISOString();
    } finally {
      clearTimeout(timeoutId);
    }

    records[index] = {
      ...record,
      feedback,
      updatedAt: new Date().toISOString(),
    };
    await writeDatabase(records);
    const ruleSuggestionIds = createRuleSuggestionsFromFeedback(records[index], feedback);
    sendJson(response, 200, {
      resume: publicRecord(records[index]),
      feedback,
      ruleSuggestionIds,
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [resume] feedback error: ${error.message}`);
    sendJson(response, 500, { error: error.message || "保存反馈失败" });
  }
}

async function handleListRuleSuggestions(request, response) {
  try {
    await ensureDatabase();
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const jobType = requestUrl.searchParams.get("jobType") || "";
    sendJson(response, 200, {
      suggestions: listRuleSuggestionRows(jobType).map(publicRuleSuggestion),
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "加载规则建议失败" });
  }
}

async function handleGetScoringRules(request, response) {
  try {
    await ensureDatabase();
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const jobType = requestUrl.searchParams.get("jobType") || DEFAULT_JOB_TYPE;
    const version = requestUrl.searchParams.get("version") || "";
    const currentRules = getCurrentScoringRules(jobType, version);
    const adoptedRules = getAppliedAdoptedRulesForVersion(version, currentRules.jobType).map((row) => ({
      id: row.id,
      resumeId: row.resume_id,
      jobType: normalizeJobType(row.job_type || currentRules.jobType),
      suggestion: normalizeRuleSuggestionText(row.suggestion),
      sourceSummary: row.source_summary || "",
      adoptedAt: row.adopted_at || "",
    }));

    sendJson(response, 200, {
      ...currentRules,
      adoptedRules,
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "加载评分细则失败" });
  }
}

async function handleListJdProfiles(response) {
  try {
    await ensureDatabase();
    sendJson(response, 200, { profiles: listJdProfiles() });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "加载 JD 规则失败" });
  }
}

async function handleRunJdMatch(request, response) {
  try {
    await ensureDatabase();
    const body = await readJsonBody(request);
    const profile = findJdProfile(body.profileId);
    if (!profile) {
      sendJson(response, 404, { error: "JD 规则不存在" });
      return;
    }
    const records = getUniqueCandidateRecords(await readDatabase()).filter((record) => profileMatchesResume(profile, record));
    const results = records
      .map((record) => calculateJdMatch(record, profile))
      .sort((left, right) => {
        const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return String(right.name || "").localeCompare(String(left.name || ""), "zh-CN");
      });
    sendJson(response, 200, {
      profile,
      counts: summarizeJdCounts(results),
      results,
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "JD 匹配失败" });
  }
}

async function handleUpdateJdTags(request, response) {
  try {
    await ensureDatabase();
    const body = await readJsonBody(request);
    const profile = findJdProfile(body.profileId);
    if (!profile) {
      sendJson(response, 404, { error: "JD 规则不存在" });
      return;
    }
    const action = String(body.action || "add").trim() === "remove" ? "remove" : "add";
    const group = normalizeJdTagGroup(body.group);
    const tag = String(body.tag || "").trim();
    if (!tag) {
      sendJson(response, 400, { error: "标签不能为空" });
      return;
    }

    const overrides = readJdTagOverrides();
    const profileOverrides = overrides[profile.id] || {};
    const groupOverrides = profileOverrides[group] || { added: [], removed: [] };
    const added = new Set(normalizeStringArray(groupOverrides.added));
    const removed = new Set(normalizeStringArray(groupOverrides.removed));
    if (action === "add") {
      added.add(tag);
      removed.delete(tag);
    } else {
      added.delete(tag);
      removed.add(tag);
    }
    overrides[profile.id] = {
      ...profileOverrides,
      [group]: {
        added: [...added],
        removed: [...removed],
      },
    };
    await writeJdTagOverrides(overrides);
    sendJson(response, 200, {
      message: action === "add" ? "标签已添加" : "标签已删除",
      profile: findJdProfile(profile.id),
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "保存 JD 标签失败" });
  }
}

async function handleUpdateRuleSuggestion(id, action, response) {
  try {
    await ensureDatabase();
    const now = new Date().toISOString();
    const status = action === "adopt" ? "adopted" : "rejected";
    const timeColumn = action === "adopt" ? "adopted_at" : "rejected_at";
    const result = getDb()
      .prepare(`UPDATE rule_suggestions SET status = ?, ${timeColumn} = ?, updated_at = ? WHERE id = ?`)
      .run(status, now, now, id);

    if (!result.changes) {
      sendJson(response, 404, { error: "规则建议不存在" });
      return;
    }

    const row = getDb()
      .prepare(
        `SELECT id, resume_id, job_type, suggestion, status, source_summary, payload, created_at, adopted_at, rejected_at, updated_at
         FROM rule_suggestions
         WHERE id = ?`
      )
      .get(id);

    sendJson(response, 200, {
      suggestion: publicRuleSuggestion(row),
      suggestions: listRuleSuggestionRows(row.job_type || "").map(publicRuleSuggestion),
    });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "更新规则建议失败" });
  }
}

async function handleUploadResumePdf(id, request, response) {
  try {
    const filename = decodeURIComponent(request.headers["x-file-name"] || "");
    const mimeType = request.headers["content-type"] || "";
    const pdfBuffer = await readRequestBuffer(request);
    assertPdfPayload({ filename: filename || "resume.pdf", mimeType, pdfBuffer });

    const { records, index, record } = await findResume(id);
    if (!record) {
      sendJson(response, 404, { error: "简历不存在" });
      return;
    }

    await ensureDatabase();
    const pdfPath = path.join(UPLOAD_DIR, `${id}.pdf`);
    await fs.writeFile(pdfPath, pdfBuffer);

    records[index] = {
      ...record,
      fileName: filename || record.fileName,
      pdfPath,
      updatedAt: new Date().toISOString(),
    };
    await writeDatabase(records);
    sendJson(response, 200, { resume: publicRecord(records[index]) });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "保存 PDF 失败" });
  }
}

async function handleServeResumePdf(id, response) {
  const { record } = await findResume(id);
  if (!record || !record.pdfPath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("PDF not found");
    return;
  }

  try {
    const content = await fs.readFile(record.pdfPath);
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(record.fileName || "resume.pdf")}"`,
    });
