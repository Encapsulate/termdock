import pytest

from termdock.launcher import command_from_env, session_name


def test_session_names_are_strict() -> None:
    assert session_name("termdock", "main") == "termdock"
    assert session_name("termdock", "abcdef012345") == "termdock-abcdef012345"
    with pytest.raises(ValueError):
        session_name("termdock", "../../shell")


def test_ssh_command_is_argument_safe(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    values = {
        "TERMDOCK_SESSION_PREFIX": "termdock",
        "TERMDOCK_TMUX_BIN": "/usr/bin/tmux",
        "TERMDOCK_TMUX_SOCKET": "termdock",
        "TERMDOCK_SSH_BIN": "/usr/bin/ssh",
        "TERMDOCK_SSH_USER": "alice",
        "TERMDOCK_SSH_HOST": "host.example",
        "TERMDOCK_SSH_PORT": "2222",
        "TERMDOCK_SSH_IDENTITY_FILE": str(tmp_path / "key"),
        "TERMDOCK_SSH_KNOWN_HOSTS_FILE": str(tmp_path / "known_hosts"),
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    command = command_from_env("abcdef012345")
    assert command[-1] == "alice@host.example"
    assert command[:7] == ["/usr/bin/tmux", "-L", "termdock", "new-session", "-A", "-s", "termdock-abcdef012345"]
    assert "BatchMode=yes" in command
