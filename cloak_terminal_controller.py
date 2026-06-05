"""
Terminal controller for an already-running CloakBrowser/Chrome CDP session.

Run:
  & "C:\\Users\\24471\\Documents\\New project\\招聘智能体\\.cloakbrowser-venv\\Scripts\\python.exe" cloak_terminal_controller.py

LLM setup:
  Set DASHSCOPE_API_KEY in your environment, or create browser_agent.env next to this script:
  DASHSCOPE_API_KEY=your_key_here

Typical commands:
  pages
  use 0
  observe
  click 3
  click 登录
  fill 账号 = my_user
  press Enter
  goto https://example.com
  ask 帮我找到登录入口
  quit
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse
from typing import Callable

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Locator, Page, sync_playwright
from urllib.request import Request, urlopen


DEFAULT_CDP = "http://127.0.0.1:9222"
VERSION = "2026-05-19-smart-agent-v7"
DEFAULT_CLOAK_BINARY = Path.home() / ".cloakbrowser" / "chromium-146.0.7680.177.4" / "chrome.exe"
DEFAULT_PROFILE_DIR = Path(__file__).with_name("cdp-browser-profile")
ROLE_FILE = Path(__file__).with_name("browser_agent_roles.json")
MEMORY_FILE = Path(__file__).with_name("browser_agent_memory.json")
DEFAULT_LLM_BASE_URL = os.environ.get("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
DEFAULT_LLM_MODEL = os.environ.get("QWEN_TEXT_MODEL", "qwen-plus")
ENV_FILE_CANDIDATES = [
    Path(__file__).with_name("browser_agent.env"),
    Path(__file__).with_name(".env"),
    Path(r"C:\Users\24471\Documents\New project\招聘智能体\.env"),
]
DANGEROUS_WORDS = (
    "提交",
    "删除",
    "发布",
    "付款",
    "支付",
    "发送",
    "确认",
    "下单",
    "退出登录",
    "注销",
    "submit",
    "delete",
    "publish",
    "pay",
    "send",
    "confirm",
)


def cdp_port_from_url(cdp: str) -> int:
    try:
        parsed = urlparse(cdp)
        if parsed.port:
            return int(parsed.port)
    except Exception:
        pass
    return 9222


def default_profile_dir_for_cdp(cdp: str) -> Path:
    port = cdp_port_from_url(cdp)
    for key in (f"CDP_PROFILE_DIR_{port}", f"CLOAK_PROFILE_DIR_{port}"):
        value = os.environ.get(key, "").strip()
        if value:
            return Path(value)

    generic_profile = os.environ.get("CLOAK_PROFILE_DIR") or os.environ.get("AGENT_PROFILE_DIR") or ""
    agent_cdp = os.environ.get("CLOAK_CDP") or os.environ.get("AGENT_CDP") or DEFAULT_CDP
    if generic_profile and cdp_port_from_url(agent_cdp) == port:
        return Path(generic_profile)

    if port == 9222:
        return DEFAULT_PROFILE_DIR
    return Path(__file__).with_name(f"cdp-browser-profile-{port}")

PACE_PRESETS = {
    "fast": {
        "pre_action": (40, 90),
        "hover": (45, 90),
        "post_action": (60, 130),
        "move_duration_factor": 0.75,
        "scroll_wiggle_chance": 0.12,
        "micro_move_chance": 0.12,
        "type_delay_ms": (10, 22),
        "typo_chance": 0.03,
    },
    "normal": {
        "pre_action": (90, 210),
        "hover": (90, 210),
        "post_action": (130, 310),
        "move_duration_factor": 1.0,
        "scroll_wiggle_chance": 0.24,
        "micro_move_chance": 0.18,
        "type_delay_ms": (16, 34),
        "typo_chance": 0.05,
    },
    "slow": {
        "pre_action": (180, 450),
        "hover": (180, 450),
        "post_action": (300, 650),
        "move_duration_factor": 1.35,
        "scroll_wiggle_chance": 0.38,
        "micro_move_chance": 0.22,
        "type_delay_ms": (24, 48),
        "typo_chance": 0.06,
    },
}

DEFAULT_ROLE_PROMPT = """
你是一个谨慎的浏览器操作助手，帮助用户理解页面并生成下一步动作。
你的目标是完成用户指定任务，但必须优先保证安全、可解释、可回退。
默认不要执行提交、删除、发布、付款、发送消息、邀请面试、拨打电话等会产生外部影响的动作。
如果任务不清楚，先返回 observe 或 done，并说明需要用户补充信息。
优先选择页面上已有的元素编号作为 target。
""".strip()


@dataclass
class CachedElement:
    index: int
    kind: str
    label: str
    locator: Locator


class BrowserTerminal:
    def __init__(
        self,
        cdp: str,
        page_index: int = 0,
        auto_start: bool = True,
        browser_path: str | None = None,
        visual_cursor: bool = True,
        humanize: bool = True,
        pace: str = "normal",
        confirm_dangerous_clicks: bool = False,
    ):
        self.cdp = cdp
        self.page_index = page_index
        self.auto_start = auto_start
        self.browser_path = Path(browser_path) if browser_path else DEFAULT_CLOAK_BINARY
        self.visual_cursor = visual_cursor
        self.humanize = humanize
        self.pace = pace if pace in PACE_PRESETS else "normal"
        self.confirm_dangerous_clicks = confirm_dangerous_clicks
        self.started_process: subprocess.Popen | None = None
        self.playwright = None
        self.browser = None
        self.page: Page | None = None
        self.cache: list[CachedElement] = []
        self.roles = load_roles()
        self.active_role = self.roles.get("default", DEFAULT_ROLE_PROMPT)
        self.memory = load_memory()

    def __enter__(self) -> "BrowserTerminal":
        if self.auto_start:
            self.ensure_cdp_ready()
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.connect_over_cdp(self.cdp)
        self.pick_page(self.page_index)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()

    def reconnect(self) -> None:
        try:
            if self.browser:
                self.browser.close()
        except Exception:
            pass
        try:
            if self.playwright:
                self.playwright.stop()
        except Exception:
            pass
        self.browser = None
        self.playwright = None
        self.page = None
        self.cache = []
        self.ensure_cdp_ready()
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.connect_over_cdp(self.cdp)
        self.pick_page(0)
        print("已重新连接 CloakBrowser。")
        self.print_current()

    def ensure_cdp_ready(self) -> None:
        if check_cdp(self.cdp):
            return
        if not self.browser_path.exists():
            raise RuntimeError(f"{self.cdp} 未开启，且找不到 CloakBrowser：{self.browser_path}")
        cdp_port = cdp_port_from_url(self.cdp)
        profile_dir = default_profile_dir_for_cdp(self.cdp)
        profile_dir.mkdir(parents=True, exist_ok=True)
        print(f"{self.cdp} 未开启，正在启动 CloakBrowser：{self.browser_path}")
        self.started_process = subprocess.Popen(
            [
                str(self.browser_path),
                f"--remote-debugging-port={cdp_port}",
                "--remote-allow-origins=*",
                f"--user-data-dir={profile_dir}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(30):
            time.sleep(0.5)
            if check_cdp(self.cdp):
                print("CloakBrowser CDP 已就绪。")
                return
        raise RuntimeError(f"已尝试启动 CloakBrowser，但 {self.cdp} 仍未就绪。")

    def all_pages(self) -> list[Page]:
        pages: list[Page] = []
        for context in self.browser.contexts:
            pages.extend(context.pages)
        return pages

    def pick_page(self, index: int) -> None:
        pages = self.all_pages()
        if not pages:
            raise RuntimeError("没有找到 CloakBrowser 页面，请先打开一个标签页。")
        if index < 0 or index >= len(pages):
            raise RuntimeError(f"页面序号超出范围：0 - {len(pages) - 1}")
        self.page_index = index
        self.page = pages[index]

    def current_page(self) -> Page:
        if not self.page:
            self.pick_page(0)
        return self.page

    def print_pages(self) -> None:
        pages = self.all_pages()
        for index, page in enumerate(pages):
            marker = "*" if page is self.page else " "
            print(f"{marker} [{index}] {safe_text(page.title(), 60)}")
            print(f"      {page.url}")

    def collect_page_context(self, limit: int = 60) -> dict:
        page = self.current_page()
        page.wait_for_load_state("domcontentloaded", timeout=8000)
        self.cache = []

        body_text = safe_eval(page, "() => document.body ? document.body.innerText : ''") or ""
        selectors = [
            ("button", "button, [role=button], input[type=button], input[type=submit]"),
            ("input", "input:not([type=hidden]), textarea, [contenteditable=true], [role=textbox]"),
            ("select", "select"),
            ("link", "a[href]"),
        ]

        next_index = 1
        grouped: dict[str, list[dict]] = {}
        for kind, selector in selectors:
            loc = page.locator(selector)
            count = min(loc.count(), limit)
            if count <= 0:
                continue
            grouped[kind] = []
            for i in range(count):
                item = loc.nth(i)
                if kind in {"button", "select", "link"} and not is_visibleish(item):
                    continue
                label = describe_element(item)
                if not label:
                    continue
                self.cache.append(CachedElement(next_index, kind, label, item))
                grouped[kind].append({"index": next_index, "label": label})
                next_index += 1

        return {
            "title": page.title(),
            "url": page.url,
            "bodyTextPreview": safe_text(body_text, 2200),
            "elements": grouped,
        }

    def observe(self, limit: int = 40) -> None:
        context = self.collect_page_context(limit=limit)

        print("\n当前页面")
        print(f"Title: {context['title']}")
        print(f"URL:   {context['url']}\n")

        if context["bodyTextPreview"]:
            print("页面文字预览")
            print(safe_text(context["bodyTextPreview"], 900))
            print()

        for kind, elements in context["elements"].items():
            print(f"{kind} 元素")
            for item in elements:
                print(f"  [{item['index']}] {safe_text(item['label'], 110)}")
            print()

        if not self.cache:
            print("没有找到常见可操作元素。")

    def find_cached(self, query: str) -> CachedElement | None:
        query = query.strip()
        if query.isdigit():
            index = int(query)
            return next((item for item in self.cache if item.index == index), None)
        normalized = query.lower()
        return next((item for item in self.cache if normalized in item.label.lower()), None)

    def find_locator(self, query: str) -> tuple[Locator, str]:
        page = self.current_page()
        cached = self.find_cached(query)
        if cached:
            if cached.kind in {"button", "select", "link"} and not is_visibleish(cached.locator):
                try:
                    fallback = find_text_click_container(page, cached.label)
                    if fallback.count() > 0:
                        return fallback, cached.label
                except Exception:
                    pass
            return cached.locator, cached.label

        if query.startswith("css="):
            selector = query[4:].strip()
            return page.locator(selector).first, selector

        if query.startswith("text="):
            text = query[5:].strip()
            return page.get_by_text(text, exact=False).first, text

        candidates = [
            lambda: page.get_by_role("button", name=re.compile(re.escape(query), re.I)).first,
            lambda: page.get_by_text(query, exact=False).first,
            lambda: page.get_by_label(query, exact=False).first,
            lambda: page.get_by_placeholder(query, exact=False).first,
            lambda: page.locator(f"[title*='{css_escape(query)}']").first,
            lambda: page.locator(f"[aria-label*='{css_escape(query)}']").first,
            lambda: find_text_click_container(page, query),
        ]
        last_error: Exception | None = None
        for factory in candidates:
            try:
                loc = factory()
                if loc.count() > 0:
                    return loc, query
            except Exception as error:
                last_error = error
        raise RuntimeError(f"找不到元素：{query}" + (f" ({last_error})" if last_error else ""))

    def click(self, query: str, force: bool = False) -> None:
        locator, label = self.find_locator(query)
        if self.confirm_dangerous_clicks and is_dangerous(label) and not force:
            answer = input(f"这个点击可能会产生提交/删除/发送等动作：{label}\n确认执行？输入 y 继续：").strip().lower()
            if answer != "y":
                print("已取消。")
                return
        if self.humanize:
            print(f"我看到了：{safe_text(label, 80)}")
            self.pause_like_person("pre_action")
            highlight_target(locator)
        if self.visual_cursor:
            self.visual_click(locator)
        else:
            try:
                locator.click(timeout=8000)
            except Exception as error:
                msg = str(error)
                if "not visible" in msg.lower() or "element is not visible" in msg.lower() or "obscured" in msg.lower():
                    locator.click(timeout=8000, force=True)
                else:
                    raise
        if self.humanize:
            self.pause_like_person("post_action")
            self.maybe_scroll_wiggle()
            self.maybe_work_rest()
        print(f"已点击：{label}")

    def visual_click(self, locator: Locator) -> None:
        page = self.current_page()
        try:
            locator.scroll_into_view_if_needed(timeout=8000)
        except Exception:
            # Some sites use virtualized lists where scrollIntoView can't stabilize visibility.
            # Fallback to normal click (and force click as last resort).
            try:
                locator.click(timeout=8000)
            except Exception:
                locator.click(timeout=8000, force=True)
            return
        box = locator.bounding_box(timeout=8000)
        if not box:
            locator.click(timeout=8000)
            return
        x = box["x"] + box["width"] / 2
        y = box["y"] + box["height"] / 2
        ensure_visual_cursor(page)
        if self.humanize:
            hover_x = x + random.uniform(-18, 18)
            hover_y = y + random.uniform(-12, 12)
            hover_path = build_bezier_cursor_path(page, hover_x, hover_y, self.move_duration_factor() * 0.75, allow_overshoot=False)
            draw_visual_trail(page, hover_path, visible=True)
            self.follow_cursor_path(page, hover_path)
            self.pause_like_person("hover")
        path = build_bezier_cursor_path(page, x, y, self.move_duration_factor(), target_box=box, allow_overshoot=True)
        draw_visual_trail(page, path, visible=True)
        self.follow_cursor_path(page, path)
        if self.humanize:
            x, y = self.hover_jitter_on_box(page, box)
        move_visual_cursor(page, x, y, click=True)
        page.wait_for_timeout(45)
        page.mouse.click(x, y)
        page.wait_for_timeout(110)
        if self.humanize:
            self.maybe_post_click_settle(page, x, y)
        draw_visual_trail(page, [], visible=False)

    def inner_point_for_box(self, box: dict) -> tuple[float, float]:
        width = max(1.0, float(box.get("width") or 1))
        height = max(1.0, float(box.get("height") or 1))
        pad_x = min(width * 0.32, max(3.0, width * 0.16))
        pad_y = min(height * 0.32, max(3.0, height * 0.16))
        left = float(box.get("x") or 0) + pad_x
        right = float(box.get("x") or 0) + width - pad_x
        top = float(box.get("y") or 0) + pad_y
        bottom = float(box.get("y") or 0) + height - pad_y
        if right <= left:
            left = float(box.get("x") or 0) + width * 0.42
            right = float(box.get("x") or 0) + width * 0.58
        if bottom <= top:
            top = float(box.get("y") or 0) + height * 0.42
            bottom = float(box.get("y") or 0) + height * 0.58
        return random.uniform(left, right), random.uniform(top, bottom)

    def hover_jitter_on_box(self, page: Page, box: dict) -> tuple[float, float]:
        final_x, final_y = self.inner_point_for_box(box)
        moves = 1 if random.random() < 0.55 else 0
        for _ in range(moves):
            x, y = self.inner_point_for_box(box)
            try:
                move_visual_cursor(page, x, y, click=False)
                page.mouse.move(x, y, steps=random.randint(2, 6))
                page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(x), "y": float(y)})
                page.wait_for_timeout(random.randint(55, 190))
            except Exception:
                break
        return final_x, final_y

    def maybe_post_click_settle(self, page: Page, x: float, y: float) -> None:
        if random.random() > 0.48:
            return
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        try:
            nx = clamp(float(x) + random.choice([-1, 1]) * random.uniform(8, 24), 12, viewport["width"] - 12)
            ny = clamp(float(y) + random.choice([-1, 1]) * random.uniform(5, 18), 12, viewport["height"] - 12)
            move_visual_cursor(page, nx, ny, click=False)
            page.mouse.move(nx, ny, steps=random.randint(2, 5))
            page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": float(nx), "y": float(ny)})
            page.wait_for_timeout(random.randint(70, 240))
        except Exception:
            return

    def maybe_work_rest(self) -> None:
        if not self.humanize:
            return
        count = int(getattr(self, "_codex_human_work_count", 0)) + 1
        next_after = int(getattr(self, "_codex_human_next_rest_after", 0) or random.randint(7, 12))
        setattr(self, "_codex_human_work_count", count)
        if count < next_after:
            return
        setattr(self, "_codex_human_work_count", 0)
        setattr(self, "_codex_human_next_rest_after", random.randint(6, 11))
        page = self.current_page()
        rest_ms = random.randint(8500, 12500)
        try:
            self.maybe_micro_move()
            page.wait_for_timeout(rest_ms)
            self.maybe_micro_move()
        except Exception:
            try:
                page.wait_for_timeout(rest_ms)
            except Exception:
                pass

    def follow_cursor_path(self, page: Page, path: list[dict]) -> None:
        for point in path:
            move_visual_cursor(page, point["x"], point["y"], click=False)
            page.mouse.move(point["x"], point["y"])
            page.wait_for_timeout(point["delay"])

    def move_duration_factor(self) -> float:
        return float(PACE_PRESETS[self.pace]["move_duration_factor"])

    def pause_like_person(self, key: str) -> None:
        self.maybe_micro_move()
        low, high = PACE_PRESETS[self.pace][key]
        self.current_page().wait_for_timeout(random.randint(low, high))

    def maybe_micro_move(self) -> None:
        if not self.humanize:
            return
        preset = PACE_PRESETS.get(self.pace) or {}
        chance = float(preset.get("micro_move_chance") or 0.0)
        if chance <= 0 or random.random() > chance:
            return
        page = self.current_page()
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        try:
            pos = page.evaluate("() => window.__codexCursorPos || { x: innerWidth / 2, y: innerHeight / 2 }")
            x = float(pos.get("x", viewport["width"] / 2))
            y = float(pos.get("y", viewport["height"] / 2))
        except Exception:
            x = viewport["width"] / 2
            y = viewport["height"] / 2
        x = clamp(x + random.uniform(-18, 18), 12, viewport["width"] - 12)
        y = clamp(y + random.uniform(-12, 12), 12, viewport["height"] - 12)
        try:
            ensure_visual_cursor(page)
            move_visual_cursor(page, x, y, click=False)
            page.mouse.move(x, y, steps=random.randint(2, 6))
            page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": x, "y": y})
        except Exception:
            return

    def maybe_scroll_wiggle(self) -> None:
        if random.random() > PACE_PRESETS[self.pace]["scroll_wiggle_chance"]:
            return
        page = self.current_page()
        amount = random.randint(80, 170)
        try:
            viewport = page.viewport_size or {"width": 1280, "height": 720}
            x = random.uniform(viewport["width"] * 0.42, viewport["width"] * 0.62)
            y = random.uniform(viewport["height"] * 0.35, viewport["height"] * 0.72)
            if self.visual_cursor:
                ensure_visual_cursor(page)
                path = build_bezier_cursor_path(page, x, y, self.move_duration_factor() * 0.6, allow_overshoot=False)
                draw_visual_trail(page, path, visible=True)
                self.follow_cursor_path(page, path)
                draw_visual_trail(page, [], visible=False)
            else:
                page.mouse.move(x, y, steps=random.randint(5, 12))
        except Exception:
            pass
        for step in split_scroll_amount(amount):
            page.mouse.wheel(0, step)
            page.wait_for_timeout(random.randint(45, 130))
        back_amount = -random.randint(40, amount)
        for step in split_scroll_amount(back_amount):
            page.mouse.wheel(0, step)
            page.wait_for_timeout(random.randint(45, 145))

    def fill(self, query: str, value: str) -> None:
        locator, label = self.find_locator(query)
        if self.humanize:
            self.pause_like_person("pre_action")
            highlight_target(locator)
            try:
                locator.click(timeout=8000)
            except Exception:
                pass
            # Clear then type with per-keystroke delay for a more human feel.
            locator.fill("", timeout=8000)
            delay_low, delay_high = PACE_PRESETS[self.pace]["type_delay_ms"]
            typo_chance = float(PACE_PRESETS[self.pace].get("typo_chance") or 0.0)
            text = str(value or "")
            if text and random.random() < typo_chance and len(text) >= 8:
                cut = random.randint(2, min(6, len(text) - 2))
                wrong = random.choice("abcdefghijklmnopqrstuvwxyz")
                locator.type(text[:cut] + wrong, delay=random.randint(delay_low, delay_high))
                self.current_page().keyboard.press("Backspace")
                locator.type(text[cut:], delay=random.randint(delay_low, delay_high))
            else:
                locator.type(text, delay=random.randint(delay_low, delay_high))
            self.pause_like_person("post_action")
            self.maybe_scroll_wiggle()
        else:
            locator.fill(value, timeout=8000)
        print(f"已填写：{label}")

    def upload(self, query: str, file_path: str) -> None:
        path = resolve_upload_path(file_path)
        if query.strip().lower() in {"file", "input", "resume", "pdf", "简历", "文件"}:
            locator = self.current_page().locator("input[type=file]").first
            label = "input[type=file]"
        else:
            locator, label = self.find_locator(query)
        locator.set_input_files(str(path), timeout=8000)
        print(f"已上传到：{label}")
        print(f"文件：{path}")

    def press(self, key: str) -> None:
        self.current_page().keyboard.press(key)
        print(f"已按键：{key}")

    def goto(self, url: str) -> None:
        self.current_page().goto(url, wait_until="domcontentloaded")
        print(f"已打开：{url}")

    def screenshot(self, path_text: str | None = None) -> None:
        path = Path(path_text or f"cloak_screenshot_{int(time.time())}.png").resolve()
        self.current_page().screenshot(path=str(path), full_page=True)
        print(f"截图已保存：{path}")

    def ask(self, task: str, auto: bool = False) -> None:
        if not task.strip():
            raise RuntimeError("用法：ask 你想让浏览器完成的任务")

        context = self.collect_page_context(limit=80)
        print("正在让大模型理解当前页面...")
        related_memory = get_related_memory(self.memory, context.get("url", ""))
        plan = ask_llm_for_actions(task, context, self.active_role, related_memory)
        actions = normalize_llm_actions(plan.get("actions", []))
        thought = plan.get("thought") or plan.get("summary") or ""
        memory_entry = {
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "url": context.get("url", ""),
            "title": context.get("title", ""),
            "role": get_role_name(self.roles, self.active_role),
            "task": task,
            "thought": thought,
            "actions": actions,
            "confirmed": False,
            "result": "planned",
        }

        print("\n模型理解")
        if thought:
            print(thought)
        if not actions:
            print("模型没有给出可执行动作。")
            return

        print("\n动作计划")
        for index, action in enumerate(actions, start=1):
            print(f"  {index}. {format_action(action)}")

        if not auto:
            answer = input("\n确认执行这些动作？输入 y 继续：").strip().lower()
            if answer != "y":
                print("已取消。")
                memory_entry["result"] = "cancelled"
                append_memory(self.memory, memory_entry)
                return

        memory_entry["confirmed"] = True
        self.execute_actions(actions)
        memory_entry["result"] = "executed"
        memory_entry["afterUrl"] = self.current_page().url
        memory_entry["afterTitle"] = self.current_page().title()
        append_memory(self.memory, memory_entry)

    def agent(self, task: str, auto: bool = False, max_steps: int = 8) -> None:
        if not task.strip():
            raise RuntimeError("用法：agent 你想让浏览器持续完成的任务")

        history: list[dict] = []
        print(f"智能体开始执行，最多 {max_steps} 步。")
        for step in range(1, max_steps + 1):
            context = self.collect_page_context(limit=80)
            related_memory = get_related_memory(self.memory, context.get("url", ""))
            step_task = (
                f"总任务：{task}\n"
                f"当前是第 {step} 步，最多 {max_steps} 步。\n"
                f"历史步骤：{json.dumps(history[-6:], ensure_ascii=False)}\n"
                "请只给当前页面下一小步动作。如果任务已经完成，返回 done。"
            )
            print(f"\n第 {step} 步：正在观察页面并请求大模型规划...")
            plan = ask_llm_for_actions(step_task, context, self.active_role, related_memory)
            actions = normalize_llm_actions(plan.get("actions", []))
            thought = plan.get("thought") or plan.get("summary") or ""

            print("模型理解")
            if thought:
                print(thought)
            if not actions:
                print("模型没有给出动作，智能体停止。")
                break

            print("动作计划")
            for index, action in enumerate(actions, start=1):
                print(f"  {index}. {format_action(action)}")

            memory_entry = {
                "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                "url": context.get("url", ""),
                "title": context.get("title", ""),
                "role": get_role_name(self.roles, self.active_role),
                "task": task,
                "agentStep": step,
                "thought": thought,
                "actions": actions,
                "confirmed": auto,
                "result": "planned",
            }

            if not auto:
                answer = input("执行这一步？输入 y 继续，s 停止：").strip().lower()
                if answer == "s":
                    memory_entry["result"] = "stopped_by_user"
                    append_memory(self.memory, memory_entry)
                    print("智能体已停止。")
                    break
                if answer != "y":
                    memory_entry["result"] = "skipped_by_user"
                    append_memory(self.memory, memory_entry)
                    print("已跳过这一步。")
                    continue
                memory_entry["confirmed"] = True

            done = self.execute_actions(actions)
            memory_entry["result"] = "done" if done else "executed"
            memory_entry["afterUrl"] = self.current_page().url
            memory_entry["afterTitle"] = self.current_page().title()
            append_memory(self.memory, memory_entry)
            history.append({
                "step": step,
                "thought": thought,
                "actions": actions,
                "result": memory_entry["result"],
                "url": memory_entry["afterUrl"],
            })

            if done:
                print("智能体认为任务已完成。")
                break
            self.current_page().wait_for_timeout(random.randint(420, 520))
        else:
            print(f"已达到 {max_steps} 步上限，智能体停止。")

    def execute_actions(self, actions: list[dict]) -> bool:
        for action in actions:
            kind = str(action.get("action") or "").lower()
            target = str(action.get("target") or action.get("query") or "").strip()
            value = str(action.get("value") or "").strip()

            if kind == "click":
                self.click(target)
            elif kind == "fill":
                if not target or not value:
                    raise RuntimeError(f"fill 动作缺少 target/value：{action}")
                self.fill(target, value)
            elif kind == "upload":
                if not target or not value:
                    raise RuntimeError(f"upload 动作缺少 target/value：{action}")
                self.upload(target, value)
            elif kind == "press":
                self.press(value or target or "Enter")
            elif kind == "goto":
                self.goto(value or target)
            elif kind == "wait":
                ms = int(value or target or "1000")
                self.current_page().wait_for_timeout(ms)
                print(f"已等待 {ms} ms。")
            elif kind == "observe":
                self.observe()
            elif kind in {"done", "stop"}:
                print(str(action.get("reason") or "任务结束。"))
                return True
            else:
                raise RuntimeError(f"未知模型动作：{action}")
        return False

    def list_roles(self) -> None:
        print("可用角色：")
        for name in sorted(self.roles):
            marker = "*" if self.roles[name] == self.active_role else " "
            print(f"{marker} {name}")

    def set_role(self, name: str) -> None:
        name = name.strip()
        if not name:
            self.list_roles()
            return
        if name not in self.roles:
            raise RuntimeError(f"角色不存在：{name}")
        self.active_role = self.roles[name]
        print(f"已切换角色：{name}")

    def show_role(self, name: str = "") -> None:
        prompt = self.roles.get(name.strip(), self.active_role) if name.strip() else self.active_role
        print(prompt)

    def save_role(self, rest: str) -> None:
        name, prompt = split_role_args(rest)
        self.roles[name] = prompt
        save_roles(self.roles)
        self.active_role = prompt
        print(f"已保存并切换角色：{name}")

    def run_command(self, line: str) -> bool:
        line = line.strip()
        if not line:
            return True

        command, _, rest = line.partition(" ")
        command = command.lower()
        rest = rest.strip()

        try:
            if command in {"quit", "exit", "q"}:
                return False
            if command in {"help", "h", "?"}:
                print_help()
            elif command == "version":
                print(VERSION)
            elif command == "reconnect":
                self.reconnect()
            elif command == "pages":
                self.print_pages()
            elif command == "use":
                self.pick_page(int(rest or "0"))
                self.print_current()
            elif command in {"current", "url"}:
                self.print_current()
            elif command in {"observe", "obs", "o"}:
                limit = int(rest) if rest.isdigit() else 40
                self.observe(limit=limit)
            elif command == "click":
                if not rest:
                    raise RuntimeError("用法：click 元素序号/文本/css=选择器")
                self.click(rest)
            elif command == "click!":
                if not rest:
                    raise RuntimeError("用法：click! 元素序号/文本/css=选择器")
                self.click(rest, force=True)
            elif command == "fill":
                query, value = split_fill_args(rest)
                self.fill(query, value)
            elif command == "upload":
                query, value = split_fill_args(rest)
                self.upload(query, value)
            elif command == "press":
                self.press(rest or "Enter")
            elif command == "goto":
                if not rest:
                    raise RuntimeError("用法：goto https://...")
                self.goto(rest)
            elif command == "back":
                self.current_page().go_back(wait_until="domcontentloaded")
                print("已后退。")
            elif command == "reload":
                self.current_page().reload(wait_until="domcontentloaded")
                print("已刷新。")
            elif command == "wait":
                ms = int(rest or "1000")
                self.current_page().wait_for_timeout(ms)
                print(f"已等待 {ms} ms。")
            elif command == "screenshot":
                self.screenshot(rest or None)
            elif command == "text":
                text = safe_eval(self.current_page(), "() => document.body ? document.body.innerText : ''") or ""
                print(safe_text(text, int(rest) if rest.isdigit() else 3000))
            elif command == "ask":
                self.ask(rest, auto=False)
            elif command == "ask!":
                self.ask(rest, auto=True)
            elif command == "agent":
                self.agent(rest, auto=False)
            elif command == "agent!":
                self.agent(rest, auto=True)
            elif command == "roles":
                self.list_roles()
            elif command == "role":
                self.set_role(rest)
            elif command == "role-show":
                self.show_role(rest)
            elif command == "role-save":
                self.save_role(rest)
            elif command == "memory":
                print_memory(self.memory, rest)
            elif command == "cursor":
                mode = rest.lower() or "on"
                if mode in {"on", "1", "true"}:
                    self.visual_cursor = True
                    print("可视化鼠标已开启。")
                elif mode in {"off", "0", "false"}:
                    self.visual_cursor = False
                    print("可视化鼠标已关闭。")
                else:
                    print(f"可视化鼠标：{'开启' if self.visual_cursor else '关闭'}")
            elif command == "human":
                mode = rest.lower() or "on"
                if mode in {"on", "1", "true"}:
                    self.humanize = True
                    print("观察演示模式已开启。")
                elif mode in {"off", "0", "false"}:
                    self.humanize = False
                    print("观察演示模式已关闭。")
                else:
                    print(f"观察演示模式：{'开启' if self.humanize else '关闭'}")
            elif command == "pace":
                mode = rest.lower().strip()
                if mode in PACE_PRESETS:
                    self.pace = mode
                    print(f"速度档已切换：{mode}")
                else:
                    print(f"当前速度档：{self.pace}；可选：fast / normal / slow")
            else:
                print(f"未知命令：{command}。输入 help 查看命令。")
        except Exception as error:
            print(f"操作失败：{error}")
        return True

    def print_current(self) -> None:
        page = self.current_page()
        print(f"[{self.page_index}] {page.title()}")
        print(page.url)

    def repl(self) -> None:
        print("CloakBrowser 终端控制器已连接。输入 help 查看命令。")
        self.print_current()
        while True:
            try:
                line = input("cloak> ")
            except (EOFError, KeyboardInterrupt):
                print()
                break
            if not self.run_command(line):
                break


def safe_eval(page: Page, script: str, *args):
    try:
        if not args:
            return page.evaluate(script)
        return page.evaluate(script, args[0] if len(args) == 1 else list(args))
    except PlaywrightError:
        return ""


def check_cdp(cdp_url: str) -> bool:
    try:
        with urlopen(cdp_url.rstrip("/") + "/json/version", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def ensure_visual_cursor(page: Page) -> None:
    page.evaluate(
        """() => {
          if (window.__codexCursorReady) return;
          window.__codexCursorReady = true;
          const style = document.createElement('style');
          style.id = 'codex-visual-cursor-style';
          style.textContent = `
            #codex-visual-cursor {
              position: fixed;
              left: 0;
              top: 0;
              width: 26px;
              height: 26px;
              z-index: 2147483647;
              pointer-events: none;
              transform: translate3d(-100px, -100px, 0);
              transition: none;
              filter: drop-shadow(0 4px 8px rgba(15, 23, 42, 0.28));
            }
            #codex-visual-cursor::before {
              content: "";
              position: absolute;
              left: 3px;
              top: 2px;
              width: 0;
              height: 0;
              border-style: solid;
              border-width: 0 0 22px 14px;
              border-color: transparent transparent #ffffff transparent;
              transform: rotate(-18deg);
            }
            #codex-visual-cursor::after {
              content: "";
              position: absolute;
              left: 5px;
              top: 4px;
              width: 0;
              height: 0;
              border-style: solid;
              border-width: 0 0 16px 10px;
              border-color: transparent transparent #2563eb transparent;
              transform: rotate(-18deg);
            }
            .codex-click-ring {
              position: fixed;
              width: 10px;
              height: 10px;
              z-index: 2147483646;
              border: 2px solid #2563eb;
              border-radius: 999px;
              pointer-events: none;
              transform: translate(-50%, -50%) scale(1);
              animation: codex-click-ring 520ms ease-out forwards;
            }
            @keyframes codex-click-ring {
              to {
                opacity: 0;
                transform: translate(-50%, -50%) scale(4.4);
              }
            }
            #codex-cursor-trail {
              position: fixed;
              inset: 0;
              width: 100vw;
              height: 100vh;
              z-index: 2147483645;
              pointer-events: none;
              opacity: 0;
              transition: opacity 220ms ease;
            }
            #codex-cursor-trail.is-visible {
              opacity: 1;
            }
            #codex-cursor-trail path {
              fill: none;
              stroke: #2563eb;
              stroke-width: 2.5;
              stroke-linecap: round;
              stroke-dasharray: 7 8;
              filter: drop-shadow(0 2px 4px rgba(37, 99, 235, 0.25));
            }
          `;
          document.documentElement.appendChild(style);
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.id = 'codex-cursor-trail';
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.id = 'codex-cursor-trail-path';
          svg.appendChild(path);
          document.documentElement.appendChild(svg);
          const cursor = document.createElement('div');
          cursor.id = 'codex-visual-cursor';
          document.documentElement.appendChild(cursor);
        }"""
    )


def move_visual_cursor(page: Page, x: float, y: float, click: bool = False) -> None:
    page.evaluate(
        """({ x, y, click }) => {
          const cursor = document.querySelector('#codex-visual-cursor');
          if (cursor) cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          if (click) {
            const ring = document.createElement('div');
            ring.className = 'codex-click-ring';
            ring.style.left = `${x}px`;
            ring.style.top = `${y}px`;
            document.documentElement.appendChild(ring);
            window.setTimeout(() => ring.remove(), 600);
          }
        }""",
        {"x": x, "y": y, "click": click},
    )


def highlight_target(locator: Locator) -> None:
    try:
        locator.evaluate(
            """(el) => {
              const oldOutline = el.style.outline;
              const oldOutlineOffset = el.style.outlineOffset;
              const oldBoxShadow = el.style.boxShadow;
              el.style.outline = '3px solid rgba(37, 99, 235, 0.85)';
              el.style.outlineOffset = '3px';
              el.style.boxShadow = '0 0 0 6px rgba(37, 99, 235, 0.14)';
              window.setTimeout(() => {
                el.style.outline = oldOutline;
                el.style.outlineOffset = oldOutlineOffset;
                el.style.boxShadow = oldBoxShadow;
              }, 900);
            }"""
        )
    except Exception:
        pass


def draw_visual_trail(page: Page, path: list[dict], visible: bool) -> None:
    page.evaluate(
        """({ points, visible }) => {
          const svg = document.querySelector('#codex-cursor-trail');
          const trail = document.querySelector('#codex-cursor-trail-path');
          if (!svg || !trail) return;
          if (!visible || !points.length) {
            svg.classList.remove('is-visible');
            window.setTimeout(() => trail.setAttribute('d', ''), 240);
            return;
          }
          const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
          trail.setAttribute('d', d);
          svg.classList.add('is-visible');
        }""",
        {"points": [{"x": point["x"], "y": point["y"]} for point in path], "visible": visible},
    )


def fitts_law_duration_ms(distance: float, target_size: float, duration_factor: float = 1.0) -> int:
    target_size = max(8.0, float(target_size or 44.0))
    distance = max(1.0, float(distance or 1.0))
    index_of_difficulty = math.log2(distance / target_size + 1.0)
    duration = 150 + index_of_difficulty * 135 + distance * 0.16
    jitter = random.uniform(0.88, 1.16)
    return int(max(260, min(1350, duration * jitter * max(0.35, min(2.4, duration_factor)))))


def make_bezier_segment(
    start_x: float,
    start_y: float,
    target_x: float,
    target_y: float,
    duration: int,
    *,
    min_steps: int = 10,
) -> list[dict]:
    dx = target_x - start_x
    dy = target_y - start_y
    distance = max(1.0, (dx * dx + dy * dy) ** 0.5)
    steps = max(min_steps, min(64, int(distance / 15) + random.randint(4, 10)))
    delay = max(6, int(duration / steps))

    normal_x = -dy / distance
    normal_y = dx / distance
    curve = clamp(distance * random.uniform(0.10, 0.24), -150, 150) * random.choice([-1, 1])
    control_x = (start_x + target_x) / 2 + normal_x * curve
    control_y = (start_y + target_y) / 2 + normal_y * curve

    points = []
    for index in range(1, steps + 1):
        t = index / steps
        eased = ease_in_out_cubic(t)
        tremor = math.sin(t * math.pi * random.uniform(1.5, 2.7)) * random.uniform(0.0, 1.2)
        x = (1 - eased) ** 2 * start_x + 2 * (1 - eased) * eased * control_x + eased**2 * target_x
        y = (1 - eased) ** 2 * start_y + 2 * (1 - eased) * eased * control_y + eased**2 * target_y
        if 0.08 < t < 0.92:
            x += normal_x * tremor
            y += normal_y * tremor
        points.append({"x": x, "y": y, "delay": delay + random.randint(-2, 4)})
    return points


def build_bezier_cursor_path(
    page: Page,
    target_x: float,
    target_y: float,
    duration_factor: float = 1.0,
    target_box: dict | None = None,
    allow_overshoot: bool = True,
) -> list[dict]:
    current = page.evaluate(
        """() => {
          const cursor = document.querySelector('#codex-visual-cursor');
          const stored = window.__codexCursorPos || null;
          if (stored) return stored;
          const width = window.innerWidth || 1200;
          const height = window.innerHeight || 800;
          return { x: Math.min(80, width * 0.12), y: Math.min(80, height * 0.12) };
        }"""
    )
    start_x = float(current.get("x", 80))
    start_y = float(current.get("y", 80))
    dx = target_x - start_x
    dy = target_y - start_y
    distance = max(1.0, (dx * dx + dy * dy) ** 0.5)
    target_size = 44.0
    if isinstance(target_box, dict):
        target_size = max(8.0, min(float(target_box.get("width") or 44), float(target_box.get("height") or 44)))
    duration = fitts_law_duration_ms(distance, target_size, duration_factor)

    points = []
    should_overshoot = (
        allow_overshoot
        and distance > 120
        and random.random() < 0.42
    )
    if should_overshoot:
        unit_x = dx / distance
        unit_y = dy / distance
        overshoot_distance = min(max(distance * random.uniform(0.025, 0.075), 6), max(10, target_size * 0.72))
        overshoot_x = target_x + unit_x * overshoot_distance
        overshoot_y = target_y + unit_y * overshoot_distance
        if isinstance(target_box, dict):
            overshoot_x = clamp(overshoot_x, 8, max(8, float(page.viewport_size.get("width", 1280)) - 8) if page.viewport_size else 1272)
            overshoot_y = clamp(overshoot_y, 8, max(8, float(page.viewport_size.get("height", 720)) - 8) if page.viewport_size else 712)
        first_duration = int(duration * random.uniform(0.68, 0.78))
        second_duration = max(90, duration - first_duration)
        points.extend(make_bezier_segment(start_x, start_y, overshoot_x, overshoot_y, first_duration, min_steps=12))
        points.extend(make_bezier_segment(overshoot_x, overshoot_y, target_x, target_y, second_duration, min_steps=6))
    else:
        points = make_bezier_segment(start_x, start_y, target_x, target_y, duration, min_steps=12)

    page.evaluate("""pos => { window.__codexCursorPos = pos; }""", {"x": target_x, "y": target_y})
    return points


def ease_in_out_cubic(t: float) -> float:
    if t < 0.5:
        return 4 * t * t * t
    return 1 - ((-2 * t + 2) ** 3) / 2


def ask_llm_for_actions(task: str, context: dict, role_prompt: str = DEFAULT_ROLE_PROMPT, related_memory: list[dict] | None = None) -> dict:
    load_local_env_files()
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        raise RuntimeError("未找到环境变量 DASHSCOPE_API_KEY，无法调用大模型。")

    system_prompt = f"""
