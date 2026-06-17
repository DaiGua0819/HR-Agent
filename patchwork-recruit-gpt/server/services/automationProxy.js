function createAutomationProxyService({
  sources,
  sendJson,
  readRequestBuffer,
  normalizePlatformId,
  normalizeAccountId,
  platformLabel,
  platformSources,
  getRequestBaseUrl,
}) {
  function getSource(sourceKey) {
    const source = sources[sourceKey];
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
    return source;
  }

  async function fetchAutomationSummary(sourceKey) {
    const source = sources[sourceKey] || sources.zhilian;
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
        const error = new Error(payload.error || `${source.label} 自动化统计读取失败`);
        error.statusCode = result.status;
        error.payload = payload;
        throw error;
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

  async function fetchAgentJson(sourceKey, targetPath, { method = "GET", body = null, timeoutMs = 900000 } = {}) {
    const source = getSource(sourceKey);
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
    } catch (error) {
      if (error?.statusCode) throw error;
      const wrapped = new Error(`${source.label || sourceKey} 自动化服务请求失败：${error?.message || error}`);
      wrapped.statusCode = 502;
      throw wrapped;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function proxyAgentResponse(request, response, sourceKey, targetPath, { timeoutMs = 900000 } = {}) {
    let source;
    try {
      source = getSource(sourceKey);
    } catch (error) {
      sendJson(response, error.statusCode || 502, { error: error.message || "自动化服务未配置" });
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

  function platformPathPrefix(platform) {
    if (platform === "51job") return "/api/51job";
    if (platform === "zhilian") return "/api/zhilian";
    return `/api/${platform}`;
  }

  function proxyStartActionFromPath(platform, targetPath = "") {
    const cleanPath = String(targetPath || "").split("?")[0];
    const prefix = platformPathPrefix(platform);
    if (cleanPath === `${prefix}/process-messages`) return "处理消息";
    if (cleanPath === `${prefix}/proactive-contact`) return "主动联系";
    return "";
  }

  async function proxyPlatformAutomationResponse(request, response, platform, targetPath, { timeoutMs = 900000 } = {}) {
    const normalizedPlatform = normalizePlatformId(platform);
    try {
      const rawBody = request.method === "GET" || request.method === "HEAD" ? null : await readRequestBuffer(request);
      const body = parseJsonRequestBuffer(rawBody);
      const requestUrl = new URL(request.url, getRequestBaseUrl());
      const accountId = normalizeAccountId(body.accountId || requestUrl.searchParams.get("accountId") || "all");
      const sourceKeys = platformSources(normalizedPlatform, accountId);
      const startAction = request.method === "POST" ? proxyStartActionFromPath(normalizedPlatform, targetPath) : "";
      console.log(`[automation-proxy] platform=${normalizedPlatform} account=${accountId} sourceKeys=${sourceKeys.join(",")} path=${targetPath}`);
      const results = await Promise.all(
        sourceKeys.map(async (sourceKey) => {
          if (startAction) {
            await fetchAgentJson(sourceKey, "/api/pause", {
              method: "POST",
              body: {
                paused: false,
                pause: false,
                reason: `开始${platformLabel(normalizedPlatform)}${startAction}前自动解除暂停`,
              },
              timeoutMs: 30000,
            });
          }
          return fetchAgentJson(sourceKey, targetPath, {
            method: request.method,
            body,
            timeoutMs,
          });
        })
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
        error: `${platformLabel(normalizedPlatform)} 自动化服务请求失败：${error.message || error}`,
      });
    }
  }

  return {
    fetchAutomationSummary,
    fetchAgentJson,
    proxyAgentResponse,
    parseJsonRequestBuffer,
    proxyPlatformAutomationResponse,
  };
}

module.exports = {
  createAutomationProxyService,
};
