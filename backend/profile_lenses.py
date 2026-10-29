"""Finite conic/even-polynomial aspheres and rectangular cylindrical singlets.

Asphere sag: c*r²/(1+sqrt(1-(1+k)c²*r²))+A4*r⁴+A6*r⁶ (mm).
Only globally convex/concave profiles are admitted, so a ray has at most two
front-surface intersections. Conics are solved analytically; polynomial profiles
are bracketed at their unique stationary point, then bisected (no mesh tracing).
"""
import math
from .spatial_components import basis, add, sub, mul, dot, unit, index_at
from .spherical_lenses import SPHERICAL_KINDS, lens_hit, focal_lengths, validate_lens

ASPHERIC_KINDS={'aspheric-convex-lens','aspheric-concave-lens'}
CYLINDER_KINDS={'plano-convex-cylinder-lens','plano-concave-cylinder-lens'}
PROFILE_KINDS=ASPHERIC_KINDS|CYLINDER_KINDS
PHYSICAL_KINDS=SPHERICAL_KINDS|PROFILE_KINDS


def profile_parameters(e):
    c=(1 if 'convex' in e.kind else -1)/e.frontRadiusMm
    return c,(e.conicConstant if e.kind in ASPHERIC_KINDS else 0),(e.asphericA4 if e.kind in ASPHERIC_KINDS else 0),(e.asphericA6 if e.kind in ASPHERIC_KINDS else 0)


def profile_sag(e,r):
    c,k,a4,a6=profile_parameters(e);root=math.sqrt(max(0,1-(1+k)*c*c*r*r))
    return c*r*r/(1+root)+a4*r**4+a6*r**6


def profile_slope(e,r):
    c,k,a4,a6=profile_parameters(e)
    return c*r/math.sqrt(max(1e-16,1-(1+k)*c*c*r*r))+4*a4*r**3+6*a6*r**5


def profile_span(e):return e.cylinderWidthMm/2 if e.kind in CYLINDER_KINDS else e.diameterMm/2


def profile_surfaces(e,r):return -e.centerThicknessMm/2+profile_sag(e,r),e.centerThicknessMm/2


def within_clear_aperture(e,hit):
    _,u,v=basis(e);offset=sub(hit,e.position);x,y=dot(offset,u),dot(offset,v)
    return abs(x)<=e.clearWidthMm/2+1e-7 and abs(y)<=e.clearHeightMm/2+1e-7 if e.kind in CYLINDER_KINDS else math.hypot(x,y)<=e.clearApertureMm/2+1e-7


def validate_physical_lens(e):
    if e.kind in PHYSICAL_KINDS:
        if (e.clearWidthMm>e.cylinderWidthMm+1e-9 or e.clearHeightMm>e.cylinderHeightMm+1e-9) if e.kind in CYLINDER_KINDS else e.clearApertureMm>e.diameterMm+1e-9:
            raise ValueError('有效通光尺寸不能超过镜片外形尺寸。')
    if e.kind not in PROFILE_KINDS:return validate_lens(e)
    a=profile_span(e);c,k,a4,a6=profile_parameters(e);q=1-(1+k)*c*c*a*a
    if q<1e-6:raise ValueError('曲面超出有效范围；请增大顶点曲率半径、减小口径或调整圆锥常数。')
    sign=1 if c>0 else -1
    # Conservative analytic bound on signed sag curvature over the entire aperture.
    minimum=abs(c)*min(1,q**-1.5)+min(0,12*sign*a4*a*a)+min(0,30*sign*a6*a**4)
    if minimum<=1e-9:raise ValueError('高阶系数过大，不能保证曲面始终保持所选凸凹形状；请减小高阶系数。')
    front,back=profile_surfaces(e,a)
    if back-front<.1-1e-9:raise ValueError('透镜边缘厚度至少为0.1 mm；请增加中心厚度、增大半径或减小口径。')
    if e.glass=='custom' and e.refractiveIndex<=1:raise ValueError('实体透镜材料的参考折射率必须大于1。')


def physical_focal_lengths(e,wavelength_nm=587.56):
    if e.kind not in PROFILE_KINDS:return focal_lengths(e,wavelength_nm)
    n=index_at(e,wavelength_nm);c,_,_,_=profile_parameters(e);power=(n-1)*c
    if abs(power)<1e-12:return None,None
    return 1/power,1/power-e.centerThicknessMm/n


def quadratic_roots(a,b,c):
    if abs(a)<1e-14:return [] if abs(b)<1e-14 else [-c/b]
    disc=b*b-4*a*c
    if disc<0:return []
    q=-.5*(b+math.copysign(math.sqrt(disc),b))
    if abs(q)<1e-14:return [-b/(2*a)]
    return [q/a,c/q]


