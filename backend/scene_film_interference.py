"""Lossless single-film Fresnel/Airy reflection and local Newton gap geometry."""
import math

def reflection(a,b,cycles):
    c=math.cos(2*math.pi*(cycles%1))
    return max(0.,min(1.,(a*a+b*b+2*a*b*c)/(1+(a*b)**2+2*a*b*c)))

def thin_values(p):
    angle=math.radians(p['incidentAngleDeg']); sine=math.sin(angle)
    cf=math.sqrt(1-(sine/p['filmIndex'])**2); cs=math.sqrt(1-(sine/p['substrateIndex'])**2)
    a=(math.cos(angle)-p['filmIndex']*cf)/(math.cos(angle)+p['filmIndex']*cf)
    b=(p['filmIndex']*cf-p['substrateIndex']*cs)/(p['filmIndex']*cf+p['substrateIndex']*cs)
    period=p['wavelengthNm']/(2*p['filmIndex']*cf)
    def at(t):return dict(thicknessNm=t,deltaNm=2*p['filmIndex']*t*cf,reflectance=reflection(a,b,t/period))
    extrema=[reflection(a,b,0),reflection(a,b,.5)]; minimum=min(extrema); maximum=max(extrema)
    current=at(p['thicknessNm'])
    status='下表面无反射 · 膜厚不改变反射率' if maximum-minimum<1e-12 else '反射最弱' if abs(current['reflectance']-minimum)<1e-10 else '反射最强' if abs(current['reflectance']-maximum)<1e-10 else '反射强弱随膜厚变化'
    return dict(a=a,b=b,cosine=cf,angleFilmDeg=math.degrees(math.asin(sine/p['filmIndex'])),periodNm=period,min=minimum,max=maximum,contrast=maximum-minimum,current=current,at=at,status=status)

def gap_thickness(p,r):return p['centralGapNm']+r*r/(p['curvatureRadiusMm']+math.sqrt(p['curvatureRadiusMm']**2-r*r))*1e6

def newton_values(p):
    a=(1.52-p['gapIndex'])/(1.52+p['gapIndex']); maximum=4*a*a/(1+a*a)**2
    def at(r):
        t=gap_thickness(p,r); delta=2*p['gapIndex']*t; cycles=delta/p['wavelengthNm']; raw=reflection(a,-a,cycles)/maximum
        intensity=0. if raw<1e-12 else 1. if 1-raw<1e-12 else raw
        return dict(thicknessNm=t,deltaNm=delta,cycles=cycles,intensity=intensity,reflectance=maximum*intensity)
    def radius(cycles):
        sag=(cycles*p['wavelengthNm']/(2*p['gapIndex'])-p['centralGapNm'])*1e-6
        if sag< -1e-12 or sag>p['curvatureRadiusMm']:return None
        return math.sqrt(max(0.,2*p['curvatureRadiusMm']*sag-sag*sag))
    current=at(p['observationRadiusMm'])
    return dict(at=at,radiusForCycles=radius,maximum=maximum,current=current,firstDarkRadiusMm=radius(1),status='暗环 · 相消干涉' if current['intensity']==0 else '亮环 · 相长干涉' if current['intensity']==1 else '明暗之间')

def film_target(p,target):
    if target not in ('bright','dark'):raise ValueError('未知干涉目标。')
    if p['mode']==0:
        b=thin_values(p)
        if b['contrast']<1e-12:raise ValueError('下表面无反射，不能通过膜厚调节反射强弱。')
        offset=0 if (b['a']*b['b']>0)==(target=='bright') else .5
        hi=math.floor(1500/b['periodNm']-offset+1e-10)
        order=max(0,min(hi,math.floor(p['thicknessNm']/b['periodNm']-offset+.5)))
        return dict(thicknessNm=max(0,min(1500,(order+offset)*b['periodNm'])))
    b=newton_values(p); offset=.5 if target=='bright' else 0
    lo=math.ceil(b['at'](0)['cycles']-offset-1e-10); hi=math.floor(b['at'](3)['cycles']-offset+1e-10)
    if lo>hi:raise ValueError('当前观察范围内没有对应圆环。')
    order=max(lo,min(hi,math.floor(b['current']['cycles']-offset+.5)))
    r=b['radiusForCycles'](order+offset)
    if r is None:raise ValueError('目标圆环不存在。')
    return dict(observationRadiusMm=max(0,min(3,r)))

