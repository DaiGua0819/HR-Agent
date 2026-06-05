import json
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
DATE = "2026-06-01"
REPORT = BASE / "reports" / f"{DATE}_knowledge_questions_clean.md"
ALL_REPORT = BASE / "reports" / f"{DATE}_all_questions_reply_status.md"

QUESTION_FILES = [
    ("BOSS_SongFengfeng", "recruiter_user_questions.json"),
    ("BOSS_HeXinhong", "recruiter_user_questions.boss_b.json"),
    ("BOSS_SongFengfeng", "recruiter_unclear_questions.json"),
    ("BOSS_HeXinhong", "recruiter_unclear_questions.boss_b.json"),
]

DECISION_FILES = [
    ("BOSS_SongFengfeng", "recruiter_decision_log.json"),
    ("BOSS_HeXinhong", "recruiter_decision_log.boss_b.json"),
    ("Zhilian_SongFengfeng", "recruiter_decision_log.zhilian_a.json"),
]

USER_SUPPLEMENTS = {
    "非本专业且退伍背景是否可以应聘人力资源管培生": "最好是本专业的，如果不是人力资源的能力较强的可以考虑。",
    "我的工作经验是否匹配该岗位要求": "忽略，不自动回复，不向候选人发送任何内容。",
    "岗位还有哪些要求？": "忽略，不自动回复，不向候选人发送任何内容。",
    "AI应用开发实习生还有哪些招聘要求": "忽略，不自动回复，不向候选人发送任何内容。",
    "发简历后能否判断是否可以参加面试": "忽略，不自动回复，不向候选人发送任何内容。",
    "毕业后入职是否仍按实习合同和实习薪资执行": "毕业后正式签订劳务合同，试用期六个月，实习时间可以算作试用期内，试用期结束后按照表现定工资并判断是否转正。",
    "HRBP岗位需要学习哪些业务知识": "主要是要服务于销售团队。",
}


def load_json(name):
    path = BASE / name
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def one_line(value):
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())


def item_time(row):
    return one_line(row.get("time") or row.get("capturedAt"))


def norm_question(row):
    judge = row.get("questionPoolJudge") or {}
    return one_line(row.get("normalizedQuestion") or judge.get("normalizedQuestion") or row.get("question"))


def reason_of(row):
    judge = row.get("questionPoolJudge") or {}
    return one_line(row.get("questionPoolReason") or judge.get("reason"))


def candidate_of(row):
    return one_line(row.get("candidateName") or row.get("candidateLabel") or row.get("candidate"))


def position_of(row):
    return one_line(row.get("appliedPosition"))


def prefer_question_row(old, new):
    def score(row):
        return (
            1 if one_line(row.get("answer")) else 0,
            len(one_line(row.get("question"))),
            item_time(row),
        )

    if old is None or score(new) > score(old):
        return new
    return old


def collect_question_pool():
    raw_questions = []
    for source, name in QUESTION_FILES:
        for row in load_json(name):
            if item_time(row).startswith(DATE):
                row = dict(row)
                row["_source"] = source
                row["_file"] = name
                raw_questions.append(row)

    question_by_key = {}
    for row in raw_questions:
        key = (row["_source"], candidate_of(row), position_of(row), norm_question(row))
        question_by_key[key] = prefer_question_row(question_by_key.get(key), row)

    return sorted(
        question_by_key.values(),
        key=lambda row: (item_time(row), row.get("_source", ""), candidate_of(row), norm_question(row)),
    )


def collect_pending_review():
    pending = []
    for source, name in DECISION_FILES:
        for decision in load_json(name):
            if not item_time(decision).startswith(DATE):
                continue
            review = decision.get("conversationReview") or {}
            for question in review.get("unansweredQuestions") or []:
                pending.append((source, decision, question))

    pending_by_key = {}
    for source, decision, question in pending:
        text = one_line(question.get("text") or question.get("question"))
        candidate = one_line(decision.get("candidateName") or decision.get("candidateLabel"))
        position = one_line(decision.get("appliedPosition"))
        key = (source, candidate, position, text)
        old = pending_by_key.get(key)
        if old is None or item_time(decision) > item_time(old[1]):
            pending_by_key[key] = (source, decision, question)

    return sorted(
        pending_by_key.values(),
        key=lambda item: (item_time(item[1]), item[0], one_line(item[2].get("text") or item[2].get("question"))),
    )


