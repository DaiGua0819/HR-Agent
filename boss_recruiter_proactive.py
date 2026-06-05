from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any


def compact_text(value: Any, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if limit > 0 and len(text) > limit:
        return text[: max(0, limit - 3)] + "..."
    return text


def account_scoped_path(root: Path, filename: str, account_id: str) -> Path:
    path = Path(root) / filename
    if account_id in {"", "boss_a", "default"}:
        return path
    return path.with_name(f"{path.stem}.{account_id}{path.suffix}")


def append_jsonl(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")


def recommend_candidate_colleague_progress_check(resume_info: dict | None) -> dict:
    info = resume_info if isinstance(resume_info, dict) else {}
    progress_text = str(info.get("colleagueProgressText") or "")
    if not progress_text.strip():
        combined = "\n".join(
            str(info.get(key) or "")
            for key in ("summaryText", "text", "iframeText")
            if str(info.get(key) or "").strip()
        )
        marker = combined.find("同事沟通进度")
        progress_text = combined[marker: marker + 700] if marker >= 0 else ""
    compact = compact_text(progress_text, 700)
    if not compact:
        return {
            "hasCommunication": False,
            "reason": "colleague_progress_section_not_found",
            "text": "",
        }
    if re.search(r"(暂无|没有|无|空|未发现|未沟通).{0,16}(同事)?沟通", compact):
        return {
            "hasCommunication": False,
            "reason": "colleague_progress_empty",
            "text": compact_text(compact, 220),
        }
    has_entry = bool(re.search(
        r"(Ta向|TA向|ta向|向.{1,18}发起沟通|发起沟通|已沟通|沟通过|沟通中|交换电话|同事.{0,12}联系)",
        compact,
    ))
    return {
        "hasCommunication": has_entry,
        "reason": "colleague_already_contacted" if has_entry else "colleague_progress_empty",
        "text": compact_text(compact, 220),
    }


def new_candidate_action_log(
    *,
    account_id: str,
    account_name: str,
    target_position: str,
    candidate_name: str,
    candidate_key: str,
    state_key: str,
    dom_index: int,
    dry_run: bool,
    card_text: str,
) -> dict:
    now = time.time()
    return {
        "schema": "proactive_candidate_action.v1",
        "actionLogId": f"pal_{int(now * 1000)}_{abs(hash((account_id, target_position, candidate_key, dom_index))) % 1000000:06d}",
        "createdAtTs": now,
        "updatedAtTs": now,
        "accountId": account_id,
        "accountName": account_name,
        "targetPosition": compact_text(target_position, 120),
        "candidateName": compact_text(candidate_name, 60),
        "candidateKey": compact_text(candidate_key, 80),
        "stateKey": compact_text(state_key, 160),
        "domIndex": int(dom_index or 0),
        "dryRun": bool(dry_run),
        "cardPreview": compact_text(card_text, 240),
        "checkpoints": [],
        "decision": "",
        "reason": "",
        "risk": "",
    }


def add_checkpoint(log: dict | None, name: str, status: str, **details: Any) -> dict:
    if not isinstance(log, dict):
        return {}
    checkpoint = {
        "name": compact_text(name, 80),
        "status": compact_text(status, 40),
        "atTs": time.time(),
    }
    if details:
        checkpoint["details"] = details
    log.setdefault("checkpoints", []).append(checkpoint)
    log["updatedAtTs"] = checkpoint["atTs"]
    return checkpoint


def finish_action_log(log: dict | None, decision: str, reason: str = "", **details: Any) -> dict:
    if not isinstance(log, dict):
        return {}
    log["decision"] = compact_text(decision, 80)
    log["reason"] = compact_text(reason, 160)
    if details:
        log["details"] = details
    log["updatedAtTs"] = time.time()
    return log


def validate_before_greet(
    *,
    target_count: int,
    current_count: int,
    dry_run: bool,
    current_position: str,
    target_position: str,
    resume_info: dict,
    colleague_progress: dict,
    custom_rule_check: dict,
    custom_rules_enabled: bool,
    default_checks: dict,
    require_match: bool,
    match: dict,
    greet_button_count: int,
) -> dict:
    checks: list[dict] = []

    def add(name: str, passed: bool, reason: str = "", **extra: Any) -> None:
        item = {"name": name, "passed": bool(passed), "reason": compact_text(reason, 120)}
        if extra:
            item.update(extra)
        checks.append(item)

    add("target_count_not_reached", current_count < target_count, f"{current_count}/{target_count}")
    add("not_dry_run", not dry_run, "dry_run" if dry_run else "")
    current_position_text = compact_text(current_position, 160)
    target_position_text = compact_text(target_position, 80)
    position_ok = (
        not target_position_text
        or not current_position_text
        or target_position_text in current_position_text
        or current_position_text.startswith(target_position_text[: max(1, min(12, len(target_position_text)))])
    )
    add("position_confirmed", position_ok, current_position_text)
    add("resume_dialog_open", bool(resume_info.get("open")), "")
    add("resume_has_greet_button", bool(resume_info.get("hasGreetButton")), compact_text(resume_info.get("greetText"), 60))
    add("colleague_progress_empty", not bool(colleague_progress.get("hasCommunication")), colleague_progress.get("reason") or "")
    if custom_rules_enabled:
        add("custom_rules_allowed", bool(custom_rule_check.get("allowed")), custom_rule_check.get("reason") or "")
    else:
        for name, check in default_checks.items():
            if isinstance(check, dict) and check:
                add(f"{name}_allowed", bool(check.get("allowed", True)), check.get("reason") or "")
    if require_match:
        add("require_match_allowed", bool(match.get("matched")), match.get("reason") or "")
    add("greet_locator_found", greet_button_count > 0, str(greet_button_count))

    failed = [item for item in checks if not item.get("passed")]
    return {
        "allowed": not failed,
        "reason": failed[0]["reason"] or failed[0]["name"] if failed else "before_greet_checks_passed",
        "checks": checks,
    }


def summarize_post_greet_cleanup(cleanup: dict) -> dict:
    post_popup = cleanup.get("postGreetPopup") if isinstance(cleanup.get("postGreetPopup"), dict) else {}
    late_popup = cleanup.get("latePostGreetPopup") if isinstance(cleanup.get("latePostGreetPopup"), dict) else {}
    resume_close = cleanup.get("resumeDialogClose") if isinstance(cleanup.get("resumeDialogClose"), dict) else {}
    ack_retries = cleanup.get("ackRetries") if isinstance(cleanup.get("ackRetries"), list) else []
    popup_sources = [post_popup, late_popup]
    for retry in ack_retries:
        if not isinstance(retry, dict):
            continue
        retry_popup = retry.get("postGreetPopup") if isinstance(retry.get("postGreetPopup"), dict) else {}
        if retry_popup:
            popup_sources.append(retry_popup)
    ack_items = []
    for source in popup_sources:
        for item in source.get("items") or []:
            if isinstance(item, dict):
                text = compact_text(item.get("text"), 40)
                if text in {"知道了", "我知道了"}:
                    ack_items.append(item)
    return {
        "ackClicked": bool(ack_items),
        "postGreetPopupClosed": any(bool(source.get("closed")) for source in popup_sources),
        "resumeDialogClosed": bool(resume_close.get("closed")),
        "blockedByAck": bool(cleanup.get("blockedByAck")),
        "postGreetReason": post_popup.get("reason") or "",
        "latePostGreetReason": late_popup.get("reason") or "",
        "resumeCloseReason": resume_close.get("reason") or "",
    }


def validate_after_greet(*, cleanup: dict, summary_after: dict, target_count: int, result_count: int) -> dict:
    cleanup_summary = summarize_post_greet_cleanup(cleanup if isinstance(cleanup, dict) else {})
    checks = [
        {
            "name": "resume_dialog_closed",
            "passed": cleanup_summary["resumeDialogClosed"],
            "reason": cleanup_summary.get("resumeCloseReason") or "",
        },
        {
            "name": "post_greet_ack_not_blocking",
            "passed": not cleanup_summary["blockedByAck"],
            "reason": "post_greet_ack_still_visible" if cleanup_summary["blockedByAck"] else "",
        },
        {
            "name": "target_count_not_exceeded",
            "passed": result_count <= target_count,
            "reason": f"{result_count}/{target_count}",
        },
        {
            "name": "page_risk_absent",
            "passed": not bool(summary_after.get("risk")),
            "reason": compact_text(summary_after.get("risk"), 120),
        },
    ]
    failed = [item for item in checks if not item.get("passed")]
    return {
        "passed": not failed,
        "reason": failed[0]["reason"] or failed[0]["name"] if failed else "after_greet_checks_passed",
        "checks": checks,
        "cleanupSummary": cleanup_summary,
    }
