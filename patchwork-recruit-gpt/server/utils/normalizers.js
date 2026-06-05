function normalizeBoolean(value) {
  return value === true || value === "true" || value === "是";
}

function normalizeScoreValue(value) {
  if (value === "" || value === null || value === undefined) return "";
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.min(100, Math.round(numberValue))) : "";
}

function normalizeBoundedScore(value, maxScore) {
  if (value === "" || value === null || value === undefined) return "";
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.min(maxScore, Math.round(numberValue))) : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

module.exports = {
  normalizeBoolean,
  normalizeScoreValue,
  normalizeBoundedScore,
  normalizeStringArray,
};
