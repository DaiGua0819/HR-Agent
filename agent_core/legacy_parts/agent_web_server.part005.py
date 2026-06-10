            self.set_recruiter_basic_state(conversation_key, candidate_label, status, context=context, **{
                **state_payload,
                "knowledgeAnswered": bool(knowledge_result.get("answered")),
                "knowledgeAnsweredSignatures": knowledge_result.get("knowledgeAnsweredSignatures", []) if knowledge_result.get("answered") else [],
                "knowledgeAnswer": safe_text(str(knowledge_result.get("answer") or ""), 80) if knowledge_result.get("answered") else "",
            })
            if knowledge_result.get("answered"):
                message = (
                    f"51job 候选人满足筛选条件，已先回复追问：{safe_text(str(knowledge_result.get('answer') or ''), 80)}；"
                    f"随后继续处理简历：{safe_text(str(resume_result.get('message') or ''), 180)}"
                )
            else:
                message = f"51job 候选人满足筛选条件，已处理简历：{safe_text(str(resume_result.get('message') or ''), 180)}"
            result = {
                "message": message,
                "candidate": context.get("applicant", {}),
                "screening": analysis,
                "resume": resume_result,
                "blocked": bool(resume_result.get("blocked")),
                "positionScreening": True,
            }
            if knowledge_result.get("answered"):
                result["knowledgeAnswer"] = knowledge_result
            return result
        self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_unclear", context=context, **state_payload)
        return {
            "message": f"51job 候选人对筛选问题回复不明确，先跳过：{safe_text(candidate_label, 80)}",
            "candidate": context.get("applicant", {}),
            "screening": analysis,
            "positionScreening": True,
        }

    @timed_agent_stage("job51_process_current_candidate", "51job 处理当前候选人")
    def job51_process_current_position(self, terminal: BrowserTerminal, opened: dict | None = None) -> dict:
        self.check_pause()
        history = {"loaded": False, "reason": "job51_visible_dom_only"}
        context = self.job51_read_chat_context(terminal, history=history, opened=opened)
        candidate = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        conversation_key = str(context.get("conversationKey") or "")
        candidate_state_key = recruiter_basic_candidate_state_key(candidate_label)
        previous_state = self.get_chat_state(conversation_key) or self.get_chat_state(candidate_state_key)
        identity_warnings = candidate.get("identityWarnings") if isinstance(candidate.get("identityWarnings"), list) else []
        if identity_warnings:
            return {
                "blocked": True,
                "message": (
                    "51job 当前聊天头部/选中联系人与刚打开的候选人不一致，已停止当前人处理，"
                    "避免把上一位候选人的聊天记录用于发送、求简历或下载。"
                ),
                "candidate": candidate,
                "identityWarnings": identity_warnings,
                "skippedIdentityMismatch": True,
            }
        job51_ai_basic_allowed = is_explicit_ai_app_basic_conditions_position(context)
        if should_use_position_screening_flow(context, position_reply) or (
            not job51_ai_basic_allowed and normalize_position_screening_questions(position_screening)
        ):
            return self.job51_screen_position_rules(terminal, context, candidate_label, conversation_key, candidate_state_key, previous_state)
        if is_unconfigured_recruiter_position(context, position_reply, position_screening):
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "position_screening_unclear",
                context=context,
                platform="51job",
                lastScreening="position_screening_not_configured",
            )
            return {
                "message": f"51job 当前岗位未配置到知识库，跳过不回复：{safe_text(str(context.get('appliedPosition') or ''), 80)}",
                "candidate": candidate,
                "skippedUnconfiguredPosition": True,
            }
        if not job51_ai_basic_allowed:
            knowledge_result = self.answer_recruiter_knowledge_question(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state=previous_state,
            )
            if knowledge_result_stops_flow(knowledge_result):
                return {**knowledge_result, "candidate": candidate}
            return {
                "message": f"51job 非 AI 岗位本轮没有需要推进的动作：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
            }
        phrase = str(position_reply.get("initialCommonPhrase") or BASIC_CONDITIONS_PHRASE).strip()
        screening = self.measure_current_timing_stage(
            "job51_analyze_basic_conditions",
            "51job 本地基础条件判断",
            lambda: analyze_basic_condition_screening(context.get("messages", []), phrase),
        )
        screening = self.measure_current_timing_stage(
            "job51_apply_basic_waiting_state",
            "51job 套用历史等待状态",
            lambda: apply_basic_waiting_state_to_screening(screening, previous_state, context),
        )
        rule_screening = screening
        if screening.get("status") != "not_asked" and context.get("lastSender") == "other":
            model_screening = self.measure_current_timing_stage(
                "job51_enhance_basic_conditions_model",
                "51job 模型辅助基础条件判断",
                lambda: enhance_basic_condition_screening_with_model(context, phrase, screening, previous_state),
            )
        if screening.get("status") != "not_asked" and context.get("lastSender") == "other":
            screening = preserve_zhilian_basic_acceptance_after_model(model_screening, rule_screening, platform="job51")
        if screening.get("status") == "not_asked":
            send_result = self.job51_send_common_word_with_verification(terminal, phrase)
            status = "basic_conditions_needs_resend" if send_result.get("blocked") else "basic_conditions_sent_waiting"
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                status,
                context=context,
                platform="51job",
                phrase=safe_text(phrase, 240),
                screening=screening,
            )
            return {
                "message": f"51job 已向 AI 岗位候选人发送基础条件：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "screening": screening,
                "sent": send_result,
                "blocked": bool(send_result.get("blocked")),
            }
        if screening.get("status") == "unclear":
            knowledge_result = self.answer_recruiter_knowledge_question(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state=previous_state,
            )
            if knowledge_result_stops_flow(knowledge_result):
                return {**knowledge_result, "candidate": candidate, "screening": screening}
        if screening.get("status") == "waiting":
            return {
                "message": f"51job 已发基础条件，候选人暂未明确回复：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "screening": screening,
            }
        if screening.get("status") == "accept":
            knowledge_result = self.answer_recruiter_knowledge_question(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state=previous_state,
            ) if (recent_unanswered_question_messages(context, previous_state) or match_company_knowledge_silent_question(context)) else {}
            if knowledge_result.get("answered"):
                terminal.current_page().wait_for_timeout(random.randint(650, 1150))
            elif knowledge_result_stops_flow(knowledge_result):
                return {**knowledge_result, "candidate": candidate, "screening": screening}
            resume_result = self.job51_download_attachment_or_request_resume(
                terminal,
                accepted_by_flow={
                    "accepted": True,
                    "source": "basic_conditions_accept",
                    "reason": screening.get("reason") or "basic_conditions_accept",
                    "screening": screening,
                },
            )
            request_result = resume_result.get("request") if isinstance(resume_result.get("request"), dict) else {}
            resume_skipped = bool(request_result.get("skipped") and request_result.get("skipReason") in {"already_requested", "resume_attachment_received"})
            status = "basic_conditions_accepted_resume_downloaded" if resume_result.get("downloaded") else (
                "basic_conditions_accepted_resume_already_requested" if resume_skipped else (
                    "basic_conditions_accepted_resume_blocked" if resume_result.get("blocked") else "basic_conditions_accepted_resume_requested"
                )
            )
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                status,
                context=context,
                platform="51job",
                screening=screening,
                knowledgeAnswered=bool(knowledge_result.get("answered")),
                knowledgeAnsweredSignatures=knowledge_result.get("knowledgeAnsweredSignatures", []) if knowledge_result.get("answered") else [],
                knowledgeAnswer=safe_text(str(knowledge_result.get("answer") or ""), 80) if knowledge_result.get("answered") else "",
            )
            if knowledge_result.get("answered"):
                message = (
                    f"51job AI 候选人接受基础条件，已先回复追问：{safe_text(str(knowledge_result.get('answer') or ''), 80)}；"
                    f"随后继续处理简历：{safe_text(str(resume_result.get('message') or ''), 180)}"
                )
            else:
                message = f"51job AI 候选人接受基础条件，已处理简历：{safe_text(str(resume_result.get('message') or ''), 180)}"
            result = {
                "message": message,
                "candidate": candidate,
                "screening": screening,
                "resume": resume_result,
                "blocked": bool(resume_result.get("blocked")),
            }
            if knowledge_result.get("answered"):
                result["knowledgeAnswer"] = knowledge_result
            return result
        if screening.get("status") == "reject":
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "basic_conditions_rejected",
                context=context,
                platform="51job",
                screening=screening,
            )
            return {
                "message": f"51job AI 候选人明确不接受基础条件，已跳过：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "screening": screening,
                "shouldMarkUnsuitable": False,
            }
        return {
            "message": f"51job 候选人回复不明确，先跳过：{safe_text(candidate_label, 80)}",
            "candidate": candidate,
            "screening": screening,
        }

    @timed_agent_stage("job51_process_all_unread_messages", "51job 处理全部未读消息")
    def job51_process_unread_all_positions(
        self,
        terminal: BrowserTerminal,
        max_total: int = 40,
        target_position: str = "",
    ) -> dict:
        try:
            target_limit = int(max_total)
        except Exception:
            target_limit = 40
        if target_limit < 0:
            target_limit = 40
        target_limit = max(0, min(80, target_limit))
        self.measure_current_timing_stage("job51_open_chat_page", "51job 打开聊天页", lambda: self.job51_open_chat_page(terminal))
        results: list[dict] = []
        filtered: list[dict] = []
        counts: dict[str, int] = {}
        unread_filter = self.measure_current_timing_stage("job51_prepare_unread_filter", "51job 切换未读筛选", lambda: self.job51_prepare_unread_filter(terminal))
        if not unread_filter.get("found"):
            filtered.append({"reason": "unread_filter_not_found", "state": unread_filter})
        all_position_filter = self.measure_current_timing_stage("job51_select_all_positions", "51job 切换全部岗位", lambda: self.job51_select_all_positions(terminal))
        if not all_position_filter.get("selected"):
            filtered.append({"reason": all_position_filter.get("reason") or "all_positions_not_selected", "state": all_position_filter})
        if unread_filter.get("found") and all_position_filter.get("selected"):
            excluded: list[str] = []
            no_target = 0
            while len(results) < target_limit and no_target < 12:
                self.check_pause()
                target = self.measure_current_timing_stage(
                    "job51_find_next_thread",
                    "51job 查找下一个未读联系人",
                    lambda: self.job51_find_next_thread(terminal, exclude_labels=excluded, allowed_positions=()),
                )
                if not target:
                    scrolled = self.measure_current_timing_stage(
                        "job51_scroll_conversation_list",
                        "51job 滚动联系人列表",
                        lambda: self.job51_scroll_conversation_list(terminal),
                    )
                    no_target += 1
                    if scrolled.get("scrolled"):
                        continue
                    break
                label = str(target.get("label") or "")
                label_key = compact_conversation_label(label)
                if label_key:
                    excluded.append(label_key)
                target_candidate_name = recruiter_candidate_name_from_label(label)
                if target_candidate_name:
                    excluded.append(target_candidate_name)
                locator = target.get("locator")
                if locator is None:
                    results.append({"index": len(results) + 1, "label": safe_text(label, 140), "action": "blocked", "message": "no locator"})
                    continue
                opened_position = clean_applied_position(str(target.get("job") or "")) or clean_applied_position(target_position) or ""
                try:
                    if terminal.humanize:
                        self.measure_current_timing_stage("job51_open_candidate_pre_pause", "51job 打开候选人前停顿", lambda: terminal.pause_like_person("pre_action"))
                        highlight_target(locator)
                    self.measure_current_timing_stage("job51_open_candidate_click", "51job 点击候选人", lambda: locator.click(timeout=8000, force=True))
                    if terminal.humanize:
                        self.measure_current_timing_stage("job51_open_candidate_post_pause", "51job 打开候选人后停顿", lambda: terminal.pause_like_person("post_action"))
                    terminal.current_page().wait_for_timeout(random.randint(900, 1450))
                    ready = self.measure_current_timing_stage("job51_wait_chat_ready", "51job 等待聊天输入框", lambda: self.job51_wait_chat_ready(terminal, timeout_ms=4500))
                    if not ready:
                        try:
                            locator.click(timeout=5000, force=True)
                            terminal.current_page().wait_for_timeout(random.randint(1200, 1800))
                            ready = self.measure_current_timing_stage("job51_wait_chat_ready_retry", "51job 重试等待聊天输入框", lambda: self.job51_wait_chat_ready(terminal, timeout_ms=4500))
                        except Exception:
                            ready = False
                    if not ready:
                        results.append({
                            "index": len(results) + 1,
                            "label": safe_text(label, 140),
                            "appliedPosition": safe_text(opened_position, 80),
                            "action": "blocked",
                            "message": "51job 打开候选人后没有出现聊天输入框，已跳过避免误填",
                        })
                        continue
                    maybe_human_reading_pause(terminal, reason="job51_candidate_open", text_hint=label)
                except Exception as error:
                    results.append({
                        "index": len(results) + 1,
                        "label": safe_text(label, 140),
                        "appliedPosition": safe_text(opened_position, 80),
                        "action": "blocked",
                        "message": f"51job 打开候选人失败：{safe_text(str(error), 120)}",
                    })
                    continue
                try:
                    context_before = self.measure_current_timing_stage("job51_read_chat_context", "51job 读取聊天上下文", lambda: self.job51_read_chat_context(terminal, opened=target))
                    result = self.job51_process_current_position(terminal, opened=target)
                except Exception as error:
                    action = "blocked"
                    counts[action] = counts.get(action, 0) + 1
                    results.append({
                        "index": len(results) + 1,
                        "label": safe_text(label, 140),
                        "candidateName": safe_text(str(recruiter_candidate_name_from_label(label)), 80),
                        "appliedPosition": safe_text(opened_position, 80),
                        "action": action,
                        "message": f"51job 处理候选人时异常，已跳过：{safe_text(str(error), 180)}",
                    })
                    continue
                action = classify_recruiter_screen_result_action(result)
                counts[action] = counts.get(action, 0) + 1
                screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
                results.append({
                    "index": len(results) + 1,
                    "label": safe_text(str((context_before.get("applicant") or {}).get("label") or label), 140),
                    "candidateName": safe_text(str((context_before.get("applicant") or {}).get("name") or ""), 80),
                    "appliedPosition": safe_text(str(context_before.get("appliedPosition") or opened_position), 80),
                    "conversationKey": safe_text(str(context_before.get("conversationKey") or ""), 120),
                    "messages": [
                        {
                            "sender": safe_text(str(message.get("sender") or ""), 20),
                            "time": safe_text(str(message.get("time") or ""), 40),
                            "status": safe_text(str(message.get("status") or ""), 40),
                            "text": safe_text(str(message.get("text") or ""), 500),
                            "rawText": safe_text(str(message.get("rawText") or message.get("text") or ""), 600),
                        }
                        for message in (context_before.get("messages") if isinstance(context_before.get("messages"), list) else [])[-80:]
                        if isinstance(message, dict) and str(message.get("text") or "").strip()
                    ],
                    "lastOther": safe_text(str((context_before.get("lastOtherMessage") or {}).get("text") or ""), 500),
                    "pageTextPreview": safe_text(str(context_before.get("pageTextPreview") or ""), 900),
                    "action": action,
                    "screeningStatus": safe_text(str(screening.get("status") or ""), 40),
                    "message": safe_text(str(result.get("message") or ""), 260),
                    "identityWarnings": result.get("identityWarnings")
                    if isinstance(result.get("identityWarnings"), list)
                    else (
                        (context_before.get("applicant") or {}).get("identityWarnings", [])
                        if isinstance(context_before.get("applicant"), dict)
                        else []
                    ),
                    "knowledgeAnswer": result.get("knowledgeAnswer") if isinstance(result.get("knowledgeAnswer"), dict) else {},
                    "resume": compact_recruiter_resume_result(result.get("resume") if isinstance(result.get("resume"), dict) else {}),
                })
                maybe_human_batch_pause(terminal, len(results))
        message = f"51job 未读处理完成：处理 {len(results)} 人。"
        if counts:
            message += " 动作统计：" + "；".join(f"{key} {value}" for key, value in sorted(counts.items()))
        if filtered:
            message += f" 跳过/未进入岗位 {len(filtered)} 项。"
        batch_report = append_recruiter_batch_report({
            "type": "job51_process_unread_all_positions",
            "message": safe_text(message, 800),
            "state": {
                "platform": "51job",
                "processedPeople": len(results),
                "targetPosition": clean_applied_position(target_position),
                "counts": counts,
                "filteredOut": len(filtered),
            },
            "results": results,
            "filteredOut": filtered[:120],
        })
        self.add_event("chat", message)
        return {
            "message": message,
            "results": results,
            "counts": counts,
            "filteredOut": filtered[:30],
            "state": {
                "processedPeople": len(results),
                "counts": counts,
                "filteredOut": len(filtered),
            },
            "batchReportId": batch_report.get("runId"),
        }

    def job51_recommend_mode_state(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        state = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const nav = document.querySelector('#sensor_recommand_menu');
          const switchNode = document.querySelector('.ai-mode-switch');
          const bodyText = normalize(document.body.innerText || '');
          const cardCount = document.querySelectorAll('div.item.resume-card,.resume-card').length;
          const jobTabCount = document.querySelectorAll('.eh-position .menu-item, .eh-position div.menu-item, div.menu-item').length;
          const navText = nav ? normalize(nav.innerText || nav.textContent || '') : '';
          const switchClass = switchNode ? String(switchNode.className || '') : '';
          const denseBodyText = bodyText.replace(/\\s+/g, '');
          const denseNavText = navText.replace(/\\s+/g, '');
          const hasTalentText = denseBodyText.includes('\\u4eba\\u624d\\u671b\\u8fdc\\u955c');
          const hasAiGoldText = denseBodyText.includes('AI\\u6dd8\\u91d1');
          const switchActive = switchClass.includes('ai-mode-switch-active');
          const traditional = cardCount > 0 && jobTabCount > 0 && !switchActive;
          return {
            traditional,
            aiGold: switchActive || denseNavText.includes('AI\\u6dd8\\u91d1') || (hasAiGoldText && cardCount === 0),
            cardCount,
            jobTabCount,
            navText,
            switchClass,
            hasTalentText,
            hasAiGoldText,
            url: location.href,
            title: document.title
          };
        }""")
        return state if isinstance(state, dict) else {}

    def job51_click_recommend_mode_switch(self, terminal: BrowserTerminal, switch) -> dict:
        page = terminal.current_page()
        try:
            switch.scroll_into_view_if_needed(timeout=3500)
        except Exception:
            pass
        try:
            box = switch.bounding_box(timeout=3500)
        except Exception:
            box = None

        click_point = None
        if box:
            x = float(box.get("x") or 0) + float(box.get("width") or 1) * random.uniform(0.46, 0.54)
            y = float(box.get("y") or 0) + float(box.get("height") or 1) * random.uniform(0.44, 0.56)
            click_point = {
                "x": round(x, 1),
                "y": round(y, 1),
                "width": round(float(box.get("width") or 0), 1),
                "height": round(float(box.get("height") or 0), 1),
            }
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(switch)
                move_cursor_like_person(
                    terminal,
                    x,
                    y,
                    duration_factor=random.uniform(0.7, 1.05),
                    show_trail=terminal.visual_cursor,
                )
                if terminal.visual_cursor:
                    move_visual_cursor(page, x, y, click=False)
                page.wait_for_timeout(random.randint(220, 520))
            else:
                try:
                    page.mouse.move(x, y, steps=random.randint(8, 18))
                except Exception:
                    pass
            try:
                page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(x), "y": float(y)})
            except Exception:
                pass

        try:
            switch.click(timeout=9000, force=True)
            method = "outer_locator_click_after_visible_move"
        except Exception as click_error:
            if not box:
                return {
                    "ok": False,
                    "method": "outer_locator_click_after_visible_move",
                    "reason": safe_text(str(click_error), 180),
                }
            try:
                humanized_point_click(terminal, x, y, target_box=box)
                method = "coordinate_click_fallback"
            except Exception as fallback_error:
                return {
                    "ok": False,
                    "method": "coordinate_click_fallback",
                    "reason": safe_text(f"{click_error}; {fallback_error}", 180),
                    "clickPoint": click_point,
                }

        if terminal.visual_cursor and click_point:
            try:
                move_visual_cursor(page, float(click_point["x"]), float(click_point["y"]), click=True)
            except Exception:
                pass
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        return {"ok": True, "method": method, "clickPoint": click_point}

    def job51_ensure_recommend_traditional_mode(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        before = self.job51_recommend_mode_state(terminal)
        if before.get("traditional"):
            return {"ok": True, "mode": "traditional", "switched": False, "before": before, "after": before}
        if not before.get("aiGold"):
            return {
                "ok": False,
                "mode": "unknown",
                "switched": False,
                "reason": "recommend_mode_unknown",
                "before": before,
            }
        switch = page.locator(".ai-mode-switch").first
        if not switch.count():
            switch = page.locator(".ai-mode-switch-content, .ai-mode-switch-inner").first
        try:
            if not switch.count():
                return {
                    "ok": False,
                    "mode": "ai_gold",
                    "switched": False,
                    "reason": "traditional_mode_switch_not_found",
                    "before": before,
                }
            click_result = self.job51_click_recommend_mode_switch(terminal, switch)
            if not click_result.get("ok"):
                return {
                    "ok": False,
                    "mode": "ai_gold",
                    "switched": False,
                    "reason": click_result.get("reason") or "traditional_mode_switch_click_failed",
                    "before": before,
                    "click": click_result,
                }
            browser_real_wait(page, random.randint(2200, 3600))
            try:
                page.wait_for_function(
                    """() => {
                      const nav = document.querySelector('#sensor_recommand_menu');
                      const navText = nav ? String(nav.innerText || nav.textContent || '').replace(/\\s+/g, ' ').trim() : '';
                      const denseNavText = navText.replace(/\\s+/g, '');
                      const switchNode = document.querySelector('.ai-mode-switch');
                      const switchClass = switchNode ? String(switchNode.className || '') : '';
                      const cardCount = document.querySelectorAll('div.item.resume-card,.resume-card').length;
                      const jobTabCount = document.querySelectorAll('.eh-position .menu-item, .eh-position div.menu-item, div.menu-item').length;
                      return cardCount > 0 && jobTabCount > 0 && !switchClass.includes('ai-mode-switch-active')
                        && !denseNavText.includes('AI\\u6dd8\\u91d1');
                    }""",
                    timeout=12000,
                )
            except Exception:
                pass
            after = self.job51_recommend_mode_state(terminal)
            return {
                "ok": bool(after.get("traditional")),
                "mode": "traditional" if after.get("traditional") else "ai_gold",
                "switched": True,
                "reason": "" if after.get("traditional") else "traditional_mode_switch_failed",
                "before": before,
                "after": after,
                "click": click_result,
            }
        except Exception as error:
            return {
                "ok": False,
                "mode": "ai_gold",
                "switched": False,
                "reason": safe_text(str(error), 180),
                "before": before,
            }

    def job51_open_recommend_page(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        self.job51_dismiss_interruptions(terminal, reason="before_open_recommend")
        for candidate_page in terminal.all_pages():
            try:
                candidate_url = str(getattr(candidate_page, "url", "") or "")
                if "ehire.51job.com" in candidate_url and "/Revision/talent/search-recommend" in candidate_url:
                    terminal.page = candidate_page
                    page = candidate_page
                    try:
                        page.bring_to_front()
                    except Exception:
                        pass
                    break
            except Exception:
                continue
        if "ehire.51job.com" in str(page.url) and "/Revision/talent/resume/detail" in str(page.url):
            try:
                page.go_back(wait_until="domcontentloaded", timeout=10000)
                page.wait_for_timeout(random.randint(1500, 2300))
                self.job51_dismiss_interruptions(terminal, reason="after_back_from_recommend_detail")
            except Exception:
                pass
        if "ehire.51job.com" in str(page.url) and "/Revision/talent/search-recommend" in str(page.url):
            try:
                page.wait_for_selector(".eh-position .menu-item, div.item.resume-card, .resume-card", timeout=9000)
            except Exception:
                pass
            mode = self.job51_ensure_recommend_traditional_mode(terminal)
            if not mode.get("ok"):
                return {"opened": False, "url": page.url, "title": page.title(), "source": "current", "mode": mode, "reason": mode.get("reason") or "traditional_mode_required"}
            return {"opened": True, "url": page.url, "title": page.title(), "source": "current", "mode": mode}
        nav = page.locator("#sensor_recommand_menu").first
        try:
            if nav.count():
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(nav)
                humanized_locator_click(terminal, nav, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(1300, 2100))
                try:
                    page.wait_for_selector(".eh-position .menu-item, div.item.resume-card, .resume-card", timeout=9000)
                except Exception:
                    pass
                self.job51_dismiss_interruptions(terminal, reason="after_open_recommend")
                mode = self.job51_ensure_recommend_traditional_mode(terminal)
                if not mode.get("ok"):
                    return {"opened": False, "url": page.url, "title": page.title(), "source": "left_nav", "mode": mode, "reason": mode.get("reason") or "traditional_mode_required"}
                return {"opened": True, "url": page.url, "title": page.title(), "source": "left_nav", "mode": mode}
        except Exception as error:
            return {
                "opened": False,
                "url": page.url,
                "title": page.title(),
                "source": "left_nav",
                "reason": safe_text(str(error), 180),
            }
        return {
            "opened": False,
            "url": page.url,
            "title": page.title(),
            "source": "left_nav_required",
            "reason": "talent_telescope_nav_not_found",
            "message": "51job 主动联系只能点击“人才望远镜”入口进入，未找到入口时不直接跳转推荐页。",
        }

    def job51_select_recommend_position(self, terminal: BrowserTerminal, target_position: str) -> dict:
        target_position = clean_applied_position(target_position)
        if not target_position:
            return {"selected": False, "reason": "empty_target"}
        page = terminal.current_page()
        self.job51_dismiss_interruptions(terminal, reason="before_select_recommend_position")
        try:
            page.wait_for_selector(".eh-position .menu-item, div.menu-item", timeout=9000)
        except Exception:
            pass
        items = page.locator(".eh-position .menu-item, .eh-position div.menu-item, div.menu-item")
        visible_labels: list[str] = []
        try:
            count = items.count()
        except Exception:
            count = 0
        for index in range(count):
            item = items.nth(index)
            try:
                label = safe_text(item.inner_text(timeout=1000), 140)
            except Exception:
                continue
            if not label or label == "添加关注职位":
                continue
            visible_labels.append(label)
            normalized = clean_applied_position(label.replace("已结束", ""))
            if proactive_position_label_matches(normalized, target_position):
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(item)
                humanized_locator_click(terminal, item, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(1100, 1700))
                try:
                    page.wait_for_selector("div.item.resume-card, .resume-card", timeout=9000)
                except Exception:
                    pass
                self.job51_dismiss_interruptions(terminal, reason="after_select_recommend_position")
                return {"selected": True, "position": target_position, "label": label, "index": index}
        return {
            "selected": False,
            "position": target_position,
            "reason": "recommend_position_tab_not_found",
            "visibleOptions": visible_labels[:20],
        }

    def job51_collect_recommend_candidate_cards(self, terminal: BrowserTerminal) -> list[dict]:
        page = terminal.current_page()
        try:
            page.wait_for_selector("div.item.resume-card, .resume-card", timeout=5000)
        except Exception:
            pass
        items = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 80 && box.height > 80
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && box.bottom >= 80
              && box.top <= window.innerHeight - 20;
          };
          const smallVisible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && box.bottom >= 70
              && box.top <= window.innerHeight - 10;
          };
          const rect = el => {
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
          };
          const nodes = Array.from(new Set(Array.from(document.querySelectorAll('div.item.resume-card,.resume-card')).map(el => el.closest('div.item.resume-card') || el)));
          return nodes.map((card, domIndex) => {
            const cardBox = rect(card);
            const buttons = Array.from(card.querySelectorAll('button,[role="button"]')).filter(visible).map(btn => ({
              text: normalize(btn.innerText || btn.textContent || ''),
              className: String(btn.className || ''),
              rect: rect(btn)
            }));
            const text = normalize(card.innerText || card.textContent || '');
            const hasGreetButton = buttons.some(btn => /立即Hi聊|打招呼|沟通/.test(btn.text)) || /立即Hi聊|打招呼/.test(text);
            const alreadyContacted = /(已沟通|已联系|已打招呼|继续沟通|沟通过|不合适)/.test(text) && !hasGreetButton;
            const viewedBadges = Array.from(card.querySelectorAll('*'))
              .filter(el => {
                const className = String(el.className || '');
                const label = normalize(el.innerText || el.textContent || '');
                const badgeBox = rect(el);
                const inTopLeft = badgeBox.x >= cardBox.x - 8
                  && badgeBox.y >= cardBox.y - 8
                  && badgeBox.x <= cardBox.x + Math.max(130, cardBox.width * 0.20)
                  && badgeBox.y <= cardBox.y + Math.max(70, cardBox.height * 0.32);
                const textBadge = smallVisible(el) && label === '已看' && inTopLeft;
                const classBadge = smallVisible(el) && /(^|\\s)hasRead(\\s|$)/i.test(className) && inTopLeft;
                const readCardClass = /(^|\\s)isread(\\s|$)/i.test(className)
                  && badgeBox.x >= cardBox.x - 4
                  && badgeBox.y >= cardBox.y - 4
                  && badgeBox.x <= cardBox.x + 8
                  && badgeBox.y <= cardBox.y + 8;
                return textBadge || classBadge || readCardClass;
              })
              .map(el => ({ text: normalize(el.innerText || el.textContent || '') || '已看', className: String(el.className || ''), rect: rect(el) }));
            const alreadyViewed = viewedBadges.length > 0 || /^已看(\\s|$)/.test(text) || text.replace(/\\s+/g, '').startsWith('已看求职意向');
            return {
              domIndex,
              visible: visible(card),
              text,
              className: String(card.className || ''),
              hasGreetButton,
              alreadyContacted,
              alreadyViewed,
              viewedBadges,
              buttons,
              rect: cardBox
            };
          }).filter(item => item.visible && item.text && !item.text.includes('添加关注职位'));
        }""")
        return items if isinstance(items, list) else []

    def job51_extract_recommend_candidate_name(self, text: str) -> str:
        normalized = re.sub(r"\s+", " ", str(text or "")).strip()
        if not normalized:
            return ""
        patterns = [
            r"(?:急切求职|回复快|偏好接电话|近期有企业电话沟通过)?\s*([\u4e00-\u9fa5A-Za-z]{1,8}(?:先生|女士|小姐|同学))\s*(?:\d+小时内活跃|1小时前活跃|刚刚活跃|1个月内活跃|电话沟通|\d{2}岁)",
            r"(?:月|K|k|万/月)\s+([\u4e00-\u9fa5A-Za-z]{1,8}(?:先生|女士|小姐|同学))\s",
            r"\s([\u4e00-\u9fa5A-Za-z]{1,8}(?:先生|女士|小姐|同学))\s",
        ]
        for pattern in patterns:
            match = re.search(pattern, normalized)
            if match:
                return safe_text(match.group(1), 24)
        return extract_recommend_candidate_name(normalized)

    def job51_evaluate_proactive_candidate(self, evidence_text: str, target_position: str) -> dict:
        education = recommend_candidate_education_check(evidence_text, target_position)
        if not education.get("allowed"):
            return {"allowed": False, "reason": education.get("reason") or "education_not_qualified", "education": education}
        age = recommend_candidate_age_check(evidence_text, target_position)
        if not age.get("allowed"):
            return {"allowed": False, "reason": age.get("reason") or "age_not_qualified", "education": education, "age": age}
        keyword: dict = {}
        major: dict = {}
        target_clean = clean_applied_position(target_position)
        target_compact = re.sub(r"\s+", "", str(target_clean or "")).lower()
        if "ai" in target_compact and "应用开发" in target_compact and "实习" in target_compact:
            return {
                "allowed": False,
                "reason": "ai_intern_proactive_contact_disabled",
                "education": education,
                "age": age,
                "required": "AI应用开发实习生不做主动联系；候选人主动发消息后再走基础条件筛选和求简历流程",
            }
        elif "膨润土销售" in target_clean:
            keyword = recommend_candidate_bentonite_sales_keyword_check(evidence_text, "膨润土销售人员")
            if not keyword.get("allowed"):
                return {"allowed": False, "reason": keyword.get("reason") or "missing_required_keyword", "education": education, "age": age, "keyword": keyword}
        elif "应用技术" in target_clean or "工业涂料" in target_clean:
            match = recommend_candidate_matches_application_technology(evidence_text)
            keyword = {
                "allowed": bool(match.get("matched")),
                "reason": match.get("reason") or ("matched_application_technology" if match.get("matched") else "missing_application_technology_evidence"),
                "required": "流变助剂/膨润土/工业涂料/涂料研发/涂料工程师任意一个",
                "evidence": match.get("evidence", []),
                "score": match.get("score"),
            }
            if not keyword.get("allowed"):
                return {"allowed": False, "reason": keyword.get("reason") or "missing_application_technology_evidence", "education": education, "age": age, "keyword": keyword}
        elif "国际业务" in target_clean:
            major = recommend_candidate_international_business_major_check(evidence_text, "国际业务管培生")
            if not major.get("allowed"):
                return {"allowed": False, "reason": major.get("reason") or "missing_international_business_major", "education": education, "age": age, "major": major}
        elif recommend_target_is_hr_screening_position(target_clean):
            major = recommend_candidate_hrbp_major_check(evidence_text, target_clean)
            if not major.get("allowed"):
                return {"allowed": False, "reason": major.get("reason") or "missing_hrbp_related_major", "education": education, "age": age, "major": major}
        elif "电气工程师" in target_clean or "电气自动化" in target_clean:
            electrical = recommend_candidate_electrical_engineer_check(evidence_text, "电气工程师")
            if not electrical.get("allowed"):
                return {"allowed": False, "reason": electrical.get("reason") or "missing_electrical_requirements", "education": education, "age": age, "electrical": electrical}
            keyword = electrical
        elif "石油" in target_clean or "钻井泥浆" in target_clean:
            compact = re.sub(r"\s+", "", str(evidence_text or ""))
            terms = ["石油", "钻井", "泥浆", "膨润土", "油服"]
            evidence = [term for term in terms if term in compact]
            keyword = {
                "allowed": bool(evidence),
                "reason": "matched_oil_sales_keyword" if evidence else "missing_oil_sales_keyword",
                "required": "石油/钻井/泥浆/膨润土/油服任意一个",
                "evidence": evidence,
            }
            if not keyword.get("allowed"):
                return {"allowed": False, "reason": keyword.get("reason") or "missing_required_keyword", "education": education, "age": age, "keyword": keyword}
        elif "外贸" in target_clean:
            compact = re.sub(r"\s+", "", str(evidence_text or ""))
            terms = ["外贸", "国际贸易", "国贸", "英语", "商务英语", "出口", "海外", "流变助剂", "化工"]
            evidence = [term for term in terms if term in compact]
            major = {
                "allowed": bool(evidence),
                "reason": "matched_foreign_sales_evidence" if evidence else "missing_foreign_sales_evidence",
                "required": "外贸/国际贸易/英语/出口/海外/化工任意相关证据",
                "evidence": evidence[:6],
            }
            if not major.get("allowed"):
                return {"allowed": False, "reason": major.get("reason") or "missing_foreign_sales_evidence", "education": education, "age": age, "major": major}
        elif "销售管培生" in target_clean:
            pass
        else:
            return {
                "allowed": False,
                "reason": "job51_proactive_rules_not_configured",
                "education": education,
                "age": age,
                "required": "该岗位尚未配置 51job 主动联系门槛",
            }
        return {
            "allowed": True,
            "reason": "matched_job51_proactive_rules",
            "education": education,
            "age": age,
            "keyword": keyword,
            "major": major,
        }

    def job51_recommend_common_gate(
        self,
        candidate_name: str,
        target_position: str,
        card_text: str,
        detail_text: str,
        detail_url: str = "",
    ) -> dict:
        if not detail_url or "/Revision/talent/resume/detail" not in str(detail_url):
            return {
                "allowed": False,
                "reason": "job51_resume_detail_not_confirmed",
                "detailUrl": safe_text(str(detail_url or ""), 220),
            }
        origin = self.find_proactive_contact_origin(
            candidate_name=candidate_name,
            applied_position=target_position,
            candidate_label=card_text,
        )
        if origin.get("matched"):
            return {
                "allowed": False,
                "reason": "identity_duplicate",
                "origin": origin,
            }
        combined = f"{card_text}\n{detail_text}"
        compact = re.sub(r"\s+", "", str(combined or ""))
        if re.search(r"(沟通日期|沟通职位|已沟通|已联系|继续沟通|沟通过|已打招呼)", compact):
            return {
                "allowed": False,
                "reason": "job51_already_has_communication_record",
                "evidence": safe_text(str(detail_text or card_text or ""), 220),
            }
        return {
            "allowed": True,
            "reason": "job51_common_gate_passed",
        }

    def job51_scroll_recommend_cards(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        before = safe_eval(page, """() => {
          const root = document.querySelector('.main_container.eh-talent-search') || document.scrollingElement || document.documentElement;
          return Math.round(root.scrollTop || window.scrollY || 0);
        }""")
        amount = random.randint(420, 620)
        try:
            humanized_scroll(terminal, amount, corrective=False)
        except Exception:
            try:
                page.mouse.wheel(0, amount)
            except Exception:
                pass
        page.wait_for_timeout(random.randint(900, 1500))
        result = safe_eval(page, """() => {
          const root = document.querySelector('.main_container.eh-talent-search') || document.scrollingElement || document.documentElement;
          const after = Math.round(root.scrollTop || window.scrollY || 0);
          return { after };
        }""")
        self.job51_dismiss_interruptions(terminal, reason="after_recommend_scroll")
        after = result.get("after") if isinstance(result, dict) else before
        return {
            "scrolled": abs(int(after or 0) - int(before or 0)) > 2,
            "before": int(before or 0),
            "after": int(after or 0),
            "amount": amount,
        }

    def job51_probe_recommend_candidate_detail(self, terminal: BrowserTerminal, dom_index: int) -> dict:
        list_page = terminal.current_page()
        before_pages = list(terminal.all_pages())
        before_ids = {id(page) for page in before_pages}
        list_url = str(getattr(list_page, "url", "") or "")
        try:
            card = list_page.locator("div.item.resume-card,.resume-card").nth(int(dom_index or 0))
            card_text = safe_text(card.inner_text(timeout=3000), 2400)
            box = card.bounding_box(timeout=3000)
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(card)
            if box:
                click_x = min(max(112, box.get("width", 0) * 0.09), max(30, box.get("width", 0) - 260))
                click_y = min(max(60, box.get("height", 0) * 0.34), max(24, box.get("height", 0) - 48))
                humanized_point_click(
                    terminal,
                    float(box.get("x", 0) + click_x),
                    float(box.get("y", 0) + click_y),
                    target_box=box,
                )
            else:
                humanized_locator_click(terminal, card, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            browser_real_wait(list_page, random.randint(2300, 3400))
            after_pages = list(terminal.all_pages())
            new_pages = [page for page in after_pages if id(page) not in before_ids]
            detail_page = new_pages[-1] if new_pages else terminal.current_page()
            opened_new_page = bool(new_pages)
            if not opened_new_page and "/Revision/talent/resume/detail" not in str(getattr(detail_page, "url", "") or ""):
                try:
                    retry_card = list_page.locator("div.item.resume-card,.resume-card").nth(int(dom_index or 0))
                    retry_box = retry_card.bounding_box(timeout=2500)
                    if retry_box:
                        retry_x = float(retry_box.get("x", 0) + min(max(135, retry_box.get("width", 0) * 0.12), max(30, retry_box.get("width", 0) - 280)))
                        retry_y = float(retry_box.get("y", 0) + min(max(58, retry_box.get("height", 0) * 0.30), max(24, retry_box.get("height", 0) - 55)))
                        humanized_point_click(terminal, retry_x, retry_y, target_box=retry_box)
                    else:
                        humanized_locator_click(terminal, retry_card, force=True)
                    browser_real_wait(list_page, random.randint(2600, 3900))
                    after_pages = list(terminal.all_pages())
                    new_pages = [page for page in after_pages if id(page) not in before_ids]
                    detail_page = new_pages[-1] if new_pages else terminal.current_page()
                    opened_new_page = bool(new_pages)
                except Exception:
                    pass
            if not opened_new_page and "/Revision/talent/resume/detail" not in str(getattr(detail_page, "url", "") or ""):
                return {
                    "opened": False,
                    "openedNewPage": False,
                    "restored": True,
                    "reason": "detail_page_not_opened_after_card_click",
                    "listUrl": list_url,
                    "cardText": card_text,
                }
            if detail_page is not list_page:
                terminal.page = detail_page
                try:
                    detail_page.bring_to_front()
                except Exception:
                    pass
            try:
                detail_page.wait_for_load_state("domcontentloaded", timeout=8000)
            except Exception:
                pass
            browser_real_wait(detail_page, random.randint(1700, 2900))
            try:
                detail_text_hint = safe_text(detail_page.locator("body").inner_text(timeout=2500), 2200)
            except Exception:
                detail_text_hint = ""
            maybe_human_reading_pause(terminal, reason="candidate_open", text_hint=detail_text_hint)
            browse_actions: list[dict] = []
            try:
                before_scroll = safe_eval(detail_page, """() => Math.round((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0)""")
                humanized_scroll(terminal, random.randint(260, 460), corrective=False)
                browser_real_wait(detail_page, random.randint(900, 1600))
                after_scroll = safe_eval(detail_page, """() => Math.round((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0)""")
                browse_actions.append({"action": "read_scroll_down", "before": before_scroll, "after": after_scroll})
                if random.random() < 0.75:
                    humanized_scroll(terminal, -random.randint(120, 260), corrective=False)
                    browser_real_wait(detail_page, random.randint(650, 1100))
                    final_scroll = safe_eval(detail_page, """() => Math.round((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0)""")
                    browse_actions.append({"action": "read_scroll_adjust", "after": final_scroll})
            except Exception as error:
                browse_actions.append({"action": "read_scroll_failed", "reason": safe_text(str(error), 120)})
            maybe_human_reading_pause(terminal, reason="before_decision", text_hint=detail_text_hint)
            detail_state = safe_eval(detail_page, """() => {
              const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const buttons = Array.from(document.querySelectorAll('button,[role="button"],a')).map((el, index) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const visible = box.width > 2 && box.height > 2
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0';
                return {
                  index,
                  text: normalize(el.innerText || el.textContent || el.getAttribute('title') || ''),
                  visible,
                  rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }
                };
              }).filter(item => item.visible && item.text).slice(0, 60);
              return {
                title: document.title,
                url: location.href,
                text: normalize(document.body.innerText || '').slice(0, 20000),
                buttons
              };
            }""")
            if not isinstance(detail_state, dict):
                detail_state = {}
            restored = False
            restore_reason = ""
            if opened_new_page:
                try:
                    detail_page.close()
                except Exception as error:
                    restore_reason = safe_text(str(error), 160)
                try:
                    list_page.bring_to_front()
                    terminal.page = list_page
                    restored = True
                except Exception as error:
                    restore_reason = safe_text(str(error), 160)
            else:
                try:
                    if "/Revision/talent/search-recommend" not in str(getattr(detail_page, "url", "") or ""):
                        detail_page.go_back(wait_until="domcontentloaded", timeout=10000)
                        detail_page.wait_for_timeout(random.randint(1500, 2300))
                    terminal.page = detail_page
                    restored = "/Revision/talent/search-recommend" in str(getattr(detail_page, "url", "") or "")
                except Exception as error:
                    restore_reason = safe_text(str(error), 160)
            try:
                terminal.current_page().wait_for_selector("div.item.resume-card,.resume-card", timeout=6000)
            except Exception:
                pass
            self.job51_dismiss_interruptions(terminal, reason="after_recommend_detail_probe")
            return {
                "opened": True,
                "openedNewPage": opened_new_page,
                "restored": restored,
                "restoreReason": restore_reason,
                "listUrl": list_url,
                "detailUrl": detail_state.get("url") or "",
                "detailTitle": detail_state.get("title") or "",
                "cardText": card_text,
                "detailText": str(detail_state.get("text") or ""),
                "browseActions": browse_actions,
                "buttons": detail_state.get("buttons") or [],
            }
        except Exception as error:
            try:
                terminal.page = list_page
                list_page.bring_to_front()
            except Exception:
                pass
            return {
                "opened": False,
                "restored": str(getattr(terminal.current_page(), "url", "") or "") == list_url,
                "reason": safe_text(str(error), 180),
                "listUrl": list_url,
            }

    @timed_agent_stage("job51_proactive_contact", "51job 主动联系推荐候选人")
    def job51_proactive_contact_recommended_candidates(
        self,
        terminal: BrowserTerminal,
        target_position: str = "",
        max_total: int = 10,
        dry_run: bool = False,
    ) -> dict:
        if not self.proactive_task_lock.acquire(blocking=False):
            return {"blocked": True, "message": "已有主动联系任务正在执行，请稍后再试。", "results": [], "skipped": []}
        try:
            self.check_pause()
            target_position = clean_applied_position(target_position or JOB51_CONFIGURED_POSITIONS[0])
            target_count = max(1, min(30, int(max_total or 10)))
            entry = self.job51_open_recommend_page(terminal)
            if not entry.get("opened"):
                return {
                    "blocked": True,
                    "message": entry.get("message") or "51job 主动联系未开始：未能通过“人才望远镜”入口进入推荐候选人页面。",
                    "entry": entry,
                    "results": [],
                    "skipped": [],
                }
            selected = self.job51_select_recommend_position(terminal, target_position)
            if not selected.get("selected"):
                return {
                    "blocked": True,
                    "message": f"51job 推荐页没有找到目标岗位：{safe_text(target_position, 80)}",
                    "entry": entry,
                    "selection": selected,
                    "results": [],
                    "skipped": [],
                }
            results: list[dict] = []
            skipped: list[dict] = []
            seen_keys: set[str] = set()
            opened_candidate_keys: set[str] = set()
            scroll_round = 0
            no_new_rounds = 0
            while len(results) < target_count and scroll_round <= 10 and no_new_rounds < 3:
                self.check_pause()
                self.job51_dismiss_interruptions(terminal, reason="before_collect_recommend_cards")
                cards = self.job51_collect_recommend_candidate_cards(terminal)
                handled_this_round = 0
                for card in cards:
                    if len(results) >= target_count:
                        break
                    text = str(card.get("text") or "")
                    candidate_name = self.job51_extract_recommend_candidate_name(text)
                    candidate_key = stable_digest(f"51job|{target_position}|{text[:700]}", 20)
                    if not candidate_key or candidate_key in seen_keys:
                        continue
                    seen_keys.add(candidate_key)
                    state_key = f"job51_proactive|{target_position}|{candidate_key}"
                    old_state = self.get_chat_state(state_key)
                    if str(old_state.get("status") or "") == "proactive_greeted":
                        skipped.append({"candidateName": candidate_name, "action": "already_greeted_skipped", "reason": "state_duplicate"})
                        continue
                    if card.get("alreadyViewed"):
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "already_viewed_skipped",
                            "reason": "job51_candidate_already_viewed",
                            "viewedBadges": card.get("viewedBadges") or [],
                            "preview": safe_text(text, 180),
                        })
                        continue
                    if card.get("alreadyContacted") or not card.get("hasGreetButton"):
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "already_contacted_or_no_button_skipped",
                            "reason": "already_contacted_or_no_greet_button",
                            "preview": safe_text(text, 180),
                        })
                        continue
                    detail = self.job51_probe_recommend_candidate_detail(terminal, int(card.get("domIndex") or 0))
                    if not detail.get("opened") or not detail.get("restored"):
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "detail_probe_failed_skipped",
                            "reason": detail.get("reason") or detail.get("restoreReason") or "detail_probe_failed",
                            "detail": {
                                "opened": detail.get("opened"),
                                "restored": detail.get("restored"),
                                "detailUrl": detail.get("detailUrl"),
                            },
                            "preview": safe_text(text, 180),
                        })
                        continue
                    opened_candidate_keys.add(candidate_key)
                    evidence_text = str(detail.get("detailText") or "") or text
                    detail_name = self.job51_extract_recommend_candidate_name(evidence_text)
                    if detail_name:
                        candidate_name = detail_name
                    detail_candidate_key = stable_digest(
                        f"51job|{target_position}|{detail.get('detailUrl') or evidence_text[:1200]}",
                        20,
                    )
                    if detail_candidate_key and detail_candidate_key != candidate_key:
                        opened_candidate_keys.discard(candidate_key)
                        opened_candidate_keys.add(detail_candidate_key)
                        if detail_candidate_key in seen_keys:
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "already_greeted_skipped",
                                "reason": "detail_identity_duplicate_in_run",
                                "detailUrl": detail.get("detailUrl"),
                            })
                            continue
                        seen_keys.add(detail_candidate_key)
                        detail_state_key = f"job51_proactive|{target_position}|{detail_candidate_key}"
                        detail_old_state = self.get_chat_state(detail_state_key)
                        if str(detail_old_state.get("status") or "") == "proactive_greeted":
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "already_greeted_skipped",
                                "reason": "detail_state_duplicate",
                                "detailUrl": detail.get("detailUrl"),
                            })
                            continue
                        candidate_key = detail_candidate_key
                        state_key = detail_state_key
                    common_gate = self.job51_recommend_common_gate(
                        candidate_name=candidate_name,
                        target_position=target_position,
                        card_text=text,
                        detail_text=evidence_text,
                        detail_url=str(detail.get("detailUrl") or ""),
                    )
                    if not common_gate.get("allowed"):
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "common_gate_not_passed_skipped",
                            "reason": common_gate.get("reason") or "common_gate_not_passed",
                            "commonGate": common_gate,
                            "detailUrl": detail.get("detailUrl"),
                            "preview": safe_text(text, 180),
                            "detailPreview": safe_text(evidence_text, 220),
                            "browseActions": detail.get("browseActions") or [],
                        })
                        continue
                    screening = self.job51_evaluate_proactive_candidate(evidence_text, target_position)
                    if not screening.get("allowed"):
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "screening_not_qualified_skipped",
                            "reason": screening.get("reason") or "not_qualified",
                            "screening": screening,
                            "detailUrl": detail.get("detailUrl"),
                            "preview": safe_text(text, 180),
                            "detailPreview": safe_text(evidence_text, 220),
                            "browseActions": detail.get("browseActions") or [],
                        })
                        continue
                    if dry_run:
                        results.append({
                            "candidateName": candidate_name,
                            "action": "dry_run_would_greet",
                            "commonGate": common_gate,
                            "screening": screening,
                            "detailUrl": detail.get("detailUrl"),
                            "preview": safe_text(text, 220),
                            "detailPreview": safe_text(evidence_text, 260),
                            "browseActions": detail.get("browseActions") or [],
                        })
                        handled_this_round += 1
                        continue
                    locator = terminal.current_page().locator("div.item.resume-card,.resume-card").nth(int(card.get("domIndex") or 0))
                    greet = locator.locator("button.el-button.tm_button.el-button--primary, button").filter(has_text=re.compile(r"立即Hi聊|打招呼|沟通")).first
                    try:
                        if not greet.count():
                            skipped.append({"candidateName": candidate_name, "action": "greet_button_missing_skipped", "reason": "greet_button_missing"})
                            continue
                        if terminal.humanize:
                            terminal.pause_like_person("pre_action")
                            highlight_target(greet)
                        humanized_precise_button_click(terminal, greet, force=True)
                        if terminal.humanize:
                            terminal.pause_like_person("post_action")
                        terminal.current_page().wait_for_timeout(random.randint(1300, 2200))
                        cleanup = self.job51_dismiss_interruptions(terminal, reason="after_job51_greet")
                        self.set_chat_state(
                            state_key,
                            "proactive_greeted",
                            candidateName=candidate_name,
                            appliedPosition=target_position,
                            candidateLabel=safe_text(text, 220),
                            candidateDetailUrl=detail.get("detailUrl"),
                            proactiveCandidateKey=candidate_key,
                            source="51job_recommend",
                        )
                        results.append({
                            "candidateName": candidate_name,
                            "action": "greeted",
                            "commonGate": common_gate,
                            "screening": screening,
                            "cleanup": cleanup,
                            "detailUrl": detail.get("detailUrl"),
                            "preview": safe_text(text, 220),
                            "detailPreview": safe_text(evidence_text, 260),
                            "browseActions": detail.get("browseActions") or [],
                        })
                        handled_this_round += 1
                        maybe_human_proactive_contact_pause(terminal, len(results))
                    except Exception as error:
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "greet_failed",
                            "reason": safe_text(str(error), 160),
                            "preview": safe_text(text, 180),
                        })
                if len(results) >= target_count:
                    break
                no_new_rounds = no_new_rounds + 1 if handled_this_round == 0 else 0
                scroll_round += 1
                scrolled = self.job51_scroll_recommend_cards(terminal)
                if not scrolled.get("scrolled"):
                    break
            counts = {
                "opened": len(opened_candidate_keys),
                "openedCandidates": len(opened_candidate_keys),
                "greeted": len([item for item in results if item.get("action") == "greeted"]),
                "dryRun": len([item for item in results if item.get("action") == "dry_run_would_greet"]),
                "alreadyViewedSkipped": len([item for item in skipped if item.get("action") == "already_viewed_skipped"]),
                "skipped": len(skipped),
            }
            action_text = "可主动联系" if dry_run else "已主动联系"
            message = f"51job {safe_text(target_position, 50)} 主动联系完成：{action_text} {len(results)} 人，跳过 {len(skipped)} 人。"
            batch_report = append_recruiter_batch_report({
                "type": "job51_proactive_contact_recommended_candidates",
                "message": safe_text(message, 800),
                "state": {
                    "platform": "51job",
                    "targetPosition": target_position,
                    "dryRun": bool(dry_run),
                    "counts": counts,
                },
                "results": results,
                "skipped": skipped[:160],
            })
            self.add_event("chat", message)
            return {
                "message": message,
                "results": results,
                "skipped": skipped[:80],
                "counts": counts,
                "batchReportId": batch_report.get("runId"),
            }
        finally:
            self.proactive_task_lock.release()

    def _run_zhilian_terminal_sync(self, callback):
        terminal_obj = BrowserTerminal(
            ZHILIAN_CDP_URL,
            page_index=0,
            auto_start=False,
            visual_cursor=True,
            humanize=True,
            pace="normal",
        )
        terminal = None
        try:
            terminal = terminal_obj.__enter__()
            terminal.automation_speed_multiplier = self.automation_speed_multiplier
            apply_automation_speed_multiplier(terminal)
            zhilian_pages = []
            for page in terminal.all_pages():
                url = str(getattr(page, "url", "") or "")
                try:
                    title = page.title()
                except Exception:
                    title = ""
                is_zhilian_page = "zhaopin.com" in url or "智联" in title
                is_chat_page = is_zhilian_page and "/app/im" in url
                if is_zhilian_page:
                    zhilian_pages.append((0 if is_chat_page else 1, page))
            if zhilian_pages:
                zhilian_pages.sort(key=lambda item: item[0])
                terminal.page = zhilian_pages[0][1]
            return callback(terminal)
        finally:
            if terminal is not None:
                try:
                    terminal_obj.__exit__(None, None, None)
                except Exception:
                    pass

    def with_zhilian_terminal(self, callback):
        result_box: dict[str, object] = {}

        def worker() -> None:
            try:
                result_box["result"] = self._run_zhilian_terminal_sync(callback)
            except Exception as error:
                result_box["error"] = error

        thread = threading.Thread(target=worker, name="zhilian-playwright-worker")
        thread.start()
        thread.join()
        if "error" in result_box:
            raise result_box["error"]  # type: ignore[misc]
        return result_box.get("result")

    def zhilian_dismiss_interruptions(self, terminal: BrowserTerminal, reason: str = "") -> dict:
        page = terminal.current_page()
        closed: list[dict] = []
        for _ in range(4):
            target = safe_eval(page, """() => {
              const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const visible = el => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 6 && box.height > 6
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0'
                  && box.bottom >= 0 && box.right >= 0
                  && box.top <= window.innerHeight && box.left <= window.innerWidth;
              };
              const rect = el => {
                const box = el.getBoundingClientRect();
                return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
              };
              const candidates = [];
              const add = (el, reason, score) => {
                if (!el || !visible(el)) return;
                const text = normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
                candidates.push({ reason, score, text, className: String(el.className || ''), tag: el.tagName, rect: rect(el) });
                el.setAttribute('data-codex-zhilian-dismiss', '1');
              };
              const roots = Array.from(document.querySelectorAll([
                '.km-modal__wrapper',
                '.km-dialog',
                '.km-popover',
                '[class*="modal" i]',
                '[class*="dialog" i]',
                '[class*="popover" i]',
                '[class*="guide" i]'
              ].join(','))).filter(visible);
              const exactCloseText = /^(关闭|取消|知道了|我知道了|稍后再说|暂不|跳过|×|x)$/i;
              for (const root of roots) {
                const rootText = normalize(root.innerText || root.textContent || '');
                const looksBlocking = /(提示|推荐|开通|权益|剩余|选择职位|引导|确认|已发送)/.test(rootText);
                if (!looksBlocking && !/modal|dialog|popover/i.test(String(root.className || ''))) continue;
                for (const btn of Array.from(root.querySelectorAll('button,a,[role="button"],[class*="close" i],[class*="cancel" i]'))) {
                  const text = normalize(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
                  const cls = String(btn.className || '');
                  if (exactCloseText.test(text) || /close|cancel|icon-close/i.test(cls)) add(btn, `close_blocker:${rootText.slice(0, 40)}`, 120);
                }
              }
              const target = candidates.sort((a, b) => b.score - a.score)[0];
              return target || null;
            }""")
            if not isinstance(target, dict):
                break
            locator = page.locator("[data-codex-zhilian-dismiss='1']").first
            try:
                if locator.count():
                    locator.click(timeout=3000, force=True)
                    page.wait_for_timeout(random.randint(260, 620))
                    closed.append({
                        "reason": safe_text(str(target.get("reason") or reason or "dismissed"), 120),
                        "text": safe_text(str(target.get("text") or ""), 80),
                        "className": safe_text(str(target.get("className") or ""), 80),
                    })
            except Exception as error:
                closed.append({
                    "reason": "dismiss_failed",
                    "text": safe_text(str(target.get("text") or ""), 80),
                    "error": safe_text(str(error), 120),
                })
                break
            finally:
                try:
                    page.locator("[data-codex-zhilian-dismiss]").evaluate_all("els => els.forEach(el => el.removeAttribute('data-codex-zhilian-dismiss'))")
                except Exception:
                    pass
        return {"closed": closed, "count": len(closed), "reason": reason}

    def zhilian_open_chat_page(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        self.zhilian_dismiss_interruptions(terminal, reason="before_open_chat")
        if "zhaopin.com" in str(page.url) and "/app/im" in str(page.url):
            return {"opened": True, "url": page.url, "title": page.title(), "source": "current"}
        page.goto(ZHILIAN_CHAT_URL, wait_until="domcontentloaded", timeout=18000)
        page.wait_for_timeout(random.randint(1300, 2100))
        return {"opened": True, "url": page.url, "title": page.title(), "source": "goto"}

    def zhilian_prepare_unread_filter(self, terminal: BrowserTerminal) -> dict:
