"""Ideal linear polarizer with full-aperture transmission (mW, degrees)."""
import math

def malus_values(p):
    signed=(p['axisAngleDeg']-p['inputAngleDeg']+90)%180-90
    angle=abs(signed)
    fraction=0. if angle==90 else math.cos(math.radians(angle))**2
    return dict(signedAngleDeg=signed,relativeAngleDeg=angle,fraction=fraction,
                transmissionPct=100*fraction,outputPowerMw=p['powerMw']*fraction)

def malus_target(p,target,value=None):
    if target=='maximum':angle=0.
    elif target=='minimum':angle=90.
    elif target=='half_power':angle=45.
    elif target=='power':
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:
            raise ValueError('目标透射功率须为非负有限数值，单位 mW。')
        if p['powerMw']==0:raise ValueError('光源已关闭，仅转动偏振片不能确定目标角度。')
        if value>p['powerMw']:raise ValueError('目标透射功率不能大于入射功率。')
        angle=math.degrees(math.acos(math.sqrt(value/p['powerMw'])))
    else:raise ValueError('未知的偏振调节目标。')
    return dict(axisAngleDeg=(p['inputAngleDeg']+angle)%180)

def calculate_malus(state,definition,revision=''):
    p=state['parameters'];b=malus_values(p)
    status='光源关闭' if p['powerMw']==0 else '正交消光' if b['fraction']==0 else '平行全透' if b['fraction']==1 else '部分透射'
    fields=[('outputPowerMw','透射功率','mW','理想偏振片后的总功率'),('transmissionPct','透过比例','%','相对入射功率，零功率时仍表示器件的透射比例'),('relativeAngleDeg','夹角','°','偏振方向与透光轴的较小夹角，0–90°')]
    return dict(revision=revision,input=state,modelVersion='malus-1',model='malus',scope=definition['scope'],status=status,warnings=[],
                metrics=[dict(key=k,label=l,value=b[k],unit=u,note=n) for k,l,u,n in fields],
                bounds=[-1,1,-1,1],segments=[],markers=[],regions=[],
                curve=[dict(x=j/2,y=0. if j==180 else p['powerMw']*math.cos(math.radians(j/2))**2) for j in range(181)],
                chart=dict(xLabel='夹角 θ / °',yLabel='透射功率 / mW',currentX=b['relativeAngleDeg'],currentY=b['outputPowerMw']))
