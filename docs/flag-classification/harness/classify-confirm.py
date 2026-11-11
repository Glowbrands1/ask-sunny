import json,re,collections,glob
import os; R=os.environ["GATE_R"]; T=os.environ["GATE_TREE"].rstrip("/")+"/"
def rows(p):
    d=json.load(open(p)); s={}
    for f in d['testResults']:
        n=f['name'].replace(T,'')
        if 'flags-off-parity' in n: continue
        if not f['assertionResults'] and f['status']=='failed': s[n+' :: (file failed to load)']=('failed','')
        for t in f['assertionResults']: s[n+' :: '+t['fullName']]=(t['status'],re.sub(r'\x1b\[[0-9;]*m','',(t['failureMessages'] or [''])[0]).split('\n')[0])
    return s
offs=[rows(f'{R}/off-{i}.json') for i in (1,2,3)]
ons=[rows(f'{R}/on2-{i}.json') for i in (1,2,3) if glob.glob(f'{R}/on2-{i}.json')]
print('runs: OFF',len(offs),'ON',len(ons),'tests/run',[len(x) for x in offs+ons])
def flaky(rs):
    ks=set().union(*rs); return [k for k in ks if len({r.get(k,('absent',))[0] for r in rs})>1]
fo,fn=flaky(offs),flaky(ons); print('FLAKY rows OFF:',len(fo),'ON:',len(fn))
for k in (fo+fn)[:10]: print('   ',k[:200])
a,b=offs[0],ons[0]
ch=[k for k in set(a)|set(b) if a.get(k,('absent',))[0]!=b.get(k,('absent',))[0]]
print('changed rows OFF-1 vs ON-1:',len(ch))
cls=collections.Counter(); other=[]
for k in sorted(ch):
    m=b.get(k,('absent',''))[1]
    if m.startswith('Error: Expect test to fail'): cls['INTENDED (OPEN holds)']+=1
    elif re.search(r'\boff\b|\(main\)|as before|production today',k) or 'two-forms-own-person' in k or 'two forms in one message' in k: cls['INTENDED-HARNESS (own/superseded pin)']+=1
    else: cls['READ']+=1; other.append((a.get(k,('absent',))[0],b.get(k,('absent',))[0],k[:230]))
print(dict(cls))
for o in other: print('  READ:',o)
# every ON run changes the same rows?
sets=[{k for k in set(a)|set(x) if a.get(k,('absent',))[0]!=x.get(k,('absent',))[0]} for x in ons]
print('changed-row sets identical across ON runs:',all(s==sets[0] for s in sets))
# replay records
def rec(p): return {(r['id'],r['mode']):r for r in map(json.loads,open(p))}
ro=[rec(f'{R}/off-{i}.replay.jsonl') for i in (1,2,3)]; rn=[rec(f'{R}/on2-{i}.replay.jsonl') for i in (1,2,3) if glob.glob(f'{R}/on2-{i}.replay.jsonl')]
def sig(r): return json.dumps([(t['reply'],t.get('updated')) for t in r['turns']])+str(r['ok'])
def recflaky(rs): return [k for k in rs[0] if len({sig(r.get(k,rs[0][k])) for r in rs})>1]
print('records',len(ro[0]),'| flaky within OFF',len(recflaky(ro)),'within ON',len(recflaky(rn)))
chg=[k for k in ro[0] if k in rn[0] and sig(ro[0][k])!=sig(rn[0][k])]; flip=[k for k in chg if ro[0][k]['ok']!=rn[0][k]['ok']]
print('changed records',len(chg),'ok flips',len(flip))
json.dump([list(k) for k in chg],open(R+'/conf-changed-records.json','w'))
print('ok False->True:',sum(1 for k in flip if rn[0][k]['ok']),' True->False:',[k for k in flip if not rn[0][k]['ok']])
