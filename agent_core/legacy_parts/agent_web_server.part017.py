def load_zhilian_recruiter_skill_text() -> str:
    try:
        text = ZHILIAN_RECRUITER_SKILL_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        return ""
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            text = parts[2].strip()
    return safe_text(text, 5000)


def select_company_knowledge_base(rules: dict, applied_position: str = "") -> dict:
    if not isinstance(rules, dict):
        return {}
    applied_position_clean = clean_applied_position(applied_position)
    cache_key = (id(rules), applied_position_clean)
    with BOSS_CHAT_RULES_CACHE_LOCK:
        cached = COMPANY_KNOWLEDGE_SELECTION_CACHE.get(cache_key)
        if isinstance(cached, dict):
            return cached
    kb = rules.get("companyKnowledgeBase")
    if not isinstance(kb, dict) or not kb.get("enabled"):
        with BOSS_CHAT_RULES_CACHE_LOCK:
            COMPANY_KNOWLEDGE_SELECTION_CACHE[cache_key] = {}
        return {}

    common = kb.get("common") if isinstance(kb.get("common"), dict) else {}
    sections = kb.get("sections") if isinstance(kb.get("sections"), dict) else {}
    default_title = safe_text(str(kb.get("defaultTitle") or ""), 60)
    selected_title = ""
    selected_section: dict = {}
    selected_score = -1

    for title, section in sections.items():
        if not isinstance(section, dict):
            continue
        match_values = [str(title or "")]
        aliases = section.get("aliases") if isinstance(section.get("aliases"), list) else []
        positions = section.get("matchPositions") if isinstance(section.get("matchPositions"), list) else []
        match_values.extend(str(item or "") for item in aliases + positions)
        section_score = -1
        for value in match_values:
            value_clean = clean_applied_position(value)
            if value_clean and applied_position_clean and (
                value_clean in applied_position_clean or applied_position_clean in value_clean
            ):
                match_score = len(value_clean)
                if value_clean == applied_position_clean:
                    match_score += 10000
                elif value_clean in applied_position_clean:
                    match_score += 1000
                section_score = max(section_score, match_score)
        if section_score > selected_score:
            selected_score = section_score
            selected_title = safe_text(str(title or ""), 60)
            selected_section = section
    if not selected_section:
        with BOSS_CHAT_RULES_CACHE_LOCK:
            COMPANY_KNOWLEDGE_SELECTION_CACHE[cache_key] = {}
        return {}

    base_section: dict = {}
    base_title = safe_text(str(selected_section.get("extendsSection") or selected_section.get("inheritsSection") or ""), 60)
    if base_title and base_title != selected_title:
        candidate_base = sections.get(base_title) if isinstance(sections.get(base_title), dict) else {}
        if isinstance(candidate_base, dict):
            base_section = candidate_base

    def merge_topics(*sources: dict) -> dict:
        merged: dict[str, list] = {}
        for source in sources:
            if not isinstance(source, dict):
                continue
            for key, values in source.items():
                if not isinstance(values, list):
                    continue
                bucket = merged.setdefault(str(key), [])
                for value in values:
                    if value not in bucket:
                        bucket.append(value)
        return merged

    inherit_root = selected_section.get("inheritsRoot", base_section.get("inheritsRoot", True))
    root_topics = kb.get("topics") if isinstance(kb.get("topics"), dict) else {}
    root_faq = kb.get("faq") if isinstance(kb.get("faq"), list) else []
    common_topics = common.get("topics") if isinstance(common.get("topics"), dict) else {}
    common_faq = common.get("faq") if isinstance(common.get("faq"), list) else []
    base_topics = base_section.get("topics") if isinstance(base_section.get("topics"), dict) else {}
    base_faq = base_section.get("faq") if isinstance(base_section.get("faq"), list) else []
    section_topics = selected_section.get("topics") if isinstance(selected_section.get("topics"), dict) else {}
    section_faq = selected_section.get("faq") if isinstance(selected_section.get("faq"), list) else []
    topics = merge_topics(common_topics, root_topics if inherit_root else {}, base_topics, section_topics)
    faq = []
    if common_faq:
        faq.extend(common_faq)
    if inherit_root:
        faq.extend(root_faq)
    faq.extend(base_faq)
    faq.extend(section_faq)
    answer_policy = []
    for source in (
        common.get("answerPolicy") if isinstance(common.get("answerPolicy"), list) else [],
        kb.get("answerPolicy") if isinstance(kb.get("answerPolicy"), list) else [],
        base_section.get("answerPolicy") if isinstance(base_section.get("answerPolicy"), list) else [],
        selected_section.get("answerPolicy") if isinstance(selected_section.get("answerPolicy"), list) else [],
    ):
        for item in source:
            text = safe_text(str(item), 140)
            if text and text not in answer_policy:
                answer_policy.append(text)
    silent_question_patterns = []
    for source in (
        common.get("silentQuestionPatterns") if isinstance(common.get("silentQuestionPatterns"), list) else [],
        kb.get("silentQuestionPatterns") if isinstance(kb.get("silentQuestionPatterns"), list) else [],
        base_section.get("silentQuestionPatterns") if isinstance(base_section.get("silentQuestionPatterns"), list) else [],
        selected_section.get("silentQuestionPatterns") if isinstance(selected_section.get("silentQuestionPatterns"), list) else [],
    ):
        for item in source:
            text = safe_text(str(item), 120)
            if text and text not in silent_question_patterns:
                silent_question_patterns.append(text)
    company = {}
    for source in (
        common.get("company") if isinstance(common.get("company"), dict) else {},
        kb.get("company") if isinstance(kb.get("company"), dict) else {},
        base_section.get("company") if isinstance(base_section.get("company"), dict) else {},
        selected_section.get("company") if isinstance(selected_section.get("company"), dict) else {},
    ):
        company.update(source)
    repeat_control = selected_section.get("repeatControl") if isinstance(selected_section.get("repeatControl"), dict) else base_section.get("repeatControl") if isinstance(base_section.get("repeatControl"), dict) else kb.get("repeatControl") if isinstance(kb.get("repeatControl"), dict) else {}
    unknown_reply = selected_section.get("unknownReply") or base_section.get("unknownReply") or kb.get("unknownReply") or ""
    screening = selected_section.get("screening") if isinstance(selected_section.get("screening"), dict) else base_section.get("screening") if isinstance(base_section.get("screening"), dict) else {}
    scoring = selected_section.get("scoring") if isinstance(selected_section.get("scoring"), dict) else base_section.get("scoring") if isinstance(base_section.get("scoring"), dict) else {}
    result = {
        "enabled": True,
        "title": selected_title,
        "availableTitles": [safe_text(str(title), 60) for title in sections.keys()],
        "appliedPosition": safe_text(applied_position_clean, 80),
        "description": safe_text(str(selected_section.get("description") or base_section.get("description") or kb.get("description") or ""), 200),
        "answerPolicy": answer_policy[:16],
        "silentQuestionPatterns": silent_question_patterns[:120],
        "repeatControl": repeat_control,
        "unknownReply": safe_text(str(unknown_reply), 40),
        "company": company,
        "screening": screening,
        "scoring": scoring,
        "directResume": bool(
            selected_section.get("directResume") is True
            or selected_section.get("directRequestResume") is True
            or selected_section.get("direct_resume") is True
            or base_section.get("directResume") is True
            or base_section.get("directRequestResume") is True
            or base_section.get("direct_resume") is True
        ),
        "resumeJobType": safe_text(str(selected_section.get("resumeJobType") or selected_section.get("normalizedJobType") or base_section.get("resumeJobType") or base_section.get("normalizedJobType") or ""), 40),
        "resumeRequestPrompt": safe_text(str(selected_section.get("resumeRequestPrompt") or selected_section.get("directResumePrompt") or base_section.get("resumeRequestPrompt") or base_section.get("directResumePrompt") or ""), 120),
        "topics": topics,
        "faq": faq[:80],
    }
    with BOSS_CHAT_RULES_CACHE_LOCK:
        COMPANY_KNOWLEDGE_SELECTION_CACHE[cache_key] = result
    return result


def compact_knowledge_silent_text(text: str) -> str:
    return re.sub(r"[\s，,。！？?!、；;：:（）()【】\[\]《》“”\"'`·~\-_/\\]+", "", str(text or "")).lower()


