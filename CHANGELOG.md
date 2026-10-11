# Changelog

All notable changes to TermDock are documented here.

## 1.0.10 — 2026-10-11

- Added permanent compact Arrow Up and Arrow Down buttons immediately after Clear in the terminal toolbar.
- Arrow buttons emit real terminal keyboard events, preserve xterm focus, and honor any active Ctrl, Alt, or Shift latch.
- Expanded the Android keyboard-open terminal by hiding the header/help, removing outer margins, and compacting the tab strip while retaining tabs and terminal keys.

## 1.0.9 — 2026-10-10

- Replaced Android's inconsistent Shift+mouse touch bridge with direct xterm cell-range selection for one-finger drags.
- Retained and restored the exact xterm selection after touch release so compatibility events cannot immediately clear the highlight.
- Made Copy read xterm's retained selection directly before falling back to browser or server-backed selections.

## 1.0.8 — 2026-10-10

- Cached retained tmux selections immediately after mouse release so Copy and Ctrl+Shift+C can write the clipboard during the original trusted browser gesture without a blocking request.
- Fixed Ctrl+Shift+V after a retained selection by capturing the trusted paste, leaving tmux copy mode asynchronously, and replaying the exact text through xterm's terminal paste API.
- Replaced the blocking right-click request with a native tmux mouse binding, making terminal menu items clickable while JavaScript only suppresses the browser's unrelated context menu.
- Removed synchronous browser network requests from selection, paste, and right-click handling so a slow local service cannot freeze the page.

## 1.0.7 — 2026-10-10

- Fixed Copy on LAN HTTP origins where the modern Clipboard API is unavailable by selecting the retained text in a temporary textarea before invoking the legacy copy command.
- Added Ctrl+Shift+C as a terminal-aware copy shortcut that uses the same browser-selection and server-selection fallback chain as the Copy button.
- Tightened session-buffer matching so the main tab cannot accidentally read a similarly prefixed secondary tab's retained selection.

## 1.0.6 — 2026-10-10

- Added a tmux-level desktop fallback that keeps mouse-drag selections highlighted after release instead of running the default copy-and-cancel action.
- Applied the persistent mouse-release binding to both emacs and vi copy-mode key tables.
- Enabled tmux clipboard export so a completed fallback selection is copied without discarding its highlight.
- Removed the portal's synthetic desktop mouse-event bridge so real PC drags reach ttyd and tmux unchanged; the bridge remains limited to touch input.
- Added a server-backed Copy fallback that retrieves the current tab's retained tmux selection when no browser selection exists.
- Suppressed the browser context-menu popup inside the terminal without blocking right-button events from reaching the terminal.
- Added a Shift key beside Ctrl and Alt. A single click latches any modifier for the next key, a double-click locks it across keys, and pressing a locked modifier again releases it.

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
