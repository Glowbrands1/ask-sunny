import json,glob,os,collections,re
import os; R=os.environ["GATE_R"]; T=os.environ["GATE_TREE"].rstrip("/")+"/"
def st(p):
    d=json.load(open(p)); s={}
    for f in d['testResults']:
        n=f['name'].replace(T,'')
        if not f['assertionResults'] and f['status']=='failed': s[n+' :: (file failed to load)']='failed'
        for t in f['assertionResults']: s[n+' :: '+t['fullName']]=t['status']
    return s
off=st(R+'/off-1.json'); on=st(R+'/on-1.json')
files=set(l.strip() for l in open(R+'/files.txt'))
res={}
for p in sorted(glob.glob(R+'/bis/*.json')):
    u=os.path.basename(p)[:-5]; s=st(p)
    bad=[k for k,v in s.items() if v!=off.get(k) and k.split(' :: ')[0] in files]
    res[u]=bad
    print(f'== {u}: {len(s)} rows, changed vs OFF-1: {len(bad)}')
    for k in bad: print('   ',off.get(k,'absent'),'->',s[k],' ',k[:230])
# attribution of the combined run's changed rows
comb=[k for k in on if on[k]!=off.get(k) and k.split(' :: ')[0] in files]
who=collections.defaultdict(list)
for u,b in res.items():
    for k in b: who[k].append(u)
unattr=[k for k in comb if k not in who]
print(f'\ncombined changed rows (in solo files): {len(comb)}; attributed to >=1 unit: {len(comb)-len(unattr)}; no single unit: {len(unattr)}')
for k in unattr: print('  UNATTR',off.get(k),'->',on[k],k[:230])
solo_only=[k for k in who if k not in comb]
print(f'rows changed in a solo run but NOT in the combined run (masked): {len(solo_only)}')
for k in solo_only: print('  MASKED',who[k],k[:230])
json.dump({'who':{k:v for k,v in who.items()}},open(R+'/who.json','w'))
