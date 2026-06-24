        "screeningStatus": safe_text(str(item.get("screeningStatus") or ""), 40),
        "message": safe_text(str(item.get("message") or ""), 260),
    }
    for key in (
        "conversationKey",
        "candidateIdentityKey",
        "candidateName",
        "appliedPosition",
        "question",
        "answer",
        "lastOther",
        "resumeFilePath",
        "resumeFilename",
        "filePath",
        "filename",
        "reason",
        "detailUrl",
        "candidateDetailUrl",
        "candidateResumeNumber",
        "proactiveCandidateKey",
        "preview",
        "detailPreview",
        "cardToken",
        "detailCandidateName",
    ):
        if item.get(key):
            limit = 500 if key == "lastOther" else 260
            if key in {"preview", "detailPreview"}:
                limit = 900
            compact[key] = safe_text(str(item.get(key) or ""), limit)
    if item.get("pageTextPreview"):
        compact["pageTextPreview"] = safe_text(str(item.get("pageTextPreview") or ""), 900)
    if isinstance(item.get("identityWarnings"), list):
        compact["identityWarnings"] = item.get("identityWarnings")[:8]
    if isinstance(item.get("messages"), list):
        compact["messages"] = [
            {
                "sender": safe_text(str(message.get("sender") or ""), 20),
                "time": safe_text(str(message.get("time") or ""), 40),
                "status": safe_text(str(message.get("status") or ""), 40),
                "text": safe_text(str(message.get("text") or message.get("rawText") or ""), 500),
                "rawText": safe_text(str(message.get("rawText") or message.get("text") or ""), 600),
            }
            for message in item.get("messages")[-20:]
            if isinstance(message, dict) and str(message.get("text") or message.get("rawText") or "").strip()
        ]
    if isinstance(item.get("candidateIdentity"), dict):
        compact["candidateIdentity"] = {
            name: safe_text(str(item["candidateIdentity"].get(name) or ""), 180)
            for name in ("identityKey", "conversationKey", "candidateName", "appliedPosition", "listLabel")
            if item["candidateIdentity"].get(name)
        }
    if isinstance(item.get("replyTarget"), dict):
        compact["replyTarget"] = {
            name: safe_text(str(item["replyTarget"].get(name) or ""), 180)
            for name in ("candidateName", "candidateIdentityKey", "conversationKey", "labelHint")
            if item["replyTarget"].get(name)
        }
    if item.get("unreadCount") is not None:
        compact["unreadCount"] = item.get("unreadCount")
    if knowledge_answer:
        compact["knowledgeAnswer"] = {
            "answer": safe_text(str(knowledge_answer.get("answer") or ""), 120),
            "basis": knowledge_answer.get("basis") if isinstance(knowledge_answer.get("basis"), dict) else {},
        }
    if isinstance(item.get("resume"), dict):
        compact["resume"] = item.get("resume")
    if isinstance(item.get("watch"), dict):
        compact["watch"] = item.get("watch")
    if isinstance(item.get("viewedBadges"), list):
        compact["viewedBadges"] = item.get("viewedBadges")[:6]
    if isinstance(item.get("commonGate"), dict):
        compact["commonGate"] = item.get("commonGate")
    if isinstance(item.get("screening"), dict):
        compact["screening"] = item.get("screening")
    if isinstance(item.get("cleanup"), dict):
        compact["cleanup"] = item.get("cleanup")
    return compact


def append_recruiter_batch_report(report: dict) -> dict:
    if not isinstance(report, dict):
        return {}
    existing = load_json(RECRUITER_BATCH_REPORTS_FILE, [])
    if not isinstance(existing, list):
        existing = []
    created_at = time.strftime("%Y-%m-%d %H:%M:%S")
    run_id = str(report.get("runId") or ("batch_" + stable_digest(created_at + json.dumps(report.get("state", {}), ensure_ascii=False), 16)))
    item = dict(report)
    item["runId"] = run_id
    item.setdefault("createdAt", created_at)
    item.setdefault("updatedAt", created_at)
    if isinstance(item.get("results"), list):
        item["results"] = [compact_recruiter_batch_result(result) for result in item["results"][:200] if isinstance(result, dict)]
    if isinstance(item.get("followups"), list):
        item["followups"] = [compact_recruiter_batch_result(result) for result in item["followups"][:200] if isinstance(result, dict)]
    existing.append(item)
    save_json(RECRUITER_BATCH_REPORTS_FILE, existing[-5000:])
    return item


