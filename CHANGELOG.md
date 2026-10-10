# Changelog

All notable changes to TermDock are documented here.

## 1.0.1 — 2026-10-10

- Added explicit two-finger terminal-history scrolling for touch devices while preserving one-finger terminal interaction.
- Made the phone layout track the visual viewport so the active terminal stays fitted above Android's on-screen keyboard.
- Compacted nonessential helper text automatically on short keyboard-sized viewports.

## 1.0.0 — 2026-10-10

- Initial public release.
- Persistent, server-saved browser tabs backed by independent tmux sessions.
- Instant switching among connected views with Alt+1–9 and Alt+0.
- Automatic creation and focus of missing numbered tabs.
- Built-in scrypt-backed HTTP authentication and same-origin mutation checks.
- Loopback-only ttyd backend behind an authenticated aiohttp HTTP/WebSocket proxy.
- Strict tab-ID validation and fixed, argument-safe SSH launcher.
- Interactive per-user installer, hardened systemd unit, tests, and documentation.
