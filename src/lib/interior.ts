import * as THREE from 'three';

/**
 * Procedural luxury interior for a car whose cabin geometry exists but has no textures (the BMW X5):
 * quilted leather seats, leather grain, a decorative inlay band with a chrome line and an ambient light
 * strip on the dash and doors, soft-touch dash, and two drawn displays. No image files are used; every
 * pattern is computed in the shader in vehicle space, so the source model needs no UVs.
 */
export const inlayOptions=['Fineline Wood','Open-pore Walnut','Carbon','Aluminium','Piano Black'] as const;
export type Inlay=typeof inlayOptions[number];

export interface InteriorStyle {
 quilted?:string[];leather?:string[];dash?:string[];wheel?:string[];base?:string[];
 /** Vehicle-space height range of the inlay band, and the chrome line height. */
 band:[number,number];chrome:number;
 /** Above this height the leather trim turns into the dark headliner/pillar colour. */
 top?:number;
 /** Direction the occupants face (quilting goes on cushions and on surfaces facing this way). */
 forward?:[number,number,number];
 screens?:{kind:'cluster'|'center';center:[number,number,number];size:[number,number];lookAt:[number,number,number]}[];
}
export interface InteriorUniforms { uFwd:{value:THREE.Vector3};uTop:{value:number};uVehInv:{value:THREE.Matrix4};uBand:{value:THREE.Vector2};uChrome:{value:number};uInlay:{value:number};uAmbient:{value:THREE.Color} }

const KIND={quilted:0,leather:1,dash:2,wheel:3,base:4} as const;
type Kind=keyof typeof KIND;

const common=`
varying vec3 vIntPos;varying vec3 vIntN;uniform float uTop;uniform vec3 uFwd;uniform vec2 uBand;uniform float uChrome;uniform int uInlay;uniform vec3 uAmbient;
float iHash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float iNoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(iHash(i),iHash(i+vec3(1,0,0)),f.x),mix(iHash(i+vec3(0,1,0)),iHash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(iHash(i+vec3(0,0,1)),iHash(i+vec3(1,0,1)),f.x),mix(iHash(i+vec3(0,1,1)),iHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
vec2 iPlane(vec3 p,vec3 n){vec3 a=abs(n);return a.y>max(a.x,a.z)?p.xz:(a.x>a.z?p.zy:p.xy);}
// height-to-normal without UVs (same maths as three.js bump mapping)
vec3 iBump(vec3 n,float h,float s){vec3 sx=dFdx(-vViewPosition),sy=dFdy(-vViewPosition);vec3 r1=cross(sy,n),r2=cross(n,sx);float det=dot(sx,r1);
 vec2 dh=vec2(dFdx(h),dFdy(h));vec3 g=sign(det)*(dh.x*r1+dh.y*r2);return normalize(abs(det)*n-g*s);}
float iQuiltMask(){return INTERIOR_KIND==0?smoothstep(.6,.85,max(dot(vIntN,uFwd),vIntN.y)):0.;}
// returns pillow height (1 inside a diamond, 0 on the seam) and writes the seam mask
float iQuilt(out float seam){vec2 uv=iPlane(vIntPos,vIntN);vec2 d=vec2(uv.x+uv.y,uv.x-uv.y)*(1./.058);vec2 f=fract(d)-.5;float m=max(abs(f.x),abs(f.y));
 seam=1.-smoothstep(.43,.49,m);seam=1.-seam;float along=abs(f.x)>abs(f.y)?d.y:d.x;float stitch=step(.5,fract(along*9.))*smoothstep(.455,.47,m)*(1.-smoothstep(.47,.485,m));
 seam=max(seam*.7,stitch);return smoothstep(.5,.3,m);}
float iInBand(){return (INTERIOR_KIND==1||INTERIOR_KIND==2)&&vIntPos.y>uBand.x&&vIntPos.y<uBand.y?1.:0.;}
float iInChrome(){return (INTERIOR_KIND==1||INTERIOR_KIND==2)&&abs(vIntPos.y-uChrome)<.0035?1.:0.;}
float iInAmbient(){return (INTERIOR_KIND==1||INTERIOR_KIND==2)&&vIntPos.y>uBand.x-.009&&vIntPos.y<uBand.x-.004?1.:0.;}
vec3 iCarbon(vec3 p,vec3 n){vec2 uv=iPlane(p,n)*180.;vec2 c=floor(uv),f=fract(uv);float dir=mod(c.x+c.y,4.)<2.?0.:1.;float t=pow(sin((dir<.5?f.x:f.y)*3.14159),.55);return mix(vec3(.012,.013,.015),vec3(.07,.075,.085),t*(dir<.5?1.:.62));}
// inlay colour, roughness, metalness, clearcoat
vec4 iInlay(out float metal,out float coat){vec3 p=vIntPos;metal=0.;coat=1.;
 if(uInlay==0){float l=iNoise(vec3(p.y*420.,p.z*3.,p.x*3.));float ph=p.y*900.+l*6.;float s=sin(ph)*.5+.5;s=mix(s,.5,clamp(fwidth(ph)*.35,0.,1.));return vec4(mix(vec3(.10,.075,.06),vec3(.26,.19,.14),s*.6+l*.4),.28);}
 if(uInlay==1){float f=iNoise(p*vec3(6.,60.,6.));float ph=p.y*180.+f*9.;float r=sin(ph)*.5+.5;r=mix(r,.5,clamp(fwidth(ph)*.35,0.,1.));coat=0.;return vec4(mix(vec3(.15,.085,.045),vec3(.38,.23,.12),r*.7+f*.3),.55);}
 if(uInlay==2){metal=.2;return vec4(iCarbon(p,vIntN),.3);}
 if(uInlay==3){float s=iNoise(vec3(p.y*900.,p.z*4.,0.));metal=1.;coat=0.;return vec4(vec3(.56)+s*.1,.26+s*.1);}
 return vec4(vec3(.008),.06);}
`;

