    if not compact:
        return {
            "allowed": False,
            "level": "",
            "rank": 0,
            "reason": "education_unknown",
            "required": min_label,
        }
    explicit_below_college_terms = [
        "大专以下",
        "专科以下",
        "高中及以下",
        "高中以下",
        "中专及以下",
        "中专以下",
    ]
    below_college_terms = [
        "初中",
        "高中",
        "中专",
        "中技",
        "技校",
        "职高",
        "中职",
    ]
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
    for term in explicit_below_college_terms:
        if term in compact:
            return {
                "allowed": False,
                "level": term,
                "rank": 1,
                "reason": "education_below_college",
                "required": min_label,
            }
    for term, rank in qualified_terms:
        if term in compact:
            return {
                "allowed": rank >= min_rank,
                "level": term,
                "rank": rank,
                "reason": "education_qualified" if rank >= min_rank else "education_below_required_for_position",
                "required": min_label,
            }
    for term in below_college_terms:
        if term in compact:
            return {
                "allowed": False,
                "level": term,
                "rank": 1,
                "reason": "education_below_college",
                "required": min_label,
            }
    return {
        "allowed": False,
        "level": "",
        "rank": 0,
        "reason": "education_unknown",
        "required": min_label,
    }


def recommend_candidate_age_check(text: str, target_position: str = "") -> dict:
    if recommend_target_is_application_technology(target_position):
        max_age = 45
        reason_suffix = "application_technology"
    elif recommend_target_is_sales_trainee(target_position):
        max_age = 25
        reason_suffix = "sales_trainee"
    elif recommend_target_is_bentonite_sales(target_position):
        max_age = 35
        reason_suffix = "bentonite_sales"
    elif recommend_target_is_hr_screening_position(target_position):
        max_age = 30
        reason_suffix = recommend_hr_position_category(target_position) or "hr"
    elif recommend_target_is_international_business_trainee(target_position):
        max_age = 25
        reason_suffix = "international_business_trainee"
    elif recommend_target_is_electrical_engineer(target_position):
        max_age = 35
        reason_suffix = "electrical_engineer"
    elif recommend_target_is_oil_sales(target_position):
        max_age = 45
        reason_suffix = "oil_sales"
    else:
        return {
            "allowed": True,
            "age": None,
            "reason": "age_not_required_for_position",
        }
    compact = re.sub(r"\s+", "", str(text or ""))
    ages = []
    for match in re.finditer(r"(?<!\d)(\d{2})(?:岁|周岁)", compact):
        age = int(match.group(1))
        if 16 <= age <= 70:
            ages.append(age)
    if not ages:
        return {
            "allowed": False,
            "age": None,
            "reason": f"age_unknown_for_{reason_suffix}",
            "required": f"{max_age}岁以下",
        }
    age = ages[0]
    return {
        "allowed": age < max_age,
        "age": age,
        "reason": f"age_under_{max_age}" if age < max_age else f"age_{max_age}_or_above_for_{reason_suffix}",
        "required": f"{max_age}岁以下",
    }


def recommend_candidate_bentonite_sales_keyword_check(text: str, target_position: str = "") -> dict:
    if not recommend_target_is_bentonite_sales(target_position):
        return {
            "allowed": True,
            "reason": "keyword_not_required_for_position",
            "evidence": [],
        }
    compact = re.sub(r"\s+", "", str(text or ""))
    required_terms = ["涂料", "膨润土", "流变助剂"]
    evidence = [term for term in required_terms if term in compact]
    return {
        "allowed": bool(evidence),
        "reason": "matched_bentonite_sales_keyword" if evidence else "missing_bentonite_sales_keyword",
        "required": "涂料/膨润土/流变助剂任意一个",
        "evidence": evidence,
    }


def recommend_candidate_hrbp_major_check(text: str, target_position: str = "") -> dict:
    if not recommend_target_is_hr_screening_position(target_position):
        return {
            "allowed": True,
            "reason": "major_not_required_for_position",
            "evidence": [],
        }
    raw = str(text or "")
    compact = re.sub(r"\s+", "", raw)
    if not compact:
        return {
            "allowed": False,
            "reason": "major_unknown_for_hrbp",
            "required": "人力资源、人力资源相关专业或理工科专业",
            "evidence": [],
        }

    related_terms = [
        "人力资源管理",
        "人力资源",
        "人事管理",
        "劳动与社会保障",
        "劳动关系",
        "社会保障",
        "工商管理人力资源方向",
        "工商管理人力资源",
        "公共事业管理人力资源",
        "组织与人力资源",
    ]
    stem_terms = [
        "理工科",
        "工科",
        "理科",
        "工学",
        "理学",
        "化学",
        "化工",
        "应用化学",
        "化学工程",
        "高分子",
        "材料",
        "材料科学",
        "机械",
        "电气",
        "自动化",
        "计算机",
        "软件工程",
        "土木",
        "环境工程",
        "生物工程",
        "制药工程",
        "安全工程",
        "工业工程",
        "数学",
        "物理",
    ]
    major_markers = ["专业", "所学", "主修", "毕业于", "方向", "学院", "系", "本科", "学士", "硕士", "研究生"]
    evidence: list[str] = []
    for term in related_terms:
        index = compact.find(term)
        if index < 0:
            continue
        window = compact[max(0, index - 16): index + len(term) + 16]
        if term in {"人力资源管理", "劳动与社会保障", "劳动关系", "工商管理人力资源方向"}:
            evidence.append(term)
            continue
        if any(marker in window for marker in major_markers):
            evidence.append(term)
    for term in stem_terms:
        index = compact.find(term)
        if index < 0:
            continue
        window = compact[max(0, index - 16): index + len(term) + 16]
        if term in {"理工科", "工科", "理科", "工学", "理学"} or any(marker in window for marker in major_markers):
            evidence.append(term)
    return {
        "allowed": bool(evidence),
        "reason": "matched_hrbp_allowed_major" if evidence else "missing_hrbp_allowed_major",
        "required": "人力资源、人力资源相关专业或理工科专业",
        "evidence": evidence[:5],
    }


def recommend_candidate_international_business_major_check(text: str, target_position: str = "") -> dict:
    if not recommend_target_is_international_business_trainee(target_position):
        return {
            "allowed": True,
            "reason": "major_not_required_for_position",
            "evidence": [],
        }
    raw = str(text or "")
    compact = re.sub(r"\s+", "", raw)
    if not compact:
        return {
            "allowed": False,
            "reason": "major_unknown_for_international_business_trainee",
            "required": "国际贸易/英语/俄语/翻译，或理工科专业且英语六级",
            "evidence": [],
        }

    direct_major_terms = [
        "国际经济与贸易",
        "国际贸易",
        "国贸",
        "商务英语",
        "英语语言文学",
        "英语专业",
        "俄语",
        "翻译",
    ]
    evidence: list[str] = []
    for term in direct_major_terms:
        if term in compact:
            evidence.append(term)

    major_markers = ["专业", "所学", "主修", "毕业于", "方向", "学院", "系", "本科", "学士", "硕士", "研究生"]
    for term in ["英语", "俄语", "翻译"]:
        index = compact.find(term)
        while index >= 0:
            window = compact[max(0, index - 12): index + len(term) + 12]
            after = compact[index + len(term): index + len(term) + 4]
            if any(marker in window for marker in major_markers) and not re.search(r"(四级|六级|4级|6级|cet)", after, re.I):
                evidence.append(term)
                break
            index = compact.find(term, index + len(term))

    if evidence:
        return {
            "allowed": True,
            "reason": "matched_international_business_allowed_major",
            "required": "国际贸易/英语/俄语/翻译，或理工科专业且英语六级",
            "evidence": list(dict.fromkeys(evidence))[:6],
        }

    stem_terms = [
        "理工科",
        "工科",
        "理科",
        "工学",
        "理学",
        "化学",
        "化工",
        "应用化学",
        "化学工程",
        "高分子",
        "材料",
        "材料科学",
        "机械",
        "电气",
        "自动化",
        "计算机",
        "软件工程",
        "土木",
        "环境工程",
        "生物工程",
        "制药工程",
        "安全工程",
        "工业工程",
        "数学",
        "物理",
    ]
    stem_evidence = [term for term in stem_terms if term in compact]
    english_six = bool(re.search(r"(英语.{0,6}(六级|6级)|大学英语六级|cet[-\s]?6|cet六级)", compact, re.I))
    if stem_evidence and english_six:
        return {
            "allowed": True,
            "reason": "matched_stem_major_with_cet6",
            "required": "国际贸易/英语/俄语/翻译，或理工科专业且英语六级",
            "evidence": stem_evidence[:5] + ["英语六级"],
        }

    return {
        "allowed": False,
        "reason": "missing_international_business_major_or_stem_cet6",
        "required": "国际贸易/英语/俄语/翻译，或理工科专业且英语六级",
        "evidence": [],
    }


