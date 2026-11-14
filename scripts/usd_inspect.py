"""Print the structure of a USD scene: units, up axis, prim tree with meshes and bound materials, and material inputs.
Usage: py -3.12 scripts/usd_inspect.py path/to/scene.usdc [max_depth]
"""
import sys
from pxr import Usd, UsdGeom, UsdShade

stage = Usd.Stage.Open(sys.argv[1])
depth_limit = int(sys.argv[2]) if len(sys.argv) > 2 else 8
print('upAxis', UsdGeom.GetStageUpAxis(stage), 'metersPerUnit', UsdGeom.GetStageMetersPerUnit(stage))
cache = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ['default', 'render'])
root = stage.GetPseudoRoot()
box = cache.ComputeWorldBound(root).ComputeAlignedRange()
print('bounds', box.GetMin(), box.GetMax(), 'size', box.GetSize())

tris = 0
meshes = 0
for prim in stage.Traverse():
    if prim.IsA(UsdGeom.Mesh):
        meshes += 1
        counts = UsdGeom.Mesh(prim).GetFaceVertexCountsAttr().Get() or []
        tris += sum(max(c - 2, 0) for c in counts)
print('meshes', meshes, 'triangles', tris)


def walk(prim, d):
    if d > depth_limit:
        return
    info = ''
    if prim.IsA(UsdGeom.Mesh):
        mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
        info = f"  [mesh -> {mat.GetPrim().GetName() if mat else '-'}]"
    elif prim.IsA(UsdShade.Material) or prim.IsA(UsdShade.Shader):
        return
    kids = [c for c in prim.GetChildren() if not (c.IsA(UsdShade.Material) or c.IsA(UsdShade.Shader))]
    print('  ' * d + prim.GetName() + f' <{prim.GetTypeName()}>' + info + (f' ({len(kids)})' if kids else ''))
    for c in kids:
        walk(c, d + 1)


for c in root.GetChildren():
    walk(c, 0)

print('\nMATERIALS')
for prim in stage.Traverse():
    if prim.IsA(UsdShade.Material):
        mat = UsdShade.Material(prim)
        surf = mat.ComputeSurfaceSource()[0]
        if not surf:
            print(' ', prim.GetName(), '(no surface)')
            continue
        parts = []
        for inp in surf.GetInputs():
            src = inp.GetConnectedSources()[0]
            if src:
                shader = UsdShade.Shader(src[0].source.GetPrim())
                f = shader.GetInput('file')
                parts.append(f"{inp.GetBaseName()}=tex({f.Get().path.split('/')[-1] if f and f.Get() else shader.GetIdAttr().Get()})")
            else:
                parts.append(f'{inp.GetBaseName()}={inp.Get()}')
        print(' ', prim.GetName(), ' '.join(parts))
