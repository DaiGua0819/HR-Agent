const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const tls = require("node:tls");
const zlib = require("node:zlib");
const { URL } = require("node:url");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { createJobConfig } = require("./server/config/jobs");
const { createTtlCache } = require("./server/utils/ttlCache");
const { readJsonConfigFile } = require("./server/utils/configFile");
const { inferEmailImapHost, getEnvKeyForAccount, maskEmailAddress } = require("./server/utils/email");
const { sendJson, readRequestBuffer, readJsonBody, fetchLocalJson, sleep } = require("./server/utils/http");
const { normalizeBoolean, normalizeScoreValue, normalizeBoundedScore, normalizeStringArray } = require("./server/utils/normalizers");
const { safeFilePart, compactSafeFilePart, clipText, normalizeConversationName } = require("./server/utils/text");
const { createAutomationProxyService } = require("./server/services/automationProxy");
const {
  normalizeAutomationPlatformId,
  automationPlatformLabel,
  normalizeBossAutomationAccountId,
  automationAccountLabel,
  bossAutomationSources,
  inferResumeSourceAccountId,
  buildResumeSourceMetadata,
} = require("./server/utils/resumeSource");

const PORT = Number(process.env.PORT || 8765);
const HOST = "127.0.0.1";
const ROOT = __dirname;
const AUTOMATION_WORKSPACE = path.dirname(ROOT);
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const BATCH_UPLOAD_DIR = path.join(DATA_DIR, "batch_uploads");
const BOSS_RESUMES_DIR = path.join(ROOT, "boss-resumes");
const BOSS_IMPORT_MANIFEST_PATH = path.join(BOSS_RESUMES_DIR, "manifest.json");
const DEFAULT_RECRUITER_RESUMES_ROOT = path.join(
  process.env.USERPROFILE || process.env.HOME || ROOT,
  "Documents",
  "New project",
  "招聘智能体",
  "recruiter-resumes"
);
const ZHILIAN_RESUMES_ROOT_DIR = path.resolve(process.env.ZHILIAN_RESUMES_ROOT_DIR || DEFAULT_RECRUITER_RESUMES_ROOT);
const ZHILIAN_RESUMES_DIR = path.resolve(
  process.env.ZHILIAN_RESUMES_DIR || process.env.ZHILIAN_RESUME_DIR || ZHILIAN_RESUMES_ROOT_DIR
);
const ZHILIAN_IMPORT_MANIFEST_PATH = path.join(DATA_DIR, "zhilian_import_manifest.json");
const ZHILIAN_AUTO_IMPORT_ENABLED = !/^(0|false|no)$/i.test(String(process.env.ZHILIAN_AUTO_IMPORT_ENABLED ?? "true"));
const ZHILIAN_AUTO_IMPORT_INTERVAL_MS = Math.max(60000, Number(process.env.ZHILIAN_AUTO_IMPORT_INTERVAL_MS || 180000));
const ZHILIAN_AUTO_IMPORT_LIMIT = Math.max(1, Math.min(Number(process.env.ZHILIAN_AUTO_IMPORT_LIMIT || 30), 100));
const ZHILIAN_AUTO_IMPORT_FILE_MIN_AGE_MS = Math.max(0, Number(process.env.ZHILIAN_AUTO_IMPORT_FILE_MIN_AGE_MS || 30000));
const ZHILIAN_AUTO_IMPORT_PARSE_MODE = process.env.ZHILIAN_AUTO_IMPORT_PARSE_MODE === "fast" ? "fast" : "direct";
const DEFAULT_JOB51_RESUMES_ROOT = path.join(
  process.env.USERPROFILE || process.env.HOME || ROOT,
  "Documents",
  "New project",
  "招聘智能体",
  "51-resumes"
);
const JOB51_RESUMES_DIR = path.resolve(
  process.env.JOB51_RESUMES_DIR || process.env.JOB51_RESUME_DIR || DEFAULT_JOB51_RESUMES_ROOT
);
const JOB51_IMPORT_MANIFEST_PATH = path.join(DATA_DIR, "job51_import_manifest.json");
const JOB51_AUTO_IMPORT_ENABLED = !/^(0|false|no)$/i.test(String(process.env.JOB51_AUTO_IMPORT_ENABLED ?? "true"));
const JOB51_AUTO_IMPORT_INTERVAL_MS = Math.max(60000, Number(process.env.JOB51_AUTO_IMPORT_INTERVAL_MS || 180000));
const JOB51_AUTO_IMPORT_LIMIT = Math.max(1, Math.min(Number(process.env.JOB51_AUTO_IMPORT_LIMIT || 30), 100));
const JOB51_AUTO_IMPORT_FILE_MIN_AGE_MS = Math.max(0, Number(process.env.JOB51_AUTO_IMPORT_FILE_MIN_AGE_MS || 30000));
const JOB51_AUTO_IMPORT_PARSE_MODE = process.env.JOB51_AUTO_IMPORT_PARSE_MODE === "fast" ? "fast" : "direct";
const JOB51_A_AGENT_URL = process.env.JOB51_A_AGENT_URL || process.env.JOB51_AGENT_URL || "http://127.0.0.1:8789";
const JOB51_B_AGENT_URL = process.env.JOB51_B_AGENT_URL || process.env.JOB51_SECONDARY_AGENT_URL || "http://127.0.0.1:8791";
const ZHILIAN_A_AGENT_URL = process.env.ZHILIAN_A_AGENT_URL || process.env.ZHILIAN_AGENT_URL || "http://127.0.0.1:8790";
const ZHILIAN_B_AGENT_URL = process.env.ZHILIAN_B_AGENT_URL || process.env.ZHILIAN_SECONDARY_AGENT_URL || "http://127.0.0.1:8792";
const AUTOMATION_SUMMARY_SOURCES = {
  boss_a: {
    label: "BOSS 宋峰峰",
    baseUrl: process.env.BOSS_A_AGENT_URL || "http://127.0.0.1:8787",
    platform: "boss",
  },
  boss_b: {
    label: "BOSS 和新红",
    baseUrl: process.env.BOSS_B_AGENT_URL || "http://127.0.0.1:8788",
    platform: "boss",
  },
  job51_a: {
    label: "51 宋峰峰",
    baseUrl: JOB51_A_AGENT_URL,
    platform: "51job",
  },
  job51_b: {
    label: "51 和新红",
    baseUrl: JOB51_B_AGENT_URL,
    platform: "51job",
    optional: true,
  },
  "51job": {
    label: "51job",
    baseUrl: JOB51_A_AGENT_URL,
    platform: "51job",
  },
  zhilian_a: {
    label: "智联 宋峰峰",
    baseUrl: ZHILIAN_A_AGENT_URL,
    platform: "zhilian",
  },
  zhilian_b: {
    label: "智联 和新红",
    baseUrl: ZHILIAN_B_AGENT_URL,
    platform: "zhilian",
    optional: true,
  },
  zhilian: {
    label: "智联",
    baseUrl: ZHILIAN_A_AGENT_URL,
    platform: "zhilian",
  },
};
const START_CDP_BROWSER_SCRIPT = process.env.START_CDP_BROWSER_SCRIPT || path.join(AUTOMATION_WORKSPACE, "start_cdp_browser.ps1");
const DEFAULT_CLOAK_BROWSER_ROOT = path.join(process.env.USERPROFILE || process.env.HOME || ROOT, ".cloakbrowser");
const BROWSER_PLATFORM_CONFIG = {
  boss: {
    label: "BOSS",
    startUrl: process.env.BOSS_RECRUITMENT_URL || "https://www.zhipin.com/web/chat/index",
  },
  "51job": {
    label: "51",
    startUrl: process.env.JOB51_CHAT_URL || "https://ehire.51job.com/Revision/chat",
  },
  zhilian: {
    label: "智联",
    startUrl: process.env.ZHILIAN_CHAT_URL || "https://rd6.zhaopin.com/app/im",
  },
};
const BROWSER_AUTOMATION_ACCOUNTS = [
  {
    id: "boss_a",
    name: "宋峰峰",
    platforms: {
      boss: { cdpPort: Number(process.env.BOSS_ACCOUNT_A_CDP_PORT || 9222), profileDir: process.env.BOSS_ACCOUNT_A_PROFILE_DIR || path.join(AUTOMATION_WORKSPACE, "cdp-browser-profile") },
      "51job": { cdpPort: Number(process.env.JOB51_ACCOUNT_A_CDP_PORT || 9224), profileDir: process.env.JOB51_ACCOUNT_A_PROFILE_DIR || path.join(AUTOMATION_WORKSPACE, "cdp-browser-profile-51job") },
      zhilian: { cdpPort: Number(process.env.ZHILIAN_ACCOUNT_A_CDP_PORT || 9226), profileDir: process.env.ZHILIAN_ACCOUNT_A_PROFILE_DIR || path.join(AUTOMATION_WORKSPACE, "cdp-browser-profile-zhilian") },
    },
  },
  {
    id: "boss_b",
    name: "和新红",
    platforms: {
      boss: { cdpPort: Number(process.env.BOSS_ACCOUNT_B_CDP_PORT || 9230), profileDir: process.env.BOSS_ACCOUNT_B_PROFILE_DIR || path.join(AUTOMATION_WORKSPACE, "cdp-browser-profile-boss-b") },
      "51job": { cdpPort: Number(process.env.JOB51_ACCOUNT_B_CDP_PORT || 9225), profileDir: process.env.JOB51_ACCOUNT_B_PROFILE_DIR || path.join(AUTOMATION_WORKSPACE, "cdp-browser-profile-51job-boss-b") },
      zhilian: { cdpPort: Number(process.env.ZHILIAN_ACCOUNT_B_CDP_PORT || 9231), profileDir: process.env.ZHILIAN_ACCOUNT_B_PROFILE_DIR || path.join(AUTOMATION_WORKSPACE, "cdp-browser-profile-zhilian-boss-b") },
    },
  },
];
const DEFAULT_BROWSER_LAUNCH_TARGETS = [
  { platform: "boss", accountId: "boss_a" },
  { platform: "boss", accountId: "boss_b" },
  { platform: "51job", accountId: "boss_a" },
  { platform: "51job", accountId: "boss_b" },
  { platform: "zhilian", accountId: "boss_a" },
  { platform: "zhilian", accountId: "boss_b" },
];
const BOSS_BROWSER_DEBUG_URL = process.env.BOSS_BROWSER_DEBUG_URL || "http://127.0.0.1:9222";
const EMAIL_CONFIG_PATH = path.join(ROOT, "email_config.json");
const EMAIL_CONFIG = readJsonConfigFile(EMAIL_CONFIG_PATH);
const EMAIL_ADDRESS = process.env.EMAIL_ADDRESS || process.env.QQ_EMAIL_ADDRESS || EMAIL_CONFIG.address || "wangxinli@renheng.com";
const EMAIL_AUTH_CODE =
  process.env.EMAIL_AUTH_CODE || process.env.EMAIL_PASSWORD || process.env.QQ_EMAIL_AUTH_CODE || EMAIL_CONFIG.authCode || EMAIL_CONFIG.password || "";
