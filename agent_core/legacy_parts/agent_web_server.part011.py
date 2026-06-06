    variants: list[str] = []
    seen: set[str] = set()
    values: list[object] = [text]
    if isinstance(raw_variants, list):
        values.extend(raw_variants)
    for value in values:
        variant = safe_text(str(value or "").strip(), 160)
        if not variant:
            continue
        key = compact_position_screening_text(variant)
        if not key or key in seen:
            continue
        seen.add(key)
        variants.append(variant)
    return variants


def screening_question_variant_texts(question: dict) -> list[str]:
    if not isinstance(question, dict):
        return []
    text = str(question.get("text") or "").strip()
    return normalize_screening_question_variants(text, question.get("variants"))


def position_screening_question_matches_any(message_text: str, question: dict) -> bool:
    return any(position_screening_question_matches(message_text, variant) for variant in screening_question_variant_texts(question))


def select_position_screening_question_text(question: dict) -> str:
    variants = screening_question_variant_texts(question)
    if not variants:
        return ""
    selected_index = question.get("selectedVariantIndex")
    try:
        if selected_index is not None:
            selected_index = int(selected_index)
            if 0 <= selected_index < len(variants):
                return variants[selected_index]
    except Exception:
        pass
    return random.choice(variants)


def normalize_position_screening_questions(screening: dict) -> list[dict]:
    if not isinstance(screening, dict):
        return []
    raw_questions = screening.get("questions") if isinstance(screening.get("questions"), list) else []
    questions: list[dict] = []
    for index, item in enumerate(raw_questions):
        if isinstance(item, dict):
            text = str(item.get("text") or "").strip()
            question_id = str(item.get("id") or "").strip()
            required = item.get("required", True)
            raw_variants = item.get("variants")
            selected_variant_index = item.get("selectedVariantIndex", item.get("variantIndex"))
        else:
            text = str(item or "").strip()
            question_id = ""
            required = True
            raw_variants = []
            selected_variant_index = None
        if not text:
            continue
        variants = normalize_screening_question_variants(text, raw_variants)
        question = {
            "id": safe_text(question_id or stable_digest(text, 10), 40),
            "text": safe_text(text, 160),
            "variants": variants,
            "required": bool(required),
            "index": index,
        }
        if selected_variant_index is not None:
            try:
                question["selectedVariantIndex"] = int(selected_variant_index)
            except Exception:
                pass
        questions.append(question)
    return questions


def basic_condition_screening_questions() -> list[dict]:
    return [
        {
            "id": "salary",
            "text": "日薪150能否接受",
            "required": True,
            "index": 0,
        },
        {
            "id": "single_rest",
            "text": "单休能否接受",
            "required": True,
            "index": 1,
        },
        {
            "id": "offline_work",
            "text": "线下工作能否接受",
            "required": True,
            "index": 2,
        },
        {
            "id": "six_months",
            "text": "至少实习六个月能否接受",
            "required": True,
            "index": 3,
        },
        {
            "id": "work_location",
            "text": "工作地点能否接受",
            "required": True,
            "index": 4,
        },
    ]


def should_use_position_screening_flow(context: dict, position_reply: dict | None = None) -> bool:
    if not isinstance(context, dict):
        return False
    position_reply = position_reply if isinstance(position_reply, dict) else {}
    # AI 应用开发相关岗位已有“公司基本情况常用语”专用流程，先保持稳定路径。
    if (
        str(position_reply.get("initialCommonPhrase") or "").strip()
        and is_ai_app_basic_conditions_position(context, position_reply)
    ):
        return False
    knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
    return bool(normalize_position_screening_questions(screening))


def is_unconfigured_recruiter_position(
    context: dict,
    position_reply: dict | None = None,
    position_screening: dict | None = None,
) -> bool:
    if not isinstance(context, dict):
        return False
    position_reply = position_reply if isinstance(position_reply, dict) else {}
    knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    if position_screening is None:
        position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
    position_screening = position_screening if isinstance(position_screening, dict) else {}
    has_initial_phrase = (
        bool(str(position_reply.get("initialCommonPhrase") or "").strip())
        and is_ai_app_basic_conditions_position(context, position_reply)
    )
    has_screening_questions = bool(normalize_position_screening_questions(position_screening))
    has_knowledge_base = bool(knowledge_base.get("enabled"))
    return not has_initial_phrase and not has_screening_questions and not has_knowledge_base


def position_screening_question_matches(message_text: str, question_text: str) -> bool:
    message_compact = compact_position_screening_text(message_text)
    question_compact = compact_position_screening_text(question_text)
    if not message_compact or not question_compact:
        return False
    if question_compact in message_compact:
        return True
    if len(message_compact) >= 8 and message_compact in question_compact:
        return True
    generic_terms = {
        "你好",
        "您好",
        "可以",
        "接受",
        "可以接受",
        "能接受",
        "可以接受吗",
        "能接受吗",
        "你能接受吗",
        "这个岗位",
        "我们这边",
        "这边",
        "岗位",
        "需要",
    }
    terms = []
    for item in re.split(r"[，,。？?、\s]+", str(question_text or "")):
        compact_item = compact_position_screening_text(item)
        if len(compact_item) < 2 or compact_item in generic_terms:
            continue
        if any(compact_item.endswith(suffix) and compact_item[:-len(suffix)] in generic_terms for suffix in ("吗", "么")):
            continue
        terms.append(compact_item)
    if not terms:
        return False
    matched = sum(1 for term in terms if term in message_compact)
    return matched >= max(1, min(2, len(terms)))


