                    return
                self.send_json(result)
            elif path == "/api/pause":
                payload = self.read_json()
                paused = bool(payload.get("paused", payload.get("pause", True)))
                reason = str(payload.get("reason") or "").strip()
                self.send_json({"ok": True, "pause": SERVICE.set_pause(paused, reason)})
            elif path == "/api/options":
                self.send_json(SERVICE.set_options(self.read_json()))
            elif path == "/api/recruiter/process-messages/start":
                result = SERVICE.start_boss_process_task(self.read_json())
                self.send_json(result, status=202 if result.get("ok") else 500)
            elif path == "/api/recruiter/process-messages/cancel":
                payload = self.read_json()
                result = SERVICE.cancel_boss_process_task(
                    str(payload.get("taskId") or payload.get("id") or ""),
                    str(payload.get("reason") or ""),
                )
                self.send_json(result, status=200 if result.get("ok") else 404)
            elif path == "/api/recruiter/process-messages":
                payload = self.read_json()
                options = payload.get("options")
                if isinstance(options, dict):
                    SERVICE.set_options(options)
                SERVICE.set_pause(False, "开始 BOSS 消息处理前自动解除暂停")
                timing = SERVICE.start_operation_timing("chat", "BOSS处理全部未读消息")
                raw_max_total = payload.get("maxTotal", payload.get("count", 40))
                max_total = int(raw_max_total if raw_max_total is not None else 40)
                try:
                    with SERVICE.lock:
                        terminal = SERVICE.get_terminal()
                        result = SERVICE.screen_all_recruiter_unread_basic_conditions(
                            terminal,
                            max_total=max_total,
                            target_position=str(payload.get("targetPosition") or ""),
                        )
                    finished_timing = SERVICE.finish_operation_timing(timing, "success")
                    if isinstance(result, dict) and finished_timing:
                        result["timings"] = finished_timing
                except PauseRequested as error:
                    finished_timing = SERVICE.finish_operation_timing(timing, "paused", str(error))
                    self.send_json({"reply": str(error), "paused": True, "pause": SERVICE.pause_state(), "timings": finished_timing})
                    return
                except Exception as error:
                    finished_timing = SERVICE.finish_operation_timing(timing, "failed", str(error))
                    self.send_json({"error": str(error), "timings": finished_timing}, status=500)
                    return
                self.send_json(compact_process_messages_response(result))
            elif path == "/api/recruiter/proactive-contact":
                payload = self.read_json()
                options = payload.get("options")
                with SERVICE.lock:
                    if isinstance(options, dict):
                        SERVICE.set_options(options)
                    terminal = SERVICE.get_terminal()
                    result = SERVICE.proactive_contact_recommended_candidates(
                        terminal,
                        target_position=str(payload.get("targetPosition") or "应用技术经理（工业涂料领域）"),
                        max_total=int(payload.get("maxTotal") or payload.get("count") or 10),
                        dry_run=bool(payload.get("dryRun", False)),
                        require_match=bool(payload.get("requireMatch", False)),
                        custom_rules=payload.get("customRules") if isinstance(payload.get("customRules"), dict) else None,
                    )
                self.send_json(result)
            elif path == "/api/51job/process-messages":
                payload = self.read_json()
                options = payload.get("options")
                if isinstance(options, dict):
                    SERVICE.set_options(options)
                SERVICE.set_pause(False, "开始 51job 消息处理前自动解除暂停")
                timing = SERVICE.start_operation_timing("chat", "51job处理全部未读消息")
                raw_max_total = payload.get("maxTotal", payload.get("count", 40))
                max_total = int(raw_max_total if raw_max_total is not None else 40)
                timeout_seconds = max(180, min(600, max_total * 45 + 90))
                try:
                    result = SERVICE.with_job51_terminal(
                        lambda job51_terminal: SERVICE.job51_process_unread_all_positions(
                            job51_terminal,
                            max_total=max_total,
                            target_position=str(payload.get("targetPosition") or ""),
                        ),
                        timeout_seconds=timeout_seconds,
                    )
                    finished_timing = SERVICE.finish_operation_timing(timing, "success")
                    if isinstance(result, dict) and finished_timing:
                        result["timings"] = finished_timing
                except Exception as error:
                    finished_timing = SERVICE.finish_operation_timing(timing, "failed", str(error))
                    self.send_json({"error": str(error), "timings": finished_timing}, status=500)
                    return
                self.send_json(result)
            elif path == "/api/51job/proactive-contact":
                payload = self.read_json()
                options = payload.get("options")
                if isinstance(options, dict):
                    SERVICE.set_options(options)
                SERVICE.set_pause(False, "开始 51job 主动联系前自动解除暂停")
                timing = SERVICE.start_operation_timing("chat", "51job主动联系预览")
                max_total = int(payload.get("maxTotal") or payload.get("count") or 10)
                timeout_seconds = max(90, min(420, max_total * 35 + 60))
                try:
                    result = SERVICE.with_job51_terminal(
                        lambda job51_terminal: SERVICE.job51_proactive_contact_recommended_candidates(
                            job51_terminal,
                            target_position=str(payload.get("targetPosition") or ""),
                            max_total=max_total,
                            dry_run=bool(payload.get("dryRun", False)),
                        ),
                        timeout_seconds=timeout_seconds,
                    )
                    finished_timing = SERVICE.finish_operation_timing(timing, "success")
                    if isinstance(result, dict) and finished_timing:
                        result["timings"] = finished_timing
                except Exception as error:
                    finished_timing = SERVICE.finish_operation_timing(timing, "failed", str(error))
                    self.send_json({"error": str(error), "timings": finished_timing}, status=500)
                    return
                self.send_json(result)
            elif path == "/api/51job/download-resume-attachment":
                payload = self.read_json()
                options = payload.get("options")
                if isinstance(options, dict):
                    SERVICE.set_options(options)
                result = SERVICE.with_job51_terminal(
                    lambda job51_terminal: SERVICE.job51_download_resume_attachment(job51_terminal)
                )
                self.send_json(result)
            elif path == "/api/zhilian/process-messages":
                payload = self.read_json()
                options = payload.get("options")
                if isinstance(options, dict):
                    SERVICE.set_options(options)
                SERVICE.set_pause(False, "开始智联消息处理前自动解除暂停")
                timing = SERVICE.start_operation_timing("chat", "智联处理全部未读消息")
                raw_max_total = payload.get("maxTotal", payload.get("count", 40))
                max_total = int(raw_max_total if raw_max_total is not None else 40)
                try:
                    result = SERVICE.with_zhilian_terminal(
                        lambda zhilian_terminal: SERVICE.zhilian_process_unread_all_positions(
                            zhilian_terminal,
                            max_total=max_total,
                            target_position=str(payload.get("targetPosition") or ""),
                        )
                    )
                    finished_timing = SERVICE.finish_operation_timing(timing, "success")
                    if isinstance(result, dict) and finished_timing:
                        result["timings"] = finished_timing
                except Exception as error:
                    finished_timing = SERVICE.finish_operation_timing(timing, "failed", str(error))
                    self.send_json({"error": str(error), "timings": finished_timing}, status=500)
                    return
                self.send_json(result)
            elif path == "/api/zhilian/proactive-contact":
                payload = self.read_json()
                options = payload.get("options")
                if isinstance(options, dict):
                    SERVICE.set_options(options)
                SERVICE.set_pause(False, "开始智联主动联系前自动解除暂停")
                result = SERVICE.with_zhilian_terminal(
                    lambda zhilian_terminal: SERVICE.zhilian_proactive_contact_recommended_candidates(
                        zhilian_terminal,
                        target_position=str(payload.get("targetPosition") or ""),
                        max_total=int(payload.get("maxTotal") or payload.get("count") or 10),
                        dry_run=bool(payload.get("dryRun", False)),
                    )
                )
                self.send_json(result)
            elif path == "/api/config-key":
                payload = self.read_json()
                api_key = str(payload.get("apiKey") or "").strip()
                base_url = str(payload.get("baseUrl") or "").strip()
                model = str(payload.get("model") or "").strip()
                save_model_config(api_key=api_key, base_url=base_url, model=model)
                self.send_json({"ok": True, "hasApiKey": True, "modelConfig": public_model_config()})
            elif path == "/api/chat-monitor/check":
                payload = self.read_json()
                if int(payload.get("clientVersion") or 0) < 2:
                    self.send_json({
                        "changed": False,
                        "message": "检测到旧页面自动检查请求，已忽略；请刷新 8787 页面加载新脚本。",
                        "suggestions": [],
                    })
                else:
                    self.send_json(SERVICE.check_chat_monitor())
            elif path == "/api/chat-monitor/auto-reply":
                payload = self.read_json()
                if int(payload.get("clientVersion") or 0) < 2:
                    self.send_json({
                        "changed": False,
                        "message": "检测到旧页面自动回复请求，已忽略；请刷新 8787 页面加载新脚本。",
                        "suggestions": [],
                    })
                else:
                    self.send_json(SERVICE.auto_reply_chat_once(auto_send=bool(payload.get("autoSend")), force=bool(payload.get("force"))))
            elif path == "/api/chat-monitor/fill":
                payload = self.read_json()
                self.send_json(SERVICE.fill_chat_suggestion(str(payload.get("text") or "")))
            elif path == "/api/confirm-action":
                payload = self.read_json()
                self.send_json(SERVICE.confirm_action(str(payload.get("token") or "")))
            elif path == "/api/cancel-action":
                payload = self.read_json()
                self.send_json(SERVICE.cancel_action(str(payload.get("token") or "")))
            elif path == "/api/scan-local":
                payload = self.read_json()
                query = str(payload.get("query") or "").strip()
                self.send_json({"candidates": SERVICE.scan_local_resumes(query=query)})
            elif path == "/api/select-local":
                payload = self.read_json()
                item = SERVICE.remember_local_file(str(payload.get("path") or ""))
                self.send_json({"file": item, "files": SERVICE.files[-20:]})
            elif path == "/api/upload":
                files = self.read_multipart_files()
                saved = [SERVICE.save_uploaded_file(name, content) for name, content in files]
                self.send_json({"files": saved, "allFiles": SERVICE.files[-20:]})
            else:
                self.send_error(404)
        except PauseRequested as error:
            self.send_json({"reply": str(error), "paused": True, "pause": SERVICE.pause_state()})
        except Exception as error:
            self.send_json({"error": str(error)}, status=500)
        finally:
            SERVICE.close_current_thread_terminal()

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def proxy_platform_post_if_needed(self, path: str) -> bool:
        if path.startswith("/api/51job/"):
            if PORT in {8789, 8791}:
                return False
        elif path.startswith("/api/zhilian/"):
            if PORT in {8790, 8792}:
                return False
        else:
            return False

        length = int(self.headers.get("Content-Length") or "0")
        body = self.rfile.read(length) if length else b"{}"
        payload = {}
        try:
            payload = json.loads(body.decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                payload = {}
        except Exception:
            payload = {}

        parsed_url = urlparse(self.path)
        query_text = parsed_url.query or ""
        account_hint = str(
            payload.get("accountId")
            or payload.get("account")
            or payload.get("sourceKey")
            or query_text
            or ""
        ).lower()
        target_port = 0
        if path.startswith("/api/51job/"):
            target_port = 8791 if any(token in account_hint for token in ("boss_b", "job51_b", "hexinhong", "和新红")) else 8789
        elif path.startswith("/api/zhilian/"):
            target_port = 8792 if any(token in account_hint for token in ("boss_b", "zhilian_b", "zhaopin_b", "hexinhong", "和新红")) else 8790

        content_type = self.headers.get("Content-Type") or "application/json; charset=utf-8"
        target_url = f"http://127.0.0.1:{target_port}{self.path}"
        request = Request(
            target_url,
            data=body,
            headers={"Content-Type": content_type},
            method="POST",
        )
        try:
            with urlopen(request, timeout=900) as response:
                data = response.read()
                status = response.status
                response_type = response.headers.get("Content-Type") or "application/json; charset=utf-8"
        except HTTPError as error:
            data = error.read()
            status = error.code
            response_type = error.headers.get("Content-Type") or "application/json; charset=utf-8"
        except Exception as error:
            self.send_json({"error": f"平台专用后端 {target_port} 请求失败：{safe_text(str(error), 240)}"}, status=502)
            return True

        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", response_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return True

    def read_multipart_files(self) -> list[tuple[str, bytes]]:
        content_type = self.headers.get("Content-Type", "")
        match = re.search(r"boundary=(.+)$", content_type)
        if not match:
            raise AgentError("上传请求缺少 multipart boundary。")
        boundary = match.group(1).strip().strip('"').encode("utf-8")
        body = self.rfile.read(int(self.headers.get("Content-Length") or "0"))
        files: list[tuple[str, bytes]] = []
        for part in body.split(b"--" + boundary):
            part = part.strip()
            if not part or part == b"--" or b"\r\n\r\n" not in part:
                continue
            header_raw, content = part.split(b"\r\n\r\n", 1)
            content = content.removesuffix(b"\r\n").removesuffix(b"--")
            headers = header_raw.decode("utf-8", errors="ignore")
            filename_match = re.search(r'filename="([^"]*)"', headers)
            if filename_match and filename_match.group(1):
                files.append((filename_match.group(1), content))
        if not files:
            raise AgentError("没有读取到上传文件。")
        return files

    def serve_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", content_type + "; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        return


def build_step_task(task: str, trace: list[dict], step: int, max_steps: int) -> str:
    required_rounds = parse_required_chat_rounds(task)
    completed_rounds = count_completed_chat_rounds(trace)
    chat_round_hint = ""
    if required_rounds > 1:
        chat_round_hint = (
            f"\n用户要求连续对话 {required_rounds} 轮。当前已完成 {completed_rounds} 轮。"
            "在未达到轮次前不要返回 done；每完成一轮需要：读取对方最新消息 -> 生成回复 -> 填入并发送。"
        )
    return (
        f"总任务：{task}\n"
        f"当前是第 {step} 步，最多 {max_steps} 步。\n"
        f"历史步骤：{json.dumps(trace[-6:], ensure_ascii=False)}\n"
        "你是自动执行中的 Agent，不要把每一步都交还给用户。\n"
        "请只规划当前页面的下一小步，执行后会重新观察页面。\n"
        "如果是上传文件任务，看到候选文件或历史文件路径时必须使用 upload，不要点击系统文件选择按钮。\n"
        f"只有页面结果已经证明任务完成时，才返回 done。{chat_round_hint}"
    )


def mentions_file(message: str) -> bool:
    return any(word in message for word in ("文件", "简历", "PDF", "pdf", "上传", "刚才", "这份"))


def is_resume_upload_task(message: str) -> bool:
    lowered = message.lower()
    return ("上传" in message or "upload" in lowered) and (
        "简历" in message or "resume" in lowered or "pdf" in lowered or "文件" in message
    )


def is_chat_resume_send_task(message: str) -> bool:
    lowered = str(message or "").lower()
    if not ("简历" in message or "resume" in lowered or "cv" in lowered):
        return False
    send_terms = ("发", "发送", "发给", "发过去", "给对方", "给hr", "给 HR", "投递", "附件", "send")
    if not any(term.lower() in lowered for term in send_terms):
        return False
    # "上传简历" belongs to the local file-upload path, not the BOSS chat resume button.
    if "上传" in message and not any(term in message for term in ("发给", "发过去", "给对方", "给HR", "给hr")):
        return False
    return True


def is_recruiter_basic_screening_task(message: str) -> bool:
    text = str(message or "")
    compact = re.sub(r"\s+", "", text)
    if not compact:
        return False
    if (
        any(term in compact for term in ("未处理", "待处理", "未回复", "未读", "新消息"))
        and any(term in compact for term in ("AI应用开发实习生", "AI实习生"))
        and any(term in compact for term in ("回复", "处理", "信息", "消息", "联系人"))
    ):
        return True
    if should_process_all_unread_for_basic_screening(text):
        return True
    explicit_terms = (
        "基础条件筛选",
        "基本条件筛选",
        "基础情况筛选",
        "基本情况筛选",
    )
    if any(term in compact for term in explicit_terms):
        return True
    screening_terms = ("筛选", "基本情况", "基础情况", "基本条件", "基础条件", "公司情况", "常用语", "能接受", "接受则", "接受就")
    flow_terms = ("求简历", "要简历", "索要简历", "简历请求", "不合适")
    if any(term in compact for term in screening_terms) and any(term in compact for term in flow_terms):
        return True
    if "筛选" in compact and any(term in compact for term in ("常用语", "基础", "基本", "接受")):
        return True
    return "先发送常用语" in compact and "接受" in compact


def is_recruiter_common_phrase_task(message: str) -> bool:
    text = str(message or "")
    compact = re.sub(r"\s+", "", text)
    if not compact or "筛选" in compact:
        return False
    if any(term in compact for term in ("求简历", "要简历", "索要简历", "简历请求")):
        return False
    phrase_terms = (
        "公司基本情况", "公司基础情况", "公司情况", "岗位情况", "岗位条件",
        "工作条件", "基本情况", "基础情况", "基础条件", "基本条件",
        "基础话术", "开场话术", "开场白", "常用语", "那句话", "这句话",
        "日薪150", "单休", "线下工作", "实习六个月", "六个月",
    )
    if not any(term in compact for term in phrase_terms):
        return False
    send_terms = (
        "发送", "发一下", "发给", "发过去", "发", "打开", "点", "点击",
        "介绍", "说一下", "告诉", "问一下", "询问", "确认", "沟通",
    )
    return any(term in compact for term in send_terms) and any(term in compact for term in phrase_terms)


def should_process_all_unread_for_basic_screening(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or ""))
    if not compact:
        return False
    if (
        any(term in compact for term in ("未处理", "待处理", "未回复", "未读", "新消息"))
        and any(term in compact for term in ("AI应用开发实习生", "AI实习生"))
        and any(term in compact for term in ("回复", "处理", "信息", "消息", "联系人"))
    ):
        return True
    all_terms = ("所有消息", "全部消息", "所有未读", "全部未读", "所有联系人", "全部联系人", "处理所有", "处理全部")
    unread_terms = ("未读", "新消息", "消息")
    flow_terms = ("刚刚要求", "基础条件", "基本情况", "公司情况", "求简历", "AI实习生", "AI应用开发实习生")
    until_done_terms = ("直到没有未读", "一直到没有未读", "没有未读消息就结束", "处理完")
    return (
        any(term in compact for term in all_terms)
        and any(term in compact for term in unread_terms)
        and any(term in compact for term in flow_terms)
    ) or (
        any(term in compact for term in until_done_terms)
        and any(term in compact for term in ("处理", "消息", "未读"))
    )