def recommend_candidate_electrical_engineer_check(text: str, target_position: str = "") -> dict:
    if not recommend_target_is_electrical_engineer(target_position):
        return {
            "allowed": True,
            "reason": "electrical_gate_not_required_for_position",
            "evidence": [],
        }
    raw = str(text or "")
    compact = re.sub(r"\s+", "", raw)
    compact_lower = compact.lower()
    if not compact:
        return {
            "allowed": False,
            "reason": "missing_electrical_engineer_resume_text",
            "required": "电气工程或自动化专业，且简历中体现 PLC",
            "evidence": [],
        }

    plc_evidence = "plc" in compact_lower or "可编程逻辑控制器" in compact
    major_evidence: list[str] = []
    direct_major_terms = [
        "电气工程及其自动化",
        "电气工程",
        "电气自动化",
        "自动化专业",
        "自动化本科",
        "自动化学院",
        "自动化系",
    ]
    for term in direct_major_terms:
        if term in compact:
            major_evidence.append(term)
    if not major_evidence:
        major_markers = ["专业", "所学", "主修", "毕业于", "方向", "学院", "系", "本科", "学士", "硕士", "研究生"]
        index = compact.find("自动化")
        while index >= 0:
            window = compact[max(0, index - 14): index + 14]
            if any(marker in window for marker in major_markers):
                major_evidence.append("自动化")
                break
            index = compact.find("自动化", index + len("自动化"))

    evidence = list(dict.fromkeys(major_evidence))
    if plc_evidence:
        evidence.append("PLC")
    if not major_evidence:
        return {
            "allowed": False,
            "reason": "missing_electrical_or_automation_major",
            "required": "电气工程或自动化专业",
            "evidence": evidence[:6],
        }
    if not plc_evidence:
        return {
            "allowed": False,
            "reason": "missing_plc_evidence",
            "required": "简历中体现 PLC",
            "evidence": evidence[:6],
        }
    return {
        "allowed": True,
        "reason": "matched_electrical_engineer_major_and_plc",
        "required": "电气工程或自动化专业，且简历中体现 PLC",
        "evidence": evidence[:6],
    }


def recommend_candidate_matches_application_technology(text: str) -> dict:
    raw = str(text or "")
    compact = re.sub(r"\s+", "", raw)
    weighted_terms = [
        ("工业涂料", 5),
        ("涂料研发", 5),
        ("涂料", 4),
        ("配方", 3),
        ("流变", 3),
        ("助剂", 3),
        ("防腐", 3),
        ("树脂", 2),
        ("油性", 2),
        ("水性", 2),
        ("研发", 2),
        ("技术经理", 2),
        ("技术总监", 2),
        ("应用技术", 2),
        ("技术应用", 2),
        ("技术支持", 2),
        ("化工", 1),
        ("高分子", 1),
        ("材料", 1),
    ]
    score = 0
    evidence: list[str] = []
    for term, weight in weighted_terms:
        if term in compact:
            score += weight
            evidence.append(term)
    sales_only = "销售" in compact and "涂料" not in compact and "化工" not in compact
    matched = score >= 7 and "涂料" in compact and not sales_only
    reason = "matched_application_technology" if matched else "缺少应用技术/涂料研发相关证据"
    if sales_only:
        reason = "偏销售且没有涂料/化工证据"
    return {
        "matched": matched,
        "score": score,
        "evidence": evidence[:8],
        "reason": reason,
    }


def scroll_recommend_frame(terminal: BrowserTerminal, frame) -> dict:
    page = terminal.current_page()
    try:
        before = frame.evaluate("""() => Math.round((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0)""")
    except Exception:
        before = 0
    iframe_box = None
    try:
        iframe_box = frame.frame_element().bounding_box()
    except Exception:
        iframe_box = None
    amount = random.randint(520, 760)
    try:
        if terminal.humanize and iframe_box:
            humanized_scroll(terminal, amount, box=iframe_box)
        else:
            page.mouse.wheel(0, amount)
            page.wait_for_timeout(random.randint(320, 620))
    except Exception:
        pass
    try:
        after = frame.evaluate("""() => Math.round((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0)""")
    except Exception:
        after = before
    if abs(int(after or 0) - int(before or 0)) <= 4:
        try:
            after = frame.evaluate(
                """amount => {
                  const el = document.scrollingElement || document.documentElement;
                  const before = Math.round(el.scrollTop || window.scrollY || 0);
                  el.scrollTop = before + amount;
                  window.scrollTo(0, before + amount);
                  return Math.round(el.scrollTop || window.scrollY || 0);
                }""",
                amount,
            )
        except Exception:
            after = before
    return {
        "scrolled": abs(int(after or 0) - int(before or 0)) > 4,
        "before": int(before or 0),
        "after": int(after or 0),
    }


def scroll_past_recommend_similar_if_needed(terminal: BrowserTerminal, frame) -> dict:
    try:
        info = frame.evaluate(
            """() => {
              const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 8 && box.height > 8
                  && style.display !== "none"
                  && style.visibility !== "hidden"
                  && box.bottom >= 0
                  && box.top <= window.innerHeight;
              };
              const nodes = Array.from(document.querySelectorAll(".similar-geek-wrap,.similar-geek-list,.similar-card-wrap,.similar-geek-item"));
              const target = nodes.find((el) => visible(el));
              if (!target) return { found: false };
              const box = target.getBoundingClientRect();
              return {
                found: true,
                text: normalize(target.innerText || target.textContent || "").slice(0, 80),
                rect: {
                  x: Math.round(box.x),
                  y: Math.round(box.y),
                  width: Math.round(box.width),
                  height: Math.round(box.height)
                }
              };
            }"""
        ) or {}
    except Exception as error:
        return {"found": False, "error": safe_text(str(error), 120)}
    if not info.get("found"):
        return {"found": False}
    page = terminal.current_page()
    try:
        before = frame.evaluate("""() => Math.round((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0)""")
    except Exception:
        before = 0
    iframe_box = None
    try:
        iframe_box = frame.frame_element().bounding_box()
    except Exception:
        iframe_box = None
    rect = info.get("rect") if isinstance(info.get("rect"), dict) else {}
    height = int(rect.get("height") or 220)
    amount = int(max(150, min(280, height * random.uniform(0.62, 0.82))))
    try:
        if terminal.humanize and iframe_box:
            humanized_scroll(terminal, amount, box=iframe_box, corrective=False)
        else:
            page.mouse.wheel(0, amount)
            page.wait_for_timeout(random.randint(220, 420))
    except Exception:
        pass
    try:
        after = frame.evaluate("""() => Math.round((document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0)""")
    except Exception:
        after = before
    scrolled = {
        "scrolled": abs(int(after or 0) - int(before or 0)) > 4,
        "before": int(before or 0),
        "after": int(after or 0),
        "amount": amount,
    }
    return {
        "found": True,
        "action": "ignored_similar_recommendation_and_small_scrolled",
        "text": safe_text(str(info.get("text") or ""), 80),
        **scrolled,
    }