def classify_position_screening_answer(question_text: str, answer_text: str) -> dict:
    raw = str(answer_text or "").strip()
    compact = compact_position_screening_text(raw)
    if not compact:
        return {
            "status": "waiting",
            "confidence": 0.0,
            "reason": "empty_answer",
            "sourceText": "",
        }

    if any(term in compact for term in ("没问题", "没有问题", "没啥问题")):
        return {
            "status": "accept",
            "confidence": 0.86,
            "reason": "explicit_accept",
            "sourceText": safe_text(raw, 160),
        }

    question_compact = compact_position_screening_text(question_text)
    if any(term in question_compact for term in ("弱电电工证", "弱电证", "电工证")):
        cert_reject_patterns = (
            r"^(没|没有|无)$",
            r"(没有|没|无)(?:弱电)?(?:电工)?证",
            r"(没有|没|无)(?:考|办|拿|取得|持有)",
            r"(还没|未)(?:考|办|拿|取得|持有)",
            r"(暂时|目前)?(?:没有|没|无)",
        )
        if any(re.search(pattern, compact) for pattern in cert_reject_patterns):
            return {
                "status": "reject",
                "confidence": 0.9,
                "reason": "missing_required_certificate",
                "sourceText": safe_text(raw, 160),
            }
        cert_accept_patterns = (
            r"^(有|有的|有证|有)$",
            r"(有|持有|取得|考了|拿了)(?:弱电)?(?:电工)?证",
            r"(弱电)?(?:电工)?证(?:有|齐全|在手)",
        )
        if any(re.search(pattern, compact) for pattern in cert_accept_patterns):
            return {
                "status": "accept",
                "confidence": 0.88,
                "reason": "has_required_certificate",
                "sourceText": safe_text(raw, 160),
            }

    reject_patterns = (
        r"不太能接受",
        r"不能接受",
        r"不接受",
        r"接受不了",
        r"不可以",
        r"不行",
        r"不考虑",
        r"不会",
        r"不懂",
        r"不熟悉",
        r"不了解",
        r"没(?:有)?(?:相关)?(?:经验|经历|做过|了解|接触|销售)",
        r"没有(?:相关)?(?:经验|经历|做过|了解|接触|销售)",
        r"无(?:相关)?(?:经验|经历)",
        r"不太(?:了解|熟悉|懂|会|接受)",
        r"不是很(?:了解|熟悉|懂|会|接受)",
    )
    if any(re.search(pattern, compact) for pattern in reject_patterns):
        return {
            "status": "reject",
            "confidence": 0.84,
            "reason": "explicit_reject_or_missing_required_experience",
            "sourceText": safe_text(raw, 160),
        }

    hesitation_terms = ("考虑", "想想", "看看", "再说", "了解一下", "稍后", "晚点")
    if any(term in compact for term in hesitation_terms):
        return {
            "status": "unclear",
            "confidence": 0.58,
            "reason": "candidate_is_considering",
            "sourceText": safe_text(raw, 160),
        }

    accept_patterns = (
        r"可以接受",
        r"能接受",
        r"可以",
        r"接受",
        r"有的",
        r"有过",
        r"有(?:相关)?(?:经验|经历)",
        r"做过",
        r"了解过",
        r"了解",
        r"熟悉",
        r"懂",
        r"会",
        r"是的",
        r"对",
        r"行的",
        r"ok",
        r"okay",
    )
    if any(re.search(pattern, compact) for pattern in accept_patterns):
        return {
            "status": "accept",
            "confidence": 0.78,
            "reason": "explicit_accept_or_has_required_experience",
            "sourceText": safe_text(raw, 160),
        }

    return {
        "status": "unclear",
        "confidence": 0.35,
        "reason": "no_clear_position_screening_answer",
        "sourceText": safe_text(raw, 160),
    }


def compact_messages_for_screening_model(messages: list[dict], limit: int = SCREENING_MODEL_MESSAGE_LIMIT) -> list[dict]:
    if not isinstance(messages, list):
        return []
    compacted: list[dict] = []
    start = max(0, len(messages) - max(4, int(limit or SCREENING_MODEL_MESSAGE_LIMIT)))
    for index, item in enumerate(messages[start:], start=start):
        if not isinstance(item, dict):
            continue
        text = safe_text(str(item.get("text") or "").strip(), 220)
        if not text or not is_effective_chat_text(text):
            continue
        sender = str(item.get("sender") or "unknown")
        if sender not in {"me", "other", "unknown"}:
            sender = "unknown"
        compacted.append({
            "index": index,
            "sender": sender,
            "text": text,
            "time": safe_text(str(item.get("time") or ""), 30),
        })
    return compacted


def question_by_id_or_text(questions: list[dict], question_id: str = "", question_text: str = "") -> dict:
    question_id = str(question_id or "").strip()
    question_text = str(question_text or "").strip()
    question_text_compact = compact_position_screening_text(question_text)
    if question_id:
        for question in questions:
            if str(question.get("id") or "").strip() == question_id:
                return question
    if question_text_compact:
        for question in questions:
            if position_screening_question_matches_any(question_text, question):
                return question
            if compact_position_screening_text(str(question.get("text") or "")) == question_text_compact:
                return question
    return {}


def normalize_screening_status(value: str) -> str:
    status = str(value or "").strip().lower()
    aliases = {
        "pass": "accept",
        "passed": "accept",
        "accepted": "accept",
        "yes": "accept",
        "fail": "reject",
        "failed": "reject",
        "rejected": "reject",
        "no": "reject",
        "unknown": "unclear",
        "pending": "waiting",
    }
    status = aliases.get(status, status)
    return status if status in {"not_asked", "waiting", "accept", "reject", "unclear"} else "unclear"


def normalize_model_condition_results(model_result: dict, questions: list[dict], fallback_progress: list[dict] | None = None) -> list[dict]:
    fallback_progress = fallback_progress if isinstance(fallback_progress, list) else []
    fallback_by_id: dict[str, dict] = {}
    for item in fallback_progress:
        if not isinstance(item, dict):
            continue
        question = item.get("question") if isinstance(item.get("question"), dict) else {}
        qid = str(question.get("id") or "").strip()
        if qid:
            fallback_by_id[qid] = item

    raw_results = model_result.get("conditionResults")
    if not isinstance(raw_results, list):
        raw_results = model_result.get("conditions") if isinstance(model_result.get("conditions"), list) else []
    raw_by_id: dict[str, dict] = {}
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        matched = question_by_id_or_text(
            questions,
            str(item.get("id") or item.get("questionId") or ""),
            str(item.get("question") or item.get("text") or ""),
        )
        qid = str(matched.get("id") or item.get("id") or item.get("questionId") or "").strip()
        if qid:
            raw_by_id[qid] = item

    normalized: list[dict] = []
    for question in questions:
        qid = str(question.get("id") or "").strip()
        raw = raw_by_id.get(qid, {})
        fallback = fallback_by_id.get(qid, {})
        fallback_status = str(fallback.get("status") or "")
        status = normalize_screening_status(str(raw.get("status") or raw.get("judgement") or fallback_status or "not_asked"))
        evidence = safe_text(str(raw.get("evidence") or raw.get("sourceText") or raw.get("answer") or fallback.get("answerText") or ""), 180)
        try:
            confidence = float(raw.get("confidence") if raw.get("confidence") is not None else (fallback.get("judgement") or {}).get("confidence", 0.0))
        except Exception:
            confidence = 0.0
        fallback_asked = bool(fallback.get("asked")) if fallback else False
        asked = raw.get("asked")
        if asked is None:
            asked = fallback_asked if fallback else status not in {"not_asked"}
        if not fallback_asked:
            evidence_matches_question = bool(evidence) and position_screening_question_matches_any(evidence, question)
            if not evidence_matches_question:
                asked = False
                status = "not_asked"
        normalized.append({
            "question": question,
            "asked": bool(asked),
            "answerText": evidence,
            "status": status,
            "judgement": {
                "status": status,
                "confidence": confidence,
                "reason": safe_text(str(raw.get("reason") or raw.get("basis") or (fallback.get("judgement") or {}).get("reason") or ""), 120),
                "sourceText": evidence,
            },
            "modelEvidence": evidence,
        })
    return normalized