def compact_process_messages_response(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return payload
    compact = {
        "message": safe_text(str(payload.get("message") or payload.get("reply") or ""), 1200),
    }
    for key in ("counts", "state", "batchReportId", "unreadFilter", "timings", "passes"):
        if key in payload:
            compact[key] = payload.get(key)
    if isinstance(payload.get("filteredOut"), list):
        compact["filteredOut"] = [
            compact_recruiter_batch_result(item)
            for item in payload.get("filteredOut")[:30]
            if isinstance(item, dict)
        ]
    if isinstance(payload.get("unclearQuestions"), list):
        compact["unclearQuestions"] = [
            compact_recruiter_batch_result(item)
            for item in payload.get("unclearQuestions")[:30]
            if isinstance(item, dict)
        ]
    if isinstance(payload.get("results"), list):
        compact["results"] = [
            compact_recruiter_batch_result(item)
            for item in payload.get("results")[:80]
            if isinstance(item, dict)
        ]
        compact["resultCount"] = len(payload.get("results"))
    return compact


def scoped_json_siblings(path: Path) -> list[Path]:
    if not isinstance(path, Path):
        path = Path(path)
    base_stem = str(path.stem).split(".", 1)[0]
    try:
        candidates = sorted(path.parent.glob(f"{base_stem}*{path.suffix}"))
    except Exception:
        return [path]
    out: list[Path] = []
    for candidate in candidates:
        if candidate.stem == base_stem or candidate.stem.startswith(f"{base_stem}."):
            out.append(candidate)
    return out or [path]


def load_scoped_json_records(path: Path, *, include_all_scopes: bool = False) -> list[dict]:
    files = scoped_json_siblings(path) if include_all_scopes else [path]
    records: list[dict] = []
    seen: set[str] = set()
    for file_path in files:
        data = load_json(file_path, [])
        if not isinstance(data, list):
            continue
        for index, item in enumerate(data):
            if not isinstance(item, dict):
                continue
            key = str(item.get("runId") or item.get("id") or "")
            if not key:
                key = f"{file_path.name}:{index}:{item.get('createdAt') or item.get('time') or ''}"
            if key in seen:
                continue
            seen.add(key)
            record = dict(item)
            record["_scopeFile"] = file_path.name
            records.append(record)
    return records


def normalize_recruiter_platform(value: str) -> str:
    text = str(value or "").strip().lower()
    if text in {"51", "51job", "job51", "51平台", "前程无忧"}:
        return "51job"
    if text in {"zhilian", "zhaopin", "智联", "智联招聘"}:
        return "zhilian"
    return "boss"


def recruiter_summary_include_all_scopes(platform: str) -> bool:
    selected = normalize_recruiter_platform(platform)
    account_id = str(AGENT_ACCOUNT_ID or "").strip().lower()
    if selected == "51job" and account_id.startswith("job51_"):
        return False
    if selected == "zhilian" and account_id.startswith("zhilian_"):
        return False
    return selected in {"51job", "zhilian"}


def recruiter_scope_platform(item: dict) -> str:
    scope = str((item or {}).get("_scopeFile") or "").strip().lower()
    if "51job" in scope or "job51" in scope:
        return "51job"
    if "zhilian" in scope or "zhaopin" in scope:
        return "zhilian"
    if "boss" in scope:
        return "boss"
    return ""


def infer_recruiter_report_platform(report: dict) -> str:
    if not isinstance(report, dict):
        return "boss"
    state = report.get("state") if isinstance(report.get("state"), dict) else {}
    platform = str(state.get("platform") or report.get("platform") or "").strip()
    if platform:
        return normalize_recruiter_platform(platform)
    report_type = str(report.get("type") or "")
    if report_type.startswith("job51_") or "51job" in report_type.lower():
        return "51job"
    if report_type.startswith("zhilian_") or "zhilian" in report_type.lower():
        return "zhilian"
    scoped = recruiter_scope_platform(report)
    if scoped:
        return scoped
    return "boss"


def infer_recruiter_event_platform(event: dict) -> str:
    if not isinstance(event, dict):
        return "boss"
    extra = event.get("extra") if isinstance(event.get("extra"), dict) else {}
    platform = str(extra.get("platform") or event.get("platform") or "").strip()
    if platform:
        return normalize_recruiter_platform(platform)
    text = str(event.get("text") or "")
    if "51job" in text or "51 平台" in text or "51平台" in text or "前程无忧" in text:
        return "51job"
    if "zhilian" in text.lower() or "zhaopin" in text.lower() or "智联" in text:
        return "zhilian"
    scoped = recruiter_scope_platform(event)
    if scoped:
        return scoped
    return "boss"


def infer_recruiter_decision_platform(item: dict) -> str:
    if not isinstance(item, dict):
        return "boss"
    platform = str(item.get("platform") or "").strip()
    if platform:
        return normalize_recruiter_platform(platform)
    scoped = recruiter_scope_platform(item)
    if scoped:
        return scoped
    workflow = str(item.get("workflow") or "").lower()
    if "zhilian" in workflow or "zhaopin" in workflow:
        return "zhilian"
    if "51job" in workflow or "job51" in workflow:
        return "51job"
    return "boss"


def recruiter_result_identity_key(result: dict) -> str:
    if not isinstance(result, dict):
        return ""
    identity = result.get("candidateIdentity") if isinstance(result.get("candidateIdentity"), dict) else {}
    for key in (
        result.get("candidateIdentityKey"),
        identity.get("identityKey"),
        result.get("conversationKey"),
    ):
        text = str(key or "").strip()
        if text:
            return text
    name = str(result.get("candidateName") or "").strip()
    position = str(result.get("appliedPosition") or "").strip()
    label = str(result.get("label") or "").strip()
    raw = "|".join(part for part in (name, position, compact_conversation_label(label)) if part)
    return stable_digest(raw, 24) if raw else ""


def summarize_recruiter_decisions(items: list[dict]) -> dict:
    totals = {"decisions": 0, "uniqueCandidates": 0}
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        totals["decisions"] += 1
        key = str(item.get("conversationKey") or "").strip()
        if not key:
            raw = "|".join(
                str(item.get(name) or "").strip()
                for name in ("candidateName", "appliedPosition", "candidateLabel")
                if str(item.get(name) or "").strip()
            )
            key = stable_digest(raw, 24) if raw else ""
        if key:
            seen.add(key)
    totals["uniqueCandidates"] = len(seen)
    return totals


def recruiter_decision_identity_key(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    key = str(item.get("conversationKey") or "").strip()
    if key:
        return key
    raw = "|".join(
        str(item.get(name) or "").strip()
        for name in ("candidateName", "appliedPosition", "candidateLabel")
        if str(item.get(name) or "").strip()
    )
    return stable_digest(raw, 24) if raw else ""


def summarize_recruiter_decision_actions(items: list[dict]) -> dict:
    requested: set[str] = set()
    already_requested: set[str] = set()
    downloaded: set[str] = set()
    asked: set[str] = set()
    knowledge_answered: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "").strip().lower()
        if not status:
            continue
        key = recruiter_decision_identity_key(item)
        if not key:
            key = stable_digest(json.dumps(item, ensure_ascii=False, sort_keys=True), 24)
        if "resume_already_requested" in status:
            already_requested.add(key)
        elif "resume_requested" in status:
            requested.add(key)
        if "resume_downloaded" in status:
            downloaded.add(key)
        if status in {"basic_conditions_sent_waiting", "position_screening_sent_waiting"} or status.endswith("_sent_waiting"):
            asked.add(key)
        if status.startswith("knowledge_answered"):
            knowledge_answered.add(key)
    return {
        "requestedResume": len(requested),
        "alreadyRequestedResume": len(already_requested),
        "downloadedResume": len(downloaded),
        "askedQuestions": len(asked),
        "knowledgeAnswered": len(knowledge_answered),
    }


def infer_recruiter_download_platform(item: dict, scope_file: str = "") -> str:
    if not isinstance(item, dict):
        return ""
    scoped = recruiter_scope_platform({"_scopeFile": scope_file})
    if scoped:
        return scoped
    platform = str(item.get("platform") or "").strip()
    if platform:
        return normalize_recruiter_platform(platform)
    file_path = str(item.get("filePath") or item.get("path") or "")
    filename = str(item.get("filename") or item.get("name") or "")
    haystack = f"{file_path} {filename}".lower()
    if "zhilian" in haystack or "zhaopin" in haystack:
        return "zhilian"
    if "51job" in haystack or "job51" in haystack:
        return "51job"
    return "boss"


def recruiter_download_time(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    return str(item.get("downloadedAt") or item.get("time") or item.get("createdAt") or item.get("updatedAt") or "").strip()


def recruiter_download_unique_key(item: dict) -> str:
    if not isinstance(item, dict):
        return ""
    for name in ("fileHash", "sourceHash"):
        text = str(item.get(name) or "").strip()
        if text:
            return text
    for name in ("filePath", "path"):
        text = str(item.get(name) or "").strip()
        if text:
            return str(Path(text))
    raw = "|".join(
        str(item.get(name) or "").strip()
        for name in ("candidateName", "appliedPosition", "filename", "name")
        if str(item.get(name) or "").strip()
    )
    return stable_digest(raw, 24) if raw else ""


def summarize_recruiter_resume_download_records(platform: str, date_prefix: str = "") -> dict:
    selected = normalize_recruiter_platform(platform)
    include_all_scopes = recruiter_summary_include_all_scopes(selected)
    files = (
        (scoped_json_siblings(JOB51_RESUME_DOWNLOADS_FILE) if include_all_scopes else [JOB51_RESUME_DOWNLOADS_FILE])
        + (scoped_json_siblings(RECRUITER_RESUME_DOWNLOADS_FILE) if include_all_scopes else [RECRUITER_RESUME_DOWNLOADS_FILE])
    )
    seen_files: set[str] = set()
    seen_items: set[str] = set()
    for file_path in files:
        file_name = str(file_path.name)
        if file_name in seen_files:
            continue
        seen_files.add(file_name)
        data = load_json(file_path, {})
        if isinstance(data, dict):
            rows = list(data.values())
        elif isinstance(data, list):
            rows = data
        else:
            rows = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            if infer_recruiter_download_platform(item, file_name) != selected:
                continue
            if date_prefix and not recruiter_download_time(item).startswith(date_prefix):
                continue
            key = recruiter_download_unique_key(item)
            if key:
                seen_items.add(key)
    return {"downloadedResume": len(seen_items)}


def infer_recruiter_question_platform(item: dict) -> str:
    scoped = recruiter_scope_platform(item)
    if scoped:
        return scoped
    identity = item.get("candidateIdentity") if isinstance(item.get("candidateIdentity"), dict) else {}
    platform = str(item.get("platform") or identity.get("platform") or "").strip()
    return normalize_recruiter_platform(platform) if platform else "boss"


def summarize_recruiter_question_records(platform: str, date_prefix: str = "") -> dict:
    selected = normalize_recruiter_platform(platform)
    records = load_scoped_json_records(USER_QUESTIONS_FILE, include_all_scopes=recruiter_summary_include_all_scopes(selected))
    seen: set[str] = set()
    for item in records:
        if not isinstance(item, dict):
            continue
        if infer_recruiter_question_platform(item) != selected:
            continue
        item_time = str(item.get("time") or item.get("capturedAt") or item.get("createdAt") or "").strip()
        if date_prefix and not item_time.startswith(date_prefix):
            continue
        key = str(item.get("fingerprint") or item.get("id") or "").strip()
        if not key:
            key = stable_digest(
                "|".join(str(item.get(name) or "").strip() for name in ("conversationKey", "candidateName", "question")),
                24,
            )
        if key:
            seen.add(key)
    return {"candidateQuestions": len(seen)}


def summarize_recruiter_counts(reports: list[dict]) -> dict:
    totals: dict[str, int] = {
        "runs": len(reports),
        "processedPeople": 0,
        "processedRecords": 0,
        "uniqueCandidates": 0,
        "requestedResume": 0,
        "alreadyRequestedResume": 0,
        "downloadedResume": 0,
        "knowledgeAnswered": 0,
        "askedQuestions": 0,
        "candidateQuestions": 0,
        "sentBasic": 0,
        "rejected": 0,
        "blocked": 0,
        "proactiveOpened": 0,
        "greeted": 0,
        "skipped": 0,
    }
    action_counts: dict[str, int] = {}
    unique_candidates: set[str] = set()
    def count_value(value) -> int:
        try:
            return int(value or 0)
        except Exception:
            return 0

    for report in reports:
        if not isinstance(report, dict):
            continue
        state = report.get("state") if isinstance(report.get("state"), dict) else {}
        counts = state.get("counts") if isinstance(state.get("counts"), dict) else report.get("counts")
        if not isinstance(counts, dict):
            counts = {}
        processed = count_value(state.get("processedPeople") or state.get("processedInitial") or state.get("processed"))
        totals["processedPeople"] += processed
        totals["processedRecords"] += processed
        results = report.get("results") if isinstance(report.get("results"), list) else []
        for result in results:
            candidate_key = recruiter_result_identity_key(result)
            if candidate_key:
                unique_candidates.add(candidate_key)
        for key in ("requestedResume", "alreadyRequestedResume", "downloadedResume", "knowledgeAnswered", "sentBasic", "rejected", "blocked"):
            totals[key] += count_value(state.get(key))
        for key, value in counts.items():
            amount = count_value(value)
            action_counts[str(key)] = action_counts.get(str(key), 0) + amount
        asked_questions = count_value(state.get("askedQuestions"))
        if not asked_questions:
            state_sent_basic = count_value(state.get("sentBasic"))
            if state_sent_basic:
                asked_questions = state_sent_basic + count_value(counts.get("sent_position_screening"))
            else:
                asked_questions = (
                    count_value(counts.get("sent_basic_conditions"))
                    + count_value(counts.get("sent_position_screening"))
                    + count_value(counts.get("knowledge_answered_and_sent_screening"))
                )
        totals["askedQuestions"] += asked_questions
        if not count_value(state.get("requestedResume")):
            totals["requestedResume"] += count_value(counts.get("accepted_requested_resume")) + count_value(counts.get("knowledge_answered_and_requested_resume"))
        if not count_value(state.get("alreadyRequestedResume")):
            totals["alreadyRequestedResume"] += count_value(counts.get("accepted_resume_already_requested")) + count_value(counts.get("knowledge_answered_resume_already_requested"))
        if not count_value(state.get("downloadedResume")):
            totals["downloadedResume"] += count_value(counts.get("accepted_resume_downloaded")) + count_value(counts.get("knowledge_answered_resume_downloaded"))
        if not count_value(state.get("knowledgeAnswered")):
            totals["knowledgeAnswered"] += (
                count_value(counts.get("knowledge_answered"))
                + count_value(counts.get("knowledge_answered_and_sent_screening"))
                + count_value(counts.get("knowledge_answered_and_requested_resume"))
                + count_value(counts.get("knowledge_answered_resume_already_requested"))
                + count_value(counts.get("knowledge_answered_resume_downloaded"))
            )
        if not count_value(state.get("sentBasic")):
            totals["sentBasic"] += count_value(counts.get("sent_basic_conditions")) + count_value(counts.get("knowledge_answered_and_sent_screening"))
        if not count_value(state.get("rejected")):
            totals["rejected"] += count_value(counts.get("rejected_skipped"))
        if not count_value(state.get("blocked")):
            totals["blocked"] += count_value(counts.get("blocked"))
        totals["proactiveOpened"] += count_value(counts.get("opened") or counts.get("openedCandidates") or counts.get("proactiveOpened"))
        totals["greeted"] += count_value(counts.get("greeted") or counts.get("proactive_greeted"))
        totals["skipped"] += count_value(state.get("filteredOut") or counts.get("skipped") or counts.get("filtered"))
    totals["actionCounts"] = action_counts
    totals["uniqueCandidates"] = len(unique_candidates)
    return totals


def apply_recruiter_summary_supplements(summary: dict, *, decision_actions: dict, download_stats: dict, question_stats: dict) -> dict:
    if not isinstance(summary, dict):
        summary = {}
    for key in ("requestedResume", "alreadyRequestedResume", "askedQuestions", "knowledgeAnswered"):
        try:
            current = int(summary.get(key) or 0)
        except Exception:
            current = 0
        try:
            supplement = int((decision_actions or {}).get(key) or 0)
        except Exception:
            supplement = 0
        if supplement > current:
            summary[key] = supplement
    try:
        downloaded = int((download_stats or {}).get("downloadedResume") or 0)
    except Exception:
        downloaded = 0
    if downloaded > 0:
        summary["downloadedResume"] = max(int(summary.get("downloadedResume") or 0), downloaded)
    else:
        try:
            decision_downloaded = int((decision_actions or {}).get("downloadedResume") or 0)
        except Exception:
            decision_downloaded = 0
        if decision_downloaded > int(summary.get("downloadedResume") or 0):
            summary["downloadedResume"] = decision_downloaded
    try:
        candidate_questions = int((question_stats or {}).get("candidateQuestions") or 0)
    except Exception:
        candidate_questions = 0
    summary["candidateQuestions"] = max(int(summary.get("candidateQuestions") or 0), candidate_questions)
    return summary


def load_recruiter_resume_index() -> dict:
    index = {"byConversation": {}, "byCandidate": {}}
    resume_files = scoped_json_siblings(JOB51_RESUME_DOWNLOADS_FILE) + scoped_json_siblings(RECRUITER_RESUME_DOWNLOADS_FILE)
    for file_path in resume_files:
        data = load_json(file_path, {})
        if not isinstance(data, dict):
            continue
        for item in data.values():
            if not isinstance(item, dict):
                continue
            file_path_text = str(item.get("filePath") or "")
            if not file_path_text:
                continue
            payload = {
                "platform": safe_text(str(item.get("platform") or "51job"), 30),
                "filename": safe_text(str(item.get("filename") or Path(file_path_text).name), 160),
                "filePath": safe_text(file_path_text, 260),
                "downloadedAt": safe_text(str(item.get("downloadedAt") or ""), 30),
            }
            conversation_key = str(item.get("conversationKey") or "").strip()
            if conversation_key:
                index["byConversation"][conversation_key] = payload
            candidate_raw = "|".join(
                str(item.get(name) or "").strip()
                for name in ("candidateName", "appliedPosition")
                if str(item.get(name) or "").strip()
            )
            candidate_key = stable_digest(candidate_raw, 24) if candidate_raw else ""
            if candidate_key:
                index["byCandidate"][candidate_key] = payload
    return index


def attach_recruiter_resume_info(result: dict, resume_index: dict | None = None) -> dict:
    if not isinstance(result, dict):
        return {}
    resume_index = resume_index if isinstance(resume_index, dict) else {}
    file_path = str(result.get("resumeFilePath") or result.get("filePath") or "")
    filename = str(result.get("resumeFilename") or result.get("filename") or "")
    if file_path or filename:
        return {
            "filename": safe_text(filename or Path(file_path).name, 160),
            "filePath": safe_text(file_path, 260),
        }
    conversation_key = str(result.get("conversationKey") or "").strip()
    by_conversation = resume_index.get("byConversation") if isinstance(resume_index.get("byConversation"), dict) else {}
    if conversation_key and isinstance(by_conversation.get(conversation_key), dict):
        return by_conversation[conversation_key]
    candidate_raw = "|".join(
        str(result.get(name) or "").strip()
        for name in ("candidateName", "appliedPosition")
        if str(result.get(name) or "").strip()
    )
    candidate_key = stable_digest(candidate_raw, 24) if candidate_raw else ""
    by_candidate = resume_index.get("byCandidate") if isinstance(resume_index.get("byCandidate"), dict) else {}
    if candidate_key and isinstance(by_candidate.get(candidate_key), dict):
        return by_candidate[candidate_key]
    return {}


def compact_recruiter_report_for_dashboard(report: dict) -> dict:
    state = report.get("state") if isinstance(report.get("state"), dict) else {}
    results = report.get("results") if isinstance(report.get("results"), list) else []
    resume_index = load_recruiter_resume_index()
    compact_results: list[dict] = []
    for result in results[:200]:
        if not isinstance(result, dict):
            continue
        compact = compact_recruiter_batch_result(result)
        for key in ("lastOther", "pageTextPreview"):
            if result.get(key):
                compact[key] = safe_text(str(result.get(key) or ""), 500 if key == "lastOther" else 900)
        messages = result.get("messages") if isinstance(result.get("messages"), list) else []
        if messages:
            compact["messages"] = [
                {
                    "sender": safe_text(str(message.get("sender") or ""), 20),
                    "time": safe_text(str(message.get("time") or ""), 40),
                    "status": safe_text(str(message.get("status") or ""), 40),
                    "text": safe_text(str(message.get("text") or message.get("rawText") or ""), 300),
                }
                for message in messages[-10:]
                if isinstance(message, dict) and str(message.get("text") or message.get("rawText") or "").strip()
            ]
        resume = attach_recruiter_resume_info(result, resume_index)
        if resume:
            compact["resume"] = resume
        compact_results.append(compact)
    return {
        "runId": safe_text(str(report.get("runId") or ""), 80),
        "type": safe_text(str(report.get("type") or ""), 80),
        "createdAt": safe_text(str(report.get("createdAt") or ""), 32),
        "message": safe_text(str(report.get("message") or ""), 360),
        "state": state,
        "results": compact_results,
    }


def load_recruiter_automation_summary(platform: str = "boss") -> dict:
    selected = normalize_recruiter_platform(platform)
    today = time.strftime("%Y-%m-%d")
    include_all_scopes = recruiter_summary_include_all_scopes(selected)
    reports = load_scoped_json_records(RECRUITER_BATCH_REPORTS_FILE, include_all_scopes=include_all_scopes)
    platform_reports = [
        report for report in reports
        if isinstance(report, dict) and infer_recruiter_report_platform(report) == selected
    ]
    today_reports = [
        report for report in platform_reports
        if str(report.get("createdAt") or "").startswith(today)
    ]
    events = load_scoped_json_records(EVENT_LOG, include_all_scopes=include_all_scopes)
    platform_events = [
        event for event in events
        if isinstance(event, dict) and infer_recruiter_event_platform(event) == selected
    ]
    decisions = load_scoped_json_records(RECRUITER_DECISION_LOG_FILE, include_all_scopes=include_all_scopes)
    platform_decisions = [
        item for item in decisions
        if isinstance(item, dict) and infer_recruiter_decision_platform(item) == selected
    ]
    today_decisions = [
        item for item in platform_decisions
        if str(item.get("time") or item.get("createdAt") or item.get("updatedAt") or "").startswith(today)
    ]
    today_summary = apply_recruiter_summary_supplements(
        summarize_recruiter_counts(today_reports),
        decision_actions=summarize_recruiter_decision_actions(today_decisions),
        download_stats=summarize_recruiter_resume_download_records(selected, today),
        question_stats=summarize_recruiter_question_records(selected, today),
    )
    all_summary = apply_recruiter_summary_supplements(
        summarize_recruiter_counts(platform_reports),
        decision_actions=summarize_recruiter_decision_actions(platform_decisions),
        download_stats=summarize_recruiter_resume_download_records(selected, ""),
        question_stats=summarize_recruiter_question_records(selected, ""),
    )
    latest_reports = list(reversed(platform_reports[-8:]))
    latest_events = list(reversed(platform_events[-12:]))
    return {
        "platform": selected,
        "accountId": AGENT_ACCOUNT_ID,
        "accountName": AGENT_ACCOUNT_NAME,
        "today": today,
        "todaySummary": today_summary,
        "allSummary": all_summary,
        "todayDecisionSummary": summarize_recruiter_decisions(today_decisions),
        "allDecisionSummary": summarize_recruiter_decisions(platform_decisions),
        "latestReports": [compact_recruiter_report_for_dashboard(report) for report in latest_reports],
        "latestEvents": latest_events,
    }


def compact_recruiter_decision_log_item(item: dict) -> dict:
    if not isinstance(item, dict):
        return {}
    created_at = time.strftime("%Y-%m-%d %H:%M:%S")
    screening = item.get("screening") if isinstance(item.get("screening"), dict) else {}
    review = item.get("conversationReview") if isinstance(item.get("conversationReview"), dict) else {}
    decision_basis = screening.get("decisionBasis") if isinstance(screening.get("decisionBasis"), dict) else {}
    progress = screening.get("progress") if isinstance(screening.get("progress"), list) else []
    compact_progress = []
    for progress_item in progress[:8]:
        if not isinstance(progress_item, dict):
            continue
        question = progress_item.get("question") if isinstance(progress_item.get("question"), dict) else {}
        judgement = progress_item.get("judgement") if isinstance(progress_item.get("judgement"), dict) else {}
        compact_progress.append({
            "questionId": safe_text(str(question.get("id") or ""), 40),
            "question": safe_text(str(question.get("text") or ""), 120),
            "status": safe_text(str(progress_item.get("status") or judgement.get("status") or ""), 30),
            "answerText": safe_text(str(progress_item.get("answerText") or judgement.get("sourceText") or ""), 160),
            "reason": safe_text(str(judgement.get("reason") or ""), 120),
        })
    payload = {
        "time": safe_text(str(item.get("time") or created_at), 30),
        "conversationKey": safe_text(str(item.get("conversationKey") or ""), 80),
        "stateKeys": [safe_text(str(key), 80) for key in (item.get("stateKeys") if isinstance(item.get("stateKeys"), list) else [])[:5]],
        "candidateLabel": safe_text(str(item.get("candidateLabel") or ""), 180),
        "candidateName": safe_text(str(item.get("candidateName") or ""), 80),
        "appliedPosition": safe_text(str(item.get("appliedPosition") or ""), 100),
        "workflow": safe_text(str(item.get("workflow") or ""), 60),
        "status": safe_text(str(item.get("status") or ""), 60),
        "stage": safe_text(str(item.get("stage") or ""), 60),
        "nextAction": safe_text(str(item.get("nextAction") or ""), 60),
        "lastScreening": safe_text(str(item.get("lastScreening") or screening.get("reason") or ""), 140),
        "lastOther": safe_text(str(item.get("lastOther") or ""), 180),
        "knowledgeAnswer": safe_text(str(item.get("knowledgeAnswer") or ""), 100),
        "screeningStatus": safe_text(str(screening.get("status") or ""), 30),
        "screeningReason": safe_text(str(screening.get("reason") or ""), 140),
        "screeningProgress": compact_progress,
        "decisionBasis": {
            "status": safe_text(str(decision_basis.get("status") or ""), 30),
            "reason": safe_text(str(decision_basis.get("reason") or ""), 140),
            "decisionText": safe_text(str(decision_basis.get("decisionText") or ""), 180),
        } if decision_basis else {},
        "conversationReview": compact_candidate_conversation_review(review),
    }
    payload["id"] = "decision_" + stable_digest(
        "|".join([
            payload["time"],
            payload["conversationKey"],
            payload["candidateLabel"],
            payload["status"],
            payload["nextAction"],
            payload["lastOther"],
        ]),
        20,
    )
    return payload


def append_recruiter_decision_log(item: dict) -> dict:
    compact = compact_recruiter_decision_log_item(item)
    if not compact:
        return {}
    existing = load_json(RECRUITER_DECISION_LOG_FILE, [])
    if not isinstance(existing, list):
        existing = []
    last = existing[-1] if existing and isinstance(existing[-1], dict) else {}
    duplicate = bool(
        last.get("candidateLabel") == compact.get("candidateLabel")
        and last.get("status") == compact.get("status")
        and last.get("nextAction") == compact.get("nextAction")
        and last.get("lastOther") == compact.get("lastOther")
    )
    if not duplicate:
        existing.append(compact)
        save_json(RECRUITER_DECISION_LOG_FILE, existing[-8000:])
    return compact


def load_model_config() -> dict:
    config = dict(DEFAULT_MODEL_CONFIG)
    if LOCAL_ENV_FILE.exists():
        try:
            for line in LOCAL_ENV_FILE.read_text(encoding="utf-8-sig").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key in {"DASHSCOPE_API_KEY", "OPENAI_API_KEY", "MODEL_API_KEY"} and value:
                    config["apiKey"] = value
                elif key in {"MODEL_BASE_URL", "OPENAI_BASE_URL", "QWEN_BASE_URL"} and value:
                    config["baseUrl"] = value
                elif key in {"MODEL_NAME", "OPENAI_MODEL", "QWEN_TEXT_MODEL"} and value:
                    config["model"] = value
        except Exception:
            pass

    saved = load_json(MODEL_CONFIG_FILE, {})
    if isinstance(saved, dict):
        for key in ("baseUrl", "model", "apiKey"):
            if saved.get(key):
                config[key] = str(saved[key]).strip()

    if not config.get("apiKey"):
        env_key = os.environ.get("MODEL_API_KEY") or os.environ.get("OPENAI_API_KEY") or os.environ.get("DASHSCOPE_API_KEY")
        if env_key:
            config["apiKey"] = env_key
    return config


def public_model_config() -> dict:
    config = load_model_config()
    return {
        "baseUrl": config.get("baseUrl", DEFAULT_MODEL_CONFIG["baseUrl"]),
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "hasApiKey": bool(config.get("apiKey")),
    }


def has_model_key() -> bool:
    return bool(load_model_config().get("apiKey"))


def save_model_config(api_key: str, base_url: str = "", model: str = "") -> None:
    if not api_key or len(api_key) < 12:
        raise AgentError("API Key 看起来为空或太短，请检查后再保存。")
    config = {
        "apiKey": api_key,
        "baseUrl": base_url or DEFAULT_MODEL_CONFIG["baseUrl"],
        "model": model or DEFAULT_MODEL_CONFIG["model"],
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    save_json(MODEL_CONFIG_FILE, config)
    LOCAL_ENV_FILE.write_text(
        "\n".join([
            f"MODEL_API_KEY={api_key}",
            f"MODEL_BASE_URL={config['baseUrl']}",
            f"MODEL_NAME={config['model']}",
            f"OPENAI_API_KEY={api_key}",
            f"OPENAI_BASE_URL={config['baseUrl']}",
            f"OPENAI_MODEL={config['model']}",
            f"DASHSCOPE_API_KEY={api_key}",
            "",
        ]),
        encoding="utf-8",
    )
    os.environ["MODEL_API_KEY"] = api_key
    os.environ["OPENAI_API_KEY"] = api_key
    os.environ["DASHSCOPE_API_KEY"] = api_key
    os.environ["MODEL_BASE_URL"] = config["baseUrl"]
    os.environ["OPENAI_BASE_URL"] = config["baseUrl"]
    os.environ["MODEL_NAME"] = config["model"]
    os.environ["OPENAI_MODEL"] = config["model"]


def call_chat_completion(config: dict, api_key: str, payload: dict, timeout: int = 90) -> str:
    endpoint = str(config.get("baseUrl", DEFAULT_MODEL_CONFIG["baseUrl"])).rstrip("/") + "/chat/completions"
    stream_payload = {**payload, "stream": True}
    try:
        return call_streaming_chat_completion(endpoint, api_key, stream_payload, timeout=timeout)
    except Exception as stream_error:
        if not MODEL_ENABLE_NON_STREAM_FALLBACK or is_timeout_error(stream_error):
            raise AgentError(f"模型调用失败：stream={stream_error}")
        fallback_payload = {**payload}
        fallback_payload.pop("stream", None)
        try:
            return call_non_streaming_chat_completion(endpoint, api_key, fallback_payload, timeout=timeout)
        except Exception as fallback_error:
            raise AgentError(f"模型调用失败：stream={stream_error}; non-stream={fallback_error}")


def is_timeout_error(error: Exception) -> bool:
    text = str(error).lower()
    return isinstance(error, TimeoutError) or "timed out" in text or "timeout" in text or "超时" in text


def call_streaming_chat_completion(endpoint: str, api_key: str, payload: dict, timeout: int = 90) -> str:
    effective_timeout = max(5, min(int(timeout or 90), MODEL_SOCKET_TIMEOUT_SECONDS))
    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    chunks: list[str] = []
    deadline = time.time() + effective_timeout
    with urlopen(request, timeout=effective_timeout) as response:
        for raw_line in response:
            if time.time() > deadline:
                if chunks:
                    break
                raise TimeoutError(f"模型流式响应超过 {effective_timeout} 秒")
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                item = json.loads(data)
            except json.JSONDecodeError:
                continue
            delta = item.get("choices", [{}])[0].get("delta", {})
            content = delta.get("content")
            if content:
                chunks.append(str(content))
            message_content = item.get("choices", [{}])[0].get("message", {}).get("content")
            if message_content:
                chunks.append(str(message_content))
    content = "".join(chunks).strip()
    if not content:
        raise AgentError("流式响应没有返回文本内容")
    return content


def call_non_streaming_chat_completion(endpoint: str, api_key: str, payload: dict, timeout: int = 90) -> str:
    effective_timeout = max(5, min(int(timeout or 90), MODEL_SOCKET_TIMEOUT_SECONDS))
    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=effective_timeout) as response:
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    message = data["choices"][0].get("message", {})
    content = message.get("content")
    if content is None:
        raise AgentError("非流式响应 message.content 为空")
    return str(content)


def ask_agent_model_for_actions(task: str, context: dict, role_prompt: str, related_memory: list[dict] | None = None) -> dict:
    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        raise AgentError("还没有配置模型 API Key。")

    boss_recruiter_skill = load_boss_recruiter_skill_text()
    boss_recruiter_skill_section = (
        f"\n\nBOSS招聘自动化 Skill：\n{boss_recruiter_skill}\n"
        if boss_recruiter_skill
        else ""
    )
    job51_recruiter_skill = load_job51_recruiter_skill_text()
    job51_recruiter_skill_section = (
        f"\n\n51job招聘自动化 Skill：\n{job51_recruiter_skill}\n"
        if job51_recruiter_skill
        else ""
    )
    zhilian_recruiter_skill = load_zhilian_recruiter_skill_text()
    zhilian_recruiter_skill_section = (
        f"\n\n智联招聘自动化 Skill：\n{zhilian_recruiter_skill}\n"
        if zhilian_recruiter_skill
        else ""
    )

    system_prompt = f"""
你是一个网页操作 Agent 的大脑。后端会负责真正点击、填写、上传文件和观察页面；你只输出 JSON 动作计划。

当前角色设定：
{role_prompt}
{boss_recruiter_skill_section}
{job51_recruiter_skill_section}
{zhilian_recruiter_skill_section}

核心目标：
1. 根据用户总任务、页面 DOM 摘要、文件候选、历史步骤，主动规划下一步。
2. 不要等用户每一步下指令；只要信息足够，就继续推进任务。
3. 上传文件时优先使用 upload 动作直接设置 input[type=file]，不要先点击“选择文件/选择简历”导致 OS 文件窗口。
4. 如果上下文里已经有可用文件路径或候选文件，直接选择最合适的文件执行 upload，不要再要求用户提供路径。
5. 每次只给当前最稳的一小组动作，执行后后端会重新观察页面。
6. 如果动作失败，根据历史步骤换一种策略，例如改用 file input、按按钮文字、等待页面变化或重新观察。
7. 不要尝试绕过验证码、登录限制、风控或权限。
8. 提交、删除、发布、付款、邀请、拨打电话等高风险动作只规划，后端可能会二次确认。

聊天任务必须优先使用这些 function call 风格工具，而不是直接 fill/click：
- chat_read_context：读取当前聊天上下文和页面文本。
- chat_find_input：寻找聊天输入框。
- chat_fill_draft：生成并把回复草稿填入聊天输入框；是否自动发送由后端决定。
- chat_request_send_confirmation：仅当后端明确要求确认时才使用。
- chat_send_resume：当用户要“发简历/把简历发给对方/投递简历”时使用，后端会找“发简历”按钮、判断是否可用，并在第三方网站上先请求用户确认。
- recruiter_send_company_info：只允许用于 AI应用开发相关岗位（AI应用开发实习生、AI应用开发工程师）。招聘端/BOSS 账号中，需要发送 AI 岗位公司/岗位基本情况时使用。这是“发公司情况/介绍岗位条件/发送基础条件/问能不能接受日薪单休线下六个月”的业务 functioncall；后端会点击“常用语” -> 找到基础条件话术 -> 点击该话术右侧“发送”。销售、HR、应用技术、电气等非 AI 岗位不能使用常用语。
- recruiter_send_common_phrase：只允许用于 AI应用开发相关岗位（AI应用开发实习生、AI应用开发工程师）。招聘端/BOSS 账号中，需要发送 AI 岗位已配置“常用语”时使用；例如 phraseKey="basic_conditions" 会复用同一条基础条件话术。销售、HR、应用技术、电气等非 AI 岗位不能使用常用语。
- recruiter_process_unread_all_positions：招聘端/BOSS 账号中，处理所有岗位未读消息的最高层业务 functioncall；后端会切“未读”、打开联系人、识别岗位、读取 boss_chat_rules 的 screening/knowledgeBase，按岗位推进问题、求简历或跳过，并生成统计报告。未添加到岗位知识库的岗位必须只记录并跳过，不回复、不求简历。
- recruiter_process_current_position：招聘端/BOSS 账号中，处理当前已打开候选人的岗位流程；适合用户说“处理当前这个人/当前聊天框”。
- recruiter_proactive_contact_recommended_candidates：招聘端/BOSS 推荐牛人主动联系 functioncall；必须先进入推荐牛人页面，读取 .job-selecter-wrap .ui-dropmenu-label 当前岗位，不是 targetPosition 就打开岗位下拉并选择目标岗位，二次确认岗位正确后，按顺序处理每张正常 .candidate-card-wrap：先点击候选人卡片内容区打开 .dialog-wrap.active 在线简历弹层，提取弹层简历/经历概览文本，先检查同事沟通进度，若已有同事/另一个号沟通过就跳过，再用提取后的简历文本执行主动联系门槛判断，全部符合后才点击弹层里的 button.btn-greet「打招呼」按钮；应用技术经理（工业涂料领域）要求本科及以上、45 岁以下，并且候选人卡片/简历文本必须包含“流变助剂、膨润土、工业涂料、涂料研发、涂料工程师”任意一个字眼，低于本科、年龄 45 岁及以上、年龄未知、学历未知或缺少关键词都跳过；销售管培生要求 25 岁以下且至少大专，25 岁及以上、年龄未知、低于大专或学历未知都跳过；膨润土销售人员要求 35 岁以下、至少大专，并且候选人卡片/简历文本必须包含“涂料、膨润土、流变助剂”任意一个字眼，年龄未知、学历未知或缺少关键词都跳过；HRBP/人力资源/人力资源管培生要求本科及以上、30 岁以下，并且专业必须是人力资源、人力资源相关专业或理工科专业，低于本科、年龄未知、30 岁及以上或专业缺失/不相关且非理工科都跳过；国际业务管培生要求 25 岁以下、本科及以上，并且专业是国际贸易/英语/俄语/翻译，或者理工科专业且英语六级，年龄未知、低于本科或缺少专业/六级证据都跳过；电气工程师要求本科及以上、35 岁以下，专业必须是电气工程或自动化，并且候选人卡片/简历文本必须体现 PLC，低于本科、年龄未知、专业缺失/不相关或没有 PLC 证据都跳过；跳过或打招呼后都要关闭在线简历弹层；打招呼后如果出现已发送、更多牛人、相似牛人等小卡片，优先点击“知道了/我知道了”，如果没有再点关闭/稍后再说/X，不能点击继续沟通、立即沟通、发送等后续动作；如果页面插入 .similar-geek-wrap 或“为你推荐/相似牛人”等更多牛人推荐块，直接忽略并小幅下滑后重新观察下一张正常候选人卡，不能连续大幅滑动跳过候选人；已打过招呼的人按状态去重跳过。
- recruiter_answer_candidate_questions：招聘端/BOSS 账号中，只需要回答候选人最近 1-3 条未回复问题时使用；后端会从岗位知识库检索，未知问题不回复，只记录到用户提问/待补充问题。
- recruiter_screen_basic_conditions：只允许用于 AI应用开发相关岗位（AI应用开发实习生、AI应用开发工程师）。招聘端/BOSS 账号中，需要执行“先发基础条件，候选人接受后再求简历”的筛选流程时使用；后端会检查历史聊天，未发则先发常用语，已发且对方明确接受才继续“求简历”。销售、HR、应用技术、电气等非 AI 岗位必须走岗位专属筛选/知识库，不发常用语。
  如果用户要求“处理所有/全部未读消息直到没有未读”，使用 recruiter_process_unread_all_positions；保留 recruiter_screen_basic_conditions 给当前候选人或指定候选人的 AI 实习生基础条件流程。
- recruiter_screen_recent_with_followup：招聘端/BOSS 账号中，需要“最近N个联系人先处理基础情况/求简历，然后只观察这N个人的后续回复；连续一段时间没有新回复就结束”时使用。
- recruiter_request_resume：招聘端/BOSS 账号中，当用户要“对某个候选人/未回复/未读候选人求简历”时使用；如果用户说了姓名，把姓名放进 targetCandidate；后端会打开目标候选人或待处理候选人、点击“求简历”，并自动完成页面里的“确定”二次确认。
- recruiter_mark_unsuitable：招聘端/BOSS 账号中，当用户或岗位提示词判断候选人不接受关键条件、需要点“不合适”时使用；如果用户说了姓名，把姓名放进 targetCandidate；后端会先请求确认，再点击底部工具栏右侧“不合适”。
- job51_process_unread_all_positions：招聘端/51job 账号中，处理 51job 全部岗位未读消息；后端连接 9224 的 51job CloakBrowser，先点击“未读”，再点击“全部岗位”，然后从全岗位未读列表连续打开联系人、识别岗位并复用 boss_chat_rules 的岗位筛选/知识库规则。不要按岗位标签逐个切换。
- job51_process_current_position：招聘端/51job 账号中，处理当前已打开候选人的岗位流程。
- job51_answer_candidate_questions：招聘端/51job 账号中，只回答当前候选人最近未回复问题。
- job51_request_resume：招聘端/51job 账号中，只能在候选人已判断为合适后处理简历：优先检查本地下载记忆，已下载过则跳过；51 和新红/job51_b 禁止点击聊天里的“在线简历”或打开在线简历详情页，因为 51job 会重定向到人才管理页；此账号只能保存当前聊天内已可见且通过文件头校验的真实附件，不能把在线简历预览文本生成 PDF 或计为已下载，只有预览文本时必须回退到当前聊天里的求简历/求简历话术；其他 51job账号可保留在线简历 PDF 保存流程。
- job51_proactive_contact_recommended_candidates：招聘端/51job 人才望远镜主动联系流程；必须点击“人才望远镜”入口进入，不能直接打开推荐页 URL；进入后切到目标岗位，关闭推荐 AI 回复/广告/引导等遮挡层，读取推荐卡片，先跳过左上角显示“已看”的候选人，再按 BOSS 主动联系门槛筛选，dryRun=true 时只预览，非 dryRun 才点击“立即Hi聊”。

如果用户要求“回复/聊天/沟通/发送消息”，推荐流程是：
chat_read_context -> chat_fill_draft。
不要输出 chat_request_send_confirmation（除非你在历史结果里看到后端返回 confirmRequired）。
不要直接 click 发送。

只输出 JSON，不要 Markdown：
{{
  "state": "planning | executing | waiting | need_user | done",
  "thought": "一句话说明你为什么这么做",
  "actions": [
    {{"action": "chat_read_context"}},
    {{"action": "chat_find_input", "target": "聊天输入框"}},
    {{"action": "chat_fill_draft", "value": "要填入但暂不发送的草稿"}},
    {{"action": "chat_request_send_confirmation"}},
    {{"action": "chat_send_resume"}},
    {{"action": "recruiter_send_company_info"}},
    {{"action": "recruiter_send_company_info", "targetCandidate": "陈刚"}},
    {{"action": "recruiter_send_common_phrase", "phraseKey": "basic_conditions"}},
    {{"action": "recruiter_process_unread_all_positions", "maxTotal": 80}},
    {{"action": "recruiter_process_current_position"}},
    {{"action": "recruiter_proactive_contact_recommended_candidates", "targetPosition": "应用技术经理（工业涂料领域）", "maxTotal": 10}},
    {{"action": "recruiter_answer_candidate_questions"}},
    {{"action": "recruiter_screen_basic_conditions", "openUnreplied": false}},
    {{"action": "recruiter_screen_basic_conditions", "processAllUnread": true}},
    {{"action": "recruiter_screen_recent_with_followup", "count": 10, "idleSeconds": 30}},
    {{"action": "recruiter_request_resume", "openUnreplied": true}},
    {{"action": "recruiter_request_resume", "targetCandidate": "陈刚", "openUnreplied": false}},
    {{"action": "recruiter_mark_unsuitable", "targetCandidate": "陈刚", "openUnreplied": false}},
    {{"action": "job51_process_unread_all_positions", "maxTotal": 40}},
    {{"action": "job51_process_current_position"}},
    {{"action": "job51_answer_candidate_questions"}},
    {{"action": "job51_request_resume"}},
    {{"action": "job51_proactive_contact_recommended_candidates", "targetPosition": "膨润土销售人员", "maxTotal": 10, "dryRun": true}},
    {{"action": "click", "target": "元素编号或可见文本"}},
    {{"action": "fill", "target": "元素编号或输入框标签", "value": "要填写的内容"}},
    {{"action": "upload", "target": "file input 元素编号、id、或 file", "value": "本地文件绝对路径"}},
    {{"action": "press", "value": "Enter"}},
    {{"action": "wait", "value": "1000"}},
    {{"action": "goto", "value": "https://..."}},
    {{"action": "observe"}},
    {{"action": "done", "reason": "说明完成情况"}}
  ]
}}
""".strip()
    system_prompt += """

Function-call mode:
- You receive a compact page view, not the full DOM. This saves tokens.
- Prefer tool-style actions when you need more context:
  observe_page_summary, find_element, verify_result, recover_from_error.
- Use find_element when the compact elements do not include the target, then use the returned index/text in a normal click/fill/upload action on the next step.
- Use verify_result after uploads, navigation, parsing, or form actions when success is uncertain.
- For chat tasks, always draft first with chat_fill_draft and request/await send confirmation.
- For resume-send tasks in a chat page, use chat_send_resume instead of drafting a text-only reply.
- For recruiter-side first-contact AI application-development basic-condition messages, use recruiter_send_company_info instead of manually filling the text or guessing where 常用语 is. Do not use 常用语 for sales, HR, application-technology, electrical, or other non-AI positions.
- Treat "send company basic info", "introduce job conditions", "ask whether they can accept the 150/day single-day-off offline 6-month conditions", and "send the opening/common phrase" as recruiter_send_company_info only when the applied position is AI应用开发实习生 or AI应用开发工程师.
- For recruiter-side "process all unread/new messages across all positions", prefer recruiter_process_unread_all_positions instead of the older recruiter_screen_basic_conditions alias.
- For recruiter-side "handle current candidate/current chat according to their job", use recruiter_process_current_position.
- For recruiter-side "proactive contact / recommended candidates / greet candidates", use recruiter_proactive_contact_recommended_candidates. The workflow is fixed: enter BOSS 推荐牛人, confirm .job-selecter-wrap .ui-dropmenu-label equals targetPosition, switch the dropdown when needed, then process each normal .candidate-card-wrap one by one: click the candidate card content area, wait for the .dialog-wrap.active online resume dialog, extract resume/summary text, first skip candidates whose 同事沟通进度 shows another account/colleague has already contacted them, apply the proactive-contact gates to the remaining resume evidence, and only then click the dialog button.btn-greet. For 应用技术经理（工业涂料领域）, require bachelor or above, age under 45, and at least one keyword in the candidate card/resume text: 流变助剂、膨润土、工业涂料、涂料研发、涂料工程师; missing education, age, or all keywords must be skipped. For 销售管培生, require age under 25 and at least college diploma; age 25+, unknown age, below-college, or unknown education must be skipped. For 膨润土销售人员, require age under 35, at least college diploma, and at least one keyword in the candidate card/resume text: 涂料、膨润土、流变助剂; missing age, education, or keyword must be skipped. For HRBP/人力资源/人力资源管培生, require bachelor or above, age under 30, and a human-resources/related major or STEM/理工科 major; below bachelor, age 30+, unknown age, missing major, or unrelated non-STEM major must be skipped. For 国际业务管培生, require age under 25, bachelor or above, and either 国际贸易/英语/俄语/翻译 major or STEM major with CET-6; missing age, below bachelor, missing major, or no CET-6 evidence for STEM must be skipped. For 电气工程师, require bachelor or above, age under 35, 电气工程/自动化 major, and PLC evidence in the card/resume text; below bachelor, missing age, missing major, or no PLC evidence must be skipped. Close the resume dialog after each skip/greet, then close post-greet popup/cards by preferring 知道了/我知道了, falling back only to close-only controls. Ignore inserted similar/more-candidates recommendation blocks, use a small scroll, and re-observe so candidates are handled one by one.
- For recruiter-side "answer the candidate's latest questions", use recruiter_answer_candidate_questions.
- For recruiter-side AI应用开发相关岗位 "send basic conditions, if accepted then request resume" screening tasks, use recruiter_screen_basic_conditions instead of separately calling common phrase and resume request. For sales, HR, application-technology, electrical, and other non-AI positions use position-specific screening/knowledge rules.
- For recruiter-side "recent N contacts, then watch only these contacts for follow-up replies and end after an idle timeout", use recruiter_screen_recent_with_followup.
- For recruiter-side "process all unread/new messages until none remain" tasks, use recruiter_process_unread_all_positions. Use recruiter_screen_basic_conditions only for the legacy AI-intern current/selected-candidate basic-condition flow.
- For recruiter-side resume-request tasks, use recruiter_request_resume. Do not use a plain text reply when the user asks to “求简历”.
- For recruiter-side unsuitable tasks, use recruiter_mark_unsuitable. Do not invent a click target for “不合适”.
- The visible "发送"/"send" button is a known send-button whitelist target: do not stop with "external impact paused" just because it exists. Use chat_request_send_confirmation for third-party pages, then execute only after confirmation.
- Return only JSON. Tool calls use either {"action": "find_element", "target": "..."} or {"tool": "find_element", "args": {"target": "..."}}.
""".strip()

    user_prompt = {
        "task": task,
        "page": context,
        "relatedMemory": related_memory or [],
        "availableActions": [
            "observe_page_summary",
            "find_element",
            "verify_result",
            "recover_from_error",
            "chat_read_context",
            "chat_load_history",
            "chat_find_input",
            "chat_fill_draft",
            "chat_request_send_confirmation",
            "chat_send_resume",
            "recruiter_send_company_info",
            "recruiter_send_common_phrase",
            "recruiter_process_unread_all_positions",
            "recruiter_process_current_position",
            "recruiter_answer_candidate_questions",
            "recruiter_proactive_contact_recommended_candidates",
            "recruiter_screen_basic_conditions",
            "recruiter_screen_recent_with_followup",
            "recruiter_request_resume",
            "recruiter_mark_unsuitable",
            "job51_process_unread_all_positions",
            "job51_process_current_position",
            "job51_answer_candidate_questions",
            "job51_request_resume",
            "job51_proactive_contact_recommended_candidates",
            "zhilian_process_unread_all_positions",
            "zhilian_process_current_position",
            "zhilian_answer_candidate_questions",
            "zhilian_request_resume",
            "zhilian_proactive_contact_recommended_candidates",
            "click",
            "fill",
            "upload",
            "press",
            "wait",
            "goto",
            "observe",
            "done",
        ],
    }
    system_prompt = """
你是一个谨慎的聊天顾问。你只根据当前聊天上下文生成候选回复，不直接发送。
要求：
1. 先判断对方最近在问什么或表达什么。
2. 如果看起来没有新的对方消息、页面不是聊天详情、只是用户自己刚发出的消息、或上下文不足以安全回复，返回空 suggestions。
3. 如果需要回复，只生成 1 条候选回复。
4. 回复必须简短，优先 20-45 个中文字符，最多 60 个中文字符；像真实聊天一样自然，不要长段落。
5. 不要承诺不存在的事实，不要编造经历、薪资、公司政策或联系方式。
6. 不要写“【填写手机号】”“X年”这类占位符；缺信息就简短说明可补充。
7. 只输出 JSON，不要 Markdown。
格式：
{
  "analysis": "一句话说明你对对方消息的理解",
  "suggestions": [
    {"label": "简短回复", "text": "候选回复内容"}
  ]
}
无需回复时：
{
  "analysis": "说明为什么暂不回复",
  "suggestions": []
}
""".strip()
    system_prompt = f"""
你是一个网页操作 Agent 的规划大脑。后端会负责真实点击、填写、上传、按键、等待和观察页面；你只输出 JSON 动作计划。
当前角色设定：{role_prompt}
{boss_recruiter_skill_section}
{job51_recruiter_skill_section}
{zhilian_recruiter_skill_section}

规则：
1. 根据用户任务、页面摘要、历史结果和可用文件，主动规划下一小步。
2. 如果需要更多页面信息，使用 observe_page_summary 或 find_element。
3. 聊天任务优先使用 chat_load_history -> chat_read_context -> chat_fill_draft，不要直接 fill/click 发送。
4. 如果用户要求发简历、把简历发给对方、投递简历，优先使用 chat_send_resume，不要只发送一句“我发你简历”。
5. 如果招聘端 AI应用开发相关岗位（AI应用开发实习生、AI应用开发工程师）首次需要介绍岗位基础条件，优先使用 recruiter_send_company_info；不要手动 fill 这段常用语，也不要自己猜“常用语”按钮位置。销售、HR、应用技术、电气等非 AI 岗位不能发常用语。
   “发公司基本情况 / 介绍岗位条件 / 问能不能接受日薪150、单休、线下、六个月 / 发开场话术”都属于这个业务 functioncall。
6. 如果用户要求处理所有岗位/全部未读/全部新消息/直到没有未读，优先使用 recruiter_process_unread_all_positions；它会自动切“未读”、识别岗位并按岗位知识库流程处理。岗位知识库没有添加的岗位必须跳过，不回复、不求简历。
6.1 如果用户要求主动联系/推荐牛人/主动打招呼/批量打招呼，优先使用 recruiter_proactive_contact_recommended_candidates；流程是：进入 BOSS 推荐牛人 -> 读取 .job-selecter-wrap .ui-dropmenu-label 当前岗位 -> 岗位不对就选择 targetPosition -> 再次确认岗位正确 -> 对每个正常候选人先点击 .candidate-card-wrap 内容区打开 .dialog-wrap.active 在线简历弹层 -> 提取弹层简历/经历概览文本 -> 先检查同事沟通进度，已有同事/另一个号沟通过则跳过 -> 用提取后的简历文本判断候选人学历/年龄/专业/关键词是否满足岗位主动联系门槛（应用技术经理要求本科及以上、45 岁以下，且候选人卡片/简历文本包含“流变助剂、膨润土、工业涂料、涂料研发、涂料工程师”任意一个字眼；销售管培生要求至少大专且 25 岁以下；膨润土销售人员要求至少大专、35 岁以下，且候选人卡片/简历文本包含“涂料、膨润土、流变助剂”任意一个字眼；HRBP/人力资源要求本科及以上、30 岁以下，且专业必须是人力资源、人力资源相关专业或理工科专业；国际业务管培生要求 25 岁以下、本科及以上，且专业是国际贸易/英语/俄语/翻译，或者理工科专业且英语六级；电气工程师要求本科及以上、35 岁以下，专业必须是电气工程或自动化，且候选人卡片/简历文本体现 PLC；低于门槛或无法识别学历/年龄/关键词/专业则跳过）-> 符合后点击在线简历弹层里的 button.btn-greet「打招呼」-> 跳过或打招呼后关闭在线简历弹层；打招呼后若弹出已发送/更多牛人/相似牛人小卡片，优先点“知道了/我知道了”，没有再点关闭/稍后再说/X，不做继续沟通/发送等额外动作；如果弹出/插入“更多牛人推荐、相似牛人推荐、为你推荐 与某某相似的牛人”等区域，忽略它，只做小幅下滑并重新观察，确保挨个处理候选人，不要连续大幅滑动跳过；已主动联系过的人必须跳过。
7. 如果用户要求处理当前候选人/当前聊天框，优先使用 recruiter_process_current_position。
8. 如果用户只要求回答候选人最近问题，优先使用 recruiter_answer_candidate_questions。
9. 如果用户要求“先发基础条件/公司基本情况，对方接受后求简历”的当前候选人筛选流程，只有 AI应用开发相关岗位（AI应用开发实习生、AI应用开发工程师）才使用 recruiter_screen_basic_conditions；销售、HR、应用技术、电气等非 AI 岗位走岗位专属筛选/知识库，不发常用语。
10. 如果用户要求“最近N个联系人先处理，再只观察这N个人的后续回复；连续30秒没有新回复就结束”，优先使用 recruiter_screen_recent_with_followup。
11. 如果用户在招聘端要求对某个候选人或未回复/未读候选人“求简历”，优先使用 recruiter_request_resume；用户给出姓名时填写 targetCandidate。
12. 如果用户或岗位提示词判断候选人明确不能接受关键条件，需要点“不合适”，优先使用 recruiter_mark_unsuitable；不要自己编造 click 目标。
13. 第三方网站发送普通消息、个人简历、标记不合适仍属于外部影响，应该让后端确认；招聘端“求简历”和已配置常用语发送已按用户配置为专用自动执行流程。
14. 上传文件优先使用 upload 直接设置 input[type=file]。
15. 不要尝试绕过验证码、登录限制、权限限制或平台风控。
16. 只输出 JSON，不要 Markdown。

JSON 格式：
{{
  "state": "planning | executing | waiting | need_user | done",
  "thought": "一句话说明为什么这样做",
  "actions": [
    {{"action": "chat_read_context"}},
    {{"action": "chat_load_history", "value": "8"}},
    {{"action": "chat_fill_draft", "value": "回复草稿"}},
    {{"action": "chat_send_resume"}},
    {{"action": "recruiter_send_company_info"}},
    {{"action": "recruiter_send_company_info", "targetCandidate": "陈刚"}},
    {{"action": "recruiter_send_common_phrase", "phraseKey": "basic_conditions"}},
    {{"action": "recruiter_process_unread_all_positions", "maxTotal": 80}},
    {{"action": "recruiter_process_current_position"}},
    {{"action": "recruiter_proactive_contact_recommended_candidates", "targetPosition": "应用技术经理（工业涂料领域）", "maxTotal": 10}},
    {{"action": "recruiter_answer_candidate_questions"}},
    {{"action": "recruiter_screen_basic_conditions", "openUnreplied": false}},
    {{"action": "recruiter_screen_basic_conditions", "processAllUnread": true}},
    {{"action": "recruiter_screen_recent_with_followup", "count": 10, "idleSeconds": 30}},
    {{"action": "recruiter_request_resume", "openUnreplied": true}},
    {{"action": "recruiter_request_resume", "targetCandidate": "陈刚", "openUnreplied": false}},
    {{"action": "recruiter_mark_unsuitable", "targetCandidate": "陈刚", "openUnreplied": false}},
    {{"action": "find_element", "target": "元素文本或意图"}},
    {{"action": "click", "target": "元素编号或可见文本"}},
    {{"action": "fill", "target": "输入框编号或标签", "value": "要填写的内容"}},
    {{"action": "upload", "target": "file input 元素编号/id/file", "value": "本地文件绝对路径"}},
    {{"action": "press", "value": "Enter"}},
    {{"action": "wait", "value": "1000"}},
    {{"action": "observe"}},
    {{"action": "done", "reason": "完成情况"}}
  ]
}}
""".strip()
    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.15,
        "response_format": {"type": "json_object"},
    }
    content = call_chat_completion(config, api_key, payload, timeout=90)
    return parse_json_object(content)


def ask_agent_model_for_message(category: str, template: str, context: dict, job: str = "") -> str:
    """Use the configured model to lightly personalize a chat message.

    This returns plain text (NOT JSON) and is used by the BOSS bulk-chat helper.
    """

    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        raise AgentError("还没有配置模型 API Key。")

    system_prompt = (
        "你是招聘/沟通助手。你的任务是基于给定模板，结合对话/页面可见信息，生成一条更自然、个性化、礼貌的开场消息。\n"
        "要求：\n"
        "- 只输出最终要发送的一段文本，不要解释，不要 Markdown。\n"
        "- 150 字以内。\n"
        "- 不要包含任何链接、二维码、联系方式（电话/微信/邮箱）。\n"
        "- 不要做承诺式措辞（如保证/一定）。\n"
        "- 如果信息不足，就在模板基础上微调即可。"
    )

    applied_position = clean_applied_position(
        str((context or {}).get("appliedPosition") or (context or {}).get("job") or job or "")
    )
    page_snippet = safe_text(str((context or {}).get("bodyTextPreview") or ""), 900)
    user_content = json.dumps(
        {
            "category": category,
            "job": applied_position or job,
            "appliedPosition": applied_position,
            "template": template,
            "pageSnippet": page_snippet,
        },
        ensure_ascii=False,
    )

    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.35,
    }
    content = call_chat_completion(config, api_key, payload, timeout=90).strip()
    # Basic cleanup
    content = content.replace("\r", "").strip()
    # Hard limit
    return safe_text(content, 180)