def extract_recruiter_target_position(message: str) -> str:
    compact = re.sub(r"\s+", "", str(message or ""))
    if any(term in compact for term in ("所有岗位", "全部岗位", "不要只处理AI", "不只处理AI", "全岗位")):
        return ""
    if "AI应用开发实习生" in compact or "AI实习生" in compact:
        return "AI应用开发实习生"
    return ""


def extract_recruiter_date_scope(message: str) -> str:
    compact = re.sub(r"\s+", "", str(message or ""))
    has_today = "今天" in compact or "今日" in compact
    has_yesterday = "昨天" in compact or "昨日" in compact
    if has_today and has_yesterday:
        return "today_yesterday"
    if has_today:
        return "today"
    if has_yesterday:
        return "yesterday"
    return ""


def normalize_recruiter_date_scope(value: str) -> str:
    compact = re.sub(r"\s+", "", str(value or "")).lower()
    if compact in {"today_yesterday", "today+yesterday", "todayandyesterday"}:
        return "today_yesterday"
    if "今天" in compact and "昨天" in compact:
        return "today_yesterday"
    if compact in {"today", "今天", "今日"}:
        return "today"
    if compact in {"yesterday", "昨天", "昨日"}:
        return "yesterday"
    return ""


def recruiter_label_matches_date_scope(label: str, date_scope: str) -> bool | None:
    scope = normalize_recruiter_date_scope(date_scope)
    if not scope:
        return None
    text = re.sub(r"\s+", " ", str(label or "")).strip()
    text = re.sub(r"^\d{1,3}\s+(?=(\d{1,2}:\d{2}|昨天|昨日))", "", text)
    is_today = bool(re.match(r"^\d{1,2}:\d{2}\b", text))
    is_yesterday = text.startswith("昨天") or text.startswith("昨日") or " 昨天 " in f" {text} "
    if scope == "today":
        return is_today
    if scope == "yesterday":
        return is_yesterday
    if scope == "today_yesterday":
        if is_today or is_yesterday:
            return True
        if re.search(r"(前天|上周|周[一二三四五六日天]|星期|月|/|-)", text[:16]):
            return False
        return None
    return None