function interiorMaterial(kind:Kind,u:InteriorUniforms,color:number,roughness:number){
 const m=new THREE.MeshPhysicalMaterial({name:'interior-'+kind,color,roughness,metalness:0,clearcoat:kind==='dash'||kind==='leather'?1:0,clearcoatRoughness:.06,sheen:kind==='quilted'||kind==='leather'?.35:kind==='wheel'?.12:0,sheenRoughness:.6,sheenColor:new THREE.Color(.5,.45,.4),envMapIntensity:.7});
 (m as unknown as {defines:Record<string,number>}).defines={INTERIOR_KIND:KIND[kind]};
 m.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,u);
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vIntPos;varying vec3 vIntN;uniform mat4 uVehInv;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nmat4 toVehI=uVehInv*modelMatrix;vIntPos=(toVehI*vec4(transformed,1.)).xyz;vIntN=normalize(mat3(toVehI)*objectNormal);');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\n'+common)
   .replace('#include <color_fragment>',`#include <color_fragment>
float upper=INTERIOR_KIND==1?smoothstep(uTop-.01,uTop+.01,vIntPos.y):0.;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.075,.08),upper);
float qSeam=0.;float qMask=iQuiltMask();float qH=qMask>0.?iQuilt(qSeam):0.;qSeam*=qMask;
float grain=iNoise(vIntPos*900.)*.6+iNoise(vIntPos*2300.)*.4;
float bandM=iInBand(),chromeM=iInChrome(),ambM=iInAmbient();float inlayMetal=0.,inlayCoat=0.;vec4 inlay=bandM>0.?iInlay(inlayMetal,inlayCoat):vec4(0.);
diffuseColor.rgb*=1.-qSeam*.32;diffuseColor.rgb*=.92+grain*.16;
diffuseColor.rgb=mix(diffuseColor.rgb,inlay.rgb,bandM);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.92),chromeM);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.02),ambM);`)
   .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+(grain-.5)*.12+qSeam*.15,.04,1.);roughnessFactor=mix(roughnessFactor,inlay.a,bandM);roughnessFactor=mix(roughnessFactor,.12,chromeM);')
   .replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,inlayMetal,bandM);metalnessFactor=mix(metalnessFactor,1.,chromeM);')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=uAmbient*ambM*3.;')
   .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\nnormal=iBump(normal,qH*.0032+grain*(INTERIOR_KIND==4?.0003:.00012)*(1.-bandM),1.);')
   .replace('#include <lights_physical_fragment>','#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat*=bandM*inlayCoat+chromeM;\n#endif');
 };
 m.customProgramCacheKey=()=>'interior-'+kind;
 return m;
}

