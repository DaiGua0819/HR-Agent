            break
        try:
            wait_page.wait_for_timeout(min(max(35, int(poll_ms or 120)), remaining_ms))
        except Exception:
            break
    return {
        "matched": False,
        "reason": "condition_timeout",
        "lastValue": last_value if isinstance(last_value, dict) else None,
        "error": last_error,
    }


def wait_for_recommend_resume_dialog_ready(page, frame, timeout_ms: int = 1200) -> dict:
    return wait_for_evaluate_condition(
        frame,
        page,
        """() => {
          const active = document.querySelector(".dialog-wrap.active");
          if (!active) return {matched: false, reason: "resume_dialog_not_open"};
          const text = String(active.innerText || active.textContent || "").replace(/\\s+/g, " ").trim();
          const hasGreet = !!active.querySelector("button.btn-greet,.resumeGreet button,.button-chat-wrap.resumeGreet button");
          const hasClose = !!active.querySelector(".close-btn");
          const hasResumePanel = !!active.querySelector(".resume-right-side,.resume-summary,.resume-simple-box,iframe");
          if (hasGreet || (hasClose && hasResumePanel) || text.length > 80) {
            return {matched: true, reason: "resume_dialog_ready", hasGreet, hasClose, textLength: text.length};
          }
          return {matched: false, reason: "resume_dialog_waiting", hasGreet, hasClose, textLength: text.length};
        }""",
        timeout_ms=timeout_ms,
        poll_ms=110,
    )


def wait_for_post_greet_surface(page, timeout_ms: int = 2200) -> dict:
    return wait_for_evaluate_condition(
        page,
        page,
        """() => {
          const visible = (el) => {
            if (!el || !el.isConnected) return false;
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 6 && box.height > 6
              && style.display !== "none"
              && style.visibility !== "hidden"
              && style.opacity !== "0";
          };
          const normalize = (value) => String(value || "").replace(/\\s+/g, "").trim();
          for (const node of Array.from(document.querySelectorAll(".dialog-wrap.active button,.boss-dialog button,button,[role='button']"))) {
            if (!visible(node)) continue;
            const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
            if (text === "\\u77e5\\u9053\\u4e86" || text === "\\u6211\\u77e5\\u9053\\u4e86") {
              return {matched: true, reason: "post_greet_ack_visible", text};
            }
          }
          const active = document.querySelector(".dialog-wrap.active");
          const activeText = normalize(active ? active.innerText || active.textContent || "" : "");
          if (activeText.includes("\\u5df2\\u53d1\\u9001") || activeText.includes("\\u6253\\u62db\\u547c")) {
            return {matched: true, reason: "post_greet_dialog_visible", textLength: activeText.length};
          }
          return {matched: false, reason: active ? "waiting_post_greet_dialog" : "waiting_active_dialog"};
        }""",
        timeout_ms=timeout_ms,
        poll_ms=120,
    )


def read_recommend_frame_summary(frame) -> dict:
    try:
        return frame.evaluate(
            """() => {
              const text = document.body ? document.body.innerText || "" : "";
              const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
              const selectedNode = document.querySelector(".job-selecter-wrap .ui-dropmenu-label")
                || document.querySelector(".job-selecter-wrap .job-item.curr .label");
              const selectedPosition = normalize(selectedNode ? selectedNode.innerText || selectedNode.textContent || "" : "");
              const lines = text.split(/\\n+/).map((line) => line.trim()).filter(Boolean);
              let position = selectedPosition;
              for (const line of lines.slice(0, 16)) {
                if (position) break;
                if (/经理|工程师|销售|管培生|人力资源|HR|hrbp|实习生|应用技术|涂料/.test(line) && line.length <= 90) {
                  position = line;
                  break;
                }
              }
              const riskWords = ["验证码", "安全验证", "操作频繁", "账号异常", "系统繁忙", "请稍后", "限制"];
              const risk = riskWords.find((word) => text.includes(word)) || "";
              return {
                url: location.href,
                title: document.title,
                position: normalize(position),
                bodyPreview: text.slice(0, 1200),
                risk
              };
            }"""
        ) or {}
    except Exception as error:
        return {"error": str(error)}


def normalize_recommend_position(value: str) -> str:
    return re.sub(r"[\s_（）()·\-—|｜]+", "", str(value or "").lower())


def recommend_position_has_terms(value: str, terms: list[str]) -> bool:
    normalized = normalize_recommend_position(value)
    return all(normalize_recommend_position(term) in normalized for term in terms if term)


RECOMMEND_POSITION_MATCH_RULES = [
    {
        "key": "application_technology",
        "display": "应用技术经理（工业涂料领域）",
        "aliases": ["应用技术", "应用技术经理", "应用技术经理（工业涂料领域）", "工业涂料应用技术", "涂料应用技术"],
        "any": ["应用技术", "应用技术经理"],
        "all": [],
        "forbid": [],
    },
    {
        "key": "bentonite_sales",
        "display": "膨润土销售人员",
        "aliases": ["膨润土销售", "膨润土销售人员", "膨润土业务", "涂料原料销售"],
        "any": ["膨润土销售人员", "膨润土销售"],
        "all": ["膨润土"],
        "forbid": ["石油", "钻井", "泥浆", "油服", "钻井泥浆"],
    },
    {
        "key": "sales_trainee",
        "display": "销售管培生",
        "aliases": ["销售管培生", "销售管理培训生"],
        "any": ["销售管培生", "销售管理培训生"],
        "all": [],
        "forbid": [],
    },
    {
        "key": "hrbp",
        "display": "HRBP",
        "aliases": ["hrbp", "HRBP", "人力资源", "人力资源管培生", "人资管培", "人力资源管理培训生", "销售团队HRBP"],
        "any": ["hrbp", "人力资源", "人力资源管培", "人资管培"],
        "all": [],
        "forbid": [],
    },
    {
        "key": "international_business",
        "display": "国际业务管培生",
        "aliases": ["国际业务管培生", "外贸销售", "膨润土外贸销售", "化工原料外贸销售"],
        "any": ["国际业务管培生", "外贸销售", "外贸"],
        "all": [],
        "forbid": [],
    },
    {
        "key": "oil_drilling_sales",
        "display": "销售工程师（石油钻井泥浆膨润土）_湖州",
        "aliases": ["石油销售", "石油助剂销售", "钻井泥浆销售", "销售工程师（石油钻井泥浆膨润土）_湖州"],
        "any": ["销售工程师石油钻井泥浆膨润土湖州", "石油销售", "石油助剂销售", "钻井泥浆销售"],
        "all": ["石油"],
        "any_extra": ["钻井", "泥浆", "钻井泥浆"],
        "forbid": [],
    },
    {
        "key": "electrical_engineer",
        "display": "电气工程师",
        "aliases": ["电气工程师", "电器工程师", "电气自动化"],
        "any": ["电气工程师", "电器工程师", "电气自动化"],
        "all": [],
        "forbid": [],
    },
]


