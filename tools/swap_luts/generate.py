"""Experimental colour-swap LUTs (Lagoon, Violet Dust, Unseen): 33-point .cube files for luts/.

Procedural: a channel mix that swaps hues, part of the original luma kept, a saturation change, uneven shadow and
highlight tints (deliberately imperfect) and a soft per-channel tone curve with lifted blacks. Unseen remakes a
false-colour-infrared look: green and yellow foliage is pulled towards crimson. Input and output are display sRGB,
like every bundled LUT (applied after AgX). Run: python3 tools/swap_luts/generate.py
"""
import numpy as np
import os
from lut import save
N=33
v=np.linspace(0,1,N)
b,g,r=np.meshgrid(v,v,v,indexing='ij')
RGB=np.stack([r,g,b],-1)          # [b][g][r] order, R fastest when flattened
def Y(x): return x[...,0]*.3+x[...,1]*.59+x[...,2]*.11
def mix(x,M): return x@np.array(M,np.float64).T
def sat(x,s): y=Y(x)[...,None]; return y+(x-y)*s
def keepY(new,old,k): return new+((Y(old)-Y(new))*k)[...,None]
def ss(x): x=np.clip(x,0,1); return x*x*(3-2*x)
def tone(x,lift,white,c=0.15,gamma=(1,1,1)):
    out=np.empty_like(x)
    for i in range(3):
        t=np.clip(x[...,i],0,1)**gamma[i]
        t=(1-c)*t+c*ss(t)
        out[...,i]=lift[i]+(white[i]-lift[i])*t
    return out
def split(x,sh,hi,mid=(0,0,0)):
    y=np.clip(Y(x),0,1)[...,None]
    return x+np.array(sh)*(1-y)**2+np.array(hi)*y**2+np.array(mid)*4*y*(1-y)
def greenness(x,gain=4):
    return ss((x[...,1]-np.maximum(x[...,0],x[...,2]))*gain)[...,None]
def finish(x): return np.clip(x,0,1)

L={}
# 1 Lagoon: LomoChrome Turquoise-ish. Warm -> turquoise/blue, blue sky -> amber, cream highlights.
x=mix(RGB,[[.15,.15,.70],[.35,.50,.15],[.72,.18,.10]])
x=keepY(x,RGB,.6); x=sat(x,1.35)
x=split(x,sh=(-.03,.025,.03),hi=(.05,.035,-.04),mid=(-.02,.015,.0))
L['Lagoon']=finish(tone(x,lift=(.05,.07,.07),white=(.96,.95,.88),c=.12))

# 4 Violet Dust: greens -> violet, blues -> mint, reds stay, skin goes rose.
x=mix(RGB,[[.70,.30,0],[.20,.15,.65],[.10,.80,.10]])
x=keepY(x,RGB,.55); x=sat(x,.95)
x=split(x,sh=(.02,-.01,.03),hi=(.0,.03,-.02))
L['Violet Dust']=finish(tone(x,lift=(.07,.05,.08),white=(.95,.95,.93),c=.1))

# 5 Unseen: remake of the fake-IR LUT (its colour mapping fitted, then softened and made a bit odd).
x=mix(RGB,[[.80,.20,-.10],[.38,.60,.12],[.22,.28,.50]])+np.array([.06,-.06,.04])
leaf=(ss((RGB[...,1]-RGB[...,2])*3)*ss((RGB[...,1]-.6*RGB[...,0])*4))[...,None]*.9
x=x*(1-leaf)+Y(RGB)[...,None]*np.array([1.75,.38,.62])*leaf
x=keepY(x,RGB,.35); x=sat(x,1.15)
x=split(x,sh=(.01,-.015,.025),hi=(.0,-.01,-.03),mid=(.015,-.005,.01))
L['Unseen']=finish(tone(x,lift=(.04,.025,.045),white=(.99,.96,.95),c=.12,gamma=(.95,1.0,.97)))

dst=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','luts')
for k,a in L.items(): save(os.path.join(dst,f'{k}.cube'),a.astype(np.float32),k)
