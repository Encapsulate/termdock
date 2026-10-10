from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


def _integer(name: str, default: int, minimum: int = 1, maximum: int = 65535) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _command(name: str, default: str) -> str:
    configured = os.environ.get(name, default)
    resolved = shutil.which(configured) if "/" not in configured else configured
    if not resolved or not Path(resolved).is_file():
        raise ValueError(f"{name} executable was not found: {configured}")
    return str(Path(resolved).resolve())


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    ttyd_port: int
    state_dir: Path
    web_username: str
    web_password_hash: str
    tmux_bin: str
    ttyd_bin: str
    ssh_bin: str
    ssh_host: str
    ssh_port: int
    ssh_user: str
    ssh_identity_file: Path
    ssh_known_hosts_file: Path
    session_prefix: str
    tmux_socket: str

    @classmethod
    def from_env(cls) -> Config:
        state = Path(os.environ.get("TERMDOCK_STATE_DIR", "~/.local/state/termdock")).expanduser().resolve()
        username = os.environ.get("TERMDOCK_WEB_USERNAME", "").strip()
        password_hash = os.environ.get("TERMDOCK_WEB_PASSWORD_HASH", "").strip()
        ssh_user = os.environ.get("TERMDOCK_SSH_USER", "").strip()
        identity = Path(os.environ.get("TERMDOCK_SSH_IDENTITY_FILE", "~/.ssh/id_ed25519")).expanduser().resolve()
        known_hosts = Path(os.environ.get("TERMDOCK_SSH_KNOWN_HOSTS_FILE", str(state / "known_hosts"))).expanduser().resolve()
        prefix = os.environ.get("TERMDOCK_SESSION_PREFIX", "termdock").strip()
        socket = os.environ.get("TERMDOCK_TMUX_SOCKET", "termdock").strip()
        if not username or not password_hash:
            raise ValueError("TERMDOCK_WEB_USERNAME and TERMDOCK_WEB_PASSWORD_HASH are required")
        if not ssh_user:
            raise ValueError("TERMDOCK_SSH_USER is required")
        if not identity.is_file():
            raise ValueError(f"SSH identity file was not found: {identity}")
        if not prefix.replace("-", "").replace("_", "").isalnum():
            raise ValueError("TERMDOCK_SESSION_PREFIX may contain only letters, numbers, hyphens, and underscores")
        if not socket.replace("-", "").replace("_", "").isalnum():
            raise ValueError("TERMDOCK_TMUX_SOCKET may contain only letters, numbers, hyphens, and underscores")
        return cls(
            host=os.environ.get("TERMDOCK_HOST", "127.0.0.1"),
            port=_integer("TERMDOCK_PORT", 8022),
            ttyd_port=_integer("TERMDOCK_TTYD_PORT", 8023),
            state_dir=state,
            web_username=username,
            web_password_hash=password_hash,
            tmux_bin=_command("TERMDOCK_TMUX_BIN", "tmux"),
            ttyd_bin=_command("TERMDOCK_TTYD_BIN", "ttyd"),
            ssh_bin=_command("TERMDOCK_SSH_BIN", "ssh"),
            ssh_host=os.environ.get("TERMDOCK_SSH_HOST", "127.0.0.1").strip(),
            ssh_port=_integer("TERMDOCK_SSH_PORT", 22),
            ssh_user=ssh_user,
            ssh_identity_file=identity,
            ssh_known_hosts_file=known_hosts,
            session_prefix=prefix,
            tmux_socket=socket,
        )

    def launcher_environment(self) -> dict[str, str]:
        return {
            "TERMDOCK_TMUX_BIN": self.tmux_bin,
            "TERMDOCK_SSH_BIN": self.ssh_bin,
            "TERMDOCK_SSH_HOST": self.ssh_host,
            "TERMDOCK_SSH_PORT": str(self.ssh_port),
            "TERMDOCK_SSH_USER": self.ssh_user,
            "TERMDOCK_SSH_IDENTITY_FILE": str(self.ssh_identity_file),
            "TERMDOCK_SSH_KNOWN_HOSTS_FILE": str(self.ssh_known_hosts_file),
            "TERMDOCK_SESSION_PREFIX": self.session_prefix,
            "TERMDOCK_TMUX_SOCKET": self.tmux_socket,
        }
