const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { clipText, compactText, normalizeText, safeArray } = require("./utils");

const DEFAULT_ALLOWED_JOBS = ["AI应用开发实习生", "AI应用开发", "AI Agent开发", "AI实习生", "智能体", "Agent", "RAG"];
const RESUME_FIELD = "简历";
const INTERVIEW_RECORD_FIELD = "面试记录";
const SKILL_EVALUATION_FIELD = process.env.FEISHU_INTERVIEW_SKILL_EVALUATION_FIELD || "技能评价";

function splitConfigList(value, fallback = []) {
  const items = String(value || "")
    .split(/[,\n;，；]+/)
    .map((item) => compactText(item))
    .filter(Boolean);
  return items.length ? items : fallback;
}

function safeFilename(value = "image") {
  return String(value || "image")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function hashText(value = "") {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

function extractFieldText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(extractFieldText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return [
      value.text,
      value.name,
      value.email,
      value.id,
      safeArray(value.text_arr).map(extractFieldText).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function attachmentTokens(value) {
  return safeArray(value)
    .map((item) => item?.file_token || item?.fileToken || item?.token || "")
    .filter(Boolean);
}

function recordId(record = {}) {
  if (!record) return "";
  return record.record_id || record.id || "";
}

function fieldTypeText(field = {}) {
  return [field.type, field.field_type, field.ui_type, field.property?.type, field.property?.field_type]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).toLowerCase())
    .join(" ");
}

function documentFieldValueCandidates(field = {}, doc = {}, fieldText = "") {
  const typeText = fieldTypeText(field);
  const url = doc.url || "";
  const title = doc.title || "技能评价";
  const textValue = [url, fieldText].filter(Boolean).join("\n") || url || title;
  const urlValue = { text: title, link: url };
  const attachmentValue = doc.documentId ? [{ file_token: doc.documentId }] : null;
  const candidates = [];
  if (/17|attachment|file|附件/.test(typeText) && attachmentValue) candidates.push(attachmentValue);
  if (/15|url|link|链接/.test(typeText)) candidates.push(urlValue);
  candidates.push(textValue);
  candidates.push(urlValue);
  if (attachmentValue) candidates.push(attachmentValue);
  const seen = new Set();
  return candidates.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasDocxLink(value = "") {
  return /https?:\/\/(?:www\.)?(?:feishu|larksuite)\.cn\/docx\/[A-Za-z0-9]+/i.test(String(value || ""));
}

function positionAllowedForTable({ session = {}, resume = {}, tableInfo = {} } = {}) {
  const allowedJobs = splitConfigList(process.env.FEISHU_INTERVIEW_BITABLE_ALLOWED_JOBS, DEFAULT_ALLOWED_JOBS);
  const tableName = compactText(tableInfo.name || tableInfo.table_name || "");
  const jobText = [resume.jobType, resume.appliedPosition, session.matchedResume?.jobType, session.title, session.description]
    .map(compactText)
    .filter(Boolean)
    .join(" ");
  const normalizedJob = normalizeText(jobText);
  if (!normalizedJob) return { allowed: false, reason: "missing_job_text", jobText, tableName };

  const matchedKeyword = allowedJobs.find((keyword) => normalizeText(keyword) && normalizedJob.includes(normalizeText(keyword)));
  if (matchedKeyword) return { allowed: true, reason: "allowed_job_keyword", keyword: matchedKeyword, jobText, tableName };

  const normalizedTable = normalizeText(tableName);
  if (normalizedTable && normalizedJob.includes(normalizedTable)) return { allowed: true, reason: "table_name_match", keyword: tableName, jobText, tableName };
  if (/ai/i.test(tableName) && /ai/i.test(jobText) && /实习|开发|agent|智能体|rag/i.test(jobText)) {
    return { allowed: true, reason: "ai_table_job_match", keyword: tableName, jobText, tableName };
  }
  return { allowed: false, reason: "job_not_in_bitable_table", jobText, tableName };
}

function runPythonJson(scriptPath, args, { timeoutMs = 120000 } = {}) {
  const python = process.env.INTERVIEW_CENTER_PYTHON || process.env.PYTHON || "python";
  const result = spawnSync(python, [scriptPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
  });
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  let payload = null;
  try {
    payload = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).pop() || "{}");
  } catch {
    payload = null;
  }
  if (result.error || result.status !== 0 || !payload?.ok) {
    const message = payload?.error || result.error?.message || stderr || stdout || "图片生成失败";
    const error = new Error(message);
    error.payload = { scriptPath, status: result.status, stdout: clipText(stdout, 1000), stderr: clipText(stderr, 1000) };
    throw error;
  }
  return payload;
}

function assetDir(dataDir = "") {
  return path.join(dataDir || path.join(process.cwd(), "data"), "interview-center-assets");
}

function resumePdfPath(resume = {}, dataDir = "") {
  const explicit = compactText(resume.pdfPath || "");
  if (explicit && fsSync.existsSync(explicit)) return explicit;
  const fallback = resume.id ? path.join(dataDir || "", "uploads", `${resume.id}.pdf`) : "";
  return fallback && fsSync.existsSync(fallback) ? fallback : "";
}

async function renderResumeLongImage({ resume, dataDir }) {
  const pdfPath = resumePdfPath(resume, dataDir);
  if (!pdfPath) {
    const error = new Error("候选人没有可用 PDF 简历，无法生成简历长截图");
    error.statusCode = 409;
    throw error;
  }
  const sourceStat = await fs.stat(pdfPath);
  const signature = hashText(`${pdfPath}:${sourceStat.size}:${sourceStat.mtimeMs}`);
  const outputPath = path.join(assetDir(dataDir), `${resume.id || signature}_resume_${signature}.png`);
  if (!fsSync.existsSync(outputPath)) {
    const scriptPath = path.join(__dirname, "render_resume_image.py");
    runPythonJson(scriptPath, [pdfPath, outputPath, String(process.env.INTERVIEW_RESUME_IMAGE_MAX_WIDTH || 1200)]);
  }
  const stat = await fs.stat(outputPath);
  return {
    path: outputPath,
    name: `${safeFilename(resume.name || "候选人")}_简历长截图.png`,
    type: "image/png",
    size: stat.size,
    sourcePdf: pdfPath,
    signature,
  };
}

async function renderInterviewSummaryImage({ session = {}, resume = {}, dataDir }) {
  const evaluation = session.interviewEvaluation || {};
  const signature = hashText(`${session.id}:${evaluation.generatedAt || session.backfilledAt || session.updatedAt || Date.now()}`);
  const dir = assetDir(dataDir);
  const payloadPath = path.join(dir, `${session.id || signature}_summary_${signature}.json`);
  const outputPath = path.join(dir, `${session.id || signature}_summary_${signature}.png`);
  if (!fsSync.existsSync(outputPath)) {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      payloadPath,
      JSON.stringify(
        {
          candidateName: evaluation.candidateName || resume.name || session.matchedResume?.name || "",
          targetRole: evaluation.targetRole || resume.jobType || session.matchedResume?.jobType || "",
          overallRecommendation: evaluation.overallRecommendation || "待复核",
          summary: evaluation.summary || "",
          strengths: safeArray(evaluation.strengths),
          risks: safeArray(evaluation.risks),
          nextAction: evaluation.nextAction || "",
          qaEvidence: safeArray(evaluation.qaEvidence),
          generatedAt: evaluation.generatedAt || session.backfilledAt || "",
        },
        null,
        2
      ),
      "utf8"
    );
    const scriptPath = path.join(__dirname, "render_interview_summary_image.py");
    runPythonJson(scriptPath, [payloadPath, outputPath]);
  }
  const stat = await fs.stat(outputPath);
  return {
    path: outputPath,
    name: `${safeFilename(evaluation.candidateName || resume.name || "候选人")}_面试总结.png`,
    type: "image/png",
    size: stat.size,
    signature,
  };
}