def recruiter_label_matches_position(label: str, target_position: str) -> bool | None:
    target = clean_applied_position(target_position)
    if not target:
        return None
    strict_match = strict_hr_position_match(label, target)
    if strict_match is not None:
        return strict_match
    compact = compact_conversation_label(label)
    target_compact = compact_conversation_label(target)
    if target_compact and target_compact in compact:
        return True
    known_position_terms = ("实习生", "销售", "经理", "工程师", "运营", "行政", "人事", "工业涂料", "膨润土", "应用技术")
    if any(term in compact for term in known_position_terms):
        return False
    return None


def should_watch_recent_contacts_for_basic_screening(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or ""))
    if not compact:
        return False
    recent_terms = ("最近", "前", "十个", "10个", "10人", "十人")
    watch_terms = ("30秒", "30s", "等待", "后续回复", "后续的回复", "后续消息", "继续重置", "重置30", "直到30", "没有这十个人的消息", "观察", "回访")
    flow_terms = ("基本情况", "基础情况", "公司情况", "接受", "求简历", "主动发消息")
    has_recent = any(term in compact for term in recent_terms)
    has_watch = any(term in compact for term in watch_terms)
    has_flow = any(term in compact for term in flow_terms)
    has_contact_reply_loop = "处理" in compact and any(term in compact for term in ("联系人", "候选人", "会话")) and any(term in compact for term in ("回复", "消息"))
    return has_recent and has_watch and (has_flow or has_contact_reply_loop)


def extract_recruiter_recent_watch_count(message: str) -> int:
    text = re.sub(r"\s+", "", str(message or ""))
    cn_values = {
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
        "十五": 15,
        "二十": 20,
    }
    match = re.search(r"(?:最近|前|先|处理)?(\d{1,2})(?:个|人|位|条)?(?:联系人|候选人|会话|聊天|牛人)", text)
    if match:
        return max(1, min(30, int(match.group(1))))
    match = re.search(r"(?:最近|前|先|处理)?([一二两三四五六七八九十]{1,2})(?:个|人|位|条)?(?:联系人|候选人|会话|聊天|牛人)", text)
    if match:
        value = cn_values.get(match.group(1))
        if value:
            return max(1, min(30, value))
    return 10


def extract_recruiter_recent_watch_idle_seconds(message: str) -> int:
    text = re.sub(r"\s+", "", str(message or ""))
    match = re.search(r"(\d{1,3})秒", text)
    if match:
        return max(5, min(120, int(match.group(1))))
    return 30


def extract_recruiter_common_phrase_candidate_name(message: str) -> str:
    text = re.sub(r"\s+", "", str(message or ""))
    patterns = (
        r"(?:对|给|向|找|打开|联系|让|叫)(?P<name>[\u4e00-\u9fffA-Za-z0-9·._-]{2,16}?)(?:发送|发|打开|点|点击)?(?:常用语|公司基本情况|公司基础情况|基础条件|基本条件)",
    )
    blocked_fragments = (
        "当前", "这个", "那个", "聊天框", "候选人", "常用语", "发送", "打开",
        "公司", "基础", "基本", "岗位", "条件", "情况", "介绍", "告诉",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            name = clean_recruiter_candidate_name(match.group("name"))
            if name and not any(fragment in name for fragment in blocked_fragments):
                return name
    return ""


def should_open_unreplied_for_basic_screening(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or ""))
    return any(term in compact for term in ("未回复", "没回复", "没有回", "没回", "未读", "新消息", "待处理", "下一个"))


def should_scan_recent_contacts_for_basic_screening(message: str) -> bool:
    compact = re.sub(r"\s+", "", str(message or ""))
    if not compact:
        return False
    current_terms = (
        "当前联系人", "当前候选人", "当前会话", "当前聊天框",
        "这个联系人", "这个候选人", "这个会话", "这个聊天框",
        "刚刚联系人", "刚刚的联系人", "刚才联系人", "刚才的联系人",
    )
    if any(term in compact for term in current_terms):
        return False
    recent_terms = ("最近", "挨个", "逐个", "每个", "所有", "全部")
    list_terms = ("联系人", "候选人", "会话", "聊天", "牛人")
    no_badge_terms = ("不管有没有小红点", "不看小红点", "不管是否未读", "有没有小红点", "有没有未读")
    has_front_count = bool(re.search(r"前(?:\d{1,2}|[一二两三四五六七八九十两]+)(?:个|位|人|条)?", compact))
    return (
        (any(term in compact for term in recent_terms) or has_front_count)
        and any(term in compact for term in list_terms)
    ) or any(term in compact for term in no_badge_terms)