def normalize_reply_fingerprint(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "").strip().lower())


def strip_reply_terminal_punctuation(text: str) -> str:
    return re.sub(r"[。．.!！]+$", "", str(text or "").strip())


def avoid_repeated_reply(text: str, context: dict) -> str:
    text = strip_reply_terminal_punctuation(text)
    current = normalize_reply_fingerprint(text)
    if not current:
        return text
    recent_texts: list[str] = []
    memory = context.get("memory") if isinstance(context.get("memory"), dict) else {}
    recent_texts.extend([str(item or "") for item in memory.get("recentMyMessages", []) if item])
    for message in context.get("messages", []) if isinstance(context.get("messages"), list) else []:
        if isinstance(message, dict) and message.get("sender") == "me":
            recent_texts.append(str(message.get("text") or ""))
    for previous in recent_texts[-8:]:
        if normalize_reply_fingerprint(previous) == current:
            kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
            repeat_control = kb.get("repeatControl") if isinstance(kb.get("repeatControl"), dict) else {}
            return strip_reply_terminal_punctuation(safe_text(str(repeat_control.get("fallbackReply") or "按刚刚那条为准"), CHAT_REPLY_MAX_CHARS))
    return text


def ask_agent_model_for_reply_suggestions(context: dict) -> list[dict]:
    if not context.get("shouldReply"):
        return []
    kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    if str(context.get("appliedPosition") or "").strip() and not kb.get("enabled"):
        return []
    knowledge_hit = context.get("companyKnowledgeHit") if isinstance(context.get("companyKnowledgeHit"), dict) else {}
    if not knowledge_hit.get("answer") and has_model_key():
        try:
            knowledge_hit = ask_agent_model_for_company_knowledge_reply(context)
        except Exception:
            knowledge_hit = {}
    if knowledge_hit.get("answer"):
        answer = avoid_repeated_reply(str(knowledge_hit.get("answer") or ""), context)
        if answer:
            label = "知识库拆问回复" if knowledge_hit.get("source") == "companyKnowledgeBase.model" else "知识库回复"
            return [{"label": label, "text": answer}]

    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        raise AgentError("还没有配置模型 API Key。")

    system_prompt = """
你是一个谨慎的聊天顾问。你只根据当前聊天上下文生成候选回复，不直接发送。
要求：
1. 判断对方最近在问什么或表达什么。
2. 生成 1-2 条自然、礼貌、简洁的候选回复。
3. 不要承诺不存在的事实，不要编造经历、薪资、公司政策。
4. 如果上下文不足，生成一条澄清式回复。
5. 只输出 JSON。
格式：
{
  "analysis": "一句话说明你对对方消息的理解",
  "suggestions": [
    {"label": "稳妥回复", "text": "候选回复内容"},
    {"label": "积极回复", "text": "候选回复内容"}
  ]
}
""".strip()
    system_prompt = """
你是一个谨慎的聊天顾问。你只根据当前聊天上下文生成候选回复，不直接发送。
要求：
1. 优先看 chatContext.messages、lastMessage、lastOtherMessage、intent，以及 chatContext.memory.summary / replyStyle。只有 lastMessage.sender == "other" 才能回复。
2. 如果最后一条有效消息不是对方发的，或上下文不足以安全回复，返回空 suggestions。
3. 你扮演招聘者/HR，不是求职者。必须读取 chatContext.appliedPosition / chatContext.applicant.appliedPosition，明确这是候选人应聘岗位。
4. 如果 chatContext.positionReply.rolePrompt 存在，把它当作当前岗位的最高优先级沟通提示词；同时参考 positionReply.template、talkingPoints、screeningQuestions、nextSteps。
5. 如果 chatContext.companyKnowledgeHit.answer 存在，优先使用这个知识库命中答案，不要扩写。
6. 如果 chatContext.companyKnowledgeBase.enabled 为 true，候选人问公司、薪资、工时、地点、住宿、面试、入职、转正、岗位内容时，必须优先按 companyKnowledgeBase 的 faq、topics 和 answerPolicy 回答。
7. 知识库没有明确答案，或招聘要求/面试准备等被标为不回复时，不生成回复，不要输出“暂时还不清楚/不清楚/不知道”等兜底话术，也不要编造。
8. 按 intent.category 和 memory.replyStyle 选择回复策略：候选人打招呼就简短回应并推进；候选人发简历就按流程处理；要联系方式/薪资等敏感信息必须以知识库为准。
9. 如果需要回复，只生成 1 条自然、礼貌、简洁的候选回复。
10. 回复必须很短，优先不超过 20 个中文字符；必要时可分 1-2 个短句，不要长段落。
11. 回复末尾不要加句号、感叹号或英文句点。
12. 避免短时间重复回复同一句；如果 memory.recentMyMessages 已经回答过同类问题，要换成极短确认或暂不重复。
13. 不要承诺不存在的事实，不要编造经历、薪资、公司政策或联系方式。
14. 不要写“【填写手机号】”“X年”这类占位符。
15. 记忆只用于保持上下文和话术风格；如果记忆与当前消息冲突，以当前消息为准。
16. 只输出 JSON，不要 Markdown。
格式：
{
  "analysis": "一句话说明你对对方消息的理解",
  "suggestions": [
    {"label": "简短回复", "text": "候选回复内容"}
  ]
}
无需回复时：
{
  "analysis": "说明为什么暂不回复",
  "suggestions": []
}
""".strip()
    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps({"chatContext": context}, ensure_ascii=False)},
        ],
        "temperature": 0.35,
        "response_format": {"type": "json_object"},
    }
    content = call_chat_completion(config, api_key, payload, timeout=90)
    parsed = parse_json_object(content)
    suggestions = parsed.get("suggestions", [])
    if not isinstance(suggestions, list):
        return []
    normalized = []
    for index, item in enumerate(suggestions[:1], start=1):
        if isinstance(item, dict):
            text = strip_reply_terminal_punctuation(safe_text(str(item.get("text") or "").strip(), CHAT_REPLY_MAX_CHARS))
            label = safe_text(str(item.get("label") or f"候选回复 {index}").strip(), 40)
        else:
            text = strip_reply_terminal_punctuation(safe_text(str(item).strip(), CHAT_REPLY_MAX_CHARS))
            label = f"候选回复 {index}"
        text = avoid_repeated_reply(text, context)
        if text:
            normalized.append({"label": label, "text": text})
    return normalized


