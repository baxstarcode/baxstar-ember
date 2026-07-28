#!/usr/bin/env bash
# Launch the Ember local preview.
# Requirements: python3 only (NO Node/npm needed).
# Assets under assets/ember/** load because the server roots at this folder.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${1:-8787}"

# Regenerate the preview from src/ first, so what you look at is never stale.
# A stale generated file is exactly how the deploy build once drifted an entire
# redesign behind the source.
python3 scripts/sync-standalone.py

echo "Ember preview  ->  http://localhost:${PORT}/_preview.html"
echo "(Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
