
def apply_basic_waiting_state_to_screening(screening: dict, previous_state: dict, context: dict) -> dict:
    if not isinstance(screening, dict):
        screening = {}
    if not isinstance(previous_state, dict):
        previous_state = {}
    if previous_state.get("status") not in {
        "basic_conditions_sent_waiting",
        "basic_conditions_waiting",
        "knowledge_answered_waiting",
        "knowledge_silent_skipped",
    }:
        return screening
    if screening.get("status") != "not_asked":
        return screening

    last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    if last_message.get("sender") == "other" and str(last_other.get("text") or "").strip():
        judgement = classify_basic_condition_acceptance(str(last_other.get("text") or ""))
        return {
            "status": judgement.get("status", "unclear"),
            "reason": "waiting_state_new_candidate_reply:" + str(judgement.get("reason") or ""),
            "confidence": judgement.get("confidence"),
            "basicMessage": previous_state,
            "lastOther": last_other,
            "judgement": judgement,
            "state": previous_state,
            "decisionBasis": build_screening_decision_basis(
                str(judgement.get("status", "unclear")),
                "waiting_state_new_candidate_reply:" + str(judgement.get("reason") or ""),
                basic_message=previous_state,
                last_other=last_other,
                other_messages=[last_other],
                judgement=judgement,
                decision_message=last_other,
            ),
        }

    return {
        "status": "waiting",
        "reason": "basic_conditions_sent_waiting_state",
        "state": previous_state,
        "decisionBasis": build_screening_decision_basis(
            "waiting",
            "basic_conditions_sent_waiting_state",
            basic_message=previous_state,
            other_messages=[],
        ),
    }


def is_recruiter_resume_request_task(message: str) -> bool:
    text = str(message or "")
    lowered = text.lower()
    if not looks_like_recruiter_resume_request(text):
        return False
    if any(word in text for word in ("我的简历", "把我简历", "把我的简历", "我简历")):
        return False
    target_terms = ("没有回", "没回", "未回复", "未读", "新消息", "待处理", "候选人", "牛人", "下一个", "没回复")
    if any(term in text for term in target_terms) or "recruiter" in lowered:
        return True
    # On the recruiter-side BOSS chat page, a bare "求简历" should still use the
    # specialized toolbar flow instead of letting the model invent a click target.
    return "求简历" in text


def looks_like_recruiter_resume_request(message: str) -> bool:
    text = str(message or "")
    lowered = text.lower()
    if any(word in text for word in ("我的简历", "把我简历", "把我的简历", "我简历")):
        return False
    resume_terms = ("求简历", "要简历", "索要简历", "简历请求", "获取简历")
    ask_terms = ("让", "叫", "让他", "让她", "让候选人", "牛人", "候选人")
    if any(term in text for term in resume_terms):
        return True
    if "求" in text and "简历" in text:
        return True
    if re.search(r"(求|要|索要)[\u4e00-\u9fffA-Za-z0-9·._-]{2,16}(的)?简历", text):
        return True
    if "resume" in lowered and any(term in lowered for term in ("request", "ask", "candidate", "recruiter")):
        return True
    return "简历" in text and any(term in text for term in ask_terms)


def is_recruiter_proactive_contact_task(message: str) -> bool:
    text = str(message or "")
    compact = re.sub(r"\s+", "", text)
    lowered = compact.lower()
    if any(term in compact for term in ("推荐牛人", "主动联系", "主动打招呼", "批量打招呼", "打招呼")):
        return any(term in compact for term in ("推荐", "牛人", "主动", "应用技术", "应用技术经理"))
    return "proactive" in lowered and any(term in lowered for term in ("contact", "greet", "recommend"))


def is_recruiter_unsuitable_task(message: str) -> bool:
    text = str(message or "")
    compact = re.sub(r"\s+", "", text)
    lowered = compact.lower()
    if any(term in compact for term in ("求简历", "要简历", "发简历", "发送简历")):
        return False
    unsuitable_terms = ("不合适", "不匹配", "淘汰", "拒绝候选人", "标记不合适", "设为不合适", "点不合适")
    if any(term in compact for term in unsuitable_terms):
        return True
    return "unsuitable" in lowered or "notfit" in lowered or "not_fit" in lowered


