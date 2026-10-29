"""Finite spherical singlets, centred between the two surface vertices (mm).

Radii stored as positive magnitudes; the shape fixes their optical signs.
The cylindrical rim absorbs rays. Surface Fresnel transmission is handled by
spatial_components.interface; non-TIR ghost branches are not traced.
"""
import math
from .spatial_components import add, sub, mul, dot, unit, basis, index_at

SPHERICAL_KINDS = {'plano-convex-lens', 'biconvex-lens', 'plano-concave-lens', 'biconcave-lens', 'positive-meniscus-lens', 'negative-meniscus-lens'}


def default_radii(kind):
    if kind=='negative-meniscus-lens':return 100,50
    return (100 if kind.startswith('bi') else 50),100


def radii(e):
    if e.kind.endswith('meniscus-lens'):return e.frontRadiusMm,e.backRadiusMm
    convex = e.kind in {'plano-convex-lens', 'biconvex-lens'}
    sign = 1 if convex else -1
    return sign*e.frontRadiusMm, -sign*e.backRadiusMm if e.kind.startswith('bi') else 0


def sag(radius, rho):
    if radius == 0: return 0
    # Stable for shallow surfaces: avoid subtracting nearly equal numbers.
    return math.copysign(rho*rho/(abs(radius)+math.sqrt(max(0,radius*radius-rho*rho))),radius)


def surface_positions(e, rho):
    r1,r2=radii(e)
    return -e.centerThicknessMm/2+sag(r1,rho), e.centerThicknessMm/2+sag(r2,rho)


def validate_lens(e):
    if e.kind not in SPHERICAL_KINDS: return
    a=e.diameterMm/2
    if e.frontRadiusMm<=a or (not e.kind.startswith('plano') and e.backRadiusMm<=a):
        raise ValueError('曲面半径必须大于透镜口径的一半。')
    front,back=surface_positions(e,a)
    if back-front<.1-1e-9:
        raise ValueError('透镜边缘厚度至少为0.1 mm；请增加中心厚度、增大曲面半径或减小口径。')
    if e.glass=='custom' and e.refractiveIndex<=1:
        raise ValueError('球面透镜材料的参考折射率必须大于1。')
    if e.kind=='positive-meniscus-lens' and e.frontRadiusMm>=e.backRadiusMm:
        raise ValueError('正弯月透镜的前凸面半径须小于后凹面半径。')
    if e.kind=='negative-meniscus-lens':
        if e.frontRadiusMm<=e.backRadiusMm:
            raise ValueError('负弯月透镜的前凸面半径须大于后凹面半径。')
        focal,_=focal_lengths(e)
        if focal is None or focal>=0:
            raise ValueError('当前厚度或材料使负弯月透镜不再发散；请减薄透镜或调整曲面半径。')


def focal_lengths(e, wavelength_nm=587.56):
    """Paraxial effective and rear-vertex focal lengths, not exact marginal focus."""
    n=index_at(e,wavelength_nm);r1,r2=radii(e)
    p1=(n-1)/r1;p2=(1-n)/r2 if r2 else 0
    power=p1+p2-e.centerThicknessMm/n*p1*p2
    if abs(power)<1e-12:return None,None
    return 1/power,(1-e.centerThicknessMm/n*p1)/power


def lens_hit(e, origin, direction, inside=False):
    n,_,_=basis(e);a=e.diameterMm/2
    r1,r2=radii(e);best=None

    def consider(distance, outward, face):
        nonlocal best
        if distance<=1e-5 or distance>2000: return
        hit=add(origin,mul(direction,distance));local=sub(hit,e.position)
        x=dot(local,n);radial=sub(local,mul(n,x));rho=math.sqrt(dot(radial,radial))
        if rho>a+1e-7: return
        front,back=surface_positions(e,min(rho,a))
        if x<front-1e-6 or x>back+1e-6: return
        if face=='front' and abs(x-front)>1e-6 or face=='back' and abs(x-back)>1e-6: return
        den=dot(direction,outward)
        if inside and den<=1e-10 or not inside and den>=-1e-10: return
        if best is None or distance<best[0]: best=(distance,hit,outward,face)

    for radius,vertex,face in [(r1,-e.centerThicknessMm/2,'front'),(r2,e.centerThicknessMm/2,'back')]:
        if radius==0:
            den=dot(direction,n)
            if abs(den)>1e-10:
                consider((vertex-dot(sub(origin,e.position),n))/den,mul(n,-1 if face=='front' else 1),face)
        else:
            center=add(e.position,mul(n,vertex+radius));v=sub(origin,center)
            b=dot(v,direction);disc=b*b-dot(v,v)+radius*radius
            if disc<0: continue
            for distance in (-b-math.sqrt(disc),-b+math.sqrt(disc)):
                hit=add(origin,mul(direction,distance))
                outward=mul(sub(hit,center),(1 if face=='front' else -1)/radius)
                consider(distance,unit(outward),face)
    # Finite edge; no fictitious transmission through an unpolished rim.
    local=sub(origin,e.position);v=sub(local,mul(n,dot(local,n)));w=sub(direction,mul(n,dot(direction,n)))
    aa=dot(w,w);bb=dot(v,w);disc=bb*bb-aa*(dot(v,v)-a*a)
    if aa>1e-12 and disc>=0:
        for distance in ((-bb-math.sqrt(disc))/aa,(-bb+math.sqrt(disc))/aa):
            radial=add(v,mul(w,distance));consider(distance,unit(radial),'edge')
    return best