def extract_recruiter_screen_candidate_name(message: str) -> str:
    text = re.sub(r"\s+", "", str(message or ""))
    if not text:
        return ""
    patterns = (
        r"(?:对|给|向|找|打开|联系|让|叫)(?P<name>[\u4e00-\u9fffA-Za-z0-9·._-]{2,16}?)(?:做|进行|执行)?(?:筛选|基本情况|基础条件|基本条件)",
    )
    blocked_names = {"之前的", "现在的", "当前的", "这个", "那个", "候选人", "未回复", "未读"}
    blocked_fragments = ("执行", "之前", "现在", "当前", "筛选", "操作", "他", "她", "它", "我")
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            name = clean_recruiter_candidate_name(match.group("name"))
            if name and name not in blocked_names and not any(fragment in name for fragment in blocked_fragments):
                return name
    return ""


def is_basic_condition_phrase_text(text: str, phrase: str = "") -> bool:
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact:
        return False
    phrase_compact = re.sub(r"\s+", "", str(phrase or BASIC_CONDITIONS_PHRASE))
    if phrase_compact and (phrase_compact[:18] in compact or compact[:30] in phrase_compact):
        return True
    matched_terms = sum(1 for term in BASIC_CONDITIONS_TERMS if term in compact)
    return matched_terms >= 2 or ("工作地点都能接受" in compact and ("单休" in compact or "线下" in compact))


def parse_small_month_count(value: str) -> int | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    chinese_digits = {
        "零": 0,
        "一": 1,
        "二": 2,
        "两": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
    }
    if text in chinese_digits:
        return chinese_digits[text]
    if text.startswith("十") and len(text) == 2 and text[1] in chinese_digits:
        return 10 + int(chinese_digits[text[1]])
    if len(text) == 2 and text[0] in chinese_digits and text[1] == "十":
        return int(chinese_digits[text[0]]) * 10
    if len(text) == 3 and text[0] in chinese_digits and text[1] == "十" and text[2] in chinese_digits:
        return int(chinese_digits[text[0]]) * 10 + int(chinese_digits[text[2]])
    return None


def detect_insufficient_ai_internship_duration(text: str) -> dict:
    raw = str(text or "").strip()
    compact = re.sub(r"\s+", "", raw).lower()
    if not compact:
        return {"matched": False}

    explicit_less_than_six_patterns = (
        r"不(?:能|可以|可|太能|太可以|方便)?(?:接受|实习|做|干)?(?:满|到|够)?(?:六|6)个?月",
        r"(?:做|干|实习)?不(?:满|到|够)(?:六|6)个?月",
        r"(?:达不到|没有|没法|无法|不能|不够)(?:六|6)个?月",
        r"(?:达不到|没有|没法|无法|不能|不够).{0,12}(?:满|到|够)?(?:六|6)个?月",
        r"(?:六|6)个?月(?:不行|不可以|接受不了|不能接受|没法|无法|太久|太长|有点久|有点长)",
        r"(?:六|6)个?月.{0,8}(?:感觉)?(?:太久|太长|有点久|有点长)",
        r"(?:太久|太长|有点久|有点长).{0,8}(?:六|6)个?月",
        r"(?:导师|老师|学校|学院).{0,12}(?:不放|不让|不同意|不允许).{0,12}(?:实习|走|出去|离校|线下)?",
        r"(?:不放我走|不让出来|不让离校|不允许离校)",
    )
    for pattern in explicit_less_than_six_patterns:
        if re.search(pattern, compact):
            return {
                "matched": True,
                "reason": "candidate_cannot_intern_six_months",
                "evidence": safe_text(raw, 160),
            }

    summer_short_term_patterns = (
        r"(?:只能|只可以|只可|最多|至多|顶多|只能保证).{0,10}暑假.{0,12}[0-9一二两三四五六七八九十]{1,3}(?:[-到至~][0-9一二两三四五六七八九十]{1,3})?个?月",
        r"暑假.{0,10}[0-9一二两三四五六七八九十]{1,3}(?:[-到至~][0-9一二两三四五六七八九十]{1,3})?个?月.{0,12}(?:无法|不能|没法|不可以).{0,12}(?:六|6)个?月",
        r"开学后.{0,12}(?:回学校|返校|上课).{0,12}(?:无法|不能|没法|不可以).{0,12}(?:继续|线下|实习|满|到|够)?(?:六|6)个?月",
    )
    for pattern in summer_short_term_patterns:
        if re.search(pattern, compact):
            return {
                "matched": True,
                "reason": "candidate_internship_duration_less_than_six_months",
                "evidence": safe_text(raw, 160),
            }

    september_only_patterns = (
        r"(?:实习|做到|做|干|工作).{0,6}(?:到|至|截止到)(?:九|9)月",
        r"(?:只能|只可以|只可|最多|至多|顶多|最晚).{0,6}(?:到|至|截止到)(?:九|9)月",
    )
    for pattern in september_only_patterns:
        if re.search(pattern, compact):
            return {
                "matched": True,
                "reason": "candidate_can_only_intern_until_september",
                "evidence": safe_text(raw, 160),
            }

    duration_patterns = (
        r"(?:只能|只可以|只可|最多|至多|顶多)(?:接受|实习|做|干)?([0-9一二两三四五六七八九十]{1,3})个?月",
        r"(?:可以|能|可)(?:实习|做|干)([0-9一二两三四五六七八九十]{1,3})个?月",
        r"(?:实习|做|干)(?:时间)?(?:只有|就|大概|大约)?([0-9一二两三四五六七八九十]{1,3})个?月",
    )
    for pattern in duration_patterns:
        for match in re.finditer(pattern, compact):
            months = parse_small_month_count(match.group(1))
            if months is not None and months < 6:
                return {
                    "matched": True,
                    "reason": "candidate_internship_duration_less_than_six_months",
                    "months": months,
                    "evidence": safe_text(raw, 160),
                }
    return {"matched": False}


def is_wechat_exchange_request(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or "")).lower()
    if not compact:
        return False
    contact_terms = (
        "\u5fae\u4fe1", "\u5fae\u4fe1\u53f7", "vx", "wechat",
        "\u8054\u7cfb\u65b9\u5f0f", "\u7535\u8bdd", "\u624b\u673a\u53f7",
    )
    request_terms = (
        "\u4ea4\u6362", "\u52a0", "\u52a0\u4e2a", "\u6dfb\u52a0", "\u7ed9",
        "\u53d1", "\u53d1\u4e00\u4e0b", "\u65b9\u4fbf", "\u53ef\u4ee5", "\u80fd",
        "\u80fd\u5426", "\u662f\u5426\u540c\u610f", "\u540c\u610f",
    )
    if any(term in compact for term in contact_terms) and any(term in compact for term in request_terms):
        return True
    return bool(re.search(r"(?:vx|wechat).{0,8}(?:\u52a0|\u4ea4\u6362|\u7ed9|\u53d1)", compact, flags=re.I))


