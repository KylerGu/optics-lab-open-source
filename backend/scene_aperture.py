"""Circular apertures and exact meridional refraction at a biconvex lens."""
import math
from .scene_geometrical import image_distance


def circle_overlap(r, q, distance):
    """Area of two disks; used for a uniformly filled entrance lens aperture."""
    d=abs(distance)
    if d>=r+q:return 0.
    if d<=abs(r-q):return math.pi*min(r,q)**2
    a=math.acos(max(-1,min(1,(d*d+r*r-q*q)/(2*d*r))))
    b=math.acos(max(-1,min(1,(d*d+q*q-r*r)/(2*d*q))))
    product=(-d+r+q)*(d+r-q)*(d-r+q)*(d+r+q)
    return r*r*a+q*q*b-.5*math.sqrt(max(0,product))


def aperture_geometry(p, height=None):
    f,u,z=p['f'],p['u'],p['z'];h=p['h'] if height is None else height
    a=1+z/u-(z/f if z>0 else 0);b=-z*h/u
    lens_r=p['lensD']/2;stop_r=p['stopD']/2
    stop_limit=stop_r/abs(a) if abs(a)>1e-12 else math.inf
    active='stop' if stop_limit<lens_r-1e-10 else 'lens'
    if abs(a)<1e-12:
        fraction=1. if abs(b)<=stop_r else 0.
        lo,hi=(-lens_r,lens_r) if fraction else (0,0)
    else:
        center=-b/a
        fraction=circle_overlap(lens_r,stop_limit,center)/(math.pi*lens_r*lens_r)
        lo=max(-lens_r,center-stop_limit);hi=min(lens_r,center+stop_limit)
        if hi<lo:lo=hi=0
    entrance=exit_pupil=(0.,p['lensD'])
    if active=='stop':
        if abs(z)<1e-12:entrance=exit_pupil=(0.,p['stopD'])
        else:
            pupil_v=image_distance(f,abs(z))
            imaged=(None,None) if pupil_v is None else ((-pupil_v if z>0 else pupil_v),abs(pupil_v/z)*p['stopD'])
            if z>0:entrance=imaged;exit_pupil=(z,p['stopD'])
            else:entrance=(z,p['stopD']);exit_pupil=imaged
    return dict(a=a,b=b,lo=lo,hi=hi,fraction=max(0,min(1,fraction)),active=active,entrance=entrance,exit=exit_pupil,stopLimit=stop_limit)


def cauchy_index(a,b,wavelength):return a+b/(wavelength/1000)**2


def lens_dimensions(p):
    radius=p['R'];aperture=p['diameter']/2
    thickness=2*(radius-math.sqrt(radius*radius-aperture*aperture))+p['edge']
    return radius,aperture,thickness


def thick_lens(n,r,t):
    power=(n-1)*(2/r-(n-1)*t/(n*r*r))
    focal=1/power
    return focal,focal*(1-(n-1)*t/(n*r))


def refract_vector(direction,normal,n1,n2):
    cosine=-sum(a*b for a,b in zip(direction,normal));eta=n1/n2
    radicand=1-eta*eta*(1-cosine*cosine)
    if radicand<-1e-12:return None
    factor=eta*cosine-math.sqrt(max(0,radicand))
    return tuple(eta*a+factor*b for a,b in zip(direction,normal))


def trace_biconvex(p,height,wavelength):
    r,ap,t=lens_dimensions(p);n=cauchy_index(p['A'],p['B'],wavelength)
    x=r-math.sqrt(r*r-height*height);front=(x,height)
    inside=refract_vector((1.,0.),((x-r)/r,height/r),1.,n)
    if inside is None:return None
    cx=t-r;ox=x-cx;oy=height
    dot=ox*inside[0]+oy*inside[1];disc=dot*dot-(ox*ox+oy*oy-r*r)
    if disc<0:return None
    distances=[-dot-math.sqrt(disc),-dot+math.sqrt(disc)]
    candidates=[(x+length*inside[0],height+length*inside[1]) for length in distances if length>1e-10 and x+length*inside[0]>=cx-1e-8]
    if not candidates:return None
    back=min(candidates,key=lambda point:point[0]);outward=((back[0]-cx)/r,back[1]/r)
    outgoing=refract_vector(inside,tuple(-k for k in outward),n,1.)
    if outgoing is None:return None
    focus=back[0]-back[1]*outgoing[0]/outgoing[1]-t if abs(outgoing[1])>1e-14 else None
    return dict(front=front,back=back,inside=inside,outgoing=outgoing,focus=focus,n=n,thickness=t)


def spherical_spots(p,rings=64):
    _,ap,t=lens_dimensions(p)
    wavelengths=[450,550,650] if p['mode']==1 else [p['wavelength']]
    colors={450:'#568cdc',550:'#40ac82',650:'#d98275'}
    points=[];squares=[]
    for wavelength in wavelengths:
        for j in range(rings):
            height=ap*math.sqrt((j+.5)/rings)
            ray=trace_biconvex(p,height,wavelength)
            if ray is None:continue
            bx,by=ray['back'];dx,dy=ray['outgoing'];rho=by+(t+p['screen']-bx)*dy/dx
            squares.append(rho*rho)
            for k in range(8):
                phi=(k+j*.61803398875)*math.tau/8
                points.append(dict(x=rho*math.cos(phi),y=rho*math.sin(phi),color=colors.get(wavelength,'#79a5cb')))
    return points,math.sqrt(sum(squares)/len(squares)) if squares else None


