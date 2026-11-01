import numpy as np, re
def load(p):
    n=None; d=[]
    for l in open(p):
        l=l.strip()
        if l.startswith('LUT_3D_SIZE'): n=int(l.split()[1])
        elif l and (l[0].isdigit() or l[0]=='-' or l[0]=='.'): d.append([float(x) for x in l.split()])
    a=np.array(d,np.float32).reshape(n,n,n,3)  # [b][g][r]
    return a
def apply(lut,img):
    n=lut.shape[0]; x=np.clip(img,0,1)*(n-1)
    i0=np.floor(x).astype(int).clip(0,n-2); f=x-i0
    r,g,b=i0[...,0],i0[...,1],i0[...,2]; fr,fg,fb=f[...,0:1],f[...,1:2],f[...,2:3]
    out=0
    for db in (0,1):
        for dg in (0,1):
            for dr in (0,1):
                w=(fr if dr else 1-fr)*(fg if dg else 1-fg)*(fb if db else 1-fb)
                out=out+w*lut[b+db,g+dg,r+dr]
    return out
def save(p,lut,title):
    n=lut.shape[0]
    with open(p,'w') as f:
        f.write(f'TITLE "{title}"\nLUT_3D_SIZE {n}\n')
        for v in lut.reshape(-1,3): f.write('%.7f %.7f %.7f\n'%tuple(v))
