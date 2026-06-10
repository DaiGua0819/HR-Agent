(() => {
  const CLIENT_CHUNKS = [
    "./src/client/core/state.js",
    "./src/client/core/helpers.js",
    "./src/client/automation/overview.js",
    "./src/client/resumes/library.js",
    "./src/client/scoring/rules.js",
    "./src/client/batch/imports.js",
    "./src/client/core/init.js",
  ];
  const VERSION = "20260610-process-busy-sync";
  const statusNode = document.querySelector("#statusPill");

  async function loadClient() {
    const sources = [];
    for (const chunk of CLIENT_CHUNKS) {
      const url = `${chunk}?v=${VERSION}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`前端脚本加载失败：${chunk} (${response.status})`);
      }
      sources.push(`\n;/* ${chunk} */\n${await response.text()}`);
    }
    (0, eval)(`${sources.join("\n")}\n//# sourceURL=resume-agent-client.bundle.js`);
    window.RESUME_AGENT_CLIENT_SPLIT = true;
  }

  loadClient().catch((error) => {
    console.error(error);
    if (statusNode) {
      statusNode.textContent = error.message || "前端初始化失败";
      statusNode.className = "status-pill";
    }
  });
})();
