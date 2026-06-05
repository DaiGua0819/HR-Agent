function safeFilePart(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

function compactSafeFilePart(value, fallback = "") {
  return safeFilePart(value).replace(/_+/g, "_").replace(/^_+|_+$/g, "") || fallback;
}

function clipText(value, maxLength = 900) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizeConversationName(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[，,。.;；:：()（）【】\[\]<>《》"'“”‘’]/g, "")
    .trim();
}

module.exports = {
  safeFilePart,
  compactSafeFilePart,
  clipText,
  normalizeConversationName,
};
