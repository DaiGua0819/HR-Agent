            const meta = [
              node.className,
              node.getAttribute('aria-selected'),
              node.getAttribute('data-selected'),
              node.getAttribute('aria-current'),
              node.getAttribute('data-active'),
              node.closest('[class]') ? node.closest('[class]').className : ''
            ].map(item => String(item || '')).join(' ');
            const active = /active|selected|current|checked|is-active|--active|true/i.test(meta)
              || node.matches('.active,.selected,.is-active,[aria-selected="true"],[data-selected="true"],[aria-current="true"]');
            return { index, text, active, className: String(node.className || ''), meta: meta.slice(0, 180), rect: rect(node) };
          }).filter(item => item.text);
          const activeRows = rows.filter(item => item.active);
          return {
            selected: activeRows.length > 0,
            selectedLabel: activeRows.length ? activeRows[0].text : '',
            selectedRows: activeRows.slice(0, 5),
            visibleOptions: rows.map(item => item.text).slice(0, 40),
          };
        }""")
        if not isinstance(info, dict):
            return {"selected": False, "reason": "selected_position_probe_failed"}
        label = str(info.get("selectedLabel") or "")
        matches = bool(label and target_position and proactive_position_label_matches(label, target_position))
        return {
            **info,
            "matchesTarget": matches,
            "targetPosition": clean_applied_position(target_position),
        }

    def zhilian_click_recommend_position_item(self, terminal: BrowserTerminal, item, source: str = "") -> dict:
        page = terminal.current_page()
        try:
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(item)
            try:
                box = item.bounding_box(timeout=2200)
            except Exception:
                box = None
            if box:
                width = float(box.get("width") or 1)
                height = float(box.get("height") or 1)
                x = float(box.get("x") or 0) + min(max(width * 0.36, 18.0), max(8.0, width - 10.0))
                y = float(box.get("y") or 0) + min(max(height * 0.50, 8.0), max(6.0, height - 6.0))
                humanized_point_click(terminal, x, y, target_box=box)
                method = "precise_left_center"
            else:
                humanized_locator_click(terminal, item, force=True)
                method = "locator_click"
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            return {"clicked": True, "method": method, "source": source}
        except Exception as error:
            try:
                humanized_locator_click(terminal, item, force=True)
                return {"clicked": True, "method": "locator_click_fallback", "source": source, "fallbackError": safe_text(str(error), 120)}
            except Exception as fallback_error:
                return {
                    "clicked": False,
                    "source": source,
                    "reason": safe_text(str(fallback_error), 160),
                    "error": safe_text(str(error), 160),
                }

    def zhilian_click_and_verify_recommend_position(
        self,
        terminal: BrowserTerminal,
        item,
        target_position: str,
        label: str,
        index: int,
        source: str,
    ) -> dict:
        page = terminal.current_page()
        attempts: list[dict] = []
        for attempt in range(1, 3):
            click_result = self.zhilian_click_recommend_position_item(terminal, item, source=source)
            wait_ms = random.randint(1300, 2100) if source == "side_selector" else random.randint(1150, 1850)
            page.wait_for_timeout(wait_ms)
            self.zhilian_dismiss_interruptions(terminal, reason=f"after_select_recommend_position_{source}_{attempt}")
            verify = self.zhilian_read_selected_recommend_position(terminal, target_position)
            attempts.append({
                "attempt": attempt,
                "click": click_result,
                "verify": verify,
            })
            if verify.get("matchesTarget"):
                return {
                    "selected": True,
                    "position": target_position,
                    "label": label,
                    "index": index,
                    "source": source,
                    "verifiedLabel": verify.get("selectedLabel") or "",
                    "verifyAttempts": attempts,
                }
            if not click_result.get("clicked"):
                break
        return {
            "selected": False,
            "position": target_position,
            "label": label,
            "index": index,
            "source": source,
            "reason": "selected_position_verification_failed",
            "verifyAttempts": attempts,
        }

    def zhilian_select_recommend_position(self, terminal: BrowserTerminal, target_position: str) -> dict:
        target_position = clean_applied_position(target_position)
        if not target_position:
            return {"selected": False, "reason": "empty_target"}
        page = terminal.current_page()
        self.zhilian_dismiss_interruptions(terminal, reason="before_select_recommend_position")
        try:
            page.wait_for_selector(".job-pane__item, .job-pane__extra", timeout=9000)
        except Exception:
            pass
        visible_labels: list[str] = []
        items = page.locator(".job-pane__item")
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
            if not label:
                continue
            visible_labels.append(label)
            if proactive_position_label_matches(label, target_position):
                selected = self.zhilian_click_and_verify_recommend_position(
                    terminal,
                    item,
                    target_position,
                    label,
                    index,
                    "job_pane",
                )
                if selected.get("selected"):
                    return selected
                return {**selected, "visibleOptions": visible_labels[:30]}
        try:
            extra = page.locator(".job-pane__extra").first
            if extra.count():
                extra.click(timeout=5000, force=True)
                page.wait_for_timeout(random.randint(700, 1100))
        except Exception:
            pass
        side_items = page.locator(".job-side-selector__item")
        try:
            side_count = side_items.count()
        except Exception:
            side_count = 0
        for index in range(side_count):
            item = side_items.nth(index)
            try:
                label = safe_text(item.inner_text(timeout=1000), 160)
            except Exception:
                continue
            if label:
                visible_labels.append(label)
            if proactive_position_label_matches(label, target_position):
                selected = self.zhilian_click_and_verify_recommend_position(
                    terminal,
                    item,
                    target_position,
                    label,
                    index,
                    "side_selector",
                )
                if selected.get("selected"):
                    return selected
                return {**selected, "visibleOptions": visible_labels[:30]}
        return {"selected": False, "position": target_position, "reason": "recommend_position_not_found", "visibleOptions": visible_labels[:30]}

    def zhilian_collect_recommend_candidate_cards(self, terminal: BrowserTerminal) -> list[dict]:
        page = terminal.current_page()
        try:
            page.wait_for_selector(".recommend-item.recommend-resume-item, .recommend-resume-item", timeout=5000)
        except Exception:
            pass
        items = safe_eval(page, """() => {
          const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
          const runToken = `codex_zhilian_card_${Date.now()}_${Math.random().toString(16).slice(2)}`;
          document.querySelectorAll('[data-codex-zhilian-card-token]').forEach(el => {
            el.removeAttribute('data-codex-zhilian-card-token');
          });
          const visibleElement = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 2 && box.height > 2
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && box.bottom >= 90
              && box.top <= window.innerHeight - 20;
          };
          const visibleCard = el => {
            if (!visibleElement(el)) return false;
            const box = el.getBoundingClientRect();
            return box.width > 80 && box.height > 70 && box.top >= 100;
          };
          const rect = el => {
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
          };
          const roots = Array.from(new Set(Array.from(document.querySelectorAll('.recommend-item.recommend-resume-item,.recommend-resume-item')).map(el => el.closest('.recommend-item') || el)));
          return roots.map((card, domIndex) => {
            const token = `${runToken}_${domIndex}`;
            card.setAttribute('data-codex-zhilian-card-token', token);
            const cardBox = card.getBoundingClientRect();
            const viewedBadges = Array.from(card.querySelectorAll('*')).map(node => {
              if (!visibleElement(node)) return null;
              const badgeText = normalize(node.innerText || node.textContent || '');
              if (!/^(已看|看过)$/.test(badgeText)) return null;
              const box = node.getBoundingClientRect();
              const nearLeftTop = box.left <= cardBox.left + 96 && box.top <= cardBox.top + 42;
              if (!nearLeftTop) return null;
              return { text: badgeText, rect: rect(node) };
            }).filter(Boolean);
            const buttons = Array.from(card.querySelectorAll('button,a,[role="button"],.resume-button')).filter(visibleElement).map(btn => ({
              text: normalize(btn.innerText || btn.textContent || ''),
              className: String(btn.className || ''),
              rect: rect(btn)
            })).filter(item => item.text);
            const text = normalize(card.innerText || card.textContent || '');
            const hasGreetButton = buttons.some(btn => btn.text === '打招呼' || /打招呼/.test(btn.text)) || /打招呼/.test(text);
            const alreadyContacted = /(已沟通|已联系|已打招呼|继续沟通|沟通过|不合适)/.test(text) && !hasGreetButton;
            const alreadyViewed = viewedBadges.length > 0;
            return { domIndex, token, visible: visibleCard(card), text, className: String(card.className || ''), hasGreetButton, alreadyContacted, alreadyViewed, viewedBadges, buttons, rect: rect(card) };
          }).filter(item => item.visible && item.text);
        }""")
        return items if isinstance(items, list) else []

    def zhilian_read_open_recommend_resume_modal(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        detail = safe_eval(page, """() => {
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
          const modal = Array.from(document.querySelectorAll('.new-shortcut-resume__modal .km-modal--open, .new-shortcut-resume__modal, .resume-detail-wrap'))
            .find(visible);
          if (!modal) return { opened: false, reason: 'resume_modal_not_found', url: location.href };
          const detailRoot = modal.querySelector('.resume-detail-wrap, .new-resume-detail, .resume-content-new') || modal;
          const buttons = Array.from(modal.querySelectorAll('button,a,[role="button"],.resume-button'))
            .filter(visible)
            .map(btn => ({ text: normalize(btn.innerText || btn.textContent || ''), className: String(btn.className || ''), rect: rect(btn) }))
            .filter(item => item.text);
          const text = normalize(detailRoot.innerText || detailRoot.textContent || modal.innerText || modal.textContent || '');
          const modalText = normalize(modal.innerText || modal.textContent || '');
          let resumeNumber = '';
          try {
            resumeNumber = new URL(location.href).searchParams.get('resumeNumber') || '';
          } catch (_) {}
          return {
            opened: true,
            url: location.href,
            resumeNumber,
            text,
            modalText,
            buttons,
            hasGreetButton: buttons.some(btn => /打招呼/.test(btn.text)),
            alreadyContacted: /(已沟通|已联系|已打招呼|继续沟通|沟通过|不合适)/.test(modalText) && !buttons.some(btn => /打招呼/.test(btn.text)),
            candidateName: ((modalText.match(/^\\s*([\\u4e00-\\u9fa5A-Za-z]{1,8}(?:先生|女士|小姐|同学)?)/) || [])[1] || '')
          };
        }""")
        return detail if isinstance(detail, dict) else {"opened": False, "reason": "resume_modal_read_failed"}

    def zhilian_close_recommend_resume_modal(self, terminal: BrowserTerminal, reason: str = "") -> dict:
        page = terminal.current_page()
        modal_visible_js = """() => {
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
          return Array.from(document.querySelectorAll('.new-shortcut-resume__modal .km-modal--open, .new-shortcut-resume__modal, .resume-detail-wrap')).some(visible);
        }"""
        has_modal = bool(safe_eval(page, modal_visible_js))
        if not has_modal:
            return {"closed": False, "reason": "no_modal"}
        close_locator = page.locator(".new-shortcut-resume__modal .new-shortcut-resume__close, .new-shortcut-resume__close, .km-modal--open .km-modal__close, .km-modal__close").first
        try:
            if close_locator.count():
                if terminal.humanize:
                    highlight_target(close_locator)
                humanized_precise_button_click(terminal, close_locator, force=True)
                page.wait_for_timeout(random.randint(520, 980))
        except Exception:
            pass
        still_open = bool(safe_eval(page, modal_visible_js))
        if still_open:
            try:
                page.keyboard.press("Escape")
                page.wait_for_timeout(random.randint(420, 760))
            except Exception:
                pass
        still_open = bool(safe_eval(page, modal_visible_js))
        return {"closed": not still_open, "reason": safe_text(reason, 80)}

    def zhilian_open_recommend_candidate_detail(
        self,
        terminal: BrowserTerminal,
        dom_index: int,
        card_token: str = "",
    ) -> dict:
        page = terminal.current_page()
        self.zhilian_close_recommend_resume_modal(terminal, reason="before_open_next_detail")
        token = re.sub(r"[^a-zA-Z0-9_-]+", "", str(card_token or ""))
        card = None
        if token:
            try:
                marked = page.locator(f'[data-codex-zhilian-card-token="{token}"]').first
                if marked.count():
                    card = marked
            except Exception:
                card = None
        if card is None:
            card = page.locator(".recommend-item.recommend-resume-item,.recommend-resume-item").nth(max(0, int(dom_index or 0)))
        try:
            card.scroll_into_view_if_needed(timeout=3500)
        except Exception:
            pass
        content = card.locator(".resume-item__basic-info, .resume-item__basic, .resume-item__content, .recommend-resume-item__inner, .resume-card-exp").first
        try:
            target = content if content.count() else card
        except Exception:
            target = card
        try:
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(target)
            try:
                box = target.bounding_box(timeout=3000)
            except Exception:
                box = None
            if box:
                x = float(box.get("x") or 0) + min(max(float(box.get("width") or 1) * 0.36, 82.0), max(18.0, float(box.get("width") or 1) - 18.0))
                y = float(box.get("y") or 0) + min(max(float(box.get("height") or 1) * 0.42, 34.0), max(12.0, float(box.get("height") or 1) - 12.0))
                humanized_point_click(terminal, x, y, target_box=box)
            else:
                humanized_locator_click(terminal, target, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            try:
                page.wait_for_selector(".new-shortcut-resume__modal .km-modal--open, .new-shortcut-resume__modal, .resume-detail-wrap", timeout=6500)
            except Exception:
                pass
            page.wait_for_timeout(random.randint(900, 1500))
            detail = self.zhilian_read_open_recommend_resume_modal(terminal)
            if detail.get("opened"):
                maybe_human_reading_pause(terminal, reason="candidate_open", text_hint=str(detail.get("text") or ""))
            return detail
        except Exception as error:
            return {"opened": False, "reason": safe_text(str(error), 180)}

    def zhilian_recommend_common_gate(
        self,
        candidate_name: str,
        target_position: str,
        card_text: str,
        detail_text: str,
    ) -> dict:
        origin = self.find_proactive_contact_origin(
            candidate_name=candidate_name,
            applied_position=target_position,
            candidate_label=card_text,
        )
        if origin.get("matched"):
            return {"allowed": False, "reason": "identity_duplicate", "origin": origin}
        combined = f"{card_text}\n{detail_text}"
        compact = re.sub(r"\s+", "", str(combined or ""))
        if re.search(r"(沟通日期|沟通职位|已沟通|已联系|继续沟通|沟通过|已打招呼)", compact):
            return {
                "allowed": False,
                "reason": "zhilian_already_has_communication_record",
                "evidence": safe_text(str(detail_text or card_text or ""), 220),
            }
        return {"allowed": True, "reason": "zhilian_common_gate_passed"}

    def zhilian_click_recommend_modal_greet(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        modal = page.locator(".new-shortcut-resume__modal .km-modal--open, .new-shortcut-resume__modal").first
        try:
            if not modal.count():
                return {"clicked": False, "reason": "resume_modal_not_found"}
        except Exception:
            return {"clicked": False, "reason": "resume_modal_not_found"}
        greet = modal.locator("button").filter(has_text=re.compile(r"打招呼")).first
        try:
            if not greet.count():
                greet = modal.locator(".resume-button,[role='button'],a").filter(has_text=re.compile(r"打招呼")).first
            if not greet.count():
                return {"clicked": False, "reason": "greet_button_missing"}
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(greet)
            humanized_precise_button_click(terminal, greet, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(1200, 2100))
            return {"clicked": True}
        except Exception as error:
            return {"clicked": False, "reason": safe_text(str(error), 180)}

    def zhilian_extract_recommend_candidate_name(self, text: str) -> str:
        normalized = re.sub(r"\s+", " ", str(text or "")).strip()
        if not normalized:
            return ""
        match = re.search(r"^([\u4e00-\u9fa5A-Za-z]{1,8}(?:先生|女士|小姐|同学)?)\s", normalized)
        if match:
                return safe_text(match.group(1), 24)
        return extract_recommend_candidate_name(normalized)

    def zhilian_sanitize_proactive_evidence_text(self, text: str, target_position: str) -> str:
        cleaned = str(text or "")
        target = clean_applied_position(target_position)
        variants = {
            target,
            target.rstrip("）)"),
            target.replace("（", "(").replace("）", ")"),
            target.replace("(", "（").replace(")", "）"),
        }
        for variant in list(variants):
            if variant:
                cleaned = cleaned.replace(variant, " ")
        cleaned = re.sub(r"(打电话|打招呼|继续沟通|已沟通|已联系|已打招呼)", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned

    def zhilian_evaluate_proactive_candidate(self, evidence_text: str, target_position: str) -> dict:
        result = self.job51_evaluate_proactive_candidate(evidence_text, target_position)
        if isinstance(result, dict):
            result["platform"] = "zhilian"
            if result.get("reason") == "matched_job51_proactive_rules":
                result["reason"] = "matched_zhilian_proactive_rules"
            if result.get("reason") == "job51_proactive_rules_not_configured":
                result["reason"] = "zhilian_proactive_rules_not_configured"
                result["required"] = "该岗位尚未配置智联主动联系门槛"
        return result

    def zhilian_scroll_recommend_cards(self, terminal: BrowserTerminal) -> dict:
        page = terminal.current_page()
        before_state = safe_eval(page, """() => {
          const root = document.scrollingElement || document.documentElement;
          return {
            before: Math.round(root.scrollTop || window.scrollY || 0),
            amount: Math.max(420, Math.floor((window.innerHeight || 720) * 0.72))
          };
        }""")
        amount = int((before_state or {}).get("amount") or 520) if isinstance(before_state, dict) else 520
        try:
            if terminal.humanize:
                list_locator = page.locator(".recommend-list, .talent-recommend").first
                humanized_scroll(terminal, amount, locator=list_locator)
            else:
                page.evaluate("(amount) => window.scrollBy(0, amount)", amount)
        except Exception:
            page.evaluate("(amount) => window.scrollBy(0, amount)", amount)
        result = safe_eval(page, """() => {
          const root = document.scrollingElement || document.documentElement;
          const after = Math.round(root.scrollTop || window.scrollY || 0);
          return { after };
        }""")
        if isinstance(before_state, dict) and isinstance(result, dict):
            before = int(before_state.get("before") or 0)
            after = int(result.get("after") or 0)
            result = {**result, "before": before, "amount": amount, "scrolled": abs(after - before) > 2}
        page.wait_for_timeout(random.randint(800, 1300))
        self.zhilian_dismiss_interruptions(terminal, reason="after_recommend_scroll")
        return result if isinstance(result, dict) else {"scrolled": False}

    @timed_agent_stage("zhilian_proactive_contact", "智联主动联系推荐候选人")
    def zhilian_proactive_contact_recommended_candidates(
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
            target_position = clean_applied_position(target_position or ZHILIAN_CONFIGURED_POSITIONS[0])
            target_count = max(1, min(30, int(max_total or 10)))
            entry = self.zhilian_open_recommend_page(terminal)
            selected = self.zhilian_select_recommend_position(terminal, target_position)
            if not selected.get("selected"):
                return {"blocked": True, "message": f"智联推荐页没有找到目标岗位：{safe_text(target_position, 80)}", "entry": entry, "selection": selected, "results": [], "skipped": []}
            results: list[dict] = []
            skipped: list[dict] = []
            seen_keys: set[str] = set()
            opened_candidate_keys: set[str] = set()
            scroll_round = 0
            no_new_rounds = 0
            while len(results) < target_count and scroll_round <= 10 and no_new_rounds < 3:
                self.check_pause()
                self.zhilian_dismiss_interruptions(terminal, reason="before_collect_recommend_cards")
                cards = self.zhilian_collect_recommend_candidate_cards(terminal)
                handled_this_round = 0
                for card in cards:
                    if len(results) >= target_count:
                        break
                    text = str(card.get("text") or "")
                    candidate_name = self.zhilian_extract_recommend_candidate_name(text)
                    candidate_key = stable_digest(f"zhilian|{target_position}|{text[:700]}", 20)
                    if not candidate_key or candidate_key in seen_keys:
                        continue
                    seen_keys.add(candidate_key)
                    state_key = f"zhilian_proactive|{target_position}|{candidate_key}"
                    old_state = self.get_chat_state(state_key)
                    if str(old_state.get("status") or "") == "proactive_greeted":
                        skipped.append({"candidateName": candidate_name, "action": "already_greeted_skipped", "reason": "state_duplicate"})
                        continue
                    if card.get("alreadyViewed"):
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "already_viewed_skipped",
                            "reason": "zhilian_card_top_left_viewed_badge",
                            "preview": safe_text(text, 220),
                            "viewedBadges": card.get("viewedBadges") if isinstance(card.get("viewedBadges"), list) else [],
                        })
                        continue
                    if card.get("alreadyContacted") or not card.get("hasGreetButton"):
                        skipped.append({"candidateName": candidate_name, "action": "already_contacted_or_no_button_skipped", "reason": "already_contacted_or_no_greet_button", "preview": safe_text(text, 180)})
                        continue
                    card_token = str(card.get("token") or "")
                    detail = self.zhilian_open_recommend_candidate_detail(
                        terminal,
                        int(card.get("domIndex") or 0),
                        card_token=card_token,
                    )
                    if not detail.get("opened"):
                        skipped.append({
                            "candidateName": candidate_name,
                            "action": "detail_probe_failed_skipped",
                            "reason": detail.get("reason") or "detail_probe_failed",
                            "preview": safe_text(text, 180),
                        })
                        self.zhilian_close_recommend_resume_modal(terminal, reason="detail_probe_failed_cleanup")
                        continue
                    try:
                        raw_evidence_text = str(detail.get("text") or detail.get("modalText") or "") or text
                        evidence_text = self.zhilian_sanitize_proactive_evidence_text(raw_evidence_text, target_position)
                        detail_name = self.zhilian_extract_recommend_candidate_name(str(detail.get("candidateName") or evidence_text))
                        card_candidate_name = candidate_name
                        if card_candidate_name and detail_name and not recruiter_candidate_names_match(card_candidate_name, detail_name):
                            skipped.append({
                                "candidateName": safe_text(card_candidate_name, 40),
                                "detailCandidateName": safe_text(detail_name, 40),
                                "action": "candidate_identity_mismatch_skipped",
                                "reason": "card_detail_candidate_name_mismatch",
                                "detailUrl": detail.get("url"),
                                "preview": safe_text(text, 220),
                                "detailPreview": safe_text(evidence_text, 320),
                                "cardToken": safe_text(card_token, 80),
                            })
                            continue
                        if detail_name:
                            candidate_name = detail_name
                        detail_candidate_key = stable_digest(
                            f"zhilian|{target_position}|{detail.get('resumeNumber') or detail.get('url') or evidence_text[:1200]}",
                            20,
                        )
                        if detail_candidate_key and detail_candidate_key != candidate_key:
                            if detail_candidate_key in seen_keys:
                                skipped.append({
                                    "candidateName": candidate_name,
                                    "action": "already_greeted_skipped",
                                    "reason": "detail_identity_duplicate_in_run",
                                    "detailUrl": detail.get("url"),
                                })
                                continue
                            seen_keys.add(detail_candidate_key)
                            detail_state_key = f"zhilian_proactive|{target_position}|{detail_candidate_key}"
                            detail_old_state = self.get_chat_state(detail_state_key)
                            if str(detail_old_state.get("status") or "") == "proactive_greeted":
                                skipped.append({
                                    "candidateName": candidate_name,
                                    "action": "already_greeted_skipped",
                                    "reason": "detail_state_duplicate",
                                    "detailUrl": detail.get("url"),
                                })
                                continue
                            candidate_key = detail_candidate_key
                            state_key = detail_state_key
                        opened_candidate_keys.add(candidate_key)
                        if detail.get("alreadyContacted") or not detail.get("hasGreetButton"):
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "already_contacted_or_no_button_skipped",
                                "reason": "detail_already_contacted_or_no_greet_button",
                                "detailUrl": detail.get("url"),
                                "preview": safe_text(text, 180),
                                "detailPreview": safe_text(evidence_text, 260),
                            })
                            continue
                        common_gate = self.zhilian_recommend_common_gate(
                            candidate_name=candidate_name,
                            target_position=target_position,
                            card_text=text,
                            detail_text=evidence_text,
                        )
                        if not common_gate.get("allowed"):
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "common_gate_not_passed_skipped",
                                "reason": common_gate.get("reason") or "common_gate_not_passed",
                                "commonGate": common_gate,
                                "detailUrl": detail.get("url"),
                                "preview": safe_text(text, 180),
                                "detailPreview": safe_text(evidence_text, 260),
                            })
                            continue
                        screening = self.zhilian_evaluate_proactive_candidate(evidence_text, target_position)
                        if not screening.get("allowed"):
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "screening_not_qualified_skipped",
                                "reason": screening.get("reason") or "not_qualified",
                                "screening": screening,
                                "detailUrl": detail.get("url"),
                                "preview": safe_text(text, 180),
                                "detailPreview": safe_text(evidence_text, 260),
                            })
                            continue
                        if dry_run:
                            results.append({
                                "candidateName": candidate_name,
                                "action": "dry_run_would_greet",
                                "commonGate": common_gate,
                                "screening": screening,
                                "detailUrl": detail.get("url"),
                                "preview": safe_text(text, 220),
                                "detailPreview": safe_text(evidence_text, 280),
                            })
                            handled_this_round += 1
                            continue
                        greet_result = self.zhilian_click_recommend_modal_greet(terminal)
                        if not greet_result.get("clicked"):
                            skipped.append({
                                "candidateName": candidate_name,
                                "action": "greet_button_missing_skipped",
                                "reason": greet_result.get("reason") or "greet_button_missing",
                                "detailUrl": detail.get("url"),
                                "preview": safe_text(text, 180),
                                "detailPreview": safe_text(evidence_text, 260),
                            })
                            continue
                        cleanup = self.zhilian_dismiss_interruptions(terminal, reason="after_zhilian_greet")
                        self.set_chat_state(
                            state_key,
                            "proactive_greeted",
                            candidateName=candidate_name,
                            appliedPosition=target_position,
                            candidateLabel=safe_text(text, 220),
                            candidateDetailUrl=detail.get("url"),
                            candidateResumeNumber=detail.get("resumeNumber"),
                            proactiveCandidateKey=candidate_key,
                            proactiveCommonGate=common_gate,
                            proactiveScreening=screening,
                            candidateDetailPreview=safe_text(evidence_text, 700),
                            source="zhilian_recommend",
                            platform="zhilian",
                        )
                        results.append({
                            "candidateName": candidate_name,
                            "action": "greeted",
                            "commonGate": common_gate,
                            "screening": screening,
                            "cleanup": cleanup,
                            "detailUrl": detail.get("url"),
                            "preview": safe_text(text, 220),
                            "detailPreview": safe_text(evidence_text, 280),
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
                    finally:
                        self.zhilian_close_recommend_resume_modal(terminal, reason="after_candidate_detail")
                if len(results) >= target_count:
                    break
                no_new_rounds = no_new_rounds + 1 if handled_this_round == 0 else 0
                scroll_round += 1
                scrolled = self.zhilian_scroll_recommend_cards(terminal)
                if not scrolled.get("scrolled"):
                    break
            counts = {
                "opened": len(opened_candidate_keys),
                "openedCandidates": len(opened_candidate_keys),
                "greeted": len([item for item in results if item.get("action") == "greeted"]),
                "dryRun": len([item for item in results if item.get("action") == "dry_run_would_greet"]),
                "skipped": len(skipped),
            }
            action_text = "可主动联系" if dry_run else "已主动联系"
            message = f"智联 {safe_text(target_position, 50)} 主动联系完成：{action_text} {len(results)} 人，跳过 {len(skipped)} 人。"
            batch_report = append_recruiter_batch_report({
                "type": "zhilian_proactive_contact_recommended_candidates",
                "message": safe_text(message, 800),
                "state": {"platform": "zhilian", "targetPosition": target_position, "dryRun": bool(dry_run), "counts": counts},
                "results": results,
                "skipped": skipped[:160],
            })
            self.add_event("chat", message)
            return {"message": message, "results": results, "skipped": skipped[:80], "counts": counts, "batchReportId": batch_report.get("runId")}
        finally:
            self.proactive_task_lock.release()

    @timed_agent_stage("send_reply_with_verification", "发送消息并验证")
    def send_current_chat_reply_with_verification(
        self,
        terminal: BrowserTerminal,
        expected_text: str,
        max_attempts: int = CHAT_SEND_MAX_ATTEMPTS,
    ) -> dict:
        expected_text = str(expected_text or "").strip()
        attempts: list[dict] = []
        last_send: dict = {}
        last_verification: dict = {}
        for attempt in range(1, max(1, int(max_attempts or CHAT_SEND_MAX_ATTEMPTS)) + 1):
            last_send = self.measure_current_timing_stage(
                "click_chat_send_button",
                "点击聊天发送按钮",
                lambda: click_current_chat_send_button(terminal),
            )
            terminal.current_page().wait_for_timeout(random.randint(520, 900))
            last_verification = self.verify_reply_sent_in_current_chat(terminal, expected_text)
            attempts.append({
                "attempt": attempt,
                "send": last_send,
                "verification": last_verification,
            })
            if last_verification.get("verified"):
                return {
                    "send": {**last_send, "attempt": attempt, "attempts": attempts},
                    "verification": last_verification,
                    "attempts": attempts,
                }
            current_text = current_chat_editor_text(terminal)
            if expected_text and normalize_reply_fingerprint(expected_text) not in normalize_reply_fingerprint(current_text):
                self.smart_fill(terminal, "聊天", expected_text)
                terminal.current_page().wait_for_timeout(random.randint(260, 520))
        return {
            "send": {**last_send, "blocked": True, "attempts": attempts},
            "verification": last_verification,
            "attempts": attempts,
        }

    @timed_agent_stage("verify_reply_sent", "发送后检查")
    def verify_reply_sent_in_current_chat(self, terminal: BrowserTerminal, text: str) -> dict:
        expected = re.sub(r"\s+", "", str(text or ""))
        if not expected:
            return {"verified": False, "reason": "empty_expected"}
        try:
            terminal.current_page().wait_for_timeout(random.randint(650, 1050))
            messages = self.extract_chat_messages(terminal)
        except Exception as error:
            return {"verified": False, "reason": safe_text(str(error), 160)}
        last_my = {}
        for item in reversed(messages[-12:]):
            if not isinstance(item, dict) or item.get("sender") != "me":
                continue
            last_my = item
            actual = re.sub(r"\s+", "", str(item.get("text") or ""))
            if expected and (expected in actual or actual in expected):
                return {
                    "verified": True,
                    "message": safe_text(str(item.get("text") or ""), 120),
                }
        return {
            "verified": False,
            "reason": "reply_not_found_in_recent_my_messages",
            "lastMy": safe_text(str(last_my.get("text") or ""), 120) if isinstance(last_my, dict) else "",
        }

    def handle_basic_acceptance_and_request_resume(
        self,
        terminal: BrowserTerminal,
        context: dict,
        candidate_label: str,
        conversation_key: str,
        candidate_state_key: str,
        previous_state: dict | None,
        screening: dict,
        knowledge_result: dict | None = None,
    ) -> dict:
        knowledge_result = knowledge_result if isinstance(knowledge_result, dict) else {}
        local_question_messages = recent_unanswered_question_messages(context, previous_state)
        if not knowledge_result and (screening_has_followup_question(screening) or local_question_messages or match_company_knowledge_silent_question(context)):
            knowledge_result = self.answer_recruiter_knowledge_question(
                terminal,
                context,
                candidate_label,
                conversation_key,
                candidate_state_key,
                previous_state=previous_state,
            )
            if knowledge_result.get("answered"):
                terminal.current_page().wait_for_timeout(random.randint(650, 1150))
            elif knowledge_result_stops_flow(knowledge_result):
                return {
                    **knowledge_result,
                    "screening": screening,
                }

        resume_result = self.request_resume_from_recruiter_conversation(
            terminal,
            confirmed=False,
            open_unreplied=False,
            target_candidate="",
        )
        resume_skipped = bool(resume_result.get("skipped") and resume_result.get("skipReason") in {"already_requested", "resume_attachment_received"})
        resume_blocked = bool(resume_result.get("blocked"))
        state_status = "basic_conditions_accepted_resume_requested"
        if resume_skipped:
            state_status = "basic_conditions_accepted_resume_already_requested"
        elif resume_blocked:
            state_status = "basic_conditions_accepted_resume_blocked"
        state_payload = {
            "candidateLabel": safe_text(candidate_label, 160),
            "knowledgeAnswered": bool(knowledge_result.get("answered")),
            "knowledgeAnsweredSignatures": knowledge_result.get("knowledgeAnsweredSignatures", []) if knowledge_result.get("answered") else [],
            "knowledgeAnswer": safe_text(str(knowledge_result.get("answer") or ""), 80) if knowledge_result.get("answered") else "",
            "lastScreening": screening.get("reason") or "",
        }
        if conversation_key:
            self.set_chat_state(conversation_key, state_status, **state_payload)
        if candidate_state_key:
            self.set_chat_state(candidate_state_key, state_status, **state_payload)
        self.set_recruiter_basic_state(
            conversation_key,
            candidate_label,
            state_status,
            context=context,
            **state_payload,
        )

        resume_message = resume_result.get("message") or "已尝试求简历。"
        if resume_skipped:
            if knowledge_result.get("answered"):
                message = (
                    f"候选人已明确接受基础条件，已先回复追问："
                    f"{safe_text(str(knowledge_result.get('answer') or ''), 80)}；"
                    f"随后检测到之前已经求过简历，本轮跳过重复点击：{safe_text(resume_message, 220)}"
                )
            else:
                message = (
                    f"候选人已明确接受基础条件；检测到之前已经求过简历，"
                    f"本轮跳过重复点击：{safe_text(resume_message, 220)}"
                )
        elif resume_blocked:
            if knowledge_result.get("answered"):
                message = (
                    f"候选人已明确接受基础条件，已先回复追问："
                    f"{safe_text(str(knowledge_result.get('answer') or ''), 80)}；"
                    f"但求简历流程未完成：{safe_text(resume_message, 220)}"
                )
            else:
                message = (
                    f"候选人已明确接受基础条件，但求简历流程未完成："
                    f"{safe_text(resume_message, 220)}"
                )
        elif knowledge_result.get("answered"):
            message = (
                f"候选人已明确接受基础条件，已先回复追问："
                f"{safe_text(str(knowledge_result.get('answer') or ''), 80)}；"
                f"随后继续执行“求简历”：{safe_text(resume_message, 220)}"
            )
        else:
            message = (
                f"候选人已明确接受基础条件，已继续执行“求简历”："
                f"{safe_text(resume_message, 220)}"
            )
        result = {
            "message": message,
            "resume": resume_result,
            "blocked": bool(resume_result.get("blocked")),
        }
        if knowledge_result.get("answered"):
            result["knowledgeAnswer"] = knowledge_result
        return result

    @timed_agent_stage("screen_position_rules", "岗位规则判断")
    def screen_recruiter_position_rules(
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
        messages = context.get("messages", []) if isinstance(context.get("messages"), list) else []
        previous_state = previous_state if isinstance(previous_state, dict) else {}
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
            "analyze_position_screening",
            "本地岗位规则判断",
            lambda: analyze_position_screening(messages, screening_rules),
        )
        analysis = self.measure_current_timing_stage(
            "enhance_position_screening_model",
            "模型辅助岗位判断",
            lambda: enhance_position_screening_with_model(
                context,
                screening_rules,
                analysis,
                previous_state,
            ),
        )
        analysis["position"] = safe_text(str(context.get("appliedPosition") or knowledge_base.get("title") or ""), 80)
        ensure_candidate_conversation_review(context, previous_state, analysis)
        state_payload = {
            "candidateLabel": safe_text(candidate_label, 160),
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
                )
                if knowledge_result.get("answered"):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
                elif knowledge_result_stops_flow(knowledge_result):
                    return {
                        **knowledge_result,
                        "candidate": read_recruiter_selected_candidate(terminal),
                        "screening": analysis,
                        "positionScreening": True,
                    }
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
                return {
                    "blocked": True,
                    "message": "当前岗位配置了筛选流程，但没有可发送的问题文本。",
                    "screening": analysis,
                    "positionScreening": True,
                }
            label = self.smart_fill(terminal, "聊天", question_text)
            terminal.current_page().wait_for_timeout(random.randint(260, 520))
            send_package = self.send_current_chat_reply_with_verification(
                terminal,
                question_text,
                max_attempts=CHAT_SEND_MAX_ATTEMPTS,
            )
            send_result = send_package.get("send") if isinstance(send_package.get("send"), dict) else {}
            verification = send_package.get("verification") if isinstance(send_package.get("verification"), dict) else {}
            blocked = bool(send_result.get("blocked")) or not bool(verification.get("verified"))
            status = "position_screening_send_blocked" if blocked else "position_screening_sent_waiting"
            payload = {
                **state_payload,
                "lastQuestionId": safe_text(str(question.get("id") or ""), 60),
                "lastQuestion": safe_text(question_text, 180),
                "lastQuestionCanonical": safe_text(canonical_question_text, 180),
                "inputLabel": safe_text(label, 80),
                "verifiedAt": time.strftime("%Y-%m-%d %H:%M:%S") if verification.get("verified") else "",
            }
            if conversation_key:
                self.set_chat_state(conversation_key, status, **payload)
            if candidate_state_key:
                self.set_chat_state(candidate_state_key, status, **payload)
            self.set_recruiter_basic_state(conversation_key, candidate_label, status, context=context, **payload)
            if blocked:
                message = (
                    f"已尝试向{safe_text(candidate_label, 60)}发送岗位筛选问题，"
                    "但没有在聊天记录里确认发送成功，已标记待重试。"
                )
            else:
                if knowledge_result.get("answered"):
                    message = (
                        f"已先回答{safe_text(candidate_label, 60)}的问题："
                        f"{safe_text(str(knowledge_result.get('answer') or ''), 80)}。"
                        f"随后发送岗位筛选问题：{safe_text(question_text, 80)}。"
                    )
                else:
                    message = (
                        f"已向{safe_text(candidate_label, 60)}发送岗位筛选问题："
                        f"{safe_text(question_text, 80)}。等待对方回复后再继续判断。"
                    )
            result = {
                "message": message,
                "candidate": read_recruiter_selected_candidate(terminal),
                "screening": analysis,
                "sent": send_result,
                "verification": verification,
                "attempts": send_package.get("attempts", []),
                "blocked": blocked,
                "positionScreening": True,
            }
            if knowledge_result.get("answered"):
                result["knowledgeAnswer"] = knowledge_result
            return result

        if analysis.get("status") == "waiting":
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "position_screening_waiting",
                context=context,
                **state_payload,
            )
            return {
                "message": f"已问过岗位筛选问题，候选人还没有给出有效回复：{safe_text(candidate_label, 80)}。本轮跳过等待后续回复。",
                "candidate": read_recruiter_selected_candidate(terminal),
                "screening": analysis,
                "positionScreening": True,
            }

        if analysis.get("status") == "reject":
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "position_screening_rejected",
                context=context,
                **state_payload,
            )
            return {
                "message": (
                    f"候选人不满足{safe_text(str(knowledge_base.get('title') or '当前岗位'), 40)}硬性筛选条件，"
                    "本轮直接跳过，不点击不合适。"
                ),
                "candidate": read_recruiter_selected_candidate(terminal),
                "screening": analysis,
                "positionScreening": True,
                "shouldMarkUnsuitable": False,
            }

        if analysis.get("status") == "accept":
            knowledge_result: dict = {}
            if recent_unanswered_question_messages(context, previous_state) or match_company_knowledge_silent_question(context):
                knowledge_result = self.answer_recruiter_knowledge_question(
                    terminal,
                    context,
                    candidate_label,
                    conversation_key,
                    candidate_state_key,
                    previous_state=previous_state,
                )
                if knowledge_result.get("answered"):
                    terminal.current_page().wait_for_timeout(random.randint(650, 1150))
                elif knowledge_result_stops_flow(knowledge_result):
                    return {
                        **knowledge_result,
                        "candidate": read_recruiter_selected_candidate(terminal),
                        "screening": analysis,
                        "positionScreening": True,
                    }
            resume_result = self.request_resume_from_recruiter_conversation(
                terminal,
                confirmed=False,
                open_unreplied=False,
                target_candidate="",
            )
            resume_skipped = bool(resume_result.get("skipped") and resume_result.get("skipReason") in {"already_requested", "resume_attachment_received"})
            resume_blocked = bool(resume_result.get("blocked"))
            if resume_skipped:
                status = "position_screening_accepted_resume_already_requested"
            elif resume_blocked:
                status = "position_screening_accepted_resume_blocked"
            else:
                status = "position_screening_accepted_resume_requested"
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                status,
                context=context,
                **{
                    **state_payload,
                    "knowledgeAnswered": bool(knowledge_result.get("answered")),
                    "knowledgeAnsweredSignatures": knowledge_result.get("knowledgeAnsweredSignatures", []) if knowledge_result.get("answered") else [],
                    "knowledgeAnswer": safe_text(str(knowledge_result.get("answer") or ""), 80) if knowledge_result.get("answered") else "",
                },
            )
            if knowledge_result.get("answered"):
                message = (
                    f"候选人已满足{safe_text(str(knowledge_base.get('title') or '当前岗位'), 40)}筛选条件，"
                    f"已先回复追问：{safe_text(str(knowledge_result.get('answer') or ''), 80)}；"
                    f"随后继续执行“求简历”：{safe_text(str(resume_result.get('message') or ''), 180)}"
                )
            else:
                message = (
                    f"候选人已满足{safe_text(str(knowledge_base.get('title') or '当前岗位'), 40)}筛选条件，"
                    f"已继续执行“求简历”：{safe_text(str(resume_result.get('message') or ''), 180)}"
                )
            result = {
                "message": message,
                "candidate": read_recruiter_selected_candidate(terminal),
                "screening": analysis,
                "resume": resume_result,
                "blocked": resume_blocked,
                "positionScreening": True,
            }
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
        )
        if knowledge_result_stops_flow(knowledge_result):
            return {
                "message": knowledge_result.get("message") or "已按知识库回复候选人问题。",
                "candidate": read_recruiter_selected_candidate(terminal),
                "screening": analysis,
                "knowledgeAnswer": knowledge_result,
                "positionScreening": True,
            }
        self.set_recruiter_basic_state(
            conversation_key,
            candidate_label,
            "position_screening_unclear",
            context=context,
            **state_payload,
        )
        return {
            "message": f"候选人对岗位筛选问题回复不明确，本轮先跳过：{safe_text(str(analysis.get('latestAnswerText') or ''), 120)}。",
            "candidate": read_recruiter_selected_candidate(terminal),
            "screening": analysis,
            "positionScreening": True,
        }

    @timed_agent_stage("screen_basic_conditions", "基础条件判断")
    def screen_recruiter_basic_conditions(
        self,
        terminal: BrowserTerminal,
        open_unreplied: bool = False,
        target_candidate: str = "",
        max_attempts: int = 5,
    ) -> dict:
        self.check_pause()
        if open_unreplied and not clean_recruiter_candidate_name(target_candidate):
            return self.screen_next_recruiter_basic_conditions(terminal, max_attempts=max_attempts)

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

        history = self.load_chat_history(terminal, max_rounds=CHAT_HISTORY_SCROLL_ROUNDS)
        context = self.read_chat_context(terminal, history=history)
        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = str(candidate.get("label") or "")
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
            return {
                **result,
                "candidate": result.get("candidate") or candidate,
                "opened": opened,
            }
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        if is_unconfigured_recruiter_position(context, position_reply, position_screening):
            screening = {
                "status": "unclear",
                "reason": "position_screening_not_configured",
                "lastOther": context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {},
            }
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "position_screening_unclear",
                context=context,
                lastScreening="position_screening_not_configured",
            )
            return {
                "message": (
                    f"当前岗位暂未配置专属筛选流程，已跳过避免套用AI实习生话术："
                    f"{safe_text(str(context.get('appliedPosition') or '未识别岗位'), 60)}。"
                ),
                "candidate": candidate,
                "opened": opened,
                "screening": screening,
                "skippedUnconfiguredPosition": True,
            }
        if not is_ai_app_basic_conditions_position(context, position_reply):
            screening = {
                "status": "unclear",
                "reason": "common_phrase_restricted_to_ai_intern",
                "lastOther": context.get("lastOtherMessage") if isinstance(context.get("lastOtherMessage"), dict) else {},
            }
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                "position_screening_unclear",
                context=context,
                lastScreening="common_phrase_restricted_to_ai_intern",
            )
            return {
                "message": (
                    "已按规则跳过常用语：常用语/基础条件话术只允许发送给 AI 应用开发相关岗位，"
                    f"当前岗位是 {safe_text(str(context.get('appliedPosition') or '未识别岗位'), 60)}。"
                ),
                "candidate": candidate,
                "opened": opened,
                "screening": screening,
                "skippedCommonPhraseRestricted": True,
            }
        phrase = str(position_reply.get("initialCommonPhrase") or BASIC_CONDITIONS_PHRASE).strip()
        screening = self.measure_current_timing_stage(
            "analyze_basic_conditions",
            "本地基础条件判断",
            lambda: analyze_basic_condition_screening(context.get("messages", []), phrase),
        )
        screening = self.measure_current_timing_stage(
            "apply_basic_waiting_state",
            "套用历史等待状态",
            lambda: apply_basic_waiting_state_to_screening(screening, previous_state, context),
        )
        rule_screening = screening
        screening = self.measure_current_timing_stage(
            "enhance_basic_conditions_model",
            "模型辅助基础条件判断",
            lambda: enhance_basic_condition_screening_with_model(
                context,
                phrase,
                screening,
                previous_state,
            ),
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

        if screening.get("status") == "not_asked":
            send_result, verification = self.send_basic_conditions_with_verification(
                terminal,
                phrase,
                max_attempts=CHAT_SEND_MAX_ATTEMPTS,
            )
            message = (
                f"已先向候选人发送公司/岗位基础情况常用语：{safe_text(candidate_label, 80)}。"
                "等待对方回复后，我会再判断是否继续求简历。"
            )
            if send_result.get("blocked"):
                message = send_result.get("message") or "发送基础条件常用语失败。"
            else:
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
                    message = f"已尝试发送常用语，但聊天记录里没有确认出现基础情况消息；已达到最多 {CHAT_SEND_MAX_ATTEMPTS} 次检测重试，已放回待补发队列，避免漏人。"
                    send_result["blocked"] = True
                    send_result["verification"] = verification
                else:
                    self.set_recruiter_basic_state(
                        conversation_key,
                        candidate_label,
                        "basic_conditions_sent_waiting",
                        context=context,
                        phrase=safe_text(phrase, 240),
                        verifiedAt=time.strftime("%Y-%m-%d %H:%M:%S"),
                    )
            return {
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "screening": screening,
                "sent": send_result,
                "blocked": bool(send_result.get("blocked")),
            }

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
                    context,
                    candidate_label,
                    conversation_key,
                    candidate_state_key,
                    previous_state,
                    accepted_screening,
                    knowledge_result=knowledge_result,
                )
                return {
                    **accepted_result,
                    "candidate": candidate,
                    "opened": opened,
                    "screening": accepted_screening,
                    "knowledgeAnswer": knowledge_result,
                }
            if knowledge_result_stops_flow(knowledge_result):
                return {
                    "message": knowledge_result.get("message") or "已按知识库回复候选人问题。",
                    "candidate": candidate,
                    "opened": opened,
                    "screening": screening,
                    "knowledgeAnswer": knowledge_result,
                }

        if screening.get("status") == "waiting":
            message = (
                f"已检测到之前发过基础条件，但候选人还没有在这之后给出有效回复："
                f"{safe_text(candidate_label, 80)}。本轮暂不求简历。"
            )
            return {
                "message": message,
                "candidate": candidate,
                "opened": opened,
                "screening": screening,
