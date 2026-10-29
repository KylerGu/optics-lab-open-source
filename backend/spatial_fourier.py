"""Actual co-axial f/f apparatus: coherent Gaussian/cosine focal-plane spectrum.

The relative image uses I/I(0). Finite circular screen power is integrated from
the dimensional Fourier field and never inferred from geometric ray samples.
"""
import math
import numpy as np
from scipy.integrate import quad
from .spatial_components import basis,sub,dot
from .scene_fourier_lens import fourier_values,fourier_at


def apparatus_parameters(experiment):
    groups={k:[e for e in experiment.elements if e.kind==k] for k in ['laser','amplitude-grating','lens','screen']}
    if len(experiment.elements)!=4 or any(len(v)!=1 for v in groups.values()):return None
    source,grating,lens,screen=(groups[k][0] for k in groups)
    if source.beamModel!='gaussian' or grating.gratingProfile!='sinusoidal':return None
    n,u,v=basis(grating);f=lens.focalLengthMm;w=source.beamRadiusMm
    near=lambda a,b:abs(a-b)<1e-6
    axial=lambda e:dot(sub(e.position,grating.position),n)
    if not (.5<=w<=2 and 80<=f<=250 and 80<=grating.gratingPeriodUm<=400 and 380<=source.wavelengthNm<=780):return None
    for e in [source,lens,screen]:
        en,_,_=basis(e);offset=sub(e.position,grating.position)
        if dot(en,n)<1-1e-12 or abs(dot(offset,u))>1e-6 or abs(dot(offset,v))>1e-6:return None
    if not (near(axial(lens),f) and near(axial(screen),2*f) and axial(source)<0 and near(-axial(source),source.waistOffsetMm)):return None
    if min(grating.gratingWidthMm,grating.gratingHeightMm,lens.diameterMm)<12*w-1e-6 or abs(screen.probeOffsetMm)>min(3,screen.diameterMm/2):return None
    p=dict(wavelengthNm=source.wavelengthNm,periodMm=grating.gratingPeriodUm*.001,waistMm=w,modulation=grating.gratingModulation,focalLengthMm=f,observationUm=screen.probeOffsetMm*1000)
    return p,source,grating,screen


def spectrum_screen_power(p,power,radius):
    b=fourier_values(p);w=b['spotRadiusUm']*.001;order=b['orderPositionUm']*.001;m=p['modulation']
    components=[(0,1),(-order,m/2),(order,m/2)];total=0.
    # Gaussian cross products resolved separately, including partly intercepted orders.
    # t=sqrt(2)*(x-centre)/w keeps very narrow focal spots well resolved.
    for a,wa in components:
        for c,wc in components:
            if not wa or not wc:continue
            centre=(a+c)/2;lo=max(-8,math.sqrt(2)*(-radius-centre)/w);hi=min(8,math.sqrt(2)*(radius-centre)/w)
            if hi<=lo:continue
            def integrand(t):
                x=centre+w*t/math.sqrt(2)
                return math.exp(-t*t)*math.erf(math.sqrt(2)*math.sqrt(max(0,radius*radius-x*x))/w)
            integral=quad(integrand,lo,hi,epsabs=1e-11,epsrel=1e-11,limit=200)[0]
            total+=wa*wc*math.exp(-(a-c)**2/(2*w*w))*integral
    return max(0,power*total/(math.sqrt(math.pi)*(1+m)**2))


def calculate_spatial_fourier(experiment):
    apparatus=apparatus_parameters(experiment)
    if not apparatus:return None
    p,source,grating,screen=apparatus;b=fourier_values(p);w=p['waistMm'];m=p['modulation'];d=p['periodMm'];radius=screen.diameterMm/2
    input_power=source.powerMw*(1+m*m/2+2*m*math.exp(-.5*(math.pi*w/d)**2)+m*m/2*math.exp(-2*(math.pi*w/d)**2))/(1+m)**2
    captured=min(input_power,spectrum_screen_power(p,source.powerMw,radius))
    extent=min(radius,max(.03,(b['orderPositionUm']*1.3 if m else 0)*.001+4*b['spotRadiusUm']*.001,abs(p['observationUm'])*.001*1.1))
    samples=min(12001,max(801,math.ceil(2*extent/(b['spotRadiusUm']*.001/16))+1));samples+=1-samples%2
    points=[dict(xMm=float(x),intensity=fourier_at(p,float(x)*1000)['intensity']) for x in np.linspace(-extent,extent,samples)]
    return dict(screenId=screen.id,sourceId=source.id,gratingId=grating.id,parameters=p,**b,pointIntensity=fourier_at(p)['intensity'],inputPowerMw=input_power,capturedPowerMw=captured,points=points)
