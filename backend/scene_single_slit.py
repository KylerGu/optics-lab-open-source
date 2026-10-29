"""Uniform long slit, scalar Fraunhofer intensity with sin(theta)=y/hypot(L,y)."""
import math


def slit_at(p, y=None):
    y = p['observationMm'] if y is None else y
    L, a, wavelength = p['screenDistanceM']*1000, p['slitWidthMm'], p['wavelengthNm']*1e-6
    cycles = a*y/math.hypot(L,y)/wavelength
    beta = math.pi*cycles
    intensity = 1. if abs(beta)<1e-8 else (math.sin(beta)/beta)**2
    return dict(intensity=0. if intensity<1e-14 else intensity, thetaDeg=math.degrees(math.atan2(y,L)), beta=beta, cycles=cycles)


def slit_minimum(p):
    ratio = p['wavelengthNm']*1e-6/p['slitWidthMm']
    if ratio>=1: raise ValueError('当前缝宽下没有有限的第一暗纹位置。')
    return p['screenDistanceM']*1000*ratio/math.sqrt(1-ratio*ratio)


def slit_target(p, target):
    if target=='central_bright': return 0.
    if target=='first_dark': return slit_minimum(p)
    raise ValueError('未知的单缝观察目标。')


def calculate_slit(state, definition, revision=''):
    p = state['parameters']; b = slit_at(p); minimum = slit_minimum(p)
    fresnel = p['slitWidthMm']**2/(p['wavelengthNm']*1e-6*p['screenDistanceM']*1000)
    status = '中央最亮' if b['intensity']==1 else '暗纹' if b['intensity']==0 else '中央亮纹内' if abs(p['observationMm'])<minimum else '旁侧条纹'
    metrics = [dict(key=k,label=label,value=value,unit=unit,note=note) for k,label,value,unit,note in [
        ('centralWidthMm','中央亮纹宽度',2*minimum,'mm','两侧第一暗纹之间的距离 w'),
        ('intensity','观察点相对光强',b['intensity'],'','I/I₀；中央峰为1，不代表总功率'),
        ('firstMinimumMm','第一暗纹位置',minimum,'mm','上方第一暗纹 y₁；下方为 −y₁'),
        ('thetaDeg','衍射角',b['thetaDeg'],'°','θ=atan(y/L)，上方为正'),
        ('fresnelNumber','远场条件指标',fresnel,'','a²/(λL)≤0.1；所有可调参数均满足')]]
    return dict(revision=revision,input=state,modelVersion='single-slit-1',model='single-slit',scope=definition['scope'],status=status,warnings=[],metrics=metrics,
        bounds=[0,p['screenDistanceM']*1000,-40,40],segments=[],markers=[],regions=[],
        curve=[dict(x=i/20,y=slit_at(p,i/20)['intensity']) for i in range(-800,801)],
        chart=dict(xLabel='屏上位置 y / mm',yLabel='I/I₀',currentX=p['observationMm'],currentY=b['intensity']))
