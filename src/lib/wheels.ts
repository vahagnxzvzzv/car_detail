import * as THREE from 'three';

/** Procedural rim designs that replace a car's original rims, fitted to each measured wheel. */
export const rimDesigns=['Original','Five Spoke','Split Ten','Mesh','Turbine','Y-Spoke','Deep Dish'] as const;
export type RimDesign=typeof rimDesigns[number];

export interface WheelSlot { center:THREE.Vector3; radius:number; width:number; outward:THREE.Vector3 }

/**
 * Measures the four wheels from the rim meshes: vertices are split into quadrants (left/right × front/rear)
 * in vehicle space; each quadrant's bounds give the wheel centre, radius, width and outward side.
 */
export function findWheelSlots(root:THREE.Object3D,rimMeshes:THREE.Mesh[],forward:THREE.Vector3):WheelSlot[]{
 root.updateMatrixWorld(true);
 const lat=new THREE.Vector3().crossVectors(forward,new THREE.Vector3(0,1,0)).normalize();
 const boxes=[0,1,2,3].map(()=>new THREE.Box3());const v=new THREE.Vector3();const counts=[0,0,0,0];
 for(const mesh of rimMeshes){
  const pos=mesh.geometry.attributes.position;const step=Math.max(1,Math.floor(pos.count/4000));
  for(let i=0;i<pos.count;i+=step){v.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
   const q=(v.dot(lat)>0?1:0)+(v.dot(forward)>0?2:0);boxes[q].expandByPoint(v);counts[q]++;}
 }
 const slots:WheelSlot[]=[];
 boxes.forEach((b,i)=>{if(counts[i]<20||b.isEmpty())return;
  const size=b.getSize(new THREE.Vector3()),center=b.getCenter(new THREE.Vector3());
  const width=Math.abs(size.dot(lat));const along=Math.abs(size.dot(forward));
  slots.push({center,radius:Math.max(size.y,along)/2,width:Math.max(width,.12),outward:lat.clone().multiplyScalar(center.dot(lat)>0?1:-1)});});
 return slots;
}

/** Closed 2D outline of one spoke between two radii, optionally swept (curved) around the hub. */
function spoke(angle:number,r0:number,r1:number,w0:number,w1:number,sweep=0){
 const pts:THREE.Vector2[]=[];const steps=8;
 const edge=(side:number)=>{const out:THREE.Vector2[]=[];for(let s=0;s<=steps;s++){const t=s/steps,r=r0+(r1-r0)*t,w=w0+(w1-w0)*t,a=angle+sweep*t+side*(w/2)/r;out.push(new THREE.Vector2(Math.cos(a)*r,Math.sin(a)*r));}return out;};
 pts.push(...edge(-1),...edge(1).reverse());return new THREE.Shape(pts);
}

function facePattern(design:RimDesign,R:number){
 const s:THREE.Shape[]=[];const TAU=Math.PI*2;const hub=R*.24,end=R*.93;
 switch(design){
  case 'Five Spoke':for(let i=0;i<5;i++)s.push(spoke(i*TAU/5,hub*.9,end,R*.34,R*.24));break;
  case 'Split Ten':for(let i=0;i<5;i++)for(const d of [-.13,.13])s.push(spoke(i*TAU/5+d*(1),hub*.9,end,R*.12,R*.1));break;
  case 'Mesh':for(let i=0;i<10;i++){s.push(spoke(i*TAU/10,hub*.9,end,R*.06,R*.05,.32));s.push(spoke(i*TAU/10,hub*.9,end,R*.06,R*.05,-.32));}break;
  case 'Turbine':for(let i=0;i<14;i++)s.push(spoke(i*TAU/14,hub*.9,end,R*.09,R*.07,.75));break;
  case 'Y-Spoke':for(let i=0;i<5;i++){const a=i*TAU/5;s.push(spoke(a,hub*.9,R*.56,R*.22,R*.15));for(const d of [-.2,.2])s.push(spoke(a+d*.35,R*.5,end,R*.1,R*.085,d*.6));}break;
  case 'Deep Dish':for(let i=0;i<6;i++)s.push(spoke(i*TAU/6,hub*.9,R*.8,R*.2,R*.15));break;
 }
 return s;
}

export interface BuiltWheel { group:THREE.Group; rimMaterial:THREE.MeshPhysicalMaterial }