function findExistingBitableRecord(records = [], resume = {}) {
  const phone = normalizeText(resume.phone || "");
  const name = normalizeText(resume.name || "");
  if (phone) {
    const byPhone = records.find((record) => normalizeText(extractFieldText(record.fields?.候选人联系电话)).includes(phone));
    if (byPhone) return { record: byPhone, reason: "phone_match" };
  }
  if (!name) return { record: null, reason: "missing_name" };
  const nameMatches = records.filter((record) => {
    const fields = record.fields || {};
    return [fields.姓名, fields.候选人姓名].some((value) => normalizeText(extractFieldText(value)) === name);
  });
  if (nameMatches.length === 1) return { record: nameMatches[0], reason: "name_match" };
  if (nameMatches.length > 1) return { record: null, reason: "ambiguous_name_match", count: nameMatches.length };
  return { record: null, reason: "not_found" };
}

async function ensureBitableResumeImage({ feishu, store, session, resume, dataDir }) {
  if (!session?.isInterviewLike || !resume?.id) return { skipped: true, reason: "not_calendar_interview" };
  if (!feishu.getStatus().bitableConfigured) return { skipped: true, reason: "missing_bitable_config" };
  if (session.bitableResumeImage?.fileToken && session.bitableRecordId) {
    return { skipped: true, reason: "resume_image_already_synced", recordId: session.bitableRecordId };
  }

  const tableInfo = await feishu.getBitableTableInfo();
  const allow = positionAllowedForTable({ session, resume, tableInfo });
  if (!allow.allowed) return { skipped: true, ...allow };

  const records = await feishu.listBitableRecords();
  const existing = session.bitableRecordId ? { record: await feishu.getBitableRecord(session.bitableRecordId), reason: "session_record" } : findExistingBitableRecord(records, resume);
  if (existing.reason === "ambiguous_name_match") {
    return { skipped: true, reason: "ambiguous_bitable_candidate", count: existing.count };
  }

  const existingRecord = existing.record || null;
  const existingRecordId = recordId(existingRecord);
  const existingResumeTokens = attachmentTokens(existingRecord?.fields?.[RESUME_FIELD]);
  if (existingResumeTokens.length) {
    const synced = {
      skipped: true,
      reason: "bitable_resume_field_already_has_attachment",
      recordId: existingRecordId,
      attachmentCount: existingResumeTokens.length,
      allowed: allow,
    };
    if (existingRecordId && !session.bitableRecordId) {
      store.saveSession({
        ...session,
        bitableRecordId: existingRecordId,
        bitable: { ...(session.bitable || {}), recordId: existingRecordId, resumeImage: synced },
      });
    }
    return synced;
  }

  const image = await renderResumeLongImage({ resume, dataDir });
  const uploaded = await feishu.uploadBitableAttachment({ filePath: image.path, filename: image.name, contentType: image.type });
  const attachmentValue = [{ file_token: uploaded.fileToken }];
  const fields = {
    姓名: resume.name || session.matchedResume?.name || "",
    候选人联系电话: resume.phone || "",
    初次沟通日期: session.startTime ? Number(session.startTime) * 1000 : "",
    [RESUME_FIELD]: attachmentValue,
  };
  const record = existingRecordId ? await feishu.updateBitableRecord(existingRecordId, fields) : await feishu.createBitableRecord(fields);
  const nextRecordId = recordId(record) || existingRecordId;
  const resumeImage = {
    status: "synced",
    field: RESUME_FIELD,
    recordId: nextRecordId,
    fileToken: uploaded.fileToken,
    filename: image.name,
    imagePath: image.path,
    sourcePdf: image.sourcePdf,
    syncedAt: new Date().toISOString(),
    allowed: allow,
  };
  const next = store.saveSession({
    ...session,
    bitableRecordId: nextRecordId,
    bitableResumeImage: resumeImage,
    bitable: { ...(session.bitable || {}), recordId: nextRecordId, resumeImage },
  });
  return { ok: true, session: next, recordId: nextRecordId, resumeImage };
}

