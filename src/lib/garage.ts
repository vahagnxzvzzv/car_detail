import * as THREE from 'three';

/**
 * A real 3D detailing garage in the style of the original photo: orange/graphite checker tile floor,
 * black slatted walls, orange columns, angled LED strips in a black ceiling, an illuminated DETAILING
 * sign and vinyl wrap-roll racks. Everything is procedural (canvas textures), so no downloads are needed.
 */
export const ROOM={width:22,depth:26,height:5.2};

function canvasTexture(w:number,h:number,draw:(c:CanvasRenderingContext2D)=>void,srgb=true){
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;draw(canvas.getContext('2d')!);
 const t=new THREE.CanvasTexture(canvas);if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;
}

/** 8 × 8 interlocking tiles. Colour map plus a roughness map that makes the grout matte. */
function tileTextures(){
 const N=8,S=1024,c=S/N;
 const color=canvasTexture(S,S,g=>{
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   const orange=(x+y)%2===0;g.fillStyle=orange?'#d4521c':'#25272a';g.fillRect(x*c,y*c,c,c);
   // subtle surface pattern of interlocking garage tiles
   g.fillStyle=orange?'#c84a17':'#202225';for(let i=1;i<6;i++)for(let j=1;j<6;j++){g.beginPath();g.arc(x*c+i*c/6,y*c+j*c/6,c*.018,0,Math.PI*2);g.fill();}
   const grad=g.createLinearGradient(x*c,y*c,x*c+c,y*c+c);grad.addColorStop(0,'rgba(255,255,255,.05)');grad.addColorStop(1,'rgba(0,0,0,.08)');g.fillStyle=grad;g.fillRect(x*c,y*c,c,c);
  }
  g.strokeStyle='#0d0d0e';g.lineWidth=5;for(let i=0;i<=N;i++){g.beginPath();g.moveTo(i*c,0);g.lineTo(i*c,S);g.stroke();g.beginPath();g.moveTo(0,i*c);g.lineTo(S,i*c);g.stroke();}
 });
 const rough=canvasTexture(S,S,g=>{g.fillStyle='#3a3a3a';g.fillRect(0,0,S,S);g.strokeStyle='#e0e0e0';g.lineWidth=7;for(let i=0;i<=N;i++){g.beginPath();g.moveTo(i*c,0);g.lineTo(i*c,S);g.stroke();g.beginPath();g.moveTo(0,i*c);g.lineTo(S,i*c);g.stroke();}},false);
 return {color,rough};
}

function slatTexture(){
 return canvasTexture(512,512,g=>{g.fillStyle='#101113';g.fillRect(0,0,512,512);for(let x=0;x<512;x+=32){g.fillStyle='#08090a';g.fillRect(x,0,3,512);g.fillStyle='#17181b';g.fillRect(x+3,0,2,512);}});
}

function signTexture(text:string){
 return canvasTexture(2048,256,g=>{g.clearRect(0,0,2048,256);g.font='600 190px Inter, Arial, sans-serif';g.textAlign='center';g.textBaseline='middle';g.shadowColor='rgba(255,255,255,.9)';g.shadowBlur=28;g.fillStyle='#ffffff';g.fillText(text,1024,138);});
}

