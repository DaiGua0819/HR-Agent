            '[class*="save" i]',
            '[title*="保存"]',
            '[aria-label*="保存"]',
            'button',
            'a',
            '[role="button"]',
            'i',
            'span',
            'div',
            'img'
          ].join(',');
          for (const el of Array.from(document.querySelectorAll(selector))) {
            if (!visible(el)) continue;
            const box = rect(el);
            const text = normalize([
              el.innerText,
              el.textContent,
              el.getAttribute('aria-label'),
              el.getAttribute('title'),
              el.getAttribute('id'),
              el.getAttribute('src'),
              el.className
            ].filter(Boolean).join(' '));
            const hasSave = /保存|save/i.test(text) || el.id === 'eh_save_popup_action_ref';
            if (!hasSave) continue;
            let score = 0;
            if (el.id === 'sensor_imresume_download') score += 220;
            if (/imresume_download/i.test(el.id || '')) score += 180;
            if (el.id === 'eh_save_popup_action_ref') score += 160;
            if (/^保存$/.test(normalize(el.innerText || el.textContent || ''))) score += 130;
            if (/保存|save/i.test(text)) score += 90;
            if (box.y >= 0 && box.y < 180) score += 40;
            if (box.x > window.innerWidth * 0.55) score += 35;
            if (/(打印|转发|删除|取消|职位待定|合适|不合适|继续聊|邀约)/.test(text) && !/^保存$/.test(normalize(el.innerText || el.textContent || ''))) score -= 80;
            if (score < 70) continue;
            candidates.push({
              score,
              text: text.slice(0, 180),
              tag: el.tagName,
              id: el.id || '',
              className: String(el.className || '').slice(0, 160),
              rect: box,
              element: el
            });
          }
          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0];
          if (!best) return { found: false, reason: 'online_resume_save_button_not_found', candidates: [] };
          best.element.setAttribute('data-codex-job51-online-resume-save', token);
          return {
            found: true,
            token,
            candidate: {
              score: best.score,
              text: best.text,
              tag: best.tag,
              id: best.id,
              className: best.className,
              rect: best.rect
            },
            candidates: candidates.slice(0, 8).map(item => ({
              score: item.score,
              text: item.text,
              tag: item.tag,
              id: item.id,
              className: item.className,
              rect: item.rect
            }))
          };
        }""", {"token": token})
        return info if isinstance(info, dict) else {"found": False, "reason": "online_resume_save_scan_failed"}

    def job51_find_online_resume_save_menu_item(self, page) -> dict:
        token = f"codex_job51_online_resume_save_menu_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
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
          const candidates = Array.from(document.querySelectorAll('.el-dropdown-menu__item,.el-menu-item,[role="menuitem"],button,a,li,div,span'))
            .filter(visible)
            .map(el => {
              const text = normalize([el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.className].filter(Boolean).join(' '));
              const box = rect(el);
              let score = 0;
              if (/^保存$/.test(normalize(el.innerText || el.textContent || ''))) score += 150;
              if (/保存/.test(text)) score += 80;
              if (/(el-dropdown-menu|popper|menu|popover)/i.test(String(el.closest('.el-dropdown-menu,.el-popper,.el-popover,[role="menu"]')?.className || ''))) score += 35;
              if (/(打印|转发|删除|取消|职位待定|合适|不合适|继续聊|邀约)/.test(text) && !/^保存$/.test(normalize(el.innerText || el.textContent || ''))) score -= 100;
              return { score, text: text.slice(0, 160), tag: el.tagName, className: String(el.className || '').slice(0, 140), rect: box, element: el };
            })
            .filter(item => item.score >= 90)
            .sort((a, b) => b.score - a.score);
          const best = candidates[0];
          if (!best) return { found: false, reason: 'online_resume_save_menu_item_not_found', candidates: [] };
          best.element.setAttribute('data-codex-job51-online-resume-save-menu', token);
          return {
            found: true,
            token,
            candidate: { score: best.score, text: best.text, tag: best.tag, className: best.className, rect: best.rect },
            candidates: candidates.slice(0, 6).map(item => ({ score: item.score, text: item.text, tag: item.tag, className: item.className, rect: item.rect }))
          };
        }""", {"token": token})
        return info if isinstance(info, dict) else {"found": False, "reason": "online_resume_save_menu_scan_failed"}

    def job51_find_resume_save_confirm_button(self, page) -> dict:
        token = f"codex_job51_resume_save_confirm_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
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
          const roots = Array.from(document.querySelectorAll('.el-dialog,.el-message-box,.el-popover,.el-drawer,[role="dialog"],body'))
            .filter(visible);
          const candidates = [];
          for (const root of roots) {
            const rootText = normalize(root.innerText || root.textContent || '');
            if (root !== document.body && !/(保存|导出|下载|简历|PDF|pdf|确认|确定)/.test(rootText)) continue;
            for (const el of Array.from(root.querySelectorAll('button,a,[role="button"],.el-button'))) {
              if (!visible(el)) continue;
              const text = normalize([el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.className].filter(Boolean).join(' '));
              let score = 0;
              if (/^(确定|确认)$/.test(normalize(el.innerText || el.textContent || ''))) score += 160;
              if (/(确定|确认|保存|下载)/.test(text)) score += 70;
              if (/(取消|关闭|返回)/.test(text)) score -= 140;
              if (root !== document.body) score += 30;
              if (score < 100) continue;
              candidates.push({ score, text: text.slice(0, 120), tag: el.tagName, className: String(el.className || '').slice(0, 120), rect: rect(el), element: el });
            }
          }
          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0];
          if (!best) return { found: false, reason: 'resume_save_confirm_not_found', candidates: [] };
          best.element.setAttribute('data-codex-job51-resume-save-confirm', token);
          return {
            found: true,
            token,
            candidate: { score: best.score, text: best.text, tag: best.tag, className: best.className, rect: best.rect },
            candidates: candidates.slice(0, 6).map(item => ({ score: item.score, text: item.text, tag: item.tag, className: item.className, rect: item.rect }))
          };
        }""", {"token": token})
        return info if isinstance(info, dict) else {"found": False, "reason": "resume_save_confirm_scan_failed"}

    def job51_trigger_online_resume_pdf_download(self, terminal: BrowserTerminal, detail_page) -> dict:
        save_button = self.job51_find_online_resume_save_button(detail_page)
        if not save_button.get("found"):
            return {"ok": False, "reason": "save_button_not_found", "saveButton": save_button}
        save_locator = detail_page.locator(f"[data-codex-job51-online-resume-save='{save_button.get('token')}']").first
        if not save_locator.count():
            return {"ok": False, "reason": "save_button_element_missing", "saveButton": {k: v for k, v in save_button.items() if k != "token"}}

        direct_download = None
        click_error = ""
        try:
            with detail_page.expect_download(timeout=2500) as download_info:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(save_locator)
                humanized_locator_click(terminal, save_locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
            direct_download = download_info.value
        except Exception as error:
            click_error = safe_text(str(error), 160)

        if direct_download is not None:
            return {
                "ok": True,
                "download": direct_download,
                "downloadMethod": "online_resume_save_pdf_direct",
                "saveButton": {k: v for k, v in save_button.items() if k != "token"},
            }

        detail_page.wait_for_timeout(random.randint(500, 900))
        confirm = self.job51_find_resume_save_confirm_button(detail_page)
        if not confirm.get("found"):
            menu_item = self.job51_find_online_resume_save_menu_item(detail_page)
            if menu_item.get("found"):
                menu_locator = detail_page.locator(f"[data-codex-job51-online-resume-save-menu='{menu_item.get('token')}']").first
                try:
                    if menu_locator.count():
                        if terminal.humanize:
                            terminal.pause_like_person("pre_action")
                            highlight_target(menu_locator)
                        humanized_locator_click(terminal, menu_locator, force=True)
                        if terminal.humanize:
                            terminal.pause_like_person("post_action")
                        detail_page.wait_for_timeout(random.randint(500, 900))
                except Exception as error:
                    click_error = safe_text(str(error), 160)
                confirm = self.job51_find_resume_save_confirm_button(detail_page)

        if not confirm.get("found"):
            return {
                "ok": False,
                "reason": "confirm_button_not_found_after_save_click",
                "saveButton": {k: v for k, v in save_button.items() if k != "token"},
                "confirm": confirm,
                "clickError": click_error,
            }
        confirm_locator = detail_page.locator(f"[data-codex-job51-resume-save-confirm='{confirm.get('token')}']").first
        if not confirm_locator.count():
            return {
                "ok": False,
                "reason": "confirm_button_element_missing",
                "saveButton": {k: v for k, v in save_button.items() if k != "token"},
                "confirm": {k: v for k, v in confirm.items() if k != "token"},
            }
        try:
            with detail_page.expect_download(timeout=20000) as download_info:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(confirm_locator)
                humanized_locator_click(terminal, confirm_locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
            download = download_info.value
            return {
                "ok": True,
                "download": download,
                "downloadMethod": "online_resume_save_pdf_confirm",
                "saveButton": {k: v for k, v in save_button.items() if k != "token"},
                "confirm": {k: v for k, v in confirm.items() if k != "token"},
            }
        except Exception as error:
            return {
                "ok": False,
                "reason": "download_not_triggered_after_confirm",
                "error": safe_text(str(error), 180),
                "saveButton": {k: v for k, v in save_button.items() if k != "token"},
                "confirm": {k: v for k, v in confirm.items() if k != "token"},
            }

    def job51_visible_resume_text_from_chat(self, terminal: BrowserTerminal, context: dict | None = None) -> dict:
        page = terminal.current_page()
        context = context if isinstance(context, dict) else {}
        attachment_scan = self.job51_find_resume_attachment(terminal)
        dom_scan = safe_eval(page, r"""() => {
          const normalize = value => String(value || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
          const compact = value => String(value || '').replace(/\s+/g, '');
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8
              && box.bottom >= 0
              && box.right >= 0
              && box.top <= window.innerHeight
              && box.left <= window.innerWidth
              && style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0';
          };
          const rows = Array.from(document.querySelectorAll([
            '#IMMessageList div.message-item.others',
            '[id*="IMMessageList"] div.message-item.others',
            'div.message-item.others',
            'div.im-message-item.others',
            '.im-message-item.others',
            '[class*="message-item" i]'
          ].join(','))).filter(visible);
          const candidates = [];
          const resumeSelector = [
            '.resume-element',
            '.item-container-resume',
            '.resume-card',
            '[class*="resume" i]',
            '[class*="jianli" i]',
            '[class*="file-style" i]',
            '[class*="attach" i]'
          ].join(',');
          const markerPattern = /(在线简历|附件简历|简历附件|求职意向|工作经历|教育经历|项目经历|个人优势|自我评价|期望职位|期望薪资|学历|专业|学校|公司|年龄|岁)/;
          for (const row of rows) {
            const text = normalize(row.innerText || row.textContent || '');
            const dense = compact(text);
            if (!text || !markerPattern.test(text)) continue;
            const resumeNode = row.querySelector(resumeSelector);
            let score = text.length;
            if (resumeNode) score += 120;
            if (/在线简历|附件简历|简历附件/.test(text)) score += 80;
            if (/(求职意向|工作经历|教育经历|项目经历|个人优势)/.test(text)) score += 120;
            if (/(人才管理|人才望远镜|职位管理|全部岗位|批量|主动联系)/.test(dense)) score -= 220;
            candidates.push({
              score,
              text: text.slice(0, 9000),
              className: String(row.className || '').slice(0, 160)
            });
          }
          candidates.sort((a, b) => b.score - a.score);
          return { candidates: candidates.slice(0, 8) };
        }""") or {}
        text_candidates: list[dict] = []
        if isinstance(attachment_scan, dict) and attachment_scan.get("found"):
            attachment_candidate = attachment_scan.get("candidate") if isinstance(attachment_scan.get("candidate"), dict) else {}
            for key in ("rootText", "text"):
                value = safe_text(str(attachment_candidate.get(key) or ""), 6000)
                if value:
                    text_candidates.append({
                        "source": f"attachment_scan.{key}",
                        "text": value,
                        "score": len(value) + (120 if "在线简历" in value else 0),
                        "attachment": attachment_candidate,
                    })
        for item in (dom_scan.get("candidates") if isinstance(dom_scan, dict) and isinstance(dom_scan.get("candidates"), list) else []):
            if not isinstance(item, dict):
                continue
            value = safe_text(str(item.get("text") or ""), 9000)
            if value:
                text_candidates.append({
                    "source": "visible_message_dom",
                    "text": value,
                    "score": int(item.get("score") or 0),
                    "dom": {k: v for k, v in item.items() if k != "text"},
                })
        for message in (context.get("messages") if isinstance(context.get("messages"), list) else [])[-20:]:
            if not isinstance(message, dict):
                continue
            if str(message.get("sender") or "") != "other":
                value_preview = str(message.get("rawText") or message.get("text") or "")
                if not re.search(r"(在线简历|附件简历|简历附件)", value_preview):
                    continue
            value = safe_text(str(message.get("rawText") or message.get("text") or ""), 3000)
            if value and re.search(r"(在线简历|附件简历|简历附件|求职意向|工作经历|教育经历|项目经历|个人优势)", value):
                text_candidates.append({
                    "source": "chat_context_message",
                    "text": value,
                    "score": len(value) + 40,
                })
        seen: set[str] = set()
        usable: list[dict] = []
        marker_pattern = re.compile(r"(求职意向|工作经历|教育经历|项目经历|个人优势|自我评价|期望职位|期望薪资|学历|专业|学校|公司|年龄|岁|在线简历)")
        for item in sorted(text_candidates, key=lambda row: int(row.get("score") or 0), reverse=True):
            text = str(item.get("text") or "").strip()
            normalized = re.sub(r"\s+", "", text)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            marker_count = len(set(marker_pattern.findall(text)))
            has_online_resume = bool(re.search(r"(在线简历|附件简历|简历附件)", text))
            has_resume_section = bool(re.search(r"(求职意向|工作经历|教育经历|项目经历|个人优势|自我评价|学历|专业|学校|公司|本科|硕士|博士|大专)", text))
            enough_text = (
                len(normalized) >= 120
                or (len(normalized) >= 55 and marker_count >= 2)
                or (has_online_resume and has_resume_section and len(normalized) >= 28)
                or (has_online_resume and len(normalized) >= 45)
            )
            if not enough_text:
                continue
            usable.append({**item, "text": text, "markerCount": marker_count, "length": len(normalized)})
        best = usable[0] if usable else {}
        return {
            "found": bool(best),
            "reason": "" if best else "visible_online_resume_text_not_enough",
            "text": safe_text(str(best.get("text") or ""), 9000) if best else "",
            "source": safe_text(str(best.get("source") or ""), 80) if best else "",
            "best": {k: v for k, v in best.items() if k != "text"},
            "attachmentScan": {k: v for k, v in attachment_scan.items() if k != "token"} if isinstance(attachment_scan, dict) else {},
            "domScan": {
                "candidateCount": len(dom_scan.get("candidates") or []) if isinstance(dom_scan, dict) else 0,
                "candidates": [
                    {**{k: v for k, v in item.items() if k != "text"}, "textPreview": safe_text(str(item.get("text") or ""), 240)}
                    for item in ((dom_scan.get("candidates") if isinstance(dom_scan, dict) else []) or [])[:4]
                    if isinstance(item, dict)
                ],
            },
        }

    def job51_save_resume_content_from_chat(
        self,
        context: dict,
        candidate_name: str,
        applied_position: str,
        content: bytes | bytearray,
        download_method: str,
        original_filename: str = "",
        source: str = "51job-visible-online-resume",
        attachment: dict | None = None,
        suitability_guard: dict | None = None,
    ) -> dict:
        if not isinstance(content, (bytes, bytearray)) or not content:
            return {"ok": False, "blocked": True, "reason": "empty_visible_resume_content", "message": "51job 当前聊天简历内容为空，未保存。"}
        target_path = make_job51_resume_target_path(
            candidate_name=candidate_name,
            applied_position=applied_position,
            original_filename=original_filename,
            fallback_text=f"{candidate_name}_{applied_position}.pdf",
        )
        file_hash = job51_resume_content_hash(content)
        pre_hash_guard = job51_resume_hash_guard(file_hash, candidate_name, applied_position) if file_hash else {}
        if pre_hash_guard.get("conflict"):
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_visible_resume_hash_conflict_before_save",
                "message": "51job 当前聊天简历内容与其他候选人已保存简历完全一致，已停止保存，避免串人入库。",
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "fileHash": file_hash,
                "hashGuard": pre_hash_guard,
                "attachment": attachment or {},
            }
        if pre_hash_guard.get("alreadyDownloaded"):
            existing = (pre_hash_guard.get("sameCandidate") or [{}])[0]
            memory_update = self.job51_mark_resume_downloaded(context, {
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "filePath": existing.get("filePath") or "",
                "filename": existing.get("filename") or "",
                "fileHash": file_hash,
                "fileSize": existing.get("fileSize") or 0,
                "downloadMethod": f"existing_hash_match_before_{download_method}",
            })
            return {
                "ok": True,
                "downloaded": True,
                "skipped": True,
                "skipReason": "already_downloaded_same_hash",
                "alreadyDownloaded": True,
                "platform": "51job",
                "accountId": AGENT_ACCOUNT_ID,
                "accountName": AGENT_ACCOUNT_NAME,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "filePath": existing.get("filePath") or "",
                "filename": existing.get("filename") or "",
                "fileHash": file_hash,
                "fileSize": existing.get("fileSize") or 0,
                "folder": str(Path(str(existing.get("filePath") or "")).parent) if existing.get("filePath") else "",
                "memory": memory_update,
                "downloadMethod": f"existing_hash_match_before_{download_method}",
                "attachment": attachment or {},
                "message": f"51job 已存在相同哈希的该候选人简历，跳过重复保存：{safe_text(str(existing.get('filename') or candidate_name), 100)}",
            }
        target_path.write_bytes(bytes(content))
        file_hash = file_hash or job51_resume_file_hash(target_path)
        try:
            file_size = target_path.stat().st_size
        except Exception:
            file_size = len(content)
        hash_guard = job51_resume_hash_guard(file_hash, candidate_name, applied_position, ignore_path=target_path) if file_hash else {}
        if hash_guard.get("conflict"):
            try:
                target_path.unlink()
            except Exception:
                pass
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_visible_resume_hash_conflict_after_save",
                "message": "51job 当前聊天简历内容与其他候选人已保存简历完全一致，已删除本次文件，避免串人入库。",
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "fileHash": file_hash,
                "hashGuard": hash_guard,
                "attachment": attachment or {},
            }
        result = {
            "ok": True,
            "downloaded": True,
            "platform": "51job",
            "accountId": AGENT_ACCOUNT_ID,
            "accountName": AGENT_ACCOUNT_NAME,
            "candidateName": candidate_name,
            "appliedPosition": applied_position,
            "filePath": str(target_path),
            "filename": target_path.name,
            "fileHash": file_hash,
            "fileSize": file_size,
            "folder": str(target_path.parent),
            "source": source,
            "attachment": attachment or {},
            "onlineResume": attachment or {},
            "downloadMethod": download_method,
            "hashGuard": hash_guard,
            "suitabilityGuard": suitability_guard or {},
            "message": f"51job 当前聊天在线简历已安全保存：{target_path.name}",
        }
        result["memory"] = self.job51_mark_resume_downloaded(context, result)
        return result

    def job51_save_hexinhong_visible_online_resume_from_chat(
        self,
        terminal: BrowserTerminal,
        context: dict,
        candidate_name: str,
        applied_position: str,
        suitability_guard: dict | None = None,
    ) -> dict:
        page = terminal.current_page()
        attachment_scan = self.job51_find_resume_attachment(terminal)
        attachment_candidate = attachment_scan.get("candidate") if isinstance(attachment_scan.get("candidate"), dict) else {}
        href = str(attachment_candidate.get("href") or "").strip()
        if href and not href.startswith(("blob:", "javascript:", "#")):
            href_download = self.job51_fetch_attachment_href(page, href, str(attachment_candidate.get("download") or attachment_candidate.get("text") or ""))
            if href_download.get("ok") and href_download.get("bytes"):
                return self.job51_save_resume_content_from_chat(
                    context,
                    candidate_name,
                    applied_position,
                    href_download.get("bytes"),
                    "hexinhong_visible_attachment_href",
                    original_filename=str(href_download.get("filename") or ""),
                    source="51job-visible-attachment-href",
                    attachment={"scan": {k: v for k, v in attachment_scan.items() if k != "token"}, "hrefDownload": {k: v for k, v in href_download.items() if k != "bytes"}},
                    suitability_guard=suitability_guard,
                )
        visible_text = self.job51_visible_resume_text_from_chat(terminal, context)
        if not visible_text.get("found"):
            return {
                "ok": False,
                "blocked": False,
                "reason": visible_text.get("reason") or "visible_online_resume_text_not_found",
                "message": f"51job 和新红当前聊天没有足够可归档的在线简历文本：{safe_text(candidate_name, 60)}",
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "visibleResume": visible_text,
                "attachmentScan": {k: v for k, v in attachment_scan.items() if k != "token"} if isinstance(attachment_scan, dict) else {},
            }
        pdf_bytes = job51_build_visible_resume_text_pdf(
            candidate_name=candidate_name,
            applied_position=applied_position,
            resume_text=str(visible_text.get("text") or ""),
            source_label=f"51job 当前聊天在线简历/{visible_text.get('source') or 'visible_dom'}",
        )
        if not pdf_bytes.startswith(b"%PDF-"):
            return {
                "ok": False,
                "blocked": True,
                "reason": "visible_online_resume_pdf_build_failed",
                "message": "51job 当前聊天在线简历 PDF 构建失败，已停止保存。",
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "visibleResume": visible_text,
            }
        return self.job51_save_resume_content_from_chat(
            context,
            candidate_name,
            applied_position,
            pdf_bytes,
            "hexinhong_visible_online_resume_text_pdf",
            original_filename=f"{candidate_name}_{applied_position}.pdf",
            source="51job-visible-online-resume-text",
            attachment=visible_text,
            suitability_guard=suitability_guard,
        )

    @timed_agent_stage("job51_download_resume_attachment", "51job保存在线简历PDF")
    def job51_download_resume_attachment(
        self,
        terminal: BrowserTerminal,
        accepted_by_flow: dict | None = None,
    ) -> dict:
        page = terminal.current_page()
        self.job51_dismiss_interruptions(terminal, reason="before_save_online_resume_pdf")
        if not self.job51_wait_chat_ready(terminal, timeout_ms=3500):
            return {
                "ok": False,
                "blocked": True,
                "message": "51job 当前不是单聊聊天页，未保存在线简历 PDF。",
                "url": safe_text(str(getattr(page, "url", "") or ""), 240),
            }

        context = self.job51_read_chat_context(terminal)
        applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_name = safe_text(str(applicant.get("name") or recruiter_candidate_name_from_label(str(applicant.get("label") or "")) or "未知候选人"), 60)
        accepted_screening = accepted_by_flow.get("screening") if isinstance(accepted_by_flow, dict) and isinstance(accepted_by_flow.get("screening"), dict) else {}
        applied_position = clean_applied_position(str(
            applicant.get("appliedPosition")
            or context.get("appliedPosition")
            or accepted_screening.get("jobType")
            or "未知岗位"
        ))
        identity_guard = self.job51_validate_resume_download_context(context, candidate_name, applied_position)
        if not identity_guard.get("ok"):
            return {
                "ok": False,
                "blocked": True,
                "message": identity_guard.get("message") or "51job 当前会话身份校验未通过，已停止下载附件简历。",
                "candidate": applicant,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "identityGuard": identity_guard,
            }
        candidate_state_key = recruiter_basic_candidate_state_key(str(applicant.get("label") or applicant.get("name") or ""))
        previous_state = self.get_chat_state(str(context.get("conversationKey") or "")) or self.get_chat_state(candidate_state_key)
        suitability_guard = self.job51_resume_download_suitability_guard(
            terminal,
            context,
            previous_state=previous_state,
            accepted_by_flow=accepted_by_flow,
        )
        if not suitability_guard.get("allowed"):
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_resume_download_requires_suitable_candidate",
                "message": suitability_guard.get("message") or "51job 当前候选人还没有判断为合适，不能下载简历。",
                "candidate": applicant,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "suitabilityGuard": suitability_guard,
            }
        remembered = self.job51_find_downloaded_resume_memory(context, candidate_name, applied_position)
        if remembered:
            close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=page)
            memory_update = {}
            if remembered.get("source") == "job51_resume_folder_match":
                memory_update = self.job51_mark_resume_downloaded(context, {
                    "candidateName": candidate_name,
                    "appliedPosition": applied_position,
                    "filePath": remembered.get("filePath") or "",
                    "filename": remembered.get("filename") or "",
                    "fileHash": remembered.get("fileHash") or "",
                    "fileSize": remembered.get("fileSize") or 0,
                    "downloadMethod": "existing_file_match",
                })
            return {
                "ok": True,
                "downloaded": True,
                "skipped": True,
                "skipReason": "already_downloaded",
                "alreadyDownloaded": True,
                "platform": "51job",
                "accountId": AGENT_ACCOUNT_ID,
                "accountName": AGENT_ACCOUNT_NAME,
                "candidate": applicant,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "filePath": remembered.get("filePath") or "",
                "filename": remembered.get("filename") or "",
                "fileHash": remembered.get("fileHash") or "",
                "fileSize": remembered.get("fileSize") or 0,
                "folder": str(Path(str(remembered.get("filePath") or "")).parent) if remembered.get("filePath") else "",
                "memory": remembered,
                "memoryUpdate": memory_update,
                "closeResult": close_result,
                "message": f"51job 已记忆该候选人简历下载记录，跳过重复下载：{safe_text(str(remembered.get('filename') or candidate_name), 100)}",
            }

        if self.job51_is_hexinhong_runtime():
            visible_resume_result = self.job51_save_hexinhong_visible_online_resume_from_chat(
                terminal,
                context,
                candidate_name,
                applied_position,
                suitability_guard=suitability_guard,
            )
            if visible_resume_result.get("ok") and visible_resume_result.get("downloaded"):
                return visible_resume_result
            if visible_resume_result.get("blocked"):
                return {
                    **visible_resume_result,
                    "candidate": applicant,
                    "suitabilityGuard": suitability_guard,
                }
            return {
                "ok": False,
                "blocked": True,
                "reason": "online_resume_detail_open_disabled_to_prevent_talent_management",
                "message": (
                    "51job 和新红已禁止点击在线简历详情以避免打开人才管理页；"
                    f"当前聊天未能安全保存可见在线简历，将回退求简历：{safe_text(candidate_name, 60)}"
                ),
                "candidate": applicant,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "suitabilityGuard": suitability_guard,
                "visibleResumeResult": visible_resume_result,
            }

        if self.job51_is_online_resume_detail_page(page):
            online_resume = {
                "found": True,
                "candidate": {"text": "online_resume_detail_already_open", "tag": "PAGE", "className": "", "rect": {}},
                "candidates": [],
            }
            opened = {
                "ok": True,
                "page": page,
                "originPage": page,
                "openedBy": "already_open",
                "url": safe_text(str(getattr(page, "url", "") or ""), 240),
                "title": safe_text(page.title(), 100),
                "entry": online_resume,
            }
        else:
            online_resume = self.job51_find_online_resume_entry(terminal)
            if not online_resume.get("found"):
                return {
                    "ok": False,
                    "blocked": True,
                    "reason": "online_resume_entry_not_found",
                    "message": f"51job 当前会话未找到在线简历入口，未保存 PDF：{safe_text(candidate_name, 60)}",
                    "candidate": applicant,
                    "scan": online_resume,
                    "suitabilityGuard": suitability_guard,
                }

            opened = self.job51_open_online_resume_detail(terminal, online_resume)
            if not opened.get("ok"):
                return {
                    "ok": False,
                    "blocked": True,
                    "reason": "online_resume_detail_open_failed",
                    "message": "51job 找到了在线简历入口，但未能打开在线简历详情页。",
                    "candidate": applicant,
                    "scan": online_resume,
                    "openResult": {k: v for k, v in opened.items() if k not in {"page", "originPage"}},
                    "suitabilityGuard": suitability_guard,
                }

        detail_page = opened.get("page")
        origin_page = opened.get("originPage") or page
        trigger = self.job51_trigger_online_resume_pdf_download(terminal, detail_page)
        if not trigger.get("ok"):
            terminal.page = origin_page
            close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
            return {
                "ok": False,
                "blocked": True,
                "reason": "online_resume_pdf_save_failed",
                "message": f"51job 在线简历保存 PDF 未触发下载：{safe_text(candidate_name, 60)}",
                "candidate": applicant,
                "scan": online_resume,
                "openResult": {k: v for k, v in opened.items() if k not in {"page", "originPage"}},
                "saveResult": trigger,
                "closeResult": close_result,
                "suitabilityGuard": suitability_guard,
            }
        download = trigger.get("download")
        failure = ""
        try:
            failure = download.failure() or ""
        except Exception:
            failure = ""
        if failure:
            terminal.page = origin_page
            close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
            return {
                "ok": False,
                "blocked": True,
                "reason": "online_resume_pdf_download_failed",
                "message": f"51job 在线简历 PDF 下载失败：{safe_text(failure, 160)}",
                "candidate": applicant,
                "scan": online_resume,
                "saveResult": {k: v for k, v in trigger.items() if k != "download"},
                "closeResult": close_result,
                "suitabilityGuard": suitability_guard,
            }
        downloaded = {
            "kind": trigger.get("downloadMethod") or "online_resume_save_pdf",
            "download": download,
            "filename": download.suggested_filename or f"{candidate_name}_{applied_position}.pdf",
            "saveResult": {k: v for k, v in trigger.items() if k != "download"},
        }

        target_path = make_job51_resume_target_path(
            candidate_name=candidate_name,
            applied_position=applied_position,
            original_filename=str(downloaded.get("filename") or ""),
            fallback_text=f"{candidate_name}_{applied_position}.pdf",
        )
        file_hash = ""
        file_size = 0
        if "download" in downloaded:
            downloaded["download"].save_as(str(target_path))
            try:
                content = target_path.read_bytes()
            except Exception:
                content = b""
            if not content.startswith(b"%PDF-"):
                try:
                    target_path.unlink()
                except Exception:
                    pass
                terminal.page = origin_page
                close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
                return {
                    "ok": False,
                    "blocked": True,
                    "reason": "job51_online_resume_saved_file_not_pdf",
                    "message": "51job 在线简历保存后不是有效 PDF，已删除本次文件并停止入库。",
                    "candidate": applicant,
                    "candidateName": candidate_name,
                    "appliedPosition": applied_position,
                    "filename": target_path.name,
                    "fileSize": len(content),
                    "scan": online_resume,
                    "saveResult": downloaded.get("saveResult") or {},
                    "closeResult": close_result,
                    "suitabilityGuard": suitability_guard,
                }
        else:
            content = downloaded.get("bytes")
            if not isinstance(content, (bytes, bytearray)) or not content:
                return {
                    "ok": False,
                    "blocked": True,
                    "message": "51job 在线简历下载响应为空，未保存。",
                    "candidate": applicant,
                    "scan": online_resume,
                }
            file_hash = job51_resume_content_hash(content)
            pre_hash_guard = job51_resume_hash_guard(file_hash, candidate_name, applied_position) if file_hash else {}
            if pre_hash_guard.get("conflict"):
                terminal.page = origin_page
                close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
                return {
                    "ok": False,
                    "blocked": True,
                    "reason": "job51_resume_hash_conflict_before_save",
                    "message": "51job 在线简历内容与其他候选人已保存简历完全一致，已停止保存，避免串人入库。",
                    "candidate": applicant,
                    "candidateName": candidate_name,
                    "appliedPosition": applied_position,
                    "fileHash": file_hash,
                    "hashGuard": pre_hash_guard,
                    "scan": online_resume,
                    "closeResult": close_result,
                }
            if pre_hash_guard.get("alreadyDownloaded"):
                existing = (pre_hash_guard.get("sameCandidate") or [{}])[0]
                terminal.page = origin_page
                close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
                memory_update = self.job51_mark_resume_downloaded(context, {
                    "candidateName": candidate_name,
                    "appliedPosition": applied_position,
                    "filePath": existing.get("filePath") or "",
                    "filename": existing.get("filename") or "",
                    "fileHash": file_hash,
                    "fileSize": existing.get("fileSize") or 0,
                    "downloadMethod": f"existing_hash_match_before_{downloaded.get('kind') or 'download'}",
                })
                return {
                    "ok": True,
                    "downloaded": True,
                    "skipped": True,
                    "skipReason": "already_downloaded_same_hash",
                    "alreadyDownloaded": True,
                    "platform": "51job",
                    "accountId": AGENT_ACCOUNT_ID,
                    "accountName": AGENT_ACCOUNT_NAME,
                    "candidate": applicant,
                    "candidateName": candidate_name,
                    "appliedPosition": applied_position,
                    "filePath": existing.get("filePath") or "",
                    "filename": existing.get("filename") or "",
                    "fileHash": file_hash,
                    "fileSize": existing.get("fileSize") or 0,
                    "folder": str(Path(str(existing.get("filePath") or "")).parent) if existing.get("filePath") else "",
                    "memory": memory_update,
                    "closeResult": close_result,
                    "message": f"51job 已存在相同哈希的该候选人简历，跳过重复保存：{safe_text(str(existing.get('filename') or candidate_name), 100)}",
                }
            target_path.write_bytes(bytes(content))
        file_hash = file_hash or job51_resume_file_hash(target_path)
        try:
            file_size = target_path.stat().st_size
        except Exception:
            file_size = 0
        hash_guard = job51_resume_hash_guard(file_hash, candidate_name, applied_position, ignore_path=target_path) if file_hash else {}
        if hash_guard.get("conflict"):
            try:
                target_path.unlink()
            except Exception:
                pass
            terminal.page = origin_page
            close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
            return {
                "ok": False,
                "blocked": True,
                "reason": "job51_resume_hash_conflict_after_save",
                "message": "51job 在线简历 PDF 与其他候选人已保存简历完全一致，已删除本次文件并停止入库，避免串人保存。",
                "candidate": applicant,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "fileHash": file_hash,
                "hashGuard": hash_guard,
                "scan": online_resume,
                "closeResult": close_result,
            }
        if hash_guard.get("alreadyDownloaded"):
            existing = (hash_guard.get("sameCandidate") or [{}])[0]
            try:
                target_path.unlink()
            except Exception:
                pass
            terminal.page = origin_page
            close_result = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
            memory_update = self.job51_mark_resume_downloaded(context, {
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "filePath": existing.get("filePath") or "",
                "filename": existing.get("filename") or "",
                "fileHash": file_hash,
                "fileSize": existing.get("fileSize") or 0,
                "downloadMethod": f"existing_hash_match_after_{downloaded.get('kind') or 'download'}",
            })
            return {
                "ok": True,
                "downloaded": True,
                "skipped": True,
                "skipReason": "already_downloaded_same_hash",
                "alreadyDownloaded": True,
                "platform": "51job",
                "accountId": AGENT_ACCOUNT_ID,
                "accountName": AGENT_ACCOUNT_NAME,
                "candidate": applicant,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "filePath": existing.get("filePath") or "",
                "filename": existing.get("filename") or "",
                "fileHash": file_hash,
                "fileSize": existing.get("fileSize") or 0,
                "folder": str(Path(str(existing.get("filePath") or "")).parent) if existing.get("filePath") else "",
                "memory": memory_update,
                "closeResult": close_result,
                "message": f"51job 已存在相同哈希的该候选人简历，已删除重复文件：{safe_text(str(existing.get('filename') or candidate_name), 100)}",
            }

        result = {
            "ok": True,
            "downloaded": True,
            "platform": "51job",
            "accountId": AGENT_ACCOUNT_ID,
            "accountName": AGENT_ACCOUNT_NAME,
            "candidate": applicant,
            "candidateName": candidate_name,
            "appliedPosition": applied_position,
            "filePath": str(target_path),
            "filename": target_path.name,
            "fileHash": file_hash,
            "fileSize": file_size,
            "folder": str(target_path.parent),
            "source": "51job-attachment",
            "attachment": {k: v for k, v in online_resume.items() if k != "token"},
            "onlineResume": {k: v for k, v in online_resume.items() if k != "token"},
            "openResult": {k: v for k, v in opened.items() if k not in {"page", "originPage"}},
            "saveResult": downloaded.get("saveResult") or {},
            "downloadMethod": downloaded.get("kind"),
            "hashGuard": hash_guard,
            "suitabilityGuard": suitability_guard,
            "message": f"51job 在线简历 PDF 已保存：{target_path.name}",
        }
        result["memory"] = self.job51_mark_resume_downloaded(context, result)
        terminal.page = origin_page
        result["closeResult"] = self.job51_close_resume_download_surfaces(terminal, origin_page=origin_page)
        return result

    @timed_agent_stage("job51_download_or_request_resume", "51job 下载或索要简历")
    def job51_download_attachment_or_request_resume(
        self,
        terminal: BrowserTerminal,
        accepted_by_flow: dict | None = None,
    ) -> dict:
        download_result = self.job51_download_resume_attachment(terminal, accepted_by_flow=accepted_by_flow)
        if download_result.get("ok") and download_result.get("downloaded"):
            return {
                "action": "save_online_resume_pdf",
                "message": download_result.get("message") or "51job 在线简历 PDF 已保存",
                "download": download_result,
                "resume": download_result,
                "blocked": False,
                "downloaded": True,
            }
        if download_result.get("reason") == "job51_resume_download_requires_suitable_candidate":
            return {
                "action": "blocked_requires_suitable_candidate",
                "message": download_result.get("message") or "51job 当前候选人还没有判断为合适，不能下载或索要简历",
                "download": download_result,
                "resume": download_result,
                "blocked": True,
                "downloaded": False,
            }
        fallback_to_request_reasons = {
            "online_resume_detail_open_disabled_to_prevent_talent_management",
            "online_resume_detail_open_failed",
            "online_resume_pdf_save_failed",
            "online_resume_pdf_download_failed",
            "job51_online_resume_saved_file_not_pdf",
        }
        if download_result.get("blocked") and download_result.get("reason") not in {"online_resume_entry_not_found", *fallback_to_request_reasons}:
            return {
                "action": "save_online_resume_pdf_blocked",
                "message": download_result.get("message") or "51job 在线简历 PDF 保存失败，已停止，避免误求简历",
                "download": download_result,
                "resume": download_result,
                "blocked": True,
                "downloaded": False,
            }
        if download_result.get("reason") in fallback_to_request_reasons:
            self.job51_close_resume_download_surfaces(terminal)
        request_result = self.job51_request_resume_from_current_conversation(terminal)
        screening = accepted_by_flow.get("screening") if isinstance(accepted_by_flow, dict) and isinstance(accepted_by_flow.get("screening"), dict) else {}
        is_direct_resume_flow = bool(screening.get("directResume"))
        if request_result.get("blocked") and is_direct_resume_flow:
            context = self.job51_read_chat_context(terminal)
            position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
            resume_job_type = direct_resume_operations_job_type(context, position_reply) or normalize_direct_resume_operations_job_type(str(screening.get("jobType") or ""))
            prompt = direct_resume_request_prompt_from_context(context, position_reply, resume_job_type)
            candidate = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
            candidate_label = str(candidate.get("label") or candidate.get("name") or "")
            if prompt:
                prompt_result = self.prepare_direct_resume_request_prompt(
                    terminal,
                    candidate_label,
                    resume_job_type,
                    "51job",
                    prompt,
                    context=context,
                )
                prompt_ok = bool(
                    isinstance(prompt_result, dict)
                    and not prompt_result.get("blocked")
                    and (prompt_result.get("sent") or prompt_result.get("alreadySent"))
                )
                if prompt_ok:
                    return {
                        "action": "request_resume_prompt",
                        "message": (
                            "51job 当前会话没有可用求简历按钮，已按直求简历兜底发送求简历话术："
                            f"{safe_text(prompt, 80)}"
                        ),
                        "download": download_result,
                        "request": request_result,
                        "prompt": prompt_result,
                        "resume": prompt_result,
                        "blocked": False,
                        "downloaded": False,
                        "requested": True,
                    }
                if isinstance(prompt_result, dict) and prompt_result.get("blocked"):
                    return {
                        "action": "request_resume_prompt_blocked",
                        "message": prompt_result.get("message") or "51job 求简历按钮不可用，兜底求简历话术发送失败",
                        "download": download_result,
                        "request": request_result,
                        "prompt": prompt_result,
                        "resume": prompt_result,
                        "blocked": True,
                        "downloaded": False,
                    }
        return {
            "action": "request_resume",
            "message": request_result.get("message") or "51job 未找到在线简历入口，已尝试求简历",
            "download": download_result,
            "request": request_result,
            "resume": request_result,
            "blocked": bool(request_result.get("blocked")),
            "downloaded": False,
        }

    def recruiter_resume_download_memory_keys(
        self,
        platform: str,
        context: dict | None,
        candidate_name: str = "",
        applied_position: str = "",
    ) -> list[str]:
        context = context if isinstance(context, dict) else {}
        applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        label = safe_text(str(applicant.get("label") or context.get("candidateLabel") or ""), 180)
        conversation_key = safe_text(str(context.get("conversationKey") or ""), 160)
        raw_keys = [
            f"{platform}|{conversation_key}",
            f"{platform}|{compact_conversation_label(label)}",
            f"{platform}|{safe_text(candidate_name, 60)}|{clean_applied_position(applied_position)}",
        ]
        keys: list[str] = []
        for raw in raw_keys:
            raw = str(raw or "").strip()
            if not raw or raw.endswith("|") or raw.endswith("||"):
                continue
            key = "recruiter_resume_download|" + stable_digest(raw, 24)
            if key not in keys:
                keys.append(key)
        return keys

    def recruiter_find_downloaded_resume_memory(
        self,
        platform: str,
        context: dict | None,
        candidate_name: str = "",
        applied_position: str = "",
    ) -> dict:
        index = load_json(RECRUITER_RESUME_DOWNLOADS_FILE, {})
        if not isinstance(index, dict):
            index = {}
        for key in self.recruiter_resume_download_memory_keys(platform, context, candidate_name, applied_position):
            item = index.get(key)
            if not isinstance(item, dict):
                continue
            file_path = Path(str(item.get("filePath") or ""))
            if file_path.exists() and file_path.is_file():
                return {**item, "memoryKey": key, "source": "recruiter_resume_download_index"}
        return {}

    def recruiter_mark_resume_downloaded(
        self,
        platform: str,
        context: dict | None,
        result: dict,
    ) -> dict:
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
            "platform": platform,
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
        index = load_json(RECRUITER_RESUME_DOWNLOADS_FILE, {})
        if not isinstance(index, dict):
            index = {}
        keys = self.recruiter_resume_download_memory_keys(platform, context, candidate_name, applied_position)
        for key in keys:
            index[key] = item
        save_json(RECRUITER_RESUME_DOWNLOADS_FILE, index)
        file_item = {
            "id": f"resume_{platform}_{int(time.time() * 1000)}",
            "name": item["filename"],
            "path": item["filePath"],
            "size": file_size,
            "time": item["downloadedAt"],
            "source": f"{platform}_resume_download",
            "candidateName": candidate_name,
            "appliedPosition": applied_position,
        }
        if item["filePath"]:
            self.files.append(file_item)
            save_json(FILE_REGISTRY, self.files[-200:])
        self.set_recruiter_basic_state(
            conversation_key,
            candidate_label or candidate_name,
            f"{platform}_resume_downloaded",
            context=context,
            platform=platform,
            resumeDownloaded=True,
            resumeFilePath=item["filePath"],
            resumeFilename=item["filename"],
            resumeDownloadMethod=item["downloadMethod"],
        )
        return {"keys": keys, "item": item}

    def recruiter_close_resume_download_surfaces(self, terminal: BrowserTerminal, origin_page=None, platform: str = "") -> dict:
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
            if re.search(r"(resume|jianli|preview|download|pdf|doc|简历|预览)", haystack, flags=re.I):
                try:
                    page.close()
                    closed_pages.append({"url": safe_text(url, 180), "title": safe_text(title, 80)})
                except Exception:
                    pass
        try:
            origin_page.bring_to_front()
            terminal.page = origin_page
        except Exception:
            pass
        clicked = safe_eval(origin_page, r"""() => {
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4
              && box.bottom > 0 && box.right > 0
              && box.x < window.innerWidth && box.y < window.innerHeight
              && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const roots = Array.from(document.querySelectorAll([
            '.dialog', '.modal', '.popup', '.popover', '.boss-popup',
            '.km-modal', '.km-dialog', '.el-dialog', '.preview',
            '[role="dialog"]', '[class*="resume" i]', '[class*="preview" i]'
          ].join(','))).filter(root => {
            if (!visible(root)) return false;
            const text = normalize(root.innerText || root.textContent || '');
            const cls = String(root.className || '');
            return /(简历|附件|预览|下载|resume|cv|pdf)/i.test(text + ' ' + cls);
          });
          let count = 0;
          for (const root of roots) {
            const buttons = Array.from(root.querySelectorAll('button,a,[role="button"],i,span,div')).filter(el => {
              if (!visible(el)) return false;
              const text = normalize([el.innerText, el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), el.className].filter(Boolean).join(' '));
              return /(关闭|返回|close|icon-close|btn-close|×|\bx\b)/i.test(text);
            }).sort((a, b) => {
              const ar = a.getBoundingClientRect();
              const br = b.getBoundingClientRect();
              return (ar.y - br.y) || (br.x - ar.x);
            });
            const target = buttons[0];
            if (!target) continue;
            target.click();
            count += 1;
            break;
          }
          return { clicked: count };
        }""") or {}
        try:
            origin_page.wait_for_timeout(random.randint(300, 650))
        except Exception:
            pass
        return {
            "platform": platform,
            "closedPages": closed_pages,
            "closedInlineSurfaces": int((clicked if isinstance(clicked, dict) else {}).get("clicked") or 0),
        }

    def recruiter_find_resume_attachment_entry(self, terminal: BrowserTerminal, platform: str) -> dict:
        page = terminal.current_page()
        token = f"codex_{platform}_resume_attachment_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        info = safe_eval(page, r"""({ token, platform }) => {
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4
              && box.bottom > 0 && box.right > 0
              && box.x < window.innerWidth && box.y < window.innerHeight
              && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const rect = el => {
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
          };
          const candidates = [];
          const nodes = Array.from(document.querySelectorAll('a,button,[role="button"],span,div'));
          for (const node of nodes) {
            if (!visible(node)) continue;
            const text = normalize([node.innerText, node.textContent, node.getAttribute('title'), node.getAttribute('aria-label'), node.className, node.getAttribute('href')].filter(Boolean).join(' '));
            const clickable = node.closest('a,button,[role="button"],.card-btn,.message-card-wrap,.resume-btn-file,.im-attachment-card__button,.newest-attach-resume,.km-button') || node;
            if (!visible(clickable)) continue;
            const root = node.closest('.message-item,.im-message,.message-card-wrap,.im-attachment-card,.conversation-message,.im-session-detail__main') || clickable;
            const haystack = normalize([text, clickable.innerText, clickable.textContent, root.innerText, root.textContent, clickable.className].filter(Boolean).join(' '));
            let score = -9999;
              if (platform === 'boss') {
                if (haystack.includes('点击预览附件简历')) score = 1000;
                else if (/[\u4e00-\u9fffA-Za-z0-9_（）() -]+\.pdf/.test(haystack) && haystack.includes('简历')) score = 850;
                else if (normalize(node.innerText || node.textContent || '') === '附件简历' && /resume-btn-file/.test(String(clickable.className || ''))) score = 520;
                else continue;
                if (clickable.closest('.message-card-wrap,.message-item')) score += 180;
                if (/card-btn|resume-btn-file|hyperLink/.test(String(clickable.className || '') + ' ' + String(node.className || ''))) score += 90;
                if (/card-btn/.test(String(clickable.className || '') + ' ' + String(node.className || ''))) score += 240;
                if (/hyperLink/.test(String(clickable.className || '') + ' ' + String(node.className || ''))) score -= 80;
              } else if (platform === 'zhilian') {
              if (normalize(node.innerText || node.textContent || '') !== '查看附件简历') continue;
              score = 1000;
              if (clickable.closest('.im-attachment-card,.im-message')) score += 220;
              if (clickable.closest('.im-sender__bar,.session-new-action')) score += 80;
              if (clickable.closest('.hover-resume-footer,.im-resume-detail')) score -= 30;
            } else {
              continue;
            }
            const box = clickable.getBoundingClientRect();
            if (box.width > window.innerWidth * 0.80 || box.height > window.innerHeight * 0.80) score -= 400;
            candidates.push({
              score,
              text: haystack.slice(0, 260),
              tag: clickable.tagName,
              className: String(clickable.className || '').slice(0, 160),
              rect: rect(clickable),
              element: clickable
            });
          }
          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0];
          if (!best || best.score < 500) return { found: false, reason: 'resume_attachment_entry_not_found', candidates: candidates.slice(0, 8).map(({score,text,tag,className,rect}) => ({score,text,tag,className,rect})) };
          best.element.setAttribute('data-codex-resume-attachment-entry', token);
          return {
            found: true,
            token,
            candidate: { score: best.score, text: best.text, tag: best.tag, className: best.className, rect: best.rect },
            candidates: candidates.slice(0, 8).map(({score,text,tag,className,rect}) => ({score,text,tag,className,rect}))
          };
        }""", {"token": token, "platform": platform})
        if not isinstance(info, dict) or not info.get("found"):
            return info if isinstance(info, dict) else {"found": False}
        info["locator"] = page.locator(f"[data-codex-resume-attachment-entry='{token}']").first
        return info

    def recruiter_find_resume_download_button(self, page) -> dict:
        token = f"codex_resume_download_button_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        info = safe_eval(page, r"""token => {
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
          const visible = el => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 4 && box.height > 4
              && box.bottom > 0 && box.right > 0
              && box.x < window.innerWidth && box.y < window.innerHeight
              && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const rect = el => {
            const box = el.getBoundingClientRect();
            return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
          };
          const candidates = [];
          for (const el of Array.from(document.querySelectorAll('a,button,[role="button"],i,span,div'))) {
            if (!visible(el)) continue;
            const text = normalize([el.innerText, el.textContent, el.getAttribute('title'), el.getAttribute('aria-label'), el.getAttribute('download'), el.className, el.getAttribute('href')].filter(Boolean).join(' '));
            let score = 0;
            if (/^(下载|保存)$/.test(normalize(el.innerText || el.textContent || ''))) score += 180;
            if (/(下载|保存|download|save)/i.test(text)) score += 120;
            if (/\.(pdf|docx?)(?:$|[?#\s])/i.test(text)) score += 45;
            if (/(关闭|返回|取消|求简历|不合适|换电话|换微信|约面试)/.test(text)) score -= 180;
            if (/(download|save|down|icon-download|resume)/i.test(String(el.className || ''))) score += 45;
            const box = el.getBoundingClientRect();
            if (box.y < 120 || box.x > window.innerWidth * 0.55) score += 20;
            if (box.width > 220 || box.height > 90) score -= 45;
            if (score < 100) continue;
            candidates.push({ score, text: text.slice(0, 180), tag: el.tagName, className: String(el.className || '').slice(0, 140), rect: rect(el), element: el });
          }
          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0];
          if (!best) return { found: false, reason: 'resume_download_button_not_found', candidates: [] };
          best.element.setAttribute('data-codex-resume-download-button', token);
          return {
            found: true,
            token,
            candidate: { score: best.score, text: best.text, tag: best.tag, className: best.className, rect: best.rect },
            candidates: candidates.slice(0, 8).map(({score,text,tag,className,rect}) => ({score,text,tag,className,rect}))
          };
        }""", token)
        if not isinstance(info, dict) or not info.get("found"):
            return info if isinstance(info, dict) else {"found": False}
        info["locator"] = page.locator(f"[data-codex-resume-download-button='{token}']").first
        return info

    def recruiter_current_resume_context(self, terminal: BrowserTerminal, platform: str, context: dict | None = None) -> dict:
        context = context if isinstance(context, dict) else {}
        if platform == "zhilian":
            if not context:
                context = self.zhilian_read_chat_context(terminal, history={"loaded": False, "reason": "zhilian_visible_dom_only"})
            applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
            candidate_label = safe_text(str(applicant.get("label") or applicant.get("name") or ""), 180)
            return {
                "context": context,
                "candidate": applicant,
                "candidateLabel": candidate_label,
                "candidateName": safe_text(str(applicant.get("name") or recruiter_candidate_name_from_label(candidate_label)), 60),
                "appliedPosition": clean_applied_position(str(applicant.get("appliedPosition") or context.get("appliedPosition") or "")),
                "identityWarnings": applicant.get("identityWarnings") if isinstance(applicant.get("identityWarnings"), list) else [],
            }
        candidate = read_recruiter_selected_candidate(terminal)
        candidate_label = safe_text(str(candidate.get("label") or ""), 180)
        page = terminal.current_page()
        details = safe_eval(page, r"""() => {
          const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
          const text = normalize(document.body ? document.body.innerText || '' : '');
          const positionMatch = text.match(/沟通职位[:：]\s*([^期望昨天今日\r\n]+)/);
          const header = normalize((document.querySelector('.base-info-single-top-detail,.geek-name,.conversation-main') || {}).innerText || '');
          return { position: positionMatch ? positionMatch[1] : '', header };
        }""") or {}
        candidate_name = safe_text(str(candidate.get("name") or ""), 60) or recruiter_candidate_name_from_label(candidate_label) or recruiter_candidate_name_from_label(str((details if isinstance(details, dict) else {}).get("header") or ""))
        applied_position = clean_applied_position(str((details if isinstance(details, dict) else {}).get("position") or ""))
        resume_context = {
            "applicant": {
                "label": candidate_label,
                "name": candidate_name,
                "appliedPosition": applied_position,
                "source": "boss-chat",
            },
            "conversationKey": "boss_resume_" + stable_digest(candidate_label or f"{candidate_name}|{applied_position}", 24),
            "appliedPosition": applied_position,
        }
        return {
            "context": resume_context,
            "candidate": resume_context["applicant"],
            "candidateLabel": candidate_label,
            "candidateName": safe_text(candidate_name, 60),
            "appliedPosition": applied_position,
            "identityWarnings": [],
        }

    def recruiter_save_download_object(
        self,
        platform: str,
        context: dict,
        download,
        candidate_name: str,
        applied_position: str,
        method: str,
        fallback_text: str = "",
    ) -> dict:
        filename = ""
        try:
            filename = download.suggested_filename or ""
        except Exception:
            filename = ""
        target_path = make_recruiter_resume_target_path(
            platform=platform,
            candidate_name=candidate_name,
            applied_position=applied_position,
            original_filename=filename,
            fallback_text=fallback_text or f"{candidate_name}_{applied_position}.pdf",
        )
        download.save_as(str(target_path))
        file_hash = job51_resume_file_hash(target_path)
        try:
            file_size = target_path.stat().st_size
        except Exception:
            file_size = 0
        result = {
            "ok": True,
            "downloaded": True,
            "platform": platform,
            "candidateName": candidate_name,
            "appliedPosition": applied_position,
            "filePath": str(target_path),
            "filename": target_path.name,
            "fileHash": file_hash,
            "fileSize": file_size,
            "folder": str(target_path.parent),
            "downloadMethod": method,
            "message": f"{platform} 附件简历已下载：{target_path.name}",
        }
        result["memory"] = self.recruiter_mark_resume_downloaded(platform, context, result)
        self.add_event("file", result["message"])
        return result

    def recruiter_save_resume_bytes(
        self,
        platform: str,
        context: dict,
        content: bytes | bytearray,
        candidate_name: str,
        applied_position: str,
        method: str,
        original_filename: str = "",
        fallback_text: str = "",
    ) -> dict:
        if not isinstance(content, (bytes, bytearray)) or not content:
            return {"ok": False, "blocked": True, "reason": "empty_resume_content", "message": f"{platform} 附件简历响应为空，未保存。"}
        target_path = make_recruiter_resume_target_path(
            platform=platform,
            candidate_name=candidate_name,
            applied_position=applied_position,
            original_filename=original_filename,
            fallback_text=fallback_text or f"{candidate_name}_{applied_position}.pdf",
        )
        target_path.write_bytes(bytes(content))
        file_hash = job51_resume_file_hash(target_path)
        try:
            file_size = target_path.stat().st_size
        except Exception:
            file_size = len(content)
        result = {
            "ok": True,
            "downloaded": True,
            "platform": platform,
            "candidateName": candidate_name,
            "appliedPosition": applied_position,
            "filePath": str(target_path),
            "filename": target_path.name,
            "fileHash": file_hash,
            "fileSize": file_size,
            "folder": str(target_path.parent),
            "downloadMethod": method,
            "message": f"{platform} 附件简历已下载：{target_path.name}",
        }
        result["memory"] = self.recruiter_mark_resume_downloaded(platform, context, result)
        self.add_event("file", result["message"])
        return result

    def recruiter_download_resume_from_page_url(
        self,
        platform: str,
        context: dict,
        page,
        candidate_name: str,
        applied_position: str,
        fallback_text: str = "",
    ) -> dict:
        url = safe_text(str(getattr(page, "url", "") or ""), 1000)
        if not re.search(r"(downloadFileTemporary|download|resume|jianli|pdf|docx?)", url, flags=re.I):
            return {"ok": False, "blocked": False, "reason": "page_url_not_downloadable", "url": safe_text(url, 240)}
        try:
            response = page.context.request.get(url, timeout=20000)
            if not response.ok:
                return {"ok": False, "blocked": True, "reason": "resume_url_response_failed", "status": response.status, "url": safe_text(url, 240), "message": f"{platform} 附件简历临时链接下载失败：HTTP {response.status}"}
            headers = response.headers
            filename = response_attachment_filename(headers, fallback=url) or fallback_text
            content = response.body()
        except Exception as error:
            return {"ok": False, "blocked": True, "reason": "resume_url_download_error", "error": safe_text(str(error), 180), "url": safe_text(url, 240), "message": f"{platform} 附件简历临时链接下载失败：{safe_text(str(error), 120)}"}
        saved = self.recruiter_save_resume_bytes(
            platform,
            context,
            content,
            candidate_name,
            applied_position,
            "attachment_page_url_download",
            original_filename=filename,
            fallback_text=fallback_text or url,
        )
        saved["sourceUrl"] = safe_text(url, 300)
        return saved

    def recruiter_download_visible_resume_attachment(
        self,
        terminal: BrowserTerminal,
        platform: str,
        context: dict | None = None,
    ) -> dict:
        identity = self.recruiter_current_resume_context(terminal, platform, context=context)
        resume_context = identity.get("context") if isinstance(identity.get("context"), dict) else {}
        candidate = identity.get("candidate") if isinstance(identity.get("candidate"), dict) else {}
        candidate_name = safe_text(str(identity.get("candidateName") or ""), 60)
        applied_position = clean_applied_position(str(identity.get("appliedPosition") or ""))
        candidate_label = safe_text(str(identity.get("candidateLabel") or candidate_name), 180)
        if identity.get("identityWarnings"):
            return {
                "ok": False,
                "blocked": True,
                "reason": "candidate_identity_mismatch",
                "message": f"{platform} 当前会话身份不一致，已停止下载附件简历，避免保存错人。",
                "candidate": candidate,
                "identity": identity,
            }
        if not candidate_name:
            return {"ok": False, "blocked": True, "reason": "candidate_name_unknown", "message": f"{platform} 当前候选人姓名未识别，未下载附件简历。", "candidate": candidate}
        remembered = self.recruiter_find_downloaded_resume_memory(platform, resume_context, candidate_name, applied_position)
        if remembered:
            close_result = self.recruiter_close_resume_download_surfaces(terminal, origin_page=terminal.current_page(), platform=platform)
            return {
                "ok": True,
                "downloaded": True,
                "skipped": True,
                "skipReason": "already_downloaded",
                "alreadyDownloaded": True,
                "platform": platform,
                "candidate": candidate,
                "candidateName": candidate_name,
                "appliedPosition": applied_position,
                "filePath": remembered.get("filePath") or "",
                "filename": remembered.get("filename") or "",
                "memory": remembered,
                "closeResult": close_result,
                "message": f"{platform} 已有该候选人的简历下载记录，跳过重复下载：{safe_text(str(remembered.get('filename') or candidate_name), 100)}",
            }
        origin_page = terminal.current_page()
        entry = self.recruiter_find_resume_attachment_entry(terminal, platform)
        if not entry.get("found"):
            if platform == "zhilian":
                url_download = self.recruiter_download_resume_from_page_url(
                    platform,
                    resume_context,
                    origin_page,
                    candidate_name,
                    applied_position,
                    fallback_text=candidate_label,
                )
                if url_download.get("ok") and url_download.get("downloaded"):
                    url_download["candidate"] = candidate
                    url_download["entry"] = entry
                    url_download["openedBy"] = "already_open_preview"
                    url_download["closeResult"] = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
                    return url_download
                download_button = self.recruiter_find_resume_download_button(origin_page)
                if download_button.get("found"):
                    button_locator = download_button.get("locator")
                    if button_locator is not None and button_locator.count():
                        try:
                            with origin_page.expect_download(timeout=20000) as download_info:
                                if terminal.humanize:
                                    terminal.pause_like_person("pre_action")
                                    highlight_target(button_locator)
                                humanized_locator_click(terminal, button_locator, force=True)
                                if terminal.humanize:
                                    terminal.pause_like_person("post_action")
                            download = download_info.value
                            failure = ""
                            try:
                                failure = download.failure() or ""
                            except Exception:
                                failure = ""
                            if failure:
                                close_result = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
                                return {"ok": False, "blocked": True, "reason": "resume_download_failed", "message": f"{platform} 附件简历下载失败：{safe_text(failure, 160)}", "candidate": candidate, "entry": entry, "downloadButton": {k: v for k, v in download_button.items() if k != "locator"}, "closeResult": close_result}
                            saved = self.recruiter_save_download_object(platform, resume_context, download, candidate_name, applied_position, "attachment_preview_already_open_download", fallback_text=candidate_label)
                            saved["candidate"] = candidate
                            saved["entry"] = entry
                            saved["downloadButton"] = {k: v for k, v in download_button.items() if k != "locator"}
                            saved["openedBy"] = "already_open_preview"
                            saved["closeResult"] = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
                            return saved
                        except Exception as error:
                            close_result = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
                            return {
                                "ok": False,
                                "blocked": True,
                                "reason": "resume_download_not_triggered",
                                "message": f"{platform} 已检测到简历预览下载按钮，但点击后没有触发文件下载：{safe_text(candidate_label, 80)}",
                                "candidate": candidate,
                                "error": safe_text(str(error), 180),
                                "entry": entry,
                                "downloadButton": {k: v for k, v in download_button.items() if k != "locator"},
                                "closeResult": close_result,
                            }
            return {
                "ok": False,
                "blocked": False,
                "reason": "resume_attachment_entry_not_found",
                "message": f"{platform} 当前会话未找到可打开的附件简历入口：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "scan": entry,
            }
        locator = entry.get("locator")
        if locator is None or not locator.count():
            return {"ok": False, "blocked": True, "reason": "resume_attachment_entry_element_missing", "message": f"{platform} 找到附件简历入口但元素已消失。", "candidate": candidate, "scan": {k: v for k, v in entry.items() if k != "locator"}}

        detail_page = origin_page
        opened_by = "same_page"
        direct_download = None
        click_error = ""
        try:
            with origin_page.expect_download(timeout=4500) as download_info:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(locator)
                humanized_locator_click(terminal, locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
            direct_download = download_info.value
        except Exception as error:
            click_error = safe_text(str(error), 180)
        if direct_download is not None:
            saved = self.recruiter_save_download_object(platform, resume_context, direct_download, candidate_name, applied_position, "attachment_entry_direct_download", fallback_text=str((entry.get("candidate") or {}).get("text") or ""))
            saved["candidate"] = candidate
            saved["entry"] = {k: v for k, v in entry.items() if k != "locator"}
            saved["closeResult"] = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
            return saved

        origin_page.wait_for_timeout(random.randint(900, 1400))
        pages_after_click = list(origin_page.context.pages)
        for page in reversed(pages_after_click):
            if page != origin_page:
                detail_page = page
                opened_by = "new_or_existing_page"
                break
        try:
            detail_page.bring_to_front()
            detail_page.wait_for_selector("body", timeout=5000)
            terminal.page = detail_page
        except Exception:
            pass
        url_download = self.recruiter_download_resume_from_page_url(
            platform,
            resume_context,
            detail_page,
            candidate_name,
            applied_position,
            fallback_text=str((entry.get("candidate") or {}).get("text") or ""),
        )
        if url_download.get("ok") and url_download.get("downloaded"):
            url_download["candidate"] = candidate
            url_download["entry"] = {k: v for k, v in entry.items() if k != "locator"}
            url_download["openedBy"] = opened_by
            terminal.page = origin_page
            url_download["closeResult"] = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
            return url_download
        download_button = self.recruiter_find_resume_download_button(detail_page)
        if not download_button.get("found") and detail_page != origin_page:
            download_button = self.recruiter_find_resume_download_button(origin_page)
            detail_page = origin_page
            terminal.page = origin_page
        if not download_button.get("found"):
            terminal.page = origin_page
            close_result = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
            return {
                "ok": False,
                "blocked": True,
                "reason": "resume_download_button_not_found",
                "message": f"{platform} 已打开附件简历，但未找到下载按钮：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "entry": {k: v for k, v in entry.items() if k != "locator"},
                "downloadButton": download_button,
                "clickError": click_error,
                "openedBy": opened_by,
                "closeResult": close_result,
            }
        button_locator = download_button.get("locator")
        if button_locator is None or not button_locator.count():
            terminal.page = origin_page
            close_result = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
            return {"ok": False, "blocked": True, "reason": "resume_download_button_element_missing", "message": f"{platform} 找到下载按钮但元素已消失。", "candidate": candidate, "downloadButton": {k: v for k, v in download_button.items() if k != "locator"}, "closeResult": close_result}
        try:
            with detail_page.expect_download(timeout=20000) as download_info:
                if terminal.humanize:
                    terminal.pause_like_person("pre_action")
                    highlight_target(button_locator)
                humanized_locator_click(terminal, button_locator, force=True)
                if terminal.humanize:
                    terminal.pause_like_person("post_action")
            download = download_info.value
            failure = ""
            try:
                failure = download.failure() or ""
            except Exception:
                failure = ""
            if failure:
                terminal.page = origin_page
                close_result = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
                return {"ok": False, "blocked": True, "reason": "resume_download_failed", "message": f"{platform} 附件简历下载失败：{safe_text(failure, 160)}", "candidate": candidate, "closeResult": close_result}
            saved = self.recruiter_save_download_object(platform, resume_context, download, candidate_name, applied_position, "attachment_preview_download", fallback_text=str((entry.get("candidate") or {}).get("text") or ""))
            saved["candidate"] = candidate
            saved["entry"] = {k: v for k, v in entry.items() if k != "locator"}
            saved["downloadButton"] = {k: v for k, v in download_button.items() if k != "locator"}
            saved["openedBy"] = opened_by
            terminal.page = origin_page
            saved["closeResult"] = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
            return saved
        except Exception as error:
            terminal.page = origin_page
            close_result = self.recruiter_close_resume_download_surfaces(terminal, origin_page=origin_page, platform=platform)
            return {
                "ok": False,
                "blocked": True,
                "reason": "resume_download_not_triggered",
                "message": f"{platform} 点击下载按钮后没有触发文件下载：{safe_text(candidate_label, 80)}",
                "candidate": candidate,
                "error": safe_text(str(error), 180),
                "entry": {k: v for k, v in entry.items() if k != "locator"},
                "downloadButton": {k: v for k, v in download_button.items() if k != "locator"},
                "closeResult": close_result,
            }

    def job51_answer_current_candidate_questions(self, terminal: BrowserTerminal) -> dict:
        history = {"loaded": False, "reason": "job51_visible_dom_only"}
        context = self.job51_read_chat_context(terminal, history=history)
        candidate = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
        candidate_label = str(candidate.get("label") or candidate.get("name") or "")
        knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
        position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
        position_screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
        if is_unconfigured_recruiter_position(context, position_reply, position_screening):
            return {
                "message": f"51job 当前岗位未配置知识库，跳过不回复：{safe_text(str(context.get('appliedPosition') or ''), 80)}",
                "candidate": candidate,
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
        return result or {
            "message": f"51job 当前候选人没有检测到需要知识库回复的问题：{safe_text(candidate_label, 80)}",
            "candidate": candidate,
            "answered": False,
        }

    def job51_screen_position_rules(
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
        analysis = self.measure_current_timing_stage(
            "job51_analyze_position_screening",
            "51job 本地岗位规则判断",
            lambda: analyze_position_screening(messages, screening_rules),
        )
        if analysis.get("status") != "not_asked" and context.get("lastSender") == "other":
            analysis = self.measure_current_timing_stage(
                "job51_enhance_position_screening_model",
                "51job 模型辅助岗位判断",
                lambda: enhance_position_screening_with_model(context, screening_rules, analysis, previous_state),
            )
        if context.get("lastSender") == "other":
            try:
                self.measure_current_timing_stage(
                    "job51_conversation_review",
                    "51job 候选人对话复盘",
                    lambda: ensure_candidate_conversation_review(context, previous_state, analysis),
                )
            except Exception as error:
                context["conversationReview"] = {
                    "modelEnabled": False,
                    "error": safe_text(str(error), 180),
                    "summary": "",
                    "unansweredQuestions": [],
                    "answeredQuestions": [],
                }
        state_payload = {
            "candidateLabel": safe_text(candidate_label, 160),
            "platform": "51job",
            "positionTitle": safe_text(str(knowledge_base.get("title") or ""), 80),
            "appliedPosition": safe_text(str(context.get("appliedPosition") or ""), 80),
            "lastScreening": analysis.get("reason") or "",
            "screening": analysis,
        }
        if analysis.get("status") in {"not_asked", "waiting", "unclear"}:
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
                    **knowledge_result,
                    "candidate": context.get("applicant", {}),
                    "screening": analysis,
                    "positionScreening": True,
                }
        if analysis.get("status") == "not_asked":
            question = analysis.get("nextQuestion") if isinstance(analysis.get("nextQuestion"), dict) else {}
            question_text = strip_reply_terminal_punctuation(select_position_screening_question_text(question))
            if not question_text:
                return {"blocked": True, "message": "51job 当前岗位没有可发送的筛选问题", "screening": analysis}
            send_result = self.job51_send_message_with_verification(terminal, question_text)
            status = "position_screening_send_blocked" if send_result.get("blocked") else "position_screening_sent_waiting"
            self.set_recruiter_basic_state(
                conversation_key,
                candidate_label,
                status,
                context=context,
                **{**state_payload, "lastQuestion": safe_text(question_text, 180)},
            )
            return {
                "message": f"51job 已发送岗位筛选问题：{safe_text(question_text, 80)}",
                "candidate": context.get("applicant", {}),
                "screening": analysis,
                "sent": send_result,
                "blocked": bool(send_result.get("blocked")),
                "positionScreening": True,
            }
        if analysis.get("status") == "waiting":
            self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_waiting", context=context, **state_payload)
            return {
                "message": f"51job 已问过筛选问题，候选人暂未明确回复：{safe_text(candidate_label, 80)}",
                "candidate": context.get("applicant", {}),
                "screening": analysis,
                "positionScreening": True,
            }
        if analysis.get("status") == "reject":
            self.set_recruiter_basic_state(conversation_key, candidate_label, "position_screening_rejected", context=context, **state_payload)
            return {
                "message": f"51job 候选人不满足岗位硬性筛选条件，已跳过不标记不合适：{safe_text(candidate_label, 80)}",
                "candidate": context.get("applicant", {}),
                "screening": analysis,
                "shouldMarkUnsuitable": False,
                "positionScreening": True,
            }
        if analysis.get("status") == "accept":
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
                return {**knowledge_result, "candidate": context.get("applicant", {}), "screening": analysis, "positionScreening": True}
            resume_result = self.job51_download_attachment_or_request_resume(
                terminal,
                accepted_by_flow={
                    "accepted": True,
                    "source": "position_screening_accept",
                    "reason": analysis.get("reason") or "position_screening_accept",
                    "screening": analysis,
                },
            )
            request_result = resume_result.get("request") if isinstance(resume_result.get("request"), dict) else {}
            resume_skipped = bool(request_result.get("skipped") and request_result.get("skipReason") in {"already_requested", "resume_attachment_received"})
            status = "position_screening_accepted_resume_downloaded" if resume_result.get("downloaded") else (
                "position_screening_accepted_resume_already_requested" if resume_skipped else (
                    "position_screening_accepted_resume_blocked" if resume_result.get("blocked") else "position_screening_accepted_resume_requested"
                )
            )
