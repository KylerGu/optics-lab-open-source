"""Relaxed-eye angular view assembled from rays admitted by the actual pupil."""
import math


def finite_eye_view(result,obj,lenses,observers,base,n,right,up,u,b,d,last_x,sample_paths,pupil_count):
    from .spatial import sub,dot
    from .spatial_components import basis
    eye=next((e for e in observers if e.kind=='eye'),None)
    if not eye:return
    observation=next(o for o in result['observations'] if o['elementId']==eye.id)
    eye_distance=dot(sub(eye.position,base),n)-last_x
    eye_b=b+eye_distance*d
    if abs(eye_b)<1e-8:return
    # Relaxed eye: tolerate less than one arcminute of geometric pupil spread.
    # The view itself always retains the actual traced spread, even below this threshold.
    observation['focused']=math.degrees(abs(d/eye_b)*eye.diameterMm)<1/60
    observation['angularMagnification']=u/eye_b
    by_ray={(h['pupil'],h['point']):[h['angleX'],h['angleY']] for h in observation['hits']}
    angular_paths=[]
    for pupil in range(pupil_count):
        for indices in sample_paths:
            run=[]
            for index in indices:
                point=by_ray.get((pupil,index))
                if point is None:
                    if len(run)>1:angular_paths.append(run)
                    run=[]
                else:run.append(point)
            if len(run)>1:angular_paths.append(run)
    reference=[[[math.degrees(dot(sub(p,base),right)/u),math.degrees(dot(sub(p,base),up)/u)] for p in path] for path in result['objectPaths']]
    magnification=u/eye_b
    resolution=math.degrees(1.22*obj.wavelengthNm*1e-6/lenses[0].diameterMm)*abs(magnification)
    _,eye_right,eye_down=basis(eye)
    center_delta=sub(obj.position,base)
    eye_delta=sub(eye.position,base)
    center=[math.degrees((dot(center_delta,eye_right)-d*dot(eye_delta,eye_right))/eye_b),-math.degrees((dot(center_delta,eye_down)-d*dot(eye_delta,eye_down))/eye_b)]
    reference_center=[math.degrees(dot(center_delta,right)/u),math.degrees(dot(center_delta,up)/u)]
    result['distantView']=dict(paths=angular_paths,referencePaths=reference,pupilCount=pupil_count,
        center=center,referenceCenter=reference_center,
        magnification=magnification,focused=observation['focused'],objectDistanceMm=u,
        sigmaDegrees=resolution/2.35482,strokeDegrees=math.degrees(obj.objectHeightMm/u)/12)
