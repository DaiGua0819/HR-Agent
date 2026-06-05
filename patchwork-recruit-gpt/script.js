const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
const DIRECT_PARSE_TIMEOUT_MS = 600000;

const RESUME_KEYS = {
  name: document.querySelector("#nameValue"),
  phone: document.querySelector("#phoneValue"),
  gender: document.querySelector("#genderValue"),
  jobType: document.querySelector("#jobTypeValue"),
  school: document.querySelector("#schoolValue"),
  schoolLevel: document.querySelector("#schoolLevelValue"),
  graduation: document.querySelector("#graduationValue"),
  matchScore: document.querySelector("#matchScoreValue"),
};


const {
  RESUME_LIBRARY_JOB_TYPES,
  RESUME_JOB_DISPLAY_LABELS,
  LEGACY_JOB_TYPES,
  JOB_TYPES,
  AI_INTERNSHIP_JOB_TYPE,
  JD_PROFILE_PRIORITY_BY_JOB_TYPE,
  FEEDBACK_DECISION_LABELS,
  BATCH_STATUS_LABELS,
  RULE_STATUS_LABELS,
  DEFAULT_FEEDBACK_TAG_OPTIONS,
  BATCH_PAGE_SIZE,
  RECORDS_PAGE_SIZE,
  BATCH_JOB_STORAGE_KEY,
  BOSS_AUTOMATION_BASE_SPEED_MULTIPLIER,
  BOSS_AUTOMATION_SPEED_STORAGE_KEY,
  BOSS_AUTOMATION_ACCOUNT_STORAGE_KEY,
  BOSS_PROACTIVE_RULE_STORAGE_KEY,
  BOSS_PROACTIVE_RULE_PRESET_VERSION,
  BOSS_AUTOMATION_SPEED_VALUES,
  BOSS_PROACTIVE_POSITION_OPTIONS,
  BOSS_PROACTIVE_DEFAULT_RULES_BY_POSITION,
  BOSS_SUMMARY_METRICS_BY_MODE,
  BOSS_PROCESS_ALL_POSITIONS_MESSAGE,
} = window.ResumeAgentFrontendConfig || {};

function getResumeJobDisplayLabel(jobType) {
  return RESUME_JOB_DISPLAY_LABELS[jobType] || jobType || "";
}


const RESUME_TABLE_FIELD_STORAGE_KEY = "resumeAgent.resumeTableVisibleFields.v2";
const RESUME_TABLE_FIELDS = [
  { key: "name", label: "姓名", value: (resume) => resume.name },
  { key: "gender", label: "性别", value: (resume) => resume.gender },
  { key: "phone", label: "电话", value: (resume) => resume.phone },
  { key: "major", label: "专业", value: (resume) => getResumeMajorDisplay(resume) },
  { key: "school", label: "学校", value: (resume) => resume.school },
  { key: "schoolLevel", label: "学校层次", value: (resume) => resume.schoolLevel },
  { key: "graduation", label: "毕业时间", value: (resume) => resume.graduation },
  {
    key: "matchScore",
    label: "匹配度",
    value: (resume) => (hasMatchScore(resume.matchScore) ? `${Number(resume.matchScore)}%` : "-"),
  },
  { key: "source", label: "来源", value: (resume) => getResumeSourceDisplay(resume) },
  { key: "createdAt", label: "入库时间", value: (resume) => formatShortDate(getResumeDateSource(resume)) },
  { key: "decision", label: "筛选结论", renderCell: appendResumeDecisionCell },
];
const DEFAULT_RESUME_TABLE_FIELD_KEYS = RESUME_TABLE_FIELDS.map((field) => field.key);


const elements = {
  input: document.querySelector("#resumeInput"),
  pickFileBtn: document.querySelector("#pickFileBtn"),
  automationTitle: document.querySelector("#automationTitle"),
  automationStatsGrid: document.querySelector("#automationStatsGrid"),
  automationStatsMeta: document.querySelector("#automationStatsMeta"),
  refreshAutomationStatsBtn: document.querySelector("#refreshAutomationStatsBtn"),
  automationSourceButtons: [...document.querySelectorAll("[data-automation-source]")],
  scanBossFolderBtn: document.querySelector("#scanBossFolderBtn"),
  importBossFolderBtn: document.querySelector("#importBossFolderBtn"),
  bossFolderSummary: document.querySelector("#bossFolderSummary"),
  scanZhilianFolderBtn: document.querySelector("#scanZhilianFolderBtn"),
  importZhilianFolderBtn: document.querySelector("#importZhilianFolderBtn"),
  zhilianFolderSummary: document.querySelector("#zhilianFolderSummary"),
  importEmailBtn: document.querySelector("#importEmailBtn"),
  toggleEmailAutoBtn: document.querySelector("#toggleEmailAutoBtn"),
  emailImportSummary: document.querySelector("#emailImportSummary"),
  bossAutomationBtn: document.querySelector("#bossAutomationBtn"),
  job51QuickAutomationBtn: document.querySelector("#job51QuickAutomationBtn"),
  zhilianQuickAutomationBtn: document.querySelector("#zhilianQuickAutomationBtn"),
  oneClickLaunchBrowserBtn: document.querySelector("#oneClickLaunchBrowserBtn"),
  bossBrowserSummary: document.querySelector("#bossBrowserSummary"),
  clearBtn: document.querySelector("#clearBtn"),
  dropZone: document.querySelector("#dropZone"),
  fileCard: document.querySelector("#fileCard"),
  fileName: document.querySelector("#fileName"),
  batchPanel: document.querySelector("#batchPanel"),
  batchToggleBtn: document.querySelector("#batchToggleBtn"),
  batchContent: document.querySelector("#batchContent"),
  batchSummary: document.querySelector("#batchSummary"),
  batchTableBody: document.querySelector("#batchTableBody"),
  batchPrevBtn: document.querySelector("#batchPrevBtn"),
  batchNextBtn: document.querySelector("#batchNextBtn"),
  batchPageInfo: document.querySelector("#batchPageInfo"),
  pauseBatchBtn: document.querySelector("#pauseBatchBtn"),
  resumeBatchBtn: document.querySelector("#resumeBatchBtn"),
  cancelBatchBtn: document.querySelector("#cancelBatchBtn"),
  retryFailedBtn: document.querySelector("#retryFailedBtn"),
  rulePanel: document.querySelector("#rulePanel"),
  ruleToggleBtn: document.querySelector("#ruleToggleBtn"),
  ruleContent: document.querySelector("#ruleContent"),
  ruleSummary: document.querySelector("#ruleSummary"),
  scoringRulesBtn: document.querySelector("#scoringRulesBtn"),
  scoringRulesBox: document.querySelector("#scoringRulesBox"),
  scoringRulesTitle: document.querySelector("#scoringRulesTitle"),
  scoringRulesVersion: document.querySelector("#scoringRulesVersion"),
  scoringRulesGrid: document.querySelector("#scoringRulesGrid"),
  adoptedRulesList: document.querySelector("#adoptedRulesList"),
  ruleTableBody: document.querySelector("#ruleTableBody"),
  statusPill: document.querySelector("#statusPill"),
  resumeInfoPanel: document.querySelector("#resumeInfoPanel"),
  bossActionPanel: document.querySelector("#bossActionPanel"),
  automationPlatformSwitcher: document.querySelector("#automationPlatformSwitcher"),
  processBossMessagesBtn: document.querySelector("#processBossMessagesBtn"),
  bossAutomationSpeedSelect: document.querySelector("#bossAutomationSpeedSelect"),
  bossAutomationSpeedControl: document.querySelector("#bossAutomationSpeedControl"),
  processMessagesControlPanel: document.querySelector("#processMessagesControlPanel"),
  startProcessMessagesBtn: document.querySelector("#startProcessMessagesBtn"),
  processMessagesStatus: document.querySelector("#processMessagesStatus"),
  proactiveBossContactBtn: document.querySelector("#proactiveBossContactBtn"),
  proactiveContactControlPanel: document.querySelector("#proactiveContactControlPanel"),
  proactiveContactPositionSelect: document.querySelector("#proactiveContactPositionSelect"),
  proactiveContactCountInput: document.querySelector("#proactiveContactCountInput"),
  proactiveRuleMode: document.querySelector("#proactiveRuleMode"),
  proactiveCustomRules: document.querySelector("#proactiveCustomRules"),
  proactiveRequireEducationCheck: document.querySelector("#proactiveRequireEducationCheck"),
  proactiveRequireAgeCheck: document.querySelector("#proactiveRequireAgeCheck"),
  proactiveRequireKeywordCheck: document.querySelector("#proactiveRequireKeywordCheck"),
  proactiveMinEducationSelect: document.querySelector("#proactiveMinEducationSelect"),
  proactiveMaxAgeInput: document.querySelector("#proactiveMaxAgeInput"),
  proactiveKeywordModeSelect: document.querySelector("#proactiveKeywordModeSelect"),
  proactiveUnknownPolicySelect: document.querySelector("#proactiveUnknownPolicySelect"),
  proactiveKeywordInput: document.querySelector("#proactiveKeywordInput"),
  startProactiveContactBtn: document.querySelector("#startProactiveContactBtn"),
  proactiveContactStatus: document.querySelector("#proactiveContactStatus"),
  bossActionHint: document.querySelector("#bossActionHint"),
  bossAutomationSummaryPanel: document.querySelector("#bossAutomationSummaryPanel"),
  bossAccountSwitcher: document.querySelector("#bossAccountSwitcher"),
  bossAutomationSummaryTitle: document.querySelector("#bossAutomationSummaryTitle"),
  bossAutomationDateInput: document.querySelector("#bossAutomationDateInput"),
  bossAutomationSelectedDates: document.querySelector("#bossAutomationSelectedDates"),
  bossAutomationTodayBtn: document.querySelector("#bossAutomationTodayBtn"),
  bossAutomationAllDatesBtn: document.querySelector("#bossAutomationAllDatesBtn"),
  bossAutomationStatsGrid: document.querySelector("#bossAutomationStatsGrid"),
  bossAutomationPositionBreakdown: document.querySelector("#bossAutomationPositionBreakdown"),
  bossAutomationUpdatedAt: document.querySelector("#bossAutomationUpdatedAt"),
  job51ProcessMessagesBtn: document.querySelector("#job51ProcessMessagesBtn"),
  job51ProactiveContactBtn: document.querySelector("#job51ProactiveContactBtn"),
  job51MaxTotalInput: document.querySelector("#job51MaxTotalInput"),
  job51ProactivePositionSelect: document.querySelector("#job51ProactivePositionSelect"),
  job51AutomationStatus: document.querySelector("#job51AutomationStatus"),
  zhilianProcessMessagesBtn: document.querySelector("#zhilianProcessMessagesBtn"),
  zhilianProactiveContactBtn: document.querySelector("#zhilianProactiveContactBtn"),
  zhilianMaxTotalInput: document.querySelector("#zhilianMaxTotalInput"),
  zhilianProactivePositionSelect: document.querySelector("#zhilianProactivePositionSelect"),
  zhilianAutomationStatus: document.querySelector("#zhilianAutomationStatus"),
  jobNav: document.querySelector("#jobNav"),
  recordsTitle: document.querySelector("#recordsTitle"),
  resumeTable: document.querySelector("#resumeTable"),
  resumeTableHeadRow: document.querySelector("#resumeTableHeadRow"),
  tableBody: document.querySelector("#resumeTableBody"),
  recordsPageSummary: document.querySelector("#recordsPageSummary"),
  recordsPrevBtn: document.querySelector("#recordsPrevBtn"),
  recordsNextBtn: document.querySelector("#recordsNextBtn"),
  feishuStatus: document.querySelector("#feishuStatus"),
  testFeishuBtn: document.querySelector("#testFeishuBtn"),
  recordSearchInput: document.querySelector("#recordSearchInput"),
  schoolLevelFilter: document.querySelector("#schoolLevelFilter"),
  decisionFilter: document.querySelector("#decisionFilter"),
  graduationYearFilter: document.querySelector("#graduationYearFilter"),
  recordSortSelect: document.querySelector("#recordSortSelect"),
  recordFieldDisplaySelect: document.querySelector("#recordFieldDisplaySelect"),
  minScoreFilter: document.querySelector("#minScoreFilter"),
  maxScoreFilter: document.querySelector("#maxScoreFilter"),
  manualReviewFilter: document.querySelector("#manualReviewFilter"),
  resumeCalendarInput: document.querySelector("#resumeCalendarInput"),
  resumeCalendarSelectedDates: document.querySelector("#resumeCalendarSelectedDates"),
  resumeCalendarTodayBtn: document.querySelector("#resumeCalendarTodayBtn"),
  resumeCalendarAllBtn: document.querySelector("#resumeCalendarAllBtn"),
  jdMatchSection: document.querySelector("#jdMatchSection"),
  jdMatchToggleBtn: document.querySelector("#jdMatchToggleBtn"),
  jdMatchContent: document.querySelector("#jdMatchContent"),
  jdProfileControl: document.querySelector("#jdProfileControl"),
  jdProfileSelect: document.querySelector("#jdProfileSelect"),
  runJdMatchBtn: document.querySelector("#runJdMatchBtn"),
  jdMatchSummary: document.querySelector("#jdMatchSummary"),
  jdSourceBox: document.querySelector("#jdSourceBox"),
  jdTagEditor: document.querySelector("#jdTagEditor"),
  jdTagGroupSelect: document.querySelector("#jdTagGroupSelect"),
  jdTagInput: document.querySelector("#jdTagInput"),
  addJdTagBtn: document.querySelector("#addJdTagBtn"),
  jdTagEditorStatus: document.querySelector("#jdTagEditorStatus"),
  jdResultsBody: document.querySelector("#jdResultsBody"),
  jdRulesTitle: document.querySelector("#jdRulesTitle"),
  jdRulesVersion: document.querySelector("#jdRulesVersion"),
  jdRulesGrid: document.querySelector("#jdRulesGrid"),
  editPanel: document.querySelector("#editPanel"),
  editForm: document.querySelector("#editForm"),
  feedbackForm: document.querySelector("#feedbackForm"),
  editId: document.querySelector("#editId"),
  editName: document.querySelector("#editName"),
  editPhone: document.querySelector("#editPhone"),
  editGender: document.querySelector("#editGender"),
  editJobType: document.querySelector("#editJobType"),
  editMajor: document.querySelector("#editMajor"),
  editSchool: document.querySelector("#editSchool"),
  editSchoolLevel: document.querySelector("#editSchoolLevel"),
  editGraduation: document.querySelector("#editGraduation"),
  editMatchScore: document.querySelector("#editMatchScore"),
  reEvaluateBtn: document.querySelector("#reEvaluateBtn"),
  closeEditBtn: document.querySelector("#closeEditBtn"),
  detailPrevResumeBtn: document.querySelector("#detailPrevResumeBtn"),
  detailNextResumeBtn: document.querySelector("#detailNextResumeBtn"),
  detailResumePosition: document.querySelector("#detailResumePosition"),
  pdfPages: document.querySelector("#pdfPages"),
  pdfPreviewTitle: document.querySelector("#pdfPreviewTitle"),
  detailScoringVersion: document.querySelector("#detailScoringVersion"),
  detailScoringVersionName: document.querySelector("#detailScoringVersionName"),
  detailVersionRulesBtn: document.querySelector("#detailVersionRulesBtn"),
  detailConfidence: document.querySelector("#detailConfidence"),
  detailScoreSummary: document.querySelector("#detailScoreSummary"),
  detailScoreRisks: document.querySelector("#detailScoreRisks"),
  detailParseWarnings: document.querySelector("#detailParseWarnings"),
  feedbackDecision: document.querySelector("#feedbackDecision"),
  positiveTagsGroup: document.querySelector("#positiveTagsGroup"),
  negativeTagsGroup: document.querySelector("#negativeTagsGroup"),
  dimensionsGroup: document.querySelector("#dimensionsGroup"),
  feedbackReason: document.querySelector("#feedbackReason"),
  feedbackAffectsScoring: document.querySelector("#feedbackAffectsScoring"),
  feedbackReview: document.querySelector("#feedbackReview"),
};

