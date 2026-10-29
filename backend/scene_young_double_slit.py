"""Equal-amplitude coherent ideal narrow slits; exact geometric path difference."""
import math


def young_at(p, y=None):
    y = p['observationMm'] if y is None else y
    L, d = p['screenDistanceM'] * 1000, p['slitDistanceMm']
    r1, r2 = math.hypot(L, y-d/2), math.hypot(L, y+d/2)
    delta = 2*d*y/(r1+r2)
    cycles = delta/(p['wavelengthNm']*1e-6)
    raw = math.cos(math.pi*math.fmod(cycles, 1))**2
    intensity = 0. if raw < 1e-12 else 1. if 1-raw < 1e-12 else raw
    return dict(r1=r1, r2=r2, deltaMm=delta, deltaUm=delta*1000, cycles=cycles, intensity=intensity)


def young_position(p, order):
    if isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order):
        raise ValueError('请给出有限的条纹级次。')
    delta = order*p['wavelengthNm']*1e-6
    denominator = p['slitDistanceMm']**2-delta**2
    if denominator <= 0:
        raise ValueError('该级次没有有限的屏上位置。')
    return delta*math.sqrt((p['screenDistanceM']*1000)**2/denominator+.25)


def young_target(p, target, value=None):
    if target == 'central_bright': return 0.
    if target == 'first_bright': return young_position(p, 1)
    if target == 'first_dark': return young_position(p, .5)
    raise ValueError('未知的双缝观察目标。')


def calculate_young(state, definition, revision=''):
    p = state['parameters']; b = young_at(p)
    spacing = p['wavelengthNm']*.001*p['screenDistanceM']/p['slitDistanceMm']
    status = '亮纹 · 相长干涉' if b['intensity'] == 1 else '暗纹 · 相消干涉' if b['intensity'] == 0 else '明暗之间'
    metrics = [dict(key=k,label=label,value=value,unit=unit,note=note) for k,label,value,unit,note in [
        ('spacingApproxMm','条纹间距',spacing,'mm','λL/d，近轴近似'),
        ('intensity','观察点相对光强',b['intensity'],'','I/Imax；最亮为1，时间平均光强'),
        ('deltaUm','有向光程差',b['deltaUm'],'μm','r₂−r₁，完整几何距离'),
        ('cycles','光程差与波长之比',b['cycles'],'','整数亮纹；半整数暗纹'),
        ('r1','第一条光程',b['r1']/1000,'m','上缝S₁到观察点P'),
        ('r2','第二条光程',b['r2']/1000,'m','下缝S₂到观察点P'),
        ('firstBrightMm','第一亮纹位置',young_position(p,1),'mm','完整距离方程的解'),
        ('firstDarkMm','第一暗纹位置',young_position(p,.5),'mm','完整距离方程的解')]]
    return dict(revision=revision,input=state,modelVersion='young-double-slit-1',model='young-double-slit',scope=definition['scope'],status=status,warnings=[],metrics=metrics,
                bounds=[0,p['screenDistanceM']*1000,-20,20],segments=[],markers=[],regions=[],
                curve=[dict(x=y,y=young_at(p,y)['intensity']) for y in [i/40 for i in range(-800,801)]],
                chart=dict(xLabel='屏上位置 y / mm',yLabel='I/Imax',currentX=p['observationMm'],currentY=b['intensity']))
