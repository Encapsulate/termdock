from __future__ import annotations

import os
import re
import sys
from importlib.resources import files

TAB_ID = re.compile(r"[a-f0-9]{12}")


def session_name(prefix: str, tab_id: str) -> str:
    if tab_id == "main":
        return prefix
    if not TAB_ID.fullmatch(tab_id):
        raise ValueError("invalid terminal tab identifier")
    return f"{prefix}-{tab_id}"


def command_from_env(tab_id: str) -> list[str]:
    prefix = os.environ.get("TERMDOCK_SESSION_PREFIX", "termdock")
    session = session_name(prefix, tab_id)
    tmux = os.environ.get("TERMDOCK_TMUX_BIN", "tmux")
    ssh = os.environ.get("TERMDOCK_SSH_BIN", "ssh")
    tmux_config = str(files("termdock").joinpath("tmux.conf"))
    target = f"{os.environ['TERMDOCK_SSH_USER']}@{os.environ['TERMDOCK_SSH_HOST']}"
    return [
        tmux, "-L", os.environ.get("TERMDOCK_TMUX_SOCKET", "termdock"), "-f", tmux_config,
        "new-session", "-A", "-s", session,
        ssh, "-tt", "-p", os.environ.get("TERMDOCK_SSH_PORT", "22"),
        "-i", os.environ["TERMDOCK_SSH_IDENTITY_FILE"],
        "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
        "-o", "PreferredAuthentications=publickey",
        "-o", f"UserKnownHostsFile={os.environ['TERMDOCK_SSH_KNOWN_HOSTS_FILE']}",
        "-o", "StrictHostKeyChecking=accept-new", target,
    ]


def main() -> None:
    tab_id = sys.argv[1] if len(sys.argv) == 2 else "main"
    try:
        command = command_from_env(tab_id)
    except (KeyError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    os.execv(command[0], command)


if __name__ == "__main__":
    main()