你是一个浏览器操作规划助手。你不能直接操作浏览器，只能根据页面信息输出 JSON。
目标：理解当前页面 DOM 摘要和用户任务，给出少量下一步动作。

当前角色设定：
{role_prompt}

必须遵守：
1. 只输出 JSON，不要输出 Markdown。
2. JSON 格式：
{{
  "thought": "一句话说明你对页面的理解",
  "actions": [
    {{"action": "click", "target": "元素编号或可见文本"}},
    {{"action": "fill", "target": "元素编号或输入框标签", "value": "要填写的内容"}},
    {{"action": "upload", "target": "file input 元素编号或标签", "value": "本地文件绝对路径"}},
    {{"action": "press", "value": "Enter"}},
    {{"action": "wait", "value": "1000"}},
    {{"action": "goto", "value": "https://..."}},
    {{"action": "observe"}},
    {{"action": "done", "reason": "说明"}}
  ]
}}
3. 优先用 observe 提供的元素编号作为 target，例如 "3"。
4. 一次最多给 5 个动作。
5. 如果页面信息不足，返回 observe 或 done，并说明需要用户切换页面。
6. 不要尝试绕过验证码、登录限制、风控或权限。
7. 涉及提交、删除、发布、付款、发送消息、邀请、拨打电话等高风险动作时，只能给出动作计划；执行器会二次确认。
8. relatedMemory 是这个网站近期任务记录，可以参考其中成功的入口、按钮名称和用户偏好，但不要盲目重复旧动作。
9. 绝对不要编造本地文件路径。只有当用户任务、记忆或页面内容明确给出真实路径时，才输出 upload；否则返回 done 并说明需要用户提供文件路径。
""".strip()

    user_prompt = {
        "task": task,
        "page": context,
        "relatedMemory": related_memory or [],
    "availableActions": ["click", "fill", "upload", "press", "wait", "goto", "observe", "done"],
    }
    payload = {
        "model": DEFAULT_LLM_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    request = Request(
        DEFAULT_LLM_BASE_URL.rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=60) as response:
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    content = data["choices"][0]["message"]["content"]
    return parse_json_object(content)


def load_local_env_files() -> None:
    for path in ENV_FILE_CANDIDATES:
        if not path.exists():
            continue
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        except Exception:
            continue


def parse_json_object(content: str) -> dict:
    content = (content or "").strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.S)
        if not match:
            raise RuntimeError(f"模型没有返回 JSON：{content[:300]}")
        return json.loads(match.group(0))


def normalize_llm_actions(actions) -> list[dict]:
    if not isinstance(actions, list):
        return []
    allowed = {"click", "fill", "upload", "press", "wait", "goto", "observe", "done", "stop"}
    normalized = []
    for action in actions[:5]:
        if not isinstance(action, dict):
            continue
        kind = str(action.get("action") or "").lower()
        if kind not in allowed:
            continue
        normalized.append(action)
    return normalized


def load_roles() -> dict[str, str]:
    roles = {
        "default": DEFAULT_ROLE_PROMPT,
        "course": """
