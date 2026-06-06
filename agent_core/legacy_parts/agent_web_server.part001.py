    def remember_local_file(self, path_text: str) -> dict:
        path = Path(path_text).expanduser().resolve()
        if not path.exists() or not path.is_file():
            raise AgentError(f"本地文件不存在：{path}")
        item = {
            "id": f"local_{int(time.time() * 1000)}",
            "name": path.name,
            "path": str(path),
            "size": path.stat().st_size,
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": "local_scan",
        }
        self.files.append(item)
        save_json(FILE_REGISTRY, self.files[-200:])
        self.add_event("file", f"已设为当前文件：{path.name}")
        return item

    def scan_local_resumes(self, query: str = "", limit: int = 24) -> list[dict]:
        candidates = scan_resume_candidates(query=query, limit=limit)
        self.local_candidates = candidates
        self.add_event("file", f"本地扫描到 {len(candidates)} 个候选文件")
        return candidates

    def chat(self, message: str, auto: bool = True, max_steps: int | None = None) -> dict:
        message = message.strip()
        if not message:
            raise AgentError("请输入你想让智能顾问完成的任务。")

        with self.lock:
            self.check_pause()
            terminal = self.get_terminal()
            self.apply_message_options(terminal, message)

            trace: list[dict] = []
            builtin = self.try_builtin_task(terminal, message, trace)
            if builtin:
                self.add_event("chat", builtin["reply"])
                return builtin

            if not has_model_key():
                raise AgentError("还没有配置模型 API Key。已知任务我可以用内置执行器处理；开放式智能网页操作仍需要模型配置。")

            enriched_task = self.enrich_task_with_files(message)
            final_reply = ""
            done = False
            pending_action = None

            required_rounds = parse_required_chat_rounds(enriched_task)
            last_chat_signature = ""
            if required_rounds > 1:
                try:
                    last_chat_signature = chat_context_signature(self.read_chat_context(terminal).get("recentText", ""))
                except Exception:
                    last_chat_signature = ""

            step_limit = int(max_steps) if max_steps is not None else int(self.max_steps)
            for step in range(1, step_limit + 1):
                self.check_pause()
                completed_before_step = count_completed_chat_rounds(trace) if required_rounds > 1 else 0
                context = terminal.collect_page_context(limit=90)
                context["fileInputs"] = self.collect_file_inputs(terminal)
                related = get_related_memory(terminal.memory, context.get("url", ""))
                step_task = build_step_task(enriched_task, trace, step, step_limit)

                self.add_event("observe", f"第 {step} 步：观察页面")
                model_context = compact_context_for_model(context, enriched_task, trace)
                plan = ask_agent_model_for_actions(step_task, model_context, terminal.active_role, related)
                actions = normalize_agent_actions(plan.get("actions", []), limit=self.max_actions_per_step)
                thought = plan.get("thought") or plan.get("summary") or ""

                step_record = {
                    "step": step,
                    "thought": thought,
                    "actions": [format_action(action) for action in actions],
                    "results": [],
                }
                trace.append(step_record)

                if not actions:
                    final_reply = thought or "模型没有给出可执行动作，我先停下来。"
                    break

                for action in actions:
                    self.check_pause()
                    recovered = self.recover_model_action(terminal, action, message)
                    if recovered:
                        action = recovered
                    # Resolve placeholder targets produced by page tools.
                    if isinstance(action, dict):
                        kind2 = str(action.get("action") or "").lower()
                        if kind2 in {"click", "fill", "upload"}:
                            raw_target = str(action.get("target") or action.get("query") or "").strip()
                            fixed = resolve_index_placeholder(raw_target, self.last_find_element_matches)
                            if fixed != raw_target:
                                action = {**action, "target": fixed}
                    result = self.execute_action(terminal, action)
                    step_record["results"].append(result)
                    if result.get("confirmRequired"):
                        final_reply = result["message"]
                        pending_action = result.get("pendingAction")
                        done = True
                        break
                    if result.get("blocked"):
                        if is_recruiter_basic_screening_task(message):
                            target_candidate = extract_recruiter_screen_candidate_name(message)
                            batch_count = extract_recruiter_screen_batch_count(message)
                            if should_scan_recent_contacts_for_basic_screening(message) and not target_candidate:
                                fallback = self.screen_recent_recruiter_basic_contacts(
                                    terminal,
                                    max_contacts=batch_count,
                                )
                            else:
                                fallback = self.screen_recruiter_basic_conditions(
                                    terminal,
                                    open_unreplied=should_open_unreplied_for_basic_screening(message),
                                    target_candidate=target_candidate,
                                    max_attempts=batch_count,
                                )
                            final_reply = fallback.get("message") or "已切换到招聘端基础条件筛选流程。"
                            pending_action = fallback.get("pendingAction")
                            step_record["results"].append({
                                "message": "通用网页规划失败，已切换到招聘端“基础条件筛选”专用流程。",
                                "fallback": True,
                                "candidate": fallback.get("candidate"),
                                "screening": fallback.get("screening"),
                            })
                            done = True
                            break
                        if is_recruiter_unsuitable_task(message):
                            target_candidate = extract_recruiter_unsuitable_candidate_name(message)
                            fallback = self.mark_recruiter_candidate_unsuitable(
                                terminal,
                                confirmed=False,
                                open_unreplied=False,
                                target_candidate=target_candidate,
                            )
                            final_reply = fallback.get("message") or "已切换到招聘端“不合适”专用流程。"
                            pending_action = fallback.get("pendingAction")
                            step_record["results"].append({
                                "message": "通用网页规划失败，已切换到招聘端“不合适”专用流程。",
                                "fallback": True,
                                "candidate": fallback.get("candidate"),
                            })
                            done = True
                            break
                        if is_recruiter_resume_request_task(message) or looks_like_recruiter_resume_request(message):
                            target_candidates = extract_recruiter_request_candidate_names(message)
                            batch_count = extract_recruiter_batch_count(message)
                            if len(target_candidates) > 1:
                                fallback = self.request_resume_for_named_candidates(terminal, target_candidates)
                            elif batch_count > 1:
                                fallback = self.request_resume_for_unreplied_candidates(terminal, batch_count)
                            else:
                                target_candidate = extract_recruiter_request_candidate_name(message)
                                fallback = self.request_resume_from_recruiter_conversation(
                                    terminal,
                                    confirmed=False,
                                    open_unreplied=not bool(target_candidate),
                                    target_candidate=target_candidate,
                                )
                            final_reply = fallback.get("message") or "已切换到招聘端求简历流程。"
                            pending_action = fallback.get("pendingAction")
                            step_record["results"].append({
                                "message": "通用网页规划失败，已切换到招聘端“求简历”专用流程。",
                                "fallback": True,
                                "candidate": fallback.get("candidate"),
                            })
                            done = True
                            break
                        if is_auto_reply_command(message):
                            fallback = self.auto_reply_chat_once(auto_send=("本地" in message and "自动发送" in message), force=True)
                            final_reply = fallback.get("reply") or fallback.get("message") or "已切换到聊天自动回复流程。"
                            pending_action = fallback.get("pendingAction")
                            step_record["results"].append({
                                "message": "通用网页规划失败，已切换到专用聊天自动回复流程。",
                                "fallback": True,
                            })
                            done = True
                            break
                        final_reply = result["message"]
                        done = True
                        break
                    if result.get("done"):
                        if required_rounds > 1:
                            completed = count_completed_chat_rounds(trace)
                            if completed < required_rounds:
                                final_reply = f"已完成对话 {completed}/{required_rounds} 轮，继续下一轮。"
                                done = False
                                break
                        final_reply = result["message"]
                        done = True
                        break

                # Multi-round chat: after we successfully send a message, wait for the other side to reply.
                if not done and required_rounds > 1:
                    completed_after_step = count_completed_chat_rounds(trace)
                    if completed_after_step > completed_before_step:
                        try:
                            current_signature = chat_context_signature(self.read_chat_context(terminal).get("recentText", ""))
                        except Exception:
                            current_signature = last_chat_signature
                        changed = self.wait_for_chat_change(terminal, current_signature or last_chat_signature)
                        if not changed:
                            final_reply = (
                                f"已发送第 {completed_after_step}/{required_rounds} 轮消息，正在等待对方回复。"
                                "对方回复后你再让我继续，我会进入下一轮。"
                            )
                            done = True
                        else:
                            try:
                                last_chat_signature = chat_context_signature(self.read_chat_context(terminal).get("recentText", ""))
                            except Exception:
                                pass

                memory_entry = {
                    "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "url": context.get("url", ""),
                    "title": context.get("title", ""),
                    "role": get_role_name(terminal.roles, terminal.active_role),
                    "task": message,
                    "agentStep": step,
                    "thought": thought,
                    "actions": actions,
                    "confirmed": auto,
                    "result": "done" if done else "executed",
                    "afterUrl": terminal.current_page().url,
                    "afterTitle": terminal.current_page().title(),
                }
                append_memory(terminal.memory, memory_entry)

                if done:
                    break
                terminal.current_page().wait_for_timeout(random.randint(320, 420))

            if not final_reply:
                final_reply = "我已经执行到当前阶段。你可以继续给我下一步指令，或者让我观察页面状态。"

            self.add_event("chat", final_reply)
            return {
                "reply": final_reply,
                "trace": trace,
                "pendingAction": pending_action,
                "files": self.files[-8:],
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
            }

    def create_pending_action(self, action: dict, label: str) -> dict:
        token = f"confirm_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
        item = {
            "token": token,
            "action": action,
            "label": label,
            "url": self.get_terminal().current_page().url,
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        self.pending_actions[token] = item
        return {
            "token": token,
            "label": label,
            "url": item["url"],
            "time": item["time"],
        }

    def pending_send_confirmation(self) -> dict | None:
        for item in reversed(list(self.pending_actions.values())):
            action = item.get("action") if isinstance(item, dict) else None
            if isinstance(action, dict) and action.get("_pendingType") == "send_message":
                return {
                    "token": item.get("token"),
                    "label": item.get("label"),
                    "url": item.get("url"),
                    "time": item.get("time"),
                }
        return None

    def confirm_action(self, token: str) -> dict:
        with self.lock:
            item = self.pending_actions.pop(token, None)
            if not item:
                raise AgentError("这个确认请求不存在或已经执行过。")
            terminal = self.get_terminal()
            action = dict(item["action"])
            action["_confirmed"] = True
            result = self.execute_action(terminal, action)
            if action.get("_pendingType") == "send_message":
                conversation_key = str(action.get("_conversationKey") or "")
                last_other_signature = str(action.get("_lastOtherSignature") or "")
                terminal.current_page().wait_for_timeout(random.randint(650, 1100))
                unread_state = read_unread_badge_state(terminal)
                unread_signature = str(unread_state.get("signature") or "")
                if unread_signature:
                    self.chat_monitor_unread_signature = unread_signature
                    self.chat_monitor_handled_unread_signature = unread_signature
                context = self.read_chat_context(terminal)
                if conversation_key:
                    context["conversationKey"] = conversation_key
                    context["memory"] = self.refresh_chat_memory(context, conversation_key)
                signature = chat_context_signature(context.get("recentText", ""))
                if signature:
                    self.chat_monitor_signature = signature
                if conversation_key:
                    self.set_chat_state(
                        conversation_key,
                        "sent",
                        lastOtherSignature=last_other_signature or context.get("lastOtherSignature", ""),
                        sentAt=time.strftime("%Y-%m-%d %H:%M:%S"),
                    )
                self.chat_monitor_cooldown_until = time.time() + 8.0
            response = {
                "reply": result.get("message", "已执行确认动作。"),
                "result": result,
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
            }
            if result.get("confirmRequired"):
                response["pendingAction"] = result.get("pendingAction")
            return response

    def cancel_action(self, token: str) -> dict:
        with self.lock:
            item = self.pending_actions.pop(token, None)
            if not item:
                return {"reply": "这次确认请求已经取消或不存在。"}
            action = item.get("action") if isinstance(item, dict) else {}
            if isinstance(action, dict) and action.get("_pendingType") == "request_candidate_resume_final":
                try:
                    close_recruiter_resume_confirm_tooltip(self.get_terminal())
                except Exception:
                    pass
            if isinstance(action, dict) and action.get("_pendingType") == "mark_candidate_unsuitable_final":
                try:
                    close_recruiter_unsuitable_confirm_dialog(self.get_terminal())
                except Exception:
                    pass
            if isinstance(action, dict) and action.get("_conversationKey"):
                self.set_chat_state(
                    str(action.get("_conversationKey")),
                    "cancelled",
                    lastOtherSignature=str(action.get("_lastOtherSignature") or ""),
                )
            return {
                "reply": f"已取消：{safe_text(str(item.get('label') or ''), 80)}",
                "cancelled": True,
            }

    def recover_model_action(self, terminal: BrowserTerminal, action: dict, message: str) -> dict | None:
        kind = str(action.get("action") or "").lower()
        reason = str(action.get("reason") or action.get("value") or "").lower()
        if is_recruiter_unsuitable_task(message):
            if kind in {"click", "done", "stop"}:
                target_candidate = extract_recruiter_unsuitable_candidate_name(message)
                return {
                    "action": "recruiter_mark_unsuitable",
                    "openUnreplied": False,
                    "targetCandidate": target_candidate,
                }
        if is_recruiter_basic_screening_task(message):
            if kind in {"click", "done", "stop"}:
                target_candidate = extract_recruiter_screen_candidate_name(message)
                batch_count = extract_recruiter_screen_batch_count(message)
                if (
                    should_process_all_unread_for_basic_screening(message)
                    or (should_open_unreplied_for_basic_screening(message) and batch_count > 1 and not target_candidate)
                ):
                    return {
                        "action": "recruiter_process_unread_all_positions",
                        "maxTotal": batch_count,
                    }
                return {
                    "action": "recruiter_process_current_position",
                    "targetCandidate": target_candidate,
                    "maxAttempts": batch_count,
                }
        if is_recruiter_common_phrase_task(message):
            if kind in {"click", "done", "stop"}:
                target_candidate = extract_recruiter_common_phrase_candidate_name(message)
                return {
                    "action": "recruiter_send_company_info",
                    "targetCandidate": target_candidate,
                }
        if is_recruiter_resume_request_task(message) or looks_like_recruiter_resume_request(message):
            if kind in {"click", "done", "stop"}:
                target_candidate = extract_recruiter_request_candidate_name(message)
                return {
                    "action": "recruiter_request_resume",
                    "openUnreplied": not bool(target_candidate),
                    "targetCandidate": target_candidate,
                }
        if kind in {"done", "stop"} and is_resume_upload_task(message):
            if any(word in reason for word in ("路径", "file", "pdf", "简历", "upload", "文件")):
                file_path = self.resolve_action_file("")
                return {"action": "upload", "target": "file", "value": file_path}
        if kind == "click":
            target = str(action.get("target") or action.get("query") or "")
            if is_resume_upload_task(message) and any(word in target for word in ("选择简历", "选择文件", "上传")):
                file_path = self.resolve_action_file("")
                return {"action": "upload", "target": "file", "value": file_path}
        return None

    @timed_agent_stage("route_builtin_task", "识别任务/进入内置流程")
    def try_builtin_task(self, terminal: BrowserTerminal, message: str, trace: list[dict]) -> dict | None:
        lowered = message.lower()
        if is_recruiter_proactive_contact_task(message):
            result = self.proactive_contact_recommended_candidates(
                terminal,
                target_position=extract_recruiter_target_position(message) or "应用技术经理（工业涂料领域）",
                max_total=extract_recruiter_batch_count(message) or 10,
                dry_run=("预览" in message or "只看" in message or "dry" in lowered),
            )
            trace.append({
                "step": len(trace) + 1,
                "thought": "用户要求在推荐牛人里主动联系候选人，已切换为招聘端主动联系 functioncall。",
                "actions": ["recruiter_proactive_contact_recommended_candidates"],
            })
            return {
                "reply": result.get("message") or "主动联系任务已完成。",
                "trace": trace,
                "files": self.files[-8:],
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
                "state": result.get("state"),
                "results": result.get("results"),
            }
        if is_recruiter_basic_screening_task(message):
            target_candidate = extract_recruiter_screen_candidate_name(message)
            batch_count = extract_recruiter_screen_batch_count(message)
            if False and should_watch_recent_contacts_for_basic_screening(message) and not target_candidate:
                result = self.screen_recent_recruiter_contacts_with_followup_watch(
                    terminal,
                    max_contacts=extract_recruiter_recent_watch_count(message),
                    idle_seconds=extract_recruiter_recent_watch_idle_seconds(message),
                )
                return {
                    "reply": result.get("message") or "已处理最近联系人并进入后续回复观察流程。",
                    "pendingAction": result.get("pendingAction"),
                    "trace": trace,
                    "files": self.files[-8:],
                    "page": {
                        "title": terminal.current_page().title(),
                        "url": terminal.current_page().url,
                    },
                    "state": result.get("state"),
                    "results": result.get("results"),
                    "followups": result.get("followups"),
                }
            target_position = extract_recruiter_target_position(message)
            date_scope = extract_recruiter_date_scope(message)
            if (
                (should_process_all_unread_for_basic_screening(message) and not target_candidate)
                or (should_open_unreplied_for_basic_screening(message) and not target_candidate)
            ):
                result = self.screen_all_recruiter_unread_basic_conditions(
                    terminal,
                    max_total=batch_count if batch_count > 1 else 80,
                    target_position=target_position,
                    date_scope=date_scope,
                )
                return {
                    "reply": result.get("message") or "已处理所有未读招聘消息。",
                    "pendingAction": result.get("pendingAction"),
                    "trace": trace,
                    "files": self.files[-8:],
                    "page": {
                        "title": terminal.current_page().title(),
                        "url": terminal.current_page().url,
                    },
                    "state": result.get("state"),
                    "results": result.get("results"),
                }
            if False and should_scan_recent_contacts_for_basic_screening(message) and not target_candidate:
                result = self.screen_recent_recruiter_basic_contacts(
                    terminal,
                    max_contacts=batch_count,
                )
                return {
                    "reply": result.get("message") or "已处理最近联系人基础条件筛选流程。",
                    "pendingAction": result.get("pendingAction"),
                    "trace": trace,
                    "files": self.files[-8:],
                    "page": {
                        "title": terminal.current_page().title(),
                        "url": terminal.current_page().url,
                    },
                    "state": result.get("state"),
                    "results": result.get("results"),
                }
            if False and should_open_unreplied_for_basic_screening(message) and batch_count > 1 and not target_candidate:
                result = self.screen_all_recruiter_unread_basic_conditions(
                    terminal,
                    max_total=batch_count,
                    target_position=target_position,
                    date_scope=date_scope,
                )
                return {
                    "reply": result.get("message") or "已批量处理未回复招聘消息。",
                    "pendingAction": result.get("pendingAction"),
                    "trace": trace,
                    "files": self.files[-8:],
                    "page": {
                        "title": terminal.current_page().title(),
                        "url": terminal.current_page().url,
                    },
                    "state": result.get("state"),
                    "results": result.get("results"),
                }
            result = self.screen_recruiter_basic_conditions(
                terminal,
                open_unreplied=False,
                target_candidate=target_candidate,
                max_attempts=batch_count,
            )
            return {
                "reply": result.get("message") or "已处理基础条件筛选流程。",
                "pendingAction": result.get("pendingAction"),
                "trace": trace,
                "files": self.files[-8:],
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
                "state": result.get("state"),
                "candidate": result.get("candidate"),
                "screening": result.get("screening"),
            }
        if is_recruiter_common_phrase_task(message):
            target_candidate = extract_recruiter_common_phrase_candidate_name(message)
            result = self.execute_action(terminal, {
                "action": "recruiter_send_company_info",
                "targetCandidate": target_candidate,
            })
            trace.append({
                "step": len(trace) + 1,
                "thought": "用户要发送公司/岗位基本情况，已切换为招聘端业务 functioncall。",
                "actions": ["recruiter_send_company_info"],
            })
            return {
                "reply": result.get("message") or "已处理公司情况发送流程。",
                "pendingAction": result.get("pendingAction"),
                "trace": trace,
                "files": self.files[-8:],
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
                "state": result.get("state"),
                "candidate": result.get("candidate"),
            }
        if is_recruiter_unsuitable_task(message):
            target_candidate = extract_recruiter_unsuitable_candidate_name(message)
            result = self.mark_recruiter_candidate_unsuitable(
                terminal,
                confirmed=False,
                open_unreplied=False,
                target_candidate=target_candidate,
            )
            return {
                "reply": result.get("message") or "已处理不合适流程。",
                "pendingAction": result.get("pendingAction"),
                "trace": trace,
                "files": self.files[-8:],
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
                "state": result.get("state"),
                "candidate": result.get("candidate"),
            }
        if is_recruiter_resume_request_task(message) or looks_like_recruiter_resume_request(message):
            target_candidates = extract_recruiter_request_candidate_names(message)
            batch_count = extract_recruiter_batch_count(message)
            if len(target_candidates) > 1:
                result = self.request_resume_for_named_candidates(terminal, target_candidates)
            elif batch_count > 1:
                result = self.request_resume_for_unreplied_candidates(terminal, batch_count)
            else:
                target_candidate = extract_recruiter_request_candidate_name(message)
                result = self.request_resume_from_recruiter_conversation(
                    terminal,
                    confirmed=False,
                    open_unreplied=not bool(target_candidate),
                    target_candidate=target_candidate,
                )
            return {
                "reply": result.get("message") or "已处理求简历流程。",
                "pendingAction": result.get("pendingAction"),
                "trace": trace,
                "files": self.files[-8:],
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
                "state": result.get("state"),
                "candidate": result.get("candidate"),
                "results": result.get("results"),
            }
        if is_auto_reply_command(message):
            result = self.auto_reply_chat_once(auto_send=("本地" in message and "自动发送" in message), force=True)
            return {
                "reply": result.get("reply") or result.get("message") or "已处理自动回复监听。",
                "pendingAction": result.get("pendingAction"),
                "trace": trace,
                "files": self.files[-8:],
                "page": result.get("page") or {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
            }
        if is_chat_resume_send_task(message):
            result = self.send_chat_resume_from_current_conversation(terminal, confirmed=False)
            return {
                "reply": result.get("message") or "已处理发送简历流程。",
                "pendingAction": result.get("pendingAction"),
                "trace": trace,
                "files": self.files[-8:],
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
                "state": result.get("state"),
            }

        if "boss" in lowered and any(word in message for word in ("挨个", "逐个", "批量", "群发", "群聊", "全聊", "跟所有人")):
            return self.boss_bulk_chat(terminal, message, trace)

        if not is_resume_upload_task(message):
            return None

        file_path = self.resolve_action_file(extract_windows_path(message) or "")
        file_name = Path(file_path).name

        trace.append({
            "step": 1,
            "thought": "这是上传简历类任务，使用内置执行器直接寻找文件输入框，避免系统级文件选择弹窗。",
            "actions": [f"select file {file_name}"],
            "results": [{"message": f"已选择文件：{file_path}"}],
        })

        terminal.current_page().wait_for_timeout(random.randint(120, 180))
        upload_result = self.smart_upload_to_page(terminal, file_path)
        trace.append({
            "step": 2,
            "thought": "后端直接设置页面中的 file input，不需要用户在系统文件窗口里手动选择。",
            "actions": [f"upload file = {file_path}"],
            "results": [upload_result],
        })

        terminal.current_page().wait_for_timeout(random.randint(450, 650))
        follow = self.try_click_followup_button(terminal)
        if follow:
            trace.append({
                "step": 3,
                "thought": "上传后发现页面上有可能继续解析/检测的按钮，自动推进下一步。",
                "actions": [follow["action"]],
                "results": [{"message": follow["message"]}],
            })
            terminal.current_page().wait_for_timeout(random.randint(550, 800))

        context = terminal.collect_page_context(limit=90)
        body = context.get("bodyTextPreview", "")
        summary = safe_text(body, 500) if body else "页面已更新，但没有读取到明显结果文本。"
        reply = f"我已经把 {file_name} 上传到当前页面了。{follow['message'] if follow else ''}\n\n当前页面状态：{summary}"
        return {
            "reply": reply.strip(),
            "trace": trace,
            "files": self.files[-8:],
            "page": {
                "title": terminal.current_page().title(),
                "url": terminal.current_page().url,
            },
        }

    def boss_bulk_chat(self, terminal: BrowserTerminal, message: str, trace: list[dict]) -> dict:
        """Semi-generic bulk chat runner.

        Assumptions:
        - User has already opened BOSS chat/message list page and filtered to the people to contact.
        - We only use the existing element cache (buttons/links) to iterate; we do NOT hardcode selectors.
        """

        # Parse optional placeholders from user message.
        job = ""
        m = re.search(r"岗位\s*[=:：]\s*([^\n\r]+)", message)
        if m:
            job = m.group(1).strip()

        auto_send = "自动发送" in message or "不需要确认" in message
        personalize = self.bulk_personalize or ("个性化" in message) or ("更智能" in message)
        rules = load_boss_chat_rules()

        trace.append({
            "step": 1,
            "thought": "进入批量聊天模式：遍历当前页面左侧会话/联系人列表，按规则分类并生成不同话术。",
            "actions": [
                f"load rules from {BOSS_RULES_FILE.name}",
                f"auto_send={auto_send}",
                f"max={self.bulk_max_chats}",
            ],
            "results": [],
        })

        visited: set[str] = set()
        sent = 0
        skipped = 0

        for i in range(self.bulk_max_chats):
            self.check_pause()
            context = terminal.collect_page_context(limit=120)
            body = str(context.get("bodyTextPreview") or "")
            if self.bulk_stop_on_captcha and any(word in body for word in ("验证码", "安全验证", "请完成验证")):
                return {
                    "reply": "检测到页面出现安全验证/验证码，我先停止批量聊天以避免触发风控。",
                    "trace": trace,
                    "page": {"title": context.get("title"), "url": context.get("url")},
                }

            # Pick a plausible conversation/contact entry from cached elements.
            candidates: list[tuple[int, str, str, int]] = []
            for item in terminal.cache:
                if item.kind not in {"link", "button"}:
                    continue
                label = (item.label or "").strip()
                if not label:
                    continue
                name, href = normalize_contact_label(label)
                if any(bad in label for bad in ("发送", "提交", "删除", "支付", "付款", "发布", "确认")):
                    continue
                key = href or name or label
                if key in visited:
                    continue
                # Prefer items that look like chat threads (have an href with chat-ish path)
                score = 0
                if href:
                    score += 10
                    if any(word in href.lower() for word in ("chat", "message", "im", "dialog")):
                        score += 10
                if name:
                    score += 2
                candidates.append((item.index, name or label, key, score))

            if not candidates:
                break

            # Deterministic but higher-score first
            candidates.sort(key=lambda t: (-t[3], t[0]))
            idx, label, key, _score = candidates[0]
            visited.add(key)

            step_no = len(trace) + 1
            trace.append({
                "step": step_no,
                "thought": f"打开会话并按规则分类：{label}",
                "actions": [f"click {idx}", "observe"],
                "results": [],
            })

            # Open conversation.
            open_result = self.execute_action(terminal, {"action": "click", "target": str(idx)})
            trace[-1]["results"].append(open_result)
            if open_result.get("blocked"):
                skipped += 1
                continue

            terminal.current_page().wait_for_timeout(random.randint(*self.bulk_delay_ms_range))
            chat_context = self.read_chat_context(terminal)
            applied_position = str(chat_context.get("appliedPosition") or "")
            position_reply = chat_context.get("positionReply") if isinstance(chat_context.get("positionReply"), dict) else {}
            if position_reply.get("template"):
                category = str(position_reply.get("category") or "position")
                template = str(position_reply.get("template") or "")
            else:
                category, template = classify_boss_chat(chat_context, rules)
            base_text = template.replace("{job}", job or applied_position or "岗位")
            text = base_text
            if personalize and has_model_key():
                try:
                    text = ask_agent_model_for_message(
                        category=category,
                        template=base_text,
                        context=chat_context,
                        job=job or applied_position or "",
                    ) or base_text
                except Exception:
                    text = base_text

            # Fill draft.
            try:
                filled_label = self.smart_fill(terminal, "聊天", text)
                trace[-1]["results"].append({"message": f"分类={category}；已填写草稿：{safe_text(filled_label, 80)}"})
            except Exception as error:
                trace[-1]["results"].append({"blocked": True, "message": f"填写失败：{error}"})
                skipped += 1
                continue

            if not auto_send or self.require_confirm_send_message:
                pending = self.create_send_confirmation()
                trace[-1]["results"].append({"confirmRequired": True, "pendingAction": pending, "message": "已生成并填入草稿，等待你确认发送。"})
                return {
                    "reply": "已为当前会话生成并填入不同话术草稿，等待你确认发送（确认后可继续下一位）。",
                    "trace": trace,
                    "pendingAction": pending,
                    "page": {"title": chat_context.get("title"), "url": chat_context.get("url")},
                }

            # Auto send.
            send_action = find_send_action(terminal)
            send_result = self.execute_action(terminal, send_action)
            trace[-1]["results"].append(send_result)
            if send_result.get("blocked"):
                skipped += 1
            else:
                sent += 1

            terminal.current_page().wait_for_timeout(random.randint(*self.bulk_delay_ms_range))

        return {
            "reply": f"批量聊天已结束：已处理 {len(visited)} 个条目，自动发送 {sent}，跳过/失败 {skipped}。",
            "trace": trace,
            "page": {
                "title": terminal.current_page().title(),
                "url": terminal.current_page().url,
            },
        }

    def smart_upload_to_page(self, terminal: BrowserTerminal, file_path: str) -> dict:
        page = terminal.current_page()
        inputs = page.locator("input[type=file]")
        count = inputs.count()
        if count <= 0:
            raise AgentError("当前页面没有找到 file input，无法绕开系统文件选择窗口上传。")

        preferred = None
        for index in range(count):
            item = inputs.nth(index)
            label = describe_file_input(item)
            if any(word in label.lower() for word in ("resume", "简历", "pdf", "file")):
                preferred = item
                break
        locator = preferred or inputs.first
        locator.set_input_files(file_path, timeout=10000)
        self.add_event("action", f"已上传文件：{Path(file_path).name}")
        return {"message": f"已上传文件：{Path(file_path).name}"}

    def try_click_followup_button(self, terminal: BrowserTerminal) -> dict | None:
        context = terminal.collect_page_context(limit=90)
        keywords = ("开始解析", "解析简历", "开始检测", "检测", "匹配", "分析", "提交解析")
        for item in terminal.cache:
            if item.kind != "button":
                continue
            label = item.label
            if any(keyword in label for keyword in keywords) and (
                (not self.require_confirm_dangerous_clicks) or (not is_dangerous(label))
            ):
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(item.locator)
                humanized_locator_click(terminal, item.locator)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                message = f"已点击后续按钮：{safe_text(label, 80)}"
                self.add_event("action", message)
                return {"action": f"click {label}", "message": message}
        return None

    def apply_message_options(self, terminal: BrowserTerminal, message: str) -> None:
        lower = message.lower()
        if "慢一点" in message or "慢速" in message or "slow" in lower:
            terminal.pace = "slow"
        elif "快一点" in message or "快速" in message or "fast" in lower:
            terminal.pace = "fast"
        if "关闭鼠标" in message:
            terminal.visual_cursor = False
        if "显示鼠标" in message or "可视化" in message:
            terminal.visual_cursor = True
        if "关闭拟人" in message:
            terminal.humanize = False
        if "拟人" in message or "像真人" in message:
            terminal.humanize = True

    def enrich_task_with_files(self, message: str) -> str:
        if mentions_file(message) and not contains_windows_path(message):
            latest = self.latest_file()
            if latest:
                return (
                    f"{message}\n"
                    f"可用文件：{latest['name']}，fileId={latest['id']}，本地绝对路径={latest['path']}。"
                )
            candidates = self.scan_local_resumes(query=message, limit=8)
            if candidates:
                lines = [
                    f"{item['name']} | 本地绝对路径={item['path']} | 修改时间={item['mtimeText']}"
                    for item in candidates[:5]
                ]
                return (
                    f"{message}\n"
                    "用户授权你在常用目录中扫描本地简历候选文件。"
                    "如果用户没有指定具体文件，请选择候选列表中最像简历且最近修改的一份，不要再要求用户提供路径。\n"
                    "候选文件：\n" + "\n".join(lines)
                )
        return message

    @timed_agent_stage("execute_action", "执行页面动作")
    def execute_action(self, terminal: BrowserTerminal, action: dict) -> dict:
        self.check_pause()
        kind = str(action.get("action") or "").lower()
        target = str(action.get("target") or action.get("query") or "").strip()
        value = str(action.get("value") or "").strip()

        try:
            if kind == "observe_page_summary":
                context = terminal.collect_page_context(limit=90)
                context["fileInputs"] = self.collect_file_inputs(terminal)
                compact = compact_context_for_model(context, target or value)
                return {
                    "message": f"Observed compact page summary: {compact.get('title', '')}",
                    "context": compact,
                }

            if kind == "find_element":
                matches = find_elements_for_query(terminal, target or value)
                self.last_find_element_matches = matches
                return {
                    "message": f"Found {len(matches)} matching element(s).",
                    "matches": matches,
                }

            if kind == "verify_result":
                check_text = value or target
                page_text = safe_eval(terminal.current_page(), "() => document.body ? document.body.innerText : ''") or ""
                matched = bool(check_text) and check_text.lower() in page_text.lower()
                return {
                    "message": "Verification matched." if matched else "Verification did not match yet.",
                    "matched": matched,
                    "expected": check_text,
                    "textPreview": safe_text(page_text, 500),
                }

            if kind == "recover_from_error":
                context = terminal.collect_page_context(limit=90)
                context["fileInputs"] = self.collect_file_inputs(terminal)
                compact = compact_context_for_model(context, target or value)
                return {
                    "message": "Recovered by refreshing compact observation.",
                    "context": compact,
                }

            if kind == "chat_read_context":
                context = self.read_chat_context(terminal)
                return {"message": context["summary"], "context": context}

            if kind == "chat_load_history":
                rounds = int(value or target or CHAT_HISTORY_SCROLL_ROUNDS)
                history = self.load_chat_history(terminal, max_rounds=max(1, min(20, rounds)))
                context = self.read_chat_context(terminal, history=history)
                return {
                    "message": f"已尝试向上加载聊天历史：{history.get('rounds', 0)} 轮，读取约 {len(history.get('text', ''))} 字。",
                    "history": history,
                    "context": context,
                }

            if kind == "chat_find_input":
                _, label = find_best_editable(terminal, target or "聊天")
                return {"message": f"已找到聊天输入框：{safe_text(label, 80)}"}

            if kind == "chat_fill_draft":
                draft = value or str(action.get("message") or action.get("draft") or action.get("text") or "").strip()
                label = self.smart_fill(terminal, target or "聊天", draft)
                if self.require_confirm_send_message or not is_local_browser_page(terminal):
                    pending = self.create_send_confirmation()
                    return {
                        "confirmRequired": True,
                        "pendingAction": pending,
                        "message": f"已把回复草稿填入：{safe_text(label, 80)}。需要你确认后再发送。",
                    }
                click_result = click_current_chat_send_button(terminal)
                return {
                    "message": f"已把回复草稿填入：{safe_text(label, 80)}。{click_result.get('message', '已尝试发送。')}",
                    "send": click_result,
                }

            if kind == "chat_request_send_confirmation":
                # This tool should only be used when the backend requires confirmation.
                if not self.require_confirm_send_message:
                    return {
                        "blocked": True,
                        "message": "当前配置不需要发送确认。请直接使用 chat_fill_draft 生成并发送消息。",
                    }

                if self.require_confirm_send_message:
                    pending = self.create_send_confirmation()
                    return {
                        "confirmRequired": True,
                        "pendingAction": pending,
                        "message": f"需要你确认后再执行：{safe_text(pending['label'], 80)}",
                    }
                click_result = click_current_chat_send_button(terminal)
                return {"message": click_result.get("message", "已尝试发送。"), "send": click_result}

            if kind == "chat_send_resume":
                return self.send_chat_resume_from_current_conversation(
                    terminal,
                    confirmed=bool(action.get("_confirmed")),
                )

            if kind == "recruiter_send_company_info":
                target_candidate = str(
                    action.get("targetCandidate")
                    or action.get("candidate")
                    or action.get("candidateName")
                    or ""
                ).strip()
                return self.send_recruiter_common_phrase(
                    terminal,
                    phrase_key="basic_conditions",
                    target_candidate=target_candidate,
                )

            if kind == "recruiter_send_common_phrase":
                target_candidate = str(
                    action.get("targetCandidate")
                    or action.get("candidate")
                    or action.get("candidateName")
                    or ""
                ).strip()
                phrase = str(
                    action.get("phrase")
                    or action.get("value")
                    or action.get("text")
                    or action.get("message")
                    or ""
                ).strip()
                phrase_key = str(action.get("phraseKey") or action.get("key") or "").strip()
                return self.send_recruiter_common_phrase(
                    terminal,
                    phrase=phrase,
                    phrase_key=phrase_key,
                    target_candidate=target_candidate,
                )

            if kind == "recruiter_proactive_contact_recommended_candidates":
                return self.proactive_contact_recommended_candidates(
                    terminal,
                    target_position=str(
                        action.get("targetPosition")
                        or action.get("position")
                        or "应用技术经理（工业涂料领域）"
                    ),
                    max_total=int(action.get("maxTotal") or action.get("count") or action.get("limit") or 10),
                    dry_run=bool(action.get("dryRun", False)),
                    require_match=bool(action.get("requireMatch", False)),
                )

            if kind == "recruiter_process_unread_all_positions":
                return self.screen_all_recruiter_unread_basic_conditions(
                    terminal,
                    max_total=int(action.get("maxTotal") or action.get("count") or action.get("limit") or 80),
                    target_position=str(action.get("targetPosition") or action.get("position") or ""),
                    date_scope=str(action.get("dateScope") or action.get("scope") or ""),
                )

            if kind == "recruiter_process_current_position":
                target_candidate = str(
                    action.get("targetCandidate")
                    or action.get("candidate")
                    or action.get("candidateName")
                    or ""
                ).strip()
                return self.screen_recruiter_basic_conditions(
                    terminal,
                    open_unreplied=bool(action.get("openUnreplied", False)),
                    target_candidate=target_candidate,
                    max_attempts=int(action.get("maxAttempts") or action.get("count") or action.get("limit") or 5),
                )

            if kind == "recruiter_answer_candidate_questions":
                target_candidate = str(
                    action.get("targetCandidate")
                    or action.get("candidate")
                    or action.get("candidateName")
                    or ""
                ).strip()
                return self.answer_current_recruiter_questions(
                    terminal,
                    target_candidate=target_candidate,
                )

            if kind == "recruiter_screen_basic_conditions":
                return {
                    "blocked": True,
                    "message": "旧入口 recruiter_screen_basic_conditions 已删除；请使用 recruiter_process_unread_all_positions 或 recruiter_process_current_position。",
                }

            if kind == "recruiter_screen_recent_with_followup":
                return {
                    "blocked": True,
                    "message": "旧入口 recruiter_screen_recent_with_followup 已删除；请使用全岗位未读处理或四账号监听流程。",
                }

            if kind == "recruiter_request_resume":
                target_candidate = str(
                    action.get("targetCandidate")
                    or action.get("candidate")
                    or action.get("candidateName")
                    or ""
                ).strip()
                target_candidates = extract_recruiter_candidate_names_from_text(target_candidate)
                if len(target_candidates) > 1:
                    return self.request_resume_for_named_candidates(terminal, target_candidates)
                return self.request_resume_from_recruiter_conversation(
                    terminal,
                    confirmed=bool(action.get("_confirmed")),
                    open_unreplied=not bool(action.get("_confirmed"))
                    and bool(action.get("openUnreplied", not bool(target_candidate))),
                    expected_candidate=str(action.get("_candidateLabel") or ""),
                    target_candidate=target_candidate,
                )

            if kind == "recruiter_confirm_resume_request":
                return self.confirm_recruiter_resume_request(
                    terminal,
                    expected_candidate=str(action.get("_candidateLabel") or ""),
                )

            if kind == "recruiter_mark_unsuitable":
                target_candidate = str(
                    action.get("targetCandidate")
                    or action.get("candidate")
                    or action.get("candidateName")
                    or ""
                ).strip()
                return self.mark_recruiter_candidate_unsuitable(
                    terminal,
                    confirmed=bool(action.get("_confirmed")),
                    open_unreplied=not bool(action.get("_confirmed"))
                    and bool(action.get("openUnreplied", False)),
                    expected_candidate=str(action.get("_candidateLabel") or ""),
                    target_candidate=target_candidate,
                )

            if kind == "recruiter_confirm_unsuitable":
                return self.confirm_recruiter_unsuitable(
                    terminal,
                    expected_candidate=str(action.get("_candidateLabel") or ""),
                )

            if kind == "job51_process_unread_all_positions":
                return self.with_job51_terminal(
                    lambda job51_terminal: self.job51_process_unread_all_positions(
                        job51_terminal,
                        max_total=int(action.get("maxTotal") or action.get("count") or action.get("limit") or 40),
                        target_position=str(action.get("targetPosition") or action.get("position") or ""),
                    )
                )

            if kind == "job51_process_current_position":
                return self.with_job51_terminal(
                    lambda job51_terminal: self.job51_process_current_position(job51_terminal, opened=None)
                )

            if kind == "job51_answer_candidate_questions":
                return self.with_job51_terminal(
                    lambda job51_terminal: self.job51_answer_current_candidate_questions(job51_terminal)
                )

            if kind == "job51_request_resume":
                return self.with_job51_terminal(
                    lambda job51_terminal: self.job51_download_attachment_or_request_resume(job51_terminal)
                )

            if kind == "job51_proactive_contact_recommended_candidates":
                return self.with_job51_terminal(
                    lambda job51_terminal: self.job51_proactive_contact_recommended_candidates(
                        job51_terminal,
                        target_position=str(action.get("targetPosition") or action.get("position") or ""),
                        max_total=int(action.get("maxTotal") or action.get("count") or action.get("limit") or 10),
                        dry_run=bool(action.get("dryRun", False)),
                    )
                )

            if kind == "zhilian_process_unread_all_positions":
                return self.with_zhilian_terminal(
                    lambda zhilian_terminal: self.zhilian_process_unread_all_positions(
                        zhilian_terminal,
                        max_total=int(action.get("maxTotal") or action.get("count") or action.get("limit") or 40),
                        target_position=str(action.get("targetPosition") or action.get("position") or ""),
                    )
                )

            if kind == "zhilian_process_current_position":
                return self.with_zhilian_terminal(
                    lambda zhilian_terminal: self.zhilian_process_current_position(zhilian_terminal, opened=None)
                )

            if kind == "zhilian_answer_candidate_questions":
                return self.with_zhilian_terminal(
                    lambda zhilian_terminal: self.zhilian_answer_current_candidate_questions(zhilian_terminal)
                )

            if kind == "zhilian_request_resume":
                return self.with_zhilian_terminal(
                    lambda zhilian_terminal: self.zhilian_request_resume_from_current_conversation(zhilian_terminal)
                )

            if kind == "zhilian_proactive_contact_recommended_candidates":
                return self.with_zhilian_terminal(
                    lambda zhilian_terminal: self.zhilian_proactive_contact_recommended_candidates(
                        zhilian_terminal,
                        target_position=str(action.get("targetPosition") or action.get("position") or ""),
                        max_total=int(action.get("maxTotal") or action.get("count") or action.get("limit") or 10),
                        dry_run=bool(action.get("dryRun", False)),
                    )
                )

            if kind == "click":
                # If the model uses placeholder text like "(以上 find_element 返回的 index)",
                # automatically resolve it to the first match index.
                target = resolve_index_placeholder(target, self.last_find_element_matches)
                if is_unresolved_index_placeholder(target):
                    if is_recruiter_unsuitable_task(target):
                        target_candidate = extract_recruiter_unsuitable_candidate_name(target)
                        return self.mark_recruiter_candidate_unsuitable(
                            terminal,
                            confirmed=False,
                            open_unreplied=False,
                            target_candidate=target_candidate,
                        )
                    if is_recruiter_resume_request_task(target) or looks_like_recruiter_resume_request(target):
                        target_candidates = extract_recruiter_request_candidate_names(target)
                        if len(target_candidates) > 1:
                            return self.request_resume_for_named_candidates(terminal, target_candidates)
                        target_candidate = extract_recruiter_request_candidate_name(target)
                        return self.request_resume_from_recruiter_conversation(
                            terminal,
                            confirmed=False,
                            open_unreplied=not bool(target_candidate),
                            target_candidate=target_candidate,
                        )
                    return {
                        "blocked": True,
                        "message": "模型返回了占位符目标（find_element 返回的 index），但当前没有可用匹配结果。我已停止这次错误点击，请重新观察页面或直接使用聊天自动回复。",
                    }
                # Ensure cache is fresh before using numeric indices.
                if target.isdigit():
                    terminal.collect_page_context(limit=120)
                locator, label = terminal.find_locator(target)
                if (
                    self.require_confirm_dangerous_clicks
                    and is_dangerous(label)
                    and not is_whitelisted_send_button(label)
                    and not action.get("_confirmed")
                ):
                    pending = self.create_pending_action(action, label)
                    return {
                        "blocked": True,
                        "confirmRequired": True,
                        "pendingAction": pending,
                        "message": f"需要你确认后再执行：{safe_text(label, 80)}",
                    }
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                    if is_local_browser_page(terminal):
                        terminal.maybe_scroll_wiggle()
                        self.post_action_idle(terminal)
                message = f"已点击：{safe_text(label, 80)}"
                self.add_event("action", message)
                return {"message": message}

            if kind == "fill":
                label = self.smart_fill(terminal, target, value)
                return {"message": f"已填写：{safe_text(label, 80)}"}

            if kind == "upload":
                file_path = self.resolve_action_file(value)
                terminal.upload(target or "file", file_path)
                self.post_action_idle(terminal)
                message = f"已上传文件：{Path(file_path).name}"
                self.add_event("action", message)
                return {"message": message}

            if kind == "press":
                terminal.press(value or target or "Enter")
                self.post_action_idle(terminal)
                return {"message": f"已按键：{value or target or 'Enter'}"}

            if kind == "wait":
                ms = int(value or target or "1000")
                terminal.current_page().wait_for_timeout(ms)
                return {"message": f"已等待 {ms} ms"}

            if kind == "scroll":
                amount = int(value or target or "600")
                page = terminal.current_page()
                if not terminal.humanize:
                    page.mouse.wheel(0, amount)
                    return {"message": f"已滚动 {amount} px"}

                humanized_scroll(terminal, amount)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                return {"message": f"已拟人化滚动 {amount} px"}

            if kind == "goto":
                terminal.goto(value or target)
                return {"message": f"已打开：{value or target}"}

            if kind == "observe":
                self.observe()
                return {"message": "已重新观察页面"}

            if kind in {"done", "stop"}:
                return {
                    "done": True,
                    "message": str(action.get("reason") or "任务已完成。"),
                }

            return {"message": f"暂不支持的动作：{json.dumps(action, ensure_ascii=False)}"}
        except Exception as error:
            self.add_event("error", str(error))
            return {"blocked": True, "message": f"执行失败：{error}"}

    @timed_agent_stage("load_chat_history", "加载聊天历史")
    def load_chat_history(self, terminal: BrowserTerminal, max_rounds: int = CHAT_HISTORY_SCROLL_ROUNDS) -> dict:
        page = terminal.current_page()
        token = f"codex_chat_history_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        init = self.measure_current_timing_stage("find_chat_history_container", "查找聊天历史容器", lambda: safe_eval(page, f"""() => {{
          const token = {json.dumps(token)};
          const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const visible = (el) => {{
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 120 && box.height > 100 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
          }};
          const selector = [
            "main",
            "section",
            "ul",
            "[role='main']",
            "[class*='chat' i]",
            "[class*='message' i]",
            "[class*='dialog' i]",
            "[class*='conversation' i]",
            "[class*='im' i]",
            "[class*='history' i]",
            "[class*='content' i]",
            "[class*='scroll' i]",
            "[class*='list' i]"
          ].join(",");
          const nodes = Array.from(new Set(Array.from(document.body ? document.body.querySelectorAll(selector) : [])));
          let best = null;
          let bestScore = 0;
          const vw = window.innerWidth || 1280;
          for (const el of nodes) {{
            if (!visible(el)) continue;
            const box = el.getBoundingClientRect();
            const rawText = el.innerText || el.textContent || "";
            const text = normalize(rawText.length > 6000 ? rawText.slice(-6000) : rawText);
            if (text.length < 8) continue;
            const cls = String(el.className || "");
            const role = String(el.getAttribute("role") || "");
            let score = 0;
            if (box.x > vw * 0.25) score += 120;
            if (box.width >= 300 && box.height >= 180) score += 80;
            if (el.scrollHeight > el.clientHeight + 30) score += 180;
            if (/chat|message|dialog|conversation|im|history|content|scroll|list/i.test(cls + " " + role)) score += 90;
            if (text.includes("发送") || text.includes("输入")) score -= 15;
            if (text.includes("全部") && text.includes("未读") && text.includes("新招呼")) score -= 260;
            if (box.x < vw * 0.22) score -= 140;
            if (score > bestScore) {{
              best = el;
              bestScore = score;
            }}
          }}
          if (!best) return {{ found: false, text: normalize(document.body ? document.body.innerText : "") }};
          best.setAttribute("data-codex-chat-history", token);
          const box = best.getBoundingClientRect();
          return {{
            found: true,
            token,
            score: bestScore,
            text: normalize(String(best.innerText || best.textContent || "").slice(-6000)),
            x: Math.round(box.x),
            y: Math.round(box.y),
            w: Math.round(box.width),
            h: Math.round(box.height),
            scrollTop: Math.round(best.scrollTop || 0),
            scrollHeight: Math.round(best.scrollHeight || 0),
            clientHeight: Math.round(best.clientHeight || 0),
            className: String(best.className || "").slice(0, 120)
          }};
        }}""") or {})
        if not isinstance(init, dict) or not init.get("found"):
            return {
                "loaded": False,
                "rounds": 0,
                "text": safe_text(str((init or {}).get("text") or ""), 3000) if isinstance(init, dict) else "",
                "reason": "没有找到可滚动的聊天历史容器。",
            }

        locator = page.locator(f"[data-codex-chat-history='{token}']").first
        stable_rounds = 0
        rounds_done = 0
        last_text = str(init.get("text") or "")
        last_scroll_height = int(init.get("scrollHeight") or 0)
        try:
            box = locator.bounding_box(timeout=2000)
        except Exception:
            box = None

        for _ in range(max_rounds):
            rounds_done += 1
            round_started = time.time()
            try:
                before = locator.evaluate(
                    """el => ({
                      text: String(el.innerText || el.textContent || "").slice(-6000).replace(/\\s+/g, " ").trim(),
                      top: Math.round(el.scrollTop || 0),
                      height: Math.round(el.scrollHeight || 0),
                      client: Math.round(el.clientHeight || 0)
                    })"""
                )
            except Exception:
                break

            if box:
                try:
                    humanized_scroll(
                        terminal,
                        -random.randint(650, 1150),
                        box=box,
                        corrective=random.random() < 0.35,
                    )
                except Exception:
                    pass
            try:
                locator.evaluate(
                    """el => {
                      const amount = Math.max(260, Math.floor((el.clientHeight || 500) * 0.85));
                      el.scrollTop = Math.max(0, (el.scrollTop || 0) - amount);
                      el.dispatchEvent(new Event("scroll", { bubbles: true }));
                      el.dispatchEvent(new WheelEvent("wheel", { deltaY: -amount, bubbles: true, cancelable: true }));
                    }"""
                )
            except Exception:
                pass
            page.wait_for_timeout(random.randint(650, 1050))

            try:
                after = locator.evaluate(
                    """el => ({
                      text: String(el.innerText || el.textContent || "").slice(-6000).replace(/\\s+/g, " ").trim(),
                      top: Math.round(el.scrollTop || 0),
                      height: Math.round(el.scrollHeight || 0),
                      client: Math.round(el.clientHeight || 0)
                    })"""
                )
            except Exception:
                break

            after_text = str(after.get("text") or "")
            after_height = int(after.get("height") or 0)
            at_top = int(after.get("top") or 0) <= 4
            changed = after_text != last_text or after_height != last_scroll_height
            last_text = after_text
            last_scroll_height = after_height
            if at_top and not changed:
                stable_rounds += 1
            else:
                stable_rounds = 0
            if stable_rounds >= 2:
                self.record_current_timing_stage(
                    "load_chat_history_scroll_round",
                    "聊天历史滚动加载一轮",
                    round_started,
                    ok=True,
                    extra={"round": rounds_done, "stable": stable_rounds, "atTop": at_top},
                )
                break
            self.record_current_timing_stage(
                "load_chat_history_scroll_round",
                "聊天历史滚动加载一轮",
                round_started,
                ok=True,
                extra={"round": rounds_done, "stable": stable_rounds, "atTop": at_top},
            )

        try:
            restore_started = time.time()
            locator.evaluate(
                """el => {
                  el.scrollTop = el.scrollHeight || el.scrollTop || 0;