def classify_basic_condition_acceptance(text: str) -> dict:
    raw = str(text or "").strip()
    compact = re.sub(r"\s+", "", raw).lower()
    if not compact:
        return {
            "status": "unclear",
            "confidence": 0.0,
            "reason": "empty",
            "sourceText": "",
        }

    if is_wechat_exchange_request(raw):
        return {
            "status": "unclear",
            "confidence": 0.9,
            "reason": "candidate_requested_wechat_exchange",
            "sourceText": safe_text(raw, 160),
        }

    if any(term in compact for term in ("认可简历", "简历认可", "是不是不考虑", "还是说不考虑", "还考虑吗", "不考虑我")):
        return {
            "status": "unclear",
            "confidence": 0.72,
            "reason": "candidate_asked_employer_consideration",
            "sourceText": safe_text(raw, 160),
        }

    insufficient_duration = detect_insufficient_ai_internship_duration(raw)
    if insufficient_duration.get("matched"):
        return {
            "status": "reject",
            "confidence": 0.92,
            "reason": insufficient_duration.get("reason") or "candidate_cannot_intern_six_months",
            "sourceText": safe_text(raw, 160),
            "hardCondition": "six_months",
            "months": insufficient_duration.get("months"),
        }

    reject_terms = (
        "不能接受", "接受不了", "不接受", "不能", "不可以", "不行", "没办法",
        "不太能接受", "不太接受", "不太能", "不太行", "不考虑", "算了", "放弃",
        "不方便", "不太方便", "去不了", "没法去", "不能去", "介意",
    )
    hard_condition_terms = (
        "单休", "线下", "线下工作", "到公司", "工作地点", "地点", "地址",
        "湖州", "长兴", "泗安", "六个月", "6个月", "半年", "实习六个月",
        "薪资", "工资", "日薪", "待遇", "150",
    )
    salary_reject = any(term in compact for term in reject_terms) and any(
        term in compact for term in ("薪资", "工资", "日薪", "待遇", "150")
    )
    hard_reject_pattern = (
        r"(?:不能接受|接受不了|不接受|不能|不可以|不行|没办法|不太能接受|不太接受|不太能|不考虑|介意)"
        r".{0,5}(?:单休|线下|线下工作|到公司|工作地点|地点|地址|湖州|长兴|泗安|六个月|6个月|半年|实习六个月|薪资|工资|日薪|待遇|150)"
        r"|(?:单休|线下|线下工作|到公司|工作地点|地点|地址|湖州|长兴|泗安|六个月|6个月|半年|实习六个月|薪资|工资|日薪|待遇|150)"
        r".{0,5}(?:不能接受|接受不了|不接受|不接受|不能|不可以|不行|没办法|不太能接受|不太接受|不太能|不考虑|介意|太久)"
    )
    explicit_hard_reject = bool(re.search(hard_reject_pattern, compact))
    arrival_only_reject = (
        any(term in compact for term in reject_terms)
        and any(term in compact for term in ("到岗", "入职", "尽快"))
        and not explicit_hard_reject
    )
    specific_reject = any(term in compact for term in reject_terms) and (
        explicit_hard_reject
        or len(compact) <= 18
        or "都" in compact
    )
    online_work_reject = (
        any(term in compact for term in ("只能线上实习", "只接受线上实习", "只能远程", "只接受远程", "只能线上工作", "只接受线上工作"))
        or ("只能线上" in compact and not any(term in compact for term in ("线上面试", "远程面试", "视频面试", "面试")))
    )
    if (specific_reject or salary_reject or online_work_reject or "要双休" in compact or "必须双休" in compact) and not arrival_only_reject:
        return {
            "status": "reject",
            "confidence": 0.86,
            "reason": "candidate_rejected_required_condition",
            "sourceText": safe_text(raw, 160),
        }
    if arrival_only_reject:
        return {
            "status": "unclear",
            "confidence": 0.52,
            "reason": "candidate_cannot_arrive_soon_not_hard_reject",
            "sourceText": safe_text(raw, 160),
        }

    resume_attachment_terms = (
        "对方想发送附件简历给您", "是否同意", "点击预览附件简历",
        "附件简历", "在线简历", "发送附件简历",
        "这是我的简历", "简历已发", "已发简历", "发了简历", "发送了简历",
    )
    if (
        any(term in compact for term in resume_attachment_terms)
        or re.search(r"(简历|resume|cv)[^\\s]{0,40}\\.(pdf|docx?|PDF|DOCX?)", raw, flags=re.I)
    ):
        return {
            "status": "accept",
            "confidence": 0.9,
            "reason": "candidate_sent_or_offered_resume",
            "sourceText": safe_text(raw, 160),
        }

    hesitation_terms = (
        "考虑下", "考虑一下", "再考虑", "我考虑", "想想", "再想想",
        "看看", "再看看", "了解下", "了解一下", "晚点", "稍后",
    )
    strong_accept_terms = (
        "都能接受", "都可以接受", "都可接受", "可以接受", "能接受", "可接受",
        "都能够接受", "能够接受", "工作地点都能接受", "工作地点都能够接受",
        "地点都能接受", "地点都能够接受", "工作地点可以接受", "地点可以接受",
        "接受的", "接受了", "能接受的", "可以的", "可以呀", "可以啊", "可以哦", "可以哈",
        "都可以", "这些都可以", "这边可以", "我这边可以", "都行", "都没问题",
        "没问题", "没问题的", "没有问题", "没啥问题", "这些条件没问题",
        "线下可以", "单休可以", "六个月可以", "实习六个月可以", "加班可以",
        "ok", "okay", "可以ok", "都ok",
    )
    if any(term in compact for term in hesitation_terms) and not any(term in compact for term in strong_accept_terms):
        return {
            "status": "unclear",
            "confidence": 0.62,
            "reason": "candidate_is_considering",
            "sourceText": safe_text(raw, 160),
        }

    if candidate_message_has_followup_question(compact) and not any(term in compact for term in strong_accept_terms):
        return {
            "status": "unclear",
            "confidence": 0.58,
            "reason": "candidate_asked_followup_question",
            "sourceText": safe_text(raw, 160),
        }

    accept_terms = (
        "都能接受", "都可以接受", "都可接受", "可以接受", "能接受", "可接受",
        "都能够接受", "能够接受", "工作地点都能接受", "工作地点都能够接受",
        "地点都能接受", "地点都能够接受", "工作地点可以接受", "地点可以接受",
        "接受", "接受的", "接受了", "能接受的", "都可以", "这些都可以",
        "可以的", "可以呀", "可以啊", "可以哦", "可以哈", "可以", "这边可以",
        "没问题", "没问题的", "没有问题", "没啥问题", "没关系", "没事",
        "都行", "行的", "可以安排", "没问题安排", "ok", "okay",
        "行", "能", "能的", "好的", "好呀", "好啊", "嗯嗯",
    )
    if any(term in compact for term in accept_terms):
        return {
            "status": "accept",
            "confidence": 0.82,
            "reason": "candidate_accepted_basic_conditions",
            "sourceText": safe_text(raw, 160),
        }

    return {
        "status": "unclear",
        "confidence": 0.35,
        "reason": "no_clear_accept_or_reject",
        "sourceText": safe_text(raw, 160),
    }


def is_direct_basic_condition_acceptance_reply(text: str) -> bool:
    raw = str(text or "").strip()
    if not raw:
        return False
    if any(marker in raw for marker in ("吗", "嘛", "么", "？", "?", "能否", "能不能", "可不可以", "是否", "请问", "想问", "了解")):
        return False
    if any(term in raw for term in ("沟通", "简历", "面试", "微信", "联系", "看看", "看下", "发送", "发给", "投递")):
        return False
    if candidate_message_has_followup_question(raw):
        return False
    compact = re.sub(r"\[[^\]]{1,12}\]", "", raw)
    compact = re.sub(r"[^\w\u4e00-\u9fff]+", "", compact.lower())
    if not compact:
        return False
    direct_accept_terms = {
        "可以",
        "可以可以",
        "可以可以可以",
        "可以的",
        "可以呀",
        "可以啊",
        "可以哦",
        "可以哈",
        "能接受",
        "能接受的",
        "接受",
        "接受的",
        "接受了",
        "可以接受",
        "都可以",
        "都能接受",
        "都可以接受",
        "这些都可以",
        "这些条件可以",
        "这些条件没问题",
        "基本情况可以",
        "基本情况都可以",
        "没问题",
        "没问题的",
        "没有问题",
        "都没问题",
        "都行",
        "行",
        "行的",
        "好的",
        "好",
        "ok",
        "ok的",
        "okay",
    }
    if compact in direct_accept_terms:
        return True
    return False


