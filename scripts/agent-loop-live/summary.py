"""The live sample's numbers for QA's report (dev only; see run.sh): pass/fail per case, calls, cache and cost per turn,
and the report bars over every turn. Outcome-vs-wording classification of the failures stays a person's call."""
import glob
import json
import re
import sys

PRICES = (5, 25, 0.5, 6.25)
out = sys.argv[1]
runs = [json.loads(line) for path in sorted(glob.glob(f"{out}/run-*.jsonl")) for line in open(path)]
failed_calls = [r for r in runs if "could not finish" in (r["error"] or "")]
valid = [r for r in runs if r not in failed_calls]
print(f"records {len(runs)}; model/API failures (the loop's 502) {len(failed_calls)}; valid {len(valid)}; exact pass {sum(r['ok'] for r in valid)}")

tokens = [0, 0, 0, 0]
turns = calls = 0
for r in valid:
    loop = r.get("loop")
    if not loop:
        continue
    turns += loop["turns"]
    calls += loop["model_calls"]
    tokens = [a + b for a, b in zip(tokens, loop["tokens"])]
if turns:
    uncached, output, read, write = tokens
    charged = sum(a * b for a, b in zip(tokens, PRICES)) / 1e6
    print(f"loop turns {turns}; model calls per turn {calls / turns:.2f}")
    print(f"per call: uncached {uncached / calls:.0f}, cache read {read / calls:.0f}, cache write {write / calls:.0f}, output {output / calls:.0f}")
    print(f"cache hit {read / max(uncached + read + write, 1):.0%}; cost per turn ${charged / turns:.4f} (no caching: ${((uncached + read + write) * 5 + output * 25) / 1e6 / turns:.4f}); total ${charged:.2f}")

CA = re.compile(r"\b(?:ca|c\.a\.|corrective|write[- ]?up|verbal|written warning)\b", re.I)
COACH = re.compile(r"\bcoach(?:ing)?\b", re.I)
bars = {"CA request -> CA card": [0, 0], "coaching request -> Coaching card": [0, 0], "Policy line has heading + page (or Other)": [0, 0], "level only when stated": [0, 0], "payroll only when stated": [0, 0]}
for r in valid:
    said = ""
    for t in r["turns"]:
        said += "\n" + t["question"]
        card = t.get("card")
        if card:
            if CA.search(t["question"]) and not COACH.search(t["question"]):
                bars["CA request -> CA card"][0] += 1
                bars["CA request -> CA card"][1] += card["template"] != "coaching"
            if COACH.search(t["question"]) and not CA.search(t["question"]):
                bars["coaching request -> Coaching card"][0] += 1
                bars["coaching request -> Coaching card"][1] += card["template"] != "dpoa"
            if card.get("level"):
                bars["level only when stated"][0] += 1
                bars["level only when stated"][1] += bool(re.search(card["level"] if card["level"] != "written" else r"written|write", said, re.I))
            if card.get("payroll"):
                bars["payroll only when stated"][0] += 1
                bars["payroll only when stated"][1] += bool(re.search(r"payroll|deduct", said, re.I))
        for line in t["reply"].split("\n"):
            m = re.match(r"\s*\*\*Policy:\*\*\s*(.*)", line)
            if m:
                bars["Policy line has heading + page (or Other)"][0] += 1
                bars["Policy line has heading + page (or Other)"][1] += bool(re.search(r"JBA Policy Manual p\.\d+", m.group(1)) or m.group(1).startswith("Other"))
for name, (n, ok) in bars.items():
    print(f"{name}: {ok}/{n}")
print("failures:")
for r in valid:
    if not r["ok"]:
        print(f"  {r['id']}: {(r['error'] or '')[:150]}")
