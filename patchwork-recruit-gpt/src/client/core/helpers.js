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
  if (/运营A|企业内容运营负责人|B2B.*短视频|短视频方向|内容运营负责人/i.test(value)) return "运营A";
  if (/运营B|B端社交媒体运营|社交媒体运营|B端.*运营/i.test(value)) return "运营B";
  if (/外部财务产品顾问|业财智能化顾问|AI财务场景顾问|财务场景顾问|财务产品顾问|财务数字化顾问|CFO顾问/i.test(value)) return "外部财务产品顾问";
  if (/AI智能体解决方案负责人|智能体解决方案负责人|AI\s*Solution\s*Architect|Solution\s*Architect|AI\s*FDE|\bFDE\b|AI\s*Workflow\s*Engineer|Workflow\s*Engineer|Agent解决方案/i.test(value)) return "AI智能体解决方案负责人";
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

