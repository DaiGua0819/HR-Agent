            }

        if screening.get("status") == "accept":
            accepted_result = self.handle_basic_acceptance_and_request_resume(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state,
                screening,
            )
            return {
                **accepted_result,
                "candidate": candidate,
                "opened": opened,
                "screening": screening,
            }

        if screening.get("status") == "reject":
            last_text = str((screening.get("lastOther") or {}).get("text") or "")
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "basic_conditions_rejected",
                context=context,
                lastOther=safe_text(last_text, 180),
                lastScreening=screening.get("reason") or "",
                decisionBasis=screening.get("decisionBasis") if isinstance(screening.get("decisionBasis"), dict) else {},
            )
            message = (
                f"候选人明确不接受关键条件，本轮不再求简历，也不会点击“不合适”：{safe_text(last_text, 120)}。"
            )
            return {
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "screening": screening,
                "shouldMarkUnsuitable": False,
            }

        last_text = str((screening.get("lastOther") or {}).get("text") or "")
        message = (
            f"候选人对基础条件的回复还不明确，本轮先不求简历：{safe_text(last_text, 120)}。"
            "等对方明确接受后再继续。"
        )
        return {
            "message": message,
            "candidate": candidate,
            "opened": opened,
            "screening": screening,
        }

    def screen_next_recruiter_basic_conditions(self, terminal: BrowserTerminal, max_attempts: int = 5) -> dict:
        skipped_waiting: list[str] = []
        sent_waiting: list[str] = []
        excluded_labels: list[str] = []
        no_target_attempts = 0

        for pending in self.pending_recruiter_basic_candidates(limit=6):
            self.check_pause()
            candidate_name = str(pending.get("candidateName") or "").strip()
            target = find_recruiter_candidate_by_identity(terminal, pending, scroll_attempts=4)
            if not target and candidate_name:
                target = find_recruiter_candidate_by_name(terminal, candidate_name, scroll_attempts=6)
            if not target:
                continue
            locator = target.get("locator")
            if locator is None:
                continue
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            terminal.current_page().wait_for_timeout(random.randint(850, 1350))
            repair = self.screen_recruiter_basic_conditions(
                terminal,
                open_unreplied=False,
                target_candidate="",
            )
            if repair.get("blocked") and not repair.get("sent"):
                continue
            repair["repairedPending"] = pending
            repair["message"] = (
                f"已优先补处理之前打开但未确认发送基础情况的候选人：{safe_text(candidate_name, 40)}。"
                + safe_text(str(repair.get("message") or ""), 260)
            )
            return repair

        for _ in range(max(1, int(max_attempts or 1))):
            self.check_pause()
            target = find_recruiter_unreplied_candidate(terminal, exclude_labels=excluded_labels)
            if not target:
                scrolled = scroll_recruiter_candidate_list(terminal)
                no_target_attempts += 1
                if scrolled.get("scrolled") and no_target_attempts <= max(3, min(18, int(max_attempts or 1))):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
                    continue
                message = "没有在当前可见列表里找到还需要发送基础情况的未回复候选人。"
                if sent_waiting:
                    message += f" 本轮已发送基础情况并转入等待 {len(sent_waiting)} 人：" + "；".join(safe_text(item, 60) for item in sent_waiting[:6])
                if skipped_waiting:
                    message += " 已跳过正在等待候选人回复的人：" + "；".join(safe_text(item, 60) for item in skipped_waiting[:6])
                return {
                    "blocked": not bool(sent_waiting),
                    "message": message,
                    "skippedWaiting": skipped_waiting,
                    "sentWaiting": sent_waiting,
                    "candidate": None,
                }

            locator = target.get("locator")
            target_label = str(target.get("label") or "")
            if locator is None:
                excluded_labels.append(target_label)
                continue

            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            terminal.current_page().wait_for_timeout(random.randint(900, 1400))
            opened = {k: v for k, v in target.items() if k != "locator"}
            maybe_human_reading_pause(terminal, reason="candidate_open", text_hint=target_label)

            history = self.load_chat_history(terminal, max_rounds=CHAT_HISTORY_SCROLL_ROUNDS)
            context = self.read_chat_context(terminal, history=history)
            candidate = read_recruiter_selected_candidate(terminal)
            candidate_label = str(candidate.get("label") or target_label)
            label_key = compact_conversation_label(candidate_label) or compact_conversation_label(target_label)
            if label_key and label_key not in excluded_labels:
                excluded_labels.append(label_key)

            position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
            conversation_key = str(context.get("conversationKey") or "")
            candidate_state_key = recruiter_basic_candidate_state_key(candidate_label)
            previous_state = self.get_chat_state(conversation_key) or self.get_chat_state(candidate_state_key)
            if should_use_position_screening_flow(context, position_reply):
                result = self.screen_recruiter_position_rules(
                    terminal,
                    context,
                    candidate_label,
                    conversation_key,
                    candidate_state_key,
                    previous_state,
                )
                result["opened"] = opened
                result["skippedWaiting"] = skipped_waiting
                result["sentWaiting"] = sent_waiting
                return result
            knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
            position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
            if is_unconfigured_recruiter_position(context, position_reply, position_screening):
                screening = {
                    "status": "unclear",
                    "reason": "position_screening_not_configured",
                    "lastOther": context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {},
                }
                skipped_waiting.append(safe_text(candidate_label or target_label, 100))
                self.set_recruiter_basic_state(
                    conversation_key,
                    candidate_label,
                    "position_screening_unclear",
                    context=context,
                    lastScreening="position_screening_not_configured",
                )
                terminal.current_page().wait_for_timeout(random.randint(450, 850))
                continue
            if not is_ai_app_basic_conditions_position(context, position_reply):
                skipped_waiting.append(safe_text(candidate_label or target_label, 100))
                self.set_recruiter_basic_state(
                    conversation_key,
                    candidate_label,
                    "position_screening_unclear",
                    context=context,
                    lastScreening="common_phrase_restricted_to_ai_intern",
                )
                terminal.current_page().wait_for_timeout(random.randint(450, 850))
                continue
            phrase = str(position_reply.get("initialCommonPhrase") or BASIC_CONDITIONS_PHRASE).strip()
            screening = analyze_basic_condition_screening(context.get("messages", []), phrase)
            screening = apply_basic_waiting_state_to_screening(screening, previous_state, context)
            rule_screening = screening
            screening = enhance_basic_condition_screening_with_model(
                context,
                phrase,
                screening,
                previous_state,
            )
            screening = preserve_zhilian_basic_acceptance_after_model(screening, rule_screening, platform="boss")
            if screening.get("status") == "not_asked" and previous_state.get("status") not in {
                "basic_conditions_sent_waiting",
                "basic_conditions_waiting",
                "basic_conditions_accepted_resume_requested",
                "basic_conditions_accepted_resume_already_requested",
                "basic_conditions_accepted_resume_blocked",
                "basic_conditions_rejected",
            }:
                self.set_recruiter_basic_state(
                    conversation_key,
                    candidate_label,
                    "basic_conditions_opened_unsent",
                    context=context,
                    source="opened_before_basic_conditions_send",
                )

            if screening.get("status") == "unclear" and isinstance(screening.get("lastOther"), dict):
                knowledge_result = self.answer_recruiter_knowledge_question(
                    terminal,
                    context,
                    candidate_label,
                    conversation_key,
                    candidate_state_key,
                    previous_state=previous_state,
                )
                if knowledge_result.get("answered") and conversation_review_requests_resume_after_answer(context, screening):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
                    accepted_screening = dict(screening)
                    accepted_screening["status"] = "accept"
                    accepted_screening["reason"] = accepted_screening.get("reason") or "conversation_review_answer_then_request_resume"
                    accepted_screening["acceptedByConversationReview"] = True
                    accepted_result = self.handle_basic_acceptance_and_request_resume(
                        terminal,
                        context=context,
                        candidate_label=candidate_label,
                        conversation_key=conversation_key,
                        candidate_state_key=candidate_state_key,
                        previous_state=previous_state,
                        screening=accepted_screening,
                        knowledge_result=knowledge_result,
                    )
                    return {
                        **accepted_result,
                        "candidate": candidate,
                        "opened": opened,
                        "screening": accepted_screening,
                        "knowledgeAnswer": knowledge_result,
                        "skippedWaiting": skipped_waiting,
                        "sentWaiting": sent_waiting,
                    }
                if knowledge_result_stops_flow(knowledge_result):
                    return {
                        "message": knowledge_result.get("message") or "已按知识库回复候选人问题。",
                        "candidate": candidate,
                        "opened": opened,
                        "screening": screening,
                        "knowledgeAnswer": knowledge_result,
                        "skippedWaiting": skipped_waiting,
                        "sentWaiting": sent_waiting,
                    }

            if screening.get("status") == "waiting":
                skipped_waiting.append(safe_text(candidate_label or target_label, 100))
                self.set_chat_state(
                    conversation_key,
                    "basic_conditions_waiting",
                    candidateLabel=safe_text(candidate_label, 160),
                    lastScreening=screening.get("reason") or "",
                )
                self.set_chat_state(
                    candidate_state_key,
                    "basic_conditions_waiting",
                    candidateLabel=safe_text(candidate_label, 160),
                    lastScreening=screening.get("reason") or "",
                )
                self.set_recruiter_basic_state(
                    conversation_key,
                    candidate_label,
                    "basic_conditions_waiting",
                    context=context,
                    lastScreening=screening.get("reason") or "",
                )
                terminal.current_page().wait_for_timeout(random.randint(450, 850))
                continue

            if screening.get("status") == "not_asked":
                send_result, verification = self.send_basic_conditions_with_verification(
                    terminal,
                    phrase,
                    max_attempts=CHAT_SEND_MAX_ATTEMPTS,
                )
                if not send_result.get("blocked"):
                    self.set_chat_state(
                        conversation_key,
                        "basic_conditions_sent_waiting",
                        candidateLabel=safe_text(candidate_label, 160),
                        phrase=safe_text(phrase, 240),
                    )
                    self.set_chat_state(
                        candidate_state_key,
                        "basic_conditions_sent_waiting",
                        candidateLabel=safe_text(candidate_label, 160),
                        phrase=safe_text(phrase, 240),
                    )
                    verification = self.verify_basic_conditions_sent_in_current_chat(terminal, phrase)
                    if not verification.get("verified"):
                        send_result["retrySkipped"] = "max_attempts_reached"
                        self.set_recruiter_basic_state(
                            conversation_key,
                            candidate_label,
                            "basic_conditions_needs_resend",
                            context=context,
                            source="send_not_visible_in_chat_history",
                            phrase=safe_text(phrase, 240),
                        )
                        label_to_exclude = compact_conversation_label(candidate_label or target_label)
                        if label_to_exclude and label_to_exclude not in excluded_labels:
                            excluded_labels.append(label_to_exclude)
                        terminal.current_page().wait_for_timeout(random.randint(520, 980))
                        continue
                    self.set_recruiter_basic_state(
                        conversation_key,
                        candidate_label,
                        "basic_conditions_sent_waiting",
                        context=context,
                        phrase=safe_text(phrase, 240),
                        verifiedAt=time.strftime("%Y-%m-%d %H:%M:%S"),
                    )
                    sent_waiting.append(safe_text(candidate_label or target_label, 100))
                    label_to_exclude = compact_conversation_label(candidate_label or target_label)
                    if label_to_exclude and label_to_exclude not in excluded_labels:
                        excluded_labels.append(label_to_exclude)
                    terminal.current_page().wait_for_timeout(random.randint(520, 980))
                    continue
                message = (
                    f"已打开最近未回复候选人并发送公司/岗位基础情况常用语：{safe_text(candidate_label, 80)}。"
                    "等待对方回复后再判断是否求简历。"
                )
                if skipped_waiting:
                    message += f" 本轮先跳过 {len(skipped_waiting)} 个已发基础情况但还在等待回复的人。"
                if send_result.get("blocked"):
                    message = send_result.get("message") or "发送基础条件常用语失败。"
                return {
                    "message": message,
                    "candidate": candidate,
                    "opened": opened,
                    "screening": screening,
                    "sent": send_result,
                    "skippedWaiting": skipped_waiting,
                    "sentWaiting": sent_waiting,
                    "blocked": bool(send_result.get("blocked")),
                }

            if screening.get("status") == "accept":
                accepted_result = self.handle_basic_acceptance_and_request_resume(
                    terminal,
                    context=context,
                    candidate_label=candidate_label,
                    conversation_key=conversation_key,
                    candidate_state_key=candidate_state_key,
                    previous_state=previous_state,
                    screening=screening,
                )
                message = (
                    f"已打开最近未回复候选人，检测到对方接受基础条件，已继续求简历："
                    f"{safe_text(str(accepted_result.get('message') or ''), 240)}"
                )
                if skipped_waiting:
                    message += f" 本轮先跳过 {len(skipped_waiting)} 个正在等待回复的人。"
                return {
                    **accepted_result,
                    "message": message,
                    "candidate": candidate,
                    "opened": opened,
                    "screening": screening,
                    "skippedWaiting": skipped_waiting,
                    "sentWaiting": sent_waiting,
                }

            if screening.get("status") == "reject":
                self.set_chat_state(
                    conversation_key,
                    "basic_conditions_rejected",
                    candidateLabel=safe_text(candidate_label, 160),
                    lastOther=safe_text(str((screening.get("lastOther") or {}).get("text") or ""), 180),
                )
                self.set_chat_state(
                    candidate_state_key,
                    "basic_conditions_rejected",
                    candidateLabel=safe_text(candidate_label, 160),
                    lastOther=safe_text(str((screening.get("lastOther") or {}).get("text") or ""), 180),
                )
                self.set_recruiter_basic_state(
                    conversation_key,
                    candidate_label,
                    "basic_conditions_rejected",
                    context=context,
                    lastOther=safe_text(str((screening.get("lastOther") or {}).get("text") or ""), 180),
                )
                last_text = str((screening.get("lastOther") or {}).get("text") or "")
                return {
                    "message": (
                        f"已打开最近未回复候选人，但对方明确不接受关键条件，本轮不求简历："
                        f"{safe_text(last_text, 120)}。不会点击“不合适”。"
                    ),
                    "candidate": candidate,
                    "opened": opened,
                    "screening": screening,
                    "shouldMarkUnsuitable": False,
                    "skippedWaiting": skipped_waiting,
                    "sentWaiting": sent_waiting,
                }

            last_text = str((screening.get("lastOther") or {}).get("text") or "")
            self.set_chat_state(
                conversation_key,
                "basic_conditions_waiting",
                candidateLabel=safe_text(candidate_label, 160),
                lastScreening=screening.get("reason") or "",
                lastOther=safe_text(last_text, 180),
            )
            self.set_chat_state(
                candidate_state_key,
                "basic_conditions_waiting",
                candidateLabel=safe_text(candidate_label, 160),
                lastScreening=screening.get("reason") or "",
                lastOther=safe_text(last_text, 180),
            )
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "basic_conditions_waiting",
                context=context,
                lastScreening=screening.get("reason") or "",
                lastOther=safe_text(last_text, 180),
            )
            skipped_waiting.append(
                f"{safe_text(candidate_label or target_label, 80)}（回复不明确：{safe_text(last_text, 40)}）"
            )
            label_to_exclude = compact_conversation_label(candidate_label or target_label)
            if label_to_exclude and label_to_exclude not in excluded_labels:
                excluded_labels.append(label_to_exclude)
            terminal.current_page().wait_for_timeout(random.randint(450, 850))
            continue

        message = "连续多次只找到已经发过基础情况、正在等待回复的候选人，已停止，避免重复点击同一个人。"
        if sent_waiting:
            message += f" 本轮已发送基础情况并转入等待 {len(sent_waiting)} 人：" + "；".join(safe_text(item, 60) for item in sent_waiting[:6])
        if skipped_waiting:
            message += " 跳过记录：" + "；".join(safe_text(item, 60) for item in skipped_waiting[:6])
        return {
            "blocked": not bool(sent_waiting),
            "message": message,
            "skippedWaiting": skipped_waiting,
            "sentWaiting": sent_waiting,
            "candidate": None,
        }

    @timed_agent_stage("process_all_unread_messages", "处理全部未读消息")
    def screen_all_recruiter_unread_basic_conditions(
        self,
        terminal: BrowserTerminal,
        max_total: int = 80,
        target_position: str = "",
        date_scope: str = "",
    ) -> dict:
        target_limit = max(1, min(160, int(max_total or 80)))
        target_position = clean_applied_position(target_position)
        date_scope = normalize_recruiter_date_scope(date_scope)
        results: list[dict] = []
        processed_keys: set[str] = set()
        repeated_labels: list[str] = []
        skipped_filter: list[dict] = []
        unclear_questions: list[dict] = []
        sent_basic = 0
        requested_resume = 0
        already_requested_resume = 0
        downloaded_resume = 0
        skipped_waiting = 0
        unconfigured_position = 0
        rejected = 0
        blocked = 0
        knowledge_answered = 0
        passes = 0
        page = terminal.current_page()

        def detect_recruiter_captcha(phase: str) -> dict | None:
            try:
                context = terminal.collect_page_context(limit=80)
            except Exception as error:
                return {"checked": False, "phase": phase, "error": safe_text(str(error), 160)}
            body = str(context.get("bodyTextPreview") or "")
            title = str(context.get("title") or "")
            url = str(context.get("url") or "")
            haystack = f"{title}\n{body}"
            if not (
                any(word in haystack for word in ("验证码", "安全验证", "请完成验证", "人机验证", "滑块验证", "验证后继续"))
                or re.search(r"captcha|security\s*check|verify\.html", haystack + "\n" + url, re.I)
            ):
                return None
            return {
                "checked": True,
                "phase": phase,
                "title": safe_text(title, 120),
                "url": safe_text(url, 240),
                "text": safe_text(haystack, 500),
            }

        def stop_for_recruiter_captcha(phase: str, unread_filter_state: dict | None = None) -> dict | None:
            captcha = detect_recruiter_captcha(phase)
            if not captcha or not captcha.get("checked"):
                return None
            message = "检测到页面出现人机验证/验证码/安全验证，已停止 BOSS 消息处理，等待人工处理后再继续。"
            state = {
                "blocked": blocked + 1,
                "reason": "human_verification",
                "captcha": True,
                "captchaPhase": phase,
                "captchaPage": captcha,
                "sentBasic": sent_basic,
                "requestedResume": requested_resume,
                "downloadedResume": downloaded_resume,
                "alreadyRequestedResume": already_requested_resume,
                "skippedWaiting": skipped_waiting,
                "unconfiguredPosition": unconfigured_position,
                "rejected": rejected,
                "knowledgeAnswered": knowledge_answered,
                "repeatedUnread": len(repeated_labels),
                "filteredOut": len(skipped_filter),
                "unclearQuestionCount": len(unclear_questions),
                "targetPosition": target_position,
                "dateScope": date_scope,
                "unreadFilterClicked": bool((unread_filter_state or {}).get("clicked")),
                "processedPeople": len(results),
                "passes": passes,
                "counts": {
                    "human_verification": 1,
                    "blocked": blocked + 1,
                },
            }
            if isinstance(unread_filter_state, dict):
                state["unreadFilter"] = unread_filter_state
            self.add_event("system", message, state)
            batch_report = append_recruiter_batch_report({
                "type": "screen_all_recruiter_unread_basic_conditions",
                "message": safe_text(message, 800),
                "state": state,
                "results": results,
                "filteredOut": skipped_filter[:120],
                "unclearQuestions": unclear_questions[:120],
            })
            return {
                "captcha": True,
                "blocked": True,
                "message": message,
                "results": results,
                "passes": passes,
                "state": state,
                "batchReportId": batch_report.get("runId"),
                "filteredOut": skipped_filter[:30],
                "unclearQuestions": unclear_questions[:30],
            }

        current_url = str(getattr(page, "url", "") or "")
        if "zhipin.com" not in current_url or "/web/chat" not in current_url:
            self.measure_current_timing_stage(
                "open_boss_chat_page",
                "BOSS 打开聊天页",
                lambda: page.goto("https://www.zhipin.com/web/chat/index", wait_until="domcontentloaded", timeout=20000),
            )
            page.wait_for_timeout(random.randint(1400, 2200))
        captcha_stop = stop_for_recruiter_captcha("after_open_chat_page")
        if captcha_stop:
            return captcha_stop
        unread_filter = self.measure_current_timing_stage(
            "prepare_unread_filter",
            "切换/检查未读筛选",
            lambda: prepare_recruiter_unread_candidate_list(terminal),
        )
        captcha_stop = stop_for_recruiter_captcha("after_prepare_unread_filter", unread_filter)
        if captcha_stop:
            return captcha_stop
        if not unread_filter.get("found"):
            page = terminal.current_page()
            message = (
                "处理消息未开始：当前页面没有找到 BOSS 消息列表里的“未读”筛选。"
                "请先进入 BOSS 聊天消息页后再处理，或点击“BOSS自动化”重新拉起消息页。"
            )
            state = {
                "blocked": 1,
                "reason": unread_filter.get("reason") or "unread_tab_not_found",
                "url": safe_text(getattr(page, "url", ""), 180),
                "title": safe_text(page.title() if page else "", 80),
                "unreadFilter": unread_filter,
                "processedPeople": 0,
                "passes": 0,
            }
            self.add_event("system", message, state)
            return {
                "blocked": True,
                "message": message,
                "results": [],
                "passes": 0,
                "state": state,
                "unreadFilter": unread_filter,
            }

        def record_result(label: str, action: str, result: dict, target: dict | None = None, context: dict | None = None) -> None:
            nonlocal sent_basic, requested_resume, already_requested_resume, downloaded_resume, skipped_waiting, unconfigured_position, rejected, blocked, knowledge_answered
            screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
            status = str(screening.get("status") or "")
            resume = result.get("resume") if isinstance(result.get("resume"), dict) else {}
            resume_skipped = bool(resume.get("skipped") and resume.get("skipReason") in {"already_requested", "resume_attachment_received"})
            resume_downloaded = bool(result.get("downloaded") or resume.get("downloaded"))
            if action == "auto":
                if resume_downloaded and result.get("knowledgeAnswer") and not result.get("blocked"):
                    action = "knowledge_answered_resume_downloaded"
                elif resume_downloaded and not result.get("blocked"):
                    action = "accepted_resume_downloaded"
                elif resume_skipped and result.get("knowledgeAnswer") and not result.get("blocked"):
                    action = "knowledge_answered_resume_already_requested"
                elif resume_skipped and not result.get("blocked"):
                    action = "accepted_resume_already_requested"
                elif result.get("resume") and result.get("knowledgeAnswer") and not result.get("blocked"):
                    action = "knowledge_answered_and_requested_resume"
                elif result.get("sent") and result.get("knowledgeAnswer") and not result.get("blocked"):
                    action = "knowledge_answered_and_sent_screening"
                elif result.get("knowledgeAnswer") and not result.get("blocked"):
                    action = "knowledge_answered"
                elif result.get("sent") and not result.get("blocked"):
                    action = "sent_basic_conditions"
                elif result.get("resume") and not result.get("blocked"):
                    action = "accepted_requested_resume"
                elif result.get("shouldMarkUnsuitable") or status == "reject":
                    action = "rejected_skipped"
                elif result.get("skippedUnconfiguredPosition"):
                    action = "unconfigured_position_skipped"
                elif result.get("blocked"):
                    action = "blocked"
                else:
                    action = "unclear_or_waiting_skipped"
            if action == "sent_basic_conditions":
                sent_basic += 1
            elif action == "accepted_requested_resume":
                requested_resume += 1
            elif action == "knowledge_answered_and_requested_resume":
                knowledge_answered += 1
                requested_resume += 1
            elif action == "accepted_resume_downloaded":
                downloaded_resume += 1
            elif action == "knowledge_answered_resume_downloaded":
                knowledge_answered += 1
                downloaded_resume += 1
            elif action == "accepted_resume_already_requested":
                already_requested_resume += 1
            elif action == "knowledge_answered_resume_already_requested":
                knowledge_answered += 1
                already_requested_resume += 1
            elif action == "knowledge_answered_and_sent_screening":
                knowledge_answered += 1
                sent_basic += 1
            elif action == "rejected_skipped":
                rejected += 1
            elif action == "blocked":
                blocked += 1
            elif action == "knowledge_answered":
                knowledge_answered += 1
            elif action == "unconfigured_position_skipped":
                unconfigured_position += 1
            else:
                skipped_waiting += 1
            knowledge_answer = result.get("knowledgeAnswer") if isinstance(result.get("knowledgeAnswer"), dict) else {}
            last_other = screening.get("lastOther") if isinstance(screening.get("lastOther"), dict) else {}
            question_text = str(last_other.get("text") or "").strip()
            if (
                question_text
                and (
                    (action == "unclear_or_waiting_skipped" and status == "unclear")
                    or str(knowledge_answer.get("answer") or "").strip() == "暂时还不清楚"
                )
            ):
                if isinstance(context, dict) and context:
                    question_messages = recent_unanswered_question_messages(context)
                    if not question_messages and isinstance(last_other, dict):
                        question_messages = [last_other]
                    unclear_questions.extend(
                        build_recruiter_unclear_question_items(
                            label,
                            context,
                            question_messages,
                            action=action,
                            screening_status=status,
                            answer=str(knowledge_answer.get("answer") or ""),
                            knowledge_hit=knowledge_answer.get("knowledgeHit") if isinstance(knowledge_answer.get("knowledgeHit"), dict) else knowledge_answer,
                        )
                    )
                else:
                    unclear_questions.append({
                        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                        "candidate": safe_text(label, 140),
                        "candidateLabel": safe_text(label, 180),
                        "candidateName": safe_text(recruiter_candidate_name_from_label(label), 80),
                        "question": safe_text(question_text, 240),
                        "questionKey": stable_digest(normalize_unclear_question_key(question_text) or question_text, 20),
                        "screeningStatus": status,
                        "action": action,
                        "answer": safe_text(str(knowledge_answer.get("answer") or ""), 120),
                        "fingerprint": stable_digest(f"{label}|{question_text}", 24),
                    })
            context_dict = context if isinstance(context, dict) else {}
            conversation_key = safe_text(str(context_dict.get("conversationKey") or ""), 120)
            candidate_identity = build_recruiter_candidate_identity(context_dict, label, conversation_key) if context_dict else {}
            context_messages = context_dict.get("messages") if isinstance(context_dict.get("messages"), list) else []
            result_item = {
                "index": len(results) + 1,
                "label": safe_text(label, 140),
                "candidateName": safe_text(str(candidate_identity.get("candidateName") or recruiter_candidate_name_from_label(label)), 80),
                "appliedPosition": safe_text(str(context_dict.get("appliedPosition") or candidate_identity.get("appliedPosition") or ""), 80),
                "conversationKey": conversation_key,
                "candidateIdentityKey": safe_text(str(candidate_identity.get("identityKey") or ""), 80),
                "candidateIdentity": candidate_identity,
                "action": action,
                "screeningStatus": status,
                "message": safe_text(str(result.get("message") or ""), 260),
                "unreadCount": (target or {}).get("unreadCount"),
                "knowledgeAnswer": knowledge_answer,
                "lastOther": safe_text(str(last_other.get("text") or ""), 500),
            }
            if context_messages:
                result_item["messages"] = [
                    {
                        "sender": safe_text(str(message.get("sender") or ""), 20),
                        "time": safe_text(str(message.get("time") or ""), 40),
                        "status": safe_text(str(message.get("status") or ""), 40),
                        "text": safe_text(str(message.get("text") or ""), 500),
                        "rawText": safe_text(str(message.get("rawText") or message.get("text") or ""), 600),
                    }
                    for message in context_messages[-80:]
                    if isinstance(message, dict) and str(message.get("text") or "").strip()
                ]
            results.append(result_item)

        max_passes = 8
        while len(results) < target_limit and passes < max_passes:
            self.check_pause()
            passes += 1
            scroll_recruiter_candidate_list_to_top(terminal)
            terminal.current_page().wait_for_timeout(random.randint(650, 1150))
            captcha_stop = stop_for_recruiter_captcha("before_pass_scan", unread_filter)
            if captcha_stop:
                return captcha_stop

            excluded_this_pass: list[str] = []
            pass_handled = 0
            no_target_attempts = 0
            max_scan_attempts = 28

            while len(results) < target_limit and no_target_attempts < max_scan_attempts:
                self.check_pause()
                target = self.measure_current_timing_stage(
                    "find_unread_candidate",
                    "查找未读候选人",
                    lambda: find_recruiter_unreplied_candidate(terminal, exclude_labels=excluded_this_pass),
                )
                if not target:
                    scrolled = scroll_recruiter_candidate_list(terminal)
                    no_target_attempts += 1
                    captcha_stop = stop_for_recruiter_captcha("after_no_target_scroll", unread_filter)
                    if captcha_stop:
                        return captcha_stop
                    if scrolled.get("scrolled") and no_target_attempts < max_scan_attempts:
                        terminal.current_page().wait_for_timeout(random.randint(560, 980))
                        continue
                    break

                locator = target.get("locator")
                target_label = str(target.get("label") or "")
                label_key = compact_conversation_label(target_label)
                if label_key:
                    excluded_this_pass.append(label_key)
                date_match = recruiter_label_matches_date_scope(target_label, date_scope)
                if date_match is False:
                    skipped_filter.append({
                        "label": safe_text(target_label, 120),
                        "reason": "date_scope",
                    })
                    if label_key:
                        processed_keys.add(label_key)
                    continue
                position_match = recruiter_label_matches_position(target_label, target_position)
                if target_position and position_match is not True:
                    skipped_filter.append({
                        "label": safe_text(target_label, 120),
                        "reason": "position_precheck" if position_match is False else "position_unknown_precheck",
                    })
                    if label_key:
                        processed_keys.add(label_key)
                    continue
                if label_key and label_key in processed_keys:
                    repeated_labels.append(safe_text(target_label, 100))
                    continue
                if locator is None:
                    record_result(target_label, "blocked", {
                        "blocked": True,
                        "message": "找到了未读候选人，但没有拿到可点击元素。",
                    }, target)
                    if label_key:
                        processed_keys.add(label_key)
                    continue

                try:
                    click_started = time.time()
                    if terminal.humanize:
                        self.measure_current_timing_stage(
                            "open_candidate_pre_action_pause",
                            "打开候选人前停顿",
                            lambda: terminal.pause_like_person("pre_action"),
                        )
                        highlight_target(locator)
                    self.measure_current_timing_stage(
                        "open_candidate_click",
                        "执行候选人点击",
                        lambda: humanized_locator_click(terminal, locator, force=True),
                    )
                    if terminal.humanize:
                        self.measure_current_timing_stage(
                            "open_candidate_post_action_pause",
                            "打开候选人后停顿",
                            lambda: terminal.pause_like_person("post_action"),
                        )
                    self.measure_current_timing_stage(
                        "open_candidate_wait_detail",
                        "等待候选人详情加载",
                        lambda: terminal.current_page().wait_for_timeout(random.randint(900, 1450)),
                    )
                    self.record_current_timing_stage(
                        "open_candidate",
                        "点击并打开候选人",
                        click_started,
                        ok=True,
                        extra={"candidate": safe_text(target_label, 80)},
                    )
                    captcha_stop = stop_for_recruiter_captcha("after_open_candidate", unread_filter)
                    if captcha_stop:
                        return captcha_stop
                except Exception as error:
                    self.record_current_timing_stage(
                        "open_candidate",
                        "点击并打开候选人",
                        click_started,
                        ok=False,
                        error=str(error),
                        extra={"candidate": safe_text(target_label, 80)},
                    )
                    record_result(target_label, "blocked", {
                        "blocked": True,
                        "message": f"点击未读候选人时页面列表刷新，元素已失效；已跳过本项继续处理：{safe_text(str(error), 120)}",
                    }, target)
                    if label_key:
                        processed_keys.add(label_key)
                    try:
                        terminal.current_page().wait_for_timeout(random.randint(420, 760))
                    except Exception:
                        pass
                    continue
                maybe_human_reading_pause(terminal, reason="candidate_open", text_hint=target_label)

                candidate = read_recruiter_selected_candidate(terminal)
                candidate_label = str(candidate.get("label") or target_label)
                context_before = self.read_chat_context(terminal)
                applied_position = clean_applied_position(str(context_before.get("appliedPosition") or ""))
                if target_position and applied_position and target_position not in applied_position and applied_position not in target_position:
                    skipped_filter.append({
                        "label": safe_text(candidate_label or target_label, 120),
                        "reason": "position_after_open",
                        "appliedPosition": safe_text(applied_position, 80),
                    })
                    if label_key:
                        processed_keys.add(label_key)
                    candidate_key = compact_conversation_label(candidate_label) or label_key
                    if candidate_key:
                        processed_keys.add(candidate_key)
                        excluded_this_pass.append(candidate_key)
                    continue
                candidate_key = compact_conversation_label(candidate_label) or label_key
                if candidate_key:
                    processed_keys.add(candidate_key)
                    excluded_this_pass.append(candidate_key)
                if label_key:
                    processed_keys.add(label_key)

                result = self.measure_current_timing_stage(
                    "screen_candidate_rules",
                    "判断岗位规则并处理候选人",
                    lambda: self.screen_recruiter_basic_conditions(
                        terminal,
                        open_unreplied=False,
                        target_candidate="",
                        max_attempts=1,
                    ),
                )
                record_result(candidate_label or target_label, "auto", result, target, context_before)
                pass_handled += 1
                maybe_human_batch_pause(terminal, len(results))
                captcha_stop = stop_for_recruiter_captcha("after_screen_candidate", unread_filter)
                if captcha_stop:
                    return captcha_stop

            scroll_recruiter_candidate_list_to_top(terminal)
            terminal.current_page().wait_for_timeout(random.randint(900, 1450))
            captcha_stop = stop_for_recruiter_captcha("after_pass_scroll_top", unread_filter)
            if captcha_stop:
                return captcha_stop
            if pass_handled == 0:
                break
            maybe_human_reading_pause(terminal, reason="page_change", text_hint=f"第 {passes} 轮未读处理完成")

        captcha_stop = stop_for_recruiter_captcha("before_final_report", unread_filter)
        if captcha_stop:
            return captcha_stop

        parts = [
            f"所有未读消息处理完成：共扫描 {passes} 轮，处理 {len(results)} 条未读。",
            f"已发公司情况/岗位筛选问题 {sent_basic} 人；接受并下载简历 {downloaded_resume} 人；接受并求简历 {requested_resume} 人；知识库答复 {knowledge_answered} 人；不接受已略过 {rejected} 人；待考虑/不明确已略过 {skipped_waiting} 人。",
        ]
        if unconfigured_position:
            parts.append(f"未添加到岗位知识库的联系人 {unconfigured_position} 人已跳过，未回复。")
        if already_requested_resume:
            parts.append(f"另有 {already_requested_resume} 人已确认之前求过简历，本轮跳过重复点击。")
        if unread_filter.get("clicked"):
            parts.insert(0, "已先切换到“未读”筛选。")
        if blocked:
            parts.append(f"阻塞 {blocked} 人。")
        if repeated_labels:
            parts.append(f"另有 {len(repeated_labels)} 条仍显示未读但本轮已处理过，已避免重复操作。")
        if skipped_filter:
            parts.append(f"已按岗位/日期过滤跳过 {len(skipped_filter)} 条非目标联系人。")
        if unclear_questions:
            append_recruiter_unclear_questions(unclear_questions)
            user_question_items = [
                item
                for item in unclear_questions
                if candidate_message_has_followup_question(str(item.get("question") or item.get("latestQuestion") or ""))
            ]
            append_recruiter_user_questions(user_question_items)
            parts.append(f"已收集 {len(unclear_questions)} 条不确定问题用于完善知识库。")
        if len(results) >= target_limit:
            parts.append(f"已达到本次安全上限 {target_limit} 条，避免无限循环。")
        if results:
            position_counts: dict[str, int] = {}
            for item in results:
                position = safe_text(str(item.get("appliedPosition") or "未知岗位"), 40)
                position_counts[position] = position_counts.get(position, 0) + 1
            if position_counts:
                parts.append(
                    "岗位分布："
                    + "；".join(
                        f"{position} {count} 人"
                        for position, count in sorted(position_counts.items(), key=lambda pair: pair[1], reverse=True)[:8]
                    )
                )
            parts.append(
                "处理记录："
                + "；".join(
                    f"{item['index']}. {safe_text(str(item.get('label') or ''), 50)}（{item.get('action')}）"
                    for item in results[:18]
                )
            )
        else:
            parts.append("没有发现新的未读消息。")
        message = " ".join(parts)
        self.add_event("chat", message)
        state = {
            "sentBasic": sent_basic,
            "requestedResume": requested_resume,
            "downloadedResume": downloaded_resume,
            "alreadyRequestedResume": already_requested_resume,
            "skippedWaiting": skipped_waiting,
            "unconfiguredPosition": unconfigured_position,
            "rejected": rejected,
            "blocked": blocked,
            "knowledgeAnswered": knowledge_answered,
            "repeatedUnread": len(repeated_labels),
            "filteredOut": len(skipped_filter),
            "unclearQuestionCount": len(unclear_questions),
            "targetPosition": target_position,
            "dateScope": date_scope,
            "unreadFilterClicked": bool(unread_filter.get("clicked")),
            "processedPeople": len(results),
            "passes": passes,
        }
        batch_report = append_recruiter_batch_report({
            "type": "screen_all_recruiter_unread_basic_conditions",
            "message": safe_text(message, 800),
            "state": state,
            "results": results,
            "filteredOut": skipped_filter[:120],
            "unclearQuestions": unclear_questions[:120],
        })
        return {
            "message": message,
            "results": results,
            "passes": passes,
            "state": state,
            "batchReportId": batch_report.get("runId"),
            "unreadFilter": unread_filter,
            "filteredOut": skipped_filter[:30],
            "unclearQuestions": unclear_questions[:30],
        }

    @timed_agent_stage("collect_operation_resumes", "补采运营岗位简历")
    def collect_operation_resume_contacts(self, terminal: BrowserTerminal, max_total: int = 80) -> dict:
        target_limit = max(1, min(200, int(max_total or 80)))
        page = terminal.current_page()
        current_url = str(getattr(page, "url", "") or "")
        if "zhipin.com" not in current_url or "/web/chat" not in current_url:
            self.measure_current_timing_stage(
                "open_boss_chat_page",
                "BOSS 打开聊天页",
                lambda: page.goto("https://www.zhipin.com/web/chat/index", wait_until="domcontentloaded", timeout=20000),
            )
            page.wait_for_timeout(random.randint(1400, 2200))
        prepare_state = self.measure_current_timing_stage(
            "prepare_recruiter_all_filter",
            "BOSS 切换全部联系人",
            lambda: prepare_recruiter_all_candidate_list(terminal),
        )
        scroll_recruiter_candidate_list_to_top(terminal)
        terminal.current_page().wait_for_timeout(random.randint(520, 900))

        results: list[dict] = []
        filtered: list[dict] = []
        counts: dict[str, int] = {}
        scan_trace: list[dict] = []
        excluded_labels: list[str] = []
        processed_keys: set[str] = set()
        no_target_attempts = 0
        max_scan_attempts = max(40, min(220, target_limit * 5))

        while len(results) < target_limit and no_target_attempts < max_scan_attempts:
            self.check_pause()
            target = self.measure_current_timing_stage(
                "find_recent_operation_candidate",
                "BOSS 查找运营岗位联系人",
                lambda: find_recruiter_recent_candidate(terminal, exclude_labels=excluded_labels),
            )
            if not target:
                scrolled = scroll_recruiter_candidate_list(terminal)
                no_target_attempts += 1
                scan_trace.append({
                    "step": len(scan_trace) + 1,
                    "event": "no_target_scroll",
                    "processed": len(results),
                    "filtered": len(filtered),
                    "scrolled": bool(scrolled.get("scrolled")),
                    "reason": safe_text(str(scrolled.get("reason") or ""), 80),
                    "atEnd": bool(scrolled.get("atEnd")),
                })
                if scrolled.get("scrolled") and no_target_attempts < max_scan_attempts:
                    terminal.current_page().wait_for_timeout(random.randint(560, 980))
                    continue
                break

            target_label = str(target.get("label") or "")
            label_key = compact_conversation_label(target_label)
            if label_key:
                excluded_labels.append(label_key)
                if label_key in processed_keys:
                    continue
                processed_keys.add(label_key)
            target_name = recruiter_candidate_name_from_label(target_label)
            if target_name:
                excluded_labels.append(target_name)

            locator = target.get("locator")
            if locator is None:
                counts["open_candidate_failed"] = counts.get("open_candidate_failed", 0) + 1
                filtered.append({
                    "label": safe_text(target_label, 140),
                    "reason": "missing_locator",
                })
                continue

            try:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(900, 1450))
            except Exception as error:
                counts["open_candidate_failed"] = counts.get("open_candidate_failed", 0) + 1
                filtered.append({
                    "label": safe_text(target_label, 140),
                    "reason": "open_candidate_failed",
                    "message": safe_text(str(error), 180),
                })
                continue

            maybe_human_reading_pause(terminal, reason="operation_resume_candidate_open", text_hint=target_label)
            candidate = read_recruiter_selected_candidate(terminal)
            candidate_label = str(candidate.get("label") or target_label)
            candidate_key = compact_conversation_label(candidate_label)
            if candidate_key:
                excluded_labels.append(candidate_key)
                processed_keys.add(candidate_key)

            context_before = self.read_chat_context(terminal)
            position_reply = context_before.get("positionReply") if isinstance(context_before.get("positionReply"), dict) else {}
            position_text = " ".join([
                str(context_before.get("appliedPosition") or ""),
                str((context_before.get("applicant") or {}).get("appliedPosition") if isinstance(context_before.get("applicant"), dict) else ""),
                str(candidate_label or ""),
                str(target_label or ""),
            ])
            if not is_direct_resume_operations_position(context_before, position_reply) and not direct_resume_operations_position_matches(position_text):
                filtered.append({
                    "label": safe_text(candidate_label or target_label, 140),
                    "reason": "operation_position_mismatch",
                    "appliedPosition": safe_text(str(context_before.get("appliedPosition") or ""), 80),
                })
                continue

            result = self.measure_current_timing_stage(
                "process_operation_resume_candidate",
                "BOSS 直求运营岗位简历",
                lambda: self.screen_recruiter_basic_conditions(
                    terminal,
                    open_unreplied=False,
                    target_candidate="",
                    max_attempts=1,
                ),
            )
            action = classify_recruiter_screen_result_action(result)
            counts[action] = counts.get(action, 0) + 1
            screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
            resume = result.get("resume") if isinstance(result.get("resume"), dict) else {}
            results.append({
                "index": len(results) + 1,
                "label": safe_text(candidate_label or target_label, 140),
                "candidateName": safe_text(str(((context_before.get("applicant") or {}) if isinstance(context_before.get("applicant"), dict) else {}).get("name") or recruiter_candidate_name_from_label(candidate_label or target_label)), 80),
                "appliedPosition": safe_text(str(context_before.get("appliedPosition") or ""), 80),
                "resumeJobType": direct_resume_operations_job_type(context_before, position_reply),
                "conversationKey": safe_text(str(context_before.get("conversationKey") or ""), 120),
                "action": action,
                "screeningStatus": safe_text(str(screening.get("status") or ""), 40),
                "message": safe_text(str(result.get("message") or ""), 260),
                "resume": compact_recruiter_resume_result(resume),
            })
            maybe_human_batch_pause(terminal, len(results))

        message = f"BOSS 运营岗位简历补采完成：处理 {len(results)} 人，跳过非目标/不可处理 {len(filtered)} 人。"
        if counts:
            message += " 动作统计：" + "；".join(f"{key} {value}" for key, value in sorted(counts.items()))
        if len(results) >= target_limit:
            message += f" 已达到本次上限 {target_limit} 人。"
        self.add_event("chat", message)
        state = {
            "platform": "boss",
            "processedPeople": len(results),
            "filteredOut": len(filtered),
            "counts": counts,
            "targetPositions": list(direct_resume_operations_target_positions()),
            "prepareState": prepare_state,
            "scanTraceCount": len(scan_trace),
        }
        batch_report = append_recruiter_batch_report({
            "type": "collect_operation_resume_contacts",
            "message": safe_text(message, 800),
            "state": state,
            "results": results,
            "filteredOut": filtered[:160],
            "scanTrace": scan_trace[-160:],
        })
        return {
            "message": message,
            "results": results,
            "counts": counts,
            "filteredOut": filtered[:60],
            "state": state,
            "scanTrace": scan_trace[-80:],
            "batchReportId": batch_report.get("runId"),
        }

    def screen_recent_recruiter_basic_contacts(self, terminal: BrowserTerminal, max_contacts: int = 15) -> dict:
        target_count = max(1, min(30, int(max_contacts or 15)))
        results: list[dict] = []
        excluded_labels: list[str] = []
        processed_names: set[str] = set()
        no_target_attempts = 0

        scroll_recruiter_candidate_list_to_top(terminal)
        terminal.current_page().wait_for_timeout(random.randint(420, 780))

        max_scan_attempts = max(target_count * 4, target_count + 10)
        while len(results) < target_count and len(results) + no_target_attempts < max_scan_attempts:
            self.check_pause()
            target = find_recruiter_recent_candidate(terminal, exclude_labels=excluded_labels)
            if not target:
                scrolled = scroll_recruiter_candidate_list(terminal)
                no_target_attempts += 1
                if scrolled.get("scrolled") and no_target_attempts <= max(4, min(18, target_count)):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
                    continue
                break

            locator = target.get("locator")
            target_label = str(target.get("label") or "")
            target_name = recruiter_candidate_name_from_label(target_label)
            if target_name and target_name in processed_names:
                excluded_labels.append(target_label)
                continue
            if locator is None:
                excluded_labels.append(target_label)
                results.append({
                    "index": len(results) + 1,
                    "label": safe_text(target_label, 120),
                    "action": "blocked",
                    "message": "找到了联系人，但没有拿到可点击元素。",
                })
                continue

            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            terminal.current_page().wait_for_timeout(random.randint(900, 1400))
            maybe_human_reading_pause(terminal, reason="recent_candidate_open", text_hint=target_label)

            candidate = read_recruiter_selected_candidate(terminal)
            candidate_label = str(candidate.get("label") or target_label)
            for name in (target_name, recruiter_candidate_name_from_label(candidate_label)):
                if name:
                    processed_names.add(name)
            for label in (target_label, candidate_label, compact_conversation_label(candidate_label or target_label)):
                if label and label not in excluded_labels:
                    excluded_labels.append(label)

            result = self.screen_recruiter_basic_conditions(
                terminal,
                open_unreplied=False,
                target_candidate="",
                max_attempts=1,
            )
            screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
            action = classify_recruiter_screen_result_action(result)

            results.append({
                "index": len(results) + 1,
                "label": safe_text(candidate_label or target_label, 120),
                "action": action,
                "screeningStatus": screening.get("status") or "",
                "message": safe_text(str(result.get("message") or ""), 220),
                "knowledgeAnswer": result.get("knowledgeAnswer") if isinstance(result.get("knowledgeAnswer"), dict) else {},
            })
            terminal.current_page().wait_for_timeout(random.randint(520, 980))

        counts: dict[str, int] = {}
        for item in results:
            action = str(item.get("action") or "checked")
            counts[action] = counts.get(action, 0) + 1
        brief_parts = []
        for key, label in (
            ("sent_basic_conditions", "已发公司情况/岗位筛选问题"),
            ("accepted_resume_downloaded", "接受并下载简历"),
            ("knowledge_answered_resume_downloaded", "答疑后下载简历"),
            ("accepted_requested_resume", "接受并求简历"),
            ("knowledge_answered_and_requested_resume", "答疑后求简历"),
            ("knowledge_answered_and_sent_screening", "答疑后继续筛选"),
            ("accepted_resume_already_requested", "接受但已求过简历"),
            ("knowledge_answered_resume_already_requested", "答疑后发现已求过简历"),
            ("knowledge_answered", "知识库答复"),
            ("rejected_skipped", "不接受已略过"),
            ("unclear_or_waiting_skipped", "待考虑/不明确已略过"),
            ("blocked", "受阻"),
        ):
            if counts.get(key):
                brief_parts.append(f"{label} {counts[key]} 人")
        message = f"最近联系人基础条件筛选完成：目标 {target_count} 人，已查看 {len(results)} 人。"
        if brief_parts:
            message += " " + "；".join(brief_parts) + "。"
        if len(results) < target_count:
            message += " 列表后续没有找到更多可见联系人，或已滚动到末尾。"
        if results:
            message += " 处理记录：" + "；".join(
                f"{item['index']}. {safe_text(str(item.get('label') or ''), 45)}（{item.get('action')}）"
                for item in results[:10]
            )
        self.add_event("chat", message)
        state = {
            "targetCount": target_count,
            "processedPeople": len(results),
            "counts": counts,
        }
        batch_report = append_recruiter_batch_report({
            "type": "screen_recent_recruiter_basic_contacts",
            "message": safe_text(message, 800),
            "state": state,
            "results": results,
        })
        return {
            "message": message,
            "results": results,
            "counts": counts,
            "targetCount": target_count,
            "processed": len(results),
            "state": state,
            "batchReportId": batch_report.get("runId"),
        }

    def screen_recent_recruiter_contacts_with_followup_watch(
        self,
        terminal: BrowserTerminal,
        max_contacts: int = 10,
        idle_seconds: int = 30,
        max_monitor_seconds: int = 12 * 60,
    ) -> dict:
        target_count = max(1, min(30, int(max_contacts or 10)))
        idle_seconds = max(5, min(120, int(idle_seconds or 30)))
        max_monitor_seconds = max(idle_seconds, min(30 * 60, int(max_monitor_seconds or 12 * 60)))
        initial_results: list[dict] = []
        followup_results: list[dict] = []
        watch_items: list[dict] = []
        excluded_labels: list[str] = []
        processed_names: set[str] = set()
        no_target_attempts = 0

        scroll_recruiter_candidate_list_to_top(terminal)
        terminal.current_page().wait_for_timeout(random.randint(520, 880))

        max_scan_attempts = max(target_count * 4, target_count + 10)
        while len(initial_results) < target_count and len(initial_results) + no_target_attempts < max_scan_attempts:
            self.check_pause()
            target = find_recruiter_recent_candidate(terminal, exclude_labels=excluded_labels)
            if not target:
                scrolled = scroll_recruiter_candidate_list(terminal)
                no_target_attempts += 1
                if scrolled.get("scrolled") and no_target_attempts <= max(4, min(18, target_count)):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
                    continue
                break

            locator = target.get("locator")
            target_label = str(target.get("label") or "")
            target_name = recruiter_candidate_name_from_label(target_label)
            if target_name and target_name in processed_names:
                excluded_labels.append(target_label)
                continue
            if locator is None:
                excluded_labels.append(target_label)
                initial_results.append({
                    "index": len(initial_results) + 1,
                    "label": safe_text(target_label, 120),
                    "action": "blocked",
                    "message": "找到了联系人，但没有拿到可点击元素。",
                })
                continue

            try:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(900, 1400))
            except Exception as error:
                excluded_labels.append(target_label)
                initial_results.append({
                    "index": len(initial_results) + 1,
                    "label": safe_text(target_label, 120),
                    "action": "blocked",
                    "message": f"点击联系人失败：{safe_text(str(error), 140)}",
                })
                continue
            maybe_human_reading_pause(terminal, reason="recent_candidate_open", text_hint=target_label)

            candidate = read_recruiter_selected_candidate(terminal)
            candidate_label = str(candidate.get("label") or target_label)
            context_before = self.read_chat_context(terminal)
            conversation_key = str(context_before.get("conversationKey") or "")
            identity = build_recruiter_candidate_identity(context_before, candidate_label, conversation_key)
            for name in (target_name, recruiter_candidate_name_from_label(candidate_label), identity.get("candidateName")):
                if name:
                    processed_names.add(str(name))
            for label in (target_label, candidate_label, compact_conversation_label(candidate_label or target_label)):
                if label and label not in excluded_labels:
                    excluded_labels.append(label)

            result = self.screen_recruiter_basic_conditions(
                terminal,
                open_unreplied=False,
                target_candidate="",
                max_attempts=1,
            )
            context_after = self.read_chat_context(terminal)
            candidate_after = read_recruiter_selected_candidate(terminal)
            candidate_label_after = str(candidate_after.get("label") or candidate_label or target_label)
            conversation_key_after = str(context_after.get("conversationKey") or conversation_key)
            identity_after = build_recruiter_candidate_identity(context_after, candidate_label_after, conversation_key_after)
            watch_item = build_recruiter_watch_item(candidate_label_after, context_after, identity_after)
            if watch_item and not any(recruiter_watch_items_same(item, watch_item) for item in watch_items):
                watch_items.append(watch_item)

            action = classify_recruiter_screen_result_action(result)
            screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
            initial_results.append({
                "index": len(initial_results) + 1,
                "label": safe_text(candidate_label_after or candidate_label or target_label, 120),
                "action": action,
                "screeningStatus": screening.get("status") or "",
                "message": safe_text(str(result.get("message") or ""), 220),
                "watch": {
                    "candidateName": safe_text(str(watch_item.get("candidateName") or ""), 40) if watch_item else "",
                    "identityKey": safe_text(str(watch_item.get("identityKey") or ""), 40) if watch_item else "",
                },
            })
            terminal.current_page().wait_for_timeout(random.randint(520, 980))

        scroll_recruiter_candidate_list_to_top(terminal)
        terminal.current_page().wait_for_timeout(random.randint(700, 1100))

        idle_deadline = time.time() + idle_seconds
        monitor_started = time.time()
        sweeps = 0
        missed_visible = 0
        direct_watch_cursor = 0
        while watch_items and time.time() < idle_deadline and time.time() - monitor_started < max_monitor_seconds:
            self.check_pause()
            sweeps += 1
            handled_this_sweep = 0
            current_result = self.process_current_recruiter_watch_followup(terminal, watch_items)
            if current_result.get("handled"):
                followup_results.append(current_result)
                handled_this_sweep += 1
                idle_deadline = time.time() + idle_seconds
                maybe_human_batch_pause(terminal, len(followup_results))

            scroll_recruiter_candidate_list_to_top(terminal)
            terminal.current_page().wait_for_timeout(random.randint(360, 620))
            excluded_unread: list[str] = []
            scanned_unread = 0
            while True:
                self.check_pause()
                unread_target = find_recruiter_unreplied_candidate(terminal, exclude_labels=excluded_unread)
                if not unread_target:
                    break
                scanned_unread += 1
                unread_label = str(unread_target.get("label") or "")
                watch_item = find_matching_recruiter_watch_item(watch_items, unread_label)
                if not watch_item:
                    excluded_unread.append(unread_label)
                    if scanned_unread >= 12:
                        break
                    continue
                locator = unread_target.get("locator")
                if locator is None:
                    followup_results.append({
                        "handled": False,
                        "label": safe_text(unread_label, 120),
                        "action": "blocked",
                        "message": "找到了观察名单里的未读联系人，但没有拿到可点击元素。",
                    })
                    excluded_unread.append(unread_label)
                    break
                try:
                    if terminal.humanize:
                        terminal.pause_like_person("pre_action")
                        highlight_target(locator)
                    humanized_locator_click(terminal, locator, force=True)
                    if terminal.humanize:
                        terminal.pause_like_person("post_action")
                    terminal.current_page().wait_for_timeout(random.randint(850, 1350))
                except Exception as error:
                    followup_results.append({
                        "handled": False,
                        "label": safe_text(unread_label, 120),
                        "action": "blocked",
                        "message": f"点击观察名单未读联系人失败：{safe_text(str(error), 140)}",
                    })
                    excluded_unread.append(unread_label)
                    break
                maybe_human_reading_pause(terminal, reason="watch_followup_open", text_hint=unread_label)
                process_result = self.process_current_recruiter_watch_followup(
                    terminal,
                    watch_items,
                    forced_watch_item=watch_item,
                )
                if process_result.get("handled"):
                    followup_results.append(process_result)
                    handled_this_sweep += 1
                    idle_deadline = time.time() + idle_seconds
                    maybe_human_batch_pause(terminal, len(followup_results))
                    break
                followup_results.append(process_result)
                excluded_unread.append(unread_label)
                break

            if not handled_this_sweep and watch_items:
                revisit_results, direct_watch_cursor = self.revisit_recruiter_watch_items_for_followups(
                    terminal,
                    watch_items,
                    start_index=direct_watch_cursor,
                    max_items=min(len(watch_items), 4),
                )
                for revisit in revisit_results:
                    if revisit.get("handled"):
                        followup_results.append(revisit)
                        handled_this_sweep += 1
                        idle_deadline = time.time() + idle_seconds
                        maybe_human_batch_pause(terminal, len(followup_results))
                    elif revisit.get("action") in {"blocked", "open_not_verified"}:
                        followup_results.append(revisit)

            if handled_this_sweep:
                continue
            remaining_ms = int(max(0, idle_deadline - time.time()) * 1000)
            if remaining_ms <= 0:
                break
            missed_visible += 1
            terminal.current_page().wait_for_timeout(min(2400, max(450, remaining_ms)))

        counts: dict[str, int] = {}
        for item in initial_results + followup_results:
            action = str(item.get("action") or "checked")
            counts[action] = counts.get(action, 0) + 1
        message = (
            f"最近联系人观察流程完成：先处理 {len(initial_results)}/{target_count} 人，"
            f"观察名单 {len(watch_items)} 人；后续观察 {sweeps} 轮，处理新回复 {len([r for r in followup_results if r.get('handled')])} 次。"
        )
        if time.time() - monitor_started >= max_monitor_seconds:
            message += f" 已达到观察安全上限 {max_monitor_seconds} 秒。"
        else:
            message += f" 已连续 {idle_seconds} 秒没有观察名单内的新回复，流程结束。"
        if initial_results:
            message += " 初始记录：" + "；".join(
                f"{item['index']}. {safe_text(str(item.get('label') or ''), 42)}（{item.get('action')}）"
                for item in initial_results[:12]
            )
        if followup_results:
            message += " 后续记录：" + "；".join(
                f"{index}. {safe_text(str(item.get('label') or ''), 42)}（{item.get('action')}）"
                for index, item in enumerate(followup_results[:12], start=1)
                if item.get("handled")
            )
        self.add_event("chat", message)
        state = {
            "targetCount": target_count,
            "processedInitial": len(initial_results),
            "processedPeople": len(initial_results),
            "followupHandled": len([item for item in followup_results if item.get("handled")]),
            "watchCount": len(watch_items),
            "idleSeconds": idle_seconds,
            "sweeps": sweeps,
            "missedVisibleSweeps": missed_visible,
            "counts": counts,
        }
        batch_report = append_recruiter_batch_report({
            "type": "screen_recent_recruiter_contacts_with_followup_watch",
            "message": safe_text(message, 800),
            "state": state,
            "results": initial_results,
            "followups": followup_results,
            "watchItems": [
                {k: item.get(k) for k in ("candidateName", "appliedPosition", "candidateLabel", "identityKey")}
                for item in watch_items
            ],
        })
        return {
            "message": message,
            "results": initial_results,
            "followups": followup_results,
            "watchItems": [
                {k: item.get(k) for k in ("candidateName", "appliedPosition", "candidateLabel", "identityKey")}
                for item in watch_items
            ],
            "counts": counts,
            "state": state,
            "batchReportId": batch_report.get("runId"),
        }

    def proactive_contact_recommended_candidates(
        self,
        terminal: BrowserTerminal,
        target_position: str = "应用技术经理（工业涂料领域）",
        max_total: int = 10,
        dry_run: bool = False,
        require_match: bool = False,
        custom_rules: dict | None = None,
    ) -> dict:
        if not self.proactive_task_lock.acquire(blocking=False):
            return {
                "blocked": True,
                "message": "已有主动联系任务正在执行或收尾，请稍等几秒后再试，避免重复打招呼。",
                "state": {
                    "targetPosition": safe_text(str(target_position or ""), 80),
                    "targetCount": max(1, min(30, int(max_total or 10))),
                    "reason": "proactive_task_already_running",
                },
                "results": [],
                "skipped": [],
                "counts": {"greeted": 0, "dryRun": 0, "skipped": 0},
            }
        try:
            return self._proactive_contact_recommended_candidates_impl(
                terminal=terminal,
                target_position=target_position,
                max_total=max_total,
                dry_run=dry_run,
                require_match=require_match,
                custom_rules=custom_rules,
            )
        finally:
            self.proactive_task_lock.release()

    def _proactive_contact_recommended_candidates_impl(
        self,
        terminal: BrowserTerminal,
        target_position: str = "应用技术经理（工业涂料领域）",
        max_total: int = 10,
        dry_run: bool = False,
        require_match: bool = False,
        custom_rules: dict | None = None,
    ) -> dict:
        self.check_pause()
        previous_pace = str(getattr(terminal, "pace", "normal") or "normal")
        previous_multiplier = float(getattr(terminal, "automation_speed_multiplier", self.automation_speed_multiplier) or self.automation_speed_multiplier)
        terminal.pace = "slow"
        terminal.automation_speed_multiplier = PROACTIVE_CONTACT_SPEED_MULTIPLIER
        apply_automation_speed_multiplier(terminal)

        def restore_proactive_speed() -> None:
            terminal.pace = previous_pace if previous_pace in PACE_PRESETS else "normal"
            terminal.automation_speed_multiplier = previous_multiplier
            apply_automation_speed_multiplier(terminal)

        target_count = max(1, min(30, int(max_total or 10)))
        target_position = str(target_position or "应用技术经理（工业涂料领域）").strip()
        custom_rule_config = normalize_proactive_contact_custom_rules(custom_rules)
        page = terminal.current_page()
        entry = open_recommend_page_from_left_menu(terminal)

        frame = wait_for_recommend_frame(page, timeout_ms=9000)
        if frame is None:
            result = {
                "blocked": True,
                "message": "没有找到 BOSS 推荐牛人页面的内容框，请先打开“推荐牛人”页面后再试。",
                "state": {
                    "targetPosition": target_position,
                    "entry": entry,
                    "speedMode": "proactive_slow",
                },
                "results": [],
            }
            restore_proactive_speed()
            return result

        selection = select_recommend_position_if_needed(terminal, frame, target_position)
        summary = read_recommend_frame_summary(frame)
        current_position = str(summary.get("position") or "")
        if target_position and current_position and not proactive_recommend_position_matches(current_position, target_position):
            result = {
                "blocked": True,
                "message": f"当前推荐页岗位是：{safe_text(current_position, 80)}，不是目标岗位：{safe_text(target_position, 80)}。请先在推荐牛人页切到对应岗位后再执行主动联系。",
                "state": {
                    "targetPosition": target_position,
                    "currentPosition": current_position,
                    "entry": entry,
                    "selection": selection,
                    "speedMode": "proactive_slow",
                },
                "results": [],
            }
            restore_proactive_speed()
            return result

        results: list[dict] = []
        skipped: list[dict] = []
        seen_keys: set[str] = set()
        opened_candidate_keys: set[str] = set()
        scroll_round = 0
        no_new_rounds = 0
        max_scroll_rounds = 12
        close_recommend_resume_dialog(terminal, frame)

        while len(results) < target_count and scroll_round <= max_scroll_rounds and no_new_rounds < 3:
            self.check_pause()
            cards = collect_recommend_candidate_cards(frame)
            handled_this_round = 0
            after_action_scrolled = False
            for card in cards:
                self.check_pause()
                if len(results) >= target_count:
                    break
                text = str(card.get("text") or "")
                candidate_key = recommend_candidate_key(card, target_position)
                if not candidate_key or candidate_key in seen_keys:
                    continue
                seen_keys.add(candidate_key)
                state_key = f"proactive|{target_position}|{candidate_key}"
                old_state = self.get_chat_state(state_key)
                candidate_name = extract_recommend_candidate_name(text)
                dom_index = int(card.get("domIndex") or 0)
                action_log = new_candidate_action_log(
                    account_id=AGENT_ACCOUNT_ID,
                    account_name=AGENT_ACCOUNT_NAME,
                    target_position=target_position,
                    candidate_name=candidate_name,
                    candidate_key=candidate_key,
                    state_key=state_key,
                    dom_index=dom_index,
                    dry_run=dry_run,
                    card_text=text,
                )

                def record_proactive_decision(decision: str, reason: str = "", **details) -> dict:
                    finish_action_log(action_log, decision, reason, **details)
                    try:
                        append_jsonl(PROACTIVE_ACTION_LOG_FILE, action_log)
                    except Exception:
                        pass
                    return action_log

                if str(old_state.get("status") or "") == "proactive_greeted":
                    record_proactive_decision("skipped", "state_duplicate", oldStateStatus=old_state.get("status") or "")
                    skipped.append({
                        "candidateName": candidate_name,
                        "action": "already_greeted_skipped",
                        "reason": "state_duplicate",
                        "actionLogId": action_log.get("actionLogId"),
                    })
                    continue
                origin = self.find_proactive_contact_origin(
                    candidate_name=candidate_name,
                    applied_position=target_position,
                    candidate_label=text,
                )
                if origin.get("matched"):
                    record_proactive_decision("skipped", "identity_duplicate", origin=origin)
                    skipped.append({
                        "candidateName": candidate_name,
                        "action": "already_greeted_skipped",
                        "reason": "identity_duplicate",
                        "stateKey": origin.get("stateKey") or "",
                        "actionLogId": action_log.get("actionLogId"),
                    })
                    continue
                if not bool(card.get("hasGreetButton")):
                    record_proactive_decision("skipped", "no_greet_button")
                    skipped.append({
                        "candidateName": candidate_name,
                        "action": "no_greet_button_skipped",
                        "reason": "no_greet_button",
                        "actionLogId": action_log.get("actionLogId"),
                    })
                    continue

                try:
                    card_locator = frame.locator(".candidate-card-wrap").nth(dom_index)
                    add_checkpoint(action_log, "open_resume_dialog", "started")
                    resume_open = open_recommend_candidate_resume_dialog(terminal, frame, card_locator)
                    if not resume_open.get("opened"):
                        add_checkpoint(action_log, "open_resume_dialog", "failed", reason=resume_open.get("reason") or "resume_dialog_not_opened")
                        record_proactive_decision(
                            "skipped",
                            resume_open.get("reason") or "resume_dialog_not_opened",
                            error=resume_open.get("error") or "",
                        )
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "resume_open_failed_skipped",
                            "reason": resume_open.get("reason") or "resume_dialog_not_opened",
                            "error": resume_open.get("error") or "",
                            "actionLogId": action_log.get("actionLogId"),
                        })
                        close_recommend_resume_dialog(terminal, frame)
                        continue
                    add_checkpoint(action_log, "open_resume_dialog", "passed")
                    opened_candidate_keys.add(candidate_key)
                    resume_info = resume_open.get("info") if isinstance(resume_open.get("info"), dict) else read_recommend_resume_dialog_info(frame)
                    resume_browse = human_browse_recommend_resume_dialog(terminal, frame, resume_info)
                    evidence_text = recommend_candidate_evidence_text(text, resume_info)
                    colleague_progress = recommend_candidate_colleague_progress_check(resume_info)
                    add_checkpoint(
                        action_log,
                        "read_resume",
                        "passed",
                        textLength=len(evidence_text),
                        hasGreetButton=bool(resume_info.get("hasGreetButton")),
                        colleagueProgress=colleague_progress,
