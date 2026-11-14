"""Rebuild the licensed 2018 BMW X5 from BMW Car IT's glTF meshes and Ramses hierarchy.
Usage: python scripts/assemble-bmw.py SOURCE_DIRECTORY OUTPUT.glb
Source: https://github.com/bmwcarit/digital-car-3d (CC BY 4.0)
"""
import json,base64,struct,math,sys,pathlib,copy
root=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2]); blob=bytearray()
doc={'asset':{'version':'2.0','generator':'Detailing Studio / BMW Car IT conversion','copyright':'BMW Car IT GmbH, CC BY 4.0; scene assembly and PBR adaptation by Detailing Studio'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],'accessors':[],'bufferViews':[],'images':[],'textures':[],'samplers':[],'extensionsUsed':['KHR_materials_clearcoat']}
mesh_lookup={}
for f in sorted(root.glob('*.gltf')):
 d=json.loads(f.read_text()); off={k:len(doc[k]) for k in ['meshes','materials','accessors','bufferViews','images','textures','samplers']}; buf_offsets=[]
 for b in d.get('buffers',[]):
  while len(blob)%4:blob.append(0)
  buf_offsets.append(len(blob)); blob.extend(base64.b64decode(b['uri'].split(',')[1]))
 for v in d.get('bufferViews',[]):
  v['byteOffset']=v.get('byteOffset',0)+buf_offsets[v['buffer']];v['buffer']=0;doc['bufferViews'].append(v)
 for a in d.get('accessors',[]):
  if 'bufferView' in a:a['bufferView']+=off['bufferViews']
  doc['accessors'].append(a)
 for im in d.get('images',[]):
  if 'bufferView' in im:im['bufferView']+=off['bufferViews']
  doc['images'].append(im)
 doc['samplers'].extend(d.get('samplers',[]))
 for t in d.get('textures',[]):
  if 'source' in t:t['source']+=off['images']
  if 'sampler' in t:t['sampler']+=off['samplers']
  doc['textures'].append(t)
 def fix_textures(x):
  if isinstance(x,dict):
   for k,v in x.items():
    if k.endswith('Texture') and isinstance(v,dict) and 'index' in v:v['index']+=off['textures']
    else:fix_textures(v)
  elif isinstance(x,list):
   for v in x:fix_textures(v)
 for m in d.get('materials',[]):
  fix_textures(m);doc['materials'].append(m)
 for idx,m in enumerate(d['meshes']):
  mesh_lookup[(f.name,idx)]=len(doc['meshes'])
  for p in m['primitives']:
   p['attributes']={k:v+off['accessors'] for k,v in p['attributes'].items()}
   if 'indices'in p:p['indices']+=off['accessors']
   if 'material'in p:p['material']+=off['materials']
  doc['meshes'].append(m)
rca=json.loads((root/'G05_main.rca').read_text()); items={i['properties']['objectID']:i for i in rca['instances']}
def vec(p,k,default):return [p.get(k,{}).get(a,{}).get('value',default) for a in 'xyz']
def quaternion(v):
 x,y,z=[math.radians(n)/2 for n in v]; c1,c2,c3=map(math.cos,(x,y,z));s1,s2,s3=map(math.sin,(x,y,z))
 return [s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3]
def build(id):
 i=items[id];p=i['properties']
 if i['typeName'] not in ['Node','MeshNode'] or not p.get('visibility',True):return None
 n={'name':p['objectName'],'translation':vec(p,'translation',0),'rotation':quaternion(vec(p,'rotation',0)),'scale':vec(p,'scaling',1)}
 if i['typeName']=='MeshNode':
  m=items[p['mesh']]['properties'];key=(pathlib.Path(m['uri']).name,m['meshIndex'])
  if key not in mesh_lookup:return None
  n['mesh']=mesh_lookup[key]
 idx=len(doc['nodes']);doc['nodes'].append(n);children=[]
 for c in p.get('children',{}).get('properties',[]):
  child=build(c['value'])
  if child is not None:children.append(child)
 if children:n['children']=children
 return idx
r=next(k for k,v in items.items() if v['properties'].get('objectName')=='G05_full');doc['scenes'][0]['nodes']=[build(r)]
# Mark only coachwork as paint. Wheel paint must stay unchanged.
for m in doc['materials']:
 if m.get('name')=='M_E_common_Paint':m['extras']={'bodyPaint':True}
while len(blob)%4:blob.append(0)
doc['buffers']=[{'byteLength':len(blob)}]
for k in ['images','textures','samplers']:
 if not doc[k]:del doc[k]
j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
out.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(j)+len(blob))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(blob),b'BIN\x00')+blob)
print('Wrote',out,len(doc['nodes']),'nodes,',len(blob),'binary bytes')
