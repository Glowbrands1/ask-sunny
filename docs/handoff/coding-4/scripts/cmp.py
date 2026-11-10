import json, sys
def load(p):
    out = {}
    for line in open(p):
        r = json.loads(line); out[(r["id"], r["mode"])] = (r["ok"], r["error"], r["turns"], r.get("rows"), r.get("systems"))
    return out
a, b = load(sys.argv[1]), load(sys.argv[2])
diff = [k for k in a if a[k] != b.get(k)]
missing = [k for k in b if k not in a]
writes = sum(1 for v in a.values() if v[3] and any(v[3].values()))
print(f"runs {len(a)}/{len(b)}, turns {sum(len(v[2]) for v in a.values())}, runs-with-writes {writes}, differing {len(diff)}, extra {len(missing)}")
for k in diff[:5]: print("  DIFF", k)