/** Draws a display on a canvas (no brand logos). */
function screenTexture(kind:'cluster'|'center'){
 const c=document.createElement('canvas');c.width=1024;c.height=384;const g=c.getContext('2d')!;
 const bg=g.createLinearGradient(0,0,0,384);bg.addColorStop(0,'#05070b');bg.addColorStop(1,'#0b1018');g.fillStyle=bg;g.fillRect(0,0,1024,384);
 g.font='600 30px Inter, Arial, sans-serif';g.textBaseline='middle';
 if(kind==='cluster'){
  const gauge=(cx:number,label:string,value:string,frac:number,color:string)=>{
   g.lineWidth=10;g.strokeStyle='#1d2633';g.beginPath();g.arc(cx,205,140,Math.PI*.8,Math.PI*2.2);g.stroke();
   g.strokeStyle=color;g.shadowColor=color;g.shadowBlur=18;g.beginPath();g.arc(cx,205,140,Math.PI*.8,Math.PI*(.8+1.4*frac));g.stroke();g.shadowBlur=0;
   for(let i=0;i<=10;i++){const a=Math.PI*(.8+.14*i);g.strokeStyle='#8fa0b5';g.lineWidth=3;g.beginPath();g.moveTo(cx+Math.cos(a)*118,205+Math.sin(a)*118);g.lineTo(cx+Math.cos(a)*128,205+Math.sin(a)*128);g.stroke();}
   g.fillStyle='#ffffff';g.textAlign='center';g.font='300 76px Inter, Arial, sans-serif';g.fillText(value,cx,200);g.font='500 22px Inter, Arial, sans-serif';g.fillStyle='#8fa0b5';g.fillText(label,cx,262);};
  gauge(190,'km/h','0',.02,'#ff7900');gauge(834,'x1000 rpm','0.8',.12,'#4da3ff');
  g.textAlign='center';g.fillStyle='#ffffff';g.font='600 64px Inter, Arial, sans-serif';g.fillText('P',512,150);
  g.font='500 24px Inter, Arial, sans-serif';g.fillStyle='#8fa0b5';g.fillText('R  N  D',512,200);g.fillText('Range 612 km',512,262);g.fillText('21.5°C   10:42',512,312);
  g.fillStyle='#ff7900';g.fillRect(452,92,120,4);
 }else{
  // navigation map
  g.fillStyle='#0d141e';g.fillRect(0,0,680,384);g.strokeStyle='#1c2838';g.lineWidth=14;
  for(const [x1,y1,x2,y2] of [[0,90,680,140],[0,280,680,230],[150,0,230,384],[430,0,380,384],[0,360,680,330],[560,0,620,384]])
   {g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();}
  g.strokeStyle='#26364b';g.lineWidth=5;for(let i=0;i<9;i++){g.beginPath();g.moveTo(i*80,0);g.lineTo(i*80+40,384);g.stroke();}
  g.strokeStyle='#ff7900';g.lineWidth=10;g.shadowColor='#ff7900';g.shadowBlur=12;g.beginPath();g.moveTo(190,384);g.lineTo(205,250);g.lineTo(405,232);g.lineTo(420,120);g.stroke();g.shadowBlur=0;
  g.fillStyle='#4da3ff';g.beginPath();g.moveTo(190,330);g.lineTo(178,356);g.lineTo(202,356);g.closePath();g.fill();
  g.fillStyle='#ffffffdd';g.font='600 28px Inter, Arial, sans-serif';g.textAlign='left';g.fillText('Detailing Studio',24,40);g.font='400 22px Inter, Arial, sans-serif';g.fillStyle='#8fa0b5';g.fillText('Arrival 10:58 · 4.2 km',24,72);
  // side widgets
  g.fillStyle='#121a26';g.fillRect(690,14,320,170);g.fillRect(690,198,320,172);
  g.fillStyle='#ffffff';g.font='600 26px Inter, Arial, sans-serif';g.fillText('Now playing',712,52);g.font='400 22px Inter, Arial, sans-serif';g.fillStyle='#8fa0b5';g.fillText('Studio Radio',712,88);
  g.fillStyle='#1f2b3b';g.fillRect(712,128,276,8);g.fillStyle='#ff7900';g.fillRect(712,128,120,8);
  g.fillStyle='#ffffff';g.font='300 64px Inter, Arial, sans-serif';g.fillText('21.5°',712,280);g.font='400 22px Inter, Arial, sans-serif';g.fillStyle='#8fa0b5';g.fillText('Climate · Auto',712,336);
 }
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}

