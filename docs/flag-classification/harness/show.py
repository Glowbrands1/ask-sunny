import json,sys
d,ids=sys.argv[1],sys.argv[2:]
def load(m): return {(r['id'],r['mode']):r for r in map(json.loads,open(f'{d}/{m}-1.replay.jsonl')) }
off,on=load('off'),load('on')
for i in ids:
    k=(i,'production')
    for name,src in (('OFF',off),('ON',on)):
        r=src.get(k); print(f'--- {i} {name} ok={r and r["ok"]}')
        for t in (r['turns'] if r else []):
            print('  Q:',t['question'][:200].replace('\n',' / ')); print('  A:',t['reply'][:500].replace('\n',' / '), '| upd', t['updated'])
