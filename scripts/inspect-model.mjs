// Usage: node scripts/inspect-model.mjs <file.glb|file.gltf>
// Prints size, bounds, materials and the node tree, to find paint, wheels, glass, interior and door pivots.
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {getBounds} from '@gltf-transform/core';
import draco3d from 'draco3dgltf';
import {MeshoptDecoder} from 'meshoptimizer';
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco3d.createDecoderModule(),'meshopt.decoder':MeshoptDecoder});
const doc=await io.read(process.argv[2]);const root=doc.getRoot();
const scene=root.getDefaultScene()??root.listScenes()[0];const b=getBounds(scene);
console.log('size (model units):',b.max.map((v,i)=>(v-b.min[i]).toFixed(3)).join(' x '));
let tris=0;for(const m of root.listMeshes())for(const p of m.listPrimitives()){const i=p.getIndices();tris+=(i?i.getCount():p.getAttribute('POSITION').getCount())/3;}
console.log('meshes',root.listMeshes().length,'triangles',Math.round(tris),'textures',root.listTextures().length,'materials',root.listMaterials().length);
console.log('\nMATERIALS:\n'+root.listMaterials().map(m=>`  ${m.getName()}  color=${m.getBaseColorFactor().slice(0,3).map(v=>v.toFixed(2))} metal=${m.getMetallicFactor()} rough=${m.getRoughnessFactor()} ${m.getBaseColorTexture()?'[map]':''}`).join('\n'));
console.log('\nNODES:');
const walk=(n,d)=>{const mesh=n.getMesh();const mats=mesh?[...new Set(mesh.listPrimitives().map(p=>p.getMaterial()?.getName()))].join(','):'';
 console.log(`${'  '.repeat(d)}${n.getName()||'(unnamed)'}${mesh?'  ['+mats+']':''}${n.listChildren().length?'  ('+n.listChildren().length+')':''}`);if(d<7)n.listChildren().forEach(c=>walk(c,d+1));};
scene.listChildren().forEach(n=>walk(n,0));