def recommend_position_rule_for(value: str) -> dict | None:
    normalized = normalize_recommend_position(value)
    if not normalized:
        return None
    best: dict | None = None
    best_score = 0
    for rule in RECOMMEND_POSITION_MATCH_RULES:
        for alias in rule.get("aliases") or []:
            alias_norm = normalize_recommend_position(alias)
            if not alias_norm:
                continue
            score = 0
            if normalized == alias_norm:
                score = 300 + len(alias_norm)
            elif alias_norm in normalized:
                score = 180 + len(alias_norm)
            elif normalized in alias_norm and len(normalized) >= 4:
                score = 120 + len(normalized)
            if score > best_score:
                best = rule
                best_score = score
    return best


def recommend_position_match_score(current_position: str, target_position: str) -> int:
    current = normalize_recommend_position(current_position)
    target = normalize_recommend_position(target_position)
    if not target:
        return 1
    if not current:
        return 0

    target_rule = recommend_position_rule_for(target_position)
    current_rule = recommend_position_rule_for(current_position)
    if target_rule:
        if current_rule and current_rule.get("key") != target_rule.get("key"):
            return 0
        for term in target_rule.get("forbid") or []:
            if normalize_recommend_position(term) in current:
                return 0
        any_terms = [normalize_recommend_position(term) for term in (target_rule.get("any") or []) if term]
        all_terms = [normalize_recommend_position(term) for term in (target_rule.get("all") or []) if term]
        extra_terms = [normalize_recommend_position(term) for term in (target_rule.get("any_extra") or []) if term]
        if any(term and term in current for term in any_terms):
            return 900
        if all(term and term in current for term in all_terms) and (not extra_terms or any(term in current for term in extra_terms)):
            return 760
        target_display = normalize_recommend_position(str(target_rule.get("display") or ""))
        if target_display and target_display in current:
            return 880
        return 0

    if target == current:
        return 700
    if len(target) >= 6 and target in current:
        return 500
    if len(target) >= 6 and current in target:
        return 420
    return 0


def recommend_position_matches(current_position: str, target_position: str) -> bool:
    return recommend_position_match_score(current_position, target_position) > 0


def select_recommend_position_if_needed(terminal: BrowserTerminal, frame, target_position: str) -> dict:
    target_position = str(target_position or "").strip()
    if not target_position:
        return {"changed": False, "reason": "no_target_position"}
    summary = read_recommend_frame_summary(frame)
    current_position = str(summary.get("position") or "")
    page = terminal.current_page()
    try:
        expanded = frame.locator(".job-selecter-wrap.expanding")
        if current_position and recommend_position_matches(current_position, target_position):
            if expanded.count() > 0:
                page.keyboard.press("Escape")
                page.wait_for_timeout(random.randint(180, 360))
            return {
                "changed": False,
                "reason": "already_target_position",
                "currentPosition": current_position,
            }
    except Exception:
        if current_position and recommend_position_matches(current_position, target_position):
            return {
                "changed": False,
                "reason": "already_target_position",
                "currentPosition": current_position,
            }

    try:
        selector = frame.locator(".job-selecter-wrap").first
        if terminal.humanize:
            terminal.pause_like_person("pre_action")
            highlight_target(selector)
        humanized_locator_click(terminal, selector, force=True)
        page.wait_for_timeout(random.randint(420, 760))
    except Exception as error:
        return {
            "changed": False,
            "reason": "open_job_selector_failed",
            "currentPosition": current_position,
            "error": safe_text(str(error), 160),
        }

    try:
        options = frame.locator(".job-list .job-item")
        count = min(40, int(options.count() or 0))
        labels: list[str] = []
        best_index = -1
        best_label = ""
        best_score = 0
        for index in range(count):
            item = options.nth(index)
            try:
                label = re.sub(r"\s+", " ", item.inner_text(timeout=1200)).strip()
            except Exception:
                label = ""
            if not label:
                continue
            labels.append(label)
            score = recommend_position_match_score(label, target_position)
            if score > best_score:
                best_index = index
                best_label = label
                best_score = score
        if best_index >= 0:
            item = options.nth(best_index)
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
                highlight_target(item)
            humanized_locator_click(terminal, item, force=True)
            page.wait_for_timeout(random.randint(900, 1500))
            after = read_recommend_frame_summary(frame)
            return {
                "changed": True,
                "reason": "selected_target_position",
                "targetPosition": target_position,
                "selectedLabel": best_label,
                "matchScore": best_score,
                "currentPosition": str(after.get("position") or ""),
            }
        page.keyboard.press("Escape")
        page.wait_for_timeout(random.randint(180, 360))
        return {
            "changed": False,
            "reason": "target_position_not_found",
            "targetPosition": target_position,
            "currentPosition": current_position,
            "visibleOptions": labels[:12],
        }
    except Exception as error:
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
        return {
            "changed": False,
            "reason": "select_target_position_failed",
            "targetPosition": target_position,
            "currentPosition": current_position,
            "error": safe_text(str(error), 160),
        }


def collect_recommend_candidate_cards(frame) -> list[dict]:
    try:
        items = frame.evaluate(
            """() => {
              const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 10 && box.height > 10
                  && style.display !== "none"
                  && style.visibility !== "hidden"
                  && box.bottom >= 80
                  && box.top <= window.innerHeight - 20;
              };
              const rect = (el) => {
                const box = el.getBoundingClientRect();
                return {
                  x: Math.round(box.x),
                  y: Math.round(box.y),
                  width: Math.round(box.width),
                  height: Math.round(box.height)
                };
              };
              return Array.from(document.querySelectorAll(".candidate-card-wrap")).map((card, domIndex) => {
                const greetButton = card.querySelector("button.btn-greet");
                const text = normalize(card.innerText || card.textContent || "");
                const isSimilarRecommendation = !!card.closest(".similar-geek-wrap,.similar-geek-list,.similar-card-wrap,.similar-geek-item")
                  || text.includes("为你推荐")
                  || text.includes("相似的")
                  || text.includes("相似牛人");
                return {
                  domIndex,
                  visible: visible(card),
                  text,
                  className: String(card.className || ""),
                  isSimilarRecommendation,
                  hasGreetButton: !!greetButton && visible(greetButton) && normalize(greetButton.innerText || greetButton.textContent || "").includes("打招呼"),
                  rect: rect(card),
                  greetRect: greetButton ? rect(greetButton) : null
                };
              }).filter((item) => item.visible && item.text && !item.isSimilarRecommendation);
            }"""
        )
        return items if isinstance(items, list) else []
    except Exception:
        return []