def knowledge_question_texts_from_context(context: dict) -> list[str]:
    question_messages = context.get("knowledgeQuestionMessages") if isinstance(context.get("knowledgeQuestionMessages"), list) else []
    if not question_messages:
        question_messages = recent_unanswered_question_messages(context)
    texts = [
        str(item.get("_modelUnansweredQuestionText") or item.get("text") or "").strip()
        for item in question_messages
        if isinstance(item, dict) and str(item.get("_modelUnansweredQuestionText") or item.get("text") or "").strip()
    ]
    if texts:
        return texts
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    fallback = str(context.get("knowledgeQuestionText") or last_other.get("text") or "").strip()
    return [fallback] if fallback else []


def match_company_knowledge_silent_question(context: dict) -> dict:
    kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    if not kb.get("enabled"):
        return {}
    patterns = kb.get("silentQuestionPatterns") if isinstance(kb.get("silentQuestionPatterns"), list) else []
    if not patterns:
        return {}
    question_texts = knowledge_question_texts_from_context(context)
    text = compact_knowledge_silent_text("\n".join(item for item in question_texts if item))
    if not text:
        return {}
    best_pattern = ""
    best_needle = ""
    for pattern in patterns:
        pattern_text = str(pattern or "").strip()
        needle = compact_knowledge_silent_text(pattern_text)
        if needle and needle in text and len(needle) > len(best_needle):
            best_pattern = pattern_text
            best_needle = needle
    if not best_pattern:
        return {}
    return {
        "topic": "silentQuestion",
        "answer": "",
        "source": "companyKnowledgeBase.silentQuestionPatterns",
        "answerSkipped": True,
        "silentSkipped": True,
        "skipReason": "silent_question",
        "matchedPattern": safe_text(best_pattern, 120),
        "subQueries": [safe_text(item, 80) for item in question_texts if item][:RECENT_UNANSWERED_OTHER_LIMIT],
    }


def knowledge_result_stops_flow(result: dict) -> bool:
    return bool(
        isinstance(result, dict)
        and (
            result.get("answered")
            or result.get("blocked")
            or result.get("silentSkipped")
            or result.get("skipReason") == "silent_question"
        )
    )


def zhilian_knowledge_result_blocks_resume_flow(result: dict) -> bool:
    return bool(isinstance(result, dict) and result.get("blocked"))


def match_company_knowledge_answer(context: dict) -> dict:
    kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    if not kb.get("enabled"):
        return {}
    silent_hit = match_company_knowledge_silent_question(context)
    if silent_hit:
        return silent_hit
    question_messages = context.get("knowledgeQuestionMessages")
    if not isinstance(question_messages, list) or not question_messages:
        question_messages = recent_unanswered_question_messages(context)
    question_texts = [
        str(item.get("_modelUnansweredQuestionText") or item.get("text") or "").strip()
        for item in question_messages
        if isinstance(item, dict) and str(item.get("_modelUnansweredQuestionText") or item.get("text") or "").strip()
    ]
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    if not question_texts:
        question_texts = [str(context.get("knowledgeQuestionText") or last_other.get("text") or "").strip()]
    text = re.sub(r"\s+", "", "\n".join(item for item in question_texts if item))
    if not text:
        return {}
    if not any(candidate_message_has_followup_question(item) for item in question_texts):
        return {}
    faq = kb.get("faq") if isinstance(kb.get("faq"), list) else []
    raw_hits: list[dict] = []
    for order, item in enumerate(faq):
        if not isinstance(item, dict):
            continue
        patterns = item.get("questionPatterns") if isinstance(item.get("questionPatterns"), list) else []
        matched_needle = ""
        for pattern in patterns:
            needle = re.sub(r"\s+", "", str(pattern or ""))
            if needle and needle.lower() in text.lower():
                if len(needle) > len(matched_needle):
                    matched_needle = needle
        if not matched_needle:
            continue
        answer = strip_reply_terminal_punctuation(
            safe_text(str(item.get("answer") or "").strip(), CHAT_REPLY_MAX_CHARS)
        )
        topic = safe_text(str(item.get("topic") or ""), 60)
        if topic == "unknown" or is_unknown_knowledge_reply(answer, context):
            continue
        if answer:
            raw_hits.append({
                "topic": topic,
                "answer": answer,
                "source": "companyKnowledgeBase.faq",
                "_score": len(matched_needle),
                "_order": order,
            })
    if not raw_hits:
        return {}
    raw_hits.sort(key=lambda hit: (-int(hit.get("_score") or 0), int(hit.get("_order") or 0)))
    hits: list[dict] = []
    seen_answers: set[str] = set()
    seen_topics: set[str] = set()
    for item in raw_hits:
        answer = str(item.get("answer") or "")
        topic = str(item.get("topic") or "")
        if answer in seen_answers or (topic and topic in seen_topics):
            continue
        hits.append({
            "topic": topic,
            "answer": answer,
            "source": str(item.get("source") or "companyKnowledgeBase.faq"),
        })
        seen_answers.add(answer)
        if topic:
            seen_topics.add(topic)
        if len(hits) >= RECENT_UNANSWERED_OTHER_LIMIT:
            break
    if len(hits) == 1:
        return hits[0]
    combined_limit = min(CHAT_MULTI_QUESTION_REPLY_MAX_CHARS, max(CHAT_REPLY_MAX_CHARS, 22 * len(hits)))
    combined = strip_reply_terminal_punctuation(safe_text(" ".join(hit["answer"] for hit in hits), combined_limit))
    return {
        "topic": ",".join(hit.get("topic") or "" for hit in hits if hit.get("topic")),
        "answer": combined,
        "source": "companyKnowledgeBase.faq",
        "hits": hits,
        "subQueries": [safe_text(str(item.get("topic") or item.get("answer") or ""), 60) for item in hits],
    }


def compact_company_knowledge_base_for_model(kb: dict) -> dict:
    if not isinstance(kb, dict):
        return {}
    faq_items: list[dict] = []
    faq_source = kb.get("faq") if isinstance(kb.get("faq"), list) else []
    for item in faq_source:
        if not isinstance(item, dict):
            continue
        answer = strip_reply_terminal_punctuation(str(item.get("answer") or "").strip())
        if not answer:
            continue
        patterns = [
            safe_text(str(pattern or ""), 24)
            for pattern in (item.get("questionPatterns") if isinstance(item.get("questionPatterns"), list) else [])
            if str(pattern or "").strip()
        ][:8]
        faq_items.append({
            "topic": safe_text(str(item.get("topic") or ""), 48),
            "questionPatterns": patterns,
            "answer": safe_text(answer, CHAT_REPLY_MAX_CHARS),
        })
        if len(faq_items) >= 90:
            break

    topics: list[dict] = []
    topic_map = kb.get("topics") if isinstance(kb.get("topics"), dict) else {}
    for topic, facts in topic_map.items():
        if not isinstance(facts, list):
            continue
        cleaned_facts = [
            strip_reply_terminal_punctuation(safe_text(str(fact or ""), 90))
            for fact in facts
            if str(fact or "").strip()
        ][:8]
        if cleaned_facts:
            topics.append({
                "topic": safe_text(str(topic or ""), 48),
                "facts": cleaned_facts,
            })

    return {
        "title": safe_text(str(kb.get("title") or ""), 60),
        "company": kb.get("company") if isinstance(kb.get("company"), dict) else {},
        "answerPolicy": kb.get("answerPolicy") if isinstance(kb.get("answerPolicy"), list) else [],
        "repeatControl": kb.get("repeatControl") if isinstance(kb.get("repeatControl"), dict) else {},
        "screening": kb.get("screening") if isinstance(kb.get("screening"), dict) else {},
        "faq": faq_items,
        "topics": topics,
        "unknownReply": safe_text(str(kb.get("unknownReply") or ""), CHAT_REPLY_MAX_CHARS),
    }


