from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any


class TabStore:
    def __init__(self, state_dir: Path, tmux_bin: str, socket: str, prefix: str) -> None:
        self.state_dir = state_dir
        self.registry_path = state_dir / "tabs.json"
        self.tmux_bin = tmux_bin
        self.socket = socket
        self.prefix = prefix
        self.lock = asyncio.Lock()

    def _tab_id(self, session: str) -> str | None:
        if session == self.prefix:
            return "main"
        match = re.fullmatch(re.escape(self.prefix) + r"-([a-f0-9]{12})", session)
        return match.group(1) if match else None

    def session_name(self, tab_id: str) -> str:
        if tab_id == "main":
            return self.prefix
        if not re.fullmatch(r"[a-f0-9]{12}", tab_id):
            raise ValueError("invalid terminal tab")
        return f"{self.prefix}-{tab_id}"

    def _load(self) -> dict[str, Any]:
        try:
            value = json.loads(self.registry_path.read_text("utf-8"))
            if isinstance(value, dict) and isinstance(value.get("tabs"), dict):
                return value
        except (OSError, json.JSONDecodeError):
            pass
        return {"tabs": {}}

    def _save(self, value: dict[str, Any]) -> None:
        self.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = self.registry_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value, indent=2) + "\n", "utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.registry_path)

    async def _tmux(self, *arguments: str) -> tuple[int, str, str]:
        process = await asyncio.create_subprocess_exec(
            self.tmux_bin, "-L", self.socket, *arguments,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=8)
        return process.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace")

    async def list(self) -> list[dict[str, Any]]:
        async with self.lock:
            registry = self._load()
            live: dict[str, dict[str, int]] = {}
            code, stdout, _ = await self._tmux(
                "list-sessions", "-F", "#{session_name}\t#{session_created}\t#{session_activity}\t#{session_attached}"
            )
            if code == 0:
                for line in stdout.splitlines():
                    parts = line.split("\t")
                    tab_id = self._tab_id(parts[0]) if len(parts) == 4 else None
                    if tab_id:
                        live[tab_id] = {"created_at": int(parts[1]), "activity_at": int(parts[2]), "viewers": int(parts[3])}
            now = int(time.time())
            all_ids = set(live) | {"main"}
            for tab_id, item in registry["tabs"].items():
                valid = tab_id == "main" or bool(re.fullmatch(r"[a-f0-9]{12}", tab_id))
                if valid and (tab_id in live or now - int(item.get("created_at", 0)) < 90):
                    all_ids.add(tab_id)
            order = {tab_id: index for index, tab_id in enumerate(registry["tabs"])}
            ordered = sorted(all_ids, key=lambda tab_id: (
                0 if tab_id == "main" else 1,
                int(registry["tabs"].get(tab_id, {}).get("created_at", live.get(tab_id, {}).get("created_at", now))),
                order.get(tab_id, len(order)), tab_id,
            ))
            result = []
            for index, tab_id in enumerate(ordered, 1):
                saved, state = registry["tabs"].get(tab_id, {}), live.get(tab_id, {})
                result.append({
                    "id": tab_id,
                    "name": str(saved.get("name") or f"Terminal {index}")[:48],
                    "created_at": int(saved.get("created_at") or state.get("created_at") or now),
                    "activity_at": int(state.get("activity_at") or 0),
                    "viewers": int(state.get("viewers") or 0),
                    "running": tab_id in live,
                })
            return result

    async def create(self) -> dict[str, Any]:
        async with self.lock:
            registry = self._load()
            # Avoid nesting the lock by deriving the next number from saved names.
            numbers = [int(match.group(1)) for item in registry["tabs"].values()
                       if (match := re.fullmatch(r"Terminal (\d+)", str(item.get("name", ""))))]
            tab_id = uuid.uuid4().hex[:12]
            number = max([1, *numbers]) + 1
            item = {"name": f"Terminal {number}", "created_at": int(time.time())}
            registry["tabs"][tab_id] = item
            self._save(registry)
            return {"id": tab_id, **item, "activity_at": 0, "viewers": 0, "running": False}

    async def delete(self, tab_id: str) -> None:
        session = self.session_name(tab_id)
        async with self.lock:
            code, _, stderr = await self._tmux("kill-session", "-t", session)
            lowered = stderr.lower()
            if code and "can't find session" not in lowered and "no server running" not in lowered:
                raise RuntimeError(stderr.strip() or "unable to close terminal tab")
            registry = self._load()
            registry["tabs"].pop(tab_id, None)
            self._save(registry)

    async def selection(self, tab_id: str) -> str:
        session = self.session_name(tab_id)
        prefix = f"termdock-{session}-"
        async with self.lock:
            code, names, stderr = await self._tmux("list-buffers", "-F", "#{buffer_name}")
            buffer_name = next((name for name in names.splitlines() if name.startswith(prefix)), "")
            if code == 0 and buffer_name:
                code, stdout, stderr = await self._tmux("save-buffer", "-b", buffer_name, "-")
            else:
                stdout = ""
        if code:
            lowered = stderr.lower()
            if "no buffer" in lowered or "can't find buffer" in lowered:
                return ""
            raise RuntimeError(stderr.strip() or "unable to read terminal selection")
        if len(stdout.encode("utf-8")) > 4 * 1024 * 1024:
            raise RuntimeError("terminal selection is too large to copy")
        return stdout if buffer_name else ""