let batchQueue = [];
let isBatchRunning = false;
let currentBatchJobId = "";
let currentBatchStatus = "";
let batchPollTimer = 0;
let batchPage = 1;
let recordsPage = 1;
let resumeCache = [];
let visibleResumeTableFieldKeys = [...DEFAULT_RESUME_TABLE_FIELD_KEYS];
let activeResumeDates = [];
let bossFolderScan = null;
let zhilianFolderScan = null;
let emailAutoStatus = null;
let emailAutoStatusTimer = 0;
let activeDetailResume = null;
let resumeDetailNavBusy = false;
const resumeConversationRequests = new Map();
let jdMatchResults = new Map();
let jdProfiles = [];
let activeJdProfile = null;
let selectedAutomationSource = "zhilian";
const processMessagesStates = new Map();
const proactiveContactStates = new Map();
const platformAutomationTaskStates = new Map();
let bossAutomationSummaryDate = getChinaDateKey();
let bossAutomationSummaryMode = "process";
let bossAutomationAccountId = readStoredBossAutomationAccountId();
let bossAutomationLastSummaryPayload = null;
let bossAutomationSpeedFactor = normalizeBossAutomationSpeed(readStoredBossAutomationSpeed());
let activeAutomationPlatform = "boss";
const AUTOMATION_SUMMARY_CACHE_TTL_MS = 15000;
const automationSummaryCache = new Map();
let automationSummaryAbortController = null;
let automationSummaryRequestSeq = 0;
const collapsibleTimers = new WeakMap();

const AUTOMATION_PLATFORM_LABELS = {
  boss: "BOSS",
  job51: "51",
  zhilian: "智联",
};

function normalizeBossAutomationAccountId(value) {
  const text = String(value || "").trim();
  return ["all", "boss_a", "boss_b"].includes(text) ? text : "all";
}

function readStoredBossAutomationAccountId() {
  try {
    return normalizeBossAutomationAccountId(localStorage.getItem(BOSS_AUTOMATION_ACCOUNT_STORAGE_KEY) || "all");
  } catch {
    return "all";
  }
}

function saveBossAutomationAccountId(value) {
  try {
    localStorage.setItem(BOSS_AUTOMATION_ACCOUNT_STORAGE_KEY, normalizeBossAutomationAccountId(value));
  } catch {
    // Ignore storage failures; current page state still has the selected account.
  }
}

function getCurrentBossAutomationAccountId() {
  bossAutomationAccountId = normalizeBossAutomationAccountId(bossAutomationAccountId);
  syncBossAutomationAccountSwitcher();
  return bossAutomationAccountId;
}

function bossAutomationAccountLabel(accountId = bossAutomationAccountId) {
  return accountId === "boss_a" ? "宋峰峰" : accountId === "boss_b" ? "和新红" : "全部账号";
}

function createBossAutomationTaskState() {
  return {
    running: false,
    paused: false,
    dotsTimer: 0,
    summaryTimer: 0,
    dotCount: 0,
    runId: 0,
    lastToggleAt: 0,
  };
}

function getProcessMessagesState(accountId = bossAutomationAccountId) {
  const normalized = normalizeBossAutomationAccountId(accountId);
  if (!processMessagesStates.has(normalized)) {
    processMessagesStates.set(normalized, createBossAutomationTaskState());
  }
  return processMessagesStates.get(normalized);
}

function getProactiveContactState(accountId = bossAutomationAccountId) {
  const normalized = normalizeBossAutomationAccountId(accountId);
  if (!proactiveContactStates.has(normalized)) {
    proactiveContactStates.set(normalized, createBossAutomationTaskState());
  }
  return proactiveContactStates.get(normalized);
}

function platformAutomationTaskKey(platform = activeAutomationPlatform, mode = bossAutomationSummaryMode, accountId = bossAutomationAccountId) {
  return [normalizeAutomationPlatform(platform), mode === "proactive" ? "proactive" : "process", normalizeBossAutomationAccountId(accountId)].join("|");
}

function getPlatformAutomationTaskState(platform = activeAutomationPlatform, mode = bossAutomationSummaryMode, accountId = bossAutomationAccountId) {
  const key = platformAutomationTaskKey(platform, mode, accountId);
  if (!platformAutomationTaskStates.has(key)) {
    platformAutomationTaskStates.set(key, createBossAutomationTaskState());
  }
  return platformAutomationTaskStates.get(key);
}

function isCurrentPlatformAutomationTask(platform, mode, accountId) {
  return (
    normalizeAutomationPlatform(platform) === activeAutomationPlatform &&
    (mode === "proactive" ? "proactive" : "process") === bossAutomationSummaryMode &&
    normalizeBossAutomationAccountId(accountId) === normalizeBossAutomationAccountId(bossAutomationAccountId)
  );
}

function isCurrentBossAutomationAccount(accountId) {
  return normalizeBossAutomationAccountId(accountId) === bossAutomationAccountId;
}

function syncBossAutomationAccountSwitcher() {
  elements.bossAccountSwitcher?.querySelectorAll("[data-account-id]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.accountId === bossAutomationAccountId);
  });
}

function setBossAutomationAccount(accountId) {
  bossAutomationAccountId = normalizeBossAutomationAccountId(accountId);
  saveBossAutomationAccountId(bossAutomationAccountId);
  syncBossAutomationAccountSwitcher();
  showAutomationActions(`已切换到 ${automationPlatformLabel()} · ${bossAutomationAccountLabel()} 视图`);
  const processState = getProcessMessagesState();
  setProcessMessagesStatus(processState.running && !processState.paused ? "处理中。" : processState.paused ? "已暂停" : "等待开始");
  updateProcessMessagesButton();
  const proactiveState = getProactiveContactState();
  setProactiveContactStatus(proactiveState.running && !proactiveState.paused ? "处理中。" : proactiveState.paused ? "已暂停" : "请选择岗位后开始");
  updateProactiveContactButton();
  refreshBossAutomationSummary();
}

function normalizeBossAutomationSpeed(value) {
  const raw = Number(value);
  return BOSS_AUTOMATION_SPEED_VALUES.includes(raw) ? raw : 1.75;
}

function readStoredBossAutomationSpeed() {
  try {
    return localStorage.getItem(BOSS_AUTOMATION_SPEED_STORAGE_KEY);
  } catch {
    return "";
  }
}

function saveBossAutomationSpeed(value) {
  try {
    localStorage.setItem(BOSS_AUTOMATION_SPEED_STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures; the current page state still carries the selected speed.
  }
}

function syncBossAutomationSpeedSelect() {
  if (!elements.bossAutomationSpeedSelect) return;
  elements.bossAutomationSpeedSelect.value = String(bossAutomationSpeedFactor);
}

function setBossAutomationSpeed(value) {
  bossAutomationSpeedFactor = normalizeBossAutomationSpeed(value);
  saveBossAutomationSpeed(bossAutomationSpeedFactor);
  syncBossAutomationSpeedSelect();
  showBossAutomationActions(`操作倍速已切换为 ${bossAutomationSpeedFactor === 1 ? "原速度" : `${bossAutomationSpeedFactor} 倍速`}`);
}

function animateCollapsibleContent(panel, toggle, content, expanded) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  toggle.setAttribute("aria-expanded", String(expanded));
  content.setAttribute("aria-hidden", String(!expanded));
  window.clearTimeout(collapsibleTimers.get(content));

  if (reduceMotion) {
    panel.classList.toggle("is-collapsed", !expanded);
    content.style.height = expanded ? "auto" : "0px";
    content.classList.toggle("is-expanded", expanded);
    return;
  }

  content.classList.add("is-animating");

  if (expanded) {
    panel.classList.remove("is-collapsed");
    content.classList.add("is-expanded");
    content.style.height = "auto";
    const targetHeight = content.getBoundingClientRect().height;
    content.style.height = "0px";
    content.getBoundingClientRect();
    window.requestAnimationFrame(() => {
      content.style.height = `${targetHeight}px`;
    });
  } else {
    const startHeight = content.getBoundingClientRect().height;
    content.style.height = `${startHeight}px`;
    content.getBoundingClientRect();
    window.requestAnimationFrame(() => {
      content.classList.remove("is-expanded");
      content.style.height = "0px";
    });
  }

  const timer = window.setTimeout(() => {
    content.classList.remove("is-animating");
    if (expanded) {
      content.style.height = "auto";
    } else {
      panel.classList.add("is-collapsed");
      content.style.height = "0px";
    }
  }, 260);
  collapsibleTimers.set(content, timer);
}

function setRulePanelExpanded(expanded) {
  if (!elements.rulePanel || !elements.ruleToggleBtn || !elements.ruleContent) return;
  animateCollapsibleContent(elements.rulePanel, elements.ruleToggleBtn, elements.ruleContent, expanded);
}

function setBatchPanelExpanded(expanded) {
  if (!elements.batchPanel || !elements.batchToggleBtn || !elements.batchContent) return;
  animateCollapsibleContent(elements.batchPanel, elements.batchToggleBtn, elements.batchContent, expanded);
}

function setJdMatchExpanded(expanded) {
  if (!elements.jdMatchSection || !elements.jdMatchToggleBtn || !elements.jdMatchContent) return;
  animateCollapsibleContent(elements.jdMatchSection, elements.jdMatchToggleBtn, elements.jdMatchContent, expanded);
}

function updateJdMatchVisibility() {
  if (!elements.jdMatchSection) return;
  const shouldHide = getActiveJobType() === AI_INTERNSHIP_JOB_TYPE;
  elements.jdMatchSection.hidden = shouldHide;
  if (shouldHide) {
    setJdMatchExpanded(false);
  }
}
function setStatus(text, state = "") {
  elements.statusPill.textContent = text;
  elements.statusPill.className = `status-pill ${state}`.trim();
}