const EMAIL_IMAP_HOST = process.env.EMAIL_IMAP_HOST || process.env.QQ_IMAP_HOST || EMAIL_CONFIG.imapHost || inferEmailImapHost(EMAIL_ADDRESS);
const EMAIL_IMAP_PORT = Number(process.env.EMAIL_IMAP_PORT || process.env.QQ_IMAP_PORT || EMAIL_CONFIG.imapPort || 993);
const EMAIL_RESUME_DIR = path.resolve(ROOT, process.env.EMAIL_RESUME_DIR || EMAIL_CONFIG.resumeDir || "boss-resumes");
const EMAIL_ACCOUNT_CONFIGS =
  EMAIL_CONFIG.accounts && typeof EMAIL_CONFIG.accounts === "object" && !Array.isArray(EMAIL_CONFIG.accounts)
    ? EMAIL_CONFIG.accounts
    : {};
const LEGACY_DB_PATH = path.join(DATA_DIR, "resumes.json");
const SQLITE_DB_PATH = path.join(DATA_DIR, "resumes.sqlite");
const EXTERNAL_ANALYZED_RESUME_DB_PATH = path.resolve(
  process.env.EXTERNAL_ANALYZED_RESUME_DB_PATH ||
    path.join(process.env.USERPROFILE || process.env.HOME || ROOT, "Documents", "New project", "招聘智能体", "data", "resumes.sqlite")
);
const EXTERNAL_ANALYZED_RESUME_JSON_PATH = path.resolve(
  process.env.EXTERNAL_ANALYZED_RESUME_JSON_PATH ||
    path.join(process.env.USERPROFILE || process.env.HOME || ROOT, "Documents", "New project", "招聘智能体", "data", "resumes.json")
);
const DB_PATH = LEGACY_DB_PATH;
const MODEL_CONFIG_PATH = path.join(ROOT, "agent_model_config.json");
const WORKSPACE_MODEL_CONFIG_PATH = path.join(path.dirname(ROOT), "agent_model_config.json");
const DEFAULT_OPENAI_BASE_URL = "http://192.168.254.205:8097/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4pro";
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const AI_V4_SCORING_VERSION = "v4-agent-depth-human-feedback";
const AI_V4_SCORING_VERSION_NAME = "历史评分 v4";
const AI_V4_SCORING_VERSION_DESCRIPTION =
  "Agent项目深度评分：项目经历 65 分，技术栈 35 分，支持人工反馈补充规则。";
const POSITION_SCORING_VERSION = "v5-position-must-bonus";
const POSITION_SCORING_VERSION_NAME = "岗位评分 v5";
const POSITION_SCORING_VERSION_DESCRIPTION =
  "岗位评分规则改为必须项、加分项和风险项，不再依赖岗位描述标签匹配。";
const SCORING_VERSION = AI_V4_SCORING_VERSION;
const SCORING_VERSION_NAME = AI_V4_SCORING_VERSION_NAME;
const SCORING_VERSION_DESCRIPTION = AI_V4_SCORING_VERSION_DESCRIPTION;
const GPT_LONG_TIMEOUT_MS = Number(process.env.GPT_LONG_TIMEOUT_MS || process.env.OPENAI_LONG_TIMEOUT_MS || 570000);
const GPT_TEXT_TIMEOUT_MS = Number(process.env.GPT_TEXT_TIMEOUT_MS || process.env.OPENAI_TEXT_TIMEOUT_MS || 180000);
let feishuTokenCache = null;
let sqliteDb = null;
let databaseInitialized = false;
const batchWorkers = new Map();
const BOSS_IMPORT_DONE_STATUSES = new Set(["saved", "duplicate"]);
const BOSS_IMPORT_SKIP_STATUSES = new Set(["pending", "parsing", "saved", "duplicate"]);
const FOLDER_IMPORT_SOURCES = {
  boss: {
    id: "boss-resumes",
    label: "BOSS",
    folder: BOSS_RESUMES_DIR,
    manifestPath: BOSS_IMPORT_MANIFEST_PATH,
    doneStatuses: BOSS_IMPORT_DONE_STATUSES,
    skipStatuses: BOSS_IMPORT_SKIP_STATUSES,
  },
  zhilian: {
    id: "zhilian-resumes",
    label: "智联",
    folder: ZHILIAN_RESUMES_DIR,
    recursive: true,
    includeFilePath: (filePath) => {
      const parts = String(filePath)
        .split(/[\\/]+/)
        .map((part) => part.toLowerCase());
      return parts.some((part) => part.startsWith("zhilian_")) && parts.includes("zhilian");
    },
    manifestPath: ZHILIAN_IMPORT_MANIFEST_PATH,
    doneStatuses: BOSS_IMPORT_DONE_STATUSES,
    skipStatuses: BOSS_IMPORT_SKIP_STATUSES,
  },
  job51: {
    id: "51job-resumes",
    label: "51",
    folder: JOB51_RESUMES_DIR,
    recursive: true,
    manifestPath: JOB51_IMPORT_MANIFEST_PATH,
    doneStatuses: BOSS_IMPORT_DONE_STATUSES,
    skipStatuses: BOSS_IMPORT_SKIP_STATUSES,
  },
};
let zhilianAutoImportTimer = null;
let zhilianAutoImportRunning = false;
let job51AutoImportTimer = null;
let job51AutoImportRunning = false;
const EMAIL_AUTO_IMPORT_INTERVAL_MS = Math.max(60000, Number(process.env.EMAIL_AUTO_IMPORT_INTERVAL_MS || 180000));
const EMAIL_MAX_IMPORT_MESSAGES = Math.max(1, Math.min(Number(process.env.EMAIL_MAX_IMPORT_MESSAGES || EMAIL_CONFIG.maxImportMessages || 75), 5000));
const EMAIL_AUTO_IMPORT_LIMIT_VALUE = process.env.EMAIL_AUTO_IMPORT_LIMIT || EMAIL_CONFIG.autoImportLimit || EMAIL_MAX_IMPORT_MESSAGES;
const EMAIL_AUTO_IMPORT_LIMIT =
  String(EMAIL_AUTO_IMPORT_LIMIT_VALUE).toLowerCase() === "all"
    ? EMAIL_MAX_IMPORT_MESSAGES
    : Math.max(1, Math.min(Number(EMAIL_AUTO_IMPORT_LIMIT_VALUE || EMAIL_MAX_IMPORT_MESSAGES), EMAIL_MAX_IMPORT_MESSAGES));
