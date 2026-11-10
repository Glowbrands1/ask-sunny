#!/bin/bash
# exit 0 = good (surname kept and s14 date kept), 1 = bad, 125 = skip
[ -e node_modules ] || ln -s /home/user/ask-sunny/node_modules node_modules
git checkout -q 80ca35c9 -- evals/flags.json 2>/dev/null
timeout 900 npx vitest run --config vitest.eval.config.mts evals/replay.eval.ts -t "(sf-s4|s14) flags" >/dev/null 2>&1
git checkout -q HEAD -- evals/flags.json 2>/dev/null
python3 - <<'PY'
import json,sys
try: r=json.load(open('evals/results/latest.json'))
except Exception: sys.exit(125)
c={x['id']:x.get('card') or {} for x in r['off']}
print("BISECT", c.get('sf-s4'), c.get('s14'))
ok = (c.get('sf-s4',{}).get('employee')=='Odalys Merriwether') and (c.get('s14',{}).get('date')=='2026-10-01')
sys.exit(0 if ok else 1)
PY
