function renderRuleSuggestions(suggestions = []) {
  if (!elements.ruleTableBody) return;

  elements.ruleTableBody.replaceChildren();
  const pendingCount = suggestions.filter((item) => item.status === "pending").length;
  const adoptedCount = suggestions.filter((item) => item.status === "adopted").length;
  const activeJobType = getActiveJobType();
  const scopeLabel = activeJobType || "全部岗位";
  elements.ruleSummary.textContent = `${scopeLabel}：待审核 ${pendingCount} 条，已采纳 ${adoptedCount} 条`;

  if (!suggestions.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "暂无规则建议";
    row.appendChild(cell);
    elements.ruleTableBody.appendChild(row);
    return;
  }

  suggestions.forEach((item) => {
    const row = document.createElement("tr");

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `batch-status ${getRuleStatusClass(item.status)}`.trim();
    statusBadge.textContent = RULE_STATUS_LABELS[item.status] || item.status;
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);

    setCellText(row, [item.jobType, item.resumeName || item.resumePhone || "-"].filter(Boolean).join(" · "));
    setCellText(row, formatRuleSuggestionText(item.suggestion));
    setCellText(row, item.sourceSummary);

    const actionCell = document.createElement("td");
    if (item.status === "pending") {
      const adoptBtn = document.createElement("button");
      adoptBtn.className = "ghost-btn small";
      adoptBtn.type = "button";
      adoptBtn.textContent = "采纳";
      adoptBtn.addEventListener("click", () => updateRuleSuggestion(item.id, "adopt"));
      actionCell.appendChild(adoptBtn);

      const rejectBtn = document.createElement("button");
      rejectBtn.className = "ghost-btn small";
      rejectBtn.type = "button";
      rejectBtn.textContent = "拒绝";
      rejectBtn.addEventListener("click", () => updateRuleSuggestion(item.id, "reject"));
      actionCell.appendChild(rejectBtn);
    } else {
      actionCell.textContent = "-";
    }

    row.appendChild(actionCell);
    elements.ruleTableBody.appendChild(row);
  });
}

async function loadRuleSuggestions() {
  if (!elements.ruleTableBody) return [];
  const jobType = getActiveJobType();
  const query = jobType ? `?jobType=${encodeURIComponent(jobType)}` : "";
  const payload = await requestJson(`/api/rule-suggestions${query}`);
  const suggestions = payload.suggestions || [];
  renderRuleSuggestions(suggestions);
  return suggestions;
}

async function updateRuleSuggestion(id, action) {
  setStatus(action === "adopt" ? "采纳规则中" : "更新规则建议", "is-working");
  try {
    const payload = await requestJson(`/api/rule-suggestions/${id}/${action}`, {
      method: "POST",
    });
    renderRuleSuggestions(payload.suggestions || []);
    if (elements.scoringRulesBox && !elements.scoringRulesBox.hidden) {
      await loadScoringRules();
    }
    setStatus(action === "adopt" ? "规则已采纳" : "规则已拒绝", "is-done");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "规则更新失败");
  }
}

function fillFeedbackForm(feedback) {
  elements.feedbackDecision.value = feedback?.decision || "pending";
  renderFeedbackTagOptions(currentFeedbackTagOptions || DEFAULT_FEEDBACK_TAG_OPTIONS, {
    positiveTags: feedback?.positiveTags || [],
    negativeTags: feedback?.negativeTags || [],
    dimensions: feedback?.dimensions || [],
  });
  renderFeedbackTagOptions(currentFeedbackTagOptions || DEFAULT_FEEDBACK_TAG_OPTIONS, {
    positiveTags: feedback?.positiveTags || [],
    negativeTags: feedback?.negativeTags || [],
    dimensions: feedback?.dimensions || [],
  });
  setCheckedValues("positiveTags", feedback?.positiveTags || []);
  setCheckedValues("negativeTags", feedback?.negativeTags || []);
  setCheckedValues("dimensions", feedback?.dimensions || []);
  elements.feedbackReason.value = feedback?.reason || "";
  elements.feedbackAffectsScoring.checked = Boolean(feedback?.affectsScoring);
  renderFeedbackReview(feedback?.review);
}

function renderDetailList(listElement, items = [], emptyText) {
  if (!listElement) return;
  listElement.replaceChildren();
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    listElement.appendChild(li);
    return;
  }

  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    listElement.appendChild(li);
  });
}

