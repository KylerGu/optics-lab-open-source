import * as THREE from 'three';
import type {ObjectImageResult} from './spatialImaging';

/** Smooth interpolation of the four traced marginal rays, without widening the pencil. */
export function imagingBeam(section:ObjectImageResult['segments'],color:string,rendered:boolean){
  const vertices:number[]=[],indices:number[]=[],sides=32;
  for(const end of ['start','end'] as const){
    const center=new THREE.Vector3(...section[0][end]);
    const u=new THREE.Vector3(...section[2][end]).sub(new THREE.Vector3(...section[1][end])).multiplyScalar(.5);
    const v=new THREE.Vector3(...section[4][end]).sub(new THREE.Vector3(...section[3][end])).multiplyScalar(.5);
    for(let i=0;i<=sides;i++){
      const angle=i/sides*Math.PI*2,p=center.clone().addScaledVector(u,Math.cos(angle)).addScaledVector(v,Math.sin(angle));
      vertices.push(...p.toArray());
      if(i<sides)indices.push(i,i+sides+1,i+1,i+1,i+sides+1,i+sides+2);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{tint:{value:new THREE.Color(color)},opacity:{value:rendered?.17:.09}},
    vertexShader:`varying vec3 surfaceNormal;varying vec3 viewPosition;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.0);viewPosition=p.xyz;surfaceNormal=normalMatrix*normal;gl_Position=projectionMatrix*p;}`,
    fragmentShader:`uniform vec3 tint;uniform float opacity;varying vec3 surfaceNormal;varying vec3 viewPosition;
      void main(){float facing=abs(dot(normalize(surfaceNormal),normalize(-viewPosition)));
        gl_FragColor=vec4(tint,opacity*pow(facing,1.4));
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(geometry,material);
}