def ask_agent_model_for_company_knowledge_reply(context: dict) -> dict:
    kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    if not kb.get("enabled"):
        return {}
    silent_hit = match_company_knowledge_silent_question(context)
    if silent_hit:
        return silent_hit
    last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
    last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
    question_messages = context.get("knowledgeQuestionMessages")
    if not isinstance(question_messages, list) or not question_messages:
        question_messages = recent_unanswered_question_messages(context)
    question_texts = [
        safe_text(str(item.get("_modelUnansweredQuestionText") or item.get("text") or "").strip(), 180)
        for item in question_messages
        if isinstance(item, dict) and str(item.get("_modelUnansweredQuestionText") or item.get("text") or "").strip()
    ]
    question = "\n".join(question_texts) if question_texts else str(context.get("knowledgeQuestionText") or last_other.get("text") or "").strip()
    if last_message.get("sender") != "other" or not question:
        return {}
    if question_texts:
        has_question = any(candidate_message_has_followup_question(item) for item in question_texts)
    else:
        has_question = candidate_message_has_followup_question(question)
    if not has_question:
        return {}

    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        return {}

    compact_kb = compact_company_knowledge_base_for_model(kb)
    recent_messages = []
    message_source = context.get("messages") if isinstance(context.get("messages"), list) else []
    for item in message_source[-8:]:
        if not isinstance(item, dict):
            continue
        recent_messages.append({
            "sender": item.get("sender"),
            "text": safe_text(str(item.get("text") or ""), 180),
        })

    system_prompt = """
你是招聘聊天里的“候选人问题理解 + 知识库路由”模块。
你的任务不是自由聊天，而是把候选人最近 1-3 条未回复消息拆成子问题，并且只依据给定 companyKnowledgeBase 生成极短回复。

规则：
1. 先判断这些候选人消息是否在问公司/岗位/薪资/工时/住宿/面试/入职/转正/保险/工作内容等事实问题。
2. 如果多条消息里有多个问题，拆成 subQueries，并分别找知识库证据；不要只回答最后一个问题。
3. 只能使用 companyKnowledgeBase.faq.answer 或 topics.facts 中的事实，不要编造。
4. 知识库没有答案的问题不要回复，不要输出“暂时还不清楚/不清楚/不知道”等兜底话术；如果全部子问题都没有知识库答案，answerable=false 且 answer=""。
5. 如果一条消息里既有可回答问题又有未知问题，只回复有知识库证据的部分，未知部分留空不提。
6. 如果候选人主要是在表达接受、拒绝、寒暄、发简历，而不是提问，则 answerable=false。
7. answer 要尽可能短；单个问题优先不超过 28 个中文字符，多个问题最多 64 个中文字符，可以用空格连接，只覆盖能回答的子问题。
8. answer 末尾不要加句号、感叹号或英文句点。
9. 只输出 JSON，不要 Markdown。

输出格式：
{
  "intent": "ask_question | accept | reject | smalltalk | resume | unclear",
  "acceptance": "accept | reject | unknown",
  "subQueries": ["子问题1", "子问题2"],
  "selectedTopics": ["topicKey"],
  "selectedEvidence": [{"topic": "topicKey", "answer": "知识库原答案或事实"}],
  "answerable": true,
  "answer": "最终短回复"
}
""".strip()
    user_prompt = {
        "candidateMessage": question,
        "candidateMessages": question_texts or [question],
        "appliedPosition": context.get("appliedPosition") or "",
        "recentMessages": recent_messages,
        "companyKnowledgeBase": compact_kb,
    }
    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    content = call_chat_completion(config, api_key, payload, timeout=USER_QUESTION_MODEL_TIMEOUT_SECONDS)
    parsed = parse_json_object(content)
    if not isinstance(parsed, dict):
        return {}

    answerable = bool(parsed.get("answerable"))
    sub_queries = parsed.get("subQueries") if isinstance(parsed.get("subQueries"), list) else []
    question_count = max(1, len(question_texts), len(sub_queries))
    answer_limit = CHAT_MULTI_QUESTION_REPLY_MAX_CHARS if question_count > 1 else CHAT_REPLY_MAX_CHARS
    answer = strip_reply_terminal_punctuation(safe_text(str(parsed.get("answer") or "").strip(), answer_limit))
    if not answerable or not answer:
        return {
            "source": "companyKnowledgeBase.model_unknown_skipped",
            "answerSkipped": True,
            "unknownSkipped": True,
            "intent": safe_text(str(parsed.get("intent") or ""), 40),
            "acceptance": safe_text(str(parsed.get("acceptance") or ""), 40),
            "subQueries": [safe_text(str(item or ""), 60) for item in sub_queries if str(item or "").strip()][:5],
            "analysis": safe_text(str(parsed.get("analysis") or ""), 160),
        }
    if is_unknown_knowledge_reply(answer, context) or re.search(r"(暂时|目前|现在)?还?不太?清楚|不知道|不确定|没法确认", answer):
        return {
            "source": "companyKnowledgeBase.model_unknown_skipped",
            "answerSkipped": True,
            "unknownSkipped": True,
            "intent": safe_text(str(parsed.get("intent") or ""), 40),
            "acceptance": safe_text(str(parsed.get("acceptance") or ""), 40),
            "subQueries": [safe_text(str(item or ""), 60) for item in sub_queries if str(item or "").strip()][:5],
            "analysis": safe_text(str(parsed.get("analysis") or ""), 160),
        }

    selected_topics = parsed.get("selectedTopics") if isinstance(parsed.get("selectedTopics"), list) else []
    evidence = parsed.get("selectedEvidence") if isinstance(parsed.get("selectedEvidence"), list) else []
    return {
        "topic": ",".join(safe_text(str(topic or ""), 48) for topic in selected_topics if str(topic or "").strip()),
        "answer": answer,
        "source": "companyKnowledgeBase.model",
        "intent": safe_text(str(parsed.get("intent") or ""), 40),
        "acceptance": safe_text(str(parsed.get("acceptance") or ""), 40),
        "subQueries": [safe_text(str(item or ""), 60) for item in sub_queries if str(item or "").strip()][:5],
        "selectedEvidence": evidence[:5],
        "analysis": safe_text(str(parsed.get("analysis") or ""), 160),
    }


def match_rule_against_text(rule: dict, hay: str, hay_lower: str) -> bool:
    match = rule.get("match")
    if not isinstance(match, dict):
        return False

    includes_any = match.get("includes_any") or []
    regex_any = match.get("regex_any") or []

    if isinstance(includes_any, list) and includes_any:
        for item in includes_any:
            text = str(item or "").strip()
            if text and text.lower() in hay_lower:
                return True

    if isinstance(regex_any, list) and regex_any:
        for pattern in regex_any:
            pat = str(pattern or "").strip()
            if not pat:
                continue
            try:
                if re.search(pat, hay, flags=re.I):
                    return True
            except re.error:
                continue

    return False


def cache_position_reply_selection(cache_key: tuple[int, str], result: dict) -> dict:
    with BOSS_CHAT_RULES_CACHE_LOCK:
        POSITION_REPLY_SELECTION_CACHE[cache_key] = result
    return result


