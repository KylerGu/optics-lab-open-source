"""Lossless ideal quarter/half-wave plate, at its 532 nm design wavelength.

Linear input; Eout=f cos(alpha-beta)+s sin(alpha-beta) exp(i delta).
Time exp(-i omega t); S3=2 Im(Ex conj(Ey)), matching the builder detector.
"""
import math
import cmath

def tidy(n):
    for v in (0.,1.,-1.):
        if abs(n-v)<1e-12:return v
    return n

def waveplate_values(p):
    a,b=map(math.radians,(p['inputAngleDeg'],p['axisAngleDeg']))
    phase_deg=90. if p['plateType']==0 else 180.
    phase=cmath.exp(1j*math.radians(phase_deg));fast=math.cos(a-b);slow=math.sin(a-b)
    ex=fast*math.cos(b)-slow*phase*math.sin(b);ey=fast*math.sin(b)+slow*phase*math.cos(b)
    ex=complex(tidy(ex.real),tidy(ex.imag));ey=complex(tidy(ey.real),tidy(ey.imag))
    s1=tidy(abs(ex)**2-abs(ey)**2);s2=tidy(2*(ex*ey.conjugate()).real);s3=tidy(2*(ex*ey.conjugate()).imag)
    linear=min(1.,math.hypot(s1,s2));ratio=tidy(abs(s3)/(1+linear))
    angle=None if linear<1e-10 else tidy(math.degrees(math.atan2(s2,s1))/2%180)
    if angle is not None and abs(angle-180)<1e-10:angle=0.
    active=p['powerMw']>0
    kind='光源关闭' if not active else '线偏振' if ratio<1e-10 else '圆偏振' if 1-ratio<1e-10 else '椭圆偏振'
    return dict(ex=dict(re=ex.real,im=ex.imag),ey=dict(re=ey.real,im=ey.imag),phaseDeg=phase_deg,outputPowerMw=p['powerMw'],
                majorAngleDeg=angle if active else None,axisRatio=ratio if active else None,s1=s1 if active else None,s2=s2 if active else None,s3=s3 if active else None,
                polarization=kind,rotation='—' if not active else '往复' if s3==0 else '顺时针' if s3>0 else '逆时针')

def waveplate_target(p,target,value=None):
    if p['powerMw']==0:raise ValueError('光源已关闭，转动波片不能产生输出偏振态。')
    if target=='circular':
        if p['plateType']!=0:raise ValueError('半波片不能把线偏振变成圆偏振，请先切换四分之一波片。')
        angle=p['inputAngleDeg']+45
    elif target=='linear':angle=p['inputAngleDeg']
    elif target=='direction':
        if p['plateType']!=1:raise ValueError('指定线偏振方向需使用半波片，请先切换波片类型。')
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0<=value<=180:raise ValueError('输出方向须为0–180°的有限数值。')
        angle=(p['inputAngleDeg']+value)/2
    else:raise ValueError('未知的波片调节目标。')
    return dict(axisAngleDeg=angle%180)

def calculate_waveplate(state,definition,revision=''):
    p=state['parameters'];b=waveplate_values(p)
    fields=[('outputPowerMw','输出功率','mW','理想无损波片保持总功率'),('phaseDeg','相位延迟','°','慢轴相对快轴；四分之一波片90°，半波片180°'),
            ('majorAngleDeg','长轴方向','°','相对水平轴，模180°；圆偏振与无光时无定义'),('axisRatio','短长轴比','','短轴/长轴；直线为0，圆为1'),
            ('s1','偏振分量 S₁','','归一化斯托克斯分量'),('s2','偏振分量 S₂','','归一化斯托克斯分量'),('s3','偏振分量 S₃','','S₃=2Im(Ex Ey共轭)，不使用左右旋命名')]
    return dict(revision=revision,input=state,modelVersion='waveplate-1',model='waveplate',scope=definition['scope'],status=b['polarization'],warnings=[],
                metrics=[dict(key=k,label=l,value=b[k],unit=u,note=n) for k,l,u,n in fields],bounds=[-1,1,-1,1],segments=[],markers=[],regions=[],
                curve=[dict(x=j,y=waveplate_values({**p,'axisAngleDeg':j})['axisRatio']) for j in range(181)],
                chart=dict(xLabel='快轴角 β / °',yLabel='短长轴比',currentX=p['axisAngleDeg'],currentY=b['axisRatio']))
