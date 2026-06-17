import json
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def find_font(size: int, bold: bool = False):
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def wrap_text(text: str, width: int):
    result = []
    for paragraph in str(text or "").splitlines() or [""]:
        paragraph = paragraph.strip()
        if not paragraph:
            result.append("")
            continue
        line = ""
        for char in paragraph:
            line += char
            if len(line.encode("gb18030", errors="ignore")) >= width * 2:
                result.append(line)
                line = ""
        if line:
            result.append(line)
    return result


def draw_wrapped(draw, xy, text, font, fill, max_chars, line_gap=10):
    x, y = xy
    for line in wrap_text(text, max_chars):
        draw.text((x, y), line, font=font, fill=fill)
        y += font.size + line_gap
    return y


def draw_section(draw, x, y, width, title, items, title_fill, bg_fill):
    title_font = find_font(28, True)
    body_font = find_font(24)
    radius = 12
    y0 = y
    draw.rounded_rectangle((x, y, x + width, y + 64), radius=radius, fill=bg_fill)
    draw.text((x + 24, y + 17), title, font=title_font, fill=title_fill)
    y += 88
    for item in items[:8]:
        text = str(item or "").strip()
        if not text:
            continue
        draw.text((x + 24, y), "•", font=body_font, fill=(30, 41, 59))
        y = draw_wrapped(draw, (x + 58, y), text, body_font, (30, 41, 59), max(24, int((width - 90) / 24)), 8)
        y += 10
    if y == y0 + 88:
        y = draw_wrapped(draw, (x + 24, y), "暂无明确内容", body_font, (100, 116, 139), max(24, int((width - 50) / 24)), 8)
    y += 24
    return y


def render_summary(payload: dict, output_path: Path):
    width = 1600
    margin = 56
    title_font = find_font(38, True)
    subtitle_font = find_font(26)
    body_font = find_font(24)
    small_font = find_font(20)

    name = payload.get("candidateName") or "候选人"
    role = payload.get("targetRole") or "面试"
    recommendation = payload.get("overallRecommendation") or "待复核"
    summary = payload.get("summary") or ""
    strengths = payload.get("strengths") or []
    risks = payload.get("risks") or []
    next_action = payload.get("nextAction") or ""
    qa = payload.get("qaEvidence") or []

    height = 1800
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    y = 48
    draw.text((margin, y), f"{name}{role}面试总结", font=title_font, fill=(15, 23, 42))
    y += 64
    draw.text((margin, y), f"结论：{recommendation}", font=subtitle_font, fill=(37, 99, 235))
    y += 58

    draw.rounded_rectangle((margin, y, width - margin, y + 180), radius=16, fill=(248, 250, 252))
    draw.text((margin + 24, y + 22), "面试评价", font=subtitle_font, fill=(15, 23, 42))
    draw_wrapped(draw, (margin + 24, y + 70), summary, body_font, (30, 41, 59), 58, 8)
    y += 220

    col_gap = 28
    col_width = (width - margin * 2 - col_gap) // 2
    y_left = draw_section(draw, margin, y, col_width, "优势", strengths, (22, 101, 52), (240, 253, 244))
    y_right = draw_section(draw, margin + col_width + col_gap, y, col_width, "风险与不足", risks, (190, 18, 60), (255, 241, 242))
    y = max(y_left, y_right) + 18

    if next_action:
        draw.rounded_rectangle((margin, y, width - margin, y + 118), radius=16, fill=(239, 246, 255))
        draw.text((margin + 24, y + 20), "下一步动作", font=subtitle_font, fill=(30, 64, 175))
        draw_wrapped(draw, (margin + 24, y + 64), next_action, body_font, (30, 41, 59), 60, 8)
        y += 150

    if qa:
        draw.text((margin, y), "问题与回答证据", font=subtitle_font, fill=(15, 23, 42))
        y += 54
        for index, item in enumerate(qa[:6], 1):
            block_top = y
            draw.rounded_rectangle((margin, y, width - margin, y + 46), radius=10, fill=(250, 245, 255))
            ability = item.get("ability") or "能力项"
            signal = item.get("signal") or ""
            draw.text((margin + 18, y + 10), f"{index}. {ability}  {signal}", font=body_font, fill=(88, 28, 135))
            y += 64
            y = draw_wrapped(draw, (margin + 18, y), f"问题：{item.get('question') or ''}", small_font, (30, 41, 59), 92, 7)
            y = draw_wrapped(draw, (margin + 18, y + 6), f"回答摘要：{item.get('answerSummary') or ''}", small_font, (51, 65, 85), 92, 7)
            y += 20
            if y - block_top > 260:
                break

    footer = f"内容由 AI 生成 · {payload.get('generatedAt') or ''}"
    draw.text((width - margin - 420, height - 54), footer[:60], font=small_font, fill=(148, 163, 184))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(str(output_path), "PNG", optimize=True)
    return {"ok": True, "path": str(output_path), "width": width, "height": height, "size": output_path.stat().st_size}


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: render_interview_summary_image.py <payload.json> <output.png>"}, ensure_ascii=False))
        return 2
    try:
        payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
        result = render_summary(payload, Path(sys.argv[2]))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
