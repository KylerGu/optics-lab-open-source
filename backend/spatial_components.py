"""Solid prisms, polarization and single-slit teaching models (mm, nm).

N-BK7 Sellmeier coefficients: SCHOTT N-BK7 optical-glass datasheet.
Polarization and Fraunhofer sinc-squared: OpenStax University Physics v3 1.7/4.1.
Jones modes are incoherent with each other; independent sources never interfere.
"""
import math
import cmath


def add(a,b): return tuple(x+y for x,y in zip(a,b))
def sub(a,b): return tuple(x-y for x,y in zip(a,b))
def mul(a,k): return tuple(x*k for x in a)
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def length(a): return math.sqrt(sum(abs(x)**2 for x in a))
def unit(a): return mul(a,1/length(a))


def basis(e):
    yaw,pitch,roll=map(math.radians,(e.yawDeg,e.pitchDeg,e.rollDeg))
    n=(math.cos(pitch)*math.cos(yaw),math.sin(pitch),math.cos(pitch)*math.sin(yaw))
    u=unit(cross(n,(0,1,0) if abs(n[1])<.9 else (0,0,1)))
    v=cross(n,u)
    return n,add(mul(u,math.cos(roll)),mul(v,math.sin(roll))),add(mul(v,math.cos(roll)),mul(u,-math.sin(roll)))


def index_at(e,wavelength_nm):
    w=wavelength_nm/1000
    if e.glass=='bk7':
        return math.sqrt(1+sum(b*w*w/(w*w-c) for b,c in zip((1.03961212,.231792344,1.01046945),(.00600069867,.0200179144,103.560653))))
    # Two-term Cauchy fit to n_d and the F-C Abbe definition; no arbitrary spectral slope.
    b=(e.refractiveIndex-1)/e.abbeNumber/(1/.48613**2-1/.65627**2)
    return e.refractiveIndex+b*(1/w**2-1/.58756**2)


def prism_vertices(e):
    s=e.diameterMm
    if e.kind=='right-prism': return [(-s/3,-s/3),(2*s/3,-s/3),(-s/3,2*s/3)]
    h=s/(2*math.tan(math.radians(e.apexAngleDeg/2)))
    return [(-s/2,-h/3),(s/2,-h/3),(0,2*h/3)]


def prism_planes(e):
    n,u,v=basis(e); vertices=prism_vertices(e); planes=[]
    for i,(x,y) in enumerate(vertices):
        bx,by=vertices[(i+1)%3]
        outward=unit(add(mul(n,by-y),mul(u,x-bx)))
        point=add(e.position,add(mul(n,x),mul(u,y)))
        planes.append((point,outward))
    planes.extend([(add(e.position,mul(v,e.prismHeightMm/2)),v),(add(e.position,mul(v,-e.prismHeightMm/2)),mul(v,-1))])
    return planes


def prism_hit(e,origin,d,inside=False):
    planes=prism_planes(e); best=None
    for point,n in planes:
        den=dot(d,n)
        if abs(den)<1e-10 or (inside and den<=0) or (not inside and den>=0): continue
        distance=dot(sub(point,origin),n)/den
        if distance<=1e-5 or distance>2000: continue
        hit=add(origin,mul(d,distance))
        if any(dot(sub(hit,p),out)>1e-6 for p,out in planes): continue
        if best is None or distance<best[0]: best=(distance,hit,n)
    return best


def source_modes(e,d):
    _,u,v=basis(e)
    if e.polarization=='unpolarized': return [mul(u,1/math.sqrt(2)),mul(v,1/math.sqrt(2))]
    a=math.radians(e.polarizationDeg)
    return [add(mul(u,math.cos(a)),mul(v,math.sin(a)))]


def transport(modes,d,outgoing):
    # Minimal rotation between propagation directions; preserves transverse field and power.
    axis=cross(d,outgoing); sine=length(axis); cosine=max(-1,min(1,dot(d,outgoing)))
    if sine<1e-12:
        if cosine>0: return modes
        axis=unit(cross(d,(0,1,0) if abs(d[1])<.9 else (0,0,1)))
        return [sub(mul(axis,2*dot(axis,m)),m) for m in modes]
    axis=mul(axis,1/sine)
    return [add(add(mul(m,cosine),mul(cross(axis,m),sine)),mul(axis,dot(axis,m)*(1-cosine))) for m in modes]


def normalized_modes(modes):
    fraction=sum(sum(abs(c)**2 for c in mode) for mode in modes)
    return ([mul(m,1/math.sqrt(fraction)) for m in modes] if fraction>1e-20 else []),fraction


def polarize(e,d,modes):
    _,axis,_=basis(e)
    axis=sub(axis,mul(d,dot(axis,d)))
    if length(axis)<1e-10: return [],0.
    axis=unit(axis)
    return normalized_modes([mul(axis,dot(m,axis)) for m in modes])


def waveplate(e,d,modes,wavelength_nm):
    """Ideal zero-order retarder, constant birefringence, projected fast axis.

    Complex amplitudes retain phase. Incoherent modes keep unpolarized light
    unpolarized. No angle-dependent crystal refraction or multi-order dispersion.
    """
    _,fast,_=basis(e)
    fast=sub(fast,mul(d,dot(fast,d)))
    if length(fast)<1e-10: return modes
    fast=unit(fast);slow=cross(d,fast)
    nominal=math.pi if e.kind=='half-wave-plate' else math.pi/2
    phase=cmath.exp(1j*nominal*e.designWavelengthNm/wavelength_nm)
    return [add(mul(fast,dot(m,fast)),mul(slow,dot(m,slow)*phase)) for m in modes]


