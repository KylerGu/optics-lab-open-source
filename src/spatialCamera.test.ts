import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3,Mesh} from 'three';
import {defaultScene} from './sceneRuntime';
import {immediateCamera} from './cameraModel';
import {sceneBuilderCopy} from './sceneBuilderCopy';
import {cameraLayout,createCameraHousing,moveCameraPart} from './spatialCamera';

test('camera cutaway follows actual sensor distance and never modifies optical elements',()=>{
  for(const sensor of [10,57.142857,300]){
    const state=defaultScene('instruments-2');state.parameters.sensor=sensor;
    const experiment=sceneBuilderCopy(state,immediateCamera(state)).experiment!;
    const before=JSON.stringify(experiment),layout=cameraLayout(experiment)!;
    assert.ok(layout);assert.equal(layout.distance,sensor);
    const housing=createCameraHousing(layout);housing.updateMatrixWorld(true);
    const board=housing.getObjectByName('camera-sensor-board')!;
    assert.ok(board.getWorldPosition(new Vector3()).distanceTo(new Vector3(sensor+2,60,0))<1e-8);
    const box=new Box3().setFromObject(housing);
    assert.ok([box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z].every(Number.isFinite));
    assert.equal(JSON.stringify(experiment),before);
    housing.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose();}});
    experiment.name='renamed camera';assert.ok(cameraLayout(experiment));
    experiment.elements[2].position[2]+=10;assert.equal(cameraLayout(experiment),null);
  }
});

test('camera dragging changes only the chosen optic and clamps travel without mutating the original',()=>{
  const state=defaultScene('instruments-2'),experiment=sceneBuilderCopy(state,immediateCamera(state)).experiment!,before=JSON.stringify(experiment);
  const layout=cameraLayout(experiment)!;
  for(const part of ['lens','sensor'] as const){
    const moved=moveCameraPart(experiment,layout.distance+2,part);
    assert.equal(cameraLayout(moved)!.distance,layout.distance+2);
    for(const element of experiment.elements)if(element.kind!==part)assert.deepEqual(moved.elements.find(e=>e.id===element.id),element);
    assert.equal(JSON.stringify(experiment),before);
    assert.ok(cameraLayout(moveCameraPart(experiment,-10000,part)));
    assert.ok(cameraLayout(moveCameraPart(experiment,10000,part)));
  }
  const housing=createCameraHousing(layout);housing.updateMatrixWorld(true);
  const shifted=moveCameraPart(experiment,layout.distance+2,'lens'),next=cameraLayout(shifted)!;
  const updated=createCameraHousing(next,next.distance);updated.updateMatrixWorld(true);
  assert.ok(housing.getObjectByName('camera-body-back')!.getWorldPosition(new Vector3()).distanceTo(updated.getObjectByName('camera-body-back')!.getWorldPosition(new Vector3()))<1e-8);
  assert.equal(housing.getObjectByName('camera-focus-ring')!.userData.focusControl,'camera-lens');
  assert.equal(housing.getObjectByName('camera-sensor-board')!.userData.focusControl,'camera-sensor');
});