def close_recommend_resume_dialog(terminal: BrowserTerminal, frame) -> dict:
    page = terminal.current_page()
    try:
        post_greet_ack = page.evaluate(
            """() => {
              const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
              const visible = (el) => {
                if (!el || !el.isConnected) return false;
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 4 && box.height > 4
                  && style.display !== "none"
                  && style.visibility !== "hidden"
                  && style.opacity !== "0"
                  && box.bottom >= 0
                  && box.right >= 0
                  && box.top <= window.innerHeight
                  && box.left <= window.innerWidth;
              };
              const roots = Array.from(document.querySelectorAll(
                ".dialog-wrap.active .boss-dialog__wrapper,.dialog-wrap.active .boss-popup__wrapper,.dialog-wrap.active .boss-dialog,.boss-dialog__wrapper,.boss-popup__wrapper"
              )).filter(visible);
              return roots.some((root) => {
                const text = normalize(root.innerText || root.textContent || "");
                if (!/(已向牛人发送招呼|发送招呼|已发送招呼|招呼)/.test(text) || !text.includes("知道了")) return false;
                return Array.from(root.querySelectorAll("button,[role='button'],a")).some((node) => {
                  const nodeText = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
                  return visible(node) && /^(我知道了|知道了)$/.test(nodeText);
                });
              });
            }"""
        )
        if post_greet_ack:
            return {"closed": False, "reason": "post_greet_ack_visible_before_resume_close"}
        close_locator = frame.locator(".dialog-wrap.active .close-btn").first
        if close_locator.count() <= 0:
            return {"closed": False, "reason": "no_active_dialog"}
        if terminal.humanize:
            highlight_target(close_locator)
            humanized_precise_button_click(terminal, close_locator, force=True)
        else:
            close_locator.click(timeout=3000, force=True)
        page.wait_for_timeout(random.randint(450, 850))
        return {"closed": True}
    except Exception as error:
        return {"closed": False, "reason": "close_failed", "error": safe_text(str(error), 160)}


