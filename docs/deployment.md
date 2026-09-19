# Deployment & Systemd Guide

## Prerequisites

- AlmaLinux 9 or Linux x86_64
- Node.js 24 LTS
- Go 1.22+

## User-Space Deployment

Run the automated installer:
```bash
./scripts/install.sh
```

## Systemd User Service

Enable and start the user service:
```bash
systemctl --user enable eidolon
systemctl --user start eidolon
systemctl --user status eidolon
```

View runtime logs:
```bash
eidolon logs -n 100
journalctl --user -u eidolon -f
```
