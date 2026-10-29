"""Convert the Shanghai Metro Line 6 AC04 train (by zengwish, CGTrader, Royalty Free) into src/train.bin.

The source OBJ is NOT kept in this repo (the licence doesn't allow redistributing the model file).
Download it from https://www.cgtrader.com/free-3d-models/vehicle/train/shanghai-metro-line6-ac-04-train-alstom-sh-company
and run:  python3 scripts/build_train.py path/to/3d-model.obj

Output: one driving car and one middle car, pantographs removed (Namma Metro uses third rail),
scaled to Namma Metro proportions (21.6 m car pitch, ~2.9 m wide, floor ~0.94 m above rail),
simplified for real-time use. Car length runs along +Z (the driving car's nose at +Z), Y up, rail top at Y=0.
File layout (little-endian): "NMTR", u32 version, then per car: u32 nVerts, u32 nTris, f32[nVerts*3], u16/u32 indices.
"""
import sys, struct, pathlib
import numpy as np
import fast_simplification

src = sys.argv[1]
V, F = [], []
for line in open(src, encoding="latin-1"):
  if line.startswith("v "):
    V.append([float(t) for t in line.split()[1:4]])
  elif line.startswith("f "):
    ids = [int(t.split("/")[0]) for t in line.split()[1:]]
    ids = [i - 1 if i > 0 else len(V) + i for i in ids]
    for k in range(1, len(ids) - 1):
      F.append([ids[0], ids[k], ids[k + 1]])
V = np.asarray(V, np.float64) / 1000.0      # mm -> m; length along X, up Y, width Z
F = np.asarray(F, np.int64)
C = V[F].mean(1)

SEAMS = [-45.4, -22.6, 0.0]                  # driving car [-45.4,-22.6], middle car [-22.6,0]
SCALE = np.array([21.6 / 22.65, 0.85, 0.88])  # length, height, width

def car(x0, x1, target):
  keep = (C[:, 0] >= x0) & (C[:, 0] < x1) & (C[:, 1] < 4.75)   # drop pantographs above the roof
  f = F[keep]
  used, inv = np.unique(f, return_inverse=True)
  v = V[used]; f = inv.reshape(-1, 3)
  # weld near-duplicate vertices so simplification can collapse across part seams
  q = np.round(v / 0.0005).astype(np.int64)
  _, first, remap = np.unique(q, axis=0, return_index=True, return_inverse=True)
  v = v[first]; f = remap.reshape(-1)[f]
  f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
  # keep the large body panels exactly; simplify only the small detail parts (bogies, equipment, fittings)
  T = v[f]; area = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2
  big = area > 0.05
  small = f[~big]
  ratio = max(0.0, 1.0 - max(1, target - big.sum()) / max(1, len(small)))
  vs, fs = fast_simplification.simplify(v.astype(np.float32), small.astype(np.int32), target_reduction=ratio)
  v2 = np.vstack([v.astype(np.float32), vs]); f2 = np.vstack([f[big].astype(np.int64), fs.astype(np.int64) + len(v)])
  used2, inv2 = np.unique(f2, return_inverse=True); v2 = v2[used2]; f2 = inv2.reshape(-1, 3)
  # to car-local: centre the car, length -> +Z with the nose (min X) at +Z, width -> X
  cx = (x0 + x1) / 2
  out = np.empty_like(v2)
  out[:, 0] = v2[:, 2] * SCALE[2]
  out[:, 1] = v2[:, 1] * SCALE[1]
  out[:, 2] = -(v2[:, 0] - cx) * SCALE[0]
  # (x, y, z) -> (z, y, -x) is a rotation, so triangle winding is unchanged
  print(f"car {x0}..{x1}: {keep.sum()} -> {len(f2)} triangles, {len(out)} vertices, "
        f"extent x {out[:,0].min():.2f}..{out[:,0].max():.2f} y {out[:,1].min():.2f}..{out[:,1].max():.2f} z {out[:,2].min():.2f}..{out[:,2].max():.2f}")
  return out.astype(np.float32), f2.astype(np.uint32)

cars = [car(SEAMS[0], SEAMS[1], 15000), car(SEAMS[1], SEAMS[2], 14000)]
buf = bytearray(b"NMTR" + struct.pack("<I", 1))
for v, f in cars:
  buf += struct.pack("<II", len(v), len(f))
  buf += v.tobytes()
  buf += (f.astype(np.uint16) if len(v) < 65536 else f).tobytes()
  if len(buf) % 4: buf += b"\0" * (4 - len(buf) % 4)
out = pathlib.Path(__file__).resolve().parent.parent / "src" / "train.bin"
out.write_bytes(bytes(buf))
print("wrote", out, len(buf), "bytes")
