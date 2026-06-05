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
const ZHILIAN_B_AGENT_URL = process.env.ZHILIAN_B_AGENT_URL || process.env.ZHILIAN_SECONDARY_AGENT_URL || "";
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

async function fetchAutomationSummary(sourceKey) {
  const source = AUTOMATION_SUMMARY_SOURCES[sourceKey] || AUTOMATION_SUMMARY_SOURCES.zhilian;
  if (!source?.baseUrl) {
    const error = new Error(`${source?.label || sourceKey} 自动化服务未配置`);
    error.statusCode = 502;
    throw error;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const targetUrl = `${source.baseUrl.replace(/\/+$/, "")}/api/recruiter-automation/summary?platform=${encodeURIComponent(
      source.platform
    )}`;
    const result = await fetch(targetUrl, { signal: controller.signal });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) {
      throw new Error(payload.error || `${source.label} 自动化统计读取失败`);
    }
    return {
      ...payload,
      source: sourceKey,
      sourceLabel: source.label,
      sourceBaseUrl: source.baseUrl,
    };
  } finally {
    clearTimeout(timeoutId);
  }
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
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        const parsedText = normalizeRuleSuggestionText(parsed);
        if (parsedText) return parsedText;
      } catch {
        // Keep the original text when it only looks like JSON.
      }
    }
    return trimmed;
  }

  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeRuleSuggestionText(item))
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
  const score = value.scoreDelta ?? value.weight ?? value.points ?? value.score;

  if (primary && primary !== value) lines.push(normalizeRuleSuggestionText(primary));
  if (dimension) lines.push(`维度：${normalizeRuleSuggestionText(dimension)}`);
  if (reason) lines.push(`原因：${normalizeRuleSuggestionText(reason)}`);
  if (evidence) lines.push(`依据：${normalizeRuleSuggestionText(evidence)}`);
  if (before || after) {
    lines.push(`调整：${normalizeRuleSuggestionText(before) || "-"} -> ${normalizeRuleSuggestionText(after) || "-"}`);
  }
  if (score !== undefined && score !== null && score !== "") {
    lines.push(`分值/权重：${normalizeRuleSuggestionText(score)}`);
  }

  if (lines.length) return lines.filter(Boolean).join("\n");

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "").trim();
  }
}

function normalizeRuleSuggestionArray(value) {
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => normalizeRuleSuggestionText(item))
    .filter(Boolean);
}

function sanitizeFeedback(input = {}) {
  const decision = String(input.decision || "pending").trim();
  const allowedDecisions = new Set(["suitable", "unsuitable", "pending", "interview"]);
  return {
    decision: allowedDecisions.has(decision) ? decision : "pending",
    positiveTags: normalizeStringArray(input.positiveTags),
    negativeTags: normalizeStringArray(input.negativeTags),
    dimensions: normalizeStringArray(input.dimensions),
    reason: String(input.reason || "").trim(),
    affectsScoring: Boolean(input.affectsScoring),
    reviewedAt: "",
    review: null,
  };
}

function publicRuleSuggestion(row) {
  const payload = parsePayload(row.payload, {});
  return {
    id: row.id,
    resumeId: row.resume_id,
    jobType: normalizeJobType(row.job_type || payload.jobType || DEFAULT_JOB_TYPE),
    suggestion:
      normalizeRuleSuggestionText(row.suggestion) ||
      normalizeRuleSuggestionText(payload.suggestion) ||
      normalizeRuleSuggestionText(payload.suggestedRuleChanges),
    status: row.status,
    sourceSummary: row.source_summary || "",
    resumeName: payload.resumeName || "",
    resumePhone: payload.resumePhone || "",
    createdAt: row.created_at,
    adoptedAt: row.adopted_at || "",
    rejectedAt: row.rejected_at || "",
  };
}

function listRuleSuggestionRows(jobType = "") {
  const normalizedJobType = jobType ? normalizeJobType(jobType) : "";
  const whereClause = normalizedJobType ? "WHERE job_type = ?" : "";
  const statement = getDb().prepare(
    `SELECT id, resume_id, job_type, suggestion, status, source_summary, payload, created_at, adopted_at, rejected_at, updated_at
     FROM rule_suggestions
     ${whereClause}
     ORDER BY
       CASE status WHEN 'pending' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END,
       created_at DESC`
  );
  return normalizedJobType ? statement.all(normalizedJobType) : statement.all();
}

function createRuleSuggestionsFromFeedback(record, feedback) {
  const suggestions = normalizeRuleSuggestionArray(feedback?.review?.suggestedRuleChanges).slice(0, 12);
  if (!feedback?.affectsScoring || !suggestions.length) return [];

  const now = new Date().toISOString();
  const inserted = [];
  const db = getDb();
  const jobType = normalizeJobType(record.jobType || DEFAULT_JOB_TYPE);
  const insert = db.prepare(`
    INSERT INTO rule_suggestions
      (id, resume_id, job_type, suggestion, status, source_summary, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `);

  suggestions.forEach((suggestion) => {
    const id = crypto.randomUUID();
    insert.run(
      id,
      record.id,
      jobType,
      suggestion,
      feedback.review?.summary || "",
      JSON.stringify({
        jobType,
        resumeName: record.name || "",
        resumePhone: record.phone || "",
        decision: feedback.decision,
        positiveTags: feedback.positiveTags,
        negativeTags: feedback.negativeTags,
        dimensions: feedback.dimensions,
        reason: feedback.reason,
        scoreDiagnosis: feedback.review?.scoreDiagnosis || "",
        suggestedRuleChanges: suggestions,
      }),
      now,
      now
    );
    inserted.push(id);
  });

  return inserted;
}

function getAdoptedRulesText() {
  try {
    const rows = listAdoptedRuleRows();

    if (!rows.length) return "";
    return `\n\n以下是人工审核后已采纳的评分规则补充，后续解析和评分必须参考：\n${rows
      .map((row, index) => `${index + 1}. 【${normalizeJobType(row.job_type || DEFAULT_JOB_TYPE)}】${normalizeRuleSuggestionText(row.suggestion)}`)
      .filter((line) => !line.endsWith("】"))
      .join("\n")}`;
  } catch {
    return "";
  }
}

function listAdoptedRuleRows(limit = 30, jobType = "") {
  const normalizedJobType = jobType ? normalizeJobType(jobType) : "";
  const whereClause = normalizedJobType ? "WHERE status = 'adopted' AND job_type = ?" : "WHERE status = 'adopted'";
  const statement = getDb().prepare(
    `SELECT id, resume_id, job_type, suggestion, source_summary, payload, created_at, adopted_at
     FROM rule_suggestions
     ${whereClause}
     ORDER BY adopted_at ASC, created_at ASC
     LIMIT ?`
  );
  return normalizedJobType ? statement.all(normalizedJobType, limit) : statement.all(limit);
}

function getCurrentScoringVersion(jobType = DEFAULT_JOB_TYPE) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const baseMeta = getBaseScoringMeta(normalizedJobType);

  try {
    const adoptedCount = getDb()
      .prepare("SELECT COUNT(*) AS count FROM rule_suggestions WHERE status = 'adopted' AND job_type = ?")
      .get(normalizedJobType).count;
    return adoptedCount ? `${baseMeta.version}+rules-${adoptedCount}` : baseMeta.version;
  } catch {
    return baseMeta.version;
  }
}

function getScoringVersionMeta(version = "", jobType = DEFAULT_JOB_TYPE) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const baseMeta = getBaseScoringMeta(normalizedJobType);
  const rawVersion = String(version || getCurrentScoringVersion(normalizedJobType) || baseMeta.version);
  const match = rawVersion.match(/^(.+?)(?:\+rules-(\d+))?$/);
  const baseVersion = match?.[1] || rawVersion;
  const adoptedRuleCount = match?.[2] ? Number(match[2]) : 0;
  const isKnownBase = baseVersion === baseMeta.version;

  return {
    version: rawVersion,
    baseVersion,
    displayName: isKnownBase ? baseMeta.name : `评分版本 ${baseVersion}`,
    description: isKnownBase ? baseMeta.description : SCORING_VERSION_DESCRIPTION,
    adoptedRuleCount,
    ruleScope: adoptedRuleCount
      ? `${baseMeta.ruleScope} + ${adoptedRuleCount} 条人工补充规则`
      : baseMeta.ruleScope,
    isCurrent: rawVersion === getCurrentScoringVersion(normalizedJobType),
  };
}

function getAppliedAdoptedRulesForVersion(version = "", jobType = DEFAULT_JOB_TYPE) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);

  const rawVersion = String(version || "");
  if (!rawVersion) return listAdoptedRuleRows(30, normalizedJobType);

  const match = rawVersion.match(/\+rules-(\d+)$/);
  const limit = match?.[1] ? Number(match[1]) : 0;
  return limit > 0 ? listAdoptedRuleRows(limit, normalizedJobType) : [];
}

function getPositionScoringDefinition(jobType) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const direct = POSITION_SCORING_RULES[normalizedJobType] || null;
  if (!direct) return null;
  if (!direct.inherit) return direct;
  const base = POSITION_SCORING_RULES[direct.inherit] || {};
  return {
    ...base,
    ...direct,
    mustHave: direct.mustHave || base.mustHave || [],
    bonus: direct.bonus || base.bonus || [],
    risks: direct.risks || base.risks || [],
  };
}

function buildPositionScoringDimensions(definition = {}) {
  return [
    {
      name: "必须项",
      weight: "优先级最高",
      logic: "必须项用于判断候选人是否进入后续复核；缺失时不要因为关键词或加分项给高优先级。",
      items: definition.mustHave || [],
    },
    {
      name: "加分项",
      weight: "排序增强",
      logic: "加分项用于区分优先级；命中越多越值得优先看，但不能替代必须项。",
      items: definition.bonus || [],
    },
    {
      name: "风险项",
      weight: "降级/复核",
      logic: "风险项命中时需要降级或人工复核，避免纯关键词匹配误判。",
      items: definition.risks || [],
    },
  ].filter((dimension) => dimension.items.length);
}