def physical_lens_hit(e,origin,d,inside=False):
    if e.kind not in PROFILE_KINDS:return lens_hit(e,origin,d,inside)
    n,u,v=basis(e);local=sub(origin,e.position);o=tuple(dot(local,b) for b in (n,u,v));w=tuple(dot(d,b) for b in (n,u,v))
    cylinder=e.kind in CYLINDER_KINDS;a=profile_span(e);h=e.cylinderHeightMm/2;c,k,a4,a6=profile_parameters(e)
    vertex=-e.centerThicknessMm/2;back=e.centerThicknessMm/2;best=None

    def radius(y,z):return abs(y) if cylinder else math.hypot(y,z)

    def consider(t,face,normal=None):
        nonlocal best
        if t<=1e-5 or t>2000:return
        x,y,z=(o[i]+t*w[i] for i in range(3));r=radius(y,z)
        if r>a+1e-7 or cylinder and abs(z)>h+1e-7:return
        front=vertex+profile_sag(e,min(r,a))
        if x<front-1e-6 or x>back+1e-6:return
        if face=='front':
            if abs(x-front)>1e-6:return
            slope=profile_slope(e,r);gu=slope*(y/r if r else 0);gv=0 if cylinder else slope*(z/r if r else 0)
            normal=unit(add(mul(n,-1),add(mul(u,gu),mul(v,gv))))
        elif face=='back':
            if abs(x-back)>1e-6:return
            normal=n
        den=dot(d,normal)
        if inside and den<=1e-10 or not inside and den>=-1e-10:return
        if best is None or t<best[0]:best=(t,add(origin,mul(d,t)),normal,face)

    if abs(w[0])>1e-12:consider((back-o[0])/w[0],'back')
    if not a4 and not a6:
        z=o[0]-vertex;radial_w=w[1]**2+(0 if cylinder else w[2]**2);radial_o=o[1]**2+(0 if cylinder else o[2]**2)
        mixed=o[1]*w[1]+(0 if cylinder else o[2]*w[2]);r=1/c
        for t in quadratic_roots(radial_w+(1+k)*w[0]**2,2*(mixed+(1+k)*z*w[0]-r*w[0]),radial_o+(1+k)*z*z-2*r*z):consider(t,'front')
    else:
        # Intersect the exact finite bounding volume before solving the sag equation.
        lo,hi=1e-5,2000
        def clip(value,slope,minimum,maximum):
            nonlocal lo,hi
            if abs(slope)<1e-14:
                if value<minimum or value>maximum:hi=lo-1
            else:
                t1,t2=sorted(((minimum-value)/slope,(maximum-value)/slope));lo=max(lo,t1);hi=min(hi,t2)
        clip(o[0],w[0],min(vertex,vertex+profile_sag(e,a)),back)
        roots=quadratic_roots(w[1]**2+w[2]**2,2*(o[1]*w[1]+o[2]*w[2]),o[1]**2+o[2]**2-a*a)
        if w[1]**2+w[2]**2>1e-14:
            if len(roots)==2:lo=max(lo,min(roots));hi=min(hi,max(roots))
            else:hi=lo-1
        elif math.hypot(o[1],o[2])>a:hi=lo-1
        def f(t):
            x,y,z=(o[i]+t*w[i] for i in range(3));return x-vertex-profile_sag(e,math.hypot(y,z))
        def derivative(t):
            y,z=o[1]+t*w[1],o[2]+t*w[2];r=math.hypot(y,z)
            return w[0]-(profile_slope(e,r)*(y*w[1]+z*w[2])/r if r else 0)
        def bisect(fn,left,right):
            fl=fn(left)
            for _ in range(55):
                middle=(left+right)/2;fm=fn(middle)
                if fl*fm<=0:right=middle
                else:left=middle;fl=fm
            return (left+right)/2
        if lo<=hi:
            cuts=[lo,hi]
            if derivative(lo)*derivative(hi)<0:cuts.insert(1,bisect(derivative,lo,hi))
            for left,right in zip(cuts,cuts[1:]):
                if abs(f(left))<1e-8:consider(left,'front')
                if abs(f(right))<1e-8:consider(right,'front')
                if f(left)*f(right)<0:consider(bisect(f,left,right),'front')
    if cylinder:
        for axis,span,b in [(1,a,u),(2,h,v)]:
            if abs(w[axis])>1e-12:
                for sign in [-1,1]:consider((sign*span-o[axis])/w[axis],'edge',mul(b,sign))
    else:
        for t in quadratic_roots(w[1]**2+w[2]**2,2*(o[1]*w[1]+o[2]*w[2]),o[1]**2+o[2]**2-a*a):
            y,z=o[1]+t*w[1],o[2]+t*w[2]
            consider(t,'edge',unit(add(mul(u,y),mul(v,z))))
    return best
