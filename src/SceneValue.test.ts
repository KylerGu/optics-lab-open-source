import assert from 'node:assert/strict';
import test from 'node:test';
import {displayNumber,sceneDisplayValue,sceneAxisDisplay} from './SceneValue';

test('result display uses at most two decimals without altering source precision',()=>{
 const input=151.454321;assert.equal(displayNumber(input),'151.45');assert.equal(input,151.454321);
 assert.equal(displayNumber(-.51452),'-0.51');assert.equal(displayNumber(100),'100');
 assert.equal(displayNumber(-0),'0');assert.equal(displayNumber(null),'—');
});
test('small signed lengths and angles change unit before rounding and retain nonzero results',()=>{
 for(const [value,unit,text,shownUnit] of [[.295543,'mm','295.54','μm'],[-.000123456,'mm','-123.46','nm'],[.413245,'µm','413.25','nm'],[.5,'°','30','角分'],[.0001,'°','0.36','角秒'],[.01234,'mrad','12.34','μrad'],[0,'mm','0','mm'],[null,'mm','—',''] ] as const){
  const shown=sceneDisplayValue(value,unit);assert.equal(shown.text,text);assert.equal(shown.unit,shownUnit);
 }
 assert.equal(sceneDisplayValue(.0001234,'').text,'1.23e-4');assert.equal(sceneDisplayValue(.004,'mm').text,'4');
 assert.equal(sceneDisplayValue(12.3456,'%').text,'12.35');
});
test('all ticks on a plot axis share one converted unit including signed and zero ticks',()=>{
 const axis=sceneAxisDisplay('像距 / mm',.025);assert.equal(axis.label,'像距 / μm');assert.equal(axis.format(-.01),'-10');assert.equal(axis.format(0),'0');assert.equal(axis.format(.025),'25');
 assert.equal(sceneAxisDisplay('物距 / mm',600).format(123.456),'123.46');
});
