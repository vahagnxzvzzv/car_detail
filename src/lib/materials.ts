import * as THREE from 'three';
import type { Finish, PartSpec, Swatch } from '../data/products';

/** Physical paint values. Flake adds micro-normal sparkle under a smooth clearcoat. */
export const finishProperties:Record<Finish,{roughness:number;metalness:number;clearcoat:number;clearcoatRoughness:number;iridescence:number;flake:number}> = {
 Gloss:{roughness:.14,metalness:.22,clearcoat:1,clearcoatRoughness:.03,iridescence:0,flake:0},
 Matte:{roughness:.82,metalness:.03,clearcoat:0,clearcoatRoughness:.8,iridescence:0,flake:0},
 Satin:{roughness:.42,metalness:.13,clearcoat:.25,clearcoatRoughness:.45,iridescence:0,flake:0},
 Metallic:{roughness:.3,metalness:.72,clearcoat:1,clearcoatRoughness:.04,iridescence:0,flake:.07},
 Pearl:{roughness:.24,metalness:.38,clearcoat:1,clearcoatRoughness:.03,iridescence:.75,flake:.04},
 Chrome:{roughness:.05,metalness:1,clearcoat:.4,clearcoatRoughness:.02,iridescence:0,flake:0}
};

/** Adds procedural metallic flakes to a physical paint material. No UVs are required. */
/** Uniforms shared by all paint materials of one vehicle: carbon zones in vehicle space. */
export interface CarbonUniforms { uVehInv:{value:THREE.Matrix4}; uCarbonCount:{value:number}; uCarbonMin:{value:THREE.Vector3[]}; uCarbonMax:{value:THREE.Vector3[]} }
export const MAX_CARBON_ZONES=5;
export function carbonUniforms():CarbonUniforms{
 return {uVehInv:{value:new THREE.Matrix4()},uCarbonCount:{value:0},uCarbonMin:{value:Array.from({length:MAX_CARBON_ZONES},()=>new THREE.Vector3())},uCarbonMax:{value:Array.from({length:MAX_CARBON_ZONES},()=>new THREE.Vector3())}};
}

/**
 * Paint shader extensions, no UVs needed:
 * - metallic flakes (micro-normal sparkle under the smooth clearcoat),
 * - carbon fibre: a 2x2 twill weave projected in vehicle space inside the enabled zones.
 */
