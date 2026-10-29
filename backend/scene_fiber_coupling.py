"""Gaussian overlap at a planar fiber facet, in air, with matched curvature."""
import math

def coupling_values(p):
    w,f=p['beamRadiusUm'],p['modeRadiusUm'];s=w*w+f*f
    k=2*math.pi/(p['wavelengthNm']*.001)
    size=(2*w*f/s)**2
    offset=2*p['offsetUm']**2/s
    tilt=(k*math.sin(math.radians(p['tiltDeg'])))**2*w*w*f*f/(2*s)
    log_eta=math.log(size)-offset-tilt;eta=math.exp(log_eta)
    return dict(efficiency=eta,efficiencyPct=100*eta,coupledPowerMw=p['powerMw']*eta,
                lossDb=-10*log_eta/math.log(10),sizePct=100*size,positionPct=100*math.exp(-offset),anglePct=100*math.exp(-tilt))

def coupling_target(p,target):
    if target=='align':return dict(offsetUm=0,tiltDeg=0)
    if target=='match_size':return dict(beamRadiusUm=p['modeRadiusUm'])
    if target=='best_coupling':return dict(offsetUm=0,tiltDeg=0,beamRadiusUm=p['modeRadiusUm'])
    raise ValueError('未知的光纤耦合目标。')

def calculate_coupling(state,definition,revision=''):
    p=state['parameters'];b=coupling_values(p)
    fields=[('efficiencyPct','耦合效率','%','理想高斯光场重叠，不含端面反射'),('coupledPowerMw','耦合功率','mW','入射功率乘以耦合效率'),('lossDb','耦合损耗','dB','仅包含光场不匹配的损耗'),('sizePct','尺寸匹配','%','三项匹配因子的乘积为总效率'),('positionPct','位置对准','%','端面光斑中心的横向偏移'),('anglePct','角度对准','%','入射光与模场的相位斜率差')]
    return dict(revision=revision,input=state,modelVersion='fiber-coupling-1',model='fiber-coupling',scope=definition['scope'],
                status='理想耦合' if b['efficiency']>1-1e-10 else '光场未完全匹配',warnings=[],
                metrics=[dict(key=k,label=l,value=b[k],unit=u,note=n) for k,l,u,n in fields],
                bounds=[-50,30,-25,25],segments=[],markers=[],regions=[],curve=[])