def select_position_reply(applied_position: str, rules: dict) -> dict:
    position = clean_applied_position(applied_position)
    if not position or not isinstance(rules, dict):
        return {}
    cache_key = (id(rules), position)
    with BOSS_CHAT_RULES_CACHE_LOCK:
        cached = POSITION_REPLY_SELECTION_CACHE.get(cache_key)
        if isinstance(cached, dict):
            return cached
    position_lower = position.lower()
    configured = rules.get("positionReplies") or rules.get("position_replies") or rules.get("jobReplies") or rules.get("job_replies")

    if isinstance(configured, dict):
        for key, value in configured.items():
            key_text = str(key or "").strip()
            if not key_text:
                continue
            if key_text.lower() not in position_lower and position_lower not in key_text.lower():
                continue
            if isinstance(value, dict):
                template = str(value.get("template") or value.get("reply") or value.get("message") or "").strip()
                category = str(value.get("category") or key_text).strip()
                initial_common_phrase = str(value.get("initialCommonPhrase") or value.get("initialPhrase") or "").strip()
                role_prompt = str(value.get("rolePrompt") or value.get("prompt") or value.get("systemPrompt") or "").strip()
                talking_points = value.get("talkingPoints") if isinstance(value.get("talkingPoints"), list) else []
                screening_questions = value.get("screeningQuestions") if isinstance(value.get("screeningQuestions"), list) else []
                next_steps = value.get("nextSteps") if isinstance(value.get("nextSteps"), list) else []
                direct_resume = bool(value.get("directResume") is True or value.get("directRequestResume") is True or value.get("direct_resume") is True)
                resume_job_type = str(value.get("resumeJobType") or value.get("normalizedJobType") or value.get("jobType") or "").strip()
                resume_request_prompt = str(value.get("resumeRequestPrompt") or value.get("directResumePrompt") or value.get("requestResumePrompt") or "").strip()
            else:
                template = str(value or "").strip()
                category = key_text
                initial_common_phrase = ""
                role_prompt = ""
                talking_points = []
                screening_questions = []
                next_steps = []
                direct_resume = False
                resume_job_type = ""
                resume_request_prompt = ""
            if template:
                return cache_position_reply_selection(cache_key, {
                    "category": category,
                    "template": template,
                    "initialCommonPhrase": safe_text(initial_common_phrase, 400),
                    "rolePrompt": safe_text(role_prompt, 1200),
                    "talkingPoints": [safe_text(str(item), 160) for item in talking_points[:8]],
                    "screeningQuestions": [safe_text(str(item), 160) for item in screening_questions[:8]],
                    "nextSteps": [safe_text(str(item), 160) for item in next_steps[:6]],
                    "directResume": direct_resume,
                    "resumeJobType": safe_text(resume_job_type, 40),
                    "resumeRequestPrompt": safe_text(resume_request_prompt, 120),
                    "source": "positionReplies",
                    "matched": key_text,
                })

    if isinstance(configured, list):
        for item in configured:
            if not isinstance(item, dict):
                continue
            if not match_rule_against_text(item, position, position_lower):
                continue
            template = str(item.get("template") or item.get("reply") or item.get("message") or "").strip()
            if template:
                return cache_position_reply_selection(cache_key, {
                    "category": str(item.get("category") or "position").strip(),
                    "template": template,
                    "initialCommonPhrase": safe_text(str(item.get("initialCommonPhrase") or item.get("initialPhrase") or ""), 400),
                    "rolePrompt": safe_text(str(item.get("rolePrompt") or item.get("prompt") or item.get("systemPrompt") or ""), 1200),
                    "talkingPoints": [safe_text(str(point), 160) for point in (item.get("talkingPoints") if isinstance(item.get("talkingPoints"), list) else [])[:8]],
                    "screeningQuestions": [safe_text(str(question), 160) for question in (item.get("screeningQuestions") if isinstance(item.get("screeningQuestions"), list) else [])[:8]],
                    "nextSteps": [safe_text(str(step), 160) for step in (item.get("nextSteps") if isinstance(item.get("nextSteps"), list) else [])[:6]],
                    "source": "positionReplies",
                    "matched": position,
                })

    for rule in rules.get("rules", []) if isinstance(rules.get("rules"), list) else []:
        if not isinstance(rule, dict):
            continue
        if not match_rule_against_text(rule, position, position_lower):
            continue
        template = str(rule.get("template") or "").strip()
        if template:
            return cache_position_reply_selection(cache_key, {
                "category": str(rule.get("category") or "position").strip(),
                "template": template,
                "initialCommonPhrase": safe_text(str(rule.get("initialCommonPhrase") or rule.get("initialPhrase") or ""), 400),
                "rolePrompt": safe_text(str(rule.get("rolePrompt") or rule.get("prompt") or rule.get("systemPrompt") or ""), 1200),
                "talkingPoints": [safe_text(str(point), 160) for point in (rule.get("talkingPoints") if isinstance(rule.get("talkingPoints"), list) else [])[:8]],
                "screeningQuestions": [safe_text(str(question), 160) for question in (rule.get("screeningQuestions") if isinstance(rule.get("screeningQuestions"), list) else [])[:8]],
                "nextSteps": [safe_text(str(step), 160) for step in (rule.get("nextSteps") if isinstance(rule.get("nextSteps"), list) else [])[:6]],
                "source": "rules",
                "matched": position,
            })

    return cache_position_reply_selection(cache_key, {})


def classify_boss_chat(context: dict, rules: dict) -> tuple[str, str]:
    """Return (category, template). Classification is purely rule-based.

    We intentionally do not hardcode BOSS selectors here; instead we match against
    the text we can already collect reliably (page title + bodyTextPreview).
    """

    elements = context.get("elements") if isinstance(context, dict) else None
    element_texts: list[str] = []
    if isinstance(elements, dict):
        for group in elements.values():
            if not isinstance(group, list):
                continue
            for item in group[:40]:
                if isinstance(item, dict) and item.get("label"):
                    element_texts.append(str(item["label"]))

    hay = "\n".join(
        [
            str(context.get("title") or ""),
            str(context.get("url") or ""),
            str(context.get("bodyTextPreview") or ""),
            "\n".join(element_texts),
        ]
    )
    hay_lower = hay.lower()

    default = rules.get("default") if isinstance(rules, dict) else None
    default_category = "default"
    default_template = "你好，我这边想跟你确认下目前求职意向与可沟通时间。"
    if isinstance(default, dict):
        default_category = str(default.get("category") or default_category)
        default_template = str(default.get("template") or default_template)

    for rule in rules.get("rules", []) if isinstance(rules, dict) else []:
        if not isinstance(rule, dict):
            continue
        if not match_rule_against_text(rule, hay, hay_lower):
            continue

        category = str(rule.get("category") or default_category)
        template = str(rule.get("template") or default_template)
        return category, template

    return default_category, default_template


def normalize_contact_label(label: str) -> tuple[str, str]:
    """Return (name, href).

    Cached element labels are joined by " | " and may include href.
    We try to extract a stable dedupe key without relying on site-specific selectors.
    """

    raw = (label or "").strip()
    if not raw:
        return "", ""
    parts = [p.strip() for p in raw.split("|") if p.strip()]
    href = ""
    for part in parts:
        if part.startswith("http://") or part.startswith("https://"):
            href = part
            break
    name = parts[0] if parts else raw
    # Trim obvious URL-like noise from name.
    if name.startswith("http://") or name.startswith("https://"):
        name = ""
    name = safe_text(name, 60)
    return name, href


def parse_required_chat_rounds(task: str) -> int:
    text = str(task or "")
    match = re.search(r"(\d+)\s*轮", text)
    if match:
        try:
            return max(1, int(match.group(1)))
        except Exception:
            return 1
    # Chinese numerals (common cases)
    mapping = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5}
    match2 = re.search(r"([一二两三四五])\s*轮", text)
    if match2:
        return mapping.get(match2.group(1), 1)
    return 1


def count_completed_chat_rounds(trace: list[dict]) -> int:
    rounds = 0
    for step in trace or []:
        if not isinstance(step, dict):
            continue
        results = step.get("results")
        if not isinstance(results, list):
            continue
        for item in results:
            if not isinstance(item, dict):
                continue
            # Heuristic: a successful send click is a round.
            msg = str(item.get("message") or "")
            if ("已点击" in msg or "clicked" in msg.lower()) and ("发送" in msg or "send" in msg.lower()):
                rounds += 1
                break
            send = item.get("send")
            if isinstance(send, dict):
                smsg = str(send.get("message") or "")
                if not send.get("blocked") and ("已点击" in smsg or "clicked" in smsg.lower()) and ("发送" in smsg or "send" in smsg.lower()):
                    rounds += 1
                    break
    return rounds


def scan_resume_candidates(query: str = "", limit: int = 24) -> list[dict]:
    query_lower = query.lower()
    files: list[dict] = []
    visited = 0
    now = time.time()

    for root in SCAN_ROOTS:
        if not root.exists() or not root.is_dir():
            continue
        try:
            iterator = root.rglob("*")
            for path in iterator:
                visited += 1
                if visited > 6000:
                    break
                if not path.is_file() or path.suffix.lower() not in LOCAL_FILE_EXTENSIONS:
                    continue
                if should_skip_scan_path(path):
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if stat.st_size <= 0 or stat.st_size > 40 * 1024 * 1024:
                    continue
                score = score_resume_candidate(path, query_lower, stat.st_mtime, now)
                files.append({
                    "name": path.name,
                    "path": str(path.resolve()),
                    "size": stat.st_size,
                    "mtime": stat.st_mtime,
                    "mtimeText": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)),
                    "score": score,
                })
        except (OSError, PermissionError):
            continue

    files.sort(key=lambda item: (item["score"], item["mtime"]), reverse=True)
    return files[:limit]


def should_skip_scan_path(path: Path) -> bool:
    lowered = str(path).lower()
    skip_parts = (
        "\\node_modules\\",
        "\\.git\\",
        "\\__pycache__\\",
        "\\cdp-browser-profile\\",
        "\\appdata\\",
        "\\windows\\",
    )
    return any(part in lowered for part in skip_parts)


