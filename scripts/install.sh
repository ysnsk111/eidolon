#!/usr/bin/env bash
set -e

echo "=== EIDOLON v1.0.0 User-Space Installation ==="

# Ensure running as user
USER_NAME=$(whoami)
echo "Installing for user: ${USER_NAME}"

# 1. Install NPM dependencies
echo "[1/4] Installing Node.js dependencies..."
npm install

# 2. Compile Go Persistent Runtime
echo "[2/4] Compiling Go server binary..."
mkdir -p bin
cd server
go build -o ../bin/eidolon-server ./cmd/eidolon-server
cd ..

# 3. Global user link / install
echo "[3/4] Linking global CLI for current user..."
npm link

# 4. Initialize user config directory and database
echo "[4/4] Initializing local database and config..."
eidolon init

# Setup systemd user service if systemd is available
if command -v systemctl >/dev/null 2>&1; then
    USER_SYSTEMD_DIR="${HOME}/.config/systemd/user"
    mkdir -p "${USER_SYSTEMD_DIR}"
    cp scripts/eidolon.service "${USER_SYSTEMD_DIR}/eidolon.service"
    systemctl --user daemon-reload || true
    echo "✔ systemd user unit installed to ${USER_SYSTEMD_DIR}/eidolon.service"
fi

echo "=== EIDOLON Installation Complete ==="
echo "Run 'eidolon --help' to get started."
