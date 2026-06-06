function resetFields() {
  showResumeInfoPanel();
  Object.values(RESUME_KEYS).forEach((node) => {
    node.textContent = "-";
  });
}

function renderResult(result) {
  RESUME_KEYS.name.textContent = result.name || "未识别";
  RESUME_KEYS.phone.textContent = result.phone || "未识别";
  RESUME_KEYS.gender.textContent = result.gender || "未识别";
  RESUME_KEYS.jobType.textContent = result.jobType ? normalizeJobType(result.jobType) : "未识别";
  RESUME_KEYS.school.textContent = result.school || "未识别";
  RESUME_KEYS.schoolLevel.textContent = result.schoolLevel || "未识别";
  RESUME_KEYS.graduation.textContent = result.graduation || "未识别";
  RESUME_KEYS.matchScore.textContent = hasMatchScore(result.matchScore) ? `${Number(result.matchScore)}%` : "-";
}

async function fetchJsonWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "AI 解读失败");
    }
    return payload;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

function toCount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function automationSourceLabel(source) {
  const labels = {
    boss_a: "BOSS 宋峰峰",
    boss_b: "BOSS 和新红",
    "51job": "51job",
    zhilian: "智联",
  };
  return labels[source] || source || "智联";
}

function makeAutomationStat(label, value) {
  const item = document.createElement("article");
  item.className = "automation-stat";
  const name = document.createElement("span");
  name.textContent = label;
  const count = document.createElement("strong");
  count.textContent = String(value ?? 0);
  item.append(name, count);
  return item;
}

function renderAutomationStats(payload = {}) {
  if (!elements.automationStatsGrid) return;
  const today = payload.todaySummary || {};
  const all = payload.allSummary || {};
  const requestedToday = toCount(today.requestedResume) + toCount(today.alreadyRequestedResume);
  const requestedAll = toCount(all.requestedResume) + toCount(all.alreadyRequestedResume);
  const askedToday = toCount(today.askedQuestions ?? today.sentBasic);
  const askedAll = toCount(all.askedQuestions ?? all.sentBasic);
  const source = payload.source || selectedAutomationSource;
  const label = payload.sourceLabel || automationSourceLabel(source);

  if (elements.automationTitle) {
    elements.automationTitle.textContent = `${label} 自动化统计`;
  }

  elements.automationStatsGrid.replaceChildren(
    makeAutomationStat("今日运行", today.runs ?? 0),
    makeAutomationStat("今日处理", today.processedRecords ?? today.processedPeople ?? 0),
    makeAutomationStat("唯一候选人", today.uniqueCandidates ?? 0),
    makeAutomationStat("询问问题", askedToday),
    makeAutomationStat("求简历", requestedToday),
    makeAutomationStat("获取简历", today.downloadedResume ?? 0),
    makeAutomationStat("已答疑", today.knowledgeAnswered ?? 0),
    makeAutomationStat("候选人提问", today.candidateQuestions ?? 0),
    makeAutomationStat("累计处理", all.processedRecords ?? all.processedPeople ?? 0),
    makeAutomationStat("累计询问", askedAll),
    makeAutomationStat("累计求简历", requestedAll),
    makeAutomationStat("累计获取", all.downloadedResume ?? 0)
  );

  if (elements.automationStatsMeta) {
    elements.automationStatsMeta.textContent = `${payload.accountName || payload.accountId || label} · ${
      payload.today || ""
    } · 数据来自自动化服务`;
  }
}

async function refreshAutomationStats() {
  if (!elements.automationStatsGrid) return;
  if (elements.refreshAutomationStatsBtn) elements.refreshAutomationStatsBtn.disabled = true;
  if (elements.automationStatsMeta) {
    elements.automationStatsMeta.textContent = `正在读取 ${automationSourceLabel(selectedAutomationSource)} 自动化统计...`;
  }
  try {
    const payload = await requestJson(
      `/api/recruiter-automation/summary?source=${encodeURIComponent(selectedAutomationSource)}`
    );
    renderAutomationStats(payload);
  } catch (error) {
    console.error(error);
    if (elements.automationStatsMeta) {
      elements.automationStatsMeta.textContent = error.message || "自动化统计读取失败";
    }
  } finally {
    if (elements.refreshAutomationStatsBtn) elements.refreshAutomationStatsBtn.disabled = false;
  }
}

