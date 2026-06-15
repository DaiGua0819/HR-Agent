  if (!EMAIL_IMPORT_TODAY_ONLY) return { command: "UID SEARCH ALL", dateRange: "all" };
  const today = new Date();
  const tomorrow = addLocalDays(today, 1);
  const since = formatImapSearchDate(today);
  const before = formatImapSearchDate(tomorrow);
  return {
    command: `UID SEARCH SINCE ${since} BEFORE ${before}`,
    dateRange: `${since}..${before}`,
  };
}

function decodeHeaderForSearch(value = "") {
  return decodeMimeWords(String(value || "")).toLowerCase();
}

const EMAIL_EXCLUDED_PLATFORM_PATTERN = /51job|quickmail\.51job|前程无忧|前程招聘|51招聘|zhaopinmail|zhaopin|智联招聘|智联求职者|智联/i;
const EMAIL_BOSS_PLATFORM_PATTERN = /boss直聘|bosszhipin|zhipin\.com|cv@service\.bosszhipin\.com|kanzhun\.com/i;

function buildEmailHeaderSearchText(headers = {}) {
  const from = decodeHeaderForSearch(headers.from);
  const sender = decodeHeaderForSearch(headers.sender);
  const replyTo = decodeHeaderForSearch(headers["reply-to"]);
  const subject = decodeHeaderForSearch(headers.subject);
  return `${from} ${sender} ${replyTo} ${subject}`;
}

function decodeEmailMessageForSearch(value = "") {
  const raw = String(value || "");
  const sample = raw.slice(0, 80000);
  const mimeDecoded = decodeMimeWords(sample);
  let quotedPrintableDecoded = "";
  try {
    quotedPrintableDecoded = decodeQuotedPrintable(sample).toString("utf8");
  } catch {}
  return `${mimeDecoded} ${quotedPrintableDecoded}`.toLowerCase();
}

function isPdfResumeAttachment(attachment = {}) {
  const buffer = attachment.buffer;
  return Buffer.isBuffer(buffer) && buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
}

function classifyEmailResumeMessage(headers = {}, { messageRaw = "", attachments = [] } = {}) {
  if (EMAIL_IMPORT_SOURCE_FILTER !== "boss") {
    return { kind: "boss", importable: true, reason: "source-filter-disabled" };
  }

  const headerText = buildEmailHeaderSearchText(headers);
  if (EMAIL_EXCLUDED_PLATFORM_PATTERN.test(headerText)) {
    return { kind: "excluded-platform", importable: false, reason: "excluded-platform-header" };
  }
  if (EMAIL_BOSS_PLATFORM_PATTERN.test(headerText)) {
    return { kind: "boss", importable: true, reason: "boss-header" };
  }

  if (!messageRaw) {
    return { kind: "unknown", importable: false, reason: "need-message-body" };
  }

  const messageText = `${headerText} ${decodeEmailMessageForSearch(messageRaw)}`;
  if (EMAIL_EXCLUDED_PLATFORM_PATTERN.test(messageText)) {
    return { kind: "excluded-platform", importable: false, reason: "excluded-platform-message" };
  }
  if (EMAIL_BOSS_PLATFORM_PATTERN.test(messageText)) {
    return { kind: "boss", importable: true, reason: "boss-message" };
  }
  if ((Array.isArray(attachments) ? attachments : []).some(isPdfResumeAttachment)) {
    return { kind: "direct-email", importable: true, reason: "non-excluded-email-pdf" };
  }
  return { kind: "non-excluded-email", importable: false, reason: "no-pdf" };
}

async function getExistingBossResumeHashes(resumeDir = EMAIL_RESUME_DIR) {
  return new Set((await getExistingBossResumeHashIndex(resumeDir)).keys());
}

async function getExistingBossResumeHashIndex(resumeDir = EMAIL_RESUME_DIR) {
  const index = new Map();
  const manifestByHash = new Map();
  try {
    const manifest = await readBossImportManifest();
    for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
      if (entry?.hash) manifestByHash.set(entry.hash, entry);
    }
  } catch {}
  const files = await listStoredResumeFiles(resumeDir);
  for (const filePath of files) {
    const buffer = await fs.readFile(filePath).catch(() => null);
    if (buffer?.length) {
      const hash = getFileHash(buffer);
      if (!index.has(hash)) {
        const stat = await fs.stat(filePath).catch(() => null);
        const manifestEntry = manifestByHash.get(hash) || {};
        index.set(hash, {
          filename: path.basename(filePath),
          filePath,
          ext: path.extname(filePath).toLowerCase(),
          size: stat?.size || buffer.length,
          existing: true,
          accountId: manifestEntry.accountId || "",
          accountLabel: manifestEntry.accountLabel || "",
          email: manifestEntry.email || "",
          imapHost: manifestEntry.imapHost || "",
          emailSourceKind: manifestEntry.emailSourceKind || "",
          sourceLabel: manifestEntry.sourceLabel || "",
          sourcePlatform: manifestEntry.sourcePlatform || "",
        });
      }
    }
  }
  return index;
}

function makeUniqueBossResumePath(filename, resumeDir = EMAIL_RESUME_DIR) {
  const parsed = path.parse(safeFilePart(filename || "邮箱简历.pdf"));
  const base = parsed.name || "邮箱简历";
  const ext = parsed.ext || ".pdf";
  let candidate = path.join(resumeDir, `${base}${ext}`);
  let index = 2;
  while (require("node:fs").existsSync(candidate)) {
    candidate = path.join(resumeDir, `${base}_${index}${ext}`);
    index += 1;
  }
  return candidate;
}

