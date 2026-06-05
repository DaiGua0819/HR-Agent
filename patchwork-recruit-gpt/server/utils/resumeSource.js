function normalizeAutomationPlatformId(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "51" || key === "51job" || key === "job51" || key === "job51_a" || key === "job51_b") return "51job";
  if (key === "zhilian" || key === "zhaopin" || key === "zhilian_a" || key === "zhilian_b") return "zhilian";
  return "boss";
}

function automationPlatformLabel(platform) {
  const normalized = normalizeAutomationPlatformId(platform);
  if (normalized === "51job") return "51";
  if (normalized === "zhilian") return "智联";
  return "BOSS";
}

function normalizeBossAutomationAccountId(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "boss_b" || key === "hexinhong" || key.includes("和新红")) return "boss_b";
  if (key === "boss_a" || key === "songfengfeng" || key.includes("宋峰峰") || key.includes("宋锋峰")) return "boss_a";
  return "all";
}

function automationAccountLabel(accountId) {
  const normalized = normalizeBossAutomationAccountId(accountId);
  if (normalized === "boss_a") return "宋峰峰";
  if (normalized === "boss_b") return "和新红";
  return "全部账号";
}

function bossAutomationSources(accountId) {
  const normalized = normalizeBossAutomationAccountId(accountId);
  return normalized === "all" ? ["boss_a", "boss_b"] : [normalized];
}

function inferResumeSourcePlatform(value = "", fallback = "") {
  const text = String(value || "").toLowerCase();
  if (/51job|job51|前程|51招聘/.test(text)) return "51job";
  if (/zhilian|zhaopin|智联/.test(text)) return "zhilian";
  if (/boss|zhipin|kanzhun|邮箱|email|mail/.test(text)) return "boss";
  return normalizeAutomationPlatformId(fallback || "boss");
}

function inferResumeSourceAccountId(value = "") {
  const text = String(value || "");
  if (/boss_b|job51_b|zhilian_b|hexinhong|和新红/i.test(text)) return "boss_b";
  if (/boss_a|job51_a|zhilian_a|songfengfeng|宋峰峰|宋锋峰/i.test(text)) return "boss_a";
  const emailUidMatch = text.match(/(?:邮箱|email|mail)[_\s-]*(\d{1,6})[_\s-]/i);
  if (emailUidMatch) {
    const uid = Number(emailUidMatch[1]);
    if (Number.isFinite(uid) && uid > 0) return uid >= 1000 ? "boss_b" : "boss_a";
  }
  const normalized = normalizeBossAutomationAccountId(text);
  return normalized === "all" ? "" : normalized;
}

function inferDefaultResumeSourceAccountId(platform = "", sourceText = "") {
  const normalizedPlatform = normalizeAutomationPlatformId(platform);
  const text = String(sourceText || "");
  if (normalizedPlatform === "51job" || normalizedPlatform === "zhilian") return "boss_a";
  if (/boss|boss直聘|zhipin|kanzhun|邮箱|email|mail/i.test(text)) return "boss_a";
  return "";
}

function isDirectEmailResumeSource(input = {}) {
  const kind = String(input.emailSourceKind || input.sourceKind || "").trim().toLowerCase();
  if (kind === "direct" || kind === "direct-email") return true;
  return [input.sourceLabel, input.sourceName, input.sourcePlatform, input.platform].some((value) => {
    const text = String(value || "").trim().toLowerCase();
    return text === "邮箱" || text === "email";
  });
}

function buildResumeSourceMetadata(input = {}) {
  if (isDirectEmailResumeSource(input)) {
    return {
      source: "邮箱",
      sourceLabel: "邮箱",
      sourceName: "邮箱",
      sourcePlatform: "邮箱",
      platform: "email",
      importSource: input.source || input.importSource || "",
      accountId: "",
      accountName: "",
      emailSourceKind: "direct",
    };
  }

  const sourceText = [
    input.sourceLabel,
    input.sourceName,
    input.sourcePlatform,
    input.importSource,
    input.source,
    input.platform,
    input.accountId,
    input.accountLabel,
    input.accountName,
    input.sourcePath,
    input.filePath,
    input.filename,
    input.fileName,
    input.parseMode,
    input.trigger,
  ]
    .filter(Boolean)
    .join(" ");
  const hasSourceHint =
    Boolean(input.source || input.importSource || input.sourceLabel || input.accountId || input.accountLabel || input.accountName || input.sourcePath || input.filePath || input.trigger) ||
    /51job|job51|前程|zhilian|zhaopin|智联|boss|zhipin|kanzhun|邮箱|email|mail/i.test(sourceText);
  if (!hasSourceHint) {
    return {
      source: "",
      sourceLabel: "",
      sourceName: "",
      sourcePlatform: "",
      platform: "",
      importSource: "",
      accountId: "",
      accountName: "",
    };
  }
  const fallbackPlatform =
    input.platform || (input.source === "51job-resumes" ? "51job" : input.source === "zhilian-resumes" ? "zhilian" : "boss");
  const platform = inferResumeSourcePlatform(sourceText, fallbackPlatform);
  const platformLabel = automationPlatformLabel(platform);
  const accountId =
    inferResumeSourceAccountId(input.accountId || input.accountLabel || input.accountName || sourceText) ||
    inferDefaultResumeSourceAccountId(platform, sourceText);
  const accountName = accountId ? automationAccountLabel(accountId) : "";
  const sourceLabel = accountName ? `${platformLabel} ${accountName}` : platformLabel;
  return {
    source: sourceLabel,
    sourceLabel,
    sourceName: sourceLabel,
    sourcePlatform: platformLabel,
    platform,
    importSource: input.source || input.importSource || "",
    accountId,
    accountName,
    emailSourceKind: input.emailSourceKind || "",
  };
}

module.exports = {
  normalizeAutomationPlatformId,
  automationPlatformLabel,
  normalizeBossAutomationAccountId,
  automationAccountLabel,
  bossAutomationSources,
  inferResumeSourcePlatform,
  inferResumeSourceAccountId,
  inferDefaultResumeSourceAccountId,
  buildResumeSourceMetadata,
};
