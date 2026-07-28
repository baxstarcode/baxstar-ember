#!/usr/bin/env bash
# Launch the Ember local preview.
# Requirements: python3 only (NO Node/npm needed).
# Assets under assets/ember/** load because the server roots at this folder.
cd "$(dirname "$0")"
PORT="${1:-8787}"
echo "Ember preview  ->  http://localhost:${PORT}/_preview.html"
echo "(Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