def extract_recruiter_unsuitable_candidate_name(message: str) -> str:
    text = re.sub(r"\s+", "", str(message or ""))
    if not text or not is_recruiter_unsuitable_task(text):
        return ""
    patterns = (
        r"(?:把|将|给|对|向|找|打开|联系|让|叫)(?P<name>[\u4e00-\u9fffA-Za-z0-9·._-]{2,16}?)(?:标记为|设为|判为|点击|点)?(?:不合适|不匹配|淘汰|拒绝)",
        r"(?P<name>[\u4e00-\u9fffA-Za-z0-9·._-]{2,16}?)(?:标记为|设为|判为|点击|点)?(?:不合适|不匹配|淘汰)",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            name = clean_recruiter_candidate_name(match.group("name"))
            if name:
                return name
    return ""


def clean_recruiter_candidate_name(value: str) -> str:
    text = re.sub(r"\s+", "", str(value or ""))
    text = text.strip("，,。.;；:：、!！?？'\"“”‘’（）()【】[]<>《》")
    text = re.sub(r"^(请|麻烦|帮我|帮忙|可以|能不能|再|把|再把|给|对|向|找|打开|联系|让|叫|候选人|牛人)+", "", text)
    text = re.sub(r"(候选人|牛人|这个人|那个人|这位|这名)$", "", text)
    text = re.sub(r"(标记为|设为|判为|点击|点)$", "", text)
    generic_terms = (
        "没有回", "没回", "未回复", "未读", "新消息", "待处理", "下一个",
        "未处理", "没处理", "待回复", "待沟通", "消息", "最近", "进行",
        "当前", "这个", "那个", "对方", "全部", "列表", "会话",
        "刚刚", "前三", "前两", "前二", "三个", "两个人", "三个人",
        "几个人", "几个", "一批", "批量", "条", "人",
    )
    if not text or any(term in text for term in generic_terms):
        return ""
    if len(text) < 2 or len(text) > 16:
        return ""
    return text


def extract_recruiter_request_candidate_name(message: str) -> str:
    names = extract_recruiter_request_candidate_names(message)
    if names:
        return names[0]
    text = re.sub(r"\s+", "", str(message or ""))
    if not text or not looks_like_recruiter_resume_request(text):
        return ""
    patterns = (
        r"(?:对|给|向|找|打开|联系|让|叫)(?P<name>[\u4e00-\u9fffA-Za-z0-9·._-]{2,16})(?:求简历|要简历|索要简历|发简历|发送简历|简历请求)",
        r"(?P<name>[\u4e00-\u9fffA-Za-z0-9·._-]{2,16})(?:求简历|要简历|索要简历|简历请求)",
        r"(?:求|要|索要)(?P<name>[\u4e00-\u9fffA-Za-z0-9·._-]{2,16})(?:的)?简历",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            name = clean_recruiter_candidate_name(match.group("name"))
            if name:
                return name
    return ""


def extract_recruiter_candidate_names_from_text(value: str) -> list[str]:
    text = re.sub(r"\s+", "", str(value or ""))
    if not text:
        return []
    text = re.sub(r"^(请|麻烦|帮我|帮忙|可以|能不能|对|给|向|找|打开|联系|让|叫)+", "", text)
    text = re.sub(r"(求简历|要简历|索要简历|发简历|发送简历|简历请求|获取简历).*$", "", text)
    parts = re.split(r"[，,、/|；;]+|(?:和|及|以及|还有)", text)
    names: list[str] = []
    for part in parts:
        part = re.sub(r"的$", "", str(part or ""))
        name = clean_recruiter_candidate_name(part)
        if name and name not in names:
            names.append(name)
    return names


def extract_recruiter_request_candidate_names(message: str) -> list[str]:
    text = re.sub(r"\s+", "", str(message or ""))
    if not text or not looks_like_recruiter_resume_request(text):
        return []
    patterns = (
        r"(?:对|给|向|找|打开|联系|让|叫)(?P<names>[\u4e00-\u9fffA-Za-z0-9·._,，、/|；;和及以及还有-]{2,80}?)(?:求简历|要简历|索要简历|发简历|发送简历|简历请求|获取简历)",
        r"(?:求|要|索要)(?P<names>[\u4e00-\u9fffA-Za-z0-9·._,，、/|；;和及以及还有-]{2,80}?)(?:的)?简历",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        names = extract_recruiter_candidate_names_from_text(match.group("names"))
        if names:
            return names
    return []


def extract_recruiter_batch_count(message: str) -> int:
    text = re.sub(r"\s+", "", str(message or ""))
    if not text or not looks_like_recruiter_resume_request(text):
        return 1
    if re.search(r"(?:下一个|当前|这个|那个)", text) and not re.search(r"\d|[一二两三四五六七八九十]", text):
        return 1
    match = re.search(r"(?:前|先|连续|批量|处理|对)?(\d{1,2})(?:个|位|人|条)?", text)
    if match:
        value = int(match.group(1))
        return max(1, min(30, value))
    cn_map = {
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
    }
    match = re.search(r"(?:前|先|连续|批量|处理|对)?([一二两三四五六七八九十])(?:个|位|人|条)", text)
    if match:
        return cn_map.get(match.group(1), 1)
    return 1


def extract_recruiter_screen_batch_count(message: str) -> int:
    text = re.sub(r"\s+", "", str(message or ""))
    if not text:
        return 5
    if any(term in text for term in (
        "当前联系人", "当前候选人", "当前会话", "当前聊天框",
        "这个联系人", "这个候选人", "这个会话", "这个聊天框",
        "刚刚联系人", "刚刚的联系人", "刚才联系人", "刚才的联系人",
    )):
        return 1
    match = re.search(r"(\d{1,2})(?:个|人|条|位|份)?", text)
    if match:
        return max(1, min(30, int(match.group(1))))
    cn_values = {
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
        "十五": 15,
        "二十": 20,
    }
    for key, value in sorted(cn_values.items(), key=lambda item: len(item[0]), reverse=True):
        if key in text:
            return max(1, min(30, value))
    if any(term in text for term in ("所有", "全部", "all")):
        return 30
    return 5


def candidate_label_matches(label: str, candidate_name: str) -> bool:
    name = clean_recruiter_candidate_name(candidate_name)
    if not name:
        return False
    compact_label = re.sub(r"\s+", "", str(label or ""))
    compact_label = re.sub(r"^\d+", "", compact_label)
    compact_label = re.sub(r"^\d{1,2}:\d{2}", "", compact_label)
    return name in compact_label


def recruiter_candidate_name_key(value: str) -> str:
    name = clean_recruiter_candidate_name(value) or recruiter_candidate_name_from_label(value) or str(value or "")
    return re.sub(r"[^\u4e00-\u9fffA-Za-z0-9·._-]+", "", name).lower()


def recruiter_candidate_names_match(left: str, right: str) -> bool:
    left_key = recruiter_candidate_name_key(left)
    right_key = recruiter_candidate_name_key(right)
    if not left_key or not right_key:
        return False
    if left_key == right_key:
        return True
    return len(left_key) >= 2 and len(right_key) >= 2 and (left_key in right_key or right_key in left_key)


def clean_applied_position(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = text.strip("，,。.;；:：、|/\\-—_()（）[]【】")
    if not text:
        return ""
    blocked = {"全部职位", "职位", "岗位", "全部", "未读", "新招呼", "仅沟通", "更多"}
    if text in blocked:
        return ""
    text = re.split(r"\s+(?:您好|你好|BOSS|Boss|HR|Hr|[^\s]+\.pdf)\b", text, maxsplit=1)[0].strip()
    return safe_text(text, 80)


def normalize_candidate_label(label: str) -> str:
    value = re.sub(r"\s+", " ", str(label or "")).strip()
    value = re.sub(r"^\d{1,3}\s+(?=\S)", "", value)
    value = re.sub(r"^\d{1,2}:\d{2}\s*", "", value)
    return safe_text(value, 80)


def compact_conversation_label(label: str) -> str:
    value = re.sub(r"\s+", " ", str(label or "")).strip()
    value = re.sub(r"^\d{1,3}\s+(?=\S)", "", value)
    value = re.sub(r"^\d{1,2}:\d{2}\s*", "", value)
    value = re.sub(r"\s+", "", value)
    value = re.sub(r"(已读|未读|草稿|新消息|对方正在输入)", "", value)
    return value[:160]


def recruiter_candidate_name_from_label(label: str) -> str:
    normalized = normalize_candidate_label(label)
    if not normalized:
        return ""
    first = re.split(r"\s+", normalized, maxsplit=1)[0].strip()
    first = re.sub(r"^\d{1,3}", "", first)
    first = re.sub(r"^\d{1,2}:\d{2}", "", first)
    first = first.strip("：:，,。.;；-—()（）[]【】")
    if re.fullmatch(r"[\u4e00-\u9fffA-Za-z·._-]{2,16}", first or ""):
        if first not in {"AI应用开发实习生", "全部职位", "未读", "职位", "候选人"}:
            return first
    compact = compact_conversation_label(label)
    match = re.match(r"([\u4e00-\u9fffA-Za-z·]{2,8})", compact)
    if match:
        value = match.group(1)
        if value not in {"AI应用", "全部职位", "候选人"}:
            return value
    return ""


def build_recruiter_candidate_identity(
    context: dict | None,
    candidate_label: str = "",
    conversation_key: str = "",
) -> dict:
    context = context if isinstance(context, dict) else {}
    applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
    platform = safe_text(str(context.get("platform") or applicant.get("platform") or ""), 30).strip()
    url = str(context.get("url") or "")
    if not platform:
        if "51job.com" in url:
            platform = "51job"
        elif "zhaopin.com" in url:
            platform = "zhilian"
        else:
            platform = "boss"
    label = safe_text(str(candidate_label or applicant.get("label") or ""), 220)
    name = safe_text(str(applicant.get("name") or recruiter_candidate_name_from_label(label)), 60)
    applied_position = safe_text(str(applicant.get("appliedPosition") or context.get("appliedPosition") or ""), 100)
    last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    last_message_signature = chat_message_signature(last_message) if last_message else ""
    last_other_signature = chat_message_signature(last_other) if last_other else ""
    label_fingerprint = stable_digest(compact_conversation_label(label), 18) if label else ""
    recent_fingerprint = stable_digest(str(context.get("recentText") or "")[-600:], 18) if context.get("recentText") else ""
    source_parts = [
        platform,
        str(conversation_key or context.get("conversationKey") or ""),
        name,
        applied_position,
        label_fingerprint,
        last_message_signature,
        recent_fingerprint,
    ]
    identity_key = stable_digest("|".join(part for part in source_parts if part), 24)
    return {
        "platform": platform,
        "identityKey": identity_key,
        "conversationKey": safe_text(str(conversation_key or context.get("conversationKey") or ""), 80),
        "candidateName": name,
        "appliedPosition": applied_position,
        "listLabel": label,
        "labelFingerprint": label_fingerprint,
        "lastMessageSignature": last_message_signature,
        "lastOtherSignature": last_other_signature,
        "recentFingerprint": recent_fingerprint,
    }


def recruiter_basic_candidate_state_key(label: str, identity: dict | None = None) -> str:
    identity = identity if isinstance(identity, dict) else {}
    if identity.get("identityKey"):
        return "recruiter_basic_" + str(identity.get("identityKey"))
    compact = compact_conversation_label(label)
    if not compact:
        return ""
    name_match = re.match(r"([\u4e00-\u9fffA-Za-z·]{2,8})", compact)
    basis = f"{recruiter_candidate_name_from_label(label)}|{compact[:120]}"
    return "recruiter_basic_" + stable_digest(basis, 20)


def build_recruiter_watch_item(candidate_label: str, context: dict, identity: dict | None = None) -> dict:
    identity = identity if isinstance(identity, dict) else build_recruiter_candidate_identity(context, candidate_label)
    last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    return {
        "candidateLabel": safe_text(str(candidate_label or identity.get("listLabel") or ""), 220),
        "candidateName": safe_text(str(identity.get("candidateName") or recruiter_candidate_name_from_label(candidate_label)), 60),
        "appliedPosition": safe_text(str(identity.get("appliedPosition") or context.get("appliedPosition") or ""), 100),
        "identityKey": safe_text(str(identity.get("identityKey") or ""), 80),
        "conversationKey": safe_text(str(identity.get("conversationKey") or context.get("conversationKey") or ""), 80),
        "candidateIdentity": identity,
        "compactLabel": compact_conversation_label(str(candidate_label or identity.get("listLabel") or "")),
        "lastMessageSignature": chat_message_signature(last_message) if last_message else "",
        "lastOtherSignature": chat_message_signature(last_other) if last_other else "",
        "lastSender": str(last_message.get("sender") or ""),
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def update_recruiter_watch_item_from_context(item: dict, context: dict, candidate_label: str = "") -> None:
    if not isinstance(item, dict):
        return
    identity = build_recruiter_candidate_identity(context, candidate_label or str(item.get("candidateLabel") or ""))
    last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    if candidate_label:
        item["candidateLabel"] = safe_text(candidate_label, 220)
        item["compactLabel"] = compact_conversation_label(candidate_label)
    for key in ("candidateName", "appliedPosition", "identityKey", "conversationKey"):
        if identity.get(key):
            item[key] = safe_text(str(identity.get(key) or ""), 100)
    item["candidateIdentity"] = identity
    item["lastMessageSignature"] = chat_message_signature(last_message) if last_message else str(item.get("lastMessageSignature") or "")
    item["lastOtherSignature"] = chat_message_signature(last_other) if last_other else str(item.get("lastOtherSignature") or "")
    item["lastSender"] = str(last_message.get("sender") or item.get("lastSender") or "")
    item["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")


def recruiter_watch_items_same(left: dict, right: dict) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    for key in ("identityKey", "conversationKey"):
        if left.get(key) and right.get(key) and left.get(key) == right.get(key):
            return True
    left_name = str(left.get("candidateName") or "")
    right_name = str(right.get("candidateName") or "")
    left_position = str(left.get("appliedPosition") or "")
    right_position = str(right.get("appliedPosition") or "")
    if left_name and right_name and left_name == right_name and (not left_position or not right_position or left_position == right_position):
        return True
    left_label = str(left.get("compactLabel") or compact_conversation_label(str(left.get("candidateLabel") or "")))
    right_label = str(right.get("compactLabel") or compact_conversation_label(str(right.get("candidateLabel") or "")))
    return bool(left_label and right_label and (left_label in right_label or right_label in left_label))


def recruiter_watch_item_matches_label(item: dict, label: str, context: dict | None = None) -> bool:
    if not isinstance(item, dict):
        return False
    compact_label = compact_conversation_label(label)
    item_label = str(item.get("compactLabel") or compact_conversation_label(str(item.get("candidateLabel") or "")))
    if compact_label and item_label and (compact_label in item_label or item_label in compact_label):
        return True
    name = str(item.get("candidateName") or "")
    position = str(item.get("appliedPosition") or "")
    if name and name in compact_label:
        if not position or position in compact_label:
            return True
        return True
    if context:
        applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        current_name = str(applicant.get("name") or recruiter_candidate_name_from_label(str(label or "")))
        current_position = str(applicant.get("appliedPosition") or context.get("appliedPosition") or "")
        if name and current_name and name == current_name:
            return not position or not current_position or position == current_position
    return False


def find_matching_recruiter_watch_item(
    watch_items: list[dict],
    label: str,
    context: dict | None = None,
) -> dict | None:
    for item in watch_items:
        if recruiter_watch_item_matches_label(item, label, context=context):
            return item
    if context:
        identity = build_recruiter_candidate_identity(context, label)
        candidate = build_recruiter_watch_item(label, context, identity)
        for item in watch_items:
            if recruiter_watch_items_same(item, candidate):
                return item
    return None


def compact_recruiter_resume_result(resume: dict | None) -> dict:
    if not isinstance(resume, dict):
        return {}

    def compact_scan(scan: dict | None) -> dict:
        if not isinstance(scan, dict):
            return {}
        return {
            "found": bool(scan.get("found")),
            "reason": safe_text(str(scan.get("reason") or ""), 80),
            "candidate": scan.get("candidate") if isinstance(scan.get("candidate"), dict) else {},
            "candidates": scan.get("candidates")[:5] if isinstance(scan.get("candidates"), list) else [],
        }

    def compact_step(step: dict | None) -> dict:
        if not isinstance(step, dict):
            return {}
        out = {
            "ok": step.get("ok"),
            "blocked": step.get("blocked"),
            "reason": safe_text(str(step.get("reason") or ""), 100),
            "message": safe_text(str(step.get("message") or ""), 220),
            "downloaded": step.get("downloaded"),
            "skipped": step.get("skipped"),
            "skipReason": safe_text(str(step.get("skipReason") or ""), 80),
            "filename": safe_text(str(step.get("filename") or ""), 180),
            "filePath": safe_text(str(step.get("filePath") or ""), 260),
            "downloadMethod": safe_text(str(step.get("downloadMethod") or ""), 100),
        }
        if isinstance(step.get("scan"), dict):
            out["scan"] = compact_scan(step.get("scan"))
        if isinstance(step.get("openResult"), dict):
            out["openResult"] = {
                k: v for k, v in step.get("openResult", {}).items()
                if k not in {"page", "originPage"}
            }
        if isinstance(step.get("saveResult"), dict):
            out["saveResult"] = {
                k: v for k, v in step.get("saveResult", {}).items()
                if k != "download"
            }
        return out

    return {
        "action": safe_text(str(resume.get("action") or ""), 100),
        "message": safe_text(str(resume.get("message") or ""), 260),
        "blocked": resume.get("blocked"),
        "downloaded": resume.get("downloaded"),
        "download": compact_step(resume.get("download") if isinstance(resume.get("download"), dict) else {}),
        "request": compact_step(resume.get("request") if isinstance(resume.get("request"), dict) else {}),
    }


def classify_recruiter_screen_result_action(result: dict) -> str:
    screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
    status = str(screening.get("status") or "")
    resume = result.get("resume") if isinstance(result.get("resume"), dict) else {}
    if result.get("blocked"):
        sent = result.get("sent") if isinstance(result.get("sent"), dict) else {}
        if sent:
            if result.get("positionScreening"):
                return "sent_position_screening"
            if sent.get("send") or sent.get("verification") or "已触发" in str(sent.get("message") or "") or "已点击" in str(sent.get("message") or ""):
                return "sent_basic_conditions"
            return "basic_conditions_send_blocked"
        if resume and result.get("knowledgeAnswer"):
            return "knowledge_answered_resume_blocked"
        if resume:
            return "accepted_resume_blocked"
        return "blocked"
    resume_skipped = bool(resume.get("skipped") and resume.get("skipReason") in {"already_requested", "resume_attachment_received"})
    resume_downloaded = bool(result.get("downloaded") or resume.get("downloaded"))
    if resume_downloaded and result.get("knowledgeAnswer"):
        return "knowledge_answered_resume_downloaded"
    if resume_downloaded:
        return "accepted_resume_downloaded"
    if resume_skipped and result.get("knowledgeAnswer"):
        return "knowledge_answered_resume_already_requested"
    if resume_skipped:
        return "accepted_resume_already_requested"
    if result.get("resume") and result.get("knowledgeAnswer"):
        return "knowledge_answered_and_requested_resume"
    if result.get("resume"):
        return "accepted_requested_resume"
    if result.get("sent") and result.get("knowledgeAnswer"):
        return "knowledge_answered_and_sent_screening"
    if result.get("knowledgeAnswer"):
        return "knowledge_answered"
    if result.get("sent"):
        if result.get("positionScreening"):
            return "sent_position_screening"
        return "sent_basic_conditions"
    if result.get("shouldMarkUnsuitable") or status == "reject":
        return "rejected_skipped"
    if status in {"waiting", "unclear"}:
        return "unclear_or_waiting_skipped"
    return "checked"


def opened_thread_matches_context(opened: dict | None, context: dict | None) -> dict:
    if not isinstance(opened, dict) or not isinstance(context, dict):
        return {"matched": False, "reason": "missing_context"}
    applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
    opened_label = compact_conversation_label(str(opened.get("label") or ""))
    current_label = compact_conversation_label(str(applicant.get("label") or ""))
    current_name = compact_conversation_label(str(applicant.get("name") or ""))
    current_position = compact_conversation_label(str(applicant.get("appliedPosition") or ""))
    opened_y = opened.get("y")
    current_y = applicant.get("y")

    if current_name and current_name in opened_label:
        return {"matched": True, "reason": "candidate_name", "name": current_name}
    if current_label and opened_label:
        if current_label[:40] in opened_label or opened_label[:40] in current_label:
            return {"matched": True, "reason": "selected_row_label"}
        if len(current_label) >= 20 and len(opened_label) >= 20:
            overlap = len(set(current_label) & set(opened_label))
            if overlap >= min(18, max(8, len(set(opened_label)) // 2)):
                return {"matched": True, "reason": "selected_row_overlap"}
    if current_position and opened_label and current_position in opened_label:
        return {"matched": True, "reason": "position"}
    if isinstance(opened_y, (int, float)) and isinstance(current_y, (int, float)):
        if abs(float(opened_y) - float(current_y)) <= 24:
            return {"matched": True, "reason": "same_row_y"}

    # Some chat UIs do not expose a selected row after clicking. In that case we
    # accept only the unread-filter fallback, because the list itself was already
    # narrowed to unread conversations before the click.
    if not current_label and str(opened.get("reason") or "") == "unread-filter-first-row":
        return {"matched": True, "reason": "unread_filter_fallback"}

    return {
        "matched": False,
        "reason": "opened_target_did_not_match_selected_row",
        "openedLabel": safe_text(opened_label, 80),
        "currentLabel": safe_text(current_label, 80),
        "currentName": safe_text(current_name, 40),
    }


def extract_windows_path(message: str) -> str | None:
    match = re.search(r"[A-Za-z]:\\[^\n\r\"'<>|]+", message)
    if not match:
        return None
    return match.group(0).strip().rstrip("。；;，,")


def contains_windows_path(message: str) -> bool:
    return bool(re.search(r"[A-Za-z]:\\", message))


def chat_context_signature(text: str) -> str:
    compact = re.sub(r"\s+", " ", str(text or "")).strip()
    return str(hash(compact[-1000:])) if compact else ""


def stable_digest(text: str, length: int = 16) -> str:
    value = str(text or "").encode("utf-8", errors="ignore")
    return hashlib.sha1(value).hexdigest()[:length]


def chat_message_signature(message: dict | None) -> str:
    if not isinstance(message, dict):
        return ""
    text = re.sub(r"\s+", " ", str(message.get("text") or "")).strip()
    sender = str(message.get("sender") or "")
    when = str(message.get("time") or "")
    return stable_digest(f"{sender}|{when}|{text[-220:]}")


def last_effective_chat_message(messages: list[dict], sender: str | None = None) -> dict:
    if not isinstance(messages, list):
        return {}
    ignored = {"已读", "送达", "未读", "对方正在输入", "按enter键发送", "按ctrl+enter键换行发送"}
    for item in reversed(messages):
        if not isinstance(item, dict):
            continue
        if sender and item.get("sender") != sender:
            continue
        text = re.sub(r"\s+", "", str(item.get("text") or "")).lower()
        if not text or text in ignored:
            continue
        return item
    return {}


def build_conversation_key(url: str, messages: list[dict], opened_label: str | None = None) -> str:
    label = re.sub(r"\s+", " ", str(opened_label or "")).strip()
    if not label and messages:
        first_other = next((item for item in messages if isinstance(item, dict) and item.get("sender") == "other"), None)
        if first_other:
            label = str(first_other.get("text") or "")
    last_other = last_effective_chat_message(messages, sender="other")
    basis = "|".join([
        urlparse(str(url or "")).netloc,
        urlparse(str(url or "")).path,
        label[:120],
        str(last_other.get("text") or "")[:80],
    ])
    return "chat_" + stable_digest(basis, 20)


def infer_counterpart_profile(context: dict, opened_label: str | None = None) -> dict:
    applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
    if applicant.get("name") or applicant.get("appliedPosition"):
        return {
            "name": safe_text(str(applicant.get("name") or ""), 40),
            "organization": "",
            "role": safe_text(str(applicant.get("appliedPosition") or context.get("appliedPosition") or ""), 80),
            "appliedPosition": safe_text(str(applicant.get("appliedPosition") or context.get("appliedPosition") or ""), 80),
            "rawHeader": safe_text(str(applicant.get("label") or ""), 260),
        }

    detail = context.get("chatDetailSource") if isinstance(context.get("chatDetailSource"), dict) else {}
    header_source = " ".join([
        str(opened_label or ""),
        str(detail.get("text") or ""),
        str(context.get("pageTextPreview") or ""),
    ])
    header = safe_text(re.sub(r"\s+", " ", header_source).strip(), 260)
    before_more = header.split(" 更多 ", 1)[0].strip()
    tokens = [part for part in before_more.split(" ") if part and part not in {"已读", "送达", "草稿"}]
    profile = {
        "name": "",
        "organization": "",
        "role": "",
        "appliedPosition": safe_text(str(context.get("appliedPosition") or ""), 80),
        "rawHeader": header,
    }
    if tokens:
        profile["name"] = safe_text(tokens[0], 40)
    if len(tokens) >= 2:
        profile["organization"] = safe_text(tokens[1], 60)
    if len(tokens) >= 3:
        profile["role"] = safe_text(tokens[2], 60)
    return profile


def build_reply_style(memory: dict, intent_stats: dict, profile: dict) -> dict:
    role_text = f"{profile.get('role', '')} {profile.get('organization', '')}".lower()
    category_rank = sorted(intent_stats.items(), key=lambda item: int(item[1] or 0), reverse=True)
    top_categories = [name for name, count in category_rank[:4] if count]
    tone = "以招聘者身份沟通，礼貌、简短、自然；先回应候选人，再根据岗位推进筛选或邀约。"
    if "hr" in role_text or "人力" in role_text or "招聘" in role_text:
        tone = "面向招聘方，礼貌稳妥、信息密度高，不绕圈。"
    if "resume_request" in top_categories:
        tone += " 对方常要简历，优先确认可发简历或说明附件状态。"
    if "contact_exchange" in top_categories:
        tone += " 涉及电话/微信时谨慎，不编造不存在的联系方式。"
    if "education_grade" in top_categories or "identity_question" in top_categories:
        tone += " 对方会核实身份/学历/状态，先直接说明真实身份信息。"
    return {
        "persona": "招聘者沟通助手",
        "tone": tone,
        "replyLength": "10-20 个中文字符优先，最多 20 个中文字符",
        "do": [
            "按对方最近问题直接回答",
            "保持礼貌自然",
            "缺少真实资料时说明可补充，不写占位符",
        ],
        "dont": [
            "不要编造学校、年龄、工作年限、联系方式",
            "不要连续追问或重复上一轮已经发过的话",
            "不要长段落输出",
        ],
    }


def build_chat_memory(previous: dict, context: dict, opened_label: str | None = None) -> dict:
    messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    counterpart = infer_counterpart_profile(context, opened_label=opened_label)
    applied_position = safe_text(str(context.get("appliedPosition") or counterpart.get("appliedPosition") or ""), 80)
    intent_stats: dict[str, int] = {}
    other_questions: list[str] = []
    me_points: list[str] = []
    recent_messages: list[dict] = []
    for message in messages[-80:]:
        if not isinstance(message, dict):
            continue
        text = safe_text(str(message.get("text") or "").strip(), 500)
        if not text:
            continue
        sender = str(message.get("sender") or "")
        recent_messages.append({
            "sender": sender if sender in {"me", "other"} else "unknown",
            "text": text,
            "time": safe_text(str(message.get("time") or message.get("timestamp") or ""), 40),
            "status": safe_text(str(message.get("status") or ""), 30),
        })
        if sender == "other":
            intent = classify_chat_intent(text)
            category = str(intent.get("category") or "unknown")
            intent_stats[category] = int(intent_stats.get(category) or 0) + 1
            if text not in other_questions:
                other_questions.append(text)
        elif sender == "me":
            if text not in me_points:
                me_points.append(text)

    other_questions = other_questions[-10:]
    me_points = me_points[-6:]
    top_intents = [
        name for name, count in sorted(intent_stats.items(), key=lambda item: int(item[1] or 0), reverse=True)
        if count and name != "unknown"
    ][:5]
    focus_map = {
        "identity_question": "身份确认",
        "education_grade": "学历/年级/毕业状态",
        "resume_request": "简历材料",
        "contact_exchange": "联系方式交换",
        "interview_schedule": "面试安排",
        "salary_expectation": "薪资期望",
        "job_interest": "岗位匹配",
        "greeting": "日常招呼",
    }
    focus = [focus_map.get(name, name) for name in top_intents]
    summary_parts = []
    if counterpart.get("name") or counterpart.get("organization") or counterpart.get("role"):
        summary_parts.append(
            "对方"
            f"{counterpart.get('name') or '未知'}"
            f"（{counterpart.get('organization') or '未知公司'} / {counterpart.get('role') or '未知角色'}）"
        )
    if focus:
        summary_parts.append("主要关注：" + "、".join(focus[:4]))
    if applied_position:
        summary_parts.append(f"应聘岗位：{applied_position}")
    if other_questions:
        summary_parts.append("最近问过：" + "；".join(other_questions[-4:]))
    if me_points:
        summary_parts.append("我方最近回应：" + "；".join(me_points[-2:]))
    summary = safe_text("。".join(summary_parts) or str(previous.get("summary") or ""), 900)
    last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    return {
        "summary": summary,
        "counterpart": counterpart,
        "appliedPosition": applied_position,
        "positionReply": context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {},
        "recentMessages": recent_messages[-80:],
        "recentOtherMessages": other_questions,
        "recentMyMessages": me_points,
        "intentStats": intent_stats,
        "replyStyle": build_reply_style(previous, intent_stats, counterpart),
        "lastMessageSignature": chat_message_signature(last_message) if last_message else "",
        "lastOtherSignature": chat_message_signature(last_other) if last_other else "",
    }


def compact_chat_memory(memory: dict) -> dict:
    if not isinstance(memory, dict):
        return {}
    return {
        "summary": safe_text(str(memory.get("summary") or ""), 700),
        "counterpart": memory.get("counterpart") if isinstance(memory.get("counterpart"), dict) else {},
        "appliedPosition": safe_text(str(memory.get("appliedPosition") or ""), 80),
        "positionReply": memory.get("positionReply") if isinstance(memory.get("positionReply"), dict) else {},
        "recentMessages": list(memory.get("recentMessages") or [])[-60:],
        "recentOtherMessages": list(memory.get("recentOtherMessages") or [])[-6:],
        "recentMyMessages": list(memory.get("recentMyMessages") or [])[-6:],
        "intentStats": memory.get("intentStats") if isinstance(memory.get("intentStats"), dict) else {},
        "replyStyle": memory.get("replyStyle") if isinstance(memory.get("replyStyle"), dict) else {},
        "lastOtherSignature": str(memory.get("lastOtherSignature") or ""),
        "updatedAt": str(memory.get("updatedAt") or ""),
    }


def compact_candidate_conversation_review(review: dict) -> dict:
    if not isinstance(review, dict):
        return {}
    unanswered = review.get("unansweredQuestions") if isinstance(review.get("unansweredQuestions"), list) else []
    answered = review.get("answeredQuestions") if isinstance(review.get("answeredQuestions"), list) else []
    actions = review.get("actionsDone") if isinstance(review.get("actionsDone"), list) else []
    return {
        "modelEnabled": bool(review.get("modelEnabled")),
        "acceptanceStatus": safe_text(str(review.get("acceptanceStatus") or ""), 40),
        "recommendedNextAction": safe_text(str(review.get("recommendedNextAction") or ""), 60),
        "pendingReplyNeeded": bool(review.get("pendingReplyNeeded")),
        "shouldRequestResume": bool(review.get("shouldRequestResume")),
        "shouldSkip": bool(review.get("shouldSkip")),
        "summary": safe_text(str(review.get("summary") or ""), 500),
        "unansweredQuestions": [
            {
                "text": safe_text(str(item.get("text") or item.get("question") or ""), 180),
                "topic": safe_text(str(item.get("topic") or item.get("topicHint") or ""), 60),
                "messageIndex": item.get("messageIndex"),
                "sourceText": safe_text(str(item.get("sourceText") or ""), 180),
                "reason": safe_text(str(item.get("reason") or ""), 120),
            }
            for item in unanswered[:RECENT_UNANSWERED_OTHER_LIMIT]
            if isinstance(item, dict)
        ],
        "answeredQuestions": [
            {
                "text": safe_text(str(item.get("text") or item.get("question") or ""), 180),
                "answer": safe_text(str(item.get("answer") or ""), 120),
                "topic": safe_text(str(item.get("topic") or item.get("topicHint") or ""), 60),
            }
            for item in answered[:8]
            if isinstance(item, dict)
        ],
        "actionsDone": [safe_text(str(item), 80) for item in actions[:12]],
    }


def classify_chat_intent(text: str) -> dict:
    raw = str(text or "").strip()
    lowered = raw.lower()
    compact = re.sub(r"\s+", "", raw)
    category = "unknown"
    risk = "normal"
    confidence = 0.35
    reply_hint = "自然简短回复，必要时先确认信息。"

    checks = [
        ("contact_exchange", ("微信", "vx", "wechat", "电话", "手机号", "联系方式", "加我", "交换"), "对方想交换联系方式。", "sensitive"),
        ("identity_question", ("你是谁", "哪位", "您是", "谁啊", "哪一个"), "对方在确认身份。", "normal"),
        ("education_grade", ("大几", "几年级", "在读", "应届", "毕业", "学生", "学校"), "对方在问学历/年级/毕业状态。", "normal"),
        ("resume_request", ("简历", "发一下", "发我", "附件", "pdf", "资料"), "对方想要简历或资料。", "sensitive"),
        ("interview_schedule", ("面试", "约", "时间", "方便", "几点", "明天", "今天", "周", "到岗"), "对方在沟通面试或时间安排。", "normal"),
        ("salary_expectation", ("薪资", "薪水", "工资", "期望", "待遇", "多少钱"), "对方在问薪资期望。", "sensitive"),
        ("job_interest", ("岗位", "职位", "工作内容", "技术栈", "职责", "base", "地点"), "对方在沟通岗位信息。", "normal"),
        ("greeting", ("你好", "您好", "在吗", "哈喽", "hello", "hi"), "对方在打招呼。", "normal"),
        ("rejection_or_close", ("不合适", "暂不", "不用", "谢谢", "不考虑"), "对方可能在结束沟通。", "normal"),
    ]
    for name, words, hint, item_risk in checks:
        if any(word in compact or word in lowered for word in words):
            category = name
            risk = item_risk
            confidence = 0.82
            reply_hint = hint
            break

    return {
        "category": category,
        "risk": risk,
        "confidence": confidence,
        "replyHint": reply_hint,
        "sourceText": safe_text(raw, 160),
    }


def is_auto_reply_command(message: str) -> bool:
    text = str(message or "").lower()
    compact = re.sub(r"\s+", "", text)
    direct_terms = [
        "回复未读",
        "处理未读",
        "回未读",
        "未读消息回复",
        "回复新消息",
        "处理新消息",
        "帮我回未读",
        "帮我回复未读",
        "打开未读并回复",
    ]
    if any(term in compact for term in direct_terms):
        return True
    signal_terms = [
        "\u68c0\u6d4b\u5230\u65b0\u6d88\u606f",  # 检测到新消息
        "\u65b0\u6d88\u606f",  # 新消息
        "\u81ea\u52a8\u68c0\u67e5",  # 自动检查
        "\u672a\u8bfb",  # 未读
        "\u672a\u8bfb\u6d88\u606f",  # 未读消息
        "\u672a\u56de\u590d",  # 未回复
        "\u6ca1\u6709\u56de\u590d",  # 没有回复
        "\u5f85\u56de\u590d",  # 待回复
    ]
    reply_terms = [
        "\u56de\u590d",  # 回复
        "\u5904\u7406",  # 处理
        "\u81ea\u52a8\u751f\u6210\u56de\u590d",  # 自动生成回复
        "\u81ea\u52a8\u56de\u590d",  # 自动回复
        "\u56de\u590d\u6d88\u606f",  # 回复消息
        "\u70b9\u8fdb\u53bb\u8fdb\u884c\u56de\u590d",  # 点进去进行回复
        "\u5e2e\u6211\u56de\u590d",  # 帮我回复
        "auto reply",
    ]
    return any(term in text for term in signal_terms) and any(term in text for term in reply_terms)


def is_local_browser_page(terminal: BrowserTerminal) -> bool:
    try:
        parsed = urlparse(terminal.current_page().url)
        return parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    except Exception:
        return False


def move_cursor_like_person(
    terminal: BrowserTerminal,
    x: float,
    y: float,
    duration_factor: float = 1.0,
    show_trail: bool = True,
) -> None:
    page = terminal.current_page()
    viewport = page.viewport_size or {"width": 1280, "height": 720}
    x = clamp(float(x), 8, max(8, float(viewport.get("width", 1280)) - 8))
    y = clamp(float(y), 8, max(8, float(viewport.get("height", 720)) - 8))
    try:
        if terminal.visual_cursor:
            ensure_visual_cursor(page)
            path = build_bezier_cursor_path(
                page,
                x,
                y,
                terminal.move_duration_factor() * duration_factor,
                allow_overshoot=False,
            )
            if show_trail:
                draw_visual_trail(page, path, visible=True)
            terminal.follow_cursor_path(page, path)
            if show_trail:
                page.wait_for_timeout(random.randint(35, 90))
                draw_visual_trail(page, [], visible=False)
        else:
            page.mouse.move(x, y, steps=random.randint(8, 18))
            page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": x, "y": y})
    except Exception:
        page.mouse.move(x, y, steps=random.randint(4, 10))


def humanized_point_click(terminal: BrowserTerminal, x: float, y: float, target_box: dict | None = None) -> None:
    page = terminal.current_page()
    viewport = page.viewport_size or {"width": 1280, "height": 720}
    x = clamp(float(x), 8, max(8, float(viewport.get("width", 1280)) - 8))
    y = clamp(float(y), 8, max(8, float(viewport.get("height", 720)) - 8))
    if terminal.visual_cursor:
        ensure_visual_cursor(page)
        path = build_bezier_cursor_path(
            page,
            x,
            y,
            terminal.move_duration_factor(),
            target_box=target_box,
            allow_overshoot=True,
        )
        draw_visual_trail(page, path, visible=True)
        terminal.follow_cursor_path(page, path)
        move_visual_cursor(page, x, y, click=True)
        page.wait_for_timeout(random.randint(35, 95))
        page.mouse.click(x, y)
        page.wait_for_timeout(random.randint(80, 170))
        draw_visual_trail(page, [], visible=False)
    else:
        page.mouse.move(x, y, steps=random.randint(10, 22))
        page.wait_for_timeout(random.randint(65, 180))
        page.mouse.click(x, y)
    try:
        page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(x), "y": float(y)})
    except Exception:
        pass
    maybe_post_click_settle(terminal, x, y)
    maybe_human_work_rest(terminal)


def target_box_inner_point(box: dict) -> tuple[float, float]:
    width = max(1.0, float(box.get("width") or 1))
    height = max(1.0, float(box.get("height") or 1))
    pad_x = min(width * 0.32, max(3.0, width * 0.16))
    pad_y = min(height * 0.32, max(3.0, height * 0.16))
    left = float(box.get("x") or 0) + pad_x
    right = float(box.get("x") or 0) + width - pad_x
    top = float(box.get("y") or 0) + pad_y
    bottom = float(box.get("y") or 0) + height - pad_y
    if right <= left:
        left = float(box.get("x") or 0) + width * 0.42
        right = float(box.get("x") or 0) + width * 0.58
    if bottom <= top:
        top = float(box.get("y") or 0) + height * 0.42
        bottom = float(box.get("y") or 0) + height * 0.58
    return random.uniform(left, right), random.uniform(top, bottom)


def humanized_button_hover_jitter(terminal: BrowserTerminal, box: dict) -> tuple[float, float]:
    page = terminal.current_page()
    final_x, final_y = target_box_inner_point(box)
    if not terminal.humanize:
        return final_x, final_y
    moves = 1 if random.random() < 0.55 else 0
    for _ in range(moves):
        x, y = target_box_inner_point(box)
        try:
            if terminal.visual_cursor:
                move_cursor_like_person(terminal, x, y, duration_factor=random.uniform(0.18, 0.36), show_trail=False)
                move_visual_cursor(page, x, y, click=False)
            else:
                page.mouse.move(x, y, steps=random.randint(2, 6))
            page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(x), "y": float(y)})
            page.wait_for_timeout(random.randint(55, 190))
        except Exception:
            break
    return final_x, final_y


def maybe_human_work_rest(terminal: BrowserTerminal) -> None:
    if not getattr(terminal, "humanize", False):
        return
    count = int(getattr(terminal, "_codex_human_work_count", 0)) + 1
    next_after = int(getattr(terminal, "_codex_human_next_rest_after", 0) or random.randint(7, 12))
    setattr(terminal, "_codex_human_work_count", count)
    if count < next_after:
        return
    setattr(terminal, "_codex_human_work_count", 0)
    setattr(terminal, "_codex_human_next_rest_after", random.randint(6, 11))
    page = terminal.current_page()
    rest_ms = random.randint(8500, 12500)
    try:
        if random.random() < 0.45:
            jitter_mouse(page)
        page.wait_for_timeout(rest_ms)
        if random.random() < 0.55:
            jitter_mouse(page)
    except Exception:
        try:
            page.wait_for_timeout(rest_ms)
        except Exception:
            pass


def maybe_post_click_settle(terminal: BrowserTerminal, x: float, y: float) -> None:
    if not getattr(terminal, "humanize", False) or random.random() > 0.48:
        return
    page = terminal.current_page()
    viewport = page.viewport_size or {"width": 1280, "height": 720}
    try:
        dx = random.choice([-1, 1]) * random.uniform(8, 24)
        dy = random.choice([-1, 1]) * random.uniform(5, 18)
        nx = clamp(float(x) + dx, 12, float(viewport.get("width", 1280)) - 12)
        ny = clamp(float(y) + dy, 12, float(viewport.get("height", 720)) - 12)
        if terminal.visual_cursor:
            move_cursor_like_person(terminal, nx, ny, duration_factor=random.uniform(0.12, 0.28), show_trail=False)
            move_visual_cursor(page, nx, ny, click=False)
        else:
            page.mouse.move(nx, ny, steps=random.randint(2, 5))
        page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(nx), "y": float(ny)})
        page.wait_for_timeout(random.randint(70, 240))
    except Exception:
        return


def maybe_human_reading_pause(terminal: BrowserTerminal, reason: str = "", text_hint: str = "") -> None:
    if not getattr(terminal, "humanize", False):
        return
    chance = 0.38
    if reason in {"candidate_open", "page_change", "before_decision"}:
        chance = 0.68
    if random.random() > chance:
        return
    page = terminal.current_page()
    viewport = page.viewport_size or {"width": 1280, "height": 720}
    text_len = min(900, len(str(text_hint or "")))
    pause_ms = random.randint(360, 1050) + int(text_len * random.uniform(0.35, 0.9))
    pause_ms = min(2400, pause_ms)
    try:
        if random.random() < 0.55:
            x = float(viewport.get("width", 1280)) * random.uniform(0.58, 0.78)
            y = float(viewport.get("height", 720)) * random.uniform(0.36, 0.68)
            move_cursor_like_person(terminal, x, y, duration_factor=random.uniform(0.28, 0.55), show_trail=False)
        page.wait_for_timeout(pause_ms)
        if random.random() < 0.25:
            jitter_mouse(page)
    except Exception:
        try:
            page.wait_for_timeout(pause_ms)
        except Exception:
            pass


def maybe_human_batch_pause(terminal: BrowserTerminal, index: int) -> None:
    if not getattr(terminal, "humanize", False) or index <= 0:
        return
    if index % random.randint(3, 5) != 0:
        return
    page = terminal.current_page()
    pause_ms = random.randint(1300, 3600)
    if random.random() < 0.18:
        pause_ms += random.randint(3500, 6500)
    try:
        if random.random() < 0.45:
            small_scroll_wander(terminal)
        else:
            jitter_mouse(page)
        page.wait_for_timeout(pause_ms)
    except Exception:
        try:
            page.wait_for_timeout(pause_ms)
        except Exception:
            pass


def maybe_human_proactive_contact_pause(terminal: BrowserTerminal, index: int) -> None:
    if not getattr(terminal, "humanize", False) or index <= 0:
        return
    page = terminal.current_page()
    since_rest = int(getattr(terminal, "_codex_proactive_contacts_since_rest", 0)) + 1
    next_after = int(getattr(terminal, "_codex_proactive_next_rest_after", 0) or random.randint(4, 7))
    setattr(terminal, "_codex_proactive_contacts_since_rest", since_rest)
    setattr(terminal, "_codex_proactive_next_rest_after", next_after)

    pause_ms = random.randint(950, 1900)
    if random.random() < 0.36:
        pause_ms += random.randint(600, 1600)
    should_rest = since_rest >= next_after
    if should_rest:
        pause_ms += random.randint(5200, 9200)
        setattr(terminal, "_codex_proactive_contacts_since_rest", 0)
        setattr(terminal, "_codex_proactive_next_rest_after", random.randint(4, 7))

    try:
        if random.random() < (0.52 if should_rest else 0.28):
            jitter_mouse(page)
        if random.random() < (0.42 if should_rest else 0.18):
            small_scroll_wander(terminal)
        page.wait_for_timeout(pause_ms)
    except Exception:
        try:
            page.wait_for_timeout(pause_ms)
        except Exception:
            pass


def maybe_human_resume_request_pause(terminal: BrowserTerminal) -> None:
    if not getattr(terminal, "humanize", False):
        return
    since_rest = int(getattr(terminal, "_codex_resume_requests_since_rest", 0)) + 1
    next_after = int(getattr(terminal, "_codex_resume_next_rest_after", 0) or random.randint(3, 6))
    setattr(terminal, "_codex_resume_requests_since_rest", since_rest)
    setattr(terminal, "_codex_resume_next_rest_after", next_after)
    if since_rest < next_after:
        return

    page = terminal.current_page()
    rest_ms = random.randint(8500, 12500)
    setattr(terminal, "_codex_resume_requests_since_rest", 0)
    setattr(terminal, "_codex_resume_next_rest_after", random.randint(3, 6))
    try:
        if random.random() < 0.58:
            jitter_mouse(page)
        if random.random() < 0.38:
            small_scroll_wander(terminal)
        page.wait_for_timeout(rest_ms)
        if random.random() < 0.45:
            jitter_mouse(page)
    except Exception:
        try:
            page.wait_for_timeout(rest_ms)
        except Exception:
            pass


def humanized_locator_click(terminal: BrowserTerminal, locator, *, force: bool = False) -> None:
    page = terminal.current_page()
    try:
        locator.scroll_into_view_if_needed(timeout=3500)
    except Exception:
        pass
    try:
        box = locator.bounding_box(timeout=3000)
    except Exception:
        box = None
    if box:
        x, y = humanized_button_hover_jitter(terminal, box)
        humanized_point_click(terminal, x, y, target_box=box)
        return
    try:
        if force:
            locator.click(timeout=8000, force=True)
        else:
            locator.click(timeout=8000)
    except Exception as error:
        msg = str(error).lower()
        if force or "not visible" in msg or "element is not visible" in msg or "obscured" in msg:
            locator.click(timeout=8000, force=True)
        else:
            raise


def humanized_precise_button_click(terminal: BrowserTerminal, locator, *, force: bool = False) -> None:
    page = terminal.current_page()
    try:
        locator.scroll_into_view_if_needed(timeout=3500)
    except Exception:
        pass
    try:
        box = locator.bounding_box(timeout=3000)
    except Exception:
        box = None
    if not box:
        if force:
            locator.click(timeout=8000, force=True)
        else:
            locator.click(timeout=8000)
        return

    x = float(box["x"] + box["width"] * random.uniform(0.46, 0.54))
    y = float(box["y"] + box["height"] * random.uniform(0.42, 0.58))
    if terminal.visual_cursor:
        ensure_visual_cursor(page)
        path = build_bezier_cursor_path(
            page,
            x,
            y,
            terminal.move_duration_factor() * 0.86,
            target_box=box,
            allow_overshoot=False,
        )
        draw_visual_trail(page, path, visible=True)
        terminal.follow_cursor_path(page, path)
        move_visual_cursor(page, x, y, click=True)
        page.wait_for_timeout(random.randint(35, 85))
        page.mouse.click(x, y)
        page.wait_for_timeout(random.randint(90, 170))
        draw_visual_trail(page, [], visible=False)
    else:
        page.mouse.move(x, y, steps=random.randint(8, 18))
        page.wait_for_timeout(random.randint(50, 120))
        page.mouse.click(x, y)
    try:
        page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(x), "y": float(y)})
    except Exception:
        pass