def stokes(modes,d,detector):
    """Normalized S1,S2,S3, in the detector's projected U/V frame.

    Convention S3 = 2 Im(Eu conjugate(Ev)); no handedness label is implied.
    """
    _,u,_=basis(detector);u=sub(u,mul(d,dot(u,d)))
    if length(u)<1e-10: return None
    u=unit(u);v=cross(d,u)
    a=[dot(m,u) for m in modes];b=[dot(m,v) for m in modes]
    aa=sum(abs(x)**2 for x in a);bb=sum(abs(x)**2 for x in b)
    ab=sum(x*complex(y).conjugate() for x,y in zip(a,b));total=aa+bb
    return ((aa-bb)/total,2*ab.real/total,2*ab.imag/total) if total>1e-20 else None


def polarization_split(e,d,modes):
    """Lossless ideal PBS interface: project each complex mode onto local p/s.

    Adjustable Tp/Ts represent transmission of each polarization, not a fixed
    beam ratio. Reflectance is 1-T, and both branches retain their own state.
    """
    n,axis,_=basis(e)
    s=cross(d,n)
    if length(s)<1e-10:
        s=sub(axis,mul(d,dot(axis,d)))
    s=unit(s);p=cross(s,d)
    transmitted=[add(mul(p,dot(m,p)*math.sqrt(e.pTransmission)),mul(s,dot(m,s)*math.sqrt(e.sTransmission))) for m in modes]
    reflected=[add(mul(p,dot(m,p)*math.sqrt(1-e.pTransmission)),mul(s,dot(m,s)*math.sqrt(1-e.sTransmission))) for m in modes]
    return normalized_modes(transmitted),normalized_modes(reflected)


def interface(d,outward,n1,n2,modes):
    # n faces against incident direction. Only main transmitted branch and TIR are traced.
    n=outward if dot(d,outward)<0 else mul(outward,-1)
    cosine=max(0,min(1,-dot(d,n))); ratio=n1/n2
    k=1-ratio*ratio*(1-cosine*cosine)
    s=cross(d,n)
    s=unit(s) if length(s)>1e-10 else unit(cross(d,(0,1,0) if abs(d[1])<.9 else (0,0,1)))
    p=cross(s,d)
    if k<0:
        out=unit(sub(d,mul(n,2*dot(d,n))))
        transmitted_cos=complex(0,math.sqrt(-k))
        rs=(n1*cosine-n2*transmitted_cos)/(n1*cosine+n2*transmitted_cos)
        rp=(n2*cosine-n1*transmitted_cos)/(n2*cosine+n1*transmitted_cos)
        out_p=cross(s,out)
        updated=[add(mul(s,dot(m,s)*rs),mul(out_p,dot(m,p)*rp)) for m in modes]
        return out,updated,1.,True
    ct=math.sqrt(max(0,k)); out=unit(add(mul(d,ratio),mul(n,ratio*cosine-ct)))
    rs=(n1*cosine-n2*ct)/max(n1*cosine+n2*ct,1e-15)
    rp=(n2*cosine-n1*ct)/max(n2*cosine+n1*ct,1e-15)
    out_p=cross(s,out)
    updated=[add(mul(s,dot(m,s)*math.sqrt(max(0,1-rs*rs))),mul(out_p,dot(m,p)*math.sqrt(max(0,1-rp*rp)))) for m in modes]
    updated,fraction=normalized_modes(updated)
    return out,updated,fraction,False


def slit_passes(e,hit):
    _,u,v=basis(e); offset=sub(hit,e.position)
    inside=abs(dot(offset,u))<=e.slitWidthMm/2+1e-9 and abs(dot(offset,v))<=e.slitHeightMm/2+1e-9
    return not inside if e.slitMode=='stop' else inside


def diffraction_profile(slit,screen,source,origin,d):
    """Analytic 1D relative-intensity section, separate from ray-power readings.

    Only direct, normal, collimated, uniformly illuminated, unobstructed far field.
    Finite slit height is assumed long; no multiple-aperture or Gaussian diffraction.
    """
    if slit.slitMode=='stop':return None
    n,u,_=basis(slit); sn,_,_=basis(screen)
    if source.beamModel!='parallel' or source.divergenceMrad!=0 or abs(dot(d,n))<.9999 or abs(dot(d,sn))<.9999: return None
    if slit.slitWidthMm>source.beamRadiusMm*.2 or slit.slitHeightMm<10*slit.slitWidthMm: return None
    distance=dot(sub(screen.position,origin),d)
    if distance<=0: return None
    center=add(origin,mul(d,distance)); local=sub(center,screen.position)
    radius=screen.diameterMm/2; lateral=dot(local,u)
    vertical2=max(0,dot(local,local)-lateral*lateral)
    if vertical2>=radius*radius: return None
    extent=math.sqrt(radius*radius-vertical2)
    wavelength=source.wavelengthNm*1e-6
    if slit.slitWidthMm**2/(wavelength*distance)>.1: return None
    ratio=wavelength/slit.slitWidthMm
    if ratio>=1: return None
    minimum=distance*ratio/math.sqrt(1-ratio*ratio)
    lo,hi=-extent-lateral,extent-lateral
    points=[]
    for i in range(401):
        x=lo+(hi-lo)*i/400
        beta=math.pi*slit.slitWidthMm*x/math.hypot(distance,x)/wavelength
        points.append({"xMm":x,"intensity":(math.sin(beta)/beta)**2 if abs(beta)>1e-12 else 1.})
    return {"slitId":slit.id,"screenId":screen.id,"sourceId":source.id,"center":center,"axis":u,"distanceMm":distance,
            "firstMinimumMm":minimum,"centralMaximumWidthMm":2*minimum,"points":points,
            "model":"单狭缝远场归一化强度；与几何采样功率分开"}