def enforce_screening_mode_decision(
    model_result: dict,
    questions: list[dict],
    progress: list[dict],
    mode: str,
) -> tuple[str, str, dict]:
    requested_status = normalize_screening_status(str(model_result.get("status") or model_result.get("decision") or "unclear"))
    mode = str(mode or "ask_required_questions").strip() or "ask_required_questions"
    accepted = [item for item in progress if item.get("status") == "accept"]
    rejected = [item for item in progress if item.get("status") == "reject"]
    waiting = [item for item in progress if item.get("status") == "waiting"]
    unclear = [item for item in progress if item.get("status") == "unclear"]
    not_asked = [item for item in progress if item.get("status") == "not_asked"]
    required_questions = [item for item in questions if item.get("required", True)]
    required_ids = {str(item.get("id") or "") for item in required_questions}
    accepted_required = [
        item for item in accepted
        if str((item.get("question") or {}).get("id") or "") in required_ids
    ]
    rejected_required = [
        item for item in rejected
        if str((item.get("question") or {}).get("id") or "") in required_ids
    ]

    if mode == "ask_any_required_question":
        if accepted_required:
            return "accept", "model_any_required_question_accepted", accepted_required[0].get("question") or {}
        if len(rejected_required) >= len(required_questions) and required_questions:
            return "reject", "model_all_any_required_questions_rejected", rejected_required[-1].get("question") or {}
        if waiting:
            return "waiting", "model_waiting_for_any_required_question_answer", waiting[0].get("question") or {}
        if not_asked:
            return "not_asked", "model_need_ask_next_any_required_question", not_asked[0].get("question") or {}
        if unclear:
            return "unclear", "model_any_required_question_unclear", unclear[-1].get("question") or {}
        return requested_status, "model_any_required_question_decision", {}

    if rejected_required:
        return "reject", "model_required_question_rejected", rejected_required[0].get("question") or {}
    if required_questions and len(accepted_required) >= len(required_questions):
        return "accept", "model_all_required_questions_accepted", accepted_required[-1].get("question") or {}
    if waiting:
        return "waiting", "model_waiting_for_required_question_answer", waiting[0].get("question") or {}
    if not_asked:
        return "not_asked", "model_need_ask_next_required_question", not_asked[0].get("question") or {}
    if unclear:
        return "unclear", "model_required_question_answer_unclear", unclear[0].get("question") or {}
    return requested_status, "model_required_question_decision", {}


def build_model_screening_analysis(
    model_result: dict,
    questions: list[dict],
    progress: list[dict],
    mode: str,
    context: dict,
    fallback: dict,
    flow_name: str,
) -> dict:
    status, reason, decision_question = enforce_screening_mode_decision(model_result, questions, progress, mode)
    raw_status = normalize_screening_status(str(model_result.get("status") or model_result.get("decision") or ""))
    final_reason = reason if raw_status and raw_status != status else str(model_result.get("reason") or reason)
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    latest_answer_text = safe_text(
        str(model_result.get("latestAnswerText") or model_result.get("evidence") or (last_other or {}).get("text") or ""),
        180,
    )
    analysis = {
        **fallback,
        "status": status,
        "reason": safe_text(str(final_reason), 120),
        "mode": mode,
        "questions": questions,
        "progress": progress,
        "decisionQuestion": decision_question,
        "lastOther": last_other,
        "latestAnswerText": latest_answer_text,
        "modelDecision": {
            "enabled": True,
            "flow": flow_name,
            "rawStatus": safe_text(str(model_result.get("status") or model_result.get("decision") or ""), 40),
            "reason": safe_text(str(model_result.get("reason") or ""), 160),
            "confidence": model_result.get("confidence"),
            "summary": safe_text(str(model_result.get("summary") or model_result.get("analysis") or ""), 220),
            "shouldRequestResume": bool(model_result.get("shouldRequestResume")) and status == "accept",
            "shouldSkip": bool(model_result.get("shouldSkip")),
        },
    }
    if status == "not_asked" and decision_question:
        analysis["nextQuestion"] = decision_question
    if status in {"accept", "reject", "unclear"}:
        analysis["decisionBasis"] = build_screening_decision_basis(
            status,
            analysis.get("reason") or "",
            basic_message=fallback.get("basicMessage") if isinstance(fallback.get("basicMessage"), dict) else {},
            last_other=last_other,
            other_messages=recent_unanswered_other_messages(context, max_count=5),
            judgement={
                "reason": analysis.get("reason") or "",
                "confidence": model_result.get("confidence"),
            },
            decision_message=last_other,
        )
    return analysis