const EMAIL_IMPORT_TODAY_ONLY = !/^(0|false|no)$/i.test(String(process.env.EMAIL_IMPORT_TODAY_ONLY ?? EMAIL_CONFIG.todayOnly ?? "true"));
const EMAIL_IMPORT_SOURCE_FILTER = String(process.env.EMAIL_IMPORT_SOURCE_FILTER || EMAIL_CONFIG.sourceFilter || "boss").toLowerCase();
let emailAutoImportTimer = null;
let emailAutoImportEnabled =
  String(process.env.EMAIL_AUTO_IMPORT_ENABLED || "").toLowerCase() === "true" ||
  process.env.EMAIL_AUTO_IMPORT_ENABLED === "1" ||
  Boolean(EMAIL_CONFIG.autoImportEnabled);
let emailAutoImportRunning = false;
let emailAutoImportLastSummary = null;
let emailAutoImportLastError = "";
let emailAutoImportLastStartedAt = "";
let emailAutoImportLastFinishedAt = "";


const {
  RESUME_LIBRARY_JOB_TYPES,
  LEGACY_JOB_TYPES,
  JOB_TYPES,
  DEFAULT_JOB_TYPE,
  AI_SCORING_JOB_TYPE,
  RESUME_COPY_DIR,
  RESUME_JOB_DISPLAY_LABELS,
  POSITION_SCORING_RULES,
  JD_TAG_OVERRIDES_PATH,
  JD_PROFILE_DEFINITIONS,
  JD_MATCH_STOP_WORDS,
} = createJobConfig(DATA_DIR);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const AI_V4_ADOPTED_RULES = [
  {
    id: "ai-v4-adopted-llm-agent-stack-layering",
    suggestion:
      "在'技术栈匹配度'子维度中，增加对'LLM Agent开发栈'的分层定义：基础层（Prompt/Tool Use/Orchestration）、进阶层（轻量微调如LoRA/QLoRA用于agent行为定制）、部署层（推理优化/Agent Serving），并允许进阶层技能触发额外加权系数",
    sourceSummary:
      "人工强调大模型微调（如LoRA）是AI应用开发/Agent方向的加分项，v4需显式建模微调能力作为Agent开发相关性的增强信号。",
    createdAt: "2026-05-14T07:02:28.623Z",
    adoptedAt: "2026-05-14T07:03:22.979Z",
  },
  {
    id: "ai-v4-adopted-finetune-agent-depth",
    suggestion:
      "在v4系列规则中，将'大模型微调经验'从原属的'模型开发'类目，显式映射至'AI应用开发（Agent方向）'的能力纵深指标，避免因类目错位导致信号衰减",
    sourceSummary:
      "人工反馈显示微调能力应作为AI应用开发能力纵深信号，避免LoRA/QLoRA等经验在Agent岗位中被低估。",
    createdAt: "2026-05-14T07:02:28.623Z",
    adoptedAt: "2026-05-14T07:03:21.252Z",
  },
  {
    id: "ai-v4-adopted-rag-depth-review",
    suggestion:
      "引入‘技术关键词密度校验’作为辅助信号：在项目描述中，若涉及RAG但未出现‘rerank’‘cross-encoder’‘hybrid search’‘context fusion’‘query rewriting’等任一领域强相关术语，且无等效技术描述，则触发人工复核标记。",
    sourceSummary:
      "人工反馈指出RAG项目深度不足时，v4需要用检索策略、重排序、上下文融合等技术要素识别浅层RAG描述。",
    createdAt: "2026-05-15T08:53:37.314Z",
    adoptedAt: "2026-05-15T08:55:47.528Z",
  },
];

const AI_V4_AGENT_PROJECT_GATE_PATTERNS = [
  /智能体|Agent|AI\s*Agent|多智能体|Multi[-\s]?Agent/i,
  /工具调用|函数调用|Function\s*Calling|Tool\s*Calling|MCP/i,
  /RAG|检索增强|知识库|向量数据库|Embedding|向量检索/i,
  /LangChain|LangGraph|LlamaIndex|AutoGen|CrewAI|Dify|Coze|扣子/i,
  /工作流|编排|任务规划|Planner|Executor/i,
  /大模型|LLM|OpenAI|Qwen|通义千问|GLM|DeepSeek/i,
  /多轮对话|对话系统|聊天机器人|Chatbot|Memory/i,
];

const AI_V4_PROJECT_RULES = [
  { label: "项目经历/项目经验/项目/实训/课程设计", pattern: /项目经历|项目经验|项目|实训|课程设计/i },
  { label: "智能体/Agent/多智能体/工具调用/函数调用/MCP", pattern: /智能体|Agent|多智能体|工具调用|函数调用|MCP/i },
  { label: "RAG/知识库/向量数据库/Embedding/检索/召回/重排/Rerank", pattern: /RAG|知识库|向量数据库|Embedding|检索|召回|重排|Rerank/i },
  { label: "LangChain/LangGraph/LlamaIndex/AutoGen/CrewAI/Dify/Coze/扣子", pattern: /LangChain|LangGraph|LlamaIndex|AutoGen|CrewAI|Dify|Coze|扣子/i },
  { label: "工作流/编排/任务规划/Planner/Executor/自动化", pattern: /工作流|编排|任务规划|Planner|Executor|自动化/i },
  { label: "负责/主导/独立/参与/设计/开发/实现/搭建/部署/优化", pattern: /负责|主导|独立|参与|设计|开发|实现|搭建|部署|优化/i },
  { label: "API/接口/服务化/后端/FastAPI/Flask/Node.js/Docker", pattern: /API|接口|服务化|后端|FastAPI|Flask|Node\.?js|Docker/i },
  { label: "Prompt/提示词/多轮对话/Memory/上下文/问答", pattern: /Prompt|提示词|多轮对话|Memory|上下文|问答/i },
];

const AI_V4_SKILL_RULES = [
  { label: "智能体/Agent/AI Agent/多智能体", pattern: /智能体|Agent|AI\s*Agent|多智能体|Multi[-\s]?Agent/i },
  { label: "工具调用/函数调用/Function Calling/Tool Calling/插件/MCP", pattern: /工具调用|函数调用|Function\s*Calling|Tool\s*Calling|插件|MCP/i },
  { label: "LangChain/LangGraph/LlamaIndex/AutoGen/CrewAI/Dify/Coze/扣子", pattern: /LangChain|LangGraph|LlamaIndex|AutoGen|CrewAI|Dify|Coze|扣子/i },
  { label: "RAG/检索增强/知识库/向量数据库/Embedding/向量检索/召回/重排/Rerank", pattern: /RAG|检索增强|知识库|向量数据库|Embedding|向量检索|召回|重排|Rerank/i },
  { label: "Prompt/提示工程/Prompt Engineering/思维链/CoT", pattern: /Prompt|提示词|提示工程|Prompt\s*Engineering|思维链|CoT/i },
  { label: "大模型/LLM/AIGC/OpenAI/Qwen/通义千问/GLM/DeepSeek", pattern: /大模型|LLM|AIGC|生成式AI|OpenAI|Qwen|通义千问|GLM|DeepSeek/i },
  { label: "工作流/编排/Orchestration/流程自动化/任务规划", pattern: /工作流|编排|Orchestration|流程自动化|任务规划|Planner|Executor/i },
  { label: "多轮对话/对话系统/聊天机器人/Chatbot/记忆/Memory", pattern: /多轮对话|对话系统|聊天机器人|Chatbot|记忆|Memory|上下文/i },
  { label: "Python/FastAPI/Flask/Node.js/API/接口", pattern: /Python|FastAPI|Flask|Node\.?js|API|接口/i },
  { label: "Docker/部署/服务化/Git/Linux/Redis/MySQL/PostgreSQL/MongoDB", pattern: /Docker|部署|服务化|Git|Linux|Redis|MySQL|PostgreSQL|MongoDB/i },
];