async function importEmailResumeAttachments({ limit = "all", accountId = "" } = {}) {
  const emailConfig = getEmailAccountConfig(accountId);
  if (!emailConfig.authCode) {
    const error = new Error(
      `未配置${emailConfig.accountLabel}邮箱授权码。请设置账号级 authCode，或在 ${EMAIL_CONFIG_PATH} 中配置 accounts.${emailConfig.accountId}.authCode。当前邮箱：${emailConfig.maskedAddress}`
    );
    error.statusCode = 409;
    throw error;
  }

  await fs.mkdir(emailConfig.resumeDir, { recursive: true });
  const importAll = String(limit || "").toLowerCase() === "all" || Number(limit) <= 0;
  const maxMessages = importAll ? EMAIL_MAX_IMPORT_MESSAGES : Math.max(1, Math.min(Number(limit || EMAIL_MAX_IMPORT_MESSAGES), EMAIL_MAX_IMPORT_MESSAGES));
  const existingIndex = await getExistingBossResumeHashIndex(emailConfig.resumeDir);
  const existingHashes = new Set(existingIndex.keys());
  const client = await createEmailImapClient(emailConfig);
  const saved = [];
  const existing = [];
  const queuedExistingHashes = new Set();
  let checkedMessages = 0;
  let skippedNonBoss = 0;
  let skippedExcludedPlatform = 0;
  let skippedNoResumePdf = 0;
  let skippedDuplicate = 0;
  let bossMessages = 0;
  let directEmailMessages = 0;
  let savedBoss = 0;
  let savedDirectEmail = 0;
  const search = getEmailSearchCommand();

  try {
    await client.command(`LOGIN ${imapQuote(emailConfig.address)} ${imapQuote(emailConfig.authCode)}`, { timeoutMs: 20000 });
    await client.command("SELECT INBOX", { timeoutMs: 20000 });
    const searchResponse = await client.command(search.command, { timeoutMs: 30000 });
    const allUids = parseSearchUids(searchResponse);
    const uids = allUids.slice(-maxMessages).reverse();

    for (const uid of uids) {
      checkedMessages += 1;
      const headerResponseText = await client.command(`UID FETCH ${uid} (BODY.PEEK[HEADER])`, { timeoutMs: 20000 });
      const headerRaw = extractImapLiteral(headerResponseText);
      const headers = parseMimeHeaders(headerRaw);
      const headerClassification = classifyEmailResumeMessage(headers);
      if (headerClassification.kind === "excluded-platform") {
        skippedNonBoss += 1;
        skippedExcludedPlatform += 1;
        continue;
      }

      const responseText = await client.command(`UID FETCH ${uid} (BODY.PEEK[])`, { timeoutMs: 60000 });
      const messageRaw = extractImapLiteral(responseText);
      const attachments = collectResumeAttachments(messageRaw);
      const classification = classifyEmailResumeMessage(headers, { messageRaw, attachments });
      if (classification.kind === "excluded-platform") {
        skippedNonBoss += 1;
        skippedExcludedPlatform += 1;
        continue;
      }
      if (!classification.importable) {
        skippedNonBoss += 1;
        if (classification.reason === "no-pdf") skippedNoResumePdf += 1;
        continue;
      }

      const isDirectEmail = classification.kind === "direct-email";
      if (isDirectEmail) {
        directEmailMessages += 1;
      } else {
        bossMessages += 1;
      }
      const importableAttachments = isDirectEmail ? attachments.filter(isPdfResumeAttachment) : attachments;

      for (const attachment of importableAttachments) {
        const hash = getFileHash(attachment.buffer);
        if (existingHashes.has(hash)) {
          skippedDuplicate += 1;
          if (!isDirectEmail) {
            await rememberBossEmailManifestAccount(hash, {
              accountId: emailConfig.accountId,
              accountLabel: emailConfig.accountLabel,
              email: emailConfig.maskedAddress,
              imapHost: emailConfig.imapHost,
            });
          }
          const localFile = existingIndex.get(hash);
          if (localFile && !queuedExistingHashes.has(hash)) {
            queuedExistingHashes.add(hash);
            existing.push({
              ...localFile,
              accountId: isDirectEmail ? "" : emailConfig.accountId,
              accountLabel: isDirectEmail ? "" : emailConfig.accountLabel,
              email: emailConfig.maskedAddress,
              imapHost: emailConfig.imapHost,
              emailSourceKind: isDirectEmail ? "direct" : localFile.emailSourceKind || "boss",
              sourceLabel: isDirectEmail ? "邮箱" : localFile.sourceLabel || "",
              sourcePlatform: isDirectEmail ? "邮箱" : localFile.sourcePlatform || "",
            });
          }
          continue;
        }
        existingHashes.add(hash);
        const filePath = makeUniqueBossResumePath(`邮箱_${uid}_${attachment.filename}`, emailConfig.resumeDir);
        await fs.writeFile(filePath, attachment.buffer);
        const stat = await fs.stat(filePath);
        const savedFile = {
          filename: path.basename(filePath),
          filePath,
          ext: path.extname(filePath).toLowerCase(),
          size: stat.size,
          existing: false,
          accountId: isDirectEmail ? "" : emailConfig.accountId,
          accountLabel: isDirectEmail ? "" : emailConfig.accountLabel,
          email: emailConfig.maskedAddress,
          imapHost: emailConfig.imapHost,
          emailSourceKind: isDirectEmail ? "direct" : "boss",
          sourceLabel: isDirectEmail ? "邮箱" : "",
          sourcePlatform: isDirectEmail ? "邮箱" : "",
        };
        saved.push(savedFile);
        existingIndex.set(hash, savedFile);
        if (isDirectEmail) {
          savedDirectEmail += 1;
        } else {
          savedBoss += 1;
        }
      }
    }

    await client.command("LOGOUT", { timeoutMs: 10000 }).catch(() => {});
  } finally {
    client.close();
  }

  return {
    accountId: emailConfig.accountId,
    accountLabel: emailConfig.accountLabel,
    email: emailConfig.maskedAddress,
    imapHost: emailConfig.imapHost,
    folder: emailConfig.resumeDir,
    saved,
    existing,
    summary: {
      checkedMessages,
      saved: saved.length,
      existing: existing.length,
      skippedNonBoss,
      skippedExcludedPlatform,
      skippedNoResumePdf,
      skippedDuplicate,
      bossMessages,
      directEmailMessages,
      savedBoss,
      savedDirectEmail,
      limit: maxMessages,
      todayOnly: EMAIL_IMPORT_TODAY_ONLY,
      sourceFilter: EMAIL_IMPORT_SOURCE_FILTER,
      dateRange: search.dateRange,
    },
  };
}