function renderResumeInsights(resume = {}) {
  if (!elements.detailScoringVersion) return;
  const breakdown = resume.scoreBreakdown || {};
  const quality = resume.parseQuality || {};
  const versionMeta = resume.scoringVersionMeta || {};
  elements.detailScoringVersionName.textContent = versionMeta.displayName || "未命名评分版本";
  elements.detailScoringVersion.textContent = [
    `版本号：${resume.scoringVersion || "-"}`,
    versionMeta.ruleScope ? `规则范围：${versionMeta.ruleScope}` : "",
    versionMeta.isCurrent === false ? "非当前最新版本" : "当前最新版本",
  ]
    .filter(Boolean)
    .join("；");
  elements.detailConfidence.textContent =
    quality.confidence === "" || quality.confidence === undefined ? "-" : `${quality.confidence}%`;
  elements.detailScoreSummary.textContent = breakdown.summary || "暂无评分拆解";

  const riskItems = [
    ...(Array.isArray(breakdown.risks) ? breakdown.risks : []),
    ...(Array.isArray(quality.missingFields) && quality.missingFields.length
      ? [`缺失字段：${quality.missingFields.join("、")}`]
      : []),
  ];
  renderDetailList(elements.detailScoreRisks, riskItems, "暂无风险提示");
  renderDetailList(elements.detailParseWarnings, quality.warnings || [], "暂无解析提醒");
}

async function testFeishuConnection() {
  elements.feishuStatus.textContent = "飞书：检测中";
  try {
    const payload = await requestJson("/api/feishu/status");
    elements.feishuStatus.textContent = payload.connected ? `飞书：已连接 ${payload.appId}` : "飞书：连接失败";
  } catch (error) {
    elements.feishuStatus.textContent = `飞书：${error.message}`;
  }
}

async function openResumeEditor(id, options = {}) {
  const scrollTarget = options.scrollTarget || "panel";
  const scrollBehavior = options.scrollBehavior || "smooth";
  const payload = await requestJson(`/api/resumes/${id}`);
  const resume = payload.resume;
  activeDetailResume = resume;

  elements.editPanel.hidden = false;
  elements.editId.value = resume.id;
  elements.editName.value = resume.name || "";
  elements.editPhone.value = resume.phone || "";
  if (elements.editGender) elements.editGender.value = resume.gender || "";
  ensureEditJobTypeOption(resume.jobType);
  elements.editJobType.value = normalizeJobType(resume.jobType);
  if (elements.editMajor) elements.editMajor.value = resume.major || "";
  elements.editSchool.value = resume.school || "";
  elements.editSchoolLevel.value = resume.schoolLevel || "";
  elements.editGraduation.value = resume.graduation || "";
  elements.editMatchScore.value = hasMatchScore(resume.matchScore) ? Number(resume.matchScore) : "";
  renderResumeInsights(resume);
  await loadFeedbackTagOptions(resume.jobType, {
    positiveTags: resume.feedback?.positiveTags || [],
    negativeTags: resume.feedback?.negativeTags || [],
    dimensions: resume.feedback?.dimensions || [],
  });
  fillFeedbackForm(resume.feedback);
  elements.pdfPreviewTitle.textContent = resume.fileName || "PDF 预览";
  await renderPdfPreview(resume.hasPdf ? `/api/resumes/${resume.id}/pdf?t=${Date.now()}` : "");
  syncRecordsPageToResume(resume.id);
  if (scrollTarget === "pdf") {
    scrollResumePreviewIntoView({ behavior: scrollBehavior });
  } else {
    elements.editPanel.scrollIntoView({ behavior: scrollBehavior, block: "start" });
  }
}

function setPdfCopyStatus(message, state = "") {
  if (!elements.pdfPages) return;
  let notice = elements.pdfPages.querySelector(".pdf-copy-status");
  if (!notice) {
    notice = document.createElement("p");
    notice.className = "pdf-copy-status";
    elements.pdfPages.prepend(notice);
  }
  notice.textContent = message;
  notice.className = `pdf-copy-status ${state}`.trim();
}

async function copyActiveResumePdf() {
  if (!activeDetailResume?.id || !activeDetailResume?.hasPdf) {
    setPdfCopyStatus("复制失败", "is-error");
    return;
  }
  setPdfCopyStatus("正在复制 PDF...", "is-working");
  try {
    const payload = await requestJson(`/api/resumes/${activeDetailResume.id}/copy-pdf`, { method: "POST" });
    setPdfCopyStatus(payload.fileName ? `复制成功：${payload.fileName}` : "复制成功", "is-done");
  } catch (error) {
    console.error(error);
    setPdfCopyStatus("复制失败", "is-error");
  }
}

function openActiveResumeConversationFromPdf(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  if (!activeDetailResume?.id) {
    setPdfCopyStatus("没有可打开的聊天记录", "is-error");
    return;
  }
  if (typeof openResumeConversation !== "function") {
    setPdfCopyStatus("聊天记录功能未加载", "is-error");
    return;
  }
  openResumeConversation(activeDetailResume.id);
}