function addFlakes(m:THREE.MeshPhysicalMaterial,carbon:CarbonUniforms){
 // uRest maps an opened part (door, hood) back to its closed position, so carbon zones stay on the part.
 const uniforms={uFlake:{value:0},uRest:{value:new THREE.Matrix4()}};m.userData.flake=uniforms.uFlake;m.userData.rest=uniforms.uRest;m.userData.carbon=carbon;
 m.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms,carbon);
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vFlakePos;varying vec3 vCarbonPos;varying vec3 vCarbonN;uniform mat4 uVehInv;uniform mat4 uRest;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvFlakePos=position*vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));\nmat4 toVeh=uVehInv*uRest*modelMatrix;vCarbonPos=(toVeh*vec4(transformed,1.)).xyz;vCarbonN=normalize(mat3(toVeh)*objectNormal);');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
varying vec3 vFlakePos;varying vec3 vCarbonPos;varying vec3 vCarbonN;uniform float uFlake;uniform int uCarbonCount;uniform vec3 uCarbonMin[${MAX_CARBON_ZONES}];uniform vec3 uCarbonMax[${MAX_CARBON_ZONES}];
vec3 flakeHash(vec3 p){p=fract(p*vec3(443.897,441.423,437.195));p+=dot(p,p.yxz+19.19);return fract((p.xxy+p.yxx)*p.zyx)*2.-1.;}
float carbonZone(vec3 p){for(int i=0;i<${MAX_CARBON_ZONES};i++){if(i>=uCarbonCount)break;if(all(greaterThanEqual(p,uCarbonMin[i]))&&all(lessThanEqual(p,uCarbonMax[i])))return 1.;}return 0.;}
vec3 carbonWeave(vec3 p,vec3 n){vec3 a=abs(n);vec2 uv=a.y>max(a.x,a.z)?p.xz:(a.x>a.z?p.zy:p.xy);uv*=180.;vec2 cell=floor(uv),f=fract(uv);
 float dir=mod(cell.x+cell.y,4.)<2.?0.:1.;float across=dir<.5?f.x:f.y;float tow=pow(sin(across*3.14159),.55);
 return mix(vec3(.012,.013,.015),vec3(.07,.075,.085),tow*(dir<.5?1.:.62));}`)
   .replace('#include <color_fragment>','#include <color_fragment>\nfloat carbonMask=carbonZone(vCarbonPos);if(carbonMask>0.)diffuseColor.rgb=carbonWeave(vCarbonPos,normalize(vCarbonN));')
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.34,carbonMask);')
   .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,.2,carbonMask);')
   .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat*=mix(1.,.45,carbonMask);\n#endif')
   .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nif(uFlake>0.&&carbonMask<.5){vec3 cell=floor(vFlakePos*1500.);normal=normalize(normal+flakeHash(cell)*uFlake);}');
 };
 m.customProgramCacheKey=()=>'paint-flake-carbon';
}

/** Enables carbon fibre inside the given vehicle-space boxes (empty list = no carbon). */
export function setCarbon(u:CarbonUniforms,boxes:THREE.Box3[],vehicleSpaceInverse:THREE.Matrix4){
 u.uVehInv.value.copy(vehicleSpaceInverse);const n=Math.min(boxes.length,MAX_CARBON_ZONES);u.uCarbonCount.value=n;
 for(let i=0;i<n;i++){u.uCarbonMin.value[i].copy(boxes[i].min);u.uCarbonMax.value[i].copy(boxes[i].max);}
}

/**
 * Carbon zones from the painted body's bounds in vehicle space.
 * forward: unit axis the car faces (±x or ±z).
 */
export function carbonZones(paintBounds:THREE.Box3,forward:THREE.Vector3):Record<string,THREE.Box3>{
 const b=paintBounds,H=b.max.y,pad=.5;const axis=Math.abs(forward.x)>.5?'x':'z',sign=Math.sign(axis==='x'?forward.x:forward.z);
 const lo=b.min[axis],hi=b.max[axis],L=hi-lo;
 // a range along the car measured from its front (0) to its rear (1)
 const along=(fromFront:number,toFront:number)=>sign>0?[hi-toFront*L,hi-fromFront*L]:[lo+fromFront*L,lo+toFront*L];
 const side=axis==='x'?'z':'x',mid=(b.min[side]+b.max[side])/2,half=(b.max[side]-b.min[side])/2;
 const box=(y0:number,y1:number,a?:number[],width=1)=>{const mn=new THREE.Vector3(b.min.x-pad,y0,b.min.z-pad),mx=new THREE.Vector3(b.max.x+pad,y1,b.max.z+pad);if(a){mn[axis]=a[0];mx[axis]=a[1];}if(width<1){mn[side]=mid-half*width;mx[side]=mid+half*width;}return new THREE.Box3(mn,mx);};
 return {
  Roof:box(H*.84,H+pad,undefined,.8),
  Hood:box(H*.42,H*.84,along(-.1,.32),.66),
  'Rear deck':box(H*.5,H*.95,along(.78,1.1),.7),
  'Lower kit':box(-pad,H*.22),
  'Full body':box(-pad,H+pad)
 };
}

export function setPaint(materials:THREE.MeshPhysicalMaterial[],color:string,finish:Finish){
 const {flake,...props}=finishProperties[finish];
 for(const m of materials){m.color.set(color);Object.assign(m,props);if(m.userData.flake)m.userData.flake.value=flake;m.needsUpdate=true;}
}

/** Material tuning for models whose source materials need physical values. */
function tune(old:THREE.MeshStandardMaterial){
 const n=old.name;
 // BMW X5 (BMW Car IT naming)
 if(/Glass_1sided|Glass_2sided/.test(n)){old.color.set('#182126');old.metalness=.35;old.roughness=.13;old.transparent=true;old.opacity=.9;old.depthWrite=false;}
 if(/Tire/.test(n)){old.roughness=.85;old.metalness=0;old.color.set('#18191b');}
 if(/Chrome|Rim_Paint_silver/.test(n)){old.color.set('#aeb1b4');old.metalness=.95;old.roughness=.2;}
 if(/Plastic|M_I_/.test(n)){old.metalness=.04;}
 if(/LightEffect_F/.test(n)){old.emissive.set('#dceeff');old.emissiveIntensity=1.3;}
 if(/LightEffect_B/.test(n)){old.color.set('#9b0713');old.emissive.set('#9b0713');old.emissiveIntensity=.5;}
 // Ferrari 458 (three.js example naming)
 if(n==='metal_chrome'){old.color.set('#e8e8e8');old.metalness=1;old.roughness=.06;}
 if(n==='metal_gray'){old.color.set('#c4c7cb');old.metalness=1;old.roughness=.28;}
 if(n==='Tires'){old.color.set('#151517');old.metalness=0;old.roughness=.88;}
 if(n==='Glass_Gray'){old.color.set('#141a1e');old.metalness=.3;old.roughness=.06;old.transparent=true;old.opacity=.55;old.depthWrite=false;}
 if(/^(Leather|Leather_red)$/.test(n)){old.metalness=0;old.roughness=.55;}
 if(n==='Carpet'){old.color.set('#1c1c1d');old.metalness=0;old.roughness=1;}
 if(n==='Carbon_Fiber'){old.color.set('#1a1b1d');old.metalness=.35;old.roughness=.28;}
 if(/^(Interior_dark|Interior_light|plastic_gray)$/.test(n)){old.metalness=0;old.roughness=.6;}
 if(n==='Interior_light')old.color.set('#2a2a2b');
 if(n==='Projector_Glass'){old.emissive.set('#dceeff');old.emissiveIntensity=.4;old.metalness=.6;old.roughness=.05;}
 if(n==='Taillight_Glass'){old.emissive.set('#9b0713');old.emissiveIntensity=.3;old.metalness=.2;old.roughness=.1;}
 if(n==='Ferrari_Yellow'){old.metalness=.1;old.roughness=.3;}
}

export function prepareVehicle(scene:THREE.Object3D,paintNames:string[],length:number){
 const paints:THREE.MeshPhysicalMaterial[]=[];const carbon=carbonUniforms();const ownedMaterials=new Set<THREE.Material>();
 scene.traverse(o=>{if(!(o instanceof THREE.Mesh))return;o.castShadow=true;o.receiveShadow=true;
  const replace=(original:THREE.Material)=>{
   const old=original as THREE.MeshStandardMaterial;
   if(paintNames.includes(old.name)||old.userData.bodyPaint===true){
    const m=new THREE.MeshPhysicalMaterial({name:old.name,normalMap:old.normalMap,normalScale:old.normalScale,aoMap:old.aoMap,aoMapIntensity:old.aoMapIntensity??1,side:old.side,envMapIntensity:1.25});addFlakes(m,carbon);paints.push(m);ownedMaterials.add(old);return m;
   }
   if(old.isMeshStandardMaterial){tune(old);old.envMapIntensity=1;}
   return old;
  };
  o.material=Array.isArray(o.material)?o.material.map(replace):replace(o.material);
 });
 ownedMaterials.forEach(m=>m.dispose());
 scene.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(scene);const size=bounds.getSize(new THREE.Vector3());
 const longest=Math.max(size.x,size.z);if(!Number.isFinite(longest)||longest<=0)throw new Error('This model has no visible geometry.');
 scene.scale.multiplyScalar(length/longest);scene.updateMatrixWorld(true);
 const b=new THREE.Box3().setFromObject(scene),center=b.getCenter(new THREE.Vector3());scene.position.sub(new THREE.Vector3(center.x,b.min.y,center.z));
 scene.updateMatrixWorld(true);
 return paints;
}

/**
 * Restores symmetric halves that a source model is missing (e.g. the BMW hood only contains its left half).
 * Each named mesh gets a mirrored twin across the vehicle centerline. Call after prepareVehicle.
 */
export function mirrorMeshes(scene:THREE.Object3D,spec:{meshes:string[];axis:'x'|'z'}|undefined){
 if(!spec)return 0;scene.updateMatrixWorld(true);
 const reflect=new THREE.Matrix4().makeScale(spec.axis==='x'?-1:1,1,spec.axis==='z'?-1:1);
 // The vehicle root has no parent yet, so its world space is the normalized, centered vehicle space.
 const targets:THREE.Mesh[]=[];scene.traverse(o=>{if(o instanceof THREE.Mesh&&spec.meshes.includes(o.name))targets.push(o)});
 for(const m of targets){const twin=m.clone();twin.name=m.name+'_mirrored';
  const local=new THREE.Matrix4().copy(m.parent!.matrixWorld).invert().multiply(reflect).multiply(m.matrixWorld);
  local.decompose(twin.position,twin.quaternion,twin.scale);m.parent!.add(twin);}
 scene.updateMatrixWorld(true);return targets.length;
}

export interface HingedPart { id:string; label:string; obj:THREE.Object3D; base:THREE.Quaternion; axis:THREE.Vector3; angle:number; t:number; target:number; anchor:THREE.Vector3 }

/**
 * Prepares hinged parts. Source models disagree on hinge orientation (the BMW's right-side pivots are mirrored),
 * so each part is test-rotated both ways and the direction that moves it away from the vehicle center wins.
 * Also computes a hotspot anchor on the outside of each part, in the part's own local space.
 */
export function prepareOpenings(scene:THREE.Object3D,specs:{node:string;label:string;axis:'x'|'y'|'z';angle:number}[]|undefined):HingedPart[]{
 if(!specs?.length)return [];scene.updateMatrixWorld(true);
 const size=new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());const center=new THREE.Vector3(0,size.y*.5,0);
 const q=new THREE.Quaternion(),box=new THREE.Box3(),c=new THREE.Vector3();
 return specs.flatMap(s=>{
  const obj=scene.getObjectByName(s.node);if(!obj)return [];
  const axis=new THREE.Vector3(s.axis==='x'?1:0,s.axis==='y'?1:0,s.axis==='z'?1:0),base=obj.quaternion.clone();
  const restY=box.setFromObject(obj).getCenter(c).y;
  // Away from the car wins; upward motion breaks ties (scissor doors and lids swing up, never into the floor).
  const distanceAt=(a:number)=>{obj.quaternion.copy(base).multiply(q.setFromAxisAngle(axis,a));obj.updateMatrixWorld(true);box.setFromObject(obj).getCenter(c);return c.distanceTo(center)+Math.max(0,c.y-restY)*.8-Math.max(0,restY-c.y)*.8;};
  const angle=distanceAt(Math.abs(s.angle))>=distanceAt(-Math.abs(s.angle))?Math.abs(s.angle):-Math.abs(s.angle);
  obj.quaternion.copy(base);obj.updateMatrixWorld(true);
  const closed=box.setFromObject(obj).getCenter(new THREE.Vector3());const out=closed.clone().sub(center);out.y=Math.max(out.y,0);
  const anchor=obj.worldToLocal(closed.add(out.normalize().multiplyScalar(.12)));
  return [{id:s.node,label:s.label,obj,base,axis,angle,t:0,target:0,anchor}];
 });
}

/** Moves each hinged part toward its target (0 closed, 1 open). Returns true while anything is still moving. */
export function stepOpenings(parts:HingedPart[],delta:number){
 const q=new THREE.Quaternion();let moving=false;
 for(const p of parts){if(p.t===p.target)continue;p.t+=Math.sign(p.target-p.t)*Math.min(Math.abs(p.target-p.t),delta*1.5);const k=p.t*p.t*(3-2*p.t);p.obj.quaternion.copy(p.base).multiply(q.setFromAxisAngle(p.axis,p.angle*k));moving=true;}
 return moving;
}

const hasAncestor=(o:THREE.Object3D,names:string[])=>{for(let n:THREE.Object3D|null=o;n;n=n.parent)if(names.includes(n.name))return true;return false;};

/** Removes helper nodes that must not render or count toward the car's size. */
export function hideNodes(scene:THREE.Object3D,names:string[]|undefined){
 if(!names?.length)return 0;const found=names.map(n=>scene.getObjectByName(n)).filter((o):o is THREE.Object3D=>!!o);
 for(const o of found){o.removeFromParent();disposeObject(o);}return found.length;
}

/**
 * Finds the materials of one customizable part and gives the part its own material copies,
 * so recoloring a part never changes another part that shared the original material.
 */
export function collectPart(scene:THREE.Object3D,spec:PartSpec|undefined){
 if(!spec)return [] as THREE.MeshStandardMaterial[];
 const clones=new Map<THREE.Material,THREE.MeshStandardMaterial>();
 scene.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
  const meshOk=(!spec.meshes||spec.meshes.some(p=>o.name.startsWith(p)))&&(!spec.nodes||hasAncestor(o,spec.nodes));
  if(!meshOk)return;
  const swap=(m:THREE.Material)=>{const s=m as THREE.MeshStandardMaterial;if(!s.isMeshStandardMaterial||(spec.materials&&!spec.materials.includes(s.name)))return m;
   let c=clones.get(m);if(!c){c=s.clone();c.userData.base={color:s.color.getHex(),opacity:s.opacity,emissive:s.emissive.getHex(),emissiveIntensity:s.emissiveIntensity};clones.set(m,c);}return c;};
  o.material=Array.isArray(o.material)?o.material.map(swap):swap(o.material);
 });
 return [...clones.values()];
}

export function applySwatch(materials:THREE.MeshStandardMaterial[],swatch:Swatch){
 for(const m of materials){m.color.set(swatch.hex);if(swatch.metalness!==undefined)m.metalness=swatch.metalness;if(swatch.roughness!==undefined)m.roughness=swatch.roughness;m.needsUpdate=true;}
}

/** 0 = clear glass, 1 = limo tint. */
export function setTint(materials:THREE.MeshStandardMaterial[],tint:number){
 const clear=new THREE.Color('#5d6b72'),dark=new THREE.Color('#050607');
 for(const m of materials){m.transparent=true;m.depthWrite=false;m.color.copy(clear).lerp(dark,tint);m.opacity=THREE.MathUtils.lerp(.32,.94,tint);m.needsUpdate=true;}
}

/** Switches lamps on (bright emissive) or back to their resting appearance. */
export function setLamps(materials:THREE.MeshStandardMaterial[],on:boolean,color:string,onIntensity:number){
 for(const m of materials){const b=m.userData.base;if(on){m.emissive.set(color);m.emissiveIntensity=onIntensity;}else if(b){m.emissive.setHex(b.emissive);m.emissiveIntensity=b.emissiveIntensity;}}
}

export function disposeObject(object:THREE.Object3D){
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 object.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}});
 materials.forEach(m=>{Object.values(m).forEach(v=>{if(v instanceof THREE.Texture)textures.add(v);});m.dispose();});textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());
}
