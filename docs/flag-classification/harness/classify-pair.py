import json,sys,collections
import os; R=sys.argv[1]; T=os.environ["GATE_TREE"].rstrip("/")+"/"
def st(p):
    d=json.load(open(p)); s={}
    for f in d['testResults']:
        n=f['name'].replace(T,'')
        if not f['assertionResults'] and f['status']=='failed': s[n+' :: (file failed to load)']='failed'
        for t in f['assertionResults']: s[n+' :: '+t['fullName']]=t['status']
    return s
a,b=st(f'{R}/off-1.json'),st(f'{R}/on-1.json')
rows=[(k,a.get(k,'absent'),b.get(k,'absent')) for k in sorted(set(a)|set(b)) if a.get(k)!=b.get(k)]
print('tests',len(a),len(b),'changed status rows',len(rows))
for k,x,y in rows: print(f'{x}->{y}  {k}')
def rec(p): return {(r['id'],r['mode']):r for r in map(json.loads,open(p))}
ra,rb=rec(f'{R}/off-1.replay.jsonl'),rec(f'{R}/on-1.replay.jsonl')
ch=[k for k in ra if k in rb and (ra[k]['ok']!=rb[k]['ok'] or [t['reply'] for t in ra[k]['turns']]!=[t['reply'] for t in rb[k]['turns']])]
print('replay records',len(ra),len(rb),'changed',len(ch),'ok-flip',sum(1 for k in ch if ra[k]['ok']!=rb[k]['ok']))
for k in ch: print(' ',k[0],k[1],'ok',ra[k]['ok'],'->',rb[k]['ok'])
