"""Convert a USD/USDZ car (as exported by Sketchfab) to glTF 2.0 (.gltf + .bin + images).

Usage: py -3.12 scripts/usd_to_gltf.py <scene.usdc> <out_dir>
Then optimize with: npx gltf-transform optimize out/scene.gltf model.glb --compress meshopt --texture-compress webp --texture-size 2048

Handles what Sketchfab's USD export contains: Xform hierarchy (kept, so hinge pivots survive), triangulated
polygon meshes with vertex normals and UVs, UsdPreviewSurface materials. Separate metallic / roughness /
occlusion images are packed back into one glTF ORM texture.
"""
import json, os, shutil, struct, sys
import numpy as np
from PIL import Image
from pxr import Usd, UsdGeom, UsdShade, Sdf

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
stage = Usd.Stage.Open(src)
base_dir = os.path.dirname(os.path.abspath(src))

gltf = {'asset': {'version': '2.0', 'generator': 'detailing-studio usd_to_gltf'}, 'scene': 0, 'scenes': [{'nodes': []}],
        'nodes': [], 'meshes': [], 'materials': [], 'textures': [], 'images': [], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'accessors': [], 'bufferViews': [], 'buffers': []}
blob = bytearray()


def add_view(data: bytes, target=None):
    while len(blob) % 4:
        blob.append(0)
    view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data)}
    if target:
        view['target'] = target
    blob.extend(data)
    gltf['bufferViews'].append(view)
    return len(gltf['bufferViews']) - 1


def add_accessor(arr: np.ndarray, kind: str, component: int, target, minmax=False):
    view = add_view(arr.tobytes(), target)
    acc = {'bufferView': view, 'componentType': component, 'count': int(arr.shape[0]), 'type': kind}
    if minmax:
        acc['min'] = arr.min(axis=0).tolist()
        acc['max'] = arr.max(axis=0).tolist()
    gltf['accessors'].append(acc)
    return len(gltf['accessors']) - 1


# ---------- textures ----------
image_cache = {}


def resolve_file(asset):
    path = asset.resolvedPath or asset.path
    if not os.path.isabs(path):
        path = os.path.join(base_dir, path)
    return path


def add_image(path, name):
    key = os.path.abspath(path)
    if key in image_cache:
        return image_cache[key]
    fname = os.path.basename(path)
    shutil.copyfile(path, os.path.join(out, fname))
    gltf['images'].append({'uri': fname, 'name': name})
    gltf['textures'].append({'source': len(gltf['images']) - 1, 'sampler': 0})
    image_cache[key] = len(gltf['textures']) - 1
    return image_cache[key]


def add_pil(img, fname):
    img.save(os.path.join(out, fname))
    gltf['images'].append({'uri': fname, 'name': fname})
    gltf['textures'].append({'source': len(gltf['images']) - 1, 'sampler': 0})
    return len(gltf['textures']) - 1


def read_input(surface, name):
    """Returns ('tex', path, channel, scale4) or ('val', value) or None."""
    inp = surface.GetInput(name)
    if not inp:
        return None
    sources = inp.GetConnectedSources()[0]
    if sources:
        s = sources[0]
        shader = UsdShade.Shader(s.source.GetPrim())
        f = shader.GetInput('file')
        if f and f.Get():
            scale = shader.GetInput('scale')
            sc = tuple(scale.Get()) if scale and scale.Get() is not None else (1, 1, 1, 1)
            return ('tex', resolve_file(f.Get()), str(s.sourceName), sc)
        return None
    v = inp.Get()
    return ('val', v) if v is not None else None


def channel(path, ch):
    img = Image.open(path)
    if ch in ('r', 'g', 'b', 'a'):
        img = img.convert('RGBA')
        return img.getchannel(ch.upper())
    return img.convert('L')


material_index = {}


def convert_material(mat):
    if not mat:
        return None
    key = str(mat.GetPath())
    if key in material_index:
        return material_index[key]
    surface = mat.ComputeSurfaceSource()[0]
    name = mat.GetPrim().GetName()
    m = {'name': name, 'pbrMetallicRoughness': {}}
    pbr = m['pbrMetallicRoughness']
    if surface:
        d = read_input(surface, 'diffuseColor')
        alpha = 1.0
        if d and d[0] == 'tex':
            pbr['baseColorTexture'] = {'index': add_image(d[1], name + '_base')}
            pbr['baseColorFactor'] = [d[3][0], d[3][1], d[3][2], 1.0]
        elif d:
            pbr['baseColorFactor'] = [float(d[1][0]), float(d[1][1]), float(d[1][2]), 1.0]
        op = read_input(surface, 'opacity')
        if op and op[0] == 'tex':
            m['alphaMode'] = 'BLEND'
            if 'baseColorTexture' not in pbr:
                pbr['baseColorTexture'] = {'index': add_image(op[1], name + '_alpha')}
        elif op and float(op[1]) < 0.999:
            alpha = float(op[1])
            m['alphaMode'] = 'BLEND'
        pbr.setdefault('baseColorFactor', [1, 1, 1, 1])[3] = alpha
        met, rough, occ = read_input(surface, 'metallic'), read_input(surface, 'roughness'), read_input(surface, 'occlusion')
        pbr['metallicFactor'] = float(met[1]) if met and met[0] == 'val' else (met[3][0] if met else 0.0)
        pbr['roughnessFactor'] = float(rough[1]) if rough and rough[0] == 'val' else (rough[3][0] if rough else 0.5)
        textured = [x for x in (met, rough, occ) if x and x[0] == 'tex']
        if textured:
            chans = {k: channel(v[1], v[2]) for k, v in (('m', met), ('r', rough), ('o', occ)) if v and v[0] == 'tex'}
            size = max((c.size for c in chans.values()), key=lambda s: s[0] * s[1])
            full = Image.new('L', size, 255)
            r = chans.get('o', full).resize(size)
            g = chans.get('r', full).resize(size)
            b = chans.get('m', full).resize(size)
            idx = add_pil(Image.merge('RGB', (r, g, b)), f'{name}_orm.png')
            if 'm' in chans or 'r' in chans:
                pbr['metallicRoughnessTexture'] = {'index': idx}
            if 'o' in chans:
                m['occlusionTexture'] = {'index': idx}
        n = read_input(surface, 'normal')
        if n and n[0] == 'tex':
            m['normalTexture'] = {'index': add_image(n[1], name + '_normal')}
        e = read_input(surface, 'emissiveColor')
        if e and e[0] == 'val' and max(e[1]) > 0:
            m['emissiveFactor'] = [float(x) for x in e[1]]
        elif e and e[0] == 'tex':
            m['emissiveTexture'] = {'index': add_image(e[1], name + '_emissive')}
            m['emissiveFactor'] = [1, 1, 1]
    gltf['materials'].append(m)
    material_index[key] = len(gltf['materials']) - 1
    return material_index[key]


