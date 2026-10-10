#!/usr/bin/env bash
set -euo pipefail

systemctl --user disable --now termdock.service 2>/dev/null || true
rm -f -- "$HOME/.config/systemd/user/termdock.service"
systemctl --user daemon-reload

echo "TermDock service and application can now be removed safely."
echo "Private configuration and state were intentionally preserved:"
echo "  $HOME/.config/termdock"
echo "  $HOME/.local/state/termdock"
echo "  $HOME/.local/share/termdock"
echo "Delete those directories manually only if you no longer need their keys, settings, or tab registry."