def parse_json_object(content: str) -> dict:
    content = (content or "").strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.S)
        if not match:
            raise AgentError(f"模型没有返回 JSON：{content[:300]}")
        return json.loads(match.group(0))


INTERVIEW_INVITE_SEND_DISABLED_FOR_TESTING = (
    str(os.environ.get("INTERVIEW_INVITE_SEND_DISABLED_FOR_TESTING", "0")).strip().lower()
    not in {"0", "false", "no", "off"}
)
INTERVIEW_INVITE_FOLLOWUP_MESSAGE = "加我微信沟通"


def normalize_interview_platform(value: str) -> str:
    key = str(value or "").strip().lower()
    if key in {"51", "51job", "job51", "job51_a", "job51_b"}:
        return "51job"
    if key in {"zhilian", "zhaopin", "zhilian_a", "zhilian_b"}:
        return "zhilian"
    return "boss"


def normalize_interview_chat_evidence(messages) -> list[dict]:
    if not isinstance(messages, list):
        return []
    normalized: list[dict] = []
    for message in messages[-8:]:
        if not isinstance(message, dict):
            continue
        text = safe_text(str(message.get("text") or message.get("rawText") or "").strip(), 220)
        if not text:
            continue
        sender = str(message.get("sender") or "")
        if sender not in {"me", "other", "system"}:
            sender = "other"
        if sender == "system":
            continue
        normalized.append({
            "sender": sender,
            "time": safe_text(str(message.get("time") or message.get("timestamp") or ""), 40),
            "status": safe_text(str(message.get("status") or ""), 40),
            "text": text,
        })
    return normalized[-3:]


