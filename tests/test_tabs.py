import asyncio
import json
from pathlib import Path

from termdock.tabs import TabStore


def test_registry_permissions_and_stable_order(tmp_path: Path) -> None:
    fake_tmux = tmp_path / "tmux"
    fake_tmux.write_text("#!/bin/sh\nexit 1\n", "utf-8")
    fake_tmux.chmod(0o755)
    store = TabStore(tmp_path / "state", str(fake_tmux), "test-socket", "termdock")

    async def exercise() -> None:
        first = await store.create()
        second = await store.create()
        tabs = await store.list()
        assert [tab["id"] for tab in tabs] == ["main", first["id"], second["id"]]
        assert [tab["name"] for tab in tabs] == ["Terminal 1", "Terminal 2", "Terminal 3"]

    asyncio.run(exercise())
    assert (store.registry_path.stat().st_mode & 0o777) == 0o600
    saved = json.loads(store.registry_path.read_text("utf-8"))
    assert len(saved["tabs"]) == 2


def test_invalid_delete_never_reaches_tmux(tmp_path: Path) -> None:
    store = TabStore(tmp_path, "/bin/false", "test-socket", "termdock")
    async def exercise() -> None:
        try:
            await store.delete("../../bad")
        except ValueError:
            return
        raise AssertionError("invalid identifier was accepted")
    asyncio.run(exercise())