def score_resume_candidate(path: Path, query_lower: str, mtime: float, now: float) -> float:
    name = path.name.lower()
    parent = str(path.parent).lower()
    score = 0.0
    if path.suffix.lower() == ".pdf":
        score += 8
    if any(word in name for word in ("简历", "resume", "cv", "个人简历", "候选人")):
        score += 40
    if any(word in parent for word in ("desktop", "downloads", "下载", "桌面")):
        score += 8
    for token in re.findall(r"[\u4e00-\u9fffA-Za-z0-9]+", query_lower):
        if len(token) >= 2 and token in name:
            score += 12
    age_days = max(0, (now - mtime) / 86400)
    score += max(0, 20 - min(age_days, 20))
    return score


def sanitize_filename(name: str) -> str:
    name = Path(name).name
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip()


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    for index in range(1, 1000):
        candidate = path.with_name(f"{stem}_{index}{suffix}")
        if not candidate.exists():
            return candidate
    raise AgentError("无法生成不重复的文件名。")


def safe_resume_file_part(value: str, fallback: str = "未识别") -> str:
    text = sanitize_filename(str(value or "").strip())
    text = re.sub(r"\s+", "_", text).strip("._ ")
    return safe_text(text or fallback, 60)


def resume_attachment_suffix(*values: str) -> str:
    for value in values:
        text = unquote(str(value or ""))
        match = re.search(r"\.(pdf|docx?|PDF|DOCX?)(?:$|[?#\s])", text)
        if match:
            return f".{match.group(1).lower()}"
    return ""


def response_attachment_filename(headers: dict, fallback: str = "") -> str:
    disposition = str((headers or {}).get("content-disposition") or "")
    for pattern in (
        r"filename\*=UTF-8''([^;\r\n]+)",
        r'filename="([^"\r\n]+)"',
        r"filename=([^;\r\n]+)",
    ):
        match = re.search(pattern, disposition, flags=re.I)
        if match:
            return sanitize_filename(unquote(match.group(1).strip()))
    return sanitize_filename(Path(unquote(str(fallback or ""))).name or "51job_resume")


def make_job51_resume_target_path(
    candidate_name: str = "",
    applied_position: str = "",
    original_filename: str = "",
    fallback_text: str = "",
) -> Path:
    suffix = resume_attachment_suffix(original_filename, fallback_text) or Path(original_filename or "").suffix.lower()
    if suffix not in LOCAL_FILE_EXTENSIONS:
        suffix = ".pdf"
    account_part = safe_resume_file_part(f"{AGENT_ACCOUNT_ID}_{AGENT_ACCOUNT_NAME}", AGENT_ACCOUNT_ID)
    folder = JOB51_RESUME_DIR / account_part
    folder.mkdir(parents=True, exist_ok=True)
    name_part = safe_resume_file_part(candidate_name, "未知候选人")
    position_part = safe_resume_file_part(applied_position, "未知岗位")
    date_part = time.strftime("%Y%m%d")
    return unique_path(folder / f"{name_part}_{position_part}_51job_{date_part}{suffix}")


def make_recruiter_resume_target_path(
    platform: str = "",
    candidate_name: str = "",
    applied_position: str = "",
    original_filename: str = "",
    fallback_text: str = "",
) -> Path:
    suffix = resume_attachment_suffix(original_filename, fallback_text) or Path(original_filename or "").suffix.lower()
    if suffix not in LOCAL_FILE_EXTENSIONS:
        suffix = ".pdf"
    platform_part = safe_resume_file_part(platform or "recruiter", "recruiter")
    account_part = safe_resume_file_part(f"{AGENT_ACCOUNT_ID}_{AGENT_ACCOUNT_NAME}", AGENT_ACCOUNT_ID)
    folder = RECRUITER_RESUME_DIR / account_part / platform_part
    folder.mkdir(parents=True, exist_ok=True)
    name_part = safe_resume_file_part(candidate_name, "未知候选人")
    position_part = safe_resume_file_part(applied_position, "未知岗位")
    date_part = time.strftime("%Y%m%d")
    return unique_path(folder / f"{name_part}_{position_part}_{platform_part}_{date_part}{suffix}")


def job51_resume_content_hash(content: bytes | bytearray | None) -> str:
    if not isinstance(content, (bytes, bytearray)) or not content:
        return ""
    return hashlib.sha256(bytes(content)).hexdigest()


def job51_resume_file_hash(file_path: Path | str) -> str:
    try:
        path = Path(file_path)
        if not path.exists() or not path.is_file():
            return ""
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except Exception:
        return ""


def job51_pdf_utf16_hex(text: str) -> str:
    data = ("\ufeff" + str(text or "")).encode("utf-16-be", errors="ignore")
    return data.hex().upper()


def job51_wrap_visible_resume_pdf_lines(text: str, line_chars: int = 42, max_lines: int = 240) -> list[str]:
    normalized = str(text or "").replace("\r", "\n")
    normalized = re.sub(r"[ \t]+", " ", normalized)
    lines: list[str] = []
    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line:
            if lines and lines[-1]:
                lines.append("")
            continue
        while len(line) > line_chars:
            lines.append(line[:line_chars])
            line = line[line_chars:]
            if len(lines) >= max_lines:
                return lines[:max_lines]
        lines.append(line)
        if len(lines) >= max_lines:
            return lines[:max_lines]
    return lines[:max_lines]


def job51_build_visible_resume_text_pdf(
    candidate_name: str,
    applied_position: str,
    resume_text: str,
    source_label: str = "51job 当前聊天在线简历",
) -> bytes:
    header_lines = [
        "51job 在线简历文本归档",
        f"候选人：{safe_text(str(candidate_name or '未知候选人'), 80)}",
        f"应聘岗位：{safe_text(str(applied_position or '未知岗位'), 120)}",
        f"来源：{safe_text(str(source_label or '51job 当前聊天在线简历'), 120)}",
        "",
    ]
    body_lines = job51_wrap_visible_resume_pdf_lines(resume_text)
    lines = (header_lines + body_lines)[:260]
    content_parts = ["BT", "/F1 10 Tf", "50 800 Td", "14 TL"]
    for line in lines:
        content_parts.append(f"<{job51_pdf_utf16_hex(line)}> Tj")
        content_parts.append("T*")
    content_parts.append("ET")
    content = ("\n".join(content_parts) + "\n").encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /ProcSet [/PDF /Text] /Font << /F1 4 0 R >> >> /Contents 7 0 R >>",
        b"<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>",
        b"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 6 0 R >>",
        b"<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>",
        b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"endstream",
    ]
    pdf = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += f"{index} 0 obj\n".encode("ascii") + obj + b"\nendobj\n"
    xref_pos = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n".encode("ascii")
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    return pdf


def job51_resume_path_matches_candidate(file_path: Path | str, candidate_name: str, applied_position: str) -> bool:
    name_part = safe_resume_file_part(candidate_name, "")
    position_part = safe_resume_file_part(applied_position, "")
    if not name_part:
        return False
    stem = re.sub(r"\s+", "", Path(str(file_path or "")).stem).lower()
    name_key = re.sub(r"\s+", "", name_part).lower()
    position_key = re.sub(r"\s+", "", position_part).lower()
    if name_key not in stem:
        return False
    return not position_key or position_key in stem


def job51_find_resume_hash_matches(file_hash: str, ignore_path: Path | str | None = None) -> list[dict]:
    file_hash = str(file_hash or "").strip().lower()
    if not file_hash or not JOB51_RESUME_DIR.exists():
        return []
    ignored = ""
    if ignore_path:
        try:
            ignored = str(Path(ignore_path).resolve()).lower()
        except Exception:
            ignored = str(ignore_path).lower()
    matches: list[dict] = []
    try:
        paths = sorted(
            (path for path in JOB51_RESUME_DIR.rglob("*") if path.is_file() and path.suffix.lower() in LOCAL_FILE_EXTENSIONS),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    except Exception:
        paths = []
    for path in paths:
        try:
            resolved = str(path.resolve()).lower()
        except Exception:
            resolved = str(path).lower()
        if ignored and resolved == ignored:
            continue
        digest = job51_resume_file_hash(path)
        if digest.lower() != file_hash:
            continue
        try:
            size = path.stat().st_size
            modified_at = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(path.stat().st_mtime))
        except Exception:
            size = 0
            modified_at = ""
        matches.append({
            "filePath": str(path),
            "filename": path.name,
            "fileSize": size,
            "modifiedAt": modified_at,
        })
    return matches