function setAutomationSource(source) {
  selectedAutomationSource = source || "zhilian";
  elements.automationSourceButtons?.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.automationSource === selectedAutomationSource);
  });
  refreshAutomationStats();
}

async function parseResumePdfDirect(file) {
  const payload = await fetchJsonWithTimeout(
    "/api/parse-resume-pdf",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    },
    DIRECT_PARSE_TIMEOUT_MS
  );
  return payload.result;
}

async function parseDirect(file) {
  setStatus("GPT直读PDF中", "is-working");
  return parseResumePdfDirect(file);
}

async function createResumeRecord(file, result, parseMode) {
  const payload = await requestJson("/api/resumes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      resume: result,
      fileName: file.name,
      parseMode,
    }),
  });

  const record = payload.resume;
  if (payload.duplicate) {
    return {
      record,
      duplicate: true,
      rank: payload.rank,
    };
  }

  await requestJson(`/api/resumes/${record.id}/pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });

  return {
    record,
    duplicate: false,
    rank: payload.rank,
  };
}

function setCellText(row, text) {
  const cell = document.createElement("td");
  cell.textContent = text || "-";
  row.appendChild(cell);
}

function normalizePhoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("86")) {
    return digits.slice(2);
  }
  return digits;
}

function hasMatchScore(value) {
  if (value === "" || value === null || value === undefined) return false;
  return Number.isFinite(Number(value));
}

function getJdMatch(resumeOrId) {
  if (resumeOrId && typeof resumeOrId === "object" && resumeOrId.jdMatch) return resumeOrId.jdMatch;
  const id = typeof resumeOrId === "string" ? resumeOrId : resumeOrId?.id;
  return id ? jdMatchResults.get(id) || null : null;
}

function getJdMatchScore(resume) {
  const match = getJdMatch(resume);
  return match && Number.isFinite(Number(match.score)) ? Number(match.score) : -1;
}

function getJdLevelClass(level = "") {
  if (level.startsWith("A")) return "is-a";
  if (level.startsWith("B")) return "is-b";
  if (level.startsWith("C")) return "is-c";
  return "is-d";
}

function appendJdMatchCell(row, resume) {
  const cell = document.createElement("td");
  const jdMatch = getJdMatch(resume);
  if (!jdMatch) {
    cell.textContent = "-";
    row.appendChild(cell);
    return;
  }

  cell.className = "jd-match-cell";
  const badge = document.createElement("span");
  badge.className = `jd-level ${getJdLevelClass(jdMatch.level || "")}`;
  badge.textContent = `${jdMatch.score}% ${(jdMatch.level || "").slice(0, 1) || "-"}`;
  cell.appendChild(badge);

  const label = document.createElement("span");
  label.className = "jd-match-label";
  label.textContent = jdMatch.profileShortTitle || jdMatch.profileTitle || "JD";
  cell.appendChild(label);

  const keywords = (jdMatch.matchedKeywords || []).slice(0, 6).join("\u3001");
  cell.title = [jdMatch.profileTitle, jdMatch.level, keywords ? `\u547d\u4e2d\uff1a${keywords}` : "", jdMatch.suggestion]
    .filter(Boolean)
    .join("\n");
  row.appendChild(cell);
}

function getNumericScore(resume) {
  return hasMatchScore(resume.matchScore) ? Number(resume.matchScore) : -1;
}

function getScoreSortedResumes(resumes) {
  return [...resumes].sort((left, right) => {
    const scoreDiff = getNumericScore(right) - getNumericScore(left);
    if (scoreDiff !== 0) return scoreDiff;
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
}

function getTimeValue(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function getResumeDateSource(resume = {}) {
  return resume.createdAt || resume.savedAt || resume.receivedAt || resume.updatedAt || "";
}

function getResumeDateKey(resume = {}) {
  const date = new Date(getResumeDateSource(resume));
  if (Number.isNaN(date.getTime())) return "";
  return getChinaDateKey(date);
}

function getDisplaySortedResumes(resumes) {
  const sortMode = elements.recordSortSelect?.value || "score";
  if (sortMode === "created-desc") {
    return [...resumes].sort((left, right) => getTimeValue(getResumeDateSource(right)) - getTimeValue(getResumeDateSource(left)));
  }
  if (sortMode === "created-asc") {
    return [...resumes].sort((left, right) => getTimeValue(getResumeDateSource(left)) - getTimeValue(getResumeDateSource(right)));
  }
  return getScoreSortedResumes(resumes);
}

function formatShortDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function getGraduationCohort(resume = {}) {
  const text = [resume.graduation, resume.fileName, resume.rawText]
    .filter(Boolean)
    .join(" ");
  const fullYear = text.match(/20(26|27|28)\s*(?:届|年|毕业|应届)?/);
  if (fullYear) return fullYear[1];
  const shortYear = text.match(/(?:^|[^\d])(26|27|28)\s*(?:届|年|毕业|应届)/);
  return shortYear ? shortYear[1] : "";
}

function getResumeMajorDisplay(resume = {}) {
  return (
    resume.major ||
    resume.details?.major ||
    resume.education?.major ||
    resume.specialty ||
    resume.profession ||
    "未识别"
  );
}

function getResumeSourceDisplay(resume = {}) {
  const explicitSourceValues = [
    resume.sourceLabel,
    resume.sourceName,
    resume.sourcePlatform,
    resume.platform,
    resume.importSource,
    resume.source,
  ].map((value) => String(value || "").trim());
  const emailSourceKind = String(resume.emailSourceKind || resume.sourceKind || "").trim().toLowerCase();
  const hasDirectEmailSource =
    emailSourceKind === "direct" ||
    emailSourceKind === "direct-email" ||
    explicitSourceValues.some((value) => /^(邮箱|email)$/i.test(value));
  if (hasDirectEmailSource) return "邮箱";

  const platformLabel = (() => {
    const text = String(resume.sourcePlatform || resume.platform || resume.importSource || resume.source || resume.fileName || "").toLowerCase();
    if (/51job|job51|前程|51招聘|^51$/.test(text)) return "51";
    if (/zhilian|zhaopin|智联/.test(text)) return "智联";
    if (/boss|boss直聘|zhipin|kanzhun/.test(text)) return "BOSS";
    return String(resume.sourcePlatform || "").trim();
  })();
  const accountName = String(resume.accountName || resume.accountLabel || "").trim();
  const accountText = [
    resume.accountId,
    resume.accountName,
    resume.accountLabel,
    resume.sourceLabel,
    resume.sourceName,
    resume.source,
    resume.sourcePath,
    resume.pdfPath,
    resume.fileName,
  ]
    .filter(Boolean)
    .join(" ");
  const inferredAccountName = (() => {
    if (/boss_b|job51_b|zhilian_b|hexinhong|和新红/i.test(accountText)) return "和新红";
    if (/boss_a|job51_a|zhilian_a|songfengfeng|宋峰峰|宋锋峰/i.test(accountText)) return "宋峰峰";
    const emailUidMatch = accountText.match(/(?:邮箱|email|mail)[_\s-]*(\d{1,6})[_\s-]/i);
    if (emailUidMatch) return Number(emailUidMatch[1]) >= 1000 ? "和新红" : "宋峰峰";
    if (platformLabel === "51" || platformLabel === "智联") return "宋峰峰";
    if (platformLabel === "BOSS" && /boss|boss直聘|zhipin|kanzhun/i.test(accountText)) return "宋峰峰";
    return "";
  })();
  if (platformLabel && (accountName || inferredAccountName)) return `${platformLabel} ${accountName || inferredAccountName}`;
  const explicit = [
    resume.sourceLabel,
    resume.sourceName,
    resume.importSource,
    resume.source,
    resume.sourcePlatform,
    resume.platform,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  const text = [explicit, resume.fileName, resume.sourcePath, resume.pdfPath, resume.parseMode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/51job|job51|前程|51招聘/.test(text)) return "51";
  if (/zhilian|zhaopin|智联/.test(text)) return "智联";
  if (/boss_b|hexinhong|和新红/.test(text)) return "BOSS 和新红";
  if (/boss_a|songfengfeng|宋峰峰|宋锋峰/.test(text)) return "BOSS 宋峰峰";
  if (/boss|boss直聘/.test(text)) return "BOSS";
  if (/email|mail|邮箱/.test(text)) return "邮箱";
  return explicit || "未识别";
}

function getSelectedFilterValues(selectElement) {
  if (!selectElement) return [];
  if (selectElement.multiple) {
    return [...selectElement.selectedOptions]
      .map((option) => option.value)
      .filter(Boolean);
  }
  const value = selectElement.value || "";
  return value ? [value] : [];
}

function matchesSelectedValues(value, selectedValues = []) {
  return !selectedValues.length || selectedValues.includes(value || "");
}

function getResumeTableFieldByKey(key) {
  return RESUME_TABLE_FIELDS.find((field) => field.key === key) || null;
}

function normalizeResumeTableFieldKeys(keys) {
  const validKeys = new Set(DEFAULT_RESUME_TABLE_FIELD_KEYS);
  return Array.isArray(keys) ? keys.filter((key) => validKeys.has(key)) : [];
}

function loadResumeTableFieldPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(RESUME_TABLE_FIELD_STORAGE_KEY) || "null");
    const normalized = normalizeResumeTableFieldKeys(stored);
    visibleResumeTableFieldKeys = Array.isArray(stored) ? normalized : [...DEFAULT_RESUME_TABLE_FIELD_KEYS];
  } catch (error) {
    visibleResumeTableFieldKeys = [...DEFAULT_RESUME_TABLE_FIELD_KEYS];
  }
}

function saveResumeTableFieldPreferences() {
  try {
    localStorage.setItem(RESUME_TABLE_FIELD_STORAGE_KEY, JSON.stringify(visibleResumeTableFieldKeys));
  } catch (error) {
    // Storage may be unavailable in private contexts; the current view still updates.
  }
}

function syncResumeTableFieldSelect() {
  if (!elements.recordFieldDisplaySelect) return;
  const selectedKeys = new Set(visibleResumeTableFieldKeys);
  [...elements.recordFieldDisplaySelect.options].forEach((option) => {
    option.selected = selectedKeys.has(option.value);
  });
  syncCheckboxFilter(elements.recordFieldDisplaySelect);
}

function getVisibleResumeTableFields() {
  return visibleResumeTableFieldKeys
    .map(getResumeTableFieldByKey)
    .filter(Boolean);
}

function getResumeTableColumnCount() {
  return getVisibleResumeTableFields().length + 2;
}

function appendHeaderCell(row, text) {
  const cell = document.createElement("th");
  cell.textContent = text;
  row.appendChild(cell);
  return cell;
}

function renderResumeTableHeader() {
  if (!elements.resumeTableHeadRow) return;
  const fragment = document.createDocumentFragment();
  appendHeaderCell(fragment, "排名");
  getVisibleResumeTableFields().forEach((field) => appendHeaderCell(fragment, field.label));
  appendHeaderCell(fragment, "操作").className = "candidate-action-header";
  elements.resumeTableHeadRow.replaceChildren(fragment);

  if (elements.resumeTable) {
    const minWidth = Math.max(560, 300 + getVisibleResumeTableFields().length * 112);
    elements.resumeTable.style.minWidth = `${minWidth}px`;
  }
}

function appendResumeDecisionCell(row, resume) {
  const decisionCell = document.createElement("td");
  decisionCell.textContent = FEEDBACK_DECISION_LABELS[resume.feedback?.decision] || "待定";
  if (resume.parseQuality?.needsManualReview) {
    const badge = document.createElement("span");
    badge.className = "review-mini-badge";
    badge.textContent = "需复核";
    decisionCell.appendChild(badge);
  }
  row.appendChild(decisionCell);
}

function appendResumeFieldCell(row, field, resume) {
  if (typeof field.renderCell === "function") {
    field.renderCell(row, resume);
    return;
  }
  setCellText(row, typeof field.value === "function" ? field.value(resume) : "");
}

function closeCheckboxFilterMenus(exceptWidget = null) {
  document.querySelectorAll(".checkbox-filter.is-open").forEach((widget) => {
    if (widget === exceptWidget) return;
    widget.classList.remove("is-open");
    widget.querySelector(".checkbox-filter-trigger")?.setAttribute("aria-expanded", "false");
    const menu = widget.querySelector(".checkbox-filter-menu");
    if (menu) menu.hidden = true;
  });
}

function syncCheckboxFilter(selectElement) {
  const widget = selectElement.nextElementSibling?.classList?.contains("checkbox-filter")
    ? selectElement.nextElementSibling
    : null;
  if (!widget) return;

  const selectedValues = new Set(getSelectedFilterValues(selectElement));
  widget.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = checkbox.value ? selectedValues.has(checkbox.value) : selectedValues.size === 0;
  });

  const selectedLabels = [...selectElement.options]
    .filter((option) => option.value && selectedValues.has(option.value))
    .map((option) => option.textContent.trim());
  const summary = widget.querySelector("[data-checkbox-summary]");
  if (summary) {
    if (!selectedLabels.length) {
      summary.textContent = selectElement.dataset.placeholder || "全部";
    } else if (selectedLabels.length <= 2) {
      summary.textContent = selectedLabels.join("、");
    } else {
      summary.textContent = `${selectedLabels.slice(0, 2).join("、")} 等${selectedLabels.length}项`;
    }
  }

  widget.classList.toggle("has-value", selectedLabels.length > 0);
}

function setupCheckboxFilter(selectElement) {
  if (!selectElement?.multiple || !selectElement.hasAttribute("data-checkbox-filter")) return;
  if (selectElement.nextElementSibling?.classList?.contains("checkbox-filter")) {
    syncCheckboxFilter(selectElement);
    return;
  }
  selectElement.hidden = true;
  selectElement.tabIndex = -1;
  selectElement.classList.add("native-multi-filter");

  const widget = document.createElement("div");
  widget.className = "checkbox-filter";

  const trigger = document.createElement("button");
  trigger.className = "checkbox-filter-trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = `
    <span data-checkbox-summary>${selectElement.dataset.placeholder || "全部"}</span>
    <span class="checkbox-filter-arrow" aria-hidden="true">▾</span>
  `;

  const menu = document.createElement("div");
  menu.className = "checkbox-filter-menu";
  menu.hidden = true;

  const createOption = (option) => {
    const item = document.createElement("label");
    item.className = "checkbox-filter-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = option.value;

    const text = document.createElement("span");
    text.textContent = option.textContent.trim();

    item.append(checkbox, text);
    return item;
  };

  [...selectElement.options].forEach((option) => {
    menu.append(createOption(option));
  });

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const shouldOpen = menu.hidden;
    closeCheckboxFilterMenus(widget);
    menu.hidden = !shouldOpen;
    widget.classList.toggle("is-open", shouldOpen);
    trigger.setAttribute("aria-expanded", String(shouldOpen));
  });

  menu.addEventListener("click", (event) => event.stopPropagation());
  menu.addEventListener("change", (event) => {
    const checkbox = event.target?.closest?.("input[type='checkbox']");
    if (!checkbox) return;

    if (!checkbox.value) {
      [...selectElement.options].forEach((option) => {
        option.selected = false;
      });
    } else {
      const option = [...selectElement.options].find((item) => item.value === checkbox.value);
      if (option) option.selected = checkbox.checked;
      const allOption = [...selectElement.options].find((item) => !item.value);
      if (allOption) allOption.selected = false;
    }

    selectElement.dispatchEvent(new Event("change", { bubbles: true }));
    syncCheckboxFilter(selectElement);
  });

  selectElement.insertAdjacentElement("afterend", widget);
  widget.append(trigger, menu);
  selectElement.addEventListener("change", () => syncCheckboxFilter(selectElement));
  syncCheckboxFilter(selectElement);
}

function rebuildCheckboxFilter(selectElement) {
  const widget = selectElement?.nextElementSibling?.classList?.contains("checkbox-filter")
    ? selectElement.nextElementSibling
    : null;
  if (widget) widget.remove();
  if (selectElement) {
    selectElement.hidden = false;
    setupCheckboxFilter(selectElement);
  }
}

let checkboxFilterEventsReady = false;

function initializeRecordCheckboxFilters() {
  loadResumeTableFieldPreferences();
  syncResumeTableFieldSelect();

  [
    elements.schoolLevelFilter,
    elements.decisionFilter,
    elements.graduationYearFilter,
    elements.recordFieldDisplaySelect,
  ].forEach(setupCheckboxFilter);
  syncResumeTableFieldSelect();
  renderResumeTableHeader();

  if (checkboxFilterEventsReady) return;
  document.addEventListener("click", () => closeCheckboxFilterMenus());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCheckboxFilterMenus();
  });
  checkboxFilterEventsReady = true;
}

function initializeDailyPieControls() {
  [
    elements.dailyPiePlatformSelect,
    elements.dailyPieAccountSelect,
    elements.dailyPieJobSelect,
  ].forEach(setupCheckboxFilter);
  elements.dailyPiePlatformSelect?.addEventListener("change", () => refreshDailyPieChart({ force: true }));
  elements.dailyPieAccountSelect?.addEventListener("change", () => refreshDailyPieChart({ force: true }));
  elements.dailyPieJobSelect?.addEventListener("change", () => renderDailyPieChart(dailyPieRecords));
  elements.dailyPieRefreshBtn?.addEventListener("click", () => refreshDailyPieChart({ force: true }));
}

initializeRecordCheckboxFilters();
initializeDailyPieControls();

function syncResumeCalendarControl() {
  const dateState = datesToDateState(activeResumeDates);
  setDateInputValue(elements.resumeCalendarInput, dateState);
  renderDateChips(elements.resumeCalendarSelectedDates, dateState, (date) => {
    activeResumeDates = activeResumeDates.filter((item) => item !== date);
    recordsPage = 1;
    syncResumeCalendarControl();
    refreshResumeView();
  });
}

function getDateScopedResumes(resumes = []) {
  const selectedResumeDates = new Set(activeResumeDates);
  if (!selectedResumeDates.size) return Array.isArray(resumes) ? resumes : [];
  return (Array.isArray(resumes) ? resumes : []).filter((resume) => selectedResumeDates.has(getResumeDateKey(resume)));
}

function getFilteredResumes(resumes) {
  const activeJobType = getActiveJobType();
  const keyword = elements.recordSearchInput?.value.trim().toLowerCase() || "";
  const schoolLevels = getSelectedFilterValues(elements.schoolLevelFilter);
  const decisions = getSelectedFilterValues(elements.decisionFilter);
  const graduationYears = getSelectedFilterValues(elements.graduationYearFilter);
  const minScore = elements.minScoreFilter?.value === "" ? null : Number(elements.minScoreFilter?.value);
  const maxScore = elements.maxScoreFilter?.value === "" ? null : Number(elements.maxScoreFilter?.value);
  const onlyManualReview = Boolean(elements.manualReviewFilter?.checked);

  return getDateScopedResumes(resumes).filter((resume) => {
    if (activeJobType && normalizeJobType(resume.jobType) !== activeJobType) return false;

    if (keyword) {
      const haystack = [resume.name, resume.gender, resume.phone, getResumeMajorDisplay(resume), getResumeSourceDisplay(resume), resume.school, resume.fileName]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    if (!matchesSelectedValues(resume.schoolLevel, schoolLevels)) return false;
    if (!matchesSelectedValues(resume.feedback?.decision || "pending", decisions)) return false;
    if (!matchesSelectedValues(getGraduationCohort(resume), graduationYears)) return false;

    if (minScore !== null || maxScore !== null) {
      const score = hasMatchScore(resume.matchScore) ? Number(resume.matchScore) : null;
      if (score === null) return false;
      if (minScore !== null && Number.isFinite(minScore) && score < minScore) return false;
      if (maxScore !== null && Number.isFinite(maxScore) && score > maxScore) return false;
    }

    if (onlyManualReview && !resume.parseQuality?.needsManualReview) return false;
    return true;
  });
}

function getResumeNavigationList() {
  return getDisplaySortedResumes(getFilteredResumes(resumeCache));
}

function getResumeNavigationState(id = activeDetailResume?.id || elements.editId?.value || "") {
  const list = getResumeNavigationList();
  const index = list.findIndex((resume) => resume.id === id);
  return { list, index };
}

function syncResumeDetailNavControls() {
  if (!elements.detailPrevResumeBtn || !elements.detailNextResumeBtn || !elements.detailResumePosition) return;
  const activeId = activeDetailResume?.id || elements.editId?.value || "";
  const { list, index } = getResumeNavigationState(activeId);
  const hasActive = index >= 0;
  const total = list.length;
  elements.detailResumePosition.textContent = hasActive ? `${index + 1} / ${total}` : total ? "当前筛选外" : "- / -";
  elements.detailPrevResumeBtn.disabled = resumeDetailNavBusy || !hasActive || index <= 0;
  elements.detailNextResumeBtn.disabled = resumeDetailNavBusy || !hasActive || index >= total - 1;
  const previous = hasActive ? list[index - 1] : null;
  const next = hasActive ? list[index + 1] : null;
  elements.detailPrevResumeBtn.title = previous ? `上一个候选人（←）：${previous.name || previous.phone || previous.fileName || ""}` : "没有上一个候选人";
  elements.detailNextResumeBtn.title = next ? `下一个候选人（→）：${next.name || next.phone || next.fileName || ""}` : "没有下一个候选人";
}

function scrollResumePreviewIntoView(options = {}) {
  const behavior = options.behavior || "smooth";
  const target = document.querySelector(".pdf-preview") || elements.pdfPages || elements.editPanel;
  if (!target) return;
  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior, block: "start" });
  });
}

function syncRecordsPageToResume(id) {
  if (!id) return;
  const { list, index } = getResumeNavigationState(id);
  if (index < 0) {
    syncResumeDetailNavControls();
    return;
  }
  const nextPage = Math.floor(index / RECORDS_PAGE_SIZE) + 1;
  if (nextPage !== recordsPage) {
    recordsPage = nextPage;
    renderResumeTable(getFilteredResumes(resumeCache));
  } else {
    renderResumeTable(getFilteredResumes(resumeCache));
  }
  syncResumeDetailNavControls();
}

async function navigateResumeDetail(direction) {
  if (resumeDetailNavBusy || elements.editPanel?.hidden || !activeDetailResume?.id) return;
  const { list, index } = getResumeNavigationState(activeDetailResume.id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= list.length) {
    syncResumeDetailNavControls();
    return;
  }
  resumeDetailNavBusy = true;
  syncResumeDetailNavControls();
  try {
    await openResumeEditor(list[nextIndex].id, { scrollTarget: "pdf", scrollBehavior: "auto" });
  } finally {
    resumeDetailNavBusy = false;
    syncResumeDetailNavControls();
  }
}

function isResumeNavigationInputTarget(target) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}

function refreshResumeView() {
  syncResumeCalendarControl();
  const dateScopedResumes = getDateScopedResumes(resumeCache);
  renderJobNav(dateScopedResumes);
  renderResumeTable(getFilteredResumes(resumeCache));
  syncResumeDetailNavControls();
  syncBatchRanks(resumeCache);
}