def candidate_message_has_followup_question(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or "")).lower()
    if not compact:
        return False
    plc_question_markers = (
        "\u54c1\u724c", "\u724c\u5b50", "\u54ea\u4e2a", "\u54ea\u79cd", "\u4ec0\u4e48",
        "\u7528\u7684", "\u4f7f\u7528", "\u7528\u4ec0\u4e48", "\u578b\u53f7",
        "\u5fc5\u987b", "\u8981\u6c42", "\u9700\u8981", "\u61c2", "\u4f1a", "\u719f\u6089",
        "\u5417", "\u4e48", "\u561b", "\u662f\u5426",
    )
    if (
        ("plc" in compact or "\u897f\u95e8\u5b50" in compact or "\u4e09\u83f1" in compact or "\u6b27\u59c6\u9f99" in compact)
        and any(marker in compact for marker in plc_question_markers)
    ):
        return True
    electrical_terms = (
        "\u7535\u6c14", "\u7535\u5668", "\u5f31\u7535", "\u5f3a\u7535", "\u7535\u5de5\u8bc1",
        "\u9633\u539f", "\u6cb3\u5317\u9633\u539f",
    )
    broad_question_markers = (
        "\u5417", "\u4e48", "\u561b", "\u662f\u5426", "\u662f\u4e0d\u662f",
        "\u54ea\u4e2a", "\u54ea\u91cc", "\u54ea\u513f", "\u4ec0\u4e48", "\u591a\u5c11",
        "\u600e\u4e48", "\u80fd\u5426", "\u80fd\u4e0d\u80fd", "\u53ef\u4e0d\u53ef\u4ee5",
        "?", "\uff1f",
    )
    if any(term in compact for term in electrical_terms) and any(marker in compact for marker in broad_question_markers):
        return True
    semantic_question_markers = (
        "\u662f\u5426", "\u662f\u4e0d\u662f", "\u5408\u9002", "\u5339\u914d",
        "\u80fd\u5426", "\u80fd\u4e0d\u80fd", "\u53ef\u4e0d\u53ef\u4ee5",
    )
    semantic_knowledge_terms = (
        "\u5c97\u4f4d", "\u804c\u4f4d", "\u804c\u8d23", "\u5de5\u4f5c\u5185\u5bb9",
        "\u9500\u552e", "\u9500\u552e\u56e2\u961f", "\u8d1f\u8d23\u9500\u552e",
        "\u9500\u552e\u6307\u6807", "\u9500\u552e\u4efb\u52a1", "\u9500\u552e\u4e1a\u7ee9", "\u9500\u552e\u5de5\u4f5c", "hrbp",
    )
    if any(marker in compact for marker in semantic_question_markers) and any(term in compact for term in semantic_knowledge_terms):
        return True
    if "\u9500\u552e" in compact and (
        "\u5f3a\u5173\u8054" in compact
        or "\u8d1f\u8d23\u9500\u552e" in compact
        or "\u5236\u9020\u4e1a" in compact
    ):
        return True
    general_knowledge_terms = (
        "\u5de5\u4f5c\u65f6\u95f4", "\u4e0a\u73ed\u65f6\u95f4", "\u4e0b\u73ed\u65f6\u95f4",
        "\u52a0\u73ed\u65f6\u95f4", "\u5de5\u65f6", "\u4f5c\u606f",
        "\u4f4f\u5bbf", "\u5bbf\u820d", "\u98df\u5802", "\u5403\u996d", "\u5305\u5403", "\u5305\u4f4f",
        "\u85aa\u8d44", "\u5de5\u8d44", "\u5f85\u9047", "\u4e94\u9669", "\u793e\u4fdd",
        "\u9762\u8bd5", "\u8f6c\u6b63", "\u5165\u804c", "\u5230\u5c97",
        "\u51fa\u5dee", "\u5ba2\u6237", "\u5de5\u4f5c\u5730\u70b9", "\u5730\u5740",
        "\u7b80\u5386", "\u53d1\u7b80\u5386", "\u9644\u4ef6\u7b80\u5386",
        "\u6709\u4eba\u5e26", "\u4e00\u5e26\u4e00", "\u5e26\u6559", "\u5bfc\u5e08", "\u72ec\u7acb\u4e0a\u624b",
        "\u5b66\u4e60", "\u5b66\u591a\u4e45", "\u5b66\u4e60\u591a\u4e45", "\u4e00\u7ebf\u5b66\u4e60", "\u4ea7\u54c1",
        "\u5b9e\u4e60", "\u5927\u4e09", "\u5728\u6821\u751f", "\u672c\u79d1\u5728\u8bfb",
    )
    general_question_intents = (
        "\u60f3\u4e86\u89e3", "\u4e86\u89e3\u4e0b", "\u4e86\u89e3\u4e00\u4e0b",
        "\u5177\u4f53", "\u8bf7\u95ee", "\u60f3\u95ee", "\u95ee\u4e0b", "\u54a8\u8be2",
        "\u600e\u4e48", "\u4ec0\u4e48", "\u591a\u5c11", "\u591a\u4e45", "\u591a\u957f\u65f6\u95f4", "\u51e0\u70b9",
        "\u5417", "\u4e48", "\uff1f", "?",
    )
    if any(term in compact for term in general_knowledge_terms):
        if len(compact) <= 24 or any(intent in compact for intent in general_question_intents):
            return True
    question_markers = (
        "吗", "？", "?", "么", "多少", "多久", "多长时间", "哪里", "哪儿", "在哪", "怎么", "什么时候", "是否", "有没有",
        "有吗", "包含", "包括", "是不是", "可不可以", "能不能", "啥", "什么", "几", "几人", "几天", "几个月",
    )
    question_introducers = (
        "请问", "想问", "问一下", "咨询", "想了解", "了解一下", "方便说", "方便讲",
    )
    knowledge_terms = (
        "工作内容", "岗位内容", "职责", "桌面运维", "运维", "五险", "五险一金", "保险", "社保",
        "薪资", "工资", "日薪", "加班", "单休", "双休", "休息", "住宿", "包住", "宿舍",
        "食宿", "吃住", "包吃住", "包食宿", "管吃住", "管饭", "包吃", "房补", "餐补",
        "线下", "线上", "远程", "地址", "地点", "面试", "复试", "笔试", "转正", "入职", "到岗",
        "体检", "学生证", "身份证", "毕业证", "合同", "劳动合同", "正式合同", "实习协议", "协议",
        "考察期", "试用期", "电脑", "食堂", "吃饭",
        "出差", "长期出差", "拜访", "客户", "拜访客户", "客户数量", "客户拜访",
        "销售指标", "销售任务", "销售业绩", "销售工作",
        "职位", "岗位", "招聘", "招人", "招实习生", "实习", "简历", "发简历", "附件简历",
        "有人带", "一带一", "带教", "导师", "独立上手", "学习", "学多久", "学习多久",
        "一线学习", "培训", "培训时间", "培训多久", "产品", "大三", "在校生", "本科在读",
    )
    if not any(term in compact for term in knowledge_terms):
        return False
    direct_topic_queries = {
        "地址", "工作地址", "公司地址", "地点", "工作地点", "位置", "在哪里",
        "薪资", "工资", "待遇", "住宿", "包住", "食宿", "吃住", "包吃住", "包食宿",
        "管吃住", "房补", "餐补", "工作内容", "岗位内容",
        "五险", "五险一金", "社保", "保险", "工作时间", "上班时间", "下班时间",
        "加班时间", "工时", "几点上班", "几点下班", "几点加班", "到岗", "入职时间",
        "合同", "劳动合同", "正式合同", "实习合同", "实习协议", "毕业证", "考察期", "试用期",
        "出差", "长期出差", "客户拜访", "拜访客户", "客户数量",
        "职位", "岗位", "招聘", "招人",
    }
    if compact in direct_topic_queries:
        return True
    nominal_topic_terms = (
        "工作时间", "上班时间", "下班时间", "加班时间", "工时",
        "午休时间", "休息时间", "薪资待遇", "住宿情况", "食宿情况", "吃住情况", "工作地点",
        "出差情况", "客户拜访", "拜访客户",
    )
    if len(compact) <= 24 and any(term in compact for term in nominal_topic_terms):
        return True
    if any(marker in compact for marker in question_markers):
        return True
    return any(intro in compact for intro in question_introducers)


def screening_has_followup_question(screening: dict) -> bool:
    if not isinstance(screening, dict):
        return False
    other_messages = screening.get("otherMessages") if isinstance(screening.get("otherMessages"), list) else []
    for item in other_messages[-RECENT_UNANSWERED_OTHER_LIMIT:]:
        if isinstance(item, dict) and candidate_message_has_followup_question(str(item.get("text") or "")):
            return True
    last_other = screening.get("lastOther") if isinstance(screening.get("lastOther"), dict) else {}
    if not last_other:
        decision = screening.get("decisionMessage") if isinstance(screening.get("decisionMessage"), dict) else {}
        last_other = decision
    return candidate_message_has_followup_question(str(last_other.get("text") or ""))


