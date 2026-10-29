import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Visual materials only: each housing owns its materials and can dispose them. */
export function instrumentMaterials(){
  return {
    ivory:new THREE.MeshPhysicalMaterial({color:'#bdcbd2',metalness:.18,roughness:.36,clearcoat:.3,clearcoatRoughness:.3,side:THREE.DoubleSide}),
    dark:new THREE.MeshPhysicalMaterial({color:'#25333f',metalness:.65,roughness:.31,clearcoat:.18,clearcoatRoughness:.35,side:THREE.DoubleSide}),
    steel:new THREE.MeshStandardMaterial({color:'#b7c5d0',metalness:.88,roughness:.27,side:THREE.DoubleSide}),
    teal:new THREE.MeshStandardMaterial({color:'#257f83',metalness:.62,roughness:.29,side:THREE.DoubleSide}),
    rubber:new THREE.MeshStandardMaterial({color:'#182129',metalness:0,roughness:.92,side:THREE.DoubleSide}),
    brass:new THREE.MeshStandardMaterial({color:'#b59b68',metalness:.75,roughness:.32,side:THREE.DoubleSide}),
  };
}

export function instrumentBlock(x:number,y:number,z:number,r=.6){
  return new RoundedBoxGeometry(x,y,z,2,Math.min(r,x/4,y/4,z/4));
}

/** A shallow hex recess and bright rim read at normal viewing distance. */
export function instrumentScrew(radius=1.3){
  const root=new THREE.Group();
  const rim=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,.45,24),new THREE.MeshStandardMaterial({color:'#a7b6c2',metalness:.9,roughness:.25}));
  const recess=new THREE.Mesh(new THREE.CylinderGeometry(radius*.43,radius*.43,.1,6),new THREE.MeshStandardMaterial({color:'#202b35',roughness:.7}));
  recess.position.y=.25;root.add(rim,recess);return root;
}
