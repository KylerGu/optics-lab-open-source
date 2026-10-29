"""Analytic coherent Fourier transform between the front and back focal planes."""
import math


def fourier_values(p):
    scale=p['wavelengthNm']*1e-6*p['focalLengthMm']
    return dict(spatialFrequency=1/p['periodMm'],orderPositionUm=scale/p['periodMm']*1000,spotRadiusUm=scale/(math.pi*p['waistMm'])*1000)


def fourier_at(p,x=None,y=0):
    x=p['observationUm'] if x is None else x
    b=fourier_values(p);width=b['spotRadiusUm'];order=b['orderPositionUm']
    def g(v):return math.exp(-(v/width)**2)
    amplitude=(g(x)+p['modulation']/2*(g(x-order)+g(x+order)))/(1+p['modulation']*g(order))
    value=(amplitude*g(y))**2
    return dict(intensity=0. if value<1e-15 else min(1.,value),frequency=x*.001/(p['wavelengthNm']*1e-6*p['focalLengthMm']))


def fourier_target(p,target):
    if target=='central':return 0.
    if p['modulation']==0:raise ValueError('无条纹时没有一级频谱分量；请先增加条纹对比。')
    if target in ('positive_order','negative_order'):return fourier_values(p)['orderPositionUm']*(1 if target=='positive_order' else -1)
    raise ValueError('未知的傅里叶观察目标。')


def calculate_fourier(state,definition,revision=''):
    p=state['parameters'];b=fourier_values(p);point=fourier_at(p)
    metrics=[dict(key=k,label=l,value=v,unit=u,note=n) for k,l,v,u,n in [
        ('spatialFrequency','条纹空间频率',b['spatialFrequency'],'mm⁻¹','ν₀=1/d；每毫米的条纹周期数，m=0时不含此分量'),
        ('orderPositionUm','一级映射位置',b['orderPositionUm'],'μm','±ν₀映射到±x₁=±λf/d；m=0时没有一级亮斑'),
        ('spotRadiusUm','频谱光斑半径',b['spotRadiusUm'],'μm','单个高斯分量的1/e²光强半径wF=λf/(πw)，不是直径'),
        ('intensity','观察点相对光强',point['intensity'],'','先变换复振幅，再取模平方；以当前中心归一化'),
        ('observationFrequency','观察点空间频率',point['frequency'],'mm⁻¹','νx=xF/(λf)；观察点位于yF=0')]]
    extent=max(150,b['orderPositionUm']*1.25+3*b['spotRadiusUm'] if p['modulation'] else 4*b['spotRadiusUm'],abs(p['observationUm'])*1.1)
    return dict(revision=revision,input=state,modelVersion='fourier-lens-1',model='fourier-lens',scope=definition['scope'],status='无条纹：高斯频谱' if p['modulation']==0 else '条纹输入：零级与±一级频谱',warnings=[],metrics=metrics,bounds=[-p['focalLengthMm'],p['focalLengthMm'],-extent,extent],segments=[],markers=[],regions=[],curve=[dict(x=-extent+2*extent*i/800,y=fourier_at(p,-extent+2*extent*i/800)['intensity']) for i in range(801)],chart=dict(xLabel='频谱面位置 xF / μm',yLabel='I/I₀',currentX=p['observationUm'],currentY=point['intensity']))