def ask_agent_model_for_position_screening_decision(
    context: dict,
    screening: dict,
    rule_analysis: dict,
    previous_state: dict | None = None,
) -> dict:
    if not has_model_key():
        return {}
    questions = normalize_position_screening_questions(screening)
    if not questions:
        return {}
    messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    has_screening_signal = bool(previous_state.get("lastQuestion"))
    if not has_screening_signal:
        for item in messages:
            if not isinstance(item, dict) or item.get("sender") != "me":
                continue
            if any(position_screening_question_matches_any(str(item.get("text") or ""), question) for question in questions):
                has_screening_signal = True
                break
    if not has_screening_signal and str(rule_analysis.get("status") or "") == "not_asked":
        return {}

    compact_messages = compact_messages_for_screening_model(messages)
    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        return {}
    compact_screening = {
        "mode": str(screening.get("mode") or "ask_required_questions"),
        "passRule": safe_text(str(screening.get("passRule") or ""), 220),
        "failRule": safe_text(str(screening.get("failRule") or ""), 220),
        "questions": questions,
    }
    system_prompt = """
你是招聘自动化里的“岗位筛选结构化判定器”，不是自由聊天助手。
你只能根据岗位 screening 配置和聊天记录判断候选人是否满足当前岗位筛选问题。

规则：
1. 不要新增筛选条件，不要修改岗位原本要问的问题，只能围绕 input.screening.questions 判断。
2. 每个 conditionResults 必须对应一个配置里的 question id。
3. 如果我方问了一个筛选问题，候选人的后续回复可能同时回答多个问题；你要把这些回答映射到所有对应条件。
4. 如果没有问过某个必问问题，且候选人也没有明确主动回答它，该条件是 not_asked。
5. ask_required_questions：任意必问项明确不满足 => reject；所有必问项明确满足 => accept；缺少必问项 => not_asked 或 waiting/unclear。
6. ask_any_required_question：任意一个问题明确满足 => accept；所有问题都明确不满足 => reject；否则继续问/等待。
7. “考虑下/再看看/了解一下/晚点说”是 unclear，不是 accept。
8. 候选人发简历、附件、PDF，不能单独视为通过；只有筛选条件满足时 shouldRequestResume 才能为 true。
9. 只输出 JSON，不要 Markdown。

输出格式：
{
  "status": "not_asked | waiting | accept | reject | unclear",
  "reason": "简短原因",
  "confidence": 0.0,
  "conditionResults": [
    {"id": "question id", "status": "not_asked | waiting | accept | reject | unclear", "asked": true, "evidence": "候选人原话", "reason": "原因", "confidence": 0.0}
  ],
  "nextQuestionId": "下一条需要问的问题id，若不需要则为空",
  "shouldRequestResume": false,
  "shouldSkip": false,
  "summary": "一句话说明依据"
}
""".strip()
    user_prompt = {
        "appliedPosition": context.get("appliedPosition") or "",
        "screening": compact_screening,
        "messages": compact_messages,
        "previousState": {
            "status": previous_state.get("status") or "",
            "lastQuestionId": previous_state.get("lastQuestionId") or "",
            "lastQuestion": previous_state.get("lastQuestion") or "",
        },
        "ruleAnalysis": {
            "status": rule_analysis.get("status") or "",
            "reason": rule_analysis.get("reason") or "",
            "latestAnswerText": rule_analysis.get("latestAnswerText") or "",
        },
    }
    payload = {
        "model": PROACTIVE_SEMANTIC_MODEL or config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.05,
        "response_format": {"type": "json_object"},
    }
    content = call_chat_completion(config, api_key, payload, timeout=SCREENING_MODEL_TIMEOUT_SECONDS)
    parsed = parse_json_object(content)
    return parsed if isinstance(parsed, dict) else {}


def normalize_candidate_conversation_review(raw: dict, context: dict, previous_state: dict | None = None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    status = str(raw.get("acceptanceStatus") or raw.get("acceptance") or raw.get("basicConditionStatus") or "").strip().lower()
    status_aliases = {
        "accepted": "accept",
        "yes": "accept",
        "pass": "accept",
        "rejected": "reject",
        "no": "reject",
        "unknown": "unclear",
        "pending": "waiting",
    }
    status = status_aliases.get(status, status)
    if status not in {"accept", "reject", "unclear", "waiting", ""}:
        status = "unclear"

    def clean_question_items(values: object) -> list[dict]:
        cleaned: list[dict] = []
        if not isinstance(values, list):
            return cleaned
        for item in values[:RECENT_UNANSWERED_OTHER_LIMIT * 2]:
            if not isinstance(item, dict):
                continue
            text = safe_text(str(item.get("text") or item.get("question") or item.get("sourceText") or ""), 180)
            if not text:
                continue
            try:
                message_index = int(item.get("messageIndex"))
            except Exception:
                message_index = None
            cleaned.append({
                "text": text,
                "question": text,
                "topic": safe_text(str(item.get("topic") or item.get("topicHint") or ""), 60),
                "sourceText": safe_text(str(item.get("sourceText") or text), 180),
                "messageIndex": message_index,
                "time": safe_text(str(item.get("time") or ""), 30),
                "answered": bool(item.get("answered", False)),
                "reason": safe_text(str(item.get("reason") or ""), 120),
            })
        return cleaned[-RECENT_UNANSWERED_OTHER_LIMIT:]

    def clean_answered_items(values: object) -> list[dict]:
        cleaned: list[dict] = []
        if not isinstance(values, list):
            return cleaned
        for item in values[:12]:
            if not isinstance(item, dict):
                continue
            text = safe_text(str(item.get("text") or item.get("question") or ""), 180)
            answer = safe_text(str(item.get("answer") or item.get("reply") or ""), 120)
            if not text and not answer:
                continue
            cleaned.append({
                "text": text,
                "answer": answer,
                "topic": safe_text(str(item.get("topic") or item.get("topicHint") or ""), 60),
                "reason": safe_text(str(item.get("reason") or ""), 120),
            })
        return cleaned

    unanswered = clean_question_items(raw.get("unansweredQuestions") or raw.get("pendingQuestions") or raw.get("questionsToAnswer"))
    answered = clean_answered_items(raw.get("answeredQuestions") or raw.get("resolvedQuestions"))
    actions_done = raw.get("actionsDone") if isinstance(raw.get("actionsDone"), list) else raw.get("handledActions") if isinstance(raw.get("handledActions"), list) else []
    review = {
        "modelEnabled": True,
        "acceptanceStatus": status,
        "pendingReplyNeeded": bool(raw.get("pendingReplyNeeded") or raw.get("needsReply") or unanswered),
        "shouldRequestResume": bool(raw.get("shouldRequestResume")),
        "shouldSkip": bool(raw.get("shouldSkip")),
        "recommendedNextAction": safe_text(str(raw.get("recommendedNextAction") or raw.get("nextAction") or ""), 60),
        "summary": safe_text(str(raw.get("summary") or raw.get("conversationSummary") or ""), 500),
        "unansweredQuestions": unanswered,
        "answeredQuestions": answered,
        "actionsDone": [safe_text(str(item), 80) for item in actions_done[:12]],
        "rawConfidence": raw.get("confidence"),
        "lastOtherSignature": str((context.get("lastOtherSignature") or "")) if isinstance(context, dict) else "",
        "previousStatus": safe_text(str(previous_state.get("status") or ""), 40),
    }
    return review


def ask_agent_model_for_candidate_conversation_review(
    context: dict,
    previous_state: dict | None = None,
    rule_analysis: dict | None = None,
) -> dict:
    if not has_model_key():
        return {}
    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        return {}
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    compact_messages = compact_messages_for_screening_model(messages, limit=SCREENING_MODEL_MESSAGE_LIMIT)
    if not compact_messages:
        return {}
    kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    memory = context.get("memory") if isinstance(context.get("memory"), dict) else {}
    rule_pending = [
        {
            "text": safe_text(str(item.get("text") or ""), 180),
            "time": safe_text(str(item.get("time") or ""), 30),
            "signature": chat_message_signature(item),
        }
        for item in recent_unanswered_other_messages(context, previous_state)
        if isinstance(item, dict)
    ]
    system_prompt = """
你是招聘智能体里的“候选人会话复盘器”，不是自由聊天助手。
你的任务是阅读近几轮 BOSS 招聘聊天，结构化判断候选人说了什么、我们处理过什么、还有哪些问题没回复、候选人是否接受基础条件，以及下一步应该做什么。

必须遵守：
1. 以 messages 为准，sender=other 是候选人，sender=me 是我方。
2. 判断 unansweredQuestions 时，不要只看问号；“加班时间和工作时间”“住宿情况”“薪资待遇”这种名词式追问也算问题。
3. 如果候选人同一轮既表示接受，又追问问题，应同时输出 acceptanceStatus=accept 和 unansweredQuestions，recommendedNextAction 应是 answer_then_request_resume。
4. 如果我方后续消息已经回答过某个问题，不要把它放进 unansweredQuestions。
5. 不要编造知识库里没有的信息；这里只做结构化判断，不直接生成长回复。
6. 未配置岗位或没有知识库时，也要如实输出 pending 问题，但 shouldRequestResume 不要乱设 true。
7. 只输出 JSON，不要 Markdown。

输出格式：
{
  "acceptanceStatus": "accept | reject | unclear | waiting",
  "pendingReplyNeeded": true,
  "unansweredQuestions": [
    {"text": "候选人未回复的问题", "messageIndex": 12, "sourceText": "候选人原话", "topic": "工时/住宿/薪资等", "reason": "为什么未回复"}
  ],
  "answeredQuestions": [
    {"text": "已回答的问题", "answer": "我方已回答内容", "topic": "主题"}
  ],
  "actionsDone": ["已发送基础情况", "已求简历", "已答疑"],
  "shouldRequestResume": false,
  "shouldSkip": false,
  "recommendedNextAction": "answer_only | request_resume | answer_then_request_resume | send_basic_conditions | skip | wait",
  "summary": "一句话总结当前候选人状态",
  "confidence": 0.0
}
""".strip()
    user_prompt = {
        "appliedPosition": context.get("appliedPosition") or "",
        "candidate": (context.get("applicant") if isinstance(context.get("applicant"), dict) else {}),
        "messages": compact_messages,
        "memory": {
            "summary": safe_text(str(memory.get("summary") or ""), 500),
            "recentMyMessages": list(memory.get("recentMyMessages") or [])[-6:],
            "recentOtherMessages": list(memory.get("recentOtherMessages") or [])[-6:],
        },
        "knowledgeBase": compact_company_knowledge_base_for_model(kb) if kb.get("enabled") else {},
        "previousState": {
            "status": previous_state.get("status") or "",
            "stage": previous_state.get("stage") or "",
            "knowledgeAnsweredSignatures": previous_state.get("knowledgeAnsweredSignatures") or [],
            "conversationReview": previous_state.get("conversationReview") if isinstance(previous_state.get("conversationReview"), dict) else {},
        },
        "ruleSignals": {
            "ruleAnalysis": rule_analysis if isinstance(rule_analysis, dict) else {},
            "recentUnansweredOtherMessages": rule_pending,
        },
    }
    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.05,
        "response_format": {"type": "json_object"},
    }
    content = call_chat_completion(config, api_key, payload, timeout=SCREENING_MODEL_TIMEOUT_SECONDS)
    parsed = parse_json_object(content)
    return parsed if isinstance(parsed, dict) else {}