# ---------- meshes ----------
def convert_mesh(prim):
    mesh = UsdGeom.Mesh(prim)
    pts = np.asarray(mesh.GetPointsAttr().Get(), dtype=np.float32)
    counts = np.asarray(mesh.GetFaceVertexCountsAttr().Get(), dtype=np.int64)
    idx = np.asarray(mesh.GetFaceVertexIndicesAttr().Get(), dtype=np.int64)
    if len(pts) == 0 or len(counts) == 0:
        return None
    keep = counts >= 3
    starts = np.cumsum(counts) - counts
    counts, starts = counts[keep], starts[keep]
    ntri = counts - 2
    face = np.repeat(np.arange(len(counts)), ntri)
    k = np.arange(ntri.sum()) - np.repeat(np.cumsum(ntri) - ntri, ntri)
    s = starts[face]
    tris = np.stack([idx[s], idx[s + k + 1], idx[s + k + 2]], axis=1)
    if mesh.GetOrientationAttr().Get() == 'leftHanded':
        tris = tris[:, [0, 2, 1]]
    attrs = {'POSITION': add_accessor(pts, 'VEC3', 5126, 34962, True)}
    normals = mesh.GetNormalsAttr().Get()
    pv = UsdGeom.PrimvarsAPI(prim)
    pvn = pv.GetPrimvar('normals')
    if pvn and pvn.HasValue():
        normals = pvn.ComputeFlattened()
    if normals is not None and len(normals) == len(pts):
        nrm = np.asarray(normals, dtype=np.float32)
        lens = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm = np.where(lens > 0, nrm / np.maximum(lens, 1e-12), np.array([0, 1, 0], np.float32))
        attrs['NORMAL'] = add_accessor(nrm.astype(np.float32), 'VEC3', 5126, 34962)
    uv_pv = next((p for p in pv.GetPrimvars() if p.GetTypeName().role == 'TextureCoordinate' or p.GetPrimvarName() in ('st', 'st0', 'UVMap')), None)
    if uv_pv and uv_pv.HasValue():
        uv = np.asarray(uv_pv.ComputeFlattened(), dtype=np.float32)
        if len(uv) == len(pts):
            uv = uv.copy()
            uv[:, 1] = 1.0 - uv[:, 1]
            attrs['TEXCOORD_0'] = add_accessor(uv, 'VEC2', 5126, 34962)
    ind = add_accessor(tris.reshape(-1).astype(np.uint32), 'SCALAR', 5125, 34963)
    mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
    primitive = {'attributes': attrs, 'indices': ind, 'mode': 4}
    mi = convert_material(mat)
    if mi is not None:
        primitive['material'] = mi
    gltf['meshes'].append({'name': prim.GetName(), 'primitives': [primitive]})
    return len(gltf['meshes']) - 1


def convert_prim(prim):
    if prim.IsA(UsdShade.Material) or prim.IsA(UsdShade.Shader) or prim.GetTypeName() == 'Scope' and prim.GetName() == 'Materials':
        return None
    if not (prim.IsA(UsdGeom.Xformable) or prim.GetTypeName() in ('', 'Scope')):
        return None
    node = {'name': prim.GetName()}
    if prim.IsA(UsdGeom.Xformable):
        m = UsdGeom.Xformable(prim).GetLocalTransformation()
        flat = [m[r][c] for r in range(4) for c in range(4)]  # USD row-vector matrix == glTF column-major array
        if flat != [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]:
            node['matrix'] = flat
    if prim.IsA(UsdGeom.Mesh):
        mi = convert_mesh(prim)
        if mi is not None:
            node['mesh'] = mi
    gltf['nodes'].append(node)
    me = len(gltf['nodes']) - 1
    kids = [c for c in (convert_prim(ch) for ch in prim.GetChildren()) if c is not None]
    if kids:
        gltf['nodes'][me]['children'] = kids
    return me


top = [n for n in (convert_prim(p) for p in stage.GetPseudoRoot().GetChildren()) if n is not None]
gltf['scenes'][0]['nodes'] = top
with open(os.path.join(out, 'scene.bin'), 'wb') as f:
    f.write(blob)
gltf['buffers'] = [{'uri': 'scene.bin', 'byteLength': len(blob)}]
for key in ('textures', 'images', 'samplers'):
    if not gltf[key]:
        del gltf[key]
with open(os.path.join(out, 'scene.gltf'), 'w') as f:
    json.dump(gltf, f)
print(f"nodes {len(gltf['nodes'])} meshes {len(gltf['meshes'])} materials {len(gltf['materials'])} images {len(gltf.get('images', []))} bin {len(blob)/1e6:.1f} MB")
