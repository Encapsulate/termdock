#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "TermDock currently supports Linux hosts with systemd user services." >&2
  exit 1
fi

missing=()
for command in python3 tmux ttyd ssh ssh-keygen; do
  command -v "$command" >/dev/null 2>&1 || missing+=("$command")
done

if ((${#missing[@]})); then
  echo "Missing required commands: ${missing[*]}"
  if command -v apt-get >/dev/null 2>&1; then
    read -r -p "Install tmux, ttyd, OpenSSH client, and Python venv support with apt? [Y/n] " answer
    if [[ ! "${answer:-Y}" =~ ^[Nn]$ ]]; then
      sudo apt-get update
      sudo apt-get install -y python3-venv tmux ttyd openssh-client
    else
      exit 1
    fi
  else
    echo "Install Python 3.10+, tmux, ttyd 1.7+, and OpenSSH, then rerun ./install.sh." >&2
    exit 1
  fi
fi

exec python3 "$project_dir/scripts/install.py" --project-dir "$project_dir" "$@"