def ensure_candidate_conversation_review(
    context: dict,
    previous_state: dict | None = None,
    rule_analysis: dict | None = None,
) -> dict:
    if not isinstance(context, dict):
        return {}
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    existing = context.get("conversationReview")
    if isinstance(existing, dict) and existing.get("modelEnabled"):
        return existing
    previous_review = previous_state.get("conversationReview") if isinstance(previous_state.get("conversationReview"), dict) else {}
    current_last_other_signature = str(context.get("lastOtherSignature") or "").strip()
    previous_last_other_signature = str(previous_review.get("lastOtherSignature") or "").strip()
    if (
        previous_review.get("modelEnabled")
        and current_last_other_signature
        and previous_last_other_signature == current_last_other_signature
    ):
        context["conversationReview"] = previous_review
        if isinstance(context.get("memory"), dict):
            context["memory"]["conversationReview"] = compact_candidate_conversation_review(previous_review)
        return previous_review
    try:
        raw = ask_agent_model_for_candidate_conversation_review(context, previous_state, rule_analysis)
    except Exception as error:
        review = {
            "modelEnabled": False,
            "error": safe_text(str(error), 180),
            "summary": "",
            "unansweredQuestions": [],
            "answeredQuestions": [],
        }
        context["conversationReview"] = review
        return review
    if not raw:
        return {}
    review = normalize_candidate_conversation_review(raw, context, previous_state)
    context["conversationReview"] = review
    if isinstance(context.get("memory"), dict):
        context["memory"]["conversationReview"] = compact_candidate_conversation_review(review)
    return review


def enhance_position_screening_with_model(
    context: dict,
    screening: dict,
    rule_analysis: dict,
    previous_state: dict | None = None,
) -> dict:
    questions = normalize_position_screening_questions(screening)
    if not questions:
        return rule_analysis
    if (
        str(rule_analysis.get("status") or "") == "reject"
        and str(rule_analysis.get("reason") or "") == "candidate_message_matched_disqualifying_pattern"
    ):
        preserved = dict(rule_analysis)
        preserved["modelDecision"] = {
            "enabled": False,
            "flow": "position_screening",
            "reason": "rule_disqualifying_message_preserved",
        }
        return preserved
    try:
        model_result = ask_agent_model_for_position_screening_decision(context, screening, rule_analysis, previous_state)
    except Exception as error:
        enriched = dict(rule_analysis)
        enriched["modelDecision"] = {
            "enabled": False,
            "error": safe_text(str(error), 180),
            "flow": "position_screening",
        }
        return enriched
    if not model_result:
        return rule_analysis
    progress = normalize_model_condition_results(model_result, questions, rule_analysis.get("progress") if isinstance(rule_analysis.get("progress"), list) else [])
    mode = str((screening or {}).get("mode") or rule_analysis.get("mode") or "ask_required_questions").strip() or "ask_required_questions"
    return build_model_screening_analysis(
        model_result,
        questions,
        progress,
        mode,
        context,
        rule_analysis,
        "position_screening",
    )