async function renderPdfPreview(pdfUrl) {
  elements.pdfPages.replaceChildren();
  elements.pdfPages.scrollTop = 0;

  if (!pdfUrl) {
    elements.pdfPages.innerHTML = '<p class="pdf-empty">暂无 PDF 文件</p>';
    return;
  }

  if (!window.pdfjsLib) {
    renderPdfFallback(pdfUrl, "PDF 预览组件加载失败，已切换到原始 PDF");
    return;
  }

  elements.pdfPages.innerHTML = '<p class="pdf-empty">正在渲染 PDF 页面...</p>';
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

  try {
    const pdf = await window.pdfjsLib.getDocument({ url: pdfUrl }).promise;
    elements.pdfPages.replaceChildren();
    elements.pdfPages.scrollTop = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(elements.pdfPages.clientWidth - 30, 320);
      const scale = Math.min(2, availableWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const ratio = window.devicePixelRatio || 1;

      canvas.className = "pdf-page-canvas";
      canvas.title = "左键复制 PDF；右键查看聊天记录";
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.maxWidth = "100%";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      elements.pdfPages.appendChild(canvas);
      await page.render({ canvasContext: context, viewport }).promise;
      canvas.addEventListener("click", copyActiveResumePdf);
      canvas.addEventListener("contextmenu", openActiveResumeConversationFromPdf);
    }
  } catch (error) {
    console.error(error);
    renderPdfFallback(pdfUrl, "PDF 图片预览失败，已切换到原始 PDF");
  }
}

function renderPdfFallback(pdfUrl, message) {
  elements.pdfPages.replaceChildren();
  elements.pdfPages.scrollTop = 0;

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-fallback";

  const notice = document.createElement("p");
  notice.className = "pdf-copy-status is-working";
  notice.textContent = message || "已切换到原始 PDF";

  const link = document.createElement("a");
  link.className = "pdf-open-link";
  link.href = pdfUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "打开原始 PDF";
  link.title = "左键打开原始 PDF；右键查看聊天记录";
  link.addEventListener("contextmenu", openActiveResumeConversationFromPdf);

  const frame = document.createElement("iframe");
  frame.className = "pdf-fallback-frame";
  frame.src = pdfUrl;
  frame.title = activeDetailResume?.fileName || "PDF";

  wrapper.append(notice, link, frame);
  elements.pdfPages.appendChild(wrapper);
}

async function saveEdit(event) {
  event.preventDefault();
  const id = elements.editId.value;
  if (!id) return;

  const payload = await requestJson(`/api/resumes/${id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: elements.editName.value,
      phone: elements.editPhone.value,
      gender: elements.editGender?.value || "",
      jobType: elements.editJobType.value,
      major: elements.editMajor?.value || "",
      school: elements.editSchool.value,
      schoolLevel: elements.editSchoolLevel.value,
      graduation: elements.editGraduation.value,
      matchScore: elements.editMatchScore.value,
    }),
  });

  renderResult(payload.resume);
  activeDetailResume = payload.resume;
  renderResumeInsights(payload.resume);
  await loadResumeList();
  setStatus("保存成功", "is-done");
}

async function reEvaluateCurrentResume() {
  const id = elements.editId.value;
  if (!id || isBatchRunning) return;

  elements.reEvaluateBtn.disabled = true;
  setStatus("正在按当前规则重评", "is-working");
  try {
    await requestJson(`/api/resumes/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: elements.editName.value,
        phone: elements.editPhone.value,
        gender: elements.editGender?.value || "",
        jobType: elements.editJobType.value,
        major: elements.editMajor?.value || "",
        school: elements.editSchool.value,
        schoolLevel: elements.editSchoolLevel.value,
        graduation: elements.editGraduation.value,
        matchScore: elements.editMatchScore.value,
      }),
    });

    const payload = await requestJson(`/api/resumes/${id}/re-evaluate`, {
      method: "POST",
    });
    const resume = payload.resume;
    activeDetailResume = resume;
    renderResult(resume);
    elements.editName.value = resume.name || "";
    elements.editPhone.value = resume.phone || "";
    if (elements.editGender) elements.editGender.value = resume.gender || "";
    ensureEditJobTypeOption(resume.jobType);
    elements.editJobType.value = normalizeJobType(resume.jobType);
    if (elements.editMajor) elements.editMajor.value = resume.major || "";
    elements.editSchool.value = resume.school || "";
    elements.editSchoolLevel.value = resume.schoolLevel || "";
    elements.editGraduation.value = resume.graduation || "";
    elements.editMatchScore.value = hasMatchScore(resume.matchScore) ? Number(resume.matchScore) : "";
    renderResumeInsights(resume);
    await loadResumeList();
    setStatus(`重评完成，当前排名第 ${payload.rank || "-"} 名`, "is-done");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "重评失败");
  } finally {
    elements.reEvaluateBtn.disabled = false;
  }
}