def job51_resume_hash_guard(
    file_hash: str,
    candidate_name: str,
    applied_position: str,
    ignore_path: Path | str | None = None,
) -> dict:
    matches = job51_find_resume_hash_matches(file_hash, ignore_path=ignore_path)
    same_candidate: list[dict] = []
    conflicts: list[dict] = []
    for match in matches:
        if job51_resume_path_matches_candidate(match.get("filePath") or "", candidate_name, applied_position):
            same_candidate.append(match)
        else:
            conflicts.append(match)
    return {
        "hash": str(file_hash or "").strip().lower(),
        "sameCandidate": same_candidate,
        "conflicts": conflicts,
        "conflict": bool(conflicts),
        "alreadyDownloaded": bool(same_candidate),
    }


def load_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return default


def save_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_unclear_question_key(text: str) -> str:
    compact = re.sub(r"\s+", "", str(text or "")).lower()
    compact = re.sub(r"[，。！？!?、；;：:\[\]（）(){}<>《》\"'“”‘’`~·.\-_/\\|]", "", compact)
    return safe_text(compact, 160)


def unknown_reply_text(context: dict | None = None) -> str:
    context = context if isinstance(context, dict) else {}
    kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    return strip_reply_terminal_punctuation(str(kb.get("unknownReply") or "\u6682\u65f6\u8fd8\u4e0d\u6e05\u695a").strip())


def is_unknown_knowledge_reply(answer: str, context: dict | None = None) -> bool:
    expected = normalize_reply_fingerprint(unknown_reply_text(context))
    actual = normalize_reply_fingerprint(answer)
    return bool(expected and actual and (expected == actual or expected in actual or actual in expected))


def is_recruiter_user_question_pool_item(text: str, context: dict | None = None) -> bool:
    raw = str(text or "").strip()
    compact = re.sub(r"\s+", "", raw).lower()
    if not compact:
        return False
    substantive_terms = (
        "薪资", "工资", "日薪", "待遇", "加班", "工作时间", "上班时间", "下班时间",
        "住宿", "宿舍", "食宿", "吃住", "包吃住", "包食宿", "管吃住", "包吃",
        "房补", "餐补", "地点", "地址", "线下", "线上", "单休", "双休", "实习",
        "合同", "协议", "五险", "社保", "保险", "面试", "复试", "笔试", "招聘流程",
        "流程", "转正", "入职", "到岗", "出差", "客户", "拜访", "销售指标", "销售任务", "销售业绩", "销售工作", "食堂", "电脑",
        "体检", "学生证", "毕业证", "岗位内容", "工作内容", "职责", "微信", "联系方式",
        "简历", "发简历", "附件简历", "有人带", "一带一", "带教", "导师", "独立上手",
        "学习", "学多久", "学习多久", "培训", "培训时间", "培训多久", "大三", "在校生", "本科在读",
    )
    generic_intent_patterns = (
        r"可以.*了解.*(?:岗位|职位|工作)?(?:吗|嘛|么)?$",
        r"想.*了解.*(?:岗位|职位|工作)?(?:吗|嘛|么)?$",
        r"希望.*了解.*(?:岗位|职位|工作)",
        r"可以.*交流.*(?:一下)?(?:吗|嘛|么)?$",
        r"方便.*交流.*(?:一下)?(?:吗|嘛|么)?$",
        r"可以.*沟通.*(?:一下)?(?:吗|嘛|么)?$",
        r"方便.*沟通.*(?:一下)?(?:吗|嘛|么)?$",
        r"可以.*进一步.*沟通",
        r"进一步.*和您.*沟通",
        r"进一步.*沟通",
        r"能不能.*进一步.*沟通",
        r"能否.*进一步.*沟通",
        r"您看我.*是否.*合适",
        r"是否.*合适",
        r"我.*是否.*合适",
        r"可以.*考虑.*一下.*吗",
        r"可以.*去.*面试.*吗",
        r"方便.*加.*微信",
        r"可以.*加.*微信",
        r"可以.*看.*简历",
        r"方便.*看.*简历",
        r"能.*看.*简历",
        r"看下.*简历",
        r"看一下.*简历",
        r"简历.*查收",
        r"这是.*简历",
        r"投递.*简历",
        r"简历.*投递",
        r"简历.*发",
        r"发.*简历",
    )
    if any(re.search(pattern, compact) for pattern in generic_intent_patterns) and not any(
        term in compact
        for term in (
            "薪资", "工资", "日薪", "待遇", "住宿", "宿舍", "食宿", "吃住", "包吃住",
            "包食宿", "管吃住", "包吃", "房补", "餐补", "食堂", "工作时间", "上班时间", "下班时间",
            "加班", "单休", "双休", "休息", "地点", "地址", "线下", "线上", "远程", "转正",
            "社保", "保险", "合同", "协议", "出差", "客户", "拜访", "岗位内容", "工作内容",
            "职责", "招聘流程",
        )
    ):
        return False
    if not any(term in compact for term in substantive_terms) and any(re.search(pattern, compact) for pattern in generic_intent_patterns):
        return False
    ignore_terms = (
        "boss您好", "您好boss", "您好", "你好", "hi", "hello",
        "感兴趣", "很感兴趣", "职位还在招", "还在招吗", "还招吗", "在招吗",
        "可以深聊", "希望可以深聊", "期待您的回复", "期待回复",
        "可以把简历发给您吗", "可以给您发简历吗", "能把简历发给您吗",
        "方便发简历", "发简历给您", "给您发简历", "发送简历", "发给您看看",
        "方便看下简历", "方便看简历", "可以看简历", "看一下简历", "看下简历",
        "投递简历", "这是我的简历", "简历请查收", "符合岗位", "希望沟通",
        "想进一步沟通", "有机会沟通", "可以交流一下", "可以了解一下", "想了解一下",
        "进一步和您沟通", "进一步沟通", "可以考虑一下", "可以去贵公司面试",
        "您看我是否合适", "是否合适", "方便加个微信", "方便加微信",
        "对这份工作很感兴趣", "对您发布的职位", "对贵公司的岗位",
    )
    if any(term.lower() in compact for term in ignore_terms):
        if not any(term in compact for term in substantive_terms):
            return False
    if re.search(r"(简历|附件|pdf|docx?|资料).{0,12}(发|发送|给|您|你|看看|过去)", compact, flags=re.I):
        if not any(term in compact for term in substantive_terms):
            return False
    if "职位" in compact and any(term in compact for term in ("还在招", "在招吗", "还招吗")):
        return False
    return candidate_message_has_followup_question(raw)


def looks_like_recruiter_user_question_model_candidate(text: str) -> bool:
    raw = str(text or "").strip()
    compact = re.sub(r"\s+", "", raw).lower()
    if not compact or len(compact) < 3:
        return False
    if len(compact) > 500:
        return False
    question_signals = (
        "吗", "么", "？", "?", "请问", "想问", "问一下", "咨询", "了解一下",
        "多少", "几", "哪里", "哪儿", "在哪", "什么时候", "是否", "有没有",
        "有吗", "是不是", "可不可以", "能不能", "怎么", "什么", "多久", "多长",
    )
    topic_hints = (
        "薪资", "工资", "日薪", "待遇", "加班", "工作时间", "上班时间", "下班时间",
        "住宿", "食宿", "吃住", "包吃住", "包食宿", "管吃住", "房补", "餐补",
        "地点", "地址", "线下", "线上", "单休", "双休", "实习", "合同",
        "五险", "社保", "保险", "面试", "复试", "笔试", "转正", "入职", "到岗",
        "出差", "客户", "食堂", "电脑", "体检", "学生证", "毕业证", "岗位",
        "职位", "招聘", "简历", "附件", "客户拜访", "拜访客户",
    )
    if any(signal in compact for signal in question_signals):
        return True
    return len(compact) <= 32 and any(topic in compact for topic in topic_hints)