def ask_agent_model_for_basic_condition_decision(
    context: dict,
    phrase: str,
    rule_analysis: dict,
    previous_state: dict | None = None,
) -> dict:
    if not has_model_key():
        return {}
    messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    compact_messages = compact_messages_for_screening_model(messages)
    if not compact_messages:
        return {}
    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        return {}
    conditions = basic_condition_screening_questions()
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    system_prompt = """
你是 AI 应用开发实习生基础条件筛选的结构化判定器。
你只能根据我方已发送的基础情况话术、候选人最近回复、以及硬性条件判断是否可以求简历。

硬性条件：
- 日薪150能否接受
- 单休能否接受
- 线下工作能否接受
- 至少实习六个月能否接受
- 工作地点能否接受

规则：
1. “基本情况可以/都能接受/这些都可以/没问题”可以视为所有硬性条件 accept。
2. “工作地点可以接受/地点能接受”只代表工作地点，不代表薪资、单休、线下、六个月都接受。
3. 候选人只问问题、只发简历、只发附件、只说可以发简历，都不能单独视为 accept。
4. 候选人明确不能线下、不能单休、不能实习六个月、不接受薪资/日薪150、不能接受工作地点 => reject。
5. 候选人不能尽快到岗不是硬性拒绝；到岗时间问题只算 unclear 或知识库问答，不要 reject。
6. “考虑下/再看看/了解一下/晚点回复”是 unclear。
7. accept 只有在所有硬性条件都明确接受，或用“都能接受/基本情况都可以”总括接受时成立。
8. 如果候选人说“只能/最多/只可以实习四个月、三个月、五个月”“只能暑假 2-3 个月”“开学要回学校所以无法满六个月”等少于六个月，即使同时说“其他都接受”，也必须判 reject，six_months 条件为 reject。
9. 只输出 JSON，不要 Markdown。

输出格式：
{
  "status": "waiting | accept | reject | unclear",
  "reason": "简短原因",
  "confidence": 0.0,
  "conditionResults": [
    {"id": "salary", "status": "accept | reject | unclear | waiting", "evidence": "候选人原话", "reason": "原因", "confidence": 0.0}
  ],
  "shouldRequestResume": false,
  "shouldSkip": false,
  "summary": "一句话说明依据"
}
""".strip()
    user_prompt = {
        "appliedPosition": context.get("appliedPosition") or "",
        "basicPhrase": safe_text(str(phrase or ""), 360),
        "hardConditions": conditions,
        "messages": compact_messages,
        "previousState": {
            "status": previous_state.get("status") or "",
            "lastScreening": previous_state.get("lastScreening") or "",
        },
        "ruleAnalysis": {
            "status": rule_analysis.get("status") or "",
            "reason": rule_analysis.get("reason") or "",
            "latestAnswerText": rule_analysis.get("latestAnswerText") or "",
            "decisionBasis": rule_analysis.get("decisionBasis") if isinstance(rule_analysis.get("decisionBasis"), dict) else {},
        },
    }
    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.05,
        "response_format": {"type": "json_object"},
    }
    content = call_chat_completion(config, api_key, payload, timeout=SCREENING_MODEL_TIMEOUT_SECONDS)
    parsed = parse_json_object(content)
    return parsed if isinstance(parsed, dict) else {}


def enhance_basic_condition_screening_with_model(
    context: dict,
    phrase: str,
    rule_analysis: dict,
    previous_state: dict | None = None,
) -> dict:
    if str(rule_analysis.get("status") or "") == "not_asked":
        return rule_analysis
    if str(rule_analysis.get("status") or "") == "waiting" and not isinstance(rule_analysis.get("lastOther"), dict):
        return rule_analysis
    if str(rule_analysis.get("status") or "") == "accept":
        last_other = rule_analysis.get("decisionMessage") if isinstance(rule_analysis.get("decisionMessage"), dict) else rule_analysis.get("lastOther")
        last_text = str((last_other or {}).get("text") or "")
        if (
            str(rule_analysis.get("reason") or "") == "candidate_accepted_basic_conditions"
            and is_direct_basic_condition_acceptance_reply(last_text)
        ):
            preserved = dict(rule_analysis)
            preserved["modelDecision"] = {
                "enabled": False,
                "flow": "basic_conditions",
                "reason": "direct_short_acceptance_preserved",
            }
            return preserved
    if str(rule_analysis.get("status") or "") == "reject" and str(rule_analysis.get("reason") or "") in {
        "candidate_cannot_intern_six_months",
        "candidate_internship_duration_less_than_six_months",
        "candidate_can_only_intern_until_september",
        "candidate_rejected_required_condition",
        "candidate_rejected_required_condition_before_resume_attachment",
    }:
        preserved = dict(rule_analysis)
        preserved["modelDecision"] = {
            "enabled": False,
            "flow": "basic_conditions",
            "reason": "rule_hard_reject_preserved",
        }
        return preserved
    try:
        model_result = ask_agent_model_for_basic_condition_decision(context, phrase, rule_analysis, previous_state)
    except Exception as error:
        enriched = dict(rule_analysis)
        enriched["modelDecision"] = {
            "enabled": False,
            "error": safe_text(str(error), 180),
            "flow": "basic_conditions",
        }
        return enriched
    if not model_result:
        return rule_analysis
    questions = basic_condition_screening_questions()
    progress = normalize_model_condition_results(model_result, questions, [])
    fallback = dict(rule_analysis)
    fallback.setdefault("questions", questions)
    fallback.setdefault("progress", progress)
    analysis = build_model_screening_analysis(
        model_result,
        questions,
        progress,
        "ask_required_questions",
        context,
        fallback,
        "basic_conditions",
    )
    if analysis.get("status") == "not_asked":
        analysis["status"] = "unclear"
        analysis["reason"] = "model_basic_conditions_partial_or_missing_acceptance"
        analysis.pop("nextQuestion", None)
    return analysis


def preserve_zhilian_basic_acceptance_after_model(model_analysis: dict, rule_analysis: dict, platform: str = "zhilian") -> dict:
    if not isinstance(model_analysis, dict) or not isinstance(rule_analysis, dict):
        return model_analysis
    if str(rule_analysis.get("status") or "") != "accept":
        return model_analysis
    if str(model_analysis.get("status") or "") not in {"unclear", "waiting", "not_asked"}:
        return model_analysis
    preserved = dict(rule_analysis)
    preserved["modelDecision"] = {
        "enabled": True,
        "flow": "basic_conditions",
        "reason": f"{platform}_rule_accept_preserved_after_model",
        "modelStatus": str(model_analysis.get("status") or ""),
        "modelReason": safe_text(str(model_analysis.get("reason") or ""), 160),
    }
    preserved["modelOverrideIgnored"] = {
        "status": str(model_analysis.get("status") or ""),
        "reason": safe_text(str(model_analysis.get("reason") or ""), 160),
        "latestAnswerText": safe_text(str(model_analysis.get("latestAnswerText") or ""), 180),
    }
    return preserved


