const fsSync = require("node:fs");

function readJsonConfigFile(filePath) {
  try {
    if (!fsSync.existsSync(filePath)) return {};
    const raw = fsSync.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const config = JSON.parse(raw);
    return config && typeof config === "object" ? config : {};
  } catch {
    return {};
  }
}

module.exports = {
  readJsonConfigFile,
};