def compact_interview_match_text(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def interview_text_contains(haystack: str, needle: str, min_len: int = 2) -> bool:
    left = compact_interview_match_text(haystack)
    right = compact_interview_match_text(needle)
    if len(right) < min_len:
        return False
    if right in left:
        return True
    if len(right) >= 10 and right[:10] in left:
        return True
    if len(right) >= 14 and right[-12:] in left:
        return True
    return False


def verify_interview_contact_match(
    final_probe: dict,
    search_name: str,
    applied_position: str = "",
    chat_evidence: list[dict] | None = None,
    result_matches: list[dict] | None = None,
    clicked: dict | None = None,
) -> dict:
    final_probe = final_probe if isinstance(final_probe, dict) else {}
    result_matches = result_matches if isinstance(result_matches, list) else []
    chat_evidence = chat_evidence if isinstance(chat_evidence, list) else []
    clicked = clicked if isinstance(clicked, dict) else {}
    text_parts = [
        final_probe.get("title") or "",
        final_probe.get("url") or "",
        final_probe.get("bodyPreview") or "",
        str((clicked.get("result") or {}).get("text") or "") if isinstance(clicked.get("result"), dict) else "",
    ]
    page_text = " ".join(text_parts)
    name_matched = interview_text_contains(page_text, search_name, min_len=2)
    position_matched = interview_text_contains(page_text, applied_position, min_len=4) if applied_position else False
    no_result = bool(final_probe.get("noResult")) and not result_matches
    matched_messages = []
    for message in chat_evidence:
        text = str(message.get("text") or "")
        if interview_text_contains(page_text, text, min_len=6):
            matched_messages.append(safe_text(text, 120))
    single_result = len(result_matches) == 1
    has_aux_evidence = bool(applied_position or chat_evidence)
    verified = bool((not no_result) and name_matched and (position_matched or matched_messages or single_result or not has_aux_evidence))
    reason = ""
    if no_result or not name_matched:
        reason = "search_result_not_found"
    elif len(result_matches) > 1 and not (position_matched or matched_messages):
        reason = "multiple_candidates_unverified"
    elif has_aux_evidence and not (position_matched or matched_messages or single_result):
        reason = "chat_evidence_not_matched"
    elif not verified:
        reason = "contact_not_verified"
    return {
        "verified": verified,
        "nameMatched": name_matched,
        "positionMatched": position_matched,
        "matchedMessages": matched_messages[:3],
        "singleResult": single_result,
        "resultCount": len(result_matches),
        "reason": reason,
    }


def interview_page_probe(page, target_id: str = "") -> dict:
    return page.evaluate(
        r"""targetId => {
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
          const looksNoResult = text => /没有找到|未找到|暂无|无相关|搜索中|no\s+result|not\s+found/i.test(normalize(text));
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4
              && box.bottom > 0 && box.right > 0
              && box.top < window.innerHeight && box.left < window.innerWidth
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0';
          };
          const rect = el => {
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
          };
          const labelFor = el => normalize([
            el.getAttribute('placeholder'),
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('data-testid'),
            el.getAttribute('class'),
            el.parentElement ? el.parentElement.getAttribute('class') : '',
            el.parentElement && el.parentElement.parentElement ? el.parentElement.parentElement.getAttribute('class') : '',
            el.innerText,
            el.textContent,
            el.parentElement ? el.parentElement.innerText : '',
          ].filter(Boolean).join(' '));
          const editables = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]'));
          const editableItems = editables.map((el, index) => {
            const label = labelFor(el);
            const lower = label.toLowerCase();
            const searchClassLike = /chat-top-search|chat-job-search|search-input|conversation-search|search-box|im-search-modal|im-search-modal__search-input|side-panel-header__input/.test(lower);
            let searchScore = 0;
            if (/搜索|搜|search|候选|联系人|姓名|手机号|id|简历|人才/.test(label) || /search|candidate|contact|resume|talent/.test(lower)) searchScore += 80;
            if (searchClassLike) searchScore += 90;
            if (/输入|回复|发送|开启对话|聊天|message|chat|reply/.test(label) || /drop-area|sender|textarea_self/.test(lower)) searchScore -= 120;
            if (el.tagName === 'INPUT') searchScore += 20;
            if (rect(el).x < window.innerWidth * 0.55) searchScore += 12;
            if (rect(el).y < window.innerHeight * 0.45) searchScore += 10;
            if (el.disabled || el.readOnly) searchScore -= 200;

            let chatScore = 0;
            if (/输入|回复|发送|开启对话|聊天|message|chat|reply|drop-area|sender|textarea_self/.test(label) || /drop-area|sender|textarea_self/.test(lower)) chatScore += 90;
            if (searchClassLike) chatScore -= 180;
            if (rect(el).y > window.innerHeight * 0.45) chatScore += 20;
            if (el.disabled || el.readOnly) chatScore -= 200;
            return { index, tag: el.tagName.toLowerCase(), label: label.slice(0, 180), rect: rect(el), searchScore, chatScore };
          }).filter(item => visible(editables[item.index]));
          const searchInputs = editableItems
            .filter(item => item.searchScore > 0)
            .sort((a, b) => b.searchScore - a.searchScore)
            .slice(0, 8);
          const chatInputs = editableItems
            .filter(item => item.chatScore > 0)
            .sort((a, b) => b.chatScore - a.chatScore)
            .slice(0, 8);

          const allNodes = Array.from(document.querySelectorAll('body *'));
          const resultMatches = [];
          let noResultSignals = 0;
          const target = normalize(targetId);
          const pageUrl = String(location.href || '');
          const is51job = /ehire\.51job\.com/i.test(pageUrl);
          const isZhilian = /zhaopin\.com\/app\/im/i.test(pageUrl);
          const metaFor = el => normalize([
            el.id,
            el.getAttribute('class'),
            el.getAttribute('role'),
            el.getAttribute('data-testid'),
            el.getAttribute('placeholder'),
            el.getAttribute('aria-label'),
            el.parentElement ? el.parentElement.getAttribute('class') : '',
            el.parentElement && el.parentElement.parentElement ? el.parentElement.parentElement.getAttribute('class') : '',
          ].filter(Boolean).join(' ')).toLowerCase();
          const is51SearchResultNode = el => {
            if (!is51job || !el) return false;
            if (el.closest('input, textarea, [contenteditable="true"]')) return false;
            const row = el.closest('.search-content .searchlist-item, .search-content .name-res.result, .search-content .conversation-item');
            if (!row) return false;
            if (row.closest('.el-input, .search-input')) return false;
            return true;
          };
          const isSearchEcho = (el, text) => {
            if (!target) return false;
            if (is51SearchResultNode(el)) return false;
            if (normalize(text) === target) return true;
            const meta = metaFor(el);
            if (/(keyword|input|filter|condition|query|tag|search-box|conversation-search|el-input|suggest)/i.test(meta)) return true;
            if (el.closest('input, textarea, [contenteditable="true"]')) return true;
            return false;
          };
          const resultScoreFor = (el, text, childText) => {
            const className = String(el.className || '');
            const lowerClass = className.toLowerCase();
            const box = rect(el);
            let score = 0;
            if (!childText.includes(target)) score += 50;
            else score -= Math.min(140, Math.max(20, Math.floor(text.length / 8)));
            if (text.length <= 80) score += 45;
            else if (text.length <= 220) score += 10;
            else score -= 120;
            if (box.h >= 28 && box.h <= 180) score += 25;
            if (box.w > window.innerWidth * 0.75) score -= 120;
            if (box.h > window.innerHeight * 0.5) score -= 120;
            if (is51job) {
              const isSearchResult = is51SearchResultNode(el);
              if (isSearchResult) score += 680;
              if (/(^|\s)(searchlist-item|name-res|result)(\s|$)/i.test(className)) score += 260;
              if (/(^|\s)(list-item|recommend-item|wrap-item|batch-chat-item|conversation-item)(\s|$)/i.test(className)) score += 260;
              if (/username|user-name|(^|\s)name(\s|$)|resume-info-status/i.test(className)) score += 150;
              if (el.closest('.conversation-list,.conversation-list-container,.batch-chat-list-wrap')) score += 70;
              if (el.closest('.conversation-search,.search-box') && !isSearchResult) score -= 420;
            }
            if (isZhilian) {
              if (/(^|\s)im-search-result(\s|$)/i.test(className)) score += 320;
              if (/im-search-result__content|im-search-result__title-row|im-search-result__name/i.test(className)) score += 190;
              if (/im-search-all-results__group-list/i.test(className)) score += 130;
              if (el.closest('.im-search-modal')) score += 80;
              if (/km-modal|im-search-modal__layout|im-search-modal__content|im-search-result__box|im-search-result__left-box|km-scrollbar/i.test(className) && childText.includes(target)) score -= 120;
            }
            if (/search-box|conversation-search|im-search-modal__search-input|input|keyword|query/i.test(metaFor(el)) && !(is51job && is51SearchResultNode(el))) score -= 260;
            return score;
          };
          if (target) {
            allNodes.forEach((el, index) => {
              if (!visible(el)) return;
              const text = normalize(el.innerText || el.textContent || '');
              if (!text || text.length > 800 || !text.includes(target)) return;
              if (isSearchEcho(el, text)) return;
              if (looksNoResult(text)) {
                noResultSignals += 1;
                return;
              }
              const childText = Array.from(el.children || []).map(child => normalize(child.innerText || child.textContent || '')).join(' ');
              if (childText.includes(target) && text.length > 180) return;
              const score = resultScoreFor(el, text, childText);
              if (score < 20) return;
              resultMatches.push({ domIndex: index, text: text.slice(0, 260), rect: rect(el), tag: el.tagName.toLowerCase(), className: String(el.className || '').slice(0, 120), score });
            });
          }
          resultMatches.sort((a, b) => (b.score - a.score) || (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));

          const buttons = Array.from(document.querySelectorAll('button,a,[role="button"],.btn,.el-button'))
            .filter(visible)
            .map(el => ({ text: normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 120), rect: rect(el), className: String(el.className || '').slice(0, 120) }))
            .filter(item => /发送|send/i.test(item.text + ' ' + item.className))
            .slice(0, 8);

          const pageText = normalize(document.body ? document.body.innerText || '' : '');
          const noResult = Boolean(noResultSignals && resultMatches.length === 0);
          const url = pageUrl;
          const idInUrl = Boolean(target && url.includes(target));
          const idInBody = false;
          return {
            title: document.title || '',
            url,
            searchInputs,
            chatInputs,
            sendButtons: buttons,
            resultMatches: resultMatches.slice(0, 8),
            noResult,
            noResultSignals,
            idEvidence: { target, idInUrl, idInBody, matched: !noResult && (idInUrl || resultMatches.length > 0) },
            bodyPreview: pageText.slice(0, 3000),
          };
        }""",
        str(target_id or ""),
    ) or {}


def open_interview_search_surface(page, platform: str = "") -> dict:
    token = f"codex_interview_search_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    info = page.evaluate(
        r"""({ token, platform }) => {
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4
              && box.bottom > 0 && box.right > 0
              && box.top < window.innerHeight && box.left < window.innerWidth
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0';
          };
          const rect = el => {
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
          };
          const publicItemFor = (el, score = 0, text = '') => ({
            score,
            text: normalize(text || el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || ''),
            rect: rect(el),
            tag: el.tagName.toLowerCase(),
            className: String(el.className || '').slice(0, 120),
            parentClassName: el.parentElement ? String(el.parentElement.className || '').slice(0, 120) : '',
            grandClassName: el.parentElement && el.parentElement.parentElement ? String(el.parentElement.parentElement.className || '').slice(0, 120) : '',
          });
          if (platform === '51job') {
            const selectors = [
              '.conversation-search input[placeholder*="搜索姓名"]',
              '.conversation-search .search-box',
              '.conversation-search .el-icon-search',
              '.search-box input[placeholder*="搜索姓名"]'
            ];
            let job51Best = null;
            for (const selector of selectors) {
              for (const el of Array.from(document.querySelectorAll(selector))) {
                if (!visible(el)) continue;
                if (el.closest('.eh_side_nav, .eh_side_nav_ul, .eh_menu_item')) continue;
                const box = rect(el);
                const inSearchHeader = box.x >= Math.max(480, window.innerWidth * 0.42)
                  && box.y >= 90 && box.y <= 190;
                if (!inSearchHeader) continue;
                const item = publicItemFor(el, selector.includes('input') ? 300 : 260, '51job_contact_search_input');
                if (selector.includes('conversation-search')) item.score += 40;
                if (!job51Best || item.score > job51Best.score) job51Best = { ...item, el };
              }
              if (job51Best) break;
            }
            if (job51Best) {
              job51Best.el.setAttribute('data-codex-interview-search', token);
              const { el, ...publicItem } = job51Best;
              return { clicked: true, target: publicItem, platform, strategy: '51job_contact_search_input' };
            }
          }
          if (platform === 'zhilian') {
            const modalInput = Array.from(document.querySelectorAll('.im-search-modal input, .im-search-modal__search-input input, input[placeholder*="搜索聊天记录"]'))
              .find(el => visible(el));
            if (modalInput) {
              modalInput.setAttribute('data-codex-interview-search', token);
              return { clicked: true, target: publicItemFor(modalInput, 320, 'zhilian_search_modal_input'), platform, strategy: 'zhilian_search_modal_input' };
            }
            const selectors = [
              '.im-side-panel .side-panel-header__input-button',
              '.side-panel-header__right .side-panel-header__input-button',
              '.side-panel-header__input-button'
            ];
            let zhilianBest = null;
            for (const selector of selectors) {
              for (const el of Array.from(document.querySelectorAll(selector))) {
                if (!visible(el)) continue;
                if (el.closest('.app-menu, .app-menu__body, .app-menu-item')) continue;
                const box = rect(el);
                const inContactHeader = box.x >= 150 && box.x <= Math.min(760, window.innerWidth * 0.65)
                  && box.y >= 55 && box.y <= 160;
                if (!inContactHeader) continue;
                const item = publicItemFor(el, 280, 'zhilian_contact_search_icon');
                if (selector.includes('im-side-panel')) item.score += 40;
                if (!zhilianBest || item.score > zhilianBest.score) zhilianBest = { ...item, el };
              }
              if (zhilianBest) break;
            }
            if (zhilianBest) {
              zhilianBest.el.setAttribute('data-codex-interview-search', token);
              const { el, ...publicItem } = zhilianBest;
              return { clicked: true, target: publicItem, platform, strategy: 'zhilian_contact_search_icon' };
            }
          }
          if (platform === 'boss') {
            const selectors = [
              '.chat-job-search .chat-search-btn',
              '.chat-top-filter .chat-search-btn',
              '.chat-user .chat-search-btn',
              '.chat-container .chat-search-btn',
              '.chat-search-btn'
            ];
            let bossBest = null;
            for (const selector of selectors) {
              for (const el of Array.from(document.querySelectorAll(selector))) {
                if (!visible(el)) continue;
                if (el.closest('.side-wrap, .side-wrap-v2, .menu-list, .menu-geeksearch')) continue;
                const box = rect(el);
                const inContactHeader = box.x >= 190 && box.x <= Math.min(680, window.innerWidth * 0.65)
                  && box.y >= 80 && box.y <= 190;
                if (!inContactHeader) continue;
                const item = publicItemFor(el, 260, 'boss_contact_search_icon');
                if (selector.includes('chat-job-search')) item.score += 40;
                if (selector.includes('chat-top-filter')) item.score += 30;
                if (!bossBest || item.score > bossBest.score) bossBest = { ...item, el };
              }
              if (bossBest) break;
            }
            if (bossBest) {
              bossBest.el.setAttribute('data-codex-interview-search', token);
              const { el, ...publicItem } = bossBest;
              return { clicked: true, target: publicItem, platform, strategy: 'boss_contact_search_icon' };
            }
          }
          const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],li,span,div'));
          let best = null;
          for (const el of nodes) {
            if (!visible(el)) continue;
            const text = normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
            if (!text || text.length > 20) continue;
            let score = 0;
            if (text === '搜索') score += 120;
            else if (/搜索|search/i.test(text)) score += 60;
            if (!score) continue;
            const box = rect(el);
            if (platform === 'boss') {
              if (box.x < 190) continue;
              if (el.closest('.side-wrap, .side-wrap-v2, .menu-list, .menu-geeksearch')) continue;
            } else if (platform === '51job') {
              if (box.x < 220) continue;
              if (el.closest('.eh_side_nav, .eh_side_nav_ul, .eh_menu_item')) continue;
            } else if (platform === 'zhilian') {
              if (box.x < 150) continue;
              if (el.closest('.app-menu, .app-menu__body, .app-menu-item')) continue;
            }
            if (box.y < 120) score += 40;
            if (box.x < 400) score += 15;
            if (/active|selected|current/i.test(String(el.className || ''))) score -= 20;
            const item = publicItemFor(el, score, text);
            if (!best || item.score > best.score) best = { ...item, el };
          }
          if (!best) return { clicked: false, reason: 'search_entry_not_found', platform };
          best.el.setAttribute('data-codex-interview-search', token);
          const { el, ...publicItem } = best;
          return { clicked: true, target: publicItem, platform };
        }""",
        {"token": token, "platform": platform},
    ) or {}
    if not info.get("clicked"):
        return info
    page.locator(f"[data-codex-interview-search='{token}']").first.click(timeout=5000, force=True)
    page.wait_for_timeout(random.randint(900, 1400))
    return info


