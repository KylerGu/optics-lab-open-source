"""Equal-focal-length coherent 4f system with a vertical amplitude strip mask."""
import math
from .scene_fourier_lens import fourier_values


class FourF:
    def __init__(self,p):
        self.p=p
        self.scale=p['wavelengthNm']*1e-6*p['focalLengthMm']
        self.alpha=math.pi*p['waistMm']
        self.components=[(0,1),(1/p['periodMm'],p['modulation']/2),(-1/p['periodMm'],p['modulation']/2)]
        self.lo=(p['filterOffsetUm']-p['filterWidthUm']/2)*.001/self.scale
        self.hi=(p['filterOffsetUm']+p['filterWidthUm']/2)*.001/self.scale
        self.nodes=[]
        if p['filterMode']!=2:
            for center,weight in self.components:
                if not weight:continue
                left=max(-8,self.alpha*(self.lo-center));right=min(8,self.alpha*(self.hi-center))
                if right<=left:continue
                n=384;step=(right-left)/n
                for i in range(n+1):
                    t=left+i*step
                    self.nodes.append((center+t/self.alpha,weight/(math.sqrt(math.pi)*(1+p['modulation']))*math.exp(-t*t)*step/3*(1 if i in (0,n) else 4 if i%2 else 2)))
        b=fourier_values(p);self.order=b['orderPositionUm']
        passed=self.power_interval(self.lo,self.hi)/self.power_interval(-math.inf,math.inf)
        self.transmission=1. if p['filterMode']==2 else max(0.,min(1.,passed if p['filterMode']==0 else 1-passed))

    def input(self,x,y=0):
        p=self.p
        return math.exp(-(x*x+y*y)/(p['waistMm']**2))*(1+p['modulation']*math.cos(2*math.pi*x/p['periodMm']))/(1+p['modulation'])

    def amplitude(self,x):
        if self.p['filterMode']==2:return complex(self.input(-x))
        real=imag=0.
        for nu,weight in self.nodes:
            phase=-2*math.pi*nu*x
            real+=weight*math.cos(phase);imag+=weight*math.sin(phase)
        value=complex(real,imag)
        return value if self.p['filterMode']==0 else self.input(-x)-value

    def at(self,x,y=0):
        v=abs(self.amplitude(x))**2*math.exp(-2*(y/self.p['waistMm'])**2)
        return 0. if v<1e-15 else v

    def power_interval(self,left,right):
        total=0.
        for u,a in self.components:
            for v,b in self.components:
                if not a or not b:continue
                center=(u+v)/2
                L=max(-8,math.sqrt(2)*self.alpha*(left-center));R=min(8,math.sqrt(2)*self.alpha*(right-center))
                if R<=L:continue
                integral=math.sqrt(math.pi)/2*(math.erf(R)-math.erf(L))
                total+=a*b*math.exp(-self.alpha**2*(u-v)**2/2)*integral
        return total


def four_f_target(p,target):
    if target=='all_pass':return dict(filterMode=2)
    width=max(10,min(5000,fourier_values(p)['orderPositionUm']*.6))
    if target in ('low_pass','high_pass'):return dict(filterMode=0 if target=='low_pass' else 1,filterOffsetUm=0,filterWidthUm=width)
    if target=='positive_order':
        if not p['modulation']:raise ValueError('无条纹时没有一级频谱。')
        return dict(filterMode=0,filterOffsetUm=fourier_values(p)['orderPositionUm'],filterWidthUm=width)
    raise ValueError('未知的滤波目标。')


def calculate_four_f(state,definition,revision=''):
    p=state['parameters'];b=FourF(p);cutoff=p['filterWidthUm']*.001/(2*b.scale)
    point=b.at(p['observationMm'])
    metrics=[dict(key=k,label=l,value=v,unit=u,note=n) for k,l,v,u,n in [
        ('transmission','透过功率比',b.transmission,'','对完整无限平面积分；不是屏上单点亮度'),
        ('intensity','观察点相对光强',point,'','以输入中心光强为基准，全通与滤波共用亮度基准'),
        ('cutoffFrequency','滤波半带宽',cutoff,'mm⁻¹','νc=a/(2λf)；居中狭缝为横向低通，挡片为横向高通'),
        ('orderPositionUm','一级频谱位置',b.order,'μm','x₁=λf/d；无条纹时一级分量不存在'),
        ('systemLengthMm','总长',4*p['focalLengthMm'],'mm','两镜等焦距，间距2f；输入与输出各距相邻透镜f'),
        ('magnification','横向放大率',-1,'','全通时等大小倒像；本例输入对称，倒像看起来相同')]]
    extent=3.
    return dict(revision=revision,input=state,modelVersion='four-f-1',model='four-f',scope=definition['scope'],status=['通光狭缝','遮光挡片','全通'][int(p['filterMode'])],warnings=[],metrics=metrics,bounds=[0,4*p['focalLengthMm'],-extent,extent],segments=[],markers=[],regions=[],curve=[dict(x=-extent+2*extent*i/240,y=b.at(-extent+2*extent*i/240)) for i in range(241)],chart=dict(xLabel='输出面位置 x′ / mm',yLabel='I/Iin(0)',currentX=p['observationMm'],currentY=point))
