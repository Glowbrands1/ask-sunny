#!/usr/bin/env bash
# The shadow replay's self-test (dev only): the 3 INVENTED conversations in selftest-input.jsonl (the third uses the
# shared roster selftest-roster.json; the second's truth is a "values" map), through run.sh with the
# scripted stand-in model (SHADOW_STANDIN=1: no API key, no live calls), then summary.py, with its numbers checked.
#   scripts/agent-loop-shadow/self-test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
SHADOW_STANDIN=1 SHADOW_IN="$here/selftest-input.jsonl" SHADOW_ROSTER="$here/selftest-roster.json" SHADOW_OUT="$tmp/out.jsonl" "$here/run.sh" 1
python3 "$here/summary.py" "$tmp/out.jsonl"
python3 "$here/summary.py" "$tmp/out.jsonl" --json > "$tmp/rows.jsonl"
PYTHONDONTWRITEBYTECODE=1 python3 - "$tmp/rows.jsonl" "$here" <<'PY'
import json, sys
sys.path.insert(0, sys.argv[2])
from summary import compare, truth_levels, truth_policy
# truth.values (QA): policy and level read from the saved form's fields when "policy" / "warning_type" are absent.
values_truth = {"values": {"policy_violated": "Attendance", "warning_type": "verbal"}}
assert truth_policy(values_truth) == "Attendance" and truth_levels(values_truth) == ["verbal"]
assert compare({"template": "dpoa", "employee": "A B", "date": None, "level": "verbal", "policy": "Attendance — read from this request."}, values_truth)["policy"] is True
assert compare({"level": "written", "policy": "Attendance"}, values_truth)["level"] is False
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
