"""Object-space Rayleigh resolution and explicitly defined DOF estimates (µm)."""
from .scene_microscope_focus import focus_distance
def calculate_performance(state, definition, revision):
    p = state['parameters']
    wavelength = p['wavelength']/1000
    diffraction = p['medium']*wavelength/p['NA']**2
    magnification = p['tubeF']/p['f1']*p['adapter']
    geometric = p['medium']*p['pixel']/(magnification*p['NA']) if p['mode']==1 and p['depthCriterion']==1 else 0
    depth = diffraction+geometric
    resolution = .61*wavelength/p['NA']
    is_depth = p['study']==3
    def metric(key, label, value):
        return dict(key=key,label=label,value=value,unit='µm',note='')
    metrics = [metric('depth','景深估计',depth),metric('halfDepth','焦平面上下范围',depth/2),metric('diffractionDepth','衍射项',diffraction),metric('geometricDepth','采样项',geometric)] if is_depth else [metric('resolution','横向分辨率',resolution),metric('separation','两点间距',p['separation'])]
    if is_depth:metrics.append(metric('defocus','样品离焦量 z',p['defocus'] if focus_distance(p) is not None else None))
    curve=[]
    for i in range(101):
        na=.1+(min(p['medium'],1.4)-.1)*i/100
        y=p['medium']*wavelength/na**2+(p['medium']*p['pixel']/(magnification*na) if p['mode']==1 and p['depthCriterion']==1 else 0) if is_depth else .61*wavelength/na
        curve.append(dict(x=na,y=y))
    return dict(revision=revision,input=state,modelVersion='microscope-performance-1',model='microscope',scope='物方景深估计；非相干成像，按所选清晰度判据' if is_depth else '瑞利判据；等强、非相干点源，理想圆孔径',status='',warnings=[],metrics=metrics,bounds=[-1,1,-1,1],segments=[],markers=[],regions=[],devices=[],curve=curve,chart=dict(xLabel='数值孔径 NA',yLabel='景深 DOF / µm' if is_depth else '分辨率 rₓᵧ / µm',currentX=p['NA'],currentY=depth if is_depth else resolution))