def conversation_review_requests_resume_after_answer(context: dict, screening: dict | None = None) -> bool:
    review = context.get("conversationReview") if isinstance(context, dict) and isinstance(context.get("conversationReview"), dict) else {}
    if not review and isinstance(screening, dict) and isinstance(screening.get("conversationReview"), dict):
        review = screening.get("conversationReview")
    if not isinstance(review, dict) or not review:
        return False
    acceptance_status = str(review.get("acceptanceStatus") or "").strip().lower()
    if acceptance_status and acceptance_status != "accept":
        return False
    recommended_action = str(review.get("recommendedNextAction") or "").strip().lower()
    if bool(review.get("shouldRequestResume")):
        return True
    return recommended_action in {"answer_then_request_resume", "request_resume"}


def is_effective_chat_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or "")).lower()
    if not compact:
        return False
    ignored = {"已读", "送达", "未读", "对方正在输入", "按enter键发送", "按ctrl+enter键换行发送"}
    return compact not in ignored


def normalize_answered_message_signatures(previous_state: dict | None) -> set[str]:
    previous_state = previous_state if isinstance(previous_state, dict) else {}
    answered: set[str] = set()
    raw = previous_state.get("knowledgeAnsweredSignatures")
    if isinstance(raw, list):
        answered.update(str(item) for item in raw if str(item or "").strip())
    elif isinstance(raw, str) and raw.strip():
        answered.add(raw.strip())
    if previous_state.get("status") in {"knowledge_answered_waiting", "knowledge_silent_skipped"}:
        signature = str(previous_state.get("lastOtherSignature") or "").strip()
        if signature:
            answered.add(signature)
    return answered


def recent_unanswered_other_messages(
    context: dict,
    previous_state: dict | None = None,
    max_count: int = RECENT_UNANSWERED_OTHER_LIMIT,
) -> list[dict]:
    messages = context.get("messages") if isinstance(context.get("messages"), list) else []
    if not messages:
        return []
    answered = normalize_answered_message_signatures(previous_state)
    last_me_index = -1
    for index in range(len(messages) - 1, -1, -1):
        item = messages[index]
        if isinstance(item, dict) and item.get("sender") == "me" and is_effective_chat_text(str(item.get("text") or "")):
            last_me_index = index
            break
    pending: list[dict] = []
    for item in messages[last_me_index + 1:]:
        if not isinstance(item, dict) or item.get("sender") != "other":
            continue
        if not is_effective_chat_text(str(item.get("text") or "")):
            continue
        signature = chat_message_signature(item)
        if signature and signature in answered:
            continue
        pending.append(item)
    return pending[-max(1, int(max_count or RECENT_UNANSWERED_OTHER_LIMIT)):]


def recent_unanswered_question_messages(
    context: dict,
    previous_state: dict | None = None,
    max_count: int = RECENT_UNANSWERED_OTHER_LIMIT,
) -> list[dict]:
    review = context.get("conversationReview") if isinstance(context, dict) and isinstance(context.get("conversationReview"), dict) else {}
    if review.get("modelEnabled"):
        raw_questions = review.get("unansweredQuestions") if isinstance(review.get("unansweredQuestions"), list) else []
        answered = normalize_answered_message_signatures(previous_state)
        messages = context.get("messages") if isinstance(context.get("messages"), list) else []
        by_index: dict[int, dict] = {
            index: item
            for index, item in enumerate(messages)
            if isinstance(item, dict) and item.get("sender") == "other"
        }
        selected: list[dict] = []
        for raw in raw_questions:
            if not isinstance(raw, dict):
                continue
            if bool(raw.get("answered")):
                continue
            text = str(raw.get("text") or raw.get("question") or raw.get("sourceText") or "").strip()
            if not text:
                continue
            source: dict = {}
            try:
                index = int(raw.get("messageIndex"))
                source = by_index.get(index, {})
            except Exception:
                source = {}
            if not source:
                source_text = re.sub(r"\s+", "", str(raw.get("sourceText") or text))
                for item in reversed(messages):
                    if not isinstance(item, dict) or item.get("sender") != "other":
                        continue
                    item_text = re.sub(r"\s+", "", str(item.get("text") or ""))
                    if source_text and (source_text in item_text or item_text in source_text):
                        source = item
                        break
            candidate = dict(source) if isinstance(source, dict) and source else {
                "sender": "other",
                "text": text,
                "time": safe_text(str(raw.get("time") or ""), 30),
            }
            candidate["_modelUnansweredQuestionText"] = safe_text(text, 180)
            candidate["_modelUnansweredQuestionTopic"] = safe_text(str(raw.get("topic") or ""), 80)
            candidate["_modelUnansweredQuestionReason"] = safe_text(str(raw.get("reason") or ""), 180)
            signature = chat_message_signature(candidate)
            if signature and signature in answered:
                continue
            if not is_effective_chat_text(str(candidate.get("text") or "")):
                continue
            selected.append(candidate)
        if selected:
            return selected[-max(1, int(max_count or RECENT_UNANSWERED_OTHER_LIMIT)):]
    return [
        item
        for item in recent_unanswered_other_messages(context, previous_state, max_count=max_count)
        if candidate_message_has_followup_question(str(item.get("text") or ""))
    ]


def knowledge_question_context(
    context: dict,
    question_messages: list[dict],
) -> dict:
    question_messages = [item for item in question_messages if isinstance(item, dict)]
    if not question_messages:
        return dict(context)
    texts = [
        safe_text(str(item.get("_modelUnansweredQuestionText") or item.get("text") or ""), 180)
        for item in question_messages
        if str(item.get("_modelUnansweredQuestionText") or item.get("text") or "").strip()
    ]
    signatures = [chat_message_signature(item) for item in question_messages if chat_message_signature(item)]
    combined_text = "\n".join(texts)
    combined_signature = stable_digest("|".join(signatures), 24) if signatures else stable_digest(combined_text, 24)
    merged = dict(context)
    merged["knowledgeQuestionMessages"] = question_messages[-RECENT_UNANSWERED_OTHER_LIMIT:]
    merged["knowledgeQuestionText"] = combined_text
    merged["knowledgeQuestionSignatures"] = signatures[-RECENT_UNANSWERED_OTHER_LIMIT:]
    merged["lastOtherMessage"] = {
        "sender": "other",
        "text": combined_text,
        "time": safe_text(str(question_messages[-1].get("time") or ""), 30),
    }
    merged["lastOtherSignature"] = combined_signature
    return merged


def build_screening_decision_basis(
    status: str,
    reason: str,
    basic_message: dict | None = None,
    last_other: dict | None = None,
    other_messages: list[dict] | None = None,
    judgement: dict | None = None,
    decision_message: dict | None = None,
    latest_resume_message: dict | None = None,
) -> dict:
    other_messages = other_messages if isinstance(other_messages, list) else []
    decision_message = decision_message if isinstance(decision_message, dict) and decision_message else last_other
    return {
        "status": safe_text(str(status or ""), 40),
        "reason": safe_text(str(reason or ""), 80),
        "basicConditionText": safe_text(str((basic_message or {}).get("text") or ""), 180),
        "decisionText": safe_text(str((decision_message or {}).get("text") or ""), 180),
        "latestOtherText": safe_text(str((last_other or {}).get("text") or ""), 180),
        "latestResumeText": safe_text(str((latest_resume_message or {}).get("text") or ""), 180),
        "judgementReason": safe_text(str((judgement or {}).get("reason") or ""), 80),
        "recentCandidateMessages": [
            {
                "time": safe_text(str(item.get("time") or ""), 30),
                "text": safe_text(str(item.get("text") or ""), 180),
            }
            for item in other_messages[-RECENT_UNANSWERED_OTHER_LIMIT:]
            if isinstance(item, dict)
        ],
    }


