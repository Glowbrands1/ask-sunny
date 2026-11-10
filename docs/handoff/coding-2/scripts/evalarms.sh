#!/bin/bash
S=/tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad
cd $S/wt/ask-sunny-r22eval
cp src/config/production-flags.json $S/pf-eval.bak
for arm in ALL FORM_NAME_FROM_ROSTER_ENABLED ROSTER_NEAR_MISS_ENABLED ROSTER_NAME_IN_CANDIDATE_ENABLED ROSTER_COMPOUND_SURNAME_ENABLED ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED SLOT_NAME_ON_FORM_REQUEST_ENABLED NEAR_MISS_QUESTION_RULES_ENABLED NEAR_MISS_DETAILS_ACCEPT_ENABLED FORM_NAME_OFF_ROSTER_ASK_ENABLED; do
  cp $S/pf-eval.bak src/config/production-flags.json
  python3 - "$arm" <<'PY'
import json,sys
p="src/config/production-flags.json"; d=json.load(open(p)); d["on"]=[f for f in d["on"] if f!=sys.argv[1]]; json.dump(d,open(p,"w"),indent=2)
PY
  rm -f evals/results/latest.json
  line=$(timeout 900 npx vitest run --config vitest.eval.config.mts evals/replay.eval.ts 2>&1 | grep -E "^\s+Tests " | tail -1)
  python3 - "$arm" "$line" <<'PY'
import json,sys
try:
  r=json.load(open("evals/results/latest.json")); off=r["off"]; c={x["id"]:x for x in off}
  b={x["id"]:x for x in json.load(open("evals/baseline.json"))["cases"]}
  flips=[i for i in c if i in b and c[i]["pass"]!=b[i]["pass"]]
  print("ARM", sys.argv[1], "|", sys.argv[2].strip(), "| off pass", sum(x["pass"] for x in off), "/", len(off), "| vs baseline pass flips:", flips, "| sf-s4:", c["sf-s4"]["card"]["employee"], "| s14 date:", c["s14"]["card"]["date"], flush=True)
except Exception as e: print("ARM", sys.argv[1], "ERR", e, flush=True)
PY
done
cp $S/pf-eval.bak src/config/production-flags.json
echo EVALARMS-DONE
