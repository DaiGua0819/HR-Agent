                  el.dispatchEvent(new Event("scroll", { bubbles: true }));
                }"""
            )
            page.wait_for_timeout(random.randint(350, 650))
            self.record_current_timing_stage("restore_chat_history_bottom", "聊天历史回到底部", restore_started, ok=True)
        except Exception:
            self.record_current_timing_stage("restore_chat_history_bottom", "聊天历史回到底部", restore_started, ok=False)
            pass

        return {
            "loaded": True,
            "rounds": rounds_done,
            "text": safe_text(last_text, 5000),
            "container": {
                "score": init.get("score"),
                "x": init.get("x"),
                "y": init.get("y"),
                "w": init.get("w"),
                "h": init.get("h"),
                "className": init.get("className"),
            },
        }

    def extract_chat_messages(self, terminal: BrowserTerminal) -> list[dict]:
        page = terminal.current_page()
        messages = safe_eval(page, """() => {
          const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const visible = (el) => {
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
          };
          const cleanText = (text, time, status) => {
            let value = normalize(text);
            if (time && value.startsWith(time)) value = normalize(value.slice(time.length));
            if (status && value.startsWith(status)) value = normalize(value.slice(status.length));
            return value;
          };
          const rows = Array.from(document.querySelectorAll("li.message-item, [class*='message-item' i]"));
          const out = [];
          const vw = window.innerWidth || 1280;
          for (const row of rows) {
            if (!visible(row)) continue;
            const box = row.getBoundingClientRect();
            const cls = String(row.className || "");
            const raw = normalize(row.innerText || row.textContent || "");
            if (!raw || raw.length < 1) continue;
            const timeNode = row.querySelector(".item-time, [class*='time' i]");
            const statusNode = row.querySelector(".message-status, [class*='status' i]");
            const mineNode = row.querySelector(".item-myself, [class*='item-myself' i], [class*='myself' i]");
            const friendNode = row.querySelector(".item-friend, [class*='item-friend' i], [class*='friend' i]");
            const contentRoot = mineNode || friendNode || row;
            const textNode = contentRoot.querySelector(".text") || contentRoot.querySelector(".message-content") || contentRoot;
            const time = normalize(timeNode ? (timeNode.innerText || timeNode.textContent || "") : "");
            const status = normalize(statusNode ? (statusNode.innerText || statusNode.textContent || "") : "");
            let text = cleanText(textNode ? (textNode.innerText || textNode.textContent || "") : raw, time, status);
            if (!text || text === time || text === status) {
              text = cleanText(raw, time, status);
            }
            if (!text || text === time || text === status) continue;
            let sender = "unknown";
            const low = cls.toLowerCase();
            if (mineNode || low.includes("item-myself") || low.includes("myself") || low.includes("self") || low.includes("mine")) {
              sender = "me";
            } else if (friendNode || low.includes("item-friend") || low.includes("friend") || low.includes("other")) {
              sender = "other";
            } else {
              sender = box.x + box.width * 0.5 > vw * 0.55 ? "me" : "other";
            }
            out.push({
              sender,
              text,
              rawText: raw,
              status,
              time,
              className: cls.slice(0, 120),
              x: Math.round(box.x),
              y: Math.round(box.y),
              w: Math.round(box.width),
              h: Math.round(box.height)
            });
          }
          out.sort((a, b) => a.y - b.y || a.x - b.x);
          return out.slice(-120);
        }""")
        if not isinstance(messages, list):
            return []
        normalized = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            text_value = safe_text(str(item.get("text") or "").strip(), 500)
            if not text_value:
                continue
            sender = str(item.get("sender") or "unknown")
            if sender not in {"me", "other", "unknown"}:
                sender = "unknown"
            normalized.append({
                "sender": sender,
                "text": text_value,
                "status": safe_text(str(item.get("status") or ""), 30),
                "time": safe_text(str(item.get("time") or ""), 30),
                "rawText": safe_text(str(item.get("rawText") or ""), 600),
                "className": safe_text(str(item.get("className") or ""), 120),
                "x": item.get("x"),
                "y": item.get("y"),
            })
        return normalized

    def infer_boss_applied_position_from_label(self, label: str, rules: dict | None = None) -> str:
        label_clean = clean_applied_position(label)
        if not label_clean:
            return ""
        rules = rules if isinstance(rules, dict) else load_boss_chat_rules()
        candidates: list[str] = []
        configured = rules.get("positionReplies") or rules.get("position_replies") or rules.get("jobReplies") or rules.get("job_replies")
        if isinstance(configured, dict):
            candidates.extend(str(key or "") for key in configured.keys())
            for item in configured.values():
                if isinstance(item, dict):
                    aliases = item.get("aliases") if isinstance(item.get("aliases"), list) else []
                    match_positions = item.get("matchPositions") if isinstance(item.get("matchPositions"), list) else []
                    candidates.extend(str(value or "") for value in aliases + match_positions)
        kb = rules.get("companyKnowledgeBase") if isinstance(rules.get("companyKnowledgeBase"), dict) else {}
        sections = kb.get("sections") if isinstance(kb.get("sections"), dict) else {}
        for title, section in sections.items():
            candidates.append(str(title or ""))
            if isinstance(section, dict):
                aliases = section.get("aliases") if isinstance(section.get("aliases"), list) else []
                match_positions = section.get("matchPositions") if isinstance(section.get("matchPositions"), list) else []
                candidates.extend(str(value or "") for value in aliases + match_positions)
        label_compact = compact_conversation_label(label_clean).lower()
        clean_candidates: list[str] = []
        for value in candidates:
            clean = clean_applied_position(value)
            if clean and clean not in clean_candidates:
                clean_candidates.append(clean)
        for candidate in sorted(clean_candidates, key=len, reverse=True):
            candidate_compact = compact_conversation_label(candidate).lower()
            if candidate_compact and (
                candidate_compact in label_compact
                or label_compact in candidate_compact
                or candidate in label_clean
            ):
                return candidate
        return ""

    def read_current_applicant_context(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        info = safe_eval(page, r"""() => {
          const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
          const visible = (el) => {
            if (!el) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 10 && box.height > 8 && box.bottom > 0 && box.y < window.innerHeight
              && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
          };
          const selected = Array.from(document.querySelectorAll([
            ".geek-item.selected",
            ".geek-item.active",
            ".geek-item.current",
            ".geek-item.cur",
            ".geek-item.checked",
            "[class*='geek-item'][class*='selected']",
            "[class*='geek-item'][class*='active']",
            "[class*='geek-item'][class*='current']",
            "[class*='geek-item'][class*='cur']",
            "[class*='geek-item'][class*='checked']",
            "[class*='listitem'][class*='selected']",
            "[class*='listitem'][class*='active']",
            "[class*='geek'][aria-selected='true']",
            "[class*='listitem'][aria-selected='true']"
          ].join(","))).map((el) => el.closest(".geek-item-wrap") || el.closest(".geek-item") || el)
            .find(visible);
          const row = selected || null;
          const text = normalize(row ? (row.innerText || row.textContent || "") : "");
          const nameNode = row ? row.querySelector(".geek-name, [class*='geek-name'], [class*='name']") : null;
          const jobNode = row ? row.querySelector(".source-job, [class*='source-job']") : null;
          let name = normalize(nameNode ? (nameNode.innerText || nameNode.textContent || "") : "");
          let appliedPosition = normalize(jobNode ? (jobNode.innerText || jobNode.textContent || "") : "");

          if (!name || !appliedPosition) {
            let core = text.replace(/^\d+\s+/, "").replace(/^\d{1,2}:\d{2}\s+/, "");
            if (!name) {
              const nameMatch = core.match(/^([\u4e00-\u9fffA-Za-z·]{2,8})\s+/);
              if (nameMatch) name = nameMatch[1];
            }
            if (!appliedPosition && name && core.startsWith(name)) {
              const rest = normalize(core.slice(name.length));
              const stopMatch = rest.match(/^(.{2,30}?)(?:\s+(?:您好|你好|BOSS|Boss|HR|Hr|[^\s]+\.pdf)|$)/);
              if (stopMatch) appliedPosition = normalize(stopMatch[1]);
            }
          }

          const headerNodes = Array.from(document.querySelectorAll(
            ".chat-title, .chat-header, [class*='chat-title'], [class*='conversation-header'], [class*='detail']"
          )).filter(visible).map((el) => normalize(el.innerText || el.textContent || "")).filter(Boolean);
          const rowBox = row ? row.getBoundingClientRect() : null;
          return {
            name,
            appliedPosition,
            label: text,
            headers: headerNodes.slice(0, 8),
            source: row ? "selected-geek-item" : "",
            x: rowBox ? Math.round(rowBox.x) : null,
            y: rowBox ? Math.round(rowBox.y) : null
          };
        }""")
        if not isinstance(info, dict):
            return {}
        applied_position = clean_applied_position(str(info.get("appliedPosition") or ""))
        inferred_position = self.infer_boss_applied_position_from_label(str(info.get("label") or ""))
        if inferred_position and (
            not applied_position
            or inferred_position in applied_position
            or applied_position in inferred_position
            or len(applied_position) > 40
        ):
            applied_position = inferred_position
        return {
            "name": safe_text(str(info.get("name") or ""), 40),
            "appliedPosition": applied_position,
            "label": safe_text(str(info.get("label") or ""), 180),
            "headers": info.get("headers") if isinstance(info.get("headers"), list) else [],
            "source": safe_text(str(info.get("source") or ""), 40),
            "x": info.get("x"),
            "y": info.get("y"),
        }

    @timed_agent_stage("read_chat_context", "读取聊天记录")
    def read_chat_context(self, terminal: BrowserTerminal, history: dict | None = None) -> dict:
        page = terminal.current_page()
        text = safe_eval(page, "() => document.body ? document.body.innerText : ''") or ""
        detail = safe_eval(page, """() => {
          const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
          const visible = (el) => {
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 120 && box.height > 80 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
          };
          const selector = [
            "main",
            "section",
            "[role='main']",
            "[class*='chat' i]",
            "[class*='message' i]",
            "[class*='dialog' i]",
            "[class*='conversation' i]",
            "[class*='im' i]",
            "[class*='content' i]"
          ].join(",");
          const nodes = Array.from(document.body ? document.body.querySelectorAll(selector) : []);
          let best = null;
          let bestScore = 0;
          const vw = window.innerWidth || 1280;
          for (const el of nodes) {
            if (!visible(el)) continue;
            const box = el.getBoundingClientRect();
            const label = normalize(el.innerText || el.textContent || "");
            if (label.length < 12) continue;
            let score = Math.min(label.length, 2400) / 20;
            if (box.x > vw * 0.25) score += 80;
            if (box.width > 300 && box.height > 180) score += 60;
            if (/chat|message|dialog|conversation|im/i.test(String(el.className || ""))) score += 50;
            if (label.includes("\u53d1\u9001") || label.includes("\u8f93\u5165")) score += 20;
            if (label.includes("\u5168\u90e8") && label.includes("\u672a\u8bfb") && label.includes("\u65b0\u62db\u547c")) score -= 180;
            if (score > bestScore) {
              best = { text: label, score, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
              bestScore = score;
            }
          }
          return best || { text: normalize(document.body ? document.body.innerText : ""), score: 0 };
        }""") or {}
        recent_source = str(history.get("text") or "") if isinstance(history, dict) and history.get("text") else (
            detail.get("text") if isinstance(detail, dict) else ""
        )
        recent = safe_text(recent_source or text, 1600)
        messages = self.extract_chat_messages(terminal)
        applicant = self.read_current_applicant_context(terminal)
        applied_position = str(applicant.get("appliedPosition") or "")
        last_message = last_effective_chat_message(messages)
        last_other = last_effective_chat_message(messages, sender="other")
        intent = classify_chat_intent(last_other.get("text", "") if last_other else "")
        conversation_key = build_conversation_key(page.url, messages, applicant.get("label") or applicant.get("name"))
        boss_rules = load_boss_chat_rules()
        position_reply = select_position_reply(applied_position, boss_rules)
        company_knowledge_base = select_company_knowledge_base(boss_rules, applied_position)
        context = {
            "title": page.title(),
            "url": page.url,
            "recentText": recent,
            "pageTextPreview": safe_text(text, 900),
            "chatDetailSource": detail if isinstance(detail, dict) else {},
            "applicant": applicant,
            "appliedPosition": applied_position,
            "positionReply": position_reply,
            "companyKnowledgeBase": company_knowledge_base,
            "loadedHistory": history or {},
            "messages": messages[-80:],
            "lastMessage": last_message,
            "lastOtherMessage": last_other,
            "lastSender": last_message.get("sender") if last_message else "",
            "lastOtherSignature": chat_message_signature(last_other) if last_other else "",
            "shouldReply": bool(last_message and last_message.get("sender") == "other"),
            "intent": intent,
            "conversationKey": conversation_key,
            "summary": (
                f"已读取当前聊天页面上下文；应聘岗位：{safe_text(applied_position, 60)}；"
                f"{safe_text(recent, 260)}"
            ),
        }
        context["memory"] = self.refresh_chat_memory(context, conversation_key)
        context["companyKnowledgeHit"] = match_company_knowledge_answer(context)
        return context

    def check_chat_monitor(self) -> dict:
        with self.lock:
            if not has_model_key():
                raise AgentError("还没有配置模型 API Key，无法根据对方消息生成候选回复。")
            terminal = self.get_terminal()
            unread_state = read_unread_badge_state(terminal)
            unread_signature = str(unread_state.get("signature") or "")
            unread_changed = bool(unread_signature and unread_signature != self.chat_monitor_unread_signature)
            if unread_state.get("count", 0):
                self.chat_monitor_unread_signature = unread_signature
                self.chat_monitor_suggestions = []
                message = (
                    f"检测到未读红点：{unread_state.get('count')} 条。"
                    "本轮不会读取当前打开的聊天框，请使用自动回复流程先打开未读会话。"
                )
                if unread_changed:
                    self.add_event("chat", f"检测到未读红点：{unread_state.get('count')} 条，已进入未读优先模式")
                return {
                    "changed": unread_changed,
                    "message": message,
                    "suggestions": [],
                    "unread": unread_state,
                    "context": {"unreadPriority": True},
                }

            context = self.read_chat_context(terminal)
            signature = chat_context_signature(context.get("recentText", ""))
            text_changed = bool(signature and signature != self.chat_monitor_signature)
            if not unread_changed and signature and signature == self.chat_monitor_signature:
                return {
                    "changed": False,
                    "message": "没有检测到新的聊天内容变化。",
                    "suggestions": self.chat_monitor_suggestions,
                    "unread": unread_state,
                    "context": context,
                }

            suggestions = ask_agent_model_for_reply_suggestions(context) if text_changed and context.get("shouldReply") else []
            self.chat_monitor_signature = signature
            self.chat_monitor_unread_signature = unread_signature
            self.chat_monitor_suggestions = suggestions
            if unread_changed and unread_state.get("count", 0):
                self.add_event("chat", f"检测到未读红点：{unread_state.get('count')} 条，等待自动回复流程打开会话")
                message = f"检测到未读红点：{unread_state.get('count')} 条。"
            else:
                self.add_event("chat", f"检测到聊天内容变化，生成 {len(suggestions)} 条候选回复")
                message = f"检测到聊天内容变化，已生成 {len(suggestions)} 条候选回复。"
            return {
                "changed": True,
                "message": message,
                "suggestions": suggestions,
                "unread": unread_state,
                "context": context,
            }

    def auto_reply_chat_once(self, auto_send: bool = False, force: bool = False) -> dict:
        with self.lock:
            if not has_model_key():
                raise AgentError("还没有配置模型 API Key，无法自动回复。")
            if not force and time.time() < self.chat_monitor_cooldown_until:
                return {
                    "changed": False,
                    "message": "刚刚完成一次发送，自动回复冷却中，避免重复回复同一会话。",
                    "cooldown": True,
                }
            pending_send = self.pending_send_confirmation()
            if pending_send:
                return {
                    "changed": False,
                    "message": "已有一条回复草稿正在等待你确认发送，本轮自动检查先暂停。",
                    "pending": True,
                }
            terminal = self.get_terminal()
            unread_state = read_unread_badge_state(terminal)
            unread_signature = str(unread_state.get("signature") or "")
            unread_changed = bool(unread_signature and unread_signature != self.chat_monitor_unread_signature)
            if (
                not force
                and unread_state.get("count", 0)
                and unread_signature
                and unread_signature == self.chat_monitor_handled_unread_signature
            ):
                return {
                    "changed": False,
                    "message": "这批未读消息已经生成过一条回复，等待红点变化或你确认发送。",
                    "unread": unread_state,
                }
            opened = (
                self.open_unreplied_chat_if_present(terminal, require_unread_badge=True)
                if unread_state.get("count", 0)
                else None
            )
            if unread_state.get("count", 0) and not opened:
                return {
                    "changed": False,
                    "message": "检测到未读消息，但没有成功打开未读会话；本轮不会读取当前已打开会话，避免回复错人。",
                    "unread": unread_state,
                }
            opened_context = self.read_chat_context(terminal) if opened else {}
            if opened and unread_state.get("count", 0):
                match_state = opened_thread_matches_context(opened, opened_context)
                opened["matchState"] = match_state
                if not match_state.get("matched"):
                    return {
                        "changed": False,
                        "message": (
                            "已点击疑似未读会话，但页面详情没有稳定切换到该会话；"
                            "本轮停止，避免把第十个人的聊天误当成第二个人来回复。"
                        ),
                        "openedThread": opened,
                        "unread": unread_state,
                        "context": opened_context,
                    }
            if opened and not opened_context.get("shouldReply"):
                return {
                    "changed": False,
                    "message": "已打开疑似未读会话，但底部最后一条有效消息不是对方发来的，本轮不生成回复。",
                    "openedThread": opened,
                    "unread": unread_state,
                    "context": opened_context,
                }
            history = self.load_chat_history(terminal) if opened else {}
            context = self.read_chat_context(terminal, history=history)
            if opened and opened_context.get("shouldReply"):
                opened_last = opened_context.get("lastMessage") if isinstance(opened_context.get("lastMessage"), dict) else {}
                opened_last_other = opened_context.get("lastOtherMessage") if isinstance(opened_context.get("lastOtherMessage"), dict) else {}
                context["lastMessage"] = opened_last
                context["lastOtherMessage"] = opened_last_other or opened_last
                context["lastSender"] = opened_last.get("sender") or "other"
                context["lastOtherSignature"] = chat_message_signature(opened_last_other or opened_last)
                context["shouldReply"] = True
                context["intent"] = classify_chat_intent(str((opened_last_other or opened_last).get("text") or ""))
            conversation_key = build_conversation_key(
                context.get("url", ""),
                context.get("messages", []),
                opened.get("label") if isinstance(opened, dict) else None,
            )
            context["conversationKey"] = conversation_key
            context["memory"] = self.refresh_chat_memory(
                context,
                conversation_key,
                opened_label=opened.get("label") if isinstance(opened, dict) else None,
            )
            state = self.get_chat_state(conversation_key)
            last_other_signature = str(context.get("lastOtherSignature") or "")
            if not context.get("shouldReply"):
                if conversation_key:
                    self.set_chat_state(
                        conversation_key,
                        "skipped",
                        reason="last_message_not_from_other",
                        lastOtherSignature=last_other_signature,
                        intent=context.get("intent", {}),
                    )
                return {
                    "changed": False,
                    "message": "最后一条有效消息不是对方发来的，本轮不生成回复。",
                    "openedThread": opened,
                    "unread": unread_state,
                    "context": context,
                }
            if (
                not force
                and state.get("lastOtherSignature")
                and last_other_signature
                and state.get("lastOtherSignature") == last_other_signature
                and state.get("status") in {"waiting_confirm", "sent", "drafted"}
            ):
                return {
                    "changed": False,
                    "message": f"这个会话的最新对方消息已处于“{state.get('status')}”状态，不重复生成。",
                    "conversationState": state,
                    "openedThread": opened,
                    "unread": unread_state,
                    "context": context,
                }
            signature = chat_context_signature(context.get("recentText", ""))
            if not force and not opened and not unread_changed and signature and signature == self.chat_monitor_signature:
                return {
                    "changed": False,
                    "message": "没有检测到新的聊天内容变化。",
                    "suggestions": self.chat_monitor_suggestions,
                    "unread": unread_state,
                    "context": context,
                }

            suggestions = ask_agent_model_for_reply_suggestions(context)
            self.chat_monitor_signature = signature
            self.chat_monitor_unread_signature = unread_signature
            self.chat_monitor_suggestions = suggestions
            if not suggestions:
                if conversation_key:
                    self.set_chat_state(
                        conversation_key,
                        "skipped",
                        reason="model_returned_no_suggestion",
                        lastOtherSignature=last_other_signature,
                        intent=context.get("intent", {}),
                    )
                return {
                    "changed": True,
                    "message": (
                        "已打开疑似未回复会话，但模型判断暂时不需要回复。"
                        if opened else "检测到聊天内容变化，但模型判断暂时不需要回复。"
                    ),
                    "openedThread": opened,
                    "suggestions": [],
                    "unread": unread_state,
                    "context": context,
                }

            chosen = safe_text(str(suggestions[0].get("text") or "").strip(), CHAT_REPLY_MAX_CHARS)
            if not chosen:
                return {
                    "changed": True,
                    "message": "检测到聊天内容变化，但候选回复为空。",
                    "suggestions": suggestions,
                    "unread": unread_state,
                    "context": context,
                }

            # Only local/test pages may fully auto-send. On external sites we fill a draft
            # and create a confirmation request, so the user stays in control of messages.
            allow_auto_send = bool(auto_send) and is_local_browser_page(terminal)
            previous_confirm = self.require_confirm_send_message
            if not allow_auto_send:
                self.require_confirm_send_message = True
            try:
                fill_result = self.fill_chat_suggestion(chosen)
            finally:
                self.require_confirm_send_message = previous_confirm
            pending = fill_result.get("pendingAction")
            if conversation_key:
                pending_token = pending.get("token") if isinstance(pending, dict) else ""
                if pending_token and pending_token in self.pending_actions:
                    self.pending_actions[pending_token]["action"]["_conversationKey"] = conversation_key
                    self.pending_actions[pending_token]["action"]["_lastOtherSignature"] = last_other_signature
                self.set_chat_state(
                    conversation_key,
                    "waiting_confirm" if pending else ("sent" if allow_auto_send else "drafted"),
                    lastOtherSignature=last_other_signature,
                    intent=context.get("intent", {}),
                    draft=chosen,
                    pendingToken=pending_token,
                    openedLabel=opened.get("label") if isinstance(opened, dict) else "",
                )
            if unread_signature:
                self.chat_monitor_handled_unread_signature = unread_signature

            after_context = self.read_chat_context(terminal)
            after_signature = chat_context_signature(after_context.get("recentText", ""))
            if after_signature:
                self.chat_monitor_signature = after_signature

            mode = "已自动发送" if allow_auto_send else "已自动填入草稿，等待确认发送"
            return {
                "changed": True,
                "message": mode,
                "suggestions": suggestions,
                "chosen": chosen,
                "openedThread": opened,
                "unread": unread_state,
                "autoSent": allow_auto_send,
                "reply": fill_result.get("reply") or mode,
                "pendingAction": fill_result.get("pendingAction"),
                "send": fill_result.get("send"),
                "page": fill_result.get("page"),
                "context": after_context,
            }

    def open_unreplied_chat_if_present(self, terminal: BrowserTerminal, require_unread_badge: bool = False) -> dict | None:
        prepare_result = {}
        if require_unread_badge:
            prepare_result = prepare_unread_chat_list(terminal)
        target = find_unreplied_chat_target(terminal, require_unread_badge=require_unread_badge)
        if not target and require_unread_badge:
            prepare_result = prepare_unread_chat_list(terminal)
            target = find_unreplied_chat_target(terminal, require_unread_badge=require_unread_badge)
        if not target:
            return None
        locator = target["locator"]
        label = str(target.get("label") or "未回复会话")
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        clicked = False
        if target.get("reason") == "unread-badge":
            try:
                box = locator.bounding_box(timeout=2000)
                if box:
                    x = box["x"] + box["width"] / 2
                    y = box["y"] + box["height"] / 2
                    humanized_point_click(terminal, x, y)
                    clicked = True
            except Exception:
                clicked = False
        if not clicked and terminal.visual_cursor:
            try:
                humanized_locator_click(terminal, locator, force=True)
            except Exception:
                locator.click(timeout=8000, force=True)
        elif not clicked:
            humanized_locator_click(terminal, locator, force=True)
        terminal.current_page().wait_for_timeout(random.randint(650, 1100))
        message = f"已打开疑似未回复会话：{safe_text(label, 80)}"
        self.add_event("chat", message)
        return {
            "label": safe_text(label, 160),
            "reason": target.get("reason", ""),
            "message": message,
            "x": target.get("x"),
            "y": target.get("y"),
            "w": target.get("w"),
            "h": target.get("h"),
            "prepare": prepare_result if isinstance(prepare_result, dict) else {},
        }

    def fill_chat_suggestion(self, text: str) -> dict:
        with self.lock:
            if not text.strip():
                raise AgentError("候选回复为空，无法填入。")
            terminal = self.get_terminal()
            label = self.smart_fill(terminal, "聊天", text.strip())
            if self.require_confirm_send_message or not is_local_browser_page(terminal):
                pending = self.create_send_confirmation()
                return {
                    "reply": f"已填入草稿：{safe_text(label, 80)}。需要你确认后再发送。",
                    "pendingAction": pending,
                    "page": {
                        "title": terminal.current_page().title(),
                        "url": terminal.current_page().url,
                    },
                }
            send_action = find_send_action(terminal)
            result = self.execute_action(terminal, send_action)
            return {
                "reply": f"已填入草稿：{safe_text(label, 80)}。{result.get('message', '已尝试发送。')}",
                "send": result,
                "page": {
                    "title": terminal.current_page().title(),
                    "url": terminal.current_page().url,
                },
            }

    def send_chat_resume_from_current_conversation(self, terminal: BrowserTerminal, confirmed: bool = False) -> dict:
        button = find_chat_resume_button(terminal)
        if not button.get("found"):
            return {
                "blocked": True,
                "message": "当前聊天页没有找到“发简历”按钮。请先切到 BOSS 聊天详情页，或让页面完成加载后再试。",
                "state": button,
            }

        label = str(button.get("label") or "发简历")
        reason = str(button.get("reason") or "")
        if button.get("disabled"):
            message = "找到了“发简历”按钮，但当前不可用。"
            if reason:
                message += f" 页面提示：{safe_text(reason, 120)}"
            else:
                message += " 可能需要等待对方回复、切换到可沟通状态，或先完成平台要求的步骤。"
            return {
                "blocked": True,
                "message": message,
                "state": {k: v for k, v in button.items() if k != "locator"},
            }

        if not confirmed and not is_local_browser_page(terminal):
            pending = self.create_pending_action(
                {"action": "chat_send_resume", "_pendingType": "send_resume"},
                "发送简历给当前聊天对象",
            )
            return {
                "blocked": True,
                "confirmRequired": True,
                "pendingAction": pending,
                "message": "我已找到可用的“发简历”按钮。发送简历会把你的个人简历发给当前聊天对象，需要你确认后再执行。",
                "state": {k: v for k, v in button.items() if k != "locator"},
            }

        locator = button.get("locator")
        if locator is None:
            return {
                "blocked": True,
                "message": "找到了“发简历”按钮的信息，但没有拿到可点击元素，请重新观察页面后再试。",
            }
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        terminal.current_page().wait_for_timeout(random.randint(900, 1400))
        after = inspect_chat_resume_after_click(terminal)
        message = "已点击“发简历”按钮。"
        if after.get("needsFollowup"):
            message += f" 页面出现后续确认/选择项：{safe_text(after.get('summary', ''), 160)}。我不会继续点最终发送，除非你再次确认。"
        elif after.get("sentLike"):
            message += " 页面看起来已经出现简历发送相关记录，请你确认聊天记录是否已发出。"
        else:
            message += " 如果页面弹出了简历选择或确认框，请告诉我下一步，我会继续按确认流程处理。"
        self.add_event("chat", message)
        return {
            "message": message,
            "state": {k: v for k, v in button.items() if k != "locator"},
            "after": after,
        }

    @timed_agent_stage("send_common_phrase", "发送常用语/话术")
    def send_recruiter_common_phrase(
        self,
        terminal: BrowserTerminal,
        phrase: str = "",
        phrase_key: str = "",
        target_candidate: str = "",
    ) -> dict:
        target_candidate = clean_recruiter_candidate_name(target_candidate)
        opened = None
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
                        "message": f"没有在当前招聘会话列表里找到候选人：{safe_text(target_candidate, 40)}。",
                        "targetCandidate": target_candidate,
                    }
                locator = target.get("locator")
                if locator is None:
                    return {
                        "blocked": True,
                        "message": f"找到了候选人：{safe_text(target_candidate, 40)}，但没有拿到可点击元素。",
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

        context = self.read_chat_context(terminal)
        position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
        if not is_ai_app_basic_conditions_position(context, position_reply):
            return {
                "blocked": True,
                "message": (
                    "已按规则拦截：常用语/基础条件话术只允许发送给 AI 应用开发相关岗位，"
                    f"当前岗位是 {safe_text(str(context.get('appliedPosition') or '未识别岗位'), 60)}。"
                ),
                "opened": opened,
                "contextPosition": safe_text(str(context.get("appliedPosition") or ""), 80),
            }
        if not phrase:
            if phrase_key in {"basic_conditions", "initial_conditions", "基础条件", "岗位基础条件"}:
                phrase = str(position_reply.get("initialCommonPhrase") or "")
            if not phrase:
                phrase = str(position_reply.get("initialCommonPhrase") or BASIC_CONDITIONS_PHRASE)
        phrase = safe_text(phrase.strip(), 400)
        if not phrase:
            return {"blocked": True, "message": "没有拿到要发送的常用语内容。"}

        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")

        cache_key = "basic_conditions"
        button = {}
        cached_button = {}
        if not is_common_phrase_panel_open(terminal):
            cached_button = self.measure_current_timing_stage(
                "click_cached_common_phrase_button",
                "按缓存位置打开常用语",
                lambda: self.click_cached_common_phrase_button(terminal, cache_key),
            )
        if not is_common_phrase_panel_open(terminal):
            button = self.measure_current_timing_stage(
                "find_common_phrase_button",
                "查找常用语按钮",
                lambda: find_common_phrase_button(terminal),
            )
            if not button.get("found"):
                return {
                    "blocked": True,
                    "message": "没有找到聊天工具栏里的“常用语”按钮。",
                    "candidate": candidate,
                    "state": button,
                    "cache": cached_button,
                }
            self.update_common_phrase_cache(cache_key, buttonBox={
                "x": button.get("x"),
                "y": button.get("y"),
                "w": button.get("w"),
                "h": button.get("h"),
            })
        clear_chat_editor(terminal)
        locator = button.get("locator")
        if not is_common_phrase_panel_open(terminal) and locator is None:
            return {
                "blocked": True,
                "message": "找到了“常用语”按钮信息，但没有拿到可点击元素。",
                "candidate": candidate,
            }
        if not is_common_phrase_panel_open(terminal) and terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        if not is_common_phrase_panel_open(terminal):
            open_panel_started = time.time()
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            terminal.current_page().wait_for_timeout(random.randint(350, 700))
            panel_opened = is_common_phrase_panel_open(terminal)
            self.record_current_timing_stage("open_common_phrase_panel", "打开常用语面板", open_panel_started, ok=panel_opened)
            if not panel_opened:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                retry_panel_started = time.time()
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                terminal.current_page().wait_for_timeout(random.randint(450, 850))
                self.record_current_timing_stage(
                    "open_common_phrase_panel_retry",
                    "重试打开常用语面板",
                    retry_panel_started,
                    ok=is_common_phrase_panel_open(terminal),
                )

        item = self.measure_current_timing_stage(
            "find_common_phrase_item",
            "查找常用语内容",
            lambda: find_common_phrase_item(terminal, phrase),
        )
        if not item.get("found"):
            return {
                "blocked": True,
                "message": f"常用语面板里没有找到这句话：{safe_text(phrase, 80)}",
                "candidate": candidate,
                "state": item,
            }
        direct_send = self.measure_current_timing_stage(
            "click_cached_common_phrase_send",
            "按缓存位置发送常用语",
            lambda: self.click_cached_common_phrase_send(terminal, phrase, item, cache_key),
        )
        if not direct_send.get("clicked"):
            direct_send = self.measure_current_timing_stage(
                "click_common_phrase_send",
                "点击常用语发送",
                lambda: click_common_phrase_row_send_button(terminal, phrase, item),
            )
        if direct_send.get("clicked"):
            self.update_common_phrase_cache(cache_key, sendBox={
                "x": direct_send.get("x"),
                "y": direct_send.get("y"),
                "w": direct_send.get("w"),
                "h": direct_send.get("h"),
            }, rowBox=direct_send.get("rowBox") if isinstance(direct_send.get("rowBox"), dict) else {
                "x": item.get("x"),
                "y": item.get("y"),
                "w": item.get("w"),
                "h": item.get("h"),
            }, phrase=safe_text(phrase, 240))
        if not direct_send.get("clicked"):
            return {
                "blocked": True,
                "message": "已打开“常用语”并找到目标话术，但没有成功触发/点击该话术右侧的“发送”按钮；已停止，避免误点聊天输入框。",
                "candidate": candidate,
                "state": {k: v for k, v in item.items() if k != "locator"},
                "directSend": direct_send,
            }
        if not direct_send.get("clicked"):
            item_locator = item.get("locator")
            if item_locator is None:
                fallback_item = click_common_phrase_item_by_text(terminal, phrase)
                if not fallback_item.get("clicked"):
                    return {
                        "blocked": True,
                        "message": "找到了常用语文本，但没有拿到可点击元素，也没有找到右侧发送按钮。",
                        "candidate": candidate,
                        "state": {k: v for k, v in item.items() if k != "locator"},
                        "directSend": direct_send,
                        "fallback": fallback_item,
                    }
            else:
                try:
                    if terminal.humanize:
                        terminal.pause_like_person("pre_action")
                        highlight_target(item_locator)
                    humanized_locator_click(terminal, item_locator, force=True)
                except Exception as error:
                    fallback_item = click_common_phrase_item_by_text(terminal, phrase)
                    if not fallback_item.get("clicked"):
                        return {
                            "blocked": True,
                            "message": f"找到了常用语文本，但点击失败：{safe_text(str(error), 180)}",
                            "candidate": candidate,
                            "state": {k: v for k, v in item.items() if k != "locator"},
                            "directSend": direct_send,
                            "fallback": fallback_item,
                        }
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            terminal.current_page().wait_for_timeout(random.randint(420, 780))

            editor_text = read_chat_editor_text(terminal)
            if phrase[:20] not in editor_text:
                return {
                    "blocked": True,
                    "message": f"已点击常用语，但输入框里没有检测到预期文本。当前输入框：{safe_text(editor_text, 120)}",
                    "candidate": candidate,
                    "state": {k: v for k, v in item.items() if k != "locator"},
                    "directSend": direct_send,
                }

            send_action = find_send_action(terminal)
            send_result = self.execute_action(terminal, send_action)
        else:
            send_result = {"message": "已点击常用语右侧发送按钮", "directSend": direct_send}
        message = f"已通过“常用语”向候选人发送：{safe_text(phrase, 120)}"
        self.add_event("chat", message)
        return {
            "message": message,
            "candidate": candidate,
            "opened": opened,
            "phrase": phrase,
            "state": {
                "button": {k: v for k, v in button.items() if k != "locator"},
                "item": {k: v for k, v in item.items() if k != "locator"},
            },
            "send": send_result,
        }

    @timed_agent_stage("knowledge_answer", "知识库/规则答疑")
    def answer_recruiter_knowledge_question(
        self,
        terminal: BrowserTerminal,
        context: dict,
        candidate_label: str,
        conversation_key: str,
        candidate_state_key: str,
        previous_state: dict | None = None,
        send_message=None,
    ) -> dict:
        previous_state = previous_state if isinstance(previous_state, dict) else {}
        last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
        if last_message.get("sender") != "other":
            return {}
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        if str(context.get("appliedPosition") or "").strip() and not knowledge_base.get("enabled"):
            return {}
        self.measure_current_timing_stage(
            "ensure_conversation_review_for_knowledge",
            "答疑复盘",
            lambda: ensure_candidate_conversation_review(context, previous_state),
        )
        question_messages = recent_unanswered_question_messages(context, previous_state)
        knowledge_context = knowledge_question_context(context, question_messages) if question_messages else dict(context)
        silent_hit = match_company_knowledge_silent_question(knowledge_context)
        if silent_hit:
            if not question_messages:
                fallback_last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
                if fallback_last_other:
                    question_messages = [fallback_last_other]
                    knowledge_context = knowledge_question_context(context, question_messages)
            knowledge_signatures = knowledge_context.get("knowledgeQuestionSignatures")
            if not isinstance(knowledge_signatures, list):
                knowledge_signatures = [chat_message_signature(item) for item in question_messages if chat_message_signature(item)]
            last_other = knowledge_context.get("lastOtherMessage") if isinstance(knowledge_context.get("lastOtherMessage"), dict) else {}
            last_other_signature = str(knowledge_context.get("lastOtherSignature") or chat_message_signature(last_other))
            state_payload = {
                "candidateLabel": safe_text(candidate_label, 160),
                "knowledgeTopic": safe_text(str(silent_hit.get("topic") or ""), 80),
                "knowledgeAnswer": "",
                "knowledgeSilentSkipped": True,
                "knowledgeMatchedPattern": safe_text(str(silent_hit.get("matchedPattern") or ""), 120),
                "lastOtherSignature": last_other_signature,
                "lastOther": safe_text(str(last_other.get("text") or ""), 180),
                "knowledgeAnsweredSignatures": [str(item) for item in knowledge_signatures if str(item or "").strip()][-RECENT_UNANSWERED_OTHER_LIMIT:],
                "knowledgeQuestionMessages": [
                    safe_text(str(item.get("text") or ""), 180)
                    for item in question_messages
                    if isinstance(item, dict)
                ],
                "knowledgeEvidence": [silent_hit],
            }
            if conversation_key:
                self.set_chat_state(conversation_key, "knowledge_silent_skipped", **state_payload)
            if candidate_state_key:
                self.set_chat_state(candidate_state_key, "knowledge_silent_skipped", **state_payload)
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "knowledge_silent_skipped",
                context=context,
                **state_payload,
            )
            user_question_items = build_recruiter_unclear_question_items(
                candidate_label,
                knowledge_context,
                question_messages,
                action="knowledge_silent_skipped",
                screening_status="silent",
                answer="",
                knowledge_hit=silent_hit,
                force_save=True,
            )
            append_recruiter_user_questions(user_question_items)
            append_recruiter_unclear_questions(user_question_items)
            message = (
                "命中知识库沉默规则，本轮不回复也不继续推进："
                f"{safe_text(str(silent_hit.get('matchedPattern') or ''), 80)}"
            )
            self.add_event("chat", message)
            return {
                "answered": False,
                "skipped": True,
                "silentSkipped": True,
                "skipReason": "silent_question",
                "message": message,
                "knowledgeHit": silent_hit,
                "knowledgeAnsweredSignatures": state_payload["knowledgeAnsweredSignatures"],
                "basis": {
                    "questionMessages": state_payload["knowledgeQuestionMessages"],
                    "matchedPattern": state_payload["knowledgeMatchedPattern"],
                },
            }
        if not question_messages:
            return {}

        last_other = knowledge_context.get("lastOtherMessage") if isinstance(knowledge_context.get("lastOtherMessage"), dict) else {}
        last_other_text = str(last_other.get("text") or "").strip()
        knowledge_signatures = knowledge_context.get("knowledgeQuestionSignatures")
        if not isinstance(knowledge_signatures, list):
            knowledge_signatures = [chat_message_signature(item) for item in question_messages if chat_message_signature(item)]
        answered_signatures = normalize_answered_message_signatures(previous_state)
        if knowledge_signatures and all(str(item) in answered_signatures for item in knowledge_signatures):
            return {}
        hit = {}
        if has_model_key():
            try:
                hit = ask_agent_model_for_company_knowledge_reply(knowledge_context)
            except Exception as error:
                hit = {
                    "source": "companyKnowledgeBase.model_error",
                    "error": safe_text(str(error), 160),
                }
        if not hit.get("answer"):
            hit = match_company_knowledge_answer(knowledge_context)
        if not hit.get("answer"):
            hit = context.get("companyKnowledgeHit") if isinstance(context.get("companyKnowledgeHit"), dict) else {}
        answer = strip_reply_terminal_punctuation(str(hit.get("answer") or "").strip())
        if not answer:
            if hit.get("answerSkipped") or hit.get("unknownSkipped"):
                user_question_items = build_recruiter_unclear_question_items(
                    candidate_label,
                    knowledge_context,
                    question_messages,
                    action="knowledge_unknown_skipped",
                    screening_status="unclear",
                    answer="",
                    knowledge_hit=hit,
                )
                append_recruiter_user_questions(user_question_items)
                append_recruiter_unclear_questions(user_question_items)
            return {}
        if is_unknown_knowledge_reply(answer, knowledge_context):
            user_question_items = build_recruiter_unclear_question_items(
                candidate_label,
                knowledge_context,
                question_messages,
                action="knowledge_unknown_skipped",
                screening_status="unclear",
                answer="",
                knowledge_hit={**hit, "source": str(hit.get("source") or "companyKnowledgeBase.unknown_skipped"), "unknownSkipped": True},
            )
            append_recruiter_user_questions(user_question_items)
            append_recruiter_unclear_questions(user_question_items)
            return {}
        last_other_signature = str(knowledge_context.get("lastOtherSignature") or chat_message_signature(last_other))
        if (
            previous_state.get("status") == "knowledge_answered_waiting"
            and last_other_signature
            and previous_state.get("lastOtherSignature") == last_other_signature
        ):
            return {}
        answer = avoid_repeated_reply(answer, context)
        if callable(send_message):
            label = "平台聊天输入框"
            send_result = send_message(answer)
            verification = send_result.get("verify") if isinstance(send_result, dict) and isinstance(send_result.get("verify"), dict) else {
                "verified": bool(isinstance(send_result, dict) and not send_result.get("blocked") and send_result.get("verified", True))
            }
            if isinstance(send_result, dict) and send_result.get("sent") and not send_result.get("blocked") and not verification.get("verified"):
                verification = {**verification, "verified": True, "source": "send_result_clicked_and_cleared"}
            send_package = {"send": send_result, "verification": verification, "attempts": [send_result] if isinstance(send_result, dict) else []}
        else:
            label = self.smart_fill(terminal, "聊天", answer)
            send_package = self.send_current_chat_reply_with_verification(
                terminal,
                answer,
                max_attempts=CHAT_SEND_MAX_ATTEMPTS,
            )
            send_result = send_package.get("send", {})
            verification = send_package.get("verification", {})
        if not verification.get("verified"):
            return {
                "blocked": True,
                "message": f"已填写知识库回复，但没有确认发送成功：{safe_text(answer, 80)}",
                "answer": answer,
                "knowledgeHit": hit,
                "inputLabel": safe_text(label, 80),
                "send": send_result,
            }
        state_payload = {
            "candidateLabel": safe_text(candidate_label, 160),
            "knowledgeTopic": safe_text(str(hit.get("topic") or ""), 80),
            "knowledgeSubQueries": hit.get("subQueries", [])[:4] if isinstance(hit.get("subQueries"), list) else [],
            "knowledgeAnswer": safe_text(answer, 80),
            "lastOtherSignature": last_other_signature,
            "lastOther": safe_text(str(last_other.get("text") or ""), 180),
            "knowledgeAnsweredSignatures": [str(item) for item in knowledge_signatures if str(item or "").strip()][-RECENT_UNANSWERED_OTHER_LIMIT:],
            "knowledgeQuestionMessages": [
                safe_text(str(item.get("text") or ""), 180)
                for item in question_messages
                if isinstance(item, dict)
            ],
            "knowledgeEvidence": hit.get("selectedEvidence", [])[:5] if isinstance(hit.get("selectedEvidence"), list) else hit.get("hits", [])[:5] if isinstance(hit.get("hits"), list) else [],
        }
        if conversation_key:
            self.set_chat_state(conversation_key, "knowledge_answered_waiting", **state_payload)
        if candidate_state_key:
            self.set_chat_state(candidate_state_key, "knowledge_answered_waiting", **state_payload)
        self.set_recruiter_basic_state(
            conversation_key,
            candidate_label,
            "knowledge_answered_waiting",
            context=context,
            **state_payload,
        )
        sub_queries = state_payload.get("knowledgeSubQueries") if isinstance(state_payload.get("knowledgeSubQueries"), list) else []
        if sub_queries:
            message = f"已按知识库回复候选人问题：{safe_text(answer, 80)}（覆盖：{safe_text('；'.join(str(item) for item in sub_queries), 120)}）"
        else:
            message = f"已按知识库回复候选人问题：{safe_text(answer, 80)}"
        user_question_items = build_recruiter_unclear_question_items(
            candidate_label,
            knowledge_context,
            question_messages,
            action="knowledge_answered",
            screening_status="answered",
            answer=answer,
            knowledge_hit=hit,
        )
        append_recruiter_user_questions(user_question_items)
        if is_unknown_knowledge_reply(answer, knowledge_context):
            for item in user_question_items:
                item["action"] = "knowledge_unknown_answer_sent"
                item["screeningStatus"] = "unclear"
            append_recruiter_unclear_questions(user_question_items)
        self.add_event("chat", message)
        return {
            "answered": True,
            "message": message,
            "answer": answer,
            "knowledgeHit": hit,
            "inputLabel": safe_text(label, 80),
            "send": send_result,
            "verification": verification,
            "attempts": send_package.get("attempts", []),
            "knowledgeAnsweredSignatures": state_payload["knowledgeAnsweredSignatures"],
            "basis": {
                "questionMessages": state_payload["knowledgeQuestionMessages"],
                "subQueries": state_payload["knowledgeSubQueries"],
                "evidence": state_payload["knowledgeEvidence"],
                "answer": safe_text(answer, 120),
            },
        }

    def answer_current_recruiter_questions(
        self,
        terminal: BrowserTerminal,
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
                        "message": f"没有在当前招聘会话列表里找到候选人：{safe_text(target_candidate, 40)}。",
                        "targetCandidate": target_candidate,
                    }
                locator = target.get("locator")
                if locator is None:
                    return {
                        "blocked": True,
                        "message": f"找到了候选人：{safe_text(target_candidate, 40)}，但没有拿到可点击元素。",
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

        history = self.load_chat_history(terminal, max_rounds=CHAT_HISTORY_SCROLL_ROUNDS)
        context = self.read_chat_context(terminal, history=history)
        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
        position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        applied_position = safe_text(str(context.get("appliedPosition") or ""), 80)
        if is_unconfigured_recruiter_position(context, position_reply, position_screening):
            return {
                "message": f"当前岗位未添加到知识库，已按规则跳过不回复：{applied_position or '未识别岗位'}。",
                "candidate": candidate,
                "opened": opened,
                "answered": False,
                "skippedUnconfiguredPosition": True,
            }
        conversation_key = str(context.get("conversationKey") or "")
        candidate_state_key = recruiter_basic_candidate_state_key(candidate_label)
        previous_state = self.get_chat_state(conversation_key) or self.get_chat_state(candidate_state_key)
        result = self.answer_recruiter_knowledge_question(
            terminal,
            context,
            candidate_label,
            conversation_key,
            candidate_state_key,
            previous_state=previous_state,
        )
        if knowledge_result_stops_flow(result):
            return {
                **result,
                "candidate": candidate,
                "opened": opened,
            }
        return {
            "message": f"当前候选人没有检测到需要知识库回复的未处理问题：{safe_text(candidate_label, 80)}。",
            "candidate": candidate,
            "opened": opened,
            "answered": False,
        }

    def job51_close_stale_non_chat_pages(self, terminal: BrowserTerminal, origin_page=None, reason: str = "") -> dict:
        origin_page = origin_page or terminal.current_page()
        closed_pages: list[dict] = []
        try:
            origin_url = str(getattr(origin_page, "url", "") or "")
        except Exception:
            origin_url = ""
        origin_is_chat = "://ehire.51job.com" in origin_url and "/Revision/chat" in origin_url
        try:
            pages = list(terminal.all_pages())
        except Exception:
            try:
                pages = list(origin_page.context.pages)
            except Exception:
                pages = []
        for page in pages:
            if page == origin_page:
                continue
            try:
                url = str(getattr(page, "url", "") or "")
                title = page.title()
            except Exception:
                url = ""
                title = ""
            is_ehire = "ehire.51job.com" in url
            is_chat = is_ehire and "/Revision/chat" in url
            is_stale_non_chat = is_ehire and not is_chat and any(
                marker in url
                for marker in (
                    "/Revision/talent/management",
                    "/Revision/talent/search-recommend",
                    "/Revision/job-manage",
                    "/Revision/job?",
                    "/Revision/job/",
                    "/Revision/talent/resume/detail",
                )
            )
            is_duplicate_chat = origin_is_chat and is_chat
            if not (is_stale_non_chat or is_duplicate_chat):
                continue
            try:
                page.close()
                closed_pages.append({"url": safe_text(url, 180), "title": safe_text(title, 80)})
            except Exception as error:
                closed_pages.append({
                    "url": safe_text(url, 180),
                    "title": safe_text(title, 80),
                    "error": safe_text(str(error), 120),
                })
        try:
            origin_page.bring_to_front()
        except Exception:
            pass
        return {"closedPages": closed_pages, "count": len(closed_pages), "reason": reason}

    def job51_find_chat_page(self, terminal: BrowserTerminal, preferred_page=None):
        try:
            pages = list(terminal.all_pages())
        except Exception:
            return None
        chat_pages = []
        for page in pages:
            try:
                url = str(getattr(page, "url", "") or "")
            except Exception:
                url = ""
            if "://ehire.51job.com" in url and "/Revision/chat" in url:
                chat_pages.append(page)
        if preferred_page in chat_pages:
            return preferred_page
        return chat_pages[0] if chat_pages else None

    def _run_job51_terminal_sync(self, callback):
        terminal_obj = BrowserTerminal(
            JOB51_CDP_URL,
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
            job51_pages = []
            for page in terminal.all_pages():
                url = str(getattr(page, "url", "") or "")
                try:
                    title = page.title()
                except Exception:
                    title = ""
                is_ehire_page = "://ehire.51job.com" in url
                is_chat_page = is_ehire_page and "/Revision/chat" in url
                is_job51_page = is_ehire_page or "51job" in title or ("51job.com" in url and "webchat.7moor.com" not in url)
                if is_job51_page:
                    job51_pages.append((0 if is_chat_page else 1 if is_ehire_page else 2, page))
            if job51_pages:
                job51_pages.sort(key=lambda item: item[0])
                terminal.page = job51_pages[0][1]
                try:
                    self.job51_close_stale_non_chat_pages(terminal, origin_page=terminal.page, reason="terminal_select")
                except Exception:
                    pass
                try:
                    terminal.page.bring_to_front()
                except Exception:
                    pass
            return callback(terminal)
        finally:
            if terminal is not None:
                try:
                    terminal_obj.__exit__(None, None, None)
                except Exception:
                    pass

    def with_job51_terminal(self, callback, timeout_seconds: int | None = None):
        result_box: dict[str, object] = {}

        def worker() -> None:
            try:
                result_box["result"] = self._run_job51_terminal_sync(callback)
            except Exception as error:
                result_box["error"] = error

        timeout = max(30, int(timeout_seconds or JOB51_WORKER_TIMEOUT_SECONDS))
        thread = threading.Thread(target=worker, name="job51-playwright-worker", daemon=True)
        thread.start()
        thread.join(timeout)
        if thread.is_alive():
            raise TimeoutError(f"51job 浏览器操作超过 {timeout} 秒仍未返回，已停止等待；请检查 51 页面是否卡在弹窗、简历预览或发送确认上。")
        if "error" in result_box:
            raise result_box["error"]  # type: ignore[misc]
        return result_box.get("result")

    def job51_dismiss_interruptions(self, terminal: BrowserTerminal, reason: str = "") -> dict:
        page = terminal.current_page()
        closed: list[dict] = []
        for _ in range(5):
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
                  && box.bottom >= 0
                  && box.right >= 0
                  && box.top <= window.innerHeight
                  && box.left <= window.innerWidth;
              };
              const rect = el => {
                const box = el.getBoundingClientRect();
                return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
              };
              const candidates = [];
              const add = (el, reason, score) => {
                if (!el || !visible(el)) return;
                candidates.push({
                  reason,
                  score,
                  text: normalize(el.innerText || el.textContent || ''),
                  className: String(el.className || ''),
                  tag: el.tagName,
                  rect: rect(el)
                });
                el.setAttribute('data-codex-job51-dismiss', '1');
              };
              const exactCloseText = /^(关闭|跳过|知道了|我知道了|稍后再说|暂不使用|不用了|取消|不感兴趣|×|x)$/i;
              const softCloseText = /(不感兴趣|暂不|稍后|关闭|跳过|知道了|我知道了)/;
              const blockerRoots = Array.from(document.querySelectorAll([
                '#driver-popover-item',
                '.ai-guide-dialog',
                '.wechat-notify',
                '.el-message-box__wrapper',
                '.el-dialog__wrapper',
                '.el-popover',
                '.driver-popover',
                '[class*="guide" i]',
                '[class*="advert" i]',
                '[class*="ad-" i]'
              ].join(','))).filter(visible);
              for (const root of blockerRoots) {
                const rootText = normalize(root.innerText || root.textContent || '');
                const rootClass = String(root.className || '');
                const looksBlocking = /(AI|推荐|广告|微信通知|新人才|意向推荐|学生频道|开通|去开启|简历不错过|智能回复|助手|提示)/.test(rootText + ' ' + rootClass);
                if (!looksBlocking && !root.matches('#driver-popover-item,.ai-guide-dialog,.wechat-notify,.el-message-box__wrapper')) continue;
                const buttons = Array.from(root.querySelectorAll('button,[role="button"],.close,.el-icon-close,[class*="close" i],[class*="cancel" i]'));
                for (const btn of buttons) {
                  const text = normalize(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
                  const cls = String(btn.className || '');
                  if (exactCloseText.test(text) || softCloseText.test(text) || /close|cancel|driver-close|icon-close/i.test(cls)) {
                    add(btn, `close_blocker:${rootText.slice(0, 40) || rootClass.slice(0, 40)}`, text === '不感兴趣' ? 140 : 120);
                  }
                }
              }
              const directSelectors = [
                'button.ai-guide-btn-no',
                'button.driver-close-btn',
                '.wechat-notify .close',
                '.wechat-notify .el-icon-close',
                '.ai-guide-dialog button.ai-guide-btn-no'
              ];
              for (const selector of directSelectors) {
                for (const el of Array.from(document.querySelectorAll(selector))) add(el, `selector:${selector}`, 160);
              }
              const target = candidates.sort((a, b) => b.score - a.score)[0];
              if (!target) return null;
              return target;
            }""")
            if not isinstance(target, dict):
                break
            locator = page.locator("[data-codex-job51-dismiss='1']").first
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
                    page.locator("[data-codex-job51-dismiss='1']").evaluate_all("els => els.forEach(el => el.removeAttribute('data-codex-job51-dismiss'))")
                except Exception:
                    pass
        return {"closed": closed, "count": len(closed), "reason": reason}

    def job51_open_chat_page(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        self.job51_dismiss_interruptions(terminal, reason="before_open_chat")
        existing_chat_page = self.job51_find_chat_page(terminal, preferred_page=page)
        if existing_chat_page is not None:
            terminal.page = existing_chat_page
            page = existing_chat_page
            close_result = self.job51_close_stale_non_chat_pages(terminal, origin_page=page, reason="open_chat_existing")
            try:
                page.bring_to_front()
            except Exception:
                pass
            return {"opened": True, "url": page.url, "title": page.title(), "source": "existing_chat", "closeResult": close_result}
        if "ehire.51job.com" in str(page.url) and "/Revision/chat" in str(page.url):
            close_result = self.job51_close_stale_non_chat_pages(terminal, origin_page=page, reason="open_chat_current")
            try:
                page.bring_to_front()
            except Exception:
                pass
            return {"opened": True, "url": page.url, "title": page.title(), "source": "current", "closeResult": close_result}
        page.goto(JOB51_CHAT_URL, wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(random.randint(1200, 1800))
        close_result = self.job51_close_stale_non_chat_pages(terminal, origin_page=page, reason="open_chat_goto")
        return {"opened": True, "url": page.url, "title": page.title(), "source": "goto", "closeResult": close_result}

    def job51_select_all_positions(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        self.job51_dismiss_interruptions(terminal, reason="before_select_all_positions")
        token = f"codex_job51_all_positions_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        result = safe_eval(page, """token => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4 && style.display !== 'none' && style.visibility !== 'hidden';
          };
          const selectors = [
            '.position-menu .menu-item',
            '.position-menu [class*="menu-item"]',
            '[class*="position-menu"] [class*="menu-item"]',
            '[class*="position"] [class*="menu-item"]',
            '.menu-item_content_short',
            '.menu-item-all'
          ];
          const seen = new Set();
          const nodes = [];
          for (const selector of selectors) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              if (seen.has(el)) continue;
              seen.add(el);
              nodes.push(el);
            }
          }
          if (!nodes.length) {
            for (const el of Array.from(document.querySelectorAll('button,[role="button"],a')).slice(0, 300)) {
              const text = normalize(el.textContent || '');
              if (/全部岗位|全部职位|^全部$/.test(text)) nodes.push(el);
            }
          }
          const candidates = nodes.filter(visible).map(el => {
            const text = normalize(el.textContent || '');
            const cls = String(el.className || '');
            const box = el.getBoundingClientRect();
            let score = 0;
            if (/menu-item-all/.test(cls)) score += 300;
            if (/position|menu-item/.test(cls)) score += 80;
            if (/^全部岗位$|^全部职位$/.test(text)) score += 500;
            else if (/全部岗位|全部职位/.test(text) && text.length <= 20) score += 360;
            else if (/^全部$/.test(text)) score += 180;
            if (/is-active|active|selected|checked/.test(cls)) score += 30;
            return { el, text, cls, score, y: box.y };
          }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.y - b.y);
          const best = candidates[0];
          if (!best) return { selected: false, reason: 'all_positions_not_found' };
          best.el.setAttribute('data-codex-job51-all-positions', token);
          return {
            selected: true,
            label: best.text,
            className: best.cls,
            alreadyActive: /is-active|active|selected|checked/.test(best.cls)
          };
        }""", token)
        if not isinstance(result, dict) or not result.get("selected"):
            return result if isinstance(result, dict) else {"selected": False, "reason": "all_positions_not_found"}
        if result.get("alreadyActive"):
            return {**result, "clicked": False}
        locator = page.locator(f"[data-codex-job51-all-positions='{token}']").first
        try:
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(900, 1400))
            return {**result, "clicked": True}
        except Exception as error:
            return {"selected": False, "reason": safe_text(str(error), 160), "state": result}
        finally:
            try:
                page.locator("[data-codex-job51-all-positions]").evaluate_all("els => els.forEach(el => el.removeAttribute('data-codex-job51-all-positions'))")
            except Exception:
                pass

    def job51_prepare_unread_filter(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        self.job51_dismiss_interruptions(terminal, reason="before_unread_filter")
        unread = page.locator("label.el-checkbox.btn.unread-checkbox").first
        try:
            if not unread.count():
                return {"found": False, "reason": "unread_checkbox_not_found"}
            state = unread.evaluate("""el => ({
              checked: el.classList.contains('is-checked') || !!el.querySelector('input:checked'),
              text: String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
            })""")
            if not isinstance(state, dict):
                state = {}
            if not state.get("checked"):
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(unread)
                humanized_locator_click(terminal, unread, force=True)