async function collectSavedEmailResumeImportCandidates(saved = [], source = FOLDER_IMPORT_SOURCES.boss, { limit = EMAIL_AUTO_IMPORT_LIMIT } = {}) {
  await ensureDatabase();
  const normalizedLimit = Math.max(1, Math.min(Number(limit || EMAIL_AUTO_IMPORT_LIMIT), 100));
  const manifest = await readFolderImportManifest(source);
  const knownHashes = getCompletedFolderImportHashes(source, manifest);
  const candidates = [];
  let skippedImported = 0;
  let skippedInvalid = 0;
  let skippedUnsupported = 0;

  for (const file of Array.isArray(saved) ? saved : []) {
    if (candidates.length >= normalizedLimit) break;
    const filePath = String(file?.filePath || "");
    if (!filePath || path.extname(filePath).toLowerCase() !== ".pdf") {
      skippedUnsupported += 1;
      continue;
    }

    const pdfBuffer = await fs.readFile(filePath).catch(() => null);
    if (!pdfBuffer?.length || !pdfBuffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      skippedInvalid += 1;
      continue;
    }

    const hash = getFileHash(pdfBuffer);
    if (knownHashes.has(hash)) {
      skippedImported += 1;
      continue;
    }

    knownHashes.add(hash);
    candidates.push({
      filename: path.basename(filePath),
      sourcePath: filePath,
      pdfBuffer,
      hash,
      size: pdfBuffer.length,
      accountId: file.accountId || "",
      accountLabel: file.accountLabel || "",
      accountName: file.accountName || "",
      email: file.email || "",
      imapHost: file.imapHost || "",
      emailSourceKind: file.emailSourceKind || "",
      sourceLabel: file.sourceLabel || "",
      sourcePlatform: file.sourcePlatform || "",
    });
  }

  return {
    candidates,
    scanned: Array.isArray(saved) ? saved.length : 0,
    skippedImported,
    skippedInvalid,
    skippedUnsupported,
    limit: normalizedLimit,
  };
}

async function queueSavedEmailResumesForImport(saved = [], { limit = EMAIL_AUTO_IMPORT_LIMIT, trigger = "email" } = {}) {
  const scan = await collectSavedEmailResumeImportCandidates(saved, FOLDER_IMPORT_SOURCES.boss, { limit });
  const result = await createFolderImportBatchJobFromCandidates(FOLDER_IMPORT_SOURCES.boss, scan.candidates, {
    limit,
    parseMode: "direct",
    trigger,
    summary: {
      scanned: scan.scanned,
      skippedImported: scan.skippedImported,
      skippedInvalid: scan.skippedInvalid,
      skippedUnsupported: scan.skippedUnsupported,
      skippedTooNew: 0,
    },
    emptyMessage: "邮箱附件已保存，但暂无可入库的新 PDF",
  });
  return {
    ...result,
    scan,
  };
}

async function getOnlineResumeSnapshot(client) {
  return client.evaluate(`(() => {
    const root = document.querySelector(".resume-common-dialog,.new-resume-online-main-ui,.resume-detail-wrap");
    if (!root) return { open: false };
    const text = (root.innerText || "").replace(/\\s+/g, " ").trim();
    const candidateName = text.split(" ")[0] || "";
    return {
      open: true,
      candidateName,
      textLength: text.length,
      title: document.title,
      url: location.href
    };
  })()`);
}

async function saveOnlineResumeAsPdf(client) {
  const snapshot = await getOnlineResumeSnapshot(client);
  if (!snapshot?.open) return null;

  const output = await client.send("Page.printToPDF", {
    printBackground: true,
    landscape: false,
    preferCSSPageSize: true,
    marginTop: 0.2,
    marginBottom: 0.2,
    marginLeft: 0.2,
    marginRight: 0.2,
  });
  if (!output?.data) return null;

  const filename = `BOSS在线简历_${safeFilePart(snapshot.candidateName) || "候选人"}_${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.pdf`;
  const filePath = path.join(BOSS_RESUMES_DIR, filename);
  await fs.writeFile(filePath, Buffer.from(output.data, "base64"));
  const stat = await fs.stat(filePath);
  return {
    filePath,
    filename,
    size: stat.size,
    source: "online-resume-print",
  };
}

async function inspectBossBrowserPage() {
  const page = await getBossBrowserPage();
  return {
    page: { title: page.title, url: page.url },
    scan: {
      url: page.url,
      title: page.title,
      isBossPage: isBossPageUrl(page.url),
      blocked: false,
      onlineResumeOpen: false,
      passive: true,
      triggers: [],
    },
    message: "已找到 BOSS 标签页，检测模式不会读取或操作页面内容",
  };
}

async function downloadVisibleBossResumes({ limit = 5 } = {}) {
  await fs.mkdir(BOSS_RESUMES_DIR, { recursive: true });
  const page = await getBossBrowserPage();
  const client = new CdpClient(page.webSocketDebuggerUrl);
  const maxDownloads = Math.max(1, Math.min(Number(limit || 5), 10));
  const downloaded = [];
  const attempts = [];

  try {
    await client.connect();
    await client.send("Page.enable").catch(() => {});
    await client.send("Runtime.enable").catch(() => {});
    await client.send("Page.bringToFront").catch(() => {});
    await client
      .send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: BOSS_RESUMES_DIR,
        eventsEnabled: true,
      })
      .catch(() => client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: BOSS_RESUMES_DIR }).catch(() => {}));

    const scan = await client.evaluate(BOSS_PAGE_SCAN_SCRIPT);
    if (!scan?.isBossPage) {
      const error = new Error("当前浏览器页面不是 BOSS 页面");
      error.statusCode = 409;
      error.payload = { scan };
      throw error;
    }
    if (scan.blocked) {
      const error = new Error("当前页面疑似需要登录或安全验证，请人工处理后重试");
      error.statusCode = 409;
      error.payload = { scan };
      throw error;
    }

    if (scan.onlineResumeOpen) {
      const printedFile = await saveOnlineResumeAsPdf(client);
      if (printedFile) {
        downloaded.push(printedFile);
        return {
          page: { title: page.title, url: page.url },
          scan,
          downloaded,
          attempts,
          message: "已将当前打开的在线简历保存为 PDF",
        };
      }
    }

    const triggers = (scan.triggers || [])
      .filter((item) => /下载|在线简历|附件简历/.test(item.text) || /resume|download|attachment|pdf/i.test(item.href))
      .slice(0, maxDownloads);

    if (!triggers.length) {
      const printedFile = await saveOnlineResumeAsPdf(client);
      if (printedFile) {
        downloaded.push(printedFile);
        return {
          page: { title: page.title, url: page.url },
          scan,
          downloaded,
          attempts,
          message: "已将当前打开的在线简历保存为 PDF",
        };
      }

      return {
        page: { title: page.title, url: page.url },
        scan,
        downloaded,
        attempts,
        message: "当前页没有发现可见的下载简历入口，请先打开候选人详情页或包含下载按钮的页面。",
      };
    }

    for (const trigger of triggers) {
      const before = await getBossResumeFilesSnapshot();
      const clickResult = await client.evaluate(makeBossClickDownloadScript(trigger.index));
      attempts.push({ trigger, clickResult });
      if (!clickResult?.clicked) continue;
      const newFiles = await waitForBossDownloads(before);
      newFiles.forEach((file) => downloaded.push(file));
      if (!newFiles.length && /在线简历/.test(trigger.text || "")) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const printedFile = await saveOnlineResumeAsPdf(client);
        if (printedFile) downloaded.push(printedFile);
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    return {
      page: { title: page.title, url: page.url },
      scan,
      downloaded,
      attempts,
      message: downloaded.length ? `已下载 ${downloaded.length} 个文件` : "已尝试点击，但没有检测到新 PDF 下载。",
    };
  } finally {
    client.close();
  }
}