def click_recommend_greet_followup_if_needed(terminal: BrowserTerminal, frame) -> dict:
    return {"clicked": False, "reason": "legacy_recommend_greet_followup_disabled"}
    token = f"codex_recommend_followup_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    try:
        info = frame.evaluate(
            """token => {
              const words = ["确定", "确认", "发送", "立即沟通", "继续沟通"];
              const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
              const visible = (el) => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 8 && box.height > 8
                  && style.display !== "none"
                  && style.visibility !== "hidden"
                  && box.bottom >= 0
                  && box.right >= 0
                  && box.top <= window.innerHeight
                  && box.left <= window.innerWidth;
              };
              const candidates = Array.from(document.querySelectorAll("button,a,[role='button'],.btn"))
                .filter((el) => visible(el))
                .filter((el) => {
                  const label = normalize(el.innerText || el.textContent || el.getAttribute("aria-label") || "");
                  if (!words.some((word) => label === word || label.includes(word))) return false;
                  if (el.closest(".candidate-card-wrap")) return false;
                  return true;
                });
              const target = candidates[0];
              if (!target) return { found: false };
              target.setAttribute("data-codex-recommend-followup", token);
              const box = target.getBoundingClientRect();
              return {
                found: true,
                text: normalize(target.innerText || target.textContent || target.getAttribute("aria-label") || ""),
                rect: {
                  x: Math.round(box.x),
                  y: Math.round(box.y),
                  width: Math.round(box.width),
                  height: Math.round(box.height)
                }
              };
            }""",
            token,
        ) or {}
    except Exception as error:
        return {"clicked": False, "error": safe_text(str(error), 140)}
    if not info.get("found"):
        return {"clicked": False, "reason": "no_followup"}
    try:
        locator = frame.locator(f'[data-codex-recommend-followup="{token}"]').first
        humanized_locator_click(terminal, locator, force=True)
        terminal.current_page().wait_for_timeout(random.randint(760, 1260))
        return {
            "clicked": True,
            "text": safe_text(str(info.get("text") or ""), 40),
        }
    except Exception as error:
        return {
            "clicked": False,
            "text": safe_text(str(info.get("text") or ""), 40),
            "error": safe_text(str(error), 140),
        }


def normalize_agent_actions(actions, limit: int | None = 6) -> list[dict]:
    if not isinstance(actions, list):
        return []
    allowed = {"click", "fill", "upload", "press", "wait", "goto", "observe", "scroll", "done", "stop"} | FUNCTION_TOOL_NAMES
    normalized = []
    selected = actions if limit is None else actions[: int(limit)]
    for action in selected:
        if not isinstance(action, dict):
            continue
        kind = str(action.get("action") or action.get("tool") or action.get("name") or "").lower()
        if kind not in allowed:
            continue
        args = action.get("args") if isinstance(action.get("args"), dict) else {}
        merged = {**args, **action, "action": kind}
        normalized.append(merged)
    return normalized


def compact_context_for_model(context: dict, task: str = "", trace: list[dict] | None = None) -> dict:
    """Shrink the raw DOM snapshot before sending it to the model.

    The executor still keeps the full Playwright locators in BrowserTerminal.cache.
    The model only needs a small, task-relevant menu of elements plus tool schemas.
    """
    elements = context.get("elements") if isinstance(context.get("elements"), dict) else {}
    compact_elements: dict[str, list[dict]] = {}
    counts: dict[str, int] = {}
    for kind, items in elements.items():
        if not isinstance(items, list):
            continue
        counts[kind] = len(items)
        compact_elements[kind] = rank_context_elements(items, kind, task)[:12]

    text = str(context.get("bodyTextPreview") or "")
    recent_trace = []
    for item in (trace or [])[-4:]:
        if isinstance(item, dict):
            recent_trace.append({
                "step": item.get("step"),
                "thought": safe_text(item.get("thought", ""), 120),
                "actions": item.get("actions", [])[:6],
                "results": compact_results(item.get("results", [])),
            })

    return {
        "title": context.get("title", ""),
        "url": context.get("url", ""),
        "textPreview": safe_text(text, 750),
        "elementCounts": counts,
        "elements": compact_elements,
        "fileInputs": compact_file_inputs(context.get("fileInputs", [])),
        "recentTrace": recent_trace,
        "availableFunctions": function_call_schemas(),
        "tokenMode": "compact_function_calls",
    }


def rank_context_elements(items: list[dict], kind: str, task: str = "") -> list[dict]:
    scored = []
    terms = extract_match_terms(task)
    for pos, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        label = safe_text(item.get("label", ""), 160)
        score = 100 - pos
        label_lower = label.lower()
        for term in terms:
            if term and term in label_lower:
                score += 70
        if kind in {"button", "input"}:
            score += 8
        if any(mark in label_lower for mark in ["file", "upload", "resume", "send", "chat", "message"]):
            score += 25
        scored.append((score, {"index": item.get("index"), "label": label}))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in scored]


def extract_match_terms(text: str) -> list[str]:
    raw = str(text or "").lower()
    terms = set(re.findall(r"[a-z0-9_]{2,}", raw))
    cjk = re.findall(r"[\u4e00-\u9fff]{2,}", raw)
    for chunk in cjk:
        if len(chunk) <= 8:
            terms.add(chunk)
        else:
            for index in range(0, max(0, len(chunk) - 1), 2):
                terms.add(chunk[index:index + 2])
    return [term for term in terms if len(term) >= 2][:40]


def compact_file_inputs(file_inputs) -> list[dict]:
    compact = []
    if not isinstance(file_inputs, list):
        return compact
    for item in file_inputs[:8]:
        if isinstance(item, dict):
            compact.append({
                "index": item.get("index"),
                "id": safe_text(item.get("id", ""), 60),
                "name": safe_text(item.get("name", ""), 60),
                "accept": safe_text(item.get("accept", ""), 80),
                "multiple": bool(item.get("multiple")),
                "visible": bool(item.get("visible")),
            })
    return compact


def compact_results(results) -> list[dict]:
    compact = []
    if not isinstance(results, list):
        return compact
    for result in results[-4:]:
        if not isinstance(result, dict):
            continue
        compact.append({
            "message": safe_text(result.get("message", ""), 180),
            "blocked": bool(result.get("blocked")),
            "done": bool(result.get("done")),
            "confirmRequired": bool(result.get("confirmRequired")),
        })
    return compact