def ensure_interview_platform_home(page, platform: str = "") -> dict:
    platform = normalize_interview_platform(platform)
    url = str(getattr(page, "url", "") or "")
    target = ""
    if platform == "boss" and "/web/chat/index" not in url:
        target = "https://www.zhipin.com/web/chat/index"
    elif platform == "51job" and "ehire.51job.com/Revision/chat" not in url:
        target = "https://ehire.51job.com/Revision/chat/"
    elif platform == "zhilian" and "rd6.zhaopin.com/app/im" not in url:
        target = "https://rd6.zhaopin.com/app/im"
    if not target:
        return {"navigated": False, "url": url, "platform": platform}
    try:
        page.goto(target, wait_until="domcontentloaded", timeout=20000)
        page.wait_for_timeout(random.randint(1400, 2200))
        return {"navigated": True, "from": url, "to": str(getattr(page, "url", "") or target), "platform": platform}
    except Exception as exc:
        return {"navigated": False, "url": url, "target": target, "platform": platform, "error": str(exc)[:260]}


def fill_interview_search_box(page, search_index: int, target_id: str) -> dict:
    selector = "input:not([type='hidden']), textarea, [contenteditable='true']"
    locator = page.locator(selector).nth(int(search_index))
    locator.click(timeout=5000, force=True)
    page.wait_for_timeout(random.randint(120, 260))
    try:
        locator.fill("", timeout=3000)
        locator.type(str(target_id), delay=random.randint(20, 55), timeout=8000)
    except Exception:
        locator.evaluate(
            """(el, value) => {
              el.focus();
              if ('value' in el) el.value = '';
              else el.textContent = '';
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
              if ('value' in el) el.value = value;
              else el.textContent = value;
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }""",
            str(target_id),
        )
    page.keyboard.press("Enter")
    page.wait_for_timeout(random.randint(1200, 1800))
    return {"filled": True, "searchIndex": int(search_index)}