function normalizeParsedSchoolLevel(schoolLevel) {
  const value = String(schoolLevel || "").trim();
  if (value === "普通本科") return "待确认";
  if (value === "专科") return "大专";
  return value;
}

function normalizeResumeInfo(result) {
  const fields = sanitizeResumeFields(result);
  fields.schoolLevel = normalizeParsedSchoolLevel(fields.schoolLevel) || "待确认";
  return {
    ...fields,
    ...sanitizeResumeDetails(result),
  };
}

function assertPdfPayload({ filename, mimeType, pdfBuffer }) {
  if (!filename || typeof filename !== "string") {
    throw new Error("缺少 PDF 文件名");
  }

  if (!filename.toLowerCase().endsWith(".pdf")) {
    throw new Error("仅支持 PDF 简历");
  }

  if (mimeType && !mimeType.includes("application/pdf")) {
    throw new Error("文件类型不是 PDF");
  }

  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error("缺少 PDF 文件数据");
  }
}

function parseJsonObject(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型没有返回 JSON 对象");
    return JSON.parse(match[0]);
  }
}

function makeAbortController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function makeExtractionPrompt(sourceLabel) {
  return `${sourceLabel}请提取简历基础信息，并自动识别候选人适合投放的岗位。只返回 JSON，不要输出解释或 Markdown。

JSON 结构必须如下：
{
  "name": "",
  "phone": "",
  "jobType": "",
  "school": "",
  "major": "",
  "schoolLevel": "",
  "graduation": "",
  "matchScore": "",
  "scoreBreakdown": {
    "projectScore": "",
    "techScore": "",
    "summary": "",
    "strengths": [],
    "risks": [],
    "evidence": []
  },
  "parseQuality": {
    "confidence": "",
    "missingFields": [],
    "warnings": [],
    "needsManualReview": false
  },
  "projects": [
    {
      "name": "",
      "role": "",
      "description": "",
      "agentRelated": false,
      "depth": "low|medium|high|unknown",
      "evidence": ""
    }
  ]
}

jobType 必须且只能从这些岗位中选择一个：AI应用开发实习生、应用技术经理（工业涂料领域）、膨润土销售人员、销售管培生、HRBP、人力资源管培生、国际业务管培生、销售工程师（石油钻井泥浆膨润土）_湖州、电气工程师。
岗位识别规则：AI应用开发实习生/AI实习生/人工智能实习/智能体实习/Agent实习/AI应用开发工程师归AI应用开发实习生；技术服务/应用技术/应用技术管培/材料应用/工业涂料/涂料领域/涂料研发/流变助剂/工艺/实验/配方/检测归应用技术经理（工业涂料领域）；膨润土销售/膨润土业务/涂料原料销售归膨润土销售人员；销售管培/营销管培/销售管理培训归销售管培生；人力资源管培/人资管培/人力资源管理培训归人力资源管培生；HRBP/招聘/员工关系/薪酬/绩效/HR实习归HRBP；国际/外贸/海外/跨境/英语业务/化工原料外贸归国际业务管培生；石油钻井/钻井泥浆/钻井工程/石油膨润土/石油助剂/油田/油服归销售工程师（石油钻井泥浆膨润土）_湖州；电气/PLC/HMI/上位机/自动化/电控/仪控/接线/联动/调试/CAD/机电归电气工程师。若岗位信息不明显，请根据简历经历和文件名选择最接近的一个。

schoolLevel 只能在 985 / 211 / 双一流、211 / 双一流、双一流、一本、二本、大专、海外院校、待确认、未识别 中选择。不要返回“普通本科”或“专科”；如果学校不是 985/211/双一流，请根据学校类型尽量判断为一本、二本或大专。若同一本科院校在不同省份/地区存在一本二本差异，一律按一本处理；学校名为“大学”且不是高职/专科院校时通常按一本；学校名为“学院”时通常按二本；职业技术学院、高等专科学校、专科学校按大专；无法判断再返回待确认。

major 提取学历教育里的所学专业/主修专业，只能使用教育经历中明确出现的专业名称；不要把“专业技能”“专业能力”“专业知识”、项目名称、课程名、GPA 或专业排名当作专业。若未明确出现，返回空字符串。

当前基础解析阶段不计算 matchScore，matchScore、scoreBreakdown.projectScore、scoreBreakdown.techScore 返回空字符串；后续评分以各岗位的必须项、加分项和风险项规则为准。
parseQuality.confidence 是 0-100；missingFields 写缺失字段名；warnings 写识别不确定、信息遮挡、PDF质量差等风险；只要有关键字段缺失或明显不确定，needsManualReview 返回 true。
projects 最多返回 10 个项目。`;
}

function readModelConfig() {
  for (const configPath of [MODEL_CONFIG_PATH, WORKSPACE_MODEL_CONFIG_PATH]) {
    try {
      if (!fsSync.existsSync(configPath)) continue;
      const raw = fsSync.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
      const config = JSON.parse(raw);
      return config && typeof config === "object" ? config : {};
    } catch (error) {
      console.warn(`[${new Date().toISOString()}] [resume] model config ignored (${configPath}): ${error.message}`);
    }
  }
  return {};
}

function getOpenAiCompatibleConfig() {
  const config = readModelConfig();
  const baseUrl = String(
    process.env.OPENAI_BASE_URL ||
      process.env.GPT_BASE_URL ||
      config.baseUrl ||
      DEFAULT_OPENAI_BASE_URL
  ).replace(/\/+$/, "");
  const model = String(
    process.env.OPENAI_MODEL ||
      process.env.GPT_MODEL ||
      process.env.GPT_TEXT_MODEL ||
      config.model ||
      DEFAULT_OPENAI_MODEL
  );
  const pdfModel = String(process.env.OPENAI_PDF_MODEL || process.env.GPT_PDF_MODEL || config.pdfModel || model);
  const pdfInputMode = String(process.env.GPT_PDF_INPUT_MODE || config.pdfInputMode || "auto").toLowerCase();
  const apiKey = String(process.env.OPENAI_API_KEY || process.env.GPT_API_KEY || config.apiKey || "");

  return { baseUrl, model, pdfModel, pdfInputMode, apiKey };
}