你是课设网站操作助手，只服务用户自己的课程设计/测试网站。
你擅长识别导航菜单、登录入口、表单、作业/报告上传入口、查询按钮和列表页面。
执行任务时先找最稳妥的入口，优先用可见文字和元素编号。
遇到提交、删除、发布、最终确认类动作时必须谨慎，只生成计划并等待用户确认。
不要绕过验证码、权限、登录限制或任何安全机制。
""".strip(),
        "reader": """
你是页面阅读分析助手，主要负责理解页面内容、总结当前页面状态、指出用户下一步可以点哪里。
除非用户明确要求，否则不要生成 click/fill 动作，优先返回 done 或 observe。
""".strip(),
    }
    if ROLE_FILE.exists():
        try:
            custom = json.loads(ROLE_FILE.read_text(encoding="utf-8") or "{}")
            for name, prompt in custom.items():
                if isinstance(name, str) and isinstance(prompt, str) and name.strip() and prompt.strip():
                    roles[name.strip()] = prompt.strip()
        except Exception:
            pass
    return roles


def save_roles(roles: dict[str, str]) -> None:
    ROLE_FILE.write_text(json.dumps(roles, ensure_ascii=False, indent=2), encoding="utf-8")


def load_memory() -> list[dict]:
    if not MEMORY_FILE.exists():
        return []
    try:
        data = json.loads(MEMORY_FILE.read_text(encoding="utf-8") or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_memory(memory: list[dict]) -> None:
    MEMORY_FILE.write_text(json.dumps(memory[-300:], ensure_ascii=False, indent=2), encoding="utf-8")


def append_memory(memory: list[dict], entry: dict) -> None:
    memory.append(entry)
    save_memory(memory)


def get_related_memory(memory: list[dict], url: str, limit: int = 6) -> list[dict]:
    host = url_host(url)
    related = []
    for item in reversed(memory):
        if host and url_host(item.get("url", "")) != host:
            continue
        related.append({
            "time": item.get("time"),
            "title": item.get("title"),
            "url": item.get("url"),
            "role": item.get("role"),
            "task": item.get("task"),
            "thought": item.get("thought"),
            "actions": item.get("actions"),
            "result": item.get("result"),
        })
        if len(related) >= limit:
            break
    return related


def print_memory(memory: list[dict], rest: str = "") -> None:
    limit = int(rest) if str(rest).strip().isdigit() else 10
    if not memory:
        print("暂无自动记忆。")
        return
    for index, item in enumerate(memory[-limit:], start=max(1, len(memory) - limit + 1)):
        print(f"[{index}] {item.get('time', '-')}: {safe_text(item.get('task', ''), 80)}")
        print(f"     {item.get('result', '-')} | {safe_text(item.get('title', ''), 60)}")
        print(f"     {item.get('url', '')}")


def url_host(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return ""


def get_role_name(roles: dict[str, str], prompt: str) -> str:
    for name, value in roles.items():
        if value == prompt:
            return name
    return "custom"


def split_role_args(rest: str) -> tuple[str, str]:
    if "=" in rest:
        name, prompt = rest.split("=", 1)
    else:
        name, _, prompt = rest.partition(" ")
    name = name.strip()
    prompt = prompt.strip()
    if not name or not prompt:
        raise RuntimeError("用法：role-save 角色名 = 角色prompt")
    return name, prompt


def format_action(action: dict) -> str:
    kind = action.get("action")
    target = action.get("target") or action.get("query") or ""
    value = action.get("value") or ""
    reason = action.get("reason") or ""
    if kind == "fill":
        return f"fill {target} = {value}"
    if kind == "upload":
        return f"upload {target} = {value}"
    if kind == "click":
        return f"click {target}"
    if kind in {"press", "wait", "goto"}:
        return f"{kind} {value or target}"
    if kind in {"done", "stop"}:
        return f"{kind}: {reason}"
    return json.dumps(action, ensure_ascii=False)


def describe_element(locator: Locator) -> str:
    try:
        return locator.evaluate(
            """(el) => {
              const attr = (name) => el.getAttribute(name) || "";
              const text = (el.innerText || el.textContent || el.value || "").trim();
              const parts = [
                text,
                attr("aria-label"),
                attr("placeholder"),
                attr("title"),
                attr("name"),
                attr("id"),
                attr("href")
              ].filter(Boolean);
              return [...new Set(parts)].join(" | ");
            }"""
        ).strip()
    except Exception:
        return ""


def is_visibleish(locator: Locator) -> bool:
    try:
        return bool(
            locator.evaluate(
                """(el) => {
                  const style = window.getComputedStyle(el);
                  const box = el.getBoundingClientRect();
                  return !!(box.width || box.height || el.getClientRects().length)
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
                }"""
            )
        )
    except Exception:
        return True


def css_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def split_scroll_amount(amount: int) -> list[int]:
    if amount == 0:
        return []
    direction = 1 if amount > 0 else -1
    remaining = abs(int(amount))
    segments = max(3, min(9, remaining // random.randint(75, 135) + random.randint(1, 3)))
    weights = []
    for index in range(int(segments)):
        t = (index + 0.5) / max(1, segments)
        weights.append(max(0.18, math.sin(math.pi * t) * random.uniform(0.65, 1.35)))
    total_weight = sum(weights) or 1.0
    steps: list[int] = []
    allocated = 0
    for index, weight in enumerate(weights):
        if index == len(weights) - 1:
            step = remaining - allocated
        else:
            step = int(max(12, min(180, remaining * weight / total_weight)))
            allocated += step
        if step <= 0:
            continue
        steps.append(direction * step)
        if index not in {0, len(weights) - 1} and random.random() < 0.16:
            steps.append(-direction * random.randint(6, max(8, min(36, step // 2))))
    return steps


def find_text_click_container(page: Page, query: str) -> Locator:
    token = f"codex_click_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"
    found = page.evaluate(
        """({ query, token }) => {
          const normalize = (text) => String(text || "").replace(/\\s+/g, " ").trim().toLowerCase();
          const wanted = normalize(query);
          if (!wanted) return false;
          const terms = wanted.split(" ").filter(Boolean).slice(0, 8);
          const isVisible = (el) => {
            const box = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          };
          const scoreText = (text) => {
            const normalized = normalize(text);
            if (!normalized) return 0;
            if (normalized.includes(wanted)) return 10000 - Math.min(normalized.length, 9000);
            let score = 0;
            for (const term of terms) {
              if (term.length >= 2 && normalized.includes(term)) score += Math.min(80, term.length * 6);
            }
            return score;
          };
          const elements = Array.from(document.body ? document.body.querySelectorAll("*") : []);
          let best = null;
          let bestScore = 0;
          for (const el of elements) {
            if (!isVisible(el)) continue;
            const text = el.innerText || el.textContent || "";
            const score = scoreText(text);
            if (score <= bestScore) continue;
            best = el;
            bestScore = score;
          }
          if (!best || bestScore < 60) return false;
          const clickableSelector = [
            "a[href]",
            "button",
            "[role='button']",
            "[role='link']",
            "[role='option']",
            "[role='listitem']",
            "[onclick]",
            "li",
            "[class*='item' i]",
            "[class*='chat' i]",
            "[class*='card' i]",
            "[class*='list' i]"
          ].join(",");
          let target = best.closest(clickableSelector) || best;
          while (target && target !== document.body && !isVisible(target)) {
            target = target.parentElement;
          }
          if (!target || target === document.body) target = best;
          target.setAttribute("data-codex-click-target", token);
          return true;
        }""",
        {"query": query, "token": token},
    )
    if not found:
        raise RuntimeError(f"找不到包含文本的可点击区域：{query}")
    return page.locator(f"[data-codex-click-target='{token}']").first


def safe_text(value: str, limit: int) -> str:
    value = re.sub(r"\s+", " ", str(value or "")).strip()
    return value if len(value) <= limit else value[:limit] + "..."


def is_dangerous(label: str) -> bool:
    normalized = label.lower()
    return any(word.lower() in normalized for word in DANGEROUS_WORDS)


def split_fill_args(rest: str) -> tuple[str, str]:
    if " = " in rest:
        query, value = rest.split(" = ", 1)
    elif "=" in rest:
        query, value = rest.split("=", 1)
    else:
        query, _, value = rest.partition(" ")
    query = query.strip()
    value = value.strip()
    if not query or not value:
        raise RuntimeError("用法：fill 输入框序号/文本 = 要填写的内容")
    return query, value


def resolve_upload_path(file_path: str) -> Path:
    raw = file_path.strip().strip('"')
    path = Path(raw).expanduser().resolve()
    if path.exists():
        return path

    print(f"模型给出的文件路径不存在：{path}")
    typed = input("请输入真实简历文件绝对路径，或直接回车取消：").strip()
    if not typed:
        raise RuntimeError("已取消上传：没有提供真实文件路径")

    path = Path(typed.strip().strip('"')).expanduser().resolve()
    if not path.exists():
        raise RuntimeError(f"文件不存在：{path}")
    return path


def print_help() -> None:
    print(
        """
