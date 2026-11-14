import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {Reflector} from 'three/examples/jsm/objects/Reflector.js';
import {HorizontalBlurShader} from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import {VerticalBlurShader} from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import {buildGarage,ROOM} from '../lib/garage';
import {buildInterior,setInterior,type InteriorUniforms} from '../lib/interior';
import {buildWheel,findWheelSlots,placeWheel,type RimDesign,type WheelSlot} from '../lib/wheels';
import {applySwatch,carbonZones,collectPart,disposeObject,hideNodes,mirrorMeshes,setCarbon,type CarbonUniforms,prepareOpenings,prepareVehicle,setLamps,setPaint,setTint,stepOpenings,type HingedPart} from '../lib/materials';
import {ambientOptions,caliperOptions,interiorOptions,rimOptions,type Look,type Swatch,type Vehicle} from '../data/products';

export type ViewMode='exterior'|'interior';
export interface Viewer {load:(v:Vehicle)=>Promise<void>;clear:()=>void;rotate:(amount:number)=>void;zoom:(amount:number)=>void;home:()=>void;auto:(enabled:boolean)=>void;setMode:(mode:ViewMode,seat:number)=>void;prefetch:(v:Vehicle)=>void}
interface Props {look:Look;onError:(message:string)=>void;onProgress:(progress:number)=>void;onInteraction:()=>void;onToggleOpening:(id:string)=>void}

const UP=new THREE.Vector3(0,1,0);
const find=(list:Swatch[],name:string)=>list.find(s=>s.name===name)??list[0];
const smooth=(t:number)=>t*t*(3-2*t);

/** Floor mirror that fades out with distance, layered over the photographed floor. */
const reflectionShader={
 name:'FloorReflection',
 uniforms:{color:{value:null},tDiffuse:{value:null},textureMatrix:{value:null},strength:{value:.2}},
 vertexShader:`uniform mat4 textureMatrix;varying vec4 vUv;varying vec2 vPos;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){vUv=textureMatrix*vec4(position,1.);vPos=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`,
 fragmentShader:`uniform sampler2D tDiffuse;uniform float strength;varying vec4 vUv;varying vec2 vPos;
#include <logdepthbuf_pars_fragment>
void main(){
#include <logdepthbuf_fragment>
vec2 uv=vUv.xy/vUv.w;float px=.0045;
vec4 c=texture2D(tDiffuse,uv)*.36+(texture2D(tDiffuse,uv+vec2(px,0.))+texture2D(tDiffuse,uv-vec2(px,0.))+texture2D(tDiffuse,uv+vec2(0.,px))+texture2D(tDiffuse,uv-vec2(0.,px)))*.16;
float fade=1.-smoothstep(3.5,10.5,length(vPos));
gl_FragColor=vec4(c.rgb,c.a*strength*fade);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`
};