def function_call_schemas() -> list[dict]:
    return [
        {
            "name": "observe_page_summary",
            "when": "Need a fresh compact page view without sending the full DOM.",
            "args": {"target": "optional focus, e.g. upload area or chat panel"},
        },
        {
            "name": "find_element",
            "when": "Need to locate an element by visible text, intent, or role before click/fill/upload. Use the returned numeric index directly in the next click/fill/upload (e.g. target=\"3\").",
            "args": {"target": "text or purpose of the element"},
        },
        {
            "name": "verify_result",
            "when": "Need to check whether expected text/state is now visible.",
            "args": {"value": "expected visible text"},
        },
        {
            "name": "recover_from_error",
            "when": "Previous action failed; request a refreshed compact observation and pick a different strategy.",
            "args": {"target": "error or failed goal"},
        },
        {
            "name": "chat_read_context",
            "when": "Chat task: read current conversation before drafting.",
            "args": {},
        },
        {
            "name": "chat_load_history",
            "when": "Chat task: after opening a conversation, scroll upward in the chat panel to load older messages before drafting.",
            "args": {"value": "optional max scroll rounds, default 8"},
        },
        {
            "name": "chat_find_input",
            "when": "Chat task: find the message input box.",
            "args": {"target": "optional input description"},
        },
        {
            "name": "chat_fill_draft",
            "when": "Chat task: fill a reply draft, do not directly send.",
            "args": {"value": "draft text"},
        },
        {
            "name": "chat_request_send_confirmation",
            "when": "Chat task: ask the user to confirm sending the current draft.",
            "args": {},
        },
        {
            "name": "chat_send_resume",
            "when": "BOSS/chat task: send the user's resume using the visible '发简历' toolbar button. The backend checks whether the button is disabled and asks for confirmation before clicking on third-party sites.",
            "args": {},
        },
        {
            "name": "recruiter_send_company_info",
            "when": "Recruiter-side BOSS business action for AI应用开发相关岗位 only: send the configured company/basic-condition introduction to the current or named candidate. Do not use this for sales, HR, application-technology, electrical, or other non-AI positions. The backend opens 常用语, hovers the matching row, and clicks its 发送 button.",
            "args": {
                "targetCandidate": "optional candidate name from the user, for example 陈刚; omit to operate on the current candidate",
            },
        },
        {
            "name": "recruiter_send_common_phrase",
            "when": "Recruiter-side BOSS chat task for AI应用开发相关岗位 only: send a configured common phrase by opening '常用语', selecting the phrase, and clicking '发送'. Use phraseKey='basic_conditions' only for AI application-development basic conditions; do not send common phrases to sales, HR, application-technology, electrical, or other non-AI positions.",
            "args": {
                "phraseKey": "optional key, e.g. basic_conditions",
                "phrase": "optional exact common phrase text",
                "targetCandidate": "optional candidate name",
            },
        },
        {
            "name": "recruiter_process_unread_all_positions",
            "when": "Recruiter-side BOSS high-level workflow: process all unread recruitment messages across configured positions. The backend switches to the unread tab, opens candidates, reads the applied position, applies boss_chat_rules screening/knowledge rules, asks questions, requests resumes, skips unsuitable/unclear cases, and records a batch report. For direct-resume roles in boss_chat_rules, the backend must first send the configured resumeRequestPrompt in the chat, then execute 求简历; BOSS 运营A/运营B use '可以发一份简历过来吗', and 财务AI direct-resume roles use their configured prompt. Positions not configured in boss_chat_rules must be recorded and skipped with no reply.",
            "args": {
                "maxTotal": "optional safety limit, default 80",
                "dateScope": "optional: today, yesterday, or today_yesterday",
                "targetPosition": "optional position filter; omit for all configured positions",
            },
        },
        {
            "name": "recruiter_process_current_position",
            "when": "Recruiter-side BOSS high-level workflow: process the currently opened candidate according to their applied position. Use this after manually opening a candidate or when the user says to handle the current chat. For direct-resume roles in boss_chat_rules, first send the configured resumeRequestPrompt in the chat, then execute 求简历; BOSS 运营A/运营B use '可以发一份简历过来吗', and 财务AI direct-resume roles use their configured prompt.",
            "args": {
                "targetCandidate": "optional candidate name",
                "openUnreplied": "true to open the next unread candidate first; usually false",
            },
        },
        {
            "name": "recruiter_proactive_contact_recommended_candidates",
            "when": "Recruiter-side BOSS proactive workflow for 推荐牛人. Use this when the user asks 主动联系、推荐牛人、主动打招呼、批量打招呼. The backend must: open BOSS 推荐牛人, read the selected job from .job-selecter-wrap .ui-dropmenu-label, switch the job dropdown if it is not the targetPosition, verify the selected job again, then process normal .candidate-card-wrap cards one by one: click the card content area first, wait for the .dialog-wrap.active online resume dialog, extract the resume/summary text, first skip the candidate when 同事沟通进度 shows another account/colleague has already contacted them, then apply all proactive-contact gates, and only then click the dialog's button.btn-greet. For 应用技术经理（工业涂料领域）, require 本科及以上, age under 45, and any one resume/card keyword among 流变助剂、膨润土、工业涂料、涂料研发、涂料工程师; missing education, age, or all keywords must be skipped. For 销售管培生, require age under 25 and at least 大专; age 25+, unknown age, below-college, or unknown education must be skipped. For 膨润土销售人员, require age under 35, at least 大专, and the card/resume text must contain any one of 涂料、膨润土、流变助剂; missing age, missing education, or missing keyword must be skipped. For HRBP/人力资源/人力资源管培生, require 本科及以上, age under 30, and major in 人力资源, HR-related, or STEM/理工科 majors; below bachelor, age 30+, unknown age, or missing/unknown/unrelated non-STEM major must be skipped. For 国际业务管培生, require age under 25, bachelor or above, and either major in 国际贸易/英语/俄语/翻译 or a STEM major with CET-6/英语六级; missing age, below bachelor, unknown major, or no allowed major/STEM+CET6 evidence must be skipped. For 电气工程师, require 本科及以上, age under 35, major in 电气工程 or 自动化, and PLC evidence in the card/resume text; below bachelor, missing age, missing major, or no PLC evidence must be skipped. Close the resume dialog after a skip or after greeting; if a post-greet popup/card appears, prefer clicking “知道了/我知道了”, otherwise use only close/稍后再说 style controls, and do not perform any extra follow-up/confirm click. If BOSS inserts a similar/more-candidates recommendation block such as .similar-geek-wrap or “为你推荐 与某某相似的牛人”, ignore it and use a small scroll only, then re-observe the next normal candidate card. Do not large-scroll twice after a greet; process candidates one by one. Skip candidates already greeted by identity/state. Optional requireMatch can enable 应用技术/工业涂料 evidence filtering.",
            "args": {
                "targetPosition": "target BOSS recommend position, default 应用技术经理（工业涂料领域）; must match the selected job before any 打招呼 click",
                "maxTotal": "optional safety limit, default 10",
                "dryRun": "true to only preview matched candidates without clicking 打招呼",
                "requireMatch": "optional; true to filter candidate cards by 应用技术/工业涂料 evidence, default false for 挨个打招呼 on the selected job page",
            },
        },
        {
            "name": "recruiter_answer_candidate_questions",
            "when": "Recruiter-side BOSS knowledge-base action: answer the current or named candidate's latest 1-3 unanswered questions from the configured companyKnowledgeBase. If the knowledge base has no answer, do not reply; only record the question for later completion.",
            "args": {
                "targetCandidate": "optional candidate name",
            },
        },
        {
            "name": "recruiter_screen_basic_conditions",
            "when": "Recruiter-side BOSS screening task for AI应用开发相关岗位 only: first send the configured basic-condition common phrase if it has not been sent; after the candidate replies, request resume only when the reply clearly accepts the required conditions. Sales, HR, application-technology, electrical, and other non-AI positions must use position-specific screening/knowledge rules, not 常用语.",
            "args": {
                "openUnreplied": "true to open the next unread/unhandled candidate first; false to operate on the current candidate",
                "targetCandidate": "optional candidate name from the user, for example 陈刚",
            },
        },
        {
            "name": "recruiter_screen_recent_with_followup",
            "when": "Recruiter-side BOSS screening task: process the recent N contacts, then monitor only those same contacts for follow-up replies until the idle timeout expires.",
            "args": {
                "count": "number of recent contacts to process, default 10",
                "idleSeconds": "end after this many seconds with no new reply from the watched contacts, default 30",
            },
        },
        {
            "name": "recruiter_request_resume",
            "when": "Recruiter-side BOSS chat task: open a named candidate or the next visible candidate with unread/unhandled messages, then use the '求简历' toolbar button and complete the in-page confirm step. When this action is reached through a direct-resume workflow, the backend sends the configured resumeRequestPrompt before clicking 求简历 if no resume has been received/requested yet.",
            "args": {
                "openUnreplied": "true to open the next unread/unhandled candidate first; false to operate on the currently opened candidate",
                "targetCandidate": "optional candidate name from the user, for example 陈刚",
            },
        },
        {
            "name": "recruiter_mark_unsuitable",
            "when": "Recruiter-side BOSS chat task: mark the current or named candidate as '不合适'. This changes candidate status, so the backend asks for confirmation before clicking.",
            "args": {
                "targetCandidate": "optional candidate name from the user, for example 陈刚",
                "openUnreplied": "usually false; true only when the user explicitly asks to process the next unread/unhandled candidate",
            },
        },
        {
            "name": "job51_process_unread_all_positions",
            "when": "Recruiter-side 51job workflow: process unread messages from the 51job all-position list. The backend opens 51job chat, clicks 未读, clicks 全部岗位, then handles contacts from that unified unread list using shared boss_chat_rules screening/knowledge rules. 财务AI direct-resume roles first send the configured resumeRequestPrompt through 51job's message sender, then run 51job resume download/request logic; 运营A/运营B must not send prompt text on 51job and should directly run 51job resume download/request logic. Do not switch positions one by one.",
            "args": {
                "maxTotal": "optional safety limit, default 40",
                "targetPosition": "ignored for this workflow; processing always uses 全部岗位",
            },
        },
        {
            "name": "job51_process_current_position",
            "when": "Recruiter-side 51job workflow: process the currently opened 51job candidate according to mapped position rules. 财务AI direct-resume roles first send resumeRequestPrompt, then run 51job resume download/request logic; 运营A/运营B must not send prompt text on 51job and should directly run 51job resume download/request logic.",
            "args": {},
        },
        {
            "name": "job51_answer_candidate_questions",
            "when": "Recruiter-side 51job knowledge-base action: answer the current candidate's latest unanswered questions from companyKnowledgeBase.",
            "args": {},
        },
        {
            "name": "job51_request_resume",
            "when": "Recruiter-side 51job chat task: handle the current candidate's resume only when screening says the candidate is suitable. 51 Hexinhong/job51_b now uses the same online-resume PDF save flow as 51 Songfengfeng/job51_a: click only real online-resume entries inside the current chat message list, validate that the opened page is a real resume detail page, trigger PDF download, and accept only valid PDF files. Visible online-resume preview text is not a real resume and must not be converted into a PDF or counted as downloaded.",
            "args": {},
        },
        {
            "name": "job51_proactive_contact_recommended_candidates",
            "when": "Recruiter-side 51job proactive workflow for 人才望远镜/推荐候选人/立即Hi聊. The backend uses 51job CDP 9224 and must enter by clicking the visible 人才望远镜 nav entry (#sensor_recommand_menu); it must not directly open the recommendation URL as a fallback. After entering 人才望远镜, it switches to the target 51job position, closes ad/AI recommendation popups, reads visible resume cards, skips cards with a top-left 已看 badge, applies BOSS-style proactive gates, then clicks 立即Hi聊 only for qualified candidates. Use dryRun=true to preview candidates without greeting.",
            "args": {
                "targetPosition": "target 51job recommend position, default 膨润土销售人员",
                "maxTotal": "optional safety limit, default 10",
                "dryRun": "true to only preview matched candidates without clicking 立即Hi聊",
            },
        },
        {
            "name": "zhilian_process_unread_all_positions",
            "when": "Recruiter-side 智联 workflow: process unread messages from 智联聊天. The backend uses CDP 9226, opens 智联聊天, selects 未读 and 全部职位, then handles contacts with shared boss_chat_rules screening/knowledge rules. 财务AI direct-resume roles first send the configured resumeRequestPrompt through 智联's message sender, then run 要附件简历 logic; 运营A/运营B must not send prompt text on 智联 and should directly run 要附件简历/附件下载逻辑. It uses 智联 textarea and 要附件简历 controls, not BOSS/51 DOM.",
            "args": {
                "maxTotal": "optional safety limit, default 40",
                "targetPosition": "optional 智联 position filter; omit for all configured 智联 positions",
            },
        },
        {
            "name": "zhilian_process_current_position",
            "when": "Recruiter-side 智联 workflow: process the currently opened 智联 candidate according to mapped position rules. 财务AI direct-resume roles first send resumeRequestPrompt, then run 要附件简历 logic; 运营A/运营B must not send prompt text on 智联 and should directly run 要附件简历/附件下载逻辑.",
            "args": {},
        },
        {
            "name": "zhilian_answer_candidate_questions",
            "when": "Recruiter-side 智联 knowledge-base action: answer the current candidate's latest unanswered questions from companyKnowledgeBase.",
            "args": {},
        },
        {
            "name": "zhilian_request_resume",
            "when": "Recruiter-side 智联 chat task: request the current candidate's attachment resume by clicking 要附件简历 when screening says the candidate is suitable.",
            "args": {},
        },
        {
            "name": "zhilian_proactive_contact_recommended_candidates",
            "when": "Recruiter-side 智联 proactive workflow for 推荐人才. The backend uses CDP 9226, opens 智联推荐人才, switches the target job through the job tabs or 选择职位 side selector, processes only fully visible .recommend-item resume cards, opens each candidate's .new-shortcut-resume__modal detail resume first, reads the full detail text, skips already-contacted/continued/colleague-contacted candidates, applies BOSS/51-style proactive gates from the detail evidence, then clicks only the detail-modal 打招呼 button for qualified candidates. It never clicks 打电话. Use dryRun=true to open details and preview matched candidates without greeting.",
            "args": {
                "targetPosition": "target 智联 recommend position, default 电气工程师",
                "maxTotal": "optional safety limit, default 10",
                "dryRun": "true to only preview matched candidates without clicking 打招呼",
            },
        },
    ]