命令：
  pages                         列出 CloakBrowser 当前标签页
  version                       显示脚本版本，确认是否为新版
  reconnect                     页面/浏览器关闭后重新连接
  use 0                         切换到第 0 个标签页
  current                       显示当前页标题和 URL
  observe [数量]                读取当前页文字、按钮、输入框、链接，并编号
  click 3                       点击 observe 里的第 3 个元素
  click 登录                    按文本查找并点击
  click css=.submit             用 CSS 选择器点击
  click! 提交                   强制点击敏感按钮，跳过确认
  fill 账号 = my_user           填写输入框
  upload 9 = C:\\path\\a.pdf    上传文件到 file input；比点系统文件弹窗更稳
  press Enter                   按键
  goto https://example.com      打开网址
  back / reload / wait 1000     后退 / 刷新 / 等待
  text [字数]                   打印页面正文
  ask 帮我找到登录入口          让大模型理解页面并生成动作，确认后执行
  ask! 帮我点击搜索             让大模型生成动作并直接执行，仍会拦截敏感点击
  agent 帮我完成上传简历        像智能体一样循环：观察、规划、执行、再观察，每一步确认
  agent! 帮我完成上传简历       自动循环执行普通动作，敏感点击仍会二次确认
  roles                         查看可用角色
  role course                   切换到课设网站助手角色
  role-show                     查看当前角色 prompt
  role-save 名称 = prompt        保存一个新角色，并立即切换
  memory [数量]                  查看最近自动记忆
  cursor on/off                 开关页面里的可视化小鼠标
  human on/off                  开关观察演示模式：停顿、hover、高亮、小幅滚动
  pace fast/normal/slow         调整观察演示速度
  screenshot [路径]             保存截图
  quit                          退出
