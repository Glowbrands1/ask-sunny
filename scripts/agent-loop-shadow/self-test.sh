#!/usr/bin/env bash
# The shadow replay's self-test (dev only): the 3 INVENTED conversations in selftest-input.jsonl, through run.sh with the
# scripted stand-in model (SHADOW_STANDIN=1: no API key, no live calls), then summary.py, with its numbers checked.
#   scripts/agent-loop-shadow/self-test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
SHADOW_STANDIN=1 SHADOW_IN="$here/selftest-input.jsonl" SHADOW_OUT="$tmp/out.jsonl" "$here/run.sh" 1
python3 "$here/summary.py" "$tmp/out.jsonl"
python3 "$here/summary.py" "$tmp/out.jsonl" --json > "$tmp/rows.jsonl"
python3 - "$tmp/rows.jsonl" <<'PY'
import json, sys
rows = {row["conv"]: row for row in map(json.loads, open(sys.argv[1]))}
assert set(rows) == {"selftest-ca", "selftest-coaching", "selftest-off-roster"}, rows.keys()
for conv in ("selftest-ca", "selftest-coaching"):
    row = rows[conv]
    assert row["error"] is None and row["card"], row
    # The stand-in names no policy: every other field matches the invented truth.
    assert row["fields"] == {"template": True, "employee": True, "date": True, "level": True, "policy": False}, row
    assert row["overlap"] is not None and row["overlap"] >= 0.7, row
    assert row["guards"] == [], row
    assert row["loop"] and row["loop"]["model_calls"] > 0, row
assert rows["selftest-off-roster"]["fields"] is None and not rows["selftest-off-roster"]["card"], rows["selftest-off-roster"]
print("self-test OK")
PY
