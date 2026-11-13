#!/usr/bin/env bash
# Root startup script - forwards to accessmap/start.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/accessmap/start.sh" "$@"
