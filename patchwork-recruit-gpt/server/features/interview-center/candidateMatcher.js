const { clipText, compactText, normalizeText, safeArray, uniqStrings } = require("./utils");

function getResumeSearchTerms(resume = {}) {
  const contact = resume.platformContact && typeof resume.platformContact === "object" ? resume.platformContact : {};
  return uniqStrings(
    [
      resume.name,
      contact.displayName,
      contact.label,
      resume.phone,
      resume.fileName,
      resume.jobType,
      resume.sourcePlatform,
      resume.platform,
      resume.accountName,
      resume.sourceLabel,
    ],
    20
  );
}

function scoreTermHit(eventText, rawText, term, exactScore, fuzzyScore) {
  const normalized = normalizeText(term);
  if (!normalized || normalized.length < 2) return 0;
  if (eventText.includes(normalized)) return exactScore;
  const compact = compactText(term);
  if (compact && rawText.includes(compact)) return fuzzyScore;
  return 0;
}

function scoreEventResumeMatch(event = {}, resume = {}) {
  const rawText = compactText([event.title, event.description, event.location, event.attendees?.join(" "), event.meetingUrl].join(" "));
  const eventText = normalizeText(rawText);
  const reasons = [];
  let score = 0;

  const nameScore = scoreTermHit(eventText, rawText, resume.name, 70, 58);
  if (nameScore) {
    score += nameScore;
    reasons.push("日程命中简历姓名");
  }

  const contact = resume.platformContact && typeof resume.platformContact === "object" ? resume.platformContact : {};
  const displayNameScore = scoreTermHit(eventText, rawText, contact.displayName, 55, 45);
  if (displayNameScore && contact.displayName !== resume.name) {
    score += displayNameScore;
    reasons.push("日程命中平台联系人名");
  }

  const phoneScore = scoreTermHit(eventText, rawText, resume.phone, 45, 40);
  if (phoneScore) {
    score += phoneScore;
    reasons.push("日程命中手机号");
  }

  const jobScore = scoreTermHit(eventText, rawText, resume.jobType, 24, 16);
  if (jobScore) {
    score += jobScore;
    reasons.push("日程命中岗位");
  }

  for (const term of [resume.sourcePlatform, resume.platform, resume.accountName, resume.sourceLabel]) {
    const sourceScore = scoreTermHit(eventText, rawText, term, 8, 5);
    if (sourceScore) {
      score += sourceScore;
      reasons.push(`来源线索：${term}`);
      break;
    }
  }

  if (resume.interviewInvite?.status === "sent") {
    score += 8;
    reasons.push("候选人已有约面试记录");
  }

  const updatedAt = Date.parse(resume.updatedAt || resume.createdAt || "");
  const eventStartMs = Number(event.startTime || 0) * 1000;
  if (updatedAt && eventStartMs && Math.abs(eventStartMs - updatedAt) < 21 * 24 * 3600 * 1000) {
    score += 6;
    reasons.push("候选人近期入库");
  }

  return {
    score,
    reasons,
  };
}

function findExactIdentityMatches(event = {}, resumes = []) {
  const eventText = normalizeText([event.title, event.description, event.location, event.attendees?.join(" ")].join(" "));
  if (!eventText) return new Map();

  const hits = new Map();
  for (const resume of safeArray(resumes)) {
    if (!resume?.id) continue;
    const contact = resume.platformContact && typeof resume.platformContact === "object" ? resume.platformContact : {};
    const terms = uniqStrings([resume.name, contact.displayName], 6)
      .map((term) => ({ raw: term, normalized: normalizeText(term) }))
      .filter((term) => term.normalized.length >= 2);

    const matchedTerms = terms.filter((term) => eventText.includes(term.normalized));
    if (!matchedTerms.length) continue;
    hits.set(resume.id, matchedTerms.map((term) => term.raw));
  }
  return hits;
}

