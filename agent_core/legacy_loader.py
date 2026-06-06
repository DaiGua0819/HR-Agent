from __future__ import annotations

from pathlib import Path
from typing import MutableMapping


def load_legacy_agent(namespace: MutableMapping[str, object], source_file: str) -> None:
    """Execute the segmented legacy agent source in the caller namespace."""
    source_path = Path(source_file).resolve()
    parts_dir = source_path.with_name("agent_core") / "legacy_parts"
    parts = sorted(parts_dir.glob("agent_web_server.part*.py"))
    if not parts:
        raise RuntimeError(f"No legacy agent parts found in {parts_dir}")
    source = "\n".join(part.read_text(encoding="utf-8") for part in parts)
    exec(compile(source, str(source_path), "exec"), namespace, namespace)