const automationSummaryResponseCache = createTtlCache(8000);

function getAutomationSummaryResponseCache(key) {
  return automationSummaryResponseCache.get(key);
}

function setAutomationSummaryResponseCache(key, payload) {
  automationSummaryResponseCache.set(key, payload);
}

function normalizeAutomationSummarySource(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "boss" || key === "boss_a" || key === "songfengfeng") return "boss_a";
  if (key === "boss_b" || key === "hexinhong") return "boss_b";
  if (key === "job51_a" || key === "51_a") return "job51_a";
  if (key === "job51_b" || key === "51_b") return "job51_b";
  if (key === "51" || key === "51job" || key === "job51") return "51job";
  if (key === "zhilian_a" || key === "zhaopin_a") return "zhilian_a";
  if (key === "zhilian_b" || key === "zhaopin_b") return "zhilian_b";
  if (key === "zhilian" || key === "zhaopin") return "zhilian";
  return "zhilian";
}

function getEmailAccountConfig(accountId = "") {
  const normalizedAccountId = normalizeBossAutomationAccountId(accountId || EMAIL_CONFIG.defaultAccount || "");
  const accountConfig = EMAIL_ACCOUNT_CONFIGS[normalizedAccountId] || {};
  const address =
    process.env[getEnvKeyForAccount(normalizedAccountId, "ADDRESS")] ||
    accountConfig.address ||
    EMAIL_ADDRESS;
  const authCode =
    process.env[getEnvKeyForAccount(normalizedAccountId, "AUTH_CODE")] ||
    process.env[getEnvKeyForAccount(normalizedAccountId, "PASSWORD")] ||
    accountConfig.authCode ||
    accountConfig.password ||
    EMAIL_AUTH_CODE;
  const imapHost =
    process.env[getEnvKeyForAccount(normalizedAccountId, "IMAP_HOST")] ||
    accountConfig.imapHost ||
    EMAIL_IMAP_HOST ||
    inferEmailImapHost(address);
  const imapPort = Number(
    process.env[getEnvKeyForAccount(normalizedAccountId, "IMAP_PORT")] ||
      accountConfig.imapPort ||
      EMAIL_IMAP_PORT ||
      993
  );
  const resumeDir = path.resolve(ROOT, accountConfig.resumeDir || EMAIL_RESUME_DIR);
  return {
    accountId: normalizedAccountId,
    accountLabel: automationAccountLabel(normalizedAccountId),
    address,
    maskedAddress: maskEmailAddress(address),
    authCode,
    imapHost,
    imapPort,
    resumeDir,
  };
}

function getEmailAutoImportAccountIds() {
  const accountValues = Array.isArray(EMAIL_CONFIG.autoAccountIds)
    ? EMAIL_CONFIG.autoAccountIds
    : EMAIL_CONFIG.autoAccountId
      ? [EMAIL_CONFIG.autoAccountId]
      : Object.keys(EMAIL_ACCOUNT_CONFIGS);
  const fallbackValues = accountValues.length ? accountValues : [EMAIL_CONFIG.defaultAccount || ""];
  const configuredAccountIds = new Set(Object.keys(EMAIL_ACCOUNT_CONFIGS));
  const ids = [];

  for (const value of fallbackValues) {
    const normalized = normalizeBossAutomationAccountId(value);
    const expanded = normalized === "all" ? bossAutomationSources("all") : [normalized];
    for (const accountId of expanded) {
      if (configuredAccountIds.size && !configuredAccountIds.has(accountId)) continue;
      if (!ids.includes(accountId)) ids.push(accountId);
    }
  }

  if (!ids.length) {
    const fallback = normalizeBossAutomationAccountId(EMAIL_CONFIG.defaultAccount || "");
    return fallback === "all" ? ["all"] : [fallback];
  }

  return ids;
}

const automationProxyService = createAutomationProxyService({
  sources: AUTOMATION_SUMMARY_SOURCES,
  sendJson,
  readRequestBuffer,
  normalizePlatformId: normalizeAutomationPlatformId,
  normalizeAccountId: normalizeBossAutomationAccountId,
  platformLabel: automationPlatformLabel,
  platformSources: platformAutomationSources,
  getRequestBaseUrl: () => `http://${HOST}:${PORT}`,
});

async function fetchAutomationSummary(sourceKey) {
  return automationProxyService.fetchAutomationSummary(sourceKey);
}

async function handleRecruiterAutomationSummary(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const sourceKey = normalizeAutomationSummarySource(
      requestUrl.searchParams.get("source") || requestUrl.searchParams.get("platform") || "zhilian"
    );
    const payload = await fetchAutomationSummary(sourceKey);
    sendJson(response, 200, {
      ...payload,
      availableSources: Object.fromEntries(
        Object.entries(AUTOMATION_SUMMARY_SOURCES).map(([key, source]) => [key, { label: source.label }])
      ),
    });
  } catch (error) {
    sendJson(response, 502, { error: error.message || "自动化统计读取失败" });
  }
}

async function handleBossAutomationSummary(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const accountId = normalizeBossAutomationAccountId(requestUrl.searchParams.get("accountId") || "all");
    const date = requestUrl.searchParams.get("date") || "";
    const force = requestUrl.searchParams.get("force") === "1";
    const cacheKey = `boss|${accountId}|${date || automationChinaDateKey()}`;
    const cachedPayload = force ? null : getAutomationSummaryResponseCache(cacheKey);
    if (cachedPayload) {
      sendJson(response, 200, cachedPayload);
      return;
    }
    const deepRecords = await collectDeepAutomationDetailRecords("boss", accountId, date || automationChinaDateKey());
    if (deepRecords.length) {
      const payload = buildAutomationSummaryPayloadFromRecords(deepRecords, { platform: "boss", accountId, date });
      setAutomationSummaryResponseCache(cacheKey, payload);
      sendJson(response, 200, payload);
      return;
    }
    const summaries = await Promise.all(bossAutomationSources(accountId).map((sourceKey) => fetchAutomationSummary(sourceKey)));
    const payload = buildBossAutomationSummaryPayload(summaries, { accountId, date });
    setAutomationSummaryResponseCache(cacheKey, payload);
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "BOSS 自动化统计读取失败" });
  }
}

async function handlePlatformAutomationSummary(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const platform = normalizeAutomationPlatformId(requestUrl.searchParams.get("platform") || requestUrl.searchParams.get("source") || "boss");
    const accountId = normalizeBossAutomationAccountId(requestUrl.searchParams.get("accountId") || "all");
    const date = requestUrl.searchParams.get("date") || "";
    const force = requestUrl.searchParams.get("force") === "1";
    const cacheKey = `${platform}|${accountId}|${date || automationChinaDateKey()}`;
    const cachedPayload = force ? null : getAutomationSummaryResponseCache(cacheKey);
    if (cachedPayload) {
      sendJson(response, 200, cachedPayload);
      return;
    }
    const deepRecords = await collectDeepAutomationDetailRecords(platform, accountId, date || automationChinaDateKey());
    if (deepRecords.length) {
      const payload = {
        ...buildAutomationSummaryPayloadFromRecords(deepRecords, { platform, accountId, date }),
        sourceKeys: platformAutomationSources(platform, accountId),
      };
      setAutomationSummaryResponseCache(cacheKey, payload);
      sendJson(response, 200, payload);
      return;
    }
    const sourceKeys = platformAutomationSources(platform, accountId);
    const summaries = await Promise.all(sourceKeys.map((sourceKey) => fetchAutomationSummary(sourceKey)));
    const payload = {
      ...buildBossAutomationSummaryPayload(summaries, { accountId, date }),
      platform,
      sourceKeys,
    };
    setAutomationSummaryResponseCache(cacheKey, payload);
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, error.statusCode || 502, { error: error.message || "自动化统计读取失败" });
  }
}