""".strip()
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Terminal controller for CloakBrowser CDP.")
    parser.add_argument("--cdp", default=os.environ.get("CLOAK_CDP", DEFAULT_CDP))
    parser.add_argument("--page", type=int, default=0)
    parser.add_argument("--browser", default=os.environ.get("CLOAK_BROWSER_EXE", str(DEFAULT_CLOAK_BINARY)))
    parser.add_argument("--no-auto-start", action="store_true", help="Do not auto-start CloakBrowser when CDP is closed.")
    parser.add_argument("--no-visual-cursor", action="store_true", help="Disable the in-page visual mouse cursor.")
    parser.add_argument("--no-humanize", action="store_true", help="Disable observation-friendly pauses/highlights/scroll wiggles.")
    parser.add_argument(
        "--confirm-dangerous-clicks",
        action="store_true",
        help="Require interactive confirmation for dangerous clicks (submit/delete/pay/send).",
    )
    parser.add_argument("--pace", choices=sorted(PACE_PRESETS), default="normal")
    parser.add_argument("--once", help="执行单条命令后退出，例如 --once observe")
    args = parser.parse_args()

    if args.once:
        once_command = args.once.strip().lower()
        if once_command == "version":
            print(VERSION)
            return 0
        if once_command in {"help", "h", "?"}:
            print_help()
            return 0

    try:
        with BrowserTerminal(
            args.cdp,
            args.page,
            auto_start=not args.no_auto_start,
            browser_path=args.browser,
            visual_cursor=not args.no_visual_cursor,
            humanize=not args.no_humanize,
            pace=args.pace,
            confirm_dangerous_clicks=bool(args.confirm_dangerous_clicks),
        ) as terminal:
            if args.once:
                terminal.run_command(args.once)
            else:
                terminal.repl()
    except Exception as error:
        print(f"启动失败：{error}")
        if "ECONNREFUSED" in str(error) or "connect" in str(error).lower():
            print()
            print("看起来 127.0.0.1:9222 没有浏览器调试服务。")
            print("请先运行：")
            print("  .\\start_cdp_browser.ps1")
            print()
            print("或者手动启动浏览器：")
            print('  "浏览器.exe" --remote-debugging-port=9222 --user-data-dir="C:\\path\\to\\profile"')
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
