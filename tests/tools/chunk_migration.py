import sys,hashlib,os
src,key,out,first,size=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4]),int(sys.argv[5])
d=open(src,'rb').read()
lines=d.splitlines(keepends=True)
chunks=[];cur=b'';lim=first
for l in lines:
    if cur and len(cur)+len(l)>lim:
        chunks.append(cur);cur=b'';lim=size
    cur+=l
if cur: chunks.append(cur)
assert b''.join(chunks)==d
os.makedirs(out,exist_ok=True)
for i,c in enumerate(chunks,1):
    t=c.decode('utf-8')
    sql="insert into public.fincom_migration_text (file, n, chunk) values ('%s', %d, $fcm7Qz$%s$fcm7Qz$) on conflict (file, n) do update set chunk = excluded.chunk;"%(key,i,t)
    open(f'{out}/{i:02d}.sql','w').write(sql)
    print(i,len(c),hashlib.md5(c).hexdigest(), c.count(b'\n'))