function getActiveJobType() {
  const jobType = new URLSearchParams(window.location.search).get("job");
  if (!jobType) return "";
  const normalized = normalizeJobType(jobType);
  return normalized === AI_INTERNSHIP_JOB_TYPE && !/AI|智能体|大模型/i.test(jobType) ? "" : normalized;
}

function normalizeJobType(jobType) {
  const value = String(jobType || "").trim();
  if (RESUME_LIBRARY_JOB_TYPES.includes(value)) return value;
  if (/AI应用开发实习生|AI实习生|AI应用开发工程师|AI开发工程师|人工智能实习|智能体实习|Agent实习|智能体开发工程师/i.test(value)) {
    return AI_INTERNSHIP_JOB_TYPE;
  }
  if (/应用技术经理|应用技术管培|应用技术|技术服务|技术支持|工业涂料|涂料领域|涂料应用|涂料研发|材料应用|流变助剂/.test(value)) {
    return "应用技术经理（工业涂料领域）";
  }
  if (/石油钻井|钻井泥浆|石油.*膨润土|石油助剂|油田|油服|销售工程师（石油钻井泥浆膨润土）/i.test(value)) {
    return "销售工程师（石油钻井泥浆膨润土）_湖州";
  }
  if (/膨润土销售人员|膨润土销售|膨润土业务|涂料原料销售/.test(value)) return "膨润土销售人员";
  if (/销售管培|销售管理培训|营销管培/.test(value)) return "销售管培生";
  if (/人力资源管培|人资管培|人力资源管理培训/.test(value)) return "人力资源管培生";
  if (/HRBP|hrbp|人力资源|招聘|HR|员工关系|薪酬|绩效/i.test(value)) return "HRBP";
  if (/国际业务管培|国际|外贸|海外|跨境|英语|商务英语|外贸销售|化工原料外贸/.test(value)) return "国际业务管培生";
  if (/电气|PLC|自动化/.test(value)) return "电气工程师";
  return AI_INTERNSHIP_JOB_TYPE;
}

function ensureEditJobTypeOption(jobType) {
  if (!elements.editJobType || !jobType) return;
  const value = normalizeJobType(jobType);
  if ([...elements.editJobType.options].some((option) => option.value === value)) return;
  const option = document.createElement("option");
  option.value = value;
  option.textContent = `历史岗位：${value}`;
  option.dataset.legacy = "true";
  elements.editJobType.append(option);
}

function syncEditJobTypeOptions() {
  if (!elements.editJobType) return;
  const activeLegacyValue = elements.editJobType.value && !RESUME_LIBRARY_JOB_TYPES.includes(elements.editJobType.value)
    ? elements.editJobType.value
    : "";
  elements.editJobType.replaceChildren(
    ...RESUME_LIBRARY_JOB_TYPES.map((jobType) => {
      const option = document.createElement("option");
      option.value = jobType;
      option.textContent = getResumeJobDisplayLabel(jobType);
      return option;
    })
  );
  if (activeLegacyValue) ensureEditJobTypeOption(activeLegacyValue);
}

function showResumeInfoPanel() {
  if (elements.resumeInfoPanel) elements.resumeInfoPanel.hidden = false;
  if (elements.bossActionPanel) elements.bossActionPanel.hidden = true;
  setBossAutomationMode("");
}

function normalizeAutomationPlatform(platform) {
  const text = String(platform || "").trim().toLowerCase();
  if (text === "51" || text === "51job" || text === "job51") return "job51";
  if (text === "zhilian" || text === "zhaopin" || text === "智联") return "zhilian";
  if (text === "boss") return "boss";
  return Object.hasOwn(AUTOMATION_PLATFORM_LABELS, platform) ? platform : "boss";
}

function automationPlatformLabel(platform = activeAutomationPlatform) {
  return AUTOMATION_PLATFORM_LABELS[normalizeAutomationPlatform(platform)] || "BOSS";
}

function automationPlatformParam(platform = activeAutomationPlatform) {
  const normalized = normalizeAutomationPlatform(platform);
  return normalized === "job51" ? "51job" : normalized;
}

function syncAutomationPlatformSwitcher() {
  elements.automationPlatformSwitcher?.querySelectorAll("[data-automation-platform]").forEach((button) => {
    const platform = normalizeAutomationPlatform(button.dataset.automationPlatform);
    button.classList.toggle("is-active", platform === activeAutomationPlatform);
  });
  elements.bossAutomationBtn?.classList.toggle("is-active", activeAutomationPlatform === "boss");
  elements.job51QuickAutomationBtn?.classList.toggle("is-active", activeAutomationPlatform === "job51");
  elements.zhilianQuickAutomationBtn?.classList.toggle("is-active", activeAutomationPlatform === "zhilian");
}

function applyAutomationRunButton(button, state, idleText, idleTitle, runningTitle, pausedTitle) {
  if (!button) return;
  button.disabled = false;
  if (state.running && !state.paused) {
    button.textContent = `处理中${"。".repeat(state.dotCount || 1)}`;
    button.title = runningTitle;
    button.setAttribute("aria-label", runningTitle);
    button.classList.remove("primary-btn");
    button.classList.add("ghost-btn");
  } else if (state.paused) {
    button.textContent = "已暂停";
    button.title = pausedTitle;
    button.setAttribute("aria-label", pausedTitle);
    button.classList.add("primary-btn");
    button.classList.remove("ghost-btn");
  } else {
    button.textContent = idleText;
    button.title = idleTitle;
    button.setAttribute("aria-label", idleTitle);
    button.classList.add("primary-btn");
    button.classList.remove("ghost-btn");
  }
}

function syncPlatformAutomationStartControls() {
  if (activeAutomationPlatform === "boss") return;
  const label = automationPlatformLabel();
  const processState = getPlatformAutomationTaskState(activeAutomationPlatform, "process");
  const proactiveState = getPlatformAutomationTaskState(activeAutomationPlatform, "proactive");
  if (elements.processBossMessagesBtn) {
    elements.processBossMessagesBtn.disabled = false;
    elements.processBossMessagesBtn.textContent = "处理消息";
    elements.processBossMessagesBtn.title = "处理未读招聘消息";
    elements.processBossMessagesBtn.setAttribute("aria-label", "处理未读招聘消息");
  }
  if (elements.proactiveBossContactBtn) {
    elements.proactiveBossContactBtn.disabled = false;
    elements.proactiveBossContactBtn.textContent = "主动联系";
    elements.proactiveBossContactBtn.title = "选择岗位并主动联系推荐牛人";
    elements.proactiveBossContactBtn.setAttribute("aria-label", "选择岗位并主动联系推荐牛人");
  }
  applyAutomationRunButton(elements.startProcessMessagesBtn, processState, "开始处理", `${label} 开始处理消息`, "处理中，点击暂停", "已暂停，点击继续处理");
  applyAutomationRunButton(
    elements.startProactiveContactBtn,
    proactiveState,
    "开始主动联系",
    `${label} 开始主动联系`,
    "主动联系处理中，点击暂停",
    "已暂停，点击继续主动联系"
  );
}

function updateAutomationPlatformControls() {
  const isBoss = activeAutomationPlatform === "boss";
  if (elements.bossAccountSwitcher) elements.bossAccountSwitcher.hidden = false;
  if (elements.bossAutomationSpeedControl) elements.bossAutomationSpeedControl.hidden = false;
  if (elements.processBossMessagesBtn) {
    elements.processBossMessagesBtn.textContent = "处理消息";
    elements.processBossMessagesBtn.title = "处理未读招聘消息";
    elements.processBossMessagesBtn.setAttribute("aria-label", "处理未读招聘消息");
  }
  if (elements.proactiveBossContactBtn) {
    elements.proactiveBossContactBtn.textContent = "主动联系";
    elements.proactiveBossContactBtn.title = "选择岗位并主动联系推荐牛人";
    elements.proactiveBossContactBtn.setAttribute("aria-label", "选择岗位并主动联系推荐牛人");
  }
  if (!isBoss) {
    const showProactive = bossAutomationSummaryMode === "proactive";
    const processState = getPlatformAutomationTaskState(activeAutomationPlatform, "process");
    const proactiveState = getPlatformAutomationTaskState(activeAutomationPlatform, "proactive");
    if (elements.processMessagesControlPanel) elements.processMessagesControlPanel.hidden = showProactive;
    if (elements.proactiveContactControlPanel) elements.proactiveContactControlPanel.hidden = !showProactive;
    syncPlatformAutomationStartControls();
    if (elements.processMessagesStatus) {
      elements.processMessagesStatus.textContent = processState.paused ? "已暂停" : processState.running ? "可点击按钮暂停" : "等待开始";
    }
    if (elements.proactiveContactStatus) {
      elements.proactiveContactStatus.textContent = proactiveState.paused ? "已暂停" : proactiveState.running ? "可点击按钮暂停" : "请选择岗位后开始";
    }
    return;
  }
  updateProcessMessagesButton();
  updateProactiveContactButton();
}

function showAutomationActions(message = "") {
  if (elements.resumeInfoPanel) elements.resumeInfoPanel.hidden = true;
  if (elements.bossActionPanel) elements.bossActionPanel.hidden = false;
  syncAutomationPlatformSwitcher();
  updateAutomationPlatformControls();
  if (elements.bossActionHint) {
    elements.bossActionHint.textContent = message || `${automationPlatformLabel()} 已选中，可以处理消息或主动联系`;
  }
}

function selectAutomationPlatform(platform, message = "") {
  activeAutomationPlatform = normalizeAutomationPlatform(platform);
  setBossAutomationMode("process");
  showAutomationActions(message);
  refreshBossAutomationSummary();
}

function showBossAutomationActions(message = "已启动后可以在这里执行招聘沟通流程") {
  activeAutomationPlatform = "boss";
  showAutomationActions(message);
}

window.prepareBossAutomationPanel = showBossAutomationActions;

function setBossAutomationMode(mode) {
  bossAutomationSummaryMode = mode === "proactive" ? "proactive" : "process";
  elements.processBossMessagesBtn?.classList.toggle("is-selected", mode === "process");
  elements.proactiveBossContactBtn?.classList.toggle("is-selected", mode === "proactive");
  if (bossAutomationLastSummaryPayload) renderBossAutomationSummary(bossAutomationLastSummaryPayload);
}

function populateProactiveContactPositions() {
  if (!elements.proactiveContactPositionSelect) return;
  elements.proactiveContactPositionSelect.replaceChildren(
    ...BOSS_PROACTIVE_POSITION_OPTIONS.map((position) => {
      const option = document.createElement("option");
      option.value = position.value;
      option.textContent = position.label;
      return option;
    })
  );
  const lastPosition = getStoredProactiveContactPosition();
  if (lastPosition && BOSS_PROACTIVE_POSITION_OPTIONS.some((position) => position.value === lastPosition)) {
    elements.proactiveContactPositionSelect.value = lastPosition;
  }
}

function getSelectedProactiveContactPosition() {
  const selected = elements.proactiveContactPositionSelect?.value?.trim();
  return selected || BOSS_PROACTIVE_POSITION_OPTIONS[0]?.value || "";
}

function getSelectedProactiveContactPositionLabel() {
  const selectedOption = elements.proactiveContactPositionSelect?.selectedOptions?.[0];
  return selectedOption?.textContent?.trim() || getSelectedProactiveContactPosition();
}

function getProactiveContactCount() {
  const raw = Number.parseInt(elements.proactiveContactCountInput?.value || "10", 10);
  const count = Number.isFinite(raw) ? Math.max(1, Math.min(30, raw)) : 10;
  if (elements.proactiveContactCountInput) elements.proactiveContactCountInput.value = String(count);
  return count;
}

