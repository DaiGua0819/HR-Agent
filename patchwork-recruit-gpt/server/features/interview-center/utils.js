const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = {}) {
  try {
    if (value === undefined || value === null || value === "") return fallback;
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function clipText(value, maxLength = 900) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function compactText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function normalizeDateSeconds(value) {
  if (!value) return 0;
  if (typeof value === "number") return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Math.floor(Number(value));
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function randomId(prefix = "item") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqStrings(items = [], limit = 20) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const text = compactText(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function parseMaybeJsonObject(text, fallback = null) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

module.exports = {
  nowIso,
  parseJson,
  clipText,
  compactText,
  normalizeText,
  normalizeDateSeconds,
  randomId,
  safeArray,
  uniqStrings,
  parseMaybeJsonObject,
};
