"""Ideal thin lens camera: fixed sensor, geometric DOF and focused diffraction limits."""
import math


def calculate_camera(state, definition, revision):
    p = state['parameters']
    f, u, s, a = (p[k] for k in ('f', 'u', 'sensor', 'aperture'))
    q, den = 1/f-1/s, 1/f-1/u
    v = 1/den if abs(den) > 1e-12 else None
    focus = 1/q if q > 1e-12 else None
    tolerance = p['coc']/(a*s)
    near = 1/(q+tolerance) if focus is not None else None
    far = 1/(q-tolerance) if focus is not None and q-tolerance > 1e-12 else None
    blur = lambda distance: a*abs(1-s*(1/f-1/distance))
    c = blur(u)
    if c < 1e-12: c = 0
    working_n = v/a if v is not None and v > 0 else None
    airy = 2.44*p['wavelength']/1000*working_n if working_n is not None else None
    cutoff = 1/(p['wavelength']/1e6*working_n) if working_n is not None else None
    ymax = max(25, p['h']*1.35, a*.9, p['sensorH']*.8, abs(-s*p['h']/u)*1.3)
    metrics = []
    def metric(key, label, value, unit=''):
        metrics.append(dict(key=key, label=label, value=value, unit=unit, note=''))
    for args in [('v','最佳成像距离 v',v,'mm'),('blurDiameter','几何光斑直径 c',c,'mm'),('fNumber','光圈数 N',f/a),('sensorHeight','像点中心',-s*p['h']/u,'mm'),('m','对焦面横向放大率',-v/u if v is not None else None),('fieldWidth','物方取景宽度 W',p['sensorW']*u/s,'mm'),('fieldHeight','物方取景高度 H',p['sensorH']*u/s,'mm'),('focusDistance','当前对焦物距',focus,'mm'),('nearDepth','景深近界',near,'mm'),('farDepth','景深远界',far,'mm'),('depth','几何景深',far-near if near is not None and far is not None else None,'mm'),('airyDiameter','对焦艾里斑直径',airy,'μm'),('diffractionCutoff','像方衍射截止频率',cutoff,'lp/mm'),('nyquist','像素采样上限',500/p['pixel'],'lp/mm'),('objectPixel','物方单像素尺寸',p['pixel']*u/s,'μm')]: metric(*args)
    segments = []
    for y in (-a/2,0,a/2):
        segments.extend([dict(start=[-u,p['h']],end=[0,y],role='incident',dashed=False,power=1),dict(start=[0,y],end=[s,y+s*((y-p['h'])/u-y/f)],role='transmitted',dashed=False,power=1)])
    study = p['study']
    curve = [dict(x=10+i*290/180,y=a*abs(1-(10+i*290/180)*den)) for i in range(181)]
    chart = dict(xLabel='感光面距离 s / mm',yLabel='几何光斑直径 c / mm',currentX=s,currentY=c)
    if study in (1,2):
        curve = []
        for i in range(181):
            distance = 20+i*4980/180
            value = blur(distance)
            if study == 1:
                value = (p['sensorW']*(distance/f-1) if distance > f else None) if c < 1e-8 else p['sensorW']*distance/s
            curve.append(dict(x=distance,y=value))
        chart = dict(xLabel='物距 u / mm',yLabel='物方取景宽度 W / mm' if study == 1 else '几何光斑直径 c / mm',currentX=u,currentY=p['sensorW']*u/s if study == 1 else c)
    if study == 3:
        curve = sorted([dict(x=f/(1+i*49/180),y=2.44*p['wavelength']/1000*v/(1+i*49/180)) for i in range(181)],key=lambda point:point['x']) if working_n is not None else []
        chart = dict(xLabel='光圈数 N',yLabel='艾里斑直径 / μm',currentX=f/a,currentY=airy)
    warnings = []
    if v is None or v <= 0: warnings.append('当前物距不能在镜头后形成有限实像。')
    if max(p['h']/u,a/(2*f),p['sensorH']/(2*s)) > .15: warnings.append('部分光线倾角较大，近轴模型仅供趋势参考。')
    return dict(revision=revision,input=state,modelVersion='scene-camera-1',model='camera',scope=definition['scope'],status='理想几何对焦' if c < 1e-8 and v is not None and v > 0 else '感光面离焦',warnings=warnings,bounds=[-u*1.15,max(s*1.3,f*1.5),-ymax,ymax],regions=[],segments=segments,markers=[dict(x=-u,y=p['h'],label='物体',role='object')],devices=[dict(kind='lens',x=0,height=max(a/2,ymax*.4),label='镜头',sign=1),dict(kind='screen',x=s,height=max(p['sensorH']/2,ymax*.4),label='感光面',sign=1)],metrics=metrics,curve=curve,chart=chart,imagePreview=None)