function splitProactiveRuleKeywords(text) {
  return String(text || "")
    .split(/[\n,，、;；|/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeProactiveRulePayload(raw = {}) {
  const mode = raw.mode === "custom" || raw.enabled === true ? "custom" : "default";
  const maxAgeValue = Number.parseInt(raw.maxAge || "", 10);
  const rawRequired = raw.requiredChecks && typeof raw.requiredChecks === "object" ? raw.requiredChecks : {};
  const requiredChecks = {
    education: rawRequired.education !== false,
    age: rawRequired.age !== false,
    keyword: rawRequired.keyword !== false,
  };
  return {
    mode,
    enabled: mode === "custom",
    requiredChecks,
    minEducation: ["", "college", "bachelor", "master"].includes(raw.minEducation) ? raw.minEducation : "",
    maxAge: Number.isFinite(maxAgeValue) && maxAgeValue >= 16 && maxAgeValue <= 70 ? maxAgeValue : null,
    keywordMode: raw.keywordMode === "all" ? "all" : "any",
    unknownPolicy: raw.unknownPolicy === "allow" ? "allow" : "skip",
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 20)
      : splitProactiveRuleKeywords(raw.keywordsText || raw.keywordText || ""),
    profile: ["", "bentonite_sales", "hrbp", "international_business", "electrical"].includes(raw.profile) ? raw.profile : "",
    presetVersion: raw.presetVersion || "",
    userCustomized: Boolean(raw.userCustomized),
  };
}

function getDefaultProactiveContactRules(position = "") {
  const key = proactiveRulePositionKey(position);
  const exact = BOSS_PROACTIVE_DEFAULT_RULES_BY_POSITION[key];
  const normalizedKey = key.toLowerCase();
  const matched = exact
    || Object.entries(BOSS_PROACTIVE_DEFAULT_RULES_BY_POSITION).find(([name]) => {
      const left = String(name || "").toLowerCase();
      return left && normalizedKey && (left.includes(normalizedKey) || normalizedKey.includes(left));
    })?.[1]
    || {
      mode: "custom",
      requiredChecks: { education: true, age: true, keyword: true },
      minEducation: "college",
      maxAge: null,
      keywordMode: "any",
      keywords: [],
      unknownPolicy: "skip",
    };
  return normalizeProactiveRulePayload(exact || matched);
}

function mergeProactiveRuleDefaults(position, storedRules) {
  const defaults = getDefaultProactiveContactRules(position);
  if (!storedRules) return defaults;
  const rules = normalizeProactiveRulePayload(storedRules);
  if (rules.presetVersion !== BOSS_PROACTIVE_RULE_PRESET_VERSION) {
    return defaults;
  }
  const defaultRequired = defaults.requiredChecks || {};
  const storedRequired = rules.requiredChecks || {};
  const merged = {
    ...defaults,
    ...rules,
    profile: rules.profile || defaults.profile || "",
    requiredChecks: {
      education: storedRequired.education ?? defaultRequired.education ?? true,
      age: storedRequired.age ?? defaultRequired.age ?? true,
      keyword: storedRequired.keyword ?? defaultRequired.keyword ?? true,
    },
    keywords: rules.keywords?.length ? rules.keywords : defaults.keywords,
    keywordMode: rules.keywords?.length ? rules.keywordMode : defaults.keywordMode,
  };
  return normalizeProactiveRulePayload(merged);
}

function readProactiveRuleStore() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(BOSS_PROACTIVE_RULE_STORAGE_KEY) || "{}");
    if (stored && typeof stored === "object" && stored.byPosition) {
      return {
        version: 2,
        lastPosition: String(stored.lastPosition || ""),
        byPosition: stored.byPosition && typeof stored.byPosition === "object" ? stored.byPosition : {},
        fallbackRules: normalizeProactiveRulePayload(stored.fallbackRules || {}),
      };
    }
    return {
      version: 2,
      lastPosition: "",
      byPosition: {},
      fallbackRules: normalizeProactiveRulePayload(stored || {}),
    };
  } catch {
    return {
      version: 2,
      lastPosition: "",
      byPosition: {},
      fallbackRules: normalizeProactiveRulePayload(),
    };
  }
}

