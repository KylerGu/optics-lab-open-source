"""Independent isotropic Fresnel interface and normally illuminated uniaxial slab.

Crystal optic axis lies in the drawing plane; gamma from the +X normal.
Energy flow follows the normal to the extraordinary k-space ellipsoid.
"""
import math

def tidy(v):return 0. if abs(v)<1e-12 else 1. if abs(v-1)<1e-12 else v

def fresnel(n1,n2,angle):
    i=math.radians(angle);s=n1/n2*math.sin(i)
    if abs(n1-n2)<1e-12:return dict(rs=0.,rp=0.,transmissionDeg=angle,tir=False,critical=False)
    if s>=1-1e-12:return dict(rs=1.,rp=1.,transmissionDeg=90. if s<=1+1e-12 else None,tir=s>1+1e-12,critical=s<=1+1e-12)
    ct=math.sqrt(1-s*s);ci=math.cos(i)
    return dict(rs=tidy(((n1*ci-n2*ct)/(n1*ci+n2*ct))**2),rp=tidy(((n2*ci-n1*ct)/(n2*ci+n1*ct))**2),transmissionDeg=math.degrees(math.asin(s)),tir=False,critical=False)

def brewster_values(p):
    f=fresnel(p['n1'],p['n2'],p['angleDeg']);equal=abs(p['n1']-p['n2'])<1e-12
    b=None if equal else math.degrees(math.atan(p['n2']/p['n1']))
    critical=math.degrees(math.asin(p['n2']/p['n1'])) if p['n1']>p['n2'] else None
    r=f['rs'] if p['polarization']==1 else f['rp'] if p['polarization']==2 else (f['rs']+f['rp'])/2
    at=b is not None and abs(p['angleDeg']-b)<1e-6
    return dict(**f,brewsterDeg=b,criticalDeg=critical,rsPct=100*f['rs'],rpPct=100*f['rp'],reflectancePct=100*r,transmissionPct=100*(1-r),atBrewster=at,
                status='无折射率差' if equal else '全反射' if f['tir'] else '临界掠射' if f['critical'] else 'p 光不反射' if at else '反射与折射')

def crystal_values(p):
    g=math.radians(p['axisAngleDeg']);c=math.cos(g);s=math.sin(g);no2=p['ordinaryIndex']**2;ne2=p['extraordinaryIndex']**2
    tangent=tidy((ne2-no2)*s*c/(ne2*c*c+no2*s*s))
    return dict(effectiveIndex=1/math.sqrt(c*c/no2+s*s/ne2),tangent=tangent,walkoffDeg=math.degrees(math.atan(tangent)),signedSeparationMm=p['thicknessMm']*tangent,separationMm=abs(p['thicknessMm']*tangent),
                status='无双折射' if abs(p['ordinaryIndex']-p['extraordinaryIndex'])<1e-12 else '两束同轴' if tangent==0 else '两束分开')

def refraction_target(p,target):
    if target=='brewster':
        if p['mode']!=0:raise ValueError('请先切换到布儒斯特角视图，目标不会自动换模型。')
        b=brewster_values(p)['brewsterDeg']
        if b is None:raise ValueError('两侧折射率相等，没有特定布儒斯特角。')
        return dict(angleDeg=b)
    if target in ('max_separation','no_walkoff'):
        if p['mode']!=1:raise ValueError('请先切换到双折射视图，目标不会自动换模型。')
        if target=='max_separation' and abs(p['ordinaryIndex']-p['extraordinaryIndex'])<1e-12:raise ValueError('主折射率相等，不能产生空间分束。')
        return dict(axisAngleDeg=math.degrees(math.atan(p['extraordinaryIndex']/p['ordinaryIndex'])) if target=='max_separation' else 0.)
    raise ValueError('未知调节目标。')

def calculate_polarization_refraction(state,definition,revision=''):
    p=state['parameters'];b=brewster_values(p) if p['mode']==0 else crystal_values(p)
    fields=[('brewsterDeg','布儒斯特角','°','p偏振功率反射率为零；相等折射率时无特定角'),('transmissionDeg','折射角','°','从透射侧法线量起'),('rsPct','s 反射率','%','电场垂直图面'),('rpPct','p 反射率','%','电场在图面内'),('reflectancePct','总反射率','%','由当前入射偏振决定'),('transmissionPct','总透射率','%','功率比例T=1−R'),('criticalDeg','临界角','°','仅从较高折射率射向较低折射率时存在')] if p['mode']==0 else [
        ('effectiveIndex','e 有效折射率','','相位折射率，不能将光线能量流方向直接代入斯涅尔公式'),('walkoffDeg','走离角','°','e光的能量流相对向右法线；正向上，负向下'),('separationMm','出射间距','mm','平行出射两束光的中心间距；d=L|tanρ|')]
    return dict(revision=revision,input=state,modelVersion='polarization-refraction-1',model=definition['model'],scope=definition['scope'],status=b['status'],warnings=[],
                metrics=[dict(key=k,label=l,unit=u,value=b[k],note=n) for k,l,u,n in fields],segments=[],markers=[],regions=[],bounds=[-1,1,-1,1],
                curve=[dict(x=i/4,y=brewster_values({**p,'angleDeg':i/4})['reflectancePct']) for i in range(360)] if p['mode']==0 else [],
                chart=dict(xLabel='入射角 θ / °' if p['mode']==0 else '',yLabel='反射率 / %' if p['mode']==0 else '',currentX=p['angleDeg'] if p['mode']==0 else p['axisAngleDeg'],currentY=b['reflectancePct'] if p['mode']==0 else b['separationMm']))