function findCandidateMatches(event = {}, resumes = [], { limit = 8 } = {}) {
  const exactHits = findExactIdentityMatches(event, resumes);
  return safeArray(resumes)
    .map((resume) => {
      const match = scoreEventResumeMatch(event, resume);
      const exactTerms = exactHits.get(resume.id) || [];
      return {
        resume,
        score: Math.round(match.score + (exactTerms.length ? 20 : 0)),
        reasons: exactTerms.length ? ["日程精确命中候选人姓名", ...match.reasons] : match.reasons,
        searchTerms: getResumeSearchTerms(resume),
        exactIdentityMatch: exactTerms.length > 0,
        exactIdentityTerms: exactTerms,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(right.resume.updatedAt || "").localeCompare(String(left.resume.updatedAt || "")))
    .slice(0, limit)
    .map((item) => ({
      resumeId: item.resume.id,
      name: item.resume.name || "",
      jobType: item.resume.jobType || "",
      source: [item.resume.sourcePlatform || item.resume.platform || item.resume.source || "", item.resume.accountName || ""]
        .filter(Boolean)
        .join(" / "),
      score: item.score,
      reasons: item.reasons,
      exactIdentityMatch: item.exactIdentityMatch,
      exactIdentityTerms: item.exactIdentityTerms,
      platformContact: item.resume.platformContact
        ? {
            displayName: item.resume.platformContact.displayName || "",
            appliedPosition: item.resume.platformContact.appliedPosition || "",
          }
        : null,
    }));
}

function decideAutoBinding(matches = [], { minScore = 85, leadScore = 15 } = {}) {
  const best = matches[0] || null;
  const second = matches[1] || null;
  if (!best) {
    return {
      bind: false,
      reason: "no_match",
      status: "needs_match",
      message: "未匹配到候选人",
    };
  }
  const exactMatches = matches.filter((item) => item.exactIdentityMatch);
  if (exactMatches.length === 1) {
    const exact = exactMatches[0];
    const closestOther = matches.find((item) => item.resumeId !== exact.resumeId) || null;
    return {
      bind: true,
      reason: "unique_exact_identity",
      status: "matched",
      message: "已按唯一姓名命中自动绑定",
      match: exact,
      lead: exact.score - (closestOther?.score || 0),
    };
  }
  if (exactMatches.length > 1) {
    return {
      bind: false,
      reason: "duplicate_exact_identity",
      status: "needs_confirmation",
      message: `命中 ${exactMatches.length} 个同名候选人，需要人工确认`,
      match: exactMatches[0],
      lead: exactMatches[0].score - (exactMatches[1]?.score || 0),
    };
  }
  const lead = best.score - (second?.score || 0);
  if (best.score >= minScore && lead >= leadScore) {
    return {
      bind: true,
      reason: "high_confidence",
      status: "matched",
      message: "已按高置信匹配自动绑定",
      match: best,
      lead,
    };
  }
  return {
    bind: false,
    reason: "low_confidence",
    status: "needs_confirmation",
    message: `匹配分 ${best.score}，领先 ${lead}，需要人工确认`,
    match: best,
    lead,
  };
}

function enrichSessionWithMatches(session, resumes, options = {}) {
  if (!session?.isInterviewLike) {
    return {
      ...session,
      status: session.status === "non_interview" ? "non_interview" : "ignored",
      match: null,
      matchCandidates: [],
    };
  }

  if (session.matchMode === "manual" && session.resumeId) {
    return session;
  }

  const matches = findCandidateMatches(session, resumes, { limit: 8 });
  const decision = decideAutoBinding(matches, options);
  if (decision.bind) {
    return {
      ...session,
      status: session.questionSet ? session.status : "matched",
      resumeId: decision.match.resumeId,
      matchMode: "auto",
      match: {
        score: decision.match.score,
        reasons: decision.match.reasons,
        lead: decision.lead,
      },
      matchCandidates: matches,
      matchedResume: {
        id: decision.match.resumeId,
        name: decision.match.name,
        jobType: decision.match.jobType,
        source: decision.match.source,
      },
    };
  }
  return {
    ...session,
    status: session.resumeId ? session.status : decision.status,
    matchMode: session.resumeId ? session.matchMode || "manual" : "",
    match: decision.match
      ? {
          score: decision.match.score,
          reasons: decision.match.reasons,
          lead: decision.lead,
        }
      : null,
    matchCandidates: matches,
    matchMessage: clipText(decision.message, 200),
  };
}

module.exports = {
  scoreEventResumeMatch,
  findExactIdentityMatches,
  findCandidateMatches,
  decideAutoBinding,
  enrichSessionWithMatches,
};