function writeProactiveRuleStore(store) {
  try {
    window.localStorage.setItem(BOSS_PROACTIVE_RULE_STORAGE_KEY, JSON.stringify({
      version: 2,
      lastPosition: store.lastPosition || "",
      byPosition: store.byPosition || {},
      fallbackRules: store.fallbackRules || normalizeProactiveRulePayload(),
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    // Ignore storage failures; the selected rules still apply to this run.
  }
}

function getStoredProactiveContactPosition() {
  const store = readProactiveRuleStore();
  return store.lastPosition || "";
}

function saveStoredProactiveContactPosition(position) {
  const store = readProactiveRuleStore();
  store.lastPosition = String(position || "").trim();
  writeProactiveRuleStore(store);
}

function proactiveRulePositionKey(position = getSelectedProactiveContactPosition()) {
  return String(position || "").trim() || "__default__";
}

function readStoredProactiveContactRules(position = getSelectedProactiveContactPosition()) {
  const store = readProactiveRuleStore();
  const key = proactiveRulePositionKey(position);
  const rules = store.byPosition?.[key];
  return mergeProactiveRuleDefaults(key, rules || store.fallbackRules || null);
}

function saveStoredProactiveContactRules(position, rules) {
  const store = readProactiveRuleStore();
  const key = proactiveRulePositionKey(position);
  store.lastPosition = key === "__default__" ? store.lastPosition : key;
  store.byPosition = store.byPosition || {};
  store.byPosition[key] = {
    ...normalizeProactiveRulePayload(rules),
    presetVersion: BOSS_PROACTIVE_RULE_PRESET_VERSION,
    userCustomized: true,
    savedForPosition: key,
    savedAt: new Date().toISOString(),
  };
  writeProactiveRuleStore(store);
}

function renderProactiveRuleVisibility() {
  const enabled = elements.proactiveRuleMode?.value === "custom";
  if (elements.proactiveCustomRules) elements.proactiveCustomRules.hidden = !enabled;
}

function applyProactiveContactRulesToForm(rules = readStoredProactiveContactRules(getSelectedProactiveContactPosition())) {
  if (elements.proactiveRuleMode) elements.proactiveRuleMode.value = rules.enabled ? "custom" : "default";
  const requiredChecks = rules.requiredChecks || {};
  if (elements.proactiveRequireEducationCheck) elements.proactiveRequireEducationCheck.checked = requiredChecks.education !== false;
  if (elements.proactiveRequireAgeCheck) elements.proactiveRequireAgeCheck.checked = requiredChecks.age !== false;
  if (elements.proactiveRequireKeywordCheck) elements.proactiveRequireKeywordCheck.checked = requiredChecks.keyword !== false;
  if (elements.proactiveMinEducationSelect) elements.proactiveMinEducationSelect.value = rules.minEducation || "";
  if (elements.proactiveMaxAgeInput) elements.proactiveMaxAgeInput.value = rules.maxAge ? String(rules.maxAge) : "";
  if (elements.proactiveKeywordModeSelect) elements.proactiveKeywordModeSelect.value = rules.keywordMode || "any";
  if (elements.proactiveUnknownPolicySelect) elements.proactiveUnknownPolicySelect.value = rules.unknownPolicy || "skip";
  if (elements.proactiveKeywordInput) elements.proactiveKeywordInput.value = (rules.keywords || []).join("、");
  renderProactiveRuleVisibility();
}

function getProactiveContactRules() {
  const position = getSelectedProactiveContactPosition();
  const defaultRules = getDefaultProactiveContactRules(position);
  const rules = normalizeProactiveRulePayload({
    mode: elements.proactiveRuleMode?.value || "default",
    profile: defaultRules.profile || "",
    requiredChecks: {
      education: elements.proactiveRequireEducationCheck?.checked !== false,
      age: elements.proactiveRequireAgeCheck?.checked !== false,
      keyword: elements.proactiveRequireKeywordCheck?.checked !== false,
    },
    minEducation: elements.proactiveMinEducationSelect?.value || "",
    maxAge: elements.proactiveMaxAgeInput?.value || "",
    keywordMode: elements.proactiveKeywordModeSelect?.value || "any",
    unknownPolicy: elements.proactiveUnknownPolicySelect?.value || "skip",
    keywords: splitProactiveRuleKeywords(elements.proactiveKeywordInput?.value || ""),
  });
  saveStoredProactiveContactRules(position, rules);
  renderProactiveRuleVisibility();
  return rules;
}

function handleProactiveContactPositionChange() {
  const position = getSelectedProactiveContactPosition();
  saveStoredProactiveContactPosition(position);
  applyProactiveContactRulesToForm(readStoredProactiveContactRules(position));
  const label = getSelectedProactiveContactPositionLabel();
  setProactiveContactStatus(`已载入${label}的主动联系规则`);
}

function describeProactiveContactRules(rules) {
  if (!rules?.enabled) return "岗位默认规则";
  const parts = [];
  const requiredChecks = rules.requiredChecks || {};
  const checkedNames = [];
  if (requiredChecks.education !== false) checkedNames.push("学历");
  if (requiredChecks.age !== false) checkedNames.push("年龄");
  if (requiredChecks.keyword !== false) checkedNames.push("关键词");
  if (checkedNames.length) parts.push(`需满足：${checkedNames.join("、")}`);
  const educationLabel = {
    college: "大专及以上",
    bachelor: "本科及以上",
    master: "硕士及以上",
  }[rules.minEducation];
  if (educationLabel && requiredChecks.education !== false) parts.push(educationLabel);
  if (rules.maxAge && requiredChecks.age !== false) parts.push(`${rules.maxAge}岁以下`);
  if (rules.keywords?.length && requiredChecks.keyword !== false) {
    parts.push(`关键词${rules.keywordMode === "all" ? "全部" : "任意"}：${rules.keywords.join("、")}`);
  }
  parts.push(`缺失信息${rules.unknownPolicy === "allow" ? "放行" : "跳过"}`);
  return parts.join("，") || "自定义规则";
}

function setProactiveContactStatus(text) {
  if (elements.proactiveContactStatus) elements.proactiveContactStatus.textContent = text;
}

function updateProactiveContactButton() {
  if (activeAutomationPlatform !== "boss") {
    syncPlatformAutomationStartControls();
    return;
  }
  if (elements.proactiveBossContactBtn) {
    elements.proactiveBossContactBtn.textContent = "主动联系";
    elements.proactiveBossContactBtn.title = "选择岗位并主动联系推荐牛人";
    elements.proactiveBossContactBtn.setAttribute("aria-label", "选择岗位并主动联系推荐牛人");
  }
  if (!elements.startProactiveContactBtn) return;
  const state = getProactiveContactState();
  if (state.running && !state.paused) {
    elements.startProactiveContactBtn.textContent = `处理中${"。".repeat(state.dotCount || 1)}`;
    elements.startProactiveContactBtn.title = "点击暂停主动联系";
    elements.startProactiveContactBtn.setAttribute("aria-label", "主动联系处理中，点击暂停");
    elements.startProactiveContactBtn.classList.remove("primary-btn");
    elements.startProactiveContactBtn.classList.add("ghost-btn");
  } else if (state.paused) {
    elements.startProactiveContactBtn.textContent = "已暂停";
    elements.startProactiveContactBtn.title = "点击继续主动联系";
    elements.startProactiveContactBtn.setAttribute("aria-label", "主动联系已暂停，点击继续");
    elements.startProactiveContactBtn.classList.add("primary-btn");
    elements.startProactiveContactBtn.classList.remove("ghost-btn");
  } else {
    elements.startProactiveContactBtn.textContent = "开始主动联系";
    elements.startProactiveContactBtn.title = "开始主动联系";
    elements.startProactiveContactBtn.setAttribute("aria-label", "开始主动联系");
    elements.startProactiveContactBtn.classList.add("primary-btn");
    elements.startProactiveContactBtn.classList.remove("ghost-btn");
  }
}

function stopProactiveContactLiveTimers(accountId = bossAutomationAccountId) {
  const state = getProactiveContactState(accountId);
  window.clearInterval(state.dotsTimer);
  window.clearInterval(state.summaryTimer);
  state.dotsTimer = 0;
  state.summaryTimer = 0;
}

function startProactiveContactLiveTimers(accountId = bossAutomationAccountId) {
  const state = getProactiveContactState(accountId);
  stopProactiveContactLiveTimers(accountId);
  state.dotCount = 0;
  if (isCurrentBossAutomationAccount(accountId)) {
    setProactiveContactStatus("处理中。");
    updateProactiveContactButton();
  }
  state.dotsTimer = window.setInterval(() => {
    state.dotCount = (state.dotCount % 3) + 1;
    if (isCurrentBossAutomationAccount(accountId)) {
      setProactiveContactStatus(`处理中${"。".repeat(state.dotCount)}`);
      updateProactiveContactButton();
    }
  }, 450);
  state.summaryTimer = window.setInterval(() => {
    if (isCurrentBossAutomationAccount(accountId)) refreshBossAutomationSummary();
  }, 5000);
}

async function showProactiveContactControls() {
  setBatchPanelExpanded(true);
  showBossAutomationActions("请选择岗位后开始主动联系，当前会进入 BOSS 推荐牛人页面按岗位打招呼");
  setBossAutomationMode("proactive");
  populateProactiveContactPositions();
  applyProactiveContactRulesToForm(readStoredProactiveContactRules(getSelectedProactiveContactPosition()));
  if (elements.processMessagesControlPanel) elements.processMessagesControlPanel.hidden = true;
  if (elements.proactiveContactControlPanel) elements.proactiveContactControlPanel.hidden = false;
  const state = getProactiveContactState();
  setProactiveContactStatus(state.running && !state.paused ? "处理中。" : state.paused ? "已暂停" : "请选择岗位后开始");
  updateProactiveContactButton();
  if (elements.batchSummary) {
    elements.batchSummary.textContent = "主动联系不会立刻执行；先选择岗位，再点击开始主动联系";
  }
  await refreshBossAutomationSummary();
}

function getChinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeDateKey(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function dateStateToDates(value = "") {
  return [
    ...new Set(
      String(value || "")
        .split(/[,\s]+/)
        .map(normalizeDateKey)
        .filter(Boolean)
    ),
  ].sort();
}

function datesToDateState(dates = []) {
  return [...new Set((Array.isArray(dates) ? dates : []).map(normalizeDateKey).filter(Boolean))].sort().join(",");
}

function isAllDateState(value = "") {
  const text = String(value || "").trim();
  return text === "all" || text === "全部";
}

function normalizeDateState(value = "", fallback = getChinaDateKey()) {
  if (isAllDateState(value)) return "all";
  const dates = dateStateToDates(value);
  return dates.length ? datesToDateState(dates) : fallback;
}

function dateStateLabel(value = "", allLabel = "全部日期") {
  if (isAllDateState(value) || !String(value || "").trim()) return allLabel;
  const dates = dateStateToDates(value);
  if (!dates.length) return allLabel;
  if (dates.length === 1) return dates[0];
  return `${dates[0]} 等${dates.length}天`;
}

function setDateInputValue(input, dateState) {
  if (!input) return;
  const dates = dateStateToDates(dateState);
  input.value = dates.length === 1 ? dates[0] : "";
}

function renderDateChips(container, dateState, onRemove) {
  if (!container) return;
  const dates = dateStateToDates(dateState);
  container.replaceChildren(
    ...dates.map((date) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "date-chip";
      chip.textContent = date;
      chip.title = `移除 ${date}`;
      chip.addEventListener("click", () => onRemove?.(date));
      return chip;
    })
  );
}

function renderBossAutomationSummary(payload = {}) {
  if (!elements.bossAutomationSummaryPanel || !elements.bossAutomationStatsGrid) return;
  bossAutomationLastSummaryPayload = payload;
  const today = payload.today || getChinaDateKey();
  const selectedDate = payload.date || bossAutomationSummaryDate || today;
  bossAutomationSummaryDate = selectedDate;
  const selectedDateLabel = dateStateLabel(selectedDate);
  const summaryPlatform = normalizeAutomationPlatform(payload.platform || activeAutomationPlatform);
  const summaryPlatformLabel = automationPlatformLabel(summaryPlatform);
  const summaryPlatformParam = automationPlatformParam(summaryPlatform);
  const summaryAccountId = normalizeBossAutomationAccountId(payload.accountId || bossAutomationAccountId);
  if (elements.bossAutomationSummaryTitle) {
    const accountLabel = bossAutomationAccountLabel(summaryAccountId);
    elements.bossAutomationSummaryTitle.textContent =
      `${summaryPlatformLabel} · ${accountLabel} · ${selectedDate === today ? "今日概览" : `${selectedDateLabel} 概览`}`;
  }
  setDateInputValue(elements.bossAutomationDateInput, selectedDate);
  renderDateChips(elements.bossAutomationSelectedDates, selectedDate, (date) => removeBossAutomationSummaryDate(date));
  elements.bossAutomationTodayBtn?.classList.toggle("is-active", selectedDate === today);
  elements.bossAutomationAllDatesBtn?.classList.toggle("is-active", isAllDateState(selectedDate));
  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const modeKeys = BOSS_SUMMARY_METRICS_BY_MODE[bossAutomationSummaryMode] || [];
  if (elements.bossAutomationSummaryTitle && bossAutomationSummaryMode === "proactive") {
    const isToday = selectedDate === today;
    const accountLabel = bossAutomationAccountLabel(summaryAccountId);
    elements.bossAutomationSummaryTitle.textContent =
      `${summaryPlatformLabel} · ${accountLabel} · ${isToday ? "今日主动联系概览" : `${selectedDateLabel} 主动联系概览`}`;
  }
  elements.bossAutomationStatsGrid.replaceChildren(
    ...(modeKeys.length ? metrics.filter((metric) => modeKeys.includes(metric.key || "")) : metrics).map((metric) => {
      const item = document.createElement("a");
      item.className = "automation-stat";
      item.href = `./automation-details.html?mode=${encodeURIComponent(bossAutomationSummaryMode)}&metric=${encodeURIComponent(
        metric.key || "processed"
      )}&date=${encodeURIComponent(selectedDate)}&accountId=${encodeURIComponent(summaryAccountId)}&platform=${encodeURIComponent(
        summaryPlatformParam
      )}`;
      item.target = "_blank";
      item.rel = "noreferrer";
      item.title = `查看${metric.label || "今日概览"}明细`;
      const label = document.createElement("span");
      label.textContent = metric.label || "-";
      const value = document.createElement("strong");
      value.textContent = String(metric.value ?? 0);
      item.append(label, value);
      return item;
    })
  );
  if (elements.bossAutomationPositionBreakdown) {
    const byPosition = Array.isArray(payload.proactiveByPosition) ? payload.proactiveByPosition : [];
    const visible = bossAutomationSummaryMode === "proactive" && byPosition.length > 0;
    elements.bossAutomationPositionBreakdown.hidden = !visible;
    if (visible) {
      const title = document.createElement("strong");
      title.textContent = "按岗位统计";
      const list = document.createElement("div");
      list.className = "automation-position-list";
      list.replaceChildren(
        ...byPosition.map((item) => {
          const row = document.createElement("div");
          row.className = "automation-position-row";
          const name = document.createElement("span");
          name.className = "automation-position-name";
          name.textContent = item.position || "未识别岗位";
          const counts = document.createElement("span");
          counts.className = "automation-position-counts";
          counts.textContent = `主动 ${Number(item.greeted || 0)} · 回复 ${Number(item.replied || 0)} · 符合 ${Number(item.qualified || 0)}`;
          row.append(name, counts);
          return row;
        })
      );
      elements.bossAutomationPositionBreakdown.replaceChildren(title, list);
    } else {
      elements.bossAutomationPositionBreakdown.replaceChildren();
    }
  }

  if (elements.bossAutomationUpdatedAt) {
    elements.bossAutomationUpdatedAt.textContent = payload.updatedAt ? `更新 ${payload.updatedAt}` : "";
  }
  elements.bossAutomationSummaryPanel.hidden = false;
}

function automationSummaryCacheKey(platformParam, accountId, selectedDate) {
  return [platformParam || "boss", accountId || "all", selectedDate || ""].join("|");
}

function normalizeAutomationSummaryPayload(payload, platformFallback, accountFallback) {
  return {
    ...payload,
    platform: normalizeAutomationPlatform(payload.platform || platformFallback),
    accountId: payload.accountId || accountFallback,
  };
}

function clearAutomationSummaryCache() {
  automationSummaryCache.clear();
}

async function refreshBossAutomationSummary(date = bossAutomationSummaryDate, options = {}) {
  const selectedDateForRequest = date || getChinaDateKey();
  const platformForRequest = activeAutomationPlatform;
  const platformParamForRequest = automationPlatformParam(platformForRequest);
  const accountIdForRequest = getCurrentBossAutomationAccountId();
  const cacheKey = automationSummaryCacheKey(platformParamForRequest, accountIdForRequest, selectedDateForRequest);
  const cached = automationSummaryCache.get(cacheKey);
  if (!options.force && cached && Date.now() - cached.cachedAt < AUTOMATION_SUMMARY_CACHE_TTL_MS) {
    renderBossAutomationSummary(cached.payload);
    return cached.payload;
  }
  if (options.force) automationSummaryCache.delete(cacheKey);
  const requestSeq = ++automationSummaryRequestSeq;
  if (automationSummaryAbortController) automationSummaryAbortController.abort();
  const controller = new AbortController();
  automationSummaryAbortController = controller;
  try {
    const forceParam = options.force ? "&force=1" : "";
    const endpoint =
      platformParamForRequest === "boss"
        ? `/api/boss-automation/summary?date=${encodeURIComponent(selectedDateForRequest)}&accountId=${encodeURIComponent(accountIdForRequest)}${forceParam}`
        : `/api/platform-automation/summary?platform=${encodeURIComponent(platformParamForRequest)}&date=${encodeURIComponent(
            selectedDateForRequest
          )}&accountId=${encodeURIComponent(accountIdForRequest)}${forceParam}`;
    const payload = await requestJson(endpoint, { signal: controller.signal });
    if (requestSeq !== automationSummaryRequestSeq) return null;
    const normalizedPayload = normalizeAutomationSummaryPayload(payload, platformForRequest, accountIdForRequest);
    automationSummaryCache.set(cacheKey, { cachedAt: Date.now(), payload: normalizedPayload });
    renderBossAutomationSummary(normalizedPayload);
    return normalizedPayload;
  } catch (error) {
    if (error?.name === "AbortError") return null;
    console.warn(error);
    if (requestSeq !== automationSummaryRequestSeq) return null;
    if (elements.bossAutomationSummaryPanel) elements.bossAutomationSummaryPanel.hidden = false;
    if (elements.bossAutomationStatsGrid) {
      elements.bossAutomationStatsGrid.innerHTML = '<article class="automation-stat"><span>今日概览</span><strong>-</strong></article>';
    }
    return null;
  } finally {
    if (automationSummaryAbortController === controller) automationSummaryAbortController = null;
  }
}

function setBossAutomationSummaryDate(date) {
  bossAutomationSummaryDate = normalizeDateState(date, getChinaDateKey());
  refreshBossAutomationSummary(bossAutomationSummaryDate);
}

function addBossAutomationSummaryDate(date) {
  const nextDate = normalizeDateKey(date);
  if (!nextDate) return;
  const dates = dateStateToDates(bossAutomationSummaryDate);
  bossAutomationSummaryDate = datesToDateState([...dates, nextDate]);
  refreshBossAutomationSummary(bossAutomationSummaryDate);
}

function removeBossAutomationSummaryDate(date) {
  const dates = dateStateToDates(bossAutomationSummaryDate).filter((item) => item !== date);
  bossAutomationSummaryDate = dates.length ? datesToDateState(dates) : "all";
  refreshBossAutomationSummary(bossAutomationSummaryDate);
}

function setProcessMessagesStatus(text) {
  if (elements.processMessagesStatus) elements.processMessagesStatus.textContent = text;
}

function updateProcessMessagesButton() {
  if (activeAutomationPlatform !== "boss") {
    syncPlatformAutomationStartControls();
    return;
  }
  const state = getProcessMessagesState();
  if (elements.processBossMessagesBtn) {
    elements.processBossMessagesBtn.disabled = false;
    elements.processBossMessagesBtn.textContent = "处理消息";
    elements.processBossMessagesBtn.title = "处理未读招聘消息";
    elements.processBossMessagesBtn.setAttribute("aria-label", "处理未读招聘消息");
  }
  if (!elements.startProcessMessagesBtn) return;
  if (state.running && !state.paused) {
    elements.startProcessMessagesBtn.textContent = `处理中${"。".repeat(state.dotCount || 1)}`;
    elements.startProcessMessagesBtn.title = "点击暂停处理";
    elements.startProcessMessagesBtn.setAttribute("aria-label", "处理中，点击暂停");
    elements.startProcessMessagesBtn.classList.remove("primary-btn");
    elements.startProcessMessagesBtn.classList.add("ghost-btn");
  } else if (state.paused) {
    elements.startProcessMessagesBtn.textContent = "已暂停";
    elements.startProcessMessagesBtn.title = "点击继续处理";
    elements.startProcessMessagesBtn.setAttribute("aria-label", "已暂停，点击继续");
    elements.startProcessMessagesBtn.classList.add("primary-btn");
    elements.startProcessMessagesBtn.classList.remove("ghost-btn");
  } else {
    elements.startProcessMessagesBtn.textContent = "开始处理";
    elements.startProcessMessagesBtn.title = "开始处理消息";
    elements.startProcessMessagesBtn.setAttribute("aria-label", "开始处理消息");
    elements.startProcessMessagesBtn.classList.add("primary-btn");
    elements.startProcessMessagesBtn.classList.remove("ghost-btn");
  }
}

function stopProcessMessagesLiveTimers(accountId = bossAutomationAccountId) {
  const state = getProcessMessagesState(accountId);
  window.clearInterval(state.dotsTimer);
  window.clearInterval(state.summaryTimer);
  state.dotsTimer = 0;
  state.summaryTimer = 0;
}

function startProcessMessagesLiveTimers(accountId = bossAutomationAccountId) {
  const state = getProcessMessagesState(accountId);
  stopProcessMessagesLiveTimers(accountId);
  state.dotCount = 0;
  if (isCurrentBossAutomationAccount(accountId)) {
    setProcessMessagesStatus("处理中。");
    updateProcessMessagesButton();
  }
  state.dotsTimer = window.setInterval(() => {
    state.dotCount = (state.dotCount % 3) + 1;
    if (isCurrentBossAutomationAccount(accountId)) {
      setProcessMessagesStatus(`处理中${"。".repeat(state.dotCount)}`);
      updateProcessMessagesButton();
    }
  }, 450);
  state.summaryTimer = window.setInterval(() => {
    if (isCurrentBossAutomationAccount(accountId)) refreshBossAutomationSummary();
  }, 5000);
}

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

initializeRecordCheckboxFilters();

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

function switchJobPage(jobType) {
  const nextUrl = jobType ? `./index.html?job=${encodeURIComponent(jobType)}` : "./index.html";
  window.history.pushState({ jobType }, "", nextUrl);
  recordsPage = 1;
  refreshResumeView();
  loadRuleSuggestions().catch(console.error);
  loadFeedbackTagOptions(jobType || RESUME_LIBRARY_JOB_TYPES[0]).catch(console.error);
  if (elements.scoringRulesBox && !elements.scoringRulesBox.hidden) {
    loadScoringRules().catch(console.error);
  }
}

function renderJobNav(resumes = []) {
  const activeJobType = getActiveJobType();
  const jobCounts = new Map();
  resumes.forEach((resume) => {
    const normalized = normalizeJobType(resume.jobType);
    jobCounts.set(normalized, (jobCounts.get(normalized) || 0) + 1);
  });
  const fragment = document.createDocumentFragment();

  const allLink = document.createElement("a");
  allLink.href = "./index.html";
  allLink.className = `job-nav-btn ${activeJobType ? "" : "is-active"}`.trim();
  allLink.textContent = `全部简历 (${resumes.length})`;
  allLink.addEventListener("click", (event) => {
    event.preventDefault();
    switchJobPage("");
  });
  fragment.appendChild(allLink);

  const visibleJobTypes = activeJobType && !RESUME_LIBRARY_JOB_TYPES.includes(activeJobType)
    ? [...RESUME_LIBRARY_JOB_TYPES, activeJobType]
    : RESUME_LIBRARY_JOB_TYPES;
  visibleJobTypes.forEach((jobType) => {
    const count = jobCounts.get(jobType) || 0;
    const link = document.createElement("a");
    link.href = `./index.html?job=${encodeURIComponent(jobType)}`;
    link.className = `job-nav-btn ${activeJobType === jobType ? "is-active" : ""}`.trim();
    link.textContent = `${getResumeJobDisplayLabel(jobType)} (${count})`;
    link.title = jobType;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      switchJobPage(jobType);
    });
    fragment.appendChild(link);
  });

  elements.jobNav.replaceChildren(fragment);
  elements.recordsTitle.textContent = activeJobType ? `${getResumeJobDisplayLabel(activeJobType)}简历库` : "全部简历库";
}

function appendJdRuleCard(container, title, description, items = [], options = {}) {
  const card = document.createElement("article");
  card.className = `scoring-rule-card ${options.wide ? "is-wide" : ""}`.trim();

  const heading = document.createElement("h3");
  heading.textContent = title;
  card.appendChild(heading);

  if (description) {
    const text = document.createElement("p");
    text.textContent = description;
    card.appendChild(text);
  }

  const visibleItems = Array.isArray(items) ? items.filter((item) => String(item || "").trim()) : [];
  if (visibleItems.length && options.asTags) {
    const tagList = document.createElement("div");
    tagList.className = "rule-tag-list";
    visibleItems.forEach((item) => {
      const tag = document.createElement("span");
      tag.className = `rule-tag ${options.risk ? "is-risk" : ""}`.trim();
      const label = document.createElement("span");
      label.textContent = item;
      tag.appendChild(label);
      if (options.removable && typeof options.onRemove === "function") {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "rule-tag-remove";
        removeBtn.textContent = "×";
        removeBtn.title = `删除标签：${item}`;
        removeBtn.addEventListener("click", () => options.onRemove(item));
        tag.appendChild(removeBtn);
      }
      tagList.appendChild(tag);
    });
    card.appendChild(tagList);
  } else if (visibleItems.length) {
    const list = document.createElement("ul");
    visibleItems.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    card.appendChild(list);
  }

  container.appendChild(card);
}

function renderJdRules(profile) {
  if (!elements.jdRulesGrid) return;
  const rules = profile?.rules || null;
  elements.jdRulesGrid.replaceChildren();

  if (!profile) {
    if (elements.jdRulesTitle) elements.jdRulesTitle.textContent = "JD 匹配规则";
    if (elements.jdRulesVersion) elements.jdRulesVersion.textContent = "当前岗位暂无 JD";
    appendJdRuleCard(elements.jdRulesGrid, "当前岗位暂无 JD 匹配规则", "AI 实习生不走 JD 匹配；其他岗位如果暂未配置 JD，会保持普通简历库排序。", [], { wide: true });
    return;
  }

  if (!rules) {
    if (elements.jdRulesTitle) elements.jdRulesTitle.textContent = `${profile.shortTitle || profile.title} 匹配规则`;
    if (elements.jdRulesVersion) elements.jdRulesVersion.textContent = "等待后端规则字段";
    appendJdRuleCard(elements.jdRulesGrid, "规则字段暂未返回", "当前页面已经选中了对应 JD，但后端服务进程还在运行旧版本接口，所以没有返回关键词、权重和分数区间。重启招聘智能体服务后会显示完整规则。", [
      `当前 JD：${profile.title || profile.shortTitle || profile.id}`,
      `适用简历库：${(profile.matchedJobTypes || []).join("、") || "-"}`,
    ], { wide: true });
    return;
  }

  if (elements.jdRulesTitle) elements.jdRulesTitle.textContent = `${profile.shortTitle || profile.title} 匹配规则`;
  if (elements.jdRulesVersion) {
    const scope = Array.isArray(rules.matchedJobTypes) && rules.matchedJobTypes.length ? rules.matchedJobTypes.join("、") : "当前 JD 岗位";
    elements.jdRulesVersion.textContent = `适用简历库：${scope}`;
  }

  appendJdRuleCard(elements.jdRulesGrid, rules.title || `${profile.title} JD 匹配规则`, rules.description, [
    `目标角色：${(rules.targetRoles || []).join("、") || "-"}`,
    `JD 来源岗位：${(rules.sourceJobNames || []).join("、") || "-"}`,
  ], { wide: true });

  appendJdRuleCard(
    elements.jdRulesGrid,
    `JD 标签总览${Array.isArray(rules.tags) ? `（${rules.tags.length}个）` : ""}`,
    "这些标签来自当前 JD 的核心岗位词、行业场景词、能力词、学历专业词、加分词和风险词，系统会按命中情况计算匹配分。",
    rules.tags || profile.tags || [],
    { wide: true, asTags: true }
  );

  if (Array.isArray(rules.synonymHints) && rules.synonymHints.length) {
    appendJdRuleCard(
      elements.jdRulesGrid,
      "同义词扩展",
      "匹配时会把常见同义表达一起纳入命中，减少候选人换一种写法导致的漏判。",
      rules.synonymHints,
      { wide: true }
    );
  }

  if (Array.isArray(rules.reviewChecklist) && rules.reviewChecklist.length) {
    appendJdRuleCard(
      elements.jdRulesGrid,
      "人工复核重点",
      "这些是分数之外需要人工确认的关键点，用来避免只看关键词造成误判。",
      rules.reviewChecklist,
      { wide: true }
    );
  }

  (rules.dimensions || []).forEach((dimension) => {
    appendJdRuleCard(
      elements.jdRulesGrid,
      `${dimension.name || "评分维度"} ${dimension.weight || ""}`,
      dimension.logic || "",
      dimension.tags || dimension.items || [],
      {
        asTags: true,
        risk: String(dimension.name || "").includes("风险"),
        removable: Boolean(dimension.key),
        onRemove: (tag) => updateJdTagOverride("remove", dimension.key, tag),
      }
    );
  });

  appendJdRuleCard(elements.jdRulesGrid, "岗位归属加权", "除关键词覆盖率外，会根据简历岗位/文件名做一次岗位归属增强。", rules.boosts || [], { wide: true });
  appendJdRuleCard(elements.jdRulesGrid, "分数参考区间", "系统按最终分数给出 A/B/C/D 建议等级。", rules.scoreBands || [], { wide: true });
  appendJdRuleCard(elements.jdRulesGrid, "保底与上限规则", "用于避免只命中边缘词但缺少核心相关性的简历排到过前。", rules.guardrails || [], { wide: true });
}

function setJdTagEditorStatus(text, state = "") {
  if (!elements.jdTagEditorStatus) return;
  elements.jdTagEditorStatus.textContent = text;
  elements.jdTagEditorStatus.className = state;
}

function replaceJdProfile(profile) {
  if (!profile?.id) return;
  jdProfiles = jdProfiles.map((item) => (item.id === profile.id ? profile : item));
  activeJdProfile = profile;
  syncJdProfileSelection();
}

async function updateJdTagOverride(action, group, tag) {
  const profile = activeJdProfile || getSelectedJdProfile();
  const cleanTag = String(tag || elements.jdTagInput?.value || "").trim();
  if (!profile?.id) {
    setJdTagEditorStatus("当前岗位暂无可编辑 JD", "is-error");
    return;
  }
  if (!group || !cleanTag) {
    setJdTagEditorStatus("请选择维度并输入标签", "is-error");
    return;
  }

  if (elements.addJdTagBtn) elements.addJdTagBtn.disabled = true;
  setJdTagEditorStatus(action === "add" ? "正在添加标签..." : "正在删除标签...", "is-working");

  try {
    const payload = await requestJson("/api/jd-match/tags", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        profileId: profile.id,
        group,
        tag: cleanTag,
      }),
    });
    replaceJdProfile(payload.profile);
    if (action === "add" && elements.jdTagInput) elements.jdTagInput.value = "";
    setJdTagEditorStatus(`${payload.message || "标签已保存"}，点击重新排名后应用到当前列表`, "is-done");
  } catch (error) {
    setJdTagEditorStatus(error.message || "标签保存失败", "is-error");
  } finally {
    if (elements.addJdTagBtn) elements.addJdTagBtn.disabled = false;
  }
}

function profileMatchesActiveJob(profile, jobType) {
  if (!profile || !jobType) return false;
  const exactScopes = [
    ...(Array.isArray(profile.matchedJobTypes) ? profile.matchedJobTypes : []),
    ...(Array.isArray(profile.sourceJobNames) ? profile.sourceJobNames : []),
  ];
  if (exactScopes.some((item) => normalizeJobType(item) === jobType || item === jobType)) return true;

  const fuzzyScopes = [profile.title, profile.shortTitle, ...(Array.isArray(profile.targetRoles) ? profile.targetRoles : [])]
    .filter(Boolean)
    .map(String);
  return fuzzyScopes.some((item) => item.includes(jobType) || jobType.includes(item));
}

function getJdProfileForActiveJob() {
  const activeJobType = getActiveJobType();
  if (!activeJobType || activeJobType === AI_INTERNSHIP_JOB_TYPE) return null;
  const preferredIds = JD_PROFILE_PRIORITY_BY_JOB_TYPE[activeJobType] || [];
  for (const id of preferredIds) {
    const profile = jdProfiles.find((item) => item.id === id);
    if (profile) return profile;
  }
  return jdProfiles.find((profile) => profileMatchesActiveJob(profile, activeJobType)) || null;
}

function getSelectedJdProfile() {
  const activeProfile = getJdProfileForActiveJob();
  if (activeProfile) return activeProfile;
  if (!getActiveJobType()) return null;
  return jdProfiles.find((profile) => profile.id === elements.jdProfileSelect?.value) || null;
}

function syncJdProfileSelection() {
  const activeJobType = getActiveJobType();
  const activeProfile = getJdProfileForActiveJob();
  const selected = activeProfile || getSelectedJdProfile();
  activeJdProfile = selected;

  if (elements.jdProfileSelect && selected) elements.jdProfileSelect.value = selected.id;
  if (elements.jdProfileControl) elements.jdProfileControl.hidden = true;
  if (elements.jdTagEditor) elements.jdTagEditor.hidden = !selected;
  if (elements.runJdMatchBtn) {
    elements.runJdMatchBtn.disabled = Boolean(activeJobType && !activeProfile) || !activeJobType;
    elements.runJdMatchBtn.textContent = activeJobType && activeProfile ? `按${activeJobType}JD重新排名` : "按当前岗位 JD 重新排名";
  }

  renderJdRules(selected);
  if (elements.jdSourceBox) {
    if (selected) {
      const sources = Array.isArray(selected.sources) ? selected.sources.map((source) => source.name).join("、") : "公开招聘页";
      elements.jdSourceBox.textContent = `JD 来源：${sources}`;
    } else {
      elements.jdSourceBox.textContent = activeJobType ? "当前岗位暂无 JD 来源" : "进入具体岗位后自动使用对应 JD";
    }
  }
  if (elements.jdMatchSummary) {
    if (activeJobType && activeProfile) {
      elements.jdMatchSummary.textContent = `当前岗位：${activeJobType}，已自动使用 ${activeProfile.shortTitle || activeProfile.title}`;
    } else if (!activeJobType) {
      elements.jdMatchSummary.textContent = "进入具体岗位后可按当前岗位 JD 重新排名";
    }
  }
  return selected;
}

