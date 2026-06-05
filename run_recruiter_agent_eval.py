from __future__ import annotations

import json
from pathlib import Path

import agent_web_server as agent


ROOT = Path(__file__).resolve().parent
EVAL_FILE = ROOT / "recruiter_agent_eval.json"


def build_messages(case: dict) -> list[dict]:
    messages: list[dict] = []
    if case.get("basicSent", True):
        messages.append({"sender": "me", "text": agent.BASIC_CONDITIONS_PHRASE})
    candidate_messages = case.get("candidateMessages")
    if isinstance(candidate_messages, list) and candidate_messages:
        for item in candidate_messages:
            messages.append({"sender": "other", "text": str(item or "")})
    else:
        messages.append({"sender": "other", "text": str(case.get("candidateMessage") or "")})
    return messages


def infer_expected_action(screening: dict, knowledge_hit: dict, has_followup_question: bool) -> str:
    status = str(screening.get("status") or "")
    if status == "not_asked":
        return "send_basic_conditions"
    if status == "accept" and has_followup_question and knowledge_hit.get("answer"):
        return "answer_knowledge_then_request_resume"
    if status == "accept":
        return "request_resume"
    if status == "reject":
        return "skip_reject"
    if status == "unclear" and knowledge_hit.get("answer"):
        return "answer_knowledge"
    return "skip_wait"


def run_case(case: dict, kb: dict) -> dict:
    messages = build_messages(case)
    screening = agent.analyze_basic_condition_screening(messages, agent.BASIC_CONDITIONS_PHRASE)
    last_other = messages[-1]
    context = {
        "companyKnowledgeBase": kb,
        "lastMessage": last_other,
        "lastOtherMessage": last_other,
        "messages": messages,
    }
    knowledge_hit = agent.match_company_knowledge_answer(context)
    has_followup_question = agent.screening_has_followup_question(screening)
    action = infer_expected_action(screening, knowledge_hit, has_followup_question)
    return {
        "name": case.get("name"),
        "screeningStatus": screening.get("status"),
        "action": action,
        "hasFollowupQuestion": has_followup_question,
        "knowledgeAnswer": knowledge_hit.get("answer") or "",
    }


def assert_case(case: dict, actual: dict) -> list[str]:
    expected = case.get("expected") if isinstance(case.get("expected"), dict) else {}
    errors: list[str] = []
    for key in ("screeningStatus", "action"):
        if expected.get(key) and expected.get(key) != actual.get(key):
            errors.append(f"{key}: expected {expected.get(key)!r}, got {actual.get(key)!r}")
    if "hasFollowupQuestion" in expected and bool(expected["hasFollowupQuestion"]) != bool(actual.get("hasFollowupQuestion")):
        errors.append(f"hasFollowupQuestion: expected {expected['hasFollowupQuestion']!r}, got {actual.get('hasFollowupQuestion')!r}")
    for text in expected.get("answerContains", []) if isinstance(expected.get("answerContains"), list) else []:
        if str(text) not in str(actual.get("knowledgeAnswer") or ""):
            errors.append(f"knowledgeAnswer missing {text!r}: {actual.get('knowledgeAnswer')!r}")
    return errors


def main() -> int:
    cases = json.loads(EVAL_FILE.read_text(encoding="utf-8-sig"))
    rules = agent.load_boss_chat_rules()
    kb = agent.select_company_knowledge_base(rules, "AI应用开发实习生")
    failures = []
    for case in cases:
        actual = run_case(case, kb)
        errors = assert_case(case, actual)
        if errors:
            failures.append((case.get("name"), errors, actual))
            print(f"FAIL {case.get('name')}: {'; '.join(errors)}")
            print(json.dumps(actual, ensure_ascii=False, indent=2))
        else:
            print(f"PASS {case.get('name')}: {actual['action']}")
    if failures:
        print(f"\n{len(failures)} failed / {len(cases)} total")
        return 1
    print(f"\nAll {len(cases)} recruiter agent eval cases passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