async function saveFeedback(event) {
  event.preventDefault();
  const id = elements.editId.value;
  if (!id) return;

  setStatus("审查反馈中", "is-working");
  elements.feedbackReview.textContent = "正在让模型审查这条反馈和当前评分准则...";

  try {
    const payload = await requestJson(`/api/resumes/${id}/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        decision: elements.feedbackDecision.value,
        positiveTags: collectCheckedValues("positiveTags"),
        negativeTags: collectCheckedValues("negativeTags"),
        dimensions: collectCheckedValues("dimensions"),
        reason: elements.feedbackReason.value,
        affectsScoring: elements.feedbackAffectsScoring.checked,
      }),
    });

    fillFeedbackForm(payload.feedback);
    await loadResumeList();
    await loadRuleSuggestions();
    setStatus("反馈已保存", "is-done");
  } catch (error) {
    console.error(error);
    elements.feedbackReview.textContent = error.message || "反馈审查失败";
    setStatus("反馈失败");
  }
}

function isPdfFile(file) {
  return Boolean(file) && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
}

function getBatchStatusClass(status) {
  if (status === "parsing") return "is-working";
  if (status === "saved") return "is-done";
  if (status === "duplicate") return "is-duplicate";
  if (status === "cancelled") return "is-muted";
  if (status === "failed") return "is-failed";
  return "";
}

function updateBatchItem(item, updates) {
  Object.assign(item, updates);
  renderBatchQueue();
}

function buildRankMaps(resumes) {
  const rankedResumes = getScoreSortedResumes(resumes);
  const byPhone = new Map();
  const byId = new Map();

  rankedResumes.forEach((resume, index) => {
    const rank = index + 1;
    const phoneKey = normalizePhoneKey(resume.phone);
    if (phoneKey && !byPhone.has(phoneKey)) {
      byPhone.set(phoneKey, rank);
    }
  });

  JOB_TYPES.forEach((jobType) => {
    const rankedByJob = getScoreSortedResumes(resumes.filter((resume) => normalizeJobType(resume.jobType) === jobType));
    rankedByJob.forEach((resume, index) => {
      const rank = index + 1;
      const phoneKey = normalizePhoneKey(resume.phone);
      byId.set(resume.id, rank);
      if (phoneKey && !byPhone.has(`${jobType}:${phoneKey}`)) {
        byPhone.set(`${jobType}:${phoneKey}`, rank);
      }
    });
  });

  return { byPhone, byId };
}

function syncBatchRanks(resumes = []) {
  if (!batchQueue.length) return;

  const { byPhone, byId } = buildRankMaps(resumes);
  let changed = false;

  batchQueue.forEach((item) => {
    if (!["saved", "duplicate"].includes(item.status)) return;

    const phoneKey = normalizePhoneKey(item.phone);
    const jobKey = normalizeJobType(item.jobType);
    const nextRank = (phoneKey && byPhone.get(`${jobKey}:${phoneKey}`)) || (phoneKey && byPhone.get(phoneKey)) || byId.get(item.resumeId) || "";
    if (item.currentRank !== nextRank) {
      item.currentRank = nextRank;
      changed = true;
    }
  });

  if (changed) {
    renderBatchQueue();
  }
}

function renderBatchQueue() {
  const fragment = document.createDocumentFragment();
  const totalPages = Math.max(1, Math.ceil(batchQueue.length / BATCH_PAGE_SIZE));
  batchPage = Math.min(Math.max(1, batchPage), totalPages);

  if (elements.batchPageInfo) {
    elements.batchPageInfo.textContent = `${batchPage} / ${totalPages}`;
  }

  if (elements.batchPrevBtn) {
    elements.batchPrevBtn.disabled = batchPage <= 1;
  }

  if (elements.batchNextBtn) {
    elements.batchNextBtn.disabled = batchPage >= totalPages;
  }

  if (!batchQueue.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "暂无批量任务";
    row.appendChild(cell);
    fragment.appendChild(row);
    elements.batchTableBody.replaceChildren(fragment);
    elements.batchSummary.textContent = "等待上传";
    elements.retryFailedBtn.disabled = true;
    elements.pauseBatchBtn.disabled = true;
    elements.resumeBatchBtn.disabled = true;
    elements.cancelBatchBtn.disabled = true;
    return;
  }

  const pageItems = batchQueue.slice((batchPage - 1) * BATCH_PAGE_SIZE, batchPage * BATCH_PAGE_SIZE);
  pageItems.forEach((item) => {
    const row = document.createElement("tr");
    setCellText(row, item.filename || item.file?.name || "-");

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `batch-status ${getBatchStatusClass(item.status)}`.trim();
    statusBadge.textContent = BATCH_STATUS_LABELS[item.status] || item.status;
    statusCell.appendChild(statusBadge);
    row.appendChild(statusCell);

    setCellText(row, item.name);
    setCellText(row, item.phone);
    setCellText(row, item.jobType);
    setCellText(row, hasMatchScore(item.matchScore) ? `${Number(item.matchScore)}%` : "-");
    setCellText(row, item.currentRank || item.rank ? `第 ${item.currentRank || item.rank} 名` : "-");
    setCellText(row, item.message);
    fragment.appendChild(row);
  });
  elements.batchTableBody.replaceChildren(fragment);

  const total = batchQueue.length;
  const saved = batchQueue.filter((item) => item.status === "saved").length;
  const duplicate = batchQueue.filter((item) => item.status === "duplicate").length;
  const failed = batchQueue.filter((item) => item.status === "failed").length;
  const cancelled = batchQueue.filter((item) => item.status === "cancelled").length;
  const finished = saved + duplicate + failed + cancelled;
  const pageStart = (batchPage - 1) * BATCH_PAGE_SIZE + 1;
  const pageEnd = Math.min(batchPage * BATCH_PAGE_SIZE, total);
  const statusNote = currentBatchStatus === "paused" ? "；任务已暂停" : currentBatchStatus === "cancelled" ? "；任务已取消" : "";
  elements.batchSummary.textContent = `已完成 ${finished} / ${total}，成功 ${saved}，重复 ${duplicate}，失败 ${failed}，取消 ${cancelled}；当前显示 ${pageStart}-${pageEnd}${statusNote}`;
  elements.retryFailedBtn.disabled =
    isBatchRunning ||
    currentBatchStatus === "cancelled" ||
    !batchQueue.some((item) => item.status === "failed" && item.retryable !== false);
  elements.pauseBatchBtn.disabled = !isBatchRunning;
  elements.resumeBatchBtn.disabled = currentBatchStatus !== "paused";
  elements.cancelBatchBtn.disabled = !currentBatchJobId || ["completed", "completed_with_errors", "cancelled"].includes(currentBatchStatus);
}

async function parseAndSaveFile(file, mode, { openDetail = false } = {}) {
  resetFields();
  elements.fileName.textContent = file.name;
  elements.fileCard.hidden = false;

  const result = await parseDirect(file);

  renderResult(result);
  setStatus("保存入库中", "is-working");
  const saveResult = await createResumeRecord(file, result, "direct");
  const savedRecord = saveResult.record;
  renderResult(savedRecord || result);
  const latestResumes = await loadResumeList();
  if (openDetail) {
    await openResumeEditor(savedRecord.id);
  }

  return {
    result,
    saveResult,
    savedRecord,
    usedDirectFallback: false,
    latestResumes,
  };
}

function clearBatchPoll() {
  if (batchPollTimer) {
    window.clearTimeout(batchPollTimer);
    batchPollTimer = 0;
  }
}

function isBatchJobActive(job) {
  return ["pending", "running"].includes(job?.status) && (job.items || []).some((item) => ["pending", "parsing"].includes(item.status));
}

function applyBatchJob(job) {
  if (!job) return;
  currentBatchJobId = job.id;
  currentBatchStatus = job.status || "";
  batchQueue = (job.items || []).map((item) => ({
    ...item,
    retryable: item.status === "failed",
  }));
  isBatchRunning = isBatchJobActive(job);
  const isPaused = job.status === "paused";
  if (isBatchRunning) {
    window.localStorage.setItem(BATCH_JOB_STORAGE_KEY, job.id);
  } else if (!isPaused) {
    window.localStorage.removeItem(BATCH_JOB_STORAGE_KEY);
  }
  renderBatchQueue();
}

async function pollBatchJob(jobId, { openSingle = false } = {}) {
  clearBatchPoll();

  const tick = async () => {
    try {
      const payload = await requestJson(`/api/batch-jobs/${jobId}`);
      const job = payload.job;
      applyBatchJob(job);

      if (isBatchJobActive(job)) {
        setStatus("后端批量队列处理中", "is-working");
        batchPollTimer = window.setTimeout(tick, 1500);
        return;
      }

      await loadResumeList();
      isBatchRunning = false;
      renderBatchQueue();
      if (job.status === "paused") {
        setStatus("批量任务已暂停");
        return;
      }
      if (job.status === "cancelled") {
        setStatus("批量任务已取消");
        return;
      }
      window.localStorage.removeItem(BATCH_JOB_STORAGE_KEY);
      const failed = (job.items || []).filter((item) => item.status === "failed").length;
      setStatus(failed ? "批量完成，有失败项" : "批量完成", failed ? "" : "is-done");

      if (openSingle && job.items?.length === 1) {
        const item = job.items[0];
        if (item.resumeId && ["saved", "duplicate"].includes(item.status)) {
          await openResumeEditor(item.resumeId);
        }
      }
    } catch (error) {
      console.error(error);
      isBatchRunning = false;
      renderBatchQueue();
      setStatus(error.message || "批量任务查询失败");
    }
  };

  await tick();
}

async function startBackendBatch(files) {
  const selectedFiles = [...(files || [])];
  const pdfFiles = selectedFiles.filter(isPdfFile);

  batchPage = 1;
  setBatchPanelExpanded(true);
  batchQueue = selectedFiles.map((file, index) => ({
    id: `${Date.now()}-${index}-${file.name}`,
    filename: file.name,
    file,
    status: isPdfFile(file) ? "pending" : "failed",
    retryable: isPdfFile(file),
    name: "",
    phone: "",
    jobType: "",
    matchScore: "",
    message: isPdfFile(file) ? "等待上传到后端队列" : "仅支持 PDF",
  }));
  renderBatchQueue();

  if (!pdfFiles.length) {
    setStatus("没有可解析PDF");
    return;
  }

  isBatchRunning = true;
  setStatus("创建后端批量任务", "is-working");
  renderBatchQueue();

  const created = await requestJson("/api/batch-jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parseMode: "direct" }),
  });

  currentBatchJobId = created.job.id;
  window.localStorage.setItem(BATCH_JOB_STORAGE_KEY, currentBatchJobId);

  for (let index = 0; index < pdfFiles.length; index += 1) {
    const file = pdfFiles[index];
    const localItem = batchQueue.find((item) => item.file === file);
    if (localItem) {
      updateBatchItem(localItem, {
        message: `上传到后端队列 ${index + 1}/${pdfFiles.length}`,
      });
    }

    await requestJson(`/api/batch-jobs/${currentBatchJobId}/files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    });
  }

  const started = await requestJson(`/api/batch-jobs/${currentBatchJobId}/start`, {
    method: "POST",
  });
  applyBatchJob(started.job);
  await pollBatchJob(currentBatchJobId, { openSingle: pdfFiles.length === 1 });
}