async function handleBossAutomationStart(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const accountId = normalizeBossAutomationAccountId(requestUrl.searchParams.get("accountId") || "all");
    const sources = bossAutomationSources(accountId);
    const statuses = await Promise.all(
      sources.map(async (sourceKey) => {
        const { payload, source } = await fetchAgentJson(sourceKey, "/api/status", { timeoutMs: 8000 });
        return {
          source: sourceKey,
          label: source.label,
          busy: Boolean(payload.busy),
          accountId: payload.accountId || sourceKey,
          accountName: payload.accountName || source.label,
        };
      })
    );
    sendJson(response, 200, {
      connected: true,
      message: "BOSS 自动化服务已连接",
      cdp: { started: false },
      agent: { started: false, statuses },
      navigation: { skipped: true },
      timings: { totalMs: 0 },
    });
  } catch (error) {
    sendJson(response, 502, { connected: false, error: error.message || "BOSS 自动化服务未启动" });
  }
}

async function handleBossAutomationProcessMessages(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const accountId = normalizeBossAutomationAccountId(body.accountId || "all");
    const message = String(body.message || "请处理全部未读消息，所有已配置岗位都要按最新逻辑处理。");
    const results = await Promise.all(
      bossAutomationSources(accountId).map(async (sourceKey) => {
        await fetchAgentJson(sourceKey, "/api/pause", {
          method: "POST",
          body: {
            paused: false,
            pause: false,
            reason: "开始处理消息前自动解除暂停",
          },
          timeoutMs: 30000,
        });
        return fetchAgentJson(sourceKey, "/api/chat", {
          method: "POST",
          body: {
            message,
            options: body.options && typeof body.options === "object" ? body.options : undefined,
          },
          timeoutMs: 5400000,
        });
      })
    );
    const parts = results.map(({ payload, source }) => {
      const text = payload.reply || payload.message || payload.result?.reply || payload.result?.message || "完成";
      return `${source.label}：${String(text).replace(/\s+/g, " ").slice(0, 260)}`;
    });
    sendJson(response, 200, {
      ok: true,
      accountId,
      message: parts.join("；"),
      result: { message: parts.join("；"), results: results.map((item) => item.payload) },
    });
  } catch (error) {
    sendJson(response, 502, { error: error.message || "BOSS 处理消息失败" });
  }
}

async function handleBossAutomationProactiveContact(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const accountId = normalizeBossAutomationAccountId(body.accountId || "all");
    const results = await Promise.all(
      bossAutomationSources(accountId).map(async (sourceKey) => {
        await fetchAgentJson(sourceKey, "/api/pause", {
          method: "POST",
          body: {
            paused: false,
            pause: false,
            reason: "开始主动联系前自动解除暂停",
          },
          timeoutMs: 30000,
        });
        return fetchAgentJson(sourceKey, "/api/recruiter/proactive-contact", {
          method: "POST",
          body: {
            targetPosition: body.targetPosition,
            maxTotal: body.maxTotal,
            count: body.count,
            dryRun: Boolean(body.dryRun),
            requireMatch: Boolean(body.requireMatch),
            customRules: body.customRules && typeof body.customRules === "object" ? body.customRules : undefined,
            options: body.options && typeof body.options === "object" ? body.options : undefined,
          },
          timeoutMs: 3600000,
        });
      })
    );
    const parts = results.map(({ payload, source }) => {
      const text = payload.reply || payload.message || payload.result?.reply || payload.result?.message || "完成";
      return `${source.label}：${String(text).replace(/\s+/g, " ").slice(0, 260)}`;
    });
    sendJson(response, 200, {
      ok: true,
      accountId,
      message: parts.join("；"),
      result: { message: parts.join("；"), results: results.map((item) => item.payload) },
    });
  } catch (error) {
    sendJson(response, 502, { error: error.message || "BOSS 主动联系失败" });
  }
}

async function handleBossAutomationPause(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const accountId = normalizeBossAutomationAccountId(body.accountId || "all");
    const results = await Promise.all(
      bossAutomationSources(accountId).map((sourceKey) =>
        fetchAgentJson(sourceKey, "/api/pause", {
          method: "POST",
          body: {
            paused: Boolean(body.paused ?? body.pause ?? true),
            pause: Boolean(body.paused ?? body.pause ?? true),
            reason: body.reason || "",
          },
          timeoutMs: 30000,
        })
      )
    );
    sendJson(response, 200, {
      ok: true,
      message: Boolean(body.paused ?? body.pause ?? true) ? "自动化已暂停" : "自动化已继续",
      results: results.map((item) => item.payload),
    });
  } catch (error) {
    sendJson(response, 502, { error: error.message || "暂停自动化失败" });
  }
}

function logResume(message) {
  console.log(`[${new Date().toISOString()}] [resume] ${message}`);
}

async function getFeishuTenantAccessToken() {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    throw new Error("未配置飞书 App ID 或 App Secret");
  }

  if (feishuTokenCache && feishuTokenCache.expiresAt > Date.now() + 60000) {
    return feishuTokenCache.token;
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.msg || payload.error?.message || "飞书连接失败");
  }

  feishuTokenCache = {
    token: payload.tenant_access_token,
    expiresAt: Date.now() + Math.max(0, Number(payload.expire || 0) - 120) * 1000,
  };

  return feishuTokenCache.token;
}

async function handleFeishuStatus(_request, response) {
  try {
    await getFeishuTenantAccessToken();
    sendJson(response, 200, {
      connected: true,
      appId: FEISHU_APP_ID,
      message: "飞书应用凭据可用",
    });
  } catch (error) {
    sendJson(response, 500, {
      connected: false,
      message: error.message || "飞书连接失败",
    });
  }
}

