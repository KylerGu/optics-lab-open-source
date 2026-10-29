"""Compensated equal-inclination Michelson fringes in the lens focal plane."""
import math


def michelson_at(p, radius=None):
    radius=p['observationRadiusMm'] if radius is None else radius
    cosine=p['focalLengthMm']/math.hypot(p['focalLengthMm'],radius)
    delta=2*(p['baseDifferenceUm']+p['mirrorMoveUm']-p['mirror1MoveUm'])*cosine
    cycles=delta/(p['wavelengthNm']/1000)
    raw=math.cos(math.pi*math.fmod(cycles,1))**2
    intensity=0. if raw<1e-12 else 1. if 1-raw<1e-12 else raw
    return dict(cosine=cosine,deltaUm=delta,cycles=cycles,intensity=intensity,angleDeg=math.degrees(math.atan(abs(radius)/p['focalLengthMm'])))


def michelson_target(p,target):
    if target not in ('bright','dark'):raise ValueError('未知的干涉亮暗目标。')
    b=michelson_at(p);offset=.5 if target=='dark' else 0
    factor=2*b['cosine']/(p['wavelengthNm']/1000)
    reference=p['baseDifferenceUm']-p['mirror1MoveUm']
    min_order=math.ceil((reference-1)*factor-offset-1e-10)
    max_order=math.floor((reference+1)*factor-offset+1e-10)
    order=min(max_order,max(min_order,math.floor(b['cycles']-offset+.5)))+offset
    move=order*p['wavelengthNm']/1000/(2*b['cosine'])-reference
    if not -1-1e-10<=move<=1+1e-10:raise ValueError('目标超出移镜范围。')
    return max(-1,min(1,move))


def calculate_michelson(state,definition,revision=''):
    p=state['parameters'];b=michelson_at(p);axis=michelson_at(p,0);difference=p['baseDifferenceUm']+p['mirrorMoveUm']-p['mirror1MoveUm']
    status='亮环 · 相长干涉' if b['intensity']==1 else '暗环 · 相消干涉' if b['intensity']==0 else '明暗之间'
    metrics=[dict(key=key,label=label,value=value,unit=unit,note=note) for key,label,value,unit,note in [
        ('differenceUm','当前两臂长度差',difference,'μm','ΔL₀+s₂−s₁，单程长度差'),
        ('axisDeltaUm','轴上往返光程差',axis['deltaUm'],'μm','2(ΔL₀+s₂−s₁)'),
        ('deltaUm','观察点光程差',b['deltaUm'],'μm','等倾干涉：2(ΔL₀+s₂−s₁)cosθ'),
        ('intensity','观察点相对光强',b['intensity'],'','时间平均值；最亮为1'),
        ('cycles','观察点光程差与波长之比',b['cycles'],'','整数亮，半整数暗'),
        ('fringeShift','轴上条纹位移',2*(p['mirrorMoveUm']-p['mirror1MoveUm'])/(p['wavelengthNm']/1000),'','相对于两镜微调为零；不是自动计数'),
        ('oneFringeMoveUm','移镜一条纹所需位移',p['wavelengthNm']/2000,'μm','轴上λ/2'),
        ('arm1Mm','第一臂长度',100+p['mirror1MoveUm']/1000,'mm','单程长度'),
        ('arm2Mm','第二臂长度',100+(p['baseDifferenceUm']+p['mirrorMoveUm'])/1000,'mm','单程长度'),
        ('angleDeg','观察倾角',b['angleDeg'],'°','tanθ=r/f')]]
    return dict(revision=revision,input=state,modelVersion='michelson-2',model='michelson',scope=definition['scope'],status=status,warnings=[],metrics=metrics,bounds=[0,12,0,1],segments=[],markers=[],regions=[],curve=[dict(x=i/100,y=michelson_at(p,i/100)['intensity']) for i in range(1201)],chart=dict(xLabel='观察半径 r / mm',yLabel='I/Imax',currentX=p['observationRadiusMm'],currentY=b['intensity']))
