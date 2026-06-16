              el.getAttribute("title") || ""
            ].filter(Boolean).join(" | ")"""
        )
    except Exception:
        return ""


def is_editable_locator(locator) -> bool:
    try:
        if locator.count() <= 0:
            return False
        return bool(locator.first.evaluate(
            """el => {
              const tag = el.tagName.toLowerCase();
              const type = (el.getAttribute("type") || "").toLowerCase();
              const role = (el.getAttribute("role") || "").toLowerCase();
              const style = window.getComputedStyle(el);
              const box = el.getBoundingClientRect();
              if (box.width <= 2 || box.height <= 2 || box.bottom <= 0 || box.top >= window.innerHeight) return false;
              if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
              if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
              if (el.readOnly) return false;
              if (el.isContentEditable) return true;
              if (tag === "textarea" || tag === "select") return true;
              if (tag === "input" && !["hidden", "file", "button", "submit", "checkbox", "radio"].includes(type)) return true;
              return role === "textbox" || role === "combobox" || role === "searchbox";
            }"""
        ))
    except Exception:
        return False


def find_best_editable(terminal: BrowserTerminal, target: str = ""):
    terminal.collect_page_context(limit=100)
    page = terminal.current_page()
    selector = "textarea, input:not([type=hidden]):not([type=file]):not([type=button]):not([type=submit]), [contenteditable=true], [role=textbox], [role=searchbox]"
    candidates = page.locator(selector)
    count = candidates.count()
    if count <= 0:
        raise AgentError("当前页面没有找到可填写的输入框。")

    target_lower = (target or "").lower()
    best = None
    best_label = ""
    best_score = -1
    for index in range(min(count, 80)):
        item = candidates.nth(index)
        if not is_editable_locator(item):
            continue
        label = describe_editable(item)
        score = score_editable_candidate(label, target_lower)
        try:
            box = item.bounding_box(timeout=1200)
            if box:
                score += 5
            else:
                continue
        except Exception:
            continue
        if score > best_score:
            best = item
            best_label = label or f"输入框 {index + 1}"
            best_score = score

    if best is None:
        raise AgentError("找到了输入类元素，但没有可编辑的输入框。")
    return best, best_label


def find_chat_resume_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_resume_send_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const overlaps = (a, b) => (
                Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
                * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
              ) > 8;
              const resumeText = "\u53d1\u7b80\u5386";
              const nodes = Array.from(document.body ? document.body.querySelectorAll(
                "button,a,[role='button'],[onclick],div,span,li"
              ) : []);
              let best = null;
              let bestScore = -9999;
              for (const node of nodes) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
                const attrs = normalize([
                  node.id,
                  node.className,
                  node.getAttribute("ka"),
                  node.getAttribute("role"),
                  node.getAttribute("title"),
                  node.getAttribute("aria-label")
                ].join(" "));
                const hay = `${text} ${attrs}`.toLowerCase();
                const englishSendResume = hay.includes("resume") && (hay.includes("send") || hay.includes("toolbar") || hay.includes("chat"));
                if (!text.includes(resumeText) && !englishSendResume) continue;
                const box = node.getBoundingClientRect();
                let score = 0;
                if (text === resumeText) score += 120;
                else if (text.includes(resumeText)) score += 70;
                if (/toolbar|chat|editor|control|resume/i.test(attrs)) score += 45;
                if (box.x > window.innerWidth * 0.28 && box.y > window.innerHeight * 0.55) score += 30;
                score -= Math.max(0, text.length - 8) * 3;
                const toolbarTarget = nodes.find((other) => {
                  if (other === node || !visible(other)) return false;
                  const cls = String(other.className || "");
                  if (!/\btoolbar-btn\b/.test(cls) || /toolbar-btn-content/.test(cls)) return false;
                  const otherText = normalize(other.innerText || other.textContent || other.getAttribute("title") || "");
                  return otherText.includes(resumeText) && overlaps(box, other.getBoundingClientRect());
                });
                const target = toolbarTarget
                  || node.closest(".toolbar-btn")
                  || node.closest("button,a,[role='button'],[onclick],.toolbar-btn-content")
                  || node;
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, target, text, attrs, box };
                }
              }
              if (!best) return { found: false };
              const target = best.target;
              target.setAttribute("data-codex-resume-send", token);
              const chain = [];
              let cur = target;
              for (let i = 0; cur && i < 4; i += 1, cur = cur.parentElement) {
                chain.push(normalize([
                  cur.tagName,
                  cur.id,
                  cur.className,
                  cur.getAttribute("title"),
                  cur.getAttribute("aria-label"),
                  cur.getAttribute("disabled"),
                  cur.getAttribute("aria-disabled")
                ].join(" ")));
              }
              const chainText = chain.join(" | ");
              const disabled = /unable|disabled|forbid|disable|\u7981\u7528|\u7b49\u5f85\u5bf9\u65b9\u56de\u590d/i.test(chainText)
                || target.disabled === true
                || target.getAttribute("disabled") !== null
                || target.getAttribute("aria-disabled") === "true"
                || window.getComputedStyle(target).pointerEvents === "none";
              const hints = [
                "\u6b63\u5728\u8bf7\u6c42\u4e2d\uff0c\u7b49\u5f85\u5bf9\u65b9\u56de\u590d",
                "\u7b49\u5f85\u5bf9\u65b9\u56de\u590d",
                "\u4e0d\u53ef\u7528"
              ];
              let reason = hints.find((hint) => chainText.includes(hint)) || "";
              if (!reason) {
                reason = normalize(target.getAttribute("title") || target.getAttribute("aria-label") || "");
              }
              const box = target.getBoundingClientRect();
              return {
                found: true,
                label: best.text || resumeText,
                disabled,
                reason: reason || chainText,
                debugReason: chainText,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    locator = page.locator(f"[data-codex-resume-send='{token}']").first
    info["locator"] = locator
    return info


def find_recruiter_unreplied_candidate(
    terminal: BrowserTerminal,
    exclude_labels: list[str] | set[str] | tuple[str, ...] | None = None,
) -> dict | None:
    page = terminal.current_page()
    token = f"codex_recruiter_unreplied_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    excluded = [compact_conversation_label(str(label or "")) for label in (exclude_labels or [])]
    excluded = [label for label in excluded if label]
    try:
        info = page.evaluate(
            r"""({ token, excluded }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value)
                .replace(/^\d{1,3}\s+(?=\d{1,2}:\d{2})/, "")
                .replace(/^\d{1,2}:\d{2}\s*/, "")
                .replace(/\s+/g, "")
                .replace(/(已读|未读|草稿|新消息|对方正在输入)/g, "")
                .slice(0, 160);
              const personName = (value) => {
                const key = compact(value);
                const match = key.match(/^([\u4e00-\u9fffA-Za-z·]{2,8})/);
                return match ? match[1] : "";
              };
              const excludedNames = (excluded || []).map(personName).filter(Boolean);
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 35 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const rows = Array.from(document.body ? document.body.querySelectorAll(
                ".geek-item, .geek-item-wrap, [class*='geek-item'], [class*='listitem']"
              ) : []);
              let best = null;
              let bestScore = -9999;
              for (const row of rows) {
                if (!visible(row)) continue;
                const box = row.getBoundingClientRect();
                if (box.x > Math.min(680, window.innerWidth * 0.48) || box.bottom < 40 || box.y > window.innerHeight - 12) continue;
                const text = normalize(row.innerText || row.textContent || "");
                if (!text || /selected/.test(String(row.className || ""))) continue;
                const rowKey = compact(text);
                const rowName = personName(text);
                if ((excluded || []).some((item) => item && (rowKey.includes(item) || item.includes(rowKey.slice(0, 60))))
                  || (rowName && excludedNames.includes(rowName))) continue;
                let unread = 0;
                let match = text.match(/^(\d{1,3})\s+/);
                if (match) unread = Number(match[1]) || 0;
                if (!unread) {
                  const badge = Array.from(row.querySelectorAll("*")).map((el) => normalize(el.innerText || el.textContent || ""))
                    .find((value) => /^\d{1,3}$/.test(value));
                  if (badge) unread = Number(badge) || 0;
                }
                if (!unread) continue;
                let score = 1000 + unread * 20 - box.y;
                if (/简历|投递|看看|进一步沟通|感兴趣|希望/.test(text)) score += 60;
                const clickable = row.closest(".geek-item-wrap") || row.closest(".geek-item") || row;
                if (score > bestScore) {
                  bestScore = score;
                  best = { row: clickable, label: text, unread, x: box.x, y: box.y, w: box.width, h: box.height };
                }
              }
              if (!best) return null;
              best.row.setAttribute("data-codex-recruiter-unreplied", token);
              return {
                label: best.label,
                unreadCount: best.unread,
                x: Math.round(best.x),
                y: Math.round(best.y),
                w: Math.round(best.w),
                h: Math.round(best.h)
              };
            }""",
            {"token": token, "excluded": excluded},
        )
    except Exception:
        return None
    if not isinstance(info, dict) or not info:
        return None
    info["locator"] = page.locator(f"[data-codex-recruiter-unreplied='{token}']").first
    return info


def prepare_recruiter_unread_candidate_list(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_recruiter_unread_tab_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const unread = "\u672a\u8bfb";
              const all = "\u5168\u90e8";
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                if (!el) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 0 && box.height > 0 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const isUnreadLabel = (text) => {
                if (!text) return false;
                if (text === unread) return true;
                if (text.startsWith(unread) && text.length <= 12) return true;
                return new RegExp(`^${unread}\\s*[（(]?\\s*\\d{0,3}\\s*[）)]?$`).test(text);
              };
              const candidates = Array.from(document.querySelectorAll([
                ".chat-message-filter-left span",
                ".chat-message-filter-left div",
                ".chat-message-filter span",
                ".chat-message-filter div",
                "[role='tab']",
                "li",
                "button",
                "a"
              ].join(",")));
              let best = null;
              let bestScore = -9999;
              for (const node of candidates) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
                if (!isUnreadLabel(text)) continue;
                const box = node.getBoundingClientRect();
                if (box.y > 280 || box.x > Math.min(760, window.innerWidth * 0.58) || box.width > 220 || box.height > 80) continue;
                let score = 1000 - box.y;
                const cls = String(node.className || "");
                const parentText = normalize(node.parentElement ? (node.parentElement.innerText || node.parentElement.textContent || "") : "");
                if (/chat-message-filter|filter|tab/i.test(cls + " " + String(node.parentElement && node.parentElement.className || ""))) score += 260;
                if (parentText.includes(all) && parentText.includes(unread)) score += 180;
                if (box.x > 220 && box.x < 520) score += 80;
                if (score > bestScore) {
                  const target = node.closest("button,a,li,[role='tab']") || node;
                  bestScore = score;
                  best = { node, target, text, box: target.getBoundingClientRect(), className: String(target.className || "") };
                }
              }
              if (!best) return { found: false, reason: "unread_tab_not_found" };
              best.target.setAttribute("data-codex-recruiter-unread-tab", token);
              const selected = /active|selected|current|cur/.test(best.className)
                || /active|selected|current|cur/.test(String(best.node.className || ""));
              return {
                found: true,
                selected,
                label: best.text,
                box: {
                  x: Math.round(best.box.x),
                  y: Math.round(best.box.y),
                  w: Math.round(best.box.width),
                  h: Math.round(best.box.height)
                }
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    try:
        locator = page.locator(f"[data-codex-recruiter-unread-tab='{token}']").first
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        page.wait_for_timeout(random.randint(700, 1150))
        top_result = scroll_recruiter_candidate_list_to_top(terminal)
        info.update({
            "clicked": True,
            "scrollTop": top_result,
        })
    except Exception as error:
        info.update({
            "clicked": False,
            "error": safe_text(str(error), 160),
        })
    return info


def prepare_recruiter_all_candidate_list(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_recruiter_all_tab_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const all = "\u5168\u90e8";
              const unread = "\u672a\u8bfb";
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                if (!el) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 0 && box.height > 0 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const isAllLabel = (text) => {
                if (!text) return false;
                if (text === all) return true;
                if (text.startsWith(all) && text.length <= 12 && !text.includes(unread)) return true;
                return new RegExp(`^${all}\\s*[锛(]?\\s*\\d{0,4}\\s*[锛)]?$`).test(text);
              };
              const candidates = Array.from(document.querySelectorAll([
                ".chat-message-filter-left span",
                ".chat-message-filter-left div",
                ".chat-message-filter span",
                ".chat-message-filter div",
                "[role='tab']",
                "li",
                "button",
                "a"
              ].join(",")));
              let best = null;
              let bestScore = -9999;
              for (const node of candidates) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
                if (!isAllLabel(text)) continue;
                const box = node.getBoundingClientRect();
                if (box.y > 280 || box.x > Math.min(760, window.innerWidth * 0.58) || box.width > 220 || box.height > 80) continue;
                const target = node.closest("button,a,li,[role='tab']") || node;
                const targetClass = String(target.className || "");
                const nodeClass = String(node.className || "");
                let score = 1000 - box.y;
                if (/chat-message-filter|filter|tab/i.test(targetClass + " " + nodeClass)) score += 260;
                if (box.x < 420) score += 80;
                if (/active|selected|current|cur/.test(targetClass + " " + nodeClass)) score += 30;
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, target, text, box: target.getBoundingClientRect(), className: targetClass };
                }
              }
              if (!best) return { found: false, reason: "all_tab_not_found" };
              best.target.setAttribute("data-codex-recruiter-all-tab", token);
              const selected = /active|selected|current|cur/.test(best.className)
                || /active|selected|current|cur/.test(String(best.node.className || ""));
              return {
                found: true,
                selected,
                label: best.text,
                box: {
                  x: Math.round(best.box.x),
                  y: Math.round(best.box.y),
                  w: Math.round(best.box.width),
                  h: Math.round(best.box.height)
                }
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    try:
        locator = page.locator(f"[data-codex-recruiter-all-tab='{token}']").first
        if not info.get("selected"):
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(locator)
            humanized_locator_click(terminal, locator, force=True)
            if terminal.humanize:
                terminal.pause_like_person("post_action")
            page.wait_for_timeout(random.randint(700, 1150))
            info["clicked"] = True
        else:
            info["clicked"] = False
        top_result = scroll_recruiter_candidate_list_to_top(terminal)
        info["scrollTop"] = top_result
    except Exception as error:
        info.update({
            "clicked": False,
            "error": safe_text(str(error), 160),
        })
    finally:
        try:
            page.locator("[data-codex-recruiter-all-tab]").evaluate_all("els => els.forEach(el => el.removeAttribute('data-codex-recruiter-all-tab'))")
        except Exception:
            pass
    return info


def scroll_recruiter_candidate_list(terminal: BrowserTerminal, direction: int = 1) -> dict:
    page = terminal.current_page()
    token = f"codex_recruiter_scroll_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        result = page.evaluate(
            r"""({ direction, token }) => {
              const visible = (el) => {
                if (!el) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 40 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const canScroll = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const overflow = style.overflowY || "";
                const cls = String(el.className || "");
                return el.scrollHeight > el.clientHeight + 30
                  && (/(auto|scroll|hidden)/.test(overflow) || /b-scroll|user-list|geek-list|session-list/i.test(cls));
              };
              const findScrollableParent = (start) => {
                let cur = start ? start.parentElement : null;
                while (cur && cur !== document.body) {
                  const box = cur.getBoundingClientRect();
                  if (canScroll(cur) && box.width >= 180 && box.x < Math.min(720, window.innerWidth * 0.55)) return cur;
                  cur = cur.parentElement;
                }
                return null;
              };
              const rows = Array.from(document.querySelectorAll(".geek-item-wrap, .geek-item, [class*='geek-item'], [class*='listitem']"))
                .filter((row) => {
                  if (!visible(row)) return false;
                  const box = row.getBoundingClientRect();
                  return box.x < Math.min(720, window.innerWidth * 0.55) && box.bottom > 40 && box.y < window.innerHeight - 12;
                });
              let container = rows.length ? findScrollableParent(rows[0]) : null;
              if (!container) {
                const containers = Array.from(document.querySelectorAll(
                  ".user-list-content,.user-list,.chat-content,.chat-user,.list-warp,[class*='user-list' i],[class*='friend-list' i],[class*='session-list' i],[class*='geek-list' i]"
                )).filter((el) => {
                  if (!visible(el) || !canScroll(el)) return false;
                  const box = el.getBoundingClientRect();
                  return box.width >= 180 && box.x < Math.min(720, window.innerWidth * 0.55);
                });
                container = containers[0] || null;
              }
              if (!container) return { scrolled: false, reason: "no_scroll_container" };
              const box = container.getBoundingClientRect();
              const before = container.scrollTop;
              const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
              const stepAbs = Math.max(260, Math.floor(container.clientHeight * (0.72 + Math.random() * 0.18)));
              const step = stepAbs * (direction >= 0 ? 1 : -1);
              const next = Math.max(0, Math.min(maxTop, before + step));
              container.setAttribute("data-codex-recruiter-scroll", token);
              return {
                scrolled: false,
                prepared: true,
                before: Math.round(before),
                after: Math.round(before),
                plannedAfter: Math.round(next),
                amount: Math.round(step),
                maxTop: Math.round(maxTop),
                atEnd: before >= maxTop - 4,
                box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
                token
              };
            }""",
            {"direction": direction, "token": token},
        )
    except Exception as error:
        return {"scrolled": False, "error": str(error)}
    if not isinstance(result, dict):
        result = {"scrolled": False}
    box = result.get("box") if isinstance(result.get("box"), dict) else None
    if box and result.get("prepared"):
        try:
            amount = int(result.get("amount") or (direction * random.randint(320, 560)))
            if terminal.humanize:
                humanized_scroll(
                    terminal,
                    amount,
                    box=box,
                    corrective=random.random() < 0.72,
                )
            else:
                page.evaluate(
                    r"""({ token, amount }) => {
                      const container = document.querySelector(`[data-codex-recruiter-scroll="${token}"]`);
                      if (!container) return;
                      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                      const next = Math.max(0, Math.min(maxTop, (container.scrollTop || 0) + amount));
                      if (container.scrollTo) container.scrollTo({ top: next, behavior: "smooth" });
                      else container.scrollTop = next;
                    }""",
                    {"token": token, "amount": amount},
                )
            page.wait_for_timeout(random.randint(180, 360))
            after = page.evaluate(
                r"""({ token, plannedAfter }) => {
                  const container = document.querySelector(`[data-codex-recruiter-scroll="${token}"]`);
                  if (!container) return { found: false };
                  const before = Number(container.getAttribute("data-codex-before") || "NaN");
                  const top = container.scrollTop || 0;
                  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                  return {
                    found: true,
                    after: Math.round(top),
                    maxTop: Math.round(maxTop),
                    atEnd: top >= maxTop - 4,
                    plannedAfter: Math.round(plannedAfter || top)
                  };
                }""",
                {"token": token, "plannedAfter": result.get("plannedAfter")},
            )
            if isinstance(after, dict) and after.get("found"):
                before = int(result.get("before") or 0)
                actual_after = int(after.get("after") or before)
                result.update({
                    "after": actual_after,
                    "maxTop": after.get("maxTop", result.get("maxTop")),
                    "atEnd": bool(after.get("atEnd")),
                    "scrolled": abs(actual_after - before) > 4,
                    "mode": "human_wheel" if terminal.humanize else "direct_scroll",
                })
            if not result.get("scrolled"):
                fallback = page.evaluate(
                    r"""({ token, plannedAfter }) => {
                      const container = document.querySelector(`[data-codex-recruiter-scroll="${token}"]`);
                      if (!container) return { scrolled: false, reason: "missing_container" };
                      const before = container.scrollTop || 0;
                      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                      const next = Math.max(0, Math.min(maxTop, Number(plannedAfter || before)));
                      if (container.scrollTo) container.scrollTo({ top: next, behavior: "smooth" });
                      else container.scrollTop = next;
                      return {
                        scrolled: Math.abs(next - before) > 4,
                        before: Math.round(before),
                        after: Math.round(next),
                        maxTop: Math.round(maxTop),
                        atEnd: next >= maxTop - 4,
                        mode: "dom_fallback"
                      };
                    }""",
                    {"token": token, "plannedAfter": result.get("plannedAfter")},
                )
                if isinstance(fallback, dict):
                    result.update(fallback)
        except Exception:
            pass
    try:
        page.wait_for_timeout(random.randint(620, 1050) if result.get("scrolled") else random.randint(420, 760))
    except Exception:
        pass
    return result


def scroll_recruiter_candidate_list_to_top(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_recruiter_scroll_top_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        result = page.evaluate(
            r"""({ token }) => {
              const visible = (el) => {
                if (!el) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 40 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const canScroll = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const overflow = style.overflowY || "";
                const cls = String(el.className || "");
                return el.scrollHeight > el.clientHeight + 30
                  && (/(auto|scroll|hidden)/.test(overflow) || /b-scroll|user-list|geek-list|session-list/i.test(cls));
              };
              const findScrollableParent = (start) => {
                let cur = start ? start.parentElement : null;
                while (cur && cur !== document.body) {
                  const box = cur.getBoundingClientRect();
                  if (canScroll(cur) && box.width >= 180 && box.x < Math.min(720, window.innerWidth * 0.55)) return cur;
                  cur = cur.parentElement;
                }
                return null;
              };
              const rows = Array.from(document.querySelectorAll(".geek-item-wrap, .geek-item, [class*='geek-item'], [class*='listitem']"))
                .filter((row) => visible(row) && row.getBoundingClientRect().x < Math.min(720, window.innerWidth * 0.55));
              let container = rows.length ? findScrollableParent(rows[0]) : null;
              if (!container) {
                const containers = Array.from(document.querySelectorAll(
                  ".user-list-content,.user-list,.chat-content,.chat-user,.list-warp,[class*='user-list' i],[class*='friend-list' i],[class*='session-list' i],[class*='geek-list' i]"
                )).filter((el) => {
                  if (!visible(el) || !canScroll(el)) return false;
                  const box = el.getBoundingClientRect();
                  return box.width >= 180 && box.x < Math.min(720, window.innerWidth * 0.55);
                });
                container = containers[0] || null;
              }
              if (!container) return { scrolled: false, reason: "no_scroll_container" };
              const box = container.getBoundingClientRect();
              const before = container.scrollTop;
              const amount = -Math.max(260, Math.floor(container.clientHeight * 0.86));
              container.setAttribute("data-codex-recruiter-scroll-top", token);
              return {
                prepared: true,
                scrolled: false,
                before: Math.round(before),
                after: Math.round(before),
                amount,
                box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
                token
              };
            }"""
            ,
            {"token": token},
        )
    except Exception as error:
        return {"scrolled": False, "error": str(error)}
    if not isinstance(result, dict):
        result = {"scrolled": False}
    box = result.get("box") if isinstance(result.get("box"), dict) else None
    if result.get("prepared") and int(result.get("before") or 0) > 4:
        try:
            rounds = 0
            while int(result.get("after") or result.get("before") or 0) > 4 and rounds < 8:
                if terminal.humanize and box:
                    humanized_scroll(
                        terminal,
                        int(result.get("amount") or -520),
                        box=box,
                        corrective=random.random() < 0.45,
                    )
                else:
                    page.evaluate(
                        r"""({ token, amount }) => {
                          const container = document.querySelector(`[data-codex-recruiter-scroll-top="${token}"]`);
                          if (!container) return;
                          const next = Math.max(0, (container.scrollTop || 0) + amount);
                          if (container.scrollTo) container.scrollTo({ top: next, behavior: "smooth" });
                          else container.scrollTop = next;
                        }""",
                        {"token": token, "amount": int(result.get("amount") or -520)},
                    )
                page.wait_for_timeout(random.randint(160, 340))
                after = page.evaluate(
                    r"""({ token }) => {
                      const container = document.querySelector(`[data-codex-recruiter-scroll-top="${token}"]`);
                      if (!container) return { found: false };
                      return { found: true, after: Math.round(container.scrollTop || 0) };
                    }""",
                    {"token": token},
                )
                if not isinstance(after, dict) or not after.get("found"):
                    break
                result["after"] = int(after.get("after") or 0)
                rounds += 1
                if result["after"] <= 4:
                    break
            if int(result.get("after") or 0) > 4:
                fallback = page.evaluate(
                    r"""({ token }) => {
                      const container = document.querySelector(`[data-codex-recruiter-scroll-top="${token}"]`);
                      if (!container) return { scrolled: false, reason: "missing_container" };
                      const before = container.scrollTop || 0;
                      container.scrollTop = 0;
                      return { scrolled: Math.abs(before) > 4, before: Math.round(before), after: 0, mode: "dom_fallback" };
                    }""",
                    {"token": token},
                )
                if isinstance(fallback, dict):
                    result.update(fallback)
            else:
                result["scrolled"] = abs(int(result.get("before") or 0) - int(result.get("after") or 0)) > 4
                result["mode"] = "human_wheel_to_top" if terminal.humanize else "direct_scroll_to_top"
        except Exception:
            pass
    try:
        page.wait_for_timeout(random.randint(360, 680))
    except Exception:
        pass
    return result


def find_recruiter_recent_candidate(
    terminal: BrowserTerminal,
    exclude_labels: list[str] | set[str] | tuple[str, ...] | None = None,
) -> dict | None:
    page = terminal.current_page()
    token = f"codex_recruiter_recent_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    excluded = [compact_conversation_label(str(label or "")) for label in (exclude_labels or [])]
    excluded = [label for label in excluded if label]
    try:
        info = page.evaluate(
            r"""({ token, excluded }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value)
                .replace(/^\d{1,3}\s+(?=\d{1,2}:\d{2})/, "")
                .replace(/^\d{1,2}:\d{2}\s*/, "")
                .replace(/\s+/g, "")
                .replace(/(已读|未读|草稿|新消息|对方正在输入)/g, "")
                .slice(0, 180);
              const personName = (value) => {
                const key = compact(value);
                const match = key.match(/^([\u4e00-\u9fffA-Za-z·]{2,8})/);
                return match ? match[1] : "";
              };
              const excludedKeys = (excluded || []).filter(Boolean);
              const excludedNames = excludedKeys.map(personName).filter(Boolean);
              const excludedPrefixes = excludedKeys.map((item) => item.slice(0, 32)).filter((item) => item.length >= 6);
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 35 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.03;
              };
              const rawRows = Array.from(document.body ? document.body.querySelectorAll(
                ".geek-item-wrap, .geek-item, [class*='geek-item-wrap'], [class*='geek-item']"
              ) : []);
              const rows = rawRows.filter((row) => {
                if (!visible(row)) return false;
                if (!String(row.className || "").includes("geek-item-wrap") && row.closest(".geek-item-wrap")) return false;
                const box = row.getBoundingClientRect();
                return box.x < Math.min(680, window.innerWidth * 0.48) && box.bottom > 40 && box.y < window.innerHeight - 12;
              });
              let best = null;
              let bestScore = -9999;
              for (const row of rows) {
                const text = normalize(row.innerText || row.textContent || "");
                if (!text || text.length < 4) continue;
                if (text.includes("全部") && text.includes("未读") && text.includes("新招呼")) continue;
                const rowKey = compact(text);
                const rowName = personName(text);
                const rowPrefix = rowKey.slice(0, 32);
                if (excludedKeys.some((item) => item && (rowKey.includes(item) || item.includes(rowKey.slice(0, 60))))) continue;
                if (rowName && excludedNames.includes(rowName)) continue;
                if (rowPrefix && excludedPrefixes.some((prefix) => prefix && rowPrefix.includes(prefix))) continue;
                const box = row.getBoundingClientRect();
                let unread = 0;
                const match = text.match(/^(\d{1,3})\s+/);
                if (match) unread = Number(match[1]) || 0;
                let score = 1000 - box.y;
                if (unread) score += unread * 12;
                if (/selected/.test(String(row.className || ""))) score += 2;
                if (score > bestScore) {
                  bestScore = score;
                  best = { row, label: text, unread, x: box.x, y: box.y, w: box.width, h: box.height };
                }
              }
              if (!best) return null;
              best.row.setAttribute("data-codex-recruiter-recent", token);
              return {
                label: best.label,
                unread: best.unread,
                x: Math.round(best.x),
                y: Math.round(best.y),
                w: Math.round(best.w),
                h: Math.round(best.h),
                score: Math.round(bestScore)
              };
            }""",
            {"token": token, "excluded": excluded},
        )
    except Exception:
        return None
    if not isinstance(info, dict) or not info:
        return None
    info["locator"] = page.locator(f"[data-codex-recruiter-recent='{token}']").first
    return info


def find_recruiter_candidate_by_identity(
    terminal: BrowserTerminal,
    pending: dict,
    scroll_attempts: int = 4,
) -> dict | None:
    page = terminal.current_page()
    identity = pending.get("candidateIdentity") if isinstance(pending.get("candidateIdentity"), dict) else {}
    name = str(pending.get("candidateName") or identity.get("candidateName") or "").strip()
    position = str(pending.get("appliedPosition") or identity.get("appliedPosition") or "").strip()
    label = str(pending.get("candidateLabel") or identity.get("listLabel") or "").strip()
    compact_label = compact_conversation_label(label)
    if not (name or position or compact_label):
        return None

    def search_visible() -> dict | None:
        token = f"codex_recruiter_identity_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        try:
            info = page.evaluate(
                r"""({ token, name, position, compactLabel }) => {
                  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
                  const compact = (value) => normalize(value)
                    .replace(/^\d{1,3}\s+(?=\d{1,2}:\d{2})/, "")
                    .replace(/^\d{1,2}:\d{2}\s*/, "")
                    .replace(/\s+/g, "")
                    .slice(0, 180);
                  const visible = (el) => {
                    const box = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return box.width > 80 && box.height > 35 && box.bottom > 0 && box.y < window.innerHeight + 120
                      && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.03;
                  };
                  const rows = Array.from(document.body ? document.body.querySelectorAll(
                    ".geek-item-wrap, .geek-item, [class*='geek-item'], [class*='listitem']"
                  ) : []);
                  let best = null;
                  let bestScore = -9999;
                  const wantLabel = String(compactLabel || "");
                  const wantPrefix = wantLabel.slice(0, 70);
                  for (const row of rows) {
                    if (!visible(row)) continue;
                    const box = row.getBoundingClientRect();
                    if (box.x > Math.min(700, window.innerWidth * 0.52) || box.bottom < 40 || box.y > window.innerHeight - 12) continue;
                    const text = normalize(row.innerText || row.textContent || "");
                    const key = compact(text);
                    if (!text || (!name && !position && !wantPrefix)) continue;
                    let score = 0;
                    if (name && key.includes(String(name).replace(/\s+/g, ""))) score += 520;
                    if (position && key.includes(String(position).replace(/\s+/g, ""))) score += 360;
                    if (wantPrefix && (key.includes(wantPrefix) || wantPrefix.includes(key.slice(0, 60)))) score += 520;
                    if (wantLabel && key === wantLabel) score += 260;
                    score -= Math.max(0, box.y - 140) / 8;
                    if (score < 500) continue;
                    const clickable = row.closest(".geek-item-wrap") || row.closest(".geek-item") || row;
                    if (score > bestScore) {
                      bestScore = score;
                      best = { row: clickable, label: text, score, x: box.x, y: box.y, w: box.width, h: box.height };
                    }
                  }
                  if (!best) return null;
                  best.row.setAttribute("data-codex-recruiter-identity", token);
                  return {
                    label: best.label,
                    score: Math.round(best.score),
                    x: Math.round(best.x),
                    y: Math.round(best.y),
                    w: Math.round(best.w),
                    h: Math.round(best.h)
                  };
                }""",
                {
                    "token": token,
                    "name": name,
                    "position": position,
                    "compactLabel": compact_label,
                },
            )
        except Exception:
            return None
        if not isinstance(info, dict) or not info:
            return None
        info["locator"] = page.locator(f"[data-codex-recruiter-identity='{token}']").first
        return info

    found = search_visible()
    if found:
        return found
    for _ in range(max(0, int(scroll_attempts or 0))):
        scrolled = scroll_recruiter_candidate_list(terminal)
        if not scrolled.get("scrolled"):
            break
        page.wait_for_timeout(random.randint(260, 520))
        found = search_visible()
        if found:
            return found
    return None


def find_recruiter_candidate_by_name(
    terminal: BrowserTerminal,
    candidate_name: str,
    scroll_attempts: int = 0,
) -> dict | None:
    name = clean_recruiter_candidate_name(candidate_name)
    if not name:
        return None
    page = terminal.current_page()

    def direct_scroll_list(amount: int = 0, to_top: bool = False) -> bool:
        try:
            result = page.evaluate(
                r"""({ amount, toTop }) => {
                  const visible = (el) => {
                    if (!el) return false;
                    const box = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return box.width >= 180 && box.height >= 120 && box.bottom > 0 && box.y < window.innerHeight
                      && box.x < Math.min(720, window.innerWidth * 0.55)
                      && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.03;
                  };
                  const candidates = Array.from(document.querySelectorAll(
                    ".user-list-content,.user-list,.chat-content,.chat-user,.list-warp,[class*='user-list' i],[class*='friend-list' i],[class*='session-list' i],[class*='geek-list' i]"
                  )).filter((el) => visible(el) && el.scrollHeight > el.clientHeight + 30);
                  let container = candidates.find((el) => /user-list|b-scroll|geek-list|session-list/i.test(String(el.className || "")))
                    || candidates[0]
                    || null;
                  if (!container) return { scrolled: false, reason: "no_container" };
                  const before = container.scrollTop || 0;
                  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                  const next = toTop ? 0 : Math.max(0, Math.min(maxTop, before + Number(amount || 0)));
                  container.scrollTop = next;
                  return {
                    scrolled: Math.abs((container.scrollTop || 0) - before) > 3,
                    before: Math.round(before),
                    after: Math.round(container.scrollTop || 0),
                    maxTop: Math.round(maxTop)
                  };
                }""",
                {"amount": amount, "toTop": to_top},
            )
            return bool(isinstance(result, dict) and (result.get("scrolled") or result.get("after") == 0 and to_top))
        except Exception:
            return False

    def search_visible() -> dict | None:
        token = f"codex_recruiter_candidate_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        try:
            info = page.evaluate(
                r"""({ token, name }) => {
                  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
                  const compact = (value) => normalize(value).replace(/\s+/g, "");
                  const visible = (el) => {
                    const box = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return box.width > 80 && box.height > 35 && box.bottom > 0 && box.y < window.innerHeight + 160
                      && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
                  };
                  const rows = Array.from(document.body ? document.body.querySelectorAll(
                    ".geek-item-wrap, .geek-item, [class*='geek-item'], [class*='listitem']"
                  ) : []);
                  let best = null;
                  let bestScore = -9999;
                  for (const row of rows) {
                    if (!visible(row)) continue;
                    const box = row.getBoundingClientRect();
                    if (box.x > Math.min(680, window.innerWidth * 0.48) || box.bottom < 40 || box.y > window.innerHeight - 12) continue;
                    const text = normalize(row.innerText || row.textContent || "");
                    if (!text) continue;
                    const compactText = compact(text);
                    if (!compactText.includes(name)) continue;
                    let score = 1000 - Math.max(0, box.y);
                    if (text.includes(name)) score += 240;
                    if (/geek-item-wrap/.test(String(row.className || ""))) score += 80;
                    if (/selected/.test(String(row.className || ""))) score += 30;
                    const clickable = row.closest(".geek-item-wrap") || row.closest(".geek-item") || row;
                    if (score > bestScore) {
                      bestScore = score;
                      best = { row: clickable, label: text, x: box.x, y: box.y, w: box.width, h: box.height };
                    }
                  }
                  if (!best) return null;
                  best.row.setAttribute("data-codex-recruiter-candidate", token);
                  return {
                    label: best.label,
                    matchedName: name,
                    x: Math.round(best.x),
                    y: Math.round(best.y),
                    w: Math.round(best.w),
                    h: Math.round(best.h)
                  };
                }""",
                {"token": token, "name": name},
            )
        except Exception:
            return None
        if not isinstance(info, dict) or not info:
            return None
        info["locator"] = page.locator(f"[data-codex-recruiter-candidate='{token}']").first
        return info

    found = search_visible()
    if found or scroll_attempts <= 0:
        return found

    scroll_recruiter_candidate_list_to_top(terminal)
    direct_scroll_list(to_top=True)
    page.wait_for_timeout(random.randint(220, 380))

    for _ in range(max(1, scroll_attempts)):
        found = search_visible()
        if found:
            return found
        scrolled = scroll_recruiter_candidate_list(terminal)
        if not scrolled.get("scrolled"):
            if not direct_scroll_list(amount=random.randint(460, 680)):
                break
            page.wait_for_timeout(random.randint(260, 430))
    return search_visible()


def read_recruiter_selected_candidate(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    try:
        info = page.evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                if (!el) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 35 && box.bottom > 0 && box.y < window.innerHeight
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
                .filter(visible)
                .map((el) => normalize(el.innerText || el.textContent || ""))
                .find(Boolean) || "";
              const chatHeader = Array.from(document.querySelectorAll(
                ".base-info-single-top-detail, .base-info-single-top, .conversation-main"
              )).map((el) => normalize(el.innerText || el.textContent || ""))
                .find(text => text && /(在线简历|附件简历|沟通职位|牛人分析器)/.test(text)) || "";
              const headerNameMatch = chatHeader.match(/^([\u4e00-\u9fffA-Za-z·]{2,10})\s/);
              const headerName = headerNameMatch ? headerNameMatch[1] : "";
              const profile = Array.from(document.querySelectorAll(".geek-name, .name, [class*='geek'] [class*='name']"))
                .map((el) => normalize(el.innerText || el.textContent || ""))
                .find(text => text && !/(宋峰峰|个人中心|账号权益|我的客服)/.test(text)) || "";
              return { label: selected || chatHeader || profile, name: headerName || "" };
            }"""
        )
    except Exception as error:
        return {"label": "", "error": str(error)}
    return info if isinstance(info, dict) else {"label": ""}


