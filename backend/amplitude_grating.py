"""Thin, binary amplitude grating: local orders and a direct 1D Fresnel section.

mm internally. Orders are Fourier coefficients of a rectangular unit cell;
efficiencies are the scalar thin-mask estimate, not measured vector efficiencies.
The intensity section integrates each finite open strip analytically with
Fresnel C/S, so a nearby screen is not treated as a Fraunhofer screen.
Reference: TU Delft Interactive Optics, scalar diffraction, multiple slits.
"""
import math
import numpy as np
from scipy.special import fresnel
from .spatial_components import basis, add, sub, mul, dot


def grating_count(e):
    return max(1, math.floor(e.gratingWidthMm / (e.gratingPeriodUm * .001) + 1e-9))


def grating_mount_radius(e):
    return max(30.,math.hypot(e.gratingWidthMm,e.gratingHeightMm)/2+5)


def grating_passes(e, hit):
    _, u, v = basis(e)
    offset = sub(hit, e.position)
    return abs(dot(offset, u)) <= e.gratingWidthMm / 2 + 1e-9 and abs(dot(offset, v)) <= e.gratingHeightMm / 2 + 1e-9


def grating_orders(e, direction, wavelength_mm):
    n, u, v = basis(e)
    ku, kv, kn = dot(direction, u), dot(direction, v), dot(direction, n)
    spacing = wavelength_mm / (e.gratingPeriodUm * .001)
    duty = e.gratingSlitUm / e.gratingPeriodUm
    limit = math.sqrt(max(0., 1 - kv * kv))
    first, last = math.ceil((-limit-ku)/spacing), math.floor((limit-ku)/spacing)
    result = []
    for m in sorted(range(first, last+1), key=lambda m: (abs(m), m)):
        if e.gratingProfile=='sinusoidal' and (abs(m)>1 or m!=0 and e.gratingModulation==0):continue
        out_u = ku + m*spacing
        square = 1-out_u*out_u-kv*kv
        if square <= 1e-12:
            continue  # grazing and evanescent orders do not carry a forward ray
        coefficient = ((1 if m==0 else e.gratingModulation/2)/(1+e.gratingModulation)) if e.gratingProfile=='sinusoidal' else duty if m == 0 else math.sin(math.pi*m*duty)/(math.pi*m)
        efficiency = coefficient*coefficient
        if efficiency < 1e-28: efficiency = 0.
        outgoing = add(add(mul(u, out_u), mul(v, kv)), mul(n, math.copysign(math.sqrt(square), kn)))
        result.append({'m':m, 'direction':outgoing, 'angleDeg':math.degrees(math.atan2(out_u, abs(dot(outgoing,n)))), 'efficiency':efficiency})
    return result


def fresnel_intensity(e, wavelength_mm, distance_mm, coordinates):
    """I/I_in from complete centred periods, with opaque edge margins.

    Rectangular-strip Fresnel integral (1-i)/2 * sum(delta C+i delta S).
    Chunking bounds working memory independently of slit count or screen samples.
    """
    period, slit = e.gratingPeriodUm*.001, e.gratingSlitUm*.001
    count = grating_count(e)
    centres = (np.arange(count)-(count-1)/2)*period
    scale = math.sqrt(2/(wavelength_mm*distance_mm))
    x = np.asarray(coordinates, dtype=float)
    field = np.zeros(x.shape, dtype=complex)
    for start in range(0,count,128):
        centre = centres[start:start+128, None]
        sr, cr = fresnel((centre+slit/2-x)*scale)
        sl, cl = fresnel((centre-slit/2-x)*scale)
        field += np.sum((cr-cl)+1j*(sr-sl),axis=0)
    return .5*np.abs(field)**2


def grating_profile(e, screen, source, incident, max_work=4_000_000):
    if e.gratingProfile=='sinusoidal':return None,'余弦条纹需共轴前后焦面 f / f 傅里叶系统或等焦距 f / 2f / f 的 4f 系统，光源束腰位于输入面'
    n,u,v=basis(e); sn,_,_=basis(screen)
    if source.beamModel!='parallel' or source.divergenceMrad!=0 or abs(dot(incident,n))<.999999 or abs(dot(incident,sn))<.999999:
        return None,'光强剖面需要均匀平行光正入射，以及正对光轴的观察屏'
    offset=sub(e.position,source.position)
    transverse_u,transverse_v=dot(offset,u),dot(offset,v)
    if math.hypot(abs(transverse_u)+e.gratingWidthMm/2,transverse_v)>source.beamRadiusMm+1e-9:
        return None,'光强剖面需要光束覆盖整个光栅通光宽度'
    if math.hypot(transverse_u,transverse_v)+source.beamRadiusMm>grating_mount_radius(e)+1e-9:
        return None,'光强剖面需要照明光束完全落在光栅遮光框内'
    distance=dot(sub(screen.position,e.position),incident)
    if distance<1: return None,'观察屏需位于光栅后至少1 mm'
    centre=add(e.position,mul(incident,distance));local=sub(centre,screen.position)
    lateral=dot(local,u);vertical=dot(local,v);radius=screen.diameterMm/2
    if abs(vertical)>=radius: return None,'光栅中心剖面没有落在观察屏上'
    extent=math.sqrt(radius*radius-vertical*vertical)
    paraxial_extent=.2*distance-e.gratingWidthMm/2
    if paraxial_extent<=0: return None,'通光宽度相对屏距过大，光强剖面需增大屏距或缩小通光宽度'
    lo,hi=max(-extent-lateral,-paraxial_extent),min(extent-lateral,paraxial_extent)
    if hi<=lo: return None,'观察屏不在近轴光强剖面的范围内'
    wavelength=source.wavelengthNm*1e-6;count=grating_count(e)
    # Resolve the finest Fresnel interference set by the full illuminated width.
    width=(count-1)*e.gratingPeriodUm*.001+e.gratingSlitUm*.001
    samples=max(401,math.ceil((hi-lo)*8*width/(wavelength*distance))+1)
    if samples>12001 or samples*count>max_work:
        return None,'当前条纹过细，超出光强剖面的分辨范围；可缩小通光宽度或增大屏距'
    coordinates=np.linspace(lo,hi,samples)
    values=fresnel_intensity(e,wavelength,distance,coordinates)
    return {'kind':'amplitude-grating','gratingId':e.id,'screenId':screen.id,'sourceId':source.id,
            'center':centre,'axis':u,'distanceMm':distance,'periodCount':count,
            'points':[{'xMm':float(x),'intensity':float(i)} for x,i in zip(coordinates,values)],
            'model':'有限矩形振幅光栅的一维菲涅耳光强 I/I_in；不代替采样功率'},None
