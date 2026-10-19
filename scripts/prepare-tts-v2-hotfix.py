#!/usr/bin/env python3
"""Prepare (never deploy) the narrow TTS repair for the recorded live Worker.

Usage: python scripts/prepare-tts-v2-hotfix.py PRIVATE_DOWNLOADED_WORKER OUTPUT_DIR
The input is Cloudflare's multipart GET /workers/scripts/ember-claude-proxy body.
Abort on any source drift; do not use the pending coordinator config for this fix.
"""
import hashlib
import json
import sys
from email.parser import BytesParser
from email.policy import default
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = "3d758b9c5f4eec96d7599efc4b71fd3150f420035a6dbc67e61a13bc6890ce25"
raw = Path(sys.argv[1]).read_bytes()
boundary = raw.splitlines()[0][2:]
message = BytesParser(policy=default).parsebytes(
    b'Content-Type: multipart/form-data; boundary="' + boundary + b'"\r\n\r\n' + raw)
parts = list(message.iter_parts())
if len(parts) != 1:
    raise SystemExit("Unexpected deployed module count; review the active Worker.")
source = parts[0].get_payload(decode=True).decode()
if hashlib.sha256(source.encode()).hexdigest() != EXPECTED:
    raise SystemExit("Deployed source changed; stop and reconcile before preparing a hotfix.")

def token_function(text):
    start = text.index("async function edgeGec(now) {")
    return text[start:text.index("\n}", start) + 2]

old_function = token_function(source)
new_function = token_function((ROOT / "proxy/cloudflare-worker.js").read_text())
old_version = 'const EDGE_TTS_VERSION = "1-143.0.3650.75";'
new_version = 'const EDGE_TTS_VERSION = "2-143.0.3650.75";'
prefix = 'import { edgeGecV2 } from "./edge-gec-v2.mjs";\n'
assert source.count(old_version) == source.count(old_function) == 1
candidate = prefix + source.replace(old_version, new_version).replace(old_function, new_function)
assert candidate.removeprefix(prefix).replace(new_version, old_version).replace(new_function, old_function) == source
helper = (ROOT / "proxy/vendor/edge-gec-v2.mjs").read_bytes()
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
output.chmod(0o700)
(output / "cloudflare-worker.mjs").write_text(candidate)
(output / "edge-gec-v2.mjs").write_bytes(helper)
(output / "manifest.json").write_text(json.dumps({
    "oldVersion": "6110e34c-2363-41c5-a5f6-fab751ecb717",
    "beforeSha256": EXPECTED,
    "afterSha256": hashlib.sha256(candidate.encode()).hexdigest(),
    "helperSha256": hashlib.sha256(helper).hexdigest(),
}, indent=2) + "\n")
print("Prepared: only the speech import, token function and protocol version changed.")