def compact_recruiter_user_question_context_for_model(context: dict | None, knowledge_hit: dict | None = None) -> dict:
    context = context if isinstance(context, dict) else {}
    messages = []
    for item in (context.get("messages") if isinstance(context.get("messages"), list) else [])[-8:]:
        if not isinstance(item, dict):
            continue
        messages.append({
            "sender": safe_text(str(item.get("sender") or ""), 20),
            "time": safe_text(str(item.get("time") or ""), 30),
            "text": safe_text(str(item.get("text") or ""), 180),
        })
    kb = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    return {
        "candidateLabel": safe_text(str(context.get("candidateLabel") or context.get("label") or ""), 180),
        "candidateName": safe_text(str(context.get("candidateName") or ""), 80),
        "appliedPosition": safe_text(str(context.get("appliedPosition") or ""), 80),
        "recentMessages": messages,
        "knowledgeHit": {
            "source": safe_text(str((knowledge_hit or {}).get("source") or ""), 80),
            "topic": safe_text(str((knowledge_hit or {}).get("topic") or ""), 80),
            "answer": safe_text(str((knowledge_hit or {}).get("answer") or ""), 120),
        } if isinstance(knowledge_hit, dict) and knowledge_hit else {},
        "companyKnowledgeBase": compact_company_knowledge_base_for_model(kb) if kb.get("enabled") else {},
    }


def normalize_user_question_pool_model_judgement(raw: dict, text: str, rule_allowed: bool) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    compact = re.sub(r"\s+", "", str(text or "")).lower()
    category = safe_text(str(raw.get("category") or raw.get("type") or ""), 60).lower()
    should_save_raw = raw.get("shouldSave")
    if should_save_raw is None:
        should_save_raw = raw.get("saveToUserQuestionPool")
    if should_save_raw is None:
        should_save = category in {
            "knowledge_gap",
            "needs_human_answer",
            "answerable_by_kb",
            "unknown_policy",
            "unclear_company_policy",
            "substantive_unanswered_question",
        }
    else:
        should_save = bool(should_save_raw)
    hard_ignore_terms = (
        "boss您好", "您好boss", "我对您发布的职位非常感兴趣", "希望可以深聊", "期待您的回复",
        "可以把简历发给您吗", "可以给您发简历吗", "能把简历发给您吗", "方便发简历",
        "方便看下简历", "方便看简历", "可以看简历", "看一下简历", "看下简历",
        "投递简历", "这是我的简历", "简历请查收", "可以交流一下", "可以了解一下",
        "想了解一下", "想进一步沟通", "可以进一步沟通", "进一步和您沟通", "进一步沟通",
        "有机会沟通", "可以考虑一下", "可以去贵公司面试", "您看我是否合适",
        "是否合适", "方便加个微信", "方便加微信",
        "职位还在招吗", "还在招吗", "还招吗", "在招吗",
    )
    hard_ignore_categories = {
        "smalltalk",
        "greeting",
        "interest",
        "application_intent",
        "resume_request",
        "still_hiring",
        "job_still_open",
        "self_intro",
        "screening_answer",
        "not_question",
        "already_answered",
    }
    if category in {"answerable_by_kb", "answered_by_kb", "kb_answerable"} and rule_allowed:
        should_save = True
    if any(term.lower() in compact for term in hard_ignore_terms) or category in hard_ignore_categories:
        should_save = False
    return {
        "modelEnabled": True,
        "shouldSave": bool(should_save),
        "category": safe_text(category or ("knowledge_gap" if should_save else "not_saved"), 60),
        "normalizedQuestion": safe_text(str(raw.get("normalizedQuestion") or raw.get("question") or text or ""), 180),
        "reason": safe_text(str(raw.get("reason") or raw.get("analysis") or ""), 220),
        "confidence": raw.get("confidence"),
        "ruleAllowed": bool(rule_allowed),
    }


def ask_agent_model_for_user_question_pool_judgement(
    text: str,
    context: dict | None = None,
    *,
    rule_allowed: bool = False,
    knowledge_hit: dict | None = None,
) -> dict:
    if not has_model_key():
        return {}
    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        return {}
    system_prompt = """
你是招聘智能体的“用户提问池裁判”。你的任务不是回复候选人，而是判断候选人这句话是否应该保存到“用户提问”模块，供后续补充知识库或人工复查。

只在这些情况 shouldSave=true：
1. 候选人提出了公司、岗位、薪资、工时、住宿、面试、入职、转正、合同、保险、出差、客户拜访等实质问题
2. 当前知识库没有明确答案，或答案不确定，需要用户后续补充
3. 问题适合沉淀成知识库条目

这些情况 shouldSave=false：
1. 打招呼、寒暄、自我介绍、表达感兴趣、期待回复
2. “可以发简历吗 / 可以把简历发给您吗 / 方便发简历吗”
3. “职位还在招吗 / 还招吗 / 在招吗”
4. 候选人只是回答筛选条件，比如“可以”“接受”“不接受”“考虑下”
5. 候选人主动发简历、附件、PDF
6. 当前知识库已经能明确回答的问题

必须输出 JSON，不要 Markdown：
{
  "shouldSave": true,
  "category": "knowledge_gap | needs_human_answer | answerable_by_kb | smalltalk | resume_request | still_hiring | screening_answer | application_intent | not_question",
  "normalizedQuestion": "归一化后的短问题",
  "reason": "一句话说明原因",
  "confidence": 0.0
}
""".strip()
    user_prompt = {
        "candidateMessage": safe_text(str(text or ""), 300),
        "ruleAllowed": bool(rule_allowed),
        "context": compact_recruiter_user_question_context_for_model(context, knowledge_hit),
        "negativeExamples": [
            "Boss您好，我对您发布的职位非常感兴趣，可以把简历发给您吗？",
            "您发布的膨润土销售人员职位还在招吗，我很感兴趣，希望可以深聊，期待您的回复",
        ],
        "positiveExamples": [
            "长期出差吗",
            "住宿是几人间",
            "一周要拜访几家客户",
            "实习合同怎么签",
        ],
    }
    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
    }
    content = call_chat_completion(config, api_key, payload, timeout=USER_QUESTION_MODEL_TIMEOUT_SECONDS)
    parsed = parse_json_object(content)
    return parsed if isinstance(parsed, dict) else {}


def judge_recruiter_user_question_pool_item(
    text: str,
    context: dict | None = None,
    *,
    knowledge_hit: dict | None = None,
) -> dict:
    rule_allowed = is_recruiter_user_question_pool_item(text, context)
    if has_model_key() and looks_like_recruiter_user_question_model_candidate(text):
        try:
            raw = ask_agent_model_for_user_question_pool_judgement(
                text,
                context,
                rule_allowed=rule_allowed,
                knowledge_hit=knowledge_hit,
            )
            if raw:
                return normalize_user_question_pool_model_judgement(raw, text, rule_allowed)
        except Exception as error:
            return {
                "modelEnabled": False,
                "modelError": safe_text(str(error), 180),
                "shouldSave": bool(rule_allowed),
                "category": "rule_fallback",
                "normalizedQuestion": safe_text(str(text or ""), 180),
                "reason": "model_failed_rule_fallback",
                "ruleAllowed": bool(rule_allowed),
            }
    return {
        "modelEnabled": False,
        "shouldSave": bool(rule_allowed),
        "category": "rule_only",
        "normalizedQuestion": safe_text(str(text or ""), 180),
        "reason": "rule_filter",
        "ruleAllowed": bool(rule_allowed),
    }


