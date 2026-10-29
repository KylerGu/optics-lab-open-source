"""Coherent 4f output derived from the actual apparatus, never a saved scene replay.

Equal ideal lenses, Gaussian waist at a sinusoidal amplitude mask, f/2f/f
spacing, and a long rectangular pass/stop mask at the common focal plane.
Finite apertures must cover at least six Gaussian radii. General defocused
or clipped wave propagation is intentionally outside this bounded model.
"""
import math
import numpy as np
from scipy.special import erfcx, erf
from scipy.integrate import simpson
from .spatial_components import basis, sub, dot
from .scene_four_f import FourF


def apparatus_parameters(experiment):
    elements=experiment.elements
    groups={k:[e for e in elements if e.kind==k] for k in ['laser','amplitude-grating','lens','slit','screen']}
    if len(elements)!=sum(map(len,groups.values())) or any(len(groups[k])!=n for k,n in [('laser',1),('amplitude-grating',1),('lens',2),('screen',1)]) or len(groups['slit'])>1:return None
    source,grating,screen=(groups[k][0] for k in ['laser','amplitude-grating','screen'])
    if source.beamModel!='gaussian' or grating.gratingProfile!='sinusoidal':return None
    n,u,v=basis(grating)
    near=lambda a,b:abs(a-b)<1e-6
    axial=lambda e:dot(sub(e.position,grating.position),n)
    lenses=sorted(groups['lens'],key=axial);l1,l2=lenses;f=l1.focalLengthMm;w=source.beamRadiusMm
    mask=groups['slit'][0] if groups['slit'] else None
    if not (.5<=w<=2 and 80<=f<=130 and 80<=grating.gratingPeriodUm<=400 and 380<=source.wavelengthNm<=780):return None
    for e in [source,l1,l2,screen]+([mask] if mask else []):
        en,eu,_=basis(e)
        if dot(en,n)<1-1e-12 or (e==mask and dot(eu,u)<1-1e-12):return None
        offset=sub(e.position,grating.position)
        if abs(dot(offset,v))>1e-6 or e!=mask and abs(dot(offset,u))>1e-6:return None
    if not (near(l2.focalLengthMm,f) and near(axial(l1),f) and near(axial(l2),3*f) and near(axial(screen),4*f) and axial(source)<0 and near(-axial(source),source.waistOffsetMm)):return None
    if min(grating.gratingWidthMm,grating.gratingHeightMm,l1.diameterMm,l2.diameterMm)<12*w-1e-6:return None
    if mask and (not near(axial(mask),2*f) or mask.slitHeightMm<12*source.wavelengthNm*1e-6*f/(math.pi*w) or not (.01<=mask.slitWidthMm<=5) or abs(dot(sub(mask.position,grating.position),u))>2.2):return None
    if abs(screen.probeOffsetMm)>min(3,screen.diameterMm/2):return None
    p=dict(wavelengthNm=source.wavelengthNm,periodMm=grating.gratingPeriodUm*.001,waistMm=w,modulation=grating.gratingModulation,focalLengthMm=f,filterWidthUm=mask.slitWidthMm*1000 if mask else 200,filterOffsetUm=dot(sub(mask.position,grating.position),u)*1000 if mask else 0,filterMode=(0 if mask.slitMode=='pass' else 1) if mask else 2,observationMm=screen.probeOffsetMm)
    return p,source,grating,mask,screen


def field_at(model,coordinates):
    """Analytic Gaussian band integral; scaled erfc avoids complex-erf overflow."""
    x=np.asarray(coordinates,dtype=float);p=model.p;m=p['modulation'];w=p['waistMm'];beta=x/w
    full=np.exp(-(x/w)**2)*(1+m*np.cos(2*math.pi*x/p['periodMm']))/(1+m)
    if p['filterMode']==2:return full.astype(complex)
    passed=np.zeros(x.shape,dtype=complex)
    for center,weight in model.components:
        if not weight:continue
        left=max(-8,model.alpha*(model.lo-center));right=min(8,model.alpha*(model.hi-center))
        if right<=left:continue
        a=np.exp(-left*left-2j*left*beta)*erfcx(left+1j*beta)
        b=np.exp(-right*right-2j*right*beta)*erfcx(right+1j*beta)
        passed+=weight/(2*(1+m))*np.exp(-2j*math.pi*center*x)*(a-b)
    return passed if p['filterMode']==0 else full-passed


def calculate_spatial_four_f(experiment):
    apparatus=apparatus_parameters(experiment)
    if not apparatus:return None
    p,source,grating,mask,screen=apparatus;b=FourF(p);w=p['waistMm'];m=p['modulation'];d=p['periodMm']
    # Source power is before the input amplitude mask; T uses power after it.
    input_power=source.powerMw*(1+m*m/2+2*m*math.exp(-.5*(math.pi*w/d)**2)+m*m/2*math.exp(-2*(math.pi*w/d)**2))/(1+m)**2
    output_power=input_power*b.transmission
    radius=screen.diameterMm/2
    step=min(d/24,w/64);count=max(2048,math.ceil(math.pi*radius/step));count+=count%2
    theta=np.linspace(-math.pi/2,math.pi/2,count+1);x=radius*np.sin(theta)
    vertical=w*math.sqrt(math.pi/2)*erf(math.sqrt(2)*radius*np.cos(theta)/w)
    captured=float(simpson(np.abs(field_at(b,x))**2*vertical*radius*np.cos(theta),x=theta))*2*source.powerMw/(math.pi*w*w)
    extent=min(radius,max(3*w,abs(p['observationMm'])*1.2));samples=max(801,math.ceil(32*extent/d)+1)
    coordinates=np.linspace(-extent,extent,samples);values=np.abs(field_at(b,coordinates))**2
    return dict(screenId=screen.id,sourceId=source.id,gratingId=grating.id,filterId=mask.id if mask else None,parameters=p,transmission=b.transmission,pointIntensity=float(abs(field_at(b,p['observationMm']))**2),inputPowerMw=input_power,outputPowerMw=output_power,capturedPowerMw=max(0,min(output_power,captured)),points=[dict(xMm=float(x),intensity=float(i)) for x,i in zip(coordinates,values)])
