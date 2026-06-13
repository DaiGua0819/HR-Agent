                    )
                    if colleague_progress.get("hasCommunication"):
                        record_proactive_decision(
                            "skipped",
                            colleague_progress.get("reason") or "colleague_already_contacted",
                            colleagueProgress=colleague_progress,
                        )
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "colleague_already_contacted_skipped",
                            "reason": colleague_progress.get("reason") or "colleague_already_contacted",
                            "colleagueProgress": colleague_progress,
                            "resumePreview": safe_text(evidence_text, 180),
                            "actionLogId": action_log.get("actionLogId"),
                        })
                        close_recommend_resume_dialog(terminal, frame)
                        continue
                    if resume_info.get("text") or resume_info.get("summaryText"):
                        candidate_key = stable_digest(f"{target_position}\n{evidence_text[:1200]}", 20)
                        state_key = f"proactive|{target_position}|{candidate_key}"
                        old_state = self.get_chat_state(state_key)
                        if str(old_state.get("status") or "") == "proactive_greeted":
                            record_proactive_decision("skipped", "resume_identity_duplicate", oldStateStatus=old_state.get("status") or "")
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "already_greeted_skipped",
                                "reason": "resume_identity_duplicate",
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue

                    custom_rule_check = evaluate_proactive_contact_custom_rules(evidence_text, target_position, custom_rule_config)
                    add_checkpoint(action_log, "screening", "evaluated", customRule=custom_rule_check)
                    education_check: dict = {}
                    age_check: dict = {}
                    keyword_check: dict = {}
                    major_check: dict = {}
                    international_major_check: dict = {}
                    electrical_check: dict = {}
                    if custom_rule_config.get("enabled"):
                        if not custom_rule_check.get("allowed"):
                            record_proactive_decision(
                                "skipped",
                                custom_rule_check.get("reason") or "custom_rule_not_qualified",
                                customRule=custom_rule_check,
                            )
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "custom_rule_not_qualified_skipped",
                                "reason": custom_rule_check.get("reason") or "custom_rule_not_qualified",
                                "customRule": custom_rule_check,
                                "resumePreview": safe_text(evidence_text, 180),
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue
                    else:
                        education_check = recommend_candidate_education_check(evidence_text, target_position)
                        if not education_check.get("allowed"):
                            record_proactive_decision("skipped", education_check.get("reason") or "education_below_college", education=education_check)
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "education_not_qualified_skipped",
                                "reason": education_check.get("reason") or "education_below_college",
                                "educationLevel": education_check.get("level") or "",
                                "resumePreview": safe_text(evidence_text, 180),
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue
                        age_check = recommend_candidate_age_check(evidence_text, target_position)
                        if not age_check.get("allowed"):
                            record_proactive_decision("skipped", age_check.get("reason") or "age_not_qualified", age=age_check)
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "age_not_qualified_skipped",
                                "reason": age_check.get("reason") or "age_not_qualified",
                                "age": age_check.get("age"),
                                "resumePreview": safe_text(evidence_text, 180),
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue
                        keyword_check = recommend_candidate_bentonite_sales_keyword_check(evidence_text, target_position)
                        keyword_check = apply_llm_semantic_requirement_fallback(
                            keyword_check,
                            text=evidence_text,
                            target_position=target_position,
                            keywords=["涂料", "膨润土", "流变助剂"],
                            keyword_mode="any",
                            profile="bentonite_sales",
                            required="涂料/膨润土/流变助剂任意一个或语义接近的相关经验",
                        )
                        if not keyword_check.get("allowed"):
                            record_proactive_decision("skipped", keyword_check.get("reason") or "missing_required_keyword", keyword=keyword_check)
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "keyword_not_qualified_skipped",
                                "reason": keyword_check.get("reason") or "missing_required_keyword",
                                "required": keyword_check.get("required") or "",
                                "resumePreview": safe_text(evidence_text, 180),
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue
                        major_check = recommend_candidate_hrbp_major_check(evidence_text, target_position)
                        major_check = apply_llm_semantic_requirement_fallback(
                            major_check,
                            text=evidence_text,
                            target_position=target_position,
                            keywords=["人力资源专业", "人力资源相关专业", "理工科专业", "工科专业", "理科专业"],
                            keyword_mode="any",
                            profile="hrbp",
                            required="人力资源专业、人力资源相关专业或理工科专业",
                        )
                        if not major_check.get("allowed"):
                            record_proactive_decision("skipped", major_check.get("reason") or "missing_required_major", major=major_check)
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "major_not_qualified_skipped",
                                "reason": major_check.get("reason") or "missing_required_major",
                                "required": major_check.get("required") or "",
                                "resumePreview": safe_text(evidence_text, 180),
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue
                        international_major_check = recommend_candidate_international_business_major_check(evidence_text, target_position)
                        international_major_check = apply_llm_semantic_requirement_fallback(
                            international_major_check,
                            text=evidence_text,
                            target_position=target_position,
                            keywords=["国际贸易", "英语专业", "俄语专业", "翻译专业", "理工科且英语六级"],
                            keyword_mode="any",
                            profile="international_business",
                            required="国际贸易/英语/俄语/翻译，或理工科专业且英语六级",
                        )
                        if not international_major_check.get("allowed"):
                            record_proactive_decision(
                                "skipped",
                                international_major_check.get("reason") or "missing_required_major",
                                internationalMajor=international_major_check,
                            )
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "international_major_not_qualified_skipped",
                                "reason": international_major_check.get("reason") or "missing_required_major",
                                "required": international_major_check.get("required") or "",
                                "resumePreview": safe_text(evidence_text, 180),
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue
                        electrical_check = recommend_candidate_electrical_engineer_check(evidence_text, target_position)
                        electrical_check = apply_llm_semantic_requirement_fallback(
                            electrical_check,
                            text=evidence_text,
                            target_position=target_position,
                            keywords=["电气工程专业", "自动化专业", "PLC"],
                            keyword_mode="all",
                            profile="electrical",
                            required="电气工程或自动化专业，且简历中体现 PLC",
                        )
                        if not electrical_check.get("allowed"):
                            record_proactive_decision(
                                "skipped",
                                electrical_check.get("reason") or "missing_electrical_requirements",
                                electrical=electrical_check,
                            )
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "electrical_not_qualified_skipped",
                                "reason": electrical_check.get("reason") or "missing_electrical_requirements",
                                "required": electrical_check.get("required") or "",
                                "resumePreview": safe_text(evidence_text, 180),
                                "actionLogId": action_log.get("actionLogId"),
                            })
                            close_recommend_resume_dialog(terminal, frame)
                            continue
                    match = recommend_candidate_matches_application_technology(evidence_text)
                    if require_match and not match.get("matched"):
                        semantic_match = llm_semantic_resume_requirement_check(
                            text=evidence_text,
                            target_position=target_position,
                            keywords=["流变助剂", "膨润土", "工业涂料", "涂料研发", "涂料工程师"],
                            keyword_mode="any",
                            profile="application_technology",
                            required="流变助剂、膨润土、工业涂料、涂料研发、涂料工程师任意一个或语义接近的工业涂料研发/配方/应用技术经历",
                        )
                        if semantic_match.get("allowed"):
                            match = {
                                **match,
                                "matched": True,
                                "reason": "llm_semantic_application_technology_matched",
                                "semanticCheck": semantic_match,
                                "evidence": semantic_match.get("evidence", []),
                            }
                    if require_match and not match.get("matched"):
                        record_proactive_decision("skipped", match.get("reason") or "not_application_technology", match=match)
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "not_matched_skipped",
                            "reason": match.get("reason") or "not_application_technology",
                            "score": match.get("score"),
                            "resumePreview": safe_text(evidence_text, 180),
                            "actionLogId": action_log.get("actionLogId"),
                        })
                        close_recommend_resume_dialog(terminal, frame)
                        continue
                    if dry_run:
                        record_proactive_decision(
                            "dry_run_would_greet",
                            "dry_run",
                            customRule=custom_rule_check,
                            colleagueProgress=colleague_progress,
                        )
                        results.append({
                            "candidateName": candidate_name,
                            "action": "dry_run_would_greet",
                            "score": match.get("score"),
                            "education": education_check,
                            "age": age_check,
                            "keyword": keyword_check,
                            "major": major_check,
                            "internationalMajor": international_major_check,
                            "electrical": electrical_check,
                            "customRule": custom_rule_check,
                            "resumeInfo": {
                                "summaryText": safe_text(str(resume_info.get("summaryText") or ""), 260),
                                "hasGreetButton": bool(resume_info.get("hasGreetButton")),
                            },
                            "resumeBrowse": resume_browse,
                            "colleagueProgress": colleague_progress,
                            "evidence": match.get("evidence", []),
                            "preview": safe_text(evidence_text, 180),
                            "actionLogId": action_log.get("actionLogId"),
                        })
                        close_recommend_resume_dialog(terminal, frame)
                        handled_this_round += 1
                        continue

                    greet_locator = frame.locator(".dialog-wrap.active button.btn-greet").first
                    greet_button_count = greet_locator.count()
                    before_greet_validation = validate_before_greet(
                        target_count=target_count,
                        current_count=len(results),
                        dry_run=dry_run,
                        current_position=current_position,
                        target_position=target_position,
                        resume_info=resume_info,
                        colleague_progress=colleague_progress,
                        custom_rule_check=custom_rule_check,
                        custom_rules_enabled=bool(custom_rule_config.get("enabled")),
                        default_checks={
                            "education": education_check,
                            "age": age_check,
                            "keyword": keyword_check,
                            "major": major_check,
                            "internationalMajor": international_major_check,
                            "electrical": electrical_check,
                        },
                        require_match=require_match,
                        match=match,
                        greet_button_count=greet_button_count,
                    )
                    add_checkpoint(
                        action_log,
                        "before_greet_validation",
                        "passed" if before_greet_validation.get("allowed") else "failed",
                        validation=before_greet_validation,
                    )
                    if not before_greet_validation.get("allowed"):
                        record_proactive_decision(
                            "skipped",
                            before_greet_validation.get("reason") or "before_greet_validation_failed",
                            beforeGreetValidation=before_greet_validation,
                        )
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "before_greet_validation_failed_skipped",
                            "reason": before_greet_validation.get("reason") or "before_greet_validation_failed",
                            "beforeGreetValidation": before_greet_validation,
                            "resumePreview": safe_text(evidence_text, 180),
                            "actionLogId": action_log.get("actionLogId"),
                        })
                        close_recommend_resume_dialog(terminal, frame)
                        continue
                    if terminal.humanize:
                        terminal.pause_like_person("pre_action")
                        highlight_target(greet_locator)
                    add_checkpoint(action_log, "click_greet", "started")
                    humanized_precise_button_click(terminal, greet_locator, force=True)
                    add_checkpoint(action_log, "click_greet", "clicked")
                    post_greet_wait = wait_for_post_greet_surface(page, timeout_ms=random.randint(1400, 2400))
                    post_greet_cleanup = close_recommend_dialogs_after_greet(terminal, frame, attempts=5)
                    post_greet_popup = post_greet_cleanup.get("postGreetPopup") or {
                        "closed": False,
                        "reason": "post_greet_cleanup_missing_popup_result",
                    }
                    close_after_greet = post_greet_cleanup.get("resumeDialogClose") or {
                        "closed": False,
                        "reason": "post_greet_cleanup_missing_resume_close_result",
                    }
                    if post_greet_cleanup.get("blockedByAck"):
                        similar_scroll = {"scrolled": False, "reason": "blocked_by_post_greet_ack"}
                    else:
                        similar_scroll = scroll_past_recommend_similar_if_needed(terminal, frame)
                    late_post_greet_popup = post_greet_cleanup.get("latePostGreetPopup") or {
                        "closed": False,
                        "reason": "already_closed_or_not_found",
                    }
                    post_greet_popup_after_scroll = (
                        late_post_greet_popup
                        if late_post_greet_popup.get("closed")
                        else {"closed": False, "reason": "already_closed_or_not_found" if post_greet_popup.get("closed") else "post_greet_close_attempts_exhausted"}
                    )
                    followup = {
                        "clicked": False,
                        "reason": "resume_dialog_greet_button_only",
                        "similarRecommendation": similar_scroll,
                        "resumeDialogClose": close_after_greet,
                        "postGreetPopup": post_greet_popup,
                        "postGreetPopupAfterScroll": post_greet_popup_after_scroll,
                        "postGreetCleanup": post_greet_cleanup,
                        "postGreetWait": post_greet_wait,
                    }
                    after = read_recommend_frame_summary(frame)
                    after_greet_validation = validate_after_greet(
                        cleanup=post_greet_cleanup,
                        summary_after=after,
                        target_count=target_count,
                        result_count=len(results) + 1,
                    )
                    add_checkpoint(
                        action_log,
                        "after_greet_validation",
                        "passed" if after_greet_validation.get("passed") else "failed",
                        validation=after_greet_validation,
                    )
                    followup["beforeGreetValidation"] = before_greet_validation
                    followup["afterGreetValidation"] = after_greet_validation
                    item = {
                        "candidateName": candidate_name,
                        "action": "greeted",
                        "score": match.get("score"),
                        "education": education_check,
                        "age": age_check,
                        "evidence": match.get("evidence", []),
                        "keyword": keyword_check,
                        "major": major_check,
                        "internationalMajor": international_major_check,
                        "electrical": electrical_check,
                        "customRule": custom_rule_check,
                        "followup": followup,
                        "resumeInfo": {
                            "summaryText": safe_text(str(resume_info.get("summaryText") or ""), 260),
                            "hasGreetButton": bool(resume_info.get("hasGreetButton")),
                        },
                        "resumeBrowse": resume_browse,
                        "colleagueProgress": colleague_progress,
                        "preview": safe_text(evidence_text, 180),
                        "actionLogId": action_log.get("actionLogId"),
                    }
                    if after.get("risk"):
                        item["risk"] = after.get("risk")
                    if post_greet_cleanup.get("blockedByAck"):
                        item["risk"] = "post_greet_ack_still_visible_after_retries"
                    if not after_greet_validation.get("passed"):
                        item["risk"] = item.get("risk") or after_greet_validation.get("reason") or "after_greet_validation_failed"
                    record_proactive_decision(
                        "greeted",
                        after_greet_validation.get("reason") or "greeted",
                        beforeGreetValidation=before_greet_validation,
                        afterGreetValidation=after_greet_validation,
                        followup=followup,
                    )
                    results.append(item)
                    self.set_chat_state(
                        state_key,
                        "proactive_greeted",
                        candidateName=candidate_name,
                        appliedPosition=target_position,
                        candidateLabel=safe_text(evidence_text, 180),
                        proactiveCandidateKey=candidate_key,
                        proactiveIdentityKey=stable_digest(f"{candidate_name}|{target_position}", 24),
                        candidateLabelFingerprint=stable_digest(compact_conversation_label(evidence_text), 24),
                        source="recommend",
                    )
                    handled_this_round += 1
                    maybe_human_proactive_contact_pause(terminal, len(results))
                    if similar_scroll.get("scrolled"):
                        after_action_scrolled = True
                        break
                    if after.get("risk"):
                        no_new_rounds = 3
                        break
                    if post_greet_cleanup.get("blockedByAck"):
                        no_new_rounds = 3
                        break
                except Exception as error:
                    close_recommend_resume_dialog(terminal, frame)
                    try:
                        record_proactive_decision("failed", safe_text(str(error), 180))
                    except Exception:
                        pass
                    skipped.append({
                        "candidateName": candidate_name,
                        "action": "greet_failed",
                        "reason": safe_text(str(error), 180),
                        "actionLogId": action_log.get("actionLogId"),
                    })
                    continue

            if len(results) >= target_count or no_new_rounds >= 3:
                break
            if handled_this_round == 0:
                no_new_rounds += 1
            else:
                no_new_rounds = 0
            scroll_round += 1
            if after_action_scrolled:
                page.wait_for_timeout(random.randint(700, 1200))
                continue
            scrolled = scroll_recommend_frame(terminal, frame)
            if not scrolled.get("scrolled"):
                break
            page.wait_for_timeout(random.randint(1100, 1900))

        counts = {
            "opened": len(opened_candidate_keys),
            "openedCandidates": len(opened_candidate_keys),
            "greeted": len([item for item in results if item.get("action") == "greeted"]),
            "dryRun": len([item for item in results if item.get("action") == "dry_run_would_greet"]),
            "skipped": len(skipped),
        }
        action_text = "可主动联系" if dry_run else "已主动打招呼"
        rule_text = "自定义规则" if custom_rule_config.get("enabled") else "岗位默认规则"
        message = (
            f"{safe_text(target_position, 40)}推荐牛人主动联系完成：目标 {target_count} 人，"
            f"{action_text} {len(results)} 人，跳过 {len(skipped)} 人。本轮使用{rule_text}。"
        )
        if results:
            message += " 处理记录：" + "；".join(
                f"{index}. {safe_text(str(item.get('candidateName') or '未知候选人'), 16)}（{item.get('action')}）"
                for index, item in enumerate(results[:12], start=1)
            )
        self.add_event("chat", message, {
            "type": "proactive_recommend_contact",
            "targetPosition": target_position,
            "counts": counts,
            "entry": entry,
            "selection": selection,
            "requireMatch": require_match,
            "customRules": custom_rule_config,
            "speedMode": "proactive_slow",
        })
        batch_report = append_recruiter_batch_report({
            "type": "proactive_recommend_contact",
            "message": safe_text(message, 800),
            "state": {
                "targetPosition": target_position,
                "currentPosition": current_position,
                "targetCount": target_count,
                "dryRun": dry_run,
                "requireMatch": require_match,
                "customRules": custom_rule_config,
                "entry": entry,
                "selection": selection,
                "counts": counts,
                "scrollRounds": scroll_round,
                "speedMode": "proactive_slow",
            },
            "results": results,
            "skipped": skipped[:80],
        })
        result = {
            "message": message,
            "results": results,
            "skipped": skipped,
            "counts": counts,
            "state": {
                "targetPosition": target_position,
                "currentPosition": current_position,
                "targetCount": target_count,
                "dryRun": dry_run,
                "requireMatch": require_match,
                "customRules": custom_rule_config,
                "entry": entry,
                "selection": selection,
                "counts": counts,
                "scrollRounds": scroll_round,
                "speedMode": "proactive_slow",
            },
            "batchReportId": batch_report.get("runId"),
        }
        restore_proactive_speed()
        return result

    def revisit_recruiter_watch_items_for_followups(
        self,
        terminal: BrowserTerminal,
        watch_items: list[dict],
        start_index: int = 0,
        max_items: int = 4,
    ) -> tuple[list[dict], int]:
        results: list[dict] = []
        if not watch_items:
            return results, 0
        count = max(1, min(len(watch_items), int(max_items or 4)))
        cursor = int(start_index or 0) % len(watch_items)
        for offset in range(count):
            self.check_pause()
            item = watch_items[(cursor + offset) % len(watch_items)]
            if not isinstance(item, dict):
                continue
            target = find_recruiter_candidate_by_identity(terminal, item, scroll_attempts=5)
            if not target and item.get("candidateName"):
                target = find_recruiter_candidate_by_name(terminal, str(item.get("candidateName") or ""), scroll_attempts=5)
            if not target:
                results.append({
                    "handled": False,
                    "label": safe_text(str(item.get("candidateLabel") or item.get("candidateName") or ""), 120),
                    "action": "not_visible_revisit",
                    "message": "主动回访观察名单时没有在当前列表找到该联系人。",
                })
                continue
            locator = target.get("locator")
            if locator is None:
                results.append({
                    "handled": False,
                    "label": safe_text(str(target.get("label") or item.get("candidateLabel") or ""), 120),
                    "action": "blocked",
                    "message": "主动回访观察名单时找到了联系人，但没有拿到可点击元素。",
                })
                continue
            try:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(760, 1240))
            except Exception as error:
                results.append({
                    "handled": False,
                    "label": safe_text(str(target.get("label") or item.get("candidateLabel") or ""), 120),
                    "action": "blocked",
                    "message": f"主动回访观察名单联系人失败：{safe_text(str(error), 140)}",
                })
                continue
            maybe_human_reading_pause(
                terminal,
                reason="watch_direct_revisit",
                text_hint=str(target.get("label") or item.get("candidateLabel") or ""),
            )
            process_result = self.process_current_recruiter_watch_followup(
                terminal,
                watch_items,
                forced_watch_item=item,
            )
            if process_result.get("handled"):
                process_result["detectedBy"] = "direct_revisit"
                results.append(process_result)
                return results, (cursor + offset + 1) % len(watch_items)
        return results, (cursor + count) % len(watch_items)

    def process_current_recruiter_watch_followup(
        self,
        terminal: BrowserTerminal,
        watch_items: list[dict],
        forced_watch_item: dict | None = None,
    ) -> dict:
        context = self.read_chat_context(terminal)
        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")
        current_item = forced_watch_item or find_matching_recruiter_watch_item(watch_items, candidate_label, context)
        if forced_watch_item and not recruiter_watch_item_matches_label(forced_watch_item, candidate_label, context=context):
            return {
                "handled": False,
                "label": safe_text(candidate_label, 120),
                "action": "open_not_verified",
                "message": "已点击观察名单联系人，但详情区没有稳定切换到该候选人，本轮不处理。",
            }
        if not current_item:
            return {
                "handled": False,
                "label": safe_text(candidate_label, 120),
                "action": "not_in_watch_list",
                "message": "当前会话不在这次最近联系人观察名单里。",
            }
        last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
        last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
        last_other_signature = chat_message_signature(last_other) if last_other else ""
        if last_message.get("sender") != "other":
            update_recruiter_watch_item_from_context(current_item, context, candidate_label)
            return {
                "handled": False,
                "label": safe_text(candidate_label or str(current_item.get("candidateLabel") or ""), 120),
                "action": "waiting_no_new_reply",
                "message": "最后一条不是候选人发来的，本轮跳过。",
            }
        if last_other_signature and last_other_signature == str(current_item.get("lastOtherSignature") or ""):
            return {
                "handled": False,
                "label": safe_text(candidate_label or str(current_item.get("candidateLabel") or ""), 120),
                "action": "same_reply_skipped",
                "message": "候选人最新回复已经处理过，本轮不重复处理。",
            }
        result = self.screen_recruiter_basic_conditions(
            terminal,
            open_unreplied=False,
            target_candidate="",
            max_attempts=1,
        )
        after_context = self.read_chat_context(terminal)
        after_candidate = read_recruiter_selected_candidate(terminal)
        after_label = str(after_candidate.get("label") or candidate_label or current_item.get("candidateLabel") or "")
        update_recruiter_watch_item_from_context(current_item, after_context, after_label)
        action = classify_recruiter_screen_result_action(result)
        screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
        return {
            "handled": True,
            "label": safe_text(after_label, 120),
            "action": action,
            "screeningStatus": screening.get("status") or "",
            "message": safe_text(str(result.get("message") or ""), 240),
        }

    @timed_agent_stage("request_resume_flow", "求简历流程")
    def request_resume_from_recruiter_conversation(
        self,
        terminal: BrowserTerminal,
        confirmed: bool = False,
        open_unreplied: bool = True,
        expected_candidate: str = "",
        target_candidate: str = "",
    ) -> dict:
        self.check_pause()
        opened = None
        target_candidate = clean_recruiter_candidate_name(target_candidate)
        if target_candidate:
            current = read_recruiter_selected_candidate(terminal)
            current_label = str(current.get("label") or "")
            if candidate_label_matches(current_label, target_candidate):
                opened = {"label": current_label, "matchedBy": "current", "targetCandidate": target_candidate}
            else:
                target = find_recruiter_candidate_by_name(terminal, target_candidate, scroll_attempts=10)
                if not target:
                    return {
                        "blocked": True,
                        "message": f"没有在当前招聘会话列表里找到候选人：{safe_text(target_candidate, 40)}。你可以先切到“全部/未读”或搜索到这个候选人后再试。",
                        "candidate": None,
                        "targetCandidate": target_candidate,
                    }
                locator = target.get("locator")
                if locator is None:
                    return {
                        "blocked": True,
                        "message": f"找到了候选人：{safe_text(target_candidate, 40)}，但没有拿到可点击元素，请重新观察页面后再试。",
                        "candidate": {k: v for k, v in target.items() if k != "locator"},
                        "targetCandidate": target_candidate,
                    }
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(900, 1400))
                opened = {k: v for k, v in target.items() if k != "locator"}
                maybe_human_reading_pause(terminal, reason="candidate_open", text_hint=str(opened.get("label") or ""))
        elif open_unreplied:
            prepare_recruiter_unread_candidate_list(terminal)
            target = find_recruiter_unreplied_candidate(terminal)
            if not target:
                return {
                    "blocked": True,
                    "message": "没有在当前可见列表里找到带待处理数字的候选人。可以先点“未读”或滚动列表后再试。",
                    "candidate": None,
                }
            locator = target.get("locator")
            if locator is None:
                return {
                    "blocked": True,
                    "message": "找到了待处理候选人信息，但没有拿到可点击元素，请重新观察页面后再试。",
                    "candidate": {k: v for k, v in target.items() if k != "locator"},
                }
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            terminal.current_page().wait_for_timeout(random.randint(900, 1400))
            opened = {k: v for k, v in target.items() if k != "locator"}
            maybe_human_reading_pause(terminal, reason="candidate_open", text_hint=str(opened.get("label") or ""))

        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")
        maybe_human_reading_pause(terminal, reason="before_decision", text_hint=candidate_label)
        if confirmed and expected_candidate:
            expected_core = normalize_candidate_label(expected_candidate)
            current_core = normalize_candidate_label(candidate_label)
            if expected_core and current_core and expected_core not in current_core and current_core not in expected_core:
                return {
                    "blocked": True,
                    "message": f"当前打开的候选人与待确认对象不一致。待确认：{safe_text(expected_candidate, 80)}；当前：{safe_text(candidate_label, 80)}。我已停止，避免点错人。",
                    "candidate": candidate,
                }

        resume_state = self.measure_current_timing_stage(
            "inspect_resume_state",
            "检查简历状态",
            lambda: inspect_recruiter_resume_request_state(terminal),
        )
        if resume_state.get("hasResumeAttachment"):
            message = f"已打开候选人：{safe_text(candidate_label, 80)}。检测到候选人已发送附件简历，BOSS 简历按邮箱收取，本次不再求简历。"
            return {
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "skipped": True,
                "skipReason": "resume_attachment_received",
                "resumeReceived": True,
                "after": {"sentLike": True, "resumeAttachmentReceived": True},
                "resumeState": resume_state,
            }

        incoming_resume = accept_recruiter_incoming_resume_consent_if_present(terminal, candidate_label)
        if incoming_resume.get("clicked"):
            message = f"检测到候选人主动发送附件简历，已点击“同意”接收，BOSS 简历按邮箱收取。"
            self.add_event("chat", message)
            return {
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "acceptedIncomingResume": True,
                "incomingResume": incoming_resume,
                "skipped": True,
                "skipReason": "resume_attachment_received",
                "resumeReceived": True,
                "after": incoming_resume.get("after") if isinstance(incoming_resume.get("after"), dict) else {},
            }
        if incoming_resume.get("found") and incoming_resume.get("blocked"):
            message = (
                f"检测到候选人主动发送附件简历，但未能稳定点击“同意”，已快速停止本次求简历，避免长时间卡顿："
                f"{safe_text(str(incoming_resume.get('error') or incoming_resume.get('reason') or ''), 120)}"
            )
            return {
                "blocked": True,
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "incomingResume": incoming_resume,
            }

        if resume_state.get("hasResumeAttachment"):
            message = f"已打开候选人：{safe_text(candidate_label, 80)}。检测到候选人已发送附件简历，BOSS 简历按邮箱收取，本次不再求简历。"
            return {
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "skipped": True,
                "skipReason": "resume_attachment_received",
                "resumeReceived": True,
                "after": {"sentLike": True, "resumeAttachmentReceived": True},
                "resumeState": resume_state,
            }
        if resume_state.get("alreadyRequested"):
            message = f"已打开候选人：{safe_text(candidate_label, 80)}。检测到之前已经求过简历，本次跳过。"
            return {
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "skipped": True,
                "skipReason": "already_requested",
                "resumeState": resume_state,
            }

        button = self.measure_current_timing_stage(
            "find_request_resume_button",
            "查找求简历按钮",
            lambda: find_recruiter_request_resume_button(terminal),
        )
        if not button.get("found"):
            return {
                "blocked": True,
                "message": "当前候选人聊天区没有找到“求简历”按钮。请确认已打开招聘端聊天详情。",
                "candidate": candidate,
                "opened": opened,
                "state": button,
            }
        reason = str(button.get("reason") or "")
        if button.get("disabled"):
            message = f"已打开候选人：{safe_text(candidate_label, 80)}。但“求简历”当前不可用。"
            if reason:
                message += f" 页面提示：{safe_text(reason, 120)}"
            already_hint = reason + " " + str(resume_state.get("summary") or "")
            if any(term in already_hint for term in ("简历请求已发送", "已发送简历请求", "已求简历", "请求过简历", "已请求")):
                return {
                    "message": f"已打开候选人：{safe_text(candidate_label, 80)}。页面显示已经求过简历，本次跳过。",
                    "candidate": candidate,
                    "opened": opened,
                    "skipped": True,
                    "skipReason": "already_requested",
                    "state": {k: v for k, v in button.items() if k != "locator"},
                    "resumeState": resume_state,
                }
            return {
                "blocked": True,
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "state": {k: v for k, v in button.items() if k != "locator"},
            }

        locator = button.get("locator")
        if locator is None:
            return {
                "blocked": True,
                "message": "找到了“求简历”按钮信息，但没有拿到可点击元素，请重新观察页面后再试。",
                "candidate": candidate,
            }
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        click_started = time.time()
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        terminal.current_page().wait_for_timeout(random.randint(1000, 1600))
        self.record_current_timing_stage("click_request_resume", "点击求简历", click_started, ok=True)
        confirm_button = self.measure_current_timing_stage(
            "wait_resume_confirm_button",
            "等待求简历确认弹窗",
            lambda: wait_for_recruiter_resume_final_confirm_button(terminal),
        )
        after = self.measure_current_timing_stage(
            "inspect_after_request_resume",
            "检查求简历点击结果",
            lambda: inspect_recruiter_resume_request_after_click(terminal),
        )
        request_click_retried = False
        if not confirm_button.get("found") and not after.get("sentLike") and not after.get("needsFollowup"):
            retry_button = find_recruiter_request_resume_button(terminal)
            retry_locator = retry_button.get("locator") if isinstance(retry_button, dict) else None
            if retry_locator is not None and not retry_button.get("disabled"):
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(retry_locator)
                retry_started = time.time()
                humanized_locator_click(terminal, retry_locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(1000, 1600))
                self.record_current_timing_stage("click_request_resume_retry", "补点求简历", retry_started, ok=True)
                confirm_button = wait_for_recruiter_resume_final_confirm_button(terminal)
                after = inspect_recruiter_resume_request_after_click(terminal)
                request_click_retried = True
        message = f"已点击候选人的“求简历”：{safe_text(candidate_label, 80)}。"
        if request_click_retried:
            message += " 首次点击后未检测到确认弹窗或已发送状态，已自动补点一次。"
        if confirm_button.get("found"):
            final_result = self.confirm_recruiter_resume_request(
                terminal,
                expected_candidate=candidate_label,
                button=confirm_button,
            )
            final_message = final_result.get("message") or "已自动点击二次确认。"
            message += f" 已找到二次确认按钮并继续执行：{safe_text(final_message, 180)}"
            return {
                "message": message,
                "candidate": candidate,
                "state": {k: v for k, v in button.items() if k != "locator"},
                "after": after,
                "final": final_result,
                "clickRetried": request_click_retried,
            }
        if after.get("sentLike"):
            message += " 页面已出现“简历请求已发送”相关记录。"
        elif after.get("needsFollowup"):
            final_result = self.confirm_recruiter_resume_request(terminal, expected_candidate=candidate_label)
            final_message = final_result.get("message") or "已自动点击二次确认。"
            message += f" 页面出现二次确认：{safe_text(after.get('summary', ''), 160)}。{safe_text(final_message, 180)}"
            return {
                "message": message,
                "candidate": candidate,
                "state": {k: v for k, v in button.items() if k != "locator"},
                "after": after,
                "final": final_result,
                "clickRetried": request_click_retried,
            }
        else:
            message += " 请看一下页面是否弹出二次确认或状态提示。"
        self.add_event("chat", message)
        return {
            "message": message,
            "candidate": candidate,
            "state": {k: v for k, v in button.items() if k != "locator"},
            "after": after,
            "clickRetried": request_click_retried,
        }

    def request_resume_for_unreplied_candidates(self, terminal: BrowserTerminal, count: int) -> dict:
        target_count = max(1, min(30, int(count or 1)))
        results: list[dict] = []
        successes = 0
        skipped = 0
        seen: set[str] = set()
        blocked_message = ""
        no_target_attempts = 0
        max_attempts = max(target_count * 4, target_count + 8)

        while len(results) < target_count and len(results) + no_target_attempts < max_attempts:
            self.check_pause()
            result = self.request_resume_from_recruiter_conversation(
                terminal,
                confirmed=False,
                open_unreplied=True,
            )
            candidate = result.get("candidate") if isinstance(result.get("candidate"), dict) else {}
            label = str(candidate.get("label") or "")
            key = normalize_candidate_label(label)
            if result.get("blocked") and not key:
                blocked_message = str(result.get("message") or "页面阻塞，批量求简历已暂停。")
                if "没有在当前可见列表里找到" in blocked_message or "没有拿到可点击元素" in blocked_message:
                    scrolled = scroll_recruiter_candidate_list(terminal)
                    no_target_attempts += 1
                    if scrolled.get("scrolled"):
                        terminal.current_page().wait_for_timeout(random.randint(650, 1200))
                        continue
                    break
                break

            item = {
                "index": len(results) + 1,
                "candidate": safe_text(label, 120),
                "message": safe_text(str(result.get("message") or ""), 240),
                "blocked": bool(result.get("blocked")),
                "skipped": bool(result.get("skipped")),
                "skipReason": result.get("skipReason") or "",
            }
            results.append(item)

            if key:
                if key in seen:
                    blocked_message = "连续两次定位到同一个候选人，我已停止，避免重复求同一个人的简历。"
                    break
                seen.add(key)

            if result.get("blocked"):
                blocked_message = str(result.get("message") or "页面阻塞，批量求简历已暂停。")
                # A disabled/missing button can be candidate-specific. Try the next
                # visible unread row once; stop only when the list itself has no target.
                if "没有在当前可见列表里找到" in blocked_message or "没有拿到可点击元素" in blocked_message:
                    scrolled = scroll_recruiter_candidate_list(terminal)
                    if scrolled.get("scrolled"):
                        terminal.current_page().wait_for_timeout(random.randint(650, 1200))
                        continue
                    break
                terminal.current_page().wait_for_timeout(random.randint(650, 1100))
                continue

            if result.get("skipped"):
                skipped += 1
                terminal.current_page().wait_for_timeout(random.randint(650, 1200))
                continue

            after = result.get("after") if isinstance(result.get("after"), dict) else {}
            final = result.get("final") if isinstance(result.get("final"), dict) else {}
            final_after = final.get("after") if isinstance(final.get("after"), dict) else {}
            sent_like = (
                not result.get("blocked")
                and not final.get("blocked")
                and bool(
                    result.get("acceptedIncomingResume")
                    or result.get("resumeReceived")
                    or result.get("downloaded")
                    or after.get("sentLike")
                    or final_after.get("sentLike")
                    or "已点击最终“确定”" in str(final.get("message") or "")
                    or "简历请求已发送" in str(result.get("message") or "")
                )
            )
            if sent_like:
                successes += 1
                if successes < target_count:
                    maybe_human_resume_request_pause(terminal)

            if successes >= target_count:
                break
            terminal.current_page().wait_for_timeout(random.randint(900, 1500))

        message = f"批量求简历完成：目标 {target_count} 人，成功求简历 {successes} 人，跳过已求过 {skipped} 人。"
        if blocked_message and (successes + skipped) < target_count:
            message += f" 中途停止原因：{safe_text(blocked_message, 160)}"
        if results:
            brief = "；".join(
                f"{item['index']}. {safe_text(item.get('candidate') or '未知候选人', 36)}"
                f"{'（跳过）' if item.get('skipped') else ''}"
                for item in results[:target_count]
            )
            message += f" 处理记录：{brief}"
        self.add_event("chat", message)
        return {
            "message": message,
            "results": results,
            "successes": successes,
            "skipped": skipped,
            "targetCount": target_count,
        }

    def request_resume_for_named_candidates(self, terminal: BrowserTerminal, candidates: list[str]) -> dict:
        names = []
        for candidate in candidates:
            name = clean_recruiter_candidate_name(candidate)
            if name and name not in names:
                names.append(name)
        names = names[:10]
        if not names:
            return {
                "blocked": True,
                "message": "没有识别到要处理的候选人姓名。",
                "results": [],
            }

        results: list[dict] = []
        successes = 0
        for index, name in enumerate(names, start=1):
            self.check_pause()
            result = self.request_resume_from_recruiter_conversation(
                terminal,
                confirmed=False,
                open_unreplied=False,
                target_candidate=name,
            )
            candidate = result.get("candidate") if isinstance(result.get("candidate"), dict) else {}
            after = result.get("after") if isinstance(result.get("after"), dict) else {}
            final = result.get("final") if isinstance(result.get("final"), dict) else {}
            final_after = final.get("after") if isinstance(final.get("after"), dict) else {}
            sent_like = (
                not result.get("blocked")
                and not final.get("blocked")
                and bool(
                    result.get("acceptedIncomingResume")
                    or result.get("resumeReceived")
                    or after.get("sentLike")
                    or final_after.get("sentLike")
                    or "已点击最终“确定”" in str(final.get("message") or "")
                    or "简历请求已发送" in str(result.get("message") or "")
                )
            )
            if sent_like:
                successes += 1
                if index < len(names):
                    maybe_human_resume_request_pause(terminal)
            results.append({
                "index": index,
                "target": name,
                "candidate": safe_text(str(candidate.get("label") or ""), 120),
                "message": safe_text(str(result.get("message") or ""), 240),
                "blocked": bool(result.get("blocked")),
                "sentLike": sent_like,
            })
            if index < len(names):
                terminal.current_page().wait_for_timeout(random.randint(900, 1500))

        message = f"指定候选人求简历完成：目标 {len(names)} 人，成功处理 {successes} 人。"
        brief = "；".join(
            f"{item['index']}. {item['target']}：{'已处理' if item.get('sentLike') else '未完成'}"
            for item in results
        )
        if brief:
            message += f" 处理记录：{brief}"
        self.add_event("chat", message)
        return {
            "message": message,
            "results": results,
            "successes": successes,
            "targetCount": len(names),
        }

    @timed_agent_stage("confirm_resume_request", "二次确认求简历")
    def confirm_recruiter_resume_request(
        self,
        terminal: BrowserTerminal,
        expected_candidate: str = "",
        button: dict | None = None,
    ) -> dict:
        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")
        if expected_candidate:
            expected_core = normalize_candidate_label(expected_candidate)
            current_core = normalize_candidate_label(candidate_label)
            if expected_core and current_core and expected_core not in current_core and current_core not in expected_core:
                return {
                    "blocked": True,
                    "message": f"当前候选人与待确认对象不一致。待确认：{safe_text(expected_candidate, 80)}；当前：{safe_text(candidate_label, 80)}。我已停止，避免点错人。",
                    "candidate": candidate,
                }
        button = button if isinstance(button, dict) and button.get("found") else find_recruiter_resume_final_confirm_button(terminal)
        if not button.get("found"):
            return {
                "blocked": True,
                "message": "没有找到“求简历”二次确认里的最终“确定”按钮。可能弹层已关闭，请重新发起求简历流程。",
                "candidate": candidate,
                "state": button,
            }
        locator = button.get("locator")
        if locator is None:
            return {
                "blocked": True,
                "message": "找到了最终确认按钮的信息，但没有拿到可点击元素，请重新观察页面后再试。",
                "candidate": candidate,
            }
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        click_started = time.time()
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        terminal.current_page().wait_for_timeout(random.randint(900, 1500))
        self.record_current_timing_stage("click_final_resume_confirm", "点击求简历最终确定", click_started, ok=True)
        after = self.measure_current_timing_stage(
            "inspect_after_final_confirm",
            "检查最终确认结果",
            lambda: inspect_recruiter_resume_request_after_click(terminal),
        )
        confirm_click_retried = False
        if not after.get("sentLike"):
            retry_button = find_recruiter_resume_final_confirm_button(terminal)
            retry_locator = retry_button.get("locator") if isinstance(retry_button, dict) else None
            if retry_locator is not None:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(retry_locator)
                retry_started = time.time()
                humanized_locator_click(terminal, retry_locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(900, 1500))
                self.record_current_timing_stage("click_final_resume_confirm_retry", "补点最终确定", retry_started, ok=True)
                after = inspect_recruiter_resume_request_after_click(terminal)
                confirm_click_retried = True
        message = f"已点击最终“确定”，向候选人发送简历请求：{safe_text(candidate_label, 80)}。"
        if confirm_click_retried:
            message += " 首次确认后未检测到已发送状态，已自动补点一次。"
        if after.get("sentLike"):
            message += " 页面已出现“简历请求已发送”相关记录。"
        self.add_event("chat", message)
        return {
            "message": message,
            "candidate": candidate,
            "state": {k: v for k, v in button.items() if k != "locator"},
            "after": after,
            "clickRetried": confirm_click_retried,
        }

    def mark_recruiter_candidate_unsuitable(
        self,
        terminal: BrowserTerminal,
        confirmed: bool = False,
        open_unreplied: bool = False,
        expected_candidate: str = "",
        target_candidate: str = "",
    ) -> dict:
        opened = None
        target_candidate = clean_recruiter_candidate_name(target_candidate)
        if target_candidate:
            current = read_recruiter_selected_candidate(terminal)
            current_label = str(current.get("label") or "")
            if candidate_label_matches(current_label, target_candidate):
                opened = {"label": current_label, "matchedBy": "current", "targetCandidate": target_candidate}
            else:
                target = find_recruiter_candidate_by_name(terminal, target_candidate, scroll_attempts=10)
                if not target:
                    return {
                        "blocked": True,
                        "message": f"没有在当前招聘会话列表里找到候选人：{safe_text(target_candidate, 40)}。你可以先切到“全部/未读”或搜索到这个候选人后再试。",
                        "candidate": None,
                        "targetCandidate": target_candidate,
                    }
                locator = target.get("locator")
                if locator is None:
                    return {
                        "blocked": True,
                        "message": f"找到了候选人：{safe_text(target_candidate, 40)}，但没有拿到可点击元素，请重新观察页面后再试。",
                        "candidate": {k: v for k, v in target.items() if k != "locator"},
                        "targetCandidate": target_candidate,
                    }
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(900, 1400))
                opened = {k: v for k, v in target.items() if k != "locator"}
        elif open_unreplied:
            prepare_recruiter_unread_candidate_list(terminal)
            target = find_recruiter_unreplied_candidate(terminal)
            if target and target.get("locator") is not None:
                locator = target.get("locator")
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(900, 1400))
                opened = {k: v for k, v in target.items() if k != "locator"}

        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")
        if confirmed and expected_candidate:
            expected_core = normalize_candidate_label(expected_candidate)
            current_core = normalize_candidate_label(candidate_label)
            if expected_core and current_core and expected_core not in current_core and current_core not in expected_core:
                return {
                    "blocked": True,
                    "message": f"当前候选人与待确认对象不一致。待确认：{safe_text(expected_candidate, 80)}；当前：{safe_text(candidate_label, 80)}。我已停止，避免点错人。",
                    "candidate": candidate,
                }

        button = find_recruiter_unsuitable_button(terminal)
        if not button.get("found"):
            return {
                "blocked": True,
                "message": "当前候选人聊天区没有找到“不合适”按钮。请确认已打开招聘端聊天详情。",
                "candidate": candidate,
                "opened": opened,
                "state": button,
            }
        if button.get("disabled"):
            return {
                "blocked": True,
                "message": f"已打开候选人：{safe_text(candidate_label, 80)}。但“不合适”当前不可用。",
                "candidate": candidate,
                "opened": opened,
                "state": {k: v for k, v in button.items() if k != "locator"},
            }

        if not confirmed and not is_local_browser_page(terminal):
            pending = self.create_pending_action(
                {
                    "action": "recruiter_mark_unsuitable",
                    "_pendingType": "mark_candidate_unsuitable",
                    "_candidateLabel": candidate_label,
                    "targetCandidate": target_candidate,
                    "openUnreplied": False,
                },
                f"将候选人标记为不合适：{safe_text(candidate_label, 60)}",
            )
            return {
                "blocked": True,
                "confirmRequired": True,
                "pendingAction": pending,
                "message": f"已打开候选人：{safe_text(candidate_label, 80)}。我找到了“不合适”按钮；该操作会改变候选人状态，需要你确认后再执行。",
                "candidate": candidate,
                "opened": opened,
                "state": {k: v for k, v in button.items() if k != "locator"},
            }

        locator = button.get("locator")
        if locator is None:
            return {
                "blocked": True,
                "message": "找到了“不合适”按钮信息，但没有拿到可点击元素，请重新观察页面后再试。",
                "candidate": candidate,
            }
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        terminal.current_page().wait_for_timeout(random.randint(900, 1400))
        after = inspect_recruiter_unsuitable_after_click(terminal)
        message = f"已点击候选人的“不合适”：{safe_text(candidate_label, 80)}。"
        if after.get("needsFollowup"):
            pending = self.create_pending_action(
                {
                    "action": "recruiter_confirm_unsuitable",
                    "_pendingType": "mark_candidate_unsuitable_final",
                    "_candidateLabel": candidate_label,
                },
                f"最终确认不合适：{safe_text(candidate_label, 60)}",
            )
            message += f" 页面出现二次确认：{safe_text(after.get('summary', ''), 160)}。需要你再次确认后，我才会点击最终“确定”。"
            return {
                "blocked": True,
                "confirmRequired": True,
                "pendingAction": pending,
                "message": message,
                "candidate": candidate,
                "state": {k: v for k, v in button.items() if k != "locator"},
                "after": after,
            }
        if after.get("doneLike"):
            message += " 页面看起来已更新候选人状态。"
        self.add_event("chat", message)
        return {
            "message": message,
            "candidate": candidate,
            "state": {k: v for k, v in button.items() if k != "locator"},
            "after": after,
        }

    def confirm_recruiter_unsuitable(self, terminal: BrowserTerminal, expected_candidate: str = "") -> dict:
        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")
        if expected_candidate:
            expected_core = normalize_candidate_label(expected_candidate)
            current_core = normalize_candidate_label(candidate_label)
            if expected_core and current_core and expected_core not in current_core and current_core not in expected_core:
                return {
                    "blocked": True,
                    "message": f"当前候选人与待确认对象不一致。待确认：{safe_text(expected_candidate, 80)}；当前：{safe_text(candidate_label, 80)}。我已停止，避免点错人。",
                    "candidate": candidate,
                }
        button = find_recruiter_unsuitable_final_confirm_button(terminal)
        if not button.get("found"):
            return {
                "blocked": True,
                "message": "没有找到“不合适”二次确认里的最终“确定”按钮。可能弹层已关闭，请重新发起流程。",
                "candidate": candidate,
                "state": button,
            }
        locator = button.get("locator")
        if locator is None:
            return {
                "blocked": True,
                "message": "找到了最终确认按钮的信息，但没有拿到可点击元素，请重新观察页面后再试。",
                "candidate": candidate,
            }
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        terminal.current_page().wait_for_timeout(random.randint(900, 1500))
        after = inspect_recruiter_unsuitable_after_click(terminal)
        message = f"已点击最终“确定”，将候选人标记为不合适：{safe_text(candidate_label, 80)}。"
        self.add_event("chat", message)
        return {
            "message": message,
            "candidate": candidate,
            "state": {k: v for k, v in button.items() if k != "locator"},
            "after": after,
        }

    def create_send_confirmation(self) -> dict:
        terminal = self.get_terminal()
        action = find_send_action(terminal)
        action["_pendingType"] = "send_message"
        label = action.get("target", "发送")
        return self.create_pending_action(action, label)

    def smart_fill(self, terminal: BrowserTerminal, target: str, value: str) -> str:
        if not value:
            raise AgentError("fill 动作缺少要填写的内容。")

        locator = None
        label = target or "自动输入框"
        if target:
            try:
                locator, label = terminal.find_locator(target)
                if not is_editable_locator(locator):
                    locator = None
            except Exception:
                locator = None

        if locator is None:
            locator, label = find_best_editable(terminal, target)

        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
            try:
                humanized_locator_click(terminal, locator)
            except Exception:
                pass
            # Clear then type with per-keystroke random delay.
            locator.fill("", timeout=10000)
            preset = PACE_PRESETS.get(terminal.pace) or PACE_PRESETS["normal"]
            delay_low, delay_high = preset.get("type_delay_ms") or (18, 36)
            fill_hint = f"{target} {label}".lower()
            if any(word in fill_hint for word in ("聊天", "chat", "message", "input", "消息", "发送")):
                delay_low = max(int(delay_low), CHAT_TYPE_DELAY_MS[0])
                delay_high = max(int(delay_high), CHAT_TYPE_DELAY_MS[1])
            typo_chance = float(preset.get("typo_chance") or 0.0)
            text = str(value or "")
            if text and random.random() < typo_chance and len(text) >= 8:
                cut = random.randint(2, min(6, len(text) - 2))
                wrong = random.choice("abcdefghijklmnopqrstuvwxyz")
                locator.type(text[:cut] + wrong, delay=random.randint(int(delay_low), int(delay_high)))
                terminal.current_page().keyboard.press("Backspace")
                locator.type(text[cut:], delay=random.randint(int(delay_low), int(delay_high)))
            else:
                locator.type(text, delay=random.randint(int(delay_low), int(delay_high)))
            terminal.pause_like_person("post_action")
        else:
            locator.fill(value, timeout=10000)
        self.post_action_idle(terminal)
        self.add_event("action", f"已填写：{safe_text(label, 80)}")
        return label

    def post_action_idle(self, terminal: BrowserTerminal) -> None:
        if not terminal.humanize or not is_local_browser_page(terminal):
            return
        page = terminal.current_page()
        choice = random.choice(("pause", "mouse", "scroll", "combo", "none"))
        if choice == "none":
            return
        page.wait_for_timeout(random.randint(125, 600))
        if choice in {"mouse", "combo"}:
            jitter_mouse(page)
        if choice in {"scroll", "combo"}:
            small_scroll_wander(terminal)

    def resolve_action_file(self, value: str) -> str:
        if value:
            path = Path(value.strip().strip('"')).expanduser()
            if path.exists() and path.is_file():
                return str(path.resolve())
        latest = self.latest_file()
        if latest and Path(latest["path"]).exists():
            return latest["path"]
        candidates = self.scan_local_resumes(limit=8)
        if candidates:
            best = candidates[0]
            self.remember_local_file(best["path"])
            return best["path"]
        raise AgentError("我还没有可用文件，也没有在桌面、下载、文档等常用目录找到 PDF/Word 简历候选。")