async function loadJdProfiles() {
  const payload = await requestJson("/api/jd-match/profiles");
  jdProfiles = payload.profiles || [];

  if (elements.jdProfileSelect) {
    const currentValue = elements.jdProfileSelect.value;
    const fragment = document.createDocumentFragment();
    jdProfiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.shortTitle || profile.title;
      fragment.appendChild(option);
    });
    elements.jdProfileSelect.replaceChildren(fragment);
    if (currentValue && jdProfiles.some((profile) => profile.id === currentValue)) {
      elements.jdProfileSelect.value = currentValue;
    }
  }

  syncJdProfileSelection();
  return jdProfiles;
}
function formatJdBreakdown(result = {}) {
  const breakdown = result.breakdown || {};
  const boost = Number(breakdown.roleBoost || 0) + Number(breakdown.focusBoost || 0);
  const parts = [
    `核心${Number(breakdown.core || 0)}`,
    `行业${Number(breakdown.industry || 0)}`,
    `能力${Number(breakdown.capability || 0)}`,
    `学历${Number(breakdown.education || 0)}`,
    `加分${Number(breakdown.bonus || 0)}`,
  ];
  if (boost) parts.push(`归属+${boost}`);
  if (Number(breakdown.riskPenalty || 0)) parts.push(`风险-${Number(breakdown.riskPenalty || 0)}`);
  if (Array.isArray(breakdown.capReasons) && breakdown.capReasons.length) parts.push("已限分");
  return parts.join(" / ");
}
function renderJdMatchResults(payload = {}) {
  const profile = payload.profile || null;
  const results = Array.isArray(payload.results) ? payload.results : [];
  activeJdProfile = profile;
  jdMatchResults = new Map(results.map((result) => [result.resumeId, result]));

  if (elements.jdMatchSummary) {
    const counts = payload.counts || {};
    elements.jdMatchSummary.textContent = profile
      ? `${profile.shortTitle || profile.title}：共 ${counts.total || results.length} 份，A ${counts.A || 0}，B ${counts.B || 0}，C ${counts.C || 0}，D ${counts.D || 0}`
      : "等待匹配";
  }

  if (elements.jdSourceBox && profile) {
    const sources = Array.isArray(profile.sources) ? profile.sources.map((source) => source.name).join("、") : "公开招聘页";
    elements.jdSourceBox.textContent = `JD 来源：${sources}`;
  }

  const fragment = document.createDocumentFragment();
  const topResults = results.slice(0, 12);
  if (!topResults.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "暂无匹配结果";
    row.appendChild(cell);
    fragment.appendChild(row);
  } else {
    topResults.forEach((result, index) => {
      const row = document.createElement("tr");
      setCellText(row, String(index + 1));
      setCellText(row, result.name || result.phone || "-");
      setCellText(row, result.jobType || "-");
      const scoreCell = document.createElement("td");
      const scoreValue = document.createElement("strong");
      scoreValue.textContent = `${result.score}%`;
      const scoreDetail = document.createElement("span");
      scoreDetail.className = "jd-breakdown";
      scoreDetail.textContent = formatJdBreakdown(result);
      const capReasons = result.breakdown?.capReasons || [];
      if (capReasons.length) scoreCell.title = capReasons.join("\n");
      scoreCell.append(scoreValue, scoreDetail);
      row.appendChild(scoreCell);

      const levelCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `jd-level ${getJdLevelClass(result.level)}`;
      badge.textContent = result.level || "-";
      levelCell.appendChild(badge);
      row.appendChild(levelCell);

      const keywordCell = document.createElement("td");
      keywordCell.textContent = (result.matchedKeywords || []).slice(0, 8).join("、") || "-";
      row.appendChild(keywordCell);
      setCellText(row, result.suggestion || "-");
      fragment.appendChild(row);
    });
  }
  elements.jdResultsBody?.replaceChildren(fragment);
  refreshResumeView();
}

async function runJdMatch() {
  const profile = syncJdProfileSelection();
  const profileId = profile?.id;
  if (!profileId) {
    if (elements.jdMatchSummary) elements.jdMatchSummary.textContent = "当前岗位暂无可用 JD 匹配规则";
    return;
  }

  setStatus("JD\u5339\u914d\u4e2d", "is-working");
  if (elements.runJdMatchBtn) elements.runJdMatchBtn.disabled = true;
  if (elements.jdMatchSummary) elements.jdMatchSummary.textContent = "正在读取简历库并计算 JD 匹配...";
  try {
    const payload = await requestJson("/api/jd-match/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    renderJdMatchResults(payload);
    if (elements.recordSortSelect) elements.recordSortSelect.value = "jd-score";
    recordsPage = 1;
    refreshResumeView();
    setStatus("JD\u5339\u914d\u5b8c\u6210", "is-done");
  } catch (error) {
    if (elements.jdMatchSummary) elements.jdMatchSummary.textContent = error.message || "JD 匹配失败";
    setStatus("JD\u5339\u914d\u5931\u8d25", "");
  } finally {
    syncJdProfileSelection();
  }
}

function renderResumeTable(resumes) {
  renderResumeTableHeader();
  const fragment = document.createDocumentFragment();
  const visibleFields = getVisibleResumeTableFields();

  if (!resumes.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = getResumeTableColumnCount();
    cell.textContent = "暂无简历记录";
    row.appendChild(cell);
    fragment.appendChild(row);
    elements.tableBody.replaceChildren(fragment);
    if (elements.recordsPageSummary) elements.recordsPageSummary.textContent = "第 1 / 1 页，共 0 条";
    if (elements.recordsPrevBtn) elements.recordsPrevBtn.disabled = true;
    if (elements.recordsNextBtn) elements.recordsNextBtn.disabled = true;
    return;
  }

  const rankedResumes = getDisplaySortedResumes(resumes);
  const totalPages = Math.max(1, Math.ceil(rankedResumes.length / RECORDS_PAGE_SIZE));
  recordsPage = Math.min(Math.max(1, recordsPage), totalPages);
  const pageStartIndex = (recordsPage - 1) * RECORDS_PAGE_SIZE;
  const pageItems = rankedResumes.slice(pageStartIndex, pageStartIndex + RECORDS_PAGE_SIZE);

  if (elements.recordsPageSummary) {
    const start = pageStartIndex + 1;
    const end = Math.min(pageStartIndex + RECORDS_PAGE_SIZE, rankedResumes.length);
    elements.recordsPageSummary.textContent = `第 ${recordsPage} / ${totalPages} 页，显示 ${start}-${end}，共 ${rankedResumes.length} 条`;
  }
  if (elements.recordsPrevBtn) elements.recordsPrevBtn.disabled = recordsPage <= 1;
  if (elements.recordsNextBtn) elements.recordsNextBtn.disabled = recordsPage >= totalPages;

  pageItems.forEach((resume, index) => {
    const row = document.createElement("tr");
    if (activeDetailResume?.id === resume.id) row.classList.add("is-active-detail");
    setCellText(row, String(pageStartIndex + index + 1));
    visibleFields.forEach((field) => appendResumeFieldCell(row, field, resume));

    const actionCell = document.createElement("td");
    actionCell.className = "candidate-action-cell";
    const actionGroup = document.createElement("div");
    actionGroup.className = "candidate-action-group";
    const button = document.createElement("button");
    button.className = "ghost-btn small";
    button.type = "button";
    button.textContent = "查看";
    button.addEventListener("click", () => openResumeEditor(resume.id, { scrollTarget: "pdf" }));
    actionGroup.appendChild(button);

    const chatButton = document.createElement("button");
    chatButton.className = "ghost-btn small";
    chatButton.type = "button";
    chatButton.textContent = "查看聊天";
    chatButton.title = "查看聊天记录";
    chatButton.addEventListener("click", () => openResumeConversation(resume.id, chatButton));
    actionGroup.appendChild(chatButton);

    const deleteButton = document.createElement("button");
    deleteButton.className = "ghost-btn small danger";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteResumeRecord(resume));
    actionGroup.appendChild(deleteButton);

    actionCell.appendChild(actionGroup);
    row.appendChild(actionCell);
    fragment.appendChild(row);
  });

  elements.tableBody.replaceChildren(fragment);
}

function closeResumeConversationDialog() {
  const dialog = document.querySelector("#resumeConversationDialog");
  if (dialog) dialog.remove();
  document.documentElement.classList.remove("details-dialog-open");
  document.body.classList.remove("details-dialog-open");
}

function createResumeDialogueMessage(message = {}) {
  const sender = ["me", "other", "system"].includes(String(message.sender || "")) ? String(message.sender) : "other";
  const item = document.createElement("article");
  item.className = `dialogue-message is-${sender}`;

  const meta = document.createElement("span");
  meta.textContent = [
    sender === "me" ? "我方" : sender === "system" ? "系统" : "候选人",
    message.time || "",
    message.status || "",
  ]
    .filter(Boolean)
    .join(" · ");

  const text = document.createElement("p");
  text.textContent = message.text || "";
  item.append(meta, text);
  return item;
}

function showResumeConversationDialog(payload = {}) {
  closeResumeConversationDialog();
  const resume = payload.resume || {};
  const conversation = payload.conversation || {};
  const match = payload.match || {};
  const messages = Array.isArray(conversation.recentMessages) ? conversation.recentMessages : [];

  const backdrop = document.createElement("div");
  backdrop.id = "resumeConversationDialog";
  backdrop.className = "details-dialog-backdrop";
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeResumeConversationDialog();
  });

  const dialog = document.createElement("section");
  dialog.className = "details-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const head = document.createElement("div");
  head.className = "details-dialog-head";
  const title = document.createElement("h2");
  title.textContent = `${resume.name || match.candidateName || "候选人"}的聊天记录`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "ghost-btn small";
  closeBtn.type = "button";
  closeBtn.textContent = "关闭";
  closeBtn.addEventListener("click", closeResumeConversationDialog);
  head.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "details-dialog-body";
  const content = document.createElement("div");
  content.className = "dialogue-content";

  const info = document.createElement("section");
  info.className = "dialogue-section";
  const infoTitle = document.createElement("strong");
  infoTitle.textContent = payload.matched ? "匹配到的自动化对话" : "未匹配到自动化对话";
  const infoList = document.createElement("div");
  infoList.className = "dialogue-list";
  [
    `简历：${resume.name || "-"} · ${resume.jobType || "-"}`,
    payload.matched ? `对话：${match.candidateName || "-"} · ${match.appliedPosition || "-"}` : "没有找到同名或同文件名的自动化对话记录",
    match.source ? `来源：${match.source}` : "",
    match.updatedAt ? `最近记录：${match.updatedAt}` : "",
    Array.isArray(match.reasons) && match.reasons.length ? `匹配依据：${match.reasons.join("、")}` : "",
  ]
    .filter(Boolean)
    .forEach((line) => {
      const item = document.createElement("p");
      item.textContent = line;
      infoList.appendChild(item);
    });
  info.append(infoTitle, infoList);

  const chat = document.createElement("section");
  chat.className = "dialogue-chat-section";
  const chatTitle = document.createElement("strong");
  chatTitle.textContent = "对话内容";
  const chatWindow = document.createElement("div");
  chatWindow.className = "dialogue-chat-window";
  if (messages.length) {
    chatWindow.replaceChildren(...messages.map(createResumeDialogueMessage));
  } else {
    const empty = document.createElement("p");
    empty.className = "dialogue-empty";
    empty.textContent = "当前没有可展示的聊天记录。自动化读取过该候选人对话后，这里会显示。";
    chatWindow.appendChild(empty);
  }
  chat.append(chatTitle, chatWindow);

  const rawHeader = conversation.counterpart?.rawHeader || conversation.summary || "";
  if (rawHeader) {
    const raw = document.createElement("details");
    raw.className = "dialogue-raw";
    const summary = document.createElement("summary");
    summary.textContent = "查看原始摘要";
    const pre = document.createElement("pre");
    pre.textContent = rawHeader;
    raw.append(summary, pre);
    content.append(info, chat, raw);
  } else {
    content.append(info, chat);
  }

  body.appendChild(content);
  dialog.append(head, body);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  document.documentElement.classList.add("details-dialog-open");
  document.body.classList.add("details-dialog-open");
}

async function openResumeConversation(id, triggerButton = null) {
  if (!id) return;
  if (document.querySelector("#resumeConversationDialog")) return;
  const originalText = triggerButton?.textContent || "";
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = "加载中";
  }
  setStatus("正在读取聊天记录", "is-working");
  try {
    if (!resumeConversationRequests.has(id)) {
      resumeConversationRequests.set(
        id,
        requestJson(`/api/resumes/${id}/conversation`).finally(() => {
          resumeConversationRequests.delete(id);
        })
      );
    }
    const payload = await resumeConversationRequests.get(id);
    if (document.querySelector("#resumeConversationDialog")) return;
    showResumeConversationDialog(payload);
    setStatus(payload.matched ? "已打开聊天记录" : "暂无匹配聊天记录", payload.matched ? "is-done" : "");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "读取聊天记录失败");
  } finally {
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = originalText || "查看聊天";
    }
  }
}

async function loadResumeList() {
  const payload = await requestJson("/api/resumes");
  const resumes = payload.resumes || [];
  resumeCache = resumes;
  refreshResumeView();
  return resumes;
}

