#!/usr/bin/env bash
set -e

echo "=== EIDOLON Uninstallation ==="

# Stop service
if command -v systemctl >/dev/null 2>&1; then
    systemctl --user stop eidolon || true
    systemctl --user disable eidolon || true
    rm -f "${HOME}/.config/systemd/user/eidolon.service"
    systemctl --user daemon-reload || true
fi

# Stop daemon if running
if command -v eidolon >/dev/null 2>&1; then
    eidolon service stop || true
fi

# Unlink npm package
echo "Unlinking global npm CLI..."
npm unlink -g eidolon || npm rm -g eidolon || true

echo "EIDOLON uninstalled. (User data in ~/.config/eidolon preserved)"
