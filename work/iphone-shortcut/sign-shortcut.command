#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if [[ "$(uname -s)" != "Darwin" ]] || ! command -v shortcuts >/dev/null 2>&1; then
  echo "This signing step requires Apple's Shortcuts app on a Mac."
  exit 1
fi
# Sign only this blank template. Add the dedicated phone credentials after import.
for field_index in 1 2; do
  field_value="$(/usr/libexec/PlistBuddy -c "Print :WFWorkflowActions:$field_index:WFWorkflowActionParameters:WFTextActionText" Talk-to-Ember.unsigned.shortcut)"
  if [[ -n "$field_value" ]]; then
    echo "Refusing to sign a template containing credentials. Use the blank template from GitHub."
    exit 1
  fi
done
shortcuts sign --mode anyone --input Talk-to-Ember.unsigned.shortcut --output Talk-to-Ember.shortcut
open Talk-to-Ember.shortcut
