from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import hmac
import secrets

N = 2**14
R = 8
P = 1
DKLEN = 32


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    if len(password) < 12:
        raise ValueError("password must be at least 12 characters")
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=N, r=R, p=P, dklen=DKLEN)
    return "$".join(("scrypt", str(N), str(R), str(P), salt.hex(), derived.hex()))


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, raw_n, raw_r, raw_p, raw_salt, raw_derived = encoded.split("$")
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(raw_salt),
            n=int(raw_n),
            r=int(raw_r),
            p=int(raw_p),
            dklen=len(bytes.fromhex(raw_derived)),
        )
        return hmac.compare_digest(derived.hex(), raw_derived)
    except (ValueError, TypeError):
        return False


def decode_basic(header: str) -> tuple[str, str] | None:
    if not header.startswith("Basic "):
        return None
    try:
        value = base64.b64decode(header[6:], validate=True).decode("utf-8")
        return tuple(value.split(":", 1)) if ":" in value else None
    except (ValueError, UnicodeDecodeError):
        return None


def password_cli() -> None:
    parser = argparse.ArgumentParser(description="Generate a TermDock scrypt password hash")
    parser.add_argument("--password-stdin", action="store_true", help="read the password from standard input")
    args = parser.parse_args()
    password = getpass.getpass("Password: ") if not args.password_stdin else __import__("sys").stdin.readline().rstrip("\n")
    print(hash_password(password))
