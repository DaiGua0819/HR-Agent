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
  browserLaunchButtons: [...document.querySelectorAll("[data-browser-launch-platform][data-browser-launch-account]")],
  oneClickLaunchBrowserBtn: document.querySelector("#oneClickLaunchBrowserBtn"),
  bossBrowserSummary: document.querySelector("#bossBrowserSummary"),
  automation24hPanel: document.querySelector("#automation24hPanel"),
  automation24hToggleBtn: document.querySelector("#automation24hToggleBtn"),
  automation24hSummary: document.querySelector("#automation24hSummary"),
  automation24hTargets: document.querySelector("#automation24hTargets"),
  automation24hLogDateInput: document.querySelector("#automation24hLogDateInput"),
  automation24hLogs: document.querySelector("#automation24hLogs"),
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
  dailyPiePanel: document.querySelector("#dailyPiePanel"),
  dailyPiePlatformSelect: document.querySelector("#dailyPiePlatformSelect"),
  dailyPieAccountSelect: document.querySelector("#dailyPieAccountSelect"),
  dailyPieJobSelect: document.querySelector("#dailyPieJobSelect"),
  dailyPieRefreshBtn: document.querySelector("#dailyPieRefreshBtn"),
  dailyPieChart: document.querySelector("#dailyPieChart"),
  dailyPieLegend: document.querySelector("#dailyPieLegend"),
  dailyPieMeta: document.querySelector("#dailyPieMeta"),
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
let automationBrowserStatusTimer = 0;
let automation24hStatusTimer = 0;
let automation24hLogsTimer = 0;
let automation24hLastStatus = null;
let automation24hStatusBusy = false;
let automation24hLogsBusy = false;
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
let dailyPieRecords = [];
let dailyPieRequestKey = "";
let dailyPieLoadingKey = "";
let dailyPieRequestSeq = 0;
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

const DAILY_PIE_DEFAULT_PLATFORMS = ["boss", "job51", "zhilian"];
const DAILY_PIE_DEFAULT_ACCOUNTS = ["boss_a", "boss_b"];
const DAILY_PIE_COLORS = ["#8aaeea", "#efbd7d", "#86cfa9", "#e79ab8", "#aaa0df", "#7fcbd7", "#d4c77d", "#ed9990", "#b5bdc8"];

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
    localRunPending: false,
    externalBusy: false,
    lastBusySyncAt: 0,
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

