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
  refreshDailyPieChart().catch((error) => console.warn(error));
}

function dailyPieSelectedPlatforms() {
  const selected = getSelectedFilterValues(elements.dailyPiePlatformSelect).map(normalizeAutomationPlatform);
  return selected.length ? [...new Set(selected)] : [...DAILY_PIE_DEFAULT_PLATFORMS];
}

function dailyPieSelectedAccounts() {
  const selected = getSelectedFilterValues(elements.dailyPieAccountSelect).map(normalizeBossAutomationAccountId).filter((item) => item !== "all");
  return selected.length ? [...new Set(selected)] : [...DAILY_PIE_DEFAULT_ACCOUNTS];
}

function dailyPieRequestAccounts() {
  const selected = getSelectedFilterValues(elements.dailyPieAccountSelect).map(normalizeBossAutomationAccountId).filter((item) => item !== "all");
  return selected.length ? [...new Set(selected)] : ["all"];
}

function dailyPieSelectedJobs() {
  return getSelectedFilterValues(elements.dailyPieJobSelect).map((item) => String(item || "").trim()).filter(Boolean);
}

function dailyPieDetailsPath(platform) {
  const normalized = normalizeAutomationPlatform(platform);
  if (normalized === "job51") return "/api/51job-automation/details";
  if (normalized === "zhilian") return "/api/zhilian-automation/details";
  return "/api/boss-automation/details";
}

function dailyPieLabelList(values, labeler, fallback) {
  if (!values.length) return fallback;
  return values.map(labeler).join("、");
}

function dailyPieRecordJob(record) {
  return String(record?.appliedPosition || record?.position || record?.jobType || "未识别岗位").trim() || "未识别岗位";
}

function dailyPieRequestIdentity(dateState = bossAutomationSummaryDate) {
  return [
    normalizeDateState(dateState, getChinaDateKey()),
    bossAutomationSummaryMode === "proactive" ? "proactive" : "process",
    dailyPieSelectedPlatforms().join(","),
    dailyPieRequestAccounts().join(","),
  ].join("|");
}

