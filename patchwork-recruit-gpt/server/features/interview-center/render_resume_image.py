import json
import sys
from pathlib import Path

import fitz
from PIL import Image


def render_pdf_long_image(pdf_path: Path, output_path: Path, max_width: int = 1200, zoom: float = 1.8) -> dict:
    doc = fitz.open(str(pdf_path))
    if doc.page_count <= 0:
        raise RuntimeError("PDF has no pages")

    pages = []
    for page in doc:
        matrix = fitz.Matrix(zoom, zoom)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
        if max_width and image.width > max_width:
            ratio = max_width / float(image.width)
            image = image.resize((max_width, max(1, int(image.height * ratio))), Image.Resampling.LANCZOS)
        pages.append(image)

    gap = 14 if len(pages) > 1 else 0
    width = max(page.width for page in pages)
    height = sum(page.height for page in pages) + gap * max(0, len(pages) - 1)
    canvas = Image.new("RGB", (width, height), "white")
    y = 0
    for page in pages:
        x = (width - page.width) // 2
        canvas.paste(page, (x, y))
        y += page.height + gap

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(str(output_path), "PNG", optimize=True)
    return {
        "ok": True,
        "path": str(output_path),
        "pages": len(pages),
        "width": canvas.width,
        "height": canvas.height,
        "size": output_path.stat().st_size,
    }


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "usage: render_resume_image.py <pdf> <output> [max_width]"}, ensure_ascii=False))
        return 2
    pdf_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    max_width = int(sys.argv[3]) if len(sys.argv) >= 4 and sys.argv[3] else 1200
    try:
        result = render_pdf_long_image(pdf_path, output_path, max_width=max_width)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