async function retryFailedBatchItems() {
  if (!currentBatchJobId || isBatchRunning) return;
  isBatchRunning = true;
  setBatchPanelExpanded(true);
  renderBatchQueue();
  setStatus("重试失败项", "is-working");
  try {
    const payload = await requestJson(`/api/batch-jobs/${currentBatchJobId}/retry`, {
      method: "POST",
    });
    applyBatchJob(payload.job);
    await pollBatchJob(currentBatchJobId);
  } catch (error) {
    console.error(error);
    isBatchRunning = false;
    renderBatchQueue();
    setStatus(error.message || "重试失败");
  }
}

async function updateBatchJobAction(action, label) {
  if (!currentBatchJobId) return;
  setBatchPanelExpanded(true);
  setStatus(label, "is-working");
  try {
    const payload = await requestJson(`/api/batch-jobs/${currentBatchJobId}/${action}`, {
      method: "POST",
    });
    applyBatchJob(payload.job);
    if (action === "resume") {
      await pollBatchJob(currentBatchJobId);
      return;
    }
    isBatchRunning = isBatchJobActive(payload.job);
    renderBatchQueue();
    setStatus(action === "pause" ? "批量任务已暂停" : "批量任务已取消", action === "cancel" ? "" : "is-done");
  } catch (error) {
    console.error(error);
    setStatus(error.message || `${label}失败`);
  }
}