def calculate_film(state,definition,revision):
    p=state['parameters']; thin=p['mode']==0; b=thin_values(p) if thin else newton_values(p); current=b['current']
    def metric(key,label,value,unit='',note=''):return dict(key=key,label=label,value=value,unit=unit,note=note)
    metrics=[metric('reflectancePct','反射率',current['reflectance']*100,'%'),metric('thicknessNm','此处膜厚',current['thicknessNm'],'nm'),metric('deltaNm','光程差',current['deltaNm'],'nm')]
    if thin:
        metrics += [metric('periodNm','一个反射强弱周期的膜厚变化',b['periodNm'],'nm'),metric('angleFilmDeg','膜内折射角',b['angleFilmDeg'],'°'),metric('minPct','最小反射率',b['min']*100,'%'),metric('maxPct','最大反射率',b['max']*100,'%'),metric('topPhaseDeg','上表面反射相位反转',180 if b['a']<0 else 0,'°'),metric('bottomPhaseDeg','下表面反射相位反转',None if abs(b['b'])<1e-12 else 180 if b['b']<0 else 0,'°'),metric('r01','上界面振幅反射系数',b['a']),metric('r12','下界面振幅反射系数',b['b'])]
    else:metrics += [metric('intensity','观察点相对光强',current['intensity']),metric('firstDarkRadiusMm','一阶暗环半径',b['firstDarkRadiusMm'],'mm','2nt=λ；中心抬起过多时，该阶圆环不存在。')]
    extent=1500 if thin else 3
    curve=[dict(x=extent*i/1500,y=b['at'](extent*i/1500)['reflectance']*100 if thin else b['at'](extent*i/1500)['intensity']) for i in range(1501)]
    return dict(revision=revision,input=state,modelVersion='film-interference-1',model=definition['model'],scope=definition['scope'],status=b['status'],warnings=[],metrics=metrics,bounds=[0,extent,0,100 if thin else 1],segments=[],markers=[],regions=[],curve=curve,chart=dict(xLabel='膜厚 / nm' if thin else '观察半径 / mm',yLabel='反射率 / %' if thin else '相对光强',currentX=p['thicknessNm'] if thin else p['observationRadiusMm'],currentY=current['reflectance']*100 if thin else current['intensity']))

def film_change_answer(before,after,definition):
    """Applied changes get concise, computed feedback with verified phase conditions."""
    p=after['parameters']; old=before['parameters']; changed=[f for f in definition['parameters'] if old[f['key']]!=p[f['key']]]
    def fmt(n):return f'{n:.4f}'.rstrip('0').rstrip('.')
    changes=[]
    for f in changed:
        if f['key']=='mode':changes.append('切换到'+('牛顿环' if p['mode']==1 else '薄膜干涉'))
        else:changes.append(f"{f['label']} {fmt(p[f['key']])} {f['unit']}".strip())
    intro='已调整：'+'；'.join(changes)+'。'
    if p['mode']==0:
        b=thin_values(p);c=b['current']; readings=f"反射率 {fmt(c['reflectance']*100)}%（{b['status']}），光程差 {fmt(c['deltaNm'])} nm。"
        phase='下表面没有反射，因此不能通过膜厚产生干涉条纹。' if b['contrast']<1e-12 else '两次反射都反转相位；传播光程差为半整数个波长时反射最弱，整数个波长时最强。' if b['a']*b['b']>0 else '只有一次反射相位反转；传播光程差为整数个波长时反射最弱，半整数个波长时最强。'
        if b['contrast']>=1e-12 and abs(c['reflectance']-b['min'])<1e-10 and b['min']>1e-12:phase+='两路反射不能完全抵消，最弱仍有少量反射光。'
    else:
        b=newton_values(p);c=b['current'];readings=f"观察点光强 I/Iₘₐₓ = {fmt(c['intensity'])}（{b['status']}），此处膜厚 {fmt(c['thicknessNm'])} nm，光程差 {fmt(c['deltaNm'])} nm。"
        phase='只有一次反射相位反转；传播光程差为半整数个波长时是亮环，整数个波长时是暗环。'
    return intro+'\n\n'+readings+'\n\n'+phase
