

def find_recruiter_unsuitable_final_confirm_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_unsuitable_confirm_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
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
              const containers = Array.from(document.body ? document.body.querySelectorAll(
                ".boss-popup, .dialog, .modal, .tooltip, .popover, [class*='popup'], [class*='dialog'], [class*='modal'], [class*='tooltip'], [class*='popover']"
              ) : []).filter((el) => visible(el));
              let target = null;
              let containerText = "";
              for (const box of containers) {
                const text = normalize(box.innerText || box.textContent || "");
                if (!text.includes("\u4e0d\u5408\u9002")) continue;
                containerText = text;
                const buttons = Array.from(box.querySelectorAll(".boss-btn-primary, .boss-btn, button, [role='button'], span, div"));
                target = buttons.find((el) => {
                  if (!visible(el)) return false;
                  const label = normalize(el.innerText || el.textContent || "");
                  return (label === "\u786e\u5b9a" || label === "\u786e\u8ba4" || label.includes("\u786e\u5b9a")) && /primary|boss-btn|button|btn/i.test(String(el.className || el.tagName));
                });
                if (target) break;
              }
              if (!target) return { found: false, reason: containerText || "" };
              target.setAttribute("data-codex-unsuitable-confirm", token);
              const rect = target.getBoundingClientRect();
              return {
                found: true,
                label: normalize(target.innerText || target.textContent || "\u786e\u5b9a"),
                reason: containerText,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height)
              };
            }""",
            {"token": token},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    info["locator"] = page.locator(f"[data-codex-unsuitable-confirm='{token}']").first
    return info


def close_recruiter_unsuitable_confirm_dialog(terminal: BrowserTerminal) -> bool:
    page = terminal.current_page()
    try:
        return bool(page.evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const containers = Array.from(document.querySelectorAll(
                ".boss-popup, .dialog, .modal, .tooltip, .popover, [class*='popup'], [class*='dialog'], [class*='modal'], [class*='tooltip'], [class*='popover']"
              )).filter((el) => visible(el) && normalize(el.innerText || el.textContent || "").includes("\u4e0d\u5408\u9002"));
              for (const box of containers) {
                const nodes = Array.from(box.querySelectorAll(".boss-btn, button, [role='button'], span, div"));
                const target = nodes.find((el) => {
                  const label = normalize(el.innerText || el.textContent || "");
                  return visible(el) && (label === "\u53d6\u6d88" || label === "\u5173\u95ed" || label === "\u6682\u4e0d");
                });
                if (target) {
                  target.click();
                  return true;
                }
              }
              return false;
            }"""
        ))
    except Exception:
        return False


def inspect_recruiter_unsuitable_after_click(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    try:
        return page.evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const text = normalize(document.body ? document.body.innerText : "");
              const containers = Array.from(document.querySelectorAll(
                ".boss-popup, .dialog, .modal, .tooltip, .popover, [class*='popup'], [class*='dialog'], [class*='modal'], [class*='tooltip'], [class*='popover']"
              )).filter((el) => visible(el));
              const confirm = containers.map((el) => normalize(el.innerText || el.textContent || ""))
                .find((value) => value.includes("\u4e0d\u5408\u9002") && (value.includes("\u786e\u5b9a") || value.includes("\u786e\u8ba4") || value.includes("\u53d6\u6d88")));
              const doneTerms = ["\u5df2\u6807\u8bb0\u4e0d\u5408\u9002", "\u4e0d\u5408\u9002\u5df2\u5904\u7406", "\u5df2\u79fb\u5165\u4e0d\u5408\u9002"];
              return {
                needsFollowup: Boolean(confirm),
                doneLike: doneTerms.some((term) => text.includes(term)),
                summary: confirm || doneTerms.filter((term) => text.includes(term)).join(" / ") || text.slice(-260)
              };
            }"""
        ) or {}
    except Exception as error:
        return {"error": str(error)}


def inspect_recruiter_resume_request_after_click(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    try:
        return page.evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const text = normalize(document.body ? document.body.innerText : "");
              const sentTerms = ["\u7b80\u5386\u8bf7\u6c42\u5df2\u53d1\u9001", "\u5df2\u53d1\u9001\u7b80\u5386\u8bf7\u6c42"];
              const confirmTexts = [
                "\u786e\u5b9a\u5411\u725b\u4eba\u8bf7\u6c42\u7b80\u5386",
                "\u786e\u5b9a\u5411\u725b\u4eba\u7d22\u8981\u7b80\u5386",
                "\u786e\u5b9a\u5411\u725b\u4eba\u7d22\u53d6\u7b80\u5386",
                "\u7d22\u8981\u7b80\u5386",
                "\u7d22\u53d6\u7b80\u5386"
              ];
              const confirmText = confirmTexts.find((value) => text.includes(value)) || "";
              const needsConfirm = Boolean(confirmText) && text.includes("\u53d6\u6d88") && text.includes("\u786e\u5b9a");
              const summary = sentTerms.filter((term) => text.includes(term)).join(" / ")
                || (needsConfirm ? `${confirmText}\uff0c\u5e76\u56de\u590d\u5185\u5bb9\uff1a\u201c\u65b9\u4fbf\u53d1\u4e00\u4efd\u4f60\u7684\u7b80\u5386\u8fc7\u6765\u5417\uff1f\u201d` : "");
              return {
                sentLike: sentTerms.some((term) => text.includes(term)),
                needsFollowup: needsConfirm && !sentTerms.some((term) => text.includes(term)),
                summary: summary || text.slice(-260)
              };
            }"""
        ) or {}
    except Exception as error:
        return {"error": str(error)}


