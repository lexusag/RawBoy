# Writes the stub decoder's synthetic 3000x2000 linear image (RGB half floats): python3 gen_image.py web/public/wasm/stub.f16
import sys
import numpy as np
W,H=3000,2000
rng=np.random.default_rng(3)
y,x=np.mgrid[0:H,0:W].astype(np.float32)
u=x/W; v=y/H
img=np.zeros((H,W,3),np.float32)
# sky
t=np.clip(v/0.55,0,1)[...,None]
top=np.array([0.05,0.12,0.35]); hor=np.array([0.9,0.55,0.3])
img[:]=top*(1-t)+hor*t
# sun
d=np.sqrt((u-0.68)**2*2.25+(v-0.42)**2)
img+= (np.exp(-(d/0.012)**2)*30 + np.exp(-(d/0.08)**2)*0.8)[...,None]*np.array([1.0,0.8,0.55])
def ridge(base,amp,freqs,seed):
    r=np.random.default_rng(seed); h=np.full(W,base,np.float32)
    for f in freqs:
        h+=amp/f*np.sin(2*np.pi*f*np.arange(W)/W+r.uniform(0,6.28)).astype(np.float32)
    return h
for base,amp,col,seed in [(0.48,0.25,(0.35,0.25,0.3),1),(0.53,0.3,(0.15,0.1,0.12),2),(0.6,0.35,(0.03,0.035,0.03),3)]:
    h=ridge(base,amp,[1,2.3,5.1,11.7,23],seed)[None,:]
    m=(v>h)
    img[m]=np.array(col,np.float32)
# lake reflection
lake=v>0.78
refl=img[(np.clip((2*0.78-v)*H,0,H-1)).astype(int),x.astype(int)]
img[lake]=refl[lake]*0.5
img*=(1+rng.normal(0,0.02,(H,W,1))).astype(np.float32)
img=np.clip(img,0,60)
img.astype(np.float16).tofile(sys.argv[1])
