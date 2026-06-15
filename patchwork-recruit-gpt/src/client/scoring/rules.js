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

const INTERVIEW_INVITE_TEXT = "加我微信沟通，carhhxh";

function getResumeInviteSourceText(resume = {}) {
  return getResumeSourceDisplay(resume);
}

function getResumePlatformContactDisplayName(resume = {}) {
  const contact = resume.platformContact && typeof resume.platformContact === "object" ? resume.platformContact : {};
  return String(contact.displayName || "").trim();
}

function getResumeInviteUnavailableReason(resume = {}) {
  if (!getResumePlatformContactDisplayName(resume)) return "历史简历缺少平台联系人显示名，无法自动搜索约面试";
  const sourceText = getResumeInviteSourceText(resume);
  if (/邮箱|email|未知/i.test(sourceText)) return "该简历不是自动化平台来源，无法约面试";
  return "";
}

function getResumeInviteButtonLabel(resume = {}) {
  const invite = resume.interviewInvite || {};
  if (invite.status === "sent") return "已约面试";
  if (invite.status === "failed") return "重试约面";
  return "约面试";
}

async function startResumeInterviewInvite(resume, button = null) {
  const unavailable = getResumeInviteUnavailableReason(resume);
  if (unavailable) {
    window.alert(unavailable);
    return;
  }
  const confirmed = window.confirm(
    [
      `确认给 ${resume.name || resume.fileName || "该候选人"} 发送约面试消息？`,
      `来源：${getResumeInviteSourceText(resume)}`,
      `平台联系人：${getResumePlatformContactDisplayName(resume)}`,
      `发送内容：${INTERVIEW_INVITE_TEXT}`,
    ].join("\n")
  );
  if (!confirmed) return;

  const originalText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "发送中";
    button.classList.add("is-working");
  }
  try {
    const payload = await requestJson(`/api/resumes/${resume.id}/interview-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    if (payload.resume) {
      resumeCache = resumeCache.map((item) => (item.id === payload.resume.id ? payload.resume : item));
      if (activeDetailResume?.id === payload.resume.id) activeDetailResume = payload.resume;
      renderResumeTable(getFilteredResumes(resumeCache));
    }
    if (payload.ok) {
      setStatus(payload.message || "约面试消息已发送", "is-done");
    } else {
      setStatus(payload.error || payload.message || "约面试失败", "is-error");
      window.alert(payload.error || payload.message || "约面试失败");
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message || "约面试失败", "is-error");
    window.alert(error.message || "约面试失败");
    if (button) {
      button.disabled = false;
      button.textContent = originalText || getResumeInviteButtonLabel(resume);
    }
  } finally {
    if (button) button.classList.remove("is-working");
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

    const inviteButton = document.createElement("button");
    inviteButton.className = "ghost-btn small interview-invite-btn";
    inviteButton.type = "button";
    inviteButton.textContent = getResumeInviteButtonLabel(resume);
    const unavailable = getResumeInviteUnavailableReason(resume);
    if (resume.interviewInvite?.status === "sent") {
      inviteButton.disabled = true;
      inviteButton.classList.add("is-done");
      inviteButton.title = "该候选人已发送过约面试消息";
    } else if (unavailable) {
      inviteButton.disabled = true;
      inviteButton.title = unavailable;
    } else {
      inviteButton.title = `按平台联系人名搜索并发送：${INTERVIEW_INVITE_TEXT}`;
      inviteButton.addEventListener("click", () => startResumeInterviewInvite(resume, inviteButton));
    }
    actionGroup.appendChild(inviteButton);

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

const RESUME_LIST_SESSION_CACHE_KEY = "resumeAgent.resumeList.session.v1";
const RESUME_LIST_SESSION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
let resumeListCacheSignature = "";

function createResumeListCacheSignature(resumes = []) {
  const list = Array.isArray(resumes) ? resumes : [];
  return [
    list.length,
    ...list.map((resume) =>
      [
        resume.id || "",
        resume.updatedAt || "",
        resume.matchScore ?? "",
        resume.hasPdf ? "1" : "0",
        resume.feedback?.updatedAt || "",
        resume.feedback?.decision || "",
      ].join(":")
    ),
  ].join("|");
}

function readResumeListSessionCache() {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(RESUME_LIST_SESSION_CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.resumes)) return null;
    const cachedAt = Number(payload.cachedAt || 0);
    if (cachedAt && Date.now() - cachedAt > RESUME_LIST_SESSION_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(RESUME_LIST_SESSION_CACHE_KEY);
      return null;
    }
    return {
      resumes: payload.resumes,
      cacheSignature: payload.cacheSignature || createResumeListCacheSignature(payload.resumes),
    };
  } catch {
    return null;
  }
}

function writeResumeListSessionCache(resumes = [], cacheSignature = "") {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    const list = Array.isArray(resumes) ? resumes : [];
    window.sessionStorage.setItem(
      RESUME_LIST_SESSION_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        cacheSignature: cacheSignature || createResumeListCacheSignature(list),
        resumes: list,
      })
    );
  } catch {
    // The resume list can exceed browser storage limits; backend cache still speeds up reloads.
  }
}

function applyResumeList(resumes = [], cacheSignature = "") {
  const list = Array.isArray(resumes) ? resumes : [];
  const nextSignature = cacheSignature || createResumeListCacheSignature(list);
  if (resumeListCacheSignature && nextSignature === resumeListCacheSignature) {
    resumeCache = list;
    return false;
  }
  resumeCache = list;
  resumeListCacheSignature = nextSignature;
  refreshResumeView();
  return true;
}

async function loadResumeList(options = {}) {
  const cachedSnapshot = options.skipSessionCache ? null : readResumeListSessionCache();
  if (cachedSnapshot) {
    applyResumeList(cachedSnapshot.resumes, cachedSnapshot.cacheSignature);
  }

  try {
    const payload = await requestJson("/api/resumes");
    const resumes = Array.isArray(payload.resumes) ? payload.resumes : [];
    const cacheSignature = payload.cacheSignature || createResumeListCacheSignature(resumes);
    applyResumeList(resumes, cacheSignature);
    writeResumeListSessionCache(resumes, cacheSignature);
    return resumes;
  } catch (error) {
    if (cachedSnapshot) {
      console.warn("Resume list refresh failed; using session cache.", error);
      return cachedSnapshot.resumes;
    }
    throw error;
  }
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

