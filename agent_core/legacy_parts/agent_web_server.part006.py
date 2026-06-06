        page = terminal.current_page()
        self.zhilian_dismiss_interruptions(terminal, reason="before_unread_filter")
        token = f"codex_zhilian_unread_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        result = safe_eval(page, """token => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const checkboxCandidates = Array.from(document.querySelectorAll(
            '.side-panel-header__checkbox, .km-checkbox, [role="checkbox"], label'
          )).filter(visible).map(el => {
            const text = normalize(el.innerText || el.textContent || '');
            const cls = String(el.className || '');
            const box = el.getBoundingClientRect();
            const input = el.querySelector('input[type="checkbox"], input');
            let score = 0;
            if (text === '未读') score += 900;
            else if (text.includes('未读') && text.length <= 8) score += 520;
            if (/side-panel-header__checkbox|checkbox/i.test(cls)) score += 160;
            if (input) score += 120;
            return {
              el,
              text,
              cls,
              score,
              y: box.y,
              x: box.x,
              alreadyActive: input ? Boolean(input.checked) : /active|checked|selected|is-checked/i.test(cls)
            };
          });
          const fallbackCandidates = Array.from(document.querySelectorAll('button,a,span,div,[role="button"]')).filter(visible).map(el => {
            const text = normalize(el.innerText || el.textContent || '');
            const cls = String(el.className || '');
            const box = el.getBoundingClientRect();
            let score = 0;
            if (text === '未读') score += 500;
            else if (text.includes('未读') && text.length <= 8) score += 260;
            if (/filter|tab|button|checkbox|side-panel-header/i.test(cls)) score += 40;
            if (/active|checked|selected|is-checked/i.test(cls)) score += 30;
            return { el, text, cls, score, y: box.y, x: box.x, alreadyActive: /active|checked|selected|is-checked/i.test(cls) };
          }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
          const candidates = checkboxCandidates.concat(fallbackCandidates)
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
          const best = candidates[0];
          if (!best) return { found: false, reason: 'unread_filter_not_found' };
          best.el.setAttribute('data-codex-zhilian-unread', token);
          return { found: true, label: best.text, className: best.cls, alreadyActive: Boolean(best.alreadyActive) };
        }""", token)
        if not isinstance(result, dict) or not result.get("found"):
            return result if isinstance(result, dict) else {"found": False, "reason": "unread_filter_not_found"}
        locator = page.locator(f"[data-codex-zhilian-unread='{token}']").first
        try:
            if result.get("alreadyActive"):
                return {**result, "clicked": False}
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(900, 1400))
            verified = safe_eval(page, """token => {
              const el = document.querySelector(`[data-codex-zhilian-unread="${token}"]`);
              if (!el) return {};
              const input = el.querySelector('input[type="checkbox"], input');
              const cls = String(el.className || '');
              return { active: input ? Boolean(input.checked) : /active|checked|selected|is-checked/i.test(cls), className: cls };
            }""", token)
            return {**result, "clicked": True, "verified": verified if isinstance(verified, dict) else {}}
        except Exception as error:
            return {"found": False, "reason": safe_text(str(error), 160), "state": result}
        finally:
            try:
                page.locator("[data-codex-zhilian-unread]").evaluate_all("els => els.forEach(el => el.removeAttribute('data-codex-zhilian-unread'))")
            except Exception:
                pass

    def zhilian_select_all_positions(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        result = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const selector = document.querySelector('.app-job-selector, .im-job-filter, [class*="job-filter"]');
          if (!selector) return { selected: false, reason: 'all_position_selector_not_found' };
          const label = normalize(selector.innerText || selector.textContent || selector.getAttribute('placeholder') || '');
          return { selected: /全部职位/.test(label), label, className: String(selector.className || '') };
        }""")
        if isinstance(result, dict) and result.get("selected"):
            return result
        locator = page.locator(".app-job-selector, .im-job-filter, [class*='job-filter']").first
        try:
            if locator.count():
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                locator.click(timeout=5000, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
                page.wait_for_timeout(random.randint(700, 1100))
                option = page.locator("text=全部职位").first
                if option.count():
                    option.click(timeout=5000, force=True)
                    page.wait_for_timeout(random.randint(700, 1100))
                    return {"selected": True, "label": "全部职位", "clicked": True}
        except Exception as error:
            return {"selected": False, "reason": safe_text(str(error), 160), "state": result}
        return result if isinstance(result, dict) else {"selected": False, "reason": "all_positions_not_selected"}

    def zhilian_find_next_thread(
        self,
        terminal: BrowserTerminal,
        exclude_labels: list[str] | None = None,
        allowed_positions: tuple[str, ...] | list[str] = ZHILIAN_CONFIGURED_POSITIONS,
        require_unread: bool = False,
        filtered_out: list[dict] | None = None,
        filtered_keys: set[str] | None = None,
    ) -> dict | None:
        exclude_labels = exclude_labels or []
        allowed_clean = [clean_applied_position(item) for item in allowed_positions if clean_applied_position(item)]
        page = terminal.current_page()
        rows = page.locator(".im-session-item__box")
        try:
            count = rows.count()
        except Exception:
            count = 0
        for index in range(count):
            row = rows.nth(index)
            try:
                label = safe_text(row.inner_text(timeout=800), 320)
            except Exception:
                continue
            label_key = compact_conversation_label(label)
            if not label or any(compact_conversation_label(item) and compact_conversation_label(item) in label_key for item in exclude_labels):
                continue
            data = safe_eval(page, f"""() => {{
              const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const row = document.querySelectorAll('.im-session-item__box')[{index}];
              if (!row) return {{}};
              return {{
                name: normalize((row.querySelector('.im-session-item__name-title') || {{}}).innerText || ''),
                job: normalize((row.querySelector('.im-session-item-subtitle__suffix') || {{}}).innerText || ''),
                message: normalize((row.querySelector('.im-session-item__msg') || {{}}).innerText || ''),
                unread: normalize((row.querySelector('.im-session-item__unread') || {{}}).innerText || '')
              }};
            }}""") or {}
            job = clean_applied_position(str(data.get("job") or ""))
            clean_label = clean_applied_position(label)
            unread_text = str(data.get("unread") or "").strip()
            unread_match = re.search(r"[1-9]\d*", unread_text)
            unread_count = int(unread_match.group(0)) if unread_match else 0
            if require_unread and unread_count <= 0:
                if isinstance(filtered_out, list) and isinstance(filtered_keys, set):
                    skip_key = f"not_unread:{label_key or index}:{job}"
                    if skip_key not in filtered_keys and len(filtered_out) < 120:
                        filtered_keys.add(skip_key)
                        filtered_out.append({
                            "reason": "not_unread",
                            "label": safe_text(label, 140),
                            "appliedPosition": safe_text(job, 80),
                            "message": safe_text(str(data.get("message") or ""), 180),
                        })
                continue
            if allowed_clean and not any(
                pos in job
                or job in pos
                or pos in clean_label
                or zhilian_position_label_matches(job, pos)
                or zhilian_position_label_matches(clean_label, pos)
                for pos in allowed_clean
            ):
                if isinstance(filtered_out, list) and isinstance(filtered_keys, set):
                    skip_key = f"unconfigured_position:{label_key or index}:{job}"
                    if skip_key not in filtered_keys and len(filtered_out) < 120:
                        filtered_keys.add(skip_key)
                        filtered_out.append({
                            "reason": "unconfigured_position",
                            "label": safe_text(label, 140),
                            "appliedPosition": safe_text(job, 80),
                            "message": safe_text(str(data.get("message") or ""), 180),
                            "unreadCount": unread_count,
                        })
                continue
            try:
                box = row.bounding_box(timeout=1000)
            except Exception:
                box = None
            return {
                "index": index,
                "label": label,
                "name": safe_text(str(data.get("name") or ""), 80),
                "job": job,
                "message": safe_text(str(data.get("message") or ""), 180),
                "unread": safe_text(str(data.get("unread") or ""), 20),
                "unreadCount": unread_count,
                "locator": row,
                "x": round(box["x"]) if box else None,
                "y": round(box["y"]) if box else None,
            }
        return None

    def zhilian_scroll_conversation_list(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        result = safe_eval(page, """() => {
          const el = document.querySelector('.im-session-list, .im-session-list__virtual');
          if (!el) return { scrolled: false, reason: 'missing_list' };
          const before = el.scrollTop || 0;
          el.scrollTop = before + Math.max(260, Math.floor((el.clientHeight || 500) * 0.85));
          el.dispatchEvent(new Event('scroll', { bubbles: true }));
          return { scrolled: Math.abs((el.scrollTop || 0) - before) > 2, before, after: el.scrollTop || 0 };
        }""")
        page.wait_for_timeout(random.randint(520, 860))
        return result if isinstance(result, dict) else {"scrolled": False}

    def zhilian_wait_chat_ready(self, terminal: BrowserTerminal, timeout_ms: int = 5000) -> bool:
        try:
            terminal.current_page().wait_for_selector(".im-sender__input textarea, textarea[placeholder*='从这里开启对话']", timeout=timeout_ms)
            return True
        except Exception:
            return False

    def zhilian_extract_chat_messages(self, terminal: BrowserTerminal) -> list[dict]:
        page = terminal.current_page()
        messages = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const rows = Array.from(document.querySelectorAll('.km-list__item.im-message, .im-message')).filter(visible);
          return rows.map(row => {
            const box = row.getBoundingClientRect();
            const cls = String(row.className || '');
            const bubble = row.querySelector('.im-message__bubble');
            const bubbleCls = String((bubble || {}).className || '');
            const textNode = row.querySelector('.im-message__text') || row.querySelector('.im-message__bubble-inner') || row.querySelector('.im-message__toast-inner') || row;
            const text = normalize(textNode.innerText || textNode.textContent || '');
            const rawText = normalize(row.innerText || row.textContent || '');
            const isSystem = !bubble
              || /toast|custom|job-toast|system/i.test(cls + ' ' + bubbleCls)
              || /^当前沟通/.test(text)
              || /^[上下]午\\s*\\d{1,2}:\\d{2}$/.test(text);
            const sender = isSystem ? 'system' : (/im-message__bubble--me|self|mine|my|right|is-me/i.test(bubbleCls + ' ' + cls) ? 'me' : 'other');
            return { sender, text, rawText, className: `${cls} ${bubbleCls}`.trim(), x: Math.round(box.x), y: Math.round(box.y) };
          }).filter(item => item.text && !/^(发回复语|是否在职|距离是否合适|是否本科|薪资待遇|待评估|暂时待定)/.test(item.text)).slice(-120);
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
            if sender not in {"me", "other", "system"}:
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

    @timed_agent_stage("zhilian_verify_reply_sent", "智联发送后检查")
    def zhilian_verify_reply_sent_in_current_chat(self, terminal: BrowserTerminal, text: str) -> dict:
        expected = normalize_reply_fingerprint(str(text or ""))
        if not expected:
            return {"verified": False, "reason": "empty_expected"}
        try:
            terminal.current_page().wait_for_timeout(random.randint(650, 1050))
            messages = self.zhilian_extract_chat_messages(terminal)
        except Exception as error:
            return {"verified": False, "reason": safe_text(str(error), 160)}
        last_my: dict = {}
        for item in reversed(messages[-12:]):
            if not isinstance(item, dict) or item.get("sender") != "me":
                continue
            last_my = item
            actual = normalize_reply_fingerprint(str(item.get("text") or ""))
            if expected and actual and (expected in actual or actual in expected):
                return {"verified": True, "message": safe_text(str(item.get("text") or ""), 120), "source": "zhilian_message_item"}
        current_input = safe_text(str(safe_eval(
            terminal.current_page(),
            "() => String((document.querySelector('.im-sender__input textarea') || {}).value || '')",
        ) or ""), 240)
        return {
            "verified": False,
            "reason": "reply_not_found_in_recent_zhilian_my_messages",
            "lastMy": safe_text(str(last_my.get("text") or ""), 120) if isinstance(last_my, dict) else "",
            "inputContainsExpected": bool(expected and expected in normalize_reply_fingerprint(current_input)),
            "inputText": current_input,
        }

    def zhilian_current_chat_input_text(self, terminal: BrowserTerminal) -> str:
        page = terminal.current_page()
        value = safe_eval(page, """() => {
          const input = document.querySelector('.im-sender__input textarea, textarea[placeholder*="从这里开启对话"]');
          return input ? String(input.value || input.textContent || '') : '';
        }""")
        return str(value or "")

    def zhilian_fill_chat_input(self, terminal: BrowserTerminal, input_locator, text: str) -> dict:
        page = terminal.current_page()
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(input_locator)
            humanized_locator_click(terminal, input_locator, force=True)
        else:
            input_locator.click(timeout=8000, force=True)
        page.wait_for_timeout(random.randint(120, 260))
        try:
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            page.keyboard.type(text, delay=random.randint(CHAT_TYPE_DELAY_MS[0], CHAT_TYPE_DELAY_MS[1]))
        except Exception:
            input_locator.fill("", timeout=8000)
            input_locator.type(text, delay=random.randint(CHAT_TYPE_DELAY_MS[0], CHAT_TYPE_DELAY_MS[1]))
        page.wait_for_timeout(random.randint(180, 360))
        current = self.zhilian_current_chat_input_text(terminal)
        if normalize_reply_fingerprint(text) not in normalize_reply_fingerprint(current):
            input_locator.evaluate("""(el, value) => {
              el.focus();
              const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(el, value);
              else el.value = value;
              el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }""", text)
            page.wait_for_timeout(random.randint(180, 360))
            current = self.zhilian_current_chat_input_text(terminal)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        return {
            "filled": normalize_reply_fingerprint(text) in normalize_reply_fingerprint(current),
            "inputText": safe_text(current, 240),
        }

    def zhilian_focus_chat_input(self, terminal: BrowserTerminal) -> bool:
        try:
            return bool(terminal.current_page().evaluate(
                r"""() => {
                  const visible = (el) => {
                    if (!el || !el.isConnected) return false;
                    const box = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return box.width > 3 && box.height > 3
                      && style.display !== "none"
                      && style.visibility !== "hidden"
                      && style.opacity !== "0";
                  };
                  const inputs = Array.from(document.querySelectorAll(
                    ".im-sender__input textarea, .im-sender textarea, textarea[placeholder*='从这里开启对话'], textarea"
                  )).filter(visible).sort((a, b) => {
                    const aSender = a.closest(".im-sender") ? 1 : 0;
                    const bSender = b.closest(".im-sender") ? 1 : 0;
                    if (aSender !== bSender) return bSender - aSender;
                    return b.getBoundingClientRect().y - a.getBoundingClientRect().y;
                  });
                  const input = inputs[0] || null;
                  if (!input) return false;
                  input.focus();
                  try {
                    const len = String(input.value || "").length;
                    input.setSelectionRange(len, len);
                  } catch (_) {}
                  return true;
                }"""
            ))
        except Exception:
            return False

    def zhilian_mark_send_button(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        token = f"codex_zhilian_send_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        result = safe_eval(page, r"""token => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && rect.width > 3
              && rect.height > 3
              && rect.bottom > 0
              && rect.y < window.innerHeight;
          };
          const input = Array.from(document.querySelectorAll('.im-sender__input textarea, .im-sender textarea, textarea[placeholder*="从这里开启对话"], textarea,input,[contenteditable=true],[role="textbox"]'))
            .filter(visible)
            .sort((a, b) => {
              const aSender = a.closest('.im-sender') ? 1 : 0;
              const bSender = b.closest('.im-sender') ? 1 : 0;
              if (aSender !== bSender) return bSender - aSender;
              return b.getBoundingClientRect().y - a.getBoundingClientRect().y;
            })[0] || null;
          const inputBox = input ? input.getBoundingClientRect() : null;
          const sender = (input && input.closest('.im-sender')) || document.querySelector('.im-sender') || null;
          const rawNodes = [
            ...(sender ? Array.from(sender.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],a,span,div,[class*="send"],[class*="submit"],[class*="btn"],[class*="button"]')) : []),
            ...Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"],a,[class*="send"],[class*="submit"]'))
          ];
          const nodes = Array.from(new Set(rawNodes));
          const candidates = nodes.map(el => {
            const rect = el.getBoundingClientRect();
            const text = normalize(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '');
            const ownLabel = normalize(el.value || el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent || '');
            const cls = String(el.className || '');
            const role = String(el.getAttribute('role') || '');
            const tag = String(el.tagName || '').toLowerCase();
            const type = String(el.getAttribute('type') || '').toLowerCase();
            const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|is-disabled|unable|forbid/i.test(cls);
            const senderRoot = el.closest('.im-sender') || null;
            const nearInput = inputBox
              ? rect.bottom >= inputBox.y - 90
                && rect.y <= inputBox.bottom + 130
                && rect.right >= inputBox.x + Math.min(80, inputBox.width * 0.12)
                && rect.x <= inputBox.right + 260
              : false;
            return { el, rect, text, ownLabel, cls, role, tag, type, disabled, inSender: Boolean(senderRoot), nearInput };
          }).filter(item => {
            const el = item.el;
            const text = item.text || item.ownLabel;
            const cls = item.cls;
            if (!visible(el)) return false;
            if (item.disabled) return false;
            if (el.matches('textarea,input:not([type="button"]):not([type="submit"])')) return false;
            if (item.rect.width > 340 || item.rect.height > 180) return false;
            if (text && text.length > 60 && !/send|submit/i.test(cls)) return false;
            const lowerText = text.toLowerCase();
            const buttonLike = item.tag === 'button'
              || item.role === 'button'
              || item.type === 'button'
              || item.type === 'submit'
              || /btn|button|submit|send/i.test(cls);
            if (text && text.length <= 24 && (text === '发送' || lowerText === 'send' || text.endsWith('发送'))) return true;
            if (/send|submit/i.test(cls) && item.rect.width <= 260 && item.rect.height <= 120) return true;
            if (buttonLike && item.inSender && item.nearInput && item.rect.width <= 180 && item.rect.height <= 90) return true;
            return false;
          }).map(item => {
            let score = 0;
            const text = item.text || item.ownLabel;
            const lowerText = text.toLowerCase();
            if (text === '发送') score += 420;
            if (lowerText === 'send' || text.endsWith('发送')) score += 320;
            if (/send/i.test(item.cls)) score += 240;
            if (/submit/i.test(item.cls)) score += 180;
            if (/button|btn/i.test(item.cls) || item.tag === 'button' || item.role === 'button') score += 80;
            if (item.inSender) score += 180;
            if (item.el.closest('.im-sender__input-tip')) score += 40;
            if (item.el.closest('.im-sender__toolbar')) score -= 40;
            if (inputBox) {
              const cy = item.rect.y + item.rect.height / 2;
              const inputCy = inputBox.y + inputBox.height / 2;
              if (item.nearInput) score += 150;
              if (item.rect.x >= inputBox.x + inputBox.width * 0.55) score += 110;
              if (item.rect.y >= inputBox.y - 80 && item.rect.y <= inputBox.bottom + 130) score += 80;
              score -= Math.abs(cy - inputCy) / 5;
            }
            score += item.rect.x / 1000;
            return { ...item, text, score };
          }).filter(item => item.score >= 180).sort((a, b) => b.score - a.score);
          document.querySelectorAll('[data-codex-zhilian-send]').forEach(el => el.removeAttribute('data-codex-zhilian-send'));
          const best = candidates[0] || null;
          if (!best) return { found: false, count: 0, marker: token, reason: 'no_send_button' };
          best.el.setAttribute('data-codex-zhilian-send', token);
          return {
            found: true,
            count: candidates.length,
            marker: token,
            selector: `[data-codex-zhilian-send="${token}"]`,
            label: best.text || '发送',
            x: Math.round(best.rect.x),
            y: Math.round(best.rect.y),
            w: Math.round(best.rect.width),
            h: Math.round(best.rect.height),
            source: 'zhilian_send_marker'
          };
        }""", token)
        if isinstance(result, dict) and result.get("selector"):
            return result
        generic = mark_current_chat_send_button(terminal)
        if generic.get("selector"):
            generic_ok = safe_eval(page, """selector => {
              const el = document.querySelector(selector);
              if (!el) return false;
              const input = document.querySelector('.im-sender__input textarea, .im-sender textarea, textarea[placeholder*="从这里开启对话"]');
              const sender = input ? input.closest('.im-sender') : document.querySelector('.im-sender');
              if (sender && sender.contains(el)) return true;
              if (!input) return false;
              const a = el.getBoundingClientRect();
              const b = input.getBoundingClientRect();
              return a.bottom >= b.y - 90 && a.y <= b.bottom + 130 && a.right >= b.x + Math.min(80, b.width * 0.12) && a.x <= b.right + 260;
            }""", generic.get("selector"))
            if generic_ok:
                return {**generic, "source": "generic_chat_send_marker_checked"}
        return result if isinstance(result, dict) else {"found": False, "reason": "mark_eval_failed"}

    def zhilian_click_send_button(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        marked = self.zhilian_mark_send_button(terminal)
        selector = str(marked.get("selector") or "")
        if not selector:
            return {
                "blocked": True,
                "message": "智联没有找到聊天输入区右侧的发送按钮。",
                "state": marked,
            }
        locator = page.locator(selector).first
        before_text = self.zhilian_current_chat_input_text(terminal)
        js_clicked = False
        js_click_detail: dict = {}
        js_click_script = r"""selector => {
          const el = document.querySelector(selector);
          if (!el) return { clicked: false, reason: 'missing_element' };
          const box = el.getBoundingClientRect();
          const x = Math.max(1, Math.round(box.x + box.width / 2));
          const y = Math.max(1, Math.round(box.y + box.height / 2));
          const eventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
          try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (_) {}
          try { el.focus && el.focus(); } catch (_) {}
          if (window.PointerEvent) {
            el.dispatchEvent(new PointerEvent('pointerover', { ...eventInit, pointerId: 1, pointerType: 'mouse' }));
            el.dispatchEvent(new PointerEvent('pointerenter', { ...eventInit, pointerId: 1, pointerType: 'mouse' }));
            el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
            el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerId: 1, pointerType: 'mouse' }));
          }
          el.dispatchEvent(new MouseEvent('mouseover', eventInit));
          el.dispatchEvent(new MouseEvent('mouseenter', eventInit));
          el.dispatchEvent(new MouseEvent('mousedown', { ...eventInit, buttons: 1 }));
          el.dispatchEvent(new MouseEvent('mouseup', eventInit));
          el.dispatchEvent(new MouseEvent('click', eventInit));
          try { el.click(); } catch (_) {}
          return {
            clicked: true,
            text: String(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim(),
            className: String(el.className || '')
          };
        }"""
        try:
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
        except Exception as error:
            try:
                js_click_detail = page.evaluate(js_click_script, selector) or {}
                js_clicked = bool(js_click_detail.get("clicked"))
            except Exception as fallback_error:
                return {
                    "blocked": True,
                    "message": f"智联点击发送按钮失败：{safe_text(str(error), 120)}；JS 兜底也失败：{safe_text(str(fallback_error), 120)}",
                    "state": marked,
                }
        page.wait_for_timeout(random.randint(650, 980))
        after_text = self.zhilian_current_chat_input_text(terminal)
        still_same = bool(before_text and after_text and normalize_reply_fingerprint(after_text) == normalize_reply_fingerprint(before_text))
        message = "智联已点击聊天发送按钮"
        if js_clicked:
            message += "，并执行 JS 兜底点击"
        if still_same:
            message += "，但输入框仍未清空，已停止继续补点避免重复发送"
        return {
            "message": message,
            "state": {k: v for k, v in marked.items() if k != "selector"},
            "inputBefore": safe_text(before_text, 160),
            "inputAfter": safe_text(after_text, 160),
            "jsFallback": js_clicked,
            "jsClickDetail": {k: safe_text(str(v), 120) for k, v in js_click_detail.items()} if isinstance(js_click_detail, dict) else {},
            "blocked": still_same,
        }

    def zhilian_read_chat_context(
        self,
        terminal: BrowserTerminal,
        history: dict | None = None,
        opened: dict | None = None,
    ) -> dict:
        page = terminal.current_page()
        text = safe_eval(page, "() => document.body ? document.body.innerText : ''") or ""
        header = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const selectedRow = Array.from(document.querySelectorAll('.im-session-item, .im-session-item__box')).find(el => {
            const cls = String(el.className || '');
            return /active|current|selected|checked|is-active/i.test(cls);
          }) || document.querySelector('.im-session-item, .im-session-item__box');
          const selected = selectedRow ? (selectedRow.matches('.im-session-item__box') ? selectedRow : selectedRow.querySelector('.im-session-item__box') || selectedRow) : null;
          const nameNode = selected ? selected.querySelector('.im-session-item__name-title') : null;
          const jobNode = selected ? selected.querySelector('.im-session-item-subtitle__suffix') : null;
          const detailHeader = Array.from(document.querySelectorAll('[class*="resume"],[class*="candidate"],[class*="profile"],[class*="user"]'))
            .map(el => normalize(el.innerText || el.textContent || '')).find(text => text && text.length < 300) || '';
          return {
            name: normalize(nameNode ? (nameNode.innerText || nameNode.textContent || '') : ''),
            selectedJob: normalize(jobNode ? (jobNode.innerText || jobNode.textContent || '') : ''),
            selectedLabel: normalize(selected ? (selected.innerText || selected.textContent || '') : ''),
            detailHeader
          };
        }""") or {}
        messages = self.zhilian_extract_chat_messages(terminal)
        opened = opened if isinstance(opened, dict) else {}
        opened_label = str(opened.get("label") or "")
        opened_job = str(opened.get("job") or "")
        selected_label = str((header or {}).get("selectedLabel") or "")
        selected_job = str((header or {}).get("selectedJob") or "")
        header_name = safe_text(str((header or {}).get("name") or ""), 60)
        opened_name = safe_text(str(opened.get("name") or recruiter_candidate_name_from_label(opened_label)), 60)
        selected_name = safe_text(str(recruiter_candidate_name_from_label(selected_label)), 60)
        applicant_name = safe_text(str(opened_name or header_name or selected_name), 60)
        applied_position = clean_applied_position(str(opened_job or selected_job))
        identity_warnings: list[dict] = []
        if opened_name and header_name and not recruiter_candidate_names_match(opened_name, header_name):
            identity_warnings.append({
                "type": "opened_header_name_mismatch",
                "openedName": opened_name,
                "headerName": header_name,
            })
        if opened_name and selected_name and not recruiter_candidate_names_match(opened_name, selected_name):
            identity_warnings.append({
                "type": "opened_selected_name_mismatch",
                "openedName": opened_name,
                "selectedName": selected_name,
            })
        if not applied_position:
            body_match = re.search(r"(?:当前沟通|沟通职位：?)\\s*([^\\s\\n]{2,40})\\s*职位?", str(text or ""))
            if body_match:
                applied_position = clean_applied_position(body_match.group(1))
        if not applied_position and opened_label:
            for position in ZHILIAN_CONFIGURED_POSITIONS:
                if clean_applied_position(position) in clean_applied_position(opened_label):
                    applied_position = clean_applied_position(position)
                    break
        recent_source = str(history.get("text") or "") if isinstance(history, dict) and history.get("text") else text
        last_message = last_effective_chat_message([m for m in messages if m.get("sender") != "system"])
        last_other = last_effective_chat_message([m for m in messages if m.get("sender") != "system"], sender="other")
        boss_rules = load_boss_chat_rules()
        position_reply = select_position_reply(applied_position, boss_rules)
        company_knowledge_base = select_company_knowledge_base(boss_rules, applied_position)
        label = safe_text(opened_label or selected_label or applicant_name, 180)
        conversation_key = build_conversation_key(page.url, messages, label or applicant_name)
        context = {
            "title": page.title(),
            "url": page.url,
            "platform": "zhilian",
            "recentText": safe_text(recent_source, 1600),
            "pageTextPreview": safe_text(text, 900),
            "applicant": {
                "name": applicant_name,
                "appliedPosition": applied_position,
                "label": label,
                "source": "zhilian-chat",
                "openedLabel": safe_text(opened_label, 180),
                "openedName": opened_name,
                "headerName": header_name,
                "selectedLabel": safe_text(selected_label, 180),
                "selectedName": selected_name,
                "selectedJob": clean_applied_position(selected_job),
                "identityWarnings": identity_warnings,
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
            "summary": f"智联当前会话：{safe_text(label, 80)}；岗位：{safe_text(applied_position, 60)}",
        }
        context["memory"] = self.refresh_chat_memory(context, conversation_key)
        context["companyKnowledgeHit"] = match_company_knowledge_answer(context)
        return context

    def zhilian_send_message_with_verification(self, terminal: BrowserTerminal, text: str) -> dict:
        text = strip_reply_terminal_punctuation(str(text or "").strip())
        if not text:
            return {"blocked": True, "message": "智联待发送内容为空"}
        page = terminal.current_page()
        self.zhilian_dismiss_interruptions(terminal, reason="before_send_message")
        input_locator = page.locator(".im-sender__input textarea, textarea[placeholder*='从这里开启对话']").first
        try:
            if not input_locator.count():
                return {"blocked": True, "message": "智联没有找到聊天输入框，已停止避免填错位置"}
            fill_result = self.zhilian_fill_chat_input(terminal, input_locator, text)
            if not fill_result.get("filled"):
                return {"blocked": True, "message": "智联输入框填入后校验失败，已停止避免误发", "input": fill_result}
            attempts: list[dict] = []
            send_result = self.zhilian_click_send_button(terminal)
            page.wait_for_timeout(random.randint(700, 1100))
            verify = self.zhilian_verify_reply_sent_in_current_chat(terminal, text)
            current_input = self.zhilian_current_chat_input_text(terminal)
            input_contains_expected = normalize_reply_fingerprint(text) in normalize_reply_fingerprint(current_input)
            attempts.append({
                "attempt": 1,
                "send": send_result,
                "verify": verify,
                "inputContainsExpected": input_contains_expected,
                "inputAfter": safe_text(current_input, 160),
            })
            final_input_contains_expected = normalize_reply_fingerprint(text) in normalize_reply_fingerprint(self.zhilian_current_chat_input_text(terminal))
            clicked_and_cleared = bool(send_result and not send_result.get("blocked") and not final_input_contains_expected)
            sent = bool(verify.get("verified")) or clicked_and_cleared
            return {
                "message": "智联已发送消息" if verify.get("verified") else "智联已尝试点击发送，但没有校验到消息已发出",
                "sent": sent,
                "verified": bool(verify.get("verified")),
                "verify": verify,
                "input": fill_result,
                "send": send_result,
                "attempts": attempts,
                "unsentDraft": final_input_contains_expected,
                "blocked": final_input_contains_expected or not sent,
            }
        except Exception as error:
            return {"blocked": True, "message": f"智联发送失败：{safe_text(str(error), 160)}"}

    def zhilian_inspect_resume_request_state(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        try:
            result = page.evaluate("""() => {
              const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const visible = el => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 4 && box.height > 4
                  && box.bottom > 0 && box.right > 0
                  && box.y < window.innerHeight && box.x < window.innerWidth
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0';
              };
              const rect = el => {
                const box = el.getBoundingClientRect();
                return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
              };
              const chatRoot = document.querySelector('.im-session-detail__main, .im-session-detail__three-main, .im-session-detail')
                || document.body;
              const chatText = normalize(chatRoot ? (chatRoot.innerText || chatRoot.textContent || '') : '');
              const bodyText = normalize(document.body ? document.body.innerText || '' : '');
              const attachmentTerms = [
                '查看附件简历',
                '这是我的附件简历',
                '对方设置了附件简历自动发送',
                '可直接查看附件简历',
                '附件简历，请查收'
              ];
              const requestedTerms = [
                '已要附件简历',
                '已向对方要附件简历',
                '已请求附件简历',
                '已发送简历请求',
                '简历请求已发送'
              ];
              const filePattern = /[\\u4e00-\\u9fffA-Za-z0-9_\\-（）()]+简历[^\\s]{0,24}\\.(pdf|docx?|PDF|DOCX?)/;
              const matchedAttachmentTerms = attachmentTerms.filter(term => chatText.includes(term) || bodyText.includes(term));
              const matchedRequestedTerms = requestedTerms.filter(term => chatText.includes(term) || bodyText.includes(term));
              const attachmentButtons = Array.from(document.querySelectorAll('button,a,[role=button],span,div'))
                .filter(el => visible(el) && normalize(el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '') === '查看附件简历')
                .map(el => ({ text: '查看附件简历', className: String(el.className || '').slice(0, 120), rect: rect(el) }));
              const hasResumeAttachment = matchedAttachmentTerms.length > 0 || filePattern.test(chatText) || attachmentButtons.length > 0;
              const alreadyRequested = matchedRequestedTerms.length > 0 || hasResumeAttachment;
              return {
                hasResumeAttachment,
                alreadyRequested,
                matchedAttachmentTerms,
                matchedRequestedTerms,
                attachmentButtons,
                summary: (matchedAttachmentTerms.concat(matchedRequestedTerms).join(' / ') || chatText.slice(-320) || bodyText.slice(-320)),
                source: 'zhilian_im_chat'
              };
            }""") or {}
            return result if isinstance(result, dict) else {}
        except Exception as error:
            return {"hasResumeAttachment": False, "alreadyRequested": False, "error": safe_text(str(error), 160)}

    def zhilian_find_request_resume_button(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        token = f"codex_zhilian_request_resume_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        try:
            info = page.evaluate("""token => {
              const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const visible = el => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 4 && box.height > 4
                  && box.bottom > 0 && box.right > 0
                  && box.y < window.innerHeight && box.x < window.innerWidth
                  && style.display !== 'none'
                  && style.visibility !== 'hidden'
                  && style.opacity !== '0';
              };
              const rect = el => {
                const box = el.getBoundingClientRect();
                return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
              };
              const nodes = Array.from(document.querySelectorAll('a,button,[role=button],span,div'))
                .filter(el => visible(el) && normalize(el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '') === '要附件简历');
              const candidates = [];
              for (const node of nodes) {
                const clickable = node.closest('a,button,[role=button],.km-button,.newest-attach-resume,.hover-resume-footer__button--attachment') || node;
                const cls = String(clickable.className || '') + ' ' + String(node.className || '');
                const chainText = [];
                let cur = clickable;
                for (let depth = 0; cur && depth < 7; depth += 1, cur = cur.parentElement) {
                  chainText.push(String(cur.className || ''));
                }
                const chain = chainText.join(' ');
                const disabled = clickable.disabled === true
                  || clickable.getAttribute('disabled') !== null
                  || clickable.getAttribute('aria-disabled') === 'true'
                  || /disabled|is-disabled|disable|unable|forbid/i.test(cls + ' ' + chain);
                let score = 0;
                if (clickable.closest('.im-sender__bar, .im-sender')) score += 1000;
                if (clickable.closest('.session-new-action')) score += 600;
                if (clickable.closest('.hover-resume-footer, .im-resume-detail')) score += 220;
                if (clickable.tagName === 'A' || clickable.tagName === 'BUTTON') score += 90;
                if (/km-button|newest-attach-resume|attachment/i.test(cls)) score += 80;
                const box = clickable.getBoundingClientRect();
                if (box.y > window.innerHeight * 0.70 && box.x < window.innerWidth * 0.78) score += 70;
                if (box.x > window.innerWidth * 0.75) score -= 25;
                if (disabled) score -= 2000;
                candidates.push({
                  el: clickable,
                  text: '要附件简历',
                  className: String(clickable.className || '').slice(0, 160),
                  chain: chain.slice(0, 240),
                  disabled,
                  score,
                  rect: rect(clickable)
                });
              }
              candidates.sort((a, b) => b.score - a.score);
              const best = candidates[0];
              if (!best) return { found: false, reason: 'zhilian_request_resume_button_not_found' };
              best.el.setAttribute('data-codex-zhilian-request-resume', token);
              return {
                found: true,
                token,
                label: best.text,
                className: best.className,
                chain: best.chain,
                disabled: best.disabled,
                score: best.score,
                rect: best.rect,
                candidates: candidates.slice(0, 6).map(({text, className, chain, disabled, score, rect}) => ({text, className, chain, disabled, score, rect}))
              };
            }""", token) or {}
        except Exception as error:
            return {"found": False, "error": safe_text(str(error), 160)}
        if not isinstance(info, dict) or not info.get("found"):
            return info if isinstance(info, dict) else {"found": False}
        info["locator"] = page.locator(f"[data-codex-zhilian-request-resume='{info.get('token')}']").first
        return info

    def zhilian_request_resume_from_current_conversation(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        context = self.zhilian_read_chat_context(terminal, history={"loaded": False, "reason": "zhilian_visible_dom_only"})
        candidate = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        identity_warnings = candidate.get("identityWarnings") if isinstance(candidate.get("identityWarnings"), list) else []
        if identity_warnings:
            return {
                "blocked": True,
                "message": "智联当前会话身份与刚打开的联系人不一致，已停止要附件简历，避免点错人。",
                "candidate": candidate,
                "identityWarnings": identity_warnings,
            }
        resume_state = self.zhilian_inspect_resume_request_state(terminal)
        if resume_state.get("hasResumeAttachment"):
            download_result = self.recruiter_download_visible_resume_attachment(terminal, "zhilian", context=context)
            if download_result.get("ok") and download_result.get("downloaded"):
                return {
                    "message": f"智联检测到候选人已发送附件简历，已下载：{safe_text(str(download_result.get('filename') or candidate_label), 120)}",
                    "downloaded": True,
                    "resumeReceived": True,
                    "candidate": candidate,
                    "resumeState": resume_state,
                    "download": download_result,
                    "resume": download_result,
                }
            return {
                "blocked": True,
                "message": f"智联检测到候选人已发送附件简历，但下载失败：{safe_text(str(download_result.get('message') or ''), 180)}",
                "resumeReceived": True,
                "candidate": candidate,
                "resumeState": resume_state,
                "download": download_result,
            }
        if resume_state.get("alreadyRequested"):
            return {
                "message": f"智联检测到已要过附件简历，跳过重复点击：{safe_text(candidate_label, 80)}",
                "skipped": True,
                "skipReason": "already_requested",
                "candidate": candidate,
                "resumeState": resume_state,
            }
        target = self.zhilian_find_request_resume_button(terminal)
        try:
            locator = target.get("locator") if isinstance(target, dict) else None
            if not target.get("found") or locator is None or not locator.count():
                return {"blocked": True, "message": f"智联当前会话未找到可用的要附件简历按钮：{safe_text(candidate_label, 80)}", "candidate": candidate, "state": {k: v for k, v in target.items() if k != "locator"} if isinstance(target, dict) else target}
            if target.get("disabled"):
                return {"blocked": True, "message": f"智联要附件简历按钮当前不可用：{safe_text(candidate_label, 80)}", "candidate": candidate, "state": {k: v for k, v in target.items() if k != "locator"}}
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(1200, 1900))
            after = self.zhilian_inspect_resume_request_state(terminal)
            sent_like = bool(after.get("alreadyRequested") or after.get("hasResumeAttachment"))
            return {
                "message": (
                    f"智联已点击要附件简历并检测到附件/请求状态：{safe_text(candidate_label, 80)}"
                    if sent_like else
                    f"智联已点击要附件简历，但未检测到附件/请求状态，请看页面确认：{safe_text(candidate_label, 80)}"
                ),
                "candidate": candidate,
                "state": {k: v for k, v in target.items() if k != "locator"},
                "after": after,
                "sentLike": sent_like,
                "blocked": not sent_like,
            }
        except Exception as error:
            return {"blocked": True, "message": f"智联求简历失败：{safe_text(str(error), 160)}", "candidate": candidate}

    def zhilian_candidate_state_key(self, context: dict, candidate_label: str) -> str:
        context = context if isinstance(context, dict) else {}
        applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        name = safe_text(str(applicant.get("name") or recruiter_candidate_name_from_label(candidate_label)), 60)
        position = safe_text(str(applicant.get("appliedPosition") or context.get("appliedPosition") or ""), 100)
        if name or position:
            return "zhilian_candidate_" + stable_digest(f"{name}|{position}", 24)
        return recruiter_basic_candidate_state_key(candidate_label)

    def zhilian_previous_chat_state(self, context: dict, candidate_label: str, conversation_key: str, candidate_state_key: str) -> dict:
        legacy_key = recruiter_basic_candidate_state_key(candidate_label)
        for key in (conversation_key, candidate_state_key, legacy_key):
            state = self.get_chat_state(str(key or ""))
            if state:
                return state
        return {}

    def zhilian_answer_current_candidate_questions(self, terminal: BrowserTerminal) -> dict:
        history = {"loaded": False, "reason": "zhilian_visible_dom_only"}
        context = self.zhilian_read_chat_context(terminal, history=history)
        candidate = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
        position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        if is_unconfigured_recruiter_position(context, position_reply, position_screening):
            return {
                "message": f"智联当前岗位未配置知识库，跳过不回复：{safe_text(str(context.get('appliedPosition') or ''), 80)}",
                "candidate": candidate,
                "answered": False,
                "skippedUnconfiguredPosition": True,
            }
        conversation_key = str(context.get("conversationKey") or "")
        candidate_state_key = self.zhilian_candidate_state_key(context, candidate_label)
        previous_state = self.zhilian_previous_chat_state(context, candidate_label, conversation_key, candidate_state_key)
        result = self.answer_recruiter_knowledge_question(
            terminal,
            context,
            candidate_label,
            conversation_key,
            candidate_state_key,
            previous_state=previous_state,
            send_message=lambda reply: self.zhilian_send_message_with_verification(terminal, reply),
        )
        return result or {
            "message": f"智联当前候选人没有检测到需要知识库回复的问题：{safe_text(candidate_label, 80)}",
            "candidate": candidate,
            "answered": False,
        }

    def zhilian_screen_position_rules(
        self,
        terminal: BrowserTerminal,
        context: dict,
        candidate_label: str,
        conversation_key: str,
        candidate_state_key: str,
        previous_state: dict | None,
    ) -> dict:
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        screening_rules = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        previous_state = previous_state if isinstance(previous_state, dict) else {}
        messages = context.get("messages", []) if isinstance(context.get("messages"), list) else []
        previous_status = str(previous_state.get("status") or "")
        previous_question = str(previous_state.get("lastQuestion") or "").strip()
        if previous_status in {"position_screening_sent_waiting", "position_screening_waiting"} and previous_question:
            has_previous_question_in_dom = any(
                isinstance(item, dict)
                and item.get("sender") == "me"
                and position_screening_question_matches(str(item.get("text") or ""), previous_question)
                for item in messages
            )
            if not has_previous_question_in_dom:
                synthetic_messages: list[dict] = [{"sender": "me", "text": previous_question}]
                last_message = context.get("lastMessage") if isinstance(context.get("lastMessage"), dict) else {}
                last_other = context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {}
                if last_message.get("sender") == "other" and str(last_other.get("text") or "").strip():
                    synthetic_messages.append(last_other)
                messages = synthetic_messages + messages
        analysis = self.measure_current_timing_stage(
            "zhilian_analyze_position_screening",
            "智联本地岗位规则判断",
            lambda: analyze_position_screening(messages, screening_rules),
        )
        analysis = self.measure_current_timing_stage(
            "zhilian_enhance_position_screening_model",
            "智联模型辅助岗位判断",
            lambda: enhance_position_screening_with_model(context, screening_rules, analysis, previous_state),
        )
        analysis = repair_position_screening_with_waiting_state_reply(analysis, previous_state, context)
        analysis["position"] = safe_text(str(context.get("appliedPosition") or knowledge_base.get("title") or ""), 80)
        ensure_candidate_conversation_review(context, previous_state, analysis)
        state_payload = {
            "candidateLabel": safe_text(candidate_label, 160),
            "platform": "zhilian",
            "positionTitle": safe_text(str(knowledge_base.get("title") or ""), 80),
            "appliedPosition": safe_text(str(context.get("appliedPosition") or ""), 80),
            "lastScreening": analysis.get("reason") or "",
            "screening": analysis,
        }
        knowledge_result: dict = {}
        if analysis.get("status") in {"not_asked", "waiting", "unclear"}:
            pending_question_messages = recent_unanswered_question_messages(context, previous_state)
            if pending_question_messages or match_company_knowledge_silent_question(context):
                knowledge_result = self.answer_recruiter_knowledge_question(
                    terminal,
                    context,
                    candidate_label,
                    conversation_key,
                    candidate_state_key,
                    previous_state=previous_state,
                    send_message=lambda reply: self.zhilian_send_message_with_verification(terminal, reply),
                )
                if knowledge_result.get("answered"):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
                elif zhilian_knowledge_result_blocks_resume_flow(knowledge_result):
                    return {**knowledge_result, "candidate": context.get("applicant", {}), "screening": analysis, "positionScreening": True}
                else:
                    knowledge_context = knowledge_question_context(context, pending_question_messages)
                    unknown_hit = {
                        "source": "companyKnowledgeBase.no_answer",
                        "unknownSkipped": True,
                        "answerSkipped": True,
                    }
                    unknown_items = build_recruiter_unclear_question_items(
                        candidate_label,
                        knowledge_context,
                        pending_question_messages,
                        action="knowledge_unknown_skipped",
                        screening_status="unanswered",
                        answer="",
                        knowledge_hit=unknown_hit,
                    )
                    append_recruiter_user_questions(unknown_items)
                    append_recruiter_unclear_questions(unknown_items)
        if analysis.get("status") == "not_asked":
            question = analysis.get("nextQuestion") if isinstance(analysis.get("nextQuestion"), dict) else {}
            canonical_question_text = str(question.get("text") or "").strip()
            question_text = strip_reply_terminal_punctuation(select_position_screening_question_text(question))
            if not question_text:
                return {"blocked": True, "message": "智联当前岗位没有可发送的筛选问题", "screening": analysis}
            already_asked_in_chat = any(
                isinstance(item, dict)
                and item.get("sender") == "me"
                and (
                    position_screening_question_matches(str(item.get("text") or ""), question_text)
                    or (canonical_question_text and position_screening_question_matches(str(item.get("text") or ""), canonical_question_text))
                    or position_screening_question_matches_any(str(item.get("text") or ""), question)
                )
                for item in messages
            )
            already_asked_in_state = bool(
                previous_question
                and previous_status in {"position_screening_sent_waiting", "position_screening_waiting"}
                and (
                    position_screening_question_matches(question_text, previous_question)
                    or position_screening_question_matches(previous_question, question_text)
                    or (canonical_question_text and position_screening_question_matches(canonical_question_text, previous_question))
                )
            )
            if already_asked_in_chat or already_asked_in_state:
                waiting_payload = {
                    **state_payload,
                    "lastQuestionId": safe_text(str(question.get("id") or previous_state.get("lastQuestionId") or ""), 60),
                    "lastQuestion": safe_text(question_text or previous_question, 180),
                    "lastQuestionCanonical": safe_text(canonical_question_text or str(previous_state.get("lastQuestionCanonical") or ""), 180),
                    "dedupeReason": "question_already_asked_in_chat" if already_asked_in_chat else "question_already_asked_in_state",
                }
                if conversation_key:
                    self.set_chat_state(conversation_key, "position_screening_waiting", **waiting_payload)
                if candidate_state_key:
                    self.set_chat_state(candidate_state_key, "position_screening_waiting", **waiting_payload)
                self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_waiting", context=context, **waiting_payload)
                return {
                    "message": f"智联已检测到同类筛选问题问过了，本轮不重复询问，等待候选人回复：{safe_text(candidate_label, 80)}",
                    "candidate": context.get("applicant", {}),
                    "screening": {**analysis, "status": "waiting", "reason": waiting_payload["dedupeReason"]},
                    "positionScreening": True,
                    "dedupe": True,
                }
            send_result = self.zhilian_send_message_with_verification(terminal, question_text)
            verification = send_result.get("verify") if isinstance(send_result.get("verify"), dict) else {}
            blocked = bool(send_result.get("blocked")) or not bool(verification.get("verified") or send_result.get("sent"))
            status = "position_screening_send_blocked" if blocked else "position_screening_sent_waiting"
            payload = {
                **state_payload,
                "lastQuestionId": safe_text(str(question.get("id") or ""), 60),
                "lastQuestion": safe_text(question_text, 180),
                "lastQuestionCanonical": safe_text(canonical_question_text, 180),
                "sendResult": send_result,
                "verifiedAt": time.strftime("%Y-%m-%d %H:%M:%S") if verification.get("verified") else "",
            }
            if conversation_key:
                self.set_chat_state(conversation_key, status, **payload)
            if candidate_state_key:
                self.set_chat_state(candidate_state_key, status, **payload)
            self.set_recruiter_basic_state(conversation_key, candidate_label, status, context=context, **payload)
            if blocked:
                message = f"智联已尝试发送岗位筛选问题，但没有确认发送成功，已标记待重试：{safe_text(question_text, 80)}"
            elif knowledge_result.get("answered"):
                message = (
                    f"智联已先回答候选人问题：{safe_text(str(knowledge_result.get('answer') or ''), 80)}。"
                    f"随后发送岗位筛选问题：{safe_text(question_text, 80)}"
                )
            else:
                message = f"智联已发送岗位筛选问题：{safe_text(question_text, 80)}。等待对方回复后再继续判断。"
            result = {"message": message, "candidate": context.get("applicant", {}), "screening": analysis, "sent": send_result, "verification": verification, "attempts": send_result.get("attempts", []), "blocked": blocked, "positionScreening": True}
            if knowledge_result.get("answered"):
                result["knowledgeAnswer"] = knowledge_result
            return result
        if analysis.get("status") == "waiting":
            self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_waiting", context=context, **state_payload)
            return {"message": f"智联已问过筛选问题，候选人暂未明确回复：{safe_text(candidate_label, 80)}", "candidate": context.get("applicant", {}), "screening": analysis, "positionScreening": True}
        if analysis.get("status") == "reject":
            self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_rejected", context=context, **state_payload)
            return {"message": f"智联候选人不满足岗位硬性筛选条件，已跳过不标记不合适：{safe_text(candidate_label, 80)}", "candidate": context.get("applicant", {}), "screening": analysis, "shouldMarkUnsuitable": False, "positionScreening": True}
        if analysis.get("status") == "accept":
            knowledge_result = {}
            if recent_unanswered_question_messages(context, previous_state) or match_company_knowledge_silent_question(context):
                knowledge_result = self.answer_recruiter_knowledge_question(
                    terminal,
                    context,
                    candidate_label,
                    conversation_key,
                    candidate_state_key,
                    previous_state=previous_state,
                    send_message=lambda reply: self.zhilian_send_message_with_verification(terminal, reply),
                )
                if knowledge_result.get("answered"):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
            if zhilian_knowledge_result_blocks_resume_flow(knowledge_result):
                return {**knowledge_result, "candidate": context.get("applicant", {}), "screening": analysis, "positionScreening": True}
            resume_result = self.zhilian_request_resume_from_current_conversation(terminal)
            resume_skipped = bool(resume_result.get("skipped") and resume_result.get("skipReason") in {"already_requested", "resume_attachment_received"})
            resume_downloaded = bool(resume_result.get("downloaded") or (isinstance(resume_result.get("resume"), dict) and resume_result["resume"].get("downloaded")))
            status = "position_screening_accepted_resume_downloaded" if resume_downloaded else (
                "position_screening_accepted_resume_already_requested" if resume_skipped else (
                    "position_screening_accepted_resume_blocked" if resume_result.get("blocked") else "position_screening_accepted_resume_requested"
                )
            )
            self.set_recruiter_basic_state(conversation_key, candidate_label, status, context=context, **{
                **state_payload,
                "knowledgeAnswered": bool(knowledge_result.get("answered")),
                "knowledgeAnsweredSignatures": knowledge_result.get("knowledgeAnsweredSignatures", []) if knowledge_result.get("answered") else [],
                "knowledgeAnswer": safe_text(str(knowledge_result.get("answer") or ""), 80) if knowledge_result.get("answered") else "",
            })
            if knowledge_result.get("answered"):
                message = (
                    f"智联候选人满足筛选条件，已先回复追问：{safe_text(str(knowledge_result.get('answer') or ''), 80)}；"
                    f"随后继续处理简历：{safe_text(str(resume_result.get('message') or ''), 180)}"
                )
            else:
                message = f"智联候选人满足筛选条件，已继续处理简历：{safe_text(str(resume_result.get('message') or ''), 180)}"
            result = {"message": message, "candidate": context.get("applicant", {}), "screening": analysis, "resume": resume_result, "blocked": bool(resume_result.get("blocked")), "positionScreening": True}
            if knowledge_result.get("answered"):
                result["knowledgeAnswer"] = knowledge_result
            return result
        knowledge_result = self.answer_recruiter_knowledge_question(
            terminal,
            context,
            candidate_label,
            conversation_key,
            candidate_state_key,
            previous_state=previous_state,
            send_message=lambda reply: self.zhilian_send_message_with_verification(terminal, reply),
        )
        if knowledge_result_stops_flow(knowledge_result):
            return {
                "message": knowledge_result.get("message") or "智联已按知识库回复候选人问题。",
                "candidate": context.get("applicant", {}),
                "screening": analysis,
                "knowledgeAnswer": knowledge_result,
                "positionScreening": True,
            }
        self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_unclear", context=context, **state_payload)
        return {"message": f"智联候选人对筛选问题回复不明确，先跳过：{safe_text(str(analysis.get('latestAnswerText') or candidate_label), 120)}", "candidate": context.get("applicant", {}), "screening": analysis, "positionScreening": True}

    def zhilian_process_current_position(self, terminal: BrowserTerminal, opened: dict | None = None) -> dict:
        self.check_pause()
        history = {"loaded": False, "reason": "zhilian_visible_dom_only"}
        context = self.zhilian_read_chat_context(terminal, history=history, opened=opened)
        candidate = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        conversation_key = str(context.get("conversationKey") or "")
        candidate_state_key = self.zhilian_candidate_state_key(context, candidate_label)
        previous_state = self.zhilian_previous_chat_state(context, candidate_label, conversation_key, candidate_state_key)
        if should_use_position_screening_flow(context, position_reply):
            return self.zhilian_screen_position_rules(terminal, context, candidate_label, conversation_key, candidate_state_key, previous_state)
        if is_unconfigured_recruiter_position(context, position_reply, position_screening):
            self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_unclear", context=context, platform="zhilian", lastScreening="position_screening_not_configured")
            return {"message": f"智联当前岗位未配置到知识库，跳过不回复：{safe_text(str(context.get('appliedPosition') or ''), 80)}", "candidate": candidate, "skippedUnconfiguredPosition": True}
        if not is_ai_app_basic_conditions_position(context, position_reply):
            knowledge_result = self.answer_recruiter_knowledge_question(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state=previous_state,
                send_message=lambda reply: self.zhilian_send_message_with_verification(terminal, reply),
            )
            if knowledge_result_stops_flow(knowledge_result):
                return {**knowledge_result, "candidate": candidate}
            return {"message": f"智联非 AI 岗位本轮没有需要推进的动作：{safe_text(candidate_label, 80)}", "candidate": candidate}
        phrase = str(position_reply.get("initialCommonPhrase") or BASIC_CONDITIONS_PHRASE).strip()
        screening = self.measure_current_timing_stage(
            "zhilian_analyze_basic_conditions",
            "智联本地基础条件判断",
            lambda: analyze_basic_condition_screening(context.get("messages", []), phrase),
        )
        screening = self.measure_current_timing_stage(
            "zhilian_apply_basic_waiting_state",
            "智联套用历史等待状态",
            lambda: apply_basic_waiting_state_to_screening(screening, previous_state, context),
        )
        rule_screening = screening
        if screening.get("status") != "not_asked" and context.get("lastSender") == "other":
            model_screening = self.measure_current_timing_stage(
                "zhilian_enhance_basic_conditions_model",
                "智联模型辅助基础条件判断",
                lambda: enhance_basic_condition_screening_with_model(context, phrase, screening, previous_state),
            )
            screening = preserve_zhilian_basic_acceptance_after_model(model_screening, rule_screening)
        if screening.get("status") == "not_asked":
            send_result = self.zhilian_send_message_with_verification(terminal, phrase)
            status = "basic_conditions_needs_resend" if send_result.get("blocked") else "basic_conditions_sent_waiting"
            payload = {
                "platform": "zhilian",
                "phrase": safe_text(phrase, 240),
                "screening": screening,
                "sendResult": send_result,
            }
            if conversation_key:
                self.set_chat_state(conversation_key, status, candidateLabel=safe_text(candidate_label, 160), **payload)
            if candidate_state_key:
                self.set_chat_state(candidate_state_key, status, candidateLabel=safe_text(candidate_label, 160), **payload)
            self.set_recruiter_basic_state(conversation_key, candidate_label, status, context=context, **payload)
            message = f"智联已向 AI 岗位候选人发送基础条件：{safe_text(candidate_label, 80)}"
            if send_result.get("blocked"):
                message = f"智联已填写 AI 岗位基础条件但未确认发送成功，已暂停：{safe_text(candidate_label, 80)}"
            return {"message": message, "candidate": candidate, "screening": screening, "sent": send_result, "blocked": bool(send_result.get("blocked"))}
        if screening.get("status") == "unclear":
            knowledge_result = self.answer_recruiter_knowledge_question(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state=previous_state,
                send_message=lambda reply: self.zhilian_send_message_with_verification(terminal, reply),
            )
            if knowledge_result_stops_flow(knowledge_result):
                return {**knowledge_result, "candidate": candidate, "screening": screening}
        if screening.get("status") == "waiting":
            return {"message": f"智联已发基础条件，候选人暂未明确回复：{safe_text(candidate_label, 80)}", "candidate": candidate, "screening": screening}
        if screening.get("status") == "accept":
            knowledge_result = self.answer_recruiter_knowledge_question(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state=previous_state,
                send_message=lambda reply: self.zhilian_send_message_with_verification(terminal, reply),
            ) if (recent_unanswered_question_messages(context, previous_state) or match_company_knowledge_silent_question(context)) else {}
            if zhilian_knowledge_result_blocks_resume_flow(knowledge_result):
                return {**knowledge_result, "candidate": candidate, "screening": screening}
            resume_result = self.zhilian_request_resume_from_current_conversation(terminal)
            resume_skipped = bool(resume_result.get("skipped") and resume_result.get("skipReason") in {"already_requested", "resume_attachment_received"})
            resume_downloaded = bool(resume_result.get("downloaded") or (isinstance(resume_result.get("resume"), dict) and resume_result["resume"].get("downloaded")))
            status = "basic_conditions_accepted_resume_downloaded" if resume_downloaded else (
                "basic_conditions_accepted_resume_already_requested" if resume_skipped else (
                    "basic_conditions_accepted_resume_blocked" if resume_result.get("blocked") else "basic_conditions_accepted_resume_requested"
                )
            )
            self.set_recruiter_basic_state(conversation_key, candidate_label, status, context=context, platform="zhilian", screening=screening)
            return {"message": f"智联 AI 候选人接受基础条件，已继续处理简历：{safe_text(str(resume_result.get('message') or ''), 180)}", "candidate": candidate, "screening": screening, "resume": resume_result, "blocked": bool(resume_result.get("blocked"))}
        if screening.get("status") == "reject":
            self.set_recruiter_basic_state(conversation_key, candidate_label, "basic_conditions_rejected", context=context, platform="zhilian", screening=screening)
            return {"message": f"智联 AI 候选人明确不接受基础条件，已跳过：{safe_text(candidate_label, 80)}", "candidate": candidate, "screening": screening, "shouldMarkUnsuitable": False}
        return {"message": f"智联候选人回复不明确，先跳过：{safe_text(candidate_label, 80)}", "candidate": candidate, "screening": screening}

    def zhilian_result_has_unsent_draft(self, value) -> bool:
        if isinstance(value, dict):
            if value.get("unsentDraft") is True:
                return True
            return any(self.zhilian_result_has_unsent_draft(child) for child in value.values())
        if isinstance(value, list):
            return any(self.zhilian_result_has_unsent_draft(child) for child in value)
        return False

    @timed_agent_stage("zhilian_process_all_unread_messages", "智联处理全部未读消息")
    def zhilian_process_unread_all_positions(
        self,
        terminal: BrowserTerminal,
        max_total: int = 40,
        target_position: str = "",
    ) -> dict:
        target_limit = max(1, min(80, int(max_total or 40)))
        self.zhilian_open_chat_page(terminal)
        results: list[dict] = []
        filtered: list[dict] = []
        counts: dict[str, int] = {}
        unread_filter = self.zhilian_prepare_unread_filter(terminal)
        if not unread_filter.get("found"):
            filtered.append({"reason": "unread_filter_not_found", "state": unread_filter})
        all_position_filter = self.zhilian_select_all_positions(terminal)
        if not all_position_filter.get("selected"):
            filtered.append({"reason": all_position_filter.get("reason") or "all_positions_not_selected", "state": all_position_filter})
        excluded: list[str] = []
        filtered_keys: set[str] = set()
        no_target = 0
        allowed_positions = [target_position] if clean_applied_position(target_position) else list(ZHILIAN_CONFIGURED_POSITIONS)
        while len(results) < target_limit and no_target < 12:
            self.check_pause()
            target = self.zhilian_find_next_thread(
                terminal,
                exclude_labels=excluded,
                allowed_positions=allowed_positions,
                require_unread=True,
                filtered_out=filtered,
                filtered_keys=filtered_keys,
            )
            if not target:
                scrolled = self.zhilian_scroll_conversation_list(terminal)
                no_target += 1
                if scrolled.get("scrolled"):
                    continue
                break
            label = str(target.get("label") or "")
            label_key = compact_conversation_label(label)
            if label_key:
                excluded.append(label_key)
            locator = target.get("locator")
            if locator is None:
                results.append({"index": len(results) + 1, "label": safe_text(label, 140), "action": "blocked", "message": "no locator"})
                continue
            opened_position = clean_applied_position(str(target.get("job") or "")) or clean_applied_position(target_position) or ""
            try:
                if terminal.humanize:
                    self.measure_current_timing_stage("zhilian_open_candidate_pre_pause", "智联打开候选人前停顿", lambda: terminal.pause_like_person("pre_action"))
                    highlight_target(locator)
                self.measure_current_timing_stage("zhilian_open_candidate_click", "智联点击候选人", lambda: locator.click(timeout=8000, force=True))
                if terminal.humanize:
                    self.measure_current_timing_stage("zhilian_open_candidate_post_pause", "智联打开候选人后停顿", lambda: terminal.pause_like_person("post_action"))
                terminal.current_page().wait_for_timeout(random.randint(900, 1450))
                ready = self.zhilian_wait_chat_ready(terminal, timeout_ms=4500)
                if not ready:
                    results.append({"index": len(results) + 1, "label": safe_text(label, 140), "appliedPosition": safe_text(opened_position, 80), "action": "blocked", "message": "智联打开候选人后没有出现聊天输入框，已跳过避免误填"})
                    continue
                maybe_human_reading_pause(terminal, reason="zhilian_candidate_open", text_hint=label)
            except Exception as error:
                results.append({"index": len(results) + 1, "label": safe_text(label, 140), "appliedPosition": safe_text(opened_position, 80), "action": "blocked", "message": f"智联打开候选人失败：{safe_text(str(error), 120)}"})
                continue
            context_before = self.zhilian_read_chat_context(terminal, opened=target)
            result = self.zhilian_process_current_position(terminal, opened=target)
            action = classify_recruiter_screen_result_action(result)
            counts[action] = counts.get(action, 0) + 1
            screening = result.get("screening") if isinstance(result.get("screening"), dict) else {}
            result_item = {
                "index": len(results) + 1,
                "label": safe_text(str((context_before.get("applicant") or {}).get("label") or label), 140),
                "candidateName": safe_text(str((context_before.get("applicant") or {}).get("name") or ""), 80),
                "appliedPosition": safe_text(str(context_before.get("appliedPosition") or opened_position), 80),
                "conversationKey": safe_text(str(context_before.get("conversationKey") or ""), 120),
                "unreadCount": target.get("unreadCount"),
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
                "knowledgeAnswer": result.get("knowledgeAnswer") if isinstance(result.get("knowledgeAnswer"), dict) else {},
            }
            if self.zhilian_result_has_unsent_draft(result):
                result_item["haltedBatch"] = True
                result_item["haltReason"] = "unsent_draft_after_send_attempt"
                counts["halted_unsent_draft"] = counts.get("halted_unsent_draft", 0) + 1
                results.append(result_item)
                break
            results.append(result_item)
            maybe_human_batch_pause(terminal, len(results))
        message = f"智联未读处理完成：处理 {len(results)} 人。"
        if counts:
            message += " 动作统计：" + "；".join(f"{key} {value}" for key, value in sorted(counts.items()))
        if counts.get("halted_unsent_draft"):
            message += " 已检测到智联草稿未成功发送，批处理已暂停，避免继续切换候选人。"
        if filtered:
            message += f" 跳过/未进入岗位 {len(filtered)} 项。"
        batch_report = append_recruiter_batch_report({
            "type": "zhilian_process_unread_all_positions",
            "message": safe_text(message, 800),
            "state": {"platform": "zhilian", "processedPeople": len(results), "targetPosition": clean_applied_position(target_position), "counts": counts, "filteredOut": len(filtered)},
            "results": results,
            "filteredOut": filtered[:120],
        })
        self.add_event("chat", message)
        return {"message": message, "results": results, "counts": counts, "filteredOut": filtered[:30], "state": {"processedPeople": len(results), "counts": counts, "filteredOut": len(filtered)}, "batchReportId": batch_report.get("runId")}

    def zhilian_open_recommend_page(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        self.zhilian_dismiss_interruptions(terminal, reason="before_open_recommend")
        if "zhaopin.com" in str(page.url) and "/app/recommend" in str(page.url):
            try:
                page.wait_for_selector(".recommend-item.recommend-resume-item, .job-pane__item", timeout=9000)
            except Exception:
                pass
            return {"opened": True, "url": page.url, "title": page.title(), "source": "current"}
        page.goto(ZHILIAN_RECOMMEND_URL, wait_until="domcontentloaded", timeout=18000)
        page.wait_for_timeout(random.randint(1500, 2300))
        try:
            page.wait_for_selector(".recommend-item.recommend-resume-item, .job-pane__item", timeout=9000)
        except Exception:
            pass
        self.zhilian_dismiss_interruptions(terminal, reason="after_goto_recommend")
        return {"opened": True, "url": page.url, "title": page.title(), "source": "goto"}

    def zhilian_read_selected_recommend_position(self, terminal: BrowserTerminal, target_position: str = "") -> dict:
        page = terminal.current_page()
        info = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 2 && box.height > 2
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && box.bottom > 0
              && box.top < window.innerHeight
              && box.right > 0
              && box.left < window.innerWidth;
          };
          const rect = el => {
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
          };
          const nodes = Array.from(document.querySelectorAll('.job-pane__item, .job-side-selector__item'));
          const rows = nodes.filter(visible).map((node, index) => {
            const text = normalize(node.innerText || node.textContent || '');