def click_interview_result_match(page, dom_index: int) -> dict:
    locator = page.locator("body *").nth(int(dom_index))
    info = locator.evaluate(
        """el => {
          const clickable = el.closest('.search-content .searchlist-item,.search-content .conversation-item,.im-search-result,.list-item,.recommend-item,.wrap-item,.batch-chat-item,.conversation-item,.im-session-item,.im-session-item__box') || el;
          clickable.setAttribute('data-codex-interview-result-click', '1');
          const box = clickable.getBoundingClientRect();
          return {
            text: String(clickable.innerText || clickable.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
            className: String(clickable.className || '').slice(0, 120),
            x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height)
          };
        }"""
    )
    page.locator("[data-codex-interview-result-click='1']").first.click(timeout=6000, force=True)
    page.wait_for_timeout(random.randint(1000, 1600))
    return {"clicked": True, "result": info}


def find_interview_wechat_exchange_button(page, platform: str = "") -> dict:
    token = f"codex_interview_wechat_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token, platform }) => {
              const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
              const visible = el => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2
                  && box.bottom > 0 && box.right > 0
                  && box.top < window.innerHeight && box.left < window.innerWidth
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0';
              };
              const rect = el => {
                const box = el.getBoundingClientRect();
                return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
              };
              const cls = el => typeof el.className === 'string' ? el.className : String((el.className && el.className.baseVal) || '');
              const textOf = el => normalize([
                el.innerText,
                el.textContent,
                el.getAttribute('title'),
                el.getAttribute('aria-label')
              ].filter(Boolean).join(' '));
              const metaOf = el => normalize([
                el.tagName,
                el.id,
                cls(el),
                el.getAttribute('role'),
                el.getAttribute('title'),
                el.getAttribute('aria-label'),
                el.getAttribute('data-testid')
              ].filter(Boolean).join(' '));
              const chainText = el => {
                const parts = [];
                let cur = el;
                for (let depth = 0; cur && depth < 5; depth += 1, cur = cur.parentElement) {
                  parts.push(normalize([cur.tagName, cur.id, cls(cur), cur.getAttribute('disabled'), cur.getAttribute('aria-disabled'), cur.innerText || cur.textContent || ''].join(' ')));
                }
                return parts.join(' | ');
              };
              const platformRoots = {
                boss: [
                  '.conversation-operate .operate-exchange-left',
                  '.conversation-operate .toolbar-box-right',
                  '.conversation-operate',
                  '.toolbar-box'
                ],
                '51job': [
                  '.custom-operate',
                  '.chat-operate',
                  '.conversation-operate'
                ],
                zhilian: [
                  '.im-session-detail-footer .session-new-action',
                  '.im-session-detail-footer',
                  '.km-footer'
                ]
              };
              const rootSelectors = platformRoots[platform] || platformRoots.boss;
              let roots = rootSelectors.flatMap(selector => Array.from(document.querySelectorAll(selector))).filter(visible);
              if (!roots.length) roots = [document.body].filter(Boolean);
              const directSelectors = [
                '.exchange-wx-btn',
                '.exchange-wx-wrap',
                '.im-ask-for-wx',
                '.operate-icon-item',
                '.operate-btn',
                'button',
                'a',
                '[role="button"]',
                'span',
                'div'
              ].join(',');
              const exchangeLabel = text => /(^|\s)(换微信|交换微信)(\s|$)/.test(text) || text === '换微信' || text === '交换微信';
              const existingLabel = text => /查看微信|微信号|复制微信号/.test(text);
              const candidates = [];
              const seen = new Set();
              for (const root of roots) {
                for (const node of [root, ...Array.from(root.querySelectorAll(directSelectors))]) {
                  if (!node || seen.has(node) || !visible(node)) continue;
                  seen.add(node);
                  const text = textOf(node);
                  const meta = metaOf(node);
                  const combined = normalize(`${text} ${meta}`);
                  const box = rect(node);
                  let score = 0;
                  let action = '';
                  if (platform === '51job' && /exchange-wx-btn|exchange-wx-wrap/.test(meta)) score += 260;
                  if (platform === 'zhilian' && /im-ask-for-wx/.test(meta)) score += 280;
                  if (platform === 'boss' && /operate-icon-item|operate-btn|operate-exchange-left/.test(meta)) score += 120;
                  if (exchangeLabel(text)) {
                    score += 280;
                    action = 'exchange_request';
                  } else if (/(^|\s)(换微信|交换微信)(\s|$)/.test(combined)) {
                    score += 190;
                    action = 'exchange_request';
                  }
                  if (existingLabel(text)) {
                    score += 180;
                    action = 'already_exchanged';
                  }
                  if (/换电话|打电话|约面试|不合适|求简历|查看附件简历|邀请面试/.test(text) && !/微信/.test(text)) score -= 180;
                  if (box.w > 220 || box.h > 90) score -= 80;
                  if (box.x > window.innerWidth * 0.42 && box.y > window.innerHeight * 0.35) score += 25;
                  if (score < 120) continue;
                  let target = node;
                  if (platform === '51job') {
                    target = node.closest('.exchange-wx-btn') || node.closest('.exchange-wx-wrap') || node.closest('.icon-text-wrap') || node;
                  } else if (platform === 'zhilian') {
                    target = node.closest('.im-ask-for-wx') || node.closest('a,button,[role="button"]') || node;
                  } else {
                    target = node.closest('.operate-icon-item') || node.closest('.operate-btn') || node;
                  }
                  const targetText = textOf(target);
                  const targetMeta = metaOf(target);
                  const targetChain = chainText(target);
                  const disabled = /disabled|unable|forbid|disable|禁用|不可用|已发送|已申请/i.test(targetChain)
                    || target.disabled === true
                    || target.getAttribute('disabled') !== null
                    || target.getAttribute('aria-disabled') === 'true'
                    || window.getComputedStyle(target).pointerEvents === 'none';
                  candidates.push({
                    node,
                    target,
                    action: action || (existingLabel(targetText) ? 'already_exchanged' : 'exchange_request'),
                    label: targetText || text || '换微信',
                    score,
                    disabled,
                    reason: targetChain.slice(0, 260),
                    meta: targetMeta.slice(0, 220),
                    rect: rect(target)
                  });
                }
              }
              candidates.sort((left, right) => (right.score - left.score) || (right.rect.y - left.rect.y) || (right.rect.x - left.rect.x));
              const best = candidates[0] || null;
              if (!best) {
                return {
                  found: false,
                  alreadyExchanged: false,
                  action: '',
                  reason: 'wechat_exchange_button_not_found'
                };
              }
              best.target.setAttribute('data-codex-interview-wechat', token);
              return {
                found: true,
                token,
                action: best.action,
                label: best.label,
                alreadyExchanged: best.action === 'already_exchanged',
                disabled: best.disabled,
                reason: best.reason,
                meta: best.meta,
                rect: best.rect,
                platform
              };
            }""",
            {"token": token, "platform": normalize_interview_platform(platform)},
        )
    except Exception as error:
        return {"found": False, "error": safe_text(str(error), 220)}
    if not isinstance(info, dict):
        return {"found": False}
    if info.get("found"):
        info["locator"] = page.locator(f"[data-codex-interview-wechat='{token}']").first
    return info


def find_interview_wechat_exchange_confirm_button(page, platform: str = "") -> dict:
    token = f"codex_interview_wechat_confirm_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
              const visible = el => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2
                  && box.bottom > 0 && box.right > 0
                  && box.top < window.innerHeight && box.left < window.innerWidth
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0';
              };
              const rect = el => {
                const box = el.getBoundingClientRect();
                return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
              };
              const cls = el => typeof el.className === 'string' ? el.className : String((el.className && el.className.baseVal) || '');
              const textOf = el => normalize([el.innerText, el.textContent, el.getAttribute('title'), el.getAttribute('aria-label')].filter(Boolean).join(' '));
              const metaOf = el => normalize([el.tagName, el.id, cls(el), el.getAttribute('role'), el.getAttribute('title'), el.getAttribute('aria-label')].filter(Boolean).join(' '));
              const containers = Array.from(document.querySelectorAll(
                '.exchange-tooltip,.boss-popup,.dialog,.modal,.tooltip,.popover,.el-popover,.el-dialog,.km-modal,.km-popover,.km-dialog,[class*="popup"],[class*="dialog"],[class*="modal"],[class*="popover"],[class*="tooltip"]'
              )).filter(el => {
                if (!visible(el)) return false;
                const meta = metaOf(el);
                if (/reference|conversation-operate|toolbar-box|operate-exchange|custom-operate|session-new-action|im-session-detail-footer|km-footer/.test(meta)) return false;
                const text = textOf(el);
                const box = rect(el);
                return /微信|交换/.test(text) && box.w <= Math.max(720, window.innerWidth * 0.72) && box.h <= Math.max(520, window.innerHeight * 0.78);
              });
              const labels = ['确定', '确认', '发送', '发起交换', '申请交换', '交换微信', '换微信', '确认发送'];
              const positiveLabel = value => /确定|确认|发送|发起交换|申请交换|确认发送/.test(value);
              const negativeLabel = value => /取消|关闭|稍后|再想想/.test(value);
              let best = null;
              let bestScore = -9999;
              for (const container of containers) {
                const containerText = textOf(container);
                const buttons = Array.from(container.querySelectorAll('button,a,[role="button"],.boss-btn,.el-button,.km-button,span,div')).filter(visible);
                for (const node of buttons) {
                  const label = textOf(node);
                  const box = rect(node);
                  const exact = labels.includes(label);
                  const positive = positiveLabel(label);
                  const negative = negativeLabel(label);
                  if (!exact && !positive) continue;
                  if (negative && !positive) continue;
                  if (negative && box.w > 220) continue;
                  let score = 100;
                  const meta = metaOf(node);
                  if (exact) score += 80;
                  if (positive) score += 35;
                  if (/确定与对方交换微信|是否.{0,12}交换微信/.test(label) && !exact) score -= 120;
                  if (/primary|boss-btn|el-button|km-button|button|btn/i.test(meta)) score += 80;
                  if (box.w >= 36 && box.w <= 180 && box.h >= 20 && box.h <= 70) score += 35;
                  if (box.w > 220 || box.h > 110) score -= 90;
                  if (box.x > window.innerWidth * 0.35) score += 12;
                  if (box.x > rect(container).x + rect(container).w * 0.45) score += 25;
                  if (label === '确定' || label === '确认') score += 20;
                  if (score > bestScore) {
                    bestScore = score;
                    best = { node, label, containerText, meta, rect: box };
                  }
                }
              }
              if (!best) return { found: false, containers: containers.map(el => textOf(el).slice(0, 180)).slice(0, 3) };
              best.node.setAttribute('data-codex-interview-wechat-confirm', token);
              return {
                found: true,
                token,
                label: best.label,
                reason: best.containerText.slice(0, 240),
                meta: best.meta.slice(0, 160),
                rect: best.rect
              };
            }""",
            {"token": token, "platform": normalize_interview_platform(platform)},
        )
    except Exception as error:
        return {"found": False, "error": safe_text(str(error), 220)}
    if not isinstance(info, dict):
        return {"found": False}
    if info.get("found"):
        info["locator"] = page.locator(f"[data-codex-interview-wechat-confirm='{token}']").first
    return info


def inspect_interview_wechat_exchange_state(page, platform: str = "") -> dict:
    try:
        return page.evaluate(
            r"""platform => {
              const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
              const text = normalize(document.body ? document.body.innerText || '' : '');
              const confirmVisible = /确定与对方交换微信|是否.{0,12}交换微信|确认.{0,12}交换微信/.test(text);
              const alreadyExchanged = /对方已同意交换微信|已同意交换微信|微信号[:：]|复制微信号|查看微信/.test(text);
              const requestVisible = /我想.{0,12}交换微信|交换微信.{0,18}方便沟通|等待.{0,12}同意|已.{0,8}申请.{0,8}微信|已.{0,8}发起.{0,8}微信|请求.{0,8}交换微信.{0,8}已发送|交换微信.{0,8}请求.{0,8}已发送|已.{0,8}发送.{0,8}交换微信/.test(text);
              const actionStillAvailable = /换微信|交换微信/.test(text);
              return {
                platform,
                alreadyExchanged,
                requestVisible,
                confirmVisible,
                actionStillAvailable,
                summary: text.slice(Math.max(0, text.length - 500))
              };
            }""",
            normalize_interview_platform(platform),
        ) or {}
    except Exception as error:
        return {"alreadyExchanged": False, "requestVisible": False, "error": safe_text(str(error), 220)}


def wait_for_interview_wechat_exchange_confirm_button(page, platform: str = "", attempts: int = 8) -> dict:
    button: dict = {"found": False}
    for _ in range(max(1, int(attempts))):
        button = find_interview_wechat_exchange_confirm_button(page, platform)
        if isinstance(button, dict) and button.get("found"):
            return button
        try:
            page.wait_for_timeout(random.randint(220, 420))
        except Exception:
            break
    return button if isinstance(button, dict) else {"found": False}