def analyze_basic_condition_screening(messages: list[dict], phrase: str = "") -> dict:
    if not isinstance(messages, list):
        messages = []
    basic_index = -1
    basic_message: dict = {}
    for index, item in enumerate(messages):
        if not isinstance(item, dict):
            continue
        if item.get("sender") == "me" and is_basic_condition_phrase_text(str(item.get("text") or ""), phrase):
            basic_index = index
            basic_message = item
    if basic_index < 0:
        return {
            "status": "not_asked",
            "reason": "basic_conditions_not_sent",
        }

    other_messages: list[dict] = []
    for item in messages[basic_index + 1:]:
        if not isinstance(item, dict) or item.get("sender") != "other":
            continue
        text = re.sub(r"\s+", "", str(item.get("text") or ""))
        if not text or text in {"已读", "送达", "未读", "对方正在输入"}:
            continue
        other_messages.append(item)

    last_other = other_messages[-1] if other_messages else {}
    if not last_other:
        return {
            "status": "waiting",
            "reason": "waiting_for_candidate_reply",
            "basicMessage": basic_message,
            "otherMessages": other_messages[-5:],
            "decisionBasis": build_screening_decision_basis(
                "waiting",
                "waiting_for_candidate_reply",
                basic_message=basic_message,
                other_messages=other_messages,
            ),
        }

    judgement = classify_basic_condition_acceptance(str(last_other.get("text") or ""))
    if judgement.get("status") == "accept" and judgement.get("reason") == "candidate_sent_or_offered_resume" and len(other_messages) <= 1:
        return {
            "status": "unclear",
            "reason": "resume_without_explicit_basic_acceptance",
            "confidence": 0.55,
            "basicMessage": basic_message,
            "lastOther": last_other,
            "otherMessages": other_messages[-5:],
            "decisionMessage": last_other,
            "judgement": {
                "status": "unclear",
                "confidence": 0.55,
                "reason": "resume_without_explicit_basic_acceptance",
                "sourceText": safe_text(str(last_other.get("text") or ""), 160),
            },
            "decisionBasis": build_screening_decision_basis(
                "unclear",
                "resume_without_explicit_basic_acceptance",
                basic_message=basic_message,
                last_other=last_other,
                other_messages=other_messages,
                judgement={
                    "reason": "resume_without_explicit_basic_acceptance",
                },
                decision_message=last_other,
                latest_resume_message=last_other,
            ),
        }
    if judgement.get("status") == "accept" and judgement.get("reason") == "candidate_sent_or_offered_resume" and len(other_messages) > 1:
        found_explicit_accept_before_resume = False
        for prior in reversed(other_messages[:-1]):
            prior_judgement = classify_basic_condition_acceptance(str(prior.get("text") or ""))
            if prior_judgement.get("reason") == "candidate_sent_or_offered_resume":
                continue
            if prior_judgement.get("status") == "reject":
                return {
                    "status": "reject",
                    "reason": "candidate_rejected_required_condition_before_resume_attachment",
                    "confidence": prior_judgement.get("confidence"),
                    "basicMessage": basic_message,
                    "lastOther": last_other,
                    "otherMessages": other_messages[-5:],
                    "decisionMessage": prior,
                    "judgement": prior_judgement,
                    "latestResumeMessage": last_other,
                    "decisionBasis": build_screening_decision_basis(
                        "reject",
                        "candidate_rejected_required_condition_before_resume_attachment",
                        basic_message=basic_message,
                        last_other=last_other,
                        other_messages=other_messages,
                        judgement=prior_judgement,
                        decision_message=prior,
                        latest_resume_message=last_other,
                    ),
                }
            if prior_judgement.get("status") == "accept":
                found_explicit_accept_before_resume = True
                break
        if not found_explicit_accept_before_resume:
            return {
                "status": "unclear",
                "reason": "resume_without_explicit_basic_acceptance",
                "confidence": 0.55,
                "basicMessage": basic_message,
                "lastOther": last_other,
                "otherMessages": other_messages[-5:],
                "decisionMessage": last_other,
                "judgement": {
                    "status": "unclear",
                    "confidence": 0.55,
                    "reason": "resume_without_explicit_basic_acceptance",
                    "sourceText": safe_text(str(last_other.get("text") or ""), 160),
                },
                "decisionBasis": build_screening_decision_basis(
                    "unclear",
                    "resume_without_explicit_basic_acceptance",
                    basic_message=basic_message,
                    last_other=last_other,
                    other_messages=other_messages,
                    judgement={"reason": "resume_without_explicit_basic_acceptance"},
                    decision_message=last_other,
                    latest_resume_message=last_other,
                ),
            }
    if judgement.get("status") == "unclear" and len(other_messages) > 1:
        for prior in reversed(other_messages[:-1]):
            prior_judgement = classify_basic_condition_acceptance(str(prior.get("text") or ""))
            if prior_judgement.get("status") == "reject":
                return {
                    "status": "reject",
                    "reason": "candidate_rejected_before_latest_unclear_message",
                    "confidence": prior_judgement.get("confidence"),
                    "basicMessage": basic_message,
                    "lastOther": last_other,
                    "otherMessages": other_messages[-5:],
                    "decisionMessage": prior,
                    "judgement": prior_judgement,
                    "decisionBasis": build_screening_decision_basis(
                        "reject",
                        "candidate_rejected_before_latest_unclear_message",
                        basic_message=basic_message,
                        last_other=last_other,
                        other_messages=other_messages,
                        judgement=prior_judgement,
                        decision_message=prior,
                    ),
                }
            if prior_judgement.get("status") == "accept":
                return {
                    "status": "accept",
                    "reason": "candidate_accepted_before_latest_unclear_message",
                    "confidence": prior_judgement.get("confidence"),
                    "basicMessage": basic_message,
                    "lastOther": last_other,
                    "otherMessages": other_messages[-5:],
                    "decisionMessage": prior,
                    "judgement": prior_judgement,
                    "decisionBasis": build_screening_decision_basis(
                        "accept",
                        "candidate_accepted_before_latest_unclear_message",
                        basic_message=basic_message,
                        last_other=last_other,
                        other_messages=other_messages,
                        judgement=prior_judgement,
                        decision_message=prior,
                    ),
                }
    return {
        "status": judgement.get("status", "unclear"),
        "reason": judgement.get("reason"),
        "confidence": judgement.get("confidence"),
        "basicMessage": basic_message,
        "lastOther": last_other,
        "otherMessages": other_messages[-5:],
        "judgement": judgement,
        "decisionBasis": build_screening_decision_basis(
            str(judgement.get("status", "unclear")),
            str(judgement.get("reason") or ""),
            basic_message=basic_message,
            last_other=last_other,
            other_messages=other_messages,
            judgement=judgement,
            decision_message=last_other,
        ),
    }


def compact_position_screening_text(value: str) -> str:
    text = str(value or "").lower()
    return re.sub(r"[\s:：,，.。!！?？、;；\"'“”‘’()（）\[\]【】]+", "", text)


def match_position_screening_disqualifying_message(messages: list[dict], screening: dict) -> dict:
    if not isinstance(messages, list) or not isinstance(screening, dict):
        return {}
    rules = screening.get("rejectIfCandidateMessageMatches")
    if not isinstance(rules, list) or not rules:
        return {}
    other_messages = [
        item for item in messages
        if isinstance(item, dict)
        and item.get("sender") == "other"
        and is_effective_chat_text(str(item.get("text") or ""))
    ]
    for message in reversed(other_messages[-5:]):
        raw_text = str(message.get("text") or "").strip()
        compact_text = compact_position_screening_text(raw_text)
        if not compact_text:
            continue
        for rule in rules:
            if not isinstance(rule, dict):
                continue
            patterns = rule.get("patterns") if isinstance(rule.get("patterns"), list) else []
            for pattern in patterns:
                pattern_text = str(pattern or "").strip()
                pattern_compact = compact_position_screening_text(pattern_text)
                if pattern_compact and pattern_compact in compact_text:
                    return {
                        "matched": True,
                        "id": safe_text(str(rule.get("id") or ""), 80),
                        "pattern": safe_text(pattern_text, 120),
                        "reason": safe_text(str(rule.get("reason") or "candidate_message_matched_disqualifying_pattern"), 160),
                        "message": message,
                    }
            regex_patterns = rule.get("regexPatterns") if isinstance(rule.get("regexPatterns"), list) else []
            for pattern in regex_patterns:
                pattern_text = str(pattern or "").strip()
                if pattern_text and re.search(pattern_text, raw_text, flags=re.I):
                    return {
                        "matched": True,
                        "id": safe_text(str(rule.get("id") or ""), 80),
                        "pattern": safe_text(pattern_text, 120),
                        "reason": safe_text(str(rule.get("reason") or "candidate_message_matched_disqualifying_pattern"), 160),
                        "message": message,
                    }
    return {}


def normalize_screening_question_variants(text: str, raw_variants: object) -> list[str]:
