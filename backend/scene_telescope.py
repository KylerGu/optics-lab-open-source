"""Thin-lens telescope, circular-aperture clipping and objective diffraction limit."""
import math

RAD=math.pi/180
ARCSECONDS=1/RAD*3600


def optics(p):
    fe=p['f2']*p['k2'];a=1-p['d']/p['f1'];c=-1/p['f1']-a/fe;dd=1-p['d']/fe
    afocal=abs(c)<1e-12
    q=fe*p['d']/(p['d']-fe) if abs(p['d']-fe)>1e-12 else None
    dp=abs(fe/(p['d']-fe))*p['aperture'] if q is not None else None
    limited=abs(a)*p['aperture']>p['eyepieceDiameter']+1e-9
    return dict(fe=fe,a=a,c=0 if afocal else c,dd=dd,afocal=afocal,M=-p['f1']/fe if afocal else None,q=q,
                pupilPosition=0 if limited else q,pupilDiameter=p['eyepieceDiameter'] if limited else dp,
                resolution=1.22*p['wavelength']/1e6/p['aperture']*ARCSECONDS)


def throughput(p,theta,vertical=0):
    o=optics(p);g=o['a']+p['eyeDistance']*o['c'];b=p['d']+p['eyeDistance']*o['dd']
    circles=[(0,0,p['aperture']/2)]
    for factor,shift,radius,offset in [(o['a'],p['d'],p['eyepieceDiameter']/2,0),(g,b,p['eyeDiameter']/2,p['eyeOffset'])]:
        if abs(factor)<1e-12:
            if math.hypot(shift*theta-offset,shift*vertical)>=radius:return 0
        else:circles.append(((offset-shift*theta)/factor,-shift*vertical/factor,radius/abs(factor)))
    s=min(circles,key=lambda c:c[2])
    if all(math.hypot(c[0]-s[0],c[1]-s[1])+s[2]<=c[2]+1e-10 for c in circles):return min(1,(s[2]/(p['aperture']/2))**2)
    low=max(x-r for x,y,r in circles);high=min(x+r for x,y,r in circles)
    if high<=low:return 0
    dx=(high-low)/192;area=0
    for i in range(192):
        x=low+(i+.5)*dx
        spans=[(y-math.sqrt(max(0,r*r-(x-cx)**2)),y+math.sqrt(max(0,r*r-(x-cx)**2))) for cx,y,r in circles]
        area+=max(0,min(t for b,t in spans)-max(b for b,t in spans))*dx
    return max(0,min(1,area/(math.pi*(p['aperture']/2)**2)))


def field(p):
    o=optics(p)
    if not o['afocal']:return None
    g=o['a']+p['eyeDistance']*o['c'];b=p['d']+p['eyeDistance']*o['dd']
    disks=[(0,0,p['aperture']/2)];low=-3*RAD;high=3*RAD
    def constrain(k,t,r):
        nonlocal low,high
        if abs(k)<1e-12:
            if abs(t)>=r:low=1;high=-1
        else:
            left=(-r-t)/k;right=(r-t)/k
            low=max(low,min(left,right));high=min(high,max(left,right))
    for factor,shift,radius,offset in [(o['a'],p['d'],p['eyepieceDiameter']/2,0),(g,b,p['eyeDiameter']/2,p['eyeOffset'])]:
        if abs(factor)<1e-12:constrain(shift,-offset,radius)
        else:disks.append((-shift/factor,offset/factor,radius/abs(factor)))
    for i,first in enumerate(disks):
        for second in disks[:i]:constrain(first[0]-second[0],first[1]-second[1],first[2]+second[2])
    return [low/RAD,high/RAD] if high>low else None


def calculate_telescope(state,definition,revision):
    p=state['parameters'];o=optics(p);theta=p['angle']*RAD;f=field(p);fraction=throughput(p,theta)
    metrics=[];segments=[]
    def metric(key,label,value,unit=''):metrics.append(dict(key=key,label=label,value=value,unit=unit,note=''))
    metric('afocalLength','平行出射所需间距',p['f1']+o['fe'],'mm');metric('angularM','角放大率 M',o['M'],'倍')
    metric('centralAngle','中心光线出射方向',o['dd']*p['angle'],'°');metric('angularSpread','出射角全宽',abs(o['c'])*p['aperture']*1000,'mrad')
    metric('resolution','物镜角分辨率',o['resolution'],'角秒');metric('pupilPosition','出瞳距目镜',o['pupilPosition'],'mm');metric('pupilDiameter','出瞳直径',o['pupilDiameter'],'mm')
    metric('acceptedLight','入眼光束比例',fraction*100,'%');metric('visibleField','近轴内可见视场',f[1]-f[0] if f else 0 if o['afocal'] else None,'°')
    xmin=-p['f1']*.45;xmax=p['d']+max(80,p['eyeDistance']*1.2,abs(o['fe'])*2)
    ymax=max(15,p['aperture']*.75,p['eyepieceDiameter']*.75,abs(theta*p['f1'])*1.3)
    def seg(start,end,role):segments.append(dict(start=start,end=end,role=role,dashed=False,power=1))
    for h in [-p['aperture']/2,0,p['aperture']/2]:
        t1=theta-h/p['f1'];y2=h+p['d']*t1;t2=t1-y2/o['fe']
        seg([xmin,h+xmin*theta],[0,h],'incident');seg([0,h],[p['d'],y2],'blocked' if abs(y2)>p['eyepieceDiameter']/2 else 'internal')
        if abs(y2)<=p['eyepieceDiameter']/2:seg([p['d'],y2],[xmax,y2+(xmax-p['d'])*t2],'transmitted')
        ymax=max(ymax,abs(y2)*1.3)
    warnings=[]
    if p['study']!=2 and not o['afocal']:warnings.append('两镜间距偏离对焦位置；请恢复平行出射后比较放大率与视场。')
    angles=[abs((s['end'][1]-s['start'][1])/(s['end'][0]-s['start'][0])) for s in segments if s['role']=='transmitted']
    if p['study']!=2 and angles and max(angles)>.15:warnings.append('出射倾角较大，近轴模型的结果仅供近似参考。')
    if p['study']==2:
        curve=[dict(x=5+i*.75,y=1.22*p['wavelength']/1e6/(5+i*.75)*ARCSECONDS) for i in range(101)]
        chart=dict(xLabel='物镜有效直径 / mm',yLabel='角分辨率 / 角秒',currentX=p['aperture'],currentY=o['resolution'])
    elif p['study'] in (1,3):
        curve=[dict(x=-3+i*.05,y=throughput(p,(-3+i*.05)*RAD)*100 if o['afocal'] else None) for i in range(121)]
        chart=dict(xLabel='远物方向 / °',yLabel='入眼光束比例 / %',currentX=p['angle'],currentY=fraction*100 if o['afocal'] else None)
    else:
        curve=[dict(x=-p['aperture']/2+i*p['aperture']/160,y=(o['c']*(-p['aperture']/2+i*p['aperture']/160)+o['dd']*theta)/RAD) for i in range(161)]
        chart=dict(xLabel='物镜入射高度 / mm',yLabel='出射角 / °',currentX=0,currentY=o['dd']*p['angle'])
    return dict(revision=revision,input=state,modelVersion='telescope-study-1',model='telescope',scope=definition['scope'],
                status=('开普勒倒像，平行出射' if o['fe']>0 else '伽利略正像，平行出射') if o['afocal'] else '未对焦：出射光不平行',
                metrics=metrics,warnings=warnings,bounds=[xmin,xmax,-ymax,ymax],segments=segments,
                markers=[dict(x=p['f1'],y=p['f1']*theta,label='中间像',role='image')] if 0<p['f1']<p['d'] else [],regions=[],
                devices=[dict(kind='lens',x=0,height=p['aperture']/2,label='物镜',sign=1),dict(kind='lens',x=p['d'],height=p['eyepieceDiameter']/2,label='目镜',sign=p['k2'])],
                curve=curve,chart=chart,imagePreview=None)