class AgentRequestHandler(BaseHTTPRequestHandler):
    server_version = "LocalAgentWeb/1.0"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if path in {"/", "/index.html"}:
                self.send_response(308)
                self.send_cors_headers()
                self.send_header("Location", "http://127.0.0.1:8765/index.html")
                self.end_headers()
            elif path == "/api/status":
                self.send_json(SERVICE.status())
            elif path == "/api/recruiter-automation/summary":
                query = urlparse(self.path).query
                params = dict(part.split("=", 1) for part in query.split("&") if "=" in part)
                platform = unquote(params.get("platform", "boss"))
                self.send_json(load_recruiter_automation_summary(platform))
            elif path == "/api/observe":
                self.send_json(SERVICE.observe())
            elif path == "/api/automation-observe":
                self.send_json(SERVICE.automation_message_observe())
            elif path == "/api/files":
                self.send_json({"files": SERVICE.files[-50:]})
            elif path == "/api/pause":
                self.send_json(SERVICE.pause_state())
            else:
                self.send_response(410)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write("旧前端页面已停用，请使用 http://127.0.0.1:8765/index.html".encode("utf-8"))
        except Exception as error:
            self.send_json({"error": str(error)}, status=500)
        finally:
            SERVICE.close_current_thread_terminal()

    def do_POST(self) -> None:
        path = unquote(urlparse(self.path).path)
        try:
            if self.proxy_platform_post_if_needed(path):
                return
            if path == "/api/chat":
                payload = self.read_json()
                options = payload.get("options")
                if isinstance(options, dict):
                    SERVICE.set_options(options)
                message = str(payload.get("message") or "")
                timing = SERVICE.start_operation_timing("chat", message)
                try:
                    result = SERVICE.chat(message, auto=True)
                    finished_timing = SERVICE.finish_operation_timing(timing, "success")
                    if isinstance(result, dict) and finished_timing:
                        result["timings"] = finished_timing
                    if (
                        isinstance(result, dict)
                        and result.get("batchReportId")
                        and isinstance(result.get("state"), dict)
                        and result["state"].get("processedPeople") is not None
                    ):
                        result = compact_process_messages_response(result)
                except Exception as error:
                    finished_timing = SERVICE.finish_operation_timing(timing, "failed", str(error))
                    self.send_json({"error": str(error), "timings": finished_timing}, status=500)