async function ensureBitableInterviewRecordImage({ feishu, store, session, resume, dataDir }) {
  if (!session?.isInterviewLike || !resume?.id || !session.interviewEvaluation) return { skipped: true, reason: "missing_interview_evaluation" };
  if (!feishu.getStatus().bitableConfigured) return { skipped: true, reason: "missing_bitable_config" };
  if (session.bitableInterviewRecordImage?.fileToken && session.bitableRecordId) {
    return { skipped: true, reason: "interview_record_image_already_synced", recordId: session.bitableRecordId };
  }

  const tableInfo = await feishu.getBitableTableInfo();
  const allow = positionAllowedForTable({ session, resume, tableInfo });
  if (!allow.allowed) return { skipped: true, ...allow };

  const records = await feishu.listBitableRecords();
  const existing = session.bitableRecordId ? { record: await feishu.getBitableRecord(session.bitableRecordId), reason: "session_record" } : findExistingBitableRecord(records, resume);
  if (existing.reason === "ambiguous_name_match") {
    return { skipped: true, reason: "ambiguous_bitable_candidate", count: existing.count };
  }
  const existingRecord = existing.record || null;
  const existingRecordId = recordId(existingRecord);
  const existingTokens = attachmentTokens(existingRecord?.fields?.[INTERVIEW_RECORD_FIELD]);
  if (existingTokens.length) {
    return { skipped: true, reason: "bitable_interview_record_field_already_has_attachment", recordId: existingRecordId, attachmentCount: existingTokens.length };
  }

  const image = await renderInterviewSummaryImage({ session, resume, dataDir });
  const uploaded = await feishu.uploadBitableAttachment({ filePath: image.path, filename: image.name, contentType: image.type });
  const fields = {
    姓名: resume.name || session.matchedResume?.name || "",
    候选人联系电话: resume.phone || "",
    [INTERVIEW_RECORD_FIELD]: [{ file_token: uploaded.fileToken }],
  };
  const record = existingRecordId ? await feishu.updateBitableRecord(existingRecordId, fields) : await feishu.createBitableRecord(fields);
  const nextRecordId = recordId(record) || existingRecordId;
  const interviewRecordImage = {
    status: "synced",
    field: INTERVIEW_RECORD_FIELD,
    recordId: nextRecordId,
    fileToken: uploaded.fileToken,
    filename: image.name,
    imagePath: image.path,
    syncedAt: new Date().toISOString(),
    allowed: allow,
  };
  const next = store.saveSession({
    ...session,
    bitableRecordId: nextRecordId,
    bitableInterviewRecordImage: interviewRecordImage,
    bitable: { ...(session.bitable || {}), recordId: nextRecordId, interviewRecordImage },
  });
  return { ok: true, session: next, recordId: nextRecordId, interviewRecordImage };
}

