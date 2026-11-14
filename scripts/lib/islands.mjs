// Shared helpers: world-space vertex positions and connected components ("islands") of a primitive.


export function worldPositions(node,prim){
 const m=node.getWorldMatrix();const a=prim.getAttribute('POSITION');const n=a.getCount();const out=new Float32Array(n*3);const v=[0,0,0];
 for(let i=0;i<n;i++){a.getElement(i,v);const x=v[0],y=v[1],z=v[2];out[i*3]=m[0]*x+m[4]*y+m[8]*z+m[12];out[i*3+1]=m[1]*x+m[5]*y+m[9]*z+m[13];out[i*3+2]=m[2]*x+m[6]*y+m[10]*z+m[14];}
 return out;
}

/** Union-find over shared vertices, plus vertices at identical positions (split UV seams). */
export function islands(prim,pos){
 const idx=prim.getIndices();const count=idx?idx.getCount():prim.getAttribute('POSITION').getCount();const get=i=>idx?idx.getScalar(i):i;
 const n=pos.length/3;const parent=new Int32Array(n);for(let i=0;i<n;i++)parent[i]=i;
 const find=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
 const unite=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[a]=b;};
 const key=new Map();for(let i=0;i<n;i++){const k=`${Math.round(pos[i*3]*1e4)},${Math.round(pos[i*3+1]*1e4)},${Math.round(pos[i*3+2]*1e4)}`;const j=key.get(k);if(j===undefined)key.set(k,i);else unite(i,j);}
 for(let t=0;t<count;t+=3){const a=get(t),b=get(t+1),c=get(t+2);unite(a,b);unite(b,c);}
 const byRoot=new Map();const triIsland=new Int32Array(count/3);
 for(let t=0;t<count;t+=3){const r=find(get(t));let c=byRoot.get(r);if(!c){c={id:byRoot.size,tris:0,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};byRoot.set(r,c);}c.tris++;triIsland[t/3]=c.id;
  for(const k of [0,1,2]){const v=get(t+k);for(let d=0;d<3;d++){const p=pos[v*3+d];if(p<c.min[d])c.min[d]=p;if(p>c.max[d])c.max[d]=p;}}}
 const list=[...byRoot.values()];list.triIsland=triIsland;return list;
}

