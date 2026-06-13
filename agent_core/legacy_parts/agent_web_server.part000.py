from __future__ import annotations

import atexit
import base64
import hashlib
import json
import math
import mimetypes
import os
import random
import re
import shutil
import threading
import time
import uuid
from functools import wraps
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from cloak_terminal_controller import (
    BrowserTerminal,
    DEFAULT_CDP,
    PACE_PRESETS,
    append_memory,
    build_bezier_cursor_path,
    draw_visual_trail,
    format_action,
    get_related_memory,
    get_role_name,
    highlight_target,
    ensure_visual_cursor,
    is_dangerous,
    move_visual_cursor,
    normalize_llm_actions,
    safe_eval,
    safe_text,
)
from boss_recruiter_proactive import (
    add_checkpoint,
    append_jsonl,
    finish_action_log,
    new_candidate_action_log,
    recommend_candidate_colleague_progress_check,
    validate_after_greet,
    validate_before_greet,
)


HOST = "127.0.0.1"
PORT = int(os.environ.get("AGENT_WEB_PORT", "8787"))
ROOT = Path(__file__).resolve().parent
PORT_DEFAULTS = {
    8787: {
        "accountId": "boss_a",
        "accountName": "宋峰峰",
        "bossCdp": "http://127.0.0.1:9222",
        "bossProfile": "cdp-browser-profile",
        "job51Cdp": "http://127.0.0.1:9224",
        "job51Profile": "cdp-browser-profile-51job",
        "zhilianCdp": "http://127.0.0.1:9226",
        "zhilianProfile": "cdp-browser-profile-zhilian",
    },
    8788: {
        "accountId": "boss_b",
        "accountName": "和新红",
        "bossCdp": "http://127.0.0.1:9230",
        "bossProfile": "cdp-browser-profile-boss-b",
        "job51Cdp": "http://127.0.0.1:9225",
        "job51Profile": "cdp-browser-profile-51job-boss-b",
        "zhilianCdp": "http://127.0.0.1:9231",
        "zhilianProfile": "cdp-browser-profile-zhilian-boss-b",
    },
    8789: {
        "accountId": "job51_a",
        "accountName": "51 宋峰峰",
        "bossCdp": "http://127.0.0.1:9224",
        "bossProfile": "cdp-browser-profile-51job",
        "job51Cdp": "http://127.0.0.1:9224",
        "job51Profile": "cdp-browser-profile-51job",
        "zhilianCdp": "http://127.0.0.1:9226",
        "zhilianProfile": "cdp-browser-profile-zhilian",
    },
    8790: {
        "accountId": "zhilian_a",
        "accountName": "智联 宋峰峰",
        "bossCdp": "http://127.0.0.1:9226",
        "bossProfile": "cdp-browser-profile-zhilian",
        "job51Cdp": "http://127.0.0.1:9224",
        "job51Profile": "cdp-browser-profile-51job",
        "zhilianCdp": "http://127.0.0.1:9226",
        "zhilianProfile": "cdp-browser-profile-zhilian",
    },
    8791: {
        "accountId": "job51_b",
        "accountName": "51 和新红",
        "bossCdp": "http://127.0.0.1:9225",
        "bossProfile": "cdp-browser-profile-51job-boss-b",
        "job51Cdp": "http://127.0.0.1:9225",
        "job51Profile": "cdp-browser-profile-51job-boss-b",
        "zhilianCdp": "http://127.0.0.1:9231",
        "zhilianProfile": "cdp-browser-profile-zhilian-boss-b",
    },
    8792: {
        "accountId": "zhilian_b",
        "accountName": "智联 和新红",
        "bossCdp": "http://127.0.0.1:9231",
        "bossProfile": "cdp-browser-profile-zhilian-boss-b",
        "job51Cdp": "http://127.0.0.1:9225",
        "job51Profile": "cdp-browser-profile-51job-boss-b",
        "zhilianCdp": "http://127.0.0.1:9231",
        "zhilianProfile": "cdp-browser-profile-zhilian-boss-b",
    },
}
PORT_DEFAULT = PORT_DEFAULTS.get(PORT, PORT_DEFAULTS[8787])