async function ensureBitableSkillEvaluationDocument({ feishu, store, session, resume, createDocument, fieldText = "" }) {
  if (!session?.isInterviewLike || !resume?.id || !session.interviewEvaluation) return { skipped: true, reason: "missing_interview_evaluation" };
  if (!feishu.getStatus().bitableConfigured) return { skipped: true, reason: "missing_bitable_config" };
  if (session.bitableSkillEvaluationDocument?.documentId && session.bitableRecordId) {
    return { skipped: true, reason: "skill_evaluation_document_already_synced", recordId: session.bitableRecordId };
  }

  const fieldMap = await feishu.getBitableFields();
  const skillField = fieldMap.byName?.get(SKILL_EVALUATION_FIELD);
  if (!skillField) return { skipped: true, reason: "skill_evaluation_field_missing", field: SKILL_EVALUATION_FIELD };

  const tableInfo = await feishu.getBitableTableInfo();
  const allow = positionAllowedForTable({ session, resume, tableInfo });
  if (!allow.allowed) return { skipped: true, ...allow };

  const records = await feishu.listBitableRecords();
  const existing = session.bitableRecordId ? { record: await feishu.getBitableRecord(session.bitableRecordId), reason: "session_record" } : findExistingBitableRecord(records, resume);
  if (existing.reason === "ambiguous_name_match") {
    return { skipped: true, reason: "ambiguous_bitable_candidate", count: existing.count };
  }
  const existingRecord = existing.record || null;
  const existingRecordId = recordId(existingRecord);
  const existingSkillText = compactText(extractFieldText(existingRecord?.fields?.[SKILL_EVALUATION_FIELD] || ""));
  if (hasDocxLink(existingSkillText)) {
    return {
      skipped: true,
      reason: "bitable_skill_evaluation_field_already_has_docx_link",
      recordId: existingRecordId,
      field: SKILL_EVALUATION_FIELD,
    };
  }

  const doc =
    session.bitableSkillEvaluationDocument?.documentId && session.bitableSkillEvaluationDocument?.url
      ? session.bitableSkillEvaluationDocument
      : await createDocument();
  const attempts = [];
  let record = null;
  let lastError = null;
  const preservedManualText = existingSkillText || compactText(fieldText);
  for (const value of documentFieldValueCandidates(skillField, doc, preservedManualText)) {
    try {
      const fields = {
        姓名: resume.name || session.matchedResume?.name || "",
        候选人联系电话: resume.phone || "",
        [SKILL_EVALUATION_FIELD]: value,
      };
      record = existingRecordId ? await feishu.updateBitableRecord(existingRecordId, fields) : await feishu.createBitableRecord(fields);
      attempts.push({ ok: true, valueKind: Array.isArray(value) ? "attachment" : typeof value });
      break;
    } catch (error) {
      lastError = error;
      attempts.push({
        ok: false,
        valueKind: Array.isArray(value) ? "attachment" : typeof value,
        error: error.message || "写入技能评价字段失败",
        payload: error.payload || null,
      });
    }
  }
  if (!record) {
    const error = new Error(lastError?.message || "写入技能评价字段失败");
    error.payload = { attempts };
    throw error;
  }

  const nextRecordId = recordId(record) || existingRecordId;
  const skillEvaluationDocument = {
    status: "synced",
    field: SKILL_EVALUATION_FIELD,
    recordId: nextRecordId,
    documentId: doc.documentId,
    url: doc.url,
    title: doc.title,
    contentSynced: doc.contentSynced !== false,
    contentError: doc.contentError || "",
    syncedAt: new Date().toISOString(),
    attempts,
    allowed: allow,
  };
  const next = store.saveSession({
    ...session,
    bitableRecordId: nextRecordId,
    bitableSkillEvaluationDocument: skillEvaluationDocument,
    bitable: { ...(session.bitable || {}), recordId: nextRecordId, skillEvaluationDocument },
  });
  return { ok: true, session: next, recordId: nextRecordId, skillEvaluationDocument };
}

module.exports = {
  ensureBitableResumeImage,
  ensureBitableInterviewRecordImage,
  ensureBitableSkillEvaluationDocument,
  positionAllowedForTable,
};