def click_interview_wechat_exchange(terminal: BrowserTerminal, platform: str = "", candidate_label: str = "") -> dict:
    page = terminal.current_page()
    button = find_interview_wechat_exchange_button(page, platform)
    cleaned_button = {k: v for k, v in button.items() if k != "locator"} if isinstance(button, dict) else {"found": False}
    if bool(cleaned_button.get("alreadyExchanged")) and cleaned_button.get("action") == "already_exchanged":
        return {
            "ok": True,
            "sent": True,
            "verified": True,
            "alreadyExchanged": True,
            "reason": "wechat_exchange_already_available",
            "message": "候选人已交换微信，无需重复发起",
            "button": cleaned_button,
        }
    if not isinstance(button, dict) or not button.get("found"):
        return {
            "ok": False,
            "blocked": True,
            "sent": False,
            "verified": False,
            "reason": cleaned_button.get("reason") or "wechat_exchange_button_not_found",
            "message": "已确认候选人，但未找到可点击的换微信按钮",
            "button": cleaned_button,
        }
    if button.get("disabled"):
        return {
            "ok": False,
            "blocked": True,
            "sent": False,
            "verified": False,
            "reason": "wechat_exchange_button_disabled",
            "message": "换微信按钮不可用，未点击",
            "button": cleaned_button,
        }
    locator = button.get("locator")
    if locator is None:
        return {
            "ok": False,
            "blocked": True,
            "sent": False,
            "verified": False,
            "reason": "wechat_exchange_locator_missing",
            "message": "换微信按钮定位缺少 locator，未点击",
            "button": cleaned_button,
        }
    click_error = ""
    clicked = False
    try:
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            humanized_precise_button_click(terminal, locator, force=True)
        else:
            locator.click(timeout=6000, force=True)
        clicked = True
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        page.wait_for_timeout(random.randint(650, 1050))
    except Exception as error:
        click_error = safe_text(str(error), 240)
        try:
            locator.click(timeout=5000, force=True)
            clicked = True
            page.wait_for_timeout(random.randint(550, 900))
        except Exception as fallback_error:
            click_error = safe_text(f"{click_error}; fallback={fallback_error}", 260)
    if not clicked:
        return {
            "ok": False,
            "blocked": True,
            "sent": False,
            "verified": False,
            "reason": "wechat_exchange_click_failed",
            "message": "点击换微信失败",
            "button": cleaned_button,
            "error": click_error,
        }

    confirm = wait_for_interview_wechat_exchange_confirm_button(page, platform, attempts=6)
    confirm_clicked = False
    confirm_error = ""
    if isinstance(confirm, dict) and confirm.get("found"):
        confirm_locator = confirm.get("locator")
        try:
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                humanized_precise_button_click(terminal, confirm_locator, force=True)
            else:
                confirm_locator.click(timeout=6000, force=True)
            confirm_clicked = True
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(900, 1400))
        except Exception as error:
            confirm_error = safe_text(str(error), 240)
            try:
                confirm_locator.click(timeout=5000, force=True)
                confirm_clicked = True
                page.wait_for_timeout(random.randint(700, 1100))
            except Exception as fallback_error:
                confirm_error = safe_text(f"{confirm_error}; fallback={fallback_error}", 260)

    state = inspect_interview_wechat_exchange_state(page, platform)
    verified = (not state.get("confirmVisible")) and bool(state.get("alreadyExchanged") or state.get("requestVisible"))
    if state.get("confirmVisible"):
        return {
            "ok": False,
            "blocked": True,
            "sent": False,
            "verified": False,
            "reason": "wechat_exchange_confirm_required",
            "message": "换微信确认弹窗仍存在，未完成确认发送",
            "button": cleaned_button,
            "confirm": {k: v for k, v in confirm.items() if k != "locator"} if isinstance(confirm, dict) else {"found": False},
            "confirmClicked": confirm_clicked,
            "state": state,
            "error": confirm_error,
        }
    if not verified and isinstance(confirm, dict) and confirm.get("found") and not confirm_clicked:
        return {
            "ok": False,
            "blocked": True,
            "sent": False,
            "verified": False,
            "reason": "wechat_exchange_confirm_failed",
            "message": "换微信确认弹窗点击失败",
            "button": cleaned_button,
            "confirm": {k: v for k, v in confirm.items() if k != "locator"},
            "state": state,
            "error": confirm_error,
        }
    return {
        "ok": verified,
        "blocked": not verified,
        "sent": verified,
        "verified": verified,
        "candidate": safe_text(candidate_label, 120),
        "reason": "" if verified else "wechat_exchange_verification_failed",
        "message": "已点击换微信并校验到交换请求/微信状态" if verified else "已点击换微信，但未校验到交换请求或微信状态",
        "button": cleaned_button,
        "confirm": {k: v for k, v in confirm.items() if k != "locator"} if isinstance(confirm, dict) else {"found": False},
        "confirmClicked": confirm_clicked,
        "state": state,
    }


def service_interview_invite(self, payload: dict) -> dict:
    payload = payload if isinstance(payload, dict) else {}
    platform = normalize_interview_platform(payload.get("platform") or payload.get("sourceKey") or "")
    platform_contact = payload.get("platformContact") if isinstance(payload.get("platformContact"), dict) else {}
    search_name = safe_text(str(payload.get("searchName") or platform_contact.get("displayName") or "").strip(), 180)
    applied_position = safe_text(str(payload.get("appliedPosition") or platform_contact.get("appliedPosition") or "").strip(), 120)
    chat_evidence = normalize_interview_chat_evidence(platform_contact.get("chatEvidence") or payload.get("chatEvidence") or [])
    dry_run = bool(payload.get("dryRun"))
    if not search_name:
        return {"ok": False, "blocked": True, "reason": "missing_platform_display_name", "message": "缺少平台联系人显示名，未执行搜索"}

    def run_with_terminal(terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        home = ensure_interview_platform_home(page, platform)
        page = terminal.current_page()
        if platform == "51job":
            self.job51_dismiss_interruptions(terminal, reason="interview_invite_probe")
        elif platform == "zhilian":
            self.zhilian_dismiss_interruptions(terminal, reason="interview_invite_probe")

        before = interview_page_probe(page, search_name)
        search_inputs = before.get("searchInputs") if isinstance(before, dict) else []
        opened_search = {}
        if not search_inputs:
            opened_search = open_interview_search_surface(page, platform)
            before = interview_page_probe(page, search_name)
            search_inputs = before.get("searchInputs") if isinstance(before, dict) else []
        if not search_inputs:
            return {
                "ok": False,
                "blocked": True,
                "reason": "search_input_not_found",
                "message": f"{platform} 未找到可用搜索栏",
                "platform": platform,
                "home": home,
                "openedSearch": opened_search,
                "before": before,
            }

        search = fill_interview_search_box(page, int(search_inputs[0].get("index") or 0), search_name)
        after_search = interview_page_probe(page, search_name)
        result_matches = after_search.get("resultMatches") if isinstance(after_search, dict) else []
        if isinstance(after_search, dict) and after_search.get("noResult"):
            result_matches = []
        clicked = {}
        if result_matches:
            clicked = click_interview_result_match(page, int(result_matches[0].get("domIndex") or 0))
        final = interview_page_probe(page, search_name)
        for _ in range(3):
            if (final.get("chatInputs") if isinstance(final, dict) else []) or not clicked:
                break
            page.wait_for_timeout(random.randint(900, 1300))
            final = interview_page_probe(page, search_name)
        verification = verify_interview_contact_match(
            final,
            search_name,
            applied_position=applied_position,
            chat_evidence=chat_evidence,
            result_matches=result_matches,
            clicked=clicked,
        )
        contact_verified = bool(verification.get("verified"))
        chat_inputs = final.get("chatInputs") if isinstance(final, dict) else []
        send_buttons = final.get("sendButtons") if isinstance(final, dict) else []
        wechat_exchange = find_interview_wechat_exchange_button(page, platform) if contact_verified else {"found": False}
        wechat_exchange_public = {k: v for k, v in wechat_exchange.items() if k != "locator"} if isinstance(wechat_exchange, dict) else {"found": False}
        wechat_exchange_ready = bool(
            isinstance(wechat_exchange, dict)
            and (wechat_exchange.get("found") or wechat_exchange.get("alreadyExchanged"))
        )
        base = {
            "ok": bool(contact_verified and wechat_exchange_ready),
            "platform": platform,
            "searchName": search_name,
            "platformContact": {
                "displayName": search_name,
                "label": safe_text(str(platform_contact.get("label") or ""), 180),
                "appliedPosition": applied_position,
                "capturedAt": safe_text(str(platform_contact.get("capturedAt") or ""), 40),
                "chatEvidence": chat_evidence,
            },
            "dryRun": dry_run,
            "contactVerified": contact_verified,
            "verification": verification,
            "inputReady": bool(chat_inputs),
            "sendButtonReady": bool(send_buttons),
            "wechatExchangeReady": wechat_exchange_ready,
            "wechatExchange": wechat_exchange_public,
            "message": "约面试 dry-run 已定位到候选人换微信按钮" if dry_run else "约面试候选人已定位，准备点击换微信",
            "home": home,
            "openedSearch": opened_search,
            "search": search,
            "clicked": clicked,
            "before": before,
            "afterSearch": after_search,
            "final": final,
        }
        if dry_run:
            if not contact_verified:
                reason = str(verification.get("reason") or "chat_evidence_not_matched")
                message_map = {
                    "search_result_not_found": "已搜索但未找到可确认的目标联系人",
                    "multiple_candidates_unverified": "搜索结果存在多个同名联系人，未能用岗位或聊天证据确认",
                    "chat_evidence_not_matched": "已搜索但未能匹配岗位或聊天证据，停止发送",
                    "contact_not_verified": "未能确认当前会话是目标联系人",
                }
                base.update({"ok": False, "blocked": True, "reason": reason, "message": message_map.get(reason, "未能确认当前会话是目标联系人")})
            elif not result_matches and not clicked and not chat_inputs:
                base.update({"ok": False, "blocked": True, "reason": "search_result_not_found", "message": "已搜索但未找到可点击的目标联系人"})
            elif not wechat_exchange_ready:
                base.update({
                    "ok": False,
                    "blocked": True,
                    "reason": wechat_exchange_public.get("reason") or "wechat_exchange_button_not_found",
                    "message": "已确认目标联系人，但未找到可点击的换微信按钮",
                })
            return base
        if not contact_verified:
            reason = str(verification.get("reason") or "chat_evidence_not_matched")
            message_map = {
                "search_result_not_found": "搜索后未找到可确认的目标联系人，未发送",
                "multiple_candidates_unverified": "搜索结果存在多个同名联系人，未能用岗位或聊天证据确认，未发送",
                "chat_evidence_not_matched": "未能匹配岗位或聊天证据，未发送",
                "contact_not_verified": "未能确认当前会话是目标联系人，未发送",
            }
            base.update({"ok": False, "blocked": True, "reason": reason, "message": message_map.get(reason, "未能确认当前会话是目标联系人，未发送")})
            return base
        if not wechat_exchange_ready:
            base.update({
                "ok": False,
                "blocked": True,
                "reason": wechat_exchange_public.get("reason") or "wechat_exchange_button_not_found",
                "message": "已确认目标联系人，但未找到可点击的换微信按钮，未发起约面试",
            })
            return base

        if INTERVIEW_INVITE_SEND_DISABLED_FOR_TESTING:
            base.update({
                "ok": False,
                "blocked": True,
                "sent": False,
                "sendDisabledForTesting": True,
                "reason": "interview_send_disabled_for_testing",
                "message": "约面试测试保护已开启：已定位候选人和换微信按钮，但不会点击换微信",
            })
            return base

        exchange = click_interview_wechat_exchange(terminal, platform, candidate_label=search_name)
        exchange_verified = bool(exchange.get("verified") or exchange.get("sent"))
        if not exchange_verified:
            base.update({
                "ok": False,
                "sent": False,
                "verified": False,
                "wechatVerified": False,
                "wechatExchange": exchange,
                "followupMessage": INTERVIEW_INVITE_FOLLOWUP_MESSAGE,
                "message": exchange.get("message") or "已点击换微信，但未校验到交换请求",
                "blocked": True,
            })
            return base

        fill_followup: dict = {}
        if platform == "zhilian":
            followup_send = self.zhilian_send_message_with_verification(terminal, INTERVIEW_INVITE_FOLLOWUP_MESSAGE)
            fill_followup = followup_send.get("input") if isinstance(followup_send.get("input"), dict) else {}
            zhilian_verify = followup_send.get("verify") if isinstance(followup_send.get("verify"), dict) else {}
            followup_verified = bool(
                isinstance(followup_send, dict)
                and (
                    followup_send.get("verified")
                    or followup_send.get("sent")
                    or zhilian_verify.get("verified")
                )
            )
            followup_send = {
                **followup_send,
                "verification": {**zhilian_verify, "verified": followup_verified},
                "send": followup_send.get("send") if isinstance(followup_send.get("send"), dict) else {},
                "platformSendStrategy": "zhilian_send_message_with_verification",
            }
        else:
            try:
                self.smart_fill(terminal, "聊天", INTERVIEW_INVITE_FOLLOWUP_MESSAGE)
                page.wait_for_timeout(random.randint(260, 520))
                fill_followup = {"ok": True}
            except Exception as error:
                fill_followup = {"ok": False, "error": safe_text(str(error), 220)}
            followup_send = self.send_current_chat_reply_with_verification(
                terminal,
                INTERVIEW_INVITE_FOLLOWUP_MESSAGE,
                max_attempts=2,
            )
            followup_verified = bool(
                isinstance(followup_send, dict)
                and isinstance(followup_send.get("verification"), dict)
                and followup_send["verification"].get("verified")
            )
        base.update({
            "ok": followup_verified,
            "sent": followup_verified,
            "verified": followup_verified,
            "wechatVerified": True,
            "wechatExchange": exchange,
            "followupMessage": INTERVIEW_INVITE_FOLLOWUP_MESSAGE,
            "followupFill": fill_followup,
            "followupSend": followup_send,
            "message": "已完成换微信并发送加我微信沟通" if followup_verified else "已完成换微信，但加我微信沟通发送失败",
            "reason": "" if followup_verified else "interview_followup_send_failed",
            "blocked": not followup_verified,
        })
        return base

    if platform == "51job":
        return self.with_job51_terminal(run_with_terminal, timeout_seconds=120)
    if platform == "zhilian":
        return self.with_zhilian_terminal(run_with_terminal)
    with self.lock:
        return run_with_terminal(self.get_terminal())


WebAgentService.interview_invite = service_interview_invite


ORIGINAL_AGENT_DO_POST_FOR_INTERVIEW = AgentRequestHandler.do_POST


def patched_agent_do_post_for_interview(self) -> None:
    path = unquote(urlparse(self.path).path)
    if path in {"/api/interview-invite", "/api/interview-invite/probe", "/api/51job/interview-invite", "/api/zhilian/interview-invite"}:
        try:
            payload = self.read_json()
            if path.startswith("/api/51job/"):
                payload["platform"] = "51job"
            elif path.startswith("/api/zhilian/"):
                payload["platform"] = "zhilian"
            if path.endswith("/probe"):
                payload["dryRun"] = True
            result = SERVICE.interview_invite(payload)
            self.send_json(result, status=200 if result.get("ok") or result.get("blocked") else 500)
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=500)
        finally:
            SERVICE.close_current_thread_terminal()
        return
    return ORIGINAL_AGENT_DO_POST_FOR_INTERVIEW(self)


AgentRequestHandler.do_POST = patched_agent_do_post_for_interview


SERVICE = WebAgentService()
atexit.register(SERVICE.close)


def main() -> int:
    WEB_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), AgentRequestHandler)
    print(f"网页端智能顾问已启动：http://{HOST}:{PORT}（{AGENT_ACCOUNT_NAME} / {AGENT_ACCOUNT_ID}）")
    print(f"保持 CloakBrowser CDP 开启：{AGENT_CDP_URL}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        SERVICE.close()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