function ensureGptKey() {
  if (!getOpenAiCompatibleConfig().apiKey) {
    throw new Error("未配置 OpenAI 兼容 API Key，请设置 OPENAI_API_KEY 或 agent_model_config.json");
  }
}

function stringifyChatContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    })
    .join("");
}

function extractChatContent(payload) {
  return stringifyChatContent(payload?.choices?.[0]?.message?.content);
}

function extractResponsesContent(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];

  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("");
}

async function readOpenAiCompatibleContent(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await response.json().catch(() => ({}));
    return extractChatContent(payload);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("模型响应流不可读取");
  }

  const decoder = new TextDecoder();
  let pending = "";
  let content = "";

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;

    try {
      const payload = JSON.parse(data);
      const delta = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? "";
      content += stringifyChatContent(delta);
    } catch {
      // Some gateways occasionally emit keepalive fragments; ignore malformed SSE lines.
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    lines.forEach(handleLine);
  }

  pending += decoder.decode();
  if (pending) handleLine(pending);
  return content;
}

async function callGptJson(messages, signal) {
  const { baseUrl, model, apiKey } = getOpenAiCompatibleConfig();
  const body = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 4096,
    stream: true,
    response_format: { type: "json_object" },
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || payload.message || `GPT 解读失败：HTTP ${response.status}`);
  }

  const content = await readOpenAiCompatibleContent(response);
  if (!content.trim()) {
    throw new Error("GPT 没有返回可解析内容");
  }
  return content;
}

async function callGptPdfJson({ filename, pdfBuffer }, signal) {
  const { baseUrl, pdfModel, apiKey } = getOpenAiCompatibleConfig();
  if (pdfBuffer.length > 50 * 1024 * 1024) {
    const error = new Error("PDF 超过 GPT 文件输入 50MB 限制，已无法直读");
    error.isPdfInputUnsupported = true;
    throw error;
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: pdfModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              filename: filename || "resume.pdf",
              file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
            },
            {
              type: "input_text",
              text: makeExtractionPrompt("请解读这份 PDF 简历并") + getAdoptedRulesText(),
            },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || payload.message || `GPT PDF 直读失败：HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.isPdfInputUnsupported =
      response.status === 404 ||
      response.status === 415 ||
      /responses|input_file|file_data|unsupported|not support|unknown/i.test(message);
    throw error;
  }

  const content = extractResponsesContent(payload);
  if (!content.trim()) {
    throw new Error("GPT PDF 直读没有返回可解析内容");
  }
  return content;
}

async function callGptChatPdfJson({ filename, pdfBuffer }, signal) {
  const { baseUrl, pdfModel, apiKey } = getOpenAiCompatibleConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: pdfModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "file",
              file: {
                filename: filename || "resume.pdf",
                file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
              },
            },
            {
              type: "text",
              text: makeExtractionPrompt("请解读这份 PDF 简历并") + getAdoptedRulesText(),
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4096,
      stream: true,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload.error?.message || payload.message || `GPT Chat PDF 直读失败：HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.isPdfInputUnsupported =
      response.status === 400 ||
      response.status === 404 ||
      response.status === 415 ||
      /file|file_data|unsupported|not support|unknown/i.test(message);
    throw error;
  }

  const content = await readOpenAiCompatibleContent(response);
  if (!content.trim()) {
    throw new Error("GPT Chat PDF 直读没有返回可解析内容");
  }
  return content;
}

function normalizeExtractedPdfText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeUtf16Be(buffer) {
  const chars = [];
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    chars.push(String.fromCharCode(buffer[index] * 256 + buffer[index + 1]));
  }
  return chars.join("");
}

function decodePdfStringBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeUtf16Be(buffer.subarray(2));
  }
  return buffer.toString("utf8");
}

function decodePdfLiteralString(raw) {
  const bytes = [];
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\\") {
      bytes.push(raw.charCodeAt(index) & 0xff);
      continue;
    }

    const next = raw[index + 1];
    if (next === undefined) break;
    index += 1;
    if (next === "n") bytes.push(10);
    else if (next === "r") bytes.push(13);
    else if (next === "t") bytes.push(9);
    else if (next === "b") bytes.push(8);
    else if (next === "f") bytes.push(12);
    else if (["\\", "(", ")"].includes(next)) bytes.push(next.charCodeAt(0));
    else if (/\d/.test(next)) {
      let octal = next;
      while (index + 1 < raw.length && octal.length < 3 && /[0-7]/.test(raw[index + 1])) {
        index += 1;
        octal += raw[index];
      }
      bytes.push(parseInt(octal, 8));
    } else if (next === "\r" || next === "\n") {
      if (next === "\r" && raw[index + 1] === "\n") index += 1;
    } else {
      bytes.push(next.charCodeAt(0) & 0xff);
    }
  }
  return decodePdfStringBuffer(Buffer.from(bytes));
}

