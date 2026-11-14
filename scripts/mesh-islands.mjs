// Lists the connected geometry islands of meshes in a .gltf, in scene (world) coordinates.
// Usage: node scripts/mesh-islands.mjs <scene.gltf> <material-substring> [minTriangles]
// Door skins, hoods and trunk lids are usually separate islands inside one merged body mesh.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {islands, worldPositions} from './lib/islands.mjs';

const [file,matFilter,minTris='150']=process.argv.slice(2);
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(file);
for(const node of doc.getRoot().listNodes()){
 const mesh=node.getMesh();if(!mesh)continue;
 for(const prim of mesh.listPrimitives()){
  const mat=prim.getMaterial()?.getName()??'';if(!mat.includes(matFilter))continue;
  const pos=worldPositions(node,prim);const comps=islands(prim,pos);
  console.log(`\n${node.getName()} [${mat}] islands=${comps.length}`);
  comps.filter(c=>c.tris>=+minTris).sort((a,b)=>b.tris-a.tris).forEach((c,i)=>console.log(` #${c.id} tris=${c.tris} min=${c.min.map(v=>v.toFixed(2))} max=${c.max.map(v=>v.toFixed(2))}`));
 }
}
