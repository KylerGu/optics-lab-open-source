"""Uniform circular pupil, paraxial scalar diffraction in the lens focal plane."""
import math
from functools import lru_cache

AIRY_ZERO=3.8317059702075125
AIRY_FACTOR=AIRY_ZERO/math.pi


@lru_cache(maxsize=8)
def angular_kernel(n):
    return tuple(math.sin(math.pi*(i+.5)/n) for i in range(n))


def bessel_j1(x):
    if abs(x)<1e-4: return x/2-x**3/16+x**5/384
    n=2**math.ceil(math.log2(max(64,2*abs(x)+32)))
    return sum(math.sin(x*s)*s for s in angular_kernel(n))/n


def circular_at(p,r=None):
    r=p['observationRadiusUm'] if r is None else r
    u=math.pi*p['apertureDiameterMm']*(r*.001)/(p['wavelengthNm']*1e-6*p['focalLengthMm'])
    raw=1. if abs(u)<1e-8 else (2*bessel_j1(u)/u)**2
    return dict(intensity=0. if raw<1e-14 else min(1.,raw),thetaDeg=math.degrees(math.atan2(r*.001,p['focalLengthMm'])),u=u)


def circular_radius(p):
    return AIRY_FACTOR*p['wavelengthNm']*.001*p['focalLengthMm']/p['apertureDiameterMm']


def circular_target(p,target):
    if target=='central_bright':return 0.
    if target=='first_dark':return circular_radius(p)
    raise ValueError('未知的圆孔观察目标。')


def calculate_circular(state,definition,revision=''):
    p=state['parameters'];b=circular_at(p);r1=circular_radius(p)
    status='中央最亮' if p['observationRadiusUm']==0 else '暗环' if b['intensity']==0 else '中央亮斑内' if p['observationRadiusUm']<r1 else '旁侧圆环'
    metrics=[dict(key=k,label=label,value=value,unit=unit,note=note) for k,label,value,unit,note in [
        ('airyDiameterUm','艾里斑直径',2*r1,'μm','dₐ=2r₁；由第一暗环定义，不是半高宽'),
        ('intensity','观察点相对光强',b['intensity'],'','I/I₀，中央为1，不代表总功率'),
        ('firstDarkRadiusUm','第一暗环半径',r1,'μm','r₁=(3.8317059702/π)λf/D'),
        ('thetaDeg','观察角',b['thetaDeg'],'°','θ=atan(r/f)；焦平面半径对应的方向'),
        ('firstDarkAngleMrad','第一暗环角半径',r1/p['focalLengthMm'],'mrad','近轴：约1.22λ/D；不是两点分辨仿真')]]
    return dict(revision=revision,input=state,modelVersion='circular-diffraction-1',model='circular-diffraction',scope=definition['scope'],status=status,warnings=[],metrics=metrics,
        bounds=[0,p['focalLengthMm'],0,500],segments=[],markers=[],regions=[],curve=[dict(x=i,y=circular_at(p,i)['intensity']) for i in range(501)],
        chart=dict(xLabel='焦平面半径 r / μm',yLabel='I/I₀',currentX=p['observationRadiusUm'],currentY=b['intensity']))