function decodePdfHexString(hex) {
  const cleaned = hex.replace(/\s+/g, "");
  if (!cleaned || cleaned.length < 2) return "";
  const padded = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`;
  return decodePdfStringBuffer(Buffer.from(padded, "hex"));
}

function collectPdfTextFromSource(source) {
  const parts = [];
  const literalTextPattern = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  const hexTextPattern = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  const arrayTextPattern = /\[((?:.|\n|\r)*?)\]\s*TJ/g;

  source.replace(literalTextPattern, (_, raw) => {
    parts.push(decodePdfLiteralString(raw));
    return "";
  });
  source.replace(hexTextPattern, (_, raw) => {
    parts.push(decodePdfHexString(raw));
    return "";
  });
  source.replace(arrayTextPattern, (_, rawArray) => {
    rawArray.replace(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g, (_match, literal, hex) => {
      parts.push(literal !== undefined ? decodePdfLiteralString(literal) : decodePdfHexString(hex));
      return "";
    });
    return "";
  });

  return parts.join(" ");
}

function extractPdfStreamSources(pdfBuffer) {
  const source = pdfBuffer.toString("latin1");
  const streams = [];
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;

  while ((match = pattern.exec(source))) {
    const dictionary = source.slice(Math.max(0, match.index - 600), match.index);
    const streamBuffer = Buffer.from(match[1], "latin1");
    if (/\/FlateDecode\b/.test(dictionary)) {
      try {
        streams.push(zlib.inflateSync(streamBuffer).toString("latin1"));
      } catch {
        streams.push(streamBuffer.toString("latin1"));
      }
    } else {
      streams.push(streamBuffer.toString("latin1"));
    }
  }

  return streams;
}

function extractTextFromPdfBuffer(pdfBuffer) {
  const sources = [pdfBuffer.toString("latin1"), ...extractPdfStreamSources(pdfBuffer)];
  return normalizeExtractedPdfText(sources.map(collectPdfTextFromSource).join("\n"));
}

async function askGptText(text, signal) {
  return callGptJson(
    [
      {
        role: "system",
        content: "你是招聘场景的简历解析助手。只从简历文本中提取明确出现或可合理判断的信息，不要编造。只返回 JSON。",
      },
      {
        role: "user",
        content: `${makeExtractionPrompt("请根据下面的简历文本")}${getAdoptedRulesText()}\n\n简历文本：\n${text.slice(0, 50000)}`,
      },
    ],
    signal
  );
}

async function askGptFeedbackReview({ resume, feedback }, signal) {
  const normalizedJobType = normalizeJobType(resume.jobType || DEFAULT_JOB_TYPE);
  const currentRules = getCurrentScoringRules(normalizedJobType, resume.scoringVersion || "");
  const adoptedRules = getAppliedAdoptedRulesForVersion(resume.scoringVersion || "", normalizedJobType)
    .map((row) => row.suggestion)
    .filter(Boolean);
  const content = await callGptJson(
    [
      {
        role: "system",
        content:
          "你是招聘评分规则审查助手。你只能根据人工反馈审查当前评分是否合理，并给出规则调整建议；不要直接修改规则。只返回 JSON。",
      },
      {
        role: "user",
        content: `当前岗位：${normalizedJobType}。
当前评分版本：${resume.scoringVersion || currentRules.scoringVersion || getCurrentScoringVersion(normalizedJobType)}
当前岗位评分规则：${JSON.stringify(currentRules.rules)}
当前已采纳补充规则：${JSON.stringify(adoptedRules)}
候选人基础信息：${JSON.stringify({
          name: resume.name,
          school: resume.school,
          schoolLevel: resume.schoolLevel,
          graduation: resume.graduation,
          matchScore: resume.matchScore,
          jobType: normalizedJobType,
        })}
人工筛选反馈：${JSON.stringify(feedback)}

请做自我审查，但不要直接改规则。只返回如下 JSON：
{
  "conflictLevel": "none|low|medium|high",
  "summary": "",
  "scoreDiagnosis": "",
  "suggestedRuleChanges": [],
  "needsHumanApproval": true
}

审查重点：
1. 当前匹配度和人工决策是否冲突。
2. 如果人工认为不合适，判断原因是必须项缺失、加分项不足、风险项命中、表达不清、信息不足，还是评分规则可能偏差。
3. 如果建议调整规则，必须是可解释、可复用的建议，不要因为单条反馈过拟合。
4. needsHumanApproval 必须为 true。`,
      },
    ],
    signal
  );
  return parseJsonObject(content);
}

async function parseResumePdfWithGpt({ filename, pdfBuffer }) {
  ensureGptKey();
  await ensureDatabase();
  const { controller, timeoutId } = makeAbortController(GPT_LONG_TIMEOUT_MS);
  try {
    const start = Date.now();
    const { pdfInputMode } = getOpenAiCompatibleConfig();
    let outputText = "";

    if (pdfInputMode !== "text") {
      try {
        logResume(`direct GPT PDF input start: ${filename}, ${pdfBuffer.length} bytes`);
        outputText = await callGptPdfJson({ filename, pdfBuffer }, controller.signal);
        logResume(`direct GPT PDF input done: ${filename}, elapsed=${Date.now() - start}ms`);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (
          !["auto", "chat"].includes(pdfInputMode) ||
          (pdfInputMode === "chat" && !error.isPdfInputUnsupported)
        ) {
          throw error;
        }
        logResume(`Responses PDF input unavailable, try Chat PDF input: ${error.message}`);
        try {
          outputText = await callGptChatPdfJson({ filename, pdfBuffer }, controller.signal);
          logResume(`direct GPT Chat PDF input done: ${filename}, elapsed=${Date.now() - start}ms`);
        } catch (chatError) {
          if (isAbortError(chatError)) throw chatError;
          if (pdfInputMode !== "auto" && !chatError.isPdfInputUnsupported) {
            throw chatError;
          }
          logResume(`Chat PDF input unavailable, fallback to text extraction: ${chatError.message}`);
        }
      }
    }

    if (!outputText) {
      const text = extractTextFromPdfBuffer(pdfBuffer);
      if (text.length < 80) {
        throw new Error("GPT PDF 直读接口不可用，且服务端未能从该 PDF 提取到足够文字；请使用支持 Responses input_file 的网关，或在页面使用 GPT 快速解析");
      }
      logResume(`direct GPT text fallback start: ${filename}, extracted ${text.length} chars`);
      outputText = await askGptText(text, controller.signal);
    }

    logResume(`direct GPT parse done: ${filename}, elapsed=${Date.now() - start}ms`);
    return normalizeResumeInfo(parseJsonObject(outputText));
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("GPT 解读 PDF 文本超时，请稍后重试或改用快速解析");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseResumeTextWithGpt(text) {
  ensureGptKey();
  await ensureDatabase();
  const { controller, timeoutId } = makeAbortController(GPT_TEXT_TIMEOUT_MS);

  try {
    const start = Date.now();
    logResume(`fast GPT text parse start: ${text.length} chars`);
    const outputText = await askGptText(text, controller.signal);
    logResume(`fast GPT text parse done: elapsed=${Date.now() - start}ms`);
    return normalizeResumeInfo(parseJsonObject(outputText));
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("GPT 文本模型解读超时，请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleParseResumePdf(request, response) {
  try {
    const filename = decodeURIComponent(request.headers["x-file-name"] || "");
    const mimeType = request.headers["content-type"] || "";
    const pdfBuffer = await readRequestBuffer(request);
    const payload = { filename, mimeType, pdfBuffer };
    assertPdfPayload(payload);

    const result = await parseResumePdfWithGpt(payload);
    sendJson(response, 200, { result });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [resume] error: ${error.message}`);
    sendJson(response, 500, { error: error.message || "AI 解读失败" });
  }
}