function getDb() {
  if (sqliteDb) return sqliteDb;

  sqliteDb = new DatabaseSync(SQLITE_DB_PATH);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      phone_key TEXT,
      job_type TEXT,
      match_score INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_resumes_phone_key ON resumes(phone_key);
    CREATE INDEX IF NOT EXISTS idx_resumes_job_score ON resumes(job_type, match_score DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS rule_suggestions (
      id TEXT PRIMARY KEY,
      resume_id TEXT NOT NULL,
      job_type TEXT,
      suggestion TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      source_summary TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      adopted_at TEXT,
      rejected_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rule_suggestions_status ON rule_suggestions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rule_suggestions_job_status ON rule_suggestions(job_type, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS batch_jobs (
      id TEXT PRIMARY KEY,
      parse_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS batch_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      resume_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES batch_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_batch_items_job ON batch_items(job_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_batch_items_status ON batch_items(job_id, status);
  `);

  return sqliteDb;
}

function ensureRuleSuggestionJobTypeColumn() {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(rule_suggestions)").all();
  if (!columns.some((column) => column.name === "job_type")) {
    db.prepare("ALTER TABLE rule_suggestions ADD COLUMN job_type TEXT").run();
  }
  db.prepare("CREATE INDEX IF NOT EXISTS idx_rule_suggestions_job_status ON rule_suggestions(job_type, status, created_at DESC)").run();
}

function backfillRuleSuggestionJobTypesIfNeeded() {
  const db = getDb();
  const alreadyDone = db.prepare("SELECT value FROM app_meta WHERE key = ?").get("rule_suggestions_job_type_backfilled_v1");
  if (alreadyDone) return;

  const rows = db
    .prepare(
      `SELECT rs.id, rs.payload, r.job_type
       FROM rule_suggestions rs
       LEFT JOIN resumes r ON r.id = rs.resume_id
       WHERE rs.job_type IS NULL OR rs.job_type = ''`
    )
    .all();

  const update = db.prepare("UPDATE rule_suggestions SET job_type = ? WHERE id = ?");
  runSqlTransaction(() => {
    rows.forEach((row) => {
      const payload = parsePayload(row.payload, {});
      const jobType = normalizeJobType(row.job_type || payload.jobType || DEFAULT_JOB_TYPE);
      update.run(jobType, row.id);
    });
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(
      "rule_suggestions_job_type_backfilled_v1",
      new Date().toISOString()
    );
  });
}

function ensureAiV4AdoptedRulesIfNeeded() {
  const db = getDb();
  const metaKey = "ai_v4_adopted_rules_seeded_20260605_v1";
  const alreadyDone = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(metaKey);
  if (alreadyDone) return;

  const now = new Date().toISOString();
  const jobType = normalizeJobType(AI_SCORING_JOB_TYPE);
  const targetSuggestions = new Set(AI_V4_ADOPTED_RULES.map((rule) => rule.suggestion));
  const existingBySuggestion = db.prepare(
    "SELECT id, suggestion FROM rule_suggestions WHERE job_type = ? AND suggestion = ? LIMIT 1"
  );
  const insert = db.prepare(`
    INSERT INTO rule_suggestions
      (id, resume_id, job_type, suggestion, status, source_summary, payload, created_at, adopted_at, updated_at)
    VALUES (?, ?, ?, ?, 'adopted', ?, ?, ?, ?, ?)
  `);
  const adoptExisting = db.prepare(`
    UPDATE rule_suggestions
    SET status = 'adopted', source_summary = ?, payload = ?, adopted_at = ?, rejected_at = NULL, updated_at = ?
    WHERE id = ?
  `);
  const demoteOtherAdopted = db.prepare(`
    UPDATE rule_suggestions
    SET status = 'pending', adopted_at = NULL, updated_at = ?
    WHERE job_type = ? AND status = 'adopted' AND suggestion NOT IN (?, ?, ?)
  `);

  runSqlTransaction(() => {
    demoteOtherAdopted.run(now, jobType, ...AI_V4_ADOPTED_RULES.map((rule) => rule.suggestion));

    AI_V4_ADOPTED_RULES.forEach((rule) => {
      const payload = JSON.stringify({
        jobType,
        resumeName: "历史v4学习回灌",
        resumePhone: "",
        sourceVersion: AI_V4_SCORING_VERSION,
        migratedAt: now,
      });
      const existing = existingBySuggestion.get(jobType, rule.suggestion);
      if (existing?.id) {
        adoptExisting.run(rule.sourceSummary, payload, rule.adoptedAt, now, existing.id);
        return;
      }
      insert.run(
        rule.id,
        "system:ai-v4-history",
        jobType,
        rule.suggestion,
        rule.sourceSummary,
        payload,
        rule.createdAt,
        rule.adoptedAt,
        now
      );
    });

    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(metaKey, now);
  });
}

function parsePayload(payload, fallback = {}) {
  try {
    return JSON.parse(payload || "{}");
  } catch {
    return fallback;
  }
}

function runSqlTransaction(task) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = task(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function upsertResumeRow(record) {
  const db = getDb();
  db.prepare(`
    INSERT INTO resumes (id, payload, phone_key, job_type, match_score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      phone_key = excluded.phone_key,
      job_type = excluded.job_type,
      match_score = excluded.match_score,
      updated_at = excluded.updated_at
  `).run(
    record.id,
    JSON.stringify(record),
    normalizePhoneKey(record.phone),
    normalizeJobType(record.jobType, `${record.fileName || ""} ${record.name || ""} ${record.school || ""}`),
    getNumericScore(record),
    record.updatedAt || new Date().toISOString()
  );
}

async function migrateLegacyJsonIfNeeded() {
  const db = getDb();
  const migrated = db.prepare("SELECT value FROM app_meta WHERE key = ?").get("legacy_json_migrated");
  if (migrated) return;

  let legacyRecords = [];
  try {
    const content = await fs.readFile(LEGACY_DB_PATH, "utf8");
    legacyRecords = JSON.parse(content || "[]");
  } catch {
    legacyRecords = [];
  }

  runSqlTransaction(() => {
    getUniqueCandidateRecords(legacyRecords.filter((record) => record && record.id)).forEach(upsertResumeRow);
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(
      "legacy_json_migrated",
      new Date().toISOString()
    );
  });
}

async function dedupeSqliteResumesIfNeeded() {
  const db = getDb();
  const deduped = db.prepare("SELECT value FROM app_meta WHERE key = ?").get("phone_deduped_v1");
  if (deduped) return;

  const records = db
    .prepare("SELECT payload FROM resumes")
    .all()
    .map((row) => parsePayload(row.payload))
    .filter((record) => record && record.id);
  const uniqueRecords = getUniqueCandidateRecords(records);

  runSqlTransaction((transactionDb) => {
    transactionDb.prepare("DELETE FROM resumes").run();
    uniqueRecords.forEach(upsertResumeRow);
    transactionDb.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(
      "phone_deduped_v1",
      new Date().toISOString()
    );
  });
}

function readResumeRecordsFromSqlite(dbPath) {
  const resolvedPath = path.resolve(dbPath || "");
  if (!resolvedPath || resolvedPath === path.resolve(SQLITE_DB_PATH) || !fsSync.existsSync(resolvedPath)) return [];
  let externalDb = null;
  try {
    externalDb = new DatabaseSync(resolvedPath, { readOnly: true });
    return externalDb
      .prepare("SELECT payload FROM resumes")
      .all()
      .map((row) => parsePayload(row.payload))
      .filter((record) => record && record.id);
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] [resume-backfill] 读取外部库失败：${resolvedPath} ${error.message}`);
    return [];
  } finally {
    try {
      externalDb?.close?.();
    } catch {
      // Ignore close errors from read-only best-effort imports.
    }
  }
}

async function readResumeRecordsFromJson(jsonPath) {
  const resolvedPath = path.resolve(jsonPath || "");
  if (!resolvedPath || resolvedPath === path.resolve(LEGACY_DB_PATH) || !fsSync.existsSync(resolvedPath)) return [];
  try {
    const payload = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
    return (Array.isArray(payload) ? payload : []).filter((record) => record && record.id);
  } catch (error) {
    console.warn(`[${new Date().toISOString()}] [resume-backfill] 读取外部 JSON 失败：${resolvedPath} ${error.message}`);
    return [];
  }
}

async function deepBackfillAnalyzedResumesIfNeeded() {
  const db = getDb();
  const metaKey = "deep_analyzed_resume_backfill_20260603_v1";
  const alreadyDone = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(metaKey);
  if (alreadyDone) return;

  const currentRecords = db
    .prepare("SELECT payload FROM resumes")
    .all()
    .map((row) => parsePayload(row.payload))
    .filter((record) => record && record.id);
  const externalRecords = [
    ...readResumeRecordsFromSqlite(EXTERNAL_ANALYZED_RESUME_DB_PATH),
    ...(await readResumeRecordsFromJson(EXTERNAL_ANALYZED_RESUME_JSON_PATH)),
  ];
  const uniqueRecords = getUniqueCandidateRecords([...currentRecords, ...externalRecords]);

  runSqlTransaction((transactionDb) => {
    transactionDb.prepare("DELETE FROM resumes").run();
    uniqueRecords.forEach(upsertResumeRow);
    transactionDb.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(
      metaKey,
      JSON.stringify({
        at: new Date().toISOString(),
        current: currentRecords.length,
        external: externalRecords.length,
        saved: uniqueRecords.length,
        sourceDb: EXTERNAL_ANALYZED_RESUME_DB_PATH,
        sourceJson: EXTERNAL_ANALYZED_RESUME_JSON_PATH,
      })
    );
  });
  if (externalRecords.length) {
    console.log(
      `[${new Date().toISOString()}] [resume-backfill] 已深度合并简历：当前 ${currentRecords.length}，外部 ${externalRecords.length}，去重后 ${uniqueRecords.length}`
    );
  }
}

async function buildImportManifestIndexes() {
  const byItemId = new Map();
  const byFilename = new Map();
  for (const source of Object.values(FOLDER_IMPORT_SOURCES)) {
    const manifest = await readFolderImportManifest(source);
    for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
      const enrichedEntry = { ...entry, sourceId: source.id, sourceLabel: entry.sourceLabel || source.label };
      if (entry?.itemId) byItemId.set(entry.itemId, enrichedEntry);
      if (entry?.filename && !byFilename.has(entry.filename)) byFilename.set(entry.filename, enrichedEntry);
      const basename = entry?.sourcePath ? path.basename(entry.sourcePath) : "";
      if (basename && !byFilename.has(basename)) byFilename.set(basename, enrichedEntry);
    }
  }
  return { byItemId, byFilename };
}

function batchRowHasSourceHint(row = {}) {
  const payload = parsePayload(row.payload, {});
  const text = [
    payload.source,
    payload.sourceLabel,
    payload.sourceName,
    payload.sourcePlatform,
    payload.platform,
    payload.importSource,
    payload.accountId,
    payload.accountLabel,
    payload.accountName,
    payload.sourcePath,
    row.filename,
  ]
    .filter(Boolean)
    .join(" ");
  return Boolean(
    payload.source ||
      payload.sourceLabel ||
      payload.sourcePlatform ||
      payload.platform ||
      payload.accountId ||
      payload.accountLabel ||
      payload.accountName ||
      payload.sourcePath ||
      /51job|job51|前程|zhilian|zhaopin|智联|boss|zhipin|kanzhun|邮箱|email|mail/i.test(text)
  );
}

function pickBetterSourceBatch(current, next) {
  if (!current) return next;
  const currentHint = batchRowHasSourceHint(current);
  const nextHint = batchRowHasSourceHint(next);
  if (nextHint && !currentHint) return next;
  return current;
}

function sourceMetadataFromManifestAccounts(baseMeta = {}, manifestEntry = {}) {
  const accounts = Array.isArray(manifestEntry.accounts) ? manifestEntry.accounts : [];
  const accountIds = [...new Set(accounts.map((account) => inferResumeSourceAccountId(account?.accountId || account?.accountLabel)).filter(Boolean))];
  if (accountIds.length <= 1) return baseMeta;
  const platformLabel = baseMeta.sourcePlatform || automationPlatformLabel(baseMeta.platform || "boss");
  const names = accountIds.map((accountId) => automationAccountLabel(accountId));
  const sourceLabel = [...new Set(names.map((name) => `${platformLabel} ${name}`))].join("、");
  return {
    ...baseMeta,
    source: sourceLabel,
    sourceLabel,
    sourceName: sourceLabel,
    accountId: accountIds.join(","),
    accountName: names.join("、"),
  };
}

function shouldUpdateResumeSource(record = {}, sourceMeta = {}) {
  if (!sourceMeta.sourceLabel) return false;
  const current = String(record.sourceLabel || record.sourceName || record.source || record.sourcePlatform || record.platform || "").trim();
  if (!current || /^邮箱$/i.test(current)) return true;
  if (sourceMeta.accountName && !current.includes(sourceMeta.accountName)) return true;
  if (sourceMeta.sourcePlatform && current === sourceMeta.sourcePlatform) return true;
  return false;
}

async function backfillResumeSourceMetadata() {
  const db = getDb();
  const manifestIndexes = await buildImportManifestIndexes();
  const batchRows = db
    .prepare(
      `SELECT id, filename, file_path, resume_id, payload, created_at, updated_at
         FROM batch_items
        ORDER BY updated_at DESC`
    )
    .all();
  const batchByResumeId = new Map();
  const batchByFilename = new Map();
  for (const row of batchRows) {
    if (row.resume_id) batchByResumeId.set(row.resume_id, pickBetterSourceBatch(batchByResumeId.get(row.resume_id), row));
    if (row.filename) batchByFilename.set(row.filename, pickBetterSourceBatch(batchByFilename.get(row.filename), row));
  }

  const rows = db.prepare("SELECT id, payload FROM resumes").all();
  const updatedRecords = [];
  for (const row of rows) {
    const record = parsePayload(row.payload, {});
    if (!record?.id) continue;
    const batch = batchByResumeId.get(record.id) || batchByFilename.get(record.fileName);
    const batchPayload = parsePayload(batch?.payload, {});
    const manifestEntry =
      (batch ? manifestIndexes.byItemId.get(batch.id) : null) ||
      manifestIndexes.byFilename.get(batch?.filename || "") ||
      manifestIndexes.byFilename.get(record.fileName || "") ||
      {};
    const sourceMeta = sourceMetadataFromManifestAccounts(
      buildResumeSourceMetadata({
        ...batchPayload,
        source: batchPayload.source || manifestEntry.sourceId || record.source || "",
        sourceLabel: batchPayload.sourceLabel || manifestEntry.sourceLabel || record.sourceLabel || "",
        sourcePlatform: batchPayload.sourcePlatform || record.sourcePlatform || "",
        platform: batchPayload.platform || record.platform || "",
        sourcePath: batchPayload.sourcePath || manifestEntry.sourcePath || record.sourcePath || "",
        filename: batch?.filename || record.fileName || "",
        fileName: batch?.filename || record.fileName || "",
        accountId: batchPayload.accountId || manifestEntry.accountId || "",
        accountLabel: batchPayload.accountLabel || manifestEntry.accountLabel || "",
        accountName: batchPayload.accountName || manifestEntry.accountLabel || "",
        emailSourceKind: batchPayload.emailSourceKind || manifestEntry.emailSourceKind || "",
      }),
      manifestEntry
    );
    if (shouldUpdateResumeSource(record, sourceMeta)) {
      updatedRecords.push({
        ...record,
        ...sourceMeta,
        updatedAt: record.updatedAt || new Date().toISOString(),
      });
    }
  }

  if (!updatedRecords.length) return;
  runSqlTransaction(() => {
    updatedRecords.forEach(upsertResumeRow);
  });
  console.log(`[${new Date().toISOString()}] [resume-source] 已补充来源字段：${updatedRecords.length} 份`);
}

async function ensureDatabase() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(BATCH_UPLOAD_DIR, { recursive: true });
  await fs.mkdir(BOSS_RESUMES_DIR, { recursive: true });
  await fs.mkdir(ZHILIAN_RESUMES_DIR, { recursive: true });
  await fs.mkdir(JOB51_RESUMES_DIR, { recursive: true });
  getDb();
  ensureRuleSuggestionJobTypeColumn();
  if (!databaseInitialized) {
    await migrateLegacyJsonIfNeeded();
    await dedupeSqliteResumesIfNeeded();
    await deepBackfillAnalyzedResumesIfNeeded();
    backfillRuleSuggestionJobTypesIfNeeded();
    ensureAiV4AdoptedRulesIfNeeded();
    await backfillResumeSourceMetadata();
    backfillPositionRuleScores();
    databaseInitialized = true;
  }
}

async function readDatabase() {
  await ensureDatabase();
  const rows = getDb()
    .prepare("SELECT payload FROM resumes ORDER BY updated_at DESC")
    .all();
  return rows.map((row) => parsePayload(row.payload)).filter((record) => record && record.id);
}

async function writeDatabase(records) {
  await ensureDatabase();
  const uniqueRecords = getUniqueCandidateRecords(records.filter((record) => record && record.id));
  runSqlTransaction((db) => {
    db.prepare("DELETE FROM resumes").run();
    uniqueRecords.forEach(upsertResumeRow);
  });
}

function backfillPositionRuleScores() {
  const db = getDb();
  const rows = db.prepare("SELECT payload FROM resumes").all();
  let changed = 0;
  const scoredRecords = rows
    .map((row) => parsePayload(row.payload))
    .filter((record) => record && record.id)
    .map((record) => {
      const scored = applyPositionRuleScoring(record);
      if (recordsNeedScoreUpdate(record, scored)) changed += 1;
      return scored;
    });

  if (!changed) return;
  runSqlTransaction(() => {
    scoredRecords.forEach(upsertResumeRow);
  });
  console.log(`[${new Date().toISOString()}] [resume-scoring] 已按岗位规则补算匹配度：${changed} 份`);
}

function normalizeSchoolLevel(schoolLevel, school) {
  const level = String(schoolLevel || "").trim();
  const schoolName = String(school || "").trim();

  if (/985|211|双一流|海外院校|海外/.test(level)) {
    return level || "待确认";
  }

  if (
    /大专|专科|高职/.test(level) ||
    /高等专科学校|专科学校|职业技术学院|职业学院|高职|技师学院/.test(schoolName)
  ) {
    return "大专";
  }

  if (/一本|本科一批|一批/.test(level)) return "一本";
  if (/二本|本科二批|二批/.test(level)) return "二本";

  if (/职业技术大学|职业大学/.test(schoolName)) {
    return "二本";
  }

  if (/本科|普通本科/.test(level) || schoolName) {
    if (schoolName.includes("大学")) return "一本";
    if (schoolName.includes("学院")) return "二本";
  }

  return level || "待确认";
}

function normalizeJobType(jobType, context = "") {
  const value = String(jobType || "").trim();
  if (RESUME_LIBRARY_JOB_TYPES.includes(value)) return value;

  const text = `${value} ${String(context || "")}`;
  if (/AI应用开发实习生|AI实习生|AI应用开发工程师|AI开发工程师|人工智能实习|智能体实习|Agent实习|智能体开发工程师/i.test(text)) {
    return AI_SCORING_JOB_TYPE;
  }
  if (/应用技术经理|应用技术管培|应用技术|技术服务|技术支持|工业涂料|涂料领域|涂料应用|涂料研发|材料应用|流变助剂/i.test(text)) {
    return "应用技术经理（工业涂料领域）";
  }
  if (/石油钻井|钻井泥浆|石油.*膨润土|石油助剂|油田|油服|销售工程师（石油钻井泥浆膨润土）/i.test(text)) {
    return "销售工程师（石油钻井泥浆膨润土）_湖州";
  }
  if (/膨润土销售人员|膨润土销售|膨润土业务|涂料原料销售/i.test(text)) return "膨润土销售人员";
  if (/销售管培|销售管理培训|营销管培/i.test(text)) return "销售管培生";
  if (/人力资源管培|人资管培|人力资源管理培训/i.test(text)) return "人力资源管培生";
  if (/HRBP|hrbp|人力资源|招聘|HR|员工关系|薪酬|绩效/i.test(text)) return "HRBP";
  if (/\u7535\u6c14|PLC|HMI|\u4e0a\u4f4d\u673a|\u81ea\u52a8\u5316|\u7535\u63a7|\u4eea\u63a7|\u63a5\u7ebf|\u8054\u52a8|\u8c03\u8bd5|CAD|\u673a\u7535/i.test(text)) return "\u7535\u6c14\u5de5\u7a0b\u5e08";
  if (/国际业务管培|国际|外贸|海外|跨境|英语|商务英语|外贸销售|化工原料外贸/i.test(text)) return "国际业务管培生";
  if (/销售|客户开发|销售工程师|销售经理|市场|商务/i.test(text)) return "膨润土销售人员";
  return DEFAULT_JOB_TYPE;
}

function isAiScoringJobType(jobType, context = "") {
  return normalizeJobType(jobType || DEFAULT_JOB_TYPE, context) === AI_SCORING_JOB_TYPE;
}

function getBaseScoringMeta(jobType = DEFAULT_JOB_TYPE) {
  if (isAiScoringJobType(jobType)) {
    return {
      version: AI_V4_SCORING_VERSION,
      name: AI_V4_SCORING_VERSION_NAME,
      description: AI_V4_SCORING_VERSION_DESCRIPTION,
      ruleScope: "Agent项目深度评分（项目经历65分 + 技术栈35分）",
    };
  }

  return {
    version: POSITION_SCORING_VERSION,
    name: POSITION_SCORING_VERSION_NAME,
    description: POSITION_SCORING_VERSION_DESCRIPTION,
    ruleScope: "岗位必须项 / 加分项 / 风险项",
  };
}

function sanitizeResumeFields(input = {}) {
  const rawScore = input.matchScore;
  const numericScore = rawScore === "" || rawScore === null || rawScore === undefined ? NaN : Number(rawScore);
  const normalizedJobType = normalizeJobType(input.jobType, `${input.fileName || ""} ${input.name || ""} ${input.school || ""}`);
  const matchScore = Number.isFinite(numericScore)
    ? Math.max(0, Math.min(100, Math.round(numericScore)))
    : "";
  const school = String(input.school || "").trim();
  const major = String(
    input.major ||
      input.details?.major ||
      input.education?.major ||
      input.specialty ||
      input.profession ||
      ""
  ).trim();

  return {
    name: String(input.name || "").trim(),
    phone: String(input.phone || "").trim(),
    jobType: normalizedJobType,
    school,
    major,
    schoolLevel: normalizeSchoolLevel(input.schoolLevel, school),
    graduation: String(input.graduation || "").trim(),
    matchScore,
  };
}

function sanitizeResumeDetails(input = {}) {
  const scoreBreakdownInput = input.scoreBreakdown && typeof input.scoreBreakdown === "object" ? input.scoreBreakdown : {};
  const parseQualityInput = input.parseQuality && typeof input.parseQuality === "object" ? input.parseQuality : {};
  const projectsInput = Array.isArray(input.projects) ? input.projects : [];
  const missingFields = normalizeStringArray(parseQualityInput.missingFields || input.missingFields).slice(0, 12);
  const warnings = normalizeStringArray(parseQualityInput.warnings || input.parseWarnings).slice(0, 12);
  const confidence = normalizeScoreValue(parseQualityInput.confidence ?? input.confidence);

  return {
    scoreBreakdown: {
      projectScore: normalizeBoundedScore(scoreBreakdownInput.projectScore, 100),
      techScore: normalizeBoundedScore(scoreBreakdownInput.techScore, 100),
      summary: String(scoreBreakdownInput.summary || "").trim(),
      strengths: normalizeStringArray(scoreBreakdownInput.strengths).slice(0, 8),
      risks: normalizeStringArray(scoreBreakdownInput.risks).slice(0, 8),
      evidence: normalizeStringArray(scoreBreakdownInput.evidence).slice(0, 8),
    },
    parseQuality: {
      confidence,
      missingFields,
      warnings,
      needsManualReview: normalizeBoolean(parseQualityInput.needsManualReview) || Boolean(missingFields.length || warnings.length),
    },
    projects: projectsInput.slice(0, 10).map((project) => ({
      name: String(project?.name || "").trim(),
      role: String(project?.role || "").trim(),
      description: String(project?.description || "").trim(),
      agentRelated: normalizeBoolean(project?.agentRelated),
      depth: String(project?.depth || "unknown").trim(),
      evidence: String(project?.evidence || "").trim(),
    })),
  };
}

function normalizePhoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("86")) {
    return digits.slice(2);
  }
  return digits;
}