def close_recommend_post_greet_popup(terminal: BrowserTerminal, frame, attempts: int = 3) -> dict:
    page = terminal.current_page()
    closed_items: list[dict] = []
    last_reason = "no_post_greet_popup"
    attempt_limit = max(1, int(attempts or 3))

    def marked_target_visible(mark_token: str) -> bool:
        try:
            return bool(page.evaluate(
                """token => {
                  const node = document.querySelector(`[data-codex-post-greet-close="${token}"]`);
                  if (!node || !node.isConnected) return false;
                  const box = node.getBoundingClientRect();
                  const style = window.getComputedStyle(node);
                  return box.width > 4 && box.height > 4
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0"
                    && box.bottom >= 0
                    && box.right >= 0
                    && box.top <= window.innerHeight
                    && box.left <= window.innerWidth;
                }""",
                mark_token,
            ))
        except Exception:
            return False

    def click_post_greet_target(locator, *, prefer_center: bool) -> dict:
        try:
            locator.scroll_into_view_if_needed(timeout=1800)
        except Exception:
            pass
        try:
            box = locator.bounding_box(timeout=1800)
        except Exception:
            box = None
        if prefer_center and box:
            x = float(box["x"] + box["width"] / 2)
            y = float(box["y"] + box["height"] / 2)
            try:
                page.mouse.move(x, y, steps=random.randint(8, 14))
                page.wait_for_timeout(random.randint(120, 220))
            except Exception:
                pass
            if terminal.humanize:
                move_cursor_like_person(terminal, x, y, duration_factor=random.uniform(0.32, 0.52), show_trail=True)
                if terminal.visual_cursor:
                    move_visual_cursor(page, x, y, click=True)
                page.wait_for_timeout(random.randint(40, 95))
            page.mouse.click(x, y)
            try:
                page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": x, "y": y})
            except Exception:
                pass
            return {"method": "center_mouse_click", "box": box}
        try:
            if box:
                locator.click(
                    timeout=2200,
                    force=True,
                    position={"x": int(max(1, box["width"] / 2)), "y": int(max(1, box["height"] / 2))},
                )
                return {"method": "locator_center_click", "box": box}
            locator.click(timeout=2200, force=True)
            return {"method": "locator_force_click", "box": None}
        except Exception:
            if terminal.humanize:
                highlight_target(locator)
                humanized_precise_button_click(terminal, locator, force=True)
                return {"method": "humanized_fallback_click", "box": box}
            locator.click(timeout=3000, force=True)
            return {"method": "locator_force_retry", "box": box}

    for attempt_index in range(attempt_limit):
        token = f"codex_post_greet_close_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
        try:
            ack_info = page.evaluate(
                """token => {
                  const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
                  const visible = (el) => {
                    if (!el || !el.isConnected) return false;
                    const box = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return box.width > 6 && box.height > 6
                      && style.display !== "none"
                      && style.visibility !== "hidden"
                      && style.opacity !== "0"
                      && box.bottom >= 0
                      && box.right >= 0
                      && box.top <= window.innerHeight
                      && box.left <= window.innerWidth;
                  };
                  const rect = (el) => {
                    const box = el.getBoundingClientRect();
                    return {
                      x: Math.round(box.x),
                      y: Math.round(box.y),
                      width: Math.round(box.width),
                      height: Math.round(box.height)
                    };
                  };
                  const roots = Array.from(document.querySelectorAll([
                    ".dialog-wrap.active .boss-dialog__wrapper",
                    ".dialog-wrap.active .boss-popup__wrapper",
                    ".dialog-wrap.active .boss-dialog",
                    ".boss-dialog__wrapper",
                    ".boss-popup__wrapper",
                    ".boss-dialog"
                  ].join(","))).filter(visible);
                  const candidates = [];
                  for (const root of roots) {
                    const rootText = normalize(root.innerText || root.textContent || "");
                    const isPostGreet = /(已向牛人发送招呼|发送招呼|已发送招呼|招呼)/.test(rootText) && rootText.includes("知道了");
                    if (!isPostGreet) continue;
                    for (const node of Array.from(root.querySelectorAll("button,[role='button'],a"))) {
                      if (!visible(node)) continue;
                      const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
                      const attrs = [node.className, node.id, node.getAttribute("ka"), node.getAttribute("aria-label"), node.getAttribute("title")]
                        .map((item) => String(item || "")).join(" ");
                      if (!/^(我知道了|知道了)$/.test(text)) continue;
                      let score = 1000;
                      if (/btn-sure-v2|sure|primary|confirm/i.test(attrs)) score += 80;
                      if (node.tagName === "BUTTON") score += 40;
                      candidates.push({
                        node,
                        score,
                        text,
                        attrs: attrs.slice(0, 140),
                        rootText: rootText.slice(0, 180),
                        rect: rect(node)
                      });
                    }
                  }
                  candidates.sort((a, b) => b.score - a.score);
                  const best = candidates[0];
                  if (!best) return {found: false, reason: "post_greet_ack_button_not_found"};
                  best.node.setAttribute("data-codex-post-greet-close", token);
                  return {
                    found: true,
                    token,
                    score: best.score,
                    text: best.text,
                    attrs: best.attrs,
                    rootText: best.rootText,
                    rect: best.rect,
                    preferredAck: true
                  };
                }""",
                token,
            ) or {}
            if ack_info.get("found"):
                info = ack_info
            else:
                info = {}
        except Exception as error:
            last_reason = "post_greet_ack_scan_failed"
            info = {}

        if not info:
            try:
                if attempt_index < attempt_limit - 1:
                    last_reason = "waiting_for_post_greet_ack_button"
                    page.wait_for_timeout(random.randint(360, 760))
                    continue
                info = page.evaluate(
                    """token => {
                      const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
                      const visible = (el) => {
                        if (!el || !el.isConnected) return false;
                        const box = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        return box.width > 6 && box.height > 6
                          && style.display !== "none"
                          && style.visibility !== "hidden"
                          && style.opacity !== "0"
                          && box.bottom >= 0
                          && box.right >= 0
                          && box.top <= window.innerHeight
                          && box.left <= window.innerWidth;
                      };
                      const rect = (el) => {
                        const box = el.getBoundingClientRect();
                        return {
                          x: Math.round(box.x),
                          y: Math.round(box.y),
                          width: Math.round(box.width),
                          height: Math.round(box.height)
                        };
                      };
                      const rootSelector = [
                        ".dialog-wrap.active",
                        ".boss-dialog",
                        ".ui-dialog",
                        ".ui-popup",
                        ".popover",
                        ".tooltip",
                        ".greet",
                        ".greet-success",
                        ".greet-success-dialog",
                        ".recommend",
                        ".recommend-popup",
                        ".recommend-dialog",
                        ".similar-geek-wrap",
                        ".similar-geek-list",
                        ".toast"
                      ].join(",");
                      const actionSelector = [
                        "button",
                        "a",
                        "[role='button']",
                        ".close-btn",
                        ".close",
                        ".dialog-close",
                        ".icon-close",
                        ".popover-close",
                        ".boss-dialog__close",
                        ".ui-dialog-close"
                      ].join(",");
                      const badActionText = /打招呼|立即沟通|继续沟通|继续联系|发送|发消息|查看|推荐给我/;
                      const closeText = /^(关闭|取消|我知道了|知道了|稍后再说|不感兴趣)$/;
                      const closeClass = /close|dialog-close|icon-close|popover-close|modal-close|cancel|guanbi/i;
                      const popupHint = /打招呼|已发送|发送成功|招呼|继续沟通|相似牛人|更多牛人|为你推荐|推荐/;
                      const candidates = [];
                      const activeResumeDialog = document.querySelector(".dialog-wrap.active");
                      const exactKnownNodes = Array.from(document.querySelectorAll("button,a,[role='button'],div,span,p"))
                        .filter((node) => visible(node))
                        .map((node) => {
                          const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
                          if (!/^(我知道了|知道了)$/.test(text)) return null;
                          const clickable = node.closest("button,a,[role='button']") || node;
                          const root = clickable.closest(rootSelector);
                          const rootText = normalize(root ? root.innerText || root.textContent || "" : "");
                          return {
                            node: clickable,
                            score: 500,
                            text,
                            attrs: "exact-known-button",
                            rootText: rootText.slice(0, 180),
                            rect: rect(clickable)
                          };
                        })
                        .filter(Boolean);
                      candidates.push(...exactKnownNodes);
                      if (!candidates.length) {
                        return {found: false, reason: "post_greet_ack_button_not_found"};
                      }
                      candidates.sort((a, b) => b.score - a.score);
                      const bestAck = candidates[0];
                      bestAck.node.setAttribute("data-codex-post-greet-close", token);
                      return {
                        found: true,
                        token,
                        score: bestAck.score,
                        text: bestAck.text,
                        attrs: bestAck.attrs,
                        rootText: bestAck.rootText,
                        rect: bestAck.rect,
                        preferredAck: true
                      };
                      for (const node of Array.from(document.querySelectorAll(actionSelector))) {
                        if (!visible(node)) continue;
                        const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
                        const attrs = [
                          node.className,
                          node.id,
                          node.getAttribute("ka"),
                          node.getAttribute("aria-label"),
                          node.getAttribute("title")
                        ].map((item) => String(item || "")).join(" ");
                        const root = node.closest(rootSelector);
                        const rootText = normalize(root ? root.innerText || root.textContent || "" : "");
                        const isClose = closeText.test(text) || closeClass.test(attrs) || (text.length <= 4 && /×|x/i.test(text));
                        if (!isClose || badActionText.test(text)) continue;
                        if (activeResumeDialog && activeResumeDialog.contains(node) && !/^(我知道了|知道了)$/.test(text)) continue;
                        let score = 0;
                        if (root && popupHint.test(rootText)) score += 80;
                        if (/^(我知道了|知道了)$/.test(text)) score += 140;
                        if (closeText.test(text)) score += 60;
                        if (closeClass.test(attrs)) score += 45;
                        if (root && root.matches(".dialog-wrap.active")) score += 20;
                        const box = node.getBoundingClientRect();
                        if (box.top < 260 && box.right > window.innerWidth * 0.45) score += 18;
                        if (rootText.length > 0 && rootText.length < 900) score += 10;
                        candidates.push({
                          node,
                          score,
                          text,
                          attrs: attrs.slice(0, 140),
                          rootText: rootText.slice(0, 180),
                          rect: rect(node)
                        });
                      }
                      candidates.sort((a, b) => b.score - a.score);
                      const best = candidates[0];
                      if (!best || best.score < 45) {
                        return {found: false, reason: "no_matching_close_target", candidates: candidates.slice(0, 5).map(({score, text, attrs, rootText, rect}) => ({score, text, attrs, rootText, rect}))};
                      }
                      best.node.setAttribute("data-codex-post-greet-close", token);
                      return {
                        found: true,
                        token,
                        score: best.score,
                        text: best.text,
                        attrs: best.attrs,
                        rootText: best.rootText,
                        rect: best.rect
                      };
                    }""",
                    token,
                ) or {}
            except Exception as error:
                last_reason = "post_greet_popup_scan_failed"
                return {"closed": bool(closed_items), "items": closed_items, "reason": last_reason, "error": safe_text(str(error), 160)}
        if not info.get("found"):
            if closed_items:
                return {"closed": True, "items": closed_items, "reason": "closed_all_found_popups"}
            last_reason = str(info.get("reason") or "no_post_greet_popup")
            break

        try:
            target_text = safe_text(str(info.get("text") or ""), 40)
            is_preferred_ack = target_text in {"知道了", "我知道了"}
            if not is_preferred_ack and attempt_index < attempt_limit - 1:
                last_reason = "waiting_for_ack_button_before_close_fallback"
                page.wait_for_timeout(random.randint(360, 720))
                continue
            locator = page.locator(f"[data-codex-post-greet-close='{info.get('token')}']").first
            click_info = click_post_greet_target(locator, prefer_center=is_preferred_ack)
            page.wait_for_timeout(random.randint(420, 780))
            if marked_target_visible(str(info.get("token") or "")):
                last_reason = "post_greet_target_still_visible_after_click"
                if attempt_index < attempt_limit - 1:
                    page.wait_for_timeout(random.randint(260, 520))
                    continue
                return {
                    "closed": bool(closed_items),
                    "items": closed_items,
                    "reason": last_reason,
                    "target": {
                        "text": target_text,
                        "rootText": safe_text(str(info.get("rootText") or ""), 120),
                        "click": click_info,
                    },
                }
            closed_items.append({
                "text": target_text,
                "preferredAck": is_preferred_ack,
                "action": "clicked_post_greet_ack" if is_preferred_ack else "clicked_post_greet_close_fallback",
                "score": info.get("score"),
                "rootText": safe_text(str(info.get("rootText") or ""), 120),
                "click": click_info,
            })
        except Exception as error:
            last_reason = "post_greet_popup_close_failed"
            if attempt_index < attempt_limit - 1:
                page.wait_for_timeout(random.randint(260, 520))
                continue
            return {
                "closed": bool(closed_items),
                "items": closed_items,
                "reason": last_reason,
                "error": safe_text(str(error), 160),
                "target": {
                    "text": safe_text(str(info.get("text") or ""), 40),
                    "rootText": safe_text(str(info.get("rootText") or ""), 120),
                },
            }

    if closed_items:
        return {"closed": True, "items": closed_items, "reason": "closed_found_popups"}
    return {"closed": False, "items": [], "reason": last_reason}