def build_recruiter_unclear_question_items(
    candidate_label: str,
    context: dict | None,
    question_messages: list[dict] | None = None,
    *,
    action: str = "",
    screening_status: str = "",
    answer: str = "",
    knowledge_hit: dict | None = None,
    force_save: bool = False,
) -> list[dict]:
    context = context if isinstance(context, dict) else {}
    question_messages = question_messages if isinstance(question_messages, list) else []
    if not question_messages:
        last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
        if last_other:
            question_messages = [last_other]
    conversation_key = str(context.get("conversationKey") or "")
    identity = build_recruiter_candidate_identity(context, candidate_label, conversation_key)
    captured_at = time.strftime("%Y-%m-%d %H:%M:%S")
    items: list[dict] = []
    for message in question_messages[-RECENT_UNANSWERED_OTHER_LIMIT:]:
        if not isinstance(message, dict):
            continue
        question = str(message.get("_modelUnansweredQuestionText") or message.get("text") or "").strip()
        if not question:
            continue
        question_pool_judgement = judge_recruiter_user_question_pool_item(
            question,
            context,
            knowledge_hit=knowledge_hit,
        )
        if not question_pool_judgement.get("shouldSave") and not force_save:
            continue
        if force_save and not question_pool_judgement.get("shouldSave"):
            question_pool_judgement = {
                **question_pool_judgement,
                "shouldSave": True,
                "forcedSave": True,
                "reason": safe_text(str(question_pool_judgement.get("reason") or "forced_silent_rule_save"), 220),
            }
        question_key_source = normalize_unclear_question_key(question)
        question_key = stable_digest(question_key_source or question, 20)
        question_signature = chat_message_signature(message)
        candidate_identity_key = str(identity.get("identityKey") or "")
        fingerprint = stable_digest(f"{candidate_identity_key or candidate_label}|{question_signature or question_key}", 24)
        items.append({
            "id": "uq_" + fingerprint,
            "fingerprint": fingerprint,
            "time": captured_at,
            "capturedAt": captured_at,
            "status": "unanswered",
            "candidate": safe_text(candidate_label, 180),
            "candidateLabel": safe_text(candidate_label, 180),
            "candidateName": safe_text(str(identity.get("candidateName") or recruiter_candidate_name_from_label(candidate_label)), 80),
            "appliedPosition": safe_text(str(identity.get("appliedPosition") or context.get("appliedPosition") or ""), 80),
            "conversationKey": safe_text(conversation_key, 80),
            "candidateIdentityKey": safe_text(candidate_identity_key, 80),
            "candidateIdentity": identity,
            "question": safe_text(question, 260),
            "questionKey": question_key,
            "questionMessageTime": safe_text(str(message.get("time") or ""), 40),
            "questionSignature": safe_text(question_signature, 40),
            "screeningStatus": safe_text(screening_status, 40),
            "action": safe_text(action, 60),
            "answer": safe_text(answer, 120),
            "knowledgeSource": safe_text(str((knowledge_hit or {}).get("source") or ""), 80),
            "knowledgeTopic": safe_text(str((knowledge_hit or {}).get("topic") or ""), 120),
            "questionPoolJudge": question_pool_judgement,
            "questionCategory": safe_text(str(question_pool_judgement.get("category") or ""), 60),
            "normalizedQuestion": safe_text(str(question_pool_judgement.get("normalizedQuestion") or question), 180),
            "questionPoolReason": safe_text(str(question_pool_judgement.get("reason") or ""), 220),
            "replyTarget": {
                "candidateName": safe_text(str(identity.get("candidateName") or recruiter_candidate_name_from_label(candidate_label)), 80),
                "candidateIdentityKey": safe_text(candidate_identity_key, 80),
                "conversationKey": safe_text(conversation_key, 80),
                "labelHint": safe_text(candidate_label, 180),
            },
        })
    return items


def append_recruiter_question_items(file_path: Path, items: list[dict]) -> None:
    if not items:
        return
    existing = load_json(file_path, [])
    if not isinstance(existing, list):
        existing = []
    normalized_existing: list[dict] = []
    by_fingerprint: dict[str, dict] = {}
    now_text = time.strftime("%Y-%m-%d %H:%M:%S")
    for raw in existing:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        question = str(item.get("question") or item.get("text") or "").strip()
        question_key = str(item.get("questionKey") or "")
        if not question_key:
            question_key = stable_digest(normalize_unclear_question_key(question) or question, 20) if question else ""
            if question_key:
                item["questionKey"] = question_key
        fingerprint = str(item.get("fingerprint") or item.get("id") or "")
        if not fingerprint:
            fingerprint = stable_digest(
                f"{item.get('candidateIdentityKey') or item.get('candidate') or item.get('candidateLabel') or ''}|{item.get('questionSignature') or question_key or question}",
                24,
            )
            item["fingerprint"] = fingerprint
        item.setdefault("id", "uq_" + fingerprint)
        item.setdefault("status", "unanswered")
        item.setdefault("count", 1)
        item.setdefault("firstSeenAt", item.get("time") or item.get("capturedAt") or now_text)
        item.setdefault("updatedAt", item.get("time") or item.get("capturedAt") or now_text)
        occurrences = item.get("occurrences")
        if not isinstance(occurrences, list):
            occurrences = [{
                "candidate": item.get("candidate") or item.get("candidateLabel") or "",
                "candidateIdentityKey": item.get("candidateIdentityKey") or "",
                "questionMessageTime": item.get("questionMessageTime") or "",
                "capturedAt": item.get("capturedAt") or item.get("time") or "",
            }]
        item["occurrences"] = occurrences[-20:]
        normalized_existing.append(item)
        if fingerprint:
            by_fingerprint[fingerprint] = item

    for raw in items:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        question = str(item.get("question") or item.get("text") or "").strip()
        if not question:
            continue
        question_key = str(item.get("questionKey") or stable_digest(normalize_unclear_question_key(question) or question, 20))
        item["questionKey"] = question_key
        fingerprint = str(item.get("fingerprint") or "")
        if not fingerprint:
            fingerprint = stable_digest(
                f"{item.get('candidateIdentityKey') or item.get('candidate') or item.get('candidateLabel') or ''}|{item.get('questionSignature') or question_key}",
                24,
            )
            item["fingerprint"] = fingerprint
        existing_item = by_fingerprint.get(fingerprint)
        occurrence = {
            "candidate": item.get("candidate") or item.get("candidateLabel") or "",
            "candidateIdentityKey": item.get("candidateIdentityKey") or "",
            "questionMessageTime": item.get("questionMessageTime") or "",
            "capturedAt": item.get("capturedAt") or item.get("time") or now_text,
        }
        if existing_item:
            existing_item["count"] = int(existing_item.get("count") or 1) + 1
            existing_item["updatedAt"] = now_text
            existing_item["latestQuestion"] = safe_text(question, 260)
            existing_item["latestCandidate"] = item.get("candidate") or item.get("candidateLabel") or ""
            occurrences = existing_item.get("occurrences")
            if not isinstance(occurrences, list):
                occurrences = []
            occurrences.append(occurrence)
            existing_item["occurrences"] = occurrences[-20:]
            for key in ("answer", "action", "screeningStatus", "knowledgeSource", "knowledgeTopic", "replyTarget"):
                if item.get(key):
                    existing_item[key] = item[key]
            continue
        item.setdefault("id", "uq_" + fingerprint)
        item.setdefault("time", now_text)
        item.setdefault("capturedAt", now_text)
        item.setdefault("status", "unanswered")
        item.setdefault("count", 1)
        item.setdefault("firstSeenAt", item.get("capturedAt") or now_text)
        item["updatedAt"] = now_text
        item["occurrences"] = [occurrence]
        normalized_existing.append(item)
        by_fingerprint[fingerprint] = item

    question_counts: dict[str, int] = {}
    for item in normalized_existing:
        key = str(item.get("questionKey") or "")
        if key:
            question_counts[key] = question_counts.get(key, 0) + int(item.get("count") or 1)
    for item in normalized_existing:
        key = str(item.get("questionKey") or "")
        if key:
            item["similarQuestionCount"] = question_counts.get(key, int(item.get("count") or 1))
    save_json(file_path, normalized_existing[-1000:])


def append_recruiter_unclear_questions(items: list[dict]) -> None:
    append_recruiter_question_items(UNCLEAR_QUESTIONS_FILE, items)


def append_recruiter_user_questions(items: list[dict]) -> None:
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or item.get("latestQuestion") or item.get("text") or "")
        judgement = item.get("questionPoolJudge") if isinstance(item.get("questionPoolJudge"), dict) else {}
        if judgement and judgement.get("shouldSave") is False:
            continue
        if judgement and judgement.get("forcedSave"):
            filtered.append(item)
            continue
        if judgement and judgement.get("modelEnabled") and judgement.get("shouldSave"):
            filtered.append(item)
            continue
        if is_recruiter_user_question_pool_item(question):
            filtered.append(item)
    append_recruiter_question_items(USER_QUESTIONS_FILE, filtered)


def compact_recruiter_batch_result(item: dict) -> dict:
    if not isinstance(item, dict):
        return {}
    knowledge_answer = item.get("knowledgeAnswer") if isinstance(item.get("knowledgeAnswer"), dict) else {}
    compact = {
        "index": item.get("index"),
        "label": safe_text(str(item.get("label") or ""), 160),
        "action": safe_text(str(item.get("action") or ""), 80),