def find_elements_for_query(terminal: BrowserTerminal, query: str, limit: int = 8) -> list[dict]:
    terminal.collect_page_context(limit=120)
    terms = extract_match_terms(query)
    matches = []
    for item in terminal.cache:
        label = item.label or ""
        label_lower = label.lower()
        score = 0
        for term in terms:
            if term in label_lower:
                score += 10
        if query and query.lower() in label_lower:
            score += 30
        if not terms and query:
            score = 1
        if score > 0:
            matches.append((score, {
                "index": item.index,
                "kind": item.kind,
                "label": safe_text(label, 160),
            }))
    matches.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in matches[:limit]]


def read_unread_badge_state(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    state = safe_eval(page, r"""() => {
      const normalize = (text) => String(text || "").replace(/\s+/g, " ").trim();
      const visible = (el) => {
        const box = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const redLike = (value) => {
        const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!match) return false;
        const r = Number(match[1]);
        const g = Number(match[2]);
        const b = Number(match[3]);
        return r >= 180 && g <= 125 && b <= 125;
      };
      const isFilterText = (text) => {
        const words = ["全部", "未读", "新招呼", "仅沟通", "更多"];
        return words.filter((word) => text.includes(word)).length >= 3 && text.length < 100;
      };
      const isUnreadBadge = (el) => {
        if (!visible(el)) return false;
        const box = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = normalize(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "");
        const cls = String(el.className || "");
        const small = box.width <= 40 && box.height <= 40;
        const numeric = /^\d{1,3}$/.test(text);
        const named = /notice-badge|nav-chat-num|unread|badge|red|dot|count/i.test(cls);
        return (small && redLike(style.backgroundColor)) || (numeric && redLike(style.backgroundColor)) || named;
      };
      const findChatRow = (badge) => {
        let node = badge;
        for (let depth = 0; depth < 8 && node; depth += 1, node = node.parentElement) {
          const box = node.getBoundingClientRect();
          const text = normalize(node.innerText || node.textContent || "");
          const cls = String(node.className || "");
          if (/header|nav|label-list|filter|tab|menu|toolbar/i.test(cls)) return null;
          if (isFilterText(text)) return null;
          const looksLikeChat = /friend|chat|message|dialog|conversation|session|contact|item/i.test(cls);
          const goodBox = box.width >= 150 && box.width <= Math.max(620, window.innerWidth * 0.56) && box.height >= 36 && box.height <= 210;
          if (goodBox && text.length >= 4 && looksLikeChat) return node;
          if (goodBox && text.length >= 8 && /\b\d{1,2}:\d{2}\b|昨天|今天|HR|人事|招聘|经理|主管|顾问|专员/i.test(text)) return node;
        }
        return null;
      };
      const readUnreadTabCount = () => {
        let best = 0;
        const labels = Array.from(document.body ? document.body.querySelectorAll(".label-list li, .label-list span, li, [role='tab']") : []);
        for (const el of labels) {
          if (!visible(el)) continue;
          const box = el.getBoundingClientRect();
          if (box.y > 220 || box.width > 180 || box.height > 60) continue;
          const text = normalize(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "");
          if (!text.includes("未读")) continue;
          const match = text.match(/未读\s*[（(]?\s*(\d{1,3})\s*[）)]?/);
          if (match) best = Math.max(best, Number(match[1]) || 0);
          else if (/notice-badge|unread|badge|red|dot|count/i.test(String(el.className || ""))) best = Math.max(best, 1);
        }
        return best;
      };
      const badges = Array.from(document.body ? document.body.querySelectorAll("*") : []).filter(isUnreadBadge);
      const seen = new Set();
      const items = [];
      let navCount = 0;
      const tabUnreadCount = readUnreadTabCount();
      for (const badge of badges) {
        const badgeText = normalize(badge.innerText || badge.textContent || badge.getAttribute("aria-label") || badge.getAttribute("title") || "");
        const badgeClass = String(badge.className || "");
        const badgeBox = badge.getBoundingClientRect();
        if (/nav-chat-num/i.test(badgeClass)) {
          navCount = Math.max(navCount, Number(badgeText) || 1);
          continue;
        }
        const row = findChatRow(badge);
        if (!row) continue;
        const rowBox = row.getBoundingClientRect();
        const rowText = normalize(row.innerText || row.textContent || "");
        const key = `${Math.round(rowBox.x)}:${Math.round(rowBox.y)}:${rowText.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const badgeCount = Math.max(1, Number(badgeText) || 1);
        items.push({
          label: rowText.slice(0, 180),
          badgeText: badgeText.slice(0, 12),
          badgeClass: badgeClass.slice(0, 80),
          count: badgeCount,
          x: Math.round(rowBox.x),
          y: Math.round(rowBox.y),
          w: Math.round(rowBox.width),
          h: Math.round(rowBox.height)
        });
      }
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      const total = items.reduce((sum, item) => sum + Math.max(1, Number(item.count) || 1), 0);
      return { count: Math.max(total, navCount, tabUnreadCount), rowCount: items.length, navCount, tabUnreadCount, items: items.slice(0, 12) };
    }""") or {}
    if not isinstance(state, dict):
        state = {}
    items = state.get("items") if isinstance(state.get("items"), list) else []
    signature = json.dumps(
        {
            "count": state.get("count", 0),
            "navCount": state.get("navCount", 0),
            "tabUnreadCount": state.get("tabUnreadCount", 0),
            "items": [
                {
                    "label": safe_text(str(item.get("label", "")), 120),
                    "count": item.get("count", 1),
                    "x": item.get("x"),
                    "y": item.get("y"),
                }
                for item in items[:8]
                if isinstance(item, dict)
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return {
        "count": int(state.get("count") or 0),
        "rowCount": int(state.get("rowCount") or 0),
        "navCount": int(state.get("navCount") or 0),
        "tabUnreadCount": int(state.get("tabUnreadCount") or 0),
        "items": items[:8],
        "signature": signature,
    }


def prepare_unread_chat_list(terminal: BrowserTerminal) -> dict:
    page = terminal.current_page()
    result = safe_eval(page, r"""() => {
      const normalize = (text) => String(text || "").replace(/\s+/g, " ").trim();
      const visible = (el) => {
        const box = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const nodes = Array.from(document.body ? document.body.querySelectorAll(".label-list li, .label-list span, li, [role='tab']") : []);
      let clickedUnreadTab = false;
      let clickedUnreadBox = null;
      for (const node of nodes) {
        if (!visible(node)) continue;
        const box = node.getBoundingClientRect();
        if (box.y > 220 || box.width > 180 || box.height > 60) continue;
        const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
        if (!/未读\s*[（(]?\s*\d{0,3}\s*[）)]?/.test(text)) continue;
        const target = node.closest("li,[role='tab'],button,a") || node;
        const targetBox = target.getBoundingClientRect();
        clickedUnreadBox = {
          x: Math.round(targetBox.x),
          y: Math.round(targetBox.y),
          w: Math.round(targetBox.width),
          h: Math.round(targetBox.height)
        };
        target.click();
        clickedUnreadTab = true;
        window.__codexClickedUnreadTabAt = Date.now();
        break;
      }

      const containers = Array.from(document.body ? document.body.querySelectorAll(
        ".user-list-content,.user-list,.chat-content,.chat-user,.list-warp,[class*='user-list' i],[class*='friend-list' i],[class*='session-list' i]"
      ) : []);
      let resetCount = 0;
      for (const el of containers) {
        const box = el.getBoundingClientRect();
        if (box.width < 180 || box.width > 520 || box.height < 120) continue;
        if (box.x > Math.min(620, window.innerWidth * 0.48)) continue;
        if (el.scrollHeight <= el.clientHeight + 8) continue;
        el.scrollTop = 0;
        resetCount += 1;
      }
      return { clickedUnreadTab, clickedUnreadBox, resetCount };
    }""") or {}
    if isinstance(result, dict) and result.get("clickedUnreadBox") and terminal.visual_cursor:
        try:
            box = result.get("clickedUnreadBox") or {}
            x = float(box.get("x") or 0) + float(box.get("w") or 0) / 2
            y = float(box.get("y") or 0) + float(box.get("h") or 0) / 2
            move_cursor_like_person(terminal, x, y, duration_factor=0.55)
            move_visual_cursor(page, x, y, click=True)
        except Exception:
            pass
    try:
        terminal.current_page().wait_for_timeout(750)
    except Exception:
        pass
    return result if isinstance(result, dict) else {}


def find_unreplied_chat_target(terminal: BrowserTerminal, require_unread_badge: bool = False) -> dict | None:
    page = terminal.current_page()
    token = f"codex_unreplied_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    found = page.evaluate(
        r"""({ token, requireUnreadBadge }) => {
          const normalize = (text) => String(text || "").replace(/\s+/g, " ").trim();
          const lower = (text) => normalize(text).toLowerCase();
          const visible = (el) => {
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 8 && box.height > 8 && box.bottom > 0 && box.y < window.innerHeight && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
          };
          const clickableSelector = [
            "a[href]",
            "[role='button']",
            "[role='link']",
            "[role='listitem']",
            "[onclick]",
            "li",
            "[class*='friend' i]",
            "[class*='item' i]",
            "[class*='chat' i]",
            "[class*='dialog' i]",
            "[class*='conversation' i]",
            "[class*='session' i]",
            "[class*='message' i]"
          ].join(",");
          const positive = [
            "未回复", "未读", "新消息", "待回复", "对方回复", "对方已回复", "刚刚回复",
            "new message", "unread", "unreplied", "reply needed"
          ];
          const soft = ["你好", "在吗", "方便", "面试", "沟通", "岗位", "职位", "回复", "简历", "薪资", "可以", "？", "?"];
          const negative = [
            "发送", "选择简历", "上传", "模板", "设置", "职位推荐", "隐私", "帮助", "简历附件",
            "保存", "删除", "退出", "登录", "注册"
          ];
          const weakNegative = ["已读", "我：", "我:", "我的"];
          const filterWords = ["全部", "未读", "新招呼", "仅沟通", "更多"];
          const rejectFilterOrChrome = (el, text, box) => {
            const low = lower(text);
            const cls = String(el.className || "").toLowerCase();
            const role = String(el.getAttribute("role") || "").toLowerCase();
            const tag = String(el.tagName || "").toLowerCase();
            if (role === "tab" || role === "menuitem" || role === "option") return true;
            if (tag === "button") return true;
            if (/header|navbar|nav|toolbar|filter|tab|menu|search|footer|pagination/.test(cls + " " + role)) return true;
            const filterHits = filterWords.filter((word) => text.includes(word)).length;
            if (filterHits >= 3 && text.length < 80) return true;
            if (low.includes("all") && low.includes("unread") && text.length < 80) return true;
            if (box.height < 30 || box.height > 190) return true;
            if (box.width < 120) return true;
            return false;
          };
          const hasUnreadBadge = (el) => {
            const nodes = [el, ...Array.from(el.querySelectorAll("*")).slice(0, 80)];
            for (const node of nodes) {
              const box = node.getBoundingClientRect();
              if (box.width <= 0 || box.height <= 0) continue;
              const attrs = [
                node.className || "",
                node.getAttribute && node.getAttribute("aria-label") || "",
                node.getAttribute && node.getAttribute("title") || ""
              ].join(" ").toLowerCase();
              const txt = normalize(node.innerText || node.textContent || "");
              if (/unread|badge|dot|count|notice|red/.test(attrs)) return true;
              if (/^\d{1,2}$/.test(txt) && box.width <= 28 && box.height <= 28) return true;
              const style = window.getComputedStyle(node);
              const bg = style.backgroundColor || "";
              const redLike = /rgb\((?:2[0-5]{2}|1[6-9]\d),\s*(?:0|[1-8]\d|9\d),\s*(?:0|[1-8]\d|9\d)/.test(bg);
              if (redLike && box.width <= 28 && box.height <= 28) return true;
            }
            return false;
          };
          const findChatRowFromBadge = (badge) => {
            let node = badge;
            for (let depth = 0; depth < 8 && node; depth += 1, node = node.parentElement) {
              const box = node.getBoundingClientRect();
              const text = normalize(node.innerText || node.textContent || "");
              const cls = String(node.className || "");
              const meta = `${cls} ${node.tagName || ""}`;
              if (/header|nav|label-list|filter|tab|menu|toolbar/i.test(meta)) return null;
              if (depth > 0 && (box.width < 120 || box.height < 30)) continue;
              if (depth > 0 && rejectFilterOrChrome(node, text, box)) return null;
              const goodBox = box.width >= 150 && box.width <= Math.max(620, window.innerWidth * 0.56) && box.height >= 36 && box.height <= 210;
              const looksLikeChat = /friend|chat|message|dialog|conversation|session|contact|item/i.test(meta);
              if (goodBox && text.length >= 4 && looksLikeChat) return node;
              if (goodBox && text.length >= 8 && /\b\d{1,2}:\d{2}\b|昨天|今天|HR|人事|招聘|经理|主管|顾问|专员/i.test(text)) return node;
            }
            return null;
          };
          const badgeNodes = Array.from(document.body ? document.body.querySelectorAll("*") : []).filter((node) => {
            if (!visible(node)) return false;
            const box = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
            const cls = String(node.className || "");
            const small = box.width <= 40 && box.height <= 40;
            const numeric = /^\d{1,3}$/.test(text);
            const named = /notice-badge|unread|badge|red|dot|count/i.test(cls) && !/nav-chat-num/i.test(cls);
            const bg = style.backgroundColor || "";
            const red = /rgb\((?:2[0-5]{2}|1[8-9]\d),\s*(?:0|[1-9]\d|1[01]\d),\s*(?:0|[1-9]\d|1[01]\d)/.test(bg);
            return named || (small && red) || (numeric && red);
          });
          let badgeBest = null;
          let badgeBestInfo = null;
          for (const badge of badgeNodes) {
            const row = findChatRowFromBadge(badge);
            if (!row) continue;
            const rowBox = row.getBoundingClientRect();
            const rowText = normalize(row.innerText || row.textContent || "");
            let score = 500;
            if (rowText.includes("草稿")) score -= 160;
            if (rowText.includes("已读")) score -= 80;
            if (/\b\d{1,2}:\d{2}\b|昨天|今天/.test(rowText)) score += 40;
            if (/HR|人事|招聘|经理|主管|顾问|专员/i.test(rowText)) score += 35;
            score -= Math.max(0, rowBox.y - 160) / 20;
            if (!badgeBestInfo || score > badgeBestInfo.score) {
              badgeBest = row;
              badgeBestInfo = { score, label: rowText, reason: "unread-badge" };
            }
          }
          if (badgeBest && badgeBestInfo && badgeBestInfo.score >= 280) {
            const badgeBestBox = badgeBest.getBoundingClientRect();
            badgeBest.setAttribute("data-codex-unreplied-target", token);
            return {
              label: badgeBestInfo.label,
              score: badgeBestInfo.score,
              reason: badgeBestInfo.reason,
              x: Math.round(badgeBestBox.x),
              y: Math.round(badgeBestBox.y),
              w: Math.round(badgeBestBox.width),
              h: Math.round(badgeBestBox.height),
              candidates: [{ label: badgeBestInfo.label.slice(0, 120), score: badgeBestInfo.score, reason: badgeBestInfo.reason }]
            };
          }
          const unreadFilterLikelyActive = () => {
            const clickedRecently = Number(window.__codexClickedUnreadTabAt || 0) > Date.now() - 6000;
            if (clickedRecently) return true;
            const labels = Array.from(document.body ? document.body.querySelectorAll(".label-list li, .label-list span, li, [role='tab']") : []);
            for (const node of labels) {
              if (!visible(node)) continue;
              const box = node.getBoundingClientRect();
              if (box.y > 220 || box.width > 180 || box.height > 60) continue;
              const text = normalize(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || "");
              if (!text.includes("未读")) continue;
              const meta = [
                node.className || "",
                node.getAttribute("aria-selected") || "",
                node.getAttribute("data-selected") || ""
              ].join(" ").toLowerCase();
              if (/active|selected|current|cur|checked|true/.test(meta)) return true;
              const style = window.getComputedStyle(node);
              if (/rgb\((?:0|1?\d?\d),\s*(?:120|1[3-9]\d|2[0-5]\d),\s*(?:120|1[3-9]\d|2[0-5]\d)/.test(style.color || "")) return true;
            }
            return false;
          };
          const findFirstUnreadFilteredRow = () => {
            const rows = Array.from(document.body ? document.body.querySelectorAll([
              ".geek-item-wrap",
              ".geek-item",
              ".friend-item",
              ".dialog-item",
              ".conversation-item",
              ".session-item",
              "[class*='geek-item' i]",
              "[class*='friend' i]",
              "[class*='dialog' i]",
              "[class*='conversation' i]",
              "[class*='session' i]",
              "[role='listitem']"
            ].join(",")) : []);
            let best = null;
            let bestInfo = null;
            const viewportWidth = window.innerWidth || 1280;
            for (const row of rows) {
              if (!visible(row)) continue;
              const box = row.getBoundingClientRect();
              const text = normalize(row.innerText || row.textContent || "");
              if (!text || text.length < 4 || text.length > 300) continue;
              if (box.x > Math.min(680, viewportWidth * 0.52) || box.y < 120) continue;
              if (rejectFilterOrChrome(row, text, box)) continue;
              let score = 430 - Math.max(0, box.y - 120) / 8;
              if (/\b\d{1,2}:\d{2}\b|刚刚|今天|昨天/.test(text)) score += 45;
              if (/HR|人事|招聘|经理|主管|顾问|专员|AI|实习/i.test(text)) score += 25;
              if (/selected/.test(String(row.className || ""))) score -= 35;
              const clickable = row.closest("a,li,[role='listitem'],[onclick],.geek-item-wrap,.geek-item") || row;
              if (!bestInfo || score > bestInfo.score) {
                best = clickable;
                bestInfo = { label: text, score, reason: "unread-filter-first-row", box };
              }
            }
            return best && bestInfo ? { row: best, ...bestInfo } : null;
          };
          if (requireUnreadBadge && unreadFilterLikelyActive()) {
            const firstUnread = findFirstUnreadFilteredRow();
            if (firstUnread && firstUnread.score >= 300) {
              firstUnread.row.setAttribute("data-codex-unreplied-target", token);
              const rowBox = firstUnread.row.getBoundingClientRect();
              return {
                label: firstUnread.label,
                score: firstUnread.score,
                reason: firstUnread.reason,
                x: Math.round(rowBox.x),
                y: Math.round(rowBox.y),
                w: Math.round(rowBox.width),
                h: Math.round(rowBox.height),
                candidates: [{ label: firstUnread.label.slice(0, 120), score: firstUnread.score, reason: firstUnread.reason }]
              };
            }
          }
          if (requireUnreadBadge) return null;
          const nodes = Array.from(document.body ? document.body.querySelectorAll(clickableSelector) : []);
          let best = null;
          let bestScore = 0;
          let bestReason = "";
          let debug = [];
          const viewportWidth = window.innerWidth || 1280;
          for (const el of nodes) {
            if (!visible(el)) continue;
            const text = normalize(el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "");
            if (text.length < 2 || text.length > 260) continue;
            const low = lower(text);
            const box = el.getBoundingClientRect();
            if (rejectFilterOrChrome(el, text, box)) continue;
            let score = 0;
            const reasons = [];
            for (const word of positive) {
              if (low.includes(word.toLowerCase())) {
                score += 220;
                reasons.push(word);
              }
            }
            for (const word of soft) {
              if (low.includes(word.toLowerCase())) {
                score += 26;
                if (reasons.length < 3) reasons.push(word);
              }
            }
            for (const word of negative) {
              if (low.includes(word.toLowerCase())) score -= 130;
            }
            for (const word of weakNegative) {
              if (low.includes(word.toLowerCase())) score -= 70;
            }
            const href = String(el.getAttribute("href") || "").toLowerCase();
            const cls = String(el.className || "").toLowerCase();
            const role = String(el.getAttribute("role") || "").toLowerCase();
            const meta = href + " " + cls + " " + role;
            if (/chat|message|im|dialog|geek\/chat|friend|conversation|session|contact/.test(meta)) {
              score += 70;
              reasons.push("chat-row");
            }
            if (hasUnreadBadge(el)) {
              score += 160;
              reasons.push("unread-badge");
            }
            if (/\b\d{1,2}:\d{2}\b/.test(text) || /今天|昨天|周一|周二|周三|周四|周五|周六|周日/.test(text)) {
              score += 38;
              reasons.push("time");
            }
            if (/hr|boss|招聘|人事|经理|主管|顾问|顾问|专员|总监/i.test(text)) score += 28;
            if (box.height >= 42 && box.height <= 140) score += 42;
            if (box.width >= 180 && box.width <= Math.max(560, viewportWidth * 0.55)) score += 28;
            if (box.x < viewportWidth * 0.48) score += 45;
            if (box.x > viewportWidth * 0.62) score -= 70;
            if (/input|textarea|select/i.test(String(el.tagName || ""))) score -= 200;
            if (score > 40) {
              debug.push({ label: text.slice(0, 80), score, x: Math.round(box.x), y: Math.round(box.y), h: Math.round(box.height), reason: reasons.join(",") });
            }
            if (score > bestScore) {
              best = el;
              bestScore = score;
              bestReason = reasons.join(",") || "聊天列表候选";
            }
          }
          debug.sort((a, b) => b.score - a.score);
          if (!best || bestScore < 120) return { candidates: debug.slice(0, 5), rejected: true };
          best.setAttribute("data-codex-unreplied-target", token);
          const bestBox = best.getBoundingClientRect();
          return {
            label: normalize(best.innerText || best.textContent || best.getAttribute("aria-label") || best.getAttribute("title") || ""),
            score: bestScore,
            reason: bestReason,
            x: Math.round(bestBox.x),
            y: Math.round(bestBox.y),
            w: Math.round(bestBox.width),
            h: Math.round(bestBox.height),
            candidates: debug.slice(0, 5)
          };
        }""",
        {"token": token, "requireUnreadBadge": require_unread_badge},
    )
    if not found or found.get("rejected"):
        return None
    locator = page.locator(f"[data-codex-unreplied-target='{token}']").first
    return {
        "locator": locator,
        "label": str(found.get("label") or ""),
        "score": found.get("score"),
        "reason": str(found.get("reason") or ""),
        "x": found.get("x"),
        "y": found.get("y"),
        "w": found.get("w"),
        "h": found.get("h"),
    }


def resolve_index_placeholder(target: str, matches: list[dict]) -> str:
    text = str(target or "").strip()
    if not text:
        return text

    # Only treat as index when the target itself is numeric.
    if text.isdigit():
        return text

    # Common explicit index patterns.
    m = re.search(r"(?:index|编号)\s*[:=：]?\s*(\d+)", text, flags=re.I)
    if m:
        return m.group(1)

    lowered = text.lower()
    if "find_element" not in lowered and "以上" not in text and "index" not in lowered:
        return text

    if not isinstance(matches, list) or not matches:
        return text

    first = matches[0] if isinstance(matches[0], dict) else None
    index = first.get("index") if first else None
    return str(index) if isinstance(index, int) else text


def is_unresolved_index_placeholder(target: str) -> bool:
    text = str(target or "").strip().lower()
    if not text:
        return False
    return "find_element" in text and "index" in text


def describe_file_input(locator) -> str:
    try:
        return locator.evaluate(
            """(el) => [
              el.id || "",
              el.name || "",
              el.getAttribute("accept") || "",
              el.getAttribute("aria-label") || "",
