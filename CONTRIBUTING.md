# Contributing

Thank you for improving TermDock.

1. Open an issue before a large behavioral or security change.
2. Create a focused branch and keep commits reviewable.
3. Install the development environment with `python -m pip install -e '.[test]'`.
4. Run `python -m compileall -q src tests scripts` and `pytest`.
5. Exercise the real browser UI when changing tabs, focus, proxying, or WebSockets.
6. Never commit credentials, keys, terminal output, hostnames, usernames, state
   files, or an installed `termdock.env`.

Security issues belong in a private vulnerability report, as described in
[SECURITY.md](SECURITY.md), rather than a public issue.