export function buildGarage(){
 const group=new THREE.Group();group.name='garage';
 const {width:W,depth:D,height:H}=ROOM;
 const owned:THREE.Texture[]=[];
 const track=<T extends THREE.Texture>(t:T)=>{owned.push(t);return t;};

 // Floor
 const tiles=tileTextures();const repeat=new THREE.Vector2(W/4,D/4);
 for(const t of [tiles.color,tiles.rough]){t.repeat.copy(repeat);track(t);}
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(W,D),new THREE.MeshStandardMaterial({map:tiles.color,roughnessMap:tiles.rough,roughness:.55,metalness:0,envMapIntensity:.5}));
 floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.name='garage-floor';group.add(floor);

 // Walls (black slats) and ceiling
 const slats=track(slatTexture());
 const wallMat=(len:number)=>{const t=slats.clone();t.needsUpdate=true;t.repeat.set(len/1.6,1);track(t);return new THREE.MeshStandardMaterial({map:t,roughness:.62,metalness:.1,envMapIntensity:.4});};
 const walls:[number,number,number,number][]=[[0,-D/2,0,W],[0,D/2,Math.PI,W],[-W/2,0,Math.PI/2,D],[W/2,0,-Math.PI/2,D]];
 for(const [x,z,ry,len] of walls){const m=new THREE.Mesh(new THREE.PlaneGeometry(len,H),wallMat(len));m.position.set(x,H/2,z);m.rotation.y=ry;m.receiveShadow=true;group.add(m);}
 const baseboard=new THREE.MeshStandardMaterial({color:0x050505,roughness:.4,metalness:.3});
 for(const [x,z,ry,len] of walls){const b=new THREE.Mesh(new THREE.BoxGeometry(len,.12,.04),baseboard);b.position.set(x,.06,z);b.rotation.y=ry;group.add(b);}
 const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(W,D),new THREE.MeshStandardMaterial({color:0x060607,roughness:.9}));ceiling.rotation.x=Math.PI/2;ceiling.position.y=H;group.add(ceiling);

 // LED strips at varied angles, like the photographed ceiling
 const led=new THREE.MeshStandardMaterial({color:0x000000,emissive:0xffffff,emissiveIntensity:5.5,roughness:1});
 const ledGeo=new THREE.BoxGeometry(.13,.03,2.6);
 const angles=[.42,-.3,.75,-.6,.15,-.82,.3,-.12,.62,-.45,0,.9];
 const leds=new THREE.InstancedMesh(ledGeo,led,90);let n=0;const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),one=new THREE.Vector3(1,1,1);
 for(let x=-W/2+2;x<=W/2-2;x+=2.4)for(let z=-D/2+2.2;z<=D/2-2.2;z+=3.1){if(n>=90)break;const a=angles[n%angles.length];q.setFromAxisAngle(new THREE.Vector3(0,1,0),a+Math.PI/2*(n%3===0?1:0));pos.set(x+((n*37)%10-5)*.06,H-.03,z+((n*53)%10-5)*.08);leds.setMatrixAt(n++,m4.compose(pos,q,one));}
 leds.count=n;group.add(leds);

 // Orange columns
 const orange=new THREE.MeshStandardMaterial({color:0xff6a10,roughness:.45,metalness:0,emissive:0xff5a00,emissiveIntensity:.03});
 for(const [x,z] of [[-5.2,-D/2+.45],[3.2,-D/2+.45],[-W/2+.45,-3.5],[-W/2+.45,6],[W/2-.45,7]] as [number,number][]){const col=new THREE.Mesh(new THREE.BoxGeometry(.9,H,.9),orange);col.position.set(x,H/2,z);col.castShadow=col.receiveShadow=true;group.add(col);}

 // Illuminated sign on the back wall
 const sign=new THREE.Mesh(new THREE.PlaneGeometry(7,.875),new THREE.MeshBasicMaterial({map:track(signTexture('DETAILING')),transparent:true,toneMapped:false,color:new THREE.Color(1.6,1.6,1.6)}));
 sign.position.set(-1,3.05,-D/2+.03);group.add(sign);

 // Vinyl wrap racks on the right wall: chrome brackets with coloured rolls
 const rollColors=[0xc81d25,0xd7d9dc,0xc81d25,0xb98d3b,0xeeeeee,0x9fa3a8,0x1d1f22,0xd4af37,0x7a7d82,0xf2f2f2,0x2f6fd6,0xc0c0c0];
 const rack=new THREE.Group();const bracket=new THREE.MeshStandardMaterial({color:0xc9ccd0,metalness:1,roughness:.25});
 const rollGeo=new THREE.CylinderGeometry(.075,.075,1.55,24);rollGeo.rotateZ(Math.PI/2);
 for(let bay=0;bay<3;bay++){const bz=-7.5+bay*2.2;
  for(const dz of [-.82,.82]){const post=new THREE.Mesh(new THREE.BoxGeometry(.05,2.6,.05),bracket);post.position.set(0,1.75,bz+dz);rack.add(post);}
  for(let i=0;i<12;i++){const color=rollColors[(i+bay*5)%rollColors.length];const roll=new THREE.Mesh(rollGeo,new THREE.MeshStandardMaterial({color,metalness:color===0xd7d9dc||color===0xc0c0c0||color===0x9fa3a8?.95:.35,roughness:.22,envMapIntensity:1.2}));roll.rotation.y=Math.PI/2;roll.position.set(-.06,.6+i*.2,bz);rack.add(roll);}}
 rack.position.set(W/2-.12,0,0);group.add(rack);

 // Wall-washer lights at the top of the walls for a soft glow line
 const wash=new THREE.MeshBasicMaterial({color:new THREE.Color(1.4,1.35,1.3),toneMapped:false});
 for(const [x,z,ry,len] of walls){const s=new THREE.Mesh(new THREE.PlaneGeometry(len-1,.05),wash);s.position.set(x,H-.25,z);s.rotation.y=ry;s.translateZ(.02);group.add(s);}

 const dispose=()=>{group.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});owned.forEach(t=>t.dispose());};
 return {group,floor,dispose};
}