def add_question_item(lines, index, row, include_answer):
    lines.append(
        f"{index}. [{row.get('_source', '')}] {item_time(row)} | "
        f"{candidate_of(row) or '未知候选人'} | {position_of(row) or '-'}"
    )
    lines.append(f"   - 问题：{one_line(row.get('question'))}")
    if include_answer:
        lines.append(f"   - 系统回复：{one_line(row.get('answer'))}")
    else:
        lines.append("   - 系统回复：（未生成明确回复）")
    normalized = norm_question(row)
    if normalized and normalized != one_line(row.get("question")):
        lines.append(f"   - 归一问题：{normalized}")
    reason = reason_of(row)
    if reason:
        lines.append(f"   - 记录原因：{reason}")
    supplement = USER_SUPPLEMENTS.get(norm_question(row))
    if supplement:
        lines.append(f"   - 用户补充口径/处理策略：{supplement}")
    lines.append("")


def add_pending_item(lines, index, source, decision, question):
    candidate = one_line(decision.get("candidateName") or decision.get("candidateLabel")) or "未知候选人"
    position = one_line(decision.get("appliedPosition")) or "-"
    text = one_line(question.get("text") or question.get("question"))
    reason = one_line(question.get("reason"))
    lines.append(f"{index}. [{source}] {item_time(decision)} | {candidate} | {position}")
    lines.append(f"   - 待处理问题：{text}")
    if reason:
        lines.append(f"   - 审核原因：{reason}")
    lines.append("")


def build_report():
    question_pool = collect_question_pool()
    answered_pool = [row for row in question_pool if one_line(row.get("answer"))]
    unanswered_pool = [row for row in question_pool if not one_line(row.get("answer"))]
    pending_unique = collect_pending_review()
    review_pool = [
        row
        for row in answered_pool
        if (row.get("questionCategory") or (row.get("questionPoolJudge") or {}).get("category")) == "rule_fallback"
    ]

    lines = [
        f"# {DATE} 招聘自动化问题统计（干净版）",
        "",
        "## 统计口径",
        f"- 问题池去重后：{len(question_pool)} 条；其中已生成回复 {len(answered_pool)} 条，未生成明确回复 {len(unanswered_pool)} 条。",
        f"- 对话审核仍标记待处理：{len(pending_unique)} 条。这个口径会包含部分“知识库有答案，但当轮对话仍未确认已回复/已发送”的问题。",
        f"- 已生成回复但建议复核：{len(review_pool)} 条。",
        "- 注意：这里的“系统回复”指日志里生成的 answer 字段，不等同于平台一定发送成功。发送成功需要结合自动化执行日志或页面状态再核验。",
        "",
        "## 用户本次补充口径 / 处理策略",
    ]

    for question, answer in USER_SUPPLEMENTS.items():
        lines.append(f"- {question}：{answer}")

    lines.extend(
        [
            "",
            "## 一、问题池：未回复 / 知识库缺口",
        ]
    )

    for index, row in enumerate(unanswered_pool, 1):
        add_question_item(lines, index, row, include_answer=False)

    lines.append("## 二、问题池：已生成回复")
    for index, row in enumerate(answered_pool, 1):
        add_question_item(lines, index, row, include_answer=True)

    lines.append("## 三、对话审核仍标记待处理的问题")
    for index, (source, decision, question) in enumerate(pending_unique, 1):
        add_pending_item(lines, index, source, decision, question)

    lines.append("## 四、已回复但建议复核")
    for index, row in enumerate(review_pool, 1):
        lines.append(
            f"{index}. [{row.get('_source', '')}] {item_time(row)} | "
            f"{candidate_of(row) or '未知候选人'} | {position_of(row) or '-'}"
        )
        lines.append(f"   - 问题：{one_line(row.get('question'))}")
        lines.append(f"   - 系统回复：{one_line(row.get('answer'))}")
        lines.append("   - 风险：rule_fallback 命中，建议人工确认话术是否准确。")
        lines.append("")

    lines.extend(
        [
            "## 五、建议补充知识库主题",
            "- 岗位是否还在招聘：按平台、账号、岗位给出可直接回复的话术，避免候选人问“还招吗”时停住。",
            "- 简历相关：候选人问能否发简历、是否合适、能否面试、有什么顾虑时，明确筛选前/筛选后/需转人工三种话术。",
            "- 人力资源管培生/HRBP：补充非本专业和退伍背景是否可投、BP业务知识、一线学习多久和学什么、是否销售岗、食宿、单休出差说明。",
            "- AI应用开发实习生/工程师：补充岗位其他要求、工作时间、具体面试时间口径、毕业后合同和薪资衔接、项目方向与实习生参与工作。",
            "- 电气工程师、外贸销售、应用技术经理：补充岗位细节要求、必问筛选条件、简历匹配判断边界。",
            "- 智联平台：补充投递开场、查看简历、职位错配（如电气候选人问HRBP）时的分流话术。",
            "",
        ]
    )

    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    build_all_questions_report(question_pool, pending_unique, review_pool)
    return question_pool, answered_pool, unanswered_pool, pending_unique, review_pool