def first_env_value(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return default


def cdp_port_key(cdp_url: str) -> str:
    try:
        parsed = urlparse(cdp_url)
        if parsed.port:
            return str(parsed.port)
    except Exception:
        pass
    return "9222"


def apply_port_profile_default(cdp_url: str, profile_key: str, generic: bool = False) -> None:
    profile_name = str(PORT_DEFAULT.get(profile_key) or "").strip()
    if not profile_name:
        return
    profile_dir = str(ROOT / profile_name)
    os.environ.setdefault(f"CDP_PROFILE_DIR_{cdp_port_key(cdp_url)}", profile_dir)
    if generic:
        os.environ.setdefault("CLOAK_PROFILE_DIR", profile_dir)


AGENT_ACCOUNT_ID = re.sub(
    r"[^a-zA-Z0-9_-]+",
    "_",
    first_env_value("AGENT_ACCOUNT_ID", default=PORT_DEFAULT["accountId"]),
).strip("_") or PORT_DEFAULT["accountId"]
AGENT_ACCOUNT_NAME = first_env_value("AGENT_ACCOUNT_NAME", default=PORT_DEFAULT["accountName"])
AGENT_CDP_URL = first_env_value("CLOAK_CDP", "AGENT_CDP", default=PORT_DEFAULT.get("bossCdp") or DEFAULT_CDP)
JOB51_CDP_URL = first_env_value("JOB51_CDP", "CLOAK_CDP_51JOB", default=PORT_DEFAULT.get("job51Cdp") or "http://127.0.0.1:9224")
JOB51_CHAT_URL = os.environ.get("JOB51_CHAT_URL") or "https://ehire.51job.com/Revision/chat"
JOB51_RECOMMEND_URL = os.environ.get("JOB51_RECOMMEND_URL") or "https://ehire.51job.com/Revision/talent/search-recommend"
JOB51_WORKER_TIMEOUT_SECONDS = 300
ZHILIAN_CDP_URL = first_env_value("ZHILIAN_CDP", "CLOAK_CDP_ZHILIAN", default=PORT_DEFAULT.get("zhilianCdp") or "http://127.0.0.1:9226")
apply_port_profile_default(AGENT_CDP_URL, "bossProfile", generic=True)
apply_port_profile_default(JOB51_CDP_URL, "job51Profile")
apply_port_profile_default(ZHILIAN_CDP_URL, "zhilianProfile")
ZHILIAN_CHAT_URL = os.environ.get("ZHILIAN_CHAT_URL") or "https://rd6.zhaopin.com/app/im"
ZHILIAN_RECOMMEND_URL = os.environ.get("ZHILIAN_RECOMMEND_URL") or "https://rd6.zhaopin.com/app/recommend"
WEB_DIR = ROOT / "web_agent"
UPLOAD_DIR = ROOT / "agent_uploads"


def account_scoped_file(filename: str) -> Path:
    path = ROOT / filename
    if AGENT_ACCOUNT_ID in {"", "boss_a", "default"}:
        return path
    return path.with_name(f"{path.stem}.{AGENT_ACCOUNT_ID}{path.suffix}")


FILE_REGISTRY = account_scoped_file("agent_files.json")
EVENT_LOG = account_scoped_file("agent_web_events.json")
CHAT_STATE_FILE = account_scoped_file("agent_chat_state.json")
CHAT_MEMORY_FILE = account_scoped_file("agent_chat_memory.json")
UNCLEAR_QUESTIONS_FILE = account_scoped_file("recruiter_unclear_questions.json")
USER_QUESTIONS_FILE = account_scoped_file("recruiter_user_questions.json")
RECRUITER_BATCH_REPORTS_FILE = account_scoped_file("recruiter_batch_reports.json")
RECRUITER_DECISION_LOG_FILE = account_scoped_file("recruiter_decision_log.json")
PROACTIVE_ACTION_LOG_FILE = account_scoped_file("recruiter_proactive_action_log.jsonl")
COMMON_PHRASE_CACHE_FILE = account_scoped_file("recruiter_common_phrase_cache.json")
JOB51_RESUME_DOWNLOADS_FILE = account_scoped_file("job51_resume_downloads.json")
RECRUITER_RESUME_DOWNLOADS_FILE = account_scoped_file("recruiter_resume_downloads.json")
LOCAL_ENV_FILE = ROOT / "browser_agent.env"
MODEL_CONFIG_FILE = ROOT / "agent_model_config.json"
LOCAL_FILE_EXTENSIONS = {".pdf", ".doc", ".docx"}
JOB51_RESUME_DIR = Path(
    os.environ.get("JOB51_RESUME_DIR")
    or (Path.home() / "Documents" / "New project" / "招聘智能体" / "51-resumes")
)
RECRUITER_RESUME_DIR = Path(
    os.environ.get("RECRUITER_RESUME_DIR")
    or (Path.home() / "Documents" / "New project" / "招聘智能体" / "recruiter-resumes")
)
DEFAULT_MODEL_CONFIG = {
    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "qwen-max",
}
CHAT_TOOL_NAMES = {
    "chat_read_context",
    "chat_load_history",
    "chat_find_input",
    "chat_fill_draft",
    "chat_request_send_confirmation",
    "chat_send_resume",
    "recruiter_send_company_info",
    "recruiter_send_common_phrase",
    "recruiter_process_unread_all_positions",
    "recruiter_process_current_position",
    "recruiter_answer_candidate_questions",
    "recruiter_proactive_contact_recommended_candidates",
    "recruiter_request_resume",
    "recruiter_confirm_resume_request",
    "recruiter_mark_unsuitable",
    "recruiter_confirm_unsuitable",
    "job51_process_unread_all_positions",
    "job51_process_current_position",
    "job51_answer_candidate_questions",
    "job51_request_resume",
    "job51_proactive_contact_recommended_candidates",
    "zhilian_process_unread_all_positions",
    "zhilian_process_current_position",
    "zhilian_answer_candidate_questions",
    "zhilian_request_resume",
    "zhilian_proactive_contact_recommended_candidates",
}
CHAT_REPLY_MAX_CHARS = 48
CHAT_MULTI_QUESTION_REPLY_MAX_CHARS = 96
CHAT_SEND_MAX_ATTEMPTS = 3
SCREENING_MODEL_MESSAGE_LIMIT = 28
SCREENING_MODEL_TIMEOUT_SECONDS = int(os.environ.get("SCREENING_MODEL_TIMEOUT_SECONDS", "45"))
USER_QUESTION_MODEL_TIMEOUT_SECONDS = int(os.environ.get("USER_QUESTION_MODEL_TIMEOUT_SECONDS", "25"))
MODEL_SOCKET_TIMEOUT_SECONDS = int(os.environ.get("MODEL_SOCKET_TIMEOUT_SECONDS", "30"))
MODEL_ENABLE_NON_STREAM_FALLBACK = os.environ.get("MODEL_ENABLE_NON_STREAM_FALLBACK", "0").lower() in {"1", "true", "yes"}
PROACTIVE_SEMANTIC_MODEL = os.environ.get("PROACTIVE_SEMANTIC_MODEL", "gpt-5.4-mini")
PROACTIVE_SEMANTIC_TIMEOUT_SECONDS = int(os.environ.get("PROACTIVE_SEMANTIC_TIMEOUT_SECONDS", "30"))
AUTOMATION_BASE_SPEED_MULTIPLIER = 1.75
AUTOMATION_SPEED_MULTIPLIER = AUTOMATION_BASE_SPEED_MULTIPLIER
AUTOMATION_SPEED_FACTORS = (1.0, 1.5, 1.75, 2.0)
AUTOMATION_SPEED_MULTIPLIERS = (1.0,) + tuple(AUTOMATION_BASE_SPEED_MULTIPLIER * factor for factor in AUTOMATION_SPEED_FACTORS)
PROACTIVE_CONTACT_SPEED_MULTIPLIER = 1.0
MIN_SCALED_WAIT_MS = 25
RECRUITER_STAGE_BY_STATUS = {
    "basic_conditions_opened_unsent": "\u5f85\u89c2\u5bdf",
    "basic_conditions_sent_waiting": "\u5df2\u53d1\u57fa\u7840\u60c5\u51b5",
    "basic_conditions_waiting": "\u5f85\u89c2\u5bdf",
    "knowledge_answered_waiting": "\u5df2\u7b54\u7591",
    "knowledge_silent_skipped": "\u5f85\u89c2\u5bdf",
    "basic_conditions_accepted_resume_requested": "\u5df2\u6c42\u7b80\u5386",
    "basic_conditions_accepted_resume_already_requested": "\u5df2\u6c42\u7b80\u5386",
    "basic_conditions_accepted_resume_downloaded": "\u5df2\u4e0b\u8f7d\u7b80\u5386",
    "basic_conditions_accepted_resume_blocked": "\u53d1\u9001\u5931\u8d25\u5f85\u91cd\u8bd5",
    "basic_conditions_rejected": "\u4e0d\u5408\u9002\u8df3\u8fc7",
    "basic_conditions_needs_resend": "\u53d1\u9001\u5931\u8d25\u5f85\u91cd\u8bd5",
    "position_screening_sent_waiting": "\u5df2\u53d1\u5c97\u4f4d\u7b5b\u9009\u95ee\u9898",
    "position_screening_waiting": "\u5f85\u89c2\u5bdf",
    "position_screening_accepted_resume_requested": "\u5df2\u6c42\u7b80\u5386",
    "position_screening_accepted_resume_already_requested": "\u5df2\u6c42\u7b80\u5386",
    "position_screening_accepted_resume_downloaded": "\u5df2\u4e0b\u8f7d\u7b80\u5386",
    "position_screening_accepted_resume_blocked": "\u53d1\u9001\u5931\u8d25\u5f85\u91cd\u8bd5",
    "position_screening_rejected": "\u4e0d\u5408\u9002\u8df3\u8fc7",
    "position_screening_unclear": "\u5f85\u89c2\u5bdf",
    "position_screening_send_blocked": "\u53d1\u9001\u5931\u8d25\u5f85\u91cd\u8bd5",
    "zhilian_resume_downloaded": "\u5df2\u4e0b\u8f7d\u7b80\u5386",
    "job51_resume_downloaded": "\u5df2\u4e0b\u8f7d\u7b80\u5386",
}
RECRUITER_NEXT_ACTION_BY_STATUS = {
    "basic_conditions_opened_unsent": "send_basic_conditions",
    "basic_conditions_needs_resend": "retry_send_basic_conditions",
    "basic_conditions_sent_waiting": "wait_candidate_reply",
    "basic_conditions_waiting": "wait_candidate_reply",
    "knowledge_answered_waiting": "wait_candidate_reply",
    "knowledge_silent_skipped": "wait_candidate_reply",
    "basic_conditions_accepted_resume_requested": "done_resume_requested",
    "basic_conditions_accepted_resume_already_requested": "done_resume_already_requested",
    "basic_conditions_accepted_resume_downloaded": "done_resume_downloaded",
    "basic_conditions_accepted_resume_blocked": "retry_request_resume",
    "basic_conditions_rejected": "done_skip_unsuitable",
    "position_screening_sent_waiting": "wait_candidate_reply",
    "position_screening_waiting": "wait_candidate_reply",
    "position_screening_accepted_resume_requested": "done_resume_requested",
    "position_screening_accepted_resume_already_requested": "done_resume_already_requested",
    "position_screening_accepted_resume_downloaded": "done_resume_downloaded",
    "position_screening_accepted_resume_blocked": "retry_request_resume",
    "position_screening_rejected": "done_skip_unsuitable",
    "position_screening_unclear": "wait_or_manual_review",
    "position_screening_send_blocked": "retry_send_screening_question",
    "zhilian_resume_downloaded": "done_resume_downloaded",
    "job51_resume_downloaded": "done_resume_downloaded",
    "proactive_greeted": "wait_candidate_reply",
}
CHAT_TYPE_DELAY_MS = (55, 105)
CHAT_HISTORY_SCROLL_ROUNDS = 8
CHAT_STATE_TTL_SECONDS = 6 * 60 * 60
CHAT_MEMORY_TTL_SECONDS = 30 * 24 * 60 * 60
RECENT_UNANSWERED_OTHER_LIMIT = 3
PAGE_TOOL_NAMES = {
    "observe_page_summary",
    "find_element",
    "verify_result",
    "recover_from_error",
}
FUNCTION_TOOL_NAMES = CHAT_TOOL_NAMES | PAGE_TOOL_NAMES
SEND_BUTTON_WHITELIST = {"发送", "send", "鍙戦€?"}
BASIC_CONDITIONS_PHRASE = "我先介绍下基本情况，日薪150，偶尔加班，加班1.5倍薪资，单休，需要线下工作，并且最少实习六个月，工作地点都能接受吗"
BASIC_CONDITIONS_TERMS = ("日薪150", "加班1.5倍", "单休", "线下工作", "实习六个月")


def normalize_automation_speed_multiplier(value, fallback: float = AUTOMATION_SPEED_MULTIPLIER) -> float:
    try:
        raw = float(value)
    except Exception:
        raw = float(fallback)
    for multiplier in AUTOMATION_SPEED_MULTIPLIERS:
        if abs(raw - multiplier) < 0.001:
            return multiplier
    return float(fallback)


def normalize_automation_speed_factor(value, fallback: float = 1.0) -> float:
    try:
        raw = float(value)
    except Exception:
        raw = float(fallback)
    for factor in AUTOMATION_SPEED_FACTORS:
        if abs(raw - factor) < 0.001:
            return factor
    return float(fallback)


def apply_automation_speed_multiplier(terminal: BrowserTerminal) -> None:
    """Scale browser waits so automation keeps its behavior but runs faster."""
    try:
        page = terminal.current_page()
    except Exception:
        return
    if getattr(page, "_codex_speed_scaled", False):
        return
    original_wait = page.wait_for_timeout

    def scaled_wait_for_timeout(timeout: float) -> None:
        try:
            raw = float(timeout or 0)
        except Exception:
            raw = 0.0
        multiplier = normalize_automation_speed_multiplier(
            getattr(terminal, "automation_speed_multiplier", AUTOMATION_SPEED_MULTIPLIER),
            AUTOMATION_SPEED_MULTIPLIER,
        )
        if raw <= 0:
            scaled = 0
        elif multiplier <= 1:
            scaled = int(raw)
        else:
            scaled = int(max(MIN_SCALED_WAIT_MS, raw / multiplier))
        return original_wait(scaled)

    try:
        page._codex_original_wait_for_timeout = original_wait
        page.wait_for_timeout = scaled_wait_for_timeout
        page._codex_speed_scaled = True
    except Exception:
        return


def browser_real_wait(page, timeout_ms: int | float) -> None:
    """Wait without the global automation speed multiplier."""
    try:
        timeout = int(max(0, float(timeout_ms or 0)))
    except Exception:
        timeout = 0
    original_wait = getattr(page, "_codex_original_wait_for_timeout", None)
    if callable(original_wait):
        original_wait(timeout)
        return
    page.wait_for_timeout(timeout)

BOSS_RULES_FILE = ROOT / "boss_chat_rules.json"
AGENT_SKILLS_DIR = ROOT / "agent_skills"
BOSS_RECRUITER_SKILL_FILE = AGENT_SKILLS_DIR / "boss-recruiter-automation" / "SKILL.md"
JOB51_RECRUITER_SKILL_FILE = AGENT_SKILLS_DIR / "51job-recruiter-automation" / "SKILL.md"
ZHILIAN_RECRUITER_SKILL_FILE = AGENT_SKILLS_DIR / "zhilian-recruiter-automation" / "SKILL.md"
BOSS_CHAT_RULES_CACHE_LOCK = threading.RLock()
BOSS_CHAT_RULES_CACHE: dict[str, object] = {"signature": None, "data": None}
COMPANY_KNOWLEDGE_SELECTION_CACHE: dict[tuple[int, str], dict] = {}
POSITION_REPLY_SELECTION_CACHE: dict[tuple[int, str], dict] = {}
SCAN_ROOTS = [
    Path.home() / "Desktop",
    Path.home() / "Downloads",
    Path.home() / "Documents",
    Path(r"C:\Users\24471\Documents\New project"),
]
JOB51_CONFIGURED_POSITIONS = (
    "膨润土销售人员",
    "国际业务管培生",
    "电气工程师",
    "应用技术经理（工业涂料领域）",
    "外贸销售经理（流变助剂）",
    "销售工程师（石油钻井泥浆膨润土）",
    "销售管培生",
    "AI应用开发实习生",
    "HRBP",
    "人力资源",
    "人力资源管培生",
)
ZHILIAN_CONFIGURED_POSITIONS = (
    "电气工程师",
    "膨润土销售人员",
    "国际业务管培生",
    "人力资源管培生",
    "销售管培生",
    "hrbp",
    "AI应用开发实习生",
    "应用技术",
    "应用技术经理（工业涂料领域）",
    "外贸销售经理（流变助剂）",
    "石油销售",
    "销售工程师（石油钻井泥浆膨润土）",
)


def job51_position_label_matches(label: str, target_position: str) -> bool:
    label_clean = clean_applied_position(label)
    target_clean = clean_applied_position(target_position)
    if not label_clean or not target_clean:
        return False
    if target_clean in label_clean or label_clean in target_clean:
        return True
    if target_clean.lower() == "hrbp" and "人力资源" in label_clean:
        return True
    if "人力资源" in target_clean and label_clean.lower() == "hrbp":
        return True
    return recommend_position_matches(label_clean, target_clean)


def zhilian_position_label_matches(label: str, target_position: str) -> bool:
    label_clean = clean_applied_position(label)
    target_clean = clean_applied_position(target_position)
    if not label_clean or not target_clean:
        return False
    if target_clean in label_clean or label_clean in target_clean:
        return True
    if target_clean.lower() == "hrbp" and "人力资源" in label_clean:
        return True
    if "人力资源" in target_clean and label_clean.lower() == "hrbp":
        return True
    return recommend_position_matches(label_clean, target_clean)


def recruiter_stage_for_status(status: str) -> str:
    return RECRUITER_STAGE_BY_STATUS.get(str(status or "").strip(), "")


def recruiter_next_action_for_status(status: str) -> str:
    status = str(status or "").strip()
    if status in RECRUITER_NEXT_ACTION_BY_STATUS:
        return RECRUITER_NEXT_ACTION_BY_STATUS[status]
    if "resume" in status and "blocked" in status:
        return "retry_request_resume"
    if "resume" in status and "requested" in status:
        return "done_resume_requested"
    if "rejected" in status:
        return "done_skip_unsuitable"
    if "waiting" in status:
        return "wait_candidate_reply"
    if "blocked" in status:
        return "retry_or_manual_review"
    if "unclear" in status:
        return "wait_or_manual_review"
    return "review_next"


def is_ai_app_basic_conditions_position(context: dict | None, position_reply: dict | None = None) -> bool:
    context = context if isinstance(context, dict) else {}
    position_reply = position_reply if isinstance(position_reply, dict) else {}
    knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
    texts = [
        context.get("appliedPosition"),
        applicant.get("appliedPosition"),
        knowledge_base.get("title"),
        position_reply.get("category"),
        position_reply.get("matched"),
    ]
    for raw in texts:
        compact = re.sub(r"\s+", "", str(raw or "")).lower()
        if not compact:
            continue
        if "ai" in compact and "应用开发" in compact:
            return True
        if "应用开发" in compact and ("实习" in compact or "工程师" in compact or "大模型" in compact):
            return True
    return False


def is_explicit_ai_app_basic_conditions_position(context: dict | None) -> bool:
    context = context if isinstance(context, dict) else {}
    applicant = context.get("applicant") if isinstance(context.get("applicant"), dict) else {}
    position_values = [
        context.get("appliedPosition"),
        applicant.get("appliedPosition"),
    ]
    allowed_positions = (
        "AI应用开发实习生",
        "AI应用开发工程师",
    )
    for raw in position_values:
        clean = clean_applied_position(str(raw or ""))
        compact = re.sub(r"\s+", "", clean).lower()
        if not compact:
            continue
        for allowed in allowed_positions:
            allowed_compact = re.sub(r"\s+", "", clean_applied_position(allowed)).lower()
            if compact == allowed_compact or allowed_compact in compact:
                return True
    return False


def recruiter_workflow_for_context(context: dict | None, status: str = "", payload: dict | None = None) -> str:
    context = context if isinstance(context, dict) else {}
    payload = payload if isinstance(payload, dict) else {}
    if status == "proactive_greeted" or payload.get("source") == "recommend":
        return "proactive_contact"
    position_reply = context.get("positionReply") if isinstance(context.get("positionReply"), dict) else {}
    knowledge_base = context.get("companyKnowledgeBase") if isinstance(context.get("companyKnowledgeBase"), dict) else {}
    screening = knowledge_base.get("screening") if isinstance(knowledge_base.get("screening"), dict) else {}
    if str(position_reply.get("initialCommonPhrase") or "").strip() and is_ai_app_basic_conditions_position(context, position_reply):
        return "basic_conditions_screening"
    if normalize_position_screening_questions(screening):
        return "position_skill_screening"
    if knowledge_base.get("enabled"):
        return "knowledge_answering"
    return "unconfigured_position_skip"


class AgentError(RuntimeError):
    pass


class PauseRequested(AgentError):
    pass


def timed_agent_stage(key: str, label: str):
    def decorator(func):
        @wraps(func)
        def wrapper(self, *args, **kwargs):
            measure = getattr(self, "measure_current_timing_stage", None)
            if not callable(measure):
                return func(self, *args, **kwargs)
            return measure(key, label, lambda: func(self, *args, **kwargs))

        return wrapper

    return decorator


class WebAgentService:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.terminal: BrowserTerminal | None = None
        self.terminal_thread_id: int | None = None
        self.files = load_json(FILE_REGISTRY, [])
        self.events = load_json(EVENT_LOG, [])
        self.chat_states = load_json(CHAT_STATE_FILE, {})
        if not isinstance(self.chat_states, dict):
            self.chat_states = {}
        self.chat_memories = load_json(CHAT_MEMORY_FILE, {})
        if not isinstance(self.chat_memories, dict):
            self.chat_memories = {}
        self.common_phrase_cache = load_json(COMMON_PHRASE_CACHE_FILE, {})
        if not isinstance(self.common_phrase_cache, dict):
            self.common_phrase_cache = {}
        self.local_candidates: list[dict] = []
        self.pending_actions: dict[str, dict] = {}
        self.last_find_element_matches: list[dict] = []
        self.chat_monitor_signature = ""
        self.chat_monitor_unread_signature = ""
        self.chat_monitor_handled_unread_signature = ""
        self.chat_monitor_cooldown_until = 0.0
        self.chat_monitor_suggestions: list[dict] = []
        self.current_operation_timing: dict | None = None
        self.last_operation_timing: dict | None = None
        self.pause_requested = False
        self.pause_reason = ""
        self.pause_updated_at = 0.0
        # Runtime limits/guards. Previously these were hard-coded (e.g. 6 steps, dangerous-click confirmation).
        # Defaults here are permissive to avoid artificially limiting human-like/autonomous operation.
        self.max_steps = 30
        self.max_actions_per_step: int | None = 20
        self.require_confirm_dangerous_clicks = False
        self.require_confirm_send_message = False
        # Bulk-chat/campaign defaults (anti-abuse / anti-lockup)
        self.bulk_max_chats = 30
        self.bulk_delay_ms_range = (220, 520)
        self.bulk_stop_on_captcha = True
        self.bulk_personalize = False
        # Multi-round chat waiting knobs
        self.chat_wait_timeout_ms = 20000
        self.chat_wait_poll_ms = 800
        self.automation_speed_factor = 1.0
        self.automation_speed_multiplier = AUTOMATION_SPEED_MULTIPLIER
        self.proactive_task_lock = threading.Lock()
        self.boss_process_tasks: dict[str, dict] = {}
        self.boss_process_tasks_lock = threading.Lock()
        self.boss_process_task_ttl_seconds = 6 * 60 * 60

    def save_common_phrase_cache(self) -> None:
        save_json(COMMON_PHRASE_CACHE_FILE, self.common_phrase_cache)

    def get_common_phrase_cache(self, key: str = "basic_conditions") -> dict:
        cache = self.common_phrase_cache.get(key)
        return cache if isinstance(cache, dict) else {}

    def update_common_phrase_cache(self, key: str = "basic_conditions", **values) -> dict:
        cache = dict(self.get_common_phrase_cache(key))
        cache.update({
            **values,
            "accountId": AGENT_ACCOUNT_ID,
            "accountName": AGENT_ACCOUNT_NAME,
            "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "updatedAtTs": time.time(),
        })
        self.common_phrase_cache[key] = cache
        self.save_common_phrase_cache()
        return cache

    def clear_common_phrase_cache(self, key: str = "basic_conditions") -> None:
        if key in self.common_phrase_cache:
            self.common_phrase_cache.pop(key, None)
            self.save_common_phrase_cache()

    def _cached_box(self, value) -> dict:
        if not isinstance(value, dict):
            return {}
        try:
            x = float(value.get("x") or 0)
            y = float(value.get("y") or 0)
            width = float(value.get("width") or value.get("w") or 0)
            height = float(value.get("height") or value.get("h") or 0)
        except Exception:
            return {}
        if width <= 2 or height <= 2:
            return {}
        return {"x": x, "y": y, "width": width, "height": height}

    def click_cached_common_phrase_button(self, terminal: BrowserTerminal, key: str = "basic_conditions") -> dict:
        cache = self.get_common_phrase_cache(key)
        box = self._cached_box(cache.get("buttonBox"))
        if not box:
            return {"clicked": False, "reason": "no_cached_button"}
        page = terminal.current_page()
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        if box["x"] < 0 or box["y"] < 0 or box["x"] > float(viewport.get("width", 1280)) or box["y"] > float(viewport.get("height", 720)):
            self.clear_common_phrase_cache(key)
            return {"clicked": False, "reason": "cached_button_out_of_view"}
        try:
            if terminal.humanize:
                terminal.pause_like_person("pre_action")
            x, y = target_box_inner_point(box)
            humanized_point_click(terminal, x, y, target_box=box)
            page.wait_for_timeout(random.randint(420, 820))
            opened = is_common_phrase_panel_open(terminal)
            if not opened:
                self.clear_common_phrase_cache(key)
            return {"clicked": bool(opened), "usedCache": True, "opened": bool(opened), "box": box}
        except Exception as error:
            self.clear_common_phrase_cache(key)
            return {"clicked": False, "usedCache": True, "error": safe_text(str(error), 160)}

    def click_cached_common_phrase_send(self, terminal: BrowserTerminal, phrase: str, item: dict | None = None, key: str = "basic_conditions") -> dict:
        cache = self.get_common_phrase_cache(key)
        send_box = self._cached_box(cache.get("sendBox"))
        row_box = self._cached_box((item or {}).get("rowBox")) or self._cached_box(item) or self._cached_box(cache.get("rowBox"))
        if not send_box or not row_box:
            return {"clicked": False, "reason": "no_cached_send"}
        page = terminal.current_page()
        try:
            hover_x = row_box["x"] + row_box["width"] * random.uniform(0.66, 0.82)
            hover_y = row_box["y"] + row_box["height"] * random.uniform(0.42, 0.58)
            move_cursor_like_person(
                terminal,
                hover_x,
                hover_y,
                duration_factor=random.uniform(0.18, 0.36),
                show_trail=False,
            )
            page.wait_for_timeout(random.randint(180, 360))
            adjusted_send_box = dict(send_box)
            cached_row = self._cached_box(cache.get("rowBox"))
            if cached_row:
                adjusted_send_box["y"] = send_box["y"] + ((row_box["y"] + row_box["height"] / 2) - (cached_row["y"] + cached_row["height"] / 2))
            x = adjusted_send_box["x"] + adjusted_send_box["width"] * random.uniform(0.42, 0.58)
            y = adjusted_send_box["y"] + adjusted_send_box["height"] * random.uniform(0.42, 0.58)
            humanized_point_click(terminal, x, y, target_box=adjusted_send_box)
            page.wait_for_timeout(random.randint(520, 980))
            return {
                "clicked": True,
                "found": True,
                "usedCache": True,
                "strategy": "cached_common_phrase_send",
                "label": "发送",
                "itemLabel": safe_text(str((item or {}).get("label") or phrase), 120),
                "x": round(adjusted_send_box["x"]),
                "y": round(adjusted_send_box["y"]),
                "w": round(adjusted_send_box["width"]),
                "h": round(adjusted_send_box["height"]),
                "rowBox": {
                    "x": round(row_box["x"]),
                    "y": round(row_box["y"]),
                    "w": round(row_box["width"]),
                    "h": round(row_box["height"]),
                },
            }
        except Exception as error:
            self.clear_common_phrase_cache(key)
            return {"clicked": False, "usedCache": True, "error": safe_text(str(error), 160)}

    def _operation_timing_timestamp(self, ts: float | None = None) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ts or time.time()))

    def start_operation_timing(self, operation_type: str, message: str = "") -> dict:
        now = time.time()
        timing = {
            "id": str(uuid.uuid4()),
            "type": operation_type,
            "accountId": AGENT_ACCOUNT_ID,
            "accountName": AGENT_ACCOUNT_NAME,
            "status": "running",
            "message": safe_text(message, 180),
            "startedAt": self._operation_timing_timestamp(now),
            "startedAtMs": int(now * 1000),
            "finishedAt": "",
            "totalMs": 0,
            "stages": [],
            "stageStats": {},
            "stageStatsList": [],
            "counters": {},
        }
        self.current_operation_timing = timing
        self.last_operation_timing = timing
        return timing

    def finish_operation_timing(self, timing: dict | None, status: str = "success", error: str = "") -> dict | None:
        if not isinstance(timing, dict):
            return None
        now = time.time()
        timing["status"] = status
        timing["finishedAt"] = self._operation_timing_timestamp(now)
        timing["totalMs"] = max(0, int(now * 1000) - int(timing.get("startedAtMs") or int(now * 1000)))
        if error:
            timing["error"] = safe_text(error, 260)
        if self.current_operation_timing is timing:
            self.current_operation_timing = None
        self.last_operation_timing = timing
        return timing

    def refresh_operation_timing_runtime(self, timing: dict | None) -> dict | None:
        if not isinstance(timing, dict):
            return None
        if timing.get("status") == "running":
            now_ms = int(time.time() * 1000)
            timing["totalMs"] = max(0, now_ms - int(timing.get("startedAtMs") or now_ms))
        return timing

    def measure_current_timing_stage(self, key: str, label: str, worker):
        timing = self.current_operation_timing
        if not isinstance(timing, dict):
            return worker()
        started = time.time()
        try:
            result = worker()
            self.record_current_timing_stage(key, label, started, ok=True)
            return result
        except Exception as error:
            self.record_current_timing_stage(key, label, started, ok=False, error=str(error))
            raise

    def record_current_timing_stage(
        self,
        key: str,
        label: str,
        started: float,
        ok: bool = True,
        error: str = "",
        extra: dict | None = None,
    ) -> None:
        timing = self.current_operation_timing
        if not isinstance(timing, dict):
            return
        finished = time.time()
        duration_ms = max(0, int((finished - started) * 1000))
        label = safe_text(str(label or key or ""), 80)
        stages = timing.setdefault("stages", [])
        if not isinstance(stages, list):
            timing["stages"] = stages = []
        counters = timing.setdefault("counters", {})
        if not isinstance(counters, dict):
            timing["counters"] = counters = {}
        counters["totalStages"] = int(counters.get("totalStages") or 0) + 1
        stats = timing.setdefault("stageStats", {})
        if not isinstance(stats, dict):
            timing["stageStats"] = stats = {}
        stat = stats.setdefault(
            str(key or "unknown"),
            {
                "key": str(key or "unknown"),
                "label": label,
                "count": 0,
                "okCount": 0,
                "failedCount": 0,
                "totalMs": 0,
                "avgMs": 0.0,
                "minMs": duration_ms,
                "maxMs": duration_ms,
                "lastMs": 0,
                "lastAt": "",
            },
        )
        if not isinstance(stat, dict):
            stat = {
                "key": str(key or "unknown"),
                "label": label,
                "count": 0,
                "okCount": 0,
                "failedCount": 0,
                "totalMs": 0,
                "avgMs": 0.0,
                "minMs": duration_ms,
                "maxMs": duration_ms,
                "lastMs": 0,
                "lastAt": "",
            }
            stats[str(key or "unknown")] = stat
        count = int(stat.get("count") or 0) + 1
        total_ms = int(stat.get("totalMs") or 0) + duration_ms
        stat.update(
            {
                "label": label or stat.get("label") or str(key or "unknown"),
                "count": count,
                "okCount": int(stat.get("okCount") or 0) + (1 if ok else 0),
                "failedCount": int(stat.get("failedCount") or 0) + (0 if ok else 1),
                "totalMs": total_ms,
                "avgMs": round(total_ms / count, 2) if count else 0.0,
                "minMs": min(int(stat.get("minMs") or duration_ms), duration_ms),
                "maxMs": max(int(stat.get("maxMs") or duration_ms), duration_ms),
                "lastMs": duration_ms,
                "lastAt": self._operation_timing_timestamp(finished),
            }
        )
        timing["stageStatsList"] = sorted(
            (dict(value) for value in stats.values() if isinstance(value, dict)),
            key=lambda item: int(item.get("totalMs") or 0),
            reverse=True,
        )
        if len(stages) >= 1200:
            stages.pop(0)
            counters["trimmedStages"] = int(counters.get("trimmedStages") or counters.get("droppedStages") or 0) + 1
            counters["droppedStages"] = counters["trimmedStages"]
        stage = {
            "key": key,
            "label": label,
            "startedAt": self._operation_timing_timestamp(started),
            "finishedAt": self._operation_timing_timestamp(finished),
            "durationMs": duration_ms,
            "ok": bool(ok),
        }
        if error:
            stage["error"] = safe_text(error, 260)
        if isinstance(extra, dict):
            stage.update(extra)
        stages.append(stage)

    def close(self) -> None:
        with self.lock:
            terminal = self.terminal
            owner_thread_id = self.terminal_thread_id
            self.terminal = None
            self.terminal_thread_id = None
            if terminal and (owner_thread_id is None or owner_thread_id == threading.get_ident()):
                try:
                    terminal.__exit__(None, None, None)
                except Exception:
                    pass

    def close_current_thread_terminal(self) -> None:
        current_thread_id = threading.get_ident()
        with self.lock:
            if not self.terminal or self.terminal_thread_id != current_thread_id:
                return
            terminal = self.terminal
            self.terminal = None
            self.terminal_thread_id = None
            try:
                terminal.__exit__(None, None, None)
            except Exception:
                pass

    def get_terminal(self) -> BrowserTerminal:
        current_thread_id = threading.get_ident()
        with self.lock:
            if self.terminal is not None and self.terminal_thread_id != current_thread_id:
                # Playwright's sync API is bound to the thread that created it.
                # Drop stale references instead of reusing them across HTTP worker threads.
                self.terminal = None
                self.terminal_thread_id = None
            if self.terminal is None:
                terminal = BrowserTerminal(
                    AGENT_CDP_URL,
                    page_index=0,
                    auto_start=True,
                    visual_cursor=True,
                    humanize=True,
                    pace="normal",
                )
                self.terminal = terminal.__enter__()
                self.terminal.automation_speed_multiplier = self.automation_speed_multiplier
                self.terminal_thread_id = current_thread_id
                apply_automation_speed_multiplier(self.terminal)
            else:
                self.terminal.automation_speed_multiplier = self.automation_speed_multiplier
                apply_automation_speed_multiplier(self.terminal)
            return self.terminal

    def status(self) -> dict:
        operation_timing = self.refresh_operation_timing_runtime(self.current_operation_timing or self.last_operation_timing)
        busy = bool(self.current_operation_timing)
        connected = self.terminal is not None
        if busy:
            page = {"busy": True, "message": "智能体正在执行任务，暂时不读取浏览器状态"}
        else:
            page = {"message": "空闲；状态接口不再主动读取浏览器，避免页面查询卡住自动化服务。"}
        return {
            "connected": connected,
            "busy": busy,
            "accountId": AGENT_ACCOUNT_ID,
            "accountName": AGENT_ACCOUNT_NAME,
            "cdp": {
                "boss": AGENT_CDP_URL,
                "job51": JOB51_CDP_URL,
                "zhilian": ZHILIAN_CDP_URL,
            },
            "page": page,
            "hasApiKey": has_model_key(),
            "modelConfig": public_model_config(),
            "automationSpeedFactor": self.automation_speed_factor,
            "automationSpeedMultiplier": self.automation_speed_multiplier,
            "pause": self.pause_state(),
            "operationTiming": operation_timing,
            "files": self.files[-8:],
            "localCandidates": self.local_candidates[:8],
            "events": self.events[-20:],
        }

    def pause_state(self) -> dict:
        return {
            "paused": bool(self.pause_requested),
            "reason": self.pause_reason,
            "updatedAt": self.pause_updated_at,
        }

    def set_pause(self, paused: bool, reason: str = "") -> dict:
        self.pause_requested = bool(paused)
        self.pause_reason = safe_text(str(reason or ("用户手动暂停" if paused else "")), 120)
        self.pause_updated_at = time.time()
        try:
            self.add_event("system", "已暂停执行" if paused else "已恢复执行")
        except Exception:
            pass
        return self.pause_state()

    def check_pause(self) -> None:
        if self.pause_requested:
            reason = self.pause_reason or "用户手动暂停"
            raise PauseRequested(f"任务已暂停：{reason}")

    def _prune_boss_process_tasks_locked(self) -> None:
        now = time.time()
        stale_ids: list[str] = []
        for task_id, task in self.boss_process_tasks.items():
            if not isinstance(task, dict):
                stale_ids.append(task_id)
                continue
            if task.get("status") == "running":
                continue
            finished_at_ms = int(task.get("finishedAtMs") or task.get("updatedAtMs") or 0)
            if finished_at_ms and now - (finished_at_ms / 1000) > self.boss_process_task_ttl_seconds:
                stale_ids.append(task_id)
        for task_id in stale_ids:
            self.boss_process_tasks.pop(task_id, None)

    def _boss_process_task_public(self, task: dict | None) -> dict:
        if not isinstance(task, dict):
            return {}
        public = dict(task)
        public.pop("payload", None)
        if public.get("status") == "running":
            timing = self.refresh_operation_timing_runtime(self.current_operation_timing)
            if isinstance(timing, dict):
                public["timings"] = timing
        return public

    def _update_boss_process_task(self, task_id: str, **patch) -> dict:
        now = time.time()
        with self.boss_process_tasks_lock:
            task = self.boss_process_tasks.get(task_id)
            if not isinstance(task, dict):
                return {}
            task.update(patch)
            task["updatedAt"] = self._operation_timing_timestamp(now)
            task["updatedAtMs"] = int(now * 1000)
            if patch.get("status") in {"completed", "failed", "paused"}:
                task["finishedAt"] = task["updatedAt"]
                task["finishedAtMs"] = task["updatedAtMs"]
            return self._boss_process_task_public(task)

    def get_boss_process_task(self, task_id: str) -> dict:
        task_id = safe_text(str(task_id or ""), 80)
        with self.boss_process_tasks_lock:
            self._prune_boss_process_tasks_locked()
            task = self.boss_process_tasks.get(task_id)
            if not isinstance(task, dict):
                return {"ok": False, "error": "task_not_found", "taskId": task_id}
            public = self._boss_process_task_public(task)
        return {
            "ok": True,
            "taskId": public.get("taskId") or task_id,
            "status": public.get("status") or "",
            "task": public,
            "result": public.get("result"),
            "error": public.get("error") or "",
        }

    def cancel_boss_process_task(self, task_id: str, reason: str = "") -> dict:
        task_id = safe_text(str(task_id or ""), 80)
        reason = safe_text(str(reason or "stop requested"), 180)
        should_pause = False
        with self.boss_process_tasks_lock:
            task = self.boss_process_tasks.get(task_id)
            if not isinstance(task, dict):
                return {"ok": False, "error": "task_not_found", "taskId": task_id}
            if task.get("status") == "running":
                task["cancelRequested"] = True
                task["cancelReason"] = reason
                should_pause = True
            public = self._boss_process_task_public(task)
        if should_pause:
            self.set_pause(True, reason)
            public = self._update_boss_process_task(task_id, cancelRequested=True, cancelReason=reason)
        return {
            "ok": True,
            "taskId": task_id,
            "status": public.get("status") or "",
            "task": public,
            "cancelRequested": bool(public.get("cancelRequested")),
        }

    def start_boss_process_task(self, payload: dict) -> dict:
        if not isinstance(payload, dict):
            payload = {}
        raw_max_total = payload.get("maxTotal", payload.get("count", 40))
        try:
            max_total = int(raw_max_total if raw_max_total is not None else 40)
        except Exception:
            max_total = 40
        max_total = max(1, max_total)
        target_position = safe_text(str(payload.get("targetPosition") or ""), 200)
        options = payload.get("options") if isinstance(payload.get("options"), dict) else None

        now = time.time()
        with self.boss_process_tasks_lock:
            self._prune_boss_process_tasks_locked()
            running = next(
                (
                    task
                    for task in self.boss_process_tasks.values()
                    if isinstance(task, dict) and task.get("status") == "running"
                ),
                None,
            )
            if isinstance(running, dict):
                public = self._boss_process_task_public(running)
                return {
                    "ok": True,
                    "taskId": public.get("taskId"),
                    "status": public.get("status"),
                    "task": public,
                    "alreadyRunning": True,
                }

            task_id = str(uuid.uuid4())
            task = {
                "taskId": task_id,
                "status": "running",
                "startedAt": self._operation_timing_timestamp(now),
                "startedAtMs": int(now * 1000),
                "updatedAt": self._operation_timing_timestamp(now),
                "updatedAtMs": int(now * 1000),
                "finishedAt": "",
                "finishedAtMs": 0,
                "maxTotal": max_total,
                "targetPosition": target_position,
                "cancelRequested": False,
                "cancelReason": "",
                "result": None,
                "error": "",
            }
            self.boss_process_tasks[task_id] = task
            public = self._boss_process_task_public(task)

        thread = threading.Thread(
            target=self._run_boss_process_task,
            args=(task_id, options, max_total, target_position),
            name=f"boss-process-{task_id[:8]}",
            daemon=True,
        )
        thread.start()
        return {"ok": True, "taskId": task_id, "status": "running", "task": public, "alreadyRunning": False}

    def _run_boss_process_task(
        self,
        task_id: str,
        options: dict | None,
        max_total: int,
        target_position: str,
    ) -> None:
        timing = None
        try:
            self.set_pause(False, "boss background process started")
            timing = self.start_operation_timing("chat", "BOSS process unread messages")
            with self.lock:
                if isinstance(options, dict):
                    self.set_options(options)
                terminal = self.get_terminal()
                result = self.screen_all_recruiter_unread_basic_conditions(
                    terminal,
                    max_total=max_total,
                    target_position=target_position,
                )
            finished_timing = self.finish_operation_timing(timing, "success")
            if isinstance(result, dict) and finished_timing:
                result["timings"] = finished_timing
            self._update_boss_process_task(
                task_id,
                status="completed",
                result=compact_process_messages_response(result),
                error="",
            )
        except PauseRequested as error:
            finished_timing = self.finish_operation_timing(timing, "paused", str(error))
            result = {
                "reply": str(error),
                "paused": True,
                "pause": self.pause_state(),
                "timings": finished_timing,
            }
            self._update_boss_process_task(
                task_id,
                status="paused",
                result=result,
                error=safe_text(str(error), 260),
            )
        except Exception as error:
            finished_timing = self.finish_operation_timing(timing, "failed", str(error))
            self._update_boss_process_task(
                task_id,
                status="failed",
                result={"error": str(error), "timings": finished_timing},
                error=safe_text(str(error), 260),
            )
        finally:
            self.close_current_thread_terminal()

    def _start_platform_process_task(self, platform: str, payload: dict) -> dict:
        if not isinstance(payload, dict):
            payload = {}
        platform = str(platform or "").strip().lower()
        if platform not in {"51job", "zhilian"}:
            return {"ok": False, "error": "unsupported_platform", "platform": platform}

        raw_max_total = payload.get("maxTotal", payload.get("count", 40))
        try:
            max_total = int(raw_max_total if raw_max_total is not None else 40)
        except Exception:
            max_total = 40
        max_total = max(1, max_total)
        target_position = safe_text(str(payload.get("targetPosition") or ""), 200)
        options = payload.get("options") if isinstance(payload.get("options"), dict) else None

        now = time.time()
        with self.boss_process_tasks_lock:
            self._prune_boss_process_tasks_locked()
            running = next(
                (
                    task
                    for task in self.boss_process_tasks.values()
                    if isinstance(task, dict) and task.get("status") == "running"
                ),
                None,
            )
            if isinstance(running, dict):
                public = self._boss_process_task_public(running)
                return {
                    "ok": True,
                    "taskId": public.get("taskId"),
                    "status": public.get("status"),
                    "task": public,
                    "alreadyRunning": True,
                }

            task_id = str(uuid.uuid4())
            task = {
                "taskId": task_id,
                "platform": platform,
                "status": "running",
                "startedAt": self._operation_timing_timestamp(now),
                "startedAtMs": int(now * 1000),
                "updatedAt": self._operation_timing_timestamp(now),
                "updatedAtMs": int(now * 1000),
                "finishedAt": "",
                "finishedAtMs": 0,
                "maxTotal": max_total,
                "targetPosition": target_position,
                "cancelRequested": False,
                "cancelReason": "",
                "result": None,
                "error": "",
            }
            self.boss_process_tasks[task_id] = task
            public = self._boss_process_task_public(task)

        thread = threading.Thread(
            target=self._run_platform_process_task,
            args=(platform, task_id, options, max_total, target_position),
            name=f"{platform}-process-{task_id[:8]}",
            daemon=True,
        )
        thread.start()
        return {"ok": True, "taskId": task_id, "status": "running", "task": public, "alreadyRunning": False}

    def start_job51_process_task(self, payload: dict) -> dict:
        return self._start_platform_process_task("51job", payload)

    def start_zhilian_process_task(self, payload: dict) -> dict:
        return self._start_platform_process_task("zhilian", payload)

    def _run_platform_process_task(
        self,
        platform: str,
        task_id: str,
        options: dict | None,
        max_total: int,
        target_position: str,
    ) -> None:
        timing = None
        try:
            self.set_pause(False, f"{platform} background process started")
            timing = self.start_operation_timing("chat", f"{platform} process unread messages")
            if isinstance(options, dict):
                self.set_options(options)
            if platform == "51job":
                timeout_seconds = max(300, min(1800, max_total * 60 + 180))
                result = self.with_job51_terminal(
                    lambda job51_terminal: self.job51_process_unread_all_positions(
                        job51_terminal,
                        max_total=max_total,
                        target_position=target_position,
                    ),
                    timeout_seconds=timeout_seconds,
                )
            elif platform == "zhilian":
                result = self.with_zhilian_terminal(
                    lambda zhilian_terminal: self.zhilian_process_unread_all_positions(
                        zhilian_terminal,
                        max_total=max_total,
                        target_position=target_position,
                    )
                )
            else:
                raise AgentError(f"unsupported platform: {platform}")
            finished_timing = self.finish_operation_timing(timing, "success")
            if isinstance(result, dict) and finished_timing:
                result["timings"] = finished_timing
            self._update_boss_process_task(
                task_id,
                status="completed",
                result=compact_process_messages_response(result),
                error="",
            )
        except PauseRequested as error:
            finished_timing = self.finish_operation_timing(timing, "paused", str(error))
            result = {
                "reply": str(error),
                "paused": True,
                "pause": self.pause_state(),
                "timings": finished_timing,
            }
            self._update_boss_process_task(
                task_id,
                status="paused",
                result=result,
                error=safe_text(str(error), 260),
            )
        except Exception as error:
            finished_timing = self.finish_operation_timing(timing, "failed", str(error))
            self._update_boss_process_task(
                task_id,
                status="failed",
                result={"error": str(error), "timings": finished_timing},
                error=safe_text(str(error), 260),
            )
        finally:
            self.close_current_thread_terminal()

    def set_options(self, options: dict) -> dict:
        with self.lock:
            terminal = self.get_terminal()
            if "cursor" in options:
                terminal.visual_cursor = bool(options["cursor"])
            if "humanize" in options:
                terminal.humanize = bool(options["humanize"])
            pace = str(options.get("pace") or terminal.pace).strip().lower()
            if pace in PACE_PRESETS:
                terminal.pace = pace
            if "speedFactor" in options or "automationSpeedFactor" in options:
                speed_value = options.get("speedFactor", options.get("automationSpeedFactor"))
                self.automation_speed_factor = normalize_automation_speed_factor(
                    speed_value,
                    self.automation_speed_factor,
                )
                self.automation_speed_multiplier = AUTOMATION_BASE_SPEED_MULTIPLIER * self.automation_speed_factor
                terminal.automation_speed_multiplier = self.automation_speed_multiplier
                apply_automation_speed_multiplier(terminal)
            elif "speedMultiplier" in options or "automationSpeedMultiplier" in options:
                speed_value = options.get("speedMultiplier", options.get("automationSpeedMultiplier"))
                self.automation_speed_multiplier = normalize_automation_speed_multiplier(
                    speed_value,
                    self.automation_speed_multiplier,
                )
                self.automation_speed_factor = self.automation_speed_multiplier / AUTOMATION_BASE_SPEED_MULTIPLIER
                terminal.automation_speed_multiplier = self.automation_speed_multiplier
                apply_automation_speed_multiplier(terminal)
            if "maxSteps" in options:
                self.max_steps = max(1, int(options["maxSteps"]))
            if "maxActionsPerStep" in options:
                raw = options["maxActionsPerStep"]
                if raw in {None, "", 0, "0", False}:
                    self.max_actions_per_step = None
                else:
                    self.max_actions_per_step = max(1, int(raw))
            if "confirmDangerousClicks" in options:
                self.require_confirm_dangerous_clicks = bool(options["confirmDangerousClicks"])
            if "confirmSendMessage" in options:
                self.require_confirm_send_message = bool(options["confirmSendMessage"])
            if "bulkMaxChats" in options:
                self.bulk_max_chats = max(1, int(options["bulkMaxChats"]))
            if "bulkDelayMsMin" in options or "bulkDelayMsMax" in options:
                low = int(options.get("bulkDelayMsMin") or self.bulk_delay_ms_range[0])
                high = int(options.get("bulkDelayMsMax") or self.bulk_delay_ms_range[1])
                if low < 0:
                    low = 0
                if high < low:
                    high = low
                self.bulk_delay_ms_range = (low, high)
            if "bulkStopOnCaptcha" in options:
                self.bulk_stop_on_captcha = bool(options["bulkStopOnCaptcha"])
            if "bulkPersonalize" in options:
                self.bulk_personalize = bool(options["bulkPersonalize"])
            if "chatWaitTimeoutMs" in options:
                self.chat_wait_timeout_ms = max(1000, int(options["chatWaitTimeoutMs"]))
            if "chatWaitPollMs" in options:
                self.chat_wait_poll_ms = max(200, int(options["chatWaitPollMs"]))
            return {
                "cursor": terminal.visual_cursor,
                "humanize": terminal.humanize,
                "pace": terminal.pace,
                "speedFactor": self.automation_speed_factor,
                "speedMultiplier": self.automation_speed_multiplier,
                "maxSteps": self.max_steps,
                "maxActionsPerStep": self.max_actions_per_step,
                "confirmDangerousClicks": self.require_confirm_dangerous_clicks,
                "confirmSendMessage": self.require_confirm_send_message,
                "bulkMaxChats": self.bulk_max_chats,
                "bulkDelayMsMin": self.bulk_delay_ms_range[0],
                "bulkDelayMsMax": self.bulk_delay_ms_range[1],
                "bulkStopOnCaptcha": self.bulk_stop_on_captcha,
                "bulkPersonalize": self.bulk_personalize,
                "chatWaitTimeoutMs": self.chat_wait_timeout_ms,
                "chatWaitPollMs": self.chat_wait_poll_ms,
            }

    def wait_for_chat_change(self, terminal: BrowserTerminal, previous_signature: str) -> bool:
        """Wait until chat context signature changes.

        Used for multi-round conversations so we don't keep responding without new user input.
        """

        deadline = time.time() + (self.chat_wait_timeout_ms / 1000.0)
        while time.time() < deadline:
            context = self.read_chat_context(terminal)
            current = chat_context_signature(context.get("recentText", ""))
            if current and current != previous_signature:
                return True
            terminal.current_page().wait_for_timeout(self.chat_wait_poll_ms)
        return False

    def observe(self) -> dict:
        with self.lock:
            terminal = self.get_terminal()
            context = terminal.collect_page_context(limit=90)
            context["fileInputs"] = self.collect_file_inputs(terminal)
            return context

    def automation_message_observe(self) -> dict:
        operation_timing = self.refresh_operation_timing_runtime(self.current_operation_timing or self.last_operation_timing)
        if self.current_operation_timing:
            return {
                "ok": True,
                "busy": True,
                "accountId": AGENT_ACCOUNT_ID,
                "accountName": AGENT_ACCOUNT_NAME,
                "operationTiming": operation_timing,
                "remaining": {"unreadBadgeCount": None, "actionableCount": None},
            }
        with self.lock:
            terminal = self.get_terminal()
            page = terminal.current_page()
            platform = "boss"
            if AGENT_ACCOUNT_ID.startswith("job51"):
                platform = "51job"
            elif AGENT_ACCOUNT_ID.startswith("zhilian"):
                platform = "zhilian"
            unread = read_unread_badge_state(terminal)
            unread_count = int(unread.get("count") or 0)
            remaining = {
                "unreadBadgeCount": unread_count,
                "actionableCount": unread_count,
                "source": "unread_badge",
            }
            extra: dict = {}
            if platform == "51job":
                try:
                    summary = self.job51_visible_thread_summary(terminal, exclude_labels=[], allowed_positions=())
                    actionable = int(summary.get("actionableCount") or 0)
                    remaining["actionableCount"] = actionable
                    remaining["source"] = "job51_visible_thread_summary"
                    extra["visibleThreadSummary"] = summary
                except Exception as error:
                    extra["visibleThreadSummaryError"] = safe_text(str(error), 180)
            return {
                "ok": True,
                "busy": False,
                "platform": platform,
                "accountId": AGENT_ACCOUNT_ID,
                "accountName": AGENT_ACCOUNT_NAME,
                "page": {
                    "title": safe_text(page.title() if page else "", 120),
                    "url": safe_text(str(getattr(page, "url", "")), 240),
                },
                "unread": unread,
                "remaining": remaining,
                "operationTiming": operation_timing,
                **extra,
            }

    def collect_file_inputs(self, terminal: BrowserTerminal) -> list[dict]:
        page = terminal.current_page()
        try:
            return page.locator("input[type=file]").evaluate_all(
                """els => els.map((el, index) => ({
                  index: index + 1,
                  id: el.id || "",
                  name: el.name || "",
                  accept: el.getAttribute("accept") || "",
                  multiple: !!el.multiple,
                  visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
                }))"""
            )
        except Exception:
            return []

    def save_uploaded_file(self, filename: str, content: bytes) -> dict:
        safe_name = sanitize_filename(filename)
        if not safe_name:
            raise AgentError("文件名为空，无法保存。")
        day_dir = UPLOAD_DIR / time.strftime("%Y-%m-%d")
        day_dir.mkdir(parents=True, exist_ok=True)
        target = unique_path(day_dir / safe_name)
        target.write_bytes(content)
        item = {
            "id": f"file_{int(time.time() * 1000)}",
            "name": safe_name,
            "path": str(target),
            "size": len(content),
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        self.files.append(item)
        save_json(FILE_REGISTRY, self.files[-200:])
        self.add_event("file", f"已保存文件：{safe_name}")
        return item

    def add_event(self, kind: str, text: str, extra: dict | None = None) -> None:
        created_at = time.strftime("%Y-%m-%d %H:%M:%S")
        item = {
            "accountId": AGENT_ACCOUNT_ID,
            "accountName": AGENT_ACCOUNT_NAME,
            "date": created_at[:10],
            "time": time.strftime("%H:%M:%S"),
            "createdAt": created_at,
            "kind": kind,
            "text": text,
            "extra": extra or {},
        }
        self.events.append(item)
        save_json(EVENT_LOG, self.events[-2000:])

    def save_chat_states(self) -> None:
        now = time.time()
        compact: dict[str, dict] = {}
        for key, item in self.chat_states.items():
            if not isinstance(item, dict):
                continue
            updated_at = float(item.get("updatedAtTs") or 0)
            if updated_at and now - updated_at > CHAT_STATE_TTL_SECONDS:
                continue
            compact[str(key)] = item
        self.chat_states = compact
        save_json(CHAT_STATE_FILE, compact)

    def get_chat_state(self, key: str) -> dict:
        if not key:
            return {}
        item = self.chat_states.get(key)
        return item if isinstance(item, dict) else {}

    def set_chat_state(self, key: str, status: str, **fields) -> dict:
        if not key:
            return {}
        item = dict(self.get_chat_state(key))
        item.update(fields)
        item["status"] = status
        stage = recruiter_stage_for_status(status)
        if stage:
            item["stage"] = stage
        item["agentNextAction"] = str(item.get("agentNextAction") or recruiter_next_action_for_status(status))
        if status == "proactive_greeted":
            item.setdefault("agentWorkflow", "proactive_contact")
        if item.get("agentWorkflow") or stage or item.get("agentNextAction"):
            item["agentState"] = {
                "workflow": item.get("agentWorkflow") or "",
                "stage": stage,
                "status": status,
                "nextAction": item.get("agentNextAction") or recruiter_next_action_for_status(status),
                "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            }
        item["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
        item["updatedAtTs"] = time.time()
        self.chat_states[key] = item
        self.save_chat_states()
        return item

    def find_proactive_contact_origin(
        self,
        candidate_name: str = "",
        applied_position: str = "",
        candidate_label: str = "",
        identity: dict | None = None,
    ) -> dict:
        identity = identity if isinstance(identity, dict) else {}
        candidate_name = safe_text(str(candidate_name or identity.get("candidateName") or ""), 60)
        applied_position = safe_text(str(applied_position or identity.get("appliedPosition") or ""), 120)
        label_compact = compact_conversation_label(candidate_label or str(identity.get("listLabel") or ""))
        best: dict = {}
        best_score = 0

        for state_key, state in self.chat_states.items():
            if not isinstance(state, dict):
                continue
            status = str(state.get("status") or "")
            if status != "proactive_greeted":
                continue
            source = str(state.get("source") or "")
            if source not in {"recommend", "51job_recommend", "zhilian_recommend", ""} and not str(state_key).startswith(
                ("proactive|", "job51_proactive|", "zhilian_proactive|")
            ):
                continue

            state_label = str(state.get("candidateLabel") or "")
            state_name = safe_text(
                str(state.get("candidateName") or recruiter_candidate_name_from_label(state_label)),
                60,
            )
            state_position = safe_text(str(state.get("appliedPosition") or state.get("targetPosition") or ""), 120)
            state_label_compact = compact_conversation_label(state_label)
            state_position_compact = re.sub(r"\s+", "", state_position)

            identity_match = bool(
                identity.get("identityKey")
                and str(identity.get("identityKey")) == str(state.get("candidateIdentityKey") or "")
            )
            name_match = bool(
                candidate_name
                and state_name
                and (
                    candidate_name == state_name
                    or (len(candidate_name) >= 2 and len(state_name) >= 2 and (candidate_name in state_name or state_name in candidate_name))
                )
            )
            position_match = False
            if applied_position and state_position:
                try:
                    position_match = recommend_position_matches(applied_position, state_position) or recommend_position_matches(
                        state_position, applied_position
                    )
                except Exception:
                    position_match = re.sub(r"\s+", "", applied_position) == state_position_compact
            if not position_match and state_position_compact and label_compact:
                position_match = state_position_compact in label_compact

            label_match = bool(
                label_compact
                and state_label_compact
                and len(label_compact) >= 12
                and len(state_label_compact) >= 12
                and (label_compact in state_label_compact or state_label_compact in label_compact)
            )

            if not (identity_match or label_match or (name_match and position_match)):
                continue

            score = 0
            if identity_match:
                score += 120
            if name_match:
                score += 80
            if position_match:
                score += 70
            if label_match:
                score += 40
            if score > best_score:
                best_score = score
                best = {
                    "matched": True,
                    "stateKey": str(state_key),
                    "score": score,
                    "candidateName": state_name,
                    "targetPosition": state_position,
                    "candidateLabel": safe_text(state_label, 180),
                    "greetedAt": state.get("updatedAt") or "",
                    "greetedAtTs": state.get("updatedAtTs") or 0,
                    "source": state.get("source") or "recommend",
                }

        return best

    def mark_proactive_contact_replied(self, origin: dict, status: str, payload: dict) -> None:
        state_key = str((origin or {}).get("stateKey") or "")
        if not state_key:
            return
        state = dict(self.get_chat_state(state_key))
        if not state or str(state.get("status") or "") != "proactive_greeted":
            return
        now_ts = time.time()
        state.update({
            "replyDetected": True,
            "replyStatus": status,
            "replyDetectedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "replyDetectedAtTs": now_ts,
            "replyCandidateName": payload.get("candidateName") or state.get("candidateName") or "",
            "replyAppliedPosition": payload.get("appliedPosition") or state.get("appliedPosition") or "",
            "replyCandidateIdentityKey": payload.get("candidateIdentityKey") or "",
            "replyCandidateLabel": payload.get("candidateLabel") or "",
        })
        self.chat_states[state_key] = state

    def set_recruiter_basic_state(
        self,
        conversation_key: str,
        candidate_label: str,
        status: str,
        context: dict | None = None,
        **fields,
    ) -> dict:
        candidate_label = safe_text(str(candidate_label or ""), 180)
        candidate_name = recruiter_candidate_name_from_label(candidate_label)
        identity = build_recruiter_candidate_identity(context or {}, candidate_label, conversation_key)
        payload = dict(fields)
        payload.setdefault("candidateLabel", candidate_label)
        if candidate_name:
            payload.setdefault("candidateName", candidate_name)
        payload.setdefault("candidateIdentity", identity)
        if identity.get("identityKey"):
            payload.setdefault("candidateIdentityKey", identity.get("identityKey"))
        if identity.get("appliedPosition"):
            payload.setdefault("appliedPosition", identity.get("appliedPosition"))
        if identity.get("lastMessageSignature"):
            payload.setdefault("lastMessageSignature", identity.get("lastMessageSignature"))
        messages = (context or {}).get("messages") if isinstance(context, dict) else []
        if isinstance(messages, list) and messages:
            payload.setdefault("recentMessages", [
                {
                    "sender": safe_text(str(message.get("sender") or ""), 20),
                    "time": safe_text(str(message.get("time") or ""), 40),
                    "status": safe_text(str(message.get("status") or ""), 40),
                    "text": safe_text(str(message.get("text") or ""), 500),
                    "rawText": safe_text(str(message.get("rawText") or message.get("text") or ""), 600),
                }
                for message in messages[-80:]
                if isinstance(message, dict) and str(message.get("text") or "").strip()
            ])
        last_other = (context or {}).get("lastOtherMessage") if isinstance(context, dict) else {}
        if isinstance(last_other, dict) and last_other.get("text"):
            payload.setdefault("lastOther", safe_text(str(last_other.get("text") or ""), 500))
        review = (context or {}).get("conversationReview") if isinstance(context, dict) else {}
        if isinstance(review, dict) and review:
            payload.setdefault("conversationReview", compact_candidate_conversation_review(review))
        workflow = recruiter_workflow_for_context(context, status, payload)
        next_action = recruiter_next_action_for_status(status)
        payload.setdefault("agentWorkflow", workflow)
        payload.setdefault("agentNextAction", next_action)
        payload.setdefault("agentState", {
            "workflow": workflow,
            "stage": recruiter_stage_for_status(status),
            "status": status,
            "nextAction": next_action,
            "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        if status != "proactive_greeted":
            proactive_origin = self.find_proactive_contact_origin(
                candidate_name=str(payload.get("candidateName") or identity.get("candidateName") or ""),
                applied_position=str(payload.get("appliedPosition") or identity.get("appliedPosition") or ""),
                candidate_label=candidate_label,
                identity=identity,
            )
            if proactive_origin.get("matched"):
                payload.setdefault("proactiveOrigin", True)
                payload.setdefault("proactiveSource", proactive_origin.get("source") or "recommend")
                payload.setdefault("proactiveStateKey", proactive_origin.get("stateKey") or "")
                payload.setdefault("proactiveGreetedAt", proactive_origin.get("greetedAt") or "")
                payload.setdefault("proactiveGreetedAtTs", proactive_origin.get("greetedAtTs") or 0)
                payload.setdefault("proactiveTargetPosition", proactive_origin.get("targetPosition") or "")
                self.mark_proactive_contact_replied(proactive_origin, status, payload)
        keys: list[str] = []
        if conversation_key:
            keys.append(str(conversation_key))
        candidate_key = recruiter_basic_candidate_state_key(candidate_label, identity=identity)
        if candidate_key and candidate_key not in keys:
            keys.append(candidate_key)
        if identity.get("identityKey"):
            identity_state_key = "recruiter_identity_" + str(identity.get("identityKey"))
            if identity_state_key not in keys:
                keys.append(identity_state_key)
        updated: dict = {}
        for key in keys:
            updated = self.set_chat_state(key, status, **payload)
        append_recruiter_decision_log({
            "conversationKey": conversation_key,
            "stateKeys": keys,
            "candidateLabel": candidate_label,
            "candidateName": payload.get("candidateName") or "",
            "appliedPosition": payload.get("appliedPosition") or "",
            "status": status,
            "stage": recruiter_stage_for_status(status),
            "workflow": workflow,
            "nextAction": next_action,
            "screening": payload.get("screening") if isinstance(payload.get("screening"), dict) else {},
            "conversationReview": payload.get("conversationReview") if isinstance(payload.get("conversationReview"), dict) else {},
            "knowledgeAnswer": payload.get("knowledgeAnswer") or "",
            "lastScreening": payload.get("lastScreening") or "",
            "lastOther": payload.get("lastOther") or "",
        })
        return updated

    def pending_recruiter_basic_candidates(self, limit: int = 8) -> list[dict]:
        pending_statuses = {"basic_conditions_opened_unsent", "basic_conditions_needs_resend"}
        items: list[dict] = []
        seen: set[str] = set()
        for key, state in self.chat_states.items():
            if not isinstance(state, dict) or state.get("status") not in pending_statuses:
                continue
            label = safe_text(str(state.get("candidateLabel") or ""), 180)
            name = safe_text(str(state.get("candidateName") or recruiter_candidate_name_from_label(label)), 40)
            identity_data = state.get("candidateIdentity") if isinstance(state.get("candidateIdentity"), dict) else {}
            unique_key = (
                str(state.get("candidateIdentityKey") or "")
                or str(identity_data.get("identityKey") or "")
                or compact_conversation_label(label)
                or str(key)
            )
            if not unique_key or unique_key in seen:
                continue
            seen.add(unique_key)
            items.append({
                "key": str(key),
                "status": str(state.get("status") or ""),
                "candidateLabel": label,
                "candidateName": name,
                "candidateIdentity": identity_data,
                "candidateIdentityKey": str(state.get("candidateIdentityKey") or ""),
                "appliedPosition": safe_text(str(state.get("appliedPosition") or ""), 80),
                "lastMessageSignature": safe_text(str(state.get("lastMessageSignature") or ""), 60),
                "updatedAtTs": float(state.get("updatedAtTs") or 0),
            })
        items.sort(key=lambda item: item.get("updatedAtTs") or 0)
        return items[: max(1, int(limit or 1))]

    @timed_agent_stage("verify_basic_conditions_sent", "检查基础话术发送结果")
    def verify_basic_conditions_sent_in_current_chat(self, terminal: BrowserTerminal, phrase: str) -> dict:
        try:
            terminal.current_page().wait_for_timeout(random.randint(700, 1150))
        except Exception:
            pass
        context = self.read_chat_context(terminal)
        screening = analyze_basic_condition_screening(context.get("messages", []), phrase)
        verified = screening.get("status") != "not_asked"
        return {
            "verified": bool(verified),
            "context": context,
            "screening": screening,
        }

    @timed_agent_stage("send_basic_conditions_with_verification", "发送基础话术并验证")
    def send_basic_conditions_with_verification(
        self,
        terminal: BrowserTerminal,
        phrase: str,
        max_attempts: int = CHAT_SEND_MAX_ATTEMPTS,
    ) -> tuple[dict, dict]:
        attempts: list[dict] = []
        send_result: dict = {}
        verification: dict = {}
        for attempt in range(1, max(1, int(max_attempts or CHAT_SEND_MAX_ATTEMPTS)) + 1):
            send_result = self.send_recruiter_common_phrase(
                terminal,
                phrase=phrase,
                phrase_key="basic_conditions",
                target_candidate="",
            )
            if send_result.get("blocked"):
                attempts.append({"attempt": attempt, "send": send_result, "verification": {}})
                continue
            verification = self.verify_basic_conditions_sent_in_current_chat(terminal, phrase)
            attempts.append({"attempt": attempt, "send": send_result, "verification": verification})
            if verification.get("verified"):
                send_result["attempt"] = attempt
                send_result["attempts"] = attempts
                send_result["verification"] = verification
                return send_result, verification
        send_result = dict(send_result or {})
        send_result["blocked"] = True
        send_result["attempts"] = attempts
        send_result["verification"] = verification
        send_result["message"] = "已尝试发送基础情况常用语，但聊天记录里没有确认出现该消息。"
        return send_result, verification

    def save_chat_memories(self) -> None:
        now = time.time()
        compact: dict[str, dict] = {}
        for key, item in self.chat_memories.items():
            if not isinstance(item, dict):
                continue
            updated_at = float(item.get("updatedAtTs") or 0)
            if updated_at and now - updated_at > CHAT_MEMORY_TTL_SECONDS:
                continue
            compact[str(key)] = item
        self.chat_memories = compact
        save_json(CHAT_MEMORY_FILE, compact)

    def get_chat_memory(self, key: str) -> dict:
        if not key:
            return {}
        item = self.chat_memories.get(key)
        return item if isinstance(item, dict) else {}

    def refresh_chat_memory(self, context: dict, key: str | None = None, opened_label: str | None = None) -> dict:
        conversation_key = str(key or context.get("conversationKey") or "")
        if not conversation_key:
            return {}
        previous = dict(self.get_chat_memory(conversation_key))
        memory = build_chat_memory(previous, context, opened_label=opened_label)
        memory["updatedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
        memory["updatedAtTs"] = time.time()
        self.chat_memories[conversation_key] = memory
        self.save_chat_memories()
        return compact_chat_memory(memory)

    def latest_file(self) -> dict | None:
        return self.files[-1] if self.files else None

