function inferEmailImapHost(address = "") {
  const domain = String(address).split("@").pop()?.toLowerCase() || "";
  if (domain === "qq.com") return "imap.qq.com";
  if (domain === "foxmail.com") return "imap.qq.com";
  if (domain === "163.com") return "imap.163.com";
  if (domain === "126.com") return "imap.126.com";
  if (domain === "gmail.com") return "imap.gmail.com";
  if (domain === "outlook.com" || domain === "hotmail.com") return "outlook.office365.com";
  return "imap.exmail.qq.com";
}

function getEnvKeyForAccount(accountId, suffix) {
  return `EMAIL_${String(accountId || "").toUpperCase()}_${suffix}`;
}

function maskEmailAddress(address = "") {
  const value = String(address || "");
  const [name, domain] = value.split("@");
  if (!name || !domain) return value ? "***" : "";
  return `${name.slice(0, 2)}***@${domain}`;
}

module.exports = {
  inferEmailImapHost,
  getEnvKeyForAccount,
  maskEmailAddress,
};
