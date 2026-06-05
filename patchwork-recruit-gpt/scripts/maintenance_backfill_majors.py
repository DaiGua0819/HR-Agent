import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "resumes.sqlite"
CONFIG_PATHS = [ROOT / "agent_model_config.json", ROOT.parent / "agent_model_config.json"]


REJECT_PATTERNS = [
    r"\u4e13\u4e1a\u6280\u80fd",
    r"\u4e13\u4e1a\u80fd\u529b",
    r"\u4e13\u4e1a\u77e5\u8bc6",
    r"\u6280\u80fd",
    r"\u80fd\u529b",
    r"\u8bfe\u7a0b",
    r"\u9879\u76ee",
    r"\u5b9e\u4e60",
    r"\u5de5\u4f5c",
    r"\u804c\u8d23",
    r"GPA",
    r"\u7ee9\u70b9",
    r"\u6392\u540d",
    r"\u57fa\u7840",
    r"\u529f\u5e95",
    r"\u4f18\u52bf",
]


def read_config():
    for path in CONFIG_PATHS:
        if not path.exists():
            continue
        try:
            return json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
    return {}


def parse_payload(raw):
    try:
        return json.loads(raw or "{}")
    except Exception:
        return {}


def nested(data, *keys):
    value = data
    for key in keys:
        if not isinstance(value, dict):
            return ""
        value = value.get(key)
    return value or ""


def existing_major(payload):
    return str(
        payload.get("major")
        or nested(payload, "details", "major")
        or nested(payload, "education", "major")
        or payload.get("specialty")
        or payload.get("profession")
        or ""
    ).strip()


def extract_text(pdf_path):
    reader = PdfReader(pdf_path)
    return "\n".join(page.extract_text() or "" for page in reader.pages).strip()


def normalize_confidence(value):
    try:
        number = float(value)
    except Exception:
        return 0.0
    if number > 1:
        number = number / 100
    return max(0.0, min(1.0, number))


def clean_major(value):
    major = re.sub(r"\s+", " ", str(value or "")).strip(" \t\r\n:;,\u3002\uff1a\uff1b\uff0c|/")
    major = re.sub(r"^(major|field of study|academic major)\s*[:：]\s*", "", major, flags=re.I)
    major = re.sub(r"[\uff08(]?(?:\u672c\u79d1|\u7855\u58eb|\u7814\u7a76\u751f|\u5927\u4e13|\u535a\u58eb|\u5b66\u58eb)[\uff09)]?$", "", major).strip()
    if len(major) < 2 or len(major) > 32:
        return ""
    if re.fullmatch(r"[0-9.\-]+", major):
        return ""
    if any(re.search(pattern, major, re.I) for pattern in REJECT_PATTERNS):
        return ""
    return major


def call_model(config, payload, text):
    base_url = str(os.getenv("OPENAI_BASE_URL") or config.get("baseUrl") or "").rstrip("/")
    api_key = str(os.getenv("OPENAI_API_KEY") or config.get("apiKey") or "")
    model = str(os.getenv("OPENAI_MODEL") or config.get("model") or "gpt-5.5")
    if not base_url or not api_key:
        raise RuntimeError("missing OpenAI-compatible baseUrl/apiKey")

    known = {
        "name": payload.get("name") or "",
        "school": payload.get("school") or "",
        "jobType": payload.get("jobType") or "",
        "fileName": payload.get("fileName") or "",
    }
    messages = [
        {
            "role": "system",
            "content": (
                "You are a strict resume parser. Extract only the academic major / field of study "
                "from the education section. Do not use skill section headings such as professional skills, "
                "professional ability, professional knowledge, project titles, ranking, GPA, or course names. "
                "If the academic major is not explicitly present, return an empty string. Return JSON only."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "known": known,
                    "resumeText": text[:18000],
                    "schema": {"major": "", "confidence": 0, "evidence": ""},
                },
                ensure_ascii=False,
            ),
        },
    ]
    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "temperature": 0,
            "response_format": {"type": "json_object"},
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.loads(response.read().decode("utf-8"))
    content = data["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except Exception:
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            raise
        return json.loads(match.group(0))


def list_missing(conn, limit):
    rows = conn.execute("SELECT id, payload, updated_at FROM resumes ORDER BY updated_at DESC").fetchall()
    missing = []
    for row_id, raw_payload, updated_at in rows:
        payload = parse_payload(raw_payload)
        if existing_major(payload):
            continue
        missing.append((row_id, payload, updated_at))
        if limit and len(missing) >= limit:
            break
    return missing


def update_major(conn, row_id, payload, updated_at, major):
    payload["major"] = major
    conn.execute(
        "UPDATE resumes SET payload = ?, updated_at = ? WHERE id = ?",
        (json.dumps(payload, ensure_ascii=False), updated_at, row_id),
    )
    conn.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--min-confidence", type=float, default=0.45)
    args = parser.parse_args()

    config = read_config()
    conn = sqlite3.connect(DB_PATH, timeout=30)
    missing = list_missing(conn, args.limit)
    results = []

    for row_id, payload, updated_at in missing:
        pdf_path = payload.get("pdfPath") or payload.get("sourceFilePath") or ""
        name = payload.get("name") or ""
        result = {"id": row_id, "name": name, "major": "", "status": "skipped", "reason": "", "textLen": 0}
        start = time.time()
        try:
            if not pdf_path or not Path(pdf_path).exists():
                result["reason"] = "missing_pdf"
            else:
                text = extract_text(pdf_path)
                result["textLen"] = len(text)
                if len(text) < 120:
                    result["reason"] = "no_text"
                else:
                    parsed = call_model(config, payload, text)
                    major = clean_major(parsed.get("major"))
                    confidence = normalize_confidence(parsed.get("confidence"))
                    result.update(
                        {
                            "major": major,
                            "confidence": confidence,
                            "evidence": str(parsed.get("evidence") or "")[:220],
                        }
                    )
                    if not major:
                        result["reason"] = "empty_or_rejected_major"
                    elif confidence < args.min_confidence:
                        result["reason"] = "low_confidence"
                    else:
                        result["status"] = "updated" if not args.dry_run else "dry_run"
                        if not args.dry_run:
                            update_major(conn, row_id, payload, updated_at, major)
        except (urllib.error.URLError, urllib.error.HTTPError) as error:
            result["reason"] = f"model_error:{error}"
        except Exception as error:
            result["reason"] = f"error:{error}"
        result["elapsedSec"] = round(time.time() - start, 1)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        results.append(result)

    summary = {
        "processed": len(results),
        "updated": sum(1 for item in results if item["status"] == "updated"),
        "dryRun": sum(1 for item in results if item["status"] == "dry_run"),
        "skipped": sum(1 for item in results if item["status"] == "skipped"),
    }
    print(json.dumps({"summary": summary}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