def best_geometric_screen(p,rings=64):
    """Least squares of ray heights, with the same uniform-disk weights as RMS."""
    _,ap,t=lens_dimensions(p);cross=denominator=0.
    for wavelength in ([450,550,650] if p['mode']==1 else [p['wavelength']]):
        for j in range(rings):
            ray=trace_biconvex(p,ap*math.sqrt((j+.5)/rings),wavelength)
            if ray is None:continue
            bx,by=ray['back'];dx,dy=ray['outgoing'];slope=dy/dx;intercept=by+(t-bx)*slope
            cross+=intercept*slope;denominator+=slope*slope
    if denominator<=0:raise ValueError('当前光线没有唯一的有限最小几何光斑平面。')
    return -cross/denominator


def calculate_aperture(state,definition,revision):
    p=state['parameters'];model=definition['model'];metrics=[];segments=[];markers=[];regions=[];devices=[];curve=[];warnings=[]
    def metric(key,label,value,unit='',note=''):metrics.append(dict(key=key,label=label,value=value,unit=unit,note=note))
    def seg(start,end,role='transmitted',dashed=False,color=None):segments.append(dict(start=start,end=end,role=role,dashed=dashed,power=1,**({'color':color} if color else {})))
    def marker(x,y,label,role='annotation'):markers.append(dict(x=x,y=y,label=label,role=role))
    def device(kind,x,height,label,sign=1):devices.append(dict(kind=kind,x=x,height=height,label=label,sign=sign))
    if model=='aperture':
        g=aperture_geometry(p);f,u,z,h=p['f'],p['u'],p['z'],p['h'];v=image_distance(f,u)
        metric('v','物体的像距',v,'mm','孔径改变通光范围，理想像距不变')
        metric('apertureStop','限制轴上光束的孔径',0 if g['active']=='lens' else 1,'','0：透镜口径；1：外置光阑；等大时记为透镜口径')
        for key,label,pupil in [('entrance','入瞳',g['entrance']),('exit','出瞳',g['exit'])]:
            metric(key+'Position',label+'位置',pupil[0],'mm','从透镜量起；正值在像侧，负值在物侧；空值表示在无穷远')
            metric(key+'Diameter',label+'直径',pupil[1],'mm','光瞳是限制轴上光束的孔径经前方或后方透镜所成的像')
        metric('throughput','通光面积比例',g['fraction']*100,'%','相对于均匀填满透镜口径的光束，圆形孔径重叠面积比例；不含余弦照度、吸收与衍射')
        metric('acceptedWidth','透镜面可通光范围宽度',max(0,g['hi']-g['lo']),'mm','当前物点在子午面内可通过的光线范围')
        xmin=-u*1.15;xmax=max(v*1.12 if v is not None and v>0 else 0,z*1.2,160);ymax=max(p['lensD']*.8,p['stopD']*.8,h*1.3,abs(v*h/u)*1.15 if v is not None else 0,20)
        device('lens',0,p['lensD']/2,'透镜口径');device('stop',z,p['stopD']/2,'外置光阑')
        heights={-p['lensD']/2+j*p['lensD']/16 for j in range(17)}
        if g['fraction']>0:heights.update([g['lo'],(g['lo']+g['hi'])/2,g['hi']])
        for y0 in sorted(heights):
            t0=(y0-h)/u;t1=t0-y0/f;ys=g['a']*y0+g['b'];passed=abs(ys)<=p['stopD']/2+1e-9
            if z<=0:
                seg([-u,h],[z,ys],'incident' if passed else 'blocked')
                if passed:seg([z,ys],[0,y0],'incident');seg([0,y0],[xmax,y0+xmax*t1])
            else:
                seg([-u,h],[0,y0],'incident' if passed else 'blocked');seg([0,y0],[z,ys],'internal' if passed else 'blocked')
                if passed:seg([z,ys],[xmax,y0+xmax*t1])
        marker(-u,h,'物体','object')
        if v is not None and v>0:marker(v,-v*h/u,'理想像点','image')
        pupils=[('entrance','入瞳 / 出瞳')] if g['entrance']==g['exit'] else [('entrance','入瞳'),('exit','出瞳')]
        for key,label in pupils:
            x,diam=g[key]
            if x is not None and xmin<=x<=xmax and diam<ymax*2:device('pupil',x,diam/2,label)
            elif x is not None:warnings.append(label+'超出图中范围，读数保留实际位置与大小。')
        status=('外置光阑' if g['active']=='stop' else '透镜口径')+'限制轴上光束'+('；当前物点完全被遮挡' if g['fraction']<1e-12 else '')
        if abs(g['a'])<1e-12:warnings.append('外置孔径处在此物体的理想像面，主要限制视场；轴上光束仍由透镜口径限制。')
        if h/u>.15 or p['lensD']/(2*f)>.3:warnings.append('当前物点偏离光轴较远或孔径较大，小角度近似的实际精度会下降；图中仍显示所声明的薄透镜模型。')
        if g['entrance'][0] is None or g['exit'][0] is None:warnings.append('光阑处于透镜焦平面，一个光瞳位于无穷远；不能把它画成有限直径的孔。')
        for j in range(121):
            hs=j*80/120;curve.append(dict(x=hs,y=aperture_geometry(p,hs)['fraction']*100))
        chart=dict(xLabel='物点离轴高度 / mm',yLabel='通光面积比例 / %',currentX=h,currentY=g['fraction']*100)
        preview=None
    else:
        r,ap,t=lens_dimensions(p);n=cauchy_index(p['A'],p['B'],p['wavelength']);efl,bfl=thick_lens(n,r,t)
        edge_ray=trace_biconvex(p,ap,p['wavelength']);edge_focus=edge_ray['focus'] if edge_ray else None
        blue=thick_lens(cauchy_index(p['A'],p['B'],450),r,t)[1];red=thick_lens(cauchy_index(p['A'],p['B'],650),r,t)[1]
        points,rms=spherical_spots(p)
        metric('index','当前波长折射率',n);metric('thickness','透镜中心厚度',t,'mm','由曲率、口径与边缘厚度共同确定')
        metric('effectiveFocal','近轴有效焦距',efl,'mm','从主面量起；屏距从透镜后顶点量起')
        metric('backFocal','近轴后焦距',bfl,'mm');metric('marginalFocus','边缘光线焦距',edge_focus,'mm','从后顶点量起，按两次精确折射求交点')
        metric('longitudinalSA','纵向球差',bfl-edge_focus if edge_focus is not None else None,'mm','近轴后焦距减边缘光线焦距')
        metric('chromaticShift','红蓝近轴焦距差',red-blue,'mm','650 nm 后焦距减 450 nm 后焦距；使用可调教学色散模型')
        metric('rmsRadius','屏上几何均方根半径',rms,'mm','表示光线落点离中心的平均散开程度，越小越集中；均匀圆形入瞳取64个等面积环，三色等权。只含球差、色差与离焦')
        xmin=-r*.35;xmax=t+max(p['screen']*1.08,bfl*1.2);ymax=max(ap*1.3,10)
        front=[(r-math.sqrt(r*r-y*y),y) for y in [-ap+2*ap*j/40 for j in range(41)]]
        back=[(t-r+math.sqrt(r*r-y*y),y) for y in [ap-2*ap*j/40 for j in range(41)]]
        regions=[dict(points=front+back,label='球面透镜')];device('screen',t+p['screen'],ymax*.85,'观察屏')
        wavelengths=[450,550,650] if p['mode']==1 else [p['wavelength']]
        for wavelength in wavelengths:
            color={450:'#568cdc',550:'#40ac82',650:'#d98275'}.get(wavelength,'#238771')
            for j in (-1,-.65,-.25,.25,.65,1):
                height=ap*j;ray=trace_biconvex(p,height,wavelength)
                if ray is None:continue
                bx,by=ray['back'];dx,dy=ray['outgoing'];end=(t+p['screen'],by+(t+p['screen']-bx)*dy/dx)
                seg([xmin,height],ray['front'],'incident',color=color);seg(ray['front'],ray['back'],'internal',color=color);seg(ray['back'],end,color=color)
                ymax=max(ymax,abs(end[1])*1.1)
        marker(t+bfl,0,'近轴焦点','focus')
        if edge_focus is not None:marker(t+edge_focus,0,'边缘焦点','focus')
        for j in range(121):
            y=ap*j/120;ray=trace_biconvex(p,max(1e-6,y),p['wavelength']);curve.append(dict(x=y,y=ray['focus'] if ray else None))
        chart=dict(xLabel='入射光线高度 / mm',yLabel=f'{p["wavelength"]:g} nm 后焦距 / mm',currentX=ap,currentY=edge_focus)
        extent=max(.25,max((math.hypot(q['x'],q['y']) for q in points),default=0)*1.15)
        preview=dict(kind='geometric-spots',diameter=0,center=0,extent=extent,points=points,note='均匀圆形入瞳的几何光线落点；范围会自动缩放，请对照半径读数。未计算衍射。')
        status='红绿蓝光分别折射：球差与色差叠加' if p['mode']==1 else '单色平行入射：边缘与近轴光线焦点不同'
        warnings.append('折射率使用 n = A + B/λ² 的可调教学模型，不代表某一牌号玻璃；透镜两面采用精确折射，未计反射损耗、衍射与其他像差。')
    return dict(revision=revision,input=state,modelVersion='scene-physics-3',model=model,scope=definition['scope'],status=status,metrics=metrics,segments=segments,markers=markers,regions=regions,devices=devices,bounds=[xmin,xmax,-ymax,ymax],curve=curve,chart=chart,warnings=warnings,imagePreview=preview)
