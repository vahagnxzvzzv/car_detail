// Cuts openable parts (doors, hood, trunk) out of merged car meshes and gives each one a hinge node.
// Usage: node scripts/split-parts.mjs <in.gltf> <config.json> <out.gltf>
//
// Config: { "parts": [ { "name": "Door_L", "hinge": [x,y,z], "box": { "min": [..], "max": [..] }, "materials"?: ["substr", ...] } ] }
// All coordinates are in the file's scene (world) space, as printed by scripts/mesh-islands.mjs.
// Every geometry island (connected piece) that lies completely inside a part's box moves to that part:
// door skin, inner panel, glass, handle, mirror. The new node sits at the hinge, so rotating it opens the part.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import fs from 'node:fs';
import {islands, worldPositions} from './lib/islands.mjs';

const [input,configFile,output]=process.argv.slice(2);
const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.read(input);const root=doc.getRoot();const buffer=root.listBuffers()[0];const scene=root.getDefaultScene()??root.listScenes()[0];
const tol=config.tolerance??0.002;

function normalMatrix(m){ // inverse-transpose of the upper 3x3 of a column-major 4x4
 const a=m[0],b=m[1],c=m[2],d=m[4],e=m[5],f=m[6],g=m[8],h=m[9],i=m[10];
 const A=e*i-f*h,B=-(d*i-f*g),C=d*h-e*g,det=a*A+b*B+c*C||1;
 return [A/det,B/det,C/det,-(b*i-c*h)/det,(a*i-c*g)/det,-(a*h-b*g)/det,(b*f-c*e)/det,-(a*f-c*d)/det,(a*e-b*d)/det];
}

const partNodes=new Map(),partMeshes=new Map(),partMeshNodes=new Set(),stats={};
for(const p of config.parts){
 // Empty hinge node + mesh child: compression may re-centre mesh nodes, but never this pivot.
 const node=doc.createNode(p.name).setTranslation(p.hinge);const mesh=doc.createMesh(p.name);const meshNode=doc.createNode(p.name+'_mesh').setMesh(mesh);node.addChild(meshNode);scene.addChild(node);
 partNodes.set(p.name,node);partMeshNodes.add(meshNode);partMeshes.set(p.name,mesh);stats[p.name]={islands:0,tris:0};
}
const inside=(c,b)=>c.min.every((v,k)=>v>=b.min[k]-tol)&&c.max.every((v,k)=>v<=b.max[k]+tol);

for(const node of root.listNodes()){
 const mesh=node.getMesh();if(!mesh||partMeshNodes.has(node))continue;
 const world=node.getWorldMatrix();const nm=normalMatrix(world);
 for(const prim of mesh.listPrimitives()){
  const matName=prim.getMaterial()?.getName()??'';
  const pos=worldPositions(node,prim);const comps=islands(prim,pos);
  // which part (if any) takes each island
  const excluded=(config.exclude??[]).some(s=>matName.includes(s));
  const owner=comps.map(c=>excluded?null:config.parts.find(p=>(!p.materials||p.materials.some(s=>matName.includes(s)))&&inside(c,p.box))?.name??null);
  if(owner.every(o=>o===null))continue;
  const idx=prim.getIndices();const get=i=>idx?idx.getScalar(i):i;const triCount=(idx?idx.getCount():pos.length/3)/3;
  const nrm=prim.getAttribute('NORMAL'),uv=prim.getAttribute('TEXCOORD_0');
  const keep=[];const moved=new Map();
  for(let t=0;t<triCount;t++){const o=owner[comps.triIsland[t]];if(o){(moved.get(o)??moved.set(o,[]).get(o)).push(t);}else keep.push(get(t*3),get(t*3+1),get(t*3+2));}
  for(const [partName,tris] of moved){
   const hinge=config.parts.find(p=>p.name===partName).hinge;const n=tris.length*3;
   const P=new Float32Array(n*3),N=nrm?new Float32Array(n*3):null,U=uv?new Float32Array(n*2):null;const v=[0,0,0],w=[0,0];
   tris.forEach((t,ti)=>{for(let k=0;k<3;k++){const src=get(t*3+k),dst=ti*3+k;
    for(let d=0;d<3;d++)P[dst*3+d]=pos[src*3+d]-hinge[d];
    if(N){nrm.getElement(src,v);const x=nm[0]*v[0]+nm[3]*v[1]+nm[6]*v[2],y=nm[1]*v[0]+nm[4]*v[1]+nm[7]*v[2],z=nm[2]*v[0]+nm[5]*v[1]+nm[8]*v[2];const l=Math.hypot(x,y,z)||1;N[dst*3]=x/l;N[dst*3+1]=y/l;N[dst*3+2]=z/l;}
    if(U){uv.getElement(src,w);U[dst*2]=w[0];U[dst*2+1]=w[1];}}});
   const np=doc.createPrimitive().setMaterial(prim.getMaterial()).setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer));
   if(N)np.setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer));
   if(U)np.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(U).setBuffer(buffer));
   partMeshes.get(partName).addPrimitive(np);stats[partName].tris+=tris.length;
   stats[partName].islands+=new Set(tris.map(t=>comps.triIsland[t])).size;
  }
  const newIdx=doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(buffer);
  if(idx)prim.setIndices(newIdx);else{prim.setIndices(newIdx);}
 }
}
for(const [name,s] of Object.entries(stats))console.log(`${name}: ${s.islands} islands, ${s.tris} triangles`);