export const GarageScene=forwardRef<Viewer,Props>(function GarageScene({look,onError,onProgress,onInteraction,onToggleOpening},ref){
 const host=useRef<HTMLDivElement>(null);
 const [hotspots,setHotspots]=useState<{id:string;label:string}[]>([]);const hotspotEls=useRef(new Map<string,HTMLButtonElement>());
 const state=useRef<(Viewer&{apply:(l:Look)=>void})|null>(null);
 const current=useRef({look,onError,onProgress,onInteraction,onToggleOpening});current.current={look,onError,onProgress,onInteraction,onToggleOpening};
 useImperativeHandle(ref,()=>({load:async v=>{if(!state.current)throw new Error('3D viewing is unavailable. Please enable hardware acceleration and reload.');await state.current.load(v)},clear:()=>state.current?.clear(),rotate:a=>state.current?.rotate(a),zoom:a=>state.current?.zoom(a),home:()=>state.current?.home(),auto:e=>state.current?.auto(e),setMode:(m,s)=>state.current?.setMode(m,s),prefetch:v=>state.current?.prefetch(v)}),[]);
 useEffect(()=>{state.current?.apply(look)},[look]);
 // Re-render once hotspot buttons mount so they get positioned.
 useEffect(()=>{state.current?.apply(current.current.look)},[hotspots]);
 useEffect(()=>{
 const container=host.current!;let renderer:THREE.WebGLRenderer;
 try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});}catch{return;}
 renderer.setClearColor(0x050506,1);renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.domElement.setAttribute('aria-label','Interactive 3D vehicle. Drag to rotate or look around, scroll to zoom.');renderer.domElement.tabIndex=0;container.appendChild(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,100);const orbit=new THREE.Group();scene.add(orbit);
 const maxAniso=renderer.capabilities.getMaxAnisotropy();
 if(import.meta.env.DEV)Object.assign(window,{__studio:{scene,renderer,camera,orbit,render:()=>renderer.render(scene,camera)}});

 // Image-based lighting
 const garage=buildGarage();
 const envScene=new THREE.Scene();envScene.background=new THREE.Color(0x050506);
 // Capture reflections from roughly car-roof height. A soft overhead panel (only in the reflection map) keeps paint highlights readable.
 garage.group.position.y=-1.2;envScene.add(garage.group);
 const softbox=new THREE.Mesh(new THREE.PlaneGeometry(6,3.5),new THREE.MeshBasicMaterial({color:new THREE.Color(1.6,1.6,1.6),side:THREE.DoubleSide}));softbox.rotation.x=Math.PI/2;softbox.position.y=ROOM.height-1.25;envScene.add(softbox);
 const extras:THREE.Mesh[]=[softbox];
 // reflection-only side and end softboxes so metal (rims, chrome) reads bright in the dark garage
 for(const sx of [-1,1]){const p=new THREE.Mesh(new THREE.PlaneGeometry(9,1.8),new THREE.MeshBasicMaterial({color:new THREE.Color(1.5,1.5,1.5),side:THREE.DoubleSide}));p.rotation.y=Math.PI/2;p.position.set(sx*(ROOM.width/2-1.5),1.4,0);envScene.add(p);extras.push(p);
  const e=new THREE.Mesh(new THREE.PlaneGeometry(7,1.6),new THREE.MeshBasicMaterial({color:new THREE.Color(1.1,1.1,1.1),side:THREE.DoubleSide}));e.position.set(0,1.3,sx*(ROOM.depth/2-1.5));envScene.add(e);extras.push(e);}
 const pmrem=new THREE.PMREMGenerator(renderer);const environment=pmrem.fromScene(envScene,.02);scene.environment=environment.texture;pmrem.dispose();
 for(const x of extras){envScene.remove(x);x.geometry.dispose();(x.material as THREE.Material).dispose();}garage.group.position.y=0;scene.add(garage.group);
 scene.add(new THREE.HemisphereLight(0xe2edff,0x3a2a22,1.5));
 const key=new THREE.DirectionalLight(0xffffff,2.6);key.position.set(-3,7,4);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.5,far:20});key.shadow.bias=-.0002;key.shadow.normalBias=.02;key.shadow.radius=5;scene.add(key);
 const fill=new THREE.DirectionalLight(0xc6dfff,1.1);fill.position.set(5,3,-5);scene.add(fill);
 const rim=new THREE.DirectionalLight(0xfff2e6,.8);rim.position.set(2,4,-7);scene.add(rim);
 const cabinLight=new THREE.PointLight(0xffffff,0,2.8,2);orbit.add(cabinLight);
 const cabinFill=new THREE.PointLight(0xfff1e0,0,3,2);orbit.add(cabinFill);

 // Ground: soft directional shadow + baked contact shadow + fading floor reflection
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.ShadowMaterial({opacity:.18}));ground.rotation.x=-Math.PI/2;ground.position.y=-.012;ground.receiveShadow=true;ground.visible=false;
 const reflector=new Reflector(new THREE.PlaneGeometry(ROOM.width,ROOM.depth),{shader:reflectionShader,clipBias:.003,textureWidth:1024,textureHeight:1024,multisample:4});
 reflector.rotation.x=-Math.PI/2;reflector.position.y=.001;reflector.visible=true;reflector.renderOrder=-1;
 const rmat=reflector.material as THREE.ShaderMaterial;rmat.transparent=true;rmat.depthWrite=false;scene.add(reflector);

 const CS={w:7,h:7,blur:2.6,far:2.2};
 const shadowGroup=new THREE.Group();orbit.add(shadowGroup);
 const rt=new THREE.WebGLRenderTarget(512,512),rtBlur=new THREE.WebGLRenderTarget(512,512);rt.texture.generateMipmaps=rtBlur.texture.generateMipmaps=false;
 const planeGeometry=new THREE.PlaneGeometry(CS.w,CS.h).rotateX(Math.PI/2);
 const contact=new THREE.Mesh(planeGeometry,new THREE.MeshBasicMaterial({map:rt.texture,opacity:.82,transparent:true,depthWrite:false}));contact.renderOrder=1;contact.scale.y=-1;contact.position.y=.004;contact.visible=false;shadowGroup.add(contact);
 const blurPlane=new THREE.Mesh(planeGeometry);blurPlane.visible=false;shadowGroup.add(blurPlane);
 const shadowCam=new THREE.OrthographicCamera(-CS.w/2,CS.w/2,CS.h/2,-CS.h/2,0,CS.far);shadowCam.rotation.x=Math.PI/2;shadowGroup.add(shadowCam);
 const depthMat=new THREE.MeshDepthMaterial();depthMat.depthTest=depthMat.depthWrite=false;
 depthMat.onBeforeCompile=sh=>{sh.uniforms.darkness={value:1.6};sh.fragmentShader='uniform float darkness;\n'+sh.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );','gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );');};
 const hBlur=new THREE.ShaderMaterial(HorizontalBlurShader),vBlur=new THREE.ShaderMaterial(VerticalBlurShader);hBlur.depthTest=vBlur.depthTest=false;
 function blur(amount:number){blurPlane.visible=true;blurPlane.material=hBlur;hBlur.uniforms.tDiffuse.value=rt.texture;hBlur.uniforms.h.value=amount/256;renderer.setRenderTarget(rtBlur);renderer.render(blurPlane,shadowCam);blurPlane.material=vBlur;vBlur.uniforms.tDiffuse.value=rtBlur.texture;vBlur.uniforms.v.value=amount/256;renderer.setRenderTarget(rt);renderer.render(blurPlane,shadowCam);blurPlane.visible=false;}
 function bakeContact(){
  if(!vehicle)return;const vis=[ground.visible,reflector.visible,contact.visible];ground.visible=reflector.visible=contact.visible=garage.group.visible=false;
  scene.updateMatrixWorld(true);scene.overrideMaterial=depthMat;
  // the shadow texture must start fully transparent (the screen clear colour is opaque black)
  const clearColor=renderer.getClearColor(new THREE.Color()),clearAlpha=renderer.getClearAlpha();renderer.setClearColor(0x000000,0);renderer.setRenderTarget(rt);renderer.clear();renderer.render(scene,shadowCam);scene.overrideMaterial=null;
  blur(CS.blur);blur(CS.blur*.4);renderer.setRenderTarget(null);renderer.setClearColor(clearColor,clearAlpha);[ground.visible,reflector.visible,contact.visible]=vis;garage.group.visible=true;
 }

 const loader=new GLTFLoader();loader.setMeshoptDecoder(MeshoptDecoder);const draco=new DRACOLoader();draco.setDecoderPath('/draco/');loader.setDRACOLoader(draco);
 type Parts={rims:THREE.MeshStandardMaterial[];calipers:THREE.MeshStandardMaterial[];interior:THREE.MeshStandardMaterial[];glass:THREE.MeshStandardMaterial[];headlights:THREE.MeshStandardMaterial[];taillights:THREE.MeshStandardMaterial[]};
 type Prepared={scene:THREE.Object3D;spec:Vehicle;paints:THREE.MeshPhysicalMaterial[];parts:Parts;openings:HingedPart[];center:THREE.Vector3;
  rimMeshes:THREE.Mesh[];slots:WheelSlot[];rimMat:THREE.MeshPhysicalMaterial;wheelSets:Map<string,THREE.Group>;zones:Record<string,THREE.Box3>;carbon:CarbonUniforms|null;interiorU:InteriorUniforms|null};
 const noParts=():Parts=>({rims:[],calipers:[],interior:[],glass:[],headlights:[],taillights:[]});
 // Prepared vehicles stay in memory, so switching back to a car is instant.
 const cache=new Map<string,Prepared>(),pending=new Map<string,Promise<Prepared>>();
 let cur:Prepared|null=null;const vehInv=new THREE.Matrix4();
 let vehicle:THREE.Object3D|null=null,spec:Vehicle|null=null,paints:THREE.MeshPhysicalMaterial[]=[],parts=noParts(),openings:HingedPart[]=[],vehicleCenter=new THREE.Vector3(),doorsBaked=true;
 let targetAngle=0,targetZoom=1,currentZoom=1,frame=0,auto=false,disposed=false,request=0,last=0,active=false,dirty=true,blendNow=0;
 // Interior camera: mode blend 0 (outside) → 1 (inside)
 const cabin={mode:'exterior' as ViewMode,seat:0,yaw:0,pitch:-.1,fov:68,currentFov:68,blend:0,yawTarget:0,pitchTarget:-.1,autoDir:1};
 const cameraBase=new THREE.Vector3(),focus=new THREE.Vector3(0,.95,0);let exteriorFov=42;
 // Exterior camera on a sphere around the car: azimuth from the drag angle, adjustable elevation.
 const view={radius:9.2,baseAz:-.709,angle:0,elev:.11,elevTarget:.11};
 if(import.meta.env.DEV)Object.assign((window as unknown as {__studio:object}).__studio,{view,focus,wake:()=>wake()});
 const tmpPos=new THREE.Vector3(),tmpTarget=new THREE.Vector3(),eye=new THREE.Vector3(),dir=new THREE.Vector3(),right=new THREE.Vector3(),hp=new THREE.Vector3(),hc=new THREE.Vector3(),toCam=new THREE.Vector3();

 /** Positions the HTML hotspot buttons over their hinged parts. Hidden inside the car and on the far side. */
 function placeHotspots(){
  const {width,height}=container.getBoundingClientRect();
  for(const o of openings){const el=hotspotEls.current.get(o.id);if(!el)continue;
   o.obj.localToWorld(hp.copy(o.anchor));orbit.localToWorld(hc.copy(vehicleCenter));
   const facing=hc.subVectors(hp,hc).dot(toCam.subVectors(camera.position,hp))>0;
   hp.project(camera);const show=facing&&blendNow<.05&&hp.z<1;
   el.style.transform=`translate(${(hp.x*.5+.5)*width}px,${(-hp.y*.5+.5)*height}px) translate(-50%,-50%)`;el.classList.toggle('visible',show);}
 }
 function render(){if(disposed)return;renderer.render(scene,camera);placeHotspots();}
 function wake(){if(disposed)return;dirty=true;if(!active){active=true;last=performance.now();frame=requestAnimationFrame(animate)}}
 function interiorPose(pos:THREE.Vector3,target:THREE.Vector3){
  const c=spec?.cabin;if(!c){pos.copy(cameraBase);target.copy(focus);return;}
  const seat=c.seats[Math.min(cabin.seat,c.seats.length-1)];eye.fromArray(seat.eye);
  dir.fromArray(c.forward).normalize().applyAxisAngle(UP,cabin.yaw);right.crossVectors(dir,UP).normalize();dir.applyAxisAngle(right,cabin.pitch);
  pos.copy(orbit.localToWorld(eye.clone()));target.copy(orbit.localToWorld(eye.add(dir)));
 }
 function animate(time:number){
  const delta=Math.min((time-last)/1000,.05);last=time;const damping=1-Math.exp(-10*delta);
  const inside=cabin.mode==='interior';
  if(auto&&vehicle){if(inside){cabin.yawTarget+=delta*.22*cabin.autoDir;if(Math.abs(cabin.yawTarget)>1.4)cabin.autoDir*=-1;}else targetAngle+=delta*.3;}
  view.angle=THREE.MathUtils.lerp(view.angle,targetAngle,damping);view.elev=THREE.MathUtils.lerp(view.elev,view.elevTarget,damping);
  {const az=view.baseAz-(view.angle-(spec?.rotation??0)),r=view.radius;cameraBase.set(focus.x+r*Math.cos(view.elev)*Math.sin(az),focus.y+r*Math.sin(view.elev),focus.z+r*Math.cos(view.elev)*Math.cos(az));}
  currentZoom=THREE.MathUtils.lerp(currentZoom,targetZoom,damping);
  cabin.yaw=THREE.MathUtils.lerp(cabin.yaw,cabin.yawTarget,damping);cabin.pitch=THREE.MathUtils.lerp(cabin.pitch,cabin.pitchTarget,damping);cabin.currentFov=THREE.MathUtils.lerp(cabin.currentFov,cabin.fov,damping);
  const blendTarget=inside?1:0;cabin.blend+=Math.sign(blendTarget-cabin.blend)*Math.min(Math.abs(blendTarget-cabin.blend),delta*1.1);
  const e=smooth(cabin.blend);blendNow=e;
  if(e<=0){camera.position.copy(cameraBase);camera.lookAt(focus);}
  else{interiorPose(tmpPos,tmpTarget);camera.position.lerpVectors(cameraBase,tmpPos,e);camera.position.y+=Math.sin(Math.PI*e)*.9;tmpTarget.lerpVectors(focus,tmpTarget,e);camera.lookAt(tmpTarget);}
  camera.fov=THREE.MathUtils.lerp(exteriorFov,cabin.currentFov,e);camera.zoom=THREE.MathUtils.lerp(currentZoom,1,e);camera.near=e>.6?.015:.1;camera.updateProjectionMatrix();
  reflector.visible=e<.85;
  cabinFill.intensity=1.3*e;
  const doorsMoving=stepOpenings(openings,delta);if(doorsMoving){doorsBaked=false;syncRest();}else if(!doorsBaked){doorsBaked=true;bakeContact();}
  render();
  const moving=Math.abs(view.angle-targetAngle)>.0001||Math.abs(view.elev-view.elevTarget)>.0001||Math.abs(currentZoom-targetZoom)>.0001||Math.abs(cabin.yaw-cabin.yawTarget)>.0001||Math.abs(cabin.pitch-cabin.pitchTarget)>.0001||Math.abs(cabin.currentFov-cabin.fov)>.01||cabin.blend!==blendTarget||doorsMoving;
  if(auto&&vehicle||moving||dirty){dirty=false;frame=requestAnimationFrame(animate)}else active=false;
 }
 function applyLook(l:Look){
  setPaint(paints,l.paint,l.finish);
  applySwatch(parts.rims,find(rimOptions,l.rim));applySwatch(parts.calipers,find(caliperOptions,l.caliper));applySwatch(parts.interior,find(interiorOptions,l.interior));
  setTint(parts.glass,l.tint);setLamps(parts.headlights,l.lights,'#eef6ff',7);setLamps(parts.taillights,l.lights,'#ff1a1a',3.2);
  const amb=find(ambientOptions,l.ambient);cabinLight.color.set(amb.hex);cabinLight.intensity=amb.name==="Off"?0:1.8;
  for(const o of openings)o.target=l.open.includes(o.id)?1:0;
  setRimDesign(l.rimDesign as RimDesign);
  orbit.updateMatrixWorld(true);vehInv.copy(orbit.matrixWorld).invert();
  if(cur?.carbon)setCarbon(cur.carbon,l.carbon.map(z=>cur!.zones[z]).filter(Boolean),vehInv);
  if(cur?.interiorU)setInterior(cur.interiorU,vehInv,l.inlay,cabinLight.color,amb.name!=='Off');
  wake();
 }
 /** Keeps carbon zones attached to moving parts: uRest = closed-pose world x inverse(current world). */
 const restM=new THREE.Matrix4(),curInv=new THREE.Matrix4();
 function syncRest(){
  if(!vehicle)return;vehicle.updateMatrixWorld(true);
  for(const o of openings){restM.compose(o.obj.position,o.base,o.obj.scale).premultiply(o.obj.parent!.matrixWorld);curInv.copy(o.obj.matrixWorld).invert();restM.multiply(curInv);
   o.obj.traverse(n=>{if(n instanceof THREE.Mesh)for(const m of Array.isArray(n.material)?n.material:[n.material])m.userData.rest?.value.copy(restM);});}
 }
 /** Shows the original rims or a generated design, built on first use and kept for instant switching. */
 function setRimDesign(design:RimDesign){
  if(!cur)return;const want:RimDesign=design!=='Original'&&cur.slots.length===4?design:'Original';
  for(const m of cur.rimMeshes)m.visible=want==='Original';
  if(want!=='Original'&&!cur.wheelSets.has(want)){
   const set=new THREE.Group();set.name='custom-wheels-'+want;
   for(const s of cur.slots){const w=buildWheel(want,s,!!cur.spec.wheels?.replaceTires,cur.rimMat);placeWheel(w,s);set.add(w);}
   // slots are in normalized vehicle space; undo the root's normalization so the set lines up inside it
   set.applyMatrix4(cur.scene.matrix.clone().invert());cur.scene.add(set);cur.wheelSets.set(want,set);
  }
  cur.wheelSets.forEach((set,name)=>set.visible=name===want);
 }
 function detach(){if(vehicle)orbit.remove(vehicle);vehicle=null;cur=null;spec=null;paints=[];parts=noParts();openings=[];setHotspots([]);}
 function clear(){container.classList.remove('has-model');request++;detach();doorsBaked=true;ground.visible=contact.visible=false;auto=false;targetAngle=view.angle=0;orbit.rotation.y=0;targetZoom=currentZoom=1;cabin.mode='exterior';cabin.blend=0;wake();}
 function setCabinView(){cabin.yaw=cabin.yawTarget=0;cabin.pitch=cabin.pitchTarget=-.1;cabin.fov=68;}
 async function prepare(v:Vehicle,onProgress?:(p:number)=>void):Promise<Prepared>{
  const hit=cache.get(v.id);if(hit)return hit;
  const inflight=pending.get(v.id);if(inflight)return inflight;
  const job=(async()=>{
   const gltf=await loader.loadAsync(v.asset,p=>{if(p.total>0)onProgress?.(Math.round(p.loaded/p.total*100))}).catch(()=>{throw new Error('This vehicle could not be loaded. Please try Apply again or choose another vehicle.');});
   if(disposed){disposeObject(gltf.scene);throw new Error('Viewer closed.');}
   // The bundled BMW asset includes licensed badge, plate and tire maps.
   if(v.id==='bmw-x5-g05-2018'){
    const tl=new THREE.TextureLoader();
    try{
     const [badge,alpha,tire,plate]=await Promise.all(['T_common_Logo_BMW.png','T_common_Logo_BMW_Alpha.png','T_G05_Tire_N.png','T_ParadoxCat_LicensePlate.png'].map(n=>tl.loadAsync('/models/'+n)));
     [badge,alpha,tire,plate].forEach(t=>{t.flipY=false;t.anisotropy=Math.min(8,maxAniso)});badge.colorSpace=plate.colorSpace=THREE.SRGBColorSpace;
     gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){for(const m of (Array.isArray(o.material)?o.material:[o.material]) as THREE.MeshStandardMaterial[]){
      if(m.name==='M_E_common_Emblem'){m.map=badge;m.alphaMap=alpha;m.transparent=true;m.alphaTest=.1;m.color.set('#ffffff')}
      if(m.name==='M_E_ParadoxCat_LicensePlate'){m.map=plate;m.color.set('#ffffff')}
      if(m.name==='M_E_common_Tire'){m.normalMap=tire;m.normalScale.set(.5,.5)}
     }}});
    }catch{disposeObject(gltf.scene);throw new Error('Vehicle textures could not load. Please try Apply again.');}
   }
   let nextPaints:THREE.MeshPhysicalMaterial[];
   hideNodes(gltf.scene,v.hide);
   try{nextPaints=prepareVehicle(gltf.scene,v.paintMaterials,v.length);mirrorMeshes(gltf.scene,v.mirror);if(!nextPaints.length)throw new Error('The vehicle paint setup is incomplete. Please choose another model.')}catch(e){disposeObject(gltf.scene);throw e;}
   gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]) as THREE.MeshStandardMaterial[])for(const t of [m.map,m.normalMap,m.roughnessMap,m.metalnessMap])if(t)t.anisotropy=Math.min(8,maxAniso);});
   const p=v.parts??{};
   const preparedParts:Parts={rims:collectPart(gltf.scene,p.rims),calipers:collectPart(gltf.scene,p.calipers),interior:collectPart(gltf.scene,p.interior),glass:collectPart(gltf.scene,p.glass),headlights:collectPart(gltf.scene,p.headlights),taillights:collectPart(gltf.scene,p.taillights)};
   const forward=new THREE.Vector3(...(v.cabin?.forward??[-1,0,0])).normalize();
   const rimSet=new Set<THREE.Material>(preparedParts.rims);const rimMeshes:THREE.Mesh[]=[];const paintSet=new Set<THREE.Material>(nextPaints);const paintBounds=new THREE.Box3();gltf.scene.updateMatrixWorld(true);
   gltf.scene.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const ms=Array.isArray(o.material)?o.material:[o.material];if(ms.some(m=>rimSet.has(m)))rimMeshes.push(o);if(ms.some(m=>paintSet.has(m)))paintBounds.expandByObject(o);});
   const rimMat=new THREE.MeshPhysicalMaterial({name:'custom-rim',color:0xc3c7cc,metalness:1,roughness:.24,clearcoat:.6,clearcoatRoughness:.08,envMapIntensity:1.2});
   preparedParts.rims.push(rimMat);
   const interior=v.interiorStyle?buildInterior(gltf.scene,v.interiorStyle):null;if(interior)preparedParts.interior=interior.trimMaterials;
   const prepared:Prepared={scene:gltf.scene,spec:v,paints:nextPaints,parts:preparedParts,
    openings:prepareOpenings(gltf.scene,v.openings),center:new THREE.Vector3(0,new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y*.5,0),
    rimMeshes,slots:findWheelSlots(gltf.scene,rimMeshes,forward),rimMat,wheelSets:new Map(),zones:carbonZones(paintBounds,forward),carbon:(nextPaints[0]?.userData.carbon as CarbonUniforms)??null,interiorU:interior?.uniforms??null};
   // Upload shaders and textures to the GPU now, so the first frame after switching does not stall.
   await renderer.compileAsync(gltf.scene,camera,scene).catch(()=>{});
   cache.set(v.id,prepared);return prepared;
  })();
  pending.set(v.id,job);try{return await job}finally{pending.delete(v.id)}
 }
 state.current={
  load:async v=>{
   const ticket=++request;if(!v.available)throw new Error('This vehicle is not installed yet. Please select an available model.');
   const p=await prepare(v,n=>{if(ticket===request)current.current.onProgress(n)});
   if(disposed||ticket!==request)return;
   detach();
   cur=p;vehicle=p.scene;spec=v;paints=p.paints;parts=p.parts;openings=p.openings;vehicleCenter=p.center;orbit.add(vehicle);
   for(const o of openings){o.t=o.target=0;o.obj.quaternion.copy(o.base);}doorsBaked=true;syncRest();
   setHotspots(openings.map(o=>({id:o.id,label:o.label})));
   if(v.cabin){cabinLight.position.fromArray(v.cabin.light);cabinFill.position.fromArray(v.cabin.light).y-=.15;}
   if(!v.cabin)cabin.mode='exterior';cabin.seat=Math.min(cabin.seat,(v.cabin?.seats.length??1)-1);setCabinView();
   orbit.rotation.y=v.rotation;orbit.updateMatrixWorld(true);targetAngle=view.angle=v.rotation;view.elev=view.elevTarget=.11;targetZoom=currentZoom=1;
   ground.visible=contact.visible=true;container.classList.add('has-model');bakeContact();
   applyLook(current.current.look);
  },
  prefetch:v=>{if(v.available&&!cache.has(v.id))prepare(v).catch(()=>{});},
  clear,
  rotate:a=>{if(!vehicle)return;auto=false;if(cabin.mode==='interior')cabin.yawTarget=THREE.MathUtils.clamp(cabin.yawTarget+a,-2.6,2.6);else targetAngle+=a;wake();},
  zoom:a=>{if(!vehicle)return;if(cabin.mode==='interior')cabin.fov=THREE.MathUtils.clamp(cabin.fov-a*60,34,84);else targetZoom=THREE.MathUtils.clamp(targetZoom+a,.8,1.45);wake();},
  home:()=>{auto=false;if(cabin.mode==='interior')setCabinView();else{targetAngle=spec?.rotation??0;view.elevTarget=.11;targetZoom=1;}wake()},
  auto:enabled=>{auto=enabled;wake()},
  setMode:(mode,seat)=>{if(mode==='interior'&&!spec?.cabin)return;if(mode!==cabin.mode||seat!==cabin.seat)setCabinView();cabin.mode=mode;cabin.seat=seat;auto=false;wake();},
  apply:applyLook
 };
 // A click (not a drag) on a door, hood or trunk toggles it.
 const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2();
 function pickOpening(x:number,y:number){
  if(!vehicle||!openings.length||cabin.mode!=='exterior')return null;const r=canvas.getBoundingClientRect();ndc.set((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1);raycaster.setFromCamera(ndc,camera);
  const hit=raycaster.intersectObject(vehicle,true).find(h=>h.object.visible);if(!hit)return null;
  for(let o:THREE.Object3D|null=hit.object;o;o=o.parent){const part=openings.find(p=>p.obj===o);if(part)return part;}return null;
 }
 let dragging=false,previous={x:0,y:0},start={x:0,y:0},travel=0,pinchDistance=0,hoverFrame=0;const pointers=new Map<number,{x:number;y:number}>();
 const distance=()=>{const p=[...pointers.values()];return p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0;};
 const down=(e:PointerEvent)=>{if(!vehicle)return;current.current.onInteraction();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});renderer.domElement.setPointerCapture(e.pointerId);previous=start={x:e.clientX,y:e.clientY};travel=0;dragging=true;pinchDistance=distance();auto=false;container.classList.add('dragging');};
 const move=(e:PointerEvent)=>{
  if(!dragging){if(e.pointerType==='mouse'&&!hoverFrame){const x=e.clientX,y=e.clientY;hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;container.classList.toggle('over-part',!!pickOpening(x,y));});}return;}
  if(!vehicle)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});travel=Math.max(travel,Math.hypot(e.clientX-start.x,e.clientY-start.y));
  if(pointers.size===2){const d=distance();state.current?.zoom((d-pinchDistance)*.003);pinchDistance=d;}
  else if(cabin.mode==='interior'){cabin.yawTarget=THREE.MathUtils.clamp(cabin.yawTarget+(e.clientX-previous.x)*.0045,-2.6,2.6);cabin.pitchTarget=THREE.MathUtils.clamp(cabin.pitchTarget+(e.clientY-previous.y)*.0045,-.95,.75);}
  else{targetAngle+=(e.clientX-previous.x)*.009;view.elevTarget=THREE.MathUtils.clamp(view.elevTarget+(e.clientY-previous.y)*.004,.03,.75);}
  previous={x:e.clientX,y:e.clientY};wake();};
 const up=(e:PointerEvent)=>{const wasTap=pointers.size===1&&travel<6;pointers.delete(e.pointerId);dragging=pointers.size>0;
  if(dragging){const p=[...pointers.values()][0];previous={x:p.x,y:p.y};}else container.classList.remove('dragging');
  if(wasTap&&e.type==='pointerup'){const part=pickOpening(e.clientX,e.clientY);if(part)current.current.onToggleOpening(part.id);}};
 const wheel=(e:WheelEvent)=>{if(!vehicle)return;e.preventDefault();state.current?.zoom(-e.deltaY*.0008);};
 const keyboard=(e:KeyboardEvent)=>{if(!vehicle)return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(e.key))e.preventDefault();
  if(e.key==='ArrowLeft')state.current?.rotate(cabin.mode==='interior'?Math.PI/10:-Math.PI/8);if(e.key==='ArrowRight')state.current?.rotate(cabin.mode==='interior'?-Math.PI/10:Math.PI/8);
  if(cabin.mode==='interior'&&(e.key==='ArrowUp'||e.key==='ArrowDown')){cabin.pitchTarget=THREE.MathUtils.clamp(cabin.pitchTarget+(e.key==='ArrowUp'?.15:-.15),-.95,.75);wake();}
  if(e.key==='+')state.current?.zoom(.1);if(e.key==='-')state.current?.zoom(-.1);if(e.key==='Home')state.current?.home();};
 const canvas=renderer.domElement;canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('keydown',keyboard);
 const contextLost=(e:Event)=>{e.preventDefault();current.current.onError('The 3D view was interrupted. Reload the page to continue.');};canvas.addEventListener('webglcontextlost',contextLost);
 const observer=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;view.radius=width<700?11.5:9.2;exteriorFov=width<700?54:42;
  const pr=renderer.getPixelRatio();reflector.getRenderTarget().setSize(Math.round(width*pr*.5),Math.round(height*pr*.5));wake();});observer.observe(container);wake();
 return()=>{disposed=true;request++;state.current=null;cancelAnimationFrame(frame);cancelAnimationFrame(hoverFrame);observer.disconnect();clear();cache.forEach(p=>disposeObject(p.scene));cache.clear();garage.dispose();disposeObject(scene);reflector.dispose();rt.dispose();rtBlur.dispose();hBlur.dispose();vBlur.dispose();depthMat.dispose();environment.dispose();key.shadow.map?.dispose();draco.dispose();renderer.dispose();canvas.remove();};
 },[]);
 return <div className="garage-canvas" ref={host}>
  <div className="hotspots">{hotspots.map(h=>{const open=look.open.includes(h.id);return <button key={h.id} ref={el=>{if(el)hotspotEls.current.set(h.id,el);else hotspotEls.current.delete(h.id)}} className={`hotspot ${open?'open':''}`} aria-label={`${open?'Close':'Open'} ${h.label}`} title={`${open?'Close':'Open'} ${h.label}`} onClick={()=>onToggleOpening(h.id)}><span/></button>})}</div>
 </div>;
});
