(function () {
  "use strict";

const RESUME_LIBRARY_JOB_TYPES = [
  "AI应用开发实习生",
  "应用技术经理（工业涂料领域）",
  "膨润土销售人员",
  "销售管培生",
  "HRBP",
  "人力资源管培生",
  "国际业务管培生",
  "销售工程师（石油钻井泥浆膨润土）_湖州",
  "电气工程师",
];

const RESUME_JOB_DISPLAY_LABELS = {
  "AI应用开发实习生": "AI实习生",
  "应用技术经理（工业涂料领域）": "应用技术",
  "人力资源管培生": "人资管培",
  "销售工程师（石油钻井泥浆膨润土）_湖州": "石油销售",
};

const LEGACY_JOB_TYPES = [
  "AI实习生",
  "AI应用开发工程师",
  "应用技术",
  "应用技术管培生",
  "膨润土销售",
  "石油钻井销售",
  "石油销售",
  "外贸销售",
  "HR",
  "招聘专员",
  "人力资源实习生",
  "内容运营",
  "沙粉销售",
];

const JOB_TYPES = [
  ...RESUME_LIBRARY_JOB_TYPES,
  ...LEGACY_JOB_TYPES,
];

const AI_INTERNSHIP_JOB_TYPE = "AI应用开发实习生";

const JD_PROFILE_PRIORITY_BY_JOB_TYPE = {
  "应用技术经理（工业涂料领域）": ["industrial_coating_application", "bentonite_application"],
  "销售管培生": ["sales_trainee", "bentonite_sales"],
  "膨润土销售人员": ["bentonite_sales"],
  "HRBP": ["hrbp"],
  "人力资源管培生": ["hrbp"],
  "国际业务管培生": ["international_business_trainee"],
  "销售工程师（石油钻井泥浆膨润土）_湖州": ["oil_drilling_sales"],
  "电气工程师": ["electrical_engineer"],
  "AI应用开发实习生": [],
};
const FEEDBACK_DECISION_LABELS = {
  pending: "待定",
  suitable: "合适",
  interview: "进入面试",
  unsuitable: "不合适",
};

const BATCH_STATUS_LABELS = {
  pending: "等待",
  parsing: "解析中",
  saved: "已入库",
  duplicate: "已上传过",
  failed: "失败",
  cancelled: "已取消",
};

const RULE_STATUS_LABELS = {
  pending: "待审核",
  adopted: "已采纳",
  rejected: "已拒绝",
};

const DEFAULT_FEEDBACK_TAG_OPTIONS = {
  positiveTags: ["基础信息完整", "岗位归类可信", "经历可复核", "表达清楚"],
  negativeTags: ["基础信息不足", "岗位归类存疑", "经历不清楚", "需要人工复核"],
  dimensions: ["岗位归类", "基础信息", "经历完整度", "表达质量", "人工复核"],
};

const BATCH_PAGE_SIZE = 10;
const RECORDS_PAGE_SIZE = 10;
const BATCH_JOB_STORAGE_KEY = "resumeAgent.currentBatchJobId";
const BOSS_AUTOMATION_BASE_SPEED_MULTIPLIER = 1.75;
const BOSS_AUTOMATION_SPEED_STORAGE_KEY = "resumeAgent.bossAutomationSpeedFactor";
const BOSS_AUTOMATION_ACCOUNT_STORAGE_KEY = "resumeAgent.bossAutomationAccountId";
const BOSS_PROACTIVE_RULE_STORAGE_KEY = "resumeAgent.proactiveContactRules";
const BOSS_PROACTIVE_RULE_PRESET_VERSION = "20260526-explicit-position-rules-v3";
const BOSS_AUTOMATION_SPEED_VALUES = [1, 1.5, 1.75, 2];
const BOSS_PROACTIVE_POSITION_OPTIONS = [
  { value: "应用技术经理（工业涂料领域）", label: "应用技术经理（工业涂料领域）" },
  { value: "膨润土销售人员", label: "膨润土销售人员" },
  { value: "销售管培生", label: "销售管培生" },
  { value: "hrbp", label: "HRBP" },
  { value: "国际业务管培生", label: "国际业务管培生" },
  { value: "销售工程师（石油钻井泥浆膨润土）_湖州", label: "销售工程师（石油钻井泥浆膨润土）_湖州" },
  { value: "电气工程师", label: "电气工程师" },
];
const BOSS_PROACTIVE_DEFAULT_RULES_BY_POSITION = {
  "应用技术经理（工业涂料领域）": {
    mode: "custom",
    profile: "application_technology",
    requiredChecks: { education: true, age: true, keyword: true },
    minEducation: "bachelor",
    maxAge: 45,
    keywordMode: "any",
    keywords: ["流变助剂", "膨润土", "工业涂料", "涂料研发", "涂料工程师"],
    unknownPolicy: "skip",
  },
  "膨润土销售人员": {
    mode: "custom",
    profile: "bentonite_sales",
    requiredChecks: { education: true, age: true, keyword: true },
    minEducation: "college",
    maxAge: 35,
    keywordMode: "any",
    keywords: ["涂料", "膨润土", "流变助剂"],
    unknownPolicy: "skip",
  },
  "销售管培生": {
    mode: "custom",
    requiredChecks: { education: true, age: true, keyword: false },
    minEducation: "college",
    maxAge: 25,
    keywordMode: "any",
    keywords: [],
    unknownPolicy: "skip",
  },
  "hrbp": {
    mode: "custom",
    profile: "hrbp",
    requiredChecks: { education: true, age: true, keyword: true },
    minEducation: "bachelor",
    maxAge: 30,
    keywordMode: "any",
    keywords: ["人力资源管理", "人力资源", "HRBP", "猎头", "招聘", "劳动与社会保障", "劳动关系"],
    unknownPolicy: "skip",
  },
  "国际业务管培生": {
    mode: "custom",
    profile: "international_business",
    requiredChecks: { education: true, age: true, keyword: true },
    minEducation: "bachelor",
    maxAge: 25,
    keywordMode: "any",
    keywords: ["国际贸易", "英语", "俄语", "翻译", "理工科", "英语六级", "CET-6"],
    unknownPolicy: "skip",
  },
  "销售工程师（石油钻井泥浆膨润土）_湖州": {
    mode: "custom",
    requiredChecks: { education: true, age: true, keyword: true },
    minEducation: "college",
    maxAge: 45,
    keywordMode: "any",
    keywords: ["石油助剂", "钻井泥浆", "油服", "石油钻井", "膨润土"],
    unknownPolicy: "skip",
  },
  "电气工程师": {
    mode: "custom",
    profile: "electrical",
    requiredChecks: { education: true, age: true, keyword: true },
    minEducation: "bachelor",
    maxAge: 35,
    keywordMode: "all",
    keywords: ["电气工程", "自动化", "PLC"],
    unknownPolicy: "skip",
  },
};
const BOSS_SUMMARY_METRICS_BY_MODE = {
  process: ["processed", "sentCompanyInfo", "requestedResume", "userQuestions", "savedResumes"],
  proactive: ["proactiveOpened", "proactiveGreeted", "proactiveReplied", "proactiveQualified"],
};
const BOSS_PROCESS_ALL_POSITIONS_MESSAGE =
  "处理所有岗位未读招聘消息；不要只处理AI实习生；先切到未读，逐个打开未读联系人并读取应聘岗位；只处理boss_chat_rules.json知识库里已经添加的岗位；没有添加/没有配置的岗位只记录并跳过，不回复、不求简历；AI应用开发实习生继续按公司基本情况流程处理；其他已配置岗位按boss_chat_rules.json里该岗位screening规则逐个提问、判断、求简历或跳过；结束后按岗位汇总处理人数、求简历人数、知识库答疑数量和不清楚问题";

  window.ResumeAgentFrontendConfig = {
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
  };
})();