function getNumericScore(record) {
  if (record.matchScore === "" || record.matchScore === null || record.matchScore === undefined) return -1;
  const score = Number(record.matchScore);
  return Number.isFinite(score) ? score : -1;
}

function getRankedRecords(records) {
  return [...records].sort((left, right) => {
    const scoreDiff = getNumericScore(right) - getNumericScore(left);
    if (scoreDiff !== 0) return scoreDiff;
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
}

function getCandidatePrimaryKey(record) {
  const phoneKey = normalizePhoneKey(record.phone);
  if (phoneKey) return `phone:${phoneKey}`;
  const nameKey = String(record.name || "").replace(/\s+/g, "");
  const jobKey = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const schoolKey = String(record.school || "").replace(/\s+/g, "");
  if (nameKey && (jobKey || schoolKey)) return `name:${nameKey}|job:${jobKey}|school:${schoolKey}`;
  return `id:${record.id}`;
}

function getUniqueCandidateRecords(records) {
  const seen = new Set();
  return getRankedRecords(records).filter((record) => {
    const key = getCandidatePrimaryKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getRecordRank(records, id, jobType = "") {
  const rankedRecords = getUniqueCandidateRecords(records);
  const record = rankedRecords.find((item) => item.id === id);
  const rankBase = jobType || record?.jobType || "";
  const visibleRecords = rankBase
    ? rankedRecords.filter((item) => normalizeJobType(item.jobType, `${item.fileName || ""} ${item.name || ""}`) === normalizeJobType(rankBase))
    : rankedRecords;
  const index = visibleRecords.findIndex((item) => item.id === id);
  return index >= 0 ? index + 1 : null;
}

function findDuplicateByPhone(records, phone, ignoredId = "") {
  const phoneKey = normalizePhoneKey(phone);
  if (!phoneKey) return null;
  const matches = records.filter(
    (record) => record.id !== ignoredId && normalizePhoneKey(record.phone) === phoneKey
  );
  return getRankedRecords(matches)[0] || null;
}

function findDuplicateCandidateRecord(records, candidate, ignoredId = "") {
  const phoneDuplicate = findDuplicateByPhone(records, candidate?.phone, ignoredId);
  if (phoneDuplicate) return phoneDuplicate;

  const candidateKey = getCandidatePrimaryKey(candidate || {});
  if (!candidateKey || candidateKey.startsWith("id:")) return null;
  const matches = records.filter(
    (record) => record.id !== ignoredId && getCandidatePrimaryKey(record) === candidateKey
  );
  return getRankedRecords(matches)[0] || null;
}

function normalizeRuleSuggestionText(value) {
  if (value === null || value === undefined || value === "") return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return "";
    if (