function renderBossFolderScan(payload = {}) {
  const summary = payload.summary || {};
  const files = payload.files || [];
  bossFolderScan = payload;

  const text = `已扫描 ${summary.scanned || 0} 个 PDF，新增 ${summary.newFiles || 0} 个，可导入 ${summary.importable || 0} 个，已导入过 ${summary.skippedImported || 0} 个`;
  if (elements.bossFolderSummary) {
    elements.bossFolderSummary.textContent = text;
  }
  elements.batchSummary.textContent = files.length
    ? `${text}；点击“确认导入”后才会开始模型解析`
    : `${payload.message || "BOSS 简历文件夹暂无新增 PDF"}；${text}`;

  if (elements.importBossFolderBtn) {
    elements.importBossFolderBtn.disabled = isBatchRunning || !files.length;
  }
}

async function scanBossResumeFolder() {
  if (isBatchRunning) {
    setStatus("批量任务运行中，请稍后再扫描");
    return;
  }

  setBatchPanelExpanded(true);
  setStatus("正在扫描 BOSS 简历文件夹", "is-working");
  elements.batchSummary.textContent = "正在扫描 boss-resumes 文件夹，不会调用模型...";
  if (elements.scanBossFolderBtn) elements.scanBossFolderBtn.disabled = true;
  if (elements.importBossFolderBtn) elements.importBossFolderBtn.disabled = true;

  try {
    const payload = await requestJson("/api/import-folder/boss-resumes/scan?limit=30");
    renderBossFolderScan(payload);
    setStatus("BOSS 简历文件夹扫描完成", "is-done");
  } catch (error) {
    console.error(error);
    bossFolderScan = null;
    if (elements.bossFolderSummary) elements.bossFolderSummary.textContent = "扫描失败";
    elements.batchSummary.textContent = error.message || "扫描 BOSS 简历文件夹失败";
    setStatus(error.message || "扫描失败");
  } finally {
    if (elements.scanBossFolderBtn) elements.scanBossFolderBtn.disabled = false;
  }
}

