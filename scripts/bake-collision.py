"""Bake a hull-local heightfield from public/jet_ski.stl for ragdoll collision.

Applies the exact transform chain createVesselMesh() uses (center, rotX -90,
scale to 4 m length, rotY 180, +offsetY 0.35) plus the VISUAL_FLOAT_OFFSET
(0.25), then grids max-height per cell. Regenerate if the model, its load
transforms, or the vesselMeshTuning defaults change.
"""
import struct

OFFSET_Y = 0.35 + 0.25  # vesselMeshTuning.offsetY + VISUAL_FLOAT_OFFSET
X0, Z0 = -0.6, -2.0
CELL_X, CELL_Z = 0.1, 0.2
NX, NZ = 12, 20
EMPTY = -100.0

tris = []
with open('public/jet_ski.stl', 'rb') as f:
    f.read(80)
    count = struct.unpack('<I', f.read(4))[0]
    for _ in range(count):
        data = f.read(50)
        tri = [struct.unpack_from('<fff', data, 12 + v * 12) for v in range(3)]
        tris.append(tri)

xs = [v[0] for t in tris for v in t]
ys = [v[1] for t in tris for v in t]
zs = [v[2] for t in tris for v in t]
cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
scale = 4.0 / (max(ys) - min(ys))  # length is on Y pre-rotation

def transform(v):
    x, y, z = v[0] - cx, v[1] - cy, v[2] - cz
    x, y, z = x, z, -y          # rotX(-90): (x,y,z) -> (x,z,-y)
    x, y, z = x * scale, y * scale, z * scale
    x, z = -x, -z               # rotY(180)
    return x, y + OFFSET_Y, z

grid = [EMPTY] * (NX * NZ)

BAR_CUTOFF = 1.05  # ignore the thin handlebar/steering assembly — solid-
# plateau collision from max-height baking is worse than arms passing the bars

def plot(x, y, z):
    if y > BAR_CUTOFF:
        return
    ix = int((x - X0) / CELL_X)
    iz = int((z - Z0) / CELL_Z)
    if 0 <= ix < NX and 0 <= iz < NZ:
        i = iz * NX + ix
        if y > grid[i]:
            grid[i] = y

for tri in tris:
    pts = [transform(v) for v in tri]
    # adaptive barycentric rasterization: enough samples that even large flat
    # triangles can't straddle a cell without touching it
    ext = max(
        max(p[0] for p in pts) - min(p[0] for p in pts),
        max(p[2] for p in pts) - min(p[2] for p in pts),
    )
    divisions = min(max(int(ext / (CELL_X * 0.5)) + 1, 1), 24)
    for i in range(divisions + 1):
        for j in range(divisions + 1 - i):
            a = i / divisions
            b = j / divisions
            c = 1 - a - b
            plot(*[pts[0][k] * a + pts[1][k] * b + pts[2][k] * c for k in range(3)])

print(f'// x0={X0} z0={Z0} cellX={CELL_X} cellZ={CELL_Z} nx={NX} nz={NZ}')
for iz in range(NZ):
    row = grid[iz * NX:(iz + 1) * NX]
    print('  ' + ', '.join(f'{v:.2f}' for v in row) + ',', f'// z={Z0 + (iz + 0.5) * CELL_Z:.1f}')
