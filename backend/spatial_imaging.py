"""Illuminated planar objects through coaxial ideal lenses (mm).

Conjugates use ABCD matrices; drawn rays use the builder's thin-lens law.
The sensor adapter is a positive ideal image scale, in pre-relay coordinates.
No radiometric power is assigned to an illuminated teaching object.
"""
import math


def pattern_lines(pattern):
    if pattern == 'arrow':
        return [[(0, 0), (0, 1)], [(-.5, .65), (0, 1), (.5, .65)]]
    return [[(0, 0), (0, 1), (1, 1)], [(0, .55), (.45/.65, .55)]]


def calculate_imaging(experiment):
    from .spatial import normal, add, sub, mul, dot, norm, thin_lens_direction
    from .spatial_components import basis
    results = []
    for obj in [e for e in experiment.elements if e.kind == 'object']:
        distant = obj.objectMode == 'distant'
        result = dict(objectId=obj.id, stages=[], segments=[], observations=[], warnings=[], objectPaths=[])
        results.append(result)
        n, right, down = basis(obj)
        up = mul(down, -1)
        paths = [[add(obj.position, add(mul(right, (x-(.5 if distant else 0))*obj.objectWidthMm), mul(up, (y-(.5 if distant else 0))*obj.objectHeightMm)))
                  for x, y in line] for line in pattern_lines(obj.objectPattern)]
        result['objectPaths'] = paths
        # Conservative boundary: never silently ignore an unsupported optic.
        unsupported = [e for e in experiment.elements if e.kind not in {'laser','object','lens','screen','eye','sensor'}]
        if unsupported:
            result['warnings'].append('物体成像暂支持共轴理想薄透镜；请移除其他器材或使用独立光路。')
            continue
        lenses = sorted([e for e in experiment.elements if e.kind == 'lens' and dot(sub(e.position,obj.position),n)>1e-7], key=lambda e:dot(sub(e.position,obj.position),n))
        if not lenses:
            result['warnings'].append('请在物体朝向的前方放置理想薄透镜。')
            continue
        base = lenses[0].position
        axial = lambda e: dot(sub(e.position,base), n)
        stops = sorted([e for e in experiment.elements if e.kind in {'screen','sensor'} and axial(e)>-dot(sub(base,obj.position),n)],key=axial)
        if stops:
            lenses = [e for e in lenses if axial(e)<axial(stops[0])-1e-7]
        if not lenses:
            result['warnings'].append('观察面挡在物体与透镜之间，尚未形成透镜像。')
            continue
        devices = lenses + [e for e in experiment.elements if e.kind in {'screen','sensor','eye'}]
        if any(abs(abs(dot(normal(e),n))-1)>1e-8 or (e.kind=='lens' and math.dist(sub(e.position,base),mul(n,axial(e)))>1e-6) for e in devices):
            result['warnings'].append('当前物体成像需要平行物面、共轴透镜及正对光轴的观察面；倾斜成像暂不支持。')
            continue
        u = dot(sub(base,obj.position), n)
        # Do not draw an enormous paraxial image when the object itself requires
        # large angles even for a ray through the objective centre.
        if any(math.dist(sub(p,base),mul(n,dot(sub(p,base),n)))/u>.2 for path in paths for p in path):
            result['warnings'].append('样品尺寸或偏移过大，超出小角度成像范围。请缩小实际尺寸；看清样品请用局部查看。')
            continue
        a,b,c,d = 1.,0.,0.,1.
        previous = -u
        for lens in lenses:
            x = axial(lens); gap = x-previous
            if gap<=1e-7:
                result['warnings'].append('透镜位置重合，暂不计算物体成像。')
                break
            a,b = a+gap*c,b+gap*d
            c,d = c-a/lens.focalLengthMm,d-b/lens.focalLengthMm
            v = -b/d if abs(d)>1e-12 else None
            m = a+v*c if v is not None else None
            center = add(base,mul(n,x+v)) if v is not None else None
            image_paths = [[add(center,mul(sub(p,add(base,mul(n,-u))),m)) for p in path] for path in paths] if center else []
            result['stages'].append(dict(lensId=lens.id,kind='infinity' if v is None else 'real' if v>0 else 'virtual',distanceMm=v,magnification=m,heightMm=None if m is None else m*obj.objectHeightMm,position=center,paths=image_paths))
            previous=x
        else:
            final=result['stages'][-1]; last=lenses[-1]; last_x=axial(last)
            for index,stage in enumerate(result['stages']):
                stage['visible']=index==len(lenses)-1 or (stage['kind']=='real' and stage['distanceMm']<axial(lenses[index+1])-axial(lenses[index]))
            observers=[e for e in devices if e.kind in {'screen','sensor','eye'} and axial(e)>=last_x-1e-7]
            terminal=stops[0] if stops and axial(stops[0])>last_x else None
            observers=[e for e in observers if terminal is None or axial(e)<=axial(terminal)+1e-7]
            for detector in observers:
                distance=axial(detector)-last_x
                focused=final['kind']=='real' and abs(b+distance*d)<1e-8*max(1,u)
                relay=detector.adapterMagnification if detector.kind=='sensor' else 1
                angular = (detector.nearDistanceMm/b if final['kind']=='infinity' else final['magnification']*detector.nearDistanceMm/abs(final['distanceMm']-distance) if final['kind']=='virtual' else None)
                first=result['stages'][0]
                field=detector.fieldNumberMm/abs(first['magnification']) if detector.kind=='eye' and angular is not None and first['kind']=='real' and first['distanceMm']<last_x and first['magnification'] else None
                result['observations'].append(dict(elementId=detector.id,kind=detector.kind,focused=focused,defocusMm=None if final['distanceMm'] is None else distance-final['distanceMm'],magnification=(a+distance*c)*relay if focused else None,angularMagnification=angular if detector.kind=='eye' else None,fieldDiameterMm=field,adapterMagnification=relay,widthMm=detector.sensorWidthMm if detector.kind=='sensor' else detector.diameterMm,heightMm=detector.sensorHeightMm if detector.kind=='sensor' else detector.diameterMm,hits=[]))
            # Sample distinct pattern points, each with a small converging/diverging pencil.
            samples=[]
            for path in paths:
                for start,end in zip(path,path[1:]):
                    for t in (0,.5,1):
                        point=add(start,mul(sub(end,start),t))
                        if point not in samples:samples.append(point)
            # Keep the original landmark indices for teaching rays, then fill the
            # pattern for detector sampling without adding more displayed pencils.
            for path in paths:
                for start,end in zip(path,path[1:]):
                    for i in range(1,16):
                        point=add(start,mul(sub(end,start),i/16))
                        if point not in samples:samples.append(point)
            sample_paths=[]
            if distant:
                samples=[]
                for path in paths:
                    indices=[]
                    for start,end in zip(path,path[1:]):
                        for i in range(17):
                            point=add(start,mul(sub(end,start),i/16))
                            if point not in samples:samples.append(point)
                            index=samples.index(point)
                            if not indices or indices[-1]!=index:indices.append(index)
                    sample_paths.append(indices)
            max_offset=max(math.dist(sub(p,base),mul(n,dot(sub(p,base),n))) for path in paths for p in path)
            # Use more of the admitted pencil while keeping EVERY incident slope
            # below 0.18; this changes angular sampling, never an optical length.
            radius=min(lenses[0].diameterMm*.4,max(0,u*.18-max_offset))
            far=last_x+min(450,max(80,final['distanceMm']*1.1 if final['kind']=='real' else 100))
            if terminal:far=axial(terminal)
            clipped=False
            pupil=[(0,0),(-radius,0),(radius,0),(0,-radius),(0,radius)]
            if distant:
                pupil += [(radius*x/4,radius*y/4) for x in range(-4,5) for y in range(-4,5) if x*x+y*y<=16 and (radius*x/4,radius*y/4) not in pupil]
            for point_id,point in enumerate(samples):
                for pupil_id,(qx,qy) in enumerate(pupil):
                    origin=point; direction=norm(sub(add(base,add(mul(right,qx),mul(up,qy))),point)); alive=True
                    for lens in lenses:
                        distance=dot(sub(lens.position,origin),n)/dot(direction,n)
                        hit=add(origin,mul(direction,distance))
                        if not distant or pupil_id<5:result['segments'].append(dict(start=origin,end=hit,point=point_id,dashed=False))
                        if math.dist(hit,lens.position)>lens.diameterMm/2+1e-8:
                            clipped=True;alive=False;break
                        direction=thin_lens_direction(direction,n,sub(hit,lens.position),lens.focalLengthMm);origin=hit
                        if math.sqrt(max(0,1-dot(direction,n)**2))/abs(dot(direction,n))>.2:
                            clipped=True;alive=False
                            result['warnings'].append('部分光线超出小角度成像范围，已停止绘制；完整像轮廓不再显示。')
                            break
                    if not alive:continue
                    if abs(dot(direction,n))<.98: result['warnings'].append('部分光线角度较大，小角度薄透镜结果仅供教学参考。')
                    end=add(origin,mul(direction,(far-last_x)/dot(direction,n)))
                    if not distant or pupil_id<5:result['segments'].append(dict(start=origin,end=end,point=point_id,dashed=False))
                    if (not distant or pupil_id<5) and final['kind']=='virtual' and abs(final['distanceMm'])<2000:
                        result['segments'].append(dict(start=origin,end=add(origin,mul(direction,final['distanceMm']/dot(direction,n))),point=point_id,dashed=True))
                    for observation in result['observations']:
                        detector=next(e for e in observers if e.id==observation['elementId'])
                        hit=add(origin,mul(direction,(axial(detector)-last_x)/dot(direction,n)))
                        _,du,dv=basis(detector);offset=sub(hit,detector.position);relay=observation['adapterMagnification']
                        hx,hy=dot(offset,du)*relay,-dot(offset,dv)*relay
                        inside=abs(hx)<=observation['widthMm']/2 and abs(hy)<=observation['heightMm']/2 if detector.kind=='sensor' else math.hypot(hx,hy)<=detector.diameterMm/2
                        if inside:
                            hit_record=dict(x=hx,y=hy,point=point_id)
                            if distant and detector.kind=='eye':hit_record.update(pupil=pupil_id,angleX=-math.degrees(dot(direction,du)/dot(direction,n)),angleY=math.degrees(dot(direction,dv)/dot(direction,n)))
                            observation['hits'].append(hit_record)
            if clipped:
                for stage in result['stages']:stage['visible']=False
                result['warnings'].append('部分光线被口径挡住，目视图只显示进入眼瞳的部分。' if distant else '部分物点光线未通过完整镜组；成像读数为理想公式值，未显示完整像轮廓。')
            for observation in result['observations']:
                if not observation['hits']:result['warnings'].append('采样光线未进入'+next(e.name for e in observers if e.id==observation['elementId'])+'，请检查口径、位置或取景范围。')
            if distant:
                from .spatial_distant import finite_eye_view
                finite_eye_view(result,obj,lenses,observers,base,n,right,up,u,b,d,previous,sample_paths,len(pupil))
        result['warnings']=list(dict.fromkeys(result['warnings']))
    return results