def find_recruiter_request_resume_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_request_resume_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const nodes = Array.from(document.body ? document.body.querySelectorAll(
                ".operate-icon-item, .operate-btn, [class*='operate'], button, [role='button']"
              ) : []);
              let best = null;
              let bestScore = -9999;
              for (const node of nodes) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute("title") || node.getAttribute("aria-label") || "");
                if (text !== "\u6c42\u7b80\u5386" && !text.includes("\u6c42\u7b80\u5386")) continue;
                const box = node.getBoundingClientRect();
                let score = 0;
                if (text === "\u6c42\u7b80\u5386") score += 120;
                if (box.x > window.innerWidth * 0.45 && box.y > window.innerHeight * 0.55) score += 80;
                if (/operate-icon-item|operate-btn/.test(String(node.className || ""))) score += 60;
                score -= Math.max(0, text.length - 3) * 6;
                const target = node.closest(".operate-icon-item") || node.closest(".operate-btn") || node;
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, target, text, box };
                }
              }
              if (!best) return { found: false };
              const target = best.target;
              target.setAttribute("data-codex-request-resume", token);
              const chain = [];
              let cur = target;
              for (let i = 0; cur && i < 4; i += 1, cur = cur.parentElement) {
                chain.push(normalize([
                  cur.tagName,
                  cur.id,
                  cur.className,
                  cur.getAttribute("title"),
                  cur.getAttribute("aria-label"),
                  cur.getAttribute("disabled"),
                  cur.getAttribute("aria-disabled")
                ].join(" ")));
              }
              const chainText = chain.join(" | ");
              const disabled = /disabled|unable|forbid|disable|\u7981\u7528|\u5df2\u53d1\u9001/i.test(chainText)
                || target.disabled === true
                || target.getAttribute("disabled") !== null
                || target.getAttribute("aria-disabled") === "true"
                || window.getComputedStyle(target).pointerEvents === "none";
              const reason = disabled ? (chain.find((part) => /disabled|unable|已发送|禁用/i.test(part)) || chainText) : chainText;
              const box = target.getBoundingClientRect();
              return {
                found: true,
                label: best.text || "\u6c42\u7b80\u5386",
                disabled,
                reason,
                debugReason: chainText,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    info["locator"] = page.locator(f"[data-codex-request-resume='{token}']").first
    return info


def find_recruiter_unsuitable_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_mark_unsuitable_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const nodes = Array.from(document.body ? document.body.querySelectorAll(
                ".operate-icon-item, .operate-btn, [class*='operate'], button, [role='button'], span, div"
              ) : []);
              let best = null;
              let bestScore = -9999;
              for (const node of nodes) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute("title") || node.getAttribute("aria-label") || "");
                if (text !== "\u4e0d\u5408\u9002" && !text.includes("\u4e0d\u5408\u9002")) continue;
                const box = node.getBoundingClientRect();
                let score = 0;
                if (text === "\u4e0d\u5408\u9002") score += 160;
                if (box.x > window.innerWidth * 0.70 && box.y > window.innerHeight * 0.55) score += 110;
                if (/operate-exchange-right|operate-icon-item|operate-btn/.test(String(node.className || ""))) score += 80;
                if (box.width > 120 || box.height > 60) score -= 80;
                score -= Math.max(0, text.length - 3) * 8;
                const target = node.closest(".operate-icon-item") || node.closest(".operate-exchange-right") || node.closest(".operate-btn") || node;
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, target, text, box };
                }
              }
              if (!best) return { found: false };
              const target = best.target;
              target.setAttribute("data-codex-mark-unsuitable", token);
              const chain = [];
              let cur = target;
              for (let i = 0; cur && i < 4; i += 1, cur = cur.parentElement) {
                chain.push(normalize([
                  cur.tagName,
                  cur.id,
                  cur.className,
                  cur.getAttribute("title"),
                  cur.getAttribute("aria-label"),
                  cur.getAttribute("disabled"),
                  cur.getAttribute("aria-disabled")
                ].join(" ")));
              }
              const chainText = chain.join(" | ");
              const disabled = /disabled|unable|forbid|disable|\u7981\u7528/i.test(chainText)
                || target.disabled === true
                || target.getAttribute("disabled") !== null
                || target.getAttribute("aria-disabled") === "true"
                || window.getComputedStyle(target).pointerEvents === "none";
              const box = target.getBoundingClientRect();
              return {
                found: true,
                label: best.text || "\u4e0d\u5408\u9002",
                disabled,
                reason: chainText,
                debugReason: chainText,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    info["locator"] = page.locator(f"[data-codex-mark-unsuitable='{token}']").first
    return info


def find_recruiter_resume_final_confirm_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_request_resume_confirm_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const confirmHints = [
                "\u786e\u5b9a\u5411\u725b\u4eba\u8bf7\u6c42\u7b80\u5386",
                "\u786e\u5b9a\u5411\u725b\u4eba\u7d22\u8981\u7b80\u5386",
                "\u786e\u5b9a\u5411\u725b\u4eba\u7d22\u53d6\u7b80\u5386",
                "\u8bf7\u6c42\u7b80\u5386",
                "\u7d22\u8981\u7b80\u5386",
                "\u7d22\u53d6\u7b80\u5386",
                "\u65b9\u4fbf\u53d1\u4e00\u4efd\u4f60\u7684\u7b80\u5386\u8fc7\u6765\u5417"
              ];
              const bodyText = normalize(document.body ? document.body.innerText : "");
              const tooltips = Array.from(document.body ? document.body.querySelectorAll(
                ".exchange-tooltip, .boss-popup, .dialog, .modal, .tooltip, .popover, [class*='exchange-tooltip'], [class*='popup'], [class*='dialog'], [class*='modal'], [class*='tooltip'], [class*='popover']"
              ) : [])
                .filter((el) => visible(el) && confirmHints.some((hint) => normalize(el.innerText || el.textContent || "").includes(hint)));
              let target = null;
              let containerText = "";
              for (const tip of tooltips) {
                containerText = normalize(tip.innerText || tip.textContent || "");
                const buttons = Array.from(tip.querySelectorAll(".boss-btn-primary, .boss-btn, button, [role='button'], span, div"));
                target = buttons
                  .filter((el) => visible(el) && ["\u786e\u5b9a", "\u786e\u8ba4"].includes(normalize(el.innerText || el.textContent || "")))
                  .sort((a, b) => {
                    const score = (el) => {
                      const box = el.getBoundingClientRect();
                      const meta = String(el.className || "") + " " + String(el.tagName || "");
                      let value = 0;
                      if (/primary|boss-btn|button|btn/i.test(meta)) value += 80;
                      if (box.width >= 36 && box.width <= 140 && box.height >= 22 && box.height <= 60) value += 30;
                      value += box.x / 1000;
                      return value;
                    };
                    return score(b) - score(a);
                  })[0] || null;
                if (target) break;
              }
              if (!target && confirmHints.some((hint) => bodyText.includes(hint))) {
                const buttons = Array.from(document.body ? document.body.querySelectorAll(
                  ".boss-btn-primary, .boss-btn, button, [role='button'], span, div"
                ) : []);
                target = buttons
                  .filter((el) => visible(el) && ["\u786e\u5b9a", "\u786e\u8ba4"].includes(normalize(el.innerText || el.textContent || "")))
                  .sort((a, b) => {
                    const score = (el) => {
                      const box = el.getBoundingClientRect();
                      const meta = String(el.className || "") + " " + String(el.tagName || "");
                      let value = 0;
                      if (/primary|boss-btn|button|btn/i.test(meta)) value += 120;
                      if (box.x > window.innerWidth * 0.45) value += 40;
                      if (box.y > window.innerHeight * 0.25) value += 20;
                      if (box.width >= 36 && box.width <= 140 && box.height >= 22 && box.height <= 60) value += 30;
                      return value;
                    };
                    return score(b) - score(a);
                  })[0] || null;
                containerText = bodyText.includes("\u786e\u5b9a\u5411\u725b\u4eba\u8bf7\u6c42\u7b80\u5386")
                  ? "\u786e\u5b9a\u5411\u725b\u4eba\u8bf7\u6c42\u7b80\u5386"
                  : bodyText.includes("\u786e\u5b9a\u5411\u725b\u4eba\u7d22\u8981\u7b80\u5386")
                    ? "\u786e\u5b9a\u5411\u725b\u4eba\u7d22\u8981\u7b80\u5386"
                  : confirmHints.find((hint) => bodyText.includes(hint)) || "";
              }
              if (!target) return { found: false, reason: containerText || "" };
              target.setAttribute("data-codex-request-resume-confirm", token);
              const box = target.getBoundingClientRect();
              return {
                found: true,
                label: "\u786e\u5b9a",
                reason: containerText,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    info["locator"] = page.locator(f"[data-codex-request-resume-confirm='{token}']").first
    return info


def find_recruiter_incoming_resume_consent_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_incoming_resume_consent_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const hasConsentText = (el) => {
                const text = normalize(el && (el.innerText || el.textContent || ""));
                return text.includes("对方想发送附件简历给您") && text.includes("是否同意");
              };
              const buttons = Array.from(document.body ? document.body.querySelectorAll(
                "a, button, [role='button'], .boss-btn, .btn, span, div"
              ) : []);
              let best = null;
              let bestScore = -9999;
              for (const node of buttons) {
                if (!visible(node)) continue;
                const label = normalize(node.innerText || node.textContent || node.getAttribute("title") || node.getAttribute("aria-label") || "");
                if (label !== "同意") continue;
                let card = null;
                let cur = node;
                for (let depth = 0; cur && depth < 9; depth += 1, cur = cur.parentElement) {
                  if (cur === document.body || cur === document.documentElement) break;
                  if (hasConsentText(cur)) {
                    const text = normalize(cur.innerText || cur.textContent || "");
                    const box = cur.getBoundingClientRect();
                    if (text.length > 1200 || box.width > window.innerWidth * 0.82 || box.height > window.innerHeight * 0.58) {
                      continue;
                    }
                    card = cur;
                    break;
                  }
                }
                if (!card) continue;
                const buttonBox = node.getBoundingClientRect();
                const cardBox = card.getBoundingClientRect();
                const cardText = normalize(card.innerText || card.textContent || "");
                let score = 1000;
                if (/boss-btn|btn|button/i.test(String(node.className || node.tagName || ""))) score += 90;
                if (buttonBox.x > cardBox.x + cardBox.width * 0.45) score += 50;
                if (cardText.length <= 180) score += 120;
                else if (cardText.length <= 520) score += 55;
                else score -= Math.min(220, Math.floor(cardText.length / 20));
                if (cardBox.x > window.innerWidth * 0.32) score += 40;
                if (cardBox.width >= 160 && cardBox.width <= 760 && cardBox.height >= 45 && cardBox.height <= 260) score += 55;
                score += Math.round(buttonBox.y / 8);
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, card, label, buttonBox, cardBox, cardText };
                }
              }
              if (!best) {
                const bodyText = normalize(document.body ? document.body.innerText : "");
                return {
                  found: false,
                  reason: bodyText.includes("对方想发送附件简历给您") && bodyText.includes("是否同意")
                    ? "consent_text_found_without_clickable_agree"
                    : ""
                };
              }
              best.node.setAttribute("data-codex-incoming-resume-consent", token);
              return {
                found: true,
                label: best.label || "同意",
                reason: best.cardText.slice(0, 220),
                score: bestScore,
                token,
                x: Math.round(best.buttonBox.x),
                y: Math.round(best.buttonBox.y),
                w: Math.round(best.buttonBox.width),
                h: Math.round(best.buttonBox.height),
                card: {
                  x: Math.round(best.cardBox.x),
                  y: Math.round(best.cardBox.y),
                  w: Math.round(best.cardBox.width),
                  h: Math.round(best.cardBox.height)
                }
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    info["locator"] = page.locator(f"[data-codex-incoming-resume-consent='{token}']").first
    return info


def accept_recruiter_incoming_resume_consent_if_present(
    terminal: BrowserTerminal,
    candidate_label: str = "",
) -> dict:
    button = find_recruiter_incoming_resume_consent_button(terminal)
    if not isinstance(button, dict) or not button.get("found"):
        return button if isinstance(button, dict) else {"found": False}
    locator = button.get("locator")
    if locator is None:
        return {
            **{k: v for k, v in button.items() if k != "locator"},
            "blocked": True,
            "error": "missing_locator",
        }
    page = terminal.current_page()
    clicked = False
    click_error = ""
    try:
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        try:
            humanized_precise_button_click(terminal, locator, force=True)
        except Exception:
            token = str(button.get("token") or "")
            clicked = bool(page.evaluate(
                r"""(token) => {
                  const target = token ? document.querySelector(`[data-codex-incoming-resume-consent="${token}"]`) : null;
                  if (!target) return false;
                  target.click();
                  return true;
                }""",
                token,
            ))
            if not clicked:
                raise
        else:
            clicked = True
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        page.wait_for_timeout(random.randint(520, 860))
    except Exception as error:
        click_error = str(error)
        token = str(button.get("token") or "")
        try:
            clicked = bool(page.evaluate(
                r"""(token) => {
                  const target = token ? document.querySelector(`[data-codex-incoming-resume-consent="${token}"]`) : null;
                  if (!target) return false;
                  target.click();
                  return true;
                }""",
                token,
            ))
            if clicked:
                page.wait_for_timeout(random.randint(420, 720))
        except Exception as fallback_error:
            click_error = f"{click_error}; fallback={fallback_error}"
    cleaned = {k: v for k, v in button.items() if k != "locator"}
    if not clicked:
        return {
            **cleaned,
            "blocked": True,
            "error": safe_text(click_error or "click_failed", 220),
        }
    after = inspect_recruiter_resume_request_state(terminal)
    return {
        **cleaned,
        "clicked": True,
        "candidate": safe_text(candidate_label, 120),
        "after": after,
    }


def inspect_recruiter_resume_request_state(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    try:
        return page.evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 80 && box.height > 40 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const selectors = [
                ".chat-message", ".message-list", ".chat-detail", ".dialog-content", ".conversation-content",
                "[class*='message' i]", "[class*='chat' i]", "[class*='dialog' i]", "[class*='conversation' i]"
              ].join(",");
              const nodes = Array.from(document.body ? document.body.querySelectorAll(selectors) : []);
              const vw = window.innerWidth || 1280;
              let best = null;
              let bestScore = -9999;
              for (const el of nodes) {
                if (!visible(el)) continue;
                const box = el.getBoundingClientRect();
                if (box.x < vw * 0.32) continue;
                const text = normalize(el.innerText || el.textContent || "");
                if (text.length < 8) continue;
                let score = Math.min(text.length, 2600) / 20;
                if (box.width > 320 && box.height > 180) score += 100;
                if (/message|chat|dialog|conversation/i.test(String(el.className || ""))) score += 45;
                if (text.includes("发送") || text.includes("求简历") || text.includes("简历请求")) score += 20;
                if (score > bestScore) {
                  best = { text, score, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) };
                  bestScore = score;
                }
              }
              const detailText = best ? best.text : normalize(document.body ? document.body.innerText : "");
              const alreadyTerms = [
                "简历请求已发送",
                "已发送简历请求",
                "方便发一份你的简历过来吗",
                "方便发一份您 的简历过来吗",
                "方便发一份您的简历过来吗",
                "已请求简历",
                "已求简历"
              ];
              const resumeAttachment = /[\u4e00-\u9fffA-Za-z0-9_\-（）()]+简历[^\\s]{0,24}\\.(pdf|docx?|PDF|DOCX?)/.test(detailText)
                || /简历\\s*\\([^)]*\\)\\.pdf/i.test(detailText)
                || /[\u4e00-\u9fffA-Za-z0-9_\-（）()]+\\.(pdf|docx?|PDF|DOCX?)/.test(detailText)
                || detailText.includes("点击预览附件简历");
              const alreadyRequested = alreadyTerms.some((term) => detailText.includes(term));
              const matchedTerms = alreadyTerms.filter((term) => detailText.includes(term));
              if (resumeAttachment) matchedTerms.push("resume_attachment_visible");
              return {
                alreadyRequested,
                hasResumeAttachment: resumeAttachment,
                matchedTerms,
                summary: matchedTerms.join(" / ") || detailText.slice(-260),
                source: best ? "chat-detail" : "body",
                box: best ? { x: best.x, y: best.y, w: best.w, h: best.h } : null
              };
            }"""
        ) or {}
    except Exception as error:
        return {"alreadyRequested": False, "error": str(error)}


def wait_for_recruiter_resume_final_confirm_button(terminal: BrowserTerminal, attempts: int = 8) -> dict:
    button: dict = {"found": False}
    for _ in range(max(1, attempts)):
        button = find_recruiter_resume_final_confirm_button(terminal)
        if isinstance(button, dict) and button.get("found"):
            return button
        try:
            terminal.current_page().wait_for_timeout(random.randint(220, 420))
        except Exception:
            break
    return button if isinstance(button, dict) else {"found": False}


def close_recruiter_resume_confirm_tooltip(terminal: BrowserTerminal) -> bool:
    page = terminal.current_page()
    try:
        return bool(page.evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const nodes = Array.from(document.querySelectorAll(".exchange-tooltip .boss-btn, .boss-btn, span, button"));
              const target = nodes.find((el) => normalize(el.innerText || el.textContent || "") === "\u53d6\u6d88");
              if (!target) return false;
              target.click();
              return true;
            }"""
        ))
    except Exception:
        return False