function truncateFeedbackTag(text, maxLength = 28) {
  const value = String(text || "")
    .replace(/[。；;，,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function uniqueLimitedStrings(values, limit = 14) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function buildFeedbackTagOptions(jobType, definition = null) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const mustHave = Array.isArray(definition?.mustHave) ? definition.mustHave : [];
  const bonus = Array.isArray(definition?.bonus) ? definition.bonus : [];
  const risks = Array.isArray(definition?.risks) ? definition.risks : [];

  if (!definition) {
    return {
      positiveTags: ["基础信息完整", "岗位归类可信", "经历可复核", "表达清楚"],
      negativeTags: ["基础信息不足", "岗位归类存疑", "经历不清楚", "需要人工复核"],
      dimensions: ["岗位归类", "基础信息", "经历完整度", "表达质量", "人工复核"],
    };
  }

  return {
    positiveTags: uniqueLimitedStrings([
      "必须项满足",
      "加分项突出",
      `${normalizedJobType}岗位匹配`,
      ...mustHave.map((item) => `满足：${truncateFeedbackTag(item)}`),
      ...bonus.map((item) => `加分：${truncateFeedbackTag(item)}`),
      "经历真实完整",
      "表达沟通好",
    ]),
    negativeTags: uniqueLimitedStrings([
      "必须项缺失",
      "信息不足",
      "表达不清",
      `${normalizedJobType}岗位不匹配`,
      ...mustHave.map((item) => `缺失：${truncateFeedbackTag(item)}`),
      ...risks.map((item) => `风险：${truncateFeedbackTag(item)}`),
    ]),
    dimensions: uniqueLimitedStrings([
      "必须项",
      "加分项",
      "风险项",
      `${normalizedJobType}岗位适配`,
      "行业/产品经验",
      "项目或职责证据",
      "学历专业",
      "表达质量",
      "信息完整度",
    ], 12),
  };
}

function getCurrentScoringRules(jobType, version = "") {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  const scoringVersion = String(version || getCurrentScoringVersion(normalizedJobType));
  const versionMeta = getScoringVersionMeta(scoringVersion, normalizedJobType);
  const scoringDefinition = getPositionScoringDefinition(normalizedJobType);
  const isAiV4 = isAiScoringJobType(normalizedJobType);

  if (!scoringDefinition) {
    return {
      jobType: normalizedJobType,
      scoringVersion,
      versionMeta,
      rules: {
        title: `${normalizedJobType}评分规则`,
        description:
          "当前岗位还没有配置专属必须项和加分项，暂时只做简历基础信息提取、岗位归类和人工复核。",
        dimensions: [],
        scoreBands: [
          "优先补齐该岗位的必须项、加分项和风险项。",
          "未配置前不要自动给出高优先级判断。"
        ],
      },
      feedbackTags: buildFeedbackTagOptions(normalizedJobType, null),
    };
  }

  return {
    jobType: normalizedJobType,
    scoringVersion,
    versionMeta,
    rules: {
      title: scoringDefinition.title || `${normalizedJobType}评分规则`,
      description: isAiV4
        ? AI_V4_SCORING_VERSION_DESCRIPTION
        : scoringDefinition.description || "按岗位必须项、加分项和风险项进行复核。",
      dimensions: isAiV4 ? buildAiV4ScoringDimensions(scoringDefinition) : buildPositionScoringDimensions(scoringDefinition),
      scoreBands: isAiV4
        ? [
            "项目经历最多 65 分：必须先有Agent/RAG/大模型应用项目门槛，再看项目证据、本人职责、工程落地和模块深度。",
            "技术栈最多 35 分：重点看LLM Agent、RAG、工具调用、Prompt、大模型、后端服务化和部署能力。",
            "三条已采纳回灌会额外影响人工复核方向：LoRA/QLoRA微调能力、Agent能力纵深、RAG技术深度校验。",
          ]
        : [
            "A：必须项明确满足，并命中多个高价值加分项，建议优先查看。",
            "B：必须项基本满足，有部分加分项，建议进入人工复核。",
            "C：必须项信息不足，或只命中少量加分项，暂缓判断。",
            "D：关键必须项缺失，或命中明显风险项，建议跳过或人工确认。",
          ],
    },
    feedbackTags: buildFeedbackTagOptions(normalizedJobType, scoringDefinition),
  };
}

function readJdTagOverrides() {
  try {
    const payload = JSON.parse(fsSync.readFileSync(JD_TAG_OVERRIDES_PATH, "utf8"));
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

async function writeJdTagOverrides(overrides) {
  await fs.mkdir(path.dirname(JD_TAG_OVERRIDES_PATH), { recursive: true });
  await fs.writeFile(JD_TAG_OVERRIDES_PATH, JSON.stringify(overrides || {}, null, 2), "utf8");
}

function normalizeJdTagGroup(group) {
  const value = String(group || "").trim();
  if (value === "mustHave" || value === "bonus" || value === "risks") return value;
  if (/risk|风险/i.test(value)) return "risks";
  if (/bonus|加分/i.test(value)) return "bonus";
  return "mustHave";
}

function uniqueJdTags(values, limit = 80) {
  const seen = new Set();
  const tags = [];
  for (const value of values || []) {
    const tag = String(value || "").trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= limit) break;
  }
  return tags;
}

function applyJdTagOverrides(profileId, group, baseTags, overrides = readJdTagOverrides()) {
  const entry = overrides?.[profileId]?.[group] || {};
  const removed = new Set(normalizeStringArray(entry.removed));
  return uniqueJdTags([...normalizeStringArray(baseTags), ...normalizeStringArray(entry.added)]).filter((tag) => !removed.has(tag));
}

function buildJdDimensions(profileId, scoringDefinition, overrides = readJdTagOverrides()) {
  const mustHave = applyJdTagOverrides(profileId, "mustHave", scoringDefinition?.mustHave || [], overrides);
  const bonus = applyJdTagOverrides(profileId, "bonus", scoringDefinition?.bonus || [], overrides);
  const risks = applyJdTagOverrides(profileId, "risks", scoringDefinition?.risks || [], overrides);
  return [
    {
      key: "mustHave",
      name: "必须项",
      weight: "45%",
      logic: "必须项是 JD 匹配的主体；完全缺失时会限制最终等级。",
      tags: mustHave,
    },
    {
      key: "bonus",
      name: "加分项",
      weight: "35%",
      logic: "加分项用于区分优先级，命中越多越靠前。",
      tags: bonus,
    },
    {
      key: "risks",
      name: "风险项",
      weight: "降级",
      logic: "风险项命中时会扣分，并进入人工复核。",
      tags: risks,
    },
  ].filter((dimension) => dimension.tags.length);
}

function buildJdProfile(definition, overrides = readJdTagOverrides()) {
  const scoringDefinition = getPositionScoringDefinition(definition.jobType) || {};
  const dimensions = buildJdDimensions(definition.id, scoringDefinition, overrides);
  const tags = uniqueJdTags(dimensions.flatMap((dimension) => dimension.tags));
  return {
    id: definition.id,
    title: scoringDefinition.title || `${definition.jobType} JD 匹配`,
    shortTitle: definition.shortTitle || definition.jobType,
    matchedJobTypes: uniqueJdTags(definition.matchedJobTypes || [definition.jobType]),
    sourceJobNames: uniqueJdTags([definition.jobType, ...(definition.matchedJobTypes || [])]),
    targetRoles: uniqueJdTags(definition.targetRoles || [definition.jobType]),
    sources: [{ name: `${definition.jobType}岗位评分规则` }],
    tags,
    rules: {
      title: scoringDefinition.title || `${definition.jobType} JD 匹配规则`,
      description: scoringDefinition.description || "根据岗位必须项、加分项和风险项进行 JD 匹配。",
      targetRoles: uniqueJdTags(definition.targetRoles || [definition.jobType]),
      sourceJobNames: uniqueJdTags([definition.jobType, ...(definition.matchedJobTypes || [])]),
      matchedJobTypes: uniqueJdTags(definition.matchedJobTypes || [definition.jobType]),
      tags,
      dimensions,
      synonymHints: [
        "销售/客户开发/商务拓展可互相参考。",
        "技术支持/应用测试/配方服务可互相参考。",
        "HRBP/人力资源/招聘支持可互相参考。",
      ],
      reviewChecklist: [
        "先看必须项是否有明确证据。",
        "再看加分项是否来自真实项目或工作经历。",
        "命中风险项时不要只按关键词高排。",
      ],
      boosts: [
        "简历岗位归属与当前 JD 一致时加权。",
        "文件名、专业、经历中出现岗位核心词时加权。",
      ],
      scoreBands: [
        "A：75 分及以上，必须项和加分项都有较好命中。",
        "B：55-74 分，基本匹配，建议人工复核。",
        "C：35-54 分，信息不足或只命中部分标签。",
        "D：35 分以下，关键项缺失或风险较多。",
      ],
      guardrails: [
        "必须项完全未命中时最高 C。",
        "风险项命中 2 条及以上时最高 B。",
      ],
    },
  };
}

function listJdProfiles() {
  const overrides = readJdTagOverrides();
  return JD_PROFILE_DEFINITIONS.map((definition) => buildJdProfile(definition, overrides));
}

function findJdProfile(profileId) {
  const id = String(profileId || "").trim();
  return listJdProfiles().find((profile) => profile.id === id) || null;
}

function normalizeJdSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function getResumeSearchText(record = {}) {
  return normalizeJdSearchText(
    [
      record.name,
      record.phone,
      record.jobType,
      record.major,
      record.school,
      record.schoolLevel,
      record.graduation,
      record.fileName,
      JSON.stringify(record.projects || []),
      JSON.stringify(record.scoreBreakdown || {}),
      JSON.stringify(record.parseQuality || {}),
      JSON.stringify(record.feedback || {}),
    ].join(" ")
  );
}

function buildAiV4ResumeMatchText(record = {}) {
  return [
    record.name,
    record.phone,
    record.jobType,
    record.major,
    record.school,
    record.schoolLevel,
    record.graduation,
    record.fileName,
    record.source,
    record.sourceLabel,
    JSON.stringify(record.projects || []),
    JSON.stringify(record.parseQuality?.warnings || []),
  ].join(" ");
}

function getAiV4RuleHitLabels(text, rules = []) {
  const source = String(text || "");
  return rules.filter((rule) => rule.pattern.test(source)).map((rule) => rule.label);
}

function calculateAiV4MatchScoreDetails(text) {
  const source = String(text || "");
  const hasAgentProject = AI_V4_AGENT_PROJECT_GATE_PATTERNS.some((pattern) => pattern.test(source));
  const projectHits = hasAgentProject ? getAiV4RuleHitLabels(source, AI_V4_PROJECT_RULES) : [];
  const skillHits = getAiV4RuleHitLabels(source, AI_V4_SKILL_RULES);
  const projectScoreRaw = (projectHits.length / AI_V4_PROJECT_RULES.length) * 65;
  const techScoreRaw = (skillHits.length / AI_V4_SKILL_RULES.length) * 35;

  return {
    score: Math.max(0, Math.min(100, Math.round(projectScoreRaw + techScoreRaw))),
    projectScore: Math.max(0, Math.min(65, Math.round(projectScoreRaw))),
    techScore: Math.max(0, Math.min(35, Math.round(techScoreRaw))),
    projectHits,
    skillHits,
    hasAgentProject,
  };
}

function buildAiV4ScoringDimensions() {
  return [
    {
      name: "项目经历",
      weight: "65分",
      logic: "先命中Agent/RAG/大模型应用项目门槛，再按项目证据、本人职责、工程落地和Agent/RAG模块深度计分。",
      items: AI_V4_PROJECT_RULES.map((rule) => rule.label),
    },
    {
      name: "技术栈",
      weight: "35分",
      logic: "按LLM Agent开发栈、RAG、工具调用、Prompt、大模型、后端服务化和部署能力计分。",
      items: AI_V4_SKILL_RULES.map((rule) => rule.label),
    },
  ];
}

function cleanJdKeyword(value) {
  return String(value || "")
    .replace(/^(有|懂|熟悉|具备|能够|能接受|接受|必须|需要|优先|同时|明确|重点看)/, "")
    .replace(/(之一|优先|作为核心判断项|相关|经验|经历|背景|能力|方向|岗位)$/g, "")
    .replace(/[“”"'.。；;，,]+/g, "")
    .trim();
}

function extractJdKeywords(tags = []) {
  const values = [];
  for (const tag of tags || []) {
    const text = String(tag || "");
    const parts = text.split(/[，,。、；;：:（）()\s/]+|或|和|及|与|、/g);
    for (const part of parts) {
      const clean = cleanJdKeyword(part);
      if (clean.length >= 2 && !JD_MATCH_STOP_WORDS.has(clean)) values.push(clean);
    }
    const latin = text.match(/[A-Za-z][A-Za-z0-9+#.-]{1,}/g) || [];
    values.push(...latin);
  }
  return uniqueJdTags(values, 120);
}

function matchJdKeywords(tags, searchText) {
  const matched = [];
  for (const keyword of extractJdKeywords(tags)) {
    const normalized = normalizeJdSearchText(keyword);
    if (normalized.length >= 2 && searchText.includes(normalized)) matched.push(keyword);
  }
  return uniqueJdTags(matched, 60);
}

function matchJdRuleItems(tags, searchText) {
  const matchedItems = [];
  const matchedKeywords = [];
  for (const tag of tags || []) {
    const keywords = extractJdKeywords([tag]);
    const itemMatches = keywords.filter((keyword) => {
      const normalized = normalizeJdSearchText(keyword);
      return normalized.length >= 2 && searchText.includes(normalized);
    });
    if (!itemMatches.length) continue;
    matchedItems.push(tag);
    matchedKeywords.push(...itemMatches);
  }
  return {
    items: uniqueJdTags(matchedItems, 60),
    keywords: uniqueJdTags(matchedKeywords, 60),
  };
}

function profileMatchesResume(profile, record) {
  const recordJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const matchedJobTypes = new Set((profile?.matchedJobTypes || []).map((jobType) => normalizeJobType(jobType)));
  return matchedJobTypes.size === 0 || matchedJobTypes.has(recordJobType);
}

function getJdLevel(score) {
  if (score >= 75) return "A 优先";
  if (score >= 55) return "B 复核";
  if (score >= 35) return "C 暂缓";
  return "D 不优先";
}

function calculateJdMatch(record, profile) {
  const searchText = getResumeSearchText(record);
  const dimensions = profile.rules?.dimensions || [];
  const must = dimensions.find((dimension) => dimension.key === "mustHave") || { tags: [] };
  const bonus = dimensions.find((dimension) => dimension.key === "bonus") || { tags: [] };
  const risks = dimensions.find((dimension) => dimension.key === "risks") || { tags: [] };
  const mustMatches = matchJdRuleItems(must.tags, searchText);
  const bonusMatches = matchJdRuleItems(bonus.tags, searchText);
  const riskMatches = matchJdRuleItems(risks.tags, searchText);
  const matchedKeywords = uniqueJdTags([...mustMatches.keywords, ...bonusMatches.keywords, ...riskMatches.keywords], 30);
  const mustRatio = must.tags?.length ? mustMatches.items.length / Math.max(1, must.tags.length) : 0;
  const bonusRatio = bonus.tags?.length ? bonusMatches.items.length / Math.max(1, bonus.tags.length) : 0;
  const recordJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const roleBoost = (profile.matchedJobTypes || []).some((jobType) => normalizeJobType(jobType) === recordJobType) ? 15 : 0;
  const focusBoost = matchedKeywords.some((keyword) => searchText.includes(normalizeJdSearchText(keyword))) ? 5 : 0;
  const riskPenalty = Math.min(30, riskMatches.items.length * 10);
  let score = Math.round(mustRatio * 50 + bonusRatio * 30 + roleBoost + focusBoost - riskPenalty);
  const capReasons = [];
  if ((must.tags || []).length && !mustMatches.items.length) {
    score = Math.min(score, 45);
    capReasons.push("必须项未命中");
  }
  if ((must.tags || []).length && mustRatio > 0 && mustRatio < 0.5) {
    score = Math.min(score, 68);
    capReasons.push("必须项命中不足一半");
  }
  if (riskMatches.items.length >= 2) {
    score = Math.min(score, 74);
    capReasons.push("风险项较多");
  }
  score = Math.max(0, Math.min(100, score));
  const level = getJdLevel(score);
  return {
    resumeId: record.id,
    name: record.name || "",
    phone: record.phone || "",
    jobType: recordJobType,
    score,
    level,
    profileId: profile.id,
    profileTitle: profile.title,
    profileShortTitle: profile.shortTitle,
    matchedKeywords,
    suggestion: score >= 75 ? "建议优先查看" : score >= 55 ? "建议人工复核" : score >= 35 ? "信息不足，暂缓判断" : "不建议优先处理",
    breakdown: {
      core: mustMatches.items.length,
      industry: bonusMatches.items.length,
      capability: matchedKeywords.length,
      education: 0,
      bonus: bonusMatches.items.length,
      riskPenalty,
      roleBoost,
      focusBoost,
      capReasons,
    },
  };
}

function summarizeJdCounts(results = []) {
  const counts = { total: results.length, A: 0, B: 0, C: 0, D: 0 };
  for (const result of results) {
    const key = String(result.level || "D").charAt(0);
    if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
  }
  return counts;
}

function buildAutoJdProfileForJobType(jobType) {
  const normalizedJobType = normalizeJobType(jobType || DEFAULT_JOB_TYPE);
  if (!getPositionScoringDefinition(normalizedJobType)) return null;
  return buildJdProfile({
    id: `auto_${normalizedJobType}`,
    jobType: normalizedJobType,
    shortTitle: normalizedJobType,
    matchedJobTypes: [normalizedJobType],
    targetRoles: [normalizedJobType],
  });
}

function findPositionRuleProfileForRecord(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const profiles = listJdProfiles().filter((profile) =>
    profileMatchesResume(profile, { ...record, jobType: normalizedJobType })
  );
  if (profiles.length) {
    return (
      profiles.find((profile) =>
        [...(profile.sourceJobNames || []), ...(profile.matchedJobTypes || [])].some(
          (jobType) => normalizeJobType(jobType) === normalizedJobType
        )
      ) || profiles[0]
    );
  }
  return buildAutoJdProfileForJobType(normalizedJobType);
}

function calculatePositionRuleMatch(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  const profile = findPositionRuleProfileForRecord({ ...record, jobType: normalizedJobType });
  if (!profile) return null;
  return calculateJdMatch({ ...record, jobType: normalizedJobType }, profile);
}

function applyAiV4Scoring(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || AI_SCORING_JOB_TYPE, `${record.fileName || ""} ${record.name || ""}`);
  const existingBreakdown = record.scoreBreakdown && typeof record.scoreBreakdown === "object" ? record.scoreBreakdown : {};
  const aiScore = calculateAiV4MatchScoreDetails(buildAiV4ResumeMatchText({ ...record, jobType: normalizedJobType }));
  const hitEvidence = uniqueLimitedStrings([...aiScore.projectHits, ...aiScore.skillHits], 8);

  return {
    ...record,
    jobType: normalizedJobType,
    matchScore: aiScore.score,
    jdMatch: null,
    scoreBreakdown: {
      ...existingBreakdown,
      projectScore: aiScore.projectScore,
      techScore: aiScore.techScore,
      summary: `v4 Agent项目深度评分 ${aiScore.score} 分：项目经历 ${aiScore.projectScore}/65，技术栈 ${aiScore.techScore}/35。`,
      strengths: uniqueLimitedStrings(
        [
          ...aiScore.projectHits.map((item) => `项目命中：${item}`),
          ...aiScore.skillHits.map((item) => `技术命中：${item}`),
        ],
        8
      ),
      risks: aiScore.hasAgentProject
        ? normalizeStringArray(existingBreakdown.risks).filter((item) => !/必须项|风险项扣分|命中不足/.test(item)).slice(0, 8)
        : uniqueLimitedStrings(["未命中Agent/RAG/大模型应用项目门槛"], 8),
      evidence: hitEvidence,
    },
    scoringVersion: getCurrentScoringVersion(normalizedJobType),
  };
}

function applyPositionRuleScoring(record = {}) {
  const normalizedJobType = normalizeJobType(record.jobType || "", `${record.fileName || ""} ${record.name || ""}`);
  if (isAiScoringJobType(normalizedJobType)) {
    return applyAiV4Scoring({ ...record, jobType: normalizedJobType });
  }

  const scoringResult = calculatePositionRuleMatch({ ...record, jobType: normalizedJobType });
  if (!scoringResult) {
    return {
      ...record,
      jobType: normalizedJobType,
      matchScore: normalizeScoreValue(record.matchScore),
      scoringVersion: getCurrentScoringVersion(normalizedJobType),
    };
  }

  const existingBreakdown = record.scoreBreakdown && typeof record.scoreBreakdown === "object" ? record.scoreBreakdown : {};
  const matchedKeywords = normalizeStringArray(scoringResult.matchedKeywords).slice(0, 8);
  const capReasons = normalizeStringArray(scoringResult.breakdown?.capReasons).slice(0, 4);
  const ruleRisks = [
    ...capReasons,
    scoringResult.breakdown?.riskPenalty ? `风险项扣分 ${scoringResult.breakdown.riskPenalty}` : "",
  ].filter(Boolean);

  return {
    ...record,
    jobType: normalizedJobType,
    matchScore: scoringResult.score,
    scoreBreakdown: {
      ...existingBreakdown,
      summary: `规则评分 ${scoringResult.score} 分（${scoringResult.level}）：${scoringResult.suggestion}`,
      strengths: uniqueLimitedStrings(
        [
          ...normalizeStringArray(existingBreakdown.strengths),
          ...matchedKeywords.map((keyword) => `命中：${keyword}`),
        ],
        8
      ),
      risks: uniqueLimitedStrings([...normalizeStringArray(existingBreakdown.risks), ...ruleRisks], 8),
      evidence: uniqueLimitedStrings(
        [
          ...normalizeStringArray(existingBreakdown.evidence),
          ...matchedKeywords,
          scoringResult.profileShortTitle ? `规则：${scoringResult.profileShortTitle}` : "",
        ],
        8
      ),
    },
    scoringVersion: getCurrentScoringVersion(normalizedJobType),
  };
}

function recordsNeedScoreUpdate(left = {}, right = {}) {
  return (
    String(left.jobType || "") !== String(right.jobType || "") ||
    String(left.matchScore ?? "") !== String(right.matchScore ?? "") ||
    String(left.scoringVersion || "") !== String(right.scoringVersion || "") ||
    JSON.stringify(left.scoreBreakdown || {}) !== JSON.stringify(right.scoreBreakdown || {})
  );
}

function publicRecord(record) {
  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    jobType: normalizeJobType(record.jobType, `${record.fileName || ""} ${record.name || ""} ${record.school || ""}`),
    school: record.school,
    major: record.major || "",
    schoolLevel: normalizeSchoolLevel(record.schoolLevel, record.school),
    graduation: record.graduation,
    matchScore: record.matchScore ?? "",
    scoreBreakdown: record.scoreBreakdown || null,
    parseQuality: record.parseQuality || null,
    projects: Array.isArray(record.projects) ? record.projects : [],
    fileName: record.fileName || "",
    parseMode: record.parseMode || "",
    source: record.source || "",
    sourceLabel: record.sourceLabel || "",
    sourceName: record.sourceName || "",
    sourcePlatform: record.sourcePlatform || "",
    platform: record.platform || "",
    importSource: record.importSource || "",
    accountId: record.accountId || "",
    accountName: record.accountName || "",
    hasPdf: Boolean(record.pdfPath),
    scoringVersion: record.scoringVersion || getCurrentScoringVersion(record.jobType),
    scoringVersionMeta: getScoringVersionMeta(record.scoringVersion || getCurrentScoringVersion(record.jobType), record.jobType),
    feedback: record.feedback || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function createRecordPayload(body = {}) {
  const nestedResume = body.resume && typeof body.resume === "object" ? body.resume : {};
  const source = {
    ...nestedResume,
    ...body,
    fileName: body.fileName || body.filename || nestedResume.fileName || nestedResume.filename || "",
    parseMode: body.parseMode || nestedResume.parseMode || "",
  };
  const fields = sanitizeResumeFields(source);
  const details = sanitizeResumeDetails(source);
  const sourceMeta = buildResumeSourceMetadata(source);
  const now = new Date().toISOString();
  return applyPositionRuleScoring({
    id: crypto.randomUUID(),
    ...fields,
    ...details,
    fileName: String(source.fileName || "").trim(),
    parseMode: String(source.parseMode || "").trim(),
    ...sourceMeta,
    pdfPath: "",
    scoringVersion: getCurrentScoringVersion(fields.jobType),
    feedback: null,
    createdAt: now,
    updatedAt: now,
  });
}

function getBossBrowserStartHint() {
  return [
    "请用普通 Chrome/Edge 启动一个调试浏览器并登录 BOSS：",
    'chrome.exe --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\Documents\\New project\\招聘智能体\\data\\boss-browser-profile"',
    "打开 BOSS 候选人页面后，再回到系统点击检测或获取。",
  ].join("\n");
}

async function isCdpReady(cdpPort) {
  try {
    await fetchLocalJson(`http://127.0.0.1:${cdpPort}/json/version`, { timeoutMs: 1200 });
    return true;
  } catch {
    return false;
  }
}

function spawnDetached(command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function findCloakBrowserExecutable() {
  const explicit = String(process.env.CLOAK_BROWSER_PATH || process.env.CLOAK_BROWSER_EXE || "").trim();
  const candidates = [];
  if (explicit) candidates.push(explicit);

  try {
    const entries = fsSync.existsSync(DEFAULT_CLOAK_BROWSER_ROOT)
      ? fsSync.readdirSync(DEFAULT_CLOAK_BROWSER_ROOT, { withFileTypes: true })
      : [];
    entries
      .filter((entry) => entry.isDirectory() && /^chromium-/i.test(entry.name))
      .sort((left, right) => right.name.localeCompare(left.name))
      .forEach((entry) => candidates.push(path.join(DEFAULT_CLOAK_BROWSER_ROOT, entry.name, "chrome.exe")));
  } catch {
    // Best-effort discovery only; explicit error is raised below if no executable exists.
  }

  candidates.push(
    path.join(process.env.LOCALAPPDATA || "", "CloakBrowser", "CloakBrowser.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "CloakBrowser", "CloakBrowser.exe"),
    path.join(process.env.PROGRAMFILES || "", "CloakBrowser", "CloakBrowser.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "CloakBrowser", "CloakBrowser.exe")
  );

  return candidates.find((candidate) => candidate && fsSync.existsSync(candidate)) || "";
}

async function waitForCdpReady(cdpPort, timeoutMs = 75000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isCdpReady(cdpPort)) return true;
    await sleep(300);
  }
  return false;
}

async function fetchCdpJson(cdpPort, pathSuffix, { method = "GET", timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}${pathSuffix}`, {
      method,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.message || `CDP 请求失败：${response.status}`);
    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getBrowserAutomationAccounts(accountId = "all") {
  const normalized = normalizeBossAutomationAccountId(accountId);
  if (normalized === "all") return BROWSER_AUTOMATION_ACCOUNTS;
  return BROWSER_AUTOMATION_ACCOUNTS.filter((account) => account.id === normalized);
}

function browserTargetLooksLoggedOut(page = {}) {
  const text = `${page.url || ""} ${page.title || ""}`.toLowerCase();
  return /login|passport|signin|登录|请登录/.test(text);
}

async function focusOrOpenCdpPage(target, startUrl) {
  const pages = await fetchCdpJson(target.cdpPort, "/json/list").catch(() => []);
  const pageList = Array.isArray(pages) ? pages.filter((page) => page.type === "page") : [];
  const platformHost = new URL(startUrl).hostname.replace(/^www\./, "");
  const existing = pageList.find((page) => String(page.url || "").includes(platformHost)) || null;

  if (existing?.webSocketDebuggerUrl) {
    return {
      openedNewTab: false,
      page: { title: existing.title || "", url: existing.url || startUrl },
      needsLogin: browserTargetLooksLoggedOut(existing),
    };
  }

  const created = await fetchCdpJson(target.cdpPort, `/json/new?${encodeURIComponent(startUrl)}`, {
    method: "PUT",
  }).catch(() => null);
  return {
    openedNewTab: Boolean(created),
    page: { title: created?.title || "", url: created?.url || startUrl },
    needsLogin: browserTargetLooksLoggedOut(created || { url: startUrl }),
  };
}

async function startBrowserTarget(account, platform, { waitTimeoutMs = 30000 } = {}) {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const platformConfig = BROWSER_PLATFORM_CONFIG[normalizedPlatform] || BROWSER_PLATFORM_CONFIG.boss;
  const target = account.platforms?.[normalizedPlatform];
  if (!target?.cdpPort || !target.profileDir) {
    const error = new Error(`${account.name} ${platformConfig.label} 浏览器未配置`);
    error.statusCode = 400;
    throw error;
  }

  const wasRunning = await isCdpReady(target.cdpPort);
  let pid = null;
  if (!wasRunning) {
    if (!fsSync.existsSync(START_CDP_BROWSER_SCRIPT)) {
      const error = new Error(`未找到浏览器启动脚本：${START_CDP_BROWSER_SCRIPT}`);
      error.statusCode = 500;
      throw error;
    }
    const cloakBrowserPath = findCloakBrowserExecutable();
    if (!cloakBrowserPath) {
      const error = new Error("未找到 CloakBrowser，已停止启动；不能回退到普通 Chrome/Edge");
      error.statusCode = 500;
      throw error;
    }
    pid = spawnDetached(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        START_CDP_BROWSER_SCRIPT,
        "-Port",
        String(target.cdpPort),
        "-ProfileDir",
        target.profileDir,
        "-StartUrl",
        platformConfig.startUrl,
        "-BrowserPath",
        cloakBrowserPath,
      ],
      AUTOMATION_WORKSPACE
    );
    const ready = await waitForCdpReady(target.cdpPort, waitTimeoutMs);
    if (!ready) {
      const error = new Error(`${account.name} ${platformConfig.label} 浏览器已尝试启动，但 ${target.cdpPort} 端口未就绪`);
      error.statusCode = 500;
      throw error;
    }
  }

  const pageResult = await focusOrOpenCdpPage(target, platformConfig.startUrl);
  return {
    accountId: account.id,
    accountName: account.name,
    platform: normalizedPlatform,
    platformLabel: platformConfig.label,
    cdpPort: target.cdpPort,
    debugUrl: `http://127.0.0.1:${target.cdpPort}`,
    profileDir: target.profileDir,
    startUrl: platformConfig.startUrl,
    started: !wasRunning,
    pid,
    ...pageResult,
  };
}

function getBrowserLaunchSpecs(body = {}) {
  if (body.launchSet === "default-four" || body.mode === "default-four" || body.defaultFour === true) {
    return DEFAULT_BROWSER_LAUNCH_TARGETS;
  }
  if (Array.isArray(body.targets) && body.targets.length) {
    return body.targets;
  }
  return [{ platform: body.platform || body.source || "boss", accountId: body.accountId || body.account || "all" }];
}

function getBrowserLaunchPlan(body = {}) {
  const seen = new Set();
  const plan = [];
  for (const spec of getBrowserLaunchSpecs(body)) {
    const platform = normalizeAutomationPlatformId(spec.platform || spec.source || body.platform || "boss");
    const accountId = normalizeBossAutomationAccountId(spec.accountId || spec.account || "all");
    const accounts = getBrowserAutomationAccounts(accountId);
    for (const account of accounts) {
      const key = `${account.id}:${platform}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plan.push({ account, platform });
    }
  }
  return plan;
}

async function handleStartAutomationBrowser(request, response) {
  try {
    const body = await readJsonBody(request).catch(() => ({}));
    const plan = getBrowserLaunchPlan(body);
    if (!plan.length) {
      sendJson(response, 400, { error: "未找到要启动的账号" });
      return;
    }
    const waitTimeoutMs = Math.max(10000, Math.min(Number(body.waitTimeoutMs || 30000), 90000));
    const targets = [];
    const failures = [];
    for (const item of plan) {
      try {
        targets.push(await startBrowserTarget(item.account, item.platform, { waitTimeoutMs }));
      } catch (error) {
        const platformConfig = BROWSER_PLATFORM_CONFIG[normalizeAutomationPlatformId(item.platform)] || BROWSER_PLATFORM_CONFIG.boss;
        failures.push({
          accountId: item.account.id,
          accountName: item.account.name,
          platform: normalizeAutomationPlatformId(item.platform),
          platformLabel: platformConfig.label,
          error: error.message || "启动失败",
        });
      }
    }
    const needsLoginCount = targets.filter((target) => target.needsLogin).length;
    const isDefaultFour = body.launchSet === "default-four" || body.mode === "default-four" || body.defaultFour === true;
    const successLabel = targets.length ? `${targets.length} 个窗口已打开` : "没有窗口成功打开";
    const failureLabel = failures.length ? `，${failures.length} 个窗口启动失败` : "";
    sendJson(response, 200, {
      ok: failures.length === 0,
      platform: isDefaultFour ? "multi" : targets[0]?.platform || "boss",
      platformLabel: isDefaultFour ? "五窗口" : targets[0]?.platformLabel || "BOSS",
      accountId: isDefaultFour ? "default-four" : targets[0]?.accountId || "all",
      accountLabel: isDefaultFour ? "默认五窗口" : targets[0]?.accountName || "全部账号",
      targets,
      failures,
      message: `${successLabel}${failureLabel}${needsLoginCount ? "，有账号需要登录" : ""}`,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "启动浏览器失败" });
  }
}

function configuredAutomationSources(sourceKeys) {
  return sourceKeys.filter((sourceKey) => Boolean(AUTOMATION_SUMMARY_SOURCES[sourceKey]?.baseUrl));
}

function platformAutomationSources(platform, accountId) {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const normalizedAccount = normalizeBossAutomationAccountId(accountId);
  if (normalizedPlatform === "boss") return bossAutomationSources(normalizedAccount);

  const sourceByAccount =
    normalizedPlatform === "51job"
      ? { boss_a: "job51_a", boss_b: "job51_b" }
      : { boss_a: "zhilian_a", boss_b: "zhilian_b" };
  const sourceKeys =
    normalizedAccount === "all"
      ? [sourceByAccount.boss_a, sourceByAccount.boss_b]
      : [sourceByAccount[normalizedAccount]];
  const configured = configuredAutomationSources(sourceKeys);
  if (configured.length) return configured;

  const error = new Error(`${automationPlatformLabel(normalizedPlatform)} ${automationAccountLabel(normalizedAccount)}自动化服务未配置`);
  error.statusCode = 502;
  throw error;
}

function countSummaryValue(source, ...keys) {
  for (const key of keys) {
    const value = Number(source?.[key] || 0);
    if (Number.isFinite(value) && value) return value;
  }
  return 0;
}

function sumSummaryValues(items, section, ...keys) {
  return items.reduce((total, item) => total + countSummaryValue(item?.[section] || {}, ...keys), 0);
}

function buildBossAutomationSummaryPayload(items, { accountId = "all", date = "" } = {}) {
  const selectedDate = date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const selectedDates = automationDateListFromState(selectedDate);
  const useAll = selectedDate === "all";
  const section = useAll ? "allSummary" : "todaySummary";
  const requestedResume =
    sumSummaryValues(items, section, "requestedResume") + sumSummaryValues(items, section, "alreadyRequestedResume");
  const processed = sumSummaryValues(items, section, "processedRecords", "processedPeople");
  const askedQuestions = sumSummaryValues(items, section, "askedQuestions", "sentBasic");
  const downloadedResume = sumSummaryValues(items, section, "downloadedResume");
  const knowledgeAnswered = sumSummaryValues(items, section, "knowledgeAnswered");
  const candidateQuestions = sumSummaryValues(items, section, "candidateQuestions");
  const proactiveOpened = sumSummaryValues(items, section, "proactiveOpened", "opened", "openedCandidates");
  const greeted = sumSummaryValues(items, section, "greeted");
  const recent = [];
  for (const item of items) {
    const latestEvents = Array.isArray(item.latestEvents) ? item.latestEvents : [];
    const latestReports = Array.isArray(item.latestReports) ? item.latestReports : [];
    for (const event of latestEvents.slice(0, 6)) {
      recent.push({
        time: String(event.time || event.createdAt || "").slice(0, 19),
        text: String(event.message || event.action || event.type || "自动化事件").slice(0, 180),
      });
    }
    for (const report of latestReports.slice(0, 4)) {
      recent.push({
        time: String(report.createdAt || "").slice(0, 19),
        text: String(report.message || report.type || "自动化报告").slice(0, 180),
      });
    }
  }
  let metrics = [
    { key: "processed", label: "处理人数", value: processed },
    { key: "sentCompanyInfo", label: "询问问题", value: askedQuestions },
    { key: "requestedResume", label: "求简历", value: requestedResume },
    { key: "userQuestions", label: "候选人提问", value: candidateQuestions },
    { key: "savedResumes", label: "获取简历", value: downloadedResume },
    { key: "knowledgeAnswered", label: "已答疑", value: knowledgeAnswered },
    { key: "proactiveOpened", label: "点开人数", value: proactiveOpened },
    { key: "proactiveGreeted", label: "主动打招呼", value: greeted },
    { key: "proactiveReplied", label: "主动回复", value: 0 },
    { key: "proactiveQualified", label: "主动符合", value: 0 },
  ];
  let recentItems = recent.slice(0, 12);
  if (selectedDates.length > 1) {
    const records = automationDetailRecordsFromSummaries(items, selectedDate);
    const dedupedRecords = dedupeAutomationDetailRecords(records, "processed", { includeDate: false });
    metrics = automationMetricPayloadFromRecords(records, { includeDate: false });
    recentItems = dedupedRecords.slice(0, 12).map((record) => ({
      time: String(record.updatedAt || "").slice(0, 19),
      text: String(record.phrase || record.candidateLabel || record.statusLabel || "自动化记录").slice(0, 180),
    }));
  }
  return {
    accountId: normalizeBossAutomationAccountId(accountId),
    date: selectedDate,
    today: items[0]?.today || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
    updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    metrics,
    proactiveByPosition: [],
    recent: recentItems,
  };
}

function buildAutomationSummaryPayloadFromRecords(records = [], { platform = "boss", accountId = "all", date = "" } = {}) {
  const selectedDate = normalizeAutomationDetailDate(date);
  const filteredRecords = (Array.isArray(records) ? records : [])
    .filter((record) => automationDetailDateMatches(record.updatedAt, selectedDate))
    .sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
  const includeDate = selectedDate !== "all";
  const recentRecords = dedupeAutomationDetailRecords(
    filteredRecords.filter((record) => record.type !== "event" && automationRecordHasCandidateIdentity(record)),
    "processed",
    { includeDate }
  );
  return {
    platform: normalizeAutomationPlatformId(platform),
    accountId: normalizeBossAutomationAccountId(accountId),
    date: selectedDate,
    today: automationChinaDateKey(),
    updatedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    metrics: automationMetricPayloadFromRecords(filteredRecords, { includeDate }),
    proactiveByPosition: [],
    recent: recentRecords.slice(0, 12).map((record) => ({
      time: String(record.updatedAt || "").slice(0, 19),
      text: String(record.phrase || record.candidateLabel || record.statusLabel || "自动化记录").slice(0, 180),
    })),
    deepStats: true,
  };
}

function automationChinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function automationDateListFromState(value = "") {
  return [
    ...new Set(
      String(value || "")
        .split(/[,\s]+/)
        .map((item) => String(item || "").trim())
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))
    ),
  ].sort();
}

function normalizeAutomationDetailDate(value = "") {
  const text = String(value || "").trim();
  if (text === "all" || text === "全部") return "all";
  const dates = automationDateListFromState(text);
  if (dates.length) return dates.join(",");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : automationChinaDateKey();
}

function automationDetailDateMatches(value = "", selectedDate = automationChinaDateKey()) {
  if (selectedDate === "all") return true;
  const dates = automationDateListFromState(selectedDate);
  if (dates.length) return dates.some((date) => String(value || "").startsWith(date));
  return String(value || "").startsWith(selectedDate);
}

function automationDetailMetricPayload(items, platform, { accountId = "all", date = "" } = {}) {
  if (platform === "boss") {
    return buildBossAutomationSummaryPayload(items, { accountId, date }).metrics;
  }
  const selectedDate = normalizeAutomationDetailDate(date);
  const section = selectedDate === "all" ? "allSummary" : "todaySummary";
  const summary = items.reduce((next, item) => {
    const source = item?.[section] || {};
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "number") next[key] = (next[key] || 0) + value;
    }
    return next;
  }, {});
  const requestedResume = Number(summary.requestedResume || 0) + Number(summary.alreadyRequestedResume || 0);
  const proactiveOpened = Number(summary.proactiveOpened || summary.opened || summary.openedCandidates || 0);
  return [
    { key: "processed", label: "处理人数", value: Number(summary.processedRecords || summary.processedPeople || 0) },
    { key: "sentCompanyInfo", label: "询问问题", value: Number(summary.askedQuestions || summary.sentBasic || 0) },
    { key: "requestedResume", label: "求简历", value: requestedResume },
    { key: "userQuestions", label: "候选人提问", value: Number(summary.candidateQuestions || 0) },
    { key: "savedResumes", label: "获取简历", value: Number(summary.downloadedResume || 0) },
    { key: "knowledgeAnswered", label: "已答疑", value: Number(summary.knowledgeAnswered || 0) },
    { key: "proactiveOpened", label: "点开人数", value: proactiveOpened },
    { key: "proactiveGreeted", label: "主动打招呼", value: Number(summary.greeted || 0) },
    { key: "proactiveReplied", label: "主动回复", value: 0 },
    { key: "proactiveQualified", label: "主动符合", value: 0 },
  ];
}

function normalizeAutomationDetailStatusGroup(action = "", status = "", reportType = "") {
  const text = `${action} ${status} ${reportType}`.toLowerCase();
  if (/already_viewed|already_greeted|state_duplicate|identity_duplicate|resume_open_failed|no_greet_button/.test(text)) return "processed";
  if (/dry_run_would_greet|screening_not_qualified|not_qualified|no_hi_button/.test(text) && /proactive|recommend|主动|推荐/.test(text)) {
    return "proactiveOpened";
  }
  if (/qualified|符合|matched/.test(text)) return "proactiveQualified";
  if (/reply|replied|回复/.test(text) && /proactive|greet|主动/.test(text)) return "proactiveReplied";
  if (/greeted|proactive_greeted|(^|[_\s-])greet($|[_\s-])|打招呼|已主动联系|已主动打招呼/.test(text)) return "proactiveGreeted";
  if (/opened|open.*candidate|open.*resume|detail|resume_dialog|read_resume|点开|查看候选/.test(text) && /proactive|recommend|主动|推荐/.test(text)) {
    return "proactiveOpened";
  }
  if (/download|saved_resume|resume_download|accepted_resume_downloaded|获取简历|下载简历/.test(text)) return "savedResumes";
  if (/request.*resume|requested_resume|accepted_requested_resume|求简历/.test(text)) return "requestedResume";
  if (/candidate_question|user_question|question_pool|knowledge_gap|needs_human_answer|knowledge_unknown/.test(text)) return "userQuestions";
  if (/knowledge_answered|(^|[_\s-])answered|答疑/.test(text)) return "knowledgeAnswered";
  if (
    /sent_basic_conditions|basic_conditions_(sent|waiting)|sent_position_screening|position_screening_(sent|waiting)|screening_question|sent_screening|已发公司情况|岗位筛选问题|筛选问题/.test(
      text
    )
  ) {
    return "sentCompanyInfo";
  }
  if (/waiting|not_asked|pending|blocked|halted/.test(text)) return "waiting";
  return "processed";
}

function automationDetailStatusLabel(statusGroup, action = "", status = "") {
  const labels = {
    processed: "已处理",
    sentCompanyInfo: "已询问",
    requestedResume: "已求简历",
    userQuestions: "候选人提问",
    savedResumes: "已获取简历",
    knowledgeAnswered: "已答疑",
    proactiveOpened: "已点开",
    proactiveGreeted: "已主动打招呼",
    proactiveReplied: "主动联系后已回复",
    proactiveQualified: "主动联系后符合",
    waiting: "等待/待判断",
  };
  return labels[statusGroup] || action || status || "已处理";
}

function automationDetailFlags(statusGroup) {
  return {
    sentCompanyInfo: statusGroup === "sentCompanyInfo",
    requestedResume: statusGroup === "requestedResume",
    userQuestions: statusGroup === "userQuestions",
    savedResumes: statusGroup === "savedResumes",
    knowledgeAnswered: statusGroup === "knowledgeAnswered",
    proactiveOpened:
      statusGroup === "proactiveOpened" ||
      statusGroup === "proactiveGreeted" ||
      statusGroup === "proactiveReplied" ||
      statusGroup === "proactiveQualified",
    proactiveGreeted: statusGroup === "proactiveGreeted" || statusGroup === "proactiveReplied" || statusGroup === "proactiveQualified",
    proactiveReplied: statusGroup === "proactiveReplied" || statusGroup === "proactiveQualified",
    proactiveQualified: statusGroup === "proactiveQualified",
    waiting: statusGroup === "waiting",
  };
}

function automationDateKeyFromValue(value = "") {
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function normalizeAutomationName(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：()（）【】\[\]<>《》"'“”‘’]/g, "")
    .trim();
}

function cleanAutomationCandidateName(value = "") {
  const name = String(value || "")
    .replace(/^[\d\s.、-]+/, "")
    .replace(/^\d{1,2}[:：]\d{2}\s*/, "")
    .replace(/^\d{1,2}\/\d{1,2}\s*/, "")
    .replace(/^\d{4}-\d{2}-\d{2}\s*/, "")
    .replace(/[，,。.;；:：()（）【】\[\]<>《》"'“”‘’]/g, "")
    .trim();
  if (!name) return "";
  if (/^\d+$/.test(name) || /^\d{1,2}[:：]\d{2}$/.test(name) || /^\d{1,2}\/\d{1,2}$/.test(name)) return "";
  if (/^(候选人|自动化事件|未知|未命名|人才|对方|简历|附件简历|在线简历|已投|不合适)$/i.test(name)) return "";
  if (/^(hrbp|hr|AI实习生|AI应用开发实习生|AI应用开发工程师|电气工程师|销售管培生|国际业务管培生|膨润土销售人员)$/i.test(name)) return "";
  if (normalizeJobType(name) === name && RESUME_LIBRARY_JOB_TYPES.includes(name)) return "";
  return name;
}

function automationJobMarkersForParsing(jobType = "") {
  const markers = [
    jobType,
    normalizeJobType(jobType),
    ...RESUME_LIBRARY_JOB_TYPES,
    ...LEGACY_JOB_TYPES,
    "AI应用开发实习生",
    "AI实习生",
    "AI应用开发工程师",
    "应用技术管培生",
    "膨润土销售人员",
    "膨润土销售",
    "人力资源管培生",
    "hrbp",
    "HRBP",
    "电气工程师",
    "销售管培生",
    "国际业务管培生",
  ];
  return [...new Set(markers.filter(Boolean))].sort((left, right) => right.length - left.length);
}

function automationCandidateNameFromLabel(label = "", jobType = "") {
  const text = String(label || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  for (const marker of automationJobMarkersForParsing(jobType)) {
    const index = text.toLowerCase().indexOf(String(marker).toLowerCase());
    if (index <= 0) continue;
    const prefix = text
      .slice(0, index)
      .replace(/^\d+\s+/, "")
      .replace(/^\d{1,2}[:：]\d{2}\s+/, "")
      .trim();
    const token = prefix.split(/\s+/)[0] || "";
    const name = cleanAutomationCandidateName(token);
    if (name) return name;
  }
  const stripped = text
    .replace(/^\d+\s+/, "")
    .replace(/^\d{1,2}[:：]\d{2}\s+/, "")
    .trim();
  const token = stripped.split(/\s+/)[0] || "";
  return cleanAutomationCandidateName(token);
}

function automationCandidateNameFromFilename(filename = "") {
  const base = path.basename(String(filename || ""), path.extname(String(filename || "")));
  const token = base.split(/[_\s-]+/)[0] || "";
  return cleanAutomationCandidateName(token);
}

function automationEmailCandidateNameFromFilename(filename = "") {
  const base = path.basename(String(filename || ""), path.extname(String(filename || "")));
  const withoutPrefix = base.replace(/^邮箱_\d+_/, "");
  const bracketMatch = withoutPrefix.match(/[】\]]([^_]+)(?:_|$)/);
  const token = bracketMatch?.[1] || withoutPrefix.split(/[_\s-]+/).filter(Boolean).at(-2) || "";
  return cleanAutomationCandidateName(token);
}

function resolveAutomationCandidateName(...values) {
  for (const value of values) {
    const name = cleanAutomationCandidateName(value);
    if (name) return name;
  }
  return "";
}

function normalizeAutomationPhone(value = "") {
  const text = String(value || "");
  const mobile = text.match(/(?:\+?86[\s-]?)?(1[3-9]\d{9})/);
  if (mobile) return mobile[1];
  const masked = text.match(/(?:\+?86[\s-]?)?(1[3-9]\d[\d*]{4}\d{4})/);
  return masked ? masked[1] : "";
}

function automationRecordPhoneKey(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const counterpart = record.conversation?.counterpart || {};
  const candidates = [
    record.phone,
    record.mobile,
    record.candidatePhone,
    record.contactPhone,
    current.phone,
    current.mobile,
    current.candidatePhone,
    current.contactPhone,
    current.telephone,
    current.replyTarget?.phone,
    current.replyTarget?.mobile,
    current.resume?.phone,
    current.resume?.mobile,
    current.profile?.phone,
    current.profile?.mobile,
    current.candidate?.phone,
    current.candidate?.mobile,
    counterpart.phone,
    counterpart.mobile,
  ];
  for (const value of candidates) {
    const phone = normalizeAutomationPhone(value);
    if (phone) return phone;
  }
  return "";
}

function automationRecordNameKey(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const rawName = resolveAutomationCandidateName(
    record.candidateName,
    current.candidateName,
    current.name,
    current.replyTarget?.candidateName,
    record.conversation?.counterpart?.name,
    automationCandidateNameFromLabel(record.candidateLabel || record.conversation?.counterpart?.rawHeader || "", record.appliedPosition),
    automationCandidateNameFromLabel(record.phrase || "", record.appliedPosition)
  );
  return normalizeAutomationName(rawName);
}

function automationRecordJobKey(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const rawJob = String(
    record.appliedPosition ||
      current.appliedPosition ||
      current.position ||
      current.job ||
      current.replyTarget?.appliedPosition ||
      record.conversation?.counterpart?.appliedPosition ||
      record.conversation?.counterpart?.role ||
      ""
  ).trim();
  return (normalizeJobType(rawJob) || rawJob).trim().toLowerCase();
}

function automationRecordPersonKey(record = {}) {
  const phone = automationRecordPhoneKey(record);
  if (phone) return `phone:${phone}`;
  const name = automationRecordNameKey(record);
  const job = automationRecordJobKey(record);
  const platform = normalizeAutomationPlatformId(record.platform || automationPlatformFromValue(record.sourceKey || record.source || "", "boss"));
  if (name) return `name:${name}|job:${job || "unknown"}|platform:${platform}`;
  const current = record.conversation?.currentRecord || {};
  const conversationKey = String(current.conversationKey || record.conversationKey || "").trim();
  if (conversationKey) return `conversation:${conversationKey}`;
  const resumeFile = (record.resumeFiles || []).map((file) => file.fileName).filter(Boolean).join("|");
  if (resumeFile) return `resume:${resumeFile}`;
  return `fallback:${normalizeAutomationName(record.candidateLabel || record.phrase || record.id || "")}`;
}

function automationRecordHasCandidateIdentity(record = {}) {
  const current = record.conversation?.currentRecord || {};
  const explicitName = resolveAutomationCandidateName(
    record.candidateName,
    current.candidateName,
    current.name,
    current.replyTarget?.candidateName,
    record.conversation?.counterpart?.name
  );
  return Boolean(automationRecordPhoneKey(record) || normalizeAutomationName(explicitName));
}

function automationSourceKeyFromFilename(filename = "") {
  const text = String(filename || "").toLowerCase();
  if (/job51_b|51_b|51_和新红|和新红.*51/.test(text)) return "job51_b";
  if (/job51_a|51_a|51_宋峰峰|51_宋锋峰|boss_a_宋峰峰|boss_a_boss_a|宋峰峰.*51|宋锋峰.*51/.test(text)) return "job51_a";
  if (/51job|job51|51-resumes|前程/.test(text)) return "job51_unknown";
  if (/zhilian_b|zhaopin_b/.test(text)) return "zhilian_b";
  if (/zhilian_a|zhaopin_a/.test(text)) return "zhilian_a";
  if (/zhilian|zhaopin|智联/.test(text)) return "zhilian_unknown";
  if (/boss_b|hexinhong/.test(text)) return "boss_b";
  return "boss_a";
}

function automationPlatformFromValue(value = "", fallback = "boss") {
  const text = String(value || "").toLowerCase();
  if (/51job|job51|前程/.test(text)) return "51job";
  if (/zhilian|zhaopin|智联/.test(text)) return "zhilian";
  if (/boss|zhipin|kanzhun/.test(text)) return "boss";
  return fallback;
}

function automationSourceKeyFromRecord(record = {}, filename = "") {
  const accountText = [record.accountId, record.accountName, record.accountLabel, record.sourceLabel, record.sourceName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const locationText = [record.filePath, record.path, record.localPath, record.filename, record.originalName, filename]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const platformText = [record.platform, record.sourcePlatform, record.source, record.channel, filename, locationText]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const text = [accountText, platformText, locationText].filter(Boolean).join(" ");

  if (/job51_b|51_b|51_和新红/.test(text)) return "job51_b";
  if (/job51_a|51_a|51_宋峰峰|51_宋锋峰|boss_a_宋峰峰|boss_a_boss_a/.test(text)) return "job51_a";

  const hasJob51Hint = /51job|job51|51-resumes|前程/.test(text);
  if (hasJob51Hint) {
    if (/boss_b|hexinhong|和新红/.test(accountText)) return "job51_b";
    if (/boss_a|songfengfeng|宋峰峰|宋锋峰/.test(accountText)) return "job51_a";
    return "job51_unknown";
  }

  if (/zhilian_b|zhaopin_b/.test(text)) return "zhilian_b";
  if (/zhilian_a|zhaopin_a/.test(text)) return "zhilian_a";
  const hasZhilianHint = /zhaopin|zhilian|智联/.test(text);
  if (hasZhilianHint) {
    if (/boss_b|hexinhong|和新红/.test(accountText)) return "zhilian_b";
    if (/boss_a|songfengfeng|宋峰峰|宋锋峰/.test(accountText)) return "zhilian_a";
    return "zhilian_unknown";
  }

  if (/boss_b|hexinhong|和新红/.test(text)) return "boss_b";
  if (/songfengfeng|boss_a|宋峰峰|宋锋峰/.test(text)) return "boss_a";
  return automationSourceKeyFromFilename(filename);
}

function automationSourceKeyAccountId(sourceKey = "") {
  const key = String(sourceKey || "").toLowerCase();
  if (/^(boss_b|job51_b|zhilian_b)$/.test(key) || /_b$/.test(key)) return "boss_b";
  if (/^(boss_a|job51_a|zhilian_a)$/.test(key) || /_a$/.test(key)) return "boss_a";
  return "";
}

function automationAccountMatches(sourceKey, accountId = "all") {
  const normalized = normalizeBossAutomationAccountId(accountId);
  if (normalized === "all") return true;
  return automationSourceKeyAccountId(sourceKey) === normalized;
}

function automationPlatformMatches(recordPlatform, requestedPlatform) {
  return normalizeAutomationPlatformId(recordPlatform) === normalizeAutomationPlatformId(requestedPlatform);
}

function automationRecordContactKey(record = {}, metricKey = "processed", options = {}) {
  const includeDate = options.includeDate !== false;
  const date = includeDate ? automationDateKeyFromValue(record.updatedAt) : "";
  const platform = normalizeAutomationPlatformId(record.platform || automationPlatformFromValue(record.sourceKey || record.source || "", "boss"));
  const identity = automationRecordPersonKey(record);
  return [platform, date, metricKey, identity].join("|");
}

function automationMetricPayloadFromRecords(records = [], options = {}) {
  const items = Array.isArray(records) ? records : [];
  const includeDate = options.includeDate !== false;
  const countFlag = (key) =>
    new Set(
      items
        .filter((record) => record.type !== "event" && automationRecordHasCandidateIdentity(record) && Boolean(record.flags?.[key] || record.statusGroup === key))
        .map((record) => automationRecordContactKey(record, key, { includeDate }))
    ).size;
  const processed = new Set(
    items
      .filter(
        (record) =>
          record.type !== "event" &&
          automationRecordHasCandidateIdentity(record) &&
          !Boolean(
            record.flags?.proactiveOpened ||
              record.flags?.proactiveGreeted ||
              record.statusGroup === "proactiveOpened" ||
              record.statusGroup === "proactiveGreeted"
          )
      )
      .map((record) => automationRecordContactKey(record, "processed", { includeDate }))
  ).size;
  return [
    { key: "processed", label: "处理人数", value: processed },
    { key: "sentCompanyInfo", label: "询问问题", value: countFlag("sentCompanyInfo") },
    { key: "requestedResume", label: "求简历", value: countFlag("requestedResume") },
    { key: "userQuestions", label: "候选人提问", value: countFlag("userQuestions") },
    { key: "savedResumes", label: "获取简历", value: countFlag("savedResumes") },
    { key: "knowledgeAnswered", label: "已答疑", value: countFlag("knowledgeAnswered") },
    { key: "proactiveOpened", label: "点开人数", value: countFlag("proactiveOpened") },
    { key: "proactiveGreeted", label: "主动打招呼", value: countFlag("proactiveGreeted") },
    { key: "proactiveReplied", label: "主动回复", value: countFlag("proactiveReplied") },
    { key: "proactiveQualified", label: "主动符合", value: countFlag("proactiveQualified") },
  ];
}

function automationDetailTimestamp(value = "") {
  const text = String(value || "").trim();
  const parsedIso = Date.parse(text);
  if (Number.isFinite(parsedIso)) return parsedIso;
  const parsed = Date.parse(text.replace(/-/g, "/"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAutomationDetailMessages(messages = []) {
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

function automationDetailResumeFiles(result = {}) {
  const files = [];
  const resume = result.resume && typeof result.resume === "object" ? result.resume : null;
  const fileName = resume?.filename || resume?.fileName || result.resumeFileName || result.fileName || "";
  if (fileName) {
    files.push({
      fileName: path.basename(String(fileName)),
      size: Number(resume?.size || result.resumeSize || 0),
    });
  }
  return files;
}

function automationDetailRecordFromResult(result, report, item, index) {
  if (!result || typeof result !== "object") return null;
  const action = String(result.action || result.nextAction || "");
  const status = String(result.screeningStatus || result.status || "");
  const reportType = String(report.type || "");
  const statusGroup = normalizeAutomationDetailStatusGroup(action, status, reportType);
  const updatedAt = String(result.updatedAt || result.createdAt || result.time || report.createdAt || "");
  const appliedPosition = String(result.appliedPosition || result.position || result.job || result.candidateIdentity?.appliedPosition || "").trim();
  const candidateLabel = clipText(result.label || result.candidateLabel || result.pageTextPreview || result.message || report.message || "", 220);
  const candidateName = resolveAutomationCandidateName(
    result.candidateName,
    result.name,
    result.replyTarget?.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const messages = normalizeAutomationDetailMessages(result.messages || result.recentMessages);
  if (!candidateName && !candidateLabel && !messages.length) return null;
  const flags = automationDetailFlags(statusGroup);
  const proactiveText = `${reportType} ${report.message || ""} ${action} ${result.workflow || ""} ${result.source || ""}`.toLowerCase();
  const proactiveReport = /proactive|recommend|主动|推荐|打招呼/.test(proactiveText);
  const openedLike = Boolean(
    result.opened ||
      result.openedCandidate ||
      result.detailUrl ||
      result.detailPreview ||
      result.resumeInfo ||
      result.resumeBrowse ||
      result.resumePreview ||
      result.browseActions ||
      result.commonGate ||
      result.screening ||
      result.evidenceText ||
      /greeted|dry_run_would_greet|screening_not_qualified|not_qualified|no_hi_button|no_greet_button/.test(action.toLowerCase())
  );
  if (proactiveReport && openedLike) {
    flags.proactiveOpened = true;
  }
  const idSeed = [
    item.source || item.platform || "",
    report.runId || report.createdAt || "",
    result.conversationKey || result.id || result.index || index,
    candidateName,
    appliedPosition,
    action,
  ].join("|");
  return {
    id: `automation-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    candidateName,
    appliedPosition,
    status,
    statusGroup,
    statusLabel: automationDetailStatusLabel(statusGroup, action, status),
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.accountName || item.platform || "自动化",
    candidateLabel,
    phrase: clipText(result.lastOther || result.message || report.message || candidateLabel, 240),
    question: clipText(result.question || result.normalizedQuestion || "", 180),
    answer: clipText(result.answer || result.reply || "", 180),
    action,
    flags,
    resumeFiles: automationDetailResumeFiles(result),
    conversation: {
      summary: clipText(result.message || report.message || "", 1200),
      counterpart: {
        name: candidateName,
        organization: "",
        role: appliedPosition,
        appliedPosition,
        rawHeader: clipText(result.pageTextPreview || result.label || "", 1600),
      },
      recentMessages: messages,
      currentRecord: result,
    },
  };
}

function automationEventDetailRecord(event, item, index) {
  if (!event || typeof event !== "object") return null;
  const updatedAt = String(event.time || event.createdAt || "");
  const message = clipText(event.message || event.action || event.type || "自动化事件", 240);
  if (!message) return null;
  const idSeed = [item.source || item.platform || "", updatedAt, message, index].join("|");
  return {
    id: `automation-event-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "event",
    typeLabel: "事件",
    candidateName: "自动化事件",
    appliedPosition: "",
    status: "event",
    statusGroup: "processed",
    statusLabel: "事件记录",
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.accountName || item.platform || "自动化",
    candidateLabel: message,
    phrase: message,
    question: "",
    answer: "",
    action: String(event.action || event.type || ""),
    flags: automationDetailFlags("processed"),
    resumeFiles: [],
    conversation: {
      summary: message,
      counterpart: { name: "自动化事件", organization: "", role: "", appliedPosition: "", rawHeader: message },
      recentMessages: [{ sender: "system", time: updatedAt, status: "事件", text: message }],
      currentRecord: event,
    },
  };
}

function automationQuestionDetailRecord(question, item, index) {
  if (!question || typeof question !== "object") return null;
  const updatedAt = String(question.time || question.capturedAt || question.createdAt || "");
  const appliedPosition = String(question.appliedPosition || question.replyTarget?.appliedPosition || question.candidateIdentity?.appliedPosition || "").trim();
  const candidateLabel = clipText(question.candidateLabel || question.candidate || question.candidateIdentity?.listLabel || "", 220);
  const candidateName = resolveAutomationCandidateName(
    question.candidateName,
    question.replyTarget?.candidateName,
    question.candidateIdentity?.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const action = String(question.action || "");
  const questionAnswer = String(question.answer || "").trim();
  const statusGroup =
    questionAnswer || /knowledge_answered|answerable_by_kb/.test(`${action} ${question.questionCategory || ""}`.toLowerCase())
      ? "knowledgeAnswered"
      : "userQuestions";
  const flags = {
    ...automationDetailFlags(statusGroup),
    userQuestions: true,
    knowledgeAnswered: statusGroup === "knowledgeAnswered",
  };
  const idSeed = [item.sourceKey || item.source || "", question.id || question.fingerprint || question.questionKey || index, updatedAt].join("|");
  return {
    id: `automation-question-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status: String(question.status || question.screeningStatus || ""),
    statusGroup,
    statusLabel: automationDetailStatusLabel(statusGroup, action, question.status || ""),
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(question.question || question.normalizedQuestion || "", 240),
    question: clipText(question.question || question.normalizedQuestion || "", 180),
    answer: clipText(question.answer || "", 180),
    action,
    flags,
    resumeFiles: [],
    conversation: {
      summary: clipText(question.questionPoolReason || question.answer || question.question || "", 1200),
      counterpart: { name: candidateName, organization: "", role: appliedPosition, appliedPosition, rawHeader: clipText(candidateLabel || "", 1600) },
      recentMessages: [
        { sender: "other", time: updatedAt, status: "候选人提问", text: clipText(question.question || question.normalizedQuestion || "", 900) },
        ...(question.answer ? [{ sender: "me", time: updatedAt, status: "已答复", text: clipText(question.answer, 900) }] : []),
      ],
      currentRecord: question,
    },
  };
}

function automationDownloadDetailRecord(download, item, index) {
  if (!download || typeof download !== "object") return null;
  const updatedAt = String(download.downloadedAt || download.time || download.createdAt || "");
  const appliedPosition = String(download.appliedPosition || download.position || download.candidateIdentity?.appliedPosition || "").trim();
  const fileName = download.filename || download.name || (download.filePath ? path.basename(String(download.filePath)) : "");
  const candidateLabel = clipText(download.candidateLabel || `${download.candidateName || ""} ${appliedPosition}`, 220);
  const candidateName = resolveAutomationCandidateName(
    download.candidateName,
    automationCandidateNameFromFilename(fileName),
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const idSeed = [item.sourceKey || item.source || "", download.fileHash || download.filePath || fileName || index, updatedAt].join("|");
  return {
    id: `automation-download-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status: "saved_resume",
    statusGroup: "savedResumes",
    statusLabel: "已获取简历",
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(fileName || "获取简历", 240),
    question: "",
    answer: "",
    action: "resume_downloaded",
    flags: automationDetailFlags("savedResumes"),
    resumeFiles: fileName ? [{ fileName: path.basename(String(fileName)), size: Number(download.fileSize || download.size || 0) }] : [],
    conversation: {
      summary: clipText(`已获取简历：${fileName || "-"}`, 1200),
      counterpart: { name: candidateName, organization: "", role: appliedPosition, appliedPosition, rawHeader: clipText(candidateLabel || "", 1600) },
      recentMessages: [{ sender: "system", time: updatedAt, status: "获取简历", text: fileName || "已获取简历" }],
      currentRecord: download,
    },
  };
}

async function collectBossEmailBatchDetailRecords({ accountId = "all", selectedDate = automationChinaDateKey() } = {}) {
  await ensureDatabase();
  const normalizedAccount = normalizeBossAutomationAccountId(accountId);
  const rows = getDb()
    .prepare(
      `SELECT bi.id, bi.job_id, bi.filename, bi.file_path, bi.status, bi.message, bi.resume_id,
              bi.payload, bi.created_at, bi.updated_at,
              r.payload AS resume_payload, r.job_type AS resume_job_type, r.match_score AS resume_match_score
         FROM batch_items bi
         LEFT JOIN resumes r ON r.id = bi.resume_id
        WHERE bi.status IN ('saved', 'duplicate')
          AND (bi.filename LIKE '邮箱_%' OR bi.payload LIKE '%"trigger":"email%')
        ORDER BY bi.updated_at DESC`
    )
    .all();
  const records = [];
  const manifest = await readBossImportManifest();
  const manifestByItemId = new Map(
    (Array.isArray(manifest.files) ? manifest.files : [])
      .filter((entry) => entry?.itemId)
      .map((entry) => [entry.itemId, entry])
  );

  rows.forEach((row, index) => {
    const payload = parsePayload(row.payload, {});
    const manifestEntry = manifestByItemId.get(row.id) || {};
    const manifestAccountIds = new Set(
      [
        manifestEntry.accountId,
        ...(Array.isArray(manifestEntry.accounts) ? manifestEntry.accounts.map((item) => item?.accountId) : []),
      ]
        .filter(Boolean)
        .map((value) => normalizeBossAutomationAccountId(value))
    );
    const rowAccountId = (payload.accountId || manifestEntry.accountId)
      ? normalizeBossAutomationAccountId(payload.accountId || manifestEntry.accountId)
      : "";
    if (normalizedAccount !== "all") {
      if (manifestAccountIds.size) {
        if (!manifestAccountIds.has(normalizedAccount)) return;
      } else if (rowAccountId) {
        if (rowAccountId !== normalizedAccount) return;
      } else {
        return;
      }
    }
    const updatedAt = String(row.updated_at || row.created_at || "");
    if (!automationDetailDateMatches(updatedAt, selectedDate)) return;
    const resumePayload = parsePayload(row.resume_payload, {});
    const effectiveAccountId = normalizedAccount !== "all" && manifestAccountIds.has(normalizedAccount) ? normalizedAccount : rowAccountId;
    const sourceLabel = effectiveAccountId ? automationAccountLabel(effectiveAccountId) : "BOSS邮箱";
    const candidateName = resumePayload.name || automationEmailCandidateNameFromFilename(row.filename);
    const appliedPosition = normalizeJobType(
      row.resume_job_type || resumePayload.jobType || payload.jobType || "",
      `${row.filename || ""} ${candidateName || ""}`
    );
    const record = automationDownloadDetailRecord(
      {
        downloadedAt: updatedAt,
        appliedPosition,
        filename: row.filename,
        filePath: payload.sourcePath || manifestEntry.sourcePath || row.file_path,
        fileHash: payload.sourceHash || manifestEntry.hash || row.id,
        size: payload.size || manifestEntry.size || 0,
        candidateName,
        phone: resumePayload.phone || "",
        candidateLabel: `${candidateName || "邮箱简历"} ${appliedPosition}`.trim(),
        createdAt: row.created_at,
      },
      {
        platform: "boss",
        sourceKey: effectiveAccountId || "boss_email",
        source: effectiveAccountId || "boss_email",
        sourceLabel,
      },
      index
    );
    if (record) {
      records.push({
        ...record,
        id: `automation-email-${row.id}`,
        source: sourceLabel,
        sourceKey: effectiveAccountId || "boss_email",
        platform: "boss",
        status: row.status === "duplicate" ? "saved_resume_duplicate" : "saved_resume",
        statusLabel: row.status === "duplicate" ? "已获取简历（重复）" : "已获取简历",
        conversation: {
          ...record.conversation,
          summary: clipText(row.message || record.conversation?.summary || "", 1200),
          currentRecord: {
            batchItemId: row.id,
            batchJobId: row.job_id,
            resumeId: row.resume_id,
            status: row.status,
            accountId: effectiveAccountId,
            accountLabel: manifestEntry.accountLabel || payload.accountLabel || "",
            email: manifestEntry.email || payload.email || "",
            payload,
          },
        },
      });
    }
  });

  return records;
}

function automationDecisionDetailRecord(decision, item, index) {
  if (!decision || typeof decision !== "object") return null;
  const updatedAt = String(decision.time || decision.createdAt || decision.updatedAt || "");
  const action = String(decision.action || decision.nextAction || decision.status || "");
  const status = String(decision.screeningStatus || decision.status || "");
  const statusGroup = normalizeAutomationDetailStatusGroup(action, status, decision.workflow || "");
  const appliedPosition = String(decision.appliedPosition || decision.position || decision.replyTarget?.appliedPosition || decision.candidateIdentity?.appliedPosition || "").trim();
  const candidateLabel = clipText(decision.candidateLabel || decision.candidateIdentity?.listLabel || "", 220);
  const candidateName = resolveAutomationCandidateName(
    decision.candidateName,
    decision.replyTarget?.candidateName,
    decision.candidateIdentity?.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  const idSeed = [item.sourceKey || item.source || "", decision.id || decision.conversationKey || index, updatedAt, action].join("|");
  return {
    id: `automation-decision-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status,
    statusGroup,
    statusLabel: automationDetailStatusLabel(statusGroup, action, status),
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(decision.lastOther || decision.stage || decision.status || "", 240),
    question: clipText(decision.question || "", 180),
    answer: clipText(decision.knowledgeAnswer || "", 180),
    action,
    flags: automationDetailFlags(statusGroup),
    resumeFiles: [],
    conversation: {
      summary: clipText(decision.conversationReview?.summary || decision.stage || decision.status || "", 1200),
      counterpart: { name: candidateName, organization: "", role: appliedPosition, appliedPosition, rawHeader: clipText(candidateLabel || "", 1600) },
      recentMessages: decision.lastOther ? [{ sender: "other", time: updatedAt, status: decision.stage || "", text: clipText(decision.lastOther, 900) }] : [],
      currentRecord: decision,
    },
  };
}

function automationMemoryDetailRecord(key, memory, item, index) {
  if (!memory || typeof memory !== "object") return null;
  const counterpart = memory.counterpart && typeof memory.counterpart === "object" ? memory.counterpart : {};
  const updatedAt = String(memory.updatedAt || memory.lastUpdatedAt || memory.createdAt || "");
  if (!automationDateKeyFromValue(updatedAt)) return null;
  const appliedPosition = String(memory.appliedPosition || counterpart.appliedPosition || counterpart.role || "").trim();
  const candidateLabel = clipText(counterpart.rawHeader || memory.summary || `${memory.candidateName || counterpart.name || ""} ${appliedPosition}`, 220);
  const candidateName = resolveAutomationCandidateName(
    counterpart.name,
    memory.candidateName,
    automationCandidateNameFromLabel(candidateLabel, appliedPosition)
  );
  if (!candidateName && !appliedPosition) return null;
  const idSeed = [item.sourceKey || item.source || "", key || index, updatedAt].join("|");
  return {
    id: `automation-memory-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 18)}`,
    type: "candidate",
    typeLabel: "候选人",
    platform: item.platform,
    sourceKey: item.sourceKey,
    candidateName,
    appliedPosition,
    status: "memory",
    statusGroup: "processed",
    statusLabel: "联系人记录",
    updatedAt,
    updatedAtTs: automationDetailTimestamp(updatedAt),
    source: item.sourceLabel || item.source || "自动化",
    candidateLabel,
    phrase: clipText(memory.summary || "", 240),
    question: "",
    answer: "",
    action: "chat_memory",
    flags: automationDetailFlags("processed"),
    resumeFiles: [],
    conversation: {
      summary: clipText(memory.summary || "", 1200),
      counterpart: { name: candidateName, organization: String(counterpart.organization || ""), role: String(counterpart.role || ""), appliedPosition, rawHeader: clipText(candidateLabel || counterpart.rawHeader || "", 1600) },
      recentMessages: normalizeAutomationDetailMessages(memory.recentMessages || []),
      currentRecord: { conversationKey: key },
    },
  };
}

function automationItemContext(filename, raw = {}) {
  const sourceKey = automationSourceKeyFromRecord(raw, filename);
  const filePlatform = automationPlatformFromValue(filename, sourceKey.startsWith("job51") ? "51job" : sourceKey.startsWith("zhilian") ? "zhilian" : "boss");
  const sourcePlatform = AUTOMATION_SUMMARY_SOURCES[sourceKey]?.platform || filePlatform;
  const sourceScopedPlatform = /^(boss|job51|zhilian)_[ab]$/.test(sourceKey) ? sourcePlatform : "";
  const platform = sourceScopedPlatform || automationPlatformFromValue(raw.platform || raw.state?.platform || raw.type || filename, sourcePlatform);
  return {
    sourceKey,
    platform,
    source: sourceKey,
    sourceLabel: AUTOMATION_SUMMARY_SOURCES[sourceKey]?.label || automationSourceLabel(filename),
    accountName: raw.accountName || AUTOMATION_SUMMARY_SOURCES[sourceKey]?.label || "",
  };
}

async function collectDeepAutomationDetailRecords(platform, accountId = "all", selectedDate = "all") {
  let filenames = [];
  try {
    filenames = await fs.readdir(AUTOMATION_WORKSPACE);
  } catch {
    return [];
  }
  const records = [];
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  for (const filename of filenames) {
    if (
      !/^(recruiter_batch_reports|agent_web_events|recruiter_decision_log|recruiter_user_questions|recruiter_unclear_questions|recruiter_resume_downloads|job51_resume_downloads|agent_files|agent_chat_memory)\b.*\.(json|jsonl)$/i.test(
        filename
      )
    ) {
      continue;
    }
    const payload = await readAutomationJsonFile(filename);
    if (!payload) continue;
    const values = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? Object.entries(payload).map(([key, value]) => ({ key, value })) : [];

    if (/^recruiter_batch_reports\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((report, reportIndex) => {
        const item = automationItemContext(filename, report || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const results = Array.isArray(report?.results) ? report.results : [];
        results.forEach((result, index) => {
          const record = automationDetailRecordFromResult(result, report, item, index);
          if (record) records.push({ ...record, platform: item.platform, sourceKey: item.sourceKey });
        });
        if (!results.length) {
          const record = automationEventDetailRecord({ createdAt: report?.createdAt, message: report?.message, type: report?.type }, item, reportIndex);
          if (record) records.push({ ...record, platform: item.platform, sourceKey: item.sourceKey });
        }
      });
      continue;
    }

    if (/^agent_web_events\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((event, index) => {
        const item = automationItemContext(filename, event || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationEventDetailRecord({ ...event, message: event.text || event.message || event.kind, type: event.kind || event.type }, item, index);
        if (record) records.push({ ...record, platform: item.platform, sourceKey: item.sourceKey });
      });
      continue;
    }

    if (/^recruiter_decision_log\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((decision, index) => {
        const item = automationItemContext(filename, decision || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationDecisionDetailRecord(decision, item, index);
        if (record) records.push(record);
      });
      continue;
    }

    if (/^recruiter_(user|unclear)_questions\b/i.test(filename) && Array.isArray(payload)) {
      payload.forEach((question, index) => {
        const item = automationItemContext(filename, question?.candidateIdentity || question || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationQuestionDetailRecord(question, item, index);
        if (record) records.push(record);
      });
      continue;
    }

    if (/^(recruiter_resume_downloads|job51_resume_downloads|agent_files)\b/i.test(filename)) {
      values.forEach((entry, index) => {
        const value = entry.value || entry;
        const item = automationItemContext(filename, value || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationDownloadDetailRecord(value, item, index);
        if (record) records.push(record);
      });
      continue;
    }

    if (/^agent_chat_memory\b/i.test(filename)) {
      values.forEach((entry, index) => {
        const value = entry.value || entry;
        const item = automationItemContext(filename, value || {});
        if (!automationPlatformMatches(item.platform, normalizedPlatform) || !automationAccountMatches(item.sourceKey, accountId)) return;
        const record = automationMemoryDetailRecord(entry.key || "", value, item, index);
        if (record) records.push(record);
      });
    }
  }
  if (normalizedPlatform === "boss") {
    records.push(...(await collectBossEmailBatchDetailRecords({ accountId, selectedDate })));
  }
  return records
    .filter((record) => automationDetailDateMatches(record.updatedAt, selectedDate))
    .sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
}

function dedupeAutomationDetailRecords(records = [], metricKey = "", options = {}) {
  const byId = new Map();
  const includeDate = options.includeDate !== false;
  const flagWeight = (record) => {
    const requestedWeight = metricKey && (record.flags?.[metricKey] || record.statusGroup === metricKey) ? 100 : 0;
    return (
      requestedWeight +
      ["savedResumes", "requestedResume", "knowledgeAnswered", "userQuestions", "sentCompanyInfo", "processed"].reduce(
        (score, key, index) => score + (record.flags?.[key] || record.statusGroup === key ? 10 - index : 0),
        0
      )
    );
  };
  for (const record of records) {
    const key = automationRecordContactKey(record, metricKey || record.statusGroup || "processed", { includeDate });
    const current = byId.get(key);
    if (!current || flagWeight(record) > flagWeight(current) || Number(record.updatedAtTs || 0) > Number(current.updatedAtTs || 0)) {
      byId.set(key, record);
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
}

function automationDetailRecordsFromSummaries(items, selectedDate) {
  const records = [];
  for (const item of items) {
    const reports = Array.isArray(item.latestReports) ? item.latestReports : [];
    for (const report of reports) {
      if (!automationDetailDateMatches(report?.createdAt, selectedDate)) continue;
      const results = Array.isArray(report?.results) ? report.results : [];
      results.forEach((result, index) => {
        const record = automationDetailRecordFromResult(result, report, item, index);
        if (record) records.push(record);
      });
      if (!results.length) {
        const record = automationEventDetailRecord(
          { createdAt: report.createdAt, message: report.message, type: report.type },
          item,
          records.length
        );
        if (record) records.push(record);
      }
    }
    const events = Array.isArray(item.latestEvents) ? item.latestEvents : [];
    for (const event of events.slice(0, 24)) {
      if (!automationDetailDateMatches(event?.time || event?.createdAt, selectedDate)) continue;
      const record = automationEventDetailRecord(event, item, records.length);
      if (record) records.push(record);
    }
  }
  return records.sort((a, b) => Number(b.updatedAtTs || 0) - Number(a.updatedAtTs || 0));
}

function filterAutomationDetailRecordsForRequest(records, options = {}) {
  const metric = String(options.metric || "").trim();
  const includeDate = normalizeAutomationDetailDate(options.date) !== "all";
  const baseRecords = Array.isArray(records) ? records : [];
  const filteredRecords = !metric || metric === "processed"
    ? baseRecords.filter(
        (record) =>
          record.type !== "event" &&
          automationRecordHasCandidateIdentity(record) &&
          !Boolean(
            record.flags?.proactiveOpened ||
              record.flags?.proactiveGreeted ||
              record.statusGroup === "proactiveOpened" ||
              record.statusGroup === "proactiveGreeted"
          )
      )
    : baseRecords.filter((record) => automationRecordHasCandidateIdentity(record) && Boolean(record.flags?.[metric] || record.statusGroup === metric));
  return dedupeAutomationDetailRecords(filteredRecords, metric || "processed", { includeDate });
}

async function buildAutomationDetailsPayload(platform, sourceKeys, options = {}) {
  const selectedDate = normalizeAutomationDetailDate(options.date);
  const accountId = options.accountId || "all";
  const deepRecords = await collectDeepAutomationDetailRecords(platform, accountId, selectedDate);
  const items = deepRecords.length ? [] : await Promise.all(sourceKeys.map((sourceKey) => fetchAutomationSummary(sourceKey)));
  const baseRecords = deepRecords.length ? deepRecords : automationDetailRecordsFromSummaries(items, selectedDate);
  const records = filterAutomationDetailRecordsForRequest(baseRecords, options);
  const jobs = [...new Set(records.map((record) => record.appliedPosition).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
  const useRecordMetrics = automationDateListFromState(selectedDate).length > 1;
  return {
    platform,
    date: selectedDate,
    today: automationChinaDateKey(),
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    metrics: deepRecords.length || useRecordMetrics
      ? automationMetricPayloadFromRecords(baseRecords, { includeDate: selectedDate !== "all" })
      : automationDetailMetricPayload(items, platform, {
          accountId: options.accountId,
          date: selectedDate,
        }),
    records,
    filters: {
      jobs,
      statuses: [
        { key: "proactiveReplied", label: "主动联系后已回复" },
        { key: "proactiveQualified", label: "主动联系后符合要求" },
        { key: "proactiveOpened", label: "主动联系已点开" },
        { key: "proactiveGreeted", label: "已主动打招呼" },
        { key: "sentCompanyInfo", label: "已发话术/问题" },
        { key: "requestedResume", label: "已求简历" },
        { key: "userQuestions", label: "用户提问" },
        { key: "savedResumes", label: "获取简历" },
        { key: "waiting", label: "等待/待判断" },
      ],
      types: [
        { key: "candidate", label: "候选人" },
        { key: "event", label: "事件" },
      ],
    },
  };
}

async function handleAutomationDetails(request, response, platform, sourceKeys, accountId = "all") {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const payload = await buildAutomationDetailsPayload(platform, sourceKeys, {
      date: requestUrl.searchParams.get("date") || "",
      mode: requestUrl.searchParams.get("mode") || "",
      metric: requestUrl.searchParams.get("metric") || "",
      accountId,
    });
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "自动化明细读取失败" });
  }
}

async function handlePlatformAutomationDetails(request, response, platform) {
  try {
    const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
    const accountId = normalizeBossAutomationAccountId(requestUrl.searchParams.get("accountId") || "all");
    const normalizedPlatform = normalizeAutomationPlatformId(platform);
    const sourceKeys = platformAutomationSources(normalizedPlatform, accountId);
    await handleAutomationDetails(request, response, normalizedPlatform, sourceKeys, accountId);
  } catch (error) {
    sendJson(response, error.statusCode || 502, { error: error.message || "自动化明细读取失败" });
  }
}

async function fetchAgentJson(sourceKey, targetPath, { method = "GET", body = null, timeoutMs = 900000 } = {}) {
  const source = AUTOMATION_SUMMARY_SOURCES[sourceKey];
  if (!source) {
    const error = new Error(`未知自动化服务：${sourceKey}`);
    error.statusCode = 400;
    throw error;
  }
  if (!source.baseUrl) {
    const error = new Error(`${source.label || sourceKey} 自动化服务未配置`);
    error.statusCode = 502;
    throw error;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const targetUrl = `${source.baseUrl.replace(/\/+$/, "")}${targetPath}`;
  try {
    const result = await fetch(targetUrl, {
      method,
      headers: body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok) {
      const error = new Error(payload.error || payload.message || `${source.label} 请求失败：${result.status}`);
      error.statusCode = result.status;
      error.payload = payload;
      throw error;
    }
    return { payload, source };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function proxyAgentResponse(request, response, sourceKey, targetPath, { timeoutMs = 900000 } = {}) {
  const source = AUTOMATION_SUMMARY_SOURCES[sourceKey];
  if (!source) {
    sendJson(response, 400, { error: `未知自动化服务：${sourceKey}` });
    return;
  }
  const body = request.method === "GET" || request.method === "HEAD" ? null : await readRequestBuffer(request);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const targetUrl = `${source.baseUrl.replace(/\/+$/, "")}${targetPath}`;
  try {
    const result = await fetch(targetUrl, {
      method: request.method,
      headers: body ? { "Content-Type": request.headers["content-type"] || "application/json; charset=utf-8" } : undefined,
      body,
      signal: controller.signal,
    });
    const data = Buffer.from(await result.arrayBuffer());
    response.writeHead(result.status, {
      "Content-Type": result.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": String(data.length),
    });
    response.end(data);
  } catch (error) {
    sendJson(response, 502, { error: `${source.label} 自动化服务请求失败：${error.message || error}` });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseJsonRequestBuffer(buffer) {
  if (!buffer?.length) return {};
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function proxyPlatformAutomationResponse(request, response, platform, targetPath, { timeoutMs = 900000 } = {}) {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  try {
    const rawBody = request.method === "GET" || request.method === "HEAD" ? null : await readRequestBuffer(request);
    const body = parseJsonRequestBuffer(rawBody);
    const accountId = normalizeBossAutomationAccountId(body.accountId || "all");
    const sourceKeys = platformAutomationSources(normalizedPlatform, accountId);
    const results = await Promise.all(
      sourceKeys.map((sourceKey) =>
        fetchAgentJson(sourceKey, targetPath, {
          method: request.method,
          body,
          timeoutMs,
        })
      )
    );
    const parts = results.map(({ payload, source }) => {
      const text = payload.reply || payload.message || payload.result?.reply || payload.result?.message || "完成";
      return `${source.label}：${String(text).replace(/\s+/g, " ").slice(0, 260)}`;
    });
    sendJson(response, 200, {
      ok: true,
      platform: normalizedPlatform,
      accountId,
      sourceKeys,
      message: parts.join("；"),
      result: { message: parts.join("；"), results: results.map((item) => item.payload) },
    });
  } catch (error) {
    sendJson(response, error.statusCode || 502, {
      error: `${automationPlatformLabel(normalizedPlatform)} 自动化服务请求失败：${error.message || error}`,
    });
  }
}

async function listBossBrowserPages() {
  const pages = await fetchLocalJson(`${BOSS_BROWSER_DEBUG_URL}/json/list`);
  return Array.isArray(pages) ? pages.filter((page) => page.type === "page") : [];
}

function isBossPageUrl(url = "") {
  return /zhipin\.com|kanzhun\.com/i.test(String(url));
}

async function getBossBrowserPage() {
  let pages;
  try {
    pages = await listBossBrowserPages();
  } catch {
    const error = new Error("未连接到普通 Chrome/Edge 调试浏览器");
    error.statusCode = 409;
    error.payload = { startHint: getBossBrowserStartHint() };
    throw error;
  }

  const page = pages.find((item) => isBossPageUrl(item.url));
  if (!page?.webSocketDebuggerUrl) {
    const error = new Error("没有找到可控制的浏览器页面");
    error.statusCode = 409;
    error.payload = { startHint: getBossBrowserStartHint() };
    throw error;
  }
  return page;
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    if (typeof WebSocket === "undefined") {
      throw new Error("当前 Node 版本不支持 WebSocket，无法连接浏览器调试端口");
    }

    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message || "浏览器命令失败"));
        } else {
          resolve(message.result || {});
        }
        return;
      }
      if (message.method) {
        this.events.push(message);
      }
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接浏览器超时")), 5000);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("连接浏览器失败"));
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} 执行超时`));
      }, 10000);
    });
  }

  async evaluate(expression, { timeoutMs = 10000 } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "页面脚本执行失败");
    }
    return result.result?.value;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

const BOSS_PAGE_SCAN_SCRIPT = `(() => {
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || el.title || "").replace(/\\s+/g, " ").trim();
  const isDisabled = (el) => el.disabled || /disabled|disable/.test(String(el.className || "")) || el.getAttribute("aria-disabled") === "true";
  const elements = [...document.querySelectorAll("a,button,[role='button']")];
  const triggers = elements
    .map((el, index) => ({
      index,
      text: textOf(el),
      href: el.href || "",
      className: String(el.className || ""),
      visible: visible(el),
      disabled: isDisabled(el)
    }))
    .filter((item) => item.visible && !item.disabled && (/下载|在线简历|附件简历/.test(item.text) || /resume|download|attachment|pdf/i.test(item.href)))
    .slice(0, 20);
  const bodyText = document.body?.innerText || "";
  const onlineResumeOpen = Boolean(document.querySelector(".resume-common-dialog,.new-resume-online-main-ui,.resume-detail-wrap"));
  return {
    url: location.href,
    title: document.title,
    isBossPage: /zhipin\\.com|kanzhun\\.com/i.test(location.href),
    blocked: /验证码|安全验证|登录后|请登录|异常访问|访问受限/.test(bodyText),
    onlineResumeOpen,
    triggers
  };
})()`;

function makeBossClickDownloadScript(domIndex) {
  return `(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const textOf = (el) => (el.innerText || el.textContent || el.getAttribute("aria-label") || el.title || "").replace(/\\s+/g, " ").trim();
    const elements = [...document.querySelectorAll("a,button,[role='button']")];
    const el = elements[${Number(domIndex)}];
    if (!el || !visible(el)) return { clicked: false, reason: "下载入口不可见" };
    const text = textOf(el);
    const href = el.href || "";
    const disabled = el.disabled || /disabled|disable/.test(String(el.className || "")) || el.getAttribute("aria-disabled") === "true";
    if (disabled) return { clicked: false, reason: "入口不可用", text, href };
    if (!(/下载|在线简历|附件简历/.test(text) || /resume|download|attachment|pdf/i.test(href))) {
      return { clicked: false, reason: "该入口不像下载按钮", text, href };
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.click();
    return { clicked: true, text, href };
  })()`;
}

async function getBossResumeFilesSnapshot() {
  const files = await listBossResumePdfFiles();
  const stats = await Promise.all(
    files.map(async (filePath) => {
      const stat = await fs.stat(filePath).catch(() => null);
      return stat ? { filePath, filename: path.basename(filePath), size: stat.size, mtimeMs: stat.mtimeMs } : null;
    })
  );
  return stats.filter(Boolean);
}

async function waitForBossDownloads(beforeFiles, timeoutMs = 8000) {
  const beforeKeys = new Set(beforeFiles.map((file) => `${file.filename}:${file.size}`));
  const start = Date.now();
  let latest = [];

  while (Date.now() - start < timeoutMs) {
    const current = await getBossResumeFilesSnapshot();
    latest = current.filter((file) => !beforeKeys.has(`${file.filename}:${file.size}`));
    const tempFiles = await fs
      .readdir(BOSS_RESUMES_DIR)
      .then((files) => files.filter((name) => /\.crdownload$|\.tmp$/i.test(name)))
      .catch(() => []);
    if (latest.length && !tempFiles.length) break;
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return latest;
}

function getResumeJobDisplayLabel(jobType) {
  return RESUME_JOB_DISPLAY_LABELS[jobType] || jobType || "";
}

function buildResumeCopyFileName(record = {}) {
  const sourceText = `${record.fileName || ""} ${record.name || ""} ${record.school || ""}`;
  const name = compactSafeFilePart(record.name || path.parse(record.fileName || "").name, "候选人");
  const jobType = normalizeJobType(record.jobType || "", sourceText);
  const jobLabel = compactSafeFilePart(getResumeJobDisplayLabel(jobType), "岗位");
  return `${name}_${jobLabel}.pdf`;
}

function imapQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function waitForImapBuffer(test, getBuffer, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (test(getBuffer())) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("邮箱连接超时"));
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

async function createEmailImapClient(emailConfig = getEmailAccountConfig()) {
  const socket = tls.connect({
    host: emailConfig.imapHost,
    port: emailConfig.imapPort,
    servername: emailConfig.imapHost,
  });
  socket.setEncoding("binary");

  let buffer = "";
  let tagIndex = 1;
  socket.on("data", (chunk) => {
    buffer += chunk;
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`连接邮箱 IMAP 超时：${emailConfig.imapHost}:${emailConfig.imapPort}`)), 10000);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await waitForImapBuffer((data) => /\* OK/i.test(data), () => buffer, 10000);
  buffer = "";

  return {
    async command(commandText, { timeoutMs = 30000 } = {}) {
      const tag = `A${String(tagIndex++).padStart(4, "0")}`;
      socket.write(`${tag} ${commandText}\r\n`, "binary");
      const tagLine = new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)[^\\r\\n]*(?:\\r?\\n)?`, "i");
      await waitForImapBuffer((data) => tagLine.test(data), () => buffer, timeoutMs);
      const match = buffer.match(tagLine);
      const end = match.index + match[0].length;
      const responseText = buffer.slice(0, end);
      buffer = buffer.slice(end);
      if (!new RegExp(`${tag} OK`, "i").test(match[0])) {
        throw new Error(`邮箱 IMAP 命令失败：${match[0].trim()}`);
      }
      return responseText;
    },
    close() {
      try {
        socket.end();
      } catch {}
    },
  };
}

function decodeMimeWords(value = "") {
  return String(value).replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_all, charset, encoding, text) => {
    try {
      const bytes =
        encoding.toUpperCase() === "B"
          ? Buffer.from(text, "base64")
          : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))), "binary");
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      try {
        return Buffer.from(text, encoding.toUpperCase() === "B" ? "base64" : "binary").toString("utf8");
      } catch {
        return text;
      }
    }
  });
}

function parseMimeHeaders(headerText = "") {
  const headers = {};
  const lines = String(headerText).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    headers[key] = headers[key] ? `${headers[key]} ${value}` : value;
  }
  return headers;
}

function splitMimeMessage(raw = "") {
  const match = String(raw).match(/\r?\n\r?\n/);
  if (!match) return { headers: {}, body: raw };
  const index = match.index;
  const headerText = raw.slice(0, index);
  const body = raw.slice(index + match[0].length);
  return { headers: parseMimeHeaders(headerText), body };
}

function getMimeBoundary(contentType = "") {
  const match = String(contentType).match(/boundary\*?=(?:[^']*''|")?([^";\r\n]+)"?/i);
  return match ? match[1].trim() : "";
}

function getHeaderFilename(headers = {}) {
  const combined = `${headers["content-disposition"] || ""}; ${headers["content-type"] || ""}`;
  const star = combined.match(/filename\*=([^;\r\n]+)/i) || combined.match(/name\*=([^;\r\n]+)/i);
  if (star) {
    const value = star[1].trim().replace(/^"|"$/g, "");
    const encoded = value.includes("''") ? value.split("''").slice(1).join("''") : value;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return decodeMimeWords(encoded);
    }
  }
  const normal = combined.match(/filename="?([^";\r\n]+)"?/i) || combined.match(/name="?([^";\r\n]+)"?/i);
  return normal ? decodeMimeWords(normal[1].trim()) : "";
}

function decodeQuotedPrintable(text = "") {
  return Buffer.from(
    String(text)
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16))),
    "binary"
  );
}

function isResumeAttachment(headers = {}, filename = "") {
  const contentType = String(headers["content-type"] || "").toLowerCase();
  const lowerName = String(filename || "").toLowerCase();
  return (
    /\.pdf$/i.test(lowerName) ||
    /\.docx?$/i.test(lowerName) ||
    /application\/pdf/i.test(contentType) ||
    /application\/msword/i.test(contentType) ||
    /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(contentType)
  );
}

function isValidResumeAttachmentBuffer(buffer, filename = "") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  const lowerName = String(filename || "").toLowerCase();
  if (/\.pdf$/i.test(lowerName)) return buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if (/\.docx$/i.test(lowerName)) return buffer.subarray(0, 2).equals(Buffer.from("PK"));
  if (/\.doc$/i.test(lowerName)) return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  return true;
}

function collectResumeAttachments(raw = "", attachments = [], depth = 0) {
  if (depth > 8) return attachments;
  const { headers, body } = splitMimeMessage(raw);
  const contentType = headers["content-type"] || "";
  const boundary = getMimeBoundary(contentType);

  if (/multipart\//i.test(contentType) && boundary) {
    const marker = `--${boundary}`;
    const parts = body.split(marker).slice(1);
    for (const part of parts) {
      if (part.startsWith("--")) continue;
      collectResumeAttachments(part.replace(/^\r?\n/, ""), attachments, depth + 1);
    }
    return attachments;
  }

  const filename = getHeaderFilename(headers);
  if (!isResumeAttachment(headers, filename)) return attachments;

  const encoding = String(headers["content-transfer-encoding"] || "").toLowerCase();
  let buffer;
  if (encoding.includes("base64")) {
    buffer = Buffer.from(body.replace(/\s+/g, ""), "base64");
  } else if (encoding.includes("quoted-printable")) {
    buffer = decodeQuotedPrintable(body);
  } else {
    buffer = Buffer.from(body, "binary");
  }

  if (isValidResumeAttachmentBuffer(buffer, filename)) {
    attachments.push({
      filename: filename || "邮箱简历.pdf",
      buffer,
    });
  }
  return attachments;
}

function extractImapLiteral(responseText = "") {
  const match = responseText.match(/\{(\d+)\}\r\n/i);
  if (!match) return "";
  const start = match.index + match[0].length;
  const length = Number(match[1]);
  return responseText.slice(start, start + length);
}

function parseSearchUids(responseText = "") {
  const line = String(responseText)
    .split(/\r?\n/)
    .find((item) => /^\* SEARCH/i.test(item));
  if (!line) return [];
  return line
    .replace(/^\* SEARCH/i, "")
    .trim()
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

const IMAP_SEARCH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatImapSearchDate(date = new Date()) {
  return `${date.getDate()}-${IMAP_SEARCH_MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function addLocalDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getEmailSearchCommand() {
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
      if (shouldUpdateResumeSource(records[duplicateIndex], mergedSource)) {
        records[duplicateIndex] = {
          ...records[duplicateIndex],
          ...mergedSource,
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
      const sourceMeta = buildResumeSourceMetadata({
        ...itemPayload,
        filename: item.filename,
        fileName: item.filename,
        filePath: item.file_path,
      });
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
        sourceMeta,
      });
      const record = saveResult.record || {};
      const importStatus = saveResult.duplicate ? "duplicate" : "saved";
      const payload = {
        ...itemPayload,
        ...result,
        ...sourceMeta,
        source: itemPayload.source || sourceMeta.importSource || "",
        sourcePath: itemPayload.sourcePath || "",
        sourceHash: itemPayload.sourceHash || "",
        size: itemPayload.size || "",
        trigger: itemPayload.trigger || "",
        importSource: itemPayload.source || sourceMeta.importSource || "",
        accountId: sourceMeta.accountId || itemPayload.accountId || "",
        accountLabel: itemPayload.accountLabel || sourceMeta.accountName || "",
        accountName: sourceMeta.accountName || itemPayload.accountName || "",
        email: itemPayload.email || "",
        imapHost: itemPayload.imapHost || "",
        emailSourceKind: itemPayload.emailSourceKind || sourceMeta.emailSourceKind || "",
        sourceLabel: sourceMeta.sourceLabel || itemPayload.sourceLabel || "",
        sourcePlatform: sourceMeta.sourcePlatform || itemPayload.sourcePlatform || "",
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

  const failed = getDb()
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
        "UPDATE batch_items SET status = 'pending', message = ?, resume_id = NULL, payload = '{}', updated_at = ? WHERE job_id = ? AND status = 'failed'"
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

function getCompletedBossImportHashes(manifest) {
  return getCompletedFolderImportHashes(FOLDER_IMPORT_SOURCES.boss, manifest);
}

async function markFolderImportCompleted(item, result = {}) {
  const payload = parsePayload(item.payload, {});
  const source = getFolderImportSourceById(payload.source || "");
  if (!source || !payload.sourceHash) return;

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
    sourcePath: payload.sourcePath || "",
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

async function handleListResumes(_request, response) {
  const records = await readDatabase();
  const resumes = getUniqueCandidateRecords(records)
    .map(publicRecord)
    .sort((left, right) => {
      const scoreDiff = getNumericScore(right) - getNumericScore(left);
      if (scoreDiff !== 0) return scoreDiff;
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    });
  sendJson(response, 200, { resumes });
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
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("PDF not found");
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("复制超时"));
    }, 12000);
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
        reject(new Error(stderr.trim() || stdout.trim() || "复制失败"));
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