def inspect_chat_resume_after_click(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    try:
        return page.evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const text = normalize(document.body ? document.body.innerText : "");
              const terms = [
                "\u53d1\u9001\u7b80\u5386",
                "\u786e\u8ba4\u53d1\u9001",
                "\u9009\u62e9\u7b80\u5386",
                "\u4f7f\u7528\u6b64\u7b80\u5386",
                "\u9644\u4ef6\u7b80\u5386",
                "\u7b80\u5386\u8bf7\u6c42\u5df2\u53d1\u9001"
              ];
              const summary = terms.filter((term) => text.includes(term)).join(" / ");
              return {
                needsFollowup: terms.slice(0, 4).some((term) => text.includes(term)),
                sentLike: terms.slice(4).some((term) => text.includes(term)),
                summary: summary || text.slice(-260)
              };
            }"""
        ) or {}
    except Exception as error:
        return {"error": str(error)}


def mark_current_chat_send_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    marker = f"codex-send-{int(time.time() * 1000)}-{random.randint(1000, 9999)}"
    try:
        result = page.evaluate(
            r"""(marker) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 0 && box.height > 0
                  && style.display !== "none"
                  && style.visibility !== "hidden"
                  && style.opacity !== "0";
              };
              const editables = Array.from(document.querySelectorAll("textarea,input,[contenteditable=true],[role='textbox']"))
                .filter(visible)
                .map((el) => ({ el, box: el.getBoundingClientRect(), text: normalize(el.value || el.innerText || el.textContent || "") }))
                .sort((a, b) => b.box.y - a.box.y);
              const input = editables[0] || null;
              const inputBox = input ? input.box : null;
              const nodes = Array.from(document.querySelectorAll("button,[role='button'],input[type='button'],input[type='submit'],a,span,div"));
              const candidates = nodes
                .filter(visible)
                .map((el) => {
                  const box = el.getBoundingClientRect();
                  const text = normalize(el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.title || "");
                  const className = String(el.className || "");
                  return { el, box, text, className };
                })
                .filter((item) => item.text.length <= 16 && item.box.width <= 260 && item.box.height <= 120)
                .filter((item) => item.text === "发送" || item.text.toLowerCase() === "send" || item.text.endsWith("发送") || item.className.includes("send"));

              let best = null;
              let bestScore = -Infinity;
              for (const item of candidates) {
                let score = 0;
                if (item.text === "发送") score += 100;
                if (/send|btn|button/i.test(item.className)) score += 25;
                if (inputBox) {
                  if (item.box.y >= inputBox.y - 60 && item.box.y <= inputBox.y + inputBox.height + 80) score += 100;
                  if (item.box.x >= inputBox.x + inputBox.width * 0.55) score += 60;
                  score -= Math.abs((item.box.y + item.box.height / 2) - (inputBox.y + inputBox.height / 2)) / 6;
                }
                score += item.box.x / 1000;
                if (score > bestScore) {
                  best = item;
                  bestScore = score;
                }
              }
              if (!best) return { found: false, marker, reason: "no_send_button" };
              best.el.setAttribute("data-codex-send-button", marker);
              return {
                found: true,
                marker,
                label: best.text || "发送",
                x: Math.round(best.box.x),
                y: Math.round(best.box.y),
                w: Math.round(best.box.width),
                h: Math.round(best.box.height),
                inputText: input ? input.text : ""
              };
            }""",
            marker,
        ) or {}
    except Exception as error:
        return {"found": False, "marker": marker, "reason": safe_text(str(error), 160)}
    if result.get("found"):
        result["selector"] = f"[data-codex-send-button='{marker}']"
    return result


def current_chat_editor_text(terminal: BrowserTerminal) -> str:
    try:
        return str(terminal.current_page().evaluate(
            r"""() => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 0 && box.height > 0
                  && style.display !== "none"
                  && style.visibility !== "hidden"
                  && style.opacity !== "0";
              };
              const input = Array.from(document.querySelectorAll("textarea,input,[contenteditable=true],[role='textbox']"))
                .filter(visible)
                .sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y)[0];
              return input ? normalize(input.value || input.innerText || input.textContent || "") : "";
            }"""
        ) or "")
    except Exception:
        return ""


def focus_current_chat_editor(terminal: BrowserTerminal) -> bool:
    try:
        return bool(terminal.current_page().evaluate(
            r"""() => {
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 0 && box.height > 0
                  && style.display !== "none"
                  && style.visibility !== "hidden"
                  && style.opacity !== "0";
              };
              const input = Array.from(document.querySelectorAll("textarea,input,[contenteditable=true],[role='textbox']"))
                .filter(visible)
                .sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y)[0];
              if (!input) return false;
              input.focus();
              return true;
            }"""
        ))
    except Exception:
        return False


def click_current_chat_send_button(terminal: BrowserTerminal) -> dict:
    marked = mark_current_chat_send_button(terminal)
    selector = str(marked.get("selector") or "")
    if not selector:
        return {
            "blocked": True,
            "message": "没有找到聊天输入区右侧的发送按钮。",
            "state": marked,
        }
    page = terminal.current_page()
    locator = page.locator(selector).first
    before_text = current_chat_editor_text(terminal)
    try:
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
    except Exception as error:
        try:
            page.evaluate(
                r"""(selector) => {
                  const el = document.querySelector(selector);
                  if (!el) return false;
                  el.click();
                  return true;
                }""",
                selector,
            )
        except Exception as fallback_error:
            return {
                "blocked": True,
                "message": f"点击发送按钮失败：{safe_text(str(error), 120)}；JS 兜底也失败：{safe_text(str(fallback_error), 120)}",
                "state": marked,
            }
    page.wait_for_timeout(random.randint(520, 900))
    after_text = current_chat_editor_text(terminal)
    js_clicked = False
    coord_clicked = False
    enter_pressed = False
    if before_text and after_text and normalize_reply_fingerprint(after_text) == normalize_reply_fingerprint(before_text):
        try:
            js_clicked = bool(page.evaluate(
                r"""(selector) => {
                  const el = document.querySelector(selector);
                  if (!el) return false;
                  el.click();
                  return true;
                }""",
                selector,
            ))
            page.wait_for_timeout(random.randint(650, 980))
            after_text = current_chat_editor_text(terminal)
        except Exception:
            pass
    if before_text and after_text and normalize_reply_fingerprint(after_text) == normalize_reply_fingerprint(before_text):
        try:
            x = float(marked.get("x") or 0) + float(marked.get("w") or 0) / 2
            y = float(marked.get("y") or 0) + float(marked.get("h") or 0) / 2
            if x > 0 and y > 0:
                humanized_point_click(terminal, x, y, target_box={
                    "x": float(marked.get("x") or 0),
                    "y": float(marked.get("y") or 0),
                    "w": float(marked.get("w") or 0),
                    "h": float(marked.get("h") or 0),
                })
                coord_clicked = True
                page.wait_for_timeout(random.randint(650, 980))
                after_text = current_chat_editor_text(terminal)
        except Exception:
            pass
    if before_text and after_text and normalize_reply_fingerprint(after_text) == normalize_reply_fingerprint(before_text):
        try:
            if focus_current_chat_editor(terminal):
                page.keyboard.press("Enter")
                enter_pressed = True
                page.wait_for_timeout(random.randint(650, 980))
                after_text = current_chat_editor_text(terminal)
        except Exception:
            pass
    message = "已点击聊天发送按钮"
    if js_clicked:
        message += "，并执行了一次 JS 兜底点击"
    if coord_clicked:
        message += "，并执行了一次坐标补点"
    if enter_pressed:
        message += "，并执行了一次回车兜底"
    still_same = bool(before_text and after_text and normalize_reply_fingerprint(after_text) == normalize_reply_fingerprint(before_text))
    if still_same:
        message += "，但输入框仍未清空"
    return {
        "message": message,
        "state": {k: v for k, v in marked.items() if k != "selector"},
        "inputBefore": safe_text(before_text, 120),
        "inputAfter": safe_text(after_text, 120),
        "jsFallback": js_clicked,
        "coordinateFallback": coord_clicked,
        "enterFallback": enter_pressed,
        "blocked": still_same,
    }


def find_send_action(terminal: BrowserTerminal) -> dict:
    marked = mark_current_chat_send_button(terminal)
    if marked.get("selector"):
        return {
            "action": "click",
            "target": f"css={marked['selector']}",
            "_sendLabel": marked.get("label") or "发送",
        }
    terminal.collect_page_context(limit=100)
    keywords = ("发送", "send", "Send")
    for item in terminal.cache:
        if item.kind != "button":
            continue
        label = item.label or ""
        if any(keyword in label for keyword in keywords):
            return {"action": "click", "target": label}
    page = terminal.current_page()
    candidates = page.locator("button, [role=button], input[type=button], input[type=submit]")
    count = candidates.count()
    for index in range(min(count, 80)):
        item = candidates.nth(index)
        label = describe_editable(item)
        if any(keyword.lower() in label.lower() for keyword in keywords):
            return {"action": "click", "target": label or "发送"}
    return {"action": "click", "target": "发送"}


def is_whitelisted_send_button(label: str) -> bool:
    normalized = re.sub(r"\s+", "", str(label or "")).strip().lower()
    # Be permissive: many sites embed extra text/icons around the send button label.
    # If the label contains a send keyword anywhere, treat it as send.
    if "发送" in normalized or "send" in normalized:
        return True
    if normalized in SEND_BUTTON_WHITELIST:
        return True
    parts = [
        part.strip().lower()
        for part in re.split(r"[|/·,，;；]", str(label or ""))
        if part.strip()
    ]
    return any(part in SEND_BUTTON_WHITELIST for part in parts)


def is_common_phrase_panel_open(terminal: BrowserTerminal) -> bool:
    page = terminal.current_page()
    try:
        return bool(page.evaluate(
            r"""() => {
              const panel = document.querySelector(".phrase-content");
              if (!panel) return false;
              const box = panel.getBoundingClientRect();
              const style = window.getComputedStyle(panel);
              return box.width > 20 && box.height > 20 && box.bottom > 0 && box.y < window.innerHeight
                && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
            }"""
        ))
    except Exception:
        return False


def find_common_phrase_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_common_phrase_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const nodes = Array.from(document.body ? document.body.querySelectorAll(
                ".operate-icon-item, .toolbar-icon, [class*='changyongyu'], [class*='operate'], button, [role='button'], span, div"
              ) : []);
              let best = null;
              let bestScore = -9999;
              for (const node of nodes) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute("title") || node.getAttribute("aria-label") || "");
                const cls = String(node.className || "");
                if (text !== "\u5e38\u7528\u8bed" && !cls.includes("changyongyu")) continue;
                const box = node.getBoundingClientRect();
                let score = 0;
                if (text === "\u5e38\u7528\u8bed") score += 120;
                if (cls.includes("changyongyu")) score += 140;
                if (box.x > window.innerWidth * 0.35 && box.y > window.innerHeight * 0.60) score += 90;
                if (box.width > 70 || box.height > 70) score -= 80;
                const target = node.closest(".operate-icon-item") || node;
                if (score > bestScore) {
                  bestScore = score;
                  best = { target, text: text || "\u5e38\u7528\u8bed", box };
                }
              }
              if (!best) return { found: false };
              best.target.setAttribute("data-codex-common-phrase", token);
              const box = best.target.getBoundingClientRect();
              return {
                found: true,
                label: best.text,
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
    info["locator"] = page.locator(f"[data-codex-common-phrase='{token}']").first
    return info


def find_common_phrase_item(terminal: BrowserTerminal, phrase: str) -> dict:
    page = terminal.current_page()
    token = f"codex_common_phrase_item_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    phrase = str(phrase or "").strip()
    try:
        info = page.evaluate(
            r"""({ token, phrase }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value).replace(/\s+/g, "");
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const panel = Array.from(document.querySelectorAll(".phrase-content, [class*='phrase-content']"))
                .find((el) => visible(el));
              if (!panel) return { found: false, reason: "\u5e38\u7528\u8bed\u9762\u677f\u672a\u6253\u5f00" };
              const want = compact(phrase);
              const shortWant = want.slice(0, Math.min(28, want.length));
              const nodes = Array.from(panel.querySelectorAll("li, dd, div, span, p"));
              let best = null;
              let bestScore = -9999;
              for (const node of nodes) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || "");
                if (!text || text === "\u8bbe\u7f6e" || text === "\u5e38\u7528\u8bed") continue;
                const compactText = compact(text);
                let score = -9999;
                if (want && compactText === want) score = 1000;
                else if (want && (compactText.includes(want) || want.includes(compactText))) score = 850;
                else if (shortWant && compactText.includes(shortWant)) score = 700;
                if (score < 0) continue;
                const box = node.getBoundingClientRect();
                score -= Math.max(0, box.y - 180) / 10;
                if (node.tagName === "LI") score += 60;
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, text, box, score };
                }
              }
              if (!best) return { found: false, reason: normalize(panel.innerText || panel.textContent || "").slice(0, 500) };
              best.node.setAttribute("data-codex-common-phrase-item", token);
              const box = best.node.getBoundingClientRect();
              return {
                found: true,
                label: best.text,
                score: Math.round(best.score),
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              };
            }""",
            {"token": token, "phrase": phrase},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    info["locator"] = page.locator(f"[data-codex-common-phrase-item='{token}']").first
    return info


def click_common_phrase_item_by_text(terminal: BrowserTerminal, phrase: str) -> dict:
    page = terminal.current_page()
    phrase = str(phrase or "").strip()
    try:
        info = page.evaluate(
            r"""({ phrase }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value).replace(/\s+/g, "");
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const panel = Array.from(document.querySelectorAll(".phrase-content, [class*='phrase-content'], [class*='phrase']"))
                .find((el) => visible(el) && normalize(el.innerText || el.textContent || "").includes("日薪150"));
              if (!panel) return { clicked: false, reason: "common_phrase_panel_not_found" };
              const want = compact(phrase);
              const shortWant = want.slice(0, Math.min(28, want.length));
              const nodes = Array.from(panel.querySelectorAll("li, dd, div, span, p, a, [role='button']"));
              let best = null;
              let bestScore = -9999;
              for (const node of nodes) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || "");
                if (!text || text === "设置" || text === "常用语") continue;
                const compactText = compact(text);
                let score = -9999;
                if (want && compactText === want) score = 1000;
                else if (want && (compactText.includes(want) || want.includes(compactText))) score = 850;
                else if (shortWant && compactText.includes(shortWant)) score = 700;
                if (score < 0) continue;
                if (node.tagName === "LI") score += 60;
                const box = node.getBoundingClientRect();
                score -= Math.max(0, box.y - 180) / 10;
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, text, box };
                }
              }
              if (!best) return { clicked: false, reason: normalize(panel.innerText || panel.textContent || "").slice(0, 500) };
              const target = best.node.closest("li,dd,a,[role='button'],[onclick]") || best.node;
              target.scrollIntoView({ block: "nearest", inline: "nearest" });
              const box = target.getBoundingClientRect();
              const opts = { bubbles: true, cancelable: true, view: window, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
              target.dispatchEvent(new MouseEvent("mousedown", opts));
              target.dispatchEvent(new MouseEvent("mouseup", opts));
              target.dispatchEvent(new MouseEvent("click", opts));
              return {
                clicked: true,
                label: best.text,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              };
            }""",
            {"phrase": phrase},
        )
    except Exception as error:
        return {"clicked": False, "error": str(error)}
    return info if isinstance(info, dict) else {"clicked": False}


def click_common_phrase_row_send_button_real_hover(
    terminal: BrowserTerminal,
    phrase: str,
    item_info: dict | None = None,
) -> dict:
    page = terminal.current_page()
    phrase = str(phrase or "").strip()
    item_info = item_info if isinstance(item_info, dict) else {}
    try:
        row_info = page.evaluate(
            r"""({ phrase, itemY, itemH }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value).replace(/\s+/g, "");
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden"
                  && Number(style.opacity || "1") > 0.03;
              };
              const want = compact(phrase);
              const shortWant = want.slice(0, Math.min(30, want.length));
              const panels = Array.from(document.querySelectorAll(".phrase-content, [class*='phrase-content'], [class*='phrase']"))
                .filter((el) => visible(el));
              const bestRowFor = (node) => {
                const rows = [];
                let cur = node;
                for (let depth = 0; cur && cur !== document.body && depth < 8; depth += 1, cur = cur.parentElement) {
                  if (!visible(cur)) continue;
                  const text = normalize(cur.innerText || cur.textContent || "");
                  const textCompact = compact(text);
                  if (!textCompact || (shortWant && !textCompact.includes(shortWant))) continue;
                  const box = cur.getBoundingClientRect();
                  if (box.width < 120 || box.height < 16 || box.height > 96) continue;
                  const cls = String(cur.className || "");
                  let score = 0;
                  score += Math.min(520, box.width);
                  score -= Math.abs(box.height - 36) * 4;
                  if (/^(LI|DD|A|BUTTON)$/i.test(cur.tagName)) score += 120;
                  if (/phrase|item|list|quick|common/i.test(cls)) score += 80;
                  rows.push({ node: cur, box, score });
                }
                rows.sort((a, b) => b.score - a.score);
                return rows[0] || null;
              };
              let best = null;
              let bestScore = -9999;
              for (const panel of panels) {
                const nodes = Array.from(panel.querySelectorAll("li, dd, div, span, p, a, [role='button']"));
                for (const node of nodes) {
                  if (!visible(node)) continue;
                  const text = normalize(node.innerText || node.textContent || "");
                  if (!text || text === "\u8bbe\u7f6e" || text === "\u5e38\u7528\u8bed" || text === "\u53d1\u9001") continue;
                  const compactText = compact(text);
                  let score = -9999;
                  if (want && compactText === want) score = 1100;
                  else if (want && compactText.includes(want)) score = 980;
                  else if (want && want.includes(compactText) && compactText.length >= 18) score = 860;
                  else if (shortWant && compactText.includes(shortWant)) score = 760;
                  if (score < 0) continue;
                  const row = bestRowFor(node) || { node, box: node.getBoundingClientRect(), score: 0 };
                  const rowBox = row.node.getBoundingClientRect();
                  if (Number.isFinite(itemY)) {
                    const center = rowBox.y + rowBox.height / 2;
                    const targetCenter = Number(itemY) + (Number(itemH) || rowBox.height) / 2;
                    score -= Math.abs(center - targetCenter) * 2;
                  } else {
                    score -= Math.max(0, rowBox.y - 180) / 10;
                  }
                  score += row.score || 0;
                  if (score > bestScore) {
                    bestScore = score;
                    best = { row: row.node, text, rowBox, score };
                  }
                }
              }
              if (!best) {
                return {
                  found: false,
                  clicked: false,
                  reason: "phrase_item_not_found_for_real_hover",
                  panelText: panels.map((p) => normalize(p.innerText || p.textContent || "").slice(0, 240)).join("\n---\n").slice(0, 900)
                };
              }
              best.row.scrollIntoView({ block: "nearest", inline: "nearest" });
              const box = best.row.getBoundingClientRect();
              return {
                found: true,
                clicked: false,
                itemLabel: best.text,
                rowBox: {
                  x: Math.round(box.x),
                  y: Math.round(box.y),
                  w: Math.round(box.width),
                  h: Math.round(box.height)
                },
                score: Math.round(bestScore)
              };
            }""",
            {
                "phrase": phrase,
                "itemY": item_info.get("y"),
                "itemH": item_info.get("h"),
            },
        )
    except Exception as error:
        return {"found": False, "clicked": False, "error": str(error)}
    if not isinstance(row_info, dict) or not row_info.get("found"):
        return row_info if isinstance(row_info, dict) else {"found": False, "clicked": False}

    row_box = row_info.get("rowBox") if isinstance(row_info.get("rowBox"), dict) else {}
    row = {
        "x": float(row_box.get("x") or 0),
        "y": float(row_box.get("y") or 0),
        "width": float(row_box.get("w") or 0),
        "height": float(row_box.get("h") or 0),
    }
    if row["width"] <= 0 or row["height"] <= 0:
        row_info["clicked"] = False
        row_info["reason"] = "invalid_phrase_row_box"
        return row_info

    try:
        hover_points = [
            (
                row["x"] + row["width"] * random.uniform(0.60, 0.72),
                row["y"] + row["height"] * random.uniform(0.42, 0.58),
            ),
            (
                row["x"] + row["width"] * random.uniform(0.82, 0.93),
                row["y"] + row["height"] * random.uniform(0.42, 0.58),
            ),
        ]
        for x, y in hover_points:
            if terminal.humanize:
                move_cursor_like_person(
                    terminal,
                    x,
                    y,
                    duration_factor=random.uniform(0.16, 0.34),
                    show_trail=False,
                )
            else:
                page.mouse.move(x, y, steps=random.randint(5, 12))
            page.wait_for_timeout(random.randint(130, 260))

        send_info = page.evaluate(
            r"""({ rowBox }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden"
                  && Number(style.opacity || "1") > 0.03;
              };
              const row = {
                x: Number(rowBox.x) || 0,
                y: Number(rowBox.y) || 0,
                w: Number(rowBox.width) || Number(rowBox.w) || 0,
                h: Number(rowBox.height) || Number(rowBox.h) || 0
              };
              const rowCenterY = row.y + row.h / 2;
              const sendNodes = Array.from(document.querySelectorAll(".phrase-send, [class*='phrase-send'], button, [role='button'], a, span, div"))
                .filter((el) => {
                  if (!visible(el)) return false;
                  const text = normalize(el.innerText || el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || "");
                  const cls = String(el.className || "");
                  return text === "\u53d1\u9001" || /\bphrase-send\b|phrase.*send|send.*phrase/i.test(cls);
                });
              let best = null;
              let bestScore = -9999;
              for (const node of sendNodes) {
                const box = node.getBoundingClientRect();
                const centerY = box.y + box.height / 2;
                let score = 1000 - Math.abs(centerY - rowCenterY) * 10;
                const cls = String(node.className || "");
                if (/\bphrase-send\b|phrase.*send|send.*phrase/i.test(cls)) score += 280;
                if (box.x >= row.x + row.w * 0.52) score += 140;
                if (box.y >= row.y - 14 && box.y <= row.y + row.h + 14) score += 160;
                if (box.y > window.innerHeight * 0.55) score -= 900;
                if (box.width > 120 || box.height > 80) score -= 260;
                if (score > bestScore) {
                  bestScore = score;
                  best = { node, box, text: normalize(node.innerText || node.textContent || "\u53d1\u9001") };
                }
              }
              if (!best) {
                return {
                  found: false,
                  clicked: false,
                  reason: "phrase_send_button_not_visible_after_real_hover",
                  candidates: sendNodes.length
                };
              }
              return {
                found: true,
                clicked: false,
                label: best.text || "\u53d1\u9001",
                x: Math.round(best.box.x),
                y: Math.round(best.box.y),
                w: Math.round(best.box.width),
                h: Math.round(best.box.height),
                score: Math.round(bestScore)
              };
            }""",
            {"rowBox": row},
        )
    except Exception as error:
        row_info["clicked"] = False
        row_info["error"] = str(error)
        return row_info

    if not isinstance(send_info, dict) or not send_info.get("found"):
        result = dict(row_info)
        if isinstance(send_info, dict):
            result.update({k: v for k, v in send_info.items() if k not in {"itemLabel", "rowBox"}})
        result["clicked"] = False
        return result

    send_box = {
        "x": float(send_info.get("x") or 0),
        "y": float(send_info.get("y") or 0),
        "width": float(send_info.get("w") or 0),
        "height": float(send_info.get("h") or 0),
    }
    try:
        x = send_box["x"] + send_box["width"] * random.uniform(0.42, 0.58)
        y = send_box["y"] + send_box["height"] * random.uniform(0.42, 0.58)
        if terminal.humanize:
            move_cursor_like_person(
                terminal,
                x,
                y,
                duration_factor=random.uniform(0.12, 0.24),
                show_trail=False,
            )
        else:
            page.mouse.move(x, y, steps=random.randint(4, 9))
        page.wait_for_timeout(random.randint(70, 150))
        if terminal.visual_cursor:
            try:
                move_visual_cursor(page, x, y, click=True)
            except Exception:
                pass
        page.mouse.down()
        page.wait_for_timeout(random.randint(35, 90))
        page.mouse.up()
        page.wait_for_timeout(random.randint(480, 850))
        try:
            page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(x), "y": float(y)})
        except Exception:
            pass
        maybe_human_work_rest(terminal)
        result = dict(row_info)
        result.update(send_info)
        result["clicked"] = True
        result["strategy"] = "real_hover_phrase_send"
        return result
    except Exception as error:
        result = dict(row_info)
        result.update(send_info)
        result["clicked"] = False
        result["error"] = str(error)
        return result


def click_common_phrase_row_send_button(terminal: BrowserTerminal, phrase: str, item: dict | None = None) -> dict:
    page = terminal.current_page()
    phrase = str(phrase or "").strip()
    item_info = item if isinstance(item, dict) else {}
    real_hover = click_common_phrase_row_send_button_real_hover(terminal, phrase, item_info)
    if isinstance(real_hover, dict) and real_hover.get("clicked"):
        return real_hover
    try:
        info = page.evaluate(
            r"""({ phrase, itemY, itemH }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value).replace(/\s+/g, "");
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
              };
              const want = compact(phrase);
              const shortWant = want.slice(0, Math.min(28, want.length));
              const panels = Array.from(document.querySelectorAll(".phrase-content, [class*='phrase-content'], [class*='phrase']"))
                .filter((el) => visible(el));
              let best = null;
              let bestScore = -9999;
              for (const panel of panels) {
                const nodes = Array.from(panel.querySelectorAll("li, dd, div, span, p, a, [role='button']"));
                for (const node of nodes) {
                  if (!visible(node)) continue;
                  const text = normalize(node.innerText || node.textContent || "");
                  if (!text || text === "设置" || text === "常用语" || text === "发送") continue;
                  const compactText = compact(text);
                  let score = -9999;
                  if (want && compactText === want) score = 1000;
                  else if (want && (compactText.includes(want) || want.includes(compactText))) score = 850;
                  else if (shortWant && compactText.includes(shortWant)) score = 700;
                  if (score < 0) continue;
                  const box = node.getBoundingClientRect();
                  if (Number.isFinite(itemY)) {
                    const center = box.y + box.height / 2;
                    const targetCenter = itemY + (Number(itemH) || box.height) / 2;
                    score -= Math.abs(center - targetCenter);
                  } else {
                    score -= Math.max(0, box.y - 180) / 10;
                  }
                  const row = node.closest("li,dd,[class*='phrase'],[class*='item']") || node;
                  if (node.tagName === "LI") score += 60;
                  if (score > bestScore) {
                    bestScore = score;
                    best = { node, row, text, box };
                  }
                }
              }
              if (!best) return { found: false, clicked: false, reason: "phrase_item_not_found" };

              const hoverTarget = best.row || best.node;
              const rowBox = hoverTarget.getBoundingClientRect();
              const hoverOpts = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: rowBox.x + rowBox.width * 0.72,
                clientY: rowBox.y + rowBox.height / 2
              };
              hoverTarget.dispatchEvent(new MouseEvent("mouseover", hoverOpts));
              hoverTarget.dispatchEvent(new MouseEvent("mouseenter", hoverOpts));
              hoverTarget.dispatchEvent(new MouseEvent("mousemove", hoverOpts));

              const sendNodes = Array.from(document.querySelectorAll(".phrase-send, [class*='phrase-send'], button, [role='button'], a, span, div"))
                .filter((el) => {
                  if (!visible(el)) return false;
                  const text = normalize(el.innerText || el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || "");
                  const cls = String(el.className || "");
                  return text === "发送" || cls.includes("phrase-send");
                });
              let send = null;
              let sendScore = -9999;
              for (const node of sendNodes) {
                const box = node.getBoundingClientRect();
                const centerY = box.y + box.height / 2;
                const rowCenterY = rowBox.y + rowBox.height / 2;
                const yGap = Math.abs(centerY - rowCenterY);
                let score = 1000 - yGap * 8;
                if (String(node.className || "").includes("phrase-send")) score += 240;
                if (box.x >= rowBox.x + rowBox.width * 0.55) score += 120;
                if (box.y >= rowBox.y - 10 && box.y <= rowBox.y + rowBox.height + 10) score += 120;
                // Avoid the bottom chat send button.
                if (box.y > window.innerHeight * 0.55) score -= 500;
                if (score > sendScore) {
                  sendScore = score;
                  send = node;
                }
              }
              if (!send) {
                return {
                  found: false,
                  clicked: false,
                  reason: "phrase_send_button_not_found",
                  itemLabel: best.text,
                  itemBox: { x: Math.round(rowBox.x), y: Math.round(rowBox.y), w: Math.round(rowBox.width), h: Math.round(rowBox.height) }
                };
              }
              const box = send.getBoundingClientRect();
              return {
                found: true,
                clicked: false,
                label: normalize(send.innerText || send.textContent || "发送"),
                itemLabel: best.text,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height),
                score: Math.round(sendScore)
              };
            }""",
            {
                "phrase": phrase,
                "itemY": item_info.get("y"),
                "itemH": item_info.get("h"),
            },
        )
    except Exception as error:
        return {"found": False, "clicked": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False, "clicked": False}
    box = {
        "x": float(info.get("x") or 0),
        "y": float(info.get("y") or 0),
        "width": float(info.get("w") or 0),
        "height": float(info.get("h") or 0),
    }
    try:
        if terminal.humanize:
            x = box["x"] + box["width"] * random.uniform(0.42, 0.62)
            y = box["y"] + box["height"] * random.uniform(0.38, 0.62)
            humanized_point_click(terminal, x, y, target_box=box)
        else:
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(random.randint(450, 850))
        info["clicked"] = True
        return info
    except Exception as error:
        info["clicked"] = False
        info["error"] = str(error)
        return info


def is_job51_common_word_panel_open(terminal: BrowserTerminal) -> bool:
    page = terminal.current_page()
    try:
        return bool(page.evaluate(
            r"""() => {
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 20 && box.height > 20 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.03;
              };
              return Array.from(document.querySelectorAll(".im-common-word-con, .el-popover.im-common-word-con, [class*='im-common-word-con']"))
                .some((el) => visible(el) && /常用语|未设置|发送/.test(String(el.innerText || el.textContent || "")));
            }"""
        ))
    except Exception:
        return False


def find_job51_common_word_button(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    token = f"codex_job51_common_word_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = page.evaluate(
            r"""({ token }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.03;
              };
              const nodes = Array.from(document.body ? document.body.querySelectorAll(
                "[track-id='sensor_Bchatinfo_common'], [track-id*='chatinfo_common'], .icon-hover-wrap, .el-popover__reference, button, [role='button'], span, div"
              ) : []);
              let best = null;
              let bestScore = -9999;
              for (const node of nodes) {
                if (!visible(node)) continue;
                const text = normalize(node.innerText || node.textContent || node.getAttribute("title") || node.getAttribute("aria-label") || "");
                const cls = String(node.className || "");
                const id = String(node.id || "");
                const trackId = String(node.getAttribute("track-id") || "");
                const haystack = [text, cls, id, trackId, node.getAttribute("title") || "", node.getAttribute("aria-label") || ""].join(" ");
                if (/plbatchreply|批量回复/.test(haystack)) continue;
                let score = -9999;
                if (trackId === "sensor_Bchatinfo_common") score = 900;
                else if (/chatinfo_common/.test(trackId)) score = 760;
                else if (text === "常用语") score = 520;
                else if (/常用语/.test(haystack) && /icon-hover-wrap|popover__reference|button/i.test(haystack)) score = 420;
                if (score < 0) continue;
                const box = node.getBoundingClientRect();
                if (/icon-hover-wrap/.test(cls)) score += 120;
                if (box.y > window.innerHeight * 0.45) score += 80;
                if (box.width > 80 || box.height > 80) score -= 120;
                const target = node.closest("[track-id='sensor_Bchatinfo_common'], [track-id*='chatinfo_common'], .icon-hover-wrap") || node;
                if (score > bestScore) {
                  bestScore = score;
                  best = { target, text: text || "常用语", box: target.getBoundingClientRect(), score, trackId };
                }
              }
              if (!best) return { found: false, reason: "job51_common_word_button_not_found" };
              best.target.setAttribute("data-codex-job51-common-word", token);
              const box = best.target.getBoundingClientRect();
              return {
                found: true,
                label: best.text,
                trackId: best.trackId,
                score: Math.round(best.score),
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
    info["locator"] = page.locator(f"[data-codex-job51-common-word='{token}']").first
    info["token"] = token
    return info


def find_job51_common_word_item(terminal: BrowserTerminal, phrase: str) -> dict:
    page = terminal.current_page()
    token = f"codex_job51_common_word_item_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    phrase = str(phrase or "").strip()
    try:
        info = page.evaluate(
            r"""({ token, phrase }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value).replace(/\s+/g, "");
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.03;
              };
              const panels = Array.from(document.querySelectorAll(".im-common-word-con, .el-popover.im-common-word-con, [class*='im-common-word-con']"))
                .filter((el) => visible(el));
              const panel = panels[0];
              if (!panel) return { found: false, reason: "51job_common_word_panel_not_open" };
              const want = compact(phrase);
              const shortWant = want.slice(0, Math.min(32, want.length));
              const rows = Array.from(panel.querySelectorAll(".greeting-item.at, .greeting-item, [class*='greeting-item'], li, div"));
              let best = null;
              let bestScore = -9999;
              for (const row of rows) {
                if (!visible(row)) continue;
                const textNode = row.querySelector(".greeting-item-text, [class*='greeting-item-text']") || row;
                const rawText = normalize(textNode.innerText || textNode.textContent || row.getAttribute("tips") || row.getAttribute("title") || "");
                const text = rawText.replace(/\s*发送\s*$/, "").trim();
                if (!text || text === "发送" || text === "设置" || text === "常用语") continue;
                const compactText = compact(text);
                let score = -9999;
                if (want && compactText === want) score = 1200;
                else if (want && (compactText.includes(want) || want.includes(compactText))) score = 1000;
                else if (shortWant && compactText.includes(shortWant)) score = 780;
                if (score < 0) continue;
                const box = row.getBoundingClientRect();
                if (/greeting-item/.test(String(row.className || ""))) score += 120;
                score -= Math.max(0, box.y - 180) / 10;
                if (score > bestScore) {
                  bestScore = score;
                  best = { row, text, box, score };
                }
              }
              if (!best) {
                return {
                  found: false,
                  reason: normalize(panel.innerText || panel.textContent || "").slice(0, 700)
                };
              }
              best.row.setAttribute("data-codex-job51-common-word-item", token);
              const box = best.row.getBoundingClientRect();
              return {
                found: true,
                label: best.text,
                score: Math.round(best.score),
                token,
                x: Math.round(box.x),
                y: Math.round(box.y),
                w: Math.round(box.width),
                h: Math.round(box.height)
              };
            }""",
            {"token": token, "phrase": phrase},
        )
    except Exception as error:
        return {"found": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False}
    info["locator"] = page.locator(f"[data-codex-job51-common-word-item='{token}']").first
    info["token"] = token
    return info


def click_job51_common_word_send_button(terminal: BrowserTerminal, phrase: str, item: dict | None = None) -> dict:
    page = terminal.current_page()
    phrase = str(phrase or "").strip()
    item_info = item if isinstance(item, dict) else {}
    token = f"codex_job51_common_word_send_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    item_locator = item_info.get("locator")
    try:
        if item_locator is not None:
            item_locator.hover(timeout=4000)
        else:
            x = float(item_info.get("x") or 0) + float(item_info.get("w") or 0) * 0.72
            y = float(item_info.get("y") or 0) + float(item_info.get("h") or 0) * 0.50
            if x > 0 and y > 0:
                page.mouse.move(x, y, steps=random.randint(4, 9))
        page.wait_for_timeout(random.randint(160, 300))
    except Exception:
        pass

    try:
        info = page.evaluate(
            r"""({ token, itemToken, phrase }) => {
              const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
              const compact = (value) => normalize(value).replace(/\s+/g, "");
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 2 && box.height > 2 && box.bottom > 0 && box.y < window.innerHeight
                  && box.right > 0 && box.x < window.innerWidth
                  && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.03;
              };
              const findMatchingRow = () => {
                if (itemToken) {
                  const marked = Array.from(document.querySelectorAll("[data-codex-job51-common-word-item]"))
                    .find((el) => el.getAttribute("data-codex-job51-common-word-item") === itemToken);
                  if (marked) return marked;
                }
                const panel = Array.from(document.querySelectorAll(".im-common-word-con, .el-popover.im-common-word-con, [class*='im-common-word-con']"))
                  .find((el) => visible(el));
                if (!panel) return null;
                const want = compact(phrase);
                const shortWant = want.slice(0, Math.min(32, want.length));
                let best = null;
                let bestScore = -9999;
                for (const row of Array.from(panel.querySelectorAll(".greeting-item.at, .greeting-item, [class*='greeting-item'], li, div"))) {
                  if (!visible(row)) continue;
                  const textNode = row.querySelector(".greeting-item-text, [class*='greeting-item-text']") || row;
                  const text = normalize(textNode.innerText || textNode.textContent || row.getAttribute("tips") || row.getAttribute("title") || "").replace(/\s*发送\s*$/, "");
                  const compactText = compact(text);
                  let score = -9999;
                  if (want && compactText === want) score = 1200;
                  else if (want && compactText.includes(want)) score = 1000;
                  else if (shortWant && compactText.includes(shortWant)) score = 780;
                  if (score > bestScore) {
                    bestScore = score;
                    best = row;
                  }
                }
                return best;
              };
              const row = findMatchingRow();
              if (!row) return { found: false, clicked: false, reason: "job51_common_word_row_not_found" };
              const box = row.getBoundingClientRect();
              const hoverOpts = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: box.x + box.width * 0.78,
                clientY: box.y + box.height / 2
              };
              row.dispatchEvent(new MouseEvent("mouseover", hoverOpts));
              row.dispatchEvent(new MouseEvent("mouseenter", hoverOpts));
              row.dispatchEvent(new MouseEvent("mousemove", hoverOpts));
              const send = Array.from(row.querySelectorAll(".greeting-item-send, [class*='greeting-item-send'], span, div"))
                .find((el) => normalize(el.innerText || el.textContent || "") === "发送");
              if (!send) {
                return {
                  found: false,
                  clicked: false,
                  reason: "job51_common_word_send_not_found",
                  itemBox: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) }
                };
              }
              const sendBox = send.getBoundingClientRect();
              const sendVisible = visible(send);
              if (!sendVisible) {
                const opts = {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  clientX: box.x + box.width * 0.88,
                  clientY: box.y + box.height / 2
                };
                send.dispatchEvent(new MouseEvent("mousedown", opts));
                send.dispatchEvent(new MouseEvent("mouseup", opts));
                send.dispatchEvent(new MouseEvent("click", opts));
                return {
                  found: true,
                  clicked: true,
                  strategy: "hidden_send_dispatch",
                  label: normalize(send.innerText || send.textContent || "发送"),
                  x: Math.round(box.x + box.width * 0.82),
                  y: Math.round(box.y),
                  w: Math.round(Math.max(28, box.width * 0.15)),
                  h: Math.round(box.height)
                };
              }
              send.setAttribute("data-codex-job51-common-word-send", token);
              return {
                found: true,
                clicked: false,
                strategy: "visible_send_click",
                label: normalize(send.innerText || send.textContent || "发送"),
                x: Math.round(sendBox.x),
                y: Math.round(sendBox.y),
                w: Math.round(sendBox.width),
                h: Math.round(sendBox.height)
              };
            }""",
            {"token": token, "itemToken": item_info.get("token"), "phrase": phrase},
        )
    except Exception as error:
        return {"found": False, "clicked": False, "error": str(error)}
    if not isinstance(info, dict) or not info.get("found"):
        return info if isinstance(info, dict) else {"found": False, "clicked": False}
    if info.get("clicked"):
        page.wait_for_timeout(random.randint(450, 850))
        return info

    locator = page.locator(f"[data-codex-job51-common-word-send='{token}']").first
    try:
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(locator)
        humanized_locator_click(terminal, locator, force=True)
        if terminal.humanize:
            terminal.pause_like_person("post_action")
        page.wait_for_timeout(random.randint(500, 900))
        info["clicked"] = True
        return info
    except Exception as error:
        info["clicked"] = False
        info["error"] = str(error)
        return info


def clear_chat_editor(terminal: BrowserTerminal) -> bool:
    page = terminal.current_page()
    try:
        return bool(page.evaluate(
            r"""() => {
              const editor = document.querySelector("#boss-chat-editor-input, .boss-chat-editor-input, [contenteditable='true']");
              if (!editor) return false;
              editor.focus();
              if ("value" in editor) editor.value = "";
              editor.innerHTML = "";
              editor.textContent = "";
              editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
              editor.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }"""
        ))
    except Exception:
        try:
            locator, _ = find_best_editable(terminal, "聊天")
            locator.click(timeout=3000)
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            return True
        except Exception:
            return False


def read_chat_editor_text(terminal: BrowserTerminal) -> str:
    page = terminal.current_page()
    try:
        value = page.evaluate(
            r"""() => {
              const editor = document.querySelector("#boss-chat-editor-input, .boss-chat-editor-input, [contenteditable='true'], textarea, input");
              if (!editor) return "";
              return String(editor.innerText || editor.value || editor.textContent || "").replace(/\s+/g, " ").trim();
            }"""
        )
        return safe_text(str(value or ""), 600)
    except Exception:
        return ""


def describe_editable(locator) -> str:
    try:
        return locator.evaluate(
            """el => {
              const attr = name => el.getAttribute(name) || "";
              const parts = [
                attr("aria-label"),
                attr("placeholder"),
                attr("title"),
                attr("name"),
                attr("id"),
                el.innerText || el.textContent || el.value || ""
              ].map(v => String(v).trim()).filter(Boolean);
              return [...new Set(parts)].join(" | ");
            }"""
        ).strip()
    except Exception:
        return ""


def score_editable_candidate(label: str, target_lower: str) -> int:
    lower = (label or "").lower()
    score = 0
    if target_lower and target_lower in lower:
        score += 20
    for word in ("消息", "输入", "聊天", "回复", "沟通", "message", "chat", "reply", "content", "text"):
        if word in lower:
            score += 12
    for bad in ("搜索", "search", "职位", "公司", "筛选", "filter"):
        if bad in lower:
            score -= 8
    return score


def boss_chat_rules_file_signature() -> tuple[str, int, int]:
    try:
        stat = BOSS_RULES_FILE.stat()
        return ("file", int(stat.st_mtime_ns), int(stat.st_size))
    except Exception:
        return ("missing", 0, 0)


def load_boss_chat_rules() -> dict:
    signature = boss_chat_rules_file_signature()
    with BOSS_CHAT_RULES_CACHE_LOCK:
        cached = BOSS_CHAT_RULES_CACHE.get("data")
        if BOSS_CHAT_RULES_CACHE.get("signature") == signature and isinstance(cached, dict):
            return cached

    data = load_json(BOSS_RULES_FILE, None)
    if not isinstance(data, dict):
        data = {
            "version": 1,
            "default": {"category": "default", "template": "你好，我这边想跟你确认下目前求职意向与可沟通时间。"},
            "rules": [],
            "positionReplies": {},
        }
    with BOSS_CHAT_RULES_CACHE_LOCK:
        BOSS_CHAT_RULES_CACHE["signature"] = signature
        BOSS_CHAT_RULES_CACHE["data"] = data
        COMPANY_KNOWLEDGE_SELECTION_CACHE.clear()
        POSITION_REPLY_SELECTION_CACHE.clear()
    return data


def load_boss_recruiter_skill_text() -> str:
    try:
        text = BOSS_RECRUITER_SKILL_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        return ""
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            text = parts[2].strip()
    return safe_text(text, 5000)


def load_job51_recruiter_skill_text() -> str:
    try:
        text = JOB51_RECRUITER_SKILL_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        return ""
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            text = parts[2].strip()
    return safe_text(text, 5000)