/** Builds one wheel in local space: axle along +X, outer face at +X. */
export function buildWheel(design:RimDesign,slot:WheelSlot,tire:boolean,rimMaterial:THREE.MeshPhysicalMaterial){
 const g=new THREE.Group();const R=tire?slot.radius*.72:slot.radius*.985,W=slot.width*(tire?.92:.96);
 const dish=design==='Deep Dish'?W*.42:W*.14;const faceX=W/2-dish;
 const dark=new THREE.MeshStandardMaterial({color:0x111214,metalness:.6,roughness:.45});
 const lipMat=design==='Deep Dish'?new THREE.MeshPhysicalMaterial({color:0xeeeeee,metalness:1,roughness:.06,clearcoat:.4}):rimMaterial;
 // barrel + lip (lathe around Y, then turned so the axle is X)
 const prof=[[R*.9,-W/2],[R*.93,-W/2+W*.05],[R*.9,-W/2+W*.12],[R*.9,W/2-W*.1],[R*.96,W/2-W*.04],[R,W/2-W*.02],[R,W/2],[R*.95,W/2+.002],[R*.91,W/2-W*.03]].map(([r,y])=>new THREE.Vector2(r,y));
 const barrel=new THREE.Mesh(new THREE.LatheGeometry(prof,64).rotateZ(-Math.PI/2),lipMat);g.add(barrel);
 const inner=new THREE.Mesh(new THREE.CylinderGeometry(R*.9,R*.9,W*.9,48,1,true).rotateZ(Math.PI/2),dark);inner.material.side=THREE.BackSide;g.add(inner);
 // spokes, extruded toward the inside of the wheel
 const depth=Math.max(W*.12,R*.07);
 const spokes=new THREE.ExtrudeGeometry(facePattern(design,R),{depth,bevelEnabled:true,bevelThickness:R*.012,bevelSize:R*.01,bevelSegments:2,curveSegments:2});
 spokes.rotateY(Math.PI/2);spokes.translate(faceX-depth,0,0);
 // spokes for Deep Dish meet a step ring instead of the lip
 g.add(new THREE.Mesh(spokes,rimMaterial));
 if(design==='Deep Dish'){const step=new THREE.Mesh(new THREE.CylinderGeometry(R*.82,R*.82,dish+depth,56,1,true).rotateZ(Math.PI/2),rimMaterial);step.position.x=faceX+dish/2-depth/2;g.add(step);
  const ring=new THREE.Mesh(new THREE.RingGeometry(R*.8,R*.99,64).rotateY(Math.PI/2),lipMat);ring.position.x=W/2-.001;g.add(ring);}
 else{const ring=new THREE.Mesh(new THREE.RingGeometry(R*.9,R*.97,64).rotateY(Math.PI/2),rimMaterial);ring.position.x=faceX+.001;g.add(ring);}
 // hub, cap and lug nuts
 const hub=new THREE.Mesh(new THREE.CylinderGeometry(R*.25,R*.27,depth*1.1,40).rotateZ(Math.PI/2),rimMaterial);hub.position.x=faceX-depth*.45;g.add(hub);
 const cap=new THREE.Mesh(new THREE.CylinderGeometry(R*.1,R*.1,depth*.3,32).rotateZ(Math.PI/2),new THREE.MeshPhysicalMaterial({color:0x0b0b0c,metalness:.4,roughness:.25,clearcoat:1}));cap.position.x=faceX+depth*.15;g.add(cap);
 const nutGeo=new THREE.CylinderGeometry(R*.028,R*.028,depth*.5,6).rotateZ(Math.PI/2);const nutMat=new THREE.MeshStandardMaterial({color:0x9a9da2,metalness:1,roughness:.3});
 for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const n=new THREE.Mesh(nutGeo,nutMat);n.position.set(faceX+depth*.1,Math.cos(a)*R*.17,Math.sin(a)*R*.17);g.add(n);}
 // when the original wheel (tire included) is replaced: brake disc + tire
 if(tire){
  const disc=new THREE.Mesh(new THREE.CylinderGeometry(R*.78,R*.78,W*.08,48).rotateZ(Math.PI/2),new THREE.MeshStandardMaterial({color:0x6d6f72,metalness:.9,roughness:.45}));disc.position.x=-W*.12;g.add(disc);
  const T=slot.radius,tw=slot.width;
  const tp=[[R*.98,-tw/2+.01],[T*.93,-tw/2],[T*.985,-tw/2+tw*.07],[T,-tw/2+tw*.16],[T,tw/2-tw*.16],[T*.985,tw/2-tw*.07],[T*.93,tw/2],[R*.98,tw/2-.01]].map(([r,y])=>new THREE.Vector2(r,y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(tp,72).rotateZ(-Math.PI/2),new THREE.MeshStandardMaterial({color:0x141416,roughness:.88,metalness:0})));
 }
 g.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
 return g;
}

/** Places a locally built wheel on its slot (outward face pointing away from the car). */
export function placeWheel(group:THREE.Group,slot:WheelSlot){
 group.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),slot.outward);group.position.copy(slot.center);
}