async function deleteResumeRecord(resume) {
  if (!resume?.id) return;
  const label = resume.name || resume.phone || resume.fileName || "该候选人";
  const confirmed = window.confirm(`确定删除 ${label} 吗？该操作会从简历库移除记录，并删除已保存的 PDF。`);
  if (!confirmed) return;

  setStatus("正在删除简历", "is-working");
  try {
    const payload = await requestJson(`/api/resumes/${resume.id}`, {
      method: "DELETE",
    });
    resumeCache = payload.resumes || resumeCache.filter((item) => item.id !== resume.id);

    if (activeDetailResume?.id === resume.id) {
      elements.editPanel.hidden = true;
      elements.pdfPages.replaceChildren();
      activeDetailResume = null;
      syncResumeDetailNavControls();
    }

    refreshResumeView();
    setStatus("简历已删除", "is-done");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "删除失败");
  }
}

function collectCheckedValues(name) {
  return [...document.querySelectorAll(`input[name='${name}']:checked`)].map((input) => input.value);
}

function normalizeFeedbackTagOptions(options = {}) {
  const fallback = DEFAULT_FEEDBACK_TAG_OPTIONS;
  return {
    positiveTags: Array.isArray(options.positiveTags) && options.positiveTags.length ? options.positiveTags : fallback.positiveTags,
    negativeTags: Array.isArray(options.negativeTags) && options.negativeTags.length ? options.negativeTags : fallback.negativeTags,
    dimensions: Array.isArray(options.dimensions) && options.dimensions.length ? options.dimensions : fallback.dimensions,
  };
}

function mergeTagOptionsWithSelected(options = [], selectedValues = []) {
  const seen = new Set();
  return [...options, ...selectedValues]
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function renderCheckboxTagGroup(container, title, name, options = [], selectedValues = []) {
  if (!container) return;
  const selected = new Set(selectedValues);
  const values = mergeTagOptionsWithSelected(options, selectedValues);
  container.replaceChildren();

  const titleNode = document.createElement("span");
  titleNode.textContent = title;
  container.appendChild(titleNode);

  values.forEach((value) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.value = value;
    input.checked = selected.has(value);
    label.append(input, value);
    container.appendChild(label);
  });
}

function renderFeedbackTagOptions(options = {}, selected = {}) {
  const normalized = normalizeFeedbackTagOptions(options);
  currentFeedbackTagOptions = normalized;
  renderCheckboxTagGroup(elements.positiveTagsGroup, "正向标签", "positiveTags", normalized.positiveTags, selected.positiveTags || collectCheckedValues("positiveTags"));
  renderCheckboxTagGroup(elements.negativeTagsGroup, "负向标签", "negativeTags", normalized.negativeTags, selected.negativeTags || collectCheckedValues("negativeTags"));
  renderCheckboxTagGroup(elements.dimensionsGroup, "影响维度", "dimensions", normalized.dimensions, selected.dimensions || collectCheckedValues("dimensions"));
}

async function loadFeedbackTagOptions(jobType, selected = {}) {
  const normalizedJobType = normalizeJobType(jobType || getActiveJobType() || RESUME_LIBRARY_JOB_TYPES[0]);
  try {
    const payload = await requestJson(`/api/scoring-rules?jobType=${encodeURIComponent(normalizedJobType)}`);
    renderFeedbackTagOptions(payload.feedbackTags || DEFAULT_FEEDBACK_TAG_OPTIONS, selected);
  } catch (error) {
    console.error(error);
    renderFeedbackTagOptions(DEFAULT_FEEDBACK_TAG_OPTIONS, selected);
  }
}

function setCheckedValues(name, values = []) {
  const selected = new Set(values);
  document.querySelectorAll(`input[name='${name}']`).forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function formatRuleSuggestionText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => formatRuleSuggestionText(item))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value !== "object") return String(value || "").trim();

  const lines = [];
  const primary =
    value.suggestion ||
    value.rule ||
    value.change ||
    value.title ||
    value.summary ||
    value.description ||
    value.content ||
    value.text;
  const dimension = value.dimension || value.category || value.field || value.target || value.scope;
  const reason = value.reason || value.rationale || value.why;
  const evidence = value.evidence || value.example || value.examples || value.case;
  const before = value.before || value.oldRule || value.from;
  const after = value.after || value.newRule || value.to;
  const score = value.scoreDelta || value.weight || value.points || value.score;

  if (primary && primary !== value) lines.push(formatRuleSuggestionText(primary));
  if (dimension) lines.push(`维度：${formatRuleSuggestionText(dimension)}`);
  if (reason) lines.push(`原因：${formatRuleSuggestionText(reason)}`);
  if (evidence) lines.push(`依据：${formatRuleSuggestionText(evidence)}`);
  if (before || after) {
    lines.push(`调整：${formatRuleSuggestionText(before) || "-"} -> ${formatRuleSuggestionText(after) || "-"}`);
  }
  if (score) lines.push(`分值/权重：${formatRuleSuggestionText(score)}`);

  if (lines.length) return lines.filter(Boolean).join("\n");

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "").trim();
  }
}

function formatRuleSuggestionBullet(value) {
  const text = formatRuleSuggestionText(value);
  return text ? `- ${text.replace(/\n/g, "\n  ")}` : "";
}

function renderFeedbackReview(review) {
  if (!review) {
    elements.feedbackReview.textContent = "暂无审查结果";
    return;
  }

  const suggestions = Array.isArray(review.suggestedRuleChanges) && review.suggestedRuleChanges.length
    ? review.suggestedRuleChanges.map(formatRuleSuggestionBullet).filter(Boolean).join("\n")
    : "- 暂无规则调整建议";

  elements.feedbackReview.textContent = [
    `冲突等级：${review.conflictLevel || "low"}`,
    `审查摘要：${review.summary || "-"}`,
    `评分诊断：${review.scoreDiagnosis || "-"}`,
    "规则调整建议：",
    suggestions,
    "需要人工确认：是",
  ].join("\n");
}

function getRuleStatusClass(status) {
  if (status === "adopted") return "is-done";
  if (status === "rejected") return "is-failed";
  return "is-working";
}

function renderScoringRules(payload = {}) {
  if (!elements.scoringRulesGrid || !elements.adoptedRulesList) return;

  const rules = payload.rules || {};
  const versionMeta = payload.versionMeta || {};
  const dimensions = Array.isArray(rules.dimensions) ? rules.dimensions : [];
  const adoptedRules = Array.isArray(payload.adoptedRules) ? payload.adoptedRules : [];
  const scoreBands = Array.isArray(rules.scoreBands) ? rules.scoreBands : [];
  const payloadJobType = normalizeJobType(payload.jobType || getActiveJobType() || RESUME_LIBRARY_JOB_TYPES[0]);

  if (payload.feedbackTags) {
    currentFeedbackTagOptions = normalizeFeedbackTagOptions(payload.feedbackTags);
    if (!activeDetailResume || normalizeJobType(activeDetailResume.jobType) === payloadJobType) {
      renderFeedbackTagOptions(currentFeedbackTagOptions);
    }
  }

  elements.scoringRulesTitle.textContent = `${payload.jobType || getActiveJobType() || "当前岗位"}评分细则`;
  elements.scoringRulesVersion.textContent = versionMeta.displayName
    ? `${versionMeta.displayName} · ${payload.scoringVersion || "-"}`
    : payload.scoringVersion || "-";
  elements.scoringRulesGrid.replaceChildren();

  const introCard = document.createElement("article");
  introCard.className = "scoring-rule-card is-wide";
  const introTitle = document.createElement("h3");
  introTitle.textContent = rules.title || "当前岗位暂未配置独立匹配度评分";
  const introText = document.createElement("p");
  introText.textContent = [
    rules.description || "该岗位当前只提取姓名、电话、学校、学校层次、毕业时间等基础信息。",
    versionMeta.ruleScope ? `规则范围：${versionMeta.ruleScope}。` : "",
  ]
    .filter(Boolean)
    .join(" ");
  introCard.append(introTitle, introText);
  elements.scoringRulesGrid.appendChild(introCard);

  dimensions.forEach((dimension) => {
    const card = document.createElement("article");
    card.className = "scoring-rule-card";

    const heading = document.createElement("h3");
    heading.textContent = `${dimension.name || "评分维度"} ${dimension.weight || ""}`;
    card.appendChild(heading);

    if (dimension.logic) {
      const logic = document.createElement("p");
      logic.textContent = dimension.logic;
      card.appendChild(logic);
    }

    if (Array.isArray(dimension.items) && dimension.items.length) {
      const list = document.createElement("ul");
      dimension.items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.appendChild(li);
      });
      card.appendChild(list);
    }

    elements.scoringRulesGrid.appendChild(card);
  });

  elements.adoptedRulesList.replaceChildren();
  if (!adoptedRules.length) {
    const li = document.createElement("li");
    li.textContent = "暂无已采纳补充规则";
    elements.adoptedRulesList.appendChild(li);
    return;
  }

  adoptedRules.forEach((rule) => {
    const li = document.createElement("li");
    li.textContent = formatRuleSuggestionText(rule.suggestion || rule) || "-";
    elements.adoptedRulesList.appendChild(li);
  });
}

async function loadScoringRules() {
  if (!elements.scoringRulesBox) return;
  const jobType = getActiveJobType();
  const query = jobType ? `?jobType=${encodeURIComponent(jobType)}` : "";
  const payload = await requestJson(`/api/scoring-rules${query}`);
  renderScoringRules(payload);
}

async function showDetailVersionRules() {
  if (!activeDetailResume) return;
  setRulePanelExpanded(true);
  elements.scoringRulesBox.hidden = false;
  elements.scoringRulesBtn.setAttribute("aria-expanded", "true");
  elements.scoringRulesBtn.textContent = "收起评分细则";
  elements.scoringRulesGrid.textContent = "正在加载该候选人的评分版本...";
  elements.adoptedRulesList.replaceChildren();
  const loading = document.createElement("li");
  loading.textContent = "正在加载该版本已应用的补充规则...";
  elements.adoptedRulesList.appendChild(loading);

  const query = new URLSearchParams({
    jobType: normalizeJobType(activeDetailResume.jobType),
    version: activeDetailResume.scoringVersion || "",
  });

  try {
    const payload = await requestJson(`/api/scoring-rules?${query.toString()}`);
    renderScoringRules(payload);
    elements.rulePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    elements.scoringRulesGrid.textContent = error.message || "该版本评分细则加载失败";
  }
}

async function toggleScoringRules() {
  if (!elements.scoringRulesBtn || !elements.scoringRulesBox) return;
  const nextVisible = elements.scoringRulesBox.hidden;
  elements.scoringRulesBox.hidden = !nextVisible;
  elements.scoringRulesBtn.setAttribute("aria-expanded", String(nextVisible));
  elements.scoringRulesBtn.textContent = nextVisible ? "收起评分细则" : "当前评分细则";

  if (!nextVisible) return;

  elements.scoringRulesGrid.textContent = "正在加载当前评分细则...";
  elements.adoptedRulesList.replaceChildren();
  const loading = document.createElement("li");
  loading.textContent = "正在加载已采纳补充规则...";
  elements.adoptedRulesList.appendChild(loading);

  try {
    await loadScoringRules();
  } catch (error) {
    console.error(error);
    elements.scoringRulesGrid.textContent = error.message || "评分细则加载失败";
  }
}

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
      canvas.title = "点击复制本地 PDF 文件";
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.maxWidth = "100%";
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      elements.pdfPages.appendChild(canvas);
      await page.render({ canvasContext: context, viewport }).promise;
      canvas.addEventListener("click", copyActiveResumePdf);
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
  if (activeAutomationPlatform === "boss") {
    processBossMessages();
    const state = getProcessMessagesState();
    if (!state.running || state.paused) {
      await startOrPauseProcessMessages();
    }
    return;
  }
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
  elements.bossAutomationBtn.addEventListener("click", startBossAutomation);
}
elements.processBossMessagesBtn?.addEventListener("click", handleProcessAutomationAction);
elements.startProcessMessagesBtn?.addEventListener("click", handleStartProcessAutomation);
elements.proactiveBossContactBtn?.addEventListener("click", handleProactiveAutomationAction);
elements.startProactiveContactBtn?.addEventListener("click", handleStartProactiveAutomation);
elements.job51QuickAutomationBtn?.addEventListener("click", () => openQuickAutomationPlatform("job51"));
elements.zhilianQuickAutomationBtn?.addEventListener("click", () => openQuickAutomationPlatform("zhilian"));
elements.oneClickLaunchBrowserBtn?.addEventListener("click", oneClickLaunchAutomationBrowser);
elements.job51ProcessMessagesBtn?.addEventListener("click", () => startOrPausePlatformAutomation("job51", "process"));
elements.job51ProactiveContactBtn?.addEventListener("click", () => startOrPausePlatformAutomation("job51", "proactive"));
elements.zhilianProcessMessagesBtn?.addEventListener("click", () => startOrPausePlatformAutomation("zhilian", "process"));
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