def analyze_position_screening(messages: list[dict], screening: dict) -> dict:
    if not isinstance(messages, list):
        messages = []
    questions = normalize_position_screening_questions(screening)
    mode = str((screening or {}).get("mode") or "ask_required_questions").strip() or "ask_required_questions"
    if not questions:
        return {
            "status": "not_configured",
            "reason": "position_screening_questions_missing",
            "questions": [],
        }
    disqualifying = match_position_screening_disqualifying_message(messages, screening)
    if disqualifying.get("matched"):
        message = disqualifying.get("message") if isinstance(disqualifying.get("message"), dict) else {}
        answer_text = str(message.get("text") or "").strip()
        return {
            "status": "reject",
            "reason": "candidate_message_matched_disqualifying_pattern",
            "mode": mode,
            "questions": questions,
            "progress": [
                {
                    "question": {
                        "id": disqualifying.get("id") or "disqualifying_candidate_message",
                        "text": disqualifying.get("reason") or "候选人消息命中岗位不匹配规则",
                        "required": True,
                    },
                    "asked": False,
                    "askedMessage": {},
                    "answerMessages": [message] if message else [],
                    "answerText": safe_text(answer_text, 180),
                    "judgement": {
                        "status": "reject",
                        "confidence": 0.92,
                        "reason": disqualifying.get("reason") or "candidate_message_matched_disqualifying_pattern",
                        "sourceText": safe_text(answer_text, 160),
                    },
                    "status": "reject",
                }
            ],
            "decisionQuestion": {
                "id": disqualifying.get("id") or "disqualifying_candidate_message",
                "text": disqualifying.get("reason") or "候选人消息命中岗位不匹配规则",
                "required": True,
            },
            "lastOther": message,
            "latestAnswerText": safe_text(answer_text, 180),
            "disqualifyingPattern": disqualifying,
        }

    progress: list[dict] = []
    latest_answer_text = ""
    for question in questions:
        asked_index = -1
        asked_message: dict = {}
        for index, item in enumerate(messages):
            if not isinstance(item, dict) or item.get("sender") != "me":
                continue
            if position_screening_question_matches_any(str(item.get("text") or ""), question):
                asked_index = index
                asked_message = item

        answer_messages: list[dict] = []
        if asked_index >= 0:
            for item in messages[asked_index + 1:]:
                if not isinstance(item, dict):
                    continue
                if item.get("sender") == "me" and any(
                    position_screening_question_matches_any(str(item.get("text") or ""), other)
                    for other in questions
                ):
                    break
                if item.get("sender") != "other":
                    continue
                text = str(item.get("text") or "").strip()
                if not is_effective_chat_text(text):
                    continue
                answer_messages.append(item)
        answer_text = "\n".join(str(item.get("text") or "").strip() for item in answer_messages[-3:] if str(item.get("text") or "").strip())
        if answer_text:
            latest_answer_text = answer_text
        judgement = classify_position_screening_answer(str(question.get("text") or ""), answer_text) if answer_text else {
            "status": "waiting" if asked_index >= 0 else "not_asked",
            "confidence": 0.0,
            "reason": "question_not_asked" if asked_index < 0 else "waiting_for_candidate_reply",
            "sourceText": "",
        }
        progress.append({
            "question": question,
            "asked": asked_index >= 0,
            "askedMessage": asked_message,
            "answerMessages": answer_messages[-3:],
            "answerText": safe_text(answer_text, 180),
            "judgement": judgement,
            "status": judgement.get("status") or "unclear",
        })

    rejected = [item for item in progress if item.get("status") == "reject"]
    accepted = [item for item in progress if item.get("status") == "accept"]
    waiting = [item for item in progress if item.get("status") == "waiting"]
    unclear = [item for item in progress if item.get("status") == "unclear"]
    not_asked = [item for item in progress if item.get("status") == "not_asked"]

    if mode == "ask_any_required_question":
        if accepted:
            return {
                "status": "accept",
                "reason": "any_required_question_accepted",
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "decisionQuestion": accepted[0].get("question"),
                "lastOther": (accepted[0].get("answerMessages") or [{}])[-1] if accepted[0].get("answerMessages") else {},
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        if len(rejected) >= len(questions):
            return {
                "status": "reject",
                "reason": "all_any_required_questions_rejected",
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "decisionQuestion": rejected[-1].get("question") if rejected else {},
                "lastOther": (rejected[-1].get("answerMessages") or [{}])[-1] if rejected and rejected[-1].get("answerMessages") else {},
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        if waiting:
            return {
                "status": "waiting",
                "reason": "waiting_for_any_required_question_answer",
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "decisionQuestion": waiting[0].get("question"),
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        if not_asked:
            return {
                "status": "not_asked",
                "reason": "need_ask_next_any_required_question",
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "nextQuestion": not_asked[0].get("question"),
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        return {
            "status": "unclear",
            "reason": "any_required_question_unclear",
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "lastOther": (unclear[-1].get("answerMessages") or [{}])[-1] if unclear and unclear[-1].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }

    if rejected:
        return {
            "status": "reject",
            "reason": "required_question_rejected",
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": rejected[0].get("question"),
            "lastOther": (rejected[0].get("answerMessages") or [{}])[-1] if rejected[0].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if len(accepted) >= len(questions):
        return {
            "status": "accept",
            "reason": "all_required_questions_accepted",
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": accepted[-1].get("question") if accepted else {},
            "lastOther": (accepted[-1].get("answerMessages") or [{}])[-1] if accepted and accepted[-1].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if waiting:
        return {
            "status": "waiting",
            "reason": "waiting_for_required_question_answer",
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": waiting[0].get("question"),
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if unclear:
        return {
            "status": "unclear",
            "reason": "required_question_answer_unclear",
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": unclear[0].get("question"),
            "lastOther": (unclear[0].get("answerMessages") or [{}])[-1] if unclear[0].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if not_asked:
        return {
            "status": "not_asked",
            "reason": "need_ask_next_required_question",
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "nextQuestion": not_asked[0].get("question"),
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    return {
        "status": "unclear",
        "reason": "position_screening_fallback_unclear",
        "mode": mode,
        "questions": questions,
        "progress": progress,
        "latestAnswerText": safe_text(latest_answer_text, 180),
    }


def build_position_screening_analysis_from_progress(
    questions: list[dict],
    progress: list[dict],
    mode: str,
    latest_answer_text: str,
    reason_prefix: str = "",
) -> dict:
    rejected = [item for item in progress if item.get("status") == "reject"]
    accepted = [item for item in progress if item.get("status") == "accept"]
    waiting = [item for item in progress if item.get("status") == "waiting"]
    unclear = [item for item in progress if item.get("status") == "unclear"]
    not_asked = [item for item in progress if item.get("status") == "not_asked"]
    reason_prefix = str(reason_prefix or "").strip()

    def with_reason(reason: str) -> str:
        return f"{reason_prefix}:{reason}" if reason_prefix else reason

    if mode == "ask_any_required_question":
        if accepted:
            return {
                "status": "accept",
                "reason": with_reason("any_required_question_accepted"),
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "decisionQuestion": accepted[0].get("question"),
                "lastOther": (accepted[0].get("answerMessages") or [{}])[-1] if accepted[0].get("answerMessages") else {},
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        if len(rejected) >= len(questions):
            return {
                "status": "reject",
                "reason": with_reason("all_any_required_questions_rejected"),
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "decisionQuestion": rejected[-1].get("question") if rejected else {},
                "lastOther": (rejected[-1].get("answerMessages") or [{}])[-1] if rejected and rejected[-1].get("answerMessages") else {},
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        if waiting:
            return {
                "status": "waiting",
                "reason": with_reason("waiting_for_any_required_question_answer"),
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "decisionQuestion": waiting[0].get("question"),
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        if not_asked:
            return {
                "status": "not_asked",
                "reason": with_reason("need_ask_next_any_required_question"),
                "mode": mode,
                "questions": questions,
                "progress": progress,
                "nextQuestion": not_asked[0].get("question"),
                "latestAnswerText": safe_text(latest_answer_text, 180),
            }
        return {
            "status": "unclear",
            "reason": with_reason("any_required_question_unclear"),
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "lastOther": (unclear[-1].get("answerMessages") or [{}])[-1] if unclear and unclear[-1].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }

    if rejected:
        return {
            "status": "reject",
            "reason": with_reason("required_question_rejected"),
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": rejected[0].get("question"),
            "lastOther": (rejected[0].get("answerMessages") or [{}])[-1] if rejected[0].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if len(accepted) >= len(questions):
        return {
            "status": "accept",
            "reason": with_reason("all_required_questions_accepted"),
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": accepted[-1].get("question") if accepted else {},
            "lastOther": (accepted[-1].get("answerMessages") or [{}])[-1] if accepted and accepted[-1].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if waiting:
        return {
            "status": "waiting",
            "reason": with_reason("waiting_for_required_question_answer"),
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": waiting[0].get("question"),
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if unclear:
        return {
            "status": "unclear",
            "reason": with_reason("required_question_answer_unclear"),
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "decisionQuestion": unclear[0].get("question"),
            "lastOther": (unclear[0].get("answerMessages") or [{}])[-1] if unclear[0].get("answerMessages") else {},
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    if not_asked:
        return {
            "status": "not_asked",
            "reason": with_reason("need_ask_next_required_question"),
            "mode": mode,
            "questions": questions,
            "progress": progress,
            "nextQuestion": not_asked[0].get("question"),
            "latestAnswerText": safe_text(latest_answer_text, 180),
        }
    return {
        "status": "unclear",
        "reason": with_reason("position_screening_fallback_unclear"),
        "mode": mode,
        "questions": questions,
        "progress": progress,
        "latestAnswerText": safe_text(latest_answer_text, 180),
    }


def repair_position_screening_with_waiting_state_reply(analysis: dict, previous_state: dict, context: dict) -> dict:
    if not isinstance(analysis, dict) or str(analysis.get("status") or "") not in {"not_asked", "waiting", "unclear"}:
        return analysis
    if not isinstance(previous_state, dict) or previous_state.get("status") not in {"position_screening_sent_waiting", "position_screening_waiting"}:
        return analysis
    previous_question_text = str(previous_state.get("lastQuestion") or previous_state.get("lastQuestionCanonical") or "").strip()
    if not previous_question_text:
        return analysis
    last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    last_text = str(last_other.get("text") or "").strip()
    if last_message.get("sender") != "other" or not last_text:
        return analysis
    judgement = classify_position_screening_answer(previous_question_text, last_text)
    if judgement.get("status") not in {"accept", "reject"}:
        return analysis

    questions = analysis.get("questions") if isinstance(analysis.get("questions"), list) else []
    progress = [dict(item) for item in analysis.get("progress", []) if isinstance(item, dict)]
    previous_question = question_by_id_or_text(
        questions,
        str(previous_state.get("lastQuestionId") or ""),
        previous_question_text,
    )
    if not previous_question:
        previous_question = {"id": safe_text(str(previous_state.get("lastQuestionId") or ""), 60), "text": previous_question_text}

    updated = False
    previous_qid = str(previous_question.get("id") or "").strip()
    for item in progress:
        question = item.get("question") if isinstance(item.get("question"), dict) else {}
        same_question = bool(
            (previous_qid and str(question.get("id") or "").strip() == previous_qid)
            or position_screening_question_matches_any(previous_question_text, question)
            or position_screening_question_matches(str(question.get("text") or ""), previous_question_text)
        )
        if not same_question:
            continue
        item.update({
            "asked": True,
            "askedMessage": {"sender": "me", "text": previous_question_text},
            "answerMessages": [last_other],
            "answerText": safe_text(last_text, 180),
            "judgement": judgement,
            "status": judgement.get("status") or "unclear",
            "repairedFromWaitingState": True,
        })
        updated = True
        break

    if not updated:
        progress.insert(0, {
            "question": previous_question,
            "asked": True,
            "askedMessage": {"sender": "me", "text": previous_question_text},
            "answerMessages": [last_other],
            "answerText": safe_text(last_text, 180),
            "judgement": judgement,
            "status": judgement.get("status") or "unclear",
            "repairedFromWaitingState": True,
        })

    repaired = build_position_screening_analysis_from_progress(
        questions or [item.get("question") for item in progress if isinstance(item.get("question"), dict)],
        progress,
        str(analysis.get("mode") or "ask_required_questions"),
        last_text,
        "waiting_state_latest_reply",
    )
    repaired["repairedFromWaitingState"] = True
    repaired["originalAnalysis"] = {
        "status": str(analysis.get("status") or ""),
        "reason": safe_text(str(analysis.get("reason") or ""), 160),
    }
    return repaired