async function handleParseResumeText(request, response) {
  try {
    const { text } = await readJsonBody(request);
    if (!text || typeof text !== "string") {
      sendJson(response, 400, { error: "缺少简历文本" });
      return;
    }

    const result = await parseResumeTextWithGpt(text);
    sendJson(response, 200, { result });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [resume] error: ${error.message}`);
    sendJson(response, 500, { error: error.message || "AI 解读失败" });
  }
}

async function saveParsedResumeFromPdf({ filename, pdfBuffer, result, parseMode, sourceMeta = {} }) {
  const records = await readDatabase();
  const record = createRecordPayload({
    resume: result,
    fileName: filename,
    parseMode,
    ...sourceMeta,
  });
  const duplicateRecord = findDuplicateCandidateRecord(records, record);

  if (duplicateRecord) {
    const duplicateIndex = records.findIndex((item) => item.id === duplicateRecord.id);
    let duplicatePublicRecord = duplicateRecord;
    if (duplicateIndex >= 0) {
      const mergedSource = buildResumeSourceMetadata({ ...records[duplicateIndex], ...sourceMeta, fileName: filename });
      const identityMeta = buildResumeAutomationIdentityMetadata({ ...records[duplicateIndex], ...sourceMeta });
      if (shouldUpdateResumeSource(records[duplicateIndex], mergedSource) || Object.keys(identityMeta).some((key) => identityMeta[key] && !records[duplicateIndex][key])) {
        records[duplicateIndex] = {
          ...records[duplicateIndex],
          ...mergedSource,
          ...identityMeta,
          updatedAt: new Date().toISOString(),
        };
        duplicatePublicRecord = records[duplicateIndex];
        await writeDatabase(records);
      }
    }
    return {
      duplicate: true,
      rank: getRecordRank(records, duplicateRecord.id),
      record: publicRecord(duplicatePublicRecord),
    };
  }

  const pdfPath = path.join(UPLOAD_DIR, `${record.id}.pdf`);
  await fs.writeFile(pdfPath, pdfBuffer);
  record.pdfPath = pdfPath;
  record.updatedAt = new Date().toISOString();
  records.push(record);
  await writeDatabase(records);

  return {
    duplicate: false,
    rank: getRecordRank(records, record.id),
    record: publicRecord(record),
  };
}

async function reEvaluateResumeRecord(id) {
  const { records, index, record } = await findResume(id);
  if (!record) {
    const error = new Error("简历不存在");
    error.statusCode = 404;
    throw error;
  }
  if (!record.pdfPath) {
    const error = new Error("该候选人没有保存 PDF，无法重评");
    error.statusCode = 409;
    throw error;
  }

  const pdfBuffer = await fs.readFile(record.pdfPath);
  const result = await parseResumePdfWithGpt({
    filename: record.fileName || `${record.name || id}.pdf`,
    pdfBuffer,
  });
  const fields = sanitizeResumeFields({
    name: result.name || record.name,
    phone: result.phone || record.phone,
    jobType: result.jobType || record.jobType,
    school: result.school || record.school,
    major: result.major || result.details?.major || result.education?.major || result.specialty || result.profession || record.major,
    schoolLevel: result.schoolLevel || record.schoolLevel,
    graduation: result.graduation || record.graduation,
    matchScore: result.matchScore ?? "",
    fileName: record.fileName,
  });
  const duplicateRecord = findDuplicateCandidateRecord(records, { ...record, ...fields }, record.id);
  if (duplicateRecord) {
    const rank = getRecordRank(records, duplicateRecord.id);
    const error = new Error(`重评后识别到的电话已存在，当前排名第 ${rank} 名`);
    error.statusCode = 409;
    error.payload = {
      duplicate: true,
      rank,
      resume: publicRecord(duplicateRecord),
    };
    throw error;
  }

  records[index] = applyPositionRuleScoring({
    ...record,
    ...fields,
    ...sanitizeResumeDetails(result),
    parseMode: "re-evaluate",
    scoringVersion: getCurrentScoringVersion(fields.jobType),
    updatedAt: new Date().toISOString(),
  });
  await writeDatabase(records);
  return records[index];
}

function normalizeBatchItem(row, records = []) {
  const payload = parsePayload(row.payload, {});
  const resumeId = row.resume_id || payload.resumeId || "";
  let currentRank = payload.rank || "";

  if (resumeId) {
    currentRank = getRecordRank(records, resumeId, payload.jobType || "");
  } else if (payload.phone) {
    const duplicateRecord = findDuplicateCandidateRecord(records, payload);
    if (duplicateRecord) {
      currentRank = getRecordRank(records, duplicateRecord.id, payload.jobType || duplicateRecord.jobType || "");
    }
  }

  return {
    id: row.id,
    jobId: row.job_id,
    filename: row.filename,
    status: row.status,
    message: row.message || payload.message || "",
    resumeId,
    name: payload.name || "",
    phone: payload.phone || "",
    jobType: payload.jobType || "",
    matchScore: payload.matchScore ?? "",
    rank: currentRank || "",
    currentRank: currentRank || "",
    retryable: row.status === "failed",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getBatchJobStatus(jobId) {
  return getDb().prepare("SELECT status FROM batch_jobs WHERE id = ?").get(jobId)?.status || "";
}

async function getPublicBatchJob(jobId) {
  await ensureDatabase();
  const db = getDb();
  const job = db
    .prepare("SELECT id, parse_mode, status, created_at, updated_at FROM batch_jobs WHERE id = ?")
    .get(jobId);
  if (!job) return null;

  const records = await readDatabase();
  const itemRows = db
    .prepare(
      `SELECT id, job_id, filename, file_path, status, message, resume_id, payload, created_at, updated_at
       FROM batch_items
       WHERE job_id = ?
       ORDER BY created_at ASC`
    )
    .all(jobId);
  const items = itemRows.map((row) => normalizeBatchItem(row, records));
  const counts = items.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "saved") acc.saved += 1;
      if (item.status === "duplicate") acc.duplicate += 1;
      if (item.status === "failed") acc.failed += 1;
      if (item.status === "cancelled") acc.cancelled += 1;
      if (item.status === "pending" || item.status === "parsing") acc.running += 1;
      return acc;
    },
    { total: 0, saved: 0, duplicate: 0, failed: 0, cancelled: 0, running: 0 }
  );

  return {
    id: job.id,
    parseMode: job.parse_mode,
    status: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    counts,
    items,
  };
}

function updateBatchJobStatus(jobId, status) {
  getDb()
    .prepare("UPDATE batch_jobs SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), jobId);
}

function updateBatchItem(itemId, updates) {
  const allowed = {
    status: "status",
    message: "message",
    resumeId: "resume_id",
    payload: "payload",
  };
  const entries = Object.entries(updates).filter(([key]) => allowed[key]);
  if (!entries.length) return;

  const setSql = entries.map(([key]) => `${allowed[key]} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  values.push(new Date().toISOString(), itemId);
  getDb()
    .prepare(`UPDATE batch_items SET ${setSql}, updated_at = ? WHERE id = ?`)
    .run(...values);
}

function updateBatchItemFileReference(item, payload, resolution, message = "") {
  if (!item?.id || !resolution?.filePath) return;
  const nextPayload = {
    ...(payload || {}),
  };
  if (nextPayload.source && resolution.sourcePath) {
    nextPayload.sourcePath = resolution.sourcePath;
  }
  const updateFields = ["file_path = ?", "payload = ?", "updated_at = ?"];
  const values = [resolution.filePath, JSON.stringify(nextPayload), new Date().toISOString()];
  if (message) {
    updateFields.splice(1, 0, "message = ?");
    values.splice(1, 0, message);
  }
  values.push(item.id);
  getDb()
    .prepare(`UPDATE batch_items SET ${updateFields.join(", ")} WHERE id = ?`)
    .run(...values);
  item.file_path = resolution.filePath;
  item.payload = JSON.stringify(nextPayload);
}

async function processBatchJob(jobId) {
  await ensureDatabase();
  if (getBatchJobStatus(jobId) === "cancelled") return;
  updateBatchJobStatus(jobId, "running");

  while (true) {
    const currentStatus = getBatchJobStatus(jobId);
    if (currentStatus === "paused" || currentStatus === "cancelled") break;

    const item = getDb()
      .prepare(
        `SELECT id, job_id, filename, file_path, status, message, resume_id, payload, created_at, updated_at
         FROM batch_items
         WHERE job_id = ? AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(jobId);

    if (!item) break;

    updateBatchItem(item.id, {
      status: "parsing",
      message: "后端队列正在解析",
    });

    try {
      const itemPayload = parsePayload(item.payload, {});
      const fileResolution = resolveBatchItemFileReference(item, itemPayload);
      if (!fileResolution.filePath) {
        throw new Error("原始批量文件不存在，等待文件夹扫描重新入队");
      }
      if (
        fileResolution.filePath !== item.file_path ||
        (itemPayload.source && fileResolution.sourcePath && itemPayload.sourcePath !== fileResolution.sourcePath)
      ) {
        updateBatchItemFileReference(item, itemPayload, fileResolution, "已从当前下载目录找回原始文件，继续解析");
      }
      const resolvedPayload = parsePayload(item.payload, itemPayload);
      const sourceMeta = buildResumeSourceMetadata({
        ...resolvedPayload,
        filename: item.filename,
        fileName: item.filename,
        filePath: item.file_path,
      });
      const identityMeta = buildResumeAutomationIdentityMetadata(resolvedPayload);
      const pdfBuffer = await fs.readFile(item.file_path);
      const result = await parseResumePdfWithGpt({ filename: item.filename, pdfBuffer });
      if (getBatchJobStatus(jobId) === "cancelled") {
        updateBatchItem(item.id, {
          status: "cancelled",
          message: "任务已取消，未写入简历库",
        });
        break;
      }
      const saveResult = await saveParsedResumeFromPdf({
        filename: item.filename,
        pdfBuffer,
        result,
        parseMode: "direct-batch",
        sourceMeta: { ...sourceMeta, ...identityMeta },
      });
      const record = saveResult.record || {};
      const importStatus = saveResult.duplicate ? "duplicate" : "saved";
      const payload = {
        ...resolvedPayload,
        ...result,
        ...sourceMeta,
        ...identityMeta,
        source: resolvedPayload.source || sourceMeta.importSource || "",
        sourcePath: resolvedPayload.sourcePath || fileResolution.sourcePath || "",
        sourceHash: resolvedPayload.sourceHash || "",
        size: resolvedPayload.size || "",
        trigger: resolvedPayload.trigger || "",
        importSource: resolvedPayload.source || sourceMeta.importSource || "",
        accountId: sourceMeta.accountId || resolvedPayload.accountId || "",
        accountLabel: resolvedPayload.accountLabel || sourceMeta.accountName || "",
        accountName: sourceMeta.accountName || resolvedPayload.accountName || "",
        email: resolvedPayload.email || "",
        imapHost: resolvedPayload.imapHost || "",
        emailSourceKind: resolvedPayload.emailSourceKind || sourceMeta.emailSourceKind || "",
        sourceLabel: sourceMeta.sourceLabel || resolvedPayload.sourceLabel || "",
        sourcePlatform: sourceMeta.sourcePlatform || resolvedPayload.sourcePlatform || "",
        conversationKey: identityMeta.conversationKey || "",
        candidateIdentityKey: identityMeta.candidateIdentityKey || "",
        sourceKey: identityMeta.sourceKey || resolvedPayload.sourceKey || "",
        platformContact: identityMeta.platformContact || resolvedPayload.platformContact || null,
        resumeId: record.id || "",
        name: record.name || result.name || "",
        phone: record.phone || result.phone || "",
        jobType: record.jobType || result.jobType || "",
        matchScore: record.matchScore ?? result.matchScore ?? "",
        rank: saveResult.rank || "",
      };

      updateBatchItem(item.id, {
        status: importStatus,
        message: saveResult.duplicate
          ? `已上传过，当前排名第 ${saveResult.rank || "-"} 名`
          : `已入库，当前排名第 ${saveResult.rank || "-"} 名`,
        resumeId: record.id || "",
        payload: JSON.stringify(payload),
      });
      await markBossImportCompleted(item, {
        status: importStatus,
        resumeId: record.id || "",
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] [batch] ${item.filename}: ${error.message}`);
      updateBatchItem(item.id, {
        status: "failed",
        message: error.message || "解析失败",
      });
    }
  }

  const finalStatus = getBatchJobStatus(jobId);
  if (finalStatus === "paused" || finalStatus === "cancelled") return;

  const running = getDb()
    .prepare("SELECT COUNT(*) AS count FROM batch_items WHERE job_id = ? AND status IN ('pending', 'parsing')")
    .get(jobId).count;
  if (running > 0) {
    updateBatchJobStatus(jobId, "running");
    return;
  }

  const failed = getDb()