def humanized_scroll(
    terminal: BrowserTerminal,
    amount: int,
    *,
    box: dict | None = None,
    locator=None,
    corrective: bool = True,
) -> None:
    page = terminal.current_page()
    if box is None and locator is not None:
        try:
            box = locator.bounding_box(timeout=1500)
        except Exception:
            box = None
    if box:
        x = float(box["x"] + box["width"] * random.uniform(0.42, 0.58))
        y = float(box["y"] + box["height"] * random.uniform(0.32, 0.72))
    else:
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        x = float(viewport.get("width", 1280)) * random.uniform(0.42, 0.62)
        y = float(viewport.get("height", 720)) * random.uniform(0.34, 0.72)
    if terminal.humanize:
        move_cursor_like_person(terminal, x, y, duration_factor=0.65, show_trail=terminal.visual_cursor)
        page.wait_for_timeout(random.randint(45, 150))

    total = int(amount)
    if total == 0:
        return
    direction = 1 if total > 0 else -1
    remaining = abs(total)
    segments = max(4, min(12, remaining // random.randint(95, 170) + random.randint(2, 4)))
    weights = []
    for index in range(int(segments)):
        t = (index + 0.5) / max(1, segments)
        weights.append(max(0.18, math.sin(math.pi * t) * random.uniform(0.65, 1.35)))
    weight_total = sum(weights) or 1.0
    steps = []
    allocated = 0
    for index, weight in enumerate(weights):
        if index == len(weights) - 1:
            step = remaining - allocated
        else:
            step = int(max(18, min(260, remaining * weight / weight_total)))
            allocated += step
        if step > 0:
            steps.append(step)
    moved = 0
    for index, step in enumerate(steps):
        if step <= 0:
            continue
        page.mouse.wheel(0, direction * step)
        moved += step
        if terminal.humanize and random.random() < 0.18:
            jitter_mouse(page)
        if terminal.humanize and random.random() < 0.16 and index not in {0, len(steps) - 1}:
            page.mouse.wheel(0, -direction * random.randint(8, max(10, min(48, step // 2))))
        page.wait_for_timeout(random.randint(55, 235))
    if corrective and moved > 160 and terminal.humanize and random.random() < 0.45:
        back = int(max(18, min(120, moved * random.uniform(0.05, 0.15))))
        page.mouse.wheel(0, -direction * back)
        page.wait_for_timeout(random.randint(65, 160))
        if random.random() < 0.75:
            page.mouse.wheel(0, direction * int(back * random.uniform(0.45, 0.85)))
            page.wait_for_timeout(random.randint(45, 130))
    if terminal.humanize and random.random() < 0.32:
        maybe_human_reading_pause(terminal, reason="page_change")


def jitter_mouse(page) -> None:
    try:
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        pos = page.evaluate("() => window.__codexCursorPos || { x: innerWidth / 2, y: innerHeight / 2 }")
        x = float(pos.get("x", viewport["width"] / 2))
        y = float(pos.get("y", viewport["height"] / 2))
        for _ in range(random.randint(1, 2)):
            x = clamp(x + random.uniform(-55, 55), 12, viewport["width"] - 12)
            y = clamp(y + random.uniform(-35, 35), 12, viewport["height"] - 12)
            page.mouse.move(x, y, steps=random.randint(6, 16))
            page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": x, "y": y})
            page.wait_for_timeout(random.randint(60, 260))
    except Exception:
        return


def small_scroll_wander(target) -> None:
    try:
        if isinstance(target, BrowserTerminal):
            amount = random.randint(45, 160) * random.choice([1, -1])
            humanized_scroll(target, amount, corrective=random.random() < 0.65)
            return
        page = target
        amount = random.randint(45, 160) * random.choice([1, -1])
        page.mouse.wheel(0, amount)
        page.wait_for_timeout(random.randint(90, 310))
        if random.random() < 0.65:
            page.mouse.wheel(0, -int(amount * random.uniform(0.35, 0.9)))
            page.wait_for_timeout(random.randint(60, 210))
    except Exception:
        return


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def open_recommend_page_from_left_menu(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    current_url = str(page.url or "")
    if "/web/chat/recommend" in current_url:
        return {"opened": False, "mode": "already_on_recommend", "url": current_url}

    selectors = [
        'a[ka="menu-geek-recommend"]',
        'a[href*="/web/chat/recommend"]',
        '[ka="menu-geek-recommend"]',
    ]
    last_error = ""
    for selector in selectors:
        try:
            candidates = page.locator(selector)
            if candidates.count() <= 0:
                continue
            locator = candidates.first
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            page.wait_for_timeout(random.randint(900, 1500))
            if "/web/chat/recommend" in str(page.url or "") or wait_for_recommend_frame(page, timeout_ms=4500):
                return {"opened": True, "mode": "left_menu_selector", "selector": selector, "url": str(page.url or "")}
        except Exception as error:
            last_error = safe_text(str(error), 160)

    try:
        text_locator = page.get_by_text("推荐牛人", exact=True)
        if text_locator.count() > 0:
            locator = text_locator.first
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            page.wait_for_timeout(random.randint(900, 1500))
            if "/web/chat/recommend" in str(page.url or "") or wait_for_recommend_frame(page, timeout_ms=4500):
                return {"opened": True, "mode": "left_menu_text", "url": str(page.url or "")}
    except Exception as error:
        last_error = safe_text(str(error), 160)

    try:
        page.goto("https://www.zhipin.com/web/chat/recommend", wait_until="domcontentloaded")
        page.wait_for_timeout(random.randint(1200, 1900))
        return {
            "opened": True,
            "mode": "goto_fallback",
            "url": str(page.url or ""),
            "lastError": last_error,
        }
    except Exception as error:
        return {
            "opened": False,
            "mode": "failed",
            "url": current_url,
            "error": safe_text(str(error), 180),
            "lastError": last_error,
        }


def wait_for_recommend_frame(page, timeout_ms: int = 8000):
    deadline = time.time() + max(1, int(timeout_ms or 8000)) / 1000.0
    while time.time() < deadline:
        for frame in page.frames:
            if "/web/frame/recommend/" in str(frame.url or ""):
                return frame
        try:
            page.wait_for_timeout(280)
        except Exception:
            break
    return None


def wait_for_evaluate_condition(target, wait_page, script: str, timeout_ms: int = 1200, poll_ms: int = 120) -> dict:
    deadline = time.time() + max(0.05, int(timeout_ms or 0) / 1000.0)
    last_error = ""
    last_value = None
    while time.time() < deadline:
        try:
            result = target.evaluate(script)
            last_value = result
            if isinstance(result, dict) and result.get("matched"):
                return result
            if result is True:
                return {"matched": True, "reason": "condition_matched"}
        except Exception as error:
            last_error = safe_text(str(error), 120)
        remaining_ms = int(max(0, (deadline - time.time()) * 1000))
        if remaining_ms <= 0:
