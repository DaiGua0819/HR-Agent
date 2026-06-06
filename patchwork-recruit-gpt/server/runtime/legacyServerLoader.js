const fs = require("node:fs");
const path = require("node:path");

function readLegacyServerSource(partsDir) {
  return fs
    .readdirSync(partsDir)
    .filter((name) => /^server\.part\d+\.js$/.test(name))
    .sort()
    .map((name) => fs.readFileSync(path.join(partsDir, name), "utf8"))
    .join("\n");
}

function loadLegacyServer({ rootDir, filename, requireFn, moduleObj, exportsObj }) {
  const partsDir = path.join(rootDir, "server", "legacy-parts");
  const code = readLegacyServerSource(partsDir);
  const runLegacyServer = new Function("require", "module", "exports", "__filename", "__dirname", code);
  runLegacyServer(requireFn, moduleObj, exportsObj, filename, rootDir);
}

module.exports = {
  loadLegacyServer,
  readLegacyServerSource,
};
