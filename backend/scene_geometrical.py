"""Paraxial mirrors and instruments; coordinates stay in physical millimetres."""
import math


def image_distance(f,u):
    den=1/f-1/u
    return 1/den if abs(den)>1e-12 else None


def double_matrix(f1,f2,d,u=0):
    a=1-d/f1
    b=u+d*(1-u/f1)
    c=-1/f1-a/f2
    dd=1-u/f1-b/f2
    return a,b,c,dd


def double_image(f1,f2,d,u):
    a,b,c,dd=double_matrix(f1,f2,d,u)
    v=-b/dd if abs(dd)>1e-12 else None
    return {'matrix':[a,b,c,dd],'v':v,'m':a+v*c if v is not None else None}


def calculate_geometrical(state,definition,revision):
    p=state['parameters'];model=definition['model']
    if model=='telescope':
        from .scene_telescope import calculate_telescope
        return calculate_telescope(state,definition,revision)
    if model=='microscope' and p.get('study',0) in (1,3):
        from .scene_microscope_performance import calculate_performance
        return calculate_performance(state,definition,revision)
    if model=='microscope' and p.get('mode',0)==1:
        from .scene_microscope import calculate_camera_microscope
        return calculate_camera_microscope(state,definition,revision)
    metrics=[];segments=[];markers=[];devices=[];curve=[];warnings=[]
    def metric(key,label,value,unit='',note=''):metrics.append(dict(key=key,label=label,value=value,unit=unit,note=note))
    def seg(a,b,role='transmitted',dashed=False):segments.append(dict(start=a,end=b,role=role,dashed=dashed,power=1))
    def mark(x,y,label,role='annotation'):markers.append(dict(x=x,y=y,label=label,role=role))
    def device(kind,x,height,label,sign=1):devices.append(dict(kind=kind,x=x,height=height,label=label,sign=sign))
    preview=None
    if model=='mirror':
        f=p['R']*p['kind']/2;u=p['u'];h=p['h']
        v=image_distance(f,u);m=-v/u if v is not None else None;image_h=m*h if m is not None else None
        metric('f','有向焦距 f',f,'mm');metric('v','像距 v',v,'mm','正值为镜前实像，负值为镜后虚像' if v is not None else '像在无穷远')
        metric('m','横向放大率 m',m);metric('imageHeight','像高 h′',image_h,'mm')
        xmin=-min(1800,max(u*1.18,(v or 0)*1.15,abs(f)*1.5));xmax=min(1800,max(60,-(v or 0)*1.18,abs(f)*.4))
        ymax=min(250,max(25,h*2.5,abs(image_h or 0)*1.3))
        device('mirror',0,ymax*.65,'凹面镜' if f>0 else '凸面镜',p['kind'])
        for y0,slope in [(h,h/f),(0,h/u)]:
            seg([-u,h],[0,y0],'incident');seg([0,y0],[xmin,y0+slope*xmin],'reflected')
            if v is not None and v<0:seg([0,y0],[-v,image_h],'virtual',True)
        mark(-u,h,'物体','object');mark(-f,0,'F','focus');mark(-2*f,0,'C','focus')
        if v is not None and xmin<-v<xmax and abs(image_h)<ymax:mark(-v,image_h,'实像' if v>0 else '虚像','image')
        if h/u>.1 or h/abs(f)>.1:warnings.append('本图采用近轴球面镜模型；大孔径或大角度的球差未包含。')
        if v is not None and abs(v)>1700:warnings.append('像超出图中范围，读数保留实际像距。')
        status='物在焦平面：反射光平行' if v is None else '镜前倒立实像' if v>0 else '镜后正立虚像'
        for j in range(241):
            u_sample=10+j*790/240;vs=image_distance(f,u_sample)
            curve.append(dict(x=u_sample,y=vs if vs is not None and abs(vs)<1500 else None))
        chart=dict(xLabel='物距 / mm',yLabel='像距 / mm',currentX=u,currentY=v)
    elif model in ('double-lens','microscope'):
        f1=p['f1']*p.get('k1',1);f2=p['f2']*p.get('k2',1);d=p['d'];u=p['u'];h=p['h']
        result=double_image(f1,f2,d,u);v=result['v'];m=result['m'];a,b,c,dd=result['matrix'];ih=m*h if m is not None else None
        v1=image_distance(f1,u);m1=-v1/u if v1 is not None else None
        fe=1/(1/f1+1/f2-d/(f1*f2)) if abs(c)>1e-12 else None
        metric('v1','中间像距 v₁' if model=='microscope' else '第一片像距 v₁',v1,'mm');metric('v','距目镜的像距 v₂' if model=='microscope' else '最终像距 v₂',v,'mm','负像距为出射光的反向延长线相交；第二片前方可能有第一片形成的实像' if v is not None else '最终像在无穷远')
        metric('m','总横向放大率 m',m);metric('equivalentFocal','系统等效焦距 F',fe,'mm','无焦系统' if fe is None else '从系统主面量起；不等于距第二片的后焦距')
        metric('matrixB','光线传递系数 B',b,'mm');metric('matrixD','光线传递系数 D',0 if abs(dd)<1e-12 else dd,'无量纲')
        if model=='microscope':
            metric('objectiveM','物镜横向放大率',m1)
            u2=d-v1 if v1 is not None else None
            angular=m1*p['near']/f2 if v is None and m1 is not None else m*p['near']/abs(v) if v is not None and v<0 and abs(v)>1e-9 else None
            metric('angularM','目视角放大率',angular,'倍','眼位于目镜附近，参考明视距离；只用于最终虚像或无穷远像')
            metric('fieldDiameter','目视视野直径',p['fieldNumber']/abs(m1) if angular is not None and m1 is not None and v1 is not None and 0<v1<d else None,'mm','由中间像面视场数估算')
            if v1 is None or v1<=0 or v1>=d:warnings.append('此配置未在两片透镜之间形成常规显微镜中间实像；按实际双透镜光路显示。')
            if v is not None and v>0:warnings.append('最终为实像，可作投影；不采用常规目视显微镜角放大率。')
        xmin=-min(1800,max(u*1.2,-(d+(v or 0))*1.12,30));xmax=min(2200,max(d+abs(f2)*1.5,d+(v or 0)*1.15,d*1.25))
        intermediate_h=m1*h if m1 is not None else 0
        ymax=min(250,max(.5 if model=='microscope' else 20,h*2.5,abs(ih or 0)*1.25,abs(intermediate_h)*1.5 if v1 is not None and 0<v1<d else 0))
        device('lens',0,ymax*.65,'物镜' if model=='microscope' else '透镜 1',1 if f1>0 else -1);device('lens',d,ymax*.65,'目镜' if model=='microscope' else '透镜 2',1 if f2>0 else -1)
        y2s=[];ray_angles=[]
        for y1 in (h,0):
            t1=(y1-h)/u-y1/f1;y2=y1+d*t1;t2=t1-y2/f2;y2s.append(y2)
            ray_angles.extend([abs((y1-h)/u),abs(t1),abs(t2)])
            seg([-u,h],[0,y1],'incident');seg([0,y1],[d,y2],'internal');seg([d,y2],[xmax,y2+(xmax-d)*t2])
            if v is not None and v<0:seg([d,y2],[d+v,ih],'virtual',True)
        ymax=min(400,max(ymax,max(abs(y) for y in y2s)*1.5))
        for dev in devices:dev['height']=ymax*.65
        mark(-u,h,'物体','object')
        if v1 is not None and 0<v1<d and abs(intermediate_h)<ymax:mark(v1,intermediate_h,'中间像','image')
        if v is not None and xmin<d+v<xmax and abs(ih)<ymax:mark(d+v,ih,'最终实像' if v>0 else '最终虚像','image')
        if v is not None and abs(v)>2000:warnings.append('最终像超出图中范围，读数仍为实际像距。')
        if h/u>.1:warnings.append('物体角度较大，实际系统可能超出近轴近似；未计算像差。')
        elif max(ray_angles)>.15:warnings.append('部分内部或出射光线倾角较大，真实系统可能超出近轴近似。')
        status='最终像在无穷远：出射光平行' if v is None else ('倒立' if m<0 else '正立')+('最终实像' if v>0 else '最终虚像')
        for j in range(241):
            ds=40+j*260/240 if model=='microscope' else 10+j*590/240;vs=double_image(f1,f2,ds,u)['v'];curve.append(dict(x=ds,y=vs if vs is not None and abs(vs)<1500 else None))
        chart=dict(xLabel='物镜到目镜距离 / mm' if model=='microscope' else '透镜间距 / mm',yLabel='距目镜的像距 / mm' if model=='microscope' else '距第二片的像距 / mm',currentX=d,currentY=v)
    else:raise ValueError('几何场景未实现。')
    if model=='telescope':
        from .scene_telescope import calculate_telescope
        return calculate_telescope(state,definition,revision)
    if model=='microscope' and p.get('study',0)==2:
        m=abs(next(metric['value'] for metric in metrics if metric['key']=='objectiveM') or 0)
        value=next(metric['value'] for metric in metrics if metric['key']=='fieldDiameter')
        curve=[dict(x=8+i*22/100,y=(8+i*22/100)/m if value is not None else None) for i in range(101)]
        chart=dict(xLabel='目镜视场数 / mm',yLabel='目视视野直径 D / mm',currentX=p['fieldNumber'],currentY=value)
    return dict(revision=revision,input=state,modelVersion='scene-physics-2',model=model,scope=definition['scope'],status=status,
                metrics=metrics,segments=segments,markers=markers,regions=[],devices=devices,bounds=[xmin,xmax,-ymax,ymax],curve=curve,chart=chart,warnings=warnings,imagePreview=preview)
