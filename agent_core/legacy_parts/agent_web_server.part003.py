                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(900, 1300))
                close_result = self.job51_close_stale_non_chat_pages(terminal, origin_page=page, reason="after_prepare_unread_filter_dom_click")
                return {"found": True, "clicked": True, "state": state, "click": locals().get("click_result") if isinstance(locals().get("click_result"), dict) else {}, "closeResult": close_result}
            return {"found": True, "clicked": False, "state": state}
        except Exception as error:
            return {"found": False, "reason": safe_text(str(error), 160)}

    def job51_prepare_all_messages_filter(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        if not self.job51_is_chat_page(page):
            return {"found": False, "reason": "not_chat_page", "url": safe_text(str(getattr(page, "url", "") or ""), 180)}
        self.job51_install_chat_navigation_guard(page, reason="before_all_messages_filter")
        self.job51_dismiss_interruptions(terminal, reason="before_all_messages_filter", chat_only=True)
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
            if state.get("checked"):
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(unread)
                click_result = unread.evaluate("""el => {
                  const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
                  const cls = String(el.className || '');
                  const href = String(el.getAttribute('href') || el.closest('a')?.getAttribute('href') || '');
                  const text = normalize(el.innerText || el.textContent || '');
                  const guardText = normalize([text, href, cls, el.id].filter(Boolean).join(' '));
                  const blockedNavigation = /Revision\\/talent\\/management|Revision\\/talent\\/search-recommend|人才管理|人才望远镜/.test(guardText);
                  const blockedAi = /AI\\s*沟通|AI沟通|智能沟通|ai\\s*沟通/i.test(guardText);
                  if (!el.matches('label.el-checkbox.btn.unread-checkbox') || !/unread-checkbox/.test(cls)) {
                    return { ok: false, reason: 'all_messages_filter_not_exact_checkbox', text: guardText.slice(0, 160), href, className: cls };
                  }
                  if (blockedNavigation || blockedAi) {
                    return { ok: false, reason: blockedAi ? 'blocked_ai_chat_target' : 'blocked_talent_navigation_target', text: guardText.slice(0, 160), href, className: cls };
                  }
                  if (!/未读|unread/i.test(guardText)) {
                    return { ok: false, reason: 'all_messages_filter_text_mismatch', text: guardText.slice(0, 160), href, className: cls };
                  }
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                  const target = el.querySelector('.el-checkbox__input, .el-checkbox__inner, input[type="checkbox"]') || el;
                  const rect = target.getBoundingClientRect();
                  const labelRect = el.getBoundingClientRect();
                  if (!rect || rect.width <= 0 || rect.height <= 0) {
                    return { ok: false, reason: 'all_messages_filter_click_target_not_visible', text: guardText.slice(0, 160), href, className: cls };
                  }
                  const x = Math.min(Math.max(rect.left + Math.min(rect.width / 2, 10), labelRect.left + 1), labelRect.right - 1);
                  const y = Math.min(Math.max(rect.top + rect.height / 2, labelRect.top + 1), labelRect.bottom - 1);
                  const hit = document.elementFromPoint(x, y);
                  if (!hit || !el.contains(hit)) {
                    return {
                      ok: false,
                      reason: 'all_messages_filter_hit_test_outside_label',
                      text: guardText.slice(0, 160),
                      hitText: normalize(hit && (hit.innerText || hit.textContent || '')).slice(0, 120),
                      href,
                      className: cls,
                      rect: { x: labelRect.x, y: labelRect.y, width: labelRect.width, height: labelRect.height }
                    };
                  }
                  const hitText = normalize([hit.innerText, hit.textContent, hit.className, hit.id].filter(Boolean).join(' '));
                  if (/AI\\s*沟通|AI沟通|智能沟通|ai\\s*沟通/i.test(hitText)) {
                    return { ok: false, reason: 'blocked_ai_chat_hit_target', text: guardText.slice(0, 160), hitText: hitText.slice(0, 120), href, className: cls };
                  }
                  if (typeof target.click === 'function') target.click();
                  else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                  return {
                    ok: true,
                    text: text.slice(0, 80),
                    href,
                    className: cls,
                    clickTarget: String(target.className || target.tagName || '').slice(0, 80),
                    rect: { x: labelRect.x, y: labelRect.y, width: labelRect.width, height: labelRect.height }
                  };
                }""")
                if isinstance(click_result, dict) and not click_result.get("ok"):
                    return {"found": False, "reason": str(click_result.get("reason") or "all_messages_filter_dom_click_blocked"), "state": state, "click": click_result}
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(900, 1300))
                close_result = self.job51_close_stale_non_chat_pages(terminal, origin_page=page, reason="after_prepare_all_messages_filter_dom_click")
                return {"found": True, "clicked": True, "state": state, "click": locals().get("click_result") if isinstance(locals().get("click_result"), dict) else {}, "closeResult": close_result}
            return {"found": True, "clicked": False, "state": state}
        except Exception as error:
            return {"found": False, "reason": safe_text(str(error), 160)}

    def job51_find_next_thread(
        self,
        terminal: BrowserTerminal,
        exclude_labels: list[str] | None = None,
        allowed_positions: tuple[str, ...] | list[str] = JOB51_CONFIGURED_POSITIONS,
        include_read_sent: bool = False,
    ) -> dict | None:
        exclude_labels = exclude_labels or []
        excluded_keys = [compact_conversation_label(item) for item in exclude_labels if compact_conversation_label(item)]
        excluded_names = [recruiter_candidate_name_from_label(item) for item in exclude_labels if recruiter_candidate_name_from_label(item)]
        excluded_prefixes = [item[:32] for item in excluded_keys if len(item) >= 6]
        allowed_clean = [clean_applied_position(item) for item in allowed_positions if clean_applied_position(item)]
        page = terminal.current_page()
        rows = page.locator("#conversation-list .list-item")
        try:
            count = rows.count()
        except Exception:
            count = 0
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        viewport_height = int(viewport.get("height") or 720)
        viewport_width = int(viewport.get("width") or 1280)
        for index in range(count):
            row = rows.nth(index)
            try:
                label = safe_text(row.inner_text(timeout=800), 300)
            except Exception:
                continue
            label_key = compact_conversation_label(label)
            label_name = recruiter_candidate_name_from_label(label)
            label_prefix = label_key[:32]
            if not label:
                continue
            if any(item and (item in label_key or label_key[:80] in item) for item in excluded_keys):
                continue
            if label_name and label_name in excluded_names:
                continue
            if label_prefix and any(prefix and label_prefix.startswith(prefix[:18]) for prefix in excluded_prefixes):
                continue
            if "平台推荐" in label or "为你推荐的人才" in label:
                continue
            if not include_read_sent and re.search(r"\[(送达|已读)\]", label):
                continue
            job = safe_text(safe_eval(page, f"""() => {{
              const row = document.querySelectorAll('#conversation-list .list-item')[{index}];
              const node = row ? row.querySelector('.jobname') : null;
              return node ? String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
            }}""") or "", 100)
            if not job and re.search(r"\[(平台推荐|推荐)\]", label):
                continue
            clean_job = clean_applied_position(job or label)
            clean_label = clean_applied_position(label)
            if allowed_clean and not any(
                pos in clean_job
                or clean_job in pos
                or pos in clean_label
                or job51_position_label_matches(clean_job, pos)
                or job51_position_label_matches(clean_label, pos)
                for pos in allowed_clean
            ):
                continue
            try:
                box = row.bounding_box(timeout=1000)
            except Exception:
                box = None
            if not box:
                continue
            if (
                float(box.get("width") or 0) < 120
                or float(box.get("height") or 0) < 35
                or float(box.get("x") or 0) > min(760, viewport_width * 0.58)
                or float(box.get("y") or 0) < 80
                or float(box.get("y") or 0) > viewport_height - 24
                or float(box.get("y") or 0) + float(box.get("height") or 0) < 120
            ):
                continue
            return {
                "index": index,
                "label": label,
                "job": job,
                "locator": row,
                "x": round(box["x"]) if box else None,
                "y": round(box["y"]) if box else None,
                "scrollState": self.job51_capture_thread_list_scroll_state(terminal),
            }
        return None

    def job51_capture_thread_list_scroll_state(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        try:
            state = safe_eval(page, r"""() => {
              const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
              const visible = el => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 35 && box.bottom > 0 && box.right > 0
                  && box.top < window.innerHeight && box.left < window.innerWidth
                  && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.02;
              };
              const canScroll = el => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const overflow = style.overflowY || '';
                const cls = String(el.className || '');
                const id = String(el.id || '');
                return el.scrollHeight > el.clientHeight + 30
                  && (/(auto|scroll|hidden)/.test(overflow)
                    || /conversation|session|contact|chat|list|scroll|el-scrollbar/i.test(cls + ' ' + id));
              };
              const rows = Array.from(document.querySelectorAll('#conversation-list .list-item')).filter(visible);
              const findScrollableParent = start => {
                let cur = start || null;
                while (cur && cur !== document.body) {
                  const box = cur.getBoundingClientRect();
                  if (canScroll(cur) && box.width >= 160 && box.x < Math.min(760, window.innerWidth * 0.58)) return cur;
                  cur = cur.parentElement;
                }
                return null;
              };
              let container = rows.length ? findScrollableParent(rows[0]) : null;
              if (!container) {
                const preferred = Array.from(document.querySelectorAll([
                  '#conversation-list',
                  '#conversation-list .el-scrollbar__wrap',
                  '#conversation-list .el-scrollbar__view',
                  '.el-scrollbar__wrap',
                  '.conversation-list',
                  '[class*="conversation" i]',
                  '[class*="session" i]',
                  '[class*="contact" i]',
                  '[class*="chat-list" i]',
                  '[class*="list" i]'
                ].join(','))).filter(el => {
                  if (!visible(el) || !canScroll(el)) return false;
                  const box = el.getBoundingClientRect();
                  return box.width >= 160 && box.height >= 120 && box.x < Math.min(760, window.innerWidth * 0.58);
                });
                container = preferred[0] || null;
              }
              const signature = rows
                .slice(0, 14)
                .map(row => normalize(row.innerText || row.textContent || '').slice(0, 90))
                .join('|');
              if (!container) return { found: false, signature };
              const top = container.scrollTop || 0;
              const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
              return {
                found: true,
                top: Math.round(top),
                maxTop: Math.round(maxTop),
                signature
              };
            }""")
        except Exception as error:
            return {"found": False, "reason": safe_text(str(error), 160)}
        return state if isinstance(state, dict) else {"found": False, "reason": "scroll_state_unavailable"}

    def job51_restore_thread_list_scroll_state(self, terminal: BrowserTerminal, target: dict | None = None) -> dict:
        target = target if isinstance(target, dict) else {}
        scroll_state = target.get("scrollState") if isinstance(target.get("scrollState"), dict) else {}
        if not scroll_state.get("found"):
            return {"restored": False, "reason": "target_scroll_state_missing"}
        page = terminal.current_page()
        try:
            top = int(scroll_state.get("top") or 0)
        except Exception:
            top = 0
        try:
            result = safe_eval(page, r"""({ top }) => {
              const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
              const visible = el => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 35 && box.bottom > 0 && box.right > 0
                  && box.top < window.innerHeight && box.left < window.innerWidth
                  && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.02;
              };
              const canScroll = el => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const overflow = style.overflowY || '';
                const cls = String(el.className || '');
                const id = String(el.id || '');
                return el.scrollHeight > el.clientHeight + 30
                  && (/(auto|scroll|hidden)/.test(overflow)
                    || /conversation|session|contact|chat|list|scroll|el-scrollbar/i.test(cls + ' ' + id));
              };
              const rows = Array.from(document.querySelectorAll('#conversation-list .list-item')).filter(visible);
              const findScrollableParent = start => {
                let cur = start || null;
                while (cur && cur !== document.body) {
                  const box = cur.getBoundingClientRect();
                  if (canScroll(cur) && box.width >= 160 && box.x < Math.min(760, window.innerWidth * 0.58)) return cur;
                  cur = cur.parentElement;
                }
                return null;
              };
              let container = rows.length ? findScrollableParent(rows[0]) : null;
              if (!container) {
                const preferred = Array.from(document.querySelectorAll([
                  '#conversation-list',
                  '#conversation-list .el-scrollbar__wrap',
                  '#conversation-list .el-scrollbar__view',
                  '.el-scrollbar__wrap',
                  '.conversation-list',
                  '[class*="conversation" i]',
                  '[class*="session" i]',
                  '[class*="contact" i]',
                  '[class*="chat-list" i]',
                  '[class*="list" i]'
                ].join(','))).filter(el => {
                  if (!visible(el) || !canScroll(el)) return false;
                  const box = el.getBoundingClientRect();
                  return box.width >= 160 && box.height >= 120 && box.x < Math.min(760, window.innerWidth * 0.58);
                });
                container = preferred[0] || null;
              }
              const signature = () => Array.from(document.querySelectorAll('#conversation-list .list-item'))
                .filter(visible)
                .slice(0, 14)
                .map(row => normalize(row.innerText || row.textContent || '').slice(0, 90))
                .join('|');
              if (!container) return { restored: false, reason: 'no_scroll_container', signature: signature() };
              const before = container.scrollTop || 0;
              const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
              const next = Math.max(0, Math.min(maxTop, Number(top || 0)));
              if (container.scrollTo) container.scrollTo({ top: next, behavior: 'auto' });
              else container.scrollTop = next;
              container.dispatchEvent(new Event('scroll', { bubbles: true }));
              container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: next - before }));
              return {
                restored: true,
                before: Math.round(before),
                after: Math.round(next),
                changed: Math.abs(next - before) > 4,
                maxTop: Math.round(maxTop),
                signature: signature()
              };
            }""", {"top": top})
        except Exception as error:
            return {"restored": False, "reason": safe_text(str(error), 160)}
        if isinstance(result, dict) and result.get("restored"):
            try:
                page.wait_for_timeout(180)
            except Exception:
                pass
        return result if isinstance(result, dict) else {"restored": False, "reason": "restore_state_unavailable"}

    def job51_refind_thread_target(self, terminal: BrowserTerminal, target: dict | None = None) -> dict:
        target = target if isinstance(target, dict) else {}
        restore_result = self.job51_restore_thread_list_scroll_state(terminal, target)
        original_label = safe_text(str(target.get("label") or ""), 300)
        original_key = compact_conversation_label(original_label)
        original_name = recruiter_candidate_name_from_label(original_label)
        original_job = clean_applied_position(str(target.get("job") or ""))
        def refind_body_key(value: str, *remove_values: str) -> str:
            key = compact_conversation_label(value)
            key = re.sub(r"\d{1,2}:\d{2}", "", key)
            key = re.sub(r"20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}/\d{1,2}", "", key)
            key = re.sub(r"\d+", "", key)
            for token in ("今天", "昨天", "前天", "已投", "已读", "送达", "新招呼", "引用", "删除"):
                key = key.replace(token, "")
            removable = list(remove_values)
            try:
                removable.extend(str(item or "") for item in JOB51_CONFIGURED_POSITIONS)
            except Exception:
                pass
            for item in removable:
                item_key = compact_conversation_label(str(item or ""))
                if item_key:
                    key = key.replace(item_key, "")
            return key[-160:]
        page = terminal.current_page()
        rows = page.locator("#conversation-list .list-item")
        try:
            count = rows.count()
        except Exception:
            count = 0
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        viewport_height = int(viewport.get("height") or 720)
        viewport_width = int(viewport.get("width") or 1280)
        for index in range(count):
            row = rows.nth(index)
            try:
                label = safe_text(row.inner_text(timeout=800), 300)
            except Exception:
                continue
            if not label:
                continue
            label_key = compact_conversation_label(label)
            label_name = recruiter_candidate_name_from_label(label)
            job = safe_text(safe_eval(page, f"""() => {{
              const row = document.querySelectorAll('#conversation-list .list-item')[{index}];
              const node = row ? row.querySelector('.jobname') : null;
              return node ? String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
            }}""") or "", 100)
            clean_job = clean_applied_position(job or label)
            key_match = bool(original_key and label_key and (original_key == label_key or original_key in label_key or label_key in original_key))
            name_match = bool(original_name and label_name and recruiter_candidate_names_match(original_name, label_name))
            job_match = bool(
                original_job
                and clean_job
                and (
                    original_job in clean_job
                    or clean_job in original_job
                    or job51_position_label_matches(original_job, clean_job)
                )
            )
            generic_name = bool(re.search(r"(先生|女士|同学)$", original_name or "")) or len(original_name or "") <= 1
            original_body_key = refind_body_key(original_label, original_name, original_job)
            label_body_key = refind_body_key(label, label_name, clean_job, job)
            body_match = bool(
                name_match
                and original_body_key
                and label_body_key
                and min(len(original_body_key), len(label_body_key)) >= 8
                and (original_body_key in label_body_key or label_body_key in original_body_key)
            )
            if not (key_match or body_match or (name_match and job_match and not generic_name)):
                continue
            try:
                box = row.bounding_box(timeout=1000)
            except Exception:
                box = None
            if not box:
                continue
            if (
                float(box.get("width") or 0) < 120
                or float(box.get("height") or 0) < 35
                or float(box.get("x") or 0) > min(760, viewport_width * 0.58)
                or float(box.get("y") or 0) < 80
                or float(box.get("y") or 0) > viewport_height - 24
                or float(box.get("y") or 0) + float(box.get("height") or 0) < 120
            ):
                continue
            refreshed = dict(target)
            refreshed.update({
                "found": True,
                "index": index,
                "label": label,
                "job": job,
                "locator": row,
                "x": round(box["x"]),
                "y": round(box["y"]),
                "refind": {
                    "restoreResult": restore_result,
                    "matchedBy": "label" if key_match else "name_body" if body_match else "name_job",
                    "originalLabel": safe_text(original_label, 160),
                    "label": safe_text(label, 160),
                    "job": safe_text(job, 80),
                    "bodyMatch": bool(body_match),
                },
            })
            return refreshed
        return {
            "found": False,
            "reason": "target_not_visible_after_restore",
            "restoreResult": restore_result,
            "targetLabel": safe_text(original_label, 160),
            "targetName": safe_text(str(original_name or ""), 80),
            "targetJob": safe_text(original_job, 80),
        }

    def job51_visible_thread_summary(
        self,
        terminal: BrowserTerminal,
        exclude_labels: list[str] | None = None,
        allowed_positions: tuple[str, ...] | list[str] = JOB51_CONFIGURED_POSITIONS,
        include_read_sent: bool = False,
    ) -> dict:
        exclude_labels = exclude_labels or []
        excluded_keys = [compact_conversation_label(item) for item in exclude_labels if compact_conversation_label(item)]
        excluded_names = [recruiter_candidate_name_from_label(item) for item in exclude_labels if recruiter_candidate_name_from_label(item)]
        excluded_prefixes = [item[:32] for item in excluded_keys if len(item) >= 6]
        allowed_clean = [clean_applied_position(item) for item in allowed_positions if clean_applied_position(item)]
        page = terminal.current_page()
        rows = page.locator("#conversation-list .list-item")
        try:
            count = rows.count()
        except Exception:
            count = 0
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        viewport_height = int(viewport.get("height") or 720)
        viewport_width = int(viewport.get("width") or 1280)
        summary = {
            "visibleRows": 0,
            "actionableCount": 0,
            "excludedCount": 0,
            "platformCount": 0,
            "readOrSentCount": 0,
            "filteredPositionCount": 0,
            "labels": [],
            "actionableLabels": [],
        }
        for index in range(count):
            row = rows.nth(index)
            try:
                box = row.bounding_box(timeout=500)
            except Exception:
                box = None
            if not box:
                continue
            if (
                float(box.get("width") or 0) < 120
                or float(box.get("height") or 0) < 35
                or float(box.get("x") or 0) > min(760, viewport_width * 0.58)
                or float(box.get("y") or 0) < 80
                or float(box.get("y") or 0) > viewport_height - 24
                or float(box.get("y") or 0) + float(box.get("height") or 0) < 120
            ):
                continue
            try:
                label = safe_text(row.inner_text(timeout=500), 300)
            except Exception:
                continue
            if not label:
                continue
            summary["visibleRows"] += 1
            if len(summary["labels"]) < 12:
                summary["labels"].append(safe_text(label, 120))
            if "平台推荐" in label or "为你推荐的人才" in label:
                summary["platformCount"] += 1
                continue
            if re.search(r"\[(送达|已读)\]", label):
                summary["readOrSentCount"] += 1
                if not include_read_sent:
                    continue
            label_key = compact_conversation_label(label)
            label_name = recruiter_candidate_name_from_label(label)
            label_prefix = label_key[:32]
            if any(item and (item in label_key or label_key[:80] in item) for item in excluded_keys):
                summary["excludedCount"] += 1
                continue
            if label_name and label_name in excluded_names:
                summary["excludedCount"] += 1
                continue
            if label_prefix and any(prefix and label_prefix.startswith(prefix[:18]) for prefix in excluded_prefixes):
                summary["excludedCount"] += 1
                continue
            job = safe_text(safe_eval(page, f"""() => {{
              const row = document.querySelectorAll('#conversation-list .list-item')[{index}];
              const node = row ? row.querySelector('.jobname') : null;
              return node ? String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
            }}""") or "", 100)
            if not job and re.search(r"\[(平台推荐|推荐)\]", label):
                summary["platformCount"] += 1
                continue
            clean_job = clean_applied_position(job or label)
            clean_label = clean_applied_position(label)
            if allowed_clean and not any(
                pos in clean_job
                or clean_job in pos
                or pos in clean_label
                or job51_position_label_matches(clean_job, pos)
                or job51_position_label_matches(clean_label, pos)
                for pos in allowed_clean
            ):
                summary["filteredPositionCount"] += 1
                continue
            summary["actionableCount"] += 1
            if len(summary["actionableLabels"]) < 8:
                summary["actionableLabels"].append(safe_text(label, 120))
        return summary

    def job51_scroll_conversation_list(self, terminal: BrowserTerminal, direction: int = 1) -> dict:
        page = terminal.current_page()
        token = f"codex_job51_scroll_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        try:
            result = page.evaluate(
                r"""({ direction, token }) => {
                  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
                  const visible = el => {
                    if (!el || !el.isConnected) return false;
                    const box = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return box.width > 80 && box.height > 35 && box.bottom > 0 && box.right > 0
                      && box.top < window.innerHeight && box.left < window.innerWidth
                      && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.02;
                  };
                  const canScroll = el => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const overflow = style.overflowY || '';
                    const cls = String(el.className || '');
                    const id = String(el.id || '');
                    return el.scrollHeight > el.clientHeight + 30
                      && (/(auto|scroll|hidden)/.test(overflow)
                        || /conversation|session|contact|chat|list|scroll|el-scrollbar/i.test(cls + ' ' + id));
                  };
                  const rect = el => {
                    const box = el.getBoundingClientRect();
                    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
                  };
                  const rowSignature = () => Array.from(document.querySelectorAll('#conversation-list .list-item'))
                    .filter(visible)
                    .slice(0, 14)
                    .map(row => normalize(row.innerText || row.textContent || '').slice(0, 90))
                    .join('|');
                  const rows = Array.from(document.querySelectorAll('#conversation-list .list-item')).filter(row => {
                    if (!visible(row)) return false;
                    const box = row.getBoundingClientRect();
                    return box.x < Math.min(720, window.innerWidth * 0.55) && box.bottom > 40 && box.top < window.innerHeight - 10;
                  });
                  const findScrollableParent = start => {
                    let cur = start || null;
                    while (cur && cur !== document.body) {
                      const box = cur.getBoundingClientRect();
                      if (canScroll(cur) && box.width >= 160 && box.x < Math.min(760, window.innerWidth * 0.58)) return cur;
                      cur = cur.parentElement;
                    }
                    return null;
                  };
                  let container = rows.length ? findScrollableParent(rows[0]) : null;
                  if (!container) {
                    const preferred = Array.from(document.querySelectorAll([
                      '#conversation-list',
                      '#conversation-list .el-scrollbar__wrap',
                      '#conversation-list .el-scrollbar__view',
                      '.el-scrollbar__wrap',
                      '.conversation-list',
                      '[class*="conversation" i]',
                      '[class*="session" i]',
                      '[class*="contact" i]',
                      '[class*="chat-list" i]',
                      '[class*="list" i]'
                    ].join(','))).filter(el => {
                      if (!visible(el) || !canScroll(el)) return false;
                      const box = el.getBoundingClientRect();
                      return box.width >= 160 && box.height >= 120 && box.x < Math.min(760, window.innerWidth * 0.58);
                    });
                    container = preferred[0] || null;
                  }
                  if (!container) {
                    const fallbackBox = rows.length ? rect(rows[rows.length - 1]) : null;
                    return {
                      scrolled: false,
                      prepared: false,
                      reason: 'no_scroll_container',
                      beforeSignature: rowSignature(),
                      box: fallbackBox
                    };
                  }
                  const before = container.scrollTop || 0;
                  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                  const stepAbs = Math.max(260, Math.floor((container.clientHeight || 500) * (0.72 + Math.random() * 0.18)));
                  const step = stepAbs * (direction >= 0 ? 1 : -1);
                  const next = Math.max(0, Math.min(maxTop, before + step));
                  container.setAttribute('data-codex-job51-scroll', token);
                  container.setAttribute('data-codex-before-scroll-top', String(Math.round(before)));
                  return {
                    scrolled: false,
                    prepared: true,
                    before: Math.round(before),
                    after: Math.round(before),
                    plannedAfter: Math.round(next),
                    amount: Math.round(step),
                    maxTop: Math.round(maxTop),
                    atEnd: before >= maxTop - 4,
                    atTop: before <= 4,
                    beforeSignature: rowSignature(),
                    box: rect(container),
                    token
                  };
                }""",
                {"direction": direction, "token": token},
            )
        except Exception as error:
            return {"scrolled": False, "error": safe_text(str(error), 160)}
        if not isinstance(result, dict):
            result = {"scrolled": False}
        box = result.get("box") if isinstance(result.get("box"), dict) else None
        if box and result.get("prepared"):
            try:
                amount = int(result.get("amount") or (direction * random.randint(320, 560)))
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                page.evaluate(
                    r"""({ token, amount }) => {
                      const container = document.querySelector(`[data-codex-job51-scroll="${token}"]`);
                      if (!container) return;
                      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                      const next = Math.max(0, Math.min(maxTop, (container.scrollTop || 0) + amount));
                      if (container.scrollTo) container.scrollTo({ top: next, behavior: 'auto' });
                      else container.scrollTop = next;
                      container.dispatchEvent(new Event('scroll', { bubbles: true }));
                      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: amount }));
                    }""",
                    {"token": token, "amount": amount},
                )
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(220, 420))
                after = page.evaluate(
                    r"""({ token, beforeSignature, plannedAfter }) => {
                      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
                      const visible = el => {
                        if (!el || !el.isConnected) return false;
                        const box = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        return box.width > 80 && box.height > 35 && box.bottom > 0 && box.right > 0
                          && box.top < window.innerHeight && box.left < window.innerWidth
                          && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.02;
                      };
                      const signature = () => Array.from(document.querySelectorAll('#conversation-list .list-item'))
                        .filter(visible)
                        .slice(0, 14)
                        .map(row => normalize(row.innerText || row.textContent || '').slice(0, 90))
                        .join('|');
                      const container = document.querySelector(`[data-codex-job51-scroll="${token}"]`);
                      if (!container) return { found: false, afterSignature: signature() };
                      const top = container.scrollTop || 0;
                      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                      const afterSignature = signature();
                      return {
                        found: true,
                        after: Math.round(top),
                        maxTop: Math.round(maxTop),
                        atEnd: top >= maxTop - 4,
                        atTop: top <= 4,
                        plannedAfter: Math.round(plannedAfter || top),
                        afterSignature,
                        signatureChanged: !!beforeSignature && beforeSignature !== afterSignature
                      };
                    }""",
                    {
                        "token": token,
                        "beforeSignature": result.get("beforeSignature"),
                        "plannedAfter": result.get("plannedAfter"),
                    },
                )
                if isinstance(after, dict) and after.get("found"):
                    before = int(result.get("before") or 0)
                    actual_after = int(after.get("after") or before)
                    result.update({
                        "after": actual_after,
                        "maxTop": after.get("maxTop", result.get("maxTop")),
                        "atEnd": bool(after.get("atEnd")),
                        "atTop": bool(after.get("atTop")),
                        "afterSignature": after.get("afterSignature"),
                        "signatureChanged": bool(after.get("signatureChanged")),
                        "scrolled": abs(actual_after - before) > 4 or bool(after.get("signatureChanged")),
                        "mode": "dom_container_scroll",
                        "domOnly": True,
                    })
                if not result.get("scrolled"):
                    fallback = page.evaluate(
                        r"""({ token, plannedAfter, beforeSignature }) => {
                          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
                          const visible = el => {
                            if (!el || !el.isConnected) return false;
                            const box = el.getBoundingClientRect();
                            const style = window.getComputedStyle(el);
                            return box.width > 80 && box.height > 35 && box.bottom > 0 && box.right > 0
                              && box.top < window.innerHeight && box.left < window.innerWidth
                              && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.02;
                          };
                          const signature = () => Array.from(document.querySelectorAll('#conversation-list .list-item'))
                            .filter(visible)
                            .slice(0, 14)
                            .map(row => normalize(row.innerText || row.textContent || '').slice(0, 90))
                            .join('|');
                          const container = document.querySelector(`[data-codex-job51-scroll="${token}"]`);
                          if (!container) return { scrolled: false, reason: 'missing_container', afterSignature: signature() };
                          const before = container.scrollTop || 0;
                          const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                          const next = Math.max(0, Math.min(maxTop, Number(plannedAfter || before)));
                          if (container.scrollTo) container.scrollTo({ top: next, behavior: 'smooth' });
                          else container.scrollTop = next;
                          container.dispatchEvent(new Event('scroll', { bubbles: true }));
                          const afterSignature = signature();
                          return {
                            scrolled: Math.abs(next - before) > 4 || (!!beforeSignature && beforeSignature !== afterSignature),
                            before: Math.round(before),
                            after: Math.round(next),
                            maxTop: Math.round(maxTop),
                            atEnd: next >= maxTop - 4,
                            atTop: next <= 4,
                            afterSignature,
                            signatureChanged: !!beforeSignature && beforeSignature !== afterSignature,
                            mode: 'dom_fallback'
                          };
                        }""",
                        {
                            "token": token,
                            "plannedAfter": result.get("plannedAfter"),
                            "beforeSignature": result.get("beforeSignature"),
                        },
                    )
                    if isinstance(fallback, dict):
                        result.update(fallback)
            except Exception as error:
                result["scrollError"] = safe_text(str(error), 160)
        elif box:
            result.update({
                "scrolled": False,
                "mode": "dom_only_no_container",
                "reason": result.get("reason") or "no_scroll_container",
                "domOnly": True,
            })
        try:
            page.locator("[data-codex-job51-scroll]").evaluate_all("els => els.forEach(el => { el.removeAttribute('data-codex-job51-scroll'); el.removeAttribute('data-codex-before-scroll-top'); })")
        except Exception:
            pass
        try:
            page.wait_for_timeout(random.randint(620, 1050) if result.get("scrolled") else random.randint(420, 760))
        except Exception:
            pass
        return result

    def job51_scroll_conversation_list_to_top(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        token = f"codex_job51_scroll_top_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        try:
            result = page.evaluate(
                r"""({ token }) => {
                  const visible = el => {
                    if (!el || !el.isConnected) return false;
                    const box = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return box.width > 80 && box.height > 35 && box.bottom > 0 && box.right > 0
                      && box.top < window.innerHeight && box.left < window.innerWidth
                      && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.02;
                  };
                  const canScroll = el => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const overflow = style.overflowY || '';
                    const cls = String(el.className || '');
                    const id = String(el.id || '');
                    return el.scrollHeight > el.clientHeight + 30
                      && (/(auto|scroll|hidden)/.test(overflow)
                        || /conversation|session|contact|chat|list|scroll|el-scrollbar/i.test(cls + ' ' + id));
                  };
                  const rows = Array.from(document.querySelectorAll('#conversation-list .list-item')).filter(visible);
                  const findScrollableParent = start => {
                    let cur = start || null;
                    while (cur && cur !== document.body) {
                      const box = cur.getBoundingClientRect();
                      if (canScroll(cur) && box.width >= 160 && box.x < Math.min(760, window.innerWidth * 0.58)) return cur;
                      cur = cur.parentElement;
                    }
                    return null;
                  };
                  let container = rows.length ? findScrollableParent(rows[0]) : null;
                  if (!container) {
                    const preferred = Array.from(document.querySelectorAll([
                      '#conversation-list',
                      '#conversation-list .el-scrollbar__wrap',
                      '.el-scrollbar__wrap',
                      '.conversation-list',
                      '[class*="conversation" i]',
                      '[class*="session" i]',
                      '[class*="contact" i]',
                      '[class*="chat-list" i]',
                      '[class*="list" i]'
                    ].join(','))).filter(el => {
                      if (!visible(el) || !canScroll(el)) return false;
                      const box = el.getBoundingClientRect();
                      return box.width >= 160 && box.height >= 120 && box.x < Math.min(760, window.innerWidth * 0.58);
                    });
                    container = preferred[0] || null;
                  }
                  if (!container) return { scrolled: false, reason: 'no_scroll_container' };
                  const before = container.scrollTop || 0;
                  container.setAttribute('data-codex-job51-scroll-top', token);
                  if (container.scrollTo) container.scrollTo({ top: 0, behavior: 'auto' });
                  else container.scrollTop = 0;
                  container.dispatchEvent(new Event('scroll', { bubbles: true }));
                  return {
                    scrolled: Math.abs((container.scrollTop || 0) - before) > 4,
                    before: Math.round(before),
                    after: Math.round(container.scrollTop || 0),
                    maxTop: Math.round(Math.max(0, container.scrollHeight - container.clientHeight)),
                    atTop: (container.scrollTop || 0) <= 4
                  };
                }""",
                {"token": token},
            )
        except Exception as error:
            return {"scrolled": False, "error": safe_text(str(error), 160)}
        try:
            page.wait_for_timeout(random.randint(520, 860))
        except Exception:
            pass
        return result if isinstance(result, dict) else {"scrolled": False}

    def job51_wait_chat_ready(self, terminal: BrowserTerminal, timeout_ms: int = 5000) -> bool:
        try:
            terminal.current_page().wait_for_selector("#drop-area.input-textarea_self, #drop-area", timeout=timeout_ms)
            return True
        except Exception:
            return False

    def job51_extract_chat_messages(self, terminal: BrowserTerminal) -> list[dict]:
        page = terminal.current_page()
        messages = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const rows = Array.from(document.querySelectorAll('div.message-item.mine, div.message-item.others'));
          return rows.filter(visible).map(row => {
            const box = row.getBoundingClientRect();
            const cls = String(row.className || '');
            const sender = cls.includes('mine') ? 'me' : 'other';
            let text = normalize(row.innerText || row.textContent || '');
            text = text.replace(/^未读\\s+/, '').trim();
            return {
              sender,
              text,
              rawText: normalize(row.innerText || row.textContent || ''),
              className: cls,
              x: Math.round(box.x),
              y: Math.round(box.y)
            };
          }).filter(item => item.text && !/^\\d{1,2}:\\d{2}$/.test(item.text)).slice(-120);
        }""")
        if not isinstance(messages, list):
            return []
        out: list[dict] = []
        for item in messages:
            if not isinstance(item, dict):
                continue
            text = safe_text(str(item.get("text") or "").strip(), 500)
            if not text:
                continue
            sender = str(item.get("sender") or "")
            if sender not in {"me", "other"}:
                continue
            out.append({
                "sender": sender,
                "text": text,
                "rawText": safe_text(str(item.get("rawText") or text), 600),
                "status": "",
                "time": "",
                "className": safe_text(str(item.get("className") or ""), 120),
                "x": item.get("x"),
                "y": item.get("y"),
            })
        return out

    @timed_agent_stage("job51_verify_reply_sent", "51job发送后检查")
    def job51_verify_reply_sent_in_current_chat(self, terminal: BrowserTerminal, text: str) -> dict:
        expected = normalize_reply_fingerprint(str(text or ""))
        if not expected:
            return {"verified": False, "reason": "empty_expected"}
        try:
            terminal.current_page().wait_for_timeout(random.randint(650, 1050))
            messages = self.job51_extract_chat_messages(terminal)
        except Exception as error:
            return {"verified": False, "reason": safe_text(str(error), 160)}
        last_my: dict = {}
        for item in reversed(messages[-12:]):
            if not isinstance(item, dict) or item.get("sender") != "me":
                continue
            last_my = item
            actual = normalize_reply_fingerprint(str(item.get("text") or ""))
            if expected and actual and (expected in actual or actual in expected):
                return {
                    "verified": True,
                    "message": safe_text(str(item.get("text") or ""), 120),
                    "source": "job51_message_item",
                }
        current_input = safe_text(str(safe_eval(
            terminal.current_page(),
            "() => String((document.querySelector('#drop-area') || {}).innerText || '')",
        ) or ""), 240)
        return {
            "verified": False,
            "reason": "reply_not_found_in_recent_51job_my_messages",
            "lastMy": safe_text(str(last_my.get("text") or ""), 120) if isinstance(last_my, dict) else "",
            "inputContainsExpected": bool(expected and expected in normalize_reply_fingerprint(current_input)),
            "inputText": current_input,
        }

    def job51_read_chat_context(
        self,
        terminal: BrowserTerminal,
        history: dict | None = None,
        opened: dict | None = None,
    ) -> dict:
        page = terminal.current_page()
        text = safe_eval(page, "() => document.body ? document.body.innerText : ''") or ""
        header = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const nameNode = document.querySelector('div.im_userName span.username-text, div.im_userName, span.username-text');
          const selected = Array.from(document.querySelectorAll('#conversation-list .list-item')).find(el => {
            const cls = String(el.className || '');
            return /active|current|selected|checked/i.test(cls);
          });
          const jobNode = selected ? selected.querySelector('.jobname') : null;
          return {
            name: normalize(nameNode ? (nameNode.innerText || nameNode.textContent || '') : ''),
            selectedLabel: normalize(selected ? (selected.innerText || selected.textContent || '') : ''),
            selectedJob: normalize(jobNode ? (jobNode.innerText || jobNode.textContent || '') : '')
          };
        }""") or {}
        messages = self.job51_extract_chat_messages(terminal)
        opened = opened if isinstance(opened, dict) else {}
        opened_label = str(opened.get("label") or "")
        opened_job = str(opened.get("job") or "")
        selected_label = str((header or {}).get("selectedLabel") or "")
        selected_job = str((header or {}).get("selectedJob") or "")
        header_name = safe_text(str((header or {}).get("name") or ""), 60)
        opened_name = safe_text(str(recruiter_candidate_name_from_label(opened_label)), 60)
        selected_name = safe_text(str(recruiter_candidate_name_from_label(selected_label)), 60)
        applicant_name = safe_text(str(opened_name or header_name or selected_name), 60)
        applied_position = clean_applied_position(str(opened_job or ""))
        identity_warnings: list[dict] = []
        def privacy_mask_name_match(left_name: str, right_name: str) -> bool:
            left_name = safe_text(str(left_name or ""), 40)
            right_name = safe_text(str(right_name or ""), 40)
            if not left_name or not right_name:
                return False
            titles = ("先生", "女士", "同学")
            def masked_pair(real_name: str, masked_name: str) -> bool:
                return (
                    len(real_name) >= 2
                    and len(masked_name) >= 3
                    and masked_name.startswith(real_name[:1])
                    and any(masked_name.endswith(title) for title in titles)
                )
            return masked_pair(left_name, right_name) or masked_pair(right_name, left_name)

        def label_without_identity(value: str, *names: str) -> str:
            compact = compact_conversation_label(value)
            compact = re.sub(r"\d{1,2}:\d{2}", "", compact)
            for name in names:
                name = safe_text(str(name or ""), 40)
                if name:
                    compact = compact.replace(name, "", 1)
            for token in ("已投", "已读", "[新招呼]", "新招呼"):
                compact = compact.replace(token, "")
            return compact[:160]

        opened_body_key = label_without_identity(opened_label, opened_name)
        selected_body_key = label_without_identity(selected_label, selected_name, header_name)
        body_match = bool(
            opened_body_key
            and selected_body_key
            and (opened_body_key in selected_body_key or selected_body_key in opened_body_key)
        )
        job_match = bool(
            opened_job
            and selected_job
            and (
                clean_applied_position(opened_job) in clean_applied_position(selected_job)
                or clean_applied_position(selected_job) in clean_applied_position(opened_job)
                or job51_position_label_matches(opened_job, selected_job)
            )
        )
        def job51_context_names_match(left_name: str, right_name: str) -> bool:
            if recruiter_candidate_names_match(left_name, right_name):
                return True
            return bool(privacy_mask_name_match(left_name, right_name) and (body_match or job_match))

        if opened_name and header_name and not job51_context_names_match(opened_name, header_name):
            identity_warnings.append({
                "type": "opened_header_name_mismatch",
                "openedName": opened_name,
                "headerName": header_name,
            })
        if opened_name and selected_name and not job51_context_names_match(opened_name, selected_name):
            identity_warnings.append({
                "type": "opened_selected_name_mismatch",
                "openedName": opened_name,
                "selectedName": selected_name,
            })
        if not applied_position and not identity_warnings:
            applied_position = clean_applied_position(selected_job)
        if not applied_position and opened_label:
            for position in JOB51_CONFIGURED_POSITIONS:
                if clean_applied_position(position) in clean_applied_position(opened_label):
                    applied_position = clean_applied_position(position)
                    break
        if not applied_position and applicant_name:
            haystack = str(text or "")
            name_index = haystack.find(applicant_name)
            while name_index >= 0 and not applied_position:
                after_name = haystack[name_index: name_index + 900]
                communication_match = re.search(r"沟通职位[:：]\s*([^\r\n]{1,120})", after_name)
                if communication_match:
                    communication_text = clean_applied_position(communication_match.group(1))
                    for position in JOB51_CONFIGURED_POSITIONS:
                        if clean_applied_position(position) in communication_text:
                            applied_position = clean_applied_position(position)
                            break
                if applied_position:
                    break
                nearby = haystack[name_index: name_index + 240]
                for position in JOB51_CONFIGURED_POSITIONS:
                    if clean_applied_position(position) in clean_applied_position(nearby):
                        applied_position = clean_applied_position(position)
                        break
                name_index = haystack.find(applicant_name, name_index + max(1, len(applicant_name)))
        recent_source = str(history.get("text") or "") if isinstance(history, dict) and history.get("text") else text
        last_message = last_effective_chat_message(messages)
        last_other = last_effective_chat_message(messages, sender="other")
        boss_rules = load_boss_chat_rules()
        position_reply = select_position_reply(applied_position, boss_rules)
        company_knowledge_base = select_company_knowledge_base(boss_rules, applied_position)
        label = safe_text(opened_label or selected_label or applicant_name, 180)
        conversation_key = build_conversation_key(page.url, messages, label or applicant_name)
        context = {
            "title": page.title(),
            "url": page.url,
            "platform": "51job",
            "recentText": safe_text(recent_source, 1600),
            "pageTextPreview": safe_text(text, 900),
            "applicant": {
                "name": applicant_name,
                "appliedPosition": applied_position,
                "label": label,
                "source": "51job-chat",
                "openedLabel": safe_text(opened_label, 180),
                "openedName": opened_name,
                "headerName": header_name,
                "selectedLabel": safe_text(selected_label, 180),
                "selectedName": selected_name,
                "selectedJob": clean_applied_position(selected_job),
                "identityWarnings": identity_warnings,
                "headerNameMismatch": any(item.get("type") == "opened_header_name_mismatch" for item in identity_warnings),
            },
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
            "intent": classify_chat_intent(last_other.get("text", "") if last_other else ""),
            "conversationKey": conversation_key,
            "summary": f"51job 当前会话：{safe_text(label, 80)}；岗位：{safe_text(applied_position, 60)}",
        }
        context["memory"] = self.refresh_chat_memory(context, conversation_key)
        context["companyKnowledgeHit"] = match_company_knowledge_answer(context)
        return context

    @timed_agent_stage("job51_send_message", "51job 发送消息")
    def job51_send_message_with_verification(self, terminal: BrowserTerminal, text: str) -> dict:
        text = strip_reply_terminal_punctuation(str(text or "").strip())
        if not text:
            return {"blocked": True, "message": "51job 待发送内容为空"}
        page = terminal.current_page()
        if not self.job51_is_chat_page(page):
            return {"blocked": True, "message": "51job 当前不是聊天页，已停止避免误操作。", "url": safe_text(str(getattr(page, "url", "") or ""), 180)}
        self.job51_install_chat_navigation_guard(page, reason="before_send_message")
        self.job51_dismiss_interruptions(terminal, reason="before_send_message", chat_only=True)
        input_locator = page.locator("#drop-area.input-textarea_self, #drop-area, [contenteditable='true']").first
        try:
            if not input_locator.count():
                return {"blocked": True, "message": "51job 没有找到聊天输入框 #drop-area，已停止避免填错位置"}
            else:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(input_locator)
                    humanized_locator_click(terminal, input_locator, force=True)
                input_locator.fill("", timeout=8000)
                input_locator.type(text, delay=random.randint(CHAT_TYPE_DELAY_MS[0], CHAT_TYPE_DELAY_MS[1]), timeout=12000)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                label = "#drop-area.input-textarea_self"
        except Exception as error:
            return {
                "blocked": True,
                "message": f"51job 填写聊天输入框失败，已停止避免填错位置：{safe_text(str(error), 160)}",
            }
        page.wait_for_timeout(random.randint(260, 520))
        self.job51_dismiss_interruptions(terminal, reason="after_fill_before_send", chat_only=True)
        send_button = page.locator("button.el-button.new-send-button.el-button--primary, button.new-send-button").first
        if not send_button.count():
            send_package = self.send_current_chat_reply_with_verification(terminal, text, max_attempts=CHAT_SEND_MAX_ATTEMPTS)
            return {
                "message": "51job 已尝试通过通用发送按钮发送",
                "inputLabel": safe_text(label, 80),
                "send": send_package.get("send", {}),
                "verification": send_package.get("verification", {}),
                "attempts": send_package.get("attempts", []),
                "blocked": not bool((send_package.get("verification") or {}).get("verified")),
            }
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(send_button)
        try:
            send_button.click(timeout=8000, force=True)
        except Exception as error:
            send_package = self.send_current_chat_reply_with_verification(terminal, text, max_attempts=CHAT_SEND_MAX_ATTEMPTS)
            verified = bool((send_package.get("verification") or {}).get("verified"))
            if verified:
                return {
                    "message": "51job 发送按钮点击超时，已通过通用发送兜底完成",
                    "inputLabel": safe_text(label, 80),
                    "send": send_package.get("send", {}),
                    "verification": send_package.get("verification", {}),
                    "attempts": send_package.get("attempts", []),
                    "sendButtonError": safe_text(str(error), 180),
                    "blocked": False,
                }
            clear_chat_editor(terminal)
            return {
                "blocked": True,
                "message": f"51job 发送按钮点击超时，通用发送兜底也未校验成功，已清空输入框并跳过当前候选人：{safe_text(str(error), 160)}",
                "inputLabel": safe_text(label, 80),
                "send": send_package.get("send", {}),
                "verification": send_package.get("verification", {}),
                "attempts": send_package.get("attempts", []),
            }
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        page.wait_for_timeout(random.randint(720, 1120))
        current_input = safe_text(str(safe_eval(page, "() => String((document.querySelector('#drop-area') || {}).innerText || '')") or ""), 240)
        if normalize_reply_fingerprint(text) in normalize_reply_fingerprint(current_input):
            try:
                self.job51_dismiss_interruptions(terminal, reason="send_retry_blocked_by_overlay", chat_only=True)
            except Exception:
                pass
            try:
                send_button.click(timeout=8000, force=True)
                page.wait_for_timeout(random.randint(900, 1300))
            except Exception:
                pass
        verification = self.job51_verify_reply_sent_in_current_chat(terminal, text)
        return {
            "message": "51job 已发送并校验" if verification.get("verified") else "51job 已点击发送，但未在最近消息中校验到文本",
            "inputLabel": safe_text(label, 80),
            "send": {"message": "clicked 51job send button", "blocked": not bool(verification.get("verified"))},
            "verification": verification,
            "blocked": not bool(verification.get("verified")),
        }

    @timed_agent_stage("job51_send_common_word", "51job 发送常用语")
    def job51_send_common_word_with_verification(self, terminal: BrowserTerminal, phrase: str) -> dict:
        phrase = safe_text(str(phrase or "").strip(), 400)
        if not phrase:
            return {"blocked": True, "message": "51job 待发送常用语为空"}
        page = terminal.current_page()
        if not self.job51_is_chat_page(page):
            return {"blocked": True, "message": "51job 当前不是聊天页，未发送常用语，避免误操作。", "url": safe_text(str(getattr(page, "url", "") or ""), 180)}
        self.job51_install_chat_navigation_guard(page, reason="before_send_common_word")
        self.job51_dismiss_interruptions(terminal, reason="before_send_common_word", chat_only=True)
        if not self.job51_wait_chat_ready(terminal, timeout_ms=3500):
            return {
                "blocked": True,
                "message": "51job 当前不是单聊输入页，未发送常用语，避免在批量/列表页误操作。",
            }

        safe_eval(page, """() => {
          const editor = document.querySelector('#drop-area.input-textarea_self, #drop-area');
          if (!editor) return false;
          editor.focus();
          editor.innerHTML = '';
          editor.textContent = '';
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }""")

        button = {}
        if not is_job51_common_word_panel_open(terminal):
            button = self.measure_current_timing_stage(
                "job51_find_common_word_button",
                "51job 查找常用语按钮",
                lambda: find_job51_common_word_button(terminal),
            )
            if not button.get("found"):
                return {
                    "blocked": True,
                    "message": "51job 没有找到单聊工具栏里的“常用语”按钮。",
                    "state": button,
                }
            locator = button.get("locator")
            if locator is None:
                return {
                    "blocked": True,
                    "message": "51job 找到了“常用语”按钮信息，但没有拿到可点击元素。",
                    "state": {k: v for k, v in button.items() if k != "locator"},
                }
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(450, 800))
            if not is_job51_common_word_panel_open(terminal):
                try:
                    humanized_locator_click(terminal, locator, force=True)
                    page.wait_for_timeout(random.randint(500, 900))
                except Exception:
                    pass

        item = self.measure_current_timing_stage(
            "job51_find_common_word_item",
            "51job 查找常用语内容",
            lambda: find_job51_common_word_item(terminal, phrase),
        )
        if not item.get("found"):
            return {
                "blocked": True,
                "message": f"51job 常用语面板里没有找到这句话：{safe_text(phrase, 80)}",
                "state": item,
                "button": {k: v for k, v in button.items() if k != "locator"},
            }

        direct_send = self.measure_current_timing_stage(
            "job51_click_common_word_send",
            "51job 点击常用语发送",
            lambda: click_job51_common_word_send_button(terminal, phrase, item),
        )
        send_result: dict = {"directSend": direct_send}
        if not direct_send.get("clicked"):
            item_locator = item.get("locator")
            if item_locator is None:
                return {
                    "blocked": True,
                    "message": "51job 找到了常用语文本，但没有拿到可点击元素，也没有找到右侧发送按钮。",
                    "state": {k: v for k, v in item.items() if k != "locator"},
                    "directSend": direct_send,
                }
            try:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(item_locator)
                humanized_locator_click(terminal, item_locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(350, 650))
            except Exception as error:
                return {
                    "blocked": True,
                    "message": f"51job 点击常用语条目失败：{safe_text(str(error), 160)}",
                    "state": {k: v for k, v in item.items() if k != "locator"},
                    "directSend": direct_send,
                }
            editor_text = safe_text(str(safe_eval(
                page,
                "() => String((document.querySelector('#drop-area') || {}).innerText || '')",
            ) or ""), 500)
            if normalize_reply_fingerprint(phrase) not in normalize_reply_fingerprint(editor_text):
                return {
                    "blocked": True,
                    "message": f"51job 已点击常用语，但输入框没有出现目标内容：{safe_text(editor_text, 120)}",
                    "state": {k: v for k, v in item.items() if k != "locator"},
                    "directSend": direct_send,
                }
            send_button = page.locator("button.el-button.new-send-button.el-button--primary, button.new-send-button").first
            if not send_button.count():
                return {
                    "blocked": True,
                    "message": "51job 常用语已填入输入框，但没有找到发送按钮。",
                    "state": {k: v for k, v in item.items() if k != "locator"},
                    "directSend": direct_send,
                }
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(send_button)
            try:
                send_button.click(timeout=8000, force=True)
            except Exception as error:
                send_package = self.send_current_chat_reply_with_verification(terminal, phrase, max_attempts=CHAT_SEND_MAX_ATTEMPTS)
                verification = send_package.get("verification") if isinstance(send_package.get("verification"), dict) else {}
                if verification.get("verified"):
                    return {
                        "message": "51job 常用语发送按钮点击超时，已通过通用发送兜底完成",
                        "phrase": phrase,
                        "send": send_package.get("send", {}),
                        "verification": verification,
                        "attempts": send_package.get("attempts", []),
                        "state": {
                            "button": {k: v for k, v in button.items() if k != "locator"},
                            "item": {k: v for k, v in item.items() if k != "locator"},
                        },
                        "sendButtonError": safe_text(str(error), 180),
                        "blocked": False,
                    }
                clear_chat_editor(terminal)
                return {
                    "blocked": True,
                    "message": f"51job 常用语发送按钮点击超时，通用发送兜底也未校验成功，已清空输入框并跳过当前候选人：{safe_text(str(error), 160)}",
                    "phrase": phrase,
                    "send": send_package.get("send", {}),
                    "verification": verification,
                    "attempts": send_package.get("attempts", []),
                    "state": {
                        "button": {k: v for k, v in button.items() if k != "locator"},
                        "item": {k: v for k, v in item.items() if k != "locator"},
                    },
                }
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(800, 1300))
            send_result = {
                "message": "51job 已点击常用语条目并点击发送按钮",
                "directSend": direct_send,
                "filledThenSent": True,
            }
        else:
            page.wait_for_timeout(random.randint(800, 1300))
            send_result = {"message": "51job 已点击常用语右侧发送按钮", "directSend": direct_send}

        verification = self.job51_verify_reply_sent_in_current_chat(terminal, phrase)
        message = "51job 已通过常用语发送并校验" if verification.get("verified") else "51job 已触发常用语发送，但最近消息中未校验到文本"
        return {
            "message": message,
            "phrase": phrase,
            "send": send_result,
            "verification": verification,
            "state": {
                "button": {k: v for k, v in button.items() if k != "locator"},
                "item": {k: v for k, v in item.items() if k != "locator"},
            },
            "blocked": not bool(verification.get("verified")),
        }

    def job51_request_resume_from_current_conversation_safe(self, terminal: BrowserTerminal, page=None) -> dict:
        page = page or terminal.current_page()
        if not self.job51_is_chat_page(page):
            return {
                "blocked": True,
                "message": "51job 当前不是聊天页，未点击求简历，避免误操作。",
                "url": safe_text(str(getattr(page, "url", "") or ""), 180),
            }
        self.job51_install_chat_navigation_guard(page, reason="before_request_resume")
        self.job51_dismiss_interruptions(terminal, reason="before_request_resume", chat_only=True)
        candidate = self.job51_read_chat_context(terminal).get("applicant", {})
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        token = f"codex_job51_request_resume_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        state = safe_eval(page, """(args) => {
          const token = args.token;
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const text = normalize(document.body ? document.body.innerText : '');
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0';
          };
          const targetText = node => {
            const parts = [];
            let current = node;
            for (let depth = 0; current && depth < 6; depth += 1) {
              if (current.nodeType !== 1) {
                current = current.parentElement;
                continue;
              }
              parts.push(
                current.id,
                current.className,
                current.getAttribute && current.getAttribute('href'),
                current.getAttribute && current.getAttribute('data-href'),
                current.getAttribute && current.getAttribute('data-url'),
                current.getAttribute && current.getAttribute('onclick'),
                current.getAttribute && current.getAttribute('aria-label'),
                current.getAttribute && current.getAttribute('title'),
                current.innerText,
                current.textContent
              );
              current = current.parentElement;
            }
            return normalize(parts.filter(Boolean).join(' '));
          };
          const buttons = [];
          let selected = null;
          const nodes = Array.from(document.querySelectorAll('div.operate-item, button, [role="button"]'));
          for (const el of nodes) {
            if (!visible(el)) continue;
            const label = normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
            if (!label) continue;
            const haystack = targetText(el);
            const disabled = !!el.disabled || el.classList.contains('is-disabled') || /is-disabled|disabled/i.test(String(el.className || ''));
            const forbidden = !!(
              el.closest('#conversation-list,.conversation-list,[class*="conversation-list" i],#IMMessageList,[id*="IMMessageList"],div.message-item,div.im-message-item,.im-message-item,[class*="message-item" i],nav,header,.menu,.sidebar,.chat-user-operate')
              || /Revision\\/talent\\/(management|search-recommend)|人才管理|人才望远镜|在线简历|保存|下载|预览/.test(haystack)
            );
            const requestCandidate = /简历/.test(label)
              && /(求|要|索|获取|申请|请求)/.test(label)
              && !/在线简历|下载|保存|预览/.test(label);
            const item = {
              index: buttons.length,
              text: label,
              disabled,
              forbidden,
              requestCandidate,
              id: String(el.id || ''),
              className: String(el.className || '').slice(0, 120)
            };
            buttons.push(item);
            if (!selected && !disabled && !forbidden && requestCandidate) {
              selected = { ...item };
              el.setAttribute('data-codex-job51-request-resume', token);
            }
          }
          return { text, buttons, selected, token };
        }""", {"token": token}) or {}
        body_text = str(state.get("text") or "") if isinstance(state, dict) else ""
        if any(marker in body_text for marker in ("已求简历", "已索要简历", "简历已发送", "已收到简历")):
            return {
                "message": f"51job 检测到已求过或已收到简历，跳过重复点击：{safe_text(candidate_label, 80)}",
                "skipped": True,
                "skipReason": "already_requested",
                "candidate": candidate,
            }
        buttons = state.get("buttons") if isinstance(state, dict) and isinstance(state.get("buttons"), list) else []
        selected = state.get("selected") if isinstance(state, dict) and isinstance(state.get("selected"), dict) else {}
        target_text = str(selected.get("text") or "")
        if not selected:
            return {
                "blocked": True,
                "message": f"51job 当前会话未找到可用的求简历按钮：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "buttons": buttons[:12],
            }
        locator = page.locator(f"[data-codex-job51-request-resume='{token}']").first
        if not locator.count():
            return {
                "blocked": True,
                "message": f"51job 求简历目标按钮已失效，未点击，避免误操作：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "buttons": buttons[:12],
                "selected": selected,
            }
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        click_result = locator.evaluate("""el => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const haystack = normalize([
            el.id,
            el.className,
            el.getAttribute && el.getAttribute('href'),
            el.getAttribute && el.getAttribute('data-href'),
            el.getAttribute && el.getAttribute('data-url'),
            el.getAttribute && el.getAttribute('onclick'),
            el.getAttribute && el.getAttribute('aria-label'),
            el.getAttribute && el.getAttribute('title'),
            el.innerText,
            el.textContent
          ].filter(Boolean).join(' '));
          if (/Revision\\/talent\\/(management|search-recommend)|人才管理|人才望远镜|在线简历|保存|下载|预览/.test(haystack)) {
            return { ok: false, reason: 'blocked_request_resume_target', text: haystack.slice(0, 160) };
          }
          el.scrollIntoView({ block: 'center', inline: 'center' });
          if (typeof el.click === 'function') el.click();
          else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return { ok: true, text: haystack.slice(0, 160) };
        }""")
        if isinstance(click_result, dict) and not click_result.get("ok"):
            return {
                "blocked": True,
                "message": f"51job 求简历目标被安全规则拦截，未点击：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "clickedText": safe_text(target_text, 80),
                "click": click_result,
                "buttons": buttons[:12],
            }
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        page.wait_for_timeout(random.randint(900, 1400))
        confirm = page.locator("button").filter(has_text=re.compile("确定|确认|发送|索要|求简历")).first
        confirmed = False
        try:
            if confirm.count():
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(confirm)
                humanized_locator_click(terminal, confirm, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(900, 1400))
                confirmed = True
        except Exception:
            confirmed = False
        message = f"51job 已点击求简历：{safe_text(candidate_label, 80)}"
        if confirmed:
            message += "，并处理了确认按钮"
        return {
            "message": message,
            "candidate": candidate,
            "clickedText": safe_text(target_text, 80),
            "confirmed": confirmed,
            "click": click_result if isinstance(click_result, dict) else {},
            "selected": selected,
        }

    def job51_request_resume_from_current_conversation(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        return self.job51_request_resume_from_current_conversation_safe(terminal, page)
        candidate = self.job51_read_chat_context(terminal).get("applicant", {})
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        state = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const text = normalize(document.body ? document.body.innerText : '');
          const visible = el => {
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const buttons = Array.from(document.querySelectorAll('div.operate-item, button, [role="button"]'))
            .filter(visible)
            .map((el, index) => ({ index, text: normalize(el.innerText || el.textContent || ''), disabled: !!el.disabled || el.classList.contains('is-disabled') }))
            .filter(item => item.text);
          return { text, buttons };
        }""") or {}
        body_text = str(state.get("text") or "") if isinstance(state, dict) else ""
        if re.search(r"(已.{0,6}求.{0,4}简历|已.{0,6}索.{0,4}简历|简历.{0,6}已发送|已收到.{0,4}简历)", body_text):
            return {
                "message": f"51job 检测到已求过或已收到简历，跳过重复点击：{safe_text(candidate_label, 80)}",
                "skipped": True,
                "skipReason": "already_requested",
                "candidate": candidate,
            }
        buttons = state.get("buttons") if isinstance(state, dict) and isinstance(state.get("buttons"), list) else []
        target_index = None
        target_text = ""
        for item in buttons:
            label = str(item.get("text") or "")
            if item.get("disabled"):
                continue
            if "简历" in label and re.search(r"(求|要|索|获取|交换|申请|请求)", label):
                target_index = int(item.get("index") or 0)
                target_text = label
                break
        if target_index is None:
            return {
                "blocked": True,
                "message": f"51job 当前会话未找到可用的求简历按钮：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "buttons": buttons[:12],
            }
        locator = page.locator('div.operate-item, button, [role="button"]').nth(target_index)
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        page.wait_for_timeout(random.randint(900, 1400))
        confirm = page.locator("button").filter(has_text=re.compile("确定|确认|发送|索要|求简历")).first
        confirmed = False
        try:
            if confirm.count():
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(confirm)
                humanized_locator_click(terminal, confirm, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(900, 1400))
                confirmed = True
        except Exception:
            confirmed = False
        message = f"51job 已点击求简历：{safe_text(candidate_label, 80)}"
        if confirmed:
            message += "，并处理了确认按钮"
        return {
            "message": message,
            "candidate": candidate,
            "clickedText": safe_text(target_text, 80),
            "confirmed": confirmed,
        }

    def job51_find_resume_attachment(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        token = f"codex_job51_resume_attachment_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        info = safe_eval(page, """(args) => {
          const token = args.token;
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8
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
          const textOf = el => normalize(el ? (el.innerText || el.textContent || '') : '');
          const attrText = el => normalize([
            el.getAttribute('aria-label'),
            el.getAttribute('title'),
            el.getAttribute('download'),
            el.getAttribute('href'),
            el.getAttribute('data-url'),
            el.getAttribute('data-href'),
            el.className
          ].filter(Boolean).join(' '));
          const candidates = [];
          const seen = new Set();
          const messageAreaSelector = [
            '#IMMessageList',
            '[id*="IMMessageList"]',
            'div.message-item',
            'div.im-message-item',
            '.im-message-item',
            '[class*="message-item" i]'
          ].join(',');
          const selector = [
            'a',
            'button',
            '[role="button"]',
            '[onclick]',
            '[class*="resume" i]',
            '[class*="jianli" i]',
            '[class*="attach" i]',
            '[class*="file" i]',
            '[class*="download" i]',
            '.item-container-resume',
            '.resume-card'
          ].join(',');
          for (const el of Array.from(document.querySelectorAll(selector))) {
            if (!visible(el)) continue;
            if (el.closest('#conversation-list,.conversation-list,[class*="conversation-list" i],nav,header,.menu,.sidebar,.chat-user-operate')) continue;
            const clickable = el.closest('a,button,[role="button"],[onclick]') || el;
            if (!visible(clickable)) continue;
            if (clickable.id === 'sensor_Bchat_newzxjl' || clickable.closest('.chat-user-operate')) continue;
            const key = clickable.tagName + ':' + rect(clickable).x + ':' + rect(clickable).y + ':' + normalize(clickable.outerHTML || '').slice(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);

            const messageRoot = el.closest(messageAreaSelector) || clickable.closest(messageAreaSelector);
            if (!messageRoot) continue;
            const rootText = textOf(messageRoot || el);
            const ownText = textOf(el);
            const clickableText = textOf(clickable);
            const href = clickable.href || clickable.getAttribute('href') || el.href || el.getAttribute('href') || '';
            const download = clickable.getAttribute('download') || el.getAttribute('download') || '';
            const className = String(clickable.className || el.className || '');
            const haystack = normalize([ownText, clickableText, rootText, attrText(el), attrText(clickable), href, download].join(' '));
            if (/Revision\/talent\/management|Revision\/talent\/search-recommend|人才管理|人才望远镜/.test(haystack)) continue;
            const hasResumeWord = /(附件简历|简历附件|在线简历|简历|resume|cv|附件|文件)/i.test(haystack);
            const hasFileExt = /\\.(pdf|docx?|PDF|DOCX?)(\\?|#|$|\\s)/.test(haystack);
            const hasDownloadWord = /(下载|download|导出|保存)/i.test(haystack);
            if (!hasResumeWord && !hasFileExt) continue;
            if (/(求简历|索要简历|要简历|请求简历|发送简历|上传简历)/.test(haystack) && !hasFileExt && !/(附件|下载|在线简历)/.test(haystack)) continue;

            let score = 0;
            if (hasFileExt) score += 110;
            if (/附件简历|简历附件/.test(haystack)) score += 100;
            if (hasDownloadWord) score += 80;
            if (/在线简历/.test(haystack)) score += 45;
            if (/附件|文件/.test(haystack)) score += 35;
            if (messageRoot) score += 30;
            if (/others/.test(String(messageRoot?.className || ''))) score += 12;
            if (/download|resume|attach|file/i.test(className)) score += 12;
            if (clickable.matches('a,button,[role="button"]')) score += 10;
            if (/(职位管理|职位发布|批量|全部岗位|未读|主动联系|人才望远镜)/.test(haystack)) score -= 120;
            if (score < 40) continue;

            const box = rect(clickable);
            candidates.push({
              score,
              text: normalize(ownText || clickableText || rootText).slice(0, 240),
              rootText: rootText.slice(0, 360),
              href,
              download,
              tag: clickable.tagName,
              className: className.slice(0, 160),
              rect: box,
              element: clickable
            });
          }
          candidates.sort((a, b) => (b.score - a.score) || ((b.rect?.y || 0) - (a.rect?.y || 0)));
          const best = candidates[0];
          if (!best) return { found: false, reason: 'resume_attachment_not_found', candidates: [] };
          best.element.setAttribute('data-codex-job51-resume-attachment', token);
          return {
            found: true,
            token,
            candidate: {
              score: best.score,
              text: best.text,
              rootText: best.rootText,
              href: best.href,
              download: best.download,
              tag: best.tag,
              className: best.className,
              rect: best.rect
            },
            candidates: candidates.slice(0, 8).map(item => ({
              score: item.score,
              text: item.text,
              rootText: item.rootText,
              href: item.href,
              download: item.download,
              tag: item.tag,
              className: item.className,
              rect: item.rect
            }))
          };
        }""", {"token": token})
        return info if isinstance(info, dict) else {"found": False, "reason": "resume_attachment_scan_failed"}

    def job51_find_preview_download_button(self, page) -> dict:
        token = f"codex_job51_preview_download_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        info = safe_eval(page, """(args) => {
          const token = args.token;
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8
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
          for (const el of Array.from(document.querySelectorAll('a,button,[role="button"],[onclick],[class*="download" i]'))) {
            if (!visible(el)) continue;
            const text = normalize([
              el.innerText,
              el.textContent,
              el.getAttribute('aria-label'),
              el.getAttribute('title'),
              el.getAttribute('download'),
              el.getAttribute('href'),
              el.className
            ].filter(Boolean).join(' '));
            let score = 0;
            if (/(下载|download|保存|导出)/i.test(text)) score += 90;
            if (/\\.(pdf|docx?|PDF|DOCX?)(\\?|#|$|\\s)/.test(text)) score += 70;
            if (/(简历|resume|cv)/i.test(text)) score += 20;
            if (/(取消|关闭|发送|求简历|职位|筛选|刷新)/.test(text)) score -= 80;
            if (score < 50) continue;
            candidates.push({
              score,
              text: text.slice(0, 160),
              href: el.href || el.getAttribute('href') || '',
              download: el.getAttribute('download') || '',
              tag: el.tagName,
              className: String(el.className || '').slice(0, 140),
              rect: rect(el),
              element: el
            });
          }
          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0];
          if (!best) return { found: false, reason: 'preview_download_button_not_found', candidates: [] };
          best.element.setAttribute('data-codex-job51-preview-download', token);
          return {
            found: true,
            token,
            candidate: {
              score: best.score,
              text: best.text,
              href: best.href,
              download: best.download,
              tag: best.tag,
              className: best.className,
              rect: best.rect
            },
            candidates: candidates.slice(0, 5).map(item => ({
              score: item.score,
              text: item.text,
              href: item.href,
              download: item.download,
              tag: item.tag,
              className: item.className,
              rect: item.rect
            }))
          };
        }""", {"token": token})
        return info if isinstance(info, dict) else {"found": False, "reason": "preview_download_scan_failed"}

    def job51_fetch_attachment_href(self, page, href: str, original_name: str = "") -> dict:
        href = str(href or "").strip()
        if not href or href.startswith(("blob:", "javascript:", "#")):
            return {"ok": False, "reason": "unsupported_href"}
        absolute_url = urljoin(str(getattr(page, "url", "") or JOB51_CHAT_URL), href)
        suffix = resume_attachment_suffix(original_name, absolute_url)
        if suffix not in LOCAL_FILE_EXTENSIONS:
            return {"ok": False, "reason": "href_not_resume_file", "url": safe_text(absolute_url, 240)}
        response = page.context.request.get(absolute_url, timeout=15000)
        if not response.ok:
            return {"ok": False, "reason": f"http_{response.status}", "url": safe_text(absolute_url, 240)}
        body = response.body()
        if not body:
            return {"ok": False, "reason": "empty_response", "url": safe_text(absolute_url, 240)}
        headers = response.headers or {}
        filename = response_attachment_filename(headers, original_name or absolute_url)
        final_suffix = resume_attachment_suffix(filename, original_name, absolute_url)
        head = bytes(body[:32])
        if head.lstrip().startswith((b"<html", b"<!doctype", b"<body", b"<script")):
            return {"ok": False, "reason": "href_response_is_html_not_resume", "url": safe_text(absolute_url, 240), "filename": filename}
        if final_suffix == ".pdf" and not head.startswith(b"%PDF-"):
            return {"ok": False, "reason": "href_pdf_signature_invalid", "url": safe_text(absolute_url, 240), "filename": filename}
        if final_suffix == ".docx" and not head.startswith(b"PK"):
            return {"ok": False, "reason": "href_docx_signature_invalid", "url": safe_text(absolute_url, 240), "filename": filename}
        if final_suffix == ".doc" and not head.startswith(b"\xd0\xcf\x11\xe0"):
            return {"ok": False, "reason": "href_doc_signature_invalid", "url": safe_text(absolute_url, 240), "filename": filename}
        return {
            "ok": True,
            "bytes": body,
            "filename": filename,
            "url": safe_text(absolute_url, 240),
            "contentType": safe_text(headers.get("content-type", ""), 120),
        }

    def job51_fetch_visible_resume_blob_pdf(self, page, filename_hint: str = "") -> dict:
        payload = safe_eval(page, """async (args) => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 80 && box.height > 80
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && box.bottom >= 0
              && box.right >= 0
              && box.top <= window.innerHeight
              && box.left <= window.innerWidth;
          };
          const frames = Array.from(document.querySelectorAll('iframe,embed,object'))
            .map(el => ({
              el,
              src: el.src || el.data || el.getAttribute('src') || el.getAttribute('data') || '',
              title: normalize(el.title || el.getAttribute('aria-label') || ''),
              className: String(el.className || '')
            }))
            .filter(item => item.src && String(item.src).startsWith('blob:') && visible(item.el));
          const target = frames[0];
          if (!target) return { ok: false, reason: 'visible_resume_blob_not_found' };
          try {
            const response = await fetch(target.src);
            const buffer = await response.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const isPdf = bytes.length >= 5
              && bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45;
            if (!isPdf) {
              return {
                ok: false,
                reason: 'blob_is_not_pdf',
                src: target.src,
                contentType: response.headers.get('content-type') || '',
                size: bytes.length
              };
            }
            let binary = '';
            const chunkSize = 0x8000;
            for (let index = 0; index < bytes.length; index += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
            }
            return {
              ok: true,
              src: target.src,
              contentType: response.headers.get('content-type') || 'application/pdf',
              size: bytes.length,
              filename: args.filenameHint || '51job_resume.pdf',
              base64: btoa(binary)
            };
          } catch (error) {
            return { ok: false, reason: 'blob_fetch_failed', src: target.src, error: String(error && error.message || error) };
          }
        }""", {"filenameHint": filename_hint or "51job_resume.pdf"})
        if not isinstance(payload, dict) or not payload.get("ok"):
            return payload if isinstance(payload, dict) else {"ok": False, "reason": "visible_resume_blob_scan_failed"}
        try:
            content = base64.b64decode(str(payload.get("base64") or ""), validate=True)
        except Exception as error:
            return {"ok": False, "reason": "blob_base64_decode_failed", "error": safe_text(str(error), 160)}
        if not content.startswith(b"%PDF-"):
            return {"ok": False, "reason": "blob_decoded_not_pdf", "size": len(content)}
        return {
            "ok": True,
            "bytes": content,
            "filename": sanitize_filename(str(payload.get("filename") or filename_hint or "51job_resume.pdf")),
            "url": safe_text(str(payload.get("src") or ""), 240),
            "contentType": safe_text(str(payload.get("contentType") or "application/pdf"), 120),
            "size": len(content),
        }

    def job51_resume_download_memory_keys(
        self,
        context: dict | None,
        candidate_name: str = "",
        applied_position: str = "",
    ) -> list[str]:
        context = context if isinstance(context, dict) else {}
        applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        label = safe_text(str(applicant.get("label") or ""), 180)
        conversation_key = safe_text(str(context.get("conversationKey") or ""), 160)
        candidate_name = safe_text(str(candidate_name or applicant.get("name") or recruiter_candidate_name_from_label(label)), 60)
        applied_position = safe_text(str(applied_position or applicant.get("appliedPosition") or context.get("appliedPosition") or ""), 100)
        identity = build_recruiter_candidate_identity(context, label, conversation_key)
        raw_keys = [
            str(identity.get("identityKey") or ""),
            conversation_key,
            compact_conversation_label(label),
            compact_conversation_label(f"{candidate_name}|{applied_position}"),
        ]
        keys: list[str] = []
        for raw in raw_keys:
            raw = str(raw or "").strip()
            if not raw:
                continue
            key = "job51_resume_download|" + stable_digest(raw, 24)
            if key not in keys:
                keys.append(key)
        return keys

    def job51_find_downloaded_resume_memory(
        self,
        context: dict | None,
        candidate_name: str = "",
        applied_position: str = "",
    ) -> dict:
        context = context if isinstance(context, dict) else {}
        candidate_name = safe_text(str(candidate_name or ""), 60)
        applied_position = clean_applied_position(str(applied_position or ""))
        index: dict = {}
        for memory_file in scoped_json_siblings(JOB51_RESUME_DOWNLOADS_FILE):
            data = load_json(memory_file, {})
            if isinstance(data, dict):
                index.update(data)
        for key in self.job51_resume_download_memory_keys(context, candidate_name, applied_position):
            item = index.get(key)
            if not isinstance(item, dict):
                continue
            file_path = Path(str(item.get("filePath") or ""))
            if file_path.exists() and file_path.is_file():
                item_name = safe_text(str(item.get("candidateName") or ""), 60)
                item_position = clean_applied_position(str(item.get("appliedPosition") or ""))
                if item_name and candidate_name and not recruiter_candidate_names_match(item_name, candidate_name):
                    continue
                if item_position and applied_position and item_position != clean_applied_position(applied_position):
                    continue
                metadata_matcher = globals().get("job51_resume_download_metadata_matches_candidate")
                if callable(metadata_matcher):
                    metadata_match = bool(metadata_matcher(item, candidate_name, applied_position))
                else:
                    metadata_match = bool(item_name or item_position)
                path_matcher = globals().get("job51_resume_path_matches_candidate")
                if callable(path_matcher):
                    path_match = bool(path_matcher(file_path, candidate_name, applied_position))
                else:
                    path_stem = re.sub(r"\s+", "", file_path.stem).lower()
                    name_key = re.sub(r"\s+", "", safe_resume_file_part(candidate_name, "")).lower()
                    position_key = re.sub(r"\s+", "", safe_resume_file_part(applied_position, "")).lower()
                    path_match = bool(name_key and name_key in path_stem and (not position_key or position_key in path_stem))
                if not metadata_match and not path_match:
                    continue
                return {
                    **item,
                    "memoryKey": key,
                    "fileHash": str(item.get("fileHash") or job51_resume_file_hash(file_path)),
                    "fileSize": int(item.get("fileSize") or file_path.stat().st_size or 0),
                    "source": "job51_resume_download_index",
                }
        if candidate_name and candidate_name != "未知候选人" and applied_position and applied_position != "未知岗位":
            account_part = safe_resume_file_part(f"{AGENT_ACCOUNT_ID}_{AGENT_ACCOUNT_NAME}", AGENT_ACCOUNT_ID)
            folders = [JOB51_RESUME_DIR / account_part]
            try:
                folders.extend(path for path in JOB51_RESUME_DIR.iterdir() if path.is_dir() and path not in folders)
            except Exception:
                pass
            name_part = safe_resume_file_part(candidate_name, "未知候选人")
            position_part = safe_resume_file_part(applied_position, "未知岗位")
            matches: list[Path] = []
            try:
                for folder in folders:
                    if not folder.exists():
                        continue
                    matches.extend(
                        path
                        for path in folder.glob(f"{name_part}_{position_part}_51job_*")
                        if path.is_file() and path.suffix.lower() in LOCAL_FILE_EXTENSIONS
                    )
                matches = sorted(matches, key=lambda path: path.stat().st_mtime, reverse=True)
            except Exception:
                matches = []
            if matches:
                latest = matches[0]
                return {
                    "candidateName": candidate_name,
                    "appliedPosition": applied_position,
                    "filePath": str(latest),
                    "filename": latest.name,
                    "fileHash": job51_resume_file_hash(latest),
                    "fileSize": latest.stat().st_size,
                    "downloadedAt": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(latest.stat().st_mtime)),
                    "source": "job51_resume_folder_match",
                }
        return {}

    def job51_validate_resume_download_context(
        self,
        context: dict | None,
        candidate_name: str,
        applied_position: str,
    ) -> dict:
        context = context if isinstance(context, dict) else {}
        applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        label = safe_text(str(applicant.get("label") or ""), 180)
        warnings = applicant.get("identityWarnings") if isinstance(applicant.get("identityWarnings"), list) else []
        candidate_name = safe_text(str(candidate_name or ""), 60)
        applied_position = clean_applied_position(str(applied_position or ""))
        if not candidate_name or candidate_name == "未知候选人":
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_candidate_name_unknown",
                "message": "51job 当前候选人姓名未识别，已停止下载，避免把附件记到错误候选人名下。",
            }
        if not applied_position or applied_position == "未知岗位":
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_position_unknown",
                "message": "51job 当前沟通岗位未识别，已停止下载，避免把附件记到错误岗位名下。",
            }
        if warnings:
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_candidate_identity_mismatch",
                "message": "51job 当前聊天头部与刚打开的联系人不一致，已停止下载，等待页面同步后再处理。",
                "warnings": warnings,
            }
        if label and not candidate_label_matches(label, candidate_name):
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_candidate_label_mismatch",
                "message": "51job 当前候选人姓名与会话列表标签不一致，已停止下载，避免串人保存。",
                "label": label,
                "candidateName": candidate_name,
            }
        return {
            "ok": True,
            "candidateName": candidate_name,
            "appliedPosition": applied_position,
            "label": label,
        }

    def job51_mark_resume_downloaded(self, context: dict | None, result: dict) -> dict:
        context = context if isinstance(context, dict) else {}
        result = result if isinstance(result, dict) else {}
        applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_label = safe_text(str(applicant.get("label") or result.get("candidateLabel") or ""), 180)
        candidate_name = safe_text(str(result.get("candidateName") or applicant.get("name") or recruiter_candidate_name_from_label(candidate_label)), 60)
        applied_position = clean_applied_position(str(result.get("appliedPosition") or applicant.get("appliedPosition") or context.get("appliedPosition") or ""))
        conversation_key = safe_text(str(context.get("conversationKey") or ""), 160)
        file_path = Path(str(result.get("filePath") or ""))
        file_hash = str(result.get("fileHash") or "")
        file_size = int(result.get("fileSize") or 0)
        if file_path.exists() and file_path.is_file():
            file_hash = file_hash or job51_resume_file_hash(file_path)
            try:
                file_size = file_size or file_path.stat().st_size
            except Exception:
                file_size = file_size or 0
        recent_messages = []
        for message in (context.get("messages") if isinstance(context.get("messages"), list) else [])[-20:]:
            if not isinstance(message, dict):
                continue
            text = safe_text(str(message.get("text") or message.get("rawText") or "").strip(), 260)
            if not text:
                continue
            sender = str(message.get("sender") or "")
            if sender not in {"me", "other", "system"}:
                sender = "other"
            if sender == "system":
                continue
            recent_messages.append({
                "sender": sender,
                "time": safe_text(str(message.get("time") or message.get("timestamp") or ""), 40),
                "status": safe_text(str(message.get("status") or ""), 40),
                "text": text,
            })
        recent_messages = recent_messages[-3:]
        downloaded_at = time.strftime("%Y-%m-%d %H:%M:%S")
        item = {
            "platform": "51job",
            "accountId": AGENT_ACCOUNT_ID,
            "accountName": AGENT_ACCOUNT_NAME,
            "candidateName": candidate_name,
            "candidateLabel": candidate_label,
            "appliedPosition": applied_position,
            "conversationKey": conversation_key,
            "filePath": str(result.get("filePath") or ""),
            "filename": str(result.get("filename") or ""),
            "fileHash": file_hash,
            "fileSize": file_size,
            "downloadMethod": str(result.get("downloadMethod") or ""),
            "downloadedAt": downloaded_at,
            "recentMessages": recent_messages,
            "platformContact": {
                "displayName": candidate_name,
                "label": candidate_label,
                "appliedPosition": applied_position,
                "capturedAt": downloaded_at,
                "chatEvidence": recent_messages,
            } if candidate_name else {},
        }
        index = load_json(JOB51_RESUME_DOWNLOADS_FILE, {})
        if not isinstance(index, dict):
            index = {}
        keys = self.job51_resume_download_memory_keys(context, candidate_name, applied_position)
        for key in keys:
            index[key] = item
        save_json(JOB51_RESUME_DOWNLOADS_FILE, index)
        self.set_recruiter_basic_state(
            conversation_key,
            candidate_label or candidate_name,
            "job51_resume_downloaded",
            context=context,
            platform="51job",
            resumeDownloaded=True,
            resumeFilePath=item["filePath"],
            resumeFilename=item["filename"],
            resumeDownloadMethod=item["downloadMethod"],
        )
        return {"keys": keys, "item": item}

    def job51_close_resume_download_surfaces(self, terminal: BrowserTerminal, origin_page=None) -> dict:
        origin_page = origin_page or terminal.current_page()
        context = origin_page.context
        closed_pages: list[dict] = []
        for page in list(context.pages):
            if page == origin_page:
                continue
            try:
                url = str(getattr(page, "url", "") or "")
                title = page.title()
            except Exception:
                url = ""
                title = ""
            haystack = f"{url} {title}"
            is_stale_talent_management = (
                "ehire.51job.com" in url
                and "/Revision/chat" not in url
                and "/Revision/talent/management" in url
            )
            should_close = (
                is_stale_talent_management
                or (
                    "ehire.51job.com" in url
                    and "/Revision/chat" not in url
                    and re.search(r"(resume|jianli|preview|download|pdf|doc|简历|预览)", haystack, flags=re.I)
                )
            )
            if not should_close:
                continue
            try:
                page.close()
                closed_pages.append({"url": safe_text(url, 180), "title": safe_text(title, 80)})
            except Exception:
                pass
        try:
            origin_page.bring_to_front()
        except Exception:
            pass
        clicked = safe_eval(origin_page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return box.width > 8 && box.height > 8 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const roots = Array.from(document.querySelectorAll([
            '.con.con-ehire',
            '.con-close',
            '.annex-resume',
            '.el-dialog__wrapper',
            '.el-dialog',
            '.resume-common-dialog',
            '.IM-resume-operation',
            '.con-container',
            '.new-resume-online-main-ui',
            '.resume-detail-wrap',
            '[class*="resume-detail" i]',
            '[class*="resume-online" i]',
            '[class*="preview" i]'
          ].join(','))).filter(root => {
            if (!visible(root)) return false;
            const text = normalize(root.innerText || root.textContent || '');
            const className = String(root.className || '');
            return /con-ehire|con-close|IM-resume|resume|cv/i.test(className)
              || /(简历|附件|预览|下载|求职意向|个人优势|工作经历|resume|cv)/i.test(text + ' ' + className);
          });
          let clicked = 0;
          for (const root of roots) {
            const candidates = Array.from(root.querySelectorAll('button,a,[role="button"],i,span,div')).filter(el => {
              if (!visible(el)) return false;
              const text = normalize([el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.className].filter(Boolean).join(' '));
              if (/(关闭|close|container-close|el-dialog__headerbtn|icon-close|btn-close|\\bclose\\b|×|x)/i.test(text)) return true;
              return false;
            }).sort((a, b) => {
              const ar = a.getBoundingClientRect();
              const br = b.getBoundingClientRect();
              return (br.y - ar.y) || (br.x - ar.x);
            });
            const target = candidates[0];
            if (!target) continue;
            target.click();
            clicked += 1;
            break;
          }
          return { clicked };
        }""") or {}
        try:
            origin_page.wait_for_timeout(random.randint(300, 650))
        except Exception:
            pass
        return {
            "closedPages": closed_pages,
            "closedInlineSurfaces": int((clicked if isinstance(clicked, dict) else {}).get("clicked") or 0),
        }

    def job51_resume_download_suitability_guard(
        self,
        terminal: BrowserTerminal,
        context: dict | None,
        previous_state: dict | None = None,
        accepted_by_flow: dict | None = None,
    ) -> dict:
        context = context if isinstance(context, dict) else {}
        if isinstance(accepted_by_flow, dict) and accepted_by_flow.get("accepted"):
            return {
                "allowed": True,
                "reason": accepted_by_flow.get("reason") or "accepted_by_current_screening_flow",
                "source": accepted_by_flow.get("source") or "current_flow",
                "screening": accepted_by_flow.get("screening") if isinstance(accepted_by_flow.get("screening"), dict) else {},
            }

        candidate = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        conversation_key = str(context.get("conversationKey") or "")
        candidate_state_key = recruiter_basic_candidate_state_key(candidate_label)
        previous_state = previous_state if isinstance(previous_state, dict) else (
            self.get_chat_state(conversation_key) or self.get_chat_state(candidate_state_key)
        )
        status = str((previous_state or {}).get("status") or "")
        if status.startswith(("position_screening_accepted", "basic_conditions_accepted")) or status == "job51_resume_downloaded":
            return {
                "allowed": True,
                "reason": "previous_state_accepted",
                "source": "chat_state",
                "stateStatus": status,
            }

        position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        screening_rules = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        messages = context.get("messages", []) if isinstance(context.get("messages"), list) else []

        if should_use_position_screening_flow(context, position_reply):
            analysis = analyze_position_screening(messages, screening_rules)
            if analysis.get("status") != "not_asked" and context.get("lastSender") == "other":
                try:
                    analysis = enhance_position_screening_with_model(context, screening_rules, analysis, previous_state)
                except Exception as error:
                    analysis = {
                        **analysis,
                        "modelEnhanceError": safe_text(str(error), 160),
                    }
            return {
                "allowed": analysis.get("status") == "accept",
                "reason": analysis.get("reason") or analysis.get("status") or "position_screening_unknown",
                "source": "position_screening",
                "screening": analysis,
                "message": "51job 当前候选人尚未通过岗位筛选，不能下载简历。" if analysis.get("status") != "accept" else "",
            }

        if is_explicit_ai_app_basic_conditions_position(context):
            phrase = str(position_reply.get("initialCommonPhrase") or BASIC_CONDITIONS_PHRASE).strip()
            screening = analyze_basic_condition_screening(messages, phrase)
        screening = apply_basic_waiting_state_to_screening(screening, previous_state, context)
        if screening.get("status") != "not_asked" and context.get("lastSender") == "other":
            rule_screening = screening
            try:
                screening = enhance_basic_condition_screening_with_model(context, phrase, screening, previous_state)
                screening = preserve_zhilian_basic_acceptance_after_model(screening, rule_screening, platform="job51")
            except Exception as error:
                screening = {
                    **screening,
                        "modelEnhanceError": safe_text(str(error), 160),
                    }
            return {
                "allowed": screening.get("status") == "accept",
                "reason": screening.get("reason") or screening.get("status") or "basic_conditions_unknown",
                "source": "basic_conditions",
                "screening": screening,
                "message": "51job 当前候选人尚未明确接受 AI 岗位基础条件，不能下载简历。" if screening.get("status") != "accept" else "",
            }

        return {
            "allowed": False,
            "reason": "suitability_not_confirmed",
            "source": "unknown",
            "message": "51job 当前候选人没有明确的合适判断，不能下载简历。",
        }

    def job51_is_online_resume_detail_page(self, page) -> bool:
        try:
            url = str(getattr(page, "url", "") or "")
        except Exception:
            url = ""
        if "/Revision/talent/resume/detail" in url:
            return True
        state = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const text = normalize(document.body ? document.body.innerText : '');
          const isChatPage = /\\/Revision\\/chat/.test(String(location.href || ''));
          const hasImResumeOperation = !!document.querySelector([
            '#sensor_imresume_download',
            '#sensor_imresume_print',
            '.IM-resume-operation'
          ].join(','));
          const hasImResumeSurface = !!document.querySelector([
            '#sensor_imresume_download',
            '#sensor_imresume_print',
            '.IM-resume-operation',
            '.con-container .resume',
            '.baseinfo-container.IM-resume-item',
            '.IM-base-module.IM-resume-item'
          ].join(','));
          if (isChatPage) return !!(hasImResumeOperation && hasImResumeSurface);
          if (hasImResumeSurface && /求职意向/.test(text) && /(个人优势|工作经历|教育经历)/.test(text)) return true;
          return /(人才状态|投递日期|求职意向)/.test(text) && /(保存|打印|转发|更多操作)/.test(text) && /(简历|工作经历|教育经历|个人优势)/.test(text);
        }""")
        return bool(state)

    def job51_find_online_resume_entry(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        token = f"codex_job51_online_resume_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        info = safe_eval(page, """(args) => {
          const token = args.token;
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8
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
          const textOf = el => normalize(el ? (el.innerText || el.textContent || '') : '');
          const candidates = [];
          const seen = new Set();
          const messageAreaSelector = [
            '#IMMessageList',
            '[id*="IMMessageList"]',
            'div.message-item',
            'div.im-message-item',
            '.im-message-item',
            '[class*="message-item" i]'
          ].join(',');
          const messageListSelector = '#IMMessageList,[id*="IMMessageList"]';
          const resumeMarker = /(?:\u5728\u7ebf\u7b80\u5386|\u9644\u4ef6\u7b80\u5386|\u7b80\u5386\u9644\u4ef6)/;
          const revealHiddenMessageResumeCard = () => {
            const cards = Array.from(document.querySelectorAll([
              '.resume-element',
              '.resume-element-info',
              '.item-container-resume',
              '.resume-card',
              '[class*="resume" i]'
            ].join(',')));
            const hidden = [];
            for (const card of cards) {
              if (!card || !card.isConnected) continue;
              if (card.closest('#conversation-list,.conversation-list,[class*="conversation-list" i],nav,header,.menu,.sidebar,.chat-user-operate')) continue;
              const messageRoot = card.closest(messageAreaSelector);
              if (!messageRoot) continue;
              const haystack = normalize([
                textOf(card),
                textOf(messageRoot),
                card.getAttribute('aria-label'),
                card.getAttribute('title'),
                card.className,
                messageRoot.className
              ].filter(Boolean).join(' '));
              if (!resumeMarker.test(haystack)) continue;
              if (visible(card)) return false;
              hidden.push({ card, messageRoot });
            }
            const target = hidden[hidden.length - 1];
            if (!target) return false;
            try {
              target.card.scrollIntoView({ block: 'center', inline: 'nearest' });
              const list = target.card.closest(messageListSelector);
              if (list && !visible(target.card)) {
                const cardBox = target.card.getBoundingClientRect();
                const listBox = list.getBoundingClientRect();
                list.scrollTop += cardBox.top - listBox.top - Math.max(12, (list.clientHeight - cardBox.height) / 2);
              }
              return true;
            } catch {
              return false;
            }
          };
          const revealedHiddenMessageResumeCard = revealHiddenMessageResumeCard();
          const selector = [
            '#sensor_Bchat_newzxjl',
            '.chat-user-operate .file-style.online',
            '.chat-user-operate .file-style',
            '.chat-user-operate [tabindex]',
            '.resume-element',
            '.item-container-resume',
            '.resume-card',
            '[class*="resume" i]',
            '[class*="file-style" i]',
            'a',
            'button',
            '[role="button"]',
            '[onclick]'
          ].join(',');
          for (const el of Array.from(document.querySelectorAll(selector))) {
            if (!visible(el)) continue;
            if (el.closest('#conversation-list,.conversation-list,[class*="conversation-list" i],nav,header,.menu,.sidebar')) continue;
            const clickable = el.closest('a,button,[role="button"],[onclick],#sensor_Bchat_newzxjl,.chat-user-operate .file-style,.chat-user-operate [tabindex],.resume-element,.item-container-resume,[class*="resume" i],[class*="file-style" i]') || el;
            if (!visible(clickable)) continue;
            const messageRoot = el.closest(messageAreaSelector) || clickable.closest(messageAreaSelector);
            const root = messageRoot || clickable;
            const haystack = normalize([
              textOf(el),
              textOf(clickable),
              textOf(root),
              el.getAttribute('aria-label'),
              el.getAttribute('title'),
              clickable.getAttribute('aria-label'),
              clickable.getAttribute('title'),
              clickable.getAttribute('href'),
              el.className,
              clickable.className
            ].filter(Boolean).join(' '));
            if (!/在线简历/.test(haystack)) continue;
            if (/(求简历|索要简历|要简历|请求简历|上传简历)/.test(haystack) && !/在线简历/.test(haystack)) continue;
            const box = rect(clickable);
            const key = `${clickable.tagName}:${box.x}:${box.y}:${haystack.slice(0, 80)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const classBlob = String(el.className || '') + ' ' + String(clickable.className || '') + ' ' + String(root.className || '');
            const isHeaderShortcut = !!(
              el.id === 'sensor_Bchat_newzxjl'
              || clickable.id === 'sensor_Bchat_newzxjl'
              || el.closest('.chat-user-operate')
              || clickable.closest('.chat-user-operate')
            );
            const isResumeCard = /resume-element|item-container-resume|resume-card/i.test(classBlob)
              || !!(el.closest('.resume-element,.item-container-resume,.resume-card') || clickable.closest('.resume-element,.item-container-resume,.resume-card'));
            const isMessageResumeCard = !!messageRoot && isResumeCard && !isHeaderShortcut;
            if (!isMessageResumeCard) {
              candidates.push({
                score: isHeaderShortcut ? -300 : 20,
                source: isHeaderShortcut ? 'header_shortcut_ignored' : 'non_message_resume_ignored',
                text: haystack.slice(0, 260),
                tag: clickable.tagName,
                className: String(clickable.className || '').slice(0, 160),
                rect: box
              });
              continue;
            }
            let score = 100;
            if (/resume-element|item-container-resume|resume-card/i.test(classBlob)) score += 140;
            if (/在线简历/.test(textOf(clickable))) score += 60;
            if (/在线简历/.test(textOf(root))) score += 35;
            if (/others|left|message/i.test(String(root.className || ''))) score += 15;
            if (box.x > 260) score += 10;
            if (/(批量|职位管理|全部岗位|未读|人才望远镜|主动联系)/.test(haystack)) score -= 120;
            candidates.push({
              score,
              source: 'message_resume_card',
              text: haystack.slice(0, 260),
              tag: clickable.tagName,
              className: String(clickable.className || '').slice(0, 160),
              rect: box,
              element: clickable
            });
          }
          candidates.sort((a, b) => (b.score - a.score) || ((b.rect?.y || 0) - (a.rect?.y || 0)));
          const best = candidates[0];
          if (!best || best.score < 80) return { found: false, reason: 'online_resume_entry_not_found', revealedHiddenMessageResumeCard, candidates: candidates.slice(0, 8) };
          best.element.setAttribute('data-codex-job51-online-resume', token);
          return {
            found: true,
            token,
            revealedHiddenMessageResumeCard,
            candidate: {
              score: best.score,
              source: best.source,
              text: best.text,
              tag: best.tag,
              className: best.className,
              rect: best.rect
            },
            candidates: candidates.slice(0, 8).map(item => ({
              score: item.score,
              source: item.source,
              text: item.text,
              tag: item.tag,
              className: item.className,
              rect: item.rect
            }))
          };
        }""", {"token": token})
        return info if isinstance(info, dict) else {"found": False, "reason": "online_resume_scan_failed"}

    def job51_dom_click_online_resume_entry(self, page, token: str) -> dict:
        token = str(token or "").strip()
        if not token:
            return {"ok": False, "reason": "online_resume_dom_click_missing_token"}
        result = safe_eval(page, """(args) => {
          const token = args.token;
          const selector = `[data-codex-job51-online-resume="${String(token).replace(/"/g, '\\"')}"]`;
          const el = document.querySelector(selector);
          if (!el || !el.isConnected) return { ok: false, reason: 'online_resume_dom_element_missing' };
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const onlineResumeRe = /在线简历/;
          const attachmentResumeRe = /附件简历/;
          const exactOnlineResumeRe = /^在线简历$/;
          const visible = node => {
            if (!node || !node.isConnected) return false;
            const box = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            return box.width > 8 && box.height > 8
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && box.bottom >= 0
              && box.right >= 0
              && box.top <= window.innerHeight
              && box.left <= window.innerWidth;
          };
          const target = el.closest('a,button,[role="button"],[onclick],#sensor_Bchat_newzxjl,.chat-user-operate .file-style,.chat-user-operate [tabindex],.resume-element,.item-container-resume,[class*="resume" i],[class*="file-style" i]') || el;
          if (!visible(target)) return { ok: false, reason: 'online_resume_dom_element_not_visible' };
          const card = target.closest('.resume-element,.item-container-resume,.resume-card,[class*="resume" i]') || target;
          const clickOptions = Array.from(card.querySelectorAll([
            '.info-content .btn-text',
            '.info-content-item',
            '.info-content',
            '.btn-text',
            '.file-style.online',
            '[class*="file-style" i]',
            '[class*="online" i]',
            'a',
            'button',
            '[role="button"]',
            '[onclick]',
            'span',
            'div'
          ].join(','))).filter(visible).map(node => {
            const nodeText = normalize([
              node.innerText,
              node.textContent,
              node.getAttribute('title'),
              node.getAttribute('aria-label'),
              node.getAttribute('href'),
              node.id,
              node.className
            ].filter(Boolean).join(' '));
            const className = String(node.className || '');
            let score = 0;
            if (onlineResumeRe.test(nodeText)) score += 160;
            if (exactOnlineResumeRe.test(nodeText)) score += 140;
            if (node.matches && node.matches('.info-content .btn-text,.info-content-item,.info-content,.btn-text')) score += 130;
            if (/btn-text|info-content-item|info-content/i.test(className)) score += 100;
            if (/file-style|online/i.test(className)) score += 80;
            if (/^(A|BUTTON)$/i.test(node.tagName) || node.getAttribute('role') === 'button' || node.getAttribute('onclick')) score += 35;
            if (node === target) score += 10;
            return { node, nodeText, score };
          }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
          const clickTarget = (clickOptions[0] && clickOptions[0].node) || target;
          const href = String(clickTarget.getAttribute('href') || target.getAttribute('href') || el.getAttribute('href') || '');
          const targetText = normalize([
            clickTarget.innerText,
            clickTarget.textContent,
            clickTarget.getAttribute('title'),
            clickTarget.getAttribute('aria-label'),
            href,
            clickTarget.id,
            target.id,
            el.id,
            clickTarget.className,
            target.className,
            el.className
          ].filter(Boolean).join(' '));
          if (
            clickTarget.id === 'sensor_Bchat_newzxjl'
            || target.id === 'sensor_Bchat_newzxjl'
            || el.id === 'sensor_Bchat_newzxjl'
            || clickTarget.closest('.chat-user-operate')
            || target.closest('.chat-user-operate')
            || el.closest('.chat-user-operate')
            || /Revision\/talent\/management|Revision\/talent\/search-recommend|人才管理|人才沟通/.test(targetText)
          ) {
            return { ok: false, reason: 'online_resume_header_shortcut_blocked' };
          }
          if (!clickTarget.closest('#IMMessageList,[id*="IMMessageList"],div.message-item,div.im-message-item,.im-message-item,[class*="message-item" i]')) {
            return { ok: false, reason: 'online_resume_not_in_message_list' };
          }
          clickTarget.scrollIntoView({ block: 'center', inline: 'center' });
          if (typeof clickTarget.focus === 'function') clickTarget.focus({ preventScroll: true });
          clickTarget.setAttribute('data-codex-job51-online-resume-click-target', token);
          const clickBox = clickTarget.getBoundingClientRect();
          const clickOnlyText = normalize(clickTarget.innerText || clickTarget.textContent || '');
          const combinedOnlineAttachment = onlineResumeRe.test(clickOnlyText)
            && attachmentResumeRe.test(clickOnlyText)
            && !exactOnlineResumeRe.test(clickOnlyText);
          const exactOnlineOnly = onlineResumeRe.test(clickOnlyText)
            && !attachmentResumeRe.test(clickOnlyText);
          const clickRatios = combinedOnlineAttachment
            ? [[0.35, 0.28], [0.22, 0.28], [0.5, 0.28]]
            : (
              exactOnlineOnly
                ? [[0.28, 0.5], [0.18, 0.5], [0.42, 0.5], [0.5, 0.5]]
                : [[0.5, 0.5], [0.35, 0.35], [0.25, 0.5]]
            );
          const clickRatioX = clickRatios[0][0];
          const clickRatioY = clickRatios[0][1];
          clickTarget.setAttribute('data-codex-job51-online-resume-click-ratio-x', String(clickRatioX));
          clickTarget.setAttribute('data-codex-job51-online-resume-click-ratio-y', String(clickRatioY));
          clickTarget.setAttribute('data-codex-job51-online-resume-click-ratios', JSON.stringify(clickRatios));
          const clientX = Math.max(0, Math.min(window.innerWidth - 1, Math.round(clickBox.left + clickBox.width * clickRatioX)));
          const clientY = Math.max(0, Math.min(window.innerHeight - 1, Math.round(clickBox.top + clickBox.height * clickRatioY)));
          const eventInit = { bubbles: true, cancelable: true, view: window, clientX, clientY, button: 0, buttons: 1 };
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            try {
              if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
                clickTarget.dispatchEvent(new PointerEvent(type, { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
              } else {
                clickTarget.dispatchEvent(new MouseEvent(type, eventInit));
              }
            } catch {
              clickTarget.dispatchEvent(new MouseEvent(type, eventInit));
            }
          }
          if (typeof clickTarget.click === 'function') clickTarget.click();
          const box = clickTarget.getBoundingClientRect();
          return {
            ok: true,
            tag: clickTarget.tagName,
            text: normalize(clickTarget.innerText || clickTarget.textContent || clickTarget.getAttribute('title') || clickTarget.getAttribute('aria-label') || '').slice(0, 160),
            rect: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
            clickTargetClass: String(clickTarget.className || '').slice(0, 160),
            clickRatio: { x: clickRatioX, y: clickRatioY },
            retryRatios: clickRatios,
            combinedOnlineAttachment,
            exactOnlineOnly,
            clickTargetScore: clickOptions[0] ? clickOptions[0].score : 0
          };
        }""", {"token": token})
        return result if isinstance(result, dict) else {"ok": False, "reason": "online_resume_dom_click_failed"}

    def job51_open_online_resume_detail(self, terminal: BrowserTerminal, entry: dict) -> dict:
        origin_page = terminal.current_page()
        locator = origin_page.locator(f"[data-codex-job51-online-resume='{entry.get('token')}']").first
        if not locator.count():
            return {"ok": False, "reason": "online_resume_entry_element_missing", "entry": {k: v for k, v in entry.items() if k != "token"}}

        pre_close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
        before_pages = list(getattr(origin_page.context, "pages", []) or [])
        detail_page = None
        opened_by = "current_page"
        clicked_entry = False
        dom_click_result: dict = {}
        trusted_click_result: dict = {}
        rejected_detail_pages: list[dict] = []
        extra_close_result: dict = {"closedPages": [], "count": 0}

        def page_brief(page) -> dict:
            try:
                url = str(getattr(page, "url", "") or "")
            except Exception:
                url = ""
            try:
                title = page.title()
            except Exception:
                title = ""
            return {"url": safe_text(url, 180), "title": safe_text(title, 80)}

        def validate_detail_candidate(page, source: str):
            if page is None:
                return None
            try:
                page.wait_for_load_state("domcontentloaded", timeout=5000)
            except Exception:
                pass
            try:
                page.wait_for_selector("body", timeout=3000)
            except Exception:
                pass
            try:
                if self.job51_is_online_resume_detail_page(page):
                    return page
            except Exception:
                pass
            brief = page_brief(page)
            rejected = {"source": source, **brief}
            rejected_detail_pages.append(rejected)
            url = str(brief.get("url") or "")
            if page != origin_page and "ehire.51job.com" in url and "/Revision/chat" not in url:
                try:
                    page.close()
                    rejected["closed"] = True
                except Exception as error:
                    rejected["closeError"] = safe_text(str(error), 120)
            return None

        def close_extra_non_chat_pages(keep_page=None, reason: str = "") -> dict:
            closed_pages: list[dict] = []
            try:
                pages = list(getattr(origin_page.context, "pages", []) or [])
            except Exception:
                pages = []
            for page in pages:
                if page == origin_page or (keep_page is not None and page == keep_page):
                    continue
                brief = page_brief(page)
                url = str(brief.get("url") or "")
                haystack = f"{url} {brief.get('title') or ''}"
                should_close = (
                    "ehire.51job.com" in url
                    and "/Revision/chat" not in url
                    and (
                        "/Revision/talent/management" in url
                        or "/Revision/talent/resume/detail" in url
                        or re.search(r"(resume|jianli|preview|download|pdf|doc|简历|预览)", haystack, flags=re.I)
                    )
                )
                if not should_close:
                    continue
                try:
                    page.close()
                    closed_pages.append(brief)
                except Exception as error:
                    closed_pages.append({**brief, "error": safe_text(str(error), 120)})
            return {"closedPages": closed_pages, "count": len(closed_pages), "reason": reason}

        def trusted_click_marked_target(dom_result: dict, ratio_override: tuple[float, float] | None = None) -> dict:
            token = str(entry.get("token") or "")
            if token:
                try:
                    marked = origin_page.locator(f"[data-codex-job51-online-resume-click-target='{token}']").first
                    if marked.count():
                        ratio_x = 0.5
                        ratio_y = 0.5
                        if ratio_override is not None:
                            try:
                                ratio_x = float(ratio_override[0])
                                ratio_y = float(ratio_override[1])
                            except Exception:
                                ratio_x = 0.5
                                ratio_y = 0.5
                        else:
                            try:
                                ratio_x = float(marked.get_attribute("data-codex-job51-online-resume-click-ratio-x") or 0.5)
                                ratio_y = float(marked.get_attribute("data-codex-job51-online-resume-click-ratio-y") or 0.5)
                            except Exception:
                                ratio_x = 0.5
                                ratio_y = 0.5
                        box = marked.bounding_box(timeout=2000)
                        if box and float(box.get("width") or 0) > 1 and float(box.get("height") or 0) > 1:
                            marked.click(
                                timeout=5000,
                                position={
                                    "x": max(1.0, min(float(box.get("width") or 0) - 1.0, float(box.get("width") or 0) * ratio_x)),
                                    "y": max(1.0, min(float(box.get("height") or 0) - 1.0, float(box.get("height") or 0) * ratio_y)),
                                },
                            )
                            return {"ok": True, "method": "locator", "ratio": {"x": ratio_x, "y": ratio_y}, "override": ratio_override is not None}
                        marked.click(timeout=5000)
                        return {"ok": True, "method": "locator", "override": ratio_override is not None}
                except Exception as error:
                    locator_error = safe_text(str(error), 160)
                else:
                    locator_error = "marked_target_missing"
            else:
                locator_error = "missing_token"
            rect = dom_result.get("rect") if isinstance(dom_result, dict) else None
            if not isinstance(rect, dict):
                return {"ok": False, "method": "mouse", "reason": locator_error or "missing_click_rect"}
            try:
                ratio_x = 0.5
                ratio_y = 0.5
                if ratio_override is not None:
                    try:
                        ratio_x = float(ratio_override[0])
                        ratio_y = float(ratio_override[1])
                    except Exception:
                        ratio_x = 0.5
                        ratio_y = 0.5
                x = float(rect.get("x") or 0) + (float(rect.get("w") or 0) * ratio_x)
                y = float(rect.get("y") or 0) + (float(rect.get("h") or 0) * ratio_y)
                if x <= 0 or y <= 0:
                    return {"ok": False, "method": "mouse", "reason": "invalid_click_rect", "rect": rect, "locatorError": locator_error}
                origin_page.mouse.click(x, y)
                return {"ok": True, "method": "mouse", "x": round(x), "y": round(y), "ratio": {"x": ratio_x, "y": ratio_y}, "locatorError": locator_error}
            except Exception as error:
                return {"ok": False, "method": "mouse", "reason": safe_text(str(error), 160), "locatorError": locator_error}

        try:
            with origin_page.context.expect_page(timeout=8000) as page_info:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                dom_click = self.job51_dom_click_online_resume_entry(origin_page, str(entry.get("token") or ""))
                dom_click_result = dom_click if isinstance(dom_click, dict) else {}
                if not dom_click.get("ok"):
                    raise AgentError(dom_click.get("reason") or "online_resume_dom_click_failed")
                trusted_click_result = trusted_click_marked_target(dom_click_result)
                clicked_entry = True
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
            detail_page = page_info.value
            opened_by = "new_page"
        except Exception:
            if not clicked_entry:
                try:
                    if terminal.humanize:
                        terminal.pause_like_person("pre_action")
                        highlight_target(locator)
                    dom_click = self.job51_dom_click_online_resume_entry(origin_page, str(entry.get("token") or ""))
                    dom_click_result = dom_click if isinstance(dom_click, dict) else {}
                    if not dom_click.get("ok"):
                        raise AgentError(dom_click.get("reason") or "online_resume_dom_click_failed")
                    trusted_click_result = trusted_click_marked_target(dom_click_result)
                    clicked_entry = True
                    if terminal.humanize:
                        terminal.pause_like_person("post_action")
                except Exception as error:
                    extra_close_result = close_extra_non_chat_pages(None, "online_resume_click_failed")
                    return {
                        "ok": False,
                        "reason": "online_resume_click_failed",
                        "error": safe_text(str(error), 160),
                        "domClickResult": dom_click_result,
                        "trustedClickResult": trusted_click_result,
                    }

        origin_page.wait_for_timeout(random.randint(900, 1400))
        pages = list(getattr(origin_page.context, "pages", []) or [])
        if detail_page is not None:
            accepted = validate_detail_candidate(detail_page, opened_by)
            if accepted is not None:
                detail_page = accepted
            else:
                detail_page = None
        if detail_page is None:
            new_pages = [page for page in pages if page not in before_pages]
            for page in reversed(new_pages + pages):
                try:
                    accepted = validate_detail_candidate(page, "detected_page")
                    if accepted is not None:
                        detail_page = accepted
                        opened_by = "detected_page"
                        break
                except Exception:
                    continue
        if detail_page is None:
            accepted = validate_detail_candidate(origin_page, "same_page")
            if accepted is not None:
                detail_page = accepted
                opened_by = "same_page"
        retry_click_attempts: list[dict] = []
        if detail_page is None and isinstance(dom_click_result, dict):
            raw_ratios = dom_click_result.get("retryRatios")
            retry_ratios: list[tuple[float, float]] = []
            seen_ratios: set[tuple[float, float]] = set()
            initial_ratio = trusted_click_result.get("ratio") if isinstance(trusted_click_result, dict) else {}
            initial_key = None
            if isinstance(initial_ratio, dict):
                try:
                    initial_key = (round(float(initial_ratio.get("x")), 3), round(float(initial_ratio.get("y")), 3))
                except Exception:
                    initial_key = None
            if isinstance(raw_ratios, list):
                for item in raw_ratios:
                    if not isinstance(item, (list, tuple)) or len(item) < 2:
                        continue
                    try:
                        ratio = (float(item[0]), float(item[1]))
                    except Exception:
                        continue
                    key = (round(ratio[0], 3), round(ratio[1], 3))
                    if key == initial_key or key in seen_ratios:
                        continue
                    seen_ratios.add(key)
                    retry_ratios.append(ratio)
            for ratio in retry_ratios[:4]:
                attempt = {"ratio": {"x": ratio[0], "y": ratio[1]}}
                try:
                    click_result = trusted_click_marked_target(dom_click_result, ratio)
                    attempt["click"] = click_result
                    if not click_result.get("ok"):
                        retry_click_attempts.append(attempt)
                        continue
                    origin_page.wait_for_timeout(random.randint(900, 1400))
                    pages = list(getattr(origin_page.context, "pages", []) or [])
                    retry_candidates = [page for page in pages if page not in before_pages] + pages
                    seen_page_ids: set[int] = set()
                    for page in reversed(retry_candidates):
                        page_id = id(page)
                        if page_id in seen_page_ids:
                            continue
                        seen_page_ids.add(page_id)
                        accepted = validate_detail_candidate(
                            page,
                            f"retry_ratio_{ratio[0]:.2f}_{ratio[1]:.2f}",
                        )
                        if accepted is not None:
                            detail_page = accepted
                            opened_by = f"retry_ratio_{ratio[0]:.2f}_{ratio[1]:.2f}"
                            attempt["opened"] = True
                            break
                    retry_click_attempts.append(attempt)
                    if detail_page is not None:
                        break
                except Exception as error:
                    attempt["error"] = safe_text(str(error), 160)
                    retry_click_attempts.append(attempt)
        if detail_page is None:
            extra_close_result = close_extra_non_chat_pages(None, "online_resume_detail_not_opened")
            restore_result = {}
            try:
                origin_url = str(getattr(origin_page, "url", "") or "")
                if "ehire.51job.com" in origin_url and "/Revision/chat" not in origin_url:
                    origin_page.goto(JOB51_CHAT_URL, wait_until="domcontentloaded", timeout=15000)
                    origin_page.wait_for_timeout(random.randint(900, 1400))
                    terminal.page = origin_page
                    restore_result = {
                        "restored": True,
                        "fromUrl": safe_text(origin_url, 180),
                        "toUrl": safe_text(str(getattr(origin_page, "url", "") or ""), 180),
                    }
                    try:
                        self.job51_close_stale_non_chat_pages(terminal, origin_page=origin_page, reason="restore_after_bad_resume_page")
                    except Exception:
                        pass
            except Exception as error:
                restore_result = {"restored": False, "error": safe_text(str(error), 160)}
            return {
                "ok": False,
                "reason": "online_resume_detail_not_opened",
                "entry": {k: v for k, v in entry.items() if k != "token"},
                "rejectedDetailPages": rejected_detail_pages[-6:],
                "pages": [page_brief(page) for page in pages[-6:]],
                "restoreResult": restore_result,
                "preCloseResult": pre_close_result,
                "extraCloseResult": extra_close_result,
                "domClickResult": dom_click_result,
                "trustedClickResult": trusted_click_result,
                "retryClickAttempts": retry_click_attempts,
            }

        extra_close_result = close_extra_non_chat_pages(detail_page, "after_online_resume_detail_open")
        try:
            detail_page.bring_to_front()
            detail_page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:
            pass
        try:
            detail_page.wait_for_selector("body", timeout=5000)
        except Exception:
            pass
        terminal.page = detail_page
        return {
            "ok": True,
            "page": detail_page,
            "originPage": origin_page,
            "openedBy": opened_by,
            "url": safe_text(str(getattr(detail_page, "url", "") or ""), 240),
            "title": safe_text(detail_page.title(), 100),
            "entry": {k: v for k, v in entry.items() if k != "token"},
            "preCloseResult": pre_close_result,
            "extraCloseResult": extra_close_result,
            "domClickResult": dom_click_result,
            "trustedClickResult": trusted_click_result,
            "retryClickAttempts": retry_click_attempts,
        }

    def job51_find_online_resume_save_button(self, page) -> dict:
        token = f"codex_job51_online_resume_save_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        info = safe_eval(page, """(args) => {
          const token = args.token;
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8
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
          const selector = [
            '#sensor_imresume_download',
            '[id*="imresume_download" i]',
            '#eh_save_popup_action_ref',
            '[id*="save" i]',