def table_cell(value):
    return one_line(value).replace("|", "/")


def build_all_questions_report(question_pool, pending_unique, review_pool):
    lines = [
        f"# {DATE} 全量问题、回复和未回复清单",
        "",
        "## 口径说明",
        "- “问题池全量”是系统识别出的候选人明确问题，已按候选人、岗位、归一问题去重。",
        "- “系统回复”来自日志 answer 字段；不代表平台一定发送成功。",
        "- “对话审核待处理”是复查对话时仍认为没有完整处理的问题，包含部分与问题池重复的项。",
        "",
        "## 问题池全量",
        "| # | 来源 | 时间 | 候选人 | 岗位 | 问题 | 系统回复 | 状态 | 用户补充口径/处理策略 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    for index, row in enumerate(question_pool, 1):
        answer = one_line(row.get("answer"))
        status = "已生成回复" if answer else "未生成回复"
        supplement = USER_SUPPLEMENTS.get(norm_question(row), "")
        lines.append(
            "| "
            + " | ".join(
                [
                    str(index),
                    table_cell(row.get("_source")),
                    table_cell(item_time(row)),
                    table_cell(candidate_of(row)),
                    table_cell(position_of(row)),
                    table_cell(row.get("question")),
                    table_cell(answer or "（空）"),
                    status,
                    table_cell(supplement),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## 对话审核待处理",
            "| # | 来源 | 时间 | 候选人 | 岗位 | 待处理问题 | 审核原因 |",
            "|---|---|---|---|---|---|---|",
        ]
    )

    for index, (source, decision, question) in enumerate(pending_unique, 1):
        candidate = one_line(decision.get("candidateName") or decision.get("candidateLabel")) or "未知候选人"
        lines.append(
            "| "
            + " | ".join(
                [
                    str(index),
                    table_cell(source),
                    table_cell(item_time(decision)),
                    table_cell(candidate),
                    table_cell(decision.get("appliedPosition")),
                    table_cell(question.get("text") or question.get("question")),
                    table_cell(question.get("reason")),
                ]
            )
            + " |"
        )

    lines.extend(
        [
            "",
            "## 已回复但建议复核",
            "| # | 来源 | 时间 | 候选人 | 岗位 | 问题 | 系统回复 |",
            "|---|---|---|---|---|---|---|",
        ]
    )

    for index, row in enumerate(review_pool, 1):
        lines.append(
            "| "
            + " | ".join(
                [
                    str(index),
                    table_cell(row.get("_source")),
                    table_cell(item_time(row)),
                    table_cell(candidate_of(row)),
                    table_cell(position_of(row)),
                    table_cell(row.get("question")),
                    table_cell(row.get("answer")),
                ]
            )
            + " |"
        )

    ALL_REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    question_pool, answered_pool, unanswered_pool, pending_unique, review_pool = build_report()
    print(REPORT)
    print(ALL_REPORT)
    print(
        f"question_pool={len(question_pool)} answered={len(answered_pool)} "
        f"unanswered={len(unanswered_pool)} pending_review={len(pending_unique)} "
        f"review_needed={len(review_pool)}"
    )
