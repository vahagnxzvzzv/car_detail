import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {prepareVehicle,setPaint,disposeObject,finishProperties,collectPart,applySwatch,mirrorMeshes,prepareOpenings,stepOpenings} from '../src/lib/materials.ts';
globalThis.ProgressEvent ??= class ProgressEvent { constructor(type,init={}){ this.type=type; Object.assign(this,init); } };
const catalog=JSON.parse(fs.readFileSync(new URL('../public/catalog.json',import.meta.url)));
async function getModel(){
 const bytes=fs.readFileSync(new URL('../public/models/bmw-x5-g05-2018.glb',import.meta.url));
 const len=bytes.readUInt32LE(12);const doc=JSON.parse(bytes.subarray(20,20+len).toString());
 doc.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+len).toString('base64');
 // Node has no image decoder. Remove only texture references for geometry/material tests.
 const removeMaps=o=>{if(o&&typeof o==='object')for(const k of Object.keys(o)){if(k.endsWith('Texture'))delete o[k];else removeMaps(o[k]);}};
 doc.materials.forEach(removeMaps);delete doc.images;delete doc.textures;delete doc.samplers;
 const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 return (await loader.parseAsync(JSON.stringify(doc),'' )).scene;
}
test('every advertised vehicle and supporting asset is installed, with honest year metadata',()=>{
 for(const v of catalog.vehicles){assert.equal(v.available,true);assert.ok(fs.existsSync(new URL('../public'+v.asset,import.meta.url)));assert.ok(Number.isInteger(v.year));assert.ok(v.paintMaterials.length);assert.ok(v.attribution&&v.source);if(v.cabin)assert.ok(v.cabin.seats.length>=1)}
 assert.equal(catalog.vehicles.find(v=>v.id==='bmw-x5-g05-2018').year,2018,'the BMW asset is the 2018 model');
 for(const n of ['T_common_Logo_BMW.png','T_common_Logo_BMW_Alpha.png','T_G05_Tire_N.png','T_ParadoxCat_LicensePlate.png'])assert.ok(fs.statSync(new URL('../public/models/'+n,import.meta.url)).size>1000);
});
test('real BMW assembles four wheels, all doors and realistic centered dimensions',async()=>{
 const scene=await getModel();const paints=prepareVehicle(scene,catalog.vehicles[0].paintMaterials,4.92);
 const tires=[];scene.traverse(o=>{if(o instanceof THREE.Mesh&&o.name.includes('Wheel_Tire'))tires.push(o)});
 assert.equal(tires.length,4);assert.ok(paints.length>=6);
 const b=new THREE.Box3().setFromObject(scene),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3());
 assert.ok(Math.abs(s.x-4.92)<.001);assert.ok(s.y>1.5&&s.y<2.1);assert.ok(s.z>1.9&&s.z<2.5);assert.ok(Math.abs(b.min.y)<.001);assert.ok(Math.abs(c.x)<.001&&Math.abs(c.z)<.001);
 for(const tire of tires){const box=new THREE.Box3().setFromObject(tire);assert.ok(Math.abs(box.min.y)<.05,'all four tires touch the same floor');}
 console.log('Validated model dimensions (m):',s.toArray().map(n=>n.toFixed(3)).join(' × '),'painted parts:',paints.length);
 disposeObject(scene);
});
test('black, red and white recolor coachwork without touching wheels, glass or trim; finishes change PBR',async()=>{
 const scene=await getModel();const paints=prepareVehicle(scene,catalog.vehicles[0].paintMaterials,4.92);const untouched=new Map();
 scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(!paints.includes(m))untouched.set(m,{color:m.color?.getHex(),roughness:m.roughness,metalness:m.metalness});});
 for(const color of ['#090A0C','#D52236','#F4F4F2'])for(const finish of Object.keys(finishProperties)){
  setPaint(paints,color,finish);for(const m of paints){assert.equal(m.color.getHexString(),color.slice(1).toLowerCase());assert.equal(m.roughness,finishProperties[finish].roughness)}
  for(const [m,before]of untouched){assert.equal(m.color?.getHex(),before.color);assert.equal(m.roughness,before.roughness);assert.equal(m.metalness,before.metalness)}
 }
 assert.equal(new Set(Object.values(finishProperties).map(p=>p.roughness)).size,Object.keys(finishProperties).length);disposeObject(scene);
});
test('BMW customizable parts are found and recolor independently; missing hood half is restored',async()=>{
 const v=catalog.vehicles.find(x=>x.id==='bmw-x5-g05-2018');const scene=await getModel();prepareVehicle(scene,v.paintMaterials,v.length);
 const hoodBefore=new THREE.Box3().setFromObject(scene.getObjectByName('001_Hood_paint'));assert.ok(hoodBefore.min.z>-.05,'source hood only has one half');
 assert.equal(mirrorMeshes(scene,v.mirror),2);const hood=new THREE.Box3().setFromObject(scene.getObjectByName('Pivot_G05_Hood'));assert.ok(Math.abs(hood.min.z+hood.max.z)<.02,'hood is symmetric after mirroring');
 const rims=collectPart(scene,v.parts.rims),calipers=collectPart(scene,v.parts.calipers),interior=collectPart(scene,v.parts.interior),glass=collectPart(scene,v.parts.glass);
 for(const p of [rims,calipers,interior,glass])assert.ok(p.length>=1);
 applySwatch(calipers,{name:'Red',hex:'#C4161C'});applySwatch(rims,{name:'Black',hex:'#0B0B0C'});
 let caliperRed=0,rimBlack=0,dashboard;scene.traverse(o=>{if(!(o instanceof THREE.Mesh))return;if(o.name.startsWith('006_Brake_Caliper')&&o.material.color.getHexString()==='c4161c')caliperRed++;if(o.name.startsWith('002_Wheel_Rim')&&o.material.color.getHexString()==='0b0b0c')rimBlack++;if(o.name==='002_Dashboard_common_general')dashboard=o.material;});
 assert.equal(caliperRed,4);assert.equal(rimBlack,4);applySwatch(interior,{name:'Cognac',hex:'#6B3419'});assert.notEqual(dashboard.color.getHexString(),'6b3419','dashboard keeps its own material');
 for(const o of v.openings)assert.ok(scene.getObjectByName(o.node),o.node+' exists');
 disposeObject(scene);
});
test('every BMW door, the hood, tailgate and flap swing outward (right-side pivots are mirrored in the source)',async()=>{
 const v=catalog.vehicles.find(x=>x.id==='bmw-x5-g05-2018');const scene=await getModel();prepareVehicle(scene,v.paintMaterials,v.length);
 const parts=prepareOpenings(scene,v.openings);assert.equal(parts.length,v.openings.length);
 const center=b=>b.getCenter(new THREE.Vector3());
 for(const p of parts){const closed=center(new THREE.Box3().setFromObject(p.obj));p.target=1;stepOpenings([p],10);scene.updateMatrixWorld(true);const open=center(new THREE.Box3().setFromObject(p.obj));
  if(p.axis.y===1&&p.label.includes('door'))assert.ok(Math.abs(open.z)>Math.abs(closed.z)+.1,p.label+' must swing away from the car, not into the cabin');
  if(p.label==='Hood')assert.ok(open.y>closed.y+.1,'hood lifts');
  if(p.label==='Tailgate')assert.ok(open.x>closed.x+.1&&open.y>closed.y,'tailgate swings up and back');}
 const left=parts.find(p=>p.label==='Front left door'),right=parts.find(p=>p.label==='Front right door');assert.ok(left&&right);
 disposeObject(scene);
});
test('every catalog opening exists as a hinge node in its model file (split parts survived compression)',()=>{
 const json=file=>{const b=fs.readFileSync(new URL('../public'+file,import.meta.url));const len=b.readUInt32LE(12);return JSON.parse(b.subarray(20,20+len).toString());};
 for(const v of catalog.vehicles){if(!v.openings?.length)continue;const doc=json(v.asset);const byName=new Map(doc.nodes.map(n=>[n.name,n]));
  for(const o of v.openings){const n=byName.get(o.node);assert.ok(n,`${v.id}: ${o.node} missing`);
   if(v.id!=='bmw-x5-g05-2018'){assert.equal(n.mesh,undefined,`${v.id}: ${o.node} must be an empty hinge (compression may move mesh nodes)`);assert.ok((n.children||[]).length,`${v.id}: ${o.node} has its part as a child`);}}}
});