function renderZhilianFolderScan(payload = {}) {
  const summary = payload.summary || {};
  const files = payload.files || [];
  zhilianFolderScan = payload;

  const text = `已扫描 ${summary.scanned || 0} 个 PDF，新增 ${summary.newFiles || 0} 个，可导入 ${summary.importable || 0} 个，已导入过 ${summary.skippedImported || 0} 个`;
  if (elements.zhilianFolderSummary) {
    elements.zhilianFolderSummary.textContent = text;
  }
  if (elements.batchSummary) {
    elements.batchSummary.textContent = files.length
      ? `${text}；点击“确认导入”后才会开始模型解析`
      : `${payload.message || "智联简历文件夹暂无新增 PDF"}；${text}`;
  }

  if (elements.importZhilianFolderBtn) {
    elements.importZhilianFolderBtn.disabled = isBatchRunning || !files.length;
  }
}

async function scanZhilianResumeFolder() {
  if (isBatchRunning) {
    setStatus("批量任务运行中，请稍后再扫描");
    return;
  }

  setBatchPanelExpanded(true);
  setStatus("正在扫描智联简历文件夹", "is-working");
  if (elements.batchSummary) elements.batchSummary.textContent = "正在扫描智联简历下载目录，不会调用模型...";
  if (elements.scanZhilianFolderBtn) elements.scanZhilianFolderBtn.disabled = true;
  if (elements.importZhilianFolderBtn) elements.importZhilianFolderBtn.disabled = true;

  try {
    const payload = await requestJson("/api/import-folder/zhilian-resumes/scan?limit=30");
    renderZhilianFolderScan(payload);
    setStatus("智联简历文件夹扫描完成", "is-done");
  } catch (error) {
    console.error(error);
    zhilianFolderScan = null;
    if (elements.zhilianFolderSummary) elements.zhilianFolderSummary.textContent = "扫描失败";
    if (elements.batchSummary) elements.batchSummary.textContent = error.message || "扫描智联简历文件夹失败";
    setStatus(error.message || "扫描失败");
  } finally {
    if (elements.scanZhilianFolderBtn) elements.scanZhilianFolderBtn.disabled = false;
  }
}

async function importEmailResumes() {
  if (isBatchRunning) {
    setStatus("批量任务运行中，请稍后再导入邮箱");
    return;
  }

  setBatchPanelExpanded(true);
  setStatus("正在读取邮箱附件", "is-working");
  if (elements.emailImportSummary) {
    elements.emailImportSummary.textContent = "正在连接邮箱并下载 PDF / Word 简历附件...";
  }
  if (elements.importEmailBtn) elements.importEmailBtn.disabled = true;

  try {
    const payload = await requestJson("/api/email/resumes/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: "all" }),
    });

    const summary = payload.summary || {};
    const text = `邮箱附件：新增 ${summary.saved || 0} 份，重复 ${summary.skippedDuplicate || 0} 份，已检查 ${summary.checkedMessages || 0} 封；已入队解析 ${summary.queued || 0} 份，当前已入库 ${summary.imported || 0} 份，简历库重复 ${summary.duplicateResumes || 0} 份，失败 ${summary.parseFailed || 0} 份；保存到 ${payload.folder || "boss-resumes"}`;
    if (elements.emailImportSummary) elements.emailImportSummary.textContent = text;
    elements.batchSummary.textContent = text;
    if (payload.job?.id) {
      clearBatchPoll();
      currentBatchJobId = payload.job.id;
      window.localStorage.setItem(BATCH_JOB_STORAGE_KEY, currentBatchJobId);
      applyBatchJob(payload.job);
      await pollBatchJob(currentBatchJobId);
    } else if ((summary.imported || 0) > 0 || (summary.duplicateResumes || 0) > 0) {
      await loadResumeList();
    }

    if (summary.saved > 0) {
      setStatus(`邮箱简历已保存，已入队解析 ${summary.queued || 0} 份`, "is-done");
    } else {
      setStatus("邮箱暂无新的简历附件", "is-done");
    }
  } catch (error) {
    console.error(error);
    if (elements.emailImportSummary) elements.emailImportSummary.textContent = error.message || "邮箱导入失败";
    elements.batchSummary.textContent = error.message || "邮箱导入失败";
    setStatus(error.message || "邮箱导入失败");
  } finally {
    if (elements.importEmailBtn) elements.importEmailBtn.disabled = false;
    refreshEmailAutoStatus().catch((error) => console.warn(error));
  }
}