def post_greet_ack_clicked(result: dict | None) -> bool:
    result = result if isinstance(result, dict) else {}
    items = result.get("items") if isinstance(result.get("items"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        text = safe_text(str(item.get("text") or ""), 40)
        action = str(item.get("action") or "")
        if item.get("preferredAck") or action == "clicked_post_greet_ack" or text in {"知道了", "我知道了"}:
            return True
    return False


def close_recommend_dialogs_after_greet(terminal: BrowserTerminal, frame, attempts: int = 5) -> dict:
    page = terminal.current_page()
    post_greet_popup = close_recommend_post_greet_popup(terminal, frame, attempts=attempts)
    ack_retries: list[dict] = []

    for _ in range(2):
        if post_greet_ack_clicked(post_greet_popup):
            break
        page.wait_for_timeout(random.randint(360, 720))
        retry_popup = close_recommend_post_greet_popup(terminal, frame, attempts=3)
        ack_retries.append({
            "phase": "pre_resume_ack_retry",
            "postGreetPopup": retry_popup,
        })
        if post_greet_ack_clicked(retry_popup):
            break

    resume_dialog_close = close_recommend_resume_dialog(terminal, frame)

    for _ in range(2):
        if resume_dialog_close.get("reason") != "post_greet_ack_visible_before_resume_close":
            break
        page.wait_for_timeout(random.randint(360, 720))
        retry_popup = close_recommend_post_greet_popup(terminal, frame, attempts=3)
        resume_dialog_close = close_recommend_resume_dialog(terminal, frame)
        ack_retries.append({
            "phase": "resume_close_blocked_by_ack_retry",
            "postGreetPopup": retry_popup,
            "resumeDialogClose": resume_dialog_close,
        })

    late_post_greet_popup = {"closed": False, "items": [], "reason": "not_needed"}
    if resume_dialog_close.get("closed") and not post_greet_popup.get("closed"):
        page.wait_for_timeout(random.randint(300, 620))
        late_post_greet_popup = close_recommend_post_greet_popup(terminal, frame, attempts=2)

    return {
        "postGreetPopup": post_greet_popup,
        "resumeDialogClose": resume_dialog_close,
        "ackRetries": ack_retries,
        "latePostGreetPopup": late_post_greet_popup,
        "blockedByAck": resume_dialog_close.get("reason") == "post_greet_ack_visible_before_resume_close",
    }


def read_recommend_resume_dialog_info(frame) -> dict:
    try:
        return frame.evaluate(
            """() => {
              const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
              const active = document.querySelector(".dialog-wrap.active");
              if (!active) {
                return {open: false, text: "", summaryText: "", iframeText: ""};
              }
              const summaryNode = active.querySelector(".resume-right-side")
                || active.querySelector(".resume-summary")
                || active.querySelector(".resume-simple-box");
              const iframe = active.querySelector("iframe");
              let iframeText = "";
              try {
                if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
                  iframeText = [
                    iframe.contentDocument.body.innerText || "",
                    iframe.contentDocument.body.textContent || ""
                  ].map(normalize).filter(Boolean).join("\\n");
                }
              } catch (error) {
                iframeText = "";
              }
              const dialogText = [
                active.innerText || "",
                active.textContent || ""
              ].map(normalize).filter(Boolean).join("\\n");
              const summaryText = normalize(summaryNode ? summaryNode.innerText || summaryNode.textContent || "" : "");
              const progressSource = [summaryText, dialogText].filter(Boolean).join("\\n");
              const progressIndex = progressSource.indexOf("同事沟通进度");
              const colleagueProgressText = progressIndex >= 0 ? progressSource.slice(progressIndex, progressIndex + 700) : "";
              const greet = active.querySelector("button.btn-greet,.resumeGreet button,.button-chat-wrap.resumeGreet button");
              const close = active.querySelector(".close-btn");
              return {
                open: true,
                text: [dialogText, iframeText].filter(Boolean).join("\\n"),
                summaryText,
                iframeText,
                colleagueProgressText,
                hasGreetButton: !!greet,
                greetText: normalize(greet ? greet.innerText || greet.textContent || "" : ""),
                hasCloseButton: !!close
              };
            }"""
        ) or {"open": False}
    except Exception as error:
        return {"open": False, "error": safe_text(str(error), 180)}


def human_browse_recommend_resume_dialog(
    terminal: BrowserTerminal,
    frame,
    resume_info: dict | None = None,
) -> dict:
    if not getattr(terminal, "humanize", False):
        return {"enabled": False, "reason": "humanize_disabled"}
    page = terminal.current_page()
    info = resume_info if isinstance(resume_info, dict) else read_recommend_resume_dialog_info(frame)
    if not info.get("open"):
        return {"enabled": True, "browsed": False, "reason": "resume_dialog_not_open"}

    text = "\n".join(
        str(info.get(key) or "")
        for key in ("summaryText", "iframeText", "text")
        if str(info.get(key) or "").strip()
    )
    text_len = min(3200, len(text))
    target_locator = None
    target_box = None
    selectors = [
        ".dialog-wrap.active .resume-left-side",
        ".dialog-wrap.active .resume-content",
        ".dialog-wrap.active .resume-detail",
        ".dialog-wrap.active .resume-preview",
        ".dialog-wrap.active .resume-right-side",
        ".dialog-wrap.active",
    ]
    for selector in selectors:
        try:
            locator = frame.locator(selector).first
            if locator.count() <= 0:
                continue
            box = locator.bounding_box(timeout=1000)
            if box and float(box.get("width") or 0) > 120 and float(box.get("height") or 0) > 120:
                target_locator = locator
                target_box = box
                break
        except Exception:
            continue

    try:
        if target_box:
            x = float(target_box["x"] + target_box["width"] * random.uniform(0.42, 0.62))
            y = float(target_box["y"] + target_box["height"] * random.uniform(0.34, 0.58))
            move_cursor_like_person(
                terminal,
                x,
                y,
                duration_factor=random.uniform(0.42, 0.72),
                show_trail=False,
            )
        page.wait_for_timeout(random.randint(900, 1700) + int(min(900, text_len) * random.uniform(0.16, 0.34)))

        if text_len < 520:
            rounds = random.randint(1, 2)
        elif text_len < 1400:
            rounds = random.randint(2, 3)
        else:
            rounds = random.randint(3, 4)

        scrolls: list[int] = []
        for _ in range(rounds):
            scrolls.append(random.randint(130, 280))
        if rounds >= 2 and random.random() < 0.68:
            scrolls.insert(random.randint(1, len(scrolls)), -random.randint(45, 125))

        for amount in scrolls:
            humanized_scroll(
                terminal,
                amount,
                locator=target_locator,
                box=target_box,
                corrective=random.random() < 0.42,
            )
            page.wait_for_timeout(random.randint(620, 1450))

        if random.random() < 0.32:
            jitter_mouse(page)
            page.wait_for_timeout(random.randint(420, 980))
        return {
            "enabled": True,
            "browsed": True,
            "textLength": text_len,
            "scrolls": scrolls,
            "targetFound": bool(target_locator),
        }
    except Exception as error:
        try:
            page.wait_for_timeout(random.randint(900, 1500))
        except Exception:
            pass
        return {
            "enabled": True,
            "browsed": False,
            "reason": "browse_failed",
            "error": safe_text(str(error), 160),
        }


def open_recommend_candidate_resume_dialog(
    terminal: BrowserTerminal,
    frame,
    card_locator,
) -> dict:
    page = terminal.current_page()
    close_recommend_resume_dialog(terminal, frame)
    try:
        card_locator.scroll_into_view_if_needed(timeout=3500)
    except Exception:
        pass
    try:
        box = card_locator.bounding_box(timeout=3000)
    except Exception:
        box = None
    try:
        if box:
            width = float(box.get("width") or 1)
            height = float(box.get("height") or 1)
            x = float(box.get("x") or 0) + min(max(width * 0.22, 140.0), max(24.0, width - 190.0))
            y = float(box.get("y") or 0) + height * random.uniform(0.38, 0.62)
            humanized_point_click(terminal, x, y, target_box=box)
        else:
            card_locator.click(position={"x": random.randint(120, 220), "y": random.randint(42, 92)}, timeout=6000, force=True)
        for _ in range(14):
            info = read_recommend_resume_dialog_info(frame)
            if info.get("open"):
                ready = wait_for_recommend_resume_dialog_ready(page, frame, timeout_ms=random.randint(650, 1050))
                return {"opened": True, "info": read_recommend_resume_dialog_info(frame), "readyWait": ready}
            page.wait_for_timeout(240)
        return {"opened": False, "reason": "resume_dialog_not_opened"}
    except Exception as error:
        return {"opened": False, "reason": "open_resume_dialog_failed", "error": safe_text(str(error), 180)}


def recommend_candidate_evidence_text(card_text: str, resume_info: dict | None = None) -> str:
    resume_info = resume_info if isinstance(resume_info, dict) else {}
    parts = [
        str(card_text or ""),
        str(resume_info.get("text") or ""),
        str(resume_info.get("summaryText") or ""),
        str(resume_info.get("iframeText") or ""),
    ]
    return "\n".join(part for part in parts if part.strip())


def extract_recommend_candidate_name(text: str) -> str:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    if not normalized:
        return ""
    tokens = normalized.split(" ")
    for index, token in enumerate(tokens[:10]):
        if token == "面议" or re.match(r"^\d{1,3}(?:-\d{1,3})?K$", token, re.I):
            if index + 1 < len(tokens):
                return safe_text(tokens[index + 1], 24)
    for token in tokens[:6]:
        if token not in {"推荐", "最新", "热搜"} and not re.match(r"^\d", token):
            return safe_text(token, 24)
    return safe_text(tokens[0], 24)


def recommend_candidate_key(card: dict, target_position: str = "") -> str:
    text = str(card.get("text") or "")
    if not text:
        return ""
    digest = hashlib.sha1((str(target_position or "") + "\n" + text[:700]).encode("utf-8", errors="ignore")).hexdigest()
    return digest[:20]


def recommend_target_is_application_technology(target_position: str = "") -> bool:
    return recommend_position_matches(str(target_position or ""), "应用技术经理（工业涂料领域）")


def recommend_target_is_sales_trainee(target_position: str = "") -> bool:
    return recommend_position_matches(str(target_position or ""), "销售管培生")


def recommend_target_is_bentonite_sales(target_position: str = "") -> bool:
    return recommend_position_matches(str(target_position or ""), "膨润土销售人员")


def recommend_target_is_hrbp(target_position: str = "") -> bool:
    target = str(target_position or "")
    compact = normalize_recommend_position(target)
    if any(term in compact for term in ["人力资源管培", "人资管培", "人力资源管理培训"]):
        return True
    return recommend_position_matches(target, "HRBP") or recommend_position_matches(target, "人力资源")


def recommend_target_is_international_business_trainee(target_position: str = "") -> bool:
    return recommend_position_matches(str(target_position or ""), "国际业务管培生")


def recommend_target_is_electrical_engineer(target_position: str = "") -> bool:
    target = normalize_recommend_position(str(target_position or ""))
    return any(term in target for term in ["电气工程师", "电器工程师", "电气自动化"])


def recommend_target_is_oil_sales(target_position: str = "") -> bool:
    target = normalize_recommend_position(str(target_position or ""))
    return any(term in target for term in ["石油销售", "石油钻井", "钻井泥浆"])


def split_proactive_contact_keywords(value) -> list[str]:
    if isinstance(value, list):
        raw_items = value
    else:
        raw_items = re.split(r"[\n,，、;；|/]+", str(value or ""))
    keywords: list[str] = []
    for item in raw_items:
        text = str(item or "").strip()
        if text and text not in keywords:
            keywords.append(text[:40])
    return keywords[:20]


def normalize_proactive_contact_custom_rules(rules: dict | None) -> dict:
    if not isinstance(rules, dict):
        return {"enabled": False, "mode": "default"}
    mode = str(rules.get("mode") or "").strip().lower()
    enabled = mode == "custom" or bool(rules.get("enabled"))
    raw_required = rules.get("requiredChecks") if isinstance(rules.get("requiredChecks"), dict) else {}
    required_checks = {
        "education": raw_required.get("education") is not False,
        "age": raw_required.get("age") is not False,
        "keyword": raw_required.get("keyword") is not False,
    }
    min_education = str(rules.get("minEducation") or "").strip().lower()
    if min_education not in {"", "college", "bachelor", "master"}:
        min_education = ""
    keyword_mode = "all" if str(rules.get("keywordMode") or "").strip().lower() == "all" else "any"
    unknown_policy = "allow" if str(rules.get("unknownPolicy") or "").strip().lower() == "allow" else "skip"
    profile = str(rules.get("profile") or "").strip().lower()
    if profile not in {"", "application_technology", "bentonite_sales", "hrbp", "international_business", "electrical"}:
        profile = ""
    max_age_raw = rules.get("maxAge")
    try:
        max_age = int(max_age_raw)
    except Exception:
        max_age = 0
    if max_age < 16 or max_age > 70:
        max_age = 0
    return {
        "enabled": enabled,
        "mode": "custom" if enabled else "default",
        "requiredChecks": required_checks,
        "minEducation": min_education,
        "maxAge": max_age or None,
        "keywordMode": keyword_mode,
        "unknownPolicy": unknown_policy,
        "profile": profile,
        "keywords": split_proactive_contact_keywords(rules.get("keywords") or rules.get("keywordsText") or rules.get("keywordText") or ""),
    }


def extract_recommend_candidate_education(text: str) -> dict:
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact:
        return {"level": "", "rank": 0, "reason": "education_unknown"}
    explicit_below_college_terms = ["大专以下", "专科以下", "高中及以下", "高中以下", "中专及以下", "中专以下"]
    for term in explicit_below_college_terms:
        if term in compact:
            return {"level": term, "rank": 1, "reason": "education_below_college"}
    qualified_terms = [
        ("博士", 5),
        ("硕士", 4),
        ("研究生", 4),
        ("本科", 3),
        ("统招本科", 3),
        ("大专", 2),
        ("专科", 2),
        ("高职", 2),
    ]
    for term, rank in qualified_terms:
        if term in compact:
            return {"level": term, "rank": rank, "reason": "education_found"}
    for term in ["初中", "高中", "中专", "中技", "技校", "职高", "中职"]:
        if term in compact:
            return {"level": term, "rank": 1, "reason": "education_below_college"}
    return {"level": "", "rank": 0, "reason": "education_unknown"}


def extract_recommend_candidate_age(text: str) -> dict:
    compact = re.sub(r"\s+", "", str(text or ""))
    ages: list[int] = []
    for match in re.finditer(r"(?<!\d)(\d{2})(?:岁|周岁)", compact):
        age = int(match.group(1))
        if 16 <= age <= 70:
            ages.append(age)
    if not ages:
        return {"age": None, "reason": "age_unknown"}
    return {"age": ages[0], "reason": "age_found"}


def llm_semantic_resume_requirement_check(
    text: str,
    target_position: str,
    keywords: list[str],
    keyword_mode: str = "any",
    profile: str = "",
    required: str = "",
) -> dict:
    resume_text = safe_text(str(text or ""), 3200)
    normalized_keywords = [safe_text(str(item or ""), 40) for item in keywords if str(item or "").strip()]
    if not resume_text or not normalized_keywords:
        return {
            "allowed": False,
            "reason": "semantic_check_missing_text_or_keywords",
            "evidence": [],
            "confidence": 0.0,
        }
    config = load_model_config()
    api_key = config.get("apiKey")
    if not api_key:
        return {
            "allowed": False,
            "reason": "semantic_check_model_key_missing",
            "evidence": [],
            "confidence": 0.0,
        }
    profile_notes = {
        "application_technology": "应用技术经理：需要简历明确体现流变助剂、膨润土、工业涂料、涂料研发、涂料工程师任意一个。",
        "bentonite_sales": "膨润土销售：需要简历体现涂料、膨润土、流变助剂任意一个或非常接近的原料/助剂销售经历。",
        "hrbp": "HRBP：需要简历体现人力资源专业、人力资源相关专业或理工科专业。只有招聘/HR实习经历但专业无关且非理工科时不要通过。",
        "international_business": "国际业务管培生：需要专业为国际贸易、英语、俄语、翻译之一，或理工科且英语六级。",
        "electrical": "电气工程师：需要电气工程或自动化专业，并且简历体现 PLC。",
    }
    mode_label = "全部满足" if keyword_mode == "all" else "任意一个满足"
    system_prompt = (
        "你是招聘简历筛选助手，只判断候选人简历内容是否满足岗位筛选要求。"
        "你必须谨慎：只能依据简历/候选人卡片里已经出现的事实判断，不能因为目标岗位名称、候选人的求职意向、招聘方要求而推断满足。"
        "可以识别同义词、近义表达、行业接近经验、英文缩写和常见简写。"
        "如果信息缺失、只是表达兴趣、只是岗位标题接近但简历没有证据，则 matched=false。"
        "只输出 JSON。"
    )
    user_prompt = {
        "targetPosition": safe_text(str(target_position or ""), 80),
        "profile": profile,
        "profileNote": profile_notes.get(profile, ""),
        "required": required or f"{mode_label}：{'、'.join(normalized_keywords)}",
        "keywordMode": keyword_mode if keyword_mode in {"all", "any"} else "any",
        "keywords": normalized_keywords,
        "resumeText": resume_text,
        "outputSchema": {
            "matched": "boolean，是否满足",
            "confidence": "0到1之间的数字",
            "matchedTerms": "数组，命中的关键词或语义接近项",
            "evidence": "数组，每项是简历里的短证据，不要编造",
            "reason": "一句话说明",
        },
    }
    payload = {
        "model": config.get("model", DEFAULT_MODEL_CONFIG["model"]),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.05,
        "max_tokens": 500,
    }
    try:
        content = call_chat_completion(config, api_key, payload, timeout=PROACTIVE_SEMANTIC_TIMEOUT_SECONDS)
        parsed = parse_json_object(content)
    except Exception as exc:
        return {
            "allowed": False,
            "reason": "semantic_check_failed",
            "error": safe_text(str(exc), 180),
            "evidence": [],
            "confidence": 0.0,
        }
    try:
        confidence = float(parsed.get("confidence") or 0)
    except Exception:
        confidence = 0.0
    matched = bool(parsed.get("matched")) and confidence >= 0.62
    evidence = parsed.get("evidence") if isinstance(parsed.get("evidence"), list) else []
    matched_terms = parsed.get("matchedTerms") if isinstance(parsed.get("matchedTerms"), list) else []
    return {
        "allowed": matched,
        "reason": "llm_semantic_requirement_matched" if matched else "llm_semantic_requirement_not_matched",
        "rawReason": safe_text(str(parsed.get("reason") or ""), 180),
        "confidence": max(0.0, min(1.0, confidence)),
        "matchedTerms": [safe_text(str(item), 40) for item in matched_terms[:8]],
        "evidence": [safe_text(str(item), 80) for item in evidence[:6]],
    }


def apply_llm_semantic_requirement_fallback(
    gate: dict,
    text: str,
    target_position: str,
    keywords: list[str],
    keyword_mode: str = "any",
    profile: str = "",
    required: str = "",
) -> dict:
    if gate.get("allowed"):
        return gate
    semantic_check = llm_semantic_resume_requirement_check(
        text=text,
        target_position=target_position,
        keywords=keywords,
        keyword_mode=keyword_mode,
        profile=profile,
        required=required or str(gate.get("required") or ""),
    )
    merged = dict(gate)
    merged["semanticCheck"] = semantic_check
    if semantic_check.get("allowed"):
        old_evidence = gate.get("evidence") if isinstance(gate.get("evidence"), list) else []
        semantic_evidence = semantic_check.get("evidence") if isinstance(semantic_check.get("evidence"), list) else []
        semantic_terms = semantic_check.get("matchedTerms") if isinstance(semantic_check.get("matchedTerms"), list) else []
        merged.update({
            "allowed": True,
            "reason": "llm_semantic_requirement_matched",
            "evidence": list(dict.fromkeys([*old_evidence, *semantic_terms, *semantic_evidence]))[:8],
        })
    return merged


def evaluate_proactive_contact_custom_rules(text: str, target_position: str, rules: dict | None) -> dict:
    config = normalize_proactive_contact_custom_rules(rules)
    if not config.get("enabled"):
        return {"enabled": False, "allowed": True, "reason": "default_rules_enabled"}
    compact = re.sub(r"\s+", "", str(text or ""))
    unknown_policy = str(config.get("unknownPolicy") or "skip")
    required_checks = config.get("requiredChecks") if isinstance(config.get("requiredChecks"), dict) else {}
    checks: list[dict] = []
    failures: list[str] = []

    min_education = str(config.get("minEducation") or "")
    min_rank_by_key = {"college": 2, "bachelor": 3, "master": 4}
    min_label_by_key = {"college": "大专及以上", "bachelor": "本科及以上", "master": "硕士及以上"}
    if required_checks.get("education") is not False and min_education in min_rank_by_key:
        education = extract_recommend_candidate_education(compact)
        rank = int(education.get("rank") or 0)
        if rank <= 0:
            passed = unknown_policy == "allow"
            reason = "education_unknown_allowed" if passed else "education_unknown"
        else:
            passed = rank >= min_rank_by_key[min_education]
            reason = "education_matched" if passed else "education_below_custom_required"
        check = {
            "type": "education",
            "passed": passed,
            "reason": reason,
            "level": education.get("level") or "",
            "rank": rank,
            "required": min_label_by_key[min_education],
        }
        checks.append(check)
        if not passed:
            failures.append(reason)

    max_age = config.get("maxAge")
    if required_checks.get("age") is not False and isinstance(max_age, int) and max_age:
        age_info = extract_recommend_candidate_age(compact)
        age = age_info.get("age")
        if age is None:
            passed = unknown_policy == "allow"
            reason = "age_unknown_allowed" if passed else "age_unknown"
        else:
            passed = int(age) < max_age
            reason = f"age_under_{max_age}" if passed else "age_not_under_custom_limit"
        check = {
            "type": "age",
            "passed": passed,
            "reason": reason,
            "age": age,
            "required": f"{max_age}岁以下",
        }
        checks.append(check)
        if not passed:
            failures.append(reason)

    keywords = split_proactive_contact_keywords(config.get("keywords") or [])
    if required_checks.get("keyword") is not False and keywords:
        profile = str(config.get("profile") or "")
        if profile == "application_technology":
            evidence = [term for term in keywords if re.sub(r"\s+", "", term) in compact]
            passed = bool(evidence)
            required = "任意关键词：" + "、".join(keywords)
            reason = "matched_application_technology_keyword" if passed else "missing_application_technology_keyword"
        elif profile == "bentonite_sales":
            gate = recommend_candidate_bentonite_sales_keyword_check(compact, "膨润土销售人员")
            passed = bool(gate.get("allowed"))
            required = str(gate.get("required") or "涂料/膨润土/流变助剂任意一个")
            evidence = gate.get("evidence") if isinstance(gate.get("evidence"), list) else []
            reason = str(gate.get("reason") or ("matched_bentonite_sales_keyword" if passed else "missing_bentonite_sales_keyword"))
        elif profile == "hrbp":
            gate = recommend_candidate_hrbp_major_check(compact, "hrbp")
            passed = bool(gate.get("allowed"))
            required = str(gate.get("required") or "人力资源专业、人力资源相关专业或理工科专业")
            evidence = gate.get("evidence") if isinstance(gate.get("evidence"), list) else []
            reason = str(gate.get("reason") or ("matched_hrbp_related_major" if passed else "missing_hrbp_related_major"))
        elif profile == "international_business":
            gate = recommend_candidate_international_business_major_check(compact, "国际业务管培生")
            passed = bool(gate.get("allowed"))
            required = str(gate.get("required") or "国际贸易/英语/俄语/翻译，或理工科专业且英语六级")
            evidence = gate.get("evidence") if isinstance(gate.get("evidence"), list) else []
            reason = str(gate.get("reason") or ("matched_international_business_major" if passed else "missing_international_business_major"))
        elif profile == "electrical":
            gate = recommend_candidate_electrical_engineer_check(compact, "电气工程师")
            passed = bool(gate.get("allowed"))
            required = str(gate.get("required") or "电气工程或自动化专业，且简历中体现 PLC")
            evidence = gate.get("evidence") if isinstance(gate.get("evidence"), list) else []
            reason = str(gate.get("reason") or ("matched_electrical_engineer_major_and_plc" if passed else "missing_electrical_requirements"))
        else:
            evidence = [term for term in keywords if re.sub(r"\s+", "", term) in compact]
            if config.get("keywordMode") == "all":
                passed = len(evidence) == len(keywords)
                required = "全部关键词：" + "、".join(keywords)
                reason = "all_keywords_matched" if passed else "missing_some_custom_keywords"
            else:
                passed = bool(evidence)
                required = "任意关键词：" + "、".join(keywords)
                reason = "any_keyword_matched" if passed else "missing_any_custom_keyword"
        semantic_check: dict = {}
        if not passed and not failures and profile not in {"application_technology"}:
            semantic_check = llm_semantic_resume_requirement_check(
                text=text,
                target_position=target_position,
                keywords=keywords,
                keyword_mode=str(config.get("keywordMode") or "any"),
                profile=profile,
                required=required,
            )
            if semantic_check.get("allowed"):
                passed = True
                reason = "llm_semantic_requirement_matched"
                semantic_evidence = semantic_check.get("evidence") if isinstance(semantic_check.get("evidence"), list) else []
                semantic_terms = semantic_check.get("matchedTerms") if isinstance(semantic_check.get("matchedTerms"), list) else []
                evidence = list(dict.fromkeys([*evidence, *semantic_terms, *semantic_evidence]))[:8]
        check = {
            "type": "keyword",
            "passed": passed,
            "reason": reason,
            "required": required,
            "profile": profile,
            "evidence": evidence,
        }
        if semantic_check:
            check["semanticCheck"] = semantic_check
        checks.append(check)
        if not passed:
            failures.append(reason)

    allowed = not failures
    return {
        "enabled": True,
        "allowed": allowed,
        "reason": "custom_rules_matched" if allowed else failures[0],
        "targetPosition": safe_text(str(target_position or ""), 80),
        "requiredChecks": required_checks,
        "unknownPolicy": unknown_policy,
        "keywordMode": config.get("keywordMode") or "any",
        "checks": checks,
    }


def recommend_candidate_education_check(text: str, target_position: str = "") -> dict:
    compact = re.sub(r"\s+", "", str(text or ""))
    if (
        recommend_target_is_application_technology(target_position)
        or recommend_target_is_hrbp(target_position)
        or recommend_target_is_international_business_trainee(target_position)
        or recommend_target_is_electrical_engineer(target_position)
    ):
        min_rank = 3
    elif (
        recommend_target_is_sales_trainee(target_position)
        or recommend_target_is_bentonite_sales(target_position)
        or recommend_target_is_oil_sales(target_position)
    ):
        min_rank = 2
    else:
        return {
            "allowed": True,
            "level": "",
            "rank": 0,
            "reason": "education_not_required_for_position",
            "required": "",
        }
    min_label = "本科及以上" if min_rank >= 3 else "大专及以上"