function updateDailyPieJobOptions(records = []) {
  if (!elements.dailyPieJobSelect) return;
  const previous = new Set(dailyPieSelectedJobs());
  const jobs = [...new Set(records.map(dailyPieRecordJob).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  elements.dailyPieJobSelect.replaceChildren(
    (() => {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "全部岗位";
      return option;
    })(),
    ...jobs.map((job) => {
      const option = document.createElement("option");
      option.value = job;
      option.textContent = job;
      option.selected = previous.has(job);
      return option;
    })
  );
  rebuildCheckboxFilter(elements.dailyPieJobSelect);
}

function animateDailyPieChart() {
  const chart = elements.dailyPieChart;
  if (!chart) return;
  chart.classList.remove("is-animating");
  void chart.offsetWidth;
  chart.classList.add("is-animating");
}

function dailyPiePointOnCircle(angleDeg, radius = 48) {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: 50 + radius * Math.cos(angle),
    y: 50 + radius * Math.sin(angle),
  };
}

function dailyPieSlicePath(startPercent, endPercent) {
  const startAngle = -90 + startPercent * 3.6;
  const endAngle = -90 + Math.min(endPercent, 99.999) * 3.6;
  const start = dailyPiePointOnCircle(startAngle);
  const end = dailyPiePointOnCircle(endAngle);
  const largeArc = endPercent - startPercent > 50 ? 1 : 0;
  return `M 50 50 L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A 48 48 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
}

function moveDailyPieTooltip(event, tooltip) {
  if (!tooltip || !elements.dailyPieChart) return;
  const rect = elements.dailyPieChart.getBoundingClientRect();
  tooltip.style.left = `${event.clientX - rect.left}px`;
  tooltip.style.top = `${event.clientY - rect.top}px`;
}

function renderDailyPieSlices(slices, total) {
  const chart = elements.dailyPieChart;
  if (!chart || !total) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("daily-pie-slices");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const tooltip = document.createElement("div");
  tooltip.className = "daily-pie-tooltip";
  tooltip.setAttribute("role", "tooltip");

  let cursor = 0;
  slices.forEach((slice, index) => {
    const start = cursor;
    const next = cursor + (slice.value / total) * 100;
    cursor = next;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const color = DAILY_PIE_COLORS[index % DAILY_PIE_COLORS.length];
    const percent = ((slice.value / total) * 100).toFixed(1);
    const info = `${slice.label}：${slice.value} 人，占比 ${percent}%`;
    path.classList.add("daily-pie-slice");
    path.setAttribute("d", dailyPieSlicePath(start, next));
    path.setAttribute("fill", color);
    path.dataset.info = info;
    path.addEventListener("mouseenter", (event) => {
      path.classList.add("is-active");
      tooltip.textContent = info;
      tooltip.classList.add("is-visible");
      moveDailyPieTooltip(event, tooltip);
    });
    path.addEventListener("mousemove", (event) => moveDailyPieTooltip(event, tooltip));
    path.addEventListener("mouseleave", () => {
      path.classList.remove("is-active");
      tooltip.classList.remove("is-visible");
    });
    svg.append(path);
  });

  chart.append(svg, tooltip);
}

function renderDailyPieChart(records = dailyPieRecords) {
  if (!elements.dailyPiePanel || !elements.dailyPieChart || !elements.dailyPieLegend) return;
  const selectedJobs = dailyPieSelectedJobs();
  const filtered = selectedJobs.length ? records.filter((record) => selectedJobs.includes(dailyPieRecordJob(record))) : records;
  const counts = new Map();
  for (const record of filtered) {
    const job = dailyPieRecordJob(record);
    counts.set(job, (counts.get(job) || 0) + 1);
  }
  let slices = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
  if (!selectedJobs.length && slices.length > 8) {
    const top = slices.slice(0, 8);
    const otherValue = slices.slice(8).reduce((total, item) => total + item.value, 0);
    slices = otherValue ? [...top, { label: "其他岗位", value: otherValue }] : top;
  }
  const total = slices.reduce((sum, item) => sum + item.value, 0);
  elements.dailyPiePanel.hidden = false;
  elements.dailyPieChart.innerHTML = `<span>${total}</span>`;
  elements.dailyPieChart.setAttribute("aria-label", `每日数据扇形图，总计 ${total} 人`);

  if (!total) {
    elements.dailyPieChart.classList.remove("is-animating");
    elements.dailyPieChart.style.setProperty("--pie-gradient", "#eef2f7");
    elements.dailyPieLegend.replaceChildren();
    if (elements.dailyPieMeta) elements.dailyPieMeta.textContent = "暂无可统计数据";
    return;
  }

  let cursor = 0;
  const gradientParts = slices.map((slice, index) => {
    const start = cursor;
    const next = cursor + (slice.value / total) * 100;
    cursor = next;
    const color = DAILY_PIE_COLORS[index % DAILY_PIE_COLORS.length];
    return `${color} ${start.toFixed(3)}% ${next.toFixed(3)}%`;
  });
  elements.dailyPieChart.style.setProperty("--pie-gradient", `conic-gradient(${gradientParts.join(", ")})`);
  renderDailyPieSlices(slices, total);
  animateDailyPieChart();
  elements.dailyPieLegend.replaceChildren(
    ...slices.map((slice, index) => {
      const row = document.createElement("div");
      row.className = "daily-pie-legend-row";
      const swatch = document.createElement("span");
      swatch.className = "daily-pie-swatch";
      swatch.style.background = DAILY_PIE_COLORS[index % DAILY_PIE_COLORS.length];
      const label = document.createElement("span");
      label.className = "daily-pie-label";
      label.textContent = slice.label;
      const value = document.createElement("strong");
      value.textContent = `${slice.value} 人 · ${((slice.value / total) * 100).toFixed(1)}%`;
      row.append(swatch, label, value);
      return row;
    })
  );

  if (elements.dailyPieMeta) {
    const modeText = bossAutomationSummaryMode === "proactive" ? "主动联系点开人数" : "处理消息人数";
    const selectedAccounts = getSelectedFilterValues(elements.dailyPieAccountSelect).map(normalizeBossAutomationAccountId).filter((item) => item !== "all");
    elements.dailyPieMeta.textContent = `${dateStateLabel(bossAutomationSummaryDate)} · ${dailyPieLabelList(
      dailyPieSelectedPlatforms(),
      automationPlatformLabel,
      "全部平台"
    )} · ${selectedAccounts.length ? dailyPieLabelList(selectedAccounts, bossAutomationAccountLabel, "全部账号") : "全部账号"} · ${modeText}`;
  }
}

async function refreshDailyPieChart({ force = false } = {}) {
  if (!elements.dailyPiePanel) return;
  const dateState = normalizeDateState(bossAutomationSummaryDate, getChinaDateKey());
  const requestKey = dailyPieRequestIdentity(dateState);
  if (!force && requestKey === dailyPieLoadingKey) return;
  if (!force && requestKey === dailyPieRequestKey) {
    renderDailyPieChart(dailyPieRecords);
    return;
  }
  const requestSeq = ++dailyPieRequestSeq;
  dailyPieLoadingKey = requestKey;
  if (elements.dailyPieMeta) elements.dailyPieMeta.textContent = "正在读取每日数据";
  const mode = bossAutomationSummaryMode === "proactive" ? "proactive" : "process";
  const metric = mode === "proactive" ? "proactiveOpened" : "processed";
  try {
    const requests = [];
    for (const platform of dailyPieSelectedPlatforms()) {
      for (const accountId of dailyPieRequestAccounts()) {
        const endpoint = `${dailyPieDetailsPath(platform)}?date=${encodeURIComponent(dateState)}&mode=${encodeURIComponent(
          mode
        )}&metric=${encodeURIComponent(metric)}&accountId=${encodeURIComponent(accountId)}`;
        requests.push(
          requestJson(endpoint).then((payload) =>
            (Array.isArray(payload.records) ? payload.records : []).map((record) => ({
              ...record,
              platform: normalizeAutomationPlatform(record.platform || platform),
              accountId,
            }))
          )
        );
      }
    }
    const groups = await Promise.all(requests);
    if (requestSeq !== dailyPieRequestSeq) return;
    dailyPieRecords = groups.flat();
    dailyPieRequestKey = requestKey;
    updateDailyPieJobOptions(dailyPieRecords);
    renderDailyPieChart(dailyPieRecords);
  } catch (error) {
    console.error(error);
    if (requestSeq !== dailyPieRequestSeq) return;
    dailyPieRecords = [];
    updateDailyPieJobOptions([]);
    renderDailyPieChart([]);
    if (elements.dailyPieMeta) elements.dailyPieMeta.textContent = error.message || "每日数据读取失败";
  } finally {
    if (dailyPieLoadingKey === requestKey) dailyPieLoadingKey = "";
  }
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