/** Applies the style to the cabin meshes and adds the displays. Returns the materials the trim colour applies to. */
export function buildInterior(root:THREE.Object3D,style:InteriorStyle){
 const u:InteriorUniforms={uFwd:{value:new THREE.Vector3(...(style.forward??[-1,0,0])).normalize()},uTop:{value:style.top??99},uVehInv:{value:new THREE.Matrix4()},uBand:{value:new THREE.Vector2(...style.band)},uChrome:{value:style.chrome},uInlay:{value:0},uAmbient:{value:new THREE.Color(0,0,0)}};
 const mats={quilted:interiorMaterial('quilted',u,0x6b3419,.55),leather:interiorMaterial('leather',u,0x6b3419,.5),dash:interiorMaterial('dash',u,0x151515,.62),wheel:interiorMaterial('wheel',u,0x0b0b0b,.45),base:interiorMaterial('base',u,0x1c1c1e,.85)};
 const replaced=new Set<THREE.Material>();
 root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;
  for(const kind of Object.keys(mats) as Kind[]){const list=style[kind];if(list?.some(p=>o.name.startsWith(p))){replaced.add(o.material as THREE.Material);o.material=mats[kind];break;}}});
 // displays, positioned in normalized vehicle space and expressed in the root's local space
 const screens=new THREE.Group();screens.name='interior-screens';
 for(const s of style.screens??[]){
  const tex=screenTexture(s.kind);
  const display=new THREE.Mesh(new THREE.PlaneGeometry(...s.size),new THREE.MeshBasicMaterial({map:tex,toneMapped:false,color:new THREE.Color(1.15,1.15,1.15)}));
  const bezel=new THREE.Mesh(new THREE.BoxGeometry(s.size[0]+.014,s.size[1]+.014,.012),new THREE.MeshPhysicalMaterial({color:0x050505,roughness:.08,clearcoat:1,metalness:.2}));bezel.position.z=-.0065;
  const holder=new THREE.Group();holder.add(display,bezel);holder.position.fromArray(s.center);holder.lookAt(new THREE.Vector3(...s.lookAt));screens.add(holder);
 }
 screens.applyMatrix4(root.matrix.clone().invert());root.add(screens);
 return {uniforms:u,trimMaterials:[mats.quilted,mats.leather] as THREE.MeshStandardMaterial[],replaced};
}

export function setInterior(u:InteriorUniforms,vehicleSpaceInverse:THREE.Matrix4,inlay:string,ambient:THREE.Color,ambientOn:boolean){
 u.uVehInv.value.copy(vehicleSpaceInverse);u.uInlay.value=Math.max(0,inlayOptions.indexOf(inlay as Inlay));u.uAmbient.value.copy(ambient).multiplyScalar(ambientOn?1:0);
}