function formatEmailAutoTime(value) {
  if (!value) return "暂未检测";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂未检测";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function renderEmailAutoStatus(status = emailAutoStatus) {
  emailAutoStatus = status || emailAutoStatus;
  if (!emailAutoStatus) return;

  const summary = emailAutoStatus.lastSummary || {};
  const enabledText = emailAutoStatus.enabled ? "已开启" : "已关闭";
  const runningText = emailAutoStatus.running ? "，正在检测" : "";
  const savedText = Number(summary.saved || 0);
  const duplicateText = Number(summary.skippedDuplicate || 0);
  const checkedText = Number(summary.checkedMessages || 0);
  const queuedText = Number(summary.queued || 0);
  const importedText = Number(summary.imported || 0);
  const resumeDuplicateText = Number(summary.duplicateResumes || 0);
  const failedText = Number(summary.parseFailed || 0);
  const lastText = formatEmailAutoTime(emailAutoStatus.lastFinishedAt || emailAutoStatus.lastStartedAt);
  const intervalSeconds = Math.round(Number(emailAutoStatus.intervalMs || 0) / 1000);
  const errorText = emailAutoStatus.lastError ? `；错误：${emailAutoStatus.lastError}` : "";

  if (elements.toggleEmailAutoBtn) {
    elements.toggleEmailAutoBtn.textContent = emailAutoStatus.enabled ? "关闭自动检测" : "开启自动检测";
    elements.toggleEmailAutoBtn.disabled = Boolean(emailAutoStatus.running);
  }
  if (elements.emailImportSummary) {
    elements.emailImportSummary.textContent =
      `邮箱自动检测${enabledText}${runningText}；每 ${intervalSeconds} 秒检查一次；上次 ${lastText}，新增 ${savedText} 份，附件重复 ${duplicateText} 份，入队解析 ${queuedText} 份，当前已入库 ${importedText} 份，简历库重复 ${resumeDuplicateText} 份，失败 ${failedText} 份，检查 ${checkedText} 封${errorText}`;
  }
}

async function refreshEmailAutoStatus() {
  const status = await requestJson("/api/email/resumes/auto-status");
  renderEmailAutoStatus(status);
  return status;
}

async function toggleEmailAutoImport() {
  const current = emailAutoStatus || (await refreshEmailAutoStatus().catch(() => null));
  const enabled = !(current && current.enabled);
  if (elements.toggleEmailAutoBtn) elements.toggleEmailAutoBtn.disabled = true;
  try {
    const status = await requestJson("/api/email/resumes/auto", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled, runNow: enabled }),
    });
    renderEmailAutoStatus(status);
    setStatus(enabled ? "邮箱自动检测已开启" : "邮箱自动检测已关闭", "is-done");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "更新邮箱自动检测失败");
  } finally {
    if (elements.toggleEmailAutoBtn) elements.toggleEmailAutoBtn.disabled = false;
  }
}

async function importBossResumeFolder() {
  if (isBatchRunning) {
    setStatus("批量任务运行中，请稍后再导入");
    return;
  }

  if (!bossFolderScan?.files?.length) {
    await scanBossResumeFolder();
    if (!bossFolderScan?.files?.length) return;
  }

  clearBatchPoll();
  batchPage = 1;
  setBatchPanelExpanded(true);
  setStatus("正在导入 BOSS 简历文件夹", "is-working");
  elements.batchSummary.textContent = "已确认导入，正在创建批量解析任务...";
  if (elements.scanBossFolderBtn) elements.scanBossFolderBtn.disabled = true;
  if (elements.importBossFolderBtn) elements.importBossFolderBtn.disabled = true;

  try {
    const payload = await requestJson("/api/import-folder/boss-resumes", {
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
      bossFolderScan = null;
      setStatus(payload.message || "没有新增 BOSS 简历", "is-done");
      elements.batchSummary.textContent = `${payload.message || "没有新增 BOSS 简历"}；已扫描 ${summary.scanned || 0} 个 PDF，已导入过 ${summary.skippedImported || 0} 个`;
      if (elements.bossFolderSummary) elements.bossFolderSummary.textContent = "没有新增 PDF，请放入新文件后重新扫描";
      return;
    }

    bossFolderScan = null;
    currentBatchJobId = payload.job.id;
    window.localStorage.setItem(BATCH_JOB_STORAGE_KEY, currentBatchJobId);
    applyBatchJob(payload.job);
    if (elements.bossFolderSummary) elements.bossFolderSummary.textContent = `已确认导入 ${summary.imported || 0} 份，正在批量解析`;
    setStatus(`已导入 ${summary.imported || 0} 份 BOSS 简历`, "is-done");
    await pollBatchJob(currentBatchJobId);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "导入 BOSS 简历失败");
    elements.batchSummary.textContent = error.message || "导入 BOSS 简历失败";
  } finally {
    if (elements.scanBossFolderBtn) elements.scanBossFolderBtn.disabled = false;
    if (elements.importBossFolderBtn) elements.importBossFolderBtn.disabled = true;
  }
}

