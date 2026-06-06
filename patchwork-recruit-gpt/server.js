const { loadLegacyServer } = require("./server/runtime/legacyServerLoader");

loadLegacyServer({
  rootDir: __dirname,
  filename: __filename,
  requireFn: require,
  moduleObj: module,
  exportsObj: exports,
});