// Optional: merge everything except the openable parts into one mesh per material (fewer draw calls).
if(config.collapse){
 const groups=new Map();const partSet=new Set([...partNodes.values(),...partMeshNodes]);
 for(const node of root.listNodes()){
  const mesh=node.getMesh();if(!mesh||partSet.has(node))continue;const world=node.getWorldMatrix(),nm=normalMatrix(world);
  for(const prim of mesh.listPrimitives()){
   const idx=prim.getIndices();const pos=worldPositions(node,prim);const nrm=prim.getAttribute('NORMAL'),uv=prim.getAttribute('TEXCOORD_0');
   const g=groups.get(prim.getMaterial())??groups.set(prim.getMaterial(),{P:[],N:[],U:[],I:[],count:0,hasN:true,hasU:true}).get(prim.getMaterial());
   const n=pos.length/3,base=g.count;const v=[0,0,0],w=[0,0];g.hasN&&=!!nrm;g.hasU&&=!!uv;
   for(let i=0;i<n;i++){g.P.push(pos[i*3],pos[i*3+1],pos[i*3+2]);
    if(nrm){nrm.getElement(i,v);const x=nm[0]*v[0]+nm[3]*v[1]+nm[6]*v[2],y=nm[1]*v[0]+nm[4]*v[1]+nm[7]*v[2],z=nm[2]*v[0]+nm[5]*v[1]+nm[8]*v[2];const l=Math.hypot(x,y,z)||1;g.N.push(x/l,y/l,z/l);}
    if(uv){uv.getElement(i,w);g.U.push(w[0],w[1]);}}
   const count=idx?idx.getCount():n;for(let t=0;t<count;t++)g.I.push(base+(idx?idx.getScalar(t):t));g.count+=n;
  }
 }
 const body=doc.createNode('Body');const bodyMesh=doc.createMesh('Body');body.setMesh(bodyMesh);
 for(const [mat,g] of groups){if(!g.I.length)continue;const p=doc.createPrimitive().setMaterial(mat).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.I)).setBuffer(buffer)).setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.P)).setBuffer(buffer));
  if(g.hasN&&g.N.length===g.P.length)p.setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.N)).setBuffer(buffer));
  if(g.hasU&&g.U.length/2===g.P.length/3)p.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.U)).setBuffer(buffer));bodyMesh.addPrimitive(p);}
 for(const child of scene.listChildren())if(!partSet.has(child)){scene.removeChild(child);child.traverse(n=>n.dispose());}
 scene.addChild(body);console.log(`collapsed into ${bodyMesh.listPrimitives().length} body primitives`);
}
await io.write(output,doc);
