"""Attribute each FLIP5 changed row to the single flag(s) that reproduce it. python3 -I attrib5.py <keepdir> <bisectdir> <flagsfile> <md> <out.json>"""
import json, sys, os, re, collections

keep, bis, flagsfile, md, out = sys.argv[1:6]
cwd = os.environ["GATE_TREE"].rstrip("/") + "/"


def statuses(path):
    d = json.load(open(path))
    s = {}
    for f in d["testResults"]:
        name = f["name"][len(cwd):] if f["name"].startswith(cwd) else f["name"]
        if not f["assertionResults"] and f["status"] == "failed":
            s[f"{name} :: (file failed to load)"] = "failed"
        for t in f["assertionResults"]:
            s[f"{name} :: {t['fullName']}"] = t["status"]
    return s


def records(path):
    r = {}
    if os.path.exists(path):
        for l in open(path):
            if l.strip():
                x = json.loads(l)
                r[f"{x['id']} [{x['mode']}]"] = x
    return r


shape = lambda x: json.dumps({"ok": x["ok"], "turns": x["turns"]}) if x else "absent"
off_s, on_s = statuses(f"{keep}/off-1.json"), statuses(f"{keep}/on-1.json")
off_r, on_r = records(f"{keep}/off-1.replay.jsonl"), records(f"{keep}/on-1.replay.jsonl")
flags = [l.strip() for l in open(flagsfile) if l.strip()]
solo = {f: (statuses(f"{bis}/{f}.json"), records(f"{bis}/{f}.jsonl")) for f in flags if os.path.exists(f"{bis}/{f}.json")}

rows = []
for l in open(md):
    if not l.startswith("| ") or l.startswith("| test |") or l.startswith("| ---"):
        continue
    cells = l.rstrip("\n").split(" | ")
    rows.append((cells[0][2:], cells[3]))

res = {}
for test, cat in rows:
    who = []
    if test.startswith("replay: "):
        key = test[len("replay: "):]
        base = shape(off_r.get(key))
        for f, (_, r) in solo.items():
            if key in r and shape(r[key]) != base:
                who.append(f)
        same_as_on = [f for f in who if shape(solo[f][1][key]) == shape(on_r.get(key))]
    else:
        base = off_s.get(test)
        for f, (s, _) in solo.items():
            if test in s and s[test] != base:
                who.append(f)
        same_as_on = [f for f in who if solo[f][0].get(test) == on_s.get(test)]
    res[test] = {"category": cat, "flags": who, "reproduces_on": same_as_on}
json.dump(res, open(out, "w"), indent=1)
c = collections.Counter()
for t, v in res.items():
    c[(v["category"], len(v["flags"]) == 0, tuple(v["flags"]) if len(v["flags"]) <= 2 else ("3+",))] += 1
for k, n in sorted(c.items(), key=lambda kv: -kv[1]):
    print(n, k)
print("solo runs present:", len(solo), "of", len(flags))
