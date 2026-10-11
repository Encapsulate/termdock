# Changelog

All notable changes to TermDock are documented here.

## 1.0.5 — 2026-10-10

- Fixed the phone-specific gap in 1.0.4 by translating one-finger terminal drags into persistent xterm selections.
- Preserved one-finger taps for terminal focus and interactive applications while keeping two-finger history scrolling unchanged.
- Suppressed compatibility mouse events after touch selection so releasing a finger cannot immediately clear the highlight.

## 1.0.4 — 2026-10-10

- Made ordinary mouse drags create persistent, browser-native xterm selections even while tmux mouse support is enabled.
- Preserved un-dragged mouse clicks for interactive terminal applications.
- Added a compact Copy key that copies the active terminal selection, including from phone and tablet browsers.

## 1.0.3 — 2026-10-10

- Increased both xterm and tmux history limits from their small defaults to 100,000 lines.
- Enabled tmux mouse support and reserved wheel-up for pane scrollback, even when an inner full-screen chat or TUI has enabled mouse reporting.
- Routed two-finger phone gestures through the same tmux scrollback path as a mouse wheel.
- Scrolling to the bottom exits copy mode automatically and returns control to the running program.

## 1.0.2 — 2026-10-10

- Added a permanent compact Ctrl, Alt, Tab, and Clear key bar directly below the terminal.
- Ctrl and Alt latch visibly for the next physical or software-keyboard input and then reset.
- Tab sends a terminal Tab key; Clear sends Ctrl+L without ending or recreating the session.
- Key-bar taps preserve xterm focus to avoid dismissing the Android software keyboard.

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
