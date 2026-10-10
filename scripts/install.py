#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import os
import pwd
import shutil
import socket
import subprocess
import venv
from pathlib import Path


def ask(env_name: str, prompt: str, default: str) -> str:
    if env_name in os.environ:
        return os.environ[env_name].strip()
    value = input(f"{prompt} [{default}]: ").strip()
    return value or default


def env_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_private(path: Path, content: str) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, "utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)


def create_local_key(identity: Path, ssh_user: str) -> None:
    current = pwd.getpwuid(os.getuid()).pw_name
    if ssh_user != current:
        raise SystemExit("Automatic localhost key setup is only available for the current OS user.")
    identity.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "termdock-local", "-f", str(identity)], check=True)
    public_key = identity.with_suffix(identity.suffix + ".pub").read_text("utf-8").strip()
    ssh_dir = Path.home() / ".ssh"
    authorized = ssh_dir / "authorized_keys"
    ssh_dir.mkdir(mode=0o700, exist_ok=True)
    line = f'from="127.0.0.1,::1",no-agent-forwarding,no-port-forwarding,no-X11-forwarding {public_key}'
    existing = authorized.read_text("utf-8") if authorized.exists() else ""
    if public_key not in existing:
        with authorized.open("a", encoding="utf-8") as handle:
            if existing and not existing.endswith("\n"):
                handle.write("\n")
            handle.write(line + "\n")
    authorized.chmod(0o600)


def main() -> None:
    home = Path.home()
    parser = argparse.ArgumentParser(description="Install TermDock for the current Linux user")
    parser.add_argument("--project-dir", type=Path, required=True)
    parser.add_argument("--prefix", type=Path, default=home / ".local/share/termdock")
    parser.add_argument("--config-dir", type=Path, default=home / ".config/termdock")
    parser.add_argument("--state-dir", type=Path, default=home / ".local/state/termdock")
    parser.add_argument("--systemd-dir", type=Path, default=home / ".config/systemd/user")
    parser.add_argument("--no-start", action="store_true", help="write files but do not enable/start systemd")
    args = parser.parse_args()

    for command in ("tmux", "ttyd", "ssh", "ssh-keygen"):
        if not shutil.which(command):
            raise SystemExit(f"Required command not found: {command}")

    username = ask("TERMDOCK_SETUP_WEB_USERNAME", "Web login username", getpass.getuser())
    password = os.environ.get("TERMDOCK_SETUP_WEB_PASSWORD")
    if password is None:
        password = getpass.getpass("Web login password (12+ characters): ")
        if password != getpass.getpass("Confirm web login password: "):
            raise SystemExit("Passwords did not match.")
    if len(password) < 12:
        raise SystemExit("Web login password must be at least 12 characters.")

    ssh_host = ask("TERMDOCK_SETUP_SSH_HOST", "SSH host", "127.0.0.1")
    ssh_port = ask("TERMDOCK_SETUP_SSH_PORT", "SSH port", "22")
    ssh_user = ask("TERMDOCK_SETUP_SSH_USER", "SSH user", getpass.getuser())
    default_identity = args.config_dir / "ssh/id_ed25519" if ssh_host in {"127.0.0.1", "localhost", "::1"} else home / ".ssh/id_ed25519"
    identity = Path(ask("TERMDOCK_SETUP_SSH_IDENTITY", "SSH private-key path", str(default_identity))).expanduser().resolve()
    if ssh_host in {"127.0.0.1", "localhost", "::1"}:
        try:
            with socket.create_connection((ssh_host, int(ssh_port)), timeout=2):
                pass
        except (OSError, ValueError) as exc:
            raise SystemExit(
                "No local SSH server is reachable at the configured address.\n"
                "On Ubuntu/Debian run: sudo apt install openssh-server && sudo systemctl enable --now ssh"
            ) from exc
    if not identity.exists():
        if ssh_host not in {"127.0.0.1", "localhost", "::1"}:
            raise SystemExit(f"SSH key does not exist: {identity}\nCreate/authorize the key on the remote host, then rerun the installer.")
        create_local_key(identity, ssh_user)

    args.prefix.mkdir(mode=0o700, parents=True, exist_ok=True)
    args.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    (args.state_dir / "tmux").mkdir(mode=0o700, exist_ok=True)
    venv_dir = args.prefix / "venv"
    if not (venv_dir / "bin/python").exists():
        venv.EnvBuilder(with_pip=True).create(venv_dir)
    subprocess.run([
        str(venv_dir / "bin/python"), "-m", "pip", "install",
        "--disable-pip-version-check", "--upgrade", "pip>=26.2,<27", "setuptools>=77",
    ], check=True)
    subprocess.run([str(venv_dir / "bin/python"), "-m", "pip", "install", "--disable-pip-version-check", str(args.project_dir.resolve())], check=True)
    password_hash = subprocess.run(
        [str(venv_dir / "bin/termdock-password"), "--password-stdin"],
        input=password + "\n", text=True, capture_output=True, check=True,
    ).stdout.strip()

    env_path = args.config_dir / "termdock.env"
    values = {
        "TERMDOCK_HOST": "127.0.0.1",
        "TERMDOCK_PORT": "8022",
        "TERMDOCK_TTYD_PORT": "8023",
        "TERMDOCK_STATE_DIR": str(args.state_dir.resolve()),
        "TERMDOCK_WEB_USERNAME": username,
        "TERMDOCK_WEB_PASSWORD_HASH": password_hash,
        "TERMDOCK_SSH_HOST": ssh_host,
        "TERMDOCK_SSH_PORT": ssh_port,
        "TERMDOCK_SSH_USER": ssh_user,
        "TERMDOCK_SSH_IDENTITY_FILE": str(identity),
        "TERMDOCK_SSH_KNOWN_HOSTS_FILE": str((args.state_dir / "known_hosts").resolve()),
        "TERMDOCK_SESSION_PREFIX": "termdock",
        "TERMDOCK_TMUX_SOCKET": "termdock",
        "TMUX_TMPDIR": str((args.state_dir / "tmux").resolve()),
    }
    write_private(env_path, "\n".join(f"{key}={env_quote(value)}" for key, value in values.items()) + "\n")

    unit = f"""[Unit]
Description=TermDock persistent browser SSH workspaces
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile={env_path}
ExecStart={venv_dir / 'bin/termdock'}
Restart=on-failure
RestartSec=3
KillMode=process
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={args.state_dir}
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=true
RestrictSUIDSGID=true

[Install]
WantedBy=default.target
"""
    unit_path = args.systemd_dir / "termdock.service"
    unit_path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    unit_path.write_text(unit, "utf-8")

    if not args.no_start:
        subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "--user", "enable", "--now", "termdock.service"], check=True)
        print("\nTermDock is running at http://127.0.0.1:8022")
    else:
        print(f"\nInstallation staged. Service unit: {unit_path}")
    print(f"Private configuration: {env_path}")
    print(f"Persistent state: {args.state_dir}")


if __name__ == "__main__":
    main()
